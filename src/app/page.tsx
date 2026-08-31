"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import TacticalHUD from "@/components/TacticalHUD";
import RightPanel from "@/components/RightPanel";
import FlightTrajectoryOverlay from "@/components/FlightTrajectoryOverlay";
import FlightDetailPanel from "@/components/FlightDetailPanel";
import SatelliteDetailPanel from "@/components/SatelliteDetailPanel";
import FeatureDetailPanel from "@/components/FeatureDetailPanel";
import CctvDetailPanel from "@/components/CctvDetailPanel";
import CctvOverlay from "@/components/CctvOverlay";
import RegionDetailPanel from "@/components/RegionDetailPanel";
import EarthquakeOverlay from "@/components/EarthquakeOverlay";
import LocalInfrastructureOverlay from "@/components/LocalInfrastructureOverlay";
import CivilUnrestOverlay from "@/components/CivilUnrestOverlay";
import TargetingBracket from "@/components/TargetingBracket";
import CircleMask from "@/components/CircleMask";
import LocationPanel from "@/components/LocationPanel";
import CoordinatesPanel from "@/components/CoordinatesPanel";
import SearchModal from "@/components/SearchModal";
import Toast from "@/components/Toast";
import RegionPopupOverlay from "@/components/RegionPopup";
import RadioOverlay from "@/components/radio/RadioOverlay";
import ReplayTimeline from "@/components/ReplayTimeline";
import { useGlobeStore } from "@/store/globe-store";
import type { CctvCamera } from "@/lib/sources/cctv";
import { CITY_COORDS } from "@/lib/city-coords";

const CesiumGlobe = dynamic(() => import("@/components/CesiumGlobe"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#444",
        fontSize: 11,
        letterSpacing: 2,
        fontFamily: "var(--font-mono)",
      }}
    >
      INITIALIZING
    </div>
  ),
});

export default function Page() {
  const searchOpen = useGlobeStore((s) => s.searchOpen);

  // Fetch CCTV camera catalog once on mount. Uses Cache API for instant
  // load on return visits. The catalog is shared via the store; the CCTV
  // layer reads from it and filters by active city + enabled sources.
  const [cctvCameras, setCctvCameras] = useState<CctvCamera[]>([]);
  const activeCityForCctv = useGlobeStore((s) => s.activeCity);

  useEffect(() => {
    const CCTV_CACHE_KEY = "spectre-v2-cctv-catalog";
    const CCTV_CACHE_TTL = 30 * 60 * 1000;

    const publishCounts = (cameras: CctvCamera[]) => {
      const { activeCity } = useGlobeStore.getState();
      if (!activeCity) {
        useGlobeStore.getState().setCctvSourceCounts({});
        return;
      }
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

    const fetchFromNetwork = async () => {
      try {
        const res = await fetch("/api/cctv");
        if (!res.ok) return;
        const data = await res.json();
        if (data.cameras) {
          const withFeed = data.cameras.filter(
            (c: CctvCamera) => c.snapshotUrl || c.streamUrl || c.embedUrl,
          );
          setCctvCameras(withFeed);
          useGlobeStore.getState().setCctvCameras(withFeed);
          useGlobeStore.getState().setCctvCatalogLoaded(true);
          publishCounts(withFeed);
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
      } catch {}
    };

    (async () => {
      const cached = await loadFromCache();
      if (!cached) {
        await fetchFromNetwork();
      } else {
        const cache = await caches.open(CCTV_CACHE_KEY);
        const cachedRes = await cache.match("/api/cctv");
        const ts = parseInt(cachedRes?.headers.get("x-cached-ts") ?? "0", 10);
        if (Date.now() - ts > 5 * 60 * 1000) {
          fetchFromNetwork();
        }
      }
    })();
  }, []);

  // Recompute CCTV source counts when activeCity changes.
  useEffect(() => {
    if (cctvCameras.length === 0) return;
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

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#0a0a0f",
      }}
    >
      <CesiumGlobe />
      <CircleMask />
      <TacticalHUD />
      <RightPanel />
      <FlightTrajectoryOverlay />
      <TargetingBracket />
      <FlightDetailPanel />
      <SatelliteDetailPanel />
      <FeatureDetailPanel />
      <CctvDetailPanel />
      <CctvOverlay />
      <RegionDetailPanel />
      <EarthquakeOverlay />
      <LocalInfrastructureOverlay />
      <CivilUnrestOverlay />
      <RadioOverlay />
      <LocationPanel />
      <CoordinatesPanel />
      <ReplayTimeline />
      {searchOpen && <SearchModal />}
      <RegionPopupOverlay />
      <Toast />
    </div>
  );
}
