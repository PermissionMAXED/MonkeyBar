// purblePlace — Comfy Cakes / Tortenwerkstatt (PLAN4-GAMES §G1, agent
// V4/G61): pure logic tests against the rewritten BELT-SIMULATION engine in
// purblePlace.logic.js (imports no three.js/DOM — §B rule). §G1.9 scope:
// catch-window edges (±0.24 inclusive), fall-time lead math, oven commit/
// resume/auto-singe, disallowed matrix (icing-on-raw etc.), trash, pan-cap
// schedule, serve auto-match tie-break, splat penalty, ramp invariants,
// difficulty parameter monotonicity, endless end-condition, determinism
// (same seed + input script → same events), and the bot score floor (≥ 90
// avg over 20 seeded Mittel rounds; §G5.4 Schwer target 120 on ≥ 1 of 5).
// Surviving v3 assertions (§G1.9: ticket generator, match matrix, patience/
// interval) keep their test names and assertions verbatim — the §C9.4
// scoring matrix is unchanged (§G1.8 economy equivalence).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CAKE,
  DIFFICULTY,
  applyDifficulty,
  SHAPES,
  SPONGES,
  SPONGE_HEX,
  ICINGS,
  ICING_HEX,
  TOPPINGS,
  STATIONS,
  STATION_BY_ID,
  patienceFor,
  orderIntervalAt,
  panCapAt,
  bakeResultAt,
  bakePoints,
  catchWindow,
  dropImpactS,
  makeTicket,
  wrongCount,
  serveOutcome,
  scoreServe,
  bestTicketIndex,
  createLine,
  stepLine,
  canSpawn,
  createLineBot,
  mulberry32,
  simulateRound,
  BOT,
} from '../src/minigames/games/purblePlace.logic.js';
import { COIN_TABLE, UNLOCKS, MINIGAME } from '../src/data/constants.js';
import { getMinigame, computeCoins } from '../src/data/minigames.js';
import { TARGETS, getTarget } from '../src/data/difficultyTargets.js';
import { SFX_MAP } from '../src/audio/sfxMap.js';

const DT = 1 / 30;

/** Step a line `n` frames with a fixed input, collecting events. */
function run(line, n, input = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(...stepLine(line, DT, input));
  return out;
}

/** Fresh Mittel line (seeded). */
function mkLine(difficulty = 'normal', seed = 5) {
  return createLine({ rng: mulberry32(seed), difficulty });
}

/** Poke a fully-described pan onto the line (plain data — §E8 pure state). */
function pokePan(line, fields) {
  const pan = {
    id: line.nextPanId++,
    shape: 'round',
    s: 0.15,
    sponge: null,
    bake: null,
    bakeT: 0,
    inOven: false,
    icing: null,
    topping: null,
    candles: 0,
    ...fields,
  };
  line.pans.push(pan);
  return pan;
}

/** Poke an open ticket (creation order == array order == age order). Pauses
 * the natural order flow (orderT starts at 0 → a fresh order would land in
 * the very next step and skew board-count assertions). */
function pokeTicket(line, spec, remain = 30, patience = 45) {
  const ticket = { id: line.nextTicketId++, spec, remain, patience };
  line.tickets.push(ticket);
  line.orderT = 999;
  return ticket;
}

// ---------------------------------------------------------------------------
// purity: the logic sibling must not import three.js/DOM (§B rule)
// ---------------------------------------------------------------------------

test('V4/G61 purblePlace.logic.js imports no three.js/DOM', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/minigames/games/purblePlace.logic.js', import.meta.url)),
    'utf8'
  );
  assert.ok(!/from\s+['"]three['"]/.test(src), 'logic imports three');
  assert.ok(!/document\.|window\./.test(src), 'logic touches the DOM');
});

// ---------------------------------------------------------------------------
// §G1 binding numbers — verbatim (§G1.4/§G1.5/§G1.6/§G1.8)
// ---------------------------------------------------------------------------

test('purblePlace: §G1 binding numbers verbatim', () => {
  assert.equal(CAKE.DURATION_SEC, 210); // §G1.3 round unchanged
  assert.equal(CAKE.MAX_TICKETS, 3); // §C9.2 max parallel
  assert.equal(CAKE.PATIENCE_START_SEC, 45); // §C9.2 verbatim
  assert.equal(CAKE.PATIENCE_STEP_SEC, 1.5);
  assert.equal(CAKE.PATIENCE_FLOOR_SEC, 30);
  assert.equal(CAKE.EXPIRE_PTS, -5);
  assert.equal(CAKE.ORDER_INTERVAL_START_SEC, 30); // §C9.4 verbatim
  assert.equal(CAKE.ORDER_INTERVAL_STEP_SEC, 2);
  assert.equal(CAKE.ORDER_INTERVAL_MIN_SEC, 14);
  assert.equal(CAKE.COMPLEX_AFTER_SERVES, 4);
  assert.equal(CAKE.MAX_CANDLES, 4);
  assert.equal(CAKE.BELT_LENGTH_M, 6); // §G1.4 belt
  assert.equal(CAKE.BELT_FWD_SPEED, 0.9); // §G1.5 pedals
  assert.equal(CAKE.BELT_REV_SPEED, 0.7);
  assert.equal(CAKE.BELT_SLEW, 6);
  assert.equal(CAKE.FALL_SEC, 0.45); // §G1.5 drop physics
  assert.equal(CAKE.FALL_M, 0.55);
  assert.equal(CAKE.CATCH_HALF_M, 0.24);
  assert.equal(CAKE.LOCKOUT_SEC, 0.5);
  assert.equal(CAKE.CANDLE_GAP_SEC, 0.18);
  assert.equal(CAKE.SPLAT_PTS, -2); // §G1.5 mistimed press
  assert.equal(CAKE.SPLAT_TTL_SEC, 4);
  assert.equal(CAKE.SPAWN_S, 0.15); // §G1.5 spawn
  assert.equal(CAKE.SPAWN_CLEAR_M, 0.7);
  assert.equal(CAKE.OVEN_START_S, 2.25); // §G1.5 tunnel
  assert.equal(CAKE.OVEN_END_S, 3.15);
  assert.equal(CAKE.BAKE_GREEN_START_SEC, 2.25); // §G1.5 meter
  assert.equal(CAKE.BAKE_GREEN_END_SEC, 3.0);
  assert.equal(CAKE.SINGE_SEC, 3.6);
  assert.equal(CAKE.BAKE_PERFECT_PTS, 5);
  assert.equal(CAKE.BAKE_SINGED_PTS, -3);
  assert.equal(CAKE.SHIP_S, 5.95); // §G1.5 ship box
  assert.equal(CAKE.SHIP_HALF_M, 0.3);
  assert.equal(CAKE.PAN_CAP_MAX, 3); // §G1.6 pan cap
  assert.equal(CAKE.PAN_CAP_EVERY_SERVES, 3);
  assert.equal(CAKE.PERFECT_PTS, 20); // §C9.4 matrix verbatim
  assert.equal(CAKE.ONE_WRONG_PTS, 8);
  assert.equal(CAKE.REJECT_PTS, -5);
  assert.equal(CAKE.COMBO_STEP, 2);
  assert.equal(CAKE.COMBO_CAP, 10);
  assert.equal(CAKE.SPEED_BONUS_PTS, 4);
  assert.equal(CAKE.SPEED_BONUS_MIN_FRAC, 0.5);
  assert.equal(CAKE.ENDLESS_FAIL_COUNT, 3); // §G5.4 endless row
  // tunnel transit at full forward speed = 1.0 s (§G1.5 — belt skill)
  assert.ok(Math.abs((CAKE.OVEN_END_S - CAKE.OVEN_START_S) / CAKE.BELT_FWD_SPEED - 1) < 1e-12);
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
});

