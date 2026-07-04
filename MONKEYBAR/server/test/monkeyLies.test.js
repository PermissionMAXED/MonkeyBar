// Monkey Lies rules engine — full simulated matches with scripted seat
// policies, plus gameRoom private-filtering checks. Headless: no sockets,
// no real timers (the harness drives engine.onTimeout itself).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import {
  chooseAutoPlayCards,
  createMonkeyLiesEngine,
  isTruthfulPlay,
} from '../src/game/modes/monkeyLies.js';
import { createGameRoom } from '../src/game/gameRoom.js';
import { FRUITS, cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import {
  CHIP_BONUS_CHAMBERS,
  HAND_SIZE,
  START_CHAMBERS,
} from '@monkeybar/shared/constants.js';
import { ERROR_CODES, MSG } from '@monkeybar/shared/protocol.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeGame({ players = 4, seed = 1, cannonRng } = {}) {
  const table = createTable(
    Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
  );
  const events = [];
  /** @type {Map<number, Object[]>} tracked hands, fed ONLY by private `hand` events */
  const hands = new Map();
  let tableFruit = null;
  const engine = createMonkeyLiesEngine({
    table,
    seed,
    cannonRng,
    onEvent: (e) => {
      events.push(e);
      if (e.t === MSG.HAND) hands.set(e.seat, e.p.cards.map((c) => ({ ...c })));
      if (e.t === MSG.ROUND_START) tableFruit = e.p.tableFruit;
    },
  });
  return { table, engine, events, hands, getTableFruit: () => tableFruit };
}

const byType = (events, t) => events.filter((e) => e.t === t);

/**
 * Drive a match with scripted per-seat policies.
 * policy(view) -> {type:'play', cardIds} | {type:'call'} | {type:'timeout'}
 * view = { seat, hand, tableFruit, canCall, lastHolderPending, lastPlay }
 *
 * Returns playRecords: what the harness KNOWS each seat played (captured from
 * its own tracked hand), used to cross-check `reveal` events independently.
 */
function runMatch(game, policies, { maxSteps = 20000, maxRounds = Infinity, chipPolicies = {} } = {}) {
  const { engine, table, events, hands, getTableFruit } = game;
  const playRecords = [];
  const turnSeenAt = events.length;

  if (engine.roundNo === 0) engine.start();

  for (let step = 0; step < maxSteps; step++) {
    if (engine.phase === 'matchEnd') break;
    if (byType(events, MSG.ROUND_START).length > maxRounds) break;

    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      // Invariant: turns only go to living seats that still hold cards.
      assert.ok(table.get(seat).alive, `turn given to dead seat ${seat}`);
      assert.ok(table.get(seat).hand.length > 0, `turn given to empty-handed seat ${seat}`);
      // Invariant: our event-tracked hand matches the authoritative one.
      assert.deepEqual(
        hands.get(seat).map((c) => c.id).sort(),
        table.get(seat).hand.map((c) => c.id).sort(),
        `tracked hand for seat ${seat} diverged`
      );
      const view = {
        seat,
        hand: hands.get(seat).map((c) => ({ ...c })),
        tableFruit: getTableFruit(),
        canCall: engine.lastPlay !== null && engine.lastPlay.seat !== seat,
        lastHolderPending: engine.lastHolderPending,
        lastPlay: engine.lastPlay,
      };
      const action = policies[seat](view);
      if (action.type === 'play') {
        const cards = action.cardIds.map((id) => view.hand.find((c) => c.id === id));
        const res = engine.play(seat, action.cardIds);
        assert.ok(res.ok, `play by seat ${seat} rejected: ${res.code}`);
        playRecords.push({ seat, cards });
        hands.set(seat, hands.get(seat).filter((c) => !action.cardIds.includes(c.id)));
      } else if (action.type === 'call') {
        const res = engine.callLiar(seat);
        assert.ok(res.ok, `call by seat ${seat} rejected: ${res.code}`);
      } else {
        // timeout: server auto-play (or Last-Monkey-Holding self shot)
        const before = table.get(seat).hand.map((c) => ({ ...c }));
        engine.onTimeout('turn');
        const after = new Set(table.get(seat).hand.map((c) => c.id));
        const played = before.filter((c) => !after.has(c.id));
        if (played.length > 0) {
          playRecords.push({ seat, cards: played });
          hands.set(seat, hands.get(seat).filter((c) => after.has(c.id)));
        }
      }
    } else if (engine.phase === 'penalty') {
      const pen = engine.inspect().penalty;
      const useChip = !!chipPolicies[pen.seat] && table.get(pen.seat).chips > 0;
      if (useChip) {
        const res = engine.useChip(pen.seat);
        assert.ok(res.ok, `useChip rejected: ${res.code}`);
      } else {
        engine.onTimeout('penalty');
      }
    } else if (engine.phase === 'roundEnd') {
      engine.onTimeout('intermission');
    } else {
      assert.fail(`harness stuck in phase ${engine.phase}`);
    }
  }
  assert.equal(events.length > turnSeenAt, true, 'match produced no events');
  return playRecords;
}

