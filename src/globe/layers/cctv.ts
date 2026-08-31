import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "./types";
import type { CctvCamera } from "@/lib/sources/cctv";
import { hashHeadingDeg } from "@/lib/sources/cctv";
import { useGlobeStore } from "@/store/globe-store";
import { CITY_COORDS } from "@/lib/city-coords";

// CCTV layer: renders cameras as ground-clamped ellipse entities (like
// earthquakes), filtered by the active city and enabled providers. The
// catalog is loaded by page.tsx and shared via the store; this layer just
// reads from it and re-filters when the city or source toggles change.
// Tags (black bg cards with accent bar + leader line) are drawn by the
// CctvOverlay canvas component, which also handles click-to-select.
// The selected camera gets a sphere body + square pyramid frustum (POV)
// oriented to its heading, and trackedCamera is set in the store so
// CctvDetailPanel shows in the right rail.

const CCTV_ACCENT = "#00d4ff";
const CCTV_ACCENT_DIM = "#5ab3d4";
const CONE_COLOR = Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 90);
const CONE_FILL_COLOR = Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 24);
const CONE_DISTANCE = 45;
const POLE_HEIGHT = 6;
const FLY_TO_ALTITUDE = 500;
const CITY_BBOX_DEG = 0.5;
const ELLIPSE_RADIUS = 120; // meters, ground-clamped dot (unused, kept for ref)
// Procedural 3D camera model dimensions (meters).
const SPHERE_RADIUS = 0.6;

interface CctvLayerState {
  cameras: CctvCamera[];
  selectedId: string | null;
}

const _state: CctvLayerState = {
  cameras: [],
  selectedId: null,
};

let _viewer: Cesium.Viewer | null = null;
let _dataSource: Cesium.CustomDataSource | null = null;
let _cones: Cesium.PolylineCollection | null = null;
let _modelEntities: Cesium.Entity[] = [];
let _coneFillEntity: Cesium.Entity | null = null;
let _storeUnsub: (() => void) | null = null;
let _enabled = false;
let _cameraById = new Map<string, CctvCamera>();

function enuToFixed(
  frame: Cesium.Matrix4,
  e: number,
  n: number,
  u: number,
): Cesium.Cartesian3 {
  return Cesium.Matrix4.multiplyByPoint(
    frame,
    new Cesium.Cartesian3(e, n, u),
    new Cesium.Cartesian3(),
  );
}

// Builds the wireframe edges of the camera POV frustum: apex at the sphere,
// base square D meters ahead along headingDeg, half-size D*tan(fov/2).
function buildFrustumEdges(
  lonRad: number,
  latRad: number,
  headingDeg: number,
  fovDeg: number,
): Cesium.Cartesian3[][] {
  const h = (headingDeg * Math.PI) / 180;
  const half = (fovDeg * Math.PI) / 360;
  const D = CONE_DISTANCE;
  const W = D * Math.tan(half);

  const apex = Cesium.Cartesian3.fromRadians(lonRad, latRad, POLE_HEIGHT);
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromRadians(lonRad, latRad, 0),
  );

  const vE = Math.sin(h);
  const vN = Math.cos(h);
  const rE = Math.cos(h);
  const rN = -Math.sin(h);
  const cE = vE * D;
  const cN = vN * D;

  const corners = [
    enuToFixed(frame, cE + rE * W, cN + rN * W, W),
    enuToFixed(frame, cE + rE * W, cN + rN * W, -W),
    enuToFixed(frame, cE - rE * W, cN - rN * W, -W),
    enuToFixed(frame, cE - rE * W, cN - rN * W, W),
  ];

  return [
    [apex, corners[0]],
    [apex, corners[1]],
    [apex, corners[2]],
    [apex, corners[3]],
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
}

