import * as Cesium from "cesium";
import type { FlightState } from "@/lib/sources/opensky";
import {
  getAirplaneIcon,
  PRIVATE_FLIGHT_COLOR,
  TRACKED_FLIGHT_COLOR,
} from "@/globe/textures/airplane-icon";

// Flights layer: renders private jets from OpenSky as airplane Billboard
// icons (rotated by heading) with callsign labels. Billboards replace the
// old PointPrimitive dots so the icon actually looks like an aircraft.
//
// Private flights: white (#f0f0f0) — clean, visible on dark imagery.
//
// Billboard.rotation is clockwise radians from north — matches OpenSky's
// true_track heading convention.

const LABEL_FILL = Cesium.Color.fromBytes(0xff, 0xff, 0xff, 220);
const LABEL_OUTLINE = Cesium.Color.fromBytes(0, 0, 0, 180);

export interface FlightsLayerHandle {
  setFlights(flights: FlightState[]): void;
  setShow(visible: boolean): void;
  // Highlights a single callsign in gold (the user-tracked jet). Pass null
  // to clear the highlight.
  setTracked(callsign: string | null): void;
  // Returns the current Cesium position of a flight by icao24.
  // Used by click-to-zoom.
  getFlightPosition(icao24: string): Cesium.Cartesian3 | null;
  destroy(): void;
}

export function mountFlightsLayer(viewer: Cesium.Viewer): FlightsLayerHandle {
  const billboards = viewer.scene.primitives.add(
    new Cesium.BillboardCollection(),
  );
  const labels = viewer.scene.primitives.add(
    new Cesium.LabelCollection(),
  );

  if (!billboards || !labels) {
    throw new Error("Failed to attach flights primitives");
  }

  const icon = getAirplaneIcon(PRIVATE_FLIGHT_COLOR);
  const trackedIcon = getAirplaneIcon(TRACKED_FLIGHT_COLOR);
  const billboardMap = new Map<string, Cesium.Billboard>();
  const labelMap = new Map<string, Cesium.Label>();
  // Tracks the current callsign for each icao24 so setTracked can resolve
  // "which billboard is this callsign?" even when setFlights runs between.
  const callsignOfIcao = new Map<string, string>();
  let shown = true;
  let trackedCallsign: string | null = null;

  function isSolo(): boolean {
    return trackedCallsign != null;
  }

  function setTracked(callsign: string | null): void {
    trackedCallsign = callsign;
    // Resolve the tracked callsign → its icao24 (may be null if that tail
    // isn't currently in the feed — nothing to keep visible then).
    const targetIcao = callsign
      ? [...callsignOfIcao.entries()].find(
          ([, cs]) => cs.toUpperCase() === callsign.toUpperCase(),
        )?.[0] ?? null
      : null;
    // Re-apply visibility + image to every billboard. Solo mode hides ALL
    // other planes so only the tracked jet and its origin→destination arc
    // remain on the globe.
    const cameraHeight = viewer.camera.positionCartographic.height;
    const trackedScale = cameraHeight > 1_000_000 ? 0.55
                       : cameraHeight > 300_000 ? 0.7
                       : 0.85;
    for (const [id, b] of billboardMap) {
      const isTracked = callsign != null && id === targetIcao;
      b.show = !isSolo() || isTracked;
      (b as { image: unknown }).image = isTracked ? trackedIcon : icon;
      b.scale = isTracked ? trackedScale : b.scale;
    }
    for (const [id, l] of labelMap) {
      const isTracked = callsign != null && id === targetIcao;
      l.show = !isSolo() ? shown : isTracked;
    }
    viewer.scene.requestRender();
  }

  function setFlights(flights: FlightState[]): void {
    const seen = new Set<string>();
    const cameraHeight = viewer.camera.positionCartographic.height;
    const showLabels = cameraHeight < 200_000; // only label below 200km
    // Smaller, proportional icon scales. The previous values (0.55/0.7/0.85)
    // made the planes look comically large against the globe. New values
    // keep the plane visible at distance without dominating the view.
    const baseScale = cameraHeight > 1_000_000 ? 0.32
                     : cameraHeight > 300_000 ? 0.42
                     : 0.52;
    // Tracked jet: slightly larger so it stands out, but still proportional.
    const trackedScale = cameraHeight > 1_000_000 ? 0.55
                       : cameraHeight > 300_000 ? 0.7
                       : 0.85;

    for (const f of flights) {
      seen.add(f.icao24);
      callsignOfIcao.set(f.icao24, f.callsign);
      // Grounded planes: render at ground level (5m) so the icon sits on
      // the terrain instead of floating ~1km above. Airborne planes use
      // their reported baro altitude + 50m offset.
      const groundAlt = f.onGround ? 5 : (f.altitude ?? 1000) + 50;
      const position = Cesium.Cartesian3.fromDegrees(
        f.longitude,
        f.latitude,
        groundAlt,
      );
      const rotation = (f.heading * Math.PI) / 180; // degrees → radians, CW from north
      const isTracked = trackedCallsign != null && f.callsign.toUpperCase() === trackedCallsign;
      // Grounded planes render slightly smaller — they're parked, not flying.
      const groundScale = f.onGround ? 0.7 : 1.0;
      const scale = (isTracked ? trackedScale : baseScale) * groundScale;
      // In solo mode hide every plane except the tracked one.
      const soloVisible = !isSolo() || isTracked;

      const existing = billboardMap.get(f.icao24);
      if (!existing) {
        const b = billboards.add({
          id: `flt_${f.icao24}`,
          position,
          image: (isTracked ? trackedIcon : icon) as unknown as string,
          scale,
          rotation,
          show: soloVisible,
          // Screen-aligned rotation so the icon turns with the aircraft's
          // heading regardless of camera pitch.
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          heightReference: Cesium.HeightReference.NONE,
          disableDepthTestDistance: 50_000,
        });
        if (b) billboardMap.set(f.icao24, b);
      } else {
        existing.position = position;
        existing.rotation = rotation;
        existing.scale = scale;
        existing.show = soloVisible;
        (existing as { image: unknown }).image = isTracked ? trackedIcon : icon;
      }

      const existingLabel = labelMap.get(f.icao24);
      if (showLabels) {
        const altKm = f.altitude != null ? `${(f.altitude / 1000).toFixed(1)}km` : "—";
        const text = `${f.callsign}\n${altKm}`;
        const labelVisible = shown && soloVisible;
        if (!existingLabel) {
          const l = labels.add({
            id: `fltlbl_${f.icao24}`,
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
            backgroundColor: Cesium.Color.fromBytes(20, 20, 20, 180),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
          });
          if (l) labelMap.set(f.icao24, l);
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
        callsignOfIcao.delete(id);
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

  function getFlightPosition(icao24: string): Cesium.Cartesian3 | null {
    const b = billboardMap.get(icao24);
    if (!b) return null;
    const pos = b.position;
    return pos instanceof Cesium.Cartesian3 ? pos : null;
  }

  function destroy(): void {
    viewer.scene.primitives.remove(billboards);
    viewer.scene.primitives.remove(labels);
    billboardMap.clear();
    labelMap.clear();
  }

  return { setFlights, setShow, setTracked, getFlightPosition, destroy };
}
