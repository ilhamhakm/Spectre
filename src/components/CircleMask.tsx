"use client";

import { useEffect, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";

// Circular view mask: clear globe inside the circle, outside blends into
// the same color as the panels (not just blur). The area outside the circle
// gets the panel background color + blur, so it looks like the panels
// extend seamlessly from the edges.

const LEFT_PANEL_WIDTH = 240;
const RIGHT_PANEL_WIDTH = 240;

export default function CircleMask() {
  const leftPanelOpen = useGlobeStore((s) => s.leftPanelOpen);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (viewport.w === 0 || viewport.h === 0) return null;

  const leftEdge = leftPanelOpen ? LEFT_PANEL_WIDTH : 0;
  const rightEdge = RIGHT_PANEL_WIDTH;

  const diameter = viewport.w - leftEdge - rightEdge;
  const radius = diameter / 2;

  const gapLeft = leftEdge;
  const gapRight = viewport.w - rightEdge;
  const centerX = (gapLeft + gapRight) / 2;
  const centerY = viewport.h / 2;

  // Blur mask: transparent inside (globe clear), opaque outside (blur + tint shows).
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

  // Tint: since panels are now transparent, the CircleMask is the ONLY
  // layer providing the dark blurred background outside the circle.
  // It ramps from transparent (inside) to a dark semi-opaque (outside)
  // that matches what the panels used to look like.
  const TINT_BAND = 200;
  const tintGradient =
    `radial-gradient(circle ${radius + TINT_BAND}px at ${centerX}px ${centerY}px,` +
    ` transparent ${radius}px,` +
    ` rgba(10, 10, 15, 0.15) ${radius + TINT_BAND * 0.1}px,` +
    ` rgba(10, 10, 15, 0.3) ${radius + TINT_BAND * 0.2}px,` +
    ` rgba(10, 10, 15, 0.45) ${radius + TINT_BAND * 0.35}px,` +
    ` rgba(10, 10, 15, 0.55) ${radius + TINT_BAND * 0.5}px,` +
    ` rgba(10, 10, 15, 0.6) ${radius + TINT_BAND * 0.7}px,` +
    ` rgba(10, 10, 15, 0.65) ${radius + TINT_BAND}px)`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: tintGradient,
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        maskImage: maskGradient,
        WebkitMaskImage: maskGradient,
        pointerEvents: "none",
        zIndex: 55,
      }}
    />
  );
}
