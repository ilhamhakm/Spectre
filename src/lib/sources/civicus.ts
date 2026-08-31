// CIVICUS Monitor RSS client.
// Source: https://monitor.civicus.org/feed/
// Free, no auth. Daily civic space alerts (protest, arrests, restrictions).
// Global feed — all countries; geocoded via the global gazetteer.

import Parser from "rss-parser";
import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const CACHE_TTL_SECONDS = 600; // 10 min
const REQUEST_TIMEOUT_MS = 8000;
const FEED_URL = "https://monitor.civicus.org/feed/";

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

const parser = new Parser({
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "User-Agent": "spectre/0.1 (osint monitor)" },
});

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
  creator?: string;
  categories?: string[];
};

type RssFeed = { items?: RssItem[] };

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function parseDate(item: RssItem): string {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return new Date().toISOString();
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
}

function mapItem(item: RssItem): ProtestEvent | null {
  const title = (item.title ?? "").trim();
  if (!title) return null;

  const haystack = `${title}\n${item.contentSnippet ?? item.content ?? ""}`;

  const loc = extractLocation(haystack);
  if (!loc) return null;

  const link = item.link ?? "";
  const eventTime = parseDate(item);
  const source: EventSource = {
    id: stableId("src", `civicus|${link || title}`),
    sourceType: "civicus",
    sourceName: "CIVICUS Monitor",
    sourceUrl: link || undefined,
    narrative: "civil_society",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `civicus|${link || title}`),
    type: "protest",
    title,
    description: item.contentSnippet,
    locationName: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    province: loc.name,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: 45,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

export interface CivicusResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchCivicusEvents(): Promise<CivicusResult> {
  const cacheKey = "civicus|feed";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  try {
    const parsed = await parser.parseURL(FEED_URL) as RssFeed;
    const out: ProtestEvent[] = [];
    for (const item of parsed.items ?? []) {
      const ev = mapItem(item);
      if (ev) out.push(ev);
    }
    cache.set(cacheKey, out);
    return { events: out, fromCache: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "civicus fetch failed";
    console.warn(`[civicus] fetch failed: ${msg}`);
    return { events: [], fromCache: false, error: msg };
  }
}

export function _resetCivicusCacheForTests(): void {
  cache.flushAll();
}
