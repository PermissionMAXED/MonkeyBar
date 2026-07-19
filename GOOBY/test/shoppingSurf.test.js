// Shopping Surf (V3/G37, PLAN3 §C8) — pure-logic tests for
// shoppingSurf.logic.js: §C8.5 speed ramp + score formula, §C8.1 chunk pool
// authoring rules, §C8.7 never-impossible survivability proof (BFS over the
// action lattice, 200 seeds × every ramp speed), §C8.4 powerup planning +
// timers (magnet/×2/shield/turbo), §C8.2 buffered controls, §C8.3 crash and
// near-miss rules, §C8.6 travel mode (700 m, forgiveness jog, reward cap
// 30 + 5 clean bonus with daily ×2 AFTER the clamp) incl. determinism, and
// the §C8.7 bot ≥ 600 m arcade average over 20 seeded logic runs.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SURF,
  SURF_DIFFICULTY,
  applyDifficulty,
  applyModifier,
  densityMultAt,
  validatorProbeSpeeds,
  pickNextSurvivableChunk,
  coinRowCount,
  simulateSurfAutoplay,
  CHUNKS,
  isTravelMode,
  speedRampAt,
  surfScore,
  travelReward,
  pickNextChunk,
  expandChunk,
  hazardRows,
  isSequenceSurvivable,
  planPowerupKind,
  planPowerupGap,
  createRun,
  playerX,
  playerY,
  currentSpeed,
  stepRun,
  runScore,
  runMeta,
  botInput,
  simulateRun,
} from '../src/minigames/games/shoppingSurf.logic.js';
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

/**
 * A run with world streaming muted (no chunks/powerups spawn) so controlled
 * obstacle/coin/powerup scenarios can be injected deterministically.
 */
function cleanRun(mode = 'arcade', seed = 1) {
  const run = createRun({ rng: rng(seed), mode });
  run.chunksEndM = 1e9; //     pretend the chunk queue is filled forever
  run.nextPowerupAtM = 1e9; // and the next powerup is beyond any horizon
  return run;
}

/** Inject a hazard at z (m ahead = negative z) into a run. */
function injectObstacle(run, kind, { lane = 1, z = -10, x } = {}) {
  const def = SURF.OBSTACLES[kind];
  const ob = {
    id: run.nextId++,
    kind,
    def,
    lane,
    lanes: kind === 'awning' ? [lane] : undefined,
    z,
    x: x ?? (kind === 'awning' ? SURF.LANE_X[lane] : SURF.LANE_X[lane]),
    halfW: kind === 'awning' ? SURF.LANE_W * 0.92 / 2 : kind === 'gap' ? 99 : def.halfW,
    telegraphed: false,
    hit: false,
    minClear: Infinity,
    passed: false,
  };
  run.obstacles.push(ob);
  return ob;
}

/** Step a run n frames at dt collecting all events. */
function stepFrames(run, n, dt = 1 / 60, input = null) {
  const events = [];
  for (let i = 0; i < n; i += 1) {
    events.push(...stepRun(run, dt, typeof input === 'function' ? input(run, i) : i === 0 ? input : null));
  }
  return events;
}

// ===========================================================================
// §C8.5 speed ramp + scoring
// ===========================================================================

test('§C8.5 speed ramp: base 8, +0.25 every 5 s, cap 16', () => {
  assert.equal(speedRampAt(0), 8);
  assert.equal(speedRampAt(4.99), 8);
  assert.equal(speedRampAt(5), 8.25);
  assert.equal(speedRampAt(59.9), 8 + 0.25 * 11);
  assert.equal(speedRampAt(160), 16); // (16−8)/0.25×5 = 160 s to cap
  assert.equal(speedRampAt(9999), 16);
});

test('§C8.5 score = floor(distanceM) + coins×2 + nearMiss×2', () => {
  assert.equal(surfScore(0, 0, 0), 0);
  assert.equal(surfScore(123.9, 10, 3), 123 + 20 + 6);
  assert.equal(surfScore(700, 34, 12), 700 + 68 + 24);
});

test('§C8.5 coin row 40/5/34: typical 90 s scores land in-row', () => {
  const row = COIN_TABLE.shoppingSurf;
  assert.deepEqual({ divisor: row.divisor, min: row.min, max: row.max }, { divisor: 40, min: 5, max: 34 });
  // typical arcade run ≈ 800–1100 → 20–27 coins, premium like deliveryRush
  assert.equal(computeCoins(row, 800, false), 20);
  assert.equal(computeCoins(row, 1100, false), 27);
  assert.equal(computeCoins(row, 0, false), 5); //     floor
  assert.equal(computeCoins(row, 99999, false), 34); // cap
});

// ===========================================================================
// §C8.1 chunk pool authoring rules
// ===========================================================================

test('§C8.1 chunk pool: 12 handcrafted defs', () => {
  assert.equal(CHUNKS.length, 12);
  for (const def of CHUNKS) {
    assert.ok(def.name && Array.isArray(def.hazards) && Array.isArray(def.coins), def.name);
  }
});

