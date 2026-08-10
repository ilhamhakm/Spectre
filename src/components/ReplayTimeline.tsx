"use client";

import { useGlobeStore } from "@/store/globe-store";

// Replay timeline for GIBS and Sentinel-2 imagery.
//
// Both layers use the SAME 4-button nav layout (no auto-play):
//   << = monthly back     < = weekly back
//   >  = weekly forward   >> = monthly forward
//
// GIBS (planetary / big-picture): weekly + monthly stepping.
//   Used for watching ice sheet melt, deforestation, large earth changes.
//
// Sentinel-2 (close-up / specific tracking): weekly + monthly stepping.
//   Used for tracking construction, stadium builds, specific site changes.
//
// Positioned at bottom-center. Shows whichever replay layer is active.
// When both are off, renders nothing.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatTodayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthYear(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1] || month;
  return `${monthName} ${year}`;
}

function formatFullDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1] || month;
  return `${monthName} ${parseInt(day, 10) || day}, ${year}`;
}

export default function ReplayTimeline() {
  const sentinelOn = useGlobeStore((s) => s.layerVisibility.sentinel ?? false);
  const gibsOn = useGlobeStore((s) => s.layerVisibility.gibs ?? false);
  const sentinelDate = useGlobeStore((s) => s.sentinelDate);
  const gibsDate = useGlobeStore((s) => s.gibsDate);
  const sentinelGranularity = useGlobeStore((s) => s.sentinelGranularity);
  const gibsGranularity = useGlobeStore((s) => s.gibsGranularity);
  const stepSentinelDate = useGlobeStore((s) => s.stepSentinelDate);
  const stepGibsDate = useGlobeStore((s) => s.stepGibsDate);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);

  if (!sentinelOn && !gibsOn) return null;

  const isGibs = gibsOn;
  const currentDate = isGibs
    ? gibsDate || formatTodayLocal()
    : sentinelDate || formatTodayLocal();
  const layerId = isGibs ? "gibs" : "sentinel";

  // Label and date format depend on layer and granularity
  const label = isGibs
    ? gibsGranularity === "weekly"
      ? "GIBS WEEKLY"
      : "GIBS MONTHLY"
    : sentinelGranularity === "weekly"
      ? "SENTINEL-2 WEEKLY"
      : "SENTINEL-2 MONTHLY";

  const formattedDate = isGibs
    ? gibsGranularity === "weekly"
      ? formatFullDate(currentDate)
      : formatMonthYear(currentDate)
    : sentinelGranularity === "weekly"
      ? formatFullDate(currentDate)
      : formatMonthYear(currentDate);

  const btnStyle = (color: "cyan" | "red") => ({
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      color === "cyan"
        ? "rgba(0, 212, 255, 0.06)"
        : "rgba(255, 80, 80, 0.06)",
    border: `1px solid ${
      color === "cyan"
        ? "rgba(0, 212, 255, 0.4)"
        : "rgba(255, 80, 80, 0.4)"
    }`,
    borderRadius: 4,
    color: color === "red" ? "#ff5050" : "#00D4FF",
    fontSize: 12,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  });

  // Small button for weekly step (< >)
  const weeklyBtn = (dir: "back" | "forward") => (
    <button
      data-testid={`sentinel-weekly-${dir}`}
      onClick={() => stepSentinelDate(dir, "weekly")}
      style={btnStyle("cyan")}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.06)"; }}
      title={dir === "back" ? "Previous week" : "Next week"}
    >
      {dir === "back" ? "\u2039" : "\u203a"}
    </button>
  );

  // Wide button for monthly step (<< >>)
  const monthlyBtn = (dir: "back" | "forward") => (
    <button
      data-testid={`sentinel-monthly-${dir}`}
      onClick={() => stepSentinelDate(dir, "monthly")}
      style={{ ...btnStyle("cyan"), width: 32, fontSize: 10 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.06)"; }}
      title={dir === "back" ? "Previous month" : "Next month"}
    >
      {dir === "back" ? "\u00ab" : "\u00bb"}
    </button>
  );

  // GIBS wide button for monthly step (<< >>)
  const gibsMonthlyBtn = (dir: "back" | "forward") => (
    <button
      data-testid={`gibs-monthly-${dir}`}
      onClick={() => stepGibsDate(dir, "monthly")}
      style={{ ...btnStyle("cyan"), width: 32, fontSize: 10 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.06)"; }}
      title={dir === "back" ? "Previous month" : "Next month"}
    >
      {dir === "back" ? "\u00ab" : "\u00bb"}
    </button>
  );

  // GIBS small button for weekly step (< >)
  const gibsWeeklyBtn = (dir: "back" | "forward") => (
    <button
      data-testid={`gibs-weekly-${dir}`}
      onClick={() => stepGibsDate(dir, "weekly")}
      style={btnStyle("cyan")}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 212, 255, 0.06)"; }}
      title={dir === "back" ? "Previous week" : "Next week"}
    >
      {dir === "back" ? "\u2039" : "\u203a"}
    </button>
  );

  return (
    <div
      data-testid="replay-timeline"
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        color: "#5ab3d4",
        letterSpacing: 0.5,
        pointerEvents: "auto",
      }}
    >
      {isGibs ? (
        <>
          {gibsMonthlyBtn("back")}
          {gibsWeeklyBtn("back")}

          <div
            style={{
              background: "transparent",
              border: "1px solid rgba(0, 212, 255, 0.3)",
              borderRadius: 4,
              padding: "5px 14px",
              color: "#00D4FF",
              minWidth: 130,
              textAlign: "center",
              margin: "0 4px",
            }}
          >
            <div style={{ fontSize: 7, color: "#5ab3d4", marginBottom: 2, letterSpacing: 1 }}>
              {label}
            </div>
            <div style={{ fontSize: 11 }}>
              {formattedDate}
            </div>
          </div>

          {gibsWeeklyBtn("forward")}
          {gibsMonthlyBtn("forward")}
        </>
      ) : (
        <>
          {monthlyBtn("back")}
          {weeklyBtn("back")}

          <div
            style={{
              background: "transparent",
              border: "1px solid rgba(0, 212, 255, 0.3)",
              borderRadius: 4,
              padding: "5px 14px",
              color: "#00D4FF",
              minWidth: 130,
              textAlign: "center",
              margin: "0 4px",
            }}
          >
            <div style={{ fontSize: 7, color: "#5ab3d4", marginBottom: 2, letterSpacing: 1 }}>
              {label}
            </div>
            <div style={{ fontSize: 11 }}>
              {formattedDate}
            </div>
          </div>

          {weeklyBtn("forward")}
          {monthlyBtn("forward")}
        </>
      )}

      <button
        onClick={() => toggleLayer(layerId)}
        style={{ ...btnStyle("red"), marginLeft: 4 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255, 80, 80, 0.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255, 80, 80, 0.06)"; }}
        title={`Close ${isGibs ? "GIBS" : "Sentinel"} replay`}
      >
        {"\u2715"}
      </button>
    </div>
  );
}
