"use client";

import * as Cesium from "cesium";
import { useGlobeStore, type LayerId } from "@/store/globe-store";
import { LAYER_REGISTRY, ACTION_LAYERS } from "./registry";
import type { LayerContext } from "./types";

// Layers that cover a wide geographic area. When one of these is toggled
// on while the camera is zoomed in below AUTO_ZOOM_THRESHOLD_METERS, the
// camera flies out to AUTO_ZOOM_TARGET_METERS so the new contacts are
// visible in context. Local/imagery layers are excluded.
const WIDE_AREA_LAYERS: ReadonlySet<LayerId> = new Set([
  "commercial-flights",
  "private-flights",
  "military-flights",
  "satellites",
  "civil-unrest",
  "earthquakes",
  "dams",
  "data-centers",
  "radio",
  "big-changes-replay",
]);
// Layers that should zoom IN to a specific altitude when enabled (e.g.
// construction replay needs ~1000m to see 30m pixels usefully).
const ZOOM_IN_LAYERS: ReadonlySet<LayerId> = new Set([
  "construction-replay",
]);
const AUTO_ZOOM_THRESHOLD_METERS = 200_000; // 200 km
const AUTO_ZOOM_TARGET_METERS = 18_000_000; // 18,000 km
const ZOOM_IN_TARGET_METERS = 1_000; // 1 km for construction replay
const ZOOM_IN_THRESHOLD_METERS = 2_000; // only zoom in if above 2 km

// Singleton manager: attaches to a Cesium viewer and watches the store,
// calling enable()/disable() on the appropriate layer implementations.
class LayerManager {
  private ctx: LayerContext | null = null;
  private activeLayers = new Set<LayerId>();
  private pendingLayers = new Set<LayerId>();
  private bordersActive = false;
  private googleTilesActive = false;
  private unsubscribe: (() => void) | null = null;
  // Track last seen layer state to skip irrelevant store updates (camera coords, etc.)
  private lastLayerStateKey = "";

  attach(viewer: Cesium.Viewer): void {
    this.ctx = { viewer, Cesium };
    // Subscribe to store changes
    this.unsubscribe = useGlobeStore.subscribe(this.onStoreChange);
    // Process current state
    this.syncLayers();
    this.syncActions();
  }

