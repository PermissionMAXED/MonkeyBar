// Goalie Gooby — pure telegraph/lane/save logic (PLAN2 §C1.2 #7, agent
// V2/G27). No three.js/DOM imports so `node --test` runs this headlessly
// (§B rule); the game module (goalieGooby.js) imports from here. Binding
// §C1.2 numbers: 5 lanes, 0.9 s telegraph (kicker wind-up + lane flash)
// ramping to 0.45 s, lobs (swipe up) + rollers (swipe down) mix in, save +4
// (+2 super save inside the last 0.15 s, with slow-mo), 3 goals conceded end
// the round early, else 60 s; every 10 saves the bunny crowd cheers and
// speed +10%. Coin row (§C1.1): divisor 3, min 4, max 26, typical ≈ 48 → ~15c.

/** Binding §C1.2 #7 numbers + G27 tuning (flight, cadence, bot). */
export const GOALIE = Object.freeze({
  /** Round length cap (§C1.2: ≤ 60 s). */
  DURATION_SEC: 60,
  /** Kick lanes across the goal mouth (§C1.2). */
  LANES: 5,
  /** Telegraph ramp 0.9 s → 0.45 s across the round (§C1.2). */
  TELEGRAPH_START_SEC: 0.9,
  TELEGRAPH_END_SEC: 0.45,
  TELEGRAPH_RAMP_SEC: 60,
  /** Save +4; super save (last 0.15 s) +2 extra (§C1.2). */
  SAVE_PTS: 4,
  SUPER_PTS: 2,
  SUPER_WINDOW_SEC: 0.15,
  /** Goals conceded that end the round early (§C1.2). */
  MAX_GOALS: 3,
  /** Every 10 saves: bunny crowd cheers + speed ×1.10 (§C1.2). */
  CHEER_EVERY_SAVES: 10,
  CHEER_SPEED_MULT: 1.1,
  /** Kick mix: lobs (swipe up) + rollers (swipe down) join after the intro. */
  MIX_FROM_SEC: 8,
  LOB_CHANCE: 0.22,
  ROLLER_CHANCE: 0.22,
  /** G27 tuning: ball flight + between-kick gap (s; ÷ crowd speed mult). */
  FLIGHT_SEC: 0.55,
  GAP_SEC: 0.8,
  /** A dive keeps covering its lane for this long (s). */
  DIVE_HOLD_SEC: 0.45,
  /** Swipe classification: |dy| px beyond this reads as up/down intent. */
  VKIND_MIN_PX: 24,
  /** Lane buckets over the swipe angle (° from straight-up, see
   * laneFromSwipe): |a| ≤ 18 center, ≤ 54 inner, else outer. */
  LANE_INNER_DEG: 18,
  LANE_OUTER_DEG: 54,
  /** Autoplay (§C1.2: reads the telegraphed lane, swipes at t−0.2 s). */
  AUTOPLAY_LEAD_SEC: 0.2,
  AUTOPLAY_JITTER_SEC: 0.1,
  /** Bot flub odds grow as the telegraph shrinks (human-ish ramp). */
  AUTOPLAY_ERR_BASE: 0.07,
  AUTOPLAY_ERR_RAMP: 0.48,
});

/** @typedef {'straight'|'lob'|'roller'} KickKind */
/** @typedef {{lane: number, kind: KickKind}} Kick */
/** @typedef {{lane: number, v: 'up'|'mid'|'down', t: number}} Dive */

/**
 * Telegraph length at a moment of the round: linear 0.9 s → 0.45 s (§C1.2).
 * @param {number} elapsed seconds since round start
 * @returns {number} seconds
 */
export function telegraphSecAt(elapsed) {
  const t = Math.min(1, Math.max(0, elapsed / GOALIE.TELEGRAPH_RAMP_SEC));
  return GOALIE.TELEGRAPH_START_SEC + (GOALIE.TELEGRAPH_END_SEC - GOALIE.TELEGRAPH_START_SEC) * t;
}

/**
 * Crowd-cheer speed multiplier after n cheers: ×1.10 each (§C1.2).
 * @param {number} cheers cheers so far (= floor(saves / 10))
 * @returns {number} ≥ 1
 */
export function speedMultAt(cheers) {
  return Math.pow(GOALIE.CHEER_SPEED_MULT, Math.max(0, cheers));
}

/**
 * Ball flight time for the current crowd speed.
 * @param {number} cheers
 * @returns {number} seconds
 */
export function flightSecAt(cheers) {
  return GOALIE.FLIGHT_SEC / speedMultAt(cheers);
}

/**
 * Roll the next kick: uniform lane 0–4; straight only during the intro,
 * then lobs/rollers mix in (§C1.2).
 * @param {() => number} rng 0..1
 * @param {number} elapsed seconds
 * @returns {Kick}
 */
