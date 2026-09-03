"use client";

import { useMemo } from "react";
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
  { id: "shodan", label: "Shodan", note: "global" },
  { id: "511ny", label: "511NY", note: "NY, US", requiresApiKey: true, apiKeyEnv: "NY511_API_KEY" },
  { id: "lta", label: "LTA DataMall", note: "Singapore", requiresApiKey: true, apiKeyEnv: "LTA_API_KEY" },
  { id: "tfnsw", label: "Transport for NSW", note: "Sydney", requiresApiKey: true, apiKeyEnv: "TFNSW_API_KEY" },
];

function hoverOn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "var(--btn-bg-hover)";
  e.currentTarget.style.borderColor = "var(--btn-border-active)";
  e.currentTarget.style.color = "var(--accent)";
}

function hoverOff(e: React.MouseEvent<HTMLElement>, isActive: boolean) {
  if (isActive) return;
  e.currentTarget.style.background = "var(--btn-bg)";
  e.currentTarget.style.borderColor = "var(--btn-border)";
  e.currentTarget.style.color = "var(--text-secondary)";
}

function rowStyle(isActive: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "7px 10px",
    background: isActive ? "var(--btn-bg-active)" : "var(--btn-bg)",
    border: isActive
      ? "1px solid var(--btn-border-active)"
      : "1px solid var(--btn-border)",
    color: isActive ? "var(--accent)" : "var(--text-secondary)",
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "right",
    borderRadius: "var(--btn-radius)",
    letterSpacing: 1,
    transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
    textShadow: isActive ? "0 0 8px rgba(255, 255, 255, 0.3)" : "none",
    marginBottom: 4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  };
}

function headerStyle(): React.CSSProperties {
  return {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 2,
    marginBottom: 8,
    color: "var(--text-dim)",
    textAlign: "right",
    fontFamily: "var(--font-mono)",
  };
}

// CCTV source toggle list for the right panel. Shows per-provider camera
// counts for the active city, sorted by count descending. Users toggle
// individual providers on/off; the globe layer re-filters accordingly.
// All sources are off by default, so the list starts empty until the user
// enables one. Sources with 0 cameras in the current city are hidden.
export default function CctvSourceList() {
  const cctvSources = useGlobeStore((s) => s.cctvSources);
  const cctvSourceCounts = useGlobeStore((s) => s.cctvSourceCounts);
  const activeCity = useGlobeStore((s) => s.activeCity);
  const catalogLoaded = useGlobeStore((s) => s.cctvCatalogLoaded);
  const isLoading = useGlobeStore((s) => s.layerLoading.cctv ?? false);
  const toggleCctvSource = useGlobeStore((s) => s.toggleCctvSource);

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

  const showLoading = isLoading || !catalogLoaded;
  const noCity = !activeCity;
  const noCameras = !showLoading && sorted.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "0 16px", flex: 1, minHeight: 0 }}>
      <div style={headerStyle()}>CCTV SOURCES{activeCity ? ` - ${activeCity.toUpperCase()}` : ""}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 4 }}>
        {showLoading ? (
          <div style={{ padding: "12px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 9, fontFamily: "var(--font-mono)" }}>
            LOADING CAMERAS...
          </div>
        ) : noCity ? (
          <div style={{ padding: "12px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 9, fontFamily: "var(--font-mono)" }}>
            SELECT A CITY FIRST
          </div>
        ) : noCameras ? (
          <div style={{ padding: "12px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 9, fontFamily: "var(--font-mono)" }}>
            NO CAMERAS IN THIS CITY
          </div>
        ) : null}
        {sorted.map((src) => {
          const isActive = cctvSources[src.id] !== false;
          return (
            <button
              key={src.id}
              onClick={() => toggleCctvSource(src.id)}
              style={rowStyle(isActive)}
              onMouseEnter={(e) => hoverOn(e)}
              onMouseLeave={(e) => hoverOff(e, isActive)}
              title={src.label}
            >
              <span
                style={{
                  flex: 1,
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {src.label.toUpperCase()}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                  fontSize: 9,
                  fontFamily: "var(--font-mono)",
                  color: isActive ? "var(--accent)" : "var(--text-dim)",
                }}
              >
                {src.requiresApiKey && src.count === 0 ? (
                  <span style={{ fontSize: 7, color: "#ffc82a", opacity: 0.8 }}>KEY</span>
                ) : (
                  <span style={{ opacity: 0.9, fontSize: 9, fontWeight: 700 }}>{src.count}</span>
                )}
                <span style={{ opacity: 0.5, fontSize: 8 }}>{src.note}</span>
                <span style={{ fontSize: 11 }}>{isActive ? "\u25C9" : "\u25CB"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