// Builds the 4 corner positions for the frustum fill polygon.
function buildFrustumCorners(
  lonRad: number,
  latRad: number,
  headingDeg: number,
  fovDeg: number,
): Cesium.Cartesian3[] {
  const h = (headingDeg * Math.PI) / 180;
  const half = (fovDeg * Math.PI) / 360;
  const D = CONE_DISTANCE;
  const W = D * Math.tan(half);

  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromRadians(lonRad, latRad, 0),
  );

  const vE = Math.sin(h);
  const vN = Math.cos(h);
  const rE = Math.cos(h);
  const rN = -Math.sin(h);
  const cE = vE * D;
  const cN = vN * D;

  return [
    enuToFixed(frame, cE + rE * W, cN + rN * W, W),
    enuToFixed(frame, cE + rE * W, cN + rN * W, -W),
    enuToFixed(frame, cE - rE * W, cN - rN * W, -W),
    enuToFixed(frame, cE - rE * W, cN - rN * W, W),
  ];
}

// Clears the 3D model + cone for the currently selected camera.
function clearSelectedModel(): void {
  if (!_viewer) return;
  for (const e of _modelEntities) {
    try { _viewer.entities.remove(e); } catch { /* already gone */ }
  }
  _modelEntities = [];
  if (_coneFillEntity) {
    try { _viewer.entities.remove(_coneFillEntity); } catch { /* gone */ }
    _coneFillEntity = null;
  }
  if (_cones) {
    _cones.removeAll();
  }
}

// Builds the procedural 3D camera model (sphere body) + translucent square
// pyramid frustum for the selected camera.
function showSelectedModel(cam: CctvCamera): void {
  if (!_viewer) return;
  clearSelectedModel();

  const headingDeg = cam.headingDeg ?? hashHeadingDeg(cam.id);
  const fovDeg = cam.fovDeg ?? 60;
  const lonRad = (cam.lon * Math.PI) / 180;
  const latRad = (cam.lat * Math.PI) / 180;

  // Position at pole height.
  const position = Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, POLE_HEIGHT);

  // Sphere body: centered at the camera position.
  const sphereEntity = _viewer.entities.add({
    name: `${cam.name} - body`,
    position: position,
    ellipsoid: {
      radii: new Cesium.Cartesian3(SPHERE_RADIUS, SPHERE_RADIUS, SPHERE_RADIUS),
      material: Cesium.Color.fromCssColorString("#0e1720").withAlpha(0.9),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#00d4ff"),
      outlineWidth: 1.5,
    },
  });
  _modelEntities.push(sphereEntity);

  // Square pyramid frustum wireframe edges.
  if (_cones) {
    const edges = buildFrustumEdges(lonRad, latRad, headingDeg, fovDeg);
    for (const positions of edges) {
      _cones.add({
        positions,
        width: 1.5,
        color: CONE_COLOR,
      });
    }
  }

  // Translucent frustum fill polygon (square pyramid base).
  const corners = buildFrustumCorners(lonRad, latRad, headingDeg, fovDeg);
  _coneFillEntity = _viewer.entities.add({
    name: `${cam.name} - fov`,
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(corners),
      material: CONE_FILL_COLOR,
      outline: false,
      perPositionHeight: true,
    },
  });

  _viewer.scene.requestRender();
}

// Renders all cameras as ground-clamped ellipse entities in the data source.
function renderCameras(cameras: CctvCamera[]): void {
  if (!_dataSource) return;

  _dataSource.entities.removeAll();
  _cameraById.clear();

  for (const cam of cameras) {
    _cameraById.set(cam.id, cam);
    const isSelected = _state.selectedId === cam.id;

    _dataSource.entities.add({
      id: `cctv:${cam.id}`,
      position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat),
      properties: {
        camId: cam.id,
        name: cam.name,
        provider: cam.provider,
        region: cam.region,
        lat: cam.lat,
        lon: cam.lon,
        headingDeg: cam.headingDeg ?? null,
        fovDeg: cam.fovDeg ?? null,
        isSensitive: cam.isSensitive ?? false,
        isOnline: cam.isOnline ?? true,
        snapshotUrl: cam.snapshotUrl ?? null,
        streamUrl: cam.streamUrl ?? null,
        embedUrl: cam.embedUrl ?? null,
        category: cam.category ?? null,
        selected: isSelected,
      },
    });
  }

  if (_viewer) _viewer.scene.requestRender();
}

