import * as Cesium from "cesium";

// OSM Buildings (Ion asset 96188) exposes its OSM tags as per-feature batch
// table properties. This module picks a building feature under a screen
// coordinate and reads the tags the hover/click handlers need.

export interface BuildingPickData {
  name: string | null;
  height: number | null;
  building: string | null;
  elementId: string | null;
  addrStreet: string | null;
  addrHouse: string | null;
  // Full tag bag for the right-panel detail card (start_date, operator,
  // website, wikipedia, building:levels, roof:shape, etc.).
  tags: Record<string, string | number>;
}

function readString(feature: Cesium.Cesium3DTileFeature, k: string): string | null {
  try {
    if (!feature.hasProperty(k)) return null;
    const v = feature.getProperty(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function readNumber(feature: Cesium.Cesium3DTileFeature, k: string): number | null {
  try {
    if (!feature.hasProperty(k)) return null;
    const v = feature.getProperty(k);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Reads the surfaced tags plus the full bag of every other string/number
// property on the feature, so the detail panel can show whatever OSM knows
// (age, operator, website, wikipedia, levels, roof, material, etc.).
function readBuildingProperties(feature: Cesium.Cesium3DTileFeature): BuildingPickData {
  const tags: Record<string, string | number> = {};
  try {
    const ids = (feature as unknown as { getPropertyIds?: () => Iterable<string> })
      .getPropertyIds?.() ?? [];
    for (const k of ids) {
      try {
        const v = feature.getProperty(k);
        if (typeof v === "string" && v.trim()) {
          tags[k] = v.trim();
        } else if (typeof v === "number" && Number.isFinite(v)) {
          tags[k] = v;
        }
      } catch {
        // skip unreadable property
      }
    }
  } catch {
    // getPropertyIds not available: fall back to surfaced fields only
  }

  return {
    name: readString(feature, "name"),
    height: readNumber(feature, "height"),
    building: readString(feature, "building"),
    elementId: readString(feature, "elementId"),
    addrStreet: readString(feature, "addr:street"),
    addrHouse: readString(feature, "addr:housenumber"),
    tags,
  };
}

export interface BuildingPickResult {
  feature: Cesium.Cesium3DTileFeature;
  data: BuildingPickData;
}

// Picks the OSM Buildings feature at (x, y). Returns null when nothing
// pickable is there or the picked primitive is not a 3D tile feature.
export function pickBuilding(
  viewer: Cesium.Viewer,
  x: number,
  y: number,
): BuildingPickResult | null {
  if (viewer.isDestroyed()) return null;
  let picked: unknown;
  try {
    picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
  } catch {
    return null;
  }
  if (!Cesium.defined(picked)) return null;
  if (!(picked instanceof Cesium.Cesium3DTileFeature)) return null;
  return {
    feature: picked,
    data: readBuildingProperties(picked),
  };
}
