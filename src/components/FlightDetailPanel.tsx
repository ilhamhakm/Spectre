"use client";

import { useGlobeStore, type TrajectoryData, type SelectedKind } from "@/store/globe-store";

// Flight detail right panel: shows full flight info when a flight is
// selected (clicked on the globe). Reads trajectory data from the store
// (populated by FlightTrajectoryOverlay's fetch). Renders as a transparent
// overlay on the right side of the screen, on top of the existing RightPanel.
// All text is white to blend with the app's monochrome aesthetic. Military
// flights keep an amber accent for the header only.

function formatTime(unixSec: number | null | undefined): string {
  if (!unixSec) return "";
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mi} UTC`;
}

function formatISO(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mi} UTC`;
}

function formatVerticalRate(vr: number | null | undefined): string {
  if (vr == null || vr === 0) return "Level";
  const fpm = Math.round(vr * 196.85); // m/s to feet/min
  if (fpm > 0) return `Climbing ${fpm} fpm`;
  return `Descending ${Math.abs(fpm)} fpm`;
}

function squawkLabel(squawk: string | null | undefined): { text: string; color: string } | null {
  if (!squawk) return null;
  if (squawk === "7700") return { text: `${squawk} EMERGENCY`, color: "#ff3030" };
  if (squawk === "7600") return { text: `${squawk} RADIO FAIL`, color: "#ff8800" };
  if (squawk === "7500") return { text: `${squawk} HIJACK`, color: "#ff0000" };
  return { text: squawk, color: WHITE };
}

function formatAirportLabel(
  code: string | null,
  airport: { icao: string; name: string; city: string; lat: number; lon: number } | null | undefined,
): { primary: string; secondary: string | null } {
  if (!airport) return { primary: code ?? "Unknown", secondary: null };
  const place = airport.city && airport.city.trim() ? airport.city : airport.name;
  if (place && place !== airport.icao) {
    return { primary: place, secondary: `${airport.name} (${airport.icao})` };
  }
  return { primary: airport.icao, secondary: airport.name };
}

// Header text per flight kind. Military uses amber accent, others white.
function kindHeader(kind: SelectedKind): { header: string; accent: string } {
  switch (kind) {
    case "flight-mil":
      return { header: "MILITARY FLIGHT", accent: "#FF3030" };
    case "flight-private":
      return { header: "PRIVATE FLIGHT", accent: "#ffffff" };
    case "flight-commercial":
      return { header: "COMMERCIAL FLIGHT", accent: "#ffffff" };
    default:
      return { header: "FLIGHT", accent: "#ffffff" };
  }
}

