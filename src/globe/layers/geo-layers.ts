import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "./types";
import { useGlobeStore, type TrackedFeature } from "@/store/globe-store";

// =============================================================================
// Shared helpers
// =============================================================================

/** Truncate a string to `max` characters, appending an ellipsis if cut. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

// =============================================================================
// 1. earthquakesLayer - USGS Real-time Earthquakes
//
// Faithful port of GEV's src/data/earthquakes.js: USGS all-day feed, M2.5+,
// ground-clamped discs with STATIC axes sized 2^mag km, colored by depth
// (shallow red, intermediate orange, deep yellow). Ellipse axes must never
// become a CallbackProperty: a per-frame axis re-tessellates its
// CLAMP_TO_GROUND ground primitive on EVERY frame (GEV QA 2026-08-20:
// 58 discs, callback axes = 32.4 ms/frame; static axes = 1.4 ms/frame).
// =============================================================================

/** USGS GeoJSON FeatureCollection shape (subset of fields we use). */
interface UsgsFeatureCollection {
  type: "FeatureCollection";
  features: UsgsFeature[];
}
interface UsgsFeature {
  type: "Feature";
  id?: string;
  geometry: { type: string; coordinates: [number, number, number] };
  properties: {
    mag: number;
    place: string;
    time: number;
    updated?: number;
    tz?: number;
    url?: string;
    detail?: string;
    felt?: number | null;
    cdi?: number | null;
    mmi?: number | null;
    alert?: string | null;
    status?: string;
    tsunami?: number;
    sig?: number;
    net?: string;
    code?: string;
    ids?: string;
    sources?: string;
    types?: string;
    nst?: number | null;
    dmin?: number | null;
    rms?: number | null;
    gap?: number | null;
    magType?: string;
    type?: string;
    title?: string;
  };
}

const USGS_URL = "/api/usgs";
const EARTHQUAKES_POLL_MS = 60000; // GEV updateInterval: 60000
const EARTHQUAKES_MIN_MAG = 2.5; // Skip micro-quakes

/**
 * Color by depth:
 *  - Shallow (<70km): Red
 *  - Intermediate (70-300km): Orange
 *  - Deep (>300km): Yellow
 */
function depthColor(cesium: typeof Cesium, depthKm: number): Cesium.Color {
  if (depthKm < 70) return cesium.Color.RED;
  if (depthKm < 300) return cesium.Color.ORANGE;
  return cesium.Color.YELLOW;
}

