import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/client-api";
import { DraftStore, newDraft, readWorkspace, cacheKey } from "@/lib/drafts";
import { WorkspaceSync } from "@/lib/workspace-sync";
import { dirty, workspaceKey, type RemoteNote } from "@/lib/types";
import { offlineBatch } from "@/lib/server/offline";
import type { GitHub } from "@/lib/server/github";
import { AppError } from "@/lib/server/errors";

const workspace = { repository: { id: 1, fullName: "a/b", installationId: 2, private: true, defaultBranch: "main" }, root: "Notes", branch: "main" };
let number = 1000;
function fixture(mode: "repository" | "wiki" = "repository") {
  const account = String(number++);
  const selected = { ...workspace, mode, root: mode === "wiki" ? "" : "Notes" };
  const scope = workspaceKey(selected);
  const files = new Map<string, RemoteNote>(["a.md", mode === "wiki" ? "b.md" : "Nested/b.md"].map(path => [path, { path, text: `# ${path}`, sha: "a".repeat(40) }]));
  const state = { authenticated: true, online: true, allowed: true, puts: 0, blobs: 0, lost: false, failPath: "", beforeWrite: async () => {} };
  const store = new DraftStore();
  const request = vi.fn(async (url: string, method = "GET", body?: unknown) => {
    if (url === "/api/session") return { user: state.authenticated ? { id: Number(account), login: "test" } : null };
    if (!state.authenticated) throw new ApiError(401, "authentication", "Logga in");
    if (url.startsWith("/api/workspace/restore")) return { id: "restored" };
    const parsed = new URL(url, "https://test");
    if (method === "GET") return parsed.searchParams.has("path") ? files.get(parsed.searchParams.get("path")!) || { path: parsed.searchParams.get("path"), sha: null, text: "" } : [...files.values()].map(file => ({ path: file.path, sha: file.sha, size: file.text.length }));
    if (method === "POST") {
      const input = body as { files: { path: string; sha: string | null }[] };
      return input.files.map(file => {
        if (file.path === state.failPath) return { path: file.path, error: "Felaktig UTF-8" };
        const note = files.get(file.path)!;
        if (note.sha === file.sha) return { path: file.path, unchanged: true };
        state.blobs++; return { path: file.path, note };
      });
    }
    const input = body as { path: string; text: string; baseSha: string | null };
    state.puts++; await state.beforeWrite();
    const current = files.get(input.path);
    if ((current?.sha || null) !== input.baseSha) throw new ApiError(409, "conflict", "Konflikt", current || { path: input.path, text: "", sha: null });
    const saved = { path: input.path, text: input.text, sha: String(state.puts).padStart(40, "b") };
    files.set(input.path, saved);
    if (state.lost) { state.lost = false; throw new ApiError(0, "network", "Förlorat svar"); }
    return { ...saved, savedAt: Date.now() };
  }) as unknown as typeof api;
  function runner(current = store) {
    return new WorkspaceSync({ account, workspace: selected, store: current, notes: [], allowed: () => state.allowed, owns: () => true, online: () => state.online, request, lock: async (_name, action) => action() });
  }
  async function edit(path: string, text: string) {
    const draft = newDraft(account, scope, files.get(path)!);
    store.set({ ...draft, text, updatedAt: Date.now() - 3000 }); await store.flush(); return draft.key;
  }
  return { account, scope, files, state, store, runner, edit, request };
}
afterEach(() => vi.restoreAllMocks());
describe("durable offline collection and outbox", () => {
  it("yields large downloads between chunks and resumes the rest without repeated blobs", async () => {
    const f = fixture();
    for (let i = 0; i < 25; i++) f.files.set(`Extra-${i}.md`, { path: `Extra-${i}.md`, text: "extra", sha: "d".repeat(40) });
    const sync = f.runner(); await sync.tick(); expect(f.store.values()).toHaveLength(20);
    const key = f.store.values()[0].key;
    f.store.update(key, draft => ({ ...draft, text: "Edited between chunks", updatedAt: Date.now() - 3000 }));
    await sync.tick(); expect(f.state.puts).toBe(1); expect(f.store.values()).toHaveLength(27); expect(f.state.blobs).toBe(27);
  });
  it.each(["repository", "wiki"] as const)("downloads every supported %s note and avoids unchanged blobs", async mode => {
    const f = fixture(mode); const sync = f.runner();
    await sync.tick(); expect(f.store.values()).toHaveLength(2); expect(f.state.blobs).toBe(2);
    await sync.tick(true, true); expect(f.state.blobs).toBe(2);
    const cache = await readWorkspace(cacheKey(f.account, f.scope)); expect(cache?.notes).toHaveLength(2);
    const reloaded = new DraftStore(); await reloaded.load(f.account, f.scope); expect(reloaded.values()).toHaveLength(2);
  });
  it("preserves a partially downloaded collection and retries missing files", async () => {
    const f = fixture(); f.state.failPath = "Nested/b.md"; const sync = f.runner();
    await sync.tick(); expect(f.store.values()).toHaveLength(1); expect(sync.state.cache.unavailable["Nested/b.md"]).toContain("UTF-8");
    f.state.failPath = ""; await sync.tick(true, true);
    expect(f.store.values()).toHaveLength(2); expect(f.state.blobs).toBe(2); expect(sync.state.cache.unavailable).toEqual({});
  });
  it("edits after token expiry and resumes a durable queue from a new store", async () => {
    const f = fixture(); await f.runner().tick(); f.state.authenticated = false;
    const key = await f.edit("a.md", "Offline efter utgången token");
    const restarted = new DraftStore(); await restarted.load(f.account, f.scope); const sync = f.runner(restarted);
    await sync.tick(); expect(sync.state.authRequired).toBe(true); expect(f.state.puts).toBe(0);
    expect(restarted.get(key)?.text).toBe("Offline efter utgången token");
    f.state.authenticated = true; sync.retryAuthentication(); await sync.tick();
    expect(f.files.get("a.md")?.text).toBe("Offline efter utgången token"); expect(dirty(restarted.get(key)!)).toBe(false);
  });
  it("acknowledges only the snapshot while typing continues during sync", async () => {
    const f = fixture(); const key = await f.edit("a.md", "Snapshot"); const sync = f.runner();
    f.state.beforeWrite = async () => { f.store.update(key, draft => ({ ...draft, text: "Later typing", updatedAt: Date.now() })); };
    await sync.tick(); expect(f.files.get("a.md")?.text).toBe("Snapshot"); expect(f.store.get(key)?.text).toBe("Later typing"); expect(dirty(f.store.get(key)!)).toBe(true);
    f.state.beforeWrite = async () => {}; await sync.tick(true); expect(f.files.get("a.md")?.text).toBe("Later typing");
  });
  it("recovers a lost response after restart without duplicate writes", async () => {
    const f = fixture(); const key = await f.edit("a.md", "Saved once"); f.state.lost = true;
    await f.runner().tick(); expect(f.store.get(key)?.pending?.text).toBe("Saved once");
    const restarted = new DraftStore(); await restarted.load(f.account, f.scope);
    await f.runner(restarted).tick(true); expect(f.state.puts).toBe(1); expect(dirty(restarted.get(key)!)).toBe(false);
  });
  it("one conflict does not block other queued notes and preserves all local text", async () => {
    const f = fixture(); const key = await f.edit("a.md", "Device one"); await f.edit("Nested/b.md", "Independent");
    f.files.set("a.md", { path: "a.md", text: "Device two", sha: "c".repeat(40) });
    await f.runner().tick(); expect(f.store.get(key)?.text).toBe("Device one"); expect(f.store.get(key)?.conflict?.remote.text).toBe("Device two"); expect(f.files.get("Nested/b.md")?.text).toBe("Independent");
  });
  it("remote deletion is retained for review, never silently removed or recreated", async () => {
    const f = fixture(); const sync = f.runner(); await sync.tick(); const old = f.store.values().find(draft => draft.path === "a.md")!;
    f.files.delete("a.md"); await sync.tick(true, true);
    expect(f.store.get(old.key)?.text).toBe(old.text); expect(f.store.get(old.key)?.conflict?.remote.sha).toBeNull();
    await sync.tick(true); expect(f.state.puts).toBe(0);
  });
  it("does no network work after explicit logout/account isolation revokes access", async () => {
    const f = fixture(); await f.edit("a.md", "Private"); f.state.allowed = false;
    await f.runner().tick(true); expect(f.request).not.toHaveBeenCalled();
    const other = new DraftStore(); await other.load("different-account", f.scope); expect(other.values()).toEqual([]);
  });
  it("server-directed cooldown cannot be bypassed by repeated manual sync", async () => {
    const f = fixture(); const request = vi.fn().mockRejectedValue(new ApiError(429, "rate-limit", "Wait", undefined, 120));
    const sync = new WorkspaceSync({ account: f.account, workspace, store: f.store, notes: [], allowed: () => true, owns: () => true, online: () => true, request: request as typeof api, lock: async (_name, action) => action() });
    await sync.tick(true); await sync.tick(true); sync.retryAuthentication(); await sync.tick(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
it("offline batch uses authorized tree entries and shares a single listing", async () => {
  const notes = vi.fn().mockResolvedValue([{ path: "a.md", sha: "a".repeat(40), size: 10 }, { path: "b.md", sha: "b".repeat(40), size: 20 }]);
  const readEntry = vi.fn().mockRejectedValue(new AppError(422, "encoding", "UTF-8 krävs"));
  const results = await offlineBatch({ notes, read: vi.fn(), write: vi.fn(), dispose: vi.fn() }, { readEntry } as unknown as GitHub, workspace, { files: [{ path: "a.md", sha: "a".repeat(40) }, { path: "b.md", sha: "wrong" }] });
  expect(notes).toHaveBeenCalledTimes(1); expect(readEntry.mock.calls[0][1].sha).toBe("b".repeat(40)); expect(results).toEqual([{ path: "a.md", unchanged: true }, { path: "b.md", error: "UTF-8 krävs" }]);
});
