import { openActions } from "./actions";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

async function localEditor(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await expect(page.getByRole("status")).toHaveText("Utkast sparat på den här enheten");
  await expect(page.getByText("Anteckningen är skrivskyddad.", { exact: false })).toHaveCount(0);
  return page.getByRole("textbox", { name: "Anteckningens innehåll" });
}
test("local editing survives reload, renders Markdown safely, and exports", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const editor = await localEditor(page);
  const text = '# Trädgården\n\nEn **viktig** idé.\n\n- [ ] Plantera\n\n<script>window.__xss = true</script>\n\n[x](javascript:alert(1))\n\n[[Behåll|okänd syntax]]';
  await editor.fill(text);
  await expect(page.getByRole("status")).toHaveText("Utkast sparat på den här enheten");
  await expect(page.locator(".markdown-preview strong")).toHaveText("viktig");
  expect(await page.evaluate(() => "__xss" in window)).toBe(false);
  await expect(page.locator('.markdown-preview a[href^="javascript:"]')).toHaveCount(0);
  await page.reload();
  await expect(editor).toContainText("[[Behåll|okänd syntax]]");
  const download = page.waitForEvent("download");
  await openActions(page); await page.getByRole("button", { name: "Exportera Markdown" }).click();
  expect((await download).suggestedFilename()).toBe("Min första anteckning.md");
  expect(errors).toEqual([]);
});
test("mobile navigation, Swedish paths and dark theme work without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await localEditor(page);
  await page.getByRole("button", { name: "Öppna navigation" }).click();
  await page.getByRole("button", { name: "Ny anteckning" }).first().click();
  await page.getByRole("textbox", { name: "Namn och eventuell mapp" }).fill("Projekt/Årets idéer.md");
  await page.getByRole("button", { name: "Skapa anteckning" }).click();
  await expect(page.getByRole("heading", { name: "Årets idéer", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Öppna navigation" }).click();
  await page.getByRole("button", { name: "Mörkt tema" }).click();
  await page.getByRole("button", { name: "Stäng navigation", exact: true }).first().click();
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-dark.png", fullPage: true });
});
test("storage failure keeps the editor visible until the user can export", async ({ page }) => {
  const editor = await localEditor(page);
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException("test quota", "QuotaExceededError"); }; });
  await editor.fill("# Viktigt osparat arbete");
  await expect(page.getByRole("status")).toContainText("Lokal lagring misslyckades");
  await page.getByRole("button", { name: "nand", exact: true }).click();
  await expect(editor).toContainText("Viktigt osparat arbete");
  await expect(page.getByRole("alert").filter({ hasText: "Utkastet kunde inte lagras" })).toContainText("Exportera texten innan du lämnar");
  const download = page.waitForEvent("download"); await openActions(page); await page.getByRole("button", { name: "Exportera Markdown" }).click(); await download;
});
test("a second tab cannot overwrite an active local draft", async ({ page, context }) => {
  const editor = await localEditor(page); await editor.fill("# Första flikens utkast");
  await expect(page.getByRole("status")).toHaveText("Utkast sparat på den här enheten");
  const second = await context.newPage(); await second.goto("/");
  await expect(second.getByText("Anteckningen är skrivskyddad.", { exact: false })).toBeVisible();
  await editor.fill("# Ännu nyare text"); await expect(page.getByRole("status")).toHaveText("Utkast sparat på den här enheten");
  await page.close();
  await second.getByRole("button", { name: "Försök igen", exact: true }).click();
  await expect(second.getByText("Anteckningen är skrivskyddad.", { exact: false })).toHaveCount(0);
  await expect(second.getByRole("textbox", { name: "Anteckningens innehåll" })).toContainText("Ännu nyare text");
});

