"use client";

import { useEffect, useRef } from "react";
import { useGlobeStore } from "@/store/globe-store";
import { selectCamera, clearSelection, getCctvCameraById } from "@/globe/layers/cctv";
import type { CctvCamera } from "@/lib/sources/cctv";

// CCTV canvas overlay: draws camera tags the same way EarthquakeOverlay
// does - black-background rounded rects with near-white text, a vertical
// leader line from the ground anchor to the card, and an accent bar on
// the left. Clicking a tag selects the camera (flies to it, shows 3D
// model + pyramid POV, opens CctvDetailPanel).

const STYLE = Object.freeze({
  background: "rgba(4, 12, 16, 0.82)",
  border: "rgba(190, 232, 242, 0.18)",
  title: "rgba(232, 240, 244, 0.96)",
  fontLabel: '500 10px "JetBrains Mono", monospace',
  radius: 4,
});

const COHORT_LIMIT: number = 200;
const GRID_PX = 100;
const GAP_PX = 15;
const VIEWPORT_MARGIN = 4;

const ACCENT = "#00d4ff";
const ACCENT_DIM = "#5ab3d4";

interface CctvEntry {
  id: string;
  position: any;
  title: string;
  accent: string;
  priority: number;
  cam: CctvCamera;
  entity: any;
}

interface HitRect {
  id: string;
  title: string;
  position: any;
  cam: CctvCamera;
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
  // Leader line (vertical, from anchor to card bottom).
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(placement.leadFromX, placement.leadFromY);
  ctx.lineTo(placement.leadToX, placement.leadToY);
  ctx.stroke();
  // Background.
  roundedRectPath(ctx, x, y, w, h, STYLE.radius);
  ctx.fillStyle = STYLE.background;
  ctx.fill();
  // Border.
  ctx.strokeStyle = STYLE.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Accent bar (left side, 2px wide).
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + 3, 2, Math.max(1, h - 6));
}

function paintLabel(
  ctx: CanvasRenderingContext2D,
  entry: CctvEntry,
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
  entries: CctvEntry[],
  vw: number,
  vh: number,
  project: (e: CctvEntry) => { x: number; y: number } | undefined,
): CctvEntry[] {
  const cap = COHORT_LIMIT;
  if (entries.length === 0 || cap === 0) return [];
  const compare = (a: CctvEntry, b: CctvEntry): number =>
    b.priority - a.priority || a.id.localeCompare(b.id);
  const cells = new Map<string, CctvEntry[]>();
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
  const primary: CctvEntry[] = [];
  const surplus: CctvEntry[] = [];
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

export default function CctvOverlay() {
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
      selectCamera(r.cam);
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

      // Resize to viewport.
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

      // Only draw when the CCTV layer is active.
      const cctvVisible = useGlobeStore.getState().layerVisibility.cctv ?? false;
      if (!cctvVisible) {
        for (const div of activeDivs) div.style.display = "none";
        activeDivs.length = 0;
        activeRects.length = 0;
        rafId = requestAnimationFrame(update);
        return;
      }

      // Find the cctv CustomDataSource.
      const dataSources = viewer.dataSources;
      let cctvSource: any = null;
      for (let i = 0; i < dataSources.length; i++) {
        const ds = dataSources.get(i);
        if (ds && ds.name === "cctv" && ds.show) {
          cctvSource = ds;
          break;
        }
      }

      if (!cctvSource) {
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

      // Horizon cull.
      const occluder = new Cesium.EllipsoidalOccluder(
        Cesium.Ellipsoid.WGS84,
        cameraPos,
      );

      // Build entries from entities.
      const entries: CctvEntry[] = [];
      const entities = cctvSource.entities.values;
      for (const entity of entities) {
        const pos = entity.position?.getValue(now);
        if (!pos) continue;
        if (!occluder.isPointVisible(pos)) continue;
        const bag = entity.properties;
        const camId = bag?.camId?.getValue(now) ?? "";
        const name = bag?.name?.getValue(now) ?? "";
        const isSensitive = bag?.isSensitive?.getValue(now) ?? false;
        const cam = getCctvCameraById(camId);
        if (!cam) continue;
        // Truncate long names for the tag.
        const title = name.length > 24 ? name.slice(0, 22) + ".." : name;
        entries.push({
          id: camId,
          position: pos,
          title,
          accent: isSensitive ? ACCENT_DIM : ACCENT,
          priority: cam.snapshotUrl || cam.streamUrl ? 1000 : 0,
          cam,
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

      // Project to screen and run cohort selection.
      const project = (entry: CctvEntry): { x: number; y: number } | undefined => {
        const wp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, entry.position);
        return wp ? { x: wp.x, y: wp.y } : undefined;
      };

      const cohort = selectCohort(entries, cw, ch, project);

      // Paint each cohort entry and position hit divs.
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
          cam: entry.cam,
          x: placement.x,
          y: placement.y,
          w: placement.w,
          h: placement.h,
        };
        count++;
      }

      // Hide any excess divs from the previous frame.
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
