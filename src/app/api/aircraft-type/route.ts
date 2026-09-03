// GET /api/aircraft-type?icao24=X
//
// Server-side proxy for hexdb.io type-code lookups. Returns the ICAO type
// designator and mapped AircraftClass for a given ICAO24 transponder hex.
// Module-level cache survives for the server process lifetime; null results
// are cached too so unknown aircraft aren't re-queried.

import { NextResponse } from "next/server";
import { classifyAircraft, type AircraftClass } from "@/globe/layers/aircraft-class";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

interface CachedEntry {
  typeCode: string | null;
  klass: AircraftClass;
}

const _cache = new Map<string, CachedEntry>();

interface HexdbResponse {
  ICAOTypeCode?: string;
  [k: string]: unknown;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const icao24 = String(searchParams.get("icao24") ?? "").trim().toLowerCase();

  if (!icao24 || !/^[0-9a-f]{1,8}$/.test(icao24)) {
    return NextResponse.json(
      { error: "Missing or invalid icao24 parameter" },
      { status: 400 },
    );
  }

  const cached = _cache.get(icao24);
  if (cached) {
    return NextResponse.json(
      { icao24, typeCode: cached.typeCode, class: cached.klass },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`https://hexdb.io/api/v1/aircraft/${icao24}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (res.status === 404) {
      const entry: CachedEntry = { typeCode: null, klass: classifyAircraft({}) };
      _cache.set(icao24, entry);
      return NextResponse.json(
        { icao24, typeCode: null, class: entry.klass },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `hexdb.io returned ${res.status}` },
        { status: 502 },
      );
    }

    const payload = (await res.json()) as HexdbResponse;
    const typeCode = String(payload?.ICAOTypeCode ?? "").trim() || null;
    const klass = classifyAircraft({ typeCode: typeCode ?? undefined });
    const entry: CachedEntry = { typeCode, klass };
    _cache.set(icao24, entry);

    return NextResponse.json(
      { icao24, typeCode, class: klass },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to reach hexdb.io" },
      { status: 502 },
    );
  }
}
