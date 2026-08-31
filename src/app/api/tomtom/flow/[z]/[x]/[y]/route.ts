/**
 * GET /api/tomtom/flow/[z]/[x]/[y].pbf
 *
 * Ported faithfully from GEV's tomtomProxy() tile branch. Upstream:
 * https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf
 * (style `relative`; UNCOMPRESSED Mapbox Vector Tile, layer "Traffic flow").
 * The key comes from TOMTOM_API_KEY server-side only - the browser fetches
 * same-origin and the key never reaches the client.
 *
 * Cache: memory + disk (.spectre-cache/tomtom/), TTL 120 s, single-flight per
 * tile, serve-stale-on-failure. Budget governor counts upstream fetch attempts
 * against a soft cap; over the cap, stale tiles are served when available,
 * else 429 {error:'budget'}. Cache hits never count against the budget.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { isValidTileCoord } from "@/lib/tomtom-tiles";
import {
  loadBudgetOnce,
  recordUpstreamFetch,
  budgetExhausted,
} from "@/lib/tomtom-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TILE_TTL_MS = 120_000;
const CACHE_DIR = path.join(process.cwd(), ".spectre-cache", "tomtom");
const MEM_MAX_ENTRIES = 256;
const UPSTREAM_TIMEOUT_MS = 15000;

interface TileEntry {
  at: number;
  buf: Buffer;
}

const mem = new Map<string, TileEntry>();
const inflight = new Map<string, Promise<TileEntry | null>>();

const tilePath = (key: string): string => path.join(CACHE_DIR, `flow-${key.replaceAll("/", "-")}.pbf`);

async function readDiskTile(key: string): Promise<TileEntry | null> {
  try {
    const [stat, buf] = await Promise.all([fsp.stat(tilePath(key)), fsp.readFile(tilePath(key))]);
    return { at: stat.mtimeMs, buf: Buffer.from(buf) };
  } catch {
    return null;
  }
}

async function writeDiskTile(key: string, buf: Buffer): Promise<void> {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(tilePath(key), buf);
  } catch (err) {
    console.warn(`[tomtom-proxy] tile cache write failed for ${key}:`, (err as Error)?.message || err);
  }
}

/** LRU-ish memory insert (Map preserves insertion order; evict the oldest). */
function memSet(key: string, entry: TileEntry): void {
  if (!mem.has(key) && mem.size >= MEM_MAX_ENTRIES) {
    const oldest = mem.keys().next().value;
    if (oldest !== undefined) mem.delete(oldest);
  }
  mem.set(key, entry);
}

async function fetchUpstream(z: number, x: number, y: number): Promise<Buffer> {
  const url =
    "https://api.tomtom.com/traffic/map/4/tile/flow/relative/" +
    `${z}/${x}/${y}.pbf?key=${encodeURIComponent(process.env.TOMTOM_API_KEY as string)}`;
  recordUpstreamFetch(); // attempts count - upstream bills the request either way
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("empty tile body");
  return buf;
}

function jsonRes(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function tileRes(buf: Buffer, cacheStatus: string): Response {
  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/x-protobuf",
      "Cache-Control": "no-store",
      "x-tomtom-cache": cacheStatus,
    },
  });
}

interface RouteParams {
  params: Promise<{ z: string; x: string; y: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  try {
    await loadBudgetOnce();
    const { z: zs, x: xs, y: ys } = await params;
    // App Router matches the full segment, so y = "1686.pbf" - strip the suffix.
    const yClean = ys.replace(/\.pbf$/i, "");
    const z = Number(zs);
    const x = Number(xs);
    const y = Number(yClean);
    if (!isValidTileCoord(z, x, y)) {
      return jsonRes(400, { error: "invalid_tile" });
    }
    if (!process.env.TOMTOM_API_KEY) {
      return jsonRes(503, { error: "no_key" });
    }

    const key = `${z}/${x}/${y}`;
    const now = Date.now();

    let entry: TileEntry | null = mem.get(key) ?? null;
    if (!entry) {
      entry = await readDiskTile(key);
      if (entry) memSet(key, entry);
    }
    // Fresh cache hit - never counts against the budget.
    if (entry && now - entry.at < TILE_TTL_MS) {
      return tileRes(entry.buf, "HIT");
    }

    // Budget governor: over the soft cap, last-good data beats a dead layer.
    if (budgetExhausted()) {
      if (entry) return tileRes(entry.buf, "STALE-BUDGET");
      return jsonRes(429, { error: "budget" });
    }

    // Stale or missing -> refresh, single-flight per tile.
    if (!inflight.has(key)) {
      inflight.set(
        key,
        fetchUpstream(z, x, y)
          .then(async (buf) => {
            const fresh: TileEntry = { at: Date.now(), buf };
            memSet(key, fresh);
            await writeDiskTile(key, buf);
            return fresh;
          })
          .catch((err) => {
            console.warn(
              `[tomtom-proxy] ${key} fetch failed (${(err as Error)?.message || err}) - serving stale if any`,
            );
            return null;
          })
          .finally(() => inflight.delete(key)),
      );
    }
    const fresh = await inflight.get(key);
    if (fresh) {
      return tileRes(fresh.buf, "MISS");
    } else if (entry) {
      return tileRes(entry.buf, "STALE-ERROR"); // upstream down - stale beats empty
    }
    return jsonRes(502, { error: "upstream" });
  } catch (err) {
    console.warn("[tomtom-proxy] error:", (err as Error)?.message || err);
    return jsonRes(500, { error: "proxy" });
  }
}
