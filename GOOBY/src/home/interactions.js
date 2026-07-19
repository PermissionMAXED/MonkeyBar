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

import { INTERACT, XP, CARE_TUNING, COLLECTIONS, LEVELING, ITEM_PRICES, STATS } from '../data/constants.js';
import { getFood } from '../data/foods.js';
import { applyDeltas, clampStat } from '../systems/stats.js';
import { currentMood } from '../systems/sleep.js';
import { bandAt } from '../systems/dayNight.js';
import { remove as invRemove, list as invList } from '../systems/inventory.js';
import { applyXp } from '../systems/leveling.js';
import { deriveEmotion } from '../character/emotions.js';
import { t } from '../data/strings.js';
import { now, localDay } from '../core/clock.js';
// V2/G20: pet-sim engines feeding the care pipeline (all pure modules)
import { onEat as healthOnEat, tick as healthTick, HEALTH } from '../systems/health.js';
import { onEat as weightOnEat, onBallFetch as weightOnBallFetch, tierOf } from '../systems/weight.js';
import { award as collectionsAward } from '../systems/collections.js';
import { useMedicine as economyUseMedicine, buyItem as economyBuyItem } from '../systems/economy.js';
// V3/G35: Nougatschleuse pure logic (§B7/§C6.4 — cooldown/effects/refusals)
import { canGlob as nougatCanGlob, applyGlob as nougatApplyGlob, NOUGAT } from '../systems/nougat.logic.js';

// ===========================================================================
// 1. PURE LOGIC (unit-tested — no three.js/DOM imports above this line either)
// ===========================================================================

/**
 * @typedef {'head'|'belly'|'feet'|null} Region
 * @typedef {{type: 'pet'}|{type: 'tickle'}} StrokeEvent
 */

// ============================================================================
// V3/G35 (§C12.2 belly-rub fix, §E0.1-14 gesture-consts ruling): the tickle
// detector's thresholds are viewport-normalized module-local frozen consts —
// they SUPERSEDE the legacy raw-px CARE_TUNING.TICKLE_MIN_DX_PX in
// data/constants.js (left in place per the freeze; no longer read here).
// Root causes fixed:
//  1. per-sample |dx| >= 3 px gating dropped slow-device / small-screen rubs
//     (a 2 px-per-sample rub never registered) → reversals now count on
//     ACCUMULATED swing distance >= 3.5 % of the canvas width;
//  2. x-axis-only sign flips missed circular strokes → reversals count on the
//     DOMINANT axis (x or y) of the current swing, window unchanged;
//  3. any raycast dropout (gaps between meshes, blob-shadow hits at weight-
//     tier extremes) nulled the region and hard-reset the stroke → a short
//     region grace keeps the last hit region alive across dropouts.
// ============================================================================
export const GESTURE_TUNING_V3 = Object.freeze({
  /** Min accumulated swing along the dominant axis before a reversal counts,
   * as a fraction of the canvas width (§C12.2: ~3.5 %). */
  TICKLE_MIN_SWING_FRAC: 0.035,
  /** Fallback viewport width when none is injected (tests / SSR safety). */
  DEFAULT_VIEWPORT_W: 390,
  /** Region dropout grace (ms): momentary raycast misses inside a stroke
   * keep the last region instead of resetting pet/tickle state. */
  REGION_GRACE_MS: 220,
});

/**
 * Gesture classifier for pet / tickle / poke on Gooby's regions (§C3).
 * Feed it the input drag stream (§E5) plus the raycast region per sample;
 * time is injected (ms) so the classifier is fully deterministic in tests.
 *
 * - pet: slow drag over the body — velocity < 600 px/s sustained ≥ 400 ms
 *   → one {type:'pet'} per 400 ms window (+1 fun/stroke).
 * - tickle: fast belly rubs — ≥ 3 dominant-axis direction changes within
 *   900 ms on the belly, each swing ≥ 3.5 % of the canvas width
 *   → {type:'tickle'} (+2 fun). (V3/G35 §C12.2 — was x-only + raw 3 px.)
 * - poke: tap on the body → 'poke'; 5 pokes within 3 s → 'dizzy' (§C3).
 *
 * @param {{viewportW?: number|(() => number)}} [opts] canvas CSS width used to
 *   normalize the tickle swing threshold (§C12.2); a getter keeps it live
 *   across resizes. Defaults to innerWidth (browser) / 390 (tests).
 * @returns {{
 *   dragStart: (s: {t: number, x: number, y: number, region: Region}) => void,
 *   dragMove: (s: {t: number, x: number, y: number, region: Region}) => StrokeEvent[],
 *   dragEnd: () => void,
 *   tap: (s: {t: number, region: Region}) => ('poke'|'dizzy'|null),
 *   debug: () => {region: Region, dx: number, speed: number, reversals: number,
 *     swingX: number, swingY: number, petMs: number},
 * }}
 */
