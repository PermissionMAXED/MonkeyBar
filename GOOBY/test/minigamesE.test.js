// Minigames E (PLAN2 §C1.5): pure logic tests against the <id>.logic.js
// siblings (no three.js/DOM — §B rule).
//   · V2/G25 (wave 3): starHopper — lane-collision windows + spawn tables;
//     pipeFlow — generator always-solvable proof (exported BFS solver over
//     200 seeded boards) + rotation math + efficiency-bonus math.
//   · V2/G28 (wave 4): APPENDS deliveryRush + miniGolf blocks below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  HOPPER,
  speedAt,
  difficultyAt,
  rowGapAt,
  hopperScore,
  laneAfterTap,
  laneAfterSwipe,
  hitsMeteor,
  sweepHitsMeteor,
  maxLaneShift,
  isChainSurvivable,
  generateRow,
  rollPickup,
  shouldSpawnShield,
  pickShowerLanes,
  resolveHit,
  chooseLane,
  laneOutlook,
  planMove,
} from '../src/minigames/games/starHopper.logic.js';
import {
  PIPE,
  DIRS,
  opposite,
  connectionsOf,
  hasConnection,
  rotateTile,
  minTapsFor,
  waterReach,
  isSolved,
  generateBoard,
  solveBoard,
  tapEfficiencyBonus,
  pipeScore,
} from '../src/minigames/games/pipeFlow.logic.js';
import { COIN_TABLE } from '../src/data/constants.js';
import { computeCoins, MINIGAMES_BY_ID } from '../src/data/minigames.js';

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

