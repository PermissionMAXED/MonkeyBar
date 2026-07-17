// Minigames D (PLAN2 §C1.2 #1–#3, agent V2/G24): pure logic tests for
// goobySays, gardenRush and burgerBuild against their <id>.logic.js siblings
// (which import no three.js/DOM — §B rule). §C1.5 scope: goobySays sequence
// gen determinism + speed floor; gardenRush wilt-timer ramp + perfect-zone
// math; burgerBuild ticket gen + next-needed matcher.
//
// V2/G27 APPENDS the veggieChop + goalieGooby §C1.5 blocks to THIS file in
// wave 4 — append below the V2/G24 blocks, do not reorder them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SAYS,
  seqLengthAt,
  stepMsAt,
  extendSequence,
  speedBonus,
  roundScore,
  autoplayErrAt,
} from '../src/minigames/games/goobySays.logic.js';
import {
  RUSH,
  wiltWindowAt,
  spawnIntervalAt,
  activePotsAt,
  releasePoints,
  inPerfectZone,
  rollWeed,
  applyPoints,
} from '../src/minigames/games/gardenRush.logic.js';
import {
  BURGER,
  INGREDIENTS,
  MODEL_KEYS,
  FALLING_IDS,
  makeTicket,
  nextNeeded,
  isComplete,
  fallSpeedAt,
  rollSpawn,
  applyCatch,
} from '../src/minigames/games/burgerBuild.logic.js';
import { COIN_TABLE } from '../src/data/constants.js';
import { computeCoins } from '../src/data/minigames.js';
import { EN, DE } from '../src/data/strings.js';

/** Deterministic rng (mulberry32) for seeded determinism checks. */
function rngFrom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) | 0;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// purity: the logic siblings must not import three.js/DOM (§B rule)
// ---------------------------------------------------------------------------

