// Minigames B (G9, §C6.1 #6–8) — pure-logic tests for runner.logic.js,
// basketBounce.logic.js and pancakeTower.logic.js: collision windows,
// spawn-pattern survivability, speed ramps, arc solver + scoring rules,
// slice math, perfect-drop threshold, topping schedule and end conditions.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RUNNER,
  speedAt,
  difficultyAt,
  rowGapAt,
  comboMultiplier,
  runnerScore,
  actionPasses,
  hitsObstacle,
  sweepHitsObstacle,
  maxLaneShift,
  passableLanes,
  isPatternSurvivable,
  generateRow,
  rollMysteryPower,
  activateMysteryPower,
  mysteryCoinPoints,
  magnetCollects,
  resolveRunnerHit,
} from '../src/minigames/games/runner.logic.js';
import {
  BASKET,
  hoopSlideX,
  hoopDistance,
  flickToVelocity,
  stepBall,
  stepBallSwept,
  ringDistance,
  simulateShot,
  scoreShot,
  solveBasketVelocity,
  isMovingHoop,
} from '../src/minigames/games/basketBounce.logic.js';
import {
  PANCAKE,
  isToppingLayer,
  slideX,
  slidePeriod,
  resolveDrop,
  isTowerDone,
  towerScore,
  initialWobbleState,
  stepWobble,
  dampWobble,
  wobbleTopX,
  wobbleLocalX,
  isFallenExpired,
} from '../src/minigames/games/pancakeTower.logic.js';
import { COIN_TABLE } from '../src/data/constants.js';
import { computeCoins } from '../src/data/minigames.js';

/** Deterministic rng (mulberry32 — same algorithm the framework hands games). */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) | 0;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

// ===========================================================================
// Runner (§C6.1 #6)
// ===========================================================================

test('runner: speed ramps +5% per 10 s, compounding, capped (§C6.1 #6)', () => {
  assert.equal(speedAt(0), RUNNER.BASE_SPEED);
  assert.equal(speedAt(9.99), RUNNER.BASE_SPEED);
  assert.ok(Math.abs(speedAt(10) - RUNNER.BASE_SPEED * 1.05) < 1e-9);
  assert.ok(Math.abs(speedAt(25) - RUNNER.BASE_SPEED * 1.05 ** 2) < 1e-9);
  assert.equal(speedAt(10000), RUNNER.MAX_SPEED); // capped
});

test('runner: difficulty and row gap ramp monotonically', () => {
  assert.equal(difficultyAt(0), 0);
  assert.equal(difficultyAt(RUNNER.DIFFICULTY_FULL_SEC), 1);
  assert.equal(difficultyAt(99999), 1);
  assert.ok(rowGapAt(0) > rowGapAt(1), 'rows get denser with difficulty');
});

test('runner: combo multiplier steps with the coin streak and resets', () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(RUNNER.COMBO_STEPS[1] - 1), 1);
  assert.equal(comboMultiplier(RUNNER.COMBO_STEPS[1]), 2);
  assert.equal(comboMultiplier(RUNNER.COMBO_STEPS[2]), 3);
  assert.equal(comboMultiplier(9999), RUNNER.COMBO_MAX_MULT);
});

test('runner: score = floor(meters) + coin points (§C6.1 #6)', () => {
  assert.equal(runnerScore(231.7, 24), 255);
  assert.equal(runnerScore(0, 0), 0);
  assert.equal(runnerScore(-5, 0), 0); // never negative
});

test('runner: obstacle pass actions (jump kinds, slide kinds, cars never)', () => {
  for (const kind of ['cone', 'box', 'barrier']) {
    assert.equal(actionPasses(kind, 'jump'), true, `${kind} jumpable`);
    assert.equal(actionPasses(kind, 'slide'), false, `${kind} not slideable`);
  }
  assert.equal(actionPasses('overhead', 'slide'), true);
  assert.equal(actionPasses('overhead', 'jump'), false);
  assert.equal(actionPasses('car', 'jump'), false);
  assert.equal(actionPasses('car', 'slide'), false);
});

