// V4/G55 — recap engine tests (PLAN4 §C-SYS2.9, part 1 of 2 — see also
// test/recapDirector.test.js): milestone math incl. multi-level jumps + the
// L40 cap, baseline diff clamps (counter resets → 0, never negative), line
// selection determinism, beat-grid math for bpm 60/100/143.7 + override
// precedence, migration-init math at 6 level fixtures (§B1 #3 — G53's
// migrations[3] calls initialLastRecapLevel/snapshot), history cap 8, and
// pending-level persistence through the real §E3 save pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECAP,
  STAT_CATALOG,
  defaultRecapSlice,
  initialLastRecapLevel,
  snapshot,
  diff,
  selectLines,
  formatLine,
  highestMilestone,
  milestoneCrossed,
  completeRecap,
  resolveBeats,
  beatGrid,
} from '../src/systems/recap.js';
import * as recapEngine from '../src/systems/recapEngine.js';
import { load, persist } from '../src/core/save.js';

const NOW = 1_784_000_000_000;
const DAY = 86_400_000;

/** A mid-game fixture state (level 10, non-trivial counters everywhere). */
function fixtureState(over = {}) {
  return {
    level: 10,
    profile: { playtimeMin: 300, coinsEarned: 500, coinsSpent: 120, distanceM: 340.4, photos: 7 },
    minigames: { plays: { runner: 3, bubblePop: 2 }, best: {}, lastPlayDay: {} },
    stickers: { unlocked: { s1: NOW, s2: NOW, s3: NOW }, seen: {} },
    achievements: {
      unlocked: {},
      counters: {
        feeds: 12, washes: 4, sleeps: 3, tickles: 25, trips: 2, harvests: 9,
        plantings: 5, waterings: 8, questsDone: 6, deliveries: 1, cures: 1,
        nougatGlobs: 2, cakesServed: 3, surfRuns: 4, petsToday: 5, petsDay: 'd',
      },
    },
    ...over,
  };
}

// ── stat catalog (§C-SYS2.4) ────────────────────────────────────────────────

test('catalog: 18 rows (≥ 14 binding), unique ids, catalog order intact', () => {
  assert.equal(STAT_CATALOG.length, 18);
  assert.ok(STAT_CATALOG.length >= 14);
  const ids = STAT_CATALOG.map((r) => r.id);
  assert.equal(new Set(ids).size, 18);
  assert.deepEqual(ids.slice(0, 4), ['days', 'games', 'coinsEarned', 'tickles']);
  assert.equal(ids[17], 'coinsSpent');
});

test('catalog: every row has EN + DE templates with {n} and a positive weight', () => {
  for (const row of STAT_CATALOG) {
    assert.ok(row.de.includes('{n}'), `${row.id} de`);
    assert.ok(row.en.includes('{n}'), `${row.id} en`);
    assert.ok(row.weight > 0, `${row.id} weight`);
  }
});

test('catalog: §C-SYS2.4 weights verbatim (spot table)', () => {
  const w = Object.fromEntries(STAT_CATALOG.map((r) => [r.id, r.weight]));
  assert.equal(w.games, 10);
  assert.equal(w.coinsEarned, 9);
  assert.equal(w.tickles, 9);
  assert.equal(w.feeds, 8);
  assert.equal(w.quests, 7);
  assert.equal(w.washes, 6);
  assert.equal(w.distance, 5);
  assert.equal(w.deliveries, 4);
  assert.equal(w.nougat, 3);
  assert.equal(w.coinsSpent, 3);
});

// ── snapshot (§C-SYS2.4) ────────────────────────────────────────────────────

test('snapshot: copies exactly the §C-SYS2.4 key set (petsToday excluded)', () => {
  const snap = snapshot(fixtureState(), NOW);
  assert.deepEqual(Object.keys(snap).sort(), [
    'cakesServed', 'coinsEarned', 'coinsSpent', 'cures', 'deliveries',
    'distanceM', 'feeds', 'harvests', 'level', 'nougatGlobs', 'photos',
    'plantings', 'playsTotal', 'questsDone', 'snapshotAtMs', 'stickerCount',
    'sleeps', 'surfRuns', 'tickles', 'trips', 'washes', 'waterings',
  ].sort());
  assert.ok(!('petsToday' in snap));
});

