// Carrot Catch — pure scoring/ramp logic (§C6.1 #2, agent G8). No three.js/DOM
// imports so `node --test` runs this headlessly (§B rule); the game module
// (carrotCatch.js) imports from here. Binding §C6.1 numbers: 60 s round, good
// food +1–3 pts by rarity, junk −2 and 0.5 s dizzy, fall speed +8%/10 s, junk
// ratio ramps 10%→30%. Coin row (§C6): divisor 3, min 4, max 25, typical raw
// score ≈ 45 → ~15c.

/** Binding §C6.1 #2 numbers + G8 tuning (spawn cadence, catch geometry). */
export const CATCH = Object.freeze({
  /** Round length (§C6.1: 60 s). */
  DURATION_SEC: 60,
  /** Fall speed ramp: +8% every 10 s (§C6.1). */
  FALL_RAMP_PCT: 0.08,
  FALL_RAMP_EVERY_SEC: 10,
  /** Junk ratio ramps 10% → 30% across the round (§C6.1). */
  JUNK_RATIO_START: 0.1,
  JUNK_RATIO_END: 0.3,
  /** Junk catch: −2 points and 0.5 s dizzy (§C6.1). */
  JUNK_PENALTY: -2,
  DIZZY_SEC: 0.5,
  /** V3 §C10.2: one +10 golden carrot per run, falling 1.5× speed. */
  GOLDEN_POINTS: 10,
  GOLDEN_SPEED_MULT: 1.5,
  GOLDEN_WINDOW_START_SEC: 15,
  GOLDEN_WINDOW_END_SEC: 35,
  /** Leave enough flight time for the golden carrot in the 30 s tutorial run. */
  GOLDEN_FALL_LEAD_SEC: 5,
  /** Rotten carrots share the junk budget and break the good-catch streak. */
  ROTTEN_RATIO_OF_JUNK: 0.35,
  /** Catch/spawn geometry stays in world space and is independent of UI scale. */
  BASKET_HALF_WIDTH: 0.62,
  SPAWN_EDGE_PAD: 0.5,
  /** G8 tuning: base fall speed (world units/s) and spawn cadence. */
  FALL_BASE_SPEED: 2.3,
  SPAWN_BASE_SEC: 1.05,
  /** Spawn interval shrinks to this fraction by the end of the round. */
  SPAWN_END_FRACTION: 0.72,
});

/**
 * Good-food rarity table (§C6.1: +1–3 pts by rarity). Keys are Kenney
 * food-kit asset names; weights sum per tier drive the expected item value
 * (≈ 1.6 pts/catch → typical raw score ≈ 45 over a 60 s round).
 */
export const GOOD_FOODS = Object.freeze([
  // common (+1)
  Object.freeze({ key: 'carrot', value: 1, weight: 26 }),
  Object.freeze({ key: 'apple', value: 1, weight: 15 }),
  Object.freeze({ key: 'banana', value: 1, weight: 14 }),
  // uncommon (+2)
  Object.freeze({ key: 'cheese', value: 2, weight: 8 }),
  Object.freeze({ key: 'watermelon', value: 2, weight: 8 }),
  Object.freeze({ key: 'donut-sprinkles', value: 2, weight: 7 }),
  Object.freeze({ key: 'cupcake', value: 2, weight: 7 }),
  // rare (+3)
  Object.freeze({ key: 'burger', value: 3, weight: 6 }),
  Object.freeze({ key: 'ice-cream', value: 3, weight: 5 }),
  Object.freeze({ key: 'cake', value: 3, weight: 4 }),
]);

/** Junk items (§C6.1: crushed soda can, fish bones). */
export const JUNK_FOODS = Object.freeze(['soda-can-crushed', 'fish-bones']);

/**
 * Fall-speed multiplier at a moment of the round: +8% per full 10 s elapsed
 * (§C6.1 — stepped, not continuous).
 * @param {number} elapsed seconds since round start
 * @returns {number} multiplier ≥ 1
 */
export function fallSpeedMultAt(elapsed) {
  const steps = Math.max(0, Math.floor(elapsed / CATCH.FALL_RAMP_EVERY_SEC));
  return Math.pow(1 + CATCH.FALL_RAMP_PCT, steps);
}

/**
 * Fall speed (world units/s) at a moment of the round.
 * @param {number} elapsed seconds
 * @returns {number}
 */
export function fallSpeedAt(elapsed) {
  return CATCH.FALL_BASE_SPEED * fallSpeedMultAt(elapsed);
}

/**
 * Junk probability at a moment of the round: linear 10% → 30% (§C6.1).
 * @param {number} elapsed seconds
 * @param {number} [duration] round length (defaults to the §C6.1 60 s)
 * @returns {number} 0.1 … 0.3
 */
