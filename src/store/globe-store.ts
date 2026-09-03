"use client";

import { create } from "zustand";
import type { RegionHit } from "@/globe/region-index";
import type { CctvCamera } from "@/lib/sources/cctv";

/** Format a Date as YYYY-MM-DD (UTC) for GIBS WMTS TIME parameter. */
function toYMD(d: Date): string {
  return d.toISOString().split("T")[0];
}

export interface SavedView {
  lat: number;
  lon: number;
  height: number;
  heading: number;
  pitch: number;
}

export interface CameraCoords {
  lon: number;
  lat: number;
  height: number;
}

// Layer IDs for the left panel toggles
export type LayerId =
  | "commercial-flights"
  | "private-flights"
  | "military-flights"
  | "satellites"
  | "dams"
  | "earthquakes"
  | "data-centers"
  | "civil-unrest"
  | "traffic"
  | "cctv"
  | "3d-buildings"
  | "radio"
  | "big-changes-replay"
  | "construction-replay";

// Right panel mode: which layer's compliment is showing (null = default mode)
export type ActiveRightPanel = LayerId | null;

// Which kind of flight is selected (commercial / private / military).
export type SelectedKind =
  | "flight-commercial"
  | "flight-private"
  | "flight-mil"
  | null;

// Tracked static feature (dam / earthquake / data center). Tracking is a
// one-shot fly-to + right-panel info display (no continuous camera follow,
// unlike flight/satellite tracking). Mirrors the trackedSatellite* pattern.
export type TrackedFeatureKind = "dam" | "earthquake" | "datacenter" | "unrest" | "building";

export interface TrackedFeature {
  kind: TrackedFeatureKind;
  id: string;
  name: string;
  lat: number;
  lon: number;
  // Kind-specific payload (raw GeoJSON / USGS properties, flattened).
  data: Record<string, unknown>;
}

// Trajectory data shared between FlightTrajectoryOverlay (fetcher) and
// FlightDetailPanel (right panel display).
export interface TrajectoryData {
  icao24?: string;
  callsign: string | null;
  trajectory: { time: number; lat: number; lon: number; alt: number | null }[];
  origin: string | null;
  destination: string | null;
  originAirport?: { icao: string; name: string; city: string; lat: number; lon: number } | null;
  destinationAirport?: { icao: string; name: string; city: string; lat: number; lon: number } | null;
  firstSeen?: number | null;
  lastSeen?: number | null;
  heading?: number | null;
  velocity?: number | null;
  originCountry?: string | null;
  onGround?: boolean;
  aircraftType?: string | null;
  aircraftModel?: string | null;
  operator?: string | null;
  registration?: string | null;
  // AeroDataBox schedule fields
  departureScheduled?: string | null;
  departureRevised?: string | null;
  arrivalScheduled?: string | null;
  arrivalRevised?: string | null;
  flightStatus?: string | null;
  departureGate?: string | null;
  departureTerminal?: string | null;
  arrivalGate?: string | null;
  arrivalTerminal?: string | null;
  // Live ADS-B fields
  verticalRate?: number | null;
  squawk?: string | null;
  sourceUrl: string;
  fetchedAt: number;
  error?: string;
}

export interface GlobeState {
  // Camera state
  cameraAltitude: number;
  cameraCoords: CameraCoords;
  setCameraAltitude: (h: number) => void;
  setCameraCoords: (lon: number, lat: number, height: number) => void;

  // Layer visibility
  layerVisibility: Record<LayerId, boolean>;
  layerLoading: Record<LayerId, boolean>;
  layerError: Record<LayerId, string | null>;
  toggleLayer: (id: LayerId) => void;
  setLayerLoading: (id: LayerId, loading: boolean) => void;
  setLayerVisible: (id: LayerId, visible: boolean) => void;
  setLayerError: (id: LayerId, error: string | null) => void;

  // Right panel: which layer's compliment is showing
  activeRightPanel: ActiveRightPanel;
  setActiveRightPanel: (panel: ActiveRightPanel) => void;

