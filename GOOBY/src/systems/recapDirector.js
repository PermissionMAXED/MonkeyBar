// V4/G55 — Recap director (PLAN4 §C-SYS2.2/2.3/2.5/2.6 — the DATA side) —
// PURE timeline builder: no three.js/DOM imports, node-tested in
// test/recapDirector.test.js. Given a beat grid + stat lines + a biome list,
// buildTimeline() returns the complete cue timeline the wave-2 scene (G63,
// src/home/recapScene.js) and overlay (G64, src/ui/recapOverlay.js) render.
// This module decides WHAT happens on WHICH bar; the renderers own HOW.
//
// ── Cue-timeline contract (binding for G63/G64) ─────────────────────────────
// buildTimeline({ beats, durationSec, lines, biomes, level, trackId }) →
// {
//   v: 1,
//   level,                    // the milestone being recapped (end-card „Level {X}!")
//   trackId,                  // passed through (G64 picked it — see pickTrack)
//   durationSec,              // raw track duration fed in
//   totalSec,                 // clamp(durationSec, 60, 120) — cinematic length
//   bpm, beatsPerBar, offsetSec, barSec, beatSec,   // the resolved grid
//   skipAfterSec: 10,         // skip affordance from t = 10 s (§C-SYS2.2);
//                             //   taps BEFORE that do nothing; after → 300 ms
//                             //   cut to the end card (≥ 3 s, endCard.minShowSec)
//   endCard: { t, bar, minShowSec: 3, confettiBeats: 4 },
//   cues: [ ... ]             // sorted by t ascending
// }
// Cue rows (all have { t (sec), bar (bar index, downbeat), kind }):
//   { kind: 'intro', t: 0, bar: 0, durSec }               — title card until the
//       first cut (durSec = first cut t). Bar 0 = offsetSec on the audio clock.
//   { kind: 'cut', t, bar, vignette: 0–7, biome }          — EVEN bar, camera
//       pre-rolls so the vignette swap lands exactly on this downbeat
//       (§C-SYS2.6). biome = the §C-SYS2.3 row { id, labelDe, labelEn }.
//   { kind: 'text', t, bar, vignette: -1|0–7, lineId, value, textDe, textEn,
//     popBeats: 2, rollupBeats: 2 }                        — pops on this bar's
//       downbeat: scale 0.8→1.05→1.0 over popBeats, counter roll-up 0→value
//       over the following rollupBeats. vignette −1 = the intro `days` line.
//   { kind: 'end', t, bar, confettiBeats: 4 }              — end card on the
//       final even bar with a 4-beat confetti burst (§C-SYS2.7 content:
//       „Level {X}!", coin recap 25 × level per level gained, nextUnlock line,
//       „Weiter" button — G64 renders, values NOT part of this timeline).
// Clock rule (§C-SYS2.6): t is seconds on the TRACK clock
// (radioPlayer.getTime() of the recap's dedicated playback). G64 re-anchors
// its rAF loop to the element clock every bar (±80 ms acceptance, §A2); in
// no-audio contexts the same timeline runs on the wall clock — identical.
// Timelines are fully deterministic: same inputs → deep-equal output.

import { RECAP, STAT_CATALOG, beatGrid, formatLine } from './recap.js';

/**
 * The 8 §C-SYS2.3 biome vignettes, in binding order. G63 keys its vignette
 * groups/dollies off `id`; labels are the DE display names from the table
 * (EN mirrors for the language toggle).
 * @type {ReadonlyArray<{id: string, labelDe: string, labelEn: string}>}
 */
export const DEFAULT_BIOMES = Object.freeze([
  Object.freeze({ id: 'meadow', labelDe: 'Blumenwiese', labelEn: 'Flower Meadow' }),
  Object.freeze({ id: 'city', labelDe: 'Große Stadt', labelEn: 'Big City' }),
  Object.freeze({ id: 'harbor', labelDe: 'Hafen', labelEn: 'Harbor' }),
  Object.freeze({ id: 'space', labelDe: 'Weltraum', labelEn: 'Outer Space' }),
  Object.freeze({ id: 'spookGarden', labelDe: 'Spukgarten', labelEn: 'Haunted Garden' }),
  Object.freeze({ id: 'bakery', labelDe: 'Bäckerei', labelEn: 'Bakery' }),
  Object.freeze({ id: 'nightSky', labelDe: 'Nachthimmel', labelEn: 'Night Sky' }),
  Object.freeze({ id: 'toyRoom', labelDe: 'Spielzeugzimmer', labelEn: 'Toy Room' }),
]);

/** mulberry32 PRNG — deterministic 0..1 stream from a uint32 seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * §C-SYS2.6 track pick, step 1: a random owner `Recap - *` track, seeded per
 * recap (same seed → same pick; suggested seed = milestone level × baselineAt
 * lower bits). Step 2 (caller's fallback when the list is empty):
 * `Recap - Abenteuer.ogg`.
 * @param {string[]} trackIds owner recap track ids (may be empty)
 * @param {number} seed uint32-ish recap seed
 * @returns {string|null} picked id, or null when none available
 */
export function pickTrack(trackIds, seed) {
  const ids = Array.isArray(trackIds) ? trackIds.filter((t) => typeof t === 'string' && t) : [];
  if (ids.length === 0) return null;
  const rnd = mulberry32(Math.floor(Number(seed)) >>> 0);
  return ids[Math.floor(rnd() * ids.length) % ids.length];
}

