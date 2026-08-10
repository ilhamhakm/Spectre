import * as Cesium from "cesium";
import type { EventType } from "@/lib/types";
import type { VerificationLevel } from "@/lib/types";

// Event type → Cesium.Color mapping. Used by events-layer.ts for point
// primitives and by HoverPopup.tsx (which has its own CSS-string copy).
export const EVENT_COLOR: Record<EventType, Cesium.Color> = {
  protest: Cesium.Color.fromBytes(255, 59, 48, 255),
  riot: Cesium.Color.fromBytes(255, 59, 48, 255),
  arrest: Cesium.Color.fromBytes(255, 149, 0, 255),
  shutdown: Cesium.Color.fromBytes(191, 64, 255, 255),
  fire: Cesium.Color.fromBytes(255, 107, 0, 255),
  earthquake: Cesium.Color.fromBytes(255, 215, 0, 255),
  other: Cesium.Color.fromBytes(0, 212, 255, 255),
};

// Verification-level color (Cesium form, for any future globe-side use).
// HoverPopup.tsx keeps its own CSS-string copy for HTML rendering.
export const VERIFICATION_COLOR: Record<VerificationLevel, Cesium.Color> = {
  confirmed: Cesium.Color.fromBytes(57, 255, 20, 255),
  multi: Cesium.Color.fromBytes(255, 149, 0, 255),
  unconfirmed: Cesium.Color.fromBytes(255, 59, 48, 255),
};

// Selection / active-highlight colors shared across layers.
export const SELECTED_COLOR = Cesium.Color.fromBytes(255, 210, 90, 255);
export const ACTIVE_COLOR = Cesium.Color.fromBytes(255, 59, 48, 255);
