import * as Cesium from "cesium";
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLong,
  degreesLat,
} from "satellite.js";
import type { LayerContext, LayerImpl } from "./types";
import { useGlobeStore } from "@/store/globe-store";
import {
  governorHold,
  governorRelease,
  governorRequestRender,
} from "@/globe/render-governor";
import {
  satelliteClassColor,
  satelliteClassLabel,
  ISS_NORAD,
} from "./satellite-class";

// Satellites layer: GEV parity (gods-eye-view/src/data/satellites.js).
//
// Architecture (ported from GEV + Spectre V1's TS port):
// - CelesTrak TLE text per group via /api/celestrak/[group] proxy
// - Client builds satrecs (satellite.js SGP4), dedupe by NORAD id
// - Fleet rendered as one PointPrimitiveCollection, class-colored (GEV styles)
// - Fleet propagation at 1s cadence (200ms while tracking) on scene.preRender
// - Tracked satellite: per-frame SGP4 with a frame-number cache shared by the
//   entity position, detail card, and camera
// - Orbit rings: one-instance Cesium.Primitive baked at frozen GMST, re-aligned
//   every 1s via rigid Z-rotation modelMatrix (no geometry rebuild, no flicker)
// - Click a point to track; click empty space or Escape to untrack
// - The tracked satellite renders a 3D model (V1 deviation from GEV's dot)

interface CatalogEntry {
  name: string;
  satrec: ReturnType<typeof twoline2satrec>;
  group: string;
}

interface OrbitPath {
  entity: Cesium.Entity;
  /** Ring baked in ECEF at gmstAtBake (inertial snapshot). */
  baked: Cesium.Cartesian3[];
  /** Rotated output the CallbackProperty hands to the polyline each frame. */
  scratch: Cesium.Cartesian3[];
  gmstAtBake: number;
}

interface TrackedFrameGeo {
  longitude: number;
  latitude: number;
  altitude: number; // meters
  speedMps: number | null;
}

/** CelesTrak groups loaded as the core catalog, in dedupe-priority order. */
const CATALOG_GROUPS = [
  "stations",
  "visual",
  "gps-ops",
  "glo-ops",
  "galileo",
  "geo",
] as const;

const ORBIT_PATH_STEPS = 180;
const POSITION_UPDATE_MS = 1000;
const TRACKED_UPDATE_MS = 200;
const RING_ROTATION_MS = 1000;

/** GEV tracked-camera offset (ENU meters), magnitude ~726 km for LEO. */
const TRACK_VIEW_FROM_LEO = new Cesium.Cartesian3(-450000, -450000, 350000);
const HIGH_ORBIT_ALTITUDE_M = 2_000_000;
const TRACK_VIEW_FROM_HIGH_SCALE = 4;

const GOV_HOLD_ID = "satellites-layer";
const MODEL_URL = "/models/satellite.glb";

/** Camera distance split between 3D model and point rendering (planes rule). */
const MODEL_DDC_METERS = 5_000_000;

// GEV point styles: per-group prominence; colors come from satellite-class.ts.
const POINT_OUTLINE = Cesium.Color.WHITE.withAlpha(0.3);
const classColor = (group: string) =>
  Cesium.Color.fromCssColorString(satelliteClassColor(group));

// All satellite points render white (user preference). Pixel size still
// varies by group for visual hierarchy; ISS stays largest.
const POINT_STYLES: Record<
  string,
  { pixelSize: number; color: Cesium.Color; outlineWidth: number }
> = {
  iss: {
    pixelSize: 12,
    color: Cesium.Color.WHITE,
    outlineWidth: 2,
  },
  stations: { pixelSize: 8, color: Cesium.Color.WHITE, outlineWidth: 0 },
  visual: { pixelSize: 6, color: Cesium.Color.WHITE, outlineWidth: 0 },
  "gps-ops": { pixelSize: 6, color: Cesium.Color.WHITE, outlineWidth: 0 },
  "glo-ops": { pixelSize: 6, color: Cesium.Color.WHITE, outlineWidth: 0 },
  galileo: { pixelSize: 6, color: Cesium.Color.WHITE, outlineWidth: 0 },
  geo: { pixelSize: 5, color: Cesium.Color.WHITE, outlineWidth: 0 },
};

function pointStyleFor(
  noradId: number,
  group: string | undefined,
): { pixelSize: number; color: Cesium.Color; outlineWidth: number } {
  if (noradId === ISS_NORAD) return POINT_STYLES.iss;
  return POINT_STYLES[group ?? ""] ?? POINT_STYLES.visual;
}

