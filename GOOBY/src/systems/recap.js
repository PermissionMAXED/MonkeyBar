// V4/G55 — Recap engine (PLAN4 §B5.1–5.2, §C-SYS2.1, §C-SYS2.4–2.6) — PURE
// module: no three.js/DOM imports, node-tested in test/recap.test.js.
//
// The recap cinematic's brain. This module owns the DATA side of the level-up
// recap: baseline snapshots, delta stat lines (the binding 18-line §C-SYS2.4
// catalog with EN+DE templates), the ≤ 12-line §C-SYS2.5 selection, milestone
// math for levels 5,10,…,40, the §C-SYS2.6 beat grid (override precedence +
// default grid) and the §B5.2 atomic completion write. The wave-2 scene/
// overlay agents (G63/G64) consume this module plus systems/recapDirector.js
// (cue timeline) — they render, this module decides.
//
// ── Save-slice contract (for V4/G53, who owns core/save.js) ─────────────────
// This engine needs the §B1 `recap` slice exactly as speced:
//   recap: {
//     lastRecapLevel: 0,   // highest milestone already recapped
//     baseline: {},        // snapshot(state) shape below; {} = not taken yet
//     baselineAt: 0,       // epoch-ms of the snapshot
//     pendingLevel: 0,     // queued-but-not-played milestone (0 = none)
//     history: [],         // ≤ 8 rows { level, at, stats: [{id, value}] }
//   }
// defaultRecapSlice() returns exactly that default. migrations[3] (§B1 #3)
// initializes lastRecapLevel = initialLastRecapLevel(state.level) and
// baseline = snapshot(migratingState, now()), baselineAt = now() — both
// helpers are exported here so the migration can lazy-import them (with an
// inline fallback shape per §E0.1-11 while this file is unmerged).
//
// ── pendingLevel handshake (§B5.2) ──────────────────────────────────────────
// main.js (ONE marked V4/G55 block) listens for level changes, calls
// milestoneCrossed(prev, next, recap.lastRecapLevel) and writes the returned
// milestone into recap.pendingLevel (keeping the LOWEST when one is already
// queued) + emits the runtime 'recapChanged' {pendingLevel, lastRecapLevel}
// store event (§B10). The cinematic plays on the NEXT home-scene enter
// (wave-2 G64 registers that hook — it reads recap.pendingLevel, builds the
// timeline via systems/recapDirector.js, and on finish/skip performs the
// §B5.2 atomic completion in ONE store.update using completeRecap() below:
// history row appended (cap 8), lastRecapLevel advanced, baseline
// re-snapshot, pendingLevel cleared). ONLY the play-completion path clears
// pendingLevel; queueing never does.

/** Frozen engine numbers (§E0.1-2 pattern — exact values live HERE). */
export const RECAP = Object.freeze({
  /** Milestones are the multiples of this step (§C-SYS2.1). */
  MILESTONE_STEP: 5,
  /** First recap milestone. */
  FIRST_MILESTONE: 5,
  /** Last recap milestone (level cap 40). */
  LAST_MILESTONE: 40,
  /** recap.history keeps at most this many rows (§C-SYS2.8). */
  HISTORY_MAX: 8,
  /** ≤ 12 stat lines per recap (§C-SYS2.5): days + top 11 non-zero. */
  MAX_LINES: 12,
  /** Non-days lines picked by (weight, then value) (§C-SYS2.5). */
  TOP_LINES: 11,
  /** Target length = clamp(trackDuration, 60, 120) s (§C-SYS2.2). */
  MIN_LENGTH_SEC: 60,
  MAX_LENGTH_SEC: 120,
  /** §C-SYS2.2 time budget: intro title 4 s → 8 vignettes → end card 14 s. */
  INTRO_SEC: 4,
  END_CARD_SEC: 14,
  VIGNETTES: 8,
  /** Skip affordance appears from t = 10 s (§C-SYS2.2). */
  SKIP_AFTER_SEC: 10,
  /** End card always shows ≥ 3 s, even on skip (§C-SYS2.2). */
  END_CARD_MIN_SEC: 3,
  /** Text pop = scale 0.8→1.05→1.0 over 2 beats, roll-up over 2 (§C-SYS2.6). */
  TEXT_POP_BEATS: 2,
  TEXT_ROLLUP_BEATS: 2,
  /** End card lands with a 4-beat confetti burst (§C-SYS2.6). */
  CONFETTI_BEATS: 4,
  /** Tracks without any beats file get this grid (§B5.3). */
  DEFAULT_GRID: Object.freeze({ bpm: 100, offsetSec: 0, beatsPerBar: 4 }),
  /** Committed manifests must satisfy this bpm window (gen-beats sanity). */
  BPM_MIN: 60,
  BPM_MAX: 200,
  /** `days` line sort weight — sorts before every catalog weight (≤ 10). */
  WEIGHT_ALWAYS_FIRST: 999,
});

