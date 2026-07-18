// Gooby Runner — pure gameplay logic (§C6.1 #6). No three.js / DOM imports so
// test/minigamesB.test.js runs headlessly. The visual module (runner.js) maps
// this state onto meshes; ALL gameplay numbers not covered by §C
// (COIN_TABLE.runner lives in data/constants.js) are centralized in RUNNER
// below — never inline them elsewhere.
//
// Binding §C6.1 #6 rules implemented here:
//   · 3-lane endless run; swipe left/right = lane, up = jump, down = slide
//   · obstacles: cones, boxes, barriers (jump), overhead scaffolds (slide),
//     parked cars (dodge only) — spawn patterns must ALWAYS be survivable
//   · floating coins +1 each; speed +5% every 10 s
//   · first hit = stumble (lose combo/coin multiplier), second hit = end
//   · score = meters + coins*bonus (bonus scales with the coin-streak combo)

/** Runner tuning (§C6.1 #6 ramp numbers + implementation feel knobs). */
export const RUNNER = Object.freeze({
  LANES: 3,
  /** World x of each lane center (m) — tight enough for the portrait frame. */
  LANE_X: Object.freeze([-1.1, 0, 1.1]),
  /** Base forward speed (m/s) — §C6.1 #6 ramps it +5% per 10 s. */
  BASE_SPEED: 6,
  SPEED_RAMP_PCT: 0.05,
  SPEED_RAMP_EVERY_SEC: 10,
  /** Speed cap so late-game rows stay physically reactable. */
  MAX_SPEED: 13,
  /** Lane-change slide time (s). */
  LANE_CHANGE_SEC: 0.16,
  /** Jump: total airtime (s) and apex height (m). */
  JUMP_SEC: 0.62,
  JUMP_HEIGHT: 1.0,
  /** Slide duration (s) and Gooby's height while sliding (m). */
  SLIDE_SEC: 0.65,
  SLIDE_HEIGHT: 0.5,
  /** Standing collision height (m) — Gooby is ≈1.05 tall (§D2). */
  STAND_HEIGHT: 1.05,
  /** Player collision half-depth along z (m) — forgiving ~70% hitbox. */
  PLAYER_HALF_DEPTH: 0.28,
  /** Obstacle kinds → how they can be passed (besides dodging to a free lane). */
  OBSTACLES: Object.freeze({
    cone: Object.freeze({ pass: 'jump', clearY: 0.45, halfDepth: 0.22 }),
    box: Object.freeze({ pass: 'jump', clearY: 0.55, halfDepth: 0.3 }),
    barrier: Object.freeze({ pass: 'jump', clearY: 0.6, halfDepth: 0.22 }),
    /** Barrier raised on posts — slide under (jumping head-bonks it). */
    overhead: Object.freeze({ pass: 'slide', gapY: 0.72, halfDepth: 0.24 }),
    /** Parked car — full blocker, dodge only. */
    car: Object.freeze({ pass: 'none', halfDepth: 0.95 }),
  }),
  /** Distance between successive obstacle rows (m) at difficulty 0 → 1. */
  ROW_GAP_M: Object.freeze({ start: 13, end: 8.5 }),
  /** Difficulty reaches 1 after this many seconds. */
  DIFFICULTY_FULL_SEC: 90,
  /** Chance a row has 2 blocked lanes (ramps start → end with difficulty). */
  DOUBLE_BLOCK_CHANCE: Object.freeze({ start: 0.25, end: 0.62 }),
  /** Weights for picking obstacle kinds (cars get likelier later). */
  KIND_WEIGHTS: Object.freeze({ cone: 3, box: 2, barrier: 2, overhead: 2.2, car: 1.6 }),
  /** Coins: +1 score each ×(bonus × combo multiplier) — §C6.1 "coins*bonus". */
  COIN_SCORE_BONUS: 2,
  /** Coin-streak combo: multiplier steps at these uninterrupted coin counts. */
  COMBO_STEPS: Object.freeze([0, 10, 22]),
  COMBO_MAX_MULT: 3,
  /** Coins per line placed in a free lane between rows. */
  COIN_LINE: 3,
  COIN_LINE_CHANCE: 0.75,
  /** Stumble: brief invulnerability after the first hit (s). */
  STUMBLE_INVULN_SEC: 1.6,
  /** Max hits — first = stumble, second = end (§C6.1 #6). */
  MAX_HITS: 2,
  /** V3 §C10.2 mystery-box powerups (shoppingSurf-aligned set). */
  MYSTERY_POWERS: Object.freeze({
    magnet: Object.freeze({ sec: 4, radius: 3 }),
    x2: Object.freeze({ sec: 6 }),
    shield: Object.freeze({}),
  }),
  MYSTERY_FIRST_M: 45,
  MYSTERY_GAP_M: 70,
  /**
   * Anti-tunneling (F4 P2-4): largest obstacle advance between collision
   * samples (m). The smallest full collision window is a cone/barrier:
   * 2 × (0.22 + 0.28) = 1.0 m — at MAX_SPEED 13 m/s a 0.1 s frame (the
   * sceneManager dt clamp) advances 1.3 m, which could skip clean past it.
   * 0.35 m guarantees ≥ 2 samples inside every window at any dt.
   */
  MAX_SWEEP_STEP_M: 0.35,
});