// Filters the full catalog by active city + enabled sources, then renders.
// Called when the catalog loads, the active city changes, or a source is
// toggled. If no city is active or no sources are enabled, renders nothing.
// Also publishes per-source counts for the active city so the right panel
// source list can show counts and sort by them.
function pushFilteredCctv(): void {
  if (!_enabled || !_viewer || _viewer.isDestroyed()) return;
  const { cctvCameras, cctvSources, activeCity } = useGlobeStore.getState();

  // No city selected: show nothing. Cameras only render per-city.
  if (!activeCity) {
    _state.cameras = [];
    renderCameras([]);
    useGlobeStore.getState().setCctvSourceCounts({});
    return;
  }

  const coord = CITY_COORDS[activeCity];
  if (!coord) {
    _state.cameras = [];
    renderCameras([]);
    useGlobeStore.getState().setCctvSourceCounts({});
    return;
  }

  // Territory filter: bound to ~0.5 deg around the active city.
  const d = CITY_BBOX_DEG;
  const cityCams = cctvCameras.filter(
    (c) =>
      c.lat >= coord.lat - d &&
      c.lat <= coord.lat + d &&
      c.lon >= coord.lon - d &&
      c.lon <= coord.lon + d,
  );

  // Publish per-source counts for the current city (from all cameras in
  // the bbox, regardless of whether the source is enabled). This lets the
  // source list show available cameras per provider.
  const counts: Record<string, number> = {};
  for (const c of cityCams) {
    counts[c.provider] = (counts[c.provider] ?? 0) + 1;
  }
  useGlobeStore.getState().setCctvSourceCounts(counts);

  // Source filter: only keep cameras from enabled providers.
  const cams = cityCams.filter((c) => cctvSources[c.provider] !== false);

  _state.cameras = cams;
  renderCameras(cams);

  // If the selected camera is no longer in the filtered set, clear it.
  if (_state.selectedId && !cams.some((c) => c.id === _state.selectedId)) {
    clearSelection();
  }
}

// Selects a camera: fly to it (straight down, centered), show 3D model +
// cone, set trackedCamera in store. Called by CctvOverlay when a tag is
// clicked. No heading rotation or pitch: just zoom straight to 500m above
// the camera, looking straight down.
export function selectCamera(cam: CctvCamera): void {
  if (!_viewer) return;

  // Clear previous selection.
  clearSelectedModel();
  _state.selectedId = cam.id;

  // Update entity properties to mark as selected.
  const entity = _dataSource?.entities.getById(`cctv:${cam.id}`);
  if (entity?.properties) {
    entity.properties.selected = new Cesium.ConstantProperty(true);
  }

  // Fly straight to the camera: 500m altitude, looking straight down (no
  // heading rotation, no pitch). This centers the camera on the tag.
  const destination = Cesium.Cartesian3.fromDegrees(
    cam.lon,
    cam.lat,
    FLY_TO_ALTITUDE,
  );

  _viewer.scene.screenSpaceCameraController.enableInputs = false;
  _viewer.camera.flyTo({
    destination,
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
    },
    duration: 1.5,
    complete: () => {
      _viewer!.scene.screenSpaceCameraController.enableInputs = true;
      showSelectedModel(cam);
    },
    cancel: () => {
      _viewer!.scene.screenSpaceCameraController.enableInputs = true;
      showSelectedModel(cam);
    },
  });

  // Set in store so CctvDetailPanel shows.
  useGlobeStore.getState().trackCamera(cam);
}

