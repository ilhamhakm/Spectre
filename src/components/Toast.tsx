"use client";

import { useGlobeStore } from "@/store/globe-store";

export default function Toast() {
  const toast = useGlobeStore((s) => s.toast);
  if (!toast) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "8px 16px",
        background: "rgba(255, 255, 255, 0.1)",
        border: "1px solid rgba(255, 255, 255, 0.25)",
        borderRadius: 6,
        color: "#ffffff",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        letterSpacing: 1,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        zIndex: 100,
        pointerEvents: "none",
        animation: "toastIn 200ms ease-out",
      }}
    >
      {toast}
    </div>
  );
}
