import * as Cesium from "cesium";

// Build a great-circle arc with parabolic altitude profile.
// origin→dest is interpolated on the WGS84 ellipsoid (true geodesic, not
// equirectangular lerp), and altitude follows sin(π·t) so the arc starts
// and ends at 0 and peaks at cruiseAlt at the midpoint.
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
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const carto = geodesic.interpolateUsingFraction(t);
    const alt = cruiseAlt * Math.sin(Math.PI * t);
    positions.push(
      Cesium.Cartesian3.fromDegrees(
        Cesium.Math.toDegrees(carto.longitude),
        Cesium.Math.toDegrees(carto.latitude),
        alt,
      ),
    );
  }
  return positions;
}
