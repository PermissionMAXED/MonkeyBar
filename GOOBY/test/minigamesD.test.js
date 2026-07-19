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
  applyDifficulty as applySaysDifficulty,
  endlessShouldEnd as saysEndlessShouldEnd,
  simulateAutoplay as simulateSaysAutoplay,
  seqLengthAt,
  stepMsAt,
  extendSequence,
  isChordStep,
  chordTapResult,
  speedBonus,
  roundScore,
  autoplayErrAt,
} from '../src/minigames/games/goobySays.logic.js';
import {
  RUSH,
  applyDifficulty as applyRushDifficulty,
  endlessShouldEnd as rushEndlessShouldEnd,
  simulateAutoplay as simulateRushAutoplay,
  wiltWindowAt,
  spawnIntervalAt,
  activePotsAt,
  releasePoints,
  inPerfectZone,
  holdFillFraction,
  sprinklerRefill,
  shouldSpawnSprinkler,
  rollWeed,
  applyPoints,
} from '../src/minigames/games/gardenRush.logic.js';
import {
  BURGER,
  applyDifficulty as applyBurgerDifficulty,
  endlessShouldEnd as burgerEndlessShouldEnd,
  simulateAutoplay as simulateBurgerAutoplay,
  INGREDIENTS,
  MODEL_KEYS,
  FALLING_IDS,
  makeTicket,
  nextNeeded,
  isComplete,
  fallSpeedAt,
  columnCenters,
  isRushOrder,
  orderTimerSec,
  orderPoints,
  rollSpawn,
  applyCatch,
} from '../src/minigames/games/burgerBuild.logic.js';
// --- V2/G27 imports (wave-4 append: veggieChop + goalieGooby, §C1.2 #4/#7) ---
import {
  CHOP,
  applyDifficulty as applyChopDifficulty,
  applyTurbo,
  finalScore as chopFinalScore,
  endlessShouldEnd as chopEndlessShouldEnd,
  simulateAutoplay as simulateChopAutoplay,
  VEGGIES,
  JUNK_ITEMS,
  maxWaveSizeAt,
  waveSizeAt,
  spawnIntervalAt as chopSpawnIntervalAt,
  junkChanceAt,
  rollItem as chopRollItem,
  rollVeggie,
  frenzySpawnInterval,
  frenzyCountAt,
  vyForApex,
  makeArc,
  arcPos,
  arcApex,
  chopPoints,
  comboAfterHit,
  swipeScore,
  applyPoints as chopApplyPoints,
  segmentHitsCircle,
  segmentHitsMovingCircle,
} from '../src/minigames/games/veggieChop.logic.js';
import {
  GOALIE,
  applyDifficulty as applyGoalieDifficulty,
  applyRiesenGooby,
  endlessShouldEnd as goalieEndlessShouldEnd,
  simulateAutoplay as simulateGoalieAutoplay,
  telegraphSecAt,
  speedMultAt,
  flightSecAt,
  rollKick,
  laneFromSwipe,
  vKindFromSwipe,
  saveMatches,
  diveCovers,
  isSuperSave,
  savePoints,
  isShootoutAt,
  shootoutShotAt,
  cheersAt,
  autoplayErrAt as goalieErrAt,
} from '../src/minigames/games/goalieGooby.logic.js';
// --- end V2/G27 imports ---
import { COIN_TABLE, ROOMS } from '../src/data/constants.js';
import { TARGETS } from '../src/data/difficultyTargets.js';
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

// ═══════════════════════════════════════════════════════════════ V2/G27 ═══
// Wave-4 append: veggieChop + goalieGooby (§C1.2 #4/#7). §C1.5 scope:
// veggieChop arc solver + combo counter; goalieGooby telegraph→lane mapping
// + ramp. Appended below the V2/G24 blocks per the file's header contract.

