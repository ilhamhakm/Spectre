// ACLED global weekly events client.
// Build Agent B owns this. Per architecture 3.3: weekly ground-truth, CAMEO 14/15,
// confidence bonus when matched. For v0 we simply fetch and map - no matching yet
// (Supabase is Phase 2). Requires ACLED_EMAIL + ACLED_KEY env vars.

import NodeCache from "node-cache";
import type { ProtestEvent, EventSource, EventType } from "../types";

const ACLED_ENDPOINT = "https://api.acleddata.com/acled/read";
const ACLED_CACHE_TTL_SECONDS = 3600; // 1 hour - ACLED is weekly cadence
const DEFAULT_LIMIT = 50;

const cache = new NodeCache({
  stdTTL: ACLED_CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

interface AcledRecord {
  data_id?: string | number;
  event_type?: string;
  sub_event_type?: string;
  event_date?: string; // YYYY-MM-DD
  country?: string;
  admin1?: string; // province
  location?: string; // city
  latitude?: number | string;
  longitude?: number | string;
  source?: string;
  notes?: string;
  fatalities?: number | string;
  actor1?: string;
  assoc_actor_1?: string;
}

interface AcledResponse {
  status?: number;
  success?: boolean;
  data?: AcledRecord[];
  error?: string;
}

function toEventType(acledType: string | undefined): EventType {
  const t = (acledType ?? "").toLowerCase();
  if (t.startsWith("riot")) return "riot";
  if (t.startsWith("protest")) return "protest";
  return "protest";
}

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${prefix}-${hex}`;
}

function toNum(v: number | string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function mapRecordToEvent(rec: AcledRecord): ProtestEvent | null {
  const lat = toNum(rec.latitude);
  const lon = toNum(rec.longitude);
  if (lat == null || lon == null) return null;

  const id = rec.data_id != null ? String(rec.data_id) : null;
  const title =
    [rec.sub_event_type, rec.location, rec.admin1]
      .filter((x): x is string => Boolean(x))
      .join(" - ") || "ACLED event";

  const province = rec.admin1 ?? rec.location;
  const eventTime = rec.event_date
    ? new Date(`${rec.event_date}T00:00:00Z`).toISOString()
    : new Date().toISOString();

  const source: EventSource = {
    id: stableId("src", `acled|${id ?? title}`),
    sourceType: "acled",
    sourceName: "ACLED",
    sourceUrl: undefined,
    narrative: "official",
    reportedCasualties: toNum(rec.fatalities),
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `acled|${id ?? `${title}|${eventTime}`}`),
    type: toEventType(rec.event_type),
    title,
    description: rec.notes,
    locationName: rec.location ?? province,
    lat,
    lon,
    province,
    eventTime,
    createdAt: new Date().toISOString(),
    // ACLED is verified ground-truth per architecture 3.3 - high confidence.
    confidence: 75,
    verificationLevel: "confirmed",
    verified: true,
    actor: rec.actor1 ?? rec.assoc_actor_1,
    casualtyCount: toNum(rec.fatalities),
    isAnonymous: false,
    sources: [source],
  };
}

export interface AcledResult {
  events: ProtestEvent[];
  fromCache: boolean;
  skipped: boolean; // true when env vars missing - caller treats as no-op
  error?: string;
}

export function isAcledConfigured(): boolean {
  return Boolean(process.env.ACLED_EMAIL && process.env.ACLED_KEY);
}

export async function fetchAcledEvents(
  limit: number = DEFAULT_LIMIT,
): Promise<AcledResult> {
  if (!isAcledConfigured()) {
    return { events: [], fromCache: false, skipped: true };
  }

  const cacheKey = `acled|limit=${limit}`;
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true, skipped: false };

  const params = new URLSearchParams({
    event_type: "PROTEST|RIOT",
    limit: String(limit),
    email: process.env.ACLED_EMAIL ?? "",
    key: process.env.ACLED_KEY ?? "",
  });

  try {
    const res = await fetch(`${ACLED_ENDPOINT}?${params.toString()}`, {
      cache: "no-store",
      headers: { "User-Agent": "spectre/0.1 (osint monitor)" },
    });
    if (!res.ok) {
      return { events: [], fromCache: false, skipped: false, error: `ACLED ${res.status}` };
    }
    const data = (await res.json()) as AcledResponse;
    if (!data.success || !data.data) {
      return {
        events: [],
        fromCache: false,
        skipped: false,
        error: data.error ?? "ACLED response not success",
      };
    }
    const events: ProtestEvent[] = [];
    for (const rec of data.data) {
      const ev = mapRecordToEvent(rec);
      if (ev) events.push(ev);
    }
    cache.set(cacheKey, events);
    return { events, fromCache: false, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "acled fetch failed";
    return { events: [], fromCache: false, skipped: false, error: msg };
  }
}
