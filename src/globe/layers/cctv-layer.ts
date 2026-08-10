import * as Cesium from "cesium";
import type { CctvCamera } from "@/lib/sources/cctv";
import { hashHeadingDeg } from "@/lib/sources/cctv";
import type { RoadSegment } from "@/lib/sources/overpass";
import {
  snapToNearestRoad,
  loadHeadingOverrides,
  loadFovOverrides,
} from "@/lib/camera-calibration";

// CCTV layer: renders camera markers as cyan dots + optional POV
// wireframe pyramids. The active source filter and territory bounds are
// managed externally (store + CesiumGlobe); this layer just renders
// whatever cameras it receives.

const CCTV_COLOR = Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 220);
const CCTV_COLOR_SENSITIVE = Cesium.Color.fromBytes(0x80, 0x80, 0x80, 100);
const CONE_COLOR = Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 90);
const CONE_ALTITUDE_GATE = 100_000;
const CONE_DISTANCE = 30;
const MAX_CONES = 2000;

export interface CctvLayerHandle {
  setCameras(cameras: CctvCamera[]): void;
  setRoads(roads: RoadSegment[]): void;
  setShow(visible: boolean): void;
  destroy(): void;
}

function enuToFixed(
  frame: Cesium.Matrix4,
  e: number,
  n: number,
  u: number,
): Cesium.Cartesian3 {
  return Cesium.Matrix4.multiplyByPoint(
    frame,
    new Cesium.Cartesian3(e, n, u),
    new Cesium.Cartesian3(),
  );
}

// Builds the wireframe edges of the camera POV pyramid: apex at the lens,
// base square D meters ahead along `headingDeg`, half-size D*tan(fov/2).
function buildPyramidEdges(
  lonRad: number,
  latRad: number,
  headingDeg: number,
  fovDeg: number,
): Cesium.Cartesian3[][] {
  const h = (headingDeg * Math.PI) / 180;
  const half = (fovDeg * Math.PI) / 360;
  const D = CONE_DISTANCE;
  const W = D * Math.tan(half);

  const apex = Cesium.Cartesian3.fromRadians(lonRad, latRad, 30);
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromRadians(lonRad, latRad, 0),
  );

  // View direction (ENU): east*sin(h) + north*cos(h); its horizontal
  // perpendicular is east*cos(h) - north*sin(h).
  const vE = Math.sin(h);
  const vN = Math.cos(h);
  const rE = Math.cos(h);
  const rN = -Math.sin(h);
  const cE = vE * D;
  const cN = vN * D;

  const corners = [
    enuToFixed(frame, cE + rE * W, cN + rN * W, W),
    enuToFixed(frame, cE + rE * W, cN + rN * W, -W),
    enuToFixed(frame, cE - rE * W, cN - rN * W, -W),
    enuToFixed(frame, cE - rE * W, cN - rN * W, W),
  ];

  return [
    [apex, corners[0]],
    [apex, corners[1]],
    [apex, corners[2]],
    [apex, corners[3]],
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
}

