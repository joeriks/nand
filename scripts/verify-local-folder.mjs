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
  await writeFile(join(folderA, "Shared.md"), "# Collection A\n");
  await writeFile(join(folderB, "Shared.md"), "# Collection B\n");
  const select = async directory => {
    await writeFile(config, JSON.stringify({ directory, scope: `local-folder:${directory.toLowerCase()}` }));
    await page.reload();
    await expect(page.getByRole("button", { name: "Öppna i Utforskaren" })).toHaveAttribute("title", directory);
    await page.getByTitle("Shared.md", { exact: true }).click();
  };
  await select(folderA);
  const editor = page.getByRole("textbox", { name: "Anteckningens innehåll" });
  await expect(editor).toContainText("Collection A");
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
  await expect(page.getByTitle("Data.csv", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: "Öppna i Utforskaren" })).toHaveAttribute("title", folderB);
  await select(folderA); await expect(editor).toContainText("A edited in app");
  await page.screenshot({ path: "artifacts/local-folder-selection.png" });
  await writeFile("artifacts/local-folder-verification.json", JSON.stringify({ result: "passed", checkedAt: new Date().toISOString(), checks: ["persisted root selection", "separate drafts with same filename", "direct filesystem writes", "external modifications and new CSV discovery", "stale directory save rejected", "reload and return to former root"], nativePickerAutomated: false }, null, 2));
  console.log("Local folder selection, persistence, isolation and direct filesystem checks passed.");
} finally {
  child.kill(); await browser?.close().catch(() => {});
  if (config) {
    if (previousConfig) await writeFile(config, previousConfig);
    else await rm(config, { force: true }); // exact file in the validated verification app directory
  }
}
