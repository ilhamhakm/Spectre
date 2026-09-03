import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "./types";
import { useGlobeStore, type TrackedFeature } from "@/store/globe-store";

// =============================================================================
// Local infrastructure layers (Dams / Data Centers)
//
// Bundled OSM-derived .geojsonl datasets rendered as ground-clamped GeoJSON
// point markers. Labels are drawn by the LocalInfrastructureOverlay canvas
// component (earthquake-tag parity: black bg, white text, vertical leader
// line, accent bar). Globe-horizon occlusion is handled in the preRender walk.
// =============================================================================

const VISIBILITY_UPDATE_MS = 450;
const LABEL_TITLE_MAX = 34;
const LABEL_DETAIL_MAX = 48;

interface FeatureRecord {
  id: string;
  entity: Cesium.Entity;
  carto: Cesium.Cartographic;
  priority: number;
  labelText: string;
}

interface LocalInfrastructureLayerOptions {
  id: string;
  url: string;
  name: string;
  color: string;
  labelMax?: number;
  labelGridPx?: number;
  /** Builds the second label line from raw feature properties. */
  detailFromProperties?: (props: Record<string, unknown>) => string;
}

// -----------------------------------------------------------------------------
// Property / label helpers (ported from GEV localGeojson.js)
// -----------------------------------------------------------------------------

function cleanLabel(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || text === "undefined" || text === "null") return "";
  return text;
}

function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function layerTitle(layerId: string): string {
  if (layerId.includes("datacenter")) return "Datacenter";
  if (layerId.includes("dam")) return "Dam";
  return "Feature";
}

function unwrapProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      entry && typeof (entry as { getValue?: unknown }).getValue === "function"
        ? (entry as Cesium.Property).getValue(Cesium.JulianDate.now())
        : entry;
  }
  return out;
}

export function propertyObject(entity: Cesium.Entity): Record<string, unknown> {
  const source = entity.properties as unknown;
  if (source && typeof (source as Cesium.PropertyBag).getValue === "function") {
    return unwrapProperties(
      (source as Cesium.PropertyBag).getValue(Cesium.JulianDate.now()),
    );
  }
  return unwrapProperties(source);
}

function damLabelText(props: Record<string, unknown>): string {
  const tags = (props.tags ?? {}) as Record<string, unknown>;
  const name = cleanLabel(tags["name:en"]) || cleanLabel(tags.name) || cleanLabel(props.name)
    || cleanLabel(tags.official_name) || cleanLabel(tags.operator) || "Dam";
  const output = cleanLabel(tags["plant:output:electricity"]) || cleanLabel(props.output);
  // Filter out non-informative output values like "yes".
  const size = output && output.toLowerCase() !== "yes" ? output : "";
  const label = size ? `${size} | ${name}` : name;
  return clampText(label, LABEL_TITLE_MAX);
}

function datacenterLabelText(props: Record<string, unknown>): string {
  const tags = (props.tags ?? {}) as Record<string, unknown>;
  const name = cleanLabel(tags["name:en"]) || cleanLabel(tags.name) || cleanLabel(props.name)
    || cleanLabel(tags.operator) || cleanLabel(tags["operator:short"]) || "Data Center";
  const power = cleanLabel(tags["data_center:power"]) || cleanLabel(tags["capacity:it_load"])
    || cleanLabel(tags.it_load) || cleanLabel(tags.capacity);
  const label = power ? `${power} | ${name}` : name;
  return clampText(label, LABEL_TITLE_MAX);
}

function featureLabelFromProperties(
  props: Record<string, unknown>,
  layerId: string,
): string {
  if (layerId.includes("dam")) return damLabelText(props);
  if (layerId.includes("datacenter") || layerId.includes("data-center")) return datacenterLabelText(props);
  return clampText(layerTitle(layerId), LABEL_TITLE_MAX);
}

function labelPriorityFromProperties(
  props: Record<string, unknown>,
  layerId: string,
): number {
  const tags = (props.tags ?? {}) as Record<string, unknown>;

  let score = 0;
  if (cleanLabel(props.name) || cleanLabel(tags.name)) score += 1000;
  if (cleanLabel(tags["name:en"])) score += 700;
  if (cleanLabel(tags.operator) || cleanLabel(props.operator)) score += 180;
  if (props.output || tags["plant:output:electricity"]) score += 120;
  if (layerId.includes("dam")) score += 80;
  if (layerId.includes("datacenter")) score += 60;
  return score;
}

