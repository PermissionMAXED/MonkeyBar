// Trampoline Tricks — pure window/physics/trick logic (§C6.1 #12, agent
// G10). No three.js/DOM imports so `node --test` runs this headlessly (§B
// rule); the game module (trampoline.js) imports from here. Binding §C6.1
// numbers: side view, tap inside the shrinking landing window (shrinks as
// height grows) at the right moment = boost; swipe left/right/up mid-air =
// flip/spin tricks (+pts × height multiplier ×1–3); missed window = cute
// butt-landing, height resets; 60 s; score = trick points only. Coin row
// (§C6): divisor 5, min 4, max 26, typical raw ≈ 70 → ~14c.

/** Binding §C6.1 #12 numbers + G10 tuning (bounce physics, feel knobs). */
export const TRAMP = Object.freeze({
  /** Round length (§C6.1: 60 s). */
  DURATION_SEC: 60,
  /** Trick base points by swipe (§C6.1: left/right/up = flip/spin tricks). */
  TRICK_PTS: Object.freeze({ flip: 2, spin: 2, twist: 3 }),
  /** Height multiplier tiers ×1–3 (§C6.1), by bounce apex (wu above mat). */
  TIER2_APEX: 2.1,
  TIER3_APEX: 3.3,
  // --- landing window (§C6.1: shrinks as height grows) ---
  /** Window at zero height (s of time-to-impact). */
  WINDOW_BASE_SEC: 0.3,
  /** Seconds removed per wu of the current bounce's apex. */
  WINDOW_SHRINK_PER_WU: 0.045,
  /** The window never shrinks below this (s). */
  WINDOW_MIN_SEC: 0.1,
  /** Taps are judged only inside this time-to-impact zone; earlier
   * pointer-downs are trick-swipe starts and are ignored. Outside the
   * window but inside the zone = missed window → butt-landing. */
  JUDGE_ZONE_SEC: 0.5,
  // --- bounce physics (cartoon numbers, wu/s) ---
  GRAVITY: 9,
  /** First bounce launch velocity (apex ≈ 1.4 wu). */
  BASE_VY: 5,
  /** Boosted bounce: vy ← min(MAX_VY, vy × MULT + ADD). */
  BOOST_MULT: 1.16,
  BOOST_ADD: 0.35,
  /** Launch velocity cap (apex ≈ 4.1 wu). */
  MAX_VY: 8.6,
  /** Passive bounce (no tap): keeps most height, drifts down to a floor. */
  DECAY_MULT: 0.94,
  MIN_VY: 4.2,
  /** No tricks when the landing is closer than this (s). */
  TRICK_MIN_AIR_SEC: 0.35,
  /** V3/G44 (§C10.2): all three distinct tricks in one air. */
  COMBO_TRICKS: 3,
  COMBO_FLIP_POINTS: 12,
  /** Butt-landing stagger before bouncing resumes (s). */
  BUTT_STAGGER_SEC: 1.1,
  /** §G5 mode metadata. */
  ENDLESS: false,
  ENDLESS_FAILURE_LIMIT: 3,
});

/** §G5 physics/skill difficulty; tolerance never drops below 55% of Mittel. */
export function applyDifficulty(tune = TRAMP, mode = 'normal') {
  if (mode === 'normal' || !['easy', 'hard', 'endless'].includes(mode)) return tune;
  const hard = mode === 'hard' || mode === 'endless';
  const toleranceMult = hard ? 0.8 : 1.25;
  return Object.freeze({
    ...tune,
    WINDOW_BASE_SEC: Math.max(tune.WINDOW_BASE_SEC * 0.55, tune.WINDOW_BASE_SEC * toleranceMult),
    WINDOW_MIN_SEC: Math.max(tune.WINDOW_MIN_SEC * 0.55, tune.WINDOW_MIN_SEC * toleranceMult),
    JUDGE_ZONE_SEC: Math.max(0.35, tune.JUDGE_ZONE_SEC * toleranceMult),
    ENDLESS: mode === 'endless',
  });
}

/** Apply the plain hit-window multiplier derived from ctx.params. */
export function withTrampolineHitbox(tune, hitboxMult = 1) {
  const mult = Number.isFinite(hitboxMult) && hitboxMult > 0 ? hitboxMult : 1;
  if (mult === 1) return tune;
  return Object.freeze({
    ...tune,
    WINDOW_BASE_SEC: tune.WINDOW_BASE_SEC * mult,
    WINDOW_MIN_SEC: tune.WINDOW_MIN_SEC * mult,
    JUDGE_ZONE_SEC: tune.JUDGE_ZONE_SEC * mult,
  });
}

export function createTrampolineEndlessState(limit = TRAMP.ENDLESS_FAILURE_LIMIT) {
  return { failedLandings: 0, limit, ended: false };
}

export function recordTrampolineLanding(state, action) {
  if (action === 'butt' && !state.ended) state.failedLandings += 1;
  state.ended = state.failedLandings >= state.limit;
  return state.ended;
}

/**
 * Landing-window length for a bounce apex (§C6.1: shrinks as height grows).
 * @param {number} apexH bounce apex above the mat (wu)
 * @returns {number} seconds
 */
export function windowSecFor(apexH, tune = TRAMP) {
  return Math.max(
    tune.WINDOW_MIN_SEC,
    tune.WINDOW_BASE_SEC - tune.WINDOW_SHRINK_PER_WU * apexH
  );
}

/**
 * Height multiplier ×1–3 for trick points (§C6.1), from the bounce apex.
 * @param {number} apexH wu above the mat
 * @returns {1|2|3}
 */
