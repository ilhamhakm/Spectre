// Cesium radio engine: station markers, clustering, pick handling, camera
// fly-to, and the camera-move tick that re-reconciles label visibility.
// Faithful port of GEV's radio.js rendering/interaction path, adapted to
// Spectre V2's CustomDataSource + ScreenSpaceEventHandler idiom (mirrors
// the earthquakes layer) and the Zustand store.

"use client";

import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "@/globe/layers/types";
import { useGlobeStore } from "@/store/globe-store";
import { useRadioStore } from "./radio-store";
import type { RadioStation } from "./radio-types";
import {
  buildRadioCategories,
  filterRadioStations,
  radioCategoryColor,
  radioStationCategoryId,
} from "./radio-categories";
import {
  GLOBAL_RADIO_ALTITUDE_M,
  radioViewIsGlobal,
  rankRadioStationsForViewport,
} from "./radio-cluster";
import {
  ensureRadioAudio,
  playSelectedRadio,
  stopRadioPlayback,
  destroyRadioAudio,
} from "./radio-playback";

const RADIO_PREFIX = "radio:";
const MARKER_LIFT_M = 2.5;
const SELECTED_LIFT_M = 5;
const RADIO_DIRECTORY_ENDPOINT = "/api/radio/stations";
const RADIO_POLL_MS = 45 * 60 * 1000;
const CLUSTER_PIXEL_THRESHOLD = 48;

let _viewer: Cesium.Viewer | null = null;
let _dataSource: Cesium.CustomDataSource | null = null;
let _enabled = false;
let _clickHandler: Cesium.ScreenSpaceEventHandler | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _selectedEntity: Cesium.Entity | null = null;
let _requestGeneration = 0;
let _stationById = new Map<string, RadioStation>();

/** Plan a station-centered camera move preserving altitude and view angle. */
function radioStationCameraPlan(
  station: RadioStation,
  cameraState: { height?: number; heading?: number; pitch?: number; roll?: number },
): { lat: number; lon: number; height: number; heading: number; pitch: number; roll: number } | null {
  const targetLat = Number(station?.lat);
  const targetLon = Number(station?.lon);
  const height = Math.max(1, Number(cameraState.height) || 1);
  const heading = Number.isFinite(cameraState.heading as number) ? (cameraState.heading as number) : 0;
  const pitch = Number.isFinite(cameraState.pitch as number) ? (cameraState.pitch as number) : -Math.PI / 2;
  const roll = Number.isFinite(cameraState.roll as number) ? (cameraState.roll as number) : 0;
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null;

  const downAngle = Math.min(Math.PI / 2, Math.max(0.08, Math.abs(Math.min(-0.001, pitch))));
  const groundOffsetM =
    downAngle > Math.PI / 2 - 1e-6
      ? 0
      : Math.min(2_000_000, height / Math.max(0.08, Math.tan(downAngle)));
  const angularDistance = groundOffsetM / 6_378_137;
  const targetLatRad = (targetLat * Math.PI) / 180;
  const cameraBearing = heading + Math.PI;
  const cameraLatRad = Math.asin(
    Math.sin(targetLatRad) * Math.cos(angularDistance) +
      Math.cos(targetLatRad) * Math.sin(angularDistance) * Math.cos(cameraBearing),
  );
  const cameraLonRad =
    (targetLon * Math.PI) / 180 +
    Math.atan2(
      Math.sin(cameraBearing) * Math.sin(angularDistance) * Math.cos(targetLatRad),
      Math.cos(angularDistance) - Math.sin(targetLatRad) * Math.sin(cameraLatRad),
    );
  const cameraLon = ((cameraLonRad * 180) / Math.PI + 540) % 360 - 180;
  return {
    lat: (cameraLatRad * 180) / Math.PI,
    lon: cameraLon,
    height,
    heading,
    pitch,
    roll,
  };
}

