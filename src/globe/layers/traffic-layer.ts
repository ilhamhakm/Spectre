import * as Cesium from "cesium";
import type { RoadSegment } from "@/lib/sources/overpass";
import type { VehicleSeed } from "@/lib/sources/traffic";

// Traffic layer — renders moving vehicle dots (PointPrimitiveCollection)
// animated along OSM road polylines. The server (via /api/traffic) ships a
// snapshot of vehicle seeds every ~30s; between snapshots the client
// advances each vehicle along its road by `speed × dt / segmentLength`.
//
// Does NOT render road lines themselves — that's roads-layer.ts. This
// layer is purely the moving dots overlay, plus it feeds congestion values
// back into roads-layer for green/yellow/red recoloring (handled by
// CesiumGlobe, not here).
//
// Performance: a single PointPrimitiveCollection batches all dots into one
// draw call. 1k–5k vehicles runs at 60fps in Sandcastle demos.

const EARTH_R = 6378137;
const DEG = Math.PI / 180;

function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// Per-vehicle animated state. Allocated once per vehicle seed; mutated
// in place every frame to avoid GC churn.
interface VehicleState {
  roadId: number;
  // Index into the road's coordinates array — the segment [segIdx, segIdx+1].
  segIdx: number;
  // Parametric position [0..1] along the current segment.
  t: number;
  // Speed in m/s (already discounted by congestion at server time).
  speed: number;
  // Cached segment length (meters) — recomputed when segIdx changes.
  segLen: number;
  // Backing PointPrimitive handle (mutated in place).
  point: Cesium.PointPrimitive;
}

export interface TrafficLayerHandle {
  setRoads(roads: RoadSegment[]): void;
  setVehicles(vehicles: VehicleSeed[]): void;
  setShow(visible: boolean): void;
  destroy(): void;
}