test('G25 .logic.js modules import no three.js/DOM', () => {
  for (const id of ['starHopper', 'pipeFlow']) {
    const src = readFileSync(
      fileURLToPath(new URL(`../src/minigames/games/${id}.logic.js`, import.meta.url)),
      'utf8'
    );
    assert.ok(!/from\s+['"]three['"]/.test(src), `${id}.logic.js imports three`);
    assert.ok(!/document\.|window\./.test(src), `${id}.logic.js touches the DOM`);
  }
});

// ---------------------------------------------------------------------------
// #8 starHopper (§C1.2): speed ramp, score, lane controls
// ---------------------------------------------------------------------------

test('starHopper: speed ramps +5% (compounding) every 10 s, capped', () => {
  assert.equal(speedAt(0), HOPPER.BASE_SPEED);
  assert.equal(speedAt(9.99), HOPPER.BASE_SPEED);
  assert.equal(speedAt(10), HOPPER.BASE_SPEED * 1.05);
  assert.equal(speedAt(25), HOPPER.BASE_SPEED * 1.05 ** 2);
  assert.equal(speedAt(70), HOPPER.BASE_SPEED * 1.05 ** 7);
  assert.equal(speedAt(100000), HOPPER.MAX_SPEED);
});

test('starHopper: score = floor(distanceM/10) + pickups (§C1.2 #8)', () => {
  assert.equal(hopperScore(0, 0), 0);
  assert.equal(hopperScore(99, 0), 9);
  assert.equal(hopperScore(100, 0), 10);
  assert.equal(hopperScore(1050, 39), 144);
  assert.equal(hopperScore(-5, 0), 0); // never negative
});

test('starHopper: tap = 1 lane, swipe = 2 lanes, both clamped', () => {
  assert.equal(laneAfterTap(1, 'left'), 0);
  assert.equal(laneAfterTap(1, 'right'), 2);
  assert.equal(laneAfterTap(0, 'left'), 0); // clamp at the edge
  assert.equal(laneAfterTap(2, 'right'), 2);
  assert.equal(laneAfterSwipe(0, 'right'), 2);
  assert.equal(laneAfterSwipe(2, 'left'), 0);
  assert.equal(laneAfterSwipe(1, 'right'), 2); // clamp: 1 + 2 → 2
  assert.equal(laneAfterSwipe(1, 'left'), 0);
});

// ---------------------------------------------------------------------------
// #8 starHopper: lane-collision windows (§C1.5)
// ---------------------------------------------------------------------------

test('starHopper: collision window is 70% forgiving and lane-gated', () => {
  const reach = HOPPER.HITBOX_SCALE * (HOPPER.PLAYER_HALF_M + HOPPER.METEOR_HALF_M);
  const player = { lane: 1, m: 100 };
  // inside the scaled window: hit
  assert.equal(hitsMeteor(player, { lane: 1, m: 100 + reach - 0.01 }, HOPPER), true);
  assert.equal(hitsMeteor(player, { lane: 1, m: 100 - reach + 0.01 }, HOPPER), true);
  // just outside the scaled window (would hit at 100%): no hit
  assert.equal(hitsMeteor(player, { lane: 1, m: 100 + reach + 0.01 }, HOPPER), false);
  const fullReach = HOPPER.PLAYER_HALF_M + HOPPER.METEOR_HALF_M;
  assert.equal(hitsMeteor(player, { lane: 1, m: 100 + fullReach - 0.01 }, HOPPER), false);
  // different lane never hits, even overlapping
  assert.equal(hitsMeteor(player, { lane: 0, m: 100 }, HOPPER), false);
  assert.equal(hitsMeteor(player, { lane: 2, m: 100 }, HOPPER), false);
});

test('starHopper: swept collision cannot tunnel through the window', () => {
  const reach = HOPPER.HITBOX_SCALE * (HOPPER.PLAYER_HALF_M + HOPPER.METEOR_HALF_M);
  // meteor sits fully inside a huge frame advance: endpoint check would miss
  const player = { lane: 1, m: 0 };
  const meteor = { lane: 1, m: 3 * reach };
  const dm = 6 * reach; // player leaps far past the meteor in one frame
  assert.equal(hitsMeteor({ lane: 1, m: dm }, meteor, HOPPER), false, 'endpoint check misses');
  assert.equal(sweepHitsMeteor(player, meteor, dm, HOPPER), true, 'sweep catches it');
  // sweep in another lane still never hits
  assert.equal(sweepHitsMeteor({ lane: 0, m: 0 }, meteor, dm, HOPPER), false);
});

// ---------------------------------------------------------------------------
// #8 starHopper: spawn tables (§C1.5)
// ---------------------------------------------------------------------------

test('starHopper: generated row chains stay survivable (200 seeds)', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rng = rngFrom(seed);
    const rows = [];
    for (let i = 0; i < 40; i += 1) {
      const elapsed = i * 1.8; // spans the whole ramp
      const row = generateRow(rng, elapsed, rows.slice(-6));
      assert.equal(row.blocked.length, HOPPER.LANES);
      assert.ok(row.blocked.some((b) => !b), `seed ${seed} row ${i}: no free lane`);
      assert.ok(row.gap > 0, 'row gap positive');
      rows.push(row);
    }
    // conservative re-check of the whole chain at the max alive speed
    assert.ok(
      isChainSurvivable(rows, speedAt(75)),
      `seed ${seed}: 40-row chain not survivable`
    );
  }
});

test('starHopper: row gap + double-block chance ramp with difficulty', () => {
  assert.equal(difficultyAt(0), 0);
  assert.equal(difficultyAt(HOPPER.DIFFICULTY_FULL_SEC), 1);
  assert.equal(difficultyAt(9999), 1);
  assert.equal(rowGapAt(0), HOPPER.ROW_GAP_M.start);
  assert.equal(rowGapAt(1), HOPPER.ROW_GAP_M.end);
  assert.ok(rowGapAt(1) < rowGapAt(0), 'rows tighten');
  // measured double-block rate ramps between the start/end knobs
  const rateAt = (elapsed) => {
    const rng = rngFrom(7);
    let doubles = 0;
    const rows = [];
    for (let i = 0; i < 3000; i += 1) {
      const row = generateRow(rng, elapsed, rows.slice(-4));
      rows.push(row);
      if (row.blocked.filter(Boolean).length === 2) doubles += 1;
    }
    return doubles / 3000;
  };
  const early = rateAt(0);
  const late = rateAt(HOPPER.DIFFICULTY_FULL_SEC);
  assert.ok(early < late, `double-block ramps (${early} → ${late})`);
  assert.ok(Math.abs(early - HOPPER.DOUBLE_BLOCK_CHANCE.start) < 0.05, `early rate ≈ start (${early})`);
});

