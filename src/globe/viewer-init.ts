import * as Cesium from "cesium";
import { installRenderGovernor } from "@/globe/render-governor";
import { useGlobeStore } from "@/store/globe-store";

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
    __viewer?: Cesium.Viewer;
    __Cesium?: typeof Cesium;
    __store?: typeof useGlobeStore;
  }
}

export function initCesiumGlobals(): void {
  if (typeof window === "undefined") return;
  if (!window.CESIUM_BASE_URL) {
    window.CESIUM_BASE_URL = "/cesium/";
  }
  Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_TOKEN || "";
}

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
    msaaSamples: 4,
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

  // Expose viewer globally for cross-component access without prop drilling
  window.__viewer = viewer;
  window.__Cesium = Cesium;
  window.__store = useGlobeStore;

  // Reposition Cesium credits to bottom-left
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

  installRenderGovernor(viewer);

  return viewer;
}
