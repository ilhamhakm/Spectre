import * as Cesium from "cesium";
import type { ProtestEvent } from "@/lib/types";
import type { EventType } from "@/lib/types";

// Instability heatmap layer: draws Natural Earth country/state borders
// with a colored glow proportional to the instability score of each region.
//
// Granularity auto-switches based on activeCity:
//   - No city selected (continental view) → country borders (ne_110m)
//   - City selected (zoomed in) → state/province borders (ne_50m)
//
// Score uses the weighted severity model (type weight × recency × crowd ×
// casualties × verification × confidence) — same as InstabilityPanel.

const TYPE_WEIGHTS: Record<EventType, number> = {
  protest: 1,
  riot: 3,
  arrest: 0.5,
  shutdown: 2,
  fire: 1.5,
  earthquake: 0,
  other: 0.5,
};

function scoreEvent(ev: {
  type: EventType;
  confidence: number;
  verified: boolean;
  casualtyCount?: number;
  estimatedCrowdSize?: number;
  eventTime: string;
}): number {
  const base = TYPE_WEIGHTS[ev.type] ?? 0.5;
  let mult = 1;
  if (ev.casualtyCount && ev.casualtyCount > 0) mult *= 2;
  if (ev.estimatedCrowdSize && ev.estimatedCrowdSize > 1000) mult *= 1.5;
  const hours = (Date.now() - new Date(ev.eventTime).getTime()) / 3_600_000;
  const recency = hours < 24 ? 1.5 : hours < 168 ? 1.0 : 0.5;
  const verified = ev.verified ? 1.3 : 1.0;
  return base * recency * verified * mult * ev.confidence;
}

interface RegionFeature {
  name: string;
  coordinates: number[][][]; // array of polygons, each [lon, lat][]
}

interface GeoJSONFeature {
  type: "Feature";
  properties: { name?: string; NAME?: string; admin?: string; ADMIN?: string; iso_a2?: string };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}

function extractRegionName(props: Record<string, unknown>): string {
  return (props.name as string) || (props.NAME as string) || (props.admin as string) || (props.ADMIN as string) || "Unknown";
}

function extractPolygons(geom: GeoJSONFeature["geometry"]): number[][][] {
  if (geom.type === "Polygon") {
    return geom.coordinates as number[][][];
  }
  // MultiPolygon: flatten outer ring of each polygon
  const multi = geom.coordinates as number[][][][];
  const out: number[][][] = [];
  for (const poly of multi) {
    if (poly.length > 0) out.push(poly[0]);
  }
  return out;
}

// Haversine distance in km for matching events to regions
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface InstabilityLayerHandle {
  setEvents(events: ProtestEvent[]): void;
  setActiveCity(city: string | null): void;
  setCameraAltitude(height: number): void;
  setShow(visible: boolean): void;
  destroy(): void;
}

