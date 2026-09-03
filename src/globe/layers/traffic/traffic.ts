/**
 * Street Traffic: animated dots along OSM road polylines, colored by live
 * TomTom congestion when a server-side key is configured.
 *
 * Ported faithfully from GEV's src/data/traffic.js and adapted to Spectre V2's
 * `LayerImpl` interface (`enable` / `disable`). The layer is self-updating via
 * Cesium's `preRender` and `camera.changed` events: no external tick.
 *
 * Two modes (decided once per session via `/api/tomtom/status`):
 * - `sim` (keyless default): white dots at hardcoded per-road-class speeds.
 * - `live`: TomTom flow tiles matched onto Overpass roads; matched roads
 *    color/slow/densify by real congestion, closed roads spawn no dots,
 *    unmatched roads keep the simulated white.
 */

import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "../types";
import { governorHold, governorRelease } from "../../render-governor";
import { deriveFetchCenter, clampBoundsAroundCenter, type Bounds } from "./traffic-bounds";
import { fetchFlowForBounds, getFlowSessionStats, resetFlowTileCache } from "./flow-tiles";
import { matchFlowToRoads, type Road, type FlowMatch } from "./flow-match";
import { flowBucket, flowSpeedScale, flowDensityMult, type FlowBucket } from "./traffic-flow-style";
import {
  trafficStyleProfile,
  presetDotRgba,
  presetSizeDelta,
  presetDotOutline,
  trafficBucketTier,
} from "./traffic-preset-style";
import { queuePlatoons, locateAlongRoad } from "./traffic-queue";

/** Proxy endpoint for Overpass API queries. */
const OVERPASS_URL = "/api/overpass";
/** Meters - hide all traffic dots above this camera altitude. */
const ACTIVATION_ALTITUDE = 8000;
/** Meters - above this altitude, only major roads are fetched. */
const FAST_FETCH_ALTITUDE = 4500;
/** Ms - debounce delay before fetching after camera settles. */
const FETCH_DEBOUNCE = 320;
/** Meters - vertical offset to keep dots above clamped terrain surface. */
const DOT_HEIGHT_OFFSET = 3.0;
/** Fraction (0-1) - skip re-fetch when viewport overlap exceeds this. */
const OVERLAP_THRESHOLD = 0.6;
/** Hard cap on total rendered dot primitives for GPU/CPU performance. */
const MAX_DOTS = 6000;
/** Polylines longer than this are simplified by sub-sampling. */
const MAX_WAYPOINTS_PER_ROAD = 80;
/** Km - minimum viewport center shift before allowing refresh. */
const MIN_CENTER_SHIFT_KM = 0.35;
/** Km - max distance the fetch center may sit from the camera nadir. */
const MAX_LOOKAT_PULL_KM = 12;

const SPEED_MPS: Record<string, number> = {
  motorway: 25,
  trunk: 20,
  primary: 14,
  secondary: 11,
  tertiary: 8,
  residential: 5,
  unclassified: 5,
};

const DENSITY_MULT: Record<string, number> = {
  motorway: 3.0,
  trunk: 2.5,
  primary: 2.0,
  secondary: 1.5,
  tertiary: 1.0,
  residential: 0.5,
  unclassified: 0.4,
};

const SIZE_BY_TYPE: Record<string, number> = {
  motorway: 6,
  trunk: 6,
  primary: 5,
  secondary: 5,
  tertiary: 4,
  residential: 4,
  unclassified: 4,
};

const FLOW_BUCKET_COLORS: Record<string, Cesium.Color> = {
  free: Cesium.Color.fromCssColorString("#2ecc71").withAlpha(0.9),
  slow: Cesium.Color.fromCssColorString("#f0b23e").withAlpha(0.9),
  jam: Cesium.Color.fromCssColorString("#e05252").withAlpha(0.9),
};

// Jam-viz prototype (live mode only)
const HEAT_LINE_CAP = 400;
const HEAT_LINE_JAM_WIDTH = 9;
const HEAT_LINE_SLOW_WIDTH = 4;
const HEAT_JAM_BASE_ALPHA = 0.55;
const HEAT_JAM_PULSE_ALPHA = 0.2;
const HEAT_JAM_COLOR = Cesium.Color.fromCssColorString("#e05252");
const HEAT_SLOW_COLOR = Cesium.Color.fromCssColorString("#f0b23e").withAlpha(0.2);
const JAM_DOT_DEPTH_PUNCH = 15000;
const JAM_DOT_FAR_SCALE = 0.55;
const CREEP_BURST = 2.2;
const CREEP_MOVE_MS = [1200, 3000];
const CREEP_STOP_MS = [1500, 5000];
const STYLED_MIN_BASE_PX = 5;

const FLOW_RENDER_RACE_MS = 250;
const TILE_CACHE_MAX_ENTRIES = 64;

interface TrafficRoad extends Road {
  oneway: number;
  waypoints: Cesium.Cartesian3[];
  segmentDist: number[];
  flow?: FlowMatch | null;
}

interface DotState {
  point: Cesium.PointPrimitive;
  road: TrafficRoad;
  bucket: FlowBucket | null;
  waypoints: Cesium.Cartesian3[];
  segmentDist: number[];
  numSegments: number;
  segIdx: number;
  t: number;
  mps: number;
  baseMps: number;
  direction: number;
  stoppedUntil: number;
  creep: { moving: boolean; until: number } | null;
}

interface TileCacheEntry {
  major: TrafficRoad[] | null;
  full: TrafficRoad[] | null;
}

