// GET /api/events/stream - Server-Sent Events endpoint.
// Build Agent B owns this. v0 stub per architecture 6.2 + 8.
//
// Emits:
//   event: heartbeat     data: {"ts": <unix_seconds>}
//     - every 30s, keeps the connection alive
//   event: new_event     data: { ...ProtestEvent }
//     - fired when eventsStore.upsertEvents sees a new event
//   event: source_status data: {"source":..,"status":..,"message":..}
//     - reserved for Phase 2 (circuit breaker state changes)
//
// Phase 2 will rewire the addEventListener subscription to Supabase Realtime
// (WAL subscription) so any server (CF Pages or Vercel) can serve any SSE client.

import type { ProtestEvent } from "@/lib/types";
import { addEventListener } from "@/lib/eventsStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 30_000;

function sseMessage(
  encoder: TextEncoder,
  event: string,
  data: unknown,
): Uint8Array {
  const payload =
    typeof data === "string" ? data : JSON.stringify(data);
  return encoder.encode(`event: ${event}\ndata: ${payload}\n\n`);
}

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  // Use a single object so cleanup is type-safe under strict mode.
  const state: {
    interval: ReturnType<typeof setInterval> | null;
    unsubscribe: (() => void) | null;
    closed: boolean;
  } = {
    interval: null,
    unsubscribe: null,
    closed: false,
  };

  function cleanup(): void {
    if (state.closed) return;
    state.closed = true;
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial heartbeat so the client knows the stream is alive immediately.
      try {
        controller.enqueue(
          sseMessage(encoder, "heartbeat", {
            ts: Math.floor(Date.now() / 1000),
          }),
        );
      } catch {
        cleanup();
        return;
      }

      // Fan out new events from the store.
      state.unsubscribe = addEventListener((event: ProtestEvent) => {
        if (state.closed) return;
        try {
          controller.enqueue(sseMessage(encoder, "new_event", event));
        } catch {
          // Controller closed (client disconnected) - clean up.
          cleanup();
        }
      });

      // Heartbeat every 30s.
      state.interval = setInterval(() => {
        if (state.closed) return;
        try {
          controller.enqueue(
            sseMessage(encoder, "heartbeat", {
              ts: Math.floor(Date.now() / 1000),
            }),
          );
        } catch {
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      // Called by the runtime when the client disconnects.
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (nginx)
    },
  });
}