test('purblePlace: §G1.5 station table — ids, positions, kinds exact', () => {
  const expect = [
    ['spawn', 0.15], ['trash', 0.15],
    ['teig.vanilla', 0.9], ['teig.chocolate', 1.35], ['teig.strawberry', 1.8],
    ['ofen', 2.7],
    ['guss.white', 3.5], ['guss.pink', 3.95], ['guss.chocolate', 4.4],
    ['deko.cherry', 4.7], ['deko.sprinkles', 5.0], ['deko.berries', 5.3],
    ['kerzen', 5.6], ['versand', 5.95],
  ];
  assert.deepEqual(STATIONS.map((st) => [st.id, st.s]), expect);
  // oven tunnel span (§G1.5: 2.25–3.15, no button)
  assert.equal(STATION_BY_ID.ofen.s0, 2.25);
  assert.equal(STATION_BY_ID.ofen.s1, 3.15);
  assert.equal(STATION_BY_ID.ofen.button, false);
  assert.equal(STATION_BY_ID.trash.button, false);
  // exactly 11 physical drop nozzles (3 teig + 3 guss + 3 deko + kerzen…
  // kerzen is 1 → 10) + spawn/versand instant buttons
  const drops = STATIONS.filter((st) => st.drop).map((st) => st.id);
  assert.deepEqual(drops, [
    'teig.vanilla', 'teig.chocolate', 'teig.strawberry',
    'guss.white', 'guss.pink', 'guss.chocolate',
    'deko.cherry', 'deko.sprinkles', 'deko.berries', 'kerzen',
  ]);
  // every nozzle value is a real component id
  assert.ok(STATIONS.filter((st) => st.kind === 'teig').every((st) => SPONGES.includes(st.value)));
  assert.ok(STATIONS.filter((st) => st.kind === 'guss').every((st) => ICINGS.includes(st.value) && st.value !== 'none'));
  assert.ok(STATIONS.filter((st) => st.kind === 'deko').every((st) => TOPPINGS.includes(st.value) && st.value !== 'none'));
  // positions ordered along the belt and inside 0…6
  const ss = STATIONS.filter((st) => st.id !== 'trash').map((st) => st.s);
  for (let i = 1; i < ss.length; i += 1) assert.ok(ss[i] > ss[i - 1]);
  assert.ok(ss[0] > 0 && ss[ss.length - 1] < CAKE.BELT_LENGTH_M);
});

test('purblePlace: §C9.5 coin row 5/5/30, unlock L6, energy 8', () => {
  assert.deepEqual(COIN_TABLE.purblePlace, { divisor: 5, min: 5, max: 30 });
  assert.equal(UNLOCKS.MINIGAMES.purblePlace, 6);
  const meta = getMinigame('purblePlace');
  assert.equal(meta.minLevel, 6);
  assert.equal(meta.energyCost, MINIGAME.ENERGY_COST);
  assert.equal(meta.energyCost, 8);
  // §G1.8 typical 120–150 → ≈ 26 c (totals preserved)
  assert.equal(computeCoins(meta.coinTable, 130, false), 26);
  assert.equal(computeCoins(meta.coinTable, 150, false), 30);
  assert.equal(computeCoins(meta.coinTable, 999, false), 30); // clamp max
  assert.equal(computeCoins(meta.coinTable, 0, false), 5); // clamp min
  assert.equal(computeCoins(meta.coinTable, 130, true), 52); // daily ×2 after clamp
});

test('purblePlace: §G5.4 difficulty-targets row (cap 150, Schwer-Ziel 120, endless)', () => {
  assert.equal(TARGETS.purblePlace.capScore, 150);
  assert.equal(TARGETS.purblePlace.target, 120);
  assert.equal(getTarget('purblePlace'), 120);
  assert.match(TARGETS.purblePlace.endless, /3 rejected\/expired/);
  assert.match(TARGETS.purblePlace.endless, /10 s/);
});

// ---------------------------------------------------------------------------
// patience / pacing math (§C9.2/§C9.4 verbatim + §G1.6 difficulty hooks)
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

test('purblePlace: §G1.6 difficulty patience mult + interval floors', () => {
  assert.equal(patienceFor(0, 1.3), 58.5); // Leicht ×1.3
  assert.equal(patienceFor(50, 0.8), 24); // Schwer ×0.8 (after the floor)
  assert.equal(orderIntervalAt(100, 18), 18); // Leicht floor
  assert.equal(orderIntervalAt(100, 12), 12); // Schwer floor
  assert.equal(orderIntervalAt(100, 10), 10); // §G5.4 Endlos floor
  assert.equal(orderIntervalAt(0, 18), 30); // floors only clamp the ramp
});

test('purblePlace: §G1.6 pan-cap schedule (Mittel /3, Schwer reaches 3 at serve 4)', () => {
  for (const [serves, cap] of [[0, 1], [2, 1], [3, 2], [5, 2], [6, 3], [100, 3]]) {
    assert.equal(panCapAt(serves), cap, `normal serves=${serves}`);
  }
  const hard = applyDifficulty(CAKE, 'hard');
  for (const [serves, cap] of [[0, 1], [1, 1], [2, 2], [3, 2], [4, 3], [100, 3]]) {
    assert.equal(panCapAt(serves, hard), cap, `hard serves=${serves}`);
  }
});

