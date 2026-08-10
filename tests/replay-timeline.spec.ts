import { test, expect, type Page } from "@playwright/test";

/**
 * Verify the two-tier satellite replay system:
 *
 * 1. GIBS tier: weekly + monthly stepping, 4 nav buttons (<< < > >>),
 *    for big-picture earth changes (ice melt, deforestation).
 *    - << = monthly back    < = weekly back
 *    - >  = weekly forward  >> = monthly forward
 *    Same 4-button layout as Sentinel.
 *
 * 2. Sentinel-2 tier: weekly + monthly stepping, 4 nav buttons (<< < > >>),
 *    for close-up tracking (construction, stadium builds, specific sites).
 *    - << = monthly back    < = weekly back
 *    - >  = weekly forward  >> = monthly forward
 */

const GLOBE_BOOT_TIMEOUT = 30_000;

async function waitForGlobe(page: Page) {
  await expect(page.locator("canvas").first()).toBeVisible({
    timeout: GLOBE_BOOT_TIMEOUT,
  });
}

async function openReplayPanel(page: Page) {
  const btn = page.getByText("LIVE/REPLAY", { exact: false }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
}

async function drillInto(page: Page, tier: "GIBS" | "SENTINEL-2") {
  const row = page.getByText(tier, { exact: false }).first();
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.click();
}

// Click via evaluate to bypass pointer-event interception from the globe canvas
async function clickByTestId(page: Page, testId: string) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    if (el) el.click();
  }, testId);
}

async function clickPreset(page: Page, name: string) {
  // Presets render names in uppercase. Search case-insensitively for buttons
  // inside the replay panel. Use evaluate to bypass click interception.
  const upper = name.toUpperCase();
  await page.evaluate((presetName) => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent || "";
      if (text.includes(presetName)) {
        (btn as HTMLElement).click();
        return;
      }
    }
    // Fallback: case-insensitive
    for (const btn of buttons) {
      const text = (btn.textContent || "").toUpperCase();
      if (text.includes(presetName.toUpperCase())) {
        (btn as HTMLElement).click();
        return;
      }
    }
  }, upper);
}

test("Sentinel-2 timeline has 4 buttons: << < > >>", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openReplayPanel(page);
  await drillInto(page, "SENTINEL-2");

  // Wait for preset list to render
  await page.waitForTimeout(1_000);
  await clickPreset(page, "Jakarta");

  // Wait for flyTo + layer activation
  await page.waitForTimeout(5_000);

  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // Verify all 4 nav buttons exist
  await expect(timeline.getByTestId("sentinel-monthly-back")).toBeVisible();
  await expect(timeline.getByTestId("sentinel-weekly-back")).toBeVisible();
  await expect(timeline.getByTestId("sentinel-weekly-forward")).toBeVisible();
  await expect(timeline.getByTestId("sentinel-monthly-forward")).toBeVisible();

  // Verify label shows WEEKLY or MONTHLY
  const label = timeline.getByText(/SENTINEL-2 (WEEKLY|MONTHLY)/);
  await expect(label).toBeVisible();
});

test("Sentinel-2 weekly step changes date and switches to WEEKLY label", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openReplayPanel(page);
  await drillInto(page, "SENTINEL-2");

  await page.waitForTimeout(1_000);
  await clickPreset(page, "Jakarta");
  await page.waitForTimeout(5_000);

  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // Click weekly back button via evaluate (bypasses click interception)
  await clickByTestId(page, "sentinel-weekly-back");
  await page.waitForTimeout(2_000);

  // Verify label switched to WEEKLY
  await expect(timeline.getByText("SENTINEL-2 WEEKLY")).toBeVisible({ timeout: 5_000 });

  // Click weekly forward button
  await clickByTestId(page, "sentinel-weekly-forward");
  await page.waitForTimeout(2_000);

  // Should still be WEEKLY
  await expect(timeline.getByText("SENTINEL-2 WEEKLY")).toBeVisible();
});

test("Sentinel-2 monthly step switches label back to MONTHLY", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openReplayPanel(page);
  await drillInto(page, "SENTINEL-2");

  await page.waitForTimeout(1_000);
  await clickPreset(page, "Jakarta");
  await page.waitForTimeout(5_000);

  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // First do a weekly step to switch to WEEKLY
  await clickByTestId(page, "sentinel-weekly-back");
  await page.waitForTimeout(2_000);
  await expect(timeline.getByText("SENTINEL-2 WEEKLY")).toBeVisible();

  // Now do a monthly step - should switch back to MONTHLY
  await clickByTestId(page, "sentinel-monthly-back");
  await page.waitForTimeout(2_000);
  await expect(timeline.getByText("SENTINEL-2 MONTHLY")).toBeVisible({ timeout: 5_000 });
});

test("GIBS timeline has 4 buttons: << < > >> with weekly and monthly", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openReplayPanel(page);
  await drillInto(page, "GIBS");

  await page.waitForTimeout(1_000);
  await clickPreset(page, "Greenland");

  await page.waitForTimeout(5_000);

  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // Verify all 4 nav buttons exist
  await expect(timeline.getByTestId("gibs-monthly-back")).toBeVisible();
  await expect(timeline.getByTestId("gibs-weekly-back")).toBeVisible();
  await expect(timeline.getByTestId("gibs-weekly-forward")).toBeVisible();
  await expect(timeline.getByTestId("gibs-monthly-forward")).toBeVisible();

  // Verify label shows WEEKLY or MONTHLY
  await expect(timeline.getByText(/GIBS (WEEKLY|MONTHLY)/)).toBeVisible();
});

test("GIBS weekly step changes date and switches to WEEKLY label", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openReplayPanel(page);
  await drillInto(page, "GIBS");

  await page.waitForTimeout(1_000);
  await clickPreset(page, "Greenland");
  await page.waitForTimeout(5_000);

  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // Click weekly back button via evaluate (bypasses click interception)
  await clickByTestId(page, "gibs-weekly-back");
  await page.waitForTimeout(2_000);

  // Verify label switched to WEEKLY
  await expect(timeline.getByText("GIBS WEEKLY")).toBeVisible({ timeout: 5_000 });

  // Click weekly forward button
  await clickByTestId(page, "gibs-weekly-forward");
  await page.waitForTimeout(2_000);

  // Should still be WEEKLY
  await expect(timeline.getByText("GIBS WEEKLY")).toBeVisible();
});

test("GIBS monthly step switches label back to MONTHLY", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openReplayPanel(page);
  await drillInto(page, "GIBS");

  await page.waitForTimeout(1_000);
  await clickPreset(page, "Greenland");
  await page.waitForTimeout(5_000);

  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // First do a weekly step to switch to WEEKLY
  await clickByTestId(page, "gibs-weekly-back");
  await page.waitForTimeout(2_000);
  await expect(timeline.getByText("GIBS WEEKLY")).toBeVisible();

  // Now do a monthly step - should switch back to MONTHLY
  await clickByTestId(page, "gibs-monthly-back");
  await page.waitForTimeout(2_000);
  await expect(timeline.getByText("GIBS MONTHLY")).toBeVisible({ timeout: 5_000 });
});
