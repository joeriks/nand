import type { RemoteNote } from "@/lib/types";
import { AppError } from "./errors";

const queues = new Map<string, Promise<unknown>>();
export async function serial<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(workspace) || Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  queues.set(workspace, next);
  try { return await next; }
  finally { if (queues.get(workspace) === next) queues.delete(workspace); }
}
export async function saveVersion(
  input: { text: string; baseSha: string | null },
  read: () => Promise<RemoteNote>,
  write: () => Promise<RemoteNote>,
): Promise<RemoteNote> {
  const remote = await read();
  // Also makes retries safe after a response was lost or an earlier request committed.
  if (remote.sha !== null && remote.text === input.text) return remote;
  if (remote.sha !== input.baseSha) throw new AppError(409, "conflict", "Anteckningen har ändrats på GitHub. Jämför versionerna innan du sparar.", remote);
  try { return await write(); }
  catch (error) {
    if (!(error instanceof AppError) || ![403, 409, 422, 502, 503].includes(error.status)) throw error;
    let latest: RemoteNote;
    try { latest = await read(); }
    catch { throw new AppError(503, "uncertain", "Det är oklart om ändringen nådde GitHub. Kontrollera sparningen när anslutningen fungerar igen."); }
    if (latest.sha !== null && latest.text === input.text) return latest;
    if (latest.sha !== input.baseSha) throw new AppError(409, "conflict", "En annan version finns på GitHub. Ditt utkast har bevarats.", latest);
    throw error;
  }
}
