// Profile stats accumulator (§C12.1): playtime accumulation from the 1 s
// tick, lifetime coin earned/spent totals, driven distance, photo counter —
// all pure on the §B2 `profile` slice, robust to missing fields.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tickPlaytime,
  onCoins,
  onDistance,
  onPhoto,
} from '../src/systems/profileStats.js';

/** Fresh §B2 profile slice (defaults land in save.js with G16). */
function freshProfile() {
  return { playtimeMin: 0, coinsEarned: 0, coinsSpent: 0, distanceM: 0, photos: 0 };
}

// -------------------------------------------------------------- playtime

test('tickPlaytime accumulates fractional minutes — 60 one-second ticks ≈ 1 min (§C12.1)', () => {
  let p = freshProfile();
  for (let i = 0; i < 60; i += 1) p = tickPlaytime(p, 1 / 60);
  assert.ok(Math.abs(p.playtimeMin - 1) < 1e-9);
  p = tickPlaytime(p, 90); // an offline-free long session chunk
  assert.ok(Math.abs(p.playtimeMin - 91) < 1e-9);
});

test('tickPlaytime: zero/negative/NaN dt is a same-reference no-op', () => {
  const p = freshProfile();
  assert.equal(tickPlaytime(p, 0), p);
  assert.equal(tickPlaytime(p, -5), p);
  assert.equal(tickPlaytime(p, NaN), p);
  assert.equal(tickPlaytime(p, Infinity), p);
});

// ----------------------------------------------------------------- coins

test('onCoins accumulates earned and spent independently (§B3: fed by economy)', () => {
  let p = freshProfile();
  p = onCoins(p, { earned: 30 }); // minigame payout
  p = onCoins(p, { spent: 12 }); // food purchase
  p = onCoins(p, { earned: 25, spent: 40 });
  assert.equal(p.coinsEarned, 55);
  assert.equal(p.coinsSpent, 52);
});

test('onCoins: zero/missing/negative deltas are a same-reference no-op', () => {
  const p = freshProfile();
  assert.equal(onCoins(p, {}), p);
  assert.equal(onCoins(p, undefined), p);
  assert.equal(onCoins(p, { earned: 0, spent: 0 }), p);
  assert.equal(onCoins(p, { earned: -10 }), p); // spends are reported as {spent}
});

// -------------------------------------------------------------- distance

test('onDistance accumulates driven metres across trips (§C12.1 km display)', () => {
  let p = freshProfile();
  p = onDistance(p, 420.5);
  p = onDistance(p, 79.5);
  assert.equal(p.distanceM, 500);
  assert.equal(onDistance(p, 0), p);
  assert.equal(onDistance(p, -3), p);
});

// ---------------------------------------------------------------- photos

test('onPhoto increments the capture counter (§C12.2)', () => {
  let p = freshProfile();
  p = onPhoto(p);
  p = onPhoto(p);
  assert.equal(p.photos, 2);
});

// ----------------------------------------------------- purity/robustness

test('all accumulators are pure and tolerate sparse slices (mergeDefaults safety)', () => {
  const frozen = Object.freeze(freshProfile());
  const p2 = tickPlaytime(frozen, 5);
  assert.equal(p2.playtimeMin, 5);
  assert.equal(frozen.playtimeMin, 0);
  onCoins(frozen, { earned: 1 });
  onDistance(frozen, 1);
  onPhoto(frozen);
  assert.deepEqual(frozen, freshProfile());
  // sparse/legacy slice: missing fields count from 0 instead of NaN
  const sparse = Object.freeze({});
  assert.equal(tickPlaytime(sparse, 2).playtimeMin, 2);
  assert.deepEqual(onCoins(sparse, { earned: 5, spent: 3 }), { coinsEarned: 5, coinsSpent: 3 });
  assert.equal(onDistance(sparse, 7).distanceM, 7);
  assert.equal(onPhoto(sparse).photos, 1);
});

test('a realistic session: tick + coins + distance + photo compose into the §C12.1 totals', () => {
  let p = freshProfile();
  for (let i = 0; i < 15 * 60; i += 1) p = tickPlaytime(p, 1 / 60); // 15-min session
  p = onCoins(p, { earned: 60 }); // quests + minigames
  p = onCoins(p, { spent: 14 }); // fries
  p = onDistance(p, 1250); // one shop trip
  p = onPhoto(p);
  assert.ok(Math.abs(p.playtimeMin - 15) < 1e-6);
  assert.equal(p.coinsEarned, 60);
  assert.equal(p.coinsSpent, 14);
  assert.equal(p.distanceM, 1250);
  assert.equal(p.photos, 1);
});
