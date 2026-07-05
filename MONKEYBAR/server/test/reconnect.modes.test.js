// R10 hardening: drop/rejoin mid-phase in ALL 6 modes. Each test drives a
// gameRoom to a juicy mid-phase state (mid-penalty, mid-bidding, mid-betting,
// bomb-holding…), disconnects the human, and asserts:
//   * the `conn` broadcast reaches the table + spectators both ways,
//   * spectator snapshots NEVER leak private state (yourHand/yourDice/
//     yourCards, per-seat card/dice faces),
//   * the rejoining player's snapshot resyncs the full mid-phase state
//     (their private view + the mode's public extension fields),
//   * the match still progresses after the rejoin.
// Timers are effectively frozen (huge turnSeconds/autoDelayMs) — the test
// drives every seat itself, so the states under inspection cannot move.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGameRoom } from '../src/game/gameRoom.js';
import { MSG } from '@monkeybar/shared/protocol.js';
import {
  DICE_ACTIONS,
  POKER_ACTIONS,
  ROULETTE_ACTIONS,
} from '@monkeybar/shared/modeEvents.js';
import { validateKnobs } from '@monkeybar/shared/chaos.js';
import { DICE_START, POKER_ANTE } from '@monkeybar/shared/constants.js';

const HUMAN = 'p0';
const SPECTATOR = 'spec-1';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** 1 human + 3 bots, frozen timers — the test drives every seat itself. */
function makeRoom(modeId, { engineOverrides = {}, knobs = null, seed = 7 } = {}) {
  /** @type {Map<string, {t: string, p: Object}[]>} */
  const inbox = new Map();
  const gr = createGameRoom({
    roomId: `reconnect-${modeId}`,
    modeId,
    mapId: 'peeling_parrot',
    turnSeconds: 600,
    seatMetas: [
      { playerId: HUMAN, name: 'Human', isBot: false },
      { playerId: 'bot-1', name: 'B1', isBot: true },
      { playerId: 'bot-2', name: 'B2', isBot: true },
      { playerId: 'bot-3', name: 'B3', isBot: true },
    ],
    send: (playerId, envelope) => {
      if (!inbox.has(playerId)) inbox.set(playerId, []);
      inbox.get(playerId).push(envelope);
    },
    getSpectatorIds: () => [SPECTATOR],
    seed,
    autoDelayMs: 600000, // fallback never acts — states under inspection are frozen
    knobs,
    engineOverrides: { intermissionMs: 600000, penaltyWindowMs: 600000, ...engineOverrides },
  });
  return { gr, inbox };
}

/** Private snapshot fields across all 6 modes — null for every spectator. */
const PRIVATE_KEYS = ['yourHand', 'yourDice', 'yourCards'];

function assertSpectatorPrivacy(snap, modeId) {
  assert.equal(snap.yourSeat, null, `${modeId}: spectator yourSeat must be null`);
  for (const key of PRIVATE_KEYS) {
    if (key in snap) assert.equal(snap[key], null, `${modeId}: spectator ${key} leaked`);
  }
  for (const s of snap.seats) {
    assert.equal('hand' in s, false, `${modeId}: seat row leaked a hand`);
    assert.equal('cards' in s, false, `${modeId}: seat row leaked cards`);
    assert.equal('rolls' in s, false, `${modeId}: seat row leaked rolls`);
    // bananaDice rides a per-seat `dice` COUNT — never the rolled faces.
    if ('dice' in s) assert.equal(typeof s.dice, 'number', `${modeId}: seat dice must be a count`);
  }
}

/**
 * Disconnect the human, snapshot both views while offline, reconnect.
 * Returns { spec, mine } — the spectator snapshot taken while the player was
 * offline and the player's own snapshot taken right after the rejoin.
 */
function dropAndRejoin(gr, inbox, modeId) {
  // DROP: the table + spectators hear about it.
  assert.equal(gr.setConnected(HUMAN, false), true);
  assert.equal(gr.table.get(0).connected, false);
  const connOff = (inbox.get(SPECTATOR) ?? []).filter((e) => e.t === MSG.CONN).at(-1);
  assert.deepEqual(connOff?.p, { seat: 0, connected: false }, `${modeId}: conn(false) broadcast`);

  // While offline: both spectator paths (anonymous + unseated playerId) are safe.
  const spec = gr.snapshotFor(null);
  assertSpectatorPrivacy(spec, modeId);
  assertSpectatorPrivacy(gr.snapshotFor(SPECTATOR), modeId);

  // REJOIN: conn(true) broadcast + the private view is whole again.
  assert.equal(gr.setConnected(HUMAN, true), true);
  assert.equal(gr.table.get(0).connected, true);
  const connOn = (inbox.get(SPECTATOR) ?? []).filter((e) => e.t === MSG.CONN).at(-1);
  assert.deepEqual(connOn?.p, { seat: 0, connected: true }, `${modeId}: conn(true) broadcast`);

  const mine = gr.snapshotFor(HUMAN);
  assert.equal(mine.yourSeat, 0, `${modeId}: rejoin snapshot must reseat the player`);
  assert.equal(mine.mode, modeId);
  return { spec, mine };
}

