// GET /api/flights/track?icao24=X
//
// Returns the live trajectory + origin/destination airports for a flight.
// Pulls two OpenSky endpoints in parallel:
//
//   1. /tracks/all?icao24=..&time=0 - current trajectory waypoints (past +
//      projected near-future). Source of the polyline we render on the globe.
//      When the aircraft is grounded this returns 404, so we rewind to the
//      lastSeen timestamp and fetch the touchdown trajectory instead.
//   2. /flights/aircraft?icao24=..&begin=..&end=.. - recent flight
//      records with estDepartureAirport / estArrivalAirport (ICAO codes).
//
// Requests are authenticated with OAuth2 client credentials (opensky-auth).
//
// Response shape:
//   {
//     icao24, callsign,
//     trajectory: [{ time, lat, lon, alt }],   // ordered oldest -> newest
//     origin: "WIII" | null,                    // ICAO airport code
//     destination: "WIPP" | null,
//     firstSeen: 1234567890 | null,             // unix seconds
//     lastSeen: 1234567890 | null,
//     sourceUrl: "https://opensky-network.org/..."
//   }

import { NextResponse } from "next/server";
import { openskyAuthHeaders } from "@/lib/opensky-auth";
import { getAirportCoords } from "@/lib/airport-coords";

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

interface OpenSkyFlightRecord {
  icao24: string;
  firstSeen: number;
  estDepartureAirport: string | null;
  lastSeen: number;
  estArrivalAirport: string | null;
  callsign?: string | null;
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
  originAirport: AirportCoordRef | null;
  destinationAirport: AirportCoordRef | null;
  firstSeen: number | null;
  lastSeen: number | null;
  live: boolean;
  aircraftType: string | null;
  aircraftModel: string | null;
  operator: string | null;
  registration: string | null;
  // AeroDataBox schedule fields
  departureScheduled: string | null;  // ISO UTC
  departureRevised: string | null;    // ISO UTC (actual/estimated)
  arrivalScheduled: string | null;
  arrivalRevised: string | null;
  flightStatus: string | null;        // e.g. "EnRoute", "Scheduled", "Arrived", "Departed"
  departureGate: string | null;
  departureTerminal: string | null;
  arrivalGate: string | null;
  arrivalTerminal: string | null;
  sourceUrl: string;
  fetchedAt: number;
}

