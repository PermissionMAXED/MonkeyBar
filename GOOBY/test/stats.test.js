// Stats decay / mood / clamps vs the §C1 numbers (binding).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTick,
  applyDeltas,
  clampStat,
  clampStats,
  mood,
  moodBand,
  isLow,
  isCritical,
  isExhausted,
} from '../src/systems/stats.js';
import { STATS, OFFLINE } from '../src/data/constants.js';

const FULL = { hunger: 100, energy: 100, hygiene: 100, fun: 100 };

test('awake decay rates match §C1 (per minute)', () => {
  const s = applyTick({ ...FULL }, 1);
  assert.equal(+(100 - s.hunger).toFixed(4), 0.35);
  assert.equal(+(100 - s.energy).toFixed(4), 0.25);
  assert.equal(+(100 - s.hygiene).toFixed(4), 0.15);
  assert.equal(+(100 - s.fun).toFixed(4), 0.5);
});

test('awake decay scales linearly with dt (10 minutes)', () => {
  const s = applyTick({ ...FULL }, 10);
  assert.equal(+s.hunger.toFixed(4), 96.5);
  assert.equal(+s.fun.toFixed(4), 95);
});

test('asleep rates: hunger half decay, energy fills at 3.334/min, hygiene/fun frozen', () => {
  const start = { hunger: 50, energy: 10, hygiene: 40, fun: 30 };
  const s = applyTick(start, 1, { asleep: true });
  assert.equal(+(start.hunger - s.hunger).toFixed(4), 0.175);
  assert.equal(+(s.energy - start.energy).toFixed(4), 3.334);
  assert.equal(s.hygiene, 40);
  assert.equal(s.fun, 30);
});

test('asleep energy fill 0→100 in ~30 min', () => {
  const s = applyTick({ hunger: 100, energy: 0, hygiene: 100, fun: 100 }, 30, { asleep: true });
  assert.ok(s.energy >= 100, `energy after 30 min asleep = ${s.energy}`);
});

test('offline rate multiplier 0.3× (§E4)', () => {
  const s = applyTick({ ...FULL }, 10, { rateMult: OFFLINE.AWAKE_RATE_MULT });
  assert.equal(+(100 - s.hunger).toFixed(4), +(0.35 * 10 * 0.3).toFixed(4));
});

test('stats clamp to [0, 100]', () => {
  const low = applyTick({ hunger: 1, energy: 1, hygiene: 1, fun: 1 }, 1000);
  for (const k of STATS.KEYS) assert.equal(low[k], k === 'energy' ? 0 : 0);
  const high = applyTick({ hunger: 99, energy: 99, hygiene: 99, fun: 99 }, 1000, { asleep: true });
  assert.equal(high.energy, 100);
  assert.equal(clampStat(-5), 0);
  assert.equal(clampStat(105), 100);
  const c = clampStats({ hunger: -20, energy: 260, hygiene: 'x', fun: 55 });
  assert.deepEqual(c, { hunger: 0, energy: 100, hygiene: 0, fun: 55 });
});

test('mood formula: 0.35*min + 0.65*avg (§C1)', () => {
  // new-game defaults: min 70, avg (80+90+85+70)/4 = 81.25 → 77.3125
  const m = mood({ hunger: 80, energy: 90, hygiene: 85, fun: 70 });
  assert.equal(+m.toFixed(4), +(0.35 * 70 + 0.65 * 81.25).toFixed(4));
  assert.equal(mood(FULL), 100);
  assert.equal(mood({ hunger: 0, energy: 0, hygiene: 0, fun: 0 }), 0);
});

test('mood bands (§C1): ≥80 ecstatic, 60–79 happy, 40–59 neutral, 25–39 grumpy, <25 miserable', () => {
  assert.equal(moodBand(80), 'ecstatic');
  assert.equal(moodBand(100), 'ecstatic');
  assert.equal(moodBand(79.9), 'happy');
  assert.equal(moodBand(60), 'happy');
  assert.equal(moodBand(59.9), 'neutral');
  assert.equal(moodBand(40), 'neutral');
  assert.equal(moodBand(39.9), 'grumpy');
  assert.equal(moodBand(25), 'grumpy');
  assert.equal(moodBand(24.9), 'miserable');
  assert.equal(moodBand(0), 'miserable');
});

