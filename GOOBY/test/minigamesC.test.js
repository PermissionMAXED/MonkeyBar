// Minigames C (G10, §C6.1 #9–12) — pure-logic tests for danceParty.logic.js,
// fishingPond.logic.js, bubblePop.logic.js and trampoline.logic.js: seeded
// pattern determinism, hit-window classification + score formula, fishing
// depth/catch-radius/rarity/reel rules, bubble target-match/mismatch/spike
// rules + ramps, trampoline window-shrink math + trick multiplier tiers +
// reset rules — plus §C6 coin-table sanity for the typical raw scores.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DANCE_TUNING,
  mulberry32,
  generatePattern,
  classifyHit,
  judgeTap,
  createTally,
  applyJudgment,
  danceScore,
  comboTier,
} from '../src/minigames/games/danceParty.logic.js';
import {
  FISHING,
  lowerDepth,
  catchValue,
  needsReel,
  nearestCatch,
  reelResolve,
  rollFishKind,
  fishSpeedFor,
  shouldSpawnBoot,
  applyCatch,
} from '../src/minigames/games/fishingPond.logic.js';
import {
  BUBBLE,
  riseSpeedAt,
  spawnIntervalAt,
  targetIndexAt,
  targetOrder,
  rollBubble,
  popResult,
  applyScore,
} from '../src/minigames/games/bubblePop.logic.js';
import {
  TRAMP,
  windowSecFor,
  heightMultiplier,
  apexFor,
  airTimeFor,
  timeToImpact,
  classifyLandingTap,
  nextBounceVy,
  trickPoints,
  canTrick,
  trampolineScore,
} from '../src/minigames/games/trampoline.logic.js';
import { DANCE, COIN_TABLE } from '../src/data/constants.js';
import { computeCoins } from '../src/data/minigames.js';

// ===========================================================================
// Dance Party (§C6.1 #9)
// ===========================================================================

test('dance: DANCE constants match §C6.1 #9 verbatim', () => {
  assert.equal(DANCE.BPM, 100);
  assert.equal(DANCE.DURATION_SEC, 75);
  assert.equal(DANCE.LANES, 3);
  assert.equal(DANCE.PERFECT_MS, 70);
  assert.equal(DANCE.GOOD_MS, 140);
  assert.equal(DANCE.PERFECT_PTS, 4);
  assert.equal(DANCE.GOOD_PTS, 2);
  assert.equal(DANCE.MISS_PENALTY, 2);
});

test('dance: pattern is deterministic for the same seed', () => {
  const a = generatePattern(DANCE.PATTERN_SEED);
  const b = generatePattern(DANCE.PATTERN_SEED);
  assert.deepEqual(a, b);
});

test('dance: different seeds give different patterns', () => {
  const a = generatePattern(1);
  const b = generatePattern(2);
  assert.notDeepEqual(a, b);
});

test('dance: notes sit on the eighth-note grid inside the round', () => {
  const beat = 60 / DANCE.BPM;
  const slot = beat / DANCE_TUNING.SLOTS_PER_BEAT;
  const notes = generatePattern(DANCE.PATTERN_SEED);
  assert.ok(notes.length > 0);
  for (const n of notes) {
    assert.ok(n.time >= DANCE_TUNING.START_BEAT * beat - 1e-9);
    assert.ok(n.time <= DANCE.DURATION_SEC - DANCE_TUNING.TAIL_SEC + 1e-9);
    assert.ok(Math.abs(n.time / slot - Math.round(n.time / slot)) < 1e-9, `off-grid note at ${n.time}`);
    assert.ok(n.lane >= 0 && n.lane < DANCE.LANES);
  }
});

