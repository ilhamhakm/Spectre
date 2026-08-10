// Generates color-parameterized airplane silhouette canvases for use as
// Billboard icons. Billboards accept a Canvas/Image/URL in the `image`
// field of `add()`, so we return the raw canvas.
//
// The airplane points "up" (north = 0°) in the source canvas. Cesium's
// Billboard.rotation turns it clockwise to match the aircraft's heading.
//
// Caches one canvas per color key.

export interface AirplaneColor { r: number; g: number; b: number; }

const cache = new Map<string, HTMLCanvasElement>();

function keyOf(c: AirplaneColor): string {
  return `${c.r},${c.g},${c.b}`;
}

export function getAirplaneIcon(color: AirplaneColor): HTMLCanvasElement {
  const key = keyOf(color);
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for airplane icon");

  const cx = size / 2;

  // Dark outline color for contrast against any imagery.
  const outline = "rgba(0, 0, 0, 0.9)";
  const fill = `rgb(${color.r}, ${color.g}, ${color.b})`;

  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";

  // Clean top-down jet silhouette — slim fuselage, swept wings, tail.
  ctx.beginPath();
  ctx.moveTo(cx, 2);                    // nose
  ctx.lineTo(cx + 1.5, 10);             // upper fuselage right
  ctx.lineTo(cx + 2.5, 14);             // widen before wings
  ctx.lineTo(cx + 20, 20);              // right wing tip (swept back)
  ctx.lineTo(cx + 20, 24);              // wing trailing edge
  ctx.lineTo(cx + 3, 22);               // back to fuselage
  ctx.lineTo(cx + 4, 30);               // tail boom right
  ctx.lineTo(cx + 11, 36);              // right horizontal stabilizer tip
  ctx.lineTo(cx + 11, 39);              // stabilizer trailing edge
  ctx.lineTo(cx + 3, 37);               // back to tail
  ctx.lineTo(cx + 2.5, 43);             // tail base right
  ctx.lineTo(cx - 2.5, 43);             // tail base left
  ctx.lineTo(cx - 3, 37);               // back to tail left
  ctx.lineTo(cx - 11, 39);              // left stabilizer trailing edge
  ctx.lineTo(cx - 11, 36);              // left stabilizer tip
  ctx.lineTo(cx - 4, 30);               // tail boom left
  ctx.lineTo(cx - 3, 22);               // back to fuselage
  ctx.lineTo(cx - 20, 24);              // left wing trailing edge
  ctx.lineTo(cx - 20, 20);              // left wing tip (swept back)
  ctx.lineTo(cx - 2.5, 14);             // widen before wings
  ctx.lineTo(cx - 1.5, 10);             // upper fuselage left
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Small bright dot at nose for orientation cue.
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.beginPath();
  ctx.arc(cx, 4, 1, 0, Math.PI * 2);
  ctx.fill();

  cache.set(key, canvas);
  return canvas;
}

// White for private flights — clean, visible on dark satellite imagery.
export const PRIVATE_FLIGHT_COLOR: AirplaneColor = { r: 0xf0, g: 0xf0, b: 0xf0 };
// Red-orange for military — strong, alert-like.
export const MILITARY_FLIGHT_COLOR: AirplaneColor = { r: 0xff, g: 0x55, b: 0x33 };
// Gold for the user-tracked jet (TRACK button in the private flights panel).
export const TRACKED_FLIGHT_COLOR: AirplaneColor = { r: 0xff, g: 0xc8, b: 0x2a };
