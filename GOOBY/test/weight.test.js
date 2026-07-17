// Weight model (§B5/§C4) vs the binding numbers: gain/loss per source,
// clamp [5, 95], drift toward 50 both directions (incl. offline 0.3×),
// exact hysteresis-free tier boundaries 25/60/85, ACTIVE_GAMES ids.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEIGHT,
  clampWeight,
  onEat,
  onMinigameEnd,
  onBallFetch,
  tick,
  tierOf,
} from '../src/systems/weight.js';

// The 12 shipped v1 game ids (fixture copied from data/minigames.js
// MINIGAME_IDS — NOT imported: wave-1 engines/tests stay catalog-independent
// per §E0.1-3 while G16 edits the data spine concurrently).
const V1_GAME_IDS = [
  'carrotCatch',
  'bunnyHop',
  'cityDrive',
  'carrotGuard',
  'memoryMatch',
  'basketBounce',
  'pancakeTower',
  'runner',
  'bubblePop',
  'fishingPond',
  'danceParty',
  'trampoline',
];

const JUNK = { id: 'cake', junk: true };
const VEGGIE = { id: 'carrot', junk: false };

/** §B2 weight slice. */
function slice(value = WEIGHT.DEFAULT) {
  return { value };
}

// ------------------------------------------------------------------- consts

test('WEIGHT consts are the §B5/§C4 numbers verbatim and frozen', () => {
  assert.equal(WEIGHT.MIN, 5);
  assert.equal(WEIGHT.MAX, 95);
  assert.equal(WEIGHT.DEFAULT, 50);
  assert.equal(WEIGHT.EAT_JUNK, 2);
  assert.equal(WEIGHT.EAT_HEALTHY, 0.5);
  assert.equal(WEIGHT.GAME_ACTIVE, -1);
  assert.equal(WEIGHT.GAME_OTHER, -0.25);
  assert.equal(WEIGHT.BALL_FETCH, -0.2);
  assert.equal(WEIGHT.DRIFT_TARGET, 50);
  assert.equal(WEIGHT.DRIFT_PER_DAY, 2);
  assert.equal(WEIGHT.DRIFT_PER_MIN, 2 / 1440);
  assert.equal(WEIGHT.TIER_SLEEK_MAX, 25);
  assert.equal(WEIGHT.TIER_CHUBBY_MAX, 60);
  assert.equal(WEIGHT.TIER_CHONKY_MAX, 85);
  assert.ok(Object.isFrozen(WEIGHT));
  assert.ok(Object.isFrozen(WEIGHT.ACTIVE_GAMES));
});

test('ACTIVE_GAMES is the §B5 list verbatim', () => {
  assert.deepEqual(
    [...WEIGHT.ACTIVE_GAMES],
    ['runner', 'trampoline', 'danceParty', 'bunnyHop', 'gardenRush', 'veggieChop', 'goalieGooby', 'starHopper']
  );
});

test('ACTIVE_GAMES v1 entries match shipped minigame ids; the rest are the four 2.0 games', () => {
  const v1 = WEIGHT.ACTIVE_GAMES.filter((id) => V1_GAME_IDS.includes(id));
  assert.deepEqual(v1, ['runner', 'trampoline', 'danceParty', 'bunnyHop']);
  const future = WEIGHT.ACTIVE_GAMES.filter((id) => !V1_GAME_IDS.includes(id));
  // Wave-3/4 forward references (§C1) — just strings until those games land.
  assert.deepEqual(future, ['gardenRush', 'veggieChop', 'goalieGooby', 'starHopper']);
});

test('TIER_SCALE covers all four tiers with the §C4.3 scales', () => {
  assert.deepEqual({ ...WEIGHT.TIER_SCALE }, { sleek: 0.93, chubby: 1.0, chonky: 1.07, floof: 1.14 });
  assert.deepEqual([...WEIGHT.TIERS], ['sleek', 'chubby', 'chonky', 'floof']);
});

// -------------------------------------------------------- gain/loss sources

test('onEat: junk +2.0, healthy +0.5 (§B5)', () => {
  assert.equal(onEat(slice(50), JUNK).value, 52);
  assert.equal(onEat(slice(50), VEGGIE).value, 50.5);
});

test('onMinigameEnd: every ACTIVE_GAMES id burns −1.0', () => {
  for (const id of WEIGHT.ACTIVE_GAMES) {
    assert.equal(onMinigameEnd(slice(50), id).value, 49, id);
  }
});

