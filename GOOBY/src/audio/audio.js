// Audio manager (§D6, agent G14) — the real WebAudio implementation behind the
// stub API every agent wired against:
//   init()              — builds the AudioContext on the FIRST USER GESTURE
//                         (main.js pointerdown once-listener; iOS requirement)
//   play(id, opts)      — one-shot sfx by semantic id: sfxMap lookup → Kenney
//                         ogg (WebAudio buffer pool, random-from-set, per-id
//                         volume, ±3% humanized rate), synth recipe, or Gooby
//                         voice recipe. Loop ids (gooby.snore, and V2/G26's
//                         ambience.rain/ambience.birdsong synth loops) run
//                         until stop().
//   music(id|null)      — procedural sequencers: 'home' lo-fi pentatonic pluck
//                         loop (~72 BPM, quiet) and 'dance' 100 BPM upbeat
//                         track honoring the DANCE constants contract (§D6:
//                         same BPM + PATTERN_SEED as danceParty's chart).
//   getMusicTime()      — F6: seconds since the current track started
//                         (WebAudio clock; null when stopped/pre-init/
//                         suspended) — danceParty's phase-lock time base.
//   setVolume(kind, v)  — 'sfx'|'music' runtime buses; also accepts an object
//                         ({sfx, music}). Mute PERSISTENCE lives in the save
//                         (settings.sfx/music/haptics) — this module follows
//                         the store live and applies toggles to the buses.
//   stop(id)            — stop a looping sfx (snore).
//   impact(style)       — haptics: guarded @capacitor/haptics dynamic import
//                         (same globalThis.Capacitor pattern as
//                         core/notifications.js) + navigator.vibrate fallback;
//                         sfxMap defs carry a `haptic` field so catches/bonks/
//                         buttons buzz automatically alongside their sound.
//
// Calls made before init() are safe no-ops (music remembers the requested
// track and starts it after the unlock). Everything routes master ← sfx/music
// buses; the Gooby voice shares the sfx bus (muting SFX mutes the voice too).

import { getAudioUrl } from '../core/assets.js';
import { getStore } from '../core/store.js';
import { DANCE } from '../data/constants.js';
import { getSfxDef } from './sfxMap.js';
import { VOICE_RECIPES } from './goobyVoice.js';

const DEV = !!import.meta.env?.DEV;

/** @type {AudioContext|null} */
let ctx = null;
/** @type {GainNode|null} master bus */
let masterGain = null;
/** @type {{sfx: GainNode, music: GainNode}|null} */
let bus = null;

/** Runtime volume multipliers (setVolume) — combined with the enabled flags. */
const volumes = { sfx: 1, music: 1 };
/** Persisted toggles, mirrored live from save settings (§E3). */
const enabled = { sfx: true, music: true, haptics: true };

/** Diagnostics: node/play counters (§G G14 DoD: verify the graph headlessly). */
const stats = { nodesCreated: 0, plays: 0, errors: 0 };

/** @type {Map<string, Promise<AudioBuffer|null>>} ogg buffer pool by asset key */
const buffers = new Map();
/** @type {Map<string, {stop: () => void}>} live loop handles by sfx id */
const loops = new Map();
/** F3: loop ids requested while the ctx/sfx bus was unavailable (pre-gesture
 * boot mid-sleep, or muted) — resumed on init()/unmute so e.g. the snore
 * survives a reload during a nap (§D6). */
const pendingLoops = new Set();
/** F3: true once the user really interacted (init() runs on the first
 * pointerdown) — navigator.vibrate before that logs console errors on web. */
let hasGesture = false;

// ---------------------------------------------------------------------------
// Init + settings
// ---------------------------------------------------------------------------

