// Keyboard controls for the globe.
// WASD = horizontal movement in the local ENU frame (north/south/east/west).
// Z axis (vertical) = Space (up) / Shift (down).
// Arrow keys = camera tilt/heading. Shift + WASD = 3x speed boost.

import * as Cesium from "cesium";

const THEATER_PRESETS: { key: string; lon: number; lat: number; height: number }[] = [
  { key: "1", lon: 106.8272, lat: -6.1754, height: 30_000 },
  { key: "2", lon: 112.7521, lat: -7.2575, height: 30_000 },
  { key: "3", lon: 98.6722, lat: 3.5952, height: 30_000 },
  { key: "4", lon: 119.4327, lat: -5.1477, height: 30_000 },
  { key: "5", lon: 140.669, lat: -2.5916, height: 50_000 },
];

// Track which keys are currently pressed for shift+WASD combo detection
const pressedKeys = new Set<string>();

// Scratch variables to avoid GC pressure in hot key-repeat paths
const _scratchLocalFrame = new Cesium.Matrix4();
const _scratchEast = new Cesium.Cartesian3();
const _scratchNorth = new Cesium.Cartesian3();
const _scratchUp = new Cesium.Cartesian3();
const _scratchCol = new Cesium.Cartesian4();

export function attachKeyboardControls(viewer: Cesium.Viewer): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

    const key = e.key.toLowerCase();
    pressedKeys.add(key);

    const cam = viewer.camera;
    const height = viewer.camera.positionCartographic.height;
    const baseDistance = Math.max(50, height * 0.1);
    const shiftHeld = pressedKeys.has("shift");
    const wasdPressed = pressedKeys.has("w") || pressedKeys.has("a") || pressedKeys.has("s") || pressedKeys.has("d");
    const speedMultiplier = shiftHeld && wasdPressed ? 3 : 1;
    const moveDistance = baseDistance * speedMultiplier;
    const verticalDistance = baseDistance;
    const pitchDelta = 0.1;
    const headingDelta = 0.15;
    const spinDeltaDeg = 8.6; // Q/E spin step in degrees (~0.15 rad)

    // Compute local ENU frame at the camera position once per keypress.
    // W/S = north/south, A/D = west/east. This is axis-aligned and
    // predictable regardless of camera heading or tracking state.
    Cesium.Transforms.eastNorthUpToFixedFrame(
      cam.position,
      viewer.scene.globe.ellipsoid,
      _scratchLocalFrame,
    );
    Cesium.Matrix4.getColumn(_scratchLocalFrame, 0, _scratchCol); // east
    _scratchEast.x = _scratchCol.x; _scratchEast.y = _scratchCol.y; _scratchEast.z = _scratchCol.z;
    Cesium.Matrix4.getColumn(_scratchLocalFrame, 1, _scratchCol); // north
    _scratchNorth.x = _scratchCol.x; _scratchNorth.y = _scratchCol.y; _scratchNorth.z = _scratchCol.z;
    Cesium.Matrix4.getColumn(_scratchLocalFrame, 2, _scratchCol); // up
    _scratchUp.x = _scratchCol.x; _scratchUp.y = _scratchCol.y; _scratchUp.z = _scratchCol.z;

    let handled = true;

    switch (key) {
      // W = north
      case "w": {
        cam.move(_scratchNorth, moveDistance);
        break;
      }
      // S = south
      case "s": {
        cam.move(_scratchNorth, -moveDistance);
        break;
      }
      // A = west
      case "a": {
        cam.move(_scratchEast, -moveDistance);
        break;
      }
      // D = east
      case "d": {
        cam.move(_scratchEast, moveDistance);
        break;
      }

      // Q = spin Earth left (orbit camera west around globe polar axis)
      case "q": {
        const carto = cam.positionCartographic;
        cam.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            Cesium.Math.toDegrees(carto.longitude) - spinDeltaDeg,
            Cesium.Math.toDegrees(carto.latitude),
            carto.height,
          ),
          orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
        });
        break;
      }
      // E = spin Earth right (orbit camera east around globe polar axis)
      case "e": {
        const carto = cam.positionCartographic;
        cam.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            Cesium.Math.toDegrees(carto.longitude) + spinDeltaDeg,
            Cesium.Math.toDegrees(carto.latitude),
            carto.height,
          ),
          orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
        });
        break;
      }

      // Arrow keys: orientation
      case "arrowup": {
        const newPitch = Math.min(0, cam.pitch + pitchDelta);
        cam.setView({
          orientation: { heading: cam.heading, pitch: newPitch, roll: cam.roll },
        });
        break;
      }
      case "arrowdown": {
        const newPitch = Math.max(-Math.PI / 2, cam.pitch - pitchDelta);
        cam.setView({
          orientation: { heading: cam.heading, pitch: newPitch, roll: cam.roll },
        });
        break;
      }
      case "arrowleft": {
        cam.setView({
          orientation: { heading: cam.heading - headingDelta, pitch: cam.pitch, roll: cam.roll },
        });
        break;
      }
      case "arrowright": {
        cam.setView({
          orientation: { heading: cam.heading + headingDelta, pitch: cam.pitch, roll: cam.roll },
        });
        break;
      }

      // Space = go up vertically (Z+)
      case " ": {
        cam.move(_scratchUp, verticalDistance);
        break;
      }

      // Shift alone (no WASD) = go down vertically (Z-)
      case "shift": {
        if (!wasdPressed) {
          cam.move(_scratchUp, -verticalDistance);
        }
        break;
      }

      // Theater presets 1-5
      case "1":
      case "2":
      case "3":
      case "4":
      case "5": {
        const preset = THEATER_PRESETS.find((p) => p.key === key);
        if (preset) {
          cam.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, preset.height),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
            duration: 1.5,
          });
        }
        break;
      }

      // Zoom in / out / reset
      case "+":
      case "=": {
        const newH = Math.max(500, height * 0.6);
        cam.zoomIn(height - newH);
        break;
      }
      case "-":
      case "_": {
        const newH = Math.min(20_000_000, height * 1.7);
        cam.zoomOut(newH - height);
        break;
      }
      case "0": {
        cam.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(106.8272, -6.1754, 30_000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.2,
        });
        break;
      }

      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      viewer.scene.requestRender();
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    pressedKeys.delete(e.key.toLowerCase());
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    pressedKeys.clear();
  };
}
