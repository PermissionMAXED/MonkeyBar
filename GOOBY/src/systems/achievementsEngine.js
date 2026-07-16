// Achievements engine (§C8.3) — counter tracking, condition evaluation,
// once-only unlock detection, coin reward payout and the unlock toast+jingle.
// The pure core (progressOf/isSatisfied/applyUnlocks/countNonDefaultDecor) has
// no three.js/DOM imports (§B) and is unit-tested in test/achievements.test.js;
// initAchievements() wires it to the live store (single marked G12 block in
// main.js).
//
// How conditions are fed (wiring map):
//   feeds / washes    home/interactions.js increments counters (G5)
//   tickles           applyPetTickleGain in home/interactions.js (G5)
//   sleeps            systems/sleep.js applyCompletedSleepGrants (G6)
//   trips             systems/shopTrip.js onArrive (G7)
//   cleanTrips        THIS module — initAchievements decorates framework.launch
//                     so shopTrip's cityDrive onArrive result ({crashes,towed})
//                     also lands here (no crash data is persisted elsewhere)
//   coins/level/plays/outfits/decor/streak   read from live state (§E3)
// Every mutation above flows through store.update → the coalesced 'change'
// event (§E2) → checkNow() — so unlocks need no per-feature calls. track() is
// exposed for future systems that want an explicit counter bump.

import { ACHIEVEMENTS, DECOR_DEFAULT_ITEMS, DECOR_DEFAULT_WALLPAPER, DECOR_DEFAULT_FLOOR } from '../data/achievements.js';
import { MINIGAME_IDS } from '../data/minigames.js';
import { OUTFIT_SLOTS } from '../data/outfits.js';
import { t } from '../data/strings.js';
import { now } from '../core/clock.js';

const DEFAULT_ITEM_SET = new Set(DECOR_DEFAULT_ITEMS);

/**
 * 'decorator' progress (§C8.3): number of placed non-default items — placed
 * furniture whose item id is not a §C5.2 free default, plus every room with a
 * non-default wallpaper or floor. Fired by G11's 'decorChanged' store event.
 *
 * F2 (E11): `furniture.placed` is a FLAT `{ 'roomId:slotId': itemId }` map
 * (see systems/furniturePlacement.js §E3 header — it only ever stores
 * non-default overrides; placing a slot's free default deletes the key).
 * The previous nested `{room:{slot:id}}` iteration counted nothing, making
 * the achievement unreachable. The DEFAULT_ITEM_SET filter stays as a guard
 * against hand-edited/legacy saves.
 * @param {object} state save state (§E3: furniture.placed, decor)
 * @returns {number}
 */
export function countNonDefaultDecor(state) {
  let n = 0;
  const placed = state?.furniture?.placed ?? {};
  for (const itemId of Object.values(placed)) {
    if (typeof itemId === 'string' && itemId && !DEFAULT_ITEM_SET.has(itemId)) n += 1;
  }
  for (const id of Object.values(state?.decor?.wallpaper ?? {})) {
    if (id && id !== DECOR_DEFAULT_WALLPAPER) n += 1;
  }
  for (const id of Object.values(state?.decor?.floor ?? {})) {
    if (id && id !== DECOR_DEFAULT_FLOOR) n += 1;
  }
  return n;
}

/**
 * Progress of one achievement against the live state (§C8.3 conditions).
 * @param {import('../data/achievements.js').AchievementDef} def
 * @param {object} state save state (§E3)
 * @returns {{current: number, target: number}} current is clamped to target
 */
export function progressOf(def, state) {
  let current = 0;
  if (def.counter) {
    current = Math.floor(Number(state?.achievements?.counters?.[def.counter]) || 0);
  } else {
    switch (def.special) {
      case 'coins':
        current = Math.floor(Number(state?.coins) || 0);
        break;
      case 'level':
        current = Math.floor(Number(state?.level) || 0);
        break;
      case 'fullOutfit': {
        const eq = state?.outfits?.equipped ?? {};
        current = OUTFIT_SLOTS.filter((slot) => eq[slot] != null).length;
        break;
      }
      case 'decor':
        current = countNonDefaultDecor(state);
        break;
      case 'streak':
        current = Math.floor(Number(state?.daily?.streak) || 0);
        break;
      case 'play12': {
        const plays = state?.minigames?.plays ?? {};
        current = MINIGAME_IDS.filter((id) => (plays[id] ?? 0) >= 1).length;
        break;
      }
      default:
        current = 0;
    }
  }
  return { current: Math.max(0, Math.min(def.target, current)), target: def.target };
}

/**
 * @param {import('../data/achievements.js').AchievementDef} def
 * @param {object} state
 * @returns {boolean} condition currently satisfied
 */
export function isSatisfied(def, state) {
  const p = progressOf(def, state);
  return p.current >= p.target;
}

