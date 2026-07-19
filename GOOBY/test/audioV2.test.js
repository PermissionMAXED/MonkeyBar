// V2/G29 — audio & reactions 2.0 coverage (§E wave 4):
//   • every synth def in sfxMap resolves to a recipe implemented in audio.js
//     (SYNTH_RECIPES for one-shots, LOOP_RECIPES for loop:true ids) — audio.js
//     is scanned as SOURCE TEXT because the module itself pulls browser-bound
//     imports; sfxMap/goobyVoice/emotions/goobyAnims are pure and imported.
//   • the goobySays pad family is ONE pitched recipe at 4 rising pentatonic
//     pitches (the §E pad-pitch upgrade over G24's 4-ogg placeholder).
//   • the 2.0 bespoke remaps landed (garden/health/vet/progression/photo/
//     bell/new-game ids) and the new voice recipes exist.
//   • the idle-variety rotation (emotions.js) is well-formed: clips exist in
//     goobyAnims, voice ids are mapped, the picker is deterministic, and the
//     shiver only ever enters the rotation in the rain.
//   • V2/FIX-B (E15): the music toggle is AIRTIGHT — audio.js is also
//     imported live (its browser touchpoints are all guarded no-ops in node)
//     against a minimal fake AudioContext, proving the sequencer creates
//     ZERO nodes while settings.music is off and resumes on re-enable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SFX_MAP, getSfxDef, busFor } from '../src/audio/sfxMap.js';
import { VOICE_RECIPES } from '../src/audio/goobyVoice.js';
import { CLIPS, V2_IDLE_CLIP_IDS } from '../src/character/goobyAnims.js';
import { IDLE_VARIETY, pickIdleVariant, idleVarietyDelaySec } from '../src/character/emotions.js';
// V2/FIX-B (E15): live-module imports for the music-toggle seam
// V3/G32: + the §B2.2 slider math + §B2.3 cache constants
import audio, {
  volumeGain, sanitizeVolumes, DEFAULT_VOLUMES, SAMPLE_CACHE_BUDGET,
  PRELOAD_BATCH_MAX, // V3/FIX-B (E5 P2)
} from '../src/audio/audio.js';
import { createStore } from '../src/core/store.js';
import { defaultState } from '../src/core/save.js';
// V3/G32 (§B2.4): the medley director's pure schedule math + tables
import {
  MEDLEY, MEDLEY_CONTEXTS, phraseBars,
  BAR_SEC, PHRASE_BARS, XFADE_SEC, CONTEXT_FADE_SEC, BED_LEVEL, NO_REPEAT_BARS,
} from '../src/audio/musicDirector.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------- recipe registry coverage

