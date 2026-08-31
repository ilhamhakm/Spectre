// Telegram public channel source.
// Public Telegram channels expose HTML at https://t.me/s/<channelname>
// We scrape this HTML for messages containing protest keywords.
// No bot token needed — just a public channel URL.

import NodeCache from "node-cache";
import type { ProtestEvent, EventSource } from "../types";
import { extractLocation } from "./locations";

const CACHE_TTL_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 10000;

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60,
  useClones: false,
});

// Indonesian protest-watching Telegram channels (public mirrors).
// These are civil-society / news aggregator channels — not official sources,
// but useful for early signal of unrest.
const CHANNELS = [
  { name: "detiknews", url: "https://t.me/s/detiknews" },
  { name: "kompas", url: "https://t.me/s/kompascom" },
  { name: "tempo", url: "https://t.me/s/tempoenglish" },
];

const KEYWORDS = /unjukrasa|demonstran|demonstrasi|mahasiswa\s+(aksi|tolak|demo)|buruh\s+(mogok|protes)|mogok\s+kerja|protes|tolak\s+RUU|reformasi|\bOPM\b|free\s+papua|separatis|kerusuhan|bentrok\s+(polisi|aparat)|tawuran|aksi\s+(mahasiswa|buruh|tolak)/i;

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${prefix}-${hex}`;
}

interface TelegramMessage {
  text: string;
  link: string;
  timestamp: string | null;
}

function parseTelegramHtml(html: string, channelUrl: string): TelegramMessage[] {
  // Telegram public preview HTML structure:
  //   <div class="tgme_widget_message_wrap ...">
  //     <div class="tgme_widget_message ...">
  //       ...
  //       <div class="tgme_widget_message_text ..."> ...message... </div>
  //       <a class="tgme_widget_message_link_preview" ...> ...link preview... </a>
  //       <div class="tgme_widget_message_footer ...">
  //         ...
  //         <a class="tgme_widget_message_date" href="...">
  //           <time datetime="2026-07-30T07:11:55+00:00" class="time">07:11</time>
  //         </a>
  //       </div>
  //     </div>
  //   </div>
  // Two quirks the previous parser got wrong:
  //   1. datetime lives on a nested <time> element, not on the <a> tag.
  //   2. The message_text div may contain nested divs (link previews), so a
  //      non-greedy capture up to the first </div> truncates the body. We
  //      capture up to the footer boundary instead.
  const messages: TelegramMessage[] = [];
  const chunks = html.split(/<div class="tgme_widget_message_wrap[^"]*">/);
  chunks.shift();

  const textCaptureRe =
    /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)(?:<div class="tgme_widget_message_footer|<a class="tgme_widget_message_date|$)/;
  const timeRe = /<time datetime="([^"]*)"/;
  const dateLinkRe = /<a class="tgme_widget_message_date" href="([^"]*)"/;
  const linkPreviewRe =
    /<a class="tgme_widget_message_link_preview[^"]*"[^>]*>[\s\S]*?<\/a>/g;

  for (const chunk of chunks) {
    const textMatch = chunk.match(textCaptureRe);
    if (!textMatch) continue; // text_not_supported messages have no text div

    let raw = textMatch[1];
    raw = raw.replace(linkPreviewRe, " ");

    const text = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    const timeMatch = chunk.match(timeRe);
    const dateMatch = chunk.match(dateLinkRe);
    messages.push({
      text,
      link: dateMatch?.[1] || channelUrl,
      timestamp: timeMatch?.[1] ?? null,
    });
  }
  return messages;
}

function mapMessageToEvent(msg: TelegramMessage, channelName: string): ProtestEvent | null {
  if (!msg.text || !KEYWORDS.test(msg.text)) return null;
  const loc = extractLocation(msg.text);
  if (!loc) return null;

  const eventTime = msg.timestamp || new Date().toISOString();
  const source: EventSource = {
    id: stableId("src", `telegram|${msg.link}`),
    sourceType: "telegram",
    sourceName: `Telegram: ${channelName}`,
    sourceUrl: msg.link,
    narrative: "social",
    ingestedAt: new Date().toISOString(),
  };

  return {
    id: stableId("evt", `telegram|${msg.link}`),
    type: "protest",
    title: msg.text.slice(0, 200),
    description: msg.text,
    locationName: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    province: loc.name,
    eventTime,
    createdAt: new Date().toISOString(),
    confidence: 40,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: false,
    sources: [source],
  };
}

async function fetchChannel(channel: { name: string; url: string }): Promise<TelegramMessage[]> {
  try {
    const res = await fetch(channel.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseTelegramHtml(html, channel.url);
  } catch {
    return [];
  }
}

export interface TelegramResult {
  events: ProtestEvent[];
  fromCache: boolean;
  error?: string;
}

export async function fetchTelegramEvents(): Promise<TelegramResult> {
  const cacheKey = "telegram|all";
  const cached = cache.get<ProtestEvent[]>(cacheKey);
  if (cached) return { events: cached, fromCache: true };

  try {
    const results = await Promise.all(CHANNELS.map(fetchChannel));
    const events = results
      .flatMap((msgs, i) =>
        msgs.map((m) => mapMessageToEvent(m, CHANNELS[i].name)).filter((e): e is ProtestEvent => e !== null),
      );
    if (events.length > 0) cache.set(cacheKey, events);
    return { events, fromCache: false };
  } catch (e) {
    return { events: [], fromCache: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export function _resetTelegramCacheForTests(): void {
  cache.flushAll();
}
