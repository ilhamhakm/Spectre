import * as Cesium from "cesium";

// Building hover highlight — tints the OSM Buildings feature under the
// cursor gold (multiplied with the building's own color) and restores the
// previous feature to white when the cursor moves away.
//
// Cesium gotcha: per-feature `color`/`show` only live as long as the tile's
// content is in memory. When the camera crosses the app's SSE toggle
// (buildings-layer.ts flips maximumScreenSpaceError 1↔16 at 2000m), tiles
// refine/derefine and the highlight would vanish. To keep it sticky we
// remember the (tile, featureId) pair and re-apply it in tileVisible, and
// clear it when the tile unloads.

const HIGHLIGHT_COLOR = Cesium.Color.fromBytes(0xff, 0xc8, 0x2a, 255);
const RESTORE_COLOR = Cesium.Color.WHITE;

interface HighlightRef {
  feature: Cesium.Cesium3DTileFeature;
  tileset: Cesium.Cesium3DTileset;
  tile: Cesium.Cesium3DTile;
  featureId: number;
}

let current: HighlightRef | null = null;

function clearHighlight(): void {
  if (!current) return;
  try {
    // Only reset if the feature is still alive (its tile content exists).
    const f = current.feature;
    if (f && f.color) f.color = RESTORE_COLOR;
  } catch {
    // feature/tile already unloaded — nothing to restore
  }
  current = null;
}

// Picks the OSM Buildings feature the cursor is over, applies the gold
// highlight, and registers the persistence listeners once per tileset.
export function highlightBuilding(
  feature: Cesium.Cesium3DTileFeature | null,
): void {
  clearHighlight();
  if (!feature) return;

  let tileset: Cesium.Cesium3DTileset | null = null;
  let tile: Cesium.Cesium3DTile | null = null;
  try {
    const f = feature as unknown as {
      tileset: Cesium.Cesium3DTileset;
      content: { tile: Cesium.Cesium3DTile };
    };
    tileset = f.tileset;
    tile = f.content.tile;
  } catch {
    // content not ready / feature detached
  }
  if (!tileset || !tile) return;

  current = { feature, tileset, tile, featureId: feature.featureId ?? 0 };
  feature.color = HIGHLIGHT_COLOR;

  const onTileVisible = (t: Cesium.Cesium3DTile) => {
    if (!current || t !== current.tile) return;
    try {
      if (!t.content.ready) return;
      const f = t.content.getFeature(current.featureId);
      if (f && f.color) f.color = HIGHLIGHT_COLOR;
    } catch {
      // ignore — feature may not exist on the reloaded tile
    }
  };
  const onTileUnload = (t: Cesium.Cesium3DTile) => {
    if (t === current?.tile) current = null;
  };

  tileset.tileVisible.addEventListener(onTileVisible);
  tileset.tileUnload.addEventListener(onTileUnload);
}
