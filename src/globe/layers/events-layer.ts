import * as Cesium from "cesium";
import type { ProtestEvent, VerificationLevel } from "@/lib/types";

// Civil unrest layer: renders protests + riots + arrests from /api/events as
// color-coded point primitives with title labels.
//
// CLUSTERING: events within ~100m of each other (lat/lon rounded to 3
// decimal places) are merged into a single representative dot. The dot's
// id is `evtcluster_<lat3>_<lon3>`. The hover popup resolves this id back
// to ALL events in the cluster and shows them as a list.
//
// Color by highest verification level in the cluster:
//   confirmed  → red      #ff4d4d
//   multi      → orange   #ffaa33
//   unconfirmed→ yellow   #ffdd44
//
// Client-side filter: only show civil-unrest event types (protest, riot,
// arrest, shutdown). The /api/events endpoint returns all event types
// including fire/earthquake/other — those don't belong in this layer.

const COLOR_BY_VERIFICATION: Record<VerificationLevel, Cesium.Color> = {
  confirmed: Cesium.Color.fromBytes(0xff, 0x4d, 0x4d, 255),
  multi: Cesium.Color.fromBytes(0xff, 0xaa, 0x33, 255),
  unconfirmed: Cesium.Color.fromBytes(0xff, 0xdd, 0x44, 255),
};

const LABEL_FILL = Cesium.Color.fromBytes(0xff, 0xff, 0xff, 230);
const LABEL_OUTLINE = Cesium.Color.fromBytes(0, 0, 0, 200);

const CIVIL_UNREST_TYPES = new Set(["protest", "riot", "arrest", "shutdown"]);
export { CIVIL_UNREST_TYPES };

// Verification precedence for picking cluster color: confirmed > multi > unconfirmed
const VERIFICATION_RANK: Record<VerificationLevel, number> = {
  confirmed: 3,
  multi: 2,
  unconfirmed: 1,
};

// Round to 3 decimal places (~111m at equator). Events within this
// distance are considered "same location" and merged into one dot.
function clusterKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

interface Cluster {
  key: string;
  lat: number;
  lon: number;
  events: ProtestEvent[];
  // Highest verification level among the cluster's events.
  topVerification: VerificationLevel;
  // Count of events (used for dot sizing + label).
  count: number;
}

function clusterEvents(events: ProtestEvent[]): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const ev of events) {
    if (!CIVIL_UNREST_TYPES.has(ev.type)) continue;
    const key = clusterKey(ev.lat, ev.lon);
    let cluster = map.get(key);
    if (!cluster) {
      cluster = {
        key,
        lat: ev.lat,
        lon: ev.lon,
        events: [],
        topVerification: ev.verificationLevel,
        count: 0,
      };
      map.set(key, cluster);
    }
    cluster.events.push(ev);
    cluster.count++;
    // Promote cluster verification if this event is higher-confidence.
    if (VERIFICATION_RANK[ev.verificationLevel] > VERIFICATION_RANK[cluster.topVerification]) {
      cluster.topVerification = ev.verificationLevel;
    }
  }
  return Array.from(map.values());
}

export interface EventsLayerHandle {
  setEvents(events: ProtestEvent[]): void;
  setShow(visible: boolean): void;
  destroy(): void;
}

export function mountEventsLayer(viewer: Cesium.Viewer): EventsLayerHandle {
  const points = viewer.scene.primitives.add(
    new Cesium.PointPrimitiveCollection(),
  );
  const labels = viewer.scene.primitives.add(
    new Cesium.LabelCollection(),
  );

  if (!points || !labels) {
    throw new Error("Failed to attach events primitives");
  }

  const pointMap = new Map<string, Cesium.PointPrimitive>();
  const labelMap = new Map<string, Cesium.Label>();
  let shown = true;

  function setEvents(events: ProtestEvent[]): void {
    const seen = new Set<string>();
    const cameraHeight = viewer.camera.positionCartographic.height;
    const showLabels = cameraHeight < 300_000; // labels visible up to 300km

    const clusters = clusterEvents(events);

    for (const cluster of clusters) {
      seen.add(cluster.key);
      const color =
        COLOR_BY_VERIFICATION[cluster.topVerification] ??
        COLOR_BY_VERIFICATION.unconfirmed;
      const position = Cesium.Cartesian3.fromDegrees(
        cluster.lon,
        cluster.lat,
        200,
      ); // 200m altitude

      // Size by cluster size — bigger dot for more events.
      const baseSize =
        cluster.topVerification === "confirmed" ? 11 :
        cluster.topVerification === "multi" ? 9 : 7;
      const size = cluster.count > 1
        ? baseSize + Math.min(6, cluster.count) // +1px per extra event, cap +6
        : baseSize;

      const existing = pointMap.get(cluster.key);
      if (!existing) {
        const p = points.add({
          id: `evtcluster_${cluster.key}`,
          position,
          color,
          pixelSize: size,
          outlineColor: Cesium.Color.fromBytes(5, 6, 10, 220),
          outlineWidth: 1,
          disableDepthTestDistance: 50_000,
        });
        if (p) pointMap.set(cluster.key, p);
      } else {
        existing.position = position;
        existing.color = color;
        existing.pixelSize = size;
      }

      const existingLabel = labelMap.get(cluster.key);
      if (showLabels) {
        // Label: use the first event's title, indicate count if clustered.
        const first = cluster.events[0];
        const title =
          first.title.length > 40 ? first.title.slice(0, 38) + "…" : first.title;
        const countTag = cluster.count > 1 ? `  [${cluster.count}]` : "";
        const province = first.province ? `\n${first.province}` : "";
        const text = `${title}${countTag}${province}`;
        if (!existingLabel) {
          const l = labels.add({
            id: `evtclusterlbl_${cluster.key}`,
            position,
            text,
            font: "10px JetBrains Mono, monospace",
            fillColor: LABEL_FILL,
            outlineColor: LABEL_OUTLINE,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(8, -4),
            disableDepthTestDistance: 50_000,
            showBackground: true,
            backgroundColor: Cesium.Color.fromBytes(20, 5, 5, 200),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
          });
          if (l) labelMap.set(cluster.key, l);
        } else {
          existingLabel.position = position;
          existingLabel.text = text;
          existingLabel.show = shown;
        }
      } else if (existingLabel) {
        existingLabel.show = false;
      }
    }

    // Remove clusters that are no longer in the response
    for (const [id, p] of pointMap) {
      if (!seen.has(id)) {
        points.remove(p);
        pointMap.delete(id);
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
    points.show = visible;
    labels.show = visible;
    viewer.scene.requestRender();
  }

  function destroy(): void {
    viewer.scene.primitives.remove(points);
    viewer.scene.primitives.remove(labels);
    pointMap.clear();
    labelMap.clear();
  }

  return { setEvents, setShow, destroy };
}
