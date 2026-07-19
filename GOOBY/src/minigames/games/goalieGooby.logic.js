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
  /** V3/G45 (§C10.2): five-shot finale over the last ten seconds. */
  SHOOTOUT_START_SEC: 50,
  SHOOTOUT_SHOTS: 5,
  SHOOTOUT_TELEGRAPH_SEC: 0.38,
  SHOOTOUT_FLIGHT_SEC: 0.42,
  SHOOTOUT_GAP_SEC: 0.28,
  SHOOTOUT_SAVE_MULT: 2,
  /** V4/G73 run flags + plain Riesen-Gooby tuning defaults. */
  ENDLESS: false,
  ENDLESS_GOALS: 3,
  RENDER_SCALE: 1,
  HITBOX_MULT: 1,
  AUTOPLAY_SKILL_MULT: 0.12,
});

/** V4/G73 timed-arena mode rows (§G5.3). */
export const GOALIE_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ spawnMult: 1.2, windowMult: 1.25, durationMult: 1.2, botSkillMult: 0.08 }),
  hard: Object.freeze({ spawnMult: 0.85, windowMult: 0.8, durationMult: 1, botSkillMult: 0.2 }),
  endless: Object.freeze({ spawnMult: 0.85, windowMult: 0.8, durationMult: 1, botSkillMult: 0.2 }),
});

/** Derive a frozen tune; normal returns the bit-identical Mittel table. */
export function applyDifficulty(tune = GOALIE, mode = 'normal') {
  if (mode === 'normal' || !Object.hasOwn(GOALIE_DIFFICULTY, mode)) return tune;
  const row = GOALIE_DIFFICULTY[mode];
  return Object.freeze({
    ...tune,
    DURATION_SEC: tune.DURATION_SEC * row.durationMult,
    GAP_SEC: tune.GAP_SEC * row.spawnMult,
    TELEGRAPH_START_SEC: Math.max(0.35, tune.TELEGRAPH_START_SEC * row.windowMult),
    TELEGRAPH_END_SEC: Math.max(0.35, tune.TELEGRAPH_END_SEC * row.windowMult),
    DIVE_HOLD_SEC: Math.max(0.35, tune.DIVE_HOLD_SEC * row.windowMult),
    SHOOTOUT_TELEGRAPH_SEC: Math.max(0.35, tune.SHOOTOUT_TELEGRAPH_SEC * row.windowMult),
    ENDLESS: mode === 'endless',
    AUTOPLAY_SKILL_MULT: row.botSkillMult,
  });
}

/** Apply Riesen-Gooby's plain scale/hitbox payload (§C-SYS4.2). */
export function applyRiesenGooby(tune, { scale = 1, hitboxMult = 1 } = {}) {
  const safeScale = Math.max(1, Number(scale) || 1);
  const safeHitbox = Math.max(1, Number(hitboxMult) || 1);
  return Object.freeze({
    ...tune,
    RENDER_SCALE: safeScale,
    HITBOX_MULT: safeHitbox,
    DIVE_HOLD_SEC: tune.DIVE_HOLD_SEC * safeHitbox,
  });
}

/** @typedef {'straight'|'lob'|'roller'} KickKind */
/** @typedef {{lane: number, kind: KickKind}} Kick */
/** @typedef {{lane: number, v: 'up'|'mid'|'down', t: number}} Dive */

/**
 * Telegraph length at a moment of the round: linear 0.9 s → 0.45 s (§C1.2).
 * @param {number} elapsed seconds since round start
 * @returns {number} seconds
 */
export function telegraphSecAt(elapsed, tune = GOALIE) {
  const t = Math.min(1, Math.max(0, elapsed / tune.TELEGRAPH_RAMP_SEC));
  return tune.TELEGRAPH_START_SEC + (tune.TELEGRAPH_END_SEC - tune.TELEGRAPH_START_SEC) * t;
}

/**
 * Crowd-cheer speed multiplier after n cheers: ×1.10 each (§C1.2).
 * @param {number} cheers cheers so far (= floor(saves / 10))
 * @returns {number} ≥ 1
 */
export function speedMultAt(cheers, tune = GOALIE) {
  return Math.pow(tune.CHEER_SPEED_MULT, Math.max(0, cheers));
}

