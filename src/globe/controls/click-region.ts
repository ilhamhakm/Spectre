import * as Cesium from "cesium";
import {
  resolveRegionFull,
  type RegionHitFull,
} from "../region-index";
import { useGlobeStore } from "@/store/globe-store";
import { fetchCityBoundary, fetchCountryBoundary, fetchStateBoundary } from "@/lib/region-info";
import type { CityInfo, CountryInfo, StateInfo } from "@/globe/region-index";

// Click-to-inspect handler for the borders layer. When borders are enabled,
// clicking the globe resolves the region under the cursor using the active
// scope (continent / country / state / city, set by the borders layer based
// on what the user selected), selects it in the store, draws a white
// highlight polygon, and flies the camera to frame the region.
//
// For countries and states the polygon rings come from the bundled GeoJSON,
// so the highlight + fly-to are immediate. For cities (which are points in
// our data) the boundary is fetched from Nominatim (OpenStreetMap) async.
//
// Clicking empty ocean (no region), pressing Escape, or disabling borders
// clears the selection.
//
// The click is deferred to the next tick so entity-click handlers (flights,
// satellites, buildings, CCTV) run first; if one of them claimed the click
// (a tracker is now set), the region handler yields and does not override.

const HIGHLIGHT_FILL = Cesium.Color.fromBytes(255, 255, 255, 80);
const HIGHLIGHT_OUTLINE = Cesium.Color.fromBytes(255, 255, 255, 235);

function resolveRegionUnderCursor(
  viewer: Cesium.Viewer,
  x: number,
  y: number,
): RegionHitFull | null {
  try {
    const cartesian = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y));
    if (!cartesian) return null;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    // Use the active scope (set by borders layer) to determine which level
    // to resolve. No altitude-based level needed.
    return resolveRegionFull(lon, lat);
  } catch {
    return null;
  }
}

// Compute a bounding box from polygon rings: [minLon, minLat, maxLon, maxLat].
function bboxFromRings(rings: number[][][]): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let n = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      n++;
    }
  }
  if (n === 0) return null;
  return [minLon, minLat, maxLon, maxLat];
}

