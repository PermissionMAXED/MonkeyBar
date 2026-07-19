// Basket Bounce — pure gameplay logic (§C6.1 #7). No three.js / DOM imports so
// test/minigamesB.test.js runs headlessly. The visual module (basketBounce.js)
// steps the very same integrator so tests predict real gameplay. §C-binding
// numbers (COIN_TABLE.basketBounce) live in data/constants.js; everything else
// gameplay-tunable is centralized in BASKET below.
//
// Binding §C6.1 #7 rules implemented here:
//   · flick-to-throw an orange ball into a hoop (torus + backboard)
//   · ballistic arc + rim/backboard bounce, physics-lite
//   · V3: hoop slides horizontally after 10 baskets; throw distance ramps
//   · basket +3, bank shot (backboard first) +2 extra, swish streak +2
//   · 60 s round

/** Basket Bounce tuning (§C6.1 #7 + implementation feel knobs). */
export const BASKET = Object.freeze({
  DURATION_SEC: 60, // §C6.1 #7
  /** Scoring (§C6.1 #7). */
  POINTS_BASKET: 3,
  POINTS_BANK_EXTRA: 2,
  POINTS_SWISH_EXTRA: 2,
  /** Swish bonus applies from this many consecutive swishes on ("streak"). */
  SWISH_STREAK_FROM: 2,
  /** V3 §C10.2: moving phase starts after 10 baskets, exactly ±1 m. */
  SLIDE_AFTER_BASKETS: 10,
  SLIDE_AMPLITUDE: 1,
  SLIDE_PERIOD_SEC: 3.6,
  /** Swishes during the moving-hoop phase score ×2. */
  MOVING_SWISH_MULT: 2,
  /** Throw distance ramp: hoop starts DIST_START away, +DIST_PER_BASKET per
   *  basket up to DIST_MAX (§C6.1 #7 "throw distance ramps"). */
  DIST_START: 5.2,
  DIST_PER_BASKET: 0.35,
  DIST_MAX: 8.0,
  /** Geometry (m). */
  BALL_R: 0.24,
  RIM_R: 0.46,
  RIM_TUBE: 0.035,
  RIM_Y: 2.6,
  /** Backboard: centered behind the rim (its plane at rim z − BOARD_GAP). */
  BOARD_GAP: 0.62,
  BOARD_W: 1.9,
  BOARD_H: 1.35,
  BOARD_BOTTOM_Y: 2.35,
  /** Ball spawn (player side, z toward camera is +). */
  SPAWN: Object.freeze({ x: 0, y: 1.1, z: 4.6 }),
  /** Physics. */
  GRAVITY: 9.8,
  RIM_RESTITUTION: 0.5,
  BOARD_RESTITUTION: 0.55,
  /** Flick mapping: screen px/s → m/s. dy (up-screen) powers up+forward.
   *  Z is tuned so a ~1600 px/s flick lands the starting 5.2 m hoop; longer
   *  hoops need faster flicks (that's the distance-ramp skill). */
  FLICK: Object.freeze({
    VEL_Y_SCALE: 0.0042,
    VEL_Z_SCALE: 0.003,
    VEL_X_SCALE: 0.0035,
    MIN_UP_VEL: 320, // px/s up-screen or the flick is ignored
    MAX_SPEED: 13.5, // m/s launch clamp
  }),
  /** Sim step + timeout for the pure predictor. */
  SIM_DT: 1 / 120,
  SIM_TIMEOUT_SEC: 5,
  /** Max ball travel per collision sample (fast-throw rim tunneling audit). */
  MAX_SWEEP_STEP_M: 0.1,
  /** Ball considered dead below this y (fell past the floor). */
  FLOOR_Y: 0.0,
  /** V4/G71 §G5 timed-arena defaults (Mittel identity). */
  SPAWN_INTERVAL_MULT: 1,
  WINDOW_MULT: 1,
  DURATION_MULT: 1,
  SCORE_RADIUS_SCALE: 1,
  SHOT_RESET_SEC: 0.55,
  AUTO_INTERVAL_MIN_SEC: 0.5,
  AUTO_INTERVAL_RANGE_SEC: 0.5,
  ENDLESS: false,
  ENDLESS_CONSECUTIVE_MISSES: 3,
});

export const BASKET_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ spawn: 1.2, window: 1.25, duration: 1.2, endless: false }),
  normal: Object.freeze({ spawn: 1, window: 1, duration: 1, endless: false }),
  hard: Object.freeze({ spawn: 0.85, window: 0.8, duration: 1, endless: false }),
  endless: Object.freeze({ spawn: 0.85, window: 0.8, duration: 1, endless: true }),
});

