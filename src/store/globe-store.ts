"use client";

import { create } from "zustand";
import type { ProtestEvent } from "@/lib/types";
import type { RegionHit } from "@/globe/region-index";
import type { CctvCamera } from "@/lib/sources/cctv";

// Format a Date as YYYY-MM-DD in LOCAL time (not UTC).
// toISOString() converts to UTC which shifts the date backwards
// in positive-UTC-offset timezones (e.g. UTC+7 Jakarta).
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type HoveredKind =
  | "cctv"
  | "event"
  | "flight-private"
  | "flight-mil"
  | "building"
  | "region"
  | "satellite"
  | null;

export type SelectedKind =
  | "flight-private"
  | "flight-mil"
  | null;

export interface HoverPos {
  x: number;
  y: number;
}

export interface SavedView {
  lat: number;
  lon: number;
  height: number;
  heading: number;
  pitch: number;
}

export interface GlobeState {
  // Hover state — populated by globe/controls/hover.ts
  hoveredCctvId: string | null;
  hoveredEventId: string | null;
  hoveredFlightId: string | null;
  // Hovered building feature data (OSM Buildings 3D tiles) — name/height/
  // type tags read straight off the picked Cesium3DTileFeature.
  hoveredBuilding: {
    name: string | null;
    height: number | null;
    building: string | null;
    elementId: string | null;
    addrStreet: string | null;
    addrHouse: string | null;
  } | null;
  hoverPos: HoverPos | null;
  hoveredKind: HoveredKind;
  // Region under the cursor (country or state, chosen by camera height) —
  // populated by globe/controls/hover.ts when the borders layer is visible.
  hoveredRegion: RegionHit | null;
  hoveredSatelliteId: string | null;

  // Selection state — populated by globe/controls/click.ts. A click on a
  // flight billboard selects it so FlightTrajectoryOverlay can fetch +
  // render its trajectory. Cleared by clicking empty space or the popup's X.
  selectedFlightId: string | null;
  selectedKind: SelectedKind;
  selectedAt: { x: number; y: number } | null;

  // Panel open state — lifted from TacticalHUD (sidebarOpen) and
  // CityBookmarks (panelOpen) so the CircleMask can compute its diameter
  // without prop drilling. Both default to open.
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  replayPanelOpen: boolean;

  // Active city (last flown-to from CityBookmarks)
  activeCity: string | null;

  // Saved camera views per city — persisted to localStorage
  savedViews: Record<string, SavedView>;

  // Layer visibility — keyed by layer id
  layerVisibility: Record<string, boolean>;

  // Which CCTV sources (providers) are enabled. Keyed by provider name.
  cctvSources: Record<string, boolean>;

  // Per-source camera count for the currently active city. Updated by the
  // globe's CCTV filter whenever cameras are re-filtered. Used by the
  // CityBookmarks source panel to sort by count and show a badge.
  cctvSourceCounts: Record<string, number>;
  cctvCatalogLoaded: boolean;
  setCctvCatalogLoaded: (loaded: boolean) => void;
  cctvCameras: CctvCamera[];
  setCctvCameras: (cameras: CctvCamera[]) => void;

  // Camera altitude in meters — updated on camera move. Used by InstabilityPanel
  // to switch between country-level and state-level grouping.
  cameraAltitude: number;
  setCameraAltitude: (alt: number) => void;

  // Layer loading state — true while a layer is fetching/rendering data
  layerLoading: Record<string, boolean>;

  // Latest civil-unrest events fetched by the globe's events layer (already
  // bbox-filtered to the current viewport). The hover popup resolves hovered
  // cluster ids against this same array so it never shows events the globe
  // didn't render.
  events: ProtestEvent[];

  // Private-flight tracking: the callsign (tail number) the user has chosen
  // to follow, e.g. "N628TS" for Elon Musk's Gulfstream. When set, the globe
  // polls faster, highlights the jet in gold, auto-renders its trajectory,
  // and accumulates a live position trail.
  trackedTailCallsign: string | null;
  trackedTailName: string | null;
  // ICAO hex of the tracked jet (used for trajectory fetch + gold highlight
  // resolution). Resolved by the private flights panel from the registry.
  trackedTailIcao24: string | null;

