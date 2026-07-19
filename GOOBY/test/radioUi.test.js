// V4/G52 — pure radio UI contracts + static integration seams.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EN, DE } from '../src/data/strings/v4-radio.js';
import { FURNITURE_BY_ID } from '../src/data/furniture.js';
import {
  RADIO_UI,
  STATION_COVERS,
  slug,
  titleFromFile,
  coverUrl,
  normalizeTrack,
  isStinger,
  deriveStations,
  stationCover,
  isStationLocked,
  tracksForStation,
  sparseTrimUpdate,
  trimFor,
  formatTime,
} from '../src/ui/radioScreen.logic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('radio strings have the exact same non-empty EN and DE key set', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(DE).sort());
  assert.ok(Object.keys(EN).length >= 30);
  for (const key of Object.keys(EN)) {
    assert.ok(EN[key].trim(), `empty EN ${key}`);
    assert.ok(DE[key].trim(), `empty DE ${key}`);
  }
});

test('all station/default cover files referenced by the UI are committed', () => {
  const urls = new Set([RADIO_UI.DEFAULT_COVER, ...Object.values(STATION_COVERS)]);
  for (const url of urls) {
    assert.ok(url.startsWith('/assets/'));
    assert.ok(existsSync(join(ROOT, 'public', url.slice(1))), `missing ${url}`);
  }
});

test('coverUrl accepts manifest spellings and falls back when absent', () => {
  assert.equal(coverUrl(null), RADIO_UI.DEFAULT_COVER);
  assert.equal(
    coverUrl('covers/Radio - Sunny Carrots.png'),
    '/assets/GoobyMusic/covers/Radio - Sunny Carrots.png'
  );
  assert.equal(coverUrl('GoobyMusic/covers/a.png'), '/assets/GoobyMusic/covers/a.png');
  assert.equal(coverUrl('/assets/custom.png'), '/assets/custom.png');
});

test('track id/title helpers handle diacritics and owner Treblo paths', () => {
  assert.equal(slug('Möhrenmond Tanz'), 'mohrenmond-tanz');
  assert.equal(
    titleFromFile('Radio/Gooby der Dicke Hase - Möhrenmond-Tanz - Treblo.mp3'),
    'Möhrenmond-Tanz'
  );
  assert.equal(titleFromFile('Bordmusik - Rabbit Town.ogg'), 'Rabbit Town');
});

test('normalizeTrack fills stable defaults and preserves explicit ids', () => {
  const track = normalizeTrack({
    id: 'radio-sunny',
    file: 'Radio - Sunny.mp3',
    category: 'Radio',
    durationSec: '92.4',
    gainTrim: '1.25',
  });
  assert.equal(track.id, 'radio-sunny');
  assert.equal(track.title, 'Sunny');
  assert.equal(track.category, 'radio');
  assert.equal(track.durationSec, 92.4);
  assert.equal(track.gainTrim, 1.25);
  assert.equal(track.cover, RADIO_UI.DEFAULT_COVER);
  assert.ok(Object.isFrozen(track.stationIds));
});

test('Stingers are excluded by category, id, or duration', () => {
  assert.ok(isStinger(normalizeTrack({ id: 'a', title: 'A', category: 'Stinger' })));
  assert.ok(isStinger(normalizeTrack({ id: 'stinger-result', title: 'A' })));
  assert.ok(isStinger(normalizeTrack({ id: 'a', title: 'A', durationSec: 6 })));
  assert.ok(!isStinger(normalizeTrack({ id: 'song', title: 'A', durationSec: 60 })));
});

const TRACKS = [
  normalizeTrack({ id: 'b1', title: 'Piano', category: 'Bordmusik', source: 'builtin' }),
  normalizeTrack({ id: 'r1', title: 'Gooby', category: 'Radio', source: 'owner' }),
  normalizeTrack({ id: 'e1', title: 'Epic', category: 'Recap', source: 'owner' }),
  normalizeTrack({ id: 'g1', title: 'Game', category: 'Game', source: 'owner' }),
  normalizeTrack({ id: 's1', title: 'Sting', category: 'Stinger', durationSec: 5 }),
];

test('fixed stations derive exact playable counts and hide Stingers', () => {
  const stations = deriveStations(TRACKS);
  assert.deepEqual(stations.map((row) => row.id), [
    'bordmusik', 'gooby-fm', 'recap-fm', 'game-fm', 'alle',
  ]);
  assert.deepEqual(stations.map((row) => row.count), [1, 1, 1, 1, 4]);
  assert.equal(stations.find((row) => row.id === 'recap-fm').unlockLevel, 5);
});