test('§C8.1 chunk hazards sit within atM ∈ [8, 24] (seam reaction room)', () => {
  for (const def of CHUNKS) {
    for (const h of def.hazards) {
      assert.ok(h.atM >= 8 && h.atM <= 24, `${def.name} hazard at ${h.atM}`);
    }
  }
});

test('§C8.3 crate rows never block all 3 lanes (per-def check)', () => {
  for (const def of CHUNKS) {
    const byAt = new Map();
    for (const h of def.hazards) {
      if (h.kind !== 'crate') continue;
      byAt.set(h.atM, (byAt.get(h.atM) ?? new Set()).add(h.lane));
    }
    for (const [atM, lanes] of byAt) {
      assert.ok(lanes.size < SURF.LANES, `${def.name}: crates block all lanes at ${atM}`);
    }
  }
});

test('§C8.3 gap chunks only spawn ≥ 800 m (minM gate)', () => {
  for (const def of CHUNKS) {
    if (def.hazards.some((h) => h.kind === 'gap')) {
      assert.ok(def.minM >= SURF.GAP_MIN_DISTANCE_M, `${def.name} minM ${def.minM}`);
    }
  }
});

test('§C8.1 pickNextChunk: warmup opens, minM gating, no back-to-back repeats', () => {
  assert.equal(pickNextChunk(rng(7), 0, -1), 0); // startM 0 → warmup
  for (let seed = 0; seed < 40; seed += 1) {
    const r = rng(seed);
    let last = 0;
    let startM = SURF.CHUNK_LEN_M;
    for (let i = 0; i < 60; i += 1) {
      const idx = pickNextChunk(r, startM, last);
      assert.notEqual(idx, last, `seed ${seed}: repeat at ${startM}`);
      assert.ok(CHUNKS[idx].minM <= startM, `seed ${seed}: ${CHUNKS[idx].name} too early at ${startM}`);
      if (CHUNKS[idx].hazards.some((h) => h.kind === 'gap')) {
        assert.ok(startM >= SURF.GAP_MIN_DISTANCE_M, `seed ${seed}: gap before 800 m`);
      }
      last = idx;
      startM += SURF.CHUNK_LEN_M;
    }
  }
});

test('§C8.1 expandChunk offsets hazards/coins to absolute meters', () => {
  const { hazards, coins } = expandChunk(CHUNKS[0], 120);
  assert.equal(hazards[0].atM, 120 + CHUNKS[0].hazards[0].atM);
  assert.equal(coins[0].atM, 120 + CHUNKS[0].coins[0].atM);
});

// ===========================================================================
// §C8.7 never-impossible survivability proof — 200 seeds × every ramp speed
// ===========================================================================

test('§C8.7 validator: an all-lanes crate wall is unsurvivable, a 2-lane wall is fine', () => {
  const wall3 = [0, 1, 2].map((lane) => ({ atM: 12, kind: 'crate', lane }));
  const wall2 = [0, 1].map((lane) => ({ atM: 12, kind: 'crate', lane }));
  assert.equal(isSequenceSurvivable(wall3, 8), false);
  assert.equal(isSequenceSurvivable(wall2, 8), true);
});

test('§C8.7 validator: conflicting jump+slide on one lane merges to blocked', () => {
  // cart at 100 m spawns at the 70 m horizon, rolls +2 m/s → meets the
  // player at 100 − 70·2/10 = 86 m; an awning at 86 m arrives simultaneously
  const rows = hazardRows(
    [
      { atM: 100, kind: 'cart', lane: 2 },
      { atM: 86, kind: 'awning', lanes: [2] },
    ],
    8
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lanes[2], 'none');
});

test('§C8.7 never-impossible: 200 seeded chunk sequences × every ramp speed', () => {
  const speeds = [];
  for (let v = SURF.BASE_SPEED; v <= SURF.MAX_SPEED + 1e-9; v += SURF.SPEED_STEP) speeds.push(v);
  assert.equal(speeds.length, 33); // 8 … 16 in 0.25 steps
  for (let seed = 0; seed < 200; seed += 1) {
    const r = rng(seed * 2654435761 + 1);
    const hazards = [];
    let last = -1;
    let startM = 0;
    for (let i = 0; i < 50; i += 1) { // 1.5 km of street per seed
      const idx = pickNextChunk(r, startM, last);
      hazards.push(...expandChunk(CHUNKS[idx], startM).hazards);
      last = idx;
      startM += SURF.CHUNK_LEN_M;
    }
    for (const v of speeds) {
      assert.ok(
        isSequenceSurvivable(hazards, v),
        `seed ${seed} unsurvivable at ${v} m/s`
      );
    }
  }
});

// ===========================================================================
// §C8.4 powerup planning + timers
// ===========================================================================

test('§C8.4 planPowerupKind: never the same kind twice consecutively', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const r = rng(seed);
    let last = null;
    for (let i = 0; i < 60; i += 1) {
      const kind = planPowerupKind(r, last, Infinity);
      assert.notEqual(kind, last);
      assert.ok(['magnet', 'x2', 'shield', 'turbo'].includes(kind));
      last = kind;
    }
  }
});

test('§C8.4 planPowerupKind: turbo respects the ≤ 1 per 400 m rarity gate', () => {
  const r = rng(3);
  for (let i = 0; i < 200; i += 1) {
    assert.notEqual(planPowerupKind(r, null, 120), 'turbo'); // 120 m since last
  }
});

