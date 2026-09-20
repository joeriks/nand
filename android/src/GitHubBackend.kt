package se.gitbsidian.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Base64
import kotlin.math.max
import kotlin.math.min

internal fun obj(vararg fields: Pair<String, Any?>) = JSONObject().apply { fields.forEach { put(it.first, it.second ?: JSONObject.NULL) } }
internal fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
internal class BackendError(val status: Int, val code: String, message: String, val details: Any? = null, val retryAfter: Long? = null) : RuntimeException(message)
internal interface PrivateStore { fun read(name: String): JSONObject?; fun write(name: String, value: JSONObject?) }
internal data class HttpReply(val status: Int, val body: String, val headers: Map<String, String> = emptyMap())
internal fun interface HttpTransport { fun request(url: String, method: String, headers: Map<String, String>, body: String?): HttpReply }

/** Native-only protocol adapter. Tokens never enter the WebView or its storage.
 * Called on one executor; dependency injection is for Android instrumentation tests. */
internal class GitHubBackend(private val store: PrivateStore, private val transport: HttpTransport, private val now: () -> Long = System::currentTimeMillis) {
    private val workspaces = mutableMapOf<String, Pair<Long, JSONObject>>()
    private var device: JSONObject? = null
    private var cooldown = 0L
    private val maxNote = 1024 * 1024
    private fun enc(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    private fun encPath(value: String) = value.split('/').joinToString("/") { enc(it) }
    private fun positive(value: Long): Long { if (value <= 0) throw BackendError(400, "validation", "Ogiltig identitet."); return value }
    private fun path(value: String, root: Boolean = false): String {
        if (root && value.isEmpty()) return value
        if (value.length !in 1..1000 || value.startsWith('/') || value.any { it.code < 32 || it.code == 127 || it in "\\%?#:" } || value.split('/').any { it.isEmpty() || it == "." || it == ".." || it.equals(".git", true) } || !root && !(value.endsWith(".md", true) || value.endsWith(".csv", true))) throw BackendError(400, "path", "Ogiltig Markdown-sökväg.")
        return value
    }
    private fun branch(value: String): String {
        if (value.length !in 1..255 || value.any { it.code <= 32 || it.code == 127 || it in "~^:?*[\\" } || value.contains("..") || value.contains("@{") || value.startsWith('-') || value.endsWith('/') || value.endsWith('.')) throw BackendError(400, "branch", "Ogiltigt grennamn.")
        return value
    }
    private fun parsed(reply: HttpReply): JSONObject = try { JSONObject(reply.body) } catch (_: Exception) { throw BackendError(502, "response", "GitHubs svar kunde inte läsas.") }
    private fun api(token: String, route: String, method: String = "GET", body: JSONObject? = null): String {
        if (cooldown > now()) throw BackendError(429, "rate-limit", "GitHub ber oss vänta. Utkastet finns kvar.", retryAfter = (cooldown - now() + 999) / 1000)
        val reply = try { transport.request("https://api.github.com$route", method, mapOf("Authorization" to "Bearer $token", "Accept" to "application/vnd.github+json", "X-GitHub-Api-Version" to "2026-03-10", "Content-Type" to "application/json"), body?.toString()) }
            catch (error: BackendError) { throw error } catch (_: Exception) { throw BackendError(503, "network", "Kontakten med GitHub avbröts. Utkastet finns kvar.") }
        val headers = reply.headers.mapKeys { it.key.lowercase() }
        when {
            reply.status == 401 -> throw BackendError(401, "authentication", "Logga in igen för att synka. Du kan fortsätta skriva lokalt.")
            reply.status == 429 || reply.status == 403 && (headers["x-ratelimit-remaining"] == "0" || headers.containsKey("retry-after")) -> {
                val seconds = max(1, headers["retry-after"]?.toLongOrNull() ?: headers["x-ratelimit-reset"]?.toLongOrNull()?.let { it - now() / 1000 } ?: 60)
                cooldown = now() + seconds * 1000
                throw BackendError(429, "rate-limit", "GitHubs API-gräns är nådd. Synkningen väntar.", retryAfter = seconds)
            }
            reply.status == 404 -> throw BackendError(404, "not-found", "Filen, grenen eller repositoryt saknas, eller så saknas åtkomst.")
            reply.status in listOf(403, 409, 422) -> throw BackendError(reply.status, "github-write", "GitHub avvisade ändringen. Kontrollera åtkomst och grenregler.")
            reply.status !in 200..299 -> throw BackendError(502, "github", "GitHub kunde inte slutföra anropet.")
        }
        return reply.body
    }
    private fun json(token: String, route: String, method: String = "GET", body: JSONObject? = null): JSONObject = try { JSONObject(api(token, route, method, body)) } catch (error: BackendError) { throw error } catch (_: Exception) { throw BackendError(502, "response", "GitHubs svar kunde inte läsas.") }
    private fun oauth(endpoint: String, fields: Map<String, String>): JSONObject {
        val reply = try { transport.request("https://github.com/login/$endpoint", "POST", mapOf("Accept" to "application/json", "Content-Type" to "application/x-www-form-urlencoded"), fields.entries.joinToString("&") { "${enc(it.key)}=${enc(it.value)}" }) }
            catch (_: Exception) { throw BackendError(503, "network", "Kunde inte nå GitHub. Kontrollera anslutningen.") }
        if (reply.status !in 200..299) throw BackendError(502, "oauth", "GitHub kunde inte slutföra inloggningen.")
        return parsed(reply)
    }
    private fun repositories(token: String, installation: Long? = null): JSONArray {
        val installations = mutableListOf<Long>()
        if (installation != null) installations.add(positive(installation)) else {
            var page = 1
            do {
                val batch = json(token, "/user/installations?per_page=100&page=$page").getJSONArray("installations")
                installations.addAll(batch.objects().map { it.getLong("id") }); page++
                if (page > 1000) throw BackendError(413, "limit", "För många installationer.")
            } while (batch.length() == 100)
        }
        val result = JSONArray()
        for (id in installations) {
            var page = 1
            do {
                val batch = json(token, "/user/installations/$id/repositories?per_page=100&page=$page").getJSONArray("repositories")
                for (repo in batch.objects()) result.put(obj("id" to repo.getLong("id"), "fullName" to repo.getString("full_name"), "installationId" to id, "defaultBranch" to repo.getString("default_branch"), "private" to repo.getBoolean("private"), "hasWiki" to repo.optBoolean("has_wiki")))
                page++; if (page > 1000) throw BackendError(413, "limit", "För många repositories.")
            } while (batch.length() == 100)
        }
        return result
    }
    private fun authorize(token: String, repo: Long, installation: Long): JSONObject = repositories(token, positive(installation)).objects().find { it.getLong("id") == positive(repo) } ?: throw BackendError(403, "repository-access", "Appen eller kontot saknar åtkomst till detta repository. Utkasten finns kvar.")
    private fun repoPath(workspace: JSONObject) = "/repos/${encPath(workspace.getJSONObject("repository").getString("fullName"))}"
    private fun tree(token: String, workspace: JSONObject, sha: String, recursive: Boolean = false) = json(token, "${repoPath(workspace)}/git/trees/${enc(sha)}${if (recursive) "?recursive=1" else ""}")
    private fun head(token: String, workspace: JSONObject) = json(token, "${repoPath(workspace)}/branches/${enc(workspace.getString("branch"))}").getJSONObject("commit").getJSONObject("commit").getJSONObject("tree").getString("sha")
    private fun descend(token: String, workspace: JSONObject, initial: String, parts: List<String>): String? {
        var sha = initial
        for (part in parts) {
            val result = tree(token, workspace, sha)
            if (result.getBoolean("truncated")) throw BackendError(413, "tree-limit", "En mapp är för stor för att läsas fullständigt.")
            val entry = result.getJSONArray("tree").objects().find { it.getString("path") == part } ?: return null
            if (entry.getString("type") != "tree") throw BackendError(400, "path", "Sökvägen passerar en fil, symlänk eller submodul.")
            sha = entry.getString("sha")
        }
        return sha
    }
    private fun notes(token: String, workspace: JSONObject): JSONArray {
        val root = workspace.getString("root")
        val rootSha = descend(token, workspace, head(token, workspace), if (root.isEmpty()) emptyList() else root.split('/')) ?: return JSONArray()
        val result = tree(token, workspace, rootSha, true)
        val entries = mutableListOf<JSONObject>()
        if (!result.getBoolean("truncated")) entries.addAll(result.getJSONArray("tree").objects()) else {
            val queue = java.util.ArrayDeque<Pair<String, String>>(); queue.add(rootSha to "")
            while (queue.isNotEmpty()) {
                val (sha, prefix) = queue.removeFirst(); val subtree = tree(token, workspace, sha)
                if (subtree.getBoolean("truncated")) throw BackendError(413, "tree-limit", "En mapp är för stor för att läsas fullständigt.")
                for (entry in subtree.getJSONArray("tree").objects()) {
                    val full = prefix + entry.getString("path")
                    if (entry.getString("type") == "tree") queue.add(entry.getString("sha") to "$full/") else entries.add(JSONObject(entry.toString()).put("path", full))
                }
                if (entries.size + queue.size > 100000) throw BackendError(413, "tree-limit", "Samlingen är för stor för Android-prototypen.")
            }
        }
        return JSONArray(entries.filter { it.getString("type") == "blob" && it.getString("mode") in listOf("100644", "100755") && (it.getString("path").endsWith(".md", true) || it.getString("path").endsWith(".csv", true)) }.map { obj("path" to it.getString("path"), "sha" to it.getString("sha"), "size" to it.optLong("size")) })
    }
    private fun blob(token: String, workspace: JSONObject, entry: JSONObject): JSONObject {
        if (entry.optLong("size") > maxNote) throw BackendError(413, "size", "Anteckningar större än 1 MiB stöds inte.")
        val result = json(token, "${repoPath(workspace)}/git/blobs/${enc(entry.getString("sha"))}")
        if (result.getString("encoding") != "base64") throw BackendError(422, "encoding", "Filens kodning stöds inte.")
        val bytes = Base64.getMimeDecoder().decode(result.getString("content"))
        if (bytes.size > maxNote) throw BackendError(413, "size", "Anteckningar större än 1 MiB stöds inte.")
        val text = try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString() } catch (_: Exception) { throw BackendError(422, "encoding", "Anteckningen måste vara UTF-8.") }
        if (text.contains('\u0000')) throw BackendError(422, "encoding", "Binärdata stöds inte.")
        return obj("path" to entry.getString("path"), "text" to text, "sha" to entry.getString("sha"))
    }
    private fun absent(path: String) = obj("path" to path, "text" to "", "sha" to null)
    private fun read(token: String, workspace: JSONObject, notePath: String): JSONObject {
        path(notePath)
        val full = listOf(workspace.getString("root"), notePath).filter { it.isNotEmpty() }.joinToString("/").split('/')
        val parent = descend(token, workspace, head(token, workspace), full.dropLast(1)) ?: return absent(notePath)
        val result = tree(token, workspace, parent)
        if (result.getBoolean("truncated")) throw BackendError(413, "tree-limit", "Mappen kunde inte läsas fullständigt.")
        val entry = result.getJSONArray("tree").objects().find { it.getString("path") == full.last() } ?: return absent(notePath)
        if (entry.getString("type") != "blob" || entry.getString("mode") !in listOf("100644", "100755")) throw BackendError(400, "file-type", "Endast vanliga Markdown- och CSV-filer kan redigeras.")
        return blob(token, workspace, JSONObject(entry.toString()).put("path", notePath))
    }
    private fun sha(note: JSONObject): String? = if (note.isNull("sha")) null else note.getString("sha")
    private fun save(token: String, workspace: JSONObject, input: JSONObject): JSONObject {
        val notePath = path(input.getString("path")); val text = input.getString("text")
        if (text.toByteArray(Charsets.UTF_8).size > maxNote) throw BackendError(413, "size", "Anteckningen är större än 1 MiB.")
        val expected = if (input.isNull("baseSha")) null else input.getString("baseSha").also { if (!it.matches(Regex("[a-f0-9]{40}"))) throw BackendError(400, "validation", "Ogiltig grundversion.") }
        val remote = read(token, workspace, notePath)
        if (sha(remote) != null && remote.getString("text") == text) return remote
        if (sha(remote) != expected) throw BackendError(409, "conflict", "Anteckningen har ändrats på GitHub. Jämför versionerna.", remote)
        val full = listOf(workspace.getString("root"), notePath).filter { it.isNotEmpty() }.joinToString("/")
        val payload = obj("message" to "Uppdatera $full", "content" to Base64.getEncoder().encodeToString(text.toByteArray(Charsets.UTF_8)), "branch" to workspace.getString("branch"))
        if (expected != null) payload.put("sha", expected)
        try {
            val result = json(token, "${repoPath(workspace)}/contents/${encPath(full)}", "PUT", payload)
            return obj("path" to notePath, "text" to text, "sha" to result.getJSONObject("content").getString("sha"))
        } catch (error: BackendError) {
            if (error.status !in listOf(403, 409, 422, 502, 503)) throw error
            val latest = try { read(token, workspace, notePath) } catch (_: Exception) { throw BackendError(503, "uncertain", "Oklart om ändringen nådde GitHub. Den kontrolleras före nästa skrivning.") }
            if (sha(latest) != null && latest.getString("text") == text) return latest
            if (sha(latest) != expected) throw BackendError(409, "conflict", "En annan version finns på GitHub. Utkastet är bevarat.", latest)
            throw error
        }
    }
    private fun register(account: Long, workspace: JSONObject): String {
        if (workspace.optString("mode", "repository") != "repository") throw BackendError(501, "wiki-unavailable", "GitHub Wiki stöds inte i Android-prototypen.")
        path(workspace.getString("root"), true); branch(workspace.getString("branch"))
        val repo = workspace.getJSONObject("repository"); positive(repo.getLong("id")); positive(repo.getLong("installationId"))
        val key = "$account:${repo.getLong("id")}:${workspace.getString("branch")}:${workspace.getString("root")}".toByteArray()
        val id = MessageDigest.getInstance("SHA-256").digest(key).joinToString("") { "%02x".format(it) }
        workspaces[id] = account to JSONObject(workspace.toString()); return id
    }
    fun request(input: JSONObject): JSONObject = try { obj("status" to 200, "data" to handle(input)) }
        catch (error: BackendError) { obj("status" to error.status, "data" to obj("code" to error.code, "error" to error.message, "details" to error.details, "retryAfter" to error.retryAfter)) }
        catch (_: org.json.JSONException) { obj("status" to 400, "data" to obj("code" to "validation", "error" to "Ogiltig inmatning eller oväntat serversvar. Utkastet finns kvar.")) }
        catch (_: Exception) { obj("status" to 500, "data" to obj("code" to "android", "error" to "Android-anropet kunde inte slutföras. Utkastet finns kvar.")) }

