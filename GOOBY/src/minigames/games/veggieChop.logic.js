// Veggie Chop — pure arc/scoring logic (PLAN2 §C1.2 #4, agent V2/G27). No
// three.js/DOM imports so `node --test` runs this headlessly (§B rule); the
// game module (veggieChop.js) imports from here. Binding §C1.2 numbers:
// veggies/fruits lobbed up in arcs (1–3 at once, ramping), swipe-chop +2
// (+1 per extra chopped in the same swipe = combo), junk (soda can, boot)
// −3 + 0.5 s stun, 3 veggies fallen unchopped end the round early, ≤ 60 s,
// whole+half food-kit pairs. Coin row (§C1.1): divisor 5, min 4, max 26,
// typical raw ≈ 70 → ~14c.

/** Binding §C1.2 #4 numbers + G27 tuning (arc physics, cadence, bot). */
export const CHOP = Object.freeze({
  /** Round length cap (§C1.2: ≤ 60 s). */
  DURATION_SEC: 60,
  /** Swipe-chop points (§C1.2: +2 per veggie). */
  CHOP_PTS: 2,
  /** Multi-chop combo (§C1.2: +1 per extra veggie in one swipe). */
  COMBO_BONUS: 1,
  /** Chopping junk (§C1.2: soda can, boot): −3 and a 0.5 s splash stun. */
  JUNK_PTS: -3,
  STUN_SEC: 0.5,
  /** Unchopped veggie misses that end the round early (§C1.2). */
  MAX_MISSES: 3,
  /** Arc waves ramp 1 → 3 items (§C1.2): size caps unlock over time. */
  WAVE2_FROM_SEC: 20,
  WAVE3_FROM_SEC: 40,
  /** G27 tuning: seconds between waves (tightens across the round). */
  SPAWN_START_SEC: 2.3,
  SPAWN_END_SEC: 1.7,
  /** Junk odds ramp across the round. */
  JUNK_CHANCE_START: 0.1,
  JUNK_CHANCE_END: 0.22,
  /** Arc physics at the z=0 play plane (wu/s² — cartoon-slow lobs). */
  GRAVITY: 9.5,
  /** World-y band the lob apexes aim for (upper-mid screen). */
  APEX_MIN_Y: -0.4,
  APEX_MAX_Y: 2.3,
  /** Swipe-chop hit radius around an item's center (wu). */
  HIT_RADIUS: 0.42,
  /** Autoplay (§C1.2: synthesizes a swipe per veggie at apex, ignores
   * junk). Human-ish: skips some veggies, aims with positional error. */
  AUTOPLAY_CHOP_RATE: 0.965,
  AUTOPLAY_AIM_ERR: 0.14,
  /** V3/G45 (§C10.2): frenzy starts every 25 s. */
  FRENZY_EVERY_SEC: 25,
  /** Each frenzy launches exactly 8 veggies over 3 s, with zero junk. */
  FRENZY_DURATION_SEC: 3,
  FRENZY_ITEMS: 8,
});

/**
 * The 8 whole+half food-kit pairs (§C1.2 — committed by wave-1 G15; keys
 * verbatim from scripts/kenney-manifest.mjs). `juice` tints the splash.
 */
export const VEGGIES = Object.freeze([
  Object.freeze({ key: 'apple', half: 'apple-half', juice: '#E85D4A' }),
  Object.freeze({ key: 'pear', half: 'pear-half', juice: '#B3D06B' }),
  Object.freeze({ key: 'lemon', half: 'lemon-half', juice: '#FFE066' }),
  Object.freeze({ key: 'onion', half: 'onion-half', juice: '#F2E8DA' }),
  Object.freeze({ key: 'mushroom', half: 'mushroom-half', juice: '#E8D9C5' }),
  Object.freeze({ key: 'paprika', half: 'paprika-slice', juice: '#FF8552' }),
  Object.freeze({ key: 'tomato', half: 'tomato-slice', juice: '#E8523F' }),
  Object.freeze({ key: 'coconut', half: 'coconut-half', juice: '#FFFFFF' }),
]);

/** Junk (§C1.2: soda can + boot; soda is food-kit, the boot is procedural). */
export const JUNK_ITEMS = Object.freeze(['soda', 'boot']);

/**
 * Largest wave size at a moment of the round (§C1.2: 1–3, ramping).
 * @param {number} elapsed seconds since round start
 * @returns {1|2|3}
 */
export function maxWaveSizeAt(elapsed) {
  if (elapsed >= CHOP.WAVE3_FROM_SEC) return 3;
  if (elapsed >= CHOP.WAVE2_FROM_SEC) return 2;
  return 1;
}

