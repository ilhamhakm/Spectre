import * as Cesium from "cesium";

// Build a great-circle arc with parabolic altitude profile.
// origin→dest is interpolated on the WGS84 ellipsoid (true geodesic, not
// equirectangular lerp), and altitude follows sin(π·t) so the arc starts
// and ends at 0 and peaks at cruiseAlt at the midpoint.
//
// Ground clamp: endpoints are lifted to a minimum AGL so the arc doesn't
// dip below terrain. Mid-points use the parabolic peak, floored to a small
// AGL so the arc is always visible above the earth's surface.
const MIN_AGL = 80;            // ~80m so the arc lifts off the ground
const ENDPOINT_AGL = 120;      // endpoints lifted so they don't clip terrain

export function buildArcPositions(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  cruiseAlt: number,
  segments = 48,
): Cesium.Cartesian3[] {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(originLon, originLat),
    Cesium.Cartographic.fromDegrees(destLon, destLat),
  );
  const positions: Cesium.Cartesian3[] = [];
  const safeCruise = Math.max(cruiseAlt, MIN_AGL + 100);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const carto = geodesic.interpolateUsingFraction(t);
    // sin profile for the parabolic arc shape, floored to MIN_AGL.
    const sinT = Math.sin(Math.PI * t);
    const alt = Math.max(safeCruise * sinT, MIN_AGL);
    // Endpoints: lift to ENDPOINT_AGL so the arc visibly leaves the runway
    // instead of clipping into the terrain mesh.
    const finalAlt = (i === 0 || i === segments) ? ENDPOINT_AGL : alt;
    positions.push(
      Cesium.Cartesian3.fromDegrees(
        Cesium.Math.toDegrees(carto.longitude),
        Cesium.Math.toDegrees(carto.latitude),
        finalAlt,
      ),
    );
  }
  return positions;
}
