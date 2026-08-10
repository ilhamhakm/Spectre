"use client";

import { useEffect, useRef, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";

// Right-side private flights panel. When the PRIVATE FLIGHTS layer is toggled
// on, this replaces the continental menu in CityBookmarks until the user
// clicks back to continents (which just switches the layer off again).
//
// Two modes:
//   1. FEED — the ~10 most-recent notable private jets (airborne first),
//      fetched from /api/private-flights?feed=1. Each row shows live position
//      or, if the jet is quiet, where it last landed.
//   2. SEARCH — type a name or tail number; /api/private-flights?q= matches
//      both. Results render the same way as feed rows.
//
// Each row has a TRACK button: gold-highlights the jet on the globe,
// auto-renders its trajectory, and accumulates a live trail (driven by the
// globe's trackedTail effect). Clicking TRACK again clears the tracking.

interface TailLive {
  lat: number;
  lon: number;
  altitude: number | null;
  heading: number;
  onGround: boolean;
  lastContact: number;
}
interface TailLastKnown {
  lat: number;
  lon: number;
  altitude: number | null;
  lastContact: number;
}
interface TailLastFlight {
  origin: string | null;
  destination: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  callsign: string | null;
}
interface TailResult {
  tail: string;
  icao24: string | null;
  live: TailLive | null;
  lastKnown: TailLastKnown | null;
  lastFlight: TailLastFlight | null;
}
interface PersonResult {
  name: string;
  description?: string;
  tailNumbers: string[];
  tails: TailResult[];
  liveDataAvailable: boolean;
  status: "airborne" | "grounded" | "unknown";
  latestTs: number;
}
interface FeedResponse {
  people: PersonResult[];
  feed?: PersonResult[];
  authConfigured: boolean;
}

function fmtAge(unixSec: number | null | undefined): string {
  if (!unixSec) return "—";
  const mins = Math.max(0, Math.floor((Date.now() / 1000 - unixSec) / 60));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtAirport(code: string | null): string {
  if (!code) return "unknown";
  return code;
}

function panelRowStyle(isActive: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    background: isActive
      ? "rgba(255, 200, 42, 0.1)"
      : "rgba(0, 212, 255, 0.03)",
    border: isActive
      ? "1px solid rgba(255, 200, 42, 0.6)"
      : "1px solid rgba(0, 212, 255, 0.15)",
    color: isActive ? "#ffc82a" : "#5ab3d4",
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

export default function PrivateFlightsPanel() {
  const flightsOn = useGlobeStore((s) => s.layerVisibility.flights ?? false);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);
  const setTrackedTail = useGlobeStore((s) => s.setTrackedTail);
  const trackedTailCallsign = useGlobeStore((s) => s.trackedTailCallsign);
  const trackedTailName = useGlobeStore((s) => s.trackedTailName);

  const [feed, setFeed] = useState<PersonResult[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load the scrollable feed of ~10 most-recent notable jets. Refresh every
  // 60s so the "latest flights" list stays live-ish without hammering OpenSky.
  useEffect(() => {
    if (!flightsOn) return;
    let cancelled = false;
    const load = async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch("/api/private-flights?feed=1", {
          signal: abortRef.current.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as FeedResponse;
        if (!cancelled && Array.isArray(data.feed)) setFeed(data.feed);
      } catch {
        // aborted or network error — keep last feed
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [flightsOn]);

  // Debounced search by name or tail number.
  useEffect(() => {
    if (!flightsOn) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch(
          `/api/private-flights?q=${encodeURIComponent(q)}`,
          { signal: abortRef.current.signal },
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as FeedResponse;
        setResults(Array.isArray(data.people) ? data.people : []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "search failed";
        if (!abortRef.current?.signal.aborted) setError(msg);
      } finally {
        if (!abortRef.current?.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, flightsOn]);

  const list = results ?? feed;

  // The person currently being tracked (for gold highlight on the button).
  const trackedPerson =
    results && results.length > 0
      ? results.find((r) =>
          r.tails.some((t) => t.tail === trackedTailCallsign),
        ) ?? null
      : null;

  function track(person: PersonResult, tail: TailResult) {
    if (trackedTailCallsign && tail.tail === trackedTailCallsign) {
      setTrackedTail(null);
      return;
    }
    setTrackedTail(tail.tail, person.name, tail.icao24);
  }

  if (!flightsOn) return null;

  return (
    <div
      style={{
        padding: "16px 12px 120px 12px",
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Header + way back to continental view */}
      <button
        onClick={() => toggleLayer("flights")}
        style={{
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
          marginBottom: 2,
          letterSpacing: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
          e.currentTarget.style.color = "#00D4FF";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(0, 212, 255, 0.03)";
          e.currentTarget.style.color = "#7ac4e0";
        }}
      >
        ‹ CONTINENTS
      </button>

      <div
        style={{
          fontSize: 8,
          letterSpacing: 1.5,
          marginBottom: 2,
          color: "#7ac4e0",
          textAlign: "right",
        }}
      >
        PRIVATE FLIGHTS
      </div>

      {/* Search bar */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name or tail (N628TS)..."
        style={{
          width: "100%",
          padding: "7px 9px",
          background: "rgba(0, 212, 255, 0.04)",
          border: "1px solid rgba(0, 212, 255, 0.25)",
          color: "#00D4FF",
          fontSize: 10,
          fontFamily: "JetBrains Mono, monospace",
          borderRadius: 6,
          outline: "none",
          boxSizing: "border-box",
          letterSpacing: 0.5,
          textAlign: "right",
        }}
      />

      {loading && (
        <div style={{ fontSize: 9, color: "#888", padding: "8px 0", textAlign: "right" }}>
          SEARCHING…
        </div>
      )}

      {error && !loading && (
        <div style={{ fontSize: 9, color: "#ff4d4d", padding: "8px 0", textAlign: "right" }}>
          {error}
        </div>
      )}

      {!loading && !error && list.length === 0 && (
        <div style={{ fontSize: 9, color: "#5a606c", padding: "12px 0", textAlign: "right" }}>
          No notable jets found.
        </div>
      )}

      <div
        className="scrollbar"
        style={{
          maxHeight: 340,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          paddingRight: 4,
        }}
      >
      {list.map((person) => {
        const isTrackedPerson = trackedTailName === person.name || trackedPerson?.name === person.name;
        const primaryTail = person.tails[0];
        const live = primaryTail?.live ?? null;
        const lastKnown = primaryTail?.lastKnown ?? null;
        const lastFlight = primaryTail?.lastFlight ?? null;

        let statusText = "NO DATA";
        let statusColor = "#5a606c";
        if (person.status === "airborne" && live) {
          statusText = `AIRBORNE · ${Math.round((live.altitude ?? 0) / 1000)}km`;
          statusColor = "#00ff88";
        } else if (lastKnown) {
          statusText = `LAST SEEN ${fmtAge(lastKnown.lastContact)}`;
          statusColor = "#c8a02a";
        } else if (lastFlight?.lastSeen) {
          statusText = `LANDED ${fmtAge(lastFlight.lastSeen)}`;
          statusColor = "#7ac4e0";
        }

        // Where they last landed (or are right now for airborne).
        let locationText = "";
        if (live && person.status === "airborne") {
          locationText = `${live.lat.toFixed(2)}°, ${live.lon.toFixed(2)}°`;
        } else if (lastKnown) {
          locationText = `${lastKnown.lat.toFixed(2)}°, ${lastKnown.lon.toFixed(2)}°`;
        } else if (lastFlight?.destination) {
          locationText = `→ ${fmtAirport(lastFlight.destination)}`;
        } else if (lastFlight?.origin) {
          locationText = `↗ ${fmtAirport(lastFlight.origin)}`;
        }

        return (
          <div
            key={person.name + primaryTail?.tail}
            style={panelRowStyle(isTrackedPerson)}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
              }}
            >
              <span style={{ fontWeight: 700, color: isTrackedPerson ? "#ffc82a" : "#d9f4ff" }}>
                {person.name.toUpperCase()}
              </span>
              <span style={{ fontSize: 8, color: statusColor, letterSpacing: 0.5 }}>
                {statusText}
              </span>
            </div>
            <div
              style={{
                fontSize: 8,
                color: "#5a606c",
                marginTop: 2,
                letterSpacing: 0.5,
              }}
            >
              {primaryTail?.tail} · {locationText}
            </div>
            {person.description && (
              <div style={{ fontSize: 8, color: "#3f5a68", marginTop: 2 }}>
                {person.description}
              </div>
            )}
            <button
              onClick={() => primaryTail && track(person, primaryTail)}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "4px 8px",
                background: isTrackedPerson
                  ? "rgba(255, 200, 42, 0.18)"
                  : "rgba(255, 200, 42, 0.04)",
                border: isTrackedPerson
                  ? "1px solid rgba(255, 200, 42, 0.7)"
                  : "1px solid rgba(255, 200, 42, 0.35)",
                color: "#ffc82a",
                fontSize: 9,
                fontFamily: "inherit",
                cursor: "pointer",
                borderRadius: 5,
                letterSpacing: 1,
                textAlign: "right",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 200, 42, 0.14)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isTrackedPerson
                  ? "rgba(255, 200, 42, 0.18)"
                  : "rgba(255, 200, 42, 0.04)";
              }}
            >
              {trackedTailCallsign === primaryTail?.tail ? "■ UNTRACK" : "► TRACK"}
            </button>
          </div>
        );
      })}
      </div>
    </div>
  );
}