/**
 * Forward speed after `elapsed` seconds: +5% (compounding) every 10 s,
 * capped at MAX_SPEED (§C6.1 #6).
 * @param {number} elapsed seconds since the round started
 * @param {object} [tune] RUNNER override (tests)
 * @returns {number} m/s
 */
export function speedAt(elapsed, tune = RUNNER) {
  const steps = Math.floor(Math.max(0, elapsed) / tune.SPEED_RAMP_EVERY_SEC);
  return Math.min(tune.MAX_SPEED, tune.BASE_SPEED * (1 + tune.SPEED_RAMP_PCT) ** steps);
}

/**
 * Difficulty 0..1 ramp used by row spacing / double-block chance.
 * @param {number} elapsed seconds
 * @param {object} [tune]
 * @returns {number}
 */
export function difficultyAt(elapsed, tune = RUNNER) {
  return Math.min(1, Math.max(0, elapsed / tune.DIFFICULTY_FULL_SEC));
}

/** Lerp helper for {start,end} difficulty knobs. */
function ramp(knob, d) {
  return knob.start + (knob.end - knob.start) * d;
}

/**
 * Distance to the next obstacle row (m) at a difficulty.
 * @param {number} difficulty 0..1
 * @param {object} [tune]
 * @returns {number}
 */
export function rowGapAt(difficulty, tune = RUNNER) {
  return ramp(tune.ROW_GAP_M, difficulty);
}

/**
 * Coin-streak combo multiplier (×1..×3): steps up at COMBO_STEPS coins
 * collected without a hit. Stumbling resets the streak (§C6.1 #6).
 * @param {number} coinStreak coins collected since the last hit
 * @param {object} [tune]
 * @returns {number}
 */
export function comboMultiplier(coinStreak, tune = RUNNER) {
  let mult = 0;
  for (const step of tune.COMBO_STEPS) {
    if (coinStreak >= step) mult += 1;
  }
  return Math.min(tune.COMBO_MAX_MULT, Math.max(1, mult));
}

/**
 * Total score (§C6.1 #6): floor(meters) + coinPoints, where each coin banked
 * COIN_SCORE_BONUS × its combo multiplier when collected (accumulated by the
 * caller into `coinPoints`).
 * @param {number} meters distance run
 * @param {number} coinPoints accumulated coin score
 * @returns {number}
 */
export function runnerScore(meters, coinPoints) {
  return Math.max(0, Math.floor(meters) + Math.round(coinPoints));
}

/**
 * Can the player pass an obstacle kind in the SAME lane with an action?
 * @param {'cone'|'box'|'barrier'|'overhead'|'car'} kind
 * @param {'run'|'jump'|'slide'} action
 * @param {object} [tune]
 * @returns {boolean}
 */
export function actionPasses(kind, action, tune = RUNNER) {
  const def = tune.OBSTACLES[kind];
  if (!def) return true;
  if (def.pass === 'jump') return action === 'jump';
  if (def.pass === 'slide') return action === 'slide';
  return false; // 'none' — cars block the lane entirely
}

/**
 * Collision test for one frame (§C6.1 #6 collision windows).
 * The player sits at z = 0; obstacles carry a world z and per-kind half-depth.
 *
 * @param {{lane: number, y: number, sliding: boolean}} player
 *   y = current hop height (m), sliding = slide pose active
 * @param {{lane: number, kind: string, z: number}} obstacle
 * @param {object} [tune]
 * @returns {boolean} true when this frame is a hit
 */