/** Famous satellites offered in the right panel (one per class/group). */
export interface FamousSatellite {
  key: string;
  label: string;
  noradId?: number;
  /** Deterministic name match within a group when no NORAD id is fixed. */
  group?: string;
  nameIncludes?: string[];
  nameFallbacks?: string[];
  /** Wikipedia article URL for the INFO button (curated list only). */
  wikipedia?: string;
}

export const FAMOUS_SATELLITES: FamousSatellite[] = [
  {
    key: "iss",
    label: "ISS",
    noradId: ISS_NORAD,
    wikipedia: "https://en.wikipedia.org/wiki/International_Space_Station",
  },
  {
    key: "tiangong",
    label: "TIANGONG",
    noradId: 48274,
    wikipedia: "https://en.wikipedia.org/wiki/Tiangong_space_station",
  },
  {
    key: "hubble",
    label: "HUBBLE",
    noradId: 20580,
    wikipedia: "https://en.wikipedia.org/wiki/Hubble_Space_Telescope",
  },
  {
    key: "gps",
    label: "GPS",
    group: "gps-ops",
    nameIncludes: ["GPS"],
    wikipedia: "https://en.wikipedia.org/wiki/Global_Positioning_System",
  },
  {
    key: "glonass",
    label: "GLONASS",
    group: "glo-ops",
    nameIncludes: ["GLONASS"],
    wikipedia: "https://en.wikipedia.org/wiki/GLONASS",
  },
  {
    key: "galileo",
    label: "GALILEO",
    group: "galileo",
    nameIncludes: ["GALILEO"],
    wikipedia: "https://en.wikipedia.org/wiki/Galileo_(satellite_navigation)",
  },
  {
    key: "goes",
    label: "GOES 19",
    group: "geo",
    nameIncludes: ["GOES 19"],
    nameFallbacks: ["GOES 16"],
    wikipedia: "https://en.wikipedia.org/wiki/GOES_19",
  },
];

// Module-level layer state (module singleton, matches the other V2 layers).
let _viewer: Cesium.Viewer | null = null;
let _cesium: typeof Cesium | null = null;
let _catalog = new Map<number, CatalogEntry>();
let _pointCollection: Cesium.PointPrimitiveCollection | null = null;
let _points = new Map<number, Cesium.PointPrimitive>();
let _modelEntities = new Map<number, Cesium.Entity>();
let _orbitPaths = new Map<number, OrbitPath>();
let _enabled = false;
let _count = 0;
let _lastError: string | null = null;

// Tracking state.
let _trackedNorad: number | null = null;
let _trackedEntity: Cesium.Entity | null = null;
let _trackedFrameNumber = -1;
let _trackedFrameGeo: TrackedFrameGeo | null = null;
const _trackedFrameCartesian = new Cesium.Cartesian3();

// Listeners / timers.
let _clickHandler: Cesium.ScreenSpaceEventHandler | null = null;
let _preRenderListener: Cesium.Event.RemoveCallback | null = null;
let _trackedEntityChangedRemove: (() => void) | null = null;
let _keyListener: ((e: KeyboardEvent) => void) | null = null;
let _lastPropagation = 0;
let _lastRingRotation = 0;

/** Parse 3-line TLE text into { name, line1, line2 } records. */
function parseTLE(text: string): { name: string; line1: string; line2: string }[] {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const result: { name: string; line1: string; line2: string }[] = [];
  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (line1.startsWith("1 ") && line2.startsWith("2 ")) {
      result.push({ name, line1, line2 });
    }
  }
  return result;
}

/** SGP4 propagate to a date; returns geodetic degrees + meters + speed. */
function propagatePosition(
  satrec: ReturnType<typeof twoline2satrec>,
  date: Date,
): TrackedFrameGeo | null {
  try {
    const posVel = propagate(satrec, date);
    if (!posVel || !posVel.position || typeof posVel.position === "boolean") {
      return null;
    }
    const gmst = gstime(date);
    const geo = eciToGeodetic(posVel.position, gmst);
    const velocity =
      posVel.velocity && typeof posVel.velocity !== "boolean"
        ? posVel.velocity
        : null;
    const speedMps = velocity
      ? Math.hypot(velocity.x, velocity.y, velocity.z) * 1000
      : null;
    return {
      longitude: degreesLong(geo.longitude),
      latitude: degreesLat(geo.latitude),
      altitude: geo.height * 1000,
      speedMps: Number.isFinite(speedMps as number) ? (speedMps as number) : null,
    };
  } catch {
    return null;
  }
}

function orbitalPeriodSeconds(satrec: ReturnType<typeof twoline2satrec>): number {
  const meanMotion = satrec.no * (1440 / (2 * Math.PI));
  return 86400 / Math.max(meanMotion, 0.1);
}