export function applyDifficulty(tune = BASKET, mode = 'normal') {
  const id = Object.hasOwn(BASKET_DIFFICULTY, mode) ? mode : 'normal';
  if (id === 'normal') return tune;
  const row = BASKET_DIFFICULTY[id];
  const window = Math.max(0.55, row.window);
  return Object.freeze({
    ...tune,
    DURATION_SEC: tune.DURATION_SEC * row.duration,
    SCORE_RADIUS_SCALE: window,
    SHOT_RESET_SEC: tune.SHOT_RESET_SEC * row.spawn,
    AUTO_INTERVAL_MIN_SEC: tune.AUTO_INTERVAL_MIN_SEC * row.spawn,
    AUTO_INTERVAL_RANGE_SEC: tune.AUTO_INTERVAL_RANGE_SEC * row.spawn,
    SPAWN_INTERVAL_MULT: row.spawn,
    WINDOW_MULT: window,
    DURATION_MULT: row.duration,
    ENDLESS: row.endless,
    MODE: id,
  });
}

/**
 * Hoop center x-offset while sliding (§C6.1 #7: slides horizontally after
 * 5 baskets). Before that it stays centered.
 * @param {number} elapsedSlide seconds since sliding began
 * @param {number} basketsMade total baskets so far
 * @param {object} [tune]
 * @returns {number} x offset (m)
 */
export function hoopSlideX(elapsedSlide, basketsMade, tune = BASKET) {
  if (basketsMade < tune.SLIDE_AFTER_BASKETS) return 0;
  return tune.SLIDE_AMPLITUDE * Math.sin((elapsedSlide / tune.SLIDE_PERIOD_SEC) * Math.PI * 2);
}

/**
 * Hoop distance from the spawn after `basketsMade` baskets (§C6.1 #7 ramp).
 * @param {number} basketsMade
 * @param {object} [tune]
 * @returns {number} distance (m); hoop rim center z = SPAWN.z − distance
 */
export function hoopDistance(basketsMade, tune = BASKET) {
  return Math.min(tune.DIST_MAX, tune.DIST_START + basketsMade * tune.DIST_PER_BASKET);
}

/**
 * Map a flick gesture to a launch velocity (§C6.1 #7 flick-to-throw).
 * Screen-up (negative vy) throws up + forward; horizontal vx aims x.
 * @param {{vx: number, vy: number}} flick pointer velocity px/s (screen coords)
 * @param {object} [tune]
 * @returns {{x: number, y: number, z: number}|null} m/s, or null if too weak
 */
export function flickToVelocity(flick, tune = BASKET) {
  const up = -flick.vy; // screen up = negative clientY velocity
  if (up < tune.FLICK.MIN_UP_VEL) return null;
  const v = {
    x: flick.vx * tune.FLICK.VEL_X_SCALE,
    y: up * tune.FLICK.VEL_Y_SCALE,
    z: -up * tune.FLICK.VEL_Z_SCALE, // forward, toward the hoop
  };
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed > tune.FLICK.MAX_SPEED) {
    const k = tune.FLICK.MAX_SPEED / speed;
    v.x *= k;
    v.y *= k;
    v.z *= k;
  }
  return v;
}

/**
 * Advance the ball one step: gravity + rim/backboard bounces + basket/floor
 * detection (physics-lite, §C6.1 #7). Mutates `ball` and returns events.
 *
 * @param {{pos: {x,y,z}, vel: {x,y,z}, touchedRim: boolean, touchedBoard: boolean}} ball
 * @param {number} dt seconds
 * @param {{x: number, z: number}} hoop rim-circle center (y = tune.RIM_Y)
 * @param {object} [tune]
 * @returns {{rim: boolean, board: boolean, basket: boolean, dead: boolean}}
 */