  // Left panel open/close
  leftPanelOpen: boolean;
  setLeftPanelOpen: (open: boolean) => void;

  // 3D tiles toggle (default off)
  googleTilesEnabled: boolean;
  toggleGoogleTiles: () => void;

  // Borders toggle
  bordersEnabled: boolean;
  toggleBorders: () => void;

  // Building hover-highlight toggle (gates the white tint on hovered OSM
  // buildings + click-to-panel). Not a LayerId: it does not load a separate
  // tileset. Requires the "3d-buildings" layer to be visible.
  bldgHighlight: boolean;
  toggleBldgHighlight: () => void;

  // Fullscreen
  isFullscreen: boolean;
  toggleFullscreen: () => void;

  // Saved views (persisted to localStorage)
  savedViews: Record<string, SavedView>;
  saveCurrentView: (name: string, view: SavedView) => void;

  // Location anchoring
  activeLocation: string | null;
  activeContinent: string | null;
  activeCountry: string | null;
  activeCity: string | null;
  setActiveLocation: (level: "continent" | "country" | "city", name: string) => void;
  clearActiveLocation: () => void;

  // Search modal
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  // Toast notification
  toast: string | null;
  showToast: (msg: string) => void;
  clearToast: () => void;

  // Flight selection state: populated when a flight billboard is clicked.
  // FlightTrajectoryOverlay fetches the trajectory + renders the 3D model.
  // FlightDetailPanel shows the telemetry in the right panel.
  // Cleared by clicking empty space, pressing Escape, or the CLOSE button.
  selectedFlightId: string | null;
  selectedKind: SelectedKind;
  trajectoryData: TrajectoryData | null;
  trajectoryLoading: boolean;
  trajectoryError: string | null;
  selectFlight: (id: string | null, kind: SelectedKind) => void;
  setTrajectoryData: (data: TrajectoryData | null) => void;
  setTrajectoryLoading: (loading: boolean) => void;
  setTrajectoryError: (error: string | null) => void;

  // Region hover (country / state popup under cursor when borders are on)
  hoveredRegion: RegionHit | null;
  hoverPos: { x: number; y: number } | null;
  setHover: (region: RegionHit | null, x: number | null, y: number | null) => void;
  clearHover: () => void;

  // Region selection (click-to-inspect when borders are on). Mutually
  // exclusive with the flight / satellite / feature / camera / building
  // trackers: setting one clears the others so only one detail panel owns
  // the right rail at a time. selectedRegionRings carries the polygon outer
  // rings (lon/lat) used to draw the white highlight on the globe; empty for
  // city-level selections (no polygon).
  selectedRegion: RegionHit | null;
  selectedRegionRings: number[][][] | null;
  selectRegion: (region: RegionHit, rings: number[][][]) => void;
  clearRegion: () => void;

  // Satellite tracking state: set when a satellite is being tracked
  // (camera follow + orbit ring + 3D model). The right panel swaps from
  // the picker (search + famous list) to the detail card while set.
  // Cleared by CLOSE, Escape, empty-space click, or layer disable.
  trackedSatelliteId: number | null;
  trackedSatelliteName: string | null;
  trackSatellite: (id: number, name: string) => void;
  untrackSatellite: () => void;

  // Tracked static feature (dam / earthquake / data center). Mutually
  // exclusive with selectedFlightId / trackedSatelliteId: setting one clears
  // the others so only one detail panel owns the right rail at a time.
  trackedFeature: TrackedFeature | null;
  trackFeature: (f: TrackedFeature) => void;
  untrackFeature: () => void;

  // Tracked CCTV camera. Mutually exclusive with selectedFlightId /
  // trackedSatelliteId / trackedFeature: setting one clears the others so
  // only one detail panel owns the right rail at a time.
  trackedCamera: CctvCamera | null;
  trackCamera: (cam: CctvCamera) => void;
  untrackCamera: () => void;

