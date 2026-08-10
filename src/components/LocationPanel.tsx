"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";

interface LocationData {
  country: string | null;
  state: string | null;
  city: string | null;
}

// Round to 0.01° (~1km grid) for caching — avoids re-fetching while panning
// within the same area.
function gridKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

// BigDataCloud client-side endpoint — free, no API key, sub-100ms.
// Returns country, principalSubdivision (state), city, locality.
async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<LocationData> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return { country: null, state: null, city: null };
    const data = await res.json();
    return {
      country: data.countryName ?? null,
      state: data.principalSubdivision ?? null,
      city: data.city ?? data.locality ?? null,
    };
  } catch {
    return { country: null, state: null, city: null };
  }
}

export default function LocationPanel() {
  const [mounted, setMounted] = useState(false);
  const [location, setLocation] = useState<LocationData>({
    country: null,
    state: null,
    city: null,
  });
  const cacheRef = useRef<Map<string, LocationData>>(new Map());
  const lastKeyRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let disposed = false;

    function start() {
      if (disposed) return;
      const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
      if (!v || v.isDestroyed()) {
        setTimeout(start, 200);
        return;
      }

      const tick = () => {
        if (disposed || v.isDestroyed()) return;
        const carto = v.camera.positionCartographic;
        const lat = (carto.latitude * 180) / Math.PI;
        const lon = (carto.longitude * 180) / Math.PI;
        const key = gridKey(lat, lon);

        if (key === lastKeyRef.current) return;
        lastKeyRef.current = key;

        // Check cache first
        const cached = cacheRef.current.get(key);
        if (cached) {
          setLocation(cached);
          return;
        }

        // Debounce geocoding to 1s
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          if (disposed) return;
          const loc = await reverseGeocode(lat, lon);
          if (disposed) return;
          cacheRef.current.set(key, loc);
          // Cap cache at 500 entries
          if (cacheRef.current.size > 500) {
            const first = cacheRef.current.keys().next().value;
            if (first) cacheRef.current.delete(first);
          }
          setLocation(loc);
        }, 1000);
      };

      tick();
      const intervalId = setInterval(tick, 1000);
      return () => clearInterval(intervalId);
    }

    const cleanup = start();
    return () => {
      disposed = true;
      cleanup?.();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [mounted]);

  if (!mounted) return null;

  // Build display string: "CITY, STATE, COUNTRY" or fallbacks
  const parts = [location.city, location.state, location.country].filter(
    (p): p is string => !!p,
  );
  const display = parts.join(", ") || "—";

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: 12,
        zIndex: 60,
        fontFamily: "JetBrains Mono, monospace",
        color: "#00D4FF",
        fontSize: 10,
        lineHeight: 1.6,
        letterSpacing: 1,
        pointerEvents: "none",
        padding: "8px 10px",
        boxSizing: "border-box",
        maxWidth: 260,
      }}
    >
      <div style={{ fontSize: 8, letterSpacing: 1.5, marginBottom: 4, color: "#7ac4e0" }}>
        LOCATION
      </div>
      <div
        style={{
          color: "#e6e8eb",
          fontSize: 11,
          letterSpacing: 0.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {display}
      </div>
    </div>
  );
}