const OPENSKY_BASE = "https://opensky-network.org/api";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const icao24 = (searchParams.get("icao24") ?? "").trim().toLowerCase();

  if (!icao24 || !/^[a-f0-9]{1,6}$/.test(icao24)) {
    return NextResponse.json(
      { error: "Missing or invalid icao24 (expected hex string)" },
      { status: 400 },
    );
  }

  const headers = await openskyAuthHeaders();

  const trackUrl = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}&time=0`;

  // Flight history: fetch recent flight records for origin/destination.
  // Use a 48h lookback window so recently landed planes still resolve.
  const now = Math.floor(Date.now() / 1000);
  const begin = now - 48 * 3600;
  const end = now;
  const flightUrl = `${OPENSKY_BASE}/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`;

  // hexdb.io: free, keyless API for aircraft details (from ICAO24).
  // Returns type code, model, operator, registration.
  const hexdbAircraftUrl = `https://hexdb.io/api/v1/aircraft/${icao24}`;

  const [trackRes, flightRes, hexdbAircraftRes] = await Promise.allSettled([
    fetch(trackUrl, { cache: "no-store", headers }),
    fetch(flightUrl, { cache: "no-store", headers }),
    fetch(hexdbAircraftUrl, { cache: "no-store" }),
  ]);

  // 404 on /tracks means the aircraft has no active trajectory right now
  // (likely on the ground or out of coverage). That's not an error - we
  // return an empty trajectory but still try to surface airport info.
  let trajectory: { time: number; lat: number; lon: number; alt: number | null }[] = [];
  let callsign: string | null = null;
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
        // Bad JSON - fall through with empty trajectory
      }
    }
  }

  // Most recent completed/ongoing flight record.
  let origin: string | null = null;
  let destination: string | null = null;
  let firstSeen: number | null = null;
  let lastSeen: number | null = null;

  if (flightRes.status === "fulfilled") {
    if (flightRes.value.ok) {
      try {
        const flights = (await flightRes.value.json()) as OpenSkyFlightRecord[];
        if (Array.isArray(flights) && flights.length > 0) {
          // Pick the most recent flight by lastSeen.
          const sorted = [...flights].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
          const f = sorted[0];
          origin = f.estDepartureAirport ?? null;
          destination = f.estArrivalAirport ?? null;
          firstSeen = f.firstSeen ?? null;
          lastSeen = f.lastSeen ?? null;
          if (!callsign && f.callsign) {
            callsign = f.callsign.trim();
          }
        }
      } catch {
        // Bad JSON - continue without airport info
      }
    }
  }

  // Landed / grounded plane: OpenSky has no live trajectory at time=0, but
  // it DOES retain the trajectory as of any historical timestamp. Rewind
  // to the moment of touchdown (lastSeen) so we can show the flight path.
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
      // Historical track unavailable - land with empty trajectory
    }
  }

  // Aircraft details from hexdb.io (type, model, operator, registration).
  let aircraftType: string | null = null;
  let aircraftModel: string | null = null;
  let operator: string | null = null;
  let registration: string | null = null;

  if (hexdbAircraftRes.status === "fulfilled") {
    if (hexdbAircraftRes.value.ok) {
      try {
        const meta = await hexdbAircraftRes.value.json() as {
          ModeS?: string;
          Registration?: string;
          Manufacturer?: string;
          ICAOTypeCode?: string;
          Type?: string;
          RegisteredOwners?: string;
          OperatorFlagCode?: string;
        };
        aircraftType = meta.ICAOTypeCode ?? null;
        aircraftModel = meta.Type ?? null;
        operator = meta.RegisteredOwners ?? null;
        registration = meta.Registration ?? null;
      } catch {
        // Bad JSON - continue without metadata
      }
    }
  }

  // If we have a callsign, also look up the route from hexdb.io.
  // This fills in origin/destination when OpenSky's /flights/aircraft
  // doesn't have them (common for live in-flight planes).
  if (callsign) {
    try {
      const routeRes = await fetch(
        `https://hexdb.io/api/v1/route/icao/${encodeURIComponent(callsign)}`,
        { cache: "no-store" },
      );
      if (routeRes.ok) {
        const routeData = await routeRes.json() as {
          flight?: string;
          route?: string; // "ORIGIN-DEST" format
        };
        if (routeData.route && typeof routeData.route === "string") {
          const parts = routeData.route.split("-");
          if (parts.length >= 2) {
            if (!origin) origin = parts[0].trim();
            if (!destination) destination = parts[1].trim();
          }
        }
      }
    } catch {
      // Route lookup failed - continue with what we have
    }
  }

  // Final fallback: AeroDataBox via RapidAPI. Uses the callsign to look up
  // the scheduled flight, which has departure/arrival airport ICAO codes,
  // scheduled/revised times, flight status, gate and terminal info.
  // Fires when OpenSky + hexdb both failed to resolve origin/dest, OR when
  // we don't yet have schedule times (which is always - OpenSky doesn't
  // provide them). Free tier: 600 API-units/month. TIER 2 = 1 unit per call.
  let departureScheduled: string | null = null;
  let departureRevised: string | null = null;
  let arrivalScheduled: string | null = null;
  let arrivalRevised: string | null = null;
  let flightStatus: string | null = null;
  let departureGate: string | null = null;
  let departureTerminal: string | null = null;
  let arrivalGate: string | null = null;
  let arrivalTerminal: string | null = null;

  if (callsign) {
    const rapidKey = process.env.RAPIDAPI_KEY;
    if (rapidKey) {
      try {
        const adbRes = await fetch(
          `https://aerodatabox.p.rapidapi.com/flights/CallSign/${encodeURIComponent(callsign)}`,
          {
            cache: "no-store",
            headers: {
              "X-RapidAPI-Key": rapidKey,
              "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
            },
          },
        );
        if (adbRes.ok) {
          const flights = await adbRes.json() as Array<{
            status?: string;
            departure?: {
              airport?: { icao?: string | null };
              scheduledTime?: { utc?: string };
              revisedTime?: { utc?: string };
              gate?: string | null;
              terminal?: string | null;
            };
            arrival?: {
              airport?: { icao?: string | null };
              scheduledTime?: { utc?: string };
              revisedTime?: { utc?: string };
              gate?: string | null;
              terminal?: string | null;
            };
          }>;
          if (Array.isArray(flights) && flights.length > 0) {
            const f = flights[0];
            if (!origin && f.departure?.airport?.icao) {
              origin = f.departure.airport.icao;
            }
            if (!destination && f.arrival?.airport?.icao) {
              destination = f.arrival.airport.icao;
            }
            flightStatus = f.status ?? null;
            departureScheduled = f.departure?.scheduledTime?.utc ?? null;
            departureRevised = f.departure?.revisedTime?.utc ?? null;
            arrivalScheduled = f.arrival?.scheduledTime?.utc ?? null;
            arrivalRevised = f.arrival?.revisedTime?.utc ?? null;
            departureGate = f.departure?.gate ?? null;
            departureTerminal = f.departure?.terminal ?? null;
            arrivalGate = f.arrival?.gate ?? null;
            arrivalTerminal = f.arrival?.terminal ?? null;
          }
        }
      } catch {
        // AeroDataBox lookup failed - continue with what we have
      }
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
    aircraftType,
    aircraftModel,
    operator,
    registration,
    departureScheduled,
    departureRevised,
    arrivalScheduled,
    arrivalRevised,
    flightStatus,
    departureGate,
    departureTerminal,
    arrivalGate,
    arrivalTerminal,
    sourceUrl: callsign
      ? `https://www.flightaware.com/live/flight/${callsign.toUpperCase()}`
      : `https://opensky-network.org/aircraft-profile?icao24=${icao24}`,
    fetchedAt: Date.now(),
  };

  // Resolve airport details (name + city) for origin and destination so the
  // client can show "City - AIRPORT_NAME (ICAO)" instead of just the code.
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

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
