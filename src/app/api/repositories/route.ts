import { requireSession } from "@/lib/server/session";
import { GitHub } from "@/lib/server/github";
import { json, route } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET() {
  return route(async () => { const session = await requireSession(); return json(await new GitHub(session.token).repositories()); });
}
