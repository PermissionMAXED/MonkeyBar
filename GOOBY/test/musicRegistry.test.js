// GOOBY V4/G51 — music manifest + registry coverage (PLAN4 §B2.1/§B2.2,
// §C-SYS1.1/1.2/1.6/1.7):
//   • committed src/data/musicManifest.json schema shape, id uniqueness,
//     deterministic sort, §B2.2 number formats (durationSec 1dp, gainTrim
//     2dp clamped 0.3–2.0)
//   • PATH INTEGRITY: every manifest file/cover/beats path exists on disk
//     (the reverse is NOT asserted — owner files may arrive between runs)
//   • §C-SYS1.7 Bordmusik minimum (≥ 13 builtin tracks) + the recap fallback
//   • §C-SYS1.2 station math (fixed table, stinger exclusion, level-locked
//     tracks stay listed — the queue filters)
//   • trackFor(context) — room/game/location contexts incl. the bedroom
//     Awake/Sleeping variants and the musicDirector aliases
//   • §C-SYS1.6 cover fallback chain
//   • gen-music-manifest.mjs pure helpers (§B2.1 name parse, §C-SYS1.6
//     sanitize, gainTrim math, buildManifest determinism/dedup) — the script
//     exports them precisely so this suite can pin the conventions
//   • §B5.3 beats file shape + override precedence for every Recap track

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import manifest from '../src/data/musicManifest.json' with { type: 'json' };
import {
  STATION_DEFS, STATION_IDS, DEFAULT_COVER, CONTEXT_ALIASES, STINGER_MAX_SEC,
  getTracks, trackById, isStinger, trackBelongsTo, stationTrackIds,
  getStations, trackFor, coverFor,
} from '../src/systems/musicRegistry.js';
import {
  slug, sanitizeBasename, parseName, classifyOwnerPath, gainTrimFor,
  buildManifest, serializeManifest, TRIM_CLAMP,
} from '../scripts/gen-music-manifest.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');

// ------------------------------------------------------- manifest schema

test('manifest: v1 envelope + per-track schema shape (§B2.2)', () => {
  assert.equal(manifest.v, 1);
  assert.ok(Array.isArray(manifest.tracks));
  assert.ok(manifest.tracks.length >= 14, `expected ≥ 14 tracks day one, got ${manifest.tracks.length}`);
  for (const t of manifest.tracks) {
    assert.equal(typeof t.id, 'string', `${t.file}: id`);
    assert.ok(/^[a-z0-9-]+$/.test(t.id), `${t.id}: kebab slug`);
    assert.equal(typeof t.file, 'string');
    assert.ok(/\.(mp3|ogg)$/i.test(t.file), `${t.file}: audio ext`);
    assert.equal(typeof t.category, 'string');
    assert.equal(typeof t.title, 'string');
    assert.ok(t.title.length > 0);
    assert.ok(['owner', 'builtin'].includes(t.source), `${t.id}: source`);
    assert.equal(typeof t.durationSec, 'number');
    assert.ok(t.durationSec > 0);
    assert.equal(Math.round(t.durationSec * 10) / 10, t.durationSec, `${t.id}: durationSec 1dp`);
    assert.equal(typeof t.gainTrim, 'number');
    assert.ok(t.gainTrim >= TRIM_CLAMP.min && t.gainTrim <= TRIM_CLAMP.max, `${t.id}: gainTrim clamp`);
    assert.equal(Math.round(t.gainTrim * 100) / 100, t.gainTrim, `${t.id}: gainTrim 2dp`);
    assert.ok(Number.isInteger(t.unlockLevel) && t.unlockLevel >= 1, `${t.id}: unlockLevel`);
    assert.ok(t.context === null || typeof t.context === 'string');
    assert.ok(t.variant === null || ['awake', 'sleeping'].includes(t.variant));
    assert.ok(t.cover === null || typeof t.cover === 'string');
    assert.ok(t.beats === null || typeof t.beats === 'string');
  }
});

test('manifest: unique ids, sorted deterministically (§B2.2)', () => {
  const ids = manifest.tracks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  const sorted = [...ids].sort((a, b) => a.localeCompare(b, 'en'));
  assert.deepEqual(ids, sorted, 'not sorted by id');
});

test('manifest: every file/cover/beats path exists on disk (§B2.2 path integrity)', () => {
  for (const t of manifest.tracks) {
    assert.ok(fs.existsSync(path.join(ASSETS, t.file)), `missing audio: ${t.file}`);
    if (t.cover) assert.ok(fs.existsSync(path.join(ASSETS, t.cover)), `missing cover: ${t.cover}`);
    if (t.beats) assert.ok(fs.existsSync(path.join(ASSETS, t.beats)), `missing beats: ${t.beats}`);
  }
  assert.ok(fs.existsSync(path.join(ASSETS, DEFAULT_COVER)), 'fallback cover missing');
  for (const def of STATION_DEFS) {
    assert.ok(fs.existsSync(path.join(ASSETS, def.cover)), `station cover missing: ${def.cover}`);
  }
});

