import { NextResponse } from "next/server";
import { NOTABLE_PEOPLE } from "@/lib/privateFlightsRegistry";
import {
  getLastKnownPosition,
  getLastFlight,
  recordPrivatePositions,
} from "@/lib/private-flights-store";
import { openskyAuthHeaders } from "@/lib/opensky-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// OpenSky returns state vectors as positional arrays. Indices documented at
// https://opensky-network.org/apidoc/rest.html#response
interface OpenSkyState {
  icao24: string;
  callsign: string;
  originCountry: string;
  lon: number;
  lat: number;
  altitude: number | null;
  onGround: boolean;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  lastContact: number;
}

interface CachedStates {
  ts: number;
  states: OpenSkyState[];
}

interface TailResult {
  tail: string;
  icao24: string | null;
  live: {
    lat: number;
    lon: number;
    altitude: number | null;
    heading: number;
    onGround: boolean;
    lastContact: number;
  } | null;
  lastKnown: {
    lat: number;
    lon: number;
    altitude: number | null;
    lastContact: number;
  } | null;
  lastFlight: {
    origin: string | null;
    destination: string | null;
    firstSeen: number | null;
    lastSeen: number | null;
    callsign: string | null;
  } | null;
}

interface PersonResult {
  name: string;
  description?: string;
  tailNumbers: string[];
  tails: TailResult[];
  liveDataAvailable: boolean;
  status: "airborne" | "grounded" | "unknown";
  latestTs: number;
}

interface ApiResponse {
  people: PersonResult[];
  feed?: PersonResult[];
  authConfigured: boolean;
}

// In-memory cache for global OpenSky /states/all response. Public API is
// heavily rate-limited, so we cache the full global snapshot for 60s and
// search it locally for each request.
const GLOBAL_STATES_CACHE_TTL_MS = 60_000;
let globalStatesCache: CachedStates | null = null;

function authConfigured(): boolean {
  return Boolean(
    process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET,
  );
}

async function fetchGlobalStates(signal?: AbortSignal): Promise<OpenSkyState[]> {
  const now = Date.now();
  if (globalStatesCache && now - globalStatesCache.ts < GLOBAL_STATES_CACHE_TTL_MS) {
    return globalStatesCache.states;
  }

  const url = "https://opensky-network.org/api/states/all?extended=1";
  const res = await fetch(url, {
    cache: "no-store",
    headers: await openskyAuthHeaders(),
    signal,
  });
  if (!res.ok) {
    throw new Error(`OpenSky ${res.status}`);
  }
  const data = (await res.json()) as { states: any[][] | null; time: number };
  if (!data.states) return [];

  const states: OpenSkyState[] = [];
  for (const s of data.states) {
    const lon = s[5];
    const lat = s[6];
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    states.push({
      icao24: (s[0] ?? "").trim().toLowerCase(),
      callsign: (s[1] ?? "").trim().toUpperCase(),
      originCountry: s[2] ?? "",
      lon,
      lat,
      altitude:
        typeof s[7] === "number" ? s[7] : typeof s[13] === "number" ? s[13] : null,
      onGround: Boolean(s[8]),
      velocity: typeof s[9] === "number" ? s[9] : null,
      heading: typeof s[10] === "number" ? s[10] : null,
      verticalRate: typeof s[11] === "number" ? s[11] : null,
      lastContact: typeof s[4] === "number" ? s[4] : data.time,
    });
  }

  // Accumulate last-known positions for any notable tail seen in this
  // snapshot, so we can answer "where were they last" after they land.
  try {
    recordPrivatePositions(
      states.map((s) => ({
        icao24: s.icao24,
        callsign: s.callsign,
        lon: s.lon,
        lat: s.lat,
        alt: s.altitude,
        lastContact: s.lastContact,
      })),
    );
  } catch {
    // never fatal
  }

  globalStatesCache = { ts: now, states };
  return states;
}

function normalizeTail(t: string): string {
  return t.toUpperCase().replace(/\s+/g, "");
}

