"use client";

import { useEffect, useState } from "react";
import * as Cesium from "cesium";
import { useGlobeStore } from "@/store/globe-store";

type Props = {
  visible?: boolean;
};

const POI_PRESETS: { name: string; lat: number; lon: number; height: number }[] = [
  { name: "Jakarta", lat: -6.1754, lon: 106.8272, height: 30_000 },
  { name: "Surabaya", lat: -7.2575, lon: 112.7521, height: 30_000 },
  { name: "Medan", lat: 3.5952, lon: 98.6722, height: 30_000 },
  { name: "Makassar", lat: -5.1477, lon: 119.4327, height: 30_000 },
  { name: "Jayapura", lat: -2.5916, lon: 140.669, height: 50_000 },
  { name: "Denpasar", lat: -8.6704, lon: 115.2174, height: 30_000 },
  { name: "New York", lat: 40.7589, lon: -73.9851, height: 30_000 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503, height: 30_000 },
  { name: "London", lat: 51.5074, lon: -0.1278, height: 30_000 },
  { name: "Paris", lat: 48.8566, lon: 2.3522, height: 30_000 },
  { name: "Dubai", lat: 25.2048, lon: 55.2708, height: 30_000 },
  { name: "Washington DC", lat: 38.8977, lon: -77.0365, height: 30_000 },
];

const LAYER_GROUPS: {
  label: string;
  layers: { id: string; label: string }[];
}[] = [
  {
    label: "AVIATION",
    layers: [
      { id: "flights", label: "Private Flights" },
      { id: "mil", label: "Military Flights" },
    ],
  },
  {
    label: "INTEL",
    layers: [
      { id: "satellites", label: "Satellites" },
      { id: "events", label: "Civil Unrest" },
    ],
  },
  {
    label: "IMAGERY",
    layers: [
      { id: "sentinel", label: "LIVE/REPLAY" },
    ],
  },
  {
    label: "GROUND",
    layers: [
      { id: "traffic", label: "Traffic" },
      { id: "cctv", label: "CCTV Mesh" },
      { id: "buildings", label: "3D Buildings" },
      { id: "bldgHighlight", label: "Building Highlights" },
    ],
  },
];

// Layers that benefit from a wider view — when toggled ON while camera is
// zoomed in below country level, fly out so the new layer's contacts are
// visible in context. Threshold: 200 km altitude.
// Events excluded — civil unrest dots are visible at any zoom and the
// auto-zoom-out was jarring when toggling the layer.
// GIBS/Sentinel deliberately excluded: the LIVE/REPLAY button below only
// opens the LiveReplayPanel (no direct toggle here). The actual layer
// toggle happens in LiveReplayPanel.selectPreset, which is always paired
// with flyToPreset (camera already flies to the preset's lat/lon/height).
// So there is no direct toggle-on path that bypasses a flyTo. Do NOT add
// gibs/sentinel to this set: ZOOM_OUT_TARGET (18M m, full globe) is wrong
// for imagery tiers, which need tier-specific altitudes (GIBS ~8M m,
// Sentinel ~200k m) handled at the preset site.
const ZOOM_OUT_LAYERS = new Set(["flights", "mil"]);
const ZOOM_OUT_THRESHOLD = 200_000; // 200 km
// Flights/military are global layers — zoom out to a full-globe view so the
// worldwide contacts are visible (a 500 km regional view shows only the
// handful of aircraft near the current position).
const ZOOM_OUT_TARGET = 18_000_000; // 18,000 km — entire globe in frame

function fmtLat(value: number): string {
  const dir = value >= 0 ? "N" : "S";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${deg}°${min.toFixed(2)}'${dir}`;
}

function fmtLon(value: number): string {
  const dir = value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${deg}°${min.toFixed(2)}'${dir}`;
}