/** Apply the (possibly changed) save settings to the buses. */
function applySettings(settings) {
  if (settings) {
    enabled.sfx = settings.sfx !== false;
    enabled.music = settings.music !== false;
    enabled.haptics = settings.haptics !== false;
  }
  applyGains();
  // F3: park running loops while sfx is off; bring them back on re-enable
  // (e.g. mute during a nap must not permanently silence the snore).
  if (!enabled.sfx) {
    for (const id of loops.keys()) pendingLoops.add(id);
    stopAllLoops();
  } else {
    resumePendingLoops();
  }
}

/** F3: (re)start loops that were requested while blocked (no ctx / sfx off). */
function resumePendingLoops() {
  if (!ctx || !enabled.sfx) return;
  for (const id of [...pendingLoops]) {
    pendingLoops.delete(id);
    play(id);
  }
}

function applyGains() {
  if (!bus) return;
  const t = ctx.currentTime;
  bus.sfx.gain.setTargetAtTime(enabled.sfx ? volumes.sfx : 0, t, 0.02);
  bus.music.gain.setTargetAtTime(enabled.music ? volumes.music * MUSIC_LEVEL : 0, t, 0.05);
}

/** Init on first user gesture (iOS unlock requirement §D6). Idempotent. */
export function init() {
  hasGesture = true; // F3: init() is wired to the first pointerdown (main.js)
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) {
    console.warn('[audio] WebAudio unavailable — staying silent');
    return;
  }
  ctx = new AC();
  // Node-count instrumentation (cheap; feeds the DoD headless verification).
  for (const m of [
    'createOscillator', 'createGain', 'createBufferSource', 'createBiquadFilter',
    'createBuffer', 'createDynamicsCompressor', 'createStereoPanner',
  ]) {
    const orig = ctx[m].bind(ctx);
    ctx[m] = (...args) => {
      stats.nodesCreated += 1;
      return orig(...args);
    };
  }

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor(); // gentle safety limiter
  limiter.threshold.value = -12;
  limiter.ratio.value = 6;
  masterGain.connect(limiter).connect(ctx.destination);
  bus = { sfx: ctx.createGain(), music: ctx.createGain() };
  bus.sfx.connect(masterGain);
  bus.music.connect(masterGain);

  // Mute persistence (§D6): follow save settings now + live (§E2 store events).
  try {
    const store = getStore();
    applySettings(store.get('settings'));
    store.on('change', (state) => applySettings(state?.settings));
  } catch {
    applySettings(null); // headless/no-store contexts: defaults on
  }

  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  // F3: keep the context alive across tab hides + iOS suspensions — resume
  // on visibility return and on any later gesture if it got suspended.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && ctx?.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', () => {
      hasGesture = true;
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    });
  }
  // Prewarm the tap set so the very first button click is snappy.
  for (const k of ['interface-sounds/click_001', 'interface-sounds/click_002']) loadBuffer(k);
  if (pendingTrack !== undefined) {
    const track = pendingTrack;
    pendingTrack = undefined;
    startMusic(track);
  }
  resumePendingLoops(); // F3: e.g. snore requested at boot while asleep (§D6)
  console.info(`[audio] WebAudio init — state=${ctx.state}, sampleRate=${ctx.sampleRate}, buses=sfx/music`);
}

// ---------------------------------------------------------------------------
// Sample pool
// ---------------------------------------------------------------------------

/**
 * Fetch + decode a Kenney ogg into the pool (promise-cached; null on failure).
 * @param {string} key '<pack>/<file-no-ext>' — resolved via assets.getAudioUrl
 * @returns {Promise<AudioBuffer|null>}
 */
function loadBuffer(key) {
  if (buffers.has(key)) return buffers.get(key);
  const p = (async () => {
    try {
      const url = getAudioUrl(key);
      if (!url) return null;
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      return await ctx.decodeAudioData(data);
    } catch (err) {
      stats.errors += 1;
      console.warn(`[audio] failed to load '${key}':`, err?.message);
      return null;
    }
  })();
  buffers.set(key, p);
  return p;
}

