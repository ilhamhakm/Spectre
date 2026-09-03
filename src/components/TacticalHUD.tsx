"use client";

import { useState } from "react";
import { useGlobeStore, type LayerId } from "@/store/globe-store";
import { ToggleButton, ActionButton } from "@/components/ui";

interface LayerDef {
  id: LayerId;
  label: string;
}

interface LayerGroup {
  name: string;
  layers: LayerDef[];
  defaultOpen?: boolean;
}

const LAYER_GROUPS: LayerGroup[] = [
  {
    name: "AVIATION",
    defaultOpen: true,
    layers: [
      { id: "commercial-flights", label: "Commercial Flights" },
      { id: "private-flights", label: "Private Flights" },
      { id: "military-flights", label: "Military Flights" },
      { id: "satellites", label: "Satellites" },
    ],
  },
  {
    name: "INFRASTRUCTURE",
    layers: [
      { id: "dams", label: "Dams" },
      { id: "earthquakes", label: "Earthquakes" },
      { id: "data-centers", label: "Data Centers" },
    ],
  },
  {
    name: "INTEL",
    defaultOpen: true,
    layers: [
      { id: "civil-unrest", label: "Civil Unrest" },
      { id: "radio", label: "Radio" },
    ],
  },
  {
    name: "GROUND",
    defaultOpen: true,
    layers: [
      { id: "traffic", label: "Traffic" },
      { id: "cctv", label: "CCTV Mesh" },
      { id: "3d-buildings", label: "3D Buildings" },
    ],
  },
  {
    name: "IMAGERY",
    defaultOpen: true,
    layers: [
      { id: "big-changes-replay", label: "Big Changes" },
      { id: "construction-replay", label: "Construction" },
    ],
  },
];

function LayerButton({ def }: { def: LayerDef }) {
  const isVisible = useGlobeStore((s) => s.layerVisibility[def.id]);
  const isLoading = useGlobeStore((s) => s.layerLoading[def.id]);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);

  return (
    <ToggleButton
      label={def.label}
      active={isVisible}
      loading={isLoading}
      onClick={() => toggleLayer(def.id)}
    />
  );
}

// Building Highlights is not a LayerId: it gates a hover tint + click-to-panel
// on the existing OSM Buildings tileset. It requires 3D Buildings to be
// visible first; toggling it on without 3D Buildings shows a toast instead.
function BuildingHighlightButton() {
  const bldgHighlight = useGlobeStore((s) => s.bldgHighlight);
  const toggleBldgHighlight = useGlobeStore((s) => s.toggleBldgHighlight);
  const buildingsVisible = useGlobeStore((s) => s.layerVisibility["3d-buildings"]);
  const showToast = useGlobeStore((s) => s.showToast);

  return (
    <ToggleButton
      label="Building Highlights"
      active={bldgHighlight}
      onClick={() => {
        if (!bldgHighlight && !buildingsVisible) {
          showToast("Enable 3D Buildings first");
          return;
        }
        toggleBldgHighlight();
      }}
    />
  );
}

function CollapsibleGroup({ group }: { group: LayerGroup }) {
  const [open, setOpen] = useState(!!group.defaultOpen);
  const layerVisibility = useGlobeStore((s) => s.layerVisibility);
  const hasActive = group.layers.some((l) => layerVisibility[l.id]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "5px 0",
          background: "transparent",
          border: "none",
          color: hasActive ? "var(--accent)" : "var(--text-dim)",
          fontSize: 8,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          letterSpacing: 2,
          cursor: "pointer",
          textShadow: hasActive ? "0 0 8px rgba(255, 255, 255, 0.3)" : "none",
          transition: "color 150ms ease",
        }}
      >
        <span>{group.name}</span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? "\u25BC" : "\u25B6"}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {group.layers.map((layer) => (
            <LayerButton key={layer.id} def={layer} />
          ))}
          {group.name === "GROUND" && <BuildingHighlightButton />}
        </div>
      )}
    </div>
  );
}

export default function TacticalHUD() {
  const setSearchOpen = useGlobeStore((s) => s.setSearchOpen);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 240,
        height: "100vh",
        background: "transparent",
        borderRight: "none",
        display: "flex",
        flexDirection: "column",
        zIndex: 60,
      }}
    >
      {/* Header: SPECTRE logo */}
      <div
        style={{
          padding: "16px 16px 12px",
        }}
      >
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: 3,
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
            textShadow: "0 0 12px rgba(255, 255, 255, 0.3)",
          }}
        >
          SPECTRE
        </span>
      </div>

      {/* Search button */}
      <div style={{ padding: "0 16px 12px" }}>
        <ActionButton
          label="Search Location"
          onClick={() => setSearchOpen(true)}
        />
      </div>

      {/* Layer groups - no scroll, collapsible */}
      <div
        style={{
          flex: 1,
          padding: "0 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          overflow: "hidden",
        }}
      >
        {LAYER_GROUPS.map((group) => (
          <CollapsibleGroup key={group.name} group={group} />
        ))}
      </div>
    </div>
  );
}
