"use client";

import { useEffect, useRef } from "react";
import { useGlobeStore } from "@/store/globe-store";

// Civil unrest canvas overlay: draws event labels the same way
// EarthquakeOverlay and LocalInfrastructureOverlay do - black-background
// rounded rects with near-white text and a vertical leader line from the
// ground anchor to the card. Reads entities from the "civil-unrest"
// CustomDataSource, using __labelText / __priority / __unrestType metadata
// set by the civilUnrestLayer.

// --- GEV WORLD_OVERLAY_STYLE tokens (same as EarthquakeOverlay) ---
const STYLE = Object.freeze({
  background: "rgba(4, 12, 16, 0.82)",
  border: "rgba(190, 232, 242, 0.18)",
  title: "rgba(232, 240, 244, 0.96)",
  leader: "rgba(147, 213, 228, 0.58)",
  fontLabel: '500 10px "JetBrains Mono", monospace',
  radius: 4,
});

const COHORT_LIMIT: number = 120;
const GRID_PX = 128;
const GAP_PX = 15;
const VIEWPORT_MARGIN = 4;

// Accent by event type (matches the layer's UNREST_TYPE_COLOR).
const TYPE_ACCENT: Record<string, string> = {
  riot: "#ff4d4d",
  shutdown: "#ff7a3d",
  arrest: "#ffdd44",
  protest: "#ffaa33",
  other: "#ffaa33",
};

interface UnrestEntry {
  id: string;
  position: any; // Cesium.Cartesian3
  title: string;
  accent: string;
  priority: number;
  type: string;
  entity: any; // Cesium.Entity
}

interface HitRect {
  id: string;
  title: string;
  position: any;
  type: string;
  entity: any;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
  leadFromX: number;
  leadFromY: number;
  leadToX: number;
  leadToY: number;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCardChrome(
  ctx: CanvasRenderingContext2D,
  placement: Placement,
  accent: string,
): void {
  const { x, y, w, h } = placement;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(placement.leadFromX, placement.leadFromY);
  ctx.lineTo(placement.leadToX, placement.leadToY);
  ctx.stroke();
  roundedRectPath(ctx, x, y, w, h, STYLE.radius);
  ctx.fillStyle = STYLE.background;
  ctx.fill();
  ctx.strokeStyle = STYLE.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + 3, 2, Math.max(1, h - 6));
}

function paintLabel(
  ctx: CanvasRenderingContext2D,
  entry: UnrestEntry,
  placement: Placement,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawCardChrome(ctx, placement, entry.accent);
  ctx.fillStyle = STYLE.title;
  ctx.font = STYLE.fontLabel;
  ctx.textBaseline = "top";
  ctx.fillText(entry.title, placement.x + 6, placement.y + 4);
  ctx.restore();
}

function measureLabel(ctx: CanvasRenderingContext2D, title: string): {
  w: number;
  h: number;
} {
  ctx.font = STYLE.fontLabel;
  const width = ctx.measureText(title).width;
  const padX = 6;
  const padY = 4;
  const titleH = 11;
  return {
    w: Math.ceil(width) + padX * 2,
    h: padY * 2 + titleH,
  };
}

function placeAbove(
  anchorX: number,
  anchorY: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): Placement {
  let x = anchorX - w / 2;
  let y = anchorY - GAP_PX - h;
  x = Math.max(VIEWPORT_MARGIN, Math.min(x, Math.max(VIEWPORT_MARGIN, vw - w - VIEWPORT_MARGIN)));
  y = Math.max(VIEWPORT_MARGIN, Math.min(y, Math.max(VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN)));
  return {
    x: Math.round(x),
    y: Math.round(y),
    w,
    h,
    anchorX,
    anchorY,
    leadFromX: anchorX,
    leadFromY: anchorY,
    leadToX: anchorX,
    leadToY: y + h,
  };
}

function selectCohort(
  entries: UnrestEntry[],
  vw: number,
  vh: number,
  project: (e: UnrestEntry) => { x: number; y: number } | undefined,
): UnrestEntry[] {
  const cap = COHORT_LIMIT;
  if (entries.length === 0 || cap === 0) return [];
  const compare = (a: UnrestEntry, b: UnrestEntry): number =>
    b.priority - a.priority || a.id.localeCompare(b.id);
  const cells = new Map<string, UnrestEntry[]>();
  const padding = GRID_PX;
  for (const entry of entries) {
    const screen = project(entry);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
    if (screen.x < -padding || screen.x > vw + padding
      || screen.y < -padding || screen.y > vh + padding) continue;
    const key = `${Math.floor(screen.x / GRID_PX)}:${Math.floor(screen.y / GRID_PX)}`;
    let contenders = cells.get(key);
    if (!contenders) {
      contenders = [];
      cells.set(key, contenders);
    }
    let index = 0;
    while (index < contenders.length && compare(contenders[index], entry) <= 0) index++;
    contenders.splice(index, 0, entry);
    if (contenders.length > 2) contenders.length = 2;
  }
  const primary: UnrestEntry[] = [];
  const surplus: UnrestEntry[] = [];
  for (const contenders of cells.values()) {
    if (contenders[0]) primary.push(contenders[0]);
    if (contenders[1]) surplus.push(contenders[1]);
  }
  primary.sort(compare);
  surplus.sort(compare);
  const winners = primary.slice(0, cap);
  if (winners.length < cap) winners.push(...surplus.slice(0, cap - winners.length));
  return winners;
}