export function mountTrafficLayer(
  viewer: Cesium.Viewer,
): TrafficLayerHandle {
  const points = viewer.scene.primitives.add(
    new Cesium.PointPrimitiveCollection(),
  );
  if (!points) throw new Error("Failed to attach traffic primitives");

  // Road cache: roadId → { coords, segment lengths, total length }
  const roads = new Map<
    number,
    { coords: { lat: number; lon: number }[]; segLens: number[]; total: number }
  >();

  // Live vehicle states — allocated lazily on setVehicles().
  const vehicles: VehicleState[] = [];
  let shown = true;
  let lastTime: Cesium.JulianDate | null = null;

  // Pre-allocate scratch cartesian to avoid per-frame allocation.
  const scratchA = new Cesium.Cartesian3();
  const scratchB = new Cesium.Cartesian3();
  function buildRoadCache(roadList: RoadSegment[]): void {
    roads.clear();
    for (const road of roadList) {
      if (road.coordinates.length < 2) continue;
      const segLens: number[] = [];
      let total = 0;
      for (let i = 1; i < road.coordinates.length; i++) {
        const d = haversine(
          road.coordinates[i - 1].lat,
          road.coordinates[i - 1].lon,
          road.coordinates[i].lat,
          road.coordinates[i].lon,
        );
        segLens.push(d);
        total += d;
      }
      roads.set(road.id, {
        coords: road.coordinates,
        segLens,
        total,
      });
    }
  }

  function setRoads(roadList: RoadSegment[]): void {
    buildRoadCache(roadList);
    // Rebind existing vehicles to new road cache if their roadId reappeared.
    for (const v of vehicles) {
      const r = roads.get(v.roadId);
      if (!r) continue;
      v.segIdx = 0;
      v.t = 0;
      v.segLen = r.segLens[0] || 1;
      placeVehicle(v, r);
    }
    viewer.scene.requestRender();
  }

  function setVehicles(seeds: VehicleSeed[]): void {
    // Tear down existing points.
    points.removeAll();
    vehicles.length = 0;

    for (const seed of seeds) {
      const r = roads.get(seed.roadId);
      if (!r || r.coords.length < 2) continue;

      // Pick initial segment proportional to seed.t across the whole road.
      let dist = seed.t * r.total;
      let segIdx = 0;
      while (segIdx < r.segLens.length - 1 && dist > r.segLens[segIdx]) {
        dist -= r.segLens[segIdx];
        segIdx++;
      }
      const segLen = r.segLens[segIdx] || 1;
      const t = Math.max(0, Math.min(1, dist / segLen));

      const point = points.add({
        position: new Cesium.Cartesian3(0, 0, 0),
        color: Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 230),
        pixelSize: 4,
        show: shown,
        // Keep dots visible at the same altitudes roads are visible (up to
        // 1500km). Previous values shrank dots to 0.4x and faded them to 0.3
        // opacity by 500km/1000km — effectively invisible. Now we keep a
        // gentle scale-down so they don't dominate when zoomed in, but
        // remain visible at country-level views.
        scaleByDistance: new Cesium.NearFarScalar(1e3, 1.0, 1.5e6, 0.7),
        translucencyByDistance: new Cesium.NearFarScalar(1e3, 1.0, 1.5e6, 0.8),
        disableDepthTestDistance: 50_000,
      });
      if (!point) continue;

      const v: VehicleState = {
        roadId: seed.roadId,
        segIdx,
        t,
        speed: seed.speed,
        segLen,
        point,
      };
      placeVehicle(v, r);
      vehicles.push(v);
    }
    viewer.scene.requestRender();
  }

  function placeVehicle(
    v: VehicleState,
    r: { coords: { lat: number; lon: number }[]; segLens: number[] },
  ): void {
    const a = r.coords[v.segIdx];
    const b = r.coords[v.segIdx + 1];
    if (!a || !b) return;
    // Slight altitude offset (5m) to keep dots above the road surface.
    Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 5, Cesium.Ellipsoid.WGS84, scratchA);
    Cesium.Cartesian3.fromDegrees(b.lon, b.lat, 5, Cesium.Ellipsoid.WGS84, scratchB);
    Cesium.Cartesian3.lerp(scratchA, scratchB, v.t, scratchA);
    v.point.position = scratchA.clone(v.point.position);
  }

  // Animation loop — advances each vehicle along its road by speed × dt.
  // Throttled to ~10fps (skip every other frame) to keep CPU/GPU usage
  // reasonable when 1000+ vehicles are active.
  let frameSkip = false;
  function onPreUpdate(scene: Cesium.Scene, time: Cesium.JulianDate): void {
    if (!shown || vehicles.length === 0) return;
    // Skip every other frame — vehicles update at ~30fps instead of 60.
    frameSkip = !frameSkip;
    if (frameSkip) return;

    let dt: number;
    if (lastTime) {
      dt = Math.max(0, Math.min(0.5, Cesium.JulianDate.secondsDifference(time, lastTime)));
    } else {
      dt = 0;
    }
    lastTime = Cesium.JulianDate.clone(time, lastTime ?? undefined);

    if (dt === 0) return;

    let needsRender = false;
    for (const v of vehicles) {
      const r = roads.get(v.roadId);
      if (!r) continue;

      // Advance along current segment.
      v.t += (v.speed * dt) / Math.max(1, v.segLen);

      // Cross segment boundary if needed.
      while (v.t >= 1 && v.segIdx < r.segLens.length - 1) {
        v.t -= 1;
        v.segIdx++;
        v.segLen = r.segLens[v.segIdx] || 1;
      }
      // Wrap to start if we've run off the end of the road.
      if (v.t >= 1) {
        v.segIdx = 0;
        v.t = 0;
        v.segLen = r.segLens[0] || 1;
      }

      placeVehicle(v, r);
      needsRender = true;
    }

    if (needsRender) viewer.scene.requestRender();
  }

  viewer.scene.preUpdate.addEventListener(onPreUpdate);

  function setShow(visible: boolean): void {
    shown = visible;
    points.show = visible;
    viewer.scene.requestRender();
  }

  function destroy(): void {
    viewer.scene.preUpdate.removeEventListener(onPreUpdate);
    viewer.scene.primitives.remove(points);
    vehicles.length = 0;
    roads.clear();
    lastTime = null;
  }

  return { setRoads, setVehicles, setShow, destroy };
}
