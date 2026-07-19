// Watering Rush — pure wilt/fill/scoring logic (PLAN2 §C1.2 #2, agent V2/G24).
// No three.js/DOM imports so `node --test` runs this headlessly (§B rule); the
// game module (gardenRush.js) imports from here. Binding §C1.2 numbers: 8 pots,
// wilt window 6 s ramping to 3 s, hold-to-fill 0.8 s, release in the last 25%
// of the ring = perfect +3, early +1, full wilt −2 + respawn, decoy weeds −1,
// 60 s round, score ≈ 40; autoplay targets the lowest remaining wilt and holds
// 0.75 s. Coin row (§C1.1): divisor 3, min 4, max 25, typical ≈ 42 → ~14c.

/** Binding §C1.2 #2 numbers + V2/G24 tuning (spawn cadence, waves, bot). */
export const RUSH = Object.freeze({
  /** Round length (§C1.2: 60 s). */
  DURATION_SEC: 60,
  /** 8 pots total (§C1.2); pots #7–8 join in waves. */
  POTS: 8,
  START_POTS: 6,
  /** V2/G24 tuning: when pots #7 and #8 activate ("waves add pots #7–8"). */
  POT7_AT_SEC: 20,
  POT8_AT_SEC: 35,
  /** Wilt window 6 s → ramps to 3 s across the round (§C1.2). */
  WILT_START_SEC: 6,
  WILT_END_SEC: 3,
  /** Hold-to-fill ring duration (§C1.2: 0.8 s). */
  FILL_SEC: 0.8,
  /** Green zone = the last 25% of the ring (§C1.2). */
  PERFECT_ZONE: 0.25,
  /** Points (§C1.2): perfect +3, early +1, full wilt −2, weed −1. */
  PERFECT_PTS: 3,
  EARLY_PTS: 1,
  WILT_PTS: -2,
  WEED_PTS: -1,
  /** V2/G24 tuning: global sprout cadence (seconds between spawns). */
  SPAWN_START_SEC: 3.1,
  SPAWN_END_SEC: 2.0,
  /** V2/G24 tuning: pot cooldown after a sprout resolves. */
  RESPAWN_SEC: 0.9,
  /** V2/G24 tuning: decoy weeds appear from this time at this chance. */
  WEED_FROM_SEC: 12,
  WEED_CHANCE: 0.18,
  /** V2/G24 tuning: an ignored weed retreats on its own after this long. */
  WEED_LIFE_SEC: 5,
  /** Autoplay holds 0.75 s (§C1.2) → fill 93.75% ⇒ inside the green zone. */
  AUTOPLAY_HOLD_SEC: 0.75,
  /** V3/G45 (§C10.2): the one-per-run sprinkler appears at 30 s. */
  SPRINKLER_AT_SEC: 30,
  /** Sprinkler restores half of every live plant's wilt ring. */
  SPRINKLER_FILL_FRAC: 0.5,
  /** V4/G73 §G5 defaults: normal is timer-bound; Endlos ends at 3 wilts. */
  ENDLESS: false,
  ENDLESS_WILTS: 3,
  AUTOPLAY_DISTRACT: 0.32,
  AUTOPLAY_EARLY: 0.18,
});

/** V4/G73 timed-arena multipliers (§G5.3). */
export const RUSH_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ spawnMult: 1.2, windowMult: 1.25, durationMult: 1.2, botSuccess: 0.995, distract: 0.18 }),
  hard: Object.freeze({ spawnMult: 0.85, windowMult: 0.8, durationMult: 1, botSuccess: 0.77, distract: 0.26 }),
  endless: Object.freeze({ spawnMult: 0.85, windowMult: 0.8, durationMult: 1, botSuccess: 0.77, distract: 0.26 }),
});

/** Derive a frozen tune; normal returns the bit-identical Mittel table. */
export function applyDifficulty(tune = RUSH, mode = 'normal') {
  if (mode === 'normal' || !Object.hasOwn(RUSH_DIFFICULTY, mode)) return tune;
  const row = RUSH_DIFFICULTY[mode];
  return Object.freeze({
    ...tune,
    DURATION_SEC: tune.DURATION_SEC * row.durationMult,
    SPAWN_START_SEC: tune.SPAWN_START_SEC * row.spawnMult,
    SPAWN_END_SEC: tune.SPAWN_END_SEC * row.spawnMult,
    WILT_START_SEC: Math.max(0.35, tune.WILT_START_SEC * row.windowMult),
    WILT_END_SEC: Math.max(0.35, tune.WILT_END_SEC * row.windowMult),
    FILL_SEC: Math.max(0.35, tune.FILL_SEC * row.windowMult),
    ENDLESS: mode === 'endless',
    ENDLESS_SPAWN_FLOOR_SEC: 1,
    ENDLESS_WILT_FLOOR_SEC: 1.2,
    AUTOPLAY_SUCCESS: row.botSuccess,
    AUTOPLAY_DISTRACT: row.distract,
  });
}

/**
 * Wilt window at a moment of the round: linear 6 s → 3 s (§C1.2), clamped.
 * @param {number} elapsed seconds since round start
 * @param {number} [duration] round length (defaults to the §C1.2 60 s)
 * @returns {number} seconds a fresh sprout survives unwatered
 */
