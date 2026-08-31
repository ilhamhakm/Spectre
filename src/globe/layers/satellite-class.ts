// Satellite classification: CelesTrak source group -> operator-legible class.
// Port of GEV's satelliteClass.js. The catalog tags every satellite with the
// CelesTrak group it was ingested from, so classification is a pure lookup.
// Colors are CSS hex strings; the layer converts them to Cesium.Color once.

export interface SatelliteClassSpec {
  label: string;
  color: string;
}

export const SATELLITE_CLASSES: Record<string, SatelliteClassSpec> = {
  station: { label: "STATION", color: "#fff6e5" },
  nav: { label: "NAV", color: "#4fd8ff" },
  geo: { label: "GEO", color: "#c89bff" },
  visual: { label: "VISUAL", color: "#9fb3c4" },
};

// CelesTrak group tag -> class key + constellation subtype.
// Keys must match CATALOG_GROUPS in satellites.ts.
const GROUP_CLASS: Record<string, { klass: string; subtype: string | null }> = {
  stations: { klass: "station", subtype: null },
  visual: { klass: "visual", subtype: null },
  "gps-ops": { klass: "nav", subtype: "GPS" },
  "glo-ops": { klass: "nav", subtype: "GLONASS" },
  galileo: { klass: "nav", subtype: "GALILEO" },
  geo: { klass: "geo", subtype: null },
};

const FALLBACK = { klass: "visual", subtype: null };
const ISS_CLASS = { klass: "station", subtype: "ISS" };

export const ISS_NORAD = 25544;

export function satelliteClassOf(
  group: string | undefined | null,
  { isIss = false }: { isIss?: boolean } = {},
): { klass: string; subtype: string | null } {
  if (isIss) return ISS_CLASS;
  return GROUP_CLASS[group ?? ""] ?? FALLBACK;
}

export function satelliteClassColor(group: string | undefined | null): string {
  return SATELLITE_CLASSES[satelliteClassOf(group).klass].color;
}

export function satelliteClassLabel(
  group: string | undefined | null,
  { isIss = false }: { isIss?: boolean } = {},
): string {
  const { klass, subtype } = satelliteClassOf(group, { isIss });
  const base = SATELLITE_CLASSES[klass].label;
  return subtype ? `${base} · ${subtype}` : base;
}