test('starHopper: pickup spawn table — stars common, golden carrots rare', () => {
  const rng = rngFrom(42);
  let stars = 0;
  let golds = 0;
  const N = 20000;
  for (let i = 0; i < N; i += 1) {
    const roll = rollPickup(rng);
    if (roll?.kind === 'star') {
      stars += 1;
      assert.equal(roll.points, HOPPER.STAR_POINTS);
    } else if (roll?.kind === 'gold') {
      golds += 1;
      assert.equal(roll.points, HOPPER.GOLD_POINTS);
    } else {
      assert.equal(roll, null);
    }
  }
  assert.ok(Math.abs(stars / N - HOPPER.STAR_CHANCE) < 0.02, `star rate ${stars / N}`);
  assert.ok(Math.abs(golds / N - HOPPER.GOLD_CHANCE) < 0.01, `gold rate ${golds / N}`);
  assert.ok(golds < stars / 4, 'golden carrots are the rare pick');
});

test('starHopper: shield spawns exactly once at score ≥ 60 (§C1.2 #8)', () => {
  assert.equal(shouldSpawnShield(0, false), false);
  assert.equal(shouldSpawnShield(59, false), false);
  assert.equal(shouldSpawnShield(60, false), true);
  assert.equal(shouldSpawnShield(200, false), true);
  assert.equal(shouldSpawnShield(200, true), false); // only ever one
});

test('starHopper: one hit ends the run unless shielded (§C1.2 #8)', () => {
  assert.deepEqual(resolveHit(false), { ended: true, shielded: false });
  assert.deepEqual(resolveHit(true), { ended: false, shielded: false }); // shield consumed
});

test('starHopper: shower telegraph leaves exactly one safe lane', () => {
  const rng = rngFrom(11);
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { safe, danger } = pickShowerLanes(rng);
    assert.ok(safe >= 0 && safe < HOPPER.LANES);
    assert.equal(danger.length, HOPPER.LANES - 1);
    assert.ok(!danger.includes(safe));
    seen.add(safe);
  }
  assert.equal(seen.size, HOPPER.LANES, 'every lane can be the safe one');
  // the telegraph window always allows reaching the safe lane (2-lane swipe)
  const crossTime = HOPPER.LANE_CHANGE_SEC + 0.22;
  assert.ok(HOPPER.SHOWER_TELEGRAPH_SEC > crossTime, 'telegraph ≥ worst-case swipe');
});

test('starHopper: lane-shift budget scales with the gap', () => {
  const speed = HOPPER.BASE_SPEED;
  assert.equal(maxLaneShift(0.1, speed), 0);
  assert.equal(maxLaneShift(1000, speed), HOPPER.LANES - 1); // capped at 2
  const gapForOne = speed * (HOPPER.LANE_CHANGE_SEC + 0.22) * 1.05;
  assert.equal(maxLaneShift(gapForOne, speed), 1);
});

test('starHopper: greedy bot picks the highest-value safe lane', () => {
  // straight value pick
  assert.equal(chooseLane(0, [
    { safe: true, value: 0 },
    { safe: true, value: 3 },
    { safe: true, value: 10 },
  ]), 2);
  // dangerous lanes excluded no matter the value
  assert.equal(chooseLane(0, [
    { safe: true, value: 0 },
    { safe: false, value: 99 },
    { safe: true, value: 3 },
  ]), 2);
  // tie prefers staying in the current lane
  assert.equal(chooseLane(1, [
    { safe: true, value: 3 },
    { safe: true, value: 3 },
    { safe: true, value: 3 },
  ]), 1);
  // nothing safe → hold the current lane
  assert.equal(chooseLane(2, [
    { safe: false, value: 0 },
    { safe: false, value: 0 },
    { safe: false, value: 0 },
  ]), 2);
});

