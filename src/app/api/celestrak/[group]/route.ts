import { NextRequest, NextResponse } from "next/server";

// Per-group CelesTrak TLE proxy, mirroring GEV's celestrakProxy middleware.
// Serves raw 3-line TLE text for one catalog group. Server-side memory cache
// with a 2h TTL (TLE drift over 2h is negligible for visualization), and
// stale-on-fail so a CelesTrak outage degrades instead of breaking the layer.

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

const ALLOWED_GROUPS = new Set([
  "stations",
  "visual",
  "gps-ops",
  "glo-ops",
  "galileo",
  "geo",
]);

interface CacheEntry {
  body: string;
  time: number;
}

const cache = new Map<string, CacheEntry>();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ group: string }> },
) {
  const { group } = await params;

  if (!ALLOWED_GROUPS.has(group)) {
    return NextResponse.json({ error: "Unknown group" }, { status: 404 });
  }

  const now = Date.now();
  const hit = cache.get(group);
  if (hit && now - hit.time < CACHE_TTL_MS) {
    return new NextResponse(hit.body, {
      status: 200,
      headers: { "Content-Type": "text/plain", "X-Cache": "HIT" },
    });
  }

  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "spectre-v2-celestrak-proxy/1.0" },
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = await res.text();
    // CelesTrak returns "No GP data found" style text for empty groups.
    if (!body.includes("\n2 ")) throw new Error("No TLE data returned");

    cache.set(group, { body, time: now });
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/plain", "X-Cache": "MISS" },
    });
  } catch {
    // Stale-on-fail: serve expired cache rather than nothing.
    if (hit) {
      return new NextResponse(hit.body, {
        status: 200,
        headers: { "Content-Type": "text/plain", "X-Cache": "STALE" },
      });
    }
    return NextResponse.json(
      { error: "Celestrak unavailable" },
      { status: 502 },
    );
  }
}
