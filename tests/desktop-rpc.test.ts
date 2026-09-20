import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(".data/desktop-tests");
const directories: string[] = []; const children: ChildProcessWithoutNullStreams[] = [];
async function backend() {
  await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, "run-")); directories.push(directory);
  const script = join(directory, "backend.cjs");
  await build({ entryPoints: ["desktop/backend.ts"], outfile: script, bundle: true, platform: "node", format: "cjs", target: "node24", logLevel: "silent" });
  const child = spawn(process.execPath, [script, directory], { windowsHide: true, stdio: "pipe", env: { ...process.env, WIKI_ENABLED: "false" } }); children.push(child);
  const iterator = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return {
    directory,
    async request(url: string, method = "GET", body: unknown = null, session: unknown = null) {
      child.stdin.write(JSON.stringify({ request: { url, method, body }, session }) + "\n");
      const next = await iterator.next(); if (next.done) throw new Error("Backend exited"); return JSON.parse(next.value);
    },
  };
}
afterEach(async () => {
  for (const child of children.splice(0)) { const exited = new Promise(resolve => child.once("exit", resolve)); child.stdin.end(); if (child.exitCode === null) await exited; }
  for (const directory of directories.splice(0)) if (dirname(directory) === root) await rm(directory, { recursive: true, force: true });
});
describe("packaged desktop private RPC", () => {
  it("starts offline without configuration, persists only public settings and never exposes a token", async () => {
    const app = await backend();
    expect((await app.request("/api/session")).data).toMatchObject({ user: null, configuration: { ready: false } });
    const config = { clientId: "test-public-id", appSlug: "test-app" };
    expect(await app.request("/api/desktop/config", "POST", config)).toMatchObject({ status: 200, clear_session: true });
    expect(JSON.parse(await readFile(join(app.directory, "github.json"), "utf8"))).toEqual(config);
    const secret = "test-only-not-a-real-token";
    const session = { token: secret, user: { id: 1, login: "test" }, expiresAt: Date.now() + 100000 };
    const result = await app.request("/api/session", "GET", null, session);
    expect(result.data.user.login).toBe("test"); expect(JSON.stringify(result)).not.toContain(secret);
    expect(await app.request("/api/auth/logout", "POST")).toMatchObject({ clear_session: true });
  }, 30_000);
  it("refuses unauthorized and arbitrary network routes before making a network call", async () => {
    const app = await backend();
    expect(await app.request("/api/notes?workspace=guess&path=Home.md")).toMatchObject({ status: 401 });
    expect(await app.request("https://example.invalid/api/session")).toMatchObject({ status: 400 });
    expect(await app.request("/api/desktop/auth/start", "POST")).toMatchObject({ status: 400, data: { code: "configuration" } });
    expect(await app.request("/api/desktop/config", "POST", { clientId: "x", appSlug: "../bad" })).toMatchObject({ status: 400 });
  }, 30_000);
  it("keeps an expired credential's local identity but refuses every network operation", async () => {
    const app = await backend();
    const session = { token: "synthetic-expired-token", user: { id: 91, login: "expired" }, expiresAt: Date.now() - 1 };
    const result = await app.request("/api/session", "GET", null, session);
    expect(result.data).toMatchObject({ user: null, localUser: { id: 91, login: "expired" } });
    expect(JSON.stringify(result)).not.toContain(session.token);
    for (const [url, method] of [["/api/repositories", "GET"], ["/api/workspace/restore?account=91", "POST"], ["/api/notes?workspace=none&account=91", "GET"], ["/api/notes?workspace=none&account=91", "PUT"], ["/api/notes?workspace=none&account=91", "POST"]]) {
      expect(await app.request(url, method, {}, session)).toMatchObject({ status: 401 });
    }
    const valid = { ...session, expiresAt: Date.now() + 10000 };
    expect(await app.request("/api/notes?workspace=none&account=92", "GET", null, valid)).toMatchObject({ status: 401, data: { code: "account" } });
  }, 30_000);
});
