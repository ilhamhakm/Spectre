import * as Cesium from "cesium";
import { pickAt } from "../picking";
import type { SelectedKind } from "@/store/globe-store";

// Attach a LEFT_CLICK handler that picks whatever is under the cursor and
// calls onSelect with the (id, x, y, kind) tuple. When the click lands on
// empty space or a non-flight entity, onSelect is called with a null id
// so the caller can clear any active selection.
//
// Returns a destroy() function that removes the handler.
export function attachClickHandler(
  viewer: Cesium.Viewer,
  onSelect: (
    id: string | null,
    x: number | undefined,
    y: number | undefined,
    kind: "cctv" | "event" | "flight-private" | "flight-mil" | "building" | "satellite" | null
  ) => void
): () => void {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction(
    (evt: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const result = pickAt(viewer, evt.position.x, evt.position.y);
      if (!result || result.kind == null) {
        onSelect(null, undefined, undefined, null);
        return;
      }
      onSelect(
        result.id,
        evt.position.x,
        evt.position.y,
        result.kind,
      );
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK
  );

  return () => {
    handler.destroy();
  };
}
