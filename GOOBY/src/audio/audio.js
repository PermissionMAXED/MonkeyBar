// Audio manager (§D6 agent G14; V3/G32 Audio Engine 2.0 per PLAN3 §B2) — the
// real WebAudio implementation behind the stub API every agent wired against:
//   init()              — builds the AudioContext on the FIRST USER GESTURE
//                         (main.js pointerdown once-listener; iOS requirement)
//   play(id, opts)      — one-shot sfx by semantic id: sfxMap lookup → Kenney
//                         ogg (decoded-buffer LRU cache §B2.3, random-from-
//                         set, per-id volume/rate, ±3% humanized rate, per-id
//                         throttleMs), synth recipe, or Gooby voice recipe.
//                         Loop ids (gooby.snore, ambience.rain/birdsong) run
//                         until stop(). V2/G29: synth recipes are pitch-aware
//                         (def.pitch × opts.pitch frequency multiplier).
//   music(id|null)      — 'home' delegates to the §B2.4 jingle-medley
//                         director (musicDirector.js — real files, per-context
//                         via setContext); 'dance' stays the 100 BPM synth
//                         sequencer honoring the DANCE constants contract
//                         (§C3.4 ruling: same BPM + PATTERN_SEED as
//                         danceParty's chart, sample-accurate beat grid).
//   getMusicTime()      — F6: seconds since the current track started
//                         (WebAudio clock; null when stopped/pre-init/
//                         suspended) — danceParty's phase-lock time base.
//                         Medley contexts report their own start-relative time.
//   preloadSamples(ks)  — §B2.3: warm sfx ids or raw '<pack>/<file>' keys into
//                         the ≤6 MB decoded-buffer LRU cache (framework calls
//                         this with each game's optional `sfx: []` export).
//   previewBus(bus)     — §C2.2 slider-release blips: 'master'/'sfx'→ui.pick,
//                         'music'→0.5 s medley jingle, 'voice'→gooby.squeak,
//                         'ambience'→1 s rain fade (G33's settings rows call it).
//   setVolume(kind, v)  — legacy 0..1 runtime multipliers on the sfx/music
//                         buses (kept for API compat). The PERSISTED 5-slider
//                         volumes live in settings.volumes (§C2: master 80,
//                         sfx 100, music 70, voice 100, ambience 80 defaults)
//                         — this module store-follows them live and applies
//                         gain = (v/100)² per bus (§B2.2), master ×0.9 base.
//   stop(id)            — stop a looping sfx (snore).
//   setLoopGain(id, g)  — V4/G51 (§E0.1-16): live gain 0..1 of a RUNNING loop
//                         sfx (the §G4.5 surf wind layer); no-op otherwise.
//   radio               — V4/G51 (§B2.3): the MediaElement radio engine
//                         (radioPlayer.js) — element→trackGain→radioGain→
//                         bus.music, attached in init(), muted airtight with
//                         settings.music, ducked by danceParty/recap.
//   impact(style)       — haptics: guarded @capacitor/haptics dynamic import
//                         + navigator.vibrate fallback; sfxMap defs carry a
//                         `haptic` field.
//
// V3/G32 bus graph (§B2.1): master ← { sfx, music, voice, ambience }; the
// master keeps the 0.9 base + limiter chain (+ a peak analyser for the §C4.2
// dev overlay). Routing rule = sfxMap.busFor(): sample/synth → sfx, voice →
// voice, ambience.* loops → ambience; the medley director + synth sequencer
// own the music bus. Mute booleans stay quick-mutes (§C2.3): settings.sfx
// mutes sfx+voice, settings.music mutes music+ambience AND tears down the
// medley/sequencer (v2 FIX-B airtight rule: zero node creation while muted).
// Sliders at 0 do NOT tear down (gain-0 only).
//
// Calls made before init() are safe no-ops (music remembers the requested
// track and starts it after the unlock).

import { getAudioUrl } from '../core/assets.js';
import { getStore } from '../core/store.js';
import { DANCE } from '../data/constants.js';
import { getSfxDef, busFor } from './sfxMap.js';
import { VOICE_RECIPES } from './goobyVoice.js';
import musicDirector, { MEDLEY, MEDLEY_CONTEXTS } from './musicDirector.js';
// V4/G51 (PLAN4 §B2.3): the MediaElement radio engine — deps injected in
// init() (radio.attach), no import cycle (radioPlayer never imports audio.js).
import radio from './radioPlayer.js';

const DEV = !!import.meta.env?.DEV;

/** @type {AudioContext|null} */
let ctx = null;
/** @type {GainNode|null} master bus */
let masterGain = null;
/** @type {{sfx: GainNode, music: GainNode, voice: GainNode, ambience: GainNode}|null} */
let bus = null;
/** @type {AnalyserNode|null} master peak meter (§C4.2 dev overlay) */
let analyser = null;
/** @type {Float32Array|null} analyser scratch buffer */
let analyserBuf = null;
/** @type {GainNode|null} quiet staging of the synth sequencer (MUSIC_LEVEL) */
let seqGain = null;
/** @type {GainNode|null} V4/G51 (§B2.3): the radio's fade stage under
 * bus.music — element → mediaElementSource → trackGain → radioGain → music. */
let radioGain = null;

/** Runtime volume multipliers (setVolume) — combined with the enabled flags. */
const volumes = { sfx: 1, music: 1 };

// ── V3/G32 (§B2.2/§C2.2): the 5 persisted volume sliders ────────────────────
/** §C2.2 defaults — used whenever settings.volumes is missing/partial (the
 * save schema lands with G34; this module is defensive against old saves). */
export const DEFAULT_VOLUMES = Object.freeze({ master: 80, sfx: 100, music: 70, voice: 100, ambience: 80 });
/** Master keeps its historical 0.9 base factor (§B2.2). */
const MASTER_BASE = 0.9;
/** Live slider values 0–100 (store-followed). */
const slider = { ...DEFAULT_VOLUMES };

/**
 * §B2.2 binding slider→gain mapping: gain = (v/100)² (perceptual curve).
 * @param {number} v 0..100
 * @returns {number} 0..1
 */
export function volumeGain(v) {
  const c = Math.min(100, Math.max(0, Number(v) || 0));
  return (c * c) / 10000; // = (v/100)² without float dust: volumeGain(80) === 0.64
}

/**
 * Clamp/complete a settings.volumes slice against the §C2.2 defaults —
 * non-numbers and out-of-range values fall back / clamp to 0..100 ints.
 * @param {object|null|undefined} v
 * @returns {{master: number, sfx: number, music: number, voice: number, ambience: number}}
 */
export function sanitizeVolumes(v) {
  const out = { ...DEFAULT_VOLUMES };
  if (v && typeof v === 'object') {
    for (const k of Object.keys(DEFAULT_VOLUMES)) {
      const n = Number(v[k]);
      if (Number.isFinite(n)) out[k] = Math.round(Math.min(100, Math.max(0, n)));
    }
  }
  return out;
}
// ── end V3/G32 slider math ───────────────────────────────────────────────────

/** Persisted toggles, mirrored live from save settings (§E3). */
const enabled = { sfx: true, music: true, haptics: true };

/** Diagnostics: node/play counters (§G G14 DoD: verify the graph headlessly). */
const stats = { nodesCreated: 0, plays: 0, errors: 0 };