test('dance: pattern is sorted and respects spacing rules', () => {
  const notes = generatePattern(DANCE.PATTERN_SEED);
  const lastLane = {};
  let prev = -Infinity;
  for (const n of notes) {
    assert.ok(n.time >= prev, 'sorted by time');
    assert.ok(n.time - prev >= DANCE_TUNING.MIN_GAP_SEC - 1e-9, 'global min gap');
    if (lastLane[n.lane] != null) {
      assert.ok(n.time - lastLane[n.lane] >= DANCE_TUNING.LANE_GAP_SEC - 1e-9, 'same-lane gap');
    }
    prev = n.time;
    lastLane[n.lane] = n.time;
  }
});

test('dance: note count lands in the tuned band (§C6 ~16c typical)', () => {
  const n = generatePattern(DANCE.PATTERN_SEED).length;
  assert.ok(n >= 55 && n <= 95, `expected 55–95 notes, got ${n}`);
  // all-perfect must exceed the coin-table max so skill can reach the cap
  assert.ok(n * DANCE.PERFECT_PTS >= COIN_TABLE.danceParty.max * COIN_TABLE.danceParty.divisor);
});

test('dance: every lane is used', () => {
  const lanes = new Set(generatePattern(DANCE.PATTERN_SEED).map((n) => n.lane));
  assert.equal(lanes.size, DANCE.LANES);
});

test('dance: mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i += 1) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('dance: hit windows classify exactly per §C6.1 (≤70 perfect, ≤140 good)', () => {
  assert.equal(classifyHit(0), 'perfect');
  assert.equal(classifyHit(0.07), 'perfect');
  assert.equal(classifyHit(-0.07), 'perfect');
  assert.equal(classifyHit(0.0701), 'good');
  assert.equal(classifyHit(0.14), 'good');
  assert.equal(classifyHit(-0.14), 'good');
  assert.equal(classifyHit(0.1401), null);
  assert.equal(classifyHit(1), null);
});

test('dance: judgeTap grabs the nearest un-hit note in the lane within the window', () => {
  const notes = [
    { time: 1.0, lane: 0 },
    { time: 1.1, lane: 1 },
    { time: 1.2, lane: 0 },
  ];
  assert.equal(judgeTap(notes, 0, 1.05), 0); //  1.0 is nearer than 1.2
  assert.equal(judgeTap(notes, 0, 1.16), 2); //  1.2 is nearer
  assert.equal(judgeTap(notes, 1, 1.1), 1); //   lane match
  assert.equal(judgeTap(notes, 2, 1.1), -1); //  empty lane
  assert.equal(judgeTap(notes, 0, 2.0), -1); //  outside the good window
  notes[0].hit = true;
  assert.equal(judgeTap(notes, 0, 1.08), 2, 'hit notes are skipped');
  notes[2].missed = true;
  assert.equal(judgeTap(notes, 0, 1.08), -1, 'missed notes are skipped');
});

test('dance: combo builds on hits and resets on miss; maxCombo tracked', () => {
  const tally = createTally();
  applyJudgment(tally, 'perfect');
  applyJudgment(tally, 'good');
  applyJudgment(tally, 'perfect');
  assert.equal(tally.combo, 3);
  assert.equal(tally.maxCombo, 3);
  applyJudgment(tally, 'miss');
  assert.equal(tally.combo, 0);
  assert.equal(tally.maxCombo, 3);
  applyJudgment(tally, 'good');
  assert.equal(tally.combo, 1);
  assert.deepEqual(
    { perfect: tally.perfect, good: tally.good, miss: tally.miss },
    { perfect: 2, good: 2, miss: 1 }
  );
});

test('dance: score = 4×perfect + 2×good − 2×miss, floored at 0 (§C6.1)', () => {
  assert.equal(danceScore({ perfect: 10, good: 5, miss: 3 }), 44);
  assert.equal(danceScore({ perfect: 0, good: 0, miss: 0 }), 0);
  assert.equal(danceScore({ perfect: 0, good: 1, miss: 8 }), 0, 'floored at 0');
});