test('§C8.4 planPowerupGap: seeded gaps stay within 180–260 m', () => {
  const r = rng(11);
  for (let i = 0; i < 300; i += 1) {
    const gap = planPowerupGap(r);
    assert.ok(gap >= SURF.POWERUP_GAP_MIN_M && gap <= SURF.POWERUP_GAP_MAX_M, `gap ${gap}`);
  }
});

test('§C8.4 magnet: 6 s timer, attracts + collects a coin 3 m away', () => {
  const run = cleanRun();
  run.pu.magnetT = SURF.POWERUPS.magnet.sec;
  run.coinItems.push({ id: 1, lane: 0, x: SURF.LANE_X[0], y: SURF.COIN_Y, z: -2.2, attracted: false });
  const events = stepFrames(run, 90); // 1.5 s
  assert.ok(events.some((e) => e.type === 'coin'), 'magnet-pulled coin collected');
  assert.equal(run.coins, 1);
  assert.ok(run.pu.magnetT > 0 && run.pu.magnetT < 6);
  stepFrames(run, 60 * 6);
  assert.equal(run.pu.magnetT, 0); // expired
});

test('§C8.4 ×2: doubles coin pickups while active (8 s)', () => {
  const run = cleanRun();
  run.pu.x2T = SURF.POWERUPS.x2.sec;
  run.coinItems.push({ id: 1, lane: 1, x: 0, y: SURF.COIN_Y, z: -1.0, attracted: false });
  const events = stepFrames(run, 30);
  const coin = events.find((e) => e.type === 'coin');
  assert.equal(coin?.value, 2);
  assert.equal(run.coins, 2);
});

test('§C8.4 shield absorbs exactly 1 crash (no crash counted, then vulnerable)', () => {
  const run = cleanRun();
  run.pu.shield = true;
  injectObstacle(run, 'crate', { lane: 1, z: -2 });
  const events = stepFrames(run, 40);
  assert.ok(events.some((e) => e.type === 'shieldPop'));
  assert.equal(run.crashes, 0);
  assert.equal(run.pu.shield, false);
  // next crate after invulnerability = real crash
  stepFrames(run, Math.ceil(SURF.INVULN_SEC * 60) + 5);
  injectObstacle(run, 'crate', { lane: 1, z: -2 });
  const events2 = stepFrames(run, 40);
  assert.ok(events2.some((e) => e.type === 'crash'));
  assert.equal(run.crashes, 1);
});

test('§C8.4 turbo: 2.5 s, +40 % speed, invulnerable through hazards', () => {
  const run = cleanRun();
  run.pu.turboT = SURF.POWERUPS.turbo.sec;
  assert.ok(Math.abs(currentSpeed(run) - 8 * 1.4) < 1e-9);
  injectObstacle(run, 'crate', { lane: 1, z: -2 });
  const events = stepFrames(run, 30);
  assert.ok(!events.some((e) => e.type === 'crash'), 'turbo runs through the crate');
  assert.equal(run.crashes, 0);
  stepFrames(run, 60 * 3);
  assert.equal(run.pu.turboT, 0);
});

test('§C8.4 powerup pickup event + despawn if untouched', () => {
  const run = cleanRun();
  run.powerupItems.push({ id: 9, kind: 'magnet', lane: 1, x: 0, z: -1.2 });
  const events = stepFrames(run, 20);
  assert.ok(events.some((e) => e.type === 'powerup' && e.kind === 'magnet'));
  // picked up a few frames in, so the 6 s timer has already ticked slightly
  assert.ok(run.pu.magnetT > SURF.POWERUPS.magnet.sec - 0.5);
  // untouched one (other lane) despawns behind the player
  const run2 = cleanRun();
  run2.powerupItems.push({ id: 9, kind: 'x2', lane: 0, x: SURF.LANE_X[0], z: -1.2 });
  stepFrames(run2, 120);
  assert.equal(run2.powerupItems.length, 0);
  assert.equal(run2.pu.x2T, 0);
});

// ===========================================================================
// §C8.2 controls: tween, jump, slide, fast-drop, buffered action
// ===========================================================================

test('§C8.2 lane change: 120 ms smoothstep tween between centers', () => {
  const run = cleanRun();
  stepRun(run, 1 / 60, { right: true });
  assert.equal(run.lane, 2);
  assert.ok(playerX(run) < SURF.LANE_X[2]);
  stepFrames(run, Math.ceil(0.12 * 60) + 1);
  assert.ok(Math.abs(playerX(run) - SURF.LANE_X[2]) < 1e-6);
});