export const earthquakesLayer: LayerImpl = (() => {
  let _dataSource: Cesium.CustomDataSource | null = null;
  let _enabled = false;
  let _pollTimer: ReturnType<typeof setInterval> | null = null;
  let _clickHandler: Cesium.ScreenSpaceEventHandler | null = null;

  function stopPoll(): void {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  function removeClickHandler(): void {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
  }

  // Read an entity's flattened properties as a plain object.
  function entityProps(entity: Cesium.Entity): Record<string, unknown> {
    const bag = entity.properties as unknown as
      | (Cesium.PropertyBag & { getValue?: (t: Cesium.JulianDate) => Record<string, unknown> })
      | null;
    if (!bag || typeof bag.getValue !== "function") return {};
    const raw = bag.getValue(Cesium.JulianDate.now());
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] =
        v && typeof (v as { getValue?: unknown }).getValue === "function"
          ? (v as Cesium.Property).getValue(Cesium.JulianDate.now())
          : v;
    }
    return out;
  }

  function installClickHandler(viewer: Cesium.Viewer): void {
    if (_clickHandler) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction(
      (click: { position: Cesium.Cartesian2 }) => {
        if (!_enabled || !_dataSource) return;
        const picked = viewer.scene.pick(click.position);
        const pickedId = picked?.id;
        if (!pickedId || typeof pickedId !== "object") {
          if (useGlobeStore.getState().trackedFeature?.kind === "earthquake") {
            useGlobeStore.getState().untrackFeature();
          }
          return;
        }
        const entityId = (pickedId as { id?: unknown }).id;
        if (typeof entityId !== "string" || !entityId.startsWith("earthquake:")) {
          if (useGlobeStore.getState().trackedFeature?.kind === "earthquake") {
            useGlobeStore.getState().untrackFeature();
          }
          return;
        }
        const entity = _dataSource.entities.getById(entityId);
        if (!entity) return;
        const props = entityProps(entity);
        const mag = Number(props.mag ?? 0);
        const lat = Number(props.lat ?? 0);
        const lon = Number(props.lon ?? 0);
        const depth = Number(props.depth ?? 0);
        const place = String(props.place ?? "");
        const time = Number(props.time ?? 0);
        const usgsId = props.usgsId ?? null;
        const name = `M${mag.toFixed(1)}${place ? ` - ${place}` : ""}`;
        const feature: TrackedFeature = {
          kind: "earthquake",
          id: entityId.slice("earthquake:".length),
          name,
          lat,
          lon,
          data: props,
        };
        useGlobeStore.getState().trackFeature(feature);
        // Fly to the epicenter at a fixed continental-scale altitude.
        const altitude = 1_500_000;
        viewer.scene.screenSpaceCameraController.enableInputs = false;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
          duration: 1.5,
          complete: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
          cancel: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
        });
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  async function update(viewer: Cesium.Viewer): Promise<void> {
    if (!_dataSource) return;
    let geojson: UsgsFeatureCollection;
    try {
      const response = await fetch(USGS_URL, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`USGS HTTP ${response.status}`);
      }
      geojson = (await response.json()) as UsgsFeatureCollection;
    } catch (err) {
      console.warn("[Data:Earthquakes] Fetch error:", err);
      throw new Error(
        `USGS earthquake feed unavailable (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (!geojson || !Array.isArray(geojson.features)) {
      throw new Error("Malformed USGS response");
    }

    const cesium = Cesium;
    _dataSource.entities.removeAll();
    let count = 0;

    for (const feature of geojson.features) {
      const [lon, lat, depthKm] = feature.geometry.coordinates;
      const p = feature.properties;
      const mag = p.mag;
      const place = p.place;
      const time = p.time;

      if (mag < EARTHQUAKES_MIN_MAG) continue; // Skip micro-quakes

      count++;
      const baseRadius = Math.pow(2, mag) * 1000;
      const color = depthColor(cesium, depthKm || 0);
      const isSignificant = mag >= 5.0;
      const fillAlpha = isSignificant ? 0.4 : 0.3;
      const outlineAlpha = isSignificant ? 1.0 : 0.8;

      const stableId = feature.id || `event-${count}`;
      const position = cesium.Cartesian3.fromDegrees(lon, lat);
      const entity = _dataSource.entities.add({
        id: `earthquake:${stableId}`,
        position,
        ellipse: {
          // Static axes - see the module header. A CallbackProperty here
          // re-tessellates the clamped ground geometry every frame.
          semiMajorAxis: baseRadius,
          semiMinorAxis: baseRadius,
          material: new cesium.ColorMaterialProperty(color.withAlpha(fillAlpha)),
          outline: true,
          outlineColor: color.withAlpha(outlineAlpha),
          outlineWidth: isSignificant ? 3 : 2,
          heightReference: cesium.HeightReference.CLAMP_TO_GROUND,
        },
        // Labels are drawn by the EarthquakeOverlay canvas component (GEV
        // parity: black bg, white text, vertical leader line, accent bar).
        // No Cesium label here.
        properties: {
          // The USGS event id (e.g. "us7000abcd").
          usgsId: feature.id ?? null,
          mag,
          magType: p.magType ?? null,
          place,
          time,
          updated: p.updated ?? null,
          depth: depthKm,
          lon,
          lat,
          tsunami: p.tsunami ?? 0,
          sig: p.sig ?? null,
          felt: p.felt ?? null,
          cdi: p.cdi ?? null,
          mmi: p.mmi ?? null,
          alert: p.alert ?? null,
          status: p.status ?? null,
          url: p.url ?? null,
          gap: p.gap ?? null,
          rms: p.rms ?? null,
          dmin: p.dmin ?? null,
          nst: p.nst ?? null,
          types: p.types ?? null,
        },
      });
    }
    console.log(`[Data:Earthquakes] Updated: ${count} events (M2.5+)`);
  }

  return {
    id: "earthquakes",
    name: "Earthquakes (24h)",

    async enable(ctx: LayerContext): Promise<void> {
      const { viewer } = ctx;
      _enabled = true;

      if (!_dataSource) {
        _dataSource = new Cesium.CustomDataSource("earthquakes");
        _dataSource.show = false;
        await viewer.dataSources.add(_dataSource);
      }
      _dataSource.show = true;

      // Fetch now, then poll on GEV's 60s cadence while enabled.
      await update(viewer);
      stopPoll();
      _pollTimer = setInterval(() => {
        if (!_enabled || !_dataSource) return;
        update(viewer).catch((err) => {
          console.warn("[Data:Earthquakes] Poll update failed:", err);
        });
      }, EARTHQUAKES_POLL_MS);

      // Click-to-track: install once, reused across toggles like GEV.
      installClickHandler(viewer);
    },

    disable(ctx: LayerContext): void {
      _enabled = false;
      stopPoll();
      removeClickHandler();
      // Clear tracking if an earthquake is currently tracked.
      if (useGlobeStore.getState().trackedFeature?.kind === "earthquake") {
        useGlobeStore.getState().untrackFeature();
      }
      // GEV keeps the parsed source and just hides it (data retained).
      if (_dataSource) _dataSource.show = false;
    },

    getStats() {
      return {
        count: _dataSource ? _dataSource.entities.values.length : 0,
        enabled: _enabled,
      };
    },

    // Exposed for the right-panel browse list. Has closure access to
    // _dataSource, unlike an external getter.
    getTopFeatures(limit = 10): TrackedFeature[] {
      if (!_dataSource || !_dataSource.show) return [];
      const now = Cesium.JulianDate.now();
      const records: TrackedFeature[] = [];
      for (const entity of _dataSource.entities.values) {
        const bag = entity.properties as unknown as
          | (Cesium.PropertyBag & { getValue?: (t: Cesium.JulianDate) => Record<string, unknown> })
          | null;
        if (!bag || typeof bag.getValue !== "function") continue;
        const raw = bag.getValue(now);
        const get = (k: string): unknown => {
          const v = raw[k];
          return v && typeof (v as { getValue?: unknown }).getValue === "function"
            ? (v as Cesium.Property).getValue(now)
            : v;
        };
        const mag = Number(get("mag") ?? 0);
        const lat = Number(get("lat") ?? 0);
        const lon = Number(get("lon") ?? 0);
        const id = String(entity.id ?? "").slice("earthquake:".length) || `eq-${records.length}`;
        // Pass the full property bag so the detail panel has everything.
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(raw)) {
          data[k] = get(k);
        }
        records.push({
          kind: "earthquake",
          id,
          name: String(get("place") ?? `M${mag.toFixed(1)}`),
          lat,
          lon,
          data,
        });
      }
      records.sort((a, b) => Number(b.data.mag) - Number(a.data.mag));
      return records.slice(0, Math.max(0, limit));
    },
  };
})();

/**
 * Top-N earthquakes by magnitude, as TrackedFeature records for the right
 * panel browse list. Delegates to the layer's closure-scoped getTopFeatures.
 */
export function earthquakesGetTopFeatures(limit = 10): TrackedFeature[] {
  return earthquakesLayer.getTopFeatures(limit);
}

// =============================================================================
// 2. civilUnrestLayer - multi-source civil unrest feed (11 sources, 48h fresh)
//
// Fetches /api/events which aggregates GDELT, ACLED, RSS, YouTube, Reddit,
// Telegram, Mastodon, UCDP, ReliefWeb, CIVICUS, and FIRMS. Returns a
// GeoJSON FeatureCollection with landmark-refined coordinates, clustering,
// crowd size, and anarchy probability. Events are rendered as ground-clamped
// point entities inside a CustomDataSource
// named "civil-unrest" so the CivilUnrestOverlay canvas component can find
// them by name and draw infra-style tag cards. Click-to-track opens the
// right FeatureDetailPanel (kind "unrest"), no popups.
// =============================================================================

const GDELT_URL = "/api/events";
const UNREST_POLL_MS = 15 * 60 * 1000; // 15 min
const UNREST_LABEL_MAX = 34;

// Accent color by event type (matches Spectre v1 verification palette).
const UNREST_TYPE_COLOR: Record<string, string> = {
  riot: "#ff4d4d",
  shutdown: "#ff7a3d",
  arrest: "#ffdd44",
  protest: "#ffaa33",
  other: "#ffaa33",
};

interface GdeltFeatureCollection {
  type: "FeatureCollection";
  features: GdeltFeature[];
}
interface GdeltFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    title: string;
    url: string;
    seendate: string;
    country: string;
    domain: string;
    lat: number;
    lon: number;
    type: string;
    ageHours: number;
    eventTime: number;
    articleCount: number;
    crowdSize: number;
    crowdLabel: string;
    anarchyProbability: number;
    landmark: string;
    sources: Array<{ title: string; url: string; domain: string }>;
  };
}

export const civilUnrestLayer: LayerImpl = (() => {
  let _dataSource: Cesium.CustomDataSource | null = null;
  let _enabled = false;
  let _pollTimer: ReturnType<typeof setInterval> | null = null;
  let _clickHandler: Cesium.ScreenSpaceEventHandler | null = null;
  let _preRenderRemover: (() => void) | null = null;

  function stopPoll(): void {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  function removeClickHandler(): void {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
  }

  function entityProps(entity: Cesium.Entity): Record<string, unknown> {
    const bag = entity.properties as unknown as
      | (Cesium.PropertyBag & { getValue?: (t: Cesium.JulianDate) => Record<string, unknown> })
      | null;
    if (!bag || typeof bag.getValue !== "function") return {};
    const raw = bag.getValue(Cesium.JulianDate.now());
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] =
        v && typeof (v as { getValue?: unknown }).getValue === "function"
          ? (v as Cesium.Property).getValue(Cesium.JulianDate.now())
          : v;
    }
    return out;
  }

  function installClickHandler(viewer: Cesium.Viewer): void {
    if (_clickHandler) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction(
      (click: { position: Cesium.Cartesian2 }) => {
        if (!_enabled || !_dataSource) return;
        const picked = viewer.scene.pick(click.position);
        const pickedId = picked?.id;
        if (!pickedId || typeof pickedId !== "object") {
          if (useGlobeStore.getState().trackedFeature?.kind === "unrest") {
            useGlobeStore.getState().untrackFeature();
          }
          return;
        }
        const entityId = (pickedId as { id?: unknown }).id;
        if (typeof entityId !== "string" || !entityId.startsWith("unrest:")) {
          if (useGlobeStore.getState().trackedFeature?.kind === "unrest") {
            useGlobeStore.getState().untrackFeature();
          }
          return;
        }
        const entity = _dataSource.entities.getById(entityId);
        if (!entity) return;
        const props = entityProps(entity);
        const lat = Number(props.lat ?? 0);
        const lon = Number(props.lon ?? 0);
        const title = String(props.title ?? "Untitled");
        const feature: TrackedFeature = {
          kind: "unrest",
          id: entityId.slice("unrest:".length),
          name: title,
          lat,
          lon,
          data: props,
        };
        useGlobeStore.getState().trackFeature(feature);
        // Fly to the event at street-level altitude.
        const altitude = 5_000;
        viewer.scene.screenSpaceCameraController.enableInputs = false;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
          duration: 1.5,
          complete: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
          cancel: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
        });
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  async function update(viewer: Cesium.Viewer): Promise<void> {
    if (!_dataSource) return;
    let geojson: GdeltFeatureCollection;
    try {
      const response = await fetch(GDELT_URL, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`GDELT HTTP ${response.status}`);
      }
      geojson = (await response.json()) as GdeltFeatureCollection;
    } catch (err) {
      console.warn("[Data:CivilUnrest] Fetch error:", err);
      throw new Error(
        `GDELT civil unrest feed unavailable (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (!geojson || !Array.isArray(geojson.features)) {
      throw new Error("Malformed GDELT response");
    }

    _dataSource.entities.removeAll();
    let count = 0;

    for (let i = 0; i < geojson.features.length; i++) {
      const f = geojson.features[i];
      if (!f || f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const p = f.properties;
      const type = p.type ?? "other";
      const colorCss = UNREST_TYPE_COLOR[type] ?? UNREST_TYPE_COLOR.other;
      const color = Cesium.Color.fromCssColorString(colorCss);
      const ageHours = Number(p.ageHours ?? 0);
      const articleCount = Number(p.articleCount ?? 1);
      const crowdLabel = String(p.crowdLabel ?? "Unknown");
      const anarchyProb = Number(p.anarchyProbability ?? 0);
      const landmark = String(p.landmark ?? "");

      // Priority: anarchy probability is the primary signal, with freshness
      // as a tiebreaker. Higher anarchy = more visible on the globe.
      let priority = anarchyProb * 20;
      priority += 1000 - Math.round(ageHours * 10);
      if (type === "riot") priority += 200;
      if (ageHours < 6) priority += 150;
      if (articleCount > 1) priority += articleCount * 20;

      // Build a richer label: title + article count + crowd size.
      // e.g. "Riots at Tahrir Square [3 art] [10K+]"
      const titleBase = truncate(p.title ?? "Untitled", UNREST_LABEL_MAX);
      const countTag = articleCount > 1 ? ` [${articleCount} art]` : "";
      const crowdTag = crowdLabel !== "Unknown" ? ` [${crowdLabel}]` : "";
      const label = `${titleBase}${countTag}${crowdTag}`;

      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

      // Dot size scales with anarchy probability.
      const baseSize = type === "riot" ? 8 : type === "shutdown" ? 7 : 6;
      const pixelSize = baseSize + Math.round(anarchyProb / 20);

      const entity = _dataSource.entities.add({
        id: `unrest:${i}`,
        position,
        point: {
          pixelSize,
          color,
          outlineColor: Cesium.Color.fromBytes(5, 6, 10, 220),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          title: p.title ?? "",
          url: p.url ?? "",
          seendate: p.seendate ?? "",
          country: p.country ?? "",
          domain: p.domain ?? "",
          lat,
          lon,
          type,
          ageHours,
          eventTime: p.eventTime ?? 0,
          articleCount,
          crowdSize: Number(p.crowdSize ?? 0),
          crowdLabel,
          anarchyProbability: anarchyProb,
          landmark,
          sources: p.sources ?? [],
        },
      });

      // Tag the entity for the overlay canvas component.
      (entity as { __labelText?: string }).__labelText = label;
      (entity as { __priority?: number }).__priority = priority;
      (entity as { __unrestType?: string }).__unrestType = type;
      count++;
    }

    console.log(`[Data:CivilUnrest] Updated: ${count} clusters (48h)`);
  }

  return {
    id: "civil-unrest",
    name: "Civil Unrest (48h)",

    async enable(ctx: LayerContext): Promise<void> {
      const { viewer } = ctx;
      _enabled = true;

      if (!_dataSource) {
        _dataSource = new Cesium.CustomDataSource("civil-unrest");
        _dataSource.show = false;
        await viewer.dataSources.add(_dataSource);
      }
      _dataSource.show = true;

      // Fetch now, then poll while enabled.
      await update(viewer);
      stopPoll();
      _pollTimer = setInterval(() => {
        if (!_enabled || !_dataSource) return;
        update(viewer).catch((err) => {
          console.warn("[Data:CivilUnrest] Poll update failed:", err);
        });
      }, UNREST_POLL_MS);

      installClickHandler(viewer);

      // preRender occluder: hide points behind the globe.
      if (!_preRenderRemover) {
        _preRenderRemover = viewer.scene.preRender.addEventListener(() => {
          if (!_enabled || !_dataSource) return;
          const cameraPos = viewer.camera.positionWC;
          if (!cameraPos) return;
          const occluder = new (Cesium as unknown as {
            EllipsoidalOccluder: new (
              ellipsoid: Cesium.Ellipsoid,
              camera: Cesium.Cartesian3,
            ) => { isPointVisible: (point: Cesium.Cartesian3) => boolean };
          }).EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, cameraPos);
          const now = Cesium.JulianDate.now();
          for (const entity of _dataSource.entities.values) {
            const pos = entity.position?.getValue(now);
            if (!pos) continue;
            const visible = occluder.isPointVisible(pos);
            if (entity.show !== visible) entity.show = visible;
          }
        });
      }
    },

    disable(ctx: LayerContext): void {
      _enabled = false;
      stopPoll();
      removeClickHandler();
      if (_preRenderRemover) {
        _preRenderRemover();
        _preRenderRemover = null;
      }
      if (useGlobeStore.getState().trackedFeature?.kind === "unrest") {
        useGlobeStore.getState().untrackFeature();
      }
      if (_dataSource) _dataSource.show = false;
    },

    getStats() {
      return {
        count: _dataSource ? _dataSource.entities.values.length : 0,
        enabled: _enabled,
      };
    },

    getTopFeatures(limit = 10): TrackedFeature[] {
      if (!_dataSource || !_dataSource.show) return [];
      const now = Cesium.JulianDate.now();
      const records: TrackedFeature[] = [];
      for (const entity of _dataSource.entities.values) {
        const props = entityProps(entity);
        const priority = (entity as { __priority?: number }).__priority ?? 0;
        records.push({
          kind: "unrest",
          id: String(entity.id ?? "").slice("unrest:".length) || `unrest-${records.length}`,
          name: String(props.title ?? "Untitled"),
          lat: Number(props.lat ?? 0),
          lon: Number(props.lon ?? 0),
          data: { ...props, _priority: priority },
        });
      }
      records.sort((a, b) => Number(b.data._priority ?? 0) - Number(a.data._priority ?? 0));
      return records.slice(0, Math.max(0, limit));
    },

    // Aggregate events by country and compute an instability score per
    // country, like Spectre v1's InstabilityPanel. Returns top-N countries
    // sorted by score descending.
    getTopCountries(limit = 10): UnrestCountryScore[] {
      if (!_dataSource || !_dataSource.show) return [];
      const map = new Map<string, UnrestCountryScore>();
      for (const entity of _dataSource.entities.values) {
        const props = entityProps(entity);
        const country = String(props.country ?? "Unknown");
        if (!country || country === "Unknown") continue;
        const type = String(props.type ?? "other");
        const ageHours = Number(props.ageHours ?? 99);
        const crowdSize = Number(props.crowdSize ?? 0);
        const anarchyProb = Number(props.anarchyProbability ?? 0);

        // Score: type weight * time decay * crowd factor + anarchy bonus.
        const typeWeight: Record<string, number> = { riot: 3, shutdown: 2, arrest: 1, protest: 1, other: 0.5 };
        const base = typeWeight[type] ?? 0.5;
        let mult = 1;
        if (ageHours < 6) mult *= 1.5;
        else if (ageHours < 24) mult *= 1.3;
        else if (ageHours < 48) mult *= 1.1;
        if (crowdSize >= 100_000) mult *= 1.8;
        else if (crowdSize >= 10_000) mult *= 1.5;
        else if (crowdSize >= 1_000) mult *= 1.2;
        const score = base * mult + anarchyProb / 100;

        const existing = map.get(country);
        if (existing) {
          existing.score += score;
          existing.eventCount += 1;
          if (anarchyProb > existing.topAnarchy) existing.topAnarchy = anarchyProb;
          if (crowdSize > existing.topCrowd) existing.topCrowd = crowdSize;
          // Track the most volatile type.
          const rank: Record<string, number> = { riot: 4, shutdown: 3, arrest: 2, protest: 1, other: 0 };
          if ((rank[type] ?? 0) > (rank[existing.topType] ?? 0)) existing.topType = type;
          // Keep the most recent event's coords and title.
          if (ageHours < existing.ageHours) {
            existing.ageHours = ageHours;
            existing.lat = Number(props.lat ?? 0);
            existing.lon = Number(props.lon ?? 0);
            existing.recentTitle = String(props.title ?? "");
          }
        } else {
          map.set(country, {
            country,
            score,
            eventCount: 1,
            topType: type,
            topAnarchy: anarchyProb,
            topCrowd: crowdSize,
            ageHours,
            lat: Number(props.lat ?? 0),
            lon: Number(props.lon ?? 0),
            recentTitle: String(props.title ?? ""),
          });
        }
      }
      const arr = Array.from(map.values()).sort((a, b) => b.score - a.score);
      return arr.slice(0, Math.max(0, limit));
    },
  };
})();

/**
 * Top-N civil unrest events by freshness, as TrackedFeature records for the
 * right panel browse list. Delegates to the layer's closure-scoped getter.
 */
export function civilUnrestGetTopFeatures(limit = 10): TrackedFeature[] {
  return civilUnrestLayer.getTopFeatures(limit);
}

export interface UnrestCountryScore {
  country: string;
  score: number;
  eventCount: number;
  topType: string;
  topAnarchy: number;
  topCrowd: number;
  ageHours: number;
  lat: number;
  lon: number;
  recentTitle: string;
}

/**
 * Top-N countries by instability score, like Spectre v1's InstabilityPanel.
 */
export function civilUnrestGetTopCountries(limit = 10): UnrestCountryScore[] {
  return civilUnrestLayer.getTopCountries(limit);
}