function markerPosition(
  cesium: typeof Cesium,
  station: RadioStation,
  liftM = MARKER_LIFT_M,
): Cesium.Cartesian3 {
  return cesium.Cartesian3.fromDegrees(station.lon, station.lat, liftM);
}

function viewportAnchor(viewer: Cesium.Viewer): {
  lat: number;
  lon: number;
  altitudeM: number;
  globalView: boolean;
} | null {
  const camera = viewer.camera;
  const scene = viewer.scene;
  const altitudeM = Number(camera.positionCartographic?.height);
  let cartographic: Cesium.Cartographic | null = null;
  const canvas = scene.canvas;
  if (canvas && typeof camera.pickEllipsoid === "function") {
    const center = new Cesium.Cartesian2(
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
    );
    const position = camera.pickEllipsoid(
      center,
      scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84,
    );
    if (position) cartographic = Cesium.Cartographic.fromCartesian(position);
  }
  cartographic ||= camera.positionCartographic || null;
  if (!cartographic) return null;
  return {
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lon: Cesium.Math.toDegrees(cartographic.longitude),
    altitudeM,
    globalView: radioViewIsGlobal(altitudeM),
  };
}

function renderStations(cesium: typeof Cesium, stations: RadioStation[]): void {
  if (!_dataSource) return;
  _dataSource.entities.removeAll();
  _stationById = new Map(stations.map((s) => [s.id, s]));
  for (const station of stations) {
    const categoryId = radioStationCategoryId(station);
    const colorCss = radioCategoryColor(categoryId);
    const color = cesium.Color.fromCssColorString(colorCss);
    const entity = _dataSource.entities.add({
      id: `${RADIO_PREFIX}${station.id}`,
      position: markerPosition(cesium, station),
      point: {
        pixelSize: 8,
        color,
        outlineColor: cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new cesium.NearFarScalar(1e6, 1.4, 2e7, 0.6),
        translucencyByDistance: new cesium.NearFarScalar(1e6, 1, 2e7, 0.7),
      },
      properties: {
        stationId: station.id,
        categoryId,
      },
    });
    // Tag the entity for the RadioOverlay canvas component (infra-style cards).
    (entity as { __labelText?: string }).__labelText = station.name;
    (entity as { __priority?: number }).__priority = station.clickCount;
    (entity as { __radioCategory?: string }).__radioCategory = categoryId;
    (entity as { __radioColor?: string }).__radioColor = colorCss;
    (entity as { __radioCountry?: string }).__radioCountry = station.country;
  }
}

function installClickHandler(viewer: Cesium.Viewer): void {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction(
    (click: { position: Cesium.Cartesian2 }) => {
      if (!_enabled || !_dataSource) return;
      const picked = viewer.scene.pick(click.position);
      const pickedId = (picked as { id?: unknown })?.id;
      if (!pickedId || typeof pickedId !== "object") {
        if (useRadioStore.getState().selectedId) {
          useRadioStore.getState().selectStation(null);
        }
        return;
      }
      const entityId = (pickedId as { id?: unknown }).id;
      if (
        typeof entityId !== "string" ||
        !entityId.startsWith(RADIO_PREFIX)
      ) {
        if (useRadioStore.getState().selectedId) {
          useRadioStore.getState().selectStation(null);
        }
        return;
      }
      const stationId = entityId.slice(RADIO_PREFIX.length);
      void selectAndPlayStation(stationId, { focus: true });
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  );
}

function removeClickHandler(): void {
  if (_clickHandler) {
    _clickHandler.destroy();
    _clickHandler = null;
  }
}

/** Select a station, fly the camera to it, and begin playback. */
export async function selectAndPlayStation(
  stationId: string,
  { focus = true, autoplay = true }: { focus?: boolean; autoplay?: boolean } = {},
): Promise<void> {
  const station = _stationById.get(stationId);
  if (!station || !_viewer || _viewer.isDestroyed()) return;
  useRadioStore.getState().selectStation(stationId);
  updateSelectionEntity(Cesium, station);

  if (focus) {
    const camera = _viewer.camera;
    const plan = radioStationCameraPlan(station, {
      height: Math.max(GLOBAL_RADIO_ALTITUDE_M, camera.positionCartographic.height),
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    });
    if (plan) {
      _viewer.scene.screenSpaceCameraController.enableInputs = false;
      _viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(plan.lon, plan.lat, plan.height),
        orientation: {
          heading: plan.heading,
          pitch: plan.pitch,
          roll: plan.roll,
        },
        duration: 1.5,
        complete: () => {
          if (_viewer && !_viewer.isDestroyed())
            _viewer.scene.screenSpaceCameraController.enableInputs = true;
        },
        cancel: () => {
          if (_viewer && !_viewer.isDestroyed())
            _viewer.scene.screenSpaceCameraController.enableInputs = true;
        },
      });
    }
  }
  if (autoplay) {
    ensureRadioAudio();
    await playSelectedRadio(station);
  }
}

