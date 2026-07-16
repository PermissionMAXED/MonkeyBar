// Sleep state machine (§C1.4) vs the binding numbers: durations, auto-wake,
// early-wake rules, grumpy debuff, completed-sleep grants.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sleepDurationMin,
  canSleep,
  canWakeEarly,
  isSleeping,
  startSleep,
  tickSleep,
  wakeUp,
  applyCompletedSleepGrants,
  grumpyDebuff,
  currentMood,
  sleepRemainingMs,
} from '../src/systems/sleep.js';
import { SLEEP, XP, STATS } from '../src/data/constants.js';
import { defaultState } from '../src/core/save.js';

const T0 = Date.UTC(2026, 6, 16, 12, 0, 0); // arbitrary fixed epoch
const MIN = 60000;

/** Fresh state with stat overrides. */
function state(stats = {}, extra = {}) {
  const s = defaultState();
  s.stats = { ...s.stats, ...stats };
  s.lastTickAt = T0;
  return Object.assign(s, extra);
}

/** State already asleep, started at T0 with the §C1.4 duration. */
function sleepingState(stats = {}) {
  return startSleep(state(stats), T0);
}

// ---------------------------------------------------------------- durations

test('duration formula: energy 5 → ceil(30·95/100) = 29 min', () => {
  assert.equal(sleepDurationMin(5), 29);
});

test('duration formula: energy 0 → full 30 min', () => {
  assert.equal(sleepDurationMin(0), 30);
});

test('duration floor: energy 90 → 10 min (raw 3 floored to 10)', () => {
  assert.equal(sleepDurationMin(90), 10);
});

test('duration floor boundary: raw ceil ≥ 10 first at energy ≤ 67', () => {
  assert.equal(sleepDurationMin(67), 10); // ceil(9.9) = 10 — exactly the floor
  assert.equal(sleepDurationMin(66), 11); // ceil(10.2) = 11 — above the floor
  assert.equal(sleepDurationMin(69), 10); // ceil(9.3) = 10 via the floor
});

test('duration formula: energy 50 → 15 min, energy 33.4 → 20 min (ceil)', () => {
  assert.equal(sleepDurationMin(50), 15);
  assert.equal(sleepDurationMin(33.4), Math.max(10, Math.ceil((30 * 66.6) / 100)));
});

test('duration clamps out-of-range energy inputs', () => {
  assert.equal(sleepDurationMin(-20), 30);
  assert.equal(sleepDurationMin(150), 10);
});

// ---------------------------------------------------------------- canSleep

test('canSleep: only below the §C1.4 energy-70 gate', () => {
  assert.equal(canSleep(state({ energy: 69.9 })), true);
  assert.equal(canSleep(state({ energy: 70 })), false);
  assert.equal(canSleep(state({ energy: 100 })), false);
  assert.equal(canSleep(state({ energy: 10 })), true);
});

test('canSleep: never while already sleeping', () => {
  assert.equal(canSleep(sleepingState({ energy: 10 })), false);
});

// ---------------------------------------------------------------- startSleep

test('startSleep sets sleeping/startedAt/wakeAt = now + duration', () => {
  const s = startSleep(state({ energy: 10 }), T0);
  assert.equal(s.sleep.sleeping, true);
  assert.equal(s.sleep.startedAt, T0);
  assert.equal(s.sleep.wakeAt, T0 + 27 * MIN); // ceil(30·90/100) = 27
  assert.equal(isSleeping(s), true);
});

test('startSleep is pure (input state untouched)', () => {
  const before = state({ energy: 10 });
  const snapshot = JSON.stringify(before);
  startSleep(before, T0);
  assert.equal(JSON.stringify(before), snapshot);
});

test('sleepRemainingMs counts down and floors at 0', () => {
  const s = sleepingState({ energy: 10 }); // 27 min
  assert.equal(sleepRemainingMs(s, T0), 27 * MIN);
  assert.equal(sleepRemainingMs(s, T0 + 20 * MIN), 7 * MIN);
  assert.equal(sleepRemainingMs(s, T0 + 60 * MIN), 0);
  assert.equal(sleepRemainingMs(state(), T0), 0); // not sleeping
});

// ---------------------------------------------------------------- tickSleep

