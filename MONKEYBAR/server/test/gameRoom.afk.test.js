// P7 hardening: connected-but-AFK humans are flagged after
// AFK_MISSED_TURNS_LIMIT consecutive turn timeouts (gameRoom onAfk hook) —
// the lobby room then kicks them and their seat converts to a bot.
// Disconnected players are exempt (the §3.4 reconnect hold covers them).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGameRoom } from '../src/game/gameRoom.js';
import { AFK_MISSED_TURNS_LIMIT } from '@monkeybar/shared/constants.js';
import { cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { MSG } from '@monkeybar/shared/protocol.js';

const SEATS = [
  { playerId: 'p0', name: 'Human', isBot: false },
  { playerId: 'bot-1', name: 'B1', isBot: true },
  { playerId: 'bot-2', name: 'B2', isBot: true },
  { playerId: 'bot-3', name: 'B3', isBot: true },
];

function fastRoom({ onAfk, sent }) {
  return createGameRoom({
    roomId: 'afk-test',
    modeId: 'monkeyLies',
    mapId: 'peeling_parrot',
    turnSeconds: 0.05, // 50 ms turn deadlines
    seatMetas: SEATS.map((s) => ({ ...s })),
    send: (playerId, envelope) => sent.push({ playerId, envelope }),
    onAfk,
    seed: 7,
    autoDelayMs: 5,
    engineOverrides: { penaltyWindowMs: 10, intermissionMs: 10 },
  });
}

function waitFor(cond, timeoutMs = 5000, everyMs = 10) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(poll, everyMs);
    };
    poll();
  });
}

test('AFK: connected human is flagged after 2 missed turns and seat converts to bot', async () => {
  const sent = [];
  const afkCalls = [];
  let gameRoom;
  gameRoom = fastRoom({
    sent,
    onAfk: (playerId, seat) => {
      afkCalls.push({ playerId, seat });
      // emulate what lobby/room.js does on kick: the seat becomes a bot
      gameRoom.convertSeatToBot(seat, 'cautious');
    },
  });

  gameRoom.start();
  try {
    await waitFor(() => afkCalls.length > 0);
    // let a few more turn deadlines pass — must NOT fire again once a bot
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    gameRoom.destroy();
  }

  assert.equal(afkCalls.length, 1, 'onAfk fires exactly once');
  assert.equal(afkCalls[0].playerId, 'p0');
  assert.equal(afkCalls[0].seat, 0);
  assert.equal(gameRoom.table.get(0).isBot, true, 'seat converted to bot');
  assert.ok(AFK_MISSED_TURNS_LIMIT === 2, 'limit per PLAN §8 P7');

  // The table got a public notice (chat from "The Bar") about the kick.
  const notice = sent.find(
    ({ playerId, envelope }) =>
      playerId === 'p0' && envelope.t === 'chat' && /dozed off/.test(envelope.p.text ?? '')
  );
  assert.ok(notice, 'AFK notice broadcast as chat');
});

test('AFK: disconnected humans are never AFK-kicked (reconnect hold covers them)', async () => {
  const sent = [];
  const afkCalls = [];
  const gameRoom = fastRoom({ sent, onAfk: (playerId, seat) => afkCalls.push({ playerId, seat }) });

  gameRoom.start();
  gameRoom.setConnected('p0', false); // §3.4: fallback policy plays their turns
  try {
    await new Promise((r) => setTimeout(r, 600)); // many deadlines pass
  } finally {
    gameRoom.destroy();
  }

  assert.equal(afkCalls.length, 0, 'no AFK kick while disconnected');
});

