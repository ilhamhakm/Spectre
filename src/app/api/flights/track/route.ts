// GET /api/flights/track?icao24=X
//
// Returns the live trajectory + origin/destination airports for a private
// flight. Pulls two OpenSky endpoints in parallel:
//
//   1. /tracks/all?icao24=..&time=0 — current trajectory waypoints (past +
//      projected near-future). Source of the polyline we render on the globe.
//      When the aircraft is grounded this returns 404, so we rewind to the
//      lastSeen timestamp and fetch the touchdown trajectory instead.
//   2. /flights/aircraft?icao24=..&begin=..&end=.. — recent flight
//      records with estDepartureAirport / estArrivalAirport (ICAO codes).
//
// Requests are authenticated with OAuth2 client credentials (opensky-auth).
//
// Response shape:
//   {
//     icao24, callsign,
//     trajectory: [{ time, lat, lon, alt }],   // ordered oldest → newest
//     origin: "WIII" | null,                    // ICAO airport code
//     destination: "WIPP" | null,
//     firstSeen: 1234567890 | null,             // unix seconds
//     lastSeen: 1234567890 | null,
//     sourceUrl: "https://opensky-network.org/..."
//   }

import { NextResponse } from "next/server";
import { openskyAuthHeaders } from "@/lib/opensky-auth";
import { getAirportCoords } from "@/lib/airport-coords";
import { getLastFlight } from "@/lib/private-flights-store";
import { getLastKnownPosition } from "@/lib/private-flights-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

interface OpenSkyTrackResponse {
  icao24: string;
  callsign?: string;
  startTime?: number;
  endTime?: number;
  path?: [[number, number, number, number | null, string, boolean]];
}

interface AirportCoordRef {
  icao: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

interface TrajectoryResponse {
  icao24: string;
  callsign: string | null;
  trajectory: { time: number; lat: number; lon: number; alt: number | null }[];
  origin: string | null;
  destination: string | null;
  // Resolved airport info (city + airport name) so the client can render a
  // friendly label like "Los Angeles · LAX" instead of just "KLAX".
  originAirport: AirportCoordRef | null;
  destinationAirport: AirportCoordRef | null;
  firstSeen: number | null;
  lastSeen: number | null;
  live: boolean;
  // When the aircraft is grounded and OpenSky has no retained trajectory,
  // we resolve the airports' coordinates so the client can still anchor the
  // "parked here now" marker (landedAirport = where it landed) and draw the
  // parabolic flight-path arc origin → destination (landedOriginAirport).
  landedAirport: AirportCoordRef | null;
  landedOriginAirport: AirportCoordRef | null;
  // Last known position from the live feed store (updated whenever the
  // notable tail is seen in /api/flights). Used as a fallback when OpenSky
  // rate-limits or has no trajectory + no airport coords.
  lastKnownPosition: { lat: number; lon: number; alt: number | null; lastContact: number } | null;
  sourceUrl: string;
  fetchedAt: number;
}

const OPENSKY_BASE = "https://opensky-network.org/api";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const icao24 = (searchParams.get("icao24") ?? "").trim().toLowerCase();
  const tail = (searchParams.get("tail") ?? "").trim().toUpperCase();

  if (!icao24 || !/^[a-f0-9]{1,6}$/.test(icao24)) {
    return NextResponse.json(
      { error: "Missing or invalid icao24 (expected hex string)" },
      { status: 400 },
    );
  }

  const headers = await openskyAuthHeaders();

