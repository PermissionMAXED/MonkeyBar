// gamesV3a — toyRacer + ghostHunt (PLAN3 §C10.1 #1/#2, agent V3/G41): pure
// logic tests against the two .logic.js siblings (they import no three.js/
// DOM — §B8 rule, pinned below). Coverage per the §E G41 block: seeded
// track/layout determinism, AI rubber-band bounds, drift/boost math, item
// tables; ghost spawn/decoy tables, chain math, boo-wave scheduling, the
// bot ignoring decoys; and BOTH bots hitting their §C10.1 typical scores
// over 20 seeded runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  RACER,
  RACER_DIFFICULTY,
  applyDifficulty as applyRacerDifficulty,
  applyModifier as applyRacerModifier,
  simulateRacerAutoplay,
  TEMPLATES,
  PIECE_LIB,
  buildTrack,
  pointAt,
  computeRubber,
  rollItem,
  raceScore,
  createRace,
  stepRace,
  botInput,
  runScore,
  runMeta as racerMeta,
  playerLap,
  cornerZoneAt,
} from '../src/minigames/games/toyRacer.logic.js';
import {
  HUNT,
  HUNT_DIFFICULTY,
  applyDifficulty as applyHuntDifficulty,
  simulateHuntAutoplay,
  SPOTS,
  DECOY_SPOTS,
  visibleDurAt,
  spawnIntervalAt,
  decoyChanceAt,
  chainBonus,
  booWaveTimes,
  createHunt,
  stepHunt,
  tapHunt,
  botStep,
  huntScore,
  runMeta as huntMeta,
} from '../src/minigames/games/ghostHunt.logic.js';

// ---------------------------------------------------------------- purity §B8
test('gamesV3a: both logic modules import no three.js/DOM (§B8)', () => {
  for (const name of ['toyRacer', 'ghostHunt']) {
    const src = readFileSync(
      fileURLToPath(new URL(`../src/minigames/games/${name}.logic.js`, import.meta.url)),
      'utf8'
    );
    assert.ok(!/from\s+['"]three['"]/.test(src), `${name}.logic.js must not import three`);
    assert.ok(!/\bdocument\.|\bwindow\./.test(src), `${name}.logic.js must not touch the DOM`);
  }
});

// ============================== toyRacer (§C10.1 #1) ==============================

test('toyRacer: §C10.1 binding numbers', () => {
  assert.equal(RACER.LAPS, 3);
  assert.equal(RACER.KARTS, 4); // player + 3 rubber-band AI
  assert.equal(RACER.PIECES_PER_LOOP, 8);
  assert.equal(RACER.DRIFT_BOOST_SEC, 1.2); // release = boost 1.2 s
  assert.equal(RACER.OFFTRACK_MULT, 0.6); //  off-track = 40 % slow
  assert.deepEqual([...RACER.POSITION_BONUS], [120, 80, 50, 30]);
  assert.equal(RACER.OVERTAKE_POINTS, 2);
  assert.equal(RACER.DRIFT_METERS_DIV, 10);
  assert.deepEqual([...RACER.ITEM_KINDS], ['turbo', 'shield', 'block']);
  assert.equal(RACER.ITEM_ROW_FRACTIONS.length, 3); // boxes every ~⅓ lap
  assert.equal(RACER.BOT_DRIFT_MIN_DEG, 45); //      bot drifts corners > 45°
  // exactly 2 layout templates × 8 pieces (§C10.1)
  assert.equal(TEMPLATES.length, 2);
  for (const tpl of TEMPLATES) assert.equal(tpl.pieces.length, RACER.PIECES_PER_LOOP);
  // every referenced piece exists in the library with a committed §D5 model
  for (const tpl of TEMPLATES) {
    for (const type of tpl.pieces) assert.ok(PIECE_LIB[type]?.model, `piece ${type}`);
  }
});

test('toyRacer: seeded track is deterministic and closes the loop', () => {
  for (const seed of [1, 2, 7, 11]) {
    const a = buildTrack(seed);
    const b = buildTrack(seed);
    assert.equal(a.templateId, b.templateId);
    assert.equal(a.lapLen, b.lapLen);
    assert.deepEqual(a.samples[10].p, b.samples[10].p);
    // closed loop: s = lapLen wraps back to the start point
    const p0 = pointAt(a, 0).p;
    const p1 = pointAt(a, a.lapLen).p;
    for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(p0[i] - p1[i]) < 0.5, `closure axis ${i}`);
    // tangent/right/up are unit vectors everywhere we sample
    for (const s of [0, a.lapLen * 0.33, a.lapLen * 0.77]) {
      const smp = pointAt(a, s);
      for (const v of [smp.t, smp.up, smp.right]) {
        assert.ok(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-6);
      }
    }
  }
});

test('toyRacer: seeds reach both templates and the bump variant', () => {
  const seen = new Set();
  let bumps = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const track = buildTrack(seed);
    seen.add(track.templateId);
    if (track.hasBumps) bumps += 1;
  }
  assert.ok(seen.has('rugRing') && seen.has('loopBoulevard'), [...seen].join(','));
  assert.ok(bumps > 0 && bumps < 60, `bump variant should vary (got ${bumps}/60)`);
});

test('toyRacer: item rows sit every ~⅓ lap, off the vertical loop', () => {
  for (const seed of [1, 3, 5, 8, 13]) {
    const track = buildTrack(seed);
    assert.equal(track.itemRows.length, 3);
    for (const row of track.itemRows) {
      assert.equal(row.boxes.length, 3);
      for (const z of track.loopZones) {
        assert.ok(row.s <= z.s0 - 1 || row.s >= z.s1 + 0.5, 'row inside a loop piece');
      }
    }
  }
});

