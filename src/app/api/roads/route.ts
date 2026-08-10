import { NextResponse } from "next/server";
import { fetchRoads } from "@/lib/sources/overpass";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/roads?south=...&west=...&north=...&east=...&level=1|2|3
// level: 1=motorway+trunk, 2=+primary, 3=+secondary+tertiary (default 2)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const south = parseFloat(url.searchParams.get("south") ?? "");
  const west = parseFloat(url.searchParams.get("west") ?? "");
  const north = parseFloat(url.searchParams.get("north") ?? "");
  const east = parseFloat(url.searchParams.get("east") ?? "");
  if ([south, west, north, east].some((n) => Number.isNaN(n))) {
    return NextResponse.json(
      { error: "missing or invalid bbox", roads: [] },
      { status: 400 },
    );
  }
  const levelRaw = url.searchParams.get("level");
  const level = (levelRaw === "1" || levelRaw === "3") ? Number(levelRaw) as 1 | 2 | 3 : 2;
  const tertiary = url.searchParams.get("tertiary") === "1";

  try {
    const result = await fetchRoads({
      south, west, north, east,
      level,
      includeTertiary: tertiary,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "fetch failed", roads: [] },
      { status: 502 },
    );
  }
}