export default function TacticalHUD({ visible = true }: Props) {
  const [mounted, setMounted] = useState(false);
  const sidebarOpen = useGlobeStore((s) => s.leftPanelOpen);
  const setSidebarOpen = useGlobeStore((s) => s.setLeftPanelOpen);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { name: string; lat: number; lon: number }[]
  >([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const layerVisibility = useGlobeStore((s) => s.layerVisibility);
  const layerLoading = useGlobeStore((s) => s.layerLoading);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);
  const replayPanelOpen = useGlobeStore((s) => s.replayPanelOpen);
  const setReplayPanelOpen = useGlobeStore((s) => s.setReplayPanelOpen);
  const activeCity = useGlobeStore((s) => s.activeCity);
  const saveView = useGlobeStore((s) => s.saveView);
  const googleTilesEnabled = useGlobeStore((s) => s.googleTilesEnabled);
  const setGoogleTilesEnabled = useGlobeStore((s) => s.setGoogleTilesEnabled);

  useEffect(() => {
    setMounted(true);
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }

  const [savedFlash, setSavedFlash] = useState(false);

  function handleSaveView() {
    const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
    if (!v || v.isDestroyed()) return;
    const city = activeCity || "Custom";
    const carto = v.camera.positionCartographic;
    saveView(city, {
      lat: (carto.latitude * 180) / Math.PI,
      lon: (carto.longitude * 180) / Math.PI,
      height: carto.height,
      heading: (v.camera.heading * 180) / Math.PI,
      pitch: (v.camera.pitch * 180) / Math.PI,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const localMatches = POI_PRESETS.filter((p) =>
      p.name.toLowerCase().includes(query.toLowerCase()),
    ).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));

    // Check if the query looks like coordinates
    const coordMatch = parseCoordinates(query);
    if (coordMatch) {
      setSearchResults([
        { name: `${coordMatch.lat.toFixed(4)}, ${coordMatch.lon.toFixed(4)}`, lat: coordMatch.lat, lon: coordMatch.lon },
        ...localMatches,
      ]);
      return;
    }

    setSearchResults(localMatches);

    // Photon (Komoot) — fast, typo-tolerant, OSM-based
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data: { features?: { properties: { name: string; city?: string; state?: string; country?: string }; geometry: { coordinates: [number, number] } }[] } = await res.json();
        const remote = (data.features ?? []).map((f) => {
          const p = f.properties;
          const parts = [p.name, p.city ?? p.state, p.country].filter(Boolean);
          return {
            name: parts.join(", ") || p.name,
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
          };
        });
        setSearchResults([...localMatches, ...remote]);
        return;
      }
    } catch {
      // offline or rate-limited — fall through to Nominatim
    }

    // Fallback: Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
      const res = await fetch(url, {
        headers: { "User-Agent": "spectre/0.1" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data: { display_name: string; lat: string; lon: string }[] = await res.json();
        const remote = data.map((d) => ({
          name: d.display_name.split(",")[0],
          lat: parseFloat(d.lat),
          lon: parseFloat(d.lon),
        }));
        setSearchResults([...localMatches, ...remote]);
      }
    } catch {
      // offline / rate-limited
    }
  }

  // Parse coordinate input in various formats:
  //   "-6.1754, 106.8272"            (decimal degrees)
  //   "40.7589N 73.9851W"            (decimal with direction)
  //   "6°10'S 106°49'E"              (DMS)
  //   "6 10 S, 106 49 E"             (space-separated DMS)
  function parseCoordinates(input: string): { lat: number; lon: number } | null {
    const s = input.trim();

    // Pattern 1: decimal degrees — "lat, lon" or "lat lon"
    // Supports: -6.1754, 106.8272 | -6.1754 106.8272 | 40.7589N, 73.9851W
    const decPattern = /^(-?\d+\.?\d*)\s*[NnSs]?\s*[,\s]\s*(-?\d+\.?\d*)\s*[EeWw]?$/;
    let m = s.match(decPattern);
    if (m) {
      let lat = parseFloat(m[1]);
      let lon = parseFloat(m[2]);
      // Handle direction suffixes
      if (/[Ss]/.test(m[0].charAt(m[1].length)) || /[Ss]/.test(s.split(/[\s,]/)[0].slice(-1))) lat = -Math.abs(lat);
      if (/[Ww]/.test(s.split(/[\s,]/).pop()?.slice(-1) ?? "")) lon = -Math.abs(lon);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon };
      }
    }

    // Pattern 2: DMS — "6°10'S 106°49'E" or "6° 10' S, 106° 49' E"
    const dmsRegex = /(\d+)[°d]\s*(\d+)[′'m]?\s*(\d+\.?\d*)?[″"s]?\s*([NnSs])/;
    const dmsRegex2 = /(\d+)[°d]\s*(\d+)[′'m]?\s*(\d+\.?\d*)?[″"s]?\s*([EeWw])/;
    const m1 = s.match(dmsRegex);
    const m2 = s.match(dmsRegex2);
    if (m1 && m2) {
      const latSign = /[Ss]/.test(m1[4]) ? -1 : 1;
      const lonSign = /[Ww]/.test(m2[4]) ? -1 : 1;
      const lat = latSign * (parseFloat(m1[1]) + parseFloat(m1[2]) / 60 + (parseFloat(m1[3]) || 0) / 3600);
      const lon = lonSign * (parseFloat(m2[1]) + parseFloat(m2[2]) / 60 + (parseFloat(m2[3]) || 0) / 3600);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon };
      }
    }

    return null;
  }

  function flyTo(lat: number, lon: number, height: number = 30_000) {
    const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
    if (!v) return;
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration: 1.5,
    });
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  }

  if (!visible || !mounted) return null;

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: sidebarOpen ? 240 : 0,
          height: "100%",
          background: "transparent",
          borderRight: "none",
          // Subtle curve on the inner edge to hint at the central globe
          // circle without being literal.
          borderTopRightRadius: sidebarOpen ? 18 : 0,
          borderBottomRightRadius: sidebarOpen ? 18 : 0,
          transition: "width 0.2s ease",
          zIndex: 60,
          overflow: "hidden",
          fontFamily: "JetBrains Mono, monospace",
          color: "#00D4FF",
          pointerEvents: "auto",
        }}
      >
        {sidebarOpen && (
          <div style={{ padding: "16px 12px", height: "100%", overflowY: "auto" }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: "#00D4FF" }}>
                SPECTRE
              </div>
            </div>

            <button
              onClick={() => setSearchOpen(true)}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "rgba(0, 212, 255, 0.03)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                border: "1px solid rgba(0, 212, 255, 0.3)",
                color: "#00D4FF",
                fontSize: 10,
                fontFamily: "inherit",
                cursor: "pointer",
                textAlign: "left",
                borderRadius: 6,
                marginBottom: 16,
              }}
            >
              SEARCH LOCATION...
            </button>

            {LAYER_GROUPS.map((group) => (
              <div key={group.label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 8, letterSpacing: 1.5, marginBottom: 6, color: "#7ac4e0" }}>
                  {group.label}
                </div>
                {group.layers.map((layer) => {
                  // LIVE/REPLAY is "active" when panel open or either imagery layer on
                  const active =
                    layer.id === "sentinel"
                      ? !!(replayPanelOpen || layerVisibility.sentinel || layerVisibility.gibs)
                      : !!layerVisibility[layer.id];
                  const loading = !!layerLoading[layer.id];
                  return (
                    <div key={layer.id}>
                      <button
                        onClick={() => {
                          // LIVE/REPLAY button opens the panel (does not
                          // auto-enable a layer; user picks GIBS or Sentinel
                          // from the panel).
                          if (layer.id === "sentinel") {
                            setReplayPanelOpen(!replayPanelOpen);
                            return;
                          }
                          const wasActive = !!layerVisibility[layer.id];
                          toggleLayer(layer.id);
                          // Auto-zoom-out: when turning ON a wide-area layer
                          // while zoomed in too close, fly out so the new
                          // contacts are visible in context.
                          if (!wasActive && ZOOM_OUT_LAYERS.has(layer.id)) {
                            const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
                            if (v && !v.isDestroyed()) {
                              const carto = v.camera.positionCartographic;
                              if (carto.height < ZOOM_OUT_THRESHOLD) {
                                v.camera.flyTo({
                                  destination: Cesium.Cartesian3.fromRadians(
                                    carto.longitude,
                                    carto.latitude,
                                    ZOOM_OUT_TARGET,
                                  ),
                                  orientation: {
                                    heading: v.camera.heading,
                                    pitch: Cesium.Math.toRadians(-50),
                                    roll: 0,
                                  },
                                  duration: 1.2,
                                });
                              }
                            }
                          }
                        }}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          minHeight: 24,
                          background: active
                            ? "rgba(0, 212, 255, 0.12)"
                            : "rgba(0, 212, 255, 0.03)",
                          backdropFilter: "blur(6px)",
                          WebkitBackdropFilter: "blur(6px)",
                          border: active
                            ? "1px solid rgba(0, 212, 255, 0.6)"
                            : "1px solid rgba(0, 212, 255, 0.2)",
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
                            display: "inline-block",
                            animation: loading ? "spin 0.8s linear infinite" : undefined,
                          }}
                        >
                          {loading ? "◐" : active ? "◉" : "○"}
                        </span>
                        <span style={{ flex: 1 }}>{layer.label.toUpperCase()}</span>
                        <span style={{ opacity: 0.7, fontSize: 8 }}>
                          {loading ? "LOADING" : active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}

          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 116,
          right: 12,
          zIndex: 70,
          width: 220,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          pointerEvents: "auto",
        }}
      >
        <button
          onClick={handleSaveView}
          title="Save current view"
          style={{
            width: "100%",
            padding: "8px 10px",
            background: savedFlash
              ? "rgba(0, 212, 255, 0.12)"
              : "rgba(0, 212, 255, 0.03)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            border: savedFlash
              ? "1px solid rgba(0, 212, 255, 0.6)"
              : "1px solid rgba(0, 212, 255, 0.3)",
            color: "#00D4FF",
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
            cursor: "pointer",
            textAlign: "left",
            borderRadius: 6,
            letterSpacing: 0.5,
            transition: "background 0.15s, border-color 0.15s",
          }}
        >
          {savedFlash ? "✓" : "⊞"}
          <span style={{ display: "block", fontSize: 8 }}>SAVE</span>
        </button>

        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          style={{
            width: "100%",
            padding: "8px 10px",
            background: "rgba(0, 212, 255, 0.03)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            border: "1px solid rgba(0, 212, 255, 0.3)",
            color: "#00D4FF",
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
            cursor: "pointer",
            textAlign: "left",
            borderRadius: 6,
            letterSpacing: 0.5,
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(0, 212, 255, 0.03)";
            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.3)";
          }}
        >
          {isFullscreen ? "⊠" : "⛶"}
          <span style={{ display: "block", fontSize: 8 }}>
            {isFullscreen ? "EXIT" : "FULL"}
          </span>
        </button>

        <button
          onClick={() => setGoogleTilesEnabled(!googleTilesEnabled)}
          title={
            googleTilesEnabled
              ? "Turn off Google Photorealistic 3D Tiles"
              : "Turn on Google Photorealistic 3D Tiles"
          }
          style={{
            width: "100%",
            padding: "8px 10px",
            background: googleTilesEnabled
              ? "rgba(0, 212, 255, 0.12)"
              : "rgba(0, 212, 255, 0.03)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            border: googleTilesEnabled
              ? "1px solid rgba(0, 212, 255, 0.6)"
              : "1px solid rgba(0, 212, 255, 0.3)",
            color: googleTilesEnabled ? "#00D4FF" : "#5ab3d4",
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
            cursor: "pointer",
            textAlign: "left",
            borderRadius: 6,
            letterSpacing: 0.5,
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = googleTilesEnabled
              ? "rgba(0, 212, 255, 0.12)"
              : "rgba(0, 212, 255, 0.03)";
            e.currentTarget.style.borderColor = googleTilesEnabled
              ? "rgba(0, 212, 255, 0.6)"
              : "rgba(0, 212, 255, 0.3)";
          }}
        >
          ⬡
          <span style={{ display: "block", fontSize: 8 }}>
            {googleTilesEnabled ? "3D ON" : "3D TILES"}
          </span>
        </button>

        <button
          onClick={() => toggleLayer("borders")}
          title="Toggle continent borders"
          style={{
            width: "100%",
            padding: "8px 10px",
            background: layerVisibility.borders
              ? "rgba(0, 212, 255, 0.12)"
              : "rgba(0, 212, 255, 0.03)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            border: layerVisibility.borders
              ? "1px solid rgba(0, 212, 255, 0.6)"
              : "1px solid rgba(0, 212, 255, 0.3)",
            color: layerVisibility.borders ? "#00D4FF" : "#5ab3d4",
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
            cursor: "pointer",
            textAlign: "left",
            borderRadius: 6,
            letterSpacing: 0.5,
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = layerVisibility.borders
              ? "rgba(0, 212, 255, 0.12)"
              : "rgba(0, 212, 255, 0.03)";
            e.currentTarget.style.borderColor = layerVisibility.borders
              ? "rgba(0, 212, 255, 0.6)"
              : "rgba(0, 212, 255, 0.3)";
          }}
        >
          ◇
          <span style={{ display: "block", fontSize: 8 }}>
            {layerVisibility.borders ? "BORDERS ON" : "BORDERS"}
          </span>
        </button>
      </div>

      {/* SEARCH MODAL */}
      {searchOpen && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0, 0, 0, 0.6)",
            zIndex: 80,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 80,
            pointerEvents: "auto",
          }}
          onClick={() => setSearchOpen(false)}
        >
          <div
            style={{
              width: 420,
              background: "transparent",
              border: "1px solid rgba(0, 212, 255, 0.4)",
              borderRadius: 8,
              fontFamily: "JetBrains Mono, monospace",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search city or coordinates (-6.18, 106.83)..."
              autoFocus
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid rgba(0, 212, 255, 0.3)",
                color: "#00D4FF",
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {searchResults.map((r, i) => (
                <div
                  key={i}
                  onClick={() => flyTo(r.lat, r.lon, 30_000)}
                  style={{
                    padding: "8px 14px",
                    cursor: "pointer",
                    color: "#e6e8eb",
                    fontSize: 11,
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0, 212, 255, 0.1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ color: "#00D4FF" }}>{r.name}</div>
                  <div style={{ fontSize: 8, opacity: 0.5, marginTop: 2 }}>
                    {fmtLat(r.lat)} {fmtLon(r.lon)}
                  </div>
                </div>
              ))}
              {searchResults.length === 0 && searchQuery && (
                <div style={{ padding: 14, color: "#5ab3d4", fontSize: 10, textAlign: "center" }}>
                  No results...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
