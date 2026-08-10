import type * as Cesium from "cesium";

// Uniform interface every globe layer implements. Layers are mounted once
// (when the viewer is created) and destroyed on viewer teardown.
export interface Layer {
  id: string;

  // Called once after the viewer is created. Sets up primitives, loads
  // tilesets, registers collections, etc.
  mount(viewer: Cesium.Viewer): void;

  // Toggle visibility without rebuilding primitives.
  setShow?(visible: boolean): void;

  // Called on viewer teardown. Removes primitives, destroys tilesets, etc.
  destroy?(): void;
}
