// NASA FIRMS fire detection source — fetches active fire/thermal anomaly detections
// from VIIRS (Suomi NPP) for Indonesia. Free, requires MAP_KEY (register at
// https://firms.modaps.eosdis.nasa.gov/api/area/). Degrades gracefully when key
// is missing — returns empty array, never blocks the events API.
//
// API: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SENSOR}/{AREA}/{DAYS}
// Indonesia bounding box: 95,-11,141,6 (west,south,east,north)

import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { fetchWithTimeout } from "@/lib/fetcher";

const FIRMS_URL = (key: string) =>
  `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/95,-11,141,6/1`;

const CACHE_TTL_SECONDS = 600; // 10 min (FIRMS data is ~3hr latency anyway)
const REQUEST_TIMEOUT_MS = 10000;
const INDONESIA_BBOX = { minLat: -11, maxLat: 6, minLon: 95, maxLon: 141 };

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

interface FirmsRow {
  latitude: number;
  longitude: number;
  brightness: number;
  acqDate: string;
  acqTime: string;
  confidence: string;
  frp: number;
  daynight: "D" | "N";
}

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${prefix}-${hex}`;
}

function parseCsv(csvText: string): FirmsRow[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const latIdx = header.indexOf("latitude");
  const lonIdx = header.indexOf("longitude");
  const brightIdx = header.indexOf("brightness");
  const dateIdx = header.indexOf("acq_date");
  const timeIdx = header.indexOf("acq_time");
  const confIdx = header.indexOf("confidence");
  const frpIdx = header.indexOf("frp");
  const dnIdx = header.indexOf("daynight");

  if (latIdx < 0 || lonIdx < 0 || dateIdx < 0) return [];

  const rows: FirmsRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    if (
      lat < INDONESIA_BBOX.minLat ||
      lat > INDONESIA_BBOX.maxLat ||
      lon < INDONESIA_BBOX.minLon ||
      lon > INDONESIA_BBOX.maxLon
    )
      continue;

    const brightness = brightIdx >= 0 ? parseFloat(cols[brightIdx]) || 0 : 0;
    const frp = frpIdx >= 0 ? parseFloat(cols[frpIdx]) || 0 : 0;
    const daynight = dnIdx >= 0 ? (cols[dnIdx].trim() as "D" | "N") : "D";

    rows.push({
      latitude: lat,
      longitude: lon,
      brightness,
      acqDate: cols[dateIdx]?.trim() ?? "",
      acqTime: timeIdx >= 0 ? cols[timeIdx]?.trim() ?? "" : "",
      confidence: confIdx >= 0 ? cols[confIdx]?.trim() ?? "unknown" : "unknown",
      frp,
      daynight,
    });
  }
  return rows;
}

function mapRowToEvent(row: FirmsRow): ProtestEvent {
  const eventTime = `${row.acqDate}T${row.acqTime.padStart(4, "0").replace(/(\d{2})(\d{2})/, "$1:$2")}:00Z`;
  const key = `firms|${row.acqDate}|${row.acqTime}|${row.latitude.toFixed(4)},${row.longitude.toFixed(4)}`;
  const confNum = row.confidence === "high" ? 85 : row.confidence === "nominal" ? 65 : 50;

  const source: EventSource = {
    id: stableId("src", key),
    sourceType: "firms",
    sourceName: "NASA FIRMS",
    sourceUrl: "https://firms.modaps.eosdis.nasa.gov/",
    narrative: "official",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", key),
    type: "fire",
    title: `Active Fire Detection — ${row.latitude.toFixed(2)}, ${row.longitude.toFixed(2)}`,
    description: `Brightness: ${row.brightness}K | FRP: ${row.frp} MW | Confidence: ${row.confidence} | ${row.daynight === "N" ? "Nighttime" : "Daytime"} detection`,
    locationName: "Indonesia",
    lat: row.latitude,
    lon: row.longitude,
    province: "Indonesia",
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: confNum,
    verificationLevel: "confirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

export interface FirmsResult {
  events: ProtestEvent[];
  fromCache: boolean;
  skipped: boolean;
  error?: string;
}

export function isFirmsConfigured(): boolean {
  return !!process.env.FIRMS_MAP_KEY;
}

export async function fetchFirmsEvents(): Promise<FirmsResult> {
  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) {
    return { events: [], fromCache: false, skipped: true };
  }

  const cacheKey = "firms|indonesia|1d";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true, skipped: false };

  try {
    const res = await fetchWithTimeout(FIRMS_URL(mapKey), { timeout: REQUEST_TIMEOUT_MS });
    if (!res.ok) {
      console.warn(`[firms] API returned ${res.status}`);
      return { events: [], fromCache: false, skipped: false, error: `HTTP ${res.status}` };
    }
    const csvText = await res.text();
    const rows = parseCsv(csvText);
    const events = rows.map(mapRowToEvent);
    cache.set(cacheKey, events);
    return { events, fromCache: false, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "firms fetch failed";
    console.warn(`[firms] fetch failed: ${msg}`);
    return { events: [], fromCache: false, skipped: false, error: msg };
  }
}

export function _resetFirmsCacheForTests(): void {
  cache.flushAll();
}