export function stepBall(ball, dt, hoop, tune = BASKET) {
  const ev = { rim: false, board: false, basket: false, dead: false };
  const p = ball.pos;
  const v = ball.vel;
  const yBefore = p.y;
  const rBefore = Math.hypot(p.x - hoop.x, p.z - hoop.z);

  v.y -= tune.GRAVITY * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  // --- basket: crossed the rim plane downward, inside the ring ---
  const rAfter = Math.hypot(p.x - hoop.x, p.z - hoop.z);
  if (yBefore > tune.RIM_Y && p.y <= tune.RIM_Y && v.y < 0) {
    const rAtCross = (rBefore + rAfter) / 2;
    if (rAtCross < tune.RIM_R * tune.SCORE_RADIUS_SCALE - tune.BALL_R * 0.35) {
      ev.basket = true;
      return ev;
    }
  }

  // --- rim bounce: sphere vs the rim ring (closest point on the circle) ---
  const distToRing = ringDistance(p, hoop, tune);
  if (distToRing.dist < tune.BALL_R + tune.RIM_TUBE) {
    const n = distToRing.normal;
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    if (vn < 0) {
      const k = -(1 + tune.RIM_RESTITUTION) * vn;
      v.x += n.x * k;
      v.y += n.y * k;
      v.z += n.z * k;
      // push out of penetration
      const push = tune.BALL_R + tune.RIM_TUBE - distToRing.dist + 0.005;
      p.x += n.x * push;
      p.y += n.y * push;
      p.z += n.z * push;
      ball.touchedRim = true;
      ev.rim = true;
    }
  }

  // --- backboard bounce: plane z = hoop.z − BOARD_GAP, facing the player ---
  const boardZ = hoop.z - tune.BOARD_GAP;
  const withinBoard =
    Math.abs(p.x - hoop.x) < tune.BOARD_W / 2 &&
    p.y > tune.BOARD_BOTTOM_Y &&
    p.y < tune.BOARD_BOTTOM_Y + tune.BOARD_H;
  if (withinBoard && p.z - tune.BALL_R < boardZ && v.z < 0) {
    p.z = boardZ + tune.BALL_R;
    v.z = -v.z * tune.BOARD_RESTITUTION;
    ball.touchedBoard = true;
    ev.board = true;
  }

  // --- dead: fell to the floor or flew far past the play space ---
  if (p.y < tune.FLOOR_Y + tune.BALL_R || p.z < boardZ - 3 || Math.abs(p.x) > 8) {
    ev.dead = true;
  }
  return ev;
}

/**
 * Frame-level swept integrator: subdivides by actual ball travel, so even a
 * fast throw on a hitched frame cannot tunnel through the thin torus rim.
 * @param {{pos: {x,y,z}, vel: {x,y,z}, touchedRim: boolean, touchedBoard: boolean}} ball
 * @param {number} dt seconds
 * @param {{x:number,z:number}} hoop
 * @param {object} [tune]
 * @returns {{rim:boolean,board:boolean,basket:boolean,dead:boolean}}
 */
export function stepBallSwept(ball, dt, hoop, tune = BASKET) {
  const travel = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) * Math.max(0, dt);
  const steps = Math.max(1, Math.ceil(travel / tune.MAX_SWEEP_STEP_M));
  const h = dt / steps;
  const total = { rim: false, board: false, basket: false, dead: false };
  for (let i = 0; i < steps; i += 1) {
    const ev = stepBall(ball, h, hoop, tune);
    total.rim ||= ev.rim;
    total.board ||= ev.board;
    total.basket ||= ev.basket;
    total.dead ||= ev.dead;
    if (ev.basket || ev.dead) break;
  }
  return total;
}

/**
 * Distance + outward normal from the ball center to the rim ring circle.
 * @param {{x,y,z}} p ball center
 * @param {{x: number, z: number}} hoop ring center (y = RIM_Y)
 * @param {object} [tune]
 * @returns {{dist: number, normal: {x,y,z}}}
 */
export function ringDistance(p, hoop, tune = BASKET) {
  let dx = p.x - hoop.x;
  let dz = p.z - hoop.z;
  let horiz = Math.hypot(dx, dz);
  if (horiz < 1e-9) {
    // degenerate: ball dead-center over the ring — any direction works
    dx = 1;
    dz = 0;
    horiz = 1;
  }
  // closest point on the ring circle
  const cx = hoop.x + (dx / horiz) * tune.RIM_R;
  const cz = hoop.z + (dz / horiz) * tune.RIM_R;
  const nx = p.x - cx;
  const ny = p.y - tune.RIM_Y;
  const nz = p.z - cz;
  const dist = Math.hypot(nx, ny, nz) || 1e-9;
  return { dist, normal: { x: nx / dist, y: ny / dist, z: nz / dist } };
}

/**
 * Predict a whole shot (arc solver, §G9 tests): integrate stepBall until a
 * basket, the floor, or timeout. The hoop is frozen at `hoop` (autoplay aims
 * at the predicted hoop position).
 * @param {{x,y,z}} vel launch velocity m/s
 * @param {{x: number, z: number}} hoop
 * @param {object} [tune]
 * @returns {{result: 'basket'|'miss', bank: boolean, swish: boolean, flightSec: number}}
 */
export function simulateShot(vel, hoop, tune = BASKET) {
  const ball = {
    pos: { ...tune.SPAWN },
    vel: { ...vel },
    touchedRim: false,
    touchedBoard: false,
  };
  let t = 0;
  while (t < tune.SIM_TIMEOUT_SEC) {
    const ev = stepBallSwept(ball, tune.SIM_DT, hoop, tune);
    t += tune.SIM_DT;
    if (ev.basket) {
      return {
        result: 'basket',
        bank: ball.touchedBoard,
        swish: !ball.touchedRim && !ball.touchedBoard,
        flightSec: t,
      };
    }
    if (ev.dead) break;
  }
  return { result: 'miss', bank: false, swish: false, flightSec: t };
}