export function hitsObstacle(player, obstacle, tune = RUNNER) {
  if (player.lane !== obstacle.lane) return false;
  const def = tune.OBSTACLES[obstacle.kind];
  const reach = def.halfDepth + tune.PLAYER_HALF_DEPTH;
  if (Math.abs(obstacle.z) > reach) return false;
  if (def.pass === 'jump') {
    return player.y < def.clearY; // airborne high enough clears it
  }
  if (def.pass === 'slide') {
    // Under the bar only while squashed on the ground; standing or jumping bonks it.
    return !(player.sliding && player.y + tune.SLIDE_HEIGHT <= def.gapY);
  }
  return true; // car — same lane always hits
}

/**
 * Swept collision test for one frame (F4 P2-4 anti-tunneling): the obstacle
 * advances by `dz` this frame — at low FPS (15–20 fps ⇒ dt 50–66 ms, and the
 * sceneManager clamps dt at 100 ms) a single end-of-frame hitsObstacle check
 * can skip clean across the ±(halfDepth + PLAYER_HALF_DEPTH) window. Samples
 * the advance every ≤ MAX_SWEEP_STEP_M (endpoint inclusive; the start point
 * was the previous frame's endpoint) so no window can be jumped.
 * @param {{lane: number, y: number, sliding: boolean}} player
 * @param {{lane: number, kind: string, z: number}} obstacle PRE-advance z
 * @param {number} dz obstacle z advance this frame (m, usually speed × dt)
 * @param {object} [tune]
 * @returns {boolean} true when any sample along the advance is a hit
 */
export function sweepHitsObstacle(player, obstacle, dz, tune = RUNNER) {
  const steps = Math.max(1, Math.ceil(Math.abs(dz) / tune.MAX_SWEEP_STEP_M));
  for (let i = 1; i <= steps; i += 1) {
    if (hitsObstacle(player, { ...obstacle, z: obstacle.z + (dz * i) / steps }, tune)) {
      return true;
    }
  }
  return false;
}

/** Seeded mystery-box roll: Magnet / ×2 / stumble shield. */
export function rollMysteryPower(rng) {
  const kinds = /** @type {const} */ (['magnet', 'x2', 'shield']);
  return kinds[Math.min(kinds.length - 1, Math.floor(rng() * kinds.length))];
}

/**
 * Activate one mystery powerup without disturbing the other active effects.
 * @param {{magnetT:number, x2T:number, shield:boolean}} state
 * @param {'magnet'|'x2'|'shield'} kind
 * @param {object} [tune]
 * @returns {{magnetT:number, x2T:number, shield:boolean}}
 */
export function activateMysteryPower(state, kind, tune = RUNNER) {
  if (kind === 'magnet') return { ...state, magnetT: tune.MYSTERY_POWERS.magnet.sec };
  if (kind === 'x2') return { ...state, x2T: tune.MYSTERY_POWERS.x2.sec };
  return { ...state, shield: true };
}

/** ×2 doubles each collected coin's existing combo-scaled score value. */
export function mysteryCoinPoints(comboMult, x2Active, tune = RUNNER) {
  return tune.COIN_SCORE_BONUS * comboMult * (x2Active ? 2 : 1);
}

/**
 * Magnet pickup radius, aligned with shoppingSurf's 3 m magnet.
 * @param {{x:number,y:number,z:number}} coin
 * @param {{x:number,y:number,z:number}} player
 * @param {boolean} active
 * @param {object} [tune]
 * @returns {boolean}
 */
export function magnetCollects(coin, player, active, tune = RUNNER) {
  return active &&
    Math.hypot(coin.x - player.x, coin.y - player.y, coin.z - player.z) <=
      tune.MYSTERY_POWERS.magnet.radius;
}

/**
 * Resolve an obstacle hit atomically. Invulnerability rejects a second hit;
 * a stumble shield consumes itself and grants the same safety window.
 * @param {{hits:number, shield:boolean, invulnT:number}} state
 * @param {object} [tune]
 * @returns {{hits:number, shield:boolean, invulnT:number, outcome:'ignored'|'shielded'|'stumble'|'wipeout'}}
 */
export function resolveRunnerHit(state, tune = RUNNER) {
  if (state.invulnT > 0) return { ...state, outcome: 'ignored' };
  if (state.shield) {
    return {
      hits: state.hits,
      shield: false,
      invulnT: tune.STUMBLE_INVULN_SEC,
      outcome: 'shielded',
    };
  }
  const hits = state.hits + 1;
  return {
    hits,
    shield: false,
    invulnT: tune.STUMBLE_INVULN_SEC,
    outcome: hits >= tune.MAX_HITS ? 'wipeout' : 'stumble',
  };
}

