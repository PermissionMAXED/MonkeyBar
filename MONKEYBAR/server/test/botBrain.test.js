// Bot AI tests — PLAN.md §5.
//
// The centerpiece drives ~200 headless bot-only matches through the REAL
// Monkey Lies engine with BotBrains as seat policies (no sockets, no timers)
// and asserts: no illegal action ever, no stalls (every match ends with a
// winner), no degenerate personality dominator (win-rate spread ≤ 35 pp),
// Cautious bluffs measurably less than Aggressive, and bots never reference
// cards they can't see. Plus unit tests for the §5 parameter table, the
// suspicion model, signature behaviors, the Cautious disconnect-hold policy,
// and botManager integration against a real gameRoom (host-added bots and
// seats converted from disconnected players).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import { createMonkeyLiesEngine } from '../src/game/modes/monkeyLies.js';
import { createGameRoom, setGameRoomCreatedHook } from '../src/game/gameRoom.js';
import { createSessions, fallbackAutoPlayPolicy } from '../src/net/sessions.js';
import { createBotBrain, createAutoPlayPolicy } from '../src/bots/botBrain.js';
import { createBotManager } from '../src/bots/botManager.js';
import { CHATTY, PERSONALITIES, PERSONALITY_IDS, getPersonality } from '../src/bots/personalities.js';
import { BOT_PERSONALITIES } from '../src/lobby/room.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';
import { cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { EMOTES, QUICK_PHRASES } from '@monkeybar/shared/emotes.js';
import { MSG } from '@monkeybar/shared/protocol.js';

// ---------------------------------------------------------------------------
// §5 parameter table (personalities.js)
// ---------------------------------------------------------------------------

test('personalities: the 7 archetypes carry the exact §5 table values', () => {
  // Same ids the lobby (room.js) tags bot seats with.
  assert.deepEqual(PERSONALITY_IDS, [...BOT_PERSONALITIES]);

  const p = PERSONALITIES;
  // Aggressive | 0.55 | 0.45 | high | 0.15 | med
  assert.equal(p.aggressive.bluffRate, 0.55);
  assert.equal(p.aggressive.callThreshold, 0.45);
  assert.equal(p.aggressive.memErr, 0.15);
  assert.equal(p.aggressive.chatty, CHATTY.MED);
  assert.equal(p.aggressive.playSizeStyle, 'slam'); // slams 3-card plays
  // Cautious | 0.15 | 0.75 | low | 0.10 | low
  assert.equal(p.cautious.bluffRate, 0.15);
  assert.equal(p.cautious.callThreshold, 0.75);
  assert.equal(p.cautious.memErr, 0.1);
  assert.equal(p.cautious.chatty, CHATTY.LOW);
  assert.equal(p.cautious.playSizeStyle, 'single'); // 1-card truths
  assert.ok(p.cautious.chipThreshold >= 0.5); // hoards chip
  // Chaotic | 0.50 ±0.30/round | 0.55 ±0.25 | random | 0.30 | high
  assert.equal(p.chaotic.bluffRate, 0.5);
  assert.equal(p.chaotic.callThreshold, 0.55);
  assert.deepEqual(p.chaotic.reroll, { bluffJitter: 0.3, callJitter: 0.25 });
  assert.equal(p.chaotic.risk, 'random');
  assert.equal(p.chaotic.memErr, 0.3);
  assert.equal(p.chaotic.chatty, CHATTY.HIGH);
  // Mathematical | derived from EV | 0.60 exact | med | 0.02 | none
  assert.equal(p.mathematical.bluffRate, 'ev');
  assert.equal(p.mathematical.callThreshold, 0.6);
  assert.equal(p.mathematical.memErr, 0.02);
  assert.equal(p.mathematical.chatty, CHATTY.NONE);
  assert.equal(p.mathematical.blunderRate, 0.1); // 10% deliberate blunder
  assert.equal(p.mathematical.evenDelays, true); // even, metronomic delays
  // Emotional | 0.35 base | 0.60 base | med | 0.15 | high
  assert.equal(p.emotional.bluffRate, 0.35);
  assert.equal(p.emotional.callThreshold, 0.6);
  assert.equal(p.emotional.memErr, 0.15);
  assert.equal(p.emotional.chatty, CHATTY.HIGH);
  assert.ok(p.emotional.tilt); // tilt state on survive/caught
  // Trollish | 0.60 | 0.50 | high | 0.20 | max
  assert.equal(p.trollish.bluffRate, 0.6);
  assert.equal(p.trollish.callThreshold, 0.5);
  assert.equal(p.trollish.memErr, 0.2);
  assert.equal(p.trollish.chatty, CHATTY.MAX);
  assert.equal(p.trollish.trueCallRate, 0.05); // 5% true-call trolling
  assert.equal(p.trollish.emoteSpam, true);
  // Quiet | 0.30 | 0.62 | med | 0.05 | none
  assert.equal(p.quiet.bluffRate, 0.3);
  assert.equal(p.quiet.callThreshold, 0.62);
  assert.equal(p.quiet.memErr, 0.05);
  assert.equal(p.quiet.chatty, CHATTY.NONE); // zero chat

  // Every reaction table entry references only real catalog ids.
  const emoteIds = new Set(EMOTES.map((e) => e.id));
  const phraseIds = new Set(QUICK_PHRASES.map((q) => q.id));
  for (const persona of Object.values(PERSONALITIES)) {
    for (const entry of Object.values(persona.reactions)) {
      for (const id of entry.emotes ?? []) assert.ok(emoteIds.has(id), `unknown emote '${id}'`);
      for (const id of entry.phrases ?? []) assert.ok(phraseIds.has(id), `unknown phrase '${id}'`);
    }
  }
  assert.equal(getPersonality('nope').id, 'cautious'); // unknown tags fall back
});

// ---------------------------------------------------------------------------
// Suspicion model (unit)
// ---------------------------------------------------------------------------

/** Feed a brain a canned 4-player round: own hand + roundStart. */
function primeRound(brain, ownFruits, tableFruit) {
  brain.observe({ t: MSG.HAND, p: { cards: ownFruits.map((fruit, i) => ({ id: `h${i}`, fruit })) } });
  brain.observe({
    t: MSG.ROUND_START,
    p: {
      roundNo: 1,
      tableFruit,
      firstSeat: 0,
      seats: [0, 1, 2, 3].map((s) => ({ seat: s, alive: true, handCount: 5 })),
    },
  });
}

test('suspicion model: play size, own-hand feasibility, and reveals drive P(lie)', () => {
  const steadyRng = () => 0.99; // never trips memErr, never bluffs/blunders
  const mk = () => createBotBrain({ seat: 0, personalityId: 'mathematical', rng: steadyRng });

  // Holding all 5 bananas (table fruit) leaves only 3 truthy cards unseen
  // (4-player deck: 6 banana + 2 golden). Big claims get very suspicious.
  const brain = mk();
  primeRound(brain, ['banana', 'banana', 'banana', 'banana', 'banana'], 'banana');
  brain.observe({ t: MSG.PLAYED, p: { seat: 1, count: 1, handCount: 4 } });
  const p1 = brain.estimateLieProbability();
  brain.observe({ t: MSG.PLAYED, p: { seat: 1, count: 3, handCount: 1 } });
  const p3 = brain.estimateLieProbability();
  assert.ok(p3 > p1 + 0.15, `3-card plays must skew toward lies (${p1} vs ${p3})`);

  // Same 3-card play looks safer when the bot's own hand holds no table fruit.
  const poorHand = mk();
  primeRound(poorHand, ['mango', 'mango', 'coconut', 'mango', 'coconut'], 'banana');
  poorHand.observe({ t: MSG.PLAYED, p: { seat: 1, count: 3, handCount: 2 } });
  assert.ok(
    poorHand.estimateLieProbability() < p3 - 0.1,
    'feasibility must use the own hand: fewer truths seen ⇒ less suspicion'
  );

  // Hard bound: with reveals this round accounted for, an infeasible claim is
  // a certain lie (5 truthy in hand + 2 revealed = all 8 accounted for).
  const certain = mk();
  primeRound(certain, ['banana', 'banana', 'banana', 'banana', 'golden'], 'banana');
  certain.observe({
    t: MSG.REVEAL,
    p: {
      targetSeat: 2,
      cards: [{ id: 'r0', fruit: 'banana' }, { id: 'r1', fruit: 'banana' }, { id: 'r2', fruit: 'golden' }],
      lie: false,
      loserSeat: 3,
    },
  });
  certain.observe({ t: MSG.PLAYED, p: { seat: 1, count: 1, handCount: 4 } });
  assert.equal(certain.estimateLieProbability(), 1);

  // Per-opponent bluff prior: two brains with identical feasibility knowledge,
  // one watched seat 1 lie 4 times, the other watched it tell 4 truths.
  const [wary, trusting] = [mk(), mk()];
  for (const [brain, lie] of [[wary, true], [trusting, false]]) {
    primeRound(brain, ['mango', 'mango', 'coconut', 'mango', 'coconut'], 'banana');
    for (let i = 0; i < 4; i++) {
      brain.observe({
        t: MSG.REVEAL,
        p: { targetSeat: 1, cards: [{ id: `x${i}`, fruit: 'mango' }], lie, loserSeat: 1 },
      });
    }
    brain.observe({ t: MSG.PLAYED, p: { seat: 1, count: 2, handCount: 3 } });
  }
  assert.ok(
    wary.estimateLieProbability() > trusting.estimateLieProbability() + 0.1,
    'per-opponent bluff prior must track observed reveals'
  );
});

// ---------------------------------------------------------------------------
// Signature behaviors (unit)
// ---------------------------------------------------------------------------

test('signatures: cautious 1-card truths, aggressive 3-card slams, trollish true-calls, chaotic re-rolls', () => {
  // Cautious: single truthful card, exact fruit before the wild golden.
  const cautious = createBotBrain({ seat: 0, personalityId: 'cautious', rng: () => 0.99 });
  primeRound(cautious, ['golden', 'banana', 'mango', 'coconut', 'mango'], 'banana');
  cautious.observe({ t: MSG.TURN, p: { seat: 0, deadline: 0, canCall: false } });
  const cPlay = cautious.decideTurn();
  assert.deepEqual(cPlay, { type: 'play', cardIds: ['h1'] }); // the banana, not the golden

  // Aggressive: slams a 3-card play when it has the cards.
  const aggressive = createBotBrain({ seat: 0, personalityId: 'aggressive', rng: () => 0.6 });
  primeRound(aggressive, ['banana', 'banana', 'banana', 'golden', 'mango'], 'banana');
  aggressive.observe({ t: MSG.TURN, p: { seat: 0, deadline: 0, canCall: false } });
  const aPlay = aggressive.decideTurn();
  assert.equal(aPlay.type, 'play');
  assert.equal(aPlay.cardIds.length, 3);

  // Trollish: the 5% true-call troll fires even on a perfectly plausible play.
  const troll = createBotBrain({ seat: 0, personalityId: 'trollish', rng: () => 0.01 });
  primeRound(troll, ['mango', 'mango', 'coconut', 'mango', 'coconut'], 'banana');
  troll.observe({ t: MSG.PLAYED, p: { seat: 3, count: 1, handCount: 4 } });
  troll.observe({ t: MSG.TURN, p: { seat: 0, deadline: 0, canCall: true } });
  assert.deepEqual(troll.decideTurn(), { type: 'call' });

  // Chaotic: parameters re-roll every round within the §5 jitter bands.
  const chaotic = createBotBrain({ seat: 0, personalityId: 'chaotic', rng: mulberry32(7) });
  const seen = new Set();
  for (let r = 0; r < 6; r++) {
    primeRound(chaotic, ['banana', 'banana', 'mango', 'coconut', 'mango'], 'banana');
    const dyn = chaotic.inspect().dyn;
    assert.ok(dyn.bluffRate >= 0.2 - 1e-9 && dyn.bluffRate <= 0.8 + 1e-9, `bluffRate ${dyn.bluffRate}`);
    assert.ok(dyn.callThreshold >= 0.3 - 1e-9 && dyn.callThreshold <= 0.8 + 1e-9);
    seen.add(dyn.bluffRate.toFixed(4));
  }
  assert.ok(seen.size >= 4, 'chaotic must actually re-roll per round');

  // Quiet & Mathematical: zero chat — reactions never fire.
  for (const id of ['quiet', 'mathematical']) {
    const silent = createBotBrain({ seat: 0, personalityId: id, rng: () => 0 });
    primeRound(silent, ['banana', 'banana', 'mango', 'coconut', 'mango'], 'banana');
    assert.equal(silent.observe({ t: MSG.CANNON, p: { seat: 0, hit: false } }), null);
    assert.equal(silent.observe({ t: MSG.MATCH_END, p: { winnerSeat: 0, standings: [] } }), null);
  }
  // Trollish reacts loudly (rng 0 ⇒ reaction always rolls, first candidates).
  const loud = createBotBrain({ seat: 0, personalityId: 'trollish', rng: () => 0 });
  primeRound(loud, ['banana', 'banana', 'mango', 'coconut', 'mango'], 'banana');
  const reaction = loud.observe({ t: MSG.CANNON, p: { seat: 0, hit: false } });
  assert.equal(reaction.key, 'surviveShot');
  assert.ok(reaction.emoteId);
});

test('emotional tilt: getting caught raises bluffing and lowers the call bar', () => {
  const rng = () => 0.99;
  const brain = createBotBrain({ seat: 0, personalityId: 'emotional', rng });
  primeRound(brain, ['banana', 'banana', 'mango', 'coconut', 'mango'], 'banana');
  assert.equal(brain.inspect().tilt, 0);
  // Own bluff called out (target=me, lie) — tilt spikes.
  brain.observe({ t: MSG.CALLED, p: { callerSeat: 2, targetSeat: 0 } });
  brain.observe({
    t: MSG.REVEAL,
    p: { targetSeat: 0, cards: [{ id: 'z', fruit: 'mango' }], lie: true, loserSeat: 0 },
  });
  const tilted = brain.inspect().tilt;
  assert.ok(tilted > 0.3, `tilt after getting caught: ${tilted}`);
  // Surviving a shot tilts further (§5: tilt state on survive/caught).
  brain.observe({ t: MSG.CANNON, p: { seat: 0, hit: false } });
  assert.ok(brain.inspect().tilt > tilted);
  // Tilt cools at the next round start.
  primeRound(brain, ['banana', 'banana', 'mango', 'coconut', 'mango'], 'banana');
  assert.ok(brain.inspect().tilt < tilted);
});

test('chip decision: risk-based and personality-scaled within the penalty window', () => {
  const decide = (personalityId, chambers) => {
    const brain = createBotBrain({ seat: 0, personalityId, rng: () => 0.99 });
    brain.primePenalty({ chambers, coconuts: 1, chipUsable: true });
    return brain.decidePenalty().useChip;
  };
  // Cautious hoards: keeps the chip at comfortable odds, spends when grim.
  assert.equal(decide('cautious', 6), false);
  assert.equal(decide('cautious', 3), false);
  assert.equal(decide('cautious', 2), true);
  assert.equal(decide('cautious', 1), true);
  // Mathematical spends earlier — the EV gain is largest at few chambers.
  assert.equal(decide('mathematical', 6), false);
  assert.equal(decide('mathematical', 3), true);
  // No chip pending / not usable → never claims to use one.
  const broke = createBotBrain({ seat: 0, personalityId: 'aggressive', rng: () => 0.99 });
  broke.primePenalty({ chambers: 1, coconuts: 1, chipUsable: false });
  assert.deepEqual(broke.decidePenalty(), { useChip: false });
  assert.equal(createBotBrain({ seat: 0, personalityId: 'aggressive' }).decidePenalty(), null);
});

// ---------------------------------------------------------------------------
// Cautious disconnect-hold auto-play policy (sessions.setAutoPlayPolicy)
// ---------------------------------------------------------------------------

test('cautious auto-play policy: single truths, never calls, hoards the chip sensibly', () => {
  const policy = createAutoPlayPolicy('cautious');
  const hand = [
    { id: 'a', fruit: 'coconut' },
    { id: 'b', fruit: 'golden' },
    { id: 'c', fruit: 'banana' },
  ];
  assert.deepEqual(policy.chooseTimeoutPlay({ hand, tableFruit: 'banana' }), ['c']); // exact first
  assert.deepEqual(policy.chooseTimeoutPlay({ hand, tableFruit: 'mango' }), ['b']); // then wild
  const noTruth = [{ id: 'x', fruit: 'coconut' }, { id: 'y', fruit: 'banana' }];
  const picked = policy.chooseTimeoutPlay({ hand: noTruth, tableFruit: 'mango', rng: () => 0.9 });
  assert.equal(picked.length, 1); // forced: one random card, still never calls
  assert.ok(noTruth.some((c) => c.id === picked[0]));

  // Chip: hoarded until the hit odds reach the Cautious threshold (0.5).
  assert.equal(policy.choosePenaltyChip({ chips: 1, chambersLeft: 6, coconuts: 1 }), false);
  assert.equal(policy.choosePenaltyChip({ chips: 1, chambersLeft: 2, coconuts: 1 }), true);
  assert.equal(policy.choosePenaltyChip({ chips: 1, chambersLeft: 1, coconuts: 1 }), true);
  assert.equal(policy.choosePenaltyChip({ chips: 0, chambersLeft: 1, coconuts: 1 }), false);
  // …unlike P2's never-spend fallback at certain doom:
  assert.equal(fallbackAutoPlayPolicy.choosePenaltyChip({ chips: 1, chambersLeft: 1, coconuts: 1 }), false);
});

// ---------------------------------------------------------------------------
// ~200 headless bot-only matches through the real engine
// ---------------------------------------------------------------------------

/**
 * Run one full bot-only match: BotBrains as seat policies over the pure
 * engine. Brains see ONLY their own `hand` + public events (exactly the
 * per-seat feed a client would get). Every action is legality-checked.
 */
function runBotMatch({ seed, seatPersonalities }) {
  const table = createTable(
    seatPersonalities.map((p, i) => ({ playerId: `bot-${i}`, name: p, isBot: true, personality: p }))
  );
  const brains = seatPersonalities.map((p, i) =>
    createBotBrain({ seat: i, personalityId: p, rng: mulberry32((seed * 7919 + i * 104729) >>> 0) })
  );
  /** Cards each seat has legitimately been dealt (its own `hand` events). */
  const dealt = seatPersonalities.map(() => new Set());
  const stats = { plays: [], calls: [], reactions: [], nullTurns: 0 };

  const engine = createMonkeyLiesEngine({
    table,
    seed,
    onEvent: (e) => {
      const env = { t: e.t, p: e.p };
      if (e.seat !== undefined) {
        // PRIVATE (`hand`): only the owning brain ever sees it.
        if (e.t === MSG.HAND) for (const c of e.p.cards) dealt[e.seat].add(c.id);
        const r = brains[e.seat].observe(env);
        if (r) stats.reactions.push({ seat: e.seat, ...r });
      } else {
        for (const b of brains) {
          const r = b.observe(env);
          if (r) stats.reactions.push({ seat: b.seat, ...r });
        }
      }
    },
  });

  engine.start();
  let steps = 0;
  while (engine.phase !== 'matchEnd') {
    assert.ok(++steps < 5000, `match (seed ${seed}) stalled without a winner`);
    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const action = brains[seat].decideTurn();
      assert.ok(action, `brain at seat ${seat} had no action on its own turn`);
      if (action.type === 'call') {
        const target = engine.lastPlay.seat;
        const cardsUnderClaim = engine.inspect().lastPlayCards;
        const res = engine.callLiar(seat);
        assert.ok(res.ok, `ILLEGAL call by ${seatPersonalities[seat]}: ${res.code}`);
        brains[seat].onOwnActionApplied(action);
        stats.calls.push({
          seat,
          target,
          wasLie: !cardsUnderClaim.every((c) => cardMatchesTableFruit(c, engine.tableFruit)),
        });
      } else {
        // Anti-cheat: every played id must come from this seat's own deals.
        for (const id of action.cardIds) {
          assert.ok(dealt[seat].has(id), `${seatPersonalities[seat]} referenced a card it never saw`);
        }
        const handBefore = table.get(seat).hand.slice();
        const res = engine.play(seat, action.cardIds);
        assert.ok(res.ok, `ILLEGAL play by ${seatPersonalities[seat]}: ${res.code}`);
        brains[seat].onOwnActionApplied(action);
        const cards = action.cardIds.map((id) => handBefore.find((c) => c.id === id));
        stats.plays.push({
          seat,
          count: cards.length,
          lie: !cards.every((c) => cardMatchesTableFruit(c, engine.tableFruit)),
          hadTruth: handBefore.some((c) => cardMatchesTableFruit(c, engine.tableFruit)),
        });
      }
    } else if (engine.phase === 'penalty') {
      const pen = engine.inspect().penalty;
      const decision = brains[pen.seat].decidePenalty();
      assert.ok(decision, `brain at seat ${pen.seat} ignored its own penalty window`);
      if (decision.useChip) {
        assert.ok(table.get(pen.seat).chips > 0, 'brain tried to spend a chip it no longer has');
        const res = engine.useChip(pen.seat);
        assert.ok(res.ok, `ILLEGAL chip by ${seatPersonalities[pen.seat]}: ${res.code}`);
      } else {
        engine.onTimeout('penalty'); // decline: the window expires, cannon fires
      }
    } else if (engine.phase === 'roundEnd') {
      engine.onTimeout('intermission');
    } else {
      assert.fail(`harness stuck in phase '${engine.phase}'`);
    }
  }
  assert.equal(table.aliveCount(), 1, 'match must end with exactly one monkey standing');
  assert.notEqual(engine.winnerSeat, -1);
  return { winnerSeat: engine.winnerSeat, stats };
}

