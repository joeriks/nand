"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, FileText, Folder } from "lucide-react";

type Entry = { path: string; name: string; folder: boolean };
type Page = { entries: Entry[]; next: number | null };
export type BrowseDirectory = (path: string, offset: number) => Promise<Page>;
export function LocalExplorer({ directory, selected, onInclude, onExclude, browse }: {
  directory: string; selected: Set<string>; onInclude: (path: string) => Promise<void>; onExclude: (path: string) => Promise<void>; browse?: BrowseDirectory;
}) {
  const load: BrowseDirectory = useCallback(async (path, offset) => {
    if (browse) return browse(path, offset);
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Page>("local_list_directory", { directory, path, offset });
  }, [browse, directory]);
  return <div className="local-explorer"><p className="hint">Välj filer som ska ingå. Filerna ligger kvar i mappen.</p><Directory key={directory} path="" load={load} selected={selected} onInclude={onInclude} onExclude={onExclude} /></div>;
}
function Directory({ path, load, selected, onInclude, onExclude }: { path: string; load: BrowseDirectory; selected: Set<string>; onInclude: (path: string) => Promise<void>; onExclude: (path: string) => Promise<void> }) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // A directory is fetched only when mounted (expanded), never recursively.
  useEffect(() => {
    let cancelled = false;
    void load(path, 0).then(value => { if (!cancelled) setPage(value); }).catch(() => { if (!cancelled) setError("Kunde inte visa mappen."); });
    return () => { cancelled = true; };
  }, [path, load]);
  async function fetchPage(reset = false) {
    setBusy(true); setError("");
    try {
      const value = await load(path, reset ? 0 : page?.next || 0);
      setPage(previous => ({ ...value, entries: reset ? value.entries : [...(previous?.entries || []), ...value.entries].filter((entry, index, all) => all.findIndex(other => other.path === entry.path) === index) }));
    } catch { setError("Kunde inte visa mappen."); }
    finally { setBusy(false); }
  }
  async function select(entry: Entry) {
    setBusy(true); setError("");
    try { if (selected.has(entry.path)) await onExclude(entry.path); else await onInclude(entry.path); }
    catch (error) { setError(typeof error === "string" ? error : error instanceof Error ? error.message : "Kunde inte välja filen."); }
    finally { setBusy(false); }
  }
  return <div className="explorer-directory">
    {error && <p className="error-message" role="alert">{error}</p>}
    {!page && !error && <p role="status">Läser mappen…</p>}
    {page?.entries.map(entry => entry.folder ? <div key={entry.path}>
      <button className="tree-file" aria-expanded={expanded.has(entry.path)} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; })}><ChevronRight size={13} /><Folder size={16} /><span>{entry.name}</span></button>
      {expanded.has(entry.path) && <Directory path={entry.path} load={load} selected={selected} onInclude={onInclude} onExclude={onExclude} />}
    </div> : <label className="explorer-file" key={entry.path} title={entry.path}><input type="checkbox" checked={selected.has(entry.path)} disabled={busy} onChange={() => void select(entry)} aria-label={`Inkludera ${entry.path}`} /><FileText size={15} /><span>{entry.name}</span></label>)}
    {page && page.entries.length === 0 && page.next === null && <p className="hint">Inga Markdown-, TXT-, CSV- eller bildfiler här.</p>}
    {page?.next != null && <button className="text-button" disabled={busy} onClick={() => void fetchPage()}>Visa fler</button>}
    <button className="text-button explorer-refresh" disabled={busy} onClick={() => void fetchPage(true)}>Uppdatera mappen</button>
  </div>;
}
