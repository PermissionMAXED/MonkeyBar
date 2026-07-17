// Care interactions (§C3, agent G5): pet / tickle / poke gesture
// classification on Gooby's touch regions, the feed flow (fridge → food tray →
// drag-to-mouth), the wash flow (soap scrub coverage → shower rinse), the
// toilet gag and the living-room ball toss — plus daily pet/tickle caps
// (§C1.5) and XP/stat math.
//
// FILE LAYOUT (important for tests):
//   1. PURE LOGIC — exported helpers with NO three.js/DOM imports so
//      test/interactions.test.js runs them headlessly under node:test.
//      All numbers come from data/constants.js (INTERACT, XP, CARE_TUNING).
//   2. WIRING — browser-only integration. three.js is loaded via dynamic
//      import inside init so the module stays import-safe for node:test.
//
// Integration contract (Wave 2): the home scene (G4) calls
//   initInteractions({ scene, roomManager, gooby, store, ui, audio, particles })
// on enter. Independently, a marked hook in main.js (owned by G5) calls
// registerCareUi({ store, ui, audio, input, sceneManager, framework }) once at
// boot to register the HUD, the arcade screen and the food-tray panel, and to
// provide the core handles (input/camera fallbacks) that G4's bag omits.
// Both entry points are re-entrant and fully feature-detected, so the module
// works (degraded) before G4's files exist.

import { INTERACT, XP, CARE_TUNING } from '../data/constants.js';
import { getFood } from '../data/foods.js';
import { applyDeltas, clampStat } from '../systems/stats.js';
import { currentMood } from '../systems/sleep.js';
import { remove as invRemove, list as invList } from '../systems/inventory.js';
import { applyXp } from '../systems/leveling.js';
import { deriveEmotion } from '../character/emotions.js';
import { t } from '../data/strings.js';
import { now, localDay } from '../core/clock.js';

// ===========================================================================
// 1. PURE LOGIC (unit-tested — no three.js/DOM imports above this line either)
// ===========================================================================

/**
 * @typedef {'head'|'belly'|'feet'|null} Region
 * @typedef {{type: 'pet'}|{type: 'tickle'}} StrokeEvent
 */

/**
 * Gesture classifier for pet / tickle / poke on Gooby's regions (§C3).
 * Feed it the input drag stream (§E5) plus the raycast region per sample;
 * time is injected (ms) so the classifier is fully deterministic in tests.
 *
 * - pet: slow drag over the body — velocity < 600 px/s sustained ≥ 400 ms
 *   → one {type:'pet'} per 400 ms window (+1 fun/stroke).
 * - tickle: fast belly rubs — ≥ 3 horizontal direction changes within 900 ms
 *   on the belly → {type:'tickle'} (+2 fun).
 * - poke: tap on the body → 'poke'; 5 pokes within 3 s → 'dizzy' (§C3).
 *
 * @returns {{
 *   dragStart: (s: {t: number, x: number, y: number, region: Region}) => void,
 *   dragMove: (s: {t: number, x: number, y: number, region: Region}) => StrokeEvent[],
 *   dragEnd: () => void,
 *   tap: (s: {t: number, region: Region}) => ('poke'|'dizzy'|null),
 * }}
 */
export function createCareGestures() {
  /** @type {{t: number, x: number, y: number}|null} */
  let last = null;
  let petMs = 0;
  /** @type {number[]} timestamps of belly direction changes */
  let dirChanges = [];
  let lastDxSign = 0;
  /** @type {number[]} poke timestamps */
  let pokes = [];

  function resetStroke() {
    last = null;
    petMs = 0;
    dirChanges = [];
    lastDxSign = 0;
  }

  return {
    dragStart(s) {
      resetStroke();
      last = { t: s.t, x: s.x, y: s.y };
    },

    dragMove(s) {
      /** @type {StrokeEvent[]} */
      const events = [];
      if (!last) {
        last = { t: s.t, x: s.x, y: s.y };
        return events;
      }
      const dt = Math.max(1, s.t - last.t);
      const dx = s.x - last.x;
      const dist = Math.hypot(dx, s.y - last.y);
      const speed = (dist / dt) * 1000; // px/s

      if (s.region != null) {
        // --- pet: continuous slow movement over the body (§C3) ---
        if (speed < INTERACT.PET_MAX_VELOCITY) {
          petMs += dt;
          if (petMs >= INTERACT.PET_MIN_MS) {
            petMs -= INTERACT.PET_MIN_MS;
            events.push({ type: 'pet' });
          }
        } else {
          petMs = 0; // a fast jerk breaks the stroke
        }
        // --- tickle: fast belly rubs, ≥3 direction changes < 900 ms (§C3) ---
        if (s.region === 'belly' && Math.abs(dx) >= CARE_TUNING.TICKLE_MIN_DX_PX) {
          const sign = dx > 0 ? 1 : -1;
          if (lastDxSign !== 0 && sign !== lastDxSign) {
            dirChanges.push(s.t);
            dirChanges = dirChanges.filter((ts) => s.t - ts < INTERACT.TICKLE_WINDOW_MS);
            if (dirChanges.length >= INTERACT.TICKLE_DIR_CHANGES) {
              dirChanges = [];
              petMs = 0;
              events.push({ type: 'tickle' });
            }
          }
          lastDxSign = sign;
        } else if (s.region !== 'belly') {
          dirChanges = [];
          lastDxSign = 0;
        }
      } else {
        petMs = 0;
        dirChanges = [];
        lastDxSign = 0;
      }

      last = { t: s.t, x: s.x, y: s.y };
      return events;
    },

    dragEnd() {
      resetStroke();
    },

    tap(s) {
      if (s.region == null) return null;
      pokes.push(s.t);
      pokes = pokes.filter((ts) => s.t - ts < INTERACT.POKE_DIZZY_WINDOW_MS);
      if (pokes.length >= INTERACT.POKE_DIZZY_COUNT) {
        pokes = [];
        return 'dizzy';
      }
      return 'poke';
    },
  };
}

/**
 * Daily pet/tickle caps (§C3 + §C1.5): max +10 fun/day from pet + tickle
 * combined, petting XP capped at 20/day. Rolls the counters when the local
 * day changes. Pure — returns granted amounts and the updated counters.
 *
 * @param {{petsDay?: string, petsToday?: number, petFunToday?: number, tickles?: number}} counters
 *   from save achievements.counters (§E3)
 * @param {'pet'|'tickle'} kind
 * @param {string} day local day string (clock.localDay())
 * @returns {{fun: number, xp: number, counters: object}}
 */
export function applyPetTickleGain(counters, kind, day) {
  const c = { ...counters };
  if (c.petsDay !== day) {
    c.petsDay = day;
    c.petsToday = 0;
    c.petFunToday = 0;
  }
  const baseFun = kind === 'tickle' ? INTERACT.TICKLE_FUN : INTERACT.PET_FUN;
  const funRoom = Math.max(0, INTERACT.PET_TICKLE_FUN_DAILY_CAP - (c.petFunToday ?? 0));
  const fun = Math.min(baseFun, funRoom);
  const xp = (c.petsToday ?? 0) < XP.PET_DAILY_CAP ? XP.PET : 0;
  c.petFunToday = (c.petFunToday ?? 0) + fun;
  if (xp > 0) c.petsToday = (c.petsToday ?? 0) + 1;
  if (kind === 'tickle') c.tickles = (c.tickles ?? 0) + 1;
  return { fun, xp, counters: c };
}

