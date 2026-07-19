// GOOBY V4/G51 — the radio engine (PLAN4 §B2.3/§B2.4, §C-SYS1): MediaElement
// STREAMING into the music bus — NOT decoded buffers (binding: a 3-minute MP3
// decodes to ~60 MB PCM and must never enter the §B2.3-v3 6 MB LRU).
//
// Graph (wired by audio.js init(), deps injected — no import of audio.js):
//   HTMLAudioElement → ctx.createMediaElementSource(el) → trackGain →
//   radioGain → bus.music
// The element is created LAZILY on the first actual playback;
// createMediaElementSource is called exactly ONCE per element (reuse rule).
// Per-track effective gain = manifest.gainTrim × (trims[id].vol / 100) on
// trackGain (§B2.3); the music slider/mute ride the bus in audio.js. Track
// transitions: 300 ms linear fade-out on radioGain, swap el.src, fade-in
// 300 ms — gap ≤ 400 ms.
//
// API (§B2.3 — consumed by audio.js, G52's radio panel, the recap director):
//   start(stationId?) · stop() · toggle() · skip(dir?) · setStation(id) ·
//   setShuffle(on) · setTrim(id, {vol, on}) · now() → {id, trackId, title,
//   cover, station, t, duration} · duck(on, reason?) (recap/danceParty
//   exclusivity → pause + remember) · getTime() (el.currentTime — the §B5
//   recap beat clock) · getStats() (feeds audio.getStats().radio) ·
//   playContext(context, opts) (registry trackFor() playback — rooms/games/
//   locations; bedroom picks the Awake/Sleeping variant from sleep state) ·
//   attach(deps) / setEnabled(on) (audio.js only)
//
// Ownership & mute rules (§B2.4 — all binding):
//   · settings.music === false → element pause() + ZERO node creation (the
//     airtight v2 FIX-B rule extends verbatim; audio.js forwards the boolean
//     via setEnabled).
//   · While the radio is AUDIBLE and radio.replaceContext → musicDirector is
//     suppressed via its new setRadioActive(true) gate (same mechanics as the
//     danceParty setSuppressed). replaceContext=false → scene hooks call
//     duck() outside home (the §B2.4 contract for scene wiring).
//   · danceParty + the recap cinematic ALWAYS duck the radio (audio.music
//     ('dance') forwards; the recap director calls duck directly) and it
//     resumes afterwards.
//
// State persists in the save's radio.* slice (G53's schema — read/written
// DEFENSIVELY through the store: this module never imports core/save.js).
// Store events emitted (§B10): 'radioChanged' {playing, station, trackId} and
// 'radioTrackChanged' {id, trackId, title, cover, station, t, duration} (the
// §C-SYS1.8 now-playing chip contract; id === trackId — both spellings kept
// for G52's concurrent build).
//
// Pure queue math (level locks, per-track enable, seeded shuffle, trim math,
// §C-SYS1.5 all-disabled fallback) lives in systems/radioQueue.logic.js; the
// station/context tables live in systems/musicRegistry.js — this module is a
// thin element driver over both, node-testable via injected deps.

import { getStore } from '../core/store.js';
import {
  getStations, trackById, trackFor, coverFor, STATION_IDS,
} from '../systems/musicRegistry.js';
import {
  buildQueue, nextTrackId, effectiveGain, trimFor, hashStr,
} from '../systems/radioQueue.logic.js';
import musicDirector from './musicDirector.js';

const DEV = !!import.meta.env?.DEV;

/** §B2.3: track-transition fade on radioGain (s). */
export const FADE_SEC = 0.3;
/** §C-SYS1.2: the always-valid day-one station (save validate() coerces). */
export const DEFAULT_STATION = 'bordmusik';

// ---------------------------------------------------------------------------
// Module state (singleton — mirrors audio.js/musicDirector shape)
// ---------------------------------------------------------------------------

