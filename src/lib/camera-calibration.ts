// Camera heading calibration by snapping to the nearest OSM road.
//
// Most traffic cameras point along the road they monitor. By finding the
// nearest road segment to a camera and computing the bearing of that segment
// at the closest point, we get a much better heading estimate than the
// deterministic hash fallback.
//
// Manual overrides (per-camera) are stored in localStorage and take
// precedence over both the road-snap and the hash fallback.

import type { RoadSegment } from "@/lib/sources/overpass";

const OVERRIDES_KEY = "spectre:cctv-heading-overrides";
const FOV_OVERRIDES_KEY = "spectre:cctv-fov-overrides";

export interface HeadingOverride {
  headingDeg: number;
  fovDeg?: number;
  ts: number;
}

export function loadHeadingOverrides(): Record<string, HeadingOverride> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, HeadingOverride>;
  } catch {
    return {};
  }
}

export function saveHeadingOverride(cameraId: string, headingDeg: number, fovDeg?: number): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadHeadingOverrides();
    all[cameraId] = { headingDeg, fovDeg, ts: Date.now() };
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
  } catch {
    // localStorage may be unavailable (private mode)
  }
}

export function clearHeadingOverride(cameraId: string): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadHeadingOverrides();
    delete all[cameraId];
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function loadFovOverrides(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FOV_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

export function saveFovOverride(cameraId: string, fovDeg: number): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadFovOverrides();
    all[cameraId] = fovDeg;
    window.localStorage.setItem(FOV_OVERRIDES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

// Haversine distance in meters between two lat/lon points.
function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Initial bearing (forward azimuth) from point 1 to point 2, in degrees
// clockwise from north (0-360).
function bearingDeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lambda1 = toRad(lon1);
  const lambda2 = toRad(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface SnapResult {
  headingDeg: number;
  distance: number;
  roadName?: string;
  snapLat?: number;
  snapLon?: number;
}

// Project point P onto segment AB and return the closest point's lat/lon.
// Uses equirectangular approximation (fine for short segments < 1km).
function closestPointOnSegment(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): { lat: number; lon: number } {
  // Convert to local meters relative to point A
  const lat0 = (aLat + bLat) / 2;
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ax = 0, ay = 0;
  const bx = (bLon - aLon) * mLon;
  const by = (bLat - aLat) * mLat;
  const px = (pLon - aLon) * mLon;
  const py = (pLat - aLat) * mLat;
  const dx = bx - ax;
  const dy = by - ay;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq === 0) return { lat: aLat, lon: aLon };
  let t = ((px - ax) * dx + (py - ay) * dy) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return {
    lat: aLat + projY / mLat,
    lon: aLon + projX / mLon,
  };
}

// Find the nearest road segment to a camera and return the bearing of that
// segment at the closest point. Returns null if no road is within maxDistanceM.
// Uses a quick bbox pre-filter to skip roads that are clearly too far away.
export function snapToNearestRoad(
  camLat: number,
  camLon: number,
  roads: RoadSegment[],
  maxDistanceM = 50,
): SnapResult | null {
  let best: SnapResult | null = null;

  // Pre-compute a rough lat/lon bounding box for the max distance.
  // 1 degree of latitude is ~111km, so 50m ≈ 0.00045°.
  const maxDistDeg = maxDistanceM / 111_000;
  const minLat = camLat - maxDistDeg;
  const maxLat = camLat + maxDistDeg;
  const minLon = camLon - maxDistDeg;
  const maxLon = camLon + maxDistDeg;

  for (const road of roads) {
    const coords = road.coordinates;
    if (coords.length < 2) continue;

    // Quick bounding-box check: skip roads whose first point is far away.
    // This is a coarse filter; the haversine check below is the real test.
    let inBbox = false;
    for (const c of coords) {
      if (c.lat >= minLat && c.lat <= maxLat && c.lon >= minLon && c.lon <= maxLon) {
        inBbox = true;
        break;
      }
    }
    if (!inBbox) continue;

    let bestDist = Infinity;
    let bestBearing = 0;
    let bestSnapLat = camLat;
    let bestSnapLon = camLon;

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      // Project camera onto this segment for accurate distance + snap point
      const proj = closestPointOnSegment(camLat, camLon, a.lat, a.lon, b.lat, b.lon);
      const dist = haversineMeters(camLat, camLon, proj.lat, proj.lon);
      if (dist < bestDist) {
        bestDist = dist;
        bestBearing = bearingDeg(a.lat, a.lon, b.lat, b.lon);
        bestSnapLat = proj.lat;
        bestSnapLon = proj.lon;
      }
    }

    if (bestDist < maxDistanceM && (best === null || bestDist < best.distance)) {
      best = {
        headingDeg: bestBearing,
        distance: bestDist,
        roadName: road.name || road.ref || undefined,
        snapLat: bestSnapLat,
        snapLon: bestSnapLon,
      };
    }
  }

  return best;
}
