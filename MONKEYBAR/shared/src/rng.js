// Seedable RNG + shuffle — PLAN.md §2 (shared/rng.js).

/**
 * mulberry32 — tiny, fast, seedable 32-bit PRNG.
 * Same seed → same sequence, on every platform.
 * @param {number} seed  any 32-bit integer (floats are truncated)
 * @returns {() => number} function returning floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates shuffle. Pure: returns a NEW array, input is untouched.
 * @template T
 * @param {T[]} array
 * @param {() => number} [rng]  a function returning floats in [0,1); defaults to Math.random
 * @returns {T[]}
 */
export function shuffle(array, rng = Math.random) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick a random element (convenience for bots/maps/table-fruit choices).
 * @template T
 * @param {T[]} array
 * @param {() => number} [rng]
 * @returns {T}
 */
export function pick(array, rng = Math.random) {
  return array[Math.floor(rng() * array.length)];
}

/**
 * Random integer in [min, max] inclusive.
 * @param {number} min
 * @param {number} max
 * @param {() => number} [rng]
 * @returns {number}
 */
export function randInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}
