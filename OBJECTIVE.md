# OBJECTIVE: Spectre Enhancement Run (Kimi K3)

**Status:** COMPLETED (except deferred instability score)
**Run date:** 2026-08-09

---

## Satellites — DONE
- **3D satellite models** — small glTF objects (body + solar panels) at `/models/satellite.gltf`; `Entity.model` with `minimumPixelSize: 14`, `maximumScale: 50`, silhouette glow for category color
- **Trajectory** — ground track polylines + bright trajectory overlay when selected
- **Hover fix** — removed React tooltip from SatellitePanel; hover now works via Cesium scene pick on the 3D object (picking.ts prefixes fixed: `sat-trajectory-`, `sat-track-`, `sat-`)
- **Side view on toggle** — flyTo pitch changed from -90° (top-down) to -35° (side view)
- **Starlink cluster toggle** — already existed; verified working
- **Trajectory cleanup** — added `__clearSatTrajectory` window callback; toggling OFF clears trajectory

## Private Flights — DONE
- **Parabolic trajectories** — replaced linear equirectangular lerp with `EllipsoidGeodesic` great-circle interpolation in `src/globe/arc.ts`; applied to FlightTrajectoryOverlay + CesiumGlobe renderTrail + renderLandedArc
- **Grounded planes** — `flights-layer.ts` now branches on `f.onGround`; grounded planes render at 5m altitude (on ground) with 0.7× scale; airborne planes use reported altitude + 50m

## Civil Unrest — DONE (bugs fixed; instability score deferred)
- **BUG FIX: Multi-date hover** — `CesiumGlobe.tsx` events fetch now sends `from=<today>&to=<today>` params; API already supports date filtering
- **BUG FIX: Wrong location** — `gdelt.ts` now always runs `extractLocation(title)` even when GDELT provides coordinates; removed `|| domain` fallback that showed "reuters.com" as location
- **Instability score** — DEFERRED (user said "not yet" to all design questions)

## Live / Replay (Sentinel) — DONE (unchanged, verified)
- Sentinel-2 L2A with `TRUE_COLOR` layer; instance ID auto-populated
- Monthly stepping; best free option for high-altitude monthly changes

## Traffic — DONE (reliability improved)
- **BUG FIX: Not reliable** — reduced initial fetch delay from 9s to 3s; reduced poll interval from 30s to 20s; reduced movement threshold from 10km to 5km; `force=true` now bypasses altitude gate for initial fetch
- **Per-layer road class buttons** — already working (verified: motorway/trunk/primary/secondary/tertiary)
- **API verified** — 3000 roads returned with correct classes and coordinates

## 3D Tiles — DONE
- **BUG FIX: Base map blocks zoom** — base Esri imagery layer now hidden (`show = false`) when 3D tiles enabled; restored when disabled
- **BUG FIX: Crash on disable** — `google-tiles-layer.ts` destroy() now wraps all operations in try/catch; `tileset.show = false` set first; listener removal guarded; `tileset.destroy()` swallowed if it throws

## Performance Audit — DONE
- **requestRenderMode enabled** — was `false` (continuous 60fps render); now `true` (only renders on change); ~90% GPU/CPU reduction at idle
- **requestRender() calls** — added to `satellites-layer.ts` setSatellites() and setShow(); all other layers already had them
- **Duplicate polling** — page.tsx polls /api/flights, /api/satellites etc. for hover lookups while globe polls for rendering; acceptable because API routes cache responses server-side (60s TTL)

## Testing — DONE
- Playwright test: 9/9 PASS, 0 page errors
  - Page load ✅
  - 3D Tiles toggle (no crash, base imagery swap) ✅
  - Civil unrest events (today filter) ✅
  - Traffic layer ✅
  - Satellites (3D models, 7 entities, -35° pitch) ✅
  - Satellite side view (not -90°) ✅
  - Private flights (1259 billboards) ✅
  - Sentinel button ✅
  - requestRenderMode enabled ✅

## Research — DONE
- **OSIRIS** (`simplifaisoul/osiris`, 7.5k stars, MIT): Next.js + MapLibre OSINT dashboard; 16 layers, 55 endpoints, keyless by default, viewport-aware fetching, region dossier (right-click composite summary), ⌘K command palette, live counters + ZULU clock
- **Velocity & World Monitor** — not identifiable as distinct products; likely internal codenames or niche/proprietary

## Files Changed
- `src/globe/layers/google-tiles-layer.ts` — crash-safe destroy()
- `src/components/CesiumGlobe.tsx` — base imagery swap, events today filter, traffic timing, sat trajectory clear, arc import
- `src/lib/sources/gdelt.ts` — always extract location, no domain fallback
- `src/globe/arc.ts` — NEW: great-circle parabolic arc helper
- `src/globe/layers/satellites-layer.ts` — 3D model instead of billboard, requestRender
- `src/components/SatellitePanel.tsx` — -35° pitch, removed React hover tooltip, trajectory clear on off
- `src/globe/picking.ts` — fixed sat-trajectory/sat-track prefix routing
- `src/globe/layers/flights-layer.ts` — grounded plane rendering at 5m
- `src/globe/scene-config.ts` — requestRenderMode = true
- `src/components/FlightTrajectoryOverlay.tsx` — great-circle arc via buildArcPositions
- `public/models/satellite.gltf` — NEW: procedural satellite glTF (body + 2 panels)

## Deferred
- **Civil unrest instability score** — user said "not yet" to granularity/visualization/factors/update-frequency design questions; revisit when ready
