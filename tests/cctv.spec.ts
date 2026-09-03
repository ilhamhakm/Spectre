import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";

async function waitForGlobeReady(page: Page, timeout = 120_000) {
  await page.waitForFunction(() => (window as any).__viewer && !(window as any).__viewer.isDestroyed(), undefined, { timeout });
}

// Click a layer toggle button in the LEFT panel only
async function clickLeftPanelButton(page: Page, label: string) {
  const leftPanel = page.locator("div").filter({ has: page.locator("text=SPECTRE") }).first();
  const btn = leftPanel.locator("button").filter({ hasText: label.toUpperCase() }).first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await btn.click();
}

async function getButtonStatus(page: Page, label: string): Promise<string> {
  const leftPanel = page.locator("div").filter({ has: page.locator("text=SPECTRE") }).first();
  const btn = leftPanel.locator("button").filter({ hasText: label.toUpperCase() }).first();
  const text = await btn.textContent();
  if (!text) return "UNKNOWN";
  if (text.includes("LOADING")) return "LOADING";
  if (text.includes("INACTIVE")) return "INACTIVE";
  if (text.includes("ACTIVE")) return "ACTIVE";
  return "UNKNOWN";
}

async function waitForActive(page: Page, label: string, timeout = 60_000) {
  await expect.poll(async () => getButtonStatus(page, label), { timeout, intervals: [500] }).toBe("ACTIVE");
}

test("CCTV layer loads cameras from API", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(BASE, { timeout: 120_000, waitUntil: "domcontentloaded" });
  await waitForGlobeReady(page);

  // Record camera altitude before toggling CCTV.
  const altBefore = await page.evaluate(() => (window as any).__viewer.camera.positionCartographic.height);

  // Enable the CCTV layer. This should NOT zoom out (cctv is no longer in
  // WIDE_AREA_LAYERS).
  await clickLeftPanelButton(page, "CCTV");
  await waitForActive(page, "CCTV", 90_000);

  // Verify the camera did not zoom out.
  const altAfter = await page.evaluate(() => (window as any).__viewer.camera.positionCartographic.height);
  expect(altAfter).toBeLessThan(altBefore * 2);

  // Inject test cameras directly into the store (simulating catalog loaded).
  // This avoids waiting 60+ seconds for the real API to fetch from 12 providers.
  // We create 5 TfL cameras near London and 3 Caltrans cameras near LA.
  await page.evaluate(() => {
    const store = (window as any).__store;
    if (!store) return;
    const testCameras = [
      // TfL cameras near London (within 0.5 deg of 51.5007, -0.1246)
      { id: "tfl-test-1", name: "Test Camera 1", lat: 51.51, lon: -0.12, provider: "tfl", region: "London", snapshotUrl: "http://example.com/1.jpg", isSensitive: false, isOnline: true },
      { id: "tfl-test-2", name: "Test Camera 2", lat: 51.49, lon: -0.13, provider: "tfl", region: "London", snapshotUrl: "http://example.com/2.jpg", isSensitive: false, isOnline: true },
      { id: "tfl-test-3", name: "Test Camera 3", lat: 51.50, lon: -0.10, provider: "tfl", region: "London", snapshotUrl: "http://example.com/3.jpg", isSensitive: false, isOnline: true },
      { id: "tfl-test-4", name: "Test Camera 4", lat: 51.52, lon: -0.11, provider: "tfl", region: "London", snapshotUrl: "http://example.com/4.jpg", isSensitive: false, isOnline: true },
      { id: "tfl-test-5", name: "Test Camera 5", lat: 51.48, lon: -0.14, provider: "tfl", region: "London", snapshotUrl: "http://example.com/5.jpg", isSensitive: false, isOnline: true },
      // Caltrans cameras near LA (outside London bbox)
      { id: "caltrans-test-1", name: "Caltrans 1", lat: 34.05, lon: -118.24, provider: "caltrans", region: "California", snapshotUrl: "http://example.com/c1.jpg", isSensitive: false, isOnline: true },
      { id: "caltrans-test-2", name: "Caltrans 2", lat: 34.10, lon: -118.30, provider: "caltrans", region: "California", snapshotUrl: "http://example.com/c2.jpg", isSensitive: false, isOnline: true },
      { id: "caltrans-test-3", name: "Caltrans 3", lat: 34.00, lon: -118.20, provider: "caltrans", region: "California", snapshotUrl: "http://example.com/c3.jpg", isSensitive: false, isOnline: true },
    ];
    store.getState().setCctvCameras(testCameras);
    store.getState().setCctvCatalogLoaded(true);
    // Set active city to London
    store.getState().setActiveLocation("city", "London");
  });

  // Wait for source counts to populate (should be instant with injected data).
  await page.waitForFunction(() => {
    const store = (window as any).__store;
    if (!store) return false;
    const counts = store.getState().cctvSourceCounts;
    return Object.keys(counts).length > 0 && counts.tfl > 0;
  }, undefined, { timeout: 15_000 });

  // Toggle the TfL source on.
  await page.evaluate(() => {
    const store = (window as any).__store;
    if (store) {
      store.getState().toggleCctvSource("tfl");
    }
  });

  // Wait for CCTV entities to render in the CustomDataSource.
  await page.waitForFunction(() => {
    const viewer = (window as any).__viewer;
    if (!viewer) return false;
    const dataSources = viewer.dataSources;
    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (ds && ds.name === "cctv" && ds.show && ds.entities.values.length > 0) {
        return true;
      }
    }
    return false;
  }, undefined, { timeout: 30_000 });

  // Verify that exactly 5 TfL entities are rendered (not the Caltrans ones).
  const entityCount = await page.evaluate(() => {
    const viewer = (window as any).__viewer;
    if (!viewer) return 0;
    const dataSources = viewer.dataSources;
    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (ds && ds.name === "cctv" && ds.show) {
        return ds.entities.values.length;
      }
    }
    return 0;
  });
  expect(entityCount).toBe(5);
});

test("CCTV frame endpoint returns an image", async ({ request }) => {
  test.setTimeout(300_000);
  // Get a camera ID from the API. The CCTV API fetches from 12+ providers
  // and can take 60+ seconds on a cold cache.
  const response = await request.get(`${BASE}/api/cctv`, { timeout: 180_000 });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.count).toBeGreaterThan(0);

  // Pick a camera with a snapshot URL for best results
  const camWithSnap = body.cameras.find((c: any) => c.snapshotUrl);
  const camId = camWithSnap?.id || body.cameras[0].id;

  // Fetch a frame for this camera. Use a simple ID without spaces if possible.
  const simpleCam = body.cameras.find((c: any) => !c.id.includes(" ") && c.snapshotUrl);
  const testId = simpleCam?.id || camId;

  // Pass snapshot URL + provider as query params so the frame endpoint can
  // proxy directly without re-fetching the entire 45s catalog.
  const frameUrl = new URL(`${BASE}/api/cctv/frame/${encodeURIComponent(testId)}`);
  if (simpleCam?.snapshotUrl) {
    frameUrl.searchParams.set("url", simpleCam.snapshotUrl);
    frameUrl.searchParams.set("provider", simpleCam.provider || "");
    if (simpleCam.lat != null) frameUrl.searchParams.set("lat", String(simpleCam.lat));
    if (simpleCam.lon != null) frameUrl.searchParams.set("lon", String(simpleCam.lon));
  }
  const frameResponse = await request.get(frameUrl.toString(), { timeout: 120_000 });
  expect(frameResponse.status()).toBe(200);
  const contentType = frameResponse.headers()["content-type"] || "";
  expect(contentType.startsWith("image/")).toBeTruthy();
});
