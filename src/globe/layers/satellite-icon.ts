import * as Cesium from "cesium";

/**
 * Draw a simple satellite icon on a canvas and return a Cesium-ready
 * ImageData. Uses a small canvas (64×64) for crisp rendering at point
 * sizes around 14–24 px on screen.
 */

const SIZE = 64;
const HALF = SIZE / 2;

function drawSatellite(bodyColor: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, SIZE, SIZE);

  // --- solar panels (wings) ---
  ctx.fillStyle = "#3af";
  ctx.globalAlpha = 0.92;
  // left wing
  ctx.fillRect(4, HALF - 3, 18, 6);
  // right wing
  ctx.fillRect(SIZE - 22, HALF - 3, 18, 6);

  // panel grid lines
  ctx.strokeStyle = "#0df";
  ctx.lineWidth = 0.6;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 3; i++) {
    const lx = 4 + i * 6;
    ctx.beginPath();
    ctx.moveTo(lx, HALF - 3);
    ctx.lineTo(lx, HALF + 3);
    ctx.stroke();
    const rx = SIZE - 22 + i * 6;
    ctx.beginPath();
    ctx.moveTo(rx, HALF - 3);
    ctx.lineTo(rx, HALF + 3);
    ctx.stroke();
  }

  // --- body (center) ---
  ctx.globalAlpha = 1;
  ctx.fillStyle = bodyColor;
  const bw = 10, bh = 10;
  ctx.fillRect(HALF - bw / 2, HALF - bh / 2, bw, bh);

  // body outline
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(HALF - bw / 2, HALF - bh / 2, bw, bh);

  // --- antenna (top) ---
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(HALF, HALF - bh / 2);
  ctx.lineTo(HALF, HALF - bh / 2 - 6);
  ctx.stroke();

  // antenna dish
  ctx.fillStyle = "#eee";
  ctx.beginPath();
  ctx.arc(HALF, HALF - bh / 2 - 8, 3, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

// Cache canvases per colour so we only draw once.
const cache = new Map<string, HTMLCanvasElement>();

export function getSatelliteImage(colorHex: string): HTMLCanvasElement {
  let c = cache.get(colorHex);
  if (!c) {
    c = drawSatellite(colorHex);
    cache.set(colorHex, c);
  }
  return c;
}

export const CATEGORY_COLORS: Record<string, string> = {
  station: "#FFD700",
  telescope: "#FF6B6B",
  observation: "#4ECDC4",
  constellation: "#A78BFA",
};

export function getCategoryColor(cat: string): Cesium.Color {
  const hex = CATEGORY_COLORS[cat] || "#00D4FF";
  return Cesium.Color.fromCssColorString(hex);
}
