// Time engine (§E4): 1 s tick loop → stat decay (or sleep fill) per §C1 rates,
// updates lastTickAt, autosave rides the store's debounce. dt is derived from
// clock.now() deltas, so throttled background tabs catch up on the next tick
// and the dev harness ?fast=N multiplier works naturally.

import { ENGINE, STATS } from '../data/constants.js';
import { now } from './clock.js';
import { applyTick } from '../systems/stats.js';

/**
 * Create the time engine bound to a store.
 * @param {import('./store.js').createStore extends (...a:any)=>infer R ? R : never} store
 */
export function createTimeEngine(store) {
  /** @type {ReturnType<typeof setInterval>|null} */
  let interval = null;

  /** Run one tick now (also used by tests/harness). */
  function tick() {
    const nowMs = now();
    store.update((state) => {
      const dtMin = (nowMs - state.lastTickAt) / 60000;
      if (dtMin <= 0) {
        state.lastTickAt = nowMs;
        return;
      }
      if (state.sleep?.sleeping) {
        // Sleep fill (§C1.4). The full sleep state machine (grumpy debuff, wake
        // notification, XP grant) is systems/sleep.js — agent G6 — this keeps
        // energy filling and auto-wakes so the engine is never stuck.
        state.stats = applyTick(state.stats, dtMin, { asleep: true });
        if (state.stats.energy >= STATS.MAX || nowMs >= state.sleep.wakeAt) {
          state.sleep = { sleeping: false, startedAt: 0, wakeAt: 0 };
        }
      } else {
        state.stats = applyTick(state.stats, dtMin);
      }
      state.lastTickAt = nowMs;
    });
  }

  return {
    /** Start the 1 s interval loop (idempotent). */
    start() {
      if (interval != null) return;
      interval = setInterval(tick, ENGINE.TICK_MS);
    },
    /** Stop the loop. */
    stop() {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    },
    tick,
  };
}
