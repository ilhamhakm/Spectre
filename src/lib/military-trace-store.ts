// In-memory per-aircraft position history for military flights.
//
// airplanes.live's public API has no trace/history endpoint (only live
// positional snapshots via /v2/mil, /v2/hex, etc.), so we build our own
// past track: every time /api/military-flights refetches from upstream,
// we record each aircraft's current position into this store. The
// trace route then serves the accumulated history as the trajectory.
//
// The store lives on globalThis because each Next.js route handler is a
// separate module instance in the same process — a plain module-level Map
// in one route file would not be visible to the other route file. All
// consumers must be in the same server process (true for dev and the
// default single-process prod build).

import type { MilitaryFlight } from "@/lib/sources/airplanes-live";

export interface TracePoint {
  time: number;
  lat: number;
  lon: number;
  alt: number | null;
}

interface FlightTrace {
  callsign: string | null;
  points: TracePoint[];
}

const MAX_POINTS_PER_FLIGHT = 240; // oldest trimmed past this (dense enough for hours)
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // drop flights with no contact for 24h

interface TraceGlobal {
  __spectreMilTraces?: Map<string, FlightTrace>;
}

function getStore(): Map<string, FlightTrace> {
  const g = globalThis as TraceGlobal;
  if (!g.__spectreMilTraces) {
    g.__spectreMilTraces = new Map();
  }
  return g.__spectreMilTraces;
}

export function recordMilitaryPositions(flights: MilitaryFlight[]): void {
  const store = getStore();
  const now = Date.now();

  for (const f of flights) {
    if (!f.icao24 || f.icao24 === "unknown") continue;
    let trace = store.get(f.icao24);
    if (!trace) {
      trace = { callsign: f.callsign || null, points: [] };
      store.set(f.icao24, trace);
    }
    if (f.callsign) trace.callsign = f.callsign;

    const last = trace.points[trace.points.length - 1];
    // Skip appending when the position is identical to the last recorded one
    // and it was recent (< 60s) — avoids duplicate blips on every poll cycle.
    if (
      !last ||
      last.lat !== f.latitude ||
      last.lon !== f.longitude ||
      now - last.time > 60_000
    ) {
      trace.points.push({ time: now, lat: f.latitude, lon: f.longitude, alt: f.altitude });
      if (trace.points.length > MAX_POINTS_PER_FLIGHT) {
        trace.points.splice(0, trace.points.length - MAX_POINTS_PER_FLIGHT);
      }
    }
  }

  // Prune flights that have gone silent for MAX_AGE_MS.
  const cutoff = now - MAX_AGE_MS;
  for (const [hex, trace] of store) {
    const last = trace.points[trace.points.length - 1];
    if (!last || last.time < cutoff) store.delete(hex);
  }
}

export function getMilitaryTrace(
  hex: string,
): { callsign: string | null; points: TracePoint[] } | null {
  const trace = getStore().get(hex.toLowerCase());
  if (!trace || trace.points.length === 0) return null;
  return { callsign: trace.callsign, points: trace.points };
}
