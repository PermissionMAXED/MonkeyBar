// purblePlace — Cake Shop / Tortenwerkstatt (PLAN3 §C9, agent V3/G36): pure
// logic tests against purblePlace.logic.js (imports no three.js/DOM — §B
// rule). §C9.7 scope: seeded ticket generator + difficulty weighting,
// match/scoring matrix (all 0/1/≥2-wrong cases), patience/ramp math,
// belt-window hit test, oven meter zones, engine determinism, and the
// autoplay bot averaging ≥ 90 over 20 seeded logic-level rounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CAKE,
  SHAPES,
  SPONGES,
  SPONGE_HEX,
  ICINGS,
  ICING_HEX,
  TOPPINGS,
  STATIONS,
  STATION_S,
  patienceFor,
  orderIntervalAt,
  beltSpeedMultAt,
  beltSpeedAt,
  stationWindowHalfM,
  inStationWindow,
  bakeResultAt,
  bakePoints,
  makeTicket,
  wrongCount,
  serveOutcome,
  scoreServe,
  bestTicketIndex,
  fixableDeficit,
  shouldLoop,
  createEngine,
  createBot,
  mulberry32,
  simulateRound,
  BOT,
} from '../src/minigames/games/purblePlace.logic.js';
import { COIN_TABLE, UNLOCKS, MINIGAME } from '../src/data/constants.js';
import { getMinigame, computeCoins } from '../src/data/minigames.js';
import { EN, DE } from '../src/data/strings.js';
import { EN as CAKE_EN, DE as CAKE_DE } from '../src/data/strings/v3-cake.js';
import { SFX_MAP } from '../src/audio/sfxMap.js';

// ---------------------------------------------------------------------------
// purity: the logic sibling must not import three.js/DOM (§B rule)
// ---------------------------------------------------------------------------

test('V3/G36 purblePlace.logic.js imports no three.js/DOM', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/minigames/games/purblePlace.logic.js', import.meta.url)),
    'utf8'
  );
  assert.ok(!/from\s+['"]three['"]/.test(src), 'logic imports three');
  assert.ok(!/document\.|window\./.test(src), 'logic touches the DOM');
});

// ---------------------------------------------------------------------------
// §C9 binding numbers — verbatim
// ---------------------------------------------------------------------------

test('purblePlace: §C9 binding numbers verbatim', () => {
  assert.equal(CAKE.DURATION_SEC, 210); // §C9.4 round
  assert.equal(CAKE.MAX_TICKETS, 3); // §C9.2 max parallel
  assert.equal(CAKE.PATIENCE_START_SEC, 45); // §C9.2
  assert.equal(CAKE.PATIENCE_STEP_SEC, 1.5);
  assert.equal(CAKE.PATIENCE_FLOOR_SEC, 30);
  assert.equal(CAKE.EXPIRE_PTS, -5);
  assert.equal(CAKE.BELT_SPEED, 0.55); // §C9.3 conveyor
  assert.equal(CAKE.BELT_LENGTH_M, 6);
  assert.equal(CAKE.STATION_WINDOW_SEC, 0.9);
  assert.equal(CAKE.OVEN_METER_SEC, 3); // §C9.3 Ofen
  assert.equal(CAKE.OVEN_GREEN_FRAC, 0.25);
  assert.equal(CAKE.BAKE_PERFECT_PTS, 5);
  assert.equal(CAKE.BAKE_SINGED_PTS, -3);
  assert.equal(CAKE.PERFECT_PTS, 20); // §C9.4 scoring
  assert.equal(CAKE.ONE_WRONG_PTS, 8);
  assert.equal(CAKE.REJECT_PTS, -5);
  assert.equal(CAKE.COMBO_STEP, 2);
  assert.equal(CAKE.COMBO_CAP, 10);
  assert.equal(CAKE.SPEED_BONUS_PTS, 4);
  assert.equal(CAKE.SPEED_BONUS_MIN_FRAC, 0.5);
  assert.equal(CAKE.ORDER_INTERVAL_START_SEC, 30); // §C9.4 ramp
  assert.equal(CAKE.ORDER_INTERVAL_STEP_SEC, 2);
  assert.equal(CAKE.ORDER_INTERVAL_MIN_SEC, 14);
  assert.equal(CAKE.BELT_RAMP_PCT, 0.06);
  assert.equal(CAKE.BELT_RAMP_EVERY_SERVES, 3);
  assert.equal(CAKE.BELT_RAMP_CAP_PCT, 0.24);
  assert.equal(CAKE.COMPLEX_AFTER_SERVES, 4);
  assert.equal(CAKE.MAX_CANDLES, 4); // §C9.2 candles 0–4
});

