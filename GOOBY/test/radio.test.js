// GOOBY V4/G51 — radio queue logic + engine coverage (PLAN4 §B2.3/§B2.4,
// §C-SYS1.3/1.5):
//   • radioQueue.logic.js pure math: trim sanitize (0–150 step 5, default
//     100/on), §B2.3 effective gain, level locks, per-track enable, the
//     §C-SYS1.5 all-disabled fallback, seeded shuffle determinism, skip/next
//     stepping with wrap-around
//   • the radioPlayer.js engine LIVE against a stub AudioContext + element
//     factory + a real store: start/resume, skip, station switch, shuffle,
//     per-track trims applied to the live gain, duck/resume (danceParty/
//     recap exclusivity), the §C2.3 airtight mute (element paused + ZERO
//     node creation while settings.music is off), the musicDirector
//     setRadioActive gate driven by radio.replaceContext, playContext()
//     room/game playback incl. the bedroom Awake/Sleeping variants, the
//     'radioChanged'/'radioTrackChanged' event contracts, and auto-advance
//     on element 'ended'.
//
// The engine is a module singleton (like audio.js) — the engine tests run in
// declaration order and share its state on purpose.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIM_DEFAULT, TRIM_VOL_MAX, mulberry32, hashStr, trimFor, effectiveGain,
  eligibleTracks, queueOrder, buildQueue, nextTrackId,
} from '../src/systems/radioQueue.logic.js';
import radio, { DEFAULT_STATION, FADE_SEC, trackUrl } from '../src/audio/radioPlayer.js';
import radioAlias from '../src/audio/radio.js';
import musicDirector from '../src/audio/musicDirector.js';
import { getStations, trackById, trackFor, stationTrackIds } from '../src/systems/musicRegistry.js';
import { createStore } from '../src/core/store.js';
import { defaultState } from '../src/core/save.js';

// ---------------------------------------------------------------- pure math

test('trimFor: §C-SYS1.5 sanitize — clamp 0–150, step 5, defaults 100/on', () => {
  assert.deepEqual(trimFor(null, 'x'), TRIM_DEFAULT);
  assert.deepEqual(trimFor({}, 'x'), { vol: 100, on: true });
  assert.equal(trimFor({ x: { vol: 47 } }, 'x').vol, 45);
  assert.equal(trimFor({ x: { vol: 999 } }, 'x').vol, TRIM_VOL_MAX);
  assert.equal(trimFor({ x: { vol: -50 } }, 'x').vol, 0);
  assert.equal(trimFor({ x: { vol: 'junk' } }, 'x').vol, 100);
  assert.equal(trimFor({ x: { on: false } }, 'x').on, false);
  assert.equal(trimFor({ x: { on: 0 } }, 'x').on, true, 'on is strict-boolean false only');
});

test('effectiveGain: §B2.3 manifest.gainTrim × (vol/100)', () => {
  assert.equal(effectiveGain({ id: 'x', gainTrim: 1.2 }, { x: { vol: 50 } }), 0.6);
  assert.equal(effectiveGain({ id: 'x', gainTrim: 0.8 }, {}), 0.8);
  assert.equal(effectiveGain({ id: 'x', gainTrim: 1 }, { x: { vol: 150 } }), 1.5);
  assert.equal(effectiveGain({ id: 'x' }, {}), 1, 'missing trim defaults to 1');
});

