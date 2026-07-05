// Coconut Roulette rules engine (R5) — headless: no sockets, no real timers
// (the harness drives engine.onTimeout itself). Covers registration, action
// legality, the exact probability progression, forced shakes at 0 chips,
// re-arming after a boom, timeout paths, reconnect snapshots (bomb state),
// seeded full-match simulations, and gameRoom integration (modeAction routing
// + the timeout fallback driving brainless bot seats to matchEnd).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import * as roulette from '../src/game/modes/coconutRoulette.js';
import { createEngine, explodeProbability, MODE_ID } from '../src/game/modes/coconutRoulette.js';
import { getEngineFactory, isModePlayable } from '../src/game/modes/index.js';
import { createGameRoom } from '../src/game/gameRoom.js';
import {
  ROULETTE_BASE_P,
  ROULETTE_START_CHIPS,
  ROULETTE_STEP_P,
} from '@monkeybar/shared/constants.js';
import { ROULETTE_ACTIONS, ROULETTE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';
import { ERROR_CODES, MSG } from '@monkeybar/shared/protocol.js';

const { SHAKE, PASS } = ROULETTE_ACTIONS;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeGame({ players = 4, seed = 1, shakeRng } = {}) {
  const table = createTable(
    Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
  );
  const events = [];
  const engine = createEngine({
    table,
    seed,
    shakeRng,
    onEvent: (e) => events.push(e),
  });
  return { table, engine, events };
}

const byType = (events, t) => events.filter((e) => e.t === t);
const modeEvents = (events, kind) =>
  events.filter((e) => e.t === MSG.MODE_EVENT && e.p.kind === kind);

/**
 * Drive a match with a per-seat policy: policy(view) -> 'shake'|'pass'|'timeout'.
 * view = { seat, chips, shakes, pExplode, aliveCount }
 */
function runMatch(game, policy, { maxSteps = 50000 } = {}) {
  const { engine, table } = game;
  if (engine.roundNo === 0) engine.start();
  for (let step = 0; step < maxSteps; step++) {
    if (engine.phase === 'matchEnd') return;
    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const s = table.get(seat);
      // Invariants: the turn is always the alive holder's.
      assert.ok(s.alive, `turn given to dead seat ${seat}`);
      assert.equal(engine.inspect().holderSeat, seat, 'turn seat must hold the coconut');
      assert.ok(s.chips >= 0, `seat ${seat} has negative chips`);
      const view = {
        seat,
        chips: s.chips,
        shakes: engine.inspect().shakes,
        pExplode: engine.inspect().pExplode,
        aliveCount: table.aliveCount(),
      };
      const action = policy(view);
      if (action === 'timeout') {
        assert.equal(engine.onTimeout('turn'), true);
      } else {
        const res = engine.modeAction(seat, action, {});
        assert.ok(res.ok, `${action} by seat ${seat} rejected: ${res.code}`);
      }
    } else if (engine.phase === 'roundEnd') {
      assert.equal(engine.onTimeout('intermission'), true);
    } else {
      assert.fail(`harness stuck in phase ${engine.phase}`);
    }
  }
  assert.fail('match did not terminate within maxSteps');
}

// ---------------------------------------------------------------------------
// Registration (R2 module convention)
// ---------------------------------------------------------------------------

test('module registers a live engine: PLAYABLE, factory, registry truth', () => {
  assert.equal(roulette.MODE_ID, 'coconutRoulette');
  assert.equal(roulette.PLAYABLE, true);
  assert.equal(typeof roulette.createEngine, 'function');
  assert.equal(isModePlayable('coconutRoulette'), true);
  assert.equal(typeof getEngineFactory('coconutRoulette'), 'function');
});

test('explodeProbability follows the exact §B progression, capped at 1', () => {
  for (let k = 0; k <= 20; k++) {
    assert.equal(explodeProbability(k), Math.min(1, ROULETTE_BASE_P + ROULETTE_STEP_P * k));
  }
  assert.equal(explodeProbability(0), 0.08);
  assert.ok(Math.abs(explodeProbability(1) - 0.14) < 1e-12);
  assert.equal(explodeProbability(1000), 1);
});