test('starHopper: laneOutlook flags contact windows, incl. passed meteors', () => {
  const reach = HOPPER.HITBOX_SCALE * (HOPPER.PLAYER_HALF_M + HOPPER.METEOR_HALF_M);
  const speed = HOPPER.BASE_SPEED;
  const threats = [
    { lane: 0, m: 100 + speed * 0.5, approach: speed }, // entering in ~0.08 s
    { lane: 1, m: 100 + speed * 10, approach: speed }, // far beyond the horizon
    { lane: 2, m: 100 - reach - 0.01, approach: speed }, // fully passed below
  ];
  const { safe, transit, enter } = laneOutlook(threats, 100, 1.0, 0.3);
  assert.deepEqual(safe, [false, true, true]);
  assert.deepEqual(transit, [false, true, true]);
  assert.ok(enter[0] < 0.6, 'imminent threat time recorded');
  assert.ok(enter[1] > 5, 'distant threat still gets a contact time');
  assert.equal(enter[2], Infinity, 'passed meteors never re-enter');
  // a meteor still overlapping behind the nose (m slightly below traveled)
  // must count as a threat — the old m > traveled−4 filter missed these
  const overlap = laneOutlook([{ lane: 1, m: 100 - reach + 0.1, approach: speed }], 100, 1.0, 0.3);
  assert.equal(overlap.safe[1], false, 'overlapping meteor is a live threat');
});

test('starHopper: planMove blocks a 2-lane swipe through a hot middle lane', () => {
  const clear = { safe: true, value: 0, transitSafe: true, enter: Infinity };
  // middle transit-safe → take the 2-lane swipe to the value lane
  assert.equal(planMove(0, [clear, clear, { ...clear, value: 10 }]), 2);
  // middle hot + current safe → wait in place for a clean crossing
  assert.equal(planMove(0, [clear, { safe: false, value: 0, transitSafe: false, enter: 0.2 }, { ...clear, value: 10 }]), 0);
  // boxed in → duck to whichever of current/middle is threatened latest
  assert.equal(planMove(0, [
    { safe: false, value: 0, transitSafe: false, enter: 0.1 },
    { safe: false, value: 0, transitSafe: false, enter: 0.9 },
    { ...clear, value: 10 },
  ]), 1);
});

test('starHopper: coin row §C1.1 — 9/4/26, typical ≈ 140 raw → 15c', () => {
  assert.deepEqual(COIN_TABLE.starHopper, { divisor: 9, min: 4, max: 26 });
  assert.equal(MINIGAMES_BY_ID.starHopper.energyCost, 8);
  assert.equal(computeCoins(COIN_TABLE.starHopper, 140, false), 15);
  assert.equal(computeCoins(COIN_TABLE.starHopper, 0, false), 4); // min clamp
  assert.equal(computeCoins(COIN_TABLE.starHopper, 9999, false), 26); // max clamp
  assert.equal(computeCoins(COIN_TABLE.starHopper, 140, true), 30); // daily ×2 after clamp
});

// ---------------------------------------------------------------------------
// #9 pipeFlow (§C1.2): rotation math
// ---------------------------------------------------------------------------

test('pipeFlow: connection sets for every shape × rotation', () => {
  assert.deepEqual(connectionsOf({ shape: 'straight', rot: 0 }), [DIRS.N, DIRS.S]);
  assert.deepEqual(connectionsOf({ shape: 'straight', rot: 1 }), [DIRS.E, DIRS.W]);
  assert.deepEqual(connectionsOf({ shape: 'straight', rot: 2 }), [DIRS.N, DIRS.S]); // symmetric
  assert.deepEqual(connectionsOf({ shape: 'bend', rot: 0 }), [DIRS.N, DIRS.E]);
  assert.deepEqual(connectionsOf({ shape: 'bend', rot: 1 }), [DIRS.E, DIRS.S]);
  assert.deepEqual(connectionsOf({ shape: 'bend', rot: 2 }), [DIRS.S, DIRS.W]);
  assert.deepEqual(connectionsOf({ shape: 'bend', rot: 3 }), [DIRS.N, DIRS.W]);
  assert.deepEqual(connectionsOf({ shape: 'tee', rot: 0 }), [DIRS.N, DIRS.E, DIRS.S]);
  assert.deepEqual(connectionsOf({ shape: 'tee', rot: 1 }), [DIRS.E, DIRS.S, DIRS.W]);
  assert.equal(hasConnection({ shape: 'tee', rot: 0 }, DIRS.W), false);
  assert.equal(hasConnection({ shape: 'tee', rot: 1 }, DIRS.N), false);
});

