import * as Cesium from "cesium";
import { pickBuilding } from "../picking";
import { selectBuilding, deselectBuilding } from "../building-highlight";
import { useGlobeStore, type TrackedFeature } from "@/store/globe-store";

// Attach a LEFT_CLICK handler that:
//   1. Applies the white selection highlight to the clicked building.
//   2. Populates the right panel with OSM building info.
// Clicking empty space (or a non-building primitive) clears the selection
// highlight and any tracked building so the detail panel closes.
//
// The camera does NOT fly: the building is already in view since the user
// clicked it. Other layers' click handlers (dams, data centers, CCTV) run
// independently; the store's mutual-exclusion ensures only one detail panel
// owns the right rail at a time.
//
// Returns a destroy() function that removes the handler.
export function attachClickHandler(viewer: Cesium.Viewer): () => void {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction(
    (evt: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (viewer.isDestroyed()) return;
      const state = useGlobeStore.getState();
      if (!state.bldgHighlight) return;

      const picked = pickBuilding(viewer, evt.position.x, evt.position.y);
      if (!picked) {
        // Click landed on empty ground or a non-building primitive: clear
        // the selection highlight and any tracked building.
        deselectBuilding();
        if (state.trackedBuilding) state.untrackBuilding();
        return;
      }

      // Apply the persistent white selection highlight.
      selectBuilding(picked.feature);

      const { data } = picked;
      // Use the building name if available, otherwise fall back to the
      // address (house number + street), otherwise "Unnamed building".
      const addrParts = [data.addrHouse, data.addrStreet].filter(Boolean);
      const name = data.name
        ?? (addrParts.length > 0 ? addrParts.join(" ") : null)
        ?? "Unnamed building";

      // Resolve the building's ground position for the detail card.
      let lat = 0;
      let lon = 0;
      try {
        const carto = Cesium.Cartographic.fromCartesian(
          viewer.scene.pickPosition(evt.position) ?? Cesium.Cartesian3.ZERO,
        );
        lat = Cesium.Math.toDegrees(carto.latitude);
        lon = Cesium.Math.toDegrees(carto.longitude);
      } catch {
        // pickPosition can fail when the depth buffer has nothing; the
        // panel still shows OSM tags without coordinates.
      }

      const feature: TrackedFeature = {
        kind: "building",
        id: data.elementId ?? `bldg_${evt.position.x}_${evt.position.y}`,
        name,
        lat,
        lon,
        data: data.tags,
      };
      state.trackBuilding(feature);
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK
  );

  return () => {
    handler.destroy();
  };
}
