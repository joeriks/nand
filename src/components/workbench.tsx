"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, CloudUpload, Download, FilePlus2, FileText, GitBranch, GitFork as Github, Info, Layers3, LoaderCircle, LogOut, Menu, Moon, PanelRight, RefreshCw, Search, Sun, Upload, WifiOff, X } from "lucide-react";
import { cacheKey, DraftStore, listDrafts, newDraft, readDraft, readWorkspace } from "@/lib/drafts";
import { dirty, draftKey, workspaceKey, type User } from "@/lib/types";
import { MAX_NOTE_BYTES, pathSchema, wikiPathSchema } from "@/lib/validation";
import { WorkspaceSync } from "@/lib/workspace-sync";
import { acceptAccount, localAccess } from "@/lib/local-access";
import { noteSelectionKey } from "@/lib/cached-workspaces";
import { sv } from "@/lib/i18n";
import type { OpenWorkspace } from "./workspace-picker";
import { Preview } from "./preview";
import { LocalExplorer } from "./local-explorer";
import { FileTree } from "./file-tree";
import { Dialog } from "./dialog";
import { ConflictDialog } from "./conflict-dialog";
import { ActionMenu } from "./action-menu";
import { AppUpdater } from "./app-updater";
import { appUpdates } from "@/lib/app-updates";
import { LocalFiles, localFilesTransport } from "@/lib/local-files";

