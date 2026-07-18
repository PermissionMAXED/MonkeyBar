// Bubble Pop — pure target/match/ramp logic (§C6.1 #11, agent G10). No
// three.js/DOM imports so `node --test` runs this headlessly (§B rule); the
// game module (bubblePop.js) imports from here. Binding §C6.1 numbers: 60 s
// round, target banner "Pop: <food>" rotates every 12 s, matching pop +2,
// wrong pop −2 + 0.5 s stun, spiky bubbles never poppable (tapping −1),
// bubble speed & density ramp. Coin row (§C6): divisor 4, min 4, max 24,
// typical raw ≈ 52 → ~13c.

/** Binding §C6.1 #11 numbers + G10 tuning (composition/ramp knobs). */
export const BUBBLE = Object.freeze({
  /** Round length (§C6.1: 60 s). */
  DURATION_SEC: 60,
  /** Target food rotates every 12 s (§C6.1). */
  TARGET_ROTATE_SEC: 12,
  /** Pop scoring (§C6.1): match +2, wrong −2 + 0.5 s stun, spiky tap −1. */
  MATCH_PTS: 2,
  WRONG_PTS: -2,
  STUN_SEC: 0.5,
  SPIKY_PTS: -1,
  // --- G10 tuning ---
  /** Rise speed ramp (wu/s), linear across the round (§C6.1: speed ramps). */
  RISE_START: 0.62,
  RISE_END: 1.1,
  /** Spawn interval ramp (s), linear (§C6.1: density ramps). */
  SPAWN_SEC_START: 0.9,
  SPAWN_SEC_END: 0.5,
  /** Composition: chance a food bubble carries the CURRENT target food. */
  TARGET_CHANCE: 0.52,
  /** Chance a spawn is a spiky bubble (never poppable). */
  SPIKY_CHANCE: 0.15,
  /** V3/G44 (§C10.2): three same-style matches inside this window chain. */
  CHAIN_WINDOW_SEC: 2,
  CHAIN_COUNT: 3,
  CHAIN_RADIUS: 1.25,
  /** Audit: spikes extend beyond the old 0.42 body raycast sphere. */
  FOOD_TOUCH_RADIUS: 0.42,
  SPIKY_TOUCH_RADIUS: 0.6,
  /** Mini foods that ride in bubbles (Kenney food-kit keys). */
  FOODS: Object.freeze(['carrot', 'apple', 'banana', 'cheese', 'donut-sprinkles', 'cupcake']),
});

/**
 * Color-blind-safe identity: color is redundant with a high-contrast symbol.
 * A style maps one-to-one to food, so a same-color chain always pops the
 * current target food rather than silently sweeping wrong-food bubbles.
 */
export const BUBBLE_STYLES = Object.freeze({
  carrot: Object.freeze({ color: '#E76F51', symbol: '▲' }),
  apple: Object.freeze({ color: '#2A9D8F', symbol: '●' }),
  banana: Object.freeze({ color: '#E9C46A', symbol: '◆' }),
  cheese: Object.freeze({ color: '#3A86FF', symbol: '+' }),
  'donut-sprinkles': Object.freeze({ color: '#8338EC', symbol: '★' }),
  cupcake: Object.freeze({ color: '#FF70A6', symbol: '≈' }),
});

/**
 * Bubble rise speed at a moment of the round (linear ramp, clamped).
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number} wu/s
 */
export function riseSpeedAt(elapsed, duration = BUBBLE.DURATION_SEC) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return BUBBLE.RISE_START + (BUBBLE.RISE_END - BUBBLE.RISE_START) * t;
}

/**
 * Seconds until the next bubble spawn (density ramp, clamped).
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number}
 */
export function spawnIntervalAt(elapsed, duration = BUBBLE.DURATION_SEC) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return BUBBLE.SPAWN_SEC_START + (BUBBLE.SPAWN_SEC_END - BUBBLE.SPAWN_SEC_START) * t;
}

/**
 * Which target slot is active at a moment (§C6.1: rotates every 12 s).
 * @param {number} elapsed seconds
 * @returns {number} 0-based slot index
 */
export function targetIndexAt(elapsed) {
  return Math.max(0, Math.floor(elapsed / BUBBLE.TARGET_ROTATE_SEC));
}

