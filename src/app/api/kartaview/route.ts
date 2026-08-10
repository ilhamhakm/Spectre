import { NextResponse } from "next/server";
import { fetchKartaviewPhotos, type Bbox } from "@/lib/sources/kartaview";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// GET /api/kartaview?bbox=south,west,north,east
//
// Returns KartaView street-level photos inside the given bounding box.
// Photos carry lat/lng/heading and direct JPEG URLs (full + thumbnail).
// 5-minute server-side cache per bbox. Graceful failure: returns an empty
// array on any fetch error so the layer never breaks.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const bboxParam = url.searchParams.get("bbox");
  if (!bboxParam) {
    return NextResponse.json(
      { photos: [], count: 0, error: "missing bbox" },
      { status: 400 },
    );
  }
  const parts = bboxParam.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json(
      { photos: [], count: 0, error: "invalid bbox" },
      { status: 400 },
    );
  }
  const [south, west, north, east] = parts;
  const bbox: Bbox = { south, west, north, east };

  try {
    const photos = await fetchKartaviewPhotos(bbox, AbortSignal.timeout(30_000));
    return NextResponse.json(
      { photos, count: photos.length, ts: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json(
      { photos: [], count: 0, error: msg },
      { status: 502 },
    );
  }
}