test('tickSleep fills energy at 3.334/min and half-decays hunger', () => {
  const s0 = sleepingState({ energy: 10, hunger: 80 });
  const { state: s, events } = tickSleep(s0, T0 + 10 * MIN);
  assert.equal(events.length, 0);
  assert.ok(Math.abs(s.stats.energy - (10 + 33.34)) < 1e-9, `energy ${s.stats.energy}`);
  assert.ok(Math.abs(s.stats.hunger - (80 - 1.75)) < 1e-9, `hunger ${s.stats.hunger}`);
  assert.equal(s.lastTickAt, T0 + 10 * MIN);
  assert.equal(s.sleep.sleeping, true);
});

test('tickSleep: hygiene and fun are frozen while asleep', () => {
  const s0 = sleepingState({ energy: 10, hygiene: 40, fun: 30 });
  const { state: s } = tickSleep(s0, T0 + 15 * MIN);
  assert.equal(s.stats.hygiene, 40);
  assert.equal(s.stats.fun, 30);
});

test('tickSleep auto-wakes at wakeAt with completed grants', () => {
  const s0 = sleepingState({ energy: 10 }); // wakeAt = T0 + 27 min
  const { state: s, events } = tickSleep(s0, T0 + 27 * MIN);
  assert.deepEqual(events, ['wokeUp']);
  assert.equal(s.sleep.sleeping, false);
  assert.ok(s.stats.energy >= 99, `energy after full sleep = ${s.stats.energy}`);
  assert.equal(s.xp, XP.COMPLETED_SLEEP);
  assert.equal(s.achievements.counters.sleeps, 1);
});

test('tickSleep auto-wakes when energy hits 100 before wakeAt', () => {
  // Force a long wakeAt but nearly-full energy: 1 min of fill crosses 100.
  const s0 = state({ energy: 99 });
  s0.sleep = { sleeping: true, startedAt: T0, wakeAt: T0 + 30 * MIN };
  const { state: s, events } = tickSleep(s0, T0 + 5 * MIN);
  assert.deepEqual(events, ['wokeUp']);
  assert.equal(s.sleep.sleeping, false);
  assert.equal(s.stats.energy, STATS.MAX);
});

test('tickSleep clamps asleep fill to wakeAt (no over-fill past the alarm)', () => {
  const s0 = sleepingState({ energy: 10, hunger: 80 }); // 27 min
  const { state: s } = tickSleep(s0, T0 + 100 * MIN);
  // hunger decayed for exactly 27 asleep minutes, not 100
  assert.ok(Math.abs(s.stats.hunger - (80 - 0.175 * 27)) < 1e-9, `hunger ${s.stats.hunger}`);
});

test('tickSleep is a no-op when awake', () => {
  const s0 = state({ energy: 50 });
  const { state: s, events } = tickSleep(s0, T0 + 10 * MIN);
  assert.equal(s, s0);
  assert.equal(events.length, 0);
});

// ---------------------------------------------------------------- early wake

test('canWakeEarly: only after 5 minutes of sleep (§C1.4)', () => {
  const s = sleepingState({ energy: 10 });
  assert.equal(canWakeEarly(s, T0), false);
  assert.equal(canWakeEarly(s, T0 + 4 * MIN + 59000), false);
  assert.equal(canWakeEarly(s, T0 + 5 * MIN), true);
  assert.equal(canWakeEarly(state(), T0 + 60 * MIN), false); // not sleeping
});

test('early wake keeps accrued energy, sets grumpyUntil = now + 10 min, no grants', () => {
  const s0 = sleepingState({ energy: 10 });
  const mid = tickSleep(s0, T0 + 6 * MIN).state; // energy accrued for 6 min
  const accrued = mid.stats.energy;
  const { state: s, events } = wakeUp(mid, T0 + 6 * MIN, { early: true });
  assert.deepEqual(events, ['wokeEarly']);
  assert.equal(s.sleep.sleeping, false);
  assert.equal(s.stats.energy, accrued); // kept, not reset
  assert.equal(s.grumpyUntil, T0 + 6 * MIN + SLEEP.EARLY_WAKE_DEBUFF_MIN * MIN);
  assert.equal(s.xp, 0); // no completed-sleep XP
  assert.equal(s.achievements.counters.sleeps, 0);
});

test('completed wake grants XP +10 and increments the sleeps counter', () => {
  const s0 = sleepingState({ energy: 10 });
  const { state: s, events } = wakeUp(s0, T0 + 27 * MIN, { early: false });
  assert.deepEqual(events, ['wokeUp']);
  assert.equal(s.xp, XP.COMPLETED_SLEEP);
  assert.equal(s.achievements.counters.sleeps, 1);
  assert.equal(s.grumpyUntil, 0); // no debuff on a completed sleep
});