  // Tracked OSM building (clicked 3D tile feature). Mutually exclusive with
  // the other trackers. Populated by the building click handler when
  // bldgHighlight is on; FeatureDetailPanel renders the OSM tags.
  trackedBuilding: TrackedFeature | null;
  trackBuilding: (f: TrackedFeature) => void;
  untrackBuilding: () => void;

  // CCTV catalog + per-source filtering. The catalog is loaded once by
  // page.tsx and shared via the store. cctvSources controls which providers
  // are visible (all off by default; user toggles them from the right panel).
  // cctvSourceCounts holds per-provider counts for the active city's bbox.
  cctvSources: Record<string, boolean>;
  cctvSourceCounts: Record<string, number>;
  cctvCatalogLoaded: boolean;
  cctvCameras: CctvCamera[];
  toggleCctvSource: (provider: string) => void;
  setCctvSourceCounts: (counts: Record<string, number>) => void;
  setCctvCatalogLoaded: (loaded: boolean) => void;
  setCctvCameras: (cameras: CctvCamera[]) => void;

  // Replay timeline state (shared by both GIBS replay layers).
  // replayDate is the current scrub position in YYYY-MM-DD format.
  // replayStart/replayEnd bound the timeline (last 5 years by default).
  // replaySpeed is days advanced per second of playback.
  replayDate: string;
  replayPlaying: boolean;
  replaySpeed: number;
  replayStart: string;
  replayEnd: string;
  replayActiveLayer: "big-changes-replay" | "construction-replay" | null;
  replayLoading: boolean;
  setReplayDate: (date: string) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: number) => void;
  setReplayActiveLayer: (
    layer: "big-changes-replay" | "construction-replay" | null,
  ) => void;
  setReplayLoading: (loading: boolean) => void;
}

const STORAGE_KEY = "spectre-v2:savedViews";

function loadSavedViews(): Record<string, SavedView> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistSavedViews(views: Record<string, SavedView>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {}
}

const ALL_LAYERS: LayerId[] = [
  "commercial-flights",
  "private-flights",
  "military-flights",
  "satellites",
  "dams",
  "earthquakes",
  "data-centers",
  "civil-unrest",
  "traffic",
  "cctv",
  "3d-buildings",
  "radio",
  "big-changes-replay",
  "construction-replay",
];

const initialLayerVisibility = ALL_LAYERS.reduce((acc, id) => {
  acc[id] = false;
  return acc;
}, {} as Record<LayerId, boolean>);

const initialLayerLoading = ALL_LAYERS.reduce((acc, id) => {
  acc[id] = false;
  return acc;
}, {} as Record<LayerId, boolean>);

const initialLayerError = ALL_LAYERS.reduce((acc, id) => {
  acc[id] = null;
  return acc;
}, {} as Record<LayerId, string | null>);

