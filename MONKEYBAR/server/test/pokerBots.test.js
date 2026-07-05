// Jungle Poker bot brain (R6) — percentile strength model, personality
// thresholds, bluff/blunder signatures, plus the acceptance sweep: 100+
// bots-only matches over the pure engine (every action legality-checked,
// chips conserved every step, brains fed ONLY their own private feed) and a
// botManager + real gameRoom bots-only match to matchEnd.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import { createEngine, RAISE_MAX, RAISE_MIN } from '../src/game/modes/junglePoker.js';
import { createBrain, handPercentile, MODE_ID } from '../src/bots/brains/junglePoker.js';
import { getBrainFactory } from '../src/bots/brains/index.js';
import { createGameRoom, setGameRoomCreatedHook } from '../src/game/gameRoom.js';
import { createBotManager } from '../src/bots/botManager.js';
import { PERSONALITY_IDS } from '../src/bots/personalities.js';
import { POKER_BUST_REFUND } from '@monkeybar/shared/constants.js';
import { POKER_ACTIONS, POKER_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { HAND_CLASSES, POKER_SUITS, evaluateHand } from '@monkeybar/shared/poker.js';
import { MSG } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

const [BANANA, COCONUT, MANGO, GOLDEN] = POKER_SUITS;
const card = (suit, rank, id = `${suit}${rank}`) => ({ id, suit, rank });

/** Hands spanning the class ladder, weakest → strongest. */
const JUNK = [card(BANANA, 2), card(COCONUT, 7), card(MANGO, 4)]; // 7-high, nothing
const PAIR = [card(BANANA, 9), card(COCONUT, 9), card(MANGO, 3)];
const FLUSH = [card(GOLDEN, 2), card(GOLDEN, 9), card(GOLDEN, 13)];
const STRAIGHT = [card(BANANA, 7), card(COCONUT, 8), card(MANGO, 9)];
const STRAIGHT_FLUSH = [card(MANGO, 10), card(MANGO, 11), card(MANGO, 12)];
const TRIO_ACES = [card(BANANA, 14), card(COCONUT, 14), card(MANGO, 14)];

// ---------------------------------------------------------------------------
// Percentile strength model (precomputed distribution — no monte-carlo)
// ---------------------------------------------------------------------------

test('handPercentile: monotone up the class ladder, extremes near 0 and 1', () => {
  const ladder = [JUNK, PAIR, FLUSH, STRAIGHT, STRAIGHT_FLUSH, TRIO_ACES];
  const ps = ladder.map(handPercentile);
  for (let i = 1; i < ps.length; i++) {
    assert.ok(ps[i] > ps[i - 1], `percentile not monotone at step ${i}: ${ps}`);
  }
  assert.ok(ps[0] < 0.2, `7-high junk should be a bottom-fifth hand, got ${ps[0]}`);
  assert.ok(ps.at(-1) > 0.999, `trio of aces beats everything, got ${ps.at(-1)}`);
  for (const p of ps) assert.ok(p > 0 && p <= 1);
});

test('handPercentile: agrees with evaluateHand classes and is tie-symmetric', () => {
  assert.equal(evaluateHand(TRIO_ACES).rankClass, HAND_CLASSES.TRIO);
  assert.equal(evaluateHand(JUNK).rankClass, HAND_CLASSES.HIGH_CARD);
  // Same rank pattern in different suits = the same percentile (ties count half).
  const sameA = [card(BANANA, 5), card(COCONUT, 5), card(MANGO, 12)];
  const sameB = [card(GOLDEN, 5), card(MANGO, 5), card(BANANA, 12)];
  assert.equal(handPercentile(sameA), handPercentile(sameB));
});

// ---------------------------------------------------------------------------
// Brain decision unit tests (synthetic feeds — no engine)
// ---------------------------------------------------------------------------

const brainFor = (personalityId, seedN = 1, seat = 0) =>
  createBrain({ seat, personalityId, rng: mulberry32(seedN) });

/** Feed a synthetic hand state + own turn into a brain via its event stream. */
function primeTurn(brain, { cards, pot = 4, currentBet = 0, toCall = 0, raisesUsed = 0, actions }) {
  const seats = [0, 1, 2, 3].map((s) => ({
    seat: s,
    alive: true,
    stack: 9,
    bet: s === brain.seat ? 0 : currentBet,
    folded: false,
  }));
  brain.observe({ t: MSG.MODE_EVENT, p: { kind: POKER_EVENTS.ANTE, pot, currentBet, raisesUsed, seats } });
  brain.observe({ t: MSG.MODE_EVENT, p: { kind: POKER_EVENTS.YOUR_CARDS, cards } });
  brain.observe({
    t: MSG.TURN,
    p: {
      seat: brain.seat,
      actions: actions ?? [POKER_ACTIONS.FOLD, POKER_ACTIONS.CALL, POKER_ACTIONS.RAISE],
      toCall,
    },
  });
}

test('registry: junglePoker resolves to this brain factory', () => {
  assert.equal(MODE_ID, 'junglePoker');
  assert.equal(getBrainFactory('junglePoker'), createBrain);
});

test('a free look is never folded — every personality checks or raises with junk', () => {
  for (const pid of PERSONALITY_IDS) {
    for (let n = 0; n < 200; n++) {
      const brain = brainFor(pid, n * 7 + 1);
      primeTurn(brain, { cards: JUNK, toCall: 0 });
      const a = brain.decideTurn();
      assert.ok(a, `${pid} returned null on its own turn`);
      assert.equal(a.type, 'mode');
      assert.notEqual(a.action, POKER_ACTIONS.FOLD, `${pid} folded a free look (trial ${n})`);
      if (a.action === POKER_ACTIONS.RAISE) {
        assert.ok(Number.isInteger(a.data.amount), `${pid} raised a non-integer`);
        assert.ok(a.data.amount >= RAISE_MIN && a.data.amount <= RAISE_MAX);
      }
    }
  }
});

test('monsters get raised: trio of aces with a raise available is (almost) always raised', () => {
  for (const pid of PERSONALITY_IDS) {
    let raises = 0;
    const N = 200;
    for (let n = 0; n < N; n++) {
      const brain = brainFor(pid, n * 13 + 3);
      primeTurn(brain, { cards: TRIO_ACES, toCall: 0 });
      if (brain.decideTurn().action === POKER_ACTIONS.RAISE) raises++;
    }
    // Blunders/bluff dithering allowed, but the nuts must usually get value.
    assert.ok(raises / N >= 0.8, `${pid} raised the nuts only ${raises}/${N}`);
  }
});

test('junk facing a big bet folds — cautious folds more than aggressive calls down', () => {
  const foldRate = (pid) => {
    let folds = 0;
    const N = 400;
    for (let n = 0; n < N; n++) {
      const brain = brainFor(pid, n * 31 + 5);
      primeTurn(brain, { cards: JUNK, pot: 7, currentBet: 3, toCall: 3, raisesUsed: 1 });
      if (brain.decideTurn().action === POKER_ACTIONS.FOLD) folds++;
    }
    return folds / N;
  };
  const cautious = foldRate('cautious');
  const aggressive = foldRate('aggressive');
  assert.ok(cautious > 0.85, `cautious kept paying with junk: fold rate ${cautious}`);
  assert.ok(cautious > aggressive, `cautious (${cautious}) must out-fold aggressive (${aggressive})`);
});

test('bluffRate signature: aggressive raises-with-air far more often than cautious', () => {
  const airRaiseRate = (pid) => {
    let raises = 0;
    const N = 600;
    for (let n = 0; n < N; n++) {
      const brain = brainFor(pid, n * 17 + 11);
      primeTurn(brain, { cards: JUNK, toCall: 0 });
      if (brain.decideTurn().action === POKER_ACTIONS.RAISE) raises++;
    }
    return raises / N;
  };
  const agg = airRaiseRate('aggressive');
  const cau = airRaiseRate('cautious');
  assert.ok(agg > cau * 2, `aggressive air-raise ${agg} not >> cautious ${cau}`);
  assert.ok(cau < 0.1, `cautious bluffs too much air: ${cau}`);
});

test('mathematical: near-optimal folds with junk, but the 10% blunder shows up', () => {
  let folds = 0;
  let nonFolds = 0;
  const N = 1000;
  for (let n = 0; n < N; n++) {
    const brain = brainFor('mathematical', n * 41 + 7);
    primeTurn(brain, { cards: JUNK, pot: 7, currentBet: 3, toCall: 3, raisesUsed: 1 });
    if (brain.decideTurn().action === POKER_ACTIONS.FOLD) folds++;
    else nonFolds++;
  }
  assert.ok(folds / N > 0.8, `mathematical must usually fold junk into a bet (${folds}/${N})`);
  assert.ok(nonFolds > 0, 'the 10% deliberate blunder never fired in 1000 trials');
});

test('respects the action menu: no raise decision when raise is not offered', () => {
  for (const pid of PERSONALITY_IDS) {
    for (let n = 0; n < 100; n++) {
      const brain = brainFor(pid, n * 53 + 29);
      primeTurn(brain, {
        cards: TRIO_ACES,
        pot: 8,
        currentBet: 2,
        toCall: 2,
        raisesUsed: 2, // cap reached
        actions: [POKER_ACTIONS.FOLD, POKER_ACTIONS.CALL],
      });
      const a = brain.decideTurn();
      assert.notEqual(a.action, POKER_ACTIONS.RAISE, `${pid} raised when the menu said no`);
    }
  }
});

test('decideTurn is stale-safe: null off-turn, cleared after onOwnActionApplied', () => {
  const brain = brainFor('cautious', 5);
  assert.equal(brain.decideTurn(), null, 'no turn yet');
  primeTurn(brain, { cards: PAIR, toCall: 0 });
  const a = brain.decideTurn();
  assert.ok(a);
  brain.onOwnActionApplied(a);
  assert.equal(brain.decideTurn(), null, 'turn already committed');
  // A turn event for ANOTHER seat must not arm this brain.
  brain.observe({ t: MSG.TURN, p: { seat: 2, actions: [POKER_ACTIONS.FOLD, POKER_ACTIONS.CALL], toCall: 1 } });
  assert.equal(brain.decideTurn(), null);
});

test('decidePenalty: chip spend scales with hit probability; stale-safe', () => {
  const brain = brainFor('cautious', 9);
  assert.equal(brain.decidePenalty(), null, 'no penalty pending');
  brain.observe({ t: MSG.PENALTY, p: { seat: 0, chambers: 6, coconuts: 5, chipUsable: true } });
  assert.deepEqual(brain.decidePenalty(), { useChip: true }, '5/6 hit odds must spend the chip');
  brain.observe({ t: MSG.PENALTY, p: { seat: 0, chambers: 6, coconuts: 1, chipUsable: true } });
  assert.deepEqual(brain.decidePenalty(), { useChip: false }, '1/6 hit odds hoards the chip');
  brain.observe({ t: MSG.PENALTY, p: { seat: 0, chambers: 2, coconuts: 1, chipUsable: false } });
  assert.deepEqual(brain.decidePenalty(), { useChip: false }, 'no chip → never spends');
  brain.observe({ t: MSG.CANNON, p: { seat: 0, hit: false } });
  assert.equal(brain.decidePenalty(), null, 'window resolved');
});

test('primeFromSnapshot: a mid-match takeover picks up cards, pot, and a live turn', () => {
  const brain = brainFor('quiet', 21, 1);
  brain.primeFromSnapshot({
    mode: 'junglePoker',
    roundNo: 3,
    phase: 'playing',
    turnSeat: 1,
    pot: 9,
    toCall: 2,
    currentBet: 2,
    raisesUsed: 1,
    yourCards: STRAIGHT_FLUSH,
    seats: [0, 1, 2, 3].map((s) => ({ seat: s, alive: true, stack: 6, bet: 0, folded: false })),
  });
  const a = brain.decideTurn();
  assert.ok(a, 'primed brain must act on the primed turn');
  assert.notEqual(a.action, POKER_ACTIONS.FOLD, 'a straight flush is never folded for 2');
  const insp = brain.inspect();
  assert.equal(insp.handSize, 3);
  assert.ok(insp.strength > 0.95);
});

// ---------------------------------------------------------------------------
// Bots-only matches over the pure engine (the 100+ acceptance sweep)
// ---------------------------------------------------------------------------

/**
 * One full bots-only match. Brains are fed EXACTLY the per-seat stream a
 * client would get (private events only to their owner). Every decision is
 * legality-checked through the real engine; chips are conserved at every
 * stable step (+POKER_BUST_REFUND per survived bust cannon).
 */
function runBotMatch({ seed, seatPersonalities }) {
  const table = createTable(
    seatPersonalities.map((p, i) => ({ playerId: `bot-${i}`, name: p, isBot: true, personality: p }))
  );
  const brains = seatPersonalities.map((p, i) =>
    createBrain({ seat: i, personalityId: p, rng: mulberry32((seed * 7919 + i * 104729) >>> 0) })
  );
  /** cards each seat legitimately saw (its own YOUR_CARDS feed) */
  const dealt = seatPersonalities.map(() => []);
  const stats = { actions: [], reactions: [], refunds: 0 };

  const engine = createEngine({
    table,
    seed,
    onEvent: (e) => {
      const env = { t: e.t, p: e.p };
      if (e.seat !== undefined) {
        // PRIVATE: only the owning brain ever sees it (anti-cheat by construction).
        if (e.t === MSG.MODE_EVENT && e.p.kind === POKER_EVENTS.YOUR_CARDS) {
          dealt[e.seat] = e.p.cards.map((c) => ({ ...c }));
        }
        const r = brains[e.seat].observe(env);
        if (r) stats.reactions.push({ seat: e.seat, ...r });
      } else {
        if (e.t === MSG.CANNON && !e.p.hit) stats.refunds++;
        for (const b of brains) {
          const r = b.observe(env);
          if (r) stats.reactions.push({ seat: b.seat, ...r });
        }
      }
    },
  });

  const chipTotal = () => {
    const s = engine.inspect();
    let total = s.pot;
    for (const v of s.stacks.values()) total += v;
    return total;
  };

  engine.start();
  const baseline = chipTotal() - stats.refunds * POKER_BUST_REFUND;
  let steps = 0;
  while (engine.phase !== 'matchEnd') {
    assert.ok(++steps < 20000, `match (seed ${seed}) stalled without a winner`);
    assert.equal(
      chipTotal() - stats.refunds * POKER_BUST_REFUND,
      baseline,
      `chips leaked at step ${steps} (seed ${seed})`
    );
    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const action = brains[seat].decideTurn();
      assert.ok(action, `brain at seat ${seat} had no action on its own turn`);
      assert.equal(action.type, 'mode');
      const res = engine.modeAction(seat, action.action, action.data ?? {});
      assert.ok(res.ok, `ILLEGAL ${action.action} by ${seatPersonalities[seat]}: ${res.code}`);
      brains[seat].onOwnActionApplied(action);
      stats.actions.push({
        seat,
        action: action.action,
        amount: action.data?.amount,
        strength: dealt[seat].length === 3 ? handPercentile(dealt[seat]) : 0,
      });
    } else if (engine.phase === 'penalty') {
      const pen = engine.inspect().penalty;
      const decision = brains[pen.seat].decidePenalty();
      assert.ok(decision, `brain at seat ${pen.seat} ignored its own bust window`);
      if (decision.useChip) {
        assert.ok(table.get(pen.seat).chips > 0, 'brain spent a chip it does not have');
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
  assert.equal(table.aliveCount(), 1, 'exactly one monkey standing');
  assert.notEqual(engine.winnerSeat, -1);
  return { winnerSeat: engine.winnerSeat, stats };
}

test('105 bots-only matches: legal, terminating, chips conserved, personalities differ', () => {
  const N = 105; // 15 rotations × 7 seatings — the 100+ acceptance sweep
  const wins = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  const air = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, { raises: 0, turns: 0 }]));
  const folds = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, { folds: 0, turns: 0 }]));
  const reactions = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));

  for (let m = 0; m < N; m++) {
    // One seat per archetype, rotated each match to cancel positional bias.
    const order = PERSONALITY_IDS.map((_, i) => PERSONALITY_IDS[(i + m) % PERSONALITY_IDS.length]);
    const { winnerSeat, stats } = runBotMatch({ seed: 5000 + m, seatPersonalities: order });
    wins[order[winnerSeat]]++;
    for (const a of stats.actions) {
      const p = order[a.seat];
      folds[p].turns++;
      if (a.action === POKER_ACTIONS.FOLD) folds[p].folds++;
      if (a.strength < 0.45) {
        // holding air
        air[p].turns++;
        if (a.action === POKER_ACTIONS.RAISE) air[p].raises++;
      }
    }
    for (const r of stats.reactions) reactions[order[r.seat]]++;
  }

  // Everyone wins sometimes; nobody dominates.
  const rates = PERSONALITY_IDS.map((p) => wins[p] / N);
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(
    spread <= 0.35,
    `win-rate spread ${(spread * 100).toFixed(1)}pp exceeds 35pp: ${JSON.stringify(wins)}`
  );
  for (const p of PERSONALITY_IDS) {
    assert.ok(wins[p] >= 1, `degenerate loser: ${p} won ${wins[p]}/${N} matches`);
  }

  // bluffRate DNA survives real play: aggressive raises air ≫ cautious.
  const airRate = (p) => air[p].raises / Math.max(1, air[p].turns);
  assert.ok(
    airRate('aggressive') - airRate('cautious') >= 0.05,
    `aggressive ${airRate('aggressive').toFixed(3)} vs cautious ${airRate('cautious').toFixed(3)}`
  );

  // callThreshold DNA: cautious folds to pressure more than aggressive.
  const foldRate = (p) => folds[p].folds / Math.max(1, folds[p].turns);
  assert.ok(
    foldRate('cautious') > foldRate('aggressive'),
    `cautious ${foldRate('cautious').toFixed(3)} must out-fold aggressive ${foldRate('aggressive').toFixed(3)}`
  );

  // Chat DNA: Quiet & Mathematical are mute; the table still talks.
  assert.equal(reactions.quiet, 0);
  assert.equal(reactions.mathematical, 0);
  assert.ok(reactions.trollish > 0, 'trollish never reacted across 105 matches');
});

