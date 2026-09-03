// Radio Browser directory broker. Faithful port of GEV's vite.config.js
// createRadioProxyMiddleware: mirror discovery + rotation, multi-tag
// concurrent station queries, normalization, unsafe-stream filtering,
// 45-minute cache, 7-day stale fallback, and health-gating.
//
// Audio always travels directly from the broadcaster to the client; this
// route never proxies, caches, records, or redistributes streams.

import { NextResponse } from "next/server";
import { normalizeRadioCountryInput } from "@/globe/radio/radio-country";
import type { RadioStation } from "@/globe/radio/radio-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RADIO_DIRECTORY_CACHE_MS = 45 * 60 * 1000;
const RADIO_DIRECTORY_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const RADIO_MIRROR_CACHE_MS = 6 * 60 * 60 * 1000;
const RADIO_FETCH_TIMEOUT_MS = 12_000;
const RADIO_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const RADIO_DIRECTORY_LIMIT = 750;
const RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES = 5;
const RADIO_CATALOG_HEALTHY_MIN_STATIONS = Math.ceil(
  RADIO_DIRECTORY_LIMIT / 2,
);
const RADIO_USER_AGENT = "SpectreV2/1.0 (Radio Browser directory client)";
const RADIO_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RADIO_FALLBACK_MIRRORS = Object.freeze([
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
]);

function cleanRadioText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function isNonGlobalIpv4(hostname: string): boolean {
  const pieces = hostname.split(".");
  if (
    pieces.length !== 4 ||
    pieces.some((piece) => !/^\d{1,3}$/.test(piece))
  )
    return false;
  const values = pieces.map(Number);
  if (values.some((value) => value > 255)) return true;
  const [a, b, c] = values;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** Return a normalized public HTTPS URL, or null for local/private targets. */
function publicRadioHttpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !hostname
    )
      return null;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      isNonGlobalIpv4(hostname) ||
      hostname.includes(":")
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

interface RawRadioStation {
  stationuuid?: string;
  name?: string;
  geo_lat?: number | string | null;
  geo_long?: number | string | null;
  codec?: string;
  url_resolved?: string;
  url?: string;
  homepage?: string;
  tags?: string;
  language?: string;
  state?: string;
  countrycode?: string;
  country?: string;
  bitrate?: number | string;
  clickcount?: number | string;
  lastcheckok?: number | string;
  hls?: number | string;
}

/** Normalize one Radio Browser station and omit favicons and unsafe streams. */
function normalizeRadioBrowserStation(
  raw: RawRadioStation,
): RadioStation | null {
  const id = cleanRadioText(raw?.stationuuid, 40).toLowerCase();
  const lat =
    raw?.geo_lat === null || raw?.geo_lat === ""
      ? null
      : Number(raw?.geo_lat);
  const lon =
    raw?.geo_long === null || raw?.geo_long === ""
      ? null
      : Number(raw?.geo_long);
  const codec = cleanRadioText(raw?.codec, 16).toUpperCase();
  const streamUrl = publicRadioHttpsUrl(raw?.url_resolved || raw?.url);
  if (
    !RADIO_UUID_RE.test(id) ||
    Number(raw?.lastcheckok) !== 1 ||
    Number(raw?.hls) === 1 ||
    !Number.isFinite(lat) ||
    lat! < -90 ||
    lat! > 90 ||
    !Number.isFinite(lon) ||
    lon! < -180 ||
    lon! > 180 ||
    !/^(?:MP3|AAC(?:\+|-LC|-HE)?|HE-AAC)$/i.test(codec) ||
    !streamUrl
  )
    return null;

  const name = cleanRadioText(raw?.name, 140);
  if (!name) return null;
  const tags = String(raw?.tags ?? "")
    .split(",")
    .map((tag) =>
      cleanRadioText(tag, 80)
        .toLocaleLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 24);
  const languages = String(raw?.language ?? "")
    .split(",")
    .map((language) => cleanRadioText(language, 40))
    .filter(Boolean)
    .slice(0, 8);
  const rawCountryCode = cleanRadioText(raw?.countrycode, 2).toUpperCase();
  const normalizedCode = normalizeRadioCountryInput(rawCountryCode);
  const normalizedCountry =
    normalizedCode.valid && !normalizedCode.empty
      ? normalizedCode
      : normalizeRadioCountryInput(cleanRadioText(raw?.country, 80));
  const bitrate = Number(raw?.bitrate);
  return {
    id,
    name,
    lat: lat!,
    lon: lon!,
    streamUrl,
    homepage: publicRadioHttpsUrl(raw?.homepage),
    tags,
    languages,
    state: cleanRadioText(raw?.state, 80),
    country:
      normalizedCountry.valid && !normalizedCountry.empty
        ? normalizedCountry.name
        : cleanRadioText(raw?.country, 80),
    countryCode: normalizedCountry.valid ? normalizedCountry.code : "",
    metadataTrust: "untrusted-community",
    codec,
    bitrate:
      Number.isInteger(bitrate) && bitrate >= 8 && bitrate <= 1024
        ? bitrate
        : null,
    clickCount: Math.max(0, Math.min(10_000_000, Number(raw?.clickcount) || 0)),
  };
}

