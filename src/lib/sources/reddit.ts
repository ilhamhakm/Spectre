// Reddit source — fetches posts from r/indonesia, r/Jakarta, r/indonesian
// related to protests. Reddit exposes free JSON API by appending ".json" to URLs.
// No auth needed for read-only public data (rate limit: 100 req/min).

import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const CACHE_TTL_SECONDS = 300; // 5 min
const REQUEST_TIMEOUT_MS = 8000;

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

const SUBREDDITS = [
  { name: "r/indonesia", url: "https://www.reddit.com/r/indonesia/new.json?limit=50" },
  { name: "r/Jakarta", url: "https://www.reddit.com/r/Jakarta/new.json?limit=50" },
  { name: "r/indonesian", url: "https://www.reddit.com/r/indonesian/new.json?limit=50" },
];

// Strict protest keywords for Reddit (English + Indonesian)
const KEYWORDS = /protest|demonstrat|riot|unrest|unjukrasa|demonstran|mahasiswa\s+(aksi|tolak|demo)|buruh\s+(mogok|protes)|mogok\s+kerja|tolak\s+RUU|reformasi|\bOPM\b|free\s+papua|separatis|kerusuhan|bentrok\s+(polisi|aparat)|tawuran/i;

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${prefix}-${hex}`;
}

interface RedditPost {
  id: string;
  title: string;
  selftext?: string;
  url: string;
  created_utc: number;
  subreddit_name_prefixed: string;
  author: string;
  permalink: string;
}

function mapPostToEvent(post: RedditPost, subreddit: string): ProtestEvent | null {
  const title = (post.title || "").trim();
  if (!title) return null;

  const haystack = `${title}\n${post.selftext ?? ""}`;
  if (!KEYWORDS.test(haystack)) return null;

  const loc = extractLocation(haystack);
  if (!loc) return null;

  const link = `https://reddit.com${post.permalink}`;
  const eventTime = new Date(post.created_utc * 1000).toISOString();
  const source: EventSource = {
    id: stableId("src", `reddit|${post.id}`),
    sourceType: "rss", // reddit exposes a feed-like JSON API
    sourceName: `${subreddit} (u/${post.author})`,
    sourceUrl: link,
    narrative: "social",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `reddit|${post.id}`),
    type: "protest",
    title,
    description: post.selftext?.slice(0, 300),
    locationName: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    province: loc.name,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: 30, // social posts are mid-confidence
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

async function fetchSubreddit(sub: { name: string; url: string }): Promise<RedditPost[]> {
  try {
    const res = await fetch(sub.url, {
      headers: {
        "User-Agent": "spectre/0.1 (osint monitor)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.children ?? []).map((c: { data: RedditPost }) => c.data);
  } catch {
    return [];
  }
}

export interface RedditResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchRedditEvents(): Promise<RedditResult> {
  const cacheKey = "reddit|all";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  try {
    const results = await Promise.all(SUBREDDITS.map(fetchSubreddit));
    const posts = results.flat();
    const events = posts
      .map((p) => {
        const sub = SUBREDDITS.find((s) => p.subreddit_name_prefixed === s.name)?.name || "reddit";
        return mapPostToEvent(p, sub);
      })
      .filter((e): e is ProtestEvent => e !== null);
    cache.set(cacheKey, events);
    return { events, fromCache: false };
  } catch (e) {
    return { events: [], fromCache: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export function _resetRedditCacheForTests(): void {
  cache.flushAll();
}
