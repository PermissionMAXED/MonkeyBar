// Games V3b (PLAN3 §C10.1 #3/#4, agent V3/G42) — pure-logic tests for
// rocketRescue.logic.js (physics lander: landing classes, fuel economy,
// wind gating, auto-tow, PD bot) and harborHopper.logic.js (momentum boat:
// pickups/bumps with 70 % hitboxes, wave-crest surf-boosts, seagull idle
// rule, Fischkutter-Horn) plus the §E0.1-3 coin rows/unlocks for both ids.
// No three.js/DOM (§B rule) — the .logic.js siblings are headless.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROCKET,
  ROCKET_DIFFICULTY,
  applyDifficulty as applyRocketDifficulty,
  applyModifier as applyRocketModifier,
  simulateRocketAutoplay,
  createLayout,
  classifyLanding,
  roundScore,
  tiltCommandFor,
  createEngine as createRocketEngine,
  createBot as createRocketBot,
  simulateRound as simulateRocketRound,
  mulberry32,
} from '../src/minigames/games/rocketRescue.logic.js';
import {
  HARBOR,
  HARBOR_DIFFICULTY,
  applyDifficulty as applyHarborDifficulty,
  applyModifier as applyHarborModifier,
  rowReachability,
  hopperScore,
  simulateHarborAutoplay,
  laneOf,
  speedOf,
  hits,
  hitsPier,
  inHornCone,
  applyScore,
  createEngine as createHarborEngine,
  createBot as createHarborBot,
  simulateRound as simulateHarborRound,
} from '../src/minigames/games/harborHopper.logic.js';
import { COIN_TABLE, UNLOCKS } from '../src/data/constants.js';
import { MINIGAMES_BY_ID, computeCoins } from '../src/data/minigames.js';

// ═══════════════════════════════════════════════════ rocketRescue (§C10.1 #3)

test('rocketRescue: §C10.1 binding numbers are pinned in ROCKET', () => {
  assert.equal(ROCKET.DURATION_SEC, 120); // ~120 s round
  assert.equal(ROCKET.FUEL_MAX, 100); // tank 100
  assert.equal(ROCKET.FUEL_BURN_PER_SEC, 8); // thrust burns 8/s
  assert.equal(ROCKET.PLATFORM_COUNT, 5); // 5 seeded platforms
  assert.equal(ROCKET.LAND_MAX_VY, 1.2); // pickup needs ≤ 1.2 m/s
  assert.equal(ROCKET.SOFT_MAX_VY, 0.5); // soft bonus at ≤ 0.5 m/s
  assert.equal(ROCKET.RESCUE_POINTS, 30); // 30·rescued
  assert.equal(ROCKET.SOFT_LANDING_BONUS, 5); // +5 per soft landing
  assert.equal(ROCKET.FUEL_SCORE_DIVISOR, 2); // + fuel/2
  assert.equal(ROCKET.HARD_FUEL_PENALTY, 10); // hard landing = −10 fuel
  assert.equal(ROCKET.WIND_FROM_RESCUES, 2); // gusts from the 3rd leg on
});

test('rocketRescue: classifyLanding thresholds (§C10.1 1.2 / 0.5 m/s)', () => {
  assert.equal(classifyLanding(0), 'soft');
  assert.equal(classifyLanding(0.5), 'soft');
  assert.equal(classifyLanding(0.51), 'ok');
  assert.equal(classifyLanding(1.2), 'ok');
  assert.equal(classifyLanding(1.21), 'hard');
  assert.equal(classifyLanding(3.5), 'hard');
});

test('rocketRescue: roundScore formula 30·rescued + fuel/2 + 5/soft', () => {
  assert.equal(roundScore(0, 0, 0), 0);
  assert.equal(roundScore(5, 100, 10), 5 * 30 + 50 + 50);
  assert.equal(roundScore(3, 41, 2), Math.floor(90 + 20.5 + 10));
  assert.equal(roundScore(0, -5, 0), 0); // fuel floor
});

test('rocketRescue: tiltCommandFor screen thirds (left/middle/right)', () => {
  assert.equal(tiltCommandFor(null), 0); // not touching = level out
  assert.equal(tiltCommandFor(-0.8), -1);
  assert.equal(tiltCommandFor(-1 / 3 - 0.01), -1);
  assert.equal(tiltCommandFor(0), 0);
  assert.equal(tiltCommandFor(0.2), 0);
  assert.equal(tiltCommandFor(1 / 3 + 0.01), 1);
  assert.equal(tiltCommandFor(0.9), 1);
});

test('rocketRescue: createLayout is seed-deterministic with 5 bunny platforms in-bounds', () => {
  const a = createLayout(mulberry32(7));
  const b = createLayout(mulberry32(7));
  assert.deepEqual(a, b);
  assert.equal(a.platforms.length, 5);
  for (const p of a.platforms) {
    assert.ok(p.bunny, 'every platform starts with a stranded bunny');
    assert.ok(Math.abs(p.x) <= ROCKET.WORLD_HALF_W, 'platform inside the field');
    assert.ok(p.y > 1 && p.y < ROCKET.CEILING_Y, 'platform between floor and ceiling');
  }
  assert.equal(a.fuelPickups.length, ROCKET.FUEL_PICKUP_COUNT);
  for (const f of a.fuelPickups) {
    assert.ok(Math.abs(f.x) <= ROCKET.WORLD_HALF_W && f.y > 1, 'canister floats mid-air');
    assert.equal(f.taken, false);
  }
  const c = createLayout(mulberry32(8));
  assert.notDeepEqual(a.platforms, c.platforms, 'different seed → different layout');
});

test('rocketRescue: parked craft lifts off under thrust and burns 8 fuel/s', () => {
  const eng = createRocketEngine(mulberry32(1));
  assert.equal(eng.state.landedOn, 'pad');
  const events = eng.step({ thrust: true, tiltDir: 0 }, 1 / 60);
  assert.ok(events.some((e) => e.type === 'liftoff'));
  assert.equal(eng.state.landedOn, null);
  // burn 1 s of thrust in engine steps → ≈ 8 fuel gone
  let fuel0 = ROCKET.FUEL_MAX;
  for (let i = 0; i < 60; i += 1) eng.step({ thrust: true, tiltDir: 0 }, 1 / 60);
  assert.ok(Math.abs((fuel0 - eng.state.fuel) - ROCKET.FUEL_BURN_PER_SEC * (61 / 60)) < 0.2);
});