test('exhausted (energy ≤ 15) caps mood at 39 (§C1)', () => {
  const m = mood({ hunger: 100, energy: 15, hygiene: 100, fun: 100 });
  assert.equal(m, STATS.EXHAUSTED_MOOD_CAP);
  // energy 16 is NOT exhausted → no cap
  const m2 = mood({ hunger: 100, energy: 16, hygiene: 100, fun: 100 });
  assert.ok(m2 > 39);
  assert.equal(isExhausted({ hunger: 50, energy: 15, hygiene: 50, fun: 50 }), true);
  assert.equal(isExhausted({ hunger: 50, energy: 15.1, hygiene: 50, fun: 50 }), false);
});

test('mood debuff option (early-wake grumpy −15, §C1.4)', () => {
  const base = mood(FULL);
  const debuffed = mood(FULL, { debuff: 15 });
  assert.equal(debuffed, base - 15);
  assert.equal(mood({ hunger: 5, energy: 50, hygiene: 5, fun: 5 }, { debuff: 100 }), 0);
});

test('low/critical thresholds (§C1: LOW 25, CRITICAL 10)', () => {
  assert.equal(isLow(24.9), true);
  assert.equal(isLow(25), false);
  assert.equal(isCritical(9.9), true);
  assert.equal(isCritical(10), false);
});

test('applyDeltas applies food/wash deltas with clamping', () => {
  const s = applyDeltas({ hunger: 95, energy: 50, hygiene: 99, fun: 1 }, { hunger: 40, hygiene: 2, fun: -5 });
  assert.deepEqual(s, { hunger: 100, energy: 50, hygiene: 100, fun: 0 });
});

test('applyTick is pure (input untouched)', () => {
  const input = { ...FULL };
  applyTick(input, 5);
  assert.deepEqual(input, FULL);
});

// ------------------------------------------- V2/FIX-A (E9): NaN guards
// clampStat used to pass NaN straight through Math.min/max, so one NaN input
// (e.g. a wrong-typed sleep slice feeding NaN minutes into the offline sim)
// poisoned every stat forever. Non-finite now falls back to STATS.MIN.

test('V2/FIX-A: clampStat never returns a non-finite value', () => {
  assert.equal(clampStat(NaN), STATS.MIN);
  assert.equal(clampStat(Infinity), STATS.MIN);
  assert.equal(clampStat(-Infinity), STATS.MIN);
  assert.equal(clampStat('wat'), STATS.MIN);
  assert.equal(clampStat(undefined), STATS.MIN);
  assert.equal(clampStat(null), STATS.MIN); // Number(null) = 0 → finite → 0 anyway
  assert.equal(clampStat('42'), 42); // numeric strings still coerce
  assert.equal(clampStat(55.5), 55.5); // normal floats untouched
});

test('V2/FIX-A: applyTick with NaN inputs yields finite stats (never persists NaN)', () => {
  // NaN dtMin (the E9 offline repro: wakeAt 'tomorrow' − lastTickAt = NaN)
  const fromNaNDt = applyTick({ ...FULL }, NaN);
  for (const k of STATS.KEYS) assert.ok(Number.isFinite(fromNaNDt[k]), `${k} finite (NaN dt)`);
  // already-poisoned stats recover to finite values on the next tick
  const poisoned = { hunger: NaN, energy: NaN, hygiene: NaN, fun: NaN };
  const recovered = applyTick(poisoned, 1);
  for (const k of STATS.KEYS) assert.ok(Number.isFinite(recovered[k]), `${k} finite (NaN stats)`);
  // applyDeltas is covered by the same clamp
  const d = applyDeltas(poisoned, { hunger: 10 });
  for (const k of STATS.KEYS) assert.ok(Number.isFinite(d[k]), `${k} finite (deltas)`);
});
