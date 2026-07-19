// V4/G64 — Recap overlay logic (PLAN4 §C-SYS2.2, §C-SYS2.5–2.8) — the PURE
// half of src/ui/recapOverlay.js: track pick order, cue-consumption
// scheduling, the per-bar element-clock re-anchor, element volume math,
// end-card reward math, skip rules and the profile „Rückblicke" row model.
// No DOM/three imports — node-tested in test/recapOverlay.test.js.
//
// The DOM/audio half (recapOverlay.js) is a thin driver over these seams:
// every timing decision that the ±80 ms §A2 budget depends on lives here so
// the eval agents can pin it headlessly.

import { RECAP, highestMilestone } from '../systems/recap.js';
import { pickTrack } from '../systems/recapDirector.js';
import { XP } from '../data/constants.js';

/** Frozen overlay numbers (§E0.1-2 pattern — exact values live HERE). */
export const OVERLAY = Object.freeze({
  /** §C-SYS2.1 entry: 400 ms white-fade takeover. */
  WHITE_FADE_MS: 400,
  /** §C-SYS2.1 exit: end card → 500 ms fade home. */
  EXIT_FADE_MS: 500,
  /** §C-SYS2.2 skip: 300 ms cut to the end card. */
  SKIP_CUT_MS: 300,
  /** §C-SYS2.2 skip affordance fades in over 1 s at 40 % opacity. */
  SKIP_FADE_IN_MS: 1000,
  SKIP_OPACITY: 0.4,
  /** Home-enter trigger poll cadence (ms) — cheap idle check. */
  POLL_MS: 800,
  /** Re-anchor: hard-snap the wall clock to the element clock when the
   * drift exceeds this (s); per-bar snaps happen regardless (§C-SYS2.6). */
  MAX_DRIFT_SEC: 0.25,
  /** Track fade at teardown mirrors the radio's §B2.3 300 ms fade. */
  AUDIO_FADE_MS: 300,
  /** §C-SYS2.6 „camera pre-rolls so the cut lands exactly on the downbeat":
   * the NEXT vignette pre-builds (hidden + warm offscreen render) this many
   * seconds before its cut — the build/compile hitch lands just AFTER the
   * preceding odd-bar text pop (bar ≈ 2.4–2.7 s on the shipped tracks), the
   * farthest point from any cue, and the on-beat swap is a cheap flag flip. */
  PRE_ROLL_SEC: 2.3,
  /** §A2: cues must land within ± this budget of the grid. */
  BEAT_BUDGET_MS: 80,
  /** MASTER_BASE × the two (v/100)² sliders replicate the §B2.2 bus math on
   * the overlay's dedicated MediaElement (audio.js's graph is not exposed —
   * the mute boolean and both sliders are still honored live). */
  MASTER_BASE: 0.9,
});

/**
 * §C-SYS2.3 biome id → committed ART-GATE-2 backdrop + fallback tint pair
 * (the colored-backdrop fallback while G63's recapScene builds concurrently).
 * Paths are relative to /assets/ (same convention as the music manifest).
 */
export const BIOME_BACKDROPS = Object.freeze({
  meadow: Object.freeze({ img: 'recap/recap_meadow.png', from: '#a8dd8f', to: '#4f9e58' }),
  city: Object.freeze({ img: 'recap/recap_city.png', from: '#a9c7e8', to: '#5f7fa8' }),
  harbor: Object.freeze({ img: 'recap/recap_harbor.png', from: '#9fd8d4', to: '#3f7f8f' }),
  space: Object.freeze({ img: 'recap/recap_space.png', from: '#3a3f6e', to: '#10122b' }),
  spookGarden: Object.freeze({ img: 'recap/recap_spooky.png', from: '#8f7fb8', to: '#3d2f56' }),
  bakery: Object.freeze({ img: 'recap/recap_bakery.png', from: '#ffd9a8', to: '#c98a4f' }),
  nightSky: Object.freeze({ img: 'recap/recap_night.png', from: '#4a5a9e', to: '#141b3d' }),
  toyRoom: Object.freeze({ img: 'recap/recap_toyroom.png', from: '#ffc4d6', to: '#c96f9e' }),
});