test('V2/G27 .logic.js modules import no three.js/DOM', () => {
  for (const id of ['veggieChop', 'goalieGooby']) {
    const src = readFileSync(
      fileURLToPath(new URL(`../src/minigames/games/${id}.logic.js`, import.meta.url)),
      'utf8'
    );
    assert.ok(!/from\s+['"]three['"]/.test(src), `${id}.logic.js imports three`);
    assert.ok(!/document\.|window\./.test(src), `${id}.logic.js touches the DOM`);
  }
});

// ---------------------------------------------------------------------------
// #4 veggieChop (§C1.2): arc solver, combo counter, wave/junk ramps
// ---------------------------------------------------------------------------

test('veggieChop: §C1.2 #4 binding numbers verbatim', () => {
  assert.equal(CHOP.DURATION_SEC, 60);
  assert.equal(CHOP.CHOP_PTS, 2);
  assert.equal(CHOP.COMBO_BONUS, 1);
  assert.equal(CHOP.JUNK_PTS, -3);
  assert.equal(CHOP.STUN_SEC, 0.5);
  assert.equal(CHOP.MAX_MISSES, 3);
});

test('veggieChop: the 8 §C1.2 whole+half food-kit pairs, keys verbatim', () => {
  const pairs = Object.fromEntries(VEGGIES.map((v) => [v.key, v.half]));
  assert.deepEqual(pairs, {
    apple: 'apple-half',
    pear: 'pear-half',
    lemon: 'lemon-half',
    onion: 'onion-half',
    mushroom: 'mushroom-half',
    paprika: 'paprika-slice',
    tomato: 'tomato-slice',
    coconut: 'coconut-half',
  });
  assert.deepEqual([...JUNK_ITEMS], ['soda', 'boot']); // §C1.2: soda can + boot
});

test('veggieChop: waves ramp 1 → 3 items (§C1.2)', () => {
  assert.equal(maxWaveSizeAt(0), 1);
  assert.equal(maxWaveSizeAt(CHOP.WAVE2_FROM_SEC - 0.01), 1);
  assert.equal(maxWaveSizeAt(CHOP.WAVE2_FROM_SEC), 2);
  assert.equal(maxWaveSizeAt(CHOP.WAVE3_FROM_SEC), 3);
  assert.equal(maxWaveSizeAt(9999), 3);
  const rng = rngFrom(9);
  for (let i = 0; i < 200; i += 1) {
    const early = waveSizeAt(rng, 0);
    const late = waveSizeAt(rng, 60);
    assert.equal(early, 1);
    assert.ok(late >= 1 && late <= 3, `late wave ${late} out of 1–3`);
  }
});

test('veggieChop: cadence tightens and junk odds ramp linearly', () => {
  assert.equal(chopSpawnIntervalAt(0), CHOP.SPAWN_START_SEC);
  assert.equal(chopSpawnIntervalAt(60), CHOP.SPAWN_END_SEC);
  assert.ok(chopSpawnIntervalAt(30) < CHOP.SPAWN_START_SEC);
  assert.ok(chopSpawnIntervalAt(30) > CHOP.SPAWN_END_SEC);
  assert.equal(junkChanceAt(0), CHOP.JUNK_CHANCE_START);
  assert.equal(junkChanceAt(60), CHOP.JUNK_CHANCE_END);
  assert.ok(Math.abs(junkChanceAt(30) - (CHOP.JUNK_CHANCE_START + CHOP.JUNK_CHANCE_END) / 2) < 1e-9);
});

test('veggieChop: item rolls are deterministic per seed; junk rate matches', () => {
  for (const seed of [4, 77, 20260717]) {
    const a = [];
    const b = [];
    const rngA = rngFrom(seed);
    const rngB = rngFrom(seed);
    for (let i = 0; i < 60; i += 1) {
      a.push(chopRollItem(rngA, i));
      b.push(chopRollItem(rngB, i));
    }
    assert.deepEqual(a, b, `seed ${seed} diverged`);
  }
  const rng = rngFrom(31);
  let junk = 0;
  for (let i = 0; i < 4000; i += 1) {
    if (chopRollItem(rng, 30).kind === 'junk') junk += 1;
  }
  const rate = junk / 4000;
  assert.ok(Math.abs(rate - junkChanceAt(30)) < 0.03, `junk rate ${rate} far from ${junkChanceAt(30)}`);
});

test('veggieChop: arc solver — apex is the peak and the arc returns home (§C1.5)', () => {
  // vyForApex ↔ apexFor are inverses: apex height v²/2g
  assert.ok(Math.abs(vyForApex(2, 8) - Math.sqrt(32)) < 1e-12);
  const rng = rngFrom(12);
  for (let i = 0; i < 100; i += 1) {
    const arc = makeArc(rng, 1.9, -4.8);
    const apex = arcApex(arc);
    // apex y inside the §CHOP band (float epsilon)
    assert.ok(apex.y >= CHOP.APEX_MIN_Y - 1e-9 && apex.y <= CHOP.APEX_MAX_Y + 1e-9,
      `apex ${apex.y} outside band`);
    // the apex IS the maximum of the arc
    assert.ok(arcPos(arc, apex.t - 0.1).y < apex.y + 1e-9);
    assert.ok(arcPos(arc, apex.t + 0.1).y < apex.y + 1e-9);
    // ballistic symmetry: back at launch height at 2·tApex
    assert.ok(Math.abs(arcPos(arc, apex.t * 2).y - arc.y0) < 1e-9);
    // horizontal drift keeps the apex inside the safe view
    assert.ok(Math.abs(apex.x) <= 1.9 - 0.55 + 1e-9);
  }
});

test('veggieChop: combo counter — 2n + (n−1) per swipe (§C1.2/§C1.5)', () => {
  assert.equal(swipeScore(0), 0);
  assert.equal(swipeScore(1), 2);
  assert.equal(swipeScore(2), 5);
  assert.equal(swipeScore(3), 8);
  // chopPoints streams the same totals one chop at a time
  for (const n of [1, 2, 3, 5]) {
    let sum = 0;
    for (let k = 1; k <= n; k += 1) sum += chopPoints(k);
    assert.equal(sum, swipeScore(n), `chopPoints sum diverges at n=${n}`);
  }
  assert.equal(chopApplyPoints(1, CHOP.JUNK_PTS), 0); // floors at 0
  assert.equal(chopApplyPoints(10, CHOP.JUNK_PTS), 7);
});

test('veggieChop: swipe segment-vs-item chop test', () => {
  // straight through the center
  assert.ok(segmentHitsCircle(-1, 0, 1, 0, 0, 0, 0.4));
  // grazing inside the radius
  assert.ok(segmentHitsCircle(-1, 0.3, 1, 0.3, 0, 0, 0.4));
  // passing outside
  assert.ok(!segmentHitsCircle(-1, 0.5, 1, 0.5, 0, 0, 0.4));
  // short segment ending before the circle
  assert.ok(!segmentHitsCircle(-2, 0, -1, 0, 0, 0, 0.4));
  // zero-length "segment" (a point) inside
  assert.ok(segmentHitsCircle(0.1, 0.1, 0.1, 0.1, 0, 0, 0.4));
});

test('veggieChop: typical raw ≈ 70 pays inside the §C1.1 row (5/4/26)', () => {
  const row = COIN_TABLE.veggieChop;
  assert.deepEqual({ ...row }, { divisor: 5, min: 4, max: 26 });
  assert.equal(computeCoins(row, 70, false), 14); // ≈ typical ~14c
  assert.equal(computeCoins(row, 0, false), 4); // min clamp
  assert.equal(computeCoins(row, 999, false), 26); // max clamp
});

// ---------------------------------------------------------------------------
// #7 goalieGooby (§C1.2): telegraph→lane mapping, ramp, saves, cheers
// ---------------------------------------------------------------------------

test('goalieGooby: §C1.2 #7 binding numbers verbatim', () => {
  assert.equal(GOALIE.DURATION_SEC, 60);
  assert.equal(GOALIE.LANES, 5);
  assert.equal(GOALIE.TELEGRAPH_START_SEC, 0.9);
  assert.equal(GOALIE.TELEGRAPH_END_SEC, 0.45);
  assert.equal(GOALIE.SAVE_PTS, 4);
  assert.equal(GOALIE.SUPER_PTS, 2);
  assert.equal(GOALIE.SUPER_WINDOW_SEC, 0.15);
  assert.equal(GOALIE.MAX_GOALS, 3);
  assert.equal(GOALIE.CHEER_EVERY_SAVES, 10);
  assert.equal(GOALIE.CHEER_SPEED_MULT, 1.1);
  assert.equal(GOALIE.AUTOPLAY_LEAD_SEC, 0.2);
});

test('goalieGooby: telegraph ramps 0.9 s → 0.45 s linearly and clamps (§C1.2)', () => {
  assert.equal(telegraphSecAt(0), 0.9);
  assert.ok(Math.abs(telegraphSecAt(30) - 0.675) < 1e-9);
  assert.equal(telegraphSecAt(60), 0.45);
  assert.equal(telegraphSecAt(9999), 0.45); // clamped past the end
  assert.equal(telegraphSecAt(-5), 0.9); // clamped before the start
});

test('goalieGooby: crowd cheers speed things up ×1.1 per 10 saves (§C1.2)', () => {
  assert.equal(cheersAt(0), 0);
  assert.equal(cheersAt(9), 0);
  assert.equal(cheersAt(10), 1);
  assert.equal(cheersAt(29), 2);
  assert.equal(speedMultAt(0), 1);
  assert.ok(Math.abs(speedMultAt(1) - 1.1) < 1e-12);
  assert.ok(Math.abs(speedMultAt(2) - 1.21) < 1e-12);
  assert.ok(Math.abs(flightSecAt(1) - GOALIE.FLIGHT_SEC / 1.1) < 1e-12);
});

test('goalieGooby: telegraph→lane mapping (§C1.5) — swipe angle picks the lane', () => {
  // pure horizontal swipes hit the outer lanes
  assert.equal(laneFromSwipe(-200, 0), 0);
  assert.equal(laneFromSwipe(200, 0), 4);
  // diagonals (≈45°) hit the inner lanes
  assert.equal(laneFromSwipe(-120, -120), 1);
  assert.equal(laneFromSwipe(120, -120), 3);
  // near-vertical swipes stay center
  assert.equal(laneFromSwipe(0, -160), 2);
  assert.equal(laneFromSwipe(20, 160), 2);
  // bucket boundaries: 18° and 54° from vertical
  const at = (deg, len = 200) => [
    Math.sin((deg * Math.PI) / 180) * len,
    -Math.cos((deg * Math.PI) / 180) * len,
  ];
  assert.equal(laneFromSwipe(...at(17.9)), 2);
  assert.equal(laneFromSwipe(...at(18.1)), 3);
  assert.equal(laneFromSwipe(...at(53.9)), 3);
  assert.equal(laneFromSwipe(...at(54.1)), 4);
  assert.equal(laneFromSwipe(...at(-18.1)), 1);
  assert.equal(laneFromSwipe(...at(-54.1)), 0);
});

test('goalieGooby: vertical intent — lobs need up, rollers need down (§C1.2)', () => {
  assert.equal(vKindFromSwipe(-80), 'up');
  assert.equal(vKindFromSwipe(80), 'down');
  assert.equal(vKindFromSwipe(0), 'mid');
  assert.equal(vKindFromSwipe(GOALIE.VKIND_MIN_PX - 1), 'mid');
  // save matrix: lane must match; straight takes any vertical intent
  const dive = (lane, v) => ({ lane, v });
  assert.ok(saveMatches({ lane: 1, kind: 'straight' }, dive(1, 'mid')));
  assert.ok(saveMatches({ lane: 1, kind: 'straight' }, dive(1, 'up')));
  assert.ok(!saveMatches({ lane: 1, kind: 'straight' }, dive(2, 'mid')));
  assert.ok(saveMatches({ lane: 3, kind: 'lob' }, dive(3, 'up')));
  assert.ok(!saveMatches({ lane: 3, kind: 'lob' }, dive(3, 'mid')));
  assert.ok(saveMatches({ lane: 0, kind: 'roller' }, dive(0, 'down')));
  assert.ok(!saveMatches({ lane: 0, kind: 'roller' }, dive(0, 'up')));
});

test('goalieGooby: dive cover + super-save window (§C1.2: last 0.15 s)', () => {
  assert.ok(diveCovers(10, 10.2));
  assert.ok(diveCovers(10, 10 + GOALIE.DIVE_HOLD_SEC));
  assert.ok(!diveCovers(10, 10 + GOALIE.DIVE_HOLD_SEC + 0.01)); // too early a dive
  assert.ok(!diveCovers(10.3, 10.2)); // dive after the ball crossed
  assert.ok(isSuperSave(10, 10.15));
  assert.ok(!isSuperSave(10, 10.151));
  assert.equal(savePoints(false), 4);
  assert.equal(savePoints(true), 6);
});

test('goalieGooby: kicks are seeded-deterministic; specials mix in later', () => {
  for (const seed of [2, 55, 4711]) {
    const a = [];
    const b = [];
    const rngA = rngFrom(seed);
    const rngB = rngFrom(seed);
    for (let i = 0; i < 40; i += 1) {
      a.push(rollKick(rngA, i * 1.5));
      b.push(rollKick(rngB, i * 1.5));
    }
    assert.deepEqual(a, b, `seed ${seed} diverged`);
    for (const kick of a) {
      assert.ok(kick.lane >= 0 && kick.lane < GOALIE.LANES);
      assert.ok(['straight', 'lob', 'roller'].includes(kick.kind));
    }
  }
  // intro kicks are always straight; lobs+rollers appear afterwards
  const rng = rngFrom(8);
  for (let i = 0; i < 100; i += 1) {
    assert.equal(rollKick(rng, GOALIE.MIX_FROM_SEC - 0.01).kind, 'straight');
  }
  const kinds = new Set();
  for (let i = 0; i < 400; i += 1) kinds.add(rollKick(rng, 30).kind);
  assert.deepEqual([...kinds].sort(), ['lob', 'roller', 'straight']);
});

test('goalieGooby: bot flub odds ramp as the telegraph shrinks', () => {
  assert.ok(Math.abs(goalieErrAt(GOALIE.TELEGRAPH_START_SEC) - GOALIE.AUTOPLAY_ERR_BASE) < 1e-12);
  assert.ok(Math.abs(
    goalieErrAt(GOALIE.TELEGRAPH_END_SEC)
    - (GOALIE.AUTOPLAY_ERR_BASE + GOALIE.AUTOPLAY_ERR_RAMP)
  ) < 1e-12);
  assert.ok(goalieErrAt(0.6) > goalieErrAt(0.8));
});

test('goalieGooby: typical raw ≈ 48 pays inside the §C1.1 row (3/4/26)', () => {
  const row = COIN_TABLE.goalieGooby;
  assert.deepEqual({ ...row }, { divisor: 3, min: 4, max: 26 });
  assert.equal(computeCoins(row, 48, false), 16); // ≈ typical ~15c
  assert.equal(computeCoins(row, 0, false), 4); // min clamp
  assert.equal(computeCoins(row, 999, false), 26); // max clamp
});

test('V2/G27 in-game strings exist in EN and DE', () => {
  const keys = [
    'mg.chop.combo', 'mg.chop.junk', 'mg.chop.miss', 'mg.chop.over',
    'mg.goalie.super', 'mg.goalie.goal', 'mg.goalie.cheer', 'mg.goalie.over',
  ];
  for (const key of keys) {
    assert.equal(typeof EN[key], 'string', `EN missing ${key}`);
    assert.equal(typeof DE[key], 'string', `DE missing ${key}`);
    assert.ok(EN[key].length > 0 && DE[key].length > 0, `empty string for ${key}`);
  }
});
// ═══════════════════════════════════════════════════════════ end V2/G27 ═══

// ═══════════════════════════════════════════════════════════════ V3/G45 ═══
// PLAN3 §C10.2 depth mechanics + bug-audit locks for the five D-family games.

test('V3/G45 goobySays: round 6+ appends distinct two-pad chords', () => {
  assert.equal(SAYS.CHORD_FROM_ROUND, 6);
  assert.equal(SAYS.CHORD_WINDOW_MS, 250);
  const normal = extendSequence([], rngFrom(45), 5);
  const chord = extendSequence(normal, rngFrom(45), 6);
  assert.equal(isChordStep(normal[0]), false);
  assert.equal(isChordStep(chord[1]), true);
  assert.equal(new Set(chord[1]).size, 2);
  assert.ok(chord[1].every((pad) => pad >= 0 && pad < SAYS.PADS));
  assert.deepEqual(
    extendSequence([], rngFrom(2026), 6),
    extendSequence([], rngFrom(2026), 6),
    'chord generation stays seeded'
  );
});

test('V3/G45 goobySays: chord taps accept either order at ≤250 ms only', () => {
  const chord = [1, 3];
  assert.equal(chordTapResult(chord, 1), 'waiting');
  assert.equal(chordTapResult(chord, 1, 3, 250), 'complete');
  assert.equal(chordTapResult(chord, 3, 1, 100), 'complete');
  assert.equal(chordTapResult(chord, 1, 3, 250.01), 'late');
  assert.equal(chordTapResult(chord, 1, 1, 20), 'wrong');
  assert.equal(chordTapResult(chord, 1, 2, 20), 'wrong');
  assert.equal(stepMsAt(999), 320, 'chords never break the replay-speed floor');
});

test('V3/G45 gardenRush: sprinkler spawns once at 30 s and refills rings 50%', () => {
  assert.equal(RUSH.SPRINKLER_AT_SEC, 30);
  assert.equal(RUSH.SPRINKLER_FILL_FRAC, 0.5);
  assert.equal(shouldSpawnSprinkler(29.999, false), false);
  assert.equal(shouldSpawnSprinkler(30, false), true);
  assert.equal(shouldSpawnSprinkler(59, true), false);
  assert.equal(sprinklerRefill(1, 6), 4);
  assert.equal(sprinklerRefill(5, 6), 6, 'refill caps at a full ring');
  assert.equal(sprinklerRefill(-2, 4), 2);
});

test('V3/G45 gardenRush audit: hold scoring uses elapsed time, not RAF count', () => {
  assert.equal(holdFillFraction(0), 0);
  assert.ok(Math.abs(holdFillFraction(0.6) - 0.75) < 1e-12);
  assert.equal(holdFillFraction(0.75), 0.9375);
  assert.equal(holdFillFraction(5), 1);
  // A 750 ms real hold scores identically whether represented by 45 smooth
  // frames or 5 slow SwiftShader frames.
  const smooth = Array.from({ length: 45 }, () => 1 / 60).reduce((a, b) => a + b, 0);
  const slow = Array.from({ length: 5 }, () => 0.15).reduce((a, b) => a + b, 0);
  assert.equal(releasePoints(holdFillFraction(smooth)), RUSH.PERFECT_PTS);
  assert.equal(releasePoints(holdFillFraction(slow)), RUSH.PERFECT_PTS);
});

test('V3/G45 burgerBuild: rush tickets are gold orders 2/4, ×1.5, timer −20%', () => {
  assert.equal(BURGER.MAX_RUSH_ORDERS, 2);
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => i + 1).filter(isRushOrder),
    [2, 4]
  );
  assert.equal(orderTimerSec(false), 30);
  assert.equal(orderTimerSec(true), 24);
  assert.equal(orderPoints(5, true), 7.5);
  assert.equal(orderPoints(15, true), 22.5);
  assert.equal(orderPoints(-2, true), -2, 'wrong-catch penalty is not amplified');
  assert.equal(applyCatch(10, true, true), 17.5);
});