/** @type {{ctx: AudioContext, radioGain: GainNode, createElement?: () => HTMLAudioElement}|null} */
let deps = null;
/** @type {HTMLAudioElement|null} the ONE streaming element (lazy). */
let el = null;
/** @type {GainNode|null} per-track gain (manifest trim × user trim). */
let trackGain = null;
/** True once createMediaElementSource(el) succeeded (exactly-once rule). */
let elWired = false;
/** §C2.3 airtight gate — settings.music, forwarded by audio.js. */
let enabled = true;
/** The radio ON/OFF wish (radio.playing — persists across reloads). */
let playing = false;
/** @type {Set<string>} active duck reasons (danceParty/recap/scene hooks). */
const duckers = new Set();
let stationId = DEFAULT_STATION;
let shuffle = true;
let replaceContext = true;
/** @type {object|null} the current manifest track row */
let current = null;
/** Non-null while playContext() playback owns the element (context token). */
let contextToken = null;
/** §C-SYS1.5 flag of the LAST queue build (G52's one-time toast). */
let allDisabled = false;
/** Monotonic transition token — a newer transition cancels older timers. */
let transitionSeq = 0;
/** Diagnostics (getStats). */
const rstats = { started: 0, transitions: 0, errors: 0 };
/** @type {ReturnType<typeof setInterval>|null} radioMinutes accrual (§C-SYS1.7). */
let minuteTimer = null;
/** @type {object|null} cached store handle */
let storeRef = null;
let storeWired = false;

// ---------------------------------------------------------------------------
// Store plumbing (defensive — G53's radio.* schema may not exist yet)
// ---------------------------------------------------------------------------

function store() {
  if (storeRef) return storeRef;
  try {
    storeRef = getStore();
  } catch {
    storeRef = null; // headless/no-store contexts
  }
  return storeRef;
}

/** @returns {object} the persisted radio slice (possibly empty pre-G53). */
function radioSlice() {
  const r = store()?.get?.('radio');
  return r && typeof r === 'object' ? r : {};
}

/** Sparse persisted trims map (§B1). */
function trims() {
  const t = radioSlice().trims;
  return t && typeof t === 'object' ? t : {};
}

/** Write a radio.* patch, seeding defaults when the slice is missing. */
function persist(patch) {
  const s = store();
  if (!s?.update) return;
  s.update((state) => {
    state.radio = {
      station: DEFAULT_STATION,
      playing: false,
      shuffle: true,
      replaceContext: true,
      lastTrack: '',
      trims: {},
      ...(state.radio && typeof state.radio === 'object' ? state.radio : {}),
      ...patch,
    };
  });
}

/** Stable per-save shuffle seed (§B2.4: save seed × station). */
function saveSeed() {
  return hashStr(String(store()?.get?.('createdAt') ?? ''));
}

/** Player level for the queue's unlockLevel filter. */
function playerLevel() {
  const lvl = Number(store()?.get?.('level'));
  return Number.isFinite(lvl) && lvl >= 1 ? Math.trunc(lvl) : 1;
}

// ---------------------------------------------------------------------------
// Derived state + events
// ---------------------------------------------------------------------------

/** Radio wants sound AND nothing blocks it (mute/duck). */
function isAudible() {
  return playing && enabled && duckers.size === 0 && deps != null;
}

/** §B2.4: the musicDirector gate — radio audible + replaceContext. */
function applyDirectorGate() {
  musicDirector.setRadioActive?.(isAudible() && replaceContext && current != null);
}

/** §B10 'radioChanged' {playing, station, trackId}. */
function emitChanged() {
  store()?.emit?.('radioChanged', {
    playing: isAudible(),
    station: stationId,
    trackId: current?.id ?? null,
  });
}

/** §C-SYS1.8 'radioTrackChanged' — the now-playing chip contract. */
function emitTrackChanged(track) {
  store()?.emit?.('radioTrackChanged', {
    id: track.id,
    trackId: track.id,
    title: track.title,
    cover: coverFor(track, stationId), // path relative to /assets/ (§C-SYS1.6)
    station: stationId,
    t: 0,
    duration: track.durationSec,
  });
}

/** §C-SYS1.7: achievements.counters.radioMinutes accrues 1/min while playing
 * (guarded — the counter key lands with G53's save schema). */
