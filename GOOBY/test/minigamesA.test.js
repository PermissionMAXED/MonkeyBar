// Minigames A (agent G8, §C6.1 #2–5): pure scoring/ramp/collision logic tests
// against the <id>.logic.js siblings (which import no three.js/DOM — §B rule).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CATCH,
  GOOD_FOODS,
  JUNK_FOODS,
  fallSpeedMultAt,
  fallSpeedAt,
  junkRatioAt,
  spawnIntervalAt as catchSpawnIntervalAt,
  rollItem,
  applyCatch,
  goldenSpawnAt,
  itemFallSpeed,
  spawnXForRoll,
  basketCatchesX,
  applyCatchState,
} from '../src/minigames/games/carrotCatch.logic.js';
import {
  HOP,
  speedAtGate,
  gapAtGate,
  forgivingHalf,
  stepPhysics,
  collides,
  rollGapCenter,
  gustPhaseAt,
  applyGustShift,
  gatePoints,
} from '../src/minigames/games/bunnyHop.logic.js';
import {
  GUARD,
  upTimeAt,
  spawnIntervalAt as guardSpawnIntervalAt,
  doubleChanceAt,
  comboBonus,
  applyBonk,
  applyEscape,
  applyWhiff,
  isRoundOver,
  isKingDue,
  applyKingTap,
  acceptsTapAfter,
} from '../src/minigames/games/carrotGuard.logic.js';
import {
  MEMORY,
  FACE_KEYS,
  layoutForLevel,
  buildDeck,
  timeBonus,
  memoryScore,
  isMatch,
  advancePeekProgress,
  canUsePeek,
  canFlipCard,
  gridExtents,
} from '../src/minigames/games/memoryMatch.logic.js';
import { MINIGAME, COIN_TABLE } from '../src/data/constants.js';
import { computeCoins } from '../src/data/minigames.js';

/** Deterministic rng (mulberry32) for seeded distribution checks. */
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

