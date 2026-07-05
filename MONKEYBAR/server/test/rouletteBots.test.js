// Coconut Roulette bot tests (R5) — PLAN.md §5 applied to the rigged coconut.
//
// Unit-level: the EV core (pass = certain −1 chip vs shake = pExplode ×
// personality-scaled elimination cost vs +1 chip), the archetype signatures
// (Cautious passes while affordable, Trollish shakes gratuitously,
// Mathematical's deliberate blunders, Emotional tilt, Chaotic risk re-rolls),
// reaction keys reusing the existing react() tables, turn bookkeeping across
// the shake-survive same-seat re-turn, and snapshot priming.
//
// Match-level: 120 headless bot-only matches through the REAL engine (no
// sockets, no timers) — every action legal, every match terminates, no
// degenerate personality dominator, Cautious out-passes Trollish, chat DNA
// holds. Then botManager against a REAL gameRoom (real timers): a bots-only
// roulette match to matchEnd where EVERY turn resolves within the turn timer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import { createEngine, explodeProbability } from '../src/game/modes/coconutRoulette.js';
import { createGameRoom, setGameRoomCreatedHook } from '../src/game/gameRoom.js';
import { createBrain, MODE_ID } from '../src/bots/brains/coconutRoulette.js';
import { getBrainFactory } from '../src/bots/brains/index.js';
import { createBotManager } from '../src/bots/botManager.js';
import { PERSONALITY_IDS, getPersonality } from '../src/bots/personalities.js';
import { ROULETTE_START_CHIPS, TURN_SECONDS_DEFAULT } from '@monkeybar/shared/constants.js';
import { ROULETTE_ACTIONS, ROULETTE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';
import { MSG } from '@monkeybar/shared/protocol.js';

const { SHAKE, PASS } = ROULETTE_ACTIONS;

// ---------------------------------------------------------------------------
// Registration (R2 brain convention)
// ---------------------------------------------------------------------------

test('brain module registers under the mode id (brains/index.js picks it up)', () => {
  assert.equal(MODE_ID, 'coconutRoulette');
  assert.equal(getBrainFactory('coconutRoulette'), createBrain);
  const brain = createBrain({ seat: 2, personalityId: 'aggressive', rng: () => 0.5 });
  assert.equal(brain.seat, 2);
  assert.equal(brain.personalityId, 'aggressive');
  assert.equal(typeof brain.observe, 'function');
  assert.equal(typeof brain.decideTurn, 'function');
  assert.equal(typeof brain.decidePenalty, 'function');
  assert.equal(typeof brain.onOwnActionApplied, 'function');
  assert.equal(typeof brain.primeFromSnapshot, 'function');
  assert.equal(createBrain({ seat: 0, personalityId: 'nope' }).personalityId, 'cautious');
});

// ---------------------------------------------------------------------------
// Unit harness: feed a brain the same public envelopes a client would get
// ---------------------------------------------------------------------------

/** Rig a mid-round view: roundStart(+chips), HOLDER(+shakes), turn for `turnSeat`. */
function primeRoulette(brain, { players = 4, chips = 3, shakes = 0, holder = 0, turnSeat = holder } = {}) {
  brain.observe({
    t: MSG.ROUND_START,
    p: {
      roundNo: 1,
      firstSeat: holder,
      seats: Array.from({ length: players }, (_, s) => ({ seat: s, alive: true, chips })),
    },
  });
  // HOLDER carries the authoritative shake counter (rearms mid-round on pass).
  brain.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.HOLDER, seat: holder, shakes, pExplode: explodeProbability(shakes) },
  });
  brain.observe({
    t: MSG.TURN,
    p: { seat: turnSeat, deadline: 0, canCall: false, actions: chips > 0 ? [SHAKE, PASS] : [SHAKE] },
  });
}

