import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

function collection() {
  const repository = { id: 77, fullName: "owner/offline", installationId: 3, defaultBranch: "main", private: true, hasWiki: true };
  const workspace = { mode: "repository", repository, branch: "main", root: "Notes" };
  const state = { user: { id: 991, login: "offline-owner" } as { id: number; login: string } | null, failure: "", puts: 0, reads: [] as string[], offline: false };
  const notes = new Map(["First.md", "Folder/Second.md", "Third.md"].map(path => [path, { path, text: `# ${path}\n\nOriginal`, sha: createHash("sha1").update(path).digest("hex") }]));
  const entries = () => [...notes.values()].map(note => ({ path: note.path, sha: note.sha, size: note.text.length }));
  async function install(context: BrowserContext) {
    await context.route("**/api/**", async route => {
      const request = route.request(); const url = new URL(request.url());
      const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (state.offline) return route.abort();
      if (url.pathname === "/api/session") return send({ user: state.user, configuration: { ready: true, missing: [], installUrl: null }, storage: { wiki: { available: true, reason: null } } });
      if (url.pathname === "/api/auth/logout") { state.user = null; return send({ ok: true }); }
      if (!state.user) return send({ code: "authentication", error: "Logga in igen" }, 401);
      if (url.searchParams.has("account") && url.searchParams.get("account") !== String(state.user.id)) return send({ code: "account", error: "Fel konto" }, 401);
      if (url.pathname === "/api/repositories") return send([repository]);
      if (url.pathname === "/api/branches") return send(["main"]);
      if (url.pathname === "/api/workspace") return send({ id: "collection", workspace, notes: entries() });
      if (url.pathname === "/api/workspace/restore") return send({ id: "collection" });
      if (request.method() === "GET") return send(url.searchParams.has("path") ? notes.get(url.searchParams.get("path")!) || { path: url.searchParams.get("path"), text: "", sha: null } : entries());
      if (request.method() === "POST") return send(request.postDataJSON().files.map((file: { path: string; sha: string | null }) => {
        if (file.path === state.failure) return { path: file.path, error: "Kan inte läsa denna fil just nu" };
        const note = notes.get(file.path);
        if (note?.sha === file.sha) return { path: file.path, unchanged: true };
        state.reads.push(file.path); return { path: file.path, note: note || { path: file.path, text: "", sha: null } };
      }));
      const input = request.postDataJSON(); const current = notes.get(input.path);
      if (input.baseSha !== (current?.sha || null)) return send({ code: "conflict", error: "Annan version", details: current || { path: input.path, text: "", sha: null } }, 409);
      state.puts++; const saved = { path: input.path, text: input.text, sha: createHash("sha1").update(input.text).digest("hex") }; notes.set(input.path, saved);
      return send({ ...saved, savedAt: Date.now() });
    });
  }
  async function open(page: Page) {
    await page.goto("/"); await page.getByRole("button", { name: "Öppna en arbetsyta", exact: true }).click();
    await page.getByRole("combobox", { name: "Repository" }).selectOption("77");
    await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("main");
    await page.getByRole("textbox", { name: "Undermapp" }).fill("Notes");
    await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toBeVisible();
  }
  return { state, notes, install, open };
}

test("full collection includes nested never-opened notes, survives expiry/reload and auto-syncs", async ({ page, context }) => {
  const f = collection(); await f.install(context); await f.open(page);
  await expect(page.locator(".offline-summary")).toContainText("3 av 3 anteckningar");
  expect(new Set(f.state.reads).size).toBe(3);
  f.state.user = null;
  await page.reload();
  await expect(page.getByRole("link", { name: "Logga in igen med samma konto" })).toBeVisible();
  await page.getByRole("button", { name: "Second", exact: false }).first().click();
  const editor = page.getByRole("textbox", { name: "Anteckningens innehåll" });
  await expect(editor).toContainText("Folder/Second.md");
  await editor.fill("# Arbete efter tokenutgång");
  await expect(page.locator(".statusbar")).toContainText("Inloggning krävs");
  await page.reload(); await expect(editor).toContainText("Arbete efter tokenutgång");
  f.state.user = { id: 991, login: "offline-owner" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => f.notes.get("Folder/Second.md")?.text).toBe("# Arbete efter tokenutgång");
  await expect(page.locator(".statusbar")).toContainText("Synkat");
  expect(f.state.puts).toBe(1);
});