test('purblePlace: ramp invariants — pacing monotone, cap bounded', () => {
  for (let s = 1; s <= 40; s += 1) {
    assert.ok(patienceFor(s) <= patienceFor(s - 1), 'patience must not grow');
    assert.ok(orderIntervalAt(s) <= orderIntervalAt(s - 1), 'interval must not grow');
    assert.ok(panCapAt(s) >= panCapAt(s - 1), 'pan cap must not shrink');
    assert.ok(panCapAt(s) <= CAKE.PAN_CAP_MAX);
    assert.ok(patienceFor(s) >= CAKE.PATIENCE_FLOOR_SEC);
    assert.ok(orderIntervalAt(s) >= CAKE.ORDER_INTERVAL_MIN_SEC);
  }
});

// ---------------------------------------------------------------------------
// §G1.6/§G5 difficulty rows + parameter monotonicity
// ---------------------------------------------------------------------------

test('purblePlace: applyDifficulty rows exact (§G1.6/§G5.4)', () => {
  const easy = applyDifficulty(CAKE, 'easy');
  const normal = applyDifficulty(CAKE, 'normal');
  const hard = applyDifficulty(CAKE, 'hard');
  const endless = applyDifficulty(CAKE, 'endless');
  assert.deepEqual(
    [easy.PATIENCE_MULT, easy.ORDER_INTERVAL_MIN_SEC, easy.CATCH_HALF_M, easy.SINGE_SEC],
    [1.3, 18, 0.3, 4.2]
  );
  assert.deepEqual(
    [hard.PATIENCE_MULT, hard.ORDER_INTERVAL_MIN_SEC, hard.CATCH_HALF_M, hard.SINGE_SEC, hard.PAN_CAP_EVERY_SERVES],
    [0.8, 12, 0.19, 3.2, 2]
  );
  // Mittel = live numbers bit-identical (§G5.2)
  for (const k of Object.keys(DIFFICULTY.normal)) {
    assert.equal(normal[k], CAKE[k], `normal.${k} must equal base`);
  }
  // Endlos = Schwer params + interval floor 10 + endless flag (§G5.2/§G5.4)
  assert.equal(endless.ENDLESS, true);
  assert.equal(endless.ORDER_INTERVAL_MIN_SEC, 10);
  for (const k of ['PATIENCE_MULT', 'CATCH_HALF_M', 'SINGE_SEC', 'PAN_CAP_EVERY_SERVES']) {
    assert.equal(endless[k], hard[k], `endless.${k} must equal hard`);
  }
  // derived tunes are frozen; base table stays frozen and untouched
  assert.ok(Object.isFrozen(easy) && Object.isFrozen(endless) && Object.isFrozen(CAKE));
  assert.equal(easy.mode, 'easy');
  assert.equal(applyDifficulty(CAKE, 'nonsense').mode, 'normal'); // normalize
});

test('purblePlace: difficulty parameter monotonicity (forgiveness easy ≥ mittel ≥ schwer)', () => {
  const [e, n, h] = ['easy', 'normal', 'hard'].map((m) => applyDifficulty(CAKE, m));
  assert.ok(e.CATCH_HALF_M > n.CATCH_HALF_M && n.CATCH_HALF_M > h.CATCH_HALF_M);
  assert.ok(e.SINGE_SEC > n.SINGE_SEC && n.SINGE_SEC > h.SINGE_SEC);
  assert.ok(e.PATIENCE_MULT > n.PATIENCE_MULT && n.PATIENCE_MULT > h.PATIENCE_MULT);
  assert.ok(e.ORDER_INTERVAL_MIN_SEC > n.ORDER_INTERVAL_MIN_SEC && n.ORDER_INTERVAL_MIN_SEC > h.ORDER_INTERVAL_MIN_SEC);
  assert.ok(e.PAN_CAP_EVERY_SERVES >= n.PAN_CAP_EVERY_SERVES && n.PAN_CAP_EVERY_SERVES >= h.PAN_CAP_EVERY_SERVES);
  // §G5.3 guardrail: Schwer catch window never below 55 % of Mittel
  assert.ok(h.CATCH_HALF_M >= 0.55 * n.CATCH_HALF_M);
});

// ---------------------------------------------------------------------------
// drop physics helpers (§G1.5: catch window ±0.24 inclusive, fall lead)
// ---------------------------------------------------------------------------

test('purblePlace: catch-window edges ±0.24 inclusive (§G1.5)', () => {
  const noz = STATION_BY_ID['teig.vanilla'].s;
  assert.ok(catchWindow(noz, noz));
  assert.ok(catchWindow(noz - 0.24, noz)); // inclusive edges
  assert.ok(catchWindow(noz + 0.24, noz));
  assert.ok(!catchWindow(noz - 0.2401, noz));
  assert.ok(!catchWindow(noz + 0.2401, noz));
  // difficulty windows (§G1.6): Leicht ±0.30, Schwer ±0.19
  const easy = applyDifficulty(CAKE, 'easy');
  const hard = applyDifficulty(CAKE, 'hard');
  assert.ok(catchWindow(noz + 0.3, noz, easy) && !catchWindow(noz + 0.3001, noz, easy));
  assert.ok(catchWindow(noz - 0.19, noz, hard) && !catchWindow(noz - 0.1901, noz, hard));
});

test('purblePlace: fall-lead math — dropImpactS over belt plans (§G1.9)', () => {
  // full forward speed: 0.9 m/s × 0.45 s = 0.405 m press-ahead lead
  assert.ok(Math.abs(dropImpactS(1.0, 0.9) - 1.405) < 1e-12);
  // reverse: −0.7 × 0.45 = −0.315
  assert.ok(Math.abs(dropImpactS(2.0, -0.7) - 1.685) < 1e-12);
  // stationary press = impact where you pressed (the bot's strategy)
  assert.equal(dropImpactS(3.5, 0), 3.5);
  // plan segments: 0.2 s at full speed then stopped → +0.18
  assert.ok(Math.abs(dropImpactS(1.0, [{ v: 0.9, dur: 0.2 }, { v: 0 }]) - 1.18) < 1e-12);
  // press exactly the lead ahead of the nozzle → dead-center catch
  const noz = STATION_BY_ID['teig.chocolate'].s;
  assert.ok(catchWindow(dropImpactS(noz - 0.405, 0.9), noz));
});

// ---------------------------------------------------------------------------
// oven meter (§G1.5: green 2.25–3.0 +5, pale/over ±0, auto-singe 3.6 −3)
// ---------------------------------------------------------------------------

