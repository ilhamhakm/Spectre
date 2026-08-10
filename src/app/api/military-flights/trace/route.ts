// GET /api/military-flights/trace?hex=X
//
// Returns the recent flight path for a military aircraft.
//
// airplanes.live's public API has no trace/history endpoint, so we build
// the past track ourselves: every time /api/military-flights refetches
// from upstream (every 5 min), we record each aircraft's position into an
// in-memory store (see lib/military-trace-store.ts). This endpoint serves
// that accumulated history — where the aircraft has been while we've been
// watching — not a forward projection. airplanes.live doesn't expose
// destination airports for military contacts, so we surface the trace's
// first point as "origin vicinity" and derive the current heading from the
// last two trace points.
//
// Response shape:
//   {
//     hex, callsign,
//     trajectory: [{ time, lat, lon, alt }],
//     origin: { lat, lon, alt, time } | null,   // first trace point
//     destination: null,                         // unknown for military
//     heading: number | null,                    // current direction
//     sourceUrl: "https://www.airplanes.live/..."
//   }

import { NextResponse } from "next/server";
import { getMilitaryTrace } from "@/lib/military-trace-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

interface TracePoint {
  time: number;
  lat: number;
  lon: number;
  alt: number | null;
}

interface TraceResponse {
  hex: string;
  callsign: string | null;
  trajectory: TracePoint[];
  origin: TracePoint | null;
  destination: null;
  heading: number | null;
  sourceUrl: string;
  fetchedAt: number;
  cached: boolean;
}

// Great-circle initial bearing between two points (degrees 0-360).
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hex = (searchParams.get("hex") ?? "").trim().toLowerCase();

  if (!hex || !/^[a-f0-9]{1,6}$/.test(hex)) {
    return NextResponse.json(
      { error: "Missing or invalid hex (expected ICAO24 hex string)" },
      { status: 400 },
    );
  }

  const trace = getMilitaryTrace(hex);
  const trajectory: TracePoint[] = trace ? trace.points : [];
  const callsign = trace?.callsign ?? null;

  const origin = trajectory.length > 0 ? trajectory[0] : null;

  // Heading from the last two trace points (direction of travel).
  let heading: number | null = null;
  if (trajectory.length >= 2) {
    const a = trajectory[trajectory.length - 2];
    const b = trajectory[trajectory.length - 1];
    if (
      Math.abs(b.lat - a.lat) > 1e-6 ||
      Math.abs(b.lon - a.lon) > 1e-6
    ) {
      heading = Math.round(bearingDeg(a.lat, a.lon, b.lat, b.lon));
    }
  }

  const body: TraceResponse = {
    hex,
    callsign,
    trajectory,
    origin,
    destination: null, // unknown for military — UI shows "Destination unknown"
    heading,
    sourceUrl: `https://www.airplanes.live/view/?icao=${hex}`,
    fetchedAt: Date.now(),
    cached: false,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