// ---------------------------------------------------------------------------
// Start: stakes, arming, first turn
// ---------------------------------------------------------------------------

test('start: everyone staked ROULETTE_START_CHIPS, coconut arms at an alive seat', () => {
  const { engine, table, events } = makeGame({ seed: 7 });
  engine.start();

  for (const s of table.seats) assert.equal(s.chips, ROULETTE_START_CHIPS);

  const rs = byType(events, MSG.ROUND_START);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].p.roundNo, 1);
  assert.equal('tableFruit' in rs[0].p, false); // no fruit in this mode
  assert.equal(rs[0].p.seats.length, 4);
  for (const s of rs[0].p.seats) assert.equal(s.chips, ROULETTE_START_CHIPS);

  const holderEvts = modeEvents(events, ROULETTE_EVENTS.HOLDER);
  assert.equal(holderEvts.length, 1);
  assert.deepEqual(holderEvts[0].p, {
    kind: ROULETTE_EVENTS.HOLDER,
    seat: rs[0].p.firstSeat,
    shakes: 0,
    pExplode: ROULETTE_BASE_P,
  });

  const turn = byType(events, MSG.TURN).at(-1);
  assert.equal(turn.p.seat, rs[0].p.firstSeat);
  assert.deepEqual(turn.p.actions, [SHAKE, PASS]);
  assert.equal(turn.p.canCall, false);
  assert.equal(turn.p.lastHolder, false);
  assert.equal(engine.phase, 'playing');
  assert.equal(engine.lastHolderPending, false);
});

// ---------------------------------------------------------------------------
// Action legality
// ---------------------------------------------------------------------------

test('only legal actions are accepted (turn, verb, phase, legacy §3.2 verbs)', () => {
  const { engine, table } = makeGame({ seed: 3, shakeRng: () => 0.99 });
  engine.start();
  const holder = engine.turnSeat;
  const other = (holder + 1) % 4;

  assert.equal(engine.modeAction(other, SHAKE).code, ERROR_CODES.NOT_YOUR_TURN);
  assert.equal(engine.modeAction(other, PASS).code, ERROR_CODES.NOT_YOUR_TURN);
  assert.equal(engine.modeAction(holder, 'juggle').code, ERROR_CODES.BAD_MSG);

  // Legacy Monkey Lies verbs are politely rejected, never crash.
  assert.equal(engine.play(holder, ['x']).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.callLiar(holder).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.useChip(holder).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.fireSelf(holder).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.resolvePenalty().code, ERROR_CODES.BAD_STATE);

  // Explode the holder (rig the roll), then verify roundEnd rejects actions.
  const rigged = makeGame({ seed: 3, shakeRng: () => 0 });
  rigged.engine.start();
  const h2 = rigged.engine.turnSeat;
  assert.equal(rigged.engine.modeAction(h2, SHAKE).ok, true);
  assert.equal(rigged.engine.phase, 'roundEnd');
  assert.equal(rigged.engine.modeAction(h2, SHAKE).code, ERROR_CODES.BAD_STATE);
  void table;
});

// ---------------------------------------------------------------------------
// Shake: survive → +1 chip, keep holding; the odds climb exactly per §B
// ---------------------------------------------------------------------------

test('surviving shakes: +1 chip each, same holder, exact probability progression', () => {
  const rolls = [];
  const { engine, table, events } = makeGame({
    seed: 5,
    shakeRng: () => {
      rolls.push('roll');
      return 0.999; // always survives (p < 1)
    },
  });
  engine.start();
  const holder = engine.turnSeat;

  for (let k = 0; k < 5; k++) {
    // The k-th shake explodes with p = BASE + STEP × k (shakes so far).
    assert.equal(engine.inspect().pExplode, explodeProbability(k));
    const res = engine.modeAction(holder, SHAKE);
    assert.ok(res.ok);
    const evt = modeEvents(events, ROULETTE_EVENTS.SHAKE).at(-1);
    assert.deepEqual(evt.p, {
      kind: ROULETTE_EVENTS.SHAKE,
      seat: holder,
      shakes: k + 1,
      pExplode: explodeProbability(k + 1),
      chips: ROULETTE_START_CHIPS + k + 1,
    });
    // Still the same seat's turn — shake keeps you holding.
    assert.equal(engine.turnSeat, holder);
    assert.equal(byType(events, MSG.TURN).at(-1).p.seat, holder);
  }
  assert.equal(rolls.length, 5);
  assert.equal(table.get(holder).chips, ROULETTE_START_CHIPS + 5);
  assert.equal(byType(events, MSG.ELIMINATED).length, 0);
});

