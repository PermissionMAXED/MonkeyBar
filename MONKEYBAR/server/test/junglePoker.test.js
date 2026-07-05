// Jungle Poker rules engine — full simulated matches with scripted seat
// policies (headless: no sockets, no real timers; the harness drives
// engine.onTimeout itself), plus the R6 acceptance checks: betting legality
// matrix, uncontested-win privacy, split pots, bust→cannon→refund, snapshot
// privacy, and chip conservation asserted on every hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import { createEngine, splitPot, RAISE_MAX } from '../src/game/modes/junglePoker.js';
import { isModePlayable } from '../src/game/modes/index.js';
import { createGameRoom } from '../src/game/gameRoom.js';
import {
  CHIP_BONUS_CHAMBERS,
  POKER_ANTE,
  POKER_BUST_REFUND,
  POKER_MAX_RAISES,
  POKER_START_STACK,
  START_CHAMBERS,
} from '@monkeybar/shared/constants.js';
import { POKER_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { HAND_CLASS_NAMES } from '@monkeybar/shared/poker.js';
import { ERROR_CODES, MSG } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeGame({ players = 4, seed = 1, cannonRng, startStack } = {}) {
  const table = createTable(
    Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
  );
  const events = [];
  /** @type {Map<number, Object[]>} hole cards per seat, fed ONLY by private YOUR_CARDS */
  const cards = new Map();
  const engine = createEngine({
    table,
    seed,
    cannonRng,
    ...(startStack !== undefined ? { startStack } : {}),
    onEvent: (e) => {
      events.push(e);
      if (e.t === MSG.MODE_EVENT && e.p.kind === POKER_EVENTS.YOUR_CARDS) {
        assert.notEqual(e.seat, undefined, 'YOUR_CARDS must be seat-private');
        cards.set(e.seat, e.p.cards.map((c) => ({ ...c })));
      }
    },
  });
  return { table, engine, events, cards };
}

const byType = (events, t) => events.filter((e) => e.t === t);
const modeEvents = (events, kind) =>
  events.filter((e) => e.t === MSG.MODE_EVENT && e.p.kind === kind);
const lastTurn = (events) => byType(events, MSG.TURN).at(-1)?.p ?? null;

/** sum(stacks) + pot from authoritative engine state. */
function chipTotal(engine) {
  const s = engine.inspect();
  let total = s.pot;
  for (const v of s.stacks.values()) total += v;
  return total;
}

/**
 * Drive a match with a per-seat policy. policy(view) →
 *   {action:'fold'|'call'} | {action:'raise', amount} | {action:'timeout'}
 * view = {seat, actions, toCall, stack, cards, pot}
 * Chip conservation (sum of stacks + pot) is asserted after EVERY step:
 * constant except +POKER_BUST_REFUND per survived bust cannon.
 */
function runMatch(game, policyFor, { maxSteps = 100000, chipPolicy = () => false } = {}) {
  const { engine, table, events, cards } = game;
  if (engine.roundNo === 0) engine.start();
  let expectedTotal = chipTotal(engine); // post-start baseline
  let cannonSeen = 0;

  for (let step = 0; step < maxSteps; step++) {
    // conservation: every survived bust cannon fronts exactly the refund
    const cannons = byType(events, MSG.CANNON);
    while (cannonSeen < cannons.length) {
      const c = cannons[cannonSeen++];
      if (!c.p.hit) expectedTotal += POKER_BUST_REFUND;
    }
    assert.equal(
      chipTotal(engine),
      expectedTotal,
      `chip conservation broken at step ${step} (hand ${engine.roundNo})`
    );
    if (engine.phase === 'matchEnd') break;

    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const s = table.get(seat);
      assert.ok(s.alive, `turn given to dead seat ${seat}`);
      const insp = engine.inspect();
      assert.ok(!insp.folded.has(seat), `turn given to folded seat ${seat}`);
      assert.ok(insp.stacks.get(seat) > 0, `turn given to all-in seat ${seat}`);
      const turn = lastTurn(events);
      assert.equal(turn.seat, seat, 'turn event out of sync with engine.turnSeat');
      const view = {
        seat,
        actions: turn.actions,
        toCall: turn.toCall,
        stack: insp.stacks.get(seat),
        cards: cards.get(seat) ?? [],
        pot: insp.pot,
      };
      const a = policyFor(seat)(view, game);
      if (a.action === 'timeout') {
        assert.ok(engine.onTimeout('turn'));
      } else {
        const res = engine.modeAction(seat, a.action, a.action === 'raise' ? { amount: a.amount } : {});
        assert.ok(res.ok, `${a.action} by seat ${seat} rejected: ${res.code}`);
      }
    } else if (engine.phase === 'penalty') {
      const pen = engine.inspect().penalty;
      if (chipPolicy(pen.seat) && table.get(pen.seat).chips > 0) {
        assert.ok(engine.useChip(pen.seat).ok);
      } else {
        assert.ok(engine.onTimeout('penalty'));
      }
    } else if (engine.phase === 'roundEnd') {
      assert.ok(engine.onTimeout('intermission'));
    } else {
      assert.fail(`harness stuck in phase '${engine.phase}'`);
    }
  }
  assert.equal(engine.phase, 'matchEnd', 'match must reach matchEnd');
  assert.notEqual(engine.winnerSeat, -1);
  return engine.winnerSeat;
}