/** One full orbit as Cartesian3 positions, GMST frozen so the ring closes. */
function computeOrbitPath(
  satrec: ReturnType<typeof twoline2satrec>,
  referenceDate: Date,
): Cesium.Cartesian3[] {
  const periodSec = orbitalPeriodSeconds(satrec);
  const stepSec = periodSec / ORBIT_PATH_STEPS;
  const baseTime = referenceDate.getTime();
  const fixedGmst = gstime(referenceDate);
  const positions: Cesium.Cartesian3[] = [];

  for (let i = 0; i <= ORBIT_PATH_STEPS; i++) {
    const t = new Date(baseTime + i * stepSec * 1000);
    try {
      const posVel = propagate(satrec, t);
      if (!posVel || !posVel.position || typeof posVel.position === "boolean") {
        continue;
      }
      const geo = eciToGeodetic(posVel.position, fixedGmst);
      positions.push(
        Cesium.Cartesian3.fromDegrees(
          degreesLong(geo.longitude),
          degreesLat(geo.latitude),
          geo.height * 1000,
        ),
      );
    } catch {
      continue;
    }
  }
  return positions;
}

/**
 * Show the orbit ring for a satellite. Styled like the flight trail: a
 * dashed ("split") polyline in the class accent color, faded (alpha 0.7,
 * 0.3 where it passes behind the globe). Rings exist ONLY while tracking.
 *
 * The ring geometry is baked once in ECEF at a frozen GMST (inertial
 * snapshot) and re-aligned every second by rotating the scratch positions
 * with a rigid Z-rotation; the CallbackProperty hands the rotated array to
 * the dynamic polyline (same per-frame mechanism the flight trail uses).
 */
function _showOrbitPath(noradId: number): void {
  if (_orbitPaths.has(noradId)) return;
  const sat = _catalog.get(noradId);
  if (!sat || !_viewer || !_cesium) return;

  const bakeDate = new Date();
  const baked = computeOrbitPath(sat.satrec, bakeDate);
  if (baked.length < 2) return;

  const scratch = baked.map((p) => Cesium.Cartesian3.clone(p));
  const accent = Cesium.Color.fromCssColorString(satelliteClassColor(sat.group));

  const entity = _viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(
        () => (scratch.length > 1 ? scratch : []),
        false,
      ),
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: accent.withAlpha(0.7),
        dashLength: 16,
        dashPattern: 255,
      }),
      depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
        color: accent.withAlpha(0.3),
        dashLength: 16,
        dashPattern: 255,
      }),
    },
    id: `sat-ring-${noradId}`,
  });

  _orbitPaths.set(noradId, {
    entity,
    baked,
    scratch,
    gmstAtBake: gstime(bakeDate),
  });
}

function _hideOrbitPath(noradId: number): void {
  const path = _orbitPaths.get(noradId);
  if (path && _viewer && !_viewer.isDestroyed()) {
    _viewer.entities.remove(path.entity);
    _orbitPaths.delete(noradId);
  }
}

const _ringRotationMatrix = new Cesium.Matrix3();
const _ringRotationVec = new Cesium.Cartesian3();

/** Rotate every baked ring from its bake-time ECEF snapshot to current GMST. */
function _updateOrbitPathRotations(nowDate: Date): void {
  if (_orbitPaths.size === 0) return;
  for (const path of _orbitPaths.values()) {
    const deltaGmst = gstime(nowDate) - path.gmstAtBake;
    Cesium.Matrix3.fromRotationZ(-deltaGmst, _ringRotationMatrix);
    for (let i = 0; i < path.baked.length; i++) {
      Cesium.Matrix3.multiplyByVector(
        _ringRotationMatrix,
        path.baked[i],
        _ringRotationVec,
      );
      Cesium.Cartesian3.clone(_ringRotationVec, path.scratch[i]);
    }
  }
}

/**
 * Per-frame tracked position: one SGP4 sample per rendered frame, cached by
 * frameState.frameNumber so the entity position callback, detail card, and
 * camera all share one epoch.
 */
function _getTrackedFramePosition(): TrackedFrameGeo | null {
  if (_trackedNorad === null) return null;
  const sat = _catalog.get(_trackedNorad);
  if (!sat) return null;

  const scene = _viewer?.scene as unknown as {
    frameState?: { frameNumber?: number };
  };
  const frameNumber = scene?.frameState?.frameNumber ?? -1;
  if (
    frameNumber === -1 ||
    frameNumber !== _trackedFrameNumber ||
    _trackedFrameGeo === null
  ) {
    const pos = propagatePosition(sat.satrec, new Date());
    if (!pos) return _trackedFrameGeo; // propagation hiccup: keep last good
    _trackedFrameGeo = pos;
    Cesium.Cartesian3.fromDegrees(
      pos.longitude,
      pos.latitude,
      pos.altitude,
      undefined,
      _trackedFrameCartesian,
    );
    _trackedFrameNumber = frameNumber;
  }
  return _trackedFrameGeo;
}