/**
 * The binding §C-SYS2.4 delta stat catalog (18 lines, ≥ 14 required).
 * `de`/`en` are the VERBATIM plan templates ({n} placeholder); `deOne`/`enOne`
 * are the singular forms (only `days` has one — „1 Tag"). G64's
 * strings/v4-recap.js must mirror these templates verbatim (§C-SYS2.5:
 * strings live there for the DOM overlay; the engine carries them too so the
 * catalog stays node-testable and self-contained).
 * Order in this array is the catalog order (#1–#18) and the deterministic
 * tie-breaker in selectLines().
 * @type {ReadonlyArray<{id: string, weight: number, de: string, en: string, deOne?: string, enOne?: string}>}
 */
export const STAT_CATALOG = Object.freeze([
  Object.freeze({ id: 'days', weight: RECAP.WEIGHT_ALWAYS_FIRST, de: 'Seitdem: {n} Tage vergangen', deOne: 'Seitdem: 1 Tag vergangen', en: 'Since then: {n} days', enOne: 'Since then: 1 day' }),
  Object.freeze({ id: 'games', weight: 10, de: '{n} Spiele gespielt', en: '{n} games played' }),
  Object.freeze({ id: 'coinsEarned', weight: 9, de: '{n} Münzen verdient', en: '{n} coins earned' }),
  Object.freeze({ id: 'tickles', weight: 9, de: '{n}× Bauch gekrault', en: 'belly rubbed {n}×' }),
  Object.freeze({ id: 'feeds', weight: 8, de: '{n}× lecker gefuttert', en: '{n} tasty meals' }),
  Object.freeze({ id: 'harvests', weight: 8, de: '{n} Ernten eingeholt', en: '{n} harvests brought in' }),
  Object.freeze({ id: 'stickers', weight: 8, de: '{n} neue Sticker', en: '{n} new stickers' }),
  Object.freeze({ id: 'quests', weight: 7, de: '{n} Quests geschafft', en: '{n} quests done' }),
  Object.freeze({ id: 'washes', weight: 6, de: '{n}× blitzblank gebadet', en: '{n} squeaky-clean baths' }),
  Object.freeze({ id: 'sleeps', weight: 6, de: '{n}× tief geschlafen', en: '{n} good nights of sleep' }),
  Object.freeze({ id: 'trips', weight: 6, de: '{n} Ausflüge in die Stadt', en: '{n} trips to town' }),
  Object.freeze({ id: 'distance', weight: 5, de: '{n} m unterwegs', en: '{n} m traveled' }),
  Object.freeze({ id: 'photos', weight: 5, de: '{n} Fotos geknipst', en: '{n} photos snapped' }),
  Object.freeze({ id: 'deliveries', weight: 4, de: '{n} Pakete geliefert', en: '{n} parcels delivered' }),
  Object.freeze({ id: 'cures', weight: 4, de: '{n}× krank (gute Besserung!)', en: 'sick {n}× (get well soon!)' }),
  Object.freeze({ id: 'cakes', weight: 4, de: '{n} Torten serviert', en: '{n} cakes served' }),
  Object.freeze({ id: 'nougat', weight: 3, de: '{n} Nougat-Globs', en: '{n} nougat globs' }),
  Object.freeze({ id: 'coinsSpent', weight: 3, de: '{n} Münzen ausgegeben', en: '{n} coins spent' }),
]);

/**
 * Line id → baseline-snapshot key (both diffed current − baseline, ≥ 0).
 * `days` is computed from baselineAt/snapshotAtMs, not diffed.
 */