// ── V3/G32 (§B2.3): decoded-buffer LRU cache (≤ 6 MB decoded) ────────────────
/** Decoded-bytes budget: LRU-evict beyond it (§B2.3). */
export const SAMPLE_CACHE_BUDGET = 6 * 1024 * 1024;
/** V3/FIX-B (E5 P2): max keys per preloadSamples() call — a full-library
 * preload (251 keys) cycled the whole 6 MB LRU (223 evictions) and left only
 * the tail warm; per-game `sfx: []` sets and medley warmups are all ≤ ~25. */
export const PRELOAD_BATCH_MAX = 32;
/** @type {Map<string, {promise: Promise<AudioBuffer|null>, buffer: AudioBuffer|null, bytes: number}>}
 * key → cache entry; Map insertion order IS the LRU order (touch = re-insert). */
const bufferCache = new Map();
let bufferCacheBytes = 0;

/** @type {Map<string, {stop: () => void}>} live loop handles by sfx id */
const loops = new Map();
/** V3/G32: per-id last-play clock for defs with throttleMs (ui.slider 80 ms). */
const lastPlayAt = new Map();
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

/**
 * V3/G32 (§C2.3): the mute boolean gating a bus — settings.sfx mutes
 * sfx+voice, settings.music mutes music+ambience (no new toggles).
 * @param {'sfx'|'music'|'voice'|'ambience'} busId
 */
function busEnabled(busId) {
  return busId === 'music' || busId === 'ambience' ? enabled.music : enabled.sfx;
}

/** Apply the (possibly changed) save settings to the buses. */
function applySettings(settings) {
  if (settings) {
    enabled.sfx = settings.sfx !== false;
    enabled.music = settings.music !== false;
    enabled.haptics = settings.haptics !== false;
  }
  // V3/G32 (§B2.2): live store-follow of the 5 sliders (missing → §C2.2
  // defaults — G34's schema may not exist in older saves).
  Object.assign(slider, sanitizeVolumes(settings?.volumes));
  applyGains();
  // V2/FIX-B (E15): the music toggle must be airtight — zeroing the bus gain
  // is not enough, the sequencer interval kept creating nodes into the muted
  // bus. Tear the sequencer down while music is off and restart the wanted
  // track (fresh, from step 0) when it comes back on. Runs on every store
  // 'change': both branches are no-ops when nothing changed (stopMusic with
  // no seq / seq already playing wantTrack).
  // V3/G32 (§C2.3): the same airtight rule extends to the medley director —
  // setEnabled tears its scheduler down / resumes the remembered context.
  musicDirector.setEnabled(enabled.music);
  // V4/G51 (§B2.4): …and verbatim to the radio — element pause() + zero node
  // creation while settings.music is off; the persisted wish resumes on re-on.
  radio.setEnabled(enabled.music);
  if (!enabled.music) {
    stopMusic();
  } else if (ctx && wantTrack != null && wantTrack === 'dance' && seq?.id !== wantTrack) {
    startMusic(wantTrack);
  }
  // F3: park running loops while their bus is off; bring them back on
  // re-enable (e.g. mute during a nap must not permanently silence the
  // snore). V3/G32: per-bus — the snore (voice) parks with the sfx boolean,
  // ambience loops (rain/birdsong) park with the music boolean (§C2.3).
  const parkBuses = [];
  if (!enabled.sfx) parkBuses.push('sfx', 'voice');
  if (!enabled.music) parkBuses.push('ambience');
  if (parkBuses.length > 0) {
    // V2/G29: park AFTER stopping — stop(id) clears pendingLoops entries, so
    // the old add-then-stop order silently dropped the parked ids and a mute
    // cycle never resumed the loops (§D6 toggle contract).
    const running = [...loops.keys()].filter((id) => {
      const def = getSfxDef(id);
      return def && parkBuses.includes(busFor(id, def));
    });
    for (const id of running) stop(id);
    for (const id of running) pendingLoops.add(id);
  }
  resumePendingLoops();
}

/** F3: (re)start loops that were requested while blocked (no ctx / bus off). */
function resumePendingLoops() {
  if (!ctx) return;
  for (const id of [...pendingLoops]) {
    const def = getSfxDef(id);
    if (!def || !busEnabled(busFor(id, def))) continue; // stays parked
    pendingLoops.delete(id);
    play(id);
  }
}

/** @type {Map<AudioParam, number>} last target applied per bus param (ramp). */
const lastTargets = new Map();

/**
 * Anchored bus-gain ramp: skip when the target is already applied, then
 * cancel the pending timeline and PIN the current value before scheduling.
 * applyGains runs on every store 'change' (~1/s from gameplay ticks);
 * unconditional setTargetAtTime piled stacked events onto the params, and
 * chaining a new setTargetAtTime onto an old open-ended one makes Chrome
 * mis-evaluate the curve (observed live in the V3/G32 CDP tour: the sfx bus
 * ignored a fresh 0.64 target and sat at 1). setValueAtTime(param.value, t)
 * closes the previous target event so the new ramp starts cleanly.
 * @param {AudioParam} param @param {number} target
 * @param {number} t @param {number} tau
 */
function ramp(param, target, t, tau) {
  if (lastTargets.get(param) === target) return;
  lastTargets.set(param, target);
  param.cancelScheduledValues?.(t);
  param.setValueAtTime?.(param.value, t);
  param.setTargetAtTime(target, t, tau);
}

/**
 * V3/G32 (§B2.2): effective per-bus gains — enabled ? sliderGain : 0; the
 * legacy setVolume 0..1 multipliers still ride the sfx/music buses.
 */
function applyGains() {
  if (!bus) return;
  const t = ctx.currentTime;
  ramp(masterGain.gain, MASTER_BASE * volumeGain(slider.master), t, 0.02);
  ramp(bus.sfx.gain, enabled.sfx ? volumeGain(slider.sfx) * volumes.sfx : 0, t, 0.02);
  ramp(bus.voice.gain, enabled.sfx ? volumeGain(slider.voice) : 0, t, 0.02);
  ramp(bus.music.gain, enabled.music ? volumeGain(slider.music) * volumes.music : 0, t, 0.05);
  ramp(bus.ambience.gain, enabled.music ? volumeGain(slider.ambience) : 0, t, 0.05);
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

  // V3/G32 (§B2.1): master keeps the 0.9 base (× the master slider §B2.2) +
  // the limiter chain; a peak analyser taps the post-limiter signal for the
  // §C4.2 dev-overlay meter (skipped on stub contexts without createAnalyser).
  masterGain = ctx.createGain();
  masterGain.gain.value = MASTER_BASE * volumeGain(slider.master);
  const limiter = ctx.createDynamicsCompressor(); // gentle safety limiter
  limiter.threshold.value = -12;
  limiter.ratio.value = 6;
  if (typeof ctx.createAnalyser === 'function') {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserBuf = new Float32Array(analyser.fftSize);
    masterGain.connect(limiter).connect(analyser).connect(ctx.destination);
  } else {
    masterGain.connect(limiter).connect(ctx.destination);
  }
  // V3/G32 (§B2.1): 4 sub-buses — voice + ambience split OUT of sfx.
  bus = { sfx: ctx.createGain(), music: ctx.createGain(), voice: ctx.createGain(), ambience: ctx.createGain() };
  for (const b of Object.values(bus)) b.connect(masterGain);
  // The synth sequencer keeps its historical quiet staging (MUSIC_LEVEL)
  // BELOW the music bus, so the bus gain itself is exactly (v/100)² (§B2.2).
  seqGain = ctx.createGain();
  seqGain.gain.value = MUSIC_LEVEL;
  seqGain.connect(bus.music);
  // V3/G32 (§B2.4): wire the medley director to the live graph + §B2.3 cache.
  musicDirector.attach({
    ctx,
    dest: bus.music,
    loadBuffer,
    getCachedBuffer,
  });
  // ── V4/G51 (PLAN4 §B2.3/§B2.4): radio wiring ───────────────────────────────
  // radioGain sits UNDER bus.music so the music slider/mute stay exactly
  // (v/100)² on the bus; the engine drives its 300 ms transition fades here.
  // The HTMLAudioElement itself is created lazily on the first radio start
  // (createMediaElementSource exactly once per element — §B2.3 reuse rule).
  // attach() also resumes the persisted radio.playing wish — init() runs on
  // the first user gesture, so el.play() is gesture-sanctioned.
  radioGain = ctx.createGain();
  radioGain.gain.value = 1;
  radioGain.connect(bus.music);
  radio.attach({ ctx, radioGain });
  // ── end V4/G51 ─────────────────────────────────────────────────────────────

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
    // V2/FIX-B: route through music() — respects the enabled.music gate (the
    // applySettings above may already have started wantTrack) instead of
    // unconditionally spinning up a sequencer.
    music(track);
  }
  resumePendingLoops(); // F3: e.g. snore requested at boot while asleep (§D6)
  console.info(`[audio] WebAudio init — state=${ctx.state}, sampleRate=${ctx.sampleRate}, buses=sfx/music/voice/ambience→master`);
}

