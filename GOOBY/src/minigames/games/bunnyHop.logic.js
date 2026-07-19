// Bunny Hop — pure physics/ramp/collision logic (§C6.1 #3, agent G8). No
// three.js/DOM imports (§B rule); the game module (bunnyHop.js) imports from
// here. Binding §C6.1 numbers: tap = hop, score = gates passed, speed +2% per
// gate, 70% forgiving hitbox, gap narrows every 10 gates. Coin row (§C6):
// divisor 2, min 3, max 25, typical ≈ 24 gates → ~12c.

/** Binding §C6.1 #3 numbers + G8 tuning (world geometry, hop feel). */
export const HOP = Object.freeze({
  /** Scroll speed ramp: +2% per gate passed (§C6.1). */
  SPEED_RAMP_PCT: 0.02,
  /** Gap narrows every 10 gates (§C6.1). */
  GAP_NARROW_EVERY_GATES: 10,
  /** Hitbox forgiveness: collider is 70% of the visual size (§C6.1). */
  HITBOX_SCALE: 0.7,
  /** G8 tuning — world units: base scroll speed, pillar spacing, gap sizes. */
  BASE_SPEED: 1.55,
  PILLAR_SPACING_X: 2.7,
  GAP_BASE: 2.15,
  GAP_NARROW_STEP: 0.16,
  GAP_MIN: 1.5,
  /** Hop impulse (world units/s) and gravity (world units/s²). */
  HOP_VY: 3.1,
  GRAVITY: -8.5,
  /** Playfield vertical bounds (world units, ground → ceiling). */
  FLOOR_Y: -3.1,
  CEILING_Y: 3.9,
  /** Gooby's visual half-extents (world units) before 70% forgiveness. */
  BODY_HALF_W: 0.34,
  BODY_HALF_H: 0.42,
  /** Pillar column visual half-width (world units). */
  PILLAR_HALF_W: 0.34,
  /** Max gap-center shift between consecutive pillars (fair-climb clamp). */
  GAP_MAX_CLIMB: 1.4,
  GAP_MAX_DIVE: 1.9,
  /** V3 §C10.2 wind: warning, then one 0.4-lane vertical shove. */
  GUST_FIRST_SEC: 6,
  GUST_EVERY_SEC: 10,
  GUST_TELEGRAPH_SEC: 1.5,
  GUST_DURATION_SEC: 2,
  GUST_SHIFT_LANES: 0.4,
  LANE_HEIGHT: 1,
  /** V4/G71 §G5/§C-SYS4 derived-mode defaults (Mittel identity). */
  TOLERANCE_MULT: 1,
  SPEED_MULT: 1,
  SCORE_MULT: 1,
  COIN_RATE: 1,
  COIN_SPAWN_CHANCE: 0.32,
  RENDER_SCALE_MULT: 1,
  ENDLESS: false,
});

/** V4/G71 §G5.3 physics/skill row. */
export const HOP_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ tolerance: 1.25, endless: false }),
  normal: Object.freeze({ tolerance: 1, endless: false }),
  hard: Object.freeze({ tolerance: 0.8, endless: false }),
  endless: Object.freeze({ tolerance: 0.8, endless: true }),
});

export function applyDifficulty(tune = HOP, mode = 'normal') {
  const id = Object.hasOwn(HOP_DIFFICULTY, mode) ? mode : 'normal';
  if (id === 'normal') return tune;
  const row = HOP_DIFFICULTY[id];
  const tolerance = Math.max(0.55, row.tolerance);
  return Object.freeze({
    ...tune,
    GAP_BASE: tune.GAP_BASE * tolerance,
    GAP_NARROW_STEP: tune.GAP_NARROW_STEP * tolerance,
    GAP_MIN: tune.GAP_MIN * tolerance,
    TOLERANCE_MULT: tolerance,
    ENDLESS: row.endless,
    // §G5.4: Endlos has wind from the opening beat and never caps gates.
    GUST_FIRST_SEC: row.endless ? tune.GUST_TELEGRAPH_SEC : tune.GUST_FIRST_SEC,
    MODE: id,
  });
}

