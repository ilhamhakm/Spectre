"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createViewer } from "@/globe/viewer-init";
import { configureScene } from "@/globe/scene-config";
import { LAYERS } from "@/globe/layers";
import { attachHoverHandler } from "@/globe/controls/hover";
import { highlightBuilding } from "@/globe/building-highlight";
import { attachClickHandler } from "@/globe/controls/click";
import { attachKeyboardControls } from "@/globe/controls/keyboard";
import { mountFlightsLayer, type FlightsLayerHandle } from "@/globe/layers/flights-layer";
import { mountMilitaryLayer, type MilitaryLayerHandle } from "@/globe/layers/military-flights-layer";
import { mountEventsLayer, type EventsLayerHandle } from "@/globe/layers/events-layer";
import { mountInstabilityLayer, type InstabilityLayerHandle } from "@/globe/layers/instability-layer";
import { mountGibsLayer, type GibsLayerHandle } from "@/globe/layers/gibs-layer";
import { mountRoadsLayer, type RoadsLayerHandle } from "@/globe/layers/roads-layer";
import { roadsCacheKey, getCachedRoads, setCachedRoads } from "@/globe/roads-cache";
import { mountCctvLayer, type CctvLayerHandle } from "@/globe/layers/cctv-layer";
import { mountKartaviewLayer, type KartaviewLayerHandle } from "@/globe/layers/kartaview-layer";
import { mountTrafficLayer, type TrafficLayerHandle } from "@/globe/layers/traffic-layer";
import { mountGoogleTilesLayer } from "@/globe/layers/google-tiles-layer";
import { createSentinelLayer } from "@/globe/layers/sentinel-layer";
import { createSatellitesLayer, type SatelliteData } from "@/globe/layers/satellites-layer";
import { buildArcPositions } from "@/globe/arc";
import { useGlobeStore } from "@/store/globe-store";
import type { FlightState } from "@/lib/sources/opensky";
import type { MilitaryFlight } from "@/lib/sources/airplanes-live";
import type { ProtestEvent } from "@/lib/types";
import type { RoadSegment } from "@/lib/sources/overpass";
import type { CctvCamera } from "@/lib/sources/cctv";
import type { KartaviewPhoto } from "@/lib/sources/kartaview";
import type { VehicleSeed } from "@/lib/sources/traffic";

type Props = {
  onHover?: (
    id: string | null,
    screenX?: number,
    screenY?: number,
    kind?: "cctv" | "event" | "flight-private" | "flight-mil" | "building" | "region" | "satellite"
  ) => void;
  onSelect?: (
    id: string | null,
    screenX?: number,
    screenY?: number,
    kind?: "flight-private" | "flight-mil"
  ) => void;
};