/**
 * Build the full recap cue timeline (shape: header contract). Maps the
 * selectLines() output onto the beatGrid() skeleton:
 *   • line 1 (`days`) → the intro text slot (vignette −1, §C-SYS2.5);
 *   • the remaining ≤ 11 lines → vignette text slots round-robin, 1 per
 *     vignette in §C-SYS2.3 order first, then a 2nd line per vignette from
 *     the front (≤ 2 per vignette — a vignette with no line just plays its
 *     dolly, §C-SYS2.5). Lines that outnumber usable slots are dropped
 *     (slow-bpm grids can have < 2 slots per vignette).
 * @param {object} opts
 * @param {object|null} opts.beats beats manifest ({bpm, offsetMs|offsetSec,
 *   beatsPerBar} — override precedence already applied by the loader, or pass
 *   the raw manifest; resolveBeats handles both field spellings)
 * @param {number} opts.durationSec real track duration in seconds
 * @param {Array<{id: string, value: number}>} opts.lines selectLines() output
 *   (or a history row's stats for §C-SYS2.8 replay — same shape)
 * @param {Array<{id: string, labelDe: string, labelEn: string}>} [opts.biomes]
 *   defaults to DEFAULT_BIOMES; must have ≥ 1 row (cycled when < 8)
 * @param {number} [opts.level] milestone level (end card headline)
 * @param {string} [opts.trackId] passed through for the renderer
 * @returns {object} the cue timeline (contract in the module header)
 */
export function buildTimeline({ beats, durationSec, lines, biomes, level = 0, trackId = '' } = {}) {
  const grid = beatGrid(beats, durationSec);
  const biomeList = Array.isArray(biomes) && biomes.length > 0 ? biomes : DEFAULT_BIOMES;
  const rows = (Array.isArray(lines) ? lines : [])
    .filter((l) => l && typeof l === 'object' && typeof l.id === 'string')
    .slice(0, RECAP.MAX_LINES);
  const days = rows.find((l) => l.id === 'days') ?? null;
  const rest = rows.filter((l) => l !== days);

  // Collect the skeleton's text slots: intro slot + per-vignette slot lists.
  /** @type {Array<{t: number, bar: number, vignette: number}>} */
  const introSlots = [];
  /** @type {Map<number, Array<{t: number, bar: number, vignette: number}>>} */
  const vignetteSlots = new Map();
  for (const cue of grid.cues) {
    if (cue.kind !== 'text') continue;
    if (cue.vignette === -1) introSlots.push(cue);
    else {
      if (!vignetteSlots.has(cue.vignette)) vignetteSlots.set(cue.vignette, []);
      vignetteSlots.get(cue.vignette).push(cue);
    }
  }
  // Round-robin (§C-SYS2.5): pass 1 gives each vignette its first line, pass 2
  // gives second lines from the front. Deterministic: line order is preserved.
  /** @type {Array<{slot: {t: number, bar: number, vignette: number}, line: {id: string, value: number}}>} */
  const placed = [];
  let li = 0;
  for (let pass = 0; pass < 2 && li < rest.length; pass++) {
    for (let v = 0; v < RECAP.VIGNETTES && li < rest.length; v++) {
      const slot = (vignetteSlots.get(v) ?? [])[pass];
      if (slot) placed.push({ slot, line: rest[li++] });
    }
  }

  const catalogWeight = new Map(STAT_CATALOG.map((r) => [r.id, r.weight]));
  const textCue = (slot, line) => ({
    t: slot.t,
    bar: slot.bar,
    kind: 'text',
    vignette: slot.vignette,
    lineId: line.id,
    value: Math.max(0, Math.round(Number(line.value) || 0)),
    weight: catalogWeight.get(line.id) ?? 0,
    textDe: formatLine(line.id, line.value, 'de'),
    textEn: formatLine(line.id, line.value, 'en'),
    popBeats: RECAP.TEXT_POP_BEATS,
    rollupBeats: RECAP.TEXT_ROLLUP_BEATS,
  });

  const cues = [];
  let firstCutT = grid.totalSec;
  let endCue = null;
  for (const cue of grid.cues) {
    if (cue.kind === 'cut') {
      if (cue.vignette === 0) firstCutT = cue.t;
      cues.push({
        t: cue.t,
        bar: cue.bar,
        kind: 'cut',
        vignette: cue.vignette,
        biome: biomeList[cue.vignette % biomeList.length],
      });
    } else if (cue.kind === 'end') {
      endCue = { t: cue.t, bar: cue.bar, kind: 'end', confettiBeats: RECAP.CONFETTI_BEATS };
      cues.push(endCue);
    }
  }
  if (days && introSlots[0]) cues.push(textCue(introSlots[0], days));
  for (const { slot, line } of placed) cues.push(textCue(slot, line));
  cues.push({ t: 0, bar: 0, kind: 'intro', durSec: firstCutT });
  cues.sort((a, b) => a.t - b.t || a.bar - b.bar || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

  return {
    v: 1,
    level: Math.max(0, Math.floor(Number(level) || 0)),
    trackId: String(trackId ?? ''),
    durationSec: Number(durationSec) || 0,
    totalSec: grid.totalSec,
    bpm: grid.bpm,
    beatsPerBar: grid.beatsPerBar,
    offsetSec: grid.offsetSec,
    barSec: grid.barSec,
    beatSec: grid.beatSec,
    skipAfterSec: RECAP.SKIP_AFTER_SEC,
    endCard: endCue
      ? { t: endCue.t, bar: endCue.bar, minShowSec: RECAP.END_CARD_MIN_SEC, confettiBeats: RECAP.CONFETTI_BEATS }
      : { t: grid.totalSec, bar: 0, minShowSec: RECAP.END_CARD_MIN_SEC, confettiBeats: RECAP.CONFETTI_BEATS },
    cues,
  };
}
