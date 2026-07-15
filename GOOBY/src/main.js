// GOOBY boot (§B): store.load → (offline sim, G6) → scenes+UI init → RAF.
// The RAF loop lives in core/sceneManager.js; the 1 s stat tick in
// core/timeEngine.js. The dev harness (§E9) handles URL-param routing in dev.

import './ui/styles.css';
import * as THREE from 'three';
import { ROOMS, UI_COLORS, XP } from './data/constants.js';
import { t, setLang } from './data/strings.js';
import * as save from './core/save.js';
import { now } from './core/clock.js';
import { createStore } from './core/store.js';
import { createInput } from './core/input.js';
import { createSceneManager } from './core/sceneManager.js';
import { createTimeEngine } from './core/timeEngine.js';
import { createUi } from './ui/ui.js';
import audio from './audio/audio.js';
import { createMinigameFramework } from './minigames/framework.js';

// Agent G2's core/assets.js is discovered at transform time; the empty-map
// fallback keeps boot working until it lands (coordination note — the glob
// becomes a bundled import automatically once the file exists).
const assetsModules = import.meta.glob('./core/assets.js');

/** Minimal assets stand-in matching the §E1 contract until G2 lands. */
const assetsStub = {
  async preload() {},
  getModel(key) {
    throw new Error(`[assets stub] getModel('${key}') — core/assets.js (G2) not present yet`);
  },
  getAudioUrl(key) {
    console.warn(`[assets stub] getAudioUrl('${key}') — core/assets.js (G2) not present yet`);
    return null;
  },
};

async function loadAssets() {
  const loader = assetsModules['./core/assets.js'];
  if (!loader) return assetsStub;
  try {
    const mod = await loader();
    if (typeof mod.preload === 'function') return mod;
    if (mod.default && typeof mod.default.preload === 'function') return mod.default;
    if (typeof mod.createAssets === 'function') return mod.createAssets();
    console.warn('[boot] core/assets.js has an unexpected shape, using stub');
    return assetsStub;
  } catch (err) {
    console.warn('[boot] core/assets.js failed to load, using stub:', err);
    return assetsStub;
  }
}

// ---------------------------------------------------------------------------
// Placeholder home scene (W1): empty pastel stage + "GOOBY" DOM title.
// G4 replaces with real homeScene.
// ---------------------------------------------------------------------------
function createPlaceholderHome(ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(UI_COLORS.BG_CREAM);

  const camera = new THREE.PerspectiveCamera(ROOMS.CAMERA_FOV, innerWidth / innerHeight, 0.1, 50);
  camera.position.set(0, 3.1, 8.5);
  camera.lookAt(0, 0.2, 0);

  scene.add(new THREE.HemisphereLight(0xfff5e8, 0xb8a898, 1.1));
  const dir = new THREE.DirectionalLight(0xfff2dd, 0.9);
  dir.position.set(2, 4, 3);
  scene.add(dir);

  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.35, 0.22, 56),
    new THREE.MeshStandardMaterial({ color: UI_COLORS.PRIMARY_PINK, roughness: 0.7 })
  );
  stage.position.y = -0.11;
  scene.add(stage);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.07, 12, 64),
    new THREE.MeshStandardMaterial({ color: UI_COLORS.TEAL, roughness: 0.6 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.08;
  scene.add(ring);

  /** @type {HTMLElement|null} */
  let titleEl = null;
  let elapsed = 0;

  return {
    scene,
    camera,
    enter() {
      titleEl = document.createElement('div');
      titleEl.className = 'home-title';
      titleEl.textContent = t('app.title');
      ctx.ui.el.appendChild(titleEl);
    },
    update(dt) {
      elapsed += dt;
      ring.rotation.z += dt * 0.25;
      stage.scale.y = 1 + Math.sin(elapsed * 1.6) * 0.03; // gentle breathing
    },
    exit() {
      titleEl?.remove();
      titleEl = null;
    },
    dispose() {
      scene.traverse((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) {
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose?.();
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  // Dev harness pre-boot: ?now / ?fast / ?reset / ?lang (§E9, dev builds only).
  let harness = null;
  if (import.meta.env.DEV) {
    harness = await import('./dev/harness.js');
    harness.preBoot();
  }

  const loaded = save.load();
  const store = createStore(loaded.state);
  setLang(store.get('settings.lang'));

  const assets = await loadAssets();

  const canvas = document.getElementById('scene');
  const input = createInput(canvas);
  const ui = createUi();
  const sceneManager = createSceneManager({ canvas, assets, input, audio, store, ui });

  // G4 replaces with real homeScene.
  sceneManager.register('home', createPlaceholderHome);

  const framework = createMinigameFramework({ sceneManager, store, ui, audio });

  // G6 wires systems/offline.js catch-up here (simulateOffline before the
  // first render). Until then, elapsed offline time is skipped, not decayed.
  store.set('lastTickAt', now());
  const timeEngine = createTimeEngine(store);
  timeEngine.start();

  store.on('levelUp', ({ level }) => {
    ui.toast('toast.levelUp', { level, coins: XP.LEVEL_UP_COINS_PER_LEVEL * level });
    audio.play('jingle.levelUp');
  });
  if (loaded.recovered) ui.toast('boot.saveCorrupt');

  // First-gesture audio unlock (iOS requirement §D6).
  const unlock = () => {
    audio.init();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);

  const routed = harness
    ? await harness.postBoot({ store, ui, sceneManager, framework, assets })
    : false;
  if (!routed) await sceneManager.switchTo('home');
}

boot().catch((err) => {
  console.error('[boot] fatal:', err);
});
