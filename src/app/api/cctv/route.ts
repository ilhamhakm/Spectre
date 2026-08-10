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
//
// Sensitive cameras (Papua/Aceh) have fuzzed coords + redacted name per
// PRD H2/S-03. Response is cached for 5 minutes server-side.
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
