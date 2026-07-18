// G5 — care-interaction pure logic (§C3) vs the binding constants: gesture
// classifier (pet velocity/duration, tickle direction changes, poke → dizzy),
// feed math (deltas, refuse ≥ 95, inventory consume, XP 5), daily pet/tickle
// caps (§C1.5), wash coverage → hygiene formula, toilet cooldown and the ball
// flick/ballistic helpers. Also asserts the §B purity rule: the tested module
// must not statically import three.js or the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createCareGestures,
  applyPetTickleGain,
  feedGooby,
  junkScoreBand, // V2/G20 (§C7)
  accumulateCoverage,
  isFullWash,
  washRinse,
  canUseToilet,
  flickToVelocity,
  stepBall,
  careEmotionFor, // V2/FIX-C (P1-2)
} from '../src/home/interactions.js';
import { INTERACT, XP, CARE_TUNING, STATS } from '../src/data/constants.js';
import { FOODS_BY_ID } from '../src/data/foods.js';
import { HEALTH } from '../src/systems/health.js'; // V2/G20 (§B5 thresholds)

const BASE_STATS = { hunger: 50, energy: 80, hygiene: 40, fun: 50 };

// ---------------------------------------------------------------------------
// gesture classifier (§C3)
// ---------------------------------------------------------------------------

test('pet: slow drag over the body for ≥400 ms emits one stroke per window', () => {
  const g = createCareGestures();
  g.dragStart({ t: 0, x: 100, y: 100, region: 'belly' });
  const events = [];
  // 20 px per 50 ms = 400 px/s < 600 px/s threshold
  for (let i = 1; i <= 20; i += 1) {
    events.push(...g.dragMove({ t: i * 50, x: 100 + i * 20, y: 100, region: 'belly' }));
  }
  // 1000 ms of slow dragging → floor(1000 / 400) = 2 strokes
  const pets = events.filter((e) => e.type === 'pet');
  assert.equal(pets.length, 2);
});

test('pet: fast drags (≥600 px/s) never classify as petting', () => {
  const g = createCareGestures();
  g.dragStart({ t: 0, x: 0, y: 100, region: 'head' });
  const events = [];
  // 40 px per 50 ms = 800 px/s — too fast (and not on the belly → no tickle)
  for (let i = 1; i <= 20; i += 1) {
    events.push(...g.dragMove({ t: i * 50, x: i * 40, y: 100, region: 'head' }));
  }
  assert.equal(events.filter((e) => e.type === 'pet').length, 0);
  assert.equal(events.filter((e) => e.type === 'tickle').length, 0);
});

test('pet: a fast jerk resets the slow-drag accumulator', () => {
  const g = createCareGestures();
  g.dragStart({ t: 0, x: 0, y: 0, region: 'belly' });
  let events = [];
  // 300 ms slow (not yet a stroke)
  for (let i = 1; i <= 6; i += 1) {
    events.push(...g.dragMove({ t: i * 50, x: i * 10, y: 0, region: 'belly' }));
  }
  // fast jerk (2000 px/s)
  events.push(...g.dragMove({ t: 350, x: 60 + 100, y: 0, region: 'belly' }));
  // 300 ms slow again — total slow time 600 ms but never ≥400 contiguous
  for (let i = 1; i <= 6; i += 1) {
    events.push(...g.dragMove({ t: 350 + i * 50, x: 160 + i * 10, y: 0, region: 'belly' }));
  }
  assert.equal(events.filter((e) => e.type === 'pet').length, 0);
});

test('pet: dragging off Gooby does not pet', () => {
  const g = createCareGestures();
  g.dragStart({ t: 0, x: 0, y: 0, region: null });
  const events = [];
  for (let i = 1; i <= 20; i += 1) {
    events.push(...g.dragMove({ t: i * 50, x: i * 10, y: 0, region: null }));
  }
  assert.equal(events.length, 0);
});

test('tickle: ≥3 horizontal direction changes within 900 ms on the belly', () => {
  const g = createCareGestures();
  g.dragStart({ t: 0, x: 200, y: 300, region: 'belly' });
  const events = [];
  // zig-zag: right, left, right, left → 3 direction changes in 300 ms
  let x = 200;
  const moves = [40, -40, 40, -40];
  moves.forEach((dx, i) => {
    x += dx;
    events.push(...g.dragMove({ t: (i + 1) * 75, x, y: 300, region: 'belly' }));
  });
  assert.equal(events.filter((e) => e.type === 'tickle').length, 1);
});