// ---------------------------------------------------------------------------
// Sample pool — V3/G32 (§B2.3): decoded-buffer LRU cache (≤ 6 MB decoded)
// ---------------------------------------------------------------------------

/** Decoded PCM bytes of an AudioBuffer (Float32 per channel). */
function decodedBytes(buffer) {
  const len = Number(buffer?.length) || 0;
  const ch = Number(buffer?.numberOfChannels) || 1;
  return len * ch * 4;
}

/**
 * V3/FIX-B (E5 P2) pin policy: the ACTIVE medley context's jingle keys are
 * never LRU-evicted (≤ ~10 small buffers), so a preload flood can't silence
 * the live medley until the reshuffle slowly re-warms each bar.
 * @returns {Set<string>|null} pinned keys, or null when no medley is live
 */
function pinnedKeys() {
  const context = musicDirector.activeContext();
  if (!context || !MEDLEY[context]) return null;
  return new Set(MEDLEY[context].bars.filter(Boolean));
}

/** Evict least-recently-used SETTLED entries beyond the budget (§B2.3).
 * V3/FIX-B (E5 P2): pinned (active-medley) keys are skipped — the cache may
 * transiently sit above budget by the pinned bytes, like in-flight loads. */
function evictLru() {
  if (bufferCacheBytes <= SAMPLE_CACHE_BUDGET) return;
  const pinned = pinnedKeys();
  for (const [key, entry] of bufferCache) {
    if (bufferCacheBytes <= SAMPLE_CACHE_BUDGET) break;
    if (entry.buffer == null) continue; // in-flight/failed loads are weightless
    if (pinned?.has(key)) continue; // §B2.3 pin: the live medley stays warm
    bufferCache.delete(key);
    bufferCacheBytes -= entry.bytes;
    if (DEV) console.debug(`[audio] LRU-evicted '${key}' (${entry.bytes} B, cache now ${bufferCacheBytes} B)`);
  }
}

/**
 * Fetch + decode a Kenney ogg into the LRU cache (promise-cached; null on
 * failure). A cache hit re-inserts the entry — Map order IS the LRU order.
 * @param {string} key '<pack>/<file-no-ext>' — resolved via assets.getAudioUrl
 * @returns {Promise<AudioBuffer|null>}
 */
function loadBuffer(key) {
  const hit = bufferCache.get(key);
  if (hit) {
    bufferCache.delete(key); // touch: move to the fresh end
    bufferCache.set(key, hit);
    return hit.promise;
  }
  const entry = { promise: null, buffer: null, bytes: 0 };
  entry.promise = (async () => {
    try {
      const url = getAudioUrl(key);
      if (!url) return null;
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      if (bufferCache.get(key) === entry) {
        entry.buffer = buffer;
        entry.bytes = decodedBytes(buffer);
        bufferCacheBytes += entry.bytes;
        evictLru();
      }
      return buffer;
    } catch (err) {
      stats.errors += 1;
      console.warn(`[audio] failed to load '${key}':`, err?.message);
      // V3/FIX-B: drop the failed entry so a later request can RETRY — a
      // cached null used to silence the key until the next full reload.
      if (bufferCache.get(key) === entry) bufferCache.delete(key);
      return null;
    }
  })();
  bufferCache.set(key, entry);
  return entry.promise;
}

/**
 * Synchronous cache read (no fetch) — the medley director schedules bars from
 * here so a slow decode can never stall the bar grid (§B2.4).
 * @param {string} key
 * @returns {AudioBuffer|null}
 */
function getCachedBuffer(key) {
  const entry = bufferCache.get(key);
  if (!entry?.buffer) return null;
  bufferCache.delete(key); // touch — active medley jingles stay hot
  bufferCache.set(key, entry);
  return entry.buffer;
}

/**
 * V3/G32 (§B2.3): warm samples into the decoded-buffer cache. Accepts sfx IDS
 * (resolved through sfxMap — the per-game `sfx: []` export convention) and/or
 * raw '<pack>/<file-no-ext>' asset keys. Safe pre-init (no-op) and repeatable.
 * V3/FIX-B (E5 P2): batches are capped at PRELOAD_BATCH_MAX resolved keys —
 * a "preload everything" call used to churn the whole LRU (223 evictions on
 * a 251-key flood) and evict every warm set; the overflow is dropped (dev
 * warning) since anything past the cap would only evict earlier batch keys.
 * @param {string[]} keysOrIds
 * @returns {Promise<void>}
 */
export async function preloadSamples(keysOrIds) {
  if (!ctx || !Array.isArray(keysOrIds)) return;
  const keys = new Set();
  for (const item of keysOrIds) {
    if (typeof item !== 'string') continue;
    if (item.includes('/')) {
      keys.add(item);
    } else {
      const def = getSfxDef(item);
      if (def?.kind === 'sample') for (const k of def.keys) keys.add(k);
    }
  }
  let list = [...keys];
  if (list.length > PRELOAD_BATCH_MAX) {
    if (DEV) console.warn(`[audio] preloadSamples: ${list.length}-key batch capped to ${PRELOAD_BATCH_MAX} (§B2.3 anti-thrash — preload per-context sets, not the library)`);
    list = list.slice(0, PRELOAD_BATCH_MAX);
  }
  await Promise.all(list.map((k) => loadBuffer(k)));
}

/**
 * @param {import('./sfxMap.js').SampleDef} def
 * @param {number} vol
 * @param {AudioNode} dest V3/G32 (§B2.1): the routed bus
 */