export function mountInstabilityLayer(viewer: Cesium.Viewer): InstabilityLayerHandle {
  const dataSource = new Cesium.CustomDataSource("instability");
  viewer.dataSources.add(dataSource);

  let shown = false;
  let currentEvents: ProtestEvent[] = [];
  let currentCity: string | null = null;
  let currentAltitude = 10_000_000;
  let countryRegions: RegionFeature[] | null = null;
  let stateRegions: RegionFeature[] | null = null;
  let loadingCountries = false;
  let loadingStates = false;
  let renderDirty = false;

  async function loadCountries(): Promise<RegionFeature[]> {
    if (countryRegions) return countryRegions;
    loadingCountries = true;
    try {
      const res = await fetch("/geo/ne_110m_admin_0_countries.geojson");
      const geo = await res.json();
      const features = geo.features as GeoJSONFeature[];
      countryRegions = features.map((f) => ({
        name: extractRegionName(f.properties as Record<string, unknown>),
        coordinates: extractPolygons(f.geometry),
      }));
    } catch (err) {
      console.warn("[instability] Failed to load country GeoJSON:", err);
      countryRegions = [];
    }
    loadingCountries = false;
    return countryRegions;
  }

  async function loadStates(): Promise<RegionFeature[]> {
    if (stateRegions) return stateRegions;
    loadingStates = true;
    try {
      const res = await fetch("/geo/ne_50m_admin_1_states_provinces.geojson");
      const geo = await res.json();
      const features = geo.features as GeoJSONFeature[];
      stateRegions = features.map((f) => ({
        name: extractRegionName(f.properties as Record<string, unknown>),
        coordinates: extractPolygons(f.geometry),
      }));
    } catch (err) {
      console.warn("[instability] Failed to load state GeoJSON:", err);
      stateRegions = [];
    }
    loadingStates = false;
    return stateRegions;
  }

  // Match events to regions by proximity. Each event is assigned to the
  // nearest region whose polygon contains it, or the nearest region by
  // centroid distance as fallback.
  function computeScores(regions: RegionFeature[]): Map<string, number> {
    const scores = new Map<string, number>();
    for (const ev of currentEvents) {
      const evLat = ev.lat;
      const evLon = ev.lon;
      if (!Number.isFinite(evLat) || !Number.isFinite(evLon)) continue;

      // Find the region whose polygon contains this point, or nearest.
      let bestRegion: string | null = null;
      let bestDist = Infinity;

      for (const region of regions) {
        // Check if point is inside any polygon of this region
        for (const polygon of region.coordinates) {
          if (pointInPolygon(evLon, evLat, polygon)) {
            bestRegion = region.name;
            bestDist = 0;
            break;
          }
        }
        if (bestRegion) break;

        // Fallback: distance to first coordinate of first polygon
        if (region.coordinates.length > 0 && region.coordinates[0].length > 0) {
          const first = region.coordinates[0][0];
          if (first) {
            const d = haversineKm(evLat, evLon, first[1], first[0]);
            if (d < bestDist) {
              bestDist = d;
              bestRegion = region.name;
            }
          }
        }
      }

      if (bestRegion) {
        const score = scoreEvent(ev);
        scores.set(bestRegion, (scores.get(bestRegion) ?? 0) + score);
      }
    }
    return scores;
  }

  // Point-in-polygon test (ray casting) for [lon, lat] coordinate arrays.
  function pointInPolygon(lon: number, lat: number, polygon: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      const intersect =
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function glowColor(score: number): Cesium.Color {
    // Stable (score 0): no glow (transparent)
    // Low (score 1-5): yellow glow
    // Medium (score 5-15): orange glow
    // High (score 15+): red glow
    if (score <= 0) return Cesium.Color.TRANSPARENT;
    if (score < 5) return Cesium.Color.fromBytes(255, 210, 77, 120);
    if (score < 15) return Cesium.Color.fromBytes(255, 122, 61, 160);
    return Cesium.Color.fromBytes(255, 61, 61, 200);
  }

  function borderColor(): Cesium.Color {
    return Cesium.Color.fromBytes(122, 196, 224, 180);
  }

  async function rebuild() {
    if (!shown) return;

    // Determine granularity by camera altitude:
    // Above 2,000km (continental/planetary view) → country borders
    // Below 2,000km (country/city view) → state/province borders
    const useStates = currentAltitude < 2_000_000;
    const regions = useStates
      ? await loadStates()
      : await loadCountries();

    if (!shown) return; // may have been hidden during async load

    const scores = computeScores(regions);
    const maxScore = Math.max(1, ...Array.from(scores.values()));

    // Clear existing entities
    dataSource.entities.removeAll();

    for (const region of regions) {
      const score = scores.get(region.name) ?? 0;
      const glow = glowColor(score);
      const border = borderColor();

      for (const polygon of region.coordinates) {
        if (polygon.length < 3) continue;

        const positions = polygon.map(([lon, lat]) =>
          Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        );

        // Glow polygon (fill) — only for non-zero scores
        if (score > 0) {
          dataSource.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions),
              material: new Cesium.ColorMaterialProperty(glow),
              classificationType: Cesium.ClassificationType.BOTH,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20_000_000),
            },
          });
        }

        // Border polyline
        dataSource.entities.add({
          polyline: {
            positions: [...positions, positions[0]], // close the loop
            width: 1,
            material: new Cesium.ColorMaterialProperty(border),
            clampToGround: true,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20_000_000),
          },
        });
      }
    }

    viewer.scene.requestRender();
  }

  function setEvents(events: ProtestEvent[]): void {
    currentEvents = events;
    if (shown) rebuild();
  }

  function setActiveCity(city: string | null): void {
    // City changes may trigger a rebuild if altitude is already low.
    currentCity = city;
    // No direct rebuild here; altitude drives granularity.
  }

  function setCameraAltitude(height: number): void {
    const crossedThreshold =
      (currentAltitude >= 2_000_000) !== (height >= 2_000_000);
    currentAltitude = height;
    if (shown && crossedThreshold) rebuild();
  }

  function setShow(visible: boolean): void {
    shown = visible;
    dataSource.show = visible;
    if (visible) {
      rebuild();
    } else {
      dataSource.entities.removeAll();
    }
    viewer.scene.requestRender();
  }

  function destroy(): void {
    viewer.dataSources.remove(dataSource);
  }

  return { setEvents, setActiveCity, setCameraAltitude, setShow, destroy };
}