test('V2/G24 .logic.js modules import no three.js/DOM', () => {
  for (const id of ['goobySays', 'gardenRush', 'burgerBuild']) {
    const src = readFileSync(
      fileURLToPath(new URL(`../src/minigames/games/${id}.logic.js`, import.meta.url)),
      'utf8'
    );
    assert.ok(!/from\s+['"]three['"]/.test(src), `${id}.logic.js imports three`);
    assert.ok(!/document\.|window\./.test(src), `${id}.logic.js touches the DOM`);
  }
});

// ---------------------------------------------------------------------------
// #1 goobySays (§C1.2): sequence growth, playback ramp + floor, score math
// ---------------------------------------------------------------------------

test('goobySays: §C1.2 #1 binding numbers verbatim', () => {
  assert.equal(SAYS.PADS, 4);
  assert.equal(SAYS.START_LEN, 3);
  assert.equal(SAYS.GROW_PER_ROUND, 1);
  assert.equal(SAYS.ROUND_POINTS, 10);
  assert.equal(SAYS.STEP_DECAY_PCT, 0.05);
  assert.equal(SAYS.STEP_FLOOR_MS, 320);
  assert.equal(SAYS.SPEED_BONUS_MAX, 8);
  assert.equal(SAYS.REACTION_FULL_MS, 500);
  assert.equal(SAYS.AUTOPLAY_TAP_MS, 250);
});

test('goobySays: sequence starts at 3 and grows +1 per round', () => {
  assert.equal(seqLengthAt(1), 3);
  assert.equal(seqLengthAt(2), 4);
  assert.equal(seqLengthAt(10), 12);
});

test('goobySays: playback speeds up 5%/round with a 320 ms floor (§C1.2)', () => {
  assert.equal(stepMsAt(1), SAYS.STEP_BASE_MS);
  assert.ok(Math.abs(stepMsAt(2) - SAYS.STEP_BASE_MS * 0.95) < 1e-9);
  assert.ok(Math.abs(stepMsAt(4) - SAYS.STEP_BASE_MS * 0.95 ** 3) < 1e-9);
  // monotone non-increasing, then pinned at the floor forever
  let prev = Infinity;
  for (let r = 1; r <= 60; r += 1) {
    const ms = stepMsAt(r);
    assert.ok(ms <= prev, `round ${r} not slower than round ${r - 1}`);
    assert.ok(ms >= SAYS.STEP_FLOOR_MS, `round ${r} under the 320 ms floor`);
    prev = ms;
  }
  assert.equal(stepMsAt(60), SAYS.STEP_FLOOR_MS);
});

test('goobySays: sequence generation is deterministic per seed', () => {
  for (const seed of [1, 7, 42, 20260717]) {
    let a = [];
    let b = [];
    const rngA = rngFrom(seed);
    const rngB = rngFrom(seed);
    for (let i = 0; i < 20; i += 1) {
      a = extendSequence(a, rngA);
      b = extendSequence(b, rngB);
    }
    assert.deepEqual(a, b, `seed ${seed} diverged`);
    assert.equal(a.length, 20);
    assert.ok(a.every((p) => Number.isInteger(p) && p >= 0 && p < SAYS.PADS));
  }
  // different seeds diverge (sanity, not a hard guarantee — these do)
  const s1 = [];
  const s2 = [];
  const r1 = rngFrom(1);
  const r2 = rngFrom(2);
  assert.notDeepEqual(
    Array.from({ length: 12 }, () => Math.floor(r1() * 4)),
    Array.from({ length: 12 }, () => Math.floor(r2() * 4))
  );
  assert.ok(Array.isArray(s1) && Array.isArray(s2));
});

test('goobySays: extendSequence is pure (returns a new array)', () => {
  const seq = [0, 1];
  const next = extendSequence(seq, rngFrom(3));
  assert.equal(seq.length, 2);
  assert.equal(next.length, 3);
  assert.notEqual(seq, next);
});

test('goobySays: speed bonus 0–8, full under 500 ms average (§C1.2)', () => {
  assert.equal(speedBonus(100), 8);
  assert.equal(speedBonus(500), 8);
  assert.equal(speedBonus(SAYS.REACTION_ZERO_MS), 0);
  assert.equal(speedBonus(99999), 0);
  assert.equal(speedBonus(Infinity), 0);
  const mid = speedBonus((SAYS.REACTION_FULL_MS + SAYS.REACTION_ZERO_MS) / 2);
  assert.equal(mid, 4); // linear midpoint
});

test('goobySays: score = 10·rounds + speedBonus; zero rounds = 0 (§C1.2)', () => {
  assert.equal(roundScore(0, 200), 0);
  assert.equal(roundScore(7, 250), 78);
  assert.equal(roundScore(7, 99999), 70);
  assert.equal(roundScore(10, 400), 108);
});

test('goobySays: bot slip chance ramps with the round and caps', () => {
  assert.equal(autoplayErrAt(1), 0); // short sequences are never flubbed
  assert.ok(Math.abs(autoplayErrAt(2) - SAYS.AUTOPLAY_ERR_RAMP) < 1e-12);
  assert.ok(autoplayErrAt(8) > autoplayErrAt(4));
  assert.equal(autoplayErrAt(9999), SAYS.AUTOPLAY_ERR_CAP);
});

test('goobySays: typical bot run pays inside the §C1.1 row (5/4/24)', () => {
  const row = COIN_TABLE.goobySays;
  assert.deepEqual({ ...row }, { divisor: 5, min: 4, max: 24 });
  assert.equal(computeCoins(row, roundScore(7, 250), false), 15); // ≈ typical ~16c
  assert.equal(computeCoins(row, roundScore(1, 250), false), 4); // early slip → min
  assert.equal(computeCoins(row, roundScore(30, 250), false), 24); // capped
});

// ---------------------------------------------------------------------------
// #2 gardenRush (§C1.2): wilt-timer ramp, perfect-zone math, waves, weeds
// ---------------------------------------------------------------------------

test('gardenRush: §C1.2 #2 binding numbers verbatim', () => {
  assert.equal(RUSH.DURATION_SEC, 60);
  assert.equal(RUSH.POTS, 8);
  assert.equal(RUSH.WILT_START_SEC, 6);
  assert.equal(RUSH.WILT_END_SEC, 3);
  assert.equal(RUSH.FILL_SEC, 0.8);
  assert.equal(RUSH.PERFECT_ZONE, 0.25);
  assert.equal(RUSH.PERFECT_PTS, 3);
  assert.equal(RUSH.EARLY_PTS, 1);
  assert.equal(RUSH.WILT_PTS, -2);
  assert.equal(RUSH.WEED_PTS, -1);
  assert.equal(RUSH.AUTOPLAY_HOLD_SEC, 0.75);
});

test('gardenRush: wilt window ramps 6 s → 3 s linearly and clamps (§C1.2)', () => {
  assert.equal(wiltWindowAt(0), 6);
  assert.ok(Math.abs(wiltWindowAt(30) - 4.5) < 1e-9);
  assert.equal(wiltWindowAt(60), 3);
  assert.equal(wiltWindowAt(9999), 3); // clamped past the end
  assert.equal(wiltWindowAt(-5), 6); // clamped before the start
});

test('gardenRush: perfect zone = the last 25% of the 0.8 s ring (§C1.2)', () => {
  // boundary: fill fraction exactly 0.75 is IN the green zone
  assert.equal(releasePoints(0.75), RUSH.PERFECT_PTS);
  assert.equal(releasePoints(0.7499), RUSH.EARLY_PTS);
  assert.equal(releasePoints(1), RUSH.PERFECT_PTS);
  assert.equal(releasePoints(1.4), RUSH.PERFECT_PTS); // clamps — held past full
  assert.equal(releasePoints(0.05), RUSH.EARLY_PTS);
  assert.ok(inPerfectZone(0.9375)); // the 0.75 s bot hold (§C1.2)
  assert.ok(!inPerfectZone(0.5));
  // in seconds: the bot's 0.75 s hold lands at 93.75% fill
  assert.ok(inPerfectZone(RUSH.AUTOPLAY_HOLD_SEC / RUSH.FILL_SEC));
});

test('gardenRush: waves add pots #7–8; spawn cadence tightens', () => {
  assert.equal(activePotsAt(0), 6);
  assert.equal(activePotsAt(RUSH.POT7_AT_SEC - 0.01), 6);
  assert.equal(activePotsAt(RUSH.POT7_AT_SEC), 7);
  assert.equal(activePotsAt(RUSH.POT8_AT_SEC), 8);
  assert.equal(activePotsAt(9999), 8);
  assert.equal(spawnIntervalAt(0), RUSH.SPAWN_START_SEC);
  assert.equal(spawnIntervalAt(60), RUSH.SPAWN_END_SEC);
  assert.ok(spawnIntervalAt(30) < RUSH.SPAWN_START_SEC);
  assert.ok(spawnIntervalAt(30) > RUSH.SPAWN_END_SEC);
});

test('gardenRush: weeds only after their intro time; score floors at 0', () => {
  const rng = rngFrom(5);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(rollWeed(rng, RUSH.WEED_FROM_SEC - 0.01), false);
  }
  let weeds = 0;
  for (let i = 0; i < 2000; i += 1) {
    if (rollWeed(rng, 30)) weeds += 1;
  }
  const rate = weeds / 2000;
  assert.ok(Math.abs(rate - RUSH.WEED_CHANCE) < 0.03, `weed rate ${rate} far from ${RUSH.WEED_CHANCE}`);
  assert.equal(applyPoints(0, RUSH.WILT_PTS), 0);
  assert.equal(applyPoints(1, RUSH.WILT_PTS), 0);
  assert.equal(applyPoints(10, RUSH.PERFECT_PTS), 13);
});

test('gardenRush: typical raw ≈ 42 pays inside the §C1.1 row (3/4/25)', () => {
  const row = COIN_TABLE.gardenRush;
  assert.deepEqual({ ...row }, { divisor: 3, min: 4, max: 25 });
  assert.equal(computeCoins(row, 42, false), 14); // ≈ typical
  assert.equal(computeCoins(row, 0, false), 4); // min clamp
  assert.equal(computeCoins(row, 999, false), 25); // max clamp
});

// ---------------------------------------------------------------------------
// #3 burgerBuild (§C1.2): ticket gen, next-needed matcher, ramp, spawn mix
// ---------------------------------------------------------------------------

test('burgerBuild: §C1.2 #3 binding numbers verbatim', () => {
  assert.equal(BURGER.DURATION_SEC, 75);
  assert.equal(BURGER.COLUMNS, 3);
  assert.equal(BURGER.MIN_LAYERS, 4);
  assert.equal(BURGER.MAX_LAYERS, 7);
  assert.equal(BURGER.CATCH_PTS, 5);
  assert.equal(BURGER.WRONG_PTS, -2);
  assert.equal(BURGER.COMPLETE_PTS, 15);
  assert.equal(BURGER.FALL_RAMP_PCT, 0.08);
  assert.deepEqual([...INGREDIENTS], ['patty', 'cheese', 'tomato', 'salad', 'onion']);
});

test('burgerBuild: tickets are seeded 4–7 layers, bun-capped (§C1.2)', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const ticket = makeTicket(rngFrom(seed));
    assert.ok(ticket.length >= BURGER.MIN_LAYERS && ticket.length <= BURGER.MAX_LAYERS,
      `seed ${seed}: length ${ticket.length}`);
    assert.equal(ticket[0], 'bun', `seed ${seed}: no bottom bun`);
    assert.equal(ticket[ticket.length - 1], 'bun', `seed ${seed}: no top bun`);
    for (const mid of ticket.slice(1, -1)) {
      assert.ok(INGREDIENTS.includes(mid), `seed ${seed}: bad middle '${mid}'`);
    }
  }
});