test('toyRacer: rubber band is clamped to the pinned §C10.1 bounds', () => {
  assert.equal(computeRubber(1000), RACER.RUBBER_MAX);
  assert.equal(computeRubber(-1000), RACER.RUBBER_MIN);
  assert.equal(computeRubber(0), 1);
  assert.ok(computeRubber(3) > 1 && computeRubber(3) <= RACER.RUBBER_MAX);
  assert.ok(computeRubber(-3) < 1 && computeRubber(-3) >= RACER.RUBBER_MIN);
});

test('toyRacer: weighted item roll matches the 0.4/0.3/0.3 table', () => {
  assert.equal(rollItem(() => 0.1), 'turbo');
  assert.equal(rollItem(() => 0.5), 'shield');
  assert.equal(rollItem(() => 0.85), 'block');
  assert.equal(rollItem(() => 0.999999), 'block');
});

test('toyRacer: §C10.1 score formula (position + 2·overtakes + drift/10)', () => {
  assert.equal(raceScore(1, 0, 0), 120);
  assert.equal(raceScore(2, 3, 57), 80 + 6 + 5);
  assert.equal(raceScore(4, 0, 9.9), 30); // floor(9.9/10) = 0
  assert.equal(raceScore(3, 10, 100), 50 + 20 + 10);
});

test('toyRacer: hold-to-drift charges on corners and pays a 1.2 s boost', () => {
  const race = createRace(3);
  const kart = race.karts[0];
  // park the player inside the first >45° corner zone so kappa is live
  const zone = race.track.cornerZones[0];
  kart.s = (zone.s0 + zone.s1) / 2;
  kart.speed = race.baseSpeed;
  for (let i = 0; i < 90; i += 1) stepRace(race, 1 / 60, { steer: 0, drifting: true, useItem: false });
  assert.ok(kart.driftCharge > RACER.DRIFT_MIN_CHARGE, `charge ${kart.driftCharge}`);
  assert.ok(kart.driftMeters > 0, 'drift meters accumulate while drifting');
  race.events.length = 0;
  stepRace(race, 1 / 60, { steer: 0, drifting: false, useItem: false }); // release
  const boost = race.events.find((e) => e.type === 'boost' && e.kart === 0);
  assert.ok(boost, 'release above min charge → boost event');
  assert.ok(kart.boostT > 0 && kart.boostT <= RACER.DRIFT_BOOST_SEC + 1e-9);
  assert.equal(kart.boostMult, RACER.DRIFT_BOOST_MULT);
  assert.equal(kart.driftCharge, 0);
});

test('toyRacer: a micro-drift below min charge pays NO boost', () => {
  const race = createRace(3);
  const kart = race.karts[0];
  kart.speed = race.baseSpeed;
  stepRace(race, 1 / 60, { steer: 0, drifting: true, useItem: false });
  assert.ok(kart.driftCharge < RACER.DRIFT_MIN_CHARGE);
  race.events.length = 0;
  stepRace(race, 1 / 60, { steer: 0, drifting: false, useItem: false });
  assert.ok(!race.events.some((e) => e.type === 'boost'), 'no boost below min charge');
});

test('toyRacer: drift boosts are the PLAYER edge — AI karts never boost', () => {
  const race = createRace(5);
  let guard = 0;
  while (!race.ended && guard < 20000) {
    stepRace(race, 1 / 30, botInput(race));
    for (const e of race.events) {
      if (e.type === 'boost') assert.equal(e.kart, 0, 'AI kart received a drift boost');
    }
    race.events.length = 0;
    guard += 1;
  }
  assert.ok(race.ended, 'race finishes');
});

test('toyRacer: items — turbo boosts, shield blocks a hit, block stuns', () => {
  const race = createRace(9);
  const player = race.karts[0];
  // turbo
  player.item = 'turbo';
  stepRace(race, 1 / 60, { steer: null, drifting: false, useItem: true });
  assert.ok(race.events.some((e) => e.type === 'turbo' && e.kart === 0));
  assert.ok(player.boostT > 0 && player.boostMult === RACER.TURBO_MULT);
  // block drop lands behind the kart
  race.events.length = 0;
  player.item = 'block';
  stepRace(race, 1 / 60, { steer: null, drifting: false, useItem: true });
  const drop = race.events.find((e) => e.type === 'blockDrop' && e.kart === 0);
  assert.ok(drop, 'blockDrop event');
  assert.equal(race.blocks.length, 1);
  // an unshielded AI kart driving into the block gets stunned
  const victim = race.karts[1];
  victim.s = ((race.blocks[0].s - 0.1) % race.track.lapLen + race.track.lapLen) % race.track.lapLen;
  victim.lateral = race.blocks[0].lat;
  victim.targetLateral = race.blocks[0].lat;
  victim.speed = race.baseSpeed;
  victim.stunT = 0;
  race.events.length = 0;
  stepRace(race, 1 / 30, { steer: null, drifting: false, useItem: false });
  assert.ok(
    race.events.some((e) => e.type === 'blockHit' && e.kart === 1) || victim.stunT > 0,
    'block stuns the kart that hits it'
  );
  assert.equal(race.blocks.length, 0, 'block is consumed by the hit');
  // shield: pops instead of a stun
  const race2 = createRace(9);
  const p2 = race2.karts[0];
  p2.item = 'shield';
  stepRace(race2, 1 / 60, { steer: null, drifting: false, useItem: true });
  assert.equal(p2.shield, true);
  race2.blocks.push({ s: (p2.s + 0.1) % race2.track.lapLen, lat: p2.lateral, by: 3 });
  race2.events.length = 0;
  stepRace(race2, 1 / 30, { steer: null, drifting: false, useItem: false });
  assert.ok(race2.events.some((e) => e.type === 'shieldPop' && e.kart === 0), 'shield pops');
  assert.equal(p2.shield, false);
  assert.equal(p2.stunT, 0, 'no stun through the shield');
});

