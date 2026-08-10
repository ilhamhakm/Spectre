// GDELT DOC API client - fetches protest-related articles globally.
// Build Agent B owns this. Per architecture 3.1: 15-min cache, keyword filter,
// geocode via GeoJSON coordinates (GDELT's own geocoder), with title-based
// gazetteer lookup as a fallback when GDELT returns no geometry.

import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_CACHE_TTL_SECONDS = 900; // 15 min per architecture
const DEFAULT_MAX_RECORDS = 50;

const cache = new NodeCache({
  stdTTL: GDELT_CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

// GDELT DOC API GeoJSON response shape (subset we actually use).
// Each article is a Feature; GDELT geocodes every article, so geometry gives
// us real coordinates globally without needing our own gazetteer.
interface GdeltFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: {
    url?: string;
    title?: string;
    seendate?: string; // YYYYMMDDTHHMMSSZ
    domain?: string;
    sourcecountry?: string;
    socialimage?: string;
    language?: string;
  };
}

interface GdeltGeoJsonResponse {
  type?: string;
  features?: GdeltFeature[];
}

export interface GdeltQuery {
  from?: string; // ISO date YYYY-MM-DD
  to?: string;
  limit?: number;
}

function toGdeltDateParam(iso: string, endOfDay: boolean): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const suffix = endOfDay ? "235959" : "000000";
  return `${m[1]}${m[2]}${m[3]}${suffix}`;
}

function parseGdeltSeenDate(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (!m) return new Date().toISOString();
  const [, yyyy, mm, dd, hh, min, ss] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}Z`;
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
}

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${prefix}-${hex}`;
}

function buildQuery(): string {
  return "(protest OR riot OR unrest OR demonstrat*)";
}

function buildUrl(query: GdeltQuery): string {
  const params = new URLSearchParams();
  params.set("query", buildQuery());
  params.set("mode", "ArtList");
  params.set("maxrecords", String(query.limit ?? DEFAULT_MAX_RECORDS));
  // GeoJSON output includes GDELT's own geocoded coordinates for every article.
  params.set("format", "geojson");
  params.set("sort", "datedesc");

  const start = query.from ? toGdeltDateParam(query.from, false) : null;
  const end = query.to ? toGdeltDateParam(query.to, true) : null;
  if (start) params.set("startdatetime", start);
  if (end) params.set("enddatetime", end);

  return `${GDELT_ENDPOINT}?${params.toString()}`;
}

function cacheKey(query: GdeltQuery): string {
  return `gdelt|from=${query.from ?? ""}|to=${query.to ?? ""}|limit=${query.limit ?? DEFAULT_MAX_RECORDS}`;
}

function mapFeatureToEvent(feature: GdeltFeature): ProtestEvent | null {
  const props = feature.properties ?? {};
  const title = (props.title ?? "").trim();
  if (!title) return null;

  // GDELT's geocoded coordinates take precedence (they're world-scale).
  let lat: number | null = null;
  let lon: number | null = null;
  const coords = feature.geometry?.coordinates;
  if (
    coords &&
    Array.isArray(coords) &&
    coords.length >= 2 &&
    Number.isFinite(coords[0]) &&
    Number.isFinite(coords[1])
  ) {
    lon = coords[0];
    lat = coords[1];
  }

  let locName = "";
  // Always try to extract a place name from the title — GDELT provides
  // accurate coordinates but no human-readable location label, so without
  // this the popup would show the news domain (e.g. "reuters.com") as the
  // location. extractLocation parses "Protest in Paris" → "Paris".
  const gazetteerMatch = extractLocation(title);
  if (gazetteerMatch) {
    locName = gazetteerMatch.name;
    // If GDELT didn't provide coords, use the gazetteer's.
    if (lat == null) lat = gazetteerMatch.lat;
    if (lon == null) lon = gazetteerMatch.lon;
  }
  if (lat == null) {
    // No coords from GDELT and no gazetteer hit — skip.
    if (!gazetteerMatch) return null;
  }
  if (lat == null || lon == null) return null;

  const url = props.url;
  const eventTime = parseGdeltSeenDate(props.seendate);
  const domain = (props.domain ?? "gdelt").trim();

  const source: EventSource = {
    id: stableId("src", `gdelt|${url ?? title}`),
    sourceType: "gdelt",
    sourceName: domain,
    sourceUrl: url,
    narrative: "international",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `gdelt|${url ?? title}`),
    type: "protest",
    title,
    description: undefined,
    locationName: locName || undefined,
    lat,
    lon,
    province: locName || undefined,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: 25,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

export async function fetchGdeltEvents(
  query: GdeltQuery,
): Promise<{ events: ProtestEvent[]; fromCache: boolean; error?: string }> {
  const key = cacheKey(query);
  const cached = cache.get<ProtestEvent[]>(key);
  if (cached) return { events: cached, fromCache: true };

  const url = buildUrl(query);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "spectre/0.1 (osint monitor)" },
    });
    if (!res.ok) {
      return { events: [], fromCache: false, error: `GDELT ${res.status}` };
    }
    const data = (await res.json()) as GdeltGeoJsonResponse;
    const features = data.features ?? [];
    const events: ProtestEvent[] = [];
    for (const feature of features) {
      const ev = mapFeatureToEvent(feature);
      if (ev) events.push(ev);
    }
    cache.set(key, events);
    return { events, fromCache: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "gdelt fetch failed";
    return { events: [], fromCache: false, error: msg };
  }
}

export function _resetGdeltCacheForTests(): void {
  cache.flushAll();
}