/**
 * Seeded target rotation order: every food appears before any repeats, and
 * consecutive targets always differ (deterministic given the rng).
 * @param {() => number} rng
 * @param {number} count how many target slots the round needs
 * @returns {string[]} food ids, length `count`
 */
export function targetOrder(rng, count) {
  /** @type {string[]} */
  const order = [];
  while (order.length < count) {
    const shuffled = [...BUBBLE.FOODS];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (order.length > 0 && shuffled[0] === order[order.length - 1]) {
      shuffled.push(shuffled.shift());
    }
    order.push(...shuffled);
  }
  return order.slice(0, count);
}

/**
 * Roll the next bubble: spiky with SPIKY_CHANCE, else a food bubble that
 * carries the current target with TARGET_CHANCE (else a random other food).
 * @param {() => number} rng
 * @param {string} targetFood current target food id
 * @returns {{kind: 'spiky'}|{kind: 'food', food: string}}
 */
export function rollBubble(rng, targetFood) {
  if (rng() < BUBBLE.SPIKY_CHANCE) return { kind: 'spiky' };
  if (rng() < BUBBLE.TARGET_CHANCE) return { kind: 'food', food: targetFood };
  const others = BUBBLE.FOODS.filter((f) => f !== targetFood);
  return { kind: 'food', food: others[Math.min(others.length - 1, Math.floor(rng() * others.length))] };
}

/**
 * Tap rule (§C6.1 #11): match +2 · wrong food −2 and 0.5 s stun · spiky −1
 * and the bubble does NOT pop.
 * @param {{kind: 'spiky'}|{kind: 'food', food: string}} bubble
 * @param {string} targetFood target at the moment of the tap
 * @returns {{result: 'match'|'wrong'|'spiky', delta: number, stunSec: number, pops: boolean}}
 */
export function popResult(bubble, targetFood) {
  if (bubble.kind === 'spiky') {
    return { result: 'spiky', delta: BUBBLE.SPIKY_PTS, stunSec: 0, pops: false };
  }
  if (bubble.food === targetFood) {
    return { result: 'match', delta: BUBBLE.MATCH_PTS, stunSec: 0, pops: true };
  }
  return { result: 'wrong', delta: BUBBLE.WRONG_PTS, stunSec: BUBBLE.STUN_SEC, pops: true };
}

/**
 * Apply a pop delta to the score, floored at 0.
 * @param {number} score
 * @param {number} delta
 * @returns {number}
 */
export function applyScore(score, delta) {
  return Math.max(0, score + delta);
}

/** Fresh V3 chain tracker. */
export function createPopChain() {
  return { style: null, count: 0, lastAt: -Infinity, chains: 0 };
}

/**
 * Record a successful target pop. Three same-style pops within two seconds
 * trigger once and begin a fresh chain.
 * @returns {{triggered:boolean, count:number}}
 */
export function recordPopChain(chain, style, atSec) {
  const continues = chain.style === style && atSec - chain.lastAt <= BUBBLE.CHAIN_WINDOW_SEC;
  chain.style = style;
  chain.count = continues ? chain.count + 1 : 1;
  chain.lastAt = atSec;
  if (chain.count < BUBBLE.CHAIN_COUNT) return { triggered: false, count: chain.count };
  chain.count = 0;
  chain.chains += 1;
  return { triggered: true, count: 0 };
}

/**
 * Active same-style neighbors in the chain radius.
 * @param {Array<{active:boolean, food:string, x:number, y:number}>} bubbles
 */
export function chainNeighborIndices(bubbles, style, x, y, radius = BUBBLE.CHAIN_RADIUS) {
  const out = [];
  for (let i = 0; i < bubbles.length; i += 1) {
    const b = bubbles[i];
    if (!b.active || b.food !== style) continue;
    if (Math.hypot(b.x - x, b.y - y) <= radius) out.push(i);
  }
  return out;
}

/** Raycast radius audit helper (spikes must be as tappable as they look). */
export function touchRadiusFor(kind) {
  return kind === 'spiky' ? BUBBLE.SPIKY_TOUCH_RADIUS : BUBBLE.FOOD_TOUCH_RADIUS;
}
