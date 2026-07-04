import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDeck, FRUITS, BASIC_FRUITS, cardMatchesTableFruit } from '../src/cards.js';
import { HAND_SIZE, DECK_FRUIT_RATIO } from '../src/constants.js';

function countByFruit(deck) {
  const counts = { banana: 0, coconut: 0, mango: 0, golden: 0 };
  for (const card of deck) counts[card.fruit]++;
  return counts;
}

test('buildDeck P=4 → 20 cards: 6 banana / 6 coconut / 6 mango / 2 golden', () => {
  const deck = buildDeck(4);
  assert.equal(deck.length, 20);
  const counts = countByFruit(deck);
  assert.equal(counts.banana, 6);
  assert.equal(counts.coconut, 6);
  assert.equal(counts.mango, 6);
  assert.equal(counts.golden, 2);
});

test('buildDeck P=8 → 40 cards: 12 banana / 12 coconut / 12 mango / 4 golden', () => {
  const deck = buildDeck(8);
  assert.equal(deck.length, 40);
  const counts = countByFruit(deck);
  assert.equal(counts.banana, 12);
  assert.equal(counts.coconut, 12);
  assert.equal(counts.mango, 12);
  assert.equal(counts.golden, 4);
});

test('buildDeck follows the §4.1 formula for every table size 4–8', () => {
  for (let p = 4; p <= 8; p++) {
    const deck = buildDeck(p);
    const total = p * HAND_SIZE;
    const perFruit = Math.floor(total * DECK_FRUIT_RATIO);
    assert.equal(deck.length, total, `P=${p} total`);
    const counts = countByFruit(deck);
    for (const fruit of BASIC_FRUITS) {
      assert.equal(counts[fruit], perFruit, `P=${p} ${fruit}`);
    }
    assert.equal(counts.golden, total - perFruit * 3, `P=${p} golden`);
  }
});

test('buildDeck card ids are unique and every card has a valid fruit', () => {
  const deck = buildDeck(8);
  const ids = new Set(deck.map((c) => c.id));
  assert.equal(ids.size, deck.length);
  const valid = new Set(Object.values(FRUITS));
  for (const card of deck) {
    assert.ok(typeof card.id === 'string' && card.id.length > 0);
    assert.ok(valid.has(card.fruit), `invalid fruit ${card.fruit}`);
  }
});

test('buildDeck rejects invalid player counts', () => {
  assert.throws(() => buildDeck(0), RangeError);
  assert.throws(() => buildDeck(2.5), RangeError);
  assert.throws(() => buildDeck(-1), RangeError);
});

test('cardMatchesTableFruit: exact match and golden wild both count', () => {
  assert.ok(cardMatchesTableFruit({ id: 'x', fruit: 'banana' }, 'banana'));
  assert.ok(cardMatchesTableFruit({ id: 'x', fruit: 'golden' }, 'banana'));
  assert.ok(!cardMatchesTableFruit({ id: 'x', fruit: 'mango' }, 'banana'));
});
