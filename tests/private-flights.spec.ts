import { test, expect } from "@playwright/test";

// Private flights layer: sub-type classification + Notable Flights panel +
// search overhaul. Tests run against the dev server on localhost:3000.

test.describe("Private Flights layer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30_000 });
    await page.waitForTimeout(3000);
  });

  test("private flights toggle exists", async ({ page }) => {
    const privateToggle = page.locator("button:has-text('PRIVATE FLIGHTS')");
    await expect(privateToggle).toBeVisible({ timeout: 10_000 });
  });

  test("Notable Flights panel appears when private flights is active", async ({ page }) => {
    const toggle = page.locator("button:has-text('PRIVATE FLIGHTS')");
    await toggle.click({ timeout: 10_000 });

    // Wait for the panel to load. Both "SEARCH PRIVATE FLIGHTS" button and
    // "NOTABLE FLIGHTS" header should appear.
    await expect(
      page.locator("text=/NOTABLE FLIGHTS/i").first()
    ).toBeVisible({ timeout: 90_000 });
  });

  test("search for N628TS returns results", async ({ page }) => {
    const toggle = page.locator("button:has-text('PRIVATE FLIGHTS')");
    await toggle.click({ timeout: 10_000 });

    await expect(
      page.locator("text=/NOTABLE FLIGHTS/i").first()
    ).toBeVisible({ timeout: 90_000 });

    const searchBtn = page.locator("button:has-text('SEARCH PRIVATE')");
    await searchBtn.click({ timeout: 15_000 });

    const searchInput = page.locator("input").first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill("N628TS");

    const findBtn = page.locator("button:has-text('FIND')");
    await findBtn.click({ timeout: 10_000 });

    await page.waitForTimeout(3000);

    const resultText = page.locator("text=/N628TS|GULFSTREAM|MUSK|ELON/i");
    await expect(resultText.first()).toBeVisible({ timeout: 15_000 });
  });

  test("search for 'oligarch' returns tagged aircraft", async ({ page }) => {
    const toggle = page.locator("button:has-text('PRIVATE FLIGHTS')");
    await toggle.click({ timeout: 10_000 });

    await expect(
      page.locator("text=/NOTABLE FLIGHTS/i").first()
    ).toBeVisible({ timeout: 90_000 });

    const searchBtn = page.locator("button:has-text('SEARCH PRIVATE')");
    await searchBtn.click({ timeout: 15_000 });

    const searchInput = page.locator("input").first();
    await searchInput.fill("oligarch");

    const findBtn = page.locator("button:has-text('FIND')");
    await findBtn.click({ timeout: 10_000 });

    await page.waitForTimeout(3000);

    const oligarchResult = page.locator("text=/OLIGARCH|RA-|Vagit|Alekperov|Abramov/i");
    await expect(oligarchResult.first()).toBeVisible({ timeout: 15_000 });
  });

  test("search for 'helicopter' returns helicopter-type aircraft", async ({ page }) => {
    const toggle = page.locator("button:has-text('PRIVATE FLIGHTS')");
    await toggle.click({ timeout: 10_000 });

    await expect(
      page.locator("text=/NOTABLE FLIGHTS/i").first()
    ).toBeVisible({ timeout: 90_000 });

    const searchBtn = page.locator("button:has-text('SEARCH PRIVATE')");
    await searchBtn.click({ timeout: 15_000 });

    const searchInput = page.locator("input").first();
    await searchInput.fill("helicopter");

    const findBtn = page.locator("button:has-text('FIND')");
    await findBtn.click({ timeout: 10_000 });

    await page.waitForTimeout(3000);

    const heliResult = page.locator("text=/BELL|EC|ROTOR|HELI|B407|S76/i");
    await expect(heliResult.first()).toBeVisible({ timeout: 15_000 });
  });
});