export function rollKick(rng, elapsed) {
  const lane = Math.min(GOALIE.LANES - 1, Math.floor(rng() * GOALIE.LANES));
  if (elapsed < GOALIE.MIX_FROM_SEC) return { lane, kind: 'straight' };
  const r = rng();
  if (r < GOALIE.LOB_CHANCE) return { lane, kind: 'lob' };
  if (r < GOALIE.LOB_CHANCE + GOALIE.ROLLER_CHANCE) return { lane, kind: 'roller' };
  return { lane, kind: 'straight' };
}

/**
 * Telegraph→lane mapping (§C1.5): the swipe angle away from straight-up
 * picks the lane — dive "toward the lane" (§C1.2). 0 = far left … 4 = far
 * right; a tap is lane 2 (center) by contract.
 * @param {number} dx swipe delta x (px, +right)
 * @param {number} dy swipe delta y (px, +down — screen coords)
 * @returns {number} lane 0–4
 */
export function laneFromSwipe(dx, dy) {
  const deg = (Math.atan2(dx, Math.max(1e-6, Math.abs(dy))) * 180) / Math.PI;
  if (deg < -GOALIE.LANE_OUTER_DEG) return 0;
  if (deg < -GOALIE.LANE_INNER_DEG) return 1;
  if (deg <= GOALIE.LANE_INNER_DEG) return 2;
  if (deg <= GOALIE.LANE_OUTER_DEG) return 3;
  return 4;
}

/**
 * Vertical intent of a swipe: 'up' saves lobs, 'down' saves rollers
 * (§C1.2); shallow swipes are 'mid'.
 * @param {number} dy swipe delta y (px, +down — screen coords)
 * @returns {'up'|'mid'|'down'}
 */
export function vKindFromSwipe(dy) {
  if (dy <= -GOALIE.VKIND_MIN_PX) return 'up';
  if (dy >= GOALIE.VKIND_MIN_PX) return 'down';
  return 'mid';
}

/**
 * Whether a dive stops a kick: the lane must match, and lobs need an upward
 * swipe / rollers a downward one (straight kicks take any vertical intent).
 * @param {Kick} kick
 * @param {{lane: number, v: 'up'|'mid'|'down'}} dive
 * @returns {boolean}
 */
export function saveMatches(kick, dive) {
  if (kick.lane !== dive.lane) return false;
  if (kick.kind === 'lob') return dive.v === 'up';
  if (kick.kind === 'roller') return dive.v === 'down';
  return true;
}

/**
 * Whether a dive at diveT still covers a ball arriving at arriveT.
 * @param {number} diveT seconds (round clock)
 * @param {number} arriveT seconds (round clock)
 * @returns {boolean}
 */
export function diveCovers(diveT, arriveT) {
  const lead = arriveT - diveT;
  // 1e-9 pads float noise on the boundary (e.g. 10.45 − 10 > 0.45).
  return lead >= 0 && lead <= GOALIE.DIVE_HOLD_SEC + 1e-9;
}

/**
 * Super save (§C1.2): the dive landed inside the last 0.15 s before the
 * ball crosses the line.
 * @param {number} diveT seconds (round clock)
 * @param {number} arriveT seconds (round clock)
 * @returns {boolean}
 */
export function isSuperSave(diveT, arriveT) {
  const lead = arriveT - diveT;
  // 1e-9 pads float noise on the boundary (e.g. 10.15 − 10 > 0.15).
  return lead >= 0 && lead <= GOALIE.SUPER_WINDOW_SEC + 1e-9;
}

/**
 * Points for a save: +4, +2 extra when super (§C1.2).
 * @param {boolean} superSave
 * @returns {number}
 */
export function savePoints(superSave) {
  return GOALIE.SAVE_PTS + (superSave ? GOALIE.SUPER_PTS : 0);
}

/**
 * Cheers earned after a total save count (§C1.2: every 10 saves).
 * @param {number} saves
 * @returns {number}
 */
export function cheersAt(saves) {
  return Math.floor(Math.max(0, saves) / GOALIE.CHEER_EVERY_SAVES);
}

/**
 * Autoplay flub odds for a telegraph length: base 10%, ramping up as the
 * telegraph shrinks toward 0.45 s (human-ish difficulty response).
 * @param {number} telegraphSec
 * @returns {number} 0..1
 */
export function autoplayErrAt(telegraphSec) {
  const span = GOALIE.TELEGRAPH_START_SEC - GOALIE.TELEGRAPH_END_SEC;
  const t = Math.min(1, Math.max(0, (GOALIE.TELEGRAPH_START_SEC - telegraphSec) / span));
  return GOALIE.AUTOPLAY_ERR_BASE + GOALIE.AUTOPLAY_ERR_RAMP * t;
}