/** @param {string} id @returns {{img: string|null, from: string, to: string}} */
export function biomeBackdrop(id) {
  return BIOME_BACKDROPS[id] ?? { img: null, from: '#ffe1b8', to: '#b8845f' };
}

/** @param {*} v @returns {number} finite number (else 0) */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Track pick (§C-SYS2.6 order)
// ---------------------------------------------------------------------------

/**
 * Deterministic per-recap seed (G55's suggested recipe: milestone level ×
 * baselineAt lower bits) — same recap → same pickTrack() result.
 * @param {number} level milestone level
 * @param {number} atMs baselineAt (or history row `at` for replays)
 * @returns {number} uint32
 */
export function recapSeed(level, atMs) {
  const l = Math.max(0, Math.floor(num(level)));
  const a = Math.max(0, Math.floor(num(atMs)));
  return ((Math.imul(l + 1, 0x9e3779b1) >>> 0) ^ (a >>> 0)) >>> 0;
}

/**
 * §C-SYS2.6 step 1 candidates: owner `Recap - *` tracks (manifest category
 * `Recap`, source `owner`), never stingers, minus tracks the player disabled
 * in the §C-SYS1.5 per-track settings. Sorted by id (deterministic).
 * @param {Array<object>} tracks manifest rows
 * @param {Record<string, {on?: boolean}>} [trims] radio.trims slice
 * @returns {string[]} track ids
 */
export function ownerRecapTrackIds(tracks, trims = {}) {
  return (Array.isArray(tracks) ? tracks : [])
    .filter((t) => t && t.category === 'Recap' && t.source === 'owner'
      && num(t.durationSec) >= 10
      && (trims?.[t.id]?.on !== false))
    .map((t) => t.id)
    .sort();
}

/**
 * §C-SYS2.6 step 2: the committed builtin fallback (`Recap - Abenteuer.ogg`).
 * @param {Array<object>} tracks
 * @returns {string|null}
 */
export function fallbackRecapTrackId(tracks) {
  const rows = (Array.isArray(tracks) ? tracks : [])
    .filter((t) => t && t.category === 'Recap' && t.source === 'builtin');
  const abenteuer = rows.find((t) => t.id === 'recap-abenteuer');
  return abenteuer?.id ?? rows[0]?.id ?? null;
}

/**
 * The full §C-SYS2.6 pick order: seeded owner pick → builtin fallback → null.
 * @param {Array<object>} tracks manifest rows
 * @param {number} seed recapSeed()
 * @param {Record<string, {on?: boolean}>} [trims]
 * @returns {{id: string|null, fallback: boolean}}
 */
export function chooseRecapTrack(tracks, seed, trims = {}) {
  const picked = pickTrack(ownerRecapTrackIds(tracks, trims), seed);
  if (picked) return { id: picked, fallback: false };
  const fb = fallbackRecapTrackId(tracks);
  return { id: fb, fallback: fb != null };
}

// ---------------------------------------------------------------------------
// Element volume (§B2.2 bus math replicated on the dedicated MediaElement)
// ---------------------------------------------------------------------------

/** §B2.2 slider curve: gain = (v/100)². @param {number} v 0..100 */
function volumeGain(v) {
  const c = Math.min(100, Math.max(0, num(v)));
  return (c * c) / 10000;
}

/**
 * Effective element.volume of the recap's dedicated playback:
 * MASTER_BASE × master² × music² × manifest gainTrim × (trims vol / 100),
 * clamped to the element's 0..1 range. settings.music === false → 0 (the
 * driver additionally pauses the element — airtight rule §B2.4).
 * @param {{gainTrim?: number, trimVol?: number, master?: number,
 *   music?: number, musicEnabled?: boolean}} [opts]
 * @returns {number} 0..1
 */