/** Recipe names defined in an audio.js source section (— `name(dest, vol…`). */
function recipeNames(section) {
  return new Set([...section.matchAll(/^ {2}(\w+)\(dest, vol/gm)].map((m) => m[1]));
}

const audioSrc = fs.readFileSync(path.join(ROOT, 'src', 'audio', 'audio.js'), 'utf8');
const synthNames = recipeNames(
  audioSrc.slice(audioSrc.indexOf('const SYNTH_RECIPES'), audioSrc.indexOf('const LOOP_RECIPES'))
);
const loopNames = recipeNames(
  audioSrc.slice(audioSrc.indexOf('const LOOP_RECIPES'), audioSrc.indexOf('// play / stop'))
);

test('every sfxMap synth def resolves to an implemented recipe (§D6/§E)', () => {
  assert.ok(synthNames.size >= 20, `expected a rich synth set, found ${synthNames.size}`);
  const missing = [];
  for (const [id, def] of Object.entries(SFX_MAP)) {
    if (def.kind !== 'synth') continue;
    const pool = def.loop ? loopNames : synthNames;
    if (!pool.has(def.name)) missing.push(`${id} → ${def.name}${def.loop ? ' (loop)' : ''}`);
  }
  assert.deepEqual(missing, [], `unimplemented synth recipes: ${missing.join(', ')}`);
});

test('sfxMap synth pitch fields are sane multipliers', () => {
  for (const [id, def] of Object.entries(SFX_MAP)) {
    if (def.kind === 'synth' && def.pitch != null) {
      assert.ok(def.pitch > 0.25 && def.pitch <= 4, `${id}: pitch ${def.pitch} out of range`);
    }
  }
});

// -------------------------------------------- goobySays pitched pad family

test('says.pad1–4: one pitched recipe, 4 rising pentatonic pitches (§C1.2 #1)', () => {
  const pads = ['says.pad1', 'says.pad2', 'says.pad3', 'says.pad4'].map(getSfxDef);
  const pitches = [];
  for (const def of pads) {
    assert.equal(def.kind, 'synth', 'pads are synth defs now (G24 ogg placeholder upgraded)');
    assert.equal(def.name, 'saysPad', 'all four pads share the saysPad recipe');
    pitches.push(def.pitch ?? 1);
  }
  // rising C-D-E-G major-pentatonic ratios over the recipe's C5 base
  assert.deepEqual(pitches, [1, 1.125, 1.25, 1.5]);
  for (let i = 1; i < pitches.length; i += 1) {
    assert.ok(pitches[i] > pitches[i - 1], 'pad pitches strictly rising');
  }
});

// ------------------------------------------------------- 2.0 bespoke remaps

test('2.0 feature ids map to their bespoke recipes (§E G29 consolidation, V3/G32 sweep)', () => {
  // V3/G32 (PLAN3 §C3.1): the ids kept on their bespoke recipes — the §C3.1
  // whitelist (voice, ambience loops, water/soil juice, whoosh/sparkle family).
  /** id → [kind, recipe name] */
  const expected = {
    'health.sneeze': ['voice', 'sneeze'],
    'vet.cure': ['synth', 'vetSparkle'],
    'garden.plant': ['synth', 'seedPlant'],
    'garden.water': ['synth', 'trickle'],
    'garden.fertilize': ['synth', 'fertilizerPuff'],
    'garden.harvest': ['synth', 'harvestJoy'],
    'sticker.get': ['synth', 'stickerPop'],
    'album.claim': ['synth', 'setFanfare'],
    'photo.shutter': ['synth', 'shutter'],
    'hop.bell': ['synth', 'bellJingle'],
    'golf.sink': ['synth', 'golfSink'],
    'chop.slice': ['synth', 'chop'],
    'chop.junk': ['synth', 'splat'],
    'goalie.dive': ['synth', 'diveWhoosh'],
    'goalie.cheer': ['synth', 'bunnyCheer'],
    'delivery.drop': ['synth', 'confettiPop'],
    'hopper.gold': ['synth', 'goldenPing'],
    'pipe.connect': ['synth', 'pipeConnect'],
    'pipe.fill': ['synth', 'trickle'],
  };
  for (const [id, [kind, name]] of Object.entries(expected)) {
    const def = getSfxDef(id);
    assert.ok(def, `'${id}' must be mapped`);
    assert.equal(def.kind, kind, `'${id}' kind`);
    assert.equal(def.name, name, `'${id}' recipe`);
  }
  // V3/G32 (§C3.1 sweep): these v2 bespoke-synth ids flipped to REAL files.
  /** id → a key fragment every mapped sample key must contain */
  const flipped = {
    'vet.doorbell': 'impactBell_heavy',
    'vet.checkup': 'question_',
    'landmark.found': 'jingles_HIT01',
    'garden.harvestReady': 'glass_',
    'garden.sell': 'chips-stack',
    'quest.claim': 'jingles_HIT02',
    'golf.putt': 'footstep_wood',
    'delivery.doorbell': 'impactBell_heavy',
    'hopper.star': 'impactPlate_light',
  };
  for (const [id, frag] of Object.entries(flipped)) {
    const def = getSfxDef(id);
    assert.ok(def, `'${id}' must be mapped`);
    assert.equal(def.kind, 'sample', `'${id}' flips to a sample (§C3.1)`);
    assert.ok(def.keys.every((k) => k.includes(frag)), `'${id}' keys carry '${frag}'`);
  }
});

test('2.0 voice recipes exist and their gooby.* ids are mapped (±10% rule set)', () => {
  for (const name of ['sneeze', 'sniffle', 'hiccup', 'contentSigh', 'brrr', 'delightedGasp']) {
    assert.equal(typeof VOICE_RECIPES[name], 'function', `VOICE_RECIPES.${name}`);
  }
  const voiceIds = {
    'gooby.sniffle': 'sniffle',
    'gooby.hiccup': 'hiccup',
    'gooby.sigh': 'contentSigh',
    'gooby.brrr': 'brrr',
    'gooby.gasp': 'delightedGasp',
  };
  for (const [id, name] of Object.entries(voiceIds)) {
    const def = getSfxDef(id);
    assert.ok(def && def.kind === 'voice' && def.name === name, `${id} → voice '${name}'`);
  }
});

test('ambience loop id contracts intact (G26 handoff: polish, not break)', () => {
  const rain = getSfxDef('ambience.rain');
  assert.ok(rain && rain.kind === 'synth' && rain.loop === true && rain.name === 'rainLoop');
  const birds = getSfxDef('ambience.birdsong');
  assert.ok(birds && birds.kind === 'synth' && birds.loop === true && birds.name === 'birdsong');
  assert.ok(loopNames.has('rainLoop') && loopNames.has('birdsong'), 'loop recipes implemented');
});

// ----------------------------------------------------- idle-variety rotation

/** tiny deterministic LCG for the picker tests */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('IDLE_VARIETY: clips exist as one-shots, voice ids are mapped', () => {
  assert.ok(IDLE_VARIETY.length >= 5, 'rich rotation');
  const clipIds = IDLE_VARIETY.map((v) => v.clip);
  assert.deepEqual([...clipIds].sort(), [...V2_IDLE_CLIP_IDS].sort());
  for (const v of IDLE_VARIETY) {
    const def = CLIPS[v.clip];
    assert.ok(def, `clip '${v.clip}' exists`);
    assert.equal(def.loop, false, `'${v.clip}' is a one-shot`);
    if (v.voice != null) assert.ok(getSfxDef(v.voice), `voice id '${v.voice}' mapped in sfxMap`);
    assert.ok(v.voiceChance >= 0 && v.voiceChance <= 1, `${v.clip}.voiceChance`);
    assert.ok(v.weight >= 0, `${v.clip}.weight`);
  }
});

test('pickIdleVariant: deterministic, and shiver is rain-only', () => {
  // determinism: same seed ⇒ same picks
  const a = lcg(42);
  const b = lcg(42);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(pickIdleVariant(a, { rain: i % 2 === 0 }).clip, pickIdleVariant(b, { rain: i % 2 === 0 }).clip);
  }
  // dry Gooby NEVER shivers (weight 0 outside rain)…
  const dry = lcg(7);
  const nightDry = lcg(8);
  for (let i = 0; i < 500; i += 1) {
    assert.notEqual(pickIdleVariant(dry).clip, 'shiver', 'no shiver by day');
    assert.notEqual(pickIdleVariant(nightDry, { night: true }).clip, 'shiver', 'no shiver at night');
  }
  // …but rain-watching Gooby does, and every rotation member shows up
  const wet = lcg(9);
  const seen = new Set();
  for (let i = 0; i < 800; i += 1) seen.add(pickIdleVariant(wet, { rain: true }).clip);
  assert.ok(seen.has('shiver'), 'shiver joins the rotation in the rain');
  for (const v of IDLE_VARIETY) {
    if ((v.rainWeight ?? v.weight) > 0) assert.ok(seen.has(v.clip), `${v.clip} reachable in rain`);
  }
});