/**
 * Feed math (§C3/§C5.1): refuse at hunger ≥ 95, consume from inventory, apply
 * the food's verbatim stat deltas, grant XP 5 (§C1.5) incl. level-ups.
 * Pure — never mutates inputs.
 *
 * @param {{stats: object, inventory: object, xp: number, level: number}} slice
 * @param {string} foodId catalog id (data/foods.js)
 * @returns {{ok: false, reason: 'unknown'|'full'|'none'} | {
 *   ok: true, stats: object, inventory: object, xp: number, level: number,
 *   levelsGained: number, coinsAwarded: number, hungerDelta: number, favorite: boolean
 * }}
 */
export function feedGooby(slice, foodId) {
  const food = getFood(foodId);
  if (!food) return { ok: false, reason: 'unknown' };
  if (slice.stats.hunger >= INTERACT.FEED_REFUSE_AT_HUNGER) return { ok: false, reason: 'full' };
  const inventory = invRemove(slice.inventory, foodId);
  if (inventory == null) return { ok: false, reason: 'none' };
  const stats = applyDeltas(slice.stats, food.deltas);
  const prog = applyXp({ xp: slice.xp, level: slice.level }, XP.FEED);
  return {
    ok: true,
    stats,
    inventory,
    xp: prog.xp,
    level: prog.level,
    levelsGained: prog.levelsGained,
    coinsAwarded: prog.coinsAwarded,
    hungerDelta: food.deltas.hunger,
    favorite: food.favorite,
  };
}

/**
 * Suds coverage accumulation while scrubbing (0–1, clamped).
 * @param {number} coverage current coverage 0–1
 * @param {number} distPx soap-drag distance over Gooby (px)
 * @returns {number}
 */
export function accumulateCoverage(coverage, distPx) {
  return Math.min(1, Math.max(0, coverage) + Math.max(0, distPx) / CARE_TUNING.WASH_SCRUB_PX_FULL);
}

/**
 * @param {number} coverage 0–1
 * @returns {boolean} whether the rinse counts as a full wash (§C3)
 */
export function isFullWash(coverage) {
  return coverage >= CARE_TUNING.FULL_WASH_COVERAGE;
}

/**
 * Wash rinse math (§C3): hygiene += 60 × coverage; a full wash also grants
 * +3 fun and XP 8 (§C1.5). Pure.
 *
 * @param {{stats: object, xp: number, level: number}} slice
 * @param {number} coverage suds coverage 0–1
 * @returns {{stats: object, xp: number, level: number, levelsGained: number,
 *   coinsAwarded: number, full: boolean, hygieneGain: number}}
 */
export function washRinse(slice, coverage) {
  const cov = Math.min(1, Math.max(0, coverage));
  const full = isFullWash(cov);
  const hygieneGain = INTERACT.WASH_HYGIENE_FACTOR * cov;
  const stats = applyDeltas(slice.stats, {
    hygiene: hygieneGain,
    fun: full ? INTERACT.FULL_WASH_FUN : 0,
  });
  const prog = applyXp({ xp: slice.xp, level: slice.level }, full ? XP.FULL_WASH : 0);
  return {
    stats,
    xp: prog.xp,
    level: prog.level,
    levelsGained: prog.levelsGained,
    coinsAwarded: prog.coinsAwarded,
    full,
    hygieneGain,
  };
}

/**
 * Toilet gag availability (§C2/§C3): only when hygiene < 50, with a 10-min
 * cooldown from the persisted timestamp.
 * @param {{hygiene: number, lastAt?: number}} s
 * @param {number} nowMs
 * @returns {'ok'|'noNeed'|'cooldown'}
 */
export function canUseToilet(s, nowMs) {
  if (s.hygiene >= INTERACT.TOILET_BELOW_HYGIENE) return 'noNeed';
  if (nowMs - (s.lastAt ?? 0) < INTERACT.TOILET_COOLDOWN_MIN * 60000) return 'cooldown';
  return 'ok';
}

/**
 * Screen flick → ball launch velocity (m/s, §C3 ball toss). Y is always
 * lifted so even flat flicks arc; magnitude clamped to MAX_SPEED. Pure.
 * @param {{vx: number, vy: number}} flick pointer velocity px/s (screen y down)
 * @returns {{x: number, y: number, z: number}}
 */
export function flickToVelocity(flick) {
  const B = CARE_TUNING.BALL;
  const s = B.FLICK_VEL_SCALE;
  const v = {
    x: (flick.vx ?? 0) * s,
    y: Math.max(0.8, -(flick.vy ?? 0) * s),
    z: -Math.abs((flick.vy ?? 0) * s) * 0.35,
  };
  const mag = Math.hypot(v.x, v.y, v.z);
  if (mag > B.MAX_SPEED) {
    const k = B.MAX_SPEED / mag;
    v.x *= k;
    v.y *= k;
    v.z *= k;
  }
  return v;
}

/**
 * One ballistic integration step with floor bounce + room-bound walls (§C3).
 * Coordinates are local to the ball spawn anchor. Mutates `ball` in place
 * (plain objects — the 3D wiring copies onto the mesh). Pure math.
 *
 * @param {{pos: {x:number,y:number,z:number}, vel: {x:number,y:number,z:number}}} ball
 * @param {number} dt seconds
 * @returns {{bounced: boolean, resting: boolean}}
 */
export function stepBall(ball, dt) {
  const B = CARE_TUNING.BALL;
  const { pos, vel } = ball;
  let bounced = false;

  vel.y -= B.GRAVITY * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;

  // floor
  if (pos.y < B.RADIUS) {
    pos.y = B.RADIUS;
    if (vel.y < 0) {
      vel.y = -vel.y * B.RESTITUTION;
      if (vel.y < 0.25) vel.y = 0; // stop micro-bouncing
      else bounced = true;
    }
    const drag = Math.max(0, 1 - B.FRICTION * dt);
    vel.x *= drag;
    vel.z *= drag;
  }
  // walls (room bounds relative to the spawn anchor)
  if (Math.abs(pos.x) > B.BOUND_X) {
    pos.x = Math.sign(pos.x) * B.BOUND_X;
    vel.x = -vel.x * B.RESTITUTION;
    bounced = true;
  }
  if (pos.z < B.BOUND_Z_MIN) {
    pos.z = B.BOUND_Z_MIN;
    vel.z = -vel.z * B.RESTITUTION;
    bounced = true;
  } else if (pos.z > B.BOUND_Z_MAX) {
    pos.z = B.BOUND_Z_MAX;
    vel.z = -vel.z * B.RESTITUTION;
    bounced = true;
  }

  const onFloor = pos.y - B.RADIUS < 0.02;
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  const resting = onFloor && speed < B.REST_SPEED;
  if (resting) {
    vel.x = 0;
    vel.y = 0;
    vel.z = 0;
  }
  return { bounced, resting };
}

