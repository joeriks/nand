import { cacheKey, readWorkspace, writeWorkspace } from "./drafts";
import { workspaceKey, type User, type Workspace } from "./types";
import type { OpenWorkspace } from "../components/workspace-picker";

const selectionKey = (user: User) => `gitbsidian-selection-${user.id}`;
function descriptor(value: unknown): Workspace {
  const workspace = value as Workspace;
  if (!workspace || !Number.isSafeInteger(workspace.repository?.id) || !Number.isSafeInteger(workspace.repository?.installationId) || typeof workspace.repository.fullName !== "string" || typeof workspace.branch !== "string" || typeof workspace.root !== "string" || ![undefined, "repository", "wiki"].includes(workspace.mode)) {
    throw new Error("Det sparade arbetsytevalet kunde inte läsas. Välj arbetsytan igen; dina utkast finns kvar.");
  }
  return workspace;
}

// Only an explicit, successfully opened selection writes this record. Sync never does.
export async function rememberWorkspace(user: User, opened: OpenWorkspace, allowed = () => true) {
  const key = cacheKey(String(user.id), workspaceKey(opened.workspace));
  const previous = await readWorkspace(key);
  await writeWorkspace({ key, account: String(user.id), workspace: opened.workspace, notes: opened.notes, checkedAt: opened.id ? Date.now() : previous?.checkedAt || 0, unavailable: previous?.unavailable || {} });
  if (!allowed()) return;
  localStorage.setItem(selectionKey(user), JSON.stringify({ version: 1, workspace: opened.workspace }));
}
export async function recentWorkspace(user: User): Promise<OpenWorkspace | null> {
  const selected = localStorage.getItem(selectionKey(user));
  if (selected) {
    const value = JSON.parse(selected);
    if (value.version !== 1) throw new Error("Det sparade arbetsytevalets format stöds inte. Välj arbetsyta igen.");
    const workspace = descriptor(value.workspace);
    const cached = await readWorkspace(cacheKey(String(user.id), workspaceKey(workspace)));
    return { id: "", workspace, notes: cached?.account === String(user.id) ? cached.notes : [] };
  }
  // Migrate only a recorded user choice, never whichever workspace synced last.
  const key = localStorage.getItem(`gitbsidian-last-${user.id}`);
  if (key) {
    const cached = await readWorkspace(key);
    if (!cached || cached.account !== String(user.id) || cached.key !== cacheKey(String(user.id), workspaceKey(cached.workspace))) throw new Error("Den senast valda arbetsytans beskrivning saknas. Välj den igen; dina utkast finns kvar.");
    return { id: "", workspace: descriptor(cached.workspace), notes: cached.notes };
  }
  // Migrate 0.1 metadata. Drafts retain their original account/workspace keys.
  const legacyDesktop = localStorage.getItem(`gitbsidian-desktop-workspace-${user.id}`);
  const legacyWeb = localStorage.getItem(`gitbsidian-workspace-${user.id}`);
  const opened = legacyDesktop ? JSON.parse(legacyDesktop) : legacyWeb ? { workspace: JSON.parse(legacyWeb), notes: [] } : null;
  if (opened) return { ...opened, workspace: descriptor(opened.workspace), id: "" };
  return null;
}

export const noteSelectionKey = (account: string, scope: string) => `gitbsidian-note-${cacheKey(account, scope)}`;
