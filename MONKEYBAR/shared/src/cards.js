// Deck construction — PLAN.md §4.1 (binding contract).

import { DECK_FRUIT_RATIO, HAND_SIZE } from './constants.js';

/**
 * Fruit enum. `golden` (Golden Banana) is wild — it always counts as Table Fruit.
 * @enum {string}
 */
export const FRUITS = Object.freeze({
  BANANA: 'banana',
  COCONUT: 'coconut',
  MANGO: 'mango',
  GOLDEN: 'golden',
});

/** The three non-wild fruits a Table Fruit can be. */
export const BASIC_FRUITS = Object.freeze([FRUITS.BANANA, FRUITS.COCONUT, FRUITS.MANGO]);

/**
 * Build the (unshuffled) deck for a match — §4.1 math:
 * total = P × 5 cards; each of banana/coconut/mango appears floor(P×5×0.3)
 * times; the remainder are Golden Bananas (wild).
 * (P=4 → 6/6/6 + 2 golden = 20 cards; P=8 → 12/12/12 + 4 golden = 40.)
 *
 * @param {number} playerCount
 * @returns {import('./protocol.js').Card[]} cards with unique opaque ids
 */
export function buildDeck(playerCount) {
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new RangeError(`buildDeck: invalid playerCount ${playerCount}`);
  }
  const total = playerCount * HAND_SIZE;
  const perFruit = Math.floor(total * DECK_FRUIT_RATIO);
  const goldenCount = total - perFruit * BASIC_FRUITS.length;

  /** @type {import('./protocol.js').Card[]} */
  const deck = [];
  let n = 0;
  const push = (fruit) => deck.push({ id: `c${n++}`, fruit });

  for (const fruit of BASIC_FRUITS) {
    for (let i = 0; i < perFruit; i++) push(fruit);
  }
  for (let i = 0; i < goldenCount; i++) push(FRUITS.GOLDEN);

  return deck;
}

/**
 * Does this card satisfy the implicit claim "this is Table Fruit"?
 * Golden Bananas are wild and always count.
 * @param {import('./protocol.js').Card} card
 * @param {string} tableFruit  one of BASIC_FRUITS
 * @returns {boolean}
 */
export function cardMatchesTableFruit(card, tableFruit) {
  return card.fruit === tableFruit || card.fruit === FRUITS.GOLDEN;
}
