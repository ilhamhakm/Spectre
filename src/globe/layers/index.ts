import type { Layer } from "./types";
import { createBuildingsLayer } from "./buildings-layer";
import { createBordersLayer } from "./borders-layer";

// Declarative layer registry. Add new layers here — they'll be mounted,
// toggled, and destroyed automatically by CesiumGlobe.tsx.
export const LAYERS: Layer[] = [
  createBuildingsLayer(),
  createBordersLayer(),
];

export { createBuildingsLayer } from "./buildings-layer";
export type { Layer } from "./types";
