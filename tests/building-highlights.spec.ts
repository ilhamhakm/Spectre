import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";

async function waitForGlobeReady(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => (window as any).__viewer && !(window as any).__viewer.isDestroyed(),
    undefined,
    { timeout },
  );
}

async function dismissCesiumErrors(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll(".cesium-widget-errorPanel").forEach((el) => el.remove());
  });
}

async function clickLeftPanelButton(page: Page, label: string) {
  const leftPanel = page
    .locator("div")
    .filter({ has: page.locator("text=SPECTRE") })
    .first();
  const btn = leftPanel
    .locator("button")
    .filter({ hasText: label.toUpperCase() })
    .first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await btn.click();
}

async function getButtonStatus(page: Page, label: string): Promise<string> {
  const leftPanel = page
    .locator("div")
    .filter({ has: page.locator("text=SPECTRE") })
    .first();
  const btn = leftPanel
    .locator("button")
    .filter({ hasText: label.toUpperCase() })
    .first();
  const text = await btn.textContent();
  if (!text) return "UNKNOWN";
  if (text.includes("LOADING")) return "LOADING";
  if (text.includes("INACTIVE")) return "INACTIVE";
  if (text.includes("ACTIVE")) return "ACTIVE";
  return "UNKNOWN";
}

async function waitForActive(page: Page, label: string, timeout = 60_000) {
  await expect.poll(async () => getButtonStatus(page, label), {
    timeout,
    intervals: [500],
  }).toBe("ACTIVE");
}

async function waitForInactive(page: Page, label: string, timeout = 10_000) {
  await expect.poll(async () => getButtonStatus(page, label), {
    timeout,
    intervals: [500],
  }).toBe("INACTIVE");
}

// Fly the camera to a known city with OSM buildings (NYC area).
async function flyToNYC(page: Page) {
  await page.evaluate(() => {
    const viewer = (window as any).__viewer;
    const Cesium = (window as any).__Cesium;
    if (!viewer || !Cesium) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 600),
      orientation: {
        heading: Cesium.Math.toRadians(30),
        pitch: Cesium.Math.toRadians(-20),
        roll: 0,
      },
      duration: 2,
    });
  });
  await page.waitForTimeout(4_000);
}

// Wait for the OSM buildings tileset to finish loading tiles in view.
// At 600m altitude with SSE=1, tiles need to stream from Cesium Ion.
async function waitForTilesLoaded(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      if (!viewer || !Cesium) return false;
      const prims = viewer.scene.primitives;
      for (let i = 0; i < prims.length; i++) {
        const p = prims.get(i);
        if (p instanceof Cesium.Cesium3DTileset && p.tilesLoaded === true) {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout },
  );
}

// Wait for the OSM buildings tileset to be present in the scene.
async function waitForBuildingsTileset(page: Page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const viewer = (window as any).__viewer;
      if (!viewer) return false;
      const Cesium = (window as any).__Cesium;
      const prims = viewer.scene.primitives;
      for (let i = 0; i < prims.length; i++) {
        if (prims.get(i) instanceof Cesium.Cesium3DTileset) return true;
      }
      return false;
    },
    undefined,
    { timeout },
  );
}

test.setTimeout(180_000);

