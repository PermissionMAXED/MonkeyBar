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
});

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
export function fallSpeedAt(completedBurgers) {
  return BURGER.FALL_BASE_SPEED * Math.pow(1 + BURGER.FALL_RAMP_PCT, Math.max(0, completedBurgers));
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
export function rollSpawn(rng, needed, sinceNeededSec) {
  if (needed != null && (sinceNeededSec >= BURGER.FORCE_NEXT_SEC || rng() < BURGER.NEXT_WEIGHT)) {
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
export function applyCatch(score, correct) {
  return Math.max(0, score + (correct ? BURGER.CATCH_PTS : BURGER.WRONG_PTS));
}
