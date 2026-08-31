# Spectre V2 Feature Reference

Every user-facing control in Spectre V2, what it does, and how it is implemented. Organized by UI region.

---

## Left Sidebar (TacticalHUD)

`src/components/TacticalHUD.tsx`

A 240px fixed sidebar on the left edge. Contains the SPECTRE logo, a search button, and five collapsible layer groups. Each layer toggle calls `useGlobeStore.toggleLayer(id)`, which sets the layer to loading, sets `activeRightPanel` to that layer (so the right panel shows its complement), and the `LayerManager` calls `setLayerVisible` when the layer's `enable()` completes.

### Search Location button

- **What it does:** Opens the Search Modal overlay for jumping to a city or coordinate.
- **How:** Calls `setSearchOpen(true)`. The `SearchModal` component (`src/components/SearchModal.tsx`) renders a fuzzy city search over `CITY_COORDS` and flies the camera to the selected city.

### Layer groups

Each group is a collapsible section. Clicking the group header toggles its visibility. The header text glows accent-white when any layer in the group is active.

#### AVIATION (open by default)

| Toggle | Layer ID | What it does | Implementation |
|--------|----------|-------------|----------------|
| Commercial Flights | `commercial-flights` | Live commercial aircraft from OpenSky, dead-reckoned between polls, rendered as billboards at altitude and 3D models when zoomed in. | `src/globe/layers/flights.ts` (commercialFlightsLayer), API: `src/app/api/opensky/route.ts` |
| Private Flights | `private-flights` | OpenSky private aircraft cross-referenced with a notable-people registry (VIP tracking). Aircraft classification, registration lookup. | `src/globe/layers/flights.ts` (privateFlightsLayer), `src/lib/viptrack-db.ts`, `public/data/viptrack.json` |
| Military Flights | `military-flights` | Military aircraft from adsb.lol with solo/focus mode, trajectory overlay, aircraft type classification. | `src/globe/layers/flights.ts` (militaryFlightsLayer), API: `src/app/api/adsblol/mil/route.ts` |
| Satellites | `satellites` | CelesTrak TLE propagation via satellite.js SGP4. ~840 satellites across 6 groups. 3D satellite models, ground tracks, orbit rings, Starlink cluster mode, click-to-track. | `src/globe/layers/satellites.ts`, API: `src/app/api/celestrak/route.ts` |

#### INFRASTRUCTURE

| Toggle | Layer ID | What it does | Implementation |
|--------|----------|-------------|----------------|
| Dams | `dams` | USACE dam locations as ground-clamped point markers. Click to track and inspect. | `src/globe/layers/local-infrastructure.ts` (damsLayer), `public/data/dams.geojsonl` |
| Earthquakes | `earthquakes` | USGS GeoJSON feed (60s polling). Depth-colored ground-clamped circles, floating magnitude labels. | `src/globe/layers/geo-layers.ts` (earthquakesLayer), API: `src/app/api/usgs/route.ts` |
| Data Centers | `data-centers` | Datacenter locations as GeoJSON point markers. Click to track and inspect. | `src/globe/layers/local-infrastructure.ts` (dataCentersLayer), `public/data/datacenters.geojsonl` |

#### INTEL (open by default)

| Toggle | Layer ID | What it does | Implementation |
|--------|----------|-------------|----------------|
| Civil Unrest | `civil-unrest` | Multi-source event aggregation (GDELT, RSS, ACLED, CIVICUS, Mastodon, Reddit, Telegram, YouTube, ReliefWeb, UCDP). Event clustering, verification levels, instability scoring, country/province grouping. | `src/globe/layers/geo-layers.ts` (civilUnrestLayer), `src/lib/unrest-pipeline.ts`, `src/lib/sources/*`, API: `src/app/api/events/route.ts`, `src/app/api/gdelt/route.ts` |
| Radio | `radio` | Internet radio directory (Radio Browser). Up to 750 station markers with country/category clustering. Click to play. Analog tuner with needle that flies camera to broadcaster. | `src/globe/radio/`, API: `src/app/api/radio/stations/route.ts` |

#### GROUND (open by default)

