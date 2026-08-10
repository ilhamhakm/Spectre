import * as Cesium from "cesium";
import type { RoadSegment, RoadClass } from "@/lib/sources/overpass";

// Roads layer: renders OpenStreetMap main roads as Cesium polylines.
// Motorways are wider/brighter; tertiary roads are thinner/dimmer.
//
// When traffic congestion data is available (see traffic-layer.ts and
// /api/traffic), call `setCongestion(map)` to recolor the polylines from
// amber (default) to a cyan→yellow→red ramp keyed by congestion (0..1).
//
// This layer does NOT implement the Layer interface (it has a different
// update signature). Use mountRoadsLayer() -> handle.setRoads(roads).

// Default amber ramp (no congestion data yet).
const ROAD_COLORS_DEFAULT: Record<RoadClass, Cesium.Color> = {
  motorway: Cesium.Color.fromBytes(0xff, 0xb3, 0x3a, 230),
  trunk: Cesium.Color.fromBytes(0xff, 0xc8, 0x4d, 220),
  primary: Cesium.Color.fromBytes(0xff, 0xe0, 0x7a, 200),
  secondary: Cesium.Color.fromBytes(0xcf, 0xe2, 0xf3, 180),
  tertiary: Cesium.Color.fromBytes(0xa0, 0xb0, 0xc0, 150),
};

const ROAD_WIDTHS: Record<RoadClass, number> = {
  motorway: 3.0,
  trunk: 2.5,
  primary: 2.0,
  secondary: 1.5,
  tertiary: 1.0,
};

// Map congestion [0..1] to a color on a cyan→yellow→red ramp.
//   0.0  free flow   = #00D4FF (cyan, the Spectre accent)
//   0.4  light       = #7FE5FF (pale cyan)
//   0.6  moderate    = #FFD24D (amber)
//   0.85 heavy       = #FF7A3D (orange-red)
//   1.0  gridlock    = #FF3D3D (red)
function congestionColor(c: number): Cesium.Color {
  const x = Math.max(0, Math.min(1, c));
  // Piecewise linear RGB blend through the ramp above.
  const stops: [number, [number, number, number]][] = [
    [0.0, [0x00, 0xd4, 0xff]],
    [0.4, [0x7f, 0xe5, 0xff]],
    [0.6, [0xff, 0xd2, 0x4d]],
    [0.85, [0xff, 0x7a, 0x3d]],
    [1.0, [0xff, 0x3d, 0x3d]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i - 1];
    const [t2, c2] = stops[i];
    if (x <= t2) {
      const f = (x - t1) / (t2 - t1);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
      return Cesium.Color.fromBytes(r, g, b, 230);
    }
  }
  return Cesium.Color.fromBytes(0xff, 0x3d, 0x3d, 230);
}

export interface RoadsLayerHandle {
  setRoads(roads: RoadSegment[]): void;
  setCongestion(map: Record<number, number>): void;
  setVisibleClasses(classes: Set<string>): void;
  setShow(visible: boolean): void;
  destroy(): void;
}

interface RoadEntry {
  polyline: Cesium.Polyline;
  class: RoadClass;
}

export function mountRoadsLayer(viewer: Cesium.Viewer): RoadsLayerHandle {
  const collection = viewer.scene.primitives.add(
    new Cesium.PolylineCollection(),
  );
  if (!collection) throw new Error("Failed to attach roads primitives");

  const roads = new Map<number, RoadEntry>();
  let shown = true;
  let visibleClasses: Set<string> = new Set(); // empty = all visible

  function setRoads(roadList: RoadSegment[]): void {
    const seen = new Set<number>();

    for (const road of roadList) {
      seen.add(road.id);
      if (road.coordinates.length < 2) continue;

      const positions = road.coordinates.map((c) =>
        Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 5),
      );
      const cls = road.class;
      const width = ROAD_WIDTHS[cls] ?? 1.5;

      // Check if this class is visible (empty set = all visible)
      const classVisible = visibleClasses.size === 0 || visibleClasses.has(cls);

      const existing = roads.get(road.id);
      if (existing) {
        existing.polyline.positions = positions;
        existing.polyline.width = width;
        existing.polyline.show = classVisible;
        existing.polyline.material = Cesium.Material.fromType("Color", {
          color: ROAD_COLORS_DEFAULT[cls] ?? ROAD_COLORS_DEFAULT.secondary,
        });
        existing.class = cls;
      } else {
        const poly = collection.add({
          id: `road_${road.id}`,
          positions,
          width,
          show: classVisible,
          material: Cesium.Material.fromType("Color", {
            color: ROAD_COLORS_DEFAULT[cls] ?? ROAD_COLORS_DEFAULT.secondary,
          }),
        });
        if (poly) roads.set(road.id, { polyline: poly, class: cls });
      }
    }

    // Remove vanished roads
    for (const [id, entry] of roads) {
      if (!seen.has(id)) {
        collection.remove(entry.polyline);
        roads.delete(id);
      }
    }

    viewer.scene.requestRender();
  }

  function setCongestion(map: Record<number, number>): void {
    let changed = false;
    for (const [idStr, c] of Object.entries(map)) {
      const id = Number(idStr);
      const entry = roads.get(id);
      if (!entry) continue;
      entry.polyline.material = Cesium.Material.fromType("Color", {
        color: congestionColor(c),
      });
      changed = true;
    }
    if (changed) viewer.scene.requestRender();
  }

  function setShow(visible: boolean): void {
    shown = visible;
    collection.show = visible;
    viewer.scene.requestRender();
  }

  function setVisibleClasses(classes: Set<string>): void {
    visibleClasses = classes;
    // Update show state for all existing polylines.
    // Empty set = no roads visible (user toggled all off).
    for (const [, entry] of roads) {
      entry.polyline.show = classes.has(entry.class);
    }
    viewer.scene.requestRender();
  }

  function destroy(): void {
    viewer.scene.primitives.remove(collection);
    roads.clear();
  }

  return { setRoads, setCongestion, setVisibleClasses, setShow, destroy };
}