  const trackUrl = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}&time=0`;

  // Flight history comes from the shared cached lookup (getLastFlight): it
  // reuses the 6h in-memory cache so a landed plane's origin/destination is
  // still returned while OpenSky's /flights/aircraft is rate-limiting.
  const [trackRes, flightRes] = await Promise.allSettled([
    fetch(trackUrl, { cache: "no-store", headers }),
    getLastFlight(icao24),
  ]);

  // 404 on /tracks means the aircraft has no active trajectory right now
  // (likely on the ground or out of coverage). That's not an error — we
  // return an empty trajectory but still try to surface airport info.
  let trajectory: { time: number; lat: number; lon: number; alt: number | null }[] = [];
  let callsign: string | null = null;
  // `live` is true when OpenSky returned an in-progress trajectory at the
  // current time (the aircraft is airborne right now).
  let live = false;

  if (trackRes.status === "fulfilled") {
    if (trackRes.value.ok) {
      try {
        const track = (await trackRes.value.json()) as OpenSkyTrackResponse;
        if (track.callsign && track.callsign.trim()) {
          callsign = track.callsign.trim();
        }
        if (Array.isArray(track.path)) {
          for (const p of track.path) {
            if (!Array.isArray(p) || p.length < 4) continue;
            const [time, lat, lon, alt] = p;
            if (
              typeof time !== "number" ||
              typeof lat !== "number" ||
              typeof lon !== "number"
            ) {
              continue;
            }
            trajectory.push({
              time,
              lat,
              lon,
              alt: typeof alt === "number" ? alt : null,
            });
          }
        }
        live = trajectory.length > 0;
      } catch {
        // Bad JSON — fall through with empty trajectory
      }
    }
  }

  // Most recent completed/ongoing flight record (cached, tolerates 429s).
  let origin: string | null = null;
  let destination: string | null = null;
  let firstSeen: number | null = null;
  let lastSeen: number | null = null;

  if (flightRes.status === "fulfilled" && flightRes.value.lastFlight) {
    const f = flightRes.value.lastFlight;
    origin = f.origin ?? null;
    destination = f.destination ?? null;
    firstSeen = f.firstSeen ?? null;
    lastSeen = f.lastSeen ?? null;
    if (!callsign && f.callsign) {
      callsign = f.callsign.trim();
    }
  }

  // Landed / grounded plane: OpenSky has no live trajectory at time=0, but it
  // DOES retain the trajectory as of any historical timestamp. Rewind to the
  // moment of touchdown (lastSeen from the most recent flight record) — that
  // trajectory's final waypoint is exactly where the aircraft is parked now.
  if (!live && trajectory.length === 0 && typeof lastSeen === "number") {
    try {
      const histRes = await fetch(
        `${OPENSKY_BASE}/tracks/all?icao24=${icao24}&time=${Math.floor(lastSeen)}`,
        { cache: "no-store", headers },
      );
      if (histRes.ok) {
        const hist = (await histRes.json()) as OpenSkyTrackResponse;
        if (Array.isArray(hist.path)) {
          for (const p of hist.path) {
            if (!Array.isArray(p) || p.length < 4) continue;
            const [time, lat, lon, alt] = p;
            if (
              typeof time !== "number" ||
              typeof lat !== "number" ||
              typeof lon !== "number"
            ) {
              continue;
            }
            trajectory.push({
              time,
              lat,
              lon,
              alt: typeof alt === "number" ? alt : null,
            });
          }
        }
      }
    } catch {
      // Historical track unavailable — land with empty trajectory
    }
  }

  const body: TrajectoryResponse = {
    icao24,
    callsign,
    trajectory,
    origin,
    destination,
    originAirport: null,
    destinationAirport: null,
    firstSeen,
    lastSeen,
    live,
    landedAirport: null,
    landedOriginAirport: null,
    lastKnownPosition: null,
    sourceUrl: `https://opensky-network.org/aircraft-profile?icao24=${icao24}`,
    fetchedAt: Date.now(),
  };

  // Resolve airport details (name + city) for origin and destination so the
  // client can show "City · AIRPORT_NAME (ICAO)" instead of just the code.
  if (origin) {
    const ap = await getAirportCoords(origin);
    if (ap) {
      body.originAirport = { icao: ap.icao, name: ap.name, city: ap.city, lat: ap.lat, lon: ap.lon };
    }
  }
  if (destination) {
    const ap = await getAirportCoords(destination);
    if (ap) {
      body.destinationAirport = { icao: ap.icao, name: ap.name, city: ap.city, lat: ap.lat, lon: ap.lon };
    }
  }

  // Grounded + no retained trajectory: resolve the airports' coordinates so
  // the client can anchor the landed marker and draw the origin→destination
  // parabolic flight path. Resolved once and cached in process memory.
  if (!live) {
    if (trajectory.length === 0 && destination) {
      const ap = await getAirportCoords(destination);
      if (ap) {
        body.landedAirport = { icao: ap.icao, name: ap.name, city: ap.city, lat: ap.lat, lon: ap.lon };
      }
    }
    // Origin is needed regardless for the parabolic arc's start point, and
    // doubles as a last-resort marker anchor when no destination exists.
    if (origin && !body.landedOriginAirport) {
      const ap = await getAirportCoords(origin);
      if (ap) {
        body.landedOriginAirport = {
          icao: ap.icao,
          name: ap.name,
          city: ap.city,
          lat: ap.lat,
          lon: ap.lon,
        };
      }
    }
  }

  // Last-known-position fallback: if we have no trajectory AND no airport
  // coords (OpenSky rate-limited or no flight history), fall back to the
  // last position the live feed saw for this tail. This ensures the client
  // always has SOMETHING to anchor a marker + flyTo when tracking a jet.
  if (
    !live &&
    trajectory.length === 0 &&
    !body.landedAirport &&
    !body.landedOriginAirport &&
    tail
  ) {
    const lkp = getLastKnownPosition(tail);
    if (lkp) {
      body.lastKnownPosition = {
        lat: lkp.lat,
        lon: lkp.lon,
        alt: lkp.alt,
        lastContact: lkp.lastContact,
      };
    }
  }

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
