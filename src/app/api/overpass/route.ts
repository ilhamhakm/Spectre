/**
 * Overpass API proxy: POST /api/overpass
 *
 * Ported faithfully from GEV's vite.config.js overpassProxy(). Accepts POST
 * requests with an Overpass QL `data=` form body, normalizes the query for
 * cache keying, and fans out to multiple Overpass mirrors with per-upstream
 * timeout and rate-limit detection. Successful responses are cached in memory
 * (24h) + on disk (7d, 30d for boundary queries). Concurrent identical queries
 * share a single upstream request. Serve-stale-on-failure.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import {
  sanitizeOverpassBody,
  simplifyOverpassPayloadBody,
  overpassLooksRateLimited,
  overpassLooksRuntimeError,
  isOverpassBoundaryQuery,
  overpassDiskPath,
  makeRateLimiter,
} from "@/lib/overpass-sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OVERPASS_UPSTREAMS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const OVERPASS_CACHE_MS = 86_400_000; // 24h fresh memory TTL
const OVERPASS_DISK_TTL_MS = 7 * 86_400_000; // 7 days
const OVERPASS_BOUNDARY_DISK_TTL_MS = 30 * 86_400_000; // 30 days
const OVERPASS_DISK_DIR = path.join(process.cwd(), ".spectre-cache", "overpass");
const OVERPASS_TIMEOUT_MS = 22000;
const OVERPASS_CACHE_MAX_ENTRIES = 120;
const OVERPASS_MAX_BODY_BYTES = 24 * 1024; // 24 KB
const OVERPASS_MAX_RESPONSE_BYTES = 32 * 1024 * 1024; // 32 MB
const OVERPASS_MAX_CONCURRENT = 6;

interface OverpassPayload {
  status: number;
  body: string;
  contentType: string;
  endpoint: string;
  rateLimited?: boolean;
  runtimeError?: boolean;
  cachedAt?: number;
}

const _overpassCache = new Map<string, OverpassPayload>();
const _overpassInFlight = new Map<string, Promise<OverpassPayload>>();
const _overpassRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 300 });
let _overpassConcurrent = 0;

function overpassDiskTtlMs(cacheKey: string): number {
  return isOverpassBoundaryQuery(cacheKey) ? OVERPASS_BOUNDARY_DISK_TTL_MS : OVERPASS_DISK_TTL_MS;
}

function fullDiskPath(cacheKey: string): string {
  return path.join(OVERPASS_DISK_DIR, overpassDiskPath(OVERPASS_DISK_DIR, cacheKey));
}

async function readOverpassDisk(cacheKey: string, maxAgeMs: number): Promise<OverpassPayload | null> {
  try {
    const raw = await fsp.readFile(fullDiskPath(cacheKey), "utf8");
    const payload = JSON.parse(raw) as OverpassPayload;
    if (!payload || typeof payload.body !== "string" || !Number.isFinite(payload.cachedAt)) {
      return null;
    }
    if (Date.now() - (payload.cachedAt as number) > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

function writeOverpassDisk(cacheKey: string, payload: OverpassPayload): void {
  fsp.mkdir(OVERPASS_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(fullDiskPath(cacheKey), JSON.stringify(payload)))
    .catch((err) => console.warn("[Overpass Proxy] disk cache write failed:", err?.message || err));
}

function trimOverpassCache(): void {
  while (_overpassCache.size > OVERPASS_CACHE_MAX_ENTRIES) {
    const oldestKey = _overpassCache.keys().next().value;
    if (!oldestKey) break;
    _overpassCache.delete(oldestKey);
  }
}

/** Read a fetch() Response body as text with a hard byte cap. */
async function readResponseTextCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Upstream response too large");
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("Upstream response too large");
    return text;
  }
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* no-op */
      }
      throw new Error("Upstream response too large");
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/** Try each Overpass upstream in order until one succeeds. */
async function fetchOverpassPayload(
  body: string,
  maxResponseBytes = OVERPASS_MAX_RESPONSE_BYTES,
): Promise<OverpassPayload> {
  let lastError: Error | null = null;
  let lastRateLimitPayload: OverpassPayload | null = null;

  for (const endpoint of OVERPASS_UPSTREAMS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "spectre-v2-overpass-proxy/1.0",
        },
        body,
        signal: controller.signal,
      });
      const responseBody = await readResponseTextCapped(upstream, maxResponseBytes);
      const contentType = upstream.headers.get("content-type") || "application/json";
      const status = upstream.status;
      const rateLimited = status === 429 || overpassLooksRateLimited(responseBody);
      const runtimeError = overpassLooksRuntimeError(responseBody);
      const payload: OverpassPayload = {
        status,
        body: responseBody,
        contentType,
        endpoint,
        rateLimited,
        runtimeError,
      };

      if (rateLimited) {
        lastRateLimitPayload = payload;
        continue;
      }
      if (runtimeError) {
        lastError = new Error(`Overpass runtime error (${endpoint})`);
        continue;
      }
      if (status >= 500) {
        lastError = new Error(`Overpass upstream returned ${status} (${endpoint})`);
        continue;
      }

      // Success: decimate giant boundary geometry before it reaches the cache.
      payload.body = simplifyOverpassPayloadBody(payload.body);
      return payload;
    } catch (error) {
      lastError = error as Error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastRateLimitPayload) return lastRateLimitPayload;
  throw lastError || new Error("All Overpass upstreams failed");
}

