/**
 * Shared TomTom daily-budget governor for the /api/tomtom/* routes.
 * Ported faithfully from GEV's tomtomProxy() budget accounting. A persistent
 * counter (.spectre-cache/tomtom/budget.json, keyed by UTC date, reset on day
 * change) counts upstream fetch attempts against a soft cap. Cache hits never
 * count. Over the cap the proxy serves stale tiles when available, else 429.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { utcDayKey, normalizeBudget, isOverBudget, type BudgetState } from "./tomtom-tiles";

const CACHE_DIR = path.join(process.cwd(), ".spectre-cache", "tomtom");
const BUDGET_PATH = path.join(CACHE_DIR, "budget.json");
const DEFAULT_DAILY_BUDGET = 40000;

let _budget: BudgetState | null = null;
let _budgetLoaded = false;

/** Daily tile budget soft cap (TOMTOM_DAILY_TILE_BUDGET env, default 40000). */
export function dailyBudgetLimit(): number {
  const raw = Number.parseInt(process.env.TOMTOM_DAILY_TILE_BUDGET || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET;
}

/** Lazily load the persisted budget counter once per process. */
export async function loadBudgetOnce(): Promise<void> {
  if (_budgetLoaded) return;
  _budgetLoaded = true;
  try {
    const parsed = JSON.parse(await fsp.readFile(BUDGET_PATH, "utf8"));
    if (parsed && typeof parsed.date === "string" && Number.isFinite(parsed.count)) {
      _budget = parsed as BudgetState;
    }
  } catch {
    /* no budget file yet */
  }
}

async function persistBudget(): Promise<void> {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(BUDGET_PATH, JSON.stringify(_budget), "utf8");
  } catch (err) {
    console.warn("[tomtom-proxy] budget write failed:", (err as Error)?.message || err);
  }
}

/** Roll the counter to today (UTC) and return it. */
export function currentBudget(): BudgetState {
  _budget = normalizeBudget(_budget, utcDayKey());
  return _budget;
}

/** Count one upstream fetch attempt against today's budget (async persist). */
export function recordUpstreamFetch(): void {
  currentBudget().count += 1;
  void persistBudget();
}

/** Whether the daily soft cap has been reached. */
export function budgetExhausted(): boolean {
  return isOverBudget(currentBudget(), dailyBudgetLimit());
}
