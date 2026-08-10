"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CctvCamera } from "@/lib/sources/cctv";
import type { FlightState } from "@/lib/sources/opensky";
import type { MilitaryFlight } from "@/lib/sources/airplanes-live";
import { CIVIL_UNREST_TYPES } from "@/globe/layers/events-layer";
import HoverPopup from "@/components/HoverPopup";
import FlightTrajectoryOverlay from "@/components/FlightTrajectoryOverlay";
import CircleMask from "@/components/CircleMask";
import CoordinatesPanel from "@/components/CoordinatesPanel";
import LocationPanel from "@/components/LocationPanel";
import SatellitePanel from "@/components/SatellitePanel";
import TrafficPanel from "@/components/TrafficPanel";
import InstabilityPanel from "@/components/InstabilityPanel";
import LiveReplayPanel from "@/components/LiveReplayPanel";
import FlightDetailPanel from "@/components/FlightDetailPanel";
import ReplayTimeline from "@/components/ReplayTimeline";
import TacticalHUD from "@/components/TacticalHUD";
import CityBookmarks from "@/components/CityBookmarks";
import { useGlobeStore } from "@/store/globe-store";

const CesiumGlobe = dynamic(() => import("@/components/CesiumGlobe"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#444",
        fontSize: 11,
        letterSpacing: 1,
      }}
    >
      INITIALIZING…
    </div>
  ),
});

