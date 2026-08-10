// ICAO airport-code → coordinates resolver.
//
// Backed by the OpenFlights public-domain airport dataset (OurAirports
// export) fetched once from raw.githubusercontent.com and cached in memory
// for the lifetime of the server process. Used by /api/flights/track to
// anchor the "landed here" marker at the destination airport when OpenSky
// has no retained trajectory for a grounded aircraft.

const AIRPORTS_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";

export interface AirportCoords {
  icao: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

let cache: Map<string, AirportCoords> | null = null;
let cachePromise: Promise<Map<string, AirportCoords>> | null = null;

// airports.dat lines look like:
//   3582,"Long Beach /Daugherty Field/ Airport","Long Beach","United States","LGB","KLGB",33.81769943,-118.1520004,60,-8,"A","America/Los_Angeles","airport","OurAirports"
// Columns: id, name, city, country, IATA, ICAO, lat, lon, alt, tz offset, DST, tz db, type, source
function parseAirportsDat(text: string): Map<string, AirportCoords> {
  const map = new Map<string, AirportCoords>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuote = !inQuote;
      } else if (c === "," && !inQuote) {
        cols.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cols.push(cur);
    if (cols.length < 8) continue;
    const icao = (cols[5] || "").trim().toUpperCase();
    const lat = Number(cols[6]);
    const lon = Number(cols[7]);
    if (!icao || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    map.set(icao, {
      icao,
      name: cols[1] || icao,
      city: cols[2] || "",
      lat,
      lon,
    });
  }
  return map;
}

async function load(): Promise<Map<string, AirportCoords>> {
  if (cache) return cache;
  if (!cachePromise) {
    cachePromise = (async () => {
      try {
        const res = await fetch(AIRPORTS_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`airports.dat HTTP ${res.status}`);
        const text = await res.text();
        cache = parseAirportsDat(text);
        return cache;
      } catch {
        // Offline / GitHub unreachable — cache an empty map so we don't
        // retry the download on every request.
        cache = new Map();
        return cache;
      } finally {
        cachePromise = null;
      }
    })();
  }
  return cachePromise;
}

export async function getAirportCoords(
  icao: string | null | undefined,
): Promise<AirportCoords | null> {
  if (!icao) return null;
  const code = icao.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(code)) return null;
  const map = await load();
  return map.get(code) ?? null;
}
