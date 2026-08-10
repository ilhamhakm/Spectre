// OpenStreetMap Overpass API client — main roads for Indonesia.
// Free, no key. Endpoint: https://overpass-api.de/api/interpreter
//
// We fetch main roads (motorway, trunk, primary, secondary) within a bounding
// box around the camera target. Smaller roads (tertiary, residential) can be
// toggled on later.
//
// Rate limits: 2 concurrent requests, ~10,000 requests/day. Be polite — cache
// aggressively, only re-fetch when the camera moves significantly.

export type RoadClass = "motorway" | "trunk" | "primary" | "secondary" | "tertiary";

export interface RoadSegment {
  id: number;
  name: string;
  ref: string;
  class: RoadClass;
  coordinates: { lon: number; lat: number }[];
}

export interface RoadFetchResult {
  roads: RoadSegment[];
  bbox: { south: number; west: number; north: number; east: number };
  ts: number;
}

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const CLASS_TO_LAYER: Record<RoadClass, number> = {
  motorway: 0,
  trunk: 1,
  primary: 2,
  secondary: 3,
  tertiary: 4,
};

export interface RoadFetchOptions {
  south: number;
  west: number;
  north: number;
  east: number;
  // LOD level controls which road classes are fetched:
  //   1 = motorway + trunk only (high altitude, far view)
  //   2 = + primary (medium altitude, city arteries like Sudirman/Kuningan)
  //   3 = + secondary + tertiary (low altitude, neighborhood streets)
  level?: 1 | 2 | 3;
  // Legacy flag — kept for backwards compat with /api/roads callers.
  // When true, behaves like level=3.
  includeTertiary?: boolean;
  signal?: AbortSignal;
}

function classesForLevel(level: 1 | 2 | 3, includeTertiary?: boolean): RoadClass[] {
  // All levels include motorway + trunk so highways never vanish when
  // zooming in. Each level adds finer classes progressively.
  // Level 1 (high altitude): motorway + trunk + primary
  // Level 2 (mid altitude): motorway + trunk + primary + secondary
  // Level 3 (low altitude): + tertiary (neighborhood streets)
  if (includeTertiary || level === 3) return ["motorway", "trunk", "primary", "secondary", "tertiary"];
  if (level === 1) return ["motorway", "trunk", "primary"];
  return ["motorway", "trunk", "primary", "secondary"];
}

function buildOverpassQuery(opts: RoadFetchOptions): string {
  const { south, west, north, east } = opts;
  const classes = classesForLevel(opts.level ?? 2, opts.includeTertiary);

  const parts = classes
    .map(
      (c) =>
        `way["highway"="${c}"](${south},${west},${north},${east});`,
    )
    .join("");

  return `[out:json][timeout:25];(${parts});out geom;`;
}

export async function fetchRoads(
  opts: RoadFetchOptions,
): Promise<RoadFetchResult> {
  const query = buildOverpassQuery(opts);
  const body = `data=${encodeURIComponent(query)}`;

  let lastErr: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "spectre/0.1 (osint monitor)",
        },
        body,
        signal: opts.signal,
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${endpoint} ${res.status}`);
        continue;
      }
      const data = await res.json();
      const roads = parseOverpassResponse(data);
      // Some endpoints return 200 OK with zero elements when rate-limited
      // (silent rate-limit). If we got zero roads, try the next endpoint
      // before giving up — only return empty if ALL endpoints are empty.
      if (roads.length === 0) {
        lastErr = new Error(`Overpass ${endpoint} returned 0 elements (rate-limited?)`);
        continue;
      }
      return {
        roads,
        bbox: { south: opts.south, west: opts.west, north: opts.north, east: opts.east },
        ts: Date.now(),
      };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr ?? new Error("All Overpass endpoints failed");
}

function parseOverpassResponse(data: any): RoadSegment[] {
  if (!data || !Array.isArray(data.elements)) return [];
  const out: RoadSegment[] = [];
  for (const el of data.elements) {
    if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
    const tags = el.tags ?? {};
    const highway = tags["highway"] as RoadClass | undefined;
    if (!highway) continue;
    const coordinates = el.geometry
      .filter((g: any) => typeof g.lat === "number" && typeof g.lon === "number")
      .map((g: any) => ({ lat: g.lat, lon: g.lon }));
    if (coordinates.length < 2) continue;
    out.push({
      id: el.id,
      name: tags["name"] ?? "",
      ref: tags["ref"] ?? "",
      class: highway,
      coordinates,
    });
  }
  return out;
}

export { CLASS_TO_LAYER };
