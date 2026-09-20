export type User = { id: number; login: string };
export type StorageMode = "repository" | "wiki";
export type Repository = { id: number; fullName: string; defaultBranch: string; installationId: number; private: boolean; hasWiki?: boolean };
// Omitted mode is read as "repository" for workspaces saved by version 0.1.
export type Workspace = { repository: Repository; branch: string; root: string; mode?: StorageMode };
export type RemoteNote = { path: string; text: string; sha: string | null };
export type NoteEntry = { path: string; sha: string; size: number };
export type Conflict = { base: string; remote: RemoteNote };
export type PendingSave = { text: string; baseSha: string | null; startedAt: number };
export type Draft = {
  key: string;
  account: string;
  workspace: string;
  path: string;
  baseSha: string | null;
  baseText: string;
  text: string;
  updatedAt: number;
  savedAt?: number;
  localExcluded?: boolean;
  pending?: PendingSave;
  conflict?: Conflict;
  syncError?: { message: string; retryAt: number };
};
export type CachedWorkspace = {
  key: string;
  account: string;
  workspace: Workspace;
  notes: NoteEntry[];
  checkedAt: number;
  unavailable: Record<string, string>;
};
export function workspaceKey(workspace: Workspace): string {
  // Keep the existing repository namespace so old drafts remain reachable without migration.
  // Wiki keys start with a string discriminator, so they cannot collide with numeric repo IDs.
  if (workspace.mode === "wiki") return JSON.stringify(["wiki", workspace.repository.id, workspace.branch, workspace.root]);
  return JSON.stringify([workspace.repository.id, workspace.branch, workspace.root]);
}
export function draftKey(account: string, workspace: string, path: string): string {
  return JSON.stringify([account, workspace, path]);
}
export function dirty(draft: Draft): boolean {
  return draft.baseSha === null || draft.text !== draft.baseText || !!draft.pending || !!draft.conflict;
}