function syncMinuteTimer() {
  const want = isAudible() && current != null;
  if (want && minuteTimer == null && typeof setInterval === 'function') {
    minuteTimer = setInterval(() => {
      if (!isAudible()) return;
      const s = store();
      if (!s?.update) return;
      s.update((state) => {
        const counters = state?.achievements?.counters;
        if (counters && typeof counters === 'object') {
          counters.radioMinutes = (Number(counters.radioMinutes) || 0) + 1;
        }
      });
    }, 60_000);
    minuteTimer.unref?.(); // node:test must not be held open by the accrual
  } else if (!want && minuteTimer != null) {
    clearInterval(minuteTimer);
    minuteTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Element chain (§B2.3 — lazy, createMediaElementSource exactly once)
// ---------------------------------------------------------------------------

/** URL of a manifest track file (paths are relative to /assets/). */
export function trackUrl(file) {
  const base = import.meta.env?.BASE_URL ?? '/';
  return encodeURI(`${base}assets/${file}`);
}

/** Create the ONE element + trackGain chain (null when no DOM/deps). */
function ensureElement() {
  if (el) return el;
  if (!deps?.ctx) return null;
  const make = deps.createElement
    ?? (typeof Audio !== 'undefined' ? () => new Audio() : null);
  if (!make) return null;
  el = make();
  el.preload = 'auto';
  el.addEventListener?.('ended', onEnded);
  el.addEventListener?.('error', () => {
    rstats.errors += 1;
    if (current && isAudible() && !contextToken) {
      console.warn(`[radio] element error on '${current.id}' — skipping`);
      skip(1);
    }
  });
  trackGain = deps.ctx.createGain();
  trackGain.gain.value = 1;
  try {
    // Exactly once per element (§B2.3 reuse rule) — never re-wrapped.
    const src = deps.ctx.createMediaElementSource(el);
    src.connect(trackGain);
    elWired = true;
  } catch (err) {
    // Stub contexts (tests) have no createMediaElementSource — the element
    // then plays outside the graph; trims still tracked on trackGain.
    if (DEV) console.warn('[radio] createMediaElementSource unavailable:', err?.message);
  }
  trackGain.connect(deps.radioGain);
  return el;
}

/** 300 ms linear radioGain fade (anchored — same recipe as audio.js ramp). */
function fadeRadio(dir, dur = FADE_SEC) {
  if (!deps) return;
  const g = deps.radioGain.gain;
  const t = deps.ctx.currentTime;
  const to = dir === 'in' ? 1 : 0.0001;
  try {
    g.cancelScheduledValues?.(t);
    g.setValueAtTime?.(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime?.(to, t + dur);
  } catch {
    try {
      g.value = to;
    } catch { /* param stubs */ }
  }
}

/** Apply the §B2.3 per-track gain: manifest.gainTrim × (trims[id].vol/100). */
function applyTrackGain() {
  if (!trackGain || !current) return;
  const target = effectiveGain(current, trims());
  try {
    trackGain.gain.setTargetAtTime?.(target, deps.ctx.currentTime, 0.03);
  } catch { /* stubs */ }
  try {
    if (typeof trackGain.gain.setTargetAtTime !== 'function') trackGain.gain.value = target;
  } catch { /* stubs */ }
}

/**
 * Swap the element to `track` with the §B2.3 fade choreography. `loop` is
 * true for context playback (room/game themes repeat until stopped).
 * @param {object} track manifest row
 * @param {{loop?: boolean}} [opts]
 */
function playTrackNow(track, opts = {}) {
  const element = ensureElement();
  if (!element) return;
  const seq = ++transitionSeq;
  const hadAudio = !element.paused && !!element.src;
  const swap = () => {
    if (seq !== transitionSeq) return; // a newer transition superseded this one
    current = track;
    applyTrackGain();
    element.loop = !!opts.loop;
    element.src = trackUrl(track.file);
    const p = element.play?.();
    p?.catch?.((err) => {
      rstats.errors += 1;
      if (DEV) console.warn(`[radio] play() rejected for '${track.id}':`, err?.message);
    });
    fadeRadio('in');
    rstats.started += 1;
    persist({ lastTrack: track.id });
    emitTrackChanged(track);
    emitChanged();
    applyDirectorGate();
    syncMinuteTimer();
    if (DEV) console.debug(`[radio] ▶ ${track.id} (${stationId}${contextToken ? ` · context ${contextToken}` : ''})`);
  };
  rstats.transitions += 1;
  if (hadAudio && typeof setTimeout === 'function') {
    fadeRadio('out');
    setTimeout(swap, FADE_SEC * 1000); // gap ≤ 400 ms (§B2.3)
  } else {
    swap();
  }
}

/** Element 'ended': stations advance the queue; context tracks loop natively. */
function onEnded() {
  if (!isAudible() || contextToken) return;
  skip(1);
}

// ---------------------------------------------------------------------------
// Queue (pure math in radioQueue.logic.js)
// ---------------------------------------------------------------------------

/** The current station row (falls back to the first non-empty station). */
function stationRow() {
  const stations = getStations();
  return stations.find((s) => s.id === stationId) ?? stations[0] ?? null;
}

/** Playable queue ids of the current station (level+enable filtered). */
function stationQueue() {
  const row = stationRow();
  if (!row) {
    allDisabled = false;
    return [];
  }
  const tracks = row.trackIds.map((id) => trackById(id)).filter(Boolean);
  const q = buildQueue(tracks, {
    level: playerLevel(),
    trims: trims(),
    shuffle,
    seed: saveSeed(),
    stationId: row.id,
  });
  allDisabled = q.allDisabled;
  return q.ids;
}

// ---------------------------------------------------------------------------
// Public API (§B2.3)
// ---------------------------------------------------------------------------

/**
 * Turn the radio on (optionally switching station first). Resumes
 * radio.lastTrack when it is still in the queue (§C-SYS1.3 — position
 * restarts), else starts at the queue head. Safe pre-attach / while muted:
 * the wish persists and playback starts when unblocked.
 * @param {string} [id] station id (§C-SYS1.2)
 */
export function start(id) {
  if (id != null) {
    if (!STATION_IDS.includes(id)) {
      if (DEV) console.warn(`[radio] unknown station '${id}' — keeping '${stationId}'`);
    } else {
      stationId = id;
    }
  }
  playing = true;
  contextToken = null;
  persist({ playing: true, station: stationId });
  if (!isAudible()) {
    emitChanged();
    applyDirectorGate();
    return;
  }
  const queue = stationQueue();
  if (queue.length === 0) {
    if (DEV) console.warn(`[radio] station '${stationId}' has no playable tracks`);
    emitChanged();
    return;
  }
  const last = current?.id ?? String(radioSlice().lastTrack ?? '');
  const nextId = queue.includes(last) ? last : queue[0];
  playTrackNow(trackById(nextId));
}

/** Turn the radio off (fade out + pause; the wish persists as false). */
export function stop() {
  playing = false;
  contextToken = null;
  persist({ playing: false });
  if (el && !el.paused) {
    fadeRadio('out');
    const seq = ++transitionSeq;
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        if (seq === transitionSeq && el) el.pause?.();
      }, FADE_SEC * 1000);
    } else {
      el.pause?.();
    }
  }
  applyDirectorGate();
  emitChanged();
  syncMinuteTimer();
}

