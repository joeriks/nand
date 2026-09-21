import { openActions } from "./actions";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const repository = { id: 87, fullName: "fixture/knowledge", installationId: 7, defaultBranch: "develop", private: true, hasWiki: true };
type Note = { path: string; text: string; sha: string };
const note = (path: string, text: string): Note => ({ path, text, sha: createHash("sha1").update(text).digest("hex") });
function remoteFiles() {
  const collections = {
    repository: new Map([note("Intro.md", "# Introduktion\n"), note("Tables/data.csv", "ID,Antal\n00123,10\n"), note("existing.csv", "ID\nOriginal\n")].map(value => [value.path, value])),
    wiki: new Map([note("Home.md", "# Wiki\n")].map(value => [value.path, value])),
  };
  const workspaces = new Map<string, { mode: keyof typeof collections; repository: typeof repository; root: string; branch: string }>();
  const state = { online: true, writes: [] as { mode: string; root: string; branch: string; path: string; baseSha: string | null }[] };
  async function install(context: BrowserContext) {
    await context.route("**/api/**", async route => {
      if (!state.online) return route.abort();
      const url = new URL(route.request().url()), method = route.request().method();
      const send = (data: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
      if (url.pathname === "/api/session") return send({ user: { id: 788, login: "import-owner" }, configuration: { ready: true, missing: [], installUrl: null }, storage: { wiki: { available: true, reason: null } } });
      if (url.pathname === "/api/repositories") return send([repository]);
      if (url.pathname === "/api/branches") return send(["main", "develop"]);
      const entries = (mode: keyof typeof collections) => [...collections[mode].values()].map(value => ({ path: value.path, sha: value.sha, size: Buffer.byteLength(value.text) }));
      if (url.pathname === "/api/workspace" || url.pathname === "/api/workspace/restore") {
        const input = route.request().postDataJSON();
        const workspace = { mode: input.mode as keyof typeof collections, repository, branch: input.mode === "wiki" ? "master" : input.branch, root: input.root };
        const id = workspace.mode; workspaces.set(id, workspace);
        return send(url.pathname.endsWith("restore") ? { id } : { id, workspace, notes: entries(workspace.mode) });
      }
      if (url.pathname === "/api/notes") {
        const workspace = workspaces.get(url.searchParams.get("workspace")!)!;
        const notes = collections[workspace.mode];
        if (method === "GET") {
          const path = url.searchParams.get("path");
          return send(path ? notes.get(path) || { path, text: "", sha: null } : entries(workspace.mode));
        }
        if (method === "POST") return send(route.request().postDataJSON().files.map(({ path }: { path: string }) => path === "existing.csv" ? { path, error: "Tillfälligt hämtningsfel" } : { path, note: notes.get(path) }));
        const input = route.request().postDataJSON();
        expect(input.baseSha).toBe(notes.get(input.path)?.sha || null);
        state.writes.push({ ...workspace, path: input.path, baseSha: input.baseSha });
        const saved = note(input.path, input.text); notes.set(input.path, saved);
        return send({ ...saved, savedAt: Date.now() });
      }
      throw new Error(`Unexpected route ${url.pathname}`);
    });
  }
  async function open(page: Page, mode: "repository" | "wiki") {
    await page.goto("/"); await page.getByRole("button", { name: "Öppna en arbetsyta", exact: true }).click();
    await page.getByRole("combobox", { name: "Repository" }).selectOption("87");
    if (mode === "wiki") await page.getByRole("radio", { name: "GitHub Wiki" }).check();
    else await page.getByRole("textbox", { name: "Undermapp" }).fill("Notes/Data");
    await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
    if (mode === "repository") await page.getByRole("navigation", { name: "Filer" }).getByRole("button", { name: "Intro", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toBeEditable();
  }
  return { collections, state, install, open };
}

test("TXT imports as plain text, preserves duplicate names and exports exact contents", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  const text = "# Not a heading\r\nPlain <b>text</b>\r\n";
  const file = { name: "example.TXT", mimeType: "text/plain", buffer: Buffer.from(text) };
  await page.getByLabel("Fil att importera").setInputFiles(file);
  await expect(page.getByRole("textbox", { name: "Textfilens innehåll" })).toContainText("# Not a heading");
  await expect(page.locator(".preview-pane")).toHaveCount(0);
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  await page.getByLabel("Fil att importera").setInputFiles(file);
  await expect(page.locator(".breadcrumbs")).toContainText("example (2).TXT");
  await openActions(page);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportera TXT" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("example (2).TXT");
  expect(await readFile((await download.path())!, "utf8")).toBe(text);
});

test("local file picker imports Markdown without overwriting and retains exact exported contents", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await expect(page.getByRole("button", { name: "Öppna lokal CSV" })).toHaveCount(0);
  await expect(page.locator(".workspace-link")).toHaveCount(0);
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  await page.getByLabel("Sök filnamn").fill("inget matchar");
  const content = "\ufeff# Importerad\r\n\r\nÅäö och [[mina länkar]].\r\n";
  const picker = page.waitForEvent("filechooser");
  await openActions(page); await page.getByRole("button", { name: "Importera fil", exact: true }).click();
  await (await picker).setFiles({ name: "Import.MD", mimeType: "text/markdown", buffer: Buffer.from(content) });
  await expect(page.getByRole("navigation", { name: "Filer" }).getByTitle("Import.MD", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sök filnamn")).toHaveValue("");
  const download = page.waitForEvent("download");
  await openActions(page); await page.getByRole("button", { name: "Exportera Markdown" }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toBe(content);
  await page.getByLabel("Fil att importera").setInputFiles({ name: "Import.MD", mimeType: "text/markdown", buffer: Buffer.from("# Andra kopian") });
  await expect(page.getByRole("heading", { name: "Import (2)", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toContainText("Andra kopian");
  await page.getByRole("navigation", { name: "Filer" }).getByTitle("Import.MD", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toContainText("Åäö och [[mina länkar]]");
});

test("repository CSV appears in the file list and an offline import uses the selected branch and folder", async ({ page, context }) => {
  const f = remoteFiles(); await f.install(context); await f.open(page, "repository");
  const link = page.getByRole("link", { name: "Öppna repository på GitHub", exact: true });
  await expect(link).toHaveAttribute("href", "https://github.com/fixture/knowledge");
  await expect(link).toHaveAttribute("target", "_blank");
  await page.getByRole("navigation", { name: "Filer" }).getByRole("button", { name: "data.csv", exact: true }).click();
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("00123");
  expect(f.state.writes).toHaveLength(0);
  await expect(page.locator(".offline-summary")).toContainText("existing.csv: Tillfälligt hämtningsfel");
  f.state.online = false;
  await page.getByLabel("Fil att importera").setInputFiles({ name: "existing.csv", mimeType: "text/csv", buffer: Buffer.from("ID\nImporterad\n") });
  await expect(page.getByRole("heading", { name: "existing (2)", exact: true })).toBeVisible();
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("Importerad");
  await page.reload();
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("Importerad");
  await expect(link).toBeVisible();
  f.state.online = true;
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect.poll(() => f.collections.repository.get("existing (2).csv")?.text).toBe("ID\nImporterad\n");
  expect(f.collections.repository.get("existing.csv")?.text).toBe("ID\nOriginal\n");
  expect(f.state.writes).toEqual([expect.objectContaining({ mode: "repository", branch: "develop", root: "Notes/Data", path: "existing (2).csv", baseSha: null })]);
  await page.screenshot({ path: "artifacts/file-import-repository.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Öppna navigation" }).click();
  await expect(page.locator(".sidebar")).toBeInViewport({ ratio: 1 });
  await expect(link).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Stäng navigation", exact: true }).first().click();
  await openActions(page);
  await expect(page.getByRole("button", { name: "Importera fil", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/file-import-mobile.png" });
});

test("wiki links to the wiki, imports Markdown there and explains unsupported CSV files", async ({ page, context }) => {
  const f = remoteFiles(); await f.install(context); await f.open(page, "wiki");
  await expect(page.getByRole("link", { name: "Öppna wiki på GitHub", exact: true })).toHaveAttribute("href", "https://github.com/fixture/knowledge/wiki");
  await page.getByLabel("Fil att importera").setInputFiles({ name: "data.csv", mimeType: "text/csv", buffer: Buffer.from("ID\n1\n") });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Wiki stöder Markdown");
  expect(f.state.writes).toHaveLength(0);
  await page.getByLabel("Fil att importera").setInputFiles({ name: "Home.md", mimeType: "text/markdown", buffer: Buffer.from("# Importerad Wiki-sida") });
  await expect(page.getByRole("heading", { name: "Home (2)", exact: true })).toBeVisible();
  await expect.poll(() => f.collections.wiki.get("Home (2).md")?.text).toBe("# Importerad Wiki-sida");
  expect(f.collections.wiki.get("Home.md")?.text).toBe("# Wiki\n");
  expect(f.state.writes).toEqual([expect.objectContaining({ mode: "wiki", branch: "master", root: "", path: "Home (2).md", baseSha: null })]);
});

test("invalid, oversized and non-UTF-8 imports do not add files", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  const files = page.getByRole("navigation", { name: "Filer" }).getByRole("button");
  for (const [name, buffer, message] of [
    ["image.png", Buffer.from("not a text file"), "Markdown-, TXT- eller CSV-fil"],
    ["large.md", Buffer.alloc(1024 * 1024 + 1, "x"), "högst 1 MiB"],
    ["invalid.csv", Buffer.from([0xff, 0xfe, 0x41]), "UTF-8"],
    ["binary.md", Buffer.from([65, 0, 66]), "UTF-8"],
  ] as const) {
    await page.getByLabel("Fil att importera").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(message);
    await expect(files).toHaveCount(1);
    await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  }
});

test("leaving the workspace waits for an import to finish persisting", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "Delayed.md") return original.call(this);
      return new Promise(resolve => window.addEventListener("finish-import", () => { void original.call(this).then(resolve); }, { once: true }));
    };
  });
  await page.getByLabel("Fil att importera").setInputFiles({ name: "Delayed.md", mimeType: "text/markdown", buffer: Buffer.from("# Importen finns kvar") });
  await expect(page.getByLabel("Fil att importera")).toBeDisabled();
  await page.getByRole("button", { name: "nand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Prova skrivytan lokalt" })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("finish-import")));
  await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await page.getByRole("navigation", { name: "Filer" }).getByTitle("Delayed.md", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Anteckningens innehåll" })).toContainText("Importen finns kvar");
});