test('toyRacer: running wide is off-track and 40 % slower (§C10.1)', () => {
  const race = createRace(4);
  const kart = race.karts[0];
  kart.speed = race.baseSpeed;
  // steer hard right past the track half-width, on a straight
  for (let i = 0; i < 240; i += 1) {
    stepRace(race, 1 / 60, { steer: RACER.LAT_HARD_MAX, drifting: false, useItem: false });
    if (kart.offTrack) break;
  }
  assert.ok(kart.offTrack, 'kart runs wide');
  assert.ok(race.events.some((e) => e.type === 'offtrack' && e.kart === 0));
  for (let i = 0; i < 120; i += 1) stepRace(race, 1 / 60, { steer: RACER.LAT_HARD_MAX, drifting: false, useItem: false });
  assert.ok(
    kart.speed < race.baseSpeed * RACER.OFFTRACK_MULT * 1.1,
    `off-track speed ${kart.speed} vs base ${race.baseSpeed}`
  );
});

test('toyRacer: overtake edges use the anti-ping-pong cooldown', () => {
  const race = createRace(6);
  const player = race.karts[0];
  const rival = race.karts[1];
  race.time = 5; // past the grid-settle guard (passes only count after 1 s)
  rival.passSign = -1; //          player currently behind
  player.progress = rival.progress + 0.5; // player just passed
  stepRace(race, 1 / 60, { steer: null, drifting: false, useItem: false });
  assert.equal(race.overtakes, 1, 'first pass counts');
  // ping-pong: fall behind and pass again inside the cooldown window
  player.progress = rival.progress - 0.5;
  stepRace(race, 1 / 60, { steer: null, drifting: false, useItem: false });
  player.progress = rival.progress + 0.5;
  stepRace(race, 1 / 60, { steer: null, drifting: false, useItem: false });
  assert.equal(race.overtakes, 1, 'repass inside the cooldown does not count');
});

test('toyRacer: rubber band keeps the pack together over a race', () => {
  const race = createRace(12);
  let guard = 0;
  while (!race.ended && guard < 20000) {
    stepRace(race, 1 / 30, botInput(race));
    race.events.length = 0;
    guard += 1;
    for (let i = 1; i < race.karts.length; i += 1) {
      const gap = Math.abs(race.karts[0].progress - race.karts[i].progress);
      assert.ok(gap < 40, `kart ${i} broke the rubber band (gap ${gap.toFixed(1)})`);
    }
  }
  assert.ok(race.ended);
});

test('toyRacer: bot hits the §C10.1 typicals over 20 seeded runs', () => {
  let scoreSum = 0;
  let timeSum = 0;
  let rankSum = 0;
  let wins = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const race = createRace(seed);
    let guard = 0;
    while (!race.ended && guard < 20000) {
      stepRace(race, 1 / 30, botInput(race));
      race.events.length = 0;
      guard += 1;
    }
    assert.ok(race.ended, `seed ${seed} finishes`);
    assert.ok(race.time < RACER.MAX_RACE_SEC, `seed ${seed} beats the safety timer`);
    assert.equal(playerLap(race), RACER.LAPS);
    const meta = racerMeta(race);
    assert.equal(meta.races, 1);
    assert.equal(meta.wins, race.finishRank === 1 ? 1 : 0);
    scoreSum += runScore(race);
    timeSum += race.time;
    rankSum += race.finishRank;
    wins += meta.wins;
  }
  const avgScore = scoreSum / 20;
  const avgTime = timeSum / 20;
  assert.ok(avgScore >= 100 && avgScore <= 170, `avg score ${avgScore}`);
  assert.ok(avgTime >= 115 && avgTime <= 175, `avg time ${avgTime} (~150 s §C10.1 row)`);
  assert.ok(rankSum / 20 <= 2.2, `avg rank ${rankSum / 20}`);
  assert.ok(wins >= 5, `bot should win a healthy share (${wins}/20)`);
});

test('toyRacer: bot drifts >45° corners and steers toward item boxes', () => {
  const race = createRace(2);
  const kart = race.karts[0];
  const zone = race.track.cornerZones.find((z) => z.turnDeg >= RACER.BOT_DRIFT_MIN_DEG);
  kart.s = (zone.s0 + zone.s1) / 2;
  assert.ok(cornerZoneAt(race.track, kart.s, 0, RACER.BOT_DRIFT_MIN_DEG), 'sits in the zone');
  assert.equal(botInput(race).drifting, true, 'bot drifts the >45° corner');
  // empty-handed just before an item row → steers to a live box lat
  const race2 = createRace(2);
  const k2 = race2.karts[0];
  const row = race2.track.itemRows[0];
  k2.s = ((row.s - 1.5) % race2.track.lapLen + race2.track.lapLen) % race2.track.lapLen;
  k2.item = null;
  const steer = botInput(race2).steer;
  assert.ok(
    row.boxes.some((b) => Math.abs(b.lat - steer) < 0.08),
    `steer ${steer} aims at a box`
  );
  // holding an item → uses it instantly (§C10.1)
  k2.item = 'turbo';
  assert.equal(botInput(race2).useItem, true);
});

// ============================== ghostHunt (§C10.1 #2) ==============================