/** Play/pause toggle (the panel's ⏯). */
export function toggle() {
  if (playing) stop();
  else start();
}

/**
 * Step the station queue (⏭). dir −1 steps back. While blocked (muted/
 * ducked) only the queue position moves.
 * @param {1|-1} [dir]
 */
export function skip(dir = 1) {
  contextToken = null;
  const queue = stationQueue();
  if (queue.length === 0) return;
  const nextId = nextTrackId(queue, current?.id ?? radioSlice().lastTrack, dir);
  if (!nextId) return;
  if (isAudible() && playing) {
    playTrackNow(trackById(nextId));
  } else {
    current = trackById(nextId);
    persist({ lastTrack: nextId });
    emitChanged();
  }
}

/**
 * Switch station (§C-SYS1.2 id). While playing the new station starts
 * immediately (resuming its remembered queue position when possible).
 * @param {string} id
 */
export function setStation(id) {
  if (!STATION_IDS.includes(id)) {
    if (DEV) console.warn(`[radio] unknown station '${id}' — ignored`);
    return;
  }
  if (id === stationId) return;
  stationId = id;
  persist({ station: id });
  if (playing && isAudible()) {
    contextToken = null;
    const queue = stationQueue();
    if (queue.length > 0) playTrackNow(trackById(queue[0]));
  }
  emitChanged();
}