    private fun handle(input: JSONObject): Any {
        val route = input.getString("url"); val method = input.getString("method"); val body = input.optJSONObject("body") ?: JSONObject()
        if (!route.startsWith("/api/") || route.length > 4096 || method !in listOf("GET", "POST", "PUT") || body.toString().toByteArray().size > 2 * maxNote) throw BackendError(400, "url", "Ogiltigt appanrop.")
        val uri = URI("https://app.invalid$route")
        if (uri.host != "app.invalid" || uri.fragment != null) throw BackendError(400, "url", "Ogiltigt appanrop.")
        val query = uri.rawQuery?.split('&')?.associate { val parts = it.split('=', limit = 2); java.net.URLDecoder.decode(parts[0], "UTF-8") to java.net.URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8") } ?: emptyMap()
        val session = store.read("session"); val config = store.read("config"); val user = session?.getJSONObject("user")
        val valid = session != null && session.getLong("expiresAt") > now()
        if (uri.path == "/api/session" && method == "GET") return obj("user" to if (valid) user else null, "localUser" to user, "settings" to config, "platform" to "android", "configuration" to obj("ready" to (config != null), "installUrl" to config?.getString("appSlug")?.let { "https://github.com/apps/$it/installations/new" }), "storage" to obj("wiki" to obj("available" to false, "reason" to "GitHub Wiki stöds inte i Android-prototypen. Välj repositoryfiler.")))
        if (uri.path == "/api/desktop/config" && method == "POST") {
            val id = body.getString("clientId"); val slug = body.getString("appSlug")
            if (!id.matches(Regex("[a-zA-Z0-9_.-]{4,100}")) || !slug.matches(Regex("[a-zA-Z0-9-]{1,100}"))) throw BackendError(400, "configuration", "Ogiltigt Client ID eller appnamn.")
            store.write("session", null); store.write("config", obj("clientId" to id, "appSlug" to slug)); device = null; workspaces.clear(); cooldown = 0; return obj("ok" to true)
        }
        if (uri.path == "/api/auth/logout" && method == "POST") { store.write("session", null); device = null; workspaces.clear(); cooldown = 0; return obj("ok" to true) }
        if (uri.path == "/api/desktop/auth/cancel" && method == "POST") { device = null; return obj("ok" to true) }
        if (uri.path == "/api/desktop/auth/start" && method == "POST") {
            if (config == null) throw BackendError(400, "configuration", "Ange GitHub-appens Client ID och appnamn.")
            val result = oauth("device/code", mapOf("client_id" to config.getString("clientId")))
            if (result.has("error")) throw BackendError(400, "device-flow", "Kontrollera Client ID och aktivera Device flow i GitHub-appens inställningar.")
            val interval = max(1, result.getLong("interval")); val expires = now() + result.getLong("expires_in") * 1000
            device = obj("code" to result.getString("device_code"), "clientId" to config.getString("clientId"), "interval" to interval, "expiresAt" to expires, "nextPoll" to now() + interval * 1000)
            return obj("userCode" to result.getString("user_code"), "interval" to interval, "expiresAt" to expires)
        }
        if (uri.path == "/api/desktop/auth/poll" && method == "POST") {
            val pending = device ?: throw BackendError(400, "expired", "Starta inloggningen igen.")
            if (pending.getLong("expiresAt") <= now()) { device = null; throw BackendError(400, "expired", "Inloggningskoden har gått ut.") }
            if (now() < pending.getLong("nextPoll")) return obj("pending" to true, "interval" to max(1, (pending.getLong("nextPoll") - now() + 999) / 1000))
            val result = oauth("oauth/access_token", mapOf("client_id" to pending.getString("clientId"), "device_code" to pending.getString("code"), "grant_type" to "urn:ietf:params:oauth:grant-type:device_code"))
            if (result.optString("error") == "slow_down") pending.put("interval", pending.getLong("interval") + 5)
            pending.put("nextPoll", now() + pending.getLong("interval") * 1000)
            if (result.optString("error") in listOf("authorization_pending", "slow_down")) return obj("pending" to true, "interval" to pending.getLong("interval"))
            if (result.has("error") || result.optString("access_token").isEmpty()) { device = null; throw BackendError(400, "authentication", "Inloggningen godkändes inte. Försök igen.") }
            val token = result.getString("access_token"); val identity = json(token, "/user")
            val safeUser = obj("id" to positive(identity.getLong("id")), "login" to identity.getString("login"))
            store.write("session", obj("token" to token, "user" to safeUser, "expiresAt" to now() + min(max(1, result.optLong("expires_in", 28800)), 28800) * 1000))
            device = null; workspaces.clear(); return obj("pending" to false, "user" to safeUser)
        }
        if (!valid || session == null || user == null) throw BackendError(401, "authentication", "Logga in igen för att synka. Hämtade anteckningar fungerar lokalt.")
        val account = user.getLong("id"); val token = session.getString("token")
        if (query["account"] != null && query["account"] != account.toString()) throw BackendError(401, "account", "Kontot ändrades. Synkningen är pausad.")
        if (uri.path == "/api/repositories" && method == "GET") return repositories(token)
        if (uri.path == "/api/branches" && method == "GET") {
            val repo = authorize(token, query["repositoryId"]?.toLongOrNull() ?: 0, query["installationId"]?.toLongOrNull() ?: 0)
            val result = JSONArray(); var page = 1
            do { val batch = JSONArray(api(token, "/repos/${encPath(repo.getString("fullName"))}/branches?per_page=100&page=$page")); batch.objects().forEach { result.put(it.getString("name")) }; page++; if (page > 1000) throw BackendError(413, "limit", "För många grenar.") } while (batch.length() == 100)
            return result
        }
        if (uri.path == "/api/workspace/restore" && method == "POST") return obj("id" to register(account, body))
        if (uri.path == "/api/workspace" && method == "POST") {
            if (body.optString("mode", "repository") != "repository") throw BackendError(501, "wiki-unavailable", "Wiki stöds inte på Android ännu.")
            val repo = authorize(token, body.getLong("repositoryId"), body.getLong("installationId"))
            val workspace = obj("mode" to "repository", "repository" to repo, "branch" to branch(body.getString("branch")), "root" to path(body.getString("root"), true))
            return obj("id" to register(account, workspace), "workspace" to workspace, "notes" to notes(token, workspace))
        }
        if (uri.path == "/api/notes") {
            val (owner, workspace) = workspaces[query["workspace"]] ?: throw BackendError(400, "workspace", "Välj arbetsyta igen. Utkasten finns kvar.")
            if (owner != account) throw BackendError(401, "account", "Fel konto för arbetsytan.")
            val previous = workspace.getJSONObject("repository")
            workspace.put("repository", authorize(token, previous.getLong("id"), previous.getLong("installationId")))
            if (method == "GET") return query["path"]?.let { read(token, workspace, it) } ?: notes(token, workspace)
            if (method == "PUT") return save(token, workspace, body).put("savedAt", now())
            val files = body.getJSONArray("files").objects()
            if (files.size !in 1..2) throw BackendError(400, "validation", "Högst två filer per hämtning.")
            val entries = notes(token, workspace).objects().associateBy { it.getString("path") }
            return JSONArray(files.map { file ->
                val name = path(file.getString("path")); val entry = entries[name]
                try {
                    when {
                        entry == null -> obj("path" to name, "note" to absent(name))
                        !file.isNull("sha") && file.getString("sha") == entry.getString("sha") -> obj("path" to name, "unchanged" to true)
                        else -> obj("path" to name, "note" to blob(token, workspace, entry))
                    }
                } catch (error: BackendError) { if (error.status !in listOf(400, 413, 422)) throw error; obj("path" to name, "error" to error.message) }
            })
        }
        throw BackendError(404, "endpoint", "Appanropet finns inte.")
    }
}