test('ghostHunt: §C10.1 binding numbers', () => {
  assert.equal(HUNT.DURATION_SEC, 90);
  assert.equal(HUNT.VISIBLE_START_SEC, 2.2);
  assert.equal(HUNT.VISIBLE_END_SEC, 0.9);
  assert.equal(HUNT.CATCH_POINTS, 3);
  assert.equal(HUNT.CHAIN_WINDOW_SEC, 1.5);
  assert.equal(HUNT.CHAIN_BONUS_CAP, 5);
  assert.equal(HUNT.DECOY_PENALTY, -2);
  assert.equal(HUNT.BOO_EVERY_SEC, 25);
  assert.equal(HUNT.BOO_COUNT, 5);
  assert.equal(HUNT.BOO_CATCH_MIN, 4);
  assert.equal(HUNT.BOO_BONUS, 10);
  assert.equal(HUNT.LANTERN_SEC, 3);
  assert.equal(HUNT.NET_CATCHES, 3);
  assert.equal(HUNT.BOT_REACT_SEC, 0.2); // bot taps at spawn+200 ms
  assert.equal(SPOTS.length, 12);
  assert.ok(SPOTS.some((s) => s.kind === 'grave') && SPOTS.some((s) => s.kind === 'pumpkin') && SPOTS.some((s) => s.kind === 'crypt'));
  assert.equal(DECOY_SPOTS.length, 4);
});

test('ghostHunt: visibility ramps 2.2 s → 0.9 s across the round', () => {
  assert.equal(visibleDurAt(0), 2.2);
  assert.ok(Math.abs(visibleDurAt(90) - 0.9) < 1e-9);
  assert.ok(Math.abs(visibleDurAt(45) - 1.55) < 1e-9);
  let prev = visibleDurAt(0);
  for (let t = 5; t <= 90; t += 5) {
    const v = visibleDurAt(t);
    assert.ok(v <= prev, 'monotonically tightening');
    prev = v;
  }
  // spawn cadence + decoy chance ramp too
  assert.ok(spawnIntervalAt(90) < spawnIntervalAt(0));
  assert.equal(decoyChanceAt(0), HUNT.DECOY_CHANCE_START);
  assert.equal(decoyChanceAt(90), HUNT.DECOY_CHANCE_END);
});

test('ghostHunt: chain bonus is +1 per link, capped at +5', () => {
  assert.equal(chainBonus(1), 0);
  assert.equal(chainBonus(2), 1);
  assert.equal(chainBonus(6), 5);
  assert.equal(chainBonus(9), 5); // cap
  // catch values run 3,4,5,6,7,8 then stay 8
  const vals = [1, 2, 3, 4, 5, 6, 7].map((c) => HUNT.CATCH_POINTS + chainBonus(c));
  assert.deepEqual(vals, [3, 4, 5, 6, 7, 8, 8]);
});

test('ghostHunt: boo-waves land every 25 s (25/50/75)', () => {
  assert.deepEqual(booWaveTimes(), [25, 50, 75]);
});

test('ghostHunt: seeded round is deterministic (spawn/decoy/token tables)', () => {
  const runLog = (seed) => {
    const state = createHunt(seed);
    const log = [];
    while (!state.ended) {
      stepHunt(state, 1 / 30);
      for (const e of state.events) log.push(`${e.type}:${e.spot ?? e.decoy ?? e.kind ?? ''}@${state.t.toFixed(2)}`);
      state.events.length = 0;
    }
    return log.join('|');
  };
  assert.equal(runLog(7), runLog(7));
  assert.notEqual(runLog(7), runLog(8));
});

test('ghostHunt: spawner uses valid spots, never doubles up, decoys flicker', () => {
  const state = createHunt(11);
  let flickers = 0;
  let spawns = 0;
  const validSpots = new Set(SPOTS.map((s) => s.id));
  const validDecoys = new Set(DECOY_SPOTS.map((d) => d.id));
  while (!state.ended) {
    stepHunt(state, 1 / 30);
    const seen = new Set();
    for (const g of state.ghosts) {
      assert.ok(validSpots.has(g.spot), `spot ${g.spot}`);
      assert.ok(!seen.has(g.spot), 'two ghosts on one spot');
      seen.add(g.spot);
    }
    for (const e of state.events) {
      if (e.type === 'ghostSpawn') spawns += 1;
      if (e.type === 'flicker') {
        flickers += 1;
        assert.ok(validDecoys.has(e.decoy));
      }
    }
    state.events.length = 0;
  }
  assert.ok(spawns > 25, `enough peeks (${spawns})`);
  assert.ok(flickers > 2, `decoys flicker (${flickers})`);
  assert.equal(huntScore(state), 0, 'untapped round scores 0');
});

test('ghostHunt: tap math — catch +3, chain window, decoy −2 breaks it', () => {
  const state = createHunt(1);
  state.t = 10;
  state.ghosts.push({ id: 101, spot: 0, spawnT: 10, dur: 2, wave: null });
  let res = tapHunt(state, { kind: 'ghost', id: 101 });
  assert.deepEqual([res.kind, res.points, res.chain], ['ghost', 3, 1]);
  // second catch inside 1.5 s chains (+1)
  state.t = 11;
  state.ghosts.push({ id: 102, spot: 1, spawnT: 11, dur: 2, wave: null });
  res = tapHunt(state, { kind: 'ghost', id: 102 });
  assert.deepEqual([res.points, res.chain], [4, 2]);
  // a catch after the window starts a fresh chain
  state.t = 13;
  state.ghosts.push({ id: 103, spot: 2, spawnT: 13, dur: 2, wave: null });
  res = tapHunt(state, { kind: 'ghost', id: 103 });
  assert.deepEqual([res.points, res.chain], [3, 1]);
  assert.equal(state.score, 10);
  // flickering decoy: −2 and the chain resets
  state.flickers.push({ decoy: 2, startT: state.t });
  res = tapHunt(state, { kind: 'decoy', decoy: 2 });
  assert.deepEqual([res.kind, res.points], ['decoy', -2]);
  assert.equal(state.score, 8);
  assert.equal(state.chain, 0);
  // idle lantern (not flickering) is harmless
  state.chain = 3;
  res = tapHunt(state, { kind: 'decoy', decoy: 3 });
  assert.equal(res.kind, 'miss');
  assert.equal(state.chain, 3, 'idle decoy tap must not break the chain');
  // tapping the empty night fizzles the chain without a penalty
  const before = state.score;
  res = tapHunt(state, null);
  assert.equal(res.kind, 'miss');
  assert.equal(state.score, before);
  assert.equal(state.chain, 0);
  // score never drops below 0
  const state2 = createHunt(2);
  state2.flickers.push({ decoy: 0, startT: 0 });
  tapHunt(state2, { kind: 'decoy', decoy: 0 });
  assert.equal(huntScore(state2), 0);
});

