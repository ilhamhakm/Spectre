/**
 * GET /api/tomtom/status -> {hasKey, dailyCount, budget, date}
 *
 * Ported faithfully from GEV's tomtomProxy() status branch. Keyless mode
 * reports hasKey:false; the flow tile endpoint 503s without touching upstream,
 * so the traffic layer stays in simulation mode.
 */

import { loadBudgetOnce, currentBudget, dailyBudgetLimit } from "@/lib/tomtom-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await loadBudgetOnce();
  const hasKey = Boolean(process.env.TOMTOM_API_KEY);
  const b = currentBudget();
  return Response.json(
    { hasKey, dailyCount: b.count, budget: dailyBudgetLimit(), date: b.date },
    { headers: { "Cache-Control": "no-store" } },
  );
}
