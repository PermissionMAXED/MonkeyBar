// V4/G65: Gooby-Welt splat preview scene (dev surface — PLAN4 §E block G65).
// Full-screen §E1 scene around splatViewer.js for the TWO shipped scenes:
// the `?weltpreview=<sceneId>` harness route and the dev-panel card-17
// splat-teleport chips both land here. Loads the real 1M PLY through the
// §G6.6 option block, shows a loading card with live percent, applies the
// verified preview pose, and offers drag-orbit for §G6.5 authoring checks.
// Dev-only routing (harness/devPanel) — never part of the shipped game flow;
// G66's games/goobyWelt.js is the player-facing consumer of splatViewer.js.
//
// CDP evidence handle (dev builds): window.__weltPreview =
//   { sceneId, loadMs, quality, error, setQuality(id), getInfo() } —
// getInfo() dumps pixelRatio / camera.far / splatCount / renderer.info.

import * as THREE from 'three';
import { t, getLang } from '../data/strings.js';
import { initViewer } from './splatViewer.js';
import { WELT_SCENES, getWeltScene } from './weltScenes.js';

/** @param {string} sceneId @returns {string} sceneManager id of a preview */
export function previewSceneId(sceneId) {
  return `weltPreview:${sceneId}`;
}

/**
 * Register preview scenes for every welt scene (idempotent). When `sceneId`
 * is given, returns that scene's registered preview id (null if unknown).
 * @param {{register: Function, has: (id: string) => boolean}} sceneManager
 * @param {string} [sceneId]
 * @returns {string|null}
 */
export function registerWeltPreviewScenes(sceneManager, sceneId) {
  for (const def of WELT_SCENES) {
    const id = previewSceneId(def.id);
    if (!sceneManager.has(id)) {
      sceneManager.register(id, (ctx) => createWeltPreviewScene(ctx, def.id));
    }
  }
  if (sceneId == null) return null;
  return getWeltScene(sceneId) ? previewSceneId(sceneId) : null;
}

/**
 * §E1 scene factory for one welt scene preview.
 * @param {{renderer: object, input: object, store: object}} ctx
 * @param {string} sceneId
 */
export function createWeltPreviewScene(ctx, sceneId) {
  const { renderer, input, store } = ctx;
  const def = getWeltScene(sceneId);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(def?.ambientTint ?? '#1a1d22');
  const camera = new THREE.PerspectiveCamera(
    def?.preview.fov ?? 60,
    innerWidth / innerHeight,
    0.05,
    90
  );

  /** @type {Awaited<ReturnType<typeof initViewer>>|null} */
  let handle = null;
  /** @type {HTMLElement|null} */
  let loadingEl = null;
  /** @type {HTMLElement|null} */
  let infoEl = null;
  /** @type {string|null} */
  let loadError = null;

  // --- drag-orbit around the preview pose's lookAt (authoring aid) ---------
  const target = new THREE.Vector3();
  const sph = new THREE.Spherical();
  function syncOrbitFromCamera() {
    sph.setFromVector3(camera.position.clone().sub(target));
  }
  function applyOrbit() {
    sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, sph.phi));
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(target);
  }
  function onDrag(p) {
    if (!handle) return;
    sph.theta -= (p.dx ?? 0) * 0.005;
    sph.phi -= (p.dy ?? 0) * 0.005;
    applyOrbit();
  }

  function showLoading(titleText) {
    loadingEl = document.createElement('div');
    loadingEl.className = 'mg-loading';
    loadingEl.innerHTML = `
      <div class="mg-loading-card">
        <div class="mg-loading-title"></div>
        <div class="mg-loading-text">${t('mg.loading')} <span data-pct>0%</span></div>
        <div class="mg-loading-dots"><span></span><span></span><span></span></div>
      </div>`;
    loadingEl.querySelector('.mg-loading-title').textContent = titleText;
    document.body.appendChild(loadingEl);
  }
  function setLoadingPct(pct) {
    const el = loadingEl?.querySelector('[data-pct]');
    if (el) el.textContent = `${Math.round(pct)}%`;
  }
  function hideLoading() {
    loadingEl?.remove();
    loadingEl = null;
  }

  /** Corner chip: scene · splats · load ms · quality (evidence-friendly). */
  function showInfo() {
    infoEl = document.createElement('div');
    infoEl.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:500;'
      + 'background:rgba(20,24,28,0.72);color:#fff;font:12px/1.5 system-ui,sans-serif;'
      + 'padding:6px 10px;border-radius:8px;pointer-events:none;white-space:pre;';
    refreshInfo();
    document.body.appendChild(infoEl);
  }
  function refreshInfo() {
    if (!infoEl || !handle) return;
    infoEl.textContent = `${sceneId} · ${handle.getSplatCount().toLocaleString()} splats · `
      + `${(handle.loadMs / 1000).toFixed(1)} s · ${handle.quality.id} (pr ${renderer.getPixelRatio()}, far ${camera.far})`;
  }

  const api = {
    scene,
    camera,

    async enter(params = {}) {
      const titleText = def
        ? (getLang() === 'de' ? def.title.de : def.title.en)
        : sceneId;
      showLoading(titleText);
      const quality = params.quality ?? store.get('settings.goobyWeltQuality') ?? 'high';
      try {
        handle = await initViewer(sceneId, {
          renderer,
          quality,
          camera,
          onProgress: (pct) => setLoadingPct(pct),
          onContextLost: () => {
            // §G6.6 clean-exit: the preview is dev-only, so just report —
            // the game (G66) exits to results with a toast here.
            loadError = 'context-lost';
            console.error('[weltPreview] WebGL context lost');
          },
        });
        scene.add(handle.group);
        handle.applyPose(camera, 'preview');
        target.set(...(def?.preview.lookAt ?? [0, 0, 0]));
        syncOrbitFromCamera();
        input.on('drag', onDrag);
        showInfo();
      } catch (err) {
        loadError = String(err?.message ?? err);
        console.error('[weltPreview] splat load failed:', err);
      } finally {
        hideLoading();
      }
      if (import.meta.env.DEV) {
        window.__weltPreview = {
          sceneId,
          camera, // §G6.5 authoring aid: CDP pose probes write position/lookAt
          get loadMs() {
            return handle?.loadMs ?? -1;
          },
          get quality() {
            return handle?.quality.id ?? null;
          },
          get error() {
            return loadError;
          },
          setQuality: (id) => {
            const q = handle?.setQuality(id, camera);
            refreshInfo();
            return q;
          },
          setVisible: (v) => handle?.setVisible(v),
          getInfo: () => ({
            sceneId,
            loadMs: handle?.loadMs ?? -1,
            quality: handle?.quality.id ?? null,
            pixelRatio: renderer.getPixelRatio(),
            cameraFar: camera.far,
            splatCount: handle?.getSplatCount() ?? 0,
            drawCalls: renderer.info.render.calls,
            memory: { ...renderer.info.memory },
            error: loadError,
          }),
        };
      }
    },

    update() {
      // DropInViewer sorts itself from onBeforeRender — nothing to drive.
    },

    exit() {},

    /** §G6.6 async dispose — sceneManager awaits this before the next scene. */
    async dispose() {
      hideLoading();
      infoEl?.remove();
      infoEl = null;
      input.off?.('drag', onDrag);
      if (import.meta.env.DEV && window.__weltPreview?.sceneId === sceneId) {
        delete window.__weltPreview;
      }
      await handle?.dispose();
      handle = null;
    },
  };

  return api;
}