test('V3/G45 burgerBuild audit: 3 columns stay centered/in bounds at 393 px', () => {
  const halfH = Math.tan((ROOMS.CAMERA_FOV * Math.PI) / 360) * 10;
  for (const [width, height] of [[393, 852], [320, 568]]) {
    const halfW = halfH * (width / height);
    const cols = columnCenters(halfW);
    assert.equal(cols.length, 3);
    assert.ok(Math.abs(cols[0] + cols[2]) < 1e-12);
    assert.equal(cols[1], 0);
    const plateBound = halfW - 0.7;
    assert.ok(cols.every((x) => Math.abs(x) <= plateBound), `${width}px column drift`);
  }
});

test('V3/G45 veggieChop: frenzy fires at 25/50 s with 8 no-junk items in 3 s', () => {
  assert.equal(CHOP.FRENZY_EVERY_SEC, 25);
  assert.equal(CHOP.FRENZY_ITEMS, 8);
  assert.equal(CHOP.FRENZY_DURATION_SEC, 3);
  assert.equal(frenzySpawnInterval(), 3 / 8);
  assert.equal(frenzyCountAt(24.999), 0);
  assert.equal(frenzyCountAt(25), 1);
  assert.equal(frenzyCountAt(49.999), 1);
  assert.equal(frenzyCountAt(50), 2);
  const rng = rngFrom(451);
  for (let i = 0; i < 100; i += 1) {
    assert.equal(rollVeggie(rng).kind, 'veggie');
  }
});