const LINE_SOURCE = Object.freeze({
  games: 'playsTotal',
  coinsEarned: 'coinsEarned',
  tickles: 'tickles',
  feeds: 'feeds',
  harvests: 'harvests',
  stickers: 'stickerCount',
  quests: 'questsDone',
  washes: 'washes',
  sleeps: 'sleeps',
  trips: 'trips',
  distance: 'distanceM',
  photos: 'photos',
  deliveries: 'deliveries',
  cures: 'cures',
  cakes: 'cakesServed',
  nougat: 'nougatGlobs',
  coinsSpent: 'coinsSpent',
});

/** Counter keys copied VERBATIM from achievements.counters (§C-SYS2.4). */
const SNAPSHOT_COUNTERS = Object.freeze([
  'feeds', 'washes', 'sleeps', 'tickles', 'trips', 'harvests', 'plantings',
  'waterings', 'questsDone', 'deliveries', 'cures', 'nougatGlobs',
  'cakesServed', 'surfRuns',
]);

/** @param {*} v @returns {number} finite non-negative number (else 0) */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The §B1 `recap` slice default (shape documented in the header). */
export function defaultRecapSlice() {
  return { lastRecapLevel: 0, baseline: {}, baselineAt: 0, pendingLevel: 0, history: [] };
}

/**
 * §B1 #3 retro-safety init value for migrations[3] (G53): the highest
 * milestone at-or-below the migrating level — an L23 save → 20, L4 → 0 —
 * so migrated saves never fire an instant recap.
 * @param {number} level
 * @returns {number} multiple of 5 in [0, 40]
 */
export function initialLastRecapLevel(level) {
  const l = Math.max(0, Math.min(RECAP.LAST_MILESTONE, Math.floor(num(level))));
  return Math.floor(l / RECAP.MILESTONE_STEP) * RECAP.MILESTONE_STEP;
}

/**
 * Take the §C-SYS2.4 baseline snapshot from a save state. Copies exactly:
 * snapshotAtMs, level, coinsEarned/coinsSpent/distanceM/photos (profile),
 * playsTotal (Σ minigames.plays), the listed achievements counters verbatim,
 * and stickerCount (= Object.keys(stickers.unlocked).length). `petsToday` is
 * excluded (daily counter). Missing/corrupt inputs snapshot as 0 — the diff
 * side clamps too, so corruption can never produce negative lines.
 * @param {object} state full save-schema state
 * @param {number} [nowMs] snapshot timestamp (callers pass core/clock now())
 * @returns {object} baseline snapshot
 */
export function snapshot(state, nowMs = Date.now()) {
  const s = state ?? {};
  const profile = s.profile ?? {};
  const counters = s.achievements?.counters ?? {};
  const plays = s.minigames?.plays;
  let playsTotal = 0;
  if (plays != null && typeof plays === 'object' && !Array.isArray(plays)) {
    for (const v of Object.values(plays)) playsTotal += num(v);
  }
  const unlocked = s.stickers?.unlocked;
  const stickerCount =
    unlocked != null && typeof unlocked === 'object' && !Array.isArray(unlocked)
      ? Object.keys(unlocked).length
      : 0;
  const out = {
    snapshotAtMs: num(nowMs),
    level: Math.max(1, Math.floor(num(s.level)) || 1),
    coinsEarned: num(profile.coinsEarned),
    coinsSpent: num(profile.coinsSpent),
    distanceM: num(profile.distanceM),
    photos: num(profile.photos),
    playsTotal,
    stickerCount,
  };
  for (const k of SNAPSHOT_COUNTERS) out[k] = num(counters[k]);
  return out;
}

/**
 * Diff a baseline snapshot against the CURRENT state → ordered stat lines
 * (§C-SYS2.4): `[{ id, value, weight }]` in catalog order, `days` first.
 * Every delta is `current − baseline` clamped ≥ 0 (counter resets/corruption
 * → 0, never negative). `days` = ⌈(nowMs − baselineAt) / 86 400 000⌉,
 * clamped to ≥ 1 (a same-day recap still reads „Seitdem: 1 Tag vergangen").
 * @param {object} baseline snapshot() shape ({} tolerated → all-zero base)
 * @param {object} state current save-schema state
 * @param {number} [nowMs]
 * @returns {Array<{id: string, value: number, weight: number}>}
 */