export function elementVolume({ gainTrim = 1, trimVol = 100, master = 80, music = 70, musicEnabled = true } = {}) {
  if (musicEnabled === false) return 0;
  const trim = Number.isFinite(Number(gainTrim)) && Number(gainTrim) > 0
    ? Math.min(2, Math.max(0.3, Number(gainTrim))) : 1;
  const vol = Math.min(150, Math.max(0, num(trimVol))) / 100;
  const raw = OVERLAY.MASTER_BASE * volumeGain(master) * volumeGain(music) * trim * vol;
  return Math.min(1, Math.max(0, raw));
}

// ---------------------------------------------------------------------------
// Master clock (§C-SYS2.6: wall clock, re-anchored to the element per bar)
// ---------------------------------------------------------------------------

/** @param {{offsetSec: number, barSec: number}} grid @param {number} t
 * @returns {number} bar index at t (floor; may be −1 before the offset) */
export function barIndexAt(grid, t) {
  const bar = Math.floor((num(t) - num(grid?.offsetSec)) / Math.max(1e-6, num(grid?.barSec)));
  return Number.isFinite(bar) ? bar : 0;
}

/** @param {{offsetSec: number, barSec: number}} grid @param {number} k
 * @returns {number} start time (s) of bar k */
export function barStartT(grid, k) {
  return num(grid?.offsetSec) + Math.max(0, Math.floor(num(k))) * num(grid?.barSec);
}

/** @param {{offsetSec: number, barSec: number, beatsPerBar: number}} grid
 * @param {number} t @returns {number} beat index at t (floor, may be −1) */
export function beatIndexAt(grid, t) {
  const beatSec = num(grid?.barSec) / Math.max(1, num(grid?.beatsPerBar));
  const beat = Math.floor((num(t) - num(grid?.offsetSec)) / Math.max(1e-6, beatSec));
  return Number.isFinite(beat) ? beat : 0;
}

/**
 * One master-clock step (§C-SYS2.6 drift rule): the wall clock advances by
 * dtSec every frame; whenever the element clock is live it re-anchors —
 * a snap on every bar crossing, plus an immediate snap when the drift
 * exceeds maxDriftSec (rAF drift never accumulates; ±80 ms §A2). In
 * no-audio contexts (elT null — VM/muted) the wall clock simply runs at the
 * manifest bpm — visuals identical.
 * @param {{t: number, anchorBar: number}} state previous clock state
 * @param {{dtSec?: number, elT?: number|null, grid: {offsetSec: number,
 *   barSec: number}, maxDriftSec?: number}} step
 * @returns {{t: number, anchorBar: number, anchored: boolean}}
 */
export function advanceClock(state, { dtSec = 0, elT = null, grid, maxDriftSec = OVERLAY.MAX_DRIFT_SEC }) {
  const prev = state && typeof state === 'object' ? state : { t: 0, anchorBar: -1 };
  let t = Math.max(0, num(prev.t) + Math.max(0, num(dtSec)));
  let anchorBar = Number.isFinite(Number(prev.anchorBar)) ? Number(prev.anchorBar) : -1;
  let anchored = false;
  const el = elT == null ? null : Number(elT);
  if (el != null && Number.isFinite(el) && el >= 0) {
    const bar = barIndexAt(grid, t);
    if (bar > anchorBar || Math.abs(t - el) > Math.max(0.01, num(maxDriftSec))) {
      t = el;
      anchored = true;
    }
    anchorBar = Math.max(anchorBar, barIndexAt(grid, t));
  }
  return { t, anchorBar, anchored };
}

// ---------------------------------------------------------------------------
// Cue consumption (fire-once, ordered — the §C-SYS2.6 schedule)
// ---------------------------------------------------------------------------

