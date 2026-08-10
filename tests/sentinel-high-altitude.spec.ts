import { test, expect, type Page } from "@playwright/test";

/**
 * Verify Sentinel-2 layer loads at high altitude after the minimumLevel:8 fix.
 *
 * Before the fix: at camera altitude > ~4887m, Cesium requested tiles at
 * zoom 0-7 (each covering a huge bbox). Copernicus WMS couldn't composite
 * a monthly cloud-free Sentinel-2 mosaic over such a large area and
 * returned error tiles (visible as "text tiles" on the globe).
 *
 * After the fix (minimumLevel:8): Cesium uses zoom 8 tiles (~280km each)
 * and downsamples for display at any altitude. Sentinel-2 loads cleanly
 * from 5km to 20,000km.
 */

const GLOBE_BOOT_TIMEOUT = 30_000;

async function waitForGlobe(page: Page) {
  await expect(page.locator("canvas").first()).toBeVisible({
    timeout: GLOBE_BOOT_TIMEOUT,
  });
}

test("Sentinel-2 loads at 2,000,000m altitude (no text tiles)", async ({
  page,
}) => {
  // Collect WMS tile failures during the test.
  const wmsFailures: string[] = [];
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("sh.dataspace.copernicus.eu/ogc/wms")) {
      if (res.status() >= 400) {
        wmsFailures.push(`${res.status()} ${url.slice(0, 120)}`);
      }
    }
  });

  await page.goto("/");
  await waitForGlobe(page);

  // Open the Live Replay panel via the LIVE/REPLAY button in TacticalHUD.
  // The button label is "LIVE/REPLAY" and lives in the bottom-right HUD.
  const liveReplayBtn = page.getByText("LIVE/REPLAY", { exact: false }).first();
  await expect(liveReplayBtn).toBeVisible({ timeout: 10_000 });
  await liveReplayBtn.click();

  // Drill into Sentinel-2 tier.
  const sentinelRow = page.getByText("SENTINEL-2", { exact: false }).first();
  await expect(sentinelRow).toBeVisible({ timeout: 5_000 });
  await sentinelRow.click();

  // Pick the "Greenland Ice Sheet" preset (2,000,000m altitude).
  const greenlandPreset = page.getByText("Greenland Ice Sheet", {
    exact: false,
  });
  await expect(greenlandPreset).toBeVisible({ timeout: 5_000 });
  await greenlandPreset.click();

  // Wait for the camera flyTo (2.5s duration) + tile loading.
  await page.waitForTimeout(8_000);

  // Verify the ReplayTimeline is visible (Sentinel layer is active).
  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // Verify the timeline label says SENTINEL-2.
  await expect(timeline.getByText("SENTINEL-2", { exact: false })).toBeVisible();

  // Verify camera is at high altitude (above the previous 4887m limit).
  // Read camera position via the __viewer window hook.
  const altitude = await page.evaluate(() => {
    const viewer = (window as unknown as { __viewer?: any }).__viewer;
    if (!viewer) return null;
    return viewer.camera.positionCartographic.height;
  });
  expect(altitude).not.toBeNull();
  expect(altitude!).toBeGreaterThan(1_000_000); // > 1000km (above old 4887m limit)

  // Allow more time for tiles to load after the camera settles.
  await page.waitForTimeout(8_000);

  // Assertion: WMS tile failures should be rare/zero. Allow up to 3 failures
  // for transient network issues, but not the dozens we'd see if every
  // high-altitude tile was returning an error.
  expect(wmsFailures.length).toBeLessThanOrEqual(3);

  // Step forward a month and verify tiles still load.
  const forwardBtn = timeline.locator('button[title="Next month"]');
  await forwardBtn.click();
  await page.waitForTimeout(6_000);

  // After stepping, the timeline should still be visible (layer didn't crash).
  await expect(timeline).toBeVisible();
});
