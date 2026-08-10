// Shared in-memory event store for the v0 events API.
// Build Agent B owns this. Replaces Supabase + Realtime (Phase 2 will swap implementations
// behind the same exported function signatures).
//
// Responsibilities:
//   1. List cache (TTL 5 min, keyed by canonical query string)
//   2. Detail cache (TTL 5 min, keyed by event id)
//   3. Known-events index (drives /api/events/[id] lookups when no Supabase exists yet)
//   4. Inline verification_level computation (Agent E may replace lib/verification.ts later;
//      this is the v0 fallback per task spec: >=3 major outlets -> confirmed,
//      >=2 distinct sources -> multi, else unconfirmed)
//   5. SSE pub/sub for the /api/events/stream route

import NodeCache from "node-cache";
import type { ProtestEvent, Source, VerificationLevel } from "./types";
import { loadFromDisk, appendToDisk, getLastUpdated } from "./persistentStore";

const LIST_TTL_SECONDS = 300; // 5 min — matches RSS refresh
const DETAIL_TTL_SECONDS = 300;

const listCache = new NodeCache({
  stdTTL: LIST_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});
const detailCache = new NodeCache({
  stdTTL: DETAIL_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

// In-memory "events table" — v0 stand-in for Supabase events table.
const knownEvents = new Map<string, ProtestEvent>();

// Track whether we've hydrated from disk yet.
let hydrated = false;

/** Hydrate the in-memory store from disk. Call once on first access. */
export async function hydrateFromDisk(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const persisted = await loadFromDisk();
  for (const ev of persisted) {
    knownEvents.set(ev.id, ev);
  }
  console.log(`[store] hydrated ${persisted.length} events from disk into memory`);
}

/** Get the timestamp of the most recent persisted event (for incremental fetch). */
export function getStoreLastUpdated(): Date | null {
  return getLastUpdated();
}

/** Persist a batch of newly upserted events to disk (JSONL + markdown). */
async function persistNew(events: ProtestEvent[]): Promise<void> {
  try {
    await appendToDisk(events);
  } catch (e) {
    console.warn("[store] persist failed:", e instanceof Error ? e.message : e);
  }
}

// --- SSE pub/sub ---------------------------------------------------------
type EventListener = (event: ProtestEvent) => void;
const listeners = new Set<EventListener>();

export function addEventListener(cb: EventListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emitNewEvent(event: ProtestEvent): void {
  for (const sub of listeners) {
    try {
      sub(event);
    } catch {
      // listener errors must never crash ingest
    }
  }
}

// --- Verification (v0 inline; Agent E may ship lib/verification.ts later) -
const MAJOR_OUTLET_TOKENS: readonly string[] = [
  "gdelt",
  "acled",
  "tempo",
  "antara",
  "cnn indonesia",
  "cnnindonesia",
  "tribun",
];

export function computeVerificationLevel(sources: Source[]): VerificationLevel {
  if (sources.length === 0) return "unconfirmed";

  const distinctNames = new Set(
    sources.map((s) => s.sourceName.toLowerCase().trim()),
  );

  const majorHits = new Set<string>();
  for (const name of distinctNames) {
    for (const token of MAJOR_OUTLET_TOKENS) {
      if (name.includes(token)) majorHits.add(token);
    }
  }
  if (majorHits.size >= 3) return "confirmed";
  if (distinctNames.size >= 2) return "multi";
  return "unconfirmed";
}

// --- List cache ----------------------------------------------------------

function buildListKey(params: {
  type?: string;
  from?: string;
  to?: string;
  province?: string;
  minConfidence?: number;
  limit?: number;
}): string {
  const parts: string[] = [];
  parts.push(`type=${params.type ?? ""}`);
  parts.push(`from=${params.from ?? ""}`);
  parts.push(`to=${params.to ?? ""}`);
  parts.push(`province=${params.province ?? ""}`);
  parts.push(`minc=${params.minConfidence ?? 0}`);
  parts.push(`limit=${params.limit ?? 50}`);
  return parts.join("|");
}

export interface ListQuery {
  type?: string;
  from?: string;
  to?: string;
  province?: string;
  minConfidence?: number;
  limit?: number;
}

export function getCachedList(query: ListQuery): ProtestEvent[] | undefined {
  return listCache.get<ProtestEvent[]>(buildListKey(query));
}

export function setCachedList(query: ListQuery, events: ProtestEvent[]): void {
  listCache.set(buildListKey(query), events);
}

// --- Detail cache + known events index -----------------------------------

export function getCachedDetail(id: string): ProtestEvent | undefined {
  return detailCache.get<ProtestEvent>(id) ?? knownEvents.get(id);
}

function mergeSources(a: Source[], b: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of [...a, ...b]) {
    const key = `${s.sourceType}|${s.sourceUrl ?? s.sourceName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Upsert a batch of freshly fetched events. Returns the subset that were NEW
// (i.e. not previously seen) — the SSE stream only fans those out.
export function upsertEvents(events: ProtestEvent[]): ProtestEvent[] {
  const fresh: ProtestEvent[] = [];
  for (const ev of events) {
    const prev = knownEvents.get(ev.id);
    if (!prev) {
      const withVLevel: ProtestEvent = {
        ...ev,
        verificationLevel: computeVerificationLevel(ev.sources),
      };
      knownEvents.set(ev.id, withVLevel);
      detailCache.set(ev.id, withVLevel);
      fresh.push(withVLevel);
    } else {
      const mergedSources = mergeSources(prev.sources, ev.sources);
      const merged: ProtestEvent = {
        ...ev,
        sources: mergedSources,
        verificationLevel: computeVerificationLevel(mergedSources),
        confidence: Math.max(prev.confidence, ev.confidence),
        verified: prev.verified || ev.verified,
      };
      knownEvents.set(ev.id, merged);
      detailCache.set(ev.id, merged);
    }
  }
  if (fresh.length > 0) {
    for (const ev of fresh) emitNewEvent(ev);
    // Persist new events to disk (async, fire-and-forget)
    void persistNew(fresh);
  }
  return fresh;
}

export function allKnownEvents(): ProtestEvent[] {
  return Array.from(knownEvents.values());
}

export function findEventById(id: string): ProtestEvent | undefined {
  return knownEvents.get(id) ?? detailCache.get<ProtestEvent>(id);
}

// --- Cross-source merge --------------------------------------------------
// v0 fuzzy merge: events with the same (province|date|normalized-title-prefix)
// are treated as the same protest. Limitation: GDELT (English) and RSS
// (Indonesian) titles rarely match, so cross-source merge mostly happens
// between RSS feeds. Phase 2 will swap this for proper title-similarity
// (e.g. trigram similarity) + PostGIS location match.

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function mergeKey(ev: ProtestEvent): string {
  const date = ev.eventTime.slice(0, 10); // YYYY-MM-DD
  const province = (ev.province ?? ev.locationName ?? "unknown")
    .toLowerCase()
    .trim();
  const titlePrefix = normalizeTitle(ev.title);
  return `${province}|${date}|${titlePrefix}`;
}

export function mergeEvents(input: ProtestEvent[]): ProtestEvent[] {
  const groups = new Map<string, ProtestEvent[]>();
  for (const ev of input) {
    const key = mergeKey(ev);
    const arr = groups.get(key);
    if (arr) arr.push(ev);
    else groups.set(key, [ev]);
  }

  const merged: ProtestEvent[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    // Pick the event with the most credible source as the base.
    // Priority: acled > gdelt > rss. Falls back to first.
    const priority: Record<string, number> = { acled: 3, gdelt: 2, rss: 1 };
    const sorted = [...group].sort((a, b) => {
      const pa = Math.max(...a.sources.map((s) => priority[s.sourceType] ?? 0));
      const pb = Math.max(...b.sources.map((s) => priority[s.sourceType] ?? 0));
      return pb - pa;
    });
    const base = sorted[0];
    const allSources = mergeSources(
      base.sources,
      group.flatMap((g) => g.sources),
    );
    const mergedEvent: ProtestEvent = {
      ...base,
      sources: allSources,
      verificationLevel: computeVerificationLevel(allSources),
      confidence: Math.min(
        100,
        group.reduce((sum, e) => sum + e.confidence, 0),
      ),
      verified: group.some((e) => e.verified),
      // Use find() so we get `T | undefined` matching the optional field type
      // (Agent A's ProtestEvent uses `?:` rather than `| null`).
      casualtyCount: group.find((e) => e.casualtyCount != null)?.casualtyCount,
      estimatedCrowdSize: group.find(
        (e) => e.estimatedCrowdSize != null,
      )?.estimatedCrowdSize,
      actor: group.find((e) => e.actor != null)?.actor ?? base.actor,
      description:
        group.find((e) => e.description != null)?.description ?? base.description,
    };
    merged.push(mergedEvent);
  }
  return merged;
}

// --- API response shapes -------------------------------------------------
// Agent A's types.ts ships the entity types (ProtestEvent, EventSource) but not
// the route-level response envelopes. Build Agent B defines those here so the
// route handlers and any future test harnesses share one canonical shape.
// Architecture 6.1 specifies the list response; 6.1 specifies the detail shape
// { event, sources, related }.

export interface EventsApiResponse {
  events: ProtestEvent[];
  total: number;
  cached: boolean;
  degraded: boolean;
  sources: string[];
  generatedAt: string;
}

export interface EventDetailApiResponse {
  event: ProtestEvent;
  sources: Source[];
  related: ProtestEvent[];
}