/** Propagate all non-tracked satellites to now and update their visuals. */
function _propagateAll(): void {
  const now = new Date();
  for (const [noradId, sat] of _catalog) {
    if (noradId === _trackedNorad) continue;
    const pos = propagatePosition(sat.satrec, now);
    if (!pos) continue;
    const cartesian = Cesium.Cartesian3.fromDegrees(
      pos.longitude,
      pos.latitude,
      pos.altitude,
    );
    const point = _points.get(noradId);
    if (point) point.position = cartesian;
    const modelEntity = _modelEntities.get(noradId);
    if (modelEntity?.position) {
      (modelEntity.position as Cesium.ConstantPositionProperty).setValue(cartesian);
    }
  }
}

/** Shared preRender tick: fleet propagation + ring GMST re-alignment. */
function _preRenderTick(): void {
  if (!_enabled) return;
  const now = Date.now();
  const interval = _trackedNorad !== null ? TRACKED_UPDATE_MS : POSITION_UPDATE_MS;
  if (now - _lastPropagation >= interval) {
    _propagateAll();
    _lastPropagation = now;
  }
  if (now - _lastRingRotation >= RING_ROTATION_MS) {
    _updateOrbitPathRotations(new Date(now));
    _lastRingRotation = now;
  }
}

/** Stop tracking. skipViewerUntrack when another layer owns the camera. */
function _clearTracking(skipViewerUntrack = false): void {
  if (!_trackedNorad) {
    useGlobeStore.getState().untrackSatellite();
    return;
  }
  const clearedNorad = _trackedNorad;

  // Restore the catalog point with its class style (never lose the palette)
  // and the fleet 3D model entity.
  const point = _points.get(clearedNorad);
  if (point) {
    const style = pointStyleFor(clearedNorad, _catalog.get(clearedNorad)?.group);
    point.show = true;
    point.pixelSize = style.pixelSize;
    point.color = style.color;
    point.outlineWidth = style.outlineWidth;
  }
  const modelEntity = _modelEntities.get(clearedNorad);
  if (modelEntity) modelEntity.show = true;

  _trackedFrameNumber = -1;
  _trackedFrameGeo = null;

  _hideOrbitPath(clearedNorad);
  if (_viewer && !skipViewerUntrack && !_viewer.isDestroyed()) {
    _viewer.trackedEntity = undefined;
  }
  if (_viewer && _trackedEntity && !_viewer.isDestroyed()) {
    _viewer.entities.remove(_trackedEntity);
  }
  _trackedEntity = null;
  _trackedNorad = null;
  useGlobeStore.getState().untrackSatellite();
}

function _trackSatellite(noradId: number): void {
  _clearTracking(false);

  const point = _points.get(noradId);
  const sat = _catalog.get(noradId);
  if (!point || !sat || !_viewer || !_cesium) return;

  _trackedNorad = noradId;
  _trackedFrameNumber = -1;
  _trackedFrameGeo = null;

  // Hide the catalog point AND the fleet model entity: the tracked entity
  // renders the point marker + 3D model.
  point.show = false;
  const trackedModelEntity = _modelEntities.get(noradId);
  if (trackedModelEntity) trackedModelEntity.show = false;

  // Dashed orbit ring in the class accent color (planes trail style).
  _showOrbitPath(noradId);

  const positionProperty = new Cesium.CallbackProperty(() => {
    const pos = _getTrackedFramePosition();
    return pos ? _trackedFrameCartesian : point.position;
  }, false);

  const name = sat.name.trim();

  // Camera landing: ~726 km back for LEO, x4 for MEO/GEO (GEV constants).
  const initialPos = propagatePosition(sat.satrec, new Date());
  const viewScale =
    initialPos && initialPos.altitude > HIGH_ORBIT_ALTITUDE_M
      ? TRACK_VIEW_FROM_HIGH_SCALE
      : 1;
  const viewFrom = Cesium.Cartesian3.multiplyByScalar(
    TRACK_VIEW_FROM_LEO,
    viewScale,
    new Cesium.Cartesian3(),
  );

  const accent = Cesium.Color.fromCssColorString(satelliteClassColor(sat.group));

  // Tracked entity: small yellow point (camera bounding sphere + exact
  // position marker) + the 3D satellite model. Deliberate deviation from
  // GEV's dot-only tracked entity (user decision).
  _trackedEntity = _viewer.entities.add({
    position: positionProperty as unknown as Cesium.PositionProperty,
    viewFrom,
    point: {
      pixelSize: 6,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
      outlineWidth: 1,
    },
    model: {
      uri: MODEL_URL,
      minimumPixelSize: 64,
      maximumScale: 400,
      scale: 1.0,
      silhouetteColor: accent.withAlpha(0.95),
      silhouetteSize: 2.0,
    } as unknown as Cesium.ModelGraphics,
  });

  _viewer.trackedEntity = _trackedEntity;

  const store = useGlobeStore.getState();
  store.trackSatellite(noradId, name);
}

