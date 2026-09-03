// HTMLAudioElement playback singleton + WebAudio tuner static. Faithful port
// of GEV's playback path (src/data/radio.js) adapted to the Zustand store.
// Voice ducking is exposed as a no-op hook: Spectre V2 has no voice system,
// so ducking leaves volume at the user value. A future voice layer can wire
// real ducking into setRadioVoiceDucking.

"use client";

import type { RadioStation } from "./radio-types";
import { useRadioStore } from "./radio-store";
import { RADIO_TUNER_STATIC_MAX_GAIN } from "./radio-tuner";

const DEFAULT_RADIO_VOLUME = 0.8;

let _audio: HTMLAudioElement | null = null;
let _audioStationId: string | null = null;
let _playGeneration = 0;
let _playAttemptSequence = 0;
let _activePlaybackAttempt: {
  id: string;
  stationId: string;
  streamUrl: string;
  generation: number;
} | null = null;

// Tuner static noise (WebAudio)
let _tuningNoiseContext: AudioContext | null = null;
let _tuningNoiseSource: AudioBufferSourceNode | null = null;
let _tuningNoiseGain: GainNode | null = null;

function clampRadioVolume(value: number): number {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function installAudio(): void {
  if (_audio) return;
  if (typeof document === "undefined") return;
  _audio = new Audio();
  _audio.preload = "none";
  _audio.crossOrigin = "anonymous";
  _audio.volume = useRadioStore.getState().volume;
}

function emitAudioState(): void {
  const store = useRadioStore.getState();
  store.setAudioState(
    // audioState is set by callers; this just syncs playingStationId
    store.audioState,
    store.audioError,
    _audioStationId,
  );
}

/** Ensure the shared audio element exists and reflects the user volume. */
export function ensureRadioAudio(): void {
  installAudio();
  if (_audio && !_voiceDucked) _audio.volume = useRadioStore.getState().volume;
}

// --- Tuner static noise -----------------------------------------------------

function buildTuningNoiseContext(): AudioContext | null {
  if (_tuningNoiseContext) return _tuningNoiseContext;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  _tuningNoiseContext = new Ctor();
  return _tuningNoiseContext;
}

function stopTuningNoise(): void {
  if (_tuningNoiseSource) {
    try {
      _tuningNoiseSource.stop();
    } catch {
      /* already stopped */
    }
    _tuningNoiseSource.disconnect();
    _tuningNoiseSource = null;
  }
  if (_tuningNoiseGain) {
    _tuningNoiseGain.disconnect();
    _tuningNoiseGain = null;
  }
}

function startTuningNoise(): void {
  const ctx = buildTuningNoiseContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  if (_tuningNoiseSource) return;
  const bufferSize = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = RADIO_TUNER_STATIC_MAX_GAIN;
  source.connect(gain).connect(ctx.destination);
  source.start();
  _tuningNoiseSource = source;
  _tuningNoiseGain = gain;
}

/** Toggle tuner static noise based on the tuning state. */
export function setRadioTuningStatic(active: boolean): void {
  useRadioStore.getState().setTuning({ staticOn: active });
  if (active) startTuningNoise();
  else stopTuningNoise();
}

// --- Voice ducking hook -----------------------------------------------------

let _voiceDucked = false;

/**
 * Mute/restore hook for a future voice assistant. Spectre V2 has no voice
 * system, so this is a no-op that keeps volume at the user value. A voice
 * layer can implement real ducking here (fade to 0 on duck, ease back on
 * restore) following GEV's setRadioVoiceDucking.
 */
export function setRadioVoiceDucking(ducked: boolean): void {
  _voiceDucked = Boolean(ducked);
  if (_audio) _audio.volume = _voiceDucked ? 0 : useRadioStore.getState().volume;
}

// --- Playback control -------------------------------------------------------

/** Stop the shared stream and release its network resource. */
export function stopRadioPlayback(): void {
  _playGeneration += 1;
  _activePlaybackAttempt = null;
  if (_audio) {
    _audio.pause();
    _audio.removeAttribute("src");
    _audio.load();
  }
  _audioStationId = null;
  useRadioStore.getState().setAudioState("stopped", null, null);
}

/** Pause Radio without toggling a stopped stream back on. */
export function pauseRadioPlayback(): void {
  if (!["loading", "playing", "buffering"].includes(useRadioStore.getState().audioState))
    return;
  _playGeneration += 1;
  _activePlaybackAttempt = null;
  _audio?.pause();
  useRadioStore.getState().setAudioState("paused", null, _audioStationId);
}

/**
 * Play the selected station's stream directly from the broadcaster.
 * Returns true if playback started successfully.
 */
export async function playSelectedRadio(
  station: RadioStation,
): Promise<boolean> {
  if (!station?.streamUrl) return false;
  installAudio();
  if (!_audio) return false;

  const generation = ++_playGeneration;
  const ownedAttemptId = `radio-play-${++_playAttemptSequence}`;
  _activePlaybackAttempt = {
    id: ownedAttemptId,
    stationId: station.id,
    streamUrl: station.streamUrl,
    generation,
  };
  useRadioStore.getState().setAudioState("loading", null, station.id);
  if (_audioStationId !== station.id || _audio.src !== station.streamUrl) {
    _audio.pause();
    _audio.src = station.streamUrl;
    _audioStationId = station.id;
  }

  try {
    const playback = _audio.play();
    if (playback) await playback;
    if (
      generation !== _playGeneration ||
      _audioStationId !== station.id ||
      _activePlaybackAttempt?.id !== ownedAttemptId
    )
      return false;
    useRadioStore.getState().setAudioState("playing", null, station.id);
    return true;
  } catch (error) {
    if (
      generation !== _playGeneration ||
      _activePlaybackAttempt?.id !== ownedAttemptId
    )
      return false;
    const audioError =
      (error as { name?: string })?.name === "NotAllowedError"
        ? "Playback requires a direct click or tap."
        : "Broadcaster stream could not be started.";
    useRadioStore.getState().setAudioState("error", audioError, station.id);
    return false;
  }
}

/** Pause or resume the selected stream. */
export async function toggleRadioPlayback(
  station: RadioStation | null,
): Promise<boolean> {
  const state = useRadioStore.getState().audioState;
  if (["loading", "playing", "buffering"].includes(state)) {
    pauseRadioPlayback();
    return true;
  }
  if (!station) return false;
  return playSelectedRadio(station);
}

/** Set shared audio volume, clamped to [0, 1]. */
export function setRadioVolume(value: number): void {
  const volume = clampRadioVolume(value);
  useRadioStore.getState().setVolume(volume);
  if (_audio && !_voiceDucked) _audio.volume = volume;
}

/** Release audio + static resources (called on layer disable). */
export function destroyRadioAudio(): void {
  stopRadioPlayback();
  stopTuningNoise();
  if (_tuningNoiseContext) {
    const closed = _tuningNoiseContext.close();
    void closed.catch(() => {});
    _tuningNoiseContext = null;
  }
  if (_audio) _audio.volume = DEFAULT_RADIO_VOLUME;
  _audio = null;
  _voiceDucked = false;
}