function publicRadioStation(station: RadioStation): RadioStation {
  return {
    id: station.id,
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    streamUrl: station.streamUrl,
    homepage: station.homepage,
    tags: station.tags,
    languages: station.languages,
    state: station.state,
    country: station.country,
    countryCode: station.countryCode,
    metadataTrust: station.metadataTrust,
    codec: station.codec,
    bitrate: station.bitrate,
    clickCount: station.clickCount,
  };
}

function radioMirrorOrigin(value: unknown): string | null {
  const hostname = String(value ?? "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+\.api\.radio-browser\.info$/.test(hostname)) return null;
  return `https://${hostname}`;
}

interface CatalogCache {
  cachedAt: number;
  updatedAt: string;
  stations: RadioStation[];
  stationIds: Set<string>;
  degraded: boolean;
  degradedReason: string | null;
  coverage: {
    successfulQueries: number;
    totalQueries: number;
    stationCount: number;
    healthyStationMinimum: number;
  } | null;
  acceptedGeneration: number | null;
}

let mirrorCache: { origins: string[]; cachedAt: number } = {
  origins: [...RADIO_FALLBACK_MIRRORS],
  cachedAt: 0,
};
let mirrorPromise: Promise<string[]> | null = null;
let catalogCache: CatalogCache | null = null;
let catalogGeneration = 0;
let refreshPromise: Promise<CatalogCache> | null = null;

async function fetchJson(url: string, maxBytes = RADIO_RESPONSE_MAX_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RADIO_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": RADIO_USER_AGENT },
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      try {
        await response.body?.cancel?.();
      } catch {
        /* no-op */
      }
      throw new Error("Radio Browser redirects are refused");
    }
    if (!response.ok)
      throw new Error(`Radio Browser returned ${response.status}`);
    const text = await readResponseTextCapped(response, maxBytes);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseTextCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  let received = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes)
        throw new Error("Radio Browser response exceeded the byte cap");
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function mirrors(): Promise<string[]> {
  if (Date.now() - mirrorCache.cachedAt < RADIO_MIRROR_CACHE_MS)
    return mirrorCache.origins;
  if (!mirrorPromise) {
    mirrorPromise = (async () => {
      try {
        const rows = await fetchJson(
          "https://all.api.radio-browser.info/json/servers",
          256 * 1024,
        );
        const discovered: string[] = [
          ...new Set(
            (Array.isArray(rows) ? rows : [])
              .map((row: { name?: string }) => radioMirrorOrigin(row?.name))
              .filter((v): v is string => Boolean(v)),
          ),
        ];
        if (discovered.length) {
          mirrorCache = {
            origins: [
              ...discovered,
              ...RADIO_FALLBACK_MIRRORS.filter(
                (origin) => !discovered.includes(origin),
              ),
            ],
            cachedAt: Date.now(),
          };
        }
      } catch {
        mirrorCache = { ...mirrorCache, cachedAt: Date.now() };
      }
      return mirrorCache.origins;
    })().finally(() => {
      mirrorPromise = null;
    });
  }
  return mirrorPromise;
}