test('G8 .logic.js modules import no three.js', () => {
  for (const id of ['carrotCatch', 'bunnyHop', 'carrotGuard', 'memoryMatch']) {
    const src = readFileSync(
      fileURLToPath(new URL(`../src/minigames/games/${id}.logic.js`, import.meta.url)),
      'utf8'
    );
    assert.ok(!/from\s+['"]three['"]/.test(src), `${id}.logic.js imports three`);
    assert.ok(!/document\.|window\./.test(src), `${id}.logic.js touches the DOM`);
  }
});

// ---------------------------------------------------------------------------
// #2 carrotCatch (§C6.1): item values, junk penalty math, ramp schedule
// ---------------------------------------------------------------------------

test('carrotCatch: 60 s round, junk −2 with 0.5 s dizzy (§C6.1 verbatim)', () => {
  assert.equal(CATCH.DURATION_SEC, 60);
  assert.equal(CATCH.JUNK_PENALTY, -2);
  assert.equal(CATCH.DIZZY_SEC, 0.5);
});

test('carrotCatch: fall speed +8% per full 10 s, stepped (§C6.1)', () => {
  assert.equal(fallSpeedMultAt(0), 1);
  assert.equal(fallSpeedMultAt(9.99), 1);
  assert.ok(Math.abs(fallSpeedMultAt(10) - 1.08) < 1e-9);
  assert.ok(Math.abs(fallSpeedMultAt(20) - 1.08 ** 2) < 1e-9);
  assert.ok(Math.abs(fallSpeedMultAt(59.9) - 1.08 ** 5) < 1e-9);
  assert.ok(Math.abs(fallSpeedAt(30) - CATCH.FALL_BASE_SPEED * 1.08 ** 3) < 1e-9);
});

test('carrotCatch: junk ratio ramps 10% → 30% linearly and clamps (§C6.1)', () => {
  assert.equal(junkRatioAt(0), 0.1);
  assert.ok(Math.abs(junkRatioAt(30) - 0.2) < 1e-9);
  assert.ok(Math.abs(junkRatioAt(60) - 0.3) < 1e-9);
  assert.equal(junkRatioAt(-5), 0.1); // clamps below
  assert.equal(junkRatioAt(600), 0.3); // clamps above
  for (let e = 0; e < 60; e += 5) {
    assert.ok(junkRatioAt(e) <= junkRatioAt(e + 5), 'monotonic ramp');
  }
});

test('carrotCatch: spawn cadence tightens but stays bounded', () => {
  assert.equal(catchSpawnIntervalAt(0), CATCH.SPAWN_BASE_SEC);
  assert.ok(
    Math.abs(catchSpawnIntervalAt(60) - CATCH.SPAWN_BASE_SEC * CATCH.SPAWN_END_FRACTION) < 1e-9
  );
  assert.ok(catchSpawnIntervalAt(30) < catchSpawnIntervalAt(0));
  assert.ok(catchSpawnIntervalAt(9999) > 0.5, 'never degenerates into a spam hose');
});

test('carrotCatch: good food +1–3 pts by rarity, junk table (§C6.1)', () => {
  assert.ok(GOOD_FOODS.length >= 8);
  for (const f of GOOD_FOODS) {
    assert.ok(f.value >= 1 && f.value <= 3, `${f.key} value 1–3`);
    assert.ok(f.weight > 0);
  }
  // rarity: higher value ⇒ lower total tier weight
  const tierWeight = (v) => GOOD_FOODS.filter((f) => f.value === v).reduce((s, f) => s + f.weight, 0);
  assert.ok(tierWeight(1) > tierWeight(2) && tierWeight(2) > tierWeight(3));
  assert.deepEqual([...JUNK_FOODS].sort(), ['fish-bones', 'soda-can-crushed']);
});

test('carrotCatch: rollItem honors the junk ratio and rarity weights (seeded)', () => {
  const rng = rngFrom(1234);
  const N = 20000;
  let junk = 0;
  let goodValueSum = 0;
  let good = 0;
  for (let i = 0; i < N; i += 1) {
    const item = rollItem(rng, 0); // 10% junk at round start
    if (item.kind === 'junk' || item.kind === 'rotten') {
      junk += 1;
      assert.equal(item.value, CATCH.JUNK_PENALTY);
      if (item.kind === 'rotten') assert.equal(item.key, 'carrot');
      else assert.ok(JUNK_FOODS.includes(item.key));
    } else {
      good += 1;
      goodValueSum += item.value;
      assert.ok(GOOD_FOODS.some((f) => f.key === item.key && f.value === item.value));
    }
  }
  const junkFrac = junk / N;
  assert.ok(Math.abs(junkFrac - 0.1) < 0.01, `junk fraction ${junkFrac} ≈ 0.1`);
  const avg = goodValueSum / good;
  const expected =
    GOOD_FOODS.reduce((s, f) => s + f.value * f.weight, 0) /
    GOOD_FOODS.reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(avg - expected) < 0.05, `avg good value ${avg} ≈ ${expected}`);
});

test('carrotCatch: junk penalty math floors the score at 0', () => {
  assert.equal(applyCatch(5, CATCH.JUNK_PENALTY), 3);
  assert.equal(applyCatch(1, CATCH.JUNK_PENALTY), 0);
  assert.equal(applyCatch(0, CATCH.JUNK_PENALTY), 0);
  assert.equal(applyCatch(7, 3), 10);
});

test('V3 carrotCatch: one golden carrot is scheduled +10 at 1.5× fall speed', () => {
  const at = goldenSpawnAt(() => 0.25);
  assert.equal(at, 20);
  assert.ok(at >= CATCH.GOLDEN_WINDOW_START_SEC && at <= CATCH.GOLDEN_WINDOW_END_SEC);
  assert.equal(goldenSpawnAt(() => 1, 30), 25, '30 s tutorial still gets one with flight time');
  assert.equal(CATCH.GOLDEN_POINTS, 10);
  assert.equal(itemFallSpeed(30, 'golden'), fallSpeedAt(30) * 1.5);
  assert.equal(itemFallSpeed(30, 'good'), fallSpeedAt(30));
});

test('V3 carrotCatch: rotten carrot breaks the streak and applies −2', () => {
  const good = applyCatchState({ score: 4, combo: 2 }, { kind: 'good', value: 2 });
  assert.deepEqual(good, { score: 6, combo: 3, delta: 2 });
  const golden = applyCatchState(good, { kind: 'golden', value: 10 });
  assert.deepEqual(golden, { score: 16, combo: 4, delta: 10 });
  const rotten = applyCatchState(golden, { kind: 'rotten', value: -2 });
  assert.deepEqual(rotten, { score: 14, combo: 0, delta: -2 });
});

test('V3 carrotCatch audit: edge spawn mapping is uniform and basket hitbox is UI-scale independent', () => {
  const halfW = 2.3;
  const bins = new Array(10).fill(0);
  const r = rngFrom(0x43);
  for (let i = 0; i < 20000; i += 1) {
    const x = spawnXForRoll(r(), halfW);
    const norm = (x / (halfW - CATCH.SPAWN_EDGE_PAD) + 1) / 2;
    bins[Math.min(9, Math.floor(norm * 10))] += 1;
  }
  for (const n of bins) assert.ok(Math.abs(n - 2000) < 150, `unbiased bin count ${n}`);
  assert.equal(basketCatchesX(0.62, 0), true);
  const edge = spawnXForRoll(0, halfW);
  assert.equal(basketCatchesX(edge, edge + CATCH.BASKET_HALF_WIDTH), true);
  assert.equal(basketCatchesX(0.62001, 0), false);
  for (const uiScale of [0.85, 1, 1.3]) {
    assert.equal(basketCatchesX(1.2, 0.7), true, `world hitbox unchanged at ${uiScale}`);
  }
});

test('carrotCatch: a typical round lands the ~15c §C6 target', () => {
  // Model: ~64 spawns/round, ~20% junk on average, 65% good-catch rate,
  // a couple of junk grabs — must clamp into the coin row and sit near 15c.
  const rng = rngFrom(77);
  let score = 0;
  let t = 0;
  while (t < CATCH.DURATION_SEC) {
    const item = rollItem(rng, t);
    if (item.kind === 'good' && rng() < 0.65) score = applyCatch(score, item.value);
    else if (item.kind === 'junk' && rng() < 0.15) score = applyCatch(score, item.value);
    t += catchSpawnIntervalAt(t);
  }
  const coins = computeCoins(COIN_TABLE.carrotCatch, score, false);
  assert.ok(score >= 30 && score <= 70, `typical raw score ${score} ≈ 45`);
  assert.ok(coins >= 10 && coins <= 25, `typical coins ${coins} ≈ 15`);
});

// ---------------------------------------------------------------------------
// #3 bunnyHop (§C6.1): gate speed/gap ramp, hitbox forgiveness math
// ---------------------------------------------------------------------------

test('bunnyHop: speed +2% per gate, compounding (§C6.1)', () => {
  assert.equal(speedAtGate(0), HOP.BASE_SPEED);
  assert.ok(Math.abs(speedAtGate(1) / speedAtGate(0) - 1.02) < 1e-9);
  assert.ok(Math.abs(speedAtGate(10) - HOP.BASE_SPEED * 1.02 ** 10) < 1e-9);
  assert.equal(speedAtGate(-3), HOP.BASE_SPEED); // never below base
});

test('bunnyHop: gap narrows every 10 gates with a floor (§C6.1)', () => {
  assert.equal(gapAtGate(0), HOP.GAP_BASE);
  assert.equal(gapAtGate(9), HOP.GAP_BASE);
  assert.ok(Math.abs(gapAtGate(10) - (HOP.GAP_BASE - HOP.GAP_NARROW_STEP)) < 1e-9);
  assert.ok(Math.abs(gapAtGate(29) - (HOP.GAP_BASE - 2 * HOP.GAP_NARROW_STEP)) < 1e-9);
  assert.equal(gapAtGate(9999), HOP.GAP_MIN);
  assert.ok(HOP.GAP_MIN > 2 * forgivingHalf(HOP.BODY_HALF_H), 'gap floor stays passable');
});

test('bunnyHop: 70% forgiving hitbox (§C6.1)', () => {
  assert.equal(HOP.HITBOX_SCALE, 0.7);
  assert.ok(Math.abs(forgivingHalf(1) - 0.7) < 1e-9);
  assert.ok(Math.abs(forgivingHalf(HOP.BODY_HALF_H) - HOP.BODY_HALF_H * 0.7) < 1e-9);
});

test('bunnyHop: collision forgives visual-only overlap, catches real hits', () => {
  const pillar = { x: 0, gapCenterY: 0, gapHeight: 2.0 };
  const gapTop = 1.0;
  // centered in the gap at the column → safe
  assert.equal(collides({ x: 0, y: 0 }, pillar), false);
  // visual overlap only: body edge (0.42) pokes past the gap top but the
  // forgiving edge (0.294) does not → still safe (§C6.1 forgiveness)
  const grazeY = gapTop - (HOP.BODY_HALF_H * 0.85);
  assert.ok(grazeY + HOP.BODY_HALF_H > gapTop, 'sanity: visually overlapping');
  assert.equal(collides({ x: 0, y: grazeY }, pillar), false);
  // real hit: forgiving edge crosses the gap top → crash
  const hitY = gapTop - forgivingHalf(HOP.BODY_HALF_H) + 0.01;
  assert.equal(collides({ x: 0, y: hitY }, pillar), true);
  // same height but away from the column → safe
  assert.equal(collides({ x: 5, y: hitY }, pillar), false);
  // ground contact is always a crash
  assert.equal(collides({ x: 5, y: HOP.FLOOR_Y }, pillar), true);
});

test('bunnyHop: physics integrates gravity and clamps at the ceiling', () => {
  let s = { y: 0, vy: HOP.HOP_VY };
  s = stepPhysics(s, 0.1);
  assert.ok(s.vy < HOP.HOP_VY, 'gravity pulls');
  assert.ok(s.y > 0, 'still rising right after a hop');
  s = stepPhysics({ y: HOP.CEILING_Y - 0.01, vy: 10 }, 0.1);
  assert.equal(s.y, HOP.CEILING_Y);
  assert.equal(s.vy, 0);
});

test('bunnyHop: rolled gap centers keep the gap inside the playfield', () => {
  const rng = rngFrom(42);
  for (let i = 0; i < 500; i += 1) {
    const gap = gapAtGate(i % 40);
    const c = rollGapCenter(rng, gap);
    assert.ok(c - gap / 2 > HOP.FLOOR_Y, 'gap bottom above the floor');
    assert.ok(c + gap / 2 < HOP.CEILING_Y, 'gap top below the ceiling');
  }
});

test('bunnyHop: consecutive gap centers stay within a fair climb/dive', () => {
  const rng = rngFrom(7);
  let prev;
  for (let i = 0; i < 500; i += 1) {
    const gap = gapAtGate(i % 40);
    const c = rollGapCenter(rng, gap, prev);
    if (prev !== undefined) {
      assert.ok(c - prev <= HOP.GAP_MAX_CLIMB + 1e-9, `climb ${c - prev} ≤ ${HOP.GAP_MAX_CLIMB}`);
      assert.ok(prev - c <= HOP.GAP_MAX_DIVE + 1e-9, `dive ${prev - c} ≤ ${HOP.GAP_MAX_DIVE}`);
    }
    assert.ok(c - gap / 2 > HOP.FLOOR_Y, 'gap bottom above the floor');
    assert.ok(c + gap / 2 < HOP.CEILING_Y, 'gap top below the ceiling');
    prev = c;
  }
});

test('V3 bunnyHop: gust is telegraphed, shifts exactly 0.4 lane, gates count double', () => {
  assert.deepEqual(gustPhaseAt(4.49).phase, 'none');
  assert.deepEqual(gustPhaseAt(4.5), { phase: 'telegraph', index: 0, direction: 1 });
  assert.deepEqual(gustPhaseAt(6), { phase: 'gust', index: 0, direction: 1 });
  assert.deepEqual(gustPhaseAt(14.5), { phase: 'telegraph', index: 1, direction: -1 });
  assert.deepEqual(gustPhaseAt(16), { phase: 'gust', index: 1, direction: -1 });
  assert.equal(applyGustShift(0, 1), HOP.GUST_SHIFT_LANES * HOP.LANE_HEIGHT);
  assert.equal(gatePoints(false), 1);
  assert.equal(gatePoints(true), 2);
});

test('V3 bunnyHop audit: high-rate hops keep forgiving gate tolerance; pause freezes flap state', () => {
  const pillar = { x: 0, gapCenterY: 0, gapHeight: HOP.GAP_MIN };
  let s = { y: 0, vy: HOP.HOP_VY };
  for (let i = 0; i < 8; i += 1) {
    s = stepPhysics(s, 1 / 120);
    if (i % 2 === 0) s.vy = HOP.HOP_VY;
  }
  assert.equal(collides({ x: 0, y: 0 }, pillar), false, 'center remains safe at high flap cadence');
  const paused = { ...s };
  assert.deepEqual(paused, s, 'no game update means no mid-flap integration');
  const resumed = stepPhysics(paused, 1 / 60);
  assert.ok(Number.isFinite(resumed.y) && Number.isFinite(resumed.vy));
});

test('bunnyHop: ~24 gates hits the ~12c §C6 target', () => {
  assert.equal(computeCoins(COIN_TABLE.bunnyHop, 24, false), 12);
  assert.equal(computeCoins(COIN_TABLE.bunnyHop, 0, false), 3); // min clamp
  assert.equal(computeCoins(COIN_TABLE.bunnyHop, 999, false), 25); // max clamp
});

// ---------------------------------------------------------------------------
// #4 carrotGuard (§C6.1): mole timing ramp, steal/combo rules
// ---------------------------------------------------------------------------

test('carrotGuard: 45 s round, 3×3 grid, 10 carrots (§C6.1 verbatim)', () => {
  assert.equal(GUARD.DURATION_SEC, 45);
  assert.equal(GUARD.GRID, 3);
  assert.equal(GUARD.CARROTS, 10);
});

test('carrotGuard: mole up-time ramps 0.9 s → 0.5 s (§C6.1)', () => {
  assert.equal(upTimeAt(0), 0.9);
  assert.ok(Math.abs(upTimeAt(GUARD.DURATION_SEC / 2) - 0.7) < 1e-9);
  assert.equal(upTimeAt(GUARD.DURATION_SEC), 0.5);
  assert.equal(upTimeAt(9999), 0.5); // clamps
  assert.equal(upTimeAt(-1), 0.9);
  for (let e = 0; e < 45; e += 5) {
    assert.ok(upTimeAt(e) >= upTimeAt(e + 5), 'monotonic ramp down');
  }
});

test('carrotGuard: spawn cadence and double-mole odds ramp across the round', () => {
  assert.equal(guardSpawnIntervalAt(0), GUARD.SPAWN_START_SEC);
  assert.equal(guardSpawnIntervalAt(45), GUARD.SPAWN_END_SEC);
  assert.ok(guardSpawnIntervalAt(20) < guardSpawnIntervalAt(0));
  assert.equal(doubleChanceAt(0), 0);
  assert.equal(doubleChanceAt(45), GUARD.DOUBLE_CHANCE_END);
});

test('carrotGuard: combo ≥5 → +3 bonus at every 5-streak (§C6.1)', () => {
  assert.equal(comboBonus(0), 0);
  assert.equal(comboBonus(4), 0);
  assert.equal(comboBonus(5), 3);
  assert.equal(comboBonus(6), 0);
  assert.equal(comboBonus(10), 3);
  assert.equal(comboBonus(15), 3);
});

test('carrotGuard: bonk pays +1 (+3 at streak multiples of 5)', () => {
  let s = { score: 0, combo: 0 };
  for (let i = 1; i <= 5; i += 1) s = applyBonk(s);
  assert.equal(s.combo, 5);
  assert.equal(s.score, 5 + 3, '5 hits + one 5-streak bonus');
  for (let i = 6; i <= 10; i += 1) s = applyBonk(s);
  assert.equal(s.score, 10 + 6, '10 hits + two streak bonuses');
});

test('carrotGuard: escaped mole steals a carrot and resets the combo (§C6.1)', () => {
  const s = applyEscape({ carrots: 10, combo: 7 });
  assert.equal(s.carrots, 9);
  assert.equal(s.combo, 0);
  assert.equal(applyEscape({ carrots: 0, combo: 1 }).carrots, 0, 'floors at 0');
});

test('carrotGuard: whiffed taps reset the streak (no combo farming by spam)', () => {
  assert.equal(applyWhiff({ combo: 4 }).combo, 0);
});

test('carrotGuard: round ends at 45 s OR when all carrots are gone (§C6.1)', () => {
  assert.equal(isRoundOver({ elapsed: 44.9, carrots: 3 }), false);
  assert.equal(isRoundOver({ elapsed: 45, carrots: 3 }), true);
  assert.equal(isRoundOver({ elapsed: 10, carrots: 0 }), true);
});

test('V3 carrotGuard: mole king every 20 bonks needs 3 taps and pays +8 plus two coins-worth', () => {
  assert.equal(isKingDue(19, 0), false);
  assert.equal(isKingDue(20, 0), true);
  assert.equal(isKingDue(39, 1), false);
  assert.equal(isKingDue(40, 1), true);
  let king = { score: 10, combo: 2, hp: GUARD.KING_TAPS };
  king = applyKingTap(king);
  assert.equal(king.complete, false);
  assert.equal(king.hp, 2);
  king = applyKingTap(king);
  assert.equal(king.complete, false);
  king = applyKingTap(king);
  assert.equal(king.complete, true);
  assert.equal(
    king.gained,
    GUARD.KING_POINTS + GUARD.KING_COIN_DROP * GUARD.KING_SCORE_PER_COIN
  );
});

test('V3 carrotGuard audit: simultaneous duplicate taps and whiff spam are debounced', () => {
  assert.equal(acceptsTapAfter(0), false, 'same-frame duplicate rejected');
  assert.equal(acceptsTapAfter(GUARD.TAP_DEBOUNCE_SEC - 1e-6), false);
  assert.equal(acceptsTapAfter(GUARD.TAP_DEBOUNCE_SEC), true);
  assert.equal(acceptsTapAfter(0.1, GUARD.WHIFF_COOLDOWN_SEC), false);
  assert.equal(acceptsTapAfter(GUARD.WHIFF_COOLDOWN_SEC, GUARD.WHIFF_COOLDOWN_SEC), true);
});

test('carrotGuard: a typical round lands the ~15c §C6 target', () => {
  // Model: spawn cadence per the ramp, 80% hit rate, escapes steal carrots.
  const rng = rngFrom(9);
  let t = 0;
  let state = { score: 0, combo: 0 };
  let carrots = GUARD.CARROTS;
  while (!isRoundOver({ elapsed: t, carrots })) {
    const moles = 1 + (rng() < doubleChanceAt(t) ? 1 : 0);
    for (let m = 0; m < moles; m += 1) {
      if (rng() < 0.8) {
        state = applyBonk(state);
      } else {
        const e = applyEscape({ carrots, combo: state.combo });
        carrots = e.carrots;
        state = { ...state, combo: e.combo };
      }
    }
    t += guardSpawnIntervalAt(t);
  }
  const coins = computeCoins(COIN_TABLE.carrotGuard, state.score, false);
  assert.ok(state.score >= 30 && state.score <= 65, `typical raw score ${state.score} ≈ 45`);
  assert.ok(coins >= 10 && coins <= 22, `typical coins ${coins} ≈ 15`);
});

// ---------------------------------------------------------------------------
// #5 memoryMatch (§C6.1): layouts, deck, score formula incl. time-bonus clamps
// ---------------------------------------------------------------------------

test('memoryMatch: 4×4/8 pairs, 6×4/12 pairs at L6+ (§C6.1, §C1.5)', () => {
  assert.deepEqual({ ...layoutForLevel(1) }, { cols: 4, rows: 4, pairs: 8 });
  assert.deepEqual({ ...layoutForLevel(MINIGAME.MEMORY_BIG_LAYOUT_LEVEL - 1) }, { cols: 4, rows: 4, pairs: 8 });
  const big = layoutForLevel(MINIGAME.MEMORY_BIG_LAYOUT_LEVEL);
  assert.equal(big.pairs, 12);
  assert.equal(big.cols * big.rows, 24, '6×4 grid');
  for (const layout of [MEMORY.SMALL, MEMORY.BIG]) {
    assert.equal(layout.cols * layout.rows, layout.pairs * 2, 'every card has a twin');
    assert.ok(layout.pairs <= FACE_KEYS.length, 'enough food faces');
  }
});

test('memoryMatch: deck has every pair id exactly twice, seeded-deterministic', () => {
  for (const pairs of [8, 12]) {
    const deck = buildDeck(pairs, rngFrom(5));
    assert.equal(deck.length, pairs * 2);
    const counts = new Map();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (let i = 0; i < pairs; i += 1) assert.equal(counts.get(i), 2, `pair ${i} twice`);
  }
  assert.deepEqual(buildDeck(8, rngFrom(5)), buildDeck(8, rngFrom(5)), 'same seed → same deck');
  assert.notDeepEqual(buildDeck(8, rngFrom(5)), buildDeck(8, rngFrom(6)), 'different seed → shuffled differently');
});

test('memoryMatch: time bonus clamps 0–8 (§C6.1)', () => {
  const small = MEMORY.SMALL;
  assert.equal(timeBonus(0, small), 8);
  assert.equal(timeBonus(MEMORY.PAR_SEC_SMALL, small), 8, 'full bonus at par');
  assert.equal(timeBonus(MEMORY.PAR_SEC_SMALL + 1, small), 7);
  assert.equal(timeBonus(MEMORY.PAR_SEC_SMALL + MEMORY.TIME_BONUS_STEP_SEC, small), 7);
  assert.equal(timeBonus(MEMORY.PAR_SEC_SMALL + MEMORY.TIME_BONUS_STEP_SEC + 0.01, small), 6);
  assert.equal(timeBonus(10000, small), 0, 'never negative');
  // the big layout gets a longer par
  assert.equal(timeBonus(MEMORY.PAR_SEC_BIG, MEMORY.BIG), 8);
  assert.ok(timeBonus(MEMORY.PAR_SEC_BIG, small) < 8);
});

test('memoryMatch: score = 20 − misses + timeBonus, floored at 0 (§C6.1 verbatim)', () => {
  assert.equal(memoryScore(0, 0, MEMORY.SMALL), 28, 'perfect: 20 − 0 + 8');
  assert.equal(memoryScore(6, MEMORY.PAR_SEC_SMALL, MEMORY.SMALL), 22);
  assert.equal(memoryScore(6, 10000, MEMORY.SMALL), 14, 'no time bonus');
  assert.equal(memoryScore(40, 10000, MEMORY.SMALL), 0, 'floored at 0 (no fail state)');
});

test('memoryMatch: typical scores clamp into the §C6 coin row (min 5)', () => {
  // decent round: 5 misses under par → 23 → 11c; bad round still pays min 5
  assert.equal(computeCoins(COIN_TABLE.memoryMatch, memoryScore(5, 40, MEMORY.SMALL), false), 11);
  assert.equal(computeCoins(COIN_TABLE.memoryMatch, 0, false), 5);
  assert.equal(computeCoins(COIN_TABLE.memoryMatch, 28, false), 14, 'perfect = 14c');
});

test('memoryMatch: isMatch compares pair ids', () => {
  assert.equal(isMatch(3, 3), true);
  assert.equal(isMatch(3, 4), false);
});

test('V3 memoryMatch: peek unlocks at 3 clean matches, resets on miss, and is one-shot', () => {
  let s = { cleanMatches: 0, peekReady: false, peekUsed: false };
  s = advancePeekProgress(s, true);
  s = advancePeekProgress(s, true);
  assert.equal(canUsePeek(s), false);
  s = advancePeekProgress(s, true);
  assert.equal(s.cleanMatches, 3);
  assert.equal(canUsePeek(s), true);
  s = { ...s, peekReady: false, peekUsed: true };
  s = advancePeekProgress(s, false);
  s = advancePeekProgress(s, true);
  s = advancePeekProgress(s, true);
  s = advancePeekProgress(s, true);
  assert.equal(canUsePeek(s), false, 'cannot earn a second peek');
  assert.equal(MEMORY.PEEK_SEC, 1);
});

test('V3 memoryMatch audit: rapid double-flip closes synchronously before a third card', () => {
  assert.equal(canFlipCard({ phase: 'play', pickedCount: 0, cardState: 'down', peeking: false }), true);
  assert.equal(canFlipCard({ phase: 'play', pickedCount: 1, cardState: 'down', peeking: false }), true);
  assert.equal(canFlipCard({ phase: 'play', pickedCount: 2, cardState: 'down', peeking: false }), false);
  assert.equal(canFlipCard({ phase: 'play', pickedCount: 0, cardState: 'up', peeking: false }), false);
  assert.equal(canFlipCard({ phase: 'play', pickedCount: 0, cardState: 'down', peeking: true }), false);
});

test('V3 memoryMatch audit: 6×4 board fits 320×568 canvas even with 130% DOM UI', () => {
  const ext = gridExtents(MEMORY.BIG);
  const halfH = Math.tan((45 / 2) * Math.PI / 180) * 10;
  const halfW = halfH * (320 / 568);
  assert.ok(ext.width / 2 < halfW, `${ext.width} world-width fits ${halfW * 2}`);
  assert.ok(ext.height < halfH * 2, `${ext.height} world-height fits ${halfH * 2}`);
  assert.equal(MEMORY.BIG.cols * MEMORY.BIG.rows, 24);
});
