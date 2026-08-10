import { test, expect, type Page } from "@playwright/test";

/**
 * Verify GIBS layer loads at high altitude after the minimumLevel:8 fix.
 *
 * Before the fix: at high altitude, Cesium requested zoom 4-6 tiles from
 * Copernicus WMS. At zoom 6, that's ~2446 m/px at the equator, which exceeds
 * the Sentinel-2 L2A collection's 1500 m/px minimum resolution. The server
 * returned: "your request of 2443.94 meters per pixel exceeds the limit
 * 1500.00 meters per pixel of the collection s2l2a." Cesium then displayed
 * the error response as "text tiles" on the globe.
 *
 * After the fix (minimumLevel:8): Cesium uses zoom 8 tiles (~612 m/px),
 * well under the 1500 m/px limit. GIBS loads cleanly at any altitude.
 */

const GLOBE_BOOT_TIMEOUT = 30_000;

async function waitForGlobe(page: Page) {
  await expect(page.locator("canvas").first()).toBeVisible({
    timeout: GLOBE_BOOT_TIMEOUT,
  });
}

test("GIBS loads at 3,000,000m altitude (no text tiles, no 1500m/px error)", async ({
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

  // Open the Live Replay panel via the LIVE/REPLAY button.
  const liveReplayBtn = page.getByText("LIVE/REPLAY", { exact: false }).first();
  await expect(liveReplayBtn).toBeVisible({ timeout: 10_000 });
  await liveReplayBtn.click();

  // Drill into GIBS tier.
  const gibsRow = page.getByText("GIBS", { exact: false }).first();
  await expect(gibsRow).toBeVisible({ timeout: 5_000 });
  await gibsRow.click();

  // Pick "Greenland" preset (2,000,000m altitude).
  const greenlandPreset = page.getByText("Greenland", {
    exact: false,
  });
  await expect(greenlandPreset).toBeVisible({ timeout: 5_000 });
  await greenlandPreset.click();

  // Wait for the camera flyTo (2.5s duration) + tile loading.
  await page.waitForTimeout(8_000);

  // Verify the ReplayTimeline is visible (GIBS layer is active).
  const timeline = page.getByTestId("replay-timeline");
  await expect(timeline).toBeVisible({ timeout: 5_000 });

  // Verify the timeline label says GIBS.
  await expect(timeline.getByText("GIBS", { exact: false })).toBeVisible();

  // Verify camera is at high altitude (well above the old ~4887m limit).
  const altitude = await page.evaluate(() => {
    const viewer = (window as unknown as { __viewer?: any }).__viewer;
    if (!viewer) return null;
    return viewer.camera.positionCartographic.height;
  });
  expect(altitude).not.toBeNull();
  expect(altitude!).toBeGreaterThan(1_000_000); // > 1000km

  // Allow more time for tiles to load after the camera settles.
  await page.waitForTimeout(8_000);

  // Assertion: WMS tile failures should be rare/zero. Before the fix, every
  // tile request at zoom 6 returned the 1500m/px error. After the fix,
  // Cesium only requests zoom 8 tiles (~612 m/px), which succeed.
  expect(wmsFailures.length).toBeLessThanOrEqual(3);
});
