"use client";

import { useEffect, useRef } from "react";
import type * as Cesium from "cesium";
import { useGlobeStore } from "@/store/globe-store";
import { satellitesGetBracketTargets } from "@/globe/layers/satellites";

// TargetingBracket: Canvas2D overlay that draws corner brackets around:
//   1. The tracked flight (if one is selected) - larger, white/red brackets
//   2. ALL visible private and military flights - smaller brackets
//   3. The tracked satellite - larger, gold brackets
//   4. Visible satellites when zoomed in close - small, dim gold brackets
//
// Uses SceneTransforms.worldToWindowCoordinates to project each target's
// position to screen coordinates, then draws L-shaped corner brackets.
// Targets that are off-screen or behind the globe are skipped.

const BRACKET_HALF_W = 30;
const BRACKET_HALF_H = 30;
const BRACKET_COLOR = "rgba(255, 255, 255, 0.7)";
const BRACKET_LINE_WIDTH = 2;

// Ambient brackets (private/military, not tracked) are smaller and dimmer.
const AMBIENT_HALF_W = 18;
const AMBIENT_HALF_H = 18;
const AMBIENT_COLOR_PRIVATE = "rgba(255, 255, 255, 0.35)";
const AMBIENT_COLOR_MILITARY = "rgba(255, 48, 48, 0.5)";
const AMBIENT_LINE_WIDTH = 1.5;

// Satellite brackets: white (user preference).
const SAT_BRACKET_COLOR = "rgba(255, 255, 255, 0.9)";
const SAT_AMBIENT_COLOR = "rgba(255, 255, 255, 0.35)";

function drawCornerBracket(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
) {
  const x0 = sx - halfW;
  const y0 = sy - halfH;
  const x1 = sx + halfW;
  const y1 = sy + halfH;
  const seg = Math.max(4, Math.floor(Math.min(halfW, halfH) * 0.55));

  ctx.beginPath();
  // top-left
  ctx.moveTo(x0, y0 + seg);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + seg, y0);
  // top-right
  ctx.moveTo(x1 - seg, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y0 + seg);
  // bottom-right
  ctx.moveTo(x1, y1 - seg);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - seg, y1);
  // bottom-left
  ctx.moveTo(x0 + seg, y1);
  ctx.lineTo(x0, y1);
  ctx.lineTo(x0, y1 - seg);
  ctx.stroke();
}

interface BracketTarget {
  icao24: string;
  position: Cesium.Cartesian3;
  category: string;
}

interface FlightsHandle {
  getBracketTargets?: () => BracketTarget[];
}

export default function TargetingBracket() {
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const selectedKind = useGlobeStore((s) => s.selectedKind);
  const trackedSatelliteId = useGlobeStore((s) => s.trackedSatelliteId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let rafId: number | null = null;
    let mounted = true;

    const update = () => {
      if (!mounted) return;
      const canvas = canvasRef.current;
      const viewer = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
      const CesiumMod = (window as unknown as { __Cesium?: typeof Cesium }).__Cesium;

      if (!canvas || !viewer || viewer.isDestroyed() || !CesiumMod) {
        rafId = requestAnimationFrame(update);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(update);
        return;
      }

      // Resize canvas to viewport if needed.
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }

      // Clear.
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const now = CesiumMod.JulianDate.now();

      // --- 1. Ambient brackets on all visible private + military flights ---
      const handle = (window as unknown as { __flightsHandle?: FlightsHandle }).__flightsHandle;
      const targets = handle?.getBracketTargets?.() ?? [];
      for (const target of targets) {
        // Skip the tracked flight (drawn below with larger brackets).
        if (target.icao24 === selectedFlightId) continue;
        const screenPos = CesiumMod.SceneTransforms.worldToWindowCoordinates(
          viewer.scene, target.position,
        );
        if (!screenPos || screenPos.x < 0 || screenPos.y < 0 ||
            screenPos.x > canvas.width || screenPos.y > canvas.height) continue;
        ctx.strokeStyle = target.category === "military"
          ? AMBIENT_COLOR_MILITARY
          : AMBIENT_COLOR_PRIVATE;
        ctx.lineWidth = AMBIENT_LINE_WIDTH;
        ctx.lineCap = "square";
        drawCornerBracket(ctx, screenPos.x, screenPos.y, AMBIENT_HALF_W, AMBIENT_HALF_H);
      }

      // --- 2. Tracked flight bracket (larger, brighter) ---
      if (selectedFlightId) {
        const trackedEntity = viewer.trackedEntity;
        if (trackedEntity && trackedEntity.position) {
          const pos = trackedEntity.position.getValue(now);
          if (pos) {
            const screenPos = CesiumMod.SceneTransforms.worldToWindowCoordinates(
              viewer.scene, pos,
            );
            if (screenPos && screenPos.x >= 0 && screenPos.y >= 0 &&
                screenPos.x <= canvas.width && screenPos.y <= canvas.height) {
              ctx.strokeStyle = selectedKind === "flight-mil"
                ? "rgba(255, 48, 48, 0.9)"
                : BRACKET_COLOR;
              ctx.lineWidth = BRACKET_LINE_WIDTH;
              ctx.lineCap = "square";
              drawCornerBracket(ctx, screenPos.x, screenPos.y, BRACKET_HALF_W, BRACKET_HALF_H);
            }
          }
        }
      }

      // --- 3. Ambient satellite brackets (small, dim gold, close camera only) ---
      const satTargets = satellitesGetBracketTargets();
      for (const target of satTargets) {
        const screenPos = CesiumMod.SceneTransforms.worldToWindowCoordinates(
          viewer.scene, target.position,
        );
        if (!screenPos || screenPos.x < 0 || screenPos.y < 0 ||
            screenPos.x > canvas.width || screenPos.y > canvas.height) continue;
        ctx.strokeStyle = SAT_AMBIENT_COLOR;
        ctx.lineWidth = AMBIENT_LINE_WIDTH;
        ctx.lineCap = "square";
        drawCornerBracket(ctx, screenPos.x, screenPos.y, AMBIENT_HALF_W, AMBIENT_HALF_H);
      }

      // --- 4. Tracked satellite bracket (larger, gold) ---
      if (trackedSatelliteId != null) {
        const trackedEntity = viewer.trackedEntity;
        if (trackedEntity && trackedEntity.position) {
          const pos = trackedEntity.position.getValue(now);
          if (pos) {
            const screenPos = CesiumMod.SceneTransforms.worldToWindowCoordinates(
              viewer.scene, pos,
            );
            if (screenPos && screenPos.x >= 0 && screenPos.y >= 0 &&
                screenPos.x <= canvas.width && screenPos.y <= canvas.height) {
              ctx.strokeStyle = SAT_BRACKET_COLOR;
              ctx.lineWidth = BRACKET_LINE_WIDTH;
              ctx.lineCap = "square";
              drawCornerBracket(ctx, screenPos.x, screenPos.y, BRACKET_HALF_W, BRACKET_HALF_H);
            }
          }
        }
      }

      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);

    return () => {
      mounted = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [selectedFlightId, selectedKind, trackedSatelliteId]);

  // Always render the canvas (even without a tracked flight) so ambient
  // brackets on private/military flights are always visible.
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  );
}