test('idleVarietyDelaySec: 11–21 s by day, drowsier 16–30 s at night (§C10.3)', () => {
  assert.equal(idleVarietyDelaySec(() => 0), 11);
  assert.equal(idleVarietyDelaySec(() => 1), 21);
  assert.equal(idleVarietyDelaySec(() => 0, { night: true }), 16);
  assert.equal(idleVarietyDelaySec(() => 1, { night: true }), 30);
  const r = lcg(3);
  for (let i = 0; i < 100; i += 1) {
    const day = idleVarietyDelaySec(r);
    const night = idleVarietyDelaySec(r, { night: true });
    assert.ok(day >= 11 && day <= 21, `day delay ${day}`);
    assert.ok(night >= 16 && night <= 30, `night delay ${night}`);
  }
});

// ===================== V2/FIX-B (E15): the music toggle is airtight ==========
// settings.music=false used to only zero the music bus gain while
// startMusic()'s sequencer interval kept creating ~2.7 WebAudio nodes/s into
// the muted bus forever. The fix tears the sequencer down while music is off
// and restarts the wanted track on re-enable. These tests drive the REAL
// module (singleton) against a minimal fake AudioContext installed before
// init(); node-creation is observed through the module's own instrumented
// getStats().nodesCreated counter — the same signal the E15 eval measured.

