// V4/G65: Gooby-Welt splat-viewer integration layer (PLAN4-GAMES §G6.1–§G6.3
// scene side + §G6.6 ALL guards binding; PLAN4 §E block G65; D2 recipe
// /workspace/asset-staging/splats/REPORT.md — options VERBATIM).
//
// Wraps @mkkellogg/gaussian-splats-3d's DropInViewer behind ONE async entry
// point so G66's game (games/goobyWelt.js — movement/pickups/scoring) never
// touches the library directly:
//
//   const handle = await initViewer(sceneId, {
//     renderer,        // REQUIRED — ctx.renderer (pixel-ratio save/restore)
//     quality,         // 'high'|'low' — pass store settings.goobyWeltQuality
//     camera,          // optional PerspectiveCamera: far-plane + spawn pose
//     onProgress,      // (pct 0–100, phase 'download'|'process'|'done')
//     onContextLost,   // () => void — §G6.6 clean-exit hook (fires ONCE)
//   });
//   // handle:
//   //   .group                  Object3D (the DropInViewer) — add to ctx.scene
//   //   .sceneDef               the weltScenes.js row (spawn/orientation/tint)
//   //   .quality                resolved {id, pixelRatio, cameraFar, starGlow}
//   //   .loadMs                 measured splat load time (ms)
//   //   .getSplatCount()        live loaded-splat count
//   //   .setVisible(v)          onPause/onResume — suppresses sort work
//   //   .setQuality(id, cam?)   live toggle: pixel ratio + camera.far; returns def
//   //   .applyPose(cam, key?)   'spawn' (default) | 'preview' pose + fov + far
//   //   .isDisposed()
//   //   .dispose()              async + idempotent — §G6.6 HARD teardown
//
// §G6.6 disposal discipline (binding): dispose() detaches the group from its
// parent FIRST (stops onBeforeRender → no sort on a dying viewer), then
// `await viewer.dispose()` (aborts downloads, terminates the sort worker,
// frees textures/geometry), restores the EXACT saved renderer pixel ratio,
// removes the context-loss listener and nulls refs. Load failure rejects with
// error.code = 'welt-load-failed' AFTER full self-cleanup — the caller swaps
// in the low-poly fallback stage (G66).
//
// iOS / WKWebView memory guards (§G6.6, module-header notes binding):
// • 1M active-splat ceiling (SPLAT_LIMITS.MAX_SPLATS — initViewer refuses
//   defs above it; do not raise without physical-device telemetry).
// • ONE scene resident: initViewer hard-disposes any live/pending viewer
//   before creating the next — a viewer is NEVER cached across rounds.
// • SH0 + inMemoryCompressionLevel 2 + freeIntermediateSplatData (options),
//   pixel ratio ≤ 1 while running, no shadows (splats neither cast nor
//   receive; game adds none), no SharedArrayBuffer (works without COOP/COEP
//   under capacitor://localhost), progressiveLoad off (compression stays on).
// • WKWebView may kill/recreate its web-content process under pressure —
//   test 10 enter/exit cycles; persisted state lives in the store, not here.

import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import {
  VIEWER_OPTIONS,
  ADD_SCENE_OPTIONS,
  SPLAT_LIMITS,
  resolveQuality,
  sceneUrl,
  clampProgress,
  progressPhase,
  createLifecycle,
} from './splatViewer.logic.js';
import { getWeltScene } from './weltScenes.js';

/**
 * Module-level resident tracker (§G6.6: ONE splat scene resident, ever).
 * Holds live + still-loading handles; initViewer awaits their teardown
 * before building the next viewer.
 * @type {Set<{dispose: () => Promise<void>}>}
 */
const activeHandles = new Set();

/** @returns {number} live viewer count (evidence/tests — must be 0 or 1) */
export function getActiveViewerCount() {
  return activeHandles.size;
}

/**
 * Create + load the splat viewer for one registered Gooby-Welt scene.
 * @param {string} sceneId 'windmill' | 'townsquare' (weltScenes.js)
 * @param {{
 *   renderer: import('three').WebGLRenderer,
 *   quality?: 'high'|'low',
 *   camera?: import('three').PerspectiveCamera,
 *   onProgress?: (pct: number, phase: 'download'|'process'|'done') => void,
 *   onContextLost?: () => void,
 * }} opts
 * @returns {Promise<object>} the handle documented in the header
 */