const Editor = lazy(() => import("./editor"));
const CsvEditor = lazy(() => import("./csv-editor"));
const LOCAL_WORKSPACE = "local-notebook";
const noSubscribe = () => () => {};
const zero = () => 0;
type ViewMode = "edit" | "split" | "preview";
export function Workbench({ opened, user, dark, onTheme, onWorkspace, onLogout, onHome, desktop = false, onReconnect, localFolder, onLocalFolder, initialFile }: {
  opened: OpenWorkspace | "local"; user: User | null; dark: boolean; onTheme: () => void; onWorkspace: () => void; onLogout: () => Promise<void>; onHome: () => void;
  desktop?: boolean; onReconnect?: () => void;
  localFolder?: { directory: string; scope: string }; onLocalFolder?: (folder: { directory: string; scope: string }) => void;
  initialFile?: string | null;
}) {
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const updateState = useSyncExternalStore(appUpdates.subscribe, appUpdates.snapshot, appUpdates.snapshot);
  const local = opened === "local";
  const wiki = !local && opened.workspace.mode === "wiki";
  const workspaceUrl = local ? null : `https://github.com/${opened.workspace.repository.fullName.split("/").map(encodeURIComponent).join("/")}${wiki ? "/wiki" : ""}`;
  const account = local ? "local" : String(user!.id);
  const scope = local ? localFolder?.scope || LOCAL_WORKSPACE : workspaceKey(opened.workspace);
  const [store] = useState(() => new DraftStore());
  useSyncExternalStore(store.subscribe, store.snapshot, () => 0);
  const [sync, setSync] = useState<WorkspaceSync | null>(null);
  const [files, setFiles] = useState<LocalFiles | null>(null);
  useSyncExternalStore(files?.subscribe || noSubscribe, files?.snapshot || zero, zero);
  useSyncExternalStore(sync?.subscribe || noSubscribe, sync?.snapshot || zero, zero);
  const entries = local ? [] : sync?.state.cache.notes || opened.notes;
  const [active, setActive] = useState("");
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const authExpired = sync?.state.authRequired || false;
  const busy = sync?.state.running || false;
  const saveBarrier = useRef<Promise<void> | null>(null);
  const importBarrier = useRef<Promise<void> | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<ViewMode>("split");
  const [sidebar, setSidebar] = useState(false);
  const [browseFiles, setBrowseFiles] = useState(false);
  const [details, setDetails] = useState(false);
  const [newNote, setNewNote] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newFormat, setNewFormat] = useState("md");
  const [newError, setNewError] = useState("");
  const [compare, setCompare] = useState(false);
  const [logoutCount, setLogoutCount] = useState<number | null>(null);
  const [lockedKey, setLockedKey] = useState("");
  const [lockAttempt, setLockAttempt] = useState(0);
  const ownedKey = useRef("");
  const closing = useRef(false);
  const requestNumber = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draft = store.get(active);
  const plainText = /\.txt$/i.test(draft?.path || "");
  const csv = /\.csv$/i.test(draft?.path || "");
  const notePath = draft?.path;
  const localStatus = store.status.get(active);
  const locked = lockedKey !== active;
  const allDrafts = store.values().filter(value => !(local && desktop && value.localExcluded));
  const paths = [...new Set([...entries.map(entry => entry.path), ...allDrafts.map(draft => draft.path)])].sort((a, b) => a.localeCompare(b, "sv"));
  const dirtyPaths = new Set(allDrafts.filter(dirty).map(draft => draft.path));
  const visiblePaths = paths.filter(path => path.toLocaleLowerCase("sv").includes(filter.toLocaleLowerCase("sv")));

  const openNote = useCallback(async (path: string) => {
    const request = ++requestNumber.current;
    const key = draftKey(account, scope, path);
    setError(""); setNotice(""); setSidebar(false);
    if (store.get(key)) { setActive(key); return; }
    try {
      if (local) return;
      const existing = await readDraft(key);
      if (existing && !store.get(key)) store.hydrate(existing);
      if (request === requestNumber.current) setActive(key);
      if (!existing) setNotice("Anteckningen hämtas för offlinearbete. Anslut och logga in om hämtningen är pausad.");
    } catch (error) { if (request === requestNumber.current) setError(error instanceof Error ? error.message : "Kunde inte öppna anteckningen."); }
  }, [account, scope, store, local, setNotice]);

  useEffect(() => {
    let cancelled = false;
    let runner: WorkspaceSync | undefined;
    let localRunner: LocalFiles | undefined;
    store.load(account, scope).then(async () => {
      if (cancelled) return;
      if (local && desktop) {
        localRunner = new LocalFiles({ transport: localFilesTransport(localFolder?.directory), store, account, scope, owns: key => ownedKey.current === key });
        setFiles(localRunner);
        try { await localRunner.load(); if (initialFile) await localRunner.include(initialFile); }
        catch (error) { if (!cancelled) setError(typeof error === "string" ? error : "Kunde inte öppna den lokala mappen. Utkasten finns kvar."); }
        if (cancelled) { localRunner.stop(); return; }
      }
      if (local && !store.values().length && (!desktop || scope === LOCAL_WORKSPACE)) store.hydrate(newDraft(account, scope, { path: "Min första anteckning.md", text: "# Min första anteckning\n\n", sha: null }));
      if (!local) {
        const cache = await readWorkspace(cacheKey(account, scope));
        if (cancelled) return;
        const generation = localAccess()?.generation;
        runner = new WorkspaceSync({ account, workspace: opened.workspace, store, cache, id: opened.id, notes: opened.notes,
          allowed: () => !closing.current && localAccess()?.generation === generation && String(localAccess()?.user?.id) === account,
          owns: key => ownedKey.current === key, accountChanged: user => { acceptAccount(user); } });
        setSync(runner);
      }
      const previous = initialFile || localStorage.getItem(noteSelectionKey(account, scope));
      const available = [...new Set([...store.values().filter(value => !value.localExcluded).map(value => value.path), ...(!local ? opened.notes.map(value => value.path) : [])])].sort((a, b) => a.localeCompare(b, "sv"));
      const path = previous && available.includes(previous) ? previous : available[0];
      setReady(true);
      if (path) setActive(draftKey(account, scope, path));
    }).catch(() => { if (!cancelled) setError("Lokal lagring kunde inte öppnas. Tillåt lagring och ladda om innan du börjar skriva."); });
    return () => { cancelled = true; runner?.stop(); localRunner?.stop(); };
  }, [account, scope, store, local, opened, desktop, localFolder?.directory, initialFile]);

  useEffect(() => {
    if (!files || !ready) return;
    void files.tick();
    const timer = setInterval(() => { void files.tick(); }, 2000);
    const refreshFiles = () => { void files.tick(); };
    window.addEventListener("focus", refreshFiles);
    return () => { clearInterval(timer); window.removeEventListener("focus", refreshFiles); };
  }, [files, ready]);

  useEffect(() => {
    if (!notePath) return;
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) localStorage.setItem(noteSelectionKey(account, scope), notePath);
    }).catch(() => { if (!disposed) setError("Valet av anteckning kunde inte sparas på enheten. Kontrollera lokal lagring."); });
    return () => { disposed = true; };
  }, [account, scope, notePath]);

  const firstPath = paths[0];
  useEffect(() => {
    if (!ready || active || !firstPath) return;
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void openNote(firstPath); });
    return () => { disposed = true; };
  }, [ready, active, firstPath, openNote]);

  const runSync = useCallback(async (force = false, refresh = false) => {
    if (!sync) return;
    const promise = sync.tick(force, refresh);
    saveBarrier.current = promise;
    await promise;
    if (saveBarrier.current === promise) saveBarrier.current = null;
  }, [sync]);
  useEffect(() => {
    if (!sync || !ready) return;
    void runSync();
    const interval = setInterval(() => { void runSync(); }, 1000);
    const wake = () => { sync.retryAuthentication(); void runSync(); };
    window.addEventListener("online", wake); window.addEventListener("focus", wake);
    return () => { clearInterval(interval); window.removeEventListener("online", wake); window.removeEventListener("focus", wake); };
  }, [sync, ready, runSync]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (importBarrier.current || [...store.status.values()].some(status => status !== "stored")) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); window.removeEventListener("beforeunload", beforeUnload); };
  }, [store]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    // A second tab may read, but must not overwrite the same IndexedDB draft.
    if (!navigator.locks) return;
    void navigator.locks.request(`gitbsidian-edit:${active}`, { ifAvailable: true }, async lock => {
      if (!lock || cancelled) return;
      await store.flush();
      const persisted = await readDraft(active);
      if (cancelled) return;
      if (persisted && store.status.get(active) !== "failed") store.hydrate(persisted);
      else if (store.get(active)) store.set(store.get(active)!);
      ownedKey.current = active; setLockedKey(active);
      await new Promise<void>(resolve => { release = resolve; if (cancelled) resolve(); });
      await saveBarrier.current;
      await store.flush();
    }).catch(() => setError("Kunde inte låsa eller läsa det lokala utkastet. Exportera texten om den visas."));
    return () => { cancelled = true; ownedKey.current = ""; setLockedKey(""); release?.(); };
  }, [active, store, lockAttempt]);

  const save = useCallback(async () => {
    if (!active || lockedKey !== active) return;
    if (store.get(active)?.conflict) { setCompare(true); return; }
    if (local) { await files?.tick(); return; }
    setError(""); setNotice("");
    await runSync(true);
    if (store.get(active)?.conflict) setCompare(true);
  }, [active, local, files, lockedKey, store, runSync, setCompare, setNotice]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSidebar(true); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [save]);

  async function refresh() { if (files) await files.tick(); else await runSync(true, true); }
  async function openLocalFolder() {
    try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("open_local_folder"); }
    catch (error) { setError(typeof error === "string" ? error : "Kunde inte öppna mappen i Utforskaren."); }
  }
  async function createNote() {
    const parsed = (wiki ? wikiPathSchema : pathSchema).safeParse(/\.(md|txt|csv)$/i.test(newPath) ? newPath : `${newPath}.${wiki ? "md" : newFormat}`);
    if (!newPath.trim() || !parsed.success) { setNewError(wiki ? "Ange ett sidnamn utan mappar eller specialtecken, till exempel Min idé.md." : "Ange ett namn, till exempel Projekt/Min idé.md."); return; }
    if (paths.includes(parsed.data) || store.values().some(value => value.path === parsed.data)) { setNewError("En anteckning med den sökvägen finns redan."); return; }
    const created = newDraft(account, scope, { path: parsed.data, sha: null, text: /\.csv$/i.test(parsed.data) ? "Namn,Värde\n" : /\.txt$/i.test(parsed.data) ? "" : `# ${parsed.data.split("/").pop()!.replace(/\.md$/i, "")}\n\n` });
    if (!navigator.locks) { setNewError("Din webbläsare behöver stöd för Web Locks."); return; }
    try {
      const createdSafely = await navigator.locks.request(`gitbsidian-edit:${created.key}`, { ifAvailable: true }, async lock => {
        if (!lock || await readDraft(created.key)) return false;
        store.set(created); await store.flush(); return store.status.get(created.key) === "stored";
      });
      if (!createdSafely) { setNewError("Sökvägen används i en annan flik, eller så kunde utkastet inte lagras. Välj ett annat namn eller kontrollera lokal lagring."); return; }
      setActive(created.key); setNewNote(false); setNewPath(""); setNewError(""); setSidebar(false); setNotice("");
    } catch { setNewError("Utkastet kunde inte lagras. Kontrollera webbläsarens lagringsutrymme."); }
  }
  function importFile(file: File) {
    if (!ready || importBarrier.current || closing.current) return;
    setError(""); setNotice(""); setImporting(true);
    const generation = localAccess()?.generation;
    const task = (async () => {
      try {
        const schema = wiki ? wikiPathSchema : pathSchema;
        if (!schema.safeParse(file.name).success) throw new Error(wiki ? "Wiki stöder Markdown. Välj en .md-fil med ett giltigt sidnamn." : "Välj en Markdown-, TXT- eller CSV-fil (.md, .txt eller .csv) med ett giltigt filnamn.");
        if (file.size > MAX_NOTE_BYTES) throw new Error("Filen får vara högst 1 MiB.");
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
        if (text.includes("\u0000")) throw new Error("Filen måste vara text i UTF-8.");
        if (!navigator.locks) throw new Error("Webbläsaren behöver stöd för Web Locks.");
        const imported = await navigator.locks.request(`gitbsidian-file-import:${account}:${scope}`, async () => {
          const cache = local ? undefined : await readWorkspace(cacheKey(account, scope));
          const existingPaths = new Set([...paths, ...(cache?.notes.map(note => note.path) || [])]);
          for (let suffix = 0; suffix < 1000; suffix++) {
            const path = suffix ? file.name.replace(/(\.(?:md|txt|csv))$/i, ` (${suffix + 1})$1`) : file.name;
            if (!schema.safeParse(path).success) throw new Error("Filnamnet är för långt. Korta det och försök igen.");
            if (existingPaths.has(path)) continue;
            const created = newDraft(account, scope, { path, text, sha: null });
            const result = await navigator.locks.request(`gitbsidian-edit:${created.key}`, { ifAvailable: true }, async lock => {
              if (!lock || store.get(created.key) || await readDraft(created.key)) return null;
              if (sync?.state.cache.notes.some(note => note.path === path)) return null;
              if (!local && (localAccess()?.generation !== generation || String(localAccess()?.user?.id) !== account)) throw new Error("Arbetsytans konto har ändrats. Importera filen på nytt i rätt arbetsyta.");
              store.set(created); await store.flush();
              if (store.status.get(created.key) !== "stored") throw new Error("Filen kunde inte lagras på enheten.");
              return created;
            });
            if (result) return result;
          }
          throw new Error("För många filer med samma namn. Byt filnamn och försök igen.");
        });
        setActive(imported.key); setMode("edit"); setSidebar(false); setFilter("");
        setNotice(`${imported.path} importerades${local ? " till din lokala skrivyta." : wiki ? " och köades för synk till GitHub Wiki." : " och köades för synk till den valda repository-mappen."}`);
      } catch (error) { setError(error instanceof TypeError ? "Filen måste vara kodad som UTF-8." : error instanceof Error ? error.message : "Filen kunde inte importeras."); }
    })().finally(() => { importBarrier.current = null; setImporting(false); });
    importBarrier.current = task;
  }
  async function exportDraft() {
    if (!draft) return;
    if (desktop) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("export_markdown", { name: draft.path.split("/").pop()!, text: draft.text });
      } catch (error) { setError(typeof error === "string" ? error : "Kunde inte exportera anteckningen. Utkastet finns kvar."); }
      return;
    }
    const url = URL.createObjectURL(new Blob([draft.text], { type: csv ? "text/csv;charset=utf-8" : plainText ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = draft.path.split("/").pop()!; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function prepareLogout() {
    await importBarrier.current;
    await sync?.drain();
    await store.flush();
    if ([...store.status.values()].some(status => status !== "stored")) { setError("Lokal lagring misslyckades. Exportera texten innan du loggar ut."); return; }
    try { setLogoutCount((await listDrafts(account)).filter(dirty).length); }
    catch { setError("Kunde inte kontrollera utkasten. Exportera texten innan du loggar ut."); }
  }
  async function chooseLocalFolder() {
    closing.current = true; setChoosingFolder(true);
    try {
      await importBarrier.current; await saveBarrier.current;
      await files?.flush(); await store.flush();
      if ([...store.status.values()].some(status => status !== "stored")) throw new Error("Utkasten kunde inte lagras. Exportera dem innan du byter mapp.");
      const { invoke } = await import("@tauri-apps/api/core");
      const folder = await invoke<{ directory: string; scope: string } | null>("choose_local_folder");
      if (folder) onLocalFolder?.(folder);
    } catch (error) { setError(typeof error === "string" ? error : error instanceof Error ? error.message : "Kunde inte byta rotmapp."); }
    finally { closing.current = false; setChoosingFolder(false); }
  }
  async function newWindow() {
    try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("new_app_window"); }
    catch (error) { setError(typeof error === "string" ? error : "Kunde inte öppna ett nytt fönster."); }
  }
  async function prepareUpdate() {
    closing.current = true;
    await importBarrier.current; await saveBarrier.current;
    await files?.flush(); await store.flush();
    if (!ready || files?.state.error || [...store.status.values()].some(status => status !== "stored")) {
      throw new Error(files?.state.error || "Utkasten kunde inte sparas. Uppdateringen har avbrutits.");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("prepare_app_update");
  }
  async function leave(action: () => void) {
    closing.current = true;
    await importBarrier.current;
    await saveBarrier.current;
    await files?.flush();
    await store.flush();
    if (files?.state.error) { closing.current = false; setError(files.state.error); return; }
    if ([...store.status.values()].some(status => status !== "stored")) {
      closing.current = false; setError("Utkastet kunde inte lagras. Exportera texten innan du lämnar arbetsytan."); return;
    }
    action(); closing.current = false;
  }
  useEffect(() => {
    if (!desktop || !("__TAURI_INTERNALS__" in window)) return;
    let disposed = false; let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      const stop = await appWindow.onCloseRequested(async event => {
        event.preventDefault();
        if (["saving", "installing"].includes(appUpdates.state.phase)) return;
        closing.current = true;
        await importBarrier.current; await saveBarrier.current; await files?.flush(); await store.flush();
        if (files?.state.error) { closing.current = false; setError(files.state.error); return; }
        if ([...store.status.values()].some(status => status !== "stored")) { closing.current = false; setError("Utkastet kunde inte lagras. Exportera texten innan du stänger appen."); return; }
        await appWindow.destroy();
      });
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => setError("Kunde inte aktivera skyddet vid stängning. Exportera viktigt arbete."));
    return () => { disposed = true; unlisten?.(); };
  }, [desktop, store, files]);
  const stats = useMemo(() => ({ words: draft?.text.trim().split(/\s+/).filter(Boolean).length || 0, chars: draft?.text.length || 0 }), [draft?.text]);
  let status: string = sv.local;
  if (draft) {
    if (localStatus === "failed") status = sv.failed;
    else if (localStatus === "writing") status = sv.writing;
    else if (files?.state.error) status = "Utkastet finns kvar · filen kunde inte sparas";
    else if (files && draft.conflict) status = "Filen har ändrats på datorn · jämför versionerna";
    else if (files) status = dirty(draft) ? "Utkast sparat · väntar på filsparning" : "Sparat till lokal fil";
    else if (sync?.state.syncing === active) status = "Synkar med GitHub…";
    else if (draft.conflict) status = sv.conflict;
    else if (authExpired) status = sv.auth;
    else if (!online) status = sv.offline;
    else if (draft.pending) status = "Sparning behöver kontrolleras – utkastet finns kvar";
    else if (!local && dirty(draft)) status = "Utkast sparat lokalt · väntar på synk";
    else if (!local && !dirty(draft)) status = draft.savedAt ? `Synkat · Sparat till GitHub ${new Date(draft.savedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : "Hämtat från GitHub";
  }
  return <div className="workbench" inert={choosingFolder}>
    <aside className={`sidebar ${sidebar ? "mobile-open" : ""}`}>
      <div className="sidebar-brand"><button className="brand text-button" onClick={() => void leave(onHome)}><span className="brand-symbol"><Layers3 size={20} /></span>{sv.name}</button><button className="icon-button mobile-only" onClick={() => setSidebar(false)} aria-label="Stäng navigation"><X size={20} /></button></div>
      <button className="workspace-button" onClick={() => void leave(onWorkspace)}><span className="workspace-icon">{local ? <FileText size={20} /> : <Github size={20} />}</span><span><strong>{local ? localFolder?.directory.split(/[\\/]/).filter(Boolean).pop() || "Min lokala skrivyta" : opened.workspace.repository.fullName.split("/")[1]}</strong><small>{local ? "Bara på den här enheten" : `${wiki ? "Wiki" : "Repositoryfiler"} · ${opened.workspace.repository.fullName.split("/")[0]}`}</small></span><ChevronDown size={16} /></button>
      {workspaceUrl && <a className="workspace-link" href={workspaceUrl} target="_blank" rel="noreferrer">{wiki ? "Öppna wiki på GitHub" : "Öppna repository på GitHub"}<ArrowUpRight size={14} /></a>}
      {local && desktop && <button className="workspace-link text-button" title={files?.state.directory || localFolder?.directory || "Dokument/nand"} onClick={() => void openLocalFolder()}>Öppna i Utforskaren <ArrowUpRight size={14} /></button>}
      {desktop && onLocalFolder && <button className="text-button" disabled={!ready} onClick={() => void chooseLocalFolder()}><Layers3 size={16} />Öppna lokal mapp</button>}<div className="sidebar-tools"><div className="search-field"><Search size={16} /><input ref={inputRef} aria-label="Sök filnamn" placeholder="Hitta en anteckning…" value={filter} onChange={event => setFilter(event.target.value)} /><kbd>Ctrl K</kbd></div><button className="new-note-button" onClick={() => setNewNote(true)} disabled={!ready}><FilePlus2 size={17} /> Ny anteckning <span>+</span></button></div>
      <input ref={fileInputRef} type="file" accept={wiki ? ".md,text/markdown" : ".md,.txt,.csv,text/markdown,text/plain,text/csv"} aria-label="Fil att importera" hidden disabled={!ready || importing} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) importFile(file); }} /><div className="tree-heading"><span>FILER</span><span>{paths.length}</span></div>
      <div className="tree-scroll">{local && desktop && localFolder && files && <details className="local-browser" onToggle={event => setBrowseFiles(event.currentTarget.open)}><summary>Utforska rotmappen</summary>{browseFiles && <LocalExplorer directory={localFolder.directory} selected={new Set(paths)} onInclude={async path => { const key = await files.include(path); setActive(key); setLockAttempt(value => value + 1); setFilter(""); }} onExclude={async path => { await files.exclude(path); if (draft?.path === path) setActive(""); }} />}</details>}<FileTree paths={visiblePaths} active={draft?.path} dirtyPaths={dirtyPaths} onOpen={path => void openNote(path)} />{ready && !visiblePaths.length && <p className="empty-tree">{filter ? "Inga matchande filnamn." : "Din nästa tanke börjar här."}</p>}</div>
      <div className="sidebar-bottom"><div className="local-explanation"><span className="tiny-dot" /><div>{local ? "Ett eget litet skrivrum" : wiki ? "Dina sidor, i GitHub Wiki" : "Dina filer, i ditt repository"}<p>{local ? (desktop ? "Texten lagras i appen på den här datorn. Exportera det du vill behålla." : "Texten lagras i den här webbläsaren. Exportera det du vill behålla.") : `${dirtyPaths.size} utkast i kön. Synkas automatiskt när appen är öppen.`}</p></div></div>
        <div className="account-row"><span className="account-avatar">{local ? "L" : user!.login[0].toUpperCase()}</span><span>{local ? "Lokalt läge" : `@${user!.login}`}</span><button className="icon-button" onClick={onTheme} aria-label={dark ? "Ljust tema" : "Mörkt tema"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>{!local && <button className="icon-button" onClick={prepareLogout} aria-label="Logga ut"><LogOut size={16} /></button>}</div>
      </div>
    </aside>
    {sidebar && <button className="sidebar-scrim" aria-label="Stäng navigation" onClick={() => setSidebar(false)} />}
    <main className="workspace-main">
      <header className="workspace-toolbar"><div className="breadcrumbs"><button className="icon-button mobile-only" onClick={() => setSidebar(true)} aria-label="Öppna navigation"><Menu size={20} /></button><FileText size={16} /><span>{draft?.path || "Din arbetsyta"}</span></div><div className="toolbar-actions">{desktop && updateState.phase === "available" && <button className="text-button" onClick={() => setUpdatesOpen(true)}>Ny version</button>}<div className="view-switch" aria-label="Visningsläge">{(plainText ? [["edit", "Text"]] as const : csv ? [["edit", "Tabell"], ["preview", "CSV-text"]] as const : [["edit", "Skriv"], ["split", "Delad vy"], ["preview", "Läs"]] as const).map(([value, label]) => <button key={value} className={(plainText || (csv && mode === "split") ? "edit" : mode) === value ? "selected" : ""} aria-pressed={(plainText || (csv && mode === "split") ? "edit" : mode) === value} onClick={() => setMode(value)}>{label}</button>)}</div><ActionMenu>{desktop && <button onClick={() => void newWindow()}><Layers3 size={16} />Nytt fönster</button>}
        <button onClick={() => fileInputRef.current?.click()} disabled={!ready || importing}><Upload size={16} />{importing ? "Importerar…" : "Importera fil"}</button><small>{wiki ? "Markdown till vald wiki" : local ? "Markdown, TXT och CSV till skrivytan" : "Markdown, TXT och CSV till vald mapp"}</small>
        <button onClick={() => void exportDraft()} disabled={!draft}><Download size={16} />{csv ? "Exportera CSV" : plainText ? "Exportera TXT" : "Exportera Markdown"}</button>
        {(!local || desktop) && <button onClick={() => void refresh()} disabled={busy || files?.state.running}><RefreshCw size={16} />{local ? "Uppdatera från mappen" : "Uppdatera från GitHub"}</button>}
        <button onClick={() => setDetails(!details)} aria-pressed={details}><PanelRight size={16} />Visa information</button>
        {local && <button onClick={() => void leave(onWorkspace)}><Github size={16} />Anslut GitHub</button>}
        {local && desktop && onLocalFolder && <button disabled={!ready} onClick={() => void chooseLocalFolder()}><Layers3 size={16} />Välj rotmapp</button>}
        {desktop && <button disabled={!ready} onClick={() => { setUpdatesOpen(true); if (appUpdates.state.phase !== "available") void appUpdates.check(true); }}><Download size={16} />Appuppdateringar</button>}
      </ActionMenu></div></header>
      <div className="document-heading"><div><div className="eyebrow">{local ? "UTKAST PÅ DEN HÄR ENHETEN" : wiki ? "GITHUB WIKI" : opened.workspace.root || "DIN KUNSKAPSSAMLING"}</div><h1>{draft?.path.split("/").pop()?.replace(/\.(md|txt|csv)$/i, "") || "Plats för en ny tanke."}</h1></div><div className="document-actions">{!local && <button className="primary save-button" onClick={save} disabled={!draft || locked || (busy && !draft.conflict)}>{sync?.state.syncing === active ? <LoaderCircle className="spin" size={17} /> : <CloudUpload size={17} />}{draft?.conflict ? "Jämför versioner" : draft?.pending ? "Kontrollera och spara" : wiki ? "Spara till GitHub Wiki" : sv.save}</button>}</div></div>
      {(error || files?.state.error || sync?.state.error) && <div className="inline-message error-message" role="alert">{error || files?.state.error || sync?.state.error}{sync?.state.error && <><button onClick={() => void refresh()} disabled={busy}>Försök synka igen</button><button onClick={() => void leave(onWorkspace)}>Byt arbetsyta</button></>}<button className="icon-button" onClick={() => setError("")} aria-label="Stäng meddelande"><X size={15} /></button></div>}
      {notice && <div className="inline-message hint" role="status">{notice}</div>}
      {!local && <div className="offline-summary"><span>{sync?.state.downloading ? `Hämtar för offlinearbete: ${sync.state.completed} av ${sync.state.total}` : `${entries.filter(entry => allDrafts.some(value => value.path === entry.path && value.baseSha !== null && store.status.get(value.key) === "stored")).length} av ${entries.length} anteckningar finns på enheten`}</span><details><summary>Offline och synkkö</summary><p>Hämtade anteckningar kan redigeras utan giltig GitHub-inloggning på den här enheten. Utloggning döljer kontots lokala data. Synk sker när appen är öppen, med giltig inloggning och aktuell GitHub-åtkomst.</p>{entries.filter(entry => !allDrafts.some(value => value.path === entry.path && (value.baseSha === entry.sha || value.conflict?.remote.sha === entry.sha))).map(entry => <p key={entry.path}>{entry.path}: {sync?.state.cache.unavailable[entry.path] || "Väntar på hämtning av senaste versionen"}</p>)}{allDrafts.filter(dirty).map(value => <p key={value.key}><button onClick={() => void openNote(value.path)}>{value.path}</button>: {value.conflict ? "Konflikt – kräver granskning" : value.syncError?.message || "Väntar på synk"}</p>)}<button onClick={() => void refresh()} disabled={busy}>Hämta och synka nu</button></details></div>}
      {authExpired && <div className="inline-message">{onReconnect ? <button onClick={onReconnect}>Logga in igen med samma konto →</button> : <a href="/api/auth/login">Logga in igen med samma konto →</a>}</div>}
      {draft && locked && <div className="inline-message hint">Anteckningen är skrivskyddad. Stäng den i andra flikar. Webbläsaren måste stödja Web Locks.<button onClick={() => setLockAttempt(value => value + 1)}>Försök igen</button></div>}
      {draft?.conflict && <div className="inline-message conflict-message">{files ? "Filen har ändrats på datorn." : "Det finns en annan version på GitHub."}<button onClick={() => setCompare(true)}>Jämför versionerna</button></div>}
      <div className="editor-and-info"><div className={`document-body mode-${plainText ? "edit" : mode}`}>
        {draft && plainText ? <section className="editor-pane" aria-label="Texteditor"><Suspense fallback={<p className="editor-loading">Öppnar textfilen…</p>}><Editor key={draft.key} value={draft.text} onChange={text => store.update(draft.key, current => ({ ...current, text, updatedAt: Date.now() }))} onSave={save} readOnly={locked || !!draft.conflict} dark={dark} format="text" label="Textfilens innehåll" /></Suspense></section> : draft && csv ? <Suspense fallback={<p className="editor-loading">Öppnar CSV-filen…</p>}>{mode === "preview" ? <section className="editor-pane"><Editor key={draft.key} value={draft.text} onChange={text => store.update(draft.key, current => ({ ...current, text, updatedAt: Date.now() }))} onSave={save} readOnly={locked || !!draft.conflict} dark={dark} format="text" /></section> : <CsvEditor key={draft.key} fileKey={draft.key} value={draft.text} onChange={text => store.update(draft.key, current => ({ ...current, text, updatedAt: Date.now() }))} readOnly={locked || !!draft.conflict} />}</Suspense> : draft ? <>{mode !== "preview" && <section className="editor-pane" aria-label="Markdown-editor"><div className="pane-label">MARKDOWN <span>Vanlig text. Alla möjligheter.</span></div><Suspense fallback={<p className="editor-loading">Öppnar skrivytan…</p>}><Editor key={draft.key} value={draft.text} onChange={text => store.update(draft.key, current => ({ ...current, text, updatedAt: Date.now() }))} onSave={save} readOnly={locked || !!draft.conflict} dark={dark} /></Suspense></section>}{mode !== "edit" && <section className="preview-pane"><div className="pane-label">FÖRHANDSVISNING <span><span className="tiny-dot" /> Live</span></div><Preview text={draft.text} /></section>}</> : <div className="empty-document"><FilePlus2 size={38} strokeWidth={1} /><h2>{ready ? "Börja med en anteckning." : "Öppnar din arbetsyta…"}</h2><p>En idé, en fråga eller något du vill minnas.</p><button className="primary" disabled={!ready} onClick={() => setNewNote(true)}>Ny anteckning <ArrowUpRight size={16} /></button></div>}
      </div>{details && <aside className="info-panel"><div className="info-heading"><Info size={16} /><h2>Om anteckningen</h2><button className="icon-button" onClick={() => setDetails(false)} aria-label="Stäng information"><X size={16} /></button></div><dl><dt>Format</dt><dd>{csv ? "CSV" : plainText ? "TXT" : "Markdown"} · UTF-8</dd><dt>Sökväg</dt><dd>{draft?.path || "—"}</dd><dt>Lagring</dt><dd>{local ? (desktop ? files?.state.directory || localFolder?.directory || "Dokument/nand" : "Den här webbläsaren") : `${wiki ? "GitHub Wiki" : "Repositoryfiler"} · ${opened.workspace.repository.fullName}`}</dd>{!local && <><dt>Gren</dt><dd>{opened.workspace.branch}</dd></>}<dt>Ord</dt><dd>{stats.words}</dd></dl><p className="hint">Lokala utkast är inte en permanent säkerhetskopia. Webbläsardata kan rensas.</p><p className="hint">Länkar, bakåtlänkar och egenskapsvyer kommer i nästa etapp.</p></aside>}</div>
      <footer className="statusbar"><span className={`save-state ${localStatus === "failed" || draft?.conflict ? "warning" : ""}`} role="status">{!online ? <WifiOff size={14} /> : busy || localStatus === "writing" ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{draft ? status : "Redo för din nästa tanke"}</span><span className="status-stats">{!local && <span><GitBranch size={13} />{opened.workspace.branch}</span>}<span>{stats.words} ord</span><span>{stats.chars} tecken</span><span>{csv ? "CSV" : plainText ? "TXT" : "Markdown"}</span></span></footer>
    </main>
    {desktop && <AppUpdater open={updatesOpen} onClose={() => setUpdatesOpen(false)} prepare={prepareUpdate} release={async () => { try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("resume_after_update_error"); } finally { closing.current = false; } }} />}
    {newNote && <Dialog title="En ny anteckning" onClose={() => setNewNote(false)}><form onSubmit={event => { event.preventDefault(); void createNote(); }}><label>{wiki ? "Sidnamn" : "Namn och eventuell mapp"}<input autoFocus placeholder={wiki ? "Till exempel Min idé.md" : "Till exempel Projekt/Min idé.md"} value={newPath} onChange={event => setNewPath(event.target.value)} /></label>{!wiki && <label>Filtyp<select value={newFormat} onChange={event => { setNewFormat(event.target.value); setNewPath(path => path.replace(/\.(md|txt|csv)$/i, `.${event.target.value}`)); }}><option value="md">Markdown (.md)</option><option value="txt">Text (.txt)</option><option value="csv">CSV-tabell (.csv)</option></select></label>}<p className="hint">Anteckningen skapas som ett lokalt utkast{local ? "." : wiki ? " och synkas automatiskt till GitHub Wiki. Använd sidnamn utan mappar." : " och synkas automatiskt till GitHub."}</p>{newError && <p className="error-message" role="alert">{newError}</p>}<div className="dialog-actions"><button type="button" onClick={() => setNewNote(false)}>Avbryt</button><button className="primary" type="submit">Skapa anteckning <FilePlus2 size={16} /></button></div></form></Dialog>}
    {compare && draft?.conflict && <ConflictDialog location={files ? "den lokala mappen" : "GitHub"} draft={draft} onClose={() => setCompare(false)} onResolve={text => {
      store.update(draft.key, current => ({ ...current, text, baseText: current.conflict!.remote.text, baseSha: current.conflict!.remote.sha, pending: undefined, conflict: undefined, syncError: undefined, updatedAt: Date.now() })); setCompare(false); setNotice(files ? "Det granskade resultatet är köat för sparning till fil." : "Det granskade resultatet är köat för synk till GitHub.");
    }} />}
    {logoutCount !== null && <Dialog title="Logga ut från GitHub" onClose={() => setLogoutCount(null)}><p>{logoutCount ? `${logoutCount} utkast är ännu inte sparade till GitHub. De finns kvar i den här webbläsaren och visas först när du loggar in med samma konto igen.` : "Dina lokala anteckningar döljs när du loggar ut."}</p><p className="hint">Spara till GitHub eller exportera viktigt arbete innan du rensar webbläsardata.</p><div className="dialog-actions"><button onClick={() => setLogoutCount(null)}><ArrowLeft size={16} /> Tillbaka</button><button className="primary" onClick={() => { setLogoutCount(null); void onLogout(); }}>Logga ut</button></div></Dialog>}
  </div>;
}
