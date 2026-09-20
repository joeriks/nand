export type UpdatePackage = {
  version: string;
  body?: string;
  download: (progress: (received: number, total?: number) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
};
export type UpdateState = {
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "saving" | "installing" | "error";
  version?: string; notes?: string; received?: number; total?: number; error?: string;
};

export class AppUpdates {
  state: UpdateState = { phase: "idle" };
  private listeners = new Set<() => void>();
  private pending: UpdatePackage | null = null;
  private working = false;
  private checkedAt = 0;
  constructor(private checkUpdate: () => Promise<UpdatePackage | null>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private set(state: UpdateState) { this.state = state; this.listeners.forEach(listener => listener()); }
  async check(manual = false) {
    if (this.working || (!manual && Date.now() - this.checkedAt < 6 * 60 * 60 * 1000)) return;
    this.working = true; this.checkedAt = Date.now();
    this.set({ phase: "checking" });
    try {
      await this.pending?.close(); this.pending = null;
      this.pending = await this.checkUpdate();
      this.set(this.pending ? { phase: "available", version: this.pending.version, notes: this.pending.body } : { phase: "current" });
    } catch { this.set({ phase: "error", error: "Kunde inte söka efter uppdateringar. Kontrollera internetanslutningen och försök igen." }); }
    finally { this.working = false; }
  }
  async install(prepare: () => Promise<void>, release: () => void | Promise<void>) {
    if (this.working || !this.pending) return;
    this.working = true;
    const update = this.pending;
    try {
      this.set({ phase: "downloading", version: update.version });
      await update.download((received, total) => this.set({ phase: "downloading", version: update.version, received, total }));
      this.set({ phase: "saving", version: update.version });
      await prepare();
      this.set({ phase: "installing", version: update.version });
      // On Windows the verified installer exits this process and restarts the app.
      await update.install();
    } catch (error) {
      try { await release(); } catch { /* Editing is unlocked by the caller's finally block. */ }
      this.set({ phase: "error", version: update.version, error: error instanceof Error ? error.message : "Uppdateringen kunde inte installeras. Försök igen." });
    } finally { this.working = false; }
  }
}

export const appUpdates = new AppUpdates(async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 20_000 });
  if (!update) return null;
  return {
    version: update.version, body: update.body,
    download: async progress => {
      let received = 0; let total: number | undefined;
      await update.download(event => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") received += event.data.chunkLength;
        progress(received, total);
      }, { timeout: 120_000 });
    },
    install: () => update.install(), close: () => update.close(),
  };
});