test('§C8.2 jump 0.55 s / slide 0.5 s timers, slide during jump = fast-drop', () => {
  const run = cleanRun();
  stepRun(run, 1 / 60, { jump: true });
  assert.ok(run.jumpT >= 0);
  let maxY = 0;
  for (let i = 0; i < 40; i += 1) {
    stepRun(run, 1 / 60);
    maxY = Math.max(maxY, playerY(run));
  }
  assert.ok(run.jumpT < 0, 'landed after 0.55 s');
  assert.ok(maxY > SURF.JUMP_HEIGHT * 0.9, `apex ${maxY}`);
  stepRun(run, 1 / 60, { slide: true });
  assert.ok(run.slideT >= 0);
  stepFrames(run, Math.ceil(SURF.SLIDE_SEC * 60) + 2);
  assert.ok(run.slideT < 0, 'slide over after 0.5 s');
  // fast-drop: swipe down mid-air
  stepRun(run, 1 / 60, { jump: true });
  stepFrames(run, 10);
  const events = stepRun(run, 1 / 60, { slide: true });
  assert.ok(events.some((e) => e.type === 'fastDrop'));
  stepFrames(run, 30);
  assert.ok(run.jumpT < 0, 'fast-drop landed early');
});

test('§C8.2 buffered action: 1 queued action fires within the 250 ms window', () => {
  // jump queued near the END of a slide (fits the 250 ms buffer window)
  const run = cleanRun();
  stepRun(run, 1 / 60, { slide: true });
  stepFrames(run, Math.ceil((SURF.SLIDE_SEC - 0.2) * 60));
  stepRun(run, 1 / 60, { jump: true }); // blocked while sliding → buffered
  assert.ok(run.buffered?.type === 'jump' || run.jumpT >= 0);
  stepFrames(run, 20);
  assert.ok(run.jumpT >= 0, 'buffered jump fired when the slide ended');
  // a buffer queued too early expires after 250 ms
  const run2 = cleanRun();
  stepRun(run2, 1 / 60, { slide: true });
  stepRun(run2, 1 / 60, { jump: true }); // 0.48 s of slide left > 250 ms
  assert.equal(run2.buffered?.type, 'jump');
  stepFrames(run2, Math.ceil(0.3 * 60));
  assert.equal(run2.buffered, null, 'stale buffer expired');
  stepFrames(run2, 20);
  assert.ok(run2.jumpT < 0, 'expired buffer never fired');
});

// ===========================================================================
// §C8.3 obstacles: crash rules, soft puddles, near-miss
// ===========================================================================

test('§C8.3 crash: stumble 0.8 s + invuln 1.5 s + speed ramp reset', () => {
  const run = cleanRun();
  run.rampSec = 60; // ramped to 11 m/s
  injectObstacle(run, 'crate', { lane: 1, z: -2 });
  const events = stepFrames(run, 30);
  const crash = events.find((e) => e.type === 'crash');
  assert.ok(crash);
  assert.equal(run.crashes, 1);
  assert.ok(run.stumbleT > 0 && run.stumbleT <= SURF.STUMBLE_SEC);
  assert.ok(run.invulnT > 0 && run.invulnT <= SURF.INVULN_SEC);
  assert.ok(run.rampSec < 1, 'ramp reset to base');
});

test('§C8.3 arcade: 3rd crash ends the run (wipeout event)', () => {
  const run = cleanRun('arcade');
  for (let i = 0; i < 3; i += 1) {
    injectObstacle(run, 'crate', { lane: 1, z: -2 });
    stepFrames(run, 30);
    stepFrames(run, Math.ceil(SURF.INVULN_SEC * 60) + 5); // wait out invuln
  }
  assert.equal(run.crashes, 3);
  assert.equal(run.ended, true);
});

test('§C8.3 jump clears a cart, slide clears an awning', () => {
  const runJ = cleanRun();
  injectObstacle(runJ, 'cart', { lane: 1, z: -3.4 });
  // cart approaches at 10 m/s → arrives in .34s; jump now clears it at apex
  stepRun(runJ, 1 / 60, { jump: true });
  const evJ = stepFrames(runJ, 60);
  assert.ok(!evJ.some((e) => e.type === 'crash'), 'jumped the cart');
  const runS = cleanRun();
  injectObstacle(runS, 'awning', { lane: 1, z: -2.0 });
  stepRun(runS, 1 / 60, { slide: true });
  const evS = stepFrames(runS, 40);
  assert.ok(!evS.some((e) => e.type === 'crash'), 'slid under the awning');
  // control: NOT sliding under the same awning = crash
  const runC = cleanRun();
  injectObstacle(runC, 'awning', { lane: 1, z: -2.0 });
  const evC = stepFrames(runC, 40);
  assert.ok(evC.some((e) => e.type === 'crash'));
});

test('§C8.3 puddle is soft: −10 % speed 2 s, no crash, works during invuln', () => {
  const run = cleanRun();
  run.invulnT = 1.0; // even invulnerable, puddles still splash
  injectObstacle(run, 'puddle', { lane: 1, z: -1.5 });
  const events = stepFrames(run, 30);
  assert.ok(events.some((e) => e.type === 'puddle'));
  assert.ok(!events.some((e) => e.type === 'crash'));
  assert.equal(run.crashes, 0);
  assert.ok(run.slowT > 0);
  assert.ok(Math.abs(currentSpeed(run) - 8 * 0.9) < 1e-9, '−10 % while slowed');
  stepFrames(run, Math.ceil(2.2 * 60));
  assert.equal(run.slowT, 0);
});