// Fly the camera to frame a bounding box. Computes center + a height that
// gives ~4x padding around the bbox so the user sees the region in context.
// No height cap: borders are hidden via the store subscription in actions.ts
// when a region is selected, so the camera can go as high as needed.
function flyToBbox(
  viewer: Cesium.Viewer,
  bbox: [number, number, number, number],
  duration = 1.5,
): void {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  // Approximate width/height in km.
  const widthKm = haversineKm(minLon, centerLat, maxLon, centerLat);
  const heightKm = haversineKm(centerLon, minLat, centerLon, maxLat);
  const maxDimKm = Math.max(widthKm, heightKm);
  // Camera height: 4x the max dimension, minimum 800m (for tiny cities).
  const cameraHeight = Math.max(maxDimKm * 4 * 1000, 800);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, cameraHeight),
    duration,
  });
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function attachRegionClickHandler(viewer: Cesium.Viewer): () => void {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let highlightEntities: Cesium.Entity[] = [];
  let lastSelectionKey = "";

  // Rebuild the white highlight polygon(s) for the currently selected region.
  function rebuildHighlight(): void {
    if (viewer.isDestroyed()) return;
    for (const e of highlightEntities) {
      try { viewer.entities.remove(e); } catch {}
    }
    highlightEntities = [];
    const { selectedRegion, selectedRegionRings } = useGlobeStore.getState();
    if (!selectedRegion) return;
    const rings = selectedRegionRings ?? [];
    if (rings.length === 0) return;
    for (const ring of rings) {
      const positions = ring.map((p) =>
        Cesium.Cartesian3.fromDegrees(p[0], p[1], 0),
      );
      if (positions.length < 3) continue;
      // Fill: render on the ellipsoid surface (not classification, which
      // requires terrain/3D tiles to classify against and may not show
      // on the bare ellipsoid). height=0 puts it on the surface.
      const fill = viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: HIGHLIGHT_FILL,
          height: 0,
          outline: false,
        },
      });
      // Outline: ground-clamped polyline so it follows terrain.
      const outline = viewer.entities.add({
        polyline: {
          positions,
          clampToGround: true,
          width: 2.5,
          material: HIGHLIGHT_OUTLINE,
        },
      });
      highlightEntities.push(fill, outline);
    }
    viewer.scene.requestRender();
  }

  const unsubscribe = useGlobeStore.subscribe(() => {
    const s = useGlobeStore.getState();
    const key = `${s.selectedRegion ? "1" : "0"}|${s.selectedRegionRings ? s.selectedRegionRings.length : 0}`;
    if (key !== lastSelectionKey) {
      lastSelectionKey = key;
      rebuildHighlight();
    }
  });

  handler.setInputAction(
    (click: { position: Cesium.Cartesian2 }) => {
      if (viewer.isDestroyed()) return;
      const store = useGlobeStore.getState();
      if (!store.bordersEnabled) {
        if (store.selectedRegion) store.clearRegion();
        return;
      }
      const x = click.position.x;
      const y = click.position.y;
      setTimeout(() => {
        if (viewer.isDestroyed()) return;
        const s = useGlobeStore.getState();
        if (
          s.selectedFlightId ||
          s.trackedSatelliteId ||
          s.trackedFeature ||
          s.trackedCamera ||
          s.trackedBuilding
        ) {
          return;
        }
        const region = resolveRegionUnderCursor(viewer, x, y);
        if (region) {
          // Select immediately with the bundled GeoJSON rings so the panel
          // + highlight show instantly.
          s.selectRegion(
            { level: region.level, info: region.info } as any,
            region.rings,
          );

          // Fly to the bundled polygon's bbox immediately.
          const initialBbox = bboxFromRings(region.rings);
          if (initialBbox) flyToBbox(viewer, initialBbox);

          // For continents: no Nominatim fetch needed. The bundled
          // GeoJSON is the definitive source. Just select and fly.
          if (region.level === "continent") {
            return;
          }

          // For countries/states/cities: fetch a more accurate boundary
          // from Nominatim (OSM) and upgrade the highlight + fly-to.
          let boundaryPromise: Promise<{ rings: number[][][]; bbox: [number, number, number, number] } | null> | null = null;
          if (region.level === "city") {
            const city = region.info as CityInfo;
            boundaryPromise = fetchCityBoundary(city.name, city.country);
          } else if (region.level === "country") {
            const country = region.info as CountryInfo;
            boundaryPromise = fetchCountryBoundary(country.name);
          } else {
            const state = region.info as StateInfo;
            boundaryPromise = fetchStateBoundary(state.nameEn || state.name, state.admin ?? "");
          }

          if (boundaryPromise) {
            boundaryPromise
              .then((boundary) => {
                if (viewer.isDestroyed()) return;
                const cur = useGlobeStore.getState();
                // Only update if still the same selection.
                if (
                  !cur.selectedRegion ||
                  cur.selectedRegion.level !== region.level
                ) {
                  return;
                }
                // For country/state, also check the name matches.
                if (region.level === "country" && (cur.selectedRegion.info as CountryInfo).name !== (region.info as CountryInfo).name) return;
                if (region.level === "state" && (cur.selectedRegion.info as StateInfo).name !== (region.info as StateInfo).name) return;
                if (region.level === "city" && (cur.selectedRegion.info as CityInfo).name !== (region.info as CityInfo).name) return;

                if (boundary) {
                  cur.selectRegion(
                    { level: region.level, info: region.info } as any,
                    boundary.rings,
                  );
                  flyToBbox(viewer, boundary.bbox);
                }
              })
              .catch(() => {});
          }
        } else if (s.selectedRegion) {
          s.clearRegion();
        }
      }, 0);
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      const s = useGlobeStore.getState();
      if (s.selectedRegion) s.clearRegion();
    }
  };
  document.addEventListener("keydown", onKey);

  return () => {
    handler.destroy();
    unsubscribe();
    document.removeEventListener("keydown", onKey);
    for (const e of highlightEntities) {
      try { viewer.entities.remove(e); } catch {}
    }
    highlightEntities = [];
  };
}