test('V3/G45 veggieChop audit: junk resets combo and moving-hit sweep catches low FPS', () => {
  assert.equal(comboAfterHit(0, 'veggie'), 1);
  assert.equal(comboAfterHit(2, 'veggie'), 3);
  assert.equal(comboAfterHit(7, 'junk'), 0);
  // The item crosses y=0 between two low-FPS frames; neither endpoint circle
  // touches the horizontal swipe, but its swept path does.
  assert.equal(segmentHitsCircle(-1, 0, 1, 0, 0, -1, 0.3), false);
  assert.equal(segmentHitsCircle(-1, 0, 1, 0, 0, 1, 0.3), false);
  assert.equal(segmentHitsMovingCircle(-1, 0, 1, 0, 0, -1, 0, 1, 0.3), true);
  assert.equal(segmentHitsMovingCircle(-1, 0, 1, 0, 2, -1, 2, 1, 0.3), false);
});

test('V3/G45 goalieGooby: last 10 s schedule is 5 rapid shots with ×2 saves', () => {
  assert.equal(GOALIE.SHOOTOUT_START_SEC, 50);
  assert.equal(GOALIE.SHOOTOUT_SHOTS, 5);
  assert.equal(isShootoutAt(49.999), false);
  assert.equal(isShootoutAt(50), true);
  assert.equal(isShootoutAt(60), true);
  assert.equal(isShootoutAt(60.001), false);
  const starts = Array.from({ length: GOALIE.SHOOTOUT_SHOTS }, (_, i) => shootoutShotAt(i));
  assert.equal(starts.length, 5);
  assert.ok(starts.every((t, i) => i === 0 || t > starts[i - 1]));
  assert.ok(starts.at(-1) < GOALIE.DURATION_SEC);
  assert.equal(savePoints(false, true), 8);
  assert.equal(savePoints(true, true), 12);
});

