// Scene manager (§E1): owns the WebGLRenderer, the single canvas, resize
// handling and the RAF loop. register(id, factory) / switchTo(id, params).
// Lifecycle: factory(ctx) → { scene, camera, enter(params), update(dt), exit(),
// dispose() }. Switches fade through a 150 ms black overlay, dispose old scene
// resources, preload the new scene's asset keys, then enter.

import * as THREE from 'three';
import { ENGINE } from '../data/constants.js';

/**
 * @typedef {Object} SceneLifecycle
 * @property {import('three').Scene} scene
 * @property {import('three').Camera} camera
 * @property {(params?: object) => (void|Promise<void>)} [enter]
 * @property {(dt: number) => void} [update] dt in real seconds (clamped)
 * @property {() => void} [exit]
 * @property {() => (void|Promise<void>)} [dispose] must free geometries/
 *   materials it created. V4/G56 (§G6.6): MAY return a Promise (goobyWelt's
 *   splat release) — switchTo awaits it before building the next scene.
 */

/**
 * @param {{canvas: HTMLCanvasElement, assets: object, input: object, audio: object, store: object, ui: object}} deps
 */
export function createSceneManager({ canvas, assets, input, audio, store, ui }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, ENGINE.MAX_PIXEL_RATIO));
  renderer.setSize(innerWidth, innerHeight);

  /** @type {Map<string, {factory: (ctx: object) => SceneLifecycle, assetKeys: string[]}>} */
  const registry = new Map();
  /** @type {{id: string, instance: SceneLifecycle, scopedInput: {removeAll: () => void}}|null} */
  let current = null;
  let switching = false;

  // --- fade overlay (150 ms, §E1). Stepped with timers (not CSS transitions /
  // RAF) so headless virtual-time screenshots and throttled tabs always see a
  // completed fade — timer chains are fast-forwarded deterministically. ---
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;opacity:0;z-index:9999;';
  document.body.appendChild(fadeEl);
  let fadeToken = 0;

  /** @param {number} target opacity 0|1 */
  function fadeTo(target) {
    const token = ++fadeToken;
    const stepMs = 16;
    const steps = Math.max(1, Math.round(ENGINE.SCENE_FADE_MS / stepMs));
    const from = parseFloat(fadeEl.style.opacity) || 0;
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (token !== fadeToken) return resolve(); // superseded by a newer fade
        i += 1;
        fadeEl.style.opacity = String(from + ((target - from) * i) / steps);
        if (i >= steps) resolve();
        else setTimeout(step, stepMs);
      };
      setTimeout(step, stepMs);
    });
  }

  // --- resize ---
  function onResize() {
    renderer.setSize(innerWidth, innerHeight);
    const cam = current?.instance?.camera;
    if (cam && cam.isPerspectiveCamera) {
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
    }
  }
  window.addEventListener('resize', onResize);

  // --- RAF loop ---
  let lastT = performance.now();
  function frame(t) {
    const dt = Math.min((t - lastT) / 1000, 0.1);
    lastT = t;
    const inst = current?.instance;
    if (inst) {
      try {
        inst.update?.(dt);
      } catch (err) {
        console.error('[sceneManager] scene update error:', err);
      }
      if (inst.scene && inst.camera) renderer.render(inst.scene, inst.camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const manager = {
    renderer,

    /**
     * Register a scene factory.
     * @param {string} id scene id ('home', 'minigame', dev scenes…)
     * @param {(ctx: object) => SceneLifecycle} factory
     * @param {string[]} [assetKeys] preloaded via assets.preload before enter
     */
    register(id, factory, assetKeys = []) {
      registry.set(id, { factory, assetKeys });
    },

    /** @param {string} id @returns {boolean} */
    has(id) {
      return registry.has(id);
    },

    /** @returns {string|null} active scene id */
    currentId() {
      return current?.id ?? null;
    },

    /**
     * F6 (RE5): read-only "a switchTo is in flight" flag. During the fade the
     * OLD scene can still be current (fade-out phase), so currentId() alone
     * cannot tell callers whether a queued switch will still change scenes —
     * the minigame framework's launch retry needs this to avoid a false
     * "already there" while a switch AWAY is mid-flight.
     * @returns {boolean}
     */
    isSwitching() {
      return switching;
    },

    // ── V2/G23: photo-mode capture (§C12.2) ─────────────────────────────────
    /**
     * Render the current scene once and read the canvas back as a PNG blob.
     * The render + toBlob happen in the SAME task, so the WebGL backbuffer is
     * still valid — no preserveDrawingBuffer needed (§C12.2 capture pipeline).
     * @returns {Promise<Blob|null>} null when no scene is active or toBlob fails
     */
    captureFrame() {
      const inst = current?.instance;
      if (!inst?.scene || !inst?.camera) return Promise.resolve(null);
      try {
        renderer.render(inst.scene, inst.camera);
      } catch (err) {
        console.error('[sceneManager] captureFrame render failed:', err);
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        try {
          renderer.domElement.toBlob((blob) => resolve(blob), 'image/png');
        } catch (err) {
          console.error('[sceneManager] captureFrame toBlob failed:', err);
          resolve(null);
        }
      });
    },
    // ── end V2/G23 ──────────────────────────────────────────────────────────

    /**
     * Switch to a scene (§E1): fade out → exit+dispose old → preload assets →
     * enter new → fade in.
     * @param {string} id
     * @param {object} [params] passed to the scene's enter()
     * @returns {Promise<void>}
     */
    async switchTo(id, params = {}) {
      const entry = registry.get(id);
      if (!entry) throw new Error(`[sceneManager] unknown scene '${id}'`);
      if (switching) {
        console.warn(`[sceneManager] switchTo('${id}') ignored — switch in progress`);
        return;
      }
      switching = true;
      try {
        await fadeTo(1);
        if (current) {
          try {
            current.instance.exit?.();
            // V4/G56 (§G6.6): a Promise-returning dispose (async splat
            // release) is AWAITED so the old scene's GPU resources are gone
            // before the next scene builds. Sync disposes return undefined —
            // awaiting that is a no-op (existing scenes unaffected).
            await current.instance.dispose?.();
          } catch (err) {
            console.error('[sceneManager] error disposing scene:', err);
          }
          current.scopedInput.removeAll();
          current = null;
        }
        const scopedInput = input.scoped();
        const ctx = { renderer, assets, input: scopedInput, audio, store, ui };
        const instance = entry.factory(ctx);
        current = { id, instance, scopedInput };
        if (instance.camera?.isPerspectiveCamera) {
          instance.camera.aspect = innerWidth / innerHeight;
          instance.camera.updateProjectionMatrix();
        }
        try {
          await assets?.preload?.(entry.assetKeys);
        } catch (err) {
          console.warn('[sceneManager] asset preload failed:', err);
        }
        await instance.enter?.(params);
        await fadeTo(0);
      } finally {
        switching = false;
      }
    },
  };

  return manager;
}