test('burgerBuild: ticket generation is deterministic per seed', () => {
  for (const seed of [3, 99, 4711]) {
    assert.deepEqual(makeTicket(rngFrom(seed)), makeTicket(rngFrom(seed)));
  }
  // both 4- and 7-layer tickets occur over many seeds
  const lengths = new Set();
  for (let seed = 1; seed <= 400; seed += 1) lengths.add(makeTicket(rngFrom(seed)).length);
  assert.ok(lengths.has(4) && lengths.has(7), `lengths seen: ${[...lengths]}`);
});

test('burgerBuild: next-needed matcher walks the ticket bottom-to-top', () => {
  const ticket = ['bun', 'patty', 'cheese', 'bun'];
  assert.equal(nextNeeded(ticket, 0), 'bun');
  assert.equal(nextNeeded(ticket, 1), 'patty');
  assert.equal(nextNeeded(ticket, 2), 'cheese');
  assert.equal(nextNeeded(ticket, 3), 'bun');
  assert.equal(nextNeeded(ticket, 4), null);
  assert.ok(!isComplete(ticket, 3));
  assert.ok(isComplete(ticket, 4));
});

test('burgerBuild: fall speed +8% per completed burger (§C1.2)', () => {
  assert.equal(fallSpeedAt(0), BURGER.FALL_BASE_SPEED);
  assert.ok(Math.abs(fallSpeedAt(1) - BURGER.FALL_BASE_SPEED * 1.08) < 1e-9);
  assert.ok(Math.abs(fallSpeedAt(3) - BURGER.FALL_BASE_SPEED * 1.08 ** 3) < 1e-9);
  assert.equal(fallSpeedAt(-2), BURGER.FALL_BASE_SPEED); // clamped
});

