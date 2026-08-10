// Traffic simulation source — "real data + simulated congestion".
//
// Reuses OSM road geometry (from ./overpass.fetchRoads) and computes a
// per-segment congestion value (0.0 = free flow, 1.0 = gridlocked) from:
//   - real road class (motorway/trunk/primary/secondary)
//   - real time-of-day (server local time, 24h cycle with AM/PM rush peaks)
//   - deterministic perlin-style noise seeded by road ID (so the same road
//     looks the same on each visit; no flicker between polls)
//
// Also spawns vehicle "seeds" — one per ~1 km of road length — each with:
//   - roadId        which road it travels on
//   - t             position along road (0..1)
//   - speed         m/s derived from road class × (1 - congestion)
//
// The CLIENT (traffic-layer.ts) animates these seeds along the road
// polylines every frame — the server only ships a snapshot per poll.
//
// No API key, no rate limit beyond Overpass (which is already used by
// roads-layer). Caching is handled at the API route layer (60s TTL).

import { fetchRoads, type RoadClass, type RoadSegment } from "./overpass";

export interface VehicleSeed {
  roadId: number;
  // Initial parametric position along the road polyline (0..1).
  t: number;
  // Speed in m/s — already discounted by congestion.
  speed: number;
}

export interface TrafficFetchResult {
  vehicles: VehicleSeed[];
  // Map of roadId -> congestion (0..1). Consumed by roads-layer.setCongestion()
  // to recolor the polylines green/yellow/red.
  congestions: Record<number, number>;
  // Roads echoed back so the client can sync its traffic-layer road cache
  // without an extra /api/roads call.
  roads: RoadSegment[];
  bbox: { south: number; west: number; north: number; east: number };
  ts: number;
}

export interface TrafficFetchOptions {
  south: number;
  west: number;
  north: number;
  east: number;
  // LOD level — see overpass.ts. Defaults to 2 (motorway+trunk+primary).
  level?: 1 | 2 | 3;
  // Server-side abort (passed through to fetchRoads).
  signal?: AbortSignal;
}

// --- Road-class tuning ----------------------------------------------------

// Multiplier applied to "base" congestion per road class. Motorways flow
// better even when busy; secondary roads jam faster.
const CLASS_CONGESTION_FACTOR: Record<RoadClass, number> = {
  motorway: 0.65,
  trunk: 0.75,
  primary: 0.85,
  secondary: 1.0,
  tertiary: 1.0,
};

// Free-flow speed (m/s) per road class. Used to derive vehicle speed after
// applying congestion: speed = freeFlow × (1 - 0.85 × congestion).
const CLASS_FREEFLOW_SPEED: Record<RoadClass, number> = {
  motorway: 30, // ~108 km/h
  trunk: 25,
  primary: 18,
  secondary: 13,
  tertiary: 11,
};

// --- Time-of-day curve ----------------------------------------------------

// Returns a multiplier 0..1 representing how "busy" the roads are at the
// given hour (0-23, server local time). Two peaks: AM rush 7-9, PM rush 17-19.
function timeOfDayFactor(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60;
  // Smooth bell curve centered at hour h0, width w.
  const bell = (h0: number, w: number, peak: number) => {
    const d = Math.min(Math.abs(h - h0), 24 - Math.abs(h - h0));
    return peak * Math.exp(-((d / w) ** 2));
  };
  const am = bell(8.0, 1.5, 0.85); // AM peak ~8am
  const pm = bell(18.0, 1.7, 0.95); // PM peak ~6pm
  const night = h >= 1 && h <= 5 ? 0.08 : 0.18; // graveyard baseline
  return Math.min(1, Math.max(night, am + pm));
}

// --- Deterministic per-segment noise --------------------------------------

// Mulberry32 PRNG — deterministic from a uint32 seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash road ID → uint32 seed.
function roadSeed(roadId: number): number {
  return (roadId * 2654435761) >>> 0;
}

// Value-noise-ish: smooth [0..1) output from a seed + offset.
function noise1D(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = mulberry32(seed + i)();
  const b = mulberry32(seed + i + 1)();
  const t = f * f * (3 - 2 * f); // smoothstep
  return a + (b - a) * t;
}

// --- Geometry helpers -----------------------------------------------------

const EARTH_R = 6378137; // meters
const DEG = Math.PI / 180;

// Haversine distance (meters) between two lat/lon points.
function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// Total length (meters) of a road polyline.
function roadLength(coords: { lat: number; lon: number }[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(
      coords[i - 1].lat,
      coords[i - 1].lon,
      coords[i].lat,
      coords[i].lon,
    );
  }
  return total;
}

// --- Main fetcher ---------------------------------------------------------

export async function fetchTraffic(
  opts: TrafficFetchOptions,
): Promise<TrafficFetchResult> {
  // Reuse the OSM Overpass fetcher. This already has its own caching at
  // the network layer via Overpass endpoints; we add a 60s in-memory
  // cache in the API route above this.
  const roadResult = await fetchRoads({
    south: opts.south,
    west: opts.west,
    north: opts.north,
    east: opts.east,
    level: opts.level,
    signal: opts.signal,
  });

  const now = new Date();
  const tFactor = timeOfDayFactor(now);

  const vehicles: VehicleSeed[] = [];
  const congestions: Record<number, number> = {};

  // Pre-compute per-road metadata so we can sample if total exceeds cap.
  // Vehicle dots are not rendered — only congestion colors on road polylines.
  // Setting MAX_VEHICLES to 0 skips vehicle generation entirely.
  const MAX_VEHICLES = 0;
  const MAX_ROADS = 3000;

  // Vehicle density per road class — denser on city arteries (primary)
  // than on highways (motorway), since city streets have slower traffic
  // and shorter headways.
  const VEHICLE_SPACING_M: Record<RoadClass, number> = {
    motorway: 500, // 1 vehicle per 500m on highways
    trunk: 400,
    primary: 200, // 1 vehicle per 200m on city arteries (Sudirman, Kuningan)
    secondary: 250,
    tertiary: 300,
  };

  const roadMeta: {
    road: RoadSegment;
    seed: number;
    len: number;
    congestion: number;
    speed: number;
    spacing: number;
  }[] = [];

  for (const road of roadResult.roads) {
    if (road.coordinates.length < 2) continue;

    const seed = roadSeed(road.id);
    const noise = noise1D(seed, now.getHours() + now.getMinutes() / 60);
    const base =
      tFactor * (CLASS_CONGESTION_FACTOR[road.class] ?? 1.0) * (0.55 + 0.45 * noise);
    const congestion = Math.max(0, Math.min(1, base));
    congestions[road.id] = congestion;

    const len = roadLength(road.coordinates);
    const freeFlow = CLASS_FREEFLOW_SPEED[road.class] ?? 12;
    const speed = freeFlow * (1 - 0.85 * congestion);
    const spacing = VEHICLE_SPACING_M[road.class] ?? 300;
    roadMeta.push({ road, seed, len, congestion, speed, spacing });
  }

  // Sort by length (longest first) so main highways appear before smaller roads.
  // Boost primary roads since they're the city arteries the user cares about.
  roadMeta.sort((a, b) => {
    const aPriority = a.road.class === "primary" ? a.len * 2 : a.len;
    const bPriority = b.road.class === "primary" ? b.len * 2 : b.len;
    return bPriority - aPriority;
  });

  // Cap road count to keep Overpass queries fast and rendering light.
  const cappedRoads = roadMeta.slice(0, MAX_ROADS);

  return {
    vehicles,
    congestions,
    roads: cappedRoads.map((m) => m.road),
    bbox: roadResult.bbox,
    ts: Date.now(),
  };
}