let _viewer: Cesium.Viewer | null = null;
let _pointCollection: Cesium.PointPrimitiveCollection | null = null;
let _dots: DotState[] = [];
let _roads: TrafficRoad[] = [];
let _enabled = false;
let _preRenderRemover: (() => void) | null = null;
let _cameraRemover: (() => void) | null = null;
let _fetchTimeout: ReturnType<typeof setTimeout> | null = null;
let _lastBounds: Bounds | null = null;
let _fetching = false;
let _count = 0;
let _lastUpdate: number | null = null;
let _loadGeneration = 0;
let _activeFetchAbort: AbortController | null = null;
let _densityScale = 1.0;
let _speedScale = 1.0;
let _lastViewCenter: { lat: number; lon: number } | null = null;
let _prevPercentageChanged: number | null = null;
let _liveMode = false;
let _flowError: string | null = null;
let _flowStatusUnavailable = false;
let _flowPending = 0;
let _flowCoveragePct = 0;
let _bucketCounts: Record<string, number> = { free: 0, slow: 0, jam: 0, sim: 0 };
let _closedRoads = 0;
let _uncoveredMode: "sim" | "hide" = "sim";
let _jamViz: "none" | "density" | "heatline" | "both" = "density";
let _heatJamPrim: Cesium.GroundPolylinePrimitive | null = null;
let _heatSlowPrim: Cesium.GroundPolylinePrimitive | null = null;
let _heatLineCount = 0;
let _heatSupported: boolean | null = null;
let _lastRenderAltitude = 0;
let _stylePreset = "normal";
let _presetDots: "on" | "off" = "on";
let _activeBucketColors: Record<string, Cesium.Color> = { ...FLOW_BUCKET_COLORS };
let _styleListenerBound = false;
let _flowStatusPromise: Promise<void> | null = null;
let _tileCache = new Map<string, TileCacheEntry>();
let _enableKickTimer: ReturnType<typeof setInterval> | null = null;
let _lastAnimTime = 0;
let _animFrame = 0;
let _fadeScaleFar = 8000;
let _fadeTransFar = 10000;
let _scratchLerp = new Cesium.Cartesian3();

const jamDensityOn = () => _jamViz === "density" || _jamViz === "both";
const heatlineOn = () => _jamViz === "heatline" || _jamViz === "both";

function presetProfileActive(): boolean {
  return _presetDots === "on" && trafficStyleProfile(_stylePreset) !== "normal";
}

function activeSizeDelta(bucket: FlowBucket | null): number {
  return _presetDots === "on" ? presetSizeDelta(_stylePreset, bucket) : 0;
}

function baseDotSize(roadType: string, bucket: FlowBucket | null): number {
  const base = SIZE_BY_TYPE[roadType] || 4;
  return bucket && presetProfileActive() ? Math.max(base, STYLED_MIN_BASE_PX) : base;
}

function refreshBucketColors(): void {
  for (const bucket of (["free", "slow", "jam"] as FlowBucket[])) {
    const rgba = _presetDots === "on" ? presetDotRgba(_stylePreset, bucket) : null;
    _activeBucketColors[bucket] = rgba
      ? new Cesium.Color(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3])
      : FLOW_BUCKET_COLORS[bucket];
  }
}

function applyOutline(point: Cesium.PointPrimitive, bucket: FlowBucket | null): void {
  const spec = _presetDots === "on" ? presetDotOutline(_stylePreset, bucket) : null;
  if (spec) {
    point.outlineColor = new Cesium.Color(spec.rgba[0] / 255, spec.rgba[1] / 255, spec.rgba[2] / 255, spec.rgba[3]);
    point.outlineWidth = spec.width;
  } else {
    point.outlineWidth = 0;
  }
}

function restyleDotsInPlace(): void {
  refreshBucketColors();
  if (!_dots.length && !_heatLineCount) return;
  for (const dot of _dots) {
    const bucket = dot.bucket;
    if (!bucket) continue;
    dot.point.color = _activeBucketColors[bucket];
    dot.point.pixelSize = baseDotSize(dot.road?.type, bucket) + (bucket === "jam" ? 1 : 0) + activeSizeDelta(bucket);
    applyOutline(dot.point, bucket);
  }
  rebuildHeatLines(visibleRoadsForAltitude(_roads, _lastRenderAltitude));
}

function setStylePreset(name: string | null | undefined): void {
  const next = typeof name === "string" && name ? name : "normal";
  if (next === _stylePreset) return;
  _stylePreset = next;
  restyleDotsInPlace();
}

function buildOverpassQuery(
  south: number,
  west: number,
  north: number,
  east: number,
  { majorOnly = false, timeoutSec = 25 }: { majorOnly?: boolean; timeoutSec?: number } = {},
): string {
  const regex = majorOnly
    ? "^(motorway|trunk|primary|secondary)$"
    : "^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$";
  return `[out:json][timeout:${timeoutSec}];(way["highway"~"${regex}"](${south},${west},${north},${east}););out geom qt;`;
}

async function fetchRoads(
  south: number,
  west: number,
  north: number,
  east: number,
  { majorOnly = false, timeoutSec = 25, signal }: { majorOnly?: boolean; timeoutSec?: number; signal?: AbortSignal } = {},
): Promise<{ elements: any[] }> {
  const query = buildOverpassQuery(south, west, north, east, { majorOnly, timeoutSec });
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!response.ok) throw new Error(`Overpass API returned ${response.status}`);
  return response.json();
}