test('rocketRescue: soft platform landing picks the bunny up; pad delivery rescues', () => {
  const eng = createRocketEngine(mulberry32(3));
  const s = eng.state;
  const p = eng.layout.platforms[0];
  // drop the craft just above platform 0 with a soft descent
  s.landedOn = null;
  s.departedFrom = null;
  s.lastLandedOn = null;
  s.x = p.x;
  s.y = p.y + 0.005;
  s.vx = 0;
  s.vy = -0.2;
  const ev1 = [];
  for (let i = 0; i < 5 && !ev1.some((e) => e.type === 'landing'); i += 1) {
    ev1.push(...eng.step({ thrust: false, tiltDir: 0 }, 1 / 60));
  }
  const landing = ev1.find((e) => e.type === 'landing');
  assert.ok(landing && landing.kind === 'soft' && landing.where === 0);
  assert.ok(ev1.some((e) => e.type === 'bunnyPickup'));
  assert.equal(s.carrying, true);
  assert.equal(eng.layout.platforms[0].bunny, false);
  assert.equal(s.softLandings, 1, 'rescue-work soft landing is bonus-eligible');
  // now deliver: drop just above the pad
  s.landedOn = null;
  s.departedFrom = null;
  s.x = eng.layout.pad.x;
  s.y = eng.layout.pad.y + 0.005;
  s.vy = -0.2;
  const ev2 = [];
  for (let i = 0; i < 5 && !ev2.some((e) => e.type === 'landing'); i += 1) {
    ev2.push(...eng.step({ thrust: false, tiltDir: 0 }, 1 / 60));
  }
  assert.ok(ev2.some((e) => e.type === 'rescue' && e.count === 1));
  assert.equal(s.carrying, false);
  assert.equal(s.rescued, 1);
});

test('rocketRescue: hard landing bounces with −10 fuel — never death (§C10.1)', () => {
  const eng = createRocketEngine(mulberry32(4));
  const s = eng.state;
  s.landedOn = null;
  s.departedFrom = null;
  s.x = eng.layout.pad.x;
  s.y = eng.layout.pad.y + 0.01;
  s.vy = -2.4;
  const fuel0 = s.fuel;
  const events = eng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  const hard = events.find((e) => e.type === 'hardLanding');
  assert.ok(hard, 'hard landing event fires');
  assert.ok(s.vy > 0, 'craft bounces back up');
  assert.equal(s.landedOn, null, 'a bounce is not a parked landing');
  assert.ok(Math.abs((fuel0 - s.fuel) - ROCKET.HARD_FUEL_PENALTY) < 0.05);
  assert.equal(s.ended, false);
  assert.equal(s.hardLandings, 1);
});

test('rocketRescue: anti-farm — re-landing the same surface pays no soft bonus', () => {
  const eng = createRocketEngine(mulberry32(5));
  const s = eng.state;
  // first soft landing on the (empty) pad — lastLandedOn starts as 'pad',
  // so a pad re-landing without rescue work is NOT bonus-eligible
  s.landedOn = null;
  s.departedFrom = null;
  s.x = eng.layout.pad.x;
  s.y = eng.layout.pad.y + 0.005;
  s.vy = -0.2;
  const ev = [];
  for (let i = 0; i < 5 && !ev.some((e) => e.type === 'landing'); i += 1) {
    ev.push(...eng.step({ thrust: false, tiltDir: 0 }, 1 / 60));
  }
  const landing = ev.find((e) => e.type === 'landing');
  assert.ok(landing && landing.kind === 'soft');
  assert.equal(landing.bonusEligible, false, 'hop-farming the pad pays nothing');
  assert.equal(s.softLandings, 0);
});

test('rocketRescue: fuel canister refills +30, respawns after 9 s', () => {
  const eng = createRocketEngine(mulberry32(6));
  const s = eng.state;
  const f = eng.layout.fuelPickups[0];
  s.landedOn = null;
  s.departedFrom = null;
  s.x = f.x;
  s.y = f.y + 0.01;
  s.vx = 0;
  s.vy = 0.2; // rising through it (no landing checks)
  s.fuel = 40;
  const events = eng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  assert.ok(events.some((e) => e.type === 'fuelPickup' && e.index === 0));
  assert.ok(Math.abs(s.fuel - (40 + ROCKET.FUEL_PICKUP_AMOUNT)) < 0.1);
  assert.equal(f.taken, true);
  // respawn timer counts down inside step()
  for (let i = 0; i < Math.ceil(ROCKET.FUEL_RESPAWN_SEC * 60) + 2; i += 1) {
    eng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
    if (eng.state.ended) break;
  }
  assert.equal(f.taken, false, 'canister floats back in');
});

test('rocketRescue: out of fuel mid-air → auto-tow home, run ends (never death)', () => {
  const eng = createRocketEngine(mulberry32(9));
  const s = eng.state;
  s.landedOn = null;
  s.departedFrom = null;
  s.x = 5;
  s.y = 6;
  s.vy = 0;
  s.fuel = 0;
  const ev1 = eng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  assert.ok(ev1.some((e) => e.type === 'outOfFuel'));
  assert.equal(s.towing, true);
  let ended = null;
  for (let i = 0; i < 60 * 20 && !ended; i += 1) {
    const events = eng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
    ended = events.find((e) => e.type === 'ended') ?? null;
  }
  assert.ok(ended && ended.reason === 'fuel');
  assert.ok(Math.hypot(s.x - eng.layout.pad.x, s.y - eng.layout.pad.y) < 0.1, 'towed to the pad');
});

test('rocketRescue: wind gusts gate on 2 rescues and telegraph first (§C10.1 level 3+)', () => {
  const eng = createRocketEngine(mulberry32(11));
  const s = eng.state;
  // airborne far past the wind schedule with 0 rescues → silence
  s.landedOn = null;
  s.departedFrom = null;
  s.x = 4;
  s.y = 8;
  let saw = [];
  for (let i = 0; i < 60 * 12; i += 1) {
    s.y = 8; // pin altitude (no landings — isolate the wind scheduler)
    s.vy = 0;
    s.fuel = 100;
    saw.push(...eng.step({ thrust: false, tiltDir: 0 }, 1 / 60));
  }
  assert.ok(!saw.some((e) => e.type === 'windTelegraph'), 'no wind before 2 rescues');
  // grant 2 rescues → the scheduler arms; telegraph precedes the gust by 1 s
  s.rescued = 2;
  saw = [];
  let telegraphAt = null;
  let gustAt = null;
  for (let i = 0; i < 60 * 15 && gustAt == null; i += 1) {
    s.y = 8;
    s.vy = 0;
    s.fuel = 100;
    for (const e of eng.step({ thrust: false, tiltDir: 0 }, 1 / 60)) {
      if (e.type === 'windTelegraph' && telegraphAt == null) telegraphAt = s.elapsed;
      if (e.type === 'windGust') gustAt = s.elapsed;
    }
  }
  assert.ok(telegraphAt != null && gustAt != null, 'telegraph then gust fired');
  assert.ok(Math.abs((gustAt - telegraphAt) - ROCKET.WIND_TELEGRAPH_SEC) < 0.1);
});

