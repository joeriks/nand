import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, FolderOpen, GitFork, Settings, X } from "lucide-react";
import { Workbench } from "@/components/workbench";
import { WorkspacePicker, type OpenWorkspace, type WikiCapability } from "@/components/workspace-picker";
import { Dialog } from "@/components/dialog";
import { api } from "@/lib/client-api";
import { sv } from "@/lib/i18n";
import { version } from "../package.json";
import { workspaceKey, type User } from "@/lib/types";
import { acceptAccount, localAccess, revokeLocalAccess } from "@/lib/local-access";
import { useWorkspaceSelection } from "@/components/use-workspace-selection";
import { WorkspaceRecovery } from "@/components/workspace-recovery";
import { BackgroundSync } from "@/components/background-sync";
import { OfflineWorkspaces } from "@/components/offline-workspaces";

type SessionInfo = { user: User | null; localUser?: User | null; configuration: { ready: boolean; installUrl: string | null }; storage: { wiki: WikiCapability }; settings: { clientId: string; appSlug: string } | null };
type Device = { userCode: string; interval: number; expiresAt: number };
export function DesktopApp() {
  const { opened, localUser, restoring, restoreError, restore, open: selectWorkspace, show: setOpened } = useWorkspaceSelection("local");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [connection, setConnection] = useState(false);
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [clientId, setClientId] = useState("");
  const [appSlug, setAppSlug] = useState("");
  const [device, setDevice] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("gitbsidian-theme") === "dark"; } catch { return false; } });
  const authGeneration = useRef(0);
  const loadSession = useCallback(async () => {
    const result = await api<SessionInfo>("/api/session");
    if (result.user) acceptAccount(result.user);
    setSession(result); setClientId(result.settings?.clientId || ""); setAppSlug(result.settings?.appSlug || "");
    return result;
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await api<SessionInfo>("/api/session");
      if (cancelled) return;
      const known = result.user || result.localUser;
      if (known && !acceptAccount(known)) result.user = null;
      setSession(result); setClientId(result.settings?.clientId || ""); setAppSlug(result.settings?.appSlug || "");
    }
    void load().catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => {
    if (!device) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const generation = authGeneration.current;
    const poll = async () => {
      try {
        const result = await api<{ pending: boolean; interval?: number }>("/api/desktop/auth/poll", "POST");
        if (cancelled || generation !== authGeneration.current) return;
        if (result.pending) timer = setTimeout(poll, (result.interval || device.interval) * 1000);
        else { setDevice(null); const current = await api<SessionInfo>("/api/session"); if (current.user) acceptAccount(current.user, true); await loadSession(); setConnection(false); if (!localAccess()?.user || opened === "local") setPicker(true); window.dispatchEvent(new Event("focus")); }
      } catch (error) { if (!cancelled) { setDevice(null); setError(error instanceof Error ? error.message : "Inloggningen misslyckades."); } }
    };
    timer = setTimeout(poll, device.interval * 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [device, loadSession, opened]);
  function toggleTheme() { setDark(value => !value); try { localStorage.setItem("gitbsidian-theme", dark ? "light" : "dark"); } catch { /* Theme still works for this window. */ } }
  async function startLogin() {
    setBusy(true); setError(""); authGeneration.current++;
    try { setDevice(await api<Device>("/api/desktop/auth/start", "POST")); }
    catch (error) { setError(error instanceof Error ? error.message : "Kunde inte starta inloggningen."); }
    finally { setBusy(false); }
  }
  async function cancelLogin() { authGeneration.current++; setDevice(null); await api("/api/desktop/auth/cancel", "POST").catch(() => {}); }
  async function saveSettings() {
    setBusy(true); setError("");
    try {
      await api("/api/desktop/config", "POST", { clientId: clientId.trim(), appSlug: appSlug.trim() });
      revokeLocalAccess(); await loadSession(); setOpened("local"); setSettings(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Kunde inte spara inställningarna."); }
    finally { setBusy(false); }
  }
  async function open(result: OpenWorkspace) {
    const user = localAccess()?.user;
    if (!user) return;
    try {
      await selectWorkspace(result);
      if (localAccess()?.user?.id !== user.id) return;
      setPicker(false); setConnection(false); setError("");
    } catch { setError("Arbetsytan kunde inte sparas på enheten. Kontrollera lokal lagring."); }
  }
  async function logout() {
    try {
      revokeLocalAccess(); setOpened("local");
      await api("/api/auth/logout", "POST"); await loadSession();
    } catch { setError("Lokalt utloggad. Den sparade GitHub-inloggningen kunde inte tas bort; försök logga ut igen."); }
  }
  const authenticatedUser = session?.user?.id === localUser?.id ? session?.user : null;
  return <>
    <BackgroundSync user={localUser} activeScope={opened && opened !== "local" ? workspaceKey(opened.workspace) : null} />
    {restoring || restoreError || !opened ? <WorkspaceRecovery loading={restoring} error={restoreError} onRetry={() => void restore()} onChoose={() => setConnection(true)} /> : <Workbench key={opened === "local" ? "local" : `${localUser?.id}:${workspaceKey(opened.workspace)}`} opened={opened} user={localUser} dark={dark} onTheme={toggleTheme} onHome={() => setOpened("local")} onWorkspace={() => setConnection(true)} onLogout={logout} desktop onReconnect={() => { setConnection(true); void startLogin(); }} />}
    {connection && <Dialog title="Dina arbetsytor" onClose={() => { setConnection(false); void cancelLogin(); }}>
      {settings ? <form onSubmit={event => { event.preventDefault(); void saveSettings(); }}>
        <p>Anslut din GitHub App. Aktivera <strong>Device flow</strong> och ge appen <strong>Contents: read & write</strong>. Installera den på de repositories du vill använda.</p>
        <label>Client ID<input required value={clientId} onChange={event => setClientId(event.target.value)} placeholder="GitHub-appens Client ID" /></label>
        <label>Appnamn i GitHub-adressen<input required value={appSlug} onChange={event => setAppSlug(event.target.value)} placeholder="Till exempel min-nand-app" /></label>
        <p className="hint">Detta är offentliga appuppgifter. Skrivbordsappen behöver ingen client secret.</p>
        <a href="https://github.com/settings/apps" target="_blank" rel="noreferrer">Öppna GitHubs appinställningar ↗</a>
        <div className="dialog-actions"><button type="button" onClick={() => setSettings(false)}>Tillbaka</button><button className="primary" disabled={busy}>Spara inställningar</button></div>
      </form> : device ? <>
        <p>Öppna GitHub i din vanliga webbläsare och ange koden. Appen väntar på ditt godkännande.</p>
        <div className="device-code">{device.userCode}</div>
        <a className="primary" href="https://github.com/login/device" target="_blank" rel="noreferrer">Godkänn på GitHub <ArrowUpRight size={16} /></a>
        <p className="hint">Koden gäller till {new Date(device.expiresAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}. Inloggningen lagras i datorns säkra lagring.</p>
        <button onClick={() => void cancelLogin()}>Avbryt inloggning</button>
      </> : <div className="desktop-connection">
        <button onClick={() => { setOpened("local"); setConnection(false); }}><FolderOpen size={18} /> Min lokala skrivyta</button>
        {localUser && <OfflineWorkspaces key={localUser.id} user={localUser} onOpen={result => void open(result)} />}
        {authenticatedUser ? <><p>Inloggad som <strong>@{authenticatedUser.login}</strong>.</p><button className="primary" onClick={() => setPicker(true)}><GitFork size={18} /> Välj repository eller Wiki</button></> : <><p>Utkast fungerar offline. Koppla GitHub för att läsa och spara repositoryfiler eller Wiki-sidor.</p><button className="primary" disabled={!session || busy} onClick={() => { if (session?.configuration.ready) void startLogin(); else setSettings(true); }}>{session?.configuration.ready ? "Logga in med GitHub" : "Konfigurera GitHub App"}</button></>}
        {session?.configuration.installUrl && <a href={session.configuration.installUrl} target="_blank" rel="noreferrer">Hantera GitHub-åtkomst ↗</a>}
        <button onClick={() => setSettings(true)} disabled={busy}><Settings size={16} /> GitHub-inställningar</button>
      </div>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="desktop-version">{sv.name} {version} · {sv.tagline}</p>
    </Dialog>}
    {picker && session && authenticatedUser && <WorkspacePicker key={authenticatedUser.id} installUrl={session.configuration.installUrl} wikiCapability={session.storage.wiki} onOpen={open} onClose={() => setPicker(false)} />}
    {error && !connection && <div className="global-error" role="alert">{error}<button className="icon-button" aria-label="Stäng felmeddelande" onClick={() => setError("")}><X size={16} /></button></div>}
  </>;
}
