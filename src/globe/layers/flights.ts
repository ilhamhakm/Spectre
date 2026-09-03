import * as Cesium from "cesium";
import type { LayerContext, LayerImpl } from "./types";
import {
  aircraftIcon,
  CLASS_SCALE_2D,
  type AircraftKind,
} from "./aircraft-icons";
import {
  getModelSpec,
  classifyAircraft,
  MODEL_HEADING_OFFSET_DEG,
  type AircraftClass,
} from "./aircraft-class";
import { useGlobeStore, type SelectedKind } from "@/store/globe-store";
import { loadVIPTrack, getVIPEntry, getVIPByRegistration, type VIPEntry } from "@/lib/viptrack-db";
import { searchVIPTrack, getNotableFlights } from "@/lib/viptrack-search";

/**
 * OpenSky Network API response shape.
 * https://opensky-network.org/apidoc/rest.html
 */
interface OpenSkyResponse {
  time: number;
  states: OpenSkyState[] | null;
}

/**
 * Each entry in the `states` array, in documented field order.
 */
type OpenSkyState = [
  string,            // 0  icao24
  string | null,     // 1  callsign
  string,            // 2  origin_country
  number | null,      // 3  time_position
  number,            // 4  last_contact
  number | null,      // 5  longitude
  number | null,      // 6  latitude
  number | null,      // 7  baro_altitude (meters)
  boolean,           // 8  on_ground
  number | null,      // 9  velocity (m/s)
  number | null,      // 10 true_track (degrees)
  number | null,      // 11 vertical_rate (m/s)
  number[] | null,    // 12 sensors
  number | null,      // 13 geo_altitude (meters)
  string | null,      // 14 squawk
  boolean,           // 15 spi
  number,            // 16 position_source
  number?,           // 17 category (extended, adsb.lol only)
  (string | null)?,  // 18 typeCode (ICAO type designator, adsb.lol only)
];

/** A normalized flight record extracted from an OpenSky state vector. */
interface FlightRecord {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number;
  latitude: number;
  altitude: number;
  onGround: boolean;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
  typeCode?: string | null;
  aircraftClass?: AircraftClass | null;
}

/**
 * Known commercial airline ICAO callsign prefixes (3-letter codes).
 * Both legacy ICAO codes and common IATA-style prefixes are covered.
 */
const COMMERCIAL_PREFIXES = new Set([
  // ICAO 3-letter
  "AAL", "UAL", "DAL", "SWA", "AFR", "BAW", "DLH", "KLM", "QFA", "SIA",
  "UAE", "ETD", "QTR", "ANA", "JAL", "KAL", "CCA", "CES", "CSN", "THY",
  "AZA", "IBE", "VIR", "ACA", "TAM", "GLO", "CCA", "AMX", "LAN", "SKW",
  "ASA", "FFT", "NKS", "JBU", "HAL", "FDX", "UPS", "GTI", "PAC", "GTW",
  // IATA 2-letter (used by some operators in callsigns)
  "LH", "BA", "AF", "KL", "AA", "UA", "DL", "WN", "EK", "QR", "EY",
  "QF", "SQ", "CX", "NH", "JL", "KE", "CA", "MU", "CZ", "TK",
]);

/**
 * Known military callsign prefixes. These are tactical/mission callsigns
 * used by air forces around the world (US AMC, RAF, RCAF, etc.).
 */
const MILITARY_PREFIXES = new Set([
  // US Air Mobility Command & common USAF
  "RCH", "PAT", "SAM", "EVAC", "REACH", "VIVI", "ASCOT", "ENVOY",
  "KNIGHT", "HOMER", "HUNT", "TITAN", "TRON", "TOPCAT", "SENTRY",
  "JSTAR", "EYE", "DRAGON", "LION", "TIGER", "WOLF", "EAGLE", "HAWK",
  "FALCON", "VIP", "BOLT", "STEEL", "SHELL", "GOLD", "BLUE", "RED",
  "MAJESTIC", "VENUS", "MARS", "JUPITER", "MERCURY", "SATURN", "NOVA",
  // Canadian Forces
  "CFC",
  // RAF
  "RRR", "CTF", "TORNADO", "TYPHOON", "LIGHTNING", "VOYAGER", "ATLAS",
  // NATO / others
  "NATO", "NAVFOR", "AFRICOM", "EUCOM", "CENTCOM", "PACOM", "STRATCOM",
]);

/** Matches a 3-letter ICAO airline code followed by 1-4 digits. */
const COMMERCIAL_CALLSIGN_REGEX = /^[A-Z]{3}\d{1,4}/;

type FlightCategory = "commercial" | "military" | "private";

/**
 * Classify a callsign into commercial, military, or private.
 *
 * Order matters: military is checked first because some military
 * callsigns (e.g. "RCH123") would otherwise match the commercial regex.
 */
function classifyCallsign(callsign: string): FlightCategory {
  const trimmed = callsign.trim().toUpperCase();
  if (!trimmed) return "private";

  // Extract the leading alphabetic prefix for set lookups.
  const prefixMatch = trimmed.match(/^[A-Z]+/);
  const prefix = prefixMatch ? prefixMatch[0] : "";

  // Military: exact prefix match against known tactical callsigns.
  if (MILITARY_PREFIXES.has(prefix) || MILITARY_PREFIXES.has(trimmed)) {
    return "military";
  }

  // Commercial: known airline prefix OR the standard ICAO pattern,
  // as long as the prefix isn't a known military callsign.
  if (COMMERCIAL_PREFIXES.has(prefix) || COMMERCIAL_CALLSIGN_REGEX.test(trimmed)) {
    if (!MILITARY_PREFIXES.has(prefix)) {
      return "commercial";
    }
  }

  return "private";
}

/** Client-side cache: icao24 -> typeCode (null once hexdb returned unknown). */
const _typeCodeCache = new Map<string, string | null>();
/** Client-side cache: icao24 -> AircraftClass (from hexdb or adsb.lol). */
const _aircraftClassCache = new Map<string, AircraftClass>();

/** Map an AircraftClass to a FlightCategory for fleet bucketing. */
function classToCategory(klass: AircraftClass): FlightCategory {
  switch (klass) {
    case "bizjet":
    case "helicopter":
    case "turboprop":
    case "light":
    case "glider":
    case "uav":
      return "private";
    case "fastjet":
      return "military";
    default:
      return "commercial";
  }
}

/**
 * Classify a flight using type code, client cache, then callsign fallback.
 * Populates aircraftClass on the record and queues hexdb enrichment when
 * no typeCode is available and the icao24 isn't cached yet.
 */