test('§C8.3 near-miss: pass within 0.35 m without hit = +2 + streak', () => {
  const run = cleanRun();
  // crate offset so lateral clearance = 1.30 − (0.6+0.42) = 0.28 m ≤ 0.35
  injectObstacle(run, 'crate', { lane: 2, z: -5, x: 1.3 });
  const events = stepFrames(run, 90);
  const nm = events.find((e) => e.type === 'nearMiss');
  assert.ok(nm, 'near-miss fired');
  assert.equal(nm.streak, 1);
  assert.equal(run.nearMisses, 1);
  assert.equal(run.crashes, 0);
  assert.equal(runScore(run), Math.floor(run.distanceM) + run.coins * 2 + 2);
  // …but a comfortable pass (0.58 m) is NOT a near-miss
  const run2 = cleanRun();
  injectObstacle(run2, 'crate', { lane: 2, z: -5 }); // lane-centered
  const ev2 = stepFrames(run2, 90);
  assert.ok(!ev2.some((e) => e.type === 'nearMiss'));
});

test('§C8.3 NPC shopper crosses L→R at 1.2 m/s', () => {
  const run = cleanRun();
  const ob = injectObstacle(run, 'npc', { lane: 1, z: -30, x: -2.6 });
  const x0 = ob.x;
  stepFrames(run, 60); // 1 s
  assert.ok(Math.abs(ob.x - x0 - SURF.OBSTACLES.npc.crossSpeed) < 0.01);
});

// ===========================================================================
// §C8.6 travel mode
// ===========================================================================

test("§C8.6 isTravelMode accepts 'travel' + G38's 'surfTravel' alias", () => {
  assert.equal(isTravelMode('travel'), true);
  assert.equal(isTravelMode('surfTravel'), true);
  assert.equal(isTravelMode('arcade'), false);
  assert.equal(isTravelMode(undefined), false);
});

test('§C8.6 travel reward: cap 30 + 5 clean bonus = max 35', () => {
  assert.deepEqual(travelReward(12, 0), { coins: 17, clean: true });
  assert.deepEqual(travelReward(12, 2), { coins: 12, clean: false });
  assert.deepEqual(travelReward(40, 0), { coins: 35, clean: true });
  assert.deepEqual(travelReward(40, 3), { coins: 30, clean: false });
  assert.deepEqual(travelReward(0, 0), { coins: 5, clean: true });
});

test('§C8.6 daily ×2 applies AFTER the clamp (framework coinsOverride path)', () => {
  const { coins } = travelReward(40, 0); // clamps to 35
  assert.equal(computeCoins(COIN_TABLE.shoppingSurf, 0, true, coins), 70); // ×2 after
  assert.equal(computeCoins(COIN_TABLE.shoppingSurf, 0, false, coins), 35);
});

test('§C8.6 travel: no fail-out — 3rd crash → 7 m/s jog, no more obstacles', () => {
  const run = cleanRun('travel');
  let events = [];
  for (let i = 0; i < 3; i += 1) {
    injectObstacle(run, 'crate', { lane: 1, z: -2 });
    events = events.concat(stepFrames(run, 30), stepFrames(run, Math.ceil(SURF.INVULN_SEC * 60) + 5));
  }
  assert.equal(run.crashes, 3);
  assert.equal(run.ended, false, 'travel never hard-fails');
  assert.equal(run.jog, true);
  assert.ok(events.some((e) => e.type === 'jogStart'));
  assert.equal(run.obstacles.length, 0, 'jog cleared all obstacles');
  assert.equal(currentSpeed(run), SURF.TRAVEL.JOG_SPEED);
});

test('§C8.6 regression (P1): run-ending 3rd hit with more obstacles pending does not throw', () => {
  // The 3rd travel crash clears run.obstacles from INSIDE the obstacle loop
  // (jog forgiveness). With obstacles queued at indexes below the hit, the
  // loop used to keep iterating and read run.obstacles[i] === undefined
  // ("Cannot read properties of undefined (reading 'def')").
  const run = cleanRun('travel');
  run.crashes = 2; // two prior stumbles, invulnerability elapsed
  injectObstacle(run, 'crate', { lane: 0, z: -20 }); // index 0 — read after the clear
  injectObstacle(run, 'crate', { lane: 1, z: -0.5 }); // index 1 — collides this frame
  injectObstacle(run, 'crate', { lane: 2, z: -15 }); // index 2 — processed before the hit
  let events = [];
  assert.doesNotThrow(() => { events = stepRun(run, 1 / 60, null); });
  assert.equal(run.crashes, 3);
  assert.equal(run.jog, true);
  assert.equal(run.ended, false, 'travel never hard-fails');
  assert.equal(run.obstacles.length, 0, 'jog cleared every obstacle');
  assert.ok(events.some((e) => e.type === 'crash'));
  assert.ok(events.some((e) => e.type === 'jogStart'));
  // the frames after the state-clearing hit keep updating cleanly
  assert.doesNotThrow(() => stepFrames(run, 120));
  assert.equal(currentSpeed(run), SURF.TRAVEL.JOG_SPEED);
});

