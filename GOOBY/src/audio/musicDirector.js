// Music director — V3/G32 (PLAN3 §B2.4/§C3.3): file-based jingle MEDLEYS as
// the per-context background music. Kenney's 85 music-jingles are 0.3–1.8 s
// one-shot phrases (not loopable tracks), so each context plays a sparse
// "music-box medley": a fixed 3.2 s bar grid where every bar either plays ONE
// jingle (AudioBufferSourceNode with 150 ms equal-power edge fades) or rests;
// 16-bar phrases (51.2 s) loop with a seeded reshuffle (mulberry32; jingles
// permute, RESTS NEVER MOVE, no jingle repeats within 8 bars — incl. across
// the phrase seam). Under it a glue bed — the only oscillator allowed in
// medley playback — plays one soft bass sine note per bar downbeat at
// −26 dBFS (0.8 s decay, root note per context).
//
// Contexts (§C3.3): 'home' (Pizzicato/C2) · 'garden' (Steel/G2) · 'arcade'
// (NES/A2) · 'city' (Sax/F2) · 'shop' (Pizzicato+Steel mix/D2).
// setContext(ctx|null) crossfades 800 ms; scene/room hooks call it
// (roomManager → home/garden, arcadeScreen → arcade, cityDrive → city,
// shopScreen → shop). Screens layer via pushContext/popContext so closing an
// overlay falls back to the scene's base context.
//
// Ownership: audio.js attaches this module on init (attach() injects the
// AudioContext, the music-bus destination and the §B2.3 buffer cache) and
// forwards the mute/enable state. AIRTIGHT MUTE (§C2.3, v2 FIX-B rule): while
// settings.music === false (or danceParty's synth sequencer is running) the
// scheduler is torn down — ZERO source nodes are created. Slider volume rides
// the music bus in audio.js; this module never touches bus gains.
//
// No imports from audio.js (deps injected) — pure enough for node:test to
// drive the schedule math and the composition tables headlessly.

const DEV = !!import.meta.env?.DEV;

// ---------------------------------------------------------------------------
// §B2.4/§C3.3 frozen design numbers
// ---------------------------------------------------------------------------

/** Bar length (s) — the medley grid (§B2.4). */
export const BAR_SEC = 3.2;
/** Bars per phrase (§B2.4). */
export const PHRASE_BARS = 16;
/** Jingle edge fade (s) — 150 ms equal-power (§B2.4). */
export const XFADE_SEC = 0.15;
/** Context switch crossfade (s) — 800 ms (§B2.4). */
export const CONTEXT_FADE_SEC = 0.8;
/** Glue bed peak level: −26 dBFS (§B2.4). */
export const BED_LEVEL = 10 ** (-26 / 20);
/** Glue bed decay (s). */
export const BED_DECAY_SEC = 0.8;
/** No-repeat window (bars) for the seeded reshuffle (§B2.4). */
export const NO_REPEAT_BARS = 8;
/** Scheduler tick / lookahead (same pattern as audio.js's sequencer). */
const TICK_MS = 200;
const LOOKAHEAD_SEC = 0.6;
/** V3/FIX-B (E5 P1): a bar this late is STALE — skip it instead of retro-
 * scheduling. 0.5 s still admits the normal slightly-late paths (the first
 * bar lands ~0.1 s behind the first tick; background-tab timer throttling
 * runs ≤ ~0.4 s behind), while real stalls (≥ ~1.5 s) fast-forward. */
const STALE_BAR_GRACE_SEC = 0.5;

/** @param {string} n @returns {string} full asset key of a jingle file */
const J = (n) => `music-jingles/jingles_${n}`;

/**
 * Per-family playback gain — §B2.5 trim of each jingle family's mean RMS
 * (src/audio/loudness.json) to the −18 dBFS jingle target: NES −14.5,
 * HIT −16.1, PIZZI −15.8, STEEL −16.5, SAX −20.6 dBFS (SAX boost clamped).
 * @type {Readonly<Record<string, number>>}
 */