test('tickle: direction changes outside the 900 ms window do not trigger', () => {
  const g = createCareGestures();
  g.dragStart({ t: 0, x: 200, y: 300, region: 'belly' });
  const events = [];
  let x = 200;
  const moves = [40, -40, 40, -40, 40, -40];
  moves.forEach((dx, i) => {
    x += dx;
    // one move per 600 ms → each pair of changes spans > 900 ms
    events.push(...g.dragMove({ t: (i + 1) * 600, x, y: 300, region: 'belly' }));
  });
  assert.equal(events.filter((e) => e.type === 'tickle').length, 0);
});

test('tickle: rubs on the head are not tickles', () => {
  const g = createCareGestures();
  g.dragStart({ t: 0, x: 200, y: 100, region: 'head' });
  const events = [];
  let x = 200;
  [40, -40, 40, -40].forEach((dx, i) => {
    x += dx;
    events.push(...g.dragMove({ t: (i + 1) * 75, x, y: 100, region: 'head' }));
  });
  assert.equal(events.filter((e) => e.type === 'tickle').length, 0);
});

test('poke: taps report poke; 5 pokes within 3 s → dizzy, then counter resets', () => {
  const g = createCareGestures();
  for (let i = 0; i < INTERACT.POKE_DIZZY_COUNT - 1; i += 1) {
    assert.equal(g.tap({ t: i * 500, region: 'head' }), 'poke');
  }
  assert.equal(g.tap({ t: 2400, region: 'belly' }), 'dizzy');
  // window reset — next tap is a plain poke again
  assert.equal(g.tap({ t: 2500, region: 'belly' }), 'poke');
});

test('poke: slow pokes (>3 s apart) never go dizzy; taps off Gooby ignored', () => {
  const g = createCareGestures();
  for (let i = 0; i < 10; i += 1) {
    assert.equal(g.tap({ t: i * (INTERACT.POKE_DIZZY_WINDOW_MS + 1), region: 'feet' }), 'poke');
  }
  assert.equal(g.tap({ t: 99999, region: null }), null);
});

// ---------------------------------------------------------------------------
// daily pet/tickle caps (§C3 + §C1.5)
// ---------------------------------------------------------------------------

test('pet/tickle fun caps at +10/day combined', () => {
  let counters = { petsDay: '', petsToday: 0, petFunToday: 0, tickles: 0 };
  let fun = 0;
  // 4 tickles (+2 each) = 8, then a pet (+1) = 9, then a tickle capped to +1
  for (let i = 0; i < 4; i += 1) {
    const r = applyPetTickleGain(counters, 'tickle', '2026-07-16');
    fun += r.fun;
    counters = r.counters;
  }
  assert.equal(fun, 8);
  let r = applyPetTickleGain(counters, 'pet', '2026-07-16');
  fun += r.fun;
  counters = r.counters;
  assert.equal(fun, 9);
  r = applyPetTickleGain(counters, 'tickle', '2026-07-16');
  assert.equal(r.fun, 1); // capped: only 1 fun left of the daily 10
  counters = r.counters;
  r = applyPetTickleGain(counters, 'pet', '2026-07-16');
  assert.equal(r.fun, 0); // fully capped
  assert.equal(INTERACT.PET_TICKLE_FUN_DAILY_CAP, 10);
});

test('petting XP caps at 20/day; fun cap does not block XP', () => {
  let counters = { petsDay: '2026-07-16', petsToday: 0, petFunToday: 0 };
  let xp = 0;
  for (let i = 0; i < 30; i += 1) {
    const r = applyPetTickleGain(counters, 'pet', '2026-07-16');
    xp += r.xp;
    counters = r.counters;
  }
  assert.equal(xp, XP.PET_DAILY_CAP); // 20
  assert.equal(counters.petsToday, XP.PET_DAILY_CAP);
  // fun capped long before stroke 30, XP kept flowing until 20
  assert.equal(counters.petFunToday, INTERACT.PET_TICKLE_FUN_DAILY_CAP);
});

test('caps roll over on a new local day', () => {
  const counters = { petsDay: '2026-07-15', petsToday: 20, petFunToday: 10, tickles: 3 };
  const r = applyPetTickleGain(counters, 'tickle', '2026-07-16');
  assert.equal(r.fun, INTERACT.TICKLE_FUN);
  assert.equal(r.xp, XP.PET);
  assert.equal(r.counters.petsDay, '2026-07-16');
  assert.equal(r.counters.petsToday, 1);
  assert.equal(r.counters.petFunToday, 2);
  assert.equal(r.counters.tickles, 4); // lifetime achievement counter keeps counting
});

// ---------------------------------------------------------------------------
// feed math (§C3, §C5.1)
// ---------------------------------------------------------------------------