// Build the per-tail detail for one person. live comes from the current
// snapshot; lastKnown from the accumulated store; lastFlight is queried
// on demand (OpenSky flight history) and cached for 6h server-side.
async function buildPerson(
  person: (typeof NOTABLE_PEOPLE)[number],
  states: OpenSkyState[],
  statesReachable: boolean,
  wantLastFlight: boolean,
): Promise<PersonResult> {
  const tailSet = new Set(person.tailNumbers.map(normalizeTail));

  const liveByTail = new Map<string, OpenSkyState>();
  for (const s of states) {
    const t = normalizeTail(s.callsign);
    if (t && tailSet.has(t)) liveByTail.set(t, s);
  }

  const tails: TailResult[] = [];
  let airborne = false;
  let latestTs = 0;

  for (const tail of person.tailNumbers) {
    const norm = normalizeTail(tail);
    const live = liveByTail.get(norm);

    // icao24: prefer the one observed live; else resolve via deterministic
    // N-number algorithm (US tails only).
    const icao24 =
      (live ? live.icao24 : null) ??
      (await import("@/lib/private-flights-store")).tailToIcao24(tail);

    let lastFlight = null;
    if (wantLastFlight && icao24) {
      const res = await getLastFlight(icao24);
      lastFlight = res.lastFlight;
    }

    const lastKnown = getLastKnownPosition(norm);

    const tailResult: TailResult = {
      tail,
      icao24,
      live: live
        ? {
            lat: live.lat,
            lon: live.lon,
            altitude: live.altitude,
            heading: live.heading ?? 0,
            onGround: live.onGround,
            lastContact: live.lastContact,
          }
        : null,
      lastKnown: lastKnown
        ? {
            lat: lastKnown.lat,
            lon: lastKnown.lon,
            altitude: lastKnown.alt,
            lastContact: lastKnown.lastContact,
          }
        : null,
      lastFlight,
    };
    tails.push(tailResult);

    if (live) {
      airborne = true;
      if (live.lastContact > latestTs) latestTs = live.lastContact;
    } else if (lastKnown) {
      if (lastKnown.lastContact > latestTs) latestTs = lastKnown.lastContact;
    } else if (lastFlight?.lastSeen && lastFlight.lastSeen > latestTs) {
      latestTs = lastFlight.lastSeen;
    }
  }

  return {
    name: person.name,
    description: person.description,
    tailNumbers: person.tailNumbers,
    tails,
    liveDataAvailable: statesReachable,
    status: airborne ? "airborne" : latestTs > 0 ? "grounded" : "unknown",
    latestTs,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const feedMode = searchParams.get("feed") === "1";

  let states: OpenSkyState[] = [];
  let statesReachable = true;
  try {
    states = await fetchGlobalStates();
  } catch {
    statesReachable = false;
  }

  const auth = authConfigured();

  // FEED MODE: ?feed=1 → the N most "active" notable people, sorted by most
  // recent contact (airborne first), for the right-side panel's scrollable
  // "latest private flights" list.
  if (feedMode) {
    // Ask OpenSky for last-flight history only for the people we're going to
    // show (bounded by FEED_LIMIT) so the rate limit isn't hammered.
    const FEED_LIMIT = 10;
    const people = await Promise.all(
      NOTABLE_PEOPLE.map((p) => buildPerson(p, states, statesReachable, false)),
    );
    const sorted = people.sort(
      (a, b) =>
        Number(b.status === "airborne") - Number(a.status === "airborne") ||
        b.latestTs - a.latestTs,
    );
    // Enrich in ranked order with last-flight history, so "last landed at"
    // is available right away. Bounded: one icao24 each. OpenSky's
    // /flights/aircraft endpoint is strictly rate-limited, so we serialize
    // the lookups (no Promise.all storm) with a short delay.
    const enriched: PersonResult[] = [];
    for (const p of sorted) {
      const np = NOTABLE_PEOPLE.find((x) => x.name === p.name);
      if (!np) continue;
      enriched.push(await buildPerson(np, states, statesReachable, true));
      await new Promise((r) => setTimeout(r, 250));
    }
    // Drop people with zero data anywhere (no live position, no accumulated
    // last-known position, no flight history) — e.g. Bill Gates when OpenSky
    // has no record for his tails. Keep the list honest.
    const hasAnyData = (p: PersonResult) =>
      p.tails.some((t) => t.live || t.lastKnown || t.lastFlight);
    const feed = enriched
      .filter(hasAnyData)
      .slice(0, FEED_LIMIT)
      .sort(
        (a, b) =>
          Number(b.status === "airborne") - Number(a.status === "airborne") ||
          b.latestTs - a.latestTs,
      );
    return NextResponse.json(
      {
        people: [],
        feed,
        authConfigured: auth,
      } satisfies ApiResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!q) {
    return NextResponse.json({ people: [], authConfigured: auth } satisfies ApiResponse);
  }

  const qLower = q.toLowerCase();
  // Match by person name OR by tail number (e.g. "N628TS") so the panel can
  // resolve a tail to its owner.
  const matchedPeople = NOTABLE_PEOPLE.filter(
    (p) =>
      p.name.toLowerCase().includes(qLower) ||
      p.tailNumbers.some((t) => t.toLowerCase().includes(qLower)),
  );

  if (matchedPeople.length === 0) {
    return NextResponse.json({ people: [], authConfigured: auth } satisfies ApiResponse);
  }

  const people: PersonResult[] = await Promise.all(
    matchedPeople.map((p) => buildPerson(p, states, statesReachable, true)),
  );

  return NextResponse.json(
    { people, authConfigured: auth } satisfies ApiResponse,
    { headers: { "Cache-Control": "no-store" } },
  );
}
