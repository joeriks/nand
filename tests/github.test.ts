import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "@/lib/server/github";
const repo = { id: 1, fullName: "owner/notes", installationId: 2, defaultBranch: "main", private: true };
const workspace = { repository: repo, branch: "notes/my-branch", root: "" };
function responses(...data: unknown[]) {
  const fetcher = vi.fn(); data.forEach(value => fetcher.mockResolvedValueOnce(Response.json(value))); vi.stubGlobal("fetch", fetcher); return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe("GitHub adapter", () => {
  it("lists regular CSV files and saves their exact contents with an expected SHA", async () => {
    const text = "\ufeffID;Pris\r\n00123;1,25\r\n";
    responses({ commit: { commit: { tree: { sha: "tree" } } } }, { tree: [{ path: "data.csv", sha: "csv", mode: "100644", type: "blob", size: 28 }, { path: "link.csv", sha: "link", mode: "120000", type: "blob" }], truncated: false });
    expect(await new GitHub("csv-test-token").notes(workspace)).toEqual([{ path: "data.csv", sha: "csv", size: 28 }]);
    const fetcher = responses({ content: { sha: "next" } });
    await new GitHub("csv-test-token").write(workspace, { path: "data.csv", text, baseSha: "csv" });
    const input = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(input.sha).toBe("csv"); expect(Buffer.from(input.content, "base64").toString()).toBe(text);
  });
  it("uses the app installation membership for authorization", async () => {
    const fetcher = responses({ repositories: [{ id: 1, full_name: "owner/notes", default_branch: "main", private: true }] });
    expect(await new GitHub("test-token").authorize(1, 2)).toEqual(repo);
    expect(fetcher.mock.calls[0][0]).toContain("/user/installations/2/repositories");
  });
  it("denies a guessed repository ID", async () => {
    responses({ repositories: [] }); await expect(new GitHub("test-token").authorize(999, 2)).rejects.toMatchObject({ status: 403 });
  });
  it("reads exact BOM and CRLF text using the blob API and an encoded branch", async () => {
    const text = "\ufeff# Åäö\r\n\r\n[[x]]";
    const fetcher = responses({ commit: { commit: { tree: { sha: "tree" } } } }, { tree: [{ path: "Å ä.md", sha: "blob", mode: "100644", type: "blob", size: 30 }], truncated: false }, { content: Buffer.from(text).toString("base64"), encoding: "base64" });
    expect(await new GitHub("test-token").read(workspace, "Å ä.md")).toEqual({ path: "Å ä.md", text, sha: "blob" });
    expect(fetcher.mock.calls[0][0]).toContain("notes%2Fmy-branch");
  });
  it("does not follow a symlink out of the selected workspace", async () => {
    responses({ commit: { commit: { tree: { sha: "tree" } } } }, { tree: [{ path: "alias", sha: "link", type: "blob", mode: "120000" }], truncated: false });
    await expect(new GitHub("test-token").read({ ...workspace, root: "alias" }, "note.md")).rejects.toMatchObject({ code: "path" });
  });
  it("walks subtrees when GitHub truncates a recursive tree", async () => {
    responses({ commit: { commit: { tree: { sha: "tree" } } } }, { tree: [], truncated: true },
      { tree: [{ path: "folder", sha: "sub", type: "tree", mode: "040000" }, { path: "alias.md", sha: "link", type: "blob", mode: "120000" }], truncated: false },
      { tree: [{ path: "Å.md", sha: "a", type: "blob", mode: "100644", size: 12 }], truncated: false });
    expect(await new GitHub("test-token").notes(workspace)).toEqual([{ path: "folder/Å.md", sha: "a", size: 12 }]);
  });
  it("sends the exact content and base SHA in a conditional Contents API write", async () => {
    const fetcher = responses({ content: { sha: "new" } });
    const github = new GitHub("test-token");
    await github.write({ ...workspace, root: "anteckningar" }, { path: "Å ä.md", text: "# Å\r\n", baseSha: "old" });
    expect(fetcher.mock.calls[0][0]).toContain("contents/anteckningar/%C3%85%20%C3%A4.md");
    const input = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(input.sha).toBe("old"); expect(input.branch).toBe(workspace.branch); expect(Buffer.from(input.content, "base64").toString()).toBe("# Å\r\n");
  });
  it("does not issue another request during a GitHub cooldown", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "60" } })); vi.stubGlobal("fetch", fetcher);
    const github = new GitHub("cooldown-token");
    await expect(github.request("/user")).rejects.toMatchObject({ status: 429 });
    await expect(github.request("/user")).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