/** rng that replays a fixed draw sequence, then holds the last value. */
const seqRng = (values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

// ---------------------------------------------------------------------------
// The EV core + archetype signatures
// ---------------------------------------------------------------------------

test('broke bots always shake (the server would refuse the pass anyway)', () => {
  for (const id of PERSONALITY_IDS) {
    const brain = createBrain({ seat: 0, personalityId: id, rng: () => 0.5 });
    primeRoulette(brain, { chips: 0, shakes: 10 }); // p = 0.68 — still must shake
    assert.deepEqual(brain.decideTurn(), { type: 'mode', action: SHAKE, data: {} }, id);
  }
});

test('EV signatures: Cautious passes while affordable where Aggressive still shakes', () => {
  // Same state — 4 alive, full stack, 2 survived shakes (pExplode 0.20).
  // rng 0.5 = no memErr trip, zero decision noise, no blunder.
  const cautious = createBrain({ seat: 0, personalityId: 'cautious', rng: () => 0.5 });
  primeRoulette(cautious, { shakes: 2 });
  assert.deepEqual(cautious.decideTurn(), { type: 'mode', action: PASS, data: {} });

  const aggressive = createBrain({ seat: 0, personalityId: 'aggressive', rng: () => 0.5 });
  primeRoulette(aggressive, { shakes: 2 });
  assert.deepEqual(aggressive.decideTurn(), { type: 'mode', action: SHAKE, data: {} });

  // Fresh coconut (pExplode 0.08): +1 chip beats a certain −1 even for the
  // timid — everyone shakes the first squeeze rather than bleeding chips.
  const timid = createBrain({ seat: 0, personalityId: 'cautious', rng: () => 0.5 });
  primeRoulette(timid, { shakes: 0 });
  assert.equal(timid.decideTurn().action, SHAKE);

  // Heads-up the boom IS the match — the elimination cost balloons and even
  // Aggressive folds the same 0.20 read while it can still afford to.
  const headsUp = createBrain({ seat: 0, personalityId: 'aggressive', rng: () => 0.5 });
  primeRoulette(headsUp, { players: 2, shakes: 2 });
  assert.equal(headsUp.decideTurn().action, PASS);
});

test('hoarding instinct: a dwindling stack makes paying the pass toll sting', () => {
  // Emotional at pExplode 0.26 with a full stack: pass…
  const rich = createBrain({ seat: 0, personalityId: 'emotional', rng: () => 0.5 });
  primeRoulette(rich, { chips: 3, shakes: 3 });
  assert.equal(rich.decideTurn().action, PASS);
  // …but on the last chip the chipThreshold hoarding kicks in: shake instead.
  const broke = createBrain({ seat: 0, personalityId: 'emotional', rng: () => 0.5 });
  primeRoulette(broke, { chips: 1, shakes: 3 });
  assert.equal(broke.decideTurn().action, SHAKE);
});

test('Trollish shakes gratuitously — EV be damned', () => {
  // First rng draw < the gratuitous-shake rate ⇒ shake at suicidal odds.
  const troll = createBrain({ seat: 0, personalityId: 'trollish', rng: () => 0.1 });
  primeRoulette(troll, { shakes: 12 }); // pExplode 0.80
  assert.equal(troll.decideTurn().action, SHAKE);
  // Without the gratuitous roll the same troll reads the same 0.80 as a pass.
  const sober = createBrain({ seat: 0, personalityId: 'trollish', rng: () => 0.5 });
  primeRoulette(sober, { shakes: 12 });
  assert.equal(sober.decideTurn().action, PASS);
});

test('Mathematical: near-exact reads with deliberate blunders', () => {
  // Draws: memErr (0.5 no), noise (0.5 ⇒ 0), blunder (0.5 no) ⇒ the exact read.
  const exact = createBrain({ seat: 0, personalityId: 'mathematical', rng: seqRng([0.5, 0.5, 0.5]) });
  primeRoulette(exact, { shakes: 0 });
  assert.equal(exact.decideTurn().action, SHAKE); // 0.08 is a clear +EV squeeze
  // Same state, blunder draw trips ⇒ the read flips.
  const blunder = createBrain({ seat: 0, personalityId: 'mathematical', rng: seqRng([0.5, 0.5, 0.01]) });
  primeRoulette(blunder, { shakes: 0 });
  assert.equal(blunder.decideTurn().action, PASS);
});

test('Emotional tilt: surviving a shake tilts the grip, round start cools it', () => {
  const brain = createBrain({ seat: 0, personalityId: 'emotional', rng: () => 0.5 });
  primeRoulette(brain);
  assert.equal(brain.inspect().tilt, 0);
  brain.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.SHAKE, seat: 0, shakes: 1, pExplode: explodeProbability(1), chips: 4 },
  });
  const tilted = brain.inspect().tilt;
  assert.ok(tilted > 0, 'own survived shake must tilt');
  assert.equal(brain.inspect().chips, 4); // chips tracked off the event
  primeRoulette(brain); // next round
  assert.ok(brain.inspect().tilt < tilted, 'tilt must cool between rounds');
  // Non-tilting archetypes never tilt.
  const stoic = createBrain({ seat: 0, personalityId: 'mathematical', rng: () => 0.5 });
  primeRoulette(stoic);
  stoic.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.SHAKE, seat: 0, shakes: 1, pExplode: explodeProbability(1), chips: 4 },
  });
  assert.equal(stoic.inspect().tilt, 0);
});