test('feeding applies the food deltas verbatim and consumes inventory', () => {
  const r = feedGooby(
    { stats: { ...BASE_STATS }, inventory: { burger: 2 }, xp: 0, level: 1 },
    'burger'
  );
  assert.equal(r.ok, true);
  assert.equal(r.stats.hunger, 50 + FOODS_BY_ID.burger.deltas.hunger); // +40
  assert.equal(r.stats.fun, 50 + FOODS_BY_ID.burger.deltas.fun); // +6
  assert.equal(r.inventory.burger, 1);
  assert.equal(r.xp, XP.FEED); // 5 XP per feed (§C1.5)
  assert.equal(r.hungerDelta, 40); // float text "+40" (§C3)
  assert.equal(r.favorite, false);
});

test('feeding a carrot flags the favorite reaction; pizza greasy −2 hygiene', () => {
  const carrot = feedGooby(
    { stats: { ...BASE_STATS }, inventory: { carrot: 1 }, xp: 0, level: 1 },
    'carrot'
  );
  assert.equal(carrot.favorite, true);
  const pizza = feedGooby(
    { stats: { ...BASE_STATS }, inventory: { pizza: 1 }, xp: 0, level: 1 },
    'pizza'
  );
  assert.equal(pizza.stats.hygiene, 40 - 2);
});

test('refuse at hunger ≥ 95: nothing is consumed', () => {
  const at95 = feedGooby(
    { stats: { ...BASE_STATS, hunger: 95 }, inventory: { carrot: 3 }, xp: 0, level: 1 },
    'carrot'
  );
  assert.deepEqual(at95, { ok: false, reason: 'full' });
  const justBelow = feedGooby(
    { stats: { ...BASE_STATS, hunger: 94.9 }, inventory: { carrot: 3 }, xp: 0, level: 1 },
    'carrot'
  );
  assert.equal(justBelow.ok, true);
  assert.equal(justBelow.inventory.carrot, 2);
});

test('feeding without stock or with an unknown id fails cleanly', () => {
  assert.deepEqual(
    feedGooby({ stats: { ...BASE_STATS }, inventory: {}, xp: 0, level: 1 }, 'cake'),
    { ok: false, reason: 'none' }
  );
  assert.deepEqual(
    feedGooby({ stats: { ...BASE_STATS }, inventory: { x: 1 }, xp: 0, level: 1 }, 'x'),
    { ok: false, reason: 'unknown' }
  );
});

test('feeding XP can level up (level 1 → 2 pays 50 coins at 100 XP)', () => {
  const r = feedGooby(
    { stats: { ...BASE_STATS }, inventory: { carrot: 1 }, xp: 95, level: 1 },
    'carrot'
  );
  assert.equal(r.level, 2);
  assert.equal(r.levelsGained, 1);
  assert.equal(r.coinsAwarded, XP.LEVEL_UP_COINS_PER_LEVEL * 2);
  assert.equal(r.xp, 0);
});

test('stat deltas clamp to 100 (overfeeding)', () => {
  const r = feedGooby(
    { stats: { ...BASE_STATS, hunger: 90 }, inventory: { burger: 1 }, xp: 0, level: 1 },
    'burger'
  );
  assert.equal(r.stats.hunger, 100);
});

// --------------------------------------- V2/G20: sick-junk gate + junk flag (§C3.4)

test('V2/G20 feed: sick Gooby refuses junk food — healthy food still works', () => {
  const slice = {
    stats: { ...BASE_STATS },
    inventory: { cake: 1, carrot: 1 },
    xp: 0,
    level: 1,
    health: 'sick',
  };
  assert.deepEqual(feedGooby(slice, 'cake'), { ok: false, reason: 'sick' });
  assert.equal(slice.inventory.cake, 1, 'nothing consumed on refusal');
  const healthy = feedGooby(slice, 'carrot');
  assert.equal(healthy.ok, true);
  assert.equal(healthy.junk, false);
});

test('V2/G20 feed: queasy Gooby still eats junk (§C3.4 — only sick refuses)', () => {
  const r = feedGooby(
    { stats: { ...BASE_STATS }, inventory: { cake: 1 }, xp: 0, level: 1, health: 'queasy' },
    'cake'
  );
  assert.equal(r.ok, true);
  assert.equal(r.junk, true, 'junk flag reported for the wiring');
});

test('V2/G20 feed: missing health field (pre-2.0 saves) never blocks feeding', () => {
  const r = feedGooby(
    { stats: { ...BASE_STATS }, inventory: { cake: 1 }, xp: 0, level: 1 },
    'cake'
  );
  assert.equal(r.ok, true);
});

