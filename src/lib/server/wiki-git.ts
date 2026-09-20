import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { NoteEntry, RemoteNote, Repository, User } from "@/lib/types";
import { branchSchema, MAX_NOTE_BYTES, wikiPathSchema } from "@/lib/validation";
import { AppError } from "./errors";

const MAX_WIKI_BYTES = 64 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
export type GitCommand = (directory: string, args: string[], input?: string | Buffer, extraEnv?: Record<string, string | undefined>) => Promise<Buffer>;

/** No credentials in arguments, URLs, config files, stderr responses or inherited Git helpers. */
export function gitEnvironment(token: string, directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "LANG"]) if (process.env[name]) env[name] = process.env[name];
  const config = {
    "credential.helper": "",
    "http.https://github.com/.extraHeader": `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    "http.followRedirects": "false",
    "http.sslVerify": "true",
    "protocol.allow": "never",
    "protocol.https.allow": "always",
    "core.hooksPath": join(directory, "hooks-disabled"),
    "init.templateDir": "",
    "commit.gpgSign": "false",
    "gc.auto": "0",
  };
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_CONFIG_COUNT: String(Object.keys(config).length), GIT_ATTR_NOSYSTEM: "1" });
  Object.entries(config).forEach(([key, value], index) => { env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = value; });
  return env;
}

export function gitCommand(token: string): GitCommand {
  return (directory, args, input, extraEnv) => new Promise((resolve, reject) => {
    const child = execFile(/* turbopackIgnore: true */ process.env.GIT_EXECUTABLE || "git", args, {
      cwd: directory, env: { ...gitEnvironment(token, directory), ...extraEnv }, windowsHide: true,
      encoding: "buffer", maxBuffer: 16 * 1024 * 1024, timeout: 45_000,
    }, (error, stdout, stderr) => {
      if (!error) { resolve(stdout); return; }
      const message = stderr.toString("utf8");
      // Classify privately; never expose raw subprocess errors (they can contain credentials).
      if (error.code === "ENOENT") reject(new AppError(503, "wiki-git-missing", "Wiki-läget kräver Git på appservern. Se Wiki-konfigurationen i README."));
      else if (/GITBSIDIAN_STALE_HEAD|non-fast-forward|fetch first|\[rejected\]/i.test(message)) reject(new AppError(409, "wiki-race", "Wiki-grenen ändrades under sparningen. Utkastet finns kvar; kontrollera och försök igen."));
      else if (/Authentication failed|403|401|Permission.*denied/i.test(message)) reject(new AppError(403, "wiki-access", "GitHub nekade Wiki-åtkomsten. Kontrollera appens Contents-behörighet, ditt konto och organisationens regler."));
      else if (/not found|does not exist|couldn't find remote ref/i.test(message)) reject(new AppError(404, "wiki-unavailable", "Wiki kunde inte öppnas. Aktivera Wiki, skapa en första sida på GitHub och kontrollera appens åtkomst."));
      else reject(new AppError(503, "wiki-network", "Wiki-anropet kunde inte slutföras. Utkastet finns kvar. Kontrollera anslutningen och försök igen."));
    });
    child.stdin?.on("error", () => { /* EPIPE is reported by execFile's callback. */ });
    child.stdin?.end(input);
  });
}

export function wikiRemote(repository: Repository): string {
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+$/i.test(repository.fullName) || repository.fullName.split("/")[1].startsWith(".")) throw new AppError(400, "wiki-repository", "Ogiltigt repositorynamn.");
  return `https://github.com/${repository.fullName}.wiki.git`;
}

export async function wikiAvailability(): Promise<{ available: boolean; reason: string | null }> {
  if (process.env.WIKI_ENABLED === "false") return { available: false, reason: "Wiki-läget är avstängt på servern." };
  try {
    const version = (await gitCommand("")(process.cwd(), ["--version"])).toString();
    if (!/^git version 2\./.test(version)) return { available: false, reason: "Git 2 krävs på servern." };
    return { available: true, reason: null };
  } catch { return { available: false, reason: "Git saknas eller kan inte köras på servern. Repositoryfiler fungerar utan Git." }; }
}

