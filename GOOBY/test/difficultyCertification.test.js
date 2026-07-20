// V4/G75 — 26-game difficulty CERTIFICATION suite (PLAN4 §E G75,
// PLAN4-GAMES §G5.4): runs every merged game's own deterministic headless
// certification bot at each §G5.2 mode over fixed seeds and asserts the
// §G5.4 acceptance programmatically — logic-level, no browser:
//
//   • determinism: same seed + mode → same score (CI-stable bots),
//   • every mode completes with a finite score ≥ 0 (incl. an Endlos run
//     that terminates through its §G5.4 end-condition),
//   • Schwer beatable: the bot reaches the §G5.4 target in ≥ 1 of 5
//     seeded Schwer runs (the plan-C eval gate),
//   • difficulty does its job: the bot's mean over 10 seeds on Leicht is
//     ≥ its Schwer mean (monotone means — easier mode, higher scores).
//
// The final test prints the full certification grid (game × mode: 3 runs +
// mean + target hits) for the wave-3 report.
//
// Wave-3 batches (G71–G74) merge CONCURRENTLY: games without difficulty
// params yet are reported as TODO, never failed. KNOWN_GAPS carries the
// §G5.4-rule findings already filed with the coordinator (params get
// relaxed by the OWNING batch agent — never here, never the target): those
// checks turn into TODO notes until the fix lands, then auto-arm again.
import test from 'node:test';
import assert from 'node:assert/strict';

import { TARGETS } from '../src/data/difficultyTargets.js';

/** §E G75: 3 certification runs per game × mode for the report grid. */
const GRID_SEEDS = Object.freeze([11, 22, 33]);
/** §G5.4: Schwer beatability gate = ≥ 1 target hit over 5 seeded runs. */
const HARD_SEEDS = Object.freeze([11, 22, 33, 44, 55]);
/** Monotone-means sample (large enough to ride out per-seed variance). */
const MEAN_SEEDS = Object.freeze(Array.from({ length: 10 }, (_, i) => (i + 1) * 7919));

// ---------------------------------------------------------------------------
// Adapter registry: gameId → [simExportName, signature]. Every wave-3 batch
// ships a deterministic pure certification sim next to applyDifficulty;
// signatures: 'ms' = f(mode, seed), 'sm' = f(seed, mode),
// 'purble' = simulateRound(seed, { difficulty }). A merged game without an
// adapter row (or whose export vanished) reports TODO — extend this table.
// ---------------------------------------------------------------------------
const ADAPTERS = Object.freeze({
  carrotCatch: ['simulateCatchAutoplay', 'ms'],
  bunnyHop: ['simulateHopAutoplay', 'ms'],
  carrotGuard: ['simulateGuardAutoplay', 'ms'],
  goobySays: ['simulateAutoplay', 'sm'],
  memoryMatch: ['simulateMemoryAutoplay', 'ms'],
  basketBounce: ['simulateBasketAutoplay', 'ms'],
  gardenRush: ['simulateAutoplay', 'sm'],
  pancakeTower: ['simulatePancakeAutoplay', 'ms'],
  burgerBuild: ['simulateAutoplay', 'sm'],
  shoppingSurf: ['simulateSurfAutoplay', 'ms'],
  runner: ['simulateRunnerAutoplay', 'ms'],
  veggieChop: ['simulateAutoplay', 'sm'],
  purblePlace: ['simulateRound', 'purble'],
  bubblePop: ['simulateBubbleAutoplay', 'sm'],
  deliveryRush: ['simulateDeliveryAutoplay', 'sm'],
  fishingPond: ['simulateFishingAutoplay', 'sm'],
  danceParty: ['simulateDanceAutoplay', 'sm'],
  miniGolf: ['simulateGolfAutoplay', 'sm'],
  trampoline: ['simulateTrampolineAutoplay', 'sm'],
  goalieGooby: ['simulateAutoplay', 'sm'],
  starHopper: ['simulateHopperAutoplay', 'sm'],
  pipeFlow: ['simulatePipeAutoplay', 'sm'],
  toyRacer: ['simulateRacerAutoplay', 'ms'],
  ghostHunt: ['simulateHuntAutoplay', 'ms'],
  rocketRescue: ['simulateRocketAutoplay', 'ms'],
  harborHopper: ['simulateHarborAutoplay', 'ms'],
});

// ---------------------------------------------------------------------------
// KNOWN_GAPS — §G5.4 findings filed for the owning batch agents (G75 report
// items; foreign game tunes are NEVER edited here). While a gap is open the
// affected check reports TODO; once the batch agent's fix lands the strict
// assertion re-arms automatically (the todo path only triggers on failure).
// ---------------------------------------------------------------------------
const KNOWN_GAPS = Object.freeze({
});

const CERT_GAMES = Object.keys(TARGETS);