/**
 * Roll a wave size: 1 … maxWaveSizeAt(elapsed), uniform.
 * @param {() => number} rng 0..1
 * @param {number} elapsed seconds
 * @returns {number}
 */
export function waveSizeAt(rng, elapsed) {
  return 1 + Math.floor(rng() * maxWaveSizeAt(elapsed));
}

/**
 * Seconds until the next wave (cadence tightens across the round).
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number}
 */
export function spawnIntervalAt(elapsed, duration = CHOP.DURATION_SEC) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return CHOP.SPAWN_START_SEC + (CHOP.SPAWN_END_SEC - CHOP.SPAWN_START_SEC) * t;
}

/**
 * Junk probability at a moment of the round (linear ramp).
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number}
 */
export function junkChanceAt(elapsed, duration = CHOP.DURATION_SEC) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return CHOP.JUNK_CHANCE_START + (CHOP.JUNK_CHANCE_END - CHOP.JUNK_CHANCE_START) * t;
}

/**
 * Roll one lobbed item: junk with `junkChanceAt` odds, else a random veggie.
 * @param {() => number} rng 0..1
 * @param {number} elapsed seconds
 * @returns {{kind: 'veggie'|'junk', key: string, half?: string, juice?: string}}
 */
export function rollItem(rng, elapsed) {
  if (rng() < junkChanceAt(elapsed)) {
    const key = JUNK_ITEMS[Math.min(JUNK_ITEMS.length - 1, Math.floor(rng() * JUNK_ITEMS.length))];
    return { kind: 'junk', key };
  }
  return rollVeggie(rng);
}

/**
 * Roll a guaranteed veggie (the frenzy's no-junk contract).
 * @param {() => number} rng
 * @returns {{kind: 'veggie', key: string, half: string, juice: string}}
 */
export function rollVeggie(rng) {
  const v = VEGGIES[Math.min(VEGGIES.length - 1, Math.floor(rng() * VEGGIES.length))];
  return { kind: 'veggie', key: v.key, half: v.half, juice: v.juice };
}

/**
 * Exact cadence needed to fit eight frenzy veggies inside three seconds.
 * @returns {number}
 */
export function frenzySpawnInterval() {
  return CHOP.FRENZY_DURATION_SEC / CHOP.FRENZY_ITEMS;
}

/**
 * Count frenzy starts reached by a round time (25 s and 50 s in a 60 s run).
 * @param {number} elapsed
 * @returns {number}
 */
export function frenzyCountAt(elapsed) {
  return Math.floor(Math.max(0, elapsed) / CHOP.FRENZY_EVERY_SEC);
}

/**
 * Launch velocity that peaks `h` wu above the launch point: √(2gh).
 * @param {number} h apex height above launch (wu, ≥ 0)
 * @param {number} [g]
 * @returns {number} wu/s
 */
export function vyForApex(h, g = CHOP.GRAVITY) {
  return Math.sqrt(2 * g * Math.max(0, h));
}

/**
 * Build one lob arc: launched from below the screen, apex inside the
 * §CHOP.APEX band and horizontally inside the safe view.
 * @param {() => number} rng 0..1
 * @param {number} halfW visible half-width at the play plane (wu)
 * @param {number} y0 launch height (wu — just below the bottom edge)
 * @param {number} [g]
 * @returns {{x0: number, y0: number, vx: number, vy: number}}
 */
export function makeArc(rng, halfW, y0, g = CHOP.GRAVITY) {
  const apexY = CHOP.APEX_MIN_Y + rng() * (CHOP.APEX_MAX_Y - CHOP.APEX_MIN_Y);
  const vy = vyForApex(apexY - y0, g);
  const tApex = vy / g;
  const x0 = (rng() * 2 - 1) * Math.max(0, halfW - 0.4);
  const apexX = (rng() * 2 - 1) * Math.max(0, halfW - 0.55);
  const vx = tApex > 0 ? (apexX - x0) / tApex : 0;
  return { x0, y0, vx, vy };
}

/**
 * Arc position at time t since launch (the "arc solver" — §C1.5).
 * @param {{x0: number, y0: number, vx: number, vy: number}} arc
 * @param {number} t seconds since launch
 * @param {number} [g]
 * @returns {{x: number, y: number}}
 */
export function arcPos(arc, t, g = CHOP.GRAVITY) {
  return { x: arc.x0 + arc.vx * t, y: arc.y0 + arc.vy * t - 0.5 * g * t * t };
}

