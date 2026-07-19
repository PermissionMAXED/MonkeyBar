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
  /** V3/G45 (§C10.2): rounds 6+ append a two-pad chord step. */
  CHORD_FROM_ROUND: 6,
  /** Both chord pads must be tapped within this 250 ms interval. */
  CHORD_WINDOW_MS: 250,
});

/** V4/G73 §G5 sequence/puzzle mode multipliers (base table stays Mittel). */
export const SAYS_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ replaySpeed: 0.85, windowMult: 1.25, floorSteps: 0, botErrorMult: 0.75 }),
  hard: Object.freeze({ replaySpeed: 1.15, windowMult: 0.8, floorSteps: 1, botErrorMult: 1.15 }),
  endless: Object.freeze({ replaySpeed: 1.15, windowMult: 0.8, floorSteps: 1, botErrorMult: 1.15 }),
});

/**
 * Derive a frozen §G5 tune. Mittel returns the exact base object; Endlos uses
 * Schwer tuning but lets replay cadence continue below Mittel's 320 ms floor.
 * @param {object} tune
 * @param {'easy'|'normal'|'hard'|'endless'} mode
 */
export function applyDifficulty(tune = SAYS, mode = 'normal') {
  if (mode === 'normal' || !Object.hasOwn(SAYS_DIFFICULTY, mode)) return tune;
  const row = SAYS_DIFFICULTY[mode];
  const hardFloor = tune.STEP_FLOOR_MS
    * Math.pow(1 - tune.STEP_DECAY_PCT, row.floorSteps);
  return Object.freeze({
    ...tune,
    STEP_BASE_MS: tune.STEP_BASE_MS / row.replaySpeed,
    STEP_FLOOR_MS: mode === 'endless' ? 0 : hardFloor / (mode === 'easy' ? row.replaySpeed : 1),
    INPUT_TIMEOUT_MS: Math.max(350, tune.INPUT_TIMEOUT_MS * row.windowMult),
    // The inherited 250 ms chord window is below the v4 Schwer guardrail;
    // hard/endless clamp to 350 ms instead of becoming impossible.
    CHORD_WINDOW_MS: mode === 'hard' || mode === 'endless'
      ? Math.max(350, tune.CHORD_WINDOW_MS * row.windowMult)
      : tune.CHORD_WINDOW_MS * row.windowMult,
    REACTION_FULL_MS: tune.REACTION_FULL_MS * row.windowMult,
    REACTION_ZERO_MS: tune.REACTION_ZERO_MS * row.windowMult,
    AUTOPLAY_ERR_MULT: row.botErrorMult,
  });
}

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
export function stepMsAt(round, tune = SAYS) {
  const mult = Math.pow(1 - tune.STEP_DECAY_PCT, Math.max(1, round) - 1);
  return Math.max(tune.STEP_FLOOR_MS, tune.STEP_BASE_MS * mult);
}

/**
 * Append one seeded pad index to the sequence (pure — returns a new array).
 * @param {number[]} seq current sequence (pad indices 0..PADS−1)
 * @param {() => number} rng 0..1
 * @returns {number[]}
 */
export function extendSequence(seq, rng, round = 1) {
  const first = Math.min(SAYS.PADS - 1, Math.floor(rng() * SAYS.PADS));
  if (round < SAYS.CHORD_FROM_ROUND) return [...seq, first];
  // Pick the second pad from the remaining PADS−1 values, so a chord can
  // never contain the same pad twice.
  const rolled = Math.min(SAYS.PADS - 2, Math.floor(rng() * (SAYS.PADS - 1)));
  const second = rolled >= first ? rolled + 1 : rolled;
  return [...seq, Object.freeze([first, second])];
}

/**
 * Whether one sequence step is a V3/G45 two-pad chord.
 * @param {number|readonly number[]} step
 * @returns {boolean}
 */
export function isChordStep(step) {
  return Array.isArray(step) && step.length === 2 && step[0] !== step[1];
}

