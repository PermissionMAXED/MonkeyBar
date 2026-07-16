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
      const last = state.lastTickAt;
      const dtMin = (nowMs - last) / 60000;
      if (dtMin <= 0) {
        state.lastTickAt = nowMs;
        return;
      }
      if (state.sleep?.sleeping) {
        // Sleep fill (§C1.4). The full sleep state machine (grumpy debuff, wake
        // notification, XP grant) is systems/sleep.js — agent G6 — this keeps
        // energy filling and auto-wakes so the engine is never stuck.
        // F2 (E4): a tick spanning wakeAt is SPLIT at the boundary — pre-wake
        // time fills with asleep rules, post-wake time decays with awake
        // rules, and the wake (whose completion grants ui/sleepFlow.js applies
        // on 'sleepChanged') lands exactly at wakeAt.
        const wakeAt = state.sleep.wakeAt;
        const asleepMin = Math.max(0, Math.min(nowMs, wakeAt) - last) / 60000;
        if (asleepMin > 0) state.stats = applyTick(state.stats, asleepMin, { asleep: true });
        if (state.stats.energy >= STATS.MAX || nowMs >= wakeAt) {
          // F2 (E4): store events flush on requestAnimationFrame, which never
          // fires while the tab/app is hidden — clearing the sleep here would
          // persist a woken state whose completion grants (sleepFlow's
          // 'sleepChanged' observer) never ran, losing them for good if the
          // app is killed. Hold the finished sleep at the wakeAt boundary:
          // the next VISIBLE tick wakes normally, and after a kill the boot
          // catch-up (systems/offline.js) applies the grants exactly once.
          if (typeof document !== 'undefined' && document.hidden) {
            state.lastTickAt = Math.max(last, Math.min(nowMs, wakeAt));
            return;
          }
          state.sleep = { sleeping: false, startedAt: 0, wakeAt: 0 };
          const awakeMin = Math.max(0, nowMs - Math.max(last, wakeAt)) / 60000;
          if (awakeMin > 0) state.stats = applyTick(state.stats, awakeMin);
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