test('200 bot-only matches: legal, terminating, no dominator, personalities differ', () => {
  const N = 200;
  const wins = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  const bluff = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, { lies: 0, plays: 0 }]));
  const calls = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, { total: 0, trueCalls: 0 }]));
  const reactions = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));

  for (let m = 0; m < N; m++) {
    // One seat per archetype; rotate the seating each match to cancel
    // positional (first-seat) bias out of the win-rate comparison.
    const order = PERSONALITY_IDS.map((_, i) => PERSONALITY_IDS[(i + m) % PERSONALITY_IDS.length]);
    const { winnerSeat, stats } = runBotMatch({ seed: 1000 + m, seatPersonalities: order });
    wins[order[winnerSeat]]++;
    for (const pl of stats.plays) {
      if (!pl.hadTruth) continue; // forced lies say nothing about bluffing appetite
      bluff[order[pl.seat]].plays++;
      if (pl.lie) bluff[order[pl.seat]].lies++;
    }
    for (const c of stats.calls) {
      calls[order[c.seat]].total++;
      if (!c.wasLie) calls[order[c.seat]].trueCalls++;
    }
    for (const r of stats.reactions) reactions[order[r.seat]]++;
  }

  // No stalls + all-legal is enforced inside runBotMatch. Now: balance.
  const rates = PERSONALITY_IDS.map((p) => wins[p] / N);
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(
    spread <= 0.35,
    `win-rate spread ${(spread * 100).toFixed(1)}pp exceeds 35pp: ${JSON.stringify(wins)}`
  );
  for (const p of PERSONALITY_IDS) {
    assert.ok(wins[p] >= 2, `degenerate loser: ${p} won ${wins[p]}/${N} matches`);
  }

  // Cautious bluffs measurably less than Aggressive (given a truthful option).
  const rate = (p) => bluff[p].lies / Math.max(1, bluff[p].plays);
  assert.ok(
    rate('aggressive') - rate('cautious') >= 0.15,
    `aggressive ${rate('aggressive').toFixed(3)} vs cautious ${rate('cautious').toFixed(3)}`
  );
  assert.ok(rate('cautious') < 0.3, `cautious bluff rate too high: ${rate('cautious')}`);

  // Everybody calls sometimes; Trollish trolls true plays now and then.
  for (const p of PERSONALITY_IDS) assert.ok(calls[p].total > 0, `${p} never called`);
  assert.ok(calls.trollish.trueCalls > 0, 'trollish never true-call trolled');

  // Chat DNA: Quiet & Mathematical are mute, Trollish out-spams everyone.
  assert.equal(reactions.quiet, 0);
  assert.equal(reactions.mathematical, 0);
  for (const p of PERSONALITY_IDS) {
    if (p === 'trollish') continue;
    assert.ok(reactions.trollish > reactions[p], `trollish (${reactions.trollish}) must out-spam ${p}`);
  }
  assert.ok(reactions.cautious > 0, 'even the quiet-ish archetypes chat a little');
});

