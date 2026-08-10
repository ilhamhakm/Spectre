// GET /api/events/[id] - single event detail with full sources + related events.
// Build Agent B owns this. Reuses the eventsStore from the list route.
//
// Response: { event, sources, related }
//   - event: full ProtestEvent including embedded sources array
//   - sources: top-level sources array (mirrors architecture 6.1 shape)
//   - related: events in same province within +/-7 days (max 10)
//
// If the event id is unknown, returns 404. The store is populated by the list
// route, so clients must hit /api/events first (the normal flow).

import { NextResponse, type NextRequest } from "next/server";
import {
  findEventById,
  allKnownEvents,
  type EventDetailApiResponse,
} from "@/lib/eventsStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const RELATED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // +/- 7 days
const RELATED_MAX = 10;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const event = findEventById(id);
  if (!event) {
    return NextResponse.json(
      { error: "not_found", id },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const evTs = Date.parse(event.eventTime);
  const province = (event.province ?? event.locationName ?? "").toLowerCase();

  const related = allKnownEvents()
    .filter((other) => other.id !== event.id)
    .filter((other) => {
      const otherProv = (
        other.province ?? other.locationName ?? ""
      ).toLowerCase();
      if (!province || otherProv !== province) return false;
      const otherTs = Date.parse(other.eventTime);
      if (Number.isNaN(otherTs) || Number.isNaN(evTs)) return false;
      return Math.abs(otherTs - evTs) <= RELATED_WINDOW_MS;
    })
    .sort((a, b) => {
      const aTs = Date.parse(a.eventTime);
      const bTs = Date.parse(b.eventTime);
      const aDiff = Math.abs(aTs - evTs);
      const bDiff = Math.abs(bTs - evTs);
      return aDiff - bDiff;
    })
    .slice(0, RELATED_MAX);

  const body: EventDetailApiResponse = {
    event,
    sources: event.sources,
    related,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