test('rocketRescue: PD bot clears the bar over 20 seeds (§C10.1 autoplay)', () => {
  let scoreSum = 0;
  let rescuedSum = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const r = simulateRocketRound(seed);
    scoreSum += r.score;
    rescuedSum += r.rescued;
    assert.ok(r.endReason != null, `seed ${seed} must end (got stuck)`);
    assert.ok(r.elapsed <= ROCKET.DURATION_SEC + 1, `seed ${seed} respects the round cap`);
    assert.ok(r.rescued >= 2, `seed ${seed}: bot rescues at least 2 (got ${r.rescued})`);
  }
  assert.ok(rescuedSum / 20 >= 3.5, `bot avg rescues ≥ 3.5 (got ${(rescuedSum / 20).toFixed(2)})`);
  assert.ok(scoreSum / 20 >= 140, `bot avg score ≥ 140 (got ${(scoreSum / 20).toFixed(1)})`);
});

test('rocketRescue: simulateRound is deterministic per seed', () => {
  assert.deepEqual(simulateRocketRound(42), simulateRocketRound(42));
});

test('rocketRescue: coin row §C10.1 — 5/4/28, L18, energy 8', () => {
  assert.deepEqual(COIN_TABLE.rocketRescue, { divisor: 5, min: 4, max: 28 });
  assert.equal(UNLOCKS.MINIGAMES.rocketRescue, 18);
  assert.equal(MINIGAMES_BY_ID.rocketRescue.energyCost, 8);
  assert.equal(computeCoins(COIN_TABLE.rocketRescue, 110, false), 22); // partial run
  assert.equal(computeCoins(COIN_TABLE.rocketRescue, 0, false), 4); // min clamp
  assert.equal(computeCoins(COIN_TABLE.rocketRescue, 9999, false), 28); // max clamp
  assert.equal(computeCoins(COIN_TABLE.rocketRescue, 110, true), 44); // daily ×2 after clamp
});

// ═══════════════════════════════════════════════════ harborHopper (§C10.1 #4)

test('harborHopper: §C10.1 binding numbers are pinned in HARBOR', () => {
  assert.equal(HARBOR.DURATION_SEC, 120); // 120 s round
  assert.equal(HARBOR.BASE_SPEED, 6); // auto-forward 6 m/s
  assert.equal(HARBOR.CRATE_POINTS, 4); // crates +4
  assert.equal(HARBOR.RING_POINTS, 2); // net rings +2
  assert.equal(HARBOR.BUMP_PENALTY, -3); // bump = −3
  assert.equal(HARBOR.HITBOX_SCALE, 0.7); // 70 % hitboxes
  assert.equal(HARBOR.BOOST_FACTOR, 1.3); // surf-boost +30 %
  assert.equal(HARBOR.BOOST_SEC, 2); // for 2 s
  assert.equal(HARBOR.GULL_IDLE_SEC, 4); // idle > 4 s in one lane
  assert.equal(HARBOR.HORN_CHARGES, 2); // Fischkutter-Horn: 2 charges
  assert.equal(HARBOR.HORN_CONE_M, 6); // 6 m cone
});

test('harborHopper: laneOf splits the channel into 3 idle lanes', () => {
  assert.equal(laneOf(-HARBOR.CHANNEL_HALF_W), 0);
  assert.equal(laneOf(-1.5), 0);
  assert.equal(laneOf(0), 1);
  assert.equal(laneOf(1.5), 2);
  assert.equal(laneOf(HARBOR.CHANNEL_HALF_W), 2);
});

test('harborHopper: speedOf applies boost ×1.3 and bump-slow ×0.55', () => {
  assert.equal(speedOf({ boostT: 0, slowT: 0 }), 6);
  assert.ok(Math.abs(speedOf({ boostT: 1, slowT: 0 }) - 7.8) < 1e-9);
  assert.ok(Math.abs(speedOf({ boostT: 0, slowT: 1 }) - 3.3) < 1e-9);
  assert.ok(Math.abs(speedOf({ boostT: 1, slowT: 1 }) - 4.29) < 1e-9); // both stack
});

test('harborHopper: hits applies the forgiving 70 % scale to obstacles only', () => {
  const boat = { x: 0, z: 0 };
  const r = HARBOR.BUOY_RADIUS + HARBOR.BOAT_RADIUS; // 1.35
  // 1.0 m away: inside the raw radius, OUTSIDE the 70 % scaled one (0.945)
  assert.equal(hits(boat, { x: 1.0, z: 0 }, r, false), true);
  assert.equal(hits(boat, { x: 1.0, z: 0 }, r, true), false);
  assert.equal(hits(boat, { x: 0.9, z: 0 }, r, true), true);
});

test('harborHopper: hitsPier respects reach/depth with the 70 % scale', () => {
  const pier = { side: 1, z: 100 };
  const innerEdge = HARBOR.CHANNEL_HALF_W - HARBOR.PIER_REACH_M * HARBOR.HITBOX_SCALE;
  assert.equal(hitsPier({ x: innerEdge + 0.05, z: 100 }, pier), true);
  assert.equal(hitsPier({ x: innerEdge - 0.05, z: 100 }, pier), false);
  assert.equal(hitsPier({ x: innerEdge + 0.05, z: 103 }, pier), false, 'z out of depth');
  const portPier = { side: -1, z: 100 };
  assert.equal(hitsPier({ x: -innerEdge - 0.05, z: 100 }, portPier), true);
  assert.equal(hitsPier({ x: -innerEdge + 0.05, z: 100 }, portPier), false);
});