test('dance: comboTier thresholds drive the dance energy', () => {
  const [t1, t2, t3] = DANCE_TUNING.TIER_COMBOS;
  assert.equal(comboTier(0), 0);
  assert.equal(comboTier(t1 - 1), 0);
  assert.equal(comboTier(t1), 1);
  assert.equal(comboTier(t2), 2);
  assert.equal(comboTier(t3), 3);
  assert.equal(comboTier(t3 + 50), 3);
});

test('dance: typical raw score ≈ 96 pays ~16c; extremes clamp (§C6 row)', () => {
  const row = COIN_TABLE.danceParty;
  assert.equal(computeCoins(row, 96, false), 16);
  assert.equal(computeCoins(row, 0, false), row.min);
  assert.equal(computeCoins(row, 100000, false), row.max);
  assert.equal(computeCoins(row, 96, true), 32, 'daily ×2 after clamp');
});

// ===========================================================================
// Fishing Pond (§C6.1 #10)
// ===========================================================================

test('fishing: values are S/M/L = 2/3/5 and boot −3 (§C6.1)', () => {
  assert.equal(catchValue('S'), 2);
  assert.equal(catchValue('M'), 3);
  assert.equal(catchValue('L'), 5);
  assert.equal(catchValue('boot'), -3);
  assert.equal(FISHING.DURATION_SEC, 90);
});

test('fishing: hold lowers the hook and clamps at MAX_DEPTH', () => {
  let d = 0;
  d = lowerDepth(d, 1);
  assert.equal(d, FISHING.LOWER_SPEED);
  d = lowerDepth(d, 1000);
  assert.equal(d, FISHING.MAX_DEPTH);
});

test('fishing: only L fish need the reel-in wiggle (§C6.1)', () => {
  assert.equal(needsReel('S'), false);
  assert.equal(needsReel('M'), false);
  assert.equal(needsReel('L'), true);
  assert.equal(needsReel('boot'), false);
});

test('fishing: nearestCatch picks the closest swimmer inside the radius', () => {
  const items = [
    { x: 0.2, depth: 2.0 }, //  dist 0.2 from (0,2)
    { x: 0.1, depth: 2.05 }, // dist ≈ 0.11 — nearest
    { x: 3.0, depth: 2.0 }, //  far outside
  ];
  assert.equal(nearestCatch(items, 0, 2), 1);
  assert.equal(nearestCatch([{ x: 0, depth: 5 }], 0, 2), -1, 'outside radius');
  assert.equal(nearestCatch([], 0, 2), -1);
  // exact radius boundary is IN (forgiving)
  assert.equal(nearestCatch([{ x: FISHING.CATCH_RADIUS, depth: 2 }], 0, 2), 0);
});

test('fishing: a boot competes as a swimmer — nearest wins', () => {
  const items = [
    { x: 0.4, depth: 2.0, kind: 'M' },
    { x: 0.1, depth: 2.0, kind: 'boot' },
  ];
  assert.equal(nearestCatch(items, 0, 2), 1, 'the boot is nearer and gets hooked');
});

test('fishing: reel rules — ~5 taps inside 2 s or the fish escapes (§C6.1)', () => {
  assert.equal(reelResolve(FISHING.REEL_TAPS, 1.0), 'caught');
  assert.equal(reelResolve(FISHING.REEL_TAPS - 1, 1.9), 'reeling');
  assert.equal(reelResolve(FISHING.REEL_TAPS - 1, FISHING.REEL_WINDOW_SEC), 'escaped');
  assert.equal(reelResolve(0, 5), 'escaped');
  assert.equal(FISHING.REEL_TAPS, 5);
  assert.equal(FISHING.REEL_WINDOW_SEC, 2);
});