test('purblePlace: ticket dimensions + §C9.2 hexes verbatim', () => {
  assert.deepEqual([...SHAPES], ['round', 'square', 'heart']);
  assert.deepEqual([...SPONGES], ['vanilla', 'chocolate', 'strawberry']);
  assert.equal(SPONGE_HEX.vanilla, '#F5E6C8');
  assert.equal(SPONGE_HEX.chocolate, '#6B4A2F');
  assert.equal(SPONGE_HEX.strawberry, '#F2B8C6');
  assert.equal(ICINGS.length, 4); // 4 incl. none
  assert.ok(ICINGS.includes('none'));
  assert.equal(TOPPINGS.length, 4); // 4 incl. none
  assert.ok(TOPPINGS.includes('none'));
  assert.ok(ICING_HEX.white && ICING_HEX.pink && ICING_HEX.chocolate);
  assert.deepEqual([...STATIONS], ['form', 'teig', 'ofen', 'guss', 'deko', 'kerzen']); // §C9.3 order
  // station belt positions are ordered and inside the 6 m belt
  const xs = [STATION_S.teig, STATION_S.ofen, STATION_S.guss, STATION_S.deko, STATION_S.kerzen];
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] > xs[i - 1]);
  assert.ok(xs[0] > 0 && xs[xs.length - 1] < CAKE.BELT_LENGTH_M);
});

test('purblePlace: §C9.5 coin row 5/5/30, unlock L6, energy 8', () => {
  assert.deepEqual(COIN_TABLE.purblePlace, { divisor: 5, min: 5, max: 30 });
  assert.equal(UNLOCKS.MINIGAMES.purblePlace, 6);
  const meta = getMinigame('purblePlace');
  assert.equal(meta.minLevel, 6);
  assert.equal(meta.energyCost, MINIGAME.ENERGY_COST);
  assert.equal(meta.energyCost, 8);
  // §C9.4 typical 120–150 → ≈ 26 c
  assert.equal(computeCoins(meta.coinTable, 130, false), 26);
  assert.equal(computeCoins(meta.coinTable, 150, false), 30);
  assert.equal(computeCoins(meta.coinTable, 999, false), 30); // clamp max
  assert.equal(computeCoins(meta.coinTable, 0, false), 5); // clamp min
  assert.equal(computeCoins(meta.coinTable, 130, true), 52); // daily ×2 after clamp
});

// ---------------------------------------------------------------------------
// patience / ramp math (§C9.2/§C9.4)
// ---------------------------------------------------------------------------

test('purblePlace: patience 45 → −1.5/serve, floor 30', () => {
  assert.equal(patienceFor(0), 45);
  assert.equal(patienceFor(1), 43.5);
  assert.equal(patienceFor(4), 39);
  assert.equal(patienceFor(10), 30);
  assert.equal(patienceFor(50), 30);
});

test('purblePlace: order interval 30 → −2/serve, floor 14', () => {
  assert.equal(orderIntervalAt(0), 30);
  assert.equal(orderIntervalAt(1), 28);
  assert.equal(orderIntervalAt(8), 14);
  assert.equal(orderIntervalAt(100), 14);
});

test('purblePlace: belt +6 % per 3 serves, cap +24 %', () => {
  assert.equal(beltSpeedMultAt(0), 1);
  assert.equal(beltSpeedMultAt(2), 1);
  assert.equal(beltSpeedMultAt(3), 1.06);
  assert.equal(beltSpeedMultAt(6), 1.12);
  assert.equal(beltSpeedMultAt(11), 1.18);
  assert.equal(beltSpeedMultAt(12), 1.24);
  assert.equal(beltSpeedMultAt(999), 1.24);
  assert.ok(Math.abs(beltSpeedAt(0) - 0.55) < 1e-12);
  assert.ok(Math.abs(beltSpeedAt(12) - 0.55 * 1.24) < 1e-12);
});