test('burgerBuild: spawn roll honors the starvation guard + weight', () => {
  // forced: dry spell ≥ FORCE_NEXT_SEC always yields the needed layer
  for (let seed = 1; seed <= 50; seed += 1) {
    assert.equal(rollSpawn(rngFrom(seed), 'cheese', BURGER.FORCE_NEXT_SEC), 'cheese');
  }
  // complete ticket (needed null): never forced, always a valid raining id
  const rng = rngFrom(11);
  for (let i = 0; i < 200; i += 1) {
    assert.ok(FALLING_IDS.includes(rollSpawn(rng, null, 999)));
  }
  // needed spawns clearly more often than the uniform 1/6 share
  const rng2 = rngFrom(12);
  let hits = 0;
  for (let i = 0; i < 4000; i += 1) {
    if (rollSpawn(rng2, 'patty', 0) === 'patty') hits += 1;
  }
  const rate = hits / 4000;
  const expected = BURGER.NEXT_WEIGHT + (1 - BURGER.NEXT_WEIGHT) / FALLING_IDS.length;
  assert.ok(Math.abs(rate - expected) < 0.03, `needed rate ${rate} far from ${expected}`);
});

test('burgerBuild: catch scoring floors at 0; models are committed keys', () => {
  assert.equal(applyCatch(0, false), 0);
  assert.equal(applyCatch(1, false), 0);
  assert.equal(applyCatch(10, true), 15);
  assert.deepEqual(Object.keys(MODEL_KEYS).sort(), [...INGREDIENTS].sort());
  for (const key of Object.values(MODEL_KEYS)) {
    assert.match(key, /^food-kit\/[a-z-]+$/);
  }
});

test('burgerBuild: typical raw ≈ 60 pays inside the §C1.1 row (4/4/26)', () => {
  const row = COIN_TABLE.burgerBuild;
  assert.deepEqual({ ...row }, { divisor: 4, min: 4, max: 26 });
  assert.equal(computeCoins(row, 60, false), 15); // ≈ typical
  assert.equal(computeCoins(row, 5, false), 4); // min clamp
  assert.equal(computeCoins(row, 500, false), 26); // max clamp
});

// ---------------------------------------------------------------------------
// strings: every V2/G24 in-game key is bilingual (§A parity rule)
// ---------------------------------------------------------------------------

test('V2/G24 in-game strings exist in EN and DE', () => {
  const keys = [
    'mg.says.round', 'mg.says.go', 'mg.says.oops', 'mg.says.timeout',
    'mg.rush.perfect', 'mg.rush.early', 'mg.rush.wilted', 'mg.rush.weed', 'mg.rush.morePots',
    'mg.burger.order', 'mg.burger.wrong', 'mg.burger.complete', 'mg.burger.newOrder',
    'mg.burger.speedUp',
    ...['bun', 'patty', 'cheese', 'tomato', 'salad', 'onion'].map((id) => `mg.burger.ing.${id}`),
  ];
  for (const key of keys) {
    assert.equal(typeof EN[key], 'string', `EN missing ${key}`);
    assert.equal(typeof DE[key], 'string', `DE missing ${key}`);
    assert.ok(EN[key].length > 0 && DE[key].length > 0, `empty string for ${key}`);
  }
});
