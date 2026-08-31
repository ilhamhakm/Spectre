// Enrichment data fetchers for the region detail / hover panels.
//
// Three external sources, all free / no API key, with in-memory caches:
//   - Wikipedia REST summary: first paragraph extract + thumbnail image +
//     short description + coordinates. Works for countries, states, and
//     cities (any title that resolves to a Wikipedia article).
//   - REST Countries (https://restcountries.com): currencies, languages,
//     calling codes, timezones, driving side, landlocked, bordering
//     countries, subregion, UN/EEA/independence status, coat of arms.
//     Countries only, keyed by ISO2 code.
//   - Open-Meteo (https://api.open-meteo.com): elevation at the centroid,
//     current weather (temp, wind, conditions), today's sunrise/sunset,
//     and today's high/low temp. Works for any lat/lon worldwide.

export interface WikiSummary {
  title: string;
  extract: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  url: string | null;
}

export interface RestCountry {
  currencies: string[]; // e.g. ["EUR - Euro"]
  languages: string[]; // e.g. ["French"]
  callingCodes: string[]; // e.g. ["+33"]
  timezones: string[]; // e.g. ["UTC+01:00"]
  drivingSide: string | null; // "left" | "right"
  landlocked: boolean;
  borders: string[]; // ISO3 codes of bordering countries
  subregion: string | null;
  unMember: boolean;
  eeaMember?: boolean;
  independent: boolean | null;
  areaKm2: number | null;
  population: number | null;
  coatOfArmsUrl: string | null;
}

const wikiCache = new Map<string, WikiSummary | null>();
const restCache = new Map<string, RestCountry | null>();

function wikiTitle(name: string): string {
  // Trim trailing parenthetical disambiguators like "Paris (France)".
  const trimmed = name.trim();
  const idx = trimmed.lastIndexOf(" (");
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

export async function fetchWikiSummary(name: string): Promise<WikiSummary | null> {
  const title = wikiTitle(name);
  if (wikiCache.has(title)) return wikiCache.get(title) ?? null;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      wikiCache.set(title, null);
      return null;
    }
    const data = await res.json();
    if (data.type === "disambiguation") {
      wikiCache.set(title, null);
      return null;
    }
    const summary: WikiSummary = {
      title: data.title ?? title,
      extract: data.extract ?? null,
      thumbnailUrl: data.thumbnail?.source ?? null,
      description: data.description ?? null,
      url: data.content_urls?.desktop?.page ?? null,
    };
    wikiCache.set(title, summary);
    return summary;
  } catch {
    wikiCache.set(title, null);
    return null;
  }
}