/**
 * Fire-once forward scheduler over a director timeline's `cues` array.
 * `advance(t)` returns every not-yet-fired cue with cue.t ≤ t (in order) —
 * the driver applies them and logs `actual − scheduled` offsets. `skipTo(t)`
 * consumes (without "firing") everything strictly before t — the §C-SYS2.2
 * skip cut jumps the presentation to the end card in one step.
 * @param {Array<{t: number}>} cues sorted director cues
 */
export function createCueScheduler(cues) {
  const list = (Array.isArray(cues) ? cues : [])
    .filter((c) => c && typeof c === 'object' && Number.isFinite(Number(c.t)))
    .slice()
    .sort((a, b) => a.t - b.t);
  let next = 0;
  return {
    /** @returns {{t: number}|null} the next cue that will fire */
    peek() {
      return list[next] ?? null;
    },
    /** @param {number} t @returns {Array<object>} cues due at master time t */
    advance(t) {
      const due = [];
      const now = num(t);
      while (next < list.length && list[next].t <= now + 1e-9) {
        due.push(list[next]);
        next += 1;
      }
      return due;
    },
    /** @param {number} t @returns {Array<object>} cues consumed (not fired) */
    skipTo(t) {
      const skipped = [];
      const target = num(t);
      while (next < list.length && list[next].t < target - 1e-9) {
        skipped.push(list[next]);
        next += 1;
      }
      return skipped;
    },
    /** @returns {number} cues already consumed */
    firedCount() {
      return next;
    },
    /** @returns {number} cues still pending */
    remaining() {
      return list.length - next;
    },
  };
}

/**
 * The 8 vignette SPANS of a director timeline: `[{vignette, id, biome, from,
 * to}]` (to = the next cut's t, the last one ends at the end card). The
 * driver feeds `spanAt()` the master clock to know which vignette group is
 * live and how far its §C-SYS2.3 dolly has progressed (G63's
 * handle.update(dt, progress) consumes progress 0..1).
 * @param {{cues: Array<object>, endCard: {t: number}, totalSec: number}} timeline
 * @returns {Array<{vignette: number, id: string, biome: object, from: number, to: number}>}
 */
export function cutSpans(timeline) {
  const cues = Array.isArray(timeline?.cues) ? timeline.cues : [];
  const cuts = cues.filter((c) => c && c.kind === 'cut').sort((a, b) => a.t - b.t);
  const endT = Number.isFinite(Number(timeline?.endCard?.t))
    ? Number(timeline.endCard.t) : num(timeline?.totalSec);
  return cuts.map((cut, i) => ({
    vignette: Math.floor(num(cut.vignette)),
    id: String(cut.biome?.id ?? ''),
    biome: cut.biome ?? null,
    from: num(cut.t),
    to: i + 1 < cuts.length ? num(cuts[i + 1].t) : endT,
  }));
}

/**
 * The live vignette span at master time t (null before the first cut/after
 * the end card) + dolly progress 0..1 across the span.
 * @param {ReturnType<typeof cutSpans>} spans
 * @param {number} t
 * @returns {{vignette: number, id: string, biome: object, progress: number}|null}
 */
export function spanAt(spans, t) {
  const list = Array.isArray(spans) ? spans : [];
  const now = num(t);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const s = list[i];
    if (now >= s.from && now < s.to) {
      const len = Math.max(1e-6, s.to - s.from);
      return {
        vignette: s.vignette,
        id: s.id,
        biome: s.biome,
        progress: Math.min(1, Math.max(0, (now - s.from) / len)),
      };
    }
  }
  return null;
}

/**
 * The UPCOMING span when its cut lands within preRollSec of t (else null) —
 * the driver pre-builds it hidden so the §C-SYS2.6 downbeat swap is cheap.
 * @param {ReturnType<typeof cutSpans>} spans
 * @param {number} t
 * @param {number} [preRollSec]
 * @returns {{vignette: number, id: string, biome: object}|null}
 */
