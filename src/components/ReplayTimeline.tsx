"use client";

import { useCallback } from "react";
import { useGlobeStore } from "@/store/globe-store";

/**
 * Bottom-of-screen timeline scrubber for GIBS replay layers.
 *
 * Appears when a replay layer is active (replayActiveLayer !== null).
 * Controls:
 *   <<  = back 1 month
 *   <   = back 1 week
 *   PLAY/PAUSE = toggle playback (defaults to 1 day/sec)
 *   >   = forward 1 week
 *   >>  = forward 1 month
 *
 * Plus a scrubber slider for arbitrary date jumps, a speed selector,
 * a loading spinner (shown while GIBS tiles are fetching), and a
 * close button.
 */
export default function ReplayTimeline() {
  const activeLayer = useGlobeStore((s) => s.replayActiveLayer);
  const replayDate = useGlobeStore((s) => s.replayDate);
  const replayStart = useGlobeStore((s) => s.replayStart);
  const replayEnd = useGlobeStore((s) => s.replayEnd);
  const playing = useGlobeStore((s) => s.replayPlaying);
  const speed = useGlobeStore((s) => s.replaySpeed);
  const loading = useGlobeStore((s) => s.replayLoading);
  const setReplayDate = useGlobeStore((s) => s.setReplayDate);
  const setReplayPlaying = useGlobeStore((s) => s.setReplayPlaying);
  const setReplaySpeed = useGlobeStore((s) => s.setReplaySpeed);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);

  const handleClose = useCallback(() => {
    if (activeLayer) {
      toggleLayer(activeLayer);
    }
  }, [activeLayer, toggleLayer]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const daysFromStart = parseInt(e.target.value, 10);
      const start = new Date(replayStart + "T00:00:00Z");
      start.setUTCDate(start.getUTCDate() + daysFromStart);
      setReplayDate(start.toISOString().split("T")[0]);
    },
    [replayStart, setReplayDate],
  );

  /** Shift the replay date by a number of days, clamped to the range. */
  const shiftDate = useCallback(
    (days: number) => {
      const current = new Date(replayDate + "T00:00:00Z");
      current.setUTCDate(current.getUTCDate() + days);
      let next = current.toISOString().split("T")[0];
      // Clamp to [replayStart, replayEnd].
      if (next < replayStart) next = replayStart;
      if (next > replayEnd) next = replayEnd;
      if (next !== replayDate) {
        setReplayDate(next);
      }
    },
    [replayDate, replayStart, replayEnd, setReplayDate],
  );

  const handleSpeedCycle = useCallback(() => {
    const speeds = [1, 7, 30, 90];
    const idx = speeds.indexOf(speed);
    const next = speeds[(idx + 1) % speeds.length];
    setReplaySpeed(next);
  }, [speed, setReplaySpeed]);

  if (!activeLayer) return null;

  // Compute slider range: days from start to end.
  const startMs = new Date(replayStart + "T00:00:00Z").getTime();
  const endMs = new Date(replayEnd + "T00:00:00Z").getTime();
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
  const currentMs = new Date(replayDate + "T00:00:00Z").getTime();
  const currentDay = Math.max(
    0,
    Math.min(totalDays, Math.round((currentMs - startMs) / 86_400_000)),
  );

  const layerLabel =
    activeLayer === "big-changes-replay" ? "BIG CHANGES" : "CONSTRUCTION";

  const speedLabel =
    speed === 1 ? "1d/s" : speed === 7 ? "1w/s" : speed === 30 ? "1mo/s" : `${speed}d/s`;

  // Shared style for the step buttons.
  const stepBtnStyle: React.CSSProperties = {
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: 4,
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 600,
    width: 28,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-mono)",
    transition: "all 150ms ease",
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        background: "rgba(10, 10, 15, 0.85)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 10,
        backdropFilter: "blur(8px)",
        zIndex: 55,
        fontFamily: "var(--font-mono)",
        color: "var(--text-primary)",
        userSelect: "none",
      }}
    >
      {/* Layer label */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 2,
          color: "var(--accent)",
          textShadow: "0 0 8px rgba(255, 255, 255, 0.3)",
          minWidth: 90,
        }}
      >
        {layerLabel}
      </span>

      {/* Step controls: << < PLAY > >> */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* << back 1 month */}
        <button
          onClick={() => shiftDate(-30)}
          style={stepBtnStyle}
          title="Back 1 month"
        >
          {"\u00AB"}
        </button>

        {/* < back 1 week */}
        <button
          onClick={() => shiftDate(-7)}
          style={stepBtnStyle}
          title="Back 1 week"
        >
          {"\u2039"}
        </button>

        {/* PLAY / PAUSE */}
        <button
          onClick={() => setReplayPlaying(!playing)}
          style={{
            ...stepBtnStyle,
            width: 36,
            background: playing
              ? "rgba(255, 255, 255, 0.15)"
              : "rgba(255, 255, 255, 0.06)",
            border: `1px solid ${playing ? "var(--accent)" : "rgba(255, 255, 255, 0.15)"}`,
            color: playing ? "var(--accent)" : "var(--text-secondary)",
          }}
          title={playing ? "Pause" : "Play (1 step/sec)"}
        >
          {playing ? "\u23F8" : "\u25B6"}
        </button>

        {/* > forward 1 week */}
        <button
          onClick={() => shiftDate(7)}
          style={stepBtnStyle}
          title="Forward 1 week"
        >
          {"\u203A"}
        </button>

        {/* >> forward 1 month */}
        <button
          onClick={() => shiftDate(30)}
          style={stepBtnStyle}
          title="Forward 1 month"
        >
          {"\u00BB"}
        </button>
      </div>

      {/* Loading indicator: spinner + "LOADING" text */}
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            background: "rgba(255, 255, 255, 0.08)",
            borderRadius: 4,
            border: "1px solid rgba(255, 255, 255, 0.15)",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              border: "2px solid rgba(255, 255, 255, 0.2)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 1.5,
              color: "var(--accent)",
              fontFamily: "var(--font-mono)",
            }}
          >
            LOADING
          </span>
        </div>
      )}

      {/* Date display */}
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: 1,
          color: loading ? "var(--text-dim)" : "var(--text-primary)",
          minWidth: 80,
          textAlign: "center",
        }}
      >
        {replayDate}
      </span>

      {/* Scrubber slider */}
      <input
        type="range"
        min={0}
        max={totalDays}
        value={currentDay}
        onChange={handleScrub}
        style={{
          width: 200,
          accentColor: "#ffffff",
          cursor: "pointer",
        }}
      />

      {/* Speed selector */}
      <button
        onClick={handleSpeedCycle}
        style={{
          background: "rgba(255, 255, 255, 0.06)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 4,
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 1,
          padding: "4px 8px",
          fontFamily: "var(--font-mono)",
          minWidth: 48,
        }}
        title="Playback speed (days per second)"
      >
        {speedLabel}
      </button>

      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          background: "transparent",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 4,
          color: "var(--text-dim)",
          cursor: "pointer",
          fontSize: 10,
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
        }}
        title="Close replay layer"
      >
        {"\u2715"}
      </button>
    </div>
  );
}