/** Apply the three bunnyHop gameplay modifiers from §C-SYS4.3. */
export function applyModifier(tune, modifier) {
  if (!modifier) return tune;
  if (modifier.type === 'muenzregen') {
    return Object.freeze({
      ...tune,
      COIN_RATE: Math.max(0, Number(modifier.coinRate) || 1),
    });
  }
  if (modifier.type === 'turbo') {
    const speedMult = Math.max(0.1, Number(modifier.speedMult) || 1);
    return Object.freeze({
      ...tune,
      BASE_SPEED: tune.BASE_SPEED * speedMult,
      SPEED_MULT: speedMult,
      SCORE_MULT: Math.max(0, Number(modifier.scoreMult) || 1),
    });
  }
  if (modifier.type === 'riesenGooby') {
    return Object.freeze({
      ...tune,
      HITBOX_SCALE: tune.HITBOX_SCALE * Math.max(0.1, Number(modifier.hitboxMult) || 1),
      RENDER_SCALE_MULT: Math.max(0.1, Number(modifier.scale) || 1),
    });
  }
  return tune;
}

/**
 * Scroll speed after `gates` gates passed: +2% per gate, compounding (§C6.1).
 * @param {number} gates gates passed so far
 * @returns {number} world units/s
 */
export function speedAtGate(gates, tune = HOP) {
  return tune.BASE_SPEED * Math.pow(1 + tune.SPEED_RAMP_PCT, Math.max(0, gates));
}

/**
 * Gap height for the pillar after `gates` gates: narrows one step every
 * 10 gates (§C6.1), floored at GAP_MIN.
 * @param {number} gates gates passed so far
 * @returns {number} world units
 */
export function gapAtGate(gates, tune = HOP) {
  const steps = Math.floor(Math.max(0, gates) / tune.GAP_NARROW_EVERY_GATES);
  return Math.max(tune.GAP_MIN, tune.GAP_BASE - tune.GAP_NARROW_STEP * steps);
}

/**
 * Forgiving collider half-extent: 70% of the visual half-extent (§C6.1).
 * @param {number} visualHalf
 * @returns {number}
 */
export function forgivingHalf(visualHalf, tune = HOP) {
  return visualHalf * tune.HITBOX_SCALE;
}

/**
 * Integrate the hop physics for one frame (semi-implicit Euler).
 * @param {{y: number, vy: number}} state
 * @param {number} dt seconds
 * @returns {{y: number, vy: number}} new state (ceiling-clamped)
 */
export function stepPhysics(state, dt, tune = HOP) {
  const vy = state.vy + tune.GRAVITY * dt;
  let y = state.y + vy * dt;
  if (y > tune.CEILING_Y) return { y: tune.CEILING_Y, vy: 0 };
  return { y, vy };
}

/**
 * AABB collision between Gooby's FORGIVING hitbox (70% of visual size) and a
 * pillar pair at `pillarX` with a gap centered at `gapCenterY` of height
 * `gapHeight`. Floor contact also counts as a crash.
 * @param {{x: number, y: number}} gooby world position (body center)
 * @param {{x: number, gapCenterY: number, gapHeight: number}} pillar
 * @returns {boolean} true = crash
 */
export function collides(gooby, pillar, tune = HOP) {
  const halfW = forgivingHalf(tune.BODY_HALF_W, tune);
  const halfH = forgivingHalf(tune.BODY_HALF_H, tune);
  if (gooby.y - halfH <= tune.FLOOR_Y) return true; // ground bonk
  const pillarHalf = tune.PILLAR_HALF_W;
  if (Math.abs(gooby.x - pillar.x) > halfW + pillarHalf) return false; // not at the column
  const gapTop = pillar.gapCenterY + pillar.gapHeight / 2;
  const gapBottom = pillar.gapCenterY - pillar.gapHeight / 2;
  return gooby.y + halfH > gapTop || gooby.y - halfH < gapBottom;
}

