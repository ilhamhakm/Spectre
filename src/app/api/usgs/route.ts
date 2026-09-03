import { NextResponse } from "next/server";

// Cache earthquake data for 5 minutes
let cacheBody: string | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  const now = Date.now();

  if (cacheBody && now - cacheTime < CACHE_TTL_MS) {
    return new NextResponse(cacheBody, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  try {
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
    if (!res.ok) {
      if (cacheBody) {
        return new NextResponse(cacheBody, {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Cache": "STALE" },
        });
      }
      return NextResponse.json({ error: `USGS returned ${res.status}` }, { status: 502 });
    }

    const body = await res.text();
    cacheBody = body;
    cacheTime = now;

    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch {
    if (cacheBody) {
      return new NextResponse(cacheBody, {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Cache": "STALE" },
      });
    }
    return NextResponse.json({ error: "Failed to reach USGS" }, { status: 502 });
  }
}
