"use client";

import { useEffect, useRef, useState } from "react";
import type * as Cesium from "cesium";
import { useGlobeStore } from "@/store/globe-store";
import { buildArcPositions } from "@/globe/arc";

// Trajectory overlay for a selected flight. When a flight billboard is
// clicked (selectedFlightId set in the store), this component:
//   1. Fetches the trajectory + airports from /api/flights/track or
//      /api/military-flights/trace (depending on selectedKind).
//   2. Renders the trajectory as a polyline entity in the Cesium viewer
//      (read from window.__viewer, exposed by CesiumGlobe).
//   3. Renders an HTML popup near the click position with origin,
//      destination, callsign, aircraft details, and a clickable source
//      link to OpenSky / airplanes.live.
//   4. Cleans up the polyline entity when the selection is cleared.
//
// The popup stays put until the user clicks empty space on the globe
// (which clears selectedFlightId) or hits the X button.

interface TrajectoryPoint {
  time: number;
  lat: number;
  lon: number;
  alt: number | null;
}

interface TrajectoryResponse {
  icao24?: string;
  hex?: string;
  callsign: string | null;
  trajectory: TrajectoryPoint[];
  origin: string | TrajectoryPoint | null;
  destination: string | TrajectoryPoint | null;
  firstSeen?: number | null;
  lastSeen?: number | null;
  heading?: number | null;
  sourceUrl: string;
  fetchedAt: number;
  error?: string;
}

const PRIVATE_COLOR = [0xf0, 0xf0, 0xf0, 0xff] as const;   // white
const MILITARY_COLOR = [0xff, 0x55, 0x33, 0xff] as const;   // red-orange

