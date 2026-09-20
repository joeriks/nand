import { z } from "zod";
import { pathSchema } from "../validation";
import type { RemoteNote, Workspace } from "../types";
import type { GitHub } from "./github";
import type { NoteStorage } from "./storage";
import { AppError } from "./errors";

export const offlineSchema = z.object({ files: z.array(z.object({ path: pathSchema, sha: z.string().nullable() })).min(1).max(2) });
export type OfflineResult = { path: string; note?: RemoteNote; unchanged?: boolean; error?: string };
export async function offlineBatch(storage: NoteStorage, github: GitHub, workspace: Workspace, input: z.infer<typeof offlineSchema>): Promise<OfflineResult[]> {
  // A bounded batch shares one tree/clone and never trusts a client-supplied blob SHA.
  const entries = new Map((await storage.notes()).map(entry => [entry.path, entry]));
  const results: OfflineResult[] = [];
  for (const file of input.files) {
    const entry = entries.get(file.path);
    try {
      if (!entry) results.push({ path: file.path, note: { path: file.path, text: "", sha: null } });
      else if (file.sha === entry.sha) results.push({ path: file.path, unchanged: true });
      else results.push({ path: file.path, note: workspace.mode === "wiki" ? await storage.read(file.path) : await github.readEntry(workspace, entry) });
    } catch (error) {
      if (!(error instanceof AppError) || ![400, 413, 422].includes(error.status)) throw error;
      results.push({ path: file.path, error: error.message });
    }
  }
  return results;
}