function _onKeyDown(e: KeyboardEvent): void {
  if (_enabled && e.key === "Escape" && _trackedNorad !== null) {
    _clearTracking(false);
  }
}

function _installClickHandler(viewer: Cesium.Viewer): void {
  if (_clickHandler) return;

  // Cross-layer untrack: if another layer (flights) grabs the follow camera,
  // tear down our tracking without touching viewer.trackedEntity.
  if (!_trackedEntityChangedRemove) {
    _trackedEntityChangedRemove = viewer.trackedEntityChanged.addEventListener(
      () => {
        if (!_enabled) return;
        if (
          _trackedNorad !== null &&
          _viewer &&
          !_viewer.isDestroyed() &&
          _viewer.trackedEntity !== _trackedEntity
        ) {
          _clearTracking(true);
        }
      },
    );
  }

  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction(
    (click: { position: Cesium.Cartesian2 }) => {
      if (!_enabled) return;
      const picked = viewer.scene.pick(click.position);

      if (picked) {
        // Clicking the tracked entity itself: ignore.
        if (picked.id === _trackedEntity) return;

        // Satellite points carry their NORAD id as a number.
        const prim = picked.primitive as Cesium.PointPrimitive;
        const noradId = prim?.id as number | undefined;
        if (typeof noradId === "number" && _catalog.has(noradId)) {
          _trackSatellite(noradId);
          return;
        }

        // Fleet 3D model entities: id is `sat-model-${noradId}`.
        const pickedEntityId =
          typeof picked.id === "object" && picked.id !== null
            ? (picked.id as { id?: unknown }).id
            : undefined;
        if (typeof pickedEntityId === "string") {
          if (pickedEntityId.startsWith("sat-model-")) {
            const modelNorad = Number(pickedEntityId.slice("sat-model-".length));
            if (_catalog.has(modelNorad)) {
              _trackSatellite(modelNorad);
              return;
            }
          }
          // Clicking the orbit ring must not untrack (it surrounds the sat).
          if (pickedEntityId.startsWith("sat-ring-")) return;
        }
      }

      // Empty space (or another layer's object we don't own): deselect.
      if (_trackedNorad !== null) {
        _clearTracking(false);
      }
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  );

  _keyListener = _onKeyDown;
  document.addEventListener("keydown", _keyListener);
}

function _removeClickHandler(): void {
  if (_clickHandler) {
    _clickHandler.destroy();
    _clickHandler = null;
  }
  if (_trackedEntityChangedRemove) {
    _trackedEntityChangedRemove();
    _trackedEntityChangedRemove = null;
  }
  if (_keyListener) {
    document.removeEventListener("keydown", _keyListener);
    _keyListener = null;
  }
}

/** Fetch every core group in parallel, parse, dedupe by NORAD (first wins). */
async function _loadCatalog(): Promise<number> {
  const results = await Promise.all(
    CATALOG_GROUPS.map(async (group) => {
      try {
        const res = await fetch(`/api/celestrak/${group}`);
        if (!res.ok) return { group, entries: [], ok: false };
        const text = await res.text();
        return { group, entries: parseTLE(text), ok: true };
      } catch {
        return { group, entries: [], ok: false };
      }
    }),
  );

  const failed = results.filter((r) => !r.ok).map((r) => r.group);
  if (results.every((r) => !r.ok)) {
    throw new Error("CelesTrak unreachable: all groups failed");
  }
  _lastError = failed.length ? `${failed.length} group(s) unavailable` : null;

  const now = new Date();
  const seen = new Set<number>();
  let added = 0;

  for (const result of results) {
    for (const entry of result.entries) {
      let satrec: ReturnType<typeof twoline2satrec>;
      try {
        satrec = twoline2satrec(entry.line1, entry.line2);
      } catch {
        continue;
      }
      if (!satrec || satrec.error !== 0) continue;
      const noradId = Number(satrec.satnum);
      if (seen.has(noradId)) continue;
      seen.add(noradId);

      const pos = propagatePosition(satrec, now);
      if (!pos) continue;

      _catalog.set(noradId, {
        name: entry.name,
        satrec,
        group: result.group,
      });

      const style = pointStyleFor(noradId, result.group);
      const point = _pointCollection!.add({
        position: Cesium.Cartesian3.fromDegrees(
          pos.longitude,
          pos.latitude,
          pos.altitude,
        ),
        pixelSize: style.pixelSize,
        color: style.color,
        outlineColor: POINT_OUTLINE,
        outlineWidth: style.outlineWidth,
        scaleByDistance: new Cesium.NearFarScalar(1e6, 1.5, 2e7, 0.6),
        // Points render when the camera is far; the 3D model takes over close.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
          MODEL_DDC_METERS,
          Number.POSITIVE_INFINITY,
        ),
        id: noradId,
      });
      _points.set(noradId, point);

      // Fleet 3D model entity (planes rule: recognizable 3D object when the
      // camera is close, point texture when far). Shares the position value
      // with the point; updated in _propagateAll.
      const modelEntity = _viewer!.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          pos.longitude,
          pos.latitude,
          pos.altitude,
        ),
        model: {
          uri: MODEL_URL,
          minimumPixelSize: 16,
          maximumScale: 100,
          scale: 1.0,
          silhouetteColor: Cesium.Color.fromCssColorString(
            satelliteClassColor(result.group),
          ).withAlpha(0.95),
          silhouetteSize: 1.5,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
            0,
            MODEL_DDC_METERS,
          ),
        } as unknown as Cesium.ModelGraphics,
        id: `sat-model-${noradId}`,
      });
      _modelEntities.set(noradId, modelEntity);
      added++;
    }
  }

  return added;
}