test('fishing: rarity roll is weighted S > M > L and deterministic', () => {
  const rng = mulberry32(7);
  const counts = { S: 0, M: 0, L: 0 };
  for (let i = 0; i < 3000; i += 1) counts[rollFishKind(rng)] += 1;
  assert.ok(counts.S > counts.M && counts.M > counts.L, JSON.stringify(counts));
  const w = FISHING.SIZES;
  const total = w.S.weight + w.M.weight + w.L.weight;
  assert.ok(Math.abs(counts.L / 3000 - w.L.weight / total) < 0.03, 'L share near its weight');
  const rng2 = mulberry32(7);
  assert.equal(rollFishKind(rng2), rollFishKind(mulberry32(7)));
});

test('fishing: fish speed stays in the size band (bigger = slower)', () => {
  const rng = mulberry32(3);
  for (const kind of ['S', 'M', 'L']) {
    for (let i = 0; i < 50; i += 1) {
      const v = fishSpeedFor(kind, rng);
      const [lo, hi] = FISHING.SIZES[kind].speed;
      assert.ok(v >= lo && v <= hi);
    }
  }
  assert.ok(FISHING.SIZES.L.speed[1] < FISHING.SIZES.S.speed[1]);
});

test('fishing: boot cadence needs the min gap first', () => {
  assert.equal(shouldSpawnBoot(() => 0, FISHING.BOOT_MIN_GAP_SEC - 1), false, 'gap not reached');
  assert.equal(shouldSpawnBoot(() => 0, FISHING.BOOT_MIN_GAP_SEC), true, 'rng 0 < chance');
  assert.equal(shouldSpawnBoot(() => 0.999, FISHING.BOOT_MIN_GAP_SEC * 2), false, 'chance roll failed');
});

test('fishing: score floors at 0 and typical raw ≈ 45 pays ~15c (§C6 row)', () => {
  assert.equal(applyCatch(0, -3), 0);
  assert.equal(applyCatch(10, -3), 7);
  assert.equal(applyCatch(10, 5), 15);
  const row = COIN_TABLE.fishingPond;
  assert.equal(computeCoins(row, 45, false), 15);
  assert.equal(computeCoins(row, 0, false), row.min);
  assert.equal(computeCoins(row, 999, false), row.max);
});

// ===========================================================================
// Bubble Pop (§C6.1 #11)
// ===========================================================================

test('bubble: §C6.1 #11 rules — match +2, wrong −2 + 0.5 s stun, spiky −1 never pops', () => {
  const match = popResult({ kind: 'food', food: 'carrot' }, 'carrot');
  assert.deepEqual(match, { result: 'match', delta: 2, stunSec: 0, pops: true });
  const wrong = popResult({ kind: 'food', food: 'apple' }, 'carrot');
  assert.deepEqual(wrong, { result: 'wrong', delta: -2, stunSec: 0.5, pops: true });
  const spiky = popResult({ kind: 'spiky' }, 'carrot');
  assert.deepEqual(spiky, { result: 'spiky', delta: -1, stunSec: 0, pops: false });
  assert.equal(BUBBLE.DURATION_SEC, 60);
});

test('bubble: target rotates every 12 s (§C6.1)', () => {
  assert.equal(BUBBLE.TARGET_ROTATE_SEC, 12);
  assert.equal(targetIndexAt(0), 0);
  assert.equal(targetIndexAt(11.999), 0);
  assert.equal(targetIndexAt(12), 1);
  assert.equal(targetIndexAt(59.9), 4);
});

test('bubble: target order is deterministic, from the catalog, no immediate repeats', () => {
  const a = targetOrder(mulberry32(11), 12);
  const b = targetOrder(mulberry32(11), 12);
  assert.deepEqual(a, b);
  assert.equal(a.length, 12);
  for (let i = 0; i < a.length; i += 1) {
    assert.ok(BUBBLE.FOODS.includes(a[i]));
    if (i > 0) assert.notEqual(a[i], a[i - 1], 'no immediate repeat');
  }
});