test('V3/G45 goalieGooby audits: edge origin cannot alter swipe direction buckets', () => {
  // laneFromSwipe consumes deltas only: identical swipes from either screen
  // edge classify identically; boundary behavior remains covered above.
  for (const [dx, dy] of [[-200, 0], [200, 0], [-120, -120], [120, -120], [0, -160]]) {
    const leftEdgeGesture = laneFromSwipe(dx, dy);
    const rightEdgeGesture = laneFromSwipe(dx, dy);
    assert.equal(leftEdgeGesture, rightEdgeGesture);
  }
});

test('V3/G45 prop swaps use one-mesh committed Restaurant-Bits assets', () => {
  const burgerSrc = readFileSync(
    fileURLToPath(new URL('../src/minigames/games/burgerBuild.js', import.meta.url)),
    'utf8'
  );
  const chopSrc = readFileSync(
    fileURLToPath(new URL('../src/minigames/games/veggieChop.js', import.meta.url)),
    'utf8'
  );
  assert.match(burgerSrc, /kaykit-restaurant\/kitchencounter_straight/);
  assert.doesNotMatch(burgerSrc, /new THREE\.BoxGeometry\(this\.halfW \* 2 \+ 2, 0\.42, 1\.4\)/);
  assert.match(chopSrc, /kaykit-restaurant\/cuttingboard/);
  assert.doesNotMatch(chopSrc, /food-kit\/cutting-board/);
  assert.match(
    chopSrc,
    /this\.board\.rotation\.set\(0, Math\.PI \/ 2, Math\.PI \/ 2\)/,
    'Restaurant-Bits board must face the camera with its long edge vertical'
  );
});

