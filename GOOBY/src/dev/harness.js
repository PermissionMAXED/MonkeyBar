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

  // --- routing ---
  const minigame = q.get('minigame');
  if (minigame) {
    const ok = await framework.launch(minigame, { dev: true });
    if (ok) return true;
    await sceneManager.switchTo('home', { room: q.get('room') ?? undefined });
    return true;
  }

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
