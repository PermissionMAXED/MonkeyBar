// Banana Dice bot AI (R4) — the binomial suspicion model, personality
// signatures, and the centerpiece: 100+ headless bot-only matches through the
// REAL engine with brains as seat policies (no sockets, no timers) asserting
// no illegal action ever, no stalls, and no degenerate personality dominator
// (win-rate spread < 35 pp). Plus botManager integration against a real
// bananaDice gameRoom (brains attach via the R2 registry and act through
// MSG.MODE_ACTION).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import { createEngine } from '../src/game/modes/bananaDice.js';
import { createGameRoom, setGameRoomCreatedHook } from '../src/game/gameRoom.js';
import { createBotManager } from '../src/bots/botManager.js';
import { getBrainFactory } from '../src/bots/brains/index.js';
import {
  binomialAtLeast,
  createBrain,
  faceProbability,
} from '../src/bots/brains/bananaDice.js';
import { PERSONALITY_IDS } from '../src/bots/personalities.js';
import { DICE_ACTIONS, DICE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { bidBeats } from '@monkeybar/shared/dice.js';
import { MSG } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

// ---------------------------------------------------------------------------
// Registry wiring (R2 brain convention)
// ---------------------------------------------------------------------------

test('brains/index: bananaDice maps to the real createBrain factory', () => {
  assert.equal(getBrainFactory('bananaDice'), createBrain);
});

// ---------------------------------------------------------------------------
// Binomial core (unit)
// ---------------------------------------------------------------------------

test('binomial model: faceProbability and the tail probability behave', () => {
  assert.equal(faceProbability(1), 1 / 6); // face-1 bids: only the wilds themselves
  for (let f = 2; f <= 6; f++) assert.equal(faceProbability(f), 1 / 3); // face + wild 1s

  assert.equal(binomialAtLeast(0, 10, 1 / 3), 1); // already satisfied
  assert.equal(binomialAtLeast(11, 10, 1 / 3), 0); // impossible
  assert.ok(Math.abs(binomialAtLeast(1, 1, 1 / 3) - 1 / 3) < 1e-12);
  // P(X ≥ 1) = 1 − (2/3)^n grows with n; tails are monotone in `need`.
  const n = 15;
  assert.ok(Math.abs(binomialAtLeast(1, n, 1 / 3) - (1 - Math.pow(2 / 3, n))) < 1e-12);
  for (let need = 1; need <= n; need++) {
    assert.ok(binomialAtLeast(need, n, 1 / 3) <= binomialAtLeast(need - 1, n, 1 / 3) + 1e-12);
  }
  // E[X] = 5 for n=15, p=1/3: the mean bid is roughly a coin flip.
  const atMean = binomialAtLeast(5, 15, 1 / 3);
  assert.ok(atMean > 0.4 && atMean < 0.75, `P(X≥5|n=15) = ${atMean}`);
});

// ---------------------------------------------------------------------------
// Suspicion model (unit) — primed brains, steady rng
// ---------------------------------------------------------------------------

/** Feed a brain a canned 4-player round: seats at 5 dice each + own dice. */
function primeRound(brain, ownDice) {
  brain.observe({
    t: MSG.ROUND_START,
    p: {
      roundNo: 1,
      firstSeat: 0,
      seats: [0, 1, 2, 3].map((s) => ({ seat: s, alive: true, dice: 5 })),
    },
  });
  brain.observe({ t: MSG.MODE_EVENT, p: { kind: DICE_EVENTS.YOUR_DICE, dice: ownDice } });
}

const bidEvt = (seat, count, face) => ({
  t: MSG.MODE_EVENT,
  p: { kind: DICE_EVENTS.BID, seat, count, face },
});

test('suspicion: own dice make bids provably safe; overbids read as lies', () => {
  const steadyRng = () => 0.5; // no memErr trip (0.5 > 0.02), mild noise
  const brain = createBrain({ seat: 0, personalityId: 'mathematical', rng: steadyRng });
  primeRound(brain, [3, 3, 3, 1, 5]); // 4 dice already match face 3 (three 3s + wild 1)

  // A bid of "four 3s" is CERTAIN from this seat's own dice alone.
  brain.observe(bidEvt(1, 4, 3));
  assert.equal(brain.pBidStands({ count: 4, face: 3 }), 1);
  assert.ok(brain.estimateBidFalseProbability() < 0.2);
  assert.equal(brain.wantsChallenge(), false, 'never challenge a bid your own dice satisfy');

  // "Sixteen 3s" needs 12 of the 15 unknown dice to match at p=1/3 — absurd.
  brain.observe(bidEvt(1, 16, 3));
  assert.ok(brain.pBidStands({ count: 16, face: 3 }) < 0.01);
  assert.ok(brain.estimateBidFalseProbability() > 0.7);
  assert.equal(brain.wantsChallenge(), true, 'an absurd overbid must be challenged');
});

test('suspicion: face-1 bids are twice as suspicious (p = 1/6, no wild boost)', () => {
  const brain = createBrain({ seat: 0, personalityId: 'quiet', rng: () => 0.5 });
  primeRound(brain, [2, 3, 4, 5, 6]); // no 1s of our own
  const onFace = brain.pBidStands({ count: 5, face: 4 }); // 1 held + unknowns at 1/3
  const onOnes = brain.pBidStands({ count: 5, face: 1 }); // 0 held + unknowns at 1/6
  assert.ok(onOnes < onFace, `face-1 must stand less often (${onOnes} vs ${onFace})`);
});

test('chooseBid: always legal — beats the current bid within the table total', () => {
  for (const personality of PERSONALITY_IDS) {
    const rng = mulberry32(1234);
    const brain = createBrain({ seat: 0, personalityId: personality, rng });
    primeRound(brain, [2, 2, 6, 1, 4]);
    let cur = null;
    for (let i = 0; i < 200; i++) {
      const pick = brain.chooseBid();
      if (!pick) break; // maxed out — challenge territory
      assert.ok(pick.count >= 1 && pick.count <= 20, `${personality} bid count ${pick.count}`);
      assert.ok(pick.face >= 1 && pick.face <= 6, `${personality} bid face ${pick.face}`);
      if (cur) assert.ok(bidBeats(pick, cur), `${personality}: ${JSON.stringify(pick)} must beat ${JSON.stringify(cur)}`);
      cur = { count: pick.count, face: pick.face };
      brain.observe(bidEvt(1, cur.count, cur.face));
    }
  }
});

test('decideTurn: null when it is not our turn (stale timer safety)', () => {
  const brain = createBrain({ seat: 0, personalityId: 'cautious', rng: () => 0.5 });
  primeRound(brain, [2, 2, 3, 4, 5]);
  assert.equal(brain.decideTurn(), null); // no turn event seen
  brain.observe({ t: MSG.TURN, p: { seat: 2, deadline: 0, actions: ['bid'] } });
  assert.equal(brain.decideTurn(), null); // someone else's turn
  brain.observe({ t: MSG.TURN, p: { seat: 0, deadline: 0, actions: ['bid'] } });
  const action = brain.decideTurn();
  assert.equal(action.type, 'mode');
  assert.equal(action.action, DICE_ACTIONS.BID); // no bid yet → must open
  brain.onOwnActionApplied(action);
  assert.equal(brain.decideTurn(), null, 'commit hook clears the pending turn');
});

test('trollish signature: 5% true-calls — challenges a bid it believes stands', () => {
  // First rng draw hits the trueCallRate window (0.01 < 0.05).
  const brain = createBrain({ seat: 0, personalityId: 'trollish', rng: () => 0.01 });
  primeRound(brain, [4, 4, 4, 1, 1]); // "two 4s" is CERTAIN from own dice
  brain.observe(bidEvt(1, 2, 4));
  assert.equal(brain.wantsChallenge(), true, 'troll must occasionally true-call');
});

test('chip decision reuses chipThreshold: hoarders decline what gamblers accept', () => {
  const prime = (personalityId, chambers) => {
    const brain = createBrain({ seat: 0, personalityId, rng: () => 0.5 });
    brain.primePenalty({ chambers, coconuts: 1, chipUsable: true });
    return brain.decidePenalty();
  };
  // pHit = 1/4 = 0.25: below every threshold → nobody spends.
  assert.deepEqual(prime('cautious', 4), { useChip: false });
  assert.deepEqual(prime('aggressive', 4), { useChip: false });
  // pHit = 1/2 = 0.5: ≥ cautious 0.5 AND ≥ aggressive 0.34 → both spend.
  assert.deepEqual(prime('cautious', 2), { useChip: true });
  assert.deepEqual(prime('aggressive', 2), { useChip: true });
  // pHit = 1/3 ≈ 0.33: aggressive (0.34) just declines, mathematical (0.32) spends.
  assert.deepEqual(prime('mathematical', 3), { useChip: true });
  assert.deepEqual(prime('cautious', 3), { useChip: false });
  // No pending penalty → stale null.
  const stale = createBrain({ seat: 0, personalityId: 'cautious', rng: () => 0.5 });
  assert.equal(stale.decidePenalty(), null);
});

// ---------------------------------------------------------------------------
// The centerpiece: 100+ seeded bot-only matches through the REAL engine
// ---------------------------------------------------------------------------

/**
 * Run one full bot-only match: brains as seat policies over the pure engine.
 * Brains see ONLY their own YOUR_DICE + public events (exactly the per-seat
 * feed a client would get). Every action is legality-checked.
 */
function runBotMatch({ seed, seatPersonalities }) {
  const table = createTable(
    seatPersonalities.map((p, i) => ({ playerId: `bot-${i}`, name: p, isBot: true, personality: p }))
  );
  const brains = seatPersonalities.map((p, i) =>
    createBrain({ seat: i, personalityId: p, rng: mulberry32((seed * 31 + i * 7919) >>> 0) })
  );
  const stats = { decisions: [], reactions: [] };
  const engine = createEngine({
    table,
    seed,
    onEvent: (e) => {
      const envelope = { t: e.t, p: e.p };
      if (e.seat !== undefined) {
        // PRIVATE: only that seat's brain ever sees it (feed parity).
        const r = brains[e.seat].observe(envelope);
        if (r) stats.reactions.push({ seat: e.seat, ...r });
      } else {
        brains.forEach((b, i) => {
          const r = b.observe(envelope);
          if (r) stats.reactions.push({ seat: i, ...r });
        });
      }
    },
  });

  engine.start();
  let steps = 0;
  while (engine.phase !== 'matchEnd') {
    assert.ok(++steps < 20000, `match (seed ${seed}) stalled without a winner`);
    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const hadBid = !!engine.bid;
      const action = brains[seat].decideTurn();
      assert.ok(action, `${seatPersonalities[seat]} returned null on its own turn`);
      assert.equal(action.type, 'mode');
      const held = brains[seat].inspect().myDice.includes(action.data?.face);
      const res = engine.modeAction(seat, action.action, action.data ?? {});
      assert.ok(
        res.ok,
        `ILLEGAL ${action.action} by ${seatPersonalities[seat]} (seed ${seed}): ${res.code} data=${JSON.stringify(action.data)}`
      );
      brains[seat].onOwnActionApplied(action);
      stats.decisions.push({ seat, action: action.action, hadBid, held });
    } else if (engine.phase === 'penalty') {
      const pen = engine.inspect().penalty;
      const decision = brains[pen.seat].decidePenalty();
      assert.ok(decision, `${seatPersonalities[pen.seat]} unaware of its own penalty`);
      if (decision.useChip) {
        assert.ok(table.get(pen.seat).chips > 0, 'brain tried to spend a chip it no longer has');
        const res = engine.useChip(pen.seat);
        assert.ok(res.ok, `ILLEGAL chip by ${seatPersonalities[pen.seat]}: ${res.code}`);
      } else {
        engine.onTimeout('penalty'); // decline: window expires, cannon fires
      }
    } else if (engine.phase === 'roundEnd') {
      engine.onTimeout('intermission');
    } else {
      assert.fail(`harness stuck in phase '${engine.phase}'`);
    }
  }
  return { winnerSeat: engine.winnerSeat, stats };
}

