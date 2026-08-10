// GET /api/events - main protest events API.
// Build Agent B owns this. Replaces /api/flights as the core domain primitive.
//
// Query params:
//   type            - event type filter (default: protest)
//   from            - ISO date YYYY-MM-DD (inclusive)
//   to              - ISO date YYYY-MM-DD (inclusive)
//   province        - canonical province name (e.g. "DKI Jakarta")
//   min_confidence  - 0..100 (default 0)
//   bbox            - west,south,east,north viewport rect (e.g. -130,24,-60,50).
//                     Only events inside this rect are returned. Omit for all.
//   limit           - 1..200 (default 50)
//
// Response: { events, total, cached, degraded, sources, generatedAt }
//
// Sources (queried in parallel via Promise.allSettled):
//   - ACLED (if ACLED_EMAIL + ACLED_KEY env vars present)
//   - GDELT DOC API
//   - RSS feeds (Tempo, Antara, CNN Indonesia, Tribun)
//
// On any fetcher failure, returns cached data with degraded=true.

import { NextResponse, type NextRequest } from "next/server";
import type { ProtestEvent } from "@/lib/types";
import { INDONESIAN_PROVINCES } from "@/lib/indonesia";
import {
  getCachedList,
  setCachedList,
  upsertEvents,
  mergeEvents,
  hydrateFromDisk,
  getStoreLastUpdated,
  type ListQuery,
  type EventsApiResponse,
} from "@/lib/eventsStore";
import { fetchGdeltEvents } from "@/lib/sources/gdelt";
import { fetchRssEvents } from "@/lib/sources/rss";
import { fetchAcledEvents, isAcledConfigured } from "@/lib/sources/acled";
import { fetchRedditEvents } from "@/lib/sources/reddit";
import { fetchTelegramEvents } from "@/lib/sources/telegram";
import { fetchMastodonEvents } from "@/lib/sources/mastodon";
import { fetchYoutubeEvents } from "@/lib/sources/youtube";
import { fetchUcdpEvents } from "@/lib/sources/ucdp";
import { fetchReliefWebEvents } from "@/lib/sources/reliefweb";
import { fetchCivicusEvents } from "@/lib/sources/civicus";
import { fetchFirmsEvents, isFirmsConfigured } from "@/lib/sources/firms";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface SourceFetchResult {
  name: string;
  events: ProtestEvent[];
  ok: boolean;
  cached: boolean;
  skipped: boolean;
  error?: string;
}

// Agent A's indonesia.ts doesn't export a normalizeProvince helper, so we
// inline a case-insensitive lookup against INDONESIAN_PROVINCES here.
function normalizeProvince(input: string | null | undefined): string | null {
  if (!input) return null;
  const lower = input.trim().toLowerCase();
  const match = INDONESIAN_PROVINCES.find((p) => p.toLowerCase() === lower);
  return match ?? null;
}

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

function parseBbox(raw: string | null): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (south > north) return null;
  return { west, south, east, north };
}

function inBbox(ev: ProtestEvent, bbox: Bbox): boolean {
  if (ev.lat < bbox.south || ev.lat > bbox.north) return false;
  // Handle antimeridian-wrapped viewports (west > east).
  if (bbox.west <= bbox.east) {
    return ev.lon >= bbox.west && ev.lon <= bbox.east;
  }
  return ev.lon >= bbox.west || ev.lon <= bbox.east;
}

function parseQuery(
  req: NextRequest,
): ListQuery & { minConfidence: number; limit: number; bbox: Bbox | null } {
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : DEFAULT_LIMIT;
  const minConfRaw = Number(sp.get("min_confidence") ?? 0);
  const minConfidence = Number.isFinite(minConfRaw)
    ? Math.min(100, Math.max(0, Math.floor(minConfRaw)))
    : 0;
  return {
    type: sp.get("type") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    province: sp.get("province") ?? undefined,
    minConfidence,
    limit,
    bbox: parseBbox(sp.get("bbox")),
  };
}