// ---------------------------------------------------------------------------
// belt-window hit test (§C9.3: 0.9 s at base speed, spatial)
// ---------------------------------------------------------------------------

test('purblePlace: station window = 0.9 s of base belt, hit test boundaries', () => {
  const half = stationWindowHalfM();
  assert.ok(Math.abs(half - (0.55 * 0.9) / 2) < 1e-12); // 0.2475 m
  const st = STATION_S.teig;
  assert.ok(inStationWindow(st, st));
  assert.ok(inStationWindow(st - half, st)); // inclusive edges
  assert.ok(inStationWindow(st + half, st));
  assert.ok(!inStationWindow(st - half - 0.001, st));
  assert.ok(!inStationWindow(st + half + 0.001, st));
});

// ---------------------------------------------------------------------------
// oven meter (§C9.3: 3 s, green zone last 25 %, +5 / ±0 / −3)
// ---------------------------------------------------------------------------

test('purblePlace: oven meter zones + points', () => {
  assert.equal(bakeResultAt(0), 'pale');
  assert.equal(bakeResultAt(2.24), 'pale'); // just before the green zone
  assert.equal(bakeResultAt(2.25), 'perfect'); // green zone starts at 75 %
  assert.equal(bakeResultAt(2.99), 'perfect');
  assert.equal(bakeResultAt(3), 'singed'); // meter ran out
  assert.equal(bakeResultAt(9), 'singed');
  assert.equal(bakePoints('perfect'), 5);
  assert.equal(bakePoints('pale'), 0);
  assert.equal(bakePoints('singed'), -3);
});

// ---------------------------------------------------------------------------
// seeded ticket generator + §C9.4 difficulty weighting
// ---------------------------------------------------------------------------

test('purblePlace: makeTicket is seeded-deterministic and in-domain', () => {
  const a = [];
  const b = [];
  const rngA = mulberry32(7);
  const rngB = mulberry32(7);
  for (let i = 0; i < 50; i += 1) {
    a.push(makeTicket(rngA, i));
    b.push(makeTicket(rngB, i));
  }
  assert.deepEqual(a, b);
  for (const tk of a) {
    assert.ok(SHAPES.includes(tk.shape));
    assert.ok(SPONGES.includes(tk.sponge));
    assert.ok(ICINGS.includes(tk.icing));
    assert.ok(TOPPINGS.includes(tk.topping));
    assert.ok(Number.isInteger(tk.candles) && tk.candles >= 0 && tk.candles <= 4);
  }
});

test('purblePlace: candles ≥3 and none-icing only after serve #4 (§C9.4)', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 1000; i += 1) {
    const tk = makeTicket(rng, 3); // still simple
    assert.ok(tk.icing !== 'none', 'none-icing before serve #4');
    assert.ok(tk.candles <= 2, 'candles ≥3 before serve #4');
  }
  let sawNone = false;
  let sawManyCandles = false;
  const rng2 = mulberry32(43);
  for (let i = 0; i < 1000; i += 1) {
    const tk = makeTicket(rng2, 4); // complex space open
    if (tk.icing === 'none') sawNone = true;
    if (tk.candles >= 3) sawManyCandles = true;
  }
  assert.ok(sawNone, 'none-icing never appears after serve #4');
  assert.ok(sawManyCandles, 'candles ≥3 never appear after serve #4');
});

// ---------------------------------------------------------------------------
// match / scoring matrix (§C9.4 — all 0 / 1 / ≥2-wrong cases)
// ---------------------------------------------------------------------------

const TICKET = Object.freeze({
  shape: 'heart', sponge: 'chocolate', icing: 'pink', topping: 'cherry', candles: 2,
});
const perfectCake = () => ({
  shape: 'heart', sponge: 'chocolate', bake: 'perfect', icing: 'pink', topping: 'cherry', candles: 2,
});