test('runner: collision windows — lane, z-window, jump clearance (§C6.1 #6)', () => {
  const cone = { lane: 1, kind: 'cone', z: 0 };
  // different lane never hits
  assert.equal(hitsObstacle({ lane: 0, y: 0, sliding: false }, cone), false);
  // same lane on the ground hits
  assert.equal(hitsObstacle({ lane: 1, y: 0, sliding: false }, cone), true);
  // jumping above clearY clears it
  const clearY = RUNNER.OBSTACLES.cone.clearY;
  assert.equal(hitsObstacle({ lane: 1, y: clearY + 0.01, sliding: false }, cone), false);
  assert.equal(hitsObstacle({ lane: 1, y: clearY - 0.01, sliding: false }, cone), true);
  // outside the z-window nothing hits
  const far = RUNNER.OBSTACLES.cone.halfDepth + RUNNER.PLAYER_HALF_DEPTH + 0.01;
  assert.equal(hitsObstacle({ lane: 1, y: 0, sliding: false }, { ...cone, z: far }), false);
  assert.equal(hitsObstacle({ lane: 1, y: 0, sliding: false }, { ...cone, z: -far }), false);
});

test('runner: low-FPS dt cannot tunnel a collision window (fix F4 P2-4)', () => {
  const player = { lane: 1, y: 0, sliding: false };
  // Smallest window: cone reach = halfDepth + player half-depth (±0.5 m).
  const reach = RUNNER.OBSTACLES.cone.halfDepth + RUNNER.PLAYER_HALF_DEPTH;
  // A 0.15 s hitch at MAX_SPEED advances ~1.95 m — clean across the window.
  const dz = RUNNER.MAX_SPEED * 0.15;
  const cone = { lane: 1, kind: 'cone', z: -reach - 0.4 }; // just short of it
  assert.ok(dz > 2 * reach + 0.4, 'frame advance spans the whole window');
  // the old single end-of-frame check misses (this WAS the tunneling bug) …
  assert.equal(hitsObstacle(player, { ...cone, z: cone.z + dz }), false);
  // … the swept check catches it
  assert.equal(sweepHitsObstacle(player, cone, dz), true);
  // sweeping keeps the pass rules: other lane / high jump still clear it
  assert.equal(sweepHitsObstacle({ ...player, lane: 0 }, cone, dz), false);
  assert.equal(
    sweepHitsObstacle({ ...player, y: RUNNER.OBSTACLES.cone.clearY + 0.01 }, cone, dz),
    false
  );
  // no window survives any frame length 15–60 fps at any live speed
  for (const fps of [15, 18, 20, 30, 60]) {
    for (const speed of [RUNNER.BASE_SPEED, 10, RUNNER.MAX_SPEED]) {
      const step = speed / fps;
      const start = { lane: 1, kind: 'barrier', z: -step - reach - 0.01 };
      let hitAny = false;
      for (let z = start.z; z < reach + step; z += step) {
        if (sweepHitsObstacle(player, { ...start, z }, step)) hitAny = true;
      }
      assert.ok(hitAny, `tunneled at ${fps} fps / ${speed} m/s`);
    }
  }
});

test('runner: overhead needs a grounded slide; cars always hit in-lane', () => {
  const bar = { lane: 2, kind: 'overhead', z: 0 };
  assert.equal(hitsObstacle({ lane: 2, y: 0, sliding: true }, bar), false, 'slide passes');
  assert.equal(hitsObstacle({ lane: 2, y: 0, sliding: false }, bar), true, 'standing bonks');
  assert.equal(hitsObstacle({ lane: 2, y: 0.8, sliding: false }, bar), true, 'jumping bonks');
  const car = { lane: 0, kind: 'car', z: 0 };
  assert.equal(hitsObstacle({ lane: 0, y: 1.0, sliding: false }, car), true, 'car unjumpable');
  assert.equal(hitsObstacle({ lane: 0, y: 0, sliding: true }, car), true, 'car unslideable');
});

test('V3 runner audit: slide uses the squashed height, not standing height', () => {
  const bar = { lane: 1, kind: 'overhead', z: 0 };
  assert.ok(RUNNER.SLIDE_HEIGHT < RUNNER.OBSTACLES.overhead.gapY);
  assert.ok(RUNNER.STAND_HEIGHT > RUNNER.OBSTACLES.overhead.gapY);
  assert.equal(hitsObstacle({ lane: 1, y: 0, sliding: true }, bar), false);
  assert.equal(hitsObstacle({ lane: 1, y: 0, sliding: false }, bar), true);
});