test('snapshot: playsTotal sums minigames.plays, stickerCount counts unlocked', () => {
  const snap = snapshot(fixtureState(), NOW);
  assert.equal(snap.playsTotal, 5);
  assert.equal(snap.stickerCount, 3);
  assert.equal(snap.level, 10);
  assert.equal(snap.snapshotAtMs, NOW);
  assert.equal(snap.coinsEarned, 500);
  assert.equal(snap.distanceM, 340.4);
});

test('snapshot: missing/corrupt slices snapshot as 0, never throw', () => {
  const snap = snapshot({ level: 3, minigames: { plays: 'nope' }, stickers: { unlocked: [] } }, NOW);
  assert.equal(snap.playsTotal, 0);
  assert.equal(snap.stickerCount, 0);
  assert.equal(snap.feeds, 0);
  assert.equal(snap.coinsEarned, 0);
  const empty = snapshot(undefined, NOW);
  assert.equal(empty.level, 1);
  assert.equal(empty.playsTotal, 0);
});

// ── diff (§C-SYS2.4) ────────────────────────────────────────────────────────

test('diff: current − baseline per line, in catalog order with days first', () => {
  const base = snapshot(fixtureState(), NOW - 3 * DAY);
  const cur = fixtureState();
  cur.achievements.counters.feeds = 17; // +5
  cur.achievements.counters.tickles = 30; // +5
  cur.profile.coinsEarned = 750; // +250
  const lines = diff(base, cur, NOW);
  assert.equal(lines[0].id, 'days');
  assert.equal(lines[0].value, 3);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l.value]));
  assert.equal(byId.feeds, 5);
  assert.equal(byId.tickles, 5);
  assert.equal(byId.coinsEarned, 250);
  assert.equal(byId.games, 0);
  assert.deepEqual(lines.map((l) => l.id), STAT_CATALOG.map((r) => r.id));
});

test('diff: counter reset/corruption clamps to 0, never negative', () => {
  const base = snapshot(fixtureState(), NOW - DAY);
  const wiped = fixtureState({ achievements: { counters: {} }, profile: {}, minigames: { plays: {} }, stickers: { unlocked: {} } });
  const lines = diff(base, wiped, NOW);
  for (const l of lines) assert.ok(l.value >= 0, `${l.id} must be ≥ 0`);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l.value]));
  assert.equal(byId.feeds, 0);
  assert.equal(byId.coinsEarned, 0);
});

test('diff: empty baseline ({} — migration/first boot) → full current values, days ≥ 1', () => {
  const lines = diff({}, fixtureState(), NOW);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l.value]));
  assert.equal(byId.days, 1);
  assert.equal(byId.feeds, 12);
  assert.equal(byId.games, 5);
  assert.equal(byId.distance, 340);
});

test('diff: days = ⌈elapsed/86400000⌉ with a 1 minimum', () => {
  const base = snapshot(fixtureState(), NOW - 2.5 * DAY);
  assert.equal(diff(base, fixtureState(), NOW)[0].value, 3);
  const sameMs = snapshot(fixtureState(), NOW);
  assert.equal(diff(sameMs, fixtureState(), NOW)[0].value, 1);
  const future = snapshot(fixtureState(), NOW + DAY); // hostile clock skew
  assert.equal(diff(future, fixtureState(), NOW)[0].value, 1);
});

// ── formatLine (EN + DE templates) ──────────────────────────────────────────

test('formatLine: template fill + days singular, both languages', () => {
  assert.equal(formatLine('days', 3, 'de'), 'Seitdem: 3 Tage vergangen');
  assert.equal(formatLine('days', 1, 'de'), 'Seitdem: 1 Tag vergangen');
  assert.equal(formatLine('days', 3, 'en'), 'Since then: 3 days');
  assert.equal(formatLine('days', 1, 'en'), 'Since then: 1 day');
  assert.equal(formatLine('tickles', 5, 'de'), '5× Bauch gekrault');
  assert.equal(formatLine('tickles', 5, 'en'), 'belly rubbed 5×');
  assert.equal(formatLine('coinsEarned', 250, 'de'), '250 Münzen verdient');
  assert.equal(formatLine('nope', 3, 'de'), '');
});

// ── selectLines (§C-SYS2.5) ─────────────────────────────────────────────────

