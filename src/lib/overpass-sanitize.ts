/**
 * Overpass proxy helpers: QL validation/clamping, geometry simplification,
 * and a fixed-window rate limiter. Ported faithfully from GEV's vite.config.js
 * overpass proxy section. Server-only.
 */

import { createHash } from "node:crypto";

/** Server-side timeout ceiling (seconds) we allow inside an Overpass QL query. */
export const OVERPASS_MAX_QL_TIMEOUT = 30;
/** Max `around:` radius (m). */
export const OVERPASS_MAX_AROUND_M = 50000;
/** Max bbox span (degrees). */
export const OVERPASS_MAX_BBOX_DEG = 12;
/** Every Overpass element-type specifier, including combined shortcuts + `rel`. */
export const OVERPASS_ELEMENT_TYPES = "node|way|relation|nwr|nw|nr|wr|rel";
/** Element-selector (incl. `area`) whose statements must be individually bounded. */
export const OVERPASS_SELECTOR_RE = new RegExp(
  `\\b(?:${OVERPASS_ELEMENT_TYPES}|area)\\b`,
);
/** An element selector bounded BY an area - the country-scan abuse shape. */
export const OVERPASS_AREA_ELEMENT_RE = new RegExp(
  `\\b(?:${OVERPASS_ELEMENT_TYPES})\\s*\\(\\s*area\\b`,
  "i",
);
/** A single bbox 4-tuple `(s,w,n,e)` (non-global so it does not advance lastIndex). */
export const OVERPASS_BBOX_RE =
  /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/;

/** Only payloads at least this large go through geometry simplification. */
export const OVERPASS_SIMPLIFY_MIN_BYTES = 1_500_000;
/** Only per-element geometry arrays with at least this many points are simplified. */
export const OVERPASS_SIMPLIFY_MIN_POINTS = 1200;
/** Douglas-Peucker tolerance (degrees, ~44 m of latitude). */
export const OVERPASS_SIMPLIFY_TOLERANCE_DEG = 0.0004;