test("partial download is visible and retry only fetches missing content", async ({ page, context }) => {
  const f = collection(); f.state.failure = "Third.md"; await f.install(context); await f.open(page);
  await expect(page.locator(".offline-summary")).toContainText("2 av 3 anteckningar");
  await page.getByText("Offline och synkkö", { exact: true }).click();
  await expect(page.locator(".offline-summary")).toContainText("Third.md: Kan inte läsa");
  f.state.failure = "";
  await page.getByRole("button", { name: "Hämta och synka nu" }).click();
  await expect(page.locator(".offline-summary")).toContainText("3 av 3 anteckningar");
  expect(f.state.reads.sort()).toEqual(["First.md", "Folder/Second.md", "Third.md"]);
  await page.screenshot({ path: "test-results/offline-collection.png", fullPage: true });
});

test("automatic conflict preserves text while independent queued notes sync", async ({ page, context }) => {
  const f = collection(); await f.install(context); await f.open(page);
  await expect(page.locator(".offline-summary")).toContainText("3 av 3 anteckningar");
  await context.setOffline(true); f.state.offline = true;
  const editor = page.getByRole("textbox", { name: "Anteckningens innehåll" });
  await editor.fill("# Lokal konflikt");
  f.notes.set("First.md", { path: "First.md", text: "# Ändrat på annan enhet", sha: "e".repeat(40) });
  await page.getByRole("button", { name: "Third", exact: false }).first().click();
  await editor.fill("# Oberoende ändring");
  f.state.offline = false; await context.setOffline(false);
  await expect.poll(() => f.notes.get("Third.md")?.text).toBe("# Oberoende ändring");
  await page.getByRole("button", { name: "First", exact: false }).first().click();
  await expect(editor).toContainText("Lokal konflikt");
  await expect(page.getByRole("button", { name: "Jämför versionerna", exact: true })).toBeVisible();
  expect(f.notes.get("First.md")?.text).toBe("# Ändrat på annan enhet");
});

test("explicit logout while offline stays revoked after reload and account switch hides former cache", async ({ page, context }) => {
  const f = collection(); await f.install(context); await f.open(page);
  await expect(page.locator(".offline-summary")).toContainText("3 av 3 anteckningar");
  f.state.offline = true;
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Logga ut", exact: true }).click();
  f.state.offline = false; // Server cookie still valid: local tombstone must win.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Öppna hämtade arbetsytor" })).toHaveCount(0);
  f.state.user = { id: 992, login: "another-account" };
  await page.goto("/?auth=success");
  await expect(page.getByRole("button", { name: "Öppna en arbetsyta", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toHaveCount(0);
  await page.getByRole("button", { name: "Öppna hämtade arbetsytor" }).click();
  await expect(page.getByRole("dialog")).toContainText("@another-account");
  await expect(page.getByRole("dialog").getByRole("button", { name: /owner\/offline/ })).toHaveCount(0);
});

test("queued GitHub work resumes outside its workspace without uploading the local scratchpad", async ({ page, context }) => {
  const f = collection(); await f.install(context); await f.open(page);
  await expect(page.locator(".offline-summary")).toContainText("3 av 3 anteckningar");
  await context.setOffline(true); f.state.offline = true;
  await page.getByRole("textbox", { name: "Anteckningens innehåll" }).fill("# Köad arbetsyta i bakgrunden");
  await page.getByRole("button", { name: "nand", exact: true }).click();
  await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await page.getByRole("textbox", { name: "Anteckningens innehåll" }).fill("# Detta lokala prov får inte laddas upp");
  f.state.offline = false; await context.setOffline(false);
  await expect.poll(() => f.notes.get("First.md")?.text, { timeout: 20_000 }).toBe("# Köad arbetsyta i bakgrunden");
  expect(f.state.puts).toBe(1);
  expect([...f.notes.values()].some(note => note.text.includes("lokala prov"))).toBe(false);
});

test("logout in one tab hides the same account's workspace in another tab", async ({ page, context }) => {
  const f = collection(); await f.install(context); await f.open(page);
  await expect(page.locator(".offline-summary")).toContainText("3 av 3 anteckningar");
  const second = await context.newPage(); await second.goto("/");
  await expect(second.getByRole("textbox", { name: "Anteckningens innehåll" })).toBeVisible();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(second.getByRole("textbox", { name: "Anteckningens innehåll" })).toHaveCount(0);
  await second.close();
});
