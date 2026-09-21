import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { performance } from "node:perf_hooks";

// A separate bundle identifier also isolates native credentials and backend settings.
// No test flags, fake authentication or transport bypasses are added to the app.
const targetDirectory = resolve("src-tauri/target/verification");
const verificationIdentity = `se.gitbsidian.verification${Date.now()}`;
if (!process.argv.includes("--skip-build")) await new Promise((resolveBuild, reject) => {
  const build = spawn(process.execPath, ["scripts/tauri.mjs", "build", "--no-bundle", "--config", JSON.stringify({ identifier: verificationIdentity, productName: "nand verification" })], { windowsHide: true, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: targetDirectory } });
  build.once("error", reject);
  build.once("exit", code => code === 0 ? resolveBuild() : reject(new Error(`Verification build failed: ${code}`)));
});
const executable = resolve(targetDirectory, "release/gitbsidian.exe");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const profile = resolve(`.data/native-verification-${version}-${Date.now()}`);
const endpoint = "http://127.0.0.1:9481";
await mkdir("artifacts", { recursive: true });
const errors = [];
let launchCount = 0;
async function launch(offline = false, csv = false) {
  const number = ++launchCount;
  console.log(`Native launch ${number}: ${csv ? "CSV" : "Markdown"}, ${offline ? "offline reload" : "online"}`);
  const started = performance.now();
  const child = spawn(executable, [], { windowsHide: true, stdio: "ignore", env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9481", WEBVIEW2_USER_DATA_FOLDER: profile } });
  let browser;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(`${endpoint}/json/version`)).ok) { browser = await chromium.connectOverCDP(endpoint); break; } } catch { /* Wait for WebView2 to expose CDP. */ }
      if (child.exitCode !== null) throw new Error(`Desktop exited with ${child.exitCode}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!browser) throw new Error("WebView2 debugging endpoint was not available");
    const context = browser.contexts()[0];
    let page = context.pages()[0];
    if (!page) page = await context.waitForEvent("page", { timeout: 10_000 });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const editor = csv ? page.getByLabel("Rad 1, ID", { exact: true }) : page.getByRole("textbox", { name: "Anteckningens innehåll" });
    await expect(editor).toBeVisible();
    if (offline) {
      const before = await page.evaluate(() => performance.timeOrigin);
      await context.setOffline(true);
      await page.evaluate(() => { location.reload(); }).catch(error => { if (!/context was destroyed|navigation/i.test(error.message)) throw error; });
      await expect.poll(() => page.evaluate(() => performance.timeOrigin).catch(() => before)).not.toBe(before);
      await expect(editor).toBeVisible();
    }
    await expect(page.getByText("Anteckningen är skrivskyddad.", { exact: false })).toHaveCount(0);
    const readyMs = Math.round(performance.now() - started);
    return { child, browser, context, page, editor, readyMs, number };
  } catch (error) { child.kill(); if (browser) await browser.close().catch(() => {}); throw error; }
}
async function close(app) {
  console.log(`Native close ${app.number}`);
  // CDP offline emulation can also intercept the test runner's private IPC control URL.
  // Public network access is still irrelevant here: the synthetic account has no token.
  await app.context.setOffline(false);
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Native close ${app.number} did not finish`)), 20_000);
    app.child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
  await Promise.all([exited, app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(error => { if (!/closed|destroyed/i.test(error.message)) throw error; })]); await app.browser.close().catch(() => {});
}
let app;
try {
  app = await launch(); const firstReadyMs = app.readyMs;
  const session = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke("backend_request", { request: { url: "/api/session", method: "GET", body: null } }));
  expect(session.status).toBe(200); expect(session.data).toHaveProperty("storage.wiki.available");
  // Never run synthetic-account/logout checks against an actual saved credential.
  expect(session.data.user).toBeNull(); expect(session.data.localUser).toBeNull();
  expect(JSON.stringify(session)).not.toMatch(/access_token|client_secret|"token"/);
  const localFiles = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke("local_snapshot"));
  expect(localFiles.directory).toContain("se.gitbsidian.verification");
  await expect(app.page.getByRole("button", { name: "Öppna i Utforskaren", exact: true })).toHaveAttribute("title", localFiles.directory);
  const guardedPath = await app.page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke("local_save", { path: "../outside.md", text: "must not write", expected: null }); return false; }
    catch { return true; }
  });
  expect(guardedPath).toBe(true);
  const nativePath = `Native-guard-${Date.now()}.md`;
  const compareAndSave = await app.page.evaluate(async path => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const first = await invoke("local_save", { path, text: "# Original", expected: null });
    const conflict = await invoke("local_save", { path, text: "Must not overwrite", expected: "wrong base" });
    const updated = await invoke("local_save", { path, text: "# Updated", expected: "# Original" });
    return { first, conflict, updated };
  }, nativePath);
  expect(compareAndSave.first.saved).toBe(true);
  expect(compareAndSave.conflict).toEqual({ saved: false, text: "# Original" });
  expect(compareAndSave.updated.saved).toBe(true);
  expect(await readFile(join(localFiles.directory, nativePath), "utf8")).toBe("# Updated");
  const externalCsv = `External-${Date.now()}.csv`;
  await writeFile(join(localFiles.directory, externalCsv), "ID,Value\n00123,External\n");
  await app.page.getByText("Utforska rotmappen", { exact: true }).click();
  await app.page.getByRole("checkbox", { name: `Inkludera ${externalCsv}`, exact: true }).click();
  await expect(app.page.getByRole("checkbox", { name: `Inkludera ${externalCsv}`, exact: true })).toBeChecked();
  await expect(app.page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("00123");
  await app.page.getByLabel("Rad 1, Value", { exact: true }).fill("Edited in nand");
  await expect.poll(() => readFile(join(localFiles.directory, externalCsv), "utf8")).toContain("Edited in nand");
  await app.page.getByRole("button", { name: "Ny anteckning" }).first().click();
  const noteName = `Verifiering ${Date.now()}`;
  await app.page.getByRole("textbox", { name: "Namn och eventuell mapp" }).fill(`${noteName}.md`);
  await app.page.getByRole("button", { name: "Skapa anteckning" }).click();
  await expect(app.page.getByRole("heading", { name: noteName, exact: true }).first()).toBeVisible();
  await expect(app.editor).toContainText(noteName);
  await expect(app.editor).toBeEditable();
  await expect(app.page.getByText("Anteckningen är skrivskyddad.", { exact: false })).toHaveCount(0);
  const content = "# Tauri fungerar\n\nEn lokal skrivyta för **mina idéer**.\n\n- [ ] Nästa tanke\n\n[[Bevara min syntax]]";
  await app.editor.fill(content);
  await expect(app.page.locator(".markdown-preview strong")).toHaveText("mina idéer");
  // Close immediately after editing: the native close hook must drain local persistence.
  await close(app); app = undefined;
  expect(await readFile(join(localFiles.directory, `${noteName}.md`), "utf8")).toBe(content);
  app = await launch(); const secondReadyMs = app.readyMs;
  await expect(app.editor).toContainText("[[Bevara min syntax]]");
  await app.context.setOffline(true);
  await app.editor.fill(content + "\n\nÄven utan internet.");
  await expect.poll(() => readFile(join(localFiles.directory, `${noteName}.md`), "utf8")).toContain("Även utan internet.");
  await app.context.setOffline(false);
  await app.page.getByLabel("Fler alternativ", { exact: true }).click();
  await app.page.getByRole("button", { name: "Anslut GitHub" }).click();
  await expect(app.page.getByRole("dialog", { name: "Dina arbetsytor" })).toBeVisible();
  await app.page.getByRole("button", { name: "Stäng", exact: true }).click();
  await app.page.getByLabel("Fil att importera").setInputFiles({ name: "native-data.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Antal,Pris\n00123,10,1.25\n00456,2,fel\n") });
  await expect(app.page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("00123");
  await app.page.getByLabel("Datatyp för Pris").selectOption("decimal");
  await expect(app.page.getByLabel("Rad 2, Pris", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await app.page.getByRole("button", { name: "Antal", exact: true }).click();
  await app.page.getByLabel("Rad 2, Antal", { exact: true }).fill("3");
  await close(app); app = undefined;
  app = await launch(true, true);
  await expect(app.page.getByLabel("Rad 1, ID", { exact: true })).toHaveValue("00123");
  await expect(app.page.getByLabel("Rad 2, Antal", { exact: true })).toHaveValue("3");
  await expect(app.page.getByLabel("Datatyp för Pris")).toHaveValue("decimal");
  await expect(app.page.getByLabel("Rad 2, Pris", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await app.page.screenshot({ path: "artifacts/tauri-csv.png" });
  await app.page.getByRole("button", { name: noteName, exact: false }).click();
  await expect(app.page.getByRole("textbox", { name: "Anteckningens innehåll" })).toContainText("Även utan internet.");
  // Arrange a previously downloaded account in this isolated test profile. This is
  // synthetic cached GitHub data, not a real GitHub login or a token in the WebView.
  expect(session.data.user).toBeNull();
  await app.page.evaluate(async () => {
    const user = { id: 919191, login: "offline-test" };
    const workspace = { mode: "repository", repository: { id: 919191, fullName: "offline-test/notes", installationId: 99, defaultBranch: "main", private: true }, branch: "main", root: "Notes" };
    const scope = JSON.stringify([919191, "main", "Notes"]);
    const key = JSON.stringify([String(user.id), scope]);
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("gitbsidian-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction(["drafts", "workspaces"], "readwrite");
    const note = { path: "Offline.md", text: "# Hämtad före tokenutgång", sha: "a".repeat(40) };
    transaction.objectStore("workspaces").put({ key, account: String(user.id), workspace, notes: [{ path: note.path, sha: note.sha, size: note.text.length }], checkedAt: Date.now(), unavailable: {} });
    transaction.objectStore("drafts").put({ key: JSON.stringify([String(user.id), scope, note.path]), account: String(user.id), workspace: scope, path: note.path, text: note.text, baseText: note.text, baseSha: note.sha, updatedAt: Date.now() });
    const wiki = { ...workspace, mode: "wiki", branch: "master", root: "" };
    const wikiScope = JSON.stringify(["wiki", 919191, "master", ""]);
    const wikiNotes = ["Alpha.md", "Zebra.md"].map(path => ({ path, text: `# Wiki ${path}`, sha: "b".repeat(40) }));
    transaction.objectStore("workspaces").put({ key: JSON.stringify([String(user.id), wikiScope]), account: String(user.id), workspace: wiki, notes: wikiNotes.map(note => ({ path: note.path, sha: note.sha, size: note.text.length })), checkedAt: 1, unavailable: {} });
    for (const note of wikiNotes) transaction.objectStore("drafts").put({ key: JSON.stringify([String(user.id), wikiScope, note.path]), account: String(user.id), workspace: wikiScope, path: note.path, text: note.text, baseText: note.text, baseSha: note.sha, updatedAt: note.path === "Alpha.md" ? Date.now() + 999999 : 1 });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); db.close();
    localStorage.setItem("gitbsidian-local-access-v1", JSON.stringify({ user, generation: crypto.randomUUID() }));
    localStorage.setItem(`gitbsidian-last-${user.id}`, key);
  });
  await close(app); app = undefined;
  app = await launch(true);
  await expect(app.editor).toContainText("Hämtad före tokenutgång");
  await expect(app.page.locator(".offline-summary")).toContainText("1 av 1 anteckningar");
  await app.context.setOffline(true);
  await app.editor.fill("# Köat efter tokenutgång och offlineomstart");
  await close(app); app = undefined;
  app = await launch(true);
  await expect(app.editor).toContainText("Köat efter tokenutgång och offlineomstart");
  const queued = await app.page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("gitbsidian-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const rows = await new Promise((resolve, reject) => { const request = db.transaction("drafts").objectStore("drafts").index("account").getAll("919191"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close(); return rows;
  });
  expect(queued.find(note => note.path === "Offline.md").text).toBe("# Köat efter tokenutgång och offlineomstart");
  expect(queued.find(note => note.path === "Offline.md").baseText).toBe("# Hämtad före tokenutgång");
  await app.page.locator(".workspace-button").click();
  await app.page.getByRole("button", { name: "offline-test/notes · Wiki", exact: false }).click();
  await app.page.getByRole("button", { name: "Zebra", exact: true }).click();
  await expect(app.editor).toContainText("Wiki Zebra.md");
  await close(app); app = undefined;
  app = await launch(true);
  await expect(app.editor).toContainText("Wiki Zebra.md");
  await expect(app.page.locator(".statusbar")).toContainText("master");
  await app.page.locator(".workspace-button").click();
  await app.page.getByRole("button", { name: "offline-test/notes · main/Notes", exact: false }).click();
  await expect(app.editor).toContainText("Köat efter tokenutgång och offlineomstart");
  await close(app); app = undefined;
  app = await launch(true);
  await expect(app.editor).toContainText("Köat efter tokenutgång och offlineomstart");
  await expect(app.page.locator(".statusbar")).toContainText("main");
  await app.page.screenshot({ path: "artifacts/tauri-desktop.png" });
  await app.page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await app.page.getByRole("dialog").getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(app.page.locator(".workspace-button")).toContainText("Bara på den här enheten");
  await close(app); app = undefined;
  app = await launch();
  await expect(app.page.locator(".workspace-button")).toContainText("Bara på den här enheten");
  expect(errors).toEqual([]);
  await close(app); app = undefined;
  await writeFile("artifacts/desktop-verification.json", JSON.stringify({ version, checkedAt: new Date().toISOString(), identity: verificationIdentity, firstReadyMs, secondReadyMs, checks: ["ordinary local files: migration buffer, folder link, external CSV discovery and edit, disk persistence on close and offline, native write conflict and path traversal guards", "bundled local UI in separate verification release build", "native RPC and Git capability", "no token in WebView", "Markdown preview", "close flush and restart persistence", "offline editing", "workspace dialog", "CSV import, conservative types, manual type validation, sorted editing and offline restart persistence", "synthetic downloaded workspace with no valid credential", "offline navigation after native restart and durable queue", "last explicit Wiki selection and read-only selected note survive offline restart despite newer repository cache", "switching back to repository preserves branch, root and queued draft on offline restart", "explicit logout stays revoked on restart"], github: "synthetic cache; no live GitHub authentication or writes; user's credentials and backend settings isolated by app identifier", errors }, null, 2));
  console.log(JSON.stringify({ firstReadyMs, secondReadyMs, errors, result: "passed" }));
} catch (error) {
  if (app) {
    await app.page.screenshot({ path: "artifacts/desktop-verification-failure.png" }).catch(() => {});
    await writeFile("artifacts/desktop-verification-failure.json", JSON.stringify({ version, launch: app.number, error: String(error), errors, body: await app.page.locator("body").innerText({ timeout: 3000 }).catch(() => "Unavailable") }, null, 2));
  }
  throw error;
} finally { if (app) { app.child.kill(); await app.browser.close().catch(() => {}); } }