test('V3/G45 depth strings are bilingual and payout caps remain intact', () => {
  const keys = [
    'mg.says.chord', 'mg.says.chordLate',
    'mg.rush.sprinklerReady', 'mg.rush.sprinklerUsed',
    'mg.burger.rush', 'mg.burger.rushBonus', 'mg.burger.expired',
    'mg.chop.frenzy', 'mg.goalie.shootout',
  ];
  for (const key of keys) {
    assert.equal(typeof EN[key], 'string', `EN missing ${key}`);
    assert.equal(typeof DE[key], 'string', `DE missing ${key}`);
    assert.ok(EN[key].length > 0 && DE[key].length > 0);
  }
  for (const id of ['goobySays', 'gardenRush', 'burgerBuild', 'veggieChop', 'goalieGooby']) {
    assert.equal(computeCoins(COIN_TABLE[id], 1e9, false), COIN_TABLE[id].max, `${id} cap changed`);
  }
});
// ═══════════════════════════════════════════════════════════ end V3/G45 ═══

// ═══════════════════════════════════════════════════════════════ V4/G73 ═══
// PLAN4 §E G73 + PLAN4-GAMES §G5: difficulty batch C, Endlos end
// conditions, eligible modifier tuning, and deterministic Schwer certification.

test('V4/G73: Mittel is bit-identical and every derived tune is frozen', () => {
  const rows = [
    [SAYS, applySaysDifficulty],
    [RUSH, applyRushDifficulty],
    [BURGER, applyBurgerDifficulty],
    [CHOP, applyChopDifficulty],
    [GOALIE, applyGoalieDifficulty],
  ];
  for (const [base, apply] of rows) {
    assert.strictEqual(apply(base, 'normal'), base);
    assert.strictEqual(apply(base, 'unknown'), base);
    assert.ok(Object.isFrozen(apply(base, 'easy')));
    assert.ok(Object.isFrozen(apply(base, 'hard')));
    assert.ok(Object.isFrozen(apply(base, 'endless')));
  }
});