test('selectLines: days always first, then top 11 non-zero by (weight, value) — ≤ 12', () => {
  const lines = diff(snapshot(fixtureState(), NOW - DAY), fixtureState({
    achievements: {
      counters: {
        feeds: 20, washes: 10, sleeps: 9, tickles: 40, trips: 8, harvests: 15,
        plantings: 6, waterings: 9, questsDone: 12, deliveries: 5, cures: 2,
        nougatGlobs: 7, cakesServed: 6, surfRuns: 5, petsToday: 3, petsDay: 'd',
      },
    },
    profile: { coinsEarned: 999, coinsSpent: 500, distanceM: 900, photos: 20 },
    minigames: { plays: { runner: 30 } },
    stickers: { unlocked: { a: 1, b: 1, c: 1, d: 1, e: 1 } },
  }), NOW);
  const picked = selectLines(lines);
  assert.equal(picked.length, 12);
  assert.equal(picked[0].id, 'days');
  for (const l of picked.slice(1)) assert.ok(l.value > 0);
  const weights = picked.slice(1).map((l) => l.weight);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i] <= weights[i - 1], 'weight-sorted');
});

test('selectLines: zero lines are excluded — fewer than 11 non-zero stays short', () => {
  const state = fixtureState({
    achievements: { counters: { feeds: 2, petsDay: 'd' } },
    profile: {}, minigames: { plays: {} }, stickers: { unlocked: {} },
  });
  const picked = selectLines(diff({}, state, NOW));
  assert.deepEqual(picked.map((l) => l.id), ['days', 'feeds']);
});

test('selectLines: deterministic — ties break by value then catalog order, input order irrelevant', () => {
  const lines = [
    { id: 'days', value: 2, weight: RECAP.WEIGHT_ALWAYS_FIRST },
    { id: 'tickles', value: 7, weight: 9 },   // weight 9 tie vs coinsEarned
    { id: 'coinsEarned', value: 7, weight: 9 }, // equal value → catalog order wins
    { id: 'washes', value: 3, weight: 6 },
    { id: 'sleeps', value: 3, weight: 6 },    // tie: equal weight+value → catalog order
  ];
  const a = selectLines(lines);
  const b = selectLines([...lines].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((l) => l.id), ['days', 'coinsEarned', 'tickles', 'washes', 'sleeps']);
});

// ── milestone math (§B5.1/§C-SYS2.1) ────────────────────────────────────────

test('milestoneCrossed: single-step crossings', () => {
  assert.equal(milestoneCrossed(4, 5, 0), 5);
  assert.equal(milestoneCrossed(9, 10, 5), 10);
  assert.equal(milestoneCrossed(5, 6, 5), 0);
  assert.equal(milestoneCrossed(5, 5, 0), 5); // owed milestone below current level
  assert.equal(milestoneCrossed(1, 4, 0), 0);
});

test('milestoneCrossed: multi-level jump L4→L11 queues 5 (§B5.1), then 10 next time', () => {
  assert.equal(milestoneCrossed(4, 11, 0), 5);
  assert.equal(milestoneCrossed(11, 12, 5), 10); // owed 10 surfaces on the next change
  assert.equal(milestoneCrossed(11, 12, 10), 0); // …unless the fold already covered it
});

test('milestoneCrossed: cap at L40, nothing above', () => {
  assert.equal(milestoneCrossed(39, 40, 35), 40);
  assert.equal(milestoneCrossed(38, 45, 35), 40);
  assert.equal(milestoneCrossed(40, 41, 40), 0);
  assert.equal(milestoneCrossed(40, 99, 40), 0);
});

test('milestoneCrossed: default lastRecapLevel is retro-safe (floor of prevLevel)', () => {
  assert.equal(milestoneCrossed(23, 24), 0);  // an L23 veteran never gets a stale 5
  assert.equal(milestoneCrossed(23, 25), 25);
  assert.equal(milestoneCrossed(4, 11), 5);
});

test('initialLastRecapLevel (§B1 #3 migration init) at 6 level fixtures', () => {
  assert.equal(initialLastRecapLevel(1), 0);
  assert.equal(initialLastRecapLevel(4), 0);
  assert.equal(initialLastRecapLevel(5), 5);
  assert.equal(initialLastRecapLevel(11), 10);
  assert.equal(initialLastRecapLevel(23), 20);
  assert.equal(initialLastRecapLevel(40), 40);
  assert.equal(highestMilestone(23), 20);
});

// ── completion (§B5.2 atomic write) ─────────────────────────────────────────