test('AFK: sleeping through a Royal Decree window counts as a missed turn', async () => {
  // Seed 1 (verified): after the leading bots shed one card each, seat 0's
  // turn comes with a Table-Fruit card in hand. Seat 0 plays it (honest), the
  // next bot calls and loses, the cannon misses (0.99) — the decree window
  // opens for seat 0. Strike 1 = the 5 s decree window expiring unanswered;
  // strike 2 = an ordinary round-2 turn timeout. With AFK_MISSED_TURNS_LIMIT
  // = 2 the kick fires — proving the decree miss counted.
  const sent = [];
  const afkCalls = [];
  const gameRoom = createGameRoom({
    roomId: 'afk-decree-test',
    modeId: 'monkeyLies',
    mapId: 'peeling_parrot',
    turnSeconds: 0.15, // 150 ms turn deadlines
    seatMetas: SEATS.map((s) => ({ ...s })),
    send: (playerId, envelope) => sent.push({ playerId, envelope }),
    onAfk: (playerId, seat) => afkCalls.push({ playerId, seat }),
    seed: 1,
    autoDelayMs: 600000, // fallback never acts — the test drives every bot
    engineOverrides: {
      rules: { decree: true }, // every round is a Royal Decree round
      cannonRng: () => 0.99, // every shot survives
      penaltyWindowMs: 10,
      intermissionMs: 50,
    },
  });
  const { engine, table } = gameRoom;

  /** Drive bot turns (1 card each, via actForSeat — no strikes) to seat 0. */
  function driveBotsToSeatZero() {
    let steps = 0;
    while (engine.turnSeat !== 0 && steps++ < 10) {
      const seat = engine.turnSeat;
      const res = gameRoom.actForSeat(seat, MSG.PLAY, { cardIds: [table.get(seat).hand[0].id] });
      assert.equal(res.ok, true, `drive play failed: ${res.code}`);
    }
    assert.equal(engine.turnSeat, 0, 'never reached seat 0');
  }

  gameRoom.start();
  try {
    // Round 1: seat 0 plays an HONEST card (no strike), the next bot calls it
    // and loses — seat 0 becomes the decree winner.
    driveBotsToSeatZero();
    const honest = table.get(0).hand.find((c) => cardMatchesTableFruit(c, engine.tableFruit));
    assert.ok(honest, 'seed 1 must deal seat 0 a Table-Fruit card');
    assert.ok(gameRoom.actForSeat(0, MSG.PLAY, { cardIds: [honest.id] }).ok);
    const caller = engine.turnSeat;
    assert.notEqual(caller, 0);
    assert.ok(gameRoom.actForSeat(caller, MSG.CALL_LIAR).ok);
    const reveal = sent.map(({ envelope }) => envelope).find((e) => e.t === MSG.REVEAL);
    assert.equal(reveal.p.lie, false, 'the called play was honest');
    assert.equal(reveal.p.loserSeat, caller);

    // Penalty (10 ms) resolves on the room's own timer → the decree opens.
    await waitFor(() => engine.phase === 'decree', 2000);
    assert.equal(engine.turnSeat, 0, 'the decree window belongs to seat 0');
    assert.equal(engine.getTimer().kind, 'decree');

    // Strike 1: the 5 s decree window expires unanswered (DECREE_WINDOW_MS is
    // engine-fixed). One miss is below the limit — no kick yet.
    await waitFor(() => engine.phase !== 'decree', 8000, 25);
    assert.equal(afkCalls.length, 0, 'a single decree miss must not kick');

    // Strike 2: an ordinary turn timeout in round 2. The kick fires
    // SYNCHRONOUSLY with that second miss — proof the decree miss counted
    // (a lone round-2 miss would still be below the limit).
    await waitFor(() => engine.phase === 'playing' && engine.roundNo === 2, 3000);
    driveBotsToSeatZero();
    const handBefore = table.get(0).hand.length;
    await waitFor(() => table.get(0).hand.length < handBefore, 2000); // deadline auto-played
    assert.deepEqual(afkCalls, [{ playerId: 'p0', seat: 0 }], 'decree miss + turn miss = AFK kick');
  } finally {
    gameRoom.destroy();
  }
});

test('AFK: a Last-Monkey-Holding turn timeout does NOT count as a missed turn', async () => {
  const sent = [];
  const afkCalls = [];
  const gameRoom = createGameRoom({
    roomId: 'afk-lastholder-test',
    modeId: 'monkeyLies',
    mapId: 'peeling_parrot',
    turnSeconds: 0.15, // 150 ms turn deadlines
    seatMetas: SEATS.map((s) => ({ ...s })),
    send: (playerId, envelope) => sent.push({ playerId, envelope }),
    onAfk: (playerId, seat) => afkCalls.push({ playerId, seat }),
    seed: 7,
    autoDelayMs: 600000, // fallback never acts — the test drives every seat
    engineOverrides: { penaltyWindowMs: 10, intermissionMs: 600000 },
  });
  const { engine, table } = gameRoom;

  gameRoom.start();
  try {
    // Strike 1: let the human's (seat 0) first turn time out normally.
    await waitFor(() => engine.phase === 'playing' && engine.turnSeat === 0);
    const handBefore = table.get(0).hand.length;
    await waitFor(() => table.get(0).hand.length < handBefore); // deadline auto-played
    assert.equal(afkCalls.length, 0, 'one ordinary miss must not kick yet');

    // Drive the table so seat 0 becomes the sole holder: seat 0 sheds 1 card
    // per turn via actForSeat (which does NOT clear AFK strikes), bots dump 3.
    // With AFK_MISSED_TURNS_LIMIT = 2, ONE more counted miss would kick seat 0.
    let steps = 0;
    while (!(engine.lastHolderPending && engine.turnSeat === 0) && steps++ < 50) {
      assert.equal(engine.phase, 'playing', `unexpected phase ${engine.phase}`);
      const seat = engine.turnSeat;
      const count = seat === 0 ? 1 : Math.min(3, table.get(seat).hand.length);
      const cardIds = table.get(seat).hand.slice(0, count).map((c) => c.id);
      const res = gameRoom.actForSeat(seat, MSG.PLAY, { cardIds });
      assert.equal(res.ok, true, `drive play failed: ${res.code}`);
    }
    assert.equal(engine.lastHolderPending, true, 'never reached a sole holder');
    assert.equal(engine.turnSeat, 0);

    // Let the last-holder turn time out → the forced self-shot fires…
    await waitFor(() => engine.phase !== 'playing');
    const lastHolderEvt = sent.find(({ envelope }) => envelope.t === MSG.LAST_HOLDER);
    assert.ok(lastHolderEvt, 'last-holder self-shot never fired');
    assert.equal(lastHolderEvt.envelope.p.seat, 0);
    await new Promise((r) => setTimeout(r, 200)); // penalty window (10 ms) resolves
  } finally {
    gameRoom.destroy();
  }

  // …but it is the round's resolution, not an AFK strike: no kick happened.
  assert.equal(afkCalls.length, 0, 'last-holder timeout must not add an AFK strike');
});