/** Seeded random-but-legal policy (folds, calls, raises). */
function randomPolicy(rng) {
  return (view) => {
    const r = rng();
    if (view.actions.includes('raise') && r < 0.25) {
      return { action: 'raise', amount: 1 + Math.floor(rng() * RAISE_MAX) };
    }
    if (view.toCall > 0 && r > 0.72) return { action: 'fold' };
    if (r > 0.95) return { action: 'timeout' };
    return { action: 'call' };
  };
}

/** No public event may carry card identities, except a CONTESTED showdown. */
function assertNoLeakedCards(events) {
  for (const e of events) {
    if (e.seat !== undefined) continue; // private: routed to its owner only
    if (e.t === MSG.MODE_EVENT && e.p.kind === POKER_EVENTS.SHOWDOWN && !e.p.uncontested) continue;
    const json = JSON.stringify(e.p);
    assert.ok(
      !json.includes('"suit"') && !json.includes('"rank":'),
      `card identities leaked in public '${e.t}' event: ${json.slice(0, 120)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Registration + hand setup
// ---------------------------------------------------------------------------

test('junglePoker registers as playable and antes/deals a hand on start', () => {
  assert.equal(isModePlayable('junglePoker'), true);

  const game = makeGame({ players: 4, seed: 7 });
  game.engine.start();
  const { engine, events, cards } = game;

  assert.equal(engine.phase, 'playing');
  assert.equal(engine.roundNo, 1);
  assert.equal(engine.lastHolderPending, false);

  // Everyone anted POKER_ANTE into the pot.
  const ante = modeEvents(events, POKER_EVENTS.ANTE)[0];
  assert.ok(ante);
  assert.equal(ante.p.pot, 4 * POKER_ANTE);
  assert.equal(ante.p.antes.length, 4);
  for (const seatView of ante.p.seats) {
    assert.equal(seatView.stack, POKER_START_STACK - POKER_ANTE);
    assert.equal(seatView.bet, 0); // antes are dead money, not bets
    assert.equal(seatView.folded, false);
  }

  // 3 private cards each, delivered seat-private only.
  assert.equal(cards.size, 4);
  for (const [, own] of cards) {
    assert.equal(own.length, 3);
    for (const c of own) assert.ok(c.id && c.suit && c.rank >= 2 && c.rank <= 14);
  }
  // No two seats share a card id.
  const ids = [...cards.values()].flat().map((c) => c.id);
  assert.equal(new Set(ids).size, 12);

  // roundStart follows the deal; the first turn offers all three verbs.
  const rs = byType(events, MSG.ROUND_START)[0];
  assert.ok(rs);
  assert.equal(rs.p.tableFruit, null);
  const turn = lastTurn(events);
  assert.equal(turn.seat, rs.p.firstSeat);
  assert.deepEqual(turn.actions, ['fold', 'call', 'raise']);
  assert.equal(turn.toCall, 0);
  assert.equal(turn.canCall, false);
  assert.equal(turn.lastHolder, false);
  assertNoLeakedCards(events);
});

// ---------------------------------------------------------------------------
// Betting legality matrix
// ---------------------------------------------------------------------------

test('betting legality: turn order, verb/amount validation, raise cap, check vs call', () => {
  const game = makeGame({ players: 4, seed: 11 });
  const { engine, events } = game;
  engine.start();
  const first = engine.turnSeat;
  const seatAfter = (s, n = 1) => (s + n) % 4;

  // Not your turn / unknown verb / bad raise payloads.
  assert.equal(engine.modeAction(seatAfter(first), 'call').code, ERROR_CODES.NOT_YOUR_TURN);
  assert.equal(engine.modeAction(first, 'shake').code, ERROR_CODES.BAD_MSG);
  for (const amount of [0, 4, 1.5, '2', null, undefined]) {
    assert.equal(engine.modeAction(first, 'raise', { amount }).code, ERROR_CODES.BAD_MSG);
  }
  // ML-native verbs are rejected, never crash.
  assert.equal(engine.play(first, ['x']).code, ERROR_CODES.BAD_MSG);
  assert.equal(engine.callLiar(first).code, ERROR_CODES.BAD_MSG);
  assert.equal(engine.fireSelf(first).code, ERROR_CODES.BAD_MSG);

  // Raise 2: stack/pot/currentBet move, next seat owes 2.
  assert.ok(engine.modeAction(first, 'raise', { amount: 2 }).ok);
  let insp = engine.inspect();
  assert.equal(insp.currentBet, 2);
  assert.equal(insp.raisesUsed, 1);
  assert.equal(insp.pot, 4 + 2);
  assert.equal(insp.stacks.get(first), POKER_START_STACK - POKER_ANTE - 2);
  assert.equal(engine.turnSeat, seatAfter(first));
  assert.equal(lastTurn(events).toCall, 2);

  // Second raise hits the POKER_MAX_RAISES cap: the NEXT turn omits 'raise'.
  assert.ok(engine.modeAction(seatAfter(first), 'raise', { amount: 3 }).ok);
  insp = engine.inspect();
  assert.equal(insp.currentBet, 5);
  assert.equal(insp.raisesUsed, POKER_MAX_RAISES);
  const cappedTurn = lastTurn(events);
  assert.equal(cappedTurn.seat, seatAfter(first, 2));
  assert.deepEqual(cappedTurn.actions, ['fold', 'call']);
  assert.equal(engine.modeAction(seatAfter(first, 2), 'raise', { amount: 1 }).code, ERROR_CODES.BAD_STATE);

  // Check-vs-call semantics + fold: 2 calls and a fold end the rotation
  // (the raiser matched everyone by construction).
  assert.ok(engine.modeAction(seatAfter(first, 2), 'call').ok); // pays 5
  assert.ok(engine.modeAction(seatAfter(first, 3), 'fold').ok);
  // Rotation returns to the first raiser who owes 3 more.
  assert.equal(engine.turnSeat, first);
  assert.equal(lastTurn(events).toCall, 3);
  assert.ok(engine.modeAction(first, 'call').ok);

  // Betting complete → contested showdown among the 3 non-folded players.
  const sd = modeEvents(events, POKER_EVENTS.SHOWDOWN).at(-1);
  assert.ok(sd, 'showdown must fire when the rotation completes');
  assert.equal(sd.p.uncontested, false);
  assert.equal(sd.p.hands.length, 3);
  assert.ok(!sd.p.hands.some((h) => h.seat === seatAfter(first, 3)), 'folded hand must stay muck');
  for (const h of sd.p.hands) {
    assert.equal(h.cards.length, 3);
    assert.equal(h.name, HAND_CLASS_NAMES[h.rankClass]);
  }
  assert.equal(sd.p.pot, 4 + 5 * 3);
  assert.equal(engine.phase, 'roundEnd');
  assertNoLeakedCards(events);
});

test('turn timeout: check when free, fold when facing a bet', () => {
  const game = makeGame({ players: 4, seed: 3 });
  const { engine, events } = game;
  engine.start();
  const first = engine.turnSeat;

  // Free look → timeout checks (call 0), never folds.
  assert.ok(engine.onTimeout('turn'));
  let act = modeEvents(events, POKER_EVENTS.ACTION).at(-1);
  assert.equal(act.p.seat, first);
  assert.equal(act.p.action, 'call');
  assert.equal(act.p.amount, 0);
  assert.ok(!engine.inspect().folded.has(first));

  // Facing a bet → timeout folds.
  const raiser = engine.turnSeat;
  assert.ok(engine.modeAction(raiser, 'raise', { amount: 1 }).ok);
  const victim = engine.turnSeat;
  assert.ok(engine.onTimeout('turn'));
  act = modeEvents(events, POKER_EVENTS.ACTION).at(-1);
  assert.equal(act.p.seat, victim);
  assert.equal(act.p.action, 'fold');
  assert.ok(engine.inspect().folded.has(victim));
});

test('all-in: short calls clamp, all-in raises clamp, tapped-out tables stop raising', () => {
  // 2 players, tiny stacks. Hand 1 diverges the stacks (uncontested), hand 2
  // forces a SHORT all-in call with no side pot.
  const game = makeGame({ players: 2, seed: 5, startStack: 3 });
  const { engine, events } = game;
  engine.start();
  const f = engine.turnSeat;
  const g = (f + 1) % 2;

  // Hand 1: F raises 1, G folds → F wins 3 uncontested (stacks 4 / 2).
  assert.ok(engine.modeAction(f, 'raise', { amount: 1 }).ok);
  assert.ok(engine.modeAction(g, 'fold').ok);
  let sd = modeEvents(events, POKER_EVENTS.SHOWDOWN).at(-1);
  assert.equal(sd.p.uncontested, true);
  assert.deepEqual(sd.p.hands, []);
  assert.deepEqual(sd.p.winners, [{ seat: f, amount: 3 }]);
  let insp = engine.inspect();
  assert.equal(insp.stacks.get(f), 4);
  assert.equal(insp.stacks.get(g), 2);
  assert.ok(engine.onTimeout('intermission'));

  // Hand 2 (G acts first): G checks; F raises 3 (has 3 after ante — exactly
  // all-in); G owes 3 but holds only 1 → SHORT all-in call of 1.
  assert.equal(engine.turnSeat, g);
  assert.ok(engine.modeAction(g, 'call').ok); // check
  // F all-in → G cannot raise back (nobody left to pay): actions omit 'raise'.
  assert.ok(engine.modeAction(f, 'raise', { amount: 3 }).ok);
  let turn = lastTurn(events);
  assert.equal(turn.seat, g);
  assert.deepEqual(turn.actions, ['fold', 'call']);
  assert.equal(turn.toCall, 3);
  assert.ok(engine.modeAction(g, 'call').ok);
  const act = modeEvents(events, POKER_EVENTS.ACTION).at(-1);
  assert.equal(act.p.action, 'call');
  assert.equal(act.p.amount, 1, 'short call must clamp to the remaining stack');
  assert.equal(act.p.allIn, true);

  // No side pots: the whole 6-chip pot goes to the showdown winner.
  sd = modeEvents(events, POKER_EVENTS.SHOWDOWN).at(-1);
  assert.equal(sd.p.uncontested, false);
  assert.equal(sd.p.hands.length, 2);
  assert.equal(sd.p.pot, 6);
  insp = engine.inspect();
  assert.equal(insp.stacks.get(sd.p.winnerSeat) + insp.stacks.get((sd.p.winnerSeat + 1) % 2), 6);
  assertNoLeakedCards(events);
});

test('all-in raise clamps to the stack and a raise below the bet is rejected', () => {
  const game = makeGame({ players: 2, seed: 9, startStack: 4 });
  const { engine, events } = game;
  engine.start();
  const f = engine.turnSeat;
  const g = (f + 1) % 2;

  // F raises 3 → all-in for their whole 3-chip stack (after the ante).
  assert.ok(engine.modeAction(f, 'raise', { amount: 3 }).ok);
  const act = modeEvents(events, POKER_EVENTS.ACTION).at(-1);
  assert.equal(act.p.amount, 3);
  assert.equal(act.p.allIn, true);
  assert.equal(engine.inspect().stacks.get(f), 0);
  // G holds exactly 3 = the call amount: raising cannot top the bet → BAD_STATE
  // (and the turn's legal actions already omitted 'raise').
  assert.deepEqual(lastTurn(events).actions, ['fold', 'call']);
  assert.equal(engine.modeAction(g, 'raise', { amount: 1 }).code, ERROR_CODES.BAD_STATE);
  assert.ok(engine.modeAction(g, 'call').ok);
  assert.equal(engine.phase, 'roundEnd');
});

// ---------------------------------------------------------------------------
// Uncontested wins reveal nothing
// ---------------------------------------------------------------------------

test('uncontested win: everyone folds, the pot moves, and NO cards are ever revealed', () => {
  const game = makeGame({ players: 4, seed: 21 });
  const { engine, events } = game;
  engine.start();
  const first = engine.turnSeat;

  for (let i = 0; i < 3; i++) assert.ok(engine.modeAction(engine.turnSeat, 'fold').ok);
  const winner = (first + 3) % 4;

  const sd = modeEvents(events, POKER_EVENTS.SHOWDOWN).at(-1);
  assert.equal(sd.p.uncontested, true);
  assert.deepEqual(sd.p.hands, []);
  assert.equal(sd.p.winnerSeat, winner);
  assert.deepEqual(sd.p.winners, [{ seat: winner, amount: 4 }]);
  assert.equal(engine.inspect().stacks.get(winner), POKER_START_STACK - POKER_ANTE + 4);
  // The winner never had to act — and never shows their cards.
  assertNoLeakedCards(events);
  // Even the winner's own snapshot keeps folded opponents' cards unknowable:
  for (let s = 0; s < 4; s++) {
    const snap = engine.snapshotFor(s);
    if (snap.yourCards) assert.equal(snap.yourSeat, s);
  }
});

// ---------------------------------------------------------------------------
// Split pots
// ---------------------------------------------------------------------------

test('splitPot: equal shares, odd chips to the earliest seats', () => {
  assert.deepEqual(splitPot(8, [2, 5]), [
    { seat: 2, amount: 4 },
    { seat: 5, amount: 4 },
  ]);
  assert.deepEqual(splitPot(9, [5, 2]), [
    { seat: 2, amount: 5 }, // odd chip → earliest seat
    { seat: 5, amount: 4 },
  ]);
  assert.deepEqual(splitPot(11, [7, 0, 3]), [
    { seat: 0, amount: 4 },
    { seat: 3, amount: 4 },
    { seat: 7, amount: 3 },
  ]);
});

test('split pots happen in real matches: shares differ by ≤1, odd chip to the earliest seat', () => {
  // Always-call tables reach showdown every hand — scan seeds until ties show up.
  let found = 0;
  for (let seed = 100; seed < 400 && found < 3; seed++) {
    const game = makeGame({ players: 4, seed, cannonRng: () => 0 });
    runMatch(game, () => () => ({ action: 'call' }), { maxSteps: 20000 });
    for (const sd of modeEvents(game.events, POKER_EVENTS.SHOWDOWN)) {
      const { winners, pot, uncontested } = sd.p;
      assert.equal(
        winners.reduce((a, w) => a + w.amount, 0),
        pot,
        'payouts must sum to the pot'
      );
      if (uncontested || winners.length < 2) continue;
      found++;
      const amounts = winners.map((w) => w.amount);
      assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1, 'split shares differ by ≤ 1');
      const ordered = [...winners].sort((a, b) => a.seat - b.seat);
      for (let i = 1; i < ordered.length; i++) {
        assert.ok(ordered[i - 1].amount >= ordered[i].amount, 'odd chip must go to the earliest seat');
      }
      if (pot % winners.length !== 0) {
        assert.equal(ordered[0].amount, Math.floor(pot / winners.length) + 1);
      }
    }
  }
  assert.ok(found >= 3, `expected ≥3 genuine split pots across the scanned seeds, saw ${found}`);
});

// ---------------------------------------------------------------------------
// Bust → cannon → refund / elimination
// ---------------------------------------------------------------------------

test('bust: cannot ante → BUST + ML-shaped penalty → survive → POKER_BUST_REFUND and play on', () => {
  // startStack 1: hand 1 is an all-in ante showdown; the loser busts on hand 2.
  const game = makeGame({ players: 2, seed: 13, startStack: 1, cannonRng: () => 0.99 });
  const { engine, events } = game;
  engine.start();
  assert.equal(engine.phase, 'roundEnd', 'ante all-ins go straight to showdown');
  const sd = modeEvents(events, POKER_EVENTS.SHOWDOWN)[0];
  assert.equal(sd.p.uncontested, false);
  const loser = (sd.p.winnerSeat + 1) % 2;
  assert.ok(engine.onTimeout('intermission'));

  // Hand 2 opens with the bust ritual for the broke monkey.
  const bust = modeEvents(events, POKER_EVENTS.BUST).at(-1);
  assert.equal(bust.p.seat, loser);
  assert.equal(engine.phase, 'penalty');
  const pen = byType(events, MSG.PENALTY).at(-1);
  assert.deepEqual(
    { seat: pen.p.seat, chambers: pen.p.chambers, coconuts: pen.p.coconuts, chipUsable: pen.p.chipUsable },
    { seat: loser, chambers: START_CHAMBERS, coconuts: 1, chipUsable: true }
  );
  assert.ok(pen.p.deadline > 0);

  // Snapshot during the window exposes the ML penalty shape.
  const snap = engine.snapshotFor(null);
  assert.equal(snap.phase, 'penalty');
  assert.equal(snap.penalty.seat, loser);
  assert.equal(snap.penalty.chambers, START_CHAMBERS);

  // Window expires → cannon MISSES → refund + one chamber gone, hand deals on.
  assert.ok(engine.onTimeout('penalty'));
  const cannon = byType(events, MSG.CANNON).at(-1);
  assert.deepEqual(cannon.p, { seat: loser, hit: false });
  assert.equal(engine.phase, 'playing', 'the hand must deal on after a survived bust');
  const ante = modeEvents(events, POKER_EVENTS.ANTE).at(-1);
  const seatView = ante.p.seats.find((s) => s.seat === loser);
  assert.equal(seatView.stack, POKER_BUST_REFUND - POKER_ANTE, 'refund → 3 chips, minus the new ante');
  assert.equal(seatView.chambersLeft, START_CHAMBERS - 1);
  assertNoLeakedCards(events);
});

test('bust: chip spends → +2 temporary chambers; cannon HIT eliminates and ends a 2p match', () => {
  // cannonRng 0.4: with the chip 1/(1+2)=0.33 < 0.4 → survive; without 1/1..4.
  const survive = makeGame({ players: 2, seed: 13, startStack: 1, cannonRng: () => 0.4 });
  survive.engine.start();
  assert.ok(survive.engine.onTimeout('intermission'));
  const seat = modeEvents(survive.events, POKER_EVENTS.BUST).at(-1).p.seat;
  assert.equal(survive.engine.useChip((seat + 1) % 2).code, ERROR_CODES.BAD_STATE); // not your window
  assert.ok(survive.engine.useChip(seat).ok);
  const chip = byType(survive.events, MSG.CHIP_USED).at(-1);
  assert.deepEqual(chip.p, { seat, chambersNow: START_CHAMBERS + CHIP_BONUS_CHAMBERS });
  assert.deepEqual(byType(survive.events, MSG.CANNON).at(-1).p, { seat, hit: false });
  assert.equal(survive.table.get(seat).chips, 0);

  // Guaranteed hit → eliminated → last monkey standing wins immediately.
  const doom = makeGame({ players: 2, seed: 13, startStack: 1, cannonRng: () => 0 });
  doom.engine.start();
  assert.ok(doom.engine.onTimeout('intermission'));
  const victim = modeEvents(doom.events, POKER_EVENTS.BUST).at(-1).p.seat;
  assert.ok(doom.engine.onTimeout('penalty'));
  assert.deepEqual(byType(doom.events, MSG.CANNON).at(-1).p, { seat: victim, hit: true });
  assert.deepEqual(byType(doom.events, MSG.ELIMINATED).at(-1).p, { seat: victim });
  assert.equal(doom.engine.phase, 'matchEnd');
  const end = byType(doom.events, MSG.MATCH_END)[0];
  assert.equal(end.p.winnerSeat, (victim + 1) % 2);
  assert.equal(end.p.standings.length, 2);
  assert.equal(end.p.standings[0].place, 1);
});

test('multiple busts in one hand-start are cannon-ed one at a time', () => {
  // 3 players, stack 1: the two ante-showdown losers both bust on hand 2.
  for (let seed = 30; seed < 60; seed++) {
    const game = makeGame({ players: 3, seed, startStack: 1, cannonRng: () => 0 });
    game.engine.start();
    const sd = modeEvents(game.events, POKER_EVENTS.SHOWDOWN)[0];
    if (sd.p.winners.length !== 1) continue; // want exactly two busted losers
    assert.ok(game.engine.onTimeout('intermission'));
    assert.equal(modeEvents(game.events, POKER_EVENTS.BUST).length, 1, 'busts fire serially');
    assert.ok(game.engine.onTimeout('penalty')); // first loser eliminated (2 alive)
    assert.equal(game.engine.phase, 'penalty', 'second bust follows the first');
    assert.equal(modeEvents(game.events, POKER_EVENTS.BUST).length, 2);
    assert.ok(game.engine.onTimeout('penalty')); // second eliminated → match over
    assert.equal(game.engine.phase, 'matchEnd');
    assert.equal(byType(game.events, MSG.ELIMINATED).length, 2);
    assert.equal(byType(game.events, MSG.MATCH_END)[0].p.standings.length, 3);
    return;
  }
  assert.fail('no scanned seed produced a single-winner ante showdown');
});

// ---------------------------------------------------------------------------
// Snapshots: privacy + per-seat extension
// ---------------------------------------------------------------------------

test('snapshotFor: yourCards owner-only, per-seat stack/bet/folded, viewer-relative toCall', () => {
  const game = makeGame({ players: 4, seed: 17 });
  const { engine, cards } = game;
  engine.start();
  const first = engine.turnSeat;
  assert.ok(engine.modeAction(first, 'raise', { amount: 2 }).ok);
  const folder = engine.turnSeat;
  assert.ok(engine.modeAction(folder, 'fold').ok);

  for (let s = 0; s < 4; s++) {
    const snap = engine.snapshotFor(s);
    assert.equal(snap.mode, 'junglePoker');
    assert.equal(snap.yourSeat, s);
    assert.equal(snap.pot, 4 + 2);
    if (s === folder) {
      assert.equal(snap.yourCards, null, 'a folded hand is muck — even to its owner');
    } else {
      assert.deepEqual(snap.yourCards, cards.get(s), 'yourCards must be the owner’s own deal');
    }
    assert.equal(snap.toCall, s === first || s === folder ? 0 : 2);
    for (const seatView of snap.seats) {
      assert.equal(typeof seatView.stack, 'number');
      assert.equal(typeof seatView.bet, 'number');
      assert.equal(typeof seatView.folded, 'boolean');
    }
    assert.equal(snap.seats.find((x) => x.seat === first).bet, 2);
    assert.equal(snap.seats.find((x) => x.seat === folder).folded, true);
    // No OTHER seat's cards anywhere in the snapshot.
    const clone = { ...snap, yourCards: null };
    assert.ok(!JSON.stringify(clone).includes('"suit"'), 'snapshot leaked hole cards');
  }

  // Spectator view: no seat, no cards, toCall of the seat to act.
  const spec = engine.snapshotFor(null);
  assert.equal(spec.yourSeat, null);
  assert.equal(spec.yourCards, null);
  assert.equal(spec.turnSeat, engine.turnSeat);
  assert.equal(spec.toCall, 2);
});

test('gameRoom integration: modeAction routes, acks, and private filtering per seat', () => {
  const sent = [];
  const room = createGameRoom({
    roomId: 'poker-room',
    modeId: 'junglePoker',
    mapId: 'peeling_parrot',
    turnSeconds: 15,
    seatMetas: Array.from({ length: 4 }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` })),
    send: (playerId, envelope) => sent.push({ playerId, envelope }),
    seed: 23,
    autoDelayMs: 60000, // keep the fallback out of this synchronous test
  });
  room.start();

  // YOUR_CARDS went only to its owner (gameRoom private filtering by evt.seat).
  const yourCardFrames = sent.filter(
    (m) => m.envelope.t === MSG.MODE_EVENT && m.envelope.p.kind === POKER_EVENTS.YOUR_CARDS
  );
  assert.equal(yourCardFrames.length, 4);
  const owners = new Set(yourCardFrames.map((m) => m.playerId));
  assert.equal(owners.size, 4);

  // modeAction routes through gameRoom.act like play (wrong turn → error code).
  const turnSeat = room.engine.turnSeat;
  const wrongPlayer = `p${(turnSeat + 1) % 4}`;
  assert.equal(room.act(wrongPlayer, MSG.MODE_ACTION, { action: 'call' }).code, ERROR_CODES.NOT_YOUR_TURN);
  assert.ok(room.act(`p${turnSeat}`, MSG.MODE_ACTION, { action: 'raise', data: { amount: 1 } }).ok);
  assert.equal(room.engine.inspect().currentBet, 1);

  // Spectator snapshot from the room: no hole cards.
  const snap = room.snapshotFor(null);
  assert.equal(snap.yourCards, null);
  room.destroy();
});

