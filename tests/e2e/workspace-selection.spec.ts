import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const user = { id: 643, login: "selection-owner" };
const repository = { id: 41, installationId: 3, fullName: "selection/notes", defaultBranch: "develop", private: true, hasWiki: true };
const otherRepository = { ...repository, id: 42, fullName: "selection/other", defaultBranch: "release" };
const session = { user, configuration: { ready: true, missing: [], installUrl: null }, storage: { wiki: { available: true, reason: null } } };
const send = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

function fixture() {
  const state = { authenticated: true, restores: [] as unknown[], branches: ["main", "develop"], branchError: false, failOpen: false, failRestore: false };
  const workspaces = new Map<string, { mode: string; repository: typeof repository; branch: string; root: string }>();
  async function install(context: BrowserContext) {
    await context.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === "/api/session") return send(route, { ...session, user: state.authenticated ? user : null });
      if (url.pathname === "/api/repositories") return send(route, [repository, otherRepository]);
      if (url.pathname === "/api/branches") return state.branchError ? send(route, { error: "Anslutningen misslyckades", code: "network" }, 503) : send(route, state.branches);
      if (url.pathname === "/api/workspace") {
        if (state.failOpen) return send(route, { error: "Åtkomst nekad", code: "access" }, 403);
        const input = route.request().postDataJSON();
        const workspace = { mode: input.mode, repository, branch: input.mode === "wiki" ? "master" : input.branch, root: input.root };
        const id = JSON.stringify(workspace); workspaces.set(id, workspace);
        return send(route, { id, workspace, notes: entries(workspace.mode) });
      }
      if (url.pathname === "/api/workspace/restore") {
        if (state.failRestore) return send(route, { error: "Arbetsytan kan inte nås just nu", code: "access" }, 403);
        const workspace = route.request().postDataJSON(); state.restores.push(workspace);
        const id = JSON.stringify(workspace); workspaces.set(id, workspace); return send(route, { id });
      }
      if (url.pathname === "/api/auth/logout") return send(route, { ok: true });
      if (url.pathname === "/api/notes") {
        const mode = workspaces.get(url.searchParams.get("workspace")!)?.mode || "repository";
        if (method === "GET") return send(route, entries(mode));
        if (method === "POST") return send(route, route.request().postDataJSON().files.map((file: { path: string }) => ({ path: file.path, note: note(mode, file.path) })));
        throw new Error("These selection tests must not write remote notes");
      }
      return send(route, { error: "Unexpected request" }, 500);
    });
  }
  function note(mode: string, path: string) { return { path, text: `# ${mode} ${path}`, sha: (mode === "wiki" ? "b" : "a").repeat(40) }; }
  function entries(mode: string) { return ["Alpha.md", "Zebra.md"].map(path => ({ path, sha: note(mode, path).sha, size: 30 })); }
  return { state, install };
}
async function picker(page: Page) {
  if (await page.locator(".workspace-button").isVisible()) {
    await page.locator(".workspace-button").click();
    await page.getByRole("button", { name: "Välj via GitHub", exact: true }).click();
  } else await page.getByRole("button", { name: "Öppna en arbetsyta", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Öppna din kunskapssamling" })).toBeVisible();
}
async function choose(page: Page, mode: "repository" | "wiki") {
  await picker(page);
  await page.getByRole("combobox", { name: "Repository" }).selectOption("41");
  if (mode === "wiki") await page.getByRole("radio", { name: "GitHub Wiki" }).check();
  else {
    await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("develop");
    await page.getByRole("textbox", { name: "Undermapp" }).fill("Notes/Ideas");
  }
  await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
  await expect(page.locator(".offline-summary")).toContainText("2 av 2");
}
const editor = (page: Page) => page.getByRole("textbox", { name: "Anteckningens innehåll" });

test("last chosen Wiki and note survive reload despite newer repository cache and draft", async ({ page, context }) => {
  const f = fixture(); await f.install(context); await page.goto("/");
  await choose(page, "repository");
  await page.getByRole("button", { name: "Zebra", exact: true }).click();
  await choose(page, "wiki");
  await page.getByRole("button", { name: "Zebra", exact: true }).click();
  await expect(editor(page)).toContainText("wiki Zebra.md");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("gitbsidian-v1"); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(["workspaces", "drafts"], "readwrite");
    for (const storeName of ["workspaces", "drafts"]) {
      const store = tx.objectStore(storeName); const r = store.getAll();
      r.onsuccess = () => { for (const row of r.result) { if (storeName === "workspaces" && row.workspace.mode !== "wiki") row.checkedAt = Date.now() + 999999; if (row.path === "Alpha.md") row.updatedAt = Date.now() + 999999; store.put(row); } };
    }
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload();
  await expect(editor(page)).toContainText("wiki Zebra.md");
  await expect.poll(() => f.state.restores).toContainEqual({ mode: "wiki", repository, branch: "master", root: "" });
  // Open an existing downloaded repository without editing its notes.
  await page.locator(".workspace-button").click();
  await page.getByRole("button", { name: "selection/notes · develop/Notes/Ideas", exact: false }).click();
  await expect(editor(page)).toContainText("repository Zebra.md");
  await page.reload();
  await expect(editor(page)).toContainText("repository Zebra.md");
  await expect.poll(() => f.state.restores).toContainEqual({ mode: "repository", repository, branch: "develop", root: "Notes/Ideas" });
});

test("cache opens while session is unanswered and after expiry; a failed new choice does not replace it", async ({ page, context }) => {
  const f = fixture(); await f.install(context); await page.goto("/"); await choose(page, "wiki");
  await page.getByRole("button", { name: "Zebra", exact: true }).click();
  f.state.failOpen = true;
  await picker(page); await page.getByRole("combobox", { name: "Repository" }).selectOption("41");
  await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("Åtkomst nekad");
  const pending: Route[] = [];
  await context.route("**/api/session", route => { pending.push(route); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editor(page)).toContainText("wiki Zebra.md");
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await context.unroute("**/api/session"); f.state.authenticated = false;
  for (const route of pending) await send(route, { ...session, user: null });
  await expect(page.getByRole("link", { name: "Logga in igen med samma konto" })).toBeVisible();
  await page.reload(); await expect(editor(page)).toContainText("wiki Zebra.md");
});

test("lost workspace cache re-registers the saved descriptor and retains drafts", async ({ page, context }) => {
  const f = fixture(); await f.install(context); await page.goto("/"); await choose(page, "repository");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("gitbsidian-v1"); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction("workspaces", "readwrite"); tx.objectStore("workspaces").clear();
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload(); await expect(editor(page)).toContainText("repository Alpha.md");
  await expect.poll(() => f.state.restores).toContainEqual({ mode: "repository", repository, branch: "develop", root: "Notes/Ideas" });
});

test("another tab selecting a workspace does not reset the currently open editor", async ({ page, context }) => {
  const f = fixture(); await f.install(context); await page.goto("/");
  await choose(page, "repository"); await choose(page, "wiki");
  const second = await context.newPage(); await second.goto("/");
  await expect(editor(second)).toContainText("wiki Alpha.md");
  await second.locator(".workspace-button").click();
  await second.getByRole("button", { name: "selection/notes · develop/Notes/Ideas", exact: false }).click();
  await expect(editor(second)).toContainText("repository Alpha.md");
  await expect(editor(page)).toContainText("wiki Alpha.md");
  await second.close(); await page.reload();
  await expect(editor(page)).toContainText("repository Alpha.md");
});

test("denied server restoration keeps the selected cache and can be retried", async ({ page, context }) => {
  const f = fixture(); await f.install(context); await page.goto("/"); await choose(page, "wiki");
  f.state.failRestore = true; await page.reload();
  await expect(editor(page)).toContainText("wiki Alpha.md");
  await expect(page.locator('.workbench [role="alert"]')).toContainText("Arbetsytan kan inte nås just nu");
  await expect(page.getByRole("button", { name: "Byt arbetsyta", exact: true })).toBeVisible();
  f.state.failRestore = false; await page.getByRole("button", { name: "Försök synka igen", exact: true }).click();
  await expect.poll(() => f.state.restores).toContainEqual({ mode: "wiki", repository, branch: "master", root: "" });
  await expect(page.locator('.workbench [role="alert"]')).toHaveCount(0);
  await expect(editor(page)).toContainText("wiki Alpha.md");
});

test("damaged selected metadata shows recovery instead of silently choosing another cache", async ({ page, context }) => {
  const f = fixture(); await f.install(context); await page.goto("/"); await choose(page, "wiki");
  const selected = await page.evaluate(() => localStorage.getItem("gitbsidian-selection-643"));
  await page.evaluate(() => localStorage.setItem("gitbsidian-selection-643", JSON.stringify({ version: 1, workspace: null })));
  await page.reload();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("sparade arbetsytevalet kunde inte läsas");
  await expect(editor(page)).toHaveCount(0);
  await page.screenshot({ path: "artifacts/workspace-recovery.png" });
  await page.evaluate(value => localStorage.setItem("gitbsidian-selection-643", value!), selected);
  await page.getByRole("button", { name: "Försök öppna igen" }).click();
  await expect(editor(page)).toContainText("wiki Alpha.md");
  await page.evaluate(() => localStorage.setItem("gitbsidian-selection-643", JSON.stringify({ version: 1, workspace: null })));
  await page.reload(); await page.getByRole("button", { name: "Välj annan arbetsyta" }).click();
  await page.getByRole("button", { name: "selection/notes · Wiki", exact: false }).click();
  await expect(editor(page)).toContainText("wiki Alpha.md");
});

test("empty branches and fetch failures have separate states and retry selects the default branch", async ({ page, context }) => {
  const f = fixture(); f.state.branches = []; await f.install(context); await page.goto("/"); await picker(page);
  await page.getByRole("combobox", { name: "Repository" }).selectOption("41");
  await expect(page.getByRole("status")).toContainText("Inga grenar finns ännu");
  await expect(page.getByRole("button", { name: "Öppna arbetsyta", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Öppna repository på GitHub" })).toHaveAttribute("href", "https://github.com/selection/notes");
  f.state.branchError = true; await page.getByRole("button", { name: "Hämta grenar igen" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("Kunde inte hämta grenar");
  await expect(page.getByText("Inga grenar finns ännu", { exact: false })).toHaveCount(0);
  f.state.branchError = false; f.state.branches = ["main", "develop"];
  await page.getByRole("button", { name: "Hämta grenar igen" }).click();
  await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("develop");
  await expect(page.getByRole("button", { name: "Öppna arbetsyta", exact: true })).toBeEnabled();
  f.state.branches = ["fallback"]; await page.getByRole("button", { name: "Hämta grenar igen" }).click();
  await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("fallback");
  await page.screenshot({ path: "artifacts/workspace-picker-retry.png" });
});

test("late branch responses cannot overwrite another repository or Wiki", async ({ page, context }) => {
  const f = fixture(); await f.install(context);
  const pending: Route[] = [];
  await context.route("**/api/branches?**", route => { pending.push(route); });
  await page.goto("/"); await picker(page);
  await page.getByRole("combobox", { name: "Repository" }).selectOption("41");
  await expect.poll(() => pending.length).toBe(1);
  await expect(page.getByRole("status")).toHaveText("Hämtar grenar…");
  await page.getByRole("combobox", { name: "Repository" }).selectOption("42");
  await expect.poll(() => pending.length).toBe(2);
  await send(pending[1], ["main", "release"]);
  await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("release");
  await send(pending[0], ["stale"]);
  await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("release");
  await page.getByRole("button", { name: "Hämta grenar igen" }).click();
  await expect.poll(() => pending.length).toBe(3);
  await page.getByRole("radio", { name: "GitHub Wiki" }).check();
  await send(pending[2], { error: "Old failure", code: "network" }, 503);
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Öppna arbetsyta", exact: true })).toBeEnabled();
  await page.getByRole("radio", { name: "Repositoryfiler" }).check();
  await expect.poll(() => pending.length).toBe(4);
  await expect(page.getByRole("status")).toHaveText("Hämtar grenar…");
  await send(pending[3], []);
  await expect(page.getByRole("status")).toContainText("Inga grenar finns ännu");
});
