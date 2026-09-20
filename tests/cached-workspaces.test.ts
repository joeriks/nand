import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recentWorkspace, rememberWorkspace } from "@/lib/cached-workspaces";
import { cacheKey, readWorkspace, writeWorkspace } from "@/lib/drafts";
import { workspaceKey, type Workspace } from "@/lib/types";

const user = { id: 482, login: "selection-test" };
const repository = { id: 47, installationId: 3, fullName: "test/notes", defaultBranch: "main", private: true };
const repo: Workspace = { repository, branch: "drafts", root: "Notes", mode: "repository" };
const wiki: Workspace = { repository, branch: "master", root: "", mode: "wiki" };
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
describe("last explicit workspace selection", () => {
  it("keeps Wiki selected when a repository cache is refreshed later", async () => {
    await rememberWorkspace(user, { id: "repo", workspace: repo, notes: [] });
    await rememberWorkspace(user, { id: "wiki", workspace: wiki, notes: [] });
    const cached = (await readWorkspace(cacheKey(String(user.id), workspaceKey(repo))))!;
    await writeWorkspace({ ...cached, checkedAt: Date.now() + 100000 });
    expect(await recentWorkspace(user)).toEqual({ id: "", workspace: wiki, notes: [] });
  });
  it("does not infer a choice from cached workspaces or another account", async () => {
    expect(await recentWorkspace(user)).toBeNull();
    await rememberWorkspace(user, { id: "repo", workspace: repo, notes: [] });
    expect(await recentWorkspace({ ...user, id: 483 })).toBeNull();
  });
  it("retains a complete descriptor independently of the cache", async () => {
    localStorage.setItem(`gitbsidian-selection-${user.id}`, JSON.stringify({ version: 1, workspace: { ...repo, root: "Uncached" } }));
    expect(await recentWorkspace(user)).toEqual({ id: "", workspace: { ...repo, root: "Uncached" }, notes: [] });
  });
  it("does not replace the previous selection when persistence fails", async () => {
    await rememberWorkspace(user, { id: "wiki", workspace: wiki, notes: [] });
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new Error("Disk full"); });
    await expect(rememberWorkspace(user, { id: "repo", workspace: repo, notes: [] })).rejects.toThrow("Disk full");
    spy.mockRestore();
    expect((await recentWorkspace(user))?.workspace).toEqual(wiki);
  });
  it("ignores an open completed after logout or another selection", async () => {
    await rememberWorkspace(user, { id: "wiki", workspace: wiki, notes: [] });
    await rememberWorkspace(user, { id: "repo", workspace: repo, notes: [] }, () => false);
    expect((await recentWorkspace(user))?.workspace).toEqual(wiki);
  });
  it("migrates the explicit 0.2 pointer and reports missing metadata instead of guessing", async () => {
    await writeWorkspace({ key: cacheKey(String(user.id), workspaceKey(repo)), account: String(user.id), workspace: repo, notes: [], checkedAt: 1, unavailable: {} });
    localStorage.setItem(`gitbsidian-last-${user.id}`, cacheKey(String(user.id), workspaceKey(repo)));
    expect((await recentWorkspace(user))?.workspace).toEqual(repo);
    localStorage.setItem(`gitbsidian-last-${user.id}`, "missing-cache");
    await expect(recentWorkspace(user)).rejects.toThrow("beskrivning saknas");
  });
  it("rejects a legacy pointer to another account", async () => {
    await writeWorkspace({ key: cacheKey(String(user.id), workspaceKey(repo)), account: String(user.id), workspace: repo, notes: [], checkedAt: 1, unavailable: {} });
    localStorage.setItem("gitbsidian-last-483", cacheKey(String(user.id), workspaceKey(repo)));
    await expect(recentWorkspace({ ...user, id: 483 })).rejects.toThrow("beskrivning saknas");
  });
});
