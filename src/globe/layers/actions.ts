import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "./types";
import {
  loadRegionData,
  setRegionEnabled,
  setActiveScope,
  type RegionData,
} from "../region-index";
import { useGlobeStore } from "@/store/globe-store";

// Country / state / continent borders layer - thin neon strokes along
// boundaries, loaded from bundled world GeoJSON (Natural Earth 10m,
// simplified). Three data sources share this layer:
//   - "continent-borders": 7 continent outlines (visible on load, no selection)
//   - "country-borders":   national boundaries for the focused continent
//   - "state-borders":     admin-1 state/province boundaries for the focused
//                          country
//
// Levelling is selection-driven:
//   - No selection: continent borders visible, hover resolves continents.
//   - Continent selected: that continent's country borders visible, hover
//     resolves countries within the continent.
//   - Country selected: that country's state borders visible, hover
//     resolves states within the country.
//
// The admin1 GeoJSON (~4MB) is pre-loaded in the background right after
// borders enable, so state borders are ready instantly when a country is
// selected. The region hover index is refreshed once admin1 data arrives.
//
// NOTE: borders are rendered as ground-clamped POLYLINES, not polygon
// outlines. Cesium does not draw outlines on clampToGround polygons, so a
// polygon-outline approach would leave only the (near-invisible) fill.

const BORDER_COLOR = Cesium.Color.fromBytes(255, 255, 255, 200);
const BORDER_WIDTH = 2.5;
const STATE_BORDER_COLOR = Cesium.Color.fromBytes(255, 255, 255, 100);
const STATE_BORDER_WIDTH = 1.0;
const CONTINENT_BORDER_COLOR = Cesium.Color.fromBytes(255, 255, 255, 160);
const CONTINENT_BORDER_WIDTH = 2.0;

const CONTINENTS_URL = "/data/continents.geojson";
const COUNTRIES_URL = "/data/countries.geo.json";
const STATES_URL = "/data/admin1.geojson";
const COUNTRY_INFO_URL = "/data/country-info.json";
const STATE_INFO_URL = "/data/state-info.json";

