// Offline catch-up simulation (§E4) — PURE module: no three.js/DOM imports.
// Called once in main.js boot (marked G6 block) before the first render.
//
// Algorithm (§E4, binding):
//   - sleeping: apply asleep rates for min(elapsed, wakeAt − lastTickAt);
//     complete the wake if due (event 'wokeUp', §C1.4 grants applied);
//     the remaining elapsed time decays awake at ×0.3, capped at 480 sim-minutes.
//   - awake: the whole elapsed time decays at ×0.3, capped at 480 sim-minutes.
//   - events additionally include 'statLow:<stat>' for every stat that CROSSED
//     below LOW_STAT (25) during the simulation (already-low stats are silent).
//
// Event order: 'wokeUp' first (if any), then statLow crossings in STATS.KEYS
// order (hunger, energy, hygiene, fun).

import { OFFLINE, STATS } from '../data/constants.js';
import { applyTick } from './stats.js';
import { isSleeping, wakeUp } from './sleep.js';
import { t } from '../data/strings.js';

/**
 * Simulate the time the app was closed. Pure — returns a NEW state (input is
 * not mutated) plus the events that occurred.
 * @param {object} state save-schema state (§E3)
 * @param {number} nowMs current game time (clock.now())
 * @returns {{state: object, events: string[]}}
 */
export function simulateOffline(state, nowMs) {
  /** @type {string[]} */
  const events = [];
  const last = Number(state.lastTickAt) || nowMs;
  const elapsedMs = nowMs - last;
  if (elapsedMs <= 0) {
    return { state: { ...state, lastTickAt: nowMs }, events };
  }

  const statsBefore = { ...state.stats };
  let s = { ...state };
  let awakeMs = elapsedMs;

  if (isSleeping(s)) {
    // F2 (E4): this branch is also the recovery path for a sleep that
    // completed while the app was hidden and then KILLED — the time engine
    // holds a finished sleep at the wakeAt boundary while hidden (store
    // events cannot flush without rAF, so sleepFlow's grant observer never
    // runs there), leaving `sleeping: true, lastTickAt == wakeAt` in the
    // persisted save. On the next boot the wakeUp() below applies the
    // completion grants (energy fill happened during the asleep segment;
    // XP + sleeps counter here) exactly once, and the 'wokeUp' event feeds
    // the welcome-back summary.
    const asleepMs = Math.max(0, Math.min(elapsedMs, s.sleep.wakeAt - last));
    s = { ...s, stats: applyTick(s.stats, asleepMs / 60000, { asleep: true }) };
    if (nowMs >= s.sleep.wakeAt) {
      // Sleep completed while closed (uncapped, §C1): grants + 'wokeUp'.
      const woken = wakeUp(s, s.sleep.wakeAt, { early: false });
      s = woken.state;
      events.push(...woken.events);
      awakeMs = elapsedMs - asleepMs;
    } else {
      awakeMs = 0; // still asleep at nowMs
    }
  }

  const awakeMin = Math.min(awakeMs / 60000, OFFLINE.AWAKE_CAP_MIN);
  if (awakeMin > 0) {
    s = { ...s, stats: applyTick(s.stats, awakeMin, { rateMult: OFFLINE.AWAKE_RATE_MULT }) };
  }
  s.lastTickAt = nowMs;

  for (const k of STATS.KEYS) {
    if (statsBefore[k] >= STATS.LOW_STAT && s.stats[k] < STATS.LOW_STAT) {
      events.push(`statLow:${k}`);
    }
  }
  return { state: s, events };
}

/**
 * Build the {summary} var for the welcome-back toast
 * (`t('offline.welcomeBack', vars)`), e.g. "Gooby woke up! · Hunger -12".
 * Returns null when nothing noteworthy happened (short absences).
 * @param {object} beforeStats stats before the simulation
 * @param {{state: object, events: string[]}} sim simulateOffline result
 * @returns {{summary: string}|null}
 */
export function offlineToastVars(beforeStats, sim) {
  const parts = [];
  if (sim.events.includes('wokeUp')) parts.push(t('offline.wokeUp'));
  for (const k of STATS.KEYS) {
    const delta = Math.round(sim.state.stats[k] - beforeStats[k]);
    if (delta !== 0) {
      parts.push(`${t(`stat.${k}`)} ${delta > 0 ? '+' : '-'}${Math.abs(delta)}`);
    }
  }
  if (parts.length === 0) return null;
  return { summary: parts.join(' · ') };
}