test('§C8.3 regression: arcade wipeout mid-loop with obstacles pending → clean end state', () => {
  const run = cleanRun('arcade');
  run.crashes = 2;
  injectObstacle(run, 'crate', { lane: 0, z: -20 });
  injectObstacle(run, 'crate', { lane: 1, z: -0.5 }); // run-ending hit
  injectObstacle(run, 'crate', { lane: 2, z: -15 });
  let events = [];
  assert.doesNotThrow(() => { events = stepRun(run, 1 / 60, null); });
  assert.equal(run.ended, true);
  assert.equal(run.crashes, 3);
  assert.ok(events.some((e) => e.type === 'wipeout'));
  assert.deepEqual(stepRun(run, 1 / 60, null), [], 'ended run steps are no-ops');
});

test('§C8.6 travel: finish event fires at 700 m with coinsCollected + crashes', () => {
  const run = createRun({ rng: rng(42), mode: 'travel' });
  let finish = null;
  for (let i = 0; i < 40000 && !finish; i += 1) {
    finish = stepRun(run, 1 / 30, botInput(run)).find((e) => e.type === 'finish') ?? null;
  }
  assert.ok(finish, 'reached the arch');
  assert.ok(run.distanceM >= SURF.TRAVEL.DISTANCE_M);
  assert.equal(finish.coinsCollected, run.coins);
  assert.equal(finish.crashes, run.crashes);
  assert.equal(run.finished, true);
});

test('§C8.6 travel determinism: same seed → bit-equal outcome', () => {
  const a = simulateRun({ rng: rng(1234), mode: 'travel', maxSec: 180 });
  const b = simulateRun({ rng: rng(1234), mode: 'travel', maxSec: 180 });
  assert.equal(a.run.distanceM, b.run.distanceM);
  assert.equal(a.run.coins, b.run.coins);
  assert.equal(a.run.crashes, b.run.crashes);
  assert.equal(a.run.nearMisses, b.run.nearMisses);
  assert.equal(a.events, b.events);
  assert.equal(a.score, b.score);
  const c = simulateRun({ rng: rng(99), mode: 'travel', maxSec: 180 });
  assert.ok(c.run.finished, 'another seed also finishes 700 m');
});

test('§C8.6 travel runs finish in the spec window (~70–85 s at bot pace)', () => {
  for (const seed of [5, 21, 77]) {
    const { run } = simulateRun({ rng: rng(seed), mode: 'travel', maxSec: 200 });
    assert.ok(run.finished, `seed ${seed} finished`);
    assert.ok(run.elapsed >= 45 && run.elapsed <= 110, `seed ${seed}: ${run.elapsed.toFixed(1)} s`);
  }
});

// ===========================================================================
// §B3 meta + §C5.1 #27 counters payload
// ===========================================================================

test('§B3 runMeta carries {distanceM, coins, coinsCollected, nearMisses, powerups, crashes, surfRun}', () => {
  const { run } = simulateRun({ rng: rng(7), mode: 'arcade', maxSec: 60 });
  const meta = runMeta(run);
  assert.equal(meta.distanceM, Math.round(run.distanceM));
  assert.equal(meta.coins, run.coins);
  assert.equal(meta.coinsCollected, run.coins); // §C8.6 travel naming
  assert.equal(meta.nearMisses, run.nearMisses);
  assert.equal(meta.powerups, run.powerupsCollected);
  assert.equal(meta.crashes, run.crashes);
  assert.equal(meta.surfRun, true);
});

// ===========================================================================
// §C8.7 bot: ≥ 600 m arcade average over 20 seeded logic runs
// ===========================================================================

test('§C8.7 bot averages ≥ 600 m over 20 seeded arcade logic runs', () => {
  let total = 0;
  const distances = [];
  for (let seed = 1; seed <= 20; seed += 1) {
    const { run } = simulateRun({ rng: rng(seed * 7919), mode: 'arcade', maxSec: 240 });
    distances.push(Math.round(run.distanceM));
    total += run.distanceM;
  }
  const avg = total / 20;
  assert.ok(avg >= 600, `bot average ${avg.toFixed(0)} m (runs: ${distances.join(', ')})`);
});

test('§C8.7 bot arcade scores land in the §C8.5 typical band trajectory', () => {
  // typical 90 s ≈ 800–1100; bot runs may end earlier/later — sanity-check
  // that per-second scoring stays in a sane band (no runaway/starved scoring)
  for (const seed of [3, 14, 25]) {
    const { run, score } = simulateRun({ rng: rng(seed), mode: 'arcade', maxSec: 240 });
    const perSec = score / Math.max(1, run.elapsed);
    assert.ok(perSec > 6 && perSec < 25, `seed ${seed}: ${perSec.toFixed(1)} score/s`);
  }
});

// ===========================================================================
// V4/G74 §G5 difficulty + endless + modifiers + seeded-bot certification
// ===========================================================================

