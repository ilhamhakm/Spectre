import { NextResponse } from "next/server";
import { setCctvCorrection } from "@/lib/sources/cctv";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/cctv/correct — save a user-submitted position/heading correction
// for a camera. Updates the in-memory corrections map AND writes to
// cctv-corrections.json so the correction persists across restarts.
//
// Body: { id: string, lat?: number, lon?: number, headingDeg?: number }

const CORRECTIONS_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "sources",
  "cctv-corrections.json",
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, lat, lon, headingDeg } = body as {
      id?: string;
      lat?: number;
      lon?: number;
      headingDeg?: number;
    };

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }

    const correction: Record<string, number> = {};
    if (typeof lat === "number" && Number.isFinite(lat)) correction.lat = lat;
    if (typeof lon === "number" && Number.isFinite(lon)) correction.lon = lon;
    if (typeof headingDeg === "number" && Number.isFinite(headingDeg)) {
      correction.headingDeg = ((headingDeg % 360) + 360) % 360;
    }

    if (Object.keys(correction).length === 0) {
      return NextResponse.json({ error: "no valid fields" }, { status: 400 });
    }

    // Update in-memory map (takes effect immediately on next catalog fetch).
    setCctvCorrection(id, correction);

    // Persist to JSON file. Read current file, merge, write back.
    let existing: Record<string, Record<string, number>> = {};
    try {
      const raw = fs.readFileSync(CORRECTIONS_PATH, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // file may not exist yet
    }
    existing[id] = { ...existing[id], ...correction };
    fs.writeFileSync(CORRECTIONS_PATH, JSON.stringify(existing, null, 2) + "\n", "utf-8");

    return NextResponse.json({ ok: true, id, correction: existing[id] });
  } catch (err) {
    return NextResponse.json(
      { error: `failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