function parseRoads(overpassData: { elements?: any[] }): TrafficRoad[] {
  if (!overpassData?.elements) return [];
  const roads: TrafficRoad[] = [];
  for (const el of overpassData.elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const rawCoords = el.geometry.map((g: any) => [g.lon, g.lat]);
    const simplifyStep = rawCoords.length > MAX_WAYPOINTS_PER_ROAD ? Math.ceil(rawCoords.length / MAX_WAYPOINTS_PER_ROAD) : 1;
    const coords: number[][] = [];
    for (let i = 0; i < rawCoords.length; i += simplifyStep) coords.push(rawCoords[i]);
    const last = rawCoords[rawCoords.length - 1];
    const tail = coords[coords.length - 1];
    if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) coords.push(last);
    if (coords.length < 2) continue;

    const type = el.tags?.highway || "unclassified";
    const onewayTag = el.tags?.oneway;
    const oneway =
      onewayTag === "yes" || onewayTag === "1" || onewayTag === "true" || el.tags?.junction === "roundabout"
        ? 1
        : onewayTag === "-1"
          ? -1
          : 0;

    let baseHeight = 0;
    const firstCoord = coords[0];
    if (_viewer?.scene?.sampleHeightSupported && firstCoord) {
      const carto = Cesium.Cartographic.fromDegrees(firstCoord[0], firstCoord[1]);
      const sampled = _viewer.scene.sampleHeight(carto);
      if (sampled !== undefined && Number.isFinite(sampled)) baseHeight = sampled;
    }

    const waypoints = coords.map(([lng, lat]) => {
      const h = baseHeight + DOT_HEIGHT_OFFSET;
      return Cesium.Cartesian3.fromDegrees(lng, lat, h);
    });
    const segmentDist: number[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      segmentDist.push(Cesium.Cartesian3.distance(waypoints[i], waypoints[i + 1]));
    }
    roads.push({ coords, type, oneway, waypoints, segmentDist });
  }
  return roads;
}

function estimateRoadLengthDeg(coords: number[][]): number {
  let len = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len * 111000;
}

function computeDotCount(road: TrafficRoad, altitude: number): number {
  const flow = _liveMode ? road.flow : null;
  if (flow?.closure) return 0;
  if (_liveMode && !flow && _uncoveredMode === "hide") return 0;

  const lengthM = estimateRoadLengthDeg(road.coords);
  let spacing: number;
  if (altitude < 1000) spacing = 30;
  else if (altitude < 3000) spacing = 80;
  else if (altitude < 5000) spacing = 150;
  else spacing = 250;

  const mult =
    (DENSITY_MULT[road.type] || 1) *
    _densityScale *
    (flow ? flowDensityMult(flow.level, { jamBoost: jamDensityOn() }) : 1);
  return Math.max(1, Math.floor((lengthM / spacing) * mult));
}

function allocateRoadDotBudgets(roads: TrafficRoad[], altitude: number, dotCap: number): number[] {
  const planned = roads.map((road) => computeDotCount(road, altitude));
  const budgets = new Array(roads.length).fill(0);
  let remaining = Math.max(0, dotCap);

  const firstPassOrder = planned
    .map((count, index) => ({ count, index }))
    .sort((a, b) => b.count - a.count);

  for (const entry of firstPassOrder) {
    if (remaining <= 0) break;
    if (entry.count <= 0) continue;
    budgets[entry.index] = 1;
    remaining -= 1;
  }
  if (remaining <= 0) return budgets;

  let totalRemainder = 0;
  for (let i = 0; i < planned.length; i++) {
    totalRemainder += Math.max(0, planned[i] - budgets[i]);
  }
  if (totalRemainder <= 0) return budgets;

  const residuals: { index: number; residual: number }[] = [];
  let assigned = 0;
  for (let i = 0; i < planned.length; i++) {
    const cap = Math.max(0, planned[i] - budgets[i]);
    if (cap <= 0) continue;
    const ideal = (cap / totalRemainder) * remaining;
    const add = Math.min(cap, Math.floor(ideal));
    budgets[i] += add;
    assigned += add;
    residuals.push({ index: i, residual: ideal - add });
  }

  let leftover = remaining - assigned;
  if (leftover > 0 && residuals.length > 0) {
    residuals.sort((a, b) => b.residual - a.residual);
    let cursor = 0;
    while (leftover > 0 && residuals.length > 0) {
      const idx = residuals[cursor % residuals.length].index;
      if (budgets[idx] < planned[idx]) {
        budgets[idx] += 1;
        leftover -= 1;
      }
      cursor += 1;
      if (cursor > residuals.length * 3 && leftover > 0) break;
    }
  }
  return budgets;
}

