import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "./types";

// Below this camera altitude (meters) we force full-detail tile loading.
const MAX_DETAIL_ALTITUDE_METERS = 2000;
// SSE = 1 forces every in-view building tile to load at full resolution.
const FULL_DETAIL_SSE = 1;
// SSE = 16 is Cesium's default; coarser culling for performance at altitude.
const DEFAULT_SSE = 16;

// Active OSM Buildings tileset (Ion asset 96188). Set when the 3D Buildings
// layer is enabled, cleared on disable. The hover/click building handlers
// read this to find the live tileset for picking + per-feature tinting.
let activeTileset: Cesium.Cesium3DTileset | null = null;

export function getBuildingsTileset(): Cesium.Cesium3DTileset | null {
  return activeTileset;
}

/**
 * OSM Buildings layer. Loads the Cesium Ion OSM Buildings tileset
 * (asset 96188) with altitude-based SSE so close views get full detail
 * and far views stay performant. Hover/click highlighting is handled
 * separately by `building-highlight.ts` + `controls/click.ts`, gated
 * by the `bldgHighlight` store flag (no second tileset needed).
 */
export const buildings3dLayer: LayerImpl = {
  async enable(ctx: LayerContext): Promise<void> {
    const { viewer, Cesium: cesium } = ctx;
    if (activeTileset) return;

    let tileset: Cesium.Cesium3DTileset;
    try {
      tileset = await cesium.Cesium3DTileset.fromIonAssetId(96188);
    } catch (err) {
      console.error("[buildings] failed to load OSM buildings:", err);
      throw err;
    }

    if (viewer.isDestroyed()) return;

    viewer.scene.primitives.add(tileset);
    activeTileset = tileset;

    // Default HIGHLIGHT colorBlendMode (same as v1): result = original * color.
    // Color.WHITE = identity = no change (used for clearing). See
    // building-highlight.ts.

    // Altitude-based SSE: full detail when close, coarser when far.
    const applyAltitudeBasedSse = () => {
      if (!activeTileset || viewer.isDestroyed()) return;
      const altitude = viewer.camera.positionCartographic.height;
      const targetSse =
        altitude < MAX_DETAIL_ALTITUDE_METERS ? FULL_DETAIL_SSE : DEFAULT_SSE;
      if (activeTileset.maximumScreenSpaceError !== targetSse) {
        activeTileset.maximumScreenSpaceError = targetSse;
        viewer.scene.requestRender();
      }
    };

    viewer.camera.percentageChanged = 0.1;
    viewer.camera.changed.addEventListener(applyAltitudeBasedSse);
    // Stash the listener so disable() can remove it.
    (this as any)._onCameraChanged = applyAltitudeBasedSse;
    applyAltitudeBasedSse();
  },

  disable(ctx: LayerContext): void {
    const { viewer } = ctx;
    const onCameraChanged = (this as any)._onCameraChanged as
      | (() => void)
      | undefined;
    if (onCameraChanged && !viewer.isDestroyed()) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
    }
    (this as any)._onCameraChanged = null;

    const tileset = activeTileset;
    activeTileset = null;
    if (!tileset) return;

    if (viewer.isDestroyed() || tileset.isDestroyed()) return;

    viewer.scene.primitives.remove(tileset);
    if (!tileset.isDestroyed()) tileset.destroy();
  },
};
