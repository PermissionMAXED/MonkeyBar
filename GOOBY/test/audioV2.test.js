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

import { SFX_MAP, getSfxDef } from '../src/audio/sfxMap.js';
import { VOICE_RECIPES } from '../src/audio/goobyVoice.js';
import { CLIPS, V2_IDLE_CLIP_IDS } from '../src/character/goobyAnims.js';
import { IDLE_VARIETY, pickIdleVariant, idleVarietyDelaySec } from '../src/character/emotions.js';
// V2/FIX-B (E15): live-module imports for the music-toggle seam
import audio from '../src/audio/audio.js';
import { createStore } from '../src/core/store.js';
import { defaultState } from '../src/core/save.js';

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

test('2.0 feature ids map to their bespoke recipes (§E G29 consolidation)', () => {
  /** id → [kind, recipe name] */
  const expected = {
    'health.sneeze': ['voice', 'sneeze'],
    'vet.doorbell': ['synth', 'doorbell'],
    'vet.cure': ['synth', 'vetSparkle'],
    'vet.checkup': ['synth', 'checkupChime'],
    'landmark.found': ['synth', 'discovery'],
    'garden.plant': ['synth', 'seedPlant'],
    'garden.water': ['synth', 'trickle'],
    'garden.fertilize': ['synth', 'fertilizerPuff'],
    'garden.harvest': ['synth', 'harvestJoy'],
    'garden.harvestReady': ['synth', 'readyChime'],
    'garden.sell': ['synth', 'chaChing'],
    'quest.claim': ['synth', 'questJingle'],
    'sticker.get': ['synth', 'stickerPop'],
    'album.claim': ['synth', 'setFanfare'],
    'photo.shutter': ['synth', 'shutter'],
    'hop.bell': ['synth', 'bellJingle'],
    'golf.putt': ['synth', 'golfPutt'],
    'golf.sink': ['synth', 'golfSink'],
    'chop.slice': ['synth', 'chop'],
    'chop.junk': ['synth', 'splat'],
    'goalie.dive': ['synth', 'diveWhoosh'],
    'goalie.cheer': ['synth', 'bunnyCheer'],
    'delivery.drop': ['synth', 'confettiPop'],
    'delivery.doorbell': ['synth', 'doorbell'],
    'hopper.star': ['synth', 'starPing'],
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
  setTargetAtTime() {
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
    assert.equal(audio.getStats().track, 'home');
    assert.equal(typeof audio.getMusicTime(), 'number', 'time base live while playing');
    const on0 = audio.getStats().nodesCreated;
    fake.currentTime += 3; // sequencer look-ahead chases the clock
    await sleep(200); // several TICK_MS(60) interval fires
    assert.ok(audio.getStats().nodesCreated > on0, 'sequencer schedules while ON');

    // toggle OFF through the save settings — the production path
    // (hud toggle → store 'change' → applySettings)
    e15Store.set('settings.music', false);
    await sleep(100); // store event flush (setTimeout in node) + margin
    assert.equal(audio.getStats().track, null, 'sequencer torn down');
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
    assert.equal(audio.getStats().track, 'home', 'track resumes on re-enable');
    const resumed = audio.getStats().nodesCreated;
    fake.currentTime += 3;
    await sleep(200);
    assert.ok(audio.getStats().nodesCreated > resumed, 'sequencer schedules again');
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