export default function Page() {
  const hoveredCctvId = useGlobeStore((s) => s.hoveredCctvId);
  const hoveredEventId = useGlobeStore((s) => s.hoveredEventId);
  const hoveredFlightId = useGlobeStore((s) => s.hoveredFlightId);
  const hoveredBuilding = useGlobeStore((s) => s.hoveredBuilding);
  const hoveredRegion = useGlobeStore((s) => s.hoveredRegion);
  const hoveredSatelliteId = useGlobeStore((s) => s.hoveredSatelliteId);
  const hoveredKind = useGlobeStore((s) => s.hoveredKind);
  const hoverPos = useGlobeStore((s) => s.hoverPos);
  const satellitesOn = useGlobeStore((s) => s.layerVisibility.satellites);
  const trafficOn = useGlobeStore((s) => s.layerVisibility.traffic);
  const gibsOn = useGlobeStore((s) => s.layerVisibility.gibs);
  const sentinelOn = useGlobeStore((s) => s.layerVisibility.sentinel);
  const replayPanelOpen = useGlobeStore((s) => s.replayPanelOpen);
  const eventsOn = useGlobeStore((s) => s.layerVisibility.events);
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);

  const [cctvCameras, setCctvCameras] = useState<CctvCamera[]>([]);
  const [privateFlights, setPrivateFlights] = useState<FlightState[]>([]);
  const [privateFlightsDetail, setPrivateFlightsDetail] = useState<Record<string, { lastFlight: { origin: string | null; destination: string | null; firstSeen: number | null; lastSeen: number | null; callsign: string | null } | null; personName: string | null }>>({});
  const [militaryFlights, setMilitaryFlights] = useState<MilitaryFlight[]>([]);
  const [satellites, setSatellites] = useState<any[]>([]);

  // Civil-unrest events catalog for hover popup lookups. The globe layer polls
  // /api/events with the current viewport bbox and stores the bbox-filtered
  // set here, so the popup resolves hovered cluster ids against exactly what
  // the globe rendered (no stale/global mismatch).
  const events = useGlobeStore((s) => s.events);

  // Fetch CCTV camera catalog for hover popup lookups.
  // Uses Cache API for instant load on return visits.
  useEffect(() => {
    const CCTV_CACHE_KEY = "spectre-cctv-catalog";
    const CCTV_CACHE_TTL = 30 * 60 * 1000;

    const loadFromCache = async () => {
      try {
        const cache = await caches.open(CCTV_CACHE_KEY);
        const cachedRes = await cache.match("/api/cctv");
        if (cachedRes) {
          const ts = parseInt(cachedRes.headers.get("x-cached-ts") ?? "0", 10);
          if (Date.now() - ts < CCTV_CACHE_TTL) {
            const data = await cachedRes.json();
            if (data.cameras?.length) {
              const withFeed = data.cameras.filter(
                (c: CctvCamera) => c.snapshotUrl || c.streamUrl || c.embedUrl,
              );
              setCctvCameras(withFeed);
              useGlobeStore.getState().setCctvCameras(withFeed);
              useGlobeStore.getState().setCctvCatalogLoaded(true);
              publishCounts(withFeed);
              return true;
            }
          }
        }
      } catch {}
      return false;
    };

    const fetchFromNetwork = async (background: boolean) => {
      if (!background) useGlobeStore.getState().setLayerLoading("cctv", true);
      try {
        const res = await fetch("/api/cctv");
        if (!res.ok) return;
        const data = await res.json();
        if (data.cameras) {
          // Only keep cameras with a live feed (pyramid-capable)
          const withFeed = data.cameras.filter(
            (c: CctvCamera) => c.snapshotUrl || c.streamUrl || c.embedUrl,
          );
          setCctvCameras(withFeed);
          useGlobeStore.getState().setCctvCameras(withFeed);
          useGlobeStore.getState().setCctvCatalogLoaded(true);
          publishCounts(withFeed);
          // Persist to Cache API
          try {
            const cache = await caches.open(CCTV_CACHE_KEY);
            const cachedRes = new Response(JSON.stringify(data), {
              headers: {
                "content-type": "application/json",
                "x-cached-ts": String(Date.now()),
              },
            });
            await cache.put("/api/cctv", cachedRes);
          } catch {}
        }
      } catch {
      } finally {
        if (!background) useGlobeStore.getState().setLayerLoading("cctv", false);
      }
    };

    // Compute per-source counts for the active city's bbox.
    const publishCounts = (cameras: CctvCamera[]) => {
      const { activeCity } = useGlobeStore.getState();
      if (!activeCity) {
        useGlobeStore.getState().setCctvSourceCounts({});
        return;
      }
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
      if (!coord) {
        useGlobeStore.getState().setCctvSourceCounts({});
        return;
      }
      const d = 0.5;
      const counts: Record<string, number> = {};
      for (const c of cameras) {
        if (c.lat < coord.lat - d || c.lat > coord.lat + d) continue;
        if (c.lon < coord.lon - d || c.lon > coord.lon + d) continue;
        counts[c.provider] = (counts[c.provider] ?? 0) + 1;
      }
      useGlobeStore.getState().setCctvSourceCounts(counts);
    };

    (async () => {
      const cached = await loadFromCache();
      if (!cached) {
        await fetchFromNetwork(false);
      } else {
        // Background refresh if stale (>5 min)
        const cache = await caches.open(CCTV_CACHE_KEY);
        const cachedRes = await cache.match("/api/cctv");
        const ts = parseInt(cachedRes?.headers.get("x-cached-ts") ?? "0", 10);
        if (Date.now() - ts > 5 * 60 * 1000) {
          fetchFromNetwork(true);
        }
      }
    })();
  }, []);

  // Recompute CCTV source counts when activeCity changes.
  const activeCityForCctv = useGlobeStore((s) => s.activeCity);
  useEffect(() => {
    if (cctvCameras.length === 0) return;
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
    if (!activeCityForCctv) {
      useGlobeStore.getState().setCctvSourceCounts({});
      return;
    }
    const coord = CITY_COORDS[activeCityForCctv];
    if (!coord) {
      useGlobeStore.getState().setCctvSourceCounts({});
      return;
    }
    const d = 0.5;
    const counts: Record<string, number> = {};
    for (const c of cctvCameras) {
      if (c.lat < coord.lat - d || c.lat > coord.lat + d) continue;
      if (c.lon < coord.lon - d || c.lon > coord.lon + d) continue;
      counts[c.provider] = (counts[c.provider] ?? 0) + 1;
    }
    useGlobeStore.getState().setCctvSourceCounts(counts);
  }, [activeCityForCctv, cctvCameras]);

  // Fetch satellite data for hover popup lookups.
  useEffect(() => {
    if (!satellitesOn) return;
    let aborted = false;
    const load = () => {
      fetch("/api/satellites")
        .then((res) => (res.ok ? res.json() : { satellites: [] }))
        .then((data: { satellites?: any[] }) => {
          if (!aborted && data.satellites) setSatellites(data.satellites);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      aborted = true;
      clearInterval(timer);
    };
  }, [satellitesOn]);

  // Fetch private flights catalog for hover popup lookups. Mirrors the
  // globe layer's /api/flights poll so the hovered flight's callsign /
  // origin country / altitude match what's rendered on the globe.
  // Also fetches /api/private-flights to get lastFlight details (origin,
  // destination, firstSeen, lastSeen) for the hover popup.
  useEffect(() => {
    let aborted = false;
    const load = () => {
      fetch("/api/flights")
        .then((res) => (res.ok ? res.json() : { flights: [] }))
        .then((data: { flights?: FlightState[] }) => {
          if (!aborted && data.flights) setPrivateFlights(data.flights);
        })
        .catch(() => {});
    };
    const loadDetail = () => {
      fetch("/api/private-flights")
        .then((res) => (res.ok ? res.json() : { people: [] }))
        .then((data: { people?: Array<{ name: string; tails: Array<{ icao24: string | null; lastFlight: { origin: string | null; destination: string | null; firstSeen: number | null; lastSeen: number | null; callsign: string | null } | null }> }> }) => {
          if (aborted || !data.people) return;
          const lookup: Record<string, { lastFlight: { origin: string | null; destination: string | null; firstSeen: number | null; lastSeen: number | null; callsign: string | null } | null; personName: string | null }> = {};
          for (const person of data.people) {
            for (const tail of person.tails) {
              if (tail.icao24) {
                lookup[tail.icao24] = { lastFlight: tail.lastFlight, personName: person.name };
              }
            }
          }
          setPrivateFlightsDetail(lookup);
        })
        .catch(() => {});
    };
    load();
    loadDetail();
    const timer = setInterval(load, 60_000); // 60s — matches globe cadence
    const detailTimer = setInterval(loadDetail, 120_000); // 120s — lastFlight changes slower
    return () => {
      aborted = true;
      clearInterval(timer);
      clearInterval(detailTimer);
    };
  }, []);

  // Fetch military flights catalog for hover popup lookups.
  useEffect(() => {
    let aborted = false;
    const load = () => {
      fetch("/api/military-flights")
        .then((res) => (res.ok ? res.json() : { flights: [] }))
        .then((data: { flights?: MilitaryFlight[] }) => {
          if (!aborted && data.flights) setMilitaryFlights(data.flights);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000); // 60s — matches globe cadence
    return () => {
      aborted = true;
      clearInterval(timer);
    };
  }, []);

  const hoveredCctvCamera = cctvCameras.find((c) => c.id === hoveredCctvId) || null;
  // Events are clustered by rounded lat/lon (see events-layer.ts). The
  // hoveredEventId is the cluster key (`lat3_lon3`). Resolve it to ALL
  // events in the cluster so the popup can show multiple news items.
  const hoveredEvents =
    hoveredKind === "event" && hoveredEventId
      ? events.filter((e) => {
          if (!CIVIL_UNREST_TYPES.has(e.type)) return false;
          const key = `${e.lat.toFixed(3)}_${e.lon.toFixed(3)}`;
          return key === hoveredEventId;
        })
      : [];
  const hoveredPrivateFlight =
    hoveredKind === "flight-private"
      ? privateFlights.find((f) => f.icao24 === hoveredFlightId) || null
      : null;
  const hoveredPrivateFlightDetail = hoveredFlightId ? privateFlightsDetail[hoveredFlightId] : null;
  const hoveredMilitaryFlight =
    hoveredKind === "flight-mil"
      ? militaryFlights.find((f) => f.icao24 === hoveredFlightId) || null
      : null;
  const hoveredSatellite =
    hoveredKind === "satellite" && hoveredSatelliteId
      ? satellites.find((s) => s.id === hoveredSatelliteId) || null
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#05060a",
      }}
    >
      <main style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <CesiumGlobe />
        <CircleMask />
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            color: "#888",
            fontSize: 11,
            fontFamily: "monospace",
            letterSpacing: 0.5,
            pointerEvents: "none",
          }}
        >
          SPECTRE
        </div>
        <TacticalHUD visible={true} />
        <CityBookmarks visible={!satellitesOn && !trafficOn && !eventsOn && !selectedFlightId && !replayPanelOpen && !gibsOn && !sentinelOn} />
        <CoordinatesPanel />
        <LocationPanel />
        <SatellitePanel />
        <TrafficPanel />
        <InstabilityPanel />
        <LiveReplayPanel />
        <FlightDetailPanel />
        <ReplayTimeline />
        <HoverPopup
          cctvCamera={hoveredCctvCamera}
          events={hoveredEvents}
          privateFlight={hoveredPrivateFlight}
          privateFlightDetail={hoveredPrivateFlightDetail}
          militaryFlight={hoveredMilitaryFlight}
          region={hoveredKind === "region" ? hoveredRegion : null}
          building={hoveredKind === "building" ? hoveredBuilding : null}
          satellite={hoveredSatellite}
          x={hoverPos?.x}
          y={hoverPos?.y}
        />
        <FlightTrajectoryOverlay />
      </main>
    </div>
  );
}
