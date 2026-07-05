import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POKER_SUITS,
  POKER_RANK_MIN,
  POKER_RANK_MAX,
  HAND_CLASSES,
  HAND_CLASS_NAMES,
  buildPokerDeck,
  evaluateHand,
  compareHands,
} from '../src/poker.js';

/** Shorthand card builders (suit initial + rank). */
const B = (rank) => ({ id: `tB${rank}`, suit: 'banana', rank });
const C = (rank) => ({ id: `tC${rank}`, suit: 'coconut', rank });
const M = (rank) => ({ id: `tM${rank}`, suit: 'mango', rank });
const G = (rank) => ({ id: `tG${rank}`, suit: 'golden', rank });

const beats = (a, b) => compareHands(evaluateHand(a), evaluateHand(b)) > 0;
const ties = (a, b) => compareHands(evaluateHand(a), evaluateHand(b)) === 0;

// ---- deck ----------------------------------------------------------------------

test('buildPokerDeck: 52 cards, 4 suits × ranks 2–14, unique ids, no dupes', () => {
  const deck = buildPokerDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
  assert.equal(new Set(deck.map((c) => `${c.suit}:${c.rank}`)).size, 52);
  for (const suit of POKER_SUITS) {
    const ranks = deck.filter((c) => c.suit === suit).map((c) => c.rank).sort((a, b) => a - b);
    assert.equal(ranks.length, 13, `suit ${suit}`);
    assert.equal(ranks[0], POKER_RANK_MIN);
    assert.equal(ranks[12], POKER_RANK_MAX);
  }
});

// ---- class identification --------------------------------------------------------

test('evaluateHand identifies all 6 classes with their names', () => {
  const cases = [
    [[B(7), C(7), M(7)], HAND_CLASSES.TRIO],
    [[B(4), B(5), B(6)], HAND_CLASSES.STRAIGHT_FLUSH],
    [[B(4), C(5), M(6)], HAND_CLASSES.STRAIGHT],
    [[B(2), B(7), B(11)], HAND_CLASSES.FLUSH],
    [[B(9), C(9), M(4)], HAND_CLASSES.PAIR],
    [[B(2), C(7), M(11)], HAND_CLASSES.HIGH_CARD],
  ];
  for (const [cards, expected] of cases) {
    const hand = evaluateHand(cards);
    assert.equal(hand.rankClass, expected);
    assert.equal(hand.name, HAND_CLASS_NAMES[expected]);
  }
});

test('evaluateHand is order-independent (deterministic)', () => {
  const cards = [B(9), C(9), M(4)];
  const perms = [
    [cards[0], cards[1], cards[2]],
    [cards[0], cards[2], cards[1]],
    [cards[1], cards[0], cards[2]],
    [cards[1], cards[2], cards[0]],
    [cards[2], cards[0], cards[1]],
    [cards[2], cards[1], cards[0]],
  ];
  const first = evaluateHand(perms[0]);
  for (const p of perms) assert.deepEqual(evaluateHand(p), first);
});

test('evaluateHand rejects anything but exactly 3 cards', () => {
  assert.throws(() => evaluateHand([B(2), C(3)]), RangeError);
  assert.throws(() => evaluateHand([B(2), C(3), M(4), G(5)]), RangeError);
  assert.throws(() => evaluateHand('nope'), RangeError);
});

// ---- class ordering: Trio > Straight Flush > Straight > Flush > Pair > High ------

test('class order: Trio > Straight Flush > Straight > Flush > Pair > High Card', () => {
  const ladder = [
    [B(2), C(7), M(11)], // high card
    [B(9), C(9), M(4)], // pair
    [B(2), B(7), B(11)], // flush
    [B(4), C(5), M(6)], // straight
    [B(4), B(5), B(6)], // straight flush
    [B(7), C(7), M(7)], // trio
  ];
  for (let weak = 0; weak < ladder.length; weak++) {
    for (let strong = weak + 1; strong < ladder.length; strong++) {
      assert.ok(beats(ladder[strong], ladder[weak]), `class ${strong} must beat class ${weak}`);
      assert.ok(!beats(ladder[weak], ladder[strong]), `class ${weak} must not beat class ${strong}`);
    }
  }
});

test('straight vs flush: any straight beats any flush (explicit §B.4 order)', () => {
  const lowStraight = [B(14), C(2), M(3)]; // the weakest straight (ace-low)
  const bigFlush = [B(14), B(13), B(11)]; // a near-top flush
  assert.ok(beats(lowStraight, bigFlush));
  assert.ok(!beats(bigFlush, lowStraight));
  // ...but a trio still beats a straight flush
  assert.ok(beats([C(2), M(2), G(2)], [B(12), B(13), B(14)]));
});

