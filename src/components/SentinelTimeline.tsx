"use client";

import { useGlobeStore } from "@/store/globe-store";

// Sentinel-2 imagery replay timeline. Back/forward buttons to step through
// historical Sentinel-2 satellite captures (monthly intervals).
// Positioned at bottom-center, aligned with 3D Tiles / Borders buttons.
export default function SentinelTimeline() {
  const enabled = useGlobeStore((s) => s.layerVisibility.sentinel ?? false);
  const date = useGlobeStore((s) => s.sentinelDate);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);
  const stepDate = useGlobeStore((s) => s.stepSentinelDate);

  if (!enabled) return null;

  const displayDate = date || new Date().toISOString().split("T")[0];
  // Format as full month name + year (e.g., "August 2026")
  const [year, month] = displayDate.split("-");
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = monthNames[parseInt(month, 10) - 1] || month;
  const formattedDate = `${monthName} ${year}`;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        color: "#5ab3d4",
        letterSpacing: 0.5,
        pointerEvents: "auto",
      }}
    >
      {/* Back button */}
      <button
        onClick={() => stepDate("back")}
        style={{
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 212, 255, 0.06)",
          border: "1px solid rgba(0, 212, 255, 0.2)",
          borderRadius: 4,
          color: "#5ab3d4",
          fontSize: 12,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(0, 212, 255, 0.06)";
        }}
        title="Previous month"
      >
        ‹
      </button>

      {/* Date display */}
      <div
        style={{
          background: "transparent",
          border: "1px solid rgba(0, 212, 255, 0.3)",
          borderRadius: 4,
          padding: "5px 14px",
          color: "#00D4FF",
          minWidth: 120,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 7, color: "#5ab3d4", marginBottom: 2, letterSpacing: 1 }}>
          SENTINEL-2 MONTHLY
        </div>
        <div style={{ fontSize: 11 }}>
          {formattedDate}
        </div>
      </div>

      {/* Forward button */}
      <button
        onClick={() => stepDate("forward")}
        style={{
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 212, 255, 0.06)",
          border: "1px solid rgba(0, 212, 255, 0.2)",
          borderRadius: 4,
          color: "#5ab3d4",
          fontSize: 12,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(0, 212, 255, 0.06)";
        }}
        title="Next month"
      >
        ›
      </button>

      {/* Close button */}
      <button
        onClick={() => toggleLayer("sentinel")}
        style={{
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255, 80, 80, 0.06)",
          border: "1px solid rgba(255, 80, 80, 0.4)",
          borderRadius: 4,
          color: "#ff5050",
          fontSize: 10,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255, 80, 80, 0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255, 80, 80, 0.06)";
        }}
        title="Close Sentinel replay"
      >
        ✕
      </button>
    </div>
  );
}