test('Chaotic re-rolls its risk appetite every round', () => {
  const brain = createBrain({ seat: 0, personalityId: 'chaotic', rng: mulberry32(5) });
  const seen = new Set();
  for (let r = 0; r < 8; r++) {
    primeRoulette(brain);
    seen.add(brain.inspect().risk.toFixed(4));
  }
  assert.ok(seen.size >= 4, 'chaotic must actually re-roll risk per round');
  // Fixed-risk archetypes hold steady.
  const steady = createBrain({ seat: 0, personalityId: 'cautious', rng: mulberry32(5) });
  const held = new Set();
  for (let r = 0; r < 4; r++) {
    primeRoulette(steady);
    held.add(steady.inspect().risk);
  }
  assert.deepEqual([...held], [getPersonality('cautious').risk]);
});

// ---------------------------------------------------------------------------
// Reactions reuse the existing react() keys and tables
// ---------------------------------------------------------------------------

test('reactions: selfPenalty=holding, surviveShot=survived, gotShot=exploded', () => {
  const mk = () => createBrain({ seat: 0, personalityId: 'trollish', rng: () => 0 });
  // rng 0 ⇒ every reaction roll passes and the first candidate is picked;
  // caveat: rng 0 also trips the gratuitous-shake branch, fine here (no turns).

  // Receiving the coconut ⇒ selfPenalty; watching someone else get it ⇒ othersPenalty.
  const holder = mk();
  primeRoulette(holder);
  let r = holder.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.HOLDER, seat: 0, shakes: 0, pExplode: 0.08 },
  });
  assert.equal(r.key, 'selfPenalty');
  assert.ok(r.emoteId);
  r = holder.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.HOLDER, seat: 2, shakes: 0, pExplode: 0.08 },
  });
  assert.equal(r.key, 'othersPenalty');

  // Own survived shake ⇒ surviveShot; an opponent's gamble ⇒ bigPlay.
  const shaker = mk();
  primeRoulette(shaker);
  r = shaker.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.SHAKE, seat: 0, shakes: 1, pExplode: 0.14, chips: 4 },
  });
  assert.equal(r.key, 'surviveShot');
  r = shaker.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.SHAKE, seat: 1, shakes: 2, pExplode: 0.2, chips: 4 },
  });
  assert.equal(r.key, 'bigPlay');

  // Exploding in your own hands ⇒ gotShot; watching it ⇒ someoneEliminated.
  const victim = mk();
  primeRoulette(victim);
  r = victim.observe({ t: MSG.MODE_EVENT, p: { kind: ROULETTE_EVENTS.EXPLODE, seat: 0 } });
  assert.equal(r.key, 'gotShot');
  const witness = mk();
  primeRoulette(witness);
  r = witness.observe({ t: MSG.MODE_EVENT, p: { kind: ROULETTE_EVENTS.EXPLODE, seat: 3 } });
  assert.equal(r.key, 'someoneEliminated');

  // Match end: bigWin for the winner, matchLost otherwise.
  const winner = mk();
  primeRoulette(winner);
  assert.equal(winner.observe({ t: MSG.MATCH_END, p: { winnerSeat: 0, standings: [] } }).key, 'bigWin');
  const loser = mk();
  primeRoulette(loser);
  assert.equal(loser.observe({ t: MSG.MATCH_END, p: { winnerSeat: 2, standings: [] } }).key, 'matchLost');

  // Quiet & Mathematical: zero chat — reactions never fire.
  for (const id of ['quiet', 'mathematical']) {
    const mute = createBrain({ seat: 0, personalityId: id, rng: () => 0 });
    primeRoulette(mute);
    assert.equal(
      mute.observe({ t: MSG.MODE_EVENT, p: { kind: ROULETTE_EVENTS.EXPLODE, seat: 0 } }),
      null,
      id
    );
    assert.equal(mute.observe({ t: MSG.MATCH_END, p: { winnerSeat: 0, standings: [] } }), null, id);
  }
});