| Toggle | Layer ID | What it does | Implementation |
|--------|----------|-------------|----------------|
| Traffic | `traffic` | TomTom flow tiles + Overpass road data. Animated vehicle dots, congestion recoloring, road class visibility, camera-altitude gating. | `src/globe/layers/traffic/`, API: `src/app/api/tomtom/flow/[z]/[x]/[y]/route.ts`, `src/app/api/overpass/route.ts` |
| CCTV Mesh | `cctv` | Multi-source camera aggregation (Windy, Shodan, 511, LTA, TfNSW, OSM, etc.). POV pyramids, camera calibration, road snapping, snapshot API. Per-source filtering from the right panel. | `src/globe/layers/cctv.ts`, `src/lib/sources/cctv.ts`, API: `src/app/api/cctv/route.ts`, `src/app/api/cctv/frame/[id]/route.ts` |
| 3D Buildings | `3d-buildings` | OSM Buildings (Cesium Ion asset 96188) + optional Google Photorealistic 3D Tiles. Building picking, hover popups. | `src/globe/layers/buildings.ts`, `src/globe/building-highlight.ts` |
| Building Highlights | (not a LayerId) | Gates a white hover tint + click-to-panel on the existing OSM Buildings tileset. Requires 3D Buildings to be visible first; toggling it on without 3D Buildings shows a toast. | `src/components/TacticalHUD.tsx` (BuildingHighlightButton), `src/globe/building-highlight.ts` |

#### IMAGERY (open by default)

| Toggle | Layer ID | What it does | Implementation |
|--------|----------|-------------|----------------|
| Big Changes | `big-changes-replay` | Sentinel-2 WMS (Copernicus) time-series. Scrub through 5 years of imagery to see large-scale terrain changes. | `src/globe/layers/replay-gibs.ts` (bigChangesReplayLayer) |
| Construction | `construction-replay` | NASA GIBS WMTS (MODIS Terra true color) time-series. Scrub through 5 years of imagery. | `src/globe/layers/replay-gibs.ts` (constructionReplayLayer) |

Both replay layers share the Replay Timeline (see below).

---

## Right Panel (RightPanel)

`src/components/RightPanel.tsx`

A fixed panel on the right edge. Its content depends on `activeRightPanel` (which layer is active) and which tracker is set (flight, satellite, feature, camera, building, region). The panel philosophy: whatever you toggle on the left, the right panel becomes its complement.

### Default mode (no layer active)

Shows a location browser: Continents expand into Countries, Countries expand into Cities. Clicking any location flies the camera there and sets `activeLocation`. The bottom of the panel has four action buttons:

| Button | What it does | Implementation |
|--------|-------------|----------------|
| SAVE | Saves the current camera position (lat/lon/height/heading/pitch) for the active location to localStorage. Requires a location to be selected first. | `saveCurrentView()` in globe-store, persisted under `spectre-v2:savedViews` |
| FULL | Toggles browser fullscreen mode. | `toggleFullscreen()` in globe-store |
| 3D TILES | Toggles Google Photorealistic 3D Tiles on the 3D Buildings layer. Active state shown by accent glow. | `toggleGoogleTiles()` in globe-store, `googleTilesLayer` in `src/globe/layers/actions.ts` |
| BORDERS | Toggles country/state GeoJSON borders with camera-height switching. Enables region hover popups and click-to-inspect. | `toggleBorders()` in globe-store, `bordersLayer` in `src/globe/layers/actions.ts`, `src/globe/region-index.ts` |

### Per-layer content

When a layer is active, the right panel shows layer-specific content:

- **Commercial/Private/Military Flights:** Flight list or selected flight telemetry (callsign, altitude, velocity, origin/destination, aircraft type, trajectory). Handled by `FlightDetailPanel.tsx`.
- **Satellites:** Satellite picker (search box + famous satellites list) when nothing is tracked, or satellite detail card when tracking. Handled by `SatelliteDetailPanel.tsx` and `SatellitePicker` in RightPanel.
- **Dams/Data Centers:** Feature list + detail. `FeatureDetailPanel.tsx`.
- **Earthquakes:** Earthquake list + detail. `EarthquakeOverlay.tsx`, `FeatureDetailPanel.tsx`.
- **Civil Unrest:** Event list with country grouping, verification levels, instability scores. `CivilUnrestOverlay.tsx`.
- **CCTV:** Per-source filter list (toggle individual camera providers). `CctvSourceList.tsx`, `CctvDetailPanel.tsx`.
- **Radio:** Radio panel with category filters, station list, mini-player. `src/components/radio/RadioPanel.tsx`.
- **Replay layers:** The timeline appears at the bottom of the screen (see below).

---

## Replay Timeline

`src/components/ReplayTimeline.tsx`