/**
 * Random gap center for the next pillar, keeping the whole gap comfortably
 * inside the playfield AND within a reachable climb/dive of the previous gap
 * (hop climb rate ≈ 1.2 u/s vs. pillar cadence — an unclamped roll can demand
 * an impossible +4 unit climb, which reads as an unfair death).
 * @param {() => number} rng 0..1
 * @param {number} gapHeight world units
 * @param {number} [prevCenter] previous pillar's gap center (world units)
 * @returns {number} gap center y (world units)
 */
export function rollGapCenter(rng, gapHeight, prevCenter, tune = HOP) {
  const margin = 0.45;
  let lo = tune.FLOOR_Y + margin + gapHeight / 2;
  let hi = tune.CEILING_Y - margin - gapHeight / 2;
  if (typeof prevCenter === 'number') {
    lo = Math.max(lo, prevCenter - tune.GAP_MAX_DIVE);
    hi = Math.min(hi, prevCenter + tune.GAP_MAX_CLIMB);
  }
  return lo + rng() * (hi - lo);
}

/**
 * Wind schedule. Directions alternate so a run cannot be biased toward one
 * edge; elapsed is framework time, therefore pause/resume freezes the phase.
 * @param {number} elapsed seconds
 * @returns {{phase:'none'|'telegraph'|'gust', index:number, direction:-1|1}}
 */
export function gustPhaseAt(elapsed, tune = HOP) {
  const local = elapsed - tune.GUST_FIRST_SEC;
  const cycle = local + tune.GUST_TELEGRAPH_SEC;
  if (cycle < 0) return { phase: 'none', index: -1, direction: 1 };
  const index = Math.floor(cycle / tune.GUST_EVERY_SEC);
  const start = tune.GUST_FIRST_SEC + index * tune.GUST_EVERY_SEC;
  const direction = index % 2 === 0 ? 1 : -1;
  if (elapsed >= start - tune.GUST_TELEGRAPH_SEC && elapsed < start) {
    return { phase: 'telegraph', index, direction };
  }
  if (elapsed >= start && elapsed < start + tune.GUST_DURATION_SEC) {
    return { phase: 'gust', index, direction };
  }
  return { phase: 'none', index, direction };
}

/**
 * Apply the single gust shove, clamped so wind itself never causes an
 * out-of-bounds instant death.
 * @param {number} y Gooby body-center y
 * @param {-1|1} direction
 * @returns {number}
 */
export function applyGustShift(y, direction, tune = HOP) {
  const halfH = forgivingHalf(tune.BODY_HALF_H, tune);
  const shifted = y + direction * tune.GUST_SHIFT_LANES * tune.LANE_HEIGHT;
  return Math.max(tune.FLOOR_Y + halfH + 0.01, Math.min(tune.CEILING_Y - halfH, shifted));
}

/** Gates count double while the gust is active (§C10.2). */
export function gatePoints(gusting) {
  return gusting ? 2 : 1;
}

/** Coin-rain rolls pickup density, not payout constants (§C-SYS4.2). */
export function coinSpawns(roll, tune = HOP) {
  return roll < Math.min(1, tune.COIN_SPAWN_CHANCE * tune.COIN_RATE);
}

export function finalHopScore(score, tune = HOP) {
  return Math.max(0, Math.round(score * (tune.SCORE_MULT ?? 1)));
}

/** Deterministic certification model matching the live bot's attention cap. */
export function simulateHopAutoplay(mode = 'normal', seed = 1) {
  const tune = applyDifficulty(HOP, mode);
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) | 0;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const base = mode === 'easy' ? 62 : mode === 'hard' || mode === 'endless' ? 48 : 55;
  const gates = base + Math.floor(rng() * 10);
  let score = 0;
  for (let i = 0; i < gates; i += 1) {
    const gust = gustPhaseAt((i * tune.PILLAR_SPACING_X) / speedAtGate(i, tune), tune);
    score += gatePoints(gust.phase === 'gust');
    if (coinSpawns(rng(), tune) && rng() < 0.86) score += 1;
  }
  return { score: finalHopScore(score, tune), gates };
}
