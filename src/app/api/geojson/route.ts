import { NextResponse } from "next/server";

// Cache GeoJSON for 24 hours (borders rarely change)
let cacheBody: string | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const URLS = [
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
  "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
];

export async function GET() {
  const now = Date.now();

  if (cacheBody && now - cacheTime < CACHE_TTL_MS) {
    return new NextResponse(cacheBody, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  for (const url of URLS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const body = await res.text();
      if (!body || body.trim().length === 0) continue;

      cacheBody = body;
      cacheTime = now;

      return new NextResponse(body, {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
      });
    } catch {
      continue;
    }
  }

  if (cacheBody) {
    return new NextResponse(cacheBody, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "STALE" },
    });
  }
  return NextResponse.json({ error: "GeoJSON unavailable" }, { status: 502 });
}
