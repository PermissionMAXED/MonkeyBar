// Framework 2.0 — V4/G56 (PLAN4-GAMES §G3.3/§G5, PLAN4 §C-SYS3.1/§C-SYS7.1,
// §E0.1-2/-13):
//   • invert-proxy transform table (invertPayload) + wrap semantics
//   • difficulty coin math: ×1 bit-identical to the live §C6 rowClamp,
//     ×0.7 floors at row min, ×1.3 caps at row max, and the FROZEN stacking
//     order (row clamp → difficulty mult → row max cap → daily ×2)
//   • endless payout path: flat 5 c override, daily ×2 after
//   • §G5.5 slice readers defensive against the pre-G53 save shape
//   • §C-SYS7.1 sick-gate matrix (trips/travel allowed, arcade blocked)
//   • xpGranted single-emit ruling: runtime emit from applyXp + the
//     §C-SYS3.1 static-analysis walk over every applyXp(/grantXp( call site
//   • §C-SYS3.3 nextUnlock ordering + async-lifecycle source guards
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { invertPayload, wrapInvertInput } from '../src/core/inputInvert.js';
import {
  DIFFICULTY_MODES,
  DIFFICULTY_COIN_MULT,
  DIFFICULTY_EXCLUDED_GAMES,
  ENDLESS_FLAT_COINS,
  ENDLESS_MIN_LEVEL,
  normalizeDifficulty,
  difficultyEnabled,
  effectiveDifficulty,
  applyDifficultyCoinBase,
  allowsWhileSick,
  difficultySliceOf,
  endlessUnlocked,
  bestForMode,
} from '../src/minigames/framework.logic.js';
import { computeCoins, getMinigame } from '../src/data/minigames.js';
import { applyXp, nextUnlock } from '../src/systems/leveling.js';
import { createStore } from '../src/core/store.js';
import { defaultState } from '../src/core/save.js';
import { UNLOCKS, LEVELING, MINIGAME } from '../src/data/constants.js';
import { EN as DIFF_EN, DE as DIFF_DE } from '../src/data/strings/v4-difficulty.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================ invert proxy

test('§G3.3 invertPayload: swipe dir mirrors per axis, dx/vx & dy/vy negate', () => {
  const p = { x: 100, y: 200, dx: 40, dy: -12, vx: 1.5, vy: -0.5, dir: 'left' };
  const rx = invertPayload('swipe', p, { x: true });
  assert.equal(rx.dir, 'right');
  assert.equal(rx.dx, -40);
  assert.equal(rx.vx, -1.5);
  assert.equal(rx.dy, -12); // y untouched without the flag
  assert.equal(rx.vy, -0.5);
  assert.equal(rx.x, 100); // client px stay RAW
  assert.equal(rx.y, 200);
  const ry = invertPayload('swipe', { ...p, dir: 'up' }, { y: true });
  assert.equal(ry.dir, 'down');
  assert.equal(ry.dy, 12);
  assert.equal(ry.vy, 0.5);
  assert.equal(ry.dx, 40);
  // vertical dir is untouched by invertX (and vice versa)
  assert.equal(invertPayload('swipe', { dir: 'up', dx: 3 }, { x: true }).dir, 'up');
  assert.equal(invertPayload('swipe', { dir: 'left', dy: 3 }, { y: true }).dir, 'left');
  // both flags: full mirror
  const rxy = invertPayload('swipe', p, { x: true, y: true });
  assert.equal(rxy.dir, 'right');
  assert.equal(rxy.dx, -40);
  assert.equal(rxy.dy, 12);
});

test('§G3.3 invertPayload: drag family negates nx/dx/vx (X) and ny/dy/vy (Y), x/y raw', () => {
  for (const event of ['drag', 'dragstart', 'dragend']) {
    const p = { x: 55, y: 66, nx: 0.4, ny: -0.9, dx: 10, dy: 20, vx: 2, vy: 3 };
    const rx = invertPayload(event, p, { x: true });
    assert.equal(rx.nx, -0.4, event);
    assert.equal(rx.dx, -10, event);
    assert.equal(rx.vx, -2, event);
    assert.equal(rx.ny, -0.9, event);
    assert.equal(rx.x, 55, event);
    const ry = invertPayload(event, p, { y: true });
    assert.equal(ry.ny, 0.9, event);
    assert.equal(ry.dy, -20, event);
    assert.equal(ry.vy, -3, event);
    assert.equal(ry.nx, 0.4, event);
    assert.equal(ry.y, 66, event);
  }
});

