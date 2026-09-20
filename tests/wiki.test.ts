import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WikiGit, gitCommand, gitEnvironment, wikiRemote, type GitCommand } from "@/lib/server/wiki-git";
import { AppError } from "@/lib/server/errors";
import { saveVersion } from "@/lib/server/save";
import { draftKey, workspaceKey, type Repository } from "@/lib/types";
import { selectionSchema, wikiPathSchema } from "@/lib/validation";

const repository: Repository = { id: 1, fullName: "owner/notes", installationId: 2, defaultBranch: "main", private: true };
const user = { id: 123, login: "test-user" };
const run = gitCommand("");
const identity = { GIT_AUTHOR_NAME: user.login, GIT_COMMITTER_NAME: user.login, GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const testsRoot = resolve(".data/wiki-tests");
let directory = ""; let remote = ""; let temporary = ""; let initial = "";
let command: GitCommand;
const instances: WikiGit[] = [];
async function commitFiles(files: { path: string; text: string; mode?: string }[], parent?: string) {
  await run(remote, parent ? ["read-tree", parent] : ["read-tree", "--empty"]);
  for (const file of files) {
    const sha = (await run(remote, ["hash-object", "-w", "--stdin"], file.text)).toString().trim();
    await run(remote, ["update-index", "-z", "--index-info"], `${file.mode || "100644"} ${sha}\t${file.path}\0`);
  }
  const tree = (await run(remote, ["write-tree"])).toString().trim();
  const commit = (await run(remote, ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], "Fixture\n", identity)).toString().trim();
  await run(remote, ["update-ref", "refs/heads/wiki-pages", commit]);
  return commit;
}
function wiki(runner = command, branch?: string) { const wiki = new WikiGit(repository, user, runner, branch); instances.push(wiki); return wiki; }
beforeEach(async () => {
  await mkdir(testsRoot, { recursive: true }); directory = await mkdtemp(join(testsRoot, "run-"));
  remote = join(directory, "remote.git"); temporary = join(directory, "requests");
  await mkdir(remote); await run(remote, ["init", "--bare", "--quiet"]);
  await run(remote, ["symbolic-ref", "HEAD", "refs/heads/wiki-pages"]);
  initial = await commitFiles([{ path: "Home.md", text: "# Original\n" }, { path: "image.bin", text: "keep-this-byte-for-byte" }]);
  vi.stubEnv("WIKI_TEMP_DIR", temporary);
  command = (cwd, args, stdin, env) => run(cwd, ["-c", "protocol.file.allow=always", ...args.map(arg => arg === wikiRemote(repository) ? pathToFileURL(remote).href : arg)], stdin, env);
}, 30_000);
afterEach(async () => {
  await Promise.all(instances.splice(0).map(wiki => wiki.dispose())); vi.unstubAllEnvs();
  if (directory && dirname(resolve(directory)) === testsRoot) await rm(directory, { recursive: true, force: true });
});
describe("Wiki Git transport using real local bare repositories", () => {
  it("discovers the actual default branch and reads exact UTF-8 including BOM and CRLF", async () => {
    const text = "\ufeff# Årets idéer\r\n\n[[okänd syntax]]";
    await commitFiles([{ path: "Årets idéer.md", text }], initial);
    const client = wiki(); const opened = await client.open();
    expect(opened.branch).toBe("wiki-pages"); expect(opened.notes.map(n => n.path)).toEqual(["Home.md", "Årets idéer.md"]);
    expect((await client.read("Årets idéer.md")).text).toBe(text);
  }, 30_000);
  it("creates and updates pages without changing sibling objects, and cleans its private object store", async () => {
    const client = wiki(); const before = (await run(remote, ["rev-parse", "HEAD:image.bin"])).toString();
    const input = { path: "Min idé.md", text: "# Åäö\r\n\n", baseSha: null };
    const saved = await saveVersion(input, () => client.read(input.path), () => client.write(input));
    expect(saved.sha).toMatch(/^[a-f0-9]{40}$/); expect((await client.read(input.path)).text).toBe(input.text);
    expect((await run(remote, ["rev-parse", "HEAD:image.bin"])).toString()).toBe(before);
    const updated = { ...input, text: input.text + "Ny rad.", baseSha: saved.sha };
    await saveVersion(updated, () => client.read(input.path), () => client.write(updated));
    expect((await client.read(input.path)).text).toBe(updated.text);
    await client.dispose(); expect(await readdir(temporary)).toEqual([]);
  }, 30_000);
  it("turns a simultaneous change of the same page into a conflict", async () => {
    const first = wiki(); const second = wiki(); const base = await first.read("Home.md"); await second.read("Home.md");
    await first.write({ ...base, text: "# First", baseSha: base.sha });
    const input = { ...base, text: "# Second", baseSha: base.sha };
    await expect(saveVersion(input, () => second.read(input.path), () => second.write(input))).rejects.toMatchObject({ code: "conflict", details: { text: "# First" } });
  }, 30_000);
  it("rejects a branch change after preflight, including unrelated pages", async () => {
    const client = wiki(); const base = await client.read("Home.md");
    const next = await commitFiles([{ path: "Elsewhere.md", text: "External" }], initial);
    await expect(client.write({ path: base.path, baseSha: base.sha, text: "# Mine" })).rejects.toMatchObject({ code: "wiki-race" });
    expect((await run(remote, ["rev-parse", "HEAD"])).toString().trim()).toBe(next);
  }, 30_000);
  it("rejects a remote rewind even when Git would consider our push fast-forward", async () => {
    await commitFiles([{ path: "Elsewhere.md", text: "Removed by external reset" }], initial);
    const client = wiki(); const base = await client.read("Home.md");
    await run(remote, ["update-ref", "refs/heads/wiki-pages", initial]);
    await expect(client.write({ path: base.path, baseSha: base.sha, text: "# Mine" })).rejects.toMatchObject({ code: "wiki-race" });
    expect((await run(remote, ["rev-parse", "HEAD"])).toString().trim()).toBe(initial);
  }, 30_000);
  it("recovers a successful push whose response was lost without creating another commit", async () => {
    let pushes = 0;
    const client = wiki(async (...args) => { const result = await command(...args); if (args[1].includes("push")) { pushes++; throw new AppError(503, "network", "lost response"); } return result; });
    const base = await client.read("Home.md"); const input = { path: base.path, baseSha: base.sha, text: "# Saved once" };
    expect((await saveVersion(input, () => client.read(input.path), () => client.write(input))).text).toBe(input.text);
    expect(pushes).toBe(1);
  }, 30_000);
  it("rejects symlinks, colliding titles and changed default branch", async () => {
    await commitFiles([{ path: "Alias.md", text: "Home.md", mode: "120000" }, { path: "My-Page.textile", text: "Other markup" }], initial);
    const client = wiki(); expect((await client.open()).notes.some(n => n.path === "Alias.md")).toBe(false);
    await expect(client.read("Alias.md")).rejects.toMatchObject({ code: "wiki-file-type" });
    await client.read("My Page.md");
    await expect(client.write({ path: "My Page.md", text: "new", baseSha: null })).rejects.toMatchObject({ code: "wiki-title-collision" });
    await expect(wiki(command, "main").open()).rejects.toMatchObject({ code: "wiki-default-changed" });
  }, 30_000);
  it("explains an uninitialized Wiki", async () => {
    await run(remote, ["update-ref", "-d", "refs/heads/wiki-pages"]);
    await expect(wiki().open()).rejects.toMatchObject({ code: "wiki-uninitialized" });
  }, 30_000);
});
it("isolates modes while keeping legacy repository draft keys", () => {
  const workspace = { repository, branch: "main", root: "" };
  expect(workspaceKey(workspace)).toBe(workspaceKey({ ...workspace, mode: "repository" }));
  expect(draftKey("123", workspaceKey(workspace), "Home.md")).not.toBe(draftKey("123", workspaceKey({ ...workspace, mode: "wiki" }), "Home.md"));
  expect(selectionSchema.safeParse({ mode: "wiki", repositoryId: 1, installationId: 2, branch: "main" }).success).toBe(false);
  expect(wikiPathSchema.safeParse("Folder/Page.md").success).toBe(false);
  expect(() => wikiRemote({ ...repository, fullName: "https://evil.invalid/a" })).toThrow();
});
it("keeps credentials out of Git arguments, disk configuration and inherited trace settings", () => {
  vi.stubEnv("GIT_TRACE", "1"); vi.stubEnv("GIT_CONFIG", "untrusted"); vi.stubEnv("NODE_OPTIONS", "--inspect");
  const env = gitEnvironment("test-secret", directory);
  expect(env.GIT_TRACE).toBeUndefined(); expect(env.GIT_CONFIG).toBeUndefined(); expect(env.NODE_OPTIONS).toBeUndefined();
  expect(env.GIT_CONFIG_GLOBAL).toBe(process.platform === "win32" ? "NUL" : "/dev/null");
  const configs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  expect(configs).toContainEqual(["credential.helper", ""]);
  expect(configs).toContainEqual(["http.followRedirects", "false"]);
});
