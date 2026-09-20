import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

// Only the isolated verification binary is launched. Never run a real installer here.
const profile = resolve(`.data/updater-verification-${Date.now()}`);
const child = spawn(resolve("src-tauri/target/verification/release/gitbsidian.exe"), [], {
  windowsHide: true, stdio: "ignore", env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9482", WEBVIEW2_USER_DATA_FOLDER: profile },
});
let browser;
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9482"); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!browser) throw Error("No verification WebView");
  const page = browser.contexts()[0].pages()[0];
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  const snapshot = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("local_snapshot"));
  if (!snapshot.directory.includes("se.gitbsidian.verification")) throw Error("Refusing production data folder");
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    window.updaterTest = { native, mode: "available", calls: [] };
    const nativeFetch = window.fetch.bind(window);
    const simulate = async (command, args) => {
      const test = window.updaterTest;
      if (command === "plugin:updater|check") {
        if (test.mode === "offline") throw Error("network unavailable");
        if (test.mode === "current") return null;
        return { rid: 99001, currentVersion: "0.3.3", version: "0.3.4", body: "Testad uppdatering", rawJson: {} };
      }
      if (command === "plugin:updater|download") {
        test.calls.push("download");
        await new Promise(resolve => { test.finishDownload = resolve; });
        if (test.mode === "bad-signature") throw Error("Invalid signature");
        return 99002;
      }
      if (command === "plugin:updater|install") { test.calls.push("install"); throw Error("Simulerat installationsfel"); }
      if (command === "plugin:resources|close" && args.rid >= 99001) return;
      if (command === "prepare_app_update" || command === "resume_after_update_error") test.calls.push(command);
      throw Error(`Unexpected simulated command ${command}`);
    };
    window.fetch = async (url, options) => {
      const parsed = new URL(String(url));
      const command = decodeURIComponent(parsed.pathname.slice(1));
      const args = typeof options?.body === "string" ? JSON.parse(options.body) : {};
      if (parsed.hostname === "ipc.localhost") {
        if (command.startsWith("plugin:updater|") || (command === "plugin:resources|close" && args.rid >= 99001)) {
          try { return new Response(JSON.stringify(await simulate(command, args) ?? null), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }); }
          catch { return new Response(JSON.stringify("Simulerat uppdateringsfel"), { headers: { "Content-Type": "application/json", "Tauri-Response": "error" } }); }
        }
        if (command === "prepare_app_update" || command === "resume_after_update_error") window.updaterTest.calls.push(command);
      }
      return nativeFetch(url, options);
    };
  });
  await page.getByLabel("Fler alternativ").click();
  await page.getByRole("button", { name: "Appuppdateringar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Appuppdateringar" });
  await expect(dialog.getByText("nand 0.3.4 finns att installera.")).toBeVisible();
  await dialog.getByRole("button", { name: "Stäng", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ny version", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ny version", exact: true }).click();
  await page.evaluate(() => { window.updaterTest.mode = "bad-signature"; });
  await dialog.getByRole("button", { name: "Uppdatera och starta om" }).click();
  await expect(dialog.getByRole("button", { name: "Stäng", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  await page.evaluate(() => window.updaterTest.finishDownload());
  await expect(dialog.getByRole("status")).toContainText("Uppdateringen kunde inte installeras");
  expect(await page.evaluate(() => window.updaterTest.calls.includes("install"))).toBe(false);
  await page.evaluate(() => { window.updaterTest.mode = "available"; });
  await dialog.getByRole("button", { name: "Sök efter uppdateringar" }).click();
  await dialog.getByRole("button", { name: "Uppdatera och starta om" }).click();
  await expect(dialog.getByRole("status")).toContainText("Hämtar");
  await page.evaluate(() => window.updaterTest.finishDownload());
  await expect(dialog.getByRole("status")).toContainText("Uppdateringen kunde inte installeras");
  const calls = await page.evaluate(() => window.updaterTest.calls);
  expect(calls.slice(-3)).toEqual(["prepare_app_update", "install", "resume_after_update_error"]);
  const session = await page.evaluate(() => window.updaterTest.native("backend_request", { request: { url: "/api/session", method: "GET", body: null } }));
  expect(session.status).toBe(200);
  await page.evaluate(() => { window.updaterTest.mode = "current"; });
  await dialog.getByRole("button", { name: "Sök efter uppdateringar" }).click();
  await expect(dialog.getByRole("status")).toContainText("senaste versionen");
  await page.evaluate(() => { window.updaterTest.mode = "offline"; });
  await dialog.getByRole("button", { name: "Sök efter uppdateringar" }).click();
  await expect(dialog.getByRole("status")).toContainText("Kontrollera internetanslutningen");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/updater-dialog.png" });
  await writeFile("artifacts/updater-verification.json", JSON.stringify({ version: JSON.parse(await readFile("package.json", "utf8")).version, result: "passed", calls, actualInstallerRun: false, checkedAt: new Date().toISOString() }, null, 2));
  console.log("Updater UI and native sidecar shutdown/recovery passed; installer transport simulated.");
} catch (error) {
  if (browser) console.log(await browser.contexts()[0].pages()[0].evaluate(() => ({ descriptor: Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__, "invoke"), calls: window.updaterTest?.calls, keys: Object.keys(window.__TAURI_INTERNALS__) })));
  throw error;
} finally {
  // This is exclusively our isolated verification child process.
  child.kill(); await browser?.close().catch(() => {});
}