test('ghostHunt: boo-wave spawns 5, ≥4 catches pay +10, 3 do not', () => {
  const state = createHunt(21);
  while (state.t < HUNT.BOO_EVERY_SEC + 0.5) {
    stepHunt(state, 1 / 30);
    state.events.length = 0;
  }
  const wave = state.ghosts.filter((g) => g.wave != null);
  assert.equal(wave.length, HUNT.BOO_COUNT, 'boo-wave puts 5 ghosts up at once');
  const before = state.score;
  for (const g of wave.slice(0, 4)) tapHunt(state, { kind: 'ghost', id: g.id });
  // let the 5th expire → wave resolves with 4/5 caught
  for (let i = 0; i < 90 && state.booActive; i += 1) {
    stepHunt(state, 1 / 30);
  }
  const bonus = state.events.find((e) => e.type === 'booBonus');
  assert.ok(bonus, '≥4 catches trigger the boo bonus');
  assert.equal(bonus.bonus, HUNT.BOO_BONUS);
  assert.equal(state.booBonuses, 1);
  assert.ok(state.score >= before + 4 * 3 + HUNT.BOO_BONUS, 'catch points + bonus land');
  // second wave: only 3 catches → no bonus
  state.events.length = 0;
  while (state.t < 2 * HUNT.BOO_EVERY_SEC + 0.5) {
    stepHunt(state, 1 / 30);
    state.events.length = 0;
  }
  const wave2 = state.ghosts.filter((g) => g.wave === 1);
  assert.equal(wave2.length, HUNT.BOO_COUNT);
  for (const g of wave2.slice(0, 3)) tapHunt(state, { kind: 'ghost', id: g.id });
  for (let i = 0; i < 90 && state.booActive; i += 1) stepHunt(state, 1 / 30);
  assert.ok(state.events.some((e) => e.type === 'booEnd' && e.caught === 3));
  assert.ok(!state.events.some((e) => e.type === 'booBonus'));
  assert.equal(state.booBonuses, 1, 'still just the first bonus');
});

test('ghostHunt: Laterne reveals + extends spawns, Netz auto-chains 3', () => {
  // tokens appear inside their §C10.1 windows and can be collected
  const state = createHunt(31);
  let lanternWindow = null;
  while (!state.ended && state.tokens.length === 0) {
    stepHunt(state, 1 / 30);
    for (const e of state.events) {
      if (e.type === 'tokenSpawn' && e.kind === 'lantern') lanternWindow = e.window;
    }
    state.events.length = 0;
  }
  assert.ok(state.tokens.length > 0, 'a token spawns');
  const token = state.tokens[0];
  const win = HUNT.TOKEN_WINDOWS[token.window];
  assert.ok(state.t >= win.from - 1e-9 && state.t <= win.to + 1, `token inside [${win.from}, ${win.to}]`);
  if (token.kind === 'lantern') assert.equal(token.window, lanternWindow);
  const res = tapHunt(state, { kind: 'token', window: token.window });
  assert.equal(res.kind, 'token');
  if (token.kind === 'lantern') {
    assert.equal(state.lanternT, HUNT.LANTERN_SEC);
  } else {
    assert.equal(state.netLeft, HUNT.NET_CATCHES);
  }
  // Laterne: ghosts spawned while lit are revealed and stay a bit longer
  const lit = createHunt(32);
  lit.t = 40;
  lit.booIdx = lit.booTimes.length; // park the boo-waves (they force durations)
  lit.lanternT = HUNT.LANTERN_SEC;
  lit.nextSpawnT = 40; // force the scheduler now
  let spawned = null;
  for (let i = 0; i < 30 && !spawned; i += 1) {
    stepHunt(lit, 1 / 30);
    spawned = lit.events.find((e) => e.type === 'ghostSpawn');
    lit.events.length = 0;
  }
  assert.ok(spawned, 'a ghost spawns under the lantern');
  assert.equal(spawned.revealed, true);
  const g = lit.ghosts.find((x) => x.id === spawned.id);
  assert.ok(
    g.dur > visibleDurAt(lit.t) - 1e-9 + HUNT.LANTERN_REVEAL_BONUS_SEC - 0.1,
    'reveal bonus extends the peek'
  );
  // Netz: a stale-window catch still chains while charges remain
  const net = createHunt(33);
  net.t = 50;
  net.chain = 2;
  net.lastCatchT = -99; // way outside the 1.5 s window
  net.netLeft = 1;
  net.ghosts.push({ id: 900, spot: 4, spawnT: 50, dur: 2, wave: null });
  const caught = tapHunt(net, { kind: 'ghost', id: 900 });
  assert.equal(caught.chain, 3, 'net auto-chains the stale catch');
  assert.equal(net.netLeft, 0);
});

