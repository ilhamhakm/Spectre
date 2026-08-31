/**
 * Preset-aware traffic dot styling - pure lookup tables mapping the active
 * post-FX style (StyleManager preset name) + congestion bucket to a dot
 * treatment the shaders cannot destroy.
 *
 * Ported faithfully from GEV's src/data/trafficPresetStyle.js. Cesium-free so
 * the tables are unit-testable; the traffic layer maps tuples to Cesium colors
 * at spawn/restyle time.
 *
 * NOTE (Spectre V2): there is no StyleManager / post-FX preset system here, so
 * `_stylePreset` stays 'normal' and every lookup resolves to the shipped
 * palette. The module is structurally faithful and ready for a future style
 * system; it is inert under the normal profile by design.
 */

/** Style profile name. */
export type TrafficStyleProfile = "normal" | "mono" | "crt";

/** Style name -> non-normal profile. */
const PROFILE_BY_STYLE: Record<string, TrafficStyleProfile> = {
  surveillance: "mono", // NVG - P43 phosphor x luma
  thermal: "mono", // FLIR - grayscale/ironbow x luma
  noir: "mono", // full desaturation
  retro: "crt", // CRT - hue survives, small dots don't
};

/** Bucket name including sim/uncovered sentinel. */
export type BucketKey = "free" | "slow" | "jam" | "sim" | null | undefined;

interface OutlineSpec {
  rgba: [number, number, number, number];
  width: number;
}

interface DotStyleEntry {
  rgba: [number, number, number, number];
  sizeDelta: number;
  outline?: OutlineSpec | null;
}

/** Per-profile bucket treatments: rgba + pixel-size delta added on top of shipped sizing. */
const DOT_STYLE: Record<string, Record<string, DotStyleEntry>> = {
  mono: {
    jam: { rgba: [255, 255, 255, 0.95], sizeDelta: 3, outline: { rgba: [0, 0, 0, 0.9], width: 2 } },
    slow: { rgba: [255, 255, 255, 0.9], sizeDelta: 1, outline: { rgba: [0, 0, 0, 0.85], width: 1 } },
    free: { rgba: [255, 255, 255, 0.85], sizeDelta: 0, outline: { rgba: [0, 0, 0, 0.8], width: 1 } },
  },
  crt: {
    jam: { rgba: [255, 59, 48, 0.95], sizeDelta: 3, outline: { rgba: [0, 0, 0, 0.9], width: 2 } },
    slow: { rgba: [255, 179, 0, 0.92], sizeDelta: 2, outline: { rgba: [0, 0, 0, 0.85], width: 1 } },
    free: { rgba: [0, 255, 102, 0.9], sizeDelta: 1, outline: null },
  },
};

/** Classify a StyleManager preset name into a traffic styling profile. Unknown -> 'normal'. */
export function trafficStyleProfile(styleName: string | null | undefined): TrafficStyleProfile {
  return PROFILE_BY_STYLE[styleName ?? ""] || "normal";
}

/**
 * Preset dot color for a congestion bucket, or null to keep the shipped
 * FLOW_BUCKET_COLORS value. Null/'sim' buckets always return null.
 */
export function presetDotRgba(
  styleName: string | null | undefined,
  bucket: BucketKey,
): [number, number, number, number] | null {
  const entry = DOT_STYLE[trafficStyleProfile(styleName)]?.[bucket ?? ""];
  return entry ? entry.rgba : null;
}

/** Pixel-size delta a preset adds on top of the shipped dot sizing (0 under normal / sim). */
export function presetSizeDelta(styleName: string | null | undefined, bucket: BucketKey): number {
  const entry = DOT_STYLE[trafficStyleProfile(styleName)]?.[bucket ?? ""];
  return entry ? entry.sizeDelta : 0;
}

/**
 * Dark halo for a preset dot, or null for none. Null under the normal profile
 * and for sim dots (shipped dots never draw outlines).
 */
export function presetDotOutline(
  styleName: string | null | undefined,
  bucket: BucketKey,
): OutlineSpec | null {
  const entry = DOT_STYLE[trafficStyleProfile(styleName)]?.[bucket ?? ""];
  return entry?.outline || null;
}

/**
 * Detection-overlay tier key for a traffic contact's flow bucket. The
 * detection canvas composites ABOVE the post-FX chain, so tier colors are
 * literal screen RGB in every preset.
 *
 * Callers pass 'sim' for LIVE-mode roads TomTom has no data for; in keyless
 * mode they must pass null so contacts keep the stock 'vehicle' tier.
 */
export function trafficBucketTier(bucket: BucketKey): string | null {
  if (bucket === "free" || bucket === "slow" || bucket === "jam") return `veh_${bucket}`;
  if (bucket === "sim") return "veh_nodata";
  return null;
}