test('V3 runner: mystery box rolls Magnet 4 s / ×2 6 s / stumble shield', () => {
  assert.equal(rollMysteryPower(() => 0), 'magnet');
  assert.equal(rollMysteryPower(() => 0.5), 'x2');
  assert.equal(rollMysteryPower(() => 0.999), 'shield');
  let pu = { magnetT: 0, x2T: 0, shield: false };
  pu = activateMysteryPower(pu, 'magnet');
  assert.equal(pu.magnetT, 4);
  pu = activateMysteryPower(pu, 'x2');
  assert.equal(pu.x2T, 6);
  pu = activateMysteryPower(pu, 'shield');
  assert.equal(pu.shield, true);
  assert.equal(mysteryCoinPoints(3, false), 6);
  assert.equal(mysteryCoinPoints(3, true), 12);
  assert.equal(magnetCollects({ x: 2.9, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, true), true);
  assert.equal(magnetCollects({ x: 3.1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, true), false);
});

test('V3 runner audit: stumble is atomic; shield and invulnerability prevent double-hit', () => {
  const shielded = resolveRunnerHit({ hits: 0, shield: true, invulnT: 0 });
  assert.deepEqual(shielded, {
    hits: 0,
    shield: false,
    invulnT: RUNNER.STUMBLE_INVULN_SEC,
    outcome: 'shielded',
  });
  const ignored = resolveRunnerHit(shielded);
  assert.equal(ignored.outcome, 'ignored');
  assert.equal(ignored.hits, 0);
  const first = resolveRunnerHit({ hits: 0, shield: false, invulnT: 0 });
  assert.equal(first.outcome, 'stumble');
  assert.equal(resolveRunnerHit(first).hits, 1, 'same stumble window cannot add hit two');
  const second = resolveRunnerHit({ ...first, invulnT: 0 });
  assert.equal(second.outcome, 'wipeout');
  assert.equal(second.hits, 2);
});

test('runner: maxLaneShift grows with gap and shrinks with speed', () => {
  assert.equal(maxLaneShift(0.5, 13), 0); // almost no room
  assert.ok(maxLaneShift(10, 6) >= 2); // huge gap, slow → full freedom
  assert.ok(maxLaneShift(4, 13) <= maxLaneShift(8, 13));
});

test('runner: passableLanes — free / jumpable / slideable pass, cars do not', () => {
  assert.deepEqual(passableLanes({ lanes: [null, 'cone', 'car'], gap: 10 }), [true, true, false]);
  assert.deepEqual(passableLanes({ lanes: ['overhead', 'car', 'box'], gap: 10 }), [true, false, true]);
});

test('runner: survivability validator accepts a passable weave (§C6.1 #6)', () => {
  const rows = [
    { lanes: ['car', null, 'cone'], gap: 12 },
    { lanes: [null, 'car', 'overhead'], gap: 12 },
    { lanes: ['box', 'car', null], gap: 12 },
  ];
  assert.equal(isPatternSurvivable(rows, RUNNER.BASE_SPEED), true);
});

test('runner: survivability validator rejects impossible transitions', () => {
  // all-car wall — nothing passes
  assert.equal(
    isPatternSurvivable([{ lanes: ['car', 'car', 'car'], gap: 12 }], RUNNER.BASE_SPEED),
    false
  );
  // survivable lane exists but is 2 lanes away with a too-tight gap
  const rows = [
    { lanes: [null, 'car', 'car'], gap: 20 }, // player must be lane 0
    { lanes: ['car', 'car', null], gap: 0.5 }, // lane 2 unreachable in 0.5 m
  ];
  assert.equal(isPatternSurvivable(rows, 13), false);
  // the same jump with a generous gap is fine
  const rowsOk = [
    { lanes: [null, 'car', 'car'], gap: 20 },
    { lanes: ['car', 'car', null], gap: 18 },
  ];
  assert.equal(isPatternSurvivable(rowsOk, RUNNER.BASE_SPEED), true);
});

test('runner: generateRow only produces survivable sequences (500 rows, 3 seeds)', () => {
  for (const seed of [1, 42, 20260716]) {
    const r = rng(seed);
    /** @type {Array<{lanes: (string|null)[], gap: number}>} */
    const rows = [];
    for (let i = 0; i < 500; i += 1) {
      const elapsed = i * 1.4; // deep into max difficulty
      const row = generateRow(r, elapsed, rows.slice(-6));
      // every row must keep the recent window survivable at the CURRENT speed
      assert.equal(
        isPatternSurvivable([...rows.slice(-5), row], speedAt(elapsed)),
        true,
        `seed ${seed} row ${i} must be survivable`
      );
      assert.ok(row.lanes.some((k) => k === null || k !== 'car') || row.lanes.includes(null));
      rows.push(row);
    }
    // sanity: the generator actually uses obstacles
    assert.ok(rows.some((row) => row.lanes.some(Boolean)));
  }
});

test('runner: typical round lands the §C6 coin target (~240 raw → ~16c)', () => {
  // §C6: runner divisor 15, min 4, max 30 — typical 240 m + coins ≈ 16c
  const typical = runnerScore(215, 30);
  const coins = computeCoins(COIN_TABLE.runner, typical, false);
  assert.ok(coins >= 12 && coins <= 20, `typical ≈ 16c, got ${coins}`);
  assert.equal(computeCoins(COIN_TABLE.runner, 0, false), 4); // min clamp
  assert.equal(computeCoins(COIN_TABLE.runner, 99999, false), 30); // max clamp
});

// ===========================================================================
// Basket Bounce (§C6.1 #7)
// ===========================================================================

test('V3 basket: hoop stays put before 10 baskets, then slides exactly ±1 m', () => {
  assert.equal(hoopSlideX(2.5, BASKET.SLIDE_AFTER_BASKETS - 1), 0);
  const x = hoopSlideX(BASKET.SLIDE_PERIOD_SEC / 4, BASKET.SLIDE_AFTER_BASKETS);
  assert.ok(Math.abs(x - BASKET.SLIDE_AMPLITUDE) < 1e-9, 'peaks at the amplitude');
  assert.equal(BASKET.SLIDE_AFTER_BASKETS, 10);
  assert.equal(BASKET.SLIDE_AMPLITUDE, 1);
  assert.equal(isMovingHoop(9), false);
  assert.equal(isMovingHoop(10), true);
});

test('basket: throw distance ramps with baskets and caps (§C6.1 #7)', () => {
  assert.equal(hoopDistance(0), BASKET.DIST_START);
  assert.ok(Math.abs(hoopDistance(3) - (BASKET.DIST_START + 3 * BASKET.DIST_PER_BASKET)) < 1e-9);
  assert.equal(hoopDistance(999), BASKET.DIST_MAX);
});

test('basket: flickToVelocity — weak flicks ignored, speed clamped, up+forward', () => {
  assert.equal(flickToVelocity({ vx: 0, vy: -100 }), null, 'too weak');
  const v = flickToVelocity({ vx: 200, vy: -1600 });
  assert.ok(v.y > 0 && v.z < 0 && v.x > 0, 'up, forward, rightward');
  const fast = flickToVelocity({ vx: 0, vy: -99999 });
  assert.ok(Math.hypot(fast.x, fast.y, fast.z) <= BASKET.FLICK.MAX_SPEED + 1e-9, 'clamped');
});

test('basket: ringDistance measures to the rim circle, not its center', () => {
  const hoop = { x: 0, z: 0 };
  // ball dead-center in the hoop plane: distance = rim radius
  const c = ringDistance({ x: 0, y: BASKET.RIM_Y, z: 0 }, hoop);
  assert.ok(Math.abs(c.dist - BASKET.RIM_R) < 1e-9);
  // ball right on the ring: distance ~0
  const on = ringDistance({ x: BASKET.RIM_R, y: BASKET.RIM_Y, z: 0 }, hoop);
  assert.ok(on.dist < 1e-6);
});

test('basket: a solved arc scores a basket; a weak lob misses (arc solver)', () => {
  const hoop = { x: 0, z: BASKET.SPAWN.z - hoopDistance(0) };
  const solved = solveBasketVelocity(hoop, rng(7));
  assert.ok(solved, 'solver finds a make at the starting distance');
  const shot = simulateShot(solved, hoop);
  assert.equal(shot.result, 'basket');
  const weak = simulateShot({ x: 0, y: 2, z: -1 }, hoop);
  assert.equal(weak.result, 'miss');
});

test('basket: solver still makes baskets at max distance + slid hoop', () => {
  const hoop = { x: BASKET.SLIDE_AMPLITUDE, z: BASKET.SPAWN.z - BASKET.DIST_MAX };
  const solved = solveBasketVelocity(hoop, rng(99));
  assert.ok(solved, 'solver reaches the far, off-center hoop');
  assert.equal(simulateShot(solved, hoop).result, 'basket');
});

test('basket: backboard bounce marks bank and reflects the ball', () => {
  const hoop = { x: 0, z: 0 };
  const ball = {
    pos: { x: 0, y: BASKET.RIM_Y + 0.3, z: -BASKET.BOARD_GAP + BASKET.BALL_R + 0.02 },
    vel: { x: 0, y: 0, z: -2 },
    touchedRim: false,
    touchedBoard: false,
  };
  const ev = stepBall(ball, 1 / 60, hoop);
  assert.equal(ev.board, true);
  assert.equal(ball.touchedBoard, true);
  assert.ok(ball.vel.z > 0, 'bounced back toward the player');
});

test('basket: rim contact flags touchedRim and bounces outward', () => {
  const hoop = { x: 0, z: 0 };
  const ball = {
    pos: { x: BASKET.RIM_R + BASKET.BALL_R + 0.02, y: BASKET.RIM_Y + 0.01, z: 0 },
    vel: { x: -3, y: -0.5, z: 0 },
    touchedRim: false,
    touchedBoard: false,
  };
  for (let i = 0; i < 8 && !ball.touchedRim; i += 1) stepBall(ball, 1 / 120, hoop);
  assert.equal(ball.touchedRim, true);
  assert.ok(ball.vel.x > -3, 'x velocity reflected/damped by the rim');
});

test('V3 basket audit: swept frame catches a fast throw that tunnels through the rim', () => {
  const hoop = { x: 0, z: 0 };
  const makeBall = () => ({
    pos: { x: BASKET.RIM_R, y: BASKET.RIM_Y + 0.5, z: 0 },
    vel: { x: 0, y: -20, z: 0 },
    touchedRim: false,
    touchedBoard: false,
  });
  const naive = makeBall();
  assert.equal(stepBall(naive, 0.05, hoop).rim, false, 'single endpoint skips the torus');
  const swept = makeBall();
  const ev = stepBallSwept(swept, 0.05, hoop);
  assert.equal(ev.rim, true, 'swept integrator resolves the crossing');
  assert.equal(swept.touchedRim, true);
});

test('basket: scoring rules — +3 basket, +2 bank, swish streak +2 (§C6.1 #7)', () => {
  // plain basket
  assert.deepEqual(scoreShot({ basket: true, bank: false, swish: false }, 0), {
    points: 3,
    swishStreak: 0,
  });
  // bank shot: +2 extra
  assert.deepEqual(scoreShot({ basket: true, bank: true, swish: false }, 0), {
    points: 5,
    swishStreak: 0,
  });
  // first swish starts the streak (no bonus yet), second swish pays +2
  const s1 = scoreShot({ basket: true, bank: false, swish: true }, 0);
  assert.deepEqual(s1, { points: 3, swishStreak: 1 });
  const s2 = scoreShot({ basket: true, bank: false, swish: true }, s1.swishStreak);
  assert.deepEqual(s2, { points: 5, swishStreak: 2 });
  // a miss resets everything
  assert.deepEqual(scoreShot({ basket: false, bank: false, swish: false }, 5), {
    points: 0,
    swishStreak: 0,
  });
  assert.deepEqual(
    scoreShot({ basket: true, bank: false, swish: true }, 1, true),
    { points: 10, swishStreak: 2 },
    'moving-hoop swish doubles the full swish score'
  );
});

test('basket: typical round lands the §C6 coin target (~42 raw → 14c)', () => {
  // §C6: basketBounce divisor 3, min 4, max 26 — typical ~42 raw / 60 s
  assert.equal(computeCoins(COIN_TABLE.basketBounce, 42, false), 14);
  assert.equal(computeCoins(COIN_TABLE.basketBounce, 0, false), 4);
  assert.equal(computeCoins(COIN_TABLE.basketBounce, 9999, false), 26);
});

// ===========================================================================
// Pancake Tower (§C6.1 #8)
// ===========================================================================

test('pancake: topping schedule — every 5th layer (§C6.1 #8)', () => {
  const toppingLayers = [];
  for (let i = 1; i <= 20; i += 1) if (isToppingLayer(i)) toppingLayers.push(i);
  assert.deepEqual(toppingLayers, [5, 10, 15, 20]);
});

test('pancake: slide motion oscillates within the amplitude and speeds up', () => {
  for (const t of [0, 0.3, 1.1, 2.7]) {
    assert.ok(Math.abs(slideX(t, 1)) <= PANCAKE.SLIDE_AMPLITUDE + 1e-9);
  }
  assert.ok(slidePeriod(10) < slidePeriod(1), 'higher layers slide faster');
  assert.equal(slidePeriod(999), PANCAKE.SLIDE_PERIOD_MIN, 'period floor');
});

test('pancake: perfect drop — ≤ PERFECT_EPS snaps, +2, width restores +10% (§C6.1 #8)', () => {
  const stack = { center: 0, width: 1.0 };
  const r = resolveDrop(stack, PANCAKE.PERFECT_EPS * 0.99, false);
  assert.equal(r.perfect, true);
  assert.equal(r.landed, true);
  assert.equal(r.center, 0, 'snaps to the stack center');
  assert.equal(r.points, PANCAKE.PERFECT_POINTS);
  assert.ok(
    Math.abs(r.width - (1.0 + PANCAKE.BASE_WIDTH * PANCAKE.PERFECT_RESTORE_PCT)) < 1e-9,
    '+10% of base width restored'
  );
  // restore never exceeds the base width
  const full = resolveDrop({ center: 0, width: PANCAKE.BASE_WIDTH }, 0, false);
  assert.equal(full.width, PANCAKE.BASE_WIDTH);
  // just past the threshold is NOT perfect
  const near = resolveDrop(stack, PANCAKE.PERFECT_EPS * 1.01, false);
  assert.equal(near.perfect, false);
});

test('pancake: slice math — overhang cut, width shrinks by the offset (§C6.1 #8)', () => {
  const stack = { center: 0, width: 1.0 };
  const r = resolveDrop(stack, 0.3, false);
  assert.equal(r.landed, true);
  assert.equal(r.perfect, false);
  assert.ok(Math.abs(r.width - 0.7) < 1e-9, 'width = overlap = 1.0 − 0.3');
  assert.ok(Math.abs(r.center - 0.15) < 1e-9, 'kept piece centers on the overlap');
  assert.ok(r.cut, 'a piece was cut');
  assert.ok(Math.abs(r.cut.size - 0.3) < 1e-9, 'cut size = the overhang');
  assert.equal(r.cut.side, 1, 'cut off the right side');
  // symmetric on the left
  const l = resolveDrop(stack, -0.25, false);
  assert.equal(l.cut.side, -1);
  assert.ok(Math.abs(l.width - 0.75) < 1e-9);
});

test('pancake: zero overlap = total miss; toppings never shrink (§C6.1 #8)', () => {
  const stack = { center: 0, width: 0.8 };
  const miss = resolveDrop(stack, 0.81, false);
  assert.equal(miss.landed, false);
  assert.equal(miss.points, 0);
  // topping: lands clamped, +4, width unchanged, no cut
  const top = resolveDrop(stack, 0.4, true);
  assert.equal(top.landed, true);
  assert.equal(top.points, PANCAKE.TOPPING_POINTS);
  assert.equal(top.width, 0.8, 'no shrink on toppings');
  assert.equal(top.cut, null);
  // perfect topping: +2 perfect AND +4 topping, still no width change
  const perfTop = resolveDrop(stack, 0, true);
  assert.equal(perfTop.points, PANCAKE.PERFECT_POINTS + PANCAKE.TOPPING_POINTS);
  assert.equal(perfTop.width, 0.8);
});

test('pancake: end conditions — width < 20% of base or 40 layers (§C6.1 #8)', () => {
  const limit = PANCAKE.BASE_WIDTH * PANCAKE.END_WIDTH_FRAC;
  assert.equal(isTowerDone(limit - 1e-6, 10), true);
  assert.equal(isTowerDone(limit + 1e-6, 10), false);
  assert.equal(isTowerDone(PANCAKE.BASE_WIDTH, PANCAKE.MAX_LAYERS), true);
  assert.equal(isTowerDone(PANCAKE.BASE_WIDTH, PANCAKE.MAX_LAYERS - 1), false);
});

test('pancake: score = layers×2 + bonuses; typical lands §C6 target (~26 → 13c)', () => {
  assert.equal(towerScore(10, 8), 28); // 10 layers, 2 perfects + 1 topping
  assert.equal(towerScore(0, 0), 0);
  // §C6: pancakeTower divisor 2, min 4, max 26 — typical ~26 raw → 13c
  assert.equal(computeCoins(COIN_TABLE.pancakeTower, 26, false), 13);
  assert.equal(computeCoins(COIN_TABLE.pancakeTower, 0, false), 4);
  assert.equal(computeCoins(COIN_TABLE.pancakeTower, 9999, false), 26);
});

test('pancake: a simulated average round reaches the coin band (integration of pure parts)', () => {
  // play a scripted round: alternate ok drops (offset 0.12) with a perfect
  // every 3rd — roughly "decent human" play
  let stack = { center: 0, width: PANCAKE.BASE_WIDTH };
  let layers = 0;
  let bonus = 0;
  for (let i = 1; i <= 60; i += 1) {
    const topping = isToppingLayer(i);
    const offset = i % 3 === 0 ? 0 : (i % 2 === 0 ? 0.12 : -0.14);
    const r = resolveDrop(stack, stack.center + offset, topping);
    assert.equal(r.landed, true);
    layers += 1;
    bonus += r.points;
    stack = { center: r.center, width: r.width };
    if (isTowerDone(stack.width, layers)) break;
  }
  const score = towerScore(layers, bonus);
  const coins = computeCoins(COIN_TABLE.pancakeTower, score, false);
  assert.ok(coins >= 8 && coins <= 26, `decent round pays sensibly, got ${coins} (score ${score})`);
});

test('V3 pancake: wobble starts at height 8 and perfect drops damp it', () => {
  let still = initialWobbleState();
  for (let i = 0; i < 120; i += 1) still = stepWobble(still, 1 / 60, 7);
  assert.ok(Math.abs(still.angle) < 1e-9, 'no driven sway below height 8');
  let wobble = initialWobbleState();
  for (let i = 0; i < 120; i += 1) wobble = stepWobble(wobble, 1 / 60, 8);
  assert.ok(Math.abs(wobble.angle) > 0.001, 'height 8 is actively driven');
  const energy = Math.abs(wobble.angle) + Math.abs(wobble.velocity);
  const damped = dampWobble(wobble);
  assert.ok(Math.abs(damped.angle) + Math.abs(damped.velocity) < energy);
  assert.ok(Math.abs(wobble.angle) <= PANCAKE.WOBBLE_MAX_RAD);
});

test('V3 pancake: wobble world/local center transforms round-trip', () => {
  const local = 0.23;
  const height = 2.4;
  const angle = 0.12;
  const world = wobbleTopX(local, height, angle);
  assert.ok(Math.abs(wobbleLocalX(world, height, angle) - local) < 1e-9);
});

test('V3 pancake audit: extreme slice offsets stay bounded and fallen toppings despawn', () => {
  const stack = { center: 0.4, width: 0.8 };
  for (const sign of [-1, 1]) {
    const offset = sign * (stack.width - 1e-8);
    const r = resolveDrop(stack, stack.center + offset, false);
    assert.equal(r.landed, true);
    assert.ok(r.width > 0 && r.width < 1e-7);
    assert.ok(Number.isFinite(r.center));
    assert.ok(r.cut.size <= stack.width);
  }
  assert.equal(resolveDrop(stack, stack.center + stack.width, false).landed, false);
  assert.equal(isFallenExpired(PANCAKE.FALLEN_DESPAWN_SEC - 1e-6), false);
  assert.equal(isFallenExpired(PANCAKE.FALLEN_DESPAWN_SEC), true);
});