test('explosion fires exactly when roll < p (boundary check on the rigged roll)', () => {
  // Roll fixed at 0.1: first shake p=0.08 → 0.1 ≥ 0.08 survives;
  // second shake p=0.14 → 0.1 < 0.14 explodes. Exact §B progression.
  const { engine, events } = makeGame({ seed: 9, shakeRng: () => 0.1 });
  engine.start();
  const holder = engine.turnSeat;

  assert.equal(engine.modeAction(holder, SHAKE).ok, true); // survives at 0.08
  assert.equal(modeEvents(events, ROULETTE_EVENTS.EXPLODE).length, 0);
  assert.equal(engine.modeAction(holder, SHAKE).ok, true); // explodes at 0.14
  assert.equal(modeEvents(events, ROULETTE_EVENTS.EXPLODE).at(-1).p.seat, holder);
  assert.equal(byType(events, MSG.ELIMINATED).at(-1).p.seat, holder);
  assert.equal(engine.phase, 'roundEnd');
});

// ---------------------------------------------------------------------------
// Pass: pay 1 chip, clockwise hand-off; illegal at 0 chips (forced shake)
// ---------------------------------------------------------------------------

test('pass: −1 chip, coconut moves clockwise, PASS + HOLDER + turn emitted', () => {
  const { engine, table, events } = makeGame({ seed: 11, shakeRng: () => 0.999 });
  engine.start();
  const holder = engine.turnSeat;
  const expectedNext = table.nextAliveSeat(holder);

  assert.equal(engine.modeAction(holder, PASS).ok, true);
  assert.equal(table.get(holder).chips, ROULETTE_START_CHIPS - 1);

  const passEvt = modeEvents(events, ROULETTE_EVENTS.PASS).at(-1);
  assert.deepEqual(passEvt.p, {
    kind: ROULETTE_EVENTS.PASS,
    seat: holder,
    toSeat: expectedNext,
    chips: ROULETTE_START_CHIPS - 1,
  });
  const holderEvt = modeEvents(events, ROULETTE_EVENTS.HOLDER).at(-1);
  assert.deepEqual(holderEvt.p, {
    kind: ROULETTE_EVENTS.HOLDER,
    seat: expectedNext,
    shakes: 0,
    pExplode: ROULETTE_BASE_P,
  });
  assert.equal(engine.turnSeat, expectedNext);
  // Passing does NOT reset the shake counter (it is per-round, not per-holder).
  assert.equal(engine.modeAction(expectedNext, SHAKE).ok, true); // shakes → 1
  assert.equal(engine.modeAction(expectedNext, PASS).ok, true);
  assert.equal(modeEvents(events, ROULETTE_EVENTS.HOLDER).at(-1).p.shakes, 1);
});

test('at 0 chips PASS is illegal and the turn advertises only SHAKE', () => {
  const { engine, table, events } = makeGame({ seed: 13, shakeRng: () => 0.999 });
  engine.start();
  const holder = engine.turnSeat;
  table.get(holder).chips = 0; // stack the deck

  // Server-enforced: broke monkeys cannot pass…
  assert.equal(engine.modeAction(holder, PASS).code, ERROR_CODES.BAD_STATE);
  assert.equal(engine.turnSeat, holder);
  // …and a re-announced turn (via a survived shake) advertises shake-only.
  assert.equal(engine.modeAction(holder, SHAKE).ok, true); // survives, +1 chip
  assert.deepEqual(byType(events, MSG.TURN).at(-2).p.actions, [SHAKE, PASS]); // start turn had chips
  // After the shake the seat has 1 chip again → both verbs return.
  assert.deepEqual(byType(events, MSG.TURN).at(-1).p.actions, [SHAKE, PASS]);

  // Direct check of the shake-only announcement: a survived shake always
  // re-banks a chip, so the only broke turn is RECEIVING the coconut broke.
  const next = table.nextAliveSeat(holder);
  table.get(next).chips = 0;
  assert.equal(engine.modeAction(holder, PASS).ok, true);
  assert.equal(engine.turnSeat, next);
  assert.deepEqual(byType(events, MSG.TURN).at(-1).p.actions, [SHAKE]);
});