test('pipeFlow: a tap rotates 90° clockwise, 4 taps come home', () => {
  let tile = { shape: 'bend', rot: 0 };
  const seen = [connectionsOf(tile).join()];
  for (let i = 0; i < 3; i += 1) {
    tile = rotateTile(tile);
    seen.push(connectionsOf(tile).join());
  }
  assert.equal(new Set(seen).size, 4, 'bend has 4 distinct orientations');
  assert.deepEqual(rotateTile(tile), { shape: 'bend', rot: 0 }, 'wraps to rot 0');
  assert.equal(opposite(DIRS.N), DIRS.S);
  assert.equal(opposite(DIRS.E), DIRS.W);
});

test('pipeFlow: minTapsFor honors shape symmetry and impossibility', () => {
  // straight: {N,S} needs 0 taps at rot 0 AND rot 2; 1 tap from rot 1
  assert.equal(minTapsFor({ shape: 'straight', rot: 0 }, [DIRS.N, DIRS.S]), 0);
  assert.equal(minTapsFor({ shape: 'straight', rot: 2 }, [DIRS.N, DIRS.S]), 0);
  assert.equal(minTapsFor({ shape: 'straight', rot: 1 }, [DIRS.N, DIRS.S]), 1);
  // straight can never make a corner
  assert.equal(minTapsFor({ shape: 'straight', rot: 0 }, [DIRS.N, DIRS.E]), Infinity);
  // bend: worst case 3 taps (clockwise-only rotation)
  assert.equal(minTapsFor({ shape: 'bend', rot: 1 }, [DIRS.N, DIRS.E]), 3);
  // tee includes any pair within ≤ 1 tap of half the rotations
  for (let rot = 0; rot < 4; rot += 1) {
    const k = minTapsFor({ shape: 'tee', rot }, [DIRS.N, DIRS.S]);
    assert.ok(k <= 2, `tee rot ${rot} reaches {N,S} in ≤ 2 taps (got ${k})`);
  }
});

test('pipeFlow: waterReach floods only through facing connections', () => {
  // 2×2 hand board: N-in at col 0 → bend to E → bend to S… on a 2-grid
  const board = {
    size: 2,
    srcCol: 0,
    goalCol: 1,
    seed: 0,
    optimalTaps: 0,
    tiles: [
      { shape: 'bend', rot: 0 }, // (0,0): N+E — takes tap water, feeds east
      { shape: 'bend', rot: 3 }, // (1,0): W+N… rot3 of bend = N,W — receives from W? needs S out
      { shape: 'straight', rot: 1 }, // (0,1): E,W — dead decoy
      { shape: 'straight', rot: 0 }, // (1,1): N,S — would carry water down to the sprinkler
    ],
  };
  // (1,0) currently N+W: connects back west but NOT down — unsolved
  assert.equal(isSolved(board), false);
  // one tap on (1,0): rot 0 → N,E? bend rot0 = N,E — still not S+W. Two taps → rot 1 = E,S. Three → rot 2 = S,W ✔
  board.tiles[1] = { shape: 'bend', rot: 2 }; // S+W: receives from west, feeds south
  assert.equal(isSolved(board), true);
  const { depths, solved } = waterReach(board);
  assert.equal(solved, true);
  assert.deepEqual([...depths.keys()].sort(), [0, 1, 3], 'decoy tile stays dry');
  assert.equal(depths.get(0), 0);
  assert.equal(depths.get(1), 1);
  assert.equal(depths.get(3), 2);
});

// ---------------------------------------------------------------------------
// #9 pipeFlow: generator always-solvable proof (§C1.5 — BFS solver, 200 seeds)
// ---------------------------------------------------------------------------

