import * as Cesium from "cesium";

let _viewer: Cesium.Viewer | null = null;
let _installed = false;
const _holds = new Set<string>();

const _recentRequests: string[] = [];
const RECENT_REQUEST_CAP = 16;

function applyMode(): void {
  if (!_installed || !_viewer?.scene) return;
  const continuous = _holds.size > 0;
  const scene = _viewer.scene;
  if (scene.requestRenderMode === !continuous) return;
  scene.requestRenderMode = !continuous;
  if (!continuous) {
    scene.requestRender?.();
  }
}

export function installRenderGovernor(viewer: Cesium.Viewer): void {
  if (!viewer?.scene) throw new TypeError("installRenderGovernor requires a Cesium viewer");
  _viewer = viewer;
  _installed = true;
  viewer.scene.maximumRenderTimeChange = Infinity;
  applyMode();
}

export function governorHold(ownerId: string): void {
  _holds.add(ownerId);
  applyMode();
}

export function governorRelease(ownerId: string): void {
  _holds.delete(ownerId);
  applyMode();
}

export function governorRequestRender(owner?: string): void {
  if (!_installed || !_viewer?.scene) return;
  if (_holds.size > 0) return;
  _viewer.scene.requestRender();
  if (owner) {
    _recentRequests.push(owner);
    if (_recentRequests.length > RECENT_REQUEST_CAP) _recentRequests.shift();
  }
}

export function governorHasHold(ownerId: string): boolean {
  return _holds.has(ownerId);
}

export function governorActiveHolds(): string[] {
  return [..._holds];
}

export function uninstallRenderGovernor(): void {
  _holds.clear();
  _installed = false;
  _viewer = null;
}
