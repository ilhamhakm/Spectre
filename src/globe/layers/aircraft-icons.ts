// Aircraft silhouette icons as SVG data URIs for Cesium billboards.
// Adapted from GEV's aircraftIcons.js (MIT-licensed skylight recognition charts).
// All glyphs are nose-up (nose toward -Y at rotation 0), white fill with
// dark hairline stroke, so billboard.color tint multiplies cleanly.

const VIEW = 96;
const C = VIEW / 2; // 48 - glyph centre

const STROKE = 'stroke="rgba(0,0,0,0.32)" stroke-width="1.4" stroke-linejoin="round"';

const BODIES: Record<string, string> = {
  // Airliner: slender swept-wing narrow-body, two underwing engine pods.
  airliner: `
    <path d="M0,-42 C 3.8,-40 4.6,-34 4.6,-26 L 4.6,-14
             L 32,4 L 34,6 L 34,10 L 31.4,9.2 L 4.6,2.4
             L 4.2,20
             L 14,28 L 14,32 L 0,28.6 L -14,32 L -14,28 L -4.2,20
             L -4.6,2.4 L -31.4,9.2 L -34,10 L -34,6 L -32,4 L -4.6,-14
             L -4.6,-26 C -4.6,-34 -3.8,-40 0,-42 Z" fill="white" ${STROKE}/>
    <path d="M-15.5,-1.5 l3,7.6 4,-1.4 -1.5,-8.4 Z" fill="white"/>
    <path d="M15.5,-1.5 l-3,7.6 -4,-1.4 1.5,-8.4 Z" fill="white"/>
    <path d="M-1.6,33.5 L 1.6,33.5 L 1.6,40 L -1.6,40 Z" fill="white"/>`,

  // Fast jet: sharp delta with pointed nose, LERX root blend, twin tail fins.
  fastjet: `
    <path d="M0,-43
             L 3.5,-30
             C 4,-24 4.6,-16 5,-8
             L 27,20 L 27,26 L 6,16
             L 8,30 L 8,34 L 3,31
             L 3,38 L 6.5,42 L 6.5,44 L 0,41.5
             L -6.5,44 L -6.5,42 L -3,38
             L -3,31 L -8,34 L -8,30 L -6,16
             L -27,26 L -27,20 L -5,-8
             C -4.6,-16 -4,-24 -3.5,-30 Z" fill="white" ${STROKE}/>`,

  // Light GA: small chunky straight wings, fat stubby fuselage, nose prop disc.
  light: `
    <path d="M0,-27
             C 4,-25 5.2,-20 5.2,-13
             L 5.2,-9
             L 27,-9 L 27,6 L 5.2,6
             L 5.2,16
             L 11.5,23 L 11.5,27 L 0,23.5 L -11.5,27 L -11.5,23 L -5.2,16
             L -5.2,6
             L -27,6 L -27,-9 L -5.2,-9
             L -5.2,-13
             C -5.2,-20 -4,-25 0,-27 Z" fill="white" ${STROKE}/>
    <ellipse cx="0" cy="-29" rx="12" ry="3.8" fill="white" fill-opacity="0.5"/>`,

  // Helicopter: translucent main-rotor disc, teardrop cabin, tail boom.
  helicopter: `
    <circle cx="0" cy="-6" r="31" fill="white" fill-opacity="0.22"/>
    <g transform="rotate(45 0 -6)">
      <rect x="-30.5" y="-8.2" width="61" height="4.4" rx="2.2" fill="white" fill-opacity="0.9"/>
      <rect x="-30.5" y="-8.2" width="61" height="4.4" rx="2.2" fill="white" fill-opacity="0.9" transform="rotate(90 0 -6)"/>
    </g>
    <path d="M0,-22 C 8,-20 10.5,-13 10.5,-6 C 10.5,2 7.5,7 0,8.5
             C -7.5,7 -10.5,2 -10.5,-6 C -10.5,-13 -8,-20 0,-22 Z" fill="white" ${STROKE}/>
    <path d="M-2.6,8 L 2.6,8 L 1.8,32 L -1.8,32 Z" fill="white" ${STROKE}/>
    <path d="M-8,27 L 8,27 L 8,30.6 L -8,30.6 Z" fill="white"/>
    <circle cx="5.6" cy="35" r="6" fill="white" fill-opacity="0.6"/>
    <circle cx="5.6" cy="35" r="2.1" fill="white"/>`,

  // Bizjet: small swept-wing twin-engine jet, smaller than airliner, no winglets.
  bizjet: `
    <path d="M0,-38 C 3.2,-36 3.8,-30 3.8,-22 L 3.8,-12
             L 24,2 L 26,4 L 26,8 L 23.6,7.2 L 3.8,1.6
             L 3.4,16
             L 11,24 L 11,28 L 0,25.4 L -11,28 L -11,24 L -3.4,16
             L -3.8,1.6 L -23.6,7.2 L -26,8 L -26,4 L -24,2 L -3.8,-12
             L -3.8,-22 C -3.8,-30 -3.2,-36 0,-38 Z" fill="white" ${STROKE}/>
    <path d="M-1.4,30 L 1.4,30 L 1.4,36 L -1.4,36 Z" fill="white"/>`,

  // Turboprop: high-wing fuselage with 4-blade prop disc nose. Similar to light
  // but with a prop ellipse and a thicker high-mounted wing.
  turboprop: `
    <path d="M0,-26
             C 4,-24 5,-19 5,-12
             L 5,-8
             L 29,-2 L 29,4 L 5,4
             L 5,15
             L 11,22 L 11,26 L 0,23 L -11,26 L -11,22 L -5,15
             L -5,4
             L -29,4 L -29,-2 L -5,-8
             L -5,-12
             C -5,-19 -4,-24 0,-26 Z" fill="white" ${STROKE}/>
    <ellipse cx="0" cy="-28" rx="13" ry="4.2" fill="white" fill-opacity="0.55"/>
    <g transform="rotate(45 0 -28)">
      <rect x="-12.5" y="-29.8" width="25" height="3.6" rx="1.8" fill="white" fill-opacity="0.85"/>
      <rect x="-12.5" y="-29.8" width="25" height="3.6" rx="1.8" fill="white" fill-opacity="0.85" transform="rotate(90 0 -28)"/>
    </g>`,
};

