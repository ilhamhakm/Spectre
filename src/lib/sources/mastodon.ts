// Mastodon source — searches the federated Mastodon network for posts
// mentioning Indonesian protests. Uses the public tags API on mastodon.social.
// No auth needed for public tag timelines.
//
// Example: https://mastodon.social/api/v1/timelines/tag/indonesia?limit=40

import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const CACHE_TTL_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 8000;

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

// Mastodon instances to query (different instances have different posts)
const INSTANCES = [
  { name: "mastodon.social", url: "https://mastodon.social/api/v1/timelines/tag/indonesia?limit=40" },
  { name: "mas.to", url: "https://mas.to/api/v1/timelines/tag/indonesia?limit=40" },
  { name: "fosstodon.org", url: "https://fosstodon.org/api/v1/timelines/tag/indonesia?limit=40" },
];

// Only the "papua" tag yields real protest signal (separatism, OPM, etc.).
// The "indonesia" and "jakarta" tags return noise (recipes, travel blogs).
const TAGS = ["papua", "protest"];

const KEYWORDS = /protest|demonstrat|riot|unrest|unjukrasa|demonstran|mahasiswa\s+(aksi|tolak|demo)|buruh\s+(mogok|protes)|mogok\s+kerja|tolak\s+RUU|reformasi|\bOPM\b|free\s+papua|separatis|kerusuhan|bentrok|tawuran/i;

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${prefix}-${hex}`;
}

interface MastodonStatus {
  id: string;
  content: string;
  url: string;
  created_at: string;
  account: { acct: string; display_name: string };
  tags: { name: string }[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function mapStatusToEvent(status: MastodonStatus, instance: string): ProtestEvent | null {
  const text = stripHtml(status.content);
  if (!text) return null;
  if (!KEYWORDS.test(text)) return null;

  const loc = extractLocation(text);
  if (!loc) return null;

  const link = status.url || `https://${instance}/@${status.account.acct}/${status.id}`;
  const source: EventSource = {
    id: stableId("src", `mastodon|${status.id}`),
    sourceType: "telegram", // reuse social type
    sourceName: `Mastodon @${status.account.acct} (${instance})`,
    sourceUrl: link,
    narrative: "social",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `mastodon|${status.id}`),
    type: "protest",
    title: text.slice(0, 200),
    description: text,
    locationName: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    province: loc.name,
    eventTime: status.created_at,
    createdAt: new Date().toISOString(),
    confidence: 25,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

async function fetchInstance(
  instance: { name: string; url: string },
): Promise<MastodonStatus[]> {
  try {
    const res = await fetch(instance.url, {
      headers: {
        "User-Agent": "spectre/0.1 (osint monitor)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return (await res.json()) as MastodonStatus[];
  } catch {
    return [];
  }
}

export interface MastodonResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchMastodonEvents(): Promise<MastodonResult> {
  const cacheKey = "mastodon|all";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  try {
    // Build URLs for all tag searches across all instances
    const urls: { name: string; url: string }[] = [];
    for (const instance of INSTANCES) {
      for (const tag of TAGS) {
        urls.push({
          name: instance.name,
          url: `https://${instance.name}/api/v1/timelines/tag/${tag}?limit=40`,
        });
      }
    }
    const results = await Promise.all(urls.map(fetchInstance));
    const allStatuses = results.flat();
    // Dedup by id
    const seen = new Set<string>();
    const deduped = allStatuses.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    const events = deduped
      .map((s) => {
        const instanceName = INSTANCES.find((i) => s.url?.includes(i.name))?.name || "mastodon.social";
        return mapStatusToEvent(s, instanceName);
      })
      .filter((e): e is ProtestEvent => e !== null);
    cache.set(cacheKey, events);
    return { events, fromCache: false };
  } catch (e) {
    return { events: [], fromCache: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export function _resetMastodonCacheForTests(): void {
  cache.flushAll();
}
