"use client";

import { useEffect, useRef } from "react";
import type * as Cesium from "cesium";
import { useGlobeStore } from "@/store/globe-store";
import {
  getModelSpec,
  MODEL_HEADING_OFFSET_DEG,
  type AircraftClass,
} from "@/globe/layers/aircraft-class";

// FlightTrajectoryOverlay: GEV-style tracking for commercial flights.

const TRAIL_MAX_POINTS = 400;

const KIND_COLOR: Record<string, string> = {
  "flight-commercial": "#ffffff",
  "flight-private": "#ffffff",
  "flight-mil": "#FF3030",
};

const DEFAULT_CLASS_PER_KIND: Record<string, AircraftClass> = {
  "flight-commercial": "airliner",
  "flight-private": "bizjet",
  "flight-mil": "fastjet",
};

interface FlightsHandle {
  getFlightInfo?: (id: string) => {
    callsign?: string; lat?: number; lon?: number; alt?: number;
    heading?: number; velocity?: number; originCountry?: string; onGround?: boolean;
    verticalRate?: number | null; squawk?: string | null;
  } | null;
  getFlightPosition?: (id: string) => Cesium.Cartesian3 | null;
  getFlightHeading?: (id: string) => number | null;
  getFlightVelocity?: (id: string) => number | null;
  getFlightLastUpdate?: (id: string) => number;
}

function getHandle(): FlightsHandle | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __flightsHandle?: FlightsHandle }).__flightsHandle;
}

function lerpPos(
  a: Cesium.Cartesian3,
  b: Cesium.Cartesian3,
  t: number,
  result: Cesium.Cartesian3,
): Cesium.Cartesian3 {
  result.x = a.x + (b.x - a.x) * t;
  result.y = a.y + (b.y - a.y) * t;
  result.z = a.z + (b.z - a.z) * t;
  return result;
}