/**
 * Detect + apply every not-yet-unlocked achievement whose condition holds:
 * marks it unlocked (timestamp) exactly once and pays the coin reward
 * (§C8.3). Pure — returns a new state; unchanged input → same reference back.
 * @param {object} state save state (§E3)
 * @param {number} [nowMs] unlock timestamp (defaults to clock now())
 * @returns {{state: object, unlocked: import('../data/achievements.js').AchievementDef[]}}
 */
export function applyUnlocks(state, nowMs = now()) {
  const already = state?.achievements?.unlocked ?? {};
  const newly = ACHIEVEMENTS.filter((def) => !already[def.id] && isSatisfied(def, state));
  if (newly.length === 0) return { state, unlocked: [] };
  const next = {
    ...state,
    coins: state.coins + newly.reduce((sum, def) => sum + def.coins, 0),
    achievements: {
      ...state.achievements,
      unlocked: {
        ...already,
        ...Object.fromEntries(newly.map((def) => [def.id, nowMs])),
      },
    },
  };
  return { state: next, unlocked: newly };
}

// ---------------------------------------------------------------------------
// Runtime wiring (store subscription; DOM/audio only via injected deps)
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof initAchievements>|null} */
let engineSingleton = null;

/**
 * Wire the engine to the live store (idempotent). Subscribes centrally to the
 * coalesced 'change' event (§E2) — every §C8.3 condition source (counters,
 * coins, level, outfits, decor, streak, plays) mutates the store and therefore
 * flows through here; unlock payout + toast + jingle happen exactly once per
 * achievement ('achievementUnlocked' is then emitted by the store itself).
 *
 * @param {{store: object, ui?: object, audio?: object,
 *   framework?: {launch: Function}}} deps  ui/audio optional (headless tests);
 *   framework enables the §C8.3 noCrash interception (see header).
 * @returns {{track: (counterId: string, n?: number) => void,
 *   trackTripResult: (result: {crashes?: number, towed?: boolean}) => void,
 *   checkNow: () => void}}
 */
export function initAchievements({ store, ui, audio, framework }) {
  if (engineSingleton) return engineSingleton;

  function checkNow() {
    const result = applyUnlocks(store.get());
    if (result.unlocked.length === 0) return;
    store.update((state) => {
      // Re-apply against the live state (listener-safe): applyUnlocks is
      // idempotent per achievement via the unlocked map.
      const again = applyUnlocks(state);
      Object.assign(state, again.state);
    });
    for (const def of result.unlocked) {
      ui?.toast?.('ach.unlockedToast', { name: t(def.nameKey), coins: def.coins });
      audio?.play?.('jingle.achievement');
    }
  }

  /**
   * Explicit counter bump (§C3 "all care actions run achievement counters").
   * @param {string} counterId achievements.counters key (§E3)
   * @param {number} [n]
   */
  function track(counterId, n = 1) {
    if (!counterId || !Number.isFinite(n) || n <= 0) return;
    store.update((state) => {
      const counters = state.achievements.counters;
      counters[counterId] = Math.floor(Number(counters[counterId]) || 0) + Math.floor(n);
    });
    checkNow();
  }

  /**
   * Feed a finished shop-trip drive result into the noCrash achievement
   * (§C8.3: 1 trip with 0 crashes → cleanTrips counter).
   * @param {{crashes?: number, towed?: boolean}} result cityDrive arrival result
   */
  function trackTripResult(result) {
    if (!result || result.towed || (result.crashes ?? 0) !== 0) return;
    track('cleanTrips');
  }

  // §C8.3 noCrash wiring: crash counts are not persisted anywhere, so tap the
  // shop-trip launch path — shopTrip.js passes params.onArrive({pickups,
  // crashes, towed, coins}) through framework.launch (§C4.3). Decorating the
  // launch params here keeps G1/G7 files untouched.
  if (framework && typeof framework.launch === 'function' && !framework.__g12NoCrashTap) {
    const origLaunch = framework.launch.bind(framework);
    framework.launch = (id, params = {}) => {
      if (id === 'cityDrive' && params?.mode === 'shopTrip' && typeof params.onArrive === 'function') {
        const onArrive = params.onArrive;
        params = {
          ...params,
          onArrive: (result) => {
            onArrive(result);
            trackTripResult(result);
          },
        };
      }
      return origLaunch(id, params);
    };
    framework.__g12NoCrashTap = true;
  }

  store.on('change', checkNow);
  checkNow(); // catch conditions already met by the loaded save

  engineSingleton = { track, trackTripResult, checkNow };
  return engineSingleton;
}

/** @returns {ReturnType<typeof initAchievements>|null} engine after initAchievements */
export function getAchievementsEngine() {
  return engineSingleton;
}

/** Test-only: drop the singleton so initAchievements can re-wire a fresh store. */
export function resetAchievementsEngineForTests() {
  engineSingleton = null;
}