// ---------------------------------------------------------------------------
// botManager against a real gameRoom (real timers, humanized-but-tiny delays)
// ---------------------------------------------------------------------------

function collectLog() {
  const lines = [];
  const mk = (lvl) => (...args) => lines.push(`${lvl} ${args.join(' ')}`);
  const log = { level: 'debug', debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  log.child = () => log;
  log.lines = lines;
  return log;
}

test('botManager: drives a full bots-only match on a real gameRoom (host-added bots path)', async () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  process.env.MONKEYBAR_BOT_DELAY_MS = '12'; // tiny humanized delays for CI
  const log = collectLog();
  const social = [];
  const manager = createBotManager({
    socialBroadcast: (gameRoom, envelope) => social.push(envelope),
    rng: mulberry32(11),
    log,
  }).install(); // registers the real gameRoom-created hook

  const publicEvents = [];
  let resolveEnd;
  const ended = new Promise((r) => (resolveEnd = r));
  let gr;
  try {
    gr = createGameRoom({
      roomId: 'bots-only',
      modeId: 'monkeyLies',
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
      seed: 4242,
      engineOverrides: { intermissionMs: 25, penaltyWindowMs: 150 },
    });
    gr.subscribeSeat(0, (env) => publicEvents.push(env)); // public stream + seat 0's hand

    gr.start();
    const guard = setTimeout(() => resolveEnd(null), 60000);
    const end = await ended;
    clearTimeout(guard);
    assert.ok(end, 'bots-only match did not finish within 60 s');
    assert.equal(typeof end.winnerSeat, 'number');
    assert.ok(end.standings.length >= 1);

    const types = publicEvents.map((e) => e.t);
    assert.ok(types.includes(MSG.PLAYED));
    assert.ok(types.includes(MSG.CALLED), 'brained bots must actually call (fallback never does)');
    assert.ok(types.includes(MSG.CANNON));
    assert.ok(types.includes(MSG.MATCH_END));

    // Personality-keyed social traffic went out through the broadcast hook.
    assert.ok(social.some((e) => e.t === MSG.EMOTE), 'no emotes fired');
    assert.ok(social.some((e) => e.t === MSG.QUICK_PHRASE), 'no quick phrases fired');
    for (const e of social) {
      assert.ok(e.p.seat >= 0 && e.p.seat < PERSONALITY_IDS.length);
    }
    // No bot action was ever rejected by the engine.
    assert.deepEqual(log.lines.filter((l) => l.includes('rejected')), []);
    assert.deepEqual(log.lines.filter((l) => l.startsWith('warn')), []);
  } finally {
    manager.dispose(); // clears the global hook + timers
    setGameRoomCreatedHook(null);
    gr?.destroy();
    if (prevEnv === undefined) delete process.env.MONKEYBAR_BOT_DELAY_MS;
    else process.env.MONKEYBAR_BOT_DELAY_MS = prevEnv;
  }
});

