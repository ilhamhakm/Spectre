import { NextResponse } from "next/server";
import { getCachedSnapshot, listCamerasAsync, type CctvCamera } from "@/lib/sources/cctv";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// GET /api/cctv/frame/[id] — snapshot with GEV-style fallback chain:
//
//   1. Shodan cached screenshot (instant, in-memory)
//   2. Upstream snapshotUrl (proxied server-side, 8s timeout, CORS bypass)
//   3. Google Street View static image (if GOOGLE_MAPS_API_KEY set)
//   4. Synthetic SVG placeholder (camera name + "NO UPSTREAM")
//
// Each step sets X-CCTV-Source header for debugging.

const FRAME_FETCH_TIMEOUT_MS = 8_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  // Parse query params. The client can pass url/provider/lat/lon/heading/fov
  // to avoid a full catalog re-fetch (which takes 45s on a cold cache).
  const url = new URL(req.url);
  const clientUrl = url.searchParams.get("url") ?? undefined;
  const clientProvider = url.searchParams.get("provider") ?? undefined;
  const clientLat = url.searchParams.get("lat");
  const clientLon = url.searchParams.get("lon");
  const clientHeading = url.searchParams.get("heading");
  const clientFov = url.searchParams.get("fov");

  // 1. Try cached Shodan snapshot first (instant, no network).
  const cached = getCachedSnapshot(id);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-CCTV-Source": "shodan",
      },
    });
  }

  // If the client provided a snapshot URL, proxy it directly (avoids
  // re-fetching the entire 45s catalog just to find one camera).
  if (clientUrl) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": "spectre/0.1 (cctv proxy)",
      };
      // Streetside Jakarta checks the Referer header for signed URLs.
      if (clientProvider === "streetside") {
        headers.Referer = "https://streetside.mugnimaestra.dev/";
      }
      const imgRes = await fetch(clientUrl, {
        signal: AbortSignal.timeout(FRAME_FETCH_TIMEOUT_MS),
        headers,
      });
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": imgRes.headers.get("Content-Type") ?? "image/jpeg",
            "Cache-Control": "no-store",
            "X-CCTV-Source": clientProvider ?? "upstream",
          },
        });
      }
    } catch {
      // fall through to catalog lookup
    }
  }

  // Fallback: load the full catalog to find the camera (slow on cold cache).
  let cameras: CctvCamera[];
  try {
    cameras = await listCamerasAsync(AbortSignal.timeout(45_000));
  } catch {
    cameras = [];
  }

  // Check Shodan cache again after refresh.
  const refreshed = getCachedSnapshot(id);
  if (refreshed) {
    return new NextResponse(new Uint8Array(refreshed), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-CCTV-Source": "shodan",
      },
    });
  }

  // Find the camera in the list.
  const cam = cameras.find((c) => c.id === id);
  const camName = cam?.name || id;
  const camLat = cam?.lat ?? (clientLat ? Number(clientLat) : undefined);
  const camLon = cam?.lon ?? (clientLon ? Number(clientLon) : undefined);
  const camHeading = cam?.headingDeg ?? (clientHeading ? Number(clientHeading) : 0);
  const camFov = cam?.fovDeg ?? (clientFov ? Number(clientFov) : 80);

  // 2. Proxy upstream snapshotUrl (server-side to avoid CORS and hide tokens).
  if (cam?.snapshotUrl) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": "spectre/0.1 (cctv proxy)",
      };
      // Streetside Jakarta checks the Referer header for signed URLs.
      if (cam.provider === "streetside") {
        headers.Referer = "https://streetside.mugnimaestra.dev/";
      }
      const imgRes = await fetch(cam.snapshotUrl, {
        signal: AbortSignal.timeout(FRAME_FETCH_TIMEOUT_MS),
        headers,
      });
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": imgRes.headers.get("Content-Type") ?? "image/jpeg",
            "Cache-Control": "no-store",
            "X-CCTV-Source": cam.provider,
          },
        });
      }
    } catch {
      // fall through to next fallback
    }
  }

  // 3. Google Street View fallback (if GOOGLE_MAPS_API_KEY set).
  const streetViewKey = process.env.GOOGLE_MAPS_API_KEY;
  if (streetViewKey && Number.isFinite(camLat) && Number.isFinite(camLon)) {
    try {
      const sv = new URL("https://maps.googleapis.com/maps/api/streetview");
      sv.searchParams.set("size", "960x540");
      sv.searchParams.set("location", `${camLat},${camLon}`);
      sv.searchParams.set("heading", String(Number.isFinite(camHeading) ? camHeading : 0));
      sv.searchParams.set("fov", String(Math.max(20, Math.min(120, camFov))));
      sv.searchParams.set("pitch", "0");
      sv.searchParams.set("source", "outdoor");
      sv.searchParams.set("return_error_code", "true");
      sv.searchParams.set("key", streetViewKey);

      const svResp = await fetch(sv.toString(), {
        headers: { "User-Agent": "spectre/0.1 (cctv proxy)" },
        signal: AbortSignal.timeout(FRAME_FETCH_TIMEOUT_MS),
      });
      const svType = svResp.headers.get("content-type") || "";
      if (svResp.ok && svType.startsWith("image/")) {
        const buf = await svResp.arrayBuffer();
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": svType,
            "Cache-Control": "no-store",
            "X-CCTV-Source": "streetview",
          },
        });
      }
    } catch {
      // fall through to synthetic
    }
  }

  // 4. Synthetic SVG placeholder.
  const svg = buildSyntheticSvg(camName, cam?.snapshotUrl ? "UPSTREAM UNAVAILABLE" : "NO UPSTREAM CONFIGURED");
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      "X-CCTV-Source": "synthetic",
    },
  });
}

function buildSyntheticSvg(label: string, status: string): string {
  const safeLabel = label.replace(/[<>&"']/g, (ch) => {
    switch (ch) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#0a0e14"/>
  <rect x="20" y="20" width="920" height="500" fill="none" stroke="#1a2a3a" stroke-width="2"/>
  <text x="480" y="250" text-anchor="middle" fill="#3a5a7a" font-family="monospace" font-size="28" font-weight="bold">${safeLabel}</text>
  <text x="480" y="290" text-anchor="middle" fill="#2a4a6a" font-family="monospace" font-size="16">${status}</text>
  <circle cx="480" cy="180" r="30" fill="none" stroke="#2a4a6a" stroke-width="2"/>
  <circle cx="480" cy="180" r="12" fill="#1a2a3a"/>
</svg>`;
}