test('completeRecap: history row + lastRecapLevel + baseline re-snapshot + pendingLevel cleared', () => {
  const state = fixtureState({ level: 5 });
  state.recap = { ...defaultRecapSlice(), pendingLevel: 5, baseline: snapshot(fixtureState({ level: 1 }), NOW - 2 * DAY), baselineAt: NOW - 2 * DAY };
  const { recap, entry } = completeRecap(state, NOW);
  assert.equal(recap.pendingLevel, 0);
  assert.equal(recap.lastRecapLevel, 5);
  assert.equal(recap.baselineAt, NOW);
  assert.deepEqual(recap.baseline, snapshot(state, NOW));
  assert.equal(recap.history.length, 1);
  assert.equal(entry.level, 5);
  assert.equal(entry.at, NOW);
  assert.equal(entry.stats[0].id, 'days');
  // input untouched (pure)
  assert.equal(state.recap.pendingLevel, 5);
});

test('completeRecap: multi-jump fold (§C-SYS2.1) — queued 5 played at L11 advances to 10', () => {
  const state = fixtureState({ level: 11 });
  state.recap = { ...defaultRecapSlice(), pendingLevel: 5 };
  const { recap, entry } = completeRecap(state, NOW);
  assert.equal(recap.lastRecapLevel, 10); // lastRecapLevel jumps to the highest
  assert.equal(entry.level, 10);
  assert.equal(recap.pendingLevel, 0);
});

test('completeRecap: history capped at 8, oldest dropped (§C-SYS2.8)', () => {
  let state = fixtureState({ level: 40 });
  state.recap = defaultRecapSlice();
  for (let i = 0; i < 10; i++) {
    const { recap } = completeRecap(state, NOW + i);
    state = { ...state, recap };
  }
  assert.equal(state.recap.history.length, RECAP.HISTORY_MAX);
  assert.equal(state.recap.history[0].at, NOW + 2);
  assert.equal(state.recap.history[7].at, NOW + 9);
});

test('completeRecap: playedLines passed through verbatim into the history row', () => {
  const state = fixtureState({ level: 10 });
  state.recap = { ...defaultRecapSlice(), pendingLevel: 10 };
  const played = [{ id: 'days', value: 4 }, { id: 'feeds', value: 9 }];
  const { entry } = completeRecap(state, NOW, played);
  assert.deepEqual(entry.stats, played);
});

// ── pending-level persistence (§B5.2 — real §E3 pipeline, in-memory store) ──

test('pendingLevel survives the save pipeline (persist → load round-trip)', () => {
  const { state } = load(); // fresh default (node: in-memory storage fallback)
  state.recap = { ...defaultRecapSlice(), pendingLevel: 5, lastRecapLevel: 0 };
  assert.notEqual(persist(state), false);
  const reloaded = load();
  assert.equal(reloaded.fresh, false);
  assert.equal(reloaded.state.recap.pendingLevel, 5);
  assert.equal(reloaded.state.recap.lastRecapLevel, 0);
  assert.deepEqual(reloaded.state.recap.history, []);
});

// ── beat grid (§B5.3/§C-SYS2.6) ─────────────────────────────────────────────

test('resolveBeats: override precedence, default grid, offsetMs/offsetSec spellings', () => {
  assert.deepEqual(resolveBeats(null), RECAP.DEFAULT_GRID);
  assert.deepEqual(resolveBeats({ bpm: 131, offsetSec: 0.39, beatsPerBar: 4 }), { bpm: 131, offsetSec: 0.39, beatsPerBar: 4 });
  // override wins verbatim over the generated manifest
  assert.deepEqual(
    resolveBeats({ bpm: 131.2, offsetSec: 0.04, beatsPerBar: 4 }, { bpm: 131, offsetSec: 0.39, beatsPerBar: 4 }),
    { bpm: 131, offsetSec: 0.39, beatsPerBar: 4 }
  );
  assert.equal(resolveBeats({ bpm: 120, offsetMs: 500 }).offsetSec, 0.5);
  assert.equal(resolveBeats({ bpm: 120, offsetMs: 500, offsetSec: 0.25 }).offsetSec, 0.25);
  // invalid fields fall back field-by-field
  assert.equal(resolveBeats({ bpm: 'x', offsetSec: -3, beatsPerBar: 99 }).bpm, 100);
  assert.equal(resolveBeats({ bpm: 999 }).bpm, 100);
});