test('botManager: seats converted from disconnected players get real brains (sessions hook path)', async () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  process.env.MONKEYBAR_BOT_DELAY_MS = '12';
  const log = collectLog();
  const sessions = createSessions({ log });
  const manager = createBotManager({ sessions, socialBroadcast: () => {}, rng: mulberry32(3), log }).install();

  // The install() must have upgraded the §3.4 hold policy to Cautious…
  const policy = sessions.getAutoPlayPolicy();
  assert.notEqual(policy, fallbackAutoPlayPolicy);
  assert.equal(policy.choosePenaltyChip({ chips: 1, chambersLeft: 1, coconuts: 1 }), true);
  assert.deepEqual(
    policy.chooseTimeoutPlay({
      hand: [{ id: 'k1', fruit: 'coconut' }, { id: 'k2', fruit: 'banana' }],
      tableFruit: 'banana',
    }),
    ['k2']
  );

  const publicEvents = [];
  let resolveEnd;
  const ended = new Promise((r) => (resolveEnd = r));
  let gr;
  try {
    gr = createGameRoom({
      roomId: 'abandoned',
      modeId: 'monkeyLies',
      mapId: 'peeling_parrot',
      turnSeconds: 15,
      seatMetas: ['Ann', 'Ben', 'Cleo', 'Dot'].map((name, i) => ({ playerId: `p${i}`, name })),
      send: () => {},
      getAutoPlayPolicy: () => sessions.getAutoPlayPolicy(),
      onMatchEnd: (p) => resolveEnd(p),
      seed: 77,
      engineOverrides: { intermissionMs: 25, penaltyWindowMs: 150 },
    });
    gr.subscribeSeat(0, (env) => publicEvents.push(env));
    gr.start();

    // All four humans "abandon" mid-match (hold expiry / left) — the sessions
    // seat converter must flip each seat to a bot AND attach a brain, even to
    // the seat whose turn is currently in flight.
    const personalities = ['aggressive', 'trollish', 'emotional', 'cautious'];
    for (let seat = 0; seat < 4; seat++) {
      sessions.convertSeatToBot(gr, seat, { personality: personalities[seat], reason: 'holdExpired' });
      assert.equal(gr.table.get(seat).isBot, true);
      assert.equal(gr.table.get(seat).personality, personalities[seat]);
    }

    const guard = setTimeout(() => resolveEnd(null), 60000);
    const end = await ended;
    clearTimeout(guard);
    assert.ok(end, 'converted-bot match did not finish within 60 s');
    const types = publicEvents.map((e) => e.t);
    assert.ok(types.includes(MSG.CALLED), 'converted brains must call (the fallback never would)');
    assert.ok(types.includes(MSG.MATCH_END));
    assert.deepEqual(log.lines.filter((l) => l.includes('rejected')), []);
  } finally {
    manager.dispose();
    setGameRoomCreatedHook(null);
    sessions.shutdown();
    gr?.destroy();
    if (prevEnv === undefined) delete process.env.MONKEYBAR_BOT_DELAY_MS;
    else process.env.MONKEYBAR_BOT_DELAY_MS = prevEnv;
  }
});