/** Lift the selected station marker and add a selection bracket entity. */
function updateSelectionEntity(
  cesium: typeof Cesium,
  station: RadioStation | null,
): void {
  if (_selectedEntity && _viewer) _viewer.entities.remove(_selectedEntity);
  _selectedEntity = null;
  if (!station || !_viewer || !_enabled) return;
  const categoryId = radioStationCategoryId(station);
  const color = cesium.Color.fromCssColorString(radioCategoryColor(categoryId));
  _selectedEntity = _viewer.entities.add({
    position: cesium.Cartesian3.fromDegrees(station.lon, station.lat, SELECTED_LIFT_M),
    point: {
      pixelSize: 10,
      color,
      outlineColor: cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

async function fetchDirectory(viewer: Cesium.Viewer): Promise<void> {
  if (!_enabled) return;
  const generation = ++_requestGeneration;
  useRadioStore.getState().setLoading(true);
  try {
    const response = await fetch(RADIO_DIRECTORY_ENDPOINT, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Radio directory returned ${response.status}`);
    const body = (await response.json()) as {
      stations?: RadioStation[];
      updatedAt?: string;
      stale?: boolean;
      degraded?: boolean;
    };
    if (generation !== _requestGeneration || !_enabled) return;
    if (!Array.isArray(body?.stations))
      throw new Error("Radio directory response was malformed");
    const stations = body.stations;
    if (!stations.length)
      throw new Error("Radio directory returned no usable stations");
    renderStations(Cesium, stations);
    const categories = buildRadioCategories(stations);
    useRadioStore.getState().setDirectory({
      stations,
      categories,
      updatedAt: body.updatedAt ?? null,
      stale: Boolean(body.stale),
      degraded: Boolean(body.degraded),
      error: body.degraded ? "Radio directory coverage is degraded." : null,
    });
    console.log(`[Data:Radio] Loaded ${stations.length} stations`);
  } catch (err) {
    if (generation !== _requestGeneration || !_enabled) return;
    const msg =
      err instanceof Error ? err.message : "Radio directory is temporarily unavailable.";
    useRadioStore.getState().setDirectoryError(msg);
    useGlobeStore.getState().setLayerError("radio", msg);
  }
}

export const radioEngine = {
  id: "radio",
  name: "Radio",

  /** Show stations. Enabling never starts audio. */
  async enable(ctx: LayerContext): Promise<void> {
    const { viewer, Cesium: cesium } = ctx;
    _viewer = viewer;
    _enabled = true;
    useRadioStore.getState().setEnabled(true);

    if (!_dataSource) {
      _dataSource = new cesium.CustomDataSource("Radio stations");
      _dataSource.clustering = new cesium.EntityCluster({
        enabled: true,
        pixelRange: CLUSTER_PIXEL_THRESHOLD,
        minimumClusterSize: 2,
      });
      _dataSource.clustering.clusterEvent.addEventListener(
        (entities: Cesium.Entity[], cluster: { point: Cesium.PointPrimitive; label: Cesium.Label }) => {
          const stationIds = entities
            .map((e) =>
              String(
                (e.properties as unknown as { stationId?: Cesium.Property })?.stationId?.getValue(
                  cesium.JulianDate.now(),
                ) ?? "",
              ),
            )
            .filter(Boolean);
          const members = stationIds
            .map((id) => _stationById.get(id))
            .filter((s): s is RadioStation => Boolean(s));
          const categoryId = members.length
            ? radioStationCategoryId(members[0])
            : "other";
          cluster.point.pixelSize = Math.min(28, 12 + Math.log2(Math.max(1, members.length)) * 3);
          cluster.point.color = cesium.Color.fromCssColorString(radioCategoryColor(categoryId));
          cluster.point.outlineColor = cesium.Color.BLACK;
          cluster.point.outlineWidth = 2;
          cluster.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
          cluster.label.text = String(members.length);
          cluster.label.font = "bold 10px monospace";
          cluster.label.fillColor = cesium.Color.WHITE;
          cluster.label.outlineColor = cesium.Color.BLACK;
          cluster.label.outlineWidth = 2;
          cluster.label.style = cesium.LabelStyle.FILL_AND_OUTLINE;
          cluster.label.pixelOffset = new cesium.Cartesian2(0, -2);
          cluster.label.disableDepthTestDistance = Number.POSITIVE_INFINITY;
        },
      );
      _dataSource.show = false;
      await viewer.dataSources.add(_dataSource);
    }
    _dataSource.show = true;

    installClickHandler(viewer);
    await fetchDirectory(viewer);

    // Poll on GEV's 45-minute cadence while enabled.
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => {
      if (_enabled && _viewer && !_viewer.isDestroyed()) {
        void fetchDirectory(_viewer);
      }
    }, RADIO_POLL_MS);
  },

  /** Hide the layer and stop playback without forgetting the directory. */
  disable(ctx: LayerContext): void {
    _enabled = false;
    _requestGeneration += 1;
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    removeClickHandler();
    stopRadioPlayback();
    if (_selectedEntity && _viewer) _viewer.entities.remove(_selectedEntity);
    _selectedEntity = null;
    if (_dataSource) _dataSource.show = false;
    useRadioStore.getState().selectStation(null);
    useRadioStore.getState().setEnabled(false);
    void ctx;
  },

  /** Release all rendering, event, and playback resources. */
  destroy(): void {
    this.disable({ viewer: _viewer as Cesium.Viewer, Cesium });
    destroyRadioAudio();
    if (_dataSource && _viewer && !_viewer.isDestroyed()) {
      _viewer.dataSources.remove(_dataSource, true);
    }
    _dataSource = null;
    _stationById.clear();
    _viewer = null;
    useRadioStore.getState().reset();
  },

  /** Cycle to the next/previous station in the ranked visible list. */
  cycleStation(direction = 1): void {
    if (!_viewer || !_enabled) return;
    const state = useRadioStore.getState();
    const visible = filterRadioStations(state.stations, state.filter);
    const anchor = viewportAnchor(_viewer);
    const ranked = rankRadioStationsForViewport(visible, anchor ?? null, {
      preferEnglish: Boolean(anchor?.globalView),
    });
    if (!ranked.length) return;
    const currentIndex = state.selectedId
      ? ranked.findIndex((s) => s.id === state.selectedId)
      : -1;
    const nextIndex =
      (currentIndex + direction + ranked.length) % ranked.length;
    void selectAndPlayStation(ranked[nextIndex].id, { focus: true });
  },

  /** Apply a category filter without changing the active stream. */
  setFilter(categoryId: string): void {
    useRadioStore.getState().setFilter(categoryId as never);
  },

  getStationById(id: string): RadioStation | null {
    return _stationById.get(id) ?? null;
  },
};

// LayerImpl export for the layer registry. The engine object already
// satisfies LayerImpl (enable/disable + [key: string]: any); this alias
// keeps the registry import path stable.
export const radioLayer: LayerImpl = radioEngine;
