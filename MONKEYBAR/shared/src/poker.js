// Jungle Poker deck + 3-card hand evaluator — RELEASE_PLAN.md §B.4 / PLAN.md §10
// (binding contract). 52 cards = 4 fruit suits × ranks 2–14 (14 = Ace).
// Class order (strongest first): Trio > Straight Flush > Straight > Flush >
// Pair > High Card — trios outrank straight flushes in 3-card jungle rules.

import { FRUITS } from './cards.js';

/** The four fruit suits (golden is a suit here, not a wild). */
export const POKER_SUITS = Object.freeze([
  FRUITS.BANANA,
  FRUITS.COCONUT,
  FRUITS.MANGO,
  FRUITS.GOLDEN,
]);

export const POKER_RANK_MIN = 2;
/** 11 = Jack, 12 = Queen, 13 = King, 14 = Ace. */
export const POKER_RANK_MAX = 14;

/**
 * A Jungle Poker card. Ids are opaque and only ever sent to their owner
 * (plus showdown reveals), like Monkey Lies card ids.
 * @typedef {Object} PokerCard
 * @property {string} id
 * @property {string} suit  one of POKER_SUITS
 * @property {number} rank  2–14 (14 = Ace)
 */

/**
 * Hand classes, higher number = stronger class.
 * @enum {number}
 */
export const HAND_CLASSES = Object.freeze({
  HIGH_CARD: 1,
  PAIR: 2,
  FLUSH: 3,
  STRAIGHT: 4,
  STRAIGHT_FLUSH: 5,
  TRIO: 6,
});

/** Display names, indexed by hand class. */
export const HAND_CLASS_NAMES = Object.freeze({
  [HAND_CLASSES.HIGH_CARD]: 'High Card',
  [HAND_CLASSES.PAIR]: 'Pair',
  [HAND_CLASSES.FLUSH]: 'Flush',
  [HAND_CLASSES.STRAIGHT]: 'Straight',
  [HAND_CLASSES.STRAIGHT_FLUSH]: 'Straight Flush',
  [HAND_CLASSES.TRIO]: 'Trio',
});

/**
 * Build the (unshuffled) 52-card Jungle Poker deck.
 * @returns {PokerCard[]} cards with unique opaque ids
 */
export function buildPokerDeck() {
  /** @type {PokerCard[]} */
  const deck = [];
  let n = 0;
  for (const suit of POKER_SUITS) {
    for (let rank = POKER_RANK_MIN; rank <= POKER_RANK_MAX; rank++) {
      deck.push({ id: `p${n++}`, suit, rank });
    }
  }
  return deck;
}

// Tiebreaks pack up to 3 ranks into one number, base-15 (ranks < 15), so a
// plain numeric comparison matches ordered-rank lexicographic comparison.
const packRanks = (ranks) => ranks.reduce((acc, r) => acc * 15 + r, 0);

/**
 * Evaluated 3-card hand. Compare `rankClass` first, then `tiebreak`
 * (both ascending: bigger = stronger). Equal on both = a genuine tie.
 * @typedef {Object} HandRank
 * @property {number} rankClass  one of HAND_CLASSES
 * @property {number} tiebreak   deterministic within the class
 * @property {string} name       display name, e.g. "Straight Flush"
 */

/**
 * Evaluate exactly 3 cards. Deterministic: card order never matters.
 * Straights: A-2-3 plays ace-low (high card 3); Q-K-A is the top straight.
 * @param {PokerCard[]} cards3
 * @returns {HandRank}
 */
export function evaluateHand(cards3) {
  if (!Array.isArray(cards3) || cards3.length !== 3) {
    throw new RangeError(`evaluateHand: expected exactly 3 cards, got ${cards3?.length}`);
  }
  const ranks = cards3.map((c) => c.rank).sort((a, b) => b - a); // descending
  const [hi, mid, lo] = ranks;
  const flush = cards3.every((c) => c.suit === cards3[0].suit);

  // Straight detection (ranks are distinct when true).
  const runStraight = hi === mid + 1 && mid === lo + 1;
  const aceLowStraight = hi === 14 && mid === 3 && lo === 2; // A-2-3
  const straight = runStraight || aceLowStraight;
  const straightHigh = aceLowStraight ? 3 : hi;

  const make = (rankClass, tiebreak) => ({
    rankClass,
    tiebreak,
    name: HAND_CLASS_NAMES[rankClass],
  });

  if (hi === mid && mid === lo) return make(HAND_CLASSES.TRIO, hi);
  if (straight && flush) return make(HAND_CLASSES.STRAIGHT_FLUSH, straightHigh);
  if (straight) return make(HAND_CLASSES.STRAIGHT, straightHigh);
  if (flush) return make(HAND_CLASSES.FLUSH, packRanks(ranks));
  if (hi === mid || mid === lo) {
    const pairRank = mid; // middle of the sorted trio is always in the pair
    const kicker = hi === mid ? lo : hi;
    return make(HAND_CLASSES.PAIR, packRanks([pairRank, kicker]));
  }
  return make(HAND_CLASSES.HIGH_CARD, packRanks(ranks));
}

/**
 * Total-order comparator over evaluated hands.
 * @param {HandRank} a
 * @param {HandRank} b
 * @returns {number} >0 if a is stronger, <0 if b is stronger, 0 on a tie
 */
export function compareHands(a, b) {
  if (a.rankClass !== b.rankClass) return a.rankClass - b.rankClass;
  return a.tiebreak - b.tiebreak;
}