/**
 * Judge taps against a chord without depending on frame cadence. The two
 * chord pads may be tapped in either order, but must be distinct and no more
 * than 250 ms apart (§C10.2).
 * @param {readonly number[]} step chord pad indices
 * @param {number} firstPad
 * @param {number|null} secondPad
 * @param {number} gapMs elapsed between first and second tap
 * @returns {'waiting'|'complete'|'wrong'|'late'}
 */
export function chordTapResult(step, firstPad, secondPad = null, gapMs = 0, tune = SAYS) {
  if (!isChordStep(step) || !step.includes(firstPad)) return 'wrong';
  if (secondPad == null) return 'waiting';
  if (secondPad === firstPad || !step.includes(secondPad)) return 'wrong';
  return gapMs <= tune.CHORD_WINDOW_MS ? 'complete' : 'late';
}

/**
 * Autoplay per-tap slip chance for a round (V2/G24 bot model): 0 in round 1,
 * +RAMP per later round, capped — long sequences get shaky, short ones never
 * flub.
 * @param {number} round 1-based round number
 * @returns {number} 0..AUTOPLAY_ERR_CAP
 */
export function autoplayErrAt(round, tune = SAYS) {
  const mult = tune.AUTOPLAY_ERR_MULT ?? 1;
  return Math.min(tune.AUTOPLAY_ERR_CAP, tune.AUTOPLAY_ERR_RAMP * (Math.max(1, round) - 1) * mult);
}

/**
 * Speed bonus 0–8 from the average reaction time per step (§C1.2): full 8 for
 * ≤ 500 ms, fading linearly to 0 at REACTION_ZERO_MS.
 * @param {number} avgReactionMs
 * @returns {number} integer 0..8
 */
export function speedBonus(avgReactionMs, tune = SAYS) {
  if (!Number.isFinite(avgReactionMs)) return 0;
  if (avgReactionMs <= tune.REACTION_FULL_MS) return tune.SPEED_BONUS_MAX;
  if (avgReactionMs >= tune.REACTION_ZERO_MS) return 0;
  const t = (avgReactionMs - tune.REACTION_FULL_MS) / (tune.REACTION_ZERO_MS - tune.REACTION_FULL_MS);
  return Math.round(tune.SPEED_BONUS_MAX * (1 - t));
}

/**
 * Final round score (§C1.2): 10·roundsCompleted + speedBonus. With zero
 * completed rounds there were no rated reactions, so the score is 0.
 * @param {number} roundsCompleted
 * @param {number} avgReactionMs average per-step reaction over the whole run
 * @returns {number}
 */
export function roundScore(roundsCompleted, avgReactionMs, tune = SAYS) {
  if (roundsCompleted <= 0) return 0;
  return tune.ROUND_POINTS * roundsCompleted + speedBonus(avgReactionMs, tune);
}

/** Gooby Says is already run-until-fail; Endlos keeps the same one-mistake end. */
export function endlessShouldEnd(mode, mistakes) {
  return mode === 'endless' && mistakes >= 1;
}

/**
 * Deterministic headless version of the shipped autoplay decisions. It is a
 * certification surface, not a second rules engine: same round sizes, slip
 * curve and derived tune as the live bot.
 */
export function simulateAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(SAYS, mode);
  let a = seed >>> 0;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) | 0;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  let completed = 0;
  for (let round = 1; round <= 40; round += 1) {
    let failed = false;
    for (let step = 0; step < seqLengthAt(round); step += 1) {
      if (rng() < autoplayErrAt(round, tune)) {
        failed = true;
        break;
      }
    }
    if (failed) break;
    completed = round;
  }
  const reactionMs = Math.min(tune.REACTION_FULL_MS, tune.AUTOPLAY_TAP_MS);
  return Object.freeze({ seed, mode, rounds: completed, score: roundScore(completed, reactionMs, tune) });
}
