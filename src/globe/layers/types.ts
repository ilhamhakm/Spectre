import type * as Cesium from "cesium";

export interface LayerContext {
  viewer: Cesium.Viewer;
  Cesium: typeof import("cesium");
}

export interface LayerImpl {
  enable(ctx: LayerContext): Promise<void>;
  disable(ctx: LayerContext): void;
  // Allow implementations to store internal state
  [key: string]: any;
}

export interface ActionLayerImpl {
  enable(ctx: LayerContext): Promise<void>;
  disable(ctx: LayerContext): void;
  [key: string]: any;
}
