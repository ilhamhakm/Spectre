import * as Cesium from "cesium";
import type { Layer } from "./types";

// OSM Buildings layer — gray extruded building footprints from OpenStreetMap.
// Sourced from Cesium ion asset 96188. Lightweight, loads fast.
// No photorealistic 3D tiles — those are handled in the Spectre 3D Tiles webapp.

// Below this camera altitude (meters) we force full-detail tile loading.
const MAX_DETAIL_ALTITUDE_METERS = 2000;
// SSE = 1 forces every in-view building tile to load at full resolution.
const FULL_DETAIL_SSE = 1;
// SSE = 16 is Cesium's default; coarser culling for performance at altitude.
const DEFAULT_SSE = 16;

export function createBuildingsLayer(): Layer {
  let osmTileset: Cesium.Cesium3DTileset | null = null;
  let viewer: Cesium.Viewer | null = null;
  let userHidden = false;

  // Applies the altitude-based SSE target whenever the camera moves.
  const applyAltitudeBasedSse = () => {
    if (!osmTileset || !viewer) return;
    const altitude = viewer.camera.positionCartographic.height;
    const targetSse =
      altitude < MAX_DETAIL_ALTITUDE_METERS ? FULL_DETAIL_SSE : DEFAULT_SSE;
    if (osmTileset.maximumScreenSpaceError !== targetSse) {
      osmTileset.maximumScreenSpaceError = targetSse;
      viewer.scene.requestRender();
    }
  };

  const onCameraChanged = () => {
    if (!userHidden) applyAltitudeBasedSse();
  };

  async function mountOsmBuildings(v: Cesium.Viewer): Promise<void> {
    if (osmTileset) return;
    try {
      const ts = await Cesium.Cesium3DTileset.fromIonAssetId(96188);
      if (v.isDestroyed()) return;
      osmTileset = ts;
      // Respect current visibility state (layer may have been toggled off
      // while the async tileset was still loading).
      const visible = !userHidden;
      ts.show = visible;
      v.scene.primitives.add(ts);
      if (visible) applyAltitudeBasedSse();
    } catch (err) {
      console.error("[buildings] failed to load OSM buildings", err);
    }
  }

  return {
    id: "buildings",

    mount(v) {
      viewer = v;
      osmTileset = null;
      void mountOsmBuildings(v);
      v.camera.percentageChanged = 0.1;
      v.camera.changed.addEventListener(onCameraChanged);
    },

    setShow(visible) {
      userHidden = !visible;
      if (osmTileset) osmTileset.show = visible;
      if (viewer) viewer.scene.requestRender();
    },

    destroy() {
      if (viewer && !viewer.isDestroyed()) {
        viewer.camera.changed.removeEventListener(onCameraChanged);
        if (osmTileset) viewer.scene.primitives.remove(osmTileset);
      }
      osmTileset = null;
      viewer = null;
    },
  };
}
