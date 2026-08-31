// Zustand store for the radio layer. Replaces GEV's imperative
// subscribeToRadio pub/sub with React-friendly selectors. The engine and
// playback modules mutate this store; React components subscribe.

"use client";

import { create } from "zustand";
import type {
  RadioAudioState,
  RadioCategory,
  RadioCategoryId,
  RadioStation,
} from "./radio-types";
import { DEFAULT_RADIO_FILTER } from "./radio-categories";

export interface RadioState {
  // Directory
  enabled: boolean;
  loading: boolean;
  stale: boolean;
  degraded: boolean;
  error: string | null;
  updatedAt: string | null;
  stations: RadioStation[];
  categories: RadioCategory[];
  filter: RadioCategoryId;

  // Selection / playback
  selectedId: string | null;
  audioState: RadioAudioState;
  audioError: string | null;
  playingStationId: string | null;
  volume: number;

  // Tuning
  tuningActive: boolean;
  tuningStatic: boolean;
  tuningAwaitingStationId: string | null;
  tuningPreviewStationId: string | null;

  // Mutators (called by engine / playback / UI)
  setEnabled: (enabled: boolean) => void;
  setDirectory: (payload: {
    stations: RadioStation[];
    categories: RadioCategory[];
    updatedAt: string | null;
    stale: boolean;
    degraded: boolean;
    error: string | null;
  }) => void;
  setLoading: (loading: boolean) => void;
  setDirectoryError: (error: string | null) => void;
  setFilter: (filter: RadioCategoryId) => void;
  selectStation: (id: string | null) => void;
  setAudioState: (
    state: RadioAudioState,
    error?: string | null,
    playingStationId?: string | null,
  ) => void;
  setVolume: (volume: number) => void;
  setTuning: (payload: {
    active?: boolean;
    staticOn?: boolean;
    awaitingStationId?: string | null;
    previewStationId?: string | null;
  }) => void;
  reset: () => void;
}

const DEFAULT_VOLUME = 0.8;

export const useRadioStore = create<RadioState>((set) => ({
  enabled: false,
  loading: false,
  stale: false,
  degraded: false,
  error: null,
  updatedAt: null,
  stations: [],
  categories: [],
  filter: DEFAULT_RADIO_FILTER,

  selectedId: null,
  audioState: "stopped",
  audioError: null,
  playingStationId: null,
  volume: DEFAULT_VOLUME,

  tuningActive: false,
  tuningStatic: false,
  tuningAwaitingStationId: null,
  tuningPreviewStationId: null,

  setEnabled: (enabled) => set({ enabled }),
  setDirectory: (payload) =>
    set({
      stations: payload.stations,
      categories: payload.categories,
      updatedAt: payload.updatedAt,
      stale: payload.stale,
      degraded: payload.degraded,
      error: payload.error,
      loading: false,
    }),
  setLoading: (loading) => set({ loading }),
  setDirectoryError: (error) => set({ error, loading: false }),
  setFilter: (filter) => set({ filter }),
  selectStation: (id) => set({ selectedId: id }),
  setAudioState: (state, error = null, playingStationId = null) =>
    set({ audioState: state, audioError: error, playingStationId }),
  setVolume: (volume) => set({ volume }),
  setTuning: (payload) =>
    set({
      ...(payload.active !== undefined && { tuningActive: payload.active }),
      ...(payload.staticOn !== undefined && {
        tuningStatic: payload.staticOn,
      }),
      ...(payload.awaitingStationId !== undefined && {
        tuningAwaitingStationId: payload.awaitingStationId,
      }),
      ...(payload.previewStationId !== undefined && {
        tuningPreviewStationId: payload.previewStationId,
      }),
    }),
  reset: () =>
    set({
      enabled: false,
      loading: false,
      stale: false,
      degraded: false,
      error: null,
      updatedAt: null,
      stations: [],
      categories: [],
      filter: DEFAULT_RADIO_FILTER,
      selectedId: null,
      audioState: "stopped",
      audioError: null,
      playingStationId: null,
      volume: DEFAULT_VOLUME,
      tuningActive: false,
      tuningStatic: false,
      tuningAwaitingStationId: null,
      tuningPreviewStationId: null,
    }),
}));

/** Convenience selector: the currently selected station object. */
export function selectSelectedStation(state: RadioState): RadioStation | null {
  return state.selectedId
    ? state.stations.find((s) => s.id === state.selectedId) ?? null
    : null;
}