function formatTime(unixSec: number | null | undefined): string {
  if (!unixSec) return "—";
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

function formatCoord(p: TrajectoryPoint): string {
  return `${p.lat.toFixed(3)}°, ${p.lon.toFixed(3)}°`;
}

export default function FlightTrajectoryOverlay() {
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const selectedKind = useGlobeStore((s) => s.selectedKind);
  const selectedAt = useGlobeStore((s) => s.selectedAt);
  const selectFlight = useGlobeStore((s) => s.selectFlight);

  const [data, setData] = useState<TrajectoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the entities we add to the viewer so we can remove them on cleanup.
  const trajectoryEntityRef = useRef<Cesium.Entity | null>(null);
  const arcEntityRef = useRef<Cesium.Entity | null>(null);
  // Track the AbortController so we can cancel an in-flight fetch when the
  // selection changes mid-request.
  const abortRef = useRef<AbortController | null>(null);

  // Re-fetch when the selection changes.
  useEffect(() => {
    // Cleanup any prior entities before doing anything else.
    const w = typeof window !== "undefined"
      ? (window as unknown as { __viewer?: Cesium.Viewer }).__viewer
      : undefined;
    if (trajectoryEntityRef.current && w && !w.isDestroyed()) {
      w.entities.remove(trajectoryEntityRef.current);
      trajectoryEntityRef.current = null;
    }
    if (arcEntityRef.current && w && !w.isDestroyed()) {
      w.entities.remove(arcEntityRef.current);
      arcEntityRef.current = null;
    }
    if (w && !w.isDestroyed()) w.scene.requestRender();
    abortRef.current?.abort();
    abortRef.current = null;

    if (!selectedFlightId || !selectedKind) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    const ac = new AbortController();
    abortRef.current = ac;

    // Render the trajectory as two Cesium polyline entities:
    //   1. Past track — the actual waypoints at their real altitudes (thin, solid)
    //   2. Parabolic arc — a great-circle arc from origin to destination
    //      with a parabolic altitude profile (the classic "flight path" arc)
    const renderTrajectory = (json: TrajectoryResponse, kind: "flight-private" | "flight-mil") => {
      const viewer = typeof window !== "undefined"
        ? (window as unknown as { __viewer?: Cesium.Viewer }).__viewer
        : undefined;
      if (!viewer || viewer.isDestroyed()) return;
      // Clean up any prior entities (past track + arc).
      if (trajectoryEntityRef.current) {
        viewer.entities.remove(trajectoryEntityRef.current);
        trajectoryEntityRef.current = null;
      }
      if (arcEntityRef.current) {
        viewer.entities.remove(arcEntityRef.current);
        arcEntityRef.current = null;
      }

      const CesiumMod = (window as unknown as { __Cesium?: typeof Cesium }).__Cesium;
      if (!CesiumMod) return;

      const rgba = kind === "flight-mil" ? MILITARY_COLOR : PRIVATE_COLOR;
      const glowColor = CesiumMod.Color.fromBytes(rgba[0], rgba[1], rgba[2], rgba[3]);
      const trackColor = CesiumMod.Color.fromBytes(rgba[0], rgba[1], rgba[2], 160);

      const traj = json.trajectory ?? [];

      // 1. Past track — actual waypoints at real altitudes (thin solid line)
      if (traj.length >= 2) {
        const trackPositions = traj.map((p) =>
          CesiumMod.Cartesian3.fromDegrees(
            p.lon,
            p.lat,
            typeof p.alt === "number" && p.alt > 0 ? p.alt : 50,
          ),
        );
        const trackEntity = viewer.entities.add({
          id: `traj_${kind}_${selectedFlightId}`,
          polyline: {
            positions: trackPositions,
            width: 1.5,
            material: new CesiumMod.PolylineGlowMaterialProperty({
              glowPower: 0.15,
              color: trackColor,
            }),
            clampToGround: false,
          },
        });
        trajectoryEntityRef.current = trackEntity;
      }

      // 2. Parabolic arc — from first waypoint (origin) to last waypoint
      //    (destination / current position), with parabolic altitude profile.
      //    This is the "from where to where" flight path arc.
      if (traj.length >= 2) {
        const origin = traj[0];
        const dest = traj[traj.length - 1];
        // Cruise altitude: peak of the arc. Use the max altitude in the
        // trajectory, or default to 10km if all altitudes are null/0.
        const maxTrajAlt = traj.reduce(
          (max, p) => (typeof p.alt === "number" && p.alt > max ? p.alt : max),
          0,
        );
        const cruiseAlt = maxTrajAlt > 100 ? maxTrajAlt : 10_000;

        const arcPositions = buildArcPositions(
          origin.lat, origin.lon,
          dest.lat, dest.lon,
          cruiseAlt, 48,
        );

        const arcEntity = viewer.entities.add({
          id: `arc_${kind}_${selectedFlightId}`,
          polyline: {
            positions: arcPositions,
            width: 2.5,
            material: new CesiumMod.PolylineGlowMaterialProperty({
              glowPower: 0.3,
              color: glowColor,
            }),
            clampToGround: false,
          },
        });
        arcEntityRef.current = arcEntity;
      }

      viewer.scene.requestRender();
    };

    const url =
      selectedKind === "flight-mil"
        ? `/api/military-flights/trace?hex=${encodeURIComponent(selectedFlightId)}`
        : `/api/flights/track?icao24=${encodeURIComponent(selectedFlightId)}`;

    fetch(url, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(30_000)]) })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`${res.status} ${text || res.statusText}`);
        }
        return res.json() as Promise<TrajectoryResponse>;
      })
      .then((json) => {
        if (ac.signal.aborted) return;
        setData(json);
        setLoading(false);
        renderTrajectory(json, selectedKind);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "fetch failed";
        setError(msg);
        setLoading(false);
      });

    return () => {
      ac.abort();
      const viewer = typeof window !== "undefined"
        ? (window as unknown as { __viewer?: Cesium.Viewer }).__viewer
        : undefined;
      if (trajectoryEntityRef.current && viewer && !viewer.isDestroyed()) {
        viewer.entities.remove(trajectoryEntityRef.current);
        trajectoryEntityRef.current = null;
      }
      if (arcEntityRef.current && viewer && !viewer.isDestroyed()) {
        viewer.entities.remove(arcEntityRef.current);
        arcEntityRef.current = null;
      }
      if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [selectedFlightId, selectedKind]);

  if (!selectedFlightId || !selectedKind || !selectedAt) return null;

  const left = Math.min(selectedAt.x + 14, window.innerWidth - 380);
  const top = Math.min(selectedAt.y + 14, window.innerHeight - 360);
  const accent =
    selectedKind === "flight-mil"
      ? "rgb(255, 85, 51)"
      : "rgb(240, 240, 240)";
  const titlePrefix =
    selectedKind === "flight-mil" ? "MILITARY FLIGHT" : "PRIVATE FLIGHT";
  const idLabel =
    selectedKind === "flight-mil" ? `HEX ${selectedFlightId}` : `ICAO24 ${selectedFlightId}`;

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: 360,
        background: "transparent",
        border: `1px solid ${accent}33`,
        borderRadius: 8,
        padding: 10,
        zIndex: 1001,
        pointerEvents: "auto",
        fontFamily: "monospace",
        backdropFilter: "blur(8px)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.8)",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 8, color: accent, letterSpacing: 2 }}>
          ◉ {titlePrefix} · {idLabel}
        </div>
        <button
          onClick={() => selectFlight(null, null)}
          style={{
            background: "transparent",
            border: "1px solid #333",
            color: "#888",
            cursor: "pointer",
            fontSize: 10,
            width: 18,
            height: 18,
            lineHeight: 1,
            borderRadius: 4,
            padding: 0,
          }}
          aria-label="Close trajectory"
          title="Close"
        >
          ×
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 10, color: "#888", padding: "12px 0", textAlign: "center" }}>
          FETCHING TRAJECTORY…
        </div>
      )}

      {error && !loading && (
        <div style={{ fontSize: 10, color: "#ff4d4d", padding: "8px 0" }}>
          Failed to load trajectory: {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
            {data.callsign || "Unknown callsign"}
          </div>

          {/* Origin / destination row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid #1a1a1a",
                borderRadius: 6,
                padding: 6,
              }}
            >
              <div style={{ fontSize: 7, color: "#5a606c", letterSpacing: 1, marginBottom: 2 }}>
                ORIGIN
              </div>
              {typeof data.origin === "string" ? (
                <>
                  <div style={{ fontSize: 12, color: accent, fontWeight: 700 }}>
                    {data.origin}
                  </div>
                  <div style={{ fontSize: 8, color: "#666" }}>
                    {data.firstSeen ? formatTime(data.firstSeen) : ""}
                  </div>
                </>
              ) : data.origin ? (
                <>
                  <div style={{ fontSize: 11, color: accent, fontWeight: 700 }}>
                    {formatCoord(data.origin)}
                  </div>
                  <div style={{ fontSize: 8, color: "#666" }}>
                    {formatTime(data.origin.time)}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: "#5a606c", fontStyle: "italic" }}>
                  Unknown
                </div>
              )}
            </div>
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid #1a1a1a",
                borderRadius: 6,
                padding: 6,
              }}
            >
              <div style={{ fontSize: 7, color: "#5a606c", letterSpacing: 1, marginBottom: 2 }}>
                DESTINATION
              </div>
              {typeof data.destination === "string" ? (
                <>
                  <div style={{ fontSize: 12, color: accent, fontWeight: 700 }}>
                    {data.destination}
                  </div>
                  <div style={{ fontSize: 8, color: "#666" }}>
                    {data.lastSeen ? formatTime(data.lastSeen) : ""}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: "#5a606c", fontStyle: "italic" }}>
                  Unknown
                  {typeof data.heading === "number" && (
                    <span style={{ color: "#888" }}>
                      {" "}· heading {Math.round(data.heading)}°
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Trajectory summary */}
          <div
            style={{
              borderTop: "1px solid #1a1a1a",
              paddingTop: 6,
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 8, color: "#5a606c", letterSpacing: 1, marginBottom: 2 }}>
              TRAJECTORY
            </div>
            <div style={{ fontSize: 9, color: "#aab0bb" }}>
              {data.trajectory.length > 0
                ? `${data.trajectory.length} waypoints · `
                : "No live track available · "}
              {data.trajectory.length > 0 && (
                <span style={{ color: "#888" }}>
                  {formatTime(data.trajectory[0].time)}
                  {" → "}
                  {formatTime(data.trajectory[data.trajectory.length - 1].time)}
                </span>
              )}
            </div>
          </div>

          {/* Source link */}
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              fontSize: 9,
              color: "#00D4FF",
              textDecoration: "none",
              textAlign: "center",
              padding: "4px 8px",
              border: "1px solid #00D4FF33",
              borderRadius: 6,
            }}
          >
            VIEW SOURCE →
          </a>
        </>
      )}
    </div>
  );
}