// ---------------------------------------------------------------------------
// Timeout paths: pass if legal, else forced shake
// ---------------------------------------------------------------------------

test('turn timeout: passes while a chip is affordable, shakes when broke', () => {
  const { engine, table, events } = makeGame({ seed: 17, shakeRng: () => 0.999 });
  engine.start();
  const holder = engine.turnSeat;
  const next = table.nextAliveSeat(holder);

  // Chips available → timeout = pass.
  assert.equal(engine.onTimeout('turn'), true);
  assert.equal(table.get(holder).chips, ROULETTE_START_CHIPS - 1);
  assert.equal(engine.turnSeat, next);
  assert.equal(modeEvents(events, ROULETTE_EVENTS.PASS).at(-1).p.seat, holder);

  // Broke → timeout = forced shake (survives here, +1 chip).
  table.get(next).chips = 0;
  assert.equal(engine.onTimeout('turn'), true);
  const shakeEvt = modeEvents(events, ROULETTE_EVENTS.SHAKE).at(-1);
  assert.equal(shakeEvt.p.seat, next);
  assert.equal(shakeEvt.p.chips, 1);
  assert.equal(engine.turnSeat, next); // survived → still holding

  // Wrong-phase timeouts are refused.
  assert.equal(engine.onTimeout('intermission'), false);
  assert.equal(engine.onTimeout('bogus'), false);
});

// ---------------------------------------------------------------------------
// Boom → roundEnd → re-arm among survivors, counter reset
// ---------------------------------------------------------------------------

test('after a boom the coconut re-arms among survivors and the odds reset', () => {
  const { engine, table, events } = makeGame({ seed: 19, shakeRng: () => 0.1 });
  engine.start();
  const holder = engine.turnSeat;

  assert.equal(engine.modeAction(holder, SHAKE).ok, true); // survive (p=0.08)
  assert.equal(engine.modeAction(holder, SHAKE).ok, true); // boom (p=0.14)
  assert.equal(table.get(holder).alive, false);
  assert.equal(engine.phase, 'roundEnd');
  assert.deepEqual(engine.getTimer()?.kind, 'intermission');
  assert.equal(engine.snapshotFor(null).bomb, null); // no holder between rounds

  assert.equal(engine.onTimeout('intermission'), true);
  assert.equal(engine.phase, 'playing');
  assert.equal(engine.roundNo, 2);
  const rearm = modeEvents(events, ROULETTE_EVENTS.HOLDER).at(-1);
  assert.notEqual(rearm.p.seat, holder, 'the ghost cannot hold the coconut');
  assert.ok(table.get(rearm.p.seat).alive);
  assert.deepEqual(
    { shakes: rearm.p.shakes, pExplode: rearm.p.pExplode },
    { shakes: 0, pExplode: ROULETTE_BASE_P } // roundEnd reset the shake counter
  );
  assert.equal(engine.inspect().shakes, 0);
});

// ---------------------------------------------------------------------------
// Reconnect snapshots: §10.3 bomb state + per-seat chips
// ---------------------------------------------------------------------------

