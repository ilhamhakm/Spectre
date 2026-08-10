import { NextResponse } from "next/server";
import { fetchGlobalFlights } from "@/lib/sources/opensky";
import { recordPrivatePositions } from "@/lib/private-flights-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  try {
    const flights = await fetchGlobalFlights();
    // Accumulate last-known positions for any notable tail in this snapshot,
    // so "where did they last land" keeps working even after a jet goes quiet.
    try {
      recordPrivatePositions(
        flights.map((f) => ({
          icao24: f.icao24,
          callsign: f.callsign,
          lon: f.longitude,
          lat: f.latitude,
          alt: f.altitude,
          lastContact: f.lastContact,
        })),
      );
    } catch {
      // never fatal
    }
    return NextResponse.json(
      { flights, count: flights.length, ts: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { flights: [], count: 0, error: e?.message ?? "fetch failed" },
      { status: 502 },
    );
  }
}