async function playSample(def, vol, dest) {
  const key = def.keys[Math.floor(Math.random() * def.keys.length)];
  const buffer = await loadBuffer(key); // cached → resolves immediately
  if (!buffer || !ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  // V3/G32: def.rate (e.g. the §C3.1 pitched jump ×1.3) × subtle humanize
  src.playbackRate.value = (def.rate ?? 1) * (0.97 + Math.random() * 0.06);
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(dest);
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
/** V2/G29: extracted so the polished rain loop's patter layer can share it. */
function whiteNoiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function noise(dest, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, dur = 0.2, vol = 0.4, at = 0 }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = whiteNoiseBuffer();
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

/**
 * V2/G29: recipes now take an optional third options bag — `o.pitch` is a
 * frequency multiplier (1 = recipe base), so ONE recipe can serve a pitched
 * family (goobySays' four rising pentatonic pads). sfxMap synth defs carry a
 * `pitch` field; audio.play(id, {pitch}) can multiply on top. v1 recipes
 * ignore the bag (unchanged signatures are still valid).
 * @type {Record<string, (dest: AudioNode, vol: number, o?: {pitch?: number}) => void>}
 */
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

  // ==========================================================================
  // V2/G29: 2.0 bespoke recipes (§E wave 4 — garden/health/vet/progression/
  // photo/new-game sounds; §D1 audio row: synth-only, NO new sample packs).
  // All take the optional pitch bag (o.pitch multiplies every frequency).
  // ==========================================================================

  /** goobySays pad squeak (§C1.2 #1): warm pluck + soft sub — the 4 pads map
   *  this at pitches 1 / 1.125 / 1.25 / 1.5 (rising C-D-E-G pentatonic). */
  saysPad(dest, vol, o = {}) {
    const p = o.pitch ?? 1;
    tone(dest, { type: 'triangle', f0: 523.25 * p, f1: 530 * p, dur: 0.3, vol: vol * 0.55, attack: 0.008 });
    tone(dest, { type: 'sine', f0: 261.63 * p, dur: 0.26, vol: vol * 0.3, attack: 0.01 });
    noise(dest, { type: 'highpass', f0: 3600, dur: 0.02, vol: vol * 0.12 }); // pad "touch" tick
  },

  /** Doorbell ding-dong (§C9.2 vet arrival / §C1.2 #5 delivery drop). */
  doorbell(dest, vol, o = {}) {
    const p = o.pitch ?? 1;
    for (const [f, at, d] of [[659.25, 0, 0.4], [523.25, 0.28, 0.62]]) {
      tone(dest, { type: 'sine', f0: f * p, dur: d, vol: vol * 0.5, at, attack: 0.008 });
      tone(dest, { type: 'sine', f0: f * 2 * p, dur: d * 0.6, vol: vol * 0.14, at, attack: 0.008 });
    }
  },

  /** Camera shutter (§C12.2): click-CLACK + tiny motor wind. */
  shutter(dest, vol) {
    noise(dest, { type: 'highpass', f0: 3000, dur: 0.025, vol: vol * 0.7 });
    tone(dest, { f0: 2400, f1: 1400, dur: 0.03, vol: vol * 0.2 });
    noise(dest, { type: 'bandpass', f0: 1500, q: 1.2, dur: 0.035, vol: vol * 0.6, at: 0.075 });
    tone(dest, { type: 'square', f0: 95, f1: 70, dur: 0.06, vol: vol * 0.1, at: 0.075 }); // motor
  },

  /** Bell-collar jingle (§C8.4): two inharmonic bell partials, two shakes. */
  bellJingle(dest, vol, o = {}) {
    const p = o.pitch ?? 1;
    for (let shake = 0; shake < 2; shake += 1) {
      const at = shake * 0.085;
      const jp = p * (0.97 + Math.random() * 0.06);
      tone(dest, { type: 'sine', f0: 2093 * jp, dur: 0.16, vol: vol * (0.4 - shake * 0.12), at, attack: 0.004 });
      tone(dest, { type: 'sine', f0: 2093 * 2.76 * jp, dur: 0.09, vol: vol * 0.16, at, attack: 0.004 });
    }
  },

  /** miniGolf putt (§C1.2 #6): soft putter tock. */
  golfPutt(dest, vol) {
    noise(dest, { type: 'lowpass', f0: 1600, f1: 500, dur: 0.035, vol: vol * 0.55 });
    tone(dest, { type: 'sine', f0: 190, f1: 135, dur: 0.09, vol: vol * 0.6 });
  },

  /** miniGolf sink (§C1.2 #6): ball-in-cup rattle + happy blip. */
  golfSink(dest, vol) {
    [520, 430, 350].forEach((f, i) => {
      tone(dest, { type: 'sine', f0: f, f1: f * 0.85, dur: 0.06, vol: vol * 0.4, at: i * 0.085 });
      noise(dest, { type: 'lowpass', f0: 1400, dur: 0.025, vol: vol * 0.25, at: i * 0.085 });
    });
    tone(dest, { type: 'triangle', f0: 784, f1: 1046, dur: 0.16, vol: vol * 0.4, at: 0.3 });
  },

  /** veggieChop chop (§C1.2 #4): knife slice + board thunk. */
  chop(dest, vol) {
    noise(dest, { type: 'highpass', f0: 2200, dur: 0.045, vol: vol * 0.65 });
    tone(dest, { f0: 230, f1: 90, dur: 0.09, vol: vol * 0.55, at: 0.02 });
    noise(dest, { type: 'lowpass', f0: 900, f1: 300, dur: 0.06, vol: vol * 0.3, at: 0.02 });
  },

  /** veggieChop junk splat (§C1.2 #4): wet burst + sagging blob. */
  splat(dest, vol) {
    noise(dest, { type: 'lowpass', f0: 2200, f1: 320, q: 0.7, dur: 0.2, vol: vol * 0.6 });
    tone(dest, { f0: 260, f1: 75, dur: 0.18, vol: vol * 0.5 });
    noise(dest, { type: 'highpass', f0: 2800, dur: 0.05, vol: vol * 0.18, at: 0.02 }); // juice speckle
  },

  /** goalieGooby save-dive (§C1.2 #7): whoosh sweep + soft grass landing. */
  diveWhoosh(dest, vol) {
    noise(dest, { f0: 420, f1: 2600, q: 1.4, dur: 0.16, vol: vol * 0.5 });
    noise(dest, { f0: 2600, f1: 500, q: 1.4, dur: 0.14, vol: vol * 0.45, at: 0.14 });
    noise(dest, { type: 'lowpass', f0: 700, f1: 250, dur: 0.09, vol: vol * 0.4, at: 0.26 });
  },

  /** deliveryRush drop confetti (§C1.2 #5): pop + rising sparkle fizz. */
  confettiPop(dest, vol) {
    tone(dest, { f0: 880, f1: 380, dur: 0.08, vol: vol * 0.55 });
    noise(dest, { type: 'highpass', f0: 2400, f1: 5200, dur: 0.3, vol: vol * 0.2 });
    [1318.5, 1568, 2093, 2637].forEach((f, i) =>
      tone(dest, { type: 'triangle', f0: f, dur: 0.12, vol: vol * 0.26, at: 0.06 + i * 0.045 }));
  },

  /** Vet cure (§C3.5/§C9.2): healing shimmer — warm pad + rising arp + dust. */
  vetSparkle(dest, vol) {
    tone(dest, { type: 'sine', f0: 392, dur: 0.55, vol: vol * 0.22, attack: 0.06 });
    [784, 987.75, 1318.5].forEach((f, i) =>
      tone(dest, { type: 'triangle', f0: f, dur: 0.2, vol: vol * 0.35, at: 0.08 + i * 0.1 }));
    [2093, 2637].forEach((f, i) =>
      tone(dest, { f0: f, dur: 0.12, vol: vol * 0.16, at: 0.4 + i * 0.06 }));
  },

  /** Vet checkup (§C3.5): clipboard tick + affirmative two-note "all good". */
  checkupChime(dest, vol) {
    noise(dest, { type: 'highpass', f0: 2600, dur: 0.02, vol: vol * 0.3 });
    tone(dest, { type: 'triangle', f0: 659.25, dur: 0.1, vol: vol * 0.45, at: 0.07 });
    tone(dest, { type: 'triangle', f0: 880, dur: 0.2, vol: vol * 0.5, at: 0.2 });
  },

  /** Landmark discovered (§C9.3): bright fourth-up motif + camera-flash fizz. */
  discovery(dest, vol) {
    tone(dest, { type: 'triangle', f0: 587.33, dur: 0.12, vol: vol * 0.45 });
    tone(dest, { type: 'triangle', f0: 783.99, dur: 0.24, vol: vol * 0.5, at: 0.11 });
    noise(dest, { type: 'highpass', f0: 3200, dur: 0.1, vol: vol * 0.18, at: 0.11 });
    tone(dest, { f0: 2093, dur: 0.1, vol: vol * 0.16, at: 0.3 });
  },

  /** Quest claim (§C5): compact 3-note triumph + octave stab. */
  questJingle(dest, vol) {
    [523.25, 659.25, 783.99].forEach((f, i) =>
      tone(dest, { type: 'square', f0: f, dur: 0.09, vol: vol * 0.3, at: i * 0.08 }));
    tone(dest, { type: 'triangle', f0: 1046.5, dur: 0.3, vol: vol * 0.45, at: 0.24 });
    tone(dest, { f0: 2093, dur: 0.14, vol: vol * 0.14, at: 0.28 });
  },

  /** Sticker earned (§C6): peel + up-pop + bright ping. */
  stickerPop(dest, vol) {
    noise(dest, { type: 'bandpass', f0: 900, f1: 2400, q: 1.4, dur: 0.07, vol: vol * 0.3 }); // peel
    tone(dest, { f0: 700, f1: 1350, dur: 0.08, vol: vol * 0.55, at: 0.05 });
    tone(dest, { type: 'sine', f0: 1760, dur: 0.18, vol: vol * 0.3, at: 0.13 });
  },

  /** Sticker SET complete (§C6): the big one — 4-note fanfare into a chord. */
  setFanfare(dest, vol) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(dest, { type: 'triangle', f0: f, dur: 0.13, vol: vol * 0.4, at: i * 0.1 }));
    [1046.5, 1318.5, 1568].forEach((f, i) =>
      tone(dest, { type: 'triangle', f0: f, dur: 0.45, vol: vol * 0.3, at: 0.42 + i * 0.015 }));
    noise(dest, { type: 'highpass', f0: 3000, f1: 6000, dur: 0.35, vol: vol * 0.14, at: 0.42 });
  },

  /** Garden harvest (§C2.2): crisp pluck-pop + Gooby's delighted gasp —
   *  "harvest joy" (the voice recipe rides inside this synth recipe so the
   *  single 'garden.harvest' id delivers both). */
  harvestJoy(dest, vol) {
    tone(dest, { f0: 620, f1: 1400, dur: 0.09, vol: vol * 0.6 });
    noise(dest, { type: 'highpass', f0: 2600, dur: 0.03, vol: vol * 0.25 });
    VOICE_RECIPES.delightedGasp(ctx, dest, { volume: vol * 0.9 });
  },

  /** Crop turned ready (§C2.2): gentle two-note glisten (quiet, ambient). */
  readyChime(dest, vol) {
    tone(dest, { type: 'sine', f0: 1174.66, dur: 0.14, vol: vol * 0.4 });
    tone(dest, { type: 'sine', f0: 1568, dur: 0.26, vol: vol * 0.42, at: 0.12 });
  },

  /** Watering-can trickle (§C2.2): overlapping burbles + two high droplets. */
  trickle(dest, vol, o = {}) {
    const p = o.pitch ?? 1;
    [1500, 1150, 900].forEach((f, i) =>
      noise(dest, { type: 'bandpass', f0: f * p, f1: f * 0.7 * p, q: 2.4, dur: 0.28, vol: vol * 0.35, at: i * 0.14 }));
    for (let i = 0; i < 2; i += 1) {
      const f = (2200 + Math.random() * 900) * p;
      tone(dest, { f0: f, f1: f * 1.35, dur: 0.05, vol: vol * 0.18, at: 0.12 + i * 0.19 });
    }
  },

  /** Fertilizer (§C2.2): two dust-bag puffs + a growth sparkle tail. */
  fertilizerPuff(dest, vol) {
    noise(dest, { type: 'lowpass', f0: 600, f1: 260, dur: 0.09, vol: vol * 0.5 });
    noise(dest, { type: 'lowpass', f0: 520, f1: 240, dur: 0.1, vol: vol * 0.4, at: 0.13 });
    [1568, 2093].forEach((f, i) =>
      tone(dest, { f0: f, dur: 0.11, vol: vol * 0.2, at: 0.26 + i * 0.06 }));
  },

  /** Compost-bin sale (§C2.2): cash-register cha-ching — tick, bell dyad, drawer. */
  chaChing(dest, vol) {
    noise(dest, { type: 'highpass', f0: 3400, dur: 0.02, vol: vol * 0.4 });
    tone(dest, { type: 'sine', f0: 1318.5, dur: 0.24, vol: vol * 0.4, at: 0.05, attack: 0.005 });
    tone(dest, { type: 'sine', f0: 1760, dur: 0.28, vol: vol * 0.34, at: 0.06, attack: 0.005 });
    tone(dest, { type: 'sine', f0: 150, f1: 105, dur: 0.09, vol: vol * 0.4, at: 0.2 });
    noise(dest, { type: 'lowpass', f0: 900, f1: 350, dur: 0.06, vol: vol * 0.25, at: 0.2 });
  },

  /** Seed planted (§C2.2): soil plop + two soft paw pats. */
  seedPlant(dest, vol) {
    tone(dest, { f0: 300, f1: 92, dur: 0.12, vol: vol * 0.6 });
    noise(dest, { type: 'lowpass', f0: 620, f1: 300, dur: 0.05, vol: vol * 0.35, at: 0.14 });
    noise(dest, { type: 'lowpass', f0: 560, f1: 280, dur: 0.05, vol: vol * 0.3, at: 0.26 });
  },

  /** starHopper star pickup (§C1.2 #8): bright ping + shimmer partial. */
  starPing(dest, vol, o = {}) {
    const p = o.pitch ?? 1;
    tone(dest, { type: 'sine', f0: 1568 * p, f1: 1975.5 * p, dur: 0.11, vol: vol * 0.5, attack: 0.005 });
    tone(dest, { type: 'sine', f0: 3136 * p, dur: 0.14, vol: vol * 0.16, at: 0.03 });
    noise(dest, { type: 'highpass', f0: 5000, dur: 0.06, vol: vol * 0.1, at: 0.02 });
  },

  /** starHopper golden carrot (§C1.2 #8): coin dyad + sparkle triplet. */
  goldenPing(dest, vol) {
    tone(dest, { type: 'square', f0: 987, dur: 0.06, vol: vol * 0.35 });
    tone(dest, { type: 'square', f0: 1318.5, dur: 0.14, vol: vol * 0.35, at: 0.06 });
    [2093, 2637, 3136].forEach((f, i) =>
      tone(dest, { f0: f, dur: 0.1, vol: vol * 0.18, at: 0.12 + i * 0.05 }));
  },

  /** pipeFlow path connect (§C1.2 #9): click + rising double-bloop + gurgle. */
  pipeConnect(dest, vol) {
    noise(dest, { type: 'highpass', f0: 2600, dur: 0.02, vol: vol * 0.35 });
    tone(dest, { f0: 440, f1: 560, dur: 0.09, vol: vol * 0.45, at: 0.04 });
    tone(dest, { f0: 587, f1: 760, dur: 0.11, vol: vol * 0.5, at: 0.15 });
    noise(dest, { type: 'bandpass', f0: 1300, f1: 750, q: 2.2, dur: 0.22, vol: vol * 0.3, at: 0.24 });
  },

  /** goalieGooby crowd (§C1.2 #7): bunny-crowd cheer — a soft roar swell with
   *  a handful of overlapping happy squeaks poking out of it. */
  bunnyCheer(dest, vol) {
    noise(dest, { type: 'bandpass', f0: 900, f1: 1500, q: 0.7, dur: 0.75, vol: vol * 0.3 });
    for (let i = 0; i < 4; i += 1) {
      const f = 700 + Math.random() * 500;
      tone(dest, {
        type: 'triangle', f0: f, f1: f * 1.35, dur: 0.1 + Math.random() * 0.05,
        vol: vol * 0.22, at: 0.06 + i * 0.11 + Math.random() * 0.04,
      });
    }
    tone(dest, { type: 'triangle', f0: 1046.5, dur: 0.18, vol: vol * 0.2, at: 0.42 });
  },
  // ============================================================ end V2/G29 ==
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
  /**
   * Rain-on-leaves (§C11.2): brown noise → LP 800 Hz, −18 dB, ~1 s fades.
   * V2/G29 polish (id contract + level + SFX-toggle behavior unchanged):
   * a slow LP-frequency drift makes gust swells, and a quiet high "patter"
   * layer with a gentle tremolo reads as drops hitting the leaves.
   */
  rainLoop(dest, vol) {
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, RAIN_LOOP_GAIN * vol), t + 1);
    master.connect(dest);
    // body: brown noise → LP 800 Hz (the §C11.2 recipe)
    const src = ctx.createBufferSource();
    src.buffer = brownNoiseBuffer();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const bodyG = ctx.createGain();
    bodyG.gain.value = 0.92;
    src.connect(lp).connect(bodyG).connect(master);
    src.start(t);
    // V2/G29: gust swell — LP center drifts 800 ± 130 Hz over ~14 s
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.07;
    const driftGain = ctx.createGain();
    driftGain.gain.value = 130;
    drift.connect(driftGain).connect(lp.frequency);
    drift.start(t);
    // V2/G29: leaf patter — bandpassed white noise, slow tremolo, quiet
    const pat = ctx.createBufferSource();
    pat.buffer = whiteNoiseBuffer();
    pat.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const patG = ctx.createGain();
    patG.gain.value = 0.2;
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.5;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.08;
    trem.connect(tremGain).connect(patG.gain);
    pat.connect(bp).connect(patG).connect(master);
    pat.start(t);
    trem.start(t);
    return {
      stop() {
        const at = ctx.currentTime;
        master.gain.setTargetAtTime(0.0001, at, 0.25);
        for (const n of [src, pat, drift, trem]) n.stop(at + 1.2);
      },
    };
  },

  /**
   * Dawn birdsong (§C10.2): sparse chirp bursts on a timer.
   * V2/G29 polish (contract unchanged): each bird now sings one of THREE
   * motifs — rising chirps (the original), a fast two-note trill, or a
   * falling slur pair — and ~40% of bursts get a quieter "answer bird" at a
   * lower pitch, so the dawn garden sounds like a conversation.
   */
  birdsong(dest, vol) {
    const g = ctx.createGain();
    g.gain.value = vol;
    g.connect(dest);
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    /** one bird: a random motif around `base` Hz, `loud` 0..1, `at` offset s */
    const motif = (base, loud, at) => {
      const kind = Math.random();
      if (kind < 0.45) {
        // rising chirps (the G26 classic)
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i += 1) {
          tone(g, {
            type: 'sine', f0: base, f1: base * (1.12 + Math.random() * 0.22),
            dur: 0.08 + Math.random() * 0.04, vol: loud * (0.14 + Math.random() * 0.08),
            at: at + i * 0.13, attack: 0.015,
          });
        }
      } else if (kind < 0.75) {
        // V2/G29: fast two-note trill
        const n = 5 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i += 1) {
          const f = i % 2 === 0 ? base : base * 1.26;
          tone(g, {
            type: 'sine', f0: f, f1: f * 1.05, dur: 0.05,
            vol: loud * (0.1 + Math.random() * 0.06), at: at + i * 0.07, attack: 0.01,
          });
        }
      } else {
        // V2/G29: falling slur pair
        for (let i = 0; i < 2; i += 1) {
          tone(g, {
            type: 'sine', f0: base * 1.3, f1: base * (0.82 + Math.random() * 0.08),
            dur: 0.12 + Math.random() * 0.05, vol: loud * (0.12 + Math.random() * 0.06),
            at: at + i * 0.2, attack: 0.02,
          });
        }
      }
    };
    const burst = () => {
      const f0 = 2100 + Math.random() * 1700;
      motif(f0, 1, 0);
      // V2/G29: occasional answer bird, lower and further away
      if (Math.random() < 0.4) motif(f0 * 0.8, 0.55, 0.5 + Math.random() * 0.3);
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

// ── V4/G51 (PLAN4 §E0.1-16): per-loop gain stage for setLoopGain ─────────────
/**
 * Wrap a STARTING loop with its own gain node so setLoopGain(id, g) can ride
 * the live loop (PLAN4-GAMES §G4.5 wind layer). wrap(handle) produces the
 * loops-map entry ({stop, gain}); stop() defers the stage disconnect past the
 * recipe's own fade-out (rain fades ~1.2 s).
 * @param {AudioNode} dest the routed bus
 */
function loopStage(dest) {
  const gain = ctx.createGain();
  gain.gain.value = 1;
  gain.connect(dest);
  return {
    dest: gain,
    wrap(handle) {
      return {
        gain,
        stop() {
          try {
            handle.stop();
          } catch { /* already stopped */ }
          const cleanup = () => {
            try {
              gain.disconnect();
            } catch { /* already gone */ }
          };
          if (typeof setTimeout === 'function') setTimeout(cleanup, 1500);
          else cleanup();
        },
      };
    },
  };
}
// ── end V4/G51 ───────────────────────────────────────────────────────────────

/**
 * Play a one-shot sfx by semantic id (§D6). Unknown ids warn in dev builds
 * (the coverage test in test/onboarding.test.js keeps the map complete).
 * V2/G29: opts.pitch multiplies the def's pitch for pitch-aware synth recipes.
 * V3/G32 (§B2.1): the def routes to its bus via sfxMap.busFor() — sample/
 * synth → sfx, voice → voice, ambience loops → ambience — and the matching
 * mute boolean gates it airtight (§C2.3: no nodes into a muted bus).
 * @param {string} id
 * @param {{volume?: number, pitch?: number}} [opts]
 */
export function play(id, opts = {}) {
  const def = getSfxDef(id);
  if (!def) {
    if (DEV) console.warn(`[audio] UNMAPPED sfx id '${id}' — add it to sfxMap.js`);
    return;
  }
  if (def.haptic) impact(def.haptic);
  const busId = busFor(id, def);
  if (!ctx || !busEnabled(busId)) {
    // F3: remember loop requests (snore/ambience) so they start once
    // unblocked — covers "reload mid-sleep, first tap arrives later" and
    // mute cycles (per-bus since V3/G32: see applySettings parking).
    if (def.loop) pendingLoops.add(id);
    return;
  }
  // V3/G32 (§D3.5): per-id throttle — ui.slider drag ticks at most every 80 ms.
  if (def.throttleMs) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - (lastPlayAt.get(id) ?? -Infinity) < def.throttleMs) return;
    lastPlayAt.set(id, now);
  }
  pendingLoops.delete(id);
  stats.plays += 1;
  const vol = (def.volume ?? 1) * (opts.volume ?? 1);
  const dest = bus[busId];
  try {
    if (def.kind === 'sample') {
      playSample(def, vol, dest);
    } else if (def.kind === 'synth' && def.loop) {
      // V2/G26: looping synth (ambience.rain / ambience.birdsong) — same
      // handle plumbing as the voice snore loop below.
      if (loops.has(id)) return; // already running
      const make = LOOP_RECIPES[def.name];
      if (make) {
        // V4/G51 (§E0.1-16): loops start behind their own gain stage.
        const stage = loopStage(dest);
        const handle = make(stage.dest, vol);
        if (handle?.stop) {
          loops.set(id, stage.wrap(handle));
        } else {
          try {
            stage.dest.disconnect();
          } catch { /* already gone */ }
        }
      } else if (DEV) console.warn(`[audio] unknown loop recipe '${def.name}'`);
    } else if (def.kind === 'synth') {
      const recipe = SYNTH_RECIPES[def.name];
      // V2/G29: pitched recipe families — def.pitch (sfxMap) × opts.pitch
      // (call site) multiply every frequency in pitch-aware recipes.
      if (recipe) recipe(dest, vol, { pitch: (def.pitch ?? 1) * (opts.pitch ?? 1) });
      else if (DEV) console.warn(`[audio] unknown synth recipe '${def.name}'`);
    } else if (def.kind === 'voice') {
      const recipe = VOICE_RECIPES[def.name];
      if (!recipe) {
        if (DEV) console.warn(`[audio] unknown voice recipe '${def.name}'`);
        return;
      }
      if (def.loop) {
        if (loops.has(id)) return; // already snoring
        // V4/G51 (§E0.1-16): loops start behind their own gain stage.
        const stage = loopStage(dest);
        const handle = recipe(ctx, stage.dest, { volume: vol });
        if (handle?.stop) {
          loops.set(id, stage.wrap(handle));
        } else {
          try {
            stage.dest.disconnect();
          } catch { /* already gone */ }
        }
      } else {
        recipe(ctx, dest, { volume: vol });
      }
    }
    if (DEV) console.debug(`[audio] play ${id} (${def.kind}→${busId}) — nodes=${stats.nodesCreated} plays=${stats.plays}`);
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


// ---------------------------------------------------------------------------
// Music — V3/G32 (§B2.4): 'home' delegates to the jingle-medley director
// (musicDirector.js, real files per context); 'dance' keeps the procedural
// 100 BPM sequencer below (§C3.4 binding ruling: the chart is generated from
// DANCE.PATTERN_SEED and must stay sample-accurate to the beat grid — jingle
// files have variable internal onsets and cannot guarantee ≤70 ms windows).
// ---------------------------------------------------------------------------

/** Quiet staging of the synth sequencer under the music bus (§D6; V3/G32:
 * applied via the seqGain node so the BUS gain stays exactly (v/100)²). */
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
/**
 * V2/FIX-B (E15): the track the game currently WANTS (last music(id) call),
 * remembered across mute cycles. settings.music=false used to only zero the
 * bus gain while the sequencer interval kept creating ~2.7 WebAudio nodes/s
 * into the muted bus forever; now the sequencer is torn down while music is
 * off (zero node creation) and this remembers what to restart — cleanly from
 * step 0, a fresh getMusicTime() time base — when it is re-enabled.
 * @type {string|null}
 */
let wantTrack = null;

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
    tone(seqGain, { f0: 150, f1: 50, dur: 0.12, vol: 0.5, at });
  } else {
    // offbeat hat
    noise(seqGain, { type: 'highpass', f0: 6000, dur: 0.04, vol: 0.14, at });
  }
  if (step % 8 === 4) noise(seqGain, { f0: 1800, q: 1.4, dur: 0.09, vol: 0.22, at }); // backbeat snare
  // seeded 16-step bassline (regenerated once per track start)
  const f = seq.pattern[step % seq.pattern.length];
  if (f > 0) tone(seqGain, { type: 'sawtooth', f0: f, dur: eighth * 0.85, vol: 0.14, at });
  if (step % 16 === 0) {
    // sparkly stab at the top of every 2 bars
    [523.25, 659.25, 783.99].forEach((cf, i) =>
      tone(seqGain, { type: 'triangle', f0: cf, dur: 0.3, vol: 0.08, at: at + i * 0.02 }));
  }
  return eighth;
}

