// CCTV / webcam aggregation for the Spectre V2 globe.
//
// Sources (free, public portals):
//   - Streetside Jakarta (streetside.mugnimaestra.dev) — 1,246 live DKI Jakarta
//     government CCTV cameras with JPEG snapshots (CC-BY 4.0).
//   - ATCS Indonesia (atcsindonesia.com/api/cctv) — 114+ live Bali government
//     traffic cameras with streaming embeds.
//   - Palembang Diskominfo (cctv.palembang.go.id/api/cctv) — ~30 live cameras
//     with real GeoJSON coords + HLS streams.
//   - OpenStreetMap `man_made=surveillance` nodes (Overpass API) — camera
//     positions + optional `camera:direction` / `camera:angle_h` tags.
//   - Windy Webcams API v3 — global public webcams with direct JPEG
//     snapshot URLs (token-secured, ~10-min TTL on free tier).
//   - OpenTrafficCamMap (AidanWelch/OpenTrafficCamMap) — US state DOT camera
//     feeds (HLS streams + some direct JPEG IMAGE_STREAM feeds).
//   - TfL JamCams (London) — ~882 cameras with JPG/MP4.
//   - Caltrans (California) — 12 districts, XML, JPG.
//   - 511NY (NY State) — ~1000 cameras, requires API key.
//   - LTA DataMall (Singapore) — ~100 cameras, requires API key.
//   - TfNSW (NSW Australia) — ~200 cameras, requires API key.
//   - Shodan — IP cameras with screenshots, requires membership.
//
// Privacy: cameras flagged is_sensitive are fuzzed + redacted in responses.

// --- Manual corrections: user-submitted lat/lon/heading overrides ---
// Loaded from cctv-corrections.json (keyed by camera ID). Applied in
// listCamerasAsync after fetching from upstream sources. Lets the user
// fix cameras that are off by ~200m or facing the wrong way.
import correctionsData from "./cctv-corrections.json";

interface Correction {
  lat?: number;
  lon?: number;
  headingDeg?: number;
}
const corrections: Record<string, Correction> = correctionsData as Record<string, Correction>;

export function getCctvCorrections(): Record<string, Correction> {
  return { ...corrections };
}

export function setCctvCorrection(camId: string, correction: Correction): void {
  corrections[camId] = { ...corrections[camId], ...correction };
}

function applyCorrections(cameras: CctvCamera[]): CctvCamera[] {
  if (Object.keys(corrections).length === 0) return cameras;
  return cameras.map((c) => {
    const corr = corrections[c.id];
    if (!corr) return c;
    return {
      ...c,
      lat: corr.lat ?? c.lat,
      lon: corr.lon ?? c.lon,
      headingDeg: corr.headingDeg ?? c.headingDeg,
    };
  });
}

export type CctvProvider =
  | "palembang"
  | "osm"
  | "shodan"
  | "windy"
  | "streetside"
  | "otc"
  | "atcs"
  | "tfl"
  | "caltrans"
  | "511ny"
  | "lta"
  | "tfnsw"
  | "other";

export interface CctvCamera {
  id: string;
  provider: CctvProvider;
  name: string;
  lat: number;
  lon: number;
  region: string;
  headingDeg?: number;
  fovDeg?: number;
  embedUrl?: string;
  streamUrl?: string;
  snapshotUrl?: string;
  isSensitive?: boolean;
  isOnline?: boolean;
  category?: string;
}

// ============================================================================
// STATIC CATALOG — (none currently; all providers are dynamic)
// ============================================================================
export const CCTV_CAMERAS: CctvCamera[] = [];

// ============================================================================
// Compass helpers — OSM `camera:direction` / `direction` tag -> degrees
// ============================================================================

const COMPASS_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  north: 0, northeast: 45, east: 90, southeast: 135,
  south: 180, southwest: 225, west: 270, northwest: 315,
};

// Parses an OSM direction tag into degrees. Accepts compass points
// ("NE", "north", "NNW"), bare degrees ("90", "90.5"), and suffixed forms
// ("90 deg", "90 deg"). Returns undefined when unparseable.
export function osmDirectionToDegrees(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  if (COMPASS_DEG[v.toUpperCase()] !== undefined) return COMPASS_DEG[v.toUpperCase()];
  const m = v.match(/^(-?\d+(?:\.\d+)?)\s*(?:deg|degrees)?$/i);
  if (m) {
    const deg = Number(m[1]);
    return ((deg % 360) + 360) % 360;
  }
  return undefined;
}

// Parses OSM `camera:angle_h` (horizontal FOV in degrees) -> clamped fovDeg.
export function osmDirectionToFov(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const fov = Number(m[1]);
  if (!Number.isFinite(fov) || fov <= 0) return undefined;
  return Math.min(170, Math.max(20, fov));
}

// Deterministic heading derived from a camera id hash — used when a source
// gives no direction (default FOV 60, heading pseudo-random but stable).
export function hashHeadingDeg(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 360 + 360) % 360;
}