export function wiltWindowAt(elapsed, duration = RUSH.DURATION_SEC, tune = RUSH) {
  const t = tune.ENDLESS
    ? Math.max(0, elapsed / duration)
    : Math.min(1, Math.max(0, elapsed / duration));
  const value = tune.WILT_START_SEC + (tune.WILT_END_SEC - tune.WILT_START_SEC) * t;
  return Math.max(tune.ENDLESS_WILT_FLOOR_SEC ?? tune.WILT_END_SEC, value);
}

/**
 * Seconds until the next sprout/weed spawn (cadence tightens over the round).
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number}
 */
export function spawnIntervalAt(elapsed, duration = RUSH.DURATION_SEC, tune = RUSH) {
  const t = tune.ENDLESS
    ? Math.max(0, elapsed / duration)
    : Math.min(1, Math.max(0, elapsed / duration));
  const value = tune.SPAWN_START_SEC + (tune.SPAWN_END_SEC - tune.SPAWN_START_SEC) * t;
  return Math.max(tune.ENDLESS_SPAWN_FLOOR_SEC ?? tune.SPAWN_END_SEC, value);
}

/**
 * How many pots are active at a moment of the round: 6, then #7 at 20 s and
 * #8 at 35 s ("waves add pots #7–8", §C1.2).
 * @param {number} elapsed seconds
 * @returns {number} 6 | 7 | 8
 */
export function activePotsAt(elapsed) {
  if (elapsed >= RUSH.POT8_AT_SEC) return 8;
  if (elapsed >= RUSH.POT7_AT_SEC) return 7;
  return RUSH.START_POTS;
}

/**
 * Points for releasing the watering hold at a fill fraction (§C1.2): inside
 * the last 25% of the ring = perfect +3, anything earlier = ok +1. The ring
 * clamps at full, so holding past 0.8 s still releases perfect.
 * @param {number} fillFrac 0..1 fraction of the 0.8 s ring filled
 * @returns {number} +3 | +1
 */
export function releasePoints(fillFrac, tune = RUSH) {
  const f = Math.min(1, Math.max(0, fillFrac));
  return f >= 1 - tune.PERFECT_ZONE ? tune.PERFECT_PTS : tune.EARLY_PTS;
}

/**
 * Whether a fill fraction sits in the green zone (ring rendering + tests).
 * @param {number} fillFrac 0..1
 * @returns {boolean}
 */
export function inPerfectZone(fillFrac, tune = RUSH) {
  return Math.min(1, Math.max(0, fillFrac)) >= 1 - tune.PERFECT_ZONE;
}

/**
 * Fill fraction from actual hold duration. Scoring calls this with pointer
 * timestamps, so a release between slow render frames is not quantized to
 * the previous RAF tick (§C10.2 audit).
 * @param {number} heldSec
 * @returns {number} clamped 0..1
 */
export function holdFillFraction(heldSec, tune = RUSH) {
  return Math.min(1, Math.max(0, heldSec / tune.FILL_SEC));
}

/**
 * Restore one live plant's wilt ring by the sprinkler's 50%, capped at full.
 * @param {number} remainingSec
 * @param {number} windowSec
 * @returns {number}
 */
export function sprinklerRefill(remainingSec, windowSec) {
  const window = Math.max(0, windowSec);
  return Math.min(window, Math.max(0, remainingSec) + window * RUSH.SPRINKLER_FILL_FRAC);
}

/**
 * One-shot 30 s spawn gate, robust when a frame crosses the threshold.
 * @param {number} elapsed
 * @param {boolean} alreadySpawned
 * @returns {boolean}
 */
export function shouldSpawnSprinkler(elapsed, alreadySpawned) {
  return !alreadySpawned && elapsed >= RUSH.SPRINKLER_AT_SEC;
}

/**
 * Whether a spawn should be a decoy weed (§C1.2 "waves add … decoy weeds").
 * @param {() => number} rng 0..1
 * @param {number} elapsed seconds
 * @returns {boolean}
 */
export function rollWeed(rng, elapsed) {
  if (elapsed < RUSH.WEED_FROM_SEC) return false;
  return rng() < RUSH.WEED_CHANCE;
}

/**
 * Apply a scoring event to the round score, floored at 0 (coin clamp min 4
 * covers the floor anyway — same convention as carrotCatch.logic.applyCatch).
 * @param {number} score current score
 * @param {number} points event points (+3/+1/−2/−1)
 * @returns {number} new score ≥ 0
 */
export function applyPoints(score, points) {
  return Math.max(0, score + points);
}

/** §G5.4 Endlos ends after three cumulative withered pots. */
export function endlessShouldEnd(withered, tune = RUSH) {
  return tune.ENDLESS === true && withered >= tune.ENDLESS_WILTS;
}

/** Deterministic, tune-driven autoplay certification model. */
export function simulateAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(RUSH, mode);
  let a = seed >>> 0;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) | 0;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const duration = tune.DURATION_SEC;
  const limit = tune.ENDLESS ? 600 : duration;
  let elapsed = 0;
  let score = 0;
  let withered = 0;
  const success = tune.AUTOPLAY_SUCCESS ?? 0.97;
  while (elapsed < limit && !endlessShouldEnd(withered, tune)) {
    elapsed += spawnIntervalAt(elapsed, duration, tune);
    if (elapsed > limit) break;
    if (rng() < success) score += tune.PERFECT_PTS;
    else withered += 1;
  }
  return Object.freeze({ seed, mode, score, withered, elapsed });
}