// ===========================================================================
// 2. WIRING (browser only — three.js via dynamic import, DOM inside functions)
// ===========================================================================

/** Food id → emoji for the tray + drag ghost (iconography, not translated text). */
const FOOD_EMOJI = {
  carrot: '🥕', apple: '🍎', banana: '🍌', bread: '🍞', cheese: '🧀',
  watermelon: '🍉', 'donut-sprinkles': '🍩', cupcake: '🧁', salad: '🥗',
  'ice-cream': '🍦', sandwich: '🥪', 'hot-dog': '🌭', pancakes: '🥞',
  burger: '🍔', pizza: '🍕', cake: '🍰',
};

const CARE_CSS = `
.g5-float{position:fixed;transform:translate(-50%,-50%);font-size:30px;font-weight:800;color:#59C9B9;text-shadow:0 2px 0 #fff,0 4px 14px rgba(74,59,54,.3);pointer-events:none;z-index:900;animation:g5-float-up 1.1s ease-out forwards;}
.g5-float.g5-bad{color:#FF7BA9;}
@keyframes g5-float-up{0%{opacity:0;margin-top:0}12%{opacity:1}100%{opacity:0;margin-top:-70px}}
.g5-ghost{position:fixed;transform:translate(-50%,-50%);font-size:52px;filter:drop-shadow(0 6px 8px rgba(74,59,54,.35));pointer-events:none;z-index:950;transition:font-size 120ms ease;}
.g5-ghost.g5-near{font-size:64px;}
.tray-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-height:38vh;overflow-y:auto;margin-top:10px;}
.tray-item{display:flex;flex-direction:column;align-items:center;gap:2px;background:var(--bg-cream,#FFF6EC);border-radius:16px;padding:10px 4px 8px;border:none;font-family:inherit;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;position:relative;}
.tray-item:active{transform:scale(.95);}
.tray-emoji{font-size:34px;line-height:1;pointer-events:none;}
.tray-name{font-size:11px;font-weight:700;color:var(--brown,#4A3B36);opacity:.75;pointer-events:none;}
.tray-count{position:absolute;top:4px;right:6px;background:var(--pink,#FF7BA9);color:#fff;font-size:11px;font-weight:800;border-radius:999px;padding:1px 7px;pointer-events:none;}
.tray-title{margin:0;font-size:22px;font-weight:800;color:var(--brown,#4A3B36);}
.tray-hint{font-size:13px;font-weight:700;opacity:.55;margin-top:2px;}
.tray-empty{padding:24px 8px;text-align:center;font-weight:700;opacity:.6;}
.g5-wash{position:absolute;inset:0;pointer-events:none;z-index:60;}
.g5-wash-meter{position:absolute;top:calc(76px + var(--safe-top,0px));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.94);border-radius:999px;padding:8px 16px;font-weight:800;font-size:15px;color:var(--brown,#4A3B36);box-shadow:0 6px 24px rgba(74,59,54,.14);}
.g5-wash-track{display:inline-block;width:90px;height:12px;border-radius:999px;background:rgba(74,59,54,.12);overflow:hidden;}
.g5-wash-fill{display:block;height:100%;border-radius:999px;background:var(--stat-hygiene,#6EC6FF);width:0%;transition:width 150ms ease;}
.g5-wash-hint{position:absolute;top:calc(122px + var(--safe-top,0px));left:0;right:0;text-align:center;font-size:14px;font-weight:700;color:var(--brown,#4A3B36);opacity:.65;text-shadow:0 1px 0 #fff;}
.g5-soap{position:fixed;transform:translate(-50%,-50%);width:74px;height:52px;pointer-events:auto;cursor:grab;touch-action:none;z-index:960;filter:drop-shadow(0 6px 8px rgba(74,59,54,.3));}
.g5-shower-btn{position:absolute;pointer-events:auto;display:inline-flex;align-items:center;gap:8px;right:14px;top:calc(76px + var(--safe-top,0px));}
.g5-wash-close{position:absolute;pointer-events:auto;left:14px;top:calc(76px + var(--safe-top,0px));}
`;

let careStylesInjected = false;
function ensureCareStyles() {
  if (careStylesInjected || typeof document === 'undefined') return;
  careStylesInjected = true;
  const el = document.createElement('style');
  el.dataset.owner = 'g5-interactions';
  el.textContent = CARE_CSS;
  document.head.appendChild(el);
}

/** Inline SVG soap bar (drawn here — icons.js is G1's file). */
const SOAP_SVG = `<svg viewBox="0 0 74 52" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="10" width="66" height="38" rx="12" fill="#8FD8F5" stroke="#5FB8DE" stroke-width="3"/>
  <ellipse cx="26" cy="22" rx="10" ry="5" fill="#DFF4FF" opacity="0.9"/>
  <circle cx="56" cy="8" r="5" fill="#fff" opacity="0.85"/>
  <circle cx="66" cy="16" r="3.5" fill="#fff" opacity="0.7"/>
  <circle cx="48" cy="4" r="3" fill="#fff" opacity="0.6"/>
</svg>`;
const SHOWER_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v1h12V9a6 6 0 0 0-6-6zM5 12h14v2H5zM7 16l-1 4M12 16v4M17 16l1 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;

/** Core handles provided by the main.js boot hook (may be null pre-hook). */
let core = null;
/** Live wiring for the current home-scene instance (torn down on re-init). */
let active = null;

/** @returns {boolean} whether initInteractions has wired a live home scene */
export function isInitialized() {
  return active != null;
}

/**
 * Boot-time registration (called once from the marked G5 hook in main.js):
 * stores core handles and registers the HUD, arcade screen and food tray.
 * Safe to call before/without G4's home scene.
 * @param {{store: object, ui: object, audio: object, input?: object,
 *   sceneManager?: object, framework?: object, assets?: object}} deps
 */
export async function registerCareUi(deps) {
  core = { ...(core ?? {}), ...deps };
  ensureCareStyles();
  const { store, ui, audio } = core;

  // HUD + arcade (src/ui/, owned by G5). Dynamic imports keep this module
  // import-safe for node:test (registry.js uses import.meta.glob).
  const [{ createHud }, { createArcadeScreen }] = await Promise.all([
    import('../ui/hud.js'),
    import('../ui/arcadeScreen.js'),
  ]);
  if (!core.hud) {
    core.hud = createHud({
      store,
      ui,
      audio,
      framework: core.framework,
      sceneManager: core.sceneManager,
    });
  }
  if (!ui.hasScreen('arcade')) {
    ui.registerScreen('arcade', createArcadeScreen({ store, ui, framework: core.framework }));
  }
  ui.registerPanel('foodTray', createFoodTrayPanel());
}