export const PUSH_GUARD = "#!/bin/sh\nwhile read local_ref local_sha remote_ref remote_sha; do\n  if test \"$remote_sha\" != \"$GITBSIDIAN_EXPECTED_HEAD\"; then\n    echo GITBSIDIAN_STALE_HEAD >&2\n    exit 1\n  fi\ndone\n";

/** Request-scoped bare repository. No checkout, shared cache or repository-provided hooks. */
export class WikiGit {
  private directory = "";
  private tempRoot = "";
  private head = "";
  private branch = "";
  private entries: { path: string; sha: string; size: number; mode: string; type: string }[] = [];
  constructor(private repository: Repository, private user: User, private run: GitCommand, private expectedBranch?: string) {}
  private async initialize() {
    if (this.directory) return;
    this.tempRoot = resolve(/* turbopackIgnore: true */ process.env.WIKI_TEMP_DIR || ".data/wiki-tmp");
    await mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
    this.directory = await mkdtemp(join(this.tempRoot, "request-"));
    await this.run(this.directory, ["init", "--bare", "--quiet"]);
    const hooks = join(this.directory, "trusted-hooks");
    await mkdir(hooks, { mode: 0o700 });
    await writeFile(join(hooks, "pre-push"), PUSH_GUARD, { mode: 0o700 });
  }
  private async sync() {
    await this.initialize();
    const advertised = (await this.run(this.directory, ["ls-remote", "--symref", wikiRemote(this.repository), "HEAD"])).toString("utf8");
    const branch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(advertised)?.[1];
    if (!branch || !branchSchema.safeParse(branch).success) throw new AppError(409, "wiki-uninitialized", "Wiki saknar en initialiserad standardgren. Skapa första sidan på GitHub innan du öppnar den här.");
    if (this.expectedBranch && branch !== this.expectedBranch) throw new AppError(409, "wiki-default-changed", "Wikins standardgren har ändrats. Välj Wiki-arbetsytan igen; ditt gamla utkast finns kvar.");
    this.branch = branch;
    await this.run(this.directory, ["fetch", "--quiet", "--no-tags", "--depth=1", wikiRemote(this.repository), `refs/heads/${branch}`]);
    this.head = (await this.run(this.directory, ["rev-parse", "FETCH_HEAD"])).toString().trim();
    if (!SHA.test(this.head)) throw new AppError(502, "wiki-head", "GitHub returnerade en ogiltig Wiki-version.");
    // Cap the fetched object store as well as individual notes. Server disk quotas are still recommended.
    const measure = async (path: string): Promise<number> => {
      let size = 0;
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        size += entry.isDirectory() ? await measure(full) : (await stat(full)).size;
        if (size > MAX_WIKI_BYTES) throw new AppError(413, "wiki-size", "Wikin är större än gränsen på 64 MiB. Välj repositoryfiler eller en mindre Wiki.");
      }
      return size;
    };
    await measure(join(this.directory, "objects"));
    const listing = (await this.run(this.directory, ["ls-tree", "-r", "-z", "-l", this.head])).toString("utf8");
    this.entries = listing.split("\0").filter(Boolean).map(record => {
      const match = /^(\d+) (\w+) ([a-f0-9]{40})\s+(\d+|-)\t([\s\S]+)$/.exec(record);
      if (!match) throw new AppError(502, "wiki-tree", "Wikins filträd kunde inte tolkas.");
      return { mode: match[1], type: match[2], sha: match[3], size: Number(match[4]) || 0, path: match[5] };
    });
  }
  async open(): Promise<{ branch: string; notes: NoteEntry[] }> {
    await this.sync();
    return { branch: this.branch, notes: this.entries.filter(entry => entry.type === "blob" && ["100644", "100755"].includes(entry.mode) && wikiPathSchema.safeParse(entry.path).success).map(({ path, sha, size }) => ({ path, sha, size })).sort((a, b) => a.path.localeCompare(b.path, "sv")) };
  }
  async read(path: string): Promise<RemoteNote> {
    wikiPathSchema.parse(path);
    await this.sync(); // Also refreshes after an uncertain or rejected push.
    const entry = this.entries.find(entry => entry.path === path);
    if (!entry) return { path, text: "", sha: null };
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new AppError(400, "wiki-file-type", "Endast vanliga Markdown-sidor kan redigeras i Wiki-läget.");
    if (entry.size > MAX_NOTE_BYTES) throw new AppError(413, "size", "Anteckningar större än 1 MiB stöds inte ännu.");
    const bytes = await this.run(this.directory, ["cat-file", "blob", entry.sha]);
    if (bytes.length > MAX_NOTE_BYTES) throw new AppError(413, "size", "Anteckningar större än 1 MiB stöds inte ännu.");
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("binary");
      return { path, text, sha: entry.sha };
    } catch { throw new AppError(422, "encoding", "Wiki-sidan måste vara en textfil i UTF-8."); }
  }
  async write(input: { path: string; text: string; baseSha: string | null }): Promise<RemoteNote> {
    wikiPathSchema.parse(input.path);
    if (Buffer.byteLength(input.text, "utf8") > MAX_NOTE_BYTES) throw new AppError(413, "size", "Anteckningen är större än 1 MiB.");
    if (!this.head) throw new AppError(409, "wiki-preflight", "Wiki-versionen måste läsas innan sparning.");
    const entry = this.entries.find(entry => entry.path === input.path);
    if (entry && (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))) throw new AppError(400, "wiki-file-type", "Endast vanliga Markdown-sidor kan redigeras i Wiki-läget.");
    if ((entry?.sha || null) !== input.baseSha) throw new AppError(409, "wiki-preflight", "Wiki-versionen har ändrats. Läs om den innan sparning.");
    // A wiki title must resolve uniquely even when GitHub normalizes spaces, hyphens or case.
    const titleKey = (path: string) => path.replace(/\.[^.]+$/, "").normalize("NFC").replace(/[ _]/g, "-").toLocaleLowerCase("en");
    if (this.entries.some(other => other.path !== input.path && titleKey(other.path) === titleKey(input.path))) throw new AppError(409, "wiki-title-collision", "En Wiki-sida med samma titel finns redan, möjligen med annan ändelse, stora bokstäver eller bindestreck.");
    const sha = (await this.run(this.directory, ["hash-object", "-w", "--stdin"], Buffer.from(input.text, "utf8"))).toString().trim();
    if (!SHA.test(sha)) throw new AppError(502, "wiki-blob", "Kunde inte skapa Wiki-versionen.");
    await this.run(this.directory, ["read-tree", this.head]);
    await this.run(this.directory, ["update-index", "-z", "--index-info"], `${entry?.mode || "100644"} ${sha}\t${input.path}\0`);
    const tree = (await this.run(this.directory, ["write-tree"])).toString().trim();
    if (!SHA.test(tree)) throw new AppError(502, "wiki-tree", "Kunde inte skapa Wikins filträd.");
    const identity = { GIT_AUTHOR_NAME: this.user.login, GIT_COMMITTER_NAME: this.user.login, GIT_AUTHOR_EMAIL: `${this.user.id}+${this.user.login}@users.noreply.github.com`, GIT_COMMITTER_EMAIL: `${this.user.id}+${this.user.login}@users.noreply.github.com` };
    const commit = (await this.run(this.directory, ["commit-tree", tree, "-p", this.head], `${input.baseSha ? "Uppdatera" : "Skapa"} Wiki: ${input.path}\n`, identity)).toString().trim();
    if (!SHA.test(commit)) throw new AppError(502, "wiki-commit", "Kunde inte skapa Wiki-committen.");
    // Our pre-push hook checks the remote's advertised old SHA. Git's receive-pack then
    // atomically rejects a ref that changes after that advertisement. No force flag is used.
    await this.run(this.directory, ["-c", `core.hooksPath=${join(this.directory, "trusted-hooks")}`, "push", "--porcelain", wikiRemote(this.repository), `${commit}:refs/heads/${this.branch}`], undefined, { GITBSIDIAN_EXPECTED_HEAD: this.head });
    return { path: input.path, text: input.text, sha };
  }
  async dispose() {
    if (!this.directory) return;
    const target = resolve(this.directory);
    if (dirname(target) !== this.tempRoot || !/^request-[a-z\d]+$/i.test(basename(target))) throw new Error("Unsafe Wiki cleanup path");
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
    this.directory = "";
  }
}
