"use client";

import { useState } from "react";
import { useGlobeStore } from "@/store/globe-store";
import {
  GIBS_REGION_PRESETS,
  SENTINEL_REGION_PRESETS,
  type RegionPreset,
} from "@/globe/layers/gibs-layer";

// Live Replay panel: right-side drill-down menu for GIBS (planetary) and
// Sentinel-2 (city) imagery layers.
//
// Top level shows two tiers: GIBS and Sentinel-2.
// Click a tier to drill into its region presets (with BACK button).
// Click a preset to auto-activate the layer + fly camera + set date.
//
// GIBS: Sentinel-2 L2A cloud-free monthly mosaic, planetary zoom (uses
//       Copernicus WMS TRUE_COLOR, minimumLevel:8 so it works at any
//       altitude down to ~612 m/px, below the S2L2A 1500 m/px limit).
//       Use case: big-picture earth changes (ice melt, deforestation).
// Sentinel-2: same source, weekly + monthly stepping, deeper detail
//       (maximumLevel:14 = 10 m/px native). Use case: close-up tracking
//       (construction, stadium builds, specific sites).

type Tier = "gibs" | "sentinel" | null;

export default function LiveReplayPanel() {
  const sentinelOn = useGlobeStore((s) => s.layerVisibility.sentinel ?? false);
  const gibsOn = useGlobeStore((s) => s.layerVisibility.gibs ?? false);
  const replayPanelOpen = useGlobeStore((s) => s.replayPanelOpen);
  const setReplayPanelOpen = useGlobeStore((s) => s.setReplayPanelOpen);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);
  const setGibsDate = useGlobeStore((s) => s.setGibsDate);
  const setSentinelDate = useGlobeStore((s) => s.setSentinelDate);
  const [drilledTier, setDrilledTier] = useState<Tier>(null);

  if (!replayPanelOpen) return null;

  function flyToPreset(preset: RegionPreset, isGibs: boolean) {
    const viewer = (window as unknown as { __viewer?: any }).__viewer;
    if (!viewer) return;

    const CesiumMod = (window as unknown as { __Cesium?: typeof import("cesium") }).__Cesium;
    if (!CesiumMod) return;

    viewer.camera.flyTo({
      destination: CesiumMod.Cartesian3.fromDegrees(
        preset.lon,
        preset.lat,
        preset.height,
      ),
      orientation: {
        heading: 0,
        pitch: CesiumMod.Math.toRadians(-90),
        roll: 0,
      },
      duration: 2.5,
    });

    // Set the replay date (1st of current month as default)
    const today = new Date();
    const ty = today.getFullYear();
    const tm = String(today.getMonth() + 1).padStart(2, "0");
    const date = preset.recommendedDate || `${ty}-${tm}-01`;
    if (isGibs) {
      setGibsDate(date);
    } else {
      setSentinelDate(date);
    }
  }

  function selectPreset(preset: RegionPreset, tier: Tier) {
    if (!tier) return;
    const isGibs = tier === "gibs";

    // Auto-activate the layer (mutual exclusivity turns the other off)
    const layerOn = isGibs ? gibsOn : sentinelOn;
    if (!layerOn) {
      toggleLayer(tier);
    }

    flyToPreset(preset, isGibs);
  }

  // Shared row styling — mirrors CityBookmarks right-panel look
  function rowStyle(isActive: boolean): React.CSSProperties {
    return {
      width: "100%",
      padding: "8px 10px",
      background: isActive
        ? "rgba(0, 212, 255, 0.12)"
        : "transparent",
      border: isActive
        ? "1px solid rgba(0, 212, 255, 0.6)"
        : "1px solid rgba(0, 212, 255, 0.15)",
      color: isActive ? "#00D4FF" : "#5ab3d4",
      fontSize: 10,
      fontFamily: "inherit",
      cursor: "pointer",
      textAlign: "right",
      borderRadius: 6,
      letterSpacing: 0.5,
      transition: "background 0.15s, border-color 0.15s, color 0.15s",
      marginBottom: 4,
    };
  }

  function hoverOn(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
    e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.2)";
    e.currentTarget.style.color = "#00D4FF";
  }
  function hoverOff(e: React.MouseEvent<HTMLElement>, isActive: boolean) {
    if (isActive) return;
    e.currentTarget.style.background = "transparent";
    e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.15)";
    e.currentTarget.style.color = "#5ab3d4";
  }

  const backButtonStyle: React.CSSProperties = {
    width: "100%",
    padding: "5px 8px",
    background: "rgba(0, 212, 255, 0.03)",
    border: "1px solid rgba(0, 212, 255, 0.2)",
    color: "#7ac4e0",
    fontSize: 9,
    fontFamily: "inherit",
    cursor: "pointer",
    textAlign: "right",
    borderRadius: 6,
    marginBottom: 8,
    letterSpacing: 1,
  };

  const presets = drilledTier === "gibs" ? GIBS_REGION_PRESETS : SENTINEL_REGION_PRESETS;
  const tierLabel = drilledTier === "gibs" ? "GIBS" : "SENTINEL-2";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 240,
        height: "100%",
        overflowY: "auto",
        paddingBottom: 120,
        background: "transparent",
        borderLeft: "none",
        zIndex: 60,
        pointerEvents: "auto",
        paddingTop: 40,
        paddingLeft: 12,
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      {/* Header with close button */}
      <div
        style={{
          fontSize: 8,
          letterSpacing: 1.5,
          marginBottom: 10,
          color: "#7ac4e0",
          textAlign: "right",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>LIVE REPLAY</span>
        <button
          onClick={() => setReplayPanelOpen(false)}
          style={{
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255, 80, 80, 0.06)",
            border: "1px solid rgba(255, 80, 80, 0.4)",
            borderRadius: 3,
            color: "#ff5050",
            fontSize: 9,
            cursor: "pointer",
          }}
          title="Close panel"
        >
          {"\u2715"}
        </button>
      </div>

      {drilledTier ? (
        <>
          {/* Back button — returns to tier list */}
          <button
            onClick={() => setDrilledTier(null)}
            style={backButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
              e.currentTarget.style.color = "#00D4FF";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.03)";
              e.currentTarget.style.color = "#7ac4e0";
            }}
          >
            {"\u2039"} BACK
          </button>

          {/* Tier label */}
          <div
            style={{
              fontSize: 8,
              letterSpacing: 1.5,
              marginBottom: 10,
              color: "#7ac4e0",
              textAlign: "right",
            }}
          >
            {tierLabel} PRESETS
          </div>

          {/* Preset list */}
          <div
            className="scrollbar"
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: 440,
              overflowY: "auto",
            }}
          >
            {presets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => selectPreset(preset, drilledTier)}
                style={rowStyle(false)}
                onMouseEnter={(e) => hoverOn(e)}
                onMouseLeave={(e) => hoverOff(e, false)}
              >
                <div style={{ fontSize: 10, letterSpacing: 0.5 }}>
                  {preset.name.toUpperCase()}
                </div>
                <div style={{ fontSize: 7, opacity: 0.6, marginTop: 2 }}>
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Tier list — top level */}
          <button
            onClick={() => setDrilledTier("gibs")}
            style={rowStyle(gibsOn)}
            onMouseEnter={(e) => hoverOn(e)}
            onMouseLeave={(e) => hoverOff(e, gibsOn)}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 6,
              }}
            >
              <span>GIBS</span>
              {gibsOn && (
                <span style={{ fontSize: 7, color: "#00D4FF", opacity: 0.8 }}>ON</span>
              )}
              <span style={{ fontSize: 8, opacity: 0.6 }}>{"\u203a"}</span>
            </div>
            <div style={{ fontSize: 7, opacity: 0.6, marginTop: 2 }}>
              Big picture: ice melt, deforestation
            </div>
          </button>

          <button
            onClick={() => setDrilledTier("sentinel")}
            style={rowStyle(sentinelOn)}
            onMouseEnter={(e) => hoverOn(e)}
            onMouseLeave={(e) => hoverOff(e, sentinelOn)}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 6,
              }}
            >
              <span>SENTINEL-2</span>
              {sentinelOn && (
                <span style={{ fontSize: 7, color: "#00D4FF", opacity: 0.8 }}>ON</span>
              )}
              <span style={{ fontSize: 8, opacity: 0.6 }}>{"\u203a"}</span>
            </div>
            <div style={{ fontSize: 7, opacity: 0.6, marginTop: 2 }}>
              Close-up: construction, weekly+monthly
            </div>
          </button>
        </>
      )}
    </div>
  );
}
