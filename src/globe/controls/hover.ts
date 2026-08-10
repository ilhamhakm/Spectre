import * as Cesium from "cesium";
import { pickAt, type BuildingPickData } from "../picking";
import {
  resolveRegion,
  levelForHeight,
  type RegionHit,
} from "../region-index";
import type { HoveredKind } from "@/store/globe-store";

// Resolve the geographic region under the cursor (country or state, chosen by
// the current camera height). Uses pickEllipsoid so the lookup works even when
// nothing pickable is at (x, y) — that's how empty-space hovers show region
// popups. Returns null when the borders layer is hidden or the point is off
// the ellipsoid.
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
    const height = viewer.camera.positionCartographic?.height ?? 0;
    return resolveRegion(lon, lat, levelForHeight(height));
  } catch {
    return null;
  }
}

// Attach a MOUSE_MOVE handler that picks whatever is under the cursor and
// calls onHover with the (id, x, y, kind, region) tuple. When the cursor moves
// off a pickable entity but is over a region (and the borders layer is on),
// onHover is called with id "region" and the resolved country/state info.
//
// Returns a destroy() function that removes the handler.
export function attachHoverHandler(
  viewer: Cesium.Viewer,
  onHover: (
    id: string | null,
    x: number | undefined,
    y: number | undefined,
    kind: HoveredKind,
    building?: BuildingPickData,
    region?: RegionHit | null
  ) => void
): () => void {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction(
    (evt: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const x = evt.endPosition.x;
      const y = evt.endPosition.y;
      const result = pickAt(viewer, x, y);
      const region = resolveRegionUnderCursor(viewer, x, y);

      if (!result || result.kind == null) {
        if (region) {
          onHover("region", x, y, "region", undefined, region);
        } else {
          onHover(null, undefined, undefined, null);
        }
        return;
      }
      onHover(
        result.id,
        x,
        y,
        result.kind as Exclude<HoveredKind, null>,
        result.building,
        region
      );
    },
    Cesium.ScreenSpaceEventType.MOUSE_MOVE
  );

  return () => {
    handler.destroy();
  };
}
