// airplanes.live military aircraft client.
// Free API, no auth required: https://api.airplanes.live/v2/mil
// Returns all live military contacts globally (~100-140 typical).
// Free tier: 500 requests/day — server-side cache (10 min TTL) keeps
// us well under limit (144 reqs/day max). See api/military-flights/route.ts.

export interface MilitaryFlight {
  icao24: string;
  callsign: string;
  registration: string;
  type: string; // ICAO type code (e.g. "C17", "H60", "EC45")
  description?: string; // Full description (e.g. "Boeing C-17A Globemaster III")
  operator?: string; // e.g. "United States Air Force"
  longitude: number;
  latitude: number;
  altitude: number | null; // meters, baro
  onGround: boolean;
  velocity: number | null; // m/s
  heading: number; // degrees
  category?: string; // A1-A7 (rotor/fixed/multi-engine)
  squawk?: string;
  emergency?: string;
  lastContact: number; // unix seconds
}

interface AirplanesLiveAc {
  hex?: string;
  flight?: string;
  r?: string; // registration
  t?: string; // type
  desc?: string;
  ownOp?: string; // operator
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  category?: string;
  squawk?: string;
  emergency?: string;
  seen_pos?: number;
  seen?: number;
  type?: string; // mlat / adsb_icao / tisb
}

interface AirplanesLiveResponse {
  ac?: AirplanesLiveAc[];
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function toAltitude(ac: AirplanesLiveAc): number | null {
  if (ac.alt_baro === "ground") return 0;
  if (typeof ac.alt_baro === "number") return ac.alt_baro;
  if (typeof ac.alt_geom === "number") return ac.alt_geom;
  return null;
}

function mapAc(ac: AirplanesLiveAc): MilitaryFlight | null {
  const lat = typeof ac.lat === "number" ? ac.lat : null;
  const lon = typeof ac.lon === "number" ? ac.lon : null;
  if (lat == null || lon == null) return null;

  const hex = (ac.hex ?? "").toLowerCase();
  const callsign = (ac.flight ?? "").trim();
  const alt = toAltitude(ac);
  const now = Math.floor(Date.now() / 1000);

  return {
    icao24: hex || "unknown",
    callsign: callsign || ac.r || hex,
    registration: ac.r ?? "",
    type: ac.t ?? "",
    description: ac.desc,
    operator: ac.ownOp,
    longitude: lon,
    latitude: lat,
    altitude: alt,
    onGround: ac.alt_baro === "ground",
    velocity: toNum(ac.gs),
    heading: typeof ac.track === "number" ? ac.track : 0,
    category: ac.category,
    squawk: ac.squawk,
    emergency: ac.emergency,
    lastContact: typeof ac.seen === "number" ? now - Math.floor(ac.seen) : now,
  };
}

export async function fetchMilitaryFlights(
  signal?: AbortSignal,
): Promise<MilitaryFlight[]> {
  const url = "https://api.airplanes.live/v2/mil";
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "spectre/0.1 (osint monitor)" },
    signal,
  });
  if (!res.ok) {
    throw new Error(`airplanes.live ${res.status}`);
  }
  const data = (await res.json()) as AirplanesLiveResponse;
  if (!data.ac) return [];

  const out: MilitaryFlight[] = [];
  for (const ac of data.ac) {
    const mapped = mapAc(ac);
    if (mapped) out.push(mapped);
  }
  return out;
}
