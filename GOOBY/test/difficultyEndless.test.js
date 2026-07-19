// V4/G75 — difficulty/endless cross-game integration (PLAN4 §E G75,
// PLAN4-GAMES §G5.3–§G5.6, ruling §E0.1-14): the cross-game contract file
// the wave-3 rollout certifies against.
//
//   1. §G5.4 targets table: data/difficultyTargets.js rows VERBATIM against
//      the plan oracle, capScore === divisor × rowMax (coin-table cross-
//      check), §G5.1 exclusions absent, accessor behaviour.
//   2. §G5.3 applyDifficulty contract per game: export exists, base tune
//      discoverable + frozen, Mittel identity (bit-identical), unknown-mode
//      normalization, easy/hard actually derive, the §G5.3 guardrail ratio
//      band (never below 55 % of Mittel on non-bot knobs), endless mode
//      distinct + end-condition marker (§G5.4 rows).
//   3. §G5.5 unlock & persistence semantics e2e across the REAL seam:
//      economy.awardMinigame writes → framework.logic reads (beaten/
//      bestByDiff/endlessBest boards, L9-vs-L10 endless lock, improvement-
//      only endless board, endless never a persisted selection).
//   4. §G5.6 endless surfaces: source pins for the seams G56/G68 landed
//      (results ∞ row + newBest badge, arcade tile ∞ chip, pregame pills +
//      lock copy) and EN/DE parity of the endless strings.
//
// Wave-3 batches (G71–G74) merge CONCURRENTLY: games whose .logic.js does
// not yet export applyDifficulty are reported as TODO (never failed) — the
// per-game assertions arm automatically as each batch lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { TARGETS, getTarget } from '../src/data/difficultyTargets.js';
import { getMinigame } from '../src/data/minigames.js';
import {
  DIFFICULTY_EXCLUDED_GAMES,
  ENDLESS_MIN_LEVEL,
  endlessUnlocked,
  difficultySliceOf,
  bestForMode,
} from '../src/minigames/framework.logic.js';
import { awardMinigame, healthReady } from '../src/systems/economy.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';
import * as clock from '../src/core/clock.js';
import { EN as DIFF_EN, DE as DIFF_DE } from '../src/data/strings/v4-difficulty.js';
import { EN as ARC_EN, DE as ARC_DE } from '../src/data/strings/v4-arcade.js';

await healthReady; // settle economy's optional health probe (economy.test.js pattern)

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// §G5.4 oracle — the PLAN4-GAMES table VERBATIM (cap-score + Schwer-Ziel).
// difficultyTargets.js must match row for row; targets are never edited to
// make a bot pass (§G5.4: params are relaxed, never the target raised).
// ---------------------------------------------------------------------------
const G54_ORACLE = Object.freeze({
  carrotCatch: { capScore: 75, target: 70 },
  bunnyHop: { capScore: 50, target: 45 },
  carrotGuard: { capScore: 75, target: 70 },
  goobySays: { capScore: 120, target: 70 },
  memoryMatch: { capScore: 48, target: 40 },
  basketBounce: { capScore: 78, target: 65 },
  gardenRush: { capScore: 75, target: 65 },
  pancakeTower: { capScore: 52, target: 45 },
  burgerBuild: { capScore: 104, target: 85 },
  shoppingSurf: { capScore: 1360, target: 900 },
  runner: { capScore: 450, target: 380 },
  veggieChop: { capScore: 130, target: 105 },
  purblePlace: { capScore: 150, target: 120 },
  bubblePop: { capScore: 96, target: 80 },
  deliveryRush: { capScore: 256, target: 200 },
  fishingPond: { capScore: 78, target: 65 },
  danceParty: { capScore: 168, target: 140 },
  miniGolf: { capScore: 140, target: 110 },
  trampoline: { capScore: 130, target: 105 },
  goalieGooby: { capScore: 78, target: 65 },
  starHopper: { capScore: 234, target: 190 },
  pipeFlow: { capScore: 125, target: 100 },
  toyRacer: { capScore: 180, target: 150 },
  ghostHunt: { capScore: 112, target: 90 },
  rocketRescue: { capScore: 140, target: 115 },
  harborHopper: { capScore: 150, target: 110 },
});
const GAME_IDS = Object.keys(G54_ORACLE);