// -----------------------------------------------------------------------------
// Layer factory
// -----------------------------------------------------------------------------

function createLocalInfrastructureLayer(
  options: LocalInfrastructureLayerOptions,
): LayerImpl {
  const {
    id,
    url,
    name,
    color,
  } = options;

  let _dataSource: Cesium.GeoJsonDataSource | null = null;
  let _enabled = false;
  let _destroyed = false;
  let _clickHandler: Cesium.ScreenSpaceEventHandler | null = null;
  let _preRenderRemover: (() => void) | null = null;
  let _records: FeatureRecord[] = [];
  let _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;
  let _count = 0;

  const disableLayer = (viewer: Cesium.Viewer): void => {
    _enabled = false;
    if (_dataSource) _dataSource.show = false;
    if (viewer.selectedEntity && (viewer.selectedEntity as { __localLayerId?: string }).__localLayerId === id) {
      viewer.selectedEntity = undefined;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    // Clear tracking if a feature of this layer is currently tracked.
    const tf = useGlobeStore.getState().trackedFeature;
    if (tf) {
      const ours = (id === "dams" && tf.kind === "dam")
        || (id === "data-centers" && tf.kind === "datacenter");
      if (ours) useGlobeStore.getState().untrackFeature();
    }
  };

  return {
    id,
    name,

    async enable(ctx: LayerContext): Promise<void> {
      const { viewer } = ctx;
      if (_destroyed) return;
      _enabled = true;
      _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;

      // 1. Initialize data source (once; retained across toggles like GEV).
      if (!_dataSource) {
        const baseColor = Cesium.Color.fromCssColorString(color);

        // Fetch and parse JSON Lines (.geojsonl) into a FeatureCollection.
        // The source is committed to `_dataSource` only once setup finishes:
        // a half-built source published early would make every later enable()
        // skip this block, so the layer could never clear its error or retry.
        let loaded: Cesium.GeoJsonDataSource | null = null;
        // Whether the scene has actually accepted `loaded` - the two rollback
        // windows (before vs after the add settles) need different cleanup.
        let addedToScene = false;
        try {
          const response = await fetch(url);
          // A 404 returns an HTML body that would otherwise die in JSON.parse
          // one line later, reported as a parse error for a missing file.
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const text = await response.text();
          const lines = text.split("\n").filter((l) => l.trim().length > 0);
          const features = lines.map((line) => JSON.parse(line));
          const geojson = { type: "FeatureCollection" as const, features };

          // Natively parse into entities and use it as our _dataSource
          loaded = await Cesium.GeoJsonDataSource.load(geojson, {
            clampToGround: true,
            stroke: baseColor,
            fill: baseColor.withAlpha(0.3),
            strokeWidth: 2,
            markerSize: 8,
            markerColor: baseColor,
          });

          loaded.name = name;
          loaded.show = false;
          // DataSourceCollection.add() only inserts on a later microtask;
          // awaiting routes an add() rejection into the error path below
          // instead of leaving an orphan the retry would double up on.
          await viewer.dataSources.add(loaded);
          addedToScene = true;

          // Convert parsed points into ground-clamped markers. Labels are
          // drawn by the LocalInfrastructureOverlay canvas component.
          const entities = loaded.entities.values;
          _count = entities.length;
          _records = [];

          for (let i = 0; i < entities.length; i++) {
            const feature = entities[i];
            // Tag it so our click handler knows it belongs to this layer
            (feature as { __localLayerId?: string }).__localLayerId = id;

            let pos: Cesium.Cartesian3 | undefined =
              feature.position?.getValue(Cesium.JulianDate.now());

            if (!pos && feature.polygon) {
              feature.polygon.outline = new Cesium.ConstantProperty(true);
              feature.polygon.outlineColor = new Cesium.ConstantProperty(baseColor);

              // Calculate center point for the marker
              const hierarchy = feature.polygon.hierarchy?.getValue(
                Cesium.JulianDate.now(),
              ) as Cesium.PolygonHierarchy | undefined;
              if (hierarchy?.positions && hierarchy.positions.length > 0) {
                pos = Cesium.BoundingSphere.fromPoints(hierarchy.positions).center;
                feature.position = new Cesium.ConstantPositionProperty(pos);
              }
            }

            if (!pos) continue;

            const carto = Cesium.Cartographic.fromCartesian(pos);
            const properties = propertyObject(feature);
            const recordId = String(feature.id ?? i);

            // Store label text and priority on the entity for the overlay.
            const title = featureLabelFromProperties(properties, id);
            const priority = labelPriorityFromProperties(properties, id);
            (feature as { __labelText?: string }).__labelText = title;
            (feature as { __priority?: number }).__priority = priority;

            _records.push({
              id: recordId,
              entity: feature,
              carto,
              priority,
              labelText: title,
            });
          }
          // Setup finished - publish it.
          _dataSource = loaded;
        } catch (err) {
          // Roll the partial build back so a later enable() retries from
          // scratch instead of inheriting a half-populated source. Only the
          // post-add window has something in the scene to remove.
          if (addedToScene && loaded) {
            try { viewer.dataSources.remove(loaded, true); } catch { /* already gone */ }
          }
          _count = 0;
          _records = [];
          console.error(`Failed to load ${id}:`, err);
          throw new Error(
            `${name} dataset unavailable (${err instanceof Error ? err.message : String(err)})`,
          );
        }

        // 2. Install native global click handler
        if (!_clickHandler) {
          _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
          _clickHandler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            if (!_enabled || !_dataSource) return;
            const picked = viewer.scene.pick(click.position);

            if (picked?.id && (picked.id as { __localLayerId?: string }).__localLayerId === id) {
              const entity = picked.id as Cesium.Entity;
              viewer.selectedEntity = entity;

              // Zoom to the entity's ground-level position.
              let targetPos: Cesium.Cartesian3 | null =
                entity.position?.getValue(Cesium.JulianDate.now()) ?? null;

              if (!targetPos && entity.polygon?.hierarchy) {
                const hierarchy = entity.polygon.hierarchy.getValue(
                  Cesium.JulianDate.now(),
                ) as Cesium.PolygonHierarchy | undefined;
                if (hierarchy?.positions && hierarchy.positions.length > 0) {
                  targetPos = Cesium.BoundingSphere.fromPoints(hierarchy.positions).center;
                }
              }

              if (targetPos) {
                const carto = Cesium.Cartographic.fromCartesian(targetPos);
                const lat = Cesium.Math.toDegrees(carto.latitude);
                const lon = Cesium.Math.toDegrees(carto.longitude);

                // Populate the right panel with this feature's info.
                const props = propertyObject(entity);
                const kind: TrackedFeature["kind"] =
                  id === "dams" ? "dam" : id === "data-centers" ? "datacenter" : "dam";
                const name = featureLabelFromProperties(props, id);
                const feature: TrackedFeature = {
                  kind,
                  id: String(entity.id ?? ""),
                  name,
                  lat,
                  lon,
                  data: props,
                };
                useGlobeStore.getState().trackFeature(feature);

                // Disable interactions so Cesium doesn't cancel the flight
                viewer.scene.screenSpaceCameraController.enableInputs = false;

                viewer.camera.flyTo({
                  destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 1000),
                  duration: 1.5,
                  complete: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
                  cancel: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
                });
              }
            } else {
              // Empty space or another layer's object: deselect if we own it.
              const tf = useGlobeStore.getState().trackedFeature;
              if (tf) {
                const ours = (id === "dams" && tf.kind === "dam")
                  || (id === "data-centers" && tf.kind === "datacenter");
                if (ours) useGlobeStore.getState().untrackFeature();
              }
            }
          }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        }
      }

      // 3. Add a pre-render occluder to hide points behind the globe.
      //    Label rendering is handled by the LocalInfrastructureOverlay
      //    canvas component (earthquake-tag parity).
      if (_enabled && !_preRenderRemover) {
        _preRenderRemover = viewer.scene.preRender.addEventListener(() => {
          if (!_enabled || !_dataSource) return;
          const now = performance.now();
          if (now - _lastVisibilityUpdate < VISIBILITY_UPDATE_MS) return;
          _lastVisibilityUpdate = now;

          const cameraPos = viewer.camera.positionWC;
          if (!cameraPos) return;

          // EllipsoidalOccluder is public API at runtime but missing from the
          // shipped d.ts in this Cesium version.
          const occluder = new (Cesium as unknown as {
            EllipsoidalOccluder: new (
              ellipsoid: Cesium.Ellipsoid,
              camera: Cesium.Cartesian3,
            ) => { isPointVisible: (point: Cesium.Cartesian3) => boolean };
          }).EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, cameraPos);

          for (let i = 0; i < _records.length; i++) {
            const record = _records[i];
            const pos = record.entity.position?.getValue(Cesium.JulianDate.now());
            if (!pos) continue;
            const isVisible = occluder.isPointVisible(pos);
            if (record.entity.show !== isVisible) record.entity.show = isVisible;
          }
        });
      }

      // Honor a disable() that landed while we were awaiting the fetch/parse.
      if (_dataSource) _dataSource.show = _enabled;
      viewer.scene.requestRender();
    },

    disable(ctx: LayerContext): void {
      disableLayer(ctx.viewer);
    },

    getStats() {
      return { count: _count, layerId: id, enabled: _enabled };
    },

    // Exposed for the right-panel browse list. Has closure access to
    // _records, unlike an external getter.
    getTopFeatures(limit = 10): TrackedFeature[] {
      if (!_enabled || _records.length === 0) return [];
      const kind: TrackedFeature["kind"] =
        id === "dams" ? "dam" : id === "data-centers" ? "datacenter" : "dam";
      const sorted = _records.slice().sort((a, b) => b.priority - a.priority);
      const out: TrackedFeature[] = [];
      for (const record of sorted) {
        if (out.length >= limit) break;
        const props = propertyObject(record.entity);
        out.push({
          kind,
          id: record.id,
          name: record.labelText.split("\n")[0] || record.id,
          lat: Cesium.Math.toDegrees(record.carto.latitude),
          lon: Cesium.Math.toDegrees(record.carto.longitude),
          data: props,
        });
      }
      return out;
    },
  };
}

