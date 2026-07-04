// Wire-level tests: server boot + §3.2 dispatch (hello/session resume, lobby
// flow, host powers, rate limits, errors) and the full end-to-end flow —
// create room → host adds 3 bot seats (driven by the server's fallback
// auto-play) → start → a complete round ending in a Coconut Cannon shot,
// with spectator privacy, reconnect snapshot, and aid dedup along the way.

// Bots act fast in tests (gameRoom reads this at construction time).
process.env.MONKEYBAR_BOT_DELAY_MS = '25';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import WebSocket from 'ws';

import { startServer } from '../src/index.js';
import { MSG, ERROR_CODES } from '@monkeybar/shared/protocol.js';
import { HAND_SIZE } from '@monkeybar/shared/constants.js';

// ---------------------------------------------------------------------------
// Tiny scripted WS client
// ---------------------------------------------------------------------------

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    /** @type {{t: string, p: Object}[]} */
    const queue = [];
    /** @type {{t: string, p: Object}[]} */
    const all = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      all.push(msg);
      const idx = waiters.findIndex((w) => w.pred(msg));
      if (idx !== -1) waiters.splice(idx, 1)[0].resolve(msg);
      else queue.push(msg);
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        ws,
        all,
        send(t, p = {}) {
          ws.send(JSON.stringify({ t, p }));
        },
        sendRaw(s) {
          ws.send(s);
        },
        /** Consume the next queued/incoming message of `type` (matching `where`). */
        expect(type, { where = () => true, timeout = 10000 } = {}) {
          const pred = (m) => m.t === type && where(m.p);
          const idx = queue.findIndex(pred);
          if (idx !== -1) return Promise.resolve(queue.splice(idx, 1)[0]);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const at = waiters.indexOf(w);
              if (at !== -1) waiters.splice(at, 1);
              rej(
                new Error(
                  `timeout waiting for '${type}' (queued: ${queue.map((m) => m.t).join(',') || '∅'})`
                )
              );
            }, timeout);
            const w = {
              pred,
              resolve(m) {
                clearTimeout(timer);
                res(m);
              },
            };
            waiters.push(w);
          });
        },
        /** Consume the next message of any type, in arrival order. */
        next({ timeout = 10000 } = {}) {
          if (queue.length) return Promise.resolve(queue.shift());
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const at = waiters.indexOf(w);
              if (at !== -1) waiters.splice(at, 1);
              rej(new Error('timeout waiting for next message'));
            }, timeout);
            const w = {
              pred: () => true,
              resolve(m) {
                clearTimeout(timer);
                res(m);
              },
            };
            waiters.push(w);
          });
        },
        close() {
          ws.close();
        },
        terminate() {
          ws.terminate();
        },
      })
    );
  });
}

async function helloClient(port, name) {
  const c = await connect(port);
  c.send(MSG.HELLO, { name });
  const welcome = await c.expect(MSG.WELCOME);
  return { c, welcome: welcome.p };
}

// ---------------------------------------------------------------------------
// Boot, hello, session resume, heartbeat
// ---------------------------------------------------------------------------

