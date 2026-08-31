/**
 * TomTom traffic-flow vector-tile client: fetch + MVT decode.
 *
 * Ported faithfully from GEV's src/data/flowTiles.js. Fetches flow tiles from
 * the local `/api/tomtom/flow/{z}/{x}/{y}.pbf` proxy (the TomTom key never
 * reaches the browser) and decodes the Mapbox Vector Tile layer "Traffic flow"
 * into plain lon/lat polylines with congestion attributes. Consumed by the
 * traffic layer's live mode (flow-match.ts).
 *
 * Segment shape: {coords, trafficLevel, roadType, closure} - trafficLevel is
 * TomTom's current/free-flow speed ratio (1 = free flow). Features with a
 * missing/non-finite traffic_level are skipped unless road_closure is true
 * (closures decode with level 0).
 */

import { PbfReader } from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { tilesForBounds, type BBox } from "@/lib/tomtom-tiles";
import type { FlowSegment } from "./flow-match";

export { tilesForBounds };
export type { BBox, FlowSegment };

/** MVT layer name in TomTom flow tiles (verified live 2026-07-16). */
const FLOW_LAYER_NAME = "Traffic flow";
/** Ms - per-tile decode cache TTL (matches the proxy's 120 s tile TTL). */
const DECODE_CACHE_TTL_MS = 120_000;
/** Max decoded tiles kept in memory before oldest-entry eviction. */
const DECODE_CACHE_MAX_ENTRIES = 64;

interface DecodeCacheEntry {
  at: number;
  segments: FlowSegment[];
}

/** Decoded-tile cache keyed by "z/x/y". */
const _decodeCache = new Map<string, DecodeCacheEntry>();
/** Session count of tile requests issued to the proxy (decode-cache misses). */
let _tilesFetched = 0;

/**
 * Decode one TomTom flow tile (MVT protobuf) into flow segments.
 *
 * @returns Flow polylines in [lon, lat] degrees. Returns [] for undecodable
 *   buffers or tiles without a "Traffic flow" layer (defensive - a corrupt
 *   tile must not kill the traffic layer).
 */
export function decodeFlowTile(
  data: Uint8Array | ArrayBuffer | Buffer,
  z: number,
  x: number,
  y: number,
): FlowSegment[] {
  let layer;
  try {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const tile = new VectorTile(new PbfReader(bytes as Uint8Array));
    layer = tile.layers[FLOW_LAYER_NAME];
  } catch {
    return [];
  }
  if (!layer) return [];

  const segments: FlowSegment[] = [];
  for (let i = 0; i < layer.length; i++) {
    let feature;
    let geometry;
    try {
      feature = layer.feature(i);
      geometry = feature.toGeoJSON(x, y, z).geometry;
    } catch {
      continue; // one malformed feature must not drop the tile
    }
    const props = feature.properties || {};
    const closure = props.road_closure === true || props.road_closure === "true";
    const rawLevel = props.traffic_level;
    const hasLevel = typeof rawLevel === "number" && Number.isFinite(rawLevel);
    // Skip features we can't color - unless closed (closures render dot-free
    // regardless of level, so they stay useful without one).
    if (!hasLevel && !closure) continue;
    const trafficLevel = hasLevel ? Math.min(1, Math.max(0, rawLevel as number)) : 0;
    const roadType = typeof props.road_type === "string" ? props.road_type : "";

    const lines: number[][][] =
      geometry?.type === "LineString"
        ? [geometry.coordinates as number[][]]
        : geometry?.type === "MultiLineString"
          ? (geometry.coordinates as number[][][])
          : [];
    for (const coords of lines) {
      if (!Array.isArray(coords) || coords.length < 2) continue;
      segments.push({ coords, trafficLevel, roadType, closure });
    }
  }
  return segments;
}

/** Insert into the decode cache with oldest-entry eviction. */
function cacheSet(key: string, entry: DecodeCacheEntry): void {
  if (!_decodeCache.has(key) && _decodeCache.size >= DECODE_CACHE_MAX_ENTRIES) {
    const oldest = _decodeCache.keys().next().value;
    if (oldest !== undefined) _decodeCache.delete(oldest);
  }
  _decodeCache.set(key, entry);
}

interface FetchFlowOpts {
  signal?: AbortSignal;
  zoom?: number;
}

/**
 * Fetch + decode all flow tiles covering the given bounds.
 *
 * Tiles are fetched from the local proxy in parallel; each decoded tile is
 * cached in memory for 120 s (keyed z/x/y), so repeat calls for the same
 * viewport are free. Partial tile failures return the segments that DID
 * decode (last-good philosophy); the promise rejects only when every tile
 * failed (e.g. keyless 503, aborted signal, proxy down).
 */
export async function fetchFlowForBounds(
  bounds: BBox,
  { signal, zoom = 12 }: FetchFlowOpts = {},
): Promise<FlowSegment[]> {
  const tiles = tilesForBounds(bounds, zoom);
  if (tiles.length === 0) return [];
  const now = Date.now();

  const results = await Promise.allSettled(
    tiles.map(async ({ z, x, y }) => {
      const key = `${z}/${x}/${y}`;
      const cached = _decodeCache.get(key);
      if (cached && now - cached.at < DECODE_CACHE_TTL_MS) return cached.segments;

      _tilesFetched += 1;
      const res = await fetch(`/api/tomtom/flow/${z}/${x}/${y}.pbf`, { signal });
      if (!res.ok) throw new Error(`flow tile ${key}: HTTP ${res.status}`);
      const segments = decodeFlowTile(await res.arrayBuffer(), z, x, y);
      cacheSet(key, { at: Date.now(), segments });
      return segments;
    }),
  );

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<FlowSegment[]> => r.status === "fulfilled",
  );
  if (fulfilled.length === 0) {
    const first = results[0];
    throw first && first.status === "rejected"
      ? first.reason instanceof Error
        ? first.reason
        : new Error("flow fetch failed")
      : new Error("flow fetch failed");
  }
  return fulfilled.flatMap((r) => r.value);
}

/** Session diagnostics for stats surfaces. */
export function getFlowSessionStats(): { tilesFetched: number } {
  return { tilesFetched: _tilesFetched };
}

/** Clear the decode cache (tests + layer teardown). Session stats persist. */
export function resetFlowTileCache(): void {
  _decodeCache.clear();
}
