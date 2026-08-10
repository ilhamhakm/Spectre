import { NextResponse } from "next/server";
import { fetchTraffic } from "@/lib/sources/traffic";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// 60-second in-memory cache so panning/zooming doesn't re-simulate
// the same bbox repeatedly. Keyed by rounded bbox.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { ts: number; body: any }>();

function bboxKey(s: number, w: number, n: number, e: number): string {
  return `${s.toFixed(2)},${w.toFixed(2)},${n.toFixed(2)},${e.toFixed(2)}`;
}

// GET /api/traffic?south=...&west=...&north=...&east=...&level=1|2|3
export async function GET(req: Request) {
  const url = new URL(req.url);
  const south = parseFloat(url.searchParams.get("south") ?? "");
  const west = parseFloat(url.searchParams.get("west") ?? "");
  const north = parseFloat(url.searchParams.get("north") ?? "");
  const east = parseFloat(url.searchParams.get("east") ?? "");
  if ([south, west, north, east].some((n) => Number.isNaN(n))) {
    return NextResponse.json(
      { error: "missing or invalid bbox", vehicles: [], congestions: {}, roads: [] },
      { status: 400 },
    );
  }

  const levelRaw = url.searchParams.get("level");
  const level = (levelRaw === "1" || levelRaw === "3") ? Number(levelRaw) as 1 | 2 | 3 : 2;

  const key = bboxKey(south, west, north, east) + ":" + level;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body, {
      headers: { "Cache-Control": "no-store", "X-Traffic-Cache": "HIT" },
    });
  }

  try {
    const result = await fetchTraffic({ south, west, north, east, level });
    const body = {
      vehicles: result.vehicles,
      congestions: result.congestions,
      roads: result.roads,
      ts: result.ts,
    };
    cache.set(key, { ts: Date.now(), body });
    // Bounded cache: evict oldest entries beyond 16 bboxes.
    if (cache.size > 16) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store", "X-Traffic-Cache": "MISS" },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message ?? "fetch failed",
        vehicles: [],
        congestions: {},
        roads: [],
      },
      { status: 502 },
    );
  }
}
