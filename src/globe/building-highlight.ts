import * as Cesium from "cesium";
import { governorRequestRender } from "./render-governor";

// Building highlight system using v1's proven HIGHLIGHT mode pattern.
//
// In HIGHLIGHT mode (the default): result = originalTexture * featureColor.
// Color.WHITE (1,1,1) = identity multiply = no visible change (clear).
// Any color < white tints the building by darkening channels.
//
// For a WHITE highlight, we use a light gray (220, 220, 220). This
// darkens colored buildings slightly and makes them stand out as a
// light/white-ish overlay. Pure white would be invisible (identity).
//
// Cesium gotcha: per-feature color only lives while the tile content is
// in memory. When tiles refine/derefine (SSE toggle, camera move), the
// color is lost. We keep it sticky via tileVisible/tileUnload listeners
// (v1 pattern).

// Highlight colors in HIGHLIGHT mode (multiply).
// Light gray creates a white-ish tint on most building textures.
const HOVER_COLOR = Cesium.Color.fromBytes(220, 220, 220, 255);
const SELECTED_COLOR = Cesium.Color.fromBytes(200, 200, 200, 255);
const RESTORE_COLOR = Cesium.Color.WHITE;

interface HighlightRef {
  feature: Cesium.Cesium3DTileFeature;
  tileset: Cesium.Cesium3DTileset;
  tile: Cesium.Cesium3DTile;
  featureId: number;
  color: Cesium.Color;
  onTileVisible: (t: Cesium.Cesium3DTile) => void;
  onTileUnload: (t: Cesium.Cesium3DTile) => void;
}

let hoveredRef: HighlightRef | null = null;
let selectedRef: HighlightRef | null = null;

function isSameFeature(
  a: Cesium.Cesium3DTileFeature | null,
  b: Cesium.Cesium3DTileFeature | null,
): boolean {
  if (!a || !b) return false;
  try {
    return a === b;
  } catch {
    return false;
  }
}

function clearRef(ref: "hover" | "selected"): void {
  const current = ref === "hover" ? hoveredRef : selectedRef;
  if (!current) return;
  if (ref === "hover") hoveredRef = null;
  else selectedRef = null;

  // Remove persistence listeners
  try {
    current.tileset.tileVisible.removeEventListener(current.onTileVisible);
  } catch {}
  try {
    current.tileset.tileUnload.removeEventListener(current.onTileUnload);
  } catch {}

  // Only restore if the OTHER track isn't holding this same feature
  const other = ref === "hover" ? selectedRef : hoveredRef;
  if (!isSameFeature(current.feature, other?.feature ?? null)) {
    try {
      const f = current.feature;
      if (f && f.color) f.color = RESTORE_COLOR;
    } catch {}
  }
  governorRequestRender("building-highlight");
}

function applyHighlight(
  feature: Cesium.Cesium3DTileFeature,
  color: Cesium.Color,
  ref: "hover" | "selected",
): void {
  if (ref === "hover" && hoveredRef) clearRef("hover");
  if (ref === "selected" && selectedRef) clearRef("selected");

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

  const featureId = feature.featureId ?? 0;

  const onTileVisible = (t: Cesium.Cesium3DTile) => {
    const active = ref === "hover" ? hoveredRef : selectedRef;
    if (!active || t !== active.tile) return;
    try {
      if (!t.content.ready) return;
      const f = t.content.getFeature(active.featureId);
      if (f && f.color) f.color = active.color;
    } catch {}
  };
  const onTileUnload = (t: Cesium.Cesium3DTile) => {
    const active = ref === "hover" ? hoveredRef : selectedRef;
    if (t === active?.tile) {
      // Tile unloaded: keep the ref so tileVisible can re-apply when
      // the tile reloads. The feature object is stale but featureId
      // stays the same.
    }
  };

  const newRef: HighlightRef = {
    feature,
    tileset,
    tile,
    featureId,
    color,
    onTileVisible,
    onTileUnload,
  };

  tileset.tileVisible.addEventListener(onTileVisible);
  tileset.tileUnload.addEventListener(onTileUnload);

  if (ref === "hover") hoveredRef = newRef;
  else selectedRef = newRef;

  try {
    feature.color = color;
  } catch {}
  governorRequestRender("building-highlight");
}

// --- Hover highlight (transient) ---

export function highlightBuilding(
  feature: Cesium.Cesium3DTileFeature | null,
): void {
  if (hoveredRef) clearRef("hover");
  if (!feature) return;
  if (isSameFeature(feature, selectedRef?.feature ?? null)) return;
  applyHighlight(feature, HOVER_COLOR, "hover");
}

// --- Selected highlight (persistent) ---

export function selectBuilding(
  feature: Cesium.Cesium3DTileFeature | null,
): void {
  if (selectedRef) clearRef("selected");
  if (!feature) return;
  if (isSameFeature(feature, hoveredRef?.feature ?? null)) {
    clearRef("hover");
  }
  applyHighlight(feature, SELECTED_COLOR, "selected");
}

export function deselectBuilding(): void {
  if (selectedRef) clearRef("selected");
}

export function clearBuildingHighlight(): void {
  if (hoveredRef) clearRef("hover");
  if (selectedRef) clearRef("selected");
}