/** Whether a normalized Overpass query is BOUNDARY-class (earns 30-day disk TTL). */
export function isOverpassBoundaryQuery(cacheKey: string): boolean {
  return /is_in\s*\(|\bpivot\b/i.test(String(cacheKey || ""));
}

/**
 * Single-pass lexer: blank out quoted literals (-> empty quotes) and strip line
 * and block comments - recognizing each in one walk so a comment marker INSIDE
 * a quoted string is treated as string content, not a comment (and vice versa).
 */
function stripOverpassNoise(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += quote + quote; // collapse the literal to empty quotes
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export interface SanitizeOk {
  ok: true;
  body: string;
}
export interface SanitizeErr {
  ok: false;
  error: string;
}

/**
 * Validate + clamp an Overpass form body. Defends the proxy against planet-scale
 * abuse: requires exactly one `data` query in which EVERY element selector is
 * individually spatially bounded (around / bbox / is_in / poly / area-set /
 * pivot), rejects oversized radii and world-sized bboxes, and clamps every
 * `[timeout:]` directive. Comments + quoted literals are stripped first.
 */
export function sanitizeOverpassBody(rawBody: string): SanitizeOk | SanitizeErr {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(rawBody);
  } catch {
    return { ok: false, error: "Malformed query body" };
  }
  const all = params.getAll("data");
  if (all.length !== 1) return { ok: false, error: "Exactly one data query is required" };
  const data = all[0];
  if (!data || !data.trim()) return { ok: false, error: "Missing Overpass data query" };

  const stripped = stripOverpassNoise(data);

  // Reject oversized radii in EVERY around form.
  for (const m of stripped.matchAll(/around(?:\.\w+)?:\s*([\d.eE+-]+)/gi)) {
    const radius = Number(m[1]);
    if (!Number.isFinite(radius) || radius > OVERPASS_MAX_AROUND_M) {
      return { ok: false, error: "Overpass around radius too large" };
    }
  }
  // Reject world-sized / oversized bboxes.
  for (const m of stripped.matchAll(
    /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g,
  )) {
    const s = Number(m[1]);
    const w = Number(m[2]);
    const n = Number(m[3]);
    const e = Number(m[4]);
    if (Math.abs(n - s) > OVERPASS_MAX_BBOX_DEG || Math.abs(e - w) > OVERPASS_MAX_BBOX_DEG) {
      return { ok: false, error: "Overpass bbox too large" };
    }
  }

  // Reject control-flow constructs the app never uses.
  if (/\b(?:foreach|complete|retro|compare|convert|make)\b/i.test(stripped)) {
    return { ok: false, error: "Unsupported Overpass construct" };
  }
  if (/\bpoly\s*:/i.test(stripped)) {
    return { ok: false, error: "Overpass poly filter not allowed" };
  }

  // Every selector statement must be individually bounded, WITH set provenance.
  const boundedSets = new Set<string>();
  for (let stmt of stripped.split(";")) {
    stmt = stmt.trim();
    if (!stmt || stmt.startsWith("[") || /^out\b/.test(stmt)) continue;

    const outSets: string[] = [];
    const body = stmt.replace(/->\s*\.(\w+)/g, (_, name: string) => {
      outSets.push(name);
      return " ";
    });
    const probe = body.replace(/\[[^\]]*\]/g, " ");

    if (OVERPASS_AREA_ELEMENT_RE.test(probe)) {
      return { ok: false, error: "Overpass area-bounded element selector not allowed" };
    }

    const hasSelector = OVERPASS_SELECTOR_RE.test(probe);
    const inputSets = [...probe.matchAll(/(?<!\d)\.([a-z_]\w*)/gi)].map((m) => m[1]);
    const directBound =
      /around:\s*\d/.test(probe) ||
      OVERPASS_BBOX_RE.test(probe) ||
      /is_in\s*\(/.test(probe) ||
      /\barea\s*\(/.test(probe);

    const setBound = inputSets.some((s) => boundedSets.has(s));
    const bounded = directBound || setBound;

    if (hasSelector && !bounded) {
      return { ok: false, error: "Overpass query has an unbounded selector" };
    }
    if (bounded) for (const name of outSets) boundedSets.add(name);
  }

  const clamped = data.replace(
    /\[timeout:\s*(\d+)\s*\]/gi,
    (_, n: string) => `[timeout:${Math.min(Number(n) || OVERPASS_MAX_QL_TIMEOUT, OVERPASS_MAX_QL_TIMEOUT)}]`,
  );
  return { ok: true, body: `data=${encodeURIComponent(clamped)}` };
}

/** Iterative Douglas-Peucker on [{lat,lon},...] (planar-degree approx). Endpoints always kept. */
function douglasPeucker(
  points: { lat: number; lon: number }[],
  toleranceDeg: number,
): { lat: number; lon: number }[] {
  const n = points.length;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    if (b - a < 2) continue;
    const ax = points[a].lon;
    const ay = points[a].lat;
    const vx = points[b].lon - ax;
    const vy = points[b].lat - ay;
    const c2 = vx * vx + vy * vy;
    let worst = -1;
    let worstDist = toleranceDeg;
    for (let i = a + 1; i < b; i++) {
      const wx = points[i].lon - ax;
      const wy = points[i].lat - ay;
      let d: number;
      if (c2 === 0) {
        d = Math.hypot(wx, wy);
      } else {
        const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
        d = Math.hypot(wx - t * vx, wy - t * vy);
      }
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Simplify one element's geometry array in place if it is big enough. */
function simplifyElementGeometry(
  el: any,
  minPoints: number,
  toleranceDeg: number,
): void {
  if (Array.isArray(el?.geometry) && el.geometry.length >= minPoints) {
    el.geometry = douglasPeucker(el.geometry, toleranceDeg);
  }
  if (Array.isArray(el?.members)) {
    for (const member of el.members) {
      if (Array.isArray(member?.geometry) && member.geometry.length >= minPoints) {
        member.geometry = douglasPeucker(member.geometry, toleranceDeg);
      }
    }
  }
}

interface SimplifyOpts {
  minBytes?: number;
  minPoints?: number;
  toleranceDeg?: number;
}

/**
 * Server-side geometry simplification for large Overpass `out geom` payloads.
 * Anything unparseable or below the thresholds passes through byte-identical.
 */
export function simplifyOverpassPayloadBody(
  bodyText: string,
  opts: SimplifyOpts = {},
): string {
  const minBytes = opts.minBytes ?? OVERPASS_SIMPLIFY_MIN_BYTES;
  const minPoints = opts.minPoints ?? OVERPASS_SIMPLIFY_MIN_POINTS;
  const toleranceDeg = opts.toleranceDeg ?? OVERPASS_SIMPLIFY_TOLERANCE_DEG;
  if (typeof bodyText !== "string" || bodyText.length < minBytes) return bodyText;
  let data: any;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
  if (!Array.isArray(data?.elements)) return bodyText;
  for (const el of data.elements) simplifyElementGeometry(el, minPoints, toleranceDeg);
  try {
    return JSON.stringify(data);
  } catch {
    return bodyText;
  }
}

/** Detect whether an Overpass API response body indicates rate-limiting. */
export function overpassLooksRateLimited(bodyText: string): boolean {
  const text = String(bodyText || "").toLowerCase();
  return (
    text.includes("rate_limited") ||
    text.includes("quota of your ip address") ||
    text.includes("dispatcher_client::request_read_and_idx::rate_limited") ||
    text.includes("too many requests")
  );
}

/** Detect an Overpass HTTP-200 body that is actually a runtime FAILURE via its `remark`. */
export function overpassLooksRuntimeError(bodyText: string): boolean {
  const text = String(bodyText || "").toLowerCase();
  return (
    text.includes("runtime error") ||
    text.includes("timed out") ||
    text.includes("out of memory")
  );
}

/** Normalized Overpass query -> stable disk-cache file path. */
export function overpassDiskPath(diskDir: string, cacheKey: string): string {
  const hash = createHash("sha1").update(cacheKey).digest("hex");
  // path.join is applied by the caller; return the bare filename.
  return `${hash}.json`;
}

/** Minimal fixed-window per-key rate limiter. */
const RATE_LIMITER_MAX_KEYS = 2000;
export function makeRateLimiter({
  windowMs,
  max,
  globalMax,
}: {
  windowMs: number;
  max: number;
  globalMax?: number;
}): (key: string) => boolean {
  const hits = new Map<string, number[]>();
  let globalTimes: number[] = [];
  return function allow(key: string): boolean {
    const now = Date.now();
    globalTimes = globalTimes.filter((t) => now - t < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false;
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    globalTimes.push(now);
    if (hits.size > RATE_LIMITER_MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    if (hits.size > 256) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
      }
    }
    return true;
  };
}
