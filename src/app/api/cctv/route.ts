import { NextResponse } from "next/server";
import { listCamerasAsync } from "@/lib/sources/cctv";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// GET /api/cctv — list public cameras from:
//   - Streetside Jakarta (1,246 DKI Jakarta gov cameras with JPEG snapshots)
//   - Palembang Diskominfo live API (~30 cameras with HLS streams)
//   - OpenStreetMap surveillance cameras (Overpass API)
//   - Windy Webcams API (global webcams with JPEG snapshots)
//   - OpenTrafficCamMap (US state DOT cameras)
//   - TfL JamCams (London)
//   - Caltrans (California)
//   - 511NY, LTA, TfNSW (key-gated)
//   - Shodan (membership-gated)
//
// Sensitive cameras (Papua/Aceh) have fuzzed coords + redacted name.
// Response is cached for 30 minutes server-side (stale-while-revalidate).
export async function GET() {
  try {
    const cameras = await listCamerasAsync(
      AbortSignal.timeout(45_000),
    );
    return NextResponse.json(
      { cameras, count: cameras.length, ts: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json(
      { cameras: [], count: 0, error: msg },
      { status: 502 },
    );
  }
}
