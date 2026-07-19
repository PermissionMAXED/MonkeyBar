// Sleep state machine (§C1.4) — PURE module: no three.js/DOM imports so
// node:test runs it headlessly. All numbers from data/constants.js.
//
// The live 1 s loop is core/timeEngine.js (it applies the asleep energy fill
// and auto-wakes); the DOM/scene integration (lamp tap, night mode, countdown
// chip) is ui/sleepFlow.js. This module is the single source of sleep rules:
//   - canSleep / startSleep  (lamp tap while awake, energy < 70)
//   - tickSleep              (pure asleep tick incl. auto-wake — offline sim & tests)
//   - wakeUp                 (early wake → grumpy debuff; completed → XP + counter)
//   - grumpyDebuff / currentMood  (the canonical mood readers — HUD/emotions
//     should call currentMood(state, now) so the §C1.4 −15 debuff applies)
//
// All state-transforming functions are pure: they return NEW state objects and
// never mutate their input (callers inside store.update() Object.assign the
// result onto the draft).

import { SLEEP, STATS, XP } from '../data/constants.js';
import { applyTick, mood } from './stats.js';
import { applyXp } from './leveling.js';

/**
 * Sleep duration in minutes for a given energy level (§C1.4):
 * ceil(30 * (100 - energy) / 100), minimum 10.
 * @param {number} energy 0–100
 * @returns {number} whole minutes
 */
export function sleepDurationMin(energy) {
  const e = Math.min(STATS.MAX, Math.max(STATS.MIN, Number(energy) || 0));
  const raw = Math.ceil((SLEEP.DURATION_BASE_MIN * (STATS.MAX - e)) / STATS.MAX);
  return Math.max(SLEEP.DURATION_MIN_MIN, raw);
}

/**
 * @param {object} state save-schema state (§E3)
 * @returns {boolean} true while Gooby is asleep
 */
export function isSleeping(state) {
  return !!state?.sleep?.sleeping;
}

/**
 * Can Gooby fall asleep (§C1.4)? Lamp switch starts sleep only when awake and
 * energy < 70.
 * @param {object} state
 * @returns {boolean}
 */
export function canSleep(state) {
  return !isSleeping(state) && Number(state?.stats?.energy) < SLEEP.START_BELOW_ENERGY;
}

/**
 * Start a sleep (§C1.4): wakeAt = now + duration. Pure — returns a new state.
 * Callers must check canSleep() first (this does not).
 * @param {object} state
 * @param {number} nowMs
 * @returns {object} new state
 */
export function startSleep(state, nowMs) {
  const durMin = sleepDurationMin(state.stats.energy);
  return {
    ...state,
    sleep: { sleeping: true, startedAt: nowMs, wakeAt: nowMs + durMin * 60000 },
  };
}

/**
 * Is an early manual wake allowed (§C1.4)? Only after 5 minutes of sleep.
 * @param {object} state
 * @param {number} nowMs
 * @returns {boolean}
 */
export function canWakeEarly(state, nowMs) {
  return (
    isSleeping(state) &&
    nowMs - state.sleep.startedAt >= SLEEP.EARLY_WAKE_AFTER_MIN * 60000
  );
}

/**
 * Milliseconds of sleep remaining (HUD countdown chip).
 * @param {object} state
 * @param {number} nowMs
 * @returns {number} 0 when not sleeping
 */
export function sleepRemainingMs(state, nowMs) {
  if (!isSleeping(state)) return 0;
  return Math.max(0, state.sleep.wakeAt - nowMs);
}

/**
 * Grants for a COMPLETED sleep (§C1.5/§C8.3): XP +10 (with level-up handling)
 * and achievements.counters.sleeps += 1. Pure — returns a new state.
 * Exported separately because the live auto-wake happens inside
 * core/timeEngine.js (which clears the sleep object itself); ui/sleepFlow.js
 * applies these grants when it observes that transition.
 * @param {object} state
 * @returns {object} new state
 */
export function applyCompletedSleepGrants(state) {
  const progress = applyXp({ xp: state.xp, level: state.level }, XP.COMPLETED_SLEEP, 'sleep'); // V4/G56: xpGranted source tag (§C-SYS3.1 #5)
  const counters = { ...(state.achievements?.counters ?? {}) };
  counters.sleeps = (Number(counters.sleeps) || 0) + 1;
  return {
    ...state,
    xp: progress.xp,
    level: progress.level,
    coins: (Number(state.coins) || 0) + progress.coinsAwarded,
    achievements: { ...(state.achievements ?? {}), counters },
  };
}

/**
 * Wake Gooby up (§C1.4). Pure — returns { state, events }.
 * - early: keeps whatever energy accrued (already in stats via ticks) and sets
 *   the grumpy debuff `grumpyUntil = now + 10 min` (mood −15 while active).
 *   Event: 'wokeEarly'. Callers must check canWakeEarly() first.
 * - completed (default): grants XP +10 and increments the sleeps counter.
 *   Event: 'wokeUp'.
 * @param {object} state
 * @param {number} nowMs
 * @param {{early?: boolean}} [opts]
 * @returns {{state: object, events: string[]}}
 */
export function wakeUp(state, nowMs, opts = {}) {
  let s = { ...state, sleep: { sleeping: false, startedAt: 0, wakeAt: 0 } };
  if (opts.early) {
    s.grumpyUntil = nowMs + SLEEP.EARLY_WAKE_DEBUFF_MIN * 60000;
    return { state: s, events: ['wokeEarly'] };
  }
  s = applyCompletedSleepGrants(s);
  return { state: s, events: ['wokeUp'] };
}

/**
 * Pure asleep tick (§C1.4/§E4): applies asleep rates from lastTickAt for
 * min(now, wakeAt), updates lastTickAt, auto-wakes (completed, with grants)
 * at `energy ≥ 100` or `wakeAt`. Used by the offline simulation and tests —
 * the live 1 s loop is core/timeEngine.js.
 * No-op when not sleeping.
 * @param {object} state
 * @param {number} nowMs
 * @returns {{state: object, events: string[]}}
 */
export function tickSleep(state, nowMs) {
  if (!isSleeping(state)) return { state, events: [] };
  const from = Number(state.lastTickAt) || nowMs;
  const until = Math.min(nowMs, state.sleep.wakeAt);
  const dtMin = Math.max(0, (until - from) / 60000);
  const s = {
    ...state,
    stats: applyTick(state.stats, dtMin, { asleep: true }),
    lastTickAt: nowMs,
  };
  if (nowMs >= state.sleep.wakeAt || s.stats.energy >= STATS.MAX) {
    return wakeUp(s, nowMs, { early: false });
  }
  return { state: s, events: [] };
}

/**
 * Active grumpy mood debuff (§C1.4): 15 while now < grumpyUntil, else 0.
 * @param {object} state
 * @param {number} nowMs
 * @returns {number}
 */
export function grumpyDebuff(state, nowMs) {
  const until = Number(state?.grumpyUntil) || 0;
  return nowMs < until ? SLEEP.EARLY_WAKE_MOOD_DEBUFF : 0;
}

/**
 * Canonical mood reader (§C1 + §C1.4): the §C1 mood formula with the early-wake
 * grumpy debuff applied. HUD / emotion readers should use THIS instead of
 * calling stats.mood(stats) directly, so the debuff is never missed.
 * @param {object} state
 * @param {number} nowMs
 * @returns {number} 0–100
 */
export function currentMood(state, nowMs) {
  return mood(state.stats, { debuff: grumpyDebuff(state, nowMs) });
}
