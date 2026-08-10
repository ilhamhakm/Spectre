import * as Cesium from "cesium";

// Google Photorealistic 3D Tiles layer.
//
// STRICTLY OPT-IN: nothing here runs until mountGoogleTilesLayer() is called,
// and nothing calls it until the user toggles the 3D TILES button. That means
// zero Google Maps Platform API requests until the user explicitly asks for
// photoreal tiles (their budget is metered and they want to conserve it).
//
// The tileset replaces Cesium OSM Buildings — callers should hide the
// buildings layer (layerVisibility.buildings = false) while this is active
// and restore it on destroy.

export const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "";

export interface GoogleTilesLayerHandle {
  destroy(): void;
}

export async function mountGoogleTilesLayer(
  viewer: Cesium.Viewer,
): Promise<GoogleTilesLayerHandle> {
  if (!GOOGLE_API_KEY) {
    throw new Error("Missing NEXT_PUBLIC_GOOGLE_API_KEY");
  }
  Cesium.GoogleMaps.defaultApiKey = GOOGLE_API_KEY;

  const tileset = await Cesium.createGooglePhotorealistic3DTileset({
    onlyUsingWithGoogleGeocoder: true,
  });
  if (viewer.isDestroyed()) {
    tileset.destroy();
    throw new Error("Viewer destroyed while loading Google tiles");
  }
  viewer.scene.primitives.add(tileset);
  tileset.show = true;

  viewer.scene.requestRender();

  return {
    destroy() {
      // Stop rendering first so in-flight tile loads don't touch a
      // half-destroyed tileset.
      tileset.show = false;
      if (!viewer.isDestroyed()) {
        try {
          viewer.scene.primitives.remove(tileset);
        } catch {
          // primitive already gone
        }
        viewer.scene.requestRender();
      }
      try {
        tileset.destroy();
      } catch {
        // Cesium3DTileset.destroy() can throw if pending tile loads still
        // reference internal state — swallow so toggle-off never crashes.
      }
    },
  };
}