/** @type {Record<string, {call: (mode: string, seed: number) => {score: number}}|null|'pending'>} */
const runners = {};
for (const id of CERT_GAMES) {
  runners[id] = 'pending';
  let mod = null;
  try {
    mod = await import(`../src/minigames/games/${id}.logic.js`);
  } catch {
    continue;
  }
  if (typeof mod?.applyDifficulty !== 'function') continue;
  const adapter = ADAPTERS[id];
  if (!adapter || typeof mod[adapter[0]] !== 'function') {
    runners[id] = null; // merged but not certifiable — needs an adapter row
    continue;
  }
  const fn = mod[adapter[0]];
  const sig = adapter[1];
  runners[id] = {
    call(mode, seed) {
      if (sig === 'ms') return fn(mode, seed);
      if (sig === 'sm') return fn(seed, mode);
      if (sig === 'purble') return fn(seed, { difficulty: mode });
      throw new Error(`unknown adapter signature '${sig}' for ${id}`);
    },
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const scoreOf = (r) => Math.floor(Number(r?.score) || 0);

/** collected per-game grid rows for the report printer */
const grid = [];

for (const id of CERT_GAMES) {
  test(`§G5.4 certification: ${id}`, (t) => {
    const runner = runners[id];
    const target = TARGETS[id].target;
    if (runner === 'pending') {
      grid.push({ game: id, status: 'TODO — not merged with difficulty params' });
      t.todo('TODO: not merged with difficulty params yet (concurrent wave-3 batch)');
      return;
    }
    if (runner == null) {
      grid.push({ game: id, status: 'TODO — merged, but no certification adapter' });
      t.todo('TODO: applyDifficulty merged but no certification-sim adapter — extend ADAPTERS');
      return;
    }

    // Determinism (CI-stable bots).
    assert.equal(
      scoreOf(runner.call('hard', HARD_SEEDS[0])),
      scoreOf(runner.call('hard', HARD_SEEDS[0])),
      `${id}: same seed + mode reproduces the same score`
    );

    // Grid rows: every mode completes with a finite score ≥ 0.
    const row = { game: id, target, modes: {} };
    for (const mode of ['easy', 'normal', 'hard', 'endless']) {
      const seeds = mode === 'hard' ? HARD_SEEDS : GRID_SEEDS;
      const scores = seeds.map((seed) => {
        const result = runner.call(mode, seed);
        const s = scoreOf(result);
        assert.ok(Number.isFinite(s) && s >= 0, `${id}/${mode} seed ${seed}: finite score ≥ 0 (got ${result?.score})`);
        return s;
      });
      row.modes[mode] = {
        scores,
        mean: Math.round(mean(scores)),
        hits: scores.filter((s) => s >= target).length,
      };
    }
    grid.push(row);

    // §G5.4 gate: Schwer beatable in ≥ 1 of 5 seeded runs.
    const hardHits = row.modes.hard.hits;
    if (hardHits < 1 && KNOWN_GAPS[id]?.hardBeatable) {
      t.todo(`KNOWN GAP — ${KNOWN_GAPS[id].hardBeatable}`);
    } else {
      assert.ok(hardHits >= 1, `${id}: Schwer target ${target} reached in ${hardHits}/5 seeded runs (§G5.4 needs ≥ 1)`);
    }

    // Monotone means: Leicht ≥ Schwer over the wider sample.
    const easyMean = mean(MEAN_SEEDS.map((seed) => scoreOf(runner.call('easy', seed))));
    const hardMean = mean(MEAN_SEEDS.map((seed) => scoreOf(runner.call('hard', seed))));
    if (easyMean < hardMean && KNOWN_GAPS[id]?.monotoneMeans) {
      t.todo(`KNOWN GAP — ${KNOWN_GAPS[id].monotoneMeans}`);
    } else {
      assert.ok(
        easyMean >= hardMean,
        `${id}: bot means monotone — easy ${easyMean.toFixed(1)} ≥ hard ${hardMean.toFixed(1)} over ${MEAN_SEEDS.length} seeds`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Certification grid printer (the §E G75 report table — captured as build
// evidence; TAP-safe comment lines).
// ---------------------------------------------------------------------------
test('certification grid (report output)', () => {
  const lines = ['', `# G75 certification grid — game × mode (seeds ${GRID_SEEDS.join('/')}, hard +${HARD_SEEDS.slice(3).join('/')})`];
  for (const row of grid) {
    if (row.status) {
      lines.push(`# ${row.game.padEnd(14)} ${row.status}`);
      continue;
    }
    const cell = (m) => {
      const d = row.modes[m];
      return `${String(d.mean).padStart(5)} [${d.scores.join(',')}] ${d.hits}/${d.scores.length}≥T`;
    };
    lines.push(
      `# ${row.game.padEnd(14)} T=${String(row.target).padStart(4)} | E ${cell('easy')} | N ${cell('normal')} | H ${cell('hard')} | ∞ ${cell('endless')}`
    );
  }
  lines.push('# (cityDrive/goobyWelt/_smoke excluded by §G5.1 — single difficulty by design)');
  console.log(lines.join('\n'));
  assert.ok(grid.length === CERT_GAMES.length, 'every §G5.4 row reported');
});
