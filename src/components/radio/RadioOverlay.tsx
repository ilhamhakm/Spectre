"use client";

import { useEffect, useRef } from "react";
import { useGlobeStore } from "@/store/globe-store";
import { useRadioStore } from "@/globe/radio/radio-store";
import { filterRadioStations } from "@/globe/radio/radio-categories";
import { selectAndPlayStation } from "@/globe/radio/radio-engine";

// Radio canvas overlay: draws infra-style tag cards for radio stations on the
// globe, same chrome as LocalInfrastructureOverlay (black-background rounded
// rects with a vertical leader line and a category-colored accent bar). The
// cohort is capped and grid-deduplicated so the globe stays readable.

const STYLE = Object.freeze({
  background: "rgba(4, 12, 16, 0.82)",
  border: "rgba(190, 232, 242, 0.18)",
  title: "rgba(232, 240, 244, 0.96)",
  subtitle: "rgba(147, 213, 228, 0.58)",
  leader: "rgba(147, 213, 228, 0.58)",
  fontLabel: '500 10px "JetBrains Mono", monospace',
  fontSub: '400 8px "JetBrains Mono", monospace',
  radius: 4,
});

const SOURCE_NAME = "Radio stations";
const COHORT_LIMIT = 120;
const GRID_PX = 128;
const GAP_PX = 15;
const VIEWPORT_MARGIN = 4;

interface RadioEntry {
  id: string;
  position: unknown; // Cesium.Cartesian3
  title: string;
  country: string;
  accent: string;
  priority: number;
  entity: unknown; // Cesium.Entity
}

interface HitRect {
  id: string;
  title: string;
  position: unknown;
  entity: unknown;
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
  ctx.strokeStyle = STYLE.leader;
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
  entry: RadioEntry,
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
  ctx.fillStyle = STYLE.subtitle;
  ctx.font = STYLE.fontSub;
  ctx.fillText(entry.country, placement.x + 6, placement.y + 16);
  ctx.restore();
}

function measureLabel(ctx: CanvasRenderingContext2D, title: string, country: string): {
  w: number;
  h: number;
} {
  ctx.font = STYLE.fontLabel;
  const titleW = ctx.measureText(title).width;
  ctx.font = STYLE.fontSub;
  const subW = ctx.measureText(country).width;
  const padX = 6;
  const padY = 4;
  return {
    w: Math.ceil(Math.max(titleW, subW)) + padX * 2,
    h: padY * 2 + 11 + 10,
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
    leadFromX: anchorX,
    leadFromY: anchorY,
    leadToX: anchorX,
    leadToY: y + h,
  };
}

function selectCohort(
  entries: RadioEntry[],
  cap: number,
  gridPx: number,
  vw: number,
  vh: number,
  project: (e: RadioEntry) => { x: number; y: number } | undefined,
): RadioEntry[] {
  if (entries.length === 0 || cap === 0) return [];
  const compare = (a: RadioEntry, b: RadioEntry): number =>
    b.priority - a.priority || a.id.localeCompare(b.id);
  const cells = new Map<string, RadioEntry[]>();
  const padding = gridPx;
  for (const entry of entries) {
    const screen = project(entry);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
    if (screen.x < -padding || screen.x > vw + padding
      || screen.y < -padding || screen.y > vh + padding) continue;
    const key = `${Math.floor(screen.x / gridPx)}:${Math.floor(screen.y / gridPx)}`;
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
  const primary: RadioEntry[] = [];
  const surplus: RadioEntry[] = [];
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

export default function RadioOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const radioOn = useGlobeStore((s) => s.layerVisibility.radio);

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
        const stationId = String(r.id).replace(/^radio:/, "");
        void selectAndPlayStation(stationId, { focus: true, autoplay: true });
      });
      divPool.push(div);
      return div;
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

      // Find the radio data source.
      const dataSources = viewer.dataSources;
      let source: any = null;
      for (let i = 0; i < dataSources.length; i++) {
        const ds = dataSources.get(i);
        if (ds && ds.name === SOURCE_NAME && ds.show) {
          source = ds;
          break;
        }
      }

      if (!source) {
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

      const project = (entry: RadioEntry): { x: number; y: number } | undefined => {
        const wp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, entry.position);
        return wp ? { x: wp.x, y: wp.y } : undefined;
      };

      // Apply the active category filter from the store.
      const filter = useRadioStore.getState().filter;
      const allStations = useRadioStore.getState().stations;
      const visibleIds = new Set(
        filterRadioStations(allStations, filter).map((s) => s.id),
      );

      const entries: RadioEntry[] = [];
      const entities = source.entities.values;
      for (const entity of entities) {
        if (!entity.show) continue;
        const stationId = String(
          (entity.properties as any)?.stationId?.getValue(now) ?? "",
        );
        if (stationId && !visibleIds.has(stationId)) continue;
        const pos = entity.position?.getValue(now);
        if (!pos) continue;
        if (!occluder.isPointVisible(pos)) continue;
        const title = (entity as any).__labelText ?? "";
        if (!title) continue;
        const priority = (entity as any).__priority ?? 0;
        const accent = (entity as any).__radioColor ?? "#ffffff";
        const country = (entity as any).__radioCountry ?? "";
        entries.push({
          id: String(entity.id ?? stationId),
          position: pos,
          title,
          country,
          accent,
          priority,
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

      const cohort = selectCohort(entries, COHORT_LIMIT, GRID_PX, cw, ch, project);

      let count = 0;
      for (const entry of cohort) {
        const screen = project(entry);
        if (!screen) continue;
        const { w, h } = measureLabel(ctx, entry.title, entry.country);
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
  }, [radioOn]);

  if (!radioOn) return null;

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