// -----------------------------------------------------------------------------
// Dams layer (GEV: id 'local-dams', color #0088ff, labelMax 900, grid 132)
// -----------------------------------------------------------------------------

function damDetail(props: Record<string, unknown>): string {
  const tags = (props.tags ?? {}) as Record<string, unknown>;
  const candidates = [
    tags.associated_river,
    props.associated_river,
    tags.river,
    props.river,
    tags["river:name"],
  ];
  return candidates.map(cleanLabel).find(Boolean) || "";
}

export const damsLayer: LayerImpl = createLocalInfrastructureLayer({
  id: "dams",
  url: "/data/dams.geojsonl",
  name: "Dams",
  color: "#0088ff", // Blue
  labelMax: 900,
  labelGridPx: 132,
  detailFromProperties: damDetail,
});

// -----------------------------------------------------------------------------
// Data centers layer (GEV: id 'local-datacenters', #00ffff, labelMax 700, grid 138)
// -----------------------------------------------------------------------------

function datacenterDetail(props: Record<string, unknown>): string {
  const tags = (props.tags ?? {}) as Record<string, unknown>;
  const operator = [tags.operator, props.operator, tags["operator:short"]]
    .map(cleanLabel)
    .find(Boolean) || "";
  const capacity = [
    tags["capacity:it_load"],
    tags.it_load,
    tags.capacity,
    props.capacity,
  ]
    .map(cleanLabel)
    .find(Boolean) || "";
  const line = [operator, capacity]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" · ");
  return line;
}

export const dataCentersLayer: LayerImpl = createLocalInfrastructureLayer({
  id: "data-centers",
  url: "/data/datacenters.geojsonl",
  name: "Data Centers",
  color: "#00ffff", // Cyan
  labelMax: 700,
  labelGridPx: 138,
  detailFromProperties: datacenterDetail,
});

// -----------------------------------------------------------------------------
// Top-N browse getters for the right panel. Delegate to each layer's
// closure-scoped getTopFeatures method.
// -----------------------------------------------------------------------------

export function damsGetTopFeatures(limit = 10): TrackedFeature[] {
  return damsLayer.getTopFeatures(limit);
}

export function dataCentersGetTopFeatures(limit = 10): TrackedFeature[] {
  return dataCentersLayer.getTopFeatures(limit);
}