test('§G3.3 invertPayload: tap/hold pass through as the SAME object; no-flag = identity', () => {
  const p = { x: 9, y: 9, dx: 5, nx: 1 };
  assert.equal(invertPayload('tap', p, { x: true, y: true }), p);
  assert.equal(invertPayload('hold', p, { x: true, y: true }), p);
  assert.equal(invertPayload('swipe', p, {}), p); // no flag → original object
  assert.equal(invertPayload('drag', p, { x: false, y: false }), p);
  // transformed payloads are copies — the source object is never mutated
  const q = { dx: 7, dir: 'left' };
  const r = invertPayload('swipe', q, { x: true });
  assert.notEqual(r, q);
  assert.equal(q.dx, 7);
  assert.equal(q.dir, 'left');
});

/** Minimal §E5-shaped emitter for the wrap tests. */
function fakeEmitter() {
  const listeners = new Map();
  return {
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event)?.delete(cb);
    },
    off(event, cb) {
      listeners.get(event)?.delete(cb);
    },
    emit(event, p) {
      for (const cb of listeners.get(event) ?? []) cb(p);
    },
    count(event) {
      return listeners.get(event)?.size ?? 0;
    },
    pick: () => 'raw-pick',
  };
}

test('§G3.3 wrapInvertInput: live flags, off() unhooks the proxy, pick delegates raw', () => {
  const inner = fakeEmitter();
  const flags = { x: false, y: false };
  const wrappedInput = wrapInvertInput(inner, () => flags);
  const seen = [];
  const cb = (p) => seen.push(p.dir);
  wrappedInput.on('swipe', cb);
  inner.emit('swipe', { dir: 'left' });
  flags.x = true; // settings flip applies WITHOUT rewiring (live read)
  inner.emit('swipe', { dir: 'left' });
  flags.x = false;
  inner.emit('swipe', { dir: 'left' });
  assert.deepEqual(seen, ['left', 'right', 'left']);
  // off() with the ORIGINAL cb must remove the internal proxy
  wrappedInput.off('swipe', cb);
  inner.emit('swipe', { dir: 'left' });
  assert.deepEqual(seen, ['left', 'right', 'left']);
  assert.equal(inner.count('swipe'), 0);
  // non-directional events subscribe straight through (same cb identity)
  const tap = (p) => seen.push(p);
  wrappedInput.on('tap', tap);
  assert.equal(inner.count('tap'), 1);
  wrappedInput.off('tap', tap);
  assert.equal(inner.count('tap'), 0);
  // pick stays screen-true (delegated untouched)
  assert.equal(wrappedInput.pick(), 'raw-pick');
});

test('§G3.3 wrapInvertInput: on() returns a working unsubscribe', () => {
  const inner = fakeEmitter();
  const wrappedInput = wrapInvertInput(inner, () => ({ x: true }));
  let hits = 0;
  const offSwipe = wrappedInput.on('swipe', () => { hits += 1; });
  inner.emit('swipe', { dir: 'left' });
  offSwipe();
  inner.emit('swipe', { dir: 'left' });
  assert.equal(hits, 1);
  assert.equal(inner.count('swipe'), 0);
});

// ======================================================== difficulty math

test('§G5.2 mode table: ids, multipliers, endless constants frozen', () => {
  assert.deepEqual([...DIFFICULTY_MODES], ['easy', 'normal', 'hard', 'endless']);
  assert.deepEqual({ ...DIFFICULTY_COIN_MULT }, { easy: 0.7, normal: 1, hard: 1.3 });
  assert.equal(ENDLESS_FLAT_COINS, 5);
  assert.equal(ENDLESS_MIN_LEVEL, 10);
  assert.equal(normalizeDifficulty('hard'), 'hard');
  assert.equal(normalizeDifficulty('endless'), 'endless');
  assert.equal(normalizeDifficulty('nope'), 'normal');
  assert.equal(normalizeDifficulty(undefined), 'normal');
});

test('§G5.1 scope: cityDrive/goobyWelt + dev games excluded; trips force normal', () => {
  for (const id of DIFFICULTY_EXCLUDED_GAMES) {
    assert.equal(difficultyEnabled(id, {}), false, id);
  }
  assert.equal(difficultyEnabled('runner', {}), true);
  assert.equal(difficultyEnabled('anything', { dev: true }), false);
  assert.equal(effectiveDifficulty('runner', { difficulty: 'hard' }, {}), 'hard');
  assert.equal(effectiveDifficulty('cityDrive', { difficulty: 'hard' }, {}), 'normal');
  // trip/travel launches NEVER take difficulty (§G5.7-1)
  assert.equal(effectiveDifficulty('cityDrive', { mode: 'shopTrip', difficulty: 'hard' }, {}), 'normal');
  assert.equal(effectiveDifficulty('shoppingSurf', { mode: 'surfTravel', difficulty: 'easy' }, {}), 'normal');
  assert.equal(effectiveDifficulty('runner', { difficulty: 'bogus' }, {}), 'normal');
});

