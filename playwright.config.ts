import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { baseURL: "http://localhost:3000", ...devices["Desktop Chrome"], channel: process.platform === "win32" ? "msedge" : "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run start", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 90_000 },
});
