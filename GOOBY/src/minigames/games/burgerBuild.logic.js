// Burger Builder — pure ticket/matching/scoring logic (PLAN2 §C1.2 #3, agent
// V2/G24). No three.js/DOM imports so `node --test` runs this headlessly (§B
// rule); the game module (burgerBuild.js) imports from here. Binding §C1.2
// numbers: seeded 4–7-layer tickets (bun … bun), ingredients rain in 3
// columns, next-needed catch +5, wrong catch −2, completed burger +15 + bite,
// fall speed +8% per completed burger, 75 s round, score ≈ 60; autoplay chases
// the nearest falling next-needed column. Coin row (§C1.1): divisor 4, min 4,
// max 26, typical raw ≈ 60 → ~15c.

/** Binding §C1.2 #3 numbers + V2/G24 tuning (spawn mix, fall, bot model). */
export const BURGER = Object.freeze({
  /** Round length (§C1.2: 75 s). */
  DURATION_SEC: 75,
  /** Ingredients rain in 3 columns (§C1.2). */
  COLUMNS: 3,
  /** Tickets are 4–7 layers, seeded (§C1.2) — buns included. */
  MIN_LAYERS: 4,
  MAX_LAYERS: 7,
  /** Points (§C1.2): next-needed +5, wrong −2, completed burger +15. */
  CATCH_PTS: 5,
  WRONG_PTS: -2,
  COMPLETE_PTS: 15,
  /** Fall speed +8% per completed burger (§C1.2). */
  FALL_RAMP_PCT: 0.08,
  /** V2/G24 tuning: base fall speed (world units/s) and spawn cadence —
   * paced so typical rounds land near §C1.1's raw ≈ 60 (~2 burgers). */
  FALL_BASE_SPEED: 2.1,
  SPAWN_SEC: 1.5,
  /** V2/G24 tuning: chance a spawn is the next-needed layer … */
  NEXT_WEIGHT: 0.24,
  /** … with a starvation guard: force one after this many dry seconds. */
  FORCE_NEXT_SEC: 6,
  /** V2/G24 tuning: Gooby's comical bite pause after a completed burger. */
  BITE_SEC: 2.0,
  /** V2/G24 tuning: bot decision cadence + distraction odds (human-ish) —
   * tuned so 5-run raw scores land near §C1.1's typical ≈ 60 → ~15c. */
  AUTOPLAY_TICK_SEC: 0.3,
  AUTOPLAY_DISTRACT: 0.42,
  /** V3/G45 (§C10.2): every second and fourth ticket is a gold rush order. */
  RUSH_ORDER_NUMBERS: Object.freeze([2, 4]),
  /** Positive rush-order points are worth exactly ×1.5. */
  RUSH_SCORE_MULT: 1.5,
  /** Normal order deadline; rush tickets get 20% less time. */
  ORDER_TIMER_SEC: 30,
  RUSH_TIMER_MULT: 0.8,
  MAX_RUSH_ORDERS: 2,
  /** V4/G73 timed-arena hit window and Endlos failure budget. */
  PLATE_HALF_WIDTH: 0.78,
  ENDLESS: false,
  ENDLESS_EXPIRES: 3,
});

/** V4/G73 timed-arena mode rows (§G5.3). */
export const BURGER_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ spawnMult: 1.2, windowMult: 1.25, durationMult: 1.2, botSkill: 0.99, distract: 0.25 }),
  hard: Object.freeze({ spawnMult: 0.85, windowMult: 0.8, durationMult: 1, botSkill: 0.55, distract: 0.34 }),
  endless: Object.freeze({ spawnMult: 0.85, windowMult: 0.8, durationMult: 1, botSkill: 0.55, distract: 0.34 }),
});

/** Derive a frozen tune; normal is the exact existing table. */
export function applyDifficulty(tune = BURGER, mode = 'normal') {
  if (mode === 'normal' || !Object.hasOwn(BURGER_DIFFICULTY, mode)) return tune;
  const row = BURGER_DIFFICULTY[mode];
  return Object.freeze({
    ...tune,
    DURATION_SEC: tune.DURATION_SEC * row.durationMult,
    SPAWN_SEC: tune.SPAWN_SEC * row.spawnMult,
    ORDER_TIMER_SEC: Math.max(0.35, tune.ORDER_TIMER_SEC * row.windowMult),
    PLATE_HALF_WIDTH: Math.max(tune.PLATE_HALF_WIDTH * 0.55, tune.PLATE_HALF_WIDTH * row.windowMult),
    ENDLESS: mode === 'endless',
    BOT_SKILL: row.botSkill,
    AUTOPLAY_DISTRACT: row.distract,
  });
}

/** The 5 middle-layer ingredients (§C1.2 — bun/patty/cheese/tomato/salad/onion). */
export const INGREDIENTS = Object.freeze(['patty', 'cheese', 'tomato', 'salad', 'onion']);

/** Kenney food-kit GLB key per falling middle layer (committed since wave 1). */
export const MODEL_KEYS = Object.freeze({
  patty: 'food-kit/meat-patty',
  cheese: 'food-kit/cheese-cut',
  tomato: 'food-kit/tomato-slice',
  salad: 'food-kit/salad',
  onion: 'food-kit/onion',
});

/** Every id that can rain (buns are procedural in the game module). */
export const FALLING_IDS = Object.freeze(['bun', ...INGREDIENTS]);

/**
 * Generate a seeded 4–7-layer ticket (§C1.2): bottom-to-top layer ids, always
 * bun-capped ('bun' at both ends), middles uniform from INGREDIENTS.
 * @param {() => number} rng 0..1
 * @returns {string[]} e.g. ['bun','patty','cheese','bun']
 */