test('§G5.2 ×1 (Mittel) is bit-identical to the live §C6 row clamp', () => {
  const tables = [
    { divisor: 10, min: 2, max: 30 },
    { divisor: 4, max: 25 }, // min omitted → 0 (§C6 default)
    getMinigame('runner').coinTable,
  ];
  for (const table of tables) {
    for (let s = 0; s <= 600; s += 7) {
      assert.equal(
        applyDifficultyCoinBase(table, s, 'normal'),
        computeCoins(table, s, false),
        `table ${JSON.stringify(table)} score ${s}`
      );
    }
  }
});

test('§G5.2 ×0.7 floors at row min; ×1.3 caps at row max; round() in between', () => {
  const table = { divisor: 10, min: 2, max: 30 };
  // rowClamp(45) = 4 → easy round(4×0.7) = 3, hard round(4×1.3) = 5
  assert.equal(applyDifficultyCoinBase(table, 45, 'easy'), 3);
  assert.equal(applyDifficultyCoinBase(table, 45, 'hard'), 5);
  // low score: rowClamp floors at min 2 → easy round(1.4) = 1 → re-floored to 2
  assert.equal(applyDifficultyCoinBase(table, 0, 'easy'), 2);
  assert.equal(applyDifficultyCoinBase(table, 0, 'hard'), 3); // round(2.6)
  // cap: rowClamp(1000) = 30 → hard round(39) re-capped to 30; easy = 21
  assert.equal(applyDifficultyCoinBase(table, 1000, 'hard'), 30);
  assert.equal(applyDifficultyCoinBase(table, 1000, 'easy'), 21);
  // hostile score input never yields negatives/NaN
  assert.equal(applyDifficultyCoinBase(table, -50, 'hard'), 3);
  assert.equal(applyDifficultyCoinBase(table, NaN, 'easy'), 2);
});

test('§E0.1-2 stacking order: row clamp → difficulty mult → row max cap → daily ×2', () => {
  const table = { divisor: 10, min: 2, max: 30 };
  for (const mode of ['easy', 'normal', 'hard']) {
    for (const s of [0, 45, 123, 299, 1000]) {
      const base = applyDifficultyCoinBase(table, s, mode);
      // the framework passes `base` as coinsOverride pre-G54; economy's
      // computeCoins applies the daily ×2 AFTER — so the daily bonus is
      // exactly 2× the difficulty-multiplied base, never re-clamped by max.
      assert.equal(computeCoins(table, s, false, base), base, `${mode}/${s}`);
      assert.equal(computeCoins(table, s, true, base), 2 * base, `${mode}/${s} daily`);
    }
  }
  // concrete §G5.2 example: hard at cap with daily ×2 pays 2 × row.max
  assert.equal(computeCoins(table, 1000, true, applyDifficultyCoinBase(table, 1000, 'hard')), 60);
});

test('§G5.2 endless payout path: flat 5 c override, daily ×2 applies after', () => {
  const table = getMinigame('runner').coinTable;
  assert.equal(computeCoins(table, 99999, false, ENDLESS_FLAT_COINS), 5);
  assert.equal(computeCoins(table, 99999, true, ENDLESS_FLAT_COINS), 10);
  assert.equal(MINIGAME.DAILY_FIRST_PLAY_MULT, 2); // the ×2 the table above relies on
});

// ==================================================== §G5.5 slice readers

test('§G5.5 difficultySliceOf: defensive against the pre-G53 save shape', () => {
  // empty/hostile containers never throw, every field falls back
  for (const state of [undefined, null, {}, { minigames: null }, { minigames: 7 }]) {
    const slice = difficultySliceOf(state, 'runner');
    assert.deepEqual(slice, { selected: 'normal', beaten: {}, bestByDiff: {}, best: 0, endlessBest: 0 });
  }
  const state = {
    minigames: {
      best: { runner: 120 },
      difficulty: { runner: 'hard', bogus: 'endless' },
      beaten: { runner: { hard: true } },
      bestByDiff: { runner: { easy: 40, hard: 200 } },
      endlessBest: { runner: 555 },
    },
  };
  const slice = difficultySliceOf(state, 'runner');
  assert.equal(slice.selected, 'hard');
  assert.equal(slice.beaten.hard, true);
  assert.equal(slice.best, 120);
  assert.equal(slice.endlessBest, 555);
  // 'endless' is never a persisted selection — coerces to 'normal' (§G5.5)
  assert.equal(difficultySliceOf(state, 'bogus').selected, 'normal');
});

