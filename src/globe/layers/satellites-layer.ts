import * as Cesium from "cesium";
import { getSatelliteImage, getCategoryColor } from "./satellite-icon";

export interface SatelliteData {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  position: {
    lat: number;
    lon: number;
    alt: number;
    velocity: number;
    period: number;
    inclination: number;
  } | null;
  tle?: [string, string];
  groundTrack?: { lon: number; lat: number; alt: number }[];
  orbit?: { lon: number; lat: number; alt: number }[];
}

interface TrackedSat {
  entity: Cesium.Entity;
  groundTrackEntity: Cesium.Entity;
}

const CATEGORY_COLORS: Record<string, string> = {
  station: "#FFD700",
  telescope: "#FF6B6B",
  observation: "#4ECDC4",
  constellation: "#A78BFA",
  starlink: "#A78BFA",
};

export function createSatellitesLayer(viewer: Cesium.Viewer) {
  const dataSource = new Cesium.CustomDataSource("satellites");
  viewer.dataSources.add(dataSource);
  const tracked = new Map<string, TrackedSat>();

  function getColor(cat: string): Cesium.Color {
    const hex = CATEGORY_COLORS[cat] || "#00D4FF";
    return Cesium.Color.fromCssColorString(hex);
  }

  function setSatellites(
    satellites: SatelliteData[],
    tleMap: Record<string, [string, string]>,
    visibleMap?: Record<string, boolean>,
  ) {
    const hasFilter = visibleMap && Object.keys(visibleMap).length > 0;
    const visibleIds = new Set<string>();
    for (const sat of satellites) {
      if (!sat.position) continue;
      if (!hasFilter || visibleMap![sat.id] === true) {
        visibleIds.add(sat.id);
      }
    }

    // Remove entities for sats no longer visible
    for (const [id, { entity, groundTrackEntity }] of tracked) {
      if (!visibleIds.has(id)) {
        dataSource.entities.remove(entity);
        dataSource.entities.remove(groundTrackEntity);
        tracked.delete(id);
      }
    }

    // Add or update visible satellites
    for (const sat of satellites) {
      if (!sat.position) continue;
      if (!visibleIds.has(sat.id)) continue;
      const { lat, lon, alt } = sat.position;
      const pos = Cesium.Cartesian3.fromDegrees(lon, lat, alt * 1000);
      const color = getCategoryColor(sat.category);

      const existing = tracked.get(sat.id);
      if (existing) {
        existing.entity.position = pos as any;
        const label = existing.entity.label as Cesium.LabelGraphics | undefined;
        if (label) {
          label.text = new Cesium.ConstantProperty(
            `${sat.emoji} ${sat.name}\nALT ${Math.round(alt)}km`,
          );
        }
        if (sat.groundTrack && sat.groundTrack.length > 1) {
          const trackPoints = sat.groundTrack.map((p) =>
            Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * 1000),
          );
          (
            existing.groundTrackEntity.polyline as Cesium.PolylineGraphics
          ).positions = new Cesium.ConstantProperty(trackPoints);
        }
      } else {
        // 3D satellite model — small glTF with body + solar panels.
        // minimumPixelSize keeps it visible at orbital distances without
        // being a giant billboard. The model tilts with the camera, giving
        // a true 3D feel at the side-view pitch.
        // No label — the name shows in the panel toggle list.
        const entity = dataSource.entities.add({
          position: pos as any,
          model: {
            uri: "/models/satellite.gltf",
            minimumPixelSize: 28,
            maximumScale: 200,
            scale: 1.0,
            silhouetteColor: color.withAlpha(0.95),
            silhouetteSize: 2.0,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1e9),
            heightReference: Cesium.HeightReference.NONE,
          } as any,
          description: undefined,
          id: `sat-${sat.id}`,
        });

        // Full orbit ellipse (closed loop) — computed with frozen GMST so
        // Earth doesn't rotate during one period, making the curve close
        // into the actual Keplerian orbital ellipse. This is what the user
        // wants to see: "the full orbit, not just a parabolic".
        const orbitPositions = sat.orbit && sat.orbit.length > 1
          ? sat.orbit.map((p) =>
              Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * 1000),
            )
          : sat.groundTrack && sat.groundTrack.length > 1
            ? sat.groundTrack.map((p) =>
                Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * 1000),
              )
            : [pos, pos];
        const groundTrackEntity = dataSource.entities.add({
          polyline: {
            positions: orbitPositions,
            width: 1.5,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.15,
              color: color.withAlpha(0.4),
            }),
          },
          id: `sat-track-${sat.id}`,
        } as any);

        tracked.set(sat.id, { entity, groundTrackEntity });
      }
    }
    viewer.scene.requestRender();
  }

  let trajectoryEntity: Cesium.Entity | null = null;

  function showTrajectory(
    satId: string,
    _tle: [string, string] | undefined,
  ) {
    if (trajectoryEntity) {
      dataSource.entities.remove(trajectoryEntity);
      trajectoryEntity = null;
    }
    const groundTrackEntity = tracked.get(satId)?.groundTrackEntity;
    if (groundTrackEntity?.polyline?.positions) {
      const positions = groundTrackEntity.polyline.positions.getValue(
        Cesium.JulianDate.now(),
      );
      if (positions && positions.length > 1) {
        trajectoryEntity = dataSource.entities.add({
          polyline: {
            positions,
            width: 2.5,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.2,
              color: Cesium.Color.fromCssColorString("#00D4FF").withAlpha(0.6),
            }),
            clampToGround: false,
          },
          id: `sat-trajectory-${satId}`,
        } as any);
      }
    }
  }

  function clearTrajectory() {
    if (trajectoryEntity) {
      dataSource.entities.remove(trajectoryEntity);
      trajectoryEntity = null;
    }
  }

  function setShow(show: boolean) {
    dataSource.show = show;
    viewer.scene.requestRender();
  }

  function remove() {
    dataSource.entities.removeAll();
    tracked.clear();
    trajectoryEntity = null;
  }

  function destroy() {
    viewer.dataSources.remove(dataSource, true);
  }

  return {
    setSatellites,
    setShow,
    remove,
    destroy,
    tracked,
    showTrajectory,
    clearTrajectory,
  };
}
