import * as Cesium from "cesium";

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

// One-time Cesium global setup (base URL + tokens). Safe to call inside
// useEffect on the client; idempotent.
export function initCesiumGlobals(): void {
  if (typeof window === "undefined") return;
  if (!window.CESIUM_BASE_URL) {
    window.CESIUM_BASE_URL = "/cesium/";
  }
  // Ion token only needed for Cesium World Terrain / Ion-hosted assets.
  Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_TOKEN || "";
}

// Pure factory: builds a Cesium.Viewer against the given container.
//
// Globe is kept enabled (default) so that:
// - Camera controls (WASD, arrows, zoom) work — they reference globe.ellipsoid
// - Other layers (flights, roads, cctv) have somewhere to render
export function createViewer(container: HTMLDivElement): Cesium.Viewer {
  initCesiumGlobals();

  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    navigationInstructionsInitiallyVisible: false,
    contextOptions: {
      webgl: { preserveDrawingBuffer: true },
    },
    baseLayer: new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maximumLevel: 18,
        credit: "Esri",
      })
    ),
  });

  // Reposition the Cesium credits/attribution element to bottom-left. The
  // element is .cesium-viewer-bottom — we move it via inline style after
  // creation.
  const creditEl = container.querySelector(".cesium-viewer-bottom") as HTMLElement | null;
  if (creditEl) {
    creditEl.style.top = "auto";
    creditEl.style.right = "auto";
    creditEl.style.bottom = "4px";
    creditEl.style.left = "4px";
    creditEl.style.zIndex = "1";
    creditEl.style.fontSize = "9px";
    creditEl.style.opacity = "0.5";
    creditEl.style.pointerEvents = "none";
  }

  return viewer;
}