const WHITE = "#ffffff";
const DIM = "rgba(255,255,255,0.45)";

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <span style={{ fontSize: 10, color: DIM, letterSpacing: 1, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 11, color: WHITE, textAlign: "right", fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function FlightInfo({ data, kind, icao24 }: { data: TrajectoryData; kind: SelectedKind; icao24: string }) {
  const { header, accent } = kindHeader(kind);
  const idLabel = `ICAO24 ${icao24.toUpperCase()}`;

  const traj = data.trajectory ?? [];
  const lastWp = traj.length > 0 ? traj[traj.length - 1] : null;
  const alt = lastWp?.alt;
  const heading = data.heading;
  const velocity = data.velocity;
  const country = data.originCountry;

  // Speed: convert m/s to km/h if available.
  const speedKmh = velocity != null && velocity > 0 ? Math.round(velocity * 3.6) : null;
  // Altitude: convert meters to feet for aviation convention.
  const altFt = alt != null && alt > 0 ? Math.round(alt * 3.28084) : null;
  const altKm = alt != null && alt > 0 ? (alt / 1000).toFixed(1) : null;

  const ownerLabel = country ?? "Unknown";
  const squawkInfo = squawkLabel(data.squawk);

  return (
    <>
      <div style={{ fontSize: 10, color: accent, letterSpacing: 2, marginBottom: 4, fontWeight: 700 }}>
        {header}
      </div>
      <div style={{ fontSize: 16, color: WHITE, fontWeight: 800, marginBottom: 2, textAlign: "right" }}>
        {data.callsign || "Unknown"}
      </div>
      <div style={{ fontSize: 10, color: DIM, marginBottom: 10, textAlign: "right", fontWeight: 700 }}>
        {idLabel}
      </div>

      {/* Live telemetry */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: DIM, letterSpacing: 1, marginBottom: 4, fontWeight: 700 }}>
          TELEMETRY
        </div>
        <DataRow label="ALTITUDE" value={altFt != null ? `${altFt.toLocaleString()} ft` : altKm != null ? `${altKm} km` : "unknown"} />
        <DataRow label="HEADING" value={heading != null ? `${Math.round(heading)} deg` : "unknown"} />
        {speedKmh != null && <DataRow label="SPEED" value={`${speedKmh} km/h`} />}
        <DataRow label="VERTICAL" value={formatVerticalRate(data.verticalRate)} />
        {squawkInfo && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 10, color: DIM, letterSpacing: 1, fontWeight: 700 }}>SQUAWK</span>
            <span style={{ fontSize: 11, color: squawkInfo.color, textAlign: "right", fontWeight: 700 }}>{squawkInfo.text}</span>
          </div>
        )}
      </div>

      {/* Aircraft + owner */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: DIM, letterSpacing: 1, marginBottom: 4, fontWeight: 700 }}>
          AIRCRAFT
        </div>
        {data.aircraftType && <DataRow label="TYPE" value={data.aircraftType} />}
        {data.aircraftModel && <DataRow label="MODEL" value={data.aircraftModel} />}
        {data.registration && <DataRow label="REGISTRATION" value={data.registration} />}
        {data.operator && <DataRow label="OPERATOR" value={data.operator} />}
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 9, color: DIM, fontWeight: 700, marginBottom: 2 }}>ORIGIN COUNTRY</div>
          <div style={{ fontSize: 13, color: WHITE, fontWeight: 800 }}>
            {ownerLabel}
          </div>
        </div>
      </div>

      {/* Origin / destination */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: DIM, letterSpacing: 1, marginBottom: 4, fontWeight: 700 }}>
          ROUTE
        </div>
        {data.flightStatus && (
          <div style={{ fontSize: 11, color: data.flightStatus === "Arrived" ? DIM : WHITE, fontWeight: 800, marginBottom: 6, textAlign: "right" }}>
            {data.flightStatus.toUpperCase()}
          </div>
        )}
        {typeof data.origin === "string" ? (
          (() => {
            const lbl = formatAirportLabel(data.origin, data.originAirport);
            return (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: DIM, fontWeight: 700 }}>ORIGIN</div>
                <div style={{ fontSize: 13, color: WHITE, fontWeight: 800 }}>{lbl.primary}</div>
                {lbl.secondary && <div style={{ fontSize: 10, color: DIM, fontWeight: 700 }}>{lbl.secondary}</div>}
                {(data.departureTerminal || data.departureGate) && (
                  <div style={{ fontSize: 10, color: DIM, fontWeight: 700 }}>
                    {data.departureTerminal && `T${data.departureTerminal}`}
                    {data.departureTerminal && data.departureGate && " / "}
                    {data.departureGate && `Gate ${data.departureGate}`}
                  </div>
                )}
                {(formatISO(data.departureScheduled) || formatISO(data.departureRevised)) && (
                  <div style={{ fontSize: 10, color: DIM, fontWeight: 700 }}>
                    {data.departureRevised ? formatISO(data.departureRevised) : formatISO(data.departureScheduled)}
                    {data.departureRevised && data.departureScheduled && data.departureRevised !== data.departureScheduled && " (revised)"}
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <div style={{ fontSize: 11, color: DIM, fontStyle: "italic", marginBottom: 6, fontWeight: 700 }}>
            Origin unknown
          </div>
        )}
        {typeof data.destination === "string" ? (
          (() => {
            const lbl = formatAirportLabel(data.destination, data.destinationAirport);
            return (
              <div>
                <div style={{ fontSize: 9, color: DIM, fontWeight: 700 }}>DESTINATION</div>
                <div style={{ fontSize: 13, color: WHITE, fontWeight: 800 }}>{lbl.primary}</div>
                {lbl.secondary && <div style={{ fontSize: 10, color: DIM, fontWeight: 700 }}>{lbl.secondary}</div>}
                {(data.arrivalTerminal || data.arrivalGate) && (
                  <div style={{ fontSize: 10, color: DIM, fontWeight: 700 }}>
                    {data.arrivalTerminal && `T${data.arrivalTerminal}`}
                    {data.arrivalTerminal && data.arrivalGate && " / "}
                    {data.arrivalGate && `Gate ${data.arrivalGate}`}
                  </div>
                )}
                {(formatISO(data.arrivalScheduled) || formatISO(data.arrivalRevised)) && (
                  <div style={{ fontSize: 10, color: DIM, fontWeight: 700 }}>
                    {data.arrivalRevised ? formatISO(data.arrivalRevised) : formatISO(data.arrivalScheduled)}
                    {data.arrivalRevised && data.arrivalScheduled && data.arrivalRevised !== data.arrivalScheduled && " (revised)"}
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <div style={{ fontSize: 11, color: DIM, fontStyle: "italic", fontWeight: 700 }}>
            Destination unknown
            {heading != null && <span> (heading {Math.round(heading)} deg)</span>}
          </div>
        )}
      </div>

      {/* Source link */}
      <a
        href={data.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          fontSize: 10,
          color: WHITE,
          textDecoration: "none",
          textAlign: "center",
          padding: "6px 8px",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 4,
          marginBottom: 6,
          letterSpacing: 1,
          fontWeight: 700,
        }}
      >
        VIEW SOURCE
      </a>
    </>
  );
}

export default function FlightDetailPanel() {
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const selectedKind = useGlobeStore((s) => s.selectedKind);
  const trajectoryData = useGlobeStore((s) => s.trajectoryData);
  const trajectoryLoading = useGlobeStore((s) => s.trajectoryLoading);
  const trajectoryError = useGlobeStore((s) => s.trajectoryError);

  if (!selectedFlightId) return null;
  const { header, accent } = kindHeader(selectedKind);

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
      {trajectoryLoading && (
        <div style={{ fontSize: 11, color: WHITE, textAlign: "center", padding: "20px 0", fontWeight: 700 }}>
          FETCHING TRAJECTORY...
        </div>
      )}

      {trajectoryError && !trajectoryLoading && (
        <div style={{ fontSize: 11, color: "#ff4d4d", padding: "8px 0", fontWeight: 700 }}>
          Failed: {trajectoryError}
        </div>
      )}

      {trajectoryData && !trajectoryLoading && (
        <FlightInfo
          data={trajectoryData}
          kind={selectedKind}
          icao24={selectedFlightId}
        />
      )}

      {!trajectoryData && !trajectoryLoading && !trajectoryError && (
        <>
          <div style={{ fontSize: 10, letterSpacing: 1.5, marginBottom: 10, color: accent, textAlign: "right", fontWeight: 700 }}>
            {header}
          </div>
          <div style={{ fontSize: 15, color: WHITE, fontWeight: 800, marginBottom: 4, textAlign: "right" }}>
            {selectedFlightId.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: DIM, marginBottom: 8, textAlign: "right", fontWeight: 700 }}>
            ICAO24 hex transponder code
          </div>
        </>
      )}

      <button
        onClick={() => useGlobeStore.getState().selectFlight(null, null)}
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