function classifyFlight(record: FlightRecord): FlightCategory {
  // adsb.lol /v2/mil override: airframes flagged military by the dedicated
  // feed win classification over typeCode/callsign heuristics. This catches
  // the bulk of military traffic (the callsign-prefix heuristic only finds
  // a handful of tactical callsigns; many military flights use mundane
  // registration-style callsigns that would otherwise bucket as private).
  if (_militaryIcaos.has(record.icao24.toLowerCase())) {
    record.aircraftClass = "fastjet";
    _aircraftClassCache.set(record.icao24, "fastjet");
    return "military";
  }

  if (record.typeCode) {
    const klass = classifyAircraft({ typeCode: record.typeCode });
    record.aircraftClass = klass;
    _aircraftClassCache.set(record.icao24, klass);
    _typeCodeCache.set(record.icao24, record.typeCode);
    return classToCategory(klass);
  }

  const cachedClass = _aircraftClassCache.get(record.icao24);
  if (cachedClass) {
    record.aircraftClass = cachedClass;
    return classToCategory(cachedClass);
  }

  // No type code and not cached: fall back to callsign heuristic.
  const category = record.callsign
    ? classifyCallsign(record.callsign)
    : "private";
  record.aircraftClass = category === "military"
    ? "fastjet"
    : category === "commercial"
      ? "airliner"
      : "light";
  return category;
}

/** Map an AircraftClass to an AircraftKind for the 2D billboard glyph. */
function iconKindForClass(klass: AircraftClass | null | undefined): AircraftKind {
  switch (klass) {
    case "bizjet": return "bizjet";
    case "helicopter": return "helicopter";
    case "turboprop": return "turboprop";
    case "fastjet": return "fastjet";
    case "airliner":
    case "widebody":
    case "quadjet":
      return "airliner";
    default:
      return "light";
  }
}

/**
 * Queue background hexdb lookups for flights lacking a typeCode. Collects
 * up to 20 uncached icao24s per poll and fires /api/aircraft-type with
 * concurrency limited to 5. Results populate the client-side cache and
 * apply on the next poll.
 */
const ENRICH_BATCH = 20;
const ENRICH_CONCURRENCY = 5;

