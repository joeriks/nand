import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

// Simulate the persisted folder selection, then exercise the real filesystem commands.
// The OS folder picker itself is not automated.
const profile = resolve(`.data/folder-verification-${Date.now()}`);
const child = spawn(resolve("src-tauri/target/verification/release/gitbsidian.exe"), [], {
  windowsHide: true, stdio: "ignore", env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9483", WEBVIEW2_USER_DATA_FOLDER: profile },
});
let browser; let config; let previousConfig;
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9483"); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!browser) throw Error("No verification WebView");
  const page = browser.contexts()[0].pages()[0];
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  const initial = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("local_snapshot"));
  if (!initial.directory.includes("se.gitbsidian.verification")) throw Error("Refusing production folder");
  config = join(dirname(initial.directory), "local-folder.json");
  previousConfig = await readFile(config).catch(() => null);
  const folderA = resolve(profile, "Collection A"); const folderB = resolve(profile, "Collection B");
  await mkdir(folderA, { recursive: true }); await mkdir(folderB, { recursive: true });
  await mkdir(join(folderA, "Unopened"));
  for (let i = 0; i < 1005; i++) await mkdir(join(folderA, "Unopened", `Folder-${i}`));
  await writeFile(join(folderA, "Unread.md"), Buffer.from([255, 254, 0]));
  await writeFile(join(folderA, "Shared.md"), "# Collection A\n");
  await writeFile(join(folderB, "Shared.md"), "# Collection B\n");
  const select = async directory => {
    await writeFile(config, JSON.stringify({ directory, scope: `local-folder:${directory.toLowerCase()}` }));
    await page.reload();
    await expect(page.getByRole("button", { name: "Öppna i Utforskaren" })).toHaveAttribute("title", directory);
    await page.getByText("Utforska rotmappen", { exact: true }).click();
    if (!(await page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true }).isChecked())) await page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Shared", exact: true }).click();
  };
  await select(folderA);
  const editor = page.getByRole("textbox", { name: "Anteckningens innehåll" });
  await expect(editor).toContainText("Collection A");
  const listing = await page.evaluate(async directory => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const first = await invoke("local_list_directory", { directory, path: "Unopened", offset: 0 });
    const second = await invoke("local_list_directory", { directory, path: "Unopened", offset: first.next });
    const selected = await invoke("local_snapshot", { directory, paths: ["Shared.md"] });
    let traversal = false;
    try { await invoke("local_list_directory", { directory, path: "../", offset: 0 }); } catch { traversal = true; }
    return { first, second, selected, traversal };
  }, folderA);
  expect(listing.first.entries).toHaveLength(200); expect(listing.second.entries).toHaveLength(200);
  expect(listing.first.next).toBe(200); expect(listing.traversal).toBe(true);
  expect(listing.selected.files.map(file => file.path)).toEqual(["Shared.md"]);
  await editor.fill("# A edited in app\n");
  await expect.poll(() => readFile(join(folderA, "Shared.md"), "utf8")).toContain("A edited in app");
  await page.getByLabel("Fler alternativ").click(); await expect(page.getByRole("button", { name: "Välj rotmapp" })).toBeVisible();
  await page.keyboard.press("Escape");
  await select(folderB); await expect(editor).toContainText("Collection B");
  const stale = await page.evaluate(async directory => {
    try { await window.__TAURI_INTERNALS__.invoke("local_save", { directory, path: "Shared.md", text: "Wrong folder", expected: "# Collection B\n" }); return false; }
    catch { return true; }
  }, folderA);
  expect(stale).toBe(true); expect(await readFile(join(folderB, "Shared.md"), "utf8")).toBe("# Collection B\n");
  await writeFile(join(folderB, "Shared.md"), "# External edit\n"); await expect(editor).toContainText("External edit");
  await writeFile(join(folderB, "Data.csv"), "Name,Value\nExternal,42\n");
  await expect(page.getByRole("button", { name: "Data.csv", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Uppdatera mappen", exact: true }).click();
  await page.getByRole("checkbox", { name: "Inkludera Data.csv", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Inkludera Data.csv", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Data.csv", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: "Öppna i Utforskaren" })).toHaveAttribute("title", folderB);
  await select(folderA); await expect(editor).toContainText("A edited in app");
  await page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Shared", exact: true })).toHaveCount(0);
  expect(await readFile(join(folderA, "Shared.md"), "utf8")).toContain("A edited in app");
  await page.reload();
  await page.getByText("Utforska rotmappen", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Inkludera Shared.md", exact: true })).toBeChecked();
  await expect(editor).toContainText("A edited in app");
  await page.getByRole("checkbox", { name: "Inkludera Unread.md", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("UTF-8");
  await expect(page.getByRole("checkbox", { name: "Inkludera Unread.md", exact: true })).not.toBeChecked();
  await expect(editor).toContainText("A edited in app");
  await page.screenshot({ path: "artifacts/local-folder-selection.png" });
  await writeFile("artifacts/local-folder-verification.json", JSON.stringify({ result: "passed", checkedAt: new Date().toISOString(), checks: ["persisted root selection", "separate drafts with same filename", "direct filesystem writes", "external edits of selected files; new CSV requires explicit inclusion", "1005 unopened directories do not block selected files", "invalid unselected file does not block selection", "persistent exclusion without disk deletion", "stale directory save rejected", "reload and return to former root"], nativePickerAutomated: false }, null, 2));
  console.log("Local folder selection, persistence, isolation and direct filesystem checks passed.");
} finally {
  child.kill(); await browser?.close().catch(() => {});
  if (config) {
    if (previousConfig) await writeFile(config, previousConfig);
    else await rm(config, { force: true }); // exact file in the validated verification app directory
  }
}