/**
 * Home-scene wiring entry point (§C3) — G4's home scene calls this on enter:
 *   initInteractions({ scene, roomManager, gooby, store, ui, audio, particles })
 * Re-entrant: a second call tears the previous wiring down first (the home
 * scene is re-created on every sceneManager switch). All handles are
 * feature-detected; missing pieces degrade gracefully (with a console.warn).
 * @param {{scene?: object, roomManager?: object, gooby?: object, store?: object,
 *   ui?: object, audio?: object, particles?: object, camera?: object, input?: object}} bag
 */
export function initInteractions(bag = {}) {
  teardown();
  ensureCareStyles();

  const store = bag.store ?? core?.store;
  const ui = bag.ui ?? core?.ui;
  const audio = bag.audio ?? core?.audio ?? { play() {}, music() {}, init() {}, setVolume() {} };
  const input = bag.input ?? core?.input ?? null;
  const roomManager = bag.roomManager ?? null;
  const gooby = bag.gooby ?? null;
  const scene = bag.scene ?? null;
  const particles = bag.particles ?? null;
  if (!store || !ui) {
    console.warn('[interactions] missing store/ui — care wiring skipped');
    return;
  }

  const state = {
    store, ui, audio, input, roomManager, gooby, scene, particles,
    camera: null,
    THREE: null,
    gestures: createCareGestures(),
    subs: /** @type {Array<() => void>} */ ([]),
    timers: /** @type {Array<ReturnType<typeof setTimeout>>} */ ([]),
    raf: 0,
    rafFx: 0,
    ownParticles: false, // created here (vs handed in) → we dispose it
    disposed: false,
    washing: null, // { coverage, els... }
    feeding: null, // active food drag
    ball: null, // { mesh, spawn, pos, vel, resting, cooldownUntil, chasing }
    goobyBusy: false, // hop/chase movement lock
  };
  active = state;

  // camera: feature-detect across plausible G4 shapes
  state.camera =
    bag.camera ??
    roomManager?.getCamera?.() ??
    roomManager?.camera ??
    scene?.userData?.camera ??
    null;
  if (!state.camera && scene?.traverse) {
    scene.traverse((o) => {
      if (!state.camera && o.isPerspectiveCamera) state.camera = o;
    });
  }

  // three.js arrives async (dynamic import keeps node:test import-safe).
  import('three')
    .then((THREE) => {
      if (state.disposed) return;
      state.THREE = THREE;
      setupBall(state);
    })
    .catch((err) => console.warn('[interactions] three import failed:', err));

  // Preload the tween module so moveGooby() can start hops synchronously
  // (avoids a mid-gesture dynamic-import stall on slow loads).
  state.tweenMod = null;
  import('../gfx/tween.js')
    .then((mod) => {
      if (!state.disposed) state.tweenMod = mod;
    })
    .catch(() => {});

  // No particles handle passed in → own a pooled system for care feedback
  // (hearts/crumbs/bubbles/sparkles) and drive its update() from a local RAF.
  if (!particles && scene?.add) {
    import('../gfx/particles.js')
      .then(({ createParticles }) => {
        if (state.disposed) return;
        state.particles = createParticles(scene);
        state.ownParticles = true;
        let last = performance.now();
        const fxTick = (tMs) => {
          if (state.disposed) return;
          state.rafFx = requestAnimationFrame(fxTick);
          const dt = Math.min((tMs - last) / 1000, 0.08);
          last = tMs;
          state.particles?.update(dt);
        };
        state.rafFx = requestAnimationFrame(fxTick);
      })
      .catch((err) => console.warn('[interactions] particles import failed:', err));
  }

  // --- room interactable events (G4 contract: roomManager.on('tap:…')) ---
  subscribeRoom(state, 'tap:fridge', () => {
    if (blockedBySleep(state)) return;
    audio.play('ui.open');
    ui.openPanel('foodTray');
  });
  subscribeRoom(state, 'tap:bathtub', () => {
    if (blockedBySleep(state)) return;
    startWash(state);
  });
  subscribeRoom(state, 'tap:toilet', () => {
    if (blockedBySleep(state)) return;
    useToilet(state);
  });
  subscribeRoom(state, 'tap:tv', () => {
    if (blockedBySleep(state)) return;
    ui.showScreen('arcade');
  });

  // --- pet / tickle / poke gestures on Gooby (input §E5 + regionAt §D2.3) ---
  if (input && gooby && state.camera) {
    wireGestures(state);
  } else if (!gooby) {
    console.warn('[interactions] no gooby handle — gestures inactive');
  } else if (!state.camera) {
    console.warn('[interactions] no camera found — gestures inactive');
  }

  // --- dev demo params (screenshot surface, dev builds only — §E9 spirit) ---
  if (import.meta.env?.DEV && typeof location !== 'undefined') {
    runDevDemos(state);
  }
}

/** Tear down the current wiring (called automatically on re-init). */
export function teardown() {
  const s = active;
  if (!s) return;
  active = null;
  s.disposed = true;
  for (const off of s.subs) {
    try {
      off?.();
    } catch { /* listener already gone */ }
  }
  for (const timer of s.timers) clearTimeout(timer);
  if (typeof cancelAnimationFrame !== 'undefined') {
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.rafFx) cancelAnimationFrame(s.rafFx);
  }
  if (s.ownParticles) s.particles?.dispose?.();
  endWash(s, { silent: true });
  s.feeding?.cancel?.();
  if (s.ball?.mesh) {
    s.ball.mesh.parent?.remove(s.ball.mesh);
    s.ball.mesh.geometry?.dispose?.();
    s.ball.mesh.material?.dispose?.();
  }
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function blockedBySleep(s) {
  if (s.store.get('sleep.sleeping')) {
    s.ui.toast('toast.sleeping');
    return true;
  }
  return false;
}

function subscribeRoom(s, event, cb) {
  const rm = s.roomManager;
  if (!rm?.on) return;
  const guarded = (...args) => {
    if (s.disposed) return;
    cb(...args);
  };
  const off = rm.on(event, guarded);
  s.subs.push(typeof off === 'function' ? off : () => rm.off?.(event, guarded));
}

/** World position for a room anchor (feature-detects Object3D / Vector3 / {x,y,z}). */
function anchorPos(s, name) {
  const a = s.roomManager?.getAnchor?.(name);
  if (!a) return null;
  if (a.isObject3D) {
    const v = new s.THREE.Vector3();
    a.getWorldPosition(v);
    return v;
  }
  if (a.isVector3) return a.clone();
  if (typeof a.x === 'number') return new s.THREE.Vector3(a.x, a.y ?? 0, a.z ?? 0);
  if (a.position) return anchorPosFrom(s, a.position);
  return null;
}

function anchorPosFrom(s, p) {
  return p.isVector3 ? p.clone() : new s.THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0);
}

/** Project a world point to CSS pixels. */
function worldToScreen(s, world) {
  const v = world.clone().project(s.camera);
  const w = typeof innerWidth !== 'undefined' ? innerWidth : 390;
  const h = typeof innerHeight !== 'undefined' ? innerHeight : 844;
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
}

