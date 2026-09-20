import type { NoteEntry, RemoteNote, Workspace } from "@/lib/types";
import type { Session } from "./session";
import { GitHub } from "./github";
import { WikiGit, gitCommand, wikiAvailability } from "./wiki-git";
import { AppError } from "./errors";

export type NoteStorage = {
  notes(): Promise<NoteEntry[]>;
  read(path: string): Promise<RemoteNote>;
  write(input: { path: string; text: string; baseSha: string | null }): Promise<RemoteNote>;
  dispose(): Promise<void>;
};
export async function storageFor(session: Session, workspace: Workspace, github: GitHub, write = false): Promise<NoteStorage> {
  if (workspace.mode !== "wiki") return {
    notes: () => github.notes(workspace), read: path => github.read(workspace, path), write: input => github.write(workspace, input), dispose: async () => {},
  };
  const capability = await wikiAvailability();
  if (!capability.available) throw new AppError(503, "wiki-unavailable", capability.reason!);
  if (workspace.root !== "") throw new AppError(400, "wiki-root", "Wiki-läget använder Wikins rot och standardgren.");
  await github.authorizeWiki(workspace.repository, write);
  const wiki = new WikiGit(workspace.repository, session.user, gitCommand(session.token), workspace.branch || undefined);
  return { notes: async () => (await wiki.open()).notes, read: path => wiki.read(path), write: input => wiki.write(input), dispose: () => wiki.dispose() };
}
