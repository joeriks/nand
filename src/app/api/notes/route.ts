import { getWorkspace, requireSession } from "@/lib/server/session";
import { GitHub } from "@/lib/server/github";
import { body, checkOrigin, json, route } from "@/lib/server/http";
import { pathSchema, saveSchema } from "@/lib/validation";
import { saveVersion, serial } from "@/lib/server/save";
import { storageFor } from "@/lib/server/storage";
import { AppError } from "@/lib/server/errors";
import { offlineBatch, offlineSchema } from "@/lib/server/offline";
export const runtime = "nodejs";
async function context(request: Request) {
  const session = await requireSession();
  const account = new URL(request.url).searchParams.get("account");
  if (account && account !== String(session.user.id)) throw new AppError(401, "account", "Kontot ändrades. Synkningen har pausats.");
  const id = new URL(request.url).searchParams.get("workspace") || "";
  const workspace = await getWorkspace(id);
  const github = new GitHub(session.token);
  // Membership is checked with GitHub on EVERY operation, including reads.
  workspace.repository = await github.authorize(workspace.repository.id, workspace.repository.installationId);
  return { workspace, github, session };
}
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const input = offlineSchema.parse(await body(request));
    const { workspace, github, session } = await context(request);
    const storage = await storageFor(session, workspace, github);
    try { return json(await offlineBatch(storage, github, workspace, input)); }
    finally { await storage.dispose(); }
  });
}
export async function GET(request: Request) {
  return route(async () => {
    const { workspace, github, session } = await context(request);
    const path = new URL(request.url).searchParams.get("path");
    const storage = await storageFor(session, workspace, github);
    try { return json(path === null ? await storage.notes() : await storage.read(pathSchema.parse(path))); }
    finally { await storage.dispose(); }
  });
}
export async function PUT(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const input = saveSchema.parse(await body(request));
    const { workspace, github, session } = await context(request);
    return serial(JSON.stringify([workspace.mode || "repository", workspace.repository.id, workspace.branch]), async () => {
      const storage = await storageFor(session, workspace, github, true);
      try { return json({ ...await saveVersion(input, () => storage.read(input.path), () => storage.write(input)), savedAt: Date.now() }); }
      finally { await storage.dispose(); }
    });
  });
}
