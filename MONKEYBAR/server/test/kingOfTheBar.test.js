// King of the Bar (R7) — Bar Rule mutator behavior over the parameterized
// Monkey Lies engine, the seeded no-repeat rule picker, snapshot/modeEvent
// plumbing, and 60 headless bot-only matches through the real mode engine.
// Headless like monkeyLies.test.js: no sockets, no real timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import { createMonkeyLiesEngine } from '../src/game/modes/monkeyLies.js';
import { BAR_RULES, BAR_RULE_BY_ID, createEngine } from '../src/game/modes/kingOfTheBar.js';
import { createBrain } from '../src/bots/brains/kingOfTheBar.js';
import { PERSONALITY_IDS } from '../src/bots/personalities.js';
import { BASIC_FRUITS, cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { START_CHAMBERS, START_COCONUTS } from '@monkeybar/shared/constants.js';
import { KING_ACTIONS, KING_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { getMode } from '@monkeybar/shared/modes.js';
import { ERROR_CODES, MSG } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const RULE_IDS = BAR_RULES.map((r) => r.id);

function makeTable(players = 4) {
  return createTable(
    Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
  );
}

/**
 * ML engine with a FORCED Bar Rule patch per round (exactly the patch the
 * King module injects) — the surgical way to pin each mutator's behavior.
 * `ruleFor(roundNo)` → rule id | null (null = stock round).
 */
function makeRuleGame(ruleFor, { players = 4, seed = 1, cannonRng } = {}) {
  const table = makeTable(players);
  const events = [];
  const engine = createMonkeyLiesEngine({
    table,
    seed,
    cannonRng,
    roundRules: (roundNo) => {
      const id = ruleFor(roundNo);
      return id ? { ...BAR_RULE_BY_ID[id].rules } : {};
    },
    onEvent: (e) => events.push(e),
  });
  return { table, engine, events };
}

const byType = (events, t) => events.filter((e) => e.t === t);
const modeEvents = (events, kind) =>
  byType(events, MSG.MODE_EVENT).filter((e) => e.p.kind === kind);

/** Force a called challenge: turnSeat plays 1 card, the next seat calls. */
function playThenCall(engine, table) {
  const playerSeat = engine.turnSeat;
  const res = engine.play(playerSeat, [table.get(playerSeat).hand[0].id]);
  assert.ok(res.ok, `setup play rejected: ${res.code}`);
  const callerSeat = engine.turnSeat;
  const call = engine.callLiar(callerSeat);
  assert.ok(call.ok, `setup call rejected: ${call.code}`);
  return { playerSeat, callerSeat };
}

// ---------------------------------------------------------------------------
// Registry: the six promised mutators
// ---------------------------------------------------------------------------

test('BAR_RULES: exactly the 6 mutators promised in shared/modes.js', () => {
  assert.equal(BAR_RULES.length, 6);
  assert.deepEqual(
    [...RULE_IDS].sort(),
    ['hair_trigger', 'happy_hour', 'royal_decree', 'silent_round', 'sour_table', 'sticky_stool']
  );
  // One rule per teaser line on the mode card.
  assert.equal(getMode('kingOfTheBar').mutators.length, BAR_RULES.length);
  for (const rule of BAR_RULES) {
    assert.ok(rule.name && rule.desc, `${rule.id} must carry banner name/desc`);
    assert.ok(Object.keys(rule.rules).length >= 1, `${rule.id} must patch the rules`);
    assert.equal(BAR_RULE_BY_ID[rule.id], rule);
  }
});

// ---------------------------------------------------------------------------
// happy_hour — minPlay 2, but a last lonely card may still go
// ---------------------------------------------------------------------------

test('happy_hour: singles are rejected, 2+ accepted, a 1-card hand sheds its last single', () => {
  const { engine, table } = makeRuleGame(() => 'happy_hour', { seed: 11 });
  engine.start();
  assert.equal(engine.inspect().rules.minPlay, 2);

  const first = engine.turnSeat;
  const hand = table.get(first).hand;
  // 5-card hand: a single is an INVALID play under Happy Hour…
  assert.equal(engine.play(first, [hand[0].id]).code, ERROR_CODES.INVALID_CARDS);
  // …but 2 cards clear the bar (and 3 still respects maxPlay).
  assert.ok(engine.play(first, [hand[0].id, hand[1].id]).ok);

  // Walk every seat down to 1 card via legal 2-card plays (nobody calls).
  // 5 → 3 → 1: after two full cycles each hand holds exactly one card.
  for (let i = 0; i < 7; i++) {
    const seat = engine.turnSeat;
    const h = table.get(seat).hand;
    assert.ok(h.length >= 2, `expected 2+ cards at seat ${seat}, got ${h.length}`);
    assert.ok(engine.play(seat, [h[0].id, h[1].id]).ok);
  }
  // The exception clause: hands under the floor may still shed their last card.
  const seat = engine.turnSeat;
  assert.equal(table.get(seat).hand.length, 1);
  assert.ok(
    engine.play(seat, [table.get(seat).hand[0].id]).ok,
    'a last lonely single must still be playable under Happy Hour'
  );
});

// ---------------------------------------------------------------------------
// sticky_stool — turnDirection −1 for the round
// ---------------------------------------------------------------------------

test('sticky_stool: the turn order runs backwards (and only on sticky rounds)', () => {
  // Round 1 sticky, round 2 stock — the flip must not leak across rounds.
  const { engine, table } = makeRuleGame((r) => (r === 1 ? 'sticky_stool' : null), {
    seed: 3,
    cannonRng: () => 0.99, // every shot survives → nobody is eliminated
  });
  engine.start();
  assert.equal(engine.inspect().rules.turnDirection, -1);

  const n = table.size;
  const first = engine.turnSeat;
  assert.ok(engine.play(first, [table.get(first).hand[0].id]).ok);
  assert.equal(engine.turnSeat, (first - 1 + n) % n, 'sticky round must walk counterclockwise');
  const second = engine.turnSeat;
  assert.ok(engine.play(second, [table.get(second).hand[0].id]).ok);
  assert.equal(engine.turnSeat, (second - 1 + n) % n);

  // Resolve the round (call → cannon → intermission) and enter round 2.
  playThenCall(engine, table);
  engine.onTimeout('penalty');
  assert.equal(engine.phase, 'roundEnd');
  engine.onTimeout('intermission');
  assert.equal(engine.roundNo, 2);
  assert.equal(engine.inspect().rules.turnDirection, 1, 'stock rounds must not inherit the flip');
  const r2first = engine.turnSeat;
  assert.ok(engine.play(r2first, [table.get(r2first).hand[0].id]).ok);
  assert.equal(engine.turnSeat, (r2first + 1) % n, 'round 2 must walk clockwise again');
});

// ---------------------------------------------------------------------------
// sour_table — Table Fruit re-rolls after every 3rd play (modeEvent fruitFlip)
// ---------------------------------------------------------------------------

test('sour_table: the fruit re-rolls after every 3rd play, announced via fruitFlip', () => {
  const { engine, table, events } = makeRuleGame(() => 'sour_table', { seed: 5 });
  engine.start();
  assert.equal(engine.inspect().rules.midRoundFruitFlipEvery, 3);

  const fruits = [engine.tableFruit];
  for (let play = 1; play <= 6; play++) {
    const seat = engine.turnSeat;
    assert.ok(engine.play(seat, [table.get(seat).hand[0].id]).ok);
    const flips = modeEvents(events, 'fruitFlip');
    assert.equal(flips.length, Math.floor(play / 3), `flip count after play ${play}`);
    if (play % 3 === 0) {
      const flip = flips.at(-1);
      assert.equal(flip.p.fruit, engine.tableFruit, 'flip event must carry the new fruit');
      assert.equal(flip.p.roundNo, 1);
      assert.notEqual(flip.p.fruit, fruits.at(-1), 're-roll must land on a DIFFERENT fruit');
      assert.ok(BASIC_FRUITS.includes(flip.p.fruit));
      fruits.push(flip.p.fruit);
    } else {
      assert.equal(engine.tableFruit, fruits.at(-1), 'fruit must hold between flips');
    }
  }

  // Reveal truth is judged against the FLIPPED fruit: play a card matching the
  // current fruit and call it — the caller must lose (truth).
  const seat = engine.turnSeat;
  const truthy = table.get(seat).hand.find((c) => cardMatchesTableFruit(c, engine.tableFruit));
  if (truthy) {
    assert.ok(engine.play(seat, [truthy.id]).ok);
    if (modeEvents(events, 'fruitFlip').length === 2) {
      // No flip rode this play (7th play) — the claim resolves under the current fruit.
      const caller = engine.turnSeat;
      assert.ok(engine.callLiar(caller).ok);
      const reveal = byType(events, MSG.REVEAL).at(-1);
      assert.equal(reveal.p.lie, false, 'truth must be judged against the flipped fruit');
      assert.equal(reveal.p.loserSeat, caller);
    }
  }
});

// ---------------------------------------------------------------------------
// hair_trigger — 2 coconuts loaded THAT ROUND ONLY (permanent track untouched)
// ---------------------------------------------------------------------------

test('hair_trigger: 2 coconuts for the round only; cannon math uses the override', () => {
  // Round 1 hair trigger, round 2 stock. Roll 0.4: hit under 2/4, miss under 1/4.
  const { engine, table, events } = makeRuleGame((r) => (r === 1 ? 'hair_trigger' : null), {
    seed: 21,
    cannonRng: () => 0.4,
  });
  engine.start();
  assert.equal(engine.inspect().rules.startCoconuts, 2);

  const { playerSeat, callerSeat } = playThenCall(engine, table);
  const victim = byType(events, MSG.REVEAL).at(-1).p.loserSeat;
  assert.ok([playerSeat, callerSeat].includes(victim));

  // The penalty frame advertises the EFFECTIVE 2-coconut load…
  const pen = byType(events, MSG.PENALTY).at(-1);
  assert.equal(pen.p.coconuts, 2);
  assert.equal(pen.p.chambers, START_CHAMBERS);
  // …while the permanent per-seat track still holds the match-start value.
  assert.equal(table.get(victim).coconuts, START_COCONUTS);

  // Cannon: 0.4 < 2/4 → HIT under Hair Trigger (stock 1/4 would survive).
  engine.onTimeout('penalty');
  const shot = byType(events, MSG.CANNON).at(-1);
  assert.deepEqual({ seat: shot.p.seat, hit: shot.p.hit }, { seat: victim, hit: true });
  assert.equal(table.get(victim).alive, false);

  // Round 2 is stock: penalties are back to 1 coconut and 0.4 now survives.
  engine.onTimeout('intermission');
  assert.equal(engine.roundNo, 2);
  assert.equal(engine.inspect().rules.startCoconuts, START_COCONUTS);
  playThenCall(engine, table);
  const pen2 = byType(events, MSG.PENALTY).at(-1);
  assert.equal(pen2.p.coconuts, START_COCONUTS, 'the extra coconut must not leak past its round');
  const victim2 = pen2.p.seat;
  const chambersBefore = table.get(victim2).chambersLeft;
  engine.onTimeout('penalty');
  assert.equal(byType(events, MSG.CANNON).at(-1).p.hit, false);
  assert.equal(table.get(victim2).chambersLeft, chambersBefore - 1, 'survival still burns a chamber');
});

// ---------------------------------------------------------------------------
// royal_decree — challenge winner picks the next round's Table Fruit
// ---------------------------------------------------------------------------

test('royal_decree: winner gets a pickFruit turn; the pick (or timeout) crowns the next fruit', () => {
  const { engine, table, events } = makeRuleGame(() => 'royal_decree', {
    seed: 8,
    cannonRng: () => 0.99, // survive every shot → the decree window always opens
  });
  engine.start();
  assert.equal(engine.inspect().rules.decree, true);

  // Challenge #1 → cannon (survived) → decree phase for the challenge WINNER.
  playThenCall(engine, table);
  const loser = byType(events, MSG.REVEAL).at(-1).p.loserSeat;
  engine.onTimeout('penalty');
  assert.equal(engine.phase, 'decree');
  const winner = engine.turnSeat;
  assert.notEqual(winner, loser, 'the decree goes to the NON-loser side of the challenge');
  assert.equal(engine.getTimer().kind, 'decree');

  // The §3.3 turn frame carries the pickFruit action list.
  const decreeTurn = byType(events, MSG.TURN).at(-1);
  assert.equal(decreeTurn.p.seat, winner);
  assert.deepEqual(decreeTurn.p.actions, [KING_ACTIONS.PICK_FRUIT]);

  // Guard rails: wrong seat / wrong verb / bogus fruit / plays are rejected.
  const other = (winner + 1) % table.size;
  assert.equal(
    engine.modeAction(other, KING_ACTIONS.PICK_FRUIT, { fruit: BASIC_FRUITS[0] }).code,
    ERROR_CODES.NOT_YOUR_TURN
  );
  assert.equal(engine.modeAction(winner, 'nope', {}).code, ERROR_CODES.BAD_MSG);
  assert.equal(engine.modeAction(winner, KING_ACTIONS.PICK_FRUIT, { fruit: 'golden' }).code, ERROR_CODES.BAD_MSG);
  assert.equal(engine.play(winner, ['whatever']).code, ERROR_CODES.BAD_STATE);

  // The pick lands: fruitPicked modeEvent + round 2 opens on EXACTLY that fruit.
  const picked = BASIC_FRUITS.find((f) => f !== engine.tableFruit);
  assert.ok(engine.modeAction(winner, KING_ACTIONS.PICK_FRUIT, { fruit: picked }).ok);
  const evt = modeEvents(events, 'fruitPicked').at(-1);
  assert.deepEqual(evt.p, { kind: 'fruitPicked', seat: winner, fruit: picked });
  assert.equal(engine.phase, 'roundEnd');
  engine.onTimeout('intermission');
  assert.equal(engine.roundNo, 2);
  assert.equal(engine.tableFruit, picked, 'the decreed fruit must open the next round');

  // Timeout path: the window expires → auto-pick = the winner's most-held fruit.
  playThenCall(engine, table);
  engine.onTimeout('penalty');
  assert.equal(engine.phase, 'decree');
  const winner2 = engine.turnSeat;
  const held = new Map(BASIC_FRUITS.map((f) => [f, 0]));
  for (const c of table.get(winner2).hand) {
    if (held.has(c.fruit)) held.set(c.fruit, held.get(c.fruit) + 1);
  }
  const expected = BASIC_FRUITS.reduce((a, b) => (held.get(b) > held.get(a) ? b : a));
  engine.onTimeout('decree');
  assert.equal(engine.phase, 'roundEnd');
  engine.onTimeout('intermission');
  if (held.get(expected) > 0) {
    assert.equal(engine.tableFruit, expected, 'timeout must pick the most-held fruit');
  }
});

test('royal_decree: a Last-Monkey-Holding self-shot round opens no decree window', () => {
  const { engine, table } = makeRuleGame(() => 'royal_decree', {
    seed: 14,
    cannonRng: () => 0.99,
  });
  engine.start();
  // Everyone dumps 3 cards a turn without calling → last holder self-fires.
  let guard = 0;
  while (engine.phase === 'playing' && guard++ < 100) {
    const seat = engine.turnSeat;
    if (engine.lastHolderPending) {
      assert.ok(engine.fireSelf(seat).ok);
      break;
    }
    const h = table.get(seat).hand;
    assert.ok(engine.play(seat, h.slice(0, Math.min(3, h.length)).map((c) => c.id)).ok);
  }
  assert.equal(engine.phase, 'penalty');
  engine.onTimeout('penalty'); // survived (0.99)
  assert.equal(engine.phase, 'roundEnd', 'no challenge happened — no decree, straight to intermission');
});

// ---------------------------------------------------------------------------
// silent_round — engine.socialMuted true exactly while the silent round is live
// ---------------------------------------------------------------------------

test('silent_round: socialMuted is true only during the silent round', () => {
  const { engine, table } = makeRuleGame((r) => (r === 1 ? 'silent_round' : null), {
    seed: 2,
    cannonRng: () => 0.99,
  });
  assert.equal(engine.socialMuted, false, 'default false before start');
  engine.start();
  assert.equal(engine.inspect().rules.silent, true);
  assert.equal(engine.socialMuted, true, 'muted while the silent round plays');

  playThenCall(engine, table);
  assert.equal(engine.socialMuted, true, 'still muted through the penalty window');
  engine.onTimeout('penalty');
  assert.equal(engine.phase, 'roundEnd');
  assert.equal(engine.socialMuted, false, 'intermission lifts the muzzle');
  engine.onTimeout('intermission');
  assert.equal(engine.roundNo, 2);
  assert.equal(engine.socialMuted, false, 'stock rounds are never muted');
});

// ---------------------------------------------------------------------------
// The King wrapper: seeded picks, no repeats, announcements, snapshots
// ---------------------------------------------------------------------------

/** Timeout-drive a King match to matchEnd; returns the event log. */
function runKingByTimeouts(seed, { players = 4, maxSteps = 3000 } = {}) {
  const table = makeTable(players);
  const events = [];
  const engine = createEngine({ table, seed, onEvent: (e) => events.push(e) });
  engine.start();
  for (let step = 0; step < maxSteps && engine.phase !== 'matchEnd'; step++) {
    const timer = engine.getTimer();
    assert.ok(timer, `no timer in phase ${engine.phase}`);
    engine.onTimeout(timer.kind);
  }
  assert.equal(engine.phase, 'matchEnd', `seed ${seed}: match did not end`);
  return { engine, events, table };
}

test('king wrapper: one seeded barRule per round, never twice in a row, snapshot + modeEvent agree', () => {
  const { engine, events } = runKingByTimeouts(42);

  const announced = modeEvents(events, KING_EVENTS.BAR_RULE);
  const rounds = byType(events, MSG.ROUND_START);
  assert.equal(announced.length, rounds.length, 'exactly one barRule per roundStart');
  assert.ok(rounds.length >= 2, 'the seeded match must span multiple rounds');

  for (let i = 0; i < announced.length; i++) {
    const p = announced[i].p;
    assert.ok(RULE_IDS.includes(p.ruleId), `unknown rule '${p.ruleId}'`);
    assert.equal(p.roundNo, rounds[i].p.roundNo);
    assert.equal(p.name, BAR_RULE_BY_ID[p.ruleId].name);
    assert.equal(p.desc, BAR_RULE_BY_ID[p.ruleId].desc);
    // The barRule frame rides AFTER its roundStart frame on the same queue.
    assert.ok(events.indexOf(announced[i]) > events.indexOf(rounds[i]));
    if (i > 0) {
      assert.notEqual(p.ruleId, announced[i - 1].p.ruleId, 'no mutator twice in a row');
    }
  }

  // Snapshot: §10.3 extension for every consumer (seat, spectator).
  const snap = engine.snapshotFor(0);
  assert.equal(snap.mode, 'kingOfTheBar');
  assert.deepEqual(snap.barRule, {
    ruleId: announced.at(-1).p.ruleId,
    name: announced.at(-1).p.name,
    desc: announced.at(-1).p.desc,
  });
  assert.equal(engine.snapshotFor(null).yourHand, null, 'spectator filtering intact');

  // Determinism: the same seed replays the exact same rule sequence…
  const rerun = runKingByTimeouts(42);
  assert.deepEqual(
    modeEvents(rerun.events, KING_EVENTS.BAR_RULE).map((e) => e.p.ruleId),
    announced.map((e) => e.p.ruleId)
  );
  // …and the whole match transcript (rules ride the seed, not wall clocks).
  assert.deepEqual(
    rerun.events.map((e) => e.t),
    events.map((e) => e.t)
  );
});

test('king wrapper: rule sequences vary by seed and cover all 6 mutators', () => {
  const sequences = [];
  const seen = new Set();
  for (let seed = 100; seed < 112; seed++) {
    const { events } = runKingByTimeouts(seed);
    const seq = modeEvents(events, KING_EVENTS.BAR_RULE).map((e) => e.p.ruleId);
    sequences.push(seq.join(','));
    for (const id of seq) seen.add(id);
  }
  assert.ok(new Set(sequences).size > 1, 'different seeds must yield different rule sequences');
  assert.deepEqual([...seen].sort(), [...RULE_IDS].sort(), 'all 6 mutators must appear across seeds');
});

// ---------------------------------------------------------------------------
// 60 headless bot-only matches through the King mode engine
// ---------------------------------------------------------------------------

/**
 * One full bot-only King match (mirrors botBrain.test.js's runBotMatch, plus
 * the decree phase and per-round Bar Rule bookkeeping). Every action is
 * legality-checked; returns per-match stats for the aggregate assertions.
 */
function runKingBotMatch({ seed, seatPersonalities }) {
  const table = createTable(
    seatPersonalities.map((p, i) => ({ playerId: `bot-${i}`, name: p, isBot: true, personality: p }))
  );
  const brains = seatPersonalities.map((p, i) =>
    createBrain({ seat: i, personalityId: p, rng: mulberry32((seed * 7919 + i * 104729) >>> 0) })
  );
  const stats = { rules: [], decreePicks: 0, happyHourShortPlays: 0, silentReactions: 0, reactions: 0 };
  let activeRule = null;
  // The muzzle window mirrors engine.socialMuted: the silent round is live
  // from its roundStart until its roundEnd (intermission chat is legal again).
  let roundLive = false;

  const engine = createEngine({
    table,
    seed,
    onEvent: (e) => {
      if (e.t === MSG.MODE_EVENT && e.p.kind === KING_EVENTS.BAR_RULE) {
        activeRule = e.p.ruleId;
        stats.rules.push(e.p.ruleId);
      }
      if (e.t === MSG.ROUND_START) roundLive = true;
      if (e.t === MSG.ROUND_END || e.t === MSG.MATCH_END) roundLive = false;
      // Bar Rule contract the HUD/brains rely on: 1-card plays under Happy
      // Hour only ever come from a hand that emptied (the last-single clause).
      if (e.t === MSG.PLAYED && activeRule === 'happy_hour' && e.p.count === 1) {
        assert.equal(e.p.handCount, 0, 'happy_hour single from a 2+ hand leaked through');
        stats.happyHourShortPlays += 1;
      }
      const env = { t: e.t, p: e.p };
      if (e.seat !== undefined) {
        const r = brains[e.seat].observe(env);
        if (r) stats.reactions += 1;
      } else {
        for (const b of brains) {
          const r = b.observe(env);
          if (!r) continue;
          stats.reactions += 1;
          if (activeRule === 'silent_round' && roundLive) stats.silentReactions += 1;
        }
      }
    },
  });

  engine.start();
  let steps = 0;
  while (engine.phase !== 'matchEnd') {
    assert.ok(++steps < 5000, `King match (seed ${seed}) stalled without a winner`);
    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const action = brains[seat].decideTurn();
      assert.ok(action, `brain at seat ${seat} had no action on its own turn`);
      if (action.type === 'call') {
        const res = engine.callLiar(seat);
        assert.ok(res.ok, `ILLEGAL call by ${seatPersonalities[seat]}: ${res.code}`);
      } else {
        assert.equal(action.type, 'play');
        const res = engine.play(seat, action.cardIds);
        assert.ok(
          res.ok,
          `ILLEGAL play by ${seatPersonalities[seat]} under '${activeRule}': ${res.code}`
        );
      }
      brains[seat].onOwnActionApplied(action);
    } else if (engine.phase === 'decree') {
      const seat = engine.turnSeat;
      const action = brains[seat].decideTurn();
      assert.ok(action, `brain at seat ${seat} slept through its decree window`);
      assert.equal(action.type, 'mode');
      assert.equal(action.action, KING_ACTIONS.PICK_FRUIT);
      const res = engine.modeAction(seat, action.action, action.data);
      assert.ok(res.ok, `ILLEGAL decree pick by ${seatPersonalities[seat]}: ${res.code}`);
      brains[seat].onOwnActionApplied(action);
      stats.decreePicks += 1;
    } else if (engine.phase === 'penalty') {
      const pen = engine.inspect().penalty;
      const decision = brains[pen.seat].decidePenalty();
      assert.ok(decision, `brain at seat ${pen.seat} ignored its own penalty window`);
      if (decision.useChip) {
        assert.ok(table.get(pen.seat).chips > 0, 'brain tried to spend a chip it no longer has');
        const res = engine.useChip(pen.seat);
        assert.ok(res.ok, `ILLEGAL chip by ${seatPersonalities[pen.seat]}: ${res.code}`);
      } else {
        engine.onTimeout('penalty');
      }
    } else if (engine.phase === 'roundEnd') {
      engine.onTimeout('intermission');
    } else {
      assert.fail(`harness stuck in phase '${engine.phase}'`);
    }
  }
  assert.equal(table.aliveCount(), 1, 'match must end with exactly one monkey standing');
  assert.notEqual(engine.winnerSeat, -1);
  return stats;
}

test('60 bot-only King matches: legal, terminating, all mutators played, decrees picked, silent bots mute', () => {
  const N = 60;
  const ruleCounts = Object.fromEntries(RULE_IDS.map((id) => [id, 0]));
  let decreePicks = 0;
  let silentReactions = 0;
  let reactions = 0;
  for (let m = 0; m < N; m++) {
    const order = PERSONALITY_IDS.map((_, i) => PERSONALITY_IDS[(i + m) % PERSONALITY_IDS.length]);
    const stats = runKingBotMatch({ seed: 5000 + m, seatPersonalities: order.slice(0, 4) });
    for (const id of stats.rules) {
      assert.ok(RULE_IDS.includes(id));
      ruleCounts[id] += 1;
    }
    for (let i = 1; i < stats.rules.length; i++) {
      assert.notEqual(stats.rules[i], stats.rules[i - 1], 'no mutator twice in a row');
    }
    decreePicks += stats.decreePicks;
    silentReactions += stats.silentReactions;
    reactions += stats.reactions;
  }
  for (const id of RULE_IDS) {
    assert.ok(ruleCounts[id] >= 5, `${id} barely appeared across ${N} matches (${ruleCounts[id]})`);
  }
  assert.ok(decreePicks > 0, 'bots never answered a Royal Decree pick window');
  assert.equal(silentReactions, 0, 'bots must keep poker faces during silent rounds');
  assert.ok(reactions > 0, 'bots must still chat outside silent rounds');
});
