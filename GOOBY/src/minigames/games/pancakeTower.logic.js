// Pancake Tower — pure gameplay logic (§C6.1 #8). No three.js / DOM imports so
// test/minigamesB.test.js runs headlessly. §C-binding numbers
// (COIN_TABLE.pancakeTower) live in data/constants.js; gameplay tuning is
// centralized in PANCAKE below.
//
// Binding §C6.1 #8 rules implemented here:
//   · a pancake slides left-right above the stack; tap to drop
//   · overhang is sliced off (width shrinks)
//   · every 5th layer = bonus topping (butter/strawberry, +4 pts, no shrink)
//   · perfect drop (≤ 6 px equivalent — see PERFECT_EPS below) +2 & width
//     restores +10%
//   · ends when width < 20% or 40 layers · score = layers*2 + bonuses

/** Pancake Tower tuning (§C6.1 #8 + implementation feel knobs). */
export const PANCAKE = Object.freeze({
  /** Base pancake width (world units, x axis — the slide/slice axis). */
  BASE_WIDTH: 1.5,
  /** Pancake thickness (world units) — one layer of tower height. */
  LAYER_HEIGHT: 0.16,
  /**
   * Perfect-drop threshold, PRECISELY defined (§C6.1 #8 "≤ 6 px equivalent
   * in world units"): at the 390 px-wide portrait baseline (§D5) the game
   * camera frames ≈ 2.9 world units across the stack plane, so
   * 6 px ≡ 6 × (2.9 / 390) ≈ 0.0446 → PERFECT_EPS = 0.045 world units of
   * |drop center − stack center| offset.
   */
  PERFECT_EPS: 0.045,
  /** Perfect drop: +2 pts & width restores +10% of BASE_WIDTH (§C6.1 #8). */
  PERFECT_POINTS: 2,
  PERFECT_RESTORE_PCT: 0.1,
  /** Every 5th layer is a bonus topping: +4 pts, no shrink (§C6.1 #8). */
  TOPPING_EVERY: 5,
  TOPPING_POINTS: 4,
  /** Score = layers × 2 + bonuses (§C6.1 #8). */
  POINTS_PER_LAYER: 2,
  /** End conditions (§C6.1 #8): width < 20% of base, or 40 layers. */
  END_WIDTH_FRAC: 0.2,
  MAX_LAYERS: 40,
  /** Slide motion: x(t) = amplitude × sin(2π t / period); period shrinks
   *  (speeds up) with each layer down to PERIOD_MIN. */
  SLIDE_AMPLITUDE: 1.05,
  SLIDE_PERIOD_START: 2.6,
  SLIDE_PERIOD_STEP: 0.055,
  SLIDE_PERIOD_MIN: 1.15,
  /** Drop fall speed (world units/s). */
  FALL_SPEED: 7,
  /** V3 §C10.2: tower spring-wobble begins at landed height 8. */
  WOBBLE_START_LAYER: 8,
  WOBBLE_FORCE: 0.7,
  WOBBLE_SPRING: 10,
  WOBBLE_DAMPING: 3.2,
  WOBBLE_MAX_RAD: 0.16,
  PERFECT_WOBBLE_DAMP: 0.4,
  /** Audit contract: all missed/cut pieces, including toppings, despawn. */
  FALLEN_DESPAWN_SEC: 1.4,
});

/**
 * Is layer `index` (1-based count of the pancake being dropped) a bonus
 * topping layer? Every 5th (§C6.1 #8): 5, 10, 15, …
 * @param {number} index 1-based layer number
 * @param {object} [tune]
 * @returns {boolean}
 */
export function isToppingLayer(index, tune = PANCAKE) {
  return index > 0 && index % tune.TOPPING_EVERY === 0;
}

/**
 * Slider x position at time t for a given layer (§C6.1 #8 "slides
 * left-right"; speed ramps with height).
 * @param {number} t seconds since this pancake appeared
 * @param {number} layerIndex 1-based layer number
 * @param {number} [phase] 0..1 phase offset (variety per layer)
 * @param {object} [tune]
 * @returns {number} x
 */
export function slideX(t, layerIndex, phase = 0, tune = PANCAKE) {
  const period = slidePeriod(layerIndex, tune);
  return tune.SLIDE_AMPLITUDE * Math.sin(((t / period) + phase) * Math.PI * 2);
}

/**
 * Slide period (s) for a layer — smaller = faster = harder.
 * @param {number} layerIndex 1-based
 * @param {object} [tune]
 * @returns {number}
 */
export function slidePeriod(layerIndex, tune = PANCAKE) {
  return Math.max(
    tune.SLIDE_PERIOD_MIN,
    tune.SLIDE_PERIOD_START - (layerIndex - 1) * tune.SLIDE_PERIOD_STEP
  );
}

/**
 * Resolve a drop (the heart of §C6.1 #8 slice math). Width/center along the
 * slide axis (x). Perfect drops snap onto the stack center and restore width;
 * non-perfect drops keep only the overlap; zero overlap = total miss.
 *
 * @param {{center: number, width: number}} stack current top of the stack
 * @param {number} dropCenter x where the pancake was dropped
 * @param {boolean} topping topping layers never shrink the width (§C6.1 #8)
 * @param {object} [tune]
 * @returns {{
 *   landed: boolean,        // false = complete miss (no overlap)
 *   perfect: boolean,
 *   center: number,         // resting center of the landed piece
 *   width: number,          // width of the stack top after this drop
 *   cut: {size: number, side: -1|1, center: number}|null, // sliced-off piece
 *   points: number,         // perfect/topping bonus points ONLY
 * }}
 */
