import { destroySession } from "@/lib/server/session";
import { checkOrigin, json, route } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => { checkOrigin(request); await destroySession(); return json({ ok: true }); });
}
