// OpenSky Network client — private jet filter for Indonesia airspace.
// Free API: https://opensky-network.org/api/states/all (anonymous, ~400 req/day).
// OpenSky returns raw state vectors; callsign-based filtering is required because
// the public API does not expose aircraft type or operator.
import { openskyAuthHeaders } from "@/lib/opensky-auth";

export type FlightKind = "private";

export interface FlightState {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number;
  latitude: number;
  altitude: number | null;
  onGround: boolean;
  velocity: number | null;
  heading: number;
  verticalRate: number | null;
  lastContact: number;
  kind: FlightKind;
  // OpenSky ADS-B emitter category (only present with ?extended=1).
  // 2 = Light (<15500 lbs), 3 = Small (15500–75000), 4 = Large,
  // 5 = High Vortex, 6 = Heavy (>300000), 8 = Rotorcraft, etc.
  // Null when the aircraft reports no category info.
  category: number | null;
}

// Known commercial airline ICAO codes (3-char). If a callsign's first 3 chars
// match this set, the aircraft is EXCLUDED.
const AIRLINE_CODES = new Set<string>([
  // Indonesia
  "GIA", "CTV", "LNI", "BTK", "AWQ", "SJY", "RSD", "AXM", "KNE", "TVJ",
  "WON", "NAM", "INN", "IAX", "ONU", "ULA", "TJN", "SVR", "IIM", "MSF",
  // US majors + regionals
  "AAL", "UAL", "DAL", "SWA", "ASA", "FDX", "UPS", "NCA", "ACA", "JBU",
  "ALK", "SKW", "EDV", "ENY", "RPA", "SCX", "GTI", "ATN", "CQN", "LOF",
  // Europe / Middle East / Asia majors
  "BAW", "AFR", "DLH", "KLM", "UAE", "QTR", "ETD", "SIA", "THA", "MAS",
  "ANA", "JAL", "KAL", "AAR", "JJA", "TWB", "CCA", "CSN", "CES", "CSZ",
  "QFA", "JST", "VOZ", "THY", "PGT", "AZA", "IBE", "SWR", "AUA", "SAS",
  "FIN", "LOT", "TAP", "GEC", "GLP", "CFG", "SAA", "ETH", "KAC", "OZA",
  // Cargo + others
  "PAC", "PZZ", "GTW", "CKS", "CKK", "NCA", "ABW", "GEC", "AJT", "RAX",
]);

// General aviation / private registration prefixes (first 1-3 chars).
const GA_PREFIXES = ["N", "PK", "PKA", "8P", "GA", "VH", "ZK", "C"];

function classifyCallsign(raw: string): FlightKind | "commercial" | "skip" {
  const cs = raw.trim().toUpperCase();
  if (!cs) return "skip";
  const first3 = cs.slice(0, 3);
  // Commercial airline match — exclude
  if (AIRLINE_CODES.has(first3)) return "commercial";
  // Private / GA — N (US), PK (Indonesia), VH (Australia), ZK (NZ), C-F/C-G (Canada)
  if (/^N\d/.test(cs) || /^PK[A-Z]?/.test(cs) || /^8P/.test(cs) ||
      /^VH/.test(cs) || /^ZK/.test(cs) || /^C[FGHJ]/.test(cs) ||
      /^GA\d/.test(cs) || /^PK\-/.test(cs)) {
    return "private";
  }
  // Unknown 3+3 numeric pattern — likely commercial, skip
  if (/^[A-Z]{3}\d/.test(cs)) return "commercial";
  // Otherwise leave as "skip" (low confidence)
  return "skip";
}

interface RawState {
  states: any[][] | null;
  time: number;
}

// Fetch private/GA flights globally (no bbox). OpenSky's /states/all
// without bbox returns all state vectors worldwide — same 1 credit cost
// as a bbox query. We filter client-side for private callsigns.
export async function fetchGlobalFlights(
  signal?: AbortSignal,
): Promise<FlightState[]> {
  // extended=1 adds the ADS-B emitter category (index 17) — the strongest
  // signal we have that an aircraft is actually a small private jet rather
  // than an airliner that slipped past the callsign filter.
  const url = "https://opensky-network.org/api/states/all?extended=1";

  const res = await fetch(url, {
    cache: "no-store",
    headers: await openskyAuthHeaders(),
    signal,
  });
  if (!res.ok) {
    throw new Error(`OpenSky ${res.status}`);
  }
  const data = (await res.json()) as RawState;
  if (!data.states) return [];

  const out: FlightState[] = [];
  for (const s of data.states) {
    const callsign = (s[1] ?? "").trim();
    const classification = classifyCallsign(callsign);
    if (classification !== "private") continue;

    const lon = s[5];
    const lat = s[6];
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    // Category index 17. Heavy/large/high-vortex (4,5,6) are never private
    // jets — drop them even if the callsign looked private.
    const category = typeof s[17] === "number" ? (s[17] as number) : null;
    if (category === 4 || category === 5 || category === 6) continue;

    out.push({
      icao24: s[0] ?? "",
      callsign,
      originCountry: s[2] ?? "",
      longitude: lon,
      latitude: lat,
      altitude: typeof s[7] === "number" ? s[7] : (typeof s[13] === "number" ? s[13] : null),
      onGround: Boolean(s[8]),
      velocity: typeof s[9] === "number" ? s[9] : null,
      heading: typeof s[10] === "number" ? s[10] : 0,
      verticalRate: typeof s[11] === "number" ? s[11] : null,
      lastContact: typeof s[4] === "number" ? s[4] : data.time,
      kind: classification,
      category,
    });
  }
  return out;
}
