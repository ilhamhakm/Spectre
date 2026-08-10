// KartaView street-level photo integration for the Spectre globe.
//
// KartaView (formerly OpenStreetCam) is an open-source (GPL) street-level
// photo platform. Photos carry lat/lng/heading (compass degrees) and direct
// JPEG URLs (full + thumbnail). No auth needed for basic reads.
// License: CC-BY-SA 4.0 (compatible with OSM).
//
// Used as a ground-level imagery source alongside the CCTV mesh. The layer
// polls /api/kartaview with the current camera viewport bbox so only photos
// in the viewed region are fetched. 5-minute in-memory cache per bbox.

export interface KartaviewPhoto {
  id: string;
  lat: number;
  lon: number;
  headingDeg: number;
  shotDate: string;
  snapshotUrl: string;
  thumbUrl: string;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface KartaviewItem {
  id: number | string;
  lat: number;
  lng: number;
  heading?: number;
  shot_date?: string;
  file_path?: string;
  thumb_path?: string;
}

interface KartaviewResponse {
  result?: { items?: KartaviewItem[] };
}

const KARTAVIEW_URL = "https://api.openstreetcam.org/v1/photos";

// In-memory cache keyed by rounded bbox. 5-min TTL matches the Windy cache.
const cache = new Map<string, { photos: KartaviewPhoto[]; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

function bboxKey(b: Bbox): string {
  return [b.south, b.west, b.north, b.east]
    .map((v) => v.toFixed(3))
    .join(",");
}

export async function fetchKartaviewPhotos(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<KartaviewPhoto[]> {
  const key = bboxKey(bbox);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.photos;
  }

  const bboxParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = `${KARTAVIEW_URL}?bbox=${encodeURIComponent(bboxParam)}&limit=100`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(FETCH_TIMEOUT_MS),
      ]),
      headers: { "User-Agent": "spectre/0.1", Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[kartaview] API ${res.status}`);
      return [];
    }
    const body = (await res.json()) as KartaviewResponse;
    const items = body?.result?.items;
    if (!Array.isArray(items)) return [];

    const photos: KartaviewPhoto[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const lat = Number(it.lat);
      const lon = Number(it.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = String(it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      photos.push({
        id,
        lat,
        lon,
        headingDeg: Number.isFinite(it.heading as number)
          ? ((Number(it.heading) % 360) + 360) % 360
          : 0,
        shotDate: it.shot_date ?? "",
        snapshotUrl: it.file_path ?? "",
        thumbUrl: it.thumb_path ?? "",
      });
    }

    cache.set(key, { photos, ts: Date.now() });
    return photos;
  } catch (err) {
    console.warn("[kartaview] fetch failed:", err);
    return [];
  }
}