// ---------------------------------------------------------------------------
// Seeded full-match simulations (4 + 8 players) with chip conservation
// ---------------------------------------------------------------------------

test('seeded 4-player matches run to matchEnd with chips conserved every hand', () => {
  for (const seed of [101, 202, 303]) {
    const game = makeGame({ players: 4, seed });
    const rng = mulberry32(seed * 31);
    const winner = runMatch(game, () => randomPolicy(rng), {
      chipPolicy: () => rng() < 0.5,
    });
    assert.ok(winner >= 0 && winner < 4);
    const end = byType(game.events, MSG.MATCH_END)[0];
    const places = end.p.standings.map((s) => s.place);
    assert.deepEqual(places, Array.from({ length: places.length }, (_, i) => i + 1));
    assertNoLeakedCards(game.events);
  }
});

test('seeded 8-player match runs to matchEnd with chips conserved every hand', () => {
  const game = makeGame({ players: 8, seed: 88 });
  const rng = mulberry32(4242);
  const winner = runMatch(game, () => randomPolicy(rng), { chipPolicy: () => true });
  assert.ok(winner >= 0 && winner < 8);
  // Every hand dealt exactly 3 cards to every live anted seat.
  for (const e of modeEvents(game.events, POKER_EVENTS.YOUR_CARDS)) {
    assert.equal(e.p.cards.length, 3);
  }
  assertNoLeakedCards(game.events);
});
