// Offline catch-up simulation (§E4): ×0.3 awake decay, 480-min cap, sleep
// completing while closed (uncapped), event emission + ordering.
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateOffline, offlineToastVars } from '../src/systems/offline.js';
import { startSleep } from '../src/systems/sleep.js';
import { OFFLINE, STATS, XP } from '../src/data/constants.js';
import { defaultState } from '../src/core/save.js';

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