function spawnDotsForRoad(road: TrafficRoad, altitude: number, budgetCount: number | null = null): void {
  const flow = _liveMode ? road.flow : null;
  if (flow?.closure) return;
  if (_liveMode && !flow && _uncoveredMode === "hide") return;

  const count = Number.isFinite(budgetCount as number)
    ? Math.max(0, Math.floor(budgetCount as number))
    : computeDotCount(road, altitude);
  const numSegments = road.waypoints.length - 1;
  if (numSegments < 1 || count <= 0) return;

  const baseMps = SPEED_MPS[road.type] || 5;
  const bucket = flow ? flowBucket(flow.level) : null;
  const pixelSize = baseDotSize(road.type, bucket) + (bucket === "jam" ? 1 : 0) + activeSizeDelta(bucket);
  const flowColor = bucket ? _activeBucketColors[bucket] : null;
  const outlineSpec = bucket && _presetDots === "on" ? presetDotOutline(_stylePreset, bucket) : null;
  const outlineColor = outlineSpec
    ? new Cesium.Color(outlineSpec.rgba[0] / 255, outlineSpec.rgba[1] / 255, outlineSpec.rgba[2] / 255, outlineSpec.rgba[3])
    : null;
  const flowSpeed = flow ? flowSpeedScale(flow.level) : 1;
  const now = Date.now();

  let placements: { segIdx: number; t: number; direction: number }[] | null = null;
  if (bucket === "jam" && jamDensityOn()) {
    let totalLen = 0;
    for (const d of road.segmentDist) totalLen += d;
    const platoons = queuePlatoons(totalLen, count);
    if (platoons.length) {
      placements = [];
      for (let p = 0; p < platoons.length; p++) {
        const dir = road.oneway ? road.oneway : p % 2 === 0 ? 1 : -1;
        for (const s of platoons[p]) {
          const { segIdx, t } = locateAlongRoad(road.segmentDist, s);
          placements.push({ segIdx, t, direction: dir });
        }
      }
    }
  }

  for (let i = 0; i < count; i++) {
    if (_dots.length >= MAX_DOTS) return;
    const segIdx = placements ? placements[i].segIdx : Math.floor(Math.random() * numSegments);
    const t = placements ? placements[i].t : Math.random();
    const noisedMps = baseMps * _speedScale * (0.7 + Math.random() * 0.6);
    const mps = noisedMps * flowSpeed;
    const direction = placements
      ? placements[i].direction
      : road.oneway
        ? road.oneway
        : i % 2 === 0
          ? 1
          : -1;
    Cesium.Cartesian3.lerp(road.waypoints[segIdx], road.waypoints[segIdx + 1], t, _scratchLerp);
    const jamProminent = bucket === "jam" && jamDensityOn();
    const point = _pointCollection!.add({
      position: Cesium.Cartesian3.clone(_scratchLerp),
      pixelSize,
      color: flowColor || Cesium.Color.WHITE.withAlpha(0.85),
      scaleByDistance: new Cesium.NearFarScalar(100, 1.5, _fadeScaleFar, jamProminent ? JAM_DOT_FAR_SCALE : 0.3),
      translucencyByDistance: new Cesium.NearFarScalar(100, 1.0, _fadeTransFar, 0.0),
      disableDepthTestDistance: jamProminent ? JAM_DOT_DEPTH_PUNCH : 2000,
      ...(outlineSpec ? { outlineColor, outlineWidth: outlineSpec.width } : {}),
    });
    _bucketCounts[bucket || "sim"] += 1;
    _dots.push({
      point,
      road,
      bucket,
      waypoints: road.waypoints,
      segmentDist: road.segmentDist,
      numSegments,
      segIdx,
      t,
      mps,
      baseMps: noisedMps,
      direction,
      stoppedUntil: 0,
      creep: bucket === "jam" && jamDensityOn() ? { moving: Math.random() < 0.4, until: now + Math.random() * 2000 } : null,
    });
  }
}

function maybeStopLight(dot: DotState, now: number): void {
  const nearEnd = dot.segIdx <= 1 || dot.segIdx >= dot.numSegments - 2;
  if (nearEnd && Math.random() < 0.008) {
    dot.stoppedUntil = now + 2000 + Math.random() * 4000;
  }
}

function animate(): void {
  const now = Date.now();
  const dt = _lastAnimTime ? Math.min((now - _lastAnimTime) / 1000, 0.1) : 0.016;
  _lastAnimTime = now;

  for (let i = 0; i < _dots.length; i++) {
    const dot = _dots[i];
    if (now < dot.stoppedUntil) continue;
    let burst = 1;
    if (dot.creep) {
      if (now >= dot.creep.until) {
        dot.creep.moving = !dot.creep.moving;
        const [lo, hi] = dot.creep.moving ? CREEP_MOVE_MS : CREEP_STOP_MS;
        dot.creep.until = now + lo + Math.random() * (hi - lo);
      }
      if (!dot.creep.moving) continue;
      burst = CREEP_BURST;
    }
    const segLen = dot.segmentDist[dot.segIdx] || 1;
    const tDelta = (dot.mps * burst * dt) / segLen;
    dot.t += tDelta * dot.direction;

    if (dot.t >= 1.0) {
      dot.t -= 1.0;
      dot.segIdx++;
      if (dot.segIdx >= dot.numSegments) {
        dot.segIdx = 0;
        dot.t = Math.random() * 0.3;
      }
      maybeStopLight(dot, now);
    } else if (dot.t <= 0.0) {
      dot.t += 1.0;
      dot.segIdx--;
      if (dot.segIdx < 0) {
        dot.segIdx = dot.numSegments - 1;
        dot.t = 1.0 - Math.random() * 0.3;
      }
      maybeStopLight(dot, now);
    }

    const a = dot.waypoints[dot.segIdx];
    const b = dot.waypoints[dot.segIdx + 1];
    Cesium.Cartesian3.lerp(a, b, dot.t, _scratchLerp);
    dot.point.position = _scratchLerp;
  }

  if (_heatJamPrim?.appearance) {
    _heatJamPrim.appearance.material.uniforms.color.alpha = HEAT_JAM_BASE_ALPHA + HEAT_JAM_PULSE_ALPHA * Math.sin(now / 260);
  }

  _animFrame++;
}

function getCameraAltitude(): number {
  const carto = _viewer!.camera.positionCartographic;
  return carto ? carto.height : Infinity;
}

function getViewBounds(): Bounds | null {
  const rect = _viewer!.camera.computeViewRectangle();
  if (!rect) return null;
  return {
    south: Cesium.Math.toDegrees(rect.south),
    west: Cesium.Math.toDegrees(rect.west),
    north: Cesium.Math.toDegrees(rect.north),
    east: Cesium.Math.toDegrees(rect.east),
  };
}

function getFetchCenter(): { lat: number; lon: number } | null {
  const carto = _viewer!.camera.positionCartographic;
  if (!carto) return null;
  const nadirLat = Cesium.Math.toDegrees(carto.latitude);
  const nadirLon = Cesium.Math.toDegrees(carto.longitude);
  let hitLat: number | undefined;
  let hitLon: number | undefined;
  const canvas = _viewer!.scene.canvas;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  if (width > 0 && height > 0) {
    const hit = _viewer!.camera.pickEllipsoid(new Cesium.Cartesian2(width / 2, height / 2), Cesium.Ellipsoid.WGS84);
    if (hit) {
      const hitCarto = Cesium.Cartographic.fromCartesian(hit);
      hitLat = Cesium.Math.toDegrees(hitCarto.latitude);
      hitLon = Cesium.Math.toDegrees(hitCarto.longitude);
    }
  }
  return deriveFetchCenter({ nadirLat, nadirLon, hitLat, hitLon, maxPullKm: MAX_LOOKAT_PULL_KM });
}