/** @param {import('./sfxMap.js').SampleDef} def @param {number} vol */
async function playSample(def, vol) {
  const key = def.keys[Math.floor(Math.random() * def.keys.length)];
  const buffer = await loadBuffer(key);
  if (!buffer || !ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 0.97 + Math.random() * 0.06; // subtle humanize
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(bus.sfx);
  src.start();
  src.onended = () => {
    try {
      g.disconnect();
    } catch { /* already gone */ }
  };
}

// ---------------------------------------------------------------------------
// Synth recipes (juice blips — kept tiny; heavier sounds come from Kenney oggs)
// ---------------------------------------------------------------------------

/** One enveloped oscillator: freq f0→f1 over dur, exp gain in/out. */
function tone(dest, { type = 'sine', f0 = 440, f1 = f0, dur = 0.15, vol = 0.5, at = 0, attack = 0.01 }) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, f0), t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return osc;
}

/** Shared 1 s noise buffer (separate from the voice's — different module). */
let noiseBuf = null;
function noise(dest, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, dur = 0.2, vol = 0.4, at = 0 }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** @type {Record<string, (dest: AudioNode, vol: number) => void>} */
const SYNTH_RECIPES = {
  coin(dest, vol) {
    tone(dest, { type: 'square', f0: 987, dur: 0.07, vol: vol * 0.5 });
    tone(dest, { type: 'square', f0: 1318, dur: 0.18, vol: vol * 0.5, at: 0.07 });
  },
  winArp(dest, vol) {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone(dest, { type: 'triangle', f0: f, dur: 0.16, vol: vol * 0.55, at: i * 0.09 }));
  },
  pop(dest, vol) {
    tone(dest, { f0: 900, f1: 420, dur: 0.09, vol: vol * 0.7 });
    noise(dest, { type: 'highpass', f0: 2400, dur: 0.03, vol: vol * 0.25 });
  },
  bubblePop(dest, vol) {
    tone(dest, { f0: 460, f1: 980, dur: 0.08, vol: vol * 0.65 });
    noise(dest, { type: 'highpass', f0: 3200, dur: 0.03, vol: vol * 0.2 });
  },
  blipHigh(dest, vol) {
    tone(dest, { f0: 1250, f1: 1500, dur: 0.07, vol: vol * 0.6 });
  },
  blipMid(dest, vol) {
    tone(dest, { f0: 750, f1: 860, dur: 0.07, vol: vol * 0.6 });
  },
  softTick(dest, vol) {
    tone(dest, { f0: 620, dur: 0.045, vol: vol * 0.4 });
  },
  sadBlip(dest, vol) {
    tone(dest, { type: 'triangle', f0: 520, f1: 300, dur: 0.18, vol: vol * 0.6 });
  },
  sad(dest, vol) {
    tone(dest, { type: 'triangle', f0: 392, f1: 330, dur: 0.25, vol: vol * 0.55 });
    tone(dest, { type: 'triangle', f0: 330, f1: 262, dur: 0.4, vol: vol * 0.55, at: 0.26 });
  },
  jump(dest, vol) {
    tone(dest, { type: 'square', f0: 220, f1: 640, dur: 0.16, vol: vol * 0.35 });
  },
  whoosh(dest, vol) {
    noise(dest, { f0: 500, f1: 2600, q: 1.6, dur: 0.24, vol: vol * 0.6 });
  },
  whooshDown(dest, vol) {
    noise(dest, { f0: 2400, f1: 420, q: 1.6, dur: 0.26, vol: vol * 0.6 });
  },
  slice(dest, vol) {
    noise(dest, { type: 'highpass', f0: 1800, dur: 0.08, vol: vol * 0.7 });
  },
  sparkle(dest, vol) {
    [1568, 2093, 2637].forEach((f, i) =>
      tone(dest, { f0: f, dur: 0.12, vol: vol * 0.35, at: i * 0.05 }));
  },
  riser(dest, vol) {
    tone(dest, { type: 'sawtooth', f0: 180, f1: 720, dur: 0.55, vol: vol * 0.25, attack: 0.2 });
    noise(dest, { f0: 600, f1: 3200, q: 1.2, dur: 0.55, vol: vol * 0.3 });
  },
  plop(dest, vol) {
    tone(dest, { f0: 320, f1: 90, dur: 0.16, vol: vol * 0.7 });
  },
  boing(dest, vol) {
    tone(dest, { type: 'triangle', f0: 160, f1: 340, dur: 0.22, vol: vol * 0.6 });
  },
  boingBig(dest, vol) {
    tone(dest, { type: 'triangle', f0: 110, f1: 300, dur: 0.34, vol: vol * 0.7 });
    tone(dest, { type: 'sine', f0: 70, f1: 130, dur: 0.3, vol: vol * 0.4 });
  },
  splash(dest, vol) {
    noise(dest, { type: 'lowpass', f0: 2600, f1: 500, q: 0.8, dur: 0.4, vol: vol * 0.7 });
    [900, 1300].forEach((f, i) => tone(dest, { f0: f, f1: f * 1.4, dur: 0.08, vol: vol * 0.2, at: 0.12 + i * 0.08 }));
  },
  flush(dest, vol) {
    noise(dest, { f0: 1500, f1: 250, q: 2.2, dur: 1.1, vol: vol * 0.6 });
    noise(dest, { type: 'lowpass', f0: 700, f1: 180, dur: 1.2, vol: vol * 0.35 });
  },
};

