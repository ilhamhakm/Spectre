// Region (continent / country / state / city) lookup index for hover popups.
//
// The borders layer loads the continent, country, and admin-1 GeoJSON plus
// metadata, builds this index once, and registers it. The hover handler
// resolves the geographic point under the cursor against the currently
// active scope (set by the borders layer based on what the user selected)
// and returns a rich info object for the popup.
//
// Scopes:
//   - "continent": no selection, resolve continent hovers
//   - "country": continent selected, resolve country hovers (filtered to
//     the selected continent)
//   - "state": country selected, resolve state hovers (filtered to the
//     selected country)
//   - "city": below city altitude, resolve city hovers

import type { CityInfo } from "./city-index";
import { resolveCity, setCityData, type CityRecord } from "./city-index";

export interface ContinentInfo {
  name: string;
}

export interface CountryInfo {
  name: string;
  continent: string | null;
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

export type RegionLevel = "continent" | "country" | "state" | "city";

export type RegionHit =
  | { level: "continent"; info: ContinentInfo }
  | { level: "country"; info: CountryInfo }
  | { level: "state"; info: StateInfo }
  | { level: "city"; info: CityInfo };

// Re-export CityInfo so consumers can import it from region-index.
export type { CityInfo } from "./city-index";

// Camera altitude thresholds (kept for backward compatibility but no longer
// the primary driver of hover level; the scope set by the borders layer is).
export const COUNTRY_VIEW_ALTITUDE = 4_000_000;
export const CITY_VIEW_ALTITUDE = 100_000;

interface RingFeature<T> {
  info: T;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  outer: number[][][]; // outer rings (holes ignored for hover)
}

let continents: RingFeature<ContinentInfo>[] = [];
let countries: RingFeature<CountryInfo>[] = [];
let states: RingFeature<StateInfo>[] = [];
let enabled = true; // borders layer visibility gates the hover resolver

// Active scope: set by the borders layer based on user selection.
//   - { level: "continent" }: no selection, resolve continents
//   - { level: "country", continent: "Europe" }: continent selected, resolve
//     countries within that continent only
//   - { level: "state", country: "Austria" }: country selected, resolve
//     states within that country only
//   - { level: "city" }: below city altitude, resolve cities
let activeScope:
  | { level: "continent" }
  | { level: "country"; continent: string }
  | { level: "state"; country: string }
  | { level: "city" }
  | null = null;

export function setRegionEnabled(on: boolean): void {
  enabled = on;
}

/**
 * Set the active scope for hover resolution. Called by the borders layer
 * when the user selects a continent or country, or clears the selection.
 */
export function setActiveScope(scope: typeof activeScope): void {
  activeScope = scope;
}

/**
 * Register the city index from RightPanel's CONTINENTS data. Called once on
 * mount so the hover resolver can find cities at low altitude.
 */
export function registerCities(cities: CityRecord[]): void {
  setCityData(cities);
}

export function levelForHeight(heightMeters: number): RegionLevel {
  if (heightMeters > COUNTRY_VIEW_ALTITUDE) return "country";
  if (heightMeters > CITY_VIEW_ALTITUDE) return "state";
  return "city";
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

function findFeature<T>(index: RingFeature<T>[], lon: number, lat: number): RingFeature<T> | null {
  for (const f of index) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    // f.outer holds only OUTER rings (holes flattened away in loadRegionData),
    // so a point inside any ring is inside the region.
    for (const ring of f.outer) {
      if (pointInRing(lon, lat, ring)) return f;
    }
  }
  return null;
}

function find<T>(index: RingFeature<T>[], lon: number, lat: number): T | null {
  return findFeature(index, lon, lat)?.info ?? null;
}

export type RegionHitFull =
  | { level: "continent"; info: ContinentInfo; rings: number[][][] }
  | { level: "country"; info: CountryInfo; rings: number[][][] }
  | { level: "state"; info: StateInfo; rings: number[][][] }
  | { level: "city"; info: CityInfo; rings: number[][][] };

/**
 * Spherical polygon area (km^2) for a set of outer rings (lon/lat degrees).
 * Uses the L'Huilier / spherical excess formulation via the shoelace-on-
 * sphere identity. Holes are ignored (outer rings only), which is fine for
 * an approximate "area size" stat in the region card.
 */
export function polygonAreaKm2(rings: number[][][]): number {
  const R = 6371.0088; // Earth radius (km), mean radius
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
    total += Math.abs(sum * R * R / 2.0);
  }
  return Math.round(total);
}

