// Custom Chaos (R7) — host knobs over the parameterized Monkey Lies engine:
// validation/clamping, the chaosKnobs announcement, snapshot echo, per-knob
// behavior (hand size, deck wilds, max play, chambers/coconuts, chips), a
// knob-extremes matrix of full sims to matchEnd, and 60 headless bot-only
// matches under non-default knobs. Headless like monkeyLies.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTable } from '../src/game/table.js';
import { createEngine, knobsToRules } from '../src/game/modes/customChaos.js';
import { createBrain, knobDeckTruthyTotal } from '../src/bots/brains/customChaos.js';
import { PERSONALITY_IDS } from '../src/bots/personalities.js';
import { CHAOS_KNOB_SCHEMA, DEFAULT_KNOBS, validateKnobs } from '@monkeybar/shared/chaos.js';
import { FRUITS } from '@monkeybar/shared/cards.js';
import { CHAOS_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { ERROR_CODES, MSG } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeTable(players = 4) {
  return createTable(
    Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
  );
}

function makeChaos(knobs, { players = 4, seed = 1, cannonRng } = {}) {
  const table = makeTable(players);
  const events = [];
  const engine = createEngine({ table, seed, cannonRng, knobs, onEvent: (e) => events.push(e) });
  return { table, engine, events };
}

const byType = (events, t) => events.filter((e) => e.t === t);

/** Timeout-drive a Chaos match to matchEnd (the engine's own fallbacks). */
function runToMatchEnd(engine, { maxSteps = 5000 } = {}) {
  for (let step = 0; step < maxSteps && engine.phase !== 'matchEnd'; step++) {
    const timer = engine.getTimer();
    assert.ok(timer, `no timer in phase ${engine.phase}`);
    engine.onTimeout(timer.kind);
  }
  assert.equal(engine.phase, 'matchEnd', 'match did not reach matchEnd');
}

// ---------------------------------------------------------------------------
// Knob validation + announcement + snapshot echo
// ---------------------------------------------------------------------------

test('knobsToRules: knobs map 1:1 onto the Monkey Lies rule surface', () => {
  const rules = knobsToRules({ ...DEFAULT_KNOBS, handSize: 6, maxPlay: 4, goldenPerPlayer: 0 });
  assert.deepEqual(rules, {
    handSize: 6,
    maxPlay: 4,
    startChambers: DEFAULT_KNOBS.startChambers,
    startCoconuts: DEFAULT_KNOBS.startCoconuts,
    chipsPerMatch: DEFAULT_KNOBS.chipsPerMatch,
    chipBonus: DEFAULT_KNOBS.chipBonus,
    goldenPerPlayer: 0,
  });
  // minPlay / turnDirection / fruit-flip / decree / silent are NOT knob-reachable.
  for (const key of ['minPlay', 'turnDirection', 'midRoundFruitFlipEvery', 'decree', 'silent']) {
    assert.equal(key in rules, false, `knobs must never touch '${key}'`);
  }
});

test('factory defensively re-validates knobs (clamps, drops junk, caps maxPlay at handSize)', () => {
  const { engine, events } = makeChaos({
    handSize: 99, // → 7
    maxPlay: 99, // → 4 (schema max)
    startChambers: -5, // → 2
    startCoconuts: 2.4, // → 2 (rounded)
    chipsPerMatch: 'lots', // junk → default 1
    hacked: true, // unknown key → dropped
  });
  const expected = validateKnobs({ handSize: 7, maxPlay: 4, startChambers: 2, startCoconuts: 2 });
  assert.deepEqual(engine.knobs, expected);
  assert.equal('hacked' in engine.knobs, false);

  // maxPlay is additionally capped at handSize.
  const capped = makeChaos({ handSize: 3, maxPlay: 4 }).engine;
  assert.equal(capped.knobs.maxPlay, 3);

  // §B.2: chaosKnobs is announced at start, BEFORE the first deal frame.
  engine.start();
  const knobEvts = byType(events, MSG.MODE_EVENT).filter((e) => e.p.kind === CHAOS_EVENTS.KNOBS);
  assert.equal(knobEvts.length, 1);
  assert.deepEqual(knobEvts[0].p.knobs, expected);
  assert.ok(events.indexOf(knobEvts[0]) < events.findIndex((e) => e.t === MSG.HAND));

  // Snapshot echoes the knobs for every consumer (seat, spectator).
  const snap = engine.snapshotFor(0);
  assert.equal(snap.mode, 'customChaos');
  assert.deepEqual(snap.knobs, expected);
  assert.equal(snap.yourHand.length, 7);
  const spectator = engine.snapshotFor(null);
  assert.deepEqual(spectator.knobs, expected);
  assert.equal(spectator.yourHand, null, 'spectator filtering intact');
});

test('missing knobs fall back to the schema defaults (a default game is stock ML)', () => {
  const { engine } = makeChaos(undefined, { seed: 6 });
  assert.deepEqual(engine.knobs, { ...DEFAULT_KNOBS });
  engine.start();
  assert.equal(engine.snapshotFor(0).yourHand.length, DEFAULT_KNOBS.handSize);
});

// ---------------------------------------------------------------------------
// Per-knob behavior
// ---------------------------------------------------------------------------

test('handSize + goldenPerPlayer: deals and deck composition follow the knobs', () => {
  for (const [handSize, goldenPerPlayer] of [[3, 0], [7, 2], [5, 1]]) {
    const { engine, events } = makeChaos({ handSize, goldenPerPlayer }, { seed: 9 });
    engine.start();
    const hands = byType(events, MSG.HAND);
    assert.equal(hands.length, 4);
    let golden = 0;
    for (const e of hands) {
      assert.equal(e.p.cards.length, handSize, `handSize ${handSize} must deal ${handSize}`);
      golden += e.p.cards.filter((c) => c.fruit === FRUITS.GOLDEN).length;
    }
    assert.equal(
      golden,
      goldenPerPlayer * 4,
      `goldenPerPlayer ${goldenPerPlayer} must put exactly ${goldenPerPlayer * 4} wilds in play`
    );
    // The brain's deck model must agree with the engine's local deck wrapper.
    const knobs = engine.knobs;
    const perFruit = Math.floor((4 * handSize - golden) / 3);
    assert.equal(knobDeckTruthyTotal(knobs, 4), perFruit + golden);
  }
});

test('maxPlay: the knob band is enforced (1 restricts, 4 extends past stock 3)', () => {
  // maxPlay 1: two cards are INVALID.
  const one = makeChaos({ maxPlay: 1 }, { seed: 4 });
  one.engine.start();
  let seat = one.engine.turnSeat;
  let hand = one.table.get(seat).hand;
  assert.equal(one.engine.play(seat, [hand[0].id, hand[1].id]).code, ERROR_CODES.INVALID_CARDS);
  assert.ok(one.engine.play(seat, [hand[0].id]).ok);

  // maxPlay 4: a 4-card play (illegal in stock ML) goes through; 5 does not.
  const four = makeChaos({ maxPlay: 4 }, { seed: 4 });
  four.engine.start();
  seat = four.engine.turnSeat;
  hand = four.table.get(seat).hand;
  assert.equal(
    four.engine.play(seat, hand.slice(0, 5).map((c) => c.id)).code,
    ERROR_CODES.INVALID_CARDS
  );
  assert.ok(four.engine.play(seat, hand.slice(0, 4).map((c) => c.id)).ok);
});

test('startChambers/startCoconuts: penalty frames and cannon math ride the knobs', () => {
  // 2 chambers, 2 coconuts → certain hit; roll 0.99 only hits when p = 1.
  const { engine, table, events } = makeChaos(
    { startChambers: 2, startCoconuts: 2 },
    { seed: 13, cannonRng: () => 0.99 }
  );
  engine.start();
  for (const s of table.seats) {
    assert.equal(s.chambersLeft, 2);
    assert.equal(s.coconuts, 2);
  }
  const first = engine.turnSeat;
  assert.ok(engine.play(first, [table.get(first).hand[0].id]).ok);
  assert.ok(engine.callLiar(engine.turnSeat).ok);
  const pen = byType(events, MSG.PENALTY).at(-1);
  assert.equal(pen.p.chambers, 2);
  assert.equal(pen.p.coconuts, 2);
  engine.onTimeout('penalty');
  assert.equal(byType(events, MSG.CANNON).at(-1).p.hit, true, '2/2 chambers is a certain hit');
});

test('chipsPerMatch/chipBonus: chip inventory and the bolt-on chamber bonus follow the knobs', () => {
  // chipsPerMatch 0: nobody can chip — penalty frames say so, useChip rejects.
  const none = makeChaos({ chipsPerMatch: 0 }, { seed: 17, cannonRng: () => 0.99 });
  none.engine.start();
  for (const s of none.table.seats) assert.equal(s.chips, 0);
  let seat = none.engine.turnSeat;
  assert.ok(none.engine.play(seat, [none.table.get(seat).hand[0].id]).ok);
  assert.ok(none.engine.callLiar(none.engine.turnSeat).ok);
  const pen = byType(none.events, MSG.PENALTY).at(-1);
  assert.equal(pen.p.chipUsable, false);
  assert.equal(none.engine.useChip(pen.p.seat).code, ERROR_CODES.BAD_STATE);

  // chipsPerMatch 3 + chipBonus 4: the chip fires with chambers + 4.
  const rich = makeChaos(
    { chipsPerMatch: 3, chipBonus: 4, startChambers: 2 },
    { seed: 17, cannonRng: () => 0.99 }
  );
  rich.engine.start();
  for (const s of rich.table.seats) assert.equal(s.chips, 3);
  seat = rich.engine.turnSeat;
  assert.ok(rich.engine.play(seat, [rich.table.get(seat).hand[0].id]).ok);
  assert.ok(rich.engine.callLiar(rich.engine.turnSeat).ok);
  const victim = byType(rich.events, MSG.PENALTY).at(-1).p.seat;
  assert.ok(rich.engine.useChip(victim).ok);
  const chip = byType(rich.events, MSG.CHIP_USED).at(-1);
  assert.equal(chip.p.chambersNow, 2 + 4, 'chipBonus 4 must bolt 4 temporary chambers on');
  assert.equal(rich.table.get(victim).chips, 2);
});

// ---------------------------------------------------------------------------
// Knob matrix — extremes play full sims to matchEnd
// ---------------------------------------------------------------------------

test('knob matrix: extreme combos all play to matchEnd with knob-true frames', () => {
  const matrix = [
    { handSize: 3, startChambers: 2 },
    { handSize: 3, startChambers: 8, maxPlay: 1, goldenPerPlayer: 0 },
    { handSize: 7, startChambers: 2, startCoconuts: 3, chipsPerMatch: 0 },
    { handSize: 7, startChambers: 8, maxPlay: 4, goldenPerPlayer: 2, chipBonus: 4 },
  ];
  for (const patch of matrix) {
    for (const seed of [31, 32, 33]) {
      const { engine, events } = makeChaos(patch, { seed });
      const knobs = engine.knobs;
      engine.start();
      runToMatchEnd(engine);

      assert.ok(byType(events, MSG.MATCH_END).length === 1, JSON.stringify(patch));
      assert.notEqual(engine.winnerSeat, -1);
      // Every deal honored handSize; every play honored maxPlay.
      for (const e of byType(events, MSG.HAND)) assert.equal(e.p.cards.length, knobs.handSize);
      for (const e of byType(events, MSG.PLAYED)) assert.ok(e.p.count <= knobs.maxPlay);
      // Round-1 penalties (no chambers burned yet) advertise the knob cannon.
      const round2At = events.findIndex((e) => e.t === MSG.ROUND_START && e.p.roundNo === 2);
      for (const e of byType(round2At === -1 ? events : events.slice(0, round2At), MSG.PENALTY)) {
        assert.equal(e.p.chambers, knobs.startChambers, JSON.stringify(patch));
        assert.equal(e.p.coconuts, knobs.startCoconuts, JSON.stringify(patch));
        if (knobs.chipsPerMatch === 0) assert.equal(e.p.chipUsable, false);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 60 headless bot-only matches under non-default knobs
// ---------------------------------------------------------------------------

const BOT_KNOBS = Object.freeze(
  validateKnobs({
    handSize: 6,
    maxPlay: 2,
    startChambers: 3,
    startCoconuts: 2,
    chipsPerMatch: 2,
    chipBonus: 3,
    goldenPerPlayer: 0,
  })
);

/**
 * One full bot-only Chaos match (mirrors botBrain.test.js's runBotMatch with
 * the chaos brain + knob assertions). Every action is legality-checked.
 */
function runChaosBotMatch({ seed, seatPersonalities, knobs = BOT_KNOBS }) {
  const table = createTable(
    seatPersonalities.map((p, i) => ({ playerId: `bot-${i}`, name: p, isBot: true, personality: p }))
  );
  const brains = seatPersonalities.map((p, i) =>
    createBrain({ seat: i, personalityId: p, rng: mulberry32((seed * 7919 + i * 104729) >>> 0) })
  );
  const stats = { plays: 0, calls: 0, chips: 0 };

  const engine = createEngine({
    table,
    seed,
    knobs,
    onEvent: (e) => {
      const env = { t: e.t, p: e.p };
      if (e.seat !== undefined) brains[e.seat].observe(env);
      else for (const b of brains) b.observe(env);
    },
  });

  engine.start();
  // Brains learned the knobs from the chaosKnobs modeEvent at start.
  for (const b of brains) assert.deepEqual(b.inspect().knobs, { ...knobs });

  let steps = 0;
  while (engine.phase !== 'matchEnd') {
    assert.ok(++steps < 5000, `Chaos match (seed ${seed}) stalled without a winner`);
    if (engine.phase === 'playing') {
      const seat = engine.turnSeat;
      const action = brains[seat].decideTurn();
      assert.ok(action, `brain at seat ${seat} had no action on its own turn`);
      if (action.type === 'call') {
        const res = engine.callLiar(seat);
        assert.ok(res.ok, `ILLEGAL call by ${seatPersonalities[seat]}: ${res.code}`);
        stats.calls += 1;
      } else {
        assert.equal(action.type, 'play');
        assert.ok(
          action.cardIds.length <= knobs.maxPlay,
          `brain sized a ${action.cardIds.length}-card play past maxPlay ${knobs.maxPlay}`
        );
        const res = engine.play(seat, action.cardIds);
        assert.ok(res.ok, `ILLEGAL play by ${seatPersonalities[seat]}: ${res.code}`);
        stats.plays += 1;
      }
      brains[seat].onOwnActionApplied(action);
    } else if (engine.phase === 'penalty') {
      const pen = engine.inspect().penalty;
      const decision = brains[pen.seat].decidePenalty();
      assert.ok(decision, `brain at seat ${pen.seat} ignored its own penalty window`);
      if (decision.useChip) {
        assert.ok(table.get(pen.seat).chips > 0, 'brain tried to spend a chip it no longer has');
        const res = engine.useChip(pen.seat);
        assert.ok(res.ok, `ILLEGAL chip by ${seatPersonalities[pen.seat]}: ${res.code}`);
        stats.chips += 1;
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

test('60 bot-only Chaos matches under non-default knobs: legal, terminating, knob-aware', () => {
  const N = 60;
  let plays = 0;
  let calls = 0;
  let chips = 0;
  for (let m = 0; m < N; m++) {
    const order = PERSONALITY_IDS.map((_, i) => PERSONALITY_IDS[(i + m) % PERSONALITY_IDS.length]);
    const stats = runChaosBotMatch({ seed: 9000 + m, seatPersonalities: order.slice(0, 4) });
    plays += stats.plays;
    calls += stats.calls;
    chips += stats.chips;
  }
  assert.ok(plays > 0 && calls > 0, `bots must both play and call (${plays}/${calls})`);
  assert.ok(chips > 0, 'with 2 chips and a 2/3 cannon, bots must spend chips sometimes');
});

test('bot matches also complete at the knob extremes (schema min/max everything)', () => {
  const minKnobs = validateKnobs(
    Object.fromEntries(Object.keys(CHAOS_KNOB_SCHEMA).map((k) => [k, CHAOS_KNOB_SCHEMA[k].min]))
  );
  const maxKnobs = validateKnobs(
    Object.fromEntries(Object.keys(CHAOS_KNOB_SCHEMA).map((k) => [k, CHAOS_KNOB_SCHEMA[k].max]))
  );
  for (const knobs of [minKnobs, maxKnobs]) {
    for (let m = 0; m < 5; m++) {
      runChaosBotMatch({
        seed: 7700 + m,
        seatPersonalities: ['aggressive', 'cautious', 'trollish', 'mathematical'],
        knobs,
      });
    }
  }
});
