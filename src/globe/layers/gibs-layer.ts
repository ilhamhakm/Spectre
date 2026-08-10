import * as Cesium from "cesium";

// NASA GIBS WMTS daily MODIS Terra true color imagery at 250m/pixel.
//
// This is REAL NASA GIBS (Global Imagery Browse Services). GIBS serves daily
// MODIS Terra CorrectedReflectance_TrueColor captures worldwide, ideal for
// big-picture earth changes (ice melt, deforestation, dust storms, sea ice)
// viewed at high altitude (2,000-20,000km).
//
// Source: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi
// Product: MODIS_Terra_CorrectedReflectance_TrueColor (250m, EPSG:3857)
// Tile matrix: GoogleMapsCompatible_Level7 (tops out at zoom 7 in WebMercator)
// MODIS Terra first light: 2000-02-24. No auth, no instance ID, always free.

const GIBS_WMTS_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi";

const GIBS_LAYER_ID = "MODIS_Terra_CorrectedReflectance_TrueColor";

export type GibsGranularity = "weekly" | "monthly";

export interface GibsLayerHandle {
  setDate(date: string): void;
  setGranularity(g: GibsGranularity): void;
  setShow(visible: boolean): void;
  destroy(): void;
}

export function mountGibsLayer(viewer: Cesium.Viewer): GibsLayerHandle {
  let currentLayer: Cesium.ImageryLayer | null = null;
  let currentDate: string | null = null;
  let currentGranularity: GibsGranularity = "monthly";
  let shown = false;

  function removeLayer() {
    if (currentLayer) {
      viewer.imageryLayers.remove(currentLayer, true);
      currentLayer = null;
    }
  }

  function rebuild(): void {
    // Default to today if no date has been set. GIBS takes a single day
    // (not a range), returned as that day's MODIS Terra capture.
    if (!currentDate) {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      currentDate = `${y}-${m}-${day}`;
    }
    if (currentLayer) {
      removeLayer();
    }
    if (!shown) return;

    try {
      // GIBS serves a single day's MODIS capture per request. Cesium's WMTS
      // `times` option requires a TimeIntervalCollection + clock (meant for
      // time-series layers). For a static date we use `dimensions` instead,
      // which passes the Time dimension on every tile request directly.
      const provider = new Cesium.WebMapTileServiceImageryProvider({
        url: GIBS_WMTS_URL,
        layer: GIBS_LAYER_ID,
        style: "default",
        tileMatrixSetID: "GoogleMapsCompatible_Level7",
        format: "image/jpeg",
        tileWidth: 256,
        tileHeight: 256,
        maximumLevel: 7,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        credit: new Cesium.Credit("Imagery courtesy NASA GIBS"),
        dimensions: { Time: currentDate },
      });
      currentLayer = viewer.imageryLayers.addImageryProvider(provider);
      currentLayer.brightness = 1.0;
      currentLayer.contrast = 1.0;
      currentLayer.alpha = 0.9;
    } catch (err) {
      console.warn("[gibs] Failed to create NASA GIBS WMTS layer:", err);
    }
    viewer.scene.requestRender();
  }

  function setDate(date: string): void {
    currentDate = date;
    if (!shown) return;
    rebuild();
  }

  function setGranularity(g: GibsGranularity): void {
    currentGranularity = g;
    if (!shown) return;
    // GIBS WMTS always serves a single day regardless of granularity; the
    // granularity controls how the store steps the date. Rebuild to stay
    // consistent with the Sentinel layer's behavior.
    rebuild();
  }

  function setShow(visible: boolean): void {
    shown = visible;
    if (visible) {
      rebuild();
    } else {
      if (currentLayer) {
        removeLayer();
      }
      viewer.scene.requestRender();
    }
  }

  function destroy(): void {
    removeLayer();
  }

  return { setDate, setGranularity, setShow, destroy };
}

// Region presets for the live replay panel. Each preset flies the camera
// to a region and sets the GIBS/Sentinel date to a recent clear-sky day.
export interface RegionPreset {
  name: string;
  description: string;
  lat: number;
  lon: number;
  height: number;
  recommendedDate?: string;
}

export const GIBS_REGION_PRESETS: RegionPreset[] = [
  {
    name: "Himalayas",
    description: "Snow cover + glacier imagery",
    lat: 28,
    lon: 86,
    height: 2_000_000,
  },
  {
    name: "Antarctica",
    description: "Polar projection, ice sheets",
    lat: -82,
    lon: 0,
    height: 3_000_000,
  },
  {
    name: "Arctic",
    description: "Sea ice extent, polar view",
    lat: 82,
    lon: 0,
    height: 3_000_000,
  },
  {
    name: "Amazon",
    description: "Deforestation + fire activity",
    lat: -5,
    lon: -62,
    height: 2_000_000,
  },
  {
    name: "Sahara",
    description: "Dust storms + desert geology",
    lat: 23,
    lon: 12,
    height: 3_000_000,
  },
  {
    name: "Pacific Ocean",
    description: "Hurricanes + cyclone tracks",
    lat: 0,
    lon: -160,
    height: 5_000_000,
  },
  {
    name: "Greenland",
    description: "Ice sheet melt",
    lat: 72,
    lon: -40,
    height: 2_000_000,
  },
  {
    name: "Australia",
    description: "Bushfires + coral reef",
    lat: -25,
    lon: 134,
    height: 2_500_000,
  },
  {
    name: "Global",
    description: "Full planet view",
    lat: 0,
    lon: 0,
    height: 20_000_000,
  },
];

export const SENTINEL_REGION_PRESETS: RegionPreset[] = [
  {
    name: "Jakarta",
    description: "Urban expansion",
    lat: -6.1754,
    lon: 106.8272,
    height: 50_000,
  },
  {
    name: "Dubai",
    description: "Palm Jumeirah + coast",
    lat: 25.2048,
    lon: 55.2708,
    height: 50_000,
  },
  {
    name: "New York",
    description: "City + harbor",
    lat: 40.7589,
    lon: -73.9851,
    height: 50_000,
  },
  {
    name: "Amazon Deforestation",
    description: "Forest loss grid patterns",
    lat: -5,
    lon: -62,
    height: 100_000,
  },
  {
    name: "Nile Delta",
    description: "Agriculture + urban",
    lat: 30,
    lon: 31,
    height: 100_000,
  },
  // High-altitude ice melt views. Sentinel-2 monthly cloud-free mosaics work
  // at these altitudes now (minimumLevel:8 fix). Summer months (June-Sept)
  // show ice retreat; winter months show advance.
  {
    name: "Greenland Ice Sheet",
    description: "Seasonal ice melt - summer vs winter",
    lat: 72,
    lon: -40,
    height: 2_000_000,
  },
  {
    name: "Antarctic Peninsula",
    description: "Ice shelf retreat",
    lat: -75,
    lon: -60,
    height: 2_500_000,
  },
  {
    name: "Arctic Sea Ice",
    description: "Sea ice extent monthly",
    lat: 82,
    lon: 0,
    height: 3_000_000,
  },
  {
    name: "Himalayan Glaciers",
    description: "Glacier melt + snow line",
    lat: 28,
    lon: 86,
    height: 1_500_000,
  },
];
