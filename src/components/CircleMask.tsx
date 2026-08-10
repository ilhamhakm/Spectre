"use client";

import { useEffect, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";

// Circular view mask with radial blur and gray tint.
//
// Inside the center circle: globe is completely clear (no overlay).
// Transition band: smooth falloff from clear to blurry.
// Outside the circle (where panels/buttons sit): increasingly blurry
// backdrop with a subtle gray tint that provides luminance contrast
// for the transparent cyan panels. The tint is transparent at the
// transition and deepens to a light gray toward the screen edges.
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
  // A generous band (~120px) makes the transition truly invisible and gives
  // a gradual ramp from clear to fully blurry.
  const BAND = 120;
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

  // Gray tint gradient: transparent in the center (globe untouched),
  // gradually increasing to a subtle dark gray at the screen edges. This
  // provides luminance contrast for the transparent cyan panels without
  // putting a gray background on the buttons themselves. The tint follows
  // the same radial falloff as the mask so it only appears where the blur
  // appears.
  const tintGradient =
    `radial-gradient(circle ${radius + BAND}px at ${centerX}px ${centerY}px,` +
    ` transparent ${inner}px,` +
    ` rgba(10, 16, 24, 0.0) ${inner + BAND * 0.3}px,` +
    ` rgba(10, 16, 24, 0.05) ${inner + BAND * 0.5}px,` +
    ` rgba(10, 16, 24, 0.12) ${inner + BAND * 0.7}px,` +
    ` rgba(10, 16, 24, 0.2) ${inner + BAND * 0.85}px,` +
    ` rgba(10, 16, 24, 0.28) ${radius}px,` +
    ` rgba(10, 16, 24, 0.35) ${radius + BAND * 0.5}px,` +
    ` rgba(10, 16, 24, 0.4) ${radius + BAND}px)`;

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
