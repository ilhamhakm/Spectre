// GET /api/events - multi-source civil unrest events API.
//
// Fetches from all Spectre v1 sources in parallel:
//   - GDELT DOC API (global news articles, geocoded)
//   - ACLED (verified ground-truth, requires API key)
//   - RSS feeds (Tempo, Antara, CNN ID, Tribun, Google News, civil society)
//   - YouTube (Indonesian news channel upload feeds)
//   - Reddit (r/indonesia, r/Jakarta, r/indonesian)
//   - Telegram (public channel HTML scrape)
//   - Mastodon (federated tag timelines)
//   - UCDP (Uppsala Conflict Data Program, CSV)
//   - ReliefWeb (humanitarian RSS)
//   - CIVICUS Monitor (civic space alerts RSS)
//   - FIRMS (NASA fire detection, requires API key)
//
// All sources return ProtestEvent[] which we convert to ParsedArticle[]
// and run through the same pipeline as /api/gdelt:
//   landmark refinement, clustering, crowd size, anarchy probability.
//
// Response: same GeoJSON FeatureCollection as /api/gdelt.

import { NextResponse } from "next/server";
import type { ProtestEvent } from "@/lib/types";
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
import {
  buildCollection,
  refineArticleCoordinates,
  type ParsedArticle,
} from "@/lib/unrest-pipeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

let cacheBody: string | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Convert a ProtestEvent from any source into a ParsedArticle that the
// pipeline (buildCollection) can process. Applies landmark refinement
// using the same database as the GDELT route.
function protestEventToArticle(ev: ProtestEvent): ParsedArticle {
  const lat = ev.lat;
  const lon = ev.lon;
  const title = ev.title;
  const country = ev.locationName ?? ev.province ?? "";
  const eventTime = Date.parse(ev.eventTime) || Date.now();
  const ageHours = (Date.now() - eventTime) / 3_600_000;

  // Determine country name from location/province fields.
  // The landmark database uses country names like "Indonesia", "France", etc.
  const countryName = inferCountryName(ev);

  const refined = refineArticleCoordinates(lat, lon, countryName, title);

  return {
    title,
    url: ev.sources[0]?.sourceUrl ?? "",
    seendate: ev.eventTime,
    country: countryName,
    domain: ev.sources[0]?.sourceName ?? "",
    lat,
    lon,
    type: ev.type === "fire" || ev.type === "earthquake" ? "other" : ev.type,
    ageHours,
    eventTime,
    refinedLat: refined ? refined.lat : lat,
    refinedLon: refined ? refined.lon : lon,
    landmark: refined ? refined.landmarkName : "",
  };
}

