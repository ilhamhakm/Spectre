import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "./types";
import { useGlobeStore } from "@/store/globe-store";
import { governorHold, governorRelease, governorRequestRender } from "@/globe/render-governor";

/**
 * Configuration for a single GIBS WMTS replay layer.
 *
 * GIBS (NASA Global Imagery Browse Services) provides free, no-auth WMTS
 * tile access to daily satellite imagery with a TIME dimension parameter.
 * See: https://nasa-gibs.github.io/gibs-api-docs/
 */
interface GibsLayerConfig {
  /** GIBS WMTS layer identifier, e.g. "MODIS_Terra_CorrectedReflectance_TrueColor". */
  layerId: string;
  /** TileMatrixSet for Web Mercator (EPSG:3857), e.g. "GoogleMapsCompatible_Level9". */
  tileMatrixSetId: string;
  /** Image format MIME type, e.g. "image/jpeg" or "image/png". */
  format: string;
  /** Maximum tile zoom level for this TileMatrixSet. */
  maximumLevel: number;
  /** Attribution credit text. */
  credit: string;
  /** Which replay layer this is (for store coordination). */
  replayLayerId: "big-changes-replay" | "construction-replay";
  /**
   * If true, hide the Esri base map so the GIBS layer is the only imagery
   * visible. Use for full-coverage layers (MODIS, VIIRS) where the GIBS
   * imagery covers the entire globe. Set false for sparse layers (HLS)
   * that only have tiles where the satellite imaged: the Esri base
   * provides context and the GIBS tiles overlay on top.
   */
  hideBase: boolean;
}

/** Debounce delay (ms) before swapping imagery provider on date change. */
const DATE_CHANGE_DEBOUNCE_MS = 250;

/** Animation tick interval (ms). */
const ANIMATION_TICK_MS = 100;

/**
 * Create a GIBS WMTS imagery provider for the given date.
 *
 * Uses the RESTful URL pattern with the TIME dimension inserted between
 * the style and tile matrix set:
 *   https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{date}/{tms}/{z}/{y}/{x}.{ext}
 */