test('snapshot exposes bomb {holderSeat, shakes, pExplode} and per-seat chips', () => {
  const { engine, table } = makeGame({ seed: 23, shakeRng: () => 0.999 });
  engine.start();
  const holder = engine.turnSeat;
  engine.modeAction(holder, SHAKE); // shakes → 1
  engine.modeAction(holder, SHAKE); // shakes → 2

  const snap = engine.snapshotFor(holder);
  assert.equal(snap.mode, MODE_ID);
  assert.equal(snap.mapId, 'peeling_parrot');
  assert.equal(snap.phase, 'playing');
  assert.equal(snap.roundNo, 1);
  assert.equal(snap.turnSeat, holder);
  assert.equal(snap.yourSeat, holder);
  assert.ok(snap.deadline > Date.now() - 1000);
  assert.deepEqual(snap.bomb, {
    holderSeat: holder,
    shakes: 2,
    pExplode: explodeProbability(2),
  });
  assert.equal(snap.seats.length, 4);
  for (const s of snap.seats) {
    assert.equal(typeof s.chips, 'number');
    assert.equal('hand' in s, false);
    assert.equal(
      s.chips,
      s.seat === holder ? ROULETTE_START_CHIPS + 2 : ROULETTE_START_CHIPS
    );
  }
  // No Monkey Lies fields leak into the roulette snapshot.
  assert.equal('tableFruit' in snap, false);
  assert.equal('yourHand' in snap, false);
  assert.equal('penalty' in snap, false);

  // Spectator view: yourSeat null, same public bomb state.
  const spec = engine.snapshotFor(null);
  assert.equal(spec.yourSeat, null);
  assert.deepEqual(spec.bomb, snap.bomb);
  void table;
});

// ---------------------------------------------------------------------------
// Winner + standings by elimination order
// ---------------------------------------------------------------------------

test('always-explode: one boom per round, last alive wins, standings ordered', () => {
  const { engine, table, events } = makeGame({ seed: 29, shakeRng: () => 0 });
  runMatch(makeShim(engine, table, events), () => 'shake');

  const eliminated = byType(events, MSG.ELIMINATED);
  assert.equal(eliminated.length, 3);
  assert.equal(byType(events, MSG.ROUND_START).length, 3); // one boom per round
  assert.equal(byType(events, MSG.ROUND_END).length, 2); // final boom → matchEnd
  assert.equal(modeEvents(events, ROULETTE_EVENTS.EXPLODE).length, 3);

  const end = byType(events, MSG.MATCH_END)[0].p;
  assert.equal(table.aliveCount(), 1);
  assert.equal(table.get(end.winnerSeat).alive, true);
  assert.equal(end.standings.length, 4);
  assert.deepEqual(end.standings.map((s) => s.place), [1, 2, 3, 4]);
  assert.equal(end.standings[0].seat, end.winnerSeat);
  // First boomed finishes last; last boomed takes 2nd.
  assert.equal(end.standings.at(-1).seat, eliminated[0].p.seat);
  assert.equal(end.standings[1].seat, eliminated.at(-1).p.seat);
});

/** runMatch expects a {engine, table} game shape. */
function makeShim(engine, table, events) {
  return { engine, table, events };
}

// ---------------------------------------------------------------------------
// Seeded full-match simulations (mixed policies) — always terminate cleanly
// ---------------------------------------------------------------------------

test('60 seeded simulations: legal throughout, terminate, sane accounting', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const players = 4 + (seed % 5); // 4..8 seats
    const game = makeGame({ players, seed });
    const policyRng = mulberry32(seed * 31337);
    let chipsSpentOnPasses = 0;
    let chipsEarnedOnShakes = 0;

    runMatch(game, (view) => {
      // Mixed nerve: mostly pass while rich, shake when broke or feeling it.
      if (view.chips <= 0) return 'shake';
      if (policyRng() < 0.25) return 'timeout';
      const shake = policyRng() < 0.5;
      if (shake) return 'shake';
      return 'pass';
    });

    const { events, table, engine } = game;
    assert.equal(engine.phase, 'matchEnd');
    assert.equal(table.aliveCount(), 1);
    assert.equal(byType(events, MSG.ELIMINATED).length, players - 1);
    assert.equal(byType(events, MSG.MATCH_END).length, 1);
    // Chip conservation: start stakes + shake earnings − pass payments.
    for (const e of events) {
      if (e.t !== MSG.MODE_EVENT) continue;
      if (e.p.kind === ROULETTE_EVENTS.PASS) chipsSpentOnPasses++;
      if (e.p.kind === ROULETTE_EVENTS.SHAKE) chipsEarnedOnShakes++;
    }
    const totalChips = table.seats.reduce((n, s) => n + s.chips, 0);
    assert.equal(
      totalChips,
      players * ROULETTE_START_CHIPS + chipsEarnedOnShakes - chipsSpentOnPasses,
      `chip accounting broke on seed ${seed}`
    );
    // Every HOLDER event pointed at a then-alive seat and pExplode matched §B.
    for (const e of modeEvents(events, ROULETTE_EVENTS.HOLDER)) {
      assert.equal(e.p.pExplode, explodeProbability(e.p.shakes));
    }
  }
});