test('botManager: repairs own-hand desync after a server auto-play (re-prime + legal next play)', async () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  process.env.MONKEYBAR_BOT_DELAY_MS = '9999999'; // park scheduled decisions — the test drives turns itself
  const log = collectLog();
  const manager = createBotManager({ socialBroadcast: () => {}, rng: () => 0.99, log }).install();
  let gr;
  try {
    gr = createGameRoom({
      roomId: 'desync',
      modeId: 'monkeyLies',
      mapId: 'peeling_parrot',
      turnSeconds: 15,
      seatMetas: [0, 1, 2, 3].map((i) => ({
        playerId: `bot-${i}`,
        name: `cautious ${i}`,
        isBot: true,
        personality: 'cautious',
      })),
      send: () => {},
      seed: 99,
      engineOverrides: { intermissionMs: 25, penaltyWindowMs: 150 },
    });
    gr.start();

    const firstSeat = gr.engine.turnSeat;
    const bot = manager.attachSeat(gr, firstSeat); // the already-attached record
    assert.equal(bot.brain.inspect().handSize, 5);

    // The server auto-plays for the seat (deadline race): the brain never
    // committed this play, so its tracked hand is stale until the manager
    // re-primes it from the reconnect snapshot on the own `played` event.
    gr.engine.onTimeout('turn');
    assert.equal(gr.table.get(firstSeat).hand.length, 4);
    assert.equal(bot.brain.inspect().handSize, 4, 'manager must re-prime the desynced brain');

    // Cycle the other seats via the same server auto-play until the turn
    // returns to the repaired bot, then let it decide.
    while (gr.engine.turnSeat !== firstSeat) gr.engine.onTimeout('turn');
    const action = bot.brain.decideTurn();
    assert.equal(action.type, 'play');
    const trueHand = new Set(gr.table.get(firstSeat).hand.map((c) => c.id));
    for (const id of action.cardIds) {
      assert.ok(trueHand.has(id), `re-primed brain played '${id}' — not in its real hand`);
    }
    // …and the engine accepts it: the bot keeps playing legally after the auto-play.
    assert.equal(gr.actForSeat(firstSeat, MSG.PLAY, { cardIds: action.cardIds }).ok, true);
  } finally {
    manager.dispose();
    setGameRoomCreatedHook(null);
    gr?.destroy();
    if (prevEnv === undefined) delete process.env.MONKEYBAR_BOT_DELAY_MS;
    else process.env.MONKEYBAR_BOT_DELAY_MS = prevEnv;
  }
});

