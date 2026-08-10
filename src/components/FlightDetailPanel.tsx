"use client";

import { useGlobeStore } from "@/store/globe-store";
import type { FlightState } from "@/lib/sources/opensky";
import type { MilitaryFlight } from "@/lib/sources/airplanes-live";

// Flight detail right panel: replaces CityBookmarks when a flight is
// selected (clicked on the globe). Shows callsign, altitude, velocity,
// heading, origin, destination, last flight info for private jets.
//
// Triggered when selectedFlightId is set by the click handler.

interface FlightDetail {
  icao24: string;
  callsign: string;
  originCountry: string;
  altitude: number | null;
  velocity: number | null;
  heading: number;
  onGround: boolean;
  latitude: number;
  longitude: number;
  lastContact: number;
}

export default function FlightDetailPanel() {
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const selectedKind = useGlobeStore((s) => s.selectedKind);

  if (!selectedFlightId) return null;

  // The flight data is fetched on demand from the /api/flights endpoint.
  // For now, show a placeholder with the icao24 and a link to OpenSky.
  const icao24 = selectedFlightId;
  const isPrivate = selectedKind === "flight-private";
  const isMilitary = selectedKind === "flight-mil";
  const sourceUrl = isMilitary
    ? `https://www.airplanes.live/view/?icao=${encodeURIComponent(icao24)}`
    : `https://opensky-network.org/aircraft-profile?icao24=${encodeURIComponent(icao24)}`;

  const headerColor = isMilitary ? "#ff5533" : "#FFD700";
  const headerText = isMilitary ? "MILITARY FLIGHT" : "PRIVATE FLIGHT";

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
        paddingRight: 12,
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      <div
        style={{
          fontSize: 8,
          letterSpacing: 1.5,
          marginBottom: 10,
          color: headerColor,
          textAlign: "right",
        }}
      >
        {headerText}
      </div>

      <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, marginBottom: 4, textAlign: "right" }}>
        {icao24.toUpperCase()}
      </div>

      <div style={{ fontSize: 9, color: "#888", marginBottom: 8, textAlign: "right" }}>
        ICAO24 hex transponder code
      </div>

      <div
        style={{
          fontSize: 8,
          color: "#666",
          marginBottom: 6,
          padding: "6px 8px",
          background: "rgba(0, 212, 255, 0.04)",
          borderRadius: 4,
          border: "1px solid rgba(0, 212, 255, 0.15)",
        }}
      >
        <div style={{ color: "#5ab3d4", marginBottom: 4, letterSpacing: 1 }}>
          LIVE DATA
        </div>
        <div style={{ color: "#888" }}>
          Tracking active. Live position updates every 15s from OpenSky / ADS-B Exchange.
        </div>
      </div>

      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          fontSize: 9,
          color: "#00D4FF",
          textDecoration: "none",
          textAlign: "center",
          padding: "6px 8px",
          border: "1px solid #00D4FF33",
          borderRadius: 6,
          marginTop: 8,
        }}
      >
        {isMilitary ? "VIEW ON AIRPLANES.LIVE →" : "VIEW ON OPENSKY →"}
      </a>

      <button
        onClick={() => useGlobeStore.getState().selectFlight(null, null)}
        style={{
          width: "100%",
          padding: "6px 8px",
          background: "rgba(255, 80, 80, 0.06)",
          border: "1px solid rgba(255, 80, 80, 0.4)",
          borderRadius: 4,
          color: "#ff5050",
          fontSize: 9,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "center",
          marginTop: 8,
          letterSpacing: 1,
        }}
      >
        ✕ CLOSE
      </button>
    </div>
  );
}