test('completed-sleep grants handle level-ups (XP curve + coin reward)', () => {
  const s0 = state();
  s0.xp = 95; // L1→2 needs 100; +10 crosses it
  const s = applyCompletedSleepGrants(s0);
  assert.equal(s.level, 2);
  assert.equal(s.xp, 5);
  assert.equal(s.coins, s0.coins + XP.LEVEL_UP_COINS_PER_LEVEL * 2);
  assert.equal(s.achievements.counters.sleeps, 1);
});

// ---------------------------------------------------------------- grumpy debuff

test('grumpy debuff: −15 mood while active, expires exactly at grumpyUntil', () => {
  const until = T0 + 10 * MIN;
  const s = state({ hunger: 80, energy: 80, hygiene: 80, fun: 80 }, { grumpyUntil: until });
  assert.equal(grumpyDebuff(s, T0), SLEEP.EARLY_WAKE_MOOD_DEBUFF);
  assert.equal(grumpyDebuff(s, until - 1), SLEEP.EARLY_WAKE_MOOD_DEBUFF);
  assert.equal(grumpyDebuff(s, until), 0);
  assert.equal(grumpyDebuff(s, until + 1), 0);
});

test('currentMood applies the debuff (all-80 stats: 80 → 65 while grumpy)', () => {
  const until = T0 + 10 * MIN;
  const s = state({ hunger: 80, energy: 80, hygiene: 80, fun: 80 }, { grumpyUntil: until });
  assert.equal(currentMood(s, T0), 65);
  assert.equal(currentMood(s, until), 80);
});

test('grumpyDebuff tolerates missing/zero grumpyUntil', () => {
  assert.equal(grumpyDebuff(state(), T0), 0);
  assert.equal(grumpyDebuff({}, T0), 0);
});

test('currentMood clamps to the valid 0–100 range under the debuff', () => {
  // rock-bottom stats: raw mood 0 − 15 must clamp at 0, never go negative
  const low = state(
    { hunger: 0, energy: 0, hygiene: 0, fun: 0 },
    { grumpyUntil: T0 + 10 * MIN }
  );
  assert.equal(currentMood(low, T0), 0);
  const high = state({ hunger: 100, energy: 100, hygiene: 100, fun: 100 });
  assert.equal(currentMood(high, T0), 100); // no debuff → formula clamps high end
});

test('early wake → currentMood shows −15 until grumpyUntil expires, then recovers', () => {
  // The display path (home/homeScene.js refreshEmotionInputs + home/
  // interactions.js restoreEmotion) reads currentMood — this pins the contract.
  const s0 = sleepingState({ hunger: 80, energy: 60, hygiene: 80, fun: 80 });
  const wakeAt = T0 + 6 * MIN;
  const { state: s } = wakeUp(tickSleep(s0, wakeAt).state, wakeAt, { early: true });
  const plain = currentMood({ ...s, grumpyUntil: 0 }, wakeAt);
  assert.equal(currentMood(s, wakeAt), plain - SLEEP.EARLY_WAKE_MOOD_DEBUFF);
  const expiry = wakeAt + SLEEP.EARLY_WAKE_DEBUFF_MIN * MIN;
  assert.equal(currentMood(s, expiry - 1), plain - SLEEP.EARLY_WAKE_MOOD_DEBUFF);
  assert.equal(currentMood(s, expiry), plain); // debuff over — mood recovers
});

// ------------------------------------------------------- full-cycle integration

test('full cycle: start → partial ticks → auto-wake, energy ends at 100', () => {
  let s = startSleep(state({ energy: 5 }), T0); // 29 min
  assert.equal(s.sleep.wakeAt, T0 + 29 * MIN);
  for (let m = 1; m <= 29; m++) {
    const r = tickSleep(s, T0 + m * MIN);
    s = r.state;
    if (m < 29) assert.equal(s.sleep.sleeping, true, `still asleep at minute ${m}`);
    else assert.deepEqual(r.events, ['wokeUp']);
  }
  assert.equal(s.sleep.sleeping, false);
  assert.equal(s.stats.energy, STATS.MAX); // 5 + 29·3.334 = 101.7 → clamped
  assert.equal(s.achievements.counters.sleeps, 1);
});
