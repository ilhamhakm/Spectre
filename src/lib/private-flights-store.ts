// Private-flight tracking support.
//
// People track famous jets by tail number (e.g. Elon Musk's N628TS). OpenSky
// indexes aircraft by ICAO 24-bit hex, not tail numbers, so this module:
//
//   1. Converts US tail numbers (N-numbers) → ICAO hex via the deterministic
//      FAA algorithm (no network call needed).
//   2. Accumulates last-known positions for notable tails every time
//      /api/flights polls OpenSky, so even when a jet goes offline we know
//      where it was last seen.
//   3. Caches OpenSky flight-history lookups per icao24 so "where did they
//      last land" can be answered cheaply and repeatedly.
//
// The store lives on globalThis (shared across route modules in one process),
// mirroring military-trace-store.ts.

import { NOTABLE_PEOPLE } from "@/lib/privateFlightsRegistry";
import { openskyAuthHeaders } from "@/lib/opensky-auth";

// ---- Tail number → ICAO hex (FAA deterministic algorithm) ----

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O
const L2I: Record<string, number> = {};
for (let i = 0; i < LETTERS.length; i++) L2I[LETTERS[i]] = i;
const HEX_BASE = 0xa00000;
const SUFFIX_CNT: Record<number, number> = { 1: 601, 2: 601, 3: 601, 4: 25, 5: 1 };
const SUBTREE_CNT: Record<number, number> = { 5: 1 };
for (let L = 4; L >= 1; L--) SUBTREE_CNT[L] = SUFFIX_CNT[L] + 10 * SUBTREE_CNT[L + 1];
const N_RE = /^N([1-9]\d{0,4})([A-HJ-NP-Z]{0,2})$/i;

function suffixOffset(rootLen: number, suf: string): number {
  if (!suf) return 0;
  const s = suf.toUpperCase();
  const idx1 = L2I[s[0]];
  if (idx1 === undefined) throw new Error("invalid suffix");
  if (s.length === 1) return 1 + (rootLen === 4 ? idx1 : idx1 * 25);
  if (rootLen >= 4) throw new Error("two-letter suffix invalid for 4+ digit roots");
  const idx2 = L2I[s[1]];
  if (idx2 === undefined) throw new Error("invalid suffix");
  return 2 + idx1 * 25 + idx2;
}

// US tail number → 6-char ICAO hex (lowercase). Returns null for non-US
// registrations (e.g. P4-MES, LX-RAY) which have no deterministic mapping.
export function tailToIcao24(tail: string): string | null {
  const raw = tail.trim().toUpperCase();
  if (!N_RE.test(raw)) return null;
  const m = raw.match(N_RE);
  if (!m) return null;
  const digits = m[1];
  const suffix = (m[2] || "").toUpperCase();
  const rootLen = digits.length;
  if (rootLen === 5 && suffix) return null;
  if (rootLen === 4 && suffix.length > 1) return null;
  const firstDigit = Number(digits[0]);
  let idx = (firstDigit - 1) * SUBTREE_CNT[1];
  let prefixLen = 1;
  for (const dChar of digits.slice(1)) {
    idx += SUFFIX_CNT[prefixLen];
    idx += Number(dChar) * SUBTREE_CNT[prefixLen + 1];
    prefixLen += 1;
  }
  try {
    idx += suffixOffset(rootLen, suffix);
  } catch {
    return null;
  }
  return (HEX_BASE + idx + 1).toString(16).toLowerCase().padStart(6, "0");
}

// ---- Last-known-position accumulation ----

export interface LastKnownPosition {
  icao24: string | null;
  lat: number;
  lon: number;
  alt: number | null;
  lastContact: number; // unix seconds
}

interface LastFlight {
  origin: string | null;
  destination: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  callsign: string | null;
  fetchedAt: number;
}

interface PrivateTrackGlobal {
  __spectrePrivatePos?: Map<string, LastKnownPosition>;
  __spectrePrivateLastFlight?: Map<string, LastFlight>;
  __spectrePrivateLastFlightFail?: Map<string, number>;
}

function getGlobal(): PrivateTrackGlobal {
  return globalThis as PrivateTrackGlobal;
}

export function getLastKnownPosition(tail: string): LastKnownPosition | null {
  return getGlobal().__spectrePrivatePos?.get(normalizeTail(tail)) ?? null;
}

function normalizeTail(t: string): string {
  return t.toUpperCase().replace(/\s+/g, "");
}