test('harborHopper: inHornCone — 6 m ahead, widening with distance', () => {
  const boat = { x: 0, z: 0 };
  assert.equal(inHornCone(boat, { x: 0, z: 3 }, HARBOR), true);
  assert.equal(inHornCone(boat, { x: 0, z: 6.5 }, HARBOR), false, 'past the 6 m cone');
  assert.equal(inHornCone(boat, { x: 0, z: -1 }, HARBOR), false, 'behind the boat');
  // at z=4 half-width = 0.9 + 4·0.45 = 2.7
  assert.equal(inHornCone(boat, { x: 2.6, z: 4 }, HARBOR), true);
  assert.equal(inHornCone(boat, { x: 2.8, z: 4 }, HARBOR), false);
  assert.equal(inHornCone(boat, { x: 1.2, z: 0.5 }, HARBOR), false, 'narrow near the bow');
});

test('harborHopper: applyScore floors at zero', () => {
  assert.equal(applyScore(2, -3), 0);
  assert.equal(applyScore(10, -3), 7);
  assert.equal(applyScore(0, 4), 4);
});

test('harborHopper: seeded generation is deterministic', () => {
  const a = createHarborEngine(mulberry32(13));
  const b = createHarborEngine(mulberry32(13));
  assert.deepEqual(a.items, b.items);
  assert.deepEqual(a.piers, b.piers);
  assert.ok(a.items.length > 0, 'rows generated ahead of the start');
  for (const item of a.items) {
    assert.ok(['crate', 'ring', 'buoy'].includes(item.type));
    assert.ok(Math.abs(item.x) < HARBOR.CHANNEL_HALF_W, 'items inside the channel');
  }
});

test('harborHopper: crate +4 / ring +2 collection via engine step', () => {
  const eng = createHarborEngine(mulberry32(2));
  const s = eng.state;
  eng.items.length = 0; // isolate: plant exactly one crate + one ring ahead
  eng.items.push({ type: 'crate', x: 0, z: s.z + 0.5, gone: false });
  eng.items.push({ type: 'ring', x: 0, z: s.z + 2.0, gone: false });
  const seen = [];
  for (let i = 0; i < 40; i += 1) seen.push(...eng.step({ targetX: 0 }, 1 / 60));
  assert.ok(seen.some((e) => e.type === 'crate'));
  assert.ok(seen.some((e) => e.type === 'ring'));
  assert.equal(s.crates, 1);
  assert.equal(s.rings, 1);
  assert.equal(s.score, HARBOR.CRATE_POINTS + HARBOR.RING_POINTS);
});

test('harborHopper: buoy bump = −3, slow, i-frames, kills the surf', () => {
  const eng = createHarborEngine(mulberry32(2));
  const s = eng.state;
  eng.items.length = 0;
  s.score = 10;
  s.boostT = 1.5;
  s.boostChain = 2;
  eng.items.push({ type: 'buoy', x: 0, z: s.z + 0.3, gone: false });
  const seen = [];
  for (let i = 0; i < 30; i += 1) seen.push(...eng.step({ targetX: 0 }, 1 / 60));
  const bump = seen.find((e) => e.type === 'bump');
  assert.ok(bump && bump.what === 'buoy');
  assert.equal(s.score, 7);
  assert.equal(s.bumps, 1);
  assert.ok(s.slowT > 0, 'slowed');
  assert.equal(s.boostT, 0, 'bump kills the surf');
  assert.equal(s.boostChain, 0);
  assert.equal(seen.filter((e) => e.type === 'bump').length, 1, 'i-frames absorb re-hits');
});

test('harborHopper: crest sweet spot grants +30 % boost — chainable, slow blocks it', () => {
  const eng = createHarborEngine(mulberry32(3));
  const s = eng.state;
  eng.items.length = 0;
  // crest about to pass under the hull, sweet spot centered on the boat
  eng.waves.push({ z: s.z + 0.2, sweetX: s.x, ridden: false });
  let seen = [];
  for (let i = 0; i < 10; i += 1) seen.push(...eng.step({ targetX: s.x }, 1 / 60));
  const boost = seen.find((e) => e.type === 'boost');
  assert.ok(boost && boost.chain === 1, 'first crest → chain 1');
  assert.ok(s.boostT > 0);
  assert.ok(Math.abs(speedOf(s) - HARBOR.BASE_SPEED * HARBOR.BOOST_FACTOR) < 1e-9);
  // second crest while still boosted → chain 2 (chainable, §C10.1)
  eng.waves.push({ z: s.z + 0.2, sweetX: s.x, ridden: false });
  seen = [];
  for (let i = 0; i < 10; i += 1) seen.push(...eng.step({ targetX: s.x }, 1 / 60));
  const chain = seen.find((e) => e.type === 'boost');
  assert.ok(chain && chain.chain === 2, 'chained crest → chain 2');
  // a crest ridden off-center (outside SWEET_HALF_W) gives nothing
  s.boostT = 0;
  s.boostChain = 0;
  eng.waves.push({ z: s.z + 0.2, sweetX: s.x + HARBOR.SWEET_HALF_W + 0.4, ridden: false });
  seen = [];
  for (let i = 0; i < 10; i += 1) seen.push(...eng.step({ targetX: s.x }, 1 / 60));
  assert.ok(!seen.some((e) => e.type === 'boost'), 'off-center crest: no boost');
});

test('harborHopper: seagull honks after 4 s idle, steals after +1.5 s, lane change shoos it', () => {
  const eng = createHarborEngine(mulberry32(4));
  const s = eng.state;
  eng.items.length = 0;
  s.crates = 2;
  s.score = 8;
  const seen = [];
  // idle dead-center (lane 1) — warn at 4 s, steal at 5.5 s
  for (let i = 0; i < Math.ceil(60 * (HARBOR.GULL_IDLE_SEC + HARBOR.GULL_WARN_SEC)) + 5; i += 1) {
    seen.push(...eng.step({ targetX: 0 }, 1 / 60));
  }
  assert.ok(seen.some((e) => e.type === 'gullWarn'), 'honk warning first');
  assert.ok(seen.some((e) => e.type === 'gullSteal'), 'then the steal');
  assert.equal(s.crates, 1, 'top crate stolen');
  assert.equal(s.steals, 1);
  assert.equal(s.score, 8 - HARBOR.CRATE_POINTS);
  // second run-up: hop lanes during the warning → gull leaves, no steal
  const seen2 = [];
  for (let i = 0; i < 60 * 4 + 10; i += 1) seen2.push(...eng.step({ targetX: 0 }, 1 / 60));
  assert.ok(seen2.some((e) => e.type === 'gullWarn'));
  const before = s.steals;
  const seen3 = [];
  for (let i = 0; i < 60; i += 1) seen3.push(...eng.step({ targetX: 2.4 }, 1 / 60)); // lane 1 → 2
  assert.ok(seen3.some((e) => e.type === 'gullLeave'), 'lane change shoos the gull');
  assert.equal(s.steals, before, 'no steal after the dodge');
});

