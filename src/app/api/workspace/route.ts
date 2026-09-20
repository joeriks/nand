import { requireSession, storeWorkspace } from "@/lib/server/session";
import { GitHub } from "@/lib/server/github";
import { body, checkOrigin, json, route } from "@/lib/server/http";
import { selectionSchema } from "@/lib/validation";
import { WikiGit, gitCommand, wikiAvailability } from "@/lib/server/wiki-git";
import { AppError } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const session = await requireSession();
    const input = await body(request);
    const selection = selectionSchema.parse(input && typeof input === "object" && !Array.isArray(input) ? { ...input, mode: input.mode ?? "repository" } : input);
    const github = new GitHub(session.token);
    const repository = await github.authorize(selection.repositoryId, selection.installationId);
    if (selection.mode === "wiki") {
      const capability = await wikiAvailability();
      if (!capability.available) throw new AppError(503, "wiki-unavailable", capability.reason!);
      await github.authorizeWiki(repository);
      const wiki = new WikiGit(repository, session.user, gitCommand(session.token));
      try {
        const { branch, notes } = await wiki.open();
        const workspace = { mode: "wiki" as const, repository, branch, root: "" };
        const id = await storeWorkspace(workspace);
        return json({ id, workspace, notes });
      } finally { await wiki.dispose(); }
    }
    const workspace = { mode: "repository" as const, repository, branch: selection.branch, root: selection.root };
    const notes = await github.notes(workspace);
    const id = await storeWorkspace(workspace);
    return json({ id, workspace, notes });
  });
}