test('bubble: speed & density ramp up and clamp at the round end (§C6.1)', () => {
  assert.equal(riseSpeedAt(0), BUBBLE.RISE_START);
  assert.equal(riseSpeedAt(BUBBLE.DURATION_SEC), BUBBLE.RISE_END);
  assert.equal(riseSpeedAt(BUBBLE.DURATION_SEC * 10), BUBBLE.RISE_END, 'clamped');
  assert.ok(riseSpeedAt(30) > riseSpeedAt(10), 'monotonic up');
  assert.equal(spawnIntervalAt(0), BUBBLE.SPAWN_SEC_START);
  assert.equal(spawnIntervalAt(BUBBLE.DURATION_SEC), BUBBLE.SPAWN_SEC_END);
  assert.ok(spawnIntervalAt(40) < spawnIntervalAt(5), 'spawns tighten');
});

test('bubble: rollBubble mixes spiky/target/other per the tuned ratios', () => {
  const rng = mulberry32(99);
  let spiky = 0;
  let target = 0;
  let other = 0;
  const N = 4000;
  for (let i = 0; i < N; i += 1) {
    const b = rollBubble(rng, 'carrot');
    if (b.kind === 'spiky') spiky += 1;
    else if (b.food === 'carrot') target += 1;
    else {
      other += 1;
      assert.ok(BUBBLE.FOODS.includes(b.food));
      assert.notEqual(b.food, 'carrot', 'non-target rolls never duplicate the target');
    }
  }
  assert.ok(Math.abs(spiky / N - BUBBLE.SPIKY_CHANCE) < 0.02, `spiky share ${spiky / N}`);
  const expTarget = (1 - BUBBLE.SPIKY_CHANCE) * BUBBLE.TARGET_CHANCE;
  assert.ok(Math.abs(target / N - expTarget) < 0.03, `target share ${target / N}`);
  assert.ok(other > 0);
});

test('bubble: score floors at 0 and typical raw ≈ 52 pays ~13c (§C6 row)', () => {
  assert.equal(applyScore(1, -2), 0);
  assert.equal(applyScore(10, 2), 12);
  const row = COIN_TABLE.bubblePop;
  assert.equal(computeCoins(row, 52, false), 13);
  assert.equal(computeCoins(row, 0, false), row.min);
  assert.equal(computeCoins(row, 9999, false), row.max);
});

// ===========================================================================
// Trampoline Tricks (§C6.1 #12)
// ===========================================================================

test('tramp: landing window shrinks as height grows, with a floor (§C6.1)', () => {
  assert.equal(windowSecFor(0), TRAMP.WINDOW_BASE_SEC);
  const w1 = windowSecFor(1.5);
  const w2 = windowSecFor(3);
  const w3 = windowSecFor(4.2);
  assert.ok(w1 > w2 && w2 > w3, 'monotonic shrink');
  assert.equal(windowSecFor(1000), TRAMP.WINDOW_MIN_SEC, 'floored');
  assert.equal(w1, TRAMP.WINDOW_BASE_SEC - TRAMP.WINDOW_SHRINK_PER_WU * 1.5);
});

test('tramp: height multiplier tiers ×1–3 at the exact boundaries (§C6.1)', () => {
  assert.equal(heightMultiplier(0), 1);
  assert.equal(heightMultiplier(TRAMP.TIER2_APEX - 0.01), 1);
  assert.equal(heightMultiplier(TRAMP.TIER2_APEX), 2);
  assert.equal(heightMultiplier(TRAMP.TIER3_APEX - 0.01), 2);
  assert.equal(heightMultiplier(TRAMP.TIER3_APEX), 3);
  assert.equal(heightMultiplier(100), 3);
});

test('tramp: ballistic helpers are self-consistent', () => {
  const vy = 6;
  const apex = apexFor(vy);
  assert.ok(Math.abs(apex - (vy * vy) / (2 * TRAMP.GRAVITY)) < 1e-12);
  assert.ok(Math.abs(airTimeFor(vy) - (2 * vy) / TRAMP.GRAVITY) < 1e-12);
  // at the apex (v=0, h=apex) time to impact is half the air time
  assert.ok(Math.abs(timeToImpact(apex, 0) - airTimeFor(vy) / 2) < 1e-9);
  // just-launched: full air time remains
  assert.ok(Math.abs(timeToImpact(0, vy) - airTimeFor(vy)) < 1e-9);
});

