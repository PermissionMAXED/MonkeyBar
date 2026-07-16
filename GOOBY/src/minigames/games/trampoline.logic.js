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
  /** Butt-landing stagger before bouncing resumes (s). */
  BUTT_STAGGER_SEC: 1.1,
});

/**
 * Landing-window length for a bounce apex (§C6.1: shrinks as height grows).
 * @param {number} apexH bounce apex above the mat (wu)
 * @returns {number} seconds
 */
export function windowSecFor(apexH) {
  return Math.max(
    TRAMP.WINDOW_MIN_SEC,
    TRAMP.WINDOW_BASE_SEC - TRAMP.WINDOW_SHRINK_PER_WU * apexH
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
export function classifyLandingTap(tti, apexH) {
  if (tti <= windowSecFor(apexH)) return 'boost';
  if (tti <= TRAMP.JUDGE_ZONE_SEC) return 'butt';
  return 'ignore';
}

/**
 * Launch velocity for the next bounce (§C6.1: boost grows height, missed
 * window resets it, no tap slowly decays it).
 * @param {number} vy the launch velocity of the bounce that just ended
 * @param {'boost'|'none'|'butt'} action
 * @returns {number} next launch velocity (wu/s); 'butt' resets to BASE_VY
 */
export function nextBounceVy(vy, action) {
  if (action === 'boost') return Math.min(TRAMP.MAX_VY, vy * TRAMP.BOOST_MULT + TRAMP.BOOST_ADD);
  if (action === 'butt') return TRAMP.BASE_VY;
  return Math.max(TRAMP.MIN_VY, vy * TRAMP.DECAY_MULT);
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
export function canTrick(airborne, tti, tricking) {
  return airborne && !tricking && tti > TRAMP.TRICK_MIN_AIR_SEC;
}

/**
 * Sum of trick points = the round score (§C6.1: score = trick points).
 * @param {number[]} points
 * @returns {number}
 */
export function trampolineScore(points) {
  return points.reduce((s, p) => s + p, 0);
}