// -- scripted seat policies ---------------------------------------------------

/** Plays truthful cards when possible (up to 3); never calls. */
const honest = (view) => {
  if (view.lastHolderPending) return { type: 'timeout' };
  const truthful = view.hand.filter((c) => cardMatchesTableFruit(c, view.tableFruit));
  if (truthful.length) return { type: 'play', cardIds: truthful.slice(0, 3).map((c) => c.id) };
  return { type: 'play', cardIds: [view.hand[0].id] }; // forced to lie
};

/** Lies whenever possible; prefers goldens when forced to tell the truth. */
const liar = (view) => {
  if (view.lastHolderPending) return { type: 'timeout' };
  const lies = view.hand.filter((c) => !cardMatchesTableFruit(c, view.tableFruit));
  if (lies.length) return { type: 'play', cardIds: lies.slice(0, 3).map((c) => c.id) };
  const golden = view.hand.find((c) => c.fruit === FRUITS.GOLDEN);
  return { type: 'play', cardIds: [(golden ?? view.hand[0]).id] };
};

/** Calls every play it is allowed to; otherwise plays honestly. */
const sheriff = (view) => (view.canCall ? { type: 'call' } : honest(view));

/** Dumps 3 cards a turn, never calls — races toward Last Monkey Holding. */
const dumper = (view) => {
  if (view.lastHolderPending) return { type: 'timeout' };
  return { type: 'play', cardIds: view.hand.slice(0, 3).map((c) => c.id) };
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('isTruthfulPlay: goldens are wild', () => {
  const b = (id, fruit) => ({ id, fruit });
  assert.equal(isTruthfulPlay([b('a', 'banana'), b('b', 'golden')], 'banana'), true);
  assert.equal(isTruthfulPlay([b('a', 'golden'), b('b', 'golden')], 'mango'), true);
  assert.equal(isTruthfulPlay([b('a', 'coconut')], 'banana'), false);
  assert.equal(isTruthfulPlay([b('a', 'banana'), b('b', 'coconut')], 'banana'), false);
});

test('chooseAutoPlayCards prefers exact table fruit, then golden, else 1 random', () => {
  const hand = [
    { id: 'x1', fruit: 'coconut' },
    { id: 'x2', fruit: 'golden' },
    { id: 'x3', fruit: 'banana' },
  ];
  assert.deepEqual(chooseAutoPlayCards(hand, 'banana'), ['x3']);
  assert.deepEqual(chooseAutoPlayCards(hand, 'mango'), ['x2']); // no exact → golden
  const noMatch = [
    { id: 'y1', fruit: 'coconut' },
    { id: 'y2', fruit: 'banana' },
  ];
  const picked = chooseAutoPlayCards(noMatch, 'mango', () => 0.99);
  assert.equal(picked.length, 1);
  assert.ok(noMatch.some((c) => c.id === picked[0]));
});

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

test('only legal actions are accepted', () => {
  const { engine, table, events } = makeGame({ seed: 7 });
  engine.start();

  // Deal: every seat got exactly 5 cards, privately.
  const handEvents = byType(events, MSG.HAND);
  assert.equal(handEvents.length, 4);
  for (const e of handEvents) {
    assert.equal(e.p.cards.length, HAND_SIZE);
    assert.equal(typeof e.seat, 'number'); // private routing marker
  }
  assert.equal(byType(events, MSG.ROUND_START).length, 1);

  const first = engine.turnSeat;
  const other = (first + 1) % 4;
  const firstHand = table.get(first).hand;

  // Out of turn / bad calls.
  assert.equal(engine.play(other, [table.get(other).hand[0].id]).code, ERROR_CODES.NOT_YOUR_TURN);
  assert.equal(engine.callLiar(first).code, ERROR_CODES.BAD_STATE); // nothing to call at round start
  assert.equal(engine.useChip(first).code, ERROR_CODES.BAD_STATE); // no penalty running

  // Bad card selections.
  assert.equal(engine.play(first, []).code, ERROR_CODES.INVALID_CARDS);
  assert.equal(engine.play(first, firstHand.slice(0, 4).map((c) => c.id)).code, ERROR_CODES.INVALID_CARDS);
  assert.equal(engine.play(first, ['not-a-card']).code, ERROR_CODES.INVALID_CARDS);
  assert.equal(
    engine.play(first, [firstHand[0].id, firstHand[0].id]).code,
    ERROR_CODES.INVALID_CARDS
  );
  assert.equal(
    engine.play(first, [table.get(other).hand[0].id]).code, // someone else's card
    ERROR_CODES.INVALID_CARDS
  );

  // A legal play goes through and only the count is public.
  const res = engine.play(first, [firstHand[0].id, firstHand[1].id]);
  assert.equal(res.ok, true);
  const played = byType(events, MSG.PLAYED).at(-1);
  assert.deepEqual(played.p, { seat: first, count: 2, handCount: 3 });
  assert.equal('cards' in played.p, false);

  // Turn passed clockwise; the player cannot call their own play.
  const next = engine.turnSeat;
  assert.notEqual(next, first);
  assert.equal(engine.play(first, [firstHand[2].id]).code, ERROR_CODES.NOT_YOUR_TURN);
  assert.equal(engine.callLiar(first).code, ERROR_CODES.NOT_YOUR_TURN);
  const turnEvt = byType(events, MSG.TURN).at(-1);
  assert.deepEqual(
    { seat: turnEvt.p.seat, canCall: turnEvt.p.canCall },
    { seat: next, canCall: true }
  );
});

// ---------------------------------------------------------------------------
// Reveal correctness (incl. goldens as wild) across many seeded matches
// ---------------------------------------------------------------------------

test('reveal logic is correct in full matches (goldens count as truth)', () => {
  let goldenTruthSeen = 0;
  let reveals = 0;

  for (let seed = 1; seed <= 30; seed++) {
    const game = makeGame({ seed });
    const policies = [liar, sheriff, liar, sheriff];
    const playRecords = runMatch(game, policies);
    const { events, table } = game;

    // Rebuild the table fruit per round to check each reveal independently.
    let fruit = null;
    const pending = playRecords.slice();
    for (const e of events) {
      if (e.t === MSG.ROUND_START) fruit = e.p.tableFruit;
      if (e.t !== MSG.REVEAL) continue;
      reveals++;
      // The revealed cards must be exactly what that seat last played
      // (matched via the harness's own record of chosen cards).
      const idx = pending.findIndex(
        (r) =>
          r.seat === e.p.targetSeat &&
          r.cards.length === e.p.cards.length &&
          r.cards.every((c, i) => c.id === e.p.cards[i].id)
      );
      assert.notEqual(idx, -1, 'reveal did not match any recorded play');
      const rec = pending[idx];
      pending.splice(0, idx + 1); // earlier plays can no longer be challenged
      const expectedLie = !rec.cards.every(
        (c) => c.fruit === fruit || c.fruit === FRUITS.GOLDEN
      );
      assert.equal(e.p.lie, expectedLie, `lie flag wrong for seed ${seed}`);
      // Loser: player if lie, caller otherwise.
      const called = events[events.indexOf(e) - 1];
      assert.equal(called.t, MSG.CALLED);
      assert.equal(e.p.loserSeat, expectedLie ? e.p.targetSeat : called.p.callerSeat);
      if (!expectedLie && rec.cards.some((c) => c.fruit === FRUITS.GOLDEN)) goldenTruthSeen++;
    }

    // Exactly one cannon shot per round; final round ends in matchEnd.
    const rounds = byType(events, MSG.ROUND_START).length;
    assert.equal(byType(events, MSG.CANNON).length, rounds);
    assert.equal(byType(events, MSG.ROUND_END).length, rounds - 1);
    assert.equal(byType(events, MSG.MATCH_END).length, 1);
    assert.equal(table.aliveCount(), 1);
  }

  assert.ok(reveals > 50, `expected plenty of reveals, saw ${reveals}`);
  assert.ok(goldenTruthSeen > 0, 'never saw a golden banana counted as truth');
});

// ---------------------------------------------------------------------------
// Coconut Cannon: chamber progression, floor, certain doom at 1 chamber
// ---------------------------------------------------------------------------

test('surviving a shot removes one chamber: 6→5→…, floor 1', () => {
  const game = makeGame({ seed: 3, cannonRng: () => 0.999 }); // 0.999 < c/ch only when p=1
  const { table, events } = game;
  const expected = new Map([...Array(4).keys()].map((s) => [s, START_CHAMBERS]));

  runMatch(game, [liar, sheriff, liar, sheriff], { maxRounds: 14 });

  for (const e of events) {
    if (e.t === MSG.PENALTY) {
      assert.equal(e.p.chambers, expected.get(e.p.seat), 'penalty shows stale chambers');
      assert.equal(e.p.coconuts, 1);
    }
    if (e.t === MSG.CANNON && !e.p.hit) {
      expected.set(e.p.seat, Math.max(1, expected.get(e.p.seat) - 1));
    }
    if (e.t === MSG.CANNON && e.p.hit) {
      // With roll 0.999, a hit only happens at certain doom (1 chamber).
      assert.equal(expected.get(e.p.seat), 1, 'hit before reaching 1 chamber');
    }
  }
  // Final chamber counts match the tracked 6→5→… progression (floor 1).
  for (const [seat, chambers] of expected) {
    assert.equal(table.get(seat).chambersLeft, chambers);
  }
  // Someone ground all the way down 6→…→1.
  assert.ok([...expected.values()].some((v) => v === 1), 'nobody reached the 1-chamber floor');
});

test('at 1 chamber the next shot is certain doom', () => {
  const game = makeGame({ seed: 5, cannonRng: () => 0.9999 });
  const { table, events } = game;
  for (const s of table.seats) s.chambersLeft = 1; // stack the deck
  runMatch(game, [liar, sheriff, liar, sheriff], { maxRounds: 6 });
  const cannons = byType(events, MSG.CANNON);
  assert.ok(cannons.length > 0);
  for (const c of cannons) assert.equal(c.p.hit, true); // 1/1 → always a coconut
  assert.equal(byType(events, MSG.MATCH_END).length, 1);
});

// ---------------------------------------------------------------------------
// Lucky Banana Chip
// ---------------------------------------------------------------------------

test('chip adds +2 temporary chambers for one shot and changes the outcome', () => {
  // Roll 0.14: with chip p = 1/8 = 0.125 → miss; without chip p = 1/6 ≈ 0.167 → hit.
  const run = (spendChip) => {
    const game = makeGame({ seed: 11, cannonRng: () => 0.14 });
    const { engine, table, events } = game;
    engine.start();
    const first = engine.turnSeat;
    engine.play(first, [table.get(first).hand[0].id]);
    const caller = engine.turnSeat;
    engine.callLiar(caller);
    assert.equal(engine.phase, 'penalty');
    const pen = engine.inspect().penalty;
    const victim = pen.seat;
    assert.equal(byType(events, MSG.PENALTY).at(-1).p.chipUsable, true);
    if (spendChip) {
      // Only the victim can spend it.
      const bystander = (victim + 1) % 4;
      assert.equal(engine.useChip(bystander).code, ERROR_CODES.BAD_STATE);
      assert.equal(engine.useChip(victim).ok, true);
    } else {
      engine.onTimeout('penalty');
    }
    return { game, victim };
  };

  const withChip = run(true);
  const chipEvt = byType(withChip.game.events, MSG.CHIP_USED).at(-1);
  assert.deepEqual(chipEvt.p, {
    seat: withChip.victim,
    chambersNow: START_CHAMBERS + CHIP_BONUS_CHAMBERS,
  });
  assert.equal(byType(withChip.game.events, MSG.CANNON).at(-1).p.hit, false); // 8 chambers saved them
  assert.equal(withChip.game.table.get(withChip.victim).chips, 0);
  // Temporary chambers don't persist: 6 → 5 after the survived shot.
  assert.equal(withChip.game.table.get(withChip.victim).chambersLeft, START_CHAMBERS - 1);

  const withoutChip = run(false);
  assert.equal(byType(withoutChip.game.events, MSG.CANNON).at(-1).p.hit, true); // same roll, 6 chambers
});

test('chip is one per match: second penalty offers no chip and useChip is rejected', () => {
  const game = makeGame({ seed: 2, cannonRng: () => 0.999 }); // survive everything
  const { events } = game;
  const chipPolicies = { 0: true, 1: true, 2: true, 3: true }; // everyone chips ASAP
  runMatch(game, [liar, sheriff, liar, sheriff], { maxRounds: 14, chipPolicies });

  const chipUses = byType(events, MSG.CHIP_USED);
  const usesBySeat = new Map();
  for (const e of chipUses) {
    usesBySeat.set(e.p.seat, (usesBySeat.get(e.p.seat) ?? 0) + 1);
  }
  for (const [seat, n] of usesBySeat) assert.equal(n, 1, `seat ${seat} chipped ${n} times`);

  // Every penalty after a seat's chip went up in smoke must show chipUsable:false.
  const chipped = new Set();
  let laterPenalties = 0;
  for (const e of events) {
    if (e.t === MSG.PENALTY && chipped.has(e.p.seat)) {
      laterPenalties++;
      assert.equal(e.p.chipUsable, false);
    }
    if (e.t === MSG.CHIP_USED) chipped.add(e.p.seat);
  }
  assert.ok(laterPenalties > 0, 'no seat ever faced a second penalty — weak test');
  assert.ok(chipUses.length > 0);
});

// ---------------------------------------------------------------------------
// Last Monkey Holding + empty-hand safety
// ---------------------------------------------------------------------------

test('Last Monkey Holding: last holder cannot play and self-fires on decline', () => {
  const game = makeGame({ seed: 9 });
  const { engine, table, events } = game;
  engine.start();

  // Everyone dumps 3 cards a turn and never calls, racing to empty.
  let steps = 0;
  while (!engine.lastHolderPending && engine.phase === 'playing' && steps++ < 100) {
    const seat = engine.turnSeat;
    engine.play(seat, table.get(seat).hand.slice(0, 3).map((c) => c.id));
  }
  assert.equal(engine.lastHolderPending, true, 'never reached a sole holder');
  const holder = engine.turnSeat;
  assert.ok(table.get(holder).hand.length > 0);
  for (const s of table.aliveSeats()) {
    if (s.seat !== holder) assert.equal(s.hand.length, 0, 'other seats should be empty');
  }

  // The pending holder may NOT play more cards…
  const res = engine.play(holder, [table.get(holder).hand[0].id]);
  assert.deepEqual(res, { ok: false, code: ERROR_CODES.BAD_STATE });

  // …and declining (timeout) fires the cannon at themselves.
  engine.onTimeout('turn');
  const lastHolderEvt = byType(events, MSG.LAST_HOLDER).at(-1);
  const penaltyEvt = byType(events, MSG.PENALTY).at(-1);
  const evtOrder = events.map((e) => e.t);
  assert.equal(lastHolderEvt.p.seat, holder);
  assert.equal(penaltyEvt.p.seat, holder);
  assert.ok(evtOrder.indexOf(MSG.LAST_HOLDER) < evtOrder.indexOf(MSG.PENALTY));
  engine.onTimeout('penalty');
  assert.equal(byType(events, MSG.CANNON).at(-1).p.seat, holder); // self-shot
});

test('Last Monkey Holding: the sole holder may still call the final play', () => {
  const game = makeGame({ seed: 4 });
  const { engine, table, events } = game;
  engine.start();

  let steps = 0;
  while (!engine.lastHolderPending && engine.phase === 'playing' && steps++ < 100) {
    const seat = engine.turnSeat;
    engine.play(seat, table.get(seat).hand.slice(0, 3).map((c) => c.id));
  }
  assert.equal(engine.lastHolderPending, true);
  const holder = engine.turnSeat;
  const target = engine.lastPlay.seat;
  assert.notEqual(target, holder);

  assert.equal(engine.callLiar(holder).ok, true); // escape hatch
  assert.equal(byType(events, MSG.LAST_HOLDER).length, 0); // rule never fired
  const reveal = byType(events, MSG.REVEAL).at(-1);
  assert.equal(reveal.p.targetSeat, target);
  assert.ok([holder, target].includes(reveal.p.loserSeat));
  assert.equal(engine.phase, 'penalty');
});

test('full dumper matches always end via Last Monkey Holding self-shots', () => {
  const game = makeGame({ seed: 12, cannonRng: () => 0 }); // every shot hits
  const { events, table } = game;
  runMatch(game, [dumper, dumper, dumper, dumper]);
  const lastHolders = byType(events, MSG.LAST_HOLDER);
  const cannons = byType(events, MSG.CANNON);
  assert.equal(byType(events, MSG.CALLED).length, 0);
  assert.equal(lastHolders.length, cannons.length); // every shot was a self-shot
  for (let i = 0; i < cannons.length; i++) {
    assert.equal(cannons[i].p.seat, lastHolders[i].p.seat);
  }
  assert.equal(table.aliveCount(), 1);
});

// ---------------------------------------------------------------------------
// Elimination + winner
// ---------------------------------------------------------------------------

test('always-hit cannon: one elimination per round, single winner, sane standings', () => {
  const game = makeGame({ seed: 21, cannonRng: () => 0 });
  const { events, table } = game;
  runMatch(game, [liar, sheriff, liar, sheriff]);

  const eliminated = byType(events, MSG.ELIMINATED);
  assert.equal(eliminated.length, 3); // 4 players → 3 knocked out
  assert.equal(byType(events, MSG.ROUND_START).length, 3); // one KO per round

  const end = byType(events, MSG.MATCH_END)[0].p;
  const winner = table.get(end.winnerSeat);
  assert.equal(winner.alive, true);
  assert.equal(table.aliveCount(), 1);

  assert.equal(end.standings.length, 4);
  assert.deepEqual(end.standings.map((s) => s.place), [1, 2, 3, 4]);
  assert.equal(end.standings[0].seat, end.winnerSeat);
  // First monkey eliminated finishes last; last eliminated takes 2nd.
  assert.equal(end.standings.at(-1).seat, eliminated[0].p.seat);
  assert.equal(end.standings[1].seat, eliminated.at(-1).p.seat);

  // Ghosts never act or get turns again (checked live by runMatch invariants),
  // and their hands were cleared.
  for (const e of eliminated) assert.equal(table.get(e.p.seat).hand.length, 0);
});

// ---------------------------------------------------------------------------
// Timeout auto-play
// ---------------------------------------------------------------------------

test('turn timeout auto-plays 1 matching card when available, else 1 random — never calls', () => {
  let matchingCovered = 0;
  let randomCovered = 0;
  for (let seed = 1; seed <= 200 && (!matchingCovered || !randomCovered); seed++) {
    const game = makeGame({ seed });
    const { engine, table, events } = game;
    engine.start();
    const seat = engine.turnSeat;
    const before = table.get(seat).hand.map((c) => ({ ...c }));
    const fruit = game.getTableFruit();
    const hadMatch = before.some((c) => cardMatchesTableFruit(c, fruit));

    engine.onTimeout('turn');

    assert.equal(byType(events, MSG.CALLED).length, 0, 'timeout must never auto-call');
    const played = byType(events, MSG.PLAYED).at(-1);
    assert.deepEqual(
      { seat: played.p.seat, count: played.p.count, handCount: played.p.handCount },
      { seat, count: 1, handCount: HAND_SIZE - 1 }
    );
    const after = new Set(table.get(seat).hand.map((c) => c.id));
    const playedCard = before.find((c) => !after.has(c.id));
    if (hadMatch) {
      assert.ok(
        cardMatchesTableFruit(playedCard, fruit),
        `auto-play chose ${playedCard.fruit} despite holding a match for ${fruit}`
      );
      matchingCovered++;
    } else {
      randomCovered++;
    }
  }
  assert.ok(matchingCovered > 0, 'never exercised the matching-card branch');
  assert.ok(randomCovered > 0, 'never exercised the no-match random branch');
});

// ---------------------------------------------------------------------------
// Reconnect snapshots
// ---------------------------------------------------------------------------

test('snapshot mid-match is correct for seats and safe for spectators', () => {
  const game = makeGame({ seed: 8 });
  const { engine, table } = game;
  engine.start();
  const first = engine.turnSeat;
  engine.play(first, [table.get(first).hand[0].id, table.get(first).hand[1].id]);
  const current = engine.turnSeat;

  const snap = engine.snapshotFor(current);
  assert.equal(snap.mode, 'monkeyLies');
  assert.equal(snap.mapId, 'peeling_parrot');
  assert.equal(snap.phase, 'playing');
  assert.equal(snap.roundNo, 1);
  assert.ok(['banana', 'coconut', 'mango'].includes(snap.tableFruit));
  assert.equal(snap.turnSeat, current);
  assert.ok(snap.deadline > Date.now() - 1000);
  assert.deepEqual(snap.lastPlay, { seat: first, count: 2 });
  assert.equal(snap.yourSeat, current);
  assert.deepEqual(snap.yourHand, table.get(current).hand);
  assert.equal(snap.chipUsedByYou, false);
  assert.equal(snap.seats.length, 4);
  for (const s of snap.seats) {
    assert.deepEqual(Object.keys(s).sort(), [
      'alive', 'chambersLeft', 'chips', 'connected', 'handCount',
      'isBot', 'monkeyId', 'name', 'playerId', 'seat',
    ]);
    assert.equal('hand' in s, false); // SeatPublic never leaks cards
  }
  assert.equal(snap.seats[first].handCount, 3);

  // Spectator view: no seat, no hand.
  const specSnap = engine.snapshotFor(null);
  assert.equal(specSnap.yourSeat, null);
  assert.equal(specSnap.yourHand, null);
  assert.equal(specSnap.chipUsedByYou, false);
  assert.deepEqual(specSnap.lastPlay, { seat: first, count: 2 });

  // Penalty phase snapshot carries the penalty deadline.
  engine.callLiar(current);
  const penSnap = engine.snapshotFor(current);
  assert.equal(penSnap.phase, 'penalty');
  assert.equal(penSnap.deadline, engine.inspect().penalty.deadline);
});

// ---------------------------------------------------------------------------
// gameRoom: private filtering — spectators never receive `hand`
// ---------------------------------------------------------------------------

test('gameRoom broadcast: hand goes only to its owner; spectators never see it', async () => {
  /** @type {Map<string, {t: string, p: Object}[]>} */
  const inbox = new Map();
  const send = (playerId, envelope) => {
    if (!inbox.has(playerId)) inbox.set(playerId, []);
    inbox.get(playerId).push(envelope);
  };

  let resolveEnd;
  const ended = new Promise((r) => (resolveEnd = r));

  const gr = createGameRoom({
    roomId: 'test-room',
    modeId: 'monkeyLies',
    mapId: 'peeling_parrot',
    turnSeconds: 15,
    seatMetas: [
      { playerId: 'human-a', name: 'Ann' },
      { playerId: 'human-b', name: 'Ben' },
      { playerId: 'bot-1', name: 'Tiptoe (bot)', isBot: true, personality: 'cautious' },
      { playerId: 'bot-2', name: 'Zonko (bot)', isBot: true, personality: 'chaotic' },
    ],
    send,
    getSpectatorIds: () => ['spec-1'],
    onMatchEnd: (p) => resolveEnd(p),
    seed: 42,
    autoDelayMs: 2,
    engineOverrides: { intermissionMs: 5, cannonRng: () => 0 }, // fast, always-hit
  });

  try {
    gr.start();
    // Detach both humans so the fallback policy drives every seat to matchEnd.
    gr.setConnected('human-a', false);
    gr.setConnected('human-b', false);
    const end = await ended;
    assert.equal(typeof end.winnerSeat, 'number');

    const spectator = inbox.get('spec-1') ?? [];
    assert.ok(spectator.some((e) => e.t === MSG.ROUND_START));
    assert.ok(spectator.some((e) => e.t === MSG.CANNON));
    assert.ok(spectator.some((e) => e.t === MSG.MATCH_END));
    assert.equal(
      spectator.filter((e) => e.t === MSG.HAND).length,
      0,
      'spectator received a private hand!'
    );
    assert.ok(spectator.some((e) => e.t === MSG.CONN && e.p.connected === false));

    // Humans got their own (disjoint) hands and nothing of each other's.
    const handsA = (inbox.get('human-a') ?? []).filter((e) => e.t === MSG.HAND);
    const handsB = (inbox.get('human-b') ?? []).filter((e) => e.t === MSG.HAND);
    assert.ok(handsA.length > 0 && handsB.length > 0);
    const idsA = new Set(handsA.flatMap((e) => e.p.cards.map((c) => c.id)));
    for (const e of handsB) {
      for (const c of e.p.cards) assert.equal(idsA.has(c.id), false, 'hand leak across seats');
    }
    // Bots never get network sends at all.
    assert.equal(inbox.has('bot-1'), false);
    assert.equal(inbox.has('bot-2'), false);

    // Non-seated ids can't act.
    assert.equal(gr.act('spec-1', MSG.PLAY, { cardIds: ['x'] }).code, ERROR_CODES.BAD_STATE);
  } finally {
    gr.destroy();
  }
});
