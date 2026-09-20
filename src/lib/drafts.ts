import { openDB, type DBSchema } from "idb";
import { diff3Merge } from "node-diff3";
import { dirty, draftKey, type CachedWorkspace, type Draft, type RemoteNote } from "./types";

interface DraftDatabase extends DBSchema {
  drafts: { key: string; value: Draft; indexes: { account: string } };
  workspaces: { key: string; value: CachedWorkspace; indexes: { account: string } };
}
let database: ReturnType<typeof openDB<DraftDatabase>> | undefined;
function db() {
  database ??= openDB<DraftDatabase>("gitbsidian-v1", 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore("drafts", { keyPath: "key" }).createIndex("account", "account");
      if (oldVersion < 2) database.createObjectStore("workspaces", { keyPath: "key" }).createIndex("account", "account");
    },
  });
  return database;
}
export async function readDraft(key: string) { return (await db()).get("drafts", key); }
export async function listDrafts(account: string) { return (await db()).getAllFromIndex("drafts", "account", account); }
export async function writeDraft(draft: Draft) { await (await db()).put("drafts", draft); }
export const cacheKey = (account: string, workspace: string) => JSON.stringify([account, workspace]);
export async function readWorkspace(key: string) { return (await db()).get("workspaces", key); }
export async function listWorkspaces(account: string) { return (await db()).getAllFromIndex("workspaces", "account", account); }
export async function writeWorkspace(workspace: CachedWorkspace) { await (await db()).put("workspaces", workspace); }
export function newDraft(account: string, workspace: string, remote: RemoteNote): Draft {
  return { key: draftKey(account, workspace, remote.path), account, workspace, path: remote.path, baseSha: remote.sha, baseText: remote.text, text: remote.text, updatedAt: Date.now() };
}
export function acknowledge(draft: Draft, remote: RemoteNote, savedAt = Date.now()): Draft {
  return { ...draft, baseSha: remote.sha, baseText: remote.text, savedAt, pending: undefined, conflict: undefined, syncError: undefined };
}
export function reconcile(draft: Draft, remote: RemoteNote): Draft {
  if (remote.sha !== null && draft.pending?.text === remote.text) return acknowledge(draft, remote);
  if (remote.sha === draft.baseSha) return draft;
  if (!dirty(draft) && remote.sha !== null) return { ...acknowledge(draft, remote), text: remote.text };
  if (remote.sha !== null && draft.text === remote.text) return acknowledge(draft, remote);
  return { ...draft, conflict: { base: draft.baseText, remote } };
}
export function mergeText(base: string, local: string, remote: string): string | null {
  // Keep line terminators (including CRLF) and the absence of a final newline.
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const blocks = diff3Merge(lines(local), lines(base), lines(remote));
  if (blocks.some(block => "conflict" in block)) return null;
  return blocks.flatMap(block => "ok" in block ? block.ok : []).join("");
}

/** A synchronous editing model with ordered durable writes and explicit persistence status. */
export class DraftStore {
  private drafts = new Map<string, Draft>();
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  readonly status = new Map<string, "writing" | "stored" | "failed">();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private emit() { this.revision++; this.listeners.forEach(listener => listener()); }
  get(key: string) { return this.drafts.get(key); }
  hydrate(draft: Draft) { this.drafts.set(draft.key, draft); this.status.set(draft.key, "stored"); this.emit(); }
  values() { return [...this.drafts.values()]; }
  async load(account: string, workspace: string) {
    for (const draft of await listDrafts(account)) {
      if (draft.workspace === workspace && !this.drafts.has(draft.key)) { this.drafts.set(draft.key, draft); this.status.set(draft.key, "stored"); }
    }
    this.emit();
  }
  set(draft: Draft) {
    this.drafts.set(draft.key, draft);
    this.status.set(draft.key, "writing");
    this.emit();
    this.queue = this.queue.catch(() => undefined).then(async () => {
      try {
        await writeDraft(draft);
        if (this.drafts.get(draft.key) === draft) this.status.set(draft.key, "stored");
      } catch { this.status.set(draft.key, "failed"); }
      this.emit();
    });
  }
  update(key: string, change: (current: Draft) => Draft) {
    const current = this.drafts.get(key);
    if (current) this.set(change(current));
  }
  async flush() {
    // Include writes that were queued while an earlier IndexedDB transaction was finishing.
    while (true) { const current = this.queue; await current; if (current === this.queue) return; }
  }
}