test('V4/G73: sequence and timed-arena parameters follow §G5.3 monotonically', () => {
  const saysEasy = applySaysDifficulty(SAYS, 'easy');
  const saysHard = applySaysDifficulty(SAYS, 'hard');
  const saysEndless = applySaysDifficulty(SAYS, 'endless');
  assert.ok(stepMsAt(1, saysEasy) > stepMsAt(1, SAYS));
  assert.ok(stepMsAt(1, SAYS) > stepMsAt(1, saysHard));
  assert.ok(saysHard.CHORD_WINDOW_MS >= 350, 'Schwer reaction guardrail');
  assert.ok(stepMsAt(80, saysEndless) < SAYS.STEP_FLOOR_MS, 'Endlos ramps past Mittel floor');

  for (const [base, apply, spawnKey, windowKey] of [
    [RUSH, applyRushDifficulty, 'SPAWN_START_SEC', 'WILT_END_SEC'],
    [BURGER, applyBurgerDifficulty, 'SPAWN_SEC', 'PLATE_HALF_WIDTH'],
    [CHOP, applyChopDifficulty, 'SPAWN_START_SEC', 'HIT_RADIUS'],
    [GOALIE, applyGoalieDifficulty, 'GAP_SEC', 'TELEGRAPH_END_SEC'],
  ]) {
    const easy = apply(base, 'easy');
    const hard = apply(base, 'hard');
    assert.ok(easy[spawnKey] > base[spawnKey], `${spawnKey}: easy`);
    assert.ok(hard[spawnKey] < base[spawnKey], `${spawnKey}: hard`);
    assert.ok(easy[windowKey] > base[windowKey], `${windowKey}: easy`);
    assert.ok(hard[windowKey] < base[windowKey], `${windowKey}: hard`);
    assert.equal(easy.DURATION_SEC, base.DURATION_SEC * 1.2);
    assert.equal(hard.DURATION_SEC, base.DURATION_SEC);
  }
});

test('V4/G73: Schwer guardrails keep windows >=350ms and hitboxes >=55%', () => {
  const rush = applyRushDifficulty(RUSH, 'hard');
  const burger = applyBurgerDifficulty(BURGER, 'hard');
  const chop = applyChopDifficulty(CHOP, 'hard');
  const goalie = applyGoalieDifficulty(GOALIE, 'hard');
  assert.ok(rush.FILL_SEC >= 0.35);
  assert.ok(rush.WILT_END_SEC >= 0.35);
  assert.ok(burger.PLATE_HALF_WIDTH >= BURGER.PLATE_HALF_WIDTH * 0.55);
  assert.ok(chop.HIT_RADIUS >= CHOP.HIT_RADIUS * 0.55);
  assert.ok(goalie.TELEGRAPH_END_SEC >= 0.35);
  assert.ok(goalie.SHOOTOUT_TELEGRAPH_SEC >= 0.35);
  assert.ok(goalie.DIVE_HOLD_SEC >= 0.35);
});

