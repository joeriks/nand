"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, GitBranch, GitFork as Github, LockKeyhole } from "lucide-react";
import { api } from "@/lib/client-api";
import type { NoteEntry, Repository, StorageMode, Workspace } from "@/lib/types";
import { Dialog } from "./dialog";
export type OpenWorkspace = { id: string; workspace: Workspace; notes: NoteEntry[] };

export type WikiCapability = { available: boolean; reason: string | null };
export function WorkspacePicker({ installUrl, wikiCapability, onOpen, onClose }: { installUrl: string | null; wikiCapability: WikiCapability; onOpen: (result: OpenWorkspace) => void | Promise<void>; onClose: () => void }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [branchResult, setBranchResult] = useState<{ key: string; branches: string[]; error: string } | null>(null);
  const [branchAttempt, setBranchAttempt] = useState(0);
  const [branch, setBranch] = useState("");
  const [root, setRoot] = useState("");
  const [mode, setMode] = useState<StorageMode>("repository");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const opening = useRef(0);
  useEffect(() => () => { opening.current++; }, []);
  const branchKey = `${repository?.installationId}:${repository?.id}:${mode}:${branchAttempt}`;
  const branchLoading = !!repository && mode === "repository" && branchResult?.key !== branchKey;
  const branches = branchResult?.key === branchKey ? branchResult.branches : [];
  const branchError = branchResult?.key === branchKey ? branchResult.error : "";
  useEffect(() => {
    let cancelled = false;
    api<Repository[]>("/api/repositories").then(repos => { if (!cancelled) { setRepositories(repos); setLoading(false); } }).catch(error => { if (!cancelled) { setError(error.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!repository || mode === "wiki") return;
    let cancelled = false;
    api<string[]>(`/api/branches?repositoryId=${repository.id}&installationId=${repository.installationId}`).then(branches => {
      if (!cancelled) { setBranchResult({ key: branchKey, branches, error: "" }); setBranch(branches.includes(repository.defaultBranch) ? repository.defaultBranch : branches[0] || ""); }
    }).catch(error => { if (!cancelled) { setBranchResult({ key: branchKey, branches: [], error: error.message }); setBranch(""); } });
    return () => { cancelled = true; };
  }, [repository, mode, branchKey]);
  const wikiBlocked = !wikiCapability.available || repository?.hasWiki === false;
  async function open() {
    if (!repository || (mode === "repository" ? branchLoading || !branches.includes(branch) : wikiBlocked)) return;
    const request = ++opening.current;
    setLoading(true); setError("");
    try {
      const result = await api<OpenWorkspace>("/api/workspace", "POST", { mode, repositoryId: repository.id, installationId: repository.installationId, branch: mode === "wiki" ? "" : branch, root: mode === "wiki" ? "" : root });
      if (request === opening.current) await onOpen(result);
    } catch (error) { if (request === opening.current) setError(error instanceof Error ? error.message : "Kunde inte öppna arbetsytan."); }
    finally { if (request === opening.current) setLoading(false); }
  }
  return <Dialog title="Öppna din kunskapssamling" onClose={onClose}>
    <p className="muted">Välj var dina Markdown- och CSV-filer finns. Repositoryfiler och Wiki har egna utkast, även om sidorna heter samma sak.</p>
    <fieldset className="storage-options" disabled={loading}><legend>Lagra anteckningar i</legend>
      <label><input type="radio" name="storage-mode" checked={mode === "repository"} onChange={() => { setMode("repository"); setBranchResult(null); setBranch(""); setBranchAttempt(value => value + 1); setError(""); }} /><span><strong>Repositoryfiler</strong><small>Markdown- och CSV-filer på en vald gren.</small></span></label>
      <label><input type="radio" name="storage-mode" checked={mode === "wiki"} onChange={() => { setMode("wiki"); setBranchResult(null); setBranch(""); setBranchAttempt(value => value + 1); setError(""); }} disabled={!wikiCapability.available} /><span><strong>GitHub Wiki</strong><small>Sidor i repositoryts Wiki, med egen historik.</small></span></label>
    </fieldset>
    {!wikiCapability.available && <p className="hint">{wikiCapability.reason || "Wiki-läget är inte tillgängligt på servern."}</p>}
    <label><Github size={16} /> Repository<select value={repository?.id || ""} onChange={event => { setRepository(repositories.find(repo => repo.id === Number(event.target.value)) || null); setBranchResult(null); setBranchAttempt(value => value + 1); setBranch(""); setError(""); }} disabled={loading}>
      <option value="">{loading ? "Hämtar repositories…" : "Välj repository"}</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.fullName}{repo.private ? " · privat" : ""}</option>)}
    </select></label>
    {mode === "repository" && <>
    {branchLoading && <p className="hint" role="status">Hämtar grenar…</p>}
    {repository && !branchLoading && !branchError && !branches.length && <p className="hint" role="status">Inga grenar finns ännu. Skapa en första commit, till exempel en README, på GitHub och hämta sedan grenar igen. <a href={`https://github.com/${repository.fullName}`} target="_blank" rel="noreferrer">Öppna repository på GitHub ↗</a></p>}
    {branchError && <p className="error-message" role="alert">Kunde inte hämta grenar: {branchError}</p>}
    <label><GitBranch size={16} /> Gren<select value={branches.includes(branch) ? branch : ""} disabled={!branches.length || branchLoading || loading} onChange={event => setBranch(event.target.value)}>{!branches.length && <option value="">{branchLoading ? "Hämtar grenar…" : "Ingen gren att välja"}</option>}{branches.map(branch => <option key={branch}>{branch}</option>)}</select></label>
    {repository && <button disabled={branchLoading || loading} onClick={() => { setBranch(""); setBranchAttempt(value => value + 1); }}>Hämta grenar igen</button>}
    <label>Undermapp <span className="muted">(valfritt)</span><input value={root} onChange={event => setRoot(event.target.value)} placeholder="Till exempel anteckningar" disabled={loading} /></label>
    <p className="hint"><LockKeyhole size={15} /> Appens åtkomst väljs i GitHub. Undermappen avgränsar arbetsytan i appen.</p>
    </>}
    {mode === "wiki" && <div className="wiki-explanation"><p>Wiki måste vara aktiverad och ha en första sida på GitHub. Här redigerar du Markdown-sidor i Wikins rot. Standardgrenen väljs automatiskt.</p><p className="hint">När du sparar uppdateras den synliga Wiki-sidan direkt. Wikins åtkomst styrs av repositoryt på GitHub.</p>{repository && <a href={`https://github.com/${repository.fullName}/wiki`} target="_blank" rel="noreferrer">Öppna Wiki på GitHub ↗</a>}{repository?.hasWiki === false && <p className="error-message" role="alert">Wiki är avstängd för detta repository. Aktivera den i GitHubs inställningar eller välj repositoryfiler.</p>}</div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="dialog-actions">{installUrl && <a href={installUrl} target="_blank" rel="noreferrer">Hantera GitHub-åtkomst ↗</a>}<button className="primary" disabled={!repository || loading || (mode === "wiki" ? wikiBlocked : branchLoading || !branches.includes(branch))} onClick={open}>Öppna arbetsyta <ArrowRight size={17} /></button></div>
  </Dialog>;
}