export const useGlobeStore = create<GlobeState>((set, get) => ({
  cameraAltitude: 4234,
  cameraCoords: { lon: 106.8257, lat: -6.2505, height: 4234 },
  setCameraAltitude: (h) => set({ cameraAltitude: h }),
  setCameraCoords: (lon, lat, height) =>
    set({ cameraCoords: { lon, lat, height } }),

  layerVisibility: initialLayerVisibility,
  layerLoading: initialLayerLoading,
  layerError: initialLayerError,
  toggleLayer: (id) => {
    const state = get();
    const turningOn = !state.layerVisibility[id] && !state.layerLoading[id];

    if (turningOn) {
      set({
        layerLoading: { ...state.layerLoading, [id]: true },
        layerError: { ...state.layerError, [id]: null },
        activeRightPanel: id,
      });
      // LayerManager will call setLayerVisible when enable() completes
    } else if (state.layerLoading[id]) {
      // Already loading, ignore
      return;
    } else {
      // Turning off
      const newVisibility = { ...state.layerVisibility, [id]: false };
      const anyOn = ALL_LAYERS.some((l) => newVisibility[l]);
      const nextActive = anyOn
        ? (ALL_LAYERS.find((l) => newVisibility[l]) ?? null)
        : null;
      set({
        layerVisibility: newVisibility,
        activeRightPanel: nextActive,
      });
    }
  },
  setLayerLoading: (id, loading) =>
    set((state) => ({ layerLoading: { ...state.layerLoading, [id]: loading } })),
  setLayerVisible: (id, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [id]: visible },
      layerLoading: { ...state.layerLoading, [id]: false },
    })),
  setLayerError: (id, error) =>
    set((state) => ({
      layerError: { ...state.layerError, [id]: error },
      layerLoading: { ...state.layerLoading, [id]: false },
    })),

  activeRightPanel: null,
  setActiveRightPanel: (panel) => set({ activeRightPanel: panel }),

  leftPanelOpen: true,
  setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),

  googleTilesEnabled: false,
  toggleGoogleTiles: () => set((state) => ({ googleTilesEnabled: !state.googleTilesEnabled })),

  bordersEnabled: false,
  toggleBorders: () => set((state) => ({ bordersEnabled: !state.bordersEnabled })),

  bldgHighlight: false,
  toggleBldgHighlight: () => set((state) => ({ bldgHighlight: !state.bldgHighlight })),

  isFullscreen: false,
  toggleFullscreen: () => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      set({ isFullscreen: true });
    } else {
      document.exitFullscreen?.();
      set({ isFullscreen: false });
    }
  },

  savedViews: loadSavedViews(),
  saveCurrentView: (name, view) =>
    set((state) => {
      const newViews = { ...state.savedViews, [name]: view };
      persistSavedViews(newViews);
      return { savedViews: newViews };
    }),

  activeLocation: null,
  activeContinent: null,
  activeCountry: null,
  activeCity: null,
  setActiveLocation: (level, name) =>
    set({
      activeLocation: name,
      // Clear all levels first, then set the requested one. This ensures
      // clicking a continent clears any focused country, etc.
      activeContinent: level === "continent" ? name : null,
      activeCountry: level === "country" ? name : null,
      activeCity: level === "city" ? name : null,
    }),
  clearActiveLocation: () =>
    set({
      activeLocation: null,
      activeContinent: null,
      activeCountry: null,
      activeCity: null,
    }),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  toast: null,
  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: null }), 2500);
  },
  clearToast: () => set({ toast: null }),

  selectedFlightId: null,
  selectedKind: null,
  trajectoryData: null,
  trajectoryLoading: false,
  trajectoryError: null,
  selectFlight: (id, kind) =>
    set((state) => ({
      selectedFlightId: id,
      selectedKind: kind,
      trajectoryData: null,
      trajectoryLoading: id != null,
      trajectoryError: null,
      // Clear competing trackers so only one detail panel shows.
      trackedSatelliteId: id != null ? null : state.trackedSatelliteId,
      trackedSatelliteName: id != null ? null : state.trackedSatelliteName,
      trackedFeature: id != null ? null : state.trackedFeature,
      trackedCamera: id != null ? null : state.trackedCamera,
      trackedBuilding: id != null ? null : state.trackedBuilding,
      selectedRegion: id != null ? null : state.selectedRegion,
      selectedRegionRings: id != null ? null : state.selectedRegionRings,
    })),
  setTrajectoryData: (data) => set({ trajectoryData: data }),
  setTrajectoryLoading: (loading) => set({ trajectoryLoading: loading }),
  setTrajectoryError: (error) => set({ trajectoryError: error }),

  hoveredRegion: null,
  hoverPos: null,
  setHover: (region, x, y) =>
    set({
      hoveredRegion: region,
      hoverPos: x != null && y != null ? { x, y } : null,
    }),
  clearHover: () => set({ hoveredRegion: null, hoverPos: null }),

  selectedRegion: null,
  selectedRegionRings: null,
  selectRegion: (region, rings) =>
    set({
      selectedRegion: region,
      selectedRegionRings: rings,
      // Clear competing trackers so only one detail panel shows.
      selectedFlightId: null,
      selectedKind: null,
      trackedSatelliteId: null,
      trackedSatelliteName: null,
      trackedFeature: null,
      trackedCamera: null,
      trackedBuilding: null,
    }),
  clearRegion: () => set({ selectedRegion: null, selectedRegionRings: null }),

  trackedSatelliteId: null,
  trackedSatelliteName: null,
  trackSatellite: (id, name) =>
    set({
      trackedSatelliteId: id,
      trackedSatelliteName: name,
      // Clear competing trackers so only one detail panel shows.
      selectedFlightId: null,
      selectedKind: null,
      trackedFeature: null,
      trackedCamera: null,
      trackedBuilding: null,
      selectedRegion: null,
      selectedRegionRings: null,
    }),
  untrackSatellite: () =>
    set({ trackedSatelliteId: null, trackedSatelliteName: null }),

  trackedFeature: null,
  trackFeature: (f) =>
    set({
      trackedFeature: f,
      // Clear competing trackers so only one detail panel shows.
      selectedFlightId: null,
      selectedKind: null,
      trackedSatelliteId: null,
      trackedSatelliteName: null,
      trackedCamera: null,
      trackedBuilding: null,
      selectedRegion: null,
      selectedRegionRings: null,
    }),
  untrackFeature: () => set({ trackedFeature: null }),

  trackedCamera: null,
  trackCamera: (cam) =>
    set({
      trackedCamera: cam,
      // Clear competing trackers so only one detail panel shows.
      selectedFlightId: null,
      selectedKind: null,
      trackedSatelliteId: null,
      trackedSatelliteName: null,
      trackedFeature: null,
      trackedBuilding: null,
      selectedRegion: null,
      selectedRegionRings: null,
    }),
  untrackCamera: () => set({ trackedCamera: null }),

  trackedBuilding: null,
  trackBuilding: (f) =>
    set({
      trackedBuilding: f,
      // Clear competing trackers so only one detail panel shows.
      selectedFlightId: null,
      selectedKind: null,
      trackedSatelliteId: null,
      trackedSatelliteName: null,
      trackedFeature: null,
      trackedCamera: null,
      selectedRegion: null,
      selectedRegionRings: null,
    }),
  untrackBuilding: () => set({ trackedBuilding: null }),

  // CCTV catalog + per-source filtering. All sources off by default; the
  // right panel source list shows counts per city and lets the user toggle
  // individual providers on. Cameras only render when a source is enabled.
  cctvSources: {
    osm: false,
    otc: false,
    palembang: false,
    shodan: false,
    windy: false,
    streetside: false,
    atcs: false,
    tfl: false,
    caltrans: false,
    "511ny": false,
    lta: false,
    tfnsw: false,
  },
  cctvSourceCounts: {},
  cctvCatalogLoaded: false,
  cctvCameras: [],
  toggleCctvSource: (provider) =>
    set((state) => ({
      cctvSources: {
        ...state.cctvSources,
        [provider]: !state.cctvSources[provider],
      },
    })),
  setCctvSourceCounts: (counts) => set({ cctvSourceCounts: counts }),
  setCctvCatalogLoaded: (loaded) => set({ cctvCatalogLoaded: loaded }),
  setCctvCameras: (cameras) => set({ cctvCameras: cameras }),

  // Replay timeline: default to today, 5-year range, paused, 1 day/sec.
  replayDate: toYMD(new Date()),
  replayPlaying: false,
  replaySpeed: 1,
  replayStart: toYMD(
    new Date(new Date().getFullYear() - 5, new Date().getMonth(), new Date().getDate()),
  ),
  replayEnd: toYMD(new Date()),
  replayActiveLayer: null,
  replayLoading: false,
  setReplayDate: (date) => set({ replayDate: date }),
  setReplayPlaying: (playing) => set({ replayPlaying: playing }),
  setReplaySpeed: (speed) => set({ replaySpeed: speed }),
  setReplayActiveLayer: (layer) => set({ replayActiveLayer: layer }),
  setReplayLoading: (loading) => set({ replayLoading: loading }),
}));