// ---------------------------------------------------------------------------
// botManager against a real gameRoom (real timers, tiny humanized delays)
// ---------------------------------------------------------------------------

function collectLog() {
  const lines = [];
  const mk = (lvl) => (...args) => lines.push(`${lvl} ${args.join(' ')}`);
  const log = { level: 'debug', debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  log.child = () => log;
  log.lines = lines;
  return log;
}

test('botManager: full bots-only Jungle Poker match on a real gameRoom', async () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  process.env.MONKEYBAR_BOT_DELAY_MS = '12';
  const log = collectLog();
  const social = [];
  const manager = createBotManager({
    socialBroadcast: (gameRoom, envelope) => social.push(envelope),
    rng: mulberry32(77),
    log,
  }).install();

  const seatFeed = [];
  let resolveEnd;
  const ended = new Promise((r) => (resolveEnd = r));
  let gr;
  try {
    gr = createGameRoom({
      roomId: 'poker-bots-only',
      modeId: 'junglePoker',
      mapId: 'peeling_parrot',
      turnSeconds: 15,
      seatMetas: PERSONALITY_IDS.map((p, i) => ({
        playerId: `bot-${i}`,
        name: `${p} (bot)`,
        isBot: true,
        personality: p,
      })),
      send: () => {},
      onMatchEnd: (p) => resolveEnd(p),
      seed: 60613,
      engineOverrides: { intermissionMs: 25, penaltyWindowMs: 150 },
    });
    gr.subscribeSeat(0, (env) => seatFeed.push(env)); // public stream + seat 0 privates

    gr.start();
    // generous guard: poker matches run long (10-chip stacks, many hands) and
    // the suite shares the box with other real-timer tests under `npm test`
    const guard = setTimeout(() => resolveEnd(null), 120000);
    const end = await ended;
    clearTimeout(guard);
    assert.ok(end, 'bots-only poker match did not finish within 120 s');
    assert.equal(typeof end.winnerSeat, 'number');
    assert.ok(end.standings.length >= 1);

    const kinds = seatFeed.filter((e) => e.t === MSG.MODE_EVENT).map((e) => e.p.kind);
    assert.ok(kinds.includes(POKER_EVENTS.ANTE), 'no antes seen');
    assert.ok(kinds.includes(POKER_EVENTS.YOUR_CARDS), 'seat 0 never got its cards');
    assert.ok(kinds.includes(POKER_EVENTS.ACTION), 'no betting actions seen');
    assert.ok(kinds.includes(POKER_EVENTS.SHOWDOWN), 'no hand ever resolved');
    assert.ok(seatFeed.some((e) => e.t === MSG.MATCH_END));

    // Brained bots must actually bet — the timeout fallback only checks/folds,
    // so ANY raise proves modeAction routing through botManager works.
    const raises = seatFeed.filter(
      (e) => e.t === MSG.MODE_EVENT && e.p.kind === POKER_EVENTS.ACTION && e.p.action === POKER_ACTIONS.RAISE
    );
    assert.ok(raises.length > 0, 'no bot ever raised — brains are not driving');

    // Personality-keyed social traffic flowed; no engine rejection was logged.
    assert.ok(social.length > 0, 'no social traffic in a 7-personality match');
    assert.deepEqual(log.lines.filter((l) => l.includes('rejected')), []);
    assert.deepEqual(log.lines.filter((l) => l.startsWith('warn')), []);
  } finally {
    manager.dispose();
    setGameRoomCreatedHook(null);
    gr?.destroy();
    if (prevEnv === undefined) delete process.env.MONKEYBAR_BOT_DELAY_MS;
    else process.env.MONKEYBAR_BOT_DELAY_MS = prevEnv;
  }
});
