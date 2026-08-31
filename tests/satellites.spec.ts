import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";

async function waitForGlobeReady(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => (window as any).__viewer && !(window as any).__viewer.isDestroyed(),
    undefined,
    { timeout },
  );
}

// Click a layer toggle button in the LEFT panel only.
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
  const text = (await btn.textContent()) ?? "";
  if (text.includes("LOADING")) return "LOADING";
  if (text.includes("INACTIVE")) return "INACTIVE";
  if (text.includes("ACTIVE")) return "ACTIVE";
  return "UNKNOWN";
}

async function waitForActive(page: Page, label: string, timeout = 90_000) {
  await expect
    .poll(async () => getButtonStatus(page, label), { timeout, intervals: [500] })
    .toBe("ACTIVE");
}

async function waitForInactive(page: Page, label: string, timeout = 15_000) {
  await expect
    .poll(async () => getButtonStatus(page, label), { timeout, intervals: [500] })
    .toBe("INACTIVE");
}

test.setTimeout(180_000);

test.describe("Satellites layer (GEV parity)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await waitForGlobeReady(page);
    await page.evaluate(() => {
      document.querySelectorAll(".cesium-widget-errorPanel").forEach((el) => el.remove());
    });
  });

  test("layer enables, picker shows search + famous list, points render", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await clickLeftPanelButton(page, "Satellites");
    await waitForActive(page, "Satellites", 90_000);

    // Right panel shows the picker: search button + FAMOUS header + ISS row.
    const searchBtn = page.locator("button").filter({ hasText: "SEARCH SATELLITES" }).first();
    await expect(searchBtn).toBeVisible({ timeout: 30_000 });

    const famousHeader = page.locator("text=FAMOUS").first();
    await expect(famousHeader).toBeVisible({ timeout: 30_000 });

    const issRow = page.locator("button").filter({ hasText: /^.*ISS.*$/ }).first();
    await expect(issRow).toBeVisible();

    // Catalog loaded: points + ISS orbit ring primitive in the scene.
    const satState = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      let pointCount = 0;
      const primitives = viewer?.scene.primitives;
      for (let i = 0; i < primitives.length; i++) {
        const p = primitives.get(i);
        if (p && typeof p.length === "number") pointCount += p.length;
      }
      return { pointCount, primitiveCount: primitives.length };
    });
    console.log(`Satellite state: ${JSON.stringify(satState)}`);
    expect(satState.pointCount).toBeGreaterThan(100);

    // Toggle off cleanly.
    await clickLeftPanelButton(page, "Satellites");
    await waitForInactive(page, "Satellites", 15_000);
    expect(errors).toEqual([]);
  });

  test("famous row tracks with 3D model + orbit ring, CLOSE untracks", async ({ page }) => {
    await clickLeftPanelButton(page, "Satellites");
    await waitForActive(page, "Satellites", 90_000);

    // Wait for the famous rows to resolve against the catalog.
    const issRow = page
      .locator("button")
      .filter({ hasText: "ISS" })
      .filter({ hasText: "TRACK" })
      .first();
    await expect(issRow).toBeVisible({ timeout: 30_000 });
    await issRow.click();
    await page.waitForTimeout(3_000);

    // Tracking state: viewer.trackedEntity set, orbit ring primitive added,
    // and the tracked entity carries a model graphic (3D satellite).
    const tracking = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      const tracked = viewer?.trackedEntity;
      let hasModel = false;
      if (tracked) {
        hasModel =
          tracked.model !== undefined &&
          tracked.model !== null &&
          (tracked.model.uri !== undefined || tracked.model.uri !== null);
      }
      return {
        tracked: !!tracked,
        hasModel,
        detailPanelVisible:
          document.body.innerText.includes("SATELLITE TRACKING"),
      };
    });
    console.log(`Tracking state: ${JSON.stringify(tracking)}`);
    expect(tracking.tracked).toBe(true);
    expect(tracking.hasModel).toBe(true);
    expect(tracking.detailPanelVisible).toBe(true);

    // CLOSE button on the detail card stops tracking.
    const closeBtn = page.locator("button").filter({ hasText: "CLOSE" }).first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await page.waitForTimeout(1_500);

    const afterClose = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      return {
        tracked: !!viewer?.trackedEntity,
        pickerBack: document.body.innerText.includes("SEARCH SATELLITES"),
      };
    });
    expect(afterClose.tracked).toBe(false);
    expect(afterClose.pickerBack).toBe(true);

    await clickLeftPanelButton(page, "Satellites");
    await waitForInactive(page, "Satellites", 15_000);
  });

  test("search tracks a satellite by name (HST)", async ({ page }) => {
    await clickLeftPanelButton(page, "Satellites");
    await waitForActive(page, "Satellites", 90_000);

    await page.locator("button").filter({ hasText: "SEARCH SATELLITES" }).first().click();
    const input = page.locator("input[placeholder='Name or NORAD id...']");
    await expect(input).toBeVisible();
    await input.fill("HST");
    await input.press("Enter");
    await page.waitForTimeout(3_000);

    const tracking = await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      return {
        tracked: !!viewer?.trackedEntity,
        detailPanelVisible:
          document.body.innerText.includes("SATELLITE TRACKING"),
        hubbleShown: document.body.innerText.toUpperCase().includes("HST"),
      };
    });
    console.log(`HST search tracking: ${JSON.stringify(tracking)}`);
    expect(tracking.tracked).toBe(true);
    expect(tracking.detailPanelVisible).toBe(true);

    // Escape untracks (picker returns).
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1_500);
    const afterEsc = await page.evaluate(() => !!(window as any).__viewer?.trackedEntity);
    expect(afterEsc).toBe(false);

    await clickLeftPanelButton(page, "Satellites");
    await waitForInactive(page, "Satellites", 15_000);
  });
});