test('purblePlace: wrongCount over every single dimension', () => {
  assert.equal(wrongCount(perfectCake(), TICKET), 0);
  assert.equal(wrongCount({ ...perfectCake(), shape: 'round' }, TICKET), 1);
  assert.equal(wrongCount({ ...perfectCake(), sponge: 'vanilla' }, TICKET), 1);
  assert.equal(wrongCount({ ...perfectCake(), sponge: null }, TICKET), 1); // empty ≠ wanted
  assert.equal(wrongCount({ ...perfectCake(), icing: 'white' }, TICKET), 1);
  assert.equal(wrongCount({ ...perfectCake(), icing: null }, TICKET), 1); // empty = 'none' ≠ pink
  assert.equal(wrongCount({ ...perfectCake(), topping: 'berries' }, TICKET), 1);
  assert.equal(wrongCount({ ...perfectCake(), candles: 3 }, TICKET), 1);
  assert.equal(wrongCount({ ...perfectCake(), candles: 0 }, TICKET), 1);
  assert.equal(wrongCount({ ...perfectCake(), shape: 'round', sponge: 'vanilla' }, TICKET), 2);
  const emptyPan = { shape: 'heart', sponge: null, bake: null, icing: null, topping: null, candles: 0 };
  assert.equal(wrongCount(emptyPan, TICKET), 4); // sponge+icing+topping+candles
  // empty icing/topping MATCH a none-ticket (§C9.2 'none' is a real value)
  const noneTicket = { shape: 'round', sponge: 'vanilla', icing: 'none', topping: 'none', candles: 0 };
  const bareCake = { shape: 'round', sponge: 'vanilla', bake: 'pale', icing: null, topping: null, candles: 0 };
  assert.equal(wrongCount(bareCake, noneTicket), 0);
});

test('purblePlace: serve outcomes 0/1/≥2 wrong (§C9.4)', () => {
  assert.equal(serveOutcome(0), 'perfect');
  assert.equal(serveOutcome(1), 'oneWrong');
  assert.equal(serveOutcome(2), 'rejected');
  assert.equal(serveOutcome(5), 'rejected');
});

test('purblePlace: scoreServe matrix — base / combo / speed exact', () => {
  // perfect, no combo, slow serve: +20 flat
  let r = scoreServe({ wrong: 0, combo: 0, patienceFrac: 0.2 });
  assert.deepEqual(
    [r.outcome, r.base, r.comboBonus, r.speedBonus, r.points, r.comboAfter],
    ['perfect', 20, 0, 0, 20, 1]
  );
  // perfect, 3-streak, fast: 20 + 6 + 4
  r = scoreServe({ wrong: 0, combo: 3, patienceFrac: 0.5 });
  assert.deepEqual([r.base, r.comboBonus, r.speedBonus, r.points, r.comboAfter], [20, 6, 4, 30, 4]);
  // combo cap +10 (§C9.4)
  r = scoreServe({ wrong: 0, combo: 5, patienceFrac: 0 });
  assert.equal(r.comboBonus, 10);
  r = scoreServe({ wrong: 0, combo: 9, patienceFrac: 0 });
  assert.equal(r.comboBonus, 10);
  // one wrong: +8 base, still earns combo/speed
  r = scoreServe({ wrong: 1, combo: 2, patienceFrac: 0.8 });
  assert.deepEqual([r.outcome, r.base, r.comboBonus, r.speedBonus, r.points, r.comboAfter], ['oneWrong', 8, 4, 4, 16, 3]);
  // rejected: −5 flat, NO combo/speed, streak resets
  r = scoreServe({ wrong: 2, combo: 5, patienceFrac: 1 });
  assert.deepEqual([r.outcome, r.base, r.comboBonus, r.speedBonus, r.points, r.comboAfter], ['rejected', -5, 0, 0, -5, 0]);
  // speed bonus boundary: ≥ 50 % patience left (§C9.4)
  assert.equal(scoreServe({ wrong: 0, combo: 0, patienceFrac: 0.49 }).speedBonus, 0);
  assert.equal(scoreServe({ wrong: 0, combo: 0, patienceFrac: 0.5 }).speedBonus, 4);
});

