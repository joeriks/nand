import { openActions } from "./actions";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const content = '\ufeffID;Namn;Antal;Pris;Datum\r\n00123;Åsa;10;1,25;2026-09-20\r\n00456;Bertil;2;ok;20/09/2026\r\n';
test("columns require confirmation, affect hidden rows and undo restores types and data", async ({ page }) => {
  await localCsv(page);
  await page.getByLabel("Datatyp för Antal").selectOption("integer");
  await page.getByRole("button", { name: "Lägg till kolumn", exact: true }).click();
  await page.getByLabel("Kolumnnamn", { exact: true }).fill("Kommentar");
  await page.getByRole("button", { name: "Lägg till", exact: true }).click();
  await page.getByLabel("Rad 1, Kommentar", { exact: true }).fill("Behåll");
  await page.getByLabel("Filtrera ID", { exact: true }).fill("00123");
  await page.getByRole("button", { name: "Ta bort kolumn Namn", exact: true }).click();
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await expect(page.getByLabel("Rad 1, Namn", { exact: true })).toHaveValue("Åsa");
  await page.getByRole("button", { name: "Ta bort kolumn Namn", exact: true }).click();
  await page.getByRole("dialog", { name: "Ta bort kolumn?", exact: true }).getByRole("button", { name: "Ta bort kolumn", exact: true }).click();
  await expect(page.getByLabel("Datatyp för Namn")).toHaveCount(0);
  await expect(page.getByLabel("Datatyp för Antal")).toHaveValue("integer");
  const removed = await exported(page);
  expect(removed.text).not.toContain("Bertil");
  expect(removed.text).toContain("00456;2;ok;20/09/2026");
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect(page.getByLabel("Rad 2, Namn", { exact: true })).toHaveValue("Bertil");
  await expect(page.getByLabel("Datatyp för Antal")).toHaveValue("integer");
  await expect(page.getByLabel("Rad 1, Kommentar", { exact: true })).toHaveValue("Behåll");
});