// ---------------------------------------------------------------------------
// Spawn patterns + survivability validator (§C6.1 #6: "never require
// impossible transitions")
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Row
 * @property {Array<string|null>} lanes  per-lane obstacle kind or null (free)
 * @property {number} gap  distance (m) from the PREVIOUS row to this one
 */

/**
 * How many lanes the player can shift while covering `gapM` meters at
 * `speed` m/s (each lane change costs LANE_CHANGE_SEC plus a small
 * reaction/settle margin).
 * @param {number} gapM
 * @param {number} speed m/s
 * @param {object} [tune]
 * @returns {number} 0..2
 */
export function maxLaneShift(gapM, speed, tune = RUNNER) {
  const time = gapM / Math.max(0.001, speed);
  const perChange = tune.LANE_CHANGE_SEC + 0.22; // change + react/settle margin
  return Math.max(0, Math.min(2, Math.floor(time / perChange)));
}

/**
 * Lane-survivability of a single row: which lanes can be passed at all
 * (free lane, or an obstacle that jump/slide clears).
 * @param {Row} row
 * @param {object} [tune]
 * @returns {boolean[]} per-lane passable flags
 */
export function passableLanes(row, tune = RUNNER) {
  return row.lanes.map((kind) => {
    if (kind == null) return true;
    return actionPasses(kind, 'jump', tune) || actionPasses(kind, 'slide', tune);
  });
}

/**
 * Survivability validator (§C6.1 #6): DP-reachability across rows. From every
 * lane the player survives row i in, they can shift ≤ maxLaneShift(gap, speed)
 * lanes before row i+1. A pattern is survivable when at least one lane chain
 * exists through ALL rows.
 *
 * @param {Row[]} rows in spawn order; rows[i].gap = distance from row i−1
 * @param {number} speed m/s used for the lane-shift windows (use the max
 *   speed the pattern can be alive at for a conservative check)
 * @param {object} [tune]
 * @returns {boolean}
 */
export function isPatternSurvivable(rows, speed, tune = RUNNER) {
  let reachable = new Array(tune.LANES).fill(true); // player may start anywhere
  for (const row of rows) {
    const shift = maxLaneShift(row.gap, speed, tune);
    const pass = passableLanes(row, tune);
    const next = new Array(tune.LANES).fill(false);
    for (let to = 0; to < tune.LANES; to += 1) {
      if (!pass[to]) continue;
      for (let from = 0; from < tune.LANES; from += 1) {
        if (reachable[from] && Math.abs(to - from) <= shift) {
          next[to] = true;
          break;
        }
      }
    }
    reachable = next;
    if (!reachable.some(Boolean)) return false;
  }
  return true;
}

/** Weighted obstacle-kind pick. @param {() => number} rng */
function pickKind(rng, tune) {
  const entries = Object.entries(tune.KIND_WEIGHTS);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [kind, w] of entries) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return entries[entries.length - 1][0];
}

/**
 * Generate the next obstacle row, guaranteed survivable w.r.t. the previous
 * rows at `speed` (§C6.1 #6 validation): candidates are re-rolled until the
 * sliding window of recent rows passes isPatternSurvivable; a fully free
 * center-lane row is the final fallback (always survivable).
 *
 * @param {() => number} rng
 * @param {number} elapsed seconds since round start (difficulty/speed source)
 * @param {Row[]} recentRows up to the last few generated rows (window)
 * @param {object} [tune]
 * @returns {Row}
 */
export function generateRow(rng, elapsed, recentRows, tune = RUNNER) {
  const d = difficultyAt(elapsed, tune);
  const speed = speedAt(elapsed, tune);
  const gap = rowGapAt(d, tune) * (0.9 + rng() * 0.25);
  const window = recentRows.slice(-4);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const lanes = new Array(tune.LANES).fill(null);
    const blockCount = rng() < ramp(tune.DOUBLE_BLOCK_CHANCE, d) ? 2 : 1;
    const laneOrder = [0, 1, 2].sort(() => rng() - 0.5);
    for (let b = 0; b < blockCount; b += 1) {
      lanes[laneOrder[b]] = pickKind(rng, tune);
    }
    const row = { lanes, gap };
    if (isPatternSurvivable([...window, row], speed, tune)) return row;
  }
  // Fallback: single cone off-center — trivially survivable.
  const lanes = new Array(tune.LANES).fill(null);
  lanes[0] = 'cone';
  return { lanes, gap };
}
