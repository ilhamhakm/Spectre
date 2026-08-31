/**
 * Pure tile math + budget accounting for the TomTom traffic-flow proxy.
 *
 * Ported faithfully from GEV's src/data/tomtomTiles.js. Shared by the
 * /api/tomtom server route (server-side: coordinate validation, daily budget
 * governor) and the client flow-tiles module (which tiles cover the current
 * traffic fetch bounds). Zero dependencies, Cesium-free.
 *
 * Slippy scheme: standard Web Mercator XYZ, y grows southward - the scheme
 * TomTom's traffic/map/4/tile/flow endpoints use.
 */

/** Min supported TomTom flow-tile zoom (proxy validation). */
export const MIN_TILE_ZOOM = 8;
/** Max supported TomTom flow-tile zoom (proxy validation). */
export const MAX_TILE_ZOOM = 16;
/** Web Mercator latitude limit (degrees). */
const MERCATOR_LAT_LIMIT = 85.05112878;

/** Geographic bounding box in degrees. */
export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Slippy tile coordinate. */
export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/**
 * Validate a z/x/y tile coordinate for the TomTom flow proxy.
 * @returns True when the coordinate is a fetchable tile.
 */
export function isValidTileCoord(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < MIN_TILE_ZOOM || z > MAX_TILE_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/**
 * Convert a lon/lat (degrees) to the containing slippy tile at zoom `z`.
 * Latitude is clamped to the Web Mercator limit; results are clamped into
 * [0, 2^z - 1] so antimeridian/pole inputs stay valid.
 */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-MERCATOR_LAT_LIMIT, Math.min(MERCATOR_LAT_LIMIT, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

/**
 * Compute the geographic bounding box of a slippy tile.
 */
export function tileToBBox(z: number, x: number, y: number): BBox {
  const n = 2 ** z;
  const lonAt = (col: number): number => (col / n) * 360 - 180;
  const latAt = (row: number): number =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return {
    west: lonAt(x),
    east: lonAt(x + 1),
    north: latAt(y),
    south: latAt(y + 1),
  };
}

/**
 * List the tiles covering a lat/lon bounding box at the given zoom.
 *
 * Traffic fetch bounds are clamped to a 0.05 deg span, so this is 1-4 tiles at
 * the default z12 in practice; `maxTiles` is a defensive truncation cap for
 * malformed/oversized inputs (row-major from the northwest corner).
 */
export function tilesForBounds(
  bounds: BBox | null | undefined,
  zoom = 12,
  { maxTiles = 64 }: { maxTiles?: number } = {},
): TileCoord[] {
  if (!bounds) return [];
  const { south, west, north, east } = bounds;
  if (![south, west, north, east].every(Number.isFinite)) return [];
  // Northwest corner has the min x and min y (y grows southward).
  const nw = lonLatToTile(Math.min(west, east), Math.max(south, north), zoom);
  const se = lonLatToTile(Math.max(west, east), Math.min(south, north), zoom);
  const tiles: TileCoord[] = [];
  for (let y = nw.y; y <= se.y; y++) {
    for (let x = nw.x; x <= se.x; x++) {
      if (tiles.length >= maxTiles) return tiles;
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

// ─── Daily budget accounting ───────────────────────────────

/** Persistent daily budget counter state. */
export interface BudgetState {
  date: string;
  count: number;
}

/** UTC calendar-day key for budget bucketing. */
export function utcDayKey(epochMs = Date.now()): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Normalize a persisted budget state against today's UTC day key.
 * Rolls the counter to zero on day change; replaces missing/corrupt state.
 * Returns the SAME object when it is already valid for `dayKey`.
 */
export function normalizeBudget(
  state: BudgetState | null | undefined,
  dayKey: string,
): BudgetState {
  const valid =
    Boolean(state) &&
    (state as BudgetState).date === dayKey &&
    Number.isFinite((state as BudgetState).count) &&
    (state as BudgetState).count >= 0;
  return valid ? (state as BudgetState) : { date: dayKey, count: 0 };
}

/**
 * Whether the daily soft cap has been reached.
 */
export function isOverBudget(state: { count: number }, limit: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return state.count >= limit;
}