test('V4/G74 surf: Mittel identity, Schwer cap 18, Endlos ramp-to-20 + density cap 1.5', () => {
  assert.strictEqual(applyDifficulty(SURF, 'normal'), SURF, 'Mittel is identity');
  assert.strictEqual(applyDifficulty(SURF, 'nonsense'), SURF, 'unknown ids fall back');
  // §G5.3 runner/steer row pins (the single source the derivation reads)
  assert.deepEqual(
    [SURF_DIFFICULTY.easy.speed, SURF_DIFFICULTY.easy.density, SURF_DIFFICULTY.easy.extraCrashes],
    [0.85, 0.85, 1]
  );
  assert.deepEqual(
    [SURF_DIFFICULTY.hard.speed, SURF_DIFFICULTY.hard.density, SURF_DIFFICULTY.endless.densityCap],
    [1.2, 1.15, 1.5]
  );
  const easy = applyDifficulty(SURF, 'easy');
  const hard = applyDifficulty(SURF, 'hard');
  const endless = applyDifficulty(SURF, 'endless');
  assert.equal(easy.BASE_SPEED, SURF.BASE_SPEED * 0.85);
  assert.equal(easy.MAX_SPEED, SURF.MAX_SPEED * 0.85);
  assert.equal(easy.DENSITY_MULT, 0.85);
  assert.equal(easy.ARCADE_MAX_CRASHES, SURF.ARCADE_MAX_CRASHES + 1, 'Leicht +1 crash allowance');
  assert.equal(hard.BASE_SPEED, SURF.BASE_SPEED * 1.2);
  assert.equal(hard.MAX_SPEED, 18, '§E-G74 binding: Schwer speed-cap 16 → 18');
  assert.equal(hard.DENSITY_MULT, 1.15);
  assert.equal(hard.ARCADE_MAX_CRASHES, SURF.ARCADE_MAX_CRASHES, 'Schwer crash allowance unchanged');
  assert.equal(hard.GATED_SPAWNS, true);
  assert.equal(endless.MAX_SPEED, 20, '§G5.4: Endlos ramp continues to 20 m/s');
  assert.equal(endless.ENDLESS, true);
  assert.equal(endless.DENSITY_CAP, 1.5, '§G5.4: Endlos density cap ×1.5');
  assert.equal(endless.ARCADE_MAX_CRASHES, 3, 'Endlos ends on the 3rd crash (as arcade)');
  // §G5.3 guardrails: validator margins (reaction window model) untouched,
  // player hitbox never shrinks below Mittel
  for (const t of [easy, hard, endless]) {
    assert.equal(t.VALIDATOR.ACTION_LEAD_SEC, SURF.VALIDATOR.ACTION_LEAD_SEC);
    assert.ok(t.VALIDATOR.ACTION_LEAD_SEC >= 0.35, 'reaction window ≥ 0.35 s');
    assert.ok(t.PLAYER_HALF_W >= SURF.PLAYER_HALF_W * 0.55, 'hitbox ≥ 55 % of Mittel');
  }
  // endless density ramp: 1.15 at the gate → 1.5 by DENSITY_RAMP_FULL_M
  assert.equal(densityMultAt(0, endless), 1.15);
  assert.equal(densityMultAt(endless.DENSITY_RAMP_FULL_M, endless), 1.5);
  assert.equal(densityMultAt(1e9, endless), 1.5, 'clamped at the cap');
  assert.equal(densityMultAt(500, hard), 1.15, 'non-endless density stays flat');
  // speed ramp actually reaches the new caps
  assert.equal(speedRampAt(1e6, hard), 18);
  assert.equal(speedRampAt(1e6, endless), 20);
});

test('V4/G74 surf: normal rng/coin streams stay bit-identical (createRun + coinRowCount)', () => {
  // coinRowCount must not draw from the rng at COIN_RATE 1
  let draws = 0;
  const countingRng = () => {
    draws += 1;
    return 0.5;
  };
  assert.equal(coinRowCount(countingRng, 5, SURF), 5);
  assert.equal(draws, 0, 'Mittel coin materialization draws nothing');
  // and two identically-seeded normal runs stay bit-equal (stream untouched)
  const a = simulateRun({ rng: rng(99), mode: 'arcade', maxSec: 30 });
  const b = simulateRun({ rng: rng(99), mode: 'arcade', maxSec: 30 });
  assert.deepEqual(
    { d: a.run.distanceM, c: a.run.coins, s: a.score },
    { d: b.run.distanceM, c: b.run.coins, s: b.score }
  );
});

test('V4/G74 surf §C8.7: 200 seeded GATED chunk sequences survivable at Schwer AND Endlos scaled speeds', () => {
  for (const mode of ['hard', 'endless']) {
    const tune = applyDifficulty(SURF, mode);
    const speeds = validatorProbeSpeeds(tune);
    assert.ok(Math.abs(speeds[speeds.length - 1] - tune.MAX_SPEED) < 1e-9, 'probe set reaches the scaled cap');
    for (let seed = 0; seed < 200; seed += 1) {
      const r = rng(seed * 2654435761 + 1);
      let startM = 0;
      let last = -1;
      let recent = [];
      const hazards = [];
      while (startM < 1500) { // 1.5 km of street per seed (endless crosses the density ramp)
        recent = recent.filter((h) => h.atM > startM - tune.CHUNK_LEN_M * 2);
        const idx = pickNextSurvivableChunk(r, startM, last, recent, tune);
        if (idx < 0) {
          startM += tune.CHUNK_LEN_M * 0.35; // breather strip (spawnStep's rule)
          continue;
        }
        const ex = expandChunk(CHUNKS[idx], startM);
        hazards.push(...ex.hazards);
        recent.push(...ex.hazards);
        last = idx;
        startM += tune.CHUNK_LEN_M / densityMultAt(startM, tune);
      }
      // the WHOLE compressed street must stay never-impossible at every
      // scaled ramp speed (stronger than the windowed runtime gate)
      for (const v of speeds) {
        assert.equal(
          isSequenceSurvivable(hazards, v, tune),
          true,
          `${mode} seed ${seed} unsurvivable at ${v} m/s`
        );
      }
    }
  }
});