type Note = { path: string; text: string; sha: string | null };
function fixture() {
  const repository = { id: 1, fullName: "testkonto/anteckningar", installationId: 2, defaultBranch: "main", private: true, hasWiki: true };
  const workspace = { repository, branch: "main", root: "" };
  const state = { note: { path: "Test.md", text: "# Original\n\nEn tanke.\n", sha: "a".repeat(40) } as Note, wikiNote: { path: "Test.md", text: "# Wiki original\n", sha: "b".repeat(40) } as Note, wikiAvailable: true, modes: [] as string[], putCount: 0, beforePut: async () => {}, failAuth: false, lostResponse: false };
  async function install(context: BrowserContext) {
    await context.route("**/api/**", async route => {
      const request = route.request(); const url = new URL(request.url());
      const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (url.pathname === "/api/session") return respond({ user: state.failAuth ? null : { id: 99, login: "testkonto" }, configuration: { ready: true, missing: [], installUrl: null }, storage: { wiki: { available: state.wikiAvailable, reason: state.wikiAvailable ? null : "Git saknas på servern." } } });
      if (url.pathname === "/api/repositories") return respond([repository]);
      if (url.pathname === "/api/branches") return respond(["main"]);
      if (url.pathname === "/api/workspace/restore") return respond({ id: request.postDataJSON().mode === "wiki" ? "fixture-wiki" : "fixture" });
      if (url.pathname === "/api/workspace") {
        const mode = request.postDataJSON().mode || "repository"; state.modes.push(mode);
        const note = mode === "wiki" ? state.wikiNote : state.note;
        return respond({ id: mode === "wiki" ? "fixture-wiki" : "fixture", workspace: { ...workspace, mode }, notes: [{ path: note.path, sha: note.sha, size: note.text.length }] });
      }
      if (url.pathname === "/api/auth/logout") return respond({ ok: true });
      if (url.pathname === "/api/notes") {
        const wiki = url.searchParams.get("workspace") === "fixture-wiki";
        const note = wiki ? state.wikiNote : state.note;
        if (state.failAuth) return respond({ code: "authentication", error: "Logga in igen. Dina lokala utkast finns kvar." }, 401);
        if (request.method() === "GET") return respond(url.searchParams.has("path") ? note : [{ path: note.path, sha: note.sha, size: note.text.length }]);
        if (request.method() === "POST") return respond(request.postDataJSON().files.map((file: { path: string; sha: string | null }) => ({ path: file.path, ...(file.sha === note.sha ? { unchanged: true } : { note }) })));
        state.putCount++;
        const input = request.postDataJSON();
        await state.beforePut();
        if (input.baseSha !== (input.path === note.path ? note.sha : null)) return respond({ code: "conflict", error: "Annan version", details: note }, 409);
        const saved = { path: input.path, text: input.text, sha: createHash("sha1").update(input.text).digest("hex") };
        if (wiki) state.wikiNote = saved; else state.note = saved;
        if (state.lostResponse) { state.lostResponse = false; return route.abort("failed"); }
        return respond({ ...saved, savedAt: Date.now() });
      }
      return route.continue();
    });
  }
  return { state, install };
}
async function openFixture(page: Page, mode: "repository" | "wiki" = "repository") {
  await page.goto("/"); await page.getByRole("button", { name: "Öppna en arbetsyta" }).click();
  if (mode === "wiki") await page.getByRole("radio", { name: "GitHub Wiki" }).check();
  await page.getByRole("combobox", { name: "Repository" }).selectOption("1");
  if (mode === "repository") await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("main");
  await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toBeVisible();
  await expect(page.getByText("Anteckningen är skrivskyddad.", { exact: false })).toHaveCount(0);
  return page.getByRole("textbox", { name: "Anteckningens innehåll" });
}
test("typing during GitHub save remains an unsaved draft, with a persisted snapshot", async ({ page, context }) => {
  const { state, install } = fixture(); await install(context); const editor = await openFixture(page);
  await editor.fill("# Snapshot");
  let release!: () => void; state.beforePut = () => new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect.poll(() => state.putCount).toBe(1);
  await editor.fill("# Nyare utkast"); release();
  await expect(page.getByRole("status")).toContainText("väntar på synk");
  expect(state.note.text).toBe("# Snapshot");
  await page.reload(); await expect(editor).toContainText("Nyare utkast");
  state.beforePut = async () => {};
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sparat till GitHub"); expect(state.note.text).toBe("# Nyare utkast");
});
test("two browser sessions show a conflict and allow an explicit reviewed result", async ({ page, context, browser }) => {
  const { state, install } = fixture(); await install(context);
  const otherContext = await browser.newContext(); await install(otherContext); const other = await otherContext.newPage();
  const firstEditor = await openFixture(page); const secondEditor = await openFixture(other);
  await firstEditor.fill("# Session ett"); await secondEditor.fill("# Session två");
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Sparat till GitHub");
  await other.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(other.getByRole("dialog")).toBeVisible(); expect(state.note.text).toBe("# Session ett");
  await other.getByRole("textbox", { name: "Resultat att granska" }).fill("# Båda sessionernas granskade resultat");
  await other.getByRole("button", { name: "Använd resultatet" }).click();
  await other.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(other.getByRole("status")).toContainText("Sparat till GitHub"); expect(state.note.text).toContain("Båda sessionernas");
  await otherContext.close();
});
test("a lost save response survives reload and is verified without a duplicate write", async ({ page, context }) => {
  const { state, install } = fixture(); await install(context); const editor = await openFixture(page);
  await editor.fill("# Rädda ett tappat svar"); state.lostResponse = true;
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kontrollera och spara" })).toBeEnabled();
  await page.reload(); await expect(editor).toContainText("Rädda ett tappat svar");
  await expect(page.getByRole("status")).toContainText("Sparat till GitHub");
  // Recovery confirms the prior snapshot. No second PUT is needed when no newer edit exists.
  expect(state.putCount).toBe(1);
});
test("expired login and offline editing preserve the local draft", async ({ page, context }) => {
  const { state, install } = fixture(); await install(context); const editor = await openFixture(page);
  await editor.fill("# Bevara mig"); state.failAuth = true;
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(page.getByRole("link", { name: "Logga in igen med samma konto" })).toBeVisible();
  await expect(editor).toContainText("Bevara mig");
  await context.setOffline(true); await editor.fill("# Bevara även offline");
  await expect(page.getByRole("status")).toContainText("Inloggning krävs");
  await context.setOffline(false); state.failAuth = false; await page.reload();
  await expect(editor).toContainText("Bevara även offline");
});
test("editing preserves frontmatter, BOM, mixed newlines and unknown Obsidian syntax", async ({ page, context }) => {
  const { state, install } = fixture();
  const original = '\ufeff---\r\ncustom: "åäö"\n---\r\n![[Odling#Rubrik]]\n^block-id';
  state.note.text = original;
  await install(context); const editor = await openFixture(page);
  await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText("!");
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sparat till GitHub");
  expect(state.note.text).toBe(original + "!");
});
test("a created Swedish note is readable with exactly the saved text in a new browser session", async ({ page, context, browser }) => {
  const { state, install } = fixture(); await install(context); await openFixture(page);
  await page.getByRole("button", { name: "Ny anteckning" }).first().click();
  await page.getByRole("textbox", { name: "Namn och eventuell mapp" }).fill("Trädgården/Årets plan.md");
  await page.getByRole("button", { name: "Skapa anteckning" }).click();
  await expect(page.getByRole("heading", { name: "Årets plan", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toContainText("Årets plan");
  await expect(page.getByText("Anteckningen är skrivskyddad.", { exact: false })).toHaveCount(0);
  const content = "# Årets plan\n\n- [ ] Odla örter\n\n[[Fröer|mina fröer]]\n";
  await page.getByRole("textbox", { name: "Anteckningens innehåll" }).fill(content);
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sparat till GitHub"); expect(state.note.text).toBe(content);
  const secondContext = await browser.newContext(); await install(secondContext); const second = await secondContext.newPage();
  const editor = await openFixture(second); await expect(editor).toContainText("[[Fröer|mina fröer]]");
  // The new session caches exactly the response rather than a parsed Markdown representation.
  const text = await second.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("gitbsidian-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const notes = await new Promise<{ text: string }[]>((resolve, reject) => { const request = database.transaction("drafts").objectStore("drafts").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    database.close(); return notes[0].text;
  });
  expect(text).toBe(content); await secondContext.close();
});
test("server API refuses unauthenticated reads and cross-origin writes", async ({ request }) => {
  const read = await request.get("/api/notes?workspace=guessed&path=note.md"); expect(read.status()).toBe(401);
  const write = await request.put("/api/notes?workspace=guessed", { data: { path: "note.md", text: "attack", baseSha: null }, headers: { Origin: "https://attacker.example", "X-Gitbsidian": "1" } }); expect(write.status()).toBe(403);
});

test("Wiki and repository files retain independent drafts for identical paths and restore the selected mode", async ({ page, context }) => {
  const { state, install } = fixture(); await install(context); const editor = await openFixture(page);
  await editor.fill("# Repository draft"); await expect(page.getByRole("status")).toContainText("Utkast sparat");
  await page.locator(".workspace-button").click();
  await page.getByRole("button", { name: "Välj via GitHub", exact: true }).click();
  await page.getByRole("radio", { name: "GitHub Wiki" }).check();
  await page.getByRole("combobox", { name: "Repository" }).selectOption("1");
  await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
  await expect(editor).toContainText("Wiki original");
  await expect(page.getByText("Anteckningen är skrivskyddad.", { exact: false })).toHaveCount(0);
  await editor.fill("# Wiki draft"); await expect(page.getByRole("status")).toContainText("Utkast sparat");
  await page.reload(); await expect(editor).toContainText("Wiki draft");
  await page.getByRole("button", { name: "Spara till GitHub Wiki", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sparat till GitHub"); expect(state.wikiNote.text).toBe("# Wiki draft");
  await page.locator(".workspace-button").click();
  await page.getByRole("button", { name: "Välj via GitHub", exact: true }).click();
  await page.getByRole("combobox", { name: "Repository" }).selectOption("1");
  await expect(page.getByRole("combobox", { name: "Gren", exact: true })).toHaveValue("main");
  await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
  await expect(editor).toContainText("Repository draft");
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sparat till GitHub"); expect(state.note.text).toBe("# Repository draft"); expect(state.wikiNote.text).toBe("# Wiki draft");
});

test("Wiki rejects folders and uses the same reviewed conflict flow", async ({ page, context }) => {
  const { state, install } = fixture(); await install(context); const editor = await openFixture(page, "wiki");
  await page.getByRole("button", { name: "Ny anteckning" }).first().click();
  await page.getByRole("textbox", { name: "Sidnamn" }).fill("Folder/Page.md");
  await page.getByRole("button", { name: "Skapa anteckning" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "sidnamn utan mappar" })).toBeVisible();
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await editor.fill("# Lokal Wiki"); state.wikiNote = { ...state.wikiNote, text: "# Extern Wiki", sha: "c".repeat(40) };
  await page.getByRole("button", { name: "Spara till GitHub Wiki", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "Resultat att granska" }).fill("# Granskad Wiki");
  await page.getByRole("button", { name: "Använd resultatet" }).click();
  await page.getByRole("button", { name: "Spara till GitHub Wiki", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sparat till GitHub"); expect(state.wikiNote.text).toBe("# Granskad Wiki");
});

test("Wiki unavailability is explained before opening a workspace", async ({ page, context }) => {
  const { state, install } = fixture(); state.wikiAvailable = false; await install(context);
  await page.goto("/"); await page.getByRole("button", { name: "Öppna en arbetsyta" }).click();
  await expect(page.getByRole("radio", { name: "GitHub Wiki" })).toBeDisabled();
  await expect(page.getByText("Git saknas på servern.")).toBeVisible();
});