class FakeParam {
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  // V3/G32: record the target so the §B2.2 bus-gain assertions can read the
  // value applyGains() landed (the real node converges to it).
  setTargetAtTime(v) {
    this.value = v;
    return this;
  }
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(0);
    this.Q = new FakeParam(1);
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(0);
    this.ratio = new FakeParam(1);
    this.attack = new FakeParam(0);
    this.release = new FakeParam(0);
    this.playbackRate = new FakeParam(1);
    this.pan = new FakeParam(0);
    this.type = 'sine';
    this.buffer = null;
    this.loop = false;
    this.onended = null;
  }
  connect(next) {
    return next;
  }
  disconnect() {}
  start() {}
  stop() {}
}

class FakeAudioContext {
  constructor() {
    FakeAudioContext.last = this;
    this.currentTime = 0;
    this.state = 'running';
    this.sampleRate = 8000; // small → cheap noise-buffer fills
    this.destination = new FakeNode();
  }
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
  createStereoPanner() {
    return new FakeNode();
  }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
  decodeAudioData() {
    return Promise.reject(new Error('no decode headlessly'));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Shared across the sequential E15 tests (audio.js is a module singleton). */
let e15Store = null;

test('E15: settings.music=false creates ZERO music nodes; re-enable resumes', async () => {
  e15Store = createStore(defaultState(), { autosave: false });
  globalThis.AudioContext = FakeAudioContext;
  try {
    audio.init(); // follows the store settings live from here on
    const fake = FakeAudioContext.last;
    assert.equal(audio.getStats().ctxState, 'running');

    audio.music('home');
    // V3/G32: 'home' now delegates to the §B2.4 jingle-medley director
    assert.equal(audio.getStats().track, 'medley:home');
    assert.equal(typeof audio.getMusicTime(), 'number', 'time base live while playing');
    const on0 = audio.getStats().nodesCreated;
    fake.currentTime += 3; // scheduler look-ahead chases the clock
    await sleep(300); // several scheduler ticks (medley TICK_MS is 200)
    assert.ok(audio.getStats().nodesCreated > on0, 'medley schedules while ON (glue-bed nodes)');

    // toggle OFF through the save settings — the production path
    // (hud toggle → store 'change' → applySettings)
    e15Store.set('settings.music', false);
    await sleep(100); // store event flush (setTimeout in node) + margin
    assert.equal(audio.getStats().track, null, 'medley scheduler torn down (§C2.3 airtight)');
    assert.equal(audio.getMusicTime(), null, 'time base null (danceParty falls back to wall clock)');
    const muted = audio.getStats();
    for (let i = 0; i < 4; i += 1) {
      fake.currentTime += 4;
      await sleep(120);
    }
    assert.equal(
      audio.getStats().nodesCreated,
      muted.nodesCreated,
      'ZERO node creation while music is off (E15: was ~2.7 nodes/s into the muted bus)'
    );
    assert.equal(audio.getStats().errors, muted.errors, 'no errors while muted');

    // toggle back ON: the remembered track restarts cleanly (step 0, fresh
    // getMusicTime() base — the documented §D6 resume behavior)
    e15Store.set('settings.music', true);
    await sleep(100);
    assert.equal(audio.getStats().track, 'medley:home', 'track resumes on re-enable');
    const resumed = audio.getStats().nodesCreated;
    fake.currentTime += 3;
    await sleep(300);
    assert.ok(audio.getStats().nodesCreated > resumed, 'medley schedules again');
    const t = audio.getMusicTime();
    assert.ok(typeof t === 'number' && t >= 0, `fresh music time base (got ${t})`);
  } finally {
    delete globalThis.AudioContext;
    audio.music(null);
  }
});

test('E15: music(id) requested while OFF stays silent and starts on re-enable', async () => {
  const fake = FakeAudioContext.last;
  e15Store.set('settings.music', false);
  await sleep(100);
  audio.music('dance'); // e.g. danceParty launched with music muted
  assert.equal(audio.getStats().track, null, 'no sequencer while the toggle is off');
  const muted = audio.getStats().nodesCreated;
  fake.currentTime += 4;
  await sleep(150);
  assert.equal(audio.getStats().nodesCreated, muted, 'the request creates no nodes');
  e15Store.set('settings.music', true);
  await sleep(100);
  assert.equal(audio.getStats().track, 'dance', 'remembered request starts on re-enable');
  audio.music(null);
  assert.equal(audio.getStats().track, null);
});

// ===================== V3/G32 (PLAN3 §B2): audio engine 2.0 ==================
// The E15 block above doubles as the §E "mute-during-medley zero-node probe":
// music('home') IS the medley director now, and test 10 asserts zero node
// creation across 16 s of advanced clock while settings.music is off.

// ------------------------------------------ §B2.2 slider → gain mapping

test('§B2.2: volumeGain is the binding (v/100)² curve — volumeGain(80)===0.64', () => {
  assert.equal(volumeGain(80), 0.64);
  assert.equal(volumeGain(100), 1);
  assert.equal(volumeGain(70), 0.49);
  assert.equal(volumeGain(0), 0);
  assert.equal(volumeGain(50), 0.25);
  // clamps + garbage tolerance (defensive against hand-edited saves)
  assert.equal(volumeGain(120), 1);
  assert.equal(volumeGain(-10), 0);
  assert.equal(volumeGain(NaN), 0);
  assert.equal(volumeGain('80'), 0.64);
});

test('§C2.2: DEFAULT_VOLUMES are 80/100/70/100/80; sanitizeVolumes is defensive', () => {
  assert.deepEqual(DEFAULT_VOLUMES, { master: 80, sfx: 100, music: 70, voice: 100, ambience: 80 });
  // missing slice (pre-G34 saves) → defaults
  assert.deepEqual(sanitizeVolumes(undefined), { ...DEFAULT_VOLUMES });
  assert.deepEqual(sanitizeVolumes(null), { ...DEFAULT_VOLUMES });
  assert.deepEqual(sanitizeVolumes('nope'), { ...DEFAULT_VOLUMES });
  // partial slice merges over the defaults; out-of-range clamps to 0..100
  assert.deepEqual(
    sanitizeVolumes({ master: 40, music: 150, voice: -3, ambience: 'x' }),
    { master: 40, sfx: 100, music: 100, voice: 0, ambience: 80 }
  );
  assert.equal(sanitizeVolumes({ sfx: 62.4 }).sfx, 62, 'rounded to ints');
});

test('§B2.2: store volume writes land on the buses as (v/100)² (master ×0.9)', async () => {
  // Rides the E15 singleton (fake ctx installed + store-followed above).
  e15Store.set('settings.volumes', { master: 50, sfx: 80, music: 30, voice: 100, ambience: 0 });
  await sleep(100); // store 'change' flush
  const s = audio.getStats();
  assert.deepEqual(s.volumes, { master: 50, sfx: 80, music: 30, voice: 100, ambience: 0 });
  assert.equal(s.buses.master, 0.9 * 0.25, 'master keeps the ×0.9 base (§B2.2)');
  assert.equal(s.buses.sfx, 0.64);
  assert.equal(s.buses.music, 0.09);
  assert.equal(s.buses.voice, 1);
  assert.equal(s.buses.ambience, 0);
  // quick-mutes stay booleans: sfx-bool mutes sfx+voice (§C2.3)
  e15Store.set('settings.sfx', false);
  await sleep(100);
  const m = audio.getStats();
  assert.equal(m.buses.sfx, 0, 'sfx bus hard-zero while the boolean is off');
  assert.equal(m.buses.voice, 0, 'voice follows the sfx boolean (§C2.3)');
  assert.equal(m.buses.music, 0.09, 'music untouched by the sfx boolean');
  e15Store.set('settings.sfx', true);
  e15Store.set('settings.volumes', { ...DEFAULT_VOLUMES });
  await sleep(100);
});

// ------------------------------------------ §B2.1 routing kinds

test('§B2.1: busFor routes voice→voice, ambience loops→ambience, rest→sfx', () => {
  const routed = { sfx: 0, voice: 0, ambience: 0 };
  for (const [id, def] of Object.entries(SFX_MAP)) {
    const b = busFor(id, def);
    assert.ok(b === 'sfx' || b === 'voice' || b === 'ambience', `${id} → '${b}'`);
    routed[b] += 1;
    if (def.kind === 'voice') assert.equal(b, 'voice', `${id} is a voice def`);
  }
  assert.ok(routed.voice >= 10, 'voice family routed');
  assert.equal(routed.ambience, 2, 'exactly the two ambience loops');
  // the §B2.1 anchors
  assert.equal(busFor('ui.tap', getSfxDef('ui.tap')), 'sfx');
  assert.equal(busFor('gooby.snore', getSfxDef('gooby.snore')), 'voice');
  assert.equal(busFor('ambience.rain', getSfxDef('ambience.rain')), 'ambience');
  assert.equal(busFor('ambience.birdsong', getSfxDef('ambience.birdsong')), 'ambience');
  assert.equal(busFor('dance.tierUpAccent', getSfxDef('dance.tierUpAccent')), 'sfx', '§C3.4 accent rides the sfx bus');
});

// ------------------------------------------ §B2.3 decoded-buffer LRU cache

test('§B2.3: preloadSamples decodes into the cache; LRU evicts beyond 6 MB', async () => {
  const fake = FakeAudioContext.last;
  assert.ok(fake, 'E15 singleton fake ctx present');
  const MB = 1024 * 1024;
  // ~2.8 MB decoded per buffer (length × channels × 4 B)
  const fakeBuffer = () => ({ length: 700_000, numberOfChannels: 1, duration: 2 });
  const origDecode = fake.decodeAudioData;
  const origFetch = globalThis.fetch;
  fake.decodeAudioData = () => Promise.resolve(fakeBuffer());
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
  try {
    const before = audio.getStats().samples;
    assert.equal(before.budgetBytes, SAMPLE_CACHE_BUDGET);
    assert.equal(SAMPLE_CACHE_BUDGET, 6 * MB, '§B2.3 budget');
    // 4 × 2.8 MB = 11.2 MB decoded → the two oldest must be LRU-evicted
    await audio.preloadSamples([
      'music-jingles/jingles_SAX00',
      'music-jingles/jingles_SAX04',
      'music-jingles/jingles_SAX05',
      'music-jingles/jingles_SAX06',
    ]);
    const after = audio.getStats().samples;
    assert.ok(after.bytes <= SAMPLE_CACHE_BUDGET, `cache stays under budget (${after.bytes} B)`);
    assert.equal(after.bytes, 2 * 700_000 * 4, 'exactly two decoded buffers survive');
    // preloadSamples also resolves sfx IDS through the map (per-game sfx: [])
    await audio.preloadSamples(['ui.win']); // → music-jingles/jingles_HIT16
    assert.ok(audio.getStats().samples.bytes >= after.bytes, 'id-resolved key decoded into the cache');
  } finally {
    fake.decodeAudioData = origDecode;
    globalThis.fetch = origFetch;
  }
});

// ------------------------------------------ §B2.4 music() context delegation

test("§B2.4: music() accepts every medley context; unknown ids fall back to 'home'", async () => {
  for (const ctxId of MEDLEY_CONTEXTS) {
    audio.music(ctxId);
    assert.equal(audio.getStats().track, `medley:${ctxId}`, `music('${ctxId}')`);
  }
  audio.music('lofi-beats-to-feed-gooby-to'); // unknown → warned 'home' fallback
  assert.equal(audio.getStats().track, 'medley:home');
  audio.music(null);
  assert.equal(audio.getStats().track, null);
  assert.equal(audio.getStats().medley.context, null, 'director fully idle');
});

// ------------------------------------------ §B2.4 medley scheduler math

test('§B2.4: composition tables — 5 contexts, 16 bars, §C3.3 anchors', () => {
  assert.deepEqual(MEDLEY_CONTEXTS, ['home', 'garden', 'arcade', 'city', 'shop']);
  assert.equal(BAR_SEC, 3.2);
  assert.equal(PHRASE_BARS, 16);
  assert.equal(XFADE_SEC, 0.15);
  assert.equal(CONTEXT_FADE_SEC, 0.8);
  assert.ok(Math.abs(BED_LEVEL - 10 ** (-26 / 20)) < 1e-9, 'glue bed at −26 dBFS');
  const roots = { home: 65.41, garden: 98.0, arcade: 110.0, city: 87.31, shop: 73.42 };
  for (const [ctxId, root] of Object.entries(roots)) {
    assert.equal(MEDLEY[ctxId].root, root, `${ctxId} bed root`);
    assert.equal(MEDLEY[ctxId].bars.length, PHRASE_BARS, `${ctxId} is 16 bars`);
    assert.ok(MEDLEY[ctxId].bars.some((b) => b === null), `${ctxId} has rest bars`);
  }
  // §C3.3 spot anchors (first bars + the shop's PIZZI/STEEL interleave)
  assert.equal(MEDLEY.home.bars[0], 'music-jingles/jingles_PIZZI01');
  assert.equal(MEDLEY.garden.bars[0], 'music-jingles/jingles_STEEL00');
  assert.equal(MEDLEY.arcade.bars[0], 'music-jingles/jingles_NES00');
  assert.equal(MEDLEY.city.bars[0], 'music-jingles/jingles_SAX07');
  assert.deepEqual(MEDLEY.shop.bars.slice(0, 2), ['music-jingles/jingles_PIZZI00', 'music-jingles/jingles_STEEL09']);
});

test('§B2.4: phraseBars — deterministic per seed, rests fixed, no repeat within 8 bars', () => {
  for (const ctxId of MEDLEY_CONTEXTS) {
    // phrase 0 is the §C3.3 table verbatim
    assert.deepEqual(phraseBars(ctxId, 0), [...MEDLEY[ctxId].bars], `${ctxId} phrase 0`);
    let prev = null;
    for (let ph = 0; ph <= 12; ph += 1) {
      const bars = phraseBars(ctxId, ph);
      // determinism: same (context, phrase) → identical schedule
      assert.deepEqual(phraseBars(ctxId, ph), bars, `${ctxId} phrase ${ph} deterministic`);
      // rest positions NEVER move
      bars.forEach((key, i) => {
        assert.equal(key == null, MEDLEY[ctxId].bars[i] == null, `${ctxId} ph${ph} bar${i} rest fixed`);
      });
      // each phrase is a permutation of the table's jingles
      assert.deepEqual(
        bars.filter(Boolean).sort(),
        [...MEDLEY[ctxId].bars].filter(Boolean).sort(),
        `${ctxId} ph${ph} permutation`
      );
      // no jingle repeats within NO_REPEAT_BARS — incl. across the phrase seam
      const flat = prev ? [...prev, ...bars] : bars;
      const offset = prev ? PHRASE_BARS : 0;
      for (let i = offset; i < flat.length; i += 1) {
        const key = flat[i];
        if (!key) continue;
        for (let j = Math.max(0, i - NO_REPEAT_BARS + 1); j < i; j += 1) {
          assert.notEqual(flat[j], key, `${ctxId} ph${ph}: '${key}' repeats within ${NO_REPEAT_BARS} bars`);
        }
      }
      prev = bars;
    }
    // phrases actually differ from each other (the reshuffle does something)
    assert.notDeepEqual(phraseBars(ctxId, 1), phraseBars(ctxId, 0), `${ctxId} reshuffles`);
  }
});

// ===================== V3/FIX-B (E5 P1/P2): stall recovery + cache hygiene ===
// E5 P1: after a main-thread stall ≥ ~1.5 s the medley grid fell behind and
// scheduleBar() retro-scheduled the missed bars; Chrome clamps past-time param
// events to the same instant, so the stacked fade curves threw an uncaught
// NotSupportedError cascade and the stuck bar re-created nodes every tick.
// The fix fast-forwards nextBarAt past ctx.currentTime (missed bars are
// SKIPPED, counted in getStats().medley.barsSkipped) and derives the phrase
// from the bar counter so the reshuffle table survives seam-crossing skips.

/** Advance the fake clock in sub-lookahead steps (≤ ~0.5 s of clock per 200 ms
 * scheduler tick) so bars schedule on the normal look-ahead path — bigger
 * jumps would legitimately look like stalls to the recovery logic. */
async function creep(fake, steps, dt = 0.2) {
  for (let i = 0; i < steps; i += 1) {
    fake.currentTime += dt;
    await sleep(80);
  }
  await sleep(250); // let the 200 ms scheduler tick settle
}

test('V3/FIX-B (E5 P1): stall recovery skips missed bars — never retro-schedules', async () => {
  const fake = FakeAudioContext.last;
  assert.ok(fake, 'E15 singleton fake ctx present');
  audio.music('home');
  await creep(fake, 16); // ~3.2 s: bars 0+1 land on the normal look-ahead path
  const before = audio.getStats().medley;
  assert.equal(before.context, 'home');
  assert.ok(before.bar >= 2, `grid established (bar ${before.bar})`);
  // the stall: the audio clock jumps 60 s (crosses a 51.2 s phrase seam)
  fake.currentTime += 60;
  const jumpTo = fake.currentTime;
  await sleep(300); // fast-forward tick
  await creep(fake, 16); // then normal scheduling resumes
  const after = audio.getStats().medley;
  const skipped = after.barsSkipped - before.barsSkipped;
  const scheduled = after.barsScheduled - before.barsScheduled;
  assert.ok(skipped >= 15 && skipped <= 21, `missed bars were skipped, not scheduled (${skipped})`);
  assert.ok(scheduled >= 1 && scheduled <= 4, `only look-ahead bars scheduled after the stall (${scheduled})`);
  assert.equal(after.bar - before.bar, skipped + scheduled, 'bar counter = skipped + scheduled');
  assert.ok(after.nextBarAt >= jumpTo, `grid fast-forwarded past the stall (${after.nextBarAt} ≥ ${jumpTo})`);
  // ZERO retro-scheduling: every post-jump bar sits at/after the jump instant
  for (const entry of after.schedule.filter((s) => s.bar >= before.bar)) {
    assert.ok(entry.at >= jumpTo - 0.01, `bar ${entry.bar} scheduled at ${entry.at} ≥ ${jumpTo}`);
  }
  // the phrase is DERIVED from the bar counter across the skipped seam…
  const last = after.schedule[after.schedule.length - 1];
  assert.equal(after.phrase, Math.floor(last.bar / PHRASE_BARS), 'phrase derived from bar');
  assert.ok(after.phrase >= 1, 'the skip crossed the phrase seam');
  // …and the scheduled jingle matches the seeded reshuffle table for it
  const expected = phraseBars('home', Math.floor(last.bar / PHRASE_BARS))[last.bar % PHRASE_BARS];
  assert.equal(last.key, expected ? expected.split('/')[1] : 'R', 'reshuffle table in sync after the skip');
  assert.equal(typeof audio.getMusicTime(), 'number', 'time base still live');
  audio.music(null);
});

// E5 P2: a full-library preloadSamples() flood (251 keys) cycled the whole
// 6 MB LRU (223 evictions) and evicted every warm set. Fixes under test:
// the PRELOAD_BATCH_MAX cap and the live-medley pin (active context jingles
// are never LRU-evicted; getStats().samples.pinned counts the resident ones).

test('V3/FIX-B (E5 P2): live-medley jingles are pinned against LRU floods; batches are capped', async () => {
  const fake = FakeAudioContext.last;
  const origDecode = fake.decodeAudioData;
  const origFetch = globalThis.fetch;
  let decodedLen = 1000; // ~4 KB decoded per buffer
  fake.decodeAudioData = () => Promise.resolve({ length: decodedLen, numberOfChannels: 1, duration: 1 });
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
  try {
    // 1) a live medley warms + pins its 10 jingles
    audio.music('home');
    await sleep(250); // startPlayer's loadBuffer warm-up settles
    assert.equal(audio.getStats().samples.pinned, 10, 'all 10 home jingles resident + pinned');
    // 2) flood with big decodes → LRU evicts, but the pinned set survives
    decodedLen = 700_000; // ~2.8 MB decoded per buffer
    await audio.preloadSamples([
      'music-jingles/jingles_SAX00', 'music-jingles/jingles_SAX04',
      'music-jingles/jingles_SAX05', 'music-jingles/jingles_SAX06',
      'music-jingles/jingles_SAX08', 'music-jingles/jingles_SAX09',
    ]);
    const flooded = audio.getStats().samples;
    assert.equal(flooded.pinned, 10, 'pinned medley jingles survive the flood');
    assert.ok(
      flooded.bytes <= SAMPLE_CACHE_BUDGET + 10 * 1000 * 4,
      `unpinned entries evicted back to budget (${flooded.bytes} B)`
    );
    // 3) batch cap: a "preload the library" call is truncated at the cap
    decodedLen = 1000;
    const library = Array.from({ length: 60 }, (_, i) => `interface-sounds/flood_${String(i).padStart(3, '0')}`);
    const before = audio.getStats().samples.cached;
    await audio.preloadSamples(library);
    const added = audio.getStats().samples.cached - before;
    assert.ok(added <= PRELOAD_BATCH_MAX, `≤ ${PRELOAD_BATCH_MAX} keys loaded from a 60-key flood (${added})`);
    assert.ok(added >= PRELOAD_BATCH_MAX - 4, `the cap still warms a full batch (${added})`);
    assert.equal(audio.getStats().samples.pinned, 10, 'pins intact after the capped batch');
  } finally {
    fake.decodeAudioData = origDecode;
    globalThis.fetch = origFetch;
    audio.music(null);
  }
});