// ---------------------------------------------------------------------------
// Monkey Lies — drop mid-PENALTY
// ---------------------------------------------------------------------------

test('monkeyLies: drop mid-penalty → penalty resyncs, hand stays private, match plays on', () => {
  const { gr, inbox } = makeRoom('monkeyLies');
  try {
    gr.start();
    const { engine, table } = gr;

    // Force a call → live penalty window: first player plays one card, next calls.
    const first = engine.turnSeat;
    assert.equal(gr.actForSeat(first, MSG.PLAY, { cardIds: [table.get(first).hand[0].id] }).ok, true);
    const caller = engine.turnSeat;
    assert.equal(gr.actForSeat(caller, MSG.CALL_LIAR, {}).ok, true);
    assert.equal(engine.phase, 'penalty');
    const pen = engine.inspect().penalty;

    const { spec, mine } = dropAndRejoin(gr, inbox, 'monkeyLies');

    // Public penalty shape survives the drop in BOTH views.
    for (const snap of [spec, mine]) {
      assert.equal(snap.phase, 'penalty');
      assert.equal(snap.penalty.seat, pen.seat);
      assert.equal(snap.penalty.deadline, pen.deadline);
      assert.equal(typeof snap.penalty.chambers, 'number');
      assert.equal(typeof snap.penalty.chipUsable, 'boolean');
    }
    // Resync correctness: the rejoiner gets their full authoritative hand.
    assert.deepEqual(
      mine.yourHand.map((c) => c.id),
      table.get(0).hand.map((c) => c.id)
    );

    // The match is not stuck after the rejoin: resolve and play on.
    assert.equal(gr.resolvePenalty(pen.seat).ok, true);
    assert.notEqual(engine.phase, 'penalty');
  } finally {
    gr.destroy();
  }
});

// ---------------------------------------------------------------------------
// Banana Dice — drop mid-BIDDING
// ---------------------------------------------------------------------------

test('bananaDice: drop mid-bidding → bid resyncs, dice stay under the shell', () => {
  const { gr, inbox } = makeRoom('bananaDice');
  try {
    gr.start();
    const { engine } = gr;
    assert.equal(engine.phase, 'playing');

    const bidder = engine.turnSeat;
    const res = gr.actForSeat(bidder, MSG.MODE_ACTION, {
      action: DICE_ACTIONS.BID,
      data: { count: 2, face: 3 },
    });
    assert.equal(res.ok, true, `bid rejected: ${res.code}`);

    const { spec, mine } = dropAndRejoin(gr, inbox, 'bananaDice');

    for (const snap of [spec, mine]) {
      assert.equal(snap.phase, 'playing');
      assert.deepEqual(snap.bid, { seat: bidder, count: 2, face: 3 });
      assert.equal(snap.totalDice, 4 * DICE_START);
      assert.equal(snap.turnSeat, engine.turnSeat);
    }
    assert.equal(spec.yourDice, null);
    assert.deepEqual(mine.yourDice, engine.inspect().rolls[0], 'rejoiner sees their true roll');
    assert.equal(mine.yourDice.length, DICE_START);

    // Still playable: the current bidder can top the standing bid.
    const next = gr.actForSeat(engine.turnSeat, MSG.MODE_ACTION, {
      action: DICE_ACTIONS.BID,
      data: { count: 2, face: 4 },
    });
    assert.equal(next.ok, true);
  } finally {
    gr.destroy();
  }
});

// ---------------------------------------------------------------------------
// Coconut Roulette — drop while HOLDING the armed coconut
// ---------------------------------------------------------------------------