/** V3/G32: only 'dance' runs the synth sequencer now (§C3.4). */
function startMusic(id) {
  stopMusic();
  if (id !== 'dance') return;
  // V2/FIX-B (E15): never run the sequencer while music is toggled off — it
  // would schedule tone()/noise() nodes into a zero-gain bus forever. The
  // request stays in wantTrack; applySettings restarts it on re-enable.
  if (!enabled.music) return;
  const rng = mulberry32(DANCE.PATTERN_SEED);
  // startAt (F6): WebAudio time of sequencer step 0 — getMusicTime()'s zero.
  const startAt = ctx.currentTime + 0.08;
  seq = { id, timer: null, next: startAt, startAt, step: 0, rng };
  seq.pattern = Array.from({ length: 16 }, () =>
    rng() < 0.7 ? DANCE_SCALE[Math.floor(rng() * DANCE_SCALE.length)] : 0);
  seq.timer = setInterval(() => {
    if (!ctx || !seq) return;
    while (seq.next < ctx.currentTime + LOOKAHEAD_SEC) {
      seq.next += schedDanceStep(seq.step, seq.next);
      seq.step += 1;
    }
  }, TICK_MS);
  if (DEV) console.debug(`[audio] music 'dance' started (bpm=${DANCE.BPM})`);
}

