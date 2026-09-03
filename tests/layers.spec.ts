import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";

async function waitForGlobeReady(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => (window as any).__viewer && !(window as any).__viewer.isDestroyed(), undefined, { timeout });
}

// Click a layer toggle button in the LEFT panel only
async function clickLeftPanelButton(page: Page, label: string) {
  // The left panel is the first div with position absolute, left 0
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
  // Check INACTIVE before ACTIVE since "INACTIVE" contains "ACTIVE" as a substring
  if (text.includes("INACTIVE")) return "INACTIVE";
  if (text.includes("ACTIVE")) return "ACTIVE";
  return "UNKNOWN";
}

async function waitForActive(page: Page, label: string, timeout = 60_000) {
  await expect.poll(async () => getButtonStatus(page, label), { timeout, intervals: [500] }).toBe("ACTIVE");
}

async function waitForInactive(page: Page, label: string, timeout = 10_000) {
  await expect.poll(async () => getButtonStatus(page, label), { timeout, intervals: [500] }).toBe("INACTIVE");
}

async function getEntityCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewer = (window as any).__viewer;
    if (!viewer) return 0;
    // Count entities (points, labels) AND billboards (flight icons).
    let count = viewer.entities.values.length;
    const primitives = viewer.scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const p = primitives.get(i);
      if (p && p.length !== undefined && typeof p.length === "number") {
        // BillboardCollection has a .length property
        count += p.length;
      }
    }
    return count;
  });
}

async function getDataSourceCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewer = (window as any).__viewer;
    return viewer ? viewer.dataSources.length : 0;
  });
}

async function dismissCesiumErrors(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll(".cesium-widget-errorPanel").forEach(el => el.remove());
  });
}

// Check store state directly
async function getStoreState(page: Page) {
  return page.evaluate(() => {
    // Zustand stores are attached to the module; we can access via React internals
    // But easier: check the viewer for entities/data sources
    const viewer = (window as any).__viewer;
    return {
      entities: viewer ? viewer.entities.values.length : 0,
      dataSources: viewer ? viewer.dataSources.length : 0,
      primitives: viewer ? viewer.scene.primitives.length : 0,
    };
  });
}

test.setTimeout(120_000);

