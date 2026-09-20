"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, GitFork as Github, Layers3, LockKeyhole, Sparkles } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/client-api";
import { sv } from "@/lib/i18n";
import type { User } from "@/lib/types";
import { WorkspacePicker, type OpenWorkspace, type WikiCapability } from "./workspace-picker";
import { Workbench } from "./workbench";
import { BackgroundSync } from "@/components/background-sync";
import { OfflineWorkspaces } from "./offline-workspaces";
import { acceptAccount, localAccess, revokeLocalAccess } from "@/lib/local-access";
import { useWorkspaceSelection } from "./use-workspace-selection";
import { WorkspaceRecovery } from "./workspace-recovery";
import { workspaceKey } from "@/lib/types";
import { Dialog } from "./dialog";

type SessionInfo = { user: User | null; configuration: { ready: boolean; missing: string[]; installUrl: string | null }; storage?: { wiki: WikiCapability } };
export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const { opened, localUser, restoring, restoreError, restore, open: selectWorkspace, show: setOpened } = useWorkspaceSelection(null);
  const [offlinePicker, setOfflinePicker] = useState(false);
  const [picker, setPicker] = useState(false);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api<SessionInfo>("/api/session").catch(() => null);
        if (cancelled) return;
        const params = new URLSearchParams(location.search);
        if (result?.user && !acceptAccount(result.user, params.get("auth") === "success")) result.user = null;
        if (params.get("auth") === "success") history.replaceState(null, "", location.pathname);
        setSession(result);
        setDark(localStorage.getItem("gitbsidian-theme") === "dark");
        if (params.get("auth") === "failed") setError("GitHub-inloggningen kunde inte slutföras. Dina lokala arbetsytor finns kvar.");
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : "Kunde inte starta appen."); }
    }
    void load();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  function toggleTheme() {
    setDark(!dark);
    try { localStorage.setItem("gitbsidian-theme", dark ? "light" : "dark"); } catch { /* Theme can remain ephemeral. */ }
  }
  async function open(result: OpenWorkspace) {
    const user = localAccess()?.user;
    if (!user) return;
    try {
      await selectWorkspace(result);
      if (localAccess()?.user?.id !== user.id) return;
      setPicker(false); setOfflinePicker(false); setError("");
    } catch { setError("Arbetsytan kunde inte sparas på enheten. Kontrollera lokal lagring."); }
  }
  async function logout() {
    try {
      revokeLocalAccess(); setOpened(null); setSession(value => value ? { ...value, user: null } : null);
      await api("/api/auth/logout", "POST");
    } catch { setError("Lokal åtkomst är avslutad. Servern kunde inte bekräfta utloggningen; logga in på nytt för att öppna kontot."); }
  }
  const config = session?.configuration;
  const authenticatedUser = session?.user?.id === localUser?.id ? session?.user : null;
  return <>
    <BackgroundSync user={localUser} activeScope={opened && opened !== "local" ? workspaceKey(opened.workspace) : null} />
    {restoring || restoreError ? <WorkspaceRecovery loading={restoring} error={restoreError} onRetry={() => void restore()} onChoose={() => { if (localUser) setOfflinePicker(true); else setPicker(true); }} /> : opened ? <Workbench key={opened === "local" ? "local" : `${localUser?.id}:${workspaceKey(opened.workspace)}`} opened={opened} user={localUser} dark={dark} onTheme={toggleTheme}
      onWorkspace={() => { if (localUser) setOfflinePicker(true); else { setOpened(null); setSetup(true); } }}
      onLogout={logout} onLocal={() => setOpened("local")} onHome={() => setOpened(null)} /> :
      <main className="landing">
        <header className="landing-header"><Link className="brand" href="/"><span className="brand-symbol"><Layers3 size={22} /></span>{sv.name}<span className="beta">{sv.tagline}</span></Link><a className="quiet-link" href="https://github.com/joeriks/nand" target="_blank" rel="noreferrer">Projektet på GitHub <ArrowUpRight size={15} /></a></header>
        <section className="landing-content">
          <div className="landing-copy"><div className="eyebrow"><span /> EN LUGN PLATS FÖR DINA TANKAR</div>
            <h1>Ge dina idéer<br />ett eget <em>hem.</em></h1>
            <p className="lead">Samla, organisera och redigera din kunskap. Anteckningar och tabeller i vanliga Markdown- och CSV-filer, lokalt och i ditt eget GitHub-repository.</p>
            <div className="landing-actions">{config?.ready && !authenticatedUser ? <a className="primary large" href="/api/auth/login"><Github size={20} />Kom igång med GitHub<ArrowRight size={19} /></a> : <button className="primary large" disabled={!session} onClick={() => { if (authenticatedUser) setPicker(true); else setSetup(true); }}><Github size={20} />{authenticatedUser ? "Öppna en arbetsyta" : "Kom igång med GitHub"}<ArrowRight size={19} /></button>}
              <button className="text-button" onClick={() => setOpened("local")}>Prova skrivytan lokalt <ArrowUpRight size={16} /></button></div>
            {localUser && <button onClick={() => setOfflinePicker(true)}>Öppna hämtade arbetsytor</button>}
            <p className="landing-caption">Dina filer. Din historik. Plats för nästa tanke.</p>
            {authenticatedUser && <p className="hint">Inloggad som @{authenticatedUser.login} <button className="text-button" onClick={logout}>Logga ut</button></p>}
          </div>
          <div className="notebook-art" aria-hidden="true"><div className="art-label"><span className="tiny-dot" /> DIN PERSONLIGA KUNSKAPSSAMLING</div><div className="paper-back" /><div className="paper-front"><div className="paper-meta">ANTECKNING 001 <BookOpen size={18} /></div><div className="paper-title">Allt börjar med<br />en tanke.</div><div className="paper-line long" /><div className="paper-line" /><div className="paper-line medium" /><div className="paper-note"><Sparkles size={17} /> Ge den lite utrymme att växa.</div><div className="paper-bottom"># idéer <span>↗</span></div></div><div className="art-footer"><LockKeyhole size={14} /> Ägs av dig, hela vägen.</div></div>
        </section>
        <section className="landing-features"><div><span>01 / SKRIV</span><h2>Fånga det som kommer.</h2><p>En avskalad Markdown-editor med förhandsvisning och lokala utkast.</p></div><div><span>02 / BEVARA</span><h2>Spara med eftertanke.</h2><p>Ändringar sparas lokalt och synkas till GitHub när anslutning och inloggning fungerar.</p></div><div><span>03 / ÄG</span><h2>Ta kunskapen med dig.</h2><p>Vanliga textfiler i ditt repository. Läsbara idag, användbara imorgon.</p></div></section>
        <footer className="landing-footer"><span>{sv.name} <span className="muted">/</span> {sv.tagline}</span><span>Markdown · CSV · GitHub · Du</span></footer>
      </main>}
    {error && <div className="global-error" role="alert">{error}<button className="text-button" onClick={() => setError("")}>Stäng</button></div>}
    {offlinePicker && localUser && <Dialog title="Dina arbetsytor" onClose={() => setOfflinePicker(false)}><OfflineWorkspaces key={localUser.id} user={localUser} onOpen={result => void open(result)} />{authenticatedUser ? <button onClick={() => { setOfflinePicker(false); setPicker(true); }}>Välj via GitHub</button> : <a href="/api/auth/login">Logga in för att välja fler arbetsytor</a>}</Dialog>}
    {picker && authenticatedUser && <WorkspacePicker key={authenticatedUser.id} installUrl={config?.installUrl || null} wikiCapability={session?.storage?.wiki || { available: false, reason: "Servern har inte angett stöd för Wiki." }} onOpen={open} onClose={() => setPicker(false)} />}
    {setup && <Dialog title="Koppla din GitHub App" onClose={() => setSetup(false)}>
      <p>Projektets GitHub-inloggning behöver konfigureras innan du kan ansluta ett repository. Skrivytan går redan att använda lokalt.</p>
      <ol className="setup-steps"><li>Registrera en GitHub App med <strong>Contents: read & write</strong> och <strong>Metadata: read</strong>.</li><li>Ange callback-adressen <code>http://localhost:3000/api/auth/callback</code> vid lokal körning.</li><li>Fyll i serverns <code>.env.local</code> enligt README och starta om appen. Lägg aldrig hemligheter i anteckningar.</li><li>Installera appen på ett testrepository med en första commit.</li></ol>
      {config?.missing.length ? <p className="hint">Saknad konfiguration: {config.missing.join(", ")}.</p> : <p className="hint">GitHub-inloggningen är konfigurerad.</p>}
      <div className="dialog-actions"><button onClick={() => { setSetup(false); setOpened("local"); }}>Öppna lokal skrivyta</button>{config?.ready && <a className="primary" href="/api/auth/login">Logga in med GitHub <ArrowRight size={17} /></a>}</div>
    </Dialog>}
  </>;
}