test("new files can be created as CSV and text", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await page.getByRole("button", { name: "Ny anteckning +", exact: true }).click();
  await page.getByLabel("Namn och eventuell mapp").fill("New table");
  await page.getByRole("combobox", { name: "Filtyp", exact: true }).selectOption("csv");
  await page.getByRole("button", { name: "Skapa anteckning", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("New table.csv");
  await page.getByRole("button", { name: "Lägg till rad", exact: true }).click();
  await page.getByLabel("Rad 1, Namn", { exact: true }).fill("Created");
  await expect(page.getByLabel("Rad 1, Namn", { exact: true })).toHaveValue("Created");
  await page.getByRole("button", { name: "Ny anteckning +", exact: true }).click();
  await page.getByLabel("Namn och eventuell mapp").fill("Plain");
  await page.getByRole("combobox", { name: "Filtyp", exact: true }).selectOption("txt");
  await page.getByRole("button", { name: "Skapa anteckning", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Plain.txt");
  await expect(page.getByRole("textbox", { name: "Textfilens innehåll" })).toBeEditable();
});
test("headerless ragged rows retain values when adding and removing columns", async ({ page }) => {
  await localCsv(page, "ID,Value\n1\n2,Keep\n");
  await page.getByLabel("Första raden är rubriker").uncheck();
  await page.getByRole("button", { name: "Lägg till kolumn", exact: true }).click();
  await page.getByRole("button", { name: "Lägg till", exact: true }).click();
  await expect(page.getByLabel("Rad 3, Kolumn 2", { exact: true })).toHaveValue("Keep");
  await page.getByRole("button", { name: "Ta bort kolumn Kolumn 1", exact: true }).click();
  await page.screenshot({ path: "artifacts/csv-column-confirmation.png" });
  await page.getByRole("dialog", { name: "Ta bort kolumn?", exact: true }).getByRole("button", { name: "Ta bort kolumn", exact: true }).click();
  await expect(page.getByLabel("Rad 3, Kolumn 1", { exact: true })).toHaveValue("Keep");
  await page.getByRole("button", { name: "Ta bort kolumn Kolumn 2", exact: true }).click();
  await page.getByRole("dialog", { name: "Ta bort kolumn?", exact: true }).getByRole("button", { name: "Ta bort kolumn", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ta bort kolumn Kolumn 1", exact: true })).toBeDisabled();
  expect((await exported(page)).text).toBe('Value\n""\nKeep\n');
});
async function localCsv(page: Page, text = content, name = "data.csv") {
  await page.goto("/"); await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  await page.getByLabel("Fil att importera").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await expect(page.getByRole("region", { name: "CSV-redigerare" })).toBeVisible();
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toBeEditable();
}
async function exported(page: Page) {
  const wait = page.waitForEvent("download"); await openActions(page); await page.getByRole("button", { name: "Exportera CSV" }).click();
  const download = await wait;
  return { name: download.suggestedFilename(), text: await readFile((await download.path())!, "utf8") };
}

test("CSV preserves original values, defaults ambiguous types to text and marks manual type errors", async ({ page }) => {
  await localCsv(page);
  await expect(page.getByLabel("Datatyp för ID")).toContainText("Auto · Text");
  await expect(page.getByLabel("Datatyp för Antal")).toContainText("Auto · Heltal");
  await expect(page.getByLabel("Datatyp för Pris")).toContainText("Auto · Text");
  await expect(page.getByLabel("Datatyp för Datum")).toContainText("Auto · Text");
  await page.getByLabel("Datatyp för Pris").selectOption("decimal");
  await page.getByLabel("Datatyp för Datum").selectOption("date");
  await expect(page.getByLabel("Rad 2, Pris", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Rad 2, Datum", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Rad 1, Pris", { exact: true })).toHaveAttribute("aria-invalid", "false");
  expect((await exported(page)).text).toBe(content);
  await page.screenshot({ path: "artifacts/csv-type-validation.png" });
  await page.getByLabel("Datatyp för Datum").selectOption("text");
  await expect(page.getByLabel("Rad 2, Datum", { exact: true })).toHaveAttribute("aria-invalid", "false");
  await page.reload();
  await expect(page.getByLabel("Datatyp för Pris")).toHaveValue("decimal");
  await expect(page.getByLabel("Datatyp för Datum")).toHaveValue("text");
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("00123");
});

test("editing a sorted and filtered CSV changes the correct source row, supports undo and exports all rows", async ({ page }) => {
  await localCsv(page);
  await page.getByRole("button", { name: "Antal", exact: true }).click();
  await expect(page.locator(".csv-grid tbody tr").first().getByRole("textbox").first()).toHaveValue("00456");
  expect((await exported(page)).text).toBe(content);
  await page.getByLabel("Filtrera Namn").fill("Bertil");
  await page.getByLabel("Rad 2, Namn", { exact: true }).fill("Bertil ny");
  await page.getByLabel("Rad 2, Antal", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect(page.getByLabel("Rad 2, Antal", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Gör om", exact: true }).click();
  await expect(page.getByLabel("Rad 2, Antal", { exact: true })).toHaveValue("3");
  const saved = await exported(page);
  expect(saved.name).toBe("data.csv");
  expect(saved.text).toContain("00123;Åsa;10;1,25;2026-09-20\r\n");
  expect(saved.text).toContain("00456;Bertil ny;3;ok;20/09/2026\r\n");
  expect(saved.text.startsWith("\ufeff")).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Rad 2, Namn", { exact: true })).toHaveValue("Bertil ny");
  await page.getByRole("button", { name: "CSV-text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "CSV-filens innehåll" })).toContainText("00456;Bertil ny;3");
});

test("local CSV import does not overwrite existing files and handles malformed files in the raw editor", async ({ page }) => {
  await localCsv(page);
  await page.getByLabel("Fil att importera").setInputFiles({ name: "data.csv", mimeType: "text/csv", buffer: Buffer.from('ID,Namn\n9,"unfinished') });
  await expect(page.getByRole("heading", { name: "data (2)", exact: true })).toBeVisible();
  await expect(page.locator('.csv-editor [role="alert"]')).toContainText("citattecken");
  await page.getByRole("button", { name: "CSV-text", exact: true }).click();
  await page.getByRole("textbox", { name: "CSV-filens innehåll" }).fill("ID,Namn\n9,Klar\n");
  await page.getByRole("button", { name: "Tabell", exact: true }).click();
  await expect(page.getByLabel("Rad 1, Namn", { exact: true })).toHaveValue("Klar");
  await page.getByRole("button", { name: "data.csv", exact: false }).click();
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("00123");
});

test("headerless CSV, quoted multiline cells, pagination and row undo preserve all data", async ({ page }) => {
  const text = "ID,Namn\n" + Array.from({ length: 102 }, (_, index) => `${index},"Rad ${index}\nextra"`).join("\n");
  await localCsv(page, text);
  await expect(page.locator(".csv-grid tbody tr")).toHaveCount(100);
  await page.getByRole("button", { name: "Nästa", exact: true }).click();
  await expect(page.getByLabel("Rad 101, Namn", { exact: true })).toHaveValue("Rad 100\nextra");
  await page.getByRole("button", { name: "Ta bort rad 101", exact: true }).click();
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  expect((await exported(page)).text).toBe(text);
  await page.getByLabel("Första raden är rubriker").uncheck();
  await expect(page.getByLabel("Rad 1, Kolumn 1", { exact: true })).toHaveValue("ID");
  expect((await exported(page)).text).toBe(text);
});

test("repository CSV uses the existing offline queue and only editing writes content", async ({ page, context }) => {
  const repository = { id: 55, fullName: "fixture/csv", installationId: 7, defaultBranch: "main", private: true, hasWiki: false };
  const workspace = { mode: "repository", repository, branch: "main", root: "Data" };
  let note = { path: "data.csv", text: "ID,Antal\n00123,10\n00456,2\n", sha: "a".repeat(40) };
  let puts = 0, online = true;
  await context.route("**/api/**", async route => {
    if (!online) return route.abort();
    const url = new URL(route.request().url()), method = route.request().method();
    const send = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    const entries = [{ path: note.path, sha: note.sha, size: note.text.length }];
    if (url.pathname === "/api/session") return send({ user: { id: 744, login: "csv-owner" }, configuration: { ready: true, missing: [], installUrl: null }, storage: { wiki: { available: false, reason: "Ingen Wiki i testet" } } });
    if (url.pathname === "/api/repositories") return send([repository]);
    if (url.pathname === "/api/branches") return send(["main"]);
    if (url.pathname === "/api/workspace") return send({ id: "csv", workspace, notes: entries });
    if (url.pathname === "/api/workspace/restore") return send({ id: "csv" });
    if (url.pathname === "/api/notes") {
      if (method === "GET") return send(url.searchParams.has("path") ? note : entries);
      if (method === "POST") return send([{ path: note.path, note }]);
      const input = route.request().postDataJSON(); expect(input.baseSha).toBe(note.sha);
      note = { ...note, text: input.text, sha: createHash("sha1").update(input.text).digest("hex") }; puts++; return send({ ...note, savedAt: Date.now() });
    }
    throw new Error(`Unexpected route ${url}`);
  });
  await page.goto("/"); await page.getByRole("button", { name: "Öppna en arbetsyta", exact: true }).click();
  await page.getByRole("combobox", { name: "Repository" }).selectOption("55");
  await page.getByRole("button", { name: "Öppna arbetsyta", exact: true }).click();
  await expect(page.getByLabel("Rad 2, Antal", { exact: true })).toBeEditable();
  await page.getByRole("button", { name: "Antal", exact: true }).click();
  await page.getByLabel("Datatyp för Antal").selectOption("integer");
  expect(puts).toBe(0);
  online = false;
  await page.getByLabel("Rad 2, Antal", { exact: true }).fill("3");
  await page.reload(); await expect(page.getByLabel("Rad 2, Antal", { exact: true })).toHaveValue("3");
  expect(puts).toBe(0); online = true;
  await page.getByRole("button", { name: "Spara till GitHub", exact: true }).click();
  await expect.poll(() => note.text).toContain("00456,3");
  expect(note.text).toContain("00123,10"); expect(puts).toBe(1);
});

test("empty single-column rows and manual integer errors survive export and reopening", async ({ page }) => {
  await localCsv(page, "ID\n1\n", "single.csv");
  await page.getByLabel("Datatyp för ID").selectOption("integer");
  await page.getByLabel("Rad 1, ID", { exact: true }).fill("1.5");
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Lägg till rad", exact: true }).click();
  await expect(page.getByLabel("Rad 2, ID", { exact: true })).toHaveValue("");
  const saved = await exported(page);
  expect(saved.text).toContain('1.5\n""\n');
  await page.reload();
  await expect(page.getByLabel("Rad 2, ID", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Rad 1, ID", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

test("typing in a sorted row keeps focus even when the new value belongs on another page", async ({ page }) => {
  await localCsv(page, "ID\n" + Array.from({ length: 102 }, (_, index) => String(index)).join("\n"));
  await page.getByRole("button", { name: "ID", exact: true }).click();
  const cell = page.getByLabel("Rad 100, ID", { exact: true });
  await cell.click(); await cell.press("End"); await cell.pressSequentially("00", { delay: 50 });
  await expect(cell).toHaveValue("9900");
  await expect(cell).toBeFocused();
  expect((await exported(page)).text).toContain("\n9900\n100\n101");
});
