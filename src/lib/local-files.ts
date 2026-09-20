import { acknowledge, DraftStore, newDraft, readDraft, reconcile } from "./drafts";
import { dirty, draftKey, type RemoteNote } from "./types";

type Snapshot = { directory: string; files: { path: string; text: string }[] };
type Saved = { saved: boolean; text: string | null };
export type LocalFilesTransport = {
  snapshot: () => Promise<Snapshot>;
  save: (input: { path: string; text: string; expected: string | null }) => Promise<Saved>;
};
export function localFilesTransport(directory?: string): LocalFilesTransport { return {
  async snapshot() { const { invoke } = await import("@tauri-apps/api/core"); return invoke<Snapshot>("local_snapshot", { directory }); },
  async save(input) { const { invoke } = await import("@tauri-apps/api/core"); return invoke<Saved>("local_save", { ...input, directory }); },
}; }
export const nativeLocalFiles = localFilesTransport();
async function remote(path: string, text: string | null): Promise<RemoteNote> {
  const sha = text === null ? null : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
  return { path, text: text ?? "", sha };
}

/** IndexedDB remains the durable editing buffer; ordinary files are the local collection. */
export class LocalFiles {
  state = { directory: "", error: "", running: false };
  private revision = 0;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private disposed = false;
  constructor(private options: {
    store: DraftStore; account: string; scope: string; owns: (key: string) => boolean;
    transport?: LocalFilesTransport;
    lock?: (key: string, work: () => Promise<void>) => Promise<void>;
  }) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private emit(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.revision++; this.listeners.forEach(listener => listener()); }
  private get transport() { return this.options.transport || nativeLocalFiles; }
  private async edit(key: string, work: () => Promise<void>) {
    if (this.disposed) return;
    const run = async () => {
      if (this.disposed) return;
      await this.options.store.flush();
      if (this.options.store.status.get(key) === "failed") return;
      const latest = await readDraft(key);
      if (latest && !this.options.owns(key)) this.options.store.hydrate(latest);
      await work(); await this.options.store.flush();
    };
    if (this.options.owns(key)) await run();
    else if (this.options.lock) await this.options.lock(key, run);
    else if (navigator.locks) await navigator.locks.request(`gitbsidian-edit:${key}`, { ifAvailable: true }, async lock => { if (lock) await run(); });
  }
  async load() {
    const snapshot = await this.transport.snapshot();
    if (this.disposed) return;
    this.emit({ directory: snapshot.directory });
    const paths = new Set(snapshot.files.map(file => file.path));
    for (const file of snapshot.files) {
      const value = await remote(file.path, file.text);
      const key = draftKey(this.options.account, this.options.scope, file.path);
      await this.edit(key, async () => {
        const current = this.options.store.get(key);
        const next = current ? reconcile(current, value) : newDraft(this.options.account, this.options.scope, value);
        if (next !== current) this.options.store.set(next);
      });
    }
    for (const draft of this.options.store.values()) {
      if (draft.baseSha !== null && !paths.has(draft.path)) await this.edit(draft.key, async () => {
        this.options.store.update(draft.key, value => reconcile(value, { path: value.path, text: "", sha: null }));
      });
    }
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    if (this.disposed) return Promise.resolve();
    this.running = this.work().finally(() => { this.running = null; this.emit({ running: false }); });
    return this.running;
  }
  private async work() {
    this.emit({ running: true, error: "" });
    try {
      await this.load();
      for (const draft of this.options.store.values()) {
        if (!dirty(draft) || draft.conflict) continue;
        await this.edit(draft.key, async () => {
          const store = this.options.store;
          const current = store.get(draft.key);
          if (!current || current.conflict || !dirty(current)) return;
          const pending = { text: current.text, baseSha: current.baseSha, startedAt: Date.now() };
          store.update(current.key, value => ({ ...value, pending }));
          await store.flush();
          if (store.status.get(current.key) !== "stored") throw new Error("Utkastet kunde inte lagras. Filen har inte skrivits över.");
          const result = await this.transport.save({ path: current.path, text: pending.text, expected: current.baseSha === null ? null : current.baseText });
          const value = await remote(current.path, result.text);
          store.update(current.key, latest => result.saved ? acknowledge(latest, value) : { ...latest, pending: undefined, conflict: { base: latest.baseText, remote: value } });
        });
      }
    } catch (error) { this.emit({ error: typeof error === "string" ? error : error instanceof Error ? error.message : "Kunde inte läsa eller spara den lokala mappen." }); }
  }
  async flush() {
    await this.running;
    await this.tick();
    await this.options.store.flush();
  }
  stop() { this.disposed = true; }
}
