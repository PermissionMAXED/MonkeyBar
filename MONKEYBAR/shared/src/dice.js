// Banana Dice math — RELEASE_PLAN.md §B.4 / PLAN.md §10 (binding contract).
// Liar's-dice under coconut shells: escalating bids on how many dice across the
// whole table show a face; 1s are wild and count toward every face.

/** Jungle dice are standard d6: faces 1–6. */
export const DICE_FACES = 6;

/** A face value is an integer 1–DICE_FACES. */
export function isFace(face) {
  return Number.isInteger(face) && face >= 1 && face <= DICE_FACES;
}

/**
 * Roll `n` dice.
 * @param {number} n  how many dice (0 allowed — returns [])
 * @param {() => number} [rng]  floats in [0,1); defaults to Math.random
 * @returns {number[]} n face values in 1–6
 */
export function rollDice(n, rng = Math.random) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`rollDice: invalid n ${n}`);
  }
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = 1 + Math.floor(rng() * DICE_FACES);
  return out;
}

/**
 * A bid: "at least `count` dice on the table show `face`".
 * @typedef {Object} DiceBid
 * @property {number} count  ≥1
 * @property {number} face   1–6
 */

/**
 * Does bid `a` legally raise (beat) bid `b`?
 * Strict total order: raise the count, or keep the count and raise the face.
 * Equal bids do NOT beat each other. (Wildness of 1s affects resolution via
 * {@link countMatching}, not the bid order — face 1 orders below face 2.)
 * @param {DiceBid} a  the new bid
 * @param {DiceBid} b  the bid to beat
 * @returns {boolean}
 */
export function bidBeats(a, b) {
  if (a.count !== b.count) return a.count > b.count;
  return a.face > b.face;
}

/**
 * How many dice match `face`? 1s are wild: they count toward every face
 * (bidding on face 1 itself counts only the 1s).
 * @param {number[]} allDice  every die on the table (flat)
 * @param {number} face  1–6
 * @returns {number}
 */
export function countMatching(allDice, face) {
  let n = 0;
  for (const d of allDice) {
    if (d === face || d === 1) n++;
  }
  return n;
}