export function junkRatioAt(elapsed, duration = CATCH.DURATION_SEC) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return CATCH.JUNK_RATIO_START + (CATCH.JUNK_RATIO_END - CATCH.JUNK_RATIO_START) * t;
}

/**
 * Seconds until the next item spawn (cadence tightens over the round).
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number}
 */
export function spawnIntervalAt(elapsed, duration = CATCH.DURATION_SEC) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return CATCH.SPAWN_BASE_SEC * (1 - (1 - CATCH.SPAWN_END_FRACTION) * t);
}

/**
 * Roll the next falling item: junk with `junkRatioAt` probability, otherwise a
 * weighted rarity pick from GOOD_FOODS.
 * @param {() => number} rng 0..1
 * @param {number} elapsed seconds since round start
 * @returns {{kind: 'good'|'junk', key: string, value: number}}
 */
export function rollItem(rng, elapsed) {
  if (rng() < junkRatioAt(elapsed)) {
    if (rng() < CATCH.ROTTEN_RATIO_OF_JUNK) {
      return { kind: 'rotten', key: 'carrot', value: CATCH.JUNK_PENALTY };
    }
    const key = JUNK_FOODS[Math.min(JUNK_FOODS.length - 1, Math.floor(rng() * JUNK_FOODS.length))];
    return { kind: 'junk', key, value: CATCH.JUNK_PENALTY };
  }
  const total = GOOD_FOODS.reduce((s, f) => s + f.weight, 0);
  let roll = rng() * total;
  for (const f of GOOD_FOODS) {
    roll -= f.weight;
    if (roll < 0) return { kind: 'good', key: f.key, value: f.value };
  }
  const last = GOOD_FOODS[GOOD_FOODS.length - 1];
  return { kind: 'good', key: last.key, value: last.value };
}

/**
 * Apply a catch to the score. Junk penalty math: −2, floored at 0 (the round
 * score never goes negative — coin clamp min 4 covers the floor anyway).
 * @param {number} score current score
 * @param {number} value item value (+1…+3 good, −2 junk)
 * @returns {number} new score ≥ 0
 */
export function applyCatch(score, value) {
  return Math.max(0, score + value);
}

/**
 * Seed the guaranteed golden-carrot spawn inside the middle of the run.
 * @param {() => number} rng
 * @param {number} [duration] run length (the onboarding variant is 30 s)
 * @returns {number} elapsed seconds
 */
export function goldenSpawnAt(rng, duration = CATCH.DURATION_SEC) {
  const latest = Math.max(
    0,
    Math.min(CATCH.GOLDEN_WINDOW_END_SEC, duration - CATCH.GOLDEN_FALL_LEAD_SEC)
  );
  const earliest = Math.min(CATCH.GOLDEN_WINDOW_START_SEC, latest);
  return earliest + rng() * (latest - earliest);
}

/**
 * Per-kind falling speed. The one golden carrot falls exactly 1.5×.
 * @param {number} elapsed
 * @param {'good'|'junk'|'rotten'|'golden'} kind
 * @returns {number}
 */
export function itemFallSpeed(elapsed, kind) {
  return fallSpeedAt(elapsed) * (kind === 'golden' ? CATCH.GOLDEN_SPEED_MULT : 1);
}

/**
 * Uniform edge-to-edge spawn mapping used by the runtime and bias audit.
 * @param {number} roll rng sample 0..1
 * @param {number} halfW visible world half-width
 * @returns {number}
 */
export function spawnXForRoll(roll, halfW) {
  const bound = Math.max(0, halfW - CATCH.SPAWN_EDGE_PAD);
  return (Math.min(1, Math.max(0, roll)) * 2 - 1) * bound;
}

/**
 * Basket hitbox audit surface. UI scale cannot affect this world-space test.
 * @param {number} itemX
 * @param {number} basketX
 * @returns {boolean}
 */
export function basketCatchesX(itemX, basketX) {
  return Math.abs(itemX - basketX) <= CATCH.BASKET_HALF_WIDTH + Number.EPSILON * 8;
}

/**
 * Apply an item to score/streak state. Rotten carrots are the named V3
 * streak-breaker; other junk also cannot extend a clean catch streak.
 * @param {{score: number, combo: number}} state
 * @param {{kind: 'good'|'junk'|'rotten'|'golden', value: number}} item
 * @returns {{score: number, combo: number, delta: number}}
 */
export function applyCatchState(state, item) {
  const score = applyCatch(state.score, item.value);
  const good = item.kind === 'good' || item.kind === 'golden';
  return {
    score,
    combo: good ? state.combo + 1 : 0,
    delta: score - state.score,
  };
}
