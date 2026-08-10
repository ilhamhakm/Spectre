import { NextResponse } from "next/server";
import { getCachedSnapshot, listCamerasAsync } from "@/lib/sources/cctv";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// GET /api/cctv/snapshot?id={camera_id}
//
// Returns a JPEG snapshot for a CCTV camera. Sources:
//   - Shodan cameras: base64 screenshot cached in-memory from the Shodan
//     search API response. 10-minute TTL.
//   - Windy / Streetside / OTC cameras: proxies the direct JPEG URL from the
//     camera's snapshotUrl (server-side to avoid CORS and hide tokens).
//   - Other cameras (Palembang, OSM): no direct snapshot URL
//     available without server-side Playwright/ffmpeg — returns 501.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  // Try cached Shodan snapshot first (instant, no network).
  const cached = getCachedSnapshot(id);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Snapshot-Source": "shodan",
      },
    });
  }

  // Refresh camera list (populates Windy image URLs + Shodan cache).
  try {
    await listCamerasAsync(AbortSignal.timeout(45_000));
  } catch {
    // cameras fetch failed — fall through
  }

  // Check Shodan cache again after refresh.
  const refreshed = getCachedSnapshot(id);
  if (refreshed) {
    return new NextResponse(new Uint8Array(refreshed), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Snapshot-Source": "shodan",
      },
    });
  }

  // For Windy cameras, proxy the JPEG from Windy's CDN.
  // We need to find the camera's snapshotUrl from the in-memory list.
  // listCamerasAsync already ran above, so the cache is populated.
  // We import listCameras (sync) — but it only returns static catalog.
  // Instead, re-call listCamerasAsync and search for the camera.
  try {
    const cameras = await listCamerasAsync(AbortSignal.timeout(45_000));
    const cam = cameras.find((c) => c.id === id);
    if (cam?.snapshotUrl) {
      const headers: Record<string, string> = {
        "User-Agent": "spectre/0.1 (cctv proxy)",
      };
      // Streetside Jakarta checks the Referer header for signed URLs.
      if (cam.provider === "streetside") {
        headers.Referer = "https://streetside.mugnimaestra.dev/";
      }
      const imgRes = await fetch(cam.snapshotUrl, {
        signal: AbortSignal.timeout(8000),
        headers,
      });
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": imgRes.headers.get("Content-Type") ?? "image/jpeg",
            "Cache-Control": "no-store",
            "X-Snapshot-Source": cam.provider,
          },
        });
      }
    }
  } catch {
    // fall through to 501
  }

  return NextResponse.json(
    { error: "no snapshot available for this camera" },
    { status: 501 },
  );
}