test('boot: hello → welcome with catalogs; ping/pong; hello-first enforced', async () => {
  const server = await startServer({ port: 0, production: false });
  try {
    const c = await connect(server.port);

    // Anything before hello is rejected.
    c.send(MSG.LIST_ROOMS);
    assert.equal((await c.expect(MSG.ERROR)).p.code, ERROR_CODES.BAD_STATE);
    // Malformed frames too.
    c.sendRaw('{broken');
    assert.equal((await c.expect(MSG.ERROR)).p.code, ERROR_CODES.BAD_MSG);

    c.send(MSG.HELLO, { name: 'Ann' });
    const welcome = (await c.expect(MSG.WELCOME)).p;
    assert.equal(welcome.resumed, false);
    assert.ok(welcome.playerId && welcome.token);
    assert.equal(welcome.roster.length, 16);
    assert.equal(welcome.modes.length, 6);
    assert.equal(welcome.maps.length, 10);
    assert.equal(welcome.emotes.length, 10);
    assert.equal(welcome.quickPhrases.length, 12);
    // Idle-in-lobby clients get the public room list.
    assert.deepEqual((await c.expect(MSG.ROOM_LIST)).p.rooms, []);

    c.send(MSG.PING, { ts: 42 });
    const pong = (await c.expect(MSG.PONG)).p;
    assert.equal(pong.ts, 42);
    assert.equal(typeof pong.serverTs, 'number');

    // Double hello on the same socket is a protocol violation.
    c.send(MSG.HELLO, {});
    assert.equal((await c.expect(MSG.ERROR)).p.code, ERROR_CODES.BAD_STATE);

    // Token resume from a fresh socket keeps the playerId.
    const c2 = await connect(server.port);
    c2.send(MSG.HELLO, { token: welcome.token });
    const resumed = (await c2.expect(MSG.WELCOME)).p;
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.playerId, welcome.playerId);
    c2.close();
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Lobby flow: rooms, host powers, settings, codes, errors, chat limits
// ---------------------------------------------------------------------------

test('lobby: create/join/ready/bots/settings/host-powers/rate-limits', async () => {
  const server = await startServer({ port: 0 });
  try {
    const { c: host } = await helloClient(server.port, 'Host');
    const { c: guest } = await helloClient(server.port, 'Guest');

    guest.send(MSG.JOIN_ROOM, { roomId: 'no-such-room' });
    assert.equal((await guest.expect(MSG.ERROR)).p.code, ERROR_CODES.NOT_FOUND);

    host.send(MSG.CREATE_ROOM, {
      name: 'Bar Brawl',
      isPrivate: false,
      maxPlayers: 6,
      mode: 'monkeyLies',
      botFill: false,
    });
    const rs1 = (await host.expect(MSG.ROOM_STATE)).p.room;
    assert.equal(rs1.members.length, 1);
    assert.equal(rs1.members[0].isHost, true);
    assert.equal(rs1.code, undefined); // public rooms have no join code
    const roomId = rs1.id;

    // Idle clients hear about the new public room.
    await guest.expect(MSG.ROOM_LIST, { where: (p) => p.rooms.some((r) => r.id === roomId) });

    guest.send(MSG.JOIN_ROOM, { roomId });
    await guest.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 2 });
    await host.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 2 });

    // Host powers are host-only.
    guest.send(MSG.ADD_BOT, {});
    assert.equal((await guest.expect(MSG.ERROR)).p.code, ERROR_CODES.NOT_HOST);
    guest.send(MSG.UPDATE_SETTINGS, { patch: { turnSeconds: 30 } });
    assert.equal((await guest.expect(MSG.ERROR)).p.code, ERROR_CODES.NOT_HOST);

    host.send(MSG.ADD_BOT, { personality: 'trollish' });
    const withBot = (await host.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 3 })).p.room;
    const bot = withBot.members.find((m) => m.isBot);
    assert.equal(bot.personality, 'trollish');
    assert.equal(bot.ready, true);

    host.send(MSG.REMOVE_BOT, { botId: bot.id });
    await host.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 2 });

    // Monkey selection.
    host.send(MSG.SELECT_MONKEY, { monkeyId: 'bolt' });
    await host.expect(MSG.ROOM_STATE, {
      where: (p) => p.room.members.some((m) => m.monkeyId === 'bolt'),
    });
    host.send(MSG.SELECT_MONKEY, { monkeyId: 'not-a-monkey' });
    assert.equal((await host.expect(MSG.ERROR)).p.code, ERROR_CODES.NOT_FOUND);

    // Settings: valid patch applies, out-of-range is rejected at the protocol edge.
    host.send(MSG.UPDATE_SETTINGS, { patch: { turnSeconds: 30 } });
    await host.expect(MSG.ROOM_STATE, { where: (p) => p.room.settings.turnSeconds === 30 });
    host.send(MSG.UPDATE_SETTINGS, { patch: { turnSeconds: 5 } });
    assert.equal((await host.expect(MSG.ERROR)).p.code, ERROR_CODES.BAD_MSG);

    // Start validation: not enough seats yet.
    host.send(MSG.START_GAME, {});
    assert.equal((await host.expect(MSG.ERROR)).p.code, ERROR_CODES.BAD_STATE);

    // Stub modes are selectable but not startable.
    host.send(MSG.UPDATE_SETTINGS, { patch: { mode: 'bananaDice' } });
    await host.expect(MSG.ROOM_STATE, { where: (p) => p.room.mode === 'bananaDice' });
    host.send(MSG.ADD_BOT, {});
    host.send(MSG.ADD_BOT, {});
    await host.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 4 });
    host.send(MSG.READY, { ready: true });
    guest.send(MSG.READY, { ready: true });
    await host.expect(MSG.ROOM_STATE, {
      where: (p) => p.room.members.every((m) => m.ready),
    });
    host.send(MSG.START_GAME, {});
    assert.equal((await host.expect(MSG.ERROR)).p.code, 'NOT_PLAYABLE');

    // Chat reaches the room; a second message within 1 s is rate-limited.
    host.send(MSG.CHAT, { text: 'trust no monkey' });
    const chat = (await guest.expect(MSG.CHAT)).p;
    assert.deepEqual(chat, { seat: null, name: 'Host', text: 'trust no monkey' });
    host.send(MSG.CHAT, { text: 'again!' });
    assert.equal((await host.expect(MSG.ERROR)).p.code, ERROR_CODES.RATE_LIMIT);

    // Leaving: the leaver gets leftRoom, the room shrinks.
    guest.send(MSG.LEAVE_ROOM, {});
    assert.equal((await guest.expect(MSG.LEFT_ROOM)).p.reason, 'left');
    await host.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 3 });

    // Private rooms: 4-char code join, hidden from the browser, ROOM_FULL.
    const { c: p1 } = await helloClient(server.port, 'Priva');
    p1.send(MSG.CREATE_ROOM, { isPrivate: true, maxPlayers: 4, mode: 'monkeyLies', botFill: false });
    const priv = (await p1.expect(MSG.ROOM_STATE)).p.room;
    assert.match(priv.code, /^[A-Z2-9]{4}$/);
    const { c: p2 } = await helloClient(server.port, 'Joiner');
    const list = (await p2.expect(MSG.ROOM_LIST)).p.rooms;
    assert.equal(list.some((r) => r.id === priv.id), false); // not listed publicly
    p2.send(MSG.JOIN_ROOM, { code: priv.code });
    await p2.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 2 });
    p1.send(MSG.ADD_BOT, {});
    p1.send(MSG.ADD_BOT, {});
    await p1.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 4 });
    const { c: p3 } = await helloClient(server.port, 'TooLate');
    p3.send(MSG.JOIN_ROOM, { code: priv.code });
    assert.equal((await p3.expect(MSG.ERROR)).p.code, ERROR_CODES.ROOM_FULL);
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Quickmatch: queue → bot fill after delay → auto-start
// ---------------------------------------------------------------------------

