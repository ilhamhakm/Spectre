import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";

async function waitForGlobeReady(page: Page, timeout = 120_000) {
  await page.waitForFunction(
    () => (window as any).__viewer && !(window as any).__viewer.isDestroyed(),
    undefined,
    { timeout },
  );
}

// Click a toggle button in the LEFT panel (TacticalHUD) by its label text.
// The ToggleButton component uppercases labels, so we match on uppercase.
async function clickLeftPanelButton(page: Page, label: string) {
  const btn = page.locator("button").filter({ hasText: label.toUpperCase() }).first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await btn.click();
}

// Wait for a replay layer to be active in the store.
async function waitForReplayActive(
  page: Page,
  layer: "big-changes-replay" | "construction-replay",
  timeout = 30_000,
) {
  await page.waitForFunction(
    (l) => (window as any).__store?.getState()?.replayActiveLayer === l,
    layer,
    { timeout },
  );
}

// Wait for the replay timeline bar to appear in the DOM.
async function waitForTimelineVisible(page: Page, timeout = 10_000) {
  // The timeline shows the layer label text (BIG CHANGES or CONSTRUCTION).
  const label = page.locator("text=BIG CHANGES").or(page.locator("text=CONSTRUCTION"));
  await label.first().waitFor({ state: "visible", timeout });
}

test("replay timeline: Big Changes layer shows timeline, step buttons change date, play toggles, close works", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(BASE, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await waitForGlobeReady(page);

  // Toggle the Big Changes replay layer on.
  await clickLeftPanelButton(page, "Big Changes");
  await waitForReplayActive(page, "big-changes-replay");

  // The timeline bar should be visible at the bottom of the screen.
  await waitForTimelineVisible(page);

  // Verify the timeline has the 5 step control buttons: <<, <, PLAY, >, >>
  // We check for their title attributes which are set on each button.
  const backMonthBtn = page.locator('button[title="Back 1 month"]');
  const backWeekBtn = page.locator('button[title="Back 1 week"]');
  const playBtn = page.locator('button[title^="Play"], button[title^="Pause"]').first();
  const fwdWeekBtn = page.locator('button[title="Forward 1 week"]');
  const fwdMonthBtn = page.locator('button[title="Forward 1 month"]');
  await expect(backMonthBtn).toBeVisible();
  await expect(backWeekBtn).toBeVisible();
  await expect(playBtn).toBeVisible();
  await expect(fwdWeekBtn).toBeVisible();
  await expect(fwdMonthBtn).toBeVisible();

  // Record the initial date.
  const initialDate = await page.evaluate(
    () => (window as any).__store.getState().replayDate,
  );
  expect(typeof initialDate).toBe("string");
  expect(initialDate.length).toBe(10); // YYYY-MM-DD

  // Click "<" (back 1 week) and verify the date shifted by 7 days.
  await backWeekBtn.click();
  await page.waitForFunction(
    (prev) => {
      const d = (window as any).__store.getState().replayDate;
      return d !== prev;
    },
    initialDate,
    { timeout: 10_000 },
  );
  const afterBackWeek = await page.evaluate(
    () => (window as any).__store.getState().replayDate,
  );
  // Verify it's exactly 7 days earlier.
  const diffDays = Math.round(
    (new Date(initialDate).getTime() - new Date(afterBackWeek).getTime()) / 86_400_000,
  );
  expect(diffDays).toBe(7);

  // Click "<<" (back 1 month = 30 days) and verify.
  await backMonthBtn.click();
  await page.waitForFunction(
    (prev) => {
      const d = (window as any).__store.getState().replayDate;
      return d !== prev;
    },
    afterBackWeek,
    { timeout: 10_000 },
  );
  const afterBackMonth = await page.evaluate(
    () => (window as any).__store.getState().replayDate,
  );
  const diffDays2 = Math.round(
    (new Date(afterBackWeek).getTime() - new Date(afterBackMonth).getTime()) / 86_400_000,
  );
  expect(diffDays2).toBe(30);

  // Click ">" (forward 1 week) and verify date advanced by 7 days.
  await fwdWeekBtn.click();
  await page.waitForFunction(
    (prev) => {
      const d = (window as any).__store.getState().replayDate;
      return d !== prev;
    },
    afterBackMonth,
    { timeout: 10_000 },
  );
  const afterFwdWeek = await page.evaluate(
    () => (window as any).__store.getState().replayDate,
  );
  const diffDays3 = Math.round(
    (new Date(afterFwdWeek).getTime() - new Date(afterBackMonth).getTime()) / 86_400_000,
  );
  expect(diffDays3).toBe(7);

  // Click ">>" (forward 1 month = 30 days) and verify.
  await fwdMonthBtn.click();
  await page.waitForFunction(
    (prev) => {
      const d = (window as any).__store.getState().replayDate;
      return d !== prev;
    },
    afterFwdWeek,
    { timeout: 10_000 },
  );
  const afterFwdMonth = await page.evaluate(
    () => (window as any).__store.getState().replayDate,
  );
  const diffDays4 = Math.round(
    (new Date(afterFwdMonth).getTime() - new Date(afterFwdWeek).getTime()) / 86_400_000,
  );
  expect(diffDays4).toBe(30);

  // Click PLAY and verify replayPlaying becomes true.
  await playBtn.click();
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.replayPlaying === true,
    undefined,
    { timeout: 10_000 },
  );

  // Click PLAY again (now PAUSE) and verify replayPlaying becomes false.
  await playBtn.click();
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.replayPlaying === false,
    undefined,
    { timeout: 10_000 },
  );

  // Click the close button (X) and verify the layer turns off + timeline disappears.
  const closeBtn = page.locator('button[title="Close replay layer"]');
  await closeBtn.click();
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.replayActiveLayer === null,
    undefined,
    { timeout: 10_000 },
  );
  // The timeline bar should no longer be visible: its step buttons should be gone.
  await expect(page.locator('button[title="Back 1 week"]')).toHaveCount(0);
  await expect(page.locator('button[title="Forward 1 month"]')).toHaveCount(0);
});

test("replay timeline: Construction layer activates and timeline appears", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(BASE, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await waitForGlobeReady(page);

  // Toggle the Construction replay layer on.
  await clickLeftPanelButton(page, "Construction");
  await waitForReplayActive(page, "construction-replay");

  // The timeline bar should show the CONSTRUCTION label.
  await page.locator("text=CONSTRUCTION").first().waitFor({ state: "visible", timeout: 10_000 });

  // Verify the step buttons are present.
  await expect(page.locator('button[title="Back 1 week"]')).toBeVisible();
  await expect(page.locator('button[title="Forward 1 month"]')).toBeVisible();

  // Close it.
  await page.locator('button[title="Close replay layer"]').click();
  await page.waitForFunction(
    () => (window as any).__store?.getState()?.replayActiveLayer === null,
    undefined,
    { timeout: 10_000 },
  );
  // Timeline step buttons should be gone.
  await expect(page.locator('button[title="Back 1 week"]')).toHaveCount(0);
});
