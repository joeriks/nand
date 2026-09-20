import { configuration } from "@/lib/server/config";
import { getSession } from "@/lib/server/session";
import { json, route } from "@/lib/server/http";
import { wikiAvailability } from "@/lib/server/wiki-git";
export const runtime = "nodejs";
export async function GET() {
  return route(async () => {
    const config = configuration();
    const session = config.ready ? await getSession() : null;
    return json({ user: session?.user || null, configuration: config, storage: { wiki: await wikiAvailability() } });
  });
}
