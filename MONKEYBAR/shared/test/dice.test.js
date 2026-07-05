import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DICE_FACES, isFace, rollDice, bidBeats, countMatching } from '../src/dice.js';
import { mulberry32 } from '../src/rng.js';

// ---- rollDice ----------------------------------------------------------------

test('rollDice returns n faces in 1–6', () => {
  const dice = rollDice(100, mulberry32(1));
  assert.equal(dice.length, 100);
  for (const d of dice) {
    assert.ok(Number.isInteger(d) && d >= 1 && d <= DICE_FACES, `bad face ${d}`);
  }
});

test('rollDice is deterministic for the same seed', () => {
  assert.deepEqual(rollDice(20, mulberry32(42)), rollDice(20, mulberry32(42)));
});

test('rollDice covers every face (seeded)', () => {
  const seen = new Set(rollDice(500, mulberry32(7)));
  for (let f = 1; f <= DICE_FACES; f++) assert.ok(seen.has(f), `face ${f} never rolled`);
});

test('rollDice handles 0 and rejects bad n', () => {
  assert.deepEqual(rollDice(0, mulberry32(1)), []);
  assert.throws(() => rollDice(-1), RangeError);
  assert.throws(() => rollDice(2.5), RangeError);
});

test('isFace accepts 1–6 only', () => {
  for (let f = 1; f <= 6; f++) assert.equal(isFace(f), true);
  for (const bad of [0, 7, -1, 1.5, '3', null, undefined, NaN]) {
    assert.equal(isFace(bad), false, `isFace(${bad}) should be false`);
  }
});

// ---- bidBeats: exhaustive total order ------------------------------------------

test('bidBeats is an exhaustive strict total order over (count 1–8) × (face 1–6)', () => {
  /** All bids in a small but complete grid. */
  const bids = [];
  for (let count = 1; count <= 8; count++) {
    for (let face = 1; face <= DICE_FACES; face++) bids.push({ count, face });
  }
  // Rank of a bid in the total order: count first, then face.
  const rank = (b) => b.count * 10 + b.face;

  for (const a of bids) {
    for (const b of bids) {
      const expected = rank(a) > rank(b);
      assert.equal(
        bidBeats(a, b),
        expected,
        `bidBeats(${a.count}×${a.face}, ${b.count}×${b.face}) should be ${expected}`
      );
    }
  }
});

test('bidBeats: irreflexive and antisymmetric', () => {
  for (let count = 1; count <= 8; count++) {
    for (let face = 1; face <= DICE_FACES; face++) {
      const b = { count, face };
      assert.equal(bidBeats(b, { ...b }), false, 'a bid never beats itself');
    }
  }
  const a = { count: 3, face: 4 };
  const b = { count: 3, face: 5 };
  assert.equal(bidBeats(b, a), true);
  assert.equal(bidBeats(a, b), false);
});

test('bidBeats: raising the count beats any face; same count needs a higher face', () => {
  assert.equal(bidBeats({ count: 4, face: 1 }, { count: 3, face: 6 }), true);
  assert.equal(bidBeats({ count: 3, face: 6 }, { count: 4, face: 1 }), false);
  assert.equal(bidBeats({ count: 3, face: 2 }, { count: 3, face: 1 }), true);
  assert.equal(bidBeats({ count: 3, face: 1 }, { count: 3, face: 2 }), false);
});

// ---- countMatching: wild-1 counting, exhaustively over faces --------------------

test('countMatching counts the face plus wild 1s, for every face', () => {
  const dice = [1, 1, 2, 3, 3, 3, 4, 6]; // two wilds
  const plain = { 2: 1, 3: 3, 4: 1, 5: 0, 6: 1 };
  for (let face = 2; face <= DICE_FACES; face++) {
    assert.equal(countMatching(dice, face), plain[face] + 2, `face ${face}`);
  }
});

test('countMatching on face 1 counts only the 1s (no double count)', () => {
  assert.equal(countMatching([1, 1, 2, 3, 4, 5], 1), 2);
  assert.equal(countMatching([2, 3, 4, 5, 6], 1), 0);
});

test('countMatching handles empty and all-wild pools', () => {
  assert.equal(countMatching([], 4), 0);
  assert.equal(countMatching([1, 1, 1], 6), 3);
});

test('countMatching brute-force agrees with definition (seeded exhaustive sweep)', () => {
  const rng = mulberry32(99);
  for (let trial = 0; trial < 50; trial++) {
    const dice = rollDice(10, rng);
    for (let face = 1; face <= DICE_FACES; face++) {
      const expected = dice.filter((d) => d === face || d === 1).length;
      assert.equal(countMatching(dice, face), expected);
    }
  }
});