export default function FlightTrajectoryOverlay() {
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const selectedKind = useGlobeStore((s) => s.selectedKind);

  const trackedEntityRef = useRef<Cesium.Entity | null>(null);
  const trailEntityRef = useRef<Cesium.Entity | null>(null);
  const trailHeadEntityRef = useRef<Cesium.Entity | null>(null);
  const modelRef = useRef<Cesium.Model | null>(null);
  const modelCollectionRef = useRef<Cesium.PrimitiveCollection | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const trailPositionsRef = useRef<Cesium.Cartesian3[]>([]);
  // Saved camera controller state, restored when tracking ends.
  const savedZoomStateRef = useRef<{
    minimumZoomDistance: number;
    inertiaZoom: number;
  } | null>(null);

  // Dead-reckoning state: the last raw fix from the feed, plus heading
  // and speed to extrapolate forward between polls.
  const drRef = useRef<{
    basePos: Cesium.Cartesian3 | null;
    headingDeg: number;
    speedMps: number;
    baseTime: number;
  }>({ basePos: null, headingDeg: 0, speedMps: 0, baseTime: Date.now() });

  // The displayed position (extrapolated forward each frame, smoothly
  // corrected when a new fix arrives).
  const displayedPosRef = useRef<Cesium.Cartesian3 | null>(null);

  // Per-frame cache.
  const cachedFrameRef = useRef<number>(-1);
  const cachedPosRef = useRef<Cesium.Cartesian3 | null>(null);
  const scratchLerp = useRef<Cesium.Cartesian3 | null>(null);
  const scratchCarto = useRef<Cesium.Cartographic | null>(null);
  const scratchPos = useRef<Cesium.Cartesian3 | null>(null);

  useEffect(() => {
    const w = typeof window !== "undefined"
      ? (window as unknown as { __viewer?: Cesium.Viewer }).__viewer
      : undefined;
    const CesiumMod = typeof window !== "undefined"
      ? (window as unknown as { __Cesium?: typeof Cesium }).__Cesium
      : undefined;

    const cleanup = () => {
      if (trackedEntityRef.current && w && !w.isDestroyed()) {
        w.entities.remove(trackedEntityRef.current);
        trackedEntityRef.current = null;
      }
      if (trailEntityRef.current && w && !w.isDestroyed()) {
        w.entities.remove(trailEntityRef.current);
        trailEntityRef.current = null;
      }
      if (trailHeadEntityRef.current && w && !w.isDestroyed()) {
        w.entities.remove(trailHeadEntityRef.current);
        trailHeadEntityRef.current = null;
      }
      if (modelRef.current && modelCollectionRef.current && w && !w.isDestroyed()) {
        modelCollectionRef.current.remove(modelRef.current);
        modelRef.current = null;
      }
      if (modelCollectionRef.current && w && !w.isDestroyed()) {
        w.scene.primitives.remove(modelCollectionRef.current);
        modelCollectionRef.current = null;
      }
      if (w && !w.isDestroyed() && w.trackedEntity) {
        w.trackedEntity = undefined;
      }
      // Restore camera controller zoom limits + inertia.
      if (w && !w.isDestroyed() && savedZoomStateRef.current) {
        const ctrl = w.scene.screenSpaceCameraController;
        if (ctrl && !ctrl.isDestroyed()) {
          ctrl.minimumZoomDistance = savedZoomStateRef.current.minimumZoomDistance;
          ctrl.inertiaZoom = savedZoomStateRef.current.inertiaZoom;
        }
        savedZoomStateRef.current = null;
      }
    };

    cleanup();
    abortRef.current?.abort();
    abortRef.current = null;
    trailPositionsRef.current = [];
    cachedFrameRef.current = -1;
    cachedPosRef.current = null;
    displayedPosRef.current = null;
    drRef.current = { basePos: null, headingDeg: 0, speedMps: 0, baseTime: Date.now() };

    if (!selectedFlightId || !selectedKind || !w || !CesiumMod || w.isDestroyed()) {
      useGlobeStore.getState().setTrajectoryData(null);
      useGlobeStore.getState().setTrajectoryLoading(false);
      useGlobeStore.getState().setTrajectoryError(null);
      return;
    }

    if (!scratchLerp.current) scratchLerp.current = new CesiumMod.Cartesian3();
    if (!scratchCarto.current) scratchCarto.current = new CesiumMod.Cartographic();
    if (!scratchPos.current) scratchPos.current = new CesiumMod.Cartesian3();

    const handle = getHandle();
    const info = handle?.getFlightInfo?.(selectedFlightId) ?? null;
    const livePos = handle?.getFlightPosition?.(selectedFlightId) ?? null;
    const liveHeading = handle?.getFlightHeading?.(selectedFlightId) ?? null;
    const liveVel = handle?.getFlightVelocity?.(selectedFlightId) ?? null;

    // Initialize dead-reckoning + displayed position.
    if (livePos) {
      drRef.current = {
        basePos: CesiumMod.Cartesian3.clone(livePos),
        headingDeg: liveHeading ?? 0,
        speedMps: liveVel ?? 0,
        baseTime: Date.now(),
      };
      displayedPosRef.current = CesiumMod.Cartesian3.clone(livePos);
      trailPositionsRef.current = [CesiumMod.Cartesian3.clone(livePos)];
    }

    // Set instant data for the detail panel.
    if (info) {
      useGlobeStore.getState().setTrajectoryData({
        callsign: info.callsign ?? null,
        trajectory: [{
          time: Math.floor(Date.now() / 1000),
          lat: info.lat ?? 0,
          lon: info.lon ?? 0,
          alt: info.alt ?? null,
        }],
        origin: null,
        destination: null,
        heading: info.heading ?? null,
        velocity: info.velocity ?? null,
        originCountry: info.originCountry ?? null,
        onGround: info.onGround ?? false,
        verticalRate: info.verticalRate ?? null,
        squawk: info.squawk ?? null,
        sourceUrl: `https://www.flightaware.com/live/flight/${encodeURIComponent((info.callsign ?? selectedFlightId).toUpperCase())}`,
        fetchedAt: Date.now(),
      });
    } else {
      useGlobeStore.getState().setTrajectoryData(null);
    }
    useGlobeStore.getState().setTrajectoryLoading(true);
    useGlobeStore.getState().setTrajectoryError(null);

    const trailColor = CesiumMod.Color.fromCssColorString(
      KIND_COLOR[selectedKind] ?? "#ffffff",
    );

    // --- Dead-reckoning position computation (cached per frame) ---
    // Each frame: extrapolate forward from the last fix using heading +
    // speed. When a new fix arrives from the feed, smoothly blend the
    // displayed position toward the new fix (avoids snap-back).
    const computeDisplayPosition = (): Cesium.Cartesian3 | null => {
      const frame = (w.scene as unknown as { frameState?: { frameNumber?: number } }).frameState?.frameNumber ?? -1;
      if (frame === cachedFrameRef.current && cachedPosRef.current) {
        return cachedPosRef.current;
      }
      cachedFrameRef.current = frame;

      const h = getHandle();
      const newTarget = h?.getFlightPosition?.(selectedFlightId) ?? null;
      const newHeading = h?.getFlightHeading?.(selectedFlightId) ?? null;
      const newVel = h?.getFlightVelocity?.(selectedFlightId) ?? null;

      const dr = drRef.current;

      // Check if the feed gave us a new fix (position changed).
      if (newTarget && dr.basePos &&
          CesiumMod.Cartesian3.distanceSquared(newTarget, dr.basePos) > 1) {
        // New fix arrived. Update dead-reckoning base.
        // Append to trail.
        const trail = trailPositionsRef.current;
        const last = trail[trail.length - 1];
        if (!last || CesiumMod.Cartesian3.distanceSquared(last, newTarget) > 1) {
          trail.push(CesiumMod.Cartesian3.clone(newTarget));
          if (trail.length > TRAIL_MAX_POINTS) trail.shift();
        }
        drRef.current = {
          basePos: CesiumMod.Cartesian3.clone(newTarget),
          headingDeg: newHeading ?? dr.headingDeg,
          speedMps: newVel ?? dr.speedMps,
          baseTime: Date.now(),
        };
      }

      const dr2 = drRef.current;
      if (!dr2.basePos || !displayedPosRef.current) {
        cachedPosRef.current = null;
        return null;
      }

      // Extrapolate forward from base using heading + speed.
      const elapsedSec = (Date.now() - dr2.baseTime) / 1000;
      if (dr2.speedMps > 1 && elapsedSec > 0) {
        const carto = scratchCarto.current!;
        CesiumMod.Cartographic.fromCartesian(dr2.basePos, CesiumMod.Ellipsoid.WGS84, carto);
        const headingRad = CesiumMod.Math.toRadians(dr2.headingDeg);
        const distM = dr2.speedMps * elapsedSec;
        const cosLat = Math.max(Math.cos(carto.latitude), 0.01);
        const dLat = (distM * Math.cos(headingRad)) / 6378137;
        const dLon = (distM * Math.sin(headingRad)) / (6378137 * cosLat);
        carto.latitude = carto.latitude + dLat;
        carto.longitude = carto.longitude + dLon;
        const extrapolated = CesiumMod.Cartographic.toCartesian(
          carto, CesiumMod.Ellipsoid.WGS84, scratchPos.current!,
        );

        // Smoothly blend displayed position toward the extrapolated position.
        // This absorbs any drift when a new fix resets the base.
        lerpPos(displayedPosRef.current, extrapolated, 0.15, displayedPosRef.current);
      }

      cachedPosRef.current = displayedPosRef.current;
      return displayedPosRef.current;
    };

    // --- 1. Tracked point entity (for camera framing) ---
    const positionCallback = new CesiumMod.CallbackProperty(() => {
      return computeDisplayPosition() ?? CesiumMod.Cartesian3.ZERO;
    }, false);

    const trackedEntity = w.entities.add({
      position: positionCallback as unknown as Cesium.PositionProperty,
      trackingReferenceFrame: CesiumMod.TrackingReferenceFrame.ENU,
      point: {
        pixelSize: 0,
        color: CesiumMod.Color.TRANSPARENT,
        show: true,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    trackedEntityRef.current = trackedEntity;

    // Close follow offset: 500m behind, 300m above. User can scroll-zoom
    // closer (down to 150m floor) or farther out freely. Matches GEV feel.
    const FOLLOW_BEHIND_M = 500;
    const FOLLOW_ABOVE_M = 300;
    trackedEntity.viewFrom = new CesiumMod.Cartesian3(
      0, -FOLLOW_BEHIND_M, FOLLOW_ABOVE_M,
    ) as unknown as Cesium.PositionProperty;

    // Clamp the camera controller so the user can zoom in to 150m but no
    // closer (prevents clipping through the model). Also kill zoom inertia
    // for deterministic control while tracking. Both are restored on cleanup.
    const ctrl = w.scene.screenSpaceCameraController;
    if (ctrl && !ctrl.isDestroyed()) {
      if (!savedZoomStateRef.current) {
        savedZoomStateRef.current = {
          minimumZoomDistance: ctrl.minimumZoomDistance,
          inertiaZoom: ctrl.inertiaZoom,
        };
      }
      ctrl.minimumZoomDistance = 150; // GEV MIN_TRACKED_RANGE_M
      ctrl.inertiaZoom = 0;
    }

    w.camera.cancelFlight();
    w.trackedEntity = trackedEntity;

    // --- 2. Standalone 3D model ---
    const TRACKED_MODEL_MIN_PX = 80;
    const TRACKED_MODEL_MAX_PX = 400;
    const klass = DEFAULT_CLASS_PER_KIND[selectedKind] ?? "airliner";
    const modelSpec = getModelSpec(klass);
    const modelColor = CesiumMod.Color.fromCssColorString(
      KIND_COLOR[selectedKind] ?? "#ffffff",
    );

    const modelCollection = new CesiumMod.PrimitiveCollection();
    w.scene.primitives.add(modelCollection);
    modelCollectionRef.current = modelCollection;

    const trackedModelScaleForPixelCap = (params: {
      baseScale: number; nativeRadiusM: number; rangeM: number;
      viewportHeightPx: number; fovyRad: number; maximumPixelSize: number;
    }): number => {
      const { baseScale, nativeRadiusM, rangeM, viewportHeightPx, fovyRad, maximumPixelSize } = params;
      if (!Number.isFinite(baseScale) || baseScale <= 0
        || !Number.isFinite(nativeRadiusM) || nativeRadiusM <= 0
        || !Number.isFinite(rangeM) || rangeM <= 0
        || !Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0
        || !Number.isFinite(fovyRad) || fovyRad <= 0
        || !Number.isFinite(maximumPixelSize) || maximumPixelSize <= 0
      ) return baseScale;
      const focalLengthPx = viewportHeightPx / (2 * Math.tan(fovyRad / 2));
      const projectedDiameterPx = (2 * nativeRadiusM * baseScale * focalLengthPx) / rangeM;
      if (projectedDiameterPx <= maximumPixelSize) return baseScale;
      return baseScale * (maximumPixelSize / projectedDiameterPx);
    };

    CesiumMod.Model.fromGltfAsync({
      url: modelSpec.url,
      asynchronous: false,
      minimumPixelSize: TRACKED_MODEL_MIN_PX,
      scale: modelSpec.scale,
      color: modelColor,
      colorBlendMode: CesiumMod.ColorBlendMode.MIX,
      colorBlendAmount: 0.94,
    }).then((m: Cesium.Model) => {
      if (w.isDestroyed() || !modelCollectionRef.current) return;
      modelCollectionRef.current.add(m);
      modelRef.current = m;
      m.show = true;
    }).catch(() => {});

    const preRenderRemove = w.scene.preRender.addEventListener(() => {
      if (w.isDestroyed() || !modelRef.current) return;
      const pos = computeDisplayPosition();
      if (!pos) return;
      const h = getHandle();
      let headingDeg = h?.getFlightHeading?.(selectedFlightId) ?? null;
      if (headingDeg == null) headingDeg = drRef.current.headingDeg;
      headingDeg += MODEL_HEADING_OFFSET_DEG;
      const hpr = new CesiumMod.HeadingPitchRoll(
        CesiumMod.Math.toRadians(headingDeg), 0, 0,
      );
      const enu = CesiumMod.Transforms.eastNorthUpToFixedFrame(
        pos, CesiumMod.Ellipsoid.WGS84,
      );
      const rangeM = CesiumMod.Cartesian3.distance(w.camera.positionWC, pos);
      const scale = trackedModelScaleForPixelCap({
        baseScale: modelSpec.scale,
        nativeRadiusM: modelSpec.radiusM,
        rangeM,
        viewportHeightPx: w.scene.canvas.clientHeight,
        fovyRad: (w.camera.frustum as Cesium.PerspectiveFrustum).fovy ?? 1.0,
        maximumPixelSize: TRACKED_MODEL_MAX_PX,
      });
      modelRef.current.scale = scale;
      const trs = new CesiumMod.TranslationRotationScale(
        new CesiumMod.Cartesian3(0, 0, 0),
        CesiumMod.Quaternion.fromHeadingPitchRoll(hpr),
        new CesiumMod.Cartesian3(scale, scale, scale),
      );
      modelRef.current.modelMatrix = CesiumMod.Matrix4.multiply(
        enu,
        CesiumMod.Matrix4.fromTranslationRotationScale(trs, new CesiumMod.Matrix4()),
        new CesiumMod.Matrix4(),
      );
    });

    // --- 3. Trail entity (dashed glow material) ---
    // Uses PolylineDashMaterialProperty for a split/dashed line look.
    const trailEntity = w.entities.add({
      polyline: {
        positions: new CesiumMod.CallbackProperty(() => {
          const trail = trailPositionsRef.current;
          return trail.length > 1 ? trail.slice() : [];
        }, false),
        width: 2,
        material: new CesiumMod.PolylineDashMaterialProperty({
          color: trailColor.withAlpha(0.7),
          dashLength: 16,
          dashPattern: 255,
        }),
        depthFailMaterial: new CesiumMod.PolylineDashMaterialProperty({
          color: trailColor.withAlpha(0.3),
          dashLength: 16,
          dashPattern: 255,
        }),
        arcType: CesiumMod.ArcType.GEODESIC,
      },
    });
    trailEntityRef.current = trailEntity;

    // --- 4. Trail head segment (last trail point to behind the plane) ---
    const trailHeadEntity = w.entities.add({
      polyline: {
        positions: new CesiumMod.CallbackProperty(() => {
          const trail = trailPositionsRef.current;
          if (trail.length < 1) return [];
          const head = computeDisplayPosition();
          if (!head) return [];
          const start = trail[trail.length - 1];
          // Fixed gap behind the plane so the dashed line doesn't overlap
          // the model. Using a fixed distance (not proportional) prevents
          // the gap from growing as dead-reckoning extrapolates forward.
          const GAP_METERS = 500;
          const dist = CesiumMod.Cartesian3.distance(start, head);
          if (dist < GAP_METERS + 10) return [];
          const t = 1 - GAP_METERS / dist;
          const behindPos = lerpPos(start, head, t, scratchLerp.current!);
          return [start, CesiumMod.Cartesian3.clone(behindPos)];
        }, false),
        width: 2,
        material: new CesiumMod.PolylineDashMaterialProperty({
          color: trailColor.withAlpha(0.7),
          dashLength: 16,
          dashPattern: 255,
        }),
        depthFailMaterial: new CesiumMod.PolylineDashMaterialProperty({
          color: trailColor.withAlpha(0.3),
          dashLength: 16,
          dashPattern: 255,
        }),
        arcType: CesiumMod.ArcType.GEODESIC,
      },
    });
    trailHeadEntityRef.current = trailHeadEntity;

    // --- 5. Fetch trajectory for detail panel + trail backfill ---
    const ac = new AbortController();
    abortRef.current = ac;
    const url = `/api/flights/track?icao24=${encodeURIComponent(selectedFlightId)}`;

    fetch(url, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(30_000)]) })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`${res.status} ${text || res.statusText}`);
        }
        return res.json();
      })
      .then((json: any) => {
        if (ac.signal.aborted) return;
        const prev = useGlobeStore.getState().trajectoryData;
        useGlobeStore.getState().setTrajectoryData({
          ...json,
          heading: json.heading ?? prev?.heading ?? null,
          velocity: json.velocity ?? prev?.velocity ?? null,
          originCountry: json.originCountry ?? prev?.originCountry ?? null,
          onGround: json.onGround ?? prev?.onGround ?? false,
          verticalRate: prev?.verticalRate ?? null,
          squawk: prev?.squawk ?? null,
          // If the track API didn't resolve a callsign but we have one from
          // the live registry, keep it and fix the source URL accordingly.
          callsign: json.callsign || prev?.callsign || null,
          sourceUrl: json.callsign
            ? json.sourceUrl
            : prev?.sourceUrl ?? json.sourceUrl,
        });
        useGlobeStore.getState().setTrajectoryLoading(false);

        // Backfill trail with historical waypoints (past only, sorted).
        const traj = json.trajectory as Array<{ time: number; lat: number; lon: number; alt: number | null }> | undefined;
        if (traj && traj.length > 0 && !ac.signal.aborted) {
          const nowSec = Math.floor(Date.now() / 1000);
          const pastPoints = traj
            .filter((p) => p.time <= nowSec)
            .sort((a, b) => a.time - b.time);

          if (pastPoints.length > 0) {
            // Forward-fill missing/zero altitudes from the nearest valid
            // point. Without this, a null-altitude waypoint drops to 50m
            // while the next point sits at cruising altitude, producing a
            // near-vertical segment at the start of the trail.
            let fillAlt = 0;
            for (let i = pastPoints.length - 1; i >= 0; i--) {
              const a = pastPoints[i].alt;
              if (typeof a === "number" && a > 0) {
                fillAlt = a;
                break;
              }
            }
            if (fillAlt === 0) fillAlt = info?.alt ?? 1000;

            const historyPositions = pastPoints.map((p) => {
              const a = typeof p.alt === "number" && p.alt > 0 ? p.alt : fillAlt;
              return CesiumMod.Cartesian3.fromDegrees(p.lon, p.lat, a);
            });
            const merged = [...historyPositions];
            for (const livePos of trailPositionsRef.current) {
              const last = merged[merged.length - 1];
              if (!last || CesiumMod.Cartesian3.distanceSquared(last, livePos) > 100) {
                merged.push(livePos);
              }
            }
            while (merged.length > TRAIL_MAX_POINTS) merged.shift();
            trailPositionsRef.current = merged;
            w.scene.requestRender();
          }
        }
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "fetch failed";
        useGlobeStore.getState().setTrajectoryError(msg);
        useGlobeStore.getState().setTrajectoryLoading(false);
      });

    w.scene.requestRender();

    return () => {
      ac.abort();
      preRenderRemove();
      cleanup();
      if (w && !w.isDestroyed()) w.scene.requestRender();
    };
  }, [selectedFlightId, selectedKind]);

  return null;
}