test('coconutRoulette: drop while holding the bomb → holder/odds resync intact', () => {
  const { gr, inbox } = makeRoom('coconutRoulette', {
    engineOverrides: { shakeRng: () => 0.999 }, // shakes never explode here
  });
  try {
    gr.start();
    const { engine } = gr;

    // Walk the coconut to the human: whoever holds it passes clockwise.
    let guard = 0;
    while (engine.inspect().holderSeat !== 0 && guard++ < 8) {
      const holder = engine.inspect().holderSeat;
      const res = gr.actForSeat(holder, MSG.MODE_ACTION, { action: ROULETTE_ACTIONS.PASS, data: {} });
      assert.equal(res.ok, true, `pass rejected: ${res.code}`);
    }
    assert.equal(engine.inspect().holderSeat, 0, 'coconut never reached the human');

    // One survived shake — the round's odds counter is now non-trivial state.
    assert.equal(gr.actForSeat(0, MSG.MODE_ACTION, { action: ROULETTE_ACTIONS.SHAKE, data: {} }).ok, true);
    const chipsBefore = gr.table.get(0).chips;

    const { spec, mine } = dropAndRejoin(gr, inbox, 'coconutRoulette');

    for (const snap of [spec, mine]) {
      assert.equal(snap.phase, 'playing');
      assert.equal(snap.turnSeat, 0, 'the offline holder still owns the turn');
      assert.equal(snap.bomb.holderSeat, 0);
      assert.equal(snap.bomb.shakes, 1);
      assert.ok(snap.bomb.pExplode > 0);
      assert.equal(snap.seats[0].chips, chipsBefore);
    }

    // The rejoining holder can still act on their held turn.
    assert.equal(gr.actForSeat(0, MSG.MODE_ACTION, { action: ROULETTE_ACTIONS.PASS, data: {} }).ok, true);
    assert.notEqual(engine.inspect().holderSeat, 0);
  } finally {
    gr.destroy();
  }
});

// ---------------------------------------------------------------------------
// Jungle Poker — drop mid-BETTING
// ---------------------------------------------------------------------------

test('junglePoker: drop mid-betting → pot/bet resync, hole cards stay private', () => {
  const { gr, inbox } = makeRoom('junglePoker');
  try {
    gr.start();
    const { engine } = gr;
    assert.equal(engine.phase, 'playing');

    // One raise puts the rotation genuinely mid-flight (everyone owes a response).
    const raiser = engine.turnSeat;
    const res = gr.actForSeat(raiser, MSG.MODE_ACTION, {
      action: POKER_ACTIONS.RAISE,
      data: { amount: 2 },
    });
    assert.equal(res.ok, true, `raise rejected: ${res.code}`);

    const { spec, mine } = dropAndRejoin(gr, inbox, 'junglePoker');

    for (const snap of [spec, mine]) {
      assert.equal(snap.phase, 'playing');
      assert.equal(snap.pot, 4 * POKER_ANTE + 2);
      assert.equal(snap.currentBet, 2);
      assert.equal(snap.raisesUsed, 1);
      assert.equal(typeof snap.seq, 'number');
    }
    assert.equal(spec.yourCards, null);
    assert.equal(mine.yourCards.length, 3, 'rejoiner gets their 3 hole cards back');
    // Viewer-relative toCall: the rejoiner still owes the raise (unless they made it).
    assert.equal(mine.toCall, raiser === 0 ? 0 : 2);

    // The betting rotation continues after the rejoin.
    const caller = engine.turnSeat;
    assert.equal(gr.actForSeat(caller, MSG.MODE_ACTION, { action: POKER_ACTIONS.CALL, data: {} }).ok, true);
  } finally {
    gr.destroy();
  }
});

// ---------------------------------------------------------------------------
// King of the Bar — drop mid-round with an active Bar Rule
// ---------------------------------------------------------------------------

test('kingOfTheBar: drop mid-round → the active Bar Rule rides the resync', () => {
  const { gr, inbox } = makeRoom('kingOfTheBar');
  try {
    gr.start();
    const { engine, table } = gr;
    assert.equal(engine.phase, 'playing');
    const rule = engine.barRule;
    assert.ok(rule?.ruleId, 'a Bar Rule must be active from round 1');

    // A 2-card play is legal under every mutator (happy_hour needs ≥2) —
    // now the resync also has a pending lastPlay to restore.
    const first = engine.turnSeat;
    const cardIds = table.get(first).hand.slice(0, 2).map((c) => c.id);
    assert.equal(gr.actForSeat(first, MSG.PLAY, { cardIds }).ok, true);

    const { spec, mine } = dropAndRejoin(gr, inbox, 'kingOfTheBar');

    for (const snap of [spec, mine]) {
      assert.deepEqual(snap.barRule, { ruleId: rule.ruleId, name: rule.name, desc: rule.desc });
      assert.deepEqual(snap.lastPlay, { seat: first, count: 2 });
    }
    assert.equal(spec.yourHand, null);
    assert.deepEqual(
      mine.yourHand.map((c) => c.id),
      table.get(0).hand.map((c) => c.id)
    );
  } finally {
    gr.destroy();
  }
});