  // Which satellites are toggled visible on the globe (satelliteId → visible).
  visibleSatellites: Record<string, boolean>;
  toggleSatellite: (id: string) => void;

  // When set to a satellite ID, CesiumGlobe shows its orbit trajectory then clears this.
  requestedSatelliteTrajectory: string | null;
  setRequestedSatelliteTrajectory: (id: string | null) => void;

  // Google Photorealistic 3D Tiles — strictly opt-in. The tileset is only
  // created (and API requests fired) when this flips to true.
  googleTilesEnabled: boolean;

  // Sentinel-2 satellite imagery replay. Shows historical Sentinel-2 captures
  // with back/forward navigation. Two granularities:
  //   - 'weekly': 7-day range (for tracking construction, specific changes)
  //   - 'monthly': full month range (cloud-free mosaic, for big-picture views)
  // Sentinel-2 revisit cycle is ~5 days, so weekly stepping captures meaningful
  // changes. Visibility controlled by layerVisibility.sentinel.
  sentinelDate: string | null; // ISO date string e.g. "2026-07-26"
  sentinelGranularity: "weekly" | "monthly";
  sentinelPlaying: boolean; // auto-play: advances 1 week every 2s when true
  gibsDate: string | null; // ISO date string e.g. "2026-08-09"
  gibsGranularity: "weekly" | "monthly";
  gibsPlaying: boolean;
  setSentinelDate: (date: string | null) => void;
  stepSentinelDate: (direction: "back" | "forward", granularity?: "weekly" | "monthly") => void;
  setSentinelGranularity: (g: "weekly" | "monthly") => void;
  setSentinelPlaying: (playing: boolean) => void;
  setGibsDate: (date: string | null) => void;
  stepGibsDate: (direction: "back" | "forward", granularity?: "weekly" | "monthly") => void;
  setGibsGranularity: (g: "weekly" | "monthly") => void;
  setGibsPlaying: (playing: boolean) => void;

  // Road class visibility — which road classes to render in the traffic layer.
  // All off by default; toggled via the TrafficPanel right sidebar.
  roadClassVisibility: Record<string, boolean>;
  toggleRoadClass: (cls: string) => void;

  // Actions
  setHover: (
    id: string | null,
    x?: number,
    y?: number,
    kind?: HoveredKind,
    building?: GlobeState["hoveredBuilding"],
    region?: RegionHit | null
  ) => void;
  clearHover: () => void;
  selectFlight: (
    id: string | null,
    kind: SelectedKind,
    x?: number,
    y?: number
  ) => void;
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setReplayPanelOpen: (open: boolean) => void;
  toggleLayer: (id: string) => void;
  toggleCctvSource: (provider: string) => void;
  setCctvSourceCounts: (counts: Record<string, number>) => void;
  setLayerLoading: (id: string, loading: boolean) => void;
  setEvents: (events: ProtestEvent[]) => void;
  setActiveCity: (name: string | null) => void;
  saveView: (city: string, view: SavedView) => void;

  // Private-flight tracking
  setTrackedTail: (
    callsign: string | null,
    name?: string | null,
    icao24?: string | null
  ) => void;

  // Google 3D Tiles
  setGoogleTilesEnabled: (enabled: boolean) => void;
}

const SAVED_VIEWS_KEY = "spectre:savedViews";
const ACTIVE_CITY_KEY = "spectre:activeCity";

function loadSavedViews(): Record<string, SavedView> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadActiveCity(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_CITY_KEY);
  } catch {
    return null;
  }
}