export const FAMILY_GAIN = Object.freeze({
  NES: 0.67, HIT: 0.8, PIZZI: 0.78, SAX: 1.2, STEEL: 0.84,
});

/**
 * §C3.3 composition tables — 16 bars each, `null` = rest bar (R). The listed
 * order is phrase 0; later phrases reshuffle the jingles over the same slots.
 * `root` is the glue-bed bass note (Hz).
 * @type {Readonly<Record<string, {root: number, bars: ReadonlyArray<string|null>}>>}
 */
export const MEDLEY = Object.freeze({
  home: Object.freeze({
    root: 65.41, // C2
    bars: Object.freeze([
      J('PIZZI01'), null, J('PIZZI03'), J('PIZZI07'), null, J('PIZZI12'), J('PIZZI02'), null,
      J('PIZZI13'), J('PIZZI10'), null, J('PIZZI14'), J('PIZZI05'), null, J('PIZZI15'), null,
    ]),
  }),
  garden: Object.freeze({
    root: 98.0, // G2
    bars: Object.freeze([
      J('STEEL00'), J('STEEL04'), null, J('STEEL10'), null, J('STEEL05'), J('STEEL15'), null,
      J('STEEL16'), J('STEEL08'), null, J('STEEL11'), null, J('STEEL13'), J('STEEL02'), null,
    ]),
  }),
  arcade: Object.freeze({
    root: 110.0, // A2
    bars: Object.freeze([
      J('NES00'), null, J('NES06'), J('NES07'), null, J('NES12'), J('NES05'), null,
      J('NES13'), J('NES11'), null, J('NES16'), null, J('NES08'), J('NES03'), null,
    ]),
  }),
  city: Object.freeze({
    root: 87.31, // F2
    bars: Object.freeze([
      J('SAX07'), null, J('SAX01'), J('SAX12'), null, J('SAX02'), J('SAX13'), null,
      J('SAX03'), null, J('SAX14'), J('SAX15'), null, J('SAX10'), J('SAX11'), null,
    ]),
  }),
  shop: Object.freeze({
    root: 73.42, // D2
    bars: Object.freeze([
      J('PIZZI00'), J('STEEL09'), null, J('PIZZI09'), J('STEEL12'), null, J('PIZZI16'), null,
      J('STEEL01'), J('PIZZI06'), null, J('STEEL06'), null, J('PIZZI11'), J('STEEL14'), null,
    ]),
  }),
});

/** @type {string[]} the valid context ids */
export const MEDLEY_CONTEXTS = Object.freeze(Object.keys(MEDLEY));

// ---------------------------------------------------------------------------
// Seeded phrase shuffle (pure — tested headlessly)
// ---------------------------------------------------------------------------

