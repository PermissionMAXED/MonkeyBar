// Offline catch-up simulation (§E4): ×0.3 awake decay, 480-min cap, sleep
// completing while closed (uncapped), event emission + ordering. Also the F2
// time-engine surface: tick split at wakeAt (E4) and completed-sleep grants
// surviving a kill-while-hidden (E4 — engine holds the sleep at the boundary,
// offline catch-up grants on next boot).
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateOffline, offlineToastVars } from '../src/systems/offline.js';
import { startSleep } from '../src/systems/sleep.js';
import { OFFLINE, STATS, XP } from '../src/data/constants.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';
import { createTimeEngine } from '../src/core/timeEngine.js';
import * as clock from '../src/core/clock.js';

const T0 = Date.UTC(2026, 6, 16, 12, 0, 0);
const MIN = 60000;
const H = 60 * MIN;

function state(stats = {}, extra = {}) {
  const s = defaultState();
  s.stats = { ...s.stats, ...stats };
  s.lastTickAt = T0;
  return Object.assign(s, extra);
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

// ---------------------------------------------------------------- awake decay

test('awake offline: 60 min decays at ×0.3 of the §C1 awake rates', () => {
  const { state: s, events } = simulateOffline(state({ hunger: 80, energy: 90, hygiene: 85, fun: 70 }), T0 + H);
  near(s.stats.hunger, 80 - 0.35 * 60 * 0.3, 'hunger'); //  −6.3
  near(s.stats.energy, 90 - 0.25 * 60 * 0.3, 'energy'); //  −4.5
  near(s.stats.hygiene, 85 - 0.15 * 60 * 0.3, 'hygiene'); // −2.7
  near(s.stats.fun, 70 - 0.5 * 60 * 0.3, 'fun'); //          −9
  assert.equal(s.lastTickAt, T0 + H);
  assert.deepEqual(events, []);
});

test('awake offline: 24 h away is capped at 480 simulated minutes (§E4)', () => {
  const { state: s } = simulateOffline(state({ hunger: 100, energy: 100, hygiene: 100, fun: 100 }), T0 + 24 * H);
  const capMin = OFFLINE.AWAKE_CAP_MIN;
  near(s.stats.hunger, 100 - 0.35 * capMin * 0.3, 'hunger'); // −50.4
  near(s.stats.energy, 100 - 0.25 * capMin * 0.3, 'energy'); // −36
  near(s.stats.hygiene, 100 - 0.15 * capMin * 0.3, 'hygiene'); // −21.6
  near(s.stats.fun, 100 - 0.5 * capMin * 0.3, 'fun'); //        −72 → 28
});

test('cap boundary: exactly 480 min ≡ 481 min (extra minute ignored)', () => {
  const at480 = simulateOffline(state({ fun: 100 }), T0 + 480 * MIN).state.stats.fun;
  const at481 = simulateOffline(state({ fun: 100 }), T0 + 481 * MIN).state.stats.fun;
  assert.equal(at480, at481);
});

test('zero/negative elapsed: unchanged stats, lastTickAt advanced', () => {
  const s0 = state({ hunger: 55 });
  const r1 = simulateOffline(s0, T0);
  assert.equal(r1.state.stats.hunger, 55);
  assert.equal(r1.state.lastTickAt, T0);
  const r2 = simulateOffline(s0, T0 - H); // clock moved backwards
  assert.equal(r2.state.stats.hunger, 55);
  assert.equal(r2.state.lastTickAt, T0 - H);
  assert.deepEqual(r2.events, []);
});

test('simulateOffline is pure (input state untouched)', () => {
  const s0 = state({ hunger: 80 });
  const snapshot = JSON.stringify(s0);
  simulateOffline(s0, T0 + 5 * H);
  assert.equal(JSON.stringify(s0), snapshot);
});

// ---------------------------------------------------------------- sleep offline

test('sleep completes while closed: asleep fill, wake grants, remainder ×0.3', () => {
  // Asleep at T0 with energy 10 → 27-min nap; away for 60 min total.
  const s0 = startSleep(state({ energy: 10, hunger: 80, hygiene: 85, fun: 70 }), T0);
  const { state: s, events } = simulateOffline(s0, T0 + H);
  assert.deepEqual(events, ['wokeUp']);
  assert.equal(s.sleep.sleeping, false);
  // energy: 27 min fill (clamped 100) then 33 awake min at ×0.3
  near(s.stats.energy, 100 - 0.25 * 33 * 0.3, 'energy');
  // hunger: 27 asleep min at −0.175 then 33 awake min at −0.35·0.3
  near(s.stats.hunger, 80 - 0.175 * 27 - 0.35 * 33 * 0.3, 'hunger');
  // hygiene/fun frozen asleep, then 33 min ×0.3
  near(s.stats.hygiene, 85 - 0.15 * 33 * 0.3, 'hygiene');
  near(s.stats.fun, 70 - 0.5 * 33 * 0.3, 'fun');
  // completed-sleep grants (§C1.4): XP +10, sleeps counter
  assert.equal(s.xp, XP.COMPLETED_SLEEP);
  assert.equal(s.achievements.counters.sleeps, 1);
});

test('sleep progresses at full rate offline and is UNCAPPED (§C1)', () => {
  // 30-min nap inside a 20-h absence: nap completes fully, remainder capped.
  const s0 = startSleep(state({ energy: 0, hunger: 100, fun: 100 }), T0);
  const { state: s, events } = simulateOffline(s0, T0 + 20 * H);
  assert.deepEqual(events, ['wokeUp']);
  // hunger: 30 asleep min + capped 480 awake min at ×0.3
  near(s.stats.hunger, 100 - 0.175 * 30 - 0.35 * OFFLINE.AWAKE_CAP_MIN * 0.3, 'hunger');
  near(s.stats.fun, 100 - 0.5 * OFFLINE.AWAKE_CAP_MIN * 0.3, 'fun');
});

test('still asleep at reopen: partial fill, no wake event, sleep kept', () => {
  const s0 = startSleep(state({ energy: 10, hunger: 80 }), T0); // 27-min nap
  const { state: s, events } = simulateOffline(s0, T0 + 10 * MIN);
  assert.deepEqual(events, []);
  assert.equal(s.sleep.sleeping, true);
  near(s.stats.energy, 10 + 3.334 * 10, 'energy');
  near(s.stats.hunger, 80 - 0.175 * 10, 'hunger');
  assert.equal(s.lastTickAt, T0 + 10 * MIN);
});

test('reopen exactly at wakeAt: wake fires, zero awake remainder', () => {
  const s0 = startSleep(state({ energy: 10, fun: 70 }), T0);
  const { state: s, events } = simulateOffline(s0, s0.sleep.wakeAt);
  assert.deepEqual(events, ['wokeUp']);
  assert.equal(s.stats.fun, 70); // fun frozen asleep, no awake time elapsed
});

// ---------------------------------------------------------------- statLow events

test("statLow: crossing below 25 emits 'statLow:<stat>'", () => {
  const { events } = simulateOffline(state({ hunger: 30 }), T0 + H); // 30 → 23.7
  assert.deepEqual(events, ['statLow:hunger']);
});

test('statLow: already-low stats stay silent', () => {
  const { events } = simulateOffline(state({ hunger: 20 }), T0 + H);
  assert.deepEqual(events, []);
});

test('statLow: stat ending exactly at 25 does not fire (< threshold only)', () => {
  // fun: rate 0.5 ×0.3 = 0.15/min; 100 min drops exactly 15: 40 → 25.
  const { events } = simulateOffline(state({ fun: 40 }), T0 + 100 * MIN);
  assert.deepEqual(events, []);
});

test('statLow: multiple crossings emit in STATS.KEYS order', () => {
  const { events } = simulateOffline(
    state({ hunger: 30, energy: 26, hygiene: 27, fun: 33 }),
    T0 + 3 * H // 180 min ×0.3: hunger −18.9, energy −13.5, hygiene −8.1, fun −27
  );
  assert.deepEqual(events, ['statLow:hunger', 'statLow:energy', 'statLow:hygiene', 'statLow:fun']);
  assert.deepEqual(
    events.map((e) => e.split(':')[1]),
    [...STATS.KEYS]
  );
});

test("event order: 'wokeUp' always precedes statLow crossings", () => {
  const s0 = startSleep(state({ energy: 10, fun: 40 }), T0);
  const { events } = simulateOffline(s0, T0 + 8 * H); // fun crosses during remainder
  assert.equal(events[0], 'wokeUp');
  assert.ok(events.includes('statLow:fun'), `events: ${events}`);
});

// -------------------------------------- F2 (E4): time-engine wakeAt tick split

/** Pin the game clock and run one engine tick against a fresh store. */
function tickOnce(s0, nowMs) {
  clock.configure({ now: nowMs });
  const store = createStore(s0, { autosave: false });
  createTimeEngine(store).tick();
  return store.get();
}

test('timeEngine: tick spanning wakeAt splits — asleep before, awake after (F2/E4)', () => {
  // Asleep since T0 with a 20-min wakeAt; the next tick lands ~40 min later.
  const s0 = state({ energy: 10, hunger: 80, hygiene: 85, fun: 70 });
  s0.sleep = { sleeping: true, startedAt: T0, wakeAt: T0 + 20 * MIN };
  const s = tickOnce(s0, T0 + 40 * MIN);

  assert.equal(s.sleep.sleeping, false, 'woke at the boundary');
  // awake remainder measured from wakeAt to the actual tick time
  const awakeMin = (s.lastTickAt - (T0 + 20 * MIN)) / 60000;
  assert.ok(awakeMin >= 20, 'tick covered the post-wake stretch');
  // energy: 20 asleep min fill, then awake decay — NOT 40 min of fill
  near(s.stats.energy, 10 + 3.334 * 20 - 0.25 * awakeMin, 'energy split at wakeAt');
  // hunger: 20 min at asleep half-rate, then awake rate
  near(s.stats.hunger, 80 - 0.175 * 20 - 0.35 * awakeMin, 'hunger split at wakeAt');
  // hygiene/fun are frozen asleep but decay for the post-wake stretch
  near(s.stats.hygiene, 85 - 0.15 * awakeMin, 'hygiene decays only after wake');
  near(s.stats.fun, 70 - 0.5 * awakeMin, 'fun decays only after wake');
});

test('timeEngine: tick fully inside the sleep window keeps sleeping (F2/E4)', () => {
  const s0 = state({ energy: 10, hunger: 80 });
  s0.sleep = { sleeping: true, startedAt: T0, wakeAt: T0 + 30 * MIN };
  const s = tickOnce(s0, T0 + 10 * MIN);
  assert.equal(s.sleep.sleeping, true);
  const asleepMin = (s.lastTickAt - T0) / 60000;
  near(s.stats.energy, 10 + 3.334 * asleepMin, 'pure asleep fill');
  near(s.stats.hunger, 80 - 0.175 * asleepMin, 'asleep half-rate hunger');
});

// ------------------- F2 (E4): completed-sleep grants survive kill-while-hidden

/** Install a fake hidden document (store/timeEngine feature-detect it). */
function withHiddenDocument(fn) {
  const had = 'document' in globalThis;
  const prev = globalThis.document;
  globalThis.document = { hidden: true, addEventListener() {}, querySelector: () => null };
  try {
    return fn();
  } finally {
    if (had) globalThis.document = prev;
    else delete globalThis.document;
  }
}

test('timeEngine: hidden tick past wakeAt holds the sleep at the boundary (F2/E4)', () => {
  const s0 = state({ energy: 10, hunger: 80, hygiene: 85, fun: 70 });
  s0.sleep = { sleeping: true, startedAt: T0, wakeAt: T0 + 20 * MIN };
  const s = withHiddenDocument(() => tickOnce(s0, T0 + 50 * MIN));

  // Held: still sleeping, clock parked exactly at wakeAt — store events can't
  // flush while hidden (no rAF), so waking here would lose sleepFlow's grants.
  assert.equal(s.sleep.sleeping, true, 'sleep held while hidden');
  assert.equal(s.lastTickAt, T0 + 20 * MIN, 'lastTickAt parked at wakeAt');
  near(s.stats.energy, 10 + 3.334 * 20, 'fill stops at the boundary');
  near(s.stats.hunger, 80 - 0.175 * 20, 'asleep decay stops at the boundary');
  near(s.stats.hygiene, 85, 'frozen asleep');
  near(s.stats.fun, 70, 'frozen asleep');

  // App killed → next boot: offline catch-up applies the completion grants
  // exactly once and reflects the wake in the welcome-back summary.
  const before = { ...s.stats };
  const sim = simulateOffline(s, T0 + 140 * MIN);
  assert.equal(sim.events[0], 'wokeUp');
  assert.equal(sim.state.sleep.sleeping, false);
  assert.equal(sim.state.xp, XP.COMPLETED_SLEEP, 'XP granted once');
  assert.equal(sim.state.achievements.counters.sleeps, 1, 'sleeps counter granted once');
  // remainder decays awake at ×0.3 from the boundary (120 min)
  near(sim.state.stats.hunger, before.hunger - 0.35 * 120 * 0.3, 'post-wake ×0.3 decay');
  near(sim.state.stats.fun, before.fun - 0.5 * 120 * 0.3, 'post-wake ×0.3 decay');
  const vars = offlineToastVars(before, sim);
  assert.ok(vars, 'welcome-back summary present');
  assert.match(vars.summary, /Gooby woke up!/);

  // idempotence: a second catch-up on the woken state must not re-grant
  const again = simulateOffline(sim.state, T0 + 150 * MIN);
  assert.equal(again.state.xp, XP.COMPLETED_SLEEP);
  assert.equal(again.state.achievements.counters.sleeps, 1);
  assert.ok(!again.events.includes('wokeUp'));
});

test('timeEngine: resume after a hidden hold wakes with the correct split (F2/E4)', () => {
  const s0 = state({ energy: 10, hunger: 80, hygiene: 85, fun: 70 });
  s0.sleep = { sleeping: true, startedAt: T0, wakeAt: T0 + 20 * MIN };
  const held = withHiddenDocument(() => tickOnce(s0, T0 + 50 * MIN));
  assert.equal(held.sleep.sleeping, true);

  // Back to visible: the next tick wakes at the boundary and decays the
  // post-wake stretch with awake rules (grants ride the now-flushable
  // 'sleepChanged' event via ui/sleepFlow.js).
  const s = tickOnce(held, T0 + 60 * MIN);
  assert.equal(s.sleep.sleeping, false, 'woke on the visible tick');
  const awakeMin = (s.lastTickAt - (T0 + 20 * MIN)) / 60000;
  near(s.stats.energy, 10 + 3.334 * 20 - 0.25 * awakeMin, 'no double fill');
  near(s.stats.hunger, 80 - 0.175 * 20 - 0.35 * awakeMin, 'awake decay from wakeAt');
  near(s.stats.hygiene, 85 - 0.15 * awakeMin, 'awake decay from wakeAt');
});

test('offline: persisted boundary-held sleep (lastTickAt == wakeAt) grants once (F2/E4)', () => {
  // The exact shape the engine persists when killed while hidden past wakeAt.
  const wakeAt = T0 + 20 * MIN;
  const s0 = state({ energy: 76.68, hunger: 76.5, hygiene: 85, fun: 70 });
  s0.sleep = { sleeping: true, startedAt: T0, wakeAt };
  s0.lastTickAt = wakeAt;
  const { state: s, events } = simulateOffline(s0, wakeAt + 60 * MIN);
  assert.deepEqual(events, ['wokeUp']);
  assert.equal(s.xp, XP.COMPLETED_SLEEP);
  assert.equal(s.achievements.counters.sleeps, 1);
  // zero asleep time left — the whole hour decays awake at ×0.3
  near(s.stats.energy, 76.68 - 0.25 * 60 * 0.3, 'no extra fill');
  near(s.stats.hunger, 76.5 - 0.35 * 60 * 0.3, 'awake ×0.3');
});

// ---------------------------------------------------------------- toast summary

test('offlineToastVars: summarizes wake + rounded stat deltas', () => {
  const before = { hunger: 80, energy: 10, hygiene: 85, fun: 70 };
  const s0 = startSleep(state(before), T0);
  const sim = simulateOffline(s0, T0 + H);
  const vars = offlineToastVars(before, sim);
  assert.ok(vars, 'expected a summary');
  assert.match(vars.summary, /Gooby woke up!/);
  assert.match(vars.summary, /Hunger -\d+/);
  assert.match(vars.summary, /Energy \+\d+/);
});

test('offlineToastVars: null for a blink-short absence', () => {
  const before = { hunger: 80, energy: 90, hygiene: 85, fun: 70 };
  const sim = simulateOffline(state(before), T0 + 10000); // 10 s
  assert.equal(offlineToastVars(before, sim), null);
});