export const useGlobeStore = create<GlobeState>((set) => ({
  hoveredCctvId: null,
  hoveredEventId: null,
  hoveredFlightId: null,
  hoveredBuilding: null,
  hoverPos: null,
  hoveredKind: null,
  hoveredRegion: null,
  hoveredSatelliteId: null,

  selectedFlightId: null,
  selectedKind: null,
  selectedAt: null,

  leftPanelOpen: true,
  rightPanelOpen: true,
  replayPanelOpen: false,

  activeCity: loadActiveCity(),
  savedViews: loadSavedViews(),

  layerVisibility: {
    buildings: false,
    flights: false,
    mil: false,
    cctv: false,
    traffic: false,
    events: false,
    satellites: false,
    sentinel: false,
    gibs: false,
    kartaview: false,
    borders: false,
    bldgHighlight: false,
  },

  // Which CCTV sources are enabled (provider → visible). All on by default.
  cctvSources: {
    osm: false,
    otc: false,
    palembang: false,
    streetside: false,
    windy: false,
    atcs: false,
    tfl: false,
    caltrans: false,
    "511ny": false,
    lta: false,
    tfnsw: false,
  },

  cctvSourceCounts: {},
  cctvCatalogLoaded: false,
  setCctvCatalogLoaded: (loaded) => set({ cctvCatalogLoaded: loaded }),
  cctvCameras: [],
  setCctvCameras: (cameras) => set({ cctvCameras: cameras }),

  cameraAltitude: 10_000_000,
  setCameraAltitude: (alt) => set({ cameraAltitude: alt }),

  layerLoading: {},

  events: [],

  trackedTailCallsign: null,
  trackedTailName: null,
  trackedTailIcao24: null,

  visibleSatellites: {},

  requestedSatelliteTrajectory: null,
  setRequestedSatelliteTrajectory: (id) => set({ requestedSatelliteTrajectory: id }),

  googleTilesEnabled: false,

  sentinelDate: null, // null = latest available
  sentinelGranularity: "monthly", // default to monthly (cloud-free mosaics)
  sentinelPlaying: false, // auto-play off by default
  gibsDate: null, // null = today
  gibsGranularity: "monthly",
  gibsPlaying: false,

  // Road class visibility — all off by default; user toggles on what they want
  roadClassVisibility: {
    motorway: false,
    trunk: false,
    primary: false,
    secondary: false,
    tertiary: false,
  },

  setHover: (id, x, y, kind, building, region) =>
    set({
      hoveredCctvId: id != null && kind === "cctv" ? id : null,
      hoveredEventId: id != null && kind === "event" ? id : null,
      hoveredFlightId:
        id != null && (kind === "flight-private" || kind === "flight-mil")
          ? id
          : null,
      hoveredBuilding: id != null && kind === "building" ? (building ?? null) : null,
      hoveredRegion:
        id != null && kind === "region" ? (region ?? null) : null,
      hoveredSatelliteId: id != null && kind === "satellite" ? id : null,
      hoverPos:
        id != null && x != null && y != null ? { x, y } : null,
      hoveredKind: id != null ? (kind ?? null) : null,
    }),
  clearHover: () =>
    set({
      hoveredCctvId: null,
      hoveredEventId: null,
      hoveredFlightId: null,
      hoveredBuilding: null,
  hoveredRegion: null,
  hoveredSatelliteId: null,
      hoverPos: null,
      hoveredKind: null,
    }),
  selectFlight: (id, kind, x, y) =>
    set({
      selectedFlightId: id,
      selectedKind: kind,
      selectedAt:
        id != null && x != null && y != null ? { x, y } : null,
    }),
  setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setReplayPanelOpen: (open) => set({ replayPanelOpen: open }),
  toggleLayer: (id) =>
    set((state) => {
      const newVisibility = {
        ...state.layerVisibility,
        [id]: !state.layerVisibility[id],
      };
      // GIBS and Sentinel are mutually exclusive imagery layers.
      // Turning one on turns the other off.
      if (id === "gibs" && newVisibility.gibs) {
        newVisibility.sentinel = false;
      } else if (id === "sentinel" && newVisibility.sentinel) {
        newVisibility.gibs = false;
      }
      return { layerVisibility: newVisibility };
    }),
  toggleCctvSource: (provider) =>
    set((state) => ({
      cctvSources: {
        ...state.cctvSources,
        [provider]: !state.cctvSources[provider],
      },
    })),
  setCctvSourceCounts: (counts) => set({ cctvSourceCounts: counts }),
  setLayerLoading: (id, loading) =>
    set((state) => ({
      layerLoading: {
        ...state.layerLoading,
        [id]: loading,
      },
    })),
  setEvents: (events) => set({ events }),
  setActiveCity: (name) => {
    if (typeof window !== "undefined") {
      try {
        if (name) localStorage.setItem(ACTIVE_CITY_KEY, name);
        else localStorage.removeItem(ACTIVE_CITY_KEY);
      } catch {
        // ignore
      }
    }
    set({ activeCity: name });
  },
  saveView: (city, view) =>
    set((state) => {
      const savedViews = { ...state.savedViews, [city]: view };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
        } catch {
          // localStorage full or unavailable
        }
      }
      return { savedViews };
    }),
  setTrackedTail: (callsign, name, icao24) =>
    set({
      trackedTailCallsign: callsign,
      trackedTailName: name ?? null,
      trackedTailIcao24: icao24 ?? null,
    }),
  toggleSatellite: (id) =>
    set((state) => ({
      visibleSatellites: {
        ...state.visibleSatellites,
        [id]: !state.visibleSatellites[id],
      },
    })),
  toggleRoadClass: (cls) =>
    set((state) => ({
      roadClassVisibility: {
        ...state.roadClassVisibility,
        [cls]: !state.roadClassVisibility[cls],
      },
    })),
  setSentinelDate: (date) => set({ sentinelDate: date }),
  setSentinelGranularity: (g) => set({ sentinelGranularity: g }),
  setSentinelPlaying: (playing) => set({ sentinelPlaying: playing }),
  stepSentinelDate: (direction, granularity = "monthly") =>
    set((state) => {
      const current = state.sentinelDate
        ? new Date(state.sentinelDate + "T00:00:00")
        : new Date(); // start from today if no date set

      if (granularity === "weekly") {
        // Step by 7 days
        const days = direction === "back" ? -7 : 7;
        current.setDate(current.getDate() + days);
        // Don't go into the future
        const now = new Date();
        if (current > now) {
          current.setTime(now.getTime());
        }
        // Don't go before 2015-06-01 (Sentinel-2A launch)
        if (current < new Date("2015-06-01")) {
          current.setTime(new Date("2015-06-01").getTime());
        }
      } else {
        // Step by 1 month
        const month = direction === "back" ? -1 : 1;
        current.setMonth(current.getMonth() + month);
        // Set to first of month for clean date
        current.setDate(1);
        // Don't go into the future
        const now = new Date();
        if (current > now) {
          current.setTime(now.getTime());
          current.setDate(1);
        }
        // Don't go before 2015-06-01 (Sentinel-2A launch)
        if (current < new Date("2015-06-01")) {
          current.setTime(new Date("2015-06-01").getTime());
        }
      }
      const iso = localDateStr(current);
      return { sentinelDate: iso, sentinelGranularity: granularity };
    }),
  setGibsDate: (date) => set({ gibsDate: date }),
  stepGibsDate: (direction, granularity = "monthly") =>
    set((state) => {
      const current = state.gibsDate
        ? new Date(state.gibsDate + "T00:00:00")
        : new Date(); // start from today if no date set

      if (granularity === "weekly") {
        // Step by 7 days
        const days = direction === "back" ? -7 : 7;
        current.setDate(current.getDate() + days);
        // Don't go into the future
        const now = new Date();
        if (current > now) {
          current.setTime(now.getTime());
        }
        // Don't go before 2000-02-24 (MODIS Terra first light)
        if (current < new Date("2000-02-24")) {
          current.setTime(new Date("2000-02-24").getTime());
        }
      } else {
        // Step by 1 month
        const month = direction === "back" ? -1 : 1;
        current.setMonth(current.getMonth() + month);
        // Set to 1st of month for clean date
        current.setDate(1);
        // Don't go into the future
        const now = new Date();
        if (current > now) {
          current.setTime(now.getTime());
          current.setDate(1);
        }
        // Don't go before 2000-02-24 (MODIS Terra first light)
        if (current < new Date("2000-02-24")) {
          current.setTime(new Date("2000-02-24").getTime());
        }
      }
      const iso = localDateStr(current);
      return { gibsDate: iso, gibsGranularity: granularity };
    }),
  setGibsGranularity: (g) => set({ gibsGranularity: g }),
  setGibsPlaying: (playing) => set({ gibsPlaying: playing }),
  setGoogleTilesEnabled: (enabled) => set({ googleTilesEnabled: enabled }),
}));