async function fetchPath(pathname: string) {
  let lastError: Error | null = null;
  for (const origin of await mirrors()) {
    try {
      return await fetchJson(`${origin}${pathname}`);
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError || new Error("No Radio Browser mirror is available");
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function refreshCatalog(): Promise<CatalogCache> {
  const queries: (string | null)[] = [
    null,
    "news",
    "talk",
    "weather",
    "emergency",
    "scanner",
    "aviation",
    "marine",
    "traffic",
  ];
  const outcomes = await mapConcurrent(queries, 3, async (tag, index) => {
    const params = new URLSearchParams({
      has_geo_info: "true",
      is_https: "true",
      hidebroken: "true",
      order: "clickcount",
      reverse: "true",
      limit: index === 0 ? "1800" : "220",
    });
    if (tag) params.set("tag", tag);
    try {
      const rows = await fetchPath(`/json/stations/search?${params}`);
      if (!Array.isArray(rows))
        throw new Error("Radio Browser catalog payload was not an array");
      const stations = rows
        .map(normalizeRadioBrowserStation)
        .filter(Boolean) as RadioStation[];
      const requestedTag = cleanRadioText(tag, 80)
        .toLocaleLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const requestedTagCovered =
        !requestedTag ||
        stations.some((station) =>
          station.tags.some(
            (stationTag) =>
              stationTag === requestedTag ||
              stationTag.includes(requestedTag),
          ),
        );
      return {
        succeeded: stations.length > 0 && requestedTagCovered,
        stations,
      };
    } catch {
      return { succeeded: false, stations: [] as RadioStation[] };
    }
  });
  const resultSets = outcomes.map((outcome) => outcome.stations);

  const selected: RadioStation[] = [];
  const seen = new Set<string>();
  const take = (station: RadioStation | null) => {
    if (!station || seen.has(station.id)) return;
    if (selected.length >= RADIO_DIRECTORY_LIMIT) return;
    seen.add(station.id);
    selected.push(station);
  };
  for (const rows of resultSets.slice(1)) rows.slice(0, 45).forEach(take);
  resultSets
    .flat()
    .sort((a, b) => b.clickCount - a.clickCount || a.name.localeCompare(b.name))
    .forEach(take);
  const timestamp = Date.now();
  const successfulQueries = outcomes.filter((o) => o.succeeded).length;
  const broadQueryHealthy = outcomes[0].succeeded && outcomes[0].stations.length > 0;
  const healthReasons: string[] = [];
  if (!broadQueryHealthy) healthReasons.push("broad-query-unhealthy");
  if (successfulQueries < RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES)
    healthReasons.push("query-coverage-below-policy");
  if (selected.length < RADIO_CATALOG_HEALTHY_MIN_STATIONS)
    healthReasons.push("station-coverage-below-policy");
  const degraded = healthReasons.length > 0;
  const coverage = {
    successfulQueries,
    totalQueries: queries.length,
    stationCount: selected.length,
    healthyStationMinimum: RADIO_CATALOG_HEALTHY_MIN_STATIONS,
  };
  const nextCatalog: CatalogCache = {
    cachedAt: timestamp,
    updatedAt: new Date(timestamp).toISOString(),
    stations: selected.map(publicRadioStation),
    stationIds: new Set(selected.map((station) => station.id)),
    degraded,
    degradedReason: degraded ? healthReasons.join(",") : null,
    coverage,
    acceptedGeneration: null,
  };
  if (degraded && !selected.length) {
    throw new Error("Radio Browser catalog refresh returned no usable stations");
  }
  if (degraded) {
    return nextCatalog;
  }
  catalogCache = {
    ...nextCatalog,
    acceptedGeneration: ++catalogGeneration,
  };
  return catalogCache;
}

async function getCatalog(): Promise<CatalogCache & { stale: boolean }> {
  if (catalogCache && Date.now() - catalogCache.cachedAt < RADIO_DIRECTORY_CACHE_MS) {
    return { ...catalogCache, stale: false };
  }
  if (!refreshPromise) {
    refreshPromise = refreshCatalog().finally(() => {
      refreshPromise = null;
    });
  }
  try {
    return { ...(await refreshPromise), stale: false };
  } catch (error) {
    if (
      catalogCache &&
      Date.now() - catalogCache.cachedAt <= RADIO_DIRECTORY_STALE_MS
    ) {
      return {
        ...catalogCache,
        stale: true,
        degraded: true,
        degradedReason: "refresh-failed",
      };
    }
    throw error;
  }
}

export async function GET() {
  try {
    const catalog = await getCatalog();
    return NextResponse.json(
      {
        stations: catalog.stations,
        updatedAt: catalog.updatedAt,
        stale: catalog.stale,
        degraded: Boolean(catalog.degraded),
        degradedReason: catalog.degradedReason || null,
        coverage: catalog.coverage,
        acceptedGeneration: catalog.acceptedGeneration ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Radio directory is temporarily unavailable",
        degraded: false,
        degradedReason: null,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