function getBoundsCenter(bounds: Bounds): { lat: number; lon: number } {
  return { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 };
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * 111;
  const avgLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLon = (a.lon - b.lon) * 111 * Math.cos(avgLat);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function boundsOverlap(a: Bounds, b: Bounds, threshold: number): boolean {
  const overlapS = Math.max(a.south, b.south);
  const overlapN = Math.min(a.north, b.north);
  const overlapW = Math.max(a.west, b.west);
  const overlapE = Math.min(a.east, b.east);
  if (overlapN <= overlapS || overlapE <= overlapW) return false;
  const overlapArea = (overlapN - overlapS) * (overlapE - overlapW);
  const aArea = (a.north - a.south) * (a.east - a.west);
  return aArea > 0 && overlapArea / aArea >= threshold;
}

function clampBounds(bounds: Bounds): Bounds {
  return clampBoundsAroundCenter(bounds, getBoundsCenter(bounds));
}

function cancelActiveFetch(): void {
  if (_activeFetchAbort) {
    _activeFetchAbort.abort();
    _activeFetchAbort = null;
  }
}

export function deriveTrafficFlowError(error: unknown): string | null {
  if (!error || (error as Error)?.name === "AbortError") return null;
  const message = String((error as Error)?.message || error);
  const status = Number(message.match(/HTTP (\d{3})/)?.[1]);
  if (status === 503) return "TomTom key unavailable";
  if (status === 429) return "TomTom daily budget reached";
  if (status === 502 || status === 504) return "TomTom upstream unreachable";
  if (Number.isFinite(status)) return `TomTom flow error (HTTP ${status})`;
  return "TomTom flow unavailable";
}

interface FeedPresentation {
  mode: "live" | "sim";
  error: string | null;
  loadingLabel: string;
}

export function trafficFeedPresentation({
  liveMode = false,
  fetching = false,
  flowError = null,
  coveragePct = 0,
  statusUnavailable = false,
}: {
  liveMode?: boolean;
  fetching?: boolean;
  flowError?: string | null;
  coveragePct?: number;
  statusUnavailable?: boolean;
} = {}): FeedPresentation {
  const mode = liveMode ? "live" : "sim";
  if (liveMode && flowError) {
    const degraded = `SIMULATED - ${flowError}`;
    return { mode, error: degraded, loadingLabel: degraded };
  }
  if (liveMode) {
    return {
      mode,
      error: null,
      loadingLabel: fetching ? "syncing LIVE traffic flow" : `LIVE - TomTom flow - ${coveragePct}% cov`,
    };
  }
  return {
    mode,
    error: null,
    loadingLabel: statusUnavailable ? "SIMULATED - traffic service unreachable" : "SIMULATED - add TomTom key for live",
  };
}

function ensureFlowStatus(): Promise<void> {
  if (!_flowStatusPromise) {
    _flowStatusPromise = fetch("/api/tomtom/status")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((status) => {
        _liveMode = Boolean(status?.hasKey);
        _flowStatusUnavailable = false;
        if (_liveMode) {
          console.log("[Data:Traffic] TomTom key present - live flow mode");
        }
      })
      .catch((e) => {
        _liveMode = false;
        _flowStatusUnavailable = true;
        console.warn("[Data:Traffic] TomTom status unreachable - simulated traffic:", e?.message || e);
      });
  }
  return _flowStatusPromise;
}

async function applyFlowToRoads(roads: TrafficRoad[], clamped: Bounds, generation: number): Promise<void> {
  _flowPending += 1;
  try {
    if (!_flowStatusPromise) return;
    await _flowStatusPromise;
    if (!_liveMode || !_enabled) return;
    if (generation !== _loadGeneration) return;
    if (!Array.isArray(roads) || roads.length === 0) return;
    try {
      if (!_activeFetchAbort) _activeFetchAbort = new AbortController();
      const segments = await fetchFlowForBounds(clamped, { signal: _activeFetchAbort.signal });
      if (generation !== _loadGeneration) return;
      const { matches, matchedCount, candidateCount } = matchFlowToRoads(roads, segments);
      for (let i = 0; i < roads.length; i++) {
        roads[i].flow = matches[i];
      }
      _flowCoveragePct = candidateCount > 0 ? Math.round((matchedCount / candidateCount) * 100) : 0;
      _flowError = null;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      if (generation !== _loadGeneration || !_enabled) return;
      _flowError = deriveTrafficFlowError(e);
      _flowCoveragePct = 0;
      console.warn("[Data:Traffic] Flow fetch failed (sim colors remain):", (e as Error)?.message || e);
    }
  } finally {
    _flowPending -= 1;
  }
}

async function applyFlowThenRender(roads: TrafficRoad[], clamped: Bounds, generation: number, altitude: number, label: string): Promise<boolean> {
  const flowJob = applyFlowToRoads(roads, clamped, generation);
  const outcome: "flow" | "timeout" = await Promise.race([
    flowJob.then(() => "flow" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout" as const), FLOW_RENDER_RACE_MS)),
  ]);
  if (generation !== _loadGeneration) return false;
  renderRoadsForAltitude(roads, altitude, label);
  if (outcome === "timeout") {
    flowJob
      .then(() => {
        if (generation !== _loadGeneration) return;
        recolorDotsInPlace(label);
      })
      .catch(() => {});
  }
  return true;
}

function recolorDotsInPlace(label: string): void {
  if (!_liveMode || !_dots.length) return;
  _bucketCounts = { free: 0, slow: 0, jam: 0, sim: 0 };
  let closedDots = 0;
  const now = Date.now();
  for (const dot of _dots) {
    const flow = dot.road ? dot.road.flow : null;
    if (flow?.closure) {
      dot.point.show = false;
      closedDots += 1;
      continue;
    }
    const bucket = flow ? flowBucket(flow.level) : null;
    dot.bucket = bucket;
    dot.point.color = bucket ? _activeBucketColors[bucket] : Cesium.Color.WHITE.withAlpha(0.85);
    if (bucket === "jam") {
      dot.point.pixelSize = baseDotSize(dot.road?.type, bucket) + 1 + activeSizeDelta("jam");
    } else if (bucket && presetProfileActive()) {
      dot.point.pixelSize = baseDotSize(dot.road?.type, bucket) + activeSizeDelta(bucket);
    }
    if (presetProfileActive()) applyOutline(dot.point, bucket);
    dot.mps = dot.baseMps * (flow ? flowSpeedScale(flow.level) : 1);
    if (bucket === "jam" && jamDensityOn()) {
      if (!dot.creep) dot.creep = { moving: Math.random() < 0.4, until: now + Math.random() * 2000 };
      dot.point.scaleByDistance = new Cesium.NearFarScalar(100, 1.5, _fadeScaleFar, JAM_DOT_FAR_SCALE);
      dot.point.disableDepthTestDistance = JAM_DOT_DEPTH_PUNCH;
    } else {
      dot.creep = null;
    }
    _bucketCounts[bucket || "sim"] += 1;
  }
  _closedRoads = _roads.reduce((n, r) => n + (r.flow?.closure ? 1 : 0), 0);
  rebuildHeatLines(visibleRoadsForAltitude(_roads, _lastRenderAltitude));
  console.log(`[Data:Traffic] Flow recolor (${label}): ${_dots.length} dots, closedDots=${closedDots}`);
}

function visibleRoadsForAltitude(roads: TrafficRoad[], altitude: number): TrafficRoad[] {
  return altitude > 5000
    ? roads.filter((r) => r.type === "motorway" || r.type === "trunk" || r.type === "primary")
    : roads;
}

function removeHeatLines(): void {
  if (_heatJamPrim) {
    _viewer?.scene.groundPrimitives.remove(_heatJamPrim);
    _heatJamPrim = null;
  }
  if (_heatSlowPrim) {
    _viewer?.scene.groundPrimitives.remove(_heatSlowPrim);
    _heatSlowPrim = null;
  }
  _heatLineCount = 0;
}

function rebuildHeatLines(roads: TrafficRoad[]): void {
  removeHeatLines();
  if (!_viewer || !_liveMode || !heatlineOn()) return;
  if (_heatSupported === null) {
    _heatSupported = Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene);
    if (!_heatSupported) console.warn("[Data:Traffic] GroundPolylinePrimitive unsupported - heat-lines disabled");
  }
  if (!_heatSupported) return;

  const candidates: { road: TrafficRoad; bucket: string; len: number }[] = [];
  for (const road of roads) {
    const flow = road.flow;
    if (!flow || flow.closure) continue;
    const bucket = flowBucket(flow.level);
    if (bucket === "free") continue;
    let len = 0;
    for (const d of road.segmentDist) len += d;
    candidates.push({ road, bucket, len });
  }
  candidates.sort((a, b) =>
    a.bucket === b.bucket ? b.len - a.len : a.bucket === "jam" ? -1 : 1,
  );
  const kept = candidates.slice(0, HEAT_LINE_CAP);

  const instancesFor = (bucket: string, width: number) =>
    kept
      .filter((c) => c.bucket === bucket)
      .map(
        (c) =>
          new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({ positions: c.road.waypoints, width }),
          }),
      );

  const monoHeat = _presetDots === "on" && trafficStyleProfile(_stylePreset) === "mono";
  const jamLineColor = monoHeat ? Cesium.Color.WHITE : HEAT_JAM_COLOR;
  const slowLineColor = monoHeat ? new Cesium.Color(0.7, 0.7, 0.7, HEAT_SLOW_COLOR.alpha) : HEAT_SLOW_COLOR;

  const jamInstances = instancesFor("jam", HEAT_LINE_JAM_WIDTH);
  if (jamInstances.length) {
    _heatJamPrim = _viewer.scene.groundPrimitives.add(
      new Cesium.GroundPolylinePrimitive({
        geometryInstances: jamInstances,
        classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
        appearance: new Cesium.PolylineMaterialAppearance({
          material: Cesium.Material.fromType("PolylineGlow", { color: jamLineColor.withAlpha(HEAT_JAM_BASE_ALPHA), glowPower: 0.25 }),
        }),
      }),
    );
  }
  const slowInstances = instancesFor("slow", HEAT_LINE_SLOW_WIDTH);
  if (slowInstances.length) {
    _heatSlowPrim = _viewer.scene.groundPrimitives.add(
      new Cesium.GroundPolylinePrimitive({
        geometryInstances: slowInstances,
        classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
        appearance: new Cesium.PolylineMaterialAppearance({
          material: Cesium.Material.fromType("Color", { color: slowLineColor }),
        }),
      }),
    );
  }

  _heatLineCount = kept.length;
  if (candidates.length > kept.length) {
    console.log(`[Data:Traffic] Heat-lines capped at ${HEAT_LINE_CAP} (${candidates.length} congested roads in view)`);
  }
}