test('V4/G74 surf: gated spawnStep streams denser chunks and stays survivable end-to-end', () => {
  const tune = applyDifficulty(SURF, 'endless');
  const run = createRun({ rng: rng(7), mode: 'arcade', tune });
  const seen = [];
  for (let i = 0; i < 60 * 30; i += 1) {
    const evs = stepRun(run, 1 / 30, botInput(run));
    for (const e of evs) if (e.type === 'spawn') seen.push(e.ob.kind);
    if (run.ended) break;
  }
  assert.ok(seen.length > 0, 'hazards spawned through the gated path');
  assert.ok(run.chunksEndM > run.distanceM, 'stream kept ahead of the player');
});

test('V4/G74 surf: muenzregen +50 % expected coins, turbo speed/score, riesenGooby scale/hitbox', () => {
  const hard = applyDifficulty(SURF, 'hard');
  const rain = applyModifier(hard, { type: 'muenzregen', coinRate: 1.5 });
  assert.equal(rain.COIN_RATE, 1.5);
  assert.equal(coinRowCount(() => 0.49, 5, rain), 8, '5 × 1.5 = 7.5 → Bernoulli up');
  assert.equal(coinRowCount(() => 0.51, 5, rain), 7, '5 × 1.5 = 7.5 → Bernoulli down');
  assert.equal((8 + 7) / 2, 5 * 1.5, 'exactly +50 % in expectation');

  const turbo = applyModifier(hard, { type: 'turbo', speedMult: 1.25, scoreMult: 1.5 });
  assert.equal(turbo.BASE_SPEED, hard.BASE_SPEED * 1.25);
  assert.equal(turbo.MAX_SPEED, hard.MAX_SPEED * 1.25);
  assert.equal(turbo.SCORE_MULT, 1.5);
  assert.equal(turbo.GATED_SPAWNS, true);
  const run = createRun({ rng: rng(1), mode: 'arcade', tune: turbo });
  run.distanceM = 100;
  run.coins = 10;
  assert.equal(runScore(run), Math.round(surfScore(100, 10, 0) * 1.5), 'turbo score ×1.5');

  const giant = applyModifier(hard, { type: 'riesenGooby', scale: 1.6, hitboxMult: 1.3 });
  assert.equal(giant.RENDER_SCALE_MULT, 1.6);
  assert.equal(giant.PLAYER_HALF_W, hard.PLAYER_HALF_W * 1.3);
  assert.equal(giant.PLAYER_HALF_DEPTH, hard.PLAYER_HALF_DEPTH * 1.3);
  assert.strictEqual(applyModifier(hard, null), hard, 'no modifier = no-op');
  assert.strictEqual(applyModifier(hard, { type: 'doppelGold' }), hard, 'payout-only types = no-op');
});

test('V4/G74 surf: endless ends on the 3rd crash like arcade', () => {
  const tune = applyDifficulty(SURF, 'endless');
  const run = createRun({ rng: rng(2), mode: 'arcade', tune });
  run.chunksEndM = 1e9;
  run.nextPowerupAtM = 1e9;
  for (let i = 0; i < 3; i += 1) {
    run.obstacles.push({
      id: 900 + i,
      kind: 'crate',
      def: tune.OBSTACLES.crate,
      lane: 1,
      x: 0,
      z: -0.1,
      halfW: tune.OBSTACLES.crate.halfW,
      telegraphed: true,
      hit: false,
      minClear: Infinity,
      passed: false,
    });
    run.invulnT = 0;
    stepRun(run, 1 / 30, {});
    run.invulnT = 0;
    run.stumbleT = 0;
  }
  assert.equal(run.crashes, 3);
  assert.equal(run.ended, true, '3rd crash ends the endless run');
});

test('V4/G74 surf: Schwer target 900 reachable 1-of-5 and bot means monotone easy ≥ mittel ≥ schwer', () => {
  const hard5 = Array.from({ length: 5 }, (_, i) => simulateSurfAutoplay('hard', i + 1, 240).score);
  assert.ok(hard5.some((s) => s >= 900), `Schwer target 900 missed: ${hard5}`);
  const mean = (mode) => {
    const scores = Array.from({ length: 10 }, (_, i) => simulateSurfAutoplay(mode, i + 1, 240).score);
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };
  const e = mean('easy');
  const n = mean('normal');
  const h = mean('hard');
  assert.ok(e >= n, `easy ${e.toFixed(0)} < normal ${n.toFixed(0)}`);
  assert.ok(n >= h, `normal ${n.toFixed(0)} < hard ${h.toFixed(0)}`);
});
