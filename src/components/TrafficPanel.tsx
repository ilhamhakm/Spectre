"use client";

import { useGlobeStore } from "@/store/globe-store";

const ROAD_CLASSES = [
  { id: "motorway", label: "MOTORWAY", color: "#ffb33a" },
  { id: "trunk", label: "TRUNK", color: "#ffc84d" },
  { id: "primary", label: "PRIMARY", color: "#ffe07a" },
  { id: "secondary", label: "SECONDARY", color: "#cfe2f3" },
  { id: "tertiary", label: "TERTIARY", color: "#a0b0c0" },
] as const;

const CONGESTION_STOPS = [
  { label: "Free", color: "#00D4FF" },
  { label: "Light", color: "#7FE5FF" },
  { label: "Mod", color: "#FFD24D" },
  { label: "Heavy", color: "#FF7A3D" },
  { label: "Grid", color: "#FF3D3D" },
];

export default function TrafficPanel() {
  const enabled = useGlobeStore((s) => s.layerVisibility.traffic ?? false);
  const visibility = useGlobeStore((s) => s.roadClassVisibility);
  const toggleRoadClass = useGlobeStore((s) => s.toggleRoadClass);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);
  const loading = useGlobeStore((s) => s.layerLoading.traffic ?? false);

  if (!enabled) return null;

  const activeCount = Object.values(visibility).filter(Boolean).length;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 240,
        height: "100%",
        overflowY: "auto",
        zIndex: 60,
        fontFamily: "JetBrains Mono, monospace",
        pointerEvents: "auto",
        background: "transparent",
        borderLeft: "none",
        borderTopLeftRadius: 18,
        borderBottomLeftRadius: 18,
        color: "#00D4FF",
        paddingBottom: 120,
      }}
    >
      <div style={{ padding: "16px 12px", height: "100%", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: "#00D4FF" }}>
            TRAFFIC
          </div>
          <button
            onClick={() => toggleLayer("traffic")}
            style={{
              padding: "6px 8px",
              background: "rgba(8, 14, 22, 0.55)",
              border: "1px solid rgba(0, 212, 255, 0.5)",
              color: "#5ab3d4",
              fontSize: 10,
              fontFamily: "inherit",
              cursor: "pointer",
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>

        {loading && (
          <div style={{ fontSize: 9, color: "#5ab3d4", marginBottom: 10, opacity: 0.7 }}>
            Loading roads...
          </div>
        )}

        <div style={{ fontSize: 8, letterSpacing: 1.5, marginBottom: 6, color: "#7ac4e0" }}>
          ROAD CLASSES
        </div>

        {ROAD_CLASSES.map((road) => {
          const active = visibility[road.id] ?? false;
          return (
            <button
              key={road.id}
              onClick={() => toggleRoadClass(road.id)}
              style={{
                width: "100%",
                padding: "8px 10px",
                minHeight: 24,
                background: active
                  ? "rgba(0, 212, 255, 0.12)"
                  : "rgba(8, 14, 22, 0.55)",
                border: active
                  ? "1px solid rgba(0, 212, 255, 0.6)"
                  : "1px solid rgba(0, 212, 255, 0.4)",
                color: active ? "#00D4FF" : "#5ab3d4",
                fontSize: 10,
                fontFamily: "inherit",
                cursor: "pointer",
                textAlign: "left",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
                letterSpacing: 1,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  color: active ? "#00D4FF" : "#5ab3d4",
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                {active ? "◉" : "○"}
              </span>
              <span
                style={{
                  width: 24,
                  height: 3,
                  background: active ? road.color : "rgba(90, 179, 212, 0.3)",
                  borderRadius: 1,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{road.label}</span>
            </button>
          );
        })}

        <div style={{ fontSize: 8, letterSpacing: 1.5, marginTop: 12, marginBottom: 6, color: "#7ac4e0" }}>
          CONGESTION
        </div>
        <div
          style={{
            display: "flex",
            gap: 3,
            padding: "6px 10px",
            background: "rgba(8, 14, 22, 0.55)",
            border: "1px solid rgba(0, 212, 255, 0.4)",
            borderRadius: 6,
          }}
        >
          {CONGESTION_STOPS.map((lvl) => (
            <div key={lvl.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              <div
                style={{
                  width: "100%",
                  height: 4,
                  background: lvl.color,
                  borderRadius: 1,
                  marginBottom: 2,
                }}
              />
              <div style={{ fontSize: 7, opacity: 0.5, color: "#5ab3d4" }}>{lvl.label}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            fontSize: 9,
            opacity: 0.5,
            textAlign: "center",
            marginTop: 10,
            color: "#5ab3d4",
          }}
        >
          {activeCount === 0
            ? "No roads visible"
            : `${activeCount} class${activeCount > 1 ? "es" : ""} active`}
        </div>
      </div>
    </div>
  );
}