function stopMusic() {
  if (!seq) return;
  clearInterval(seq.timer);
  seq = null;
}

/**
 * Start/stop background music (§D6/§B2.4). Tracks: any §C3.3 medley context
 * ('home'|'garden'|'arcade'|'city'|'shop'), 'dance', null = stop. Medley
 * contexts delegate to the director (per-context real-file medleys; the
 * roomManager/screen hooks may refine the context afterwards); 'dance' is
 * the §C3.4 synth sequencer and SUPPRESSES the medley while it owns the
 * music bus. Safe pre-init: the request is remembered and starts after the
 * unlock.
 * V2/FIX-B (E15): also safe while settings.music is off — the request is
 * remembered (wantTrack + the director's context wish) and starts when the
 * toggle comes back on; no sequencer/medley (and no node creation) runs
 * while music is off.
 * @param {string|null} id
 */
export function music(id) {
  wantTrack = id;
  if (!ctx) {
    pendingTrack = id;
    return;
  }
  musicDirector.setSuppressed(id === 'dance');
  // V4/G51 (§B2.4): danceParty ALWAYS ducks the radio (pause + remember) —
  // the radio resumes when the dance track releases the bus.
  radio.duck(id === 'dance', 'dance');
  if (id == null) {
    stopMusic();
    musicDirector.setContext(null);
    return;
  }
  if (id === 'dance') {
    if (!enabled.music) {
      stopMusic(); // defensive — the sequencer never runs while music is off
      return;
    }
    if (seq?.id !== 'dance') startMusic('dance');
    return;
  }
  // Medley contexts (and any unknown id, warned) → the director owns playback.
  const known = MEDLEY_CONTEXTS.includes(id);
  if (!known && DEV) console.warn(`[audio] unknown music track '${id}' — playing the 'home' medley`);
  stopMusic();
  musicDirector.setContext(known ? id : 'home');
}