test('harborHopper: gull ignores an empty deck (no crates aboard)', () => {
  const eng = createHarborEngine(mulberry32(5));
  eng.items.length = 0;
  const seen = [];
  for (let i = 0; i < 60 * 7; i += 1) seen.push(...eng.step({ targetX: 0 }, 1 / 60));
  assert.ok(!seen.some((e) => e.type === 'gullWarn'), 'nothing to steal — no warning');
});

test('harborHopper: horn clears cone buoys, spends charges, then runs empty', () => {
  const eng = createHarborEngine(mulberry32(6));
  const s = eng.state;
  eng.items.length = 0;
  eng.items.push({ type: 'buoy', x: 0.2, z: s.z + 2, gone: false });
  eng.items.push({ type: 'buoy', x: -0.8, z: s.z + 4, gone: false });
  eng.items.push({ type: 'buoy', x: 0, z: s.z + 20, gone: false }); // out of cone
  const ev1 = eng.step({ targetX: null, horn: true }, 1 / 60);
  const cleared = ev1.find((e) => e.type === 'buoyCleared');
  assert.ok(cleared && cleared.count === 2, 'both cone buoys cleared');
  assert.equal(s.hornCharges, 1);
  assert.equal(eng.items.filter((i) => i.type === 'buoy' && !i.gone).length, 1);
  const ev2 = eng.step({ targetX: null, horn: true }, 1 / 60);
  assert.ok(ev2.some((e) => e.type === 'buoyCleared'));
  assert.equal(s.hornCharges, 0);
  const ev3 = eng.step({ targetX: null, horn: true }, 1 / 60);
  assert.ok(ev3.some((e) => e.type === 'hornEmpty'), 'third honk: empty');
});

test('harborHopper: momentum steering is damped and clamped to the channel', () => {
  const eng = createHarborEngine(mulberry32(7));
  const s = eng.state;
  eng.items.length = 0;
  for (let i = 0; i < 60 * 3; i += 1) eng.step({ targetX: 99 }, 1 / 60); // slam starboard
  assert.ok(s.x <= HARBOR.CHANNEL_HALF_W - 0.3, 'wall clamps the hull');
  assert.ok(Math.abs(s.vx) <= HARBOR.MAX_LATERAL_SPEED + 1e-9, 'lateral speed capped');
  // release the drag → damping bleeds the lateral speed off
  const vx0 = Math.abs(s.vx);
  for (let i = 0; i < 60; i += 1) eng.step({ targetX: null }, 1 / 60);
  assert.ok(Math.abs(s.vx) < Math.max(0.4, vx0), 'coasting damps vx');
});

test('harborHopper: greedy bot clears the bar over 20 seeds (§C10.1 autoplay)', () => {
  let scoreSum = 0;
  let boostSum = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const r = simulateHarborRound(seed);
    scoreSum += r.score;
    boostSum += r.boosts;
    assert.equal(r.steals, 0, `seed ${seed}: the bot never lets the gull steal`);
    assert.ok(r.bumps <= 3, `seed ${seed}: ≤ 3 bumps (got ${r.bumps})`);
    assert.ok(r.score >= 60, `seed ${seed}: score ≥ 60 (got ${r.score})`);
  }
  assert.ok(scoreSum / 20 >= 85, `bot avg score ≥ 85 (got ${(scoreSum / 20).toFixed(1)}) — §C10.1 “score ≈ 100”`);
  assert.ok(boostSum / 20 >= 4, `bot centers crests (avg boosts ${(boostSum / 20).toFixed(1)})`);
});

test('harborHopper: simulateRound is deterministic per seed', () => {
  assert.deepEqual(simulateHarborRound(42), simulateHarborRound(42));
});

test('harborHopper: bot control respects channel bounds and horn availability', () => {
  const eng = createHarborEngine(mulberry32(21));
  const bot = createHarborBot();
  for (let i = 0; i < 60 * 5; i += 1) {
    const c = bot.control(eng.state, eng.items, eng.piers, eng.waves);
    assert.ok(Math.abs(c.targetX) <= HARBOR.CHANNEL_HALF_W, 'target stays in the channel');
    if (c.horn) assert.ok(eng.state.hornCharges > 0, 'bot only honks with charges left');
    eng.step(c, 1 / 60);
  }
});

test('harborHopper: coin row §C10.1 — 5/4/30, L20, energy 8', () => {
  assert.deepEqual(COIN_TABLE.harborHopper, { divisor: 5, min: 4, max: 30 });
  assert.equal(UNLOCKS.MINIGAMES.harborHopper, 20);
  assert.equal(MINIGAMES_BY_ID.harborHopper.energyCost, 8);
  assert.equal(computeCoins(COIN_TABLE.harborHopper, 100, false), 20); // §C10.1 typical ≈ 100
  assert.equal(computeCoins(COIN_TABLE.harborHopper, 0, false), 4); // min clamp
  assert.equal(computeCoins(COIN_TABLE.harborHopper, 9999, false), 30); // max clamp
  assert.equal(computeCoins(COIN_TABLE.harborHopper, 100, true), 40); // daily ×2 after clamp
});

// ═══════════════════════════════════════ cross-checks (bot module smoke)

test('rocketRescue: bot control shape (thrust boolean + tilt −1/0/1)', () => {
  const eng = createRocketEngine(mulberry32(31));
  const bot = createRocketBot();
  for (let i = 0; i < 60 * 5; i += 1) {
    const c = bot.control(eng.state, eng.layout);
    assert.equal(typeof c.thrust, 'boolean');
    assert.ok([-1, 0, 1].includes(c.tiltDir));
    eng.step(c, 1 / 60);
  }
});

// ===========================================================================
// V4/G74 §G5 difficulty + endless + modifiers + seeded-bot certification
// (same seed protocol as test/difficultyCertification.test.js: hard gate
// seeds 11/22/33/44/55, monotone-means sample (i+1)·7919 × 10)
// ===========================================================================

