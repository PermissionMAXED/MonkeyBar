// Weight & fitness model (§B5/§C4) — PURE module: no three.js/DOM imports so
// node:test runs it headlessly. Cosmetic-ONLY (§C4.2 binding): weight never
// changes stats, decay rates, minigame availability, scores or prices — it
// only drives Gooby's silhouette (tier scale), anim flavor and two
// achievements.
//
// All functions are pure slice-in/slice-out on the §B2 `weight` slice
// `{ value }` (single scalar, clamp [5, 95], default 50): they return NEW
// objects and never mutate their input. Wave-2 (G20) wires onEat into the
// feeding pipeline, onMinigameEnd into the framework results hook, onBallFetch
// into the ball toy, and tick into the stats tick + offline sim. Exact
// numbers live in WEIGHT below (§E0.1-2: engine consts stay in-module).

/**
 * Binding §B5/§C4 weight numbers.
 */
export const WEIGHT = Object.freeze({
  /** Clamp range + start value (§B5). */
  MIN: 5,
  MAX: 95,
  DEFAULT: 50,
  /** onEat deltas (§B5): junk +2.0, healthy +0.5. */
  EAT_JUNK: 2,
  EAT_HEALTHY: 0.5,
  /** onMinigameEnd deltas (§B5): active games −1.0, all others −0.25. */
  GAME_ACTIVE: -1,
  GAME_OTHER: -0.25,
  /** onBallFetch delta (§B5): −0.2. */
  BALL_FETCH: -0.2,
  /** Passive drift: toward 50 at ±2.0 per 24 h (§B5). */
  DRIFT_TARGET: 50,
  DRIFT_PER_DAY: 2,
  /** = 2/1440 ≈ 0.00139/min (§B5). */
  DRIFT_PER_MIN: 2 / 1440,
  /**
   * "Active" minigames burning the full −1.0 (§B5 list verbatim; the four
   * wave-3/4 ids are forward references — just strings, fine before the
   * games land).
   */
  ACTIVE_GAMES: Object.freeze([
    'runner',
    'trampoline',
    'danceParty',
    'bunnyHop',
    'gardenRush',
    'veggieChop',
    'goalieGooby',
    'starHopper',
  ]),
  /** Tier boundaries (§C4.3, hysteresis-free): ≤ 25 / ≤ 60 / ≤ 85 / above. */
  TIER_SLEEK_MAX: 25,
  TIER_CHUBBY_MAX: 60,
  TIER_CHONKY_MAX: 85,
  /** Tier ids in ascending weight order (§C4.3). */
  TIERS: Object.freeze(['sleek', 'chubby', 'chonky', 'floof']),
  /** Tier → body X/Z scale on the lathe body + belly patch (§C4.3, wave-2 visuals). */
  TIER_SCALE: Object.freeze({ sleek: 0.93, chubby: 1.0, chonky: 1.07, floof: 1.14 }),
});

/**
 * @typedef {Object} WeightSlice
 * @property {number} value 5–95, default 50
 */

/**
 * Clamp a weight value to [5, 95] (§B5).
 * @param {number} v
 * @returns {number}
 */
export function clampWeight(v) {
  const n = Number.isFinite(Number(v)) ? Number(v) : WEIGHT.DEFAULT;
  return Math.min(WEIGHT.MAX, Math.max(WEIGHT.MIN, n));
}

/**
 * Normalized copy of a weight slice.
 * @param {Partial<WeightSlice>|undefined} w
 * @returns {WeightSlice}
 */
function normalize(w) {
  return { value: clampWeight(w?.value ?? WEIGHT.DEFAULT) };
}

/**
 * Apply a feeding (§B5): junk +2.0, healthy +0.5. Pure — returns a new slice.
 * @param {WeightSlice} w
 * @param {{junk?: boolean}} food a FOOD_TABLE row (only `.junk` is read)
 * @returns {WeightSlice}
 */
export function onEat(w, food) {
  const s = normalize(w);
  return { value: clampWeight(s.value + (food?.junk ? WEIGHT.EAT_JUNK : WEIGHT.EAT_HEALTHY)) };
}

/**
 * Apply a finished minigame (§B5): WEIGHT.ACTIVE_GAMES −1.0, all other games
 * −0.25. Pure — returns a new slice.
 * @param {WeightSlice} w
 * @param {string} gameId minigame id (data/minigames.js)
 * @returns {WeightSlice}
 */
export function onMinigameEnd(w, gameId) {
  const s = normalize(w);
  const delta = WEIGHT.ACTIVE_GAMES.includes(gameId) ? WEIGHT.GAME_ACTIVE : WEIGHT.GAME_OTHER;
  return { value: clampWeight(s.value + delta) };
}

/**
 * Apply a ball-toy fetch (§B5): −0.2. Pure — returns a new slice.
 * @param {WeightSlice} w
 * @returns {WeightSlice}
 */
export function onBallFetch(w) {
  const s = normalize(w);
  return { value: clampWeight(s.value + WEIGHT.BALL_FETCH) };
}

/**
 * Passive drift toward 50 at ±2.0 per 24 h (§B5), never overshooting the
 * target. Pure — returns a new slice.
 * Offline sim (§E4 rules): callers pass `mult = 0.3` and cap dtMin at 480
 * sim-minutes themselves (same contract as stats.applyTick).
 * @param {WeightSlice} w
 * @param {number} dtMin elapsed real minutes
 * @param {number} [mult] rate multiplier (offline callers pass 0.3)
 * @returns {WeightSlice}
 */
export function tick(w, dtMin, mult = 1) {
  const s = normalize(w);
  const step = WEIGHT.DRIFT_PER_MIN * Math.max(0, Number(dtMin) || 0) * mult;
  let v = s.value;
  if (v > WEIGHT.DRIFT_TARGET) v = Math.max(WEIGHT.DRIFT_TARGET, v - step);
  else if (v < WEIGHT.DRIFT_TARGET) v = Math.min(WEIGHT.DRIFT_TARGET, v + step);
  return { value: clampWeight(v) };
}

/**
 * Cosmetic tier for a weight value (§C4.3, exact hysteresis-free boundaries):
 * ≤ 25 sleek · ≤ 60 chubby (default) · ≤ 85 chonky · > 85 floof.
 * @param {number} value weight 5–95
 * @returns {'sleek'|'chubby'|'chonky'|'floof'}
 */
export function tierOf(value) {
  const v = Number(value);
  if (v <= WEIGHT.TIER_SLEEK_MAX) return 'sleek';
  if (v <= WEIGHT.TIER_CHUBBY_MAX) return 'chubby';
  if (v <= WEIGHT.TIER_CHONKY_MAX) return 'chonky';
  return 'floof';
}