test('V2/G20 junkScoreBand: §B5 warn/sick thresholds → ok/warn/high (§C7 belly icon)', () => {
  assert.equal(junkScoreBand(0), 'ok');
  assert.equal(junkScoreBand(HEALTH.WARN_JUNK - 0.1), 'ok');
  assert.equal(junkScoreBand(HEALTH.WARN_JUNK), 'warn');
  assert.equal(junkScoreBand(HEALTH.SICK_JUNK - 0.1), 'warn');
  assert.equal(junkScoreBand(HEALTH.SICK_JUNK), 'high');
  assert.equal(junkScoreBand(undefined), 'ok', 'missing slice defaults to ok');
});

// ---------------------------------------------------------------------------
// wash (§C3): coverage accumulation + hygiene formula
// ---------------------------------------------------------------------------

test('coverage accumulates linearly with scrub distance and clamps at 1', () => {
  let cov = 0;
  cov = accumulateCoverage(cov, CARE_TUNING.WASH_SCRUB_PX_FULL / 2);
  assert.equal(cov, 0.5);
  cov = accumulateCoverage(cov, CARE_TUNING.WASH_SCRUB_PX_FULL);
  assert.equal(cov, 1);
  assert.equal(accumulateCoverage(0.98, -50), 0.98); // negative distance ignored
});

test('rinse: hygiene += 60 × coverage (§C3)', () => {
  const half = washRinse({ stats: { ...BASE_STATS }, xp: 0, level: 1 }, 0.5);
  assert.equal(half.hygieneGain, INTERACT.WASH_HYGIENE_FACTOR * 0.5); // 30
  assert.equal(half.stats.hygiene, 40 + 30);
  assert.equal(half.full, false);
  assert.equal(half.stats.fun, BASE_STATS.fun); // no fun bonus on partial wash
  assert.equal(half.xp, 0); // XP only on full wash (§C1.5)
});

test('full wash (coverage ≥ 0.99): +3 fun and XP 8', () => {
  assert.equal(isFullWash(CARE_TUNING.FULL_WASH_COVERAGE), true);
  assert.equal(isFullWash(CARE_TUNING.FULL_WASH_COVERAGE - 0.01), false);
  const r = washRinse({ stats: { ...BASE_STATS }, xp: 0, level: 1 }, 1);
  assert.equal(r.full, true);
  assert.equal(r.stats.hygiene, 100); // 40 + 60, clamped
  assert.equal(r.stats.fun, BASE_STATS.fun + INTERACT.FULL_WASH_FUN);
  assert.equal(r.xp, XP.FULL_WASH); // 8
});

test('rinse clamps hygiene at 100 and coverage into [0, 1]', () => {
  const r = washRinse({ stats: { ...BASE_STATS, hygiene: 90 }, xp: 0, level: 1 }, 5);
  assert.equal(r.hygieneGain, INTERACT.WASH_HYGIENE_FACTOR); // coverage clamped to 1
  assert.equal(r.stats.hygiene, 100);
});

// ---------------------------------------------------------------------------
// toilet gag (§C2/§C3): hygiene < 50 + 10-min persisted cooldown
// ---------------------------------------------------------------------------

test('toilet: needs hygiene < 50', () => {
  assert.equal(canUseToilet({ hygiene: 50, lastAt: 0 }, 1_000_000_000), 'noNeed');
  assert.equal(canUseToilet({ hygiene: 49.9, lastAt: 0 }, 1_000_000_000), 'ok');
});

test('toilet: 10-minute cooldown from the persisted timestamp', () => {
  const t0 = 1_700_000_000_000;
  const cd = INTERACT.TOILET_COOLDOWN_MIN * 60000;
  assert.equal(canUseToilet({ hygiene: 30, lastAt: t0 }, t0 + cd - 1), 'cooldown');
  assert.equal(canUseToilet({ hygiene: 30, lastAt: t0 }, t0 + cd), 'ok');
  assert.equal(canUseToilet({ hygiene: 30 }, t0), 'ok'); // never used before
});

// ---------------------------------------------------------------------------
// ball toss helpers (§C3)
// ---------------------------------------------------------------------------

test('flick velocity: screen-up flicks lift the ball, magnitude clamped', () => {
  const v = flickToVelocity({ vx: 400, vy: -900 }); // up-right flick
  assert.ok(v.x > 0);
  assert.ok(v.y > 0);
  const huge = flickToVelocity({ vx: 900000, vy: -900000 });
  const mag = Math.hypot(huge.x, huge.y, huge.z);
  assert.ok(mag <= CARE_TUNING.BALL.MAX_SPEED + 1e-9, `clamped, got ${mag}`);
});

