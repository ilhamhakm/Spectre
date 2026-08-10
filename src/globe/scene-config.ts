import * as Cesium from "cesium";

// Initial camera view — Jakarta, low altitude, oblique pitch.
const INITIAL_LON = 106.8257; // 106°49.54'E
const INITIAL_LAT = -6.2505;  // 6°15.03'S
const INITIAL_HEIGHT = 4234;
const INITIAL_HEADING = 337;

// Apply scene + camera settings. Pure side-effects on the passed viewer.
export function configureScene(viewer: Cesium.Viewer): void {
  const globe = viewer.scene.globe;
  if (globe) {
    globe.enableLighting = false;
    globe.depthTestAgainstTerrain = false;
    globe.maximumScreenSpaceError = 1.0;
    globe.tileCacheSize = 200;
    globe.showGroundAtmosphere = true;
  }

  if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  if (viewer.scene.sun) viewer.scene.sun.show = true;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0002;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  viewer.scene.highDynamicRange = false;
  viewer.scene.light.intensity = 2.0;

  // Request-render mode: Cesium only redraws when something changes
  // (camera move, entity update, explicit requestRender() call). This
  // cuts GPU/CPU usage ~90% at idle vs continuous 60fps rendering.
  // All mutation paths in the codebase call scene.requestRender().
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = Infinity;

  // Clock animation kept on for scene.preUpdate events.
  viewer.clock.shouldAnimate = true;
  viewer.useDefaultRenderLoop = true;

  // Camera controller options
  const cam = viewer.scene.screenSpaceCameraController;
  cam.enableTilt = true;
  cam.minimumZoomDistance = 500;
  cam.maximumZoomDistance = 20_000_000;
  cam.enableZoom = true;
  cam.enableRotate = true;
  cam.enableTranslate = true;
  cam.enableCollisionDetection = false;

  // Initial camera view
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      INITIAL_LON,
      INITIAL_LAT,
      INITIAL_HEIGHT
    ),
    orientation: {
      heading: Cesium.Math.toRadians(INITIAL_HEADING),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0,
    },
  });
}