test('eligibleTracks: level locks + per-track enable + all-disabled fallback', () => {
  const tracks = [
    { id: 'a', unlockLevel: 1 }, { id: 'b', unlockLevel: 5 }, { id: 'c', unlockLevel: 15 },
  ];
  assert.deepEqual(eligibleTracks(tracks, { level: 1 }).tracks.map((t) => t.id), ['a']);
  assert.deepEqual(eligibleTracks(tracks, { level: 5 }).tracks.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(eligibleTracks(tracks, { level: 99 }).tracks.map((t) => t.id), ['a', 'b', 'c']);
  const half = eligibleTracks(tracks, { level: 5, trims: { a: { on: false } } });
  assert.deepEqual(half.tracks.map((t) => t.id), ['b']);
  assert.equal(half.allDisabled, false);
  // §C-SYS1.5: ALL eligible disabled → play them anyway, flagged
  const allOff = eligibleTracks(tracks, { level: 5, trims: { a: { on: false }, b: { on: false } } });
  assert.deepEqual(allOff.tracks.map((t) => t.id), ['a', 'b']);
  assert.equal(allOff.allDisabled, true);
  assert.deepEqual(eligibleTracks([], {}), { tracks: [], allDisabled: false });
});

test('queueOrder: seeded shuffle is stable per (seed, station), differs across stations', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const s1 = queueOrder(ids, { seed: 42, stationId: 'gooby-fm' });
  const s2 = queueOrder(ids, { seed: 42, stationId: 'gooby-fm' });
  assert.deepEqual(s1, s2, 'same save+station → same order');
  assert.deepEqual([...s1].sort(), [...ids].sort(), 'permutation only');
  const other = queueOrder(ids, { seed: 42, stationId: 'bordmusik' });
  assert.notDeepEqual(s1, other, 'different station → different order');
  const reseed = queueOrder(ids, { seed: 43, stationId: 'gooby-fm' });
  assert.notDeepEqual(s1, reseed, 'different save seed → different order');
  assert.deepEqual(queueOrder(ids, { shuffle: false, seed: 42 }), ids, 'shuffle off = manifest order');
  assert.deepEqual(queueOrder(['solo'], { seed: 1 }), ['solo']);
});

test('mulberry32/hashStr: deterministic primitives', () => {
  const r1 = mulberry32(7);
  const r2 = mulberry32(7);
  assert.equal(r1(), r2());
  assert.equal(hashStr('gooby-fm'), hashStr('gooby-fm'));
  assert.notEqual(hashStr('gooby-fm'), hashStr('bordmusik'));
});

test('nextTrackId: forward/back stepping with wrap; unknown id starts at head', () => {
  const q = ['a', 'b', 'c'];
  assert.equal(nextTrackId(q, 'a'), 'b');
  assert.equal(nextTrackId(q, 'c'), 'a', 'wraps forward');
  assert.equal(nextTrackId(q, 'a', -1), 'c', 'wraps backward');
  assert.equal(nextTrackId(q, 'zz'), 'a', 'unknown → head (lastTrack continue rule)');
  assert.equal(nextTrackId(q, null), 'a');
  assert.equal(nextTrackId([], 'a'), null);
});

test('buildQueue: filter + order in one step', () => {
  const tracks = [
    { id: 'a', unlockLevel: 1 }, { id: 'b', unlockLevel: 9 }, { id: 'c', unlockLevel: 1 },
  ];
  const q = buildQueue(tracks, { level: 1, shuffle: false });
  assert.deepEqual(q.ids, ['a', 'c']);
  assert.equal(q.allDisabled, false);
});

// ---------------------------------------------------------------- engine

/** Minimal AudioParam stub (value + the ramp methods the engine touches). */
function stubParam(v = 1) {
  return {
    value: v,
    setValueAtTime(x) { this.value = x; },
    linearRampToValueAtTime(x) { this.value = x; },
    setTargetAtTime(x) { this.value = x; },
    cancelScheduledValues() {},
  };
}

/** Node-counting stub AudioContext (createMediaElementSource included). */
function stubCtx() {
  return {
    currentTime: 0,
    state: 'running',
    created: 0,
    createGain() {
      this.created += 1;
      return { gain: stubParam(1), connect(n) { return n; }, disconnect() {} };
    },
    createMediaElementSource() {
      this.created += 1;
      return { connect(n) { return n; } };
    },
  };
}