const CERT_HARD_SEEDS = [11, 22, 33, 44, 55];
const CERT_MEAN_SEEDS = Array.from({ length: 10 }, (_, i) => (i + 1) * 7919);
const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('V4/G74 rocket: Mittel identity, §G5.3 physics/skill tolerance rows', () => {
  assert.strictEqual(applyRocketDifficulty(ROCKET, 'normal'), ROCKET, 'Mittel is identity');
  assert.strictEqual(applyRocketDifficulty(ROCKET, 'nonsense'), ROCKET, 'unknown ids fall back');
  const easy = applyRocketDifficulty(ROCKET, 'easy');
  const hard = applyRocketDifficulty(ROCKET, 'hard');
  const endless = applyRocketDifficulty(ROCKET, 'endless');
  assert.equal(ROCKET_DIFFICULTY.easy.tol, 1.25);
  assert.equal(ROCKET_DIFFICULTY.hard.tol, 0.8);
  for (const [t, tol] of [[easy, 1.25], [hard, 0.8], [endless, 0.8]]) {
    assert.equal(t.LAND_MAX_VY, ROCKET.LAND_MAX_VY * tol);
    assert.equal(t.SOFT_MAX_VY, ROCKET.SOFT_MAX_VY * tol);
    assert.equal(t.PLATFORM_HALF_W, ROCKET.PLATFORM_HALF_W * tol);
    // §G5.3 guardrail: the landing "hitbox" never below 55 % of Mittel
    assert.ok(t.PLATFORM_HALF_W >= ROCKET.PLATFORM_HALF_W * 0.55);
    assert.ok(t.LAND_MAX_VY >= ROCKET.LAND_MAX_VY * 0.55);
  }
  assert.equal(endless.ENDLESS, true);
  assert.equal(hard.ENDLESS, false);
  // §G5.2 stream identity: PLATFORM_HALF_W never feeds the seeded layout
  // sampling — every mode draws the SAME platforms, only widths change
  const a = createLayout(mulberry32(77), ROCKET);
  const b = createLayout(mulberry32(77), hard);
  for (let i = 0; i < a.platforms.length; i += 1) {
    assert.equal(b.platforms[i].x, a.platforms[i].x);
    assert.equal(b.platforms[i].y, a.platforms[i].y);
    assert.equal(b.platforms[i].halfW, a.platforms[i].halfW * 0.8);
  }
  assert.deepEqual(
    b.fuelPickups.map((f) => [f.x, f.y]),
    a.fuelPickups.map((f) => [f.x, f.y])
  );
});

test('V4/G74 rocket: muenzregen = +50 % canisters that float back sooner', () => {
  const hard = applyRocketDifficulty(ROCKET, 'hard');
  const rain = applyRocketModifier(hard, { type: 'muenzregen', coinRate: 1.5 });
  assert.equal(rain.FUEL_PICKUP_COUNT, Math.round(hard.FUEL_PICKUP_COUNT * 1.5));
  assert.equal(rain.FUEL_RESPAWN_SEC, hard.FUEL_RESPAWN_SEC / 1.5);
  assert.equal(rain.PICKUP_RATE, 1.5);
  const layout = createLayout(mulberry32(5), rain);
  assert.equal(layout.fuelPickups.length, rain.FUEL_PICKUP_COUNT, 'layout spawns them');
  // §C-SYS4.3: rocketRescue is muenzregen-only — anything else is a no-op
  assert.strictEqual(applyRocketModifier(hard, null), hard);
  assert.strictEqual(applyRocketModifier(hard, { type: 'turbo', speedMult: 1.25 }), hard);
  assert.strictEqual(applyRocketModifier(hard, { type: 'doppelGold' }), hard);
});

test('V4/G74 rocket §G5.4: Endlos skips the timer, thins refills, re-arms bunnies', () => {
  const tune = applyRocketDifficulty(ROCKET, 'endless');
  // no round-timer end in Endlos (Schwer still ends on time)
  const eng = createRocketEngine(mulberry32(3), tune);
  eng.state.elapsed = ROCKET.DURATION_SEC + 5;
  eng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  assert.equal(eng.state.ended, false, 'Endlos has no round timer');
  const hardEng = createRocketEngine(mulberry32(3), applyRocketDifficulty(ROCKET, 'hard'));
  hardEng.state.elapsed = ROCKET.DURATION_SEC + 5;
  hardEng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  assert.equal(hardEng.state.ended, true);
  assert.equal(hardEng.state.endReason, 'time');
  // §G5.4 ramp: canister refill thins −10 % per rescued bunny
  const f = eng.layout.fuelPickups[0];
  eng.state.landedOn = null;
  eng.state.rescued = 3;
  eng.state.fuel = 10;
  eng.state.x = f.x;
  eng.state.y = f.y + 0.001;
  eng.state.vy = 0.4; // drifting up — no landing this frame
  const evs = eng.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  const pick = evs.find((e) => e.type === 'fuelPickup');
  assert.ok(pick, 'canister grabbed');
  assert.ok(Math.abs(pick.amount - ROCKET.FUEL_PICKUP_AMOUNT * 0.7) < 1e-9, '30 × (1 − 0.1·3) = 21');
  assert.ok(Math.abs(eng.state.fuel - (10 + 21)) < 1e-9);
  // …and at 10+ rescues the refill bottoms out at 0 — the tank ALWAYS
  // starves → auto-tow ends the run (the §G5.4 end condition)
  const dry = createRocketEngine(mulberry32(4), tune);
  const g = dry.layout.fuelPickups[0];
  dry.state.landedOn = null;
  dry.state.rescued = 10;
  dry.state.fuel = 10;
  dry.state.x = g.x;
  dry.state.y = g.y + 0.001;
  dry.state.vy = 0.4;
  const evs2 = dry.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  assert.equal(evs2.find((e) => e.type === 'fuelPickup')?.amount, 0);
  // a cleared field re-arms: pad rescue with every platform empty
  const re = createRocketEngine(mulberry32(5), tune);
  for (const p of re.layout.platforms) p.bunny = false;
  re.state.carrying = true;
  re.state.landedOn = null;
  re.state.lastLandedOn = 0;
  re.state.x = re.layout.pad.x;
  re.state.y = re.layout.pad.y + 0.004;
  re.state.vy = -0.3;
  const evs3 = re.step({ thrust: false, tiltDir: 0 }, 1 / 60);
  assert.ok(evs3.some((e) => e.type === 'rescue'), 'pad delivery counts');
  assert.ok(evs3.some((e) => e.type === 'bunnyRespawn'), '§G5.4: field re-arms');
  assert.ok(re.layout.platforms.every((p) => p.bunny), 'all 5 bunnies back');
  assert.equal(re.state.ended, false, 'the run keeps going');
});