test('§G5.5 endless lock: beaten[id].hard AND level ≥ 10', () => {
  const base = { level: 10, minigames: { beaten: { runner: { hard: true } } } };
  assert.equal(endlessUnlocked(base, 'runner'), true);
  assert.equal(endlessUnlocked({ ...base, level: 9 }, 'runner'), false);
  assert.equal(endlessUnlocked({ level: 40, minigames: { beaten: { runner: { easy: true } } } }, 'runner'), false);
  assert.equal(endlessUnlocked({ level: 40 }, 'runner'), false); // missing slice = locked
  assert.equal(endlessUnlocked(undefined, 'runner'), false);
});

test('§G5.5 bestForMode: Mittel stays `best`; easy/hard in bestByDiff; endless separate', () => {
  const state = {
    minigames: {
      best: { runner: 100 },
      bestByDiff: { runner: { easy: 40, hard: 200 } },
      endlessBest: { runner: 555 },
    },
  };
  assert.equal(bestForMode(state, 'runner', 'normal'), 100);
  assert.equal(bestForMode(state, 'runner', 'easy'), 40);
  assert.equal(bestForMode(state, 'runner', 'hard'), 200);
  assert.equal(bestForMode(state, 'runner', 'endless'), 555);
  assert.equal(bestForMode({}, 'runner', 'hard'), 0);
});

// ========================================================== sick gate

test('§C-SYS7.1 sick gate matrix: trips + BOTH travel methods pass, arcade blocked', () => {
  assert.equal(allowsWhileSick('vetTrip'), true); // v2 exemption kept
  assert.equal(allowsWhileSick('shopTrip'), true); // drive to the shop
  assert.equal(allowsWhileSick('surfTravel'), true); // Shopping Surf „Laufen"
  assert.equal(allowsWhileSick('travel'), true); // §C8.6 alias
  assert.equal(allowsWhileSick(undefined), false); // plain arcade launch
  assert.equal(allowsWhileSick('anythingElse'), false);
});

// ============================================== xpGranted runtime emit

test('§C-SYS3.1 applyXp emits xpGranted {amount, source} through the store singleton', () => {
  const store = createStore(defaultState(), { autosave: false });
  const events = [];
  store.on('xpGranted', (p) => events.push(p));
  const r = applyXp({ xp: 0, level: 1 }, 8, 'wash');
  assert.equal(r.xp, 8);
  assert.deepEqual(events, [{ amount: 8, source: 'wash' }]);
  // amount-0 grants emit NOTHING (caps reached — §C-SYS3.1)
  applyXp({ xp: 0, level: 1 }, 0, 'pet');
  assert.equal(events.length, 1);
  // max level accumulates nothing and emits nothing
  applyXp({ xp: 0, level: LEVELING.MAX_LEVEL }, 50, 'quest');
  assert.equal(events.length, 1);
  // missing source tag degrades to '' (never undefined in the payload)
  applyXp({ xp: 0, level: 1 }, 3);
  assert.deepEqual(events[1], { amount: 3, source: '' });
});

// ============================== §C-SYS3.1 source-tag static analysis

/** Strip line/block comments well enough for call-site scanning. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
      const i = line.indexOf(' // ');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');
}

/** Top-level argument count of the call starting right after `openIdx` ('('). */
function argCount(src, openIdx) {
  let depth = 0;
  let args = 0;
  let sawToken = false;
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return sawToken ? args + 1 : 0;
    } else if (c === ',' && depth === 1) args += 1;
    else if (depth >= 1 && !/\s/.test(c)) sawToken = true;
  }
  return -1; // unbalanced — fail loudly in the assert below
}