const _iconCache = new Map<string, string>();

function b64(s: string): string {
  return typeof btoa === "function"
    ? btoa(s)
    : Buffer.from(s, "utf8").toString("base64");
}

/** Fleet raster size: billboards render at ~40-58 device px. */
const FLEET_RASTER_PX = 64;
/** Tracked raster size: the tracked billboard is the one sustained large glyph. */
export const TRACKED_RASTER_PX = 128;

export type AircraftKind = "airliner" | "fastjet" | "light" | "helicopter" | "bizjet" | "turboprop";

/** Data URI for a class silhouette (lazily built, cached per kind+size). */
export function aircraftIcon(
  kind: AircraftKind,
  px: number = FLEET_RASTER_PX,
): string {
  const k = BODIES[kind] ? kind : "airliner";
  const key = `${k}@${px}`;
  let uri = _iconCache.get(key);
  if (!uri) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${VIEW} ${VIEW}"><g transform="translate(${C},${C})">${BODIES[k]}</g></svg>`;
    uri = "data:image/svg+xml;base64," + b64(svg);
    _iconCache.set(key, uri);
  }
  return uri;
}

/** Billboard scale multipliers per class. */
export const CLASS_SCALE_2D: Record<AircraftKind, number> = {
  light: 0.62,
  helicopter: 0.82,
  fastjet: 0.8,
  bizjet: 0.75,
  turboprop: 0.80,
  airliner: 1.0,
};
