import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Spectre UI E2E suite (Task 12).
 *
 * The dev server is started automatically by Playwright via the `webServer`
 * block below. Tests run against chromium only (the project standard) and
 * target http://localhost:3000.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    timeout: 60_000,
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "pipe",
  },
});