export async function fetchRestCountry(iso2: string): Promise<RestCountry | null> {
  if (restCache.has(iso2)) return restCache.get(iso2) ?? null;
  const url = `https://restcountries.com/v3.1/alpha/${iso2}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      restCache.set(iso2, null);
      return null;
    }
    const arr = await res.json();
    const c = Array.isArray(arr) ? arr[0] : arr;
    if (!c) {
      restCache.set(iso2, null);
      return null;
    }
    const currencies = c.currencies
      ? Object.values(c.currencies).map((cur: any) => `${cur.code ?? "?"} - ${cur.name ?? ""}`.trim())
      : [];
    const languages = c.languages ? Object.values(c.languages) as string[] : [];
    const callingCodes = (c.idd?.root && c.idd?.suffixes)
      ? c.idd.suffixes.map((s: string) => `${c.idd.root}${s}`)
      : (c.callingCodes ? c.callingCodes : []);
    const result: RestCountry = {
      currencies,
      languages,
      callingCodes,
      timezones: c.timezones ?? [],
      drivingSide: c.car?.side ?? null,
      landlocked: !!c.landlocked,
      borders: c.borders ?? [],
      subregion: c.subregion ?? null,
      unMember: !!c.unMember,
      eeaMember: !!c.eeaMember,
      independent: c.independent ?? null,
      areaKm2: c.area ?? null,
      population: c.population ?? null,
      coatOfArmsUrl: c.coatOfArms?.png ?? null,
    };
    restCache.set(iso2, result);
    return result;
  } catch {
    restCache.set(iso2, null);
    return null;
  }
}

// --- Open-Meteo: elevation + current weather + sunrise/sunset + today's
// high/low, all from a single forecast API call. Free, no API key. ---

export interface GeoStats {
  elevationM: number | null;
  tempC: number | null;
  windKmh: number | null;
  weatherCode: number | null;
  weatherDesc: string | null;
  tempMaxC: number | null;
  tempMinC: number | null;
  sunrise: string | null; // ISO 8601 local
  sunset: string | null; // ISO 8601 local
  timezone: string | null;
}

// WMO weather code -> short human description.
// https://open-meteo.com/en/docs (WMO Weather interpretation codes)
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ slight hail",
  99: "Thunderstorm w/ heavy hail",
};

const geoCache = new Map<string, GeoStats | null>();

function geoKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export async function fetchGeoStats(lat: number, lon: number): Promise<GeoStats | null> {
  const key = geoKey(lat, lon);
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  // Single call: current weather + today's daily high/low + sunrise/sunset.
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,wind_speed_10m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&timezone=auto&forecast_days=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      geoCache.set(key, null);
      return null;
    }
    const data = await res.json();
    const cur = data.current;
    const daily = data.daily;
    const wc = cur?.weather_code ?? null;
    const result: GeoStats = {
      elevationM: data.elevation ?? null,
      tempC: cur?.temperature_2m ?? null,
      windKmh: cur?.wind_speed_10m ?? null,
      weatherCode: wc,
      weatherDesc: wc != null ? (WMO_CODES[wc] ?? null) : null,
      tempMaxC: daily?.temperature_2m_max?.[0] ?? null,
      tempMinC: daily?.temperature_2m_min?.[0] ?? null,
      sunrise: daily?.sunrise?.[0] ?? null,
      sunset: daily?.sunset?.[0] ?? null,
      timezone: data.timezone ?? null,
    };
    geoCache.set(key, result);
    return result;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

// --- Nominatim (OpenStreetMap): region boundary polygons. Free, no API
// key, CORS-enabled. Used to highlight + frame regions on click. Works for
// countries, states, and cities. ---

export interface RegionBoundary {
  rings: number[][][]; // outer rings (lon/lat), same format as region-index
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  areaKm2: number;
}

const boundaryCache = new Map<string, RegionBoundary | null>();

// Fetch a boundary from Nominatim for any region type. The `preferredTypes`
// set is used to filter results: e.g. for cities we prefer "city/town/...",
// for countries we prefer "country/administrative", for states "state/region".
export async function fetchRegionBoundary(
  query: string,
  preferredTypes: Set<string>,
): Promise<RegionBoundary | null> {
  const key = `${query}|${[...preferredTypes].join(",")}`;
  if (boundaryCache.has(key)) return boundaryCache.get(key) ?? null;
  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` +
    `&format=json&polygon_geojson=1&limit=5&addressdetails=1`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) {
      boundaryCache.set(key, null);
      return null;
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      boundaryCache.set(key, null);
      return null;
    }
    // Pick the best result: prefer the requested type, then fall back to
    // the smallest-area result (most specific).
    let best = null;
    for (const hit of arr) {
      if (!hit.geojson) continue;
      const at = (hit.addresstype || hit.type || "").toLowerCase();
      if (preferredTypes.has(at)) {
        best = hit;
        break;
      }
    }
    if (!best) {
      let smallestArea = Infinity;
      for (const hit of arr) {
        if (!hit.geojson) continue;
        const rings = extractOuterRings(hit.geojson);
        if (rings.length === 0) continue;
        const area = polygonAreaKm2Local(rings);
        if (area < smallestArea) {
          smallestArea = area;
          best = hit;
        }
      }
    }
    if (!best || !best.geojson) {
      boundaryCache.set(key, null);
      return null;
    }
    const rings = extractOuterRings(best.geojson);
    if (rings.length === 0) {
      boundaryCache.set(key, null);
      return null;
    }
    const bbox = bboxFromRings(rings);
    const areaKm2 = polygonAreaKm2Local(rings);
    const result: RegionBoundary = { rings, bbox, areaKm2 };
    boundaryCache.set(key, result);
    return result;
  } catch {
    boundaryCache.set(key, null);
    return null;
  }
}

// Convenience wrappers with the right preferred types for each level.

const CITY_TYPES = new Set([
  "city", "town", "village", "settlement", "municipality",
  "borough", "hamlet", "suburb", "neighbourhood",
]);

const COUNTRY_TYPES = new Set([
  "country", "administrative",
]);

const STATE_TYPES = new Set([
  "state", "region", "province", "administrative",
]);

export function fetchCityBoundary(name: string, country: string): Promise<RegionBoundary | null> {
  return fetchRegionBoundary(country ? `${name}, ${country}` : name, CITY_TYPES);
}

export function fetchCountryBoundary(name: string): Promise<RegionBoundary | null> {
  return fetchRegionBoundary(name, COUNTRY_TYPES);
}

export function fetchStateBoundary(name: string, country: string): Promise<RegionBoundary | null> {
  return fetchRegionBoundary(country ? `${name}, ${country}` : name, STATE_TYPES);
}

function extractOuterRings(geojson: {
  type: string;
  coordinates: unknown;
}): number[][][] {
  const c = geojson.coordinates;
  if (geojson.type === "Polygon") {
    // First ring is the outer ring.
    return [(c as number[][][])[0]];
  }
  if (geojson.type === "MultiPolygon") {
    return (c as number[][][][]).map((poly) => poly[0]);
  }
  return [];
}

function bboxFromRings(rings: number[][][]): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function polygonAreaKm2Local(rings: number[][][]): number {
  const R = 6371.0088;
  let total = 0;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[(i + 1) % ring.length];
      const f1 = (lat1 * Math.PI) / 180;
      const f2 = (lat2 * Math.PI) / 180;
      const dl = ((lon2 - lon1) * Math.PI) / 180;
      sum += dl * (2 + Math.sin(f1) + Math.sin(f2));
    }
    total += Math.abs((sum * R * R) / 2.0);
  }
  return Math.round(total);
}
