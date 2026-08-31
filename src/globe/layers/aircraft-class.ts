/**
 * Aircraft classification system: ported from Spectre / GEV's aircraftClass.js.
 * Maps ICAO type designators to aircraft classes for 3D model selection.
 *
 * Classes: helicopter, quadjet, widebody, turboprop, glider, light, bizjet,
 * uav, fastjet, airliner (default).
 *
 * ICAO type-designator sets adapted from skylight (MIT), extended with
 * fast-jet set for military layer and C17/K35R in widebody set.
 */

const HELI = new Set([
  "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "AS50", "AS55", "AS65", "AS32",
  "A109", "A119", "A139", "A169", "A189", "B06", "B06T", "B407", "B412", "B427",
  "B429", "B430", "B505", "S76", "S92", "S61", "S64", "H60", "H500", "MD52",
  "MD60", "R22", "R44", "R66", "EXEC", "EXPL", "GAZL", "LYNX", "NH90", "PUMA",
  "SCAV", "UH1", "B105", "B212", "B214", "B222", "AC", "H47", "H64",
]);
const QUAD = new Set([
  "B741", "B742", "B743", "B744", "B748", "B74S", "B74R", "B74D", "A388", "A342",
  "A343", "A345", "A346", "A124", "C5M", "A225", "IL96", "B52", "A140",
]);
const WIDE = new Set([
  "A306", "A30B", "A310", "A332", "A333", "A338", "A339", "A359", "A35K", "B762",
  "B763", "B764", "B772", "B77L", "B773", "B77W", "B778", "B779", "B788", "B789",
  "B78X", "MD11", "IL86", "DC10", "L101", "A337", "B767", "B777", "B787",
  "C17", "K35R",
]);
const TPROP = new Set([
  "DH8A", "DH8B", "DH8C", "DH8D", "AT43", "AT44", "AT45", "AT46", "AT72", "AT73",
  "AT75", "AT76", "SF34", "SB20", "SW3", "SW4", "E110", "E120", "C208", "C212",
  "C408", "PC12", "B190", "BE20", "B350", "B300", "JS31", "JS32", "JS41", "D228",
  "D328", "F50", "F27", "ATP", "TBM7", "TBM8", "TBM9", "TBM0", "PC6", "C441",
  "C425", "DHC6", "DHC7", "C130", "AN12", "AN26", "AN32", "SH36", "CVLT", "SAAB",
  "A400",
]);
const GLIDER = new Set([
  "DISC", "DUOD", "VENT", "NIMB", "NIM3", "NIM4", "JANS", "ARCE", "DG40", "DG80",
  "DG1T", "DG30", "DG50", "LS3", "LS4", "LS6", "LS7", "LS8", "STD3", "G103",
  "G102", "G104", "PW5", "PW6", "L13", "L23", "L33", "PIK", "PEGA", "KEST",
  "TWIN", "AS33", "ASW", "ASG", "ASK", "VENS", "GLID", "MOSQ", "DIMO",
]);
const LIGHT = new Set([
  "C150", "C152", "C162", "C172", "C72R", "C175", "C177", "C180", "C182", "C185",
  "C188", "C206", "C207", "C210", "C310", "C337", "SR20", "SR22", "S22T", "PA18",
  "PA24", "PA28", "P28A", "P28B", "P28R", "PA32", "P32R", "PA34", "PA38", "PA44",
  "PA46", "DA20", "DA40", "DA42", "DA62", "BE33", "BE35", "BE36", "BE58", "BE76",
  "BE19", "BE23", "BE24", "M20P", "M20T", "AA1", "AA5", "GLAS", "COL4", "RV4",
  "RV6", "RV7", "RV8", "RV9", "RV10", "RV14", "GA8", "G115", "BL8", "CH7",
]);
const BIZJET = new Set([
  "C500", "C501", "C510", "C525", "C25A", "C25B", "C25C", "C25M", "C550",
  "C551", "C560", "C56X", "C650", "C680", "C68A", "C700", "C750",
  "CL30", "CL35", "CL60", "GLF2", "GLF3", "GLF4", "GLF5", "GLF6", "GA5C",
  "GA6C", "G150", "G280", "GL5T", "GL7T", "GLEX",
  "LJ23", "LJ24", "LJ25", "LJ31", "LJ35", "LJ40", "LJ45", "LJ55", "LJ60",
  "LJ70", "LJ75", "FA10", "FA20", "FA50", "FA7X", "FA8X", "F900", "F2TH",
  "H25A", "H25B", "H25C", "HDJT", "E50P", "E55P", "E545", "E550", "PC24",
  "PRM1", "BE40", "ASTR", "WW24",
  "SF50",
]);
const UAV = new Set([
  "Q1", "Q4", "Q9", "MQ1", "MQ4", "MQ9", "RQ4", "TB2", "SHDW", "HERN",
]);
const FASTJET = new Set([
  "F16", "F15", "F18", "FA18", "F14", "F22", "F35", "F4", "F5", "A10", "AV8B",
  "TYPH", "EUFI", "RFAL", "RAFL", "GRIP", "JAS39", "TOR", "MIR2", "M2000",
  "SU27", "SU30", "SU33", "SU34", "SU35", "SU57", "MG29", "MIG29", "MG31", "J20",
  "T38", "HAWK", "L39", "M346", "T7A",
]);