/**
 * Find a satellite by NORAD id (numeric string) or case-insensitive name
 * substring in the loaded catalog. Fresh SGP4 propagation on hit.
 */
export function satellitesFindByQuery(query: string): {
  noradId: number;
  name: string;
  group: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
} | null {
  const q = String(query ?? "").trim();
  if (!q || _catalog.size === 0) return null;

  let noradId: number | null = null;
  if (/^\d+$/.test(q) && _catalog.has(Number(q))) {
    noradId = Number(q);
  } else {
    const lower = q.toLowerCase();
    for (const [id, sat] of _catalog) {
      if (sat.name.toLowerCase().includes(lower)) {
        noradId = id;
        break;
      }
    }
  }
  if (noradId === null) return null;

  const sat = _catalog.get(noradId)!;
  const pos = propagatePosition(sat.satrec, new Date());
  if (!pos) return null;
  return {
    noradId,
    name: sat.name.trim(),
    group: sat.group,
    latitude: pos.latitude,
    longitude: pos.longitude,
    altitudeM: pos.altitude,
  };
}

/** Track a satellite by NORAD id. Returns false if not in the catalog. */
export function satellitesTrackById(noradId: number): boolean {
  const id = Number(noradId);
  if (!Number.isFinite(id) || !_catalog.has(id) || !_points.has(id)) {
    return false;
  }
  _trackSatellite(id);
  return _trackedNorad === id;
}

/** Stop tracking (no-op if none). */
export function satellitesStopTracking(): void {
  _clearTracking(false);
}

// Earth constants for orbital readouts.
const EARTH_RADIUS_KM = 6371;
const MU_KM3_S2 = 398600.4418;

/**
 * Derive orbital parameters from a satrec + current altitude. Static per
 * satellite except footprint (depends on current altitude).
 */
function orbitalReadout(
  satrec: ReturnType<typeof twoline2satrec>,
  altitudeM: number,
): {
  periodSec: number;
  inclinationDeg: number;
  apoapsisKm: number;
  periapsisKm: number;
  orbitClass: string;
  footprintKm: number;
  intlDesig: string;
  tleAgeDays: number;
} {
  const nRadSec = satrec.no / 60; // satrec.no is rad/min
  const periodSec = (2 * Math.PI) / Math.max(nRadSec, 1e-9);
  const semiMajorKm = Math.cbrt(MU_KM3_S2 / Math.max(nRadSec * nRadSec, 1e-18));
  const ecc = satrec.ecco ?? 0;
  const apoapsisKm = semiMajorKm * (1 + ecc) - EARTH_RADIUS_KM;
  const periapsisKm = semiMajorKm * (1 - ecc) - EARTH_RADIUS_KM;

  const altKm = altitudeM / 1000;
  let orbitClass = "LEO";
  if (Math.abs(altKm - 35786) < 1500) orbitClass = "GEO";
  else if (ecc > 0.25) orbitClass = "HEO";
  else if (altKm > 2000) orbitClass = "MEO";

  // Horizon footprint radius (visibility circle on the ground).
  const h = Math.max(altKm, 1);
  const footprintKm = Math.sqrt(2 * EARTH_RADIUS_KM * h + h * h);

  const intlDesig = String((satrec as { intldesg?: string }).intldesg ?? "").trim();

  let tleAgeDays: number | null = null;
  const jd = satrec.jdsatepoch;
  if (typeof jd === "number" && Number.isFinite(jd)) {
    const epochMs = (jd - 2440587.5) * 86400000;
    tleAgeDays = (Date.now() - epochMs) / 86400000;
  }

  return {
    periodSec,
    inclinationDeg: (satrec.inclo ?? 0) * (180 / Math.PI),
    apoapsisKm,
    periapsisKm,
    orbitClass,
    footprintKm,
    intlDesig,
    tleAgeDays: tleAgeDays ?? 0,
  };
}