/** mulberry32 — same generator family as audio.js/danceParty (§E8). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable tiny hash of the context id → per-context seed offset. */
function hashCtx(context) {
  let h = 0;
  for (let i = 0; i < context.length; i += 1) h = (h * 31 + context.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Base seed of the medley shuffle (frozen design number, §B2.4). */
export const MEDLEY_SEED = 32_2026;

/**
 * Does `order` violate the no-repeat-within-8-bars rule against the previous
 * phrase's tail (all jingles within one phrase are distinct by construction)?
 * @param {ReadonlyArray<string|null>} prev @param {ReadonlyArray<string|null>} order
 */
function seamViolates(prev, order) {
  if (!prev) return false;
  for (let p = 0; p < order.length; p += 1) {
    const key = order[p];
    if (!key) continue;
    for (let q = 0; q < prev.length; q += 1) {
      if (prev[q] === key && p + PHRASE_BARS - q < NO_REPEAT_BARS) return true;
    }
  }
  return false;
}

/**
 * The 16-bar schedule of a phrase (§B2.4): phrase 0 is the §C3.3 table order;
 * every later phrase is a deterministic mulberry32 Fisher-Yates permutation of
 * the JINGLES over the same slots — rest bars never move — re-rolled (up to 32
 * deterministic attempts) until no jingle repeats within 8 bars across the
 * seam with the previous phrase. Pure: same (context, phraseIndex) → same bars.
 * @param {string} context one of MEDLEY_CONTEXTS
 * @param {number} phraseIndex 0-based
 * @returns {Array<string|null>} 16 entries — jingle asset key or null (rest)
 */
export function phraseBars(context, phraseIndex) {
  const def = MEDLEY[context];
  if (!def) throw new Error(`[musicDirector] unknown context '${context}'`);
  let prev = null;
  let bars = [...def.bars];
  for (let n = 1; n <= phraseIndex; n += 1) {
    const rng = mulberry32((MEDLEY_SEED ^ hashCtx(context)) + n * 101);
    const slots = [];
    const pool = [];
    for (let i = 0; i < def.bars.length; i += 1) {
      if (def.bars[i] != null) {
        slots.push(i);
        pool.push(def.bars[i]);
      }
    }
    prev = bars;
    let attempt = pool;
    for (let tries = 0; tries < 32; tries += 1) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      attempt = shuffled;
      const candidate = [...def.bars];
      slots.forEach((slot, i) => {
        candidate[slot] = shuffled[i];
      });
      if (!seamViolates(prev, candidate)) {
        attempt = candidate;
        break;
      }
      attempt = candidate; // deterministic last-resort if every try seams
    }
    bars = Array.isArray(attempt) && attempt.length === PHRASE_BARS ? attempt : [...def.bars];
  }
  return bars;
}

// ---------------------------------------------------------------------------
// Equal-power fades
// ---------------------------------------------------------------------------

const FADE_STEPS = 17;
const FADE_IN_CURVE = new Float32Array(FADE_STEPS);
const FADE_OUT_CURVE = new Float32Array(FADE_STEPS);
for (let i = 0; i < FADE_STEPS; i += 1) {
  const t = i / (FADE_STEPS - 1);
  FADE_IN_CURVE[i] = Math.sin((t * Math.PI) / 2);
  FADE_OUT_CURVE[i] = Math.cos((t * Math.PI) / 2);
}

/**
 * Equal-power fade on a gain AudioParam (linear-ramp fallback for stubs).
 * V3/FIX-B (E5 P1): the fallback can never re-throw. Chrome clamps past-time
 * param events to currentTime, so after a main-thread stall two curves could
 * land on the same clamped instant and setValueCurveAtTime throws
 * NotSupportedError; the old bare setValueAtTime fallback then hit the SAME
 * overlapping curve and re-threw UNCAUGHT (the observed 36-exception cascade).
 * Now the fallback re-anchors with cancelScheduledValues first and is fully
 * try/caught — worst case it pins the endpoint value directly.
 */
function fade(param, dir, at, dur, scale = 1) {
  const from = dir === 'in' ? 0.0001 : scale;
  const to = dir === 'in' ? scale : 0.0001;
  try {
    const curve = new Float32Array(FADE_STEPS);
    const src = dir === 'in' ? FADE_IN_CURVE : FADE_OUT_CURVE;
    for (let i = 0; i < FADE_STEPS; i += 1) curve[i] = Math.max(0.0001, src[i] * scale);
    param.setValueCurveAtTime(curve, at, dur);
  } catch {
    try {
      param.cancelScheduledValues?.(at); // wipe the overlapping tail…
      param.setValueAtTime?.(from, at); // …anchor…
      param.linearRampToValueAtTime?.(to, at + dur); // …then ramp
    } catch {
      try {
        param.value = to; // last resort: land the endpoint, no timeline
      } catch { /* param stubs */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Director state (module singleton — mirrors audio.js's singleton shape)
// ---------------------------------------------------------------------------

/** Injected by audio.js attach(): the live WebAudio deps. */
let deps = null; // { ctx, dest, loadBuffer, getCachedBuffer }
/** §C2.3 airtight gate (settings.music boolean, forwarded by audio.js). */
let enabled = true;
/** True while the danceParty synth sequencer owns the music bus (§C3.4). */
let suppressed = false;
/** Base (scene-level) context — setContext(). */
let baseCtx = null;
/** Overlay stack (arcade/shop screens) — pushContext/popContext. */
let overlays = [];
/** @type {object|null} the live medley player */
let player = null;
/** Diagnostics: total bars/jingles scheduled since attach (getStats).
 * V3/FIX-B (E5 P1): + barsSkipped — bars fast-forwarded past after a stall. */
const dstats = { barsScheduled: 0, jinglesScheduled: 0, contextSwitches: 0, barsSkipped: 0 };

/** @returns {string|null} the context that SHOULD be audible right now */
function effectiveContext() {
  const want = overlays.length > 0 ? overlays[overlays.length - 1] : baseCtx;
  return want && MEDLEY[want] ? want : null;
}

/** family gain for a jingle key (see FAMILY_GAIN). */
function familyGain(key) {
  const m = /jingles_([A-Z]+)\d+$/.exec(key);
  return (m && FAMILY_GAIN[m[1]]) || 0.8;
}

/** Schedule one bar of `p` at p.nextBarAt: glue-bed note + jingle (or rest). */
function scheduleBar(p) {
  const { ctx } = deps;
  const t = p.nextBarAt;
  const slot = p.bar % PHRASE_BARS;
  // V3/FIX-B (E5 P1): DERIVE the phrase from the bar counter instead of
  // incrementing on slot 0 — stall recovery skips bars (possibly across a
  // phrase seam), so the old ++-on-slot-0 scheme desynced the reshuffle table.
  const phrase = Math.floor(p.bar / PHRASE_BARS);
  if (phrase !== p.phrase) {
    p.phrase = phrase;
    p.bars = phraseBars(p.context, phrase);
    if (DEV) console.debug(`[medley] ${p.context} phrase ${p.phrase} reshuffled`);
  }
  // Glue bed (§B2.4): one soft bass sine per downbeat, −26 dBFS, 0.8 s decay.
  const bed = ctx.createOscillator();
  bed.type = 'sine';
  bed.frequency.value = MEDLEY[p.context].root;
  const bedG = ctx.createGain();
  bedG.gain.setValueAtTime(0.0001, t);
  bedG.gain.exponentialRampToValueAtTime(BED_LEVEL, t + 0.02);
  bedG.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + BED_DECAY_SEC);
  bed.connect(bedG).connect(p.gain);
  bed.start(t);
  bed.stop(t + BED_DECAY_SEC + 0.1);
  // Jingle (or rest)
  const key = p.bars[slot];
  if (key) {
    const buf = deps.getCachedBuffer(key);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      const scale = familyGain(key);
      const dur = Number(buf.duration) || 1;
      fade(g.gain, 'in', t, XFADE_SEC, scale); // §B2.4: 150 ms equal-power edges
      if (dur > XFADE_SEC * 2.5) fade(g.gain, 'out', t + dur - XFADE_SEC, XFADE_SEC, scale);
      src.connect(g).connect(p.gain);
      src.start(t);
      const endAt = t + dur + 0.05;
      p.sources.add(src);
      src.onended = () => {
        p.sources.delete(src);
        try {
          g.disconnect();
        } catch { /* already gone */ }
      };
      src.stop(endAt);
      dstats.jinglesScheduled += 1;
    } else {
      deps.loadBuffer(key); // warm the §B2.3 cache — the reshuffle brings it back
    }
    if (DEV) console.debug(`[medley] ${p.context} bar ${p.bar} → ${key.split('/')[1]}${buf ? '' : ' (buffer warming — skipped)'} @${t.toFixed(2)}`);
  } else if (DEV) {
    console.debug(`[medley] ${p.context} bar ${p.bar} → R @${t.toFixed(2)}`);
  }
  p.schedule.push({ bar: p.bar, key: key ? key.split('/')[1] : 'R', at: Math.round(t * 100) / 100 });
  if (p.schedule.length > 24) p.schedule.shift();
  dstats.barsScheduled += 1;
  p.bar += 1;
  p.nextBarAt += BAR_SEC;
}

/** Start the medley player for a context (assumes deps + enabled). */
function startPlayer(context) {
  const { ctx, dest } = deps;
  // Warm every jingle of the context into the decoded-buffer cache (§B2.3).
  for (const key of MEDLEY[context].bars) {
    if (key) deps.loadBuffer(key);
  }
  const gain = ctx.createGain();
  gain.connect(dest);
  const startAt = ctx.currentTime + 0.1;
  fade(gain.gain, 'in', ctx.currentTime, CONTEXT_FADE_SEC); // §B2.4: 800 ms in
  const p = {
    context,
    gain,
    startAt,
    nextBarAt: startAt,
    bar: 0,
    phrase: 0,
    bars: phraseBars(context, 0),
    sources: new Set(),
    schedule: [],
    timer: null,
  };
  p.timer = setInterval(() => {
    if (!deps || player !== p) return;
    const now = deps.ctx.currentTime;
    // V3/FIX-B (E5 P1): if the main thread stalled (asset preload, shader
    // compile…) the grid fell behind — FAST-FORWARD past `now`, skipping the
    // missed bars, and NEVER retro-schedule them. Chrome clamps past-time
    // param events to the same instant, which stacked the out/in fade curves
    // into a NotSupportedError cascade and re-created the stuck bar's nodes
    // every 200 ms tick until the next context switch.
    if (p.nextBarAt < now - STALE_BAR_GRACE_SEC) {
      const missed = Math.ceil((now - p.nextBarAt) / BAR_SEC);
      p.bar += missed;
      p.nextBarAt += missed * BAR_SEC;
      dstats.barsSkipped += missed;
      if (DEV) console.debug(`[medley] ${p.context} stall recovery — skipped ${missed} bar(s) → bar ${p.bar} @${p.nextBarAt.toFixed(2)}`);
    }
    while (p.nextBarAt < now + LOOKAHEAD_SEC) scheduleBar(p);
  }, TICK_MS);
  player = p;
  dstats.contextSwitches += 1;
  if (DEV) console.debug(`[medley] context '${context}' started @${startAt.toFixed(2)} (bed ${MEDLEY[context].root} Hz)`);
}

/** Stop the live player: clear the scheduler NOW, fade out, then kill sources. */
function stopPlayer(fadeSec = CONTEXT_FADE_SEC) {
  const p = player;
  if (!p) return;
  player = null; // scheduler guard — zero new nodes from this instant (§C2.3)
  clearInterval(p.timer);
  const { ctx } = deps ?? {};
  if (!ctx) return;
  try {
    fade(p.gain.gain, 'out', ctx.currentTime, Math.max(0.05, fadeSec));
  } catch { /* param stubs */ }
  const kill = () => {
    for (const src of [...p.sources]) {
      try {
        src.stop();
      } catch { /* already stopped */ }
    }
    p.sources.clear();
    try {
      p.gain.disconnect();
    } catch { /* already gone */ }
  };
  if (typeof setTimeout === 'function') setTimeout(kill, Math.max(0.05, fadeSec) * 1000 + 120);
  else kill();
}

/** Reconcile the live player with the wanted context (the single decider). */
function apply(fadeSec = CONTEXT_FADE_SEC) {
  const want = !deps || !enabled || suppressed ? null : effectiveContext();
  if (player?.context === want) return;
  if (player) stopPlayer(fadeSec);
  if (want) startPlayer(want);
}

// ---------------------------------------------------------------------------
// Public API (consumed by audio.js + the §B2.4 scene/room/screen hooks)
// ---------------------------------------------------------------------------

/**
 * Wire the director to the live audio graph (audio.js init()).
 * @param {{ctx: AudioContext, dest: AudioNode,
 *   loadBuffer: (key: string) => Promise<AudioBuffer|null>,
 *   getCachedBuffer: (key: string) => AudioBuffer|null}} d
 */
export function attach(d) {
  deps = d;
  apply();
}

/** §C2.3 airtight mute — forwarded from settings.music by audio.js. */
export function setEnabled(on) {
  enabled = !!on;
  apply(enabled ? CONTEXT_FADE_SEC : 0.05);
}

/** §C3.4: true while the danceParty synth sequencer owns the music bus. */
export function setSuppressed(on) {
  suppressed = !!on;
  apply(suppressed ? 0.2 : CONTEXT_FADE_SEC);
}

/**
 * §B2.4 contract: set the scene-level medley context (crossfades 800 ms).
 * 'home'|'garden'|'arcade'|'city'|'shop'|null — null stops the medley.
 * Safe pre-init and while muted (the wish is remembered, zero nodes made).
 * @param {string|null} context
 */
export function setContext(context) {
  if (context != null && !MEDLEY[context]) {
    if (DEV) console.warn(`[musicDirector] unknown context '${context}' — ignored`);
    return;
  }
  baseCtx = context;
  apply();
}

/**
 * Overlay a context while a screen is open (arcade/shop). Falls back to the
 * base context on popContext — push/pop must be paired by the same tag.
 * @param {string} context
 */
export function pushContext(context) {
  if (!MEDLEY[context]) return;
  overlays.push(context);
  apply();
}

/** @param {string} context pops the topmost matching overlay (no-op if gone) */
export function popContext(context) {
  const i = overlays.lastIndexOf(context);
  if (i >= 0) overlays.splice(i, 1);
  apply();
}

/** @returns {string|null} the audible medley context (null when silent) */
export function activeContext() {
  return player?.context ?? null;
}

/** @returns {number|null} seconds since the live medley started (audio clock) */
export function getTime() {
  if (!player || !deps) return null;
  return deps.ctx.currentTime - player.startAt;
}

/** Diagnostics for audio.getStats() (§C4.2 overlay + eval evidence). */
export function getStats() {
  return {
    context: player?.context ?? null,
    wantContext: effectiveContext(),
    base: baseCtx,
    overlays: [...overlays],
    enabled,
    suppressed,
    bar: player?.bar ?? 0,
    phrase: player?.phrase ?? 0,
    sourcesLive: player?.sources.size ?? 0,
    nextBarAt: player ? Math.round(player.nextBarAt * 100) / 100 : null,
    schedule: player ? [...player.schedule] : [],
    ...dstats,
  };
}

/**
 * §C2.2 music-slider preview: one ~0.5 s jingle of the effective (or home)
 * context straight onto the music bus. Airtight: no nodes while muted.
 */
export function previewJingle() {
  if (!deps || !enabled) return;
  const context = effectiveContext() ?? 'home';
  const key = MEDLEY[context].bars.find((k) => k != null);
  const { ctx, dest } = deps;
  deps.loadBuffer(key).then((buf) => {
    if (!buf || !deps || !enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const scale = familyGain(key);
    const t = ctx.currentTime;
    const dur = Math.min(0.5, Number(buf.duration) || 0.5);
    fade(g.gain, 'in', t, 0.03, scale);
    fade(g.gain, 'out', t + dur - 0.1, 0.1, scale);
    src.connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
    src.onended = () => {
      try {
        g.disconnect();
      } catch { /* already gone */ }
    };
  });
}

/** Full teardown (tests / hot-reload safety): stop + forget every wish. */
export function reset() {
  stopPlayer(0.05);
  baseCtx = null;
  overlays = [];
  suppressed = false;
}

export default {
  attach, setEnabled, setSuppressed, setContext, pushContext, popContext,
  activeContext, getTime, getStats, previewJingle, reset,
};