export function heightMultiplier(apexH) {
  if (apexH >= TRAMP.TIER3_APEX) return 3;
  if (apexH >= TRAMP.TIER2_APEX) return 2;
  return 1;
}

/**
 * Apex height for a launch velocity: v² / 2g.
 * @param {number} vy launch velocity (wu/s)
 * @param {number} [g]
 * @returns {number} wu
 */
export function apexFor(vy, g = TRAMP.GRAVITY) {
  return (vy * vy) / (2 * g);
}

/**
 * Full air time of a bounce (up + down to the mat): 2v/g.
 * @param {number} vy launch velocity (wu/s)
 * @param {number} [g]
 * @returns {number} seconds
 */
export function airTimeFor(vy, g = TRAMP.GRAVITY) {
  return (2 * vy) / g;
}

/**
 * Time until the mat is hit again, mid-air.
 * @param {number} h height above the mat (wu, ≥ 0)
 * @param {number} vy current vertical velocity (wu/s, signed)
 * @param {number} [g]
 * @returns {number} seconds
 */
export function timeToImpact(h, vy, g = TRAMP.GRAVITY) {
  return (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, h))) / g;
}

/**
 * Judge a tap while falling (§C6.1): inside the shrinking window → 'boost';
 * inside the judge zone but outside the window → 'butt' (missed window, cute
 * butt-landing); earlier → 'ignore' (that pointer-down is a trick swipe).
 * @param {number} tti time-to-impact (s)
 * @param {number} apexH current bounce apex (wu)
 * @returns {'boost'|'butt'|'ignore'}
 */
export function classifyLandingTap(tti, apexH, tune = TRAMP) {
  if (tti <= windowSecFor(apexH, tune)) return 'boost';
  if (tti <= tune.JUDGE_ZONE_SEC) return 'butt';
  return 'ignore';
}

/**
 * Launch velocity for the next bounce (§C6.1: boost grows height, missed
 * window resets it, no tap slowly decays it).
 * @param {number} vy the launch velocity of the bounce that just ended
 * @param {'boost'|'none'|'butt'} action
 * @returns {number} next launch velocity (wu/s); 'butt' resets to BASE_VY
 */
export function nextBounceVy(vy, action, tune = TRAMP) {
  if (action === 'boost') return Math.min(tune.MAX_VY, vy * tune.BOOST_MULT + tune.BOOST_ADD);
  if (action === 'butt') return tune.BASE_VY;
  return Math.max(tune.MIN_VY, vy * tune.DECAY_MULT);
}

/**
 * Points for a trick (§C6.1: +pts × height multiplier ×1–3).
 * @param {'flip'|'spin'|'twist'} kind swipe left / right / up
 * @param {1|2|3} mult height multiplier
 * @returns {number}
 */
export function trickPoints(kind, mult) {
  return TRAMP.TRICK_PTS[kind] * mult;
}

/**
 * Whether a trick may start (§C6.1: mid-air only; not while the landing is
 * imminent, so trick swipes and window taps never fight).
 * @param {boolean} airborne
 * @param {number} tti time-to-impact (s)
 * @param {boolean} tricking a trick animation is already running
 * @returns {boolean}
 */
export function canTrick(airborne, tti, tricking, tune = TRAMP) {
  return airborne && !tricking && tti > tune.TRICK_MIN_AIR_SEC;
}

/**
 * Sum of trick points = the round score (§C6.1: score = trick points).
 * @param {number[]} points
 * @returns {number}
 */
export function trampolineScore(points) {
  return points.reduce((s, p) => s + p, 0);
}

/** Fresh per-air trick chain. */
export function createTrickChain() {
  return { seen: [], awarded: false };
}

/**
 * Record a trick in the current air. Repeats score normally but only the
 * first flip+spin+twist set awards Combo-Flip +12.
 */
export function recordTrick(chain, kind) {
  if (!chain.seen.includes(kind)) chain.seen.push(kind);
  const triggered = !chain.awarded && chain.seen.length >= TRAMP.COMBO_TRICKS;
  if (triggered) chain.awarded = true;
  return { triggered, bonus: triggered ? TRAMP.COMBO_FLIP_POINTS : 0 };
}

/**
 * Consume an armed landing exactly once. Keeping this transition pure pins
 * the armed-boost double-fire audit even when one frame crosses the mat.
 */
export function consumeLandingAction(armed) {
  return { action: armed ?? 'none', armed: null };
}

/** True only on the falling edge that crosses the trampoline plane. */
export function crossedMat(previousH, nextH, nextVy) {
  return previousH > 0 && nextH <= 0 && nextVy < 0;
}

/** Deterministic certification bot driven by the derived landing tolerance. */
export function simulateTrampolineAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(TRAMP, mode);
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const duration = tune.ENDLESS ? 90 : tune.DURATION_SEC;
  let t = 0;
  let vy = tune.BASE_VY;
  let score = 0;
  let failures = 0;
  while (t < duration && failures < tune.ENDLESS_FAILURE_LIMIT) {
    const apex = apexFor(vy, tune.GRAVITY);
    const win = windowSecFor(apex, tune);
    const success = rng() < Math.min(0.96, 0.7 + win * 0.8);
    const mult = heightMultiplier(apex);
    if (success) {
      score += trickPoints('twist', mult) + trickPoints('flip', mult);
      if (rng() < 0.55) score += tune.COMBO_FLIP_POINTS;
      vy = nextBounceVy(vy, 'boost', tune);
    } else {
      failures += 1;
      vy = nextBounceVy(vy, 'butt', tune);
    }
    t += airTimeFor(vy, tune.GRAVITY) + (success ? 0 : tune.BUTT_STAGGER_SEC);
  }
  return { score, failures, tune };
}