test('beatGrid: bar math for bpm 60 / 100 / 143.7 (§C-SYS2.9)', () => {
  for (const [bpm, expectBar] of [[60, 4], [100, 2.4], [143.7, 240 / 143.7]]) {
    const grid = beatGrid({ bpm, offsetSec: 0, beatsPerBar: 4 }, 100);
    assert.ok(Math.abs(grid.barSec - expectBar) < 1e-9, `bpm ${bpm}`);
    assert.ok(Math.abs(grid.beatSec - 60 / bpm) < 1e-9);
    for (const cue of grid.cues) {
      assert.ok(Math.abs(cue.t - cue.bar * grid.barSec) < 1e-9, 'every cue sits on its bar downbeat');
    }
  }
});

test('beatGrid: totalSec = clamp(duration, 60, 120) (§C-SYS2.2)', () => {
  assert.equal(beatGrid(null, 165.2).totalSec, 120);
  assert.equal(beatGrid(null, 83.4).totalSec, 83.4);
  assert.equal(beatGrid(null, 30).totalSec, 60);
  assert.equal(beatGrid(null, NaN).totalSec, 100); // fallback duration
});

test('beatGrid: 8 cuts on strictly-increasing EVEN bars, end on final even bar', () => {
  for (const bpm of [60, 94.3, 100, 131, 139.9, 143.7, 200]) {
    const grid = beatGrid({ bpm, offsetSec: 0.4, beatsPerBar: 4 }, 110);
    const cuts = grid.cues.filter((c) => c.kind === 'cut');
    assert.equal(cuts.length, 8, `bpm ${bpm}`);
    assert.deepEqual(cuts.map((c) => c.vignette), [0, 1, 2, 3, 4, 5, 6, 7]);
    let prev = 0;
    for (const c of cuts) {
      assert.equal(c.bar % 2, 0, 'cut on even bar');
      assert.ok(c.bar >= prev + 2, 'monotonic ≥ +2');
      prev = c.bar;
    }
    const ends = grid.cues.filter((c) => c.kind === 'end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].bar % 2, 0);
    assert.ok(ends[0].bar >= prev + 2);
  }
});

test('beatGrid: text slots — 1 intro slot + ≤ 2 per vignette, on downbeats between cuts', () => {
  const grid = beatGrid({ bpm: 100, offsetSec: 0, beatsPerBar: 4 }, 100);
  const texts = grid.cues.filter((c) => c.kind === 'text');
  const intro = texts.filter((c) => c.vignette === -1);
  assert.equal(intro.length, 1);
  assert.equal(intro[0].bar, 1);
  const cuts = grid.cues.filter((c) => c.kind === 'cut');
  const endBar = grid.cues.find((c) => c.kind === 'end').bar;
  for (let v = 0; v < 8; v++) {
    const slots = texts.filter((c) => c.vignette === v);
    assert.ok(slots.length <= 2, `vignette ${v}`);
    const from = cuts[v].bar;
    const until = v < 7 ? cuts[v + 1].bar : endBar;
    for (const s of slots) assert.ok(s.bar > from && s.bar < until, 'inside the vignette');
  }
});

test('beatGrid: §B5.1 shape — { barSec, cues: [{t, kind}] }, kinds text|cut|end, sorted by t', () => {
  const grid = beatGrid(null, 100);
  assert.equal(typeof grid.barSec, 'number');
  assert.ok(Array.isArray(grid.cues));
  for (const cue of grid.cues) {
    assert.ok(['text', 'cut', 'end'].includes(cue.kind));
    assert.equal(typeof cue.t, 'number');
  }
  for (let i = 1; i < grid.cues.length; i++) assert.ok(grid.cues[i].t >= grid.cues[i - 1].t);
});

// ── plan-name interop ───────────────────────────────────────────────────────

test('recapEngine.js re-exports the identical engine (plan §B5.1 name)', () => {
  assert.equal(recapEngine.snapshot, snapshot);
  assert.equal(recapEngine.milestoneCrossed, milestoneCrossed);
  assert.equal(recapEngine.beatGrid, beatGrid);
  assert.equal(recapEngine.completeRecap, completeRecap);
  assert.equal(recapEngine.RECAP, RECAP);
});

test('defaultRecapSlice matches the §B1 recap slice defaults', () => {
  assert.deepEqual(defaultRecapSlice(), {
    lastRecapLevel: 0, baseline: {}, baselineAt: 0, pendingLevel: 0, history: [],
  });
});