export function diff(baseline, state, nowMs = Date.now()) {
  const base = baseline != null && typeof baseline === 'object' && !Array.isArray(baseline) ? baseline : {};
  const cur = snapshot(state, nowMs);
  const baseAt = num(base.snapshotAtMs ?? base.baselineAt);
  const elapsed = Math.max(0, num(nowMs) - baseAt);
  const days = baseAt > 0 ? Math.max(1, Math.ceil(elapsed / 86_400_000)) : 1;
  const lines = [];
  for (const row of STAT_CATALOG) {
    if (row.id === 'days') {
      lines.push({ id: 'days', value: days, weight: row.weight });
      continue;
    }
    const key = LINE_SOURCE[row.id];
    const value = Math.max(0, Math.round(cur[key]) - Math.round(num(base[key])));
    lines.push({ id: row.id, value, weight: row.weight });
  }
  return lines;
}

/**
 * §C-SYS2.5 line selection: always `days` first (intro vignette), then the
 * top 11 NON-ZERO lines by (weight desc, then value desc, then catalog order
 * — fully deterministic) → ≤ 12 lines total. The round-robin 1–2 lines per
 * vignette distribution happens in systems/recapDirector.js.
 * @param {Array<{id: string, value: number, weight: number}>} diffLines diff() output
 * @returns {Array<{id: string, value: number, weight: number}>}
 */
export function selectLines(diffLines) {
  const rows = Array.isArray(diffLines) ? diffLines.filter((l) => l && typeof l === 'object') : [];
  const order = new Map(STAT_CATALOG.map((row, i) => [row.id, i]));
  const days = rows.find((l) => l.id === 'days') ?? { id: 'days', value: 1, weight: RECAP.WEIGHT_ALWAYS_FIRST };
  const rest = rows
    .filter((l) => l.id !== 'days' && order.has(l.id) && num(l.value) > 0)
    .sort((a, b) =>
      b.weight - a.weight || b.value - a.value || order.get(a.id) - order.get(b.id))
    .slice(0, RECAP.TOP_LINES);
  return [days, ...rest];
}

/**
 * Render one stat line ({n} template fill, `days` singular handled).
 * @param {string} id catalog line id
 * @param {number} value the diffed n
 * @param {'de'|'en'} [lang]
 * @returns {string} display string ('' for unknown ids)
 */
export function formatLine(id, value, lang = 'de') {
  const row = STAT_CATALOG.find((r) => r.id === id);
  if (!row) return '';
  const n = Math.max(0, Math.round(num(value)));
  const one = lang === 'de' ? row.deOne : row.enOne;
  if (n === 1 && one) return one;
  return (lang === 'de' ? row.de : row.en).replace('{n}', String(n));
}

/** @param {number} level @returns {number} highest milestone ≤ level (0 if none) */
export function highestMilestone(level) {
  return initialLastRecapLevel(level);
}

/**
 * Milestone math (§B5.1): the LOWEST un-recapped multiple of 5 crossed by a
 * prevLevel → newLevel change (or still owed below newLevel), in
 * [5, 40]. 0 = nothing to recap. Multi-level jumps queue the lowest
 * (L4→L11 → 5); when the recap then PLAYS, completeRecap() advances
 * lastRecapLevel to the HIGHEST crossed milestone per §C-SYS2.1 (only ONE
 * cinematic plays per jump — the skipped milestone's stats fold into it).
 * @param {number} prevLevel level before the change
 * @param {number} newLevel level after the change
 * @param {number} [lastRecapLevel] highest already-recapped milestone;
 *   defaults to the §B1 #3 retro-safe floor of prevLevel, so a bare
 *   milestoneCrossed(23, 24) is 0 — never a stale milestone below prevLevel.
 * @returns {number} milestone level to queue, or 0
 */
export function milestoneCrossed(prevLevel, newLevel, lastRecapLevel) {
  const prev = Math.max(0, Math.floor(num(prevLevel)));
  const next = Math.max(0, Math.floor(num(newLevel)));
  const last = Number.isFinite(Number(lastRecapLevel))
    ? Math.max(0, Math.floor(Number(lastRecapLevel)))
    : initialLastRecapLevel(prev);
  if (next <= last) return 0;
  const step = RECAP.MILESTONE_STEP;
  const candidate = Math.max(RECAP.FIRST_MILESTONE, (Math.floor(last / step) + 1) * step);
  if (candidate <= last) return 0; // last ≥ 40 → nothing left
  if (candidate > Math.min(next, RECAP.LAST_MILESTONE)) return 0;
  return candidate;
}