async function enrichMissingTypes(flights: FlightRecord[]): Promise<void> {
  const todo: string[] = [];
  for (const f of flights) {
    if (f.typeCode) continue;
    if (_typeCodeCache.has(f.icao24)) continue;
    todo.push(f.icao24);
    if (todo.length >= ENRICH_BATCH) break;
  }
  if (todo.length === 0) return;

  let cursor = 0;
  const runOne = async (): Promise<void> => {
    while (cursor < todo.length) {
      const icao24 = todo[cursor++];
      try {
        const res = await fetch(`/api/aircraft-type?icao24=${icao24}`);
        if (!res.ok) {
          _typeCodeCache.set(icao24, null);
          continue;
        }
        const data = (await res.json()) as {
          typeCode: string | null;
          class: AircraftClass;
        };
        _typeCodeCache.set(icao24, data.typeCode);
        _aircraftClassCache.set(icao24, data.class);
      } catch {
        _typeCodeCache.set(icao24, null);
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(ENRICH_CONCURRENCY, todo.length); i++) {
    workers.push(runOne());
  }
  await Promise.all(workers);
}

/** Map a flight category to an aircraft icon kind for the billboard. */
function iconKindForCategory(category: FlightCategory, klass?: AircraftClass | null): AircraftKind {
  if (klass) return iconKindForClass(klass);
  switch (category) {
    case "military":
      return "fastjet";
    case "private":
      return "light";
    default:
      return "airliner";
  }
}

/**
 * Fetch all current state vectors from the OpenSky Network REST API.
 *
 * Basic (anonymous) queries are supported but are rate-limited. If both
 * `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` are present in the
 * environment, HTTP Basic auth is used to raise those limits.
 */
async function fetchOpenSkyStates(): Promise<OpenSkyResponse> {
  // Use server-side proxy for auth + caching (10s TTL)
  const res = await fetch("/api/opensky");
  if (!res.ok) {
    throw new Error(`OpenSky API request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as OpenSkyResponse;
}

/**
 * Fetch aircraft from adsb.lol around the camera viewport. adsb.lol is a
 * free, keyless community ADS-B aggregator with better coverage than
 * OpenSky in some regions (Southeast Asia, parts of Africa/South America).
 * Returns OpenSky-compatible state vectors so the existing parser works
 * unchanged. Fails silently - OpenSky data alone is still usable.
 */
async function fetchAdsbLolStates(): Promise<OpenSkyResponse | null> {
  if (!_viewer || _viewer.isDestroyed()) return null;
  const carto = _viewer.camera.positionCartographic;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    const res = await fetch(
      `/api/adsblol?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=250`,
    );
    if (!res.ok) return null;
    return (await res.json()) as OpenSkyResponse;
  } catch {
    return null;
  }
}

/**
 * Set of lowercase ICAO24 hexes flagged military by adsb.lol's /v2/mil feed.
 * Populated by fetchMilitaryStates on each poll and consulted by
 * classifyFlight so the dedicated military layer wins classification over
 * callsign/typeCode heuristics (which miss most military traffic).
 */
const _militaryIcaos = new Set<string>();

/**
 * Fetch adsb.lol's dedicated military feed (/v2/mil via the dev proxy).
 * Returns OpenSky-compatible state vectors AND updates the _militaryIcaos
 * set so classifyFlight can override the bucket for these airframes across
 * ALL sources (OpenSky + viewport adsb.lol + this feed). Fails silently:
 * a transient upstream failure leaves the previous set intact so a single
 * dropout doesn't declassify known military airframes mid-session.
 */
async function fetchMilitaryStates(): Promise<OpenSkyResponse | null> {
  try {
    const res = await fetch("/api/adsblol/mil", { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenSkyResponse;
    const states = data.states ?? [];
    // Refresh the known-military set from this poll. Adds only: a transient
    // dropout from one poll must not declassify an airframe mid-session.
    for (const s of states) {
      const hex = String(s[0] ?? "").trim().toLowerCase();
      if (hex) _militaryIcaos.add(hex);
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Convert a raw OpenSky state vector into a normalized FlightRecord,
 * or `null` if the aircraft lacks a usable position.
 */
function parseState(state: OpenSkyState): FlightRecord | null {
  const [
    icao24,
    callsignRaw,
    originCountry,
    ,
    ,
    longitude,
    latitude,
    baroAltitude,
    onGround,
    velocity,
    trueTrack,
    verticalRate,
    ,
    geoAltitude,
    squawk,
    ,
    ,
    ,
    typeCodeRaw,
  ] = state;

  // Require a valid lat/lon to render anything.
  if (longitude == null || latitude == null) return null;

  const callsign = (callsignRaw ?? "").trim();
  // Ground planes sit at 0m; airborne planes fall back to 1000m if no alt.
  const altitude = onGround ? 0 : (baroAltitude ?? geoAltitude ?? 1000);
  const typeCode = typeCodeRaw ? String(typeCodeRaw).trim() || null : null;

  return {
    icao24,
    callsign,
    originCountry,
    longitude,
    latitude,
    altitude,
    onGround: Boolean(onGround),
    velocity: velocity ?? null,
    heading: trueTrack ?? null,
    verticalRate: verticalRate ?? null,
    squawk: squawk ?? null,
    typeCode,
  };
}

/**
 * Fetch, parse, and classify all current flights from OpenSky, then merge
 * in adsb.lol data (viewport + the dedicated /v2/mil military feed) to fill
 * coverage gaps. Returns three buckets so each layer can render its own
 * subset.
 */
async function fetchClassifiedFlights(): Promise<{
  commercial: FlightRecord[];
  military: FlightRecord[];
  private: FlightRecord[];
}> {
  const data = await fetchOpenSkyStates();
  let states = data.states ?? [];

  // Build a dedup set keyed by lowercase icao24 across all sources.
  const seen = new Set(states.map((s) => (s[0] as string).toLowerCase()));

  // Merge adsb.lol as a secondary source: fetch around the camera viewport
  // and add any planes OpenSky doesn't already have (dedup by icao24).
  const adsbData = await fetchAdsbLolStates();
  if (adsbData?.states && adsbData.states.length > 0) {
    const newStates: OpenSkyState[] = [];
    for (const s of adsbData.states) {
      const id = (s[0] as string)?.toLowerCase();
      if (id && !seen.has(id)) {
        newStates.push(s as OpenSkyState);
        seen.add(id);
      }
    }
    if (newStates.length > 0) {
      states = [...states, ...newStates];
    }
  }

  // Merge adsb.lol's dedicated military feed (/v2/mil). This is the primary
  // source of military traffic: it returns airframes adsb.lol's database has
  // flagged military, which the callsign heuristic on OpenSky data misses.
  // The feed's fetch also refreshes _militaryIcaos so classifyFlight can
  // re-bucket any of these airframes that also appear in OpenSky/viewport
  // data into the military bucket (and out of commercial/private).
  const milData = await fetchMilitaryStates();
  if (milData?.states && milData.states.length > 0) {
    const newStates: OpenSkyState[] = [];
    for (const s of milData.states) {
      const id = (s[0] as string)?.toLowerCase();
      if (id && !seen.has(id)) {
        newStates.push(s as OpenSkyState);
        seen.add(id);
      }
    }
    if (newStates.length > 0) {
      states = [...states, ...newStates];
    }
  }

  const commercial: FlightRecord[] = [];
  const military: FlightRecord[] = [];
  const privateFlights: FlightRecord[] = [];
  const allRecords: FlightRecord[] = [];

  for (const state of states) {
    const record = parseState(state);
    if (!record) continue;

    // Ground planes are RENDERED (not skipped) to match GEV coverage.
    // GEV renders them at 0.8x scale so airport clutter stays minor.
    // Ground planes still get classified and shown on the globe.

    const category = classifyFlight(record);
    allRecords.push(record);

    switch (category) {
      case "commercial":
        commercial.push(record);
        break;
      case "military":
        military.push(record);
        break;
      default:
        privateFlights.push(record);
        break;
    }
  }

  // Background hexdb enrichment for flights lacking a typeCode.
  // Results populate the client-side cache and apply on the next poll.
  enrichMissingTypes(allRecords).catch(() => {});

  return { commercial, military, private: privateFlights };
}

/** Visual configuration per layer category. */
interface LayerStyle {
  /** Billboard tint color (multiplies the white SVG silhouette). */
  color: Cesium.Color;
  /** Tracked billboard tint (cyan when following). */
  trackedColor: Cesium.Color;
}

const COMMERCIAL_STYLE: LayerStyle = {
  color: Cesium.Color.WHITE,
  trackedColor: Cesium.Color.WHITE,
};

const MILITARY_STYLE: LayerStyle = {
  color: Cesium.Color.fromCssColorString("#FF3030"), // red
  trackedColor: Cesium.Color.fromCssColorString("#FF3030"),
};

const PRIVATE_STYLE: LayerStyle = {
  color: Cesium.Color.WHITE,
  trackedColor: Cesium.Color.WHITE,
};

/** Polling interval between OpenSky refreshes, in milliseconds. */
const POLL_INTERVAL_MS = 15_000;

/** Billboard width/height in pixels (fleet). */
const FLEET_ICON_PX = 20;
/** Billboard width/height in pixels (tracked). */
const TRACKED_ICON_PX = 28;
/** Scale multiplier for grounded aircraft (matches GEV's GROUND_SCALE). */
const GROUND_SCALE = 0.8;

/**
 * Compute the screen-projected billboard rotation for a heading.
 *
 * With alignedAxis = ZERO, Cesium's billboard rotation is a 2D screen-space
 * angle (radians, CCW-positive). The SVG glyphs are drawn nose-up (nose
 * toward -Y), so rotation = -heading_rad points the nose along the true
 * track. We use the screen-projected approach from GEV for accuracy at
 * any camera pitch: project the course vector onto the camera's right/up
 * basis.
 */
function screenProjectedRotation(
  scene: Cesium.Scene,
  position: Cesium.Cartesian3,
  courseDeg: number,
  cesium: typeof Cesium,
  previous: number = 0,
): number {
  const camera = scene?.camera;
  if (!camera?.rightWC || !camera?.upWC || !position) return previous;

  const courseRad = cesium.Math.toRadians(courseDeg || 0);
  // Forward probe point in ENU: east = sin(course), north = cos(course).
  const FORWARD_PROBE_M = 2000;
  const east = Math.sin(courseRad) * FORWARD_PROBE_M;
  const north = Math.cos(courseRad) * FORWARD_PROBE_M;

  // ENU to ECEF transform at the entity position.
  const enuToEcef = new cesium.Matrix4();
  cesium.Transforms.eastNorthUpToFixedFrame(
    position,
    cesium.Ellipsoid.WGS84,
    enuToEcef,
  );

  // World-space forward vector.
  const localForward = new cesium.Cartesian3(east, north, 0);
  const worldForward = cesium.Matrix4.multiplyByPoint(
    enuToEcef,
    localForward,
    new cesium.Cartesian3(),
  );

  // Project onto camera right/up basis.
  // Screen x follows camera-right. Window y grows downward (opposite of
  // camera-up), so dy = -dot(up). Icon direction in window coords after CCW
  // rotation r is (-sin r, -cos r), so matching the projected course (dx, dy)
  // gives r = atan2(-dx, -dy). This matches GEV's iconOrientation.js.
  const dx = cesium.Cartesian3.dot(worldForward, camera.rightWC);
  const dy = -cesium.Cartesian3.dot(worldForward, camera.upWC);

  if ((dx * dx + dy * dy) < 0.25) return previous; // < 0.5m screen component

  return Math.atan2(-dx, -dy);
}

// ---------------------------------------------------------------------------
// Click-to-select: shared across all flight layers.
// ---------------------------------------------------------------------------
// When a flight billboard is clicked, we set selectedFlightId in the Zustand
// store. FlightTrajectoryOverlay (a React component) watches the store,
// fetches the trajectory from /api/flights/track, renders a glowing polyline
// + 3D glTF model, and sets viewer.trackedEntity for camera follow.
// flights.ts just hides the fleet billboard for the selected flight so the
// 3D model shows instead. When selection is cleared, the billboard is restored.

/** Map of icao24 -> flight data, shared across layers for click resolution. */
const _flightRegistry = new Map<string, { flight: FlightRecord; category: FlightCategory }>();
/** Map of icao24 -> billboard, shared across layers. */
const _billboardRegistry = new Map<string, Cesium.Billboard>();
/** Active billboard collections per category, for show/hide on track. */
const _billboardCollections = new Map<FlightCategory, Cesium.BillboardCollection>();
/** Active viewers for cleanup. */
let _viewer: Cesium.Viewer | null = null;
let _cesium: typeof Cesium | null = null;
let _clickHandler: Cesium.ScreenSpaceEventHandler | null = null;
/** Store unsubscribe function for selection changes. */
let _storeUnsubscribe: (() => void) | null = null;
/** Currently selected icao24 (mirrors store.selectedFlightId for fast access). */
let _selectedIcao: string | null = null;

let _vipDB: VIPEntry[] | null = null;
let _vipDBLoaded: boolean = false;

export interface SearchResult {
  icao24: string;
  callsign: string;
  registration: string;
  operator: string;
  type: string;
  tags: string[];
  lat: number;
  lon: number;
  live: boolean;
  category: string;
}

/** Map a flight category to the store's SelectedKind. */
function kindForCategory(category: FlightCategory): SelectedKind {
  switch (category) {
    case "commercial": return "flight-commercial";
    case "military": return "flight-mil";
    case "private": return "flight-private";
  }
}

/**
 * Install the click-to-select handler on the viewer. Idempotent.
 * Clicking a flight billboard sets selectedFlightId in the store.
 * Clicking empty space or pressing Escape clears the selection.
 */
function installClickHandler(viewer: Cesium.Viewer, cesium: typeof Cesium): void {
  if (_clickHandler) return;
  _viewer = viewer;
  _cesium = cesium;

  _clickHandler = new cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
    const picked = viewer.scene.pick(click.position);

    if (picked) {
      // BillboardCollection picks: the billboard's id is the icao24.
      const bb = picked.primitive as Cesium.Billboard;
      if (bb?.id && _billboardRegistry.has(bb.id as string)) {
        const entry = _flightRegistry.get(bb.id as string);
        if (entry) {
          useGlobeStore.getState().selectFlight(bb.id as string, kindForCategory(entry.category));
        }
        return;
      }
      // Some Cesium versions surface the id on picked.id.
      if (picked.id && typeof picked.id === "string" && _billboardRegistry.has(picked.id)) {
        const entry = _flightRegistry.get(picked.id);
        if (entry) {
          useGlobeStore.getState().selectFlight(picked.id, kindForCategory(entry.category));
        }
        return;
      }
    }

    // Clicked empty space: deselect.
    if (_selectedIcao) {
      useGlobeStore.getState().selectFlight(null, null);
    }
  }, cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Escape deselects.
  document.addEventListener("keydown", _onKeyDown);

  // Subscribe to store selection changes to hide/show the fleet billboard.
  if (!_storeUnsubscribe) {
    _storeUnsubscribe = useGlobeStore.subscribe((state, prevState) => {
      if (state.selectedFlightId !== prevState.selectedFlightId) {
        onSelectionChanged(state.selectedFlightId);
      }
    });
  }
}

function _onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape" && _selectedIcao) {
    useGlobeStore.getState().selectFlight(null, null);
  }
}

/**
 * React to a store selection change: hide the newly-selected flight's
 * billboard (the 3D model replaces it) and restore the previously-selected
 * flight's billboard.
 */
function onSelectionChanged(newId: string | null): void {
  // Restore the previously selected billboard.
  if (_selectedIcao) {
    const prevBb = _billboardRegistry.get(_selectedIcao);
    if (prevBb) prevBb.show = true;
  }
  // Hide the newly selected billboard and remove its fleet 3D model
  // (FlightTrajectoryOverlay renders its own close-up model for the tracked plane).
  if (newId) {
    const bb = _billboardRegistry.get(newId);
    if (bb) bb.show = false;
    _fleetModelManager.hideForTracking(newId);
  }
  _selectedIcao = newId;
  if (_viewer && !_viewer.isDestroyed()) _viewer.scene.requestRender();
}

/** Remove the click handler and store subscription (called on layer disable). */
function uninstallClickHandler(): void {
  if (_clickHandler) {
    _clickHandler.destroy();
    _clickHandler = null;
  }
  document.removeEventListener("keydown", _onKeyDown);
  if (_storeUnsubscribe) {
    _storeUnsubscribe();
    _storeUnsubscribe = null;
  }
  _selectedIcao = null;
}

/**
 * Get live flight info by icao24. Exposed via window.__flightsHandle so
 * FlightTrajectoryOverlay can populate the detail panel instantly before
 * the trajectory fetch completes.
 */
function getFlightInfo(icao24: string): {
  callsign: string;
  lat: number;
  lon: number;
  alt: number;
  heading: number | null;
  velocity: number | null;
  originCountry: string;
  onGround: boolean;
  verticalRate: number | null;
  squawk: string | null;
} | null {
  const entry = _flightRegistry.get(icao24);
  if (!entry) return null;
  const f = entry.flight;
  return {
    callsign: f.callsign,
    lat: f.latitude,
    lon: f.longitude,
    alt: f.altitude,
    heading: f.heading,
    velocity: f.velocity,
    originCountry: f.originCountry,
    onGround: f.onGround,
    verticalRate: f.verticalRate,
    squawk: f.squawk,
  };
}

/**
 * Get the live Cartesian3 position of a flight by icao24.
 * Exposed via window.__flightsHandle for FlightTrajectoryOverlay to
 * drive the 3D model's CallbackProperty position so the camera follow
 * stays in sync with the live feed.
 */
function getFlightPosition(icao24: string): Cesium.Cartesian3 | null {
  const entry = _flightRegistry.get(icao24);
  if (!entry) return null;
  const f = entry.flight;
  if (!_cesium) return null;
  return _cesium.Cartesian3.fromDegrees(f.longitude, f.latitude, f.altitude);
}

/**
 * Get the live heading (true_track) of a flight by icao24, in degrees.
 * Exposed via window.__flightsHandle for FlightTrajectoryOverlay to
 * orient the 3D model each frame.
 */
function getFlightHeading(icao24: string): number | null {
  const entry = _flightRegistry.get(icao24);
  if (!entry) return null;
  return entry.flight.heading;
}

/**
 * Get the live velocity (m/s) of a flight by icao24.
 * Used for dead-reckoning extrapolation between polls.
 */
function getFlightVelocity(icao24: string): number | null {
  const entry = _flightRegistry.get(icao24);
  if (!entry) return null;
  return entry.flight.velocity;
}

/**
 * Get the timestamp of the last position update for a flight.
 * Used for dead-reckoning: extrapolate position based on elapsed time.
 */
function getFlightLastUpdate(icao24: string): number {
  // OpenSky's last_contact is the best proxy; we use Date.now() of the
  // last refresh as a reasonable approximation since we don't store the
  // raw timestamp. The dead-reckoning only needs to know how much time
  // has passed since the last fix.
  return _lastRefreshTime;
}

/** Timestamp of the last successful refresh, for dead-reckoning. */
let _lastRefreshTime: number = Date.now();

/**
 * Search flights by callsign or ICAO24 hex. Returns up to 10 matches.
 * Exposed via window.__flightsHandle for the RightPanel search button.
 */
function searchFlights(query: string): Array<{
  icao24: string;
  callsign: string;
  lat: number;
  lon: number;
  category: FlightCategory;
}> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: Array<{
    icao24: string;
    callsign: string;
    lat: number;
    lon: number;
    category: FlightCategory;
  }> = [];
  const seen = new Set<string>();
  for (const [icao24, entry] of _flightRegistry) {
    const cs = entry.flight.callsign.toLowerCase();
    if (cs.includes(q) || icao24.toLowerCase().includes(q)) {
      results.push({
        icao24,
        callsign: entry.flight.callsign,
        lat: entry.flight.latitude,
        lon: entry.flight.longitude,
        category: entry.category,
      });
      seen.add(icao24);
      if (results.length >= 10) break;
    }
  }

  if (_vipDB) {
    const vipReg = getVIPByRegistration(query.trim());
    if (vipReg && !seen.has(vipReg.icao24)) {
      const live = _flightRegistry.get(vipReg.icao24);
      if (live) {
        results.push({
          icao24: vipReg.icao24,
          callsign: live.flight.callsign,
          lat: live.flight.latitude,
          lon: live.flight.longitude,
          category: live.category,
        });
      }
    }
    const vipMatches = searchVIPTrack(query);
    for (const v of vipMatches) {
      if (seen.has(v.icao24)) continue;
      const live = _flightRegistry.get(v.icao24);
      if (live) {
        results.push({
          icao24: v.icao24,
          callsign: live.flight.callsign,
          lat: live.flight.latitude,
          lon: live.flight.longitude,
          category: live.category,
        });
        seen.add(v.icao24);
      }
      if (results.length >= 10) break;
    }
  }

  return results;
}

function isFlightLive(icao24: string): boolean {
  return _flightRegistry.has(icao24.toLowerCase());
}

function searchAll(query: string): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const seenOperators = new Set<string>();

  for (const [icao24, entry] of _flightRegistry) {
    const cs = entry.flight.callsign.toLowerCase();
    const ql = q.toLowerCase();
    if (cs.includes(ql) || icao24.toLowerCase().includes(ql)) {
      results.push({
        icao24,
        callsign: entry.flight.callsign,
        registration: "",
        operator: "",
        type: "",
        tags: [],
        lat: entry.flight.latitude,
        lon: entry.flight.longitude,
        live: true,
        category: entry.category,
      });
      seen.add(icao24);
    }
  }

  if (_vipDB) {
    const vipResults = searchVIPTrack(q);
    for (const v of vipResults) {
      if (seen.has(v.icao24)) continue;
      // Deduplicate by operator name (keep first/highest priority hit).
      const opKey = v.operator.toLowerCase().trim();
      if (opKey && seenOperators.has(opKey)) continue;
      if (opKey) seenOperators.add(opKey);
      const live = _flightRegistry.get(v.icao24);
      results.push({
        icao24: v.icao24,
        callsign: live?.flight.callsign ?? "",
        registration: v.registration,
        operator: v.operator,
        type: v.type,
        tags: v.tags,
        lat: live?.flight.latitude ?? 0,
        lon: live?.flight.longitude ?? 0,
        live: !!live,
        category: v.category,
      });
      seen.add(v.icao24);
    }
  }

  results.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return 0;
  });
  return results.slice(0, 20);
}

function getNotableFlightsList(limit: number): VIPEntry[] {
  const all = getNotableFlights(500);
  // Only show flights that are currently live in the registry.
  // Deduplicate by operator name (keep highest priority entry per operator).
  const seenOperators = new Set<string>();
  const live: VIPEntry[] = [];
  for (const entry of all) {
    if (!_flightRegistry.has(entry.icao24.toLowerCase())) continue;
    const opKey = entry.operator.toLowerCase().trim();
    if (seenOperators.has(opKey)) continue;
    seenOperators.add(opKey);
    live.push(entry);
    if (live.length >= limit) break;
  }
  return live;
}

function getVIPEntryForIcao(icao24: string): VIPEntry | null {
  return getVIPEntry(icao24);
}

async function ensureVIPDBLoaded(): Promise<void> {
  if (_vipDBLoaded) return;
  try {
    _vipDB = await loadVIPTrack();
    _vipDBLoaded = true;
  } catch {
    _vipDBLoaded = false;
  }
}

/**
 * Get all visible private and military flight positions for bracket overlay.
 * Returns an array of { icao24, position, category } for flights whose
 * billboards are currently shown (not occluded). Used by TargetingBracket
 * to draw corner brackets around all private/military planes.
 * Exposed via window.__flightsHandle.
 */
function getBracketTargets(): Array<{
  icao24: string;
  position: Cesium.Cartesian3;
  category: FlightCategory;
}> {
  const out: Array<{
    icao24: string;
    position: Cesium.Cartesian3;
    category: FlightCategory;
  }> = [];
  for (const [icao24, bb] of _billboardRegistry) {
    if (!bb.show) continue;
    const entry = _flightRegistry.get(icao24);
    if (!entry) continue;
    if (entry.category === "private" || entry.category === "military") {
      out.push({ icao24, position: bb.position, category: entry.category });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occlusion culling: hide billboards on the far side of the globe.
// ---------------------------------------------------------------------------
// A flight is visible from the camera if the dot product of the flight's
// outward surface normal and the direction from the flight to the camera
// is positive. If it's negative, the Earth is between the camera and the
// flight, so we hide the billboard. This prevents seeing planes from the
// other side of the globe through the Earth.

/** Scratch vectors for occlusion test (avoid per-frame allocation). */
const _scratchFlightNormal = new Cesium.Cartesian3();
const _scratchToCamera = new Cesium.Cartesian3();

/**
 * Returns true if the flight position is on the near side of the globe
 * (visible from the camera), false if occluded by the Earth.
 */
function isVisibleFromCamera(
  flightPos: Cesium.Cartesian3,
  cameraPos: Cesium.Cartesian3,
  cesium: typeof Cesium,
): boolean {
  // Outward normal at the flight position (normalize the position vector).
  const normal = cesium.Cartesian3.normalize(flightPos, _scratchFlightNormal);
  // Direction from flight to camera.
  const toCamera = cesium.Cartesian3.subtract(
    cameraPos,
    flightPos,
    _scratchToCamera,
  );
  // If dot(normal, toCamera) > 0, the flight is on the near side.
  return cesium.Cartesian3.dot(normal, toCamera) > 0;
}

// ---------------------------------------------------------------------------
// Fleet 3D models: when zoomed in below MODEL_ALT_CEIL_M, nearby in-frustum
// planes get real 3D glTF models instead of flat billboards. Simplified
// version of GEV's fleet 3D system: one mode, hard cap, frustum cull.
// ---------------------------------------------------------------------------

/** Camera altitude (m) below which fleet 3D models activate. */
const FLEET_MODEL_ALT_CEIL_M = 800_000;
/** Maximum simultaneous fleet 3D models (draw-call budget). */
const FLEET_MODEL_MAX = 100;
/** Minimum on-screen pixel size for fleet models (keeps distant ones visible). */
const FLEET_MODEL_MIN_PX = 24;
/** Maximum on-screen pixel size for fleet models (prevents giant close-up blobs). */
const FLEET_MODEL_MAX_PX = 80;
/** Add radius (m): planes within this get models. */
const FLEET_MODEL_ADD_M = 150_000;
/** Keep radius (m): planes beyond this lose models (hysteresis > ADD). */
const FLEET_MODEL_KEEP_M = 180_000;

/** Map flight category to aircraft class for model selection. */
function classForCategory(category: FlightCategory, klass?: AircraftClass | null): AircraftClass {
  if (klass) return klass;
  switch (category) {
    case "military": return "fastjet";
    case "private": return "light";
    default: return "airliner";
  }
}

interface FleetModelSlot {
  icao24: string;
  model: Cesium.Model;
  klass: AircraftClass;
}

/**
 * Fleet 3D model manager. One instance shared across all flight layers.
 * Manages a PrimitiveCollection of glTF models, activating/deactivating
 * based on camera altitude and frustum visibility.
 */
class FleetModelManager {
  private collection: Cesium.PrimitiveCollection | null = null;
  private slots = new Map<string, FleetModelSlot>();
  private viewer: Cesium.Viewer | null = null;
  private cesium: typeof Cesium | null = null;
  /** Pre-loaded model specs per class, cached to avoid repeated fromGltfAsync. */
  private modelCache = new Map<AircraftClass, { url: string; scale: number; radiusM: number }>();

  attach(viewer: Cesium.Viewer, cesium: typeof Cesium): void {
    this.viewer = viewer;
    this.cesium = cesium;
    this.collection = new cesium.PrimitiveCollection();
    viewer.scene.primitives.add(this.collection);
  }

  detach(): void {
    if (this.collection && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection);
    }
    this.collection = null;
    this.slots.clear();
    this.modelCache.clear();
  }

  /** Get the shared model spec for a class (cached). */
  private getSpec(klass: AircraftClass): { url: string; scale: number; radiusM: number } {
    let cached = this.modelCache.get(klass);
    if (!cached) {
      const spec = getModelSpec(klass);
      cached = { url: spec.url, scale: spec.scale, radiusM: spec.radiusM };
      this.modelCache.set(klass, cached);
    }
    return cached;
  }

  /**
   * Per-frame tick: evaluate which planes should have models, add/remove
   * as needed, and update positions/orientations/scales of active models.
   */
  tick(): void {
    if (!this.viewer || !this.cesium || !this.collection) return;
    if (this.viewer.isDestroyed()) return;

    const cesium = this.cesium;
    const viewer = this.viewer;
    const cameraAlt = viewer.camera.positionCartographic.height;

    // Altitude gate: above the ceiling, remove all fleet models.
    if (cameraAlt > FLEET_MODEL_ALT_CEIL_M) {
      if (this.slots.size > 0) this.removeAll();
      return;
    }

    const cameraPos = viewer.camera.position;

    // Gather candidate flights: all registry entries except the tracked one,
    // that are on the near side of the globe and within the keep radius.
    interface Candidate {
      icao24: string;
      position: Cesium.Cartesian3;
      category: FlightCategory;
      aircraftClass: AircraftClass | null;
      heading: number | null;
      distSq: number;
    }
    const candidates: Candidate[] = [];

    for (const [icao24, entry] of _flightRegistry) {
      // Skip the tracked plane (it has its own model in FlightTrajectoryOverlay).
      if (icao24 === _selectedIcao) continue;
      const f = entry.flight;
      const pos = cesium.Cartesian3.fromDegrees(f.longitude, f.latitude, f.altitude);
      // Occlusion cull: skip far-side planes.
      if (!isVisibleFromCamera(pos, cameraPos, cesium)) continue;
      const distSq = cesium.Cartesian3.distanceSquared(pos, cameraPos);
      // Keep radius check (hysteresis): if already has a model, use KEEP_M;
      // if not, use ADD_M.
      const hasModel = this.slots.has(icao24);
      const radiusSq = hasModel ? FLEET_MODEL_KEEP_M * FLEET_MODEL_KEEP_M : FLEET_MODEL_ADD_M * FLEET_MODEL_ADD_M;
      if (distSq > radiusSq) {
        // Beyond radius: remove if it had a model.
        if (hasModel) this.removeOne(icao24);
        continue;
      }
      candidates.push({ icao24, position: pos, category: entry.category, aircraftClass: f.aircraftClass ?? null, heading: f.heading, distSq });
    }

    // Sort by distance (nearest first) and cap at FLEET_MODEL_MAX.
    candidates.sort((a, b) => a.distSq - b.distSq);

    // Determine which icaos should have models (nearest N within add radius).
    const desired = new Set<string>();
    for (let i = 0; i < candidates.length && desired.size < FLEET_MODEL_MAX; i++) {
      desired.add(candidates[i].icao24);
    }

    // Remove models for planes that dropped out of the desired set.
    for (const icao24 of [...this.slots.keys()]) {
      if (!desired.has(icao24)) this.removeOne(icao24);
    }

    // Add models for new desired planes.
    for (const c of candidates) {
      if (desired.has(c.icao24) && !this.slots.has(c.icao24)) {
        this.addOne(c.icao24, c.position, c.category, c.aircraftClass, c.heading);
      }
    }

    // Update all active model transforms (position, heading, scale).
    for (const c of candidates) {
      if (!desired.has(c.icao24)) continue;
      const slot = this.slots.get(c.icao24);
      if (!slot) continue;
      this.updateTransform(slot, c.position, c.heading);
    }
  }

  private addOne(
    icao24: string,
    position: Cesium.Cartesian3,
    category: FlightCategory,
    aircraftClass: AircraftClass | null,
    heading: number | null,
  ): void {
    if (!this.cesium || !this.collection) return;
    const cesium = this.cesium;
    const klass = classForCategory(category, aircraftClass);
    const spec = this.getSpec(klass);

    // Load the model asynchronously.
    cesium.Model.fromGltfAsync({
      url: spec.url,
      asynchronous: false,
      minimumPixelSize: FLEET_MODEL_MIN_PX,
      scale: spec.scale,
      color: Cesium.Color.WHITE,
      colorBlendMode: Cesium.ColorBlendMode.MIX,
      colorBlendAmount: 0.94,
    }).then((model: Cesium.Model) => {
      if (!this.collection || this.viewer?.isDestroyed()) {
        // Layer was disabled during load; discard.
        return;
      }
      // Check we still want this model (may have been removed while loading).
      if (!this.slots.has(icao24)) {
        // Was removed during load. Don't add it.
        // We can't easily destroy a loaded model here, just don't add to scene.
        return;
      }
      this.collection.add(model);
      const slot = this.slots.get(icao24)!;
      slot.model = model;
      model.show = true;
      this.updateTransform(slot, position, heading);
    }).catch(() => {});

    // Register the slot immediately (model fills in when loaded).
    this.slots.set(icao24, { icao24, model: null as unknown as Cesium.Model, klass });
  }

  private removeOne(icao24: string): void {
    const slot = this.slots.get(icao24);
    if (!slot) return;
    if (slot.model && this.collection && !slot.model.isDestroyed()) {
      this.collection.remove(slot.model);
    }
    this.slots.delete(icao24);
  }

  private removeAll(): void {
    for (const icao24 of [...this.slots.keys()]) {
      this.removeOne(icao24);
    }
  }

  /** Hide a plane's fleet model when it becomes the tracked plane. */
  hideForTracking(icao24: string): void {
    this.removeOne(icao24);
  }

  private updateTransform(
    slot: FleetModelSlot,
    position: Cesium.Cartesian3,
    heading: number | null,
  ): void {
    if (!this.cesium || !this.viewer) return;
    if (!slot.model || slot.model.isDestroyed()) return;
    const cesium = this.cesium;
    const viewer = this.viewer;

    let headingDeg = heading ?? 0;
    headingDeg += MODEL_HEADING_OFFSET_DEG;
    const hpr = new cesium.HeadingPitchRoll(
      cesium.Math.toRadians(headingDeg), 0, 0,
    );
    const enu = cesium.Transforms.eastNorthUpToFixedFrame(
      position, cesium.Ellipsoid.WGS84,
    );
    const rangeM = cesium.Cartesian3.distance(viewer.camera.positionWC, position);
    const spec = this.getSpec(slot.klass);

    // Pixel-size capping: clamp the model's on-screen size to FLEET_MODEL_MAX_PX.
    let scale = spec.scale;
    const fovy = (viewer.camera.frustum as Cesium.PerspectiveFrustum).fovy ?? 1.0;
    const viewportH = viewer.scene.canvas.clientHeight;
    if (Number.isFinite(rangeM) && rangeM > 0 && Number.isFinite(fovy) && fovy > 0 && viewportH > 0) {
      const focalPx = viewportH / (2 * Math.tan(fovy / 2));
      const projectedPx = (2 * spec.radiusM * spec.scale * focalPx) / rangeM;
      if (projectedPx > FLEET_MODEL_MAX_PX) {
        scale = spec.scale * (FLEET_MODEL_MAX_PX / projectedPx);
      }
    }

    slot.model.scale = scale;
    const trs = new cesium.TranslationRotationScale(
      new cesium.Cartesian3(0, 0, 0),
      cesium.Quaternion.fromHeadingPitchRoll(hpr),
      new cesium.Cartesian3(scale, scale, scale),
    );
    slot.model.modelMatrix = cesium.Matrix4.multiply(
      enu,
      cesium.Matrix4.fromTranslationRotationScale(trs, new cesium.Matrix4()),
      new cesium.Matrix4(),
    );
  }
}

/** Shared fleet model manager instance (one for all flight layers). */
const _fleetModelManager = new FleetModelManager();
/** Track how many layers are currently enabled (for attach/detach lifecycle). */
let _activeLayerCount = 0;

// ---------------------------------------------------------------------------
// Layer factory
// ---------------------------------------------------------------------------

/**
 * Shared factory that creates a self-contained `LayerImpl` for a single
 * flight category. Each instance owns its own billboard collection and
 * polling timer so they can be enabled/disabled independently.
 *
 * All flights are rendered as billboards with aircraft silhouette icons,
 * rotated to match their heading. No labels on the fleet (clean view).
 * Click any plane to select it: the store's selectedFlightId is set, which
 * triggers FlightTrajectoryOverlay to fetch the trajectory, render a 3D
 * model, and fly the camera to follow it. Billboards on the far side of
 * the globe are culled via occlusion testing.
 */
function createFlightsLayer(
  category: FlightCategory,
  style: LayerStyle,
): LayerImpl {
  let billboardCollection: Cesium.BillboardCollection | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let preRenderRemove: (() => void) | null = null;
  /** icao24 -> billboard, owned by this layer. */
  const layerBillboards = new Map<string, Cesium.Billboard>();
  /** icao24 -> flight data, owned by this layer. */
  const layerFlights = new Map<string, FlightRecord>();

  /** Remove all billboards created by this layer. */
  const clearBillboards = (viewer: Cesium.Viewer): void => {
    if (billboardCollection) {
      viewer.scene.primitives.remove(billboardCollection);
      billboardCollection = null;
    }
    for (const id of layerBillboards.keys()) {
      _billboardRegistry.delete(id);
      _flightRegistry.delete(id);
    }
    layerBillboards.clear();
    layerFlights.clear();
  };

  /** Fetch, classify, and render this layer's flights as billboards. */
  const refresh = async (viewer: Cesium.Viewer, cesium: typeof Cesium): Promise<void> => {
    const buckets = await fetchClassifiedFlights();
    if (viewer.isDestroyed() || !billboardCollection) return;
    // Re-check scene access (viewer may be destroyed during the await).
    try {
      void viewer.scene;
    } catch {
      return;
    }
    const flights = buckets[category];

    // Track which icaos are still present for reconciliation.
    const seen = new Set<string>();

    for (const flight of flights) {
      seen.add(flight.icao24);

      // Skip the selected aircraft (3D model replaces its billboard).
      if (flight.icao24 === _selectedIcao) continue;

      const position = cesium.Cartesian3.fromDegrees(
        flight.longitude,
        flight.latitude,
        flight.altitude,
      );

      // Occlusion culling: hide billboards on the far side of the globe.
      const visible = isVisibleFromCamera(position, viewer.camera.position, cesium);

      // Per-flight icon selection based on aircraftClass.
      const kind = iconKindForCategory(category, flight.aircraftClass);
      const iconUri = aircraftIcon(kind);

      const existing = layerBillboards.get(flight.icao24);
      if (existing) {
        // Update existing billboard in place.
        existing.position = position;
        existing.show = visible;
        existing.image = iconUri;
        // Ground planes render smaller (matches GEV's GROUND_SCALE).
        existing.scale = CLASS_SCALE_2D[kind] * (flight.onGround ? GROUND_SCALE : 1);
        if (flight.heading != null) {
          existing.rotation = screenProjectedRotation(
            viewer.scene, position, flight.heading, cesium, existing.rotation,
          );
        }
        // Update registry data.
        _flightRegistry.set(flight.icao24, { flight, category });
        layerFlights.set(flight.icao24, flight);
      } else {
        // Add new billboard.
        if (!billboardCollection) continue; // layer was disabled mid-fetch
        const bb = billboardCollection.add({
          position,
          image: iconUri,
          width: FLEET_ICON_PX,
          height: FLEET_ICON_PX,
          scale: CLASS_SCALE_2D[kind] * (flight.onGround ? GROUND_SCALE : 1),
          rotation: flight.heading
            ? screenProjectedRotation(viewer.scene, position, flight.heading, cesium)
            : 0,
          alignedAxis: cesium.Cartesian3.ZERO,
          color: style.color,
          sizeInMeters: false,
          scaleByDistance: new cesium.NearFarScalar(1000, 1.0, 8000000, 0.5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          id: flight.icao24,
          show: visible,
        });
        layerBillboards.set(flight.icao24, bb);
        layerFlights.set(flight.icao24, flight);
        _billboardRegistry.set(flight.icao24, bb);
        _flightRegistry.set(flight.icao24, { flight, category });
      }
    }

    // Remove billboards for flights no longer in the data.
    for (const [icao24, bb] of layerBillboards) {
      if (!seen.has(icao24)) {
        billboardCollection?.remove(bb);
        layerBillboards.delete(icao24);
        layerFlights.delete(icao24);
        _billboardRegistry.delete(icao24);
        _flightRegistry.delete(icao24);
      }
    }

    viewer.scene.requestRender();
    _lastRefreshTime = Date.now();
  };

  /** Per-frame tick: update billboard rotations + occlusion culling. */
  const fleetTick = (): void => {
    if (!billboardCollection || !_viewer || !_cesium) return;
    const cameraPos = _viewer.camera.position;
    for (const [icao24, bb] of layerBillboards) {
      // Skip the selected aircraft (3D model replaces it).
      if (icao24 === _selectedIcao) continue;
      // Occlusion culling: hide billboards on the far side of the globe.
      bb.show = isVisibleFromCamera(bb.position, cameraPos, _cesium);
      // Update rotation to follow camera changes.
      const flight = layerFlights.get(icao24);
      if (!flight || flight.heading == null) continue;
      bb.rotation = screenProjectedRotation(
        _viewer.scene, bb.position, flight.heading, _cesium, bb.rotation,
      );
    }
    // Drive the fleet 3D model system (adds/removes/updates glTF models
    // for nearby in-frustum planes when zoomed in).
    _fleetModelManager.tick();
  };

  return {
    async enable(ctx: LayerContext): Promise<void> {
      const { viewer, Cesium: cesium } = ctx;
      if (viewer.isDestroyed()) return;
      // Guard against stale ctx where the viewer's internal widget is gone
      // but _destroyed hasn't been set yet (race during React cleanup).
      let scene: Cesium.Scene;
      try {
        scene = viewer.scene;
        if (!scene) return;
      } catch {
        return;
      }

      // Create the billboard collection for this layer.
      billboardCollection = new cesium.BillboardCollection();
      scene.primitives.add(billboardCollection);
      _billboardCollections.set(category, billboardCollection);

      // Attach the shared fleet 3D model manager on first layer enable.
      _activeLayerCount++;
      if (_activeLayerCount === 1) {
        _fleetModelManager.attach(viewer, cesium);
      }

      // Install the shared click handler (idempotent).
      installClickHandler(viewer, cesium);

      // Lazy-load the VIPTrack DB on first flight layer enable.
      // Await so the DB is ready before the layer finishes enabling,
      // ensuring searchAll() can query VIPTrack immediately.
      await ensureVIPDBLoaded();

      // Expose getFlightInfo for FlightTrajectoryOverlay to read instant data.
      if (typeof window !== "undefined") {
        (window as unknown as { __flightsHandle?: unknown }).__flightsHandle = {
          getFlightInfo,
          getFlightPosition,
          getFlightHeading,
          getFlightVelocity,
          getFlightLastUpdate,
          searchFlights,
          searchAll,
          getNotableFlightsList,
          getVIPEntryForIcao,
          isFlightLive,
          getBracketTargets,
        };
      }

      // Initial fetch - errors propagate to the manager for display.
      await refresh(viewer, cesium);

      // Per-frame rotation updates.
      if (!preRenderRemove && !viewer.isDestroyed()) {
        try {
          preRenderRemove = viewer.scene.preRender.addEventListener(fleetTick);
        } catch {}
      }

      pollTimer = setInterval(() => {
        // Swallow polling errors so a transient failure doesn't kill
        // the interval; the next tick will retry. Initial enable()
        // failures still surface to the caller.
        refresh(viewer, cesium).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[flights:${category}] poll failed:`, err);
        });
      }, POLL_INTERVAL_MS);
    },

    disable(ctx: LayerContext): void {
      const { viewer } = ctx;

      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      if (preRenderRemove) {
        preRenderRemove();
        preRenderRemove = null;
      }

      // If the selected flight belongs to this layer, clear selection.
      if (_selectedIcao && layerBillboards.has(_selectedIcao)) {
        useGlobeStore.getState().selectFlight(null, null);
      }

      clearBillboards(viewer);
      _billboardCollections.delete(category);

      // Detach the shared fleet 3D model manager when the last layer disables.
      _activeLayerCount = Math.max(0, _activeLayerCount - 1);
      if (_activeLayerCount === 0) {
        _fleetModelManager.detach();
      }

      // Uninstall click handler only when no flight layers remain.
      if (_billboardCollections.size === 0) {
        uninstallClickHandler();
        if (typeof window !== "undefined") {
          delete (window as unknown as { __flightsHandle?: unknown }).__flightsHandle;
        }
        _viewer = null;
        _cesium = null;
      }
    },
  };
}

/** Commercial airline traffic (passenger/cargo carriers). */
export const commercialFlightsLayer: LayerImpl = createFlightsLayer(
  "commercial",
  COMMERCIAL_STYLE,
);

/** Military aircraft (tactical callsigns, air mobility, state flights). */
export const militaryFlightsLayer: LayerImpl = createFlightsLayer(
  "military",
  MILITARY_STYLE,
);

/** Private/general aviation traffic (everything else airborne). */
export const privateFlightsLayer: LayerImpl = createFlightsLayer(
  "private",
  PRIVATE_STYLE,
);
