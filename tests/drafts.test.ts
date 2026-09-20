import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { acknowledge, DraftStore, mergeText, newDraft, readDraft, reconcile } from "@/lib/drafts";
import { dirty, draftKey, workspaceKey } from "@/lib/types";

const remote = { path: "Trädgård/En idé.md", text: "# Ursprung\r\n\r\n[[Okänd^syntax]]", sha: "a".repeat(40) };
describe("draft durability and version state", () => {
  it("keeps newer typing dirty when a captured snapshot is acknowledged", () => {
    const draft = { ...newDraft("1", "workspace", remote), text: "Text efter klicket", pending: { text: "Ögonblicksbild", baseSha: remote.sha, startedAt: 1 } };
    const result = acknowledge(draft, { ...remote, text: "Ögonblicksbild", sha: "b".repeat(40) });
    expect(result.text).toBe("Text efter klicket");
    expect(result.baseText).toBe("Ögonblicksbild");
    expect(dirty(result)).toBe(true);
    expect(result.pending).toBeUndefined();
  });
  it("recovers a lost response without dropping later edits", () => {
    const draft = { ...newDraft("1", "workspace", remote), text: "Senare text", pending: { text: "Skickad text", baseSha: remote.sha, startedAt: 1 } };
    const result = reconcile(draft, { ...remote, text: "Skickad text", sha: "b".repeat(40) });
    expect(result.text).toBe("Senare text"); expect(result.baseText).toBe("Skickad text"); expect(result.pending).toBeUndefined();
  });
  it("never replaces a dirty draft with an external edit or deletion", () => {
    const draft = { ...newDraft("1", "workspace", remote), text: "Mitt arbete" };
    for (const latest of [{ ...remote, text: "Annat arbete", sha: "b".repeat(40) }, { ...remote, text: "", sha: null }]) {
      const result = reconcile(draft, latest);
      expect(result.text).toBe("Mitt arbete"); expect(result.conflict?.base).toBe(remote.text); expect(result.conflict?.remote).toEqual(latest);
    }
  });
  it("updates clean cached content when GitHub changes", () => {
    const result = reconcile(newDraft("1", "workspace", remote), { ...remote, sha: "b".repeat(40), text: "Ny fjärrtext" });
    expect(result.text).toBe("Ny fjärrtext"); expect(dirty(result)).toBe(false);
  });
  it("isolates accounts, branches, roots and paths without delimiter collisions", () => {
    const repository = { id: 123, fullName: "a/b", defaultBranch: "main", installationId: 2, private: true };
    const a = workspaceKey({ repository, branch: "main", root: "" });
    const b = workspaceKey({ repository, branch: "drafts", root: "" });
    const c = workspaceKey({ repository, branch: "main", root: "anteckningar" });
    expect(new Set([draftKey("1", a, "a.md"), draftKey("2", a, "a.md"), draftKey("1", b, "a.md"), draftKey("1", c, "a.md"), draftKey("1", a, "b.md")]).size).toBe(5);
  });
  it("preserves exact UTF-8 text, pending snapshots and conflicts across a new store", async () => {
    const text = '\ufeff---\r\ncustom: "åäö"\r\n---\r\n![[Okänd]]\r\n^block-id\r\n';
    const original = { ...newDraft("durability", "workspace", remote), text, pending: { text, baseSha: remote.sha, startedAt: 42 }, conflict: { base: remote.text, remote: { ...remote, text: "Extern text" } } };
    const store = new DraftStore(); store.set(original); await store.flush();
    const reloaded = new DraftStore(); await reloaded.load("durability", "workspace");
    expect(reloaded.get(original.key)).toEqual(original);
    const anotherAccount = new DraftStore(); await anotherAccount.load("unrelated", "workspace"); expect(anotherAccount.values()).toEqual([]);
  });
  it("writes successive keystrokes in order and persists the latest acknowledgement", async () => {
    const draft = newDraft("ordered", "workspace", remote);
    const store = new DraftStore(); store.set(draft);
    for (const text of ["a", "ab", "abc"]) store.update(draft.key, current => ({ ...current, text }));
    store.update(draft.key, current => acknowledge(current, { ...remote, text: "ab", sha: "b".repeat(40) }));
    await store.flush();
    const persisted = (await readDraft(draft.key))!;
    expect(persisted.text).toBe("abc"); expect(persisted.baseText).toBe("ab"); expect(dirty(persisted)).toBe(true);
  });
  it("never claims a draft is persisted when browser storage is full", async () => {
    const store = new DraftStore(); const draft = newDraft("quota", "workspace", remote);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    try {
      store.set(draft); await store.flush();
      expect(store.status.get(draft.key)).toBe("failed"); expect(store.get(draft.key)?.text).toBe(remote.text);
    } finally { put.mockRestore(); }
  });
});
describe("three-way merge", () => {
  it("merges independent edits and preserves CRLF and final newline semantics", () => {
    expect(mergeText("a\r\nb\r\nc", "A\r\nb\r\nc", "a\r\nb\r\nC")).toBe("A\r\nb\r\nC");
  });
  it("requires review for overlapping edits", () => { expect(mergeText("a\nb\n", "a\nlocal\n", "a\nremote\n")).toBeNull(); });
  it("does not mistake identical changes for a conflict", () => { expect(mergeText("a", "ny", "ny")).toBe("ny"); });
});