// ---------------------------------------------------------------------------
// V2/G26: ambience LOOP recipes (§C10.2 dawn birdsong / §C11.2 rain loop).
// sfxMap synth defs with loop:true resolve here instead of SYNTH_RECIPES —
// each factory returns a {stop} handle that play() parks in the shared
// `loops` map, so audio.stop(id), the sfx mute toggle and the pendingLoops
// resume machinery all work exactly like the snore loop.
// ---------------------------------------------------------------------------

/** §C11.2: −18 dB target level of the rain loop, in linear gain (≈ 0.126). */
const RAIN_LOOP_GAIN = 10 ** (-18 / 20);

/** @type {AudioBuffer|null} 2 s brown-noise loop (integrated white noise). */
let brownBuf = null;
function brownNoiseBuffer() {
  if (brownBuf) return brownBuf;
  const len = ctx.sampleRate * 2;
  brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = brownBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i += 1) {
    // leaky integrator over white noise ⇒ ~1/f² "brown" spectrum
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return brownBuf;
}

/** @type {Record<string, (dest: AudioNode, vol: number) => {stop: () => void}>} */
const LOOP_RECIPES = {
  /** Rain-on-leaves (§C11.2): brown noise → LP 800 Hz, −18 dB, ~1 s fades. */
  rainLoop(dest, vol) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = brownNoiseBuffer();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, RAIN_LOOP_GAIN * vol), t + 1);
    src.connect(lp).connect(g).connect(dest);
    src.start(t);
    return {
      stop() {
        const at = ctx.currentTime;
        g.gain.setTargetAtTime(0.0001, at, 0.25);
        src.stop(at + 1.2);
      },
    };
  },

  /** Dawn birdsong (§C10.2): sparse seeded chirp bursts on a timer. */
  birdsong(dest, vol) {
    const g = ctx.createGain();
    g.gain.value = vol;
    g.connect(dest);
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    const burst = () => {
      // one bird: 2–4 rising chirps around a random base pitch
      const f0 = 2100 + Math.random() * 1700;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i += 1) {
        tone(g, {
          type: 'sine', f0, f1: f0 * (1.12 + Math.random() * 0.22),
          dur: 0.08 + Math.random() * 0.04, vol: 0.14 + Math.random() * 0.08,
          at: i * 0.13, attack: 0.015,
        });
      }
      timer = setTimeout(burst, 900 + Math.random() * 2600);
    };
    timer = setTimeout(burst, 250);
    return {
      stop() {
        if (timer != null) clearTimeout(timer);
        timer = null;
        try {
          g.disconnect();
        } catch { /* already gone */ }
      },
    };
  },
};