function renderRoadsForAltitude(roads: TrafficRoad[], altitude: number, label: string): void {
  clearDots();
  _roads = roads;
  _lastRenderAltitude = altitude;
  const filteredRoads = visibleRoadsForAltitude(roads, altitude);
  _closedRoads = _liveMode ? filteredRoads.reduce((n, r) => n + (r.flow?.closure ? 1 : 0), 0) : 0;

  let areaDist = altitude;
  if (_viewer && filteredRoads.length) {
    const probes = [filteredRoads[0], filteredRoads[Math.floor(filteredRoads.length / 2)], filteredRoads[filteredRoads.length - 1]];
    for (const probe of probes) {
      const wp = probe?.waypoints?.[0];
      if (wp) areaDist = Math.max(areaDist, Cesium.Cartesian3.distance(_viewer.camera.positionWC, wp));
    }
  }
  _fadeScaleFar = Math.max(8000, areaDist * 1.5);
  _fadeTransFar = Math.max(10000, areaDist * 1.8);

  const roadBudgets = allocateRoadDotBudgets(filteredRoads, altitude, MAX_DOTS);
  for (let i = 0; i < filteredRoads.length; i++) {
    const road = filteredRoads[i];
    const budget = roadBudgets[i] || 0;
    if (budget <= 0) continue;
    spawnDotsForRoad(road, altitude, budget);
    if (_dots.length >= MAX_DOTS) break;
  }

  rebuildHeatLines(filteredRoads);
  _count = _dots.length;
  _lastUpdate = Date.now();
  console.log(`[Data:Traffic] ${label}: ${_count} dots (roads=${roads.length}, alt=${Math.round(altitude)}m)`);
}

