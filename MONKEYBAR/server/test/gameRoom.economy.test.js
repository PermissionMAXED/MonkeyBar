// Economy fairness across modes (post-release fix): gameRoom.noteEconomyEvent
// consumes PUBLIC modeEvent kinds so per-match counters credit in every mode,
// not just Monkey Lies:
//   * dice CHALLENGE→REVEAL pair → goodCalls for a challenge that felled the
//     bidder (a bid that stood credits nobody);
//   * poker SHOWDOWN → goodCalls for each winnerSeat of a CONTESTED showdown
//     (fold wins are intentionally uncounted);
//   * roulette SHAKE → survivedShots (the coconut IS roulette's cannon).
// The gameRoom stays mode-generic: it only branches on shared event kinds.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGameRoom } from '../src/game/gameRoom.js';
import {
  DICE_ACTIONS,
  POKER_ACTIONS,
  POKER_EVENTS,
  ROULETTE_ACTIONS,
} from '@monkeybar/shared/modeEvents.js';
import { MSG } from '@monkeybar/shared/protocol.js';

/** A room driven purely by actForSeat — every real timer is out of reach. */
function makeRoom(modeId, { players = 2, seed = 7, engineOverrides = {} } = {}) {
  const sent = [];
  const room = createGameRoom({
    roomId: `economy-${modeId}`,
    modeId,
    mapId: 'peeling_parrot',
    turnSeconds: 600,
    seatMetas: Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` })),
    send: (playerId, envelope) => sent.push({ playerId, envelope }),
    seed,
    autoDelayMs: 600000,
    engineOverrides: { intermissionMs: 600000, ...engineOverrides },
  });
  room.start();
  return { room, sent };
}

const act = (room, seat, action, data = {}) =>
  room.actForSeat(seat, MSG.MODE_ACTION, { action, data });

// ---------------------------------------------------------------------------
// Banana Dice: CHALLENGE → REVEAL
// ---------------------------------------------------------------------------

test('economy: a dice challenge that fells the bidder credits the CALLER one goodCall', () => {
  // rng 0.25 → every die rolls 2 (no wilds) and seat 0 opens. A 10-sixes bid
  // is a certain lie; seat 1 challenges and the bidder loses.
  const { room } = makeRoom('bananaDice', { engineOverrides: { rng: () => 0.25 } });
  try {
    assert.equal(room.engine.turnSeat, 0);
    assert.ok(act(room, 0, DICE_ACTIONS.BID, { count: 10, face: 6 }).ok);
    assert.ok(act(room, 1, DICE_ACTIONS.CHALLENGE).ok);

    assert.deepEqual(room.countersFor(1), { goodCalls: 1, survivedShots: 0 }, 'caller earns the good call');
    assert.deepEqual(room.countersFor(0), { goodCalls: 0, survivedShots: 0 }, 'the felled bidder earns nothing');
  } finally {
    room.destroy();
  }
});

test('economy: a dice bid that STOOD credits nobody (pending challenge cleared)', () => {
  // All dice roll 2 → a single-2 bid trivially stands; the challenger loses.
  const { room } = makeRoom('bananaDice', { engineOverrides: { rng: () => 0.25 } });
  try {
    assert.ok(act(room, 0, DICE_ACTIONS.BID, { count: 1, face: 2 }).ok);
    assert.ok(act(room, 1, DICE_ACTIONS.CHALLENGE).ok);

    assert.deepEqual(room.countersFor(0), { goodCalls: 0, survivedShots: 0 });
    assert.deepEqual(room.countersFor(1), { goodCalls: 0, survivedShots: 0 }, 'a wrong call earns nothing');
  } finally {
    room.destroy();
  }
});

// ---------------------------------------------------------------------------
// Jungle Poker: SHOWDOWN (contested only)
// ---------------------------------------------------------------------------

test('economy: poker fold wins credit nobody; contested showdown winners each earn a goodCall', () => {
  const { room, sent } = makeRoom('junglePoker', { seed: 5 });
  try {
    // Hand 1: first seat raises, the other folds → UNCONTESTED. No credit.
    const f = room.engine.turnSeat;
    const g = (f + 1) % 2;
    assert.ok(act(room, f, POKER_ACTIONS.RAISE, { amount: 1 }).ok);
    assert.ok(act(room, g, POKER_ACTIONS.FOLD).ok);
    const foldSd = sent
      .map(({ envelope }) => envelope)
      .filter((e) => e.t === MSG.MODE_EVENT && e.p.kind === POKER_EVENTS.SHOWDOWN)
      .at(-1);
    assert.equal(foldSd.p.uncontested, true);
    assert.deepEqual(room.countersFor(f), { goodCalls: 0, survivedShots: 0 }, 'fold wins are uncounted');
    assert.deepEqual(room.countersFor(g), { goodCalls: 0, survivedShots: 0 });

    // Hand 2: both check → CONTESTED showdown. Each winnerSeat earns one.
    assert.ok(room.engine.onTimeout('intermission'));
    assert.ok(act(room, room.engine.turnSeat, POKER_ACTIONS.CALL).ok);
    assert.ok(act(room, room.engine.turnSeat, POKER_ACTIONS.CALL).ok);
    const sd = sent
      .map(({ envelope }) => envelope)
      .filter((e) => e.t === MSG.MODE_EVENT && e.p.kind === POKER_EVENTS.SHOWDOWN)
      .at(-1);
    assert.equal(sd.p.uncontested, false);
    assert.ok(sd.p.winnerSeats.length >= 1);
    for (let seat = 0; seat < 2; seat++) {
      const expected = sd.p.winnerSeats.includes(seat) ? 1 : 0;
      assert.equal(room.countersFor(seat).goodCalls, expected, `seat ${seat} goodCalls`);
    }
  } finally {
    room.destroy();
  }
});

// ---------------------------------------------------------------------------
// Coconut Roulette: SHAKE
// ---------------------------------------------------------------------------

test('economy: surviving a roulette shake credits survivedShots; a pass credits nothing', () => {
  // shakeRng 0.99 → every shake survives (roulette emits SHAKE only on survival).
  const { room } = makeRoom('coconutRoulette', {
    players: 3,
    engineOverrides: { shakeRng: () => 0.99 },
  });
  try {
    const holder = room.engine.turnSeat;
    assert.ok(act(room, holder, ROULETTE_ACTIONS.SHAKE).ok);
    assert.deepEqual(room.countersFor(holder), { goodCalls: 0, survivedShots: 1 });

    // Survivor keeps holding — passing moves the coconut but earns nothing.
    assert.equal(room.engine.turnSeat, holder);
    assert.ok(act(room, holder, ROULETTE_ACTIONS.PASS).ok);
    const next = room.engine.turnSeat;
    assert.notEqual(next, holder);
    assert.deepEqual(room.countersFor(next), { goodCalls: 0, survivedShots: 0 });
    assert.deepEqual(room.countersFor(holder), { goodCalls: 0, survivedShots: 1 }, 'pass adds nothing');

    // A second survived shake stacks.
    assert.ok(act(room, next, ROULETTE_ACTIONS.SHAKE).ok);
    assert.deepEqual(room.countersFor(next), { goodCalls: 0, survivedShots: 1 });
  } finally {
    room.destroy();
  }
});
