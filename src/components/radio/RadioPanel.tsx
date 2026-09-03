"use client";

import { useRadioStore, selectSelectedStation } from "@/globe/radio/radio-store";
import {
  radioCategoryColor,
  radioStationCategoryId,
} from "@/globe/radio/radio-categories";
import { radioEngine } from "@/globe/radio/radio-engine";
import {
  ensureRadioAudio,
  playSelectedRadio,
  pauseRadioPlayback,
  setRadioVolume,
} from "@/globe/radio/radio-playback";
import { useGlobeStore } from "@/store/globe-store";
import { ActionButton } from "@/components/ui";
import RadioTuner from "./RadioTuner";
import type { RadioCategoryId } from "@/globe/radio/radio-types";

/**
 * RightPanel compliment for the radio layer: category filter chips, the analog
 * tuner, and a now-playing card with playback controls. Station tags are drawn
 * on the globe by RadioOverlay, not listed here.
 */
export default function RadioPanel() {
  const stations = useRadioStore((s) => s.stations);
  const categories = useRadioStore((s) => s.categories);
  const filter = useRadioStore((s) => s.filter);
  const selected = useRadioStore(selectSelectedStation);
  const audioState = useRadioStore((s) => s.audioState);
  const audioError = useRadioStore((s) => s.audioError);
  const volume = useRadioStore((s) => s.volume);
  const loading = useRadioStore((s) => s.loading);
  const error = useRadioStore((s) => s.error);
  const stale = useRadioStore((s) => s.stale);
  const degraded = useRadioStore((s) => s.degraded);
  const updatedAt = useRadioStore((s) => s.updatedAt);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);

  const onPlayPause = () => {
    if (!selected) return;
    ensureRadioAudio();
    if (["loading", "playing", "buffering"].includes(audioState)) {
      pauseRadioPlayback();
    } else {
      void playSelectedRadio(selected);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 16px" }}>
      {/* Header */}
      <div
        style={{
          padding: "8px 10px",
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 8, color: "var(--text-dim)", marginBottom: 4 }}>LAYER</div>
        <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
          RADIO
        </div>
        <div style={{ fontSize: 9, color: "var(--text-secondary)", marginTop: 4 }}>
          {error ? (
            <span style={{ color: "#FF5252" }}>ERROR: {error}</span>
          ) : loading ? (
            "Loading stations..."
          ) : (
            `${stations.length} stations${degraded ? " (degraded)" : ""}${stale ? " (stale)" : ""}`
          )}
        </div>
        {updatedAt && (
          <div style={{ fontSize: 7, color: "var(--text-dim)", marginTop: 2 }}>
            UPDATED {new Date(updatedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Category filter chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {categories.slice(0, 12).map((cat) => {
          const active = filter === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => radioEngine.setFilter(cat.id as RadioCategoryId)}
              style={{
                padding: "3px 6px",
                fontSize: 8,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                letterSpacing: 0.5,
                cursor: "pointer",
                borderRadius: 4,
                border: `1px solid ${active ? cat.color : "rgba(255,255,255,0.12)"}`,
                background: active ? `${cat.color}22` : "rgba(255,255,255,0.04)",
                color: active ? cat.color : "var(--text-secondary)",
              }}
            >
              {cat.label.toUpperCase()} {cat.count}
            </button>
          );
        })}
      </div>

      {/* Tuner */}
      <RadioTuner />

      {/* Now playing */}
      {selected && (
        <div
          style={{
            padding: "10px",
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${radioCategoryColor(radioStationCategoryId(selected))}55`,
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: radioCategoryColor(radioStationCategoryId(selected)),
                flexShrink: 0,
                boxShadow:
                  audioState === "playing"
                    ? "0 0 8px currentColor"
                    : "none",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-bright)",
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selected.name}
              </div>
              <div style={{ fontSize: 8, color: "var(--text-dim)" }}>
                {selected.country}
                {selected.bitrate ? ` - ${selected.bitrate}kbps` : ""}
                {selected.codec ? ` ${selected.codec}` : ""}
              </div>
            </div>
          </div>
          {audioError && (
            <div style={{ fontSize: 8, color: "#FF5252", fontFamily: "var(--font-mono)" }}>
              {audioError}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => radioEngine.cycleStation(-1)}
              style={ctrlBtnStyle}
            >
              PREV
            </button>
            <button
              onClick={onPlayPause}
              style={{ ...ctrlBtnStyle, flex: 2, color: "var(--accent)" }}
            >
              {audioState === "playing" ? "PAUSE" : audioState === "loading" ? "..." : "PLAY"}
            </button>
            <button
              onClick={() => radioEngine.cycleStation(1)}
              style={ctrlBtnStyle}
            >
              NEXT
            </button>
          </div>
          {/* Volume */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 7, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              VOL
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setRadioVolume(Number(e.target.value))}
              style={{ flex: 1, accentColor: "var(--accent)" }}
            />
            <span style={{ fontSize: 7, color: "var(--text-dim)", fontFamily: "var(--font-mono)", width: 24, textAlign: "right" }}>
              {Math.round(volume * 100)}
            </span>
          </div>
        </div>
      )}

      <ActionButton label="Turn Off" onClick={() => toggleLayer("radio")} />
    </div>
  );
}

const ctrlBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 4px",
  background: "var(--btn-bg)",
  border: "1px solid var(--btn-border)",
  color: "var(--text-secondary)",
  fontSize: 8,
  fontFamily: "var(--font-mono)",
  fontWeight: 600,
  letterSpacing: 1,
  cursor: "pointer",
  borderRadius: 4,
};