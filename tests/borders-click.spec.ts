import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";

async function waitForGlobeReady(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => (window as any).__viewer && !(window as any).__viewer.isDestroyed(),
    undefined,
    { timeout },
  );
}

// Click a button in the RIGHT panel action grid (where BORDERS lives) by label.
async function clickRightPanelButton(page: Page, label: string) {
  const btn = page.locator("button").filter({ hasText: label.toUpperCase() }).first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await btn.click();
}

// Wait for the borders layer to finish loading: the borders layer adds two
// CustomDataSources ("country-borders" and "state-borders") to the viewer
// once its GeoJSON fetch + loadRegionData() complete. Poll for both.
async function waitForBordersReady(page: Page, timeout = 90_000) {
  // First confirm the toggle actually flipped borders on in the store.
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.bordersEnabled === true,
    undefined,
    { timeout: 15_000 },
  );
  // Then wait for the data sources to be added (fetch + index build done).
  await page.waitForFunction(
    () => {
      const viewer = (window as any).__viewer;
      if (!viewer || viewer.isDestroyed()) return false;
      const names = new Set<string>();
      const ds = viewer.dataSources;
      for (let i = 0; i < ds.length; i++) {
        const s = ds.get(i);
        if (s && s.name) names.add(s.name);
      }
      return names.has("country-borders") && names.has("state-borders");
    },
    undefined,
    { timeout },
  );
}

async function flyTo(page: Page, lon: number, lat: number, height: number) {
  await page.evaluate(
    ([lon, lat, height]) => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        duration: 0,
      });
    },
    [lon, lat, height] as const,
  );
  await page.waitForTimeout(800);
}

async function clickViewportCenter(page: Page) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function countHighlightEntities(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewer = (window as any).__viewer;
    let n = 0;
    for (const e of viewer.entities.values) {
      if (e.polygon || e.polyline) n++;
    }
    return n;
  });
}

test("borders click selects a country, populates the right panel, highlights it, and clears on close / ocean", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(BASE, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await waitForGlobeReady(page);

  // Country-level view over France. France's centroid (~46.6N, 2.4E) is
  // solidly inside the polygon, so a center-screen click resolves to France.
  await flyTo(page, 2.4, 46.6, 6_000_000);

  // Enable the borders layer via the right-panel BORDERS button.
  await clickRightPanelButton(page, "BORDERS");
  await waitForBordersReady(page);

  // Click the globe at the center of the viewport (over France).
  await clickViewportCenter(page);

  // The store should now have a selectedRegion at country level.
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.selectedRegion?.level === "country",
    undefined,
    { timeout: 20_000 },
  );

  const region = await page.evaluate(() => (window as any).__store.getState().selectedRegion);
  expect(region.level).toBe("country");
  expect(typeof region.info.name).toBe("string");
  expect(region.info.name.length).toBeGreaterThan(0);

  // The right rail should have swapped to the region detail card with CLOSE
  // and WIKIPEDIA buttons.
  const closeBtn = page.locator("button").filter({ hasText: "CLOSE" }).first();
  await expect(closeBtn).toBeVisible({ timeout: 10_000 });
  const wikiBtn = page.locator("button").filter({ hasText: "WIKIPEDIA" }).first();
  await expect(wikiBtn).toBeVisible();

  // A white highlight entity should exist on the globe (polygon + outline).
  expect(await countHighlightEntities(page)).toBeGreaterThan(0);

  // CLOSE clears the selection and removes the highlight.
  await closeBtn.click();
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.selectedRegion === null,
    undefined,
    { timeout: 10_000 },
  );
  expect(await countHighlightEntities(page)).toBe(0);

  // Re-seed a selection, then click empty ocean to verify that path also
  // clears it. Fly to the mid-Atlantic (open water, no country hit).
  await flyTo(page, -30, 20, 6_000_000);
  await page.evaluate(() => {
    (window as any).__store.getState().selectRegion(
      { level: "country", info: { name: "France", iso2: "FR" } },
      [[[0, 45], [5, 45], [5, 50], [0, 50], [0, 45]]],
    );
  });
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.selectedRegion !== null,
    undefined,
    { timeout: 10_000 },
  );

  await clickViewportCenter(page);
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.selectedRegion === null,
    undefined,
    { timeout: 20_000 },
  );
  expect(await page.evaluate(() => (window as any).__store.getState().selectedRegion)).toBeNull();
});
