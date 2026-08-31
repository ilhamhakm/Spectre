// Radio station + category + tuner types. Faithful port of GEV's
// src/data/radio.js station shape (see normalizeRadioBrowserStation in the
// broker) and the UI-state snapshot consumed by React.

export interface RadioStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  streamUrl: string;
  homepage: string | null;
  tags: string[];
  languages: string[];
  state: string;
  country: string;
  countryCode: string;
  metadataTrust: "untrusted-community";
  codec: string;
  bitrate: number | null;
  clickCount: number;
}

export type RadioCategoryId =
  | "all"
  | "news"
  | "talk"
  | "weather"
  | "public-safety"
  | "aviation-marine"
  | "traffic-transit"
  | "music"
  | "other"
  | `genre:${string}`;

export interface RadioCategory {
  id: RadioCategoryId;
  label: string;
  color: string;
  count: number;
}

export type RadioAudioState =
  | "stopped"
  | "loading"
  | "playing"
  | "paused"
  | "error";

export interface RadioTunerSlot {
  slot: number;
  max: number;
  locked: boolean;
  stationIndex: number;
  leftIndex: number;
  rightIndex: number;
}

export interface RadioTunerPointer {
  ratio: number;
  coordinate: number;
  stationIndex: number;
}

export interface RadioTunerTick {
  stationIndex: number;
  channel: number;
  xPx: number;
  current: boolean;
  label: string;
}

export interface RadioTunerTicks {
  ticks: RadioTunerTick[];
  needleX: number;
  pitchPx: number;
  ratio: number;
}

export interface RadioCameraPlan {
  lat: number;
  lon: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}

export interface RadioClusterCandidate {
  id: string;
  identityId?: string;
  membershipId?: string;
  position?: unknown;
  text?: string;
  accent?: string;
  stationCount: number;
  stationIds: string[];
  distanceM?: number;
}

export interface RadioSingletonCandidate {
  station: RadioStation;
  id?: string;
  distanceM?: number;
  priority?: number;
}