test('240 seeded bot-vs-bot matches: all legal, none stall, win-rate spread < 35 pp', () => {
  // 240 matches (was 120): the same 35pp balance gate, but with half the
  // sampling noise — at N=120 a single archetype's lucky streak could push
  // the observed spread across the boundary while the true spread sits well
  // inside it (asymptotically ~27pp with the face-1-skipping minimalRaise).
  const N = 240;
  const wins = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  const challengeOps = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  const challenges = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  const bidsOnUnheld = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  const bids = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));

  for (let m = 0; m < N; m++) {
    // One seat per archetype; rotate the seating each match to cancel
    // positional (first-seat) bias out of the win-rate comparison.
    const order = PERSONALITY_IDS.map((_, i) => PERSONALITY_IDS[(i + m) % PERSONALITY_IDS.length]);
    const { winnerSeat, stats } = runBotMatch({ seed: 5000 + m, seatPersonalities: order });
    wins[order[winnerSeat]]++;
    for (const d of stats.decisions) {
      const p = order[d.seat];
      if (d.hadBid) {
        challengeOps[p]++;
        if (d.action === DICE_ACTIONS.CHALLENGE) challenges[p]++;
      }
      if (d.action === DICE_ACTIONS.BID) {
        bids[p]++;
        if (!d.held) bidsOnUnheld[p]++;
      }
    }
  }

  // No stalls + all-legal is enforced inside runBotMatch. Now: balance.
  const rates = PERSONALITY_IDS.map((p) => wins[p] / N);
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(
    spread < 0.35,
    `win-rate spread ${(spread * 100).toFixed(1)}pp reaches 35pp: ${JSON.stringify(wins)}`
  );
  for (const p of PERSONALITY_IDS) {
    assert.ok(wins[p] >= 2, `degenerate loser: ${p} won ${wins[p]}/${N} matches`);
  }

  // §5 signatures, in aggregate: Aggressive (callThreshold .45) challenges
  // more readily than Cautious (.75); Aggressive (bluffRate .55) bids unheld
  // faces more than Cautious (.15).
  const challengeRate = (p) => challenges[p] / Math.max(1, challengeOps[p]);
  assert.ok(
    challengeRate('aggressive') > challengeRate('cautious'),
    `aggressive must challenge more (${challengeRate('aggressive').toFixed(3)} vs ${challengeRate('cautious').toFixed(3)})`
  );
  const unheldRate = (p) => bidsOnUnheld[p] / Math.max(1, bids[p]);
  assert.ok(
    unheldRate('aggressive') > unheldRate('cautious'),
    `aggressive must bluff-bid more (${unheldRate('aggressive').toFixed(3)} vs ${unheldRate('cautious').toFixed(3)})`
  );
});