function clearDots(): void {
  if (_pointCollection) _pointCollection.removeAll();
  removeHeatLines();
  _dots = [];
  _roads = [];
  _count = 0;
  _bucketCounts = { free: 0, slow: 0, jam: 0, sim: 0 };
  _closedRoads = 0;
}

async function loadRoadsForBounds(bounds: Bounds, altitude: number): Promise<void> {
  const generation = ++_loadGeneration;
  cancelActiveFetch();
  const clamped = clampBounds(bounds);
  const cacheKey = `${clamped.south.toFixed(4)},${clamped.west.toFixed(4)},${clamped.north.toFixed(4)},${clamped.east.toFixed(4)}`;

  ensureFlowStatus().then(() => {
    if (_liveMode && _enabled && generation === _loadGeneration) {
      fetchFlowForBounds(clamped, {}).catch(() => {});
    }
  });

  _fetching = true;
  const prevBounds = _lastBounds;
  const prevViewCenter = _lastViewCenter;
  _lastBounds = clamped;
  _lastViewCenter = getBoundsCenter(clamped);
  let renderedSomething = false;

  try {
    let cache = _tileCache.get(cacheKey);
    if (!cache) {
      if (_tileCache.size >= TILE_CACHE_MAX_ENTRIES) {
        const oldest = _tileCache.keys().next().value;
        if (oldest !== undefined) _tileCache.delete(oldest);
      }
      cache = { major: null, full: null };
      _tileCache.set(cacheKey, cache);
    }

    if (cache.full) {
      renderedSomething = await applyFlowThenRender(cache.full, clamped, generation, altitude, "Cache full");
      return;
    }

    if (cache.major) {
      if (!(await applyFlowThenRender(cache.major, clamped, generation, altitude, "Cache major"))) return;
      renderedSomething = true;
    } else {
      _activeFetchAbort = new AbortController();
      console.log(`[Data:Traffic] Fast fetch major roads [${cacheKey}]`);
      const majorData = await fetchRoads(
        clamped.south,
        clamped.west,
        clamped.north,
        clamped.east,
        { majorOnly: true, timeoutSec: 12, signal: _activeFetchAbort.signal },
      );
      if (generation !== _loadGeneration) return;
      cache.major = parseRoads(majorData);
      if (!(await applyFlowThenRender(cache.major, clamped, generation, altitude, "Loaded major"))) return;
      renderedSomething = true;
    }

    if (altitude > FAST_FETCH_ALTITUDE) return;

    _activeFetchAbort = new AbortController();
    console.log(`[Data:Traffic] Full fetch local roads [${cacheKey}]`);
    const fullData = await fetchRoads(
      clamped.south,
      clamped.west,
      clamped.north,
      clamped.east,
      { majorOnly: false, timeoutSec: 20, signal: _activeFetchAbort.signal },
    );
    if (generation !== _loadGeneration) return;
    cache.full = parseRoads(fullData);
    if (!(await applyFlowThenRender(cache.full, clamped, generation, altitude, "Loaded full"))) return;
    renderedSomething = true;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    console.warn("[Data:Traffic] Fetch error:", e);
  } finally {
    if (generation === _loadGeneration) {
      _fetching = false;
      if (!renderedSomething) {
        _lastBounds = prevBounds;
        _lastViewCenter = prevViewCenter;
      }
    }
    _activeFetchAbort = null;
  }
}

function onCameraChanged(): void {
  if (!_enabled) return;
  const alt = getCameraAltitude();
  if (alt > ACTIVATION_ALTITUDE) {
    clearDots();
    _lastBounds = null;
    _lastViewCenter = null;
    return;
  }
  const bounds = getViewBounds();
  if (!bounds) return;
  const fetchCenter = getFetchCenter();
  const clamped = fetchCenter ? clampBoundsAroundCenter(bounds, fetchCenter) : clampBounds(bounds);
  const center = getBoundsCenter(clamped);

  if (
    _lastBounds &&
    _lastViewCenter &&
    boundsOverlap(clamped, _lastBounds, OVERLAP_THRESHOLD) &&
    distanceKm(center, _lastViewCenter) < MIN_CENTER_SHIFT_KM
  ) {
    return;
  }

  clearTimeout(_fetchTimeout ?? undefined);
  _fetchTimeout = setTimeout(() => loadRoadsForBounds(clamped, alt), FETCH_DEBOUNCE);
}