export default function CesiumGlobe({
  onHover,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  // Refs hold the inline-mounted layer handles so the visibility useEffect
  // can reach them after the mount effect closes over its local handles.
  const flightsHandleRef = useRef<FlightsLayerHandle | null>(null);
  const milHandleRef = useRef<MilitaryLayerHandle | null>(null);
  const eventsHandleRef = useRef<EventsLayerHandle | null>(null);
  const instabilityHandleRef = useRef<InstabilityLayerHandle | null>(null);
  const gibsHandleRef = useRef<GibsLayerHandle | null>(null);
  const roadsHandleRef = useRef<RoadsLayerHandle | null>(null);
  const cctvHandleRef = useRef<CctvLayerHandle | null>(null);
  const kartaviewHandleRef = useRef<KartaviewLayerHandle | null>(null);
  const trafficHandleRef = useRef<TrafficLayerHandle | null>(null);
  const pollTrafficRef = useRef<((force?: boolean) => void) | null>(null);
  const satellitesHandleRef = useRef<ReturnType<typeof createSatellitesLayer> | null>(null);
  const satTleMapRef = useRef<Record<string, [string, string]>>({});
  const satDataCacheRef = useRef<SatelliteData[] | null>(null);
  const sentinelHandleRef = useRef<ReturnType<typeof createSentinelLayer> | null>(null);
  // Ref to the gold trail polyline entity for the tracked jet — removed when
  // tracking is cleared (same pattern as FlightTrajectoryOverlay).
  const trackedTrailRef = useRef<Cesium.Entity | null>(null);
  const allCctvCamerasRef = useRef<CctvCamera[]>([]);

  const layerVisibility = useGlobeStore((s) => s.layerVisibility);

  // Keep the store's hover state in sync with the legacy onHover prop.
  // Hover also writes to the Zustand store so other components (HoverPopup)
  // can read it without prop drilling.
  const setHover = useGlobeStore((s) => s.setHover);
  const clearHover = useGlobeStore((s) => s.clearHover);
  const selectFlight = useGlobeStore((s) => s.selectFlight);

  // Mount the viewer + all layers + interaction handlers (once).
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = createViewer(containerRef.current);
    configureScene(viewer);
    viewerRef.current = viewer;

    // Mount all registered layers
    for (const layer of LAYERS) {
      try {
        layer.mount(viewer);
      } catch (err) {
        console.error(`[globe] layer ${layer.id} failed to mount`, err);
      }
    }

    // Expose viewer + Cesium on window — RightRail.tsx and TacticalHUD.tsx
    // read these via (window as any).__viewer / __Cesium for camera control.
    if (typeof window !== "undefined") {
      (window as unknown as { __viewer?: Cesium.Viewer }).__viewer = viewer;
      (window as unknown as { __Cesium?: typeof Cesium }).__Cesium = Cesium;
    }
    setReady(true);

    // Hover handler — writes to store + forwards to legacy onHover prop
    const destroyHover = attachHoverHandler(
      viewer,
      (id, x, y, kind, building, region) => {
        if (id == null) {
          clearHover();
          // Clearing the building tint when the cursor leaves the tile.
          try {
            highlightBuilding(null);
          } catch {
            // tileset may be gone — ignore
          }
          if (onHoverRef.current) onHoverRef.current(null);
          return;
        }
        if (kind === "building") {
          // Building Highlights gates BOTH the gold tint and the building
          // popup (off by default). When off, hovering a building behaves
          // like hovering empty ground — the region popup still fires.
          const highlightsOn =
            useGlobeStore.getState().layerVisibility.bldgHighlight ?? false;
          if (highlightsOn) {
            // Pick the feature again so we can tint it gold. pickAt already
            // returned the parsed props; re-pick to grab the live feature.
            let feature: unknown = null;
            try {
              const v = viewer.scene.pick(new Cesium.Cartesian2(x ?? 0, y ?? 0));
              if (v instanceof Cesium.Cesium3DTileFeature) feature = v;
            } catch {
              feature = null;
            }
            try {
              highlightBuilding(
                (feature as Cesium.Cesium3DTileFeature | null) ?? null,
              );
            } catch {
              // ignore
            }
            setHover(id, x, y, kind, building, region);
            if (onHoverRef.current) {
              onHoverRef.current(id, x, y, kind ?? undefined);
            }
          } else {
            try {
              highlightBuilding(null);
            } catch {
              // ignore
            }
            if (region) {
              setHover("region", x, y, "region", undefined, region);
              if (onHoverRef.current) {
                onHoverRef.current("region", x, y, "region");
              }
            } else {
              clearHover();
              if (onHoverRef.current) onHoverRef.current(null);
            }
          }
          return;
        } else {
          try {
            highlightBuilding(null);
          } catch {
            // ignore
          }
        }
        setHover(id, x, y, kind, building, region);
        if (onHoverRef.current) {
          onHoverRef.current(id, x, y, kind ?? undefined);
        }
      }
    );

    // Click handler — selects a flight billboard so the trajectory overlay
    // can fetch + render its path. Click on empty space / non-flight
    // entities clears the active selection. Satellite clicks fly to the
    // satellite with a side view.
    const destroyClick = attachClickHandler(
      viewer,
      (id, x, y, kind) => {
        if (kind === "satellite" && id) {
          // Find the satellite entity and fly to it with side view
          const tracked = satellitesHandleRef.current?.tracked;
          const entry = tracked?.get(id);
          const entity = entry?.entity;
          if (entity?.position) {
            const pos = entity.position.getValue(Cesium.JulianDate.now());
            if (pos) {
              // Fly to satellite with side view (25° pitch from horizontal)
              const carto = Cesium.Cartographic.fromCartesian(pos);
              const alt = carto.height;
              const offset = Math.max(alt * 0.5, 50_000);
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromRadians(
                  carto.longitude,
                  carto.latitude,
                  alt + offset,
                  Cesium.Ellipsoid.WGS84,
                ),
                orientation: {
                  heading: 0,
                  pitch: Cesium.Math.toRadians(-25),
                  roll: 0,
                },
                duration: 2,
              });
              // Show orbit trajectory for this satellite
              const tle = satTleMapRef.current[id];
              satellitesHandleRef.current?.showTrajectory(id, tle);
            }
          }
          return; // Don't select satellite as a "flight"
        }
        selectFlight(id, kind as "flight-private" | "flight-mil" | null, x, y);
        // Fly camera to the clicked flight at 5km altitude for a visible plane icon
        if (id && (kind === "flight-private" || kind === "flight-mil")) {
          const entity = viewer.entities.getById(id) ||
            viewer.dataSourceDisplay.defaultDataSource.entities.getById(id);
          const flightsLayer = flightsHandleRef.current;
          // Try to get position from the flights layer
          const pos = flightsLayer?.getFlightPosition?.(id);
          if (pos) {
            const carto = Cesium.Cartographic.fromCartesian(pos);
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromRadians(
                carto.longitude,
                carto.latitude,
                Math.max(carto.height + 5_000, 5_000),
                Cesium.Ellipsoid.WGS84,
              ),
              orientation: {
                heading: 0,
                pitch: Cesium.Math.toRadians(-35),
                roll: 0,
              },
              duration: 2,
            });
          }
        }
        if (onSelectRef.current) {
          onSelectRef.current(id, x, y, (kind === "flight-private" || kind === "flight-mil" ? kind : undefined) as "flight-private" | "flight-mil" | undefined);
        }
      }
    );

    // Keyboard controls — WASD pan, arrows tilt/rotate, 1-5 theater presets
    const destroyKeyboard = attachKeyboardControls(viewer);

    // Flights layer (OpenSky private jets only — military removed per Task 6).
    // Polls /api/flights every 60s, with exponential backoff on 429/502.
    let flightsHandle: FlightsLayerHandle | null = null;
    let flightsTimer: ReturnType<typeof setInterval> | null = null;
    let flightsAbort: AbortController | null = null;
    let disposed = false;
    let flightsRateLimitHits = 0;
    const setLayerLoading = useGlobeStore.getState().setLayerLoading;
    try {
      flightsHandle = mountFlightsLayer(viewer);
      flightsHandleRef.current = flightsHandle;
      const pollFlights = async () => {
        if (disposed || viewer.isDestroyed()) return;
        flightsAbort?.abort();
        flightsAbort = new AbortController();
        setLayerLoading("flights", true);
        try {
          const res = await fetch("/api/flights", {
            signal: AbortSignal.any([flightsAbort.signal, AbortSignal.timeout(20_000)]),
          });
          if (res.status === 502) {
            // OpenSky rate-limited — exponential backoff
            if (flightsTimer) clearInterval(flightsTimer);
            const backoff = Math.min(600_000, 60_000 * Math.pow(2, ++flightsRateLimitHits));
            flightsTimer = setInterval(pollFlights, backoff);
            return;
          }
          if (!res.ok) return;
          flightsRateLimitHits = 0;
          const data: { flights?: FlightState[] } = await res.json();
          if (data.flights && flightsHandle && !disposed) flightsHandle.setFlights(data.flights);
        } catch {
          // network error or timeout — skip silently
        } finally {
          setLayerLoading("flights", false);
        }
      };
      setTimeout(pollFlights, 4_000); // initial fetch after viewer settles
      flightsTimer = setInterval(pollFlights, 60_000);
    } catch (err) {
      console.error("[globe] flights layer failed", err);
    }

    // Military flights layer (airplanes.live /mil — free, no auth).
    // Polls /api/military-flights (10-min server cache) every 60s.
    let milHandle: MilitaryLayerHandle | null = null;
    let milTimer: ReturnType<typeof setInterval> | null = null;
    let milAbort: AbortController | null = null;
    let milDisposed = false;
    try {
      milHandle = mountMilitaryLayer(viewer);
      milHandleRef.current = milHandle;
      const pollMil = async () => {
        if (milDisposed || viewer.isDestroyed()) return;
        milAbort?.abort();
        milAbort = new AbortController();
        setLayerLoading("mil", true);
        try {
          const res = await fetch("/api/military-flights", {
            signal: AbortSignal.any([milAbort.signal, AbortSignal.timeout(20_000)]),
          });
          if (!res.ok) return;
          const data: { flights?: MilitaryFlight[] } = await res.json();
          if (data.flights && milHandle && !milDisposed) milHandle.setFlights(data.flights);
        } catch {
          // network error or timeout — skip silently
        } finally {
          setLayerLoading("mil", false);
        }
      };
      setTimeout(pollMil, 5_000); // after private flights (4s)
      milTimer = setInterval(pollMil, 60_000);
    } catch (err) {
      console.error("[globe] military layer failed", err);
    }

    // Civil unrest events layer (protests + riots + arrests from /api/events).
    // Context-dependent: computes the current camera viewport bbox and passes
    // it to the API so only events in the viewed region are fetched. Refetches
    // on camera move (throttled) + every 5 min.
    let eventsHandle: EventsLayerHandle | null = null;
    let eventsTimer: ReturnType<typeof setInterval> | null = null;
    let eventsAbort: AbortController | null = null;
    let eventsDisposed = false;
    let lastEventsBbox = "";
    let destroyEventsCameraMove: (() => void) | null = null;
    try {
      eventsHandle = mountEventsLayer(viewer);
      eventsHandleRef.current = eventsHandle;

      // Instability heatmap (Natural Earth borders + glow)
      const instabilityHandle = mountInstabilityLayer(viewer);
      instabilityHandleRef.current = instabilityHandle;
      const currentEventsBbox = (): string => {
        try {
          // Cesium returns the current view rectangle in radians (or
          // undefined when the camera is close to the ground).
          const carto = viewer.camera.positionCartographic;
          const rect = viewer.camera.computeViewRectangle();
          // Expand the box to a minimum span. At street level the view
          // rectangle can shrink to ~0.1° (no events at all); also when the
          // rect is undefined fall back to the camera position. The span
          // grows with altitude but never drops below ~0.5° (~55km).
          const span = Math.min(5, Math.max(0.5, carto.height / 50_000));
          let west: number;
          let south: number;
          let east: number;
          let north: number;
          if (rect) {
            west = Cesium.Math.toDegrees(rect.west);
            south = Cesium.Math.toDegrees(rect.south);
            east = Cesium.Math.toDegrees(rect.east);
            north = Cesium.Math.toDegrees(rect.north);
            // Pad tiny near-ground rectangles out to the minimum span.
            const latCenter = (south + north) / 2;
            const lonCenter = (west + east) / 2;
            const latHalf = Math.max((north - south) / 2, span);
            const lonHalf = Math.max((east - west) / 2, span);
            west = lonCenter - lonHalf;
            east = lonCenter + lonHalf;
            south = latCenter - latHalf;
            north = latCenter + latHalf;
          } else {
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const lon = Cesium.Math.toDegrees(carto.longitude);
            west = lon - span;
            south = lat - span;
            east = lon + span;
            north = lat + span;
          }
          // Round to ~0.1° so tiny camera jitter doesn't trigger refetches.
          return [west, south, east, north]
            .map((v) => v.toFixed(1))
            .join(",");
        } catch {
          return "";
        }
      };
      const pollEvents = async () => {
        if (eventsDisposed || viewer.isDestroyed()) return;
        eventsAbort?.abort();
        eventsAbort = new AbortController();
        setLayerLoading("events", true);
        try {
          const bbox = currentEventsBbox();
          // Fetch the last 7 days — gives the instability score enough data
          // to compute meaningful per-province/country scores while staying
          // current. The popup shows the same set; recency is reflected in
          // the score weighting (last 24h weigh more).
          const today = new Date().toISOString().slice(0, 10);
          const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
          const url = bbox
            ? `/api/events?limit=200&from=${weekAgo}&to=${today}&bbox=${encodeURIComponent(bbox)}`
            : `/api/events?limit=200&from=${weekAgo}&to=${today}`;
          const res = await fetch(url, {
            signal: AbortSignal.any([eventsAbort.signal, AbortSignal.timeout(30_000)]),
          });
          if (!res.ok) return;
          const data: { events?: ProtestEvent[] } = await res.json();
          if (data.events && eventsHandle && !eventsDisposed) {
            eventsHandle.setEvents(data.events);
            // Share the bbox-filtered set so the hover popup resolves the
            // same clusters the globe rendered.
            useGlobeStore.getState().setEvents(data.events);
            // Update instability heatmap with the same events
            instabilityHandleRef.current?.setEvents(data.events);
          }
        } catch {
          // events API down — skip silently
        } finally {
          setLayerLoading("events", false);
        }
      };
      // Refetch when the user pans/zooms and the viewport settles.
      let eventsCameraMoveTimer: ReturnType<typeof setTimeout> | null = null;
      const onCameraMove = () => {
        if (eventsCameraMoveTimer) clearTimeout(eventsCameraMoveTimer);
        eventsCameraMoveTimer = setTimeout(() => {
          if (eventsDisposed || viewer.isDestroyed()) return;
          const bbox = currentEventsBbox();
          if (bbox !== lastEventsBbox) {
            lastEventsBbox = bbox;
            void pollEvents();
          }
        }, 2_000);
      };
      viewer.camera.changed.addEventListener(onCameraMove);

      // Update instability heatmap granularity based on camera altitude.
      const onCameraMoveInstability = () => {
        const h = viewer.camera.positionCartographic.height;
        instabilityHandleRef.current?.setCameraAltitude(h);
        useGlobeStore.getState().setCameraAltitude(h);
      };
      viewer.camera.changed.addEventListener(onCameraMoveInstability);

      destroyEventsCameraMove = () => {
        viewer.camera.changed.removeEventListener(onCameraMove);
        viewer.camera.changed.removeEventListener(onCameraMoveInstability);
        if (eventsCameraMoveTimer) clearTimeout(eventsCameraMoveTimer);
      };
      setTimeout(pollEvents, 7_000); // after military (5s)
      eventsTimer = setInterval(pollEvents, 300_000); // 5 min
    } catch (err) {
      console.error("[globe] events layer failed", err);
    }

    // Roads layer (OSM Overpass) — mounted once so traffic-layer can
    // reference road geometry. Visibility is tied to the traffic toggle;
    // the traffic layer handles all data fetching and road coloring.
    let roadsHandle: RoadsLayerHandle | null = null;
    try {
      roadsHandle = mountRoadsLayer(viewer);
      roadsHandleRef.current = roadsHandle;
    } catch (err) {
      console.error("[globe] roads layer failed", err);
    }

    // CCTV layer — loaded once, filtered by source + territory on demand.
    let cctvHandle: CctvLayerHandle | null = null;
    let cctvTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubCctvStore: () => void = () => {};
    try {
      cctvHandle = mountCctvLayer(viewer);
      cctvHandleRef.current = cctvHandle;

      const pushFilteredCctv = () => {
        if (!cctvHandle || disposed || viewer.isDestroyed()) return;
        const { cctvSources, activeCity } = useGlobeStore.getState();
        // No city selected → show nothing. Cameras only render per-city.
        if (!activeCity) {
          cctvHandle.setCameras([]);
          useGlobeStore.getState().setCctvSourceCounts({});
          return;
        }
        let cams = allCctvCamerasRef.current;
        // Source filter: only keep cameras from enabled providers.
        cams = cams.filter((c) => cctvSources[c.provider] !== false);
        // Territory filter: bound to ~0.5° around the active city.
        const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
          Jakarta: { lat: -6.1754, lon: 106.8272 },
          Surabaya: { lat: -7.2575, lon: 112.7521 },
          Medan: { lat: 3.5952, lon: 98.6722 },
          Makassar: { lat: -5.1477, lon: 119.4327 },
          Jayapura: { lat: -2.5916, lon: 140.669 },
          Bali: { lat: -8.6705, lon: 115.2126 },
          "New York": { lat: 40.7589, lon: -73.9851 },
          Tokyo: { lat: 35.6762, lon: 139.6503 },
          London: { lat: 51.5074, lon: -0.1278 },
          Paris: { lat: 48.8566, lon: 2.3522 },
          Dubai: { lat: 25.2048, lon: 55.2708 },
          "Washington DC": { lat: 38.8977, lon: -77.0365 },
          Sydney: { lat: -33.8688, lon: 151.2093 },
          Singapore: { lat: 1.3521, lon: 103.8198 },
          "Los Angeles": { lat: 34.0522, lon: -118.2437 },
          "San Francisco": { lat: 37.7749, lon: -122.4194 },
        };
        const coord = CITY_COORDS[activeCity];
        let cityCams = cams;
        if (coord) {
          const d = 0.5;
          cityCams = cams.filter(
            (c) => c.lat >= coord.lat - d && c.lat <= coord.lat + d
              && c.lon >= coord.lon - d && c.lon <= coord.lon + d,
          );
        }
        cctvHandle.setCameras(cityCams);
        // Publish per-source counts for the current city so the source
        // filter panel can sort by count and show a badge.
        const counts: Record<string, number> = {};
        for (const c of allCctvCamerasRef.current) {
          if (coord) {
            const d = 0.5;
            if (c.lat < coord.lat - d || c.lat > coord.lat + d) continue;
            if (c.lon < coord.lon - d || c.lon > coord.lon + d) continue;
          }
          counts[c.provider] = (counts[c.provider] ?? 0) + 1;
        }
        useGlobeStore.getState().setCctvSourceCounts(counts);
      };

      // CCTV catalog is loaded by page.tsx and shared via the store.
      // CesiumGlobe just needs to push filtered cameras to the layer when
      // the catalog arrives or when source/city filters change.
      const syncCctvFromStore = () => {
        if (disposed || viewer.isDestroyed()) return;
        const { cctvCameras, cctvCatalogLoaded } = useGlobeStore.getState();
        if (!cctvCatalogLoaded) return;
        allCctvCamerasRef.current = cctvCameras;
        pushFilteredCctv();
      };

      // Subscribe to store changes - when page.tsx sets cameras, push them
      const unsubCctvStore = useGlobeStore.subscribe((state, prev) => {
        if (state.cctvCameras !== prev.cctvCameras && state.cctvCameras.length > 0) {
          syncCctvFromStore();
        }
      });

      // Initial sync (in case cameras already loaded)
      setTimeout(syncCctvFromStore, 2000);
      cctvTimer = setTimeout(syncCctvFromStore, 8000);

      // Re-filter when source toggles or active city changes.
      (window as unknown as { __pushFilteredCctv?: () => void }).__pushFilteredCctv = pushFilteredCctv;
    } catch (err) {
      console.error("[globe] cctv layer failed", err);
    }

    // Traffic layer — road congestion coloring + animated vehicle dots.
    // Only loads when camera is below 3000m (city-level view). The traffic
    // API fetches OSM roads + simulates congestion, so this single layer
    // replaces the old separate roads + traffic buttons.
    let trafficHandle: TrafficLayerHandle | null = null;
    let trafficTimer: ReturnType<typeof setInterval> | null = null;
    let trafficAbort: AbortController | null = null;
    let trafficInFlight = false;
    let lastTrafficCenter: { lon: number; lat: number } | null = null;
    let lastTrafficLevel: 1 | 2 | 3 | null = null;
    try {
      trafficHandle = mountTrafficLayer(viewer);
      trafficHandleRef.current = trafficHandle;
      const pollTraffic = async (force = false) => {
        if (disposed || viewer.isDestroyed()) return;
        if (trafficInFlight) return;
        const carto = viewer.camera.positionCartographic;
        // No altitude cap — roads load at any zoom level.
        // force=true is still used for initial fetch on toggle.
        const lon = (carto.longitude * 180) / Math.PI;
        const lat = (carto.latitude * 180) / Math.PI;
        // Match LOD level to roads layer so traffic spawns on visible roads.
        // Level 3 = all classes (below 2000m), Level 2 = primary+secondary, Level 1 = motorway+trunk+primary
        const level: 1 | 2 | 3 = carto.height > 3_000 ? 1 : carto.height > 1_500 ? 2 : 3;
        const levelChanged = lastTrafficLevel !== null && lastTrafficLevel !== level;
        lastTrafficLevel = level;
        if (!force && !levelChanged && lastTrafficCenter) {
          const dLon = lon - lastTrafficCenter.lon;
          const dLat = lat - lastTrafficCenter.lat;
          const km = Math.sqrt(dLon * dLon + dLat * dLat) * 111;
          if (km < 5) return;
        }
        lastTrafficCenter = { lon, lat };
        // Scale bbox to roughly match viewport — not the whole city.
        // At 4000m → ~0.4°, at 1000m → ~0.15°, at 300m → ~0.08°.
        const span = Math.min(1, Math.max(0.08, carto.height / 10_000));
        trafficAbort?.abort();
        trafficAbort = new AbortController();
        trafficInFlight = true;
        setLayerLoading("traffic", true);
        try {
          const span4 = span.toFixed(4);
          const url =
            `/api/traffic?south=${(lat - span).toFixed(4)}&west=${(lon - span).toFixed(4)}` +
            `&north=${(lat + span).toFixed(4)}&east=${(lon + span).toFixed(4)}&level=${level}`;
          // Check client-side cache first — avoids hitting Overpass again
          // when the camera returns to a previously fetched area.
          const cacheKey = roadsCacheKey(lat - span, lon - span, lat + span, lon + span, level);
          const cached = getCachedRoads(cacheKey);
          if (cached && roadsHandleRef.current) {
            roadsHandleRef.current.setRoads(cached.roads);
            roadsHandleRef.current.setCongestion(cached.congestions);
            cctvHandleRef.current?.setRoads(cached.roads);
            setLayerLoading("traffic", false);
            trafficInFlight = false;
            return;
          }
          const res = await fetch(url, {
            signal: AbortSignal.any([trafficAbort.signal, AbortSignal.timeout(60_000)]),
          });
          if (!res.ok) return;
          const data: {
            vehicles?: VehicleSeed[];
            congestions?: Record<number, number>;
            roads?: RoadSegment[];
          } = await res.json();
          if (disposed || viewer.isDestroyed()) return;
          // Feed roads to the roads layer sequentially, biggest class first
          // (motorway → trunk → primary → secondary → tertiary) so the user
          // sees highways appear immediately, then finer roads stream in.
          if (data.roads && roadsHandleRef.current) {
            const allRoads = data.roads;
            const CLASS_PRIORITY: Record<string, number> = {
              motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
            };
            const sorted = [...allRoads].sort(
              (a, b) => (CLASS_PRIORITY[a.class] ?? 99) - (CLASS_PRIORITY[b.class] ?? 99),
            );
            // Add motorways + trunks immediately (first batch)
            const batch1 = sorted.filter((r) => (CLASS_PRIORITY[r.class] ?? 99) <= 1);
            const rest = sorted.filter((r) => (CLASS_PRIORITY[r.class] ?? 99) > 1);
            roadsHandleRef.current.setRoads(batch1);
            // CCTV road-snap only on final batch to avoid repeated rebuilds.
            if (rest.length === 0) cctvHandleRef.current?.setRoads(batch1);
            // Add remaining classes in small batches with delays
            if (rest.length > 0) {
              const batchSize = Math.ceil(rest.length / 4);
              let idx = 0;
              const addNextBatch = () => {
                if (disposed || viewer.isDestroyed()) return;
                const batch = rest.slice(idx, idx + batchSize);
                idx += batchSize;
                if (batch.length > 0) {
                  // setRoads replaces; pass ALL roads seen so far to avoid
                  // removing earlier batches.
                  roadsHandleRef.current?.setRoads([...batch1, ...rest.slice(0, idx)]);
                }
                if (idx < rest.length) {
                  setTimeout(addNextBatch, 150);
                } else {
                  // All done — feed CCTV once with full road set + cache
                  cctvHandleRef.current?.setRoads(allRoads);
                  if (data.congestions) {
                    setCachedRoads(cacheKey, allRoads, data.congestions);
                  }
                }
              };
              setTimeout(addNextBatch, 200);
            } else {
              // All roads were motorway/trunk — cache immediately
              if (data.congestions) {
                setCachedRoads(cacheKey, allRoads, data.congestions);
              }
            }
          }
          // Recolor road polylines with fresh congestion values.
          if (data.congestions && roadsHandleRef.current) {
            roadsHandleRef.current.setCongestion(data.congestions);
          }
        } catch {
          // traffic endpoint down — skip silently
        } finally {
          trafficInFlight = false;
          setLayerLoading("traffic", false);
        }
      };
      pollTrafficRef.current = pollTraffic;
      setTimeout(() => pollTraffic(true), 3_000);
      trafficTimer = setInterval(() => pollTraffic(false), 20_000);
    } catch (err) {
      console.error("[globe] traffic layer failed", err);
    }

    // Satellites layer — ISS, Hubble, Starlink, etc. Positions fetched from
    // /api/satellites which uses TLE data + satellite.js propagation.
    let satellitesHandle: ReturnType<typeof createSatellitesLayer> | null = null;
    let satTimer: ReturnType<typeof setInterval> | null = null;
    let satInFlight = false;
    try {
      satellitesHandle = createSatellitesLayer(viewer);
      satellitesHandleRef.current = satellitesHandle;

      // Expose trajectory callbacks for SatellitePanel
      (window as any).__showSatTrajectory = (satId: string) => {
        const tle = satTleMapRef.current[satId];
        satellitesHandleRef.current?.showTrajectory(satId, tle);
      };
      (window as any).__clearSatTrajectory = () => {
        satellitesHandleRef.current?.clearTrajectory();
      };

      const pollSatellites = async () => {
        if (disposed || viewer.isDestroyed() || satInFlight) return;
        satInFlight = true;
        try {
          const res = await fetch("/api/satellites", {
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) return;
          const data: { satellites?: SatelliteData[] } = await res.json();
          if (data.satellites && !disposed && !viewer.isDestroyed()) {
            // Build TLE map from response for ground track computation
            const tleMap: Record<string, [string, string]> = {};
            for (const sat of data.satellites) {
              if ((sat as any).tle && (sat as any).tle.length === 2) {
                tleMap[sat.id] = [(sat as any).tle[0], (sat as any).tle[1]];
              }
            }
            satTleMapRef.current = tleMap;
            // Show only toggled-on satellites
            const vis = useGlobeStore.getState().visibleSatellites;
            satellitesHandle?.setSatellites(data.satellites, tleMap, vis);
          }
        } catch {
          // satellite endpoint down — skip silently
        } finally {
          satInFlight = false;
        }
      };
      setTimeout(pollSatellites, 10_000);
      satTimer = setInterval(pollSatellites, 60_000); // refresh every 60s
    } catch (err) {
      console.error("[globe] satellites layer failed", err);
    }

    // Sentinel-2 imagery layer — historical satellite imagery overlay.
    // Created once; toggled via sentinelEnabled store state.
    try {
      sentinelHandleRef.current = createSentinelLayer(viewer);
    } catch (err) {
      console.error("[globe] sentinel layer failed", err);
    }

    // GIBS imagery layer — NASA daily planet-level imagery.
    try {
      gibsHandleRef.current = mountGibsLayer(viewer);
    } catch (err) {
      console.error("[globe] gibs layer failed", err);
    }

    // KartaView street-level photo layer — mounted once; fed by a fetch
    // effect that polls /api/kartaview with the current camera bbox when
    // the layer is toggled visible.
    let kartaviewHandle: KartaviewLayerHandle | null = null;
    try {
      kartaviewHandle = mountKartaviewLayer(viewer);
      kartaviewHandleRef.current = kartaviewHandle;
    } catch (err) {
      console.error("[globe] kartaview layer failed", err);
    }

    return () => {
      disposed = true;
      milDisposed = true;
      eventsDisposed = true;
      destroyHover();
      destroyClick();
      destroyKeyboard();
      if (flightsTimer) clearInterval(flightsTimer);
      flightsAbort?.abort();
      flightsHandle?.destroy();
      if (milTimer) clearInterval(milTimer);
      milAbort?.abort();
      milHandle?.destroy();
      if (eventsTimer) clearInterval(eventsTimer);
      eventsAbort?.abort();
      eventsHandle?.destroy();
      instabilityHandleRef.current?.destroy();
      gibsHandleRef.current?.destroy();
      destroyEventsCameraMove?.();
      roadsHandle?.destroy();
      if (cctvTimer) clearTimeout(cctvTimer);
      unsubCctvStore();
      cctvHandle?.destroy();
      if (trafficTimer) clearInterval(trafficTimer);
      trafficAbort?.abort();
      trafficHandle?.destroy();
      if (satTimer) clearInterval(satTimer);
      satellitesHandle?.destroy();
      sentinelHandleRef.current?.destroy();
      kartaviewHandle?.destroy();
      kartaviewHandleRef.current = null;
      flightsHandleRef.current = null;
      milHandleRef.current = null;
      eventsHandleRef.current = null;
      roadsHandleRef.current = null;
      cctvHandleRef.current = null;
      trafficHandleRef.current = null;
      for (const layer of LAYERS) {
        try {
          layer.destroy?.();
        } catch {
          // best effort
        }
      }
      viewer.destroy();
      viewerRef.current = null;
      if (typeof window !== "undefined") {
        (window as unknown as { __viewer?: Cesium.Viewer }).__viewer = undefined;
      }
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to layer visibility toggles from the Zustand store and push
  // them into each layer's setShow(). Layers in the LAYERS registry handle
  // themselves; the inline-mounted flights/roads/cctv handles are reached
  // via refs.
  useEffect(() => {
    if (!ready) return;
    for (const layer of LAYERS) {
      try {
        layer.setShow?.(layerVisibility[layer.id] ?? true);
      } catch {
        // best effort
      }
    }
    flightsHandleRef.current?.setShow(layerVisibility.flights ?? true);
    milHandleRef.current?.setShow(layerVisibility.mil ?? true);
    eventsHandleRef.current?.setShow(layerVisibility.events ?? true);
    instabilityHandleRef.current?.setShow(layerVisibility.events ?? true);
    // Roads visibility is tied to the traffic toggle — when traffic is on,
    // roads show with congestion coloring; when off, both are hidden.
    roadsHandleRef.current?.setShow(layerVisibility.traffic ?? true);
    cctvHandleRef.current?.setShow(layerVisibility.cctv ?? true);
    kartaviewHandleRef.current?.setShow(layerVisibility.kartaview ?? true);
    trafficHandleRef.current?.setShow(layerVisibility.traffic ?? true);
  }, [layerVisibility, ready]);

  // Road class filter — update roads layer when toggles change.
  const roadClassVisibility = useGlobeStore((s) => s.roadClassVisibility);
  useEffect(() => {
    if (!ready) return;
    const activeClasses = new Set(
      Object.entries(roadClassVisibility)
        .filter(([, v]) => v)
        .map(([k]) => k),
    );
    roadsHandleRef.current?.setVisibleClasses(activeClasses);
  }, [roadClassVisibility, ready]);

  // When traffic is toggled ON, trigger an immediate fetch so roads appear
  // right away instead of waiting for the next 30s poll cycle.
  const trafficEnabled = layerVisibility.traffic;
  const trafficFetchTriggered = useRef(false);
  useEffect(() => {
    if (!ready || !trafficEnabled) {
      trafficFetchTriggered.current = false;
      return;
    }
    if (!trafficFetchTriggered.current) {
      trafficFetchTriggered.current = true;
      // Force initial fetch regardless of altitude — bypass the 3000m gate
      // so roads appear immediately when the user enables traffic.
      const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
      if (v && !v.isDestroyed()) {
        const carto = v.camera.positionCartographic;
        const lon = (carto.longitude * 180) / Math.PI;
        const lat = (carto.latitude * 180) / Math.PI;
        const level: 1 | 2 | 3 = carto.height > 3_000 ? 1 : carto.height > 1_500 ? 2 : 3;
        const span = Math.min(1, Math.max(0.08, carto.height / 10_000));
        // Directly fetch roads via the API and push to the layer
        const url =
          `/api/traffic?south=${(lat - span).toFixed(4)}&west=${(lon - span).toFixed(4)}` +
          `&north=${(lat + span).toFixed(4)}&east=${(lon + span).toFixed(4)}&level=${level}`;
        useGlobeStore.getState().setLayerLoading("traffic", true);
        fetch(url)
          .then(r => r.ok ? r.json() : null)
          .then((data: { roads?: RoadSegment[]; congestions?: Record<number, number> } | null) => {
            if (data?.roads && roadsHandleRef.current) {
              roadsHandleRef.current.setRoads(data.roads);
              cctvHandleRef.current?.setRoads(data.roads);
              if (data.congestions) roadsHandleRef.current.setCongestion(data.congestions);
            }
          })
          .catch(() => {})
          .finally(() => useGlobeStore.getState().setLayerLoading("traffic", false));
      }
    }
  }, [trafficEnabled, ready]);

  // When the satellites layer is toggled ON, trigger an immediate fetch so
  // satellite markers appear right away instead of waiting for the 60s poll.
  const satellitesEnabled = layerVisibility.satellites;
  const satFetchTriggered = useRef(false);
  useEffect(() => {
    if (!ready) return;
    satellitesHandleRef.current?.setShow(satellitesEnabled);
    if (!satellitesEnabled) {
      satFetchTriggered.current = false;
      return;
    }
    if (!satFetchTriggered.current) {
      satFetchTriggered.current = true;
      // Trigger immediate fetch
      (async () => {
        try {
          const res = await fetch("/api/satellites", { signal: AbortSignal.timeout(60_000) });
          if (!res.ok) return;
          const data: { satellites?: SatelliteData[] } = await res.json();
          if (data.satellites) {
            const tleMap: Record<string, [string, string]> = {};
            for (const sat of data.satellites) {
              if ((sat as any).tle && (sat as any).tle.length === 2) {
                tleMap[sat.id] = [(sat as any).tle[0], (sat as any).tle[1]];
              }
            }
            satTleMapRef.current = tleMap;
            satDataCacheRef.current = data.satellites;
            const vis = useGlobeStore.getState().visibleSatellites;
            satellitesHandleRef.current?.setSatellites(data.satellites, tleMap, vis);
          }
        } catch (e) {
          console.error('[CesiumGlobe] Satellites fetch error:', e);
        }
      })();
    }
  }, [satellitesEnabled, ready]);

  // When individual satellite toggles change, just re-filter (no re-fetch)
  const visibleSatellites = useGlobeStore((s) => s.visibleSatellites);
  useEffect(() => {
    if (!ready || !satellitesEnabled) return;
    const cachedData = satDataCacheRef.current;
    if (cachedData) {
      satellitesHandleRef.current?.setSatellites(cachedData, satTleMapRef.current, visibleSatellites);
    }
  }, [satellitesEnabled, ready, visibleSatellites]);

  // Handle trajectory requests from SatellitePanel
  const requestedTrajectory = useGlobeStore((s) => s.requestedSatelliteTrajectory);
  const clearRequestedTrajectory = useGlobeStore((s) => s.setRequestedSatelliteTrajectory);
  useEffect(() => {
    if (!ready || !requestedTrajectory) return;
    const tle = satTleMapRef.current[requestedTrajectory];
    satellitesHandleRef.current?.showTrajectory(requestedTrajectory, tle);
    clearRequestedTrajectory(null);
  }, [requestedTrajectory, ready, clearRequestedTrajectory]);

  // Re-filter CCTV cameras when source toggles, active city changes, or CCTV layer is toggled.
  const cctvSources = useGlobeStore((s) => s.cctvSources);
  const activeCity = useGlobeStore((s) => s.activeCity);
  const cctvVisible = layerVisibility.cctv ?? false;
  const cctvCamerasFromStore = useGlobeStore((s) => s.cctvCameras);
  useEffect(() => {
    if (!ready) return;
    // Sync cameras from store to ref, then push
    if (cctvCamerasFromStore.length > 0) {
      allCctvCamerasRef.current = cctvCamerasFromStore;
    }
    (window as unknown as { __pushFilteredCctv?: () => void }).__pushFilteredCctv?.();
    // Also update instability heatmap granularity (country vs state)
    instabilityHandleRef.current?.setActiveCity(activeCity);
  }, [cctvSources, activeCity, ready, cctvVisible, cctvCamerasFromStore]);

  // Sentinel-2 imagery — toggle on/off and update date.
  // Layer visibility is controlled by the "sentinel" layer toggle in TacticalHUD.
  const sentinelEnabled = layerVisibility.sentinel ?? false;
  const sentinelDate = useGlobeStore((s) => s.sentinelDate);
  const sentinelGranularity = useGlobeStore((s) => s.sentinelGranularity);
  const sentinelInitRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (sentinelEnabled && !sentinelInitRef.current) {
      sentinelInitRef.current = true;
      // Prompt for Copernicus instance ID on first enable
      sentinelHandleRef.current?.promptInstanceId().then(() => {
        sentinelHandleRef.current?.setEnabled(true);
        sentinelHandleRef.current?.setDate(sentinelDate);
      });
    } else if (sentinelEnabled) {
      sentinelHandleRef.current?.setEnabled(true);
      sentinelHandleRef.current?.setDate(sentinelDate);
    } else {
      sentinelInitRef.current = false;
      sentinelHandleRef.current?.setEnabled(false);
    }
  }, [sentinelEnabled, sentinelDate, ready]);

  // When granularity changes (weekly <-> monthly), rebuild the WMS layer
  // with the new TIME range format. No-op if layer is off.
  useEffect(() => {
    if (!ready || !sentinelEnabled) return;
    sentinelHandleRef.current?.setGranularity(sentinelGranularity);
  }, [sentinelGranularity, sentinelEnabled, ready]);

  // GIBS imagery — toggle on/off and update date.
  const gibsEnabled = layerVisibility.gibs ?? false;
  const gibsDate = useGlobeStore((s) => s.gibsDate);
  useEffect(() => {
    if (!ready) return;
    gibsHandleRef.current?.setShow(gibsEnabled);
    if (gibsEnabled && gibsDate) {
      gibsHandleRef.current?.setDate(gibsDate);
    }
  }, [gibsEnabled, gibsDate, ready]);

  // KartaView street-level photos — fetch on toggle + refetch on camera move.
  // Polls /api/kartaview with the current camera viewport bbox (computed via
  // viewer.camera.computeViewRectangle()) so only photos in view are loaded.
  const kartaviewEnabled = layerVisibility.kartaview ?? false;
  useEffect(() => {
    if (!ready || !kartaviewEnabled) return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const setLayerLoading = useGlobeStore.getState().setLayerLoading;
    let aborted = false;
    let abort: AbortController | null = null;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const computeBbox = (): string => {
      try {
        const carto = viewer.camera.positionCartographic;
        const rect = viewer.camera.computeViewRectangle();
        const span = Math.min(5, Math.max(0.5, carto.height / 50_000));
        let west: number, south: number, east: number, north: number;
        if (rect) {
          west = Cesium.Math.toDegrees(rect.west);
          south = Cesium.Math.toDegrees(rect.south);
          east = Cesium.Math.toDegrees(rect.east);
          north = Cesium.Math.toDegrees(rect.north);
          const latCenter = (south + north) / 2;
          const lonCenter = (west + east) / 2;
          const latHalf = Math.max((north - south) / 2, span);
          const lonHalf = Math.max((east - west) / 2, span);
          west = lonCenter - lonHalf;
          east = lonCenter + lonHalf;
          south = latCenter - latHalf;
          north = latCenter + latHalf;
        } else {
          const lat = Cesium.Math.toDegrees(carto.latitude);
          const lon = Cesium.Math.toDegrees(carto.longitude);
          west = lon - span;
          south = lat - span;
          east = lon + span;
          north = lat + span;
        }
        return [south, west, north, east].map((v) => v.toFixed(3)).join(",");
      } catch {
        return "";
      }
    };

    const poll = async () => {
      if (aborted || viewer.isDestroyed()) return;
      const bbox = computeBbox();
      if (!bbox) return;
      abort?.abort();
      abort = new AbortController();
      setLayerLoading("kartaview", true);
      try {
        const res = await fetch(`/api/kartaview?bbox=${encodeURIComponent(bbox)}`, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
        });
        if (!res.ok) return;
        const data: { photos?: KartaviewPhoto[] } = await res.json();
        if (data.photos && !aborted && !viewer.isDestroyed()) {
          kartaviewHandleRef.current?.setPhotos(data.photos);
        }
      } catch {
        // network error or timeout — skip silently
      } finally {
        setLayerLoading("kartaview", false);
      }
    };

    const onCameraMove = () => {
      if (moveTimer) clearTimeout(moveTimer);
      moveTimer = setTimeout(() => { void poll(); }, 2_000);
    };

    const initialTimer = setTimeout(() => void poll(), 1_500);
    pollTimer = setInterval(() => void poll(), 300_000);
    viewer.camera.changed.addEventListener(onCameraMove);

    return () => {
      aborted = true;
      if (pollTimer) clearInterval(pollTimer);
      if (moveTimer) clearTimeout(moveTimer);
      if (initialTimer) clearTimeout(initialTimer);
      abort?.abort();
      try { viewer.camera.changed.removeEventListener(onCameraMove); } catch { /* best effort */ }
      kartaviewHandleRef.current?.setPhotos([]);
      setLayerLoading("kartaview", false);
    };
  }, [kartaviewEnabled, ready]);

  // Google Photorealistic 3D Tiles — strictly opt-in. Mounts ONLY when the
  // user flips the 3D TILES button (googleTilesEnabled), so no Google Maps
  // API requests are ever fired on page load. While active, the OSM
  // buildings layer is hidden (photoreal includes its own buildings).
  const googleTilesEnabled = useGlobeStore((s) => s.googleTilesEnabled);
  useEffect(() => {
    if (!ready) return;
    if (!googleTilesEnabled) return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Hide OSM buildings while photoreal is active.
    const buildingsLayer = LAYERS.find((l) => l.id === "buildings");
    buildingsLayer?.setShow?.(false);

    // Hide the base Esri imagery layer — Google Photorealistic 3D Tiles
    // include their own terrain + imagery mesh, so the base layer underneath
    // is redundant and blocks zoom-in / causes z-fighting at ground level.
    const baseImagery = viewer.imageryLayers.get(0);
    if (baseImagery) baseImagery.show = false;

    let destroyed = false;
    let handle: { destroy(): void } | null = null;

    (async () => {
      try {
        handle = await mountGoogleTilesLayer(viewer);
        if (destroyed) {
          handle?.destroy();
          handle = null;
          return;
        }
      } catch (err) {
        console.error("[globe] google 3d tiles failed", err);
      }
    })();

    return () => {
      destroyed = true;
      handle?.destroy();
      handle = null;
      // Restore OSM buildings when photoreal is turned off.
      buildingsLayer?.setShow?.(useGlobeStore.getState().layerVisibility.buildings ?? true);
      // Restore the base imagery layer that was hidden while 3D tiles were on.
      const baseImg = viewer.imageryLayers.get(0);
      if (baseImg) baseImg.show = true;
      viewer.scene.requestRender();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleTilesEnabled, ready]);

  // Private-flight tracking — when the user hits TRACK in the private
  // flights panel, highlight that jet in gold, speed up polling, auto-render
  // its trajectory, and accumulate a live gold trail as positions come in.
  const trackedTailCallsign = useGlobeStore((s) => s.trackedTailCallsign);
  const trackedTailName = useGlobeStore((s) => s.trackedTailName);
  const trackedTailIcao24 = useGlobeStore((s) => s.trackedTailIcao24);
  useEffect(() => {
    if (!ready) return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Update the gold highlight on the flights billboards.
    flightsHandleRef.current?.setTracked(trackedTailCallsign);
    // Solo mode: while tracking one private jet, hide ALL military planes so
    // only the tracked jet (and its origin→destination arc) remain visible.
    milHandleRef.current?.setSoloMode(trackedTailCallsign != null);

    // Clear any existing trail polyline before starting a new one.
    if (trackedTrailRef.current && !viewer.isDestroyed()) {
      viewer.entities.remove(trackedTrailRef.current);
      trackedTrailRef.current = null;
    }

    const callsign = trackedTailCallsign;
    const icao24 = trackedTailIcao24;
    if (!callsign) {
      viewer.scene.requestRender();
      return;
    }

    let destroyed = false;
    let trailPoints: { time: number; lat: number; lon: number; alt: number | null }[] = [];
    let lastTrailPoint = 0;
    // Grounded-plane state: when the tracked aircraft isn't airborne, the
    // trajectory's final waypoint is where it's parked now. We drop a gold
    // marker + label there ("where the plane is right now").
    let live = false;
    let landedDest: string | null = null;
    let landedOriginCode: string | null = null;
    // Exact parked position from the live feed (plane transmitting ADS-B on
    // the ramp). When null, the marker falls back to the trajectory's last
    // waypoint (the touchdown point).
    let landedPos: { lat: number; lon: number } | null = null;
    // Destination + origin airport coordinates resolved server-side. The
    // destination anchors the marker ("parked here now"); origin + destination
    // draw the parabolic "where it came from" arc when OpenSky has no track.
    let landedAirport: { lat: number; lon: number } | null = null;
    let landedOrigin: { lat: number; lon: number } | null = null;
    // Last-known position from the live feed store (fallback when OpenSky
    // has no trajectory and no airport coords).
    let landedLastKnown: { lat: number; lon: number } | null = null;
    let landedMarkerRef: ReturnType<typeof viewer.entities.add> | null = null;
    // Center the camera on the tracked jet exactly once when TRACK is pressed
    // (not on every poll — that would yank the view around).
    let didFlyTo = false;
    const addPoint = (p: { time: number; lat: number; lon: number; alt: number | null }) => {
      // Skip duplicate timestamps — the same waypoint can appear in the
      // initial trajectory fetch and again on the next live poll.
      if (p.time === lastTrailPoint) return;
      lastTrailPoint = p.time;
      trailPoints.push(p);
      if (trailPoints.length > 240) trailPoints = trailPoints.slice(-240);
    };
    // Shows a pulsing gold marker at the last trajectory waypoint (the
    // touchdown position) when the plane is grounded; hides it when live.
    const renderLandedMarker = () => {
      if (destroyed || viewer.isDestroyed()) return;
      const CesiumMod = (window as unknown as { __Cesium?: typeof Cesium }).__Cesium;
      if (!CesiumMod) return;
      const anchor =
        landedPos ??
        (trailPoints.length > 0 ? trailPoints[trailPoints.length - 1] : null) ??
        landedAirport ??
        landedOrigin ??
        landedLastKnown;
      const show = !live && anchor != null;
      // Honest label: "LANDED" when we know the destination airport (or a
      // live/trajectory touchdown position); "LAST KNOWN" when we only have
      // the origin airport from the last flight record or the live feed.
      let labelText = `${callsign} · LANDED`;
      if (anchor === landedAirport) {
        labelText = `${callsign} · LANDED${landedDest ? ` · ${landedDest}` : ""}`;
      } else if (anchor === landedOrigin) {
        labelText = `${callsign} · LAST KNOWN${landedOriginCode ? ` · ${landedOriginCode}` : ""}`;
      } else if (anchor === landedLastKnown) {
        labelText = `${callsign} · LAST KNOWN`;
      }
      if (landedMarkerRef) {
        if (!show) {
          viewer.entities.remove(landedMarkerRef);
          landedMarkerRef = null;
        } else {
          const pos = CesiumMod.Cartesian3.fromDegrees(anchor!.lon, anchor!.lat, 60);
          landedMarkerRef.position = new CesiumMod.ConstantPositionProperty(pos);
        }
      } else if (show) {
        const pos = CesiumMod.Cartesian3.fromDegrees(anchor!.lon, anchor!.lat, 60);
        landedMarkerRef = viewer.entities.add({
          id: `tracked_landed_${callsign}`,
          position: pos,
          point: {
            pixelSize: 10,
            color: CesiumMod.Color.fromBytes(0xff, 0xc8, 0x2a, 220),
            outlineColor: CesiumMod.Color.fromBytes(0x00, 0xd4, 0xff, 255),
            outlineWidth: 2,
          },
          label: {
            text: labelText,
            font: "bold 12px monospace",
            fillColor: CesiumMod.Color.fromBytes(0xff, 0xc8, 0x2a, 255),
            showBackground: true,
            backgroundColor: CesiumMod.Color.fromBytes(0x02, 0x04, 0x08, 200),
            backgroundPadding: CesiumMod.Cartesian2.fromElements(6, 4),
            pixelOffset: CesiumMod.Cartesian2.fromElements(0, -18),
            distanceDisplayCondition: new CesiumMod.DistanceDisplayCondition(0, 1_500_000),
          },
        });
      }
      viewer.scene.requestRender();
    };
    // Renders the classic parabolic "origin → destination" flight-path arc:
    // a great-circle interpolation from the first waypoint to the last with a
    // sin(πt) altitude profile peaking at cruise altitude mid-way.
    const renderTrail = () => {
      if (destroyed || viewer.isDestroyed() || trailPoints.length < 2) return;
      const CesiumMod = (window as unknown as { __Cesium?: typeof Cesium }).__Cesium;
      if (!CesiumMod) return;
      const origin = trailPoints[0];
      const dest = trailPoints[trailPoints.length - 1];
      const maxAlt = trailPoints.reduce(
        (m, p) => (typeof p.alt === "number" && p.alt > m ? p.alt : m),
        0,
      );
      const cruiseAlt = maxAlt > 100 ? maxAlt : 10_000;
      const positions = buildArcPositions(
        origin.lat, origin.lon,
        dest.lat, dest.lon,
        cruiseAlt, 48,
      );
      if (!trackedTrailRef.current) {
        trackedTrailRef.current = viewer.entities.add({
          id: `tracked_trail_${callsign}`,
          polyline: {
            positions,
            width: 3,
            material: new CesiumMod.PolylineGlowMaterialProperty({
              glowPower: 0.35,
              color: CesiumMod.Color.fromBytes(0xff, 0xc8, 0x2a, 200),
            }),
            clampToGround: false,
          },
        });
      } else if (trackedTrailRef.current.polyline) {
        (trackedTrailRef.current.polyline as { positions?: unknown }).positions = positions;
      }
      viewer.scene.requestRender();
    };

    // Landed plane: no OpenSky trajectory exists, so rebuild the classic
    // parabolic flight-path arc from the flight's origin airport to its
    // destination airport — "where the plane came from".
    const renderLandedArc = () => {
      if (destroyed || viewer.isDestroyed()) return;
      if (live || trailPoints.length >= 2) return;
      if (!landedOrigin || !landedAirport) return;
      const CesiumMod = (window as unknown as { __Cesium?: typeof Cesium }).__Cesium;
      if (!CesiumMod) return;
      const cruiseAlt = 10_000;
      const positions = buildArcPositions(
        landedOrigin.lat, landedOrigin.lon,
        landedAirport.lat, landedAirport.lon,
        cruiseAlt, 48,
      );
      if (!trackedTrailRef.current) {
        trackedTrailRef.current = viewer.entities.add({
          id: `tracked_trail_${callsign}`,
          polyline: {
            positions,
            width: 3,
            material: new CesiumMod.PolylineGlowMaterialProperty({
              glowPower: 0.35,
              color: CesiumMod.Color.fromBytes(0xff, 0xc8, 0x2a, 200),
            }),
            clampToGround: false,
          },
        });
      } else if (trackedTrailRef.current.polyline) {
        (trackedTrailRef.current.polyline as { positions?: unknown }).positions = positions;
      }
      viewer.scene.requestRender();
    };

    // 1. Seed the trail with the full trajectory from /api/flights/track.
    let abort: AbortController | null = null;
    const fetchTrajectory = async () => {
      if (destroyed || viewer.isDestroyed()) return;
      if (!icao24) return;
      abort?.abort();
      abort = new AbortController();
      try {
        const res = await fetch(
          `/api/flights/track?icao24=${encodeURIComponent(icao24)}&tail=${encodeURIComponent(callsign)}`,
          { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) },
        );
        if (!res.ok) return;
        const data: {
          trajectory?: { time: number; lat: number; lon: number; alt: number | null }[];
          origin?: string | null;
          destination?: string | null;
          live?: boolean;
          landedAirport?: { icao: string; name: string; lat: number; lon: number } | null;
          landedOriginAirport?: { icao: string; name: string; lat: number; lon: number } | null;
          lastKnownPosition?: { lat: number; lon: number; alt: number | null; lastContact: number } | null;
        } = await res.json();
        // Track airborne/live state so we can flip to the "landed here now"
        // marker the moment the jet is on the ground.
        if (typeof data.live === "boolean") live = data.live;
        if (data.destination) landedDest = data.destination;
        if (data.origin) landedOriginCode = data.origin;
        if (data.landedAirport) {
          landedAirport = { lat: data.landedAirport.lat, lon: data.landedAirport.lon };
        }
        if (data.landedOriginAirport) {
          landedOrigin = { lat: data.landedOriginAirport.lat, lon: data.landedOriginAirport.lon };
        }
        if (data.lastKnownPosition) {
          landedLastKnown = { lat: data.lastKnownPosition.lat, lon: data.lastKnownPosition.lon };
        }
        if (!Array.isArray(data.trajectory)) return;
        const hadPoints = trailPoints.length > 0;
        for (const p of data.trajectory) addPoint(p);
        renderTrail();
        renderLandedArc();
        renderLandedMarker();
        flyToTracked();
        void hadPoints;
      } catch {
        // rate-limited or network error — trail continues from live polls
      }
    };

    // 2. Faster live polling while tracking: hit /api/flights every 15s and
    //    append the tracked callsign's current position to the trail. The
    //    open feeds stay open on the billboard layer; this just extends the
    //    gold line in place.
    const pollTracked = async () => {
      if (destroyed || viewer.isDestroyed()) return;
      abort?.abort();
      abort = new AbortController();
      try {
        const res = await fetch("/api/flights", {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
        });
        if (!res.ok) return;
        const data: { flights?: FlightState[] } = await res.json();
        const match = (data.flights ?? []).find(
          (f) => f.callsign && f.callsign.toUpperCase() === callsign,
        );
        // If the tracked jet re-enters the live feed airborne, drop the
        // "landed here" marker and let the billboard take over. If it's on
        // the ground in the feed, pin the marker to its live parked position
        // (exact). If it's gone entirely (dark on the ramp), keep the marker
        // anchored on the trajectory's touchdown point. Live position is
        // otherwise left to the billboard layer; we never append it to the
        // arc, so the parabola's destination stays pinned to the trajectory.
        if (match && !match.onGround) {
          live = true;
          landedPos = null;
        } else {
          live = false;
          landedPos = match
            ? { lat: match.latitude, lon: match.longitude }
            : null;
        }
        renderLandedMarker();
        renderLandedArc();
        flyToTracked();
      } catch {
        // skip silently
      }
    };

    // Center the camera on the tracked plane once we know where it is:
    // live trajectory end (airborne) → live grounded position → destination
    // airport → last-known airport (landed).
    const flyToTracked = () => {
      if (didFlyTo || destroyed || viewer.isDestroyed()) return;
      const CesiumMod = (window as unknown as { __Cesium?: typeof Cesium }).__Cesium;
      if (!CesiumMod) return;
      let target: { lat: number; lon: number } | null = null;
      let height = 5_000;
      if (live && trailPoints.length > 0) {
        const p = trailPoints[trailPoints.length - 1];
        target = { lat: p.lat, lon: p.lon };
      } else if (landedPos) {
        target = landedPos;
        height = 5_000;
      } else if (landedAirport) {
        target = landedAirport;
        height = 5_000;
      } else if (landedOrigin) {
        target = landedOrigin;
        height = 5_000;
      } else if (landedLastKnown) {
        target = landedLastKnown;
        height = 5_000;
      }
      if (!target) return;
      didFlyTo = true;
      const bs = new CesiumMod.BoundingSphere(
        CesiumMod.Cartesian3.fromDegrees(target.lon, target.lat, 0),
        1000,
      );
      viewer.camera.flyToBoundingSphere(bs, {
        offset: new CesiumMod.HeadingPitchRange(
          0,
          CesiumMod.Math.toRadians(-55),
          height,
        ),
        duration: 2.5,
      });
    };

    fetchTrajectory();
    const liveTimer = setInterval(pollTracked, 15_000);
    // Keep the trajectory fresh every 2 min while tracking so the tail
    // (past flight history) doesn't go stale.
    const trajTimer = setInterval(fetchTrajectory, 120_000);

    return () => {
      destroyed = true;
      abort?.abort();
      clearInterval(liveTimer);
      clearInterval(trajTimer);
      if (!viewer.isDestroyed()) {
        if (trackedTrailRef.current) {
          viewer.entities.remove(trackedTrailRef.current);
          trackedTrailRef.current = null;
        }
        if (landedMarkerRef) {
          viewer.entities.remove(landedMarkerRef);
          landedMarkerRef = null;
        }
        viewer.scene.requestRender();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedTailCallsign, trackedTailIcao24, ready]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
