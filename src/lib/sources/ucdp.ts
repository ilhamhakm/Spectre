// UCDP (Uppsala Conflict Data Program) client.
// Source: https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_6.csv
// Free, CC BY 4.0, no auth. Monthly release — near-real-time for a conflict dataset.
//
// We pull the Candidate GED CSV (georeferenced event data, global) and map
// rows to ProtestEvent. Only events from the last ~90 days are kept so the
// dataset doesn't dominate the live protest feed with year-old events.

import NodeCache from "node-cache";
import Papa from "papaparse";
import type { ProtestEvent, EventSource, EventType } from "../types";

const UCDP_CSV_URL =
  "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_6.csv";
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours — dataset updates monthly
const REQUEST_TIMEOUT_MS = 30_000; // CSV is ~10MB
const MAX_AGE_DAYS = 90;

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 600,
  useClones: false,
});

interface UcdpRow {
  id: string;
  year: string;
  active_year: string;
  type_of_violence: string;
  conflict_name: string;
  side_a: string;
  side_b: string;
  country: string;
  country_id: string;
  best: string;
  deaths_a: string;
  deaths_b: string;
  deaths_unknown: string;
  date_start: string;
  date_end: string;
  where_description: string;
  longitude: string;
  latitude: string;
  source_article: string;
  source_office: string;
  source_date: string;
  source_headline: string;
}

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function classifyEvent(typeOfViolence: string): EventType {
  // UCDP type_of_violence: 1=state-based, 2=non-state, 3=one-sided
  // Violent Political Protest dataset uses different codes; here we use GED codes.
  if (typeOfViolence === "3") return "riot";
  if (typeOfViolence === "2") return "riot";
  return "other";
}

function mapRowToEvent(row: UcdpRow): ProtestEvent | null {
  const lat = parseFloat(row.latitude);
  const lon = parseFloat(row.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const dateStr = row.date_start ?? row.date_end;
  if (!dateStr) return null;
  const ts = Date.parse(dateStr);
  if (Number.isNaN(ts)) return null;
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS) return null;

  const casualties = parseInt(row.best ?? "0", 10);
  const title = row.source_headline?.trim() || `${row.conflict_name}: ${row.where_description}`;
  const eventTime = new Date(ts).toISOString();

  const source: EventSource = {
    id: stableId("src", `ucdp|${row.id}`),
    sourceType: "ucdp",
    sourceName: "UCDP GED",
    sourceUrl: row.source_article || undefined,
    narrative: "international",
    reportedCasualties: Number.isFinite(casualties) ? casualties : undefined,
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `ucdp|${row.id}`),
    type: classifyEvent(row.type_of_violence),
    title,
    description: `${row.side_a} vs ${row.side_b}. ${row.where_description ?? ""}`.trim(),
    locationName: row.where_description,
    lat,
    lon,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: 70, // UCDP is a curated academic dataset
    verificationLevel: "confirmed",
    verified: true,
    casualtyCount: Number.isFinite(casualties) ? casualties : undefined,
    isAnonymous: false,
    sources: [source],
  };
}

export interface UcdpResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchUcdpEvents(): Promise<UcdpResult> {
  const cacheKey = "ucdp|candidateged";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  try {
    const res = await fetch(UCDP_CSV_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": "spectre/0.1 (osint monitor)" },
    });
    if (!res.ok) {
      return { events: [], fromCache: false, error: `UCDP ${res.status}` };
    }
    const csvText = await res.text();

    const parsed = Papa.parse<UcdpRow>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const events: ProtestEvent[] = [];
    for (const row of parsed.data) {
      const ev = mapRowToEvent(row);
      if (ev) events.push(ev);
    }

    cache.set(cacheKey, events);
    return { events, fromCache: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ucdp fetch failed";
    console.warn(`[ucdp] fetch failed: ${msg}`);
    return { events: [], fromCache: false, error: msg };
  }
}

export function _resetUcdpCacheForTests(): void {
  cache.flushAll();
}