// ---------------------------------------------------------------------------
// Turn bookkeeping: stale timers, and the shake-survive same-seat re-turn
// ---------------------------------------------------------------------------

test('decideTurn is null off-turn; a survived shake re-arms the SAME seat cleanly', () => {
  const brain = createBrain({ seat: 0, personalityId: 'aggressive', rng: () => 0.5 });
  assert.equal(brain.decideTurn(), null); // nothing primed — stale timer no-op
  primeRoulette(brain, { turnSeat: 2, holder: 2 });
  assert.equal(brain.decideTurn(), null); // someone else's turn

  // Own turn arrives → a decision; the commit hook clears it (stale after).
  brain.observe({ t: MSG.TURN, p: { seat: 0, deadline: 0, canCall: false, actions: [SHAKE, PASS] } });
  const first = brain.decideTurn();
  assert.ok(first);
  brain.onOwnActionApplied(first);
  assert.equal(brain.decideTurn(), null);

  // Shake-survive: the engine emits SHAKE + a fresh `turn` for the SAME seat
  // synchronously INSIDE the action — before the commit hook runs. The fresh
  // turn must survive the stale commit and yield a new decision.
  brain.observe({ t: MSG.TURN, p: { seat: 0, deadline: 0, canCall: false, actions: [SHAKE, PASS] } });
  const second = brain.decideTurn();
  assert.ok(second);
  brain.observe({
    t: MSG.MODE_EVENT,
    p: { kind: ROULETTE_EVENTS.SHAKE, seat: 0, shakes: 1, pExplode: 0.14, chips: 4 },
  });
  brain.observe({ t: MSG.TURN, p: { seat: 0, deadline: 0, canCall: false, actions: [SHAKE, PASS] } });
  brain.onOwnActionApplied(second); // commit of the OLD decision
  assert.ok(brain.decideTurn(), 'the fresh same-seat turn must not be wiped by the stale commit');

  // Roulette has no penalty window: decidePenalty is always a stale no-op.
  assert.equal(brain.decidePenalty(), null);
});

test('primeFromSnapshot: a converted seat picks up chips, bomb state, and the live turn', () => {
  const table = createTable([0, 1, 2, 3].map((i) => ({ playerId: `p${i}`, name: `P${i}` })));
  const engine = createEngine({ table, seed: 5, shakeRng: () => 0.999, onEvent: () => {} });
  engine.start();
  const holder = engine.turnSeat;
  engine.modeAction(holder, SHAKE); // shakes → 1, holder +1 chip

  const brain = createBrain({ seat: holder, personalityId: 'quiet', rng: () => 0.5 });
  brain.primeFromSnapshot(engine.snapshotFor(holder));
  const s = brain.inspect();
  assert.equal(s.chips, ROULETTE_START_CHIPS + 1);
  assert.equal(s.holderSeat, holder);
  assert.equal(s.shakes, 1);
  assert.equal(s.aliveCount, 4);
  const action = brain.decideTurn();
  assert.ok(action, 'snapshot said it is our turn — the brain must act');
  assert.equal(engine.modeAction(holder, action.action, action.data).ok, true);

  // A bystander seat primes without claiming the turn.
  const bystander = createBrain({ seat: (holder + 1) % 4, personalityId: 'quiet', rng: () => 0.5 });
  bystander.primeFromSnapshot(engine.snapshotFor(bystander.seat));
  assert.equal(bystander.decideTurn(), null);
});

// ---------------------------------------------------------------------------
// 120 headless bot-only matches through the real engine
// ---------------------------------------------------------------------------