function jsonRes(status: number, obj: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function payloadRes(payload: OverpassPayload, cacheStatus: string): Response {
  return new Response(payload.body || "", {
    status: payload.status,
    headers: {
      "Content-Type": payload.contentType || "application/json",
      "Cache-Control": "public, max-age=15",
      "X-Overpass-Cache": cacheStatus,
      "X-Overpass-Upstream": payload.endpoint || "unknown",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let cacheKey: string | null = null;
  try {
    // Collect POST body with a hard byte cap.
    let body: string;
    try {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > OVERPASS_MAX_BODY_BYTES) {
        return jsonRes(413, { error: "Overpass query too large" });
      }
      body = new TextDecoder().decode(new Uint8Array(buf));
    } catch {
      return jsonRes(400, { error: "Missing Overpass query body" });
    }
    if (!body) return jsonRes(400, { error: "Missing Overpass query body" });

    // Validate + clamp the QL.
    const sanitized = sanitizeOverpassBody(body);
    if (!sanitized.ok) {
      return jsonRes(400, { error: sanitized.error });
    }
    const safeBody = sanitized.body;

    // Normalize whitespace so semantically identical queries share cache entries.
    cacheKey = safeBody.replace(/\s+/g, " ").trim();

    // Preflight: memory -> in-flight -> disk -> rate limiter.
    const cached = _overpassCache.get(cacheKey);
    if (cached && cached.cachedAt && Date.now() - cached.cachedAt <= OVERPASS_CACHE_MS) {
      return payloadRes(cached, "HIT");
    }

    const pending = _overpassInFlight.get(cacheKey);
    if (pending) {
      const p = await pending;
      return payloadRes(p, "INFLIGHT");
    }

    const disk = await readOverpassDisk(cacheKey, overpassDiskTtlMs(cacheKey));
    if (disk) {
      _overpassCache.set(cacheKey, disk);
      trimOverpassCache();
      return payloadRes(disk, "DISK");
    }

    // Rate limit (one slot per genuine upstream-bound request).
    if (!_overpassRateLimiter("local")) {
      return jsonRes(429, { error: "Rate limit exceeded" }, { "Retry-After": "5" });
    }

    if (_overpassConcurrent >= OVERPASS_MAX_CONCURRENT) {
      return jsonRes(503, { error: "Overpass proxy busy - try again shortly" }, { "Retry-After": "2" });
    }
    _overpassConcurrent += 1;

    const requestPromise = fetchOverpassPayload(safeBody)
      .then((payload) => {
        if (payload.status < 500 && !payload.rateLimited && !payload.runtimeError) {
          const entry: OverpassPayload = { ...payload, cachedAt: Date.now() };
          _overpassCache.set(cacheKey as string, entry);
          trimOverpassCache();
          writeOverpassDisk(cacheKey as string, entry);
        }
        return payload;
      })
      .finally(() => {
        _overpassConcurrent -= 1;
        _overpassInFlight.delete(cacheKey as string);
      });

    _overpassInFlight.set(cacheKey, requestPromise);
    const payload = await requestPromise;

    // Degraded upstream: last-good roads beat an empty layer - serve stale.
    if (payload.rateLimited || payload.runtimeError || payload.status >= 500) {
      const stale =
        _overpassCache.get(cacheKey) || (await readOverpassDisk(cacheKey, Infinity).catch(() => null));
      if (stale) return payloadRes(stale, "STALE");
    }
    return payloadRes(payload, "MISS");
  } catch (e) {
    const stale = cacheKey
      ? _overpassCache.get(cacheKey) || (await readOverpassDisk(cacheKey, Infinity).catch(() => null))
      : null;
    if (stale) return payloadRes(stale, "STALE");
    console.error("[Overpass Proxy]", (e as Error)?.message || e);
    return jsonRes(502, { error: "Overpass proxy error" });
  }
}

export async function GET(): Promise<Response> {
  return jsonRes(405, { error: "Method Not Allowed" });
}