test('manifest: §C-SYS1.7 Bordmusik minimum + recap fallback', () => {
  const builtin = manifest.tracks.filter((t) => t.source === 'builtin');
  assert.ok(builtin.length >= 14, `builtin ${builtin.length} < 14`);
  assert.ok(builtin.filter((t) => t.category === 'Bordmusik').length >= 13, '§C-SYS1.7: ≥ 13 Bordmusik');
  assert.ok(builtin.some((t) => t.category === 'Recap'), 'builtin recap fallback missing');
});

test('manifest: sub-10s files are Stingers; Stingers carry no context (§B2.1)', () => {
  for (const t of manifest.tracks) {
    if (t.durationSec < STINGER_MAX_SEC) assert.equal(t.category, 'Stinger', t.id);
    if (t.category === 'Stinger') assert.equal(t.context, null, t.id);
  }
});

test('manifest: level-locked folder tracks carry unlockLevel > 1 (§C-SYS1)', () => {
  const locked = manifest.tracks.filter((t) => /\/Level \d+\//.test(t.file));
  assert.ok(locked.length >= 4, `expected level-locked tracks, got ${locked.length}`);
  for (const t of locked) {
    const want = Number(/\/Level (\d+)\//.exec(t.file)[1]);
    assert.equal(t.unlockLevel, want, `${t.id}: unlockLevel ${t.unlockLevel} ≠ folder ${want}`);
  }
  for (const t of manifest.tracks.filter((x) => !/\/Level \d+\//.test(x.file))) {
    assert.equal(t.unlockLevel, 1, `${t.id}: free track must be level 1`);
  }
});

// ------------------------------------------------------- station math

test('stations: fixed §C-SYS1.2 table, frozen ids, day-one members', () => {
  assert.deepEqual(STATION_IDS, ['bordmusik', 'gooby-fm', 'recap-fm', 'game-fm', 'alle']);
  const stations = getStations();
  const byId = new Map(stations.map((s) => [s.id, s]));
  assert.ok(byId.get('bordmusik').count >= 13, 'bordmusik ≥ 13');
  assert.ok(byId.get('recap-fm').count >= 3, 'recap-fm ≥ 3 (2 owner + builtin fallback)');
  assert.ok(byId.get('gooby-fm').count >= 10, 'gooby-fm carries the owner Radio drop');
  assert.ok(byId.get('game-fm').count >= 7, 'game-fm carries the 7 game themes');
  const nonStingers = getTracks().filter((t) => !isStinger(t));
  assert.equal(byId.get('alle').count, nonStingers.length, 'alle = every non-stinger');
});

test('stations: stingers NEVER join a station (§C-SYS1.2)', () => {
  const stingers = getTracks().filter(isStinger);
  assert.ok(stingers.length >= 2, 'the owner stingers are in the manifest');
  for (const s of getStations()) {
    for (const st of stingers) {
      assert.ok(!s.trackIds.includes(st.id), `${st.id} leaked into ${s.id}`);
    }
  }
});

test('stations: level-locked tracks stay LISTED (queue filters, list badges)', () => {
  const locked = getTracks().filter((t) => t.unlockLevel > 1 && t.category === 'Radio');
  assert.ok(locked.length >= 4);
  const ids = stationTrackIds('gooby-fm');
  for (const t of locked) assert.ok(ids.includes(t.id), `${t.id} missing from gooby-fm list`);
});

test('stations: membership rule table (trackBelongsTo)', () => {
  const radio = getTracks().find((t) => t.category === 'Radio');
  const bord = getTracks().find((t) => t.category === 'Bordmusik');
  const recap = getTracks().find((t) => t.category === 'Recap' && t.source === 'builtin');
  assert.ok(trackBelongsTo(radio, 'gooby-fm') && !trackBelongsTo(radio, 'bordmusik'));
  assert.ok(trackBelongsTo(bord, 'bordmusik') && trackBelongsTo(bord, 'alle'));
  assert.ok(trackBelongsTo(recap, 'recap-fm') && !trackBelongsTo(recap, 'bordmusik'),
    'builtin recap joins recap-fm, NOT bordmusik');
  assert.ok(!trackBelongsTo(radio, 'nope'));
});

test('getStations(tracks) drops zero-track stations (empty-folder grace)', () => {
  const only = getTracks().filter((t) => t.category === 'Bordmusik');
  const stations = getStations(only);
  assert.deepEqual(stations.map((s) => s.id), ['bordmusik', 'alle']);
  assert.deepEqual(getStations([]), []);
});

// ------------------------------------------------------- trackFor(context)

test('trackFor: rooms play their Treblo tracks (owner folder convention)', () => {
  for (const room of ['kitchen', 'living', 'bathroom', 'garden']) {
    const t = trackFor(`room:${room}`);
    assert.ok(t, `room:${room} has no track`);
    assert.equal(t.context, `room:${room}`);
    assert.equal(t.category, 'Room');
  }
});

test('trackFor: bedroom has Awake/Sleeping variants', () => {
  const awake = trackFor('room:bedroom');
  const sleeping = trackFor('room:bedroom', { sleeping: true });
  assert.ok(awake && sleeping);
  assert.equal(awake.variant, 'awake');
  assert.equal(sleeping.variant, 'sleeping');
  assert.notEqual(awake.id, sleeping.id);
});

test('trackFor: musicDirector aliases (home/garden/city/shop=IKEA/arcade)', () => {
  assert.equal(CONTEXT_ALIASES.shop, 'location:shop');
  assert.equal(trackFor('home')?.context, 'room:living');
  assert.equal(trackFor('garden')?.context, 'room:garden');
  assert.equal(trackFor('city')?.context, 'location:city');
  const ikea = trackFor('shop');
  assert.equal(ikea?.context, 'location:shop');
  assert.ok(/ikea/i.test(ikea.file), 'shop alias resolves the IKEA folder track');
  assert.ok(trackFor('arcade'), 'arcade UI music');
});

test('trackFor: games play their themes; unknown contexts → null', () => {
  for (const game of ['shoppingSurf', 'goobyWelt', 'harborHopper', 'purblePlace', 'toyRacer', 'starHopper', 'ghostHunt']) {
    const t = trackFor(`game:${game}`);
    assert.ok(t, `game:${game} theme missing`);
    assert.equal(t.category, 'Game');
  }
  assert.equal(trackFor('game:doesNotExist'), null);
  assert.equal(trackFor(''), null);
  assert.equal(trackFor(null), null);
});

test('coverFor: §C-SYS1.6 fallback chain (track → station → default)', () => {
  // Per-track cover PNGs are coordinator art (ART-GATE-1 ships station covers
  // + the default only) — the chain is pinned with a synthetic row, and any
  // track that DOES carry a manifest cover must win the chain.
  assert.equal(coverFor({ id: 'x', cover: 'GoobyMusic/covers/x.png' }), 'GoobyMusic/covers/x.png');
  for (const t of getTracks().filter((row) => row.cover)) {
    assert.equal(coverFor(t), t.cover);
  }
  const bare = { id: 'x', cover: null };
  assert.equal(coverFor(bare, 'recap-fm'), STATION_DEFS.find((s) => s.id === 'recap-fm').cover);
  assert.equal(coverFor(bare), DEFAULT_COVER);
  assert.equal(coverFor(null), DEFAULT_COVER);
  assert.equal(coverFor('missing-id', 'bogus-station'), DEFAULT_COVER);
});

test('trackById round-trips every manifest row', () => {
  for (const t of getTracks()) assert.equal(trackById(t.id), t);
  assert.equal(trackById('nope'), null);
});

// ------------------------------------------------------- generator helpers

test('slug: §B2.1 kebab ids with diacritics folded', () => {
  assert.equal(slug('Radio - Sunny Carrots'), 'radio-sunny-carrots');
  assert.equal(slug('König im Kleefeld'), 'konig-im-kleefeld');
  assert.equal(slug('  ~~ '), 'track');
});

test('parseName: artist prefix / Treblo suffix / duplicate marker stripped (§B2.1)', () => {
  assert.deepEqual(parseName('Gooby der Dicke Hase - Radio Gaga - Treblo'),
    { nameCategory: null, title: 'Radio Gaga' });
  assert.deepEqual(parseName('Radio - Sunny Carrots'),
    { nameCategory: 'Radio', title: 'Sunny Carrots' });
  assert.equal(parseName('Recap - Abenteuer').nameCategory, 'Recap');
  assert.equal(parseName('Bordmusik - Ein Held').title, 'Ein Held');
  // a song TITLED like the artist keeps its name
  assert.equal(parseName('Gooby der Dicke Hase - Gooby der Dicke Hase - Treblo').title, 'Gooby der Dicke Hase');
  assert.equal(parseName('Stinger - LevelUp - Treblo').nameCategory, 'Stinger');
  assert.equal(parseName('Something (1)').title, 'Something');
});

test('classifyOwnerPath: folder conventions (Radio levels, Rooms variants, Games, Locations)', () => {
  const silent = () => {};
  assert.equal(classifyOwnerPath(['Radio'], 'x', silent).category, 'Radio');
  assert.equal(classifyOwnerPath(['Radio', 'Level 10'], 'x', silent).unlockLevel, 10);
  assert.equal(classifyOwnerPath(['Radio', 'LockedbyLevel', 'Level 15'], 'x', silent).unlockLevel, 15);
  const bed = classifyOwnerPath(['Rooms', 'Bedroom', 'Sleeping'], 'x', silent);
  assert.equal(bed.context, 'room:bedroom');
  assert.equal(bed.variant, 'sleeping');
  assert.equal(classifyOwnerPath(['Rooms', 'MainRoomLivingRoom'], 'x', silent).context, 'room:living');
  assert.equal(classifyOwnerPath(['Games', 'Racing'], 'x', silent).context, 'game:toyRacer');
  assert.equal(classifyOwnerPath(['Locations', 'IKEA'], 'x', silent).context, 'location:shop');
  assert.equal(classifyOwnerPath([], 'Recap - Foo', silent).category, 'Recap');
});

test('gainTrimFor: −16 dB target, clamp 0.3–2.0, 2 decimals (§B2.2)', () => {
  assert.equal(gainTrimFor(-16), 1);
  assert.equal(gainTrimFor(-22), 2); // +6 dB ≈ ×2 (clamped exactly at max)
  assert.equal(gainTrimFor(-40), TRIM_CLAMP.max);
  assert.equal(gainTrimFor(0), TRIM_CLAMP.min);
  assert.equal(gainTrimFor(-19.5), 1.5);
});

test('sanitizeBasename: §C-SYS1.6 cover-name fallback folding', () => {
  assert.equal(sanitizeBasename('König im Kleefeld'), 'Konig im Kleefeld');
  assert.equal(sanitizeBasename("Cloud Hopper's Day Off"), "Cloud Hopper's Day Off");
  assert.equal(sanitizeBasename('a/b:c'), 'a_b_c');
});

test('buildManifest: deterministic, deduped, graceful-empty (§B2.2)', () => {
  const io = { warn: () => {}, findCover: () => null, findBeats: () => null };
  const rows = [
    { root: 'owner', rel: 'Radio/Two.mp3', durationSec: 62.34, meanDb: -16 },
    { root: 'owner', rel: 'Radio/One.mp3', durationSec: 45.06, meanDb: -10 },
    { root: 'owner', rel: 'Radio/One (1).mp3', durationSec: 45.06, meanDb: -10 },
    { root: 'builtin', rel: 'Bordmusik - Sea.ogg', durationSec: 30, meanDb: -20 },
    { root: 'owner', rel: 'Stinger - Hit.mp3', durationSec: 2.2, meanDb: -12 },
  ];
  const a = buildManifest(rows, io);
  const b = buildManifest([...rows].reverse(), io);
  assert.equal(serializeManifest(a), serializeManifest(b), 'input order must not matter');
  const ids = a.tracks.map((t) => t.id);
  assert.deepEqual(ids, [...ids].sort((x, y) => x.localeCompare(y, 'en')));
  assert.ok(ids.includes('radio-one') && ids.includes('radio-one-2'), 'duplicate dedupe -2 suffix');
  assert.equal(a.tracks.find((t) => t.id === 'stinger-hit').category, 'Stinger');
  assert.equal(a.tracks.find((t) => t.id === 'bordmusik-sea').source, 'builtin');
  assert.deepEqual(buildManifest([], io), { v: 1, tracks: [] }, 'graceful-empty');
  assert.ok(serializeManifest({ v: 1, tracks: [] }).endsWith('\n'));
});

// ------------------------------------------------------- beats (§B5.3)

test('beats: every Recap track has a valid grid; overrides WIN (§B5.3/§E0.1-17)', () => {
  const recaps = manifest.tracks.filter((t) => t.category === 'Recap');
  assert.ok(recaps.length >= 3);
  for (const t of recaps) {
    assert.ok(t.beats, `${t.id}: Recap without beats file`);
    const grid = JSON.parse(fs.readFileSync(path.join(ASSETS, t.beats), 'utf8'));
    assert.ok(grid.bpm >= 60 && grid.bpm <= 180, `${t.id}: bpm ${grid.bpm}`);
    assert.ok(grid.offsetSec >= 0 && grid.offsetSec < 60 / grid.bpm + 0.01, `${t.id}: offset ${grid.offsetSec}`);
    assert.equal(grid.beatsPerBar, 4);
    // override precedence: when <basename>.beats.override.json exists on
    // disk, the manifest MUST reference it (gen-music-manifest order).
    const base = t.beats.replace(/\.beats(\.override)?\.json$/, '');
    if (fs.existsSync(path.join(ASSETS, `${base}.beats.override.json`))) {
      assert.ok(t.beats.endsWith('.beats.override.json'), `${t.id}: override exists but manifest points at ${t.beats}`);
    }
  }
});
