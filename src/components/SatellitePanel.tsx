"use client";

import { useEffect, useState, useCallback } from "react";
import * as Cesium from "cesium";
import { useGlobeStore } from "@/store/globe-store";

interface SatelliteInfo {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  position: {
    lat: number;
    lon: number;
    alt: number;
    velocity: number;
    period: number;
    inclination: number;
  } | null;
  tle?: string[];
}

export default function SatellitePanel() {
  const [satellites, setSatellites] = useState<SatelliteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visibleSats = useGlobeStore((s) => s.visibleSatellites);
  const toggleSatellite = useGlobeStore((s) => s.toggleSatellite);
  const satellitesVisible = useGlobeStore((s) => s.layerVisibility.satellites);
  const setRequestedTrajectory = useGlobeStore((s) => s.setRequestedSatelliteTrajectory);

  // Fetch satellite data when layer is toggled on
  useEffect(() => {
    if (!satellitesVisible) return;
    setLoading(true);
    fetch("/api/satellites")
      .then((r) => (r.ok ? r.json() : { satellites: [] }))
      .then((d: { satellites?: SatelliteInfo[] }) => {
        if (d.satellites) setSatellites(d.satellites);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [satellitesVisible]);

  // Update positions every 30 seconds
  useEffect(() => {
    if (satellites.length === 0) return;
    const timer = setInterval(() => {
      fetch("/api/satellites")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { satellites?: SatelliteInfo[] } | null) => {
          if (d?.satellites) setSatellites(d.satellites);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [satellites.length]);

  const flyTo = useCallback((sat: SatelliteInfo) => {
    if (!sat.position) return;
    const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
    if (!v || v.isDestroyed()) return;
    const alt = sat.position.alt * 1000; // sat altitude in meters
    // View from 50km above the satellite — close enough to see the 3D model
    // clearly, but with enough context to see Earth/horizon below.
    const viewAlt = alt + 50_000;
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        sat.position.lon,
        sat.position.lat,
        viewAlt,
      ),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
      duration: 1.5,
    });
  }, []);

  if (satellites.length === 0 && !loading) return null;
  if (!satellitesVisible) return null;

  return (
    <>
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
          color: "#9fe9ff",
          paddingBottom: 120,
        }}
      >
        <div
          style={{
            fontSize: 8,
            letterSpacing: 1.5,
            marginBottom: 6,
            color: "#7ac4e0",
            paddingTop: 40,
            paddingLeft: 12,
          }}
        >
          SATELLITES {loading ? "LOADING..." : `(${satellites.filter((s) => s.category !== "constellation").length})`}
        </div>

        {/* Starlink cluster toggle */}
        {satellites.some((s) => s.category === "constellation") && (
          (() => {
            const constellationSats = satellites.filter((s) => s.category === "constellation");
            const activeCount = constellationSats.filter((s) => visibleSats[s.id]).length;
            const active = activeCount > 0;
            return (
              <div
                onClick={() => {
                  const constellationIds = constellationSats.map((s) => s.id);
                  const allOn = constellationIds.every((id) => visibleSats[id]);
                  for (const id of constellationIds) {
                    if (allOn) {
                      if (visibleSats[id]) toggleSatellite(id);
                    } else {
                      if (!visibleSats[id]) toggleSatellite(id);
                    }
                  }
                  if (!allOn && constellationIds.length > 0) {
                    const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
                    if (v && !v.isDestroyed()) {
                      v.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(0, 0, 15_000_000),
                        orientation: {
                          heading: 0,
                          pitch: Cesium.Math.toRadians(-90),
                          roll: 0,
                        },
                        duration: 1.5,
                      });
                    }
                  }
                }}
                style={{
                  padding: "6px 8px",
                  marginBottom: 3,
                  background: active
                    ? "rgba(0, 212, 255, 0.12)"
                    : "rgba(0, 212, 255, 0.03)",
                  border: active
                    ? "1px solid rgba(0, 212, 255, 0.6)"
                    : "1px solid rgba(0, 212, 255, 0.2)",
                  borderRadius: 4,
                  cursor: "pointer",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    color: active ? "#00D4FF" : "#5ab3d4",
                    letterSpacing: 0.5,
                  }}
                >
                  <span style={{ fontSize: 12 }}>
                    {active ? "◉" : "○"}
                  </span>
                  <span style={{ fontSize: 12 }}>⭐</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    STARLINK CLUSTER
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 8,
                    color: "#5ab3d4",
                    marginTop: 3,
                    opacity: 0.7,
                    letterSpacing: 0.5,
                  }}
                >
                  {constellationSats.length} SATELLITES{active ? ` · ${activeCount} ACTIVE` : ""}
                </div>
              </div>
            );
          })()
        )}

        <div
          className="scrollbar"
          style={{ maxHeight: 340, overflowY: "auto" }}
        >
        {satellites
          .filter((sat) => sat.category !== "constellation")
          .map((sat) => {
          const active = visibleSats[sat.id] ?? false;
          return (
            <div
              key={sat.id}
              onClick={() => {
                toggleSatellite(sat.id);
                if (!active) {
                  flyTo(sat);
                  const cb = (window as any).__showSatTrajectory;
                  if (cb) cb(sat.id);
                } else {
                  const cb = (window as any).__clearSatTrajectory;
                  if (cb) cb();
                }
              }}
              style={{
                padding: "6px 8px",
                marginBottom: 3,
                background: active
                  ? "rgba(0, 212, 255, 0.12)"
                  : "rgba(0, 212, 255, 0.03)",
                border: active
                  ? "1px solid rgba(0, 212, 255, 0.6)"
                  : "1px solid rgba(0, 212, 255, 0.2)",
                borderRadius: 4,
                cursor: "pointer",
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10,
                  color: active ? "#00D4FF" : "#5ab3d4",
                  letterSpacing: 0.5,
                }}
              >
                <span style={{ fontSize: 12 }}>
                  {active ? "◉" : "○"}
                </span>
                <span style={{ fontSize: 12 }}>{sat.emoji}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sat.name}
                </span>
              </div>
              {sat.position && (
                <div
                  style={{
                    fontSize: 8,
                    color: "#5ab3d4",
                    marginTop: 3,
                    opacity: 0.7,
                    letterSpacing: 0.5,
                  }}
                >
                  ALT {Math.round(sat.position.alt)}km · {sat.position.velocity.toFixed(1)}km/s
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </>
  );
}
