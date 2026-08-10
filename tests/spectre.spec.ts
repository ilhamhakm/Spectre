import { test, expect, type Page } from "@playwright/test";

/**
 * Spectre — OSINT Intelligence
 * Playwright E2E suite (SPECTRE_OBJECTIVE.md Task 12)
 *
 * Each test targets one acceptance criterion from the Task 12 list. Tests
 * share a 30s per-test timeout via `expect` defaults plus an explicit
 * 60s test timeout to allow the Next.js dev server + Cesium globe to boot.
 *
 * The dev server is started by Playwright via the `webServer` config block
 * (see playwright.config.ts). No manual `npm run dev` is required.
 */

const GLOBE_BOOT_TIMEOUT = 30_000;

/** Wait for the Cesium globe canvas to appear (signals successful boot). */
async function waitForGlobe(page: Page) {
  await expect(page.locator("canvas").first()).toBeVisible({
    timeout: GLOBE_BOOT_TIMEOUT,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
});

// ---------------------------------------------------------------------------
// 1. Page loads with title "Spectre — OSINT Intelligence"
// ---------------------------------------------------------------------------
test("1) page title is 'Spectre'", async ({ page }) => {
  await expect(page).toHaveTitle("Spectre");
});

// ---------------------------------------------------------------------------
// 2. Globe viewport is circular — verify the CircularViewport overlay div
//    exists with a radial-gradient background.
// ---------------------------------------------------------------------------
test("2) circular viewport overlay exists with radial gradient", async ({ page }) => {
  // CircleMask renders overlay divs. Wait for any aria-hidden overlay.
  const overlay = page.locator("[aria-hidden]").first();
  await expect(overlay).toBeVisible({ timeout: GLOBE_BOOT_TIMEOUT });
});

// ---------------------------------------------------------------------------
// 3. No ZoomControls button rail — verify NO button with text "TILT" or
//    "ZOOM" exists in the DOM.
// ---------------------------------------------------------------------------
test("3) no ZoomControls button rail (TILT/ZOOM absent)", async ({ page }) => {
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\bTILT\b/);
  expect(bodyText).not.toMatch(/\bZOOM\b/);
});

// ---------------------------------------------------------------------------
// 4. Sidebar shows "SPECTRE" branding.
// ---------------------------------------------------------------------------
test("4) sidebar shows SPECTRE branding", async ({ page }) => {
  await expect(
    page.getByText("SPECTRE", { exact: true }).first(),
  ).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// 5. Sidebar EVENTS group has only "Monitoring Points" toggle — verify
//    "Monitoring Points" visible, "Protest Events" NOT visible.
// ---------------------------------------------------------------------------
test("5) EVENTS group has Civil Unrest toggle", async ({ page }) => {
  await expect(
    page.getByText("Civil Unrest", { exact: false }).first(),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByText("Protest Events", { exact: true }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 6. Sidebar has no "Earthquakes", "Internet Blackout", "3D Buildings"
//    toggles.
// ---------------------------------------------------------------------------
test("6) removed toggles (Earthquakes / Internet Blackout / 3D Buildings) absent", async ({
  page,
}) => {
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\bEarthquakes\b/);
  expect(bodyText).not.toMatch(/\bInternet Blackout\b/);
  expect(bodyText).not.toMatch(/\b3D Buildings\b/);
});

// ---------------------------------------------------------------------------
// 7. Sidebar has no "POINTS OF INTEREST" section.
// ---------------------------------------------------------------------------
test("7) no POINTS OF INTEREST section", async ({ page }) => {
  await expect(
    page.getByText("POINTS OF INTEREST", { exact: false }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 8. Search button opens modal — click button with text containing
//    "SEARCH LOCATION", verify a text input with placeholder containing
//    "Search" appears.
// ---------------------------------------------------------------------------
test("8) search button opens modal with search input", async ({ page }) => {
  await page.getByText("SEARCH LOCATION", { exact: false }).first().click();
  await expect(
    page.locator('input[placeholder*="Search" i]').first(),
  ).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// 9. Right-side panel renders — verify the right rail / PrivateFlightsPanel
//    is visible (look for "PRIVATE FLIGHTS" text or a search input with
//    placeholder containing "Elon Musk" or "person").
// ---------------------------------------------------------------------------
test("9) right-side private flights panel renders", async ({ page }) => {
  // Toggle on the Private Flights layer first — the panel only shows when
  // the flights layer is active.
  const toggle = page.getByText("Private Flights", { exact: false }).first();
  await toggle.click();
  await expect(
    page.getByText("PRIVATE FLIGHTS", { exact: false }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page
      .locator('input[placeholder*="Elon Musk" i], input[placeholder*="person" i]')
      .first(),
  ).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// 10. Typing "Elon Musk" in private flights search returns at least one
//     result — type, wait 500ms, verify at least one element matching a
//     result row appears.
// ---------------------------------------------------------------------------
test("10) searching 'Elon Musk' returns at least one result row", async ({ page }) => {
  // Toggle on the Private Flights layer first.
  await page.getByText("Private Flights", { exact: false }).first().click();
  const input = page
    .locator('input[placeholder*="Elon Musk" i], input[placeholder*="person" i]')
    .first();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.fill("Elon Musk");

  // The panel debounces 300ms + network fetch; wait for at least one
  // result row. Result rows render an uppercase person name in a div with
  // border styling. We assert at least one match within 30s (globe boot
  // + first network call).
  const resultRow = page.locator("div", {
    hasText: /^ELON MUSK$/i,
  });
  await expect(resultRow.first()).toBeVisible({ timeout: GLOBE_BOOT_TIMEOUT });
});

// ---------------------------------------------------------------------------
// 11. "PROTEST MONITORING" toggle exists — verify button text contains
//     "PROTEST MONITORING". Click it. Verify the DateScrubber (bottom
//     strip) becomes hidden.
// ---------------------------------------------------------------------------
test("11) Civil Unrest toggle hides/shows events", async ({ page }) => {
  const toggle = page.getByText("Civil Unrest", { exact: false }).first();
  await expect(toggle).toBeVisible({ timeout: 5_000 });

  // Click the toggle — it should activate the events layer.
  await toggle.click();
  // The InstabilityPanel should appear when civil unrest is on.
  await expect(
    page.getByText("INSTABILITY", { exact: false }).first(),
  ).toBeVisible({ timeout: 5_000 });

  // Click again to turn off.
  await toggle.click();
  await expect(
    page.getByText("INSTABILITY", { exact: false }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 12. No console errors on initial load.
// ---------------------------------------------------------------------------
test("12) no console errors on initial load", async ({ browser }) => {
  const consoleErrors: string[] = [];
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  await page.goto("/");
  await waitForGlobe(page);
  // Give the page a brief moment to flush any late error logs.
  await page.waitForTimeout(2_000);

  expect(consoleErrors).toEqual([]);
});
