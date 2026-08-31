"use client";

import { useEffect, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";

function estimateTimezoneOffset(lon: number): number {
  return Math.round(lon / 15);
}

function formatTime(date: Date, tzOffset: number): { time: string; date: string; tz: string } {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const localMs = utcMs + tzOffset * 3600000;
  const local = new Date(localMs);

  const hh = String(local.getHours()).padStart(2, "0");
  const mm = String(local.getMinutes()).padStart(2, "0");
  const ss = String(local.getSeconds()).padStart(2, "0");
  const time = `${hh}:${mm}:${ss}`;

  const yyyy = local.getFullYear();
  const mo = String(local.getMonth() + 1).padStart(2, "0");
  const dd = String(local.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mo}-${dd}`;

  const tzSign = tzOffset >= 0 ? "+" : "";
  const tz = `UTC${tzSign}${tzOffset}`;

  return { time, date: dateStr, tz };
}

export default function LocalTime() {
  const cameraCoords = useGlobeStore((s) => s.cameraCoords);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const tzOffset = estimateTimezoneOffset(cameraCoords.lon);
  const { time, date, tz } = formatTime(now, tzOffset);

  return (
    <div style={{ paddingTop: 10 }}>
      <div
        style={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: 2,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          marginBottom: 4,
        }}
      >
        LOCAL TIME
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--accent)",
          fontFamily: "var(--font-mono)",
          letterSpacing: 1,
        }}
      >
        {time}
      </div>
      <div
        style={{
          fontSize: 8,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          marginTop: 2,
        }}
      >
        {date} {tz}
      </div>
    </div>
  );
}