/** Raycast client coords against Gooby; returns { region, point } or null. */
function pickGooby(s, clientX, clientY) {
  if (!s.THREE || !s.camera || !s.gooby) return null;
  const w = typeof innerWidth !== 'undefined' ? innerWidth : 390;
  const h = typeof innerHeight !== 'undefined' ? innerHeight : 844;
  s._ray = s._ray ?? new s.THREE.Raycaster();
  s._ndc = s._ndc ?? new s.THREE.Vector2();
  s._ndc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
  s._ray.setFromCamera(s._ndc, s.camera);
  const hits = s._ray.intersectObject(s.gooby.group, true);
  if (hits.length === 0) return null;
  const region = s.gooby.regionAt(hits[0]);
  return region ? { region, point: hits[0].point } : null;
}

/** Approximate mouth world position from the glasses anchor (§D2.3 anchors). */
function mouthWorld(s) {
  const anchor = s.gooby?.anchors?.glasses ?? s.gooby?.anchors?.hat;
  if (!anchor || !s.THREE) return null;
  const v = new s.THREE.Vector3();
  anchor.getWorldPosition(v);
  v.y -= 0.07;
  return v;
}

/** Restore Gooby's default emotion from mood + stats (§D2.5). */
function restoreEmotion(s) {
  if (!s.gooby || s.disposed) return;
  const state = s.store.get();
  // currentMood (systems/sleep.js) applies the §C1.4 early-wake grumpy debuff
  // (−15 while grumpyUntil is active) and clamps to the valid range.
  s.gooby.setEmotion(deriveEmotion({ mood: currentMood(state, now()), stats: state.stats }));
}

function laterTimer(s, fn, ms) {
  const id = setTimeout(() => {
    if (!s.disposed) fn();
  }, ms);
  s.timers.push(id);
  return id;
}