// ---------------------------------------------------------------------------
// gameRoom integration: modeAction routing + fallback drives bot seats
// ---------------------------------------------------------------------------

test('gameRoom: modeAction routes to the engine; timeout fallback finishes a bots-only match', async () => {
  /** @type {Map<string, {t: string, p: Object}[]>} */
  const inbox = new Map();
  const send = (playerId, envelope) => {
    if (!inbox.has(playerId)) inbox.set(playerId, []);
    inbox.get(playerId).push(envelope);
  };
  let resolveEnd;
  const ended = new Promise((r) => (resolveEnd = r));

  const gr = createGameRoom({
    roomId: 'roulette-room',
    modeId: 'coconutRoulette',
    mapId: 'peeling_parrot',
    turnSeconds: 15,
    seatMetas: [
      { playerId: 'human-a', name: 'Ann' },
      { playerId: 'bot-1', name: 'B1', isBot: true },
      { playerId: 'bot-2', name: 'B2', isBot: true },
      { playerId: 'bot-3', name: 'B3', isBot: true },
    ],
    send,
    getSpectatorIds: () => ['spec-1'],
    onMatchEnd: (p) => resolveEnd(p),
    seed: 99,
    autoDelayMs: 2,
    engineOverrides: { intermissionMs: 5 },
  });

  try {
    gr.start();
    // The human acts through the same act() route the net layer uses.
    if (gr.engine.turnSeat === 0) {
      const res = gr.act('human-a', MSG.MODE_ACTION, { action: 'pass', data: {} });
      assert.equal(res.ok, true);
    }
    // Unknown verbs come back as BAD_MSG through the same route.
    assert.equal(
      gr.act('human-a', MSG.MODE_ACTION, { action: 'juggle', data: {} }).ok,
      false
    );
    // Detach the human so the fallback (timeout defaults) drives every seat.
    gr.setConnected('human-a', false);

    const guard = setTimeout(() => resolveEnd(null), 30000);
    const end = await ended;
    clearTimeout(guard);
    assert.ok(end, 'roulette bots-only match did not finish');
    assert.equal(typeof end.winnerSeat, 'number');
    assert.equal(end.standings.length, 4);

    // Spectators got the full public drama, and modeEvents rode the wire.
    const spectator = inbox.get('spec-1') ?? [];
    assert.ok(spectator.some((e) => e.t === MSG.ROUND_START));
    assert.ok(
      spectator.some((e) => e.t === MSG.MODE_EVENT && e.p.kind === ROULETTE_EVENTS.HOLDER)
    );
    assert.ok(
      spectator.some((e) => e.t === MSG.MODE_EVENT && e.p.kind === ROULETTE_EVENTS.EXPLODE)
    );
    assert.ok(spectator.some((e) => e.t === MSG.MATCH_END));
    // Roulette emits no private events — nothing ever targeted `hand`.
    assert.equal(spectator.filter((e) => e.t === MSG.HAND).length, 0);

    // Reconnect snapshot from the room: bomb state is null post-match.
    const snap = gr.snapshotFor('human-a');
    assert.equal(snap.mode, 'coconutRoulette');
    assert.equal(snap.phase, 'matchEnd');
    assert.equal(snap.bomb, null);
  } finally {
    gr.destroy();
  }
});
