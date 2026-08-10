"use client";

import { useEffect, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";

// Circular view mask — renders a glass overlay with a circular cutout.
// Inside the circle: globe is clear (no overlay). Outside the circle:
// blurred glass (same as side panels — transparent + backdrop-filter blur).
//
// The circle is centered at the page center. Its diameter = the gap between
// the left and right panel inner edges, so the circle spans the full width
// between panels. Since this diameter is typically larger than the viewport
// height, the top and bottom of the circle are clipped by the viewport.

const LEFT_PANEL_WIDTH = 240;  // TacticalHUD sidebar (when open)
const RIGHT_PANEL_WIDTH = 240; // CityBookmarks panel (when open)

export default function CircleMask() {
  const leftPanelOpen = useGlobeStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useGlobeStore((s) => s.rightPanelOpen);

  // Start at 0×0 — we don't know the viewport size on the server. Reading
  // window.innerWidth in the useState initializer causes a hydration
  // mismatch (SSR uses defaults, client uses actual), and React then
  // refuses to patch the DOM — leaving the wrong-sized ring stuck in place
  // (which clips the right side of the circle off-screen). Instead we
  // render nothing until the first effect runs and measures the window.
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Skip render until mounted — avoids SSR/client mismatch.
  if (viewport.w === 0 || viewport.h === 0) return null;

  const leftEdge = leftPanelOpen ? LEFT_PANEL_WIDTH : 0;
  const rightEdge = rightPanelOpen ? RIGHT_PANEL_WIDTH : 0;

  // Diameter = full gap between panel inner edges. No padding, no height
  // cap — the circle touches the panels and its top/bottom clip naturally.
  const diameter = viewport.w - leftEdge - rightEdge;
  const radius = diameter / 2;

  // Center of the gap between panels — this makes the circle's left edge
  // land exactly on the left panel's inner edge, and the right edge on the
  // right panel's inner edge.
  const gapLeft = leftEdge;
  const gapRight = viewport.w - rightEdge;
  const centerX = (gapLeft + gapRight) / 2;
  const centerY = viewport.h / 2;

  // CSS mask: inside the circle the mask is transparent (overlay hidden,
  // globe visible). Outside the circle the mask is opaque (overlay shown,
  // blurred glass effect). The edge is a wide, sine-eased falloff (no hard
  // ring, no visible boundary) so the blur circle dissolves into the glass.
  // A generous band (~80px) is what makes the transition truly invisible —
  // narrow bands show a seam even when stepped.
  const BAND = 80;
  const inner = Math.max(0, radius - BAND);
  const maskGradient =
    `radial-gradient(circle ${radius + 2}px at ${centerX}px ${centerY}px,` +
    ` transparent ${inner}px,` +
    ` rgba(0,0,0,0.02) ${inner + BAND * 0.12}px,` +
    ` rgba(0,0,0,0.06) ${inner + BAND * 0.22}px,` +
    ` rgba(0,0,0,0.12) ${inner + BAND * 0.32}px,` +
    ` rgba(0,0,0,0.2) ${inner + BAND * 0.42}px,` +
    ` rgba(0,0,0,0.3) ${inner + BAND * 0.52}px,` +
    ` rgba(0,0,0,0.42) ${inner + BAND * 0.62}px,` +
    ` rgba(0,0,0,0.55) ${inner + BAND * 0.72}px,` +
    ` rgba(0,0,0,0.7) ${inner + BAND * 0.82}px,` +
    ` rgba(0,0,0,0.85) ${inner + BAND * 0.91}px,` +
    ` black ${radius}px)`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // Transparent background — only the backdrop blur shows, matching
        // the side panels exactly. NOT a dark fill.
        background: "transparent",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        maskImage: maskGradient,
        WebkitMaskImage: maskGradient,
        pointerEvents: "none",
        zIndex: 55,
      }}
    />
  );
}
