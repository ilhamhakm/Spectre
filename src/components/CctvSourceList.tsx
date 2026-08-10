"use client";

import { useMemo, type CSSProperties } from "react";
import { useGlobeStore } from "@/store/globe-store";

export interface CctvSourceDef {
  id: string;
  label: string;
  note: string;
  requiresApiKey?: boolean;
  apiKeyEnv?: string;
}

export const CCTV_SOURCE_DEFS: CctvSourceDef[] = [
  { id: "streetside", label: "Streetside Jakarta", note: "ID" },
  { id: "atcs", label: "ATCS Indonesia", note: "ID" },
  { id: "tfl", label: "TfL JamCams", note: "London" },
  { id: "caltrans", label: "Caltrans", note: "CA, US" },
  { id: "windy", label: "Windy Webcams", note: "global" },
  { id: "otc", label: "OpenTrafficCam", note: "US" },
  { id: "palembang", label: "Palembang", note: "ID" },
  { id: "osm", label: "OSM Nodes", note: "pos only" },
  { id: "511ny", label: "511NY", note: "NY, US", requiresApiKey: true, apiKeyEnv: "NY511_API_KEY" },
  { id: "lta", label: "LTA DataMall", note: "Singapore", requiresApiKey: true, apiKeyEnv: "LTA_API_KEY" },
  { id: "tfnsw", label: "Transport for NSW", note: "Sydney", requiresApiKey: true, apiKeyEnv: "TFNSW_API_KEY" },
];

interface Props {
  cctvSources: Record<string, boolean>;
  cctvSourceCounts: Record<string, number>;
  activeCity: string | null;
  toggleCctvSource: (provider: string) => void;
  hoverOn: (e: React.MouseEvent<HTMLElement>) => void;
  hoverOff: (e: React.MouseEvent<HTMLElement>, isActive: boolean) => void;
  rowStyle: (isActive: boolean) => CSSProperties;
}

export default function CctvSourceList({
  cctvSources,
  cctvSourceCounts,
  activeCity,
  toggleCctvSource,
  hoverOn,
  hoverOff,
  rowStyle,
}: Props) {
  const loading = useGlobeStore((s) => s.layerLoading.cctv ?? false);
  const catalogLoaded = useGlobeStore((s) => s.cctvCatalogLoaded);
  const sorted = useMemo(() => {
    const withCounts = CCTV_SOURCE_DEFS.map((src) => ({
      ...src,
      count: cctvSourceCounts[src.id] ?? 0,
    }));
    // Only show sources that actually have cameras in the current city.
    const available = withCounts.filter((s) => s.count > 0);
    return available.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
  }, [cctvSourceCounts]);

  return (
    <div
      className="scrollbar"
      style={{ display: "flex", flexDirection: "column", maxHeight: 340, overflowY: "auto" }}
    >
      {loading || !catalogLoaded ? (
        <div style={{ fontSize: 9, color: "#5ab3d4", opacity: 0.7, padding: "8px 10px", textAlign: "right" }}>
          LOADING CAMERAS...
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ fontSize: 9, color: "#5ab3d4", opacity: 0.6, padding: "8px 10px", textAlign: "right" }}>
          NO CAMERAS IN THIS CITY
        </div>
      ) : null}
      {sorted.map((src) => {
        const isActive = cctvSources[src.id] !== false;
        const hasCameras = src.count > 0;
        return (
          <div
            key={src.id}
            style={{
              ...rowStyle(isActive),
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: 0,
              opacity: hasCameras ? 1 : 0.5,
            }}
          >
            <button
              onClick={() => toggleCctvSource(src.id)}
              onMouseEnter={(e) => hoverOn(e)}
              onMouseLeave={(e) => hoverOff(e, isActive)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: isActive ? "#00D4FF" : "#5ab3d4",
                fontSize: 10,
                fontFamily: "inherit",
                cursor: "pointer",
                textAlign: "right",
                padding: "8px 0 8px 10px",
                letterSpacing: 0.5,
                outline: "none",
              }}
            >
              {src.label.toUpperCase()}
            </button>
            <div
              style={{
                background: "transparent",
                border: "none",
                color: isActive ? "#00D4FF" : "#5ab3d4",
                fontSize: 9,
                fontFamily: "inherit",
                padding: "8px 10px",
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {src.requiresApiKey && !hasCameras ? (
                <span style={{ fontSize: 7, color: "#ffc82a", opacity: 0.8 }}>KEY</span>
              ) : (
                <span style={{ opacity: hasCameras ? 0.9 : 0.4, fontSize: 8 }}>
                  {src.count}
                </span>
              )}
              <span style={{ opacity: 0.5, fontSize: 8 }}>{src.note}</span>
              <span style={{ fontSize: 12 }}>{isActive ? "◉" : "○"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