// Clears the current selection: clear 3D model, clear store.
export function clearSelection(): void {
  // Update entity properties to unmark selection.
  if (_state.selectedId && _dataSource) {
    const entity = _dataSource.entities.getById(`cctv:${_state.selectedId}`);
    if (entity?.properties) {
      entity.properties.selected = new Cesium.ConstantProperty(false);
    }
  }
  _state.selectedId = null;
  clearSelectedModel();
  useGlobeStore.getState().untrackCamera();
}

// Exposed for the CctvOverlay canvas component to read the filtered cameras.
export function getCctvCameras(): CctvCamera[] {
  return _state.cameras;
}

// Exposed for the CctvOverlay to look up a camera by id.
export function getCctvCameraById(id: string): CctvCamera | undefined {
  return _cameraById.get(id);
}

export const cctvLayer: LayerImpl = {
  entities: [] as Cesium.Entity[],

  async enable(ctx: LayerContext): Promise<void> {
    const { viewer, Cesium: CesiumLib } = ctx;
    _viewer = viewer;
    _enabled = true;

    // Create the CustomDataSource for ground-clamped ellipse entities.
    if (!_dataSource) {
      _dataSource = new CesiumLib.CustomDataSource("cctv");
      _dataSource.show = false;
      await viewer.dataSources.add(_dataSource);
    }
    _dataSource.show = true;

    // Create polyline collection for frustum wireframe edges.
    _cones = viewer.scene.primitives.add(new CesiumLib.PolylineCollection());

    // The catalog is loaded by page.tsx and shared via the store. Push the
    // initial filtered set (may be empty if no city or no sources enabled).
    pushFilteredCctv();

    // Subscribe to store: re-filter when catalog, sources, or city changes.
    // Also handle external trackedCamera clears (e.g. selecting a flight).
    if (!_storeUnsub) {
      let prevCctvCameras = useGlobeStore.getState().cctvCameras;
      let prevCctvSources = useGlobeStore.getState().cctvSources;
      let prevActiveCity = useGlobeStore.getState().activeCity;
      _storeUnsub = useGlobeStore.subscribe((state) => {
        // Re-filter when catalog, sources, or city change.
        if (
          state.cctvCameras !== prevCctvCameras ||
          state.cctvSources !== prevCctvSources ||
          state.activeCity !== prevActiveCity
        ) {
          prevCctvCameras = state.cctvCameras;
          prevCctvSources = state.cctvSources;
          prevActiveCity = state.activeCity;
          pushFilteredCctv();
        }
        // External clear of trackedCamera: revert our visual selection.
        if (!state.trackedCamera && _state.selectedId) {
          _state.selectedId = null;
          clearSelectedModel();
        }
      });
    }

    viewer.scene.requestRender();
  },

  disable(ctx: LayerContext): void {
    const { viewer } = ctx;
    _enabled = false;

    // Clear selection.
    if (_state.selectedId) {
      clearSelection();
    }

    // Hide and clear the data source.
    if (_dataSource) {
      _dataSource.show = false;
      _dataSource.entities.removeAll();
    }

    // Remove polyline collection.
    if (_cones) {
      viewer.scene.primitives.remove(_cones);
      _cones = null;
    }

    // Clear 3D model entities.
    clearSelectedModel();

    // Unsubscribe from store.
    if (_storeUnsub) {
      _storeUnsub();
      _storeUnsub = null;
    }

    // Clear maps.
    _cameraById.clear();
    _state.cameras = [];
    _state.selectedId = null;

    viewer.scene.requestRender();
  },

  // Exposed for the right-panel browse list.
  getTopCameras(limit = 10): CctvCamera[] {
    if (!_enabled || _state.cameras.length === 0) return [];
    // Prefer cameras with feeds (snapshot or stream).
    const withFeeds = _state.cameras.filter(
      (c) => c.snapshotUrl || c.streamUrl || c.embedUrl,
    );
    return withFeeds.slice(0, limit);
  },

  getStats() {
    return { count: _state.cameras.length, selectedId: _state.selectedId };
  },
};