const trafficLayer: LayerImpl & {
  getStats: () => Record<string, any>;
  setParams: (params: Record<string, any>) => void;
  getParams: () => Record<string, any>;
  getDetectableObjects: (options?: { maxCount?: number; seed?: number }) => Array<{
    position: Cesium.Cartesian3;
    id: string;
    type: string;
    tier?: string;
  }>;
} = {
  async enable(ctx: LayerContext): Promise<void> {
    _viewer = ctx.viewer;
    _enabled = true;
    governorHold("traffic");

    if (!_pointCollection) {
      _pointCollection = new ctx.Cesium.PointPrimitiveCollection({
        blendOption: ctx.Cesium.BlendOption.TRANSLUCENT,
      });
      ctx.viewer.scene.primitives.add(_pointCollection);
      _pointCollection.show = false;
      _dots = [];
      _roads = [];
      _count = 0;
      _lastUpdate = null;
      _lastBounds = null;
      _fetching = false;
      _loadGeneration = 0;
      _densityScale = 1.0;
      _speedScale = 1.0;
      _lastViewCenter = null;
      _flowCoveragePct = 0;
      _flowError = null;
      _stylePreset = "normal";
      _presetDots = "on";
      if (typeof window !== "undefined" && !_styleListenerBound) {
        _styleListenerBound = true;
      }
      refreshBucketColors();
      console.log("[Data:Traffic] Initialized");
    }

    _pointCollection.show = true;
    _lastAnimTime = 0;
    _preRenderRemover = ctx.viewer.scene.preRender.addEventListener(animate);

    ctx.viewer.camera.changed.addEventListener(onCameraChanged);
    _prevPercentageChanged = ctx.viewer.camera.percentageChanged;
    ctx.viewer.camera.percentageChanged = 0.05;

    onCameraChanged();
    clearInterval(_enableKickTimer ?? undefined);
    _enableKickTimer = setInterval(() => {
      if (!_enabled || _lastUpdate) {
        clearInterval(_enableKickTimer!);
        _enableKickTimer = null;
        return;
      }
      if (!_fetching) onCameraChanged();
    }, 1500);
  },

  disable(ctx: LayerContext): void {
    _enabled = false;
    governorRelease("traffic");
    clearTimeout(_fetchTimeout ?? undefined);
    clearInterval(_enableKickTimer ?? undefined);
    _enableKickTimer = null;
    cancelActiveFetch();
    _loadGeneration++;
    clearDots();
    _lastViewCenter = null;
    _flowError = null;

    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }

    ctx.viewer.camera.changed.removeEventListener(onCameraChanged);
    if (_prevPercentageChanged != null) {
      ctx.viewer.camera.percentageChanged = _prevPercentageChanged;
      _prevPercentageChanged = null;
    }

    if (_pointCollection) {
      ctx.viewer.scene.primitives.remove(_pointCollection);
      _pointCollection = null;
    }
    removeHeatLines();
    _tileCache.clear();
    resetFlowTileCache();
    _count = 0;
    _lastUpdate = null;
  },

  getStats() {
    const loading = _fetching || _flowPending > 0;
    const feed = trafficFeedPresentation({
      liveMode: _liveMode,
      fetching: loading,
      flowError: _flowError,
      coveragePct: _flowCoveragePct,
      statusUnavailable: _flowStatusUnavailable,
    });
    return {
      count: _count,
      lastUpdate: _lastUpdate,
      loading,
      mode: feed.mode,
      error: feed.error,
      flowCoveragePct: _flowCoveragePct,
      tilesFetched: getFlowSessionStats().tilesFetched,
      flowBuckets: { ..._bucketCounts },
      closedRoads: _closedRoads,
      heatLines: _heatLineCount,
      jamViz: _jamViz,
      stylePreset: _stylePreset,
      styleProfile: _presetDots === "on" ? trafficStyleProfile(_stylePreset) : "normal",
      loadingLabel: feed.loadingLabel,
    };
  },

  setParams(params: Record<string, any> = {}) {
    if (typeof params.densityScale === "number") _densityScale = Math.max(0.2, Math.min(2.5, params.densityScale));
    if (typeof params.speedScale === "number") _speedScale = Math.max(0.3, Math.min(3.0, params.speedScale));
    if (params.uncoveredRoads === "sim" || params.uncoveredRoads === "hide") _uncoveredMode = params.uncoveredRoads;
    if (["none", "density", "heatline", "both"].includes(params.jamViz)) _jamViz = params.jamViz;
    if (params.presetDots === "on" || params.presetDots === "off") {
      if (params.presetDots !== _presetDots) {
        _presetDots = params.presetDots;
        restyleDotsInPlace();
      }
    }
  },

  getParams() {
    return {
      densityScale: _densityScale,
      speedScale: _speedScale,
      uncoveredRoads: _uncoveredMode,
      jamViz: _jamViz,
      presetDots: _presetDots,
    };
  },

  getDetectableObjects(options: { maxCount?: number; seed?: number } = {}) {
    if (!_enabled || _dots.length === 0) return [];
    const maxCount = Number.isFinite(options.maxCount)
      ? Math.max(1, Math.floor(options.maxCount as number))
      : _dots.length;
    const seed = Number.isFinite(options.seed) ? Math.floor(options.seed as number) : 0;
    const stride = Math.max(1, Math.ceil(_dots.length / maxCount));
    const start = seed % stride;
    const result: { position: Cesium.Cartesian3; id: string; type: string; tier?: string }[] = [];
    for (let i = start; i < _dots.length; i += stride) {
      const pos = _dots[i].point.position;
      if (!pos) continue;
      const entry: any = { position: pos, id: `VEH-${String(i).padStart(4, "0")}`, type: "VEH" };
      if (_liveMode) {
        const tier = trafficBucketTier(_dots[i].bucket || "sim");
        if (tier) entry.tier = tier;
      }
      result.push(entry);
      if (result.length >= maxCount) break;
    }
    return result;
  },
};

export default trafficLayer;
