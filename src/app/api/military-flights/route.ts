// GET /api/military-flights — proxies airplanes.live /mil endpoint with
// server-side caching (5 min TTL). Free tier: 500 req/day → 288 reqs/day
// worst case. Returns { flights, count, ts, cached }. 5 min keeps the
// accumulated trace store (see military-trace-store) dense while staying
// comfortably under the free budget.

import { NextResponse } from "next/server";
import NodeCache from "node-cache";
import { fetchMilitaryFlights, type MilitaryFlight } from "@/lib/sources/airplanes-live";
import { recordMilitaryPositions } from "@/lib/military-trace-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const CACHE_TTL_SECONDS = 300; // 5 min — keeps us under 500/day free tier
const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

const CACHE_KEY = "airplanes.live:mil";
interface CachedPayload {
  flights: MilitaryFlight[];
  ts: number;
}

export async function GET() {
  const cached = cache.get<CachedPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(
      { flights: cached.flights, count: cached.flights.length, ts: cached.ts, cached: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const flights = await fetchMilitaryFlights();
    const ts = Date.now();
    // Accumulate each aircraft's current position for the trace endpoint
    // (airplanes.live has no history API, so we build the past track ourselves).
    recordMilitaryPositions(flights);
    cache.set(CACHE_KEY, { flights, ts });
    return NextResponse.json(
      { flights, count: flights.length, ts, cached: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json(
      { flights: [], count: 0, error: msg, cached: false },
      { status: 502 },
    );
  }
}