test('botManager: high-priority reactions bypass the reaction throttle', async () => {
  const social = [];
  const manager = createBotManager({
    socialBroadcast: (gameRoom, envelope) => social.push(envelope),
    rng: () => 0, // reactions always roll; dispatch delay is exactly 250 ms
    log: collectLog(),
  });
  // Minimal gameRoom stand-in: attachSeat needs the seat meta, a seat feed to
  // push envelopes through, and a snapshot (null = nothing to prime).
  let feed;
  const fakeRoom = {
    roomId: 'throttle',
    ended: false,
    table: {
      get: () => ({ seat: 0, playerId: 'bot-0', name: 'troll', isBot: true, personality: 'trollish' }),
      seats: [],
    },
    subscribeSeat: (_seat, fn) => {
      feed = fn;
      return () => {};
    },
    setSeatDriven: () => {},
    snapshotFor: () => null,
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    manager.attachSeat(fakeRoom, 0);

    // A low-priority reaction fires first and stamps lastReactionAt.
    feed({ t: MSG.PENALTY, p: { seat: 2, chambers: 4, coconuts: 1, chipUsable: true, deadline: 0 } });
    await sleep(600);
    assert.equal(social.filter((e) => e.t === MSG.EMOTE).length, 1, "'othersPenalty' emote must land");

    // <2.2 s after it fired: another low-priority reaction is throttled…
    feed({ t: MSG.PENALTY, p: { seat: 2, chambers: 4, coconuts: 1, chipUsable: true, deadline: 0 } });
    // …but the high-priority own-survival reaction bypasses the gap entirely.
    feed({ t: MSG.CANNON, p: { seat: 0, hit: false } });
    await sleep(600);

    const emotes = social.filter((e) => e.t === MSG.EMOTE).map((e) => e.p.emoteId);
    assert.deepEqual(emotes, ['laugh', 'taunt'], 'surviveShot must fire; second othersPenalty must not');
  } finally {
    manager.dispose();
  }
});

test('botManager: humanized delays follow §5 (1.2 s + difficulty × U(0,3 s); Mathematical is even)', () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  delete process.env.MONKEYBAR_BOT_DELAY_MS; // production timing
  try {
    const manager = createBotManager({ rng: mulberry32(5), log: collectLog() });
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const d = manager.decisionDelayMs(getPersonality('aggressive'));
      assert.ok(d >= 1200 && d <= 4200, `delay ${d} outside 1.2 s + U(0, 3 s)`);
      seen.add(d);
    }
    assert.ok(seen.size > 20, 'delays must vary (humanized jitter)');
    // Mathematical: even delays — the same value every time.
    const even = new Set();
    for (let i = 0; i < 10; i++) even.add(manager.decisionDelayMs(getPersonality('mathematical')));
    assert.equal(even.size, 1);
    manager.dispose();
  } finally {
    if (prevEnv !== undefined) process.env.MONKEYBAR_BOT_DELAY_MS = prevEnv;
  }
});
