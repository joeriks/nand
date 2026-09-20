"use client";
import { useEffect, useSyncExternalStore } from "react";
import { appUpdates } from "@/lib/app-updates";
import { Dialog } from "./dialog";

export function AppUpdater({ open, onClose, prepare, release }: {
  open: boolean; onClose: () => void; prepare: () => Promise<void>; release: () => void | Promise<void>;
}) {
  const state = useSyncExternalStore(appUpdates.subscribe, appUpdates.snapshot, appUpdates.snapshot);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const timer = setTimeout(() => void appUpdates.check(), 10_000);
    const interval = setInterval(() => void appUpdates.check(), 6 * 60 * 60 * 1000);
    const online = () => void appUpdates.check();
    window.addEventListener("online", online);
    return () => { clearTimeout(timer); clearInterval(interval); window.removeEventListener("online", online); };
  }, []);
  const busy = ["downloading", "saving", "installing"].includes(state.phase);
  if (!open) return null;
  const message = state.phase === "checking" ? "Söker efter uppdateringar…"
    : state.phase === "current" ? "Du har den senaste versionen."
    : state.phase === "downloading" ? "Hämtar och verifierar uppdateringen…"
    : state.phase === "saving" ? "Sparar dina utkast…"
    : state.phase === "installing" ? "Installerar uppdateringen. Appen startas om…"
    : state.phase === "available" ? `nand ${state.version} finns att installera.` : state.error || "Appen söker automatiskt efter nya versioner.";
  return <Dialog title="Appuppdateringar" onClose={onClose} dismissible={!busy}>
    <p role="status">{message}</p>
    {state.phase === "downloading" && <progress aria-label="Hämtar uppdatering" value={state.total ? state.received : undefined} max={state.total || 1} />}
    {state.notes && <details><summary>Nyheter i versionen</summary><pre className="update-notes">{state.notes}</pre></details>}
    <p className="hint">Uppdateringar hämtas från nand på GitHub. Dina utkast sparas före installationen.</p>
    <div className="dialog-actions">
      {!busy && <button className="button secondary" onClick={() => void appUpdates.check(true)} disabled={state.phase === "checking"}>Sök efter uppdateringar</button>}
      {state.phase === "available" && <button className="button primary" onClick={() => void appUpdates.install(prepare, release)}>Uppdatera och starta om</button>}
    </div>
  </Dialog>;
}