test('purblePlace: bestTicketIndex — fewest wrong, urgency tie-break', () => {
  const cake = perfectCake();
  const tickets = [
    { spec: { ...TICKET, shape: 'round' }, remain: 5 }, // 1 wrong
    { spec: TICKET, remain: 40 }, // 0 wrong
    { spec: { ...TICKET }, remain: 12 }, // 0 wrong, more urgent
  ];
  assert.equal(bestTicketIndex(cake, tickets), 2);
  assert.equal(bestTicketIndex(cake, []), -1);
});

test('purblePlace: fix-loop policy — one pass, only for fixable empties', () => {
  const spec = TICKET;
  const missing = { shape: 'heart', sponge: null, bake: 'pale', icing: null, topping: null, candles: 0, looped: false };
  assert.ok(fixableDeficit(missing, spec));
  assert.ok(shouldLoop(missing, [{ spec, remain: 10 }]));
  // already looped → serve regardless (belt loops ONCE §C9.3)
  assert.ok(!shouldLoop({ ...missing, looped: true }, [{ spec, remain: 10 }]));
  // complete but WRONG components are not fixable → no loop
  const wrongCake = { ...perfectCake(), sponge: 'vanilla', looped: false };
  assert.ok(!fixableDeficit(wrongCake, spec));
  assert.ok(!shouldLoop(wrongCake, [{ spec, remain: 10 }]));
  // candles short = fixable
  assert.ok(fixableDeficit({ ...perfectCake(), candles: 1 }, spec));
  // no open tickets → never serve into the void
  assert.ok(shouldLoop({ ...perfectCake(), looped: true }, []));
});

// ---------------------------------------------------------------------------
// engine integration (deterministic, oven auto-singe, tap gating)
// ---------------------------------------------------------------------------

/** Step an engine until pred() or timeout; returns elapsed. */
function stepUntil(engine, pred, capSec = 60) {
  const dt = 1 / 30;
  let t = 0;
  while (t < capSec && !pred()) {
    engine.step(dt);
    t += dt;
  }
  return t;
}

test('purblePlace: engine — order lands immediately, pan spawns, teig gating', () => {
  const engine = createEngine(mulberry32(5));
  engine.step(1 / 30);
  assert.equal(engine.state.tickets.length, 1); // first order at t≈0
  stepUntil(engine, () => engine.state.cakes.length > 0, 5);
  assert.equal(engine.state.cakes.length, 1);
  const cake = engine.state.cakes[0];
  assert.ok(cake.s < 0.05); // fresh pan (may already ride one belt frame)
  // teig tap outside the window is refused
  assert.equal(engine.tapStation('teig', 'vanilla').ok, false);
  stepUntil(engine, () => inStationWindow(cake.s, STATION_S.teig), 10);
  assert.equal(engine.tapStation('teig', 'vanilla').ok, true);
  assert.equal(cake.sponge, 'vanilla');
  // slot filled — second tap refused
  assert.equal(engine.tapStation('teig', 'chocolate').ok, false);
});

test('purblePlace: engine — oven catches, green-zone +5, auto-singe −3', () => {
  // perfect bake path
  let engine = createEngine(mulberry32(9));
  stepUntil(engine, () => engine.state.cakes.some((c) => c.inOven), 30);
  let cake = engine.state.cakes.find((c) => c.inOven);
  const scoreBefore = engine.state.score;
  stepUntil(engine, () => cake.ovenT >= 2.3, 5);
  const r = engine.tapStation('ofen');
  assert.equal(r.result, 'perfect');
  assert.equal(r.points, 5);
  assert.equal(cake.bake, 'perfect');
  assert.equal(engine.state.score, scoreBefore + 5);
  // auto-singe path (nobody taps): late = singed −3 (§C9.3)
  engine = createEngine(mulberry32(9));
  stepUntil(engine, () => engine.state.cakes.some((c) => c.inOven), 30);
  cake = engine.state.cakes.find((c) => c.inOven);
  engine.drainEvents();
  stepUntil(engine, () => cake.bake != null, 5);
  assert.equal(cake.bake, 'singed');
  const bake = engine.drainEvents().find((e) => e.type === 'bake');
  assert.equal(bake.result, 'singed');
  assert.equal(bake.points, -3);
});