function applyFilters(
  events: ProtestEvent[],
  query: ListQuery & { minConfidence: number; bbox: Bbox | null },
): ProtestEvent[] {
  const province = normalizeProvince(query.province);
  const fromTs = query.from ? Date.parse(`${query.from}T00:00:00Z`) : null;
  const toTs = query.to ? Date.parse(`${query.to}T23:59:59Z`) : null;

  return events.filter((ev) => {
    if (query.type && ev.type !== query.type) return false;
    // Viewport-context filter — only events in the currently viewed region.
    if (query.bbox && !inBbox(ev, query.bbox)) return false;
    if (province) {
      const evProv = (ev.province ?? ev.locationName ?? "").toLowerCase();
      if (evProv !== province.toLowerCase()) return false;
    }
    if (fromTs != null || toTs != null) {
      const evTs = Date.parse(ev.eventTime);
      if (Number.isNaN(evTs)) return false;
      if (fromTs != null && evTs < fromTs) return false;
      if (toTs != null && evTs > toTs) return false;
    }
    if (ev.confidence < query.minConfidence) return false;
    return true;
  }).sort((a, b) => {
    // Newest first so global/whole-world views aren't dominated by older
    // persisted history (e.g. months of Indonesian data on disk).
    const at = Date.parse(a.eventTime);
    const bt = Date.parse(b.eventTime);
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return bt - at;
  });
}

function queriedSourceNames(): string[] {
  const names = ["gdelt", "rss", "youtube", "reddit", "telegram", "mastodon", "ucdp", "reliefweb", "civicus"];
  if (isAcledConfigured()) names.unshift("acled");
  if (isFirmsConfigured()) names.push("firms");
  return names;
}

export async function GET(req: NextRequest): Promise<Response> {
  const query = parseQuery(req);

  // Hydrate from disk on first request after server start.
  await hydrateFromDisk();

  // Compute "since" date for incremental fetch.
  // Overlap by 1 day to catch late-arriving articles from previous day.
  const lastUpdated = getStoreLastUpdated();
  const sinceDate = lastUpdated
    ? new Date(lastUpdated.getTime() - 24 * 60 * 60 * 1000)
    : null;
  const sinceISO = sinceDate ? sinceDate.toISOString().slice(0, 10) : undefined;

  // Hot path: serve from list cache.
  const cached = getCachedList(query);
  if (cached) {
    const filtered = applyFilters(cached, query).slice(0, query.limit);
    const body: EventsApiResponse = {
      events: filtered,
      total: filtered.length,
      cached: true,
      degraded: false,
      sources: queriedSourceNames(),
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Cold path: fetch all sources in parallel. Promise.allSettled so a single
  // source failure never breaks the response.
  // Pass `since` to GDELT (supports date filter). RSS always returns recent,
  // so we merge with persisted events on disk.
  const results = await Promise.allSettled([
    fetchAcledEvents(query.limit),
    fetchGdeltEvents({ from: sinceISO, to: query.to, limit: query.limit }),
    fetchRssEvents(),
    fetchYoutubeEvents(),
    fetchRedditEvents(),
    fetchTelegramEvents(),
    fetchMastodonEvents(),
    fetchUcdpEvents(),
    fetchReliefWebEvents(),
    fetchCivicusEvents(),
    fetchFirmsEvents(),
  ]);

  const sourceNames = ["acled", "gdelt", "rss", "youtube", "reddit", "telegram", "mastodon", "ucdp", "reliefweb", "civicus", "firms"];
  const fetched: SourceFetchResult[] = results.map((r, i) => {
    const name = sourceNames[i];
    if (r.status === "fulfilled") {
      return {
        name,
        events: r.value.events,
        ok: !r.value.error,
        cached: r.value.fromCache,
        skipped: "skipped" in r.value ? r.value.skipped : false,
        error: r.value.error,
      };
    }
    return {
      name,
      events: [],
      ok: false,
      cached: false,
      skipped: false,
      error: r.reason instanceof Error ? r.reason.message : "rejected",
    };
  });

  // Merge all events across sources (fuzzy match by province|date|title prefix).
  const allEvents = fetched.flatMap((r) => r.events);
  const merged = mergeEvents(allEvents);

  // Persist new events to disk (incremental JSONL + markdown).
  // Then combine with previously persisted events so the response includes
  // full history, not just the latest fetch.
  await upsertEvents(merged);
  const { allKnownEvents } = await import("@/lib/eventsStore");
  const fullHistory = allKnownEvents();

  // Cache the merged list (unfiltered) so subsequent identical queries are fast.
  setCachedList(query, fullHistory);

  // Apply request-specific filters.
  const filtered = applyFilters(fullHistory, query).slice(0, query.limit);

  // Degraded = at least one source errored AND we still have data from others.
  // If ALL sources errored and we have zero events, degraded stays true so the
  // client knows the data is stale/empty.
  const anyError = fetched.some((r) => !r.ok && !r.skipped);
  const anyData = filtered.length > 0;

  const body: EventsApiResponse = {
    events: filtered,
    total: filtered.length,
    cached: false,
    degraded: anyError || !anyData,
    sources: fetched.filter((r) => !r.skipped).map((r) => r.name),
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