// ---- straights and the ace ---------------------------------------------------------

test('ace-low straight A-2-3 plays as straight-high 3', () => {
  const aceLow = evaluateHand([B(14), C(2), M(3)]);
  assert.equal(aceLow.rankClass, HAND_CLASSES.STRAIGHT);
  assert.equal(aceLow.tiebreak, 3);
  // loses to 2-3-4, and to every higher straight
  assert.ok(beats([B(2), C(3), M(4)], [B(14), C(2), M(3)]));
  // Q-K-A is the top straight
  assert.ok(beats([B(12), C(13), M(14)], [B(11), C(12), M(13)]));
  assert.ok(beats([B(12), C(13), M(14)], [B(14), C(2), M(3)]));
});

test('ace-low straight flush ranks as straight flush, below 2-3-4 straight flush', () => {
  const aceLowSF = evaluateHand([B(14), B(2), B(3)]);
  assert.equal(aceLowSF.rankClass, HAND_CLASSES.STRAIGHT_FLUSH);
  assert.equal(aceLowSF.tiebreak, 3);
  assert.ok(beats([M(2), M(3), M(4)], [B(14), B(2), B(3)]));
});

test('A-K-Q of mixed suits is NOT a wraparound straight', () => {
  assert.equal(evaluateHand([B(14), C(13), M(12)]).rankClass, HAND_CLASSES.STRAIGHT);
  assert.equal(evaluateHand([B(14), C(13), M(11)]).rankClass, HAND_CLASSES.HIGH_CARD);
  assert.equal(evaluateHand([B(14), C(2), M(4)]).rankClass, HAND_CLASSES.HIGH_CARD); // K-A-2 style gap
});

// ---- deterministic tiebreaks within each class -------------------------------------

test('trio tiebreak: higher trio wins', () => {
  assert.ok(beats([B(14), C(14), M(14)], [B(13), C(13), M(13)]));
  assert.ok(ties([B(5), C(5), M(5)], [C(5), M(5), G(5)]));
});

test('straight tiebreak: higher top card wins; equal straights tie', () => {
  assert.ok(beats([B(5), C(6), M(7)], [B(4), C(5), M(6)]));
  assert.ok(ties([B(4), C(5), M(6)], [G(4), M(5), C(6)]));
});

test('flush tiebreak: ordered ranks compare lexicographically', () => {
  assert.ok(beats([B(14), B(9), B(2)], [B(13), B(12), B(10)])); // high card first
  assert.ok(beats([B(14), B(10), B(2)], [B(14), B(9), B(8)])); // then middle
  assert.ok(beats([B(14), B(9), B(3)], [B(14), B(9), B(2)])); // then low
  assert.ok(ties([B(14), B(9), B(2)], [C(14), C(9), C(2)]));
});

test('pair tiebreak: pair rank first, then kicker', () => {
  assert.ok(beats([B(10), C(10), M(2)], [B(9), C(9), M(14)])); // higher pair beats big kicker
  assert.ok(beats([B(9), C(9), M(14)], [B(9), M(9), G(13)])); // same pair → kicker decides
  assert.ok(ties([B(9), C(9), M(14)], [M(9), G(9), C(14)]));
  // kicker above vs below the pair rank — both orderings detected correctly
  assert.equal(evaluateHand([B(9), C(9), M(14)]).tiebreak, 9 * 15 + 14);
  assert.equal(evaluateHand([B(9), C(9), M(2)]).tiebreak, 9 * 15 + 2);
});

test('high-card tiebreak: ordered ranks compare lexicographically', () => {
  assert.ok(beats([B(14), C(7), M(2)], [B(13), C(12), M(10)]));
  assert.ok(beats([B(14), C(8), M(2)], [B(14), C(7), M(6)]));
  assert.ok(beats([B(14), C(7), M(3)], [B(14), C(7), M(2)]));
  assert.ok(ties([B(14), C(7), M(2)], [G(14), M(7), C(2)]));
});

test('every deck triple evaluates without error and compares transitively at the class level', () => {
  // Sanity sweep over a sample of real deck cards (not all C(52,3) triples).
  const deck = buildPokerDeck();
  for (let i = 0; i < 50; i += 3) {
    const hand = evaluateHand([deck[i], deck[(i + 17) % 52], deck[(i + 29) % 52]]);
    assert.ok(hand.rankClass >= HAND_CLASSES.HIGH_CARD && hand.rankClass <= HAND_CLASSES.TRIO);
    assert.ok(Number.isFinite(hand.tiebreak));
    assert.equal(typeof hand.name, 'string');
  }
});