/**
 * Sunlight state: cylindrical Earth-shadow test. Satellite position comes
 * from the same SGP4 epoch as the readout; sun direction from Cesium's
 * analytical ephemeris (ICRF, close enough to TEME for a shadow test).
 */
function sunlitState(
  satrec: ReturnType<typeof twoline2satrec>,
  date: Date,
): "SUNLIT" | "ECLIPSE" | "UNKNOWN" {
  try {
    const posVel = propagate(satrec, date);
    if (
      !posVel ||
      !posVel.position ||
      typeof posVel.position === "boolean" ||
      !_cesium
    ) {
      return "UNKNOWN";
    }
    const sunEci = _cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      _cesium.JulianDate.fromDate(date),
    );
    if (!sunEci) return "UNKNOWN";
    // Work in meters; SGP4 returns km.
    const sx = posVel.position.x * 1000;
    const sy = posVel.position.y * 1000;
    const sz = posVel.position.z * 1000;
    const sunMag = Math.sqrt(
      sunEci.x * sunEci.x + sunEci.y * sunEci.y + sunEci.z * sunEci.z,
    );
    const ux = sunEci.x / sunMag;
    const uy = sunEci.y / sunMag;
    const uz = sunEci.z / sunMag;
    const proj = sx * ux + sy * uy + sz * uz;
    if (proj >= 0) return "SUNLIT"; // sunward side of Earth
    const px = sx - proj * ux;
    const py = sy - proj * uy;
    const pz = sz - proj * uz;
    const perpDist = Math.sqrt(px * px + py * py + pz * pz);
    return perpDist < 6371000 ? "ECLIPSE" : "SUNLIT";
  } catch {
    return "UNKNOWN";
  }
}

/** Live readout for the tracked satellite (frame-cached SGP4 + orbit data). */
export function satellitesGetTrackedInfo(): {
  noradId: number;
  name: string;
  group: string;
  classLabel: string;
  classColor: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  speedMps: number | null;
  periodSec: number;
  inclinationDeg: number;
  apoapsisKm: number;
  periapsisKm: number;
  orbitClass: string;
  footprintKm: number;
  sunlit: "SUNLIT" | "ECLIPSE" | "UNKNOWN";
  intlDesig: string;
  tleAgeDays: number;
} | null {
  if (_trackedNorad === null) return null;
  const sat = _catalog.get(_trackedNorad);
  if (!sat) return null;
  const pos = _getTrackedFramePosition();
  if (!pos) return null;

  const readout = orbitalReadout(sat.satrec, pos.altitude);
  const sunlit = sunlitState(sat.satrec, new Date());

  return {
    noradId: _trackedNorad,
    name: sat.name.trim(),
    group: sat.group,
    classLabel: satelliteClassLabel(sat.group, { isIss: _trackedNorad === ISS_NORAD }),
    classColor: satelliteClassColor(sat.group),
    latitude: pos.latitude,
    longitude: pos.longitude,
    altitudeM: pos.altitude,
    speedMps: pos.speedMps,
    periodSec: readout.periodSec,
    inclinationDeg: readout.inclinationDeg,
    apoapsisKm: readout.apoapsisKm,
    periapsisKm: readout.periapsisKm,
    orbitClass: readout.orbitClass,
    footprintKm: readout.footprintKm,
    sunlit,
    intlDesig: readout.intlDesig,
    tleAgeDays: readout.tleAgeDays,
  };
}

/** Number of satellites currently in the catalog. */
export function satellitesGetCount(): number {
  return _count;
}

// Scratch vectors for the visibility test (avoid per-frame allocation).
const _scratchNormal = new Cesium.Cartesian3();
const _scratchToCam = new Cesium.Cartesian3();

/** True if a position is on the near side of the globe from the camera. */
function _isVisibleFromCamera(
  pos: Cesium.Cartesian3,
  cameraPos: Cesium.Cartesian3,
): boolean {
  Cesium.Cartesian3.normalize(pos, _scratchNormal);
  Cesium.Cartesian3.subtract(cameraPos, pos, _scratchToCam);
  Cesium.Cartesian3.normalize(_scratchToCam, _scratchToCam);
  return Cesium.Cartesian3.dot(_scratchNormal, _scratchToCam) > 0;
}