/** HTMLAudioElement stub with manual event firing. */
function stubElement() {
  const handlers = new Map();
  return {
    preload: '',
    loop: false,
    src: '',
    paused: true,
    currentTime: 0,
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() { this.paused = true; },
    addEventListener(evt, cb) { handlers.set(evt, cb); },
    fire(evt) { handlers.get(evt)?.(); },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSITION_MS = FADE_SEC * 1000 + 60;

const store = createStore(defaultState(), { autosave: false });
const ctx = stubCtx();
const el = stubElement();
const radioGain = ctx.createGain();
const events = { track: [], changed: [] };
store.on('radioTrackChanged', (p) => events.track.push(p));
store.on('radioChanged', (p) => events.changed.push(p));

test.after(() => radio.reset());

test('radio.js alias exports the SAME singleton as radioPlayer.js', () => {
  assert.equal(radioAlias, radio);
});

test('trackUrl: /assets/-relative, URI-encoded', () => {
  assert.equal(trackUrl('music/Bordmusik - A.ogg'), '/assets/music/Bordmusik%20-%20A.ogg');
});

test('attach + start: plays a real manifest track through the chain (§B2.3)', () => {
  radio.attach({ ctx, radioGain, createElement: () => el });
  radio.setShuffle(false); // deterministic queue order for the suite
  radio.start('gooby-fm');
  const stats = radio.getStats();
  assert.equal(stats.playing, true);
  assert.equal(stats.station, 'gooby-fm');
  assert.equal(stats.elementState, 'playing');
  assert.equal(stats.elementWired, true, 'createMediaElementSource wired');
  const ids = stationTrackIds('gooby-fm');
  assert.ok(ids.includes(stats.trackId), `trackId ${stats.trackId} from the station`);
  const track = trackById(stats.trackId);
  assert.ok(el.src.startsWith('/assets/GoobyMusic/'), `element src ${el.src}`);
  assert.equal(stats.gain, effectiveGain(track, {}), '§B2.3 gain = gainTrim × vol');
  assert.equal(store.get('radio.playing'), true, 'wish persisted');
  assert.equal(store.get('radio.lastTrack'), stats.trackId);
});

test('radioTrackChanged carries the §C-SYS1.8 now-playing contract', () => {
  assert.ok(events.track.length >= 1);
  const p = events.track.at(-1);
  assert.equal(p.id, p.trackId, 'both spellings');
  const track = trackById(p.trackId);
  assert.equal(p.title, track.title);
  assert.equal(typeof p.cover, 'string', 'cover always resolved (fallback chain)');
  assert.equal(p.station, 'gooby-fm');
  assert.equal(p.duration, track.durationSec);
  assert.equal(typeof p.t, 'number');
  const n = radio.now();
  assert.deepEqual(
    { id: n.id, title: n.title, cover: n.cover, station: n.station, duration: n.duration },
    { id: p.id, title: p.title, cover: p.cover, station: p.station, duration: p.duration }
  );
});

test('level locks: the queue grows with the player level (§C-SYS1)', () => {
  const q1 = radio.getStats().queue;
  store.update((s) => { s.level = 99; });
  const q99 = radio.getStats().queue;
  assert.ok(q1 < q99, `level 1 queue ${q1} < level 99 queue ${q99}`);
  const lockedIds = stationTrackIds('gooby-fm').filter((id) => trackById(id).unlockLevel > 1);
  assert.equal(q99 - q1, lockedIds.length, 'exactly the locked tracks joined');
  store.update((s) => { s.level = 1; });
  assert.equal(radio.getStats().queue, q1);
});

test('skip: steps the queue in manifest order (shuffle off) with a ≤400 ms gap', async () => {
  const before = radio.getStats().trackId;
  const queueIds = buildQueue(
    stationTrackIds('gooby-fm').map(trackById),
    { level: 1, trims: store.get('radio.trims'), shuffle: false, stationId: 'gooby-fm' }
  ).ids;
  const expected = nextTrackId(queueIds, before, 1);
  radio.skip(1);
  await wait(TRANSITION_MS); // 300 ms fade-out → swap → fade-in
  const after = radio.getStats();
  assert.equal(after.trackId, expected);
  assert.equal(after.elementState, 'playing');
  assert.equal(store.get('radio.lastTrack'), expected);
  assert.ok(after.transitions >= 2);
});

test('per-track trim: vol 50 halves the LIVE gain (§C-SYS1.5)', async () => {
  const id = radio.getStats().trackId;
  const base = trackById(id).gainTrim;
  radio.setTrim(id, { vol: 50 });
  assert.equal(radio.getStats().gain, Math.round(base * 0.5 * 1000) / 1000);
  assert.deepEqual(store.get('radio.trims')[id], { vol: 50, on: true }, 'persisted sparsely');
  radio.setTrim(id, { vol: 100 });
  assert.equal(radio.getStats().gain, base);
});

test('all-disabled fallback: station plays anyway, flagged (§C-SYS1.5)', () => {
  const ids = buildQueue(
    stationTrackIds('gooby-fm').map(trackById), { level: 1, shuffle: false }
  ).ids;
  for (const id of ids) radio.setTrim(id, { on: false });
  const stats = radio.getStats();
  assert.equal(stats.allDisabled, true);
  assert.equal(stats.queue, ids.length, 'silence is never persisted');
  for (const id of ids) radio.setTrim(id, { on: true });
  assert.equal(radio.getStats().allDisabled, false);
});

test('station switch: setStation starts the new station immediately', async () => {
  radio.setStation('bordmusik');
  await wait(TRANSITION_MS);
  const stats = radio.getStats();
  assert.equal(stats.station, 'bordmusik');
  assert.ok(stationTrackIds('bordmusik').includes(stats.trackId));
  assert.ok(el.src.startsWith('/assets/music/'), 'builtin file plays');
  assert.equal(store.get('radio.station'), 'bordmusik');
  radio.setStation('bogus');
  assert.equal(radio.getStats().station, 'bordmusik', 'unknown station ignored');
});

test('ended → auto-advance to the next queue track', async () => {
  const before = radio.getStats().trackId;
  el.fire('ended');
  await wait(TRANSITION_MS);
  const after = radio.getStats().trackId;
  assert.notEqual(after, before);
  assert.ok(stationTrackIds('bordmusik').includes(after));
});

test('musicDirector gate: radioActive follows audible × replaceContext (§B2.4)', () => {
  assert.equal(musicDirector.getStats().radioActive, true, 'playing + replaceContext → suppressed');
  radio.setReplaceContext(false);
  assert.equal(musicDirector.getStats().radioActive, false);
  assert.equal(store.get('radio.replaceContext'), false);
  radio.setReplaceContext(true);
  assert.equal(musicDirector.getStats().radioActive, true);
});

test('duck: danceParty/recap exclusivity — pause + remember + resume (§B2.4)', () => {
  radio.duck(true, 'dance');
  assert.equal(el.paused, true, 'ducked = element paused');
  assert.equal(radio.getStats().playing, false);
  assert.deepEqual(radio.getStats().ducked, ['dance']);
  assert.equal(musicDirector.getStats().radioActive, false, 'medley may resume while ducked');
  radio.duck(true, 'recap'); // reasons stack
  radio.duck(false, 'dance');
  assert.equal(el.paused, true, 'still ducked by recap');
  radio.duck(false, 'recap');
  assert.equal(el.paused, false, 'resumed');
  assert.equal(radio.getStats().playing, true);
  assert.equal(musicDirector.getStats().radioActive, true);
});

test('airtight mute: element paused + ZERO node creation while music off (§C2.3)', () => {
  radio.setEnabled(false);
  assert.equal(el.paused, true);
  const nodes = ctx.created;
  radio.start('gooby-fm'); // wishes are remembered, never played while muted
  radio.skip(1);
  radio.playContext('room:kitchen');
  assert.equal(ctx.created, nodes, 'zero nodes while muted');
  assert.equal(el.paused, true);
  assert.equal(radio.getStats().playing, false);
  radio.setEnabled(true);
  assert.equal(el.paused, false, 'wish resumes on re-enable');
  assert.equal(radio.getStats().playing, true);
});

test('playContext: room/game playback via trackFor, looped; bedroom variants', async () => {
  const kitchen = radio.playContext('room:kitchen');
  assert.equal(kitchen.context, 'room:kitchen');
  await wait(TRANSITION_MS);
  assert.equal(radio.getStats().trackId, kitchen.id);
  assert.equal(el.loop, true, 'context tracks loop');
  const awake = radio.playContext('room:bedroom');
  assert.equal(awake.variant, 'awake');
  store.update((s) => { s.sleep = { ...s.sleep, sleeping: true }; });
  const asleep = radio.playContext('room:bedroom');
  assert.equal(asleep.variant, 'sleeping', 'sleep state picks the Sleeping variant');
  store.update((s) => { s.sleep = { ...s.sleep, sleeping: false }; });
  const forced = radio.playContext('room:bedroom', { sleeping: true });
  assert.equal(forced.variant, 'sleeping', 'opts.sleeping overrides');
  assert.notEqual(awake.id, asleep.id);
  assert.equal(radio.playContext('game:doesNotExist'), null, 'unknown context → null (medley keeps playing)');
  const game = radio.playContext('game:toyRacer');
  assert.equal(game.id, trackFor('game:toyRacer').id);
  el.fire('ended');
  await wait(TRANSITION_MS);
  assert.equal(radio.getStats().trackId, game.id, 'context playback never queue-advances');
});

test('stop: fades out, pauses, persists playing=false; start resumes lastTrack', async () => {
  radio.start('bordmusik');
  await wait(TRANSITION_MS);
  const last = radio.getStats().trackId;
  radio.stop();
  assert.equal(radio.getStats().playing, false);
  assert.equal(store.get('radio.playing'), false);
  assert.equal(musicDirector.getStats().radioActive, false, 'medley resumes when the radio stops');
  await wait(TRANSITION_MS);
  assert.equal(el.paused, true, 'paused after the fade');
  radio.toggle(); // toggle = start
  assert.equal(radio.getStats().trackId, last, '§C-SYS1.3: lastTrack continues the queue');
  assert.equal(radio.getStats().playing, true);
  radio.toggle(); // and back off
  assert.equal(radio.getStats().playing, false);
});

test('radioChanged event: §B10 {playing, station, trackId} payload', () => {
  assert.ok(events.changed.length >= 2);
  const p = events.changed.at(-1);
  assert.deepEqual(Object.keys(p).sort(), ['playing', 'station', 'trackId']);
  assert.equal(typeof p.playing, 'boolean');
  assert.equal(typeof p.station, 'string');
});

test('shuffle: seeded queue reorders but keeps the same members', () => {
  radio.setShuffle(true);
  assert.equal(store.get('radio.shuffle'), true);
  const shuffled = buildQueue(
    stationTrackIds('bordmusik').map(trackById),
    { level: 1, shuffle: true, seed: 7, stationId: 'bordmusik' }
  ).ids;
  const plain = stationTrackIds('bordmusik');
  assert.deepEqual([...shuffled].sort(), [...plain].sort());
  assert.equal(radio.getStats().queue, plain.length);
  radio.setShuffle(false);
});

test('getStations day-one sanity for the engine (§C-SYS1.2)', () => {
  const byId = new Map(getStations().map((s) => [s.id, s]));
  assert.ok(byId.has(DEFAULT_STATION));
  assert.ok(byId.get(DEFAULT_STATION).count >= 13);
});
