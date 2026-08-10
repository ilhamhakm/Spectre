// Keyboard controls for the globe.
// WASD = pan/translate (relative to camera heading)
// Arrows = tilt/rotate
// 1-5 = theater presets (Jakarta/Surabaya/Medan/Makassar/Jayapura)
// + / - / 0 zoom controls are handled below in this same file.

import * as Cesium from "cesium";

const THEATER_PRESETS: { key: string; lon: number; lat: number; height: number }[] = [
  { key: "1", lon: 106.8272, lat: -6.1754, height: 30_000 }, // Jakarta
  { key: "2", lon: 112.7521, lat: -7.2575, height: 30_000 }, // Surabaya
  { key: "3", lon: 98.6722, lat: 3.5952, height: 30_000 }, // Medan
  { key: "4", lon: 119.4327, lat: -5.1477, height: 30_000 }, // Makassar
  { key: "5", lon: 140.669, lat: -2.5916, height: 50_000 }, // Jayapura
];

export function attachKeyboardControls(viewer: Cesium.Viewer): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

    const cam = viewer.camera;
    const height = viewer.camera.positionCartographic.height;
    const moveDistance = Math.max(50, height * 0.1); // 10% of altitude, min 50m
    const pitchDelta = 0.1;
    const headingDelta = 0.15;

    // Compute local east/north vectors at the camera's position on the globe.
    // This is the key fix: WASD pans in cardinal directions on the ground
    // plane (north/south/east/west), NOT along camera.direction (which points
    // into the ground when looking straight down, making W/S act like zoom).
    const localFrame = Cesium.Transforms.eastNorthUpToFixedFrame(
      cam.position,
      viewer.scene.globe.ellipsoid,
    );
    const east = Cesium.Cartesian3.clone(
      Cesium.Matrix4.getColumn(localFrame, 0, new Cesium.Cartesian4()),
    );
    const north = Cesium.Cartesian3.clone(
      Cesium.Matrix4.getColumn(localFrame, 1, new Cesium.Cartesian4()),
    );

    let handled = true;

    switch (e.key.toLowerCase()) {
      // WASD — pan in cardinal directions on the ground plane.
      case "w": {
        cam.move(north, moveDistance);
        break;
      }
      case "s": {
        cam.move(north, -moveDistance);
        break;
      }
      case "a": {
        cam.move(east, -moveDistance);
        break;
      }
      case "d": {
        cam.move(east, moveDistance);
        break;
      }

      // Arrow keys — orientation
      case "arrowup": {
        const newPitch = Math.min(0, cam.pitch + pitchDelta);
        cam.setView({
          orientation: {
            heading: cam.heading,
            pitch: newPitch,
            roll: cam.roll,
          },
        });
        break;
      }
      case "arrowdown": {
        const newPitch = Math.max(-Math.PI / 2, cam.pitch - pitchDelta);
        cam.setView({
          orientation: {
            heading: cam.heading,
            pitch: newPitch,
            roll: cam.roll,
          },
        });
        break;
      }
      case "arrowleft": {
        cam.setView({
          orientation: {
            heading: cam.heading - headingDelta,
            pitch: cam.pitch,
            roll: cam.roll,
          },
        });
        break;
      }
      case "arrowright": {
        cam.setView({
          orientation: {
            heading: cam.heading + headingDelta,
            pitch: cam.pitch,
            roll: cam.roll,
          },
        });
        break;
      }

      // Theater presets 1-5
      case "1":
      case "2":
      case "3":
      case "4":
      case "5": {
        const preset = THEATER_PRESETS.find((p) => p.key === e.key);
        if (preset) {
          cam.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, preset.height),
            orientation: {
              heading: 0,
              pitch: Cesium.Math.toRadians(-90),
              roll: 0,
            },
            duration: 1.5,
          });
        }
        break;
      }

      // Zoom in / out / reset (replaces the old ZoomControls button rail)
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

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