test('purblePlace: oven bands exact — pale/green/over/singe (§G1.5)', () => {
  assert.equal(bakeResultAt(0), 'pale');
  assert.equal(bakeResultAt(2.2499), 'pale'); // just before the green zone
  assert.equal(bakeResultAt(2.25), 'perfect'); // green start inclusive
  assert.equal(bakeResultAt(3.0), 'perfect'); // green end inclusive
  assert.equal(bakeResultAt(3.0001), 'over'); // overshot, not burnt yet
  assert.equal(bakeResultAt(3.5999), 'over');
  assert.equal(bakeResultAt(3.6), 'singed'); // auto-singe commits at 3.6
  assert.equal(bakeResultAt(9), 'singed');
  // difficulty singe points (§G1.6): Leicht 4.2 / Schwer 3.2
  const easy = applyDifficulty(CAKE, 'easy');
  const hard = applyDifficulty(CAKE, 'hard');
  assert.equal(bakeResultAt(4.1, easy), 'over');
  assert.equal(bakeResultAt(4.2, easy), 'singed');
  assert.equal(bakeResultAt(3.1, hard), 'over');
  assert.equal(bakeResultAt(3.2, hard), 'singed');
  assert.equal(bakePoints('perfect'), 5);
  assert.equal(bakePoints('pale'), 0);
  assert.equal(bakePoints('over'), 0);
  assert.equal(bakePoints('singed'), -3);
});

// ---------------------------------------------------------------------------
// seeded ticket generator + §C9.4 difficulty weighting (kept verbatim)
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
// match / scoring matrix (§C9.4 — all 0 / 1 / ≥2-wrong cases, verbatim)
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