test('onMinigameEnd: all other games burn −0.25', () => {
  for (const id of ['carrotCatch', 'memoryMatch', 'cityDrive', 'fishingPond', 'miniGolf', '_smoke']) {
    assert.equal(onMinigameEnd(slice(50), id).value, 49.75, id);
  }
});

test('onBallFetch: −0.2 (§B5)', () => {
  assert.equal(onBallFetch(slice(50)).value, 49.8);
});

// -------------------------------------------------------------------- clamp

test('clamp: gains stop at 95, losses stop at 5', () => {
  assert.equal(onEat(slice(94.5), JUNK).value, 95);
  assert.equal(onEat(slice(95), JUNK).value, 95);
  assert.equal(onMinigameEnd(slice(5.5), 'runner').value, 5);
  assert.equal(onBallFetch(slice(5)).value, 5);
});

test('clampWeight bounds and coerces bad input to the default', () => {
  assert.equal(clampWeight(120), 95);
  assert.equal(clampWeight(-10), 5);
  assert.equal(clampWeight(60), 60);
  assert.equal(clampWeight(NaN), 50);
});

// -------------------------------------------------------------------- drift

test('drift: 2.0 per 24 h toward 50, both directions (§B5)', () => {
  assert.equal(tick(slice(60), 1440).value, 58);
  assert.equal(tick(slice(40), 1440).value, 42);
});

test('drift per-minute rate is 2/1440 (§B5: ≈ 0.00139/min)', () => {
  const after = tick(slice(60), 1).value;
  assert.ok(Math.abs(after - (60 - 2 / 1440)) < 1e-12, `value ${after}`);
});

test('drift never overshoots 50 and holds there', () => {
  assert.equal(tick(slice(50.5), 1440).value, 50);
  assert.equal(tick(slice(49.9), 1440).value, 50);
  assert.equal(tick(slice(50), 100000).value, 50);
});

test('offline drift uses the 0.3× multiplier (§B5 / §E4 rules)', () => {
  // 480 sim-min cap is the CALLER's job (same contract as stats.applyTick).
  const after = tick(slice(60), 480, 0.3).value;
  assert.ok(Math.abs(after - (60 - (2 / 1440) * 480 * 0.3)) < 1e-12, `value ${after}`); // −0.2
});

test('tick with mult omitted defaults to real-time (mult = 1)', () => {
  assert.equal(tick(slice(60), 720).value, 59);
});

// ---------------------------------------------------------------- tier map

test('tierOf boundaries are exact and hysteresis-free (25/60/85, §C4.3)', () => {
  assert.equal(tierOf(25), 'sleek');
  assert.equal(tierOf(25.001), 'chubby');
  assert.equal(tierOf(26), 'chubby');
  assert.equal(tierOf(60), 'chubby');
  assert.equal(tierOf(60.001), 'chonky');
  assert.equal(tierOf(61), 'chonky');
  assert.equal(tierOf(85), 'chonky');
  assert.equal(tierOf(85.001), 'floof');
  assert.equal(tierOf(86), 'floof');
});

test('tierOf across the clamp range: 5 sleek, 50 chubby (default), 95 floof', () => {
  assert.equal(tierOf(WEIGHT.MIN), 'sleek');
  assert.equal(tierOf(WEIGHT.DEFAULT), 'chubby');
  assert.equal(tierOf(WEIGHT.MAX), 'floof');
});

// ------------------------------------------------------------------- purity

test('all mutators are pure (input slice untouched)', () => {
  const before = slice(60);
  const snapshot = JSON.stringify(before);
  onEat(before, JUNK);
  onMinigameEnd(before, 'runner');
  onBallFetch(before);
  tick(before, 1440);
  assert.equal(JSON.stringify(before), snapshot);
});

test('normalizes a corrupt slice (missing/NaN value → default, out-of-range clamps)', () => {
  assert.equal(tick({}, 0).value, 50);
  assert.equal(tick({ value: NaN }, 0).value, 50);
  assert.equal(onEat({ value: 300 }, VEGGIE).value, 95);
});

// -------------------------------------------------- integration: a fat week

test('junk-heavy week then active play: weight rises, tiers shift, clamp holds', () => {
  let w = slice();
  for (let i = 0; i < 10; i++) w = onEat(w, JUNK); // +20 → 70
  assert.equal(w.value, 70);
  assert.equal(tierOf(w.value), 'chonky');
  for (let i = 0; i < 12; i++) w = onMinigameEnd(w, 'trampoline'); // −12 → 58
  assert.equal(w.value, 58);
  assert.equal(tierOf(w.value), 'chubby');
  w = tick(w, 4 * 1440); // 4 days drift: −8 → 50 exactly
  assert.equal(w.value, 50);
});
