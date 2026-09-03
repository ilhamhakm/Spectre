"use client";

import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createViewer } from "@/globe/viewer-init";
import { configureScene } from "@/globe/scene-config";
import { attachKeyboardControls } from "@/globe/controls/keyboard";
import { attachHoverHandler } from "@/globe/controls/hover";
import { attachRegionClickHandler } from "@/globe/controls/click-region";
import { attachClickHandler } from "@/globe/controls/click";
import { deselectBuilding, clearBuildingHighlight } from "@/globe/building-highlight";
import { layerManager } from "@/globe/layers/manager";
import { useGlobeStore } from "@/store/globe-store";

export default function CesiumGlobe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const setCameraAltitude = useGlobeStore((s) => s.setCameraAltitude);
  const setCameraCoords = useGlobeStore((s) => s.setCameraCoords);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const viewer = createViewer(containerRef.current);
    if (disposed) {
      viewer.destroy();
      return;
    }
    viewerRef.current = viewer;

    const cleanupScene = configureScene(viewer);
    const destroyKeyboard = attachKeyboardControls(viewer);
    const destroyHover = attachHoverHandler(viewer);
    const destroyClick = attachClickHandler(viewer);
    const destroyRegionClick = attachRegionClickHandler(viewer);
    layerManager.attach(viewer);

    // Camera move listener: update altitude and coordinates in store
    const onCameraMove = () => {
      if (viewer.isDestroyed()) return;
      const carto = viewer.camera.positionCartographic;
      setCameraAltitude(carto.height);
      setCameraCoords(
        Cesium.Math.toDegrees(carto.longitude),
        Cesium.Math.toDegrees(carto.latitude),
        carto.height
      );
    };
    viewer.camera.moveEnd.addEventListener(onCameraMove);
    onCameraMove();

    // Sync building selection highlight with the store. When trackedBuilding
    // is cleared (CLOSE button, Escape, or mutual exclusion by another
    // tracker), clear the white highlight on the 3D tile feature. Also clear
    // all building highlights when bldgHighlight is toggled off.
    let prevTrackedBuilding = useGlobeStore.getState().trackedBuilding;
    let prevBldgHighlight = useGlobeStore.getState().bldgHighlight;
    const unsubStore = useGlobeStore.subscribe((state) => {
      if (state.trackedBuilding !== prevTrackedBuilding) {
        prevTrackedBuilding = state.trackedBuilding;
        if (!state.trackedBuilding) deselectBuilding();
      }
      if (state.bldgHighlight !== prevBldgHighlight) {
        prevBldgHighlight = state.bldgHighlight;
        if (!state.bldgHighlight) clearBuildingHighlight();
      }
    });

    return () => {
      disposed = true;
      unsubStore();
      layerManager.detach();
      viewer.camera.moveEnd.removeEventListener(onCameraMove);
      cleanupScene();
      destroyKeyboard();
      destroyHover();
      destroyClick();
      destroyRegionClick();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, [setCameraAltitude, setCameraCoords]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    />
  );
}