/** §B2.4: seeded-shuffle toggle (order is stable per save+station). */
export function setShuffle(on) {
  shuffle = !!on;
  persist({ shuffle });
}

/**
 * §C-SYS1.5 per-track trim: {vol 0–150 step 5, on boolean} — persisted
 * sparsely in radio.trims; the live track's gain updates immediately.
 * @param {string} id track id
 * @param {{vol?: number, on?: boolean}} patch
 */
export function setTrim(id, patch = {}) {
  if (!id) return;
  const s = store();
  if (s?.update) {
    s.update((state) => {
      state.radio = {
        station: DEFAULT_STATION, playing: false, shuffle: true,
        replaceContext: true, lastTrack: '', trims: {},
        ...(state.radio && typeof state.radio === 'object' ? state.radio : {}),
      };
      const map = state.radio.trims && typeof state.radio.trims === 'object'
        ? { ...state.radio.trims } : {};
      map[id] = { ...trimFor(map, id), ...patch };
      state.radio.trims = map;
    });
  }
  if (current?.id === id) applyTrackGain();
  // A disabled current track keeps playing to its end (§C-SYS1.5 queues skip
  // it on the NEXT step) — no hard cut mid-listen.
}

/** §C-SYS1.3: the „Radio ersetzt Szenen-Musik" toggle (radio.replaceContext). */
export function setReplaceContext(on) {
  replaceContext = !!on;
  persist({ replaceContext });
  applyDirectorGate();
}

/**
 * Recap/danceParty exclusivity + scene hooks (§B2.4): duck(true) pauses the
 * element and remembers; duck(false) resumes when the radio still wants to
 * play. Reasons stack — everyducker must clear its own.
 * @param {boolean} on
 * @param {string} [reason]
 */
export function duck(on, reason = 'duck') {
  const was = isAudible();
  if (on) duckers.add(reason);
  else duckers.delete(reason);
  if (was && !isAudible()) {
    el?.pause?.();
  } else if (!was && isAudible() && playing) {
    if (current && el?.src) {
      const p = el.play?.();
      p?.catch?.(() => {});
      fadeRadio('in');
    } else {
      start();
    }
  }
  applyDirectorGate();
  emitChanged();
  syncMinuteTimer();
}

/**
 * Registry-context playback (the trackFor() consumer path): plays the REAL
 * music track behind a room/game/location context through the radio chain,
 * looped. 'room:bedroom' defaults its Awake/Sleeping variant from the live
 * sleep state (opts.sleeping overrides).
 * @param {string} context 'room:<id>'|'game:<id>'|'location:<id>'|'arcade'
 *   or a musicDirector alias ('home'|'garden'|'city'|'shop'|'vet')
 * @param {{sleeping?: boolean}} [opts]
 * @returns {object|null} the manifest track now playing (null = no such
 *   track — callers keep the §B2.4-v3 jingle medley)
 */
export function playContext(context, opts = {}) {
  const sleeping = opts.sleeping ?? store()?.get?.('sleep')?.sleeping === true;
  const track = trackFor(context, { sleeping });
  if (!track) return null;
  playing = true;
  contextToken = String(context);
  if (!isAudible()) {
    emitChanged();
    return track;
  }
  if (current?.id !== track.id || el?.paused !== false) {
    playTrackNow(track, { loop: true });
  }
  return track;
}

