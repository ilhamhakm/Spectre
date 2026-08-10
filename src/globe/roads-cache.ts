import type { RoadSegment } from "@/lib/sources/overpass";

// Client-side roads cache — persists across camera moves within a session.
// Keyed by `${level}:${south.toFixed(2)}:${west.toFixed(2)}:${north.toFixed(2)}:${east.toFixed(2)}`.
//
// When the camera returns to a previously fetched area, the cache returns
// the stored roads instantly without hitting /api/roads (which in turn
// hits the Overpass API — rate-limited to ~10k req/day).
//
// The cache is bounded: oldest entries are evicted beyond MAX_ENTRIES to
// prevent unbounded memory growth on long sessions with lots of panning.

const MAX_ENTRIES = 64;

interface CacheEntry {
  roads: RoadSegment[];
  congestions: Record<number, number>;
}

const cache = new Map<string, CacheEntry>();

export function roadsCacheKey(
  south: number,
  west: number,
  north: number,
  east: number,
  level: number,
): string {
  return `${level}:${south.toFixed(2)}:${west.toFixed(2)}:${north.toFixed(2)}:${east.toFixed(2)}`;
}

export function getCachedRoads(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // Move to end (most recently used) by re-inserting. The Map iteration
  // order is insertion order, so the first item is the oldest.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setCachedRoads(
  key: string,
  roads: RoadSegment[],
  congestions: Record<number, number>,
): void {
  cache.set(key, { roads, congestions });
  // Evict oldest entry if over capacity.
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function clearRoadsCache(): void {
  cache.clear();
}