/**
 * One full bot-only match: brains as seat policies over the pure engine.
 * Brains see ONLY the public event feed (roulette has no private events).
 * Every action is legality-checked; every match must terminate.
 */
function runBotMatch({ seed, seatPersonalities }) {
  const table = createTable(
    seatPersonalities.map((p, i) => ({ playerId: `bot-${i}`, name: p, isBot: true, personality: p }))
  );
  const brains = seatPersonalities.map((p, i) =>
    createBrain({ seat: i, personalityId: p, rng: mulberry32((seed * 7919 + i * 104729) >>> 0) })
  );
  const stats = { turns: [], reactions: [], forcedShakes: 0 };

  const engine = createEngine({
    table,
    seed,
    onEvent: (e) => {
      const env = { t: e.t, p: e.p };
      assert.equal(e.seat, undefined, 'roulette must never emit private events');
      for (const b of brains) {
        const r = b.observe(env);
        if (r) stats.reactions.push({ seat: b.seat, ...r });
      }
    },
  });

  engine.start();
  let steps = 0;
  while (engine.phase !== 'matchEnd') {
    assert.ok(++steps < 20000, `match (seed ${seed}) stalled without a winner`);
    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const chipsBefore = table.get(seat).chips;
      const action = brains[seat].decideTurn();
      assert.ok(action, `brain at seat ${seat} had no action on its own turn`);
      assert.equal(action.type, 'mode');
      if (chipsBefore <= 0) {
        assert.equal(action.action, SHAKE, `${seatPersonalities[seat]} tried to pass while broke`);
        stats.forcedShakes++;
      }
      const res = engine.modeAction(seat, action.action, action.data);
      assert.ok(res.ok, `ILLEGAL ${action.action} by ${seatPersonalities[seat]}: ${res.code}`);
      brains[seat].onOwnActionApplied(action);
      stats.turns.push({ seat, action: action.action, chipsBefore });
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

test('120 bot-only matches: legal, terminating, no dominator, personalities differ', () => {
  const N = 120;
  const wins = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  const choices = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, { shakes: 0, passes: 0 }]));
  const reactions = Object.fromEntries(PERSONALITY_IDS.map((p) => [p, 0]));
  let forcedShakes = 0;

  for (let m = 0; m < N; m++) {
    // One seat per archetype; rotate the seating each match to cancel
    // positional (first-holder) bias out of the win-rate comparison.
    const order = PERSONALITY_IDS.map((_, i) => PERSONALITY_IDS[(i + m) % PERSONALITY_IDS.length]);
    const { winnerSeat, stats } = runBotMatch({ seed: 5000 + m, seatPersonalities: order });
    wins[order[winnerSeat]]++;
    forcedShakes += stats.forcedShakes;
    for (const t of stats.turns) {
      if (t.chipsBefore <= 0) continue; // forced shakes say nothing about nerve
      choices[order[t.seat]][t.action === SHAKE ? 'shakes' : 'passes']++;
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

  // The 0-chips forced-shake rule genuinely comes up in play.
  assert.ok(forcedShakes > 0, 'no match ever forced a broke monkey to shake');

  // Nerve DNA: Trollish out-shakes Cautious by a wide margin (given a choice).
  const shakeRate = (p) => choices[p].shakes / Math.max(1, choices[p].shakes + choices[p].passes);
  assert.ok(
    shakeRate('trollish') - shakeRate('cautious') >= 0.15,
    `trollish ${shakeRate('trollish').toFixed(3)} vs cautious ${shakeRate('cautious').toFixed(3)}`
  );
  // Everyone both shakes and passes sometimes — nobody plays a pure strategy.
  for (const p of PERSONALITY_IDS) {
    assert.ok(choices[p].shakes > 0, `${p} never chose to shake`);
    assert.ok(choices[p].passes > 0, `${p} never chose to pass`);
  }

  // Chat DNA: Quiet & Mathematical are mute, Trollish out-spams everyone.
  assert.equal(reactions.quiet, 0);
  assert.equal(reactions.mathematical, 0);
  for (const p of PERSONALITY_IDS) {
    if (p === 'trollish') continue;
    assert.ok(reactions.trollish > reactions[p], `trollish (${reactions.trollish}) must out-spam ${p}`);
  }
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

test('humanized delays always fit inside the roulette turn timer', () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  delete process.env.MONKEYBAR_BOT_DELAY_MS; // production timing
  try {
    const manager = createBotManager({ rng: mulberry32(9), log: collectLog() });
    for (const id of PERSONALITY_IDS) {
      for (let i = 0; i < 25; i++) {
        const d = manager.decisionDelayMs(getPersonality(id));
        assert.ok(
          d < TURN_SECONDS_DEFAULT * 1000,
          `${id} delay ${d}ms would blow the ${TURN_SECONDS_DEFAULT}s turn timer`
        );
      }
    }
    manager.dispose();
  } finally {
    if (prevEnv !== undefined) process.env.MONKEYBAR_BOT_DELAY_MS = prevEnv;
  }
});

test('botManager: full bots-only roulette match, every turn resolves within the timer', async () => {
  const prevEnv = process.env.MONKEYBAR_BOT_DELAY_MS;
  process.env.MONKEYBAR_BOT_DELAY_MS = '12'; // tiny humanized delays for CI
  const log = collectLog();
  const social = [];
  const manager = createBotManager({
    socialBroadcast: (gameRoom, envelope) => social.push(envelope),
    rng: mulberry32(21),
    log,
  }).install(); // registers the real gameRoom-created hook

  const publicEvents = [];
  let resolveEnd;
  const ended = new Promise((r) => (resolveEnd = r));
  let gr;
  try {
    const turnSeconds = TURN_SECONDS_DEFAULT;
    gr = createGameRoom({
      roomId: 'roulette-bots',
      modeId: 'coconutRoulette',
      mapId: 'peeling_parrot',
      turnSeconds,
      seatMetas: PERSONALITY_IDS.map((p, i) => ({
        playerId: `bot-${i}`,
        name: `${p} (bot)`,
        isBot: true,
        personality: p,
      })),
      send: () => {},
      onMatchEnd: (p) => resolveEnd(p),
      seed: 777,
      engineOverrides: { intermissionMs: 25 },
    });
    gr.subscribeSeat(0, (env) => publicEvents.push({ ...env, at: Date.now() }));

    gr.start();
    const guard = setTimeout(() => resolveEnd(null), 90000);
    const end = await ended;
    clearTimeout(guard);
    assert.ok(end, 'bots-only roulette match did not finish within 90 s');
    assert.equal(typeof end.winnerSeat, 'number');
    assert.equal(end.standings.length, PERSONALITY_IDS.length);

    // The whole vocabulary showed up on the wire.
    const kinds = new Set(publicEvents.filter((e) => e.t === MSG.MODE_EVENT).map((e) => e.p.kind));
    assert.ok(kinds.has(ROULETTE_EVENTS.HOLDER), 'no arm/holder events');
    assert.ok(kinds.has(ROULETTE_EVENTS.SHAKE) || kinds.has(ROULETTE_EVENTS.EXPLODE), 'nobody ever shook');
    assert.ok(kinds.has(ROULETTE_EVENTS.EXPLODE), 'nobody ever exploded');
    const types = publicEvents.map((e) => e.t);
    assert.ok(types.includes(MSG.ELIMINATED));
    assert.ok(types.includes(MSG.MATCH_END));

    // NO DEADLOCKS: every turn resolved well inside the turn timer — the gap
    // between consecutive turn-boundary events (turn → next turn / roundEnd /
    // matchEnd) never approaches the deadline the engine advertised.
    const boundaries = publicEvents.filter(
      (e) => e.t === MSG.TURN || e.t === MSG.ROUND_END || e.t === MSG.MATCH_END
    );
    assert.ok(boundaries.length > 5, 'suspiciously few turns for a 7-seat match');
    for (let i = 1; i < boundaries.length; i++) {
      const gap = boundaries[i].at - boundaries[i - 1].at;
      assert.ok(
        gap <= turnSeconds * 1000,
        `turn ${i} took ${gap}ms — blew the ${turnSeconds}s timer (deadlock?)`
      );
    }

    // Personality-keyed social traffic went out through the broadcast hook.
    assert.ok(social.some((e) => e.t === MSG.EMOTE), 'no emotes fired');
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
