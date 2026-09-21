import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const executable = resolve("src-tauri/target/verification/release/gitbsidian.exe");
const profile = resolve(`.data/file-opening-${Date.now()}`);
const folder = join(profile, "Filer å & mellanrum");
await mkdir(folder, { recursive: true });
const textPath = join(folder, "Min text å.TXT");
const mdPath = join(folder, "Mina tankar.md");
const csvPath = join(folder, "Min tabell.csv");
await writeFile(textPath, "# Vanlig text\r\n<b>Inte HTML</b>\r\n");
await writeFile(mdPath, "# Öppnad direkt\n");
await writeFile(csvPath, "ID,Namn\n00123,Åsa\n");
await writeFile(join(folder, "invalid.txt"), Buffer.from([255, 254, 0]));
let child, browser, config, history, oldConfig, oldHistory;
async function launch(args) {
  child = spawn(executable, args, { windowsHide: true, stdio: "ignore", cwd: folder, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9484", WEBVIEW2_USER_DATA_FOLDER: profile } });
  for (let attempt = 0; attempt < 120; attempt++) {
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9484"); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!browser) throw Error("Test WebView unavailable");
  const page = browser.contexts()[0].pages()[0];
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:app|identifier"))).toMatch(/^se\.gitbsidian\.verification/);
  return page;
}
async function another(args) {
  const before = new Set(browser.contexts().flatMap(context => context.pages()));
  const copy = spawn(executable, args, { windowsHide: true, stdio: "ignore", cwd: folder, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile } });
  const exited = new Promise(resolve => copy.once("exit", resolve));
  let added;
  await expect.poll(() => { added = browser.contexts().flatMap(context => context.pages()).filter(page => !before.has(page)); return added.length; }, { timeout: 15000 }).toBe(args.length);
  await exited;
  return added;
}
try {
  let page = await launch([]);
  const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("local_folder_info"));
  if (!info.directory.includes("se.gitbsidian.verification")) throw Error("Refusing non-test profile");
  config = join(dirname(info.directory), "local-folder.json"); history = join(dirname(info.directory), "local-folder-history.json");
  oldConfig = await readFile(config).catch(() => null); oldHistory = await readFile(history).catch(() => null);
  const exited = new Promise(resolve => child.once("exit", resolve));
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
  await exited; await browser.close(); browser = null;

  page = await launch([textPath]);
  await expect(page.locator(".breadcrumbs")).toContainText("Min text å.TXT");
  await expect(page.getByRole("textbox", { name: "Textfilens innehåll" })).toBeEditable();
  await expect(page.getByRole("textbox", { name: "Textfilens innehåll" })).toContainText("<b>Inte HTML</b>");
  expect(await readFile(textPath, "utf8")).toBe("# Vanlig text\r\n<b>Inte HTML</b>\r\n");
  await page.getByRole("textbox", { name: "Textfilens innehåll" }).fill("Ändrat i nand");
  await expect.poll(() => readFile(textPath, "utf8")).toBe("Ändrat i nand");
  await page.screenshot({ path: "artifacts/direct-file-opening.png" });
  const pages = await another(["Mina tankar.md", "Min tabell.csv"]);
  for (const opened of pages) await expect(opened.getByLabel("Fil att importera")).toBeEnabled();
  // Window order is not guaranteed; identify each by its opened filename.
  let csvPage, markdownPage;
  for (const opened of pages) {
    await expect(opened.locator(".breadcrumbs")).toContainText(/Mina tankar\.md|Min tabell\.csv/);
    if ((await opened.locator(".breadcrumbs").innerText()).includes(".csv")) csvPage = opened; else markdownPage = opened;
  }
  await expect(markdownPage.getByRole("textbox", { name: "Anteckningens innehåll" })).toContainText("Öppnad direkt");
  await expect(csvPage.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("00123");
  await expect(page.getByRole("textbox", { name: "Textfilens innehåll" })).toHaveText("Ändrat i nand");
  const [duplicate] = await another([textPath]);
  await expect(duplicate.getByRole("textbox", { name: "Textfilens innehåll" })).not.toBeEditable();
  const [invalid] = await another(["invalid.txt"]);
  await expect(invalid.locator(".global-error")).toContainText("UTF-8");
  const [missing] = await another(["missing.md"]);
  await expect(missing.locator(".global-error")).toContainText("Filen finns inte");
  expect(await readFile(mdPath, "utf8")).toBe("# Öppnad direkt\n");
  expect(await readFile(csvPath, "utf8")).toBe("ID,Namn\n00123,Åsa\n");
  await writeFile("artifacts/file-opening-verification.json", JSON.stringify({ result: "passed", checkedAt: new Date().toISOString(), checks: ["cold start TXT with Unicode and spaces", "direct write to original file", "running instance receives relative Markdown and CSV arguments", "multiple files open separately", "existing window unchanged", "same file protected in another window", "invalid UTF-8 and missing file show errors"], registryInstallationTested: false }, null, 2));
  console.log("Direct file opening passed: cold start, running app, TXT/MD/CSV, unchanged originals and error cases.");
} finally {
  child?.kill(); await browser?.close().catch(() => {});
  if (config) { if (oldConfig) await writeFile(config, oldConfig); else await rm(config, { force: true }); }
  if (history) { if (oldHistory) await writeFile(history, oldHistory); else await rm(history, { force: true }); }
}