/**
 * Apex time + position of an arc (autoplay swipes each veggie here).
 * @param {{x0: number, y0: number, vx: number, vy: number}} arc
 * @param {number} [g]
 * @returns {{t: number, x: number, y: number}}
 */
export function arcApex(arc, g = CHOP.GRAVITY) {
  const t = arc.vy / g;
  const p = arcPos(arc, t, g);
  return { t, x: p.x, y: p.y };
}

/**
 * Points for the k-th chop of ONE swipe gesture (§C1.2: +2, +1 per extra):
 * the first veggie of a swipe is worth 2, every further one 3.
 * @param {number} k 1-based index of this chop within the swipe
 * @returns {number}
 */
export function chopPoints(k) {
  return CHOP.CHOP_PTS + (k > 1 ? CHOP.COMBO_BONUS : 0);
}

/**
 * Advance the current swipe combo, or reset it immediately on junk. Keeping
 * this state transition pure locks the §C10.2 junk-reset audit.
 * @param {number} current
 * @param {'veggie'|'junk'} kind
 * @returns {number}
 */
export function comboAfterHit(current, kind) {
  return kind === 'junk' ? 0 : Math.max(0, current) + 1;
}

/**
 * Total for a swipe that chops n veggies: 2n + (n−1) — the combo counter
 * (§C1.5). Equals the sum of chopPoints(1..n).
 * @param {number} n veggies chopped in one swipe
 * @returns {number}
 */
export function swipeScore(n) {
  if (n <= 0) return 0;
  return CHOP.CHOP_PTS * n + CHOP.COMBO_BONUS * (n - 1);
}

/**
 * Apply a delta to the score, floored at 0 (junk −3 never goes negative —
 * the §C1.1 coin clamp min 4 covers the floor anyway).
 * @param {number} score
 * @param {number} delta
 * @returns {number}
 */
export function applyPoints(score, delta) {
  return Math.max(0, score + delta);
}

/**
 * Whether the segment A→B passes within `r` of the circle center C — the
 * swipe-vs-item chop test (point-to-segment distance).
 * @param {number} ax @param {number} ay segment start
 * @param {number} bx @param {number} by segment end
 * @param {number} cx @param {number} cy circle center
 * @param {number} r circle radius
 * @returns {boolean}
 */
export function segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
  }
  const px = ax + t * dx - cx;
  const py = ay + t * dy - cy;
  return px * px + py * py <= r * r;
}

/**
 * Low-FPS swipe audit: test the stroke against the entire path an item moved
 * over its last render frame, not only its latest center. This prevents a
 * lob from tunneling through a visible swipe when SwiftShader drops frames.
 * @param {number} ax @param {number} ay swipe start
 * @param {number} bx @param {number} by swipe end
 * @param {number} cx0 @param {number} cy0 previous item center
 * @param {number} cx1 @param {number} cy1 current item center
 * @param {number} r hit radius
 * @returns {boolean}
 */
export function segmentHitsMovingCircle(ax, ay, bx, by, cx0, cy0, cx1, cy1, r) {
  if (segmentsIntersect(ax, ay, bx, by, cx0, cy0, cx1, cy1)) return true;
  return segmentHitsCircle(ax, ay, bx, by, cx0, cy0, r)
    || segmentHitsCircle(ax, ay, bx, by, cx1, cy1, r)
    || segmentHitsCircle(cx0, cy0, cx1, cy1, ax, ay, r)
    || segmentHitsCircle(cx0, cy0, cx1, cy1, bx, by, r);
}

/** Segment intersection including collinear/touching cases. */
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const cross = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const abC = cross(ax, ay, bx, by, cx, cy);
  const abD = cross(ax, ay, bx, by, dx, dy);
  const cdA = cross(cx, cy, dx, dy, ax, ay);
  const cdB = cross(cx, cy, dx, dy, bx, by);
  const eps = 1e-9;
  const between = (v, p, q) => v >= Math.min(p, q) - eps && v <= Math.max(p, q) + eps;
  const on = (v, x, y, px, py, qx, qy) =>
    Math.abs(v) <= eps && between(x, px, qx) && between(y, py, qy);
  if (((abC > eps && abD < -eps) || (abC < -eps && abD > eps))
    && ((cdA > eps && cdB < -eps) || (cdA < -eps && cdB > eps))) return true;
  return on(abC, cx, cy, ax, ay, bx, by) || on(abD, dx, dy, ax, ay, bx, by)
    || on(cdA, ax, ay, cx, cy, dx, dy) || on(cdB, bx, by, cx, cy, dx, dy);
}
