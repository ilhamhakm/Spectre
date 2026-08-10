// Persistent JSONL store for protest events.
// - On startup: loads all events from data/events.jsonl into memory
// - On upsert: appends new events to the file (incremental)
// - Tracks lastUpdated so we only fetch fresh data after the gap
// - Daily markdown logs in data/daily/YYYY-MM-DD.md (one file per day)
//
// Format: one JSON event per line (JSON Lines / NDJSON).
// File: data/events.jsonl (project root, gitignored if desired).

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProtestEvent } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DAILY_DIR = path.join(DATA_DIR, "daily");
const JSONL_FILE = path.join(DATA_DIR, "events.jsonl");
const MD_FILE = path.join(DATA_DIR, "events.md");

let loaded = false;
let lastUpdated: Date | null = null;
const persistedIds = new Set<string>();
const dailyWrittenIds = new Set<string>(); // track which (date,id) pairs are in daily files

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(DAILY_DIR, { recursive: true });
  } catch {
    // directory already exists
  }
}

function fmtDailyDate(iso: string): string {
  // Use the event's date in Asia/Jakarta timezone
  return new Date(iso).toLocaleString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

function fmtDailyDisplay(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function formatMdRow(ev: ProtestEvent): string {
  const time = new Date(ev.eventTime).toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
  const sources = ev.sources
    .map((s) => `[${s.sourceName}](${s.sourceUrl || "#"})`)
    .join(", ");
  const title = ev.title.replace(/\|/g, "\\|").slice(0, 100);
  const loc = (ev.locationName || ev.province || "?").replace(/\|/g, "\\|");
  return `| ${time} WIB | ${ev.type} | ${loc} | ${title} | ${sources} |`;
}

/** Load all events from disk into memory. Safe to call multiple times. */
export async function loadFromDisk(): Promise<ProtestEvent[]> {
  if (loaded) return [];
  loaded = true;
  await ensureDir();
  try {
    const raw = await fs.readFile(JSONL_FILE, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const events: ProtestEvent[] = [];
    let maxTime = 0;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as ProtestEvent;
        events.push(ev);
        persistedIds.add(ev.id);
        const ts = new Date(ev.eventTime).getTime();
        if (ts > maxTime) maxTime = ts;
      } catch {
        // skip corrupt line
      }
    }
    if (maxTime > 0) lastUpdated = new Date(maxTime);
    console.log(`[store] loaded ${events.length} events from disk, lastUpdated=${lastUpdated?.toISOString() ?? "null"}`);
    return events;
  } catch {
    console.log("[store] no events.jsonl found, starting fresh");
    return [];
  }
}

/** Get the timestamp of the most recent persisted event, or null if empty. */
export function getLastUpdated(): Date | null {
  return lastUpdated;
}

// Track events per day (in memory) so we can rewrite daily MD files with
// landmark aggregation when new events arrive.
const dailyEventsMap = new Map<string, ProtestEvent[]>();

// Jakarta landmarks (matches monitoringPoints.ts kind === "landmark")
const JAKARTA_LANDMARKS = [
  { id: "mp_monas", name: "Monas (National Monument)", shortName: "Monas", significance: "National protest stage", lat: -6.1754, lon: 106.8272 },
  { id: "mp_dpr", name: "DPR/MPR Building", shortName: "DPR", significance: "Legislative protest target", lat: -6.2879, lon: 106.7976 },
  { id: "mp_istana", name: "Istana Merdeka", shortName: "Istana", significance: "Executive protest target", lat: -6.1702, lon: 106.8210 },
  { id: "mp_sudirman", name: "Bundaran HI / Sudirman", shortName: "Sudirman", significance: "CBD protest chokepoint", lat: -6.1944, lon: 106.8228 },
  { id: "mp_mahkamah", name: "Mahkamah Konstitusi", shortName: "MK", significance: "Judicial protest target", lat: -6.2096, lon: 106.8325 },
  { id: "mp_kpu", name: "KPU", shortName: "KPU", significance: "Electoral protest target", lat: -6.2115, lon: 106.8362 },
  { id: "mp_kontras", name: "Kontras HQ", shortName: "Kontras", significance: "Civil society hub", lat: -6.1879, lon: 106.8308 },
  { id: "mp_senayan", name: "Bundaran Senayan", shortName: "Senayan", significance: "March convergence point", lat: -6.2187, lon: 106.8019 },
] as const;

const EARTH_RADIUS_KM = 6371;
const PROXIMITY_LANDMARK_KM = 1.5;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function buildLandmarkSection(eventsForDay: ProtestEvent[]): string {
  const activeLandmarks: { name: string; shortName: string; significance: string; count: number; sample: string }[] = [];
  for (const lm of JAKARTA_LANDMARKS) {
    const nearby = eventsForDay.filter((e) => haversineKm(lm.lat, lm.lon, e.lat, e.lon) <= PROXIMITY_LANDMARK_KM);
    if (nearby.length > 0) {
      activeLandmarks.push({
        name: lm.name,
        shortName: lm.shortName,
        significance: lm.significance,
        count: nearby.length,
        sample: nearby[0].title.slice(0, 60),
      });
    }
  }
  if (activeLandmarks.length === 0) {
    return "## Landmarks Active Today\n\nNo Jakarta landmarks active today.\n\n";
  }
  let out = "## Landmarks Active Today\n\n| Landmark | Significance | Events | Sample Headline |\n|----------|-------------|--------|-----------------|\n";
  for (const lm of activeLandmarks) {
    out += `| ${lm.name} | ${lm.significance} | ${lm.count} | ${lm.sample.replace(/\|/g, "\\|")} |\n`;
  }
  out += "\n";
  return out;
}

async function writeDailyFile(ev: ProtestEvent): Promise<void> {
  const dailyDate = fmtDailyDate(ev.eventTime);
  const fileKey = `${dailyDate}|${ev.id}`;
  if (dailyWrittenIds.has(fileKey)) return;
  dailyWrittenIds.add(fileKey);

  // Track events for this day
  if (!dailyEventsMap.has(dailyDate)) dailyEventsMap.set(dailyDate, []);
  const dayEvents = dailyEventsMap.get(dailyDate)!;
  if (!dayEvents.find((e) => e.id === ev.id)) dayEvents.push(ev);
  // Sort by eventTime ascending
  dayEvents.sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

  const dailyPath = path.join(DAILY_DIR, `${dailyDate}.md`);
  const title = `# Spectre — ${fmtDailyDisplay(ev.eventTime)}\n\n`;
  const landmarkSection = buildLandmarkSection(dayEvents);
  const eventTableHeader = "## All Events\n\n| Time WIB | Type | Location | Title | Sources |\n|----------|------|----------|-------|---------|\n";
  const eventRows = dayEvents.map(formatMdRow).join("\n") + "\n";

  // Rewrite the full file each time (so landmark section stays fresh)
  const fullContent = title + landmarkSection + eventTableHeader + eventRows;
  await fs.writeFile(dailyPath, fullContent, "utf8");
}

/** Append new events to the JSONL file. Skips events already persisted. */
export async function appendToDisk(events: ProtestEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  await ensureDir();
  const newOnes: ProtestEvent[] = [];
  for (const ev of events) {
    if (persistedIds.has(ev.id)) continue;
    persistedIds.add(ev.id);
    newOnes.push(ev);
    const ts = new Date(ev.eventTime).getTime();
    if (!lastUpdated || ts > lastUpdated.getTime()) {
      lastUpdated = new Date(ts);
    }
  }
  if (newOnes.length === 0) return 0;

  const jsonlLines = newOnes.map((ev) => JSON.stringify(ev)).join("\n") + "\n";
  await fs.appendFile(JSONL_FILE, jsonlLines, "utf8");

  // Also append to per-day markdown files
  const mdLines = newOnes.map(formatMdRow).join("\n") + "\n";
  const mdHeader = `# Spectre Event Log\n\n| Date | Type | Location | Title | Sources |\n|------|------|----------|-------|---------|\n`;
  try {
    await fs.access(MD_FILE);
  } catch {
    await fs.writeFile(MD_FILE, mdHeader, "utf8");
  }
  await fs.appendFile(MD_FILE, mdLines, "utf8");

  // Write per-day files (one per day in Asia/Jakarta timezone)
  await Promise.all(newOnes.map(writeDailyFile));

  console.log(`[store] persisted ${newOnes.length} new events to disk (total file: ${persistedIds.size})`);
  return newOnes.length;
}