export function makeTicket(rng) {
  const total = BURGER.MIN_LAYERS + Math.floor(rng() * (BURGER.MAX_LAYERS - BURGER.MIN_LAYERS + 1));
  const layers = ['bun'];
  for (let i = 0; i < total - 2; i += 1) {
    layers.push(INGREDIENTS[Math.min(INGREDIENTS.length - 1, Math.floor(rng() * INGREDIENTS.length))]);
  }
  layers.push('bun');
  return layers;
}

/**
 * The next layer id the plate needs, or null once the ticket is complete.
 * @param {string[]} ticket layer ids bottom-to-top
 * @param {number} placed layers already stacked
 * @returns {string|null}
 */
export function nextNeeded(ticket, placed) {
  return placed >= 0 && placed < ticket.length ? ticket[placed] : null;
}

/**
 * Whether the whole ticket is stacked.
 * @param {string[]} ticket
 * @param {number} placed
 * @returns {boolean}
 */
export function isComplete(ticket, placed) {
  return placed >= ticket.length;
}

/**
 * Fall speed (world units/s) after N completed burgers: +8% each (§C1.2).
 * @param {number} completedBurgers
 * @returns {number}
 */
export function fallSpeedAt(completedBurgers, tune = BURGER) {
  return tune.FALL_BASE_SPEED * Math.pow(1 + tune.FALL_RAMP_PCT, Math.max(0, completedBurgers));
}

/**
 * Three data-driven column centers for any portrait viewport. Keeping this
 * math pure makes the 393 px drift audit reproducible without DOM state.
 * @param {number} halfW visible world half-width
 * @returns {readonly number[]}
 */
export function columnCenters(halfW) {
  const spacing = Math.max(0, Math.min(2.1, halfW - 0.95));
  return Object.freeze([-spacing, 0, spacing]);
}

/**
 * Rush tickets are deterministic orders 2 and 4, hence never exceed two per
 * round even when earlier orders time out.
 * @param {number} orderNumber 1-based
 * @returns {boolean}
 */
export function isRushOrder(orderNumber) {
  return BURGER.RUSH_ORDER_NUMBERS.includes(Math.floor(orderNumber));
}

/**
 * Per-order deadline: rush orders are exactly 20% shorter (§C10.2).
 * @param {boolean} rush
 * @returns {number} seconds
 */
export function orderTimerSec(rush, tune = BURGER) {
  return tune.ORDER_TIMER_SEC * (rush ? tune.RUSH_TIMER_MULT : 1);
}

/**
 * Scale positive points for a gold rush ticket. Penalties stay unchanged so
 * a rush ticket is a reward opportunity, not a harsher wrong-catch rule.
 * @param {number} points
 * @param {boolean} rush
 * @returns {number}
 */
export function orderPoints(points, rush) {
  return points > 0 && rush ? points * BURGER.RUSH_SCORE_MULT : points;
}

/**
 * Roll the id of the next falling item: the next-needed layer when forced by
 * the starvation guard or the NEXT_WEIGHT roll, otherwise a uniform pick from
 * every raining id (buns included — wrong-catch bait).
 * @param {() => number} rng 0..1
 * @param {string|null} needed next-needed layer id (null = ticket complete)
 * @param {number} sinceNeededSec seconds since a next-needed item last spawned
 * @returns {string}
 */
export function rollSpawn(rng, needed, sinceNeededSec, tune = BURGER) {
  if (needed != null && (sinceNeededSec >= tune.FORCE_NEXT_SEC || rng() < tune.NEXT_WEIGHT)) {
    return needed;
  }
  const pick = FALLING_IDS[Math.min(FALLING_IDS.length - 1, Math.floor(rng() * FALLING_IDS.length))];
  return pick;
}

/**
 * Apply a catch to the score (floored at 0, carrotCatch convention): correct
 * next-needed +5, wrong −2 (§C1.2).
 * @param {number} score current score
 * @param {boolean} correct whether the caught item was the next-needed layer
 * @returns {number} new score ≥ 0
 */
export function applyCatch(score, correct, rush = false, tune = BURGER) {
  const points = correct ? orderPoints(tune.CATCH_PTS, rush) : tune.WRONG_PTS;
  return Math.max(0, score + points);
}

/** §G5.4 Endlos ends after three expired orders. */
export function endlessShouldEnd(expired, tune = BURGER) {
  return tune.ENDLESS === true && expired >= tune.ENDLESS_EXPIRES;
}

/** Deterministic tune-driven certification for the existing chase bot. */
export function simulateAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(BURGER, mode);
  let a = seed >>> 0;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) | 0;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  let elapsed = 0;
  let score = 0;
  let completed = 0;
  let expired = 0;
  let orderNumber = 1;
  const limit = tune.ENDLESS ? 600 : tune.DURATION_SEC;
  while (elapsed < limit && !endlessShouldEnd(expired, tune)) {
    const ticket = makeTicket(rng);
    const rush = isRushOrder(orderNumber);
    const skill = tune.BOT_SKILL ?? 0.95;
    const buildSec = ticket.length * tune.SPAWN_SEC * (1.45 + rng() * 0.25) / skill;
    const deadline = orderTimerSec(rush, tune);
    if (buildSec <= deadline) {
      elapsed += buildSec + tune.BITE_SEC;
      score += orderPoints(ticket.length * tune.CATCH_PTS + tune.COMPLETE_PTS, rush);
      completed += 1;
    } else {
      elapsed += deadline;
      expired += 1;
    }
    orderNumber += 1;
  }
  return Object.freeze({ seed, mode, score, completed, expired });
}
