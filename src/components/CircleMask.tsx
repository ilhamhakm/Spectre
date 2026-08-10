"use client";

import { useEffect, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";

// Circular view mask with three-zone radial overlay:
//   Zone 1 (center to inner): clear globe, no blur, no tint
//   Zone 2 (inner to radius): blur ramps in, no tint (transparent blurry)
//   Zone 3 (radius outward): full blur, subtle gray tint (grayish blurry)
//
// The blur transition and the gray tint are staged: blur reaches full
// strength at `radius`, THEN the tint begins ramping in. This gives the
// progression: clear -> transparent blurry -> grayish blurry.
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

  // Three-zone radial overlay:
  //   Zone 1 (center to inner): clear globe, no blur, no tint
  //   Zone 2 (inner to radius): blur ramps in, no tint (transparent blurry)
  //   Zone 3 (radius outward): full blur, gray tint ramps in (grayish blurry)
  //
  // The mask controls WHERE backdrop blur is visible (transparent inside =
  // globe clear, opaque outside = blur shows). The tint gradient starts
  // AFTER the blur is fully established, so the transition band gets
  // blur-only before the grayish tint appears at the panel zone.
  const BAND = 120;
  const inner = Math.max(0, radius - BAND);

  // Mask: controls blur visibility. Transparent inside, opaque outside,
  // smooth sine-eased falloff across BAND.
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

  // Tint: starts at `radius` (AFTER blur is fully ramped in), then
  // gradually adds a subtle gray tint outward into the panel zone.
  // Transparent through Zone 1 and Zone 2, light gray in Zone 3.
  const TINT_BAND = 500;
  const tintGradient =
    `radial-gradient(circle ${radius + TINT_BAND}px at ${centerX}px ${centerY}px,` +
    ` transparent ${radius}px,` +
    ` rgba(15, 20, 28, 0.02) ${radius + TINT_BAND * 0.15}px,` +
    ` rgba(15, 20, 28, 0.04) ${radius + TINT_BAND * 0.3}px,` +
    ` rgba(15, 20, 28, 0.06) ${radius + TINT_BAND * 0.45}px,` +
    ` rgba(15, 20, 28, 0.08) ${radius + TINT_BAND * 0.6}px,` +
    ` rgba(15, 20, 28, 0.1) ${radius + TINT_BAND * 0.8}px,` +
    ` rgba(15, 20, 28, 0.12) ${radius + TINT_BAND}px)`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // Radial gray tint: transparent center, subtle gray at edges.
        // Combined with the backdrop blur and mask, this creates the
        // transition from clear globe to blurry grayish panel zone.
        background: tintGradient,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        maskImage: maskGradient,
        WebkitMaskImage: maskGradient,
        pointerEvents: "none",
        zIndex: 55,
      }}
    />
  );
}