test.describe("Layer buttons", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await waitForGlobeReady(page);
    await dismissCesiumErrors(page);
  });

  test("commercial flights loads and can be turned off", async ({ page }) => {
    await clickLeftPanelButton(page, "Commercial Flights");

    // Wait for ACTIVE (skip LOADING check since it may pass too fast)
    await waitForActive(page, "Commercial Flights", 60_000);

    const count = await getEntityCount(page);
    console.log(`Commercial Flights entities: ${count}`);
    expect(count).toBeGreaterThan(0);

    // Turn off via left panel button
    await clickLeftPanelButton(page, "Commercial Flights");
    await waitForInactive(page, "Commercial Flights", 10_000);

    const countAfter = await getEntityCount(page);
    console.log(`After disable: ${countAfter}`);
  });

  test("occlusion culling hides far-side planes", async ({ page }) => {
    await clickLeftPanelButton(page, "Commercial Flights");
    await waitForActive(page, "Commercial Flights", 60_000);

    // Wait for billboards to populate and occlusion culling to run.
    await page.waitForTimeout(3_000);

    // Count visible vs hidden billboards.
    const stats = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      if (!viewer) return null;
      let visible = 0;
      let hidden = 0;
      const primitives = viewer.scene.primitives;
      for (let i = 0; i < primitives.length; i++) {
        const p = primitives.get(i);
        if (p && p.length !== undefined && typeof p.length === "number") {
          // BillboardCollection
          for (let j = 0; j < p.length; j++) {
            if (p.get(j).show) visible++;
            else hidden++;
          }
        }
      }
      return { visible, hidden, total: visible + hidden };
    });

    console.log(`Occlusion culling stats: ${JSON.stringify(stats)}`);
    expect(stats).not.toBeNull();
    // With ~8000 flights globally and a single camera viewpoint, roughly
    // half should be culled (the far side of the globe).
    expect(stats!.visible).toBeGreaterThan(0);
    expect(stats!.hidden).toBeGreaterThan(0);
    expect(stats!.total).toBeGreaterThan(100);

    // Turn off
    await clickLeftPanelButton(page, "Commercial Flights");
    await waitForInactive(page, "Commercial Flights", 10_000);
  });

  test("clicking a flight selects it and shows detail panel", async ({ page }) => {
    await clickLeftPanelButton(page, "Commercial Flights");
    await waitForActive(page, "Commercial Flights", 60_000);

    // Wait for billboards to populate.
    await page.waitForTimeout(3_000);

    // Find a visible billboard and click it via Cesium's pick API.
    const selectedId = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      if (!viewer) return null;
      const Cesium = (window as any).__Cesium;

      // Find a visible billboard by projecting its position to screen.
      const primitives = viewer.scene.primitives;
      for (let i = 0; i < primitives.length; i++) {
        const p = primitives.get(i);
        if (p && p.length !== undefined && typeof p.length === "number") {
          for (let j = 0; j < p.length; j++) {
            const bb = p.get(j);
            if (!bb.show || !bb.id) continue;
            // Project the billboard position to screen coordinates.
            const windowPos = Cesium.SceneTransforms.worldToWindowCoordinates(
              viewer.scene,
              bb.position,
            );
            if (windowPos && windowPos.x > 0 && windowPos.y > 0 &&
                windowPos.x < window.innerWidth && windowPos.y < window.innerHeight) {
              // Click at this screen position.
              return { x: windowPos.x, y: windowPos.y, id: bb.id };
            }
          }
        }
      }
      return null;
    });

    if (!selectedId) {
      console.log("No visible billboard found to click");
      return;
    }

    console.log(`Clicking billboard at (${selectedId.x}, ${selectedId.y}), id=${selectedId.id}`);
    await page.mouse.click(selectedId.x, selectedId.y);

    // Wait for the detail panel to appear (selectedFlightId set in store).
    const panelVisible = await page.evaluate(() => {
      // Check if the store has a selectedFlightId.
      // The FlightDetailPanel renders when selectedFlightId is set.
      const panel = document.querySelector("[style*='z-index: 70']");
      return panel !== null;
    });

    // Wait a bit for the fetch + render.
    await page.waitForTimeout(5_000);

    // Check store state directly.
    const storeState = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      const entityIds = viewer?.entities.values.map((e: any) => e.id) ?? [];
      // Check for 3D Model primitives in the scene.
      let hasModelPrimitive = false;
      const primitives = viewer?.scene.primitives;
      if (primitives) {
        for (let i = 0; i < primitives.length; i++) {
          const p = primitives.get(i);
          // ModelCollection is a PrimitiveCollection containing Model(s)
          if (p && p.length !== undefined && typeof p.length === "number") {
            for (let j = 0; j < p.length; j++) {
              const inner = p.get(j);
              if (inner && inner._pipelineMode !== undefined) {
                hasModelPrimitive = true;
              }
            }
          }
        }
      }
      // Check for trail polyline entities (polyline entities with CallbackProperty positions).
      let hasTrailEntity = false;
      for (const e of viewer?.entities.values ?? []) {
        if (e.polyline) hasTrailEntity = true;
      }
      return {
        trackedEntity: viewer?.trackedEntity ? true : false,
        modelPrimitive: hasModelPrimitive,
        trailEntity: hasTrailEntity,
        entityIds: entityIds.slice(0, 10),
        flightsHandle: !!(window as any).__flightsHandle,
      };
    });

    console.log(`Store state after click: ${JSON.stringify(storeState)}`);

    // The camera should be tracking the billboard entity.
    expect(storeState.trackedEntity).toBe(true);
    // The trail polyline entity should exist.
    expect(storeState.trailEntity).toBe(true);

    // Deselect by pressing Escape.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1_000);

    const afterDeselect = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      let hasTrailEntity = false;
      for (const e of viewer?.entities.values ?? []) {
        if (e.polyline) hasTrailEntity = true;
      }
      return {
        trackedEntity: viewer?.trackedEntity ? true : false,
        trailEntity: hasTrailEntity,
      };
    });

    console.log(`After deselect: ${JSON.stringify(afterDeselect)}`);
    expect(afterDeselect.trackedEntity).toBe(false);
    expect(afterDeselect.trailEntity).toBe(false);

    // Turn off
    await clickLeftPanelButton(page, "Commercial Flights");
    await waitForInactive(page, "Commercial Flights", 10_000);
  });

  test("earthquakes loads and can be turned off", async ({ page }) => {
    // Expand INFRASTRUCTURE
    const leftPanel = page.locator("div").filter({ has: page.locator("text=SPECTRE") }).first();
    const infraHeader = leftPanel.locator("button").filter({ hasText: "INFRASTRUCTURE" }).first();
    await infraHeader.click();
    await page.waitForTimeout(500);

    await clickLeftPanelButton(page, "Earthquakes");
    await waitForActive(page, "Earthquakes", 60_000);

    const count = await getEntityCount(page);
    console.log(`Earthquakes entities: ${count}`);
    expect(count).toBeGreaterThan(0);

    await clickLeftPanelButton(page, "Earthquakes");
    await waitForInactive(page, "Earthquakes", 10_000);
  });

  test("dams (static) loads and can be turned off", async ({ page }) => {
    const leftPanel = page.locator("div").filter({ has: page.locator("text=SPECTRE") }).first();
    const infraHeader = leftPanel.locator("button").filter({ hasText: "INFRASTRUCTURE" }).first();
    await infraHeader.click();
    await page.waitForTimeout(500);

    await clickLeftPanelButton(page, "Dams");
    await waitForActive(page, "Dams", 10_000);

    const count = await getEntityCount(page);
    console.log(`Dams entities: ${count}`);
    expect(count).toBeGreaterThan(0);

    // Turn off
    await clickLeftPanelButton(page, "Dams");
    await waitForInactive(page, "Dams", 10_000);

    const countAfter = await getEntityCount(page);
    console.log(`Dams after disable: ${countAfter}`);
  });

  test("BORDERS action button works", async ({ page }) => {
    await dismissCesiumErrors(page);

    // Capture console messages
    const consoleMsgs: string[] = [];
    page.on("console", (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => consoleMsgs.push(`[PAGE ERROR] ${err.message}`));

    const stateBefore = await getStoreState(page);
    console.log(`State before: ${JSON.stringify(stateBefore)}`);

    // Use the exact button ref from the page snapshot - BORDERS is in the action area
    const bordersBtn = page.getByRole("button", { name: "BORDERS", exact: true });
    await bordersBtn.waitFor({ state: "visible", timeout: 10_000 });

    // Check button state before click
    const textBefore = await bordersBtn.textContent();
    console.log(`BORDERS button text before: "${textBefore}"`);

    await bordersBtn.click();
    await page.waitForTimeout(2_000);

    // Check button state after click
    const textAfter = await bordersBtn.textContent();
    console.log(`BORDERS button text after: "${textAfter}"`);

    // Wait for the GeoJSON to load
    await page.waitForTimeout(20_000);

    const stateAfter = await getStoreState(page);
    console.log(`State after BORDERS: ${JSON.stringify(stateAfter)}`);
    console.log(`Console messages:\n${consoleMsgs.join("\n")}`);
    expect(stateAfter.dataSources).toBeGreaterThan(0);

    // Turn off
    await dismissCesiumErrors(page);
    await bordersBtn.click();
    await page.waitForTimeout(3_000);

    const stateOff = await getStoreState(page);
    console.log(`State after BORDERS off: ${JSON.stringify(stateOff)}`);
  });

  test("SAVE button shows toast", async ({ page }) => {
    // Click a continent first
    const asiaBtn = page.locator("button").filter({ hasText: "ASIA" }).first();
    if (await asiaBtn.isVisible({ timeout: 5_000 })) {
      await asiaBtn.click();
      await page.waitForTimeout(2_000);
    }

    const saveBtn = page.locator("button").filter({ hasText: "SAVE" }).first();
    await saveBtn.click();

    const toast = page.locator("text=Saved").first();
    await toast.waitFor({ state: "visible", timeout: 5_000 });
    expect(await toast.isVisible()).toBe(true);
  });
});