// ------------------------------------------------------------ end V2/G26 ----

// ---------------------------------------------------------------------------
// play / stop
// ---------------------------------------------------------------------------

/**
 * Play a one-shot sfx by semantic id (§D6). Unknown ids warn in dev builds
 * (the coverage test in test/onboarding.test.js keeps the map complete).
 * @param {string} id
 * @param {{volume?: number}} [opts]
 */
export function play(id, opts = {}) {
  const def = getSfxDef(id);
  if (!def) {
    if (DEV) console.warn(`[audio] UNMAPPED sfx id '${id}' — add it to sfxMap.js`);
    return;
  }
  if (def.haptic) impact(def.haptic);
  if (!ctx || !enabled.sfx) {
    // F3: remember loop requests (snore) so they start once unblocked —
    // covers "reload mid-sleep, first tap arrives later" and mute cycles.
    if (def.loop) pendingLoops.add(id);
    return;
  }
  pendingLoops.delete(id);
  stats.plays += 1;
  const vol = (def.volume ?? 1) * (opts.volume ?? 1);
  try {
    if (def.kind === 'sample') {
      playSample(def, vol);
    } else if (def.kind === 'synth' && def.loop) {
      // V2/G26: looping synth (ambience.rain / ambience.birdsong) — same
      // handle plumbing as the voice snore loop below.
      if (loops.has(id)) return; // already running
      const make = LOOP_RECIPES[def.name];
      if (make) {
        const handle = make(bus.sfx, vol);
        if (handle?.stop) loops.set(id, handle);
      } else if (DEV) console.warn(`[audio] unknown loop recipe '${def.name}'`);
    } else if (def.kind === 'synth') {
      const recipe = SYNTH_RECIPES[def.name];
      if (recipe) recipe(bus.sfx, vol);
      else if (DEV) console.warn(`[audio] unknown synth recipe '${def.name}'`);
    } else if (def.kind === 'voice') {
      const recipe = VOICE_RECIPES[def.name];
      if (!recipe) {
        if (DEV) console.warn(`[audio] unknown voice recipe '${def.name}'`);
        return;
      }
      if (def.loop) {
        if (loops.has(id)) return; // already snoring
        const handle = recipe(ctx, bus.sfx, { volume: vol });
        if (handle?.stop) loops.set(id, handle);
      } else {
        recipe(ctx, bus.sfx, { volume: vol });
      }
    }
    if (DEV) console.debug(`[audio] play ${id} (${def.kind}) — nodes=${stats.nodesCreated} plays=${stats.plays}`);
  } catch (err) {
    stats.errors += 1;
    console.warn(`[audio] play('${id}') failed:`, err);
  }
}

/**
 * Stop a looping sfx started by play() (e.g. 'gooby.snore').
 * @param {string} id
 */
export function stop(id) {
  pendingLoops.delete(id); // F3: also cancel not-yet-started loop requests
  const handle = loops.get(id);
  if (!handle) return;
  loops.delete(id);
  try {
    handle.stop();
  } catch { /* already stopped */ }
}

function stopAllLoops() {
  for (const id of [...loops.keys()]) stop(id);
}

// ---------------------------------------------------------------------------
// Music — procedural sequencers (§D6)
// ---------------------------------------------------------------------------

/** Base level of the music bus (§D6: home loop is QUIET under the sfx). */
const MUSIC_LEVEL = 0.55;
const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 60;

/** mulberry32 — same generator family as the framework/danceParty (§E8). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @type {{id: string, timer: ReturnType<typeof setInterval>, next: number, step: number, rng: () => number, pattern?: number[]}|null} */
let seq = null;
/** Track requested before init() — started right after the gesture unlock. */
let pendingTrack;

