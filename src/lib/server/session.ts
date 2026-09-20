import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cookies } from "next/headers";
import { workspaceKey, type User, type Workspace } from "@/lib/types";
import { AppError } from "./errors";
import { appUrl } from "./config";

export type Session = { token: string; user: User; expiresAt: number };
const COOKIE = "gitbsidian_session";
let database: DatabaseSync | undefined;
function db() {
  if (!database) {
    const file = resolve(/* turbopackIgnore: true */ process.env.SESSION_DB_PATH || ".data/sessions.sqlite");
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS workspaces (session_id TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(session_id, id));");
  }
  return database;
}
function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !/^[a-f\d]{64}$/i.test(secret)) throw new AppError(503, "configuration", "Serverns sessionsnyckel behöver konfigureras.");
  return Buffer.from(secret, "hex");
}
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64url");
}
export function unseal<T>(value: string): T {
  const buffer = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"));
}
const hash = (id: string) => createHash("sha256").update(id).digest("hex");
export const cookieOptions = () => ({ httpOnly: true, secure: appUrl().startsWith("https:"), sameSite: "lax" as const, path: "/" });
export async function createSession(session: Session) {
  await destroySession();
  const id = randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db().exec("DELETE FROM workspaces WHERE session_id NOT IN (SELECT id FROM sessions)");
  db().prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(hash(id), seal(session), session.expiresAt);
  (await cookies()).set(COOKIE, id, { ...cookieOptions(), maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) });
}
async function sessionId() { return (await cookies()).get(COOKIE)?.value; }
export async function getSession(): Promise<Session | null> {
  const id = await sessionId();
  if (!id || !/^[\w-]{43}$/.test(id)) return null;
  const row = db().prepare("SELECT value, expires FROM sessions WHERE id = ?").get(hash(id)) as { value: string; expires: number } | undefined;
  if (!row || row.expires <= Date.now()) return null;
  try { return unseal<Session>(row.value); } catch { return null; }
}
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AppError(401, "authentication", "Logga in igen. Dina lokala utkast finns kvar.");
  return session;
}
export async function destroySession() {
  const id = await sessionId();
  if (id) {
    db().prepare("DELETE FROM workspaces WHERE session_id = ?").run(hash(id));
    db().prepare("DELETE FROM sessions WHERE id = ?").run(hash(id));
  }
  (await cookies()).delete(COOKIE);
}
export async function storeWorkspace(workspace: Workspace): Promise<string> {
  const id = await sessionId();
  if (!id) throw new AppError(401, "authentication", "Logga in igen.");
  const workspaceId = hash(workspaceKey(workspace)).slice(0, 32);
  db().prepare("INSERT OR REPLACE INTO workspaces VALUES (?, ?, ?)").run(hash(id), workspaceId, seal(workspace));
  return workspaceId;
}
export async function getWorkspace(workspaceId: string): Promise<Workspace> {
  const id = await sessionId();
  const row = id && /^[a-f\d]{32}$/.test(workspaceId) ? db().prepare("SELECT value FROM workspaces WHERE session_id = ? AND id = ?").get(hash(id), workspaceId) as { value: string } | undefined : undefined;
  if (!row) throw new AppError(400, "workspace", "Välj repository och gren igen. Utkasten finns kvar.");
  return unseal<Workspace>(row.value);
}
