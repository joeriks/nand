import { requireSession, storeWorkspace } from "@/lib/server/session";
import { body, checkOrigin, json, route } from "@/lib/server/http";
import { workspaceSchema } from "@/lib/validation";
import { AppError } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const session = await requireSession();
    if (new URL(request.url).searchParams.get("account") !== String(session.user.id)) throw new AppError(401, "account", "Kontot ändrades. Synkningen har pausats.");
    const workspace = workspaceSchema.parse(await body(request));
    // Registration grants no network access; notes/offline check current membership on every request.
    return json({ id: await storeWorkspace(workspace) });
  });
}