/** Home loop (§D6): pentatonic pluck sequencer ~72 BPM, lo-fi and quiet. */
const HOME = {
  bpm: 72,
  scale: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25], // C-major pentatonic
  bass: [65.41, 49.0], // C2 / G1
};

function schedHomeStep(step, t) {
  const eighth = 60 / HOME.bpm / 2;
  const r = seq.rng;
  if (step % 8 === 0) {
    // soft bass root every bar
    tone(bus.music, { type: 'sine', f0: HOME.bass[(step / 8) % 2], dur: eighth * 6, vol: 0.16, at: t - ctx.currentTime, attack: 0.05 });
  }
  if (r() < 0.52) {
    const f = HOME.scale[Math.floor(r() * HOME.scale.length)];
    // lo-fi pluck: triangle through its own decay envelope
    tone(bus.music, { type: 'triangle', f0: f, dur: eighth * (1.6 + r()), vol: 0.12 + r() * 0.05, at: t - ctx.currentTime });
  }
  return eighth;
}

/**
 * Dance track (§D6 contract): DANCE.BPM (100) and DANCE.PATTERN_SEED shared
 * with danceParty's chart generator, so tempo lines up with the falling notes.
 */
const DANCE_SCALE = [110.0, 130.81, 146.83, 164.81, 196.0]; // A minor-ish riff pool

function schedDanceStep(step, t) {
  const eighth = 60 / DANCE.BPM / 2;
  const at = t - ctx.currentTime;
  const beat = step % 2 === 0;
  if (beat) {
    // kick on every beat: sine drop 150→50
    tone(bus.music, { f0: 150, f1: 50, dur: 0.12, vol: 0.5, at });
  } else {
    // offbeat hat
    noise(bus.music, { type: 'highpass', f0: 6000, dur: 0.04, vol: 0.14, at });
  }
  if (step % 8 === 4) noise(bus.music, { f0: 1800, q: 1.4, dur: 0.09, vol: 0.22, at }); // backbeat snare
  // seeded 16-step bassline (regenerated once per track start)
  const f = seq.pattern[step % seq.pattern.length];
  if (f > 0) tone(bus.music, { type: 'sawtooth', f0: f, dur: eighth * 0.85, vol: 0.14, at });
  if (step % 16 === 0) {
    // sparkly stab at the top of every 2 bars
    [523.25, 659.25, 783.99].forEach((cf, i) =>
      tone(bus.music, { type: 'triangle', f0: cf, dur: 0.3, vol: 0.08, at: at + i * 0.02 }));
  }
  return eighth;
}

function startMusic(id) {
  stopMusic();
  if (id == null) return;
  const sched = id === 'dance' ? schedDanceStep : schedHomeStep;
  if (id !== 'dance' && id !== 'home' && DEV) console.warn(`[audio] unknown music track '${id}' — playing 'home'`);
  const rng = mulberry32(id === 'dance' ? DANCE.PATTERN_SEED : 72_2026);
  // startAt (F6): WebAudio time of sequencer step 0 — getMusicTime()'s zero.
  const startAt = ctx.currentTime + 0.08;
  seq = { id, timer: null, next: startAt, startAt, step: 0, rng };
  if (id === 'dance') {
    seq.pattern = Array.from({ length: 16 }, () =>
      rng() < 0.7 ? DANCE_SCALE[Math.floor(rng() * DANCE_SCALE.length)] : 0);
  }
  seq.timer = setInterval(() => {
    if (!ctx || !seq) return;
    while (seq.next < ctx.currentTime + LOOKAHEAD_SEC) {
      seq.next += sched(seq.step, seq.next);
      seq.step += 1;
    }
  }, TICK_MS);
  if (DEV) console.debug(`[audio] music '${id}' started (bpm=${id === 'dance' ? DANCE.BPM : HOME.bpm})`);
}

