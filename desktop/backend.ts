import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z, ZodError } from "zod";
import { GitHub } from "@/lib/server/github";
import { AppError } from "@/lib/server/errors";
import { WikiGit, gitCommand, wikiAvailability } from "@/lib/server/wiki-git";
import { storageFor } from "@/lib/server/storage";
import { saveVersion } from "@/lib/server/save";
import { pathSchema, saveSchema, selectionSchema, workspaceSchema } from "@/lib/validation";
import { offlineBatch, offlineSchema } from "@/lib/server/offline";
import { workspaceKey, type Workspace } from "@/lib/types";
import type { Session } from "@/lib/server/session";

const dataDir = resolve(process.argv[2]);
process.env.WIKI_TEMP_DIR = join(dataDir, "wiki-tmp");
if (process.platform === "win32") {
  const git = join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe");
  if (existsSync(git)) process.env.GIT_EXECUTABLE = git;
}
const configSchema = z.object({ clientId: z.string().regex(/^[a-zA-Z0-9_.-]{4,100}$/), appSlug: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/) });
const sessionSchema = z.object({ token: z.string().min(1), user: z.object({ id: z.number().int().positive(), login: z.string() }), expiresAt: z.number() });
let device: { clientId: string; code: string; expiresAt: number; nextPoll: number; interval: number } | undefined;
const workspaces = new Map<string, { account: number; workspace: Workspace }>();
type Reply = { status: number; data: unknown; session?: Session; clear_session?: boolean };
const ok = (data: unknown): Reply => ({ status: 200, data });
async function configuration() {
  try { return configSchema.parse(JSON.parse(await readFile(join(dataDir, "github.json"), "utf8"))); } catch { return null; }
}
async function oauth(endpoint: "device/code" | "oauth/access_token", values: Record<string, string>) {
  let response: Response;
  try { response = await fetch(`https://github.com/login/${endpoint}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) }); }
  catch { throw new AppError(503, "network", "Kunde inte nå GitHub. Kontrollera anslutningen."); }
  if (!response.ok) throw new AppError(502, "oauth", "GitHub kunde inte slutföra inloggningen.");
  return response.json();
}
function register(session: Session, workspace: Workspace) {
  const id = createHash("sha256").update(`${session.user.id}:${workspaceKey(workspace)}`).digest("hex");
  workspaces.set(id, { account: session.user.id, workspace });
  return id;
}
async function handle(raw: unknown): Promise<Reply> {
  const input = z.object({ request: z.object({ url: z.string().max(4096), method: z.enum(["GET", "POST", "PUT"]), body: z.unknown().optional() }), session: z.unknown().optional() }).parse(raw);
  const { method, body } = input.request;
  const url = new URL(input.request.url, "https://app.invalid");
  if (url.origin !== "https://app.invalid") throw new AppError(400, "url", "Ogiltigt appanrop.");
  const parsed = sessionSchema.safeParse(input.session);
  const session = parsed.success && parsed.data.expiresAt > Date.now() ? parsed.data : null;
  if (url.pathname === "/api/session" && method === "GET") {
    const config = await configuration();
    return ok({ user: session?.user || null, localUser: parsed.success ? parsed.data.user : null, configuration: { ready: !!config, missing: config ? [] : ["GitHub App Client ID"], installUrl: config ? `https://github.com/apps/${config.appSlug}/installations/new` : null }, storage: { wiki: await wikiAvailability() }, settings: config });
  }
  if (url.pathname === "/api/desktop/config" && method === "POST") {
    const settings = configSchema.parse(body); device = undefined; workspaces.clear();
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "github.json"), JSON.stringify(settings), { mode: 0o600 });
    return { ...ok({ ok: true }), clear_session: true };
  }
  if (url.pathname === "/api/auth/logout" && method === "POST") { device = undefined; workspaces.clear(); return { ...ok({ ok: true }), clear_session: true }; }
  if (url.pathname === "/api/desktop/auth/cancel" && method === "POST") { device = undefined; return ok({ ok: true }); }
  if (url.pathname === "/api/desktop/auth/start" && method === "POST") {
    const config = await configuration();
    if (!config) throw new AppError(400, "configuration", "Ange GitHub-appens Client ID och appnamn först.");
    const result = await oauth("device/code", { client_id: config.clientId });
    if (result.error) throw new AppError(400, "device-flow", "Kontrollera Client ID och aktivera Device flow i GitHub-appens inställningar.");
    const data = z.object({ device_code: z.string(), user_code: z.string(), expires_in: z.number().positive(), interval: z.number().positive() }).parse(result);
    device = { clientId: config.clientId, code: data.device_code, expiresAt: Date.now() + data.expires_in * 1000, nextPoll: Date.now() + data.interval * 1000, interval: data.interval };
    return ok({ userCode: data.user_code, interval: data.interval, expiresAt: device.expiresAt });
  }
  if (url.pathname === "/api/desktop/auth/poll" && method === "POST") {
    if (!device || device.expiresAt <= Date.now()) { device = undefined; throw new AppError(400, "expired", "Inloggningskoden har gått ut. Starta inloggningen igen."); }
    if (Date.now() < device.nextPoll) return ok({ pending: true, interval: Math.max(1, Math.ceil((device.nextPoll - Date.now()) / 1000)) });
    device.nextPoll = Date.now() + device.interval * 1000;
    const result = await oauth("oauth/access_token", { client_id: device.clientId, device_code: device.code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
    if (result.error === "slow_down") { device.interval += 5; device.nextPoll = Date.now() + device.interval * 1000; return ok({ pending: true, interval: device.interval }); }
    if (result.error === "authorization_pending") return ok({ pending: true, interval: device.interval });
    if (result.error || !result.access_token) { device = undefined; throw new AppError(400, "authentication", "Inloggningen godkändes inte eller koden gick ut. Försök igen."); }
    const token = z.string().min(1).parse(result.access_token);
    const user = z.object({ id: z.number().int().positive(), login: z.string() }).parse(await new GitHub(token).request("/user"));
    const expiresAt = Date.now() + Math.min(Number(result.expires_in) || 28800, 28800) * 1000;
    device = undefined; workspaces.clear();
    return { ...ok({ pending: false, user }), session: { token, user, expiresAt } };
  }
  if (!session) throw new AppError(401, "authentication", "Logga in igen. Dina lokala utkast finns kvar.");
  const expectedAccount = url.searchParams.get("account");
  if (expectedAccount && expectedAccount !== String(session.user.id)) throw new AppError(401, "account", "Kontot ändrades. Synkningen har pausats.");
  const github = new GitHub(session.token);
  if (url.pathname === "/api/repositories" && method === "GET") return ok(await github.repositories());
  if (url.pathname === "/api/branches" && method === "GET") {
    const repo = await github.authorize(z.coerce.number().int().positive().parse(url.searchParams.get("repositoryId")), z.coerce.number().int().positive().parse(url.searchParams.get("installationId")));
    return ok(await github.branches(repo));
  }
  if (["/api/desktop/workspace/restore", "/api/workspace/restore"].includes(url.pathname) && method === "POST") {
    // Offline registration is not authorization: every subsequent GitHub operation checks membership.
    const workspace = workspaceSchema.parse(body);
    if (workspace.mode === "wiki" && workspace.root) throw new AppError(400, "wiki-root", "Wiki använder inga undermappar.");
    return ok({ id: register(session, workspace) });
  }
  if (url.pathname === "/api/workspace" && method === "POST") {
    const selected = selectionSchema.parse(body);
    const repository = await github.authorize(selected.repositoryId, selected.installationId);
    if (selected.mode === "wiki") {
      const capability = await wikiAvailability();
      if (!capability.available) throw new AppError(503, "wiki-unavailable", capability.reason!);
      await github.authorizeWiki(repository);
      const wiki = new WikiGit(repository, session.user, gitCommand(session.token));
      try {
        const { notes, branch } = await wiki.open();
        const workspace: Workspace = { mode: "wiki", repository, branch, root: "" };
        return ok({ id: register(session, workspace), workspace, notes });
      } finally { await wiki.dispose(); }
    }
    const workspace: Workspace = { mode: "repository", repository, branch: selected.branch, root: selected.root };
    return ok({ id: register(session, workspace), workspace, notes: await github.notes(workspace) });
  }
  if (url.pathname === "/api/notes" && ["GET", "POST", "PUT"].includes(method)) {
    const record = workspaces.get(url.searchParams.get("workspace") || "");
    if (!record || record.account !== session.user.id) throw new AppError(400, "workspace", "Välj arbetsytan igen. Dina utkast finns kvar.");
    const workspace = record.workspace;
    workspace.repository = await github.authorize(workspace.repository.id, workspace.repository.installationId);
    const storage = await storageFor(session, workspace, github, method === "PUT");
    try {
      if (method === "POST") return ok(await offlineBatch(storage, github, workspace, offlineSchema.parse(body)));
      if (method === "GET") { const path = url.searchParams.get("path"); return ok(path === null ? await storage.notes() : await storage.read(pathSchema.parse(path))); }
      const save = saveSchema.parse(body);
      return ok({ ...await saveVersion(save, () => storage.read(save.path), () => storage.write(save)), savedAt: Date.now() });
    } finally { await storage.dispose(); }
  }
  throw new AppError(404, "endpoint", "Appanropet finns inte.");
}

// One private stdin/stdout channel, no listening network port. Sequential messages serialize writes.
async function main() {
 const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
 for await (const line of lines) {
  let reply: Reply;
  try {
    if (Buffer.byteLength(line) > 3 * 1024 * 1024) throw new AppError(413, "size", "Anropet är för stort.");
    reply = await handle(JSON.parse(line));
  } catch (error) {
    reply = error instanceof AppError ? { status: error.status, data: { code: error.code, error: error.message, details: error.details, retryAfter: error.retryAfter } }
      : error instanceof ZodError ? { status: 400, data: { code: "validation", error: error.issues[0]?.message || "Ogiltig inmatning." } }
      : { status: 500, data: { code: "desktop", error: "Appanropet kunde inte slutföras. Ditt utkast finns kvar." } };
  }
  process.stdout.write(JSON.stringify(reply) + "\n");
 }
}
void main();
