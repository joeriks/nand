import type { Page } from "@playwright/test";
export async function openActions(page: Page) {
  if (!await page.locator(".action-menu").evaluate(element => (element as HTMLDetailsElement).open)) await page.getByLabel("Fler alternativ", { exact: true }).click();
}
