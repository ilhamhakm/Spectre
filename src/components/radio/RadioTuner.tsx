"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRadioStore } from "@/globe/radio/radio-store";
import {
  buildRadioTunerTicks,
  radioTunerPointerPosition,
  radioTunerCommitSlot,
} from "@/globe/radio/radio-tuner";
import { filterRadioStations } from "@/globe/radio/radio-categories";
import { rankRadioStationsForViewport } from "@/globe/radio/radio-cluster";
import { selectAndPlayStation } from "@/globe/radio/radio-engine";
import { setRadioTuningStatic } from "@/globe/radio/radio-playback";
import type { RadioStation } from "@/globe/radio/radio-types";

const DIAL_WIDTH = 208;
const INSET_PX = 7;

/**
 * Analog tuner: drag the needle across the ranked station band. Each position
 * snaps to a real station; on release the globe flies to the broadcaster and
 * playback begins. WebAudio static plays while the needle is between stations.
 * Faithful port of GEV's tuner interaction (src/ui.js radio tuner handlers).
 */
export default function RadioTuner() {
  const stations = useRadioStore((s) => s.stations);
  const filter = useRadioStore((s) => s.filter);
  const selectedId = useRadioStore((s) => s.selectedId);
  const dialRef = useRef<HTMLDivElement>(null);
  const [coordinate, setCoordinate] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(false);

  // Ranked band: viewport-distance-ordered, capped at 750.
  const band: RadioStation[] = filterRadioStations(stations, filter);

  // Keep the coordinate aligned with the selected station when not dragging.
  useEffect(() => {
    if (dragRef.current || !band.length) return;
    const idx = selectedId
      ? band.findIndex((s) => s.id === selectedId)
      : -1;
    setCoordinate(idx >= 0 ? idx : 0);
  }, [selectedId, band]);

  const beginTuning = useCallback(() => {
    dragRef.current = true;
    setDragging(true);
    setRadioTuningStatic(true);
  }, []);

  const endTuning = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = false;
    setDragging(false);
    setRadioTuningStatic(false);
    const slot = radioTunerCommitSlot(coordinate, band.length);
    if (slot.stationIndex >= 0) {
      void selectAndPlayStation(band[slot.stationIndex].id, {
        focus: true,
        autoplay: true,
      });
    }
  }, [coordinate, band]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!band.length) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      beginTuning();
      const rect = dialRef.current?.getBoundingClientRect();
      if (rect) {
        const p = radioTunerPointerPosition(
          e.clientX,
          rect.left,
          rect.width,
          band.length,
          INSET_PX,
        );
        setCoordinate(p.coordinate);
      }
    },
    [band, beginTuning],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const rect = dialRef.current?.getBoundingClientRect();
      if (!rect) return;
      const p = radioTunerPointerPosition(
        e.clientX,
        rect.left,
        rect.width,
        band.length,
        INSET_PX,
      );
      setCoordinate(p.coordinate);
    },
    [band],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (!band.length) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (!dragRef.current) beginTuning();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        setCoordinate((c) =>
          Math.min(band.length - 1, Math.max(0, c + dir)),
        );
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        endTuning();
      }
    },
    [band, beginTuning, endTuning],
  );

  useEffect(() => {
    if (!dragging) return;
    const onUp = () => endTuning();
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [dragging, endTuning]);

  const ticks = buildRadioTunerTicks(coordinate, band.length, DIAL_WIDTH, {
    insetPx: INSET_PX,
  });
  const currentStation =
    band[Math.min(band.length - 1, Math.max(0, Math.floor(coordinate + 0.5)))];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontSize: 8,
          letterSpacing: 2,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
        }}
      >
        TUNER {band.length ? `(${band.length} STATIONS)` : ""}
      </div>
      <div
        ref={dialRef}
        role="slider"
        tabIndex={0}
        aria-valuenow={Math.round(coordinate)}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, band.length - 1)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKey}
        style={{
          position: "relative",
          width: DIAL_WIDTH,
          height: 44,
          background: "rgba(0,0,0,0.5)",
          border: "1px solid var(--btn-border)",
          borderRadius: 6,
          cursor: band.length ? "ew-resize" : "default",
          userSelect: "none",
          touchAction: "none",
          outline: "none",
          overflow: "hidden",
        }}
      >
        {/* Tick marks */}
        {ticks.ticks.map((t) => (
          <div
            key={t.stationIndex}
            style={{
              position: "absolute",
              left: t.xPx,
              bottom: 4,
              width: 1,
              height: t.current ? 22 : t.label ? 16 : 8,
              background: t.current
                ? "var(--accent)"
                : "rgba(255,255,255,0.4)",
            }}
          >
            {t.label && (
              <span
                style={{
                  position: "absolute",
                  bottom: t.current ? 24 : 18,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 7,
                  color: t.current ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </span>
            )}
          </div>
        ))}
        {/* Needle */}
        {band.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: ticks.needleX,
              top: 2,
              bottom: 2,
              width: 2,
              background: "var(--accent)",
              boxShadow: "0 0 6px rgba(255,255,255,0.6)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)",
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minHeight: 12,
        }}
      >
        {currentStation ? currentStation.name : "NO STATIONS"}
      </div>
    </div>
  );
}