test('V4/G74 rocket §G5.4: Schwer target 115 ≥ 1/5 seeds, means monotone, Endlos fuel-out', () => {
  const hard5 = CERT_HARD_SEEDS.map((s) => simulateRocketAutoplay('hard', s).score);
  assert.ok(hard5.some((s) => s >= 115), `Schwer target 115 missed: ${hard5}`);
  const m = {};
  for (const mode of ['easy', 'normal', 'hard']) {
    m[mode] = meanOf(CERT_MEAN_SEEDS.map((s) => simulateRocketAutoplay(mode, s).score));
  }
  assert.ok(m.easy >= m.normal, `easy ${m.easy} < normal ${m.normal}`);
  assert.ok(m.normal >= m.hard, `normal ${m.normal} < hard ${m.hard}`);
  assert.equal(simulateRocketAutoplay('hard', 11).score, hard5[0], 'deterministic');
  const endless = simulateRocketAutoplay('endless', 1);
  assert.equal(endless.endReason, 'fuel', 'Endlos ends when the tank starves');
  assert.equal(endless.fuelLeft, 0);
  assert.ok(endless.rescued > ROCKET.PLATFORM_COUNT, 'bunny re-arm kept the run alive');
  assert.ok(Number.isFinite(endless.score) && endless.score >= 0);
});

test('V4/G74 harbor: Mittel identity, §G5.3 runner rows inside the guardrail band', () => {
  assert.strictEqual(applyHarborDifficulty(HARBOR, 'normal'), HARBOR, 'Mittel is identity');
  assert.strictEqual(applyHarborDifficulty(HARBOR, 'nonsense'), HARBOR, 'unknown ids fall back');
  const easy = applyHarborDifficulty(HARBOR, 'easy');
  const hard = applyHarborDifficulty(HARBOR, 'hard');
  const endless = applyHarborDifficulty(HARBOR, 'endless');
  // §G5.3 runner/steer row pins (the single source the derivation reads)
  assert.deepEqual(
    [HARBOR_DIFFICULTY.easy.speed, HARBOR_DIFFICULTY.easy.density, HARBOR_DIFFICULTY.easy.duration],
    [0.85, 0.85, 1.2]
  );
  assert.deepEqual(
    [HARBOR_DIFFICULTY.hard.speed, HARBOR_DIFFICULTY.hard.density, HARBOR_DIFFICULTY.hard.duration],
    [1.2, 1.15, 1]
  );
  // Leicht: speed ×0.85, density ×0.85, +20 % round time (score chances
  // scale with channel METERS — same distance as a Mittel round)
  assert.equal(easy.BASE_SPEED, HARBOR.BASE_SPEED * 0.85);
  assert.equal(easy.BUOY_CHANCE, HARBOR.BUOY_CHANCE * 0.85);
  assert.equal(easy.DURATION_SEC, HARBOR.DURATION_SEC * 1.2);
  assert.equal(easy.PIER_EVERY_M.min, HARBOR.PIER_EVERY_M.min / 0.85, 'piers thin out');
  // Schwer: speed ×1.2, density ×1.15, duration unchanged
  assert.equal(hard.BASE_SPEED, HARBOR.BASE_SPEED * 1.2);
  assert.equal(hard.BUOY_CHANCE, HARBOR.BUOY_CHANCE * 1.15);
  assert.equal(hard.DURATION_SEC, HARBOR.DURATION_SEC);
  assert.equal(hard.PIER_EVERY_M.max, HARBOR.PIER_EVERY_M.max / 1.15, 'piers come sooner');
  assert.equal(hard.ENDLESS, false);
  assert.equal(endless.ENDLESS, true);
  assert.equal(endless.ENDLESS_BUMP_LIMIT, 3, '§G5.4: 3 bumps end Endlos');
  // §G5.3 guardrails: hitbox forgiveness + reaction model NEVER shrink
  for (const t of [easy, hard, endless]) {
    assert.equal(t.HITBOX_SCALE, HARBOR.HITBOX_SCALE);
    assert.equal(t.VALIDATOR_REACT_SEC, 0.35);
    assert.equal(t.ROW_GAP_M.min, HARBOR.ROW_GAP_M.min);
  }
});

test('V4/G74 harbor §G5.3: row-reachability validator ≥ 1 for every derived mode (+turbo)', () => {
  for (const mode of ['easy', 'normal', 'hard', 'endless']) {
    const t = applyHarborDifficulty(HARBOR, mode);
    assert.ok(rowReachability(t) >= 1, `${mode}: reachability ${rowReachability(t).toFixed(3)}`);
    const turbo = applyHarborModifier(t, { type: 'turbo', speedMult: 1.25, scoreMult: 1.5 });
    assert.ok(rowReachability(turbo) >= 1, `${mode}+turbo: ${rowReachability(turbo).toFixed(3)}`);
  }
  // the Endlos ramp is validator-capped: speed never exceeds ENDLESS_MAX_SPEED
  const endless = applyHarborDifficulty(HARBOR, 'endless');
  const cruise = { boostT: 0, slowT: 0 };
  assert.equal(speedOf({ ...cruise, z: 0 }, endless), endless.BASE_SPEED);
  assert.ok(speedOf({ ...cruise, z: 300 }, endless) > endless.BASE_SPEED, 'ramp climbs');
  assert.equal(speedOf({ ...cruise, z: 1e6 }, endless), endless.ENDLESS_MAX_SPEED, 'capped');
  assert.equal(speedOf({ ...cruise, z: 1e6 }, applyHarborDifficulty(HARBOR, 'hard')),
    HARBOR.BASE_SPEED * 1.2, 'no ramp outside Endlos');
});

