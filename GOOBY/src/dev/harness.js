// Dev harness (§E9) — dev builds only (main.js imports it under
// import.meta.env.DEV). It is every later agent's test surface.
//
// URL params:
//   ?scene=home|gooby        scene routing ('gooby' = G3 character showcase)
//   ?room=kitchen|living|bathroom|bedroom|garden   forwarded to home enter(params)
//   ?minigame=<id>           direct minigame launch (bypasses level locks)
//   ?open=shop|wardrobe|achievements|arcade|settings   open a UI screen
//   ?coins=N ?level=N        state overrides
//   ?energy=N ?hunger=N ?hygiene=N ?fun=N              stat overrides
//   ?fast=N                  clock multiplier   ?now=<epochMs>  pin clock
//   ?reset=1                 wipe save          ?lang=de|en     language
//   ?petdebug=1              V3/G35 (§C12.2): live pet/tickle gesture overlay
//                            (region/dx/velocity/reversals + window.__petdebug
//                            sample log) — implemented in home/interactions.js
//   ?uiscale=85|100|115|130  UI scale override  ?notch=1  fake notch (V3/G33)
//   ?open=devPanel           hidden dev panel (registered unconditionally §B4)
//   ?travel=surf|drive       V3/G38 (§C8.6): start a shop trip via the given
//                            travel method right after boot (like ?shoptrip=1;
//                            combine with ?autopilot=1) — implemented in
//                            systems/shopTrip.js next to ?shoptrip/?vettrip
//   ?difficulty=easy|normal|hard|endless   V4/G56 (§G5.5): force the mode for
//                            ?minigame= launches (dev — bypasses the endless
//                            lock like ?minigame= bypasses level locks)
//   ?invertx=1 ?inverty=1    V4/G56 (§G3.3): set the „Steuerung invertieren"
//                            toggles for this session
//   ?recappreview=<biome>    V4/G63 (§C-SYS2.3): standalone recap-vignette
//                            preview (biome id or 1..8) + __recapPreview probe
//   ?weltpreview=windmill|townsquare   V4/G65 (§G6): full-screen splat-scene
//                            preview through welt/splatViewer.js (+ optional
//                            &quality=high|low override of the saved setting)
//   ?minigame=goobyWelt&scene=<id>&flycam=1   V4/G66 (§G6.5-1): welt path-
//                            authoring flycam (P dumps {pos, look}); &scene=
//                            alone pins the splat scene, &quality=low forces
//                            the §G6.6 low tier for perf probes
//
// `?scene=gooby` expects agent G3's `src/character/showcase.js` to provide:
//
//   export function createShowcaseScene(ctx)
//
// returning the §E1 scene lifecycle object
// ({ scene, camera, enter(params), update(dt), exit(), dispose() }).
// Until that file lands, the harness shows a "showcase not built yet" toast.

import * as clock from '../core/clock.js';
import * as save from '../core/save.js';
import { setLang } from '../data/strings.js';
import { STATS, LEVELING } from '../data/constants.js';
// V3/G33: fake-notch applier for ?notch=1 (PLAN3 §B9 — marked append below)
import { setFakeNotch } from '../ui/settingsScreen.js';

// Resolved at build/transform time; empty map while G3's file doesn't exist,
// so boot keeps working (coordination note — do not convert to a static import).
const showcaseModules = import.meta.glob('../character/showcase.js');

function params() {
  return new URLSearchParams(location.search);
}

/**
 * Numeric URL param, or null when absent/empty/non-numeric.
 * (Careful: Number(null) and Number('') are 0 — must not count as present.)
 * @param {URLSearchParams} q
 * @param {string} name
 * @returns {number|null}
 */
