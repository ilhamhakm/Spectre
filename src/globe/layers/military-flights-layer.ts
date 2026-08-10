import * as Cesium from "cesium";
import type { MilitaryFlight } from "@/lib/sources/airplanes-live";
import { getAirplaneIcon, MILITARY_FLIGHT_COLOR } from "@/globe/textures/airplane-icon";

// Military flights layer: renders live military aircraft from airplanes.live
// /mil endpoint as airplane Billboard icons (rotated by heading) with
// callsign + type labels. Mirrors flights-layer.ts.
//
// Military: red-orange (#ff5533) — strong, alert-like.

const LABEL_FILL = Cesium.Color.fromBytes(0xff, 0xff, 0xff, 220);
const LABEL_OUTLINE = Cesium.Color.fromBytes(0, 0, 0, 180);

export interface MilitaryLayerHandle {
  setFlights(flights: MilitaryFlight[]): void;
  setShow(visible: boolean): void;
  // Solo mode hides every military plane (used while the user tracks a
  // private jet — only that one plane + its arc stay on the globe). Pass
  // true to hide all, false to restore.
  setSoloMode(active: boolean): void;
  destroy(): void;
}

export function mountMilitaryLayer(viewer: Cesium.Viewer): MilitaryLayerHandle {
  const billboards = viewer.scene.primitives.add(
    new Cesium.BillboardCollection(),
  );
  const labels = viewer.scene.primitives.add(
    new Cesium.LabelCollection(),
  );

  if (!billboards || !labels) {
    throw new Error("Failed to attach military primitives");
  }

  const icon = getAirplaneIcon(MILITARY_FLIGHT_COLOR);
  const billboardMap = new Map<string, Cesium.Billboard>();
  const labelMap = new Map<string, Cesium.Label>();
  let shown = true;
  let soloMode = false;

  function setSoloMode(active: boolean): void {
    if (soloMode === active) return;
    soloMode = active;
    for (const b of billboardMap.values()) b.show = !soloMode;
    for (const l of labelMap.values()) l.show = !soloMode;
    viewer.scene.requestRender();
  }

  function setFlights(flights: MilitaryFlight[]): void {
    const seen = new Set<string>();
    const cameraHeight = viewer.camera.positionCartographic.height;
    const showLabels = cameraHeight < 200_000; // only label below 200km
    const scale = cameraHeight > 1_000_000 ? 0.55
                 : cameraHeight > 300_000 ? 0.7
                 : 0.85;
    // In solo mode military planes are hidden entirely.
    const soloVisible = !soloMode;

    for (const f of flights) {
      // Deduplicate by icao24 — same aircraft may appear twice in mlat + adsb
      const key = f.icao24 || `${f.callsign}|${f.latitude.toFixed(3)}`;
      seen.add(key);
      const position = Cesium.Cartesian3.fromDegrees(
        f.longitude,
        f.latitude,
        (f.altitude ?? 1000) + 50,
      );
      const rotation = (f.heading * Math.PI) / 180;

      const existing = billboardMap.get(key);
      if (!existing) {
        const b = billboards.add({
          id: `mil_${key}`,
          position,
          image: icon,
          scale,
          rotation,
          show: soloVisible,
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          heightReference: Cesium.HeightReference.NONE,
          disableDepthTestDistance: 50_000,
        });
        if (b) billboardMap.set(key, b);
      } else {
        existing.position = position;
        existing.rotation = rotation;
        existing.scale = scale;
        existing.show = soloVisible;
      }

      const existingLabel = labelMap.get(key);
      if (showLabels) {
        const altKm = f.altitude != null ? `${(f.altitude / 1000).toFixed(1)}km` : "—";
        // Show callsign (e.g. RCH274) and type code (e.g. C17) when available.
        const text = f.type
          ? `${f.callsign}\n${f.type} · ${altKm}`
          : `${f.callsign}\n${altKm}`;
        const labelVisible = shown && soloVisible;
        if (!existingLabel) {
          const l = labels.add({
            id: `millbl_${key}`,
            position,
            text,
            show: labelVisible,
            font: "10px JetBrains Mono, monospace",
            fillColor: LABEL_FILL,
            outlineColor: LABEL_OUTLINE,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(8, -4),
            disableDepthTestDistance: 50_000,
            showBackground: true,
            backgroundColor: Cesium.Color.fromBytes(40, 5, 30, 200),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
          });
          if (l) labelMap.set(key, l);
        } else {
          existingLabel.position = position;
          existingLabel.text = text;
          existingLabel.show = labelVisible;
        }
      } else if (existingLabel) {
        existingLabel.show = false;
      }
    }

    // Remove vanished flights
    for (const [id, b] of billboardMap) {
      if (!seen.has(id)) {
        billboards.remove(b);
        billboardMap.delete(id);
      }
    }
    for (const [id, l] of labelMap) {
      if (!seen.has(id)) {
        labels.remove(l);
        labelMap.delete(id);
      }
    }

    viewer.scene.requestRender();
  }

  function setShow(visible: boolean): void {
    shown = visible;
    billboards.show = visible;
    labels.show = visible;
    viewer.scene.requestRender();
  }

  function destroy(): void {
    viewer.scene.primitives.remove(billboards);
    viewer.scene.primitives.remove(labels);
    billboardMap.clear();
    labelMap.clear();
  }

  return { setFlights, setShow, setSoloMode, destroy };
}