function createGibsProvider(
  config: GibsLayerConfig,
  cesium: typeof Cesium,
  date: string,
): Cesium.WebMapTileServiceImageryProvider {
  const ext = config.format === "image/jpeg" ? "jpg" : "png";
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${config.layerId}/default/${date}/${config.tileMatrixSetId}/{TileMatrix}/{TileRow}/{TileCol}.${ext}`;

  return new cesium.WebMapTileServiceImageryProvider({
    url,
    layer: config.layerId,
    style: "default",
    format: config.format,
    tileMatrixSetID: config.tileMatrixSetId,
    maximumLevel: config.maximumLevel,
    credit: new cesium.Credit(config.credit),
  });
}

/**
 * Create a LayerImpl for a GIBS replay layer.
 *
 * On enable: adds a GIBS WMTS imagery layer for the current replay date,
 * subscribes to store date/play changes, and starts the animation loop if
 * playing. On disable: removes the layer, stops animation, unsubscribes.
 *
 * The date-change handler is debounced (250ms) to avoid thrashing tile
 * requests during rapid scrubbing, matching the pattern from NASA's own
 * GIBS Cesium time example.
 */
export function createGibsReplayLayer(config: GibsLayerConfig): LayerImpl {
  let imageryLayer: Cesium.ImageryLayer | null = null;
  let unsubscribe: (() => void) | null = null;
  let animTimer: ReturnType<typeof setInterval> | null = null;
  let dateChangeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAppliedDate = "";
  let tileLoadListener: Cesium.Event.RemoveCallback | null = null;
  let baseLayerWasShown = true;

  function swapProvider(ctx: LayerContext, date: string): void {
    const { viewer, Cesium: cesium } = ctx;
    if (viewer.isDestroyed()) return;

    // Remove the old imagery layer.
    if (imageryLayer) {
      viewer.imageryLayers.remove(imageryLayer);
      imageryLayer = null;
    }

    // Mark loading: the new provider's tiles need to fetch.
    useGlobeStore.getState().setReplayLoading(true);

    // Add a new one for the requested date.
    const provider = createGibsProvider(config, cesium, date);
    imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
    lastAppliedDate = date;
    governorRequestRender("replay-gibs");
  }

  /**
   * Hide the Esri base imagery layer (index 0) so the GIBS layer is the
   * only visible imagery. This is critical: at 250m resolution, GIBS
   * MODIS TrueColor looks almost identical to the Esri base map, so
   * date changes are invisible unless the base is hidden. It also
   * ensures tileLoadProgressEvent only tracks GIBS tiles (so the
   * loading indicator can actually reach 0).
   */
  function hideBaseLayer(ctx: LayerContext): void {
    const { viewer } = ctx;
    if (viewer.isDestroyed()) return;
    const base = viewer.imageryLayers.get(0);
    if (base) {
      baseLayerWasShown = base.show;
      base.show = false;
    }
  }

  function restoreBaseLayer(ctx: LayerContext): void {
    const { viewer } = ctx;
    if (viewer.isDestroyed()) return;
    const base = viewer.imageryLayers.get(0);
    if (base) {
      base.show = baseLayerWasShown;
    }
  }

  /**
   * Subscribe to the globe's tile load progress event. With the base
   * layer hidden, only GIBS tiles are in the queue, so when the count
   * drops to 0 the GIBS imagery for the current date is fully loaded.
   */
  function attachTileLoadListener(ctx: LayerContext): void {
    const { viewer } = ctx;
    if (viewer.isDestroyed()) return;
    if (tileLoadListener) {
      tileLoadListener();
      tileLoadListener = null;
    }
    tileLoadListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
      (queuedTileCount: number) => {
        if (queuedTileCount === 0) {
          useGlobeStore.getState().setReplayLoading(false);
        }
      },
    );
  }

  function onDateChange(ctx: LayerContext, date: string): void {
    if (date === lastAppliedDate) return;
    if (dateChangeTimer) clearTimeout(dateChangeTimer);
    dateChangeTimer = setTimeout(() => {
      dateChangeTimer = null;
      swapProvider(ctx, date);
    }, DATE_CHANGE_DEBOUNCE_MS);
  }

  function startAnimation(ctx: LayerContext): void {
    if (animTimer) return;
    governorHold("replay-gibs");
    animTimer = setInterval(() => {
      const state = useGlobeStore.getState();
      if (!state.replayPlaying) return;

      const current = new Date(state.replayDate + "T00:00:00Z");
      const speed = state.replaySpeed;
      // Advance by speed/10 days per 100ms tick (= speed days per second).
      current.setUTCDate(current.getUTCDate() + Math.max(1, Math.round(speed / 10)));
      let nextDate = current.toISOString().split("T")[0];

      // Wrap around at replayEnd.
      if (nextDate > state.replayEnd) {
        nextDate = state.replayStart;
      }
      if (nextDate !== state.replayDate) {
        state.setReplayDate(nextDate);
      }
    }, ANIMATION_TICK_MS);
  }

  function stopAnimation(): void {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
    governorRelease("replay-gibs");
  }

  return {
    async enable(ctx: LayerContext): Promise<void> {
      const { viewer } = ctx;
      const state = useGlobeStore.getState();

      // Mark this as the active replay layer (for timeline UI).
      state.setReplayActiveLayer(config.replayLayerId);

      // Hide the Esri base map for full-coverage layers (MODIS, VIIRS)
      // so the GIBS imagery is clearly visible. For sparse layers (HLS),
      // keep the base visible as context and overlay GIBS on top.
      if (config.hideBase) {
        hideBaseLayer(ctx);
      }

      // Track tile load progress to drive the loading indicator.
      attachTileLoadListener(ctx);

      // Initial imagery load for the current replay date.
      swapProvider(ctx, state.replayDate);

      // Subscribe to store changes for date and play/pause.
      unsubscribe = useGlobeStore.subscribe((s, prev) => {
        if (s.replayDate !== prev.replayDate) {
          onDateChange(ctx, s.replayDate);
        }
        if (s.replayPlaying !== prev.replayPlaying) {
          if (s.replayPlaying) {
            startAnimation(ctx);
          } else {
            stopAnimation();
          }
        }
      });

      // Start animation if already playing.
      if (state.replayPlaying) {
        startAnimation(ctx);
      }

      // Acknowledge viewer to avoid unused warning.
      void viewer;
    },

    disable(ctx: LayerContext): void {
      const { viewer } = ctx;

      // Clean up animation.
      stopAnimation();
      if (dateChangeTimer) {
        clearTimeout(dateChangeTimer);
        dateChangeTimer = null;
      }

      // Unsubscribe from store.
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      // Remove tile load listener.
      if (tileLoadListener) {
        tileLoadListener();
        tileLoadListener = null;
      }

      // Remove imagery layer.
      if (imageryLayer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(imageryLayer);
      }
      imageryLayer = null;
      lastAppliedDate = "";

      // Restore the Esri base map (only if we hid it).
      if (config.hideBase) {
        restoreBaseLayer(ctx);
      }

      // Clear active replay layer and loading state in store.
      const store = useGlobeStore.getState();
      store.setReplayActiveLayer(null);
      store.setReplayLoading(false);
    },
  };
}

/**
 * Big Changes replay layer: MODIS Terra TrueColor at 250m resolution.
 *
 * Best for wide-area changes visible from high altitude: glacier retreat,
 * deforestation, flooding, large-scale land cover shifts. Daily imagery
 * available since 2000-02-24.
 */
export const bigChangesReplayLayer = createGibsReplayLayer({
  layerId: "MODIS_Terra_CorrectedReflectance_TrueColor",
  tileMatrixSetId: "GoogleMapsCompatible_Level9",
  format: "image/jpeg",
  maximumLevel: 9,
  credit: "NASA GIBS - MODIS Terra Corrected Reflectance True Color",
  replayLayerId: "big-changes-replay",
  hideBase: true,
});

/**
 * Construction replay layer: VIIRS NOAA-21 TrueColor at 250m resolution.
 *
 * Originally tried HLS Sentinel-2 (30m) but it's a sparse layer - Sentinel-2
 * only images specific swaths each day, so most tiles at higher zoom return
 * 404, leaving large black gaps. Switched to VIIRS NOAA-21 TrueColor which
 * has full daily global coverage at 250m (same as MODIS but from a newer
 * satellite). The Esri base map stays visible and VIIRS overlays on top.
 * Best viewed at ~1000m altitude for construction-scale changes.
 */
export const constructionReplayLayer = createGibsReplayLayer({
  layerId: "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
  tileMatrixSetId: "GoogleMapsCompatible_Level9",
  format: "image/jpeg",
  maximumLevel: 9,
  credit: "NASA GIBS - VIIRS NOAA-21 Corrected Reflectance True Color",
  replayLayerId: "construction-replay",
  hideBase: false,
});
