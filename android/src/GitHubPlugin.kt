package se.gitbsidian.mobile

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.net.URL
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

internal class GitHubHttps : HttpTransport {
    override fun request(url: String, method: String, headers: Map<String, String>, body: String?): HttpReply {
        val target = URL(url)
        require(target.protocol == "https" && target.host in listOf("api.github.com", "github.com") && target.port == -1 && target.userInfo == null)
        val connection = target.openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = method; connection.instanceFollowRedirects = false
            connection.connectTimeout = 20000; connection.readTimeout = 20000; connection.useCaches = false
            connection.setRequestProperty("User-Agent", "gitbsidian-android-prototype")
            for ((name, value) in headers) connection.setRequestProperty(name, value)
            if (body != null) { connection.doOutput = true; connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) } }
            val status = connection.responseCode
            val output = ByteArrayOutputStream()
            (if (status >= 400) connection.errorStream else connection.inputStream)?.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    if (output.size() + count > 8 * 1024 * 1024) throw BackendError(413, "response-limit", "GitHubs svar är för stort för Android-prototypen.")
                    output.write(buffer, 0, count)
                }
            }
            return HttpReply(status, output.toString("UTF-8"), connection.headerFields.filterKeys { it != null }.mapValues { it.value.firstOrNull() ?: "" })
        } finally { connection.disconnect() }
    }
}

@TauriPlugin
class GitHubPlugin(private val activity: Activity) : Plugin(activity) {
    private val executor = Executors.newSingleThreadExecutor()
    private val backend by lazy { GitHubBackend(AndroidPrivateStore(activity), GitHubHttps()) }
    @Command
    fun request(invoke: Invoke) {
        executor.execute {
            try { invoke.resolve(JSObject(backend.request(invoke.getArgs().getJSONObject("request")).toString())) }
            catch (_: Exception) { invoke.reject("Android-anropet misslyckades. Utkastet finns kvar.") }
        }
    }
    @Command
    fun exportMarkdown(invoke: Invoke) {
        val args = invoke.getArgs(); val name = args.getString("name"); val text = args.getString("text")
        if (name == null || text == null || name.length > 240 || name.any { it in "/\\\u0000" } || text.toByteArray(Charsets.UTF_8).size > 1024 * 1024) { invoke.reject("Ogiltigt filnamn eller för stor anteckning."); return }
        // Storage Access Framework: only the user-selected document is writable.
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = if (name.endsWith(".csv", true)) "text/csv" else "text/markdown"; putExtra(Intent.EXTRA_TITLE, name) }
        startActivityForResult(invoke, intent, "exportResult")
    }
    @ActivityCallback
    private fun exportResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject().put("saved", false)); return }
        executor.execute {
            try {
                val stream = activity.contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException()
                stream.use { it.write(invoke.getArgs().getString("text")!!.toByteArray(Charsets.UTF_8)) }
                invoke.resolve(JSObject().put("saved", true))
            } catch (_: Exception) { invoke.reject("Kunde inte exportera anteckningen. Utkastet finns kvar.") }
        }
    }
}
