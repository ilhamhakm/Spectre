import { NextResponse } from "next/server";

// Cache TLE data for 6 hours (TLEs don't change frequently)
let cacheBody: string | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Celestrak can rate-limit repeated downloads. Use multiple endpoints
// as fallbacks.
const ENDPOINTS = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json",
];

export async function GET() {
  const now = Date.now();

  if (cacheBody && now - cacheTime < CACHE_TTL_MS) {
    return new NextResponse(cacheBody, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  for (const url of ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const body = await res.text();

      // Celestrak sometimes returns a text error message instead of JSON
      if (!body.trim().startsWith("[") && !body.trim().startsWith("{")) {
        // Not JSON, try next endpoint
        continue;
      }

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

  // All endpoints failed
  if (cacheBody) {
    return new NextResponse(cacheBody, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "STALE" },
    });
  }
  return NextResponse.json({ error: "Celestrak unavailable", tleRecords: [] }, { status: 502 });
}