test('ghostHunt: bot ignores decoys and lands the ≈90 §C10.1 typical', () => {
  let scoreSum = 0;
  let caughtSum = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const state = createHunt(seed);
    while (!state.ended) {
      stepHunt(state, 1 / 30);
      state.events.length = 0;
      for (const tap of botStep(state)) {
        assert.notEqual(tap.kind, 'decoy', 'bot must never tap decoys (§C10.1)');
        tapHunt(state, tap);
      }
    }
    assert.equal(state.decoysTapped, 0, `seed ${seed}: decoys tapped`);
    const meta = huntMeta(state);
    assert.equal(meta.ghostsCaught, state.caught);
    assert.equal(meta.decoysTapped, 0);
    scoreSum += huntScore(state);
    caughtSum += state.caught;
  }
  const avg = scoreSum / 20;
  assert.ok(avg >= 70 && avg <= 120, `avg score ${avg} (typical ≈ 90)`);
  assert.ok(caughtSum / 20 >= 14, `avg caught ${caughtSum / 20}`);
});

test('ghostHunt: the round ends exactly once at 90 s', () => {
  const state = createHunt(41);
  let endEvents = 0;
  for (let i = 0; i < 40 * 95; i += 1) {
    stepHunt(state, 1 / 40);
    endEvents += state.events.filter((e) => e.type === 'end').length;
    state.events.length = 0;
  }
  assert.ok(state.ended);
  assert.equal(endEvents, 1);
  assert.ok(state.t >= HUNT.DURATION_SEC && state.t < HUNT.DURATION_SEC + 1);
  // taps after the end are inert
  const res = tapHunt(state, { kind: 'ghost', id: 1 });
  assert.equal(res.kind, 'ended');
});

// ===========================================================================
// V4/G74 §G5 difficulty + endless + modifiers + seeded-bot certification
// (same seed protocol as test/difficultyCertification.test.js: hard gate
// seeds 11/22/33/44/55, monotone-means sample (i+1)·7919 × 10)
// ===========================================================================

const CERT_HARD_SEEDS = [11, 22, 33, 44, 55];
const CERT_MEAN_SEEDS = Array.from({ length: 10 }, (_, i) => (i + 1) * 7919);
const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('V4/G74 racer: Mittel identity, §G5.3 runner rows, guardrail band', () => {
  assert.strictEqual(applyRacerDifficulty(RACER, 'normal'), RACER, 'Mittel is identity');
  assert.strictEqual(applyRacerDifficulty(RACER, 'nonsense'), RACER, 'unknown ids fall back');
  const easy = applyRacerDifficulty(RACER, 'easy');
  const hard = applyRacerDifficulty(RACER, 'hard');
  const endless = applyRacerDifficulty(RACER, 'endless');
  // Leicht: whole field 15 % slower (longer target lap), soft AI pack
  assert.equal(easy.TARGET_LAP_SEC, RACER.TARGET_LAP_SEC / 0.85);
  assert.equal(easy.SPEED_MULT, 0.85);
  assert.equal(easy.AI_SPREAD, RACER_DIFFICULTY.easy.aiSpread);
  assert.equal(easy.AI_EDGE, RACER_DIFFICULTY.easy.aiEdge);
  assert.equal(easy.RUBBER_MAX, 1.08, 'Leicht rubber band pushes less');
  assert.equal(easy.ENDLESS, false);
  // Schwer: field 20 % faster (cornering slip ∝ v²), tight aggressive pack
  assert.equal(hard.TARGET_LAP_SEC, RACER.TARGET_LAP_SEC / 1.2);
  assert.equal(hard.SPEED_MULT, 1.2);
  assert.equal(hard.RUBBER_MIN, 0.92, 'Schwer AI never dawdles');
  assert.ok(hard.AI_EDGE > 0, 'Schwer pack personality midpoint shifts up');
  assert.equal(hard.ENDLESS, false);
  assert.equal(endless.ENDLESS, true);
  assert.equal(endless.SPEED_MULT, hard.SPEED_MULT, 'Endlos = Schwer field');
  // §G5.3 guardrail band [0.549, 2.051] on the non-bot numeric knobs
  // (same fp-tolerant bounds as difficultyEndless.test.js pins suite-wide)
  for (const [t, label] of [[easy, 'easy'], [hard, 'hard'], [endless, 'endless']]) {
    for (const key of ['TARGET_LAP_SEC', 'AI_SPREAD', 'RUBBER_MIN', 'RUBBER_MAX', 'SPEED_MULT']) {
      const ratio = t[key] / RACER[key];
      assert.ok(ratio >= 0.549 && ratio <= 2.051, `${label}.${key} ratio ${ratio}`);
    }
  }
});

test('V4/G74 racer: AI_EDGE shifts the seeded personality midpoint (0 = bit-identical)', () => {
  // AI_EDGE 0 + default spread → identical karts to the plain §C10.1 race
  const base = createRace(9);
  const same = createRace(9, { ...RACER, AI_EDGE: 0 });
  for (let i = 1; i < base.karts.length; i += 1) {
    assert.equal(same.karts[i].personality, base.karts[i].personality);
  }
  // spread 0 isolates the midpoint: personality == 1 + AI_EDGE exactly
  const edged = createRace(9, { ...RACER, AI_EDGE: 0.5, AI_SPREAD: 0 });
  for (let i = 1; i < edged.karts.length; i += 1) {
    assert.equal(edged.karts[i].personality, 1.5);
  }
});