// ---------------------------------------------------------------------------
// botManager integration: brains drive a REAL bananaDice gameRoom
// ---------------------------------------------------------------------------

test('botManager: bananaDice bot seats act via MSG.MODE_ACTION and finish a real match', async () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  process.env.MONKEYBAR_BOT_DELAY_MS = '1'; // near-instant decisions for the test
  const manager = createBotManager({ socialBroadcast: () => {}, rng: mulberry32(7) }).install();
  let gr;
  try {
    const publicEvents = [];
    let resolveEnd;
    const ended = new Promise((r) => (resolveEnd = r));
    gr = createGameRoom({
      roomId: 'dicebots',
      modeId: 'bananaDice',
      mapId: 'peeling_parrot',
      turnSeconds: 15,
      seatMetas: ['aggressive', 'cautious', 'trollish', 'mathematical'].map((p, i) => ({
        playerId: `bot-${i}`,
        name: p,
        isBot: true,
        personality: p,
      })),
      send: () => {},
      onMatchEnd: (p) => resolveEnd(p),
      seed: 21,
      engineOverrides: { intermissionMs: 20, penaltyWindowMs: 1500 },
    });
    gr.subscribeSeat(0, (env) => publicEvents.push(env));
    gr.start();

    const guard = setTimeout(() => resolveEnd(null), 60000);
    const end = await ended;
    clearTimeout(guard);
    assert.ok(end, 'bot-only bananaDice match did not finish within 60 s');
    assert.ok(typeof end.winnerSeat === 'number' && end.winnerSeat >= 0);
    assert.equal(end.standings.length, 4);

    const types = publicEvents.map((e) => e.t);
    assert.ok(types.includes(MSG.MODE_EVENT), 'mode events flowed');
    const kinds = publicEvents.filter((e) => e.t === MSG.MODE_EVENT).map((e) => e.p.kind);
    assert.ok(kinds.includes(DICE_EVENTS.BID), 'brains must bid');
    assert.ok(kinds.includes(DICE_EVENTS.CHALLENGE), 'brains must challenge (the timeout fallback rarely would)');
    assert.ok(kinds.includes(DICE_EVENTS.REVEAL));
  } finally {
    manager.dispose();
    setGameRoomCreatedHook(null);
    gr?.destroy();
    if (prevEnv === undefined) delete process.env.MONKEYBAR_BOT_DELAY_MS;
    else process.env.MONKEYBAR_BOT_DELAY_MS = prevEnv;
  }
});
