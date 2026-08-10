// RSS aggregator - fetches news feeds (Tempo, Antara, CNN ID, Tribun + global
// Google News protest queries), keyword-filters for protest-related stories,
// and maps them to ProtestEvent.
// Build Agent B owns this. Per architecture 3.2: 5-min cache, keyword filter,
// geocode via title extraction.

import Parser from "rss-parser";
import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const RSS_CACHE_TTL_SECONDS = 300; // 5 min per architecture
const REQUEST_TIMEOUT_MS = 8000;

interface FeedConfig {
  name: string;
  url: string;
  narrative: EventSource["narrative"];
}

const FEEDS: readonly FeedConfig[] = [
  { name: "Tempo", url: "https://rss.tempo.co/nasional", narrative: "civil_society" },
  { name: "Antara", url: "https://www.antaranews.com/rss/nasional.xml", narrative: "official" },
  { name: "CNN Indonesia", url: "https://www.cnnindonesia.com/nasional/rss", narrative: "international" },
  { name: "Tribun", url: "https://www.tribunnews.com/rss-nasional.xml", narrative: "civil_society" },
  // Google News aggregators — Indonesian-language protest query, free, no auth
  {
    name: "Google News ID",
    url: "https://news.google.com/rss/search?q=unjukrasa+OR+demonstrasi+OR+mahasiswa+OR+buruh+mogok+OR+tolak+RUU+OR+protes&hl=id&gl=ID&ceid=ID:id",
    narrative: "international",
  },
  {
    name: "Google News EN",
    url: "https://news.google.com/rss/search?q=protest+OR+riot+OR+unrest+OR+demonstration&hl=en&gl=US&ceid=US:en",
    narrative: "international",
  },
  // Indonesian civil society + rights org RSS feeds (free, no auth).
  { name: "Kontras", url: "https://kontras.org/feed/", narrative: "civil_society" },
  { name: "Amnesty Indonesia", url: "https://www.amnesty.id/feed/", narrative: "civil_society" },
  { name: "SAFEnet", url: "https://safenet.or.id/feed/", narrative: "civil_society" },
  { name: "Imparsial", url: "https://imparsial.org/feed/", narrative: "civil_society" },
  { name: "YLBHI", url: "https://ylbhi.or.id/feed/", narrative: "civil_society" },
  { name: "Detik News", url: "https://news.detik.com/rss", narrative: "civil_society" },
  { name: "Okezone", url: "https://www.okezone.com/rss", narrative: "civil_society" },
  { name: "Republika", url: "https://www.republika.co.id/rss/", narrative: "civil_society" },
];

// Protest keyword filter — must contain at least one protest-related term.
// Strictly excludes generic political news that mentions "istana" or "president"
// without an actual protest/demonstration context.
const PROTEST_TERMS =
  /unjukrasa|demonstran|demonstrasi|mahasiswa\s+(dari|gelar|aksi|tolak|demo)|buruh\s+(mogok|padati|protes|demo|aksi)|menolak\s+(RUU|UU|omnibus|pemerintah|kebijakan)|mogok\s+(kerja|buruh|nasional)|protes|aksi\s+(protes|damai|mahasiswa|buruh|tolak)|demo\s+(di|di\s+jakarta|di\s+depan|massa|juta|ribu)|tolak\s+(RUU|UU|pemerintah|kebijakan|omnibus|revisi)|reformasi|readsi\s+mahasiswa|bentrok\s+(dengan\s+polisi|aparat)|\bOPM\b|separatis|free\s+papua|konflik\s+agama|kerusuhan|tawuran|anarkis/i;

// Negative filter — exclude these contexts even if a protest term matches.
// "Istana soal..." without "demo" or "protes" is just palace commentary.
const EXCLUDE_TERMS =
  /soal\s+pagar|kata\s+istana|istana\s+(soal|klaim|tegas|jawab|bantah|sebut)|jubir\s+pemprov|gembira\s+potret|pemberian\s+bantuan|salurkan\s+bantuan|groundbreaking|peresmian\s+sekolah/i;

const KEYWORD_REGEX = PROTEST_TERMS;

const cache = new NodeCache({
  stdTTL: RSS_CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
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

type RssFeed = {
  items?: RssItem[];
  title?: string;
  link?: string;
};

const parser = new Parser({
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "User-Agent": "spectre/0.1 (osint monitor)" },
});

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${prefix}-${hex}`;
}

function parseDate(item: RssItem): string {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return new Date().toISOString();
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
}

function mapItemToEvent(item: RssItem, feed: FeedConfig): ProtestEvent | null {
  const title = (item.title ?? "").trim();
  if (!title) return null;

  const haystack = `${title}\n${item.contentSnippet ?? item.content ?? ""}`;
  if (!KEYWORD_REGEX.test(haystack)) return null;
  if (EXCLUDE_TERMS.test(haystack)) return null;

  const loc = extractLocation(haystack);
  if (!loc) return null; // v0: skip items with no extractable location

  const link = item.link;
  const eventTime = parseDate(item);
  const source: EventSource = {
    id: stableId("src", `rss|${feed.name}|${link ?? title}`),
    sourceType: "rss",
    sourceName: feed.name,
    sourceUrl: link,
    narrative: feed.narrative,
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `rss|${feed.name}|${link ?? title}`),
    type: "protest",
    title,
    description: item.contentSnippet,
    locationName: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    province: loc.name,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: 20,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

async function fetchOneFeed(feed: FeedConfig): Promise<ProtestEvent[]> {
  try {
    const parsed = (await parser.parseURL(feed.url)) as RssFeed;
    const items = parsed.items ?? [];
    const out: ProtestEvent[] = [];
    for (const item of items) {
      const ev = mapItemToEvent(item, feed);
      if (ev) out.push(ev);
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rss fetch failed";
    console.warn(`[rss] ${feed.name} fetch failed: ${msg}`);
    return [];
  }
}

export interface RssResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchRssEvents(): Promise<RssResult> {
  const cacheKey = "rss|all-feeds";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  const results = await Promise.all(FEEDS.map(fetchOneFeed));
  const events = results.flat();
  cache.set(cacheKey, events);
  return { events, fromCache: false };
}

export function _resetRssCacheForTests(): void {
  cache.flushAll();
}