test('purblePlace: engine is deterministic under a fixed seed', () => {
  const run = () => {
    const engine = createEngine(mulberry32(77));
    const bot = createBot(mulberry32(77 ^ 0x9e3779b9));
    const dt = 1 / 30;
    for (let t = 0; t < 90; t += dt) {
      engine.step(dt);
      for (const tap of bot.plan(engine, dt)) engine.tapStation(tap.station, tap.value);
    }
    const s = engine.state;
    return [s.score, s.cakesServed, s.perfectCakes, s.rejected, s.expired].join('|');
  };
  assert.equal(run(), run());
});

// ---------------------------------------------------------------------------
// §C9.7 bot bar: average ≥ 90 over 20 seeded rounds + solvability of the
// ticket stream (a competent player keeps expiries near zero)
// ---------------------------------------------------------------------------

test('purblePlace: bot averages ≥ 90 over 20 seeded rounds (§C9.7)', () => {
  let total = 0;
  let expired = 0;
  let serves = 0;
  const meta = getMinigame('purblePlace');
  for (let seed = 1; seed <= 20; seed += 1) {
    const r = simulateRound(seed);
    total += r.score;
    expired += r.expired;
    serves += r.serves;
    // meta counter fields present + coherent (§C9.5 meta contract)
    assert.ok(r.cakesServed >= 0 && r.perfectCakes <= r.cakesServed && r.rejected <= r.cakesServed);
    // every payout inside the §C9.5 row
    const coins = computeCoins(meta.coinTable, r.score, false);
    assert.ok(coins >= 5 && coins <= 30, `payout ${coins} outside row`);
  }
  const avg = total / 20;
  assert.ok(avg >= 90, `bot average ${avg.toFixed(1)} < 90`);
  // solvability: the seeded ticket streams are serveable — expiries stay rare
  assert.ok(expired <= serves * 0.1, `expiries ${expired} vs serves ${serves}`);
  assert.ok(serves >= 20 * 5, `too few serves (${serves}) — stream starved`);
});

test('purblePlace: BOT error model stays a bounded human-ish profile', () => {
  for (const k of ['MISS_CHANCE', 'WRONG_CHANCE', 'SHAPE_WRONG_CHANCE', 'OVEN_EARLY_CHANCE', 'OVEN_LATE_CHANCE', 'CANDLE_SHORT_CHANCE']) {
    assert.ok(BOT[k] >= 0 && BOT[k] < 0.6, `${k} out of band`);
  }
});

// ---------------------------------------------------------------------------
// strings (EN+DE, §E0.1-2 module) + sfx ids mapped
// ---------------------------------------------------------------------------

test('purblePlace: v3-cake strings — every key in BOTH EN and DE, spread live', () => {
  const enKeys = Object.keys(CAKE_EN).sort();
  const deKeys = Object.keys(CAKE_DE).sort();
  assert.deepEqual(enKeys, deKeys);
  assert.ok(enKeys.length >= 15);
  for (const key of enKeys) {
    assert.ok(EN[key], `EN spread missing ${key}`);
    assert.ok(DE[key], `DE spread missing ${key}`);
  }
  assert.equal(DE['mg.cake.st.ofen'], 'Ofen');
  assert.equal(EN['mg.title.purblePlace'], 'Cake Shop'); // v3-core (G34)
  assert.equal(DE['mg.title.purblePlace'], 'Tortenwerkstatt');
});

test('purblePlace: V3/G36 sfx ids are mapped (samples/known recipes only)', () => {
  for (const id of ['cake.apply', 'cake.ovenDing', 'cake.serve', 'cake.candle', 'cake.order', 'cake.splat']) {
    const def = SFX_MAP[id];
    assert.ok(def, `sfxMap missing ${id}`);
    assert.ok(def.kind === 'sample' || def.kind === 'synth');
  }
  // splat rides the EXISTING synth recipe (chop.junk precedent — §E0.1-4)
  assert.equal(SFX_MAP['cake.splat'].kind, 'synth');
  assert.equal(SFX_MAP['cake.splat'].name, SFX_MAP['chop.junk'].name);
});
