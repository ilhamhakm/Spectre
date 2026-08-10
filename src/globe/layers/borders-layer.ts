import * as Cesium from "cesium";
import type { Layer } from "./types";
import {
  loadRegionData,
  setRegionEnabled,
  levelForHeight,
  type RegionData,
} from "../region-index";

// Country / state borders layer — thin neon strokes along boundaries, loaded
// from bundled world GeoJSON. Two data sources share this layer:
//   - "country-borders": national boundaries (visible in continent/world view)
//   - "state-borders":   admin-1 state/province boundaries (visible when
//                        zoomed into a country, below COUNTRY_VIEW_ALTITUDE)
//
// The camera height picks the active level automatically, and the same data
// also feeds the region hover index (country + state popups) via region-index.
//
// NOTE: borders are rendered as ground-clamped POLYLINES, not polygon
// outlines. Cesium does not draw outlines on clampToGround polygons, so a
// polygon-outline approach would leave only the (near-invisible) fill.

const BORDER_COLOR = Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 200);
const BORDER_WIDTH = 1.5;
const STATE_BORDER_COLOR = Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 150);
const STATE_BORDER_WIDTH = 1.2;

const COUNTRIES_URL = "/data/countries.geo.json";
const STATES_URL = "/data/admin1.geojson";
const COUNTRY_INFO_URL = "/data/country-info.json";
const STATE_INFO_URL = "/data/state-info.json";

type GeoFeature = {
  properties?: { name?: string };
  geometry: {
    type: string;
    coordinates: number[][][][] | number[][][];
  } | null;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[borders] ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function createBordersLayer(): Layer {
  let viewer: Cesium.Viewer | null = null;
  let countryDs: Cesium.CustomDataSource | null = null;
  let stateDs: Cesium.CustomDataSource | null = null;
  let loaded = false;
  let userHidden = false;
  let level: "country" | "state" = "country";
  let removeCameraMove: (() => void) | null = null;

  // Reduce Polygon / MultiPolygon coordinates down to their outer rings,
  // which trace the boundaries we want as strokes.
  function collectRings(coords: number[][][][] | number[][][]): number[][][] {
    const rings: number[][][] = [];
    if (!coords?.length) return rings;
    const first = coords[0];
    const isMulti = first.length && Array.isArray(first[0]) && Array.isArray(first[0][0]);
    if (isMulti) {
      for (const poly of coords as number[][][][]) {
        if (poly.length) rings.push(poly[0]);
      }
    } else {
      for (const ring of coords as number[][][]) {
        rings.push(ring);
      }
    }
    return rings;
  }

  function addFeature(
    ds: Cesium.CustomDataSource,
    feature: GeoFeature,
    width: number,
    color: Cesium.Color,
  ): void {
    const geom = feature?.geometry;
    if (!geom) return;
    for (const ring of collectRings(geom.coordinates)) {
      const positions = ring.map((p) => Cesium.Cartesian3.fromDegrees(p[0], p[1], 0));
      if (positions.length < 2) continue;
      ds.entities.add({
        polyline: {
          positions,
          clampToGround: true,
          width,
          material: color,
        },
      });
    }
  }

  async function load(v: Cesium.Viewer): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const [countriesGeo, statesGeo, countryInfo, stateInfo] = await Promise.all([
        fetchJson<{ features: GeoFeature[] }>(COUNTRIES_URL),
        fetchJson<{ features: GeoFeature[] }>(STATES_URL),
        fetchJson<Record<string, unknown>>(COUNTRY_INFO_URL),
        fetchJson<Record<string, unknown>>(STATE_INFO_URL),
      ]);

      // Build the hover resolution index once (country + state point lookup).
      loadRegionData({
        countriesGeo: countriesGeo as RegionData["countriesGeo"],
        statesGeo: statesGeo as RegionData["statesGeo"],
        countryInfo: countryInfo as RegionData["countryInfo"],
        stateInfo: stateInfo as RegionData["stateInfo"],
      });

      const cDs = new Cesium.CustomDataSource("country-borders");
      const sDs = new Cesium.CustomDataSource("state-borders");
      for (const feature of countriesGeo.features) {
        addFeature(cDs, feature, BORDER_WIDTH, BORDER_COLOR);
      }
      for (const feature of statesGeo.features) {
        addFeature(sDs, feature, STATE_BORDER_WIDTH, STATE_BORDER_COLOR);
      }

      if (v.isDestroyed()) return;
      countryDs = cDs;
      stateDs = sDs;
      cDs.show = !userHidden && level === "country";
      sDs.show = !userHidden && level === "state";
      v.dataSources.add(cDs);
      v.dataSources.add(sDs);

      // Auto-switch between national and state boundaries as the camera
      // crosses COUNTRY_VIEW_ALTITUDE.
      const onCameraMove = () => {
        if (v.isDestroyed()) return;
        const height = v.camera.positionCartographic?.height ?? 0;
        const next = levelForHeight(height);
        if (next !== level) {
          level = next;
          cDs.show = !userHidden && level === "country";
          sDs.show = !userHidden && level === "state";
          v.scene.requestRender();
        }
      };
      onCameraMove();
      v.camera.changed.addEventListener(onCameraMove);
      removeCameraMove = () => {
        v.camera.changed.removeEventListener(onCameraMove);
      };
      v.scene.requestRender();
    } catch (err) {
      console.error("[borders] failed to load GeoJSON", err);
    }
  }

  return {
    id: "borders",

    mount(v) {
      viewer = v;
      void load(v);
    },

    setShow(visible) {
      userHidden = !visible;
      // Gate the hover region resolver on layer visibility too, so region
      // popups only appear while borders are shown.
      setRegionEnabled(visible);
      if (countryDs && stateDs) {
        countryDs.show = visible && level === "country";
        stateDs.show = visible && level === "state";
        viewer?.scene.requestRender();
      }
    },

    destroy() {
      if (viewer && !viewer.isDestroyed()) {
        if (countryDs) viewer.dataSources.remove(countryDs);
        if (stateDs) viewer.dataSources.remove(stateDs);
        removeCameraMove?.();
        viewer.scene.requestRender();
      }
      countryDs = null;
      stateDs = null;
      viewer = null;
      loaded = false;
      removeCameraMove = null;
    },
  };
}