test('V4/G74 racer: muenzregen respawns boxes sooner, turbo speeds + multiplies score', () => {
  const rain = applyRacerModifier(RACER, { type: 'muenzregen', coinRate: 1.5 });
  assert.equal(rain.ITEM_RESPAWN_SEC, RACER.ITEM_RESPAWN_SEC / 1.5, 'boxes back +50 % sooner');
  assert.equal(rain.ITEM_RATE, 1.5);
  const hard = applyRacerDifficulty(RACER, 'hard');
  const turbo = applyRacerModifier(hard, { type: 'turbo', speedMult: 1.25, scoreMult: 1.5 });
  assert.equal(turbo.TARGET_LAP_SEC, hard.TARGET_LAP_SEC / 1.25);
  assert.equal(turbo.SPEED_MULT, hard.SPEED_MULT * 1.25);
  assert.equal(turbo.SCORE_MULT, 1.5);
  assert.strictEqual(applyRacerModifier(hard, null), hard, 'no modifier = no-op');
  assert.strictEqual(applyRacerModifier(hard, { type: 'doppelGold' }), hard, 'payout-only = no-op');
  // SCORE_MULT lands at the single runScore seam (§C-SYS4.2)
  const race = createRace(3, turbo);
  race.ended = true;
  race.finishRank = 1;
  race.overtakes = 3;
  race.karts[0].driftMeters = 100;
  assert.equal(runScore(race), Math.round(raceScore(1, 3, 100, turbo) * 1.5));
});

test('V4/G74 racer §G5.4: Endlos chains top-2 finishes, banks score, ramps the pack', () => {
  const tune = applyRacerDifficulty(RACER, 'endless');
  const race = createRace(5, tune);
  const persBefore = race.karts.map((k) => k.personality);
  // hand the player a winning position: over the line, AI pack behind
  race.karts[0].progress = tune.LAPS * race.track.lapLen + 1;
  race.karts[0].driftMeters = 50;
  race.overtakes = 2;
  for (let i = 1; i < race.karts.length; i += 1) race.karts[i].progress = 1;
  stepRace(race, 1 / 60, {});
  assert.equal(race.ended, false, 'rank 1 chains instead of ending');
  assert.equal(race.chainRaces, 1);
  assert.equal(race.chainWins, 1);
  assert.equal(race.chainScore, raceScore(1, 2, 50, tune), 'finished race banked');
  assert.ok(race.events.some((e) => e.type === 'chainRace'), 'chainRace event fired');
  assert.equal(race.overtakes, 0, 'per-race counters reset');
  assert.ok(race.karts[0].progress < 0, 'karts back on the grid');
  assert.equal(race.raceStartT, race.time, 'per-race MAX_RACE_SEC clock rebased');
  for (let i = 1; i < race.karts.length; i += 1) {
    assert.ok(
      Math.abs(race.karts[i].personality - (persBefore[i] + tune.ENDLESS_CHAIN_EDGE_STEP)) < 1e-12,
      '§G5.4 uncapped ramp: pack personality climbs each chained race'
    );
  }
  // next race finishes worse than 2nd → the chain ends, banked score pays
  race.karts[0].progress = tune.LAPS * race.track.lapLen + 1;
  for (let i = 1; i < race.karts.length; i += 1) {
    race.karts[i].progress = race.karts[0].progress + 10;
  }
  stepRace(race, 1 / 60, {});
  assert.equal(race.ended, true, 'rank 4 > ENDLESS_CHAIN_MAX_RANK ends the run');
  assert.equal(race.finishRank, 4);
  const meta = racerMeta(race);
  assert.equal(meta.races, 2, 'chained races count in meta');
  assert.equal(meta.wins, 1);
  assert.ok(runScore(race) >= race.chainScore, 'banked chain score included');
  // a plain Schwer race NEVER chains (rank 1 finish just ends)
  const hardRace = createRace(5, applyRacerDifficulty(RACER, 'hard'));
  hardRace.karts[0].progress = hardRace.tune.LAPS * hardRace.track.lapLen + 1;
  for (let i = 1; i < hardRace.karts.length; i += 1) hardRace.karts[i].progress = 1;
  stepRace(hardRace, 1 / 60, {});
  assert.equal(hardRace.ended, true);
  assert.equal(hardRace.finishRank, 1);
});

test('V4/G74 racer §G5.4: Schwer target 150 ≥ 1/5 seeds, means monotone, Endlos terminates', () => {
  const hard5 = CERT_HARD_SEEDS.map((s) => simulateRacerAutoplay('hard', s).score);
  assert.ok(hard5.some((s) => s >= 150), `Schwer target 150 missed: ${hard5}`);
  const m = {};
  for (const mode of ['easy', 'normal', 'hard']) {
    m[mode] = meanOf(CERT_MEAN_SEEDS.map((s) => simulateRacerAutoplay(mode, s).score));
  }
  assert.ok(m.easy >= m.normal, `easy ${m.easy} < normal ${m.normal}`);
  assert.ok(m.normal >= m.hard, `normal ${m.normal} < hard ${m.hard}`);
  // determinism + Endlos self-termination (the §G5.4 uncapped pack ramp)
  assert.equal(simulateRacerAutoplay('hard', 11).score, hard5[0]);
  const endless = simulateRacerAutoplay('endless', 1);
  assert.ok(endless.races >= 2, `Endlos chained ${endless.races} races`);
  assert.ok(Number.isFinite(endless.score) && endless.score >= 0);
});

