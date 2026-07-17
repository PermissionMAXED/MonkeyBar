// Gooby Says — pure sequence/scoring logic (PLAN2 §C1.2 #1, agent V2/G24).
// No three.js/DOM imports so `node --test` runs this headlessly (§B rule); the
// game module (goobySays.js) imports from here. Binding §C1.2 numbers:
// sequence starts at 3, +1 per round; playback speeds up 5%/round with a
// 320 ms/step floor; one mistake ends the round; score = 10·roundsCompleted +
// speedBonus (0–8, average reaction < 500 ms/step = 8); autoplay replays the
// emitted sequence at 250 ms taps. Coin row (§C1.1): divisor 5, min 4, max 24,
// typical raw score ≈ 80 → ~16c.

/** Binding §C1.2 #1 numbers + V2/G24 tuning (playback cadence, bot model). */
export const SAYS = Object.freeze({
  /** Number of pads on the stage (§C1.2: four chunky pastel pads). */
  PADS: 4,
  /** Sequence starts at 3 steps (§C1.2). */
  START_LEN: 3,
  /** +1 step per round (§C1.2). */
  GROW_PER_ROUND: 1,
  /** Points per completed round (§C1.2: score = 10·rounds + speedBonus). */
  ROUND_POINTS: 10,
  /** Playback speeds up 5% per round (§C1.2). */
  STEP_DECAY_PCT: 0.05,
  /** Playback floor: 320 ms/step (§C1.2). */
  STEP_FLOOR_MS: 320,
  /** V2/G24 tuning: round-1 playback step duration. */
  STEP_BASE_MS: 600,
  /** Speed bonus range 0–8 (§C1.2). */
  SPEED_BONUS_MAX: 8,
  /** Average reaction < 500 ms/step ⇒ full bonus (§C1.2). */
  REACTION_FULL_MS: 500,
  /** V2/G24 tuning: bonus fades linearly to 0 at this average reaction. */
  REACTION_ZERO_MS: 1500,
  /** V2/G24 tuning: waiting longer than this on one step = a mistake. */
  INPUT_TIMEOUT_MS: 5000,
  /** Autoplay taps every 250 ms (§C1.2). */
  AUTOPLAY_TAP_MS: 250,
  /** V2/G24 tuning: bot per-tap slip chance ramps with the round — short
   * sequences are never flubbed, long ones get shaky (very human). Tuned so
   * runs end round ~8 median (p10 4, p90 12) → typical score ≈ 88 → ~16–17c,
   * §C1.1's typical column. */
  AUTOPLAY_ERR_RAMP: 0.0025,
  AUTOPLAY_ERR_CAP: 0.08,
});

/**
 * Sequence length played back in a given round (1-based): 3, 4, 5, … (§C1.2).
 * @param {number} round 1-based round number
 * @returns {number}
 */
export function seqLengthAt(round) {
  return SAYS.START_LEN + SAYS.GROW_PER_ROUND * (Math.max(1, round) - 1);
}

/**
 * Playback step duration for a round: −5%/round, floored at 320 ms (§C1.2).
 * @param {number} round 1-based round number
 * @returns {number} milliseconds per step
 */
export function stepMsAt(round) {
  const mult = Math.pow(1 - SAYS.STEP_DECAY_PCT, Math.max(1, round) - 1);
  return Math.max(SAYS.STEP_FLOOR_MS, SAYS.STEP_BASE_MS * mult);
}

/**
 * Append one seeded pad index to the sequence (pure — returns a new array).
 * @param {number[]} seq current sequence (pad indices 0..PADS−1)
 * @param {() => number} rng 0..1
 * @returns {number[]}
 */
export function extendSequence(seq, rng) {
  return [...seq, Math.min(SAYS.PADS - 1, Math.floor(rng() * SAYS.PADS))];
}

/**
 * Autoplay per-tap slip chance for a round (V2/G24 bot model): 0 in round 1,
 * +RAMP per later round, capped — long sequences get shaky, short ones never
 * flub.
 * @param {number} round 1-based round number
 * @returns {number} 0..AUTOPLAY_ERR_CAP
 */
export function autoplayErrAt(round) {
  return Math.min(SAYS.AUTOPLAY_ERR_CAP, SAYS.AUTOPLAY_ERR_RAMP * (Math.max(1, round) - 1));
}

/**
 * Speed bonus 0–8 from the average reaction time per step (§C1.2): full 8 for
 * ≤ 500 ms, fading linearly to 0 at REACTION_ZERO_MS.
 * @param {number} avgReactionMs
 * @returns {number} integer 0..8
 */
export function speedBonus(avgReactionMs) {
  if (!Number.isFinite(avgReactionMs)) return 0;
  if (avgReactionMs <= SAYS.REACTION_FULL_MS) return SAYS.SPEED_BONUS_MAX;
  if (avgReactionMs >= SAYS.REACTION_ZERO_MS) return 0;
  const t = (avgReactionMs - SAYS.REACTION_FULL_MS) / (SAYS.REACTION_ZERO_MS - SAYS.REACTION_FULL_MS);
  return Math.round(SAYS.SPEED_BONUS_MAX * (1 - t));
}

/**
 * Final round score (§C1.2): 10·roundsCompleted + speedBonus. With zero
 * completed rounds there were no rated reactions, so the score is 0.
 * @param {number} roundsCompleted
 * @param {number} avgReactionMs average per-step reaction over the whole run
 * @returns {number}
 */
export function roundScore(roundsCompleted, avgReactionMs) {
  if (roundsCompleted <= 0) return 0;
  return SAYS.ROUND_POINTS * roundsCompleted + speedBonus(avgReactionMs);
}