// Bot/autoplay knobs are exempt from the player-facing guardrail band —
// batch agents tune bot skill per mode for beatability (§G5.4), which may
// move against the difficulty direction (e.g. less distraction on Schwer).
const BOT_KEY = /BOT|AUTOPLAY|DISTRACT/i;
// §G5.3 guardrail: Schwer never below 55 % of Mittel; sanity ceiling for
// both directions (families top out around ×1.25 windows / ×2 par slack).
const RATIO_MIN = 0.549;
const RATIO_MAX = 2.051;

/** @type {Record<string, object|null>} gameId → logic module (null = missing) */
const modules = {};
for (const id of GAME_IDS) {
  try {
    modules[id] = await import(`../src/minigames/games/${id}.logic.js`);
  } catch {
    modules[id] = null;
  }
}
const mergedIds = GAME_IDS.filter((id) => typeof modules[id]?.applyDifficulty === 'function');
const pendingIds = GAME_IDS.filter((id) => !mergedIds.includes(id));

/**
 * Discover the frozen base tune applyDifficulty defaults to (convention:
 * `applyDifficulty(tune = NAME, mode …)` — every wave-3 batch follows it).
 * @param {string} id
 * @returns {string|null} export name
 */
function baseTuneName(id) {
  const src = readFileSync(join(root, `src/minigames/games/${id}.logic.js`), 'utf8');
  return src.match(/applyDifficulty\s*\(\s*tune\s*=\s*([A-Z_][A-Z0-9_]*)/)?.[1] ?? null;
}

/** Strip the per-game mode marker keys before comparing derived tunes. */
function withoutModeMarker(tune) {
  const copy = { ...tune };
  delete copy.mode;
  delete copy.MODE;
  return copy;
}

// ---------------------------------------------------------------------------
// 1. §G5.4 targets table
// ---------------------------------------------------------------------------

test('§G5.4 targets table: 26 rows verbatim, capScore = divisor × rowMax, exclusions absent', () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), GAME_IDS.slice().sort(), 'exactly the 26 §G5.1 games');
  for (const id of GAME_IDS) {
    const row = TARGETS[id];
    assert.equal(row.target, G54_ORACLE[id].target, `${id} Schwer-Ziel verbatim`);
    assert.equal(row.capScore, G54_ORACLE[id].capScore, `${id} cap-score verbatim`);
    assert.ok(row.target < row.capScore, `${id} target < capScore`);
    assert.ok(typeof row.endless === 'string' && row.endless.length > 0, `${id} Endlos end-condition documented`);
    const coinTable = getMinigame(id).coinTable;
    assert.equal(row.capScore, coinTable.divisor * coinTable.max, `${id} capScore == divisor × rowMax (§G5.4 rule)`);
  }
  for (const id of [...DIFFICULTY_EXCLUDED_GAMES, '_smoke']) {
    assert.equal(TARGETS[id], undefined, `${id} excluded by §G5.1 — no row`);
    assert.equal(getTarget(id), null);
  }
  assert.equal(getTarget('carrotCatch'), 70);
});

// ---------------------------------------------------------------------------
// 2. §G5.3 applyDifficulty contract per game (TODO until the batch merges)
// ---------------------------------------------------------------------------

test('§G5.1 wave-3 rollout coverage: all 26 games export applyDifficulty', (t) => {
  if (pendingIds.length > 0) {
    t.todo(`skip-with-TODO (§E G75) — awaiting batch merge: ${pendingIds.join(', ')}`);
    return;
  }
  assert.equal(mergedIds.length, GAME_IDS.length);
});