test('V4/G74 hunt: Mittel identity, §G5.3 timed-arena rows, 0.35 s reaction guardrail', () => {
  assert.strictEqual(applyHuntDifficulty(HUNT, 'normal'), HUNT, 'Mittel is identity');
  assert.strictEqual(applyHuntDifficulty(HUNT, 'nonsense'), HUNT, 'unknown ids fall back');
  const easy = applyHuntDifficulty(HUNT, 'easy');
  const hard = applyHuntDifficulty(HUNT, 'hard');
  const endless = applyHuntDifficulty(HUNT, 'endless');
  // §G5.3 timed-arena row pins (the single source the derivation reads)
  assert.deepEqual(
    [HUNT_DIFFICULTY.easy.interval, HUNT_DIFFICULTY.easy.windows, HUNT_DIFFICULTY.easy.duration],
    [1.2, 1.25, 1.2]
  );
  assert.deepEqual(
    [HUNT_DIFFICULTY.hard.interval, HUNT_DIFFICULTY.hard.windows, HUNT_DIFFICULTY.hard.duration],
    [0.85, 0.8, 1]
  );
  // Leicht: slower cadence ×1.2, wider windows ×1.25, +20 % round time
  assert.equal(easy.DURATION_SEC, HUNT.DURATION_SEC * 1.2);
  assert.equal(easy.SPAWN_START_SEC, HUNT.SPAWN_START_SEC * 1.2);
  assert.equal(easy.SPAWN_END_SEC, HUNT.SPAWN_END_SEC * 1.2);
  assert.equal(easy.VISIBLE_START_SEC, HUNT.VISIBLE_START_SEC * 1.25);
  assert.equal(easy.VISIBLE_END_SEC, HUNT.VISIBLE_END_SEC * 1.25);
  assert.equal(easy.ENDLESS, false);
  // Schwer: tighter cadence ×0.85, windows ×0.8, duration unchanged
  assert.equal(hard.DURATION_SEC, HUNT.DURATION_SEC);
  assert.equal(hard.SPAWN_START_SEC, HUNT.SPAWN_START_SEC * 0.85);
  assert.equal(hard.VISIBLE_START_SEC, HUNT.VISIBLE_START_SEC * 0.8);
  assert.ok(Math.abs(hard.VISIBLE_END_SEC - 0.72) < 1e-12);
  assert.equal(hard.BOO_MIN_VISIBLE_SEC, HUNT.BOO_MIN_VISIBLE_SEC * 0.8);
  // §G5.3 guardrails: min reaction window ≥ 0.35 s, window ratio ≥ 0.55
  for (const t of [easy, hard, endless]) {
    assert.ok(t.VISIBLE_END_SEC >= 0.35, 'reaction window ≥ 0.35 s');
    assert.ok(t.VISIBLE_END_SEC / HUNT.VISIBLE_END_SEC >= 0.55, 'window ≥ 55 % of Mittel');
  }
  assert.equal(endless.ENDLESS, true);
  assert.equal(endless.ENDLESS_ESCAPE_LIMIT, 3, '§G5.4: 3 escaped Boo-waves end Endlos');
  // §C-SYS4.3: ghostHunt is payout-only — the logic ships NO gameplay
  // modifier hook (framework applies coin-side effects outside the sim)
  const src = readFileSync(
    fileURLToPath(new URL('../src/minigames/games/ghostHunt.logic.js', import.meta.url)),
    'utf8'
  );
  assert.ok(!/export function applyModifier/.test(src), 'payout-only: no applyModifier');
});

test('V4/G74 hunt §G5.4: Endlos skips the 90 s timer and keeps scheduling Boo-waves', () => {
  // no round-timer end: a survivable Endlos hunt sails past DURATION_SEC
  const roomy = { ...applyHuntDifficulty(HUNT, 'endless'), ENDLESS_ESCAPE_LIMIT: 99 };
  const state = createHunt(11, roomy);
  while (state.t < 130) {
    stepHunt(state, 1 / 30);
    state.events.length = 0;
  }
  assert.equal(state.ended, false, 'no 90 s end in Endlos');
  assert.ok(state.booTimes.length > booWaveTimes(HUNT).length, 'Boo schedule keeps extending');
  assert.equal(state.booTimes[3], 100, '4th wave lands +25 s after the §C10.1 list');
  assert.ok(state.escapedWaves >= 4, 'untapped waves escape');
  // the REAL limit: 3 escaped waves end the run (untapped bot-less round)
  const real = createHunt(11, applyHuntDifficulty(HUNT, 'endless'));
  let guard = 30 * 200;
  while (!real.ended && guard > 0) {
    stepHunt(real, 1 / 30);
    real.events.length = 0;
    guard -= 1;
  }
  assert.equal(real.ended, true);
  assert.equal(real.escapedWaves, 3, 'ends exactly at the 3rd escape');
  // Schwer still ends on its timer
  const hardState = createHunt(11, applyHuntDifficulty(HUNT, 'hard'));
  hardState.t = applyHuntDifficulty(HUNT, 'hard').DURATION_SEC + 1;
  stepHunt(hardState, 1 / 30);
  assert.equal(hardState.ended, true);
});

test('V4/G74 hunt §G5.4: Schwer target 90 ≥ 1/5 seeds, means monotone, Endlos terminates', () => {
  const hard5 = CERT_HARD_SEEDS.map((s) => simulateHuntAutoplay('hard', s).score);
  assert.ok(hard5.some((s) => s >= 90), `Schwer target 90 missed: ${hard5}`);
  const m = {};
  for (const mode of ['easy', 'normal', 'hard']) {
    m[mode] = meanOf(CERT_MEAN_SEEDS.map((s) => simulateHuntAutoplay(mode, s).score));
  }
  assert.ok(m.easy >= m.normal, `easy ${m.easy} < normal ${m.normal}`);
  assert.ok(m.normal >= m.hard, `normal ${m.normal} < hard ${m.hard}`);
  assert.equal(simulateHuntAutoplay('hard', 11).score, hard5[0], 'deterministic');
  const endless = simulateHuntAutoplay('endless', 1);
  assert.equal(endless.escapedWaves, 3, 'Endlos ends through the escape counter');
  assert.ok(Number.isFinite(endless.score) && endless.score >= 0);
});