const OPENSKY_CATEGORY: Record<number, AircraftClass> = {
  2: "light",
  3: "airliner",
  4: "airliner",
  5: "airliner",
  6: "widebody",
  7: "fastjet",
  8: "helicopter",
  9: "glider",
};

const EMITTER_CATEGORY: Record<string, AircraftClass> = {
  A1: "light", A2: "light", A3: "airliner", A4: "airliner",
  A5: "widebody", A6: "fastjet", A7: "helicopter", B1: "glider",
};

export type AircraftClass =
  | "helicopter" | "quadjet" | "widebody" | "turboprop" | "glider"
  | "light" | "bizjet" | "uav" | "fastjet" | "airliner";

export interface ClassifyOptions {
  typeCode?: string;
  category?: number | string;
}

export function classifyAircraft(opts: ClassifyOptions = {}): AircraftClass {
  const code = String(opts.typeCode || "").trim().toUpperCase();
  if (code) {
    if (FASTJET.has(code)) return "fastjet";
    if (UAV.has(code)) return "uav";
    if (HELI.has(code)) return "helicopter";
    if (QUAD.has(code)) return "quadjet";
    if (WIDE.has(code)) return "widebody";
    if (TPROP.has(code)) return "turboprop";
    if (GLIDER.has(code)) return "glider";
    if (BIZJET.has(code)) return "bizjet";
    if (LIGHT.has(code)) return "light";
    return "airliner";
  }
  if (typeof opts.category === "number" && Number.isFinite(opts.category)) {
    const mapped = OPENSKY_CATEGORY[opts.category];
    if (mapped) return mapped;
  }
  const cat = String(opts.category || "").trim().toUpperCase();
  if (EMITTER_CATEGORY[cat]) return EMITTER_CATEGORY[cat];
  return "airliner";
}

/** Real per-class GLBs with belly offset and bounding sphere radius. */
export interface ModelSpec {
  url: string;
  bellyM: number;
  radiusM: number;
  scale: number;
}

/** 3D model scale multipliers for the shared airplane.glb. Copied from GEV. */
export const CLASS_SCALE_3D: Record<AircraftClass, number> = {
  light: 0.75, glider: 0.75, turboprop: 0.85, airliner: 1.0,
  widebody: 1.3, quadjet: 1.45, helicopter: 0.8, fastjet: 0.8,
  bizjet: 0.8, uav: 0.8,
};

/** Shared airplane.glb native bounding radius in meters. */
const MODEL_NATIVE_RADIUS_M = 34.41;
/** Shared airplane.glb base scale (real-world meters). */
const MODEL_SCALE = 1;

export const CLASS_MODEL_REAL: Partial<Record<AircraftClass, Omit<ModelSpec, "scale">>> = {
  helicopter: { url: "/models/bell206.glb", bellyM: 1.66, radiusM: 8.24 },
  light: { url: "/models/c172.glb", bellyM: 1.36, radiusM: 7.0 },
  bizjet: { url: "/models/citation2.glb", bellyM: 2.86, radiusM: 11.24 },
  uav: { url: "/models/mq9.glb", bellyM: 2.02, radiusM: 12.0 },
  widebody: { url: "/models/b789.glb", bellyM: 7.81, radiusM: 44.08 },
  turboprop: { url: "/models/atr72.glb", bellyM: 3.81, radiusM: 19.49 },
};

/** Get the model spec for a class, falling back to shared airplane.glb. */
export function getModelSpec(klass: AircraftClass): ModelSpec {
  const real = CLASS_MODEL_REAL[klass];
  if (real) return { ...real, scale: 1 };
  return {
    url: "/models/airplane.glb",
    bellyM: 6.719,
    radiusM: MODEL_NATIVE_RADIUS_M,
    scale: MODEL_SCALE * (CLASS_SCALE_3D[klass] || 1),
  };
}

/** Shared airplane.glb belly offset (native origin sits above lowest vertex). */
export const MODEL_BELLY_OFFSET_NATIVE = 6.719;

/** Heading offset: GLB nose points -X, Cesium heading 0 = north, so rotate 180. */
export const MODEL_HEADING_OFFSET_DEG = 180;
