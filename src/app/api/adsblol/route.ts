// GET /api/adsblol?lat=..&lon=..&radius=..
//
// Proxy for adsb.lol's viewport-based aircraft endpoint. adsb.lol is a
// free, keyless community ADS-B aggregator with broader receiver coverage
// than OpenSky in some regions (notably Southeast Asia, parts of Africa,
// and South America). Used as a secondary source to fill gaps in OpenSky's
// coverage.
//
// Endpoint: https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}
// Returns aircraft within {radius} nautical miles of the point.
//
// Response is normalized to the OpenSky state-vector shape so the existing
// flights layer can consume it without changes.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const KNOT_TO_MPS = 0.514444;
const FOOT_TO_M = 0.3048;
const FPM_TO_MPS = 0.00508;

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function emitterCategory(value: unknown): number {
  const cat = String(value || "").trim().toUpperCase();
  const categories: Record<string, number> = {
    A1: 2, A2: 3, A3: 4, A4: 5, A5: 6, A6: 7, A7: 8,
    B1: 9, B2: 10, B3: 11, B4: 12, B6: 14, B7: 15,
  };
  return categories[cat] || 0;
}

interface AdsbLolAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  seen?: number;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  baro_rate?: number;
  geom_rate?: number;
  track?: number;
  squawk?: string;
  spi?: number;
  category?: string;
  t?: string;
}

interface AdsbLolResponse {
  now?: number;
  ac?: AdsbLolAircraft[];
}

/**
 * Convert one adsb.lol aircraft record into an OpenSky-compatible state vector.
 */
function normalizeAircraft(
  aircraft: AdsbLolAircraft,
  nowSeconds: number,
): unknown[] | null {
  const hex = String(aircraft?.hex || "").trim().toLowerCase();
  const latitude = finiteNumber(aircraft?.lat);
  const longitude = finiteNumber(aircraft?.lon);
  if (!hex || latitude === null || longitude === null) return null;

  const seenPosition = Math.max(0, finiteNumber(aircraft?.seen_pos) ?? finiteNumber(aircraft?.seen) ?? 0);
  const seen = Math.max(0, finiteNumber(aircraft?.seen) ?? seenPosition);
  const onGround = aircraft?.alt_baro === "ground";
  const barometricFeet = onGround ? null : finiteNumber(aircraft?.alt_baro);
  const geometricFeet = finiteNumber(aircraft?.alt_geom);
  const groundSpeedKnots = finiteNumber(aircraft?.gs);
  const verticalRateFpm = finiteNumber(aircraft?.baro_rate) ?? finiteNumber(aircraft?.geom_rate);
  const track = finiteNumber(aircraft?.track);

  return [
    hex,                                                          // 0  icao24
    String(aircraft?.flight || aircraft?.r || "").trim() || null, // 1  callsign
    null,                                                         // 2  origin_country
    Math.max(0, nowSeconds - seenPosition),                       // 3  time_position
    Math.max(0, nowSeconds - seen),                               // 4  last_contact
    longitude,                                                    // 5  longitude
    latitude,                                                     // 6  latitude
    barometricFeet === null ? null : barometricFeet * FOOT_TO_M,  // 7  baro_altitude (m)
    onGround,                                                     // 8  on_ground
    groundSpeedKnots === null ? null : groundSpeedKnots * KNOT_TO_MPS, // 9  velocity (m/s)
    track,                                                        // 10 true_track (deg)
    verticalRateFpm === null ? null : verticalRateFpm * FPM_TO_MPS, // 11 vertical_rate (m/s)
    null,                                                         // 12 sensors
    geometricFeet === null ? null : geometricFeet * FOOT_TO_M,    // 13 geo_altitude (m)
    aircraft?.squawk || null,                                     // 14 squawk
    aircraft?.spi === 1,                                          // 15 spi
    0,                                                            // 16 position_source
    emitterCategory(aircraft?.category),                          // 17 category (extended)
    String(aircraft?.t || "").trim() || null,                     // 18 typeCode (ICAO type designator)
  ];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lon = parseFloat(searchParams.get("lon") ?? "");
  const radius = parseInt(searchParams.get("radius") ?? "250", 10);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { error: "Missing or invalid lat/lon parameters" },
      { status: 400 },
    );
  }

  // Clamp radius to adsb.lol's max of 250nm.
  const clampedRadius = Math.min(Math.max(radius, 1), 250);

  const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${clampedRadius}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `adsb.lol returned ${res.status}`, states: null, time: 0 },
        { status: 502 },
      );
    }

    const payload = (await res.json()) as AdsbLolResponse;
    const responseNow = finiteNumber(payload?.now);
    const nowSeconds = responseNow === null
      ? Math.floor(Date.now() / 1000)
      : Math.floor(responseNow > 10_000_000_000 ? responseNow / 1000 : responseNow);

    const states = (Array.isArray(payload?.ac) ? payload.ac : [])
      .map((a) => normalizeAircraft(a, nowSeconds))
      .filter(Boolean);

    return NextResponse.json(
      { time: nowSeconds, states },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to reach adsb.lol", states: null, time: 0 },
      { status: 502 },
    );
  }
}
