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
//
// V2/G20 (§B4/§B5/§C2.3): the sim additionally advances the 2.0 engines —
//   - health/weight: the SAME awake window as stats (0.3× rate, 480-min cap);
//     health tick events ('becameQueasy'|'becameSick'|'recovered'|
//     'tummyWarning') are appended to the events list.
//   - garden: FULL elapsed rate, uncapped (plants are real-time like sleep),
//     with garden.applyRain for every rain block that started inside the
//     first 8 h after the player left (§B4: offline rain is capped at the
//     same sim window as stats). Sequencing per the §B4/G18 contract:
//     tick(g, rainStart) → applyRain(g, rainStart, rainEnd) → tick(g, now) —
//     bookkeeping is brought current BEFORE each mutation so dry gaps are
//     never credited. Plots that crossed readiness append one 'cropsReady'.
// New events appended after the statLow crossings: health events first, then
// 'cropsReady'.

import { OFFLINE, STATS } from '../data/constants.js';
import { applyTick } from './stats.js';
import { isSleeping, wakeUp } from './sleep.js';
import { t } from '../data/strings.js';
// V2/G20: 2.0 engines + catalog (pure imports — module stays node:test-safe)
import * as health from './health.js';
import { HEALTH } from './health.js';
import * as weight from './weight.js';
import * as garden from './garden.js';
import { weatherAt } from './weather.js';
import { CROPS_BY_ID } from '../data/crops.js';

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

  // --- V2/G20: health + weight (same 0.3×/480-min awake window as stats) ---
  if (awakeMin > 0) {
    const lowStatCount = STATS.KEYS.filter(
      (k) => s.stats[k] < HEALTH.NEGLECT_STAT_BELOW
    ).length;
    const hr = health.tick(s.health, awakeMin, lowStatCount, {
      mult: OFFLINE.AWAKE_RATE_MULT,
      nowMs,
    });
    s = {
      ...s,
      health: hr.h,
      weight: weight.tick(s.weight, awakeMin, OFFLINE.AWAKE_RATE_MULT),
    };
    events.push(...hr.events);
  }

  // --- V2/G20: garden — FULL elapsed rate, uncapped, + offline rain (§B4) ---
  {
    /** @type {{type: string, plotIdx: number, cropId: string}[]} */
    const gardenEvents = [];
    let g = s.garden;
    // Rain blocks only count inside the first 8 h after leaving (§B4: same
    // sim window as §E4 stats). Walk the 6-h weather blocks across it.
    const rainWindowEnd = Math.min(nowMs, last + OFFLINE.AWAKE_CAP_MIN * 60000);
    let cursor = last;
    for (let guard = 0; cursor < rainWindowEnd && guard < 64; guard += 1) {
      const wx = weatherAt(cursor);
      if (wx.state === 'rain') {
        const rainStart = Math.max(wx.start, last);
        const brought = garden.tick(g, rainStart, CROPS_BY_ID); // bookkeeping first
        gardenEvents.push(...brought.events);
        g = garden.applyRain(brought.g, rainStart, wx.end, CROPS_BY_ID);
      }
      cursor = wx.end;
    }
    const grown = garden.tick(g, nowMs, CROPS_BY_ID);
    gardenEvents.push(...grown.events);
    s = { ...s, garden: grown.g };
    if (gardenEvents.some((e) => e.type === 'ready')) events.push('cropsReady');
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
  // V2/G20: welcome-back parts for crops that ripened / sickness that struck
  if (sim.events.includes('cropsReady')) parts.push(t('offline.cropsReady'));
  if (sim.events.includes('becameSick')) parts.push(t('offline.becameSick'));
  for (const k of STATS.KEYS) {
    const delta = Math.round(sim.state.stats[k] - beforeStats[k]);
    if (delta !== 0) {
      parts.push(`${t(`stat.${k}`)} ${delta > 0 ? '+' : '-'}${Math.abs(delta)}`);
    }
  }
  if (parts.length === 0) return null;
  return { summary: parts.join(' · ') };
}
