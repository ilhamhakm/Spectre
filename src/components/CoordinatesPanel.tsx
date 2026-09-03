"use client";

import { useEffect, useState } from "react";
import * as Cesium from "cesium";

function fmtLat(value: number): string {
  const dir = value >= 0 ? "N" : "S";
  return `${Math.abs(value).toFixed(4)}\u00B0${dir}`;
}

function fmtLon(value: number): string {
  const dir = value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(4)}\u00B0${dir}`;
}

export default function CoordinatesPanel() {
  const [mounted, setMounted] = useState(false);
  const [camera, setCamera] = useState({
    lat: -6.1754,
    lon: 106.8272,
    alt: 30000,
    heading: 0,
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let disposed = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

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
        const terrainHeight = v.scene.globe?.getHeight(carto) ?? 0;
        setCamera({
          lat: (carto.latitude * 180) / Math.PI,
          lon: (carto.longitude * 180) / Math.PI,
          alt: carto.height - terrainHeight,
          heading: (v.camera.heading * 180) / Math.PI,
        });
      };
      tick();
      intervalId = setInterval(tick, 500);
    }
    start();

    return () => {
      disposed = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [mounted]);

  function copyCoords() {
    const text = `${camera.lat.toFixed(6)}, ${camera.lon.toFixed(6)}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  }

  if (!mounted) return null;

  return (
    <div
      onClick={copyCoords}
      title={copied ? "Copied" : "Click to copy"}
      style={{
        position: "absolute",
        bottom: 24,
        right: 12,
        zIndex: 60,
        fontFamily: "JetBrains Mono, monospace",
        color: "#ffffff",
        fontSize: 10,
        lineHeight: 1.6,
        letterSpacing: 1,
        pointerEvents: "auto",
        cursor: "pointer",
        padding: "8px 10px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        textAlign: "right",
      }}
    >
      <div style={{ fontSize: 8, letterSpacing: 1.5, marginBottom: 4, color: "rgba(255,255,255,0.4)" }}>
        {copied && "\u2713 COPIED"}
      </div>
      <div style={{ display: "flex", gap: 12, whiteSpace: "nowrap" }}>
        <span>LAT {fmtLat(camera.lat)}</span>
        <span>LON {fmtLon(camera.lon)}</span>
      </div>
      <div style={{ display: "flex", gap: 12, whiteSpace: "nowrap" }}>
        <span>ALT {Math.round(camera.alt).toLocaleString()}m</span>
        <span>HDG {camera.heading.toFixed(0)}{"\u00B0"}</span>
      </div>
    </div>
  );
}
