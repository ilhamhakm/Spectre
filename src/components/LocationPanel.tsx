"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";

interface LocationData {
  country: string | null;
  state: string | null;
  city: string | null;
}

function gridKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

async function reverseGeocode(lat: number, lon: number): Promise<LocationData> {
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

function estimateTimezoneOffset(lon: number): number {
  return Math.round(lon / 15);
}

export default function LocationPanel() {
  const [mounted, setMounted] = useState(false);
  const [location, setLocation] = useState<LocationData>({
    country: null,
    state: null,
    city: null,
  });
  const [time, setTime] = useState("");
  const [dateTz, setDateTz] = useState("");
  const cacheRef = useRef<Map<string, LocationData>>(new Map());
  const lastKeyRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Location tracking
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

        const cached = cacheRef.current.get(key);
        if (cached) {
          setLocation(cached);
          return;
        }

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          if (disposed) return;
          const loc = await reverseGeocode(lat, lon);
          if (disposed) return;
          cacheRef.current.set(key, loc);
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

  // Time tracking (updates every second, timezone from camera longitude)
  useEffect(() => {
    let disposed = false;

    function start() {
      if (disposed) return;
      const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
      if (!v || v.isDestroyed()) {
        setTimeout(start, 200);
        return;
      }

      const update = () => {
        if (disposed || v.isDestroyed()) return;
        const carto = v.camera.positionCartographic;
        const lon = (carto.longitude * 180) / Math.PI;
        const tzOffset = estimateTimezoneOffset(lon);
        const now = new Date();
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
        const localMs = utcMs + tzOffset * 3600000;
        const local = new Date(localMs);

        const hh = String(local.getHours()).padStart(2, "0");
        const mm = String(local.getMinutes()).padStart(2, "0");
        const ss = String(local.getSeconds()).padStart(2, "0");
        setTime(`${hh}:${mm}:${ss}`);

        const yyyy = local.getFullYear();
        const mo = String(local.getMonth() + 1).padStart(2, "0");
        const dd = String(local.getDate()).padStart(2, "0");
        const tzSign = tzOffset >= 0 ? "+" : "";
        setDateTz(`${yyyy}-${mo}-${dd} UTC${tzSign}${tzOffset}`);
      };

      update();
      const intervalId = setInterval(update, 1000);
      return () => clearInterval(intervalId);
    }

    const cleanup = start();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [mounted]);

  if (!mounted) return null;

  const parts = [location.city, location.state, location.country].filter(
    (p): p is string => !!p,
  );
  const display = parts.join(", ") || "...";

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: 12,
        zIndex: 60,
        fontFamily: "JetBrains Mono, monospace",
        color: "#ffffff",
        fontSize: 10,
        lineHeight: 1.6,
        letterSpacing: 1,
        pointerEvents: "none",
        padding: "8px 10px",
        boxSizing: "border-box",
        maxWidth: 260,
      }}
    >
      <div style={{ fontSize: 8, letterSpacing: 1.5, marginBottom: 4, color: "rgba(255,255,255,0.4)" }}>
        LOCATION
      </div>
      <div
        style={{
          color: "#ffffff",
          fontSize: 11,
          letterSpacing: 0.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {display}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>
        {time}
      </div>
      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>
        {dateTz}
      </div>
    </div>
  );
}
