import { expect, test } from "@playwright/test";
import { openActions } from "./actions";

test("secondary actions stay in a keyboard-accessible menu and Escape restores focus", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Prova skrivytan lokalt" }).click();
  await expect(page.getByLabel("Fil att importera")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Importera fil", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Exportera Markdown" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Öppna i Utforskaren" })).toHaveCount(0);
  const trigger = page.getByLabel("Fler alternativ", { exact: true });
  await trigger.focus(); await trigger.press("Enter");
  await expect(page.getByRole("button", { name: "Importera fil", exact: true })).toBeVisible();
  await trigger.press("Tab");
  await expect(page.getByRole("button", { name: "Importera fil", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Importera fil", exact: true })).toBeHidden();
  await openActions(page); await page.getByRole("button", { name: "Visa information" }).click();
  await expect(page.getByRole("heading", { name: "Om anteckningen" })).toBeVisible();
  await expect(page.locator(".action-menu")).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "Stäng information" }).click();
  await page.screenshot({ path: "artifacts/clean-local-workspace.png" });
  await openActions(page); await page.getByRole("heading", { name: "Min första anteckning", exact: true }).first().click();
  await expect(page.locator(".action-menu")).not.toHaveAttribute("open");
});