/**
 * §B5.2 atomic completion — call from ONE store.update when the cinematic
 * finished (or was skipped past t = 10 s into the end card):
 *   store.update((s) => { s.recap = completeRecap(s, now()).recap; });
 * Pure: returns a NEW recap slice (input state untouched) with
 *   • history + { level, at, stats } appended (stats = the PLAYED selectLines
 *     rows as { id, value } — §C-SYS2.8 replay renders from these, never
 *     re-snapshots), capped at 8 (oldest dropped),
 *   • lastRecapLevel advanced to the HIGHEST crossed milestone ≤ the current
 *     level (§C-SYS2.1 fold rule — a queued 5 played at level 11 advances to
 *     10, so the skipped milestone never re-fires),
 *   • baseline re-snapshot + baselineAt = nowMs,
 *   • pendingLevel cleared.
 * @param {object} state full save-schema state (state.recap read, not written)
 * @param {number} [nowMs]
 * @param {Array<{id: string, value: number}>} [playedLines] the lines the
 *   cinematic actually showed; defaults to selectLines(diff(...)) recomputed
 *   here — pass them through when the overlay already computed them.
 * @returns {{recap: object, entry: {level: number, at: number, stats: Array<{id: string, value: number}>}}}
 */
export function completeRecap(state, nowMs = Date.now(), playedLines) {
  const prev = { ...defaultRecapSlice(), ...(state?.recap ?? {}) };
  const level = Math.max(1, Math.floor(num(state?.level)) || 1);
  const played = Math.max(
    Math.floor(num(prev.pendingLevel)),
    highestMilestone(level),
    Math.floor(num(prev.lastRecapLevel))
  );
  const lines = Array.isArray(playedLines) && playedLines.length > 0
    ? playedLines
    : selectLines(diff(prev.baseline, state, nowMs));
  const entry = {
    level: played,
    at: num(nowMs),
    stats: lines.map((l) => ({ id: l.id, value: Math.max(0, Math.round(num(l.value))) })),
  };
  const history = [...(Array.isArray(prev.history) ? prev.history : []), entry]
    .slice(-RECAP.HISTORY_MAX);
  return {
    recap: {
      lastRecapLevel: played,
      baseline: snapshot(state, nowMs),
      baselineAt: num(nowMs),
      pendingLevel: 0,
      history,
    },
    entry,
  };
}

// ─── Beat grid (§B5.3 manifests → §C-SYS2.6 cue skeleton) ────────────────────

/**
 * Normalize a beats manifest with override precedence + the default grid
 * (§B5.3): `override` wins verbatim when present, then `beats`, then
 * RECAP.DEFAULT_GRID. Accepts both `offsetSec` (plan §B5.3) and `offsetMs`
 * (committed manifest field) — offsetSec wins when both exist. Non-finite /
 * out-of-range values fall back field-by-field to the default grid.
 * @param {object|null} beats   <basename>.beats.json content (or null)
 * @param {object|null} [override] <basename>.beats.override.json content
 * @returns {{bpm: number, offsetSec: number, beatsPerBar: number}}
 */
export function resolveBeats(beats, override) {
  const src = override != null && typeof override === 'object' ? override
    : beats != null && typeof beats === 'object' ? beats : {};
  const def = RECAP.DEFAULT_GRID;
  const bpm = Number(src.bpm);
  const offset = Number.isFinite(Number(src.offsetSec)) ? Number(src.offsetSec)
    : Number.isFinite(Number(src.offsetMs)) ? Number(src.offsetMs) / 1000
    : def.offsetSec;
  const bpb = Number(src.beatsPerBar);
  return {
    bpm: Number.isFinite(bpm) && bpm >= 30 && bpm <= 300 ? bpm : def.bpm,
    offsetSec: Number.isFinite(offset) && offset >= 0 && offset < 60 ? offset : def.offsetSec,
    beatsPerBar: Number.isInteger(bpb) && bpb >= 2 && bpb <= 8 ? bpb : def.beatsPerBar,
  };
}

