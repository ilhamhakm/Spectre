import * as Cesium from "cesium";
import type { KartaviewPhoto } from "@/lib/sources/kartaview";

// KartaView layer: renders street-level photo positions as cyan dots.
// Simpler than the CCTV layer: no POV cones, no road-snapping. Dots are
// gated by camera altitude (labels below 100km, dots below 500km) so the
// globe stays uncluttered at country/world view.

const KARTAVIEW_COLOR = Cesium.Color.fromBytes(0x00, 0xd4, 0xff, 220);
const LABEL_ALTITUDE_GATE = 100_000;
const DOT_ALTITUDE_GATE = 500_000;

export interface KartaviewLayerHandle {
  setPhotos(photos: KartaviewPhoto[]): void;
  setShow(visible: boolean): void;
  destroy(): void;
}

export function mountKartaviewLayer(
  viewer: Cesium.Viewer,
): KartaviewLayerHandle {
  const dots = viewer.scene.primitives.add(new Cesium.LabelCollection());
  if (!dots) throw new Error("Failed to attach KartaView dots");
  const labels = viewer.scene.primitives.add(new Cesium.LabelCollection());
  if (!labels) throw new Error("Failed to attach KartaView labels");

  const dotMap = new Map<string, Cesium.Label>();
  const labelMap = new Map<string, Cesium.Label>();
  let shown = true;

  function setPhotos(photos: KartaviewPhoto[]): void {
    const seen = new Set<string>();
    const cameraHeight = viewer.camera.positionCartographic.height;
    const showLabels = cameraHeight < LABEL_ALTITUDE_GATE;
    const showDots = cameraHeight < DOT_ALTITUDE_GATE;

    for (const p of photos) {
      seen.add(p.id);
      const position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 10);

      if (showDots) {
        const existingDot = dotMap.get(p.id);
        if (!existingDot) {
          const d = dots.add({
            id: `kv_${p.id}`,
            position,
            text: "●",
            font: "14px sans-serif",
            fillColor: KARTAVIEW_COLOR,
            outlineColor: Cesium.Color.fromBytes(5, 6, 10, 200),
            outlineWidth: 1,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            pixelOffset: new Cesium.Cartesian2(0, 0),
            scaleByDistance: new Cesium.NearFarScalar(1_000, 1, 500_000, 0.4),
          });
          if (d) dotMap.set(p.id, d);
        } else {
          existingDot.position = position;
          existingDot.show = shown;
        }
      } else {
        const existingDot = dotMap.get(p.id);
        if (existingDot) existingDot.show = false;
      }

      const existingLabel = labelMap.get(p.id);
      if (showLabels && p.shotDate) {
        if (!existingLabel) {
          const l = labels.add({
            id: `kvlbl_${p.id}`,
            position,
            text: p.shotDate,
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
          if (l) labelMap.set(p.id, l);
        } else {
          existingLabel.position = position;
          existingLabel.show = shown;
        }
      } else if (existingLabel) {
        existingLabel.show = false;
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

    viewer.scene.requestRender();
  }

  function setShow(visible: boolean): void {
    shown = visible;
    dots.show = visible;
    labels.show = visible;
    viewer.scene.requestRender();
  }

  function destroy(): void {
    viewer.scene.primitives.remove(dots);
    viewer.scene.primitives.remove(labels);
    dotMap.clear();
    labelMap.clear();
  }

  return { setPhotos, setShow, destroy };
}
