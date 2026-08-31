/**
 * Pure geometry helpers for the traffic layer's viewport fetch bounds.
 *
 * Ported faithfully from GEV's src/data/trafficBounds.js. Cesium-free so it can
 * be unit-tested in isolation.
 *
 * C4 fix: `camera.computeViewRectangle()` spans toward the horizon at oblique
 * pitch, and centering the fetch box on the RECTANGLE MIDPOINT put road fetches
 * tens of km from what the user is actually looking at. The fetch center is
 * now derived from the camera's look-at ground point, falling back to the
 * camera nadir, and pulled back toward nadir when the look-at point is beyond
 * a horizon-gaze cap.
 */

/** Mean Earth radius in km (spherical approximation). */
const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance between two lat/lon points (haversine), in km. */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (radians) from point 1 toward point 2 along the great circle. */
function initialBearingRad(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.atan2(y, x);
}

/** Destination point given a start, an initial bearing, and a distance (spherical direct geodesic). */
function destinationPoint(
  lat: number,
  lon: number,
  bearingRad: number,
  distKm: number,
): { lat: number; lon: number } {
  const delta = distKm / EARTH_RADIUS_KM;
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(delta) + Math.cos(p1) * Math.sin(delta) * Math.cos(bearingRad),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(delta) * Math.cos(p1),
      Math.cos(delta) - Math.sin(p1) * Math.sin(p2),
    );
  // Normalize longitude to [-180, 180)
  const lonDeg = ((toDeg(l2) + 540) % 360) - 180;
  return { lat: toDeg(p2), lon: lonDeg };
}

/** Geographic bounding box in degrees. */
export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface FetchCenter {
  lat: number;
  lon: number;
  source: "hit" | "nadir" | "pulled";
}

interface DeriveFetchCenterArgs {
  nadirLat: number;
  nadirLon: number;
  hitLat?: number;
  hitLon?: number;
  maxPullKm?: number;
}

/**
 * Derive the road-fetch center from the camera's look-at ground point.
 *
 * Rules:
 *  - No usable hit (pickEllipsoid returned undefined -> non-finite hit coords):
 *    fall back to the camera nadir.
 *  - Hit within `maxPullKm` of nadir: use the hit verbatim (normal oblique view).
 *  - Hit farther than `maxPullKm` (horizon gaze): pull it back toward nadir to
 *    exactly `maxPullKm` along the nadir->hit great-circle bearing.
 */
export function deriveFetchCenter({
  nadirLat,
  nadirLon,
  hitLat,
  hitLon,
  maxPullKm = 12,
}: DeriveFetchCenterArgs): FetchCenter {
  if (typeof hitLat !== "number" || typeof hitLon !== "number" || !Number.isFinite(hitLat) || !Number.isFinite(hitLon)) {
    return { lat: nadirLat, lon: nadirLon, source: "nadir" };
  }
  const distKm = greatCircleKm(nadirLat, nadirLon, hitLat, hitLon);
  if (distKm <= maxPullKm) {
    return { lat: hitLat, lon: hitLon, source: "hit" };
  }
  const bearing = initialBearingRad(nadirLat, nadirLon, hitLat, hitLon);
  const pulled = destinationPoint(nadirLat, nadirLon, bearing, maxPullKm);
  return { lat: pulled.lat, lon: pulled.lon, source: "pulled" };
}

/**
 * Clamp a bounding box's spans to `maxSpanDeg` and recenter it on `center`.
 *
 * Preserves the pre-C4 span semantics (each axis capped at 0.05 deg ~ 5.5 km)
 * but centers the box on the derived look-at point instead of the view
 * rectangle's midpoint. Idempotent when `center` is the box's own midpoint.
 */
export function clampBoundsAroundCenter(
  bounds: Bounds,
  center: { lat: number; lon: number },
  maxSpanDeg = 0.05,
): Bounds {
  const latSpan = Math.min(bounds.north - bounds.south, maxSpanDeg);
  const lonSpan = Math.min(bounds.east - bounds.west, maxSpanDeg);
  return {
    south: center.lat - latSpan / 2,
    north: center.lat + latSpan / 2,
    west: center.lon - lonSpan / 2,
    east: center.lon + lonSpan / 2,
  };
}