export function nextSpanAt(spans, t, preRollSec = OVERLAY.PRE_ROLL_SEC) {
  const list = Array.isArray(spans) ? spans : [];
  const at = num(t);
  for (const s of list) {
    if (s.from > at && s.from - at <= Math.max(0, num(preRollSec))) return s;
    if (s.from > at) return null; // spans are sorted — nothing due yet
  }
  return null;
}

/**
 * §C-SYS2.6 pop/roll-up windows of a text cue in SECONDS on this grid
 * (scale 0.8→1.05→1.0 over popBeats, counter roll-up over rollupBeats).
 * @param {{popBeats?: number, rollupBeats?: number}} cue
 * @param {{beatSec: number}} grid
 * @returns {{popSec: number, rollSec: number}}
 */
export function popDurations(cue, grid) {
  const beat = Math.max(0.05, num(grid?.beatSec) || 0.6);
  return {
    popSec: Math.max(1, num(cue?.popBeats) || RECAP.TEXT_POP_BEATS) * beat,
    rollSec: Math.max(1, num(cue?.rollupBeats) || RECAP.TEXT_ROLLUP_BEATS) * beat,
  };
}

// ---------------------------------------------------------------------------
// Skip + end card (§C-SYS2.2/2.7)
// ---------------------------------------------------------------------------

/** §C-SYS2.2: taps before skipAfterSec do nothing. @returns {boolean} */
export function skipAllowed(t, skipAfterSec = RECAP.SKIP_AFTER_SEC) {
  return num(t) >= num(skipAfterSec);
}

/**
 * The milestone the cinematic displays — mirrors recap.completeRecap()'s
 * §C-SYS2.1 fold so the title, the history row and lastRecapLevel always
 * agree (an L4→L11 jump with pendingLevel 5 plays as „Level 10!").
 * @param {number} pendingLevel queued milestone (recap.pendingLevel)
 * @param {number} level current player level
 * @returns {number} milestone in [FIRST_MILESTONE, LAST_MILESTONE]
 */
export function displayMilestone(pendingLevel, level) {
  const pending = Math.max(0, Math.floor(num(pendingLevel)));
  const m = Math.max(pending, highestMilestone(level));
  return Math.max(RECAP.FIRST_MILESTONE, Math.min(RECAP.LAST_MILESTONE, m));
}

/**
 * §C-SYS2.7 coin recap (display only — leveling already paid): the sum of
 * `25 × l` for every level l gained since the last recap.
 * @param {number} milestone the recapped level
 * @param {number} [fromLevel] lastRecapLevel at play time (0/absent → 1)
 * @returns {number} coins
 */
export function rewardCoins(milestone, fromLevel = 0) {
  const to = Math.max(1, Math.floor(num(milestone)));
  const from = Math.max(1, Math.floor(num(fromLevel)));
  let sum = 0;
  for (let l = from + 1; l <= to; l += 1) sum += XP.LEVEL_UP_COINS_PER_LEVEL * l;
  return sum;
}

/**
 * Replay reward base (§C-SYS2.8: replays never change reward text): the
 * previous history row's level when one exists below this row's level, else
 * one milestone step down — reproducing the live `lastRecapLevel` at the time
 * the row was recorded (history rows persist only {level, at, stats}).
 * @param {Array<{level: number, at: number}>} history recap.history
 * @param {{level: number, at: number}} row the row being replayed
 * @returns {number} fromLevel for rewardCoins()
 */
export function replayRewardFrom(history, row) {
  const level = Math.max(0, Math.floor(num(row?.level)));
  const prior = (Array.isArray(history) ? history : [])
    .filter((r) => r && Math.floor(num(r.level)) < level
      && (num(r.at) < num(row?.at) || num(row?.at) === 0))
    .map((r) => Math.floor(num(r.level)));
  if (prior.length > 0) return Math.max(...prior);
  return Math.max(0, level - RECAP.MILESTONE_STEP);
}