test('registry-provided stations preserve level locks, tracks and custom covers', () => {
  const stations = deriveStations(TRACKS, [{
    id: 'garten-fm',
    label: 'Garden',
    unlockLevel: 12,
    trackIds: ['r1', 'e1'],
  }]);
  assert.equal(stations.length, 1);
  assert.equal(stations[0].count, 2);
  assert.equal(stations[0].cover, stationCover('garten-fm'));
  assert.ok(isStationLocked(stations[0], 11));
  assert.ok(!isStationLocked(stations[0], 12));
  assert.deepEqual(tracksForStation(TRACKS, stations[0]).map((row) => row.id), ['r1', 'e1']);
});

test('empty stations never render', () => {
  assert.deepEqual(deriveStations(TRACKS, [{ id: 'empty', trackIds: [] }]), []);
});

test('station covers map garden/city/night/arcade names to committed art', () => {
  assert.match(stationCover('garten-fm'), /garten/);
  assert.match(stationCover('big-city'), /city/);
  assert.match(stationCover('night-mix'), /nacht/);
  assert.match(stationCover('arcade-hits'), /arcade/);
});

test('sparse trims remove defaults and persist non-default enable/volume values', () => {
  assert.deepEqual(sparseTrimUpdate({}, 'song', { vol: 100, on: true }), {});
  const off = sparseTrimUpdate({}, 'song', { vol: 100, on: false });
  assert.deepEqual(off, { song: { vol: 100, on: false } });
  const trimmed = sparseTrimUpdate(off, 'song', { vol: 55, on: false });
  assert.deepEqual(trimmed, { song: { vol: 55, on: false } });
  assert.deepEqual(sparseTrimUpdate(trimmed, 'song', { vol: 100, on: true }), {});
});

test('trim values clamp 0–150 and quantize to 5', () => {
  assert.deepEqual(trimFor({ a: { vol: 153, on: false } }, 'a'), { vol: 150, on: false });
  assert.deepEqual(trimFor({ a: { vol: 52 } }, 'a'), { vol: 50, on: true });
  assert.deepEqual(trimFor(null, 'a'), { vol: 100, on: true });
  assert.deepEqual(sparseTrimUpdate({}, 'a', { vol: -8, on: true }), {
    a: { vol: 0, on: true },
  });
});

test('radio clock format is stable for invalid, short and hour-long values', () => {
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(9.9), '0:09');
  assert.equal(formatTime(125), '2:05');
  assert.equal(formatTime(3600), '60:00');
});

test('catalog radio row is the free pleasant-picnic 4.0 gift', () => {
  assert.equal(FURNITURE_BY_ID.radio.price, 0);
  assert.equal(FURNITURE_BY_ID.radio.giftV4, true);
  assert.equal(FURNITURE_BY_ID.radio.glb, 'pleasant-picnic/radio');
  assert.ok(existsSync(join(ROOT, 'public/assets/itch/pleasant-picnic/radio.gltf')));
});

test('radio screen registers G58 IA ids and feature-detects both G51 engine names', () => {
  const js = source('src/ui/radioScreen.js');
  for (const id of ['radio', 'radioPanel', 'trackSettings']) {
    assert.match(js, new RegExp(`register(?:Screen|Panel)\\('${id}'`));
  }
  assert.match(js, /\.\.\/audio\/radio\.js/);
  assert.match(js, /\.\.\/audio\/radioPlayer\.js/);
  assert.match(js, /TRACK_PAGE_SIZE/);
});

test('now-playing chip listens to track events, auto-hides at 4 s and reuses one node', () => {
  const js = source('src/ui/nowPlaying.js');
  assert.match(js, /radioTrackChanged/);
  assert.match(js, /CHIP_VISIBLE_MS/);
  assert.match(js, /activeChip\?\.dispose/);
  assert.equal(RADIO_UI.CHIP_VISIBLE_MS, 4000);
});

test('room manager fixture emits tap:radio semantics, pulses at 0.5 Hz and pools notes', () => {
  const js = source('src/home/roomManager.js');
  assert.match(js, /pleasant-picnic\/radio/);
  assert.match(js, /userData\.interact = 'radio'/);
  assert.match(js, /radioFxTime \* Math\.PI/);
  assert.match(js, /nextRadioNotesAt = radioFxTime \+ 4/);
  assert.match(js, /for \(let i = 0; i < 4; i \+= 1\)/);
});