test('ball ballistic: falls under gravity, bounces on the floor, comes to rest', () => {
  const B = CARE_TUNING.BALL;
  const ball = { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0.5, y: 0, z: 0 } };
  let bounces = 0;
  let resting = false;
  for (let i = 0; i < 5000 && !resting; i += 1) {
    const r = stepBall(ball, 1 / 120);
    if (r.bounced) bounces += 1;
    resting = r.resting;
  }
  assert.ok(bounces >= 1, `expected at least one floor bounce, got ${bounces}`);
  assert.ok(resting, 'ball should come to rest');
  assert.ok(Math.abs(ball.pos.y - B.RADIUS) < 0.03, 'rests on the floor plane');
  assert.ok(Math.abs(ball.pos.x) <= B.BOUND_X + 1e-9, 'stays inside the room bounds');
});

test('ball stays inside the room bounds on hard sideways throws', () => {
  const B = CARE_TUNING.BALL;
  const ball = { pos: { x: 0, y: B.RADIUS, z: 0 }, vel: { x: B.MAX_SPEED, y: 2, z: 3 } };
  for (let i = 0; i < 2000; i += 1) stepBall(ball, 1 / 120);
  assert.ok(Math.abs(ball.pos.x) <= B.BOUND_X + 1e-9);
  assert.ok(ball.pos.z >= B.BOUND_Z_MIN - 1e-9 && ball.pos.z <= B.BOUND_Z_MAX + 1e-9);
});

// ---------------------------------------------------------------------------
// V2/FIX-C (P1-2): careEmotionFor — the emotion restored after every care
// interaction must include the FULL derivation input set (health sick cap 39
// → grumpy band, night sleepy bias), not just {mood, stats}. Regression: a
// single pet used to make sick Gooby ecstatic forever.
// ---------------------------------------------------------------------------

// noon local — never in the night band (§B4: night is 21:00–06:00)
const NOON = new Date(2026, 6, 16, 12, 0, 0).getTime();
// 02:00 local — inside the night band
const NIGHT_2AM = new Date(2026, 6, 16, 2, 0, 0).getTime();

const careState = (over = {}) => ({
  stats: { hunger: 90, energy: 90, hygiene: 90, fun: 90 },
  health: { state: 'healthy' },
  sleep: { sleeping: false },
  grumpyUntil: 0,
  ...over,
});

test('V2/FIX-C careEmotionFor: sick Gooby stays grumpy-capped despite perfect stats', () => {
  const sick = careState({ health: { state: 'sick' } });
  // mood would be 90 (ecstatic band) but sick caps it at 39 → grumpy band
  assert.equal(careEmotionFor(sick, NOON), 'grumpy');
  assert.ok(STATS.EXHAUSTED_MOOD_CAP < 40, 'cap 39 sits inside the grumpy band');
});

test('V2/FIX-C careEmotionFor: recovery restores the normal mood-band face', () => {
  assert.equal(careEmotionFor(careState(), NOON), 'ecstatic');
  assert.equal(careEmotionFor(careState({ health: { state: 'queasy' } }), NOON), 'ecstatic');
  // pre-2.0 saves without a health slice never break the derivation
  assert.equal(careEmotionFor(careState({ health: undefined }), NOON), 'ecstatic');
});

test('V2/FIX-C careEmotionFor: early-wake grumpy debuff still applies (currentMood)', () => {
  const debuffed = careState({ grumpyUntil: NOON + 60_000 });
  // mood 90 − 15 debuff = 75 → happy band, not ecstatic
  assert.equal(careEmotionFor(debuffed, NOON), 'happy');
});

test('V2/FIX-C careEmotionFor: night band while awake feeds the sleepy tie-bias', () => {
  const tired = careState({ stats: { hunger: 5, energy: 10, hygiene: 90, fun: 90 } });
  // exhausted + starving at 02:00 awake → §C10.3 guarantees sleepy wins the tie
  // (the night flag makes the guarantee independent of statOverride ordering)
  assert.equal(careEmotionFor(tired, NIGHT_2AM), 'sleepy');
  assert.equal(careEmotionFor(tired, NOON), 'sleepy'); // exhausted override by day too
});

// ---------------------------------------------------------------------------
// §B purity: interactions.js must not statically import three.js/DOM modules
// ---------------------------------------------------------------------------

test('interactions.js has no static three.js import (pure helpers testable headlessly)', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/home/interactions.js', import.meta.url)),
    'utf8'
  );
  const staticImports = [...src.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gms)].map(
    (m) => m[1]
  );
  for (const spec of staticImports) {
    assert.ok(!/^three/.test(spec), `static three.js import found: '${spec}'`);
  }
});
