// V4/G55 — recap director + beat-grid data tests (PLAN4 §C-SYS2.9, part 2 of
// 2 — see also test/recap.test.js): cue-timeline determinism, §C-SYS2.6 cue
// rules (cuts on even bars, text pops on downbeats, end card + confetti,
// skip-after-10s flag), §C-SYS2.5 round-robin line distribution, track-pick
// seeding, and sanity of the COMMITTED recap beat manifests (bpm within
// 60–200, offsets sane, bars — where present — monotonic), including a full
// simulated level-10 recap against the real owner-track grids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { RECAP, snapshot, diff, selectLines } from '../src/systems/recap.js';
import { DEFAULT_BIOMES, pickTrack, buildTimeline } from '../src/systems/recapDirector.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEATS_DIRS = [
  join(ROOT, 'public', 'assets', 'GoobyMusic', 'beats'),
  join(ROOT, 'public', 'assets', 'music', 'beats'),
];
const NOW = 1_784_000_000_000;
const DAY = 86_400_000;

/** All committed beats manifests ({file → parsed json}). */
function committedGrids() {
  const out = new Map();
  for (const dir of BEATS_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (/\.beats(\.override)?\.json$/.test(f)) {
        out.set(f, JSON.parse(readFileSync(join(dir, f), 'utf8')));
      }
    }
  }
  return out;
}

/** Level-10 fixture: a plausible L5→L10 stretch of play. */
function level10Fixture() {
  const baseState = {
    level: 5,
    profile: { coinsEarned: 200, coinsSpent: 50, distanceM: 100, photos: 2 },
    minigames: { plays: { runner: 4 } },
    stickers: { unlocked: { a: 1, b: 1 } },
    achievements: { counters: { feeds: 10, washes: 3, sleeps: 2, tickles: 15, trips: 1, harvests: 4, plantings: 2, waterings: 3, questsDone: 3, deliveries: 0, cures: 0, nougatGlobs: 1, cakesServed: 0, surfRuns: 1 } },
  };
  const current = {
    level: 10,
    profile: { coinsEarned: 620, coinsSpent: 180, distanceM: 480.7, photos: 9 },
    minigames: { plays: { runner: 9, bubblePop: 6, memoryMatch: 2 } },
    stickers: { unlocked: { a: 1, b: 1, c: 1, d: 1, e: 1 } },
    achievements: { counters: { feeds: 31, washes: 9, sleeps: 8, tickles: 42, trips: 4, harvests: 13, plantings: 6, waterings: 9, questsDone: 11, deliveries: 3, cures: 1, nougatGlobs: 4, cakesServed: 2, surfRuns: 3 } },
  };
  const baseline = snapshot(baseState, NOW - 3 * DAY);
  return { lines: selectLines(diff(baseline, current, NOW)) };
}

// ── committed beat manifests (beat-grid sanity) ─────────────────────────────

test('committed grids exist for the 3 recap tracks (2 owner + fallback)', () => {
  const grids = committedGrids();
  assert.ok(grids.size >= 3, `found ${[...grids.keys()].join(', ')}`);
  assert.ok([...grids.keys()].some((f) => f.startsWith('Recap - Bonus Stage Blitz')));
  assert.ok([...grids.keys()].some((f) => f.startsWith('Recap Song 2 MoreEpic Victory')));
  assert.ok([...grids.keys()].some((f) => f.startsWith('Recap - Abenteuer')));
});

test('committed grids: bpm 60–200, sane offset, beatsPerBar 4, bars[] monotonic where present', () => {
  for (const [file, g] of committedGrids()) {
    assert.ok(g.bpm >= 60 && g.bpm <= 200, `${file}: bpm ${g.bpm}`);
    const offsetSec = Number.isFinite(g.offsetSec) ? g.offsetSec : (g.offsetMs ?? 0) / 1000;
    assert.ok(offsetSec >= 0 && offsetSec < 10, `${file}: offset ${offsetSec}`);
    assert.equal(g.beatsPerBar, 4, `${file}: beatsPerBar`);
    if (Array.isArray(g.bars)) {
      for (let i = 1; i < g.bars.length; i++) assert.ok(g.bars[i] > g.bars[i - 1], `${file}: bars monotonic`);
    }
  }
});