test('quickMatch fills with bots and auto-starts; cancelQuick backs out', async () => {
  const server = await startServer({ port: 0, quickFillDelayMs: 150 });
  try {
    // Cancel path first.
    const { c: q1 } = await helloClient(server.port, 'Bailer');
    q1.send(MSG.QUICK_MATCH, { mode: 'monkeyLies' });
    await q1.expect(MSG.MATCH_FOUND);
    q1.send(MSG.CANCEL_QUICK, {});
    assert.equal((await q1.expect(MSG.LEFT_ROOM)).p.reason, 'left');

    // Fill path: solo player + 3 bots after the fill delay.
    const { c: q2 } = await helloClient(server.port, 'Speedy');
    q2.send(MSG.QUICK_MATCH, { mode: 'monkeyLies' });
    const found = (await q2.expect(MSG.MATCH_FOUND)).p;
    assert.ok(found.roomId);
    const start = (await q2.expect(MSG.GAME_START, { timeout: 5000 })).p;
    assert.equal(start.snapshot.seats.length, 4);
    assert.equal(start.snapshot.seats.filter((s) => s.isBot).length, 3);
    assert.equal(typeof start.snapshot.yourSeat, 'number');

    // Non-playable modes can't be quickmatched.
    const { c: q3 } = await helloClient(server.port, 'Wrong');
    q3.send(MSG.QUICK_MATCH, { mode: 'junglePoker' });
    assert.equal((await q3.expect(MSG.ERROR)).p.code, 'NOT_PLAYABLE');
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// E2E: host + 3 bot seats → full round through a cannon shot, spectator
// privacy, mid-match reconnect snapshot, aid dedup.
// ---------------------------------------------------------------------------

test('e2e: full round with bot seats ends in a cannon shot; spectate + reconnect work', async () => {
  const server = await startServer({ port: 0 });
  const clients = [];
  try {
    const { c: me, welcome } = await helloClient(server.port, 'Hero');
    clients.push(me);

    // -- lobby: create, add 3 bots, ready, start ------------------------------
    me.send(MSG.CREATE_ROOM, { isPrivate: false, maxPlayers: 4, mode: 'monkeyLies', botFill: false });
    const room = (await me.expect(MSG.ROOM_STATE)).p.room;
    me.send(MSG.ADD_BOT, {});
    me.send(MSG.ADD_BOT, {});
    me.send(MSG.ADD_BOT, {});
    const full = (await me.expect(MSG.ROOM_STATE, { where: (p) => p.room.members.length === 4 })).p.room;
    assert.equal(full.members.filter((m) => m.isBot).length, 3);
    assert.ok(full.members.filter((m) => m.isBot).every((m) => typeof m.personality === 'string'));
    me.send(MSG.READY, { ready: true });
    me.send(MSG.START_GAME, {});

    const start = (await me.expect(MSG.GAME_START)).p.snapshot;
    assert.equal(start.mode, 'monkeyLies');
    assert.equal(start.mapId, 'peeling_parrot');
    assert.equal(start.seats.length, 4);
    const mySeat = start.yourSeat;
    assert.equal(typeof mySeat, 'number');

    // -- round 1: drive the event stream until the cannon fires ----------------
    let myHand = [];
    let aidCounter = 0;
    let lastTurnSeat = -1;
    let lastPlay = null; // {seat, count}
    let loserSeat = -1;
    let sawCalled = false;
    let sawReveal = false;
    let sawPenalty = false;
    let sawLastHolder = false;
    let cannonEvt = null;
    const seen = [];

    const actAid = () => `a${++aidCounter}`;

    for (let i = 0; i < 400 && !cannonEvt; i++) {
      const msg = await me.next();
      seen.push(msg.t);
      switch (msg.t) {
        case MSG.HAND:
          myHand = msg.p.cards;
          assert.equal(myHand.length, HAND_SIZE);
          break;
        case MSG.ROUND_START:
          assert.equal(msg.p.roundNo, 1);
          assert.ok(['banana', 'coconut', 'mango'].includes(msg.p.tableFruit));
          assert.equal(msg.p.seats.length, 4);
          assert.ok(msg.p.seats.every((s) => s.handCount === HAND_SIZE));
          break;
        case MSG.TURN:
          lastTurnSeat = msg.p.seat;
          assert.ok(msg.p.deadline > Date.now() - 2000);
          if (msg.p.seat === mySeat) {
            if (msg.p.canCall) {
              me.send(MSG.CALL_LIAR, { aid: actAid() }); // end the round: MONKEY LIES!
            } else {
              me.send(MSG.PLAY, { aid: actAid(), cardIds: [myHand[0].id] });
            }
          }
          break;
        case MSG.PLAYED:
          // Face-down: only counts on the wire, and always from the turn holder.
          assert.equal(msg.p.seat, lastTurnSeat);
          assert.equal('cards' in msg.p, false);
          lastPlay = { seat: msg.p.seat, count: msg.p.count };
          if (msg.p.seat === mySeat) myHand = myHand.slice(1);
          break;
        case MSG.ACTION_ACK:
          assert.equal(msg.p.ok, true, `action rejected: ${msg.p.code}`);
          break;
        case MSG.CALLED:
          // P3 bot brains call "MONKEY LIES!" too, so the caller may be any
          // seat that beat us to it — not necessarily ours.
          sawCalled = true;
          assert.equal(typeof msg.p.callerSeat, 'number');
          assert.notEqual(msg.p.callerSeat, msg.p.targetSeat);
          assert.equal(msg.p.targetSeat, lastPlay.seat);
          break;
        case MSG.REVEAL:
          sawReveal = true;
          assert.equal(msg.p.targetSeat, lastPlay.seat);
          assert.equal(msg.p.cards.length, lastPlay.count);
          assert.ok(msg.p.cards.every((c) => c.id && c.fruit));
          loserSeat = msg.p.loserSeat;
          break;
        case MSG.LAST_HOLDER:
          sawLastHolder = true;
          loserSeat = msg.p.seat;
          break;
        case MSG.PENALTY:
          sawPenalty = true;
          assert.equal(msg.p.seat, loserSeat);
          assert.equal(msg.p.coconuts, 1);
          assert.ok(msg.p.chambers >= 1);
          if (msg.p.seat === mySeat && msg.p.chipUsable) {
            me.send(MSG.USE_CHIP, { aid: actAid() }); // Lucky Banana Chip over the wire
          }
          break;
        case MSG.CHIP_USED:
          assert.equal(msg.p.seat, loserSeat);
          break;
        case MSG.CANNON:
          cannonEvt = msg.p;
          assert.equal(msg.p.seat, loserSeat);
          assert.equal(typeof msg.p.hit, 'boolean');
          break;
        default:
          break; // roomState / conn / chat noise is fine
      }
    }

    assert.ok(cannonEvt, `never saw a cannon shot; stream: ${seen.join(',')}`);
    assert.ok(sawPenalty, 'penalty window never announced');
    assert.ok(sawCalled || sawLastHolder, 'round resolved without a call or last-holder');
    if (sawCalled) assert.ok(sawReveal, 'called but never revealed');

    // The round closes: hit → eliminated first; then roundEnd (4 players, so
    // the match can't be over after one shot).
    if (cannonEvt.hit) {
      const el = await me.expect(MSG.ELIMINATED);
      assert.equal(el.p.seat, cannonEvt.seat);
    }
    const roundEnd = (await me.expect(MSG.ROUND_END)).p;
    assert.ok(roundEnd.nextIn > 0);

    // -- spectator: joins mid-match, sees public events, never a hand ----------
    const { c: spec } = await helloClient(server.port, 'Watcher');
    clients.push(spec);
    const specList = (await spec.expect(MSG.ROOM_LIST)).p.rooms;
    assert.equal(specList.find((r) => r.id === room.id)?.inGame, true);
    spec.send(MSG.SPECTATE, { roomId: room.id });
    const specState = (await spec.expect(MSG.STATE)).p.snapshot;
    assert.equal(specState.yourSeat, null);
    assert.equal(specState.yourHand, null);

    // -- reconnect: drop the socket, resume with the token, get a snapshot -----
    me.terminate();
    await spec.expect(MSG.CONN, { where: (p) => p.seat === mySeat && p.connected === false });
    const me2 = await connect(server.port);
    clients.push(me2);
    me2.send(MSG.HELLO, { token: welcome.token });
    const wb = (await me2.expect(MSG.WELCOME)).p;
    assert.equal(wb.resumed, true);
    assert.equal(wb.playerId, welcome.playerId);
    await me2.expect(MSG.ROOM_STATE);
    const snap = (await me2.expect(MSG.STATE)).p.snapshot;
    assert.equal(snap.yourSeat, mySeat);
    assert.ok(Array.isArray(snap.yourHand)); // private hand restored to its owner
    assert.equal(snap.seats.length, 4);
    await spec.expect(MSG.CONN, { where: (p) => p.seat === mySeat && p.connected === true });

    // -- round 2 starts and play continues on the new socket -------------------
    const r2 = (await me2.expect(MSG.ROUND_START, { timeout: 10000 })).p;
    assert.equal(r2.roundNo, 2);
    const iAmAlive = r2.seats.find((s) => s.seat === mySeat).alive;
    if (iAmAlive) {
      // P3 bot brains may call "MONKEY LIES!" and end a round before our turn
      // ever arrives, so scan across rounds for our next turn, tracking the
      // freshest dealt hand (each round re-deals) and whether we can call.
      let hand2 = (await me2.expect(MSG.HAND)).p.cards;
      let myTurn = null;
      const scanDeadline = Date.now() + 90000;
      while (!myTurn && Date.now() < scanDeadline) {
        const msg = await me2.next({ timeout: 15000 });
        if (msg.t === MSG.HAND) hand2 = msg.p.cards;
        else if (msg.t === MSG.ELIMINATED && msg.p.seat === mySeat) break;
        else if (msg.t === MSG.TURN && msg.p.seat === mySeat) myTurn = msg.p;
      }
      if (myTurn) {
        // aid dedup: replaying the same aid returns the cached ack instead of
        // re-running the action (a real second action would be rejected).
        // Call when allowed (always legal, even as the last monkey holding),
        // else play a card from the current deal.
        if (myTurn.canCall) me2.send(MSG.CALL_LIAR, { aid: 'dup-1' });
        else me2.send(MSG.PLAY, { aid: 'dup-1', cardIds: [hand2[0].id] });
        const ack1 = (await me2.expect(MSG.ACTION_ACK, { where: (p) => p.aid === 'dup-1' })).p;
        assert.equal(ack1.ok, true);
        if (myTurn.canCall) me2.send(MSG.CALL_LIAR, { aid: 'dup-1' });
        else me2.send(MSG.PLAY, { aid: 'dup-1', cardIds: [hand2[0].id] });
        const ack2 = (await me2.expect(MSG.ACTION_ACK, { where: (p) => p.aid === 'dup-1' })).p;
        assert.deepEqual(ack2, ack1);
      }
    }

    // The spectator watched everything and never received a single hand
    // (hands are dealt before roundStart, so by the time the spectator has
    // round 2's roundStart, any leaked hand would already be in its inbox).
    await spec.expect(MSG.ROUND_START, { where: (p) => p.roundNo === 2, timeout: 10000 });
    assert.equal(spec.all.filter((m) => m.t === MSG.HAND).length, 0);
  } finally {
    for (const c of clients) {
      try {
        c.terminate();
      } catch {
        /* closed */
      }
    }
    await server.close();
  }
});
