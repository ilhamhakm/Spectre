"use client";

import { useEffect, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";
import {
  satellitesGetTrackedInfo,
  satellitesGetWikipediaUrl,
  satellitesStopTracking,
} from "@/globe/layers/satellites";

// Satellite tracking detail card: renders in the right panel space while a
// satellite is being tracked (mirrors FlightDetailPanel). Live SGP4 telemetry
// polled at 1s from the satellites layer module, plus derived orbital data:
// orbit class, period, inclination, apo/periapsis, ground footprint,
// sunlight state, and TLE freshness. CLOSE stops tracking and returns the
// right panel to the picker (search + famous list).

interface TrackedInfo {
  noradId: number;
  name: string;
  group: string;
  classLabel: string;
  classColor: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  speedMps: number | null;
  periodSec: number;
  inclinationDeg: number;
  apoapsisKm: number;
  periapsisKm: number;
  orbitClass: string;
  footprintKm: number;
  sunlit: "SUNLIT" | "ECLIPSE" | "UNKNOWN";
  intlDesig: string;
  tleAgeDays: number;
}

const WHITE = "#ffffff";
const DIM = "rgba(255,255,255,0.45)";

function SectionHeader({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 9,
        color: DIM,
        letterSpacing: 1,
        marginBottom: 4,
        fontWeight: 700,
      }}
    >
      {text}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span style={{ fontSize: 10, color: DIM, letterSpacing: 1, fontWeight: 700 }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: WHITE, textAlign: "right", fontWeight: 700 }}>
        {value}
      </span>
    </div>
  );
}

function formatPeriod(periodSec: number): string {
  const min = periodSec / 60;
  if (min < 60) return `${min.toFixed(1)} min`;
  const h = min / 60;
  return `${h.toFixed(1)} hr`;
}

function formatNum(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function SatelliteDetailPanel() {
  const trackedSatelliteId = useGlobeStore((s) => s.trackedSatelliteId);
  const trackedSatelliteName = useGlobeStore((s) => s.trackedSatelliteName);
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const [info, setInfo] = useState<TrackedInfo | null>(null);

  // Poll the layer's frame-cached SGP4 readout at 1s.
  useEffect(() => {
    if (!trackedSatelliteId) {
      setInfo(null);
      return;
    }
    const tick = () => setInfo(satellitesGetTrackedInfo());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [trackedSatelliteId]);

  // Flight selection keeps priority over the satellite card.
  if (!trackedSatelliteId || selectedFlightId) return null;

  const name = info?.name ?? trackedSatelliteName ?? `NORAD ${trackedSatelliteId}`;
  const accent = info?.classColor ?? "#ffd84d";
  const altKm = info ? info.altitudeM / 1000 : null;
  const speedKms = info?.speedMps != null ? info.speedMps / 1000 : null;
  const revsPerDay = info ? 86400 / Math.max(info.periodSec, 1) : null;
  const wikiUrl = satellitesGetWikipediaUrl(trackedSatelliteId);

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
        zIndex: 70,
        pointerEvents: "auto",
        paddingTop: 40,
        paddingLeft: 12,
        paddingRight: 12,
        fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: accent,
          letterSpacing: 2,
          marginBottom: 4,
          fontWeight: 700,
        }}
      >
        SATELLITE TRACKING
      </div>
      <div
        style={{
          fontSize: 16,
          color: WHITE,
          fontWeight: 800,
          marginBottom: 2,
          textAlign: "right",
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 10,
          color: DIM,
          marginBottom: 10,
          textAlign: "right",
          fontWeight: 700,
        }}
      >
        NORAD {trackedSatelliteId}
        {info?.intlDesig ? ` · ${info.intlDesig}` : ""}
      </div>

      {/* Live telemetry */}
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="TELEMETRY" />
        <DataRow label="CLASS" value={info?.classLabel ?? "..."} />
        <DataRow
          label="ALTITUDE"
          value={altKm != null ? `${formatNum(altKm)} km` : "..."}
        />
        <DataRow
          label="SPEED"
          value={speedKms != null ? `${speedKms.toFixed(2)} km/s` : "..."}
        />
        <DataRow
          label="LATITUDE"
          value={info ? `${info.latitude.toFixed(2)} deg` : "..."}
        />
        <DataRow
          label="LONGITUDE"
          value={info ? `${info.longitude.toFixed(2)} deg` : "..."}
        />
      </div>

      {/* Derived orbital elements */}
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="ORBIT" />
        <DataRow label="TYPE" value={info?.orbitClass ?? "..."} />
        <DataRow
          label="PERIOD"
          value={info ? formatPeriod(info.periodSec) : "..."}
        />
        <DataRow
          label="INCLINATION"
          value={info ? `${formatNum(info.inclinationDeg, 1)} deg` : "..."}
        />
        <DataRow
          label="APOAPSIS"
          value={info ? `${formatNum(info.apoapsisKm)} km` : "..."}
        />
        <DataRow
          label="PERIAPSIS"
          value={info ? `${formatNum(info.periapsisKm)} km` : "..."}
        />
        <DataRow
          label="FOOTPRINT"
          value={info ? `${formatNum(info.footprintKm)} km` : "..."}
        />
      </div>

      {/* Conditions */}
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="CONDITIONS" />
        <DataRow
          label="SUNLIGHT"
          value={
            info?.sunlit === "ECLIPSE"
              ? "ECLIPSE"
              : info?.sunlit === "SUNLIT"
                ? "SUNLIT"
                : "..."
          }
        />
        <DataRow
          label="TLE AGE"
          value={
            info && info.tleAgeDays > 0
              ? `${formatNum(info.tleAgeDays, 1)} days`
              : "..."
          }
        />
        <DataRow
          label="REVS / DAY"
          value={revsPerDay != null ? formatNum(revsPerDay, 1) : "..."}
        />
      </div>

      {wikiUrl && (
        <button
          onClick={() => window.open(wikiUrl, "_blank", "noopener")}
          style={{
            width: "100%",
            padding: "7px 8px",
            background: "rgba(255, 216, 77, 0.06)",
            border: `1px solid ${accent}55`,
            borderRadius: 4,
            color: accent,
            fontSize: 11,
            fontFamily: "inherit",
            cursor: "pointer",
            textAlign: "center",
            marginTop: 8,
            letterSpacing: 1,
            fontWeight: 700,
          }}
        >
          INFO
        </button>
      )}

      <button
        onClick={() => satellitesStopTracking()}
        style={{
          width: "100%",
          padding: "7px 8px",
          background: "rgba(255, 80, 80, 0.06)",
          border: "1px solid rgba(255, 80, 80, 0.3)",
          borderRadius: 4,
          color: "#ff5050",
          fontSize: 11,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "center",
          marginTop: 8,
          letterSpacing: 1,
          fontWeight: 700,
        }}
      >
        CLOSE
      </button>
    </div>
  );
}