// ---------------------------------------------------------------------------
// Custom Chaos — drop mid-round with host knobs active
// ---------------------------------------------------------------------------

test('customChaos: drop mid-round → host knobs echo in every resync snapshot', () => {
  const knobs = {
    handSize: 4,
    maxPlay: 2,
    startChambers: 6,
    startCoconuts: 2,
    chipsPerMatch: 2,
    chipBonus: 3,
    goldenPerPlayer: 1,
  };
  const { gr, inbox } = makeRoom('customChaos', { knobs });
  try {
    gr.start();
    const { engine, table } = gr;
    assert.equal(engine.phase, 'playing');

    // The knob announcement reached spectators at match start.
    const knobEvt = (inbox.get(SPECTATOR) ?? []).find(
      (e) => e.t === MSG.MODE_EVENT && e.p.kind === 'chaosKnobs'
    );
    assert.deepEqual(knobEvt?.p.knobs, validateKnobs(knobs));

    const first = engine.turnSeat;
    assert.equal(gr.actForSeat(first, MSG.PLAY, { cardIds: [table.get(first).hand[0].id] }).ok, true);

    const { spec, mine } = dropAndRejoin(gr, inbox, 'customChaos');

    for (const snap of [spec, mine]) {
      assert.deepEqual(snap.knobs, validateKnobs(knobs), 'knobs echo in the snapshot');
      // knobs → engine wiring visible in resynced public state
      for (const s of snap.seats) assert.equal(s.chambersLeft, 6);
    }
    assert.equal(spec.yourHand, null);
    assert.deepEqual(
      mine.yourHand.map((c) => c.id),
      table.get(0).hand.map((c) => c.id)
    );
  } finally {
    gr.destroy();
  }
});

// ---------------------------------------------------------------------------
// Cross-mode: a disconnected seat is fallback-driven (no stall, AFK exempt)
// ---------------------------------------------------------------------------

test('all modes: a dropped human never stalls the match — fallback drives the seat', async () => {
  // Fast rooms this time: tiny fallback delay, real (short) deadlines, and
  // rng streams rigged so every shot/shake resolves toward elimination.
  for (const modeId of [
    'monkeyLies',
    'bananaDice',
    'coconutRoulette',
    'junglePoker',
    'kingOfTheBar',
    'customChaos',
  ]) {
    const afkCalls = [];
    let resolveEnd;
    const ended = new Promise((resolve) => {
      resolveEnd = resolve;
    });
    const gr = createGameRoom({
      roomId: `noafk-${modeId}`,
      modeId,
      mapId: 'peeling_parrot',
      turnSeconds: 0.05,
      seatMetas: [
        { playerId: HUMAN, name: 'Human', isBot: false },
        { playerId: 'bot-1', name: 'B1', isBot: true },
        { playerId: 'bot-2', name: 'B2', isBot: true },
        { playerId: 'bot-3', name: 'B3', isBot: true },
      ],
      send: () => {},
      onAfk: (playerId, seat) => afkCalls.push({ playerId, seat }),
      onMatchEnd: resolveEnd,
      seed: 11,
      autoDelayMs: 2,
      engineOverrides: {
        intermissionMs: 5,
        penaltyWindowMs: 10,
        cannonRng: () => 0, // every cannon shot hits
        shakeRng: () => 0, // every roulette shake explodes
        startStack: 3, // poker only: busts arrive fast
      },
    });

    let stallTimer;
    try {
      gr.start();
      gr.setConnected(HUMAN, false); // drop immediately — fallback takes over

      const end = await Promise.race([
        ended,
        new Promise((_, reject) => {
          stallTimer = setTimeout(
            () => reject(new Error(`${modeId}: match stalled after the drop`)),
            20000
          );
        }),
      ]);
      assert.equal(typeof end.winnerSeat, 'number', `${modeId}: no winner`);
      assert.equal(afkCalls.length, 0, `${modeId}: disconnected player must never be AFK-kicked`);
    } finally {
      clearTimeout(stallTimer);
      gr.destroy();
    }
  }
});
