// Region (country / state) lookup index for hover popups.
//
// The borders layer loads the country + admin-1 (state/province) GeoJSON and
// the country-info metadata, builds this index once, and registers it. The
// hover handler resolves the geographic point under the cursor against the
// currently active level (country borders above COUNTRY_VIEW_ALTITUDE, state
// borders below) and returns a rich info object for the popup.

export interface CountryInfo {
  name: string;
  iso2: string | null;
  iso3: string | null;
  flagEmoji: string | null;
  flagUrl: string | null;
  capital: string | null;
  population: number | null;
  popYear: number | null;
  areaKm2: number | null;
  gdp?: number;
  gdpPerCapita?: number;
  gdpGrowth?: number;
  inflation?: number;
  unemployment?: number;
  lifeExpectancy?: number;
  debtToGdp?: number;
  reserves?: number;
}

export interface StateInfo {
  name: string;
  type: string | null;
  iso_a2: string | null;
  adm0_a3: string | null;
  admin: string | null;
  nameEn: string | null;
  typeEn: string | null;
  iso: string | null;
  qid: string | null;
  population: number | null;
  popYear: number | null;
  flagUrl: string | null;
  countryFlagUrl: string | null;
  capital: string | null;
}

export type RegionLevel = "country" | "state";

export type RegionHit =
  | { level: "country"; info: CountryInfo }
  | { level: "state"; info: StateInfo };

// Camera altitude (meters) above which we show country borders and resolve
// country-level hovers; below it we show state/province borders. Continents
// are framed at ~5,000,000 m, countries at ~1.2M-3.5M, so 4M splits them.
export const COUNTRY_VIEW_ALTITUDE = 4_000_000;

interface RingFeature<T> {
  info: T;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  outer: number[][][]; // outer rings (holes ignored for hover)
}

let countries: RingFeature<CountryInfo>[] = [];
let states: RingFeature<StateInfo>[] = [];
let enabled = true; // borders layer visibility gates the hover resolver

export function setRegionEnabled(on: boolean): void {
  enabled = on;
}

export function levelForHeight(heightMeters: number): RegionLevel {
  return heightMeters > COUNTRY_VIEW_ALTITUDE ? "country" : "state";
}

export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function find<T>(index: RingFeature<T>[], lon: number, lat: number): T | null {
  for (const f of index) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    // f.outer holds only OUTER rings (holes flattened away in loadRegionData),
    // so a point inside any ring is inside the region.
    for (const ring of f.outer) {
      if (pointInRing(lon, lat, ring)) return f.info;
    }
  }
  return null;
}

export function resolveRegion(
  lon: number,
  lat: number,
  level: RegionLevel,
): RegionHit | null {
  if (!enabled) return null;
  if (level === "country") {
    const info = find(countries, lon, lat);
    return info ? { level, info } : null;
  }
  const state = find(states, lon, lat);
  if (state) return { level, info: state };
  // No state coverage here (e.g. ocean / small countries) — fall back to the
  // containing country so the popup still has something useful.
  const country = find(countries, lon, lat);
  return country ? { level: "country", info: country } : null;
}

type CountryGeoFeature = {
  properties: { name: string };
  geometry: { type: string; coordinates: unknown };
};
type StateGeoFeature = {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
};

export interface RegionData {
  countriesGeo: { features: CountryGeoFeature[] };
  statesGeo: { features: StateGeoFeature[] };
  countryInfo: Record<string, CountryInfo>;
  stateInfo: Record<string, StateInfo | null>;
}

function ringsFor(geometry: { type: string; coordinates: unknown }): number[][][] {
  if (!geometry) return [];
  const c = geometry.coordinates as unknown;
  if (geometry.type === "Polygon") return c as number[][][];
  if (geometry.type === "MultiPolygon") {
    return (c as number[][][][]).map((poly) => poly[0]);
  }
  return [];
}

function bboxFor(outer: number[][][]): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of outer) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function loadRegionData(data: RegionData): void {
  countries = [];
  states = [];

  for (const f of data.countriesGeo.features) {
    const info = data.countryInfo[f.properties.name];
    if (!info) continue;
    const outer = ringsFor(f.geometry);
    if (outer.length === 0) continue;
    countries.push({ info, bbox: bboxFor(outer), outer });
  }

  for (const f of data.statesGeo.features) {
    if (!f.geometry) continue;
    const p = f.properties;
    const outer = ringsFor(f.geometry);
    if (outer.length === 0) continue;
    // Optional per-state enrichment from Wikidata (population, flag, capital)
    // via the state-info sidecar keyed "admin|name".
    const extra = data.stateInfo[`${p.admin}|${p.name}`] ?? null;
    const info: StateInfo = {
      name: (p.name as string) ?? "Unknown",
      type: (p.type as string) ?? null,
      iso_a2: (p.iso_a2 as string) ?? null,
      adm0_a3: (p.adm0_a3 as string) ?? null,
      admin: (p.admin as string) ?? null,
      nameEn: extra?.nameEn ?? null,
      typeEn: extra?.typeEn ?? null,
      iso: extra?.iso ?? null,
      qid: extra?.qid ?? null,
      population: extra?.population ?? null,
      popYear: extra?.popYear ?? null,
      flagUrl: extra?.flagUrl ?? null,
      // Fall back to the containing country's flag when the state has no
      // flag of its own (states like Paris or provinces in many countries).
      countryFlagUrl:
        extra?.flagUrl == null
          ? (data.countryInfo[p.admin as string]?.flagUrl ?? null)
          : null,
      capital: extra?.capital ?? null,
    };
    states.push({ info, bbox: bboxFor(outer), outer });
  }
}

export function regionCounts(): { countries: number; states: number } {
  return { countries: countries.length, states: states.length };
}