for (const id of GAME_IDS) {
  test(`§G5.3 applyDifficulty contract: ${id}`, (t) => {
    const mod = modules[id];
    if (typeof mod?.applyDifficulty !== 'function') {
      t.todo('TODO: not merged with difficulty params yet (concurrent wave-3 batch)');
      return;
    }
    const baseName = baseTuneName(id);
    assert.ok(baseName, `${id}: applyDifficulty defaults to an exported base tune`);
    const base = mod[baseName];
    assert.ok(base && typeof base === 'object' && Object.isFrozen(base), `${id}: base ${baseName} exported + frozen`);

    const derived = {};
    for (const mode of ['easy', 'normal', 'hard', 'endless']) {
      derived[mode] = mod.applyDifficulty(undefined, mode);
      assert.ok(Object.isFrozen(derived[mode]), `${id}: derived ${mode} tune is frozen`);
    }

    // Mittel identity — §G5.2: current live numbers, bit-identical.
    for (const key of Object.keys(base)) {
      assert.deepEqual(derived.normal[key], base[key], `${id}: normal keeps ${key} bit-identical`);
    }
    // Unknown modes normalize to Mittel.
    assert.deepEqual(
      withoutModeMarker(mod.applyDifficulty(undefined, 'banana')),
      withoutModeMarker(derived.normal),
      `${id}: unknown mode normalizes to 'normal'`
    );

    // Easy/hard actually derive something (the mode does something).
    for (const mode of ['easy', 'hard']) {
      const changed = Object.keys(base).filter(
        (k) => typeof base[k] === 'number' && derived[mode][k] !== base[k]
      );
      assert.ok(changed.length >= 1, `${id}: ${mode} changes ≥ 1 numeric knob`);
    }

    // §G5.3 guardrail band on non-bot numeric knobs (both directions).
    for (const mode of ['easy', 'hard']) {
      for (const key of Object.keys(base)) {
        if (BOT_KEY.test(key)) continue;
        if (typeof base[key] !== 'number' || !(base[key] > 0)) continue;
        if (typeof derived[mode][key] !== 'number') continue;
        const ratio = derived[mode][key] / base[key];
        assert.ok(
          ratio >= RATIO_MIN && ratio <= RATIO_MAX,
          `${id}: ${mode} ${key} ratio ${ratio.toFixed(3)} inside the §G5.3 guardrail band [0.55, 2.05]`
        );
      }
    }

    // Endlos — §G5.4: distinct mode with an end-condition marker (either a
    // truthy ENDLESS* flag or an extended-ramp delta vs the Schwer params).
    const vsNormal = Object.keys(derived.endless).filter(
      (k) => derived.endless[k] !== derived.normal[k]
    );
    assert.ok(vsNormal.length >= 1, `${id}: endless differs from normal`);
    const endlessFlag = Object.keys(derived.endless).some(
      (k) => /ENDLESS/i.test(k) && derived.endless[k] === true
    );
    const vsHard = Object.keys(derived.endless).filter(
      (k) => derived.endless[k] !== derived.hard[k]
    );
    assert.ok(
      endlessFlag || vsHard.length >= 1,
      `${id}: endless carries an end-condition flag or extends the Schwer ramp (§G5.4 row)`
    );
  });
}

// ---------------------------------------------------------------------------
// 3. §G5.5 unlock & persistence semantics e2e (economy writes → logic reads)
// ---------------------------------------------------------------------------