/**
 * §B5.1 beatGrid(beats, durationSec) → `{ barSec, cues: [{t, kind}] }` — the
 * §C-SYS2.6 cue SKELETON on the bar grid (recapDirector.buildTimeline maps
 * biomes + stat lines onto it; G63/G64 render it):
 *   • bar k starts at `offsetSec + k × barSec`, barSec = beatsPerBar × 60/bpm;
 *   • total length = clamp(durationSec, 60, 120) s (§C-SYS2.2); budget =
 *     intro 4 s → 8 vignettes × (length − 18)/8 → end card 14 s;
 *   • 8 `cut` cues (vignette 0–7) land on EVEN-bar boundaries — each ideal
 *     budget boundary snaps to the NEAREST even bar (monotonic: every cut ≥
 *     previous + 2 bars; the first cut ≥ bar 2 so the intro title owns
 *     bars 0–1);
 *   • `text` cues are the pop SLOTS (≤ 2 per vignette, §C-SYS2.5) on bar
 *     downbeats inside the vignette: cut-bar + 1 and cut-bar + 3 (falls back
 *     to + 2, dropped when the vignette is too short) plus ONE intro slot on
 *     bar 1 (the `days` line). Pop = scale 0.8→1.05→1.0 over
 *     RECAP.TEXT_POP_BEATS, counter roll-up over the following
 *     RECAP.TEXT_ROLLUP_BEATS;
 *   • ONE `end` cue on the final even bar (nearest even bar to
 *     length − 14 s, ≥ last cut + 2) with a RECAP.CONFETTI_BEATS confetti
 *     burst.
 * Cues are sorted by t; every cue = { t, bar, kind, vignette } (vignette −1 =
 * intro, 0–7 = vignette index; `end` has no vignette).
 * @param {object|null} beats manifest (already override-resolved or raw —
 *   resolveBeats() is applied here again, idempotent)
 * @param {number} durationSec track duration (non-finite → 100 s fallback)
 * @returns {{bpm: number, beatsPerBar: number, offsetSec: number, barSec: number,
 *   beatSec: number, totalSec: number, cues: Array<{t: number, bar: number,
 *   kind: 'text'|'cut'|'end', vignette?: number}>}}
 */
export function beatGrid(beats, durationSec) {
  const g = resolveBeats(beats);
  const dur = Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : 100;
  const totalSec = Math.min(RECAP.MAX_LENGTH_SEC, Math.max(RECAP.MIN_LENGTH_SEC, dur));
  const beatSec = 60 / g.bpm;
  const barSec = g.beatsPerBar * beatSec;
  const barT = (k) => g.offsetSec + k * barSec;
  const evenBarNear = (t) => Math.max(0, 2 * Math.round((t - g.offsetSec) / (2 * barSec)));

  const vigSec = (totalSec - RECAP.INTRO_SEC - RECAP.END_CARD_SEC) / RECAP.VIGNETTES;
  const cues = [];
  // Intro `days` slot on bar 1 (intro title owns bars 0–1 before the first cut).
  cues.push({ t: barT(1), bar: 1, kind: 'text', vignette: -1 });
  let prevBar = 0;
  const cutBars = [];
  for (let i = 0; i < RECAP.VIGNETTES; i++) {
    const ideal = RECAP.INTRO_SEC + i * vigSec;
    const bar = Math.max(prevBar + 2, evenBarNear(ideal));
    cutBars.push(bar);
    cues.push({ t: barT(bar), bar, kind: 'cut', vignette: i });
    prevBar = bar;
  }
  const endBar = Math.max(prevBar + 2, evenBarNear(totalSec - RECAP.END_CARD_SEC));
  // Text slots per vignette (≤ 2, on downbeats strictly inside the vignette).
  for (let i = 0; i < RECAP.VIGNETTES; i++) {
    const from = cutBars[i];
    const until = i + 1 < RECAP.VIGNETTES ? cutBars[i + 1] : endBar;
    if (from + 1 < until) cues.push({ t: barT(from + 1), bar: from + 1, kind: 'text', vignette: i });
    const second = from + 3 < until ? from + 3 : from + 2 < until ? from + 2 : 0;
    if (second > from + 1) cues.push({ t: barT(second), bar: second, kind: 'text', vignette: i });
  }
  cues.push({ t: barT(endBar), bar: endBar, kind: 'end' });
  cues.sort((a, b) => a.t - b.t || (a.kind === 'cut' ? -1 : 1));
  return { bpm: g.bpm, beatsPerBar: g.beatsPerBar, offsetSec: g.offsetSec, barSec, beatSec, totalSec, cues };
}
