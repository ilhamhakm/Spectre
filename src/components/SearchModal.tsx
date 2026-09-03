"use client";

import { useState } from "react";
import { useGlobeStore } from "@/store/globe-store";

const POI_CITIES: { name: string; lat: number; lon: number; height: number }[] = [
  { name: "Jakarta", lat: -6.1754, lon: 106.8272, height: 30000 },
  { name: "Surabaya", lat: -7.2575, lon: 112.7521, height: 30000 },
  { name: "Medan", lat: 3.5952, lon: 98.6722, height: 30000 },
  { name: "Makassar", lat: -5.1477, lon: 119.4327, height: 30000 },
  { name: "Jayapura", lat: -2.5916, lon: 140.669, height: 50000 },
  { name: "Denpasar", lat: -8.6705, lon: 115.2126, height: 30000 },
  { name: "New York", lat: 40.7589, lon: -73.9851, height: 30000 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503, height: 30000 },
  { name: "London", lat: 51.5074, lon: -0.1278, height: 30000 },
  { name: "Paris", lat: 48.8566, lon: 2.3522, height: 30000 },
  { name: "Dubai", lat: 25.2048, lon: 55.2708, height: 30000 },
  { name: "Washington DC", lat: 38.8977, lon: -77.0365, height: 30000 },
];

function parseCoords(input: string): { lat: number; lon: number } | null {
  const trimmed = input.trim();
  // Decimal: "lat, lon"
  const decimalMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1]);
    const lon = parseFloat(decimalMatch[2]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  return null;
}

export default function SearchModal() {
  const setSearchOpen = useGlobeStore((s) => s.setSearchOpen);
  const setActiveLocation = useGlobeStore((s) => s.setActiveLocation);
  const [query, setQuery] = useState("");

  const handleSearch = () => {
    const coords = parseCoords(query);
    const viewer = (window as any).__viewer;
    const Cesium = (window as any).__Cesium;
    if (!viewer || !Cesium) return;

    if (coords) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, 30000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.5,
      });
      setSearchOpen(false);
      return;
    }

    // Try city match
    const city = POI_CITIES.find((c) => c.name.toLowerCase() === query.toLowerCase());
    if (city) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(city.lon, city.lat, city.height),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.5,
      });
      setActiveLocation("city", city.name);
      setSearchOpen(false);
      return;
    }

    // Fallback: Photon geocoding API
    fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`)
      .then((res) => res.json())
      .then((data) => {
        if (data.features && data.features.length > 0) {
          const [lon, lat] = data.features[0].geometry.coordinates;
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, 30000),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
            duration: 1.5,
          });
          setSearchOpen(false);
        }
      })
      .catch(() => {
        // Fallback to Nominatim
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`)
          .then((res) => res.json())
          .then((data) => {
            if (data && data.length > 0) {
              const lat = parseFloat(data[0].lat);
              const lon = parseFloat(data[0].lon);
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, 30000),
                orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
                duration: 1.5,
              });
              setSearchOpen(false);
            }
          })
          .catch(() => {});
      });
  };

  return (
    <div
      onClick={() => setSearchOpen(false)}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 80,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          background: "var(--glass-bg)",
          border: "1px solid var(--glass-border-hover)",
          borderRadius: "var(--panel-radius)",
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          padding: 20,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2,
            color: "var(--accent)",
            marginBottom: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          SEARCH LOCATION
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="City name or coordinates (lat, lon)..."
          autoFocus
          style={{
            width: "100%",
            padding: "10px 14px",
            background: "var(--btn-bg)",
            border: "1px solid var(--btn-border)",
            borderRadius: "var(--btn-radius)",
            color: "var(--text-primary)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            outline: "none",
          }}
        />
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {POI_CITIES.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                setQuery(c.name);
                const viewer = (window as any).__viewer;
                const Cesium = (window as any).__Cesium;
                if (viewer && Cesium) {
                  viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.height),
                    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
                    duration: 1.5,
                  });
                  setActiveLocation("city", c.name);
                  setSearchOpen(false);
                }
              }}
              style={{
                padding: "4px 8px",
                background: "var(--btn-bg)",
                border: "1px solid var(--btn-border)",
                borderRadius: 4,
                color: "var(--text-secondary)",
                fontSize: 8,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
            >
              {c.name.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