/**
 * Ball flight time for the current crowd speed.
 * @param {number} cheers
 * @returns {number} seconds
 */
export function flightSecAt(cheers, tune = GOALIE) {
  return tune.FLIGHT_SEC / speedMultAt(cheers, tune);
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
export function diveCovers(diveT, arriveT, tune = GOALIE) {
  const lead = arriveT - diveT;
  // 1e-9 pads float noise on the boundary (e.g. 10.45 − 10 > 0.45).
  return lead >= 0 && lead <= tune.DIVE_HOLD_SEC + 1e-9;
}

/**
 * Super save (§C1.2): the dive landed inside the last 0.15 s before the
 * ball crosses the line.
 * @param {number} diveT seconds (round clock)
 * @param {number} arriveT seconds (round clock)
 * @returns {boolean}
 */
export function isSuperSave(diveT, arriveT, tune = GOALIE) {
  const lead = arriveT - diveT;
  // 1e-9 pads float noise on the boundary (e.g. 10.15 − 10 > 0.15).
  return lead >= 0 && lead <= tune.SUPER_WINDOW_SEC + 1e-9;
}

/**
 * Points for a save: +4, +2 extra when super (§C1.2).
 * @param {boolean} superSave
 * @returns {number}
 */
export function savePoints(superSave, shootout = false, tune = GOALIE) {
  const base = tune.SAVE_PTS + (superSave ? tune.SUPER_PTS : 0);
  return base * (shootout ? tune.SHOOTOUT_SAVE_MULT : 1);
}

/**
 * Whether the penalty-shootout finale is active.
 * @param {number} elapsed round seconds
 * @returns {boolean}
 */
export function isShootoutAt(elapsed, tune = GOALIE) {
  return !tune.ENDLESS && elapsed >= tune.SHOOTOUT_START_SEC && elapsed <= tune.DURATION_SEC;
}

/**
 * Nominal start time for one of the five rapid telegraphed finale shots.
 * @param {number} index zero-based
 * @returns {number}
 */
export function shootoutShotAt(index, tune = GOALIE) {
  const cycle = tune.SHOOTOUT_TELEGRAPH_SEC
    + tune.SHOOTOUT_FLIGHT_SEC
    + tune.SHOOTOUT_GAP_SEC;
  return tune.SHOOTOUT_START_SEC + Math.max(0, index) * cycle;
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
export function autoplayErrAt(telegraphSec, tune = GOALIE, skillMult = 1) {
  const span = tune.TELEGRAPH_START_SEC - tune.TELEGRAPH_END_SEC;
  const t = span <= 0
    ? 1
    : Math.min(1, Math.max(0, (tune.TELEGRAPH_START_SEC - telegraphSec) / span));
  return (tune.AUTOPLAY_ERR_BASE + tune.AUTOPLAY_ERR_RAMP * t) * skillMult;
}

/** §G5.4 Endlos ends on the third conceded goal. */
export function endlessShouldEnd(goals, tune = GOALIE) {
  return tune.ENDLESS === true && goals >= tune.ENDLESS_GOALS;
}

/** Deterministic tune-driven certification for the live telegraph-reading bot. */
export function simulateAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(GOALIE, mode);
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
  let saves = 0;
  let goals = 0;
  const limit = tune.ENDLESS ? 600 : tune.DURATION_SEC;
  while (elapsed < limit && goals < tune.ENDLESS_GOALS) {
    const shootout = isShootoutAt(elapsed, tune);
    const telegraph = shootout ? tune.SHOOTOUT_TELEGRAPH_SEC : telegraphSecAt(elapsed, tune);
    const flight = shootout ? tune.SHOOTOUT_FLIGHT_SEC : flightSecAt(cheersAt(saves), tune);
    elapsed += telegraph + flight + (shootout ? tune.SHOOTOUT_GAP_SEC : tune.GAP_SEC);
    const error = autoplayErrAt(telegraph, tune, tune.AUTOPLAY_SKILL_MULT);
    if (rng() < error) goals += 1;
    else {
      saves += 1;
      score += savePoints(false, shootout, tune);
    }
  }
  return Object.freeze({ seed, mode, score, saves, goals, elapsed });
}