Appears at the bottom of the screen when a replay layer (Big Changes or Construction) is active. Controls:

| Control | What it does |
|---------|-------------|
| `<<` | Jump back 1 month |
| `<` | Jump back 1 week |
| PLAY/PAUSE | Toggle auto-playback (advances 1 day per second by default) |
| `>` | Jump forward 1 week |
| `>>` | Jump forward 1 month |
| Scrubber slider | Drag to any date in the 5-year range |
| Speed selector | Change playback speed (days per second) |
| Loading spinner | Shown while GIBS tiles are fetching |
| CLOSE | Disables the active replay layer |

---

## Keyboard Controls

`src/globe/controls/keyboard.ts`

Active when focus is not in an input/textarea. Each movement key computes in the local ENU frame at the camera position.

| Key | Action |
|-----|--------|
| W | Move north |
| S | Move south |
| A | Move west |
| D | Move east |
| Q | Spin Earth left (orbit camera west) |
| E | Spin Earth right (orbit camera east) |
| Space | Move up (Z+) |
| Shift (alone) | Move down (Z-) |
| Shift + WASD | 3x speed boost |
| Arrow Up | Tilt camera up |
| Arrow Down | Tilt camera down |
| Arrow Left | Rotate camera left (heading) |
| Arrow Right | Rotate camera right (heading) |
| + / = | Zoom in |
| - / _ | Zoom out |
| 0 | Reset to default view (Jakarta, 30km) |
| 1 | Theater preset: Jakarta |
| 2 | Theater preset: Surabaya |
| 3 | Theater preset: Medan |
| 4 | Theater preset: Bali |
| 5 | Theater preset: Papua |

---

## Click Interactions

All click handlers are in `src/globe/controls/click.ts` and `src/globe/controls/click-region.ts`. Trackers are mutually exclusive: selecting one clears the others so only one detail panel owns the right rail at a time.

| Click target | What happens | Detail panel |
|-------------|-------------|--------------|
| Commercial/Private/Military flight | Selects the flight, fetches trajectory, renders 3D model + trail, camera follows | `FlightDetailPanel.tsx` |
| Satellite | Tracks the satellite, renders 3D model + orbit ring, camera follows | `SatelliteDetailPanel.tsx` |
| Dam / Data Center | Tracks the feature, flies camera to it | `FeatureDetailPanel.tsx` |
| Earthquake | Tracks the earthquake, flies camera to it | `FeatureDetailPanel.tsx` |
| CCTV camera | Tracks the camera, shows snapshot/live feed | `CctvDetailPanel.tsx` |
| 3D Building (with Building Highlights on) | Shows OSM tags for the picked building | `FeatureDetailPanel.tsx` |
| Country/State (with Borders on) | Highlights the region polygon, shows World Bank indicators | `RegionDetailPanel.tsx` |
| Empty space | Clears all trackers and selections | - |

**Escape key** clears the current selection (flight, satellite, feature, camera, building, or region).

---

## Overlays (always present)

| Overlay | File | What it shows |
|---------|------|---------------|
| CircleMask | `src/components/CircleMask.tsx` | Vignette mask around the globe edge |
| CoordinatesPanel | `src/components/CoordinatesPanel.tsx` | Live camera lat/lon/altitude readout |
| LocationPanel | `src/components/LocationPanel.tsx` | Current active location name (continent/country/city) |
| TargetingBracket | `src/components/TargetingBracket.tsx` | Corner brackets that frame a tracked target |
| Toast | `src/components/Toast.tsx` | Transient notification messages (2.5s auto-dismiss) |
| RegionPopup | `src/components/RegionPopup.tsx` | Country/state hover popup under cursor (when Borders on) |
| LocalTime | `src/components/LocalTime.tsx` | Local time display for the hovered/selected region |

---

## State Management

All UI state flows through a single Zustand store: `src/store/globe-store.ts`. This includes:

- Layer visibility, loading, and error states
- Right panel mode (`activeRightPanel`)
- Camera coordinates and altitude
- All trackers (flight, satellite, feature, camera, building, region) with mutual exclusion
- Replay timeline state (date, playing, speed, range)
- CCTV catalog and per-source filtering
- Saved views (persisted to localStorage)
- Search modal open/close
- Toast notifications
- Borders, 3D Tiles, Building Highlights, fullscreen toggles

The store is the single source of truth. Components read slices via `useGlobeStore((s) => s.someField)` and mutate via the store actions.
