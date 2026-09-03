import * as Cesium from "cesium";
import {
  resolveRegion,
  type RegionHit,
} from "../region-index";
import { pickBuilding } from "../picking";
import { highlightBuilding, clearBuildingHighlight } from "../building-highlight";
import { useGlobeStore } from "@/store/globe-store";

// Resolve the geographic region under the cursor using the active scope
// set by the borders layer (continent, country, or state level depending
// on what the user selected). Uses pickEllipsoid so the lookup works even
// when nothing pickable is at (x, y). Returns null when the borders layer
// is hidden or the point is off the ellipsoid.
function resolveRegionUnderCursor(
  viewer: Cesium.Viewer,
  x: number,
  y: number
): RegionHit | null {
  try {
    const cartesian = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y));
    if (!cartesian) return null;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    // The active scope (set by borders layer) determines which level to
    // resolve. No need to pass altitude-based level anymore.
    return resolveRegion(lon, lat);
  } catch {
    return null;
  }
}

// Attach a MOUSE_MOVE handler that:
//   1. Tints the OSM building under the cursor white when bldgHighlight is on.
//   2. Resolves the region under the cursor and updates the store so
//      RegionPopup can render (only when borders are enabled).
//
// No hover popup is shown for buildings (click populates the right panel).
// Returns a destroy() function that removes the handler and clears the tint.
export function attachHoverHandler(viewer: Cesium.Viewer): () => void {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction(
    (evt: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (viewer.isDestroyed()) return;
      const x = evt.endPosition.x;
      const y = evt.endPosition.y;

      // Building hover highlight: only when bldgHighlight is on. Picking is
      // cheap (GPU batch table read) so we do it on every move when armed.
      const bldgHighlight = useGlobeStore.getState().bldgHighlight;
      if (bldgHighlight) {
        const picked = pickBuilding(viewer, x, y);
        if (picked) {
          highlightBuilding(picked.feature);
        } else {
          // Mouse moved to empty space: clear ONLY the hover tint, not the
          // selection (clicked) highlight which should persist.
          highlightBuilding(null);
        }
      } else if (useGlobeStore.getState().bldgHighlight === false) {
        // Flag just turned off (or was off): clear any stale tint.
        clearBuildingHighlight();
      }

      // Region popup: only when borders are enabled.
      if (!useGlobeStore.getState().bordersEnabled) {
        useGlobeStore.getState().clearHover();
        return;
      }
      const region = resolveRegionUnderCursor(viewer, x, y);
      if (region) {
        useGlobeStore.getState().setHover(region, x, y);
      } else {
        useGlobeStore.getState().clearHover();
      }
    },
    Cesium.ScreenSpaceEventType.MOUSE_MOVE
  );

  // When the mouse leaves the canvas (moves over a UI panel), clear the
  // hover highlight. Without this, the last hovered building keeps its
  // tint because the Cesium MOUSE_MOVE handler doesn't fire off-canvas.
  const canvas = viewer.scene.canvas as HTMLCanvasElement;
  const onMouseLeave = () => {
    if (viewer.isDestroyed()) return;
    highlightBuilding(null);
    useGlobeStore.getState().clearHover();
  };
  canvas.addEventListener("mouseleave", onMouseLeave);

  return () => {
    handler.destroy();
    canvas.removeEventListener("mouseleave", onMouseLeave);
    clearBuildingHighlight();
    useGlobeStore.getState().clearHover();
  };
}
