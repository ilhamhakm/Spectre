import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertEvents } from "../../../lib/eventsStore";
import { fuzzCoordsForProvince, getExpiryHours, shouldForceAnonymous } from "../../../lib/geoFuzz";
import { listProvinces } from "../../../lib/provincePolicies";
import type { ProtestEvent, EventSource } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ReportSchema = z.object({
  content: z.string().min(1).max(2000),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  province: z.enum(listProvinces() as unknown as [string, ...string[]]).optional(),
  photoDataUrl: z.string().optional(),
});

const RATE_LIMIT_WINDOW_HOURS = 1;
const RATE_LIMIT_MAX_REQUESTS = 5;
const rateLimits = new Map<string, { count: number; windowStart: number }>();

function hashIp(ip: string | null, date: string): string {
  const raw = `${ip ?? "anon"}|${date}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `rl_${Math.abs(hash).toString(16)}`;
}

function checkRateLimit(ipHash: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;
  const existing = rateLimits.get(ipHash);
  if (!existing || now - existing.windowStart > windowMs) {
    rateLimits.set(ipHash, { count: 1, windowStart: now });
    return { allowed: true, retryAfter: 0 };
  }
  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((existing.windowStart + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }
  existing.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function stripPhotoMetadata(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return dataUrl;
  const prefix = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  return `${prefix},${body}`;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  const date = new Date().toISOString().slice(0, 10);
  const ipHash = hashIp(ip, date);

  const rateCheck = checkRateLimit(ipHash);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rateCheck.retryAfter },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { content, lat, lon, province, photoDataUrl } = parsed.data;
  const forceAnon = shouldForceAnonymous(province);
  const isAnonymous = forceAnon || true;

  let finalLat: number | undefined;
  let finalLon: number | undefined;
  if (typeof lat === "number" && typeof lon === "number") {
    const fuzzed = fuzzCoordsForProvince(lat, lon, province, isAnonymous);
    finalLat = fuzzed.lat;
    finalLon = fuzzed.lon;
  }

  const expiryHours = getExpiryHours(province);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000).toISOString();

  const source: EventSource = {
    id: `src_anon_${Date.now()}`,
    sourceType: "anonymous",
    sourceName: "Anonymous eyewitness",
    narrative: "civil_society",
    ingestedAt: now.toISOString(),
    archivedUrl: undefined,
    archivedAt: undefined,
  };

  const event: ProtestEvent = {
    id: `evt_anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "protest",
    title: content.slice(0, 100) + (content.length > 100 ? "..." : ""),
    description: content,
    lat: finalLat ?? -6.209,
    lon: finalLon ?? 106.845,
    province,
    eventTime: now.toISOString(),
    createdAt: now.toISOString(),
    confidence: 5,
    verificationLevel: "unconfirmed",
    verified: false,
    isAnonymous: true,
    expiresAt,
    sources: [source],
  };

  if (photoDataUrl) {
    const stripped = stripPhotoMetadata(photoDataUrl);
    source.sourceUrl = stripped.startsWith("data:")
      ? `data:image/jpeg;base64,${stripped.split(",")[1]?.slice(0, 50)}...`
      : undefined;
  }

  upsertEvents([event]);

  return NextResponse.json(
    { reportId: event.id, expiresAt },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