test('§G5.5 e2e: beat Schwer at L9 stays locked, L10 unlocks; boards + improvement-only endlessBest', () => {
  const [y, m, d] = [2026, 9, 20];
  clock.configure({ now: new Date(y, m - 1, d, 12).getTime() });
  const store = createStore(defaultState(), { autosave: false });
  const id = 'carrotCatch';
  const target = getTarget(id);
  store.update((s) => {
    s.level = ENDLESS_MIN_LEVEL - 1;
  });

  assert.equal(endlessUnlocked(store.get(), id), false, 'fresh save: locked');

  // Clear easy + normal (the pre-game tick markers share the target number).
  awardMinigame(store, id, target, { difficulty: 'easy' });
  awardMinigame(store, id, target + 2);
  assert.equal(store.get(`minigames.beaten.${id}.easy`), true);
  assert.equal(store.get(`minigames.beaten.${id}.normal`), true);
  assert.equal(endlessUnlocked(store.get(), id), false, 'easy/normal never unlock endless');

  // Beat Schwer at L9 → beaten.hard set, endless STILL locked (level gate).
  awardMinigame(store, id, target + 5, { difficulty: 'hard' });
  assert.equal(store.get(`minigames.beaten.${id}.hard`), true);
  assert.equal(store.get(`minigames.bestByDiff.${id}.hard`), target + 5);
  assert.equal(endlessUnlocked(store.get(), id), false, 'L9: beaten.hard alone is not enough');

  // L10 → unlocked (§G5.5: beaten[id].hard && level ≥ 10).
  store.update((s) => {
    s.level = ENDLESS_MIN_LEVEL;
  });
  assert.equal(endlessUnlocked(store.get(), id), true, 'L10 + beaten.hard unlocks');

  // Endless board: improvement-only writes, Mittel board untouched.
  awardMinigame(store, id, 40, { difficulty: 'endless' });
  assert.equal(store.get(`minigames.endlessBest.${id}`), 40);
  awardMinigame(store, id, 25, { difficulty: 'endless' });
  assert.equal(store.get(`minigames.endlessBest.${id}`), 40, 'worse endless run never regresses the board');
  awardMinigame(store, id, 55, { difficulty: 'endless' });
  assert.equal(store.get(`minigames.endlessBest.${id}`), 55, 'better endless run improves the board');
  assert.equal(bestForMode(store.get(), id, 'endless'), 55);
  assert.equal(store.get(`minigames.best.${id}`), target + 2, 'Mittel board keeps only the normal round');

  // 'endless' is a launch mode, never a persisted selection (§G5.5).
  store.update((s) => {
    s.minigames.difficulty = { [id]: 'endless' };
  });
  assert.equal(difficultySliceOf(store.get(), id).selected, 'normal', 'hostile endless selection coerces to normal');
});

// ---------------------------------------------------------------------------
// 4. §G5.6 endless surfaces (G56 results row / G68 boards) — seam pins
// ---------------------------------------------------------------------------

test('§G5.6 endless surfaces landed: results ∞ row + arcade ∞ chip + pregame lock copy (source pins)', () => {
  const fw = readFileSync(join(root, 'src/minigames/framework.js'), 'utf8');
  assert.match(fw, /mg\.results\.endlessBest/, 'framework results screen renders the Endlos-Best row (G56)');
  assert.match(fw, /endlessNewBest/, 'framework results carry the endless newBest badge flag (G56)');
  assert.match(fw, /mg\.results\.newBest/, 'the ∞ row wears the „Neuer Rekord!" badge on improvement');

  const arcade = readFileSync(join(root, 'src/ui/arcadeScreen.js'), 'utf8');
  assert.match(arcade, /arcade\.endless\.short/, 'arcade tile info row shows „∞ {n}" (G68 §G7.2)');
  assert.match(arcade, /endlessUnlocked\(/, 'the ∞ chip is gated on the §G5.5 unlock');

  const pregame = readFileSync(join(root, 'src/ui/pregameScreen.js'), 'utf8');
  assert.match(pregame, /pillStates\(/, 'pregame difficulty pills render lock/beaten states (G68 §G5.6)');
  assert.match(pregame, /g68-pill-tick/, 'beaten modes wear a checkmark tick');

  const arcadeLogic = readFileSync(join(root, 'src/ui/arcadeUi.logic.js'), 'utf8');
  assert.match(arcadeLogic, /pregame\.endlessLocked/, 'locked Endlos pill line uses the §G5.5 lock copy');
});

test('§G5.6 endless strings: EN/DE parity for the ∞ seams', () => {
  for (const key of ['mg.diff.endless', 'mg.diff.coins.endless', 'mg.results.endlessBest', 'toast.endlessLocked', 'mg.diff.lock']) {
    assert.ok(DIFF_EN[key], `v4-difficulty EN has ${key}`);
    assert.ok(DIFF_DE[key], `v4-difficulty DE has ${key}`);
  }
  for (const key of ['arcade.endless.short', 'pregame.endlessLocked']) {
    assert.ok(ARC_EN[key], `v4-arcade EN has ${key}`);
    assert.ok(ARC_DE[key], `v4-arcade DE has ${key}`);
  }
  assert.match(ARC_EN['arcade.endless.short'], /∞/);
  assert.match(ARC_DE['pregame.endlessLocked'], /ab L10/);
});
