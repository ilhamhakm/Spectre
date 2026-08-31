// ReliefWeb global RSS client.
// Source: https://reliefweb.int/updates/rss.xml
// Free, no auth. Real-time humanitarian + complex emergency alerts.
// ReliefWeb's JSON API was deprecated (410 Gone), so we use the RSS endpoint.

import Parser from "rss-parser";
import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const CACHE_TTL_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 8000;

const FEEDS: { name: string; url: string }[] = [
  {
    name: "ReliefWeb Global",
    url: "https://reliefweb.int/updates/rss.xml",
  },
  {
    name: "ReliefWeb CE",
    url: "https://reliefweb.int/updates/rss.xml?disaster_type=CE",
  },
];

const PROTEST_TERMS =
  /protest|riot|unrest|demonstrat|crackdown|arrest|displacement|conflict|violence|civil/i;

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

function mapItem(item: RssItem, feedName: string): ProtestEvent | null {
  const title = (item.title ?? "").trim();
  if (!title) return null;
  const haystack = `${title}\n${item.contentSnippet ?? item.content ?? ""}`;
  if (!PROTEST_TERMS.test(haystack)) return null;

  const loc = extractLocation(haystack);
  if (!loc) return null;

  const link = item.link ?? "";
  const eventTime = parseDate(item);
  const source: EventSource = {
    id: stableId("src", `reliefweb|${feedName}|${link || title}`),
    sourceType: "reliefweb",
    sourceName: `ReliefWeb (${feedName})`,
    sourceUrl: link || undefined,
    narrative: "international",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `reliefweb|${feedName}|${link || title}`),
    type: "other",
    title,
    description: item.contentSnippet,
    locationName: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    province: loc.name,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: 35,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

async function fetchOneFeed(feed: { name: string; url: string }): Promise<ProtestEvent[]> {
  try {
    const parsed = (await parser.parseURL(feed.url)) as RssFeed;
    const out: ProtestEvent[] = [];
    for (const item of parsed.items ?? []) {
      const ev = mapItem(item, feed.name);
      if (ev) out.push(ev);
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "reliefweb fetch failed";
    console.warn(`[reliefweb] ${feed.name} fetch failed: ${msg}`);
    return [];
  }
}

export interface ReliefWebResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchReliefWebEvents(): Promise<ReliefWebResult> {
  const cacheKey = "reliefweb|all";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  const results = await Promise.all(FEEDS.map(fetchOneFeed));
  const events = results.flat();
  cache.set(cacheKey, events);
  return { events, fromCache: false };
}

export function _resetReliefWebCacheForTests(): void {
  cache.flushAll();
}
