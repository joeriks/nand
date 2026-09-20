import { z } from "zod";
import { requireSession } from "@/lib/server/session";
import { GitHub } from "@/lib/server/github";
import { json, route } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return route(async () => {
    const session = await requireSession();
    const params = new URL(request.url).searchParams;
    const repositoryId = z.coerce.number().int().positive().parse(params.get("repositoryId"));
    const installationId = z.coerce.number().int().positive().parse(params.get("installationId"));
    const github = new GitHub(session.token);
    const repository = await github.authorize(repositoryId, installationId);
    return json(await github.branches(repository));
  });
}
