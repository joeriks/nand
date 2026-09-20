"use client";
import { useEffect } from "react";
import { DraftStore, listWorkspaces } from "@/lib/drafts";
import { acceptAccount, localAccess } from "@/lib/local-access";
import { WorkspaceSync } from "@/lib/workspace-sync";
import { workspaceKey, type User } from "@/lib/types";

/** Resume previously selected workspaces, including those not currently in the editor.
 * All workers share the account writer lock and respect each note's editor lock. */
export function BackgroundSync({ user, activeScope }: { user: User | null; activeScope: string | null }) {
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    let running = false;
    const generation = localAccess()?.generation;
    const workers = new Map<string, WorkspaceSync>();
    async function tick() {
      if (running || disposed || !navigator.onLine) return;
      running = true;
      try {
        for (const cache of await listWorkspaces(String(user!.id))) {
          if (disposed) break;
          const scope = workspaceKey(cache.workspace);
          if (scope === activeScope) continue;
          let worker = workers.get(scope);
          if (!worker) {
            const store = new DraftStore(); await store.load(String(user!.id), scope);
            if (disposed) break;
            worker = new WorkspaceSync({ account: String(user!.id), workspace: cache.workspace, cache, notes: cache.notes, store, owns: () => false,
              allowed: () => !disposed && localAccess()?.generation === generation && localAccess()?.user?.id === user!.id,
              accountChanged: value => { acceptAccount(value); } });
            workers.set(scope, worker);
          }
          await worker.tick();
        }
      } catch { /* The active editor reports persistence errors; retry background work later. */ }
      finally { running = false; }
    }
    const timer = setInterval(() => { void tick(); }, 10_000);
    window.addEventListener("online", tick);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("online", tick); workers.forEach(worker => worker.stop()); };
  }, [user?.id, activeScope, user]);
  return null;
}