test('V4/G74 harbor: muenzregen +50 % pickup rows, turbo speed/score, riesenGooby radii', () => {
  const hard = applyHarborDifficulty(HARBOR, 'hard');
  const rain = applyHarborModifier(hard, { type: 'muenzregen', coinRate: 1.5 });
  assert.equal(rain.PICKUP_RATE, 1.5);
  assert.equal(rain.BUOY_CHANCE, hard.BUOY_CHANCE, 'muenzregen adds NO hazards');
  // engine-level: extra seeded pickup-only rows interleave the base table
  const countItems = (tune, seed) => {
    const eng = createHarborEngine(mulberry32(seed), { ...tune, LOOKAHEAD_M: 2000 });
    let pickups = 0;
    for (const it of eng.items) if (it.type !== 'buoy') pickups += 1;
    return pickups;
  };
  const base = countItems(hard, 7);
  const rained = countItems(rain, 7);
  const ratio = rained / base;
  assert.ok(ratio > 1.2 && ratio < 1.9, `≈ +50 % pickups over 2 km (got ×${ratio.toFixed(2)})`);
  // rate 1 short-circuits: the base rng stream stays bit-identical
  const eq = applyHarborModifier(hard, { type: 'muenzregen', coinRate: 1 });
  const a = createHarborEngine(mulberry32(9), hard);
  const b = createHarborEngine(mulberry32(9), eq);
  assert.deepEqual(b.items, a.items);
  const turbo = applyHarborModifier(hard, { type: 'turbo', speedMult: 1.25, scoreMult: 1.5 });
  assert.equal(turbo.BASE_SPEED, hard.BASE_SPEED * 1.25);
  assert.equal(turbo.SCORE_MULT, 1.5);
  assert.equal(hopperScore({ score: 101 }, turbo), Math.round(101 * 1.5));
  assert.equal(hopperScore({ score: 101 }, hard), 101, '×1 stays bit-identical');
  const giant = applyHarborModifier(hard, { type: 'riesenGooby', scale: 1.6, hitboxMult: 1.3 });
  assert.equal(giant.CRATE_RADIUS, hard.CRATE_RADIUS * 1.3);
  assert.equal(giant.RING_RADIUS, hard.RING_RADIUS * 1.3);
  assert.equal(giant.RENDER_SCALE_MULT, 1.6);
  assert.equal(giant.BUOY_RADIUS, hard.BUOY_RADIUS, 'bump hitbox NEVER grows');
  assert.strictEqual(applyHarborModifier(hard, null), hard, 'no modifier = no-op');
  assert.strictEqual(applyHarborModifier(hard, { type: 'doppelGold' }), hard, 'payout-only = no-op');
});

test('V4/G74 harbor §G5.4: Endlos skips the timer and ends on the 3rd bump', () => {
  const endless = applyHarborDifficulty(HARBOR, 'endless');
  // no timer end in Endlos (Schwer keeps its 120 s round)
  const quiet = {
    ...endless, CRATE_CHANCE: 0, RING_CHANCE: 0, BUOY_CHANCE: 0,
    PIER_EVERY_M: Object.freeze({ min: 1e9, max: 1e9 }),
  };
  const eng = createHarborEngine(mulberry32(1), quiet);
  eng.state.elapsed = HARBOR.DURATION_SEC + 5;
  eng.step({ targetX: null }, 1 / 60);
  assert.equal(eng.state.ended, false, 'Endlos has no round timer');
  const hardEng = createHarborEngine(mulberry32(1), applyHarborDifficulty(HARBOR, 'hard'));
  hardEng.state.elapsed = HARBOR.DURATION_SEC + 5;
  const hardEvs = hardEng.step({ targetX: null }, 1 / 60);
  assert.equal(hardEng.state.ended, true);
  assert.ok(hardEvs.some((e) => e.type === 'ended'));
  // 3 bumps end the Endlos run (buoys planted straight on the bow)
  for (let i = 1; i <= 3; i += 1) {
    eng.state.iframesT = 0;
    eng.items.push({ type: 'buoy', x: eng.state.x, z: eng.state.z + 0.4, gone: false });
    const evs = eng.step({ targetX: null }, 1 / 60);
    assert.equal(eng.state.bumps, i, `bump ${i} lands`);
    if (i < 3) {
      assert.equal(eng.state.ended, false);
    } else {
      assert.equal(eng.state.ended, true, '3rd bump ends the Endlos run');
      assert.ok(evs.some((e) => e.type === 'ended' && e.reason === 'bumps'));
    }
  }
  // …but 3 bumps do NOT end a Schwer round (§G5.3: crash allowance unchanged)
  const hardEng2 = createHarborEngine(mulberry32(2), { ...applyHarborDifficulty(HARBOR, 'hard'), CRATE_CHANCE: 0, RING_CHANCE: 0, BUOY_CHANCE: 0, PIER_EVERY_M: Object.freeze({ min: 1e9, max: 1e9 }) });
  for (let i = 1; i <= 3; i += 1) {
    hardEng2.state.iframesT = 0;
    hardEng2.items.push({ type: 'buoy', x: hardEng2.state.x, z: hardEng2.state.z + 0.4, gone: false });
    hardEng2.step({ targetX: null }, 1 / 60);
  }
  assert.equal(hardEng2.state.bumps, 3);
  assert.equal(hardEng2.state.ended, false);
});

test('V4/G74 harbor §G5.4: Schwer target 110 ≥ 1/5 seeds, means monotone, Endlos 3 bumps', () => {
  const hard5 = CERT_HARD_SEEDS.map((s) => simulateHarborAutoplay('hard', s).score);
  assert.ok(hard5.some((s) => s >= 110), `Schwer target 110 missed: ${hard5}`);
  const m = {};
  for (const mode of ['easy', 'normal', 'hard']) {
    m[mode] = meanOf(CERT_MEAN_SEEDS.map((s) => simulateHarborAutoplay(mode, s).score));
  }
  assert.ok(m.easy >= m.normal, `easy ${m.easy} < normal ${m.normal}`);
  assert.ok(m.normal >= m.hard, `normal ${m.normal} < hard ${m.hard}`);
  assert.equal(simulateHarborAutoplay('hard', 11).score, hard5[0], 'deterministic');
  const endless = simulateHarborAutoplay('endless', 1);
  assert.equal(endless.bumps, 3, 'Endlos terminates through the bump counter');
  assert.ok(Number.isFinite(endless.score) && endless.score >= 0);
  // the sim's modifier seam: muenzregen visibly raises the pickup haul
  const plain = simulateHarborAutoplay('hard', 7);
  const rained = simulateHarborAutoplay('hard', 7, 900, { type: 'muenzregen', coinRate: 1.5 });
  assert.ok(
    rained.crates + rained.rings > plain.crates + plain.rings,
    `muenzregen haul ${rained.crates + rained.rings} > plain ${plain.crates + plain.rings}`
  );
});