export default function CivilUnrestOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let rafId = 0;

    const divPool: HTMLDivElement[] = [];
    const activeDivs: HTMLDivElement[] = [];
    const activeRects: HitRect[] = [];

    const getDiv = (i: number): HTMLDivElement => {
      if (i < divPool.length) return divPool[i];
      const div = document.createElement("div");
      div.style.position = "absolute";
      div.style.cursor = "pointer";
      div.style.pointerEvents = "auto";
      div.style.zIndex = "51";
      div.addEventListener("click", () => {
        const r = activeRects[i];
        if (!r) return;
        handleLabelClick(r);
      });
      divPool.push(div);
      return div;
    };

    const handleLabelClick = (r: HitRect) => {
      const viewer = (window as any).__viewer;
      const CesiumMod = (window as any).__Cesium;
      if (!viewer || !CesiumMod || viewer.isDestroyed()) return;
      const carto = CesiumMod.Cartographic.fromCartesian(r.position);
      const lat = CesiumMod.Math.toDegrees(carto.latitude);
      const lon = CesiumMod.Math.toDegrees(carto.longitude);
      // Read full entity properties for the detail panel.
      const now = CesiumMod.JulianDate.now();
      const bag = r.entity?.properties;
      const data: Record<string, unknown> = { lat, lon };
      if (bag && typeof bag.getValue === "function") {
        const raw = bag.getValue(now);
        if (raw) {
          for (const [k, v] of Object.entries(raw)) {
            data[k] = v && typeof (v as any).getValue === "function"
              ? (v as any).getValue(now)
              : v;
          }
        }
      }
      useGlobeStore.getState().trackFeature({
        kind: "unrest",
        id: r.id.replace(/^unrest:/, ""),
        name: r.title,
        lat, lon,
        data,
      });
      viewer.scene.screenSpaceCameraController.enableInputs = false;
      viewer.camera.flyTo({
        destination: CesiumMod.Cartesian3.fromDegrees(lon, lat, 5_000),
        duration: 1.5,
        complete: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
        cancel: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
      });
    };

    const update = () => {
      const viewer = (window as unknown as { __viewer?: any }).__viewer;
      const Cesium = (window as unknown as { __Cesium?: any }).__Cesium;
      if (!canvas || !viewer || viewer.isDestroyed() || !Cesium) {
        rafId = requestAnimationFrame(update);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(update);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const cw = window.innerWidth;
      const ch = window.innerHeight;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      // Only draw when the civil-unrest layer is active.
      const dataSources = viewer.dataSources;
      let unrestSource: any = null;
      for (let i = 0; i < dataSources.length; i++) {
        const ds = dataSources.get(i);
        if (ds && ds.name === "civil-unrest" && ds.show) {
          unrestSource = ds;
          break;
        }
      }

      if (!unrestSource) {
        for (const div of activeDivs) div.style.display = "none";
        activeDivs.length = 0;
        activeRects.length = 0;
        rafId = requestAnimationFrame(update);
        return;
      }

      const now = Cesium.JulianDate.now();
      const cameraPos = viewer.camera.positionWC;
      if (!cameraPos) {
        rafId = requestAnimationFrame(update);
        return;
      }

      const occluder = new Cesium.EllipsoidalOccluder(
        Cesium.Ellipsoid.WGS84,
        cameraPos,
      );

      const entries: UnrestEntry[] = [];
      const entities = unrestSource.entities.values;
      for (const entity of entities) {
        if (!entity.show) continue;
        const pos = entity.position?.getValue(now);
        if (!pos) continue;
        if (!occluder.isPointVisible(pos)) continue;
        const title = (entity as any).__labelText ?? "";
        if (!title) continue;
        const priority = (entity as any).__priority ?? 0;
        const type = (entity as any).__unrestType ?? "other";
        entries.push({
          id: String(entity.id ?? ""),
          position: pos,
          title,
          accent: TYPE_ACCENT[type] ?? TYPE_ACCENT.other,
          priority,
          type,
          entity,
        });
      }

      if (entries.length === 0) {
        for (const div of activeDivs) div.style.display = "none";
        activeDivs.length = 0;
        activeRects.length = 0;
        rafId = requestAnimationFrame(update);
        return;
      }

      const project = (entry: UnrestEntry): { x: number; y: number } | undefined => {
        const wp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, entry.position);
        return wp ? { x: wp.x, y: wp.y } : undefined;
      };

      const cohort = selectCohort(entries, cw, ch, project);

      let count = 0;
      for (const entry of cohort) {
        const screen = project(entry);
        if (!screen) continue;
        const { w, h } = measureLabel(ctx, entry.title);
        const placement = placeAbove(screen.x, screen.y, w, h, cw, ch);
        paintLabel(ctx, entry, placement, 1);

        const div = getDiv(count);
        div.style.left = `${placement.x}px`;
        div.style.top = `${placement.y}px`;
        div.style.width = `${placement.w}px`;
        div.style.height = `${placement.h}px`;
        div.style.display = "block";
        if (!div.parentElement) container.appendChild(div);
        activeDivs[count] = div;
        activeRects[count] = {
          id: entry.id,
          title: entry.title,
          position: entry.position,
          type: entry.type,
          entity: entry.entity,
          x: placement.x,
          y: placement.y,
          w: placement.w,
          h: placement.h,
        };
        count++;
      }

      for (let i = count; i < activeDivs.length; i++) {
        activeDivs[i].style.display = "none";
      }
      activeDivs.length = count;
      activeRects.length = count;

      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(rafId);
      for (const div of divPool) {
        if (div.parentElement) div.parentElement.removeChild(div);
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 50 }}>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
