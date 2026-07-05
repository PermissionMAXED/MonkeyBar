// Banana Dice rules engine (R4) — full simulated matches with scripted seat
// policies, plus gameRoom private-filtering checks. Headless: no sockets,
// no real timers (the harness drives engine.onTimeout itself).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import {
  createEngine,
  DICE_EVENT_DIE_REGAINED,
  minimalRaise,
  MODE_ID,
  PLAYABLE,
} from '../src/game/modes/bananaDice.js';
import { isModePlayable } from '../src/game/modes/index.js';
import { createGameRoom } from '../src/game/gameRoom.js';
import { CHIP_BONUS_CHAMBERS, DICE_START, START_CHAMBERS } from '@monkeybar/shared/constants.js';
import { countMatching } from '@monkeybar/shared/dice.js';
import { DICE_ACTIONS, DICE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { ERROR_CODES, MSG } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** rng that first replays `values`, then falls back to a seeded stream. */
function scriptedRng(values, seed = 42) {
  const fallback = mulberry32(seed);
  let i = 0;
  return () => (i < values.length ? values[i++] : fallback());
}

/** The rng value that makes rollDice produce `face` (1 + floor(v * 6)). */
const faceValue = (face) => (face - 1) / 6 + 0.01;

function makeGame({ players = 4, seed = 7, rng, cannonRng } = {}) {
  const table = createTable(
    Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
  );
  const events = [];
  /** @type {Map<number, number[]>} tracked dice, fed ONLY by private YOUR_DICE events */
  const dice = new Map();
  const engine = createEngine({
    table,
    seed,
    rng,
    cannonRng,
    onEvent: (e) => {
      events.push(e);
      if (e.t === MSG.MODE_EVENT && e.p.kind === DICE_EVENTS.YOUR_DICE) {
        dice.set(e.seat, e.p.dice.slice());
      }
    },
  });
  return { table, engine, events, dice };
}

const byType = (events, t) => events.filter((e) => e.t === t);
const byKind = (events, kind) =>
  events.filter((e) => e.t === MSG.MODE_EVENT && e.p.kind === kind);

/**
 * Drive a match with scripted per-seat policies.
 * policy(view) -> {type:'bid', count, face} | {type:'challenge'} | {type:'timeout'}
 * view = { seat, dice, bid, totalDice }
 */
function runMatch(game, policies, { maxSteps = 50000, chipPolicies = {} } = {}) {
  const { engine, table, dice } = game;
  if (engine.roundNo === 0) engine.start();

  for (let step = 0; step < maxSteps; step++) {
    if (engine.phase === 'matchEnd') break;

    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      assert.ok(table.get(seat).alive, `turn given to dead seat ${seat}`);
      const ins = engine.inspect();
      // Invariant: our event-tracked dice match the authoritative roll.
      assert.deepEqual(dice.get(seat), ins.rolls[seat], `tracked dice for seat ${seat} diverged`);
      const view = { seat, dice: dice.get(seat).slice(), bid: engine.bid, totalDice: ins.totalDice };
      const action = policies[seat](view);
      if (action.type === 'bid') {
        const res = engine.modeAction(seat, DICE_ACTIONS.BID, { count: action.count, face: action.face });
        assert.ok(res.ok, `bid by seat ${seat} rejected: ${res.code}`);
      } else if (action.type === 'challenge') {
        const res = engine.modeAction(seat, DICE_ACTIONS.CHALLENGE, {});
        assert.ok(res.ok, `challenge by seat ${seat} rejected: ${res.code}`);
      } else {
        engine.onTimeout('turn');
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
      assert.fail(`harness stuck in phase '${engine.phase}'`);
    }
  }
  assert.equal(engine.phase, 'matchEnd', 'match must reach matchEnd');
  return game;
}

/** Seeded semi-random policy: challenge on a coin when a bid exists, else minimal raise. */
function chaosPolicy(rng, challengeP = 0.35) {
  return (view) => {
    const raise = minimalRaise(view.bid, view.totalDice);
    if (!raise) return { type: 'challenge' };
    if (view.bid && rng() < challengeP) return { type: 'challenge' };
    return { type: 'bid', ...raise };
  };
}

// ---------------------------------------------------------------------------
// Registry + minimalRaise unit
// ---------------------------------------------------------------------------

test('bananaDice: module is live and registered playable', () => {
  assert.equal(MODE_ID, 'bananaDice');
  assert.equal(PLAYABLE, true);
  assert.ok(isModePlayable('bananaDice'), 'registry must report bananaDice playable');
});

test('minimalRaise: walks the strict (count, face) order and caps at the table total', () => {
  assert.deepEqual(minimalRaise(null, 20), { count: 1, face: 1 }); // opener
  assert.deepEqual(minimalRaise({ count: 2, face: 4 }, 20), { count: 2, face: 5 });
  assert.deepEqual(minimalRaise({ count: 2, face: 6 }, 20), { count: 3, face: 1 });
  assert.equal(minimalRaise({ count: 20, face: 6 }, 20), null); // nothing beats the max
  assert.deepEqual(minimalRaise({ count: 20, face: 5 }, 20), { count: 20, face: 6 });
});

// ---------------------------------------------------------------------------
// Round start: private rolls, public counts
// ---------------------------------------------------------------------------

test('roundStart: everyone gets DICE_START dice, faces are seat-private, counts are public', () => {
  const { engine, events, dice } = makeGame({ players: 4 });
  engine.start();

  const yours = byKind(events, DICE_EVENTS.YOUR_DICE);
  assert.equal(yours.length, 4);
  for (const e of yours) {
    assert.equal(typeof e.seat, 'number', 'YOUR_DICE must be seat-private (targeted)');
    assert.equal(e.p.dice.length, DICE_START);
    for (const d of e.p.dice) assert.ok(d >= 1 && d <= 6);
  }
  for (let s = 0; s < 4; s++) assert.equal(dice.get(s).length, DICE_START);

  const rs = byType(events, MSG.ROUND_START)[0];
  assert.ok(rs, 'roundStart must fire');
  assert.equal(typeof rs.seat, 'undefined', 'roundStart is public');
  for (const seatPub of rs.p.seats) {
    assert.equal(seatPub.dice, DICE_START, 'per-seat dice COUNT rides roundStart seats');
    assert.equal(typeof seatPub.dice, 'number');
    assert.ok(!('yourDice' in seatPub));
  }

  // First turn: no bid yet → only 'bid' is legal.
  const turn = byType(events, MSG.TURN)[0];
  assert.deepEqual(turn.p.actions, [DICE_ACTIONS.BID]);
  assert.equal(turn.p.seat, rs.p.firstSeat);
});

// ---------------------------------------------------------------------------
// Bid order + legality
// ---------------------------------------------------------------------------

test('bidding: strict raises via bidBeats, rotation, and rejects', () => {
  const { engine, events } = makeGame({ players: 4 });
  engine.start();
  const first = engine.turnSeat;

  // Not your turn.
  const other = (first + 1) % 4;
  assert.equal(engine.modeAction(other, DICE_ACTIONS.BID, { count: 1, face: 2 }).code, ERROR_CODES.NOT_YOUR_TURN);
  // Challenge with no bid on the table.
  assert.equal(engine.modeAction(first, DICE_ACTIONS.CHALLENGE, {}).code, ERROR_CODES.BAD_STATE);
  // Garbage bids.
  assert.equal(engine.modeAction(first, DICE_ACTIONS.BID, { count: 0, face: 3 }).code, ERROR_CODES.BAD_MSG);
  assert.equal(engine.modeAction(first, DICE_ACTIONS.BID, { count: 2, face: 7 }).code, ERROR_CODES.BAD_MSG);
  assert.equal(engine.modeAction(first, DICE_ACTIONS.BID, { count: 2.5, face: 3 }).code, ERROR_CODES.BAD_MSG);
  assert.equal(engine.modeAction(first, 'shake', {}).code, ERROR_CODES.BAD_MSG); // foreign verb
  // Bids above the table total are never legal (4×5 = 20 dice).
  assert.equal(engine.modeAction(first, DICE_ACTIONS.BID, { count: 21, face: 3 }).code, ERROR_CODES.BAD_STATE);

  // Legal opener.
  assert.ok(engine.modeAction(first, DICE_ACTIONS.BID, { count: 2, face: 3 }).ok);
  const bidEvt = byKind(events, DICE_EVENTS.BID)[0];
  assert.deepEqual(bidEvt.p, { kind: DICE_EVENTS.BID, seat: first, count: 2, face: 3 });
  assert.equal(engine.turnSeat, (first + 1) % 4, 'turn rotates clockwise');

  // The next turn event carries both verbs now that a bid exists.
  const lastTurn = byType(events, MSG.TURN).at(-1);
  assert.deepEqual(lastTurn.p.actions, [DICE_ACTIONS.BID, DICE_ACTIONS.CHALLENGE]);

  const second = engine.turnSeat;
  // Equal bid and lower-face-same-count do NOT beat (strict order).
  assert.equal(engine.modeAction(second, DICE_ACTIONS.BID, { count: 2, face: 3 }).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.modeAction(second, DICE_ACTIONS.BID, { count: 2, face: 2 }).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.modeAction(second, DICE_ACTIONS.BID, { count: 1, face: 6 }).code, ERROR_CODES.BAD_STATE);
  // Same count, higher face beats; higher count with lower face beats too.
  assert.ok(engine.modeAction(second, DICE_ACTIONS.BID, { count: 2, face: 6 }).ok);
  const third = engine.turnSeat;
  assert.ok(engine.modeAction(third, DICE_ACTIONS.BID, { count: 3, face: 1 }).ok);
});

// ---------------------------------------------------------------------------
// Challenge resolution + wild counting
// ---------------------------------------------------------------------------

/**
 * Scripted 2-player game: seat0 rolls all `f0`, seat1 all `f1` (5 dice each),
 * seat0 goes first (rng first-seat pick hits index 0 for values < 0.5).
 */
function twoPlayerScripted(f0, f1, { cannonRng } = {}) {
  const rolls = [...Array(5).fill(faceValue(f0)), ...Array(5).fill(faceValue(f1)), 0.1];
  return makeGame({ players: 2, rng: scriptedRng(rolls), cannonRng });
}

test('challenge: bid stands (wild 1s count) → the CHALLENGER loses a die', () => {
  // Seat0: five 3s. Seat1: five 1s (wild). Bid "ten 3s" is exactly met.
  const { engine, events } = twoPlayerScripted(3, 1);
  engine.start();
  assert.equal(engine.turnSeat, 0);
  assert.ok(engine.modeAction(0, DICE_ACTIONS.BID, { count: 10, face: 3 }).ok);
  assert.ok(engine.modeAction(1, DICE_ACTIONS.CHALLENGE, {}).ok);

  const ch = byKind(events, DICE_EVENTS.CHALLENGE)[0];
  assert.deepEqual(ch.p, {
    kind: DICE_EVENTS.CHALLENGE,
    callerSeat: 1,
    targetSeat: 0,
    bid: { count: 10, face: 3 },
  });

  const rev = byKind(events, DICE_EVENTS.REVEAL)[0];
  assert.equal(typeof rev.seat, 'undefined', 'reveal is public — everyone sees all dice');
  assert.equal(rev.p.face, 3);
  assert.equal(rev.p.matching, 10, '1s are wild: 5 natural 3s + 5 wild 1s');
  assert.equal(rev.p.loserSeat, 1, 'bid stood → challenger loses');
  const all = rev.p.dice.flatMap((d) => d.dice);
  assert.equal(rev.p.matching, countMatching(all, 3));

  const lost = byKind(events, DICE_EVENTS.DIE_LOST)[0];
  assert.deepEqual(lost.p, { kind: DICE_EVENTS.DIE_LOST, seat: 1, diceLeft: 4 });
  assert.equal(engine.phase, 'roundEnd');

  // Next round: the loser re-rolls only 4 dice; counts are public.
  engine.onTimeout('intermission');
  const rs2 = byType(events, MSG.ROUND_START).at(-1);
  assert.equal(rs2.p.seats.find((s) => s.seat === 1).dice, 4);
  const your2 = byKind(events, DICE_EVENTS.YOUR_DICE).filter((e) => e.seat === 1).at(-1);
  assert.equal(your2.p.dice.length, 4);
});

test('challenge: bid falls → the BIDDER loses a die; face-1 bids count only 1s', () => {
  // Seat0: five 2s. Seat1: five 4s. No 1s → a bid on face 1 needs real 1s.
  const { engine, events } = twoPlayerScripted(2, 4);
  engine.start();
  assert.ok(engine.modeAction(0, DICE_ACTIONS.BID, { count: 1, face: 1 }).ok);
  assert.ok(engine.modeAction(1, DICE_ACTIONS.CHALLENGE, {}).ok);
  const rev = byKind(events, DICE_EVENTS.REVEAL)[0];
  assert.equal(rev.p.matching, 0, 'face-1 bid counts ONLY the 1s — none rolled');
  assert.equal(rev.p.loserSeat, 0, 'bid fell → bidder loses');
  assert.deepEqual(byKind(events, DICE_EVENTS.DIE_LOST)[0].p, {
    kind: DICE_EVENTS.DIE_LOST,
    seat: 0,
    diceLeft: 4,
  });
});

// ---------------------------------------------------------------------------
// Turn timeout: auto minimal raise, else auto-challenge
// ---------------------------------------------------------------------------

test('timeout: auto minimal legal raise, auto-challenge when the bid is maxed', () => {
  const { engine, events } = makeGame({ players: 2 });
  engine.start();
  const first = engine.turnSeat;

  engine.onTimeout('turn'); // no bid → minimal opener {1,1}
  let bids = byKind(events, DICE_EVENTS.BID);
  assert.deepEqual(bids.at(-1).p, { kind: DICE_EVENTS.BID, seat: first, count: 1, face: 1 });

  engine.onTimeout('turn'); // {1,1} → {1,2}
  bids = byKind(events, DICE_EVENTS.BID);
  assert.deepEqual(bids.at(-1).p, { kind: DICE_EVENTS.BID, seat: 1 - first, count: 1, face: 2 });

  // Jump to the absolute max bid (10 dice on the table) → next turn may ONLY challenge.
  assert.ok(engine.modeAction(engine.turnSeat, DICE_ACTIONS.BID, { count: 10, face: 6 }).ok);
  const lastTurn = byType(events, MSG.TURN).at(-1);
  assert.deepEqual(lastTurn.p.actions, [DICE_ACTIONS.CHALLENGE], 'no legal raise left');
  const challenger = engine.turnSeat;
  engine.onTimeout('turn'); // → auto-challenge
  const ch = byKind(events, DICE_EVENTS.CHALLENGE).at(-1);
  assert.equal(ch.p.callerSeat, challenger);
  assert.ok(['roundEnd', 'penalty'].includes(engine.phase));
});

// ---------------------------------------------------------------------------
// 0 dice → Coconut Cannon → dieRegained / eliminated
// ---------------------------------------------------------------------------

/** Drain seat0: all-2s rolls forever; seat0 always overbids sixes, seat1 challenges. */
function drainPolicies() {
  return [
    (view) => ({ type: 'bid', count: view.totalDice, face: 6 }), // certain lie
    // Seat1 challenges seat0's lie; when seat1 opens the round (first-seat
    // rotation) it bids a truthful minimum first to hand seat0 the stage.
    (view) => (view.bid ? { type: 'challenge' } : { type: 'bid', count: 1, face: 2 }),
  ];
}

test('0 dice → cannon: survive → chamber shrinks + dieRegained back to 1; hit → eliminated', () => {
  // rng constant 0.25 → every die rolls 2 (no wilds), first-seat pick = seat0.
  // Cannon: shot 1 survives (0.9 ≥ 1/4), shot 2 hits (0.0 < 1/3).
  const game = makeGame({
    players: 2,
    rng: () => 0.25,
    cannonRng: scriptedRng([0.9, 0.0]),
  });
  const { events, table } = game;
  runMatch(game, drainPolicies());

  // Seat0 lost 5 challenges → 0 dice → penalty → survived → regained 1 die,
  // then lost again → second cannon → hit → eliminated → matchEnd.
  const penalties = byType(events, MSG.PENALTY);
  assert.equal(penalties.length, 2);
  assert.deepEqual(
    penalties.map((e) => e.p.seat),
    [0, 0]
  );
  assert.equal(penalties[0].p.chambers, START_CHAMBERS);
  assert.equal(penalties[1].p.chambers, START_CHAMBERS - 1, 'surviving costs one chamber (ML parity)');

  const cannons = byType(events, MSG.CANNON);
  assert.deepEqual(
    cannons.map((e) => ({ seat: e.p.seat, hit: e.p.hit })),
    [
      { seat: 0, hit: false },
      { seat: 0, hit: true },
    ]
  );

  const regained = byKind(events, DICE_EVENT_DIE_REGAINED);
  assert.equal(regained.length, 1);
  assert.deepEqual(regained[0].p, { kind: DICE_EVENT_DIE_REGAINED, seat: 0, diceLeft: 1 });

  // After the regain, seat0 re-rolled exactly ONE die the next round.
  const afterRegain = byKind(events, DICE_EVENTS.YOUR_DICE)
    .filter((e) => e.seat === 0)
    .at(-1);
  assert.equal(afterRegain.p.dice.length, 1);

  assert.deepEqual(byType(events, MSG.ELIMINATED)[0].p, { seat: 0 });
  assert.equal(table.get(0).alive, false);
  const end = byType(events, MSG.MATCH_END)[0];
  assert.equal(end.p.winnerSeat, 1);
  assert.deepEqual(
    end.p.standings.map((s) => ({ seat: s.seat, place: s.place })),
    [
      { seat: 1, place: 1 },
      { seat: 0, place: 2 },
    ]
  );
});

test('penalty window: the Lucky Banana Chip adds +2 temporary chambers for one shot', () => {
  // Survive check with the chip: chambers 4+2=6, coconuts 1 → hit iff rng < 1/6.
  const game = makeGame({ players: 2, rng: () => 0.25, cannonRng: scriptedRng([0.5, 0.0]) });
  const { events, table } = game;
  runMatch(game, drainPolicies(), { chipPolicies: { 0: true } });

  const chip = byType(events, MSG.CHIP_USED)[0];
  assert.deepEqual(chip.p, { seat: 0, chambersNow: START_CHAMBERS + CHIP_BONUS_CHAMBERS });
  assert.equal(table.get(0).chips, 0, 'one chip per match — spent');
  // First shot survived thanks to the odds (0.5 ≥ 1/6); the +2 didn't persist.
  assert.equal(byType(events, MSG.PENALTY)[1].p.chambers, START_CHAMBERS - 1);
  assert.equal(byType(events, MSG.PENALTY)[1].p.chipUsable, false, 'chip already gone');
});

test('useChip: rejected outside the own penalty window', () => {
  const { engine } = makeGame({ players: 2 });
  engine.start();
  assert.equal(engine.useChip(0).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.resolvePenalty().code, ERROR_CODES.BAD_STATE);
  // Legacy ML verbs are rejected too (never throw).
  assert.equal(engine.play(0, []).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.callLiar(0).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.fireSelf(0).code, ERROR_CODES.BAD_STATE);
});

// ---------------------------------------------------------------------------
// Snapshot privacy (§10.3 / §B.3)
// ---------------------------------------------------------------------------

test('snapshotFor: yourDice only for the owner; spectators/others get counts only', () => {
  const { engine, dice } = makeGame({ players: 4 });
  engine.start();
  assert.ok(engine.modeAction(engine.turnSeat, DICE_ACTIONS.BID, { count: 2, face: 5 }).ok);

  const own = engine.snapshotFor(1);
  assert.equal(own.mode, MODE_ID);
  assert.equal(own.yourSeat, 1);
  assert.deepEqual(own.yourDice, dice.get(1), 'owner sees their own faces');
  assert.deepEqual(own.bid, { seat: own.bid.seat, count: 2, face: 5 });
  assert.equal(own.totalDice, 20);
  assert.equal(own.penalty, null);
  for (const s of own.seats) {
    assert.equal(typeof s.dice, 'number', 'per-seat extension is a COUNT');
  }

  const spec = engine.snapshotFor(null);
  assert.equal(spec.yourSeat, null);
  assert.equal(spec.yourDice, null, 'spectators NEVER see dice faces');
  assert.equal(spec.totalDice, 20);
  // Belt and braces: no face array of any seat leaks anywhere in the spectator snapshot.
  const flat = JSON.stringify(spec);
  for (let s = 0; s < 4; s++) {
    assert.ok(!flat.includes(JSON.stringify(dice.get(s))), 'no roll leaks in spectator snapshot');
  }

  const outOfRange = engine.snapshotFor(99);
  assert.equal(outOfRange.yourSeat, null);
  assert.equal(outOfRange.yourDice, null);
});

test('gameRoom: YOUR_DICE reaches only the owner; spectator state has no yourDice', () => {
  /** @type {Map<string, Object[]>} playerId → received envelopes */
  const inbox = new Map();
  const send = (playerId, envelope) => {
    if (!inbox.has(playerId)) inbox.set(playerId, []);
    inbox.get(playerId).push(envelope);
  };
  const room = createGameRoom({
    roomId: 'r1',
    modeId: 'bananaDice',
    mapId: 'peeling_parrot',
    turnSeconds: 15,
    seatMetas: [
      { playerId: 'alice', name: 'Alice' },
      { playerId: 'bob', name: 'Bob' },
      { playerId: 'carol', name: 'Carol' },
    ],
    send,
    getSpectatorIds: () => ['ghost'],
    seed: 11,
  });
  room.start();

  const yourDiceOf = (id) =>
    (inbox.get(id) ?? []).filter((e) => e.t === MSG.MODE_EVENT && e.p.kind === DICE_EVENTS.YOUR_DICE);
  assert.equal(yourDiceOf('alice').length, 1);
  assert.equal(yourDiceOf('bob').length, 1);
  assert.equal(yourDiceOf('ghost').length, 0, 'spectators never get YOUR_DICE');
  assert.notDeepEqual(
    yourDiceOf('alice')[0].p.dice,
    undefined,
    'owner payload carries the faces'
  );
  // Public frames (roundStart/turn) DID reach the spectator.
  assert.ok((inbox.get('ghost') ?? []).some((e) => e.t === MSG.ROUND_START));

  // Reconnect snapshots: seated player sees own dice; spectator sees null.
  const aliceSnap = room.snapshotFor('alice');
  assert.equal(aliceSnap.yourDice.length, DICE_START);
  const ghostSnap = room.snapshotFor('ghost');
  assert.equal(ghostSnap.yourDice, null);
  assert.equal(ghostSnap.yourSeat, null);
  for (const s of ghostSnap.seats) assert.equal(typeof s.dice, 'number');

  room.destroy();
});

// ---------------------------------------------------------------------------
// Full seeded matches (4 and 8 players)
// ---------------------------------------------------------------------------

for (const players of [4, 8]) {
  test(`full seeded ${players}-player matches reach matchEnd with sane standings`, () => {
    for (const seed of [1, 2, 3]) {
      const game = makeGame({ players, seed });
      const rng = mulberry32(seed * 1000 + players);
      const chips = Object.fromEntries(
        Array.from({ length: players }, (_, i) => [i, rng() < 0.5])
      );
      runMatch(
        game,
        Array.from({ length: players }, () => chaosPolicy(rng)),
        { chipPolicies: chips }
      );
      const { engine, events, table } = game;

      const end = byType(events, MSG.MATCH_END)[0];
      assert.equal(end.p.winnerSeat, engine.winnerSeat);
      assert.ok(table.get(end.p.winnerSeat).alive);
      assert.equal(table.aliveCount(), 1, 'last monkey standing');
      // Standings: every seat exactly once, places 1..N, elimination order reversed.
      assert.equal(end.p.standings.length, players);
      assert.deepEqual(
        end.p.standings.map((s) => s.place),
        Array.from({ length: players }, (_, i) => i + 1)
      );
      assert.equal(new Set(end.p.standings.map((s) => s.seat)).size, players);
      const elimOrder = byType(events, MSG.ELIMINATED).map((e) => e.p.seat);
      assert.deepEqual(
        end.p.standings.slice(1).map((s) => s.seat),
        elimOrder.slice().reverse(),
        'standings follow elimination order'
      );

      // Every challenge produced a reveal whose matching obeys countMatching,
      // and every reveal's loser followed the stood/fell rule.
      const challenges = byKind(events, DICE_EVENTS.CHALLENGE);
      const reveals = byKind(events, DICE_EVENTS.REVEAL);
      assert.equal(challenges.length, reveals.length);
      assert.ok(reveals.length > 0, 'a match without a single challenge is no match');
      for (let i = 0; i < reveals.length; i++) {
        const ch = challenges[i].p;
        const rev = reveals[i].p;
        const all = rev.dice.flatMap((d) => d.dice);
        assert.equal(rev.matching, countMatching(all, ch.bid.face));
        const stood = rev.matching >= ch.bid.count;
        assert.equal(rev.loserSeat, stood ? ch.callerSeat : ch.targetSeat);
      }

      // Bids strictly escalate within each round.
      let cur = null;
      for (const e of events) {
        if (e.t === MSG.ROUND_START) cur = null;
        else if (e.t === MSG.MODE_EVENT && e.p.kind === DICE_EVENTS.BID) {
          if (cur) {
            const beats =
              e.p.count > cur.count || (e.p.count === cur.count && e.p.face > cur.face);
            assert.ok(beats, `bid ${JSON.stringify(e.p)} did not beat ${JSON.stringify(cur)}`);
          }
          cur = { count: e.p.count, face: e.p.face };
        }
      }
    }
  });
}

test('turns only ever go to alive seats and rotation skips the eliminated', () => {
  const game = makeGame({ players: 4, seed: 5 });
  const rng = mulberry32(99);
  runMatch(
    game,
    Array.from({ length: 4 }, () => chaosPolicy(rng, 0.5))
  );
  const { events } = game;
  const deadAt = new Map(); // seat → event index when eliminated
  events.forEach((e, i) => {
    if (e.t === MSG.ELIMINATED) deadAt.set(e.p.seat, i);
  });
  events.forEach((e, i) => {
    if (e.t === MSG.TURN) {
      assert.ok(
        !deadAt.has(e.p.seat) || i < deadAt.get(e.p.seat),
        `turn handed to eliminated seat ${e.p.seat}`
      );
    }
  });
});