test('generated bar timestamps are strictly monotonic for every committed grid', () => {
  for (const [file, g] of committedGrids()) {
    const timeline = buildTimeline({ beats: g, durationSec: 100, lines: [], level: 5 });
    assert.ok(timeline.barSec > 0, file);
    let prev = -Infinity;
    for (let bar = 0; bar <= timeline.cues[timeline.cues.length - 1].bar; bar += 1) {
      const t = timeline.offsetSec + bar * timeline.barSec;
      assert.ok(t > prev, `${file}: bar ${bar}`);
      prev = t;
    }
  }
});

// ── track pick (§C-SYS2.6 step 1) ───────────────────────────────────────────

test('pickTrack: seeded + deterministic; empty list → null (caller falls back to Abenteuer)', () => {
  const ids = ['recap-bonus-stage-blitz', 'recap-recap-song-2-moreepic-victory'];
  assert.equal(pickTrack(ids, 42), pickTrack(ids, 42));
  assert.ok(ids.includes(pickTrack(ids, 1)));
  assert.ok(ids.includes(pickTrack(ids, 999)));
  const picks = new Set();
  for (let s = 0; s < 50; s++) picks.add(pickTrack(ids, s));
  assert.equal(picks.size, 2, 'both tracks reachable across seeds');
  assert.equal(pickTrack([], 7), null);
  assert.equal(pickTrack(undefined, 7), null);
});

// ── buildTimeline (§C-SYS2.5/2.6 cue rules) ─────────────────────────────────