export function mountCctvLayer(viewer: Cesium.Viewer): CctvLayerHandle {
  const dots = viewer.scene.primitives.add(
    new Cesium.LabelCollection(),
  );
  if (!dots) throw new Error("Failed to attach CCTV dots");
  const labels = viewer.scene.primitives.add(
    new Cesium.LabelCollection(),
  );
  if (!labels) throw new Error("Failed to attach CCTV labels");
  const cones = viewer.scene.primitives.add(
    new Cesium.PolylineCollection(),
  );
  if (!cones) throw new Error("Failed to attach CCTV cones");

  const dotMap = new Map<string, Cesium.Label>();
  const labelMap = new Map<string, Cesium.Label>();
  const coneMap = new Map<string, Cesium.Polyline[]>();
  let shown = true;
  let currentRoads: RoadSegment[] = [];
  let currentCameras: CctvCamera[] = [];
  const headingOverrides = loadHeadingOverrides();
  const fovOverrides = loadFovOverrides();

  function clearCones(): void {
    for (const lines of coneMap.values()) {
      for (const l of lines) cones.remove(l);
    }
    coneMap.clear();
  }

  // Apply manual overrides → road-snap → hash fallback. Mutates a copy.
  // Road-snap is capped to avoid performance issues with large road sets.
  // Both heading AND position are snapped to the nearest road segment.
  function calibrateCameras(cameras: CctvCamera[]): CctvCamera[] {
    if (!cameras.length) return cameras;
    const hasRoads = currentRoads.length > 0;
    // Skip road-snap if too many roads (would be O(N*M) and freeze UI).
    const canSnap = hasRoads && currentRoads.length <= 500;
    const out: CctvCamera[] = [];
    for (const c of cameras) {
      const ov = headingOverrides[c.id];
      let headingDeg = c.headingDeg;
      let fovDeg = c.fovDeg;
      let lat = c.lat;
      let lon = c.lon;
      if (ov) {
        headingDeg = ov.headingDeg;
        if (ov.fovDeg) fovDeg = ov.fovDeg;
      } else if (canSnap) {
        const snap = snapToNearestRoad(c.lat, c.lon, currentRoads);
        if (snap) {
          headingDeg = snap.headingDeg;
          // Snap position to road if within 50m
          if (snap.snapLat !== undefined && snap.snapLon !== undefined) {
            lat = snap.snapLat;
            lon = snap.snapLon;
          }
        }
      }
      const fovOverride = fovOverrides[c.id];
      if (fovOverride) fovDeg = fovOverride;
      out.push({
        ...c,
        lat,
        lon,
        headingDeg: headingDeg ?? hashHeadingDeg(c.id),
        fovDeg: fovDeg ?? 60,
      });
    }
    return out;
  }

  function setRoads(roads: RoadSegment[]): void {
    currentRoads = roads;
    if (!currentCameras.length) return;
    // Re-render with updated headings.
    for (const id of coneMap.keys()) {
      const lines = coneMap.get(id);
      if (lines) for (const l of lines) cones.remove(l);
    }
    coneMap.clear();
    setCameras(currentCameras);
  }

  function setCameras(cameras: CctvCamera[]): void {
    currentCameras = cameras;
    const calibrated = calibrateCameras(cameras);
    const seen = new Set<string>();
    const cameraHeight = viewer.camera.positionCartographic.height;
    const showLabels = cameraHeight < 100_000;
    const showCones = cameraHeight < CONE_ALTITUDE_GATE;
    let coneBudget = MAX_CONES;

    for (const cam of calibrated) {
      seen.add(cam.id);
      const color = cam.isSensitive ? CCTV_COLOR_SENSITIVE : CCTV_COLOR;
      const position = Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 30);
      const lonRad = (cam.lon * Math.PI) / 180;
      const latRad = (cam.lat * Math.PI) / 180;

      const existingDot = dotMap.get(cam.id);
      if (!existingDot) {
        const d = dots.add({
          id: `cctv_${cam.id}`,
          position,
          text: "●",
          font: "14px sans-serif",
          fillColor: color,
          outlineColor: Cesium.Color.fromBytes(5, 6, 10, 200),
          outlineWidth: 1,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new Cesium.Cartesian2(0, 0),
          scaleByDistance: new Cesium.NearFarScalar(1_000, 1, 500_000, 0.4),
        });
        if (d) dotMap.set(cam.id, d);
      } else {
        existingDot.position = position;
        existingDot.fillColor = color;
      }

      const existingLabel = labelMap.get(cam.id);
      if (showLabels && !cam.isSensitive) {
        if (!existingLabel) {
          const l = labels.add({
            id: `cctvlbl_${cam.id}`,
            position,
            text: cam.name,
            font: "9px JetBrains Mono, monospace",
            fillColor: Cesium.Color.fromBytes(255, 255, 255, 220),
            outlineColor: Cesium.Color.fromBytes(0, 0, 0, 200),
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(6, -2),
            disableDepthTestDistance: 50_000,
            showBackground: true,
            backgroundColor: Cesium.Color.fromBytes(5, 6, 10, 180),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
          });
          if (l) labelMap.set(cam.id, l);
        } else {
          existingLabel.position = position;
          existingLabel.show = shown;
        }
      } else if (existingLabel) {
        existingLabel.show = false;
      }

      // POV pyramid — only for cameras with a live feed, under the altitude
      // gate, and within the per-frame budget.
      const hasFeed = Boolean(cam.snapshotUrl || cam.streamUrl || cam.embedUrl);
      const existingCone = coneMap.get(cam.id);
      if (showCones && hasFeed && !cam.isSensitive && coneBudget > 0) {
        if (!existingCone) {
          const headingDeg = cam.headingDeg ?? hashHeadingDeg(cam.id);
          const fovDeg = cam.fovDeg ?? 60;
          const edges = buildPyramidEdges(lonRad, latRad, headingDeg, fovDeg);
          const lines = edges.map((positions) =>
            cones.add({
              positions,
              width: 1,
              color: CONE_COLOR,
            }),
          );
          const valid = lines.filter(Boolean) as Cesium.Polyline[];
          coneMap.set(cam.id, valid);
          coneBudget -= valid.length;
        } else {
          // Rebuild when heading/fov change (rare) — cheap: keep as-is.
        }
      } else if (existingCone) {
        for (const l of existingCone) cones.remove(l);
        coneMap.delete(cam.id);
      }
    }

    for (const [id, d] of dotMap) {
      if (!seen.has(id)) {
        dots.remove(d);
        dotMap.delete(id);
      }
    }
    for (const [id, l] of labelMap) {
      if (!seen.has(id)) {
        labels.remove(l);
        labelMap.delete(id);
      }
    }
    clearConesForMissing(seen, coneMap, cones);

    viewer.scene.requestRender();
  }

  function setShow(visible: boolean): void {
    shown = visible;
    dots.show = visible;
    labels.show = visible;
    cones.show = visible;
    viewer.scene.requestRender();
  }

  function destroy(): void {
    viewer.scene.primitives.remove(dots);
    viewer.scene.primitives.remove(labels);
    viewer.scene.primitives.remove(cones);
    dotMap.clear();
    labelMap.clear();
    coneMap.clear();
  }

  return { setCameras, setRoads, setShow, destroy };
}

function clearConesForMissing(
  seen: Set<string>,
  coneMap: Map<string, Cesium.Polyline[]>,
  cones: Cesium.PolylineCollection,
): void {
  for (const [id, lines] of coneMap) {
    if (!seen.has(id)) {
      for (const l of lines) cones.remove(l);
      coneMap.delete(id);
    }
  }
}
