// YouTube source — fetches Atom XML upload feeds from major Indonesian news
// channels via rss-parser (which can parse Atom as well as RSS).
// Filters for protest-related uploads and geocodes via title extraction.
// Free, no auth. Docs: https://www.youtube.com/feeds/videos.xml?channel_id=...

import Parser from "rss-parser";
import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const CACHE_TTL_SECONDS = 300; // 5 min
const REQUEST_TIMEOUT_MS = 8000;

interface ChannelConfig {
  name: string;
  channelId: string;
}

const CHANNELS: readonly ChannelConfig[] = [
  { name: "detikcom", channelId: "UCuMAjEaSMj7q7YLf0xW1MjQ" },
  { name: "Kompas TV", channelId: "UCneA4BuveCEgJql1m7lwFag" },
  { name: "tvOne", channelId: "UCER4rvDnRBPr_ncYW4UCZjg" },
  { name: "MetroTV", channelId: "UCkbPntO_8G2BF2HmLcrsZXA" },
  { name: "kompas.com", channelId: "UCPAxpUn1mrn14xU0JpsLhDg" },
];

// Protest keyword filter — Indonesian + English protest-related terms.
const KEYWORDS =
  /unjukrasa|demonstran|demonstrasi|mahasiswa\s+(aksi|tolak|demo)|buruh\s+(mogok|protes)|mogok\s+kerja|tolak\s+RUU|reformasi|\bOPM\b|free\s+papua|separatis|kerusuhan|bentrok|tawuran|protes|aksi\s+(mahasiswa|buruh|tolak)|riot|protest|unrest/i;

const LIVE_PREFIX = /^\s*\[LIVE\]/i;

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

type AtomItem = {
  title?: string;
  link?: string | Array<{ href?: string; rel?: string }>;
  pubDate?: string;
  isoDate?: string;
  published?: string;
  content?: string;
  contentSnippet?: string;
  id?: string;
  videoId?: string;
};

type AtomFeed = {
  items?: AtomItem[];
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

function extractLink(item: AtomItem): string | undefined {
  const link = item.link;
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alternate = link.find((l) => !l.rel || l.rel === "alternate");
    if (alternate?.href) return alternate.href;
    return link.find((l) => l.href)?.href;
  }
  return undefined;
}

function parseDate(item: AtomItem): string {
  const raw = item.isoDate ?? item.pubDate ?? item.published;
  if (!raw) return new Date().toISOString();
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
}

function mapItemToEvent(item: AtomItem, channel: ChannelConfig): ProtestEvent | null {
  const title = (item.title ?? "").trim();
  if (!title) return null;

  const haystack = `${title}\n${item.contentSnippet ?? item.content ?? ""}`;
  if (!KEYWORDS.test(haystack)) return null;

  const loc = extractLocation(haystack);
  if (!loc) return null; // skip if no extractable location

  const link = extractLink(item) ?? (item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : undefined);
  const eventTime = parseDate(item);
  // Live streams are high-signal — boost confidence when [LIVE] prefix present.
  const isLive = LIVE_PREFIX.test(title);
  const confidence = isLive ? 50 : 30;

  const source: EventSource = {
    id: stableId("src", `youtube|${channel.name}|${link ?? title}`),
    sourceType: "rss", // EventSource has no "youtube" variant; reuse rss.
    sourceName: `${channel.name} (YouTube)`,
    sourceUrl: link,
    narrative: "social",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `youtube|${channel.name}|${link ?? title}`),
    type: "protest",
    title,
    description: item.contentSnippet,
    locationName: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    province: loc.name,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

async function fetchOneChannel(channel: ChannelConfig): Promise<AtomItem[]> {
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
    const parsed = (await parser.parseURL(url)) as AtomFeed;
    return parsed.items ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "youtube fetch failed";
    console.warn(`[youtube] ${channel.name} fetch failed: ${msg}`);
    return [];
  }
}

export interface YoutubeResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchYoutubeEvents(): Promise<YoutubeResult> {
  const cacheKey = "youtube|all-channels";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  try {
    const results = await Promise.all(CHANNELS.map(fetchOneChannel));
    const events: ProtestEvent[] = [];
    CHANNELS.forEach((channel, i) => {
      for (const item of results[i]) {
        const ev = mapItemToEvent(item, channel);
        if (ev) events.push(ev);
      }
    });
    cache.set(cacheKey, events);
    return { events, fromCache: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "youtube fetch failed";
    console.warn(`[youtube] fetch failed: ${msg}`);
    return { events: [], fromCache: false, error: msg };
  }
}

export function _resetYoutubeCacheForTests(): void {
  cache.flushAll();
}