// Infer the country name from the event's location fields.
// The landmark database keys on country names like "Indonesia", "France", etc.
function inferCountryName(ev: ProtestEvent): string {
  const loc = `${ev.locationName ?? ""} ${ev.province ?? ""}`.toLowerCase();

  // Check if locationName or province IS a country name in our landmark DB.
  // The landmark DB has entries for: Indonesia, Lebanon, India, France, China,
  // Sudan, Iran, United Kingdom, Colombia, Nigeria, Thailand, Belarus, Chile,
  // Greece, Brazil, Egypt, United States, Ukraine, Germany, Mexico, South Korea,
  // Philippines, Argentina, Turkey, Kenya, South Africa, Venezuela, Peru.
  const countryMap: Record<string, string> = {
    jakarta: "Indonesia", surabaya: "Indonesia", bandung: "Indonesia",
    medan: "Indonesia", semarang: "Indonesia", makassar: "Indonesia",
    palembang: "Indonesia", yogyakarta: "Indonesia", denpasar: "Indonesia",
    bali: "Indonesia", jayapura: "Indonesia", papua: "Indonesia",
    aceh: "Indonesia", padang: "Indonesia", pekanbaru: "Indonesia",
    banjarmasin: "Indonesia", pontianak: "Indonesia", samarinda: "Indonesia",
    balikpapan: "Indonesia", manado: "Indonesia", ambon: "Indonesia",
    "banda aceh": "Indonesia", tangerang: "Indonesia", depok: "Indonesia",
    bekasi: "Indonesia", indonesia: "Indonesia",
    beirut: "Lebanon", lebanon: "Lebanon",
    "new delhi": "India", delhi: "India", mumbai: "India", india: "India",
    paris: "France", france: "France",
    "hong kong": "China", beijing: "China", shanghai: "China", china: "China",
    khartoum: "Sudan", sudan: "Sudan",
    tehran: "Iran", iran: "Iran",
    london: "United Kingdom", "united kingdom": "United Kingdom", uk: "United Kingdom", britain: "United Kingdom",
    bogota: "Colombia", colombia: "Colombia",
    lagos: "Nigeria", abuja: "Nigeria", nigeria: "Nigeria",
    bangkok: "Thailand", thailand: "Thailand",
    minsk: "Belarus", belarus: "Belarus",
    santiago: "Chile", chile: "Chile",
    athens: "Greece", greece: "Greece",
    brasilia: "Brazil", "sao paulo": "Brazil", brazil: "Brazil",
    cairo: "Egypt", egypt: "Egypt",
    washington: "United States", "new york": "United States", "united states": "United States", usa: "United States",
    kiev: "Ukraine", kyiv: "Ukraine", ukraine: "Ukraine",
    berlin: "Germany", germany: "Germany",
    "mexico city": "Mexico", mexico: "Mexico",
    seoul: "South Korea", "south korea": "South Korea",
    manila: "Philippines", philippines: "Philippines",
    "buenos aires": "Argentina", argentina: "Argentina",
    istanbul: "Turkey", ankara: "Turkey", turkey: "Turkey",
    nairobi: "Kenya", kenya: "Kenya",
    pretoria: "South Africa", johannesburg: "South Africa", "south africa": "South Africa",
    caracas: "Venezuela", venezuela: "Venezuela",
    lima: "Peru", peru: "Peru",
  };

  for (const [key, country] of Object.entries(countryMap)) {
    if (loc.includes(key)) return country;
  }

  // Fallback: use locationName as-is if it looks like a country name.
  return ev.locationName ?? ev.province ?? "Unknown";
}

export async function GET() {
  // Serve from cache if fresh.
  const now = Date.now();
  if (cacheBody && now - cacheTime < CACHE_TTL_MS) {
    return new NextResponse(cacheBody, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Data-Source": "events-cached",
      },
    });
  }

  // Fetch all sources in parallel. Promise.allSettled so a single source
  // failure never breaks the response.
  const results = await Promise.allSettled([
    fetchAcledEvents(250),
    fetchGdeltEvents({ limit: 250 }),
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

  const sourceNames = [
    "acled", "gdelt", "rss", "youtube", "reddit",
    "telegram", "mastodon", "ucdp", "reliefweb", "civicus", "firms",
  ];

  // Collect all events from all sources.
  const allEvents: ProtestEvent[] = [];
  const sourceStatus: Array<{ name: string; ok: boolean; count: number; skipped: boolean }> = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = sourceNames[i];
    if (r.status === "fulfilled") {
      allEvents.push(...r.value.events);
      const skipped = "skipped" in r.value ? r.value.skipped : false;
      sourceStatus.push({ name, ok: !r.value.error, count: r.value.events.length, skipped });
    } else {
      sourceStatus.push({ name, ok: false, count: 0, skipped: false });
    }
  }

  // Convert all ProtestEvents to ParsedArticles for the pipeline.
  const articles: ParsedArticle[] = allEvents.map(protestEventToArticle);

  // Run through the same pipeline as /api/gdelt:
  // landmark refinement, clustering, crowd size, anarchy probability.
  const collection = buildCollection(articles);

  // Add source metadata to the response.
  const response = {
    ...collection,
    sources: sourceStatus,
    generatedAt: new Date().toISOString(),
  };

  cacheBody = JSON.stringify(response);
  cacheTime = now;

  return new NextResponse(cacheBody, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Data-Source": "events-live",
    },
  });
}