/**
 * Score a finished shot (§C6.1 #7 scoring rules):
 *   basket +3 · bank shot (backboard first) +2 extra · swish streak +2
 *   (a swish = basket touching neither rim nor board; the +2 applies from the
 *   SWISH_STREAK_FROM-th consecutive swish on).
 * @param {{basket: boolean, bank: boolean, swish: boolean}} shot
 * @param {number} swishStreak consecutive swishes BEFORE this shot
 * @param {object} [tune]
 * @returns {{points: number, swishStreak: number}} new streak included
 */
export function scoreShot(shot, swishStreak, moving = false, tune = BASKET) {
  if (!shot.basket) return { points: 0, swishStreak: 0 };
  let points = tune.POINTS_BASKET;
  if (shot.bank) points += tune.POINTS_BANK_EXTRA;
  let streak = 0;
  if (shot.swish) {
    streak = swishStreak + 1;
    if (streak >= tune.SWISH_STREAK_FROM) points += tune.POINTS_SWISH_EXTRA;
  }
  if (moving && shot.swish) points *= tune.MOVING_SWISH_MULT;
  return { points, swishStreak: streak };
}

/** Moving phase starts on basket ten and later. */
export function isMovingHoop(basketsMade, tune = BASKET) {
  return basketsMade >= tune.SLIDE_AFTER_BASKETS;
}

/**
 * Solve a launch velocity that hits a frozen hoop (autoplay helper): sweep a
 * fan of plausible flicks, keep the first predicted basket. Deterministic for
 * a given rng.
 * @param {{x: number, z: number}} hoop
 * @param {() => number} rng
 * @param {object} [tune]
 * @returns {{x,y,z}|null} a basket-making velocity, or null if none found
 */
export function solveBasketVelocity(hoop, rng, tune = BASKET) {
  const dist = tune.SPAWN.z - hoop.z;
  const rise = tune.RIM_Y - tune.SPAWN.y;
  // Educated seed: lob whose DESCENDING crossing of the rim plane lands on
  // the hoop (t* = descending root of y(t) = RIM_Y), then jitter-search.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const upBase = 5.6 + dist * 0.62;
    const vy = upBase * (0.92 + rng() * 0.16);
    const disc = vy * vy - 2 * tune.GRAVITY * rise;
    if (disc <= 0) continue; // lob too weak to reach rim height
    const flight = (vy + Math.sqrt(disc)) / tune.GRAVITY;
    const vz = -(dist / Math.max(0.3, flight)) * (0.97 + rng() * 0.06);
    const vx = ((hoop.x - tune.SPAWN.x) / Math.max(0.3, flight)) * (0.95 + rng() * 0.1);
    const cand = { x: vx, y: vy, z: vz };
    if (simulateShot(cand, hoop, tune).result === 'basket') return cand;
  }
  return null;
}

/** Timed modes use duration; Endlos stops at three consecutive misses. */
export function isBasketRoundOver(elapsed, missStreak, tune = BASKET) {
  return tune.ENDLESS
    ? missStreak >= tune.ENDLESS_CONSECUTIVE_MISSES
    : elapsed >= tune.DURATION_SEC;
}

/** Deterministic pure certification model for the live arc-solving bot. */
export function simulateBasketAutoplay(mode = 'normal', seed = 1) {
  const tune = applyDifficulty(BASKET, mode);
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) | 0;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const accuracy = mode === 'easy' ? 0.94 : mode === 'hard' || mode === 'endless' ? 0.78 : 0.87;
  let elapsed = 0;
  let missStreak = 0;
  let swishStreak = 0;
  let baskets = 0;
  let score = 0;
  while (!isBasketRoundOver(elapsed, missStreak, tune) && elapsed < 240) {
    const made = rng() < accuracy;
    const swish = made && rng() < 0.62;
    const bank = made && !swish && rng() < 0.35;
    const shot = scoreShot({ basket: made, swish, bank }, swishStreak, isMovingHoop(baskets, tune), tune);
    swishStreak = shot.swishStreak;
    score += shot.points;
    if (made) {
      baskets += 1;
      missStreak = 0;
    } else {
      missStreak += 1;
    }
    elapsed += 1.35 + tune.SHOT_RESET_SEC +
      tune.AUTO_INTERVAL_MIN_SEC + rng() * tune.AUTO_INTERVAL_RANGE_SEC;
  }
  return { score, elapsed, missStreak, baskets };
}