test('buildTimeline: deterministic — identical inputs → deep-equal timelines', () => {
  const { lines } = level10Fixture();
  const opts = { beats: { bpm: 131, offsetSec: 0.39, beatsPerBar: 4 }, durationSec: 165.2, lines, level: 10, trackId: 'recap-recap-song-2-moreepic-victory' };
  const a = buildTimeline(opts);
  const b = buildTimeline(opts);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('buildTimeline: header fields + 60–120 s clamp + skip flag', () => {
  const { lines } = level10Fixture();
  const t = buildTimeline({ beats: { bpm: 131, offsetSec: 0.39, beatsPerBar: 4 }, durationSec: 165.2, lines, level: 10 });
  assert.equal(t.v, 1);
  assert.equal(t.level, 10);
  assert.equal(t.totalSec, 120);
  assert.equal(t.skipAfterSec, RECAP.SKIP_AFTER_SEC);
  assert.equal(t.skipAfterSec, 10);
  assert.equal(t.bpm, 131);
  assert.equal(t.endCard.minShowSec, 3);
  assert.equal(t.endCard.confettiBeats, 4);
  const short = buildTimeline({ beats: null, durationSec: 45, lines, level: 5 });
  assert.equal(short.totalSec, 60);
});

test('buildTimeline: 8 biome cuts in §C-SYS2.3 order on even bars; end card last', () => {
  const { lines } = level10Fixture();
  const t = buildTimeline({ beats: { bpm: 94.3, offsetSec: 0.13, beatsPerBar: 4 }, durationSec: 83.4, lines, level: 10 });
  const cuts = t.cues.filter((c) => c.kind === 'cut');
  assert.equal(cuts.length, 8);
  assert.deepEqual(cuts.map((c) => c.biome.id), DEFAULT_BIOMES.map((b) => b.id));
  assert.equal(cuts[0].biome.labelDe, 'Blumenwiese');
  assert.equal(cuts[7].biome.labelDe, 'Spielzeugzimmer');
  for (const c of cuts) assert.equal(c.bar % 2, 0);
  const end = t.cues.filter((c) => c.kind === 'end');
  assert.equal(end.length, 1);
  assert.ok(end[0].bar > cuts[7].bar);
  assert.equal(end[0].t, t.endCard.t);
  const last = t.cues[t.cues.length - 1];
  assert.equal(last.kind, 'end');
});

test('buildTimeline: days on the intro slot; §C-SYS2.5 round-robin ≤ 2 per vignette; ≤ 12 lines', () => {
  const { lines } = level10Fixture();
  assert.equal(lines.length, 12); // fixture has ≥ 11 non-zero stats
  const t = buildTimeline({ beats: { bpm: 131, offsetSec: 0.39, beatsPerBar: 4 }, durationSec: 165.2, lines, level: 10 });
  const texts = t.cues.filter((c) => c.kind === 'text');
  assert.ok(texts.length <= RECAP.MAX_LINES);
  const intro = texts.filter((c) => c.vignette === -1);
  assert.equal(intro.length, 1);
  assert.equal(intro[0].lineId, 'days');
  assert.equal(intro[0].textDe, 'Seitdem: 3 Tage vergangen');
  assert.equal(intro[0].textEn, 'Since then: 3 days');
  const perVignette = new Map();
  for (const c of texts) {
    if (c.vignette < 0) continue;
    perVignette.set(c.vignette, (perVignette.get(c.vignette) ?? 0) + 1);
  }
  for (const [v, n] of perVignette) assert.ok(n <= 2, `vignette ${v}: ${n}`);
  // pass 1 fills each vignette once before any vignette gets its 2nd line
  const firstLineVignettes = new Set(
    texts.filter((c) => c.vignette >= 0).map((c) => c.vignette)
  );
  assert.ok(firstLineVignettes.size >= Math.min(8, texts.length - 1));
});

test('buildTimeline: text cues carry EN+DE strings, values, pop/rollup beats on downbeats', () => {
  const { lines } = level10Fixture();
  const t = buildTimeline({ beats: { bpm: 100, offsetSec: 0.2, beatsPerBar: 4 }, durationSec: 100, lines, level: 10 });
  for (const c of t.cues.filter((x) => x.kind === 'text')) {
    assert.equal(typeof c.lineId, 'string');
    assert.ok(c.value >= 0);
    assert.ok(c.textDe.length > 0);
    assert.ok(c.textEn.length > 0);
    assert.equal(c.popBeats, 2);
    assert.equal(c.rollupBeats, 2);
    assert.ok(Math.abs(c.t - (t.offsetSec + c.bar * t.barSec)) < 1e-9, 'pop on a bar downbeat');
  }
});

test('buildTimeline: intro cue at t=0 spans to the first cut', () => {
  const { lines } = level10Fixture();
  const t = buildTimeline({ beats: { bpm: 139.9, offsetSec: 0.4, beatsPerBar: 4 }, durationSec: 109.7, lines, level: 5 });
  const intro = t.cues.find((c) => c.kind === 'intro');
  assert.equal(intro.t, 0);
  assert.equal(intro.bar, 0);
  const firstCut = t.cues.find((c) => c.kind === 'cut');
  assert.equal(intro.durSec, firstCut.t);
  assert.equal(t.cues[0], intro, 'intro sorts first');
});

test('buildTimeline: replay path — history stats rows work as lines input (§C-SYS2.8)', () => {
  const stats = [{ id: 'days', value: 4 }, { id: 'feeds', value: 9 }, { id: 'games', value: 5 }];
  const t = buildTimeline({ beats: null, durationSec: 100, lines: stats, level: 25 });
  const texts = t.cues.filter((c) => c.kind === 'text');
  assert.equal(texts.length, 3);
  assert.equal(texts.find((c) => c.vignette === -1).lineId, 'days');
  assert.equal(t.level, 25);
});

// ── the §E-block node-level proof: simulated L10 recap on the REAL grids ────

test('level-10 recap timeline builds against both committed owner grids', () => {
  const grids = committedGrids();
  const { lines } = level10Fixture();
  const cases = [
    { file: 'Recap - Bonus Stage Blitz - Treblo.beats.json', durationSec: 83.4 },
    { file: 'Recap Song 2 MoreEpic Victory.beats.override.json', durationSec: 165.2 },
  ];
  for (const { file, durationSec } of cases) {
    const beats = grids.get(file);
    assert.ok(beats, `${file} committed`);
    const t = buildTimeline({ beats, durationSec, lines, level: 10 });
    assert.equal(t.cues.filter((c) => c.kind === 'cut').length, 8, file);
    assert.equal(t.cues.filter((c) => c.kind === 'end').length, 1, file);
    assert.ok(t.cues.filter((c) => c.kind === 'text').length >= 9, file);
    assert.ok(t.totalSec >= 60 && t.totalSec <= 120, file);
    // every cue inside the track, on the grid
    for (const c of t.cues) {
      assert.ok(c.t >= 0 && c.t <= durationSec, `${file}: cue within track`);
      if (c.kind !== 'intro') {
        assert.ok(Math.abs(c.t - (t.offsetSec + c.bar * t.barSec)) < 1e-9, `${file}: on grid`);
      }
    }
  }
});