function numParam(q, name) {
  const raw = q.get(name);
  if (raw == null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/**
 * Pre-boot setup — run BEFORE the save is loaded (§E9): clock pinning/scaling,
 * save reset, language override.
 */
export function preBoot() {
  const q = params();
  if (q.get('reset') === '1') save.clear();
  const nowMs = numParam(q, 'now');
  const fast = numParam(q, 'fast');
  if (nowMs != null || (fast != null && fast > 0)) {
    clock.configure({
      now: nowMs ?? undefined,
      fast: fast != null && fast > 0 ? fast : undefined,
    });
  }
}

/**
 * Post-boot overrides + routing — run AFTER store/scenes/UI exist.
 * @param {{store: object, ui: object, sceneManager: object, framework: object}} ctx
 * @returns {Promise<boolean>} true when the harness routed to a scene/screen
 *   (main.js then skips its default switchTo('home')).
 */
export async function postBoot({ store, ui, sceneManager, framework }) {
  const q = params();

  // Dev-only debug handle (§E9 — the harness is every agent's test surface):
  // lets eval agents & CDP-driven tests inspect state, e.g.
  // `window.__gooby.store.get('coins')`.
  window.__gooby = { store, ui, sceneManager, framework, clock, save };

  // Language override wins over the saved setting (display only).
  const lang = q.get('lang');
  if (lang) setLang(lang);

  // --- state overrides ---
  const coins = numParam(q, 'coins');
  if (coins != null) store.set('coins', Math.max(0, Math.floor(coins)));
  const level = numParam(q, 'level');
  if (level != null) {
    // V2 fix: clamp at LEVELING.MAX_LEVEL (40) — the old literal 30 was the
    // frozen v1 cap and made ?level=31..40 untestable.
    store.set('level', Math.min(LEVELING.MAX_LEVEL, Math.max(1, Math.floor(level))));
    store.set('xp', 0);
  }
  for (const stat of STATS.KEYS) {
    const v = numParam(q, stat);
    if (v != null) {
      store.set(`stats.${stat}`, Math.min(STATS.MAX, Math.max(STATS.MIN, v)));
    }
  }

  // ---- V3/G33: core-UX params (PLAN3 §E9, marked append) ----
  // ?uiscale=85|100|115|130 — persisted UI-scale override; illegal values
  // normalize to 100 inside the initUiScale change-follower (§B3).
  // ?notch=1 — force the §B9 fake-notch insets (59/34 px) so the §C1.4
  // safe-area matrix runs in any browser.
  // ?open=devPanel needs no code here: the screen id registers
  // unconditionally in main.js's V3/G33 block (§B4) and the generic
  // `?open=` routing below shows it.
  const uiscale = numParam(q, 'uiscale');
  if (uiscale != null) {
    store.set('settings.uiScale', uiscale);
    store.flush();
  }
  if (q.get('notch') === '1') setFakeNotch(true);
  // ---- end V3/G33 append ----

  // ---- V4/G56: difficulty + invert params (§G5.5/§G3.3, marked append) ----
  // ?invertx=1 / ?inverty=1 flip the persisted settings.controls toggles for
  // the session (container created defensively until G53's save v4 lands).
  // ?difficulty= rides the ?minigame= launch below (dev:true already
  // bypasses the endless lock inside framework.launch).
  const invertX = q.get('invertx');
  const invertY = q.get('inverty');
  if (invertX != null || invertY != null) {
    store.update((state) => {
      if (state.settings.controls == null || typeof state.settings.controls !== 'object') {
        state.settings.controls = { invertX: false, invertY: false };
      }
      if (invertX != null) state.settings.controls.invertX = invertX === '1';
      if (invertY != null) state.settings.controls.invertY = invertY === '1';
    });
    store.flush();
  }
  const difficulty = q.get('difficulty') ?? undefined;
  // ---- end V4/G56 append ----

  // ---- V4/G65: ?weltpreview=<sceneId> (§G6/§E9, marked append) ----
  // Full-screen splat preview through welt/splatViewer.js — the §E block-G65
  // evidence surface (both scenes, load/dispose cycles, quality toggle over
  // window.__weltPreview). Lazy import keeps gaussian-splats-3d out of boot.
  const weltpreview = q.get('weltpreview');
  if (weltpreview) {
    try {
      const welt = await import('../welt/weltPreview.js');
      const target = welt.registerWeltPreviewScenes(sceneManager, weltpreview);
      if (target) {
        await sceneManager.switchTo(target, { quality: q.get('quality') ?? undefined });
        return true;
      }
      console.warn(`[harness] unknown welt scene '${weltpreview}'`);
    } catch (err) {
      console.error('[harness] welt preview failed:', err);
    }
    await sceneManager.switchTo('home');
    return true;
  }
  // ---- end V4/G65 append ----

  // ---- V4/G66: goobyWelt authoring route (§G6.5-1, marked append) ----
  // ?minigame=goobyWelt&scene=<windmill|townsquare>[&flycam=1][&quality=low]
  // forwards the Team-WELT params into the launch: `scene` pins the splat
  // scene, `flycam=1` swaps the run for the free-fly authoring camera
  // (WASD/RF + drag look; `P` dumps {pos, look} JSON via window.__weltFlycam),
  // `quality` overrides the saved §G6.6 toggle for perf probes.
  if (q.get('minigame') === 'goobyWelt' && (q.get('scene') || q.get('flycam') || q.get('quality'))) {
    const ok = await framework.launch('goobyWelt', {
      dev: true,
      difficulty,
      scene: q.get('scene') ?? undefined,
      flycam: q.get('flycam') === '1',
      quality: q.get('quality') ?? undefined,
    });
    if (ok) return true;
    await sceneManager.switchTo('home');
    return true;
  }
  // ---- end V4/G66 append ----

  // --- routing ---
  const minigame = q.get('minigame');
  if (minigame) {
    const ok = await framework.launch(minigame, { dev: true, difficulty }); // V4/G56: + ?difficulty=
    if (ok) return true;
    await sceneManager.switchTo('home', { room: q.get('room') ?? undefined });
    return true;
  }

  // ---- V4/G63: ?recappreview=<biome|1..8> (PLAN4 §B5.4/§C-SYS2.3, marked
  // append) ---- dev-only standalone render of ONE recap biome vignette
  // (meadow|city|harbor|space|spookGarden|bakery|nightSky|toyRoom) with its
  // dolly looping — the §E evidence surface for draw calls/leak cycles via
  // window.__recapPreview. Production playback is G64's recap screen.
  const recapPreview = q.get('recappreview');
  if (recapPreview) {
    const { createVignettePreviewScene, PREVIEW_ASSET_KEYS } = await import('../recap/vignettePreview.js');
    if (!sceneManager.has('recapPreview')) {
      sceneManager.register('recapPreview', createVignettePreviewScene, [...PREVIEW_ASSET_KEYS]);
    }
    await sceneManager.switchTo('recapPreview', { biome: recapPreview });
    return true;
  }
  // ---- end V4/G63 append ----

  // ---- V3/G39: ?scene=roadtest (PLAN3 §C7.1-1, marked append) ----
  // Dev-only road-piece orientation grid: all 5 city-kit-roads pieces at
  // rotY 0/90/180/270 with labels + compass — the binding evidence surface
  // for the PIECE_PORTS truth table in city/cityBuilder.js.
  if (q.get('scene') === 'roadtest') {
    const { createRoadtestScene, ROADTEST_ASSET_KEYS } = await import('./roadtestScene.js');
    if (!sceneManager.has('roadtest')) {
      sceneManager.register('roadtest', createRoadtestScene, [...ROADTEST_ASSET_KEYS]);
    }
    await sceneManager.switchTo('roadtest');
    return true;
  }
  // ---- end V3/G39 append ----

  if (q.get('scene') === 'gooby') {
    const loader = showcaseModules['../character/showcase.js'];
    if (loader) {
      try {
        const mod = await loader();
        if (!sceneManager.has('gooby')) sceneManager.register('gooby', mod.createShowcaseScene);
        await sceneManager.switchTo('gooby');
        return true;
      } catch (err) {
        console.error('[harness] showcase failed to load:', err);
      }
    }
    await sceneManager.switchTo('home');
    ui.toast('toast.showcaseMissing');
    return true;
  }

  const open = q.get('open');
  if (open) {
    await sceneManager.switchTo('home', { room: q.get('room') ?? undefined });
    ui.showScreen(open); // unknown screens toast 'toast.screenMissing' (§E6)
    return true;
  }

  if (q.get('scene') === 'home' || q.get('room')) {
    await sceneManager.switchTo('home', { room: q.get('room') ?? undefined });
    return true;
  }

  return false;
}