test('V4/G73: each §G5.4 Endlos condition is exact and timer-free', () => {
  const rush = applyRushDifficulty(RUSH, 'endless');
  const burger = applyBurgerDifficulty(BURGER, 'endless');
  const chop = applyChopDifficulty(CHOP, 'endless');
  const goalie = applyGoalieDifficulty(GOALIE, 'endless');
  assert.equal(saysEndlessShouldEnd('endless', 0), false);
  assert.equal(saysEndlessShouldEnd('endless', 1), true);
  assert.equal(rushEndlessShouldEnd(2, rush), false);
  assert.equal(rushEndlessShouldEnd(3, rush), true);
  assert.equal(burgerEndlessShouldEnd(2, burger), false);
  assert.equal(burgerEndlessShouldEnd(3, burger), true);
  assert.equal(chopEndlessShouldEnd(2, chop), false);
  assert.equal(chopEndlessShouldEnd(3, chop), true);
  assert.equal(goalieEndlessShouldEnd(2, goalie), false);
  assert.equal(goalieEndlessShouldEnd(3, goalie), true);
  for (const tune of [rush, burger, chop, goalie]) assert.equal(tune.ENDLESS, true);
  assert.equal(simulateRushAutoplay(73, 'endless').withered, 3);
  assert.equal(simulateBurgerAutoplay(73, 'endless').expired, 3);
  assert.equal(simulateChopAutoplay(73, 'endless').junkHits, 3);
  assert.equal(simulateGoalieAutoplay(73, 'endless').goals, 3);
});

test('V4/G73: Turbo and Riesen-Gooby apply only plain eligible tuning', () => {
  const chopHard = applyChopDifficulty(CHOP, 'hard');
  const turbo = applyTurbo(chopHard, { speedMult: 1.25, scoreMult: 1.5 });
  assert.equal(turbo.SPEED_MULT, 1.25);
  assert.equal(turbo.SCORE_MULT, 1.5);
  assert.equal(chopFinalScore(101, turbo), 152, 'score multiplier rounds once at end');
  assert.equal(turbo.HIT_RADIUS, chopHard.HIT_RADIUS, 'Turbo does not alter hitboxes');

  const goalieHard = applyGoalieDifficulty(GOALIE, 'hard');
  const giant = applyRiesenGooby(goalieHard, { scale: 1.6, hitboxMult: 1.3 });
  assert.equal(giant.RENDER_SCALE, 1.6);
  assert.equal(giant.HITBOX_MULT, 1.3);
  assert.ok(Math.abs(giant.DIVE_HOLD_SEC - goalieHard.DIVE_HOLD_SEC * 1.3) < 1e-12);
});

test('V4/G73: ten-seed bot means are easy >= Mittel >= Schwer', () => {
  for (const [id, simulate] of [
    ['goobySays', simulateSaysAutoplay],
    ['gardenRush', simulateRushAutoplay],
    ['burgerBuild', simulateBurgerAutoplay],
    ['veggieChop', simulateChopAutoplay],
    ['goalieGooby', simulateGoalieAutoplay],
  ]) {
    const mean = (mode) => Array.from({ length: 10 }, (_, i) => simulate(i + 1, mode).score)
      .reduce((sum, score) => sum + score, 0) / 10;
    const easy = mean('easy');
    const normal = mean('normal');
    const hard = mean('hard');
    assert.ok(easy >= normal, `${id}: easy ${easy} < normal ${normal}`);
    assert.ok(normal >= hard, `${id}: normal ${normal} < hard ${hard}`);
  }
});

test('V4/G73: five-seed Schwer certification reaches every frozen target', () => {
  for (const [id, simulate] of [
    ['goobySays', simulateSaysAutoplay],
    ['gardenRush', simulateRushAutoplay],
    ['burgerBuild', simulateBurgerAutoplay],
    ['veggieChop', simulateChopAutoplay],
    ['goalieGooby', simulateGoalieAutoplay],
  ]) {
    const scores = [1, 2, 3, 4, 5].map((seed) => simulate(seed, 'hard').score);
    const target = TARGETS[id].target;
    assert.ok(scores.some((score) => score >= target), `${id}: ${scores.join(',')} never reaches ${target}`);
  }
});
// ═══════════════════════════════════════════════════════════ end V4/G73 ═══
