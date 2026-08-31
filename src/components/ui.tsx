"use client";

import type { CSSProperties, ReactNode } from "react";

// Shared button base style. All buttons in the app use this for consistency.
const baseBtnStyle = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  background: active ? "var(--btn-bg-active)" : "var(--btn-bg)",
  border: `1px solid ${active ? "var(--btn-border-active)" : "var(--btn-border)"}`,
  borderRadius: "var(--btn-radius)",
  color: active ? "var(--accent)" : "var(--text-secondary)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  fontWeight: 500,
  letterSpacing: 1,
  cursor: "pointer",
  transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
  textShadow: active ? "0 0 8px rgba(255, 255, 255, 0.3)" : "none",
  width: "100%",
  whiteSpace: "nowrap",
  overflow: "hidden",
});

// Full-width toggle button: label centered in left area, ACTIVE/INACTIVE box pinned right.
interface ToggleButtonProps {
  label: string;
  active: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function ToggleButton({ label, active, loading, onClick }: ToggleButtonProps) {
  return (
    <button onClick={onClick} style={{ ...baseBtnStyle(active), padding: "7px 8px" }}>
      {/* Label: takes remaining space, centered */}
      <span
        style={{
          flex: 1,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label.toUpperCase()}
      </span>
      {/* Status box: pinned to the right, fixed width */}
      <span
        style={{
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 52,
          height: 16,
          borderRadius: 3,
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: 1,
          background: active ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
          border: `1px solid ${active ? "var(--accent)" : "rgba(255, 255, 255, 0.15)"}`,
          color: active ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {loading ? "LOADING" : active ? "ACTIVE" : "INACTIVE"}
      </span>
    </button>
  );
}

// Simple full-width button (no status box). Used for search, actions, etc.
interface ActionButtonProps {
  label: string;
  icon?: string;
  active?: boolean;
  onClick: () => void;
}

export function ActionButton({ label, icon, active = false, onClick }: ActionButtonProps) {
  return (
    <button onClick={onClick} style={{ ...baseBtnStyle(active), justifyContent: "center", gap: 6, padding: "7px 8px" }}>
      {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
      <span>{label.toUpperCase()}</span>
    </button>
  );
}

// Compact pill button for location hierarchy (continent/country/city).
interface PillButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function PillButton({ label, active, onClick }: PillButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        ...baseBtnStyle(active),
        width: "auto",
        padding: "4px 8px",
        fontSize: 8,
        borderRadius: 4,
        justifyContent: "center",
      }}
    >
      {label.toUpperCase()}
    </button>
  );
}

// Grid button for the 2x2 action grid (SAVE, FULL, 3D TILES, BORDERS).
interface GridButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
}

export function GridButton({ label, active = false, onClick }: GridButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        ...baseBtnStyle(active),
        width: "100%",
        padding: "8px 6px",
        fontSize: 9,
        fontWeight: 600,
        justifyContent: "center",
      }}
    >
      {label.toUpperCase()}
    </button>
  );
}

// Section header label (AVIATION, LOCATION, ACTIONS, etc.)
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: 2,
        color: "var(--text-dim)",
        fontFamily: "var(--font-mono)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
