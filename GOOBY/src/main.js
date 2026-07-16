// GOOBY boot (§B): store.load → (offline sim, G6) → scenes+UI init → RAF.
// The RAF loop lives in core/sceneManager.js; the 1 s stat tick in
// core/timeEngine.js. The dev harness (§E9) handles URL-param routing in dev.

import './ui/styles.css';
import { XP } from './data/constants.js';
import { setLang } from './data/strings.js';
import * as save from './core/save.js';
import { now } from './core/clock.js';
import { createStore } from './core/store.js';
import { createInput } from './core/input.js';
import { createSceneManager } from './core/sceneManager.js';
import { createTimeEngine } from './core/timeEngine.js';
import { createUi } from './ui/ui.js';
import audio from './audio/audio.js';
import { createMinigameFramework } from './minigames/framework.js';
import { createHomeScene, HOME_ASSET_KEYS } from './home/homeScene.js';

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

  // Real home scene (G4): 4 furnished rooms + Gooby (§C2/§D3/§D4).
  sceneManager.register('home', createHomeScene, HOME_ASSET_KEYS);

  const framework = createMinigameFramework({ sceneManager, store, ui, audio });

  // ---- G5 wiring hook (the single marked G5 integration point) ----
  // Registers the home HUD, arcade screen and food-tray panel, and wraps the
  // home-scene factory so care interactions (§C3: pet/tickle/poke, feed, wash,
  // toilet, ball toss) wire up with the live scene handles after every home
  // enter and tear down on exit. Fully feature-detected/guarded: the transform
  // -time glob keeps boot working even while G4's home scene hasn't landed.
  try {
    const care = await import('./home/interactions.js');
    await care.registerCareUi({ store, ui, audio, input, sceneManager, framework, assets });
    const homeLoader = import.meta.glob('./home/homeScene.js')['./home/homeScene.js'];
    const home = homeLoader ? await homeLoader().catch(() => null) : null;
    if (home?.createHomeScene) {
      sceneManager.register('home', (ctx) => {
        const inst = home.createHomeScene(ctx);
        const origEnter = inst.enter?.bind(inst);
        const origExit = inst.exit?.bind(inst);
        inst.enter = async (params) => {
          await origEnter?.(params);
          care.initInteractions({
            scene: inst.scene,
            camera: inst.camera,
            roomManager: inst.getRoomManager?.(),
            gooby: inst.getGooby?.(),
            store, ui, audio, input,
          });
        };
        inst.exit = () => {
          care.teardown();
          origExit?.();
        };
        return inst;
      }, home.HOME_ASSET_KEYS ?? []);
    }
  } catch (err) {
    console.warn('[boot] G5 care wiring unavailable:', err);
  }
  // ---- end G5 wiring hook ----

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