test('§C-SYS3.1 static analysis: every applyXp(/grantXp( call site carries a source tag', () => {
  /** @type {string[]} */
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  const untagged = [];
  let sites = 0;
  for (const file of files) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const name of ['applyXp', 'grantXp']) {
      let idx = -1;
      while ((idx = src.indexOf(`${name}(`, idx + 1)) >= 0) {
        const before = src.slice(Math.max(0, idx - 24), idx);
        if (/function\s+$|import[^;]*$/.test(before)) continue; // definition/import
        if (/[.\w$]$/.test(before.slice(-1)) && !/[\s(,;=&|?:{[]$/.test(before)) continue; // member of another name
        sites += 1;
        const n = argCount(src, idx + name.length);
        // applyXp(progress, amount, source) / grantXp(state, amount, source)
        if (n < 3) untagged.push(`${path.relative(ROOT, file)}: ${name}(…${n} args)`);
      }
    }
  }
  assert.ok(sites >= 13, `expected ≥ 13 grant sites, found ${sites}`);
  // §E0.1-13 ruling: the ONE allowed untagged site is economy.awardMinigame's
  // applyXp — G54 owns systems/economy.js in the same wave and lands its tag
  // there. Everything else must be tagged NOW.
  const foreign = untagged.filter((site) => !site.startsWith(path.join('src', 'systems', 'economy.js')));
  assert.deepEqual(foreign, [], `untagged XP grant sites outside economy.js: ${foreign.join(' | ')}`);
  assert.ok(untagged.length <= 1, `economy.js may hold at most G54's one pending site: ${untagged.join(' | ')}`);
});

// ================================================== §C-SYS3.3 nextUnlock

test('§C-SYS3.3 nextUnlock: lowest table row above the level; null at the top', () => {
  // L1 → the L2 unlocks; minigames sort before features at the same level
  // (deterministic kind order), alphabetical within: carrotGuard beats
  // goobySays, and the quests feature row (UNLOCKS.QUESTS = 2) comes after.
  assert.equal(UNLOCKS.QUESTS, 2);
  assert.deepEqual(nextUnlock(1), { level: 2, kind: 'minigame', nameKey: 'mg.title.carrotGuard' });
  // monotone: the returned row is always strictly above the queried level;
  // once null, it stays null for every higher level
  let LAST_UNLOCK_LEVEL = 1;
  for (let level = 1; level <= LEVELING.MAX_LEVEL; level += 1) {
    const row = nextUnlock(level);
    if (row == null) {
      LAST_UNLOCK_LEVEL = Math.max(LAST_UNLOCK_LEVEL, level);
      continue;
    }
    assert.ok(row.level > level, `level ${level} → ${row.level}`);
    assert.ok(['minigame', 'feature', 'crop', 'plot'].includes(row.kind));
    assert.equal(typeof row.nameKey, 'string');
  }
  assert.equal(nextUnlock(LAST_UNLOCK_LEVEL), null); // everything unlocked
  assert.equal(nextUnlock(LEVELING.MAX_LEVEL), null); // „Alles freigeschaltet! 🏆"
  // same-level kind order: at L16 the ghostHunt minigame outranks the 6th
  // plot (§B6 GARDEN_PLOTS[5] also sits at L16 — minigame < plot).
  assert.deepEqual(nextUnlock(15), { level: 16, kind: 'minigame', nameKey: 'mg.title.ghostHunt' });
  assert.equal(UNLOCKS.GARDEN_PLOTS[5].level, 16);
});

// ======================================== strings module + async guards

test('strings/v4-difficulty.js: EN and DE key sets are identical', () => {
  assert.deepEqual(Object.keys(DIFF_EN).sort(), Object.keys(DIFF_DE).sort());
  for (const key of ['mg.diff.easy', 'mg.diff.lock', 'toast.endlessLocked', 'mg.results.endlessBest', 'mg.loading', 'hud.xpFloater', 'toast.levelUpNext', 'unlock.all']) {
    assert.ok(DIFF_EN[key], `EN missing ${key}`);
    assert.ok(DIFF_DE[key], `DE missing ${key}`);
  }
});

test('§G6.6 async lifecycle guards are in place (source contract)', () => {
  // sceneManager awaits a Promise-returning dispose before building the next
  // scene (goobyWelt splat release — framework.js can't run under node:
  // three + import.meta.glob, so the wiring is pinned at source level and
  // proven at runtime via the CDP stub-game check in the G56 evidence).
  const sceneManagerSrc = fs.readFileSync(path.join(ROOT, 'src', 'core', 'sceneManager.js'), 'utf8');
  assert.match(sceneManagerSrc, /await current\.instance\.dispose\?\.\(\)/);
  const frameworkSrc = fs.readFileSync(path.join(ROOT, 'src', 'minigames', 'framework.js'), 'utf8');
  assert.match(frameworkSrc, /await initResult/); // init awaited (loading card path)
  assert.match(frameworkSrc, /typeof initResult\.then === 'function'/); // sync games skip it
  assert.match(frameworkSrc, /typeof disposeResult\.then === 'function'/); // async dispose chained
  assert.match(frameworkSrc, /return disposeResult/); // …and RETURNED for switchTo's await
  assert.match(frameworkSrc, /allowsWhileSick\(params\.mode\)/); // §C-SYS7.1 gate line
});
