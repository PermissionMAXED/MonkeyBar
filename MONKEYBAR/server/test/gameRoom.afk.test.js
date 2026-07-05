// P7 hardening: connected-but-AFK humans are flagged after
// AFK_MISSED_TURNS_LIMIT consecutive turn timeouts (gameRoom onAfk hook) —
// the lobby room then kicks them and their seat converts to a bot.
// Disconnected players are exempt (the §3.4 reconnect hold covers them).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGameRoom } from '../src/game/gameRoom.js';
import { AFK_MISSED_TURNS_LIMIT } from '@monkeybar/shared/constants.js';

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