type GeoFeature = {
  properties?: { name?: string };
  geometry: {
    type: string;
    coordinates: number[][][][] | number[][][];
  } | null;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[borders] ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

// Reduce Polygon / MultiPolygon coordinates down to their outer rings,
// which trace the boundaries we want as strokes.
function collectRings(coords: number[][][][] | number[][][]): number[][][] {
  const rings: number[][][] = [];
  if (!coords?.length) return rings;
  const first = coords[0];
  const isMulti = first.length && Array.isArray(first[0]) && Array.isArray(first[0][0]);
  if (isMulti) {
    for (const poly of coords as number[][][][]) {
      if (poly.length) rings.push(poly[0]);
    }
  } else {
    for (const ring of coords as number[][][]) {
      rings.push(ring);
    }
  }
  return rings;
}

/**
 * Country / state borders layer.
 * Two-level ground-clamped neon-cyan polylines with camera-driven
 * auto-switching between country and state borders. Also feeds the
 * region hover index (country + state popups) via region-index.
 */
export const bordersLayer: LayerImpl = {
  _viewer: null as Cesium.Viewer | null,
  _continentDs: null as Cesium.CustomDataSource | null,
  _countryDs: null as Cesium.CustomDataSource | null,
  _stateDs: null as Cesium.CustomDataSource | null,
  _loaded: false,
  _statesDataReady: false,
  _statesLoading: false,
  _removeCameraMove: null as (() => void) | null,
  _cachedContinentsGeo: null as { features: GeoFeature[] } | null,
  _cachedCountriesGeo: null as { features: GeoFeature[] } | null,
  _cachedStatesGeo: null as { features: GeoFeature[] } | null,
  _cachedCountryInfo: null as Record<string, unknown> | null,
  _cachedStateInfo: null as Record<string, unknown> | null,
  _focusedContinent: null as string | null,
  _focusedCountry: null as string | null,
  _ctx: null as LayerContext | null,

  _addFeature(
    ds: Cesium.CustomDataSource,
    feature: GeoFeature,
    width: number,
    color: Cesium.Color,
    cesium: typeof Cesium,
  ): void {
    const geom = feature?.geometry;
    if (!geom) return;
    for (const ring of collectRings(geom.coordinates)) {
      const positions = ring.map((p) => cesium.Cartesian3.fromDegrees(p[0], p[1], 0));
      if (positions.length < 2) continue;
      ds.entities.add({
        polyline: {
          positions,
          clampToGround: true,
          width,
          material: color,
        },
      });
    }
  },

  // Pre-load admin1 GeoJSON in the background. Caches the data but does NOT
  // create entities. State border entities are created per-country on
  // selection via _showStatesForCountry.
  async _preloadStates(): Promise<void> {
    if (this._statesDataReady || this._statesLoading) return;
    this._statesLoading = true;
    try {
      const [statesGeo, stateInfo] = await Promise.all([
        fetchJson<{ features: GeoFeature[] }>(STATES_URL),
        fetchJson<Record<string, unknown>>(STATE_INFO_URL),
      ]);
      this._cachedStatesGeo = statesGeo;
      this._cachedStateInfo = stateInfo;

      // Refresh the region-index with all data including states.
      if (this._cachedCountriesGeo && this._cachedCountryInfo) {
        loadRegionData({
          continentsGeo: this._cachedContinentsGeo as RegionData["continentsGeo"],
          countriesGeo: this._cachedCountriesGeo as RegionData["countriesGeo"],
          statesGeo: statesGeo as RegionData["statesGeo"],
          countryInfo: this._cachedCountryInfo as RegionData["countryInfo"],
          stateInfo: stateInfo as RegionData["stateInfo"],
        });
      }

      this._statesDataReady = true;
      console.log("[borders] admin1 data pre-loaded in background");

      // If a country was already focused before data arrived, show its
      // state borders now.
      if (this._focusedCountry && this._stateDs && this._ctx) {
        this._showStatesForCountry(this._focusedCountry);
      }
    } catch (err) {
      console.error("[borders] failed to pre-load admin1 states GeoJSON", err);
    } finally {
      this._statesLoading = false;
    }
  },

  // Show country borders for a single continent. Clears any existing
  // country border entities, then filters the cached countries data by
  // the CONTINENT property.
  _showCountriesForContinent(continentName: string): void {
    const viewer = this._viewer;
    const cesium = Cesium;
    if (!viewer || viewer.isDestroyed() || !this._countryDs) return;
    if (!this._cachedCountriesGeo) return;

    this._countryDs.entities.removeAll();

    let count = 0;
    for (const feature of this._cachedCountriesGeo.features) {
      const continent = (feature as any)?.properties?.CONTINENT;
      if (continent !== continentName) continue;
      this._addFeature(this._countryDs, feature, BORDER_WIDTH, BORDER_COLOR, cesium);
      count++;
    }

    this._focusedContinent = continentName;
    this._countryDs.show = count > 0;
    viewer.scene.requestRender();
    console.log(`[borders] showing ${count} country border features for ${continentName}`);
  },

  // Show state borders for a single country. Clears any existing state
  // border entities, then filters the cached admin1 data by the country
  // name (matching the `admin` property).
  _showStatesForCountry(countryName: string): void {
    const viewer = this._viewer;
    const cesium = Cesium;
    if (!viewer || viewer.isDestroyed() || !this._stateDs) return;
    if (!this._statesDataReady || !this._cachedStatesGeo) {
      this._focusedCountry = countryName;
      return;
    }

    this._stateDs.entities.removeAll();

    let count = 0;
    for (const feature of this._cachedStatesGeo.features) {
      const admin = (feature as any)?.properties?.admin;
      if (admin !== countryName) continue;
      this._addFeature(this._stateDs, feature, STATE_BORDER_WIDTH, STATE_BORDER_COLOR, cesium);
      count++;
    }

    this._focusedCountry = countryName;
    this._stateDs.show = count > 0;
    viewer.scene.requestRender();
    console.log(`[borders] showing ${count} state border features for ${countryName}`);
  },

  // Clear country border entities (when going back to continent view).
  _clearCountryEntities(): void {
    const viewer = this._viewer;
    if (!viewer || viewer.isDestroyed() || !this._countryDs) return;
    this._countryDs.entities.removeAll();
    this._countryDs.show = false;
    this._focusedContinent = null;
    viewer.scene.requestRender();
  },

  // Clear state border entities (when going back to continent/country view).
  _clearStateEntities(): void {
    const viewer = this._viewer;
    if (!viewer || viewer.isDestroyed() || !this._stateDs) return;
    this._stateDs.entities.removeAll();
    this._stateDs.show = false;
    this._focusedCountry = null;
    viewer.scene.requestRender();
  },

  // Determine the focused continent from store state.
  _resolveFocusedContinent(): string | null {
    const store = useGlobeStore.getState();
    if (store.selectedRegion?.level === "continent") {
      return (store.selectedRegion.info as any)?.name ?? null;
    }
    if (store.activeContinent) {
      return store.activeContinent;
    }
    return null;
  },

  // Determine the focused country from store state.
  _resolveFocusedCountry(): string | null {
    const store = useGlobeStore.getState();
    if (store.selectedRegion?.level === "country") {
      return (store.selectedRegion.info as any)?.name ?? null;
    }
    if (store.activeCountry) {
      return store.activeCountry;
    }
    return null;
  },

  async enable(ctx: LayerContext): Promise<void> {
    const { viewer, Cesium } = ctx;
    if (viewer.isDestroyed()) return;
    if (this._loaded) return;

    this._viewer = viewer;
    this._loaded = true;
    this._ctx = ctx;

    try {
      // Load continents + countries + metadata immediately. Admin1 (states)
      // is pre-loaded in the background.
      const [continentsGeo, countriesGeo, countryInfo, stateInfo] = await Promise.all([
        fetchJson<{ features: GeoFeature[] }>(CONTINENTS_URL),
        fetchJson<{ features: GeoFeature[] }>(COUNTRIES_URL),
        fetchJson<Record<string, unknown>>(COUNTRY_INFO_URL),
        fetchJson<Record<string, unknown>>(STATE_INFO_URL),
      ]);

      this._cachedContinentsGeo = continentsGeo;
      this._cachedCountriesGeo = countriesGeo;
      this._cachedCountryInfo = countryInfo;
      this._cachedStateInfo = stateInfo;

      // Build the hover resolution index with continents + countries.
      // States will be registered when admin1 data finishes pre-loading.
      loadRegionData({
        continentsGeo: continentsGeo as RegionData["continentsGeo"],
        countriesGeo: countriesGeo as RegionData["countriesGeo"],
        statesGeo: { features: [] } as RegionData["statesGeo"],
        countryInfo: countryInfo as RegionData["countryInfo"],
        stateInfo: stateInfo as RegionData["stateInfo"],
      });

      // Create three data sources: continents, countries, states.
      // Only continents are visible initially (no selection).
      const contDs = new Cesium.CustomDataSource("continent-borders");
      const cDs = new Cesium.CustomDataSource("country-borders");
      const sDs = new Cesium.CustomDataSource("state-borders");

      // Populate continent borders (always present, shown when no selection)
      for (const feature of continentsGeo.features) {
        const name = (feature as any)?.properties?.CONTINENT;
        if (!name || name === "Seven seas (open ocean)") continue;
        this._addFeature(contDs, feature, CONTINENT_BORDER_WIDTH, CONTINENT_BORDER_COLOR, Cesium);
      }

      if (viewer.isDestroyed()) return;
      this._continentDs = contDs;
      this._countryDs = cDs;
      this._stateDs = sDs;

      // Initial state: continent borders visible, countries/states hidden.
      contDs.show = true;
      cDs.show = false;
      sDs.show = false;
      viewer.dataSources.add(contDs);
      viewer.dataSources.add(cDs);
      viewer.dataSources.add(sDs);

      // Set initial hover scope to continent level.
      setActiveScope({ level: "continent" });

      // Pre-load admin1 data in the background (non-blocking).
      this._preloadStates();

      // Gate the hover region resolver on layer visibility.
      setRegionEnabled(true);

      // Update border visibility based on the current selection state.
      // This is the core levelling logic:
      //   - No selection: continent borders, hover resolves continents
      //   - Continent selected: that continent's country borders, hover
      //     resolves countries within the continent
      //   - Country selected: that country's state borders, hover resolves
      //     states within the country
      const updateBordersVisibility = () => {
        if (viewer.isDestroyed()) return;
        const store = useGlobeStore.getState();
        const sel = store.selectedRegion;
        const focusedContinent = this._resolveFocusedContinent();
        const focusedCountry = this._resolveFocusedCountry();

        if (focusedCountry) {
          // Country selected: show state borders for that country.
          if (this._focusedCountry !== focusedCountry) {
            this._showStatesForCountry(focusedCountry);
          }
          // Hide continent and country borders (highlight polygon replaces).
          const fromGlobeClick = sel?.level === "country";
          contDs.show = false;
          cDs.show = !fromGlobeClick && this._focusedContinent !== null;
          // Set hover scope to state level for this country.
          setActiveScope({ level: "state", country: focusedCountry });
        } else if (focusedContinent) {
          // Continent selected: show country borders for that continent.
          if (this._focusedContinent !== focusedContinent) {
            this._showCountriesForContinent(focusedContinent);
          }
          // Hide continent borders, show country borders.
          contDs.show = false;
          cDs.show = true;
          sDs.show = false;
          if (this._focusedCountry) this._clearStateEntities();
          // Set hover scope to country level for this continent.
          setActiveScope({ level: "country", continent: focusedContinent });
        } else {
          // No selection: show continent borders only.
          contDs.show = true;
          cDs.show = false;
          sDs.show = false;
          if (this._focusedContinent) this._clearCountryEntities();
          if (this._focusedCountry) this._clearStateEntities();
          setActiveScope({ level: "continent" });
        }
        viewer.scene.requestRender();
      };

      updateBordersVisibility();

      // Subscribe to store: when region selection or active location changes,
      // update border visibility immediately. This is the primary driver for
      // the levelling.
      const unsubStore = useGlobeStore.subscribe(() => {
        const store = useGlobeStore.getState();
        const focusedContinent = this._resolveFocusedContinent();
        const focusedCountry = this._resolveFocusedCountry();
        const sel = store.selectedRegion;
        const prevContinent = (this as any)._prevContinent ?? null;
        const prevCountry = (this as any)._prevCountry ?? null;
        const prevSelKey = (this as any)._prevSelKey ?? "";
        const selKey = sel ? `${sel.level}:${(sel.info as any)?.name ?? ""}` : "";
        const continentKey = focusedContinent ?? "";
        const countryKey = focusedCountry ?? "";
        if (
          continentKey !== prevContinent ||
          countryKey !== prevCountry ||
          selKey !== prevSelKey
        ) {
          (this as any)._prevContinent = continentKey;
          (this as any)._prevCountry = countryKey;
          (this as any)._prevSelKey = selKey;
          updateBordersVisibility();
        }
      });
      this._removeCameraMove = () => {
        unsubStore();
      };
      viewer.scene.requestRender();
    } catch (err) {
      console.error("[borders] failed to load GeoJSON", err);
      this._loaded = false;
    }
  },

  disable(ctx: LayerContext): void {
    const { viewer } = ctx;
    setRegionEnabled(false);
    setActiveScope(null);
    try {
      const s = useGlobeStore.getState();
      if (s.selectedRegion) s.clearRegion();
    } catch {}
    this._removeCameraMove?.();
    this._removeCameraMove = null;
    if (viewer && !viewer.isDestroyed()) {
      if (this._continentDs) viewer.dataSources.remove(this._continentDs, true);
      if (this._countryDs) viewer.dataSources.remove(this._countryDs, true);
      if (this._stateDs) viewer.dataSources.remove(this._stateDs, true);
      viewer.scene.requestRender();
    }
    this._continentDs = null;
    this._countryDs = null;
    this._stateDs = null;
    this._viewer = null;
    this._ctx = null;
    this._loaded = false;
    this._statesDataReady = false;
    this._statesLoading = false;
    this._cachedContinentsGeo = null;
    this._cachedCountriesGeo = null;
    this._cachedStatesGeo = null;
    this._cachedCountryInfo = null;
    this._cachedStateInfo = null;
    this._focusedContinent = null;
    this._focusedCountry = null;
  },
};

/**
 * Google 3D Tiles layer.
 * Prefers the Cesium Ion Google Photorealistic 3D Tiles asset
 * (no Google API key required, only a Cesium Ion access token).
 * Falls back to an explicit Ion asset id if the helper is unavailable.
 */
export const googleTilesLayer: LayerImpl = {
  tileset: undefined as Cesium.Cesium3DTileset | undefined,

  async enable(ctx: LayerContext): Promise<void> {
    const { viewer, Cesium } = ctx;
    if (viewer.isDestroyed()) return;

    let tileset: Cesium.Cesium3DTileset | undefined;

    // Set the Google Maps API key first so that
    // createGooglePhotorealistic3DTileset uses the Google Maps API
    // directly instead of falling back to an Ion asset.
    const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (googleApiKey && (Cesium as any).GoogleMaps) {
      (Cesium as any).GoogleMaps.defaultApiKey = googleApiKey;
    }

    // Preferred: Cesium's built-in Google Photorealistic 3D Tiles helper.
    // With the API key set above, this uses Google Maps directly.
    if (typeof (Cesium as any).createGooglePhotorealistic3DTileset === "function") {
      try {
        tileset = await (Cesium as any).createGooglePhotorealistic3DTileset({
          onlyUsingWithGoogleGeocoder: true,
        });
      } catch (err) {
        console.warn(
          "[googleTilesLayer] createGooglePhotorealistic3DTileset failed:",
          err
        );
      }
    }

    // Fallback: GoogleMaps3DTileset with an explicit Google API key.
    if (!tileset && googleApiKey) {
      try {
        const GoogleMaps3DTileset = (Cesium as any).GoogleMaps3DTileset;
        if (GoogleMaps3DTileset?.fromGoogleMapsEnterprise) {
          tileset = await GoogleMaps3DTileset.fromGoogleMapsEnterprise({
            key: googleApiKey,
          });
        } else if (GoogleMaps3DTileset) {
          tileset = new GoogleMaps3DTileset({
            key: googleApiKey,
          });
        }
      } catch (err) {
        console.warn(
          "[googleTilesLayer] GoogleMaps3DTileset failed:",
          err
        );
      }
    }

    // Fallback 2: Direct Ion asset id for Google Photorealistic 3D Tiles.
    if (!tileset) {
      try {
        const resource = await Cesium.IonResource.fromAssetId(2275207);
        tileset = new (Cesium.Cesium3DTileset as any)({ url: resource });
      } catch (err) {
        console.error(
          "[googleTilesLayer] Ion asset fallback failed:",
          err
        );
        throw new Error("Failed to load 3D tiles");
      }
    }

    if (!tileset || viewer.isDestroyed()) return;

    viewer.scene.primitives.add(tileset);
    this.tileset = tileset;
  },

  disable(ctx: LayerContext): void {
    const { viewer } = ctx;
    const ts = this.tileset;
    this.tileset = undefined;
    if (!ts) return;
    if (viewer.isDestroyed()) {
      if (!ts.isDestroyed()) ts.destroy();
      return;
    }
    viewer.scene.primitives.remove(ts);
    if (!ts.isDestroyed()) ts.destroy();
  },
};
