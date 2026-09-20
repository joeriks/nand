import { api, ApiError } from "./client-api";
import { acknowledge, cacheKey, DraftStore, newDraft, readDraft, reconcile, writeWorkspace } from "./drafts";
import { dirty, draftKey, workspaceKey, type CachedWorkspace, type NoteEntry, type RemoteNote, type User, type Workspace } from "./types";
import { MAX_NOTE_BYTES, pathSchema, wikiPathSchema } from "./validation";
import type { OfflineResult } from "./server/offline";

type Transport = typeof api;
type Lock = (name: string, work: () => Promise<void>) => Promise<void>;
const browserLock: Lock = async (name, work) => {
  if (!navigator.locks) return;
  await navigator.locks.request(name, { ifAvailable: true }, async lock => { if (lock) await work(); });
};
export type SyncState = { running: boolean; syncing: string | null; authRequired: boolean; error: string; cache: CachedWorkspace; downloading: boolean; completed: number; total: number };

/** The durable outbox is the dirty Draft itself. Pending is the exact in-flight snapshot.
 * There is deliberately no second queue that can diverge from persisted editor text. */
export class WorkspaceSync {
  state: SyncState;
  private listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;
  private running: Promise<void> | null = null;
  private id: string;
  private nextAttempt = 0;
  private lastTree = 0;
  private retryDelay = 5_000;
  private wantsDownload = true;
  private readonly scope: string;
  constructor(private options: {
    account: string; workspace: Workspace; store: DraftStore; cache?: CachedWorkspace;
    id?: string; notes: NoteEntry[]; allowed: () => boolean; owns: (key: string) => boolean;
    online?: () => boolean; request?: Transport; lock?: Lock; accountChanged?: (user: User) => void;
  }) {
    this.id = options.id || "";
    this.scope = workspaceKey(options.workspace);
    const cache = options.cache || { key: cacheKey(options.account, this.scope), account: options.account, workspace: options.workspace, notes: options.notes, checkedAt: 0, unavailable: {} };
    this.state = { running: false, syncing: null, authRequired: false, error: "", cache, downloading: false, completed: 0, total: 0 };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private emit(update: Partial<SyncState> = {}) { this.state = { ...this.state, ...update }; this.revision++; this.listeners.forEach(listener => listener()); }
  private allowed = () => !this.disposed && this.options.allowed();
  private request: Transport = async <T>(url: string, method = "GET", body?: unknown) => {
    if (!this.allowed()) throw new ApiError(401, "account", "Lokal åtkomst har avslutats.");
    return (this.options.request || api)<T>(url, method, body);
  };
  private notesUrl() { return `/api/notes?workspace=${encodeURIComponent(this.id)}&account=${this.options.account}`; }
  private lock: Lock = (name, work) => (this.options.lock || browserLock)(name, work);
  private async edit(key: string, work: () => Promise<void>) {
    if (!this.allowed()) return;
    if (this.options.owns(key)) { await work(); return; }
    await this.lock(`gitbsidian-edit:${key}`, async () => {
      if (!this.allowed()) return;
      await this.options.store.flush();
      if (this.options.store.status.get(key) === "failed") return;
      const persisted = await readDraft(key);
      if (persisted) this.options.store.hydrate(persisted);
      await work(); await this.options.store.flush();
    });
  }
  private async persistCache() {
    await writeWorkspace(this.state.cache);
    this.emit();
  }
  private async connect() {
    const session = await this.request<{ user: User | null }>("/api/session");
    if (!this.allowed()) return false;
    if (session.user && String(session.user.id) !== this.options.account) {
      this.options.accountChanged?.(session.user);
      throw new ApiError(401, "account", "Kontot ändrades. Den tidigare arbetsytan är stängd.");
    }
    if (!session.user) throw new ApiError(401, "authentication", "Logga in igen för att synka. Du kan fortsätta arbeta lokalt.");
    if (!this.id) {
      const restored = await this.request<{ id: string }>(`/api/workspace/restore?account=${this.options.account}`, "POST", this.options.workspace);
      this.id = restored.id;
    }
    this.emit({ authRequired: false });
    return true;
  }
  private async save(key: string) {
    const store = this.options.store;
    let current = store.get(key);
    if (!current || current.conflict || !dirty(current)) return;
    await store.flush();
    if (store.status.get(key) !== "stored") throw new Error("Utkastet kunde inte sparas lokalt. Exportera texten.");
    this.emit({ syncing: key });
    try {
      if (current.pending) {
        const remote = await this.request<RemoteNote>(`${this.notesUrl()}&path=${encodeURIComponent(current.path)}`);
        store.update(key, draft => reconcile(draft, remote));
        current = store.get(key)!;
        if (current.conflict) return;
        if (current.pending) store.update(key, draft => ({ ...draft, pending: undefined }));
        current = store.get(key)!;
        if (!dirty(current)) return;
      }
      const snapshot = { text: current.text, baseSha: current.baseSha, startedAt: Date.now() };
      store.update(key, draft => ({ ...draft, pending: snapshot, syncError: undefined }));
      await store.flush();
      if (store.status.get(key) !== "stored") throw new Error("Utkastet kunde inte sparas lokalt. Exportera texten.");
      const result = await this.request<RemoteNote & { savedAt: number }>(this.notesUrl(), "PUT", { path: current.path, ...snapshot });
      // Acknowledgement must persist even if logout/closing was requested during this request.
      store.update(key, draft => acknowledge(draft, result, result.savedAt));
      const cache = this.state.cache;
      cache.notes = [...cache.notes.filter(entry => entry.path !== result.path), { path: result.path, sha: result.sha!, size: new TextEncoder().encode(result.text).length }];
      delete cache.unavailable[result.path];
    } catch (error) {
      if (error instanceof ApiError && error.code === "conflict") {
        store.update(key, draft => ({ ...draft, conflict: { base: draft.baseText, remote: error.details as RemoteNote } }));
      } else {
        store.update(key, draft => ({ ...draft, syncError: { message: error instanceof Error ? error.message : "Synkningen misslyckades.", retryAt: Date.now() + 60_000 } }));
        // Per-file validation/branch failures must not starve independent notes.
        if (!(error instanceof ApiError) || ![400, 403, 409, 413, 422].includes(error.status)) throw error;
        this.emit({ error: error.message });
      }
    } finally { await store.flush(); this.emit({ syncing: null }); }
  }
  private downloaded(entry: NoteEntry) {
    const draft = this.options.store.get(draftKey(this.options.account, this.scope, entry.path));
    return draft && this.options.store.status.get(draft.key) === "stored" && (draft.baseSha === entry.sha || draft.conflict?.remote.sha === entry.sha);
  }
  private async download(refresh: boolean) {
    const cache = this.state.cache;
    if (refresh || !this.lastTree) {
      cache.notes = await this.request<NoteEntry[]>(this.notesUrl());
      cache.checkedAt = Date.now(); cache.unavailable = {};
      this.lastTree = Date.now();
      await this.persistCache();
      const paths = new Set(cache.notes.map(entry => entry.path));
      for (const draft of this.options.store.values()) {
        if (draft.baseSha !== null && !paths.has(draft.path)) {
          await this.edit(draft.key, async () => this.options.store.update(draft.key, value => reconcile(value, { path: draft.path, text: "", sha: null })));
        }
      }
    }
    const missing = cache.notes.filter(entry => !this.downloaded(entry));
    this.emit({ downloading: true, total: cache.notes.length, completed: cache.notes.length - missing.length });
    const schema = cache.workspace.mode === "wiki" ? wikiPathSchema : pathSchema;
    const supported = missing.filter(entry => {
      if (entry.size > MAX_NOTE_BYTES || !schema.safeParse(entry.path).success) {
        cache.unavailable[entry.path] = entry.size > MAX_NOTE_BYTES ? "Större än 1 MiB" : "Sökvägen stöds inte";
        return false;
      }
      return !cache.unavailable[entry.path];
    });
    // Yield between chunks so editing/sync and closing are not stuck behind a huge collection.
    for (let offset = 0; offset < Math.min(supported.length, 20) && this.allowed(); offset += 2) {
      const batch = supported.slice(offset, offset + 2);
      try {
        const results = await this.request<OfflineResult[]>(this.notesUrl(), "POST", { files: batch.map(entry => {
          const draft = this.options.store.get(draftKey(this.options.account, this.scope, entry.path));
          return { path: entry.path, sha: draft?.conflict?.remote.sha || draft?.baseSha || null };
        }) });
        for (const result of results) {
          if (result.error) { cache.unavailable[result.path] = result.error; continue; }
          if (result.note) {
            const remote = result.note;
            const key = draftKey(this.options.account, this.scope, remote.path);
            await this.edit(key, async () => {
              const current = this.options.store.get(key);
              if (current) this.options.store.set(reconcile(current, remote));
              else if (remote.sha) this.options.store.set(newDraft(this.options.account, this.scope, remote));
              await this.options.store.flush();
            });
            // The batch may have observed a newer tree than the manifest.
            if (remote.sha) { const entry = cache.notes.find(entry => entry.path === remote.path); if (entry) entry.sha = remote.sha; }
            else cache.notes = cache.notes.filter(entry => entry.path !== remote.path);
          }
        }
      } catch (error) {
        for (const entry of batch) cache.unavailable[entry.path] = error instanceof Error ? error.message : "Hämtningen misslyckades";
        await this.persistCache();
        throw error;
      }
      for (const entry of batch) {
        if (this.downloaded(entry)) delete cache.unavailable[entry.path];
        else cache.unavailable[entry.path] ||= "Inte hämtad ännu. Filen kan vara öppen i en annan flik eller lokal lagring kan vara full.";
      }
      this.emit({ completed: cache.notes.filter(entry => this.downloaded(entry)).length });
      await this.persistCache();
    }
    this.wantsDownload = supported.length > 20;
    await this.persistCache();
  }
  tick(force = false, refresh = false): Promise<void> {
    if (this.running) return this.running;
    const now = Date.now();
    if (!this.allowed() || !(this.options.online?.() ?? navigator.onLine) || now < this.nextAttempt) return Promise.resolve();
    const candidates = this.options.store.values().filter(draft => dirty(draft) && !draft.conflict && (force || now - draft.updatedAt >= 2500) && (force || !draft.syncError || draft.syncError.retryAt <= now));
    const checkTree = refresh || now - this.lastTree >= 60_000;
    if (!force && !candidates.length && !checkTree && !this.wantsDownload) return Promise.resolve();
    this.running = this.lock(`gitbsidian-sync:${this.options.account}`, async () => {
      if (!this.allowed()) return;
      this.emit({ running: true, error: "" });
      try {
        if (!await this.connect()) return;
        for (const candidate of candidates) {
          if (!this.allowed()) break;
          await this.edit(candidate.key, async () => this.save(candidate.key));
        }
        if (this.allowed() && (checkTree || this.wantsDownload)) await this.download(checkTree);
        await this.persistCache();
        this.retryDelay = 5_000;
      } catch (error) {
        const auth = error instanceof ApiError && error.status === 401;
        if (auth || error instanceof ApiError && error.code === "workspace") this.id = "";
        const delay = error instanceof ApiError && error.retryAfter ? error.retryAfter * 1000 : auth ? 30_000 : this.retryDelay;
        this.nextAttempt = Date.now() + delay;
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
        this.emit({ authRequired: auth || this.state.authRequired, error: error instanceof Error ? error.message : "Kunde inte synka. Utkasten finns kvar." });
      } finally { await this.options.store.flush(); this.emit({ running: false, downloading: false, syncing: null }); }
    }).finally(() => { this.running = null; });
    return this.running;
  }
  // Online/auth wakeups do not bypass a server-directed rate-limit cooldown.
  retryAuthentication() { if (this.state.authRequired) this.nextAttempt = 0; }
  async drain() { await this.running; await this.options.store.flush(); }
  stop() { this.disposed = true; }
}