export async function initViewer(sceneId, opts = {}) {
  const { renderer, camera, onProgress, onContextLost } = opts;
  const def = getWeltScene(sceneId);
  if (!def) throw makeLoadError(sceneId, `unknown welt scene '${sceneId}'`);
  if (!renderer) throw makeLoadError(sceneId, 'initViewer requires opts.renderer');
  if (def.splatCount > SPLAT_LIMITS.MAX_SPLATS) {
    throw makeLoadError(sceneId, `scene '${sceneId}' exceeds the ${SPLAT_LIMITS.MAX_SPLATS} iOS splat ceiling (§G6.6)`);
  }

  // §G6.6 one-resident guard — tear down anything alive BEFORE allocating.
  if (activeHandles.size > 0) {
    console.warn(`[splatViewer] disposing ${activeHandles.size} resident viewer(s) before '${sceneId}' (§G6.6 one-scene rule)`);
    await Promise.all([...activeHandles].map((h) => h.dispose()));
  }

  const lifecycle = createLifecycle();
  const quality = { current: resolveQuality(opts.quality) };

  // Pixel-ratio save/restore (§G6.6): the app-wide cap of 2 is too expensive
  // for splats on Retina — run at quality PR (1 or 0.75), restore EXACTLY on
  // dispose no matter which quality was toggled in between.
  const savedPixelRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(quality.current.pixelRatio);

  const splats = new GaussianSplats3D.DropInViewer({
    ...VIEWER_OPTIONS,
    sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
  });

  let disposed = false;
  /** @type {Promise<void>|null} */
  let disposePromise = null;
  let contextLostFired = false;

  const canvas = renderer.domElement;
  function handleContextLost() {
    if (contextLostFired || disposed) return;
    contextLostFired = true;
    console.warn('[splatViewer] WebGL context lost — §G6.6 clean-exit path');
    try {
      onContextLost?.();
    } catch (err) {
      console.error('[splatViewer] onContextLost handler error:', err);
    }
  }
  canvas?.addEventListener?.('webglcontextlost', handleContextLost);

  /** §G6.6 HARD teardown — idempotent; safe from any phase. */
  function dispose() {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      disposed = true;
      if (lifecycle.can('disposing')) lifecycle.to('disposing');
      canvas?.removeEventListener?.('webglcontextlost', handleContextLost);
      // Detach FIRST: the DropInViewer sorts from onBeforeRender — a detached
      // group is never rendered, so no sort can race the async teardown.
      splats.parent?.remove(splats);
      try {
        // Aborts in-flight downloads/sorts, terminates the sort worker,
        // frees GPU textures/geometry (library contract).
        await splats.dispose();
      } catch (err) {
        // Context-lost teardown may throw inside GL calls — refs still drop.
        console.warn('[splatViewer] splats.dispose() error (continuing teardown):', err);
      }
      renderer.setPixelRatio(savedPixelRatio);
      activeHandles.delete(handle);
      if (lifecycle.can('disposed')) lifecycle.to('disposed');
    })();
    return disposePromise;
  }

  const handle = {
    group: splats,
    sceneDef: def,
    get quality() {
      return quality.current;
    },
    loadMs: 0,

    /** @returns {number} loaded splat count (def value until the mesh exists) */
    getSplatCount() {
      try {
        const n = splats.splatMesh?.getSplatCount?.();
        return Number.isFinite(n) && n > 0 ? n : def.splatCount;
      } catch {
        return def.splatCount;
      }
    },

    /** onPause/onResume (§G6.6): invisible group ⇒ no render ⇒ no sort work. */
    setVisible(v) {
      splats.visible = v !== false;
    },

    /**
     * Live quality toggle (pre-game „Qualität: Schön / Flüssig", §G6.6).
     * @param {'high'|'low'} id
     * @param {import('three').PerspectiveCamera} [cam] far-plane target
     * @returns {import('./splatViewer.logic.js').WeltQuality}
     */
    setQuality(id, cam) {
      quality.current = resolveQuality(id);
      if (!disposed) renderer.setPixelRatio(quality.current.pixelRatio);
      const target = cam ?? camera;
      if (target) {
        target.far = quality.current.cameraFar;
        target.updateProjectionMatrix();
      }
      return quality.current;
    },

    /**
     * Apply a verified scene pose (§G6.3 authoring data) to a camera:
     * position + lookAt + fov + quality far plane.
     * @param {import('three').PerspectiveCamera} cam
     * @param {'spawn'|'preview'} [poseKey]
     */
    applyPose(cam, poseKey = 'spawn') {
      const pose = def[poseKey] ?? def.spawn;
      cam.position.set(...pose.position);
      cam.fov = pose.fov;
      cam.far = quality.current.cameraFar;
      cam.updateProjectionMatrix();
      cam.lookAt(...pose.lookAt);
    },

    isDisposed() {
      return disposed;
    },
    dispose,
  };
  activeHandles.add(handle);

  lifecycle.to('loading');
  const startedAt = performance.now();
  try {
    await splats.addSplatScene(sceneUrl(import.meta.env.BASE_URL, def.file), {
      ...ADD_SCENE_OPTIONS,
      rotation: [...def.orientation], // §G6.3 up-axis correction as data
      onProgress: (pct, _label, status) => {
        try {
          onProgress?.(clampProgress(pct), progressPhase(status));
        } catch (err) {
          console.error('[splatViewer] onProgress handler error:', err);
        }
      },
    });
  } catch (err) {
    // Full self-cleanup BEFORE rejecting — the failed viewer must not leak
    // workers or the pixel-ratio override (§G6.6); caller swaps the fallback
    // stage in (toast „3D-Welt konnte nicht laden").
    if (lifecycle.can('failed')) lifecycle.to('failed');
    await dispose();
    throw makeLoadError(sceneId, `splat load failed: ${err?.message ?? err}`, err);
  }
  if (disposed) {
    // Torn down while loading (scene switched away mid-load) — report the
    // abort as a load failure so no caller ever holds a dead handle.
    throw makeLoadError(sceneId, 'viewer disposed during load');
  }
  lifecycle.to('ready');
  handle.loadMs = Math.round(performance.now() - startedAt);
  console.log(`[splatViewer] '${sceneId}' ready: ${handle.getSplatCount()} splats in ${handle.loadMs} ms (quality ${quality.current.id}, pr ${quality.current.pixelRatio})`);

  if (camera) handle.applyPose(camera, 'spawn');
  return handle;
}

/**
 * @param {string} sceneId @param {string} message @param {unknown} [cause]
 * @returns {Error & {code: string, sceneId: string}}
 */
function makeLoadError(sceneId, message, cause) {
  const err = /** @type {Error & {code: string, sceneId: string}} */ (
    new Error(`[splatViewer] ${message}`, cause ? { cause } : undefined)
  );
  err.code = 'welt-load-failed';
  err.sceneId = sceneId;
  return err;
}