function stopMusic() {
  if (!seq) return;
  clearInterval(seq.timer);
  seq = null;
}

/**
 * Start/stop background music (§D6). Tracks: 'home', 'dance', null = stop.
 * Safe pre-init: the request is remembered and starts after the unlock.
 * @param {string|null} id
 */
export function music(id) {
  if (!ctx) {
    pendingTrack = id;
    return;
  }
  if (seq?.id === id) return;
  startMusic(id);
}

/**
 * F6 (RE5): read-only music time base — seconds since the current music
 * track started (WebAudio clock, ctx.currentTime − the track's step-0
 * reference). Returns null when no track is running or the context clock is
 * not advancing (pre-init / suspended — e.g. headless VMs without an audio
 * device), so callers (danceParty's song clock) can phase-lock when they can
 * and fall back to a wall clock when they can't.
 * @returns {number|null}
 */
export function getMusicTime() {
  if (!ctx || !seq || ctx.state !== 'running') return null;
  return ctx.currentTime - seq.startAt;
}

// ---------------------------------------------------------------------------
// setVolume + haptics
// ---------------------------------------------------------------------------

/**
 * Set a runtime bus level. Accepts ('sfx'|'music', v) or ({sfx, music}).
 * (Persistence is the caller's job via save settings — hud/settings do this.)
 * @param {'sfx'|'music'|{sfx?: number, music?: number}} kind
 * @param {number} [v] 0..1
 */
export function setVolume(kind, v) {
  if (kind && typeof kind === 'object') {
    if (typeof kind.sfx === 'number') volumes.sfx = kind.sfx;
    if (typeof kind.music === 'number') volumes.music = kind.music;
  } else if (kind === 'sfx' || kind === 'music') {
    volumes[kind] = v;
  }
  applyGains();
}

/** @type {Promise<object|null>|null} cached Haptics plugin lookup */
let hapticsPlugin = null;

/** Guarded plugin resolve — the SAME pattern as core/notifications.js (§E7). */
function nativeHaptics() {
  if (hapticsPlugin) return hapticsPlugin;
  hapticsPlugin = (async () => {
    const cap = globalThis.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    if (cap.Plugins?.Haptics) return cap.Plugins.Haptics;
    try {
      // Non-literal specifier so Vite/Rollup never hard-resolve the package
      // (G13 adds @capacitor/haptics concurrently — web builds must not break).
      const specifier = '@capacitor/haptics';
      const mod = await import(/* @vite-ignore */ specifier);
      return mod?.Haptics ?? null;
    } catch (err) {
      console.warn('[audio] haptics plugin unavailable:', err?.message);
      return null;
    }
  })();
  return hapticsPlugin;
}

/**
 * Light/medium haptic impact (§D6) — no-op when settings.haptics is off or
 * no native/web vibration path exists.
 * @param {'light'|'medium'|'heavy'} [style]
 */
export function impact(style = 'light') {
  if (!enabled.haptics) return;
  nativeHaptics().then((plugin) => {
    if (plugin) {
      plugin.impact({ style: style === 'heavy' ? 'HEAVY' : style === 'medium' ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
    } else if (hasGesture && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      // F3: web vibrate only AFTER the first user gesture — earlier calls
      // (boot-time low-stat ticks etc.) spam "Blocked call" console errors.
      navigator.vibrate(style === 'light' ? 8 : 16);
    }
  });
}

/** Diagnostics snapshot (dev/DoD verification). */
export function getStats() {
  return {
    ...stats,
    ctxState: ctx?.state ?? 'uninitialized',
    loops: loops.size,
    pendingLoops: pendingLoops.size, // F3
    track: seq?.id ?? null,
    // F3: live bus gains — headless proof that mute/unmute really lands
    gains: bus ? { sfx: bus.sfx.gain.value, music: bus.music.gain.value } : null,
  };
}

export default { init, play, music, getMusicTime, setVolume, stop, impact, getStats };
