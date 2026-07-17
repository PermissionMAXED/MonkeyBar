// Time engine (§E4): 1 s tick loop → stat decay (or sleep fill) per §C1 rates,
// updates lastTickAt, autosave rides the store's debounce. dt is derived from
// clock.now() deltas, so throttled background tabs catch up on the next tick
// and the dev harness ?fast=N multiplier works naturally.
//
// V2/G20 (§B4/§B5/§C2.3/§C12.1): the same 1 s loop now also advances the
// 2.0 pet-sim engines —
//   health.tick   sickness machine, awake minutes only (like stat decay)
//   weight.tick   passive drift toward 50, awake minutes only
//   garden.tick   real-time crop growth (idempotent via g.lastTickAt — runs
//                 for the FULL advanced time, sleep included: plants are
//                 real-time like sleep)
//   profileStats.tickPlaytime  §C12.1 playtime accumulator (full advanced time)
// plus a 60 s AMBIENCE TICKER that emits the runtime-only store events
// 'dayBandChanged' / 'weatherChanged' (§B3) and auto-waters planted plots via
// garden.applyRain while a rain block is active (§B4).
//
// Health tick events are re-emitted as the runtime-only store event
// 'healthEvent' (payload: 'becameQueasy'|'becameSick'|'recovered'|
// 'tummyWarning') — home/interactions.js turns them into toasts/juice.

import { ENGINE, STATS } from '../data/constants.js';
import { now } from './clock.js';
import { applyTick, clampStat } from '../systems/stats.js';
// V2/G20: 2.0 pet-sim engines riding the tick loop
import * as health from '../systems/health.js';
import { HEALTH } from '../systems/health.js';
import * as weight from '../systems/weight.js';
import * as garden from '../systems/garden.js';
import * as profileStats from '../systems/profileStats.js';
import { bandAt } from '../systems/dayNight.js';
import { weatherAt } from '../systems/weather.js';
import { CROPS_BY_ID } from '../data/crops.js';

/** V2/G20: ambience ticker interval (§B4: 60 s). */
export const AMBIENCE_TICK_MS = 60000;

/**
 * Create the time engine bound to a store.
 * @param {import('./store.js').createStore extends (...a:any)=>infer R ? R : never} store
 */
export function createTimeEngine(store) {
  /** @type {ReturnType<typeof setInterval>|null} */
  let interval = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let ambienceInterval = null; // V2/G20
  let lastBand = null; // V2/G20: last emitted day band id
  let lastWeather = null; // V2/G20: last emitted weather state

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
      // V2/G20: minutes of this tick that decay at AWAKE rules (health/weight
      // follow the stats pattern — asleep time never ticks them, §E4).
      let awakeMin = dtMin;
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
        awakeMin = 0;
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
            v2Tick(state, last, 0, nowMs); // V2/G20: held boundary — see below
            return;
          }
          state.sleep = { sleeping: false, startedAt: 0, wakeAt: 0 };
          awakeMin = Math.max(0, nowMs - Math.max(last, wakeAt)) / 60000;
          if (awakeMin > 0) state.stats = applyTick(state.stats, awakeMin);
        }
      } else {
        state.stats = applyTick(state.stats, dtMin);
      }
      state.lastTickAt = nowMs;
      v2Tick(state, last, awakeMin, nowMs); // V2/G20
    });
  }

  /**
   * V2/G20: advance the 2.0 engines for the time this tick actually processed
   * (state.lastTickAt was already moved by the caller — in the hidden-held
   * sleep case it stops at the wakeAt boundary, so garden/playtime advance
   * exactly with the engine and nothing double-ticks).
   * @param {object} state store state (mutated in place — inside store.update)
   * @param {number} last lastTickAt before this tick
   * @param {number} awakeMin minutes of this tick under awake rules
   * @param {number} nowMs clock.now() of this tick
   */
  function v2Tick(state, last, awakeMin, nowMs) {
    const endMs = state.lastTickAt;
    const advancedMin = (endMs - last) / 60000;
    if (advancedMin > 0) {
      // §C12.1 playtime: 1 min per real minute the engine processes, no
      // idle-detection cleverness.
      state.profile = profileStats.tickPlaytime(state.profile, advancedMin);
      // §C2.3 garden growth (idempotent bookkeeping via garden.lastTickAt;
      // the in-room 1 s interval + offline sim coexist safely). Live 'ready'
      // events surface via the 'gardenChanged' slice event (G19's sparkle).
      state.garden = garden.tick(state.garden, endMs, CROPS_BY_ID).g;
    }
    if (awakeMin > 0) {
      const wasQueasy = state.health?.state === 'queasy';
      const lowStatCount = STATS.KEYS.filter(
        (k) => state.stats[k] < HEALTH.NEGLECT_STAT_BELOW
      ).length;
      const hr = health.tick(state.health, awakeMin, lowStatCount, { nowMs });
      state.health = hr.h;
      for (const ev of hr.events) store.emit?.('healthEvent', ev);
      // §C3.3: fun decays ×1.25 while queasy — applyTick already took 1×,
      // apply the extra ×0.25 on the awake minutes here.
      if (wasQueasy) {
        const extra = STATS.RATES_AWAKE.fun * awakeMin * (HEALTH.QUEASY_FUN_DECAY_MULT - 1);
        state.stats = { ...state.stats, fun: clampStat(state.stats.fun + extra) };
      }
      state.weight = weight.tick(state.weight, awakeMin);
    }
  }

  /**
   * V2/G20: 60 s ambience tick (§B4) — emits runtime-only 'dayBandChanged' /
   * 'weatherChanged' store events on band/state changes (and once on start so
   * consumers can initialize), and auto-waters planted plots while a rain
   * block is active: garden bookkeeping is brought current FIRST so a dry gap
   * before the rain is never credited (§B4 sequencing contract).
   */
  function ambienceTick() {
    const nowMs = now();
    const band = bandAt(nowMs);
    const wx = weatherAt(nowMs);
    if (band.band !== lastBand) {
      lastBand = band.band;
      store.emit?.('dayBandChanged', band);
    }
    if (wx.state !== lastWeather) {
      lastWeather = wx.state;
      store.emit?.('weatherChanged', wx);
    }
    if (wx.state === 'rain') {
      store.update((state) => {
        const current = garden.tick(state.garden, nowMs, CROPS_BY_ID).g;
        state.garden = garden.applyRain(current, wx.start, wx.end, CROPS_BY_ID);
      });
    }
  }

  return {
    /** Start the 1 s interval loop + 60 s ambience ticker (idempotent). */
    start() {
      if (interval != null) return;
      interval = setInterval(tick, ENGINE.TICK_MS);
      // V2/G20: ambience ticker (immediate first run primes band/weather)
      ambienceInterval = setInterval(ambienceTick, AMBIENCE_TICK_MS);
      ambienceTick();
    },
    /** Stop the loop. */
    stop() {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
      // V2/G20
      if (ambienceInterval != null) {
        clearInterval(ambienceInterval);
        ambienceInterval = null;
      }
    },
    tick,
    ambienceTick, // V2/G20: exposed for tests/harness
  };
}