// ============================================================================
// DYNAMIC: Palembang Diskominfo live CCTV API
// ============================================================================

interface PalembangCctvResponse {
  status: string;
  message: string;
  data: PalembangCctvItem[];
}

interface PalembangCctvItem {
  location: { type: string; coordinates: [number, number] }; // [lon, lat]
  cctv_id: string;
  cctv_title: string;
  cctv_link?: string;
  cctv_status?: string;
  is_online?: boolean;
  cctv_category?: string;
  kecamatan?: { namaKecamatan?: string };
}

export async function fetchPalembangCctv(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  const res = await fetch("https://cctv.palembang.go.id/api/cctv", {
    cache: "no-store",
    headers: { "User-Agent": "spectre/0.1 (cctv monitor)" },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Palembang CCTV API ${res.status}`);
  }
  const body = (await res.json()) as PalembangCctvResponse;
  if (!body.data || !Array.isArray(body.data)) return [];

  return body.data.map((item): CctvCamera => {
    const [lon, lat] = item.location?.coordinates ?? [0, 0];
    return {
      id: `plb-${(item.cctv_id ?? "unknown").toLowerCase()}`,
      provider: "palembang",
      name: item.cctv_title ?? item.cctv_id ?? "Palembang CCTV",
      lat,
      lon,
      region: "Sumatera Selatan",
      headingDeg: hashHeadingDeg(`plb-${item.cctv_id ?? ""}`),
      fovDeg: 60,
      streamUrl: item.cctv_link,
      embedUrl: item.cctv_link,
      isOnline: item.is_online ?? item.cctv_status === "active",
      category: item.cctv_category,
    };
  });
}

// ============================================================================
// DYNAMIC: OpenStreetMap surveillance cameras (Overpass API)
// ============================================================================

interface OverpassResponse {
  elements: Array<{
    type: string;
    id: number;
    lat: number;
    lon: number;
    tags?: Record<string, string>;
  }>;
}

// Overpass is heavily loaded for large bboxes (504s on country-wide areas), so
// OSM is scoped to Jakarta metro + NYC metro; OTC covers the rest of the US and
// OSM bounding boxes — major metro areas for surveillance camera nodes.
const OSM_BBOXES: Array<{ region: string; south: number; west: number; north: number; east: number }> = [
  { region: "Jakarta Metro", south: -6.4, west: 106.6, north: -6.0, east: 107.0 },
  { region: "Bali", south: -8.9, west: 114.8, north: -8.4, east: 115.8 },
  { region: "NYC Metro", south: 40.4, west: -74.3, north: 41.1, east: -73.7 },
  { region: "Tokyo Metro", south: 35.5, west: 139.5, north: 35.8, east: 139.9 },
  { region: "London Metro", south: 51.3, west: -0.5, north: 51.7, east: 0.3 },
  { region: "Singapore", south: 1.1, west: 103.5, north: 1.5, east: 104.0 },
  { region: "Sydney Metro", south: -34.1, west: 150.7, north: -33.7, east: 151.3 },
];

// Singapore sits inside the Indonesia bbox — exclude it.
function isSingapore(lat: number, lon: number): boolean {
  return lat > 1.15 && lat < 1.5 && lon > 103.6 && lon < 104.05;
}

function osmCamFromElement(
  el: { id: number; lat: number; lon: number; tags?: Record<string, string> },
  region: string,
): CctvCamera {
  const t = el.tags ?? {};
  const rawDir = t["camera:direction"] || t.direction;
  const headingDeg = osmDirectionToDegrees(rawDir) ?? hashHeadingDeg(`osm-${el.id}`);
  const fovDeg = osmDirectionToFov(t["camera:angle_h"]) ?? 60;
  return {
    id: `osm-${el.id}`,
    provider: "osm",
    name: t.name || t.operator || "OSM Surveillance Camera",
    lat: el.lat,
    lon: el.lon,
    region,
    headingDeg,
    fovDeg,
    category: t["surveillance:zone"] || t.surveillance,
  };
}

export async function fetchOsmCameras(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  // Query each bbox separately (smaller, faster, less likely to 504) with a
  // generous per-bbox timeout, and fall back to the lambert mirror if the
  // main overpass-api.de instance times out or is overloaded.
  const ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lambert.openstreetmap.de/api/interpreter",
  ];

  const results = await Promise.allSettled(
    OSM_BBOXES.map(async (b) => {
      const query =
        `[out:json][timeout:30];` +
        `(node["man_made"="surveillance"]["surveillance:type"="camera"]` +
        `(${b.south},${b.west},${b.north},${b.east}););out 300;`;

      let lastErr: unknown = null;
      for (const endpoint of ENDPOINTS) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": "spectre/0.1",
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.any([
              ...(signal ? [signal] : []),
              AbortSignal.timeout(15_000),
            ]),
          });
          if (!res.ok) throw new Error(`Overpass ${endpoint} ${res.status}`);
          const body = (await res.json()) as OverpassResponse;
          if (!body.elements) return [];
          return body.elements
            .filter((el) => el.type === "node" && typeof el.lat === "number")
            .filter((el) => !isSingapore(el.lat, el.lon))
            .map((el) => osmCamFromElement(el, b.region));
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    }),
  );

  const cams: CctvCamera[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") cams.push(...r.value);
  }
  return cams;
}

// ============================================================================
// DYNAMIC: Shodan — IP cameras with screenshots
// ============================================================================
// Screenshots are base64 JPEG inline in `opts.screenshot.data`, cached
// in-memory so /api/cctv/frame can serve them without re-querying.
//
// NOTE (2026-08): the oss plan has 0 query credits and search returns
// HTTP 403 {"error":"Requires membership or higher to access"}. Until the
// $49/year membership is bought, this source no-ops gracefully: missing
// key -> [], 401/403 -> []. No throw, no 502s.

interface ShodanMatch {
  ip_str: string;
  port: number;
  product?: string;
  version?: string;
  org?: string;
  isp?: string;
  hostnames?: string[];
  timestamp?: string;
  location?: {
    country_code?: string;
    country_name?: string;
    city?: string;
    region_code?: string;
    latitude?: number;
    longitude?: number;
  };
  opts?: {
    screenshot?: {
      data?: string; // base64 JPEG
      label?: string;
    };
  };
}

interface ShodanSearchResponse {
  matches: ShodanMatch[];
  total: number;
}

// In-memory screenshot cache: cameraId -> { jpeg: Buffer, ts: number }
const screenshotCache = new Map<string, { jpeg: Buffer; ts: number }>();
const SCREENSHOT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getCachedSnapshot(cameraId: string): Buffer | null {
  const entry = screenshotCache.get(cameraId);
  if (!entry) return null;
  if (Date.now() - entry.ts > SCREENSHOT_CACHE_TTL_MS) {
    screenshotCache.delete(cameraId);
    return null;
  }
  return entry.jpeg;
}

function cacheSnapshot(cameraId: string, base64Data: string): void {
  try {
    const jpeg = Buffer.from(base64Data, "base64");
    screenshotCache.set(cameraId, { jpeg, ts: Date.now() });
  } catch {
    // invalid base64 — skip
  }
}

export async function fetchShodanCameras(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  const apiKey = process.env.SHODAN_API_KEY;
  if (!apiKey) return [];

  const query = "port:554 has_screenshot:true country:ID";
  const url =
    `https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(query)}` +
    `&fields=ip_str,port,product,location,opts.screenshot.data,opts.screenshot.label,timestamp,org,hostnames`;

  const res = await fetch(url, {
    signal,
    headers: { "User-Agent": "spectre/0.1" },
  });
  // Membership-gated (403) or bad key (401) -> no-op, don't break the layer.
  if (res.status === 401 || res.status === 403) {
    console.warn(`[cctv] Shodan ${res.status} — requires membership, skipping`);
    return [];
  }
  if (!res.ok) {
    throw new Error(`Shodan API ${res.status}`);
  }
  const body = (await res.json()) as ShodanSearchResponse;
  if (!body.matches || !Array.isArray(body.matches)) return [];

  const cameras: CctvCamera[] = [];
  for (const m of body.matches) {
    const lat = m.location?.latitude;
    const lon = m.location?.longitude;
    const screenshotData = m.opts?.screenshot?.data;
    if (lat == null || lon == null) continue;

    const id = `shodan-${m.ip_str.replace(/\./g, "-")}-${m.port}`;
    const name =
      m.product ||
      m.hostnames?.[0] ||
      `IP Camera ${m.ip_str}:${m.port}`;

    if (screenshotData) {
      cacheSnapshot(id, screenshotData);
    }

    cameras.push({
      id,
      provider: "shodan",
      name,
      lat,
      lon,
      region: m.location?.city || m.location?.country_name || "Indonesia",
      headingDeg: hashHeadingDeg(id),
      fovDeg: 60,
      isOnline: true,
      category: m.opts?.screenshot?.label || "ip-camera",
    });
  }
  return cameras;
}

// ============================================================================
// DYNAMIC: Windy Webcams API v3 — global public webcams with snapshots
// ============================================================================
// Auth: X-WINDY-API-KEY header (server-side only). Free tier image URLs are
// token-secured with a 10-minute TTL — re-fetch on each call, cache 5 min.
// Attribution: "Webcams provided by windy.com".
// If WINDY_API_KEY is unset -> no-op (return []) so the layer works the moment
// the key is pasted into .env.local.

interface WindyWebcam {
  webcamId: string;
  status?: string;
  title?: string;
  lastUpdatedOn?: string;
  categories?: { id: string; name: string }[];
  images?: {
    current?: { icon?: string; preview?: string; thumbnail?: string };
    daylight?: { icon?: string; preview?: string; thumbnail?: string };
  };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
  };
  player?: { day?: string; live?: string };
  urls?: { detail?: string; edit?: string };
}

interface WindyResponse {
  total?: number;
  webcams?: WindyWebcam[];
}

// Indonesia + major global markets. The Windy API limits results to 50
// per request — batching multiple countries shares that 50 across all of
// them. To get full coverage we fetch one country at a time, 5 in parallel
// with a short delay between batches to avoid rate-limiting.
const WINDY_COUNTRIES = [
  "ID", "US", "GB", "JP", "AU", "KR", "TH", "SG", "MY", "IN",
  "DE", "FR", "ES", "IT", "MX", "BR", "CA",
];
const WINDY_BATCH_SIZE = 5;
const WINDY_BATCH_DELAY_MS = 300;

// In-memory cache of Windy cameras (5-min TTL, under the 10-min token TTL).
let windyCached: { cameras: CctvCamera[]; ts: number } | null = null;
const WINDY_CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchWindyCameras(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  const apiKey = process.env.WINDY_API_KEY;
  if (!apiKey) return [];

  if (windyCached && Date.now() - windyCached.ts < WINDY_CACHE_TTL_MS) {
    return windyCached.cameras;
  }

  // Fetch one country at a time so each gets the full 50-camera limit.
  const allWebcams: WindyWebcam[] = [];
  for (let i = 0; i < WINDY_COUNTRIES.length; i += WINDY_BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = WINDY_COUNTRIES.slice(i, i + WINDY_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (country) => {
        const url =
          "https://api.windy.com/webcams/api/v3/webcams" +
          `?countries=${country}` +
          "&include=categories,images,location,player,urls" +
          "&lang=en&limit=50";
        const res = await fetch(url, {
          signal,
          headers: {
            "X-WINDY-API-KEY": apiKey,
            "Accept": "application/json",
          },
        });
        if (res.status === 401 || res.status === 403) {
          console.warn(`[cctv] Windy ${res.status} — check WINDY_API_KEY`);
          return [];
        }
        if (!res.ok) throw new Error(`Windy API ${res.status}`);
        const body = (await res.json()) as WindyResponse;
        return body.webcams ?? [];
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") allWebcams.push(...r.value);
    }
    // Brief pause between batches to stay under rate limits.
    if (i + WINDY_BATCH_SIZE < WINDY_COUNTRIES.length) {
      await new Promise((r) => setTimeout(r, WINDY_BATCH_DELAY_MS));
    }
  }

  const cameras: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const w of allWebcams) {
    const lat = w.location?.latitude;
    const lon = w.location?.longitude;
    if (lat == null || lon == null) continue;

    const img =
      w.images?.current?.preview ||
      w.images?.daylight?.preview ||
      w.images?.current?.thumbnail ||
      w.images?.daylight?.thumbnail;
    if (!img) continue;

    const id = `windy-${w.webcamId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const region = w.location?.region || w.location?.country || "Unknown";

    cameras.push({
      id,
      provider: "windy",
      name: w.title || `Windy Webcam ${w.webcamId}`,
      lat,
      lon,
      region,
      headingDeg: hashHeadingDeg(id),
      fovDeg: 60,
      snapshotUrl: img,
      embedUrl: w.player?.day || w.urls?.detail,
      isOnline: w.status === "active",
      category: w.categories?.[0]?.name || "webcam",
    });
  }

  windyCached = { cameras, ts: Date.now() };
  return cameras;
}

// ============================================================================
// DYNAMIC: OpenTrafficCamMap (AidanWelch/OpenTrafficCamMap) — US state DOTs
// ============================================================================
// master branch: 10 states, 7,029 cams. Schema:
//   { state: { county: [{ description, latitude, longitude, direction, url,
//                         encoding, format }] } }
// `format: "IMAGE_STREAM"` entries are direct JPEG/MJPEG feeds usable as
// snapshotUrl. HLS .m3u8 -> streamUrl. Direction tags -> headingDeg.

interface OtcCam {
  description?: string;
  latitude?: number;
  longitude?: number;
  direction?: string;
  url?: string;
  encoding?: string;
  format?: string;
}

const OTC_URL = "https://raw.githubusercontent.com/AidanWelch/OpenTrafficCamMap/master/cameras/USA.json";

let otcCached: { cameras: CctvCamera[]; ts: number } | null = null;
const OTC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function fetchOtcCameras(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  if (otcCached && Date.now() - otcCached.ts < OTC_CACHE_TTL_MS) {
    return otcCached.cameras;
  }

  const res = await fetch(OTC_URL, {
    signal,
    headers: { "User-Agent": "spectre/0.1 (cctv monitor)" },
  });
  if (!res.ok) {
    throw new Error(`OTC API ${res.status}`);
  }
  const body = (await res.json()) as Record<string, Record<string, OtcCam[]>>;
  if (!body || typeof body !== "object") return [];

  const cameras: CctvCamera[] = [];
  for (const [state, counties] of Object.entries(body)) {
    if (!counties || typeof counties !== "object") continue;
    for (const [county, cams] of Object.entries(counties)) {
      if (!Array.isArray(cams)) continue;
      for (const c of cams) {
        if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;
        const id = `otc-${state}-${county}-${(c.description || c.url || "cam").slice(0, 32)}`;
        const isImage = (c.format ?? "").toUpperCase().includes("IMAGE_STREAM");
        const isHls = (c.url ?? "").includes(".m3u8") || (c.encoding ?? "").includes("H.264");
        cameras.push({
          id,
          provider: "otc",
          name: c.description || `${state} DOT Camera`,
          lat: c.latitude!,
          lon: c.longitude!,
          region: `${county}, ${state}`,
          headingDeg: osmDirectionToDegrees(c.direction) ?? hashHeadingDeg(id),
          fovDeg: 60,
          snapshotUrl: isImage ? c.url : undefined,
          streamUrl: isHls ? c.url : undefined,
          embedUrl: c.url,
          isOnline: true,
          category: c.format || "dot",
        });
      }
    }
  }

  otcCached = { cameras, ts: Date.now() };
  return cameras;
}

// ============================================================================
// DYNAMIC: Streetside Jakarta (streetside.mugnimaestra.dev) — DKI Jakarta gov CCTV
// ============================================================================
// 1,246 enabled cameras from the DKI Jakarta provincial government's public
// CCTV network. Clean JSON API, no auth. Images are signed URLs (~1h TTL).
// CC-BY 4.0 attribution: "Camera directory by Streetside Jakarta".

interface StreetsideCamera {
  id: number;
  content_type: string;
  cctv_name?: string;
  city_name?: string;
  address?: string | null;
  latitude?: number;
  longitude?: number;
  image1?: string;
  image2?: string;
  is_enabled?: boolean;
}

const STREETSIDE_URL = "https://streetside.mugnimaestra.dev/api/cameras";

let streetsideCached: { cameras: CctvCamera[]; ts: number } | null = null;
const STREETSIDE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min (tokens expire ~1h)

export async function fetchStreetsideCameras(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  if (streetsideCached && Date.now() - streetsideCached.ts < STREETSIDE_CACHE_TTL_MS) {
    return streetsideCached.cameras;
  }

  const res = await fetch(STREETSIDE_URL, {
    signal,
    headers: { "User-Agent": "spectre/0.1 (cctv monitor)" },
  });
  if (!res.ok) throw new Error(`Streetside API ${res.status}`);

  const body = (await res.json()) as { cameras?: StreetsideCamera[] };
  const list = body?.cameras;
  if (!Array.isArray(list)) return [];

  const BASE = "https://streetside.mugnimaestra.dev";
  const cameras: CctvCamera[] = list
    .filter((c) =>
      c.content_type === "cctv"
      && c.is_enabled !== false
      && Number.isFinite(c.latitude)
      && Number.isFinite(c.longitude)
      && c.image1,
    )
    .map((c): CctvCamera => {
      const id = `streetside-${c.id}`;
      return {
        id,
        provider: "streetside",
        name: c.cctv_name || `Jakarta Camera ${c.id}`,
        lat: c.latitude!,
        lon: c.longitude!,
        region: c.city_name || "Jakarta",
        headingDeg: hashHeadingDeg(id),
        fovDeg: 60,
        snapshotUrl: `${BASE}${c.image1}`,
        isOnline: true,
        category: "traffic",
      };
    });

  streetsideCached = { cameras, ts: Date.now() };
  return cameras;
}

// ============================================================================
// DYNAMIC: ATCS Indonesia — Bali government CCTV cameras
// ============================================================================
// Free public API from atcsindonesia.com aggregating provincial traffic cameras.
// Provides live streaming URLs from transcode.baliprov.go.id.

interface AtcsCamera {
  id: string;
  lat: number;
  lng: number;
  title: string;
  location: string;
  status: string;
  streamingUrl: string;
  source: string;
  region: string;
  province: string;
  sourceUrl: string;
}

interface AtcsResponse {
  status: string;
  data: AtcsCamera[];
}

let atcsCached: { cameras: CctvCamera[]; ts: number } | null = null;
const ATCS_CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchAtcsCameras(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  if (atcsCached && Date.now() - atcsCached.ts < ATCS_CACHE_TTL_MS) {
    return atcsCached.cameras;
  }

  try {
    const res = await fetch("https://atcsindonesia.com/api/cctv", {
      signal,
      headers: { Accept: "application/json", "User-Agent": "spectre/0.1" },
    });
    if (!res.ok) throw new Error(`ATCS ${res.status}`);
    const body = (await res.json()) as AtcsResponse;
    if (!body.data || !Array.isArray(body.data)) return [];

    const cameras: CctvCamera[] = [];
    for (const c of body.data) {
      if (c.lat == null || c.lng == null) continue;
      // Extract camera ID from streamingUrl to build direct HLS stream URL.
      // Player URL: https://transcode.baliprov.go.id/cctv-player.html?id={camId}
      // HLS stream: https://transcode.baliprov.go.id/cctv/{camId}/index.m3u8
      const streamId = c.streamingUrl?.match(/[?&]id=([^&]+)/)?.[1];
      const hlsUrl = streamId
        ? `https://transcode.baliprov.go.id/cctv/${streamId}/index.m3u8`
        : undefined;
      cameras.push({
        id: `atcs-${c.id}`,
        provider: "atcs",
        name: c.title || c.location || "ATCS Camera",
        lat: c.lat,
        lon: c.lng,
        region: c.region || c.province || "Indonesia",
        headingDeg: hashHeadingDeg(`atcs-${c.id}`),
        fovDeg: 60,
        streamUrl: hlsUrl,
        embedUrl: c.streamingUrl,
        isOnline: c.status === "live",
        category: c.source || "traffic",
      });
    }

    atcsCached = { cameras, ts: Date.now() };
    return cameras;
  } catch (err) {
    console.warn("[cctv] ATCS fetch failed:", err);
    return [];
  }
}

// ============================================================================
// TfL JamCams (London, UK) — free, no auth required
// Endpoint: https://api.tfl.gov.uk/Place/Type/JamCam
// Returns ~882 cameras with lat/lon, image URL (JPG), video URL (MP4), and
// a `view` field containing cardinal heading text (e.g. "West", "North").
// ============================================================================

interface TflJamCam {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
  url: string;
  view?: string;
  available?: boolean;
}

let tflCached: { cameras: CctvCamera[]; ts: number } | null = null;
const TFL_CACHE_TTL = 5 * 60 * 1000;

function parseCardinalToDeg(view?: string): number | undefined {
  if (!view) return undefined;
  const lower = view.toLowerCase();
  const cardinals: Record<string, number> = {
    north: 0, n: 0,
    northeast: 45, ne: 45,
    east: 90, e: 90,
    southeast: 135, se: 135,
    south: 180, s: 180,
    southwest: 225, sw: 225,
    west: 270, w: 270,
    northwest: 315, nw: 315,
  };
  for (const [word, deg] of Object.entries(cardinals)) {
    if (lower.includes(word)) return deg;
  }
  return undefined;
}

export async function fetchTflCameras(signal?: AbortSignal): Promise<CctvCamera[]> {
  if (tflCached && Date.now() - tflCached.ts < TFL_CACHE_TTL) {
    return tflCached.cameras;
  }

  try {
    const res = await fetch("https://api.tfl.gov.uk/Place/Type/JamCam", {
      signal,
      headers: { Accept: "application/json", "User-Agent": "spectre/0.1" },
    });
    if (!res.ok) throw new Error(`TfL ${res.status}`);
    const body = (await res.json()) as TflJamCam[];
    if (!Array.isArray(body)) return [];

    const cameras: CctvCamera[] = [];
    for (const c of body) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      if (c.available === false) continue;
      const isVideo = c.url?.endsWith(".mp4");
      const isImage = c.url?.endsWith(".jpg") || c.url?.endsWith(".jpeg");
      const heading = parseCardinalToDeg(c.view) ?? hashHeadingDeg(`tfl-${c.id}`);
      cameras.push({
        id: `tfl-${c.id}`,
        provider: "tfl",
        name: c.commonName || "TfL Camera",
        lat: c.lat,
        lon: c.lon,
        region: "London",
        headingDeg: heading,
        fovDeg: 60,
        snapshotUrl: isImage ? c.url : undefined,
        streamUrl: isVideo ? c.url : undefined,
        isOnline: Boolean(c.available),
        category: "traffic",
      });
    }

    tflCached = { cameras, ts: Date.now() };
    return cameras;
  } catch (err) {
    console.warn("[cctv] TfL fetch failed:", err);
    return [];
  }
}

