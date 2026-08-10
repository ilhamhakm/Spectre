import * as Cesium from "cesium";

// Sentinel-2 imagery via Copernicus Data Space WMS.
// Supports TIME parameter for monthly/date-based queries.
// Free tier: register at https://dataspace.copernicus.eu/ to get an instance ID.
//
// If no instance ID is configured, falls back to EOX cloudless 2024 mosaic
// (no time-series, but always works without auth).

const EOX_WMTS_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";

const COPERNICUS_WMS_BASE = "https://sh.dataspace.copernicus.eu/ogc/wms";

// Convert a date string (e.g. "2026-08-01" or "2026-08-09") to a monthly
// TIME range (e.g. "2026-08-01/2026-08-31"). The Copernicus WMS creates a
// cloud-free mosaic by picking the least cloudy pixels from all images in
// the range.
function toMonthlyRange(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const [y, m] = dateStr.split("-").map(Number);
  if (!y || !m) return dateStr; // fallback: use as-is
  const lastDay = new Date(y, m, 0).getDate();
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return `${start}/${end}`;
}

// Convert a date string to a 7-day TIME range starting at that date.
// Used for weekly granularity (tracking construction, specific changes).
// Sentinel-2 has a ~5-day revisit cycle, so a 7-day window captures 1-2
// cloud-free images per tile. Less cloud-free than monthly (fewer images
// to composite from), but shows week-by-week changes.
function toWeeklyRange(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const start = new Date(dateStr + "T00:00:00");
  if (isNaN(start.getTime())) return dateStr;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(start)}/${fmt(end)}`;
}

function toTimeRange(dateStr: string | null, granularity: "weekly" | "monthly"): string | null {
  return granularity === "weekly" ? toWeeklyRange(dateStr) : toMonthlyRange(dateStr);
}

function getConfiguredInstanceId(): string | null {
  try {
    return localStorage.getItem("copernicus_instance_id");
  } catch {
    return null;
  }
}

function setConfiguredInstanceId(id: string) {
  try {
    localStorage.setItem("copernicus_instance_id", id);
  } catch {
    // ignore
  }
}

export function createSentinelLayer(viewer: Cesium.Viewer) {
  let currentLayer: Cesium.ImageryLayer | null = null;
  let currentMode: "eox" | "wms" = "eox";
  let currentDate: string | null = null;
  let currentGranularity: "weekly" | "monthly" = "monthly";

  function removeLayer() {
    if (currentLayer) {
      viewer.imageryLayers.remove(currentLayer, true);
      currentLayer = null;
    }
  }

  function buildWmsUrl(instanceId: string, dateStr: string | null): string {
    let url = `${COPERNICUS_WMS_BASE}/${instanceId}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=TRUE_COLOR&TILED=true&WIDTH=512&HEIGHT=512&CRS=EPSG:4326&STYLES&FORMAT=image/png&BBOX=`;
    if (dateStr) {
      url += `&TIME=${dateStr}`;
    }
    return url;
  }

  function setEnabled(enabled: boolean) {
    if (enabled && !currentLayer) {
      const instanceId = getConfiguredInstanceId();

      if (instanceId) {
        // Use Copernicus WMS with cloud-free mosaic (TIME range).
        // Range is weekly (7 days) or monthly depending on granularity.
        currentMode = "wms";
        const timeRange = toTimeRange(currentDate, currentGranularity);
        const provider = new Cesium.WebMapServiceImageryProvider({
          url: `${COPERNICUS_WMS_BASE}/${instanceId}`,
          layers: "TRUE_COLOR",
          parameters: {
            FORMAT: "image/png",
            TRANSPARENT: "true",
            ...(timeRange ? { TIME: timeRange } : {}),
          },
          // minimumLevel: 8 - never request tiles coarser than zoom 8.
          // At high altitude (zoomed out), Cesium would normally request
          // zoom 0-7 tiles, each covering a huge bbox (e.g. zoom 4 = ~40x40
          // degrees). Copernicus WMS can't composite a cloud-free Sentinel-2
          // mosaic over such a large area and returns error tiles.
          // With minimumLevel:8, Cesium uses zoom 8 tiles (~280km each) and
          // downsamples them for display at any altitude. Sentinel-2 then
          // loads cleanly at any altitude, from 5km (city detail) to
          // 20,000km (planetary).
          minimumLevel: 8,
          maximumLevel: 14,
        });
        currentLayer = viewer.imageryLayers.addImageryProvider(provider);
        currentLayer.alpha = 1.0;
        currentLayer.brightness = 1.1;
        currentLayer.contrast = 1.05;
      } else {
        // Fallback: EOX cloudless 2024 (no time-series)
        currentMode = "eox";
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: EOX_WMTS_URL,
          credit: new Cesium.Credit(
            "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH",
          ),
          maximumLevel: 14,
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
        });
        currentLayer = viewer.imageryLayers.addImageryProvider(provider);
        currentLayer.alpha = 1.0;
        currentLayer.brightness = 1.2;
        currentLayer.contrast = 1.1;
      }
    } else if (!enabled && currentLayer) {
      removeLayer();
    }
  }

  function setDate(dateStr: string | null) {
    currentDate = dateStr;
    // If WMS mode is active and layer exists, recreate with new range
    if (currentMode === "wms" && currentLayer) {
      const instanceId = getConfiguredInstanceId();
      if (instanceId) {
        removeLayer();
        const timeRange = toTimeRange(dateStr, currentGranularity);
        const provider = new Cesium.WebMapServiceImageryProvider({
          url: `${COPERNICUS_WMS_BASE}/${instanceId}`,
          layers: "TRUE_COLOR",
          parameters: {
            FORMAT: "image/png",
            TRANSPARENT: "true",
            ...(timeRange ? { TIME: timeRange } : {}),
          },
          minimumLevel: 8,
          maximumLevel: 14,
        });
        currentLayer = viewer.imageryLayers.addImageryProvider(provider);
        currentLayer.alpha = 1.0;
        currentLayer.brightness = 1.1;
        currentLayer.contrast = 1.05;
      }
    }
    // EOX mode: setDate is a no-op (fixed 2024 mosaic)
  }

  function setGranularity(g: "weekly" | "monthly") {
    if (g === currentGranularity) return;
    currentGranularity = g;
    // If WMS mode is active and layer exists, recreate with new range
    if (currentMode === "wms" && currentLayer) {
      const instanceId = getConfiguredInstanceId();
      if (instanceId) {
        removeLayer();
        const timeRange = toTimeRange(currentDate, currentGranularity);
        const provider = new Cesium.WebMapServiceImageryProvider({
          url: `${COPERNICUS_WMS_BASE}/${instanceId}`,
          layers: "TRUE_COLOR",
          parameters: {
            FORMAT: "image/png",
            TRANSPARENT: "true",
            ...(timeRange ? { TIME: timeRange } : {}),
          },
          minimumLevel: 8,
          maximumLevel: 14,
        });
        currentLayer = viewer.imageryLayers.addImageryProvider(provider);
        currentLayer.alpha = 1.0;
        currentLayer.brightness = 1.1;
        currentLayer.contrast = 1.05;
      }
    }
  }

  function promptInstanceId(): Promise<string | null> {
    return new Promise((resolve) => {
      const existing = getConfiguredInstanceId();
      if (existing) {
        resolve(existing);
        return;
      }
      // Auto-configure with known instance ID
      const defaultId = "f8bdb313-7805-4a9f-ac9b-f777c06ba79b";
      setConfiguredInstanceId(defaultId);
      resolve(defaultId);
    });
  }

  function destroy() {
    removeLayer();
  }

  return { setEnabled, setDate, setGranularity, destroy, promptInstanceId };
}