// ---------------------------------------------------------------------------
// Profile „Rückblicke" row model (§C-SYS2.8)
// ---------------------------------------------------------------------------

/**
 * History rows newest-first for the profile list.
 * @param {Array<{level: number, at: number, stats?: Array}>} history
 * @returns {Array<{level: number, at: number, stats: Array, index: number}>}
 *   `index` = position in the ORIGINAL history array (replay handle)
 */
export function historyRows(history) {
  return (Array.isArray(history) ? history : [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row && typeof row === 'object' && num(row.level) > 0)
    .map(({ row, index }) => ({
      level: Math.floor(num(row.level)),
      at: num(row.at),
      stats: Array.isArray(row.stats) ? row.stats : [],
      index,
    }))
    .reverse();
}

/**
 * „Level 25 · vor 3 Tagen" ago fragment → a strings key + vars (the UI
 * renders it through t()).
 * @param {number} atMs history row timestamp
 * @param {number} nowMs
 * @returns {{key: string, vars?: {n: number}}}
 */
export function agoLabel(atMs, nowMs) {
  const days = Math.max(0, Math.floor((num(nowMs) - num(atMs)) / 86_400_000));
  if (days <= 0) return { key: 'recap.ago.today' };
  if (days === 1) return { key: 'recap.ago.yesterday' };
  return { key: 'recap.ago.days', vars: { n: days } };
}

// ---------------------------------------------------------------------------
// Trigger guard (§C-SYS2.1: plays on next home enter, never mid-gameplay)
// ---------------------------------------------------------------------------

/**
 * True when the queued recap may auto-start right now.
 * @param {{pendingLevel?: number, sceneId?: string|null, switching?: boolean,
 *   activeScreenId?: string|null, playing?: boolean}} probe
 * @returns {boolean}
 */
export function canAutoStart({ pendingLevel = 0, sceneId = null, switching = false, activeScreenId = null, playing = false } = {}) {
  return Math.floor(num(pendingLevel)) > 0
    && sceneId === 'home'
    && switching !== true
    && activeScreenId == null
    && playing !== true;
}

// ---------------------------------------------------------------------------
// ±80 ms offset log (§A2 evidence — consumed by the beat-debug overlay)
// ---------------------------------------------------------------------------

/**
 * Records `actual − scheduled` per fired cue; summary() is the §A2 evidence
 * row (max/mean absolute offset + how many landed within the budget).
 * @param {number} [budgetMs]
 */
export function createOffsetRecorder(budgetMs = OVERLAY.BEAT_BUDGET_MS) {
  /** @type {Array<{kind: string, bar: number, schedT: number, actualT: number, offsetMs: number}>} */
  const rows = [];
  return {
    /** @param {string} kind @param {number} bar @param {number} schedT @param {number} actualT */
    record(kind, bar, schedT, actualT) {
      rows.push({
        kind: String(kind),
        bar: Math.floor(num(bar)),
        schedT: Math.round(num(schedT) * 1000) / 1000,
        actualT: Math.round(num(actualT) * 1000) / 1000,
        offsetMs: Math.round((num(actualT) - num(schedT)) * 1000),
      });
    },
    /** @returns {Array<object>} copy of the rows */
    rows() {
      return rows.slice();
    },
    /** @returns {{n: number, maxAbsMs: number, meanAbsMs: number, within: number, budgetMs: number}} */
    summary() {
      const abs = rows.map((r) => Math.abs(r.offsetMs));
      const n = rows.length;
      return {
        n,
        maxAbsMs: n > 0 ? Math.max(...abs) : 0,
        meanAbsMs: n > 0 ? Math.round(abs.reduce((a, b) => a + b, 0) / n) : 0,
        within: abs.filter((v) => v <= num(budgetMs)).length,
        budgetMs: num(budgetMs),
      };
    },
  };
}