/**
 * On-screen satellite positions for the corner-bracket overlay. Renders at
 * every zoom level while the layer is enabled (user-requested). The tracked
 * satellite is excluded (it gets its own brighter bracket).
 */
export function satellitesGetBracketTargets(): Array<{
  noradId: number;
  position: Cesium.Cartesian3;
}> {
  if (!_enabled || !_viewer || _viewer.isDestroyed()) return [];
  const cameraPos = _viewer.camera.positionWC;
  const out: Array<{ noradId: number; position: Cesium.Cartesian3 }> = [];
  for (const [noradId, point] of _points) {
    if (noradId === _trackedNorad) continue;
    if (!point.show || !point.position) continue;
    if (!_isVisibleFromCamera(point.position, cameraPos)) continue;
    out.push({ noradId, position: point.position });
  }
  return out;
}

/** Resolve a famous-satellite entry to a NORAD id in the catalog, or null. */
export function satellitesResolveFamous(entry: FamousSatellite): number | null {
  if (entry.noradId !== undefined && _catalog.has(entry.noradId)) {
    return entry.noradId;
  }
  if (!entry.group) return null;
  const candidates: string[] = [
    ...(entry.nameIncludes ?? []),
    ...(entry.nameFallbacks ?? []),
  ];
  for (const needle of candidates) {
    for (const [id, sat] of _catalog) {
      if (sat.group !== entry.group) continue;
      if (sat.name.toUpperCase().includes(needle.toUpperCase())) return id;
    }
  }
  return null;
}

/**
 * Wikipedia URL for a tracked NORAD id, if it matches a curated famous
 * satellite. Returns null for non-famous satellites (no INFO button shown).
 */
export function satellitesGetWikipediaUrl(noradId: number): string | null {
  const id = Number(noradId);
  if (!Number.isFinite(id)) return null;
  for (const entry of FAMOUS_SATELLITES) {
    if (!entry.wikipedia) continue;
    if (entry.noradId !== undefined) {
      if (entry.noradId === id) return entry.wikipedia;
      continue;
    }
    // Group/name-based entries: resolve and compare.
    const resolved = satellitesResolveFamous(entry);
    if (resolved === id) return entry.wikipedia;
  }
  return null;
}

export const satellitesLayer: LayerImpl = {
  async enable(ctx: LayerContext): Promise<void> {
    const { viewer, Cesium: CesiumLib } = ctx;
    _viewer = viewer;
    _cesium = CesiumLib;
    _enabled = true;

    _catalog = new Map();
    _points = new Map();
    _modelEntities = new Map();
    _orbitPaths = new Map();
    _trackedNorad = null;
    _trackedEntity = null;
    _trackedFrameNumber = -1;
    _trackedFrameGeo = null;
    _lastError = null;

    // A previously failed enable may have left a collection behind: remove
    // it before adding a fresh one so retries never double-render.
    if (_pointCollection && !viewer.isDestroyed()) {
      try {
        viewer.scene.primitives.remove(_pointCollection);
      } catch {
        // Already gone.
      }
    }
    _pointCollection = viewer.scene.primitives.add(
      new Cesium.PointPrimitiveCollection(),
    );

    const added = await _loadCatalog();
    _count = added;

    _installClickHandler(viewer);
    if (!_preRenderListener) {
      _preRenderListener = viewer.scene.preRender.addEventListener(() => {
        _preRenderTick();
      });
    }
    governorHold(GOV_HOLD_ID);
    governorRequestRender(GOV_HOLD_ID);
  },

  disable(ctx: LayerContext): void {
    const { viewer } = ctx;
    _enabled = false;

    _clearTracking(false);
    _removeClickHandler();

    if (_preRenderListener) {
      _preRenderListener();
      _preRenderListener = null;
    }
    governorRelease(GOV_HOLD_ID);

    for (const path of _orbitPaths.values()) {
      try {
        viewer.entities.remove(path.entity);
      } catch {
        // Already gone.
      }
    }
    _orbitPaths.clear();
    for (const entity of _modelEntities.values()) {
      try {
        viewer.entities.remove(entity);
      } catch {
        // Already gone.
      }
    }
    _modelEntities.clear();
    if (_pointCollection) {
      try {
        viewer.scene.primitives.remove(_pointCollection);
      } catch {
        // Already gone.
      }
      _pointCollection = null;
    }
    _points.clear();
    _catalog.clear();
    _count = 0;
    _viewer = null;
    _cesium = null;
  },
};