/** @returns {object|null} §B2.3 now-playing metadata (G52's chip/panel) */
export function now() {
  if (!current) return null;
  return {
    id: current.id,
    trackId: current.id,
    title: current.title,
    cover: coverFor(current, stationId),
    station: stationId,
    t: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
    duration: current.durationSec,
  };
}

/** @returns {number|null} el.currentTime — the §B5 recap beat clock */
export function getTime() {
  if (!el || !current || el.paused) return null;
  return Number.isFinite(el.currentTime) ? el.currentTime : null;
}

/** Diagnostics — audio.getStats().radio (§B2.3 shape + G51 extensions). */
export function getStats() {
  return {
    playing: isAudible() && current != null,
    wantPlaying: playing,
    station: stationId,
    trackId: current?.id ?? null,
    t: el && Number.isFinite(el.currentTime) ? Math.round(el.currentTime * 10) / 10 : 0,
    duration: current?.durationSec ?? 0,
    gain: trackGain ? Math.round(trackGain.gain.value * 1000) / 1000 : null,
    radioGain: deps ? Math.round(deps.radioGain.gain.value * 1000) / 1000 : null,
    elementState: el ? (el.paused ? 'paused' : 'playing') : 'none',
    elementWired: elWired,
    shuffle,
    replaceContext,
    enabled,
    ducked: [...duckers],
    context: contextToken,
    queue: stationQueue().length,
    allDisabled,
    ...rstats,
  };
}

// ---------------------------------------------------------------------------
// audio.js wiring (attach + the airtight mute forward)
// ---------------------------------------------------------------------------

/**
 * Wire the engine to the live audio graph — audio.js init() only.
 * Loads the persisted radio.* wish and auto-resumes playback (init runs on
 * the first user gesture, so el.play() is allowed).
 * @param {{ctx: AudioContext, radioGain: GainNode,
 *   createElement?: () => HTMLAudioElement}} d
 */
export function attach(d) {
  deps = d;
  const slice = radioSlice();
  stationId = STATION_IDS.includes(slice.station) ? slice.station : DEFAULT_STATION;
  shuffle = slice.shuffle !== false;
  replaceContext = slice.replaceContext !== false;
  playing = slice.playing === true;
  if (!storeWired) {
    const s = store();
    if (s?.on) {
      storeWired = true;
      s.on('change', (state) => {
        const r = state?.radio;
        if (!r || typeof r !== 'object') return;
        // Live-follow the toggles G52's panel writes straight to the store.
        const rc = r.replaceContext !== false;
        if (rc !== replaceContext) {
          replaceContext = rc;
          applyDirectorGate();
        }
        shuffle = r.shuffle !== false;
        applyTrackGain(); // §C-SYS1.5 trim slider drags apply live
      });
    }
  }
  if (playing && isAudible()) start();
  else applyDirectorGate();
}

/** §C2.3 airtight mute — settings.music, forwarded by audio.js. */
export function setEnabled(on) {
  const next = !!on;
  if (next === enabled) return;
  const was = isAudible();
  enabled = next;
  if (was && !isAudible()) {
    el?.pause?.(); // paused element streams nothing; ZERO nodes created
  } else if (!was && isAudible() && playing) {
    if (current && el?.src) {
      const p = el.play?.();
      p?.catch?.(() => {});
      fadeRadio('in');
    } else {
      start();
    }
  }
  applyDirectorGate();
  syncMinuteTimer();
}

/** Full teardown (tests / hot-reload safety). */
export function reset() {
  transitionSeq += 1;
  el?.pause?.();
  playing = false;
  current = null;
  contextToken = null;
  duckers.clear();
  stationId = DEFAULT_STATION;
  shuffle = true;
  replaceContext = true;
  allDisabled = false;
  if (minuteTimer != null) {
    clearInterval(minuteTimer);
    minuteTimer = null;
  }
  applyDirectorGate();
}

export default {
  FADE_SEC, DEFAULT_STATION,
  start, stop, toggle, skip, setStation, setShuffle, setTrim,
  setReplaceContext, duck, playContext, now, getTime, getStats,
  attach, setEnabled, reset, trackUrl,
};