// ============================================================================
// Caltrans CCTV (California, USA) — free, no auth required
// Endpoint pattern: https://cwwp2.dot.ca.gov/data/d{N}/cctv/cctv.d{NN}.xml
// Returns XML with <cctv> elements containing lat, lon, image_url, location.
// 12 districts covering all of California.
// ============================================================================

let caltransCached: { cameras: CctvCamera[]; ts: number } | null = null;
const CALTRANS_CACHE_TTL = 5 * 60 * 1000;
const CALTRANS_DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface CaltransCctv {
  cctv_id?: string;
  lat?: string;
  lon?: string;
  location?: string;
  image_url?: string;
  view?: string;
}

function parseCaltransXml(xml: string): CaltransCctv[] {
  const out: CaltransCctv[] = [];
  const cctvRegex = /<cctv[\s\S]*?<\/cctv>/g;
  let match: RegExpExecArray | null;
  while ((match = cctvRegex.exec(xml)) !== null) {
    const block = match[0];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, "i"));
      return m ? m[1].trim() : undefined;
    };
    out.push({
      cctv_id: get("cctv_id"),
      lat: get("lat"),
      lon: get("lon"),
      location: get("location"),
      image_url: get("image_url"),
      view: get("view"),
    });
  }
  return out;
}

export async function fetchCaltransCameras(signal?: AbortSignal): Promise<CctvCamera[]> {
  if (caltransCached && Date.now() - caltransCached.ts < CALTRANS_CACHE_TTL) {
    return caltransCached.cameras;
  }

  const cameras: CctvCamera[] = [];
  const districtFetches = CALTRANS_DISTRICTS.map(async (d) => {
    const padded = String(d).padStart(2, "0");
    const url = `https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctv.d${padded}.xml`;
    try {
      const res = await fetch(url, {
        signal,
        headers: { Accept: "application/xml", "User-Agent": "spectre/0.1" },
      });
      if (!res.ok) return;
      const xml = await res.text();
      const parsed = parseCaltransXml(xml);
      for (const c of parsed) {
        const lat = Number(c.lat);
        const lon = Number(c.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const id = c.cctv_id || `caltrans-d${d}-${cameras.length}`;
        const heading = parseCardinalToDeg(c.view) ?? hashHeadingDeg(`caltrans-${id}`);
        cameras.push({
          id: `caltrans-${id}`,
          provider: "caltrans",
          name: c.location || `Caltrans D${d}`,
          lat,
          lon,
          region: `California D${d}`,
          headingDeg: heading,
          fovDeg: 60,
          snapshotUrl: c.image_url,
          isOnline: true,
          category: "traffic",
        });
      }
    } catch (err) {
      console.warn(`[cctv] Caltrans D${d} fetch failed:`, err);
    }
  });

  await Promise.allSettled(districtFetches);
  caltransCached = { cameras, ts: Date.now() };
  return cameras;
}

// ============================================================================
// 511NY (NYC + NY State, USA) — free, requires API key registration
// Endpoint: https://511ny.org/api/getcameras?key={KEY}&format=JSON
// Returns ~1000+ cameras with lat/lon, image URL, name.
// ============================================================================

let ny511Cached: { cameras: CctvCamera[]; ts: number } | null = null;
const NY511_CACHE_TTL = 5 * 60 * 1000;

export async function fetch511NyCameras(signal?: AbortSignal): Promise<CctvCamera[]> {
  const apiKey = process.env.NY511_API_KEY;
  if (!apiKey) return [];

  if (ny511Cached && Date.now() - ny511Cached.ts < NY511_CACHE_TTL) {
    return ny511Cached.cameras;
  }

  try {
    const res = await fetch(
      `https://511ny.org/api/getcameras?key=${apiKey}&format=JSON`,
      { signal, headers: { Accept: "application/json", "User-Agent": "spectre/0.1" } },
    );
    if (!res.ok) throw new Error(`511NY ${res.status}`);
    const body = (await res.json()) as Array<{
      id?: string;
      Name?: string;
      Lat?: string | number;
      Lon?: string | number;
      ImageUrl?: string;
      Location?: string;
    }>;
    if (!Array.isArray(body)) return [];

    const cameras: CctvCamera[] = [];
    for (const c of body) {
      const lat = Number(c.Lat);
      const lon = Number(c.Lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = c.id || `511ny-${cameras.length}`;
      cameras.push({
        id: `511ny-${id}`,
        provider: "511ny",
        name: c.Name || c.Location || "511NY Camera",
        lat,
        lon,
        region: "New York",
        headingDeg: hashHeadingDeg(`511ny-${id}`),
        fovDeg: 60,
        snapshotUrl: c.ImageUrl,
        isOnline: true,
        category: "traffic",
      });
    }

    ny511Cached = { cameras, ts: Date.now() };
    return cameras;
  } catch (err) {
    console.warn("[cctv] 511NY fetch failed:", err);
    return [];
  }
}

// ============================================================================
// LTA DataMall Traffic Images (Singapore) — free, requires API key
// Endpoint: http://datamall.mytransport.sg/ltaodataservice.svc/TrafficImagesv2
// Header: AccountKey. Returns ~100 cameras with lat/lon, image link.
// ============================================================================

let ltaCached: { cameras: CctvCamera[]; ts: number } | null = null;
const LTA_CACHE_TTL = 5 * 60 * 1000;

export async function fetchLtaCameras(signal?: AbortSignal): Promise<CctvCamera[]> {
  const apiKey = process.env.LTA_API_KEY;
  if (!apiKey) return [];

  if (ltaCached && Date.now() - ltaCached.ts < LTA_CACHE_TTL) {
    return ltaCached.cameras;
  }

  try {
    const res = await fetch(
      "http://datamall.mytransport.sg/ltaodataservice.svc/TrafficImagesv2",
      { signal, headers: { Accept: "application/json", AccountKey: apiKey, "User-Agent": "spectre/0.1" } },
    );
    if (!res.ok) throw new Error(`LTA ${res.status}`);
    const body = (await res.json()) as { value?: Array<{
      CameraID?: string;
      Latitude?: string | number;
      Longitude?: string | number;
      ImageLink?: string;
    }> };
    const items = body.value || [];
    if (!Array.isArray(items)) return [];

    const cameras: CctvCamera[] = [];
    for (const c of items) {
      const lat = Number(c.Latitude);
      const lon = Number(c.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = c.CameraID || `lta-${cameras.length}`;
      cameras.push({
        id: `lta-${id}`,
        provider: "lta",
        name: `LTA ${id}`,
        lat,
        lon,
        region: "Singapore",
        headingDeg: hashHeadingDeg(`lta-${id}`),
        fovDeg: 60,
        snapshotUrl: c.ImageLink,
        isOnline: true,
        category: "traffic",
      });
    }

    ltaCached = { cameras, ts: Date.now() };
    return cameras;
  } catch (err) {
    console.warn("[cctv] LTA fetch failed:", err);
    return [];
  }
}

// ============================================================================
// Transport for NSW Live Traffic Cameras (Sydney + NSW, Australia) — free, requires API key
// Endpoint: https://api.transport.nsw.gov.au/v1/live/cameras
// Header: Authorization: Bearer KEY. Returns GeoJSON with ~200 cameras.
// ============================================================================

let tfnswCached: { cameras: CctvCamera[]; ts: number } | null = null;
const TFNSW_CACHE_TTL = 5 * 60 * 1000;

export async function fetchTfnswCameras(signal?: AbortSignal): Promise<CctvCamera[]> {
  const apiKey = process.env.TFNSW_API_KEY;
  if (!apiKey) return [];

  if (tfnswCached && Date.now() - tfnswCached.ts < TFNSW_CACHE_TTL) {
    return tfnswCached.cameras;
  }

  try {
    const res = await fetch("https://api.transport.nsw.gov.au/v1/live/cameras", {
      signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "User-Agent": "spectre/0.1" },
    });
    if (!res.ok) throw new Error(`TfNSW ${res.status}`);
    const body = (await res.json()) as {
      features?: Array<{
        properties?: { id?: string; name?: string; view?: string; image_url?: string; href?: string };
        geometry?: { coordinates?: [number, number] };
      }>;
    };
    const features = body.features || [];
    if (!Array.isArray(features)) return [];

    const cameras: CctvCamera[] = [];
    for (const f of features) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const props = f.properties || {};
      const id = props.id || `tfnsw-${cameras.length}`;
      const heading = parseCardinalToDeg(props.view) ?? hashHeadingDeg(`tfnsw-${id}`);
      cameras.push({
        id: `tfnsw-${id}`,
        provider: "tfnsw",
        name: props.name || "TfNSW Camera",
        lat,
        lon,
        region: "NSW",
        headingDeg: heading,
        fovDeg: 60,
        snapshotUrl: props.image_url || props.href,
        isOnline: true,
        category: "traffic",
      });
    }

    tfnswCached = { cameras, ts: Date.now() };
    return cameras;
  } catch (err) {
    console.warn("[cctv] TfNSW fetch failed:", err);
    return [];
  }
}

// ============================================================================
// Combined accessor with 30-minute cache + sensitive-camera fuzzing
// ============================================================================

let cached: { cameras: CctvCamera[]; ts: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min - cameras don't move

export async function listCamerasAsync(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.cameras.map(fuzzSensitive);
  }

  // Stale-while-revalidate: if we have stale cache, return it immediately
  // and refresh in the background. This makes the CCTV panel feel instant
  // on return visits.
  const staleCache = cached && cached.cameras.length > 0 ? cached : null;
  if (staleCache) {
    // Fire background refresh (detached from this request)
    listCamerasAsyncBackground().catch(() => {});
    return staleCache.cameras.map(fuzzSensitive);
  }

  // No cache at all - must wait for first fetch
  const cameras = await listCamerasAsyncBackground(signal);
  return cameras;
}

async function listCamerasAsyncBackground(
  signal?: AbortSignal,
): Promise<CctvCamera[]> {
  // Fetch all sources in parallel — best effort, no source failure breaks the
  // overall response (401/403 no-ops handled inside each fetcher).
  const results = await Promise.allSettled([
    fetchPalembangCctv(signal),
    fetchOsmCameras(signal),
    fetchShodanCameras(signal),
    fetchWindyCameras(signal),
    fetchOtcCameras(signal),
    fetchStreetsideCameras(signal),
    fetchAtcsCameras(signal),
    fetchTflCameras(signal),
    fetchCaltransCameras(signal),
    fetch511NyCameras(signal),
    fetchLtaCameras(signal),
    fetchTfnswCameras(signal),
  ]);

  const dynamic: CctvCamera[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") dynamic.push(...r.value);
  }

  const all = [...CCTV_CAMERAS, ...dynamic];
  cached = { cameras: all, ts: Date.now() };
  return applyCorrections(all.map(fuzzSensitive));
}

// Synchronous accessor for the static catalog only — kept for backwards
// compatibility with callers that only need the static subset.
export function listCameras(): CctvCamera[] {
  return CCTV_CAMERAS.map(fuzzSensitive);
}

function fuzzSensitive(c: CctvCamera): CctvCamera {
  if (!c.isSensitive) return c;
  const fuzz = (Math.random() - 0.5) * 0.02; // ~2km
  return { ...c, lat: c.lat + fuzz, lon: c.lon + fuzz, name: "[redacted]" };
}
