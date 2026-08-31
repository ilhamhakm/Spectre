import * as Cesium from "cesium";

const INITIAL_LON = 0;
const INITIAL_LAT = 20;
const INITIAL_HEIGHT = 20_000_000;
const INITIAL_HEADING = 0;

export function configureScene(viewer: Cesium.Viewer): () => void {
  const globe = viewer.scene.globe;
  if (globe) {
    globe.enableLighting = false;
    globe.depthTestAgainstTerrain = false;
    globe.maximumScreenSpaceError = 1.0;
    globe.tileCacheSize = 200;
    globe.showGroundAtmosphere = true;
  }

  if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = true;
    // GEV atmosphere settings: soften the atmosphere for a seamless sky transition
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;
  }
  if (viewer.scene.sun) viewer.scene.sun.show = true;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0002;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  viewer.scene.highDynamicRange = false;
  // Match GEV: lower light intensity for a darker, more cinematic look
  viewer.scene.light.intensity = 1.0;

  // Request-render mode: idle by default, render governor manages switching
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = Infinity;

  // Cap at 60fps
  viewer.targetFrameRate = 60;

  viewer.clock.shouldAnimate = true;
  viewer.useDefaultRenderLoop = true;

  // Tab visibility suspension
  const onVisibilityChange = () => {
    if (viewer.isDestroyed()) return;
    if (document.hidden) {
      viewer.useDefaultRenderLoop = false;
    } else {
      viewer.useDefaultRenderLoop = true;
      viewer.scene.requestRender();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

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
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
