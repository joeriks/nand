import type { NoteEntry, RemoteNote, Repository, Workspace } from "@/lib/types";
import { encodePath, MAX_NOTE_BYTES, repositoryPath } from "@/lib/validation";
import { AppError } from "./errors";

type GitTreeEntry = { path: string; sha: string; mode: string; type: string; size?: number };
type GitTree = { tree: GitTreeEntry[]; truncated: boolean };
type GitRepo = { id: number; full_name: string; default_branch: string; private: boolean; has_wiki?: boolean };
const cooldowns = new Map<string, number>();

export class GitHub {
  constructor(private token: string) {}
  async request<T>(path: string, method = "GET", data?: unknown): Promise<T> {
    const until = cooldowns.get(this.token) || 0;
    if (until > Date.now()) throw new AppError(429, "rate-limit", "GitHub ber oss vänta. Försök igen efter pausen.", undefined, Math.ceil((until - Date.now()) / 1000));
    cooldowns.delete(this.token);
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
    } catch { throw new AppError(503, "network", "Kontakten med GitHub avbröts. Utkastet finns kvar."); }
    if (!response.ok) {
      if (response.status === 401) throw new AppError(401, "authentication", "Logga in igen. Dina lokala utkast finns kvar.");
      if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) {
        const retry = Math.max(1, Number(response.headers.get("retry-after")) || (Number(response.headers.get("x-ratelimit-reset")) * 1000 - Date.now()) / 1000 || 60);
        // Retain only active cooldowns, never an indefinite token cache.
        for (const [key, value] of cooldowns) if (value <= Date.now()) cooldowns.delete(key);
        cooldowns.set(this.token, Date.now() + retry * 1000);
        throw new AppError(429, "rate-limit", "GitHubs API-gräns är nådd. Utkastet finns kvar; försök igen efter pausen.", undefined, Math.ceil(retry));
      }
      if (response.status === 404) throw new AppError(404, "not-found", "Filen, grenen eller repositoryt finns inte, eller så saknas åtkomst.");
      if ([403, 409, 422].includes(response.status)) throw new AppError(response.status, "github-write", "GitHub avvisade ändringen. Kontrollera åtkomst och grenregler, eller välj en tillåten arbetsgren.");
      throw new AppError(502, "github", "GitHub kunde inte slutföra anropet. Försök igen senare.");
    }
    return response.json() as Promise<T>;
  }
  async repositories(installationId?: number): Promise<Repository[]> {
    const installations: { id: number }[] = [];
    if (installationId) installations.push({ id: installationId });
    else {
      for (let page = 1; ; page++) {
        const data = await this.request<{ installations: { id: number }[] }>(`/user/installations?per_page=100&page=${page}`);
        installations.push(...data.installations);
        if (data.installations.length < 100) break;
      }
    }
    const repositories: Repository[] = [];
    for (const installation of installations) {
      for (let page = 1; ; page++) {
        const data = await this.request<{ repositories: GitRepo[] }>(`/user/installations/${installation.id}/repositories?per_page=100&page=${page}`);
        repositories.push(...data.repositories.map(repo => ({ id: repo.id, fullName: repo.full_name, defaultBranch: repo.default_branch, installationId: installation.id, private: repo.private, ...(repo.has_wiki === undefined ? {} : { hasWiki: repo.has_wiki }) })));
        if (data.repositories.length < 100) break;
      }
    }
    return repositories;
  }
  async authorize(repositoryId: number, installationId: number): Promise<Repository> {
    const repository = (await this.repositories(installationId)).find(repo => repo.id === repositoryId);
    if (!repository) throw new AppError(403, "repository-access", "Appen eller ditt konto saknar åtkomst till detta repository. Utkasten finns kvar.");
    return repository;
  }
  repoPath(repository: Repository) { return `/repos/${encodePath(repository.fullName)}`; }
  async authorizeWiki(repository: Repository, write = false) {
    const metadata = await this.request<{ id: number; has_wiki: boolean; archived: boolean; permissions?: { push?: boolean } }>(this.repoPath(repository));
    if (metadata.id !== repository.id || !metadata.has_wiki) throw new AppError(409, "wiki-disabled", "Wiki är inte aktiverad för detta repository. Aktivera Wiki i GitHub och skapa en första sida där.");
    if (write && (metadata.archived || !metadata.permissions?.push)) throw new AppError(403, "wiki-permission", "Ditt konto saknar skrivrättighet till denna Wiki, eller så är repositoryt arkiverat. Utkastet finns kvar.");
  }
  async branches(repository: Repository): Promise<string[]> {
    const branches: string[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.request<{ name: string }[]>(`${this.repoPath(repository)}/branches?per_page=100&page=${page}`);
      branches.push(...batch.map(branch => branch.name));
      if (batch.length < 100) break;
    }
    return branches;
  }
  async branchTree(workspace: Workspace): Promise<string> {
    const branch = await this.request<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(`${this.repoPath(workspace.repository)}/branches/${encodeURIComponent(workspace.branch)}`);
    return branch.commit.commit.tree.sha;
  }
  private tree(repository: Repository, sha: string, recursive = false) {
    return this.request<GitTree>(`${this.repoPath(repository)}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`);
  }
  private async descend(repository: Repository, sha: string, parts: string[]): Promise<string | null> {
    for (const part of parts) {
      const data = await this.tree(repository, sha);
      if (data.truncated) throw new AppError(413, "tree-limit", "En mapp är för stor för att läsas fullständigt.");
      const entry = data.tree.find(entry => entry.path === part);
      if (!entry) return null;
      if (entry.type !== "tree") throw new AppError(400, "path", "Sökvägen passerar en fil, symbolisk länk eller submodul.");
      sha = entry.sha;
    }
    return sha;
  }
  async notes(workspace: Workspace): Promise<NoteEntry[]> {
    const headTree = await this.branchTree(workspace);
    const rootTree = await this.descend(workspace.repository, headTree, workspace.root ? workspace.root.split("/") : []);
    if (!rootTree) return [];
    const data = await this.tree(workspace.repository, rootTree, true);
    let entries = data.tree;
    if (data.truncated) {
      entries = [];
      const queue = [{ sha: rootTree, prefix: "" }];
      while (queue.length) {
        const item = queue.shift()!;
        const subtree = await this.tree(workspace.repository, item.sha);
        if (subtree.truncated) throw new AppError(413, "tree-limit", "En mapp är för stor för att läsas fullständigt.");
        for (const entry of subtree.tree) {
          const path = item.prefix + entry.path;
          if (entry.type === "tree") queue.push({ sha: entry.sha, prefix: path + "/" });
          else entries.push({ ...entry, path });
        }
      }
    }
    return entries.filter(entry => entry.type === "blob" && ["100644", "100755"].includes(entry.mode) && /\.(md|csv)$/i.test(entry.path))
      .map(entry => ({ path: entry.path, sha: entry.sha, size: entry.size || 0 })).sort((a, b) => a.path.localeCompare(b.path, "sv"));
  }
  async read(workspace: Workspace, path: string): Promise<RemoteNote> {
    const fullPath = repositoryPath(workspace.root, path);
    const parts = fullPath.split("/");
    const name = parts.pop()!;
    const head = await this.branchTree(workspace);
    const parent = await this.descend(workspace.repository, head, parts);
    if (!parent) return { path, text: "", sha: null };
    const tree = await this.tree(workspace.repository, parent);
    if (tree.truncated) throw new AppError(413, "tree-limit", "Mappen kunde inte läsas fullständigt.");
    const entry = tree.tree.find(entry => entry.path === name);
    if (!entry) return { path, text: "", sha: null };
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new AppError(400, "file-type", "Endast vanliga Markdown- och CSV-filer kan redigeras.");
    if ((entry.size || 0) > MAX_NOTE_BYTES) throw new AppError(413, "size", "Anteckningar större än 1 MiB stöds inte ännu.");
    return this.readEntry(workspace, { path, sha: entry.sha, size: entry.size || 0 });
  }
  // Only call with an entry from this request's authorized workspace tree.
  async readEntry(workspace: Workspace, entry: NoteEntry): Promise<RemoteNote> {
    if (entry.size > MAX_NOTE_BYTES) throw new AppError(413, "size", "Anteckningar större än 1 MiB stöds inte ännu.");
    const blob = await this.request<{ content: string; encoding: string }>(`${this.repoPath(workspace.repository)}/git/blobs/${entry.sha}`);
    if (blob.encoding !== "base64") throw new AppError(422, "encoding", "Filens kodning stöds inte.");
    const bytes = Buffer.from(blob.content, "base64");
    if (bytes.length > MAX_NOTE_BYTES) throw new AppError(413, "size", "Anteckningar större än 1 MiB stöds inte ännu.");
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes("\u0000")) throw new Error("binary");
      return { path: entry.path, text, sha: entry.sha };
    } catch { throw new AppError(422, "encoding", "Anteckningen måste vara en textfil i UTF-8."); }
  }
  async write(workspace: Workspace, input: { path: string; text: string; baseSha: string | null }): Promise<RemoteNote> {
    const fullPath = repositoryPath(workspace.root, input.path);
    const result = await this.request<{ content: { sha: string } }>(`${this.repoPath(workspace.repository)}/contents/${encodePath(fullPath)}`, "PUT", {
      message: `${input.baseSha ? "Uppdatera" : "Skapa"} ${fullPath}`,
      content: Buffer.from(input.text, "utf8").toString("base64"),
      branch: workspace.branch,
      ...(input.baseSha ? { sha: input.baseSha } : {}),
    });
    return { path: input.path, text: input.text, sha: result.content.sha };
  }
}