test('tramp: tap classification — boost in window, butt in zone, ignore earlier (§C6.1)', () => {
  const apexH = 1.5;
  const win = windowSecFor(apexH);
  assert.equal(classifyLandingTap(win - 0.01, apexH), 'boost');
  assert.equal(classifyLandingTap(win, apexH), 'boost', 'boundary is forgiving');
  assert.equal(classifyLandingTap(win + 0.01, apexH), 'butt');
  assert.equal(classifyLandingTap(TRAMP.JUDGE_ZONE_SEC, apexH), 'butt');
  assert.equal(classifyLandingTap(TRAMP.JUDGE_ZONE_SEC + 0.01, apexH), 'ignore');
  // higher bounce → tighter window: the same tap can flip from boost to butt
  const highApex = 4;
  assert.equal(classifyLandingTap(0.2, 0), 'boost');
  assert.equal(classifyLandingTap(0.2, highApex), 'butt');
});

test('tramp: bounce rules — boost grows (capped), none decays (floored), butt resets (§C6.1)', () => {
  const boosted = nextBounceVy(TRAMP.BASE_VY, 'boost');
  assert.ok(boosted > TRAMP.BASE_VY);
  let v = TRAMP.BASE_VY;
  for (let i = 0; i < 50; i += 1) v = nextBounceVy(v, 'boost');
  assert.equal(v, TRAMP.MAX_VY, 'boost cap');
  let d = TRAMP.BASE_VY;
  for (let i = 0; i < 50; i += 1) d = nextBounceVy(d, 'none');
  assert.equal(d, TRAMP.MIN_VY, 'passive decay floor');
  assert.equal(nextBounceVy(TRAMP.MAX_VY, 'butt'), TRAMP.BASE_VY, 'butt-landing resets the height');
});

test('tramp: trick points = base × height multiplier ×1–3 (§C6.1)', () => {
  for (const kind of ['flip', 'spin', 'twist']) {
    for (const mult of [1, 2, 3]) {
      assert.equal(trickPoints(kind, mult), TRAMP.TRICK_PTS[kind] * mult);
    }
  }
  assert.equal(TRAMP.TRICK_PTS.twist > TRAMP.TRICK_PTS.flip, true, 'up-swipe is the premium trick');
});

test('tramp: canTrick — mid-air only, never while landing is imminent or mid-trick', () => {
  assert.equal(canTrick(true, 1.0, false), true);
  assert.equal(canTrick(false, 1.0, false), false, 'grounded');
  assert.equal(canTrick(true, TRAMP.TRICK_MIN_AIR_SEC, false), false, 'landing imminent');
  assert.equal(canTrick(true, 1.0, true), false, 'already tricking');
});

test('tramp: score = sum of trick points; typical raw ≈ 70 pays ~14c (§C6 row)', () => {
  assert.equal(trampolineScore([]), 0);
  assert.equal(trampolineScore([2, 4, 6, 9]), 21);
  const row = COIN_TABLE.trampoline;
  assert.equal(computeCoins(row, 70, false), 14);
  assert.equal(computeCoins(row, 0, false), row.min);
  assert.equal(computeCoins(row, 9999, false), row.max);
});

test('tramp: max-height apex stays inside the §C6.1 tier-3 band', () => {
  const maxApex = apexFor(TRAMP.MAX_VY);
  assert.ok(maxApex >= TRAMP.TIER3_APEX, 'the cap can reach ×3');
  assert.ok(apexFor(TRAMP.BASE_VY) < TRAMP.TIER2_APEX, 'the base bounce is ×1');
});