export function resolveDrop(stack, dropCenter, topping, tune = PANCAKE) {
  const offset = dropCenter - stack.center;
  const absOff = Math.abs(offset);

  // --- perfect drop: snap + restore (§C6.1 #8) ---
  if (absOff <= tune.PERFECT_EPS) {
    const width = topping
      ? stack.width
      : Math.min(tune.BASE_WIDTH, stack.width + tune.BASE_WIDTH * tune.PERFECT_RESTORE_PCT);
    return {
      landed: true,
      perfect: true,
      center: stack.center,
      width,
      cut: null,
      points: tune.PERFECT_POINTS + (topping ? tune.TOPPING_POINTS : 0),
    };
  }

  const overlap = stack.width - absOff;
  if (overlap <= 0) {
    // total miss — the whole pancake tumbles off
    return { landed: false, perfect: false, center: stack.center, width: stack.width, cut: null, points: 0 };
  }

  const side = offset > 0 ? 1 : -1;
  if (topping) {
    // toppings never shrink (§C6.1 #8) — they settle clamped onto the stack
    const maxOff = Math.max(0, (stack.width - overlap) / 2);
    const center = stack.center + side * Math.min(absOff, maxOff);
    return { landed: true, perfect: false, center, width: stack.width, cut: null, points: tune.TOPPING_POINTS };
  }

  // --- normal slice: keep the overlap, cut the overhang (§C6.1 #8) ---
  const newCenter = stack.center + (offset / 2);
  const cutSize = absOff;
  const cutCenter = dropCenter + side * (overlap / 2); // center of the overhang piece
  return {
    landed: true,
    perfect: false,
    center: newCenter,
    width: overlap,
    cut: { size: cutSize, side, center: cutCenter },
    points: 0,
  };
}

/**
 * End conditions (§C6.1 #8): width < 20% of base, or 40 layers stacked.
 * @param {number} width current stack-top width
 * @param {number} layers layers successfully landed
 * @param {object} [tune]
 * @returns {boolean}
 */
export function isTowerDone(width, layers, tune = PANCAKE) {
  return width < tune.BASE_WIDTH * tune.END_WIDTH_FRAC || layers >= tune.MAX_LAYERS;
}

/**
 * Total score (§C6.1 #8): layers × 2 + bonuses (perfect +2 each, topping +4
 * each — accumulated by the caller into `bonusPoints`).
 * @param {number} layers layers landed
 * @param {number} bonusPoints sum of resolveDrop(...).points
 * @param {object} [tune]
 * @returns {number}
 */
export function towerScore(layers, bonusPoints, tune = PANCAKE) {
  return Math.max(0, layers * tune.POINTS_PER_LAYER + Math.round(bonusPoints));
}

/** @returns {{angle:number,velocity:number,phase:number}} */
export function initialWobbleState() {
  return { angle: 0, velocity: 0, phase: 0 };
}

/**
 * Damped, driven tower sway. Below height 8 it settles toward rest.
 * @param {{angle:number,velocity:number,phase:number}} state
 * @param {number} dt seconds
 * @param {number} layers landed layer count
 * @param {object} [tune]
 * @returns {{angle:number,velocity:number,phase:number}}
 */
export function stepWobble(state, dt, layers, tune = PANCAKE) {
  const h = Math.max(0, dt);
  const phase = state.phase + h;
  const active = layers >= tune.WOBBLE_START_LAYER;
  const ramp = active
    ? Math.min(1, (layers - tune.WOBBLE_START_LAYER + 1) / 8)
    : 0;
  const drive = active ? Math.sin(phase * 2.3) * tune.WOBBLE_FORCE * ramp : 0;
  const accel = drive - state.angle * tune.WOBBLE_SPRING -
    state.velocity * tune.WOBBLE_DAMPING;
  const velocity = state.velocity + accel * h;
  const angle = Math.max(
    -tune.WOBBLE_MAX_RAD,
    Math.min(tune.WOBBLE_MAX_RAD, state.angle + velocity * h)
  );
  return { angle, velocity, phase };
}

/**
 * Perfect drops visibly stabilize the tower.
 * @param {{angle:number,velocity:number,phase:number}} state
 * @param {object} [tune]
 */
export function dampWobble(state, tune = PANCAKE) {
  return {
    angle: state.angle * tune.PERFECT_WOBBLE_DAMP,
    velocity: state.velocity * tune.PERFECT_WOBBLE_DAMP,
    phase: state.phase,
  };
}

/**
 * World-space x of the swaying stack top after rotating around its base.
 * @param {number} localCenter
 * @param {number} heightAboveBase
 * @param {number} angle radians
 */
export function wobbleTopX(localCenter, heightAboveBase, angle) {
  return localCenter * Math.cos(angle) - heightAboveBase * Math.sin(angle);
}

/**
 * Inverse of wobbleTopX for a piece landing at a known world x.
 * @param {number} worldX
 * @param {number} heightAboveBase
 * @param {number} angle radians
 */
export function wobbleLocalX(worldX, heightAboveBase, angle) {
  const c = Math.cos(angle);
  return (worldX + heightAboveBase * Math.sin(angle)) / (Math.abs(c) < 1e-6 ? 1e-6 : c);
}

/** Fallen toppings and pancake cuts share the same bounded lifetime. */
export function isFallenExpired(age, tune = PANCAKE) {
  return age >= tune.FALLEN_DESPAWN_SEC;
}