test('purblePlace: singed sponge counts as ONE wrong component (§G1.5)', () => {
  assert.equal(wrongCount({ ...perfectCake(), bake: 'singed' }, TICKET), 1);
  assert.equal(wrongCount({ ...perfectCake(), bake: 'singed', sponge: 'vanilla' }, TICKET), 2);
  // pale/over bakes are NOT match dimensions (±0 at the oven only)
  assert.equal(wrongCount({ ...perfectCake(), bake: 'pale' }, TICKET), 0);
  assert.equal(wrongCount({ ...perfectCake(), bake: 'over' }, TICKET), 0);
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

test('purblePlace: bestTicketIndex — fewest wrong, oldest-ticket tie-break (§G1.5)', () => {
  const cake = perfectCake();
  const tickets = [
    { spec: { ...TICKET, shape: 'round' }, remain: 5 }, // 1 wrong
    { spec: TICKET, remain: 40 }, // 0 wrong — OLDER of the two ties
    { spec: { ...TICKET }, remain: 12 }, // 0 wrong, newer + more urgent
  ];
  assert.equal(bestTicketIndex(cake, tickets), 1); // tie → oldest, not most urgent
  assert.equal(bestTicketIndex(cake, [tickets[0]]), 0);
  assert.equal(bestTicketIndex(cake, []), -1);
});

// ---------------------------------------------------------------------------
// engine: belt pedals + slew physics (§G1.5)
// ---------------------------------------------------------------------------

test('purblePlace: pedals — 0.9 fwd / 0.7 rev with 6 m/s² slew, exact displacement', () => {
  const line = mkLine();
  stepLine(line, DT, { spawnShape: 'round' });
  const pan = line.pans[0];
  assert.equal(pan.s, 0.15);
  // 1 s full forward from rest: ramp 0.15 s (0.0675 m) + 0.85 s × 0.9
  run(line, 30, { belt: 1 });
  assert.ok(Math.abs(line.beltV - 0.9) < 1e-12);
  assert.ok(Math.abs(pan.s - (0.15 + 0.0675 + 0.765)) < 1e-9, `s=${pan.s}`);
  // release: slews back to 0 and stays
  run(line, 30, { belt: 0 });
  assert.equal(line.beltV, 0);
  const sHold = pan.s;
  run(line, 30, {});
  assert.equal(pan.s, sHold); // pans only move when the player moves the belt
  // 1 s reverse from rest: ramp 0.7/6 s + rest at 0.7 m/s
  const s0 = pan.s;
  run(line, 30, { belt: -1 });
  assert.ok(Math.abs(line.beltV - -0.7) < 1e-12);
  const ramp = 0.7 / 6;
  const expected = -((0.7 / 2) * ramp + 0.7 * (1 - ramp));
  assert.ok(Math.abs(pan.s - (s0 + expected)) < 1e-9, `s=${pan.s}`);
});

test('purblePlace: pans park at the right belt end (no accidental right-side loss)', () => {
  const line = mkLine();
  stepLine(line, DT, { spawnShape: 'round' });
  run(line, 30 * 9, { belt: 1 });
  assert.equal(line.pans.length, 1);
  assert.equal(line.pans[0].s, CAKE.BELT_LENGTH_M); // clamped at 6.0
  // still inside the ship zone (|6.0 − 5.95| ≤ 0.30)
  assert.ok(Math.abs(line.pans[0].s - CAKE.SHIP_S) <= CAKE.SHIP_HALF_M);
});

// ---------------------------------------------------------------------------
// engine: spawn + pan cap + trash (§G1.5/§G1.6)
// ---------------------------------------------------------------------------

test('purblePlace: spawn — pan at 0.15, cap buzz, clearance buzz (§G1.5)', () => {
  const line = mkLine();
  let ev = stepLine(line, DT, { spawnShape: 'round' });
  const spawn = ev.find((e) => e.type === 'panSpawn');
  assert.deepEqual([spawn.shape, spawn.s], ['round', 0.15]);
  assert.equal(line.pans[0].shape, 'round');
  // pan cap is 1 before serve #3 (§G1.6) → second spawn buzzes 'cap'
  ev = stepLine(line, DT, { spawnShape: 'square' });
  assert.equal(ev.find((e) => e.type === 'buzz')?.reason, 'cap');
  assert.deepEqual(canSpawn(line), { ok: false, reason: 'cap' });
  // raise the cap (serves ≥ 6 → 3 pans): now the SPOT blocks (< 0.7 m clear)
  line.serves = 6;
  ev = stepLine(line, DT, { spawnShape: 'square' });
  assert.equal(ev.find((e) => e.type === 'buzz')?.reason, 'blocked');
  // drive clear and spawn again — ok
  run(line, 30, { belt: 1 });
  ev = stepLine(line, DT, { spawnShape: 'square' });
  assert.equal(ev.find((e) => e.type === 'panSpawn')?.shape, 'square');
  assert.equal(line.pans.length, 2);
});

test('purblePlace: trash — reversing a pan off the left end dumps it, ±0 (§G1.5)', () => {
  const line = mkLine();
  line.score = 10;
  stepLine(line, DT, { spawnShape: 'heart' });
  const ev = run(line, 30, { belt: -1 });
  const trash = ev.find((e) => e.type === 'trash');
  assert.ok(trash, 'trash event');
  assert.equal(line.pans.length, 0);
  assert.equal(line.trashed, 1);
  assert.equal(line.score, 10); // pan lost, 0 points
});

// ---------------------------------------------------------------------------
// engine: drops — physical fall, catch at impact, splat, buzz, lockout
// ---------------------------------------------------------------------------

test('purblePlace: drop press → 0.45 s fall → catch at impact (stationary)', () => {
  const line = mkLine();
  stepLine(line, DT, { spawnShape: 'round' });
  line.pans[0].s = STATION_BY_ID['teig.vanilla'].s; // parked dead-center
  const pressT = line.t;
  let ev = stepLine(line, DT, { press: 'teig.vanilla' });
  const drop = ev.find((e) => e.type === 'drop');
  assert.equal(drop.station, 'teig.vanilla');
  assert.ok(Math.abs(drop.impactAt - (pressT + 0.45)) < 1e-9);
  assert.equal(line.pans[0].sponge, null); // still falling
  ev = run(line, 16, {});
  assert.equal(ev.filter((e) => e.type === 'catch').length, 1);
  assert.equal(line.pans[0].sponge, 'vanilla');
});

test('purblePlace: catch boundary at impact — ±0.24 in, beyond = splat −2 riding the belt', () => {
  // pan exactly at the window edge → catch
  let line = mkLine();
  stepLine(line, DT, { spawnShape: 'round' });
  line.pans[0].s = STATION_BY_ID['teig.vanilla'].s - CAKE.CATCH_HALF_M;
  stepLine(line, DT, { press: 'teig.vanilla' });
  let ev = run(line, 16, {});
  assert.ok(ev.some((e) => e.type === 'catch'));
  // 0.1 mm beyond → mistimed press: splat, −2, decal rides the belt for 4 s
  line = mkLine();
  line.score = 10;
  stepLine(line, DT, { spawnShape: 'round' });
  line.pans[0].s = STATION_BY_ID['teig.vanilla'].s - CAKE.CATCH_HALF_M - 0.0001;
  stepLine(line, DT, { press: 'teig.vanilla' });
  ev = run(line, 16, {});
  const splat = ev.find((e) => e.type === 'splat');
  assert.deepEqual([splat.points, splat.s], [-2, STATION_BY_ID['teig.vanilla'].s]);
  assert.equal(line.score, 8);
  assert.equal(line.splatCount, 1);
  assert.equal(line.pans[0].sponge, null);
  const sBefore = line.splats[0].s;
  run(line, 15, { belt: 1 });
  assert.ok(line.splats[0].s > sBefore, 'splat decal rides the belt');
  run(line, 30 * 4, {});
  assert.equal(line.splats.length, 0); // 4 s TTL expired
});

test('purblePlace: fall-lead — moving catch works, pressing too early splats', () => {
  // press exactly 0.405 m ahead at full speed → dead-center catch
  let line = mkLine();
  stepLine(line, DT, { spawnShape: 'round' });
  const noz = STATION_BY_ID['teig.chocolate'].s;
  line.beltV = 0.9;
  line.pans[0].s = noz - 0.405;
  stepLine(line, DT, { belt: 1, press: 'teig.chocolate' });
  let ev = run(line, 20, { belt: 1 });
  assert.ok(ev.some((e) => e.type === 'catch'));
  assert.equal(line.pans[0].sponge, 'chocolate');
  // pressing with the pan a window-plus-lead too far back → impact misses
  line = mkLine();
  line.score = 10;
  stepLine(line, DT, { spawnShape: 'round' });
  line.beltV = 0.9;
  line.pans[0].s = noz - 0.405 - CAKE.CATCH_HALF_M - 0.05;
  stepLine(line, DT, { belt: 1, press: 'teig.chocolate' });
  ev = run(line, 20, { belt: 1 });
  assert.ok(ev.some((e) => e.type === 'splat'));
  assert.equal(line.score, 8);
});

test('purblePlace: disallowed matrix — pan blocks the spot with a friendly buzz, ±0 (§G1.5)', () => {
  // icing onto raw batter (and onto an EMPTY pan) → buzz, no splat, no points
  const cases = [
    { pan: { s: 3.5 }, press: 'guss.white', label: 'icing on empty pan' },
    { pan: { s: 3.5, sponge: 'vanilla' }, press: 'guss.white', label: 'icing on raw batter' },
    { pan: { s: 0.9, sponge: 'vanilla' }, press: 'teig.vanilla', label: 'second batter' },
    { pan: { s: 4.7, sponge: 'vanilla' }, press: 'deko.cherry', label: 'topping on raw' },
    { pan: { s: 5.6, sponge: 'vanilla' }, press: 'kerzen', label: 'candles on raw' },
    { pan: { s: 3.5, sponge: 'vanilla', bake: 'perfect', icing: 'white' }, press: 'guss.white', label: 'second icing' },
    { pan: { s: 5.0, sponge: 'vanilla', bake: 'pale', topping: 'cherry' }, press: 'deko.sprinkles', label: 'second topping' },
    { pan: { s: 5.6, sponge: 'vanilla', bake: 'perfect', candles: 4 }, press: 'kerzen', label: '5th candle' },
  ];
  for (const c of cases) {
    const line = mkLine();
    line.score = 10;
    pokePan(line, c.pan);
    stepLine(line, DT, { press: c.press });
    const ev = run(line, 16, {});
    const buzz = ev.find((e) => e.type === 'buzz');
    assert.ok(buzz, `${c.label}: buzz expected`);
    assert.equal(buzz.reason, 'illegal', c.label);
    assert.equal(line.score, 10, `${c.label}: 0 points`);
    assert.equal(line.splats.length, 0, `${c.label}: no splat — the pan blocks the spot`);
    assert.ok(!ev.some((e) => e.type === 'catch'), c.label);
  }
});

test('purblePlace: per-nozzle lockout 0.5 s, candle spacing 0.18 s (§G1.5)', () => {
  const line = mkLine();
  pokePan(line, { s: 0.9 });
  const d1 = stepLine(line, DT, { press: 'teig.vanilla' }).filter((e) => e.type === 'drop');
  const d2 = stepLine(line, DT, { press: 'teig.vanilla' }).filter((e) => e.type === 'drop');
  assert.equal(d1.length, 1);
  assert.equal(d2.length, 0); // locked out — silently ignored
  assert.ok(line.lockouts['teig.vanilla'] > 0);
  run(line, 16, {});
  assert.equal(stepLine(line, DT, { press: 'teig.vanilla' }).filter((e) => e.type === 'drop').length, 1);
  // candles: ≥ 0.18 s apart → 0.2 s spacing fires, immediate re-press doesn't
  const line2 = mkLine();
  pokePan(line2, { s: 5.6, sponge: 'vanilla', bake: 'perfect' });
  assert.equal(stepLine(line2, DT, { press: 'kerzen' }).filter((e) => e.type === 'drop').length, 1);
  assert.equal(stepLine(line2, DT, { press: 'kerzen' }).filter((e) => e.type === 'drop').length, 0);
  run(line2, 5, {}); // 6 frames = 0.2 s > 0.18 s
  assert.equal(stepLine(line2, DT, { press: 'kerzen' }).filter((e) => e.type === 'drop').length, 1);
  run(line2, 16, {});
  assert.equal(line2.pans[0].candles, 2);
});

// ---------------------------------------------------------------------------
// engine: oven tunnel — bake-while-inside, commit on exit, resume, auto-singe
// ---------------------------------------------------------------------------

test('purblePlace: oven — meter accrues inside, exit in green commits +5', () => {
  const line = mkLine();
  const pan = pokePan(line, { s: 2.7, sponge: 'vanilla' });
  let ev = run(line, Math.round(30 * 2.3), {}); // sit inside 2.3 s
  assert.ok(ev.some((e) => e.type === 'bakeStart'));
  assert.ok(Math.abs(pan.bakeT - 2.3) < 0.05);
  assert.equal(pan.bake, null); // not committed until it leaves
  ev = run(line, 40, { belt: 1 }); // drive out (transit adds ≈ 0.55 s meter)
  const commit = ev.find((e) => e.type === 'bakeCommit');
  assert.equal(commit.result, 'perfect');
  assert.equal(commit.points, 5);
  assert.equal(commit.auto, false);
  assert.equal(pan.bake, 'perfect');
  assert.equal(line.score, 5);
  assert.equal(line.perfectBakes, 1);
});

test('purblePlace: oven — pale exit commits ±0, re-entering RESUMES the meter (§G1.5)', () => {
  const line = mkLine();
  const pan = pokePan(line, { s: 2.7, sponge: 'vanilla' });
  run(line, 15, {}); // 0.5 s inside
  let ev = run(line, 40, { belt: 1 }); // out early
  let commit = ev.find((e) => e.type === 'bakeCommit');
  assert.equal(commit.result, 'pale');
  assert.equal(commit.points, 0);
  assert.ok(pan.bakeT < CAKE.BAKE_GREEN_START_SEC);
  assert.equal(line.score, 0);
  // reverse back in — same meter continues; leave in green → +5 total
  ev = run(line, 40, { belt: -1 });
  assert.ok(ev.some((e) => e.type === 'bakeStart'), 're-entry starts baking again');
  const wait = Math.round(30 * (2.5 - pan.bakeT));
  run(line, wait, {});
  ev = run(line, 40, { belt: 1 });
  commit = ev.find((e) => e.type === 'bakeCommit');
  assert.equal(commit.result, 'perfect');
  assert.equal(commit.points, 5); // delta vs pale — fix-a-pale-bake pays once
  assert.equal(line.score, 5);
});

test('purblePlace: oven — auto-singe commits at 3.6 s even inside; over-band is ±0', () => {
  const line = mkLine();
  line.score = 10;
  const pan = pokePan(line, { s: 2.7, sponge: 'vanilla' });
  const ev = run(line, Math.round(30 * 4), {});
  const commit = ev.find((e) => e.type === 'bakeCommit');
  assert.equal(commit.result, 'singed');
  assert.equal(commit.auto, true);
  assert.equal(commit.points, -3);
  assert.equal(pan.bake, 'singed');
  assert.ok(Math.abs(pan.bakeT - CAKE.SINGE_SEC) < 1e-9); // clamped at 3.6
  assert.equal(line.score, 7);
  // singed is final — staying inside commits nothing further
  const more = run(line, 60, {});
  assert.ok(!more.some((e) => e.type === 'bakeCommit' || e.type === 'bakeStart'));
  // over-band exit (3.0 < meter < singe): ±0, still counts as baked. Baking
  // continues DURING the drive out (mid-tunnel exit ≈ 0.575 s at 0.9 m/s with
  // the 6 m/s² slew), so leave at 2.8 s → commits ≈ 3.375 s, inside the band.
  const line2 = mkLine();
  const pan2 = pokePan(line2, { s: 2.7, sponge: 'vanilla' });
  run(line2, Math.round(30 * 2.8), {});
  const ev2 = run(line2, 40, { belt: 1 });
  const c2 = ev2.find((e) => e.type === 'bakeCommit');
  assert.equal(c2.result, 'over');
  assert.equal(c2.points, 0);
  assert.ok(pan2.bake === 'over');
  assert.equal(line2.score, 0);
});

test('purblePlace: oven — banked bake points stay path-independent (green → overdone singe nets −3)', () => {
  const line = mkLine();
  line.score = 10;
  const pan = pokePan(line, { s: 2.7, sponge: 'vanilla' });
  run(line, Math.round(30 * 2.4), {});
  run(line, 40, { belt: 1 }); // green exit: +5
  assert.equal(line.score, 15);
  run(line, 40, { belt: -1 }); // back in ("and overdo it" — §G1.5)
  run(line, Math.round(30 * 2), {});
  assert.equal(pan.bake, 'singed');
  assert.equal(line.score, 7); // 10 + 5 − 8 → net −3 == bakePoints('singed')
});

// ---------------------------------------------------------------------------
// engine: ship box — auto-match, tie-break, buzzes (§G1.5)
// ---------------------------------------------------------------------------

test('purblePlace: ship — perfect serve pays the §C9.4 matrix, ticket+pan leave', () => {
  const line = mkLine();
  pokeTicket(line, { ...TICKET }, 40, 45); // ≥ 50 % patience → speed bonus
  pokePan(line, { ...perfectCake(), s: 5.95 });
  const ev = stepLine(line, DT, { ship: true });
  const serve = ev.find((e) => e.type === 'serve');
  assert.equal(serve.outcome, 'perfect');
  assert.deepEqual(
    [serve.base, serve.comboBonus, serve.speedBonus, serve.points, serve.wrong],
    [20, 0, 4, 24, 0]
  );
  assert.equal(line.score, 24);
  assert.deepEqual([line.serves, line.cakesServed, line.perfectCakes, line.combo], [1, 1, 1, 1]);
  assert.equal(line.tickets.length, 0);
  assert.equal(line.pans.length, 0);
});

test('purblePlace: ship — auto-match fewest wrong, tie → oldest ticket (§G1.5)', () => {
  const line = mkLine();
  const older = pokeTicket(line, { ...TICKET }, 40, 45);
  pokeTicket(line, { ...TICKET }, 10, 45); // same spec, newer + more urgent
  pokeTicket(line, { ...TICKET, shape: 'round' }, 5, 45); // 1 wrong
  pokePan(line, { ...perfectCake(), s: 5.95 });
  const ev = stepLine(line, DT, { ship: true });
  assert.equal(ev.find((e) => e.type === 'serve').ticketId, older.id);
  assert.equal(line.tickets.length, 2);
});

test('purblePlace: ship — ≥2 wrong rejects (−5, combo reset, cake gone)', () => {
  const line = mkLine();
  line.score = 20;
  line.combo = 4;
  pokeTicket(line, { ...TICKET }, 40, 45);
  pokePan(line, { ...perfectCake(), shape: 'round', sponge: 'vanilla', s: 5.95 });
  const ev = stepLine(line, DT, { ship: true });
  const reject = ev.find((e) => e.type === 'reject');
  assert.equal(reject.outcome, 'rejected');
  assert.equal(reject.points, -5);
  assert.ok(reject.wrong >= 2);
  assert.equal(line.score, 15);
  assert.equal(line.combo, 0);
  assert.equal(line.rejected, 1);
  assert.equal(line.pans.length, 0); // rejected cake is thrown away
});

test('purblePlace: ship — a singed but otherwise perfect cake serves as oneWrong (§G1.5)', () => {
  const line = mkLine();
  pokeTicket(line, { ...TICKET }, 10, 45);
  pokePan(line, { ...perfectCake(), bake: 'singed', s: 5.95 });
  const ev = stepLine(line, DT, { ship: true });
  const serve = ev.find((e) => e.type === 'serve');
  assert.equal(serve.outcome, 'oneWrong');
  assert.equal(serve.base, 8);
  assert.equal(serve.wrong, 1);
});

test('purblePlace: ship buzzes — empty zone, unbaked pan, zone edge ±0.30, no ticket', () => {
  // no pan in the zone
  let line = mkLine();
  assert.equal(stepLine(line, DT, { ship: true }).find((e) => e.type === 'buzz')?.reason, 'empty');
  // unbaked pan in the zone
  line = mkLine();
  pokeTicket(line, { ...TICKET }, 10, 45);
  pokePan(line, { s: 5.95, sponge: 'vanilla' });
  assert.equal(stepLine(line, DT, { ship: true }).find((e) => e.type === 'buzz')?.reason, 'raw');
  // baked pan just OUTSIDE the ±0.30 zone
  line = mkLine();
  pokeTicket(line, { ...TICKET }, 10, 45);
  pokePan(line, { ...perfectCake(), s: 5.95 - 0.301 });
  assert.equal(stepLine(line, DT, { ship: true }).find((e) => e.type === 'buzz')?.reason, 'empty');
  // …and just INSIDE (edge inclusive)
  line = mkLine();
  pokeTicket(line, { ...TICKET }, 10, 45);
  pokePan(line, { ...perfectCake(), s: 5.95 - 0.3 });
  assert.ok(stepLine(line, DT, { ship: true }).some((e) => e.type === 'serve' || e.type === 'reject'));
  // baked pan but no open ticket → never serve into the void
  line = mkLine();
  pokePan(line, { ...perfectCake(), s: 5.95 });
  assert.equal(stepLine(line, DT, { ship: true }).find((e) => e.type === 'buzz')?.reason, 'noTicket');
});

// ---------------------------------------------------------------------------
// engine: tickets — first order immediate, board cap, expiry (§G1.6)
// ---------------------------------------------------------------------------

test('purblePlace: engine — first order lands immediately, board holds at 3, expiry −5', () => {
  const line = mkLine();
  stepLine(line, DT, {});
  assert.equal(line.tickets.length, 1); // first order at t≈0
  // board fills to 3 and holds
  run(line, 30 * 70, {});
  assert.ok(line.tickets.length <= CAKE.MAX_TICKETS);
  // expiry: −5, combo reset, expire event
  const line2 = mkLine();
  line2.score = 20;
  line2.combo = 3;
  stepLine(line2, DT, {});
  const patience = line2.tickets[0].patience;
  assert.equal(patience, 45); // Mittel patience at 0 serves
  const ev = run(line2, Math.round(30 * (patience + 0.2)), {});
  const expire = ev.find((e) => e.type === 'expire');
  assert.equal(expire.points, -5);
  assert.equal(line2.combo, 0);
  assert.ok(line2.expired >= 1);
  assert.ok(line2.score < 20);
});

// ---------------------------------------------------------------------------
// determinism (§G1.9: same seed + same input script → same events)
// ---------------------------------------------------------------------------

test('purblePlace: engine is deterministic under a fixed seed + input script', () => {
  const play = () => {
    const line = createLine({ rng: mulberry32(77), difficulty: 'normal' });
    const irng = mulberry32(99);
    const log = [];
    for (let i = 0; i < 30 * 90; i += 1) {
      const input = {
        belt: [1, 0, -1, 1][Math.floor(irng() * 4)],
        press: irng() < 0.06 ? STATIONS[2 + Math.floor(irng() * 12)].id : null,
        spawnShape: irng() < 0.03 ? SHAPES[Math.floor(irng() * 3)] : null,
        ship: irng() < 0.02,
      };
      for (const e of stepLine(line, DT, input)) {
        log.push(`${e.type}:${e.panId ?? ''}:${e.ticketId ?? ''}:${e.points ?? ''}`);
      }
    }
    return `${log.join('|')}#${line.score}#${line.serves}#${line.t.toFixed(6)}`;
  };
  assert.equal(play(), play());
});

test('purblePlace: stepLine emits only the §G1.9 event vocabulary', () => {
  const KNOWN = new Set([
    'panSpawn', 'drop', 'catch', 'splat', 'buzz', 'bakeStart', 'bakeCommit',
    'serve', 'reject', 'expire', 'ticketNew', 'trash',
  ]);
  const line = createLine({ rng: mulberry32(3), difficulty: 'normal' });
  const bot = createLineBot(mulberry32(303));
  const seen = new Set();
  for (let i = 0; i < 30 * 210; i += 1) {
    for (const e of stepLine(line, DT, bot.plan(line, DT))) seen.add(e.type);
  }
  for (const type of seen) assert.ok(KNOWN.has(type), `unknown event '${type}'`);
  for (const must of ['panSpawn', 'drop', 'catch', 'ticketNew', 'serve']) {
    assert.ok(seen.has(must), `bot round never emitted '${must}'`);
  }
});

// ---------------------------------------------------------------------------
// endless mode (§G5.4: 3 rejected/expired end it; interval floor 10 s)
// ---------------------------------------------------------------------------

test('purblePlace: endless — 3 expiries end the run, stepLine no-ops after', () => {
  const line = createLine({ rng: mulberry32(7), difficulty: 'endless' });
  assert.equal(line.tune.ORDER_INTERVAL_MIN_SEC, 10);
  assert.equal(line.tune.ENDLESS, true);
  while (!line.over && line.t < 600) stepLine(line, DT, {});
  assert.equal(line.over, true);
  assert.equal(line.rejected + line.expired, 3);
  const t = line.t;
  assert.deepEqual(stepLine(line, DT, { belt: 1, spawnShape: 'round' }), []);
  assert.equal(line.t, t); // frozen once over
});

test('purblePlace: endless — rejects count toward the 3-fail end condition', () => {
  const line = createLine({ rng: mulberry32(9), difficulty: 'endless' });
  line.rejected = 2;
  pokeTicket(line, { ...TICKET }, 40, 45);
  pokePan(line, { ...perfectCake(), shape: 'round', sponge: 'vanilla', s: 5.95 });
  const ev = stepLine(line, DT, { ship: true });
  assert.ok(ev.some((e) => e.type === 'reject'));
  assert.equal(line.over, true); // 2 rejects + this one = 3
});

test('purblePlace: timed modes never set the endless over-flag', () => {
  const line = mkLine('normal', 11);
  for (let i = 0; i < 30 * 210 && !line.over; i += 1) stepLine(line, DT, {});
  assert.ok(line.expired >= 3, 'unattended round expires plenty of tickets');
  assert.equal(line.over, false);
});

// ---------------------------------------------------------------------------
// §G1.9 bot bars: ≥ 90 avg over 20 seeded Mittel rounds; §G5.4 Schwer target
// reachable on ≥ 1 of 5 seeds; totals stay §G1.8-typical (economy holds)
// ---------------------------------------------------------------------------

test('purblePlace: bot averages ≥ 90 over 20 seeded Mittel rounds (§G1.9)', () => {
  let total = 0;
  let expired = 0;
  let serves = 0;
  const meta = getMinigame('purblePlace');
  for (let seed = 1; seed <= 20; seed += 1) {
    const r = simulateRound(seed);
    total += r.score;
    expired += r.expired;
    serves += r.serves;
    // meta counter fields present + coherent (§C9.5 meta contract unchanged)
    assert.ok(r.cakesServed >= 0 && r.perfectCakes <= r.cakesServed && r.rejected <= r.cakesServed);
    // every payout inside the §C9.5 row
    const coins = computeCoins(meta.coinTable, r.score, false);
    assert.ok(coins >= 5 && coins <= 30, `payout ${coins} outside row`);
  }
  const avg = total / 20;
  assert.ok(avg >= 90, `bot average ${avg.toFixed(1)} < 90`);
  // §G1.8 economy equivalence: totals stay near the v3 engine's typicals
  // (v3 bot baseline avg ≈ 170 over the same 20 seeds)
  assert.ok(avg <= 185, `bot average ${avg.toFixed(1)} drifted above v3 typicals`);
  // solvability: the seeded ticket streams are serveable — expiries stay rare
  assert.ok(expired <= serves * 0.1, `expiries ${expired} vs serves ${serves}`);
  assert.ok(serves >= 20 * 5, `too few serves (${serves}) — stream starved`);
});

test('purblePlace: bot clears the §G5.4 Schwer target (120) on ≥ 1 of 5 seeds', () => {
  const target = getTarget('purblePlace');
  assert.equal(target, 120);
  let best = 0;
  let hits = 0;
  for (let seed = 1; seed <= 5; seed += 1) {
    const r = simulateRound(seed, { difficulty: 'hard' });
    best = Math.max(best, r.score);
    if (r.score >= target) hits += 1;
  }
  assert.ok(hits >= 1, `no Schwer run reached ${target} (best ${best})`);
});

test('purblePlace: bot mean scores are difficulty-monotone (easy ≥ mittel ≥ schwer, §G10-5)', () => {
  const mean = (mode) => {
    let total = 0;
    for (let seed = 1; seed <= 10; seed += 1) total += simulateRound(seed, { difficulty: mode }).score;
    return total / 10;
  };
  const e = mean('easy');
  const n = mean('normal');
  const h = mean('hard');
  assert.ok(e >= n && n >= h, `means not monotone: easy ${e.toFixed(1)} / mittel ${n.toFixed(1)} / schwer ${h.toFixed(1)}`);
});

test('purblePlace: zero-error bot proves the line is cleanly playable', () => {
  const clean = {
    SLOPPY_CHANCE: 0, WRONG_CHANCE: 0, SHAPE_WRONG_CHANCE: 0,
    OVEN_EARLY_CHANCE: 0, OVEN_LATE_CHANCE: 0, CANDLE_SHORT_CHANCE: 0,
    HESITATE_MIN_SEC: 0.05, HESITATE_MAX_SEC: 0.1, REACT_MIN_SEC: 0.05, REACT_MAX_SEC: 0.1,
  };
  for (const seed of [1, 2, 3]) {
    const r = simulateRound(seed, { bot: clean });
    assert.ok(r.score >= 180, `clean run seed ${seed} scored ${r.score}`);
    assert.equal(r.rejected, 0, 'clean runs never get rejected');
    assert.ok(r.perfectCakes >= r.serves - 1, 'clean runs serve perfect cakes');
  }
});

test('purblePlace: endless — competent bot outlives 210 s, then 3 fails end it', () => {
  const r = simulateRound(1, { difficulty: 'endless' });
  assert.equal(r.over, true);
  assert.equal(r.rejected + r.expired >= 3, true);
  assert.ok(r.tSec > 60, `endless ended implausibly early (${r.tSec.toFixed(0)} s)`);
});

test('purblePlace: BOT error model stays a bounded human-ish profile', () => {
  for (const k of ['SLOPPY_CHANCE', 'WRONG_CHANCE', 'SHAPE_WRONG_CHANCE', 'OVEN_EARLY_CHANCE', 'OVEN_LATE_CHANCE', 'CANDLE_SHORT_CHANCE']) {
    assert.ok(BOT[k] >= 0 && BOT[k] < 0.6, `${k} out of band`);
  }
  assert.ok(BOT.OVEN_EXIT_METER_SEC >= CAKE.BAKE_GREEN_START_SEC, 'bot exits after green start (§G1.9: meter ≥ 2.4)');
  assert.ok(BOT.OVEN_PARK_S > CAKE.OVEN_START_S && BOT.OVEN_PARK_S < CAKE.OVEN_END_S);
});

// ---------------------------------------------------------------------------
// sfx ids stay mapped (G62 calls existing ids until the wave-3 §C-SYS1.9.2
// flip — rows 30–32 keep these id names)
// ---------------------------------------------------------------------------

test('purblePlace: cake sfx ids are mapped (samples/known recipes only)', () => {
  for (const id of ['cake.apply', 'cake.ovenDing', 'cake.serve', 'cake.candle', 'cake.order', 'cake.splat']) {
    const def = SFX_MAP[id];
    assert.ok(def, `sfxMap missing ${id}`);
    assert.ok(def.kind === 'sample' || def.kind === 'synth');
  }
});
