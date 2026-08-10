import * as Cesium from "cesium";

export interface BuildingPickData {
  name: string | null;
  height: number | null;
  building: string | null;
  elementId: string | null;
  addrStreet: string | null;
  addrHouse: string | null;
}

export interface PickResult {
  id: string;
  kind: "cctv" | "event" | "flight-private" | "flight-mil" | "building" | "satellite" | null;
  building?: BuildingPickData;
}

// OSM Buildings (ion asset 96188) exposes its OSM tags as per-feature batch
// properties. Read the ones we surface in the hover popup.
function readBuildingProperties(feature: Cesium.Cesium3DTileFeature): BuildingPickData {
  const get = (k: string): string | null => {
    try {
      if (!feature.hasProperty(k)) return null;
      const v = feature.getProperty(k);
      return typeof v === "string" && v.trim() ? v.trim() : null;
    } catch {
      return null;
    }
  };
  const getNum = (k: string): number | null => {
    try {
      if (!feature.hasProperty(k)) return null;
      const v = feature.getProperty(k);
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  const id = get("elementId");
  return {
    name: get("name"),
    height: getNum("height"),
    building: get("building"),
    elementId: id,
    addrStreet: get("addr:street"),
    addrHouse: get("addr:housenumber"),
  };
}

// Wrapper around scene.pick that routes the picked id by prefix:
//   cctv_          → "cctv"
//   cctvlbl_       → "cctv"
//   evt_           → "event"          (legacy single-event)
//   evtlbl_        → "event"           (legacy single-event label)
//   evtcluster_    → "event"           (clustered events)
//   evtclusterlbl_ → "event"           (clustered events label)
//   flt_           → "flight-private"
//   fltlbl_        → "flight-private"
//   mil_           → "flight-mil"
//   millbl_        → "flight-mil"
//   lbl_           → legacy label prefix — strip 4 chars, kind null
//   Cesium3DTileFeature → "building"   (OSM Buildings hover)
//   everything else → null
//
// Returns null when nothing pickable is at (x, y).
export function pickAt(
  viewer: Cesium.Viewer,
  x: number,
  y: number
): PickResult | null {
  const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
  if (!Cesium.defined(picked)) return null;

  // 3D Tiles feature — this is the OSM Buildings tileset. Read its OSM
  // tags so the hover popup can name the building. (picked.id is undefined
  // on tile features, hence the early return before the prefix routing.)
  if (picked instanceof Cesium.Cesium3DTileFeature) {
    const building = readBuildingProperties(picked as Cesium.Cesium3DTileFeature);
    return {
      id: building.elementId ?? `bldg_${x}_${y}`,
      kind: "building",
      building,
    };
  }

  if (!Cesium.defined(picked.id)) return null;

  let id = String(picked.id);

  if (id.startsWith("cctvlbl_")) {
    return { id: id.slice(8), kind: "cctv" };
  }
  if (id.startsWith("cctv_")) {
    return { id: id.slice(5), kind: "cctv" };
  }
  if (id.startsWith("evtclusterlbl_")) {
    return { id: id.slice(14), kind: "event" };
  }
  if (id.startsWith("evtcluster_")) {
    return { id: id.slice(11), kind: "event" };
  }
  if (id.startsWith("evtlbl_")) {
    return { id: id.slice(7), kind: "event" };
  }
  if (id.startsWith("evt_")) {
    return { id: id.slice(4), kind: "event" };
  }
  if (id.startsWith("fltlbl_")) {
    return { id: id.slice(7), kind: "flight-private" };
  }
  if (id.startsWith("flt_")) {
    return { id: id.slice(4), kind: "flight-private" };
  }
  if (id.startsWith("millbl_")) {
    return { id: id.slice(7), kind: "flight-mil" };
  }
  if (id.startsWith("mil_")) {
    return { id: id.slice(4), kind: "flight-mil" };
  }
  if (id.startsWith("sat-trajectory-")) {
    return { id: id.slice(15), kind: "satellite" };
  }
  if (id.startsWith("sat-track-")) {
    return { id: id.slice(10), kind: "satellite" };
  }
  if (id.startsWith("sat-")) {
    return { id: id.slice(4), kind: "satellite" };
  }
  if (id.startsWith("lbl_")) {
    id = id.slice(4);
  }
  return { id, kind: null };
}