/**
 * F6 (RE5): read-only music time base — seconds since the current music
 * track started (WebAudio clock, ctx.currentTime − the track's step-0
 * reference). Returns null when no track is running or the context clock is
 * not advancing (pre-init / suspended — e.g. headless VMs without an audio
 * device), so callers (danceParty's song clock) can phase-lock when they can
 * and fall back to a wall clock when they can't.
 * V3/G32: while a medley context is live (no synth sequencer) this reports
 * seconds since that context started — same null semantics.
 * @returns {number|null}
 */
export function getMusicTime() {
  if (!ctx || ctx.state !== 'running') return null;
  if (seq) return ctx.currentTime - seq.startAt;
  return musicDirector.getTime();
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

// ── V4/G51 (PLAN4 §E0.1-16 / PLAN4-GAMES §G4.5): live loop gain ──────────────
/**
 * Set the gain of a RUNNING loop sfx (e.g. 'ambience.windRun' intensity
 * 0→0.5 with surf speed, updated every 0.25 s). Contract per §E0.1-16:
 * no-op when the loop isn't playing; zero nodes while music-muted (a muted
 * bus parks its loops, so the not-playing no-op covers it — this function
 * only writes an AudioParam, it never creates nodes).
 * @param {string} id loop sfx id
 * @param {number} gain01 0..1
 */
export function setLoopGain(id, gain01) {
  const handle = loops.get(id);
  if (!ctx || !handle?.gain) return;
  const g = Math.min(1, Math.max(0, Number(gain01) || 0));
  ramp(handle.gain.gain, g, ctx.currentTime, 0.05);
}
// ── end V4/G51 ───────────────────────────────────────────────────────────────

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

/** @returns {number|null} master peak level in dBFS (post-limiter, §C4.2) */
function masterPeakDb() {
  if (!analyser || !analyserBuf) return null;
  try {
    analyser.getFloatTimeDomainData(analyserBuf);
  } catch {
    return null;
  }
  let peak = 0;
  for (let i = 0; i < analyserBuf.length; i += 1) {
    const a = Math.abs(analyserBuf[i]);
    if (a > peak) peak = a;
  }
  return peak <= 0 ? -Infinity : Math.round(20 * Math.log10(peak) * 10) / 10;
}

/**
 * V3/G32 (§C2.2): slider-release preview blip on the affected bus — G33's
 * settings rows call this on pointer-up (not during drag).
 *   master/sfx → ui.pick · music → 0.5 s medley jingle · voice →
 *   gooby.squeak · ambience → 1 s rain fade.
 * Airtight per §C2.3: muted buses produce zero nodes (play()/director gate).
 * @param {'master'|'sfx'|'music'|'voice'|'ambience'} busId
 */
export function previewBus(busId) {
  if (!ctx) return;
  if (busId === 'master' || busId === 'sfx') {
    play('ui.pick');
  } else if (busId === 'voice') {
    play('gooby.squeak');
  } else if (busId === 'music') {
    musicDirector.previewJingle();
  } else if (busId === 'ambience' && enabled.music) {
    try {
      const handle = LOOP_RECIPES.rainLoop(bus.ambience, 1);
      setTimeout(() => handle?.stop?.(), 1000);
    } catch (err) {
      if (DEV) console.warn('[audio] ambience preview failed:', err);
    }
  }
}

/**
 * Diagnostics snapshot (dev/DoD verification; §C4.2 dev-overlay feed).
 * V3/G32 extended shape (documented for G33's overlay + the evals):
 *   nodesCreated/plays/errors — module counters (existing)
 *   ctxState, loops, pendingLoops — existing
 *   track       — 'dance' (synth sequencer) | 'medley:<context>' | null
 *   gains       — LEGACY {sfx, music} live bus gains (kept for v2 probes)
 *   buses       — live gain per bus {master, sfx, music, voice, ambience}
 *                 (bus gain = enabled ? (v/100)² : 0; master ×0.9 base §B2.2)
 *   volumes     — the live slider values 0–100 {master, sfx, music, voice, ambience}
 *   enabled     — the quick-mute booleans {sfx, music, haptics}
 *   samples     — §B2.3 decoded-buffer cache {cached, bytes, budgetBytes,
 *                 pinned} (V3/FIX-B: pinned = resident active-medley jingles)
 *   medley      — musicDirector.getStats(): {context, wantContext, base,
 *                 overlays, bar, phrase, sourcesLive, nextBarAt,
 *                 schedule[≤24 of {bar, key, at}], barsScheduled,
 *                 jinglesScheduled, contextSwitches, barsSkipped (V3/FIX-B:
 *                 bars fast-forwarded past after a stall), enabled, suppressed,
 *                 radioActive (V4/G51 §B2.4)}
 *   radio       — V4/G51 (§B2.3): radioPlayer.getStats(): {playing, station,
 *                 trackId, t, duration, gain, radioGain, elementState,
 *                 shuffle, replaceContext, enabled, ducked[], context, queue,
 *                 allDisabled, started, transitions, errors}
 *   masterPeakDb — instantaneous post-limiter peak (dBFS; null pre-init/stub)
 */
export function getStats() {
  const medley = musicDirector.getStats();
  return {
    ...stats,
    ctxState: ctx?.state ?? 'uninitialized',
    loops: loops.size,
    pendingLoops: pendingLoops.size, // F3
    track: seq?.id ?? (medley.context ? `medley:${medley.context}` : null),
    // F3: live bus gains — headless proof that mute/unmute really lands
    gains: bus ? { sfx: bus.sfx.gain.value, music: bus.music.gain.value } : null,
    buses: bus
      ? {
          master: masterGain.gain.value,
          sfx: bus.sfx.gain.value,
          music: bus.music.gain.value,
          voice: bus.voice.gain.value,
          ambience: bus.ambience.gain.value,
        }
      : null,
    volumes: { ...slider },
    enabled: { ...enabled },
    samples: {
      cached: bufferCache.size,
      bytes: bufferCacheBytes,
      budgetBytes: SAMPLE_CACHE_BUDGET,
      // V3/FIX-B (E5 P2): how many of the live medley's jingles are resident
      pinned: [...(pinnedKeys() ?? [])].filter((k) => bufferCache.get(k)?.buffer != null).length,
    },
    medley,
    radio: radio.getStats(), // V4/G51 (§B2.3)
    masterPeakDb: masterPeakDb(),
  };
}

export default {
  init, play, music, getMusicTime, setVolume, stop, impact, getStats,
  preloadSamples, previewBus, volumeGain, sanitizeVolumes,
  // V4/G51: setLoopGain per §E0.1-16; `radio` exposes the §B2.3 engine
  // (start/stop/toggle/skip/setStation/setShuffle/setTrim/now/duck/
  // playContext/getTime/getStats) for G52's panel + the recap director.
  setLoopGain, radio,
};