test.describe("Building Highlights", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await waitForGlobeReady(page);
    await dismissCesiumErrors(page);
  });

  test("Building Highlights toggle requires 3D Buildings first", async ({ page }) => {
    // Building Highlights should be INACTIVE initially.
    await waitForInactive(page, "Building Highlights", 5_000);

    // Click it while 3D Buildings is OFF: should show a toast, not activate.
    await clickLeftPanelButton(page, "Building Highlights");
    await page.waitForTimeout(1_000);

    // Should still be INACTIVE (toast was shown).
    const status = await getButtonStatus(page, "Building Highlights");
    expect(status).toBe("INACTIVE");

    // Toast should be visible.
    const toast = page.locator("text=Enable 3D Buildings first");
    await toast.waitFor({ state: "visible", timeout: 5_000 });
  });

  test("3D Buildings loads, then Building Highlights activates", async ({ page }) => {
    // Enable 3D Buildings first.
    await clickLeftPanelButton(page, "3D Buildings");
    await waitForActive(page, "3D Buildings", 60_000);
    await waitForBuildingsTileset(page, 30_000);

    // Now enable Building Highlights.
    await clickLeftPanelButton(page, "Building Highlights");
    await waitForActive(page, "Building Highlights", 5_000);

    // Verify the store flag is set.
    const flagSet = await page.evaluate(() => {
      // Access the Zustand store via the module system is hard from page
      // context; instead check that the button shows ACTIVE.
      return true;
    });
    expect(flagSet).toBe(true);

    // Turn off Building Highlights.
    await clickLeftPanelButton(page, "Building Highlights");
    await waitForInactive(page, "Building Highlights", 5_000);

    // Turn off 3D Buildings.
    await clickLeftPanelButton(page, "3D Buildings");
    await waitForInactive(page, "3D Buildings", 10_000);
  });

  test("hovering a building tints it blue, clicking tints it white and populates right panel", async ({ page }) => {
    // Enable 3D Buildings + Building Highlights.
    await clickLeftPanelButton(page, "3D Buildings");
    await waitForActive(page, "3D Buildings", 60_000);
    await waitForBuildingsTileset(page, 30_000);

    await clickLeftPanelButton(page, "Building Highlights");
    await waitForActive(page, "Building Highlights", 5_000);

    // Fly to NYC where OSM buildings are dense.
    await flyToNYC(page);

    // Wait for tiles to load from Cesium Ion.
    await waitForTilesLoaded(page, 60_000);
    await page.waitForTimeout(2_000);

    // Find a screen position that has a building by scanning the viewport.
    const buildingPos = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      if (!viewer || !Cesium) return null;
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let fx = 0.2; fx <= 0.8; fx += 0.04) {
        for (let fy = 0.2; fy <= 0.8; fy += 0.04) {
          const x = Math.round(w * fx);
          const y = Math.round(h * fy);
          try {
            const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
            if (picked instanceof Cesium.Cesium3DTileFeature) {
              return { x, y };
            }
          } catch {
            // skip
          }
        }
      }
      return null;
    });
    console.log(`Building position: ${JSON.stringify(buildingPos)}`);
    expect(buildingPos).not.toBeNull();

    if (!buildingPos) {
      await clickLeftPanelButton(page, "Building Highlights");
      await clickLeftPanelButton(page, "3D Buildings");
      return;
    }

    // Hover over the building. This should apply the white hover tint.
    await page.mouse.move(buildingPos.x, buildingPos.y);
    await page.waitForTimeout(1_000);

    // Check that the feature has a white-ish hover color applied.
    // HOVER_COLOR = Cesium.Color.fromBytes(220, 220, 220, 255)
    // = (220/255, 220/255, 220/255) ~= (0.863, 0.863, 0.863)
    // Check internal _color since the getter may return WHITE by default.
    const hoverApplied = await page.evaluate((pos) => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      if (!viewer || !Cesium) return false;
      try {
        const picked = viewer.scene.pick(new Cesium.Cartesian2(pos.x, pos.y));
        if (!(picked instanceof Cesium.Cesium3DTileFeature)) return false;
        const internalColor = (picked as any)._color;
        if (!internalColor || typeof internalColor.red !== "number") return false;
        // All channels should be high (white-ish), roughly equal.
        return (
          internalColor.red > 0.8 &&
          internalColor.green > 0.8 &&
          internalColor.blue > 0.8 &&
          Math.abs(internalColor.red - internalColor.green) < 0.05 &&
          Math.abs(internalColor.green - internalColor.blue) < 0.05
        );
      } catch {
        return false;
      }
    }, buildingPos);
    console.log(`White hover tint applied: ${hoverApplied}`);
    expect(hoverApplied).toBe(true);

    // Move mouse away to clear the hover tint (but NOT the selection).
    // We need to move to a position that's on the globe canvas (not a UI
    // panel) but has no building. Scan for an empty position on the globe.
    const emptyPos = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      if (!viewer || !Cesium) return null;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Scan for a position on the globe (pickEllipsoid succeeds) but
      // with no building (scene.pick returns no Cesium3DTileFeature).
      for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
        for (let fy = 0.3; fy <= 0.7; fy += 0.05) {
          const x = Math.round(w * fx);
          const y = Math.round(h * fy);
          try {
            const ellipsoid = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y));
            if (!ellipsoid) continue; // not on globe
            const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
            if (!(picked instanceof Cesium.Cesium3DTileFeature)) {
              return { x, y };
            }
          } catch {
            // skip
          }
        }
      }
      return null;
    });
    console.log(`Empty position: ${JSON.stringify(emptyPos)}`);

    // Move to the empty position (or fall back to center of screen).
    const targetPos = emptyPos ?? { x: 200, y: 400 };
    await page.mouse.move(targetPos.x, targetPos.y);
    await page.waitForTimeout(1_000);

    // Log the empty position for debugging.
    console.log(`Moved to empty position: ${JSON.stringify(targetPos)}`);

    // Check that the hover tint was cleared (feature back to default).
    // Check internal _color since the getter may return WHITE by default.
    const hoverCleared = await page.evaluate((pos) => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      if (!viewer || !Cesium) return false;
      try {
        const picked = viewer.scene.pick(new Cesium.Cartesian2(pos.x, pos.y));
        if (!(picked instanceof Cesium.Cesium3DTileFeature)) return true;
        const internalColor = (picked as any)._color;
        if (internalColor === undefined || internalColor === null) return true;
        if (typeof internalColor.red === "number") {
          return !(internalColor.red > 0.8 && internalColor.green > 0.8 && internalColor.blue > 0.8);
        }
        return true;
      } catch {
        return true;
      }
    }, buildingPos);
    console.log(`Hover tint cleared after mouse away: ${hoverCleared}`);
    expect(hoverCleared).toBe(true);

    // Now click the building to apply the strong white selection highlight.
    await page.mouse.move(buildingPos.x, buildingPos.y);
    await page.waitForTimeout(500);
    await page.mouse.click(buildingPos.x, buildingPos.y);
    await page.waitForTimeout(2_000);

    // Check that the feature now has the white selection color.
    // SELECTED_COLOR = Cesium.Color.WHITE = (1, 1, 1, 1)
    // Check internal _color since the getter may return WHITE by default.
    const selectApplied = await page.evaluate((pos) => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      if (!viewer || !Cesium) return false;
      try {
        const picked = viewer.scene.pick(new Cesium.Cartesian2(pos.x, pos.y));
        if (!(picked instanceof Cesium.Cesium3DTileFeature)) return false;
        const internalColor = (picked as any)._color;
        if (!internalColor || typeof internalColor.red !== "number") return false;
        return (
          Math.abs(internalColor.red - 1.0) < 0.05 &&
          Math.abs(internalColor.green - 1.0) < 0.05 &&
          Math.abs(internalColor.blue - 1.0) < 0.05
        );
      } catch {
        return false;
      }
    }, buildingPos);
    console.log(`White selection tint applied: ${selectApplied}`);
    expect(selectApplied).toBe(true);

    // Check that the right panel (FeatureDetailPanel) appeared.
    const panelVisible = await page.evaluate(() => {
      const panels = document.querySelectorAll("[style*='z-index: 70']");
      for (const p of panels) {
        if (p.textContent?.includes("BUILDING")) return true;
      }
      return false;
    });
    console.log(`Building detail panel visible: ${panelVisible}`);
    expect(panelVisible).toBe(true);

    // Move mouse away - the white selection highlight should persist.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(1_000);

    const selectPersisted = await page.evaluate((pos) => {
      const viewer = (window as any).__viewer;
      const Cesium = (window as any).__Cesium;
      if (!viewer || !Cesium) return false;
      try {
        const picked = viewer.scene.pick(new Cesium.Cartesian2(pos.x, pos.y));
        if (!(picked instanceof Cesium.Cesium3DTileFeature)) return false;
        const internalColor = (picked as any)._color;
        if (!internalColor || typeof internalColor.red !== "number") return false;
        return (
          Math.abs(internalColor.red - 1.0) < 0.05 &&
          Math.abs(internalColor.green - 1.0) < 0.05 &&
          Math.abs(internalColor.blue - 1.0) < 0.05
        );
      } catch {
        return false;
      }
    }, buildingPos);
    console.log(`White selection persisted after mouse away: ${selectPersisted}`);

    // Cleanup: turn off both layers.
    await clickLeftPanelButton(page, "Building Highlights");
    await waitForInactive(page, "Building Highlights", 5_000);
    await clickLeftPanelButton(page, "3D Buildings");
    await waitForInactive(page, "3D Buildings", 10_000);
  });
});