// Called every time /api/flights (or the states snapshot) sees live data.
export function recordPrivatePositions(
  states: { icao24: string; callsign: string; lon: number; lat: number; alt: number | null; lastContact: number }[],
): void {
  const g = getGlobal();
  if (!g.__spectrePrivatePos) g.__spectrePrivatePos = new Map();
  const notable = new Set<string>();
  for (const p of NOTABLE_PEOPLE) for (const t of p.tailNumbers) notable.add(normalizeTail(t));

  for (const s of states) {
    const tail = normalizeTail(s.callsign);
    if (tail && notable.has(tail)) {
      g.__spectrePrivatePos.set(tail, {
        icao24: s.icao24 || null,
        lat: s.lat,
        lon: s.lon,
        alt: s.alt,
        lastContact: s.lastContact,
      });
    }
  }
}

// ---- OpenSky flight-history cache ("where did they last land") ----

const LAST_FLIGHT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — flight records rarely change
// When OpenSky rate-limits (429), back off for 5 min instead of re-hammering
// on every panel open.
const LAST_FLIGHT_FAIL_TTL_MS = 5 * 60 * 1000;
// OpenSky caps /flights/aircraft at a 2-day interval, but anonymous access
// 403s ("You cannot access historical flights") on anything wider than 24h.
// So we look back one day — enough to catch the tail's most recent leg.
const LOOKBACK_DAYS = 1;

export interface LastFlightLookup {
  lastFlight: LastFlight | null;
  reachable: boolean; // false = OpenSky refused/errored, don't spam
}

export async function getLastFlight(
  icao24: string,
  signal?: AbortSignal,
): Promise<LastFlightLookup> {
  const g = getGlobal();
  if (!g.__spectrePrivateLastFlight) g.__spectrePrivateLastFlight = new Map();
  const cached = g.__spectrePrivateLastFlight.get(icao24);
  if (cached && Date.now() - cached.fetchedAt < LAST_FLIGHT_TTL_MS) {
    return { lastFlight: cached, reachable: true };
  }
  // Back off while rate-limited so repeated panel opens don't re-trigger 429s.
  const failed = g.__spectrePrivateLastFlightFail?.get(icao24);
  if (failed && Date.now() - failed < LAST_FLIGHT_FAIL_TTL_MS) {
    return { lastFlight: null, reachable: false };
  }

  const now = Math.floor(Date.now() / 1000);
  const begin = now - LOOKBACK_DAYS * 86400;
  const url = `https://opensky-network.org/api/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${now}`;

  const markFail = () => {
    if (!g.__spectrePrivateLastFlightFail) g.__spectrePrivateLastFlightFail = new Map();
    g.__spectrePrivateLastFlightFail.set(icao24, Date.now());
  };

  try {
    const res = await fetch(url, { cache: "no-store", headers: await openskyAuthHeaders(), signal });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      markFail();
      return { lastFlight: null, reachable: false };
    }
    // 404 = no completed flight in the window (parked/offline tail, or the
    // nightly batch hasn't caught up). That's a legit empty result, not a
    // service failure — don't poison the reachability flag.
    if (res.status === 404) return { lastFlight: null, reachable: true };
    if (!res.ok) return { lastFlight: null, reachable: false };
    const flights = (await res.json()) as {
      firstSeen?: number;
      lastSeen?: number;
      estDepartureAirport?: string | null;
      estArrivalAirport?: string | null;
      callsign?: string;
    }[];
    if (!Array.isArray(flights) || flights.length === 0) {
      return { lastFlight: null, reachable: true };
    }
    // Most recent = highest lastSeen.
    const mostRecent = flights.reduce((a, b) =>
      (b.lastSeen ?? 0) > (a.lastSeen ?? 0) ? b : a,
    );
    const lastFlight: LastFlight = {
      origin: mostRecent.estDepartureAirport ?? null,
      destination: mostRecent.estArrivalAirport ?? null,
      firstSeen: mostRecent.firstSeen ?? null,
      lastSeen: mostRecent.lastSeen ?? null,
      callsign: mostRecent.callsign ?? null,
      fetchedAt: Date.now(),
    };
    g.__spectrePrivateLastFlight.set(icao24, lastFlight);
    return { lastFlight, reachable: true };
  } catch {
    return { lastFlight: null, reachable: false };
  }}

// Resolve every tail in the registry once per process to prewarm the hex map.
export function resolveRegistryIcao(): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const p of NOTABLE_PEOPLE) {
    for (const t of p.tailNumbers) {
      if (!map.has(normalizeTail(t))) {
        map.set(normalizeTail(t), tailToIcao24(t));
      }
    }
  }
  return map;
}
