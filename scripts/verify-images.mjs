import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "desktop/vite.config.ts", "--port", "1422"], { windowsHide: true, stdio: "ignore" });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch("http://127.0.0.1:1422/image-editor-test.html"); if (response.ok) break; }
    catch { /* Vite is starting. */ }
    if (attempt === 99) throw Error("Image test server unavailable");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1260, height: 820 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:1422/image-editor-test.html");
  const editor = page.getByRole("region", { name: "Bildredigerare" });
  await expect(editor.getByText("400 × 200 px", { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Spara till originalfil" })).toBeDisabled();
  await editor.getByLabel("Bildförhållande").selectOption("square");
  await editor.getByRole("button", { name: "Förhandsvisa resultat" }).click();
  const image = editor.getByAltText("Förhandsvisning av resultatet");
  await expect(image).toBeVisible();
  expect(await image.evaluate(element => [element.naturalWidth, element.naturalHeight])).toEqual([200, 200]);
  expect(await page.evaluate(() => window.__imageTest?.current === window.__imageTest?.initial)).toBe(true);
  await editor.getByRole("button", { name: "Tillbaka till redigering" }).click();
  await editor.getByLabel("Filformat").selectOption("image/webp");
  await expect(editor.getByRole("button", { name: "Spara till originalfil" })).toBeDisabled();
  await editor.getByRole("button", { name: "Spara som WebP…" }).click();
  await expect.poll(() => page.evaluate(() => window.__imageTest?.exported?.startsWith("data:image/webp;base64,"))).toBe(true);
  expect(await page.evaluate(() => window.__imageTest?.current === window.__imageTest?.initial)).toBe(true);
  await editor.getByLabel("Filformat").selectOption("image/png");
  await editor.getByRole("button", { name: "Spara till originalfil" }).click();
  await expect.poll(() => page.evaluate(() => window.__imageTest?.current !== window.__imageTest?.initial)).toBe(true);
  await expect(editor.getByText("200 × 200 px", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Ångra" }).click();
  await expect.poll(() => page.evaluate(() => window.__imageTest?.current === window.__imageTest?.initial)).toBe(true);
  await editor.getByRole("button", { name: "Rotera höger" }).click();
  await expect(editor.getByText("200 × 400 px", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Förhandsvisa resultat" }).click();
  await expect(editor.getByAltText("Förhandsvisning av resultatet")).toBeVisible();
  expect(await editor.getByAltText("Förhandsvisning av resultatet").evaluate(element => [element.naturalWidth, element.naturalHeight])).toEqual([200, 400]);
  await editor.getByRole("button", { name: "Tillbaka till redigering" }).click();
  await editor.getByRole("button", { name: "Markera utsnitt" }).click();
  const bounds = await editor.locator(".image-stage").boundingBox();
  if (!bounds) throw Error("Crop surface unavailable");
  await page.mouse.move(bounds.x + 25, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 125, bounds.y + 240, { steps: 8 });
  await page.mouse.up();
  const cropWidth = Number(await editor.getByLabel("Bredd px").inputValue());
  const cropHeight = Number(await editor.getByLabel("Höjd px").inputValue());
  expect(cropWidth).toBeGreaterThan(0); expect(cropWidth).toBeLessThan(200);
  expect(cropHeight).toBeGreaterThan(0); expect(cropHeight).toBeLessThan(400);
  if (errors.length) throw Error(`Browser errors: ${errors.join("; ")}`);
  await page.screenshot({ path: "artifacts/image-editor-verification.png" });
  await writeFile("artifacts/image-editor-verification.json", JSON.stringify({ result: "passed", checkedAt: new Date().toISOString(), checks: ["square crop preview", "format conversion leaves source unchanged", "save changes source", "undo restores source", "rotation changes dimensions", "drag selection changes crop rectangle"] }, null, 2));
  console.log("Image editor verified in Edge: crop, drag, format conversion, save, undo and rotation.");
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}