/**
 * Resolve a region under the cursor using the active scope set by the
 * borders layer. The scope determines which level to resolve:
 *   - "continent": resolve continents (no selection)
 *   - "country": resolve countries filtered to the selected continent
 *   - "state": resolve states filtered to the selected country
 *   - "city": resolve cities (below city altitude)
 *
 * Falls back to altitude-based level if no scope is set (backward compat).
 */
export function resolveRegionFull(
  lon: number,
  lat: number,
  _level?: RegionLevel,
): RegionHitFull | null {
  if (!enabled) return null;
  const scope = activeScope;

  if (scope?.level === "continent") {
    const f = findFeature(continents, lon, lat);
    if (!f) return null;
    return { level: "continent", info: f.info, rings: f.outer };
  }

  if (scope?.level === "country") {
    // Filter countries to the selected continent
    const filtered = countries.filter(
      (c) => c.info.continent === scope.continent,
    );
    const f = findFeature(filtered, lon, lat);
    if (!f) return null;
    return { level: "country", info: f.info, rings: f.outer };
  }

  if (scope?.level === "state") {
    // Filter states to the selected country
    const filtered = states.filter(
      (s) => s.info.admin === scope.country,
    );
    const f = findFeature(filtered, lon, lat);
    if (!f) return null;
    return { level: "state", info: f.info, rings: f.outer };
  }

  if (scope?.level === "city") {
    const city = resolveCity(lon, lat);
    if (city) return { level: "city", info: city, rings: [] };
    return null;
  }

  // No scope set: fall back to altitude-based resolution
  const heightLevel = _level ?? "country";
  if (heightLevel === "continent") {
    const f = findFeature(continents, lon, lat);
    if (!f) return null;
    return { level: "continent", info: f.info, rings: f.outer };
  }
  if (heightLevel === "country") {
    const f = findFeature(countries, lon, lat);
    if (!f) return null;
    return { level: "country", info: f.info, rings: f.outer };
  }
  if (heightLevel === "city") {
    const city = resolveCity(lon, lat);
    if (city) return { level: "city", info: city, rings: [] };
    const s = findFeature(states, lon, lat);
    if (s) return { level: "state", info: s.info, rings: s.outer };
    const c = findFeature(countries, lon, lat);
    return c ? { level: "country", info: c.info, rings: c.outer } : null;
  }
  const s = findFeature(states, lon, lat);
  if (s) return { level: "state", info: s.info, rings: s.outer };
  const c = findFeature(countries, lon, lat);
  return c ? { level: "country", info: c.info, rings: c.outer } : null;
}

export function resolveRegion(
  lon: number,
  lat: number,
  level?: RegionLevel,
): RegionHit | null {
  const full = resolveRegionFull(lon, lat, level);
  if (!full) return null;
  const { level: lvl, info } = full;
  return { level: lvl, info } as RegionHit;
}

type CountryGeoFeature = {
  properties: { name: string; CONTINENT?: string };
  geometry: { type: string; coordinates: unknown };
};
type ContinentGeoFeature = {
  properties: { CONTINENT?: string };
  geometry: { type: string; coordinates: unknown };
};
type StateGeoFeature = {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
};

export interface RegionData {
  continentsGeo?: { features: ContinentGeoFeature[] };
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
  continents = [];

  // Load continent outlines (dissolved from countries by CONTINENT property)
  if (data.continentsGeo) {
    for (const f of data.continentsGeo.features) {
      const name = f.properties?.CONTINENT;
      if (!name || name === "Seven seas (open ocean)") continue;
      const outer = ringsFor(f.geometry);
      if (outer.length === 0) continue;
      continents.push({
        info: { name },
        bbox: bboxFor(outer),
        outer,
      });
    }
  }

  for (const f of data.countriesGeo.features) {
    const info = data.countryInfo[f.properties.name];
    if (!info) continue;
    // Enrich with continent from the GeoJSON property
    info.continent = f.properties.CONTINENT ?? null;
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

export function regionCounts(): { continents: number; countries: number; states: number } {
  return { continents: continents.length, countries: countries.length, states: states.length };
}