  detach(): void {
    // Disable all active layers
    if (!this.ctx) return;
    for (const id of this.activeLayers) {
      try {
        LAYER_REGISTRY[id].disable(this.ctx);
      } catch (e) {
        console.warn(`Error disabling layer ${id}:`, e);
      }
    }
    this.activeLayers.clear();
    if (this.bordersActive) {
      try { ACTION_LAYERS.borders.disable(this.ctx); } catch {}
      this.bordersActive = false;
    }
    if (this.googleTilesActive) {
      try { ACTION_LAYERS.googleTiles.disable(this.ctx); } catch {}
      this.googleTilesActive = false;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.ctx = null;
  }

  private onStoreChange = () => {
    const s = useGlobeStore.getState();
    // Build a key from only layer/action-related state to skip camera/coord updates
    const key = `${s.layerVisibility ? JSON.stringify(s.layerVisibility) : ""}|${s.layerLoading ? JSON.stringify(s.layerLoading) : ""}|${s.bordersEnabled}|${s.googleTilesEnabled}`;
    if (key === this.lastLayerStateKey) return;
    this.lastLayerStateKey = key;
    this.syncLayers();
    this.syncActions();
  };

  private syncLayers() {
    if (!this.ctx) return;
    const store = useGlobeStore.getState();
    const visibility = store.layerVisibility;
    const loading = store.layerLoading;

    for (const id of Object.keys(LAYER_REGISTRY) as LayerId[]) {
      const isVisible = visibility[id];
      const isLoading = loading[id];
      const isActive = this.activeLayers.has(id);

      if (isLoading && !isActive && !this.pendingLayers.has(id)) {
        // Layer was toggled on (loading=true) but hasn't been enabled yet
        this.pendingLayers.add(id);
        this.enableLayer(id);
      } else if (!isVisible && !isLoading && isActive) {
        // Should be off and is on. Disable it.
        this.disableLayer(id);
      }
    }
  }

  private syncActions() {
    if (!this.ctx) return;
    const store = useGlobeStore.getState();

    if (store.bordersEnabled && !this.bordersActive) {
      this.enableBorders();
    } else if (!store.bordersEnabled && this.bordersActive) {
      this.disableBorders();
    }

    if (store.googleTilesEnabled && !this.googleTilesActive) {
      this.enableGoogleTiles();
    } else if (!store.googleTilesEnabled && this.googleTilesActive) {
      this.disableGoogleTiles();
    }
  }

  private maybeAutoZoomOut(id: LayerId): void {
    if (!this.ctx) return;
    if (!WIDE_AREA_LAYERS.has(id)) return;
    const { viewer, Cesium: cesium } = this.ctx;
    if (viewer.isDestroyed()) return;
    const altitude = viewer.camera.positionCartographic.height;
    if (altitude >= AUTO_ZOOM_THRESHOLD_METERS) return;
    // Fly out to the target altitude, keeping the same center point.
    const carto = viewer.camera.positionCartographic;
    const dest = new cesium.Cartographic(
      carto.longitude,
      carto.latitude,
      AUTO_ZOOM_TARGET_METERS,
    );
    viewer.camera.flyTo({
      destination: cesium.Cartesian3.fromRadians(dest.longitude, dest.latitude, dest.height),
      duration: 1.5,
    });
  }

  private maybeAutoZoomIn(id: LayerId): void {
    if (!this.ctx) return;
    if (!ZOOM_IN_LAYERS.has(id)) return;
    const { viewer, Cesium: cesium } = this.ctx;
    if (viewer.isDestroyed()) return;
    const altitude = viewer.camera.positionCartographic.height;
    if (altitude <= ZOOM_IN_THRESHOLD_METERS) return;
    // Fly in to the target altitude, keeping the same center point.
    const carto = viewer.camera.positionCartographic;
    const dest = new cesium.Cartographic(
      carto.longitude,
      carto.latitude,
      ZOOM_IN_TARGET_METERS,
    );
    viewer.camera.flyTo({
      destination: cesium.Cartesian3.fromRadians(dest.longitude, dest.latitude, dest.height),
      duration: 1.5,
    });
  }

  private async enableLayer(id: LayerId) {
    if (!this.ctx) return;
    // Mark as active BEFORE any store updates to prevent re-entry
    this.activeLayers.add(id);

    // Auto-zoom-out: if this is a wide-area layer and the camera is
    // zoomed in below the threshold, fly out so contacts are visible.
    this.maybeAutoZoomOut(id);
    // Auto-zoom-in: if this is a zoom-in layer and the camera is too
    // high, fly in so the detail is visible (e.g. construction replay).
    this.maybeAutoZoomIn(id);

    try {
      await LAYER_REGISTRY[id].enable(this.ctx);
      const s = useGlobeStore.getState();
      s.setLayerVisible(id, true);
    } catch (err) {
      console.error(`Layer ${id} failed to enable:`, err);
      this.activeLayers.delete(id);
      const s = useGlobeStore.getState();
      const msg = err instanceof Error
        ? err.message
        : (err as any)?.message
          ? String((err as any).message)
          : "Failed to load layer data";
      s.setLayerError(id, msg);
    } finally {
      this.pendingLayers.delete(id);
    }
  }

  private disableLayer(id: LayerId) {
    if (!this.ctx) return;
    try {
      LAYER_REGISTRY[id].disable(this.ctx);
    } catch (e) {
      console.warn(`Error disabling layer ${id}:`, e);
    }
    this.activeLayers.delete(id);
    // Ensure store reflects the disabled state
    const s = useGlobeStore.getState();
    if (s.layerLoading[id] || s.layerVisibility[id]) {
      s.setLayerVisible(id, false);
    }
  }

  private async enableBorders() {
    if (!this.ctx) return;
    this.bordersActive = true;
    try {
      await ACTION_LAYERS.borders.enable(this.ctx);
    } catch (err) {
      console.error("Borders layer failed:", err);
      this.bordersActive = false;
    }
  }

  private disableBorders() {
    if (!this.ctx) return;
    try { ACTION_LAYERS.borders.disable(this.ctx); } catch {}
    this.bordersActive = false;
  }

  private async enableGoogleTiles() {
    if (!this.ctx) return;
    this.googleTilesActive = true;
    try {
      await ACTION_LAYERS.googleTiles.enable(this.ctx);
    } catch (err) {
      console.error("Google tiles layer failed:", err);
      this.googleTilesActive = false;
      // Reset the store flag so the button doesn't show active on failure.
      const s = useGlobeStore.getState();
      if (s.googleTilesEnabled) {
        s.toggleGoogleTiles();
      }
      s.showToast("3D Tiles failed to load");
    }
  }

  private disableGoogleTiles() {
    if (!this.ctx) return;
    try { ACTION_LAYERS.googleTiles.disable(this.ctx); } catch {}
    this.googleTilesActive = false;
  }
}

export const layerManager = new LayerManager();