export function createCareGestures(opts = {}) {
  const viewportW = () => {
    const v = typeof opts.viewportW === 'function' ? opts.viewportW() : opts.viewportW;
    if (Number.isFinite(v) && v > 0) return v;
    return typeof innerWidth !== 'undefined' && innerWidth > 0
      ? innerWidth
      : GESTURE_TUNING_V3.DEFAULT_VIEWPORT_W;
  };

  /** @type {{t: number, x: number, y: number}|null} */
  let last = null;
  let petMs = 0;
  /** @type {number[]} timestamps of belly dominant-axis reversals */
  let dirChanges = [];
  /** accumulated swing since the last reversal (V3/G35 §C12.2) */
  let swingX = 0;
  let swingY = 0;
  /** region grace memory (V3/G35 §C12.2) */
  let lastRegion = /** @type {Region} */ (null);
  let lastRegionT = -Infinity;
  /** last on-belly sample time — bridges brief boundary clips (§C12.2) */
  let lastBellyT = -Infinity;
  /** @type {number[]} poke timestamps */
  let pokes = [];
  /** last-sample debug snapshot for the ?petdebug=1 overlay (§C12.2) */
  let dbg = { region: null, dx: 0, speed: 0, reversals: 0, swingX: 0, swingY: 0, petMs: 0 };

  function resetStroke() {
    last = null;
    petMs = 0;
    dirChanges = [];
    swingX = 0;
    swingY = 0;
    lastRegion = null;
    lastRegionT = -Infinity;
    lastBellyT = -Infinity;
  }

  return {
    dragStart(s) {
      resetStroke();
      last = { t: s.t, x: s.x, y: s.y };
      if (s.region != null) {
        lastRegion = s.region;
        lastRegionT = s.t;
      }
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
      const dy = s.y - last.y;
      const dist = Math.hypot(dx, dy);
      const speed = (dist / dt) * 1000; // px/s

      // --- V3/G35 (§C12.2): region grace across momentary raycast dropouts ---
      let region = s.region;
      if (region != null) {
        lastRegion = region;
        lastRegionT = s.t;
      } else if (lastRegion != null && s.t - lastRegionT <= GESTURE_TUNING_V3.REGION_GRACE_MS) {
        region = lastRegion;
      }

      if (region != null) {
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
        // --- tickle: belly rubs, ≥3 DOMINANT-AXIS reversals < 900 ms, each
        // swing ≥ 3.5 % of the canvas width (V3/G35 §C12.2 fix spec).
        // Belly membership gets the SAME grace as raycast dropouts: wide
        // swings clip the neighbouring region (body top edge = 'head') at
        // their extremes for a sample or two — that must not reset the
        // stroke, while rubs that LIVE on head/feet still never tickle
        // (they have no belly sample inside the grace window). ---
        if (region === 'belly') lastBellyT = s.t;
        if (s.t - lastBellyT <= GESTURE_TUNING_V3.REGION_GRACE_MS) {
          const minSwing = viewportW() * GESTURE_TUNING_V3.TICKLE_MIN_SWING_FRAC;
          const axisIsX = Math.abs(swingX) >= Math.abs(swingY);
          const swingA = axisIsX ? swingX : swingY;
          const dA = axisIsX ? dx : dy;
          if (Math.abs(swingA) >= minSwing && dA !== 0 && Math.sign(dA) !== Math.sign(swingA)) {
            // direction reversed on the stroke's dominant axis → count it and
            // start the next swing from this sample's delta
            dirChanges.push(s.t);
            dirChanges = dirChanges.filter((ts) => s.t - ts < INTERACT.TICKLE_WINDOW_MS);
            swingX = dx;
            swingY = dy;
            if (dirChanges.length >= INTERACT.TICKLE_DIR_CHANGES) {
              dirChanges = [];
              petMs = 0;
              events.push({ type: 'tickle' });
            }
          } else {
            swingX += dx;
            swingY += dy;
          }
        } else {
          dirChanges = [];
          swingX = 0;
          swingY = 0;
        }
      } else {
        petMs = 0;
        dirChanges = [];
        swingX = 0;
        swingY = 0;
      }

      dbg = { region, dx, speed: Math.round(speed), reversals: dirChanges.length, swingX, swingY, petMs };
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

    /** V3/G35 (§C12.2): last-sample debug data for the ?petdebug=1 overlay. */
    debug() {
      return dbg;
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
 * V2/G20 (§C3.4): while `slice.health === 'sick'` junk food is refused
 * (reason 'sick') — sick Gooby only accepts healthy food. The health/weight
 * slice effects themselves (health.onEat/weight.onEat, §B5) are applied by
 * the wiring (performFeed), not here — this stays a stats/inventory/XP pure fn.
 *
 * @param {{stats: object, inventory: object, xp: number, level: number,
 *   health?: 'healthy'|'queasy'|'sick'}} slice
 * @param {string} foodId catalog id (data/foods.js)
 * @returns {{ok: false, reason: 'unknown'|'full'|'none'|'sick'} | {
 *   ok: true, stats: object, inventory: object, xp: number, level: number,
 *   levelsGained: number, coinsAwarded: number, hungerDelta: number, favorite: boolean,
 *   junk: boolean
 * }}
 */
export function feedGooby(slice, foodId) {
  const food = getFood(foodId);
  if (!food) return { ok: false, reason: 'unknown' };
  if (food.junk && slice.health === 'sick') return { ok: false, reason: 'sick' }; // V2/G20 (§C3.4)
  if (slice.stats.hunger >= INTERACT.FEED_REFUSE_AT_HUNGER) return { ok: false, reason: 'full' };
  const inventory = invRemove(slice.inventory, foodId);
  if (inventory == null) return { ok: false, reason: 'none' };
  const stats = applyDeltas(slice.stats, food.deltas);
  const prog = applyXp({ xp: slice.xp, level: slice.level }, XP.FEED, 'feed'); // V4/G56: xpGranted source tag (§C-SYS3.1 #2)
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
    junk: food.junk === true, // V2/G20
  };
}

/**
 * V2/G20: junkScore → tray belly-icon band (§C7: green/yellow/orange —
 * informed players, no nagging). Bands follow the §B5 thresholds: below the
 * WARN line (4) all is well, from WARN to the sick line (8) it's a warning,
 * at/above the sick line it's high. Pure.
 * @param {number} junkScore
 * @returns {'ok'|'warn'|'high'}
 */
export function junkScoreBand(junkScore) {
  const v = Number(junkScore) || 0;
  if (v >= HEALTH.SICK_JUNK) return 'high';
  if (v >= HEALTH.WARN_JUNK) return 'warn';
  return 'ok';
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
  const prog = applyXp({ xp: slice.xp, level: slice.level }, full ? XP.FULL_WASH : 0, 'wash'); // V4/G56: xpGranted source tag (§C-SYS3.1 #3 — partial wash grants 0 → no emit)
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

/**
 * V2/FIX-C P1-2: Gooby's ambient face from the FULL emotion-machine input set
 * (mood + stats + health + night), matching homeScene's machine inputs.
 * restoreEmotion() previously derived from {mood, stats} only, so any care
 * interaction (pet/tickle/feed/wash) durably bypassed the §C3.4 sick mood
 * cap 39 — one pet made sick Gooby ecstatic. Pure: state + time in,
 * emotion id out.
 * @param {object} state full store snapshot
 * @param {number} atMs epoch ms (callers pass clock.now())
 * @returns {string} emotion id (EMOTION_IDS)
 */
export function careEmotionFor(state, atMs) {
  return deriveEmotion({
    // currentMood applies the §C1.4 early-wake grumpy debuff + clamping
    mood: currentMood(state, atMs),
    stats: state.stats,
    health: state.health?.state ?? null,
    // §C10.3 night bias counts only while actually awake (mirrors
    // homeScene.isNightAwake: night band + not in sleep mode)
    night: bandAt(atMs).band === 'night' && !state.sleep?.sleeping,
  });
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
  // V2/G20: §C7 catalog additions
  radish: '🍠', tomato: '🍅', corn: '🌽', eggplant: '🍆', pumpkin: '🎃',
  strawberry: '🍓', grapes: '🍇', croissant: '🥐', lollypop: '🍭',
  cookie: '🍪', chocolate: '🍫', 'candy-bar': '🍬', muffin: '🥮',
  fries: '🍟', 'corn-dog': '🍢', sundae: '🍨',
  nutella: '🫙', // V3/G35 (§C6.1): jar glyph — SVG icon treatment in icons.js
};

/** V2/G20: junkScore band → belly icon fill (§C7 green/yellow/orange). */
const BELLY_BAND_COLOR = { ok: '#8BC98A', warn: '#F2C14E', high: '#F28C4E' };

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
/* V2/G20: junk badge + belly band + Care row (§C7/§C3.5) */
.tray-junk{position:absolute;top:4px;left:6px;font-size:13px;pointer-events:none;}
.tray-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.g20-belly{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--brown,#4A3B36);opacity:.8;}
.g20-belly svg{display:block;}
.tray-care-title{margin:14px 0 0;font-size:15px;font-weight:800;color:var(--brown,#4A3B36);opacity:.8;}
.tray-care-row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:8px;}
.tray-care-item{display:flex;flex-direction:column;align-items:center;gap:4px;background:var(--bg-cream,#FFF6EC);border-radius:16px;padding:10px 4px 8px;border:2px dashed rgba(74,59,54,.18);font-family:inherit;user-select:none;-webkit-user-select:none;touch-action:none;position:relative;}
.tray-care-item.g20-drag{cursor:grab;}
.tray-care-item:active{transform:scale(.97);}
.tray-care-buy{font-size:11px;font-weight:800;border:none;border-radius:999px;padding:3px 10px;background:var(--teal,#59C9B9);color:#fff;font-family:inherit;cursor:pointer;position:relative;}
/* V2/FIX-C P2-6: invisible ::before halo gives the compact chip a >=44px
   effective hit area (the only purchase affordance in the tray). Pointer
   events on the halo target the button itself; the medicine-drag handler
   already ignores events from .tray-care-buy. */
.tray-care-buy::before{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:max(100%,64px);height:44px;border-radius:999px;}
.tray-care-buy:disabled{opacity:.45;}
.tray-care-hint{font-size:10px;font-weight:700;opacity:.55;}
/* ── V4/G70 sick discoverability block (owned): subtle medicine pulse only. */
.tray-care-item.g70-sick-medicine{outline:0.1875rem solid rgba(255,123,169,.72);outline-offset:0.125rem;animation:g70-medicine-pulse 1.8s ease-in-out infinite;}
@keyframes g70-medicine-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,123,169,0)}50%{box-shadow:0 0 0 .4375rem rgba(255,123,169,.18)}}
/* ── end V4/G70 block. */
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
  const [{ createHud }, { createArcadeScreen }, { createCareSheetPanel }] = await Promise.all([
    import('../ui/hud.js'),
    import('../ui/arcadeScreen.js'),
    import('../ui/careSheet.js'), // V2/G20 (§C3.4)
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
  // V2/G20: care sheet (§C3.4) — panel id 'careSheet' is the contract G23's
  // HUD 🤒 chip opens. Its medicine action reuses the shared grimace-then-
  // relief flow; without a live home scene it degrades to toasts only.
  ui.registerPanel('careSheet', createCareSheetPanel({
    store,
    ui,
    audio,
    useMedicine: () =>
      performMedicine(
        active ?? { store, ui, audio, gooby: null, particles: null, disposed: false, timers: [] }
      ),
  }));
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
    // V3/G35 (§C12.2): live canvas width normalizes the tickle swing threshold
    gestures: createCareGestures({
      viewportW: () => (typeof innerWidth !== 'undefined' ? innerWidth : 0),
    }),
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
    // V3/G35 (§C6.4): Nougatschleuse sequence lock + install sparkle + smears
    nougatSeq: false,
    nougatSparkle: false,
    messyFace: null, // { meshes, base, smear, timer }
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

  // ---- V3/G35 (§B7/§C6.4): Nougatschleuse tap → refusals or glob sequence --
  subscribeRoom(state, 'tap:nougatschleuse', () => nougatTap(state));
  // §C6.3: one-time install sparkle on the next kitchen look (buying happens
  // on the shop screen — the machine mounts while the kitchen is offscreen)
  if (typeof store.on === 'function') {
    state.subs.push(
      store.on('nougatChanged', (p) => {
        if (p?.installed) state.nougatSparkle = true;
      })
    );
  }
  subscribeRoom(state, 'roomChanged', (p) => {
    if (p?.roomId !== 'kitchen' || !state.nougatSparkle) return;
    state.nougatSparkle = false;
    laterTimer(state, () => {
      const at = anchorPos(state, 'nougat');
      if (state.particles && at) state.particles.emit('sparkles', at, { count: 14 });
    }, 500); // let the room pan settle first
  });
  // ---- end V3/G35 block ----

  // --- pet / tickle / poke gestures on Gooby (input §E5 + regionAt §D2.3) ---
  if (input && gooby && state.camera) {
    wireGestures(state);
  } else if (!gooby) {
    console.warn('[interactions] no gooby handle — gestures inactive');
  } else if (!state.camera) {
    console.warn('[interactions] no camera found — gestures inactive');
  }

  // --- V2/G20: pet-sim visuals — store → Gooby rig (§C3.3/§C3.4/§C4.3) ---
  if (gooby) {
    gooby.setWeightTier?.(tierOf(store.get('weight.value')));
    gooby.setHealth?.(store.get('health.state'));
    state.subs.push(store.on('weightChanged', (w) => gooby.setWeightTier?.(tierOf(w?.value))));
    state.subs.push(store.on('healthChanged', (h) => gooby.setHealth?.(h?.state)));
    // §C3.3/§C3.4 sneeze squeak: the rig fires onSneeze at the "choo!" snap.
    gooby.onSneeze = () => {
      if (!state.disposed) audio.play('health.sneeze');
    };
    state.subs.push(() => {
      gooby.onSneeze = null;
    });
  }
  // Health tick events (timeEngine re-emits them as the runtime-only store
  // event 'healthEvent') → §C3.2 warning ramp toasts + transition toasts.
  state.subs.push(store.on('healthEvent', (ev) => onHealthEvent(state, ev)));

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
  clearMessyFace(s); // V3/G35: restore the cheek material swap
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
  // V3/G35 (§C12.2 region mapping): take the FIRST hit that maps to a touch
  // region instead of hits[0] blindly — the blob shadow / outfit props are
  // children of the same group with no region, and at weight-tier extremes
  // (§C4.3 body X/Z morphs) they intercepted rays over the visually wider
  // belly, nulling the region mid-stroke.
  for (const hit of hits) {
    const region = s.gooby.regionAt(hit);
    if (region) return { region, point: hit.point };
  }
  return null;
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

/** Restore Gooby's default emotion from the full input set (§D2.5, §C3.4). */
function restoreEmotion(s) {
  if (!s.gooby || s.disposed) return;
  // V2/FIX-C P1-2: careEmotionFor includes health (sick cap 39) + night bias.
  s.gooby.setEmotion(careEmotionFor(s.store.get(), now()));
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
        const prog = applyXp({ xp: st.xp, level: st.level }, gain.xp, 'pet'); // V4/G56: xpGranted source tag (§C-SYS3.1 #4 — daily cap 20 suppresses via gain.xp = 0)
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
    petdebugSample(s, events); // V3/G35 (§C12.2): ?petdebug=1 feed (dev no-op otherwise)
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
// V3/G35 (§C12.2 acceptance tooling): ?petdebug=1 overlay — dev builds only.
// Live region / dx / velocity / reversal readout over the canvas, plus a
// window.__petdebug sample log so CDP evals can dump whole runs.
// ---------------------------------------------------------------------------

function petdebugEnabled() {
  return (
    import.meta.env?.DEV &&
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('petdebug') === '1'
  );
}

/** @param {object} s wiring state @param {StrokeEvent[]} events this sample's events */
function petdebugSample(s, events) {
  if (!petdebugEnabled() || typeof document === 'undefined') return;
  const d = s.gestures.debug();
  const sample = {
    t: Math.round(performance.now()),
    region: d.region,
    dx: Math.round(d.dx * 10) / 10,
    speed: d.speed,
    reversals: d.reversals,
    events: events.map((e) => e.type),
  };
  window.__petdebug = window.__petdebug ?? [];
  window.__petdebug.push(sample);
  if (window.__petdebug.length > 5000) window.__petdebug.shift();

  if (!s.petdebugEl) {
    const el = document.createElement('div');
    el.className = 'g35-petdebug';
    el.style.cssText =
      'position:fixed;left:8px;top:calc(140px + var(--safe-top,0px));z-index:990;' +
      'background:rgba(30,24,22,.82);color:#9fe8d9;font:11px/1.5 monospace;' +
      'padding:6px 9px;border-radius:8px;pointer-events:none;white-space:pre;';
    document.body.appendChild(el);
    s.petdebugEl = el;
    s.petdebugCounts = { pet: 0, tickle: 0 };
    s.subs.push(() => {
      el.remove();
      s.petdebugEl = null;
    });
  }
  for (const e of events) s.petdebugCounts[e.type] = (s.petdebugCounts[e.type] ?? 0) + 1;
  s.petdebugEl.textContent =
    `region    ${d.region ?? '—'}\n` +
    `dx        ${sample.dx}px\n` +
    `velocity  ${d.speed}px/s\n` +
    `reversals ${d.reversals}\n` +
    `pets ${s.petdebugCounts.pet}  tickles ${s.petdebugCounts.tickle}`;
}

// ---------------------------------------------------------------------------
// feed flow (§C3): fridge → tray panel → drag to mouth → eat / refuse
// ---------------------------------------------------------------------------

/** V2/G20: tiny tummy SVG for the §C7 junkScore band icon. */
function bellyIconSvg(color) {
  return `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <ellipse cx="9" cy="9.5" rx="6.5" ry="7" fill="${color}" opacity="0.95"/>
    <ellipse cx="9" cy="11" rx="3.6" ry="4" fill="#fff" opacity="0.5"/>
  </svg>`;
}

/** ui panel module for the food tray (registered in registerCareUi). */
function createFoodTrayPanel() {
  return {
    mount(el, params = {}) {
      const store = core?.store ?? active?.store;
      const inv = store?.get('inventory') ?? {};
      const items = invList(inv);
      // V2/G20: §C7 belly junkScore band icon (green/yellow/orange, subtle)
      const band = junkScoreBand(store?.get('health.junkScore') ?? 0);
      const belly = `<span class="g20-belly" role="img" aria-label="${t(`health.junkBand.${band}`)}"
        title="${t(`health.junkBand.${band}`)}">${bellyIconSvg(BELLY_BAND_COLOR[band])}</span>`;
      el.innerHTML =
        `<div class="tray-head"><h2 class="tray-title">${t('tray.title')}</h2>${belly}</div>` +
        (items.length === 0
          ? `<div class="tray-empty">${t('tray.empty')}</div>`
          : `<div class="tray-hint">${t('tray.dragHint')}</div><div class="tray-grid"></div>`);
      const grid = el.querySelector('.tray-grid');
      for (const { id, count } of items) {
        if (!grid) break;
        const btn = document.createElement('button');
        btn.className = 'tray-item';
        // V2/G20: §C7 junk foods carry a tiny 🍬 badge
        const junkBadge = getFood(id)?.junk ? `<span class="tray-junk" title="${t('tray.junkBadge')}">🍬</span>` : '';
        btn.innerHTML = `
          ${junkBadge}<span class="tray-count">×${count}</span>
          <span class="tray-emoji">${FOOD_EMOJI[id] ?? '🍽️'}</span>
          <span class="tray-name">${t(`food.${id}`)}</span>`;
        btn.addEventListener('pointerdown', (e) => {
          if (active) startFoodDrag(active, id, e);
        });
        grid.appendChild(btn);
      }
      mountCareRow(el, store, { focusMedicine: params.focusMedicine === true }); // V2/G20 + V4/G70
    },
    unmount() {},
  };
}

/**
 * V2/G20: Care row in the fridge tray (§C3.5): medicine bottle — drag to
 * Gooby to use (economy.useMedicine), buy button when out; fertilizer — BUY
 * only (using it is the garden's watering-can-style drag, G19).
 * @param {HTMLElement} el tray panel root
 * @param {object} store
 * @param {{focusMedicine?: boolean}} [opts] V4/G70 care-sheet deep link
 */
function mountCareRow(el, store, opts = {}) {
  if (!store) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h3 class="tray-care-title">${t('tray.careTitle')}</h3><div class="tray-care-row"></div>`;
  const row = wrap.querySelector('.tray-care-row');

  const renderItem = (itemId, emoji, draggable, hint) => {
    const count = store.get(`items.${itemId}`) ?? 0;
    const item = document.createElement('div');
    const sickMedicine = itemId === 'medicine' && store.get('health.state') === 'sick';
    item.className =
      `tray-care-item${draggable && count > 0 ? ' g20-drag' : ''}` +
      `${sickMedicine ? ' g70-sick-medicine' : ''}`;
    item.dataset.careItem = itemId;
    item.innerHTML = `
      <span class="tray-count">×${count}</span>
      <span class="tray-emoji">${emoji}</span>
      <span class="tray-name">${t(`tray.${itemId}`)}</span>
      ${hint ? `<span class="tray-care-hint">${hint}</span>` : ''}
      <button class="tray-care-buy">${t('tray.buy', { price: ITEM_PRICES[itemId] })}</button>`;
    item.querySelector('.tray-care-buy').addEventListener('click', (e) => {
      e.stopPropagation();
      const r = economyBuyItem(store, itemId);
      (core?.ui ?? active?.ui)?.toast(r.ok ? 'tray.bought' : 'tray.noCoins');
      if (r.ok) (core?.audio ?? active?.audio)?.play('ui.pick');
      // re-render the row with the new count
      const parent = wrap.parentElement;
      if (parent) {
        wrap.remove();
        mountCareRow(parent, store);
      }
    });
    if (draggable && count > 0) {
      item.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.tray-care-buy')) return;
        if (active) startMedicineDrag(active, e);
      });
    }
    row.appendChild(item);
    if (itemId === 'medicine' && opts.focusMedicine) {
      item.tabIndex = -1;
      requestAnimationFrame(() => {
        item.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        item.focus?.({ preventScroll: true });
      });
    }
  };

  renderItem('medicine', '💊', true, null);
  renderItem('fertilizer', '🌱', false, t('tray.fertilizerHint'));
  el.appendChild(wrap);
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

/**
 * V2/G20: drag the medicine bottle from the tray's Care row onto Gooby
 * (§C3.5): drop near the mouth → economy.useMedicine → grimace-then-relief.
 * Mirrors startFoodDrag's DOM-ghost pattern.
 * @param {object} s wiring state
 * @param {PointerEvent} downEvent
 */
function startMedicineDrag(s, downEvent) {
  if (s.feeding || typeof document === 'undefined') return;
  downEvent.preventDefault();
  s.audio.play('ui.pick');

  const ghost = document.createElement('div');
  ghost.className = 'g5-ghost';
  ghost.textContent = '💊';
  ghost.style.left = `${downEvent.clientX}px`;
  ghost.style.top = `${downEvent.clientY}px`;
  document.body.appendChild(ghost);

  let trayClosed = false;
  const startX = downEvent.clientX;
  const startY = downEvent.clientY;

  const feeding = {
    cancel() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      ghost.remove();
      if (s.feeding === feeding) s.feeding = null;
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
      s.ui.closePanel('foodTray'); // reveal Gooby while the bottle drags
    }
    const m = mouthScreen();
    if (!m) return;
    ghost.classList.toggle(
      'g5-near',
      Math.hypot(e.clientX - m.x, e.clientY - m.y) < CARE_TUNING.FEED_NEAR_MOUTH_PX
    );
  }

  function onUp(e) {
    const m = mouthScreen();
    const d = m ? Math.hypot(e.clientX - m.x, e.clientY - m.y) : Infinity;
    feeding.cancel();
    if (m && d < CARE_TUNING.FEED_DROP_PX) performMedicine(s, m);
  }
  function onCancel() {
    feeding.cancel();
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

/**
 * V2/G20: apply one medicine at Gooby's mouth (shared by the drag flow and
 * the care sheet): economy.useMedicine + §C3.5 grimace-then-relief juice.
 * @param {object} s wiring state
 * @param {{x: number, y: number}} [screenPos]
 * @returns {boolean} whether a dose was consumed
 */
function performMedicine(s, screenPos) {
  const { store, ui, audio, gooby } = s;
  const r = economyUseMedicine(store);
  if (!r.ok) {
    ui.toast(r.reason === 'healthy' ? 'care.medicineNotNeeded' : 'care.medicineNone');
    return false;
  }
  // grimace (yuck!) … then relief (§C3.5)
  audio.play('gooby.refuse');
  ui.toast('care.medicineGiven');
  if (screenPos) floatText(s, '💊', screenPos.x, screenPos.y - 40);
  if (gooby) {
    gooby.setEmotion('grumpy');
    gooby.play('refuse').then(() => {
      if (s.disposed) return;
      audio.play('gooby.squeakHappy');
      gooby.setEmotion('happy');
      gooby.play('happyBounce').then(() => restoreEmotion(s));
      const head = mouthWorld(s);
      if (s.particles && head) s.particles.emit('hearts', head, { count: 4 });
    });
  }
  return true;
}

/**
 * V2/G20: health tick event → toast + juice (§C3.2 warning ramp + §C3.1
 * transitions). Fired via the runtime-only 'healthEvent' store event
 * (core/timeEngine.js re-emits health.tick events).
 * @param {object} s wiring state
 * @param {'tummyWarning'|'becameQueasy'|'becameSick'|'recovered'} ev
 */
function onHealthEvent(s, ev) {
  if (s.disposed) return;
  const { ui, audio, gooby } = s;
  if (ev === 'tummyWarning') {
    // §C3.2: junkScore hit 4 — toast + Gooby pats his belly (front wobble).
    ui.toast('health.tummyWarning');
    audio.play('gooby.squeak');
    gooby?.play('pokeWobble', { dir: { x: 0, z: 1 } });
  } else if (ev === 'becameQueasy') {
    ui.toast('health.becameQueasy');
    audio.play('gooby.refuse');
  } else if (ev === 'becameSick') {
    ui.toast('toast.sickNow'); // V4/G70 §C-SYS7.3: medicine + shop + vet options
    audio.play('gooby.squeakDizzy');
  } else if (ev === 'recovered') {
    ui.toast('health.recovered');
    audio.play('gooby.squeakHappy');
  }
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
    health: store.get('health.state'), // V2/G20: §C3.4 sick-junk gate
  };
  const r = feedGooby(slice, foodId);
  const pos = screenPos ?? { x: (innerWidth || 390) / 2, y: (innerHeight || 844) / 2 };

  if (!r.ok) {
    if (r.reason === 'full' || r.reason === 'sick') {
      // refuse: head shake + refuse clip + flat mouth (§C3)
      audio.play('gooby.refuse');
      gooby?.play('refuse').then(() => restoreEmotion(s));
      ui.toast(r.reason === 'sick' ? 'toast.junkRefusedSick' : 'toast.foodRefused'); // V2/G20
    }
    return;
  }

  // V2/G20: §C6 treats set — first-time sticker toast (+5 XP, §C5.2)
  const food = getFood(foodId);
  const treatSet = COLLECTIONS.SETS.find((set) => set.id === 'treats');
  const isTreat = !!treatSet?.entries?.includes(foodId);
  let firstSticker = false;
  /** @type {string[]} */
  let healthEvents = [];

  store.update((st) => {
    st.stats = r.stats;
    st.inventory = r.inventory;
    st.xp = r.xp;
    st.level = r.level;
    st.coins += r.coinsAwarded;
    st.achievements.counters.feeds = (st.achievements.counters.feeds ?? 0) + 1;
    // V2/G20: §B5 feeding effects — junk raises junkScore/weight, healthy
    // food lowers junkScore. A zero-minute health tick evaluates the state
    // transition (and the §C3.2 tummy warning) at the moment of eating, so a
    // threshold crossed by THIS bite reacts instantly instead of racing the
    // 1 s engine tick's decay.
    const lowStatCount = STATS.KEYS.filter((k) => st.stats[k] < HEALTH.NEGLECT_STAT_BELOW).length;
    const hr = healthTick(healthOnEat(st.health, food), 0, lowStatCount);
    st.health = hr.h;
    healthEvents = hr.events;
    st.weight = weightOnEat(st.weight, food);
    if (isTreat) {
      const awarded = collectionsAward(st.collections, 'treats', foodId);
      st.collections = awarded.c;
      firstSticker = awarded.first;
      if (firstSticker) {
        const prog = applyXp({ xp: st.xp, level: st.level }, LEVELING.XP_STICKER, 'sticker'); // V4/G56: xpGranted source tag (§C-SYS3.1 #10 — feed-drop first find)
        st.xp = prog.xp;
        st.level = prog.level;
        st.coins += prog.coinsAwarded;
      }
    }
  });
  for (const ev of healthEvents) store.emit?.('healthEvent', ev);
  if (firstSticker) {
    ui.toast('toast.sticker', { name: t(`food.${foodId}`), xp: LEVELING.XP_STICKER });
  }

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
  clearMessyFace(s); // V3/G35 (§C6.4): the rinse wipes the nougat cheek smears
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
// V3/G35 — Nougatschleuse use flow (§B7/§C6.4): tap → refusal checks (pure
// nougat.logic) → waddle under the spout → crank 720° → glob slides → chomp.
// The fixture mesh + its crank/glob animation live in home/nougatMesh.js and
// mount via roomManager (only when nougat.installed); this wiring drives the
// sequence through rm.getNougatFixture().userData and applies the effects
// through the pure pipes composed in systems/nougat.logic.js.
// ---------------------------------------------------------------------------

/** §C6.1/§C6.2 chocolate — the messy-face smear tint (kept in sync with nougatMesh.js). */
const NOUGAT_CHOCOLATE = '#5C3A21';

function nougatTap(s) {
  const { store, ui, audio, gooby } = s;
  if (s.washing || s.feeding || s.goobyBusy || s.nougatSeq) return;
  const fixture = s.roomManager?.getNougatFixture?.();
  if (!fixture || fixture.userData.isBusy?.()) return;

  const verdict = nougatCanGlob(
    {
      sleep: { sleeping: !!store.get('sleep.sleeping') },
      health: { state: store.get('health.state') },
      inventory: store.get('inventory') ?? {},
      nougat: store.get('nougat') ?? {},
    },
    now()
  );
  if (!verdict.ok) {
    switch (verdict.reason) {
      case 'sleeping':
        ui.toast('toast.sleeping');
        break;
      case 'sick': // the §C3.4-v2 sick refusal (same as junk food)
        audio.play('gooby.refuse');
        gooby?.play('refuse').then(() => restoreEmotion(s));
        ui.toast('toast.junkRefusedSick');
        break;
      case 'noJar':
        audio.play('ui.error');
        ui.toast('nougat.noJar'); // „Keine Nutella! Ab in den Laden"
        break;
      case 'cooldown': // Gooby pats his belly + refusal squeak (§C6.4)
        audio.play('gooby.refuse');
        gooby?.play('refuse').then(() => restoreEmotion(s));
        ui.toast('nougat.cooldown'); // „Gooby braucht eine Nougat-Pause"
        break;
      default:
        break;
    }
    return;
  }

  // ---- sequence (≈ 2.8 s): waddle 0.8 s → crank 1.2 s → glob slide 0.6 s ----
  s.nougatSeq = true;
  const mount = s.THREE ? anchorPos(s, 'nougat') : null;
  const crankAndGlob = () => {
    if (s.disposed) {
      s.nougatSeq = false;
      return;
    }
    gooby?.stop?.('happyBounce');
    const fix = s.roomManager?.getNougatFixture?.();
    if (!fix?.userData.playSequence) {
      // fixture vanished mid-waddle (room rebuild) — apply without the show
      nougatChomp(s);
      s.nougatSeq = false;
      return;
    }
    audio.play('pipe.rotate'); // crank ratchet stand-in (dedicated id → G32)
    const mouth = mouthWorld(s) ?? mount;
    fix.userData.playSequence({
      catchWorld: mouth ? { x: mouth.x, y: mouth.y, z: mouth.z } : undefined,
      onGlob: () => {
        if (!s.disposed) nougatChomp(s);
      },
      onDone: () => {
        s.nougatSeq = false;
      },
    });
    laterTimer(s, () => audio.play('delivery.drop'), 1200); // glob release plop
  };
  if (mount && gooby) {
    // waddle under the spout (§C6.4) — bouncy walk like the ball fetch
    const under = new s.THREE.Vector3(mount.x, 0, Math.max(mount.z + 0.75, -0.7));
    gooby.play('happyBounce', { loop: true });
    moveGooby(s, under, 0.8, null, crankAndGlob);
  } else {
    crankAndGlob();
  }
}

/** The catch: apply §C6.4 effects (pure nougat.logic), chomp, smears, toasts. */
function nougatChomp(s) {
  const { store, ui, audio, gooby } = s;
  const r = nougatApplyGlob(
    {
      stats: store.get('stats'),
      inventory: store.get('inventory') ?? {},
      health: store.get('health'),
      weight: store.get('weight'),
      xp: store.get('xp'),
      level: store.get('level'),
      nougat: store.get('nougat') ?? {},
      achievements: { counters: { nougatGlobs: store.get('achievements.counters.nougatGlobs') } },
    },
    now()
  );
  if (!r.ok) {
    // jar vanished mid-sequence (edge) — fail closed with the noJar toast
    ui.toast('nougat.noJar');
    return;
  }

  /** @type {string[]} */
  let healthEvents = [];
  store.update((st) => {
    st.stats = r.stats;
    st.inventory = r.inventory;
    st.xp = r.xp;
    st.level = r.level;
    st.coins += r.coinsAwarded;
    st.weight = r.weight;
    st.nougat = r.nougat; // lastGlobAt = now (30-min cooldown starts)
    st.achievements.counters.nougatGlobs = r.nougatGlobs; // → sticker nutellaGlob / nougatmeister
    // zero-minute health tick (same rationale as performFeed): a junkScore
    // threshold crossed by THIS glob reacts instantly
    const lowStatCount = STATS.KEYS.filter((k) => st.stats[k] < HEALTH.NEGLECT_STAT_BELOW).length;
    const hr = healthTick(r.health, 0, lowStatCount);
    st.health = hr.h;
    healthEvents = hr.events;
  });
  for (const ev of healthEvents) store.emit?.('healthEvent', ev);
  store.emit?.('nougatChanged', { used: true }); // §B10 (install/use)

  // juice: happy chomp + giggle (§C6.4), „−1 Nutella" toast, crumbs, float
  audio.play('eat.chomp');
  audio.play('gooby.giggle');
  ui.toast('nougat.jarUsed');
  const at = mouthWorld(s);
  if (at && s.camera) {
    const p = worldToScreen(s, at);
    floatText(s, `+${NOUGAT.STAT_DELTAS.hunger}`, p.x, p.y - 40);
  }
  if (s.particles && at) s.particles.emit('crumbs', at, { count: 6 });
  gooby?.play('eat').then(() => {
    gooby.play('happyBounce');
    restoreEmotion(s);
    // hop back to the idle spot (he waddled under the spout — and standing
    // there would shadow the machine's tap hitbox behind 'tap:gooby')
    const home = anchorPos(s, 'goobyIdle');
    if (home) laterTimer(s, () => moveGooby(s, home, 0.6, 'jump'), 400);
  });

  applyMessyFace(s); // §C6.4: brown cheek smears, 60 s or until washed
}

/**
 * Messy face (§C6.4): swap Gooby's cheek meshes onto an owned clone of their
 * material, color-lerped toward chocolate. A material SWAP (not a color write)
 * because the rig re-writes its own cheek material's color every frame for
 * the §C3.3 queasy lerp — the swap wins without touching character files.
 */
function applyMessyFace(s) {
  if (!s.gooby?.group || !s.THREE) return;
  clearMessyFace(s); // a fresh glob restarts the 60 s window
  /** @type {import('three').Mesh[]} */
  const meshes = [];
  s.gooby.group.traverse((o) => {
    if (o.name === 'cheekL' || o.name === 'cheekR') meshes.push(o);
  });
  if (meshes.length === 0 || !meshes[0].material) return;
  const base = meshes[0].material;
  const smear = base.clone();
  smear.userData.shared = false;
  smear.color.lerp(new s.THREE.Color(NOUGAT_CHOCOLATE), 0.8); // CHEEK lerp
  for (const m of meshes) m.material = smear;
  const timer = setTimeout(() => clearMessyFace(s), NOUGAT.MESSY_FACE_SEC * 1000);
  s.timers.push(timer);
  s.messyFace = { meshes, base, smear, timer };
}

/** Restore the cheeks (60 s elapsed, rinsed, or teardown). */
function clearMessyFace(s) {
  const mf = s.messyFace;
  if (!mf) return;
  s.messyFace = null;
  clearTimeout(mf.timer);
  for (const m of mf.meshes) {
    if (m.material === mf.smear) m.material = mf.base;
  }
  mf.smear.dispose?.();
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
      // V2/G20: §B5 ball fetch −0.2 weight + `balls` counter (§B2)
      st.weight = weightOnBallFetch(st.weight);
      st.achievements.counters.balls = (st.achievements.counters.balls ?? 0) + 1;
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