test('pipeFlow: 200 seeded boards are all provably solvable via the exported solver', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const board = generateBoard(seed);
    assert.equal(board.size, PIPE.GRID);
    assert.equal(board.tiles.length, PIPE.GRID * PIPE.GRID);
    assert.ok(board.srcCol >= 0 && board.srcCol < PIPE.GRID);
    assert.ok(board.goalCol >= 0 && board.goalCol < PIPE.GRID);
    for (const tile of board.tiles) {
      assert.ok(['straight', 'bend', 'tee'].includes(tile.shape), `seed ${seed}: shape`);
      assert.ok(tile.rot >= 0 && tile.rot < 4, `seed ${seed}: rot`);
    }

    const { taps, solvable } = solveBoard(board);
    assert.equal(solvable, true, `seed ${seed}: solver failed`);
    assert.equal(taps.length, board.optimalTaps, `seed ${seed}: optimalTaps mismatch`);

    // replay the taps on a copy — the §C1.5 proof that the deal connects
    const copy = { ...board, tiles: board.tiles.map((t2) => ({ ...t2 })) };
    assert.equal(isSolved(copy), false, `seed ${seed}: deal must start unsolved`);
    for (const idx of taps) copy.tiles[idx] = rotateTile(copy.tiles[idx]);
    assert.equal(isSolved(copy), true, `seed ${seed}: taps do not connect the board`);

    // sanity bounds: every tap targets a real cell; count stays humane
    for (const idx of taps) assert.ok(idx >= 0 && idx < PIPE.GRID * PIPE.GRID);
    assert.ok(taps.length <= 3 * PIPE.GRID * PIPE.GRID, `seed ${seed}: tap count sane`);
  }
});

test('pipeFlow: generator is deterministic per seed', () => {
  const a = generateBoard(1234);
  const b = generateBoard(1234);
  assert.deepEqual(a, b);
  const c = generateBoard(1235);
  assert.notDeepEqual(a.tiles, c.tiles);
});

test('pipeFlow: solver optimality basics', () => {
  // an already-solved board needs 0 taps
  const board = generateBoard(77);
  const { taps } = solveBoard(board);
  const solvedCopy = { ...board, tiles: board.tiles.map((t2) => ({ ...t2 })) };
  for (const idx of taps) solvedCopy.tiles[idx] = rotateTile(solvedCopy.tiles[idx]);
  assert.equal(isSolved(solvedCopy), true);
  assert.deepEqual(solveBoard(solvedCopy).taps, [], 'solved board → 0 taps');
  // k extra single rotations can never push the optimum above old + k
  const nudged = { ...solvedCopy, tiles: solvedCopy.tiles.map((t2) => ({ ...t2 })) };
  const target = board.srcCol; // rotate the source tile once
  nudged.tiles[target] = rotateTile(nudged.tiles[target]);
  const re = solveBoard(nudged);
  assert.ok(re.solvable);
  assert.ok(re.taps.length <= 3, `1 scramble tap → ≤ 3 taps back (got ${re.taps.length})`);
});

// ---------------------------------------------------------------------------
// #9 pipeFlow: efficiency bonus + score math (§C1.2 #9)
// ---------------------------------------------------------------------------

test('pipeFlow: tapEfficiencyBonus — 10 at ≤ optimal+3, 0 at optimal+15, linear', () => {
  const opt = 12;
  assert.equal(tapEfficiencyBonus(opt, opt), 10);
  assert.equal(tapEfficiencyBonus(opt - 2, opt), 10); // under optimum still max
  assert.equal(tapEfficiencyBonus(opt + 3, opt), 10);
  assert.equal(tapEfficiencyBonus(opt + 15, opt), 0);
  assert.equal(tapEfficiencyBonus(opt + 30, opt), 0);
  assert.equal(tapEfficiencyBonus(opt + 9, opt), 5); // exact midpoint
  assert.equal(tapEfficiencyBonus(opt + 4, opt), Math.round((10 * 11) / 12)); // 9
  assert.equal(tapEfficiencyBonus(opt + 14, opt), Math.round((10 * 1) / 12)); // 1
});

test('pipeFlow: score = 25·solved + bonus; typical 3 puzzles ≈ 75 (§C1.1)', () => {
  assert.equal(pipeScore(0, 0, 0), 0); // no freebie bonus before the 1st solve
  assert.equal(pipeScore(3, 30, 30), 85);
  assert.equal(pipeScore(3, 60, 30), 75); // blown bonus → the §C1.1 typical
  assert.equal(pipeScore(2, 20, 18), 60);
  assert.deepEqual(COIN_TABLE.pipeFlow, { divisor: 5, min: 4, max: 25 });
  assert.equal(MINIGAMES_BY_ID.pipeFlow.energyCost, 8);
  assert.equal(computeCoins(COIN_TABLE.pipeFlow, 75, false), 15); // §C1.1 typical row
  assert.equal(computeCoins(COIN_TABLE.pipeFlow, 0, false), 4);
  assert.equal(computeCoins(COIN_TABLE.pipeFlow, 9999, false), 25);
});