/** Floating "+40"-style text at a screen position. */
function floatText(s, text, x, y, bad = false) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = `g5-float${bad ? ' g5-bad' : ''}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  laterTimer(s, () => el.remove(), 1200);
}

// ---------------------------------------------------------------------------
// pet / tickle / poke (§C3)
// ---------------------------------------------------------------------------

function wireGestures(s) {
  const { input, gooby, store, audio } = s;
  const inHome = () =>
    !s.disposed &&
    gooby.group.parent != null &&
    (core?.sceneManager ? core.sceneManager.currentId() === 'home' : true);

  const grantStroke = (kind, screenX, screenY) => {
    const day = localDay();
    const counters = store.get('achievements.counters') ?? {};
    const gain = applyPetTickleGain(counters, kind, day);
    store.update((st) => {
      st.achievements.counters = gain.counters;
      if (gain.fun > 0) st.stats.fun = clampStat(st.stats.fun + gain.fun);
      if (gain.xp > 0) {
        const prog = applyXp({ xp: st.xp, level: st.level }, gain.xp);
        st.xp = prog.xp;
        st.level = prog.level;
        st.coins += prog.coinsAwarded;
      }
    });
    const head = mouthWorld(s);
    if (s.particles && head) {
      s.particles.emit('hearts', head, { count: kind === 'tickle' ? 4 : 3 });
    }
    if (gain.fun > 0) floatText(s, `+${gain.fun}`, screenX, screenY - 30);
  };

  const onDragStart = (p) => {
    if (!inHome() || s.washing || s.feeding) return;
    const hit = pickGooby(s, p.x, p.y);
    s.gestures.dragStart({ t: performance.now(), x: p.x, y: p.y, region: hit?.region ?? null });
  };

  const onDrag = (p) => {
    if (!inHome() || s.washing || s.feeding) return;
    const hit = pickGooby(s, p.x, p.y);
    const events = s.gestures.dragMove({
      t: performance.now(), x: p.x, y: p.y, region: hit?.region ?? null,
    });
    for (const ev of events) {
      if (ev.type === 'pet') {
        // §C3 pet: purr squeak, hearts, eyes closed happy
        audio.play('gooby.purr');
        s.gooby.setEmotion('happy');
        grantStroke('pet', p.x, p.y);
        laterTimer(s, () => restoreEmotion(s), 1600);
      } else if (ev.type === 'tickle') {
        // §C3 tickle: giggle voice, tickle anim, cheek blush (in the clip)
        audio.play('gooby.giggle');
        s.gooby.play('tickle');
        laterTimer(s, () => {
          s.gooby.stop('tickle');
          restoreEmotion(s);
        }, 1000);
        grantStroke('tickle', p.x, p.y);
      }
    }
    if (hit) s.gooby.lookAt(hit.point);
  };

  const onDragEnd = () => {
    s.gestures.dragEnd();
    if (s.gooby) s.gooby.lookAt(null);
    // ball flick is handled by the ball's own dragend hook (setupBall)
  };

  const onTap = (p) => {
    if (!inHome() || s.washing || s.feeding) return;
    // F6 (RE1 P2-9): while Gooby sleeps his taps open the early-wake sheet
    // (ui/sleepFlow.js 'tap:gooby' route) — suppress the poke squeak/wobble
    // so care taps stay quiet during the nap.
    if (store.get('sleep.sleeping')) return;
    const hit = pickGooby(s, p.x, p.y);
    if (!hit) return;
    const res = s.gestures.tap({ t: performance.now(), region: hit.region });
    if (res === 'dizzy') {
      // 5 pokes < 3 s → dizzy 2 s with spiral eyes (§C3; clip runs 2.0 s)
      audio.play('gooby.squeakDizzy');
      s.gooby.play('dizzy').then(() => restoreEmotion(s));
    } else if (res === 'poke') {
      audio.play('gooby.squeak');
      const dx = hit.point.x - s.gooby.group.position.x;
      s.gooby.play('pokeWobble', { dir: { x: dx * 4, z: 1 } });
    }
  };

  s.subs.push(input.on('dragstart', onDragStart));
  s.subs.push(input.on('drag', onDrag));
  s.subs.push(input.on('dragend', onDragEnd));
  s.subs.push(input.on('tap', onTap));
}

// ---------------------------------------------------------------------------
// feed flow (§C3): fridge → tray panel → drag to mouth → eat / refuse
// ---------------------------------------------------------------------------

/** ui panel module for the food tray (registered in registerCareUi). */
function createFoodTrayPanel() {
  return {
    mount(el) {
      const store = core?.store ?? active?.store;
      const inv = store?.get('inventory') ?? {};
      const items = invList(inv);
      el.innerHTML = `<h2 class="tray-title">${t('tray.title')}</h2>` +
        (items.length === 0
          ? `<div class="tray-empty">${t('tray.empty')}</div>`
          : `<div class="tray-hint">${t('tray.dragHint')}</div><div class="tray-grid"></div>`);
      const grid = el.querySelector('.tray-grid');
      if (!grid) return;
      for (const { id, count } of items) {
        const btn = document.createElement('button');
        btn.className = 'tray-item';
        btn.innerHTML = `
          <span class="tray-count">×${count}</span>
          <span class="tray-emoji">${FOOD_EMOJI[id] ?? '🍽️'}</span>
          <span class="tray-name">${t(`food.${id}`)}</span>`;
        btn.addEventListener('pointerdown', (e) => {
          if (active) startFoodDrag(active, id, e);
        });
        grid.appendChild(btn);
      }
    },
    unmount() {},
  };
}

/** Begin dragging a food item out of the tray (DOM ghost — §C3 feed). */
function startFoodDrag(s, foodId, downEvent) {
  if (s.feeding || typeof document === 'undefined') return;
  downEvent.preventDefault();
  s.audio.play('ui.pick');

  const ghost = document.createElement('div');
  ghost.className = 'g5-ghost';
  ghost.textContent = FOOD_EMOJI[foodId] ?? '🍽️';
  ghost.style.left = `${downEvent.clientX}px`;
  ghost.style.top = `${downEvent.clientY}px`;
  document.body.appendChild(ghost);

  let trayClosed = false;
  let near = false;
  const startX = downEvent.clientX;
  const startY = downEvent.clientY;

  const feeding = {
    cancel() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      ghost.remove();
      if (s.feeding === feeding) s.feeding = null;
      if (near && s.gooby) {
        s.gooby.lookAt(null);
        restoreEmotion(s);
      }
    },
  };
  s.feeding = feeding;

  const mouthScreen = () => {
    const m = s.gooby && s.THREE ? mouthWorld(s) : null;
    return m && s.camera ? worldToScreen(s, m) : null;
  };

  function onMove(e) {
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    if (!trayClosed && Math.hypot(e.clientX - startX, e.clientY - startY) > 24) {
      trayClosed = true;
      s.ui.closePanel('foodTray'); // reveal Gooby while the ghost keeps dragging
    }
    const m = mouthScreen();
    if (!m) return;
    const d = Math.hypot(e.clientX - m.x, e.clientY - m.y);
    const isNear = d < CARE_TUNING.FEED_NEAR_MOUTH_PX;
    if (isNear !== near) {
      near = isNear;
      ghost.classList.toggle('g5-near', near);
      if (near) {
        // mouth opens / drools in anticipation as the snack approaches (§C3)
        s.gooby.setEmotion('hungry');
        audioOnce(s, 'gooby.sniff');
      } else {
        restoreEmotion(s);
      }
    }
    if (near && s.gooby) {
      const world = mouthWorld(s);
      if (world) s.gooby.lookAt(world.set(world.x + (e.clientX - m.x) / 400, world.y, world.z + 0.4));
    }
  }

  function onUp(e) {
    const m = mouthScreen();
    const d = m ? Math.hypot(e.clientX - m.x, e.clientY - m.y) : Infinity;
    feeding.cancel();
    if (m && d < CARE_TUNING.FEED_DROP_PX) {
      performFeed(s, foodId, m);
    } else {
      restoreEmotion(s);
    }
  }
  function onCancel() {
    feeding.cancel();
    restoreEmotion(s);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

let lastAudioOnceId = '';
function audioOnce(s, id) {
  if (lastAudioOnceId === id) return;
  lastAudioOnceId = id;
  s.audio.play(id);
  laterTimer(s, () => {
    lastAudioOnceId = '';
  }, 800);
}

/**
 * Execute a feed at Gooby's mouth (shared by the drag-drop flow and the dev
 * demo): pure math via feedGooby, then store update + juice (§C3).
 * @param {object} s wiring state
 * @param {string} foodId
 * @param {{x: number, y: number}} [screenPos] float-text position
 */
function performFeed(s, foodId, screenPos) {
  const { store, ui, audio, gooby } = s;
  const slice = {
    stats: store.get('stats'),
    inventory: store.get('inventory'),
    xp: store.get('xp'),
    level: store.get('level'),
  };
  const r = feedGooby(slice, foodId);
  const pos = screenPos ?? { x: (innerWidth || 390) / 2, y: (innerHeight || 844) / 2 };

  if (!r.ok) {
    if (r.reason === 'full') {
      // refuse: head shake + refuse clip + flat mouth (§C3)
      audio.play('gooby.refuse');
      gooby?.play('refuse').then(() => restoreEmotion(s));
      ui.toast('toast.foodRefused');
    }
    return;
  }

  store.update((st) => {
    st.stats = r.stats;
    st.inventory = r.inventory;
    st.xp = r.xp;
    st.level = r.level;
    st.coins += r.coinsAwarded;
    st.achievements.counters.feeds = (st.achievements.counters.feeds ?? 0) + 1;
  });

  audio.play(r.favorite ? 'gooby.squeakHappy' : 'eat.chomp');
  floatText(s, `+${r.hungerDelta}`, pos.x, pos.y - 40);
  if (gooby) {
    // eat clip: mouth opens → 6 chews (crumbs via clip events when the gooby
    // rig owns a particles handle) → swallow (§D2.4)
    gooby.play('eat').then(() => {
      if (r.favorite) {
        gooby.play('happyBounce');
        const head = mouthWorld(s);
        if (s.particles && head) s.particles.emit('hearts', head, { count: 5 });
      }
      restoreEmotion(s);
    });
    const head = mouthWorld(s);
    if (s.particles && head) laterTimer(s, () => s.particles.emit('crumbs', head), 450);
  }
}

// ---------------------------------------------------------------------------
// wash flow (§C3): hop into tub → soap scrub coverage → shower rinse
// ---------------------------------------------------------------------------

function startWash(s) {
  if (s.washing || !s.gooby || !s.THREE || typeof document === 'undefined') {
    if (!s.gooby || !s.THREE) console.warn('[interactions] wash unavailable (no gooby/three yet)');
    return;
  }
  const tub = anchorPos(s, 'bathtub');
  s.audio.play('ui.tap');

  const wash = { coverage: 0, els: [], returnPos: s.gooby.group.position.clone(), scrubPt: null };
  s.washing = wash;

  // Gooby hops into the tub (§C3)
  if (tub) {
    moveGooby(s, tub, 0.55, 'jump');
  }

  // overlay: suds meter, hint, shower button, cancel, draggable soap
  const overlay = document.createElement('div');
  overlay.className = 'g5-wash';
  overlay.innerHTML = `
    <div class="g5-wash-meter">🫧 <span class="g5-suds-label"></span>
      <span class="g5-wash-track"><span class="g5-wash-fill"></span></span></div>
    <div class="g5-wash-hint">${t('wash.hint')}</div>`;
  const rinseBtn = document.createElement('button');
  rinseBtn.className = 'btn btn-teal g5-shower-btn';
  rinseBtn.innerHTML = `${SHOWER_ICON} ${t('wash.rinse')}`;
  rinseBtn.addEventListener('click', () => rinse(s));
  overlay.appendChild(rinseBtn);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost btn-round g5-wash-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', t('ui.close'));
  closeBtn.addEventListener('click', () => endWash(s, {}));
  overlay.appendChild(closeBtn);
  (core?.ui ?? s.ui).el.appendChild(overlay);

  const soap = document.createElement('div');
  soap.className = 'g5-soap';
  soap.innerHTML = SOAP_SVG;
  soap.style.left = '50%';
  soap.style.bottom = 'calc(120px + var(--safe-bottom, 0px))';
  soap.style.top = 'auto';
  soap.style.transform = 'translateX(-50%)';
  document.body.appendChild(soap);

  wash.els.push(overlay, soap);
  wash.meterFill = overlay.querySelector('.g5-wash-fill');
  wash.meterLabel = overlay.querySelector('.g5-suds-label');
  updateSudsMeter(s);

  // soap drag: DOM pointer capture; scrub = drag distance over Gooby
  let lastPt = null;
  soap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    soap.setPointerCapture?.(e.pointerId);
    soap.style.transform = 'translate(-50%,-50%)';
    lastPt = { x: e.clientX, y: e.clientY };
    moveSoap(e);
  });
  soap.addEventListener('pointermove', (e) => {
    if (!lastPt || !s.washing) return;
    moveSoap(e);
    const hit = pickGooby(s, e.clientX, e.clientY);
    const dist = Math.hypot(e.clientX - lastPt.x, e.clientY - lastPt.y);
    lastPt = { x: e.clientX, y: e.clientY };
    if (hit && dist > 0) {
      const before = wash.coverage;
      wash.coverage = accumulateCoverage(wash.coverage, dist);
      wash.scrubPt = hit.point;
      updateSudsMeter(s);
      // suds grow with coverage (§C3): more/larger bubble puffs as it climbs
      if (s.particles && Math.floor(before * 30) !== Math.floor(wash.coverage * 30)) {
        s.particles.emit('bubbles', hit.point, { count: 2 + Math.round(wash.coverage * 5) });
        audioOnce(s, 'wash.scrub');
      }
      s.gooby.lookAt(hit.point);
    }
  });
  const release = () => {
    lastPt = null;
    s.gooby?.lookAt(null);
  };
  soap.addEventListener('pointerup', release);
  soap.addEventListener('pointercancel', release);
}

function moveSoap(e) {
  const soap = e.currentTarget;
  soap.style.left = `${e.clientX}px`;
  soap.style.top = `${e.clientY}px`;
  soap.style.bottom = 'auto';
}

function updateSudsMeter(s) {
  const w = s.washing;
  if (!w?.meterFill) return;
  const pct = Math.round(w.coverage * 100);
  w.meterFill.style.width = `${pct}%`;
  w.meterLabel.textContent = t('wash.suds', { pct });
}

/** Tap the shower head → rinse splash → hygiene formula (§C3). */
function rinse(s) {
  const w = s.washing;
  if (!w) return;
  const coverage = w.coverage;
  const { store, ui, audio, gooby } = s;

  audio.play('wash.splash');
  const r = washRinse(
    { stats: store.get('stats'), xp: store.get('xp'), level: store.get('level') },
    coverage
  );
  store.update((st) => {
    st.stats = r.stats;
    st.xp = r.xp;
    st.level = r.level;
    st.coins += r.coinsAwarded;
    st.achievements.counters.washes = (st.achievements.counters.washes ?? 0) + 1;
  });

  // rinse splash + sparkle finish (§C3)
  const at = mouthWorld(s) ?? gooby.group.position;
  if (s.particles) {
    s.particles.emit('bubbles', at, { count: 12 });
    laterTimer(s, () => s.particles.emit('sparkles', at, { count: 10 }), 350);
  }
  if (r.full) ui.toast('toast.washDone');

  // wet-ears look for 20 s (§C3)
  gooby.setWet(true);
  laterTimer(s, () => s.gooby?.setWet(false), CARE_TUNING.WASH_WET_SEC * 1000);
  gooby.play('happyBounce').then(() => restoreEmotion(s));

  endWash(s, {});
}

function endWash(s, { silent } = {}) {
  const w = s?.washing;
  if (!w) return;
  s.washing = null;
  for (const el of w.els) el.remove();
  if (!silent && w.returnPos && s.gooby) {
    moveGooby(s, w.returnPos, 0.5, 'jump');
  }
}

// ---------------------------------------------------------------------------
// toilet gag (§C2/§C3)
// ---------------------------------------------------------------------------

function useToilet(s) {
  const { store, ui, audio } = s;
  const verdict = canUseToilet(
    { hygiene: store.get('stats.hygiene'), lastAt: store.get('care.toiletAt') ?? 0 },
    now()
  );
  if (verdict === 'noNeed') {
    ui.toast('toast.toiletNoNeed');
    return;
  }
  if (verdict === 'cooldown') {
    ui.toast('toast.toiletCooldown');
    return;
  }
  audio.play('toilet.flush');
  store.update((st) => {
    st.stats.hygiene = clampStat(st.stats.hygiene + INTERACT.TOILET_HYGIENE_GAIN);
    st.care = st.care ?? {};
    st.care.toiletAt = now(); // persisted cooldown timestamp (§C3)
  });
  const at = s.THREE ? anchorPos(s, 'toilet') : null;
  if (s.particles && at) s.particles.emit('sparkles', at.setY(at.y + 0.5), { count: 6 });
  s.gooby?.play('happyBounce').then(() => restoreEmotion(s));
}

// ---------------------------------------------------------------------------
// ball toss (§C3): flick → ballistic bounce → Gooby fetches → headbutt back
// ---------------------------------------------------------------------------

function setupBall(s) {
  if (!s.THREE || !s.scene?.add || !s.roomManager || s.disposed) return;
  const spawn = anchorPos(s, 'ballSpawn');
  if (!spawn) return; // no living-room ball anchor — skip quietly
  const THREE = s.THREE;
  const B = CARE_TUNING.BALL;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(B.RADIUS, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xff8c42, roughness: 0.55 })
  );
  mesh.name = 'careBall';
  mesh.position.copy(spawn).setY(spawn.y + B.RADIUS);
  s.scene.add(mesh);

  const ball = {
    mesh,
    spawn,
    pos: { x: 0, y: B.RADIUS, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    moving: false,
    grabbing: false,
    cooldownUntil: 0,
    fetching: false,
  };
  s.ball = ball;

  // flick: dragstart near the ball arms the flick; dragend launches it
  if (s.input && s.camera) {
    const armFlick = (p) => {
      if (s.disposed || s.washing || s.feeding || !inLivingRoom(s)) return;
      const w = typeof innerWidth !== 'undefined' ? innerWidth : 390;
      const h = typeof innerHeight !== 'undefined' ? innerHeight : 844;
      s._ray = s._ray ?? new THREE.Raycaster();
      s._ndc = s._ndc ?? new THREE.Vector2();
      s._ndc.set((p.x / w) * 2 - 1, -(p.y / h) * 2 + 1);
      s._ray.setFromCamera(s._ndc, s.camera);
      const distToBall = s._ray.ray.distanceToPoint(mesh.position);
      if (distToBall < 0.35) ball.grabbing = true;
    };
    const launch = (p) => {
      if (!ball.grabbing) return;
      ball.grabbing = false;
      if (ball.fetching) return;
      const v = flickToVelocity({ vx: p.vx ?? 0, vy: p.vy ?? 0 });
      ball.vel = { ...v };
      ball.moving = true;
      s.audio.play('ball.throw');
      s.gooby?.lookAt(mesh.position);
    };
    s.subs.push(s.input.on('dragstart', armFlick));
    s.subs.push(s.input.on('dragend', launch));
  }

  // physics + fetch loop
  let lastT = performance.now();
  const tick = (tMs) => {
    if (s.disposed) return;
    s.raf = requestAnimationFrame(tick);
    const dt = Math.min((tMs - lastT) / 1000, 0.08);
    lastT = tMs;
    if (!ball.moving) return;
    const { bounced, resting } = stepBall(ball, dt);
    mesh.position.set(spawn.x + ball.pos.x, spawn.y + ball.pos.y, spawn.z + ball.pos.z);
    mesh.rotation.x += ball.vel.z * dt * 6;
    mesh.rotation.z -= ball.vel.x * dt * 6;
    if (bounced) s.audio.play('ball.bounce');
    if (resting) {
      ball.moving = false;
      maybeFetch(s, ball);
    }
  };
  s.raf = requestAnimationFrame(tick);
}

function inLivingRoom(s) {
  // roomManager exposes the active room id via the activeRoom() METHOD (§C2 —
  // see roomManager.js JSDoc); guard the call so a missing manager stays
  // permissive (dev harness / degraded wiring).
  const room = typeof s.roomManager?.activeRoom === 'function' ? s.roomManager.activeRoom() : null;
  return room == null || room === 'living';
}

/** Gooby chases the resting ball, headbutts it back, +3 fun, 15 s cooldown (§C3). */
function maybeFetch(s, ball) {
  if (s.disposed || !s.gooby || s.goobyBusy || ball.fetching) return;
  if (now() < ball.cooldownUntil) return;
  const target = ball.mesh.position;
  const from = s.gooby.group.position;
  const dist = Math.hypot(target.x - from.x, target.z - from.z);
  if (dist < 0.05 || dist > CARE_TUNING.CHASE_MAX_DIST) return;

  ball.fetching = true;
  const stopAt = new s.THREE.Vector3().lerpVectors(from, target, Math.max(0, 1 - 0.28 / dist));
  s.gooby.lookAt(target);
  s.gooby.play('happyBounce', { loop: true });
  moveGooby(s, stopAt, Math.max(0.4, dist / 2.2), null, () => {
    if (s.disposed) return;
    s.gooby.stop('happyBounce');
    // headbutt: poke-wobble toward the ball, ball bounces back toward the spawn
    const dx = target.x - s.gooby.group.position.x;
    s.gooby.play('pokeWobble', { dir: { x: dx * 4, z: 1 } });
    s.audio.play('ball.bounce');
    const back = flickToVelocity({ vx: -ball.pos.x * 260, vy: -640 });
    ball.vel = { ...back };
    ball.moving = true;
    s.store.update((st) => {
      st.stats.fun = clampStat(st.stats.fun + INTERACT.BALL_FUN);
    });
    if (s.particles) s.particles.emit('hearts', target, { count: 3 });
    ball.cooldownUntil = now() + INTERACT.BALL_COOLDOWN_SEC * 1000;
    // hop back home
    const home = anchorPos(s, 'goobyIdle');
    laterTimer(s, () => {
      ball.fetching = false;
      s.gooby?.lookAt(null);
      if (home) moveGooby(s, home, 0.6, 'jump');
    }, 650);
  });
}

/** Tween Gooby's group to a world position (uses gfx/tween via dynamic import). */
function moveGooby(s, worldPos, seconds, clip, onDone) {
  if (!s.gooby) return;
  s.goobyBusy = true;
  if (clip) s.gooby.play(clip);
  const run = ({ tween, easings }) => {
    if (s.disposed) return;
    const from = s.gooby.group.position.clone();
    tween({
      duration: seconds,
      ease: easings.easeInOutQuad,
      onUpdate: (v) => {
        if (s.disposed || !s.gooby) return;
        s.gooby.group.position.set(
          from.x + (worldPos.x - from.x) * v,
          from.y + (worldPos.y - from.y) * v,
          from.z + (worldPos.z - from.z) * v
        );
      },
      onComplete: () => {
        s.goobyBusy = false;
        onDone?.();
      },
    });
  };
  // Use the preloaded module when available — a dynamic import mid-gesture can
  // stall under throttled/virtual-time tabs and leave the hop hanging.
  if (s.tweenMod) {
    run(s.tweenMod);
    return;
  }
  import('../gfx/tween.js')
    .then((mod) => {
      s.tweenMod = mod;
      run(mod);
    })
    .catch(() => {
      s.gooby.group.position.copy(worldPos);
      s.goobyBusy = false;
      onDone?.();
    });
}

// ---------------------------------------------------------------------------
// dev demo params (?care=…, dev builds only — headless screenshot surface)
// ---------------------------------------------------------------------------

function runDevDemos(s) {
  const q = new URLSearchParams(location.search);
  const care = q.get('care');
  if (!care) return;
  if (care === 'tray') {
    laterTimer(s, () => s.ui.openPanel('foodTray'), 400);
  } else if (care === 'wash') {
    let tries = 0;
    const tryWash = () => {
      // three.js / gooby / tween arrive async — retry until startWash can run
      // and the hop into the tub can start synchronously
      if (!s.THREE || !s.gooby || !s.tweenMod) {
        if ((tries += 1) < 60) laterTimer(s, tryWash, 250);
        return;
      }
      startWash(s);
      const suds = Number(q.get('suds'));
      if (s.washing && Number.isFinite(suds)) {
        s.washing.coverage = Math.min(1, Math.max(0, suds / 100));
        updateSudsMeter(s);
        // visible mid-wash suds cloud: keep emitting while the wash overlay is
        // up so headless shots (virtual-time fast-forward) still catch bubbles
        const emitSuds = () => {
          if (!s.washing || s.disposed) return;
          laterTimer(s, emitSuds, 180);
          if (s.goobyBusy) return; // wait until the hop into the tub lands
          const at = s.gooby && s.THREE ? mouthWorld(s) : null;
          if (s.particles && at) {
            for (let i = 0; i < 3; i += 1) {
              const jitter = at.clone();
              jitter.x += (Math.random() - 0.5) * 0.6;
              jitter.y += (Math.random() - 0.75) * 0.5;
              s.particles.emit('bubbles', jitter, { count: 5 });
            }
          }
        };
        emitSuds();
      }
    };
    laterTimer(s, tryWash, 700);
  } else if (care.startsWith('feed:')) {
    const foodId = care.slice(5);
    // ?feedAt=<ms> delays the demo feed (headless shots: land it just before
    // the virtual-time budget expires so the float text is still visible);
    // ?feedN=<n> feeds n items back to back (inventory permitting)
    const feedAt = Number(q.get('feedAt')) || 900;
    let feedN = Math.max(1, Number(q.get('feedN')) || 1);
    let feedTries = 0;
    const tryFeed = () => {
      if (!s.THREE || !s.gooby) {
        if ((feedTries += 1) < 60) laterTimer(s, tryFeed, 250);
        return;
      }
      const m = mouthWorld(s);
      performFeed(s, foodId, m && s.camera ? worldToScreen(s, m) : undefined);
      if ((feedN -= 1) > 0) laterTimer(s, tryFeed, 350);
    };
    laterTimer(s, tryFeed, feedAt);
  }
}
