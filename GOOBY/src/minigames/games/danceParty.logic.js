// Dance Party — pure rhythm logic (§C6.1 #9, agent G10). No three.js/DOM
// imports so `node --test` runs this headlessly (§B rule); the game module
// (danceParty.js) imports from here. Binding §C6.1 numbers live in
// data/constants.js DANCE (100 BPM, PATTERN_SEED, 75 s, windows ≤70 ms +4 /
// ≤140 ms +2, miss = combo reset, score = sum − 2×misses). This module owns
// the seeded pattern generator (the §D6/G14 music contract: same seed + BPM
// produce the same note chart as the future procedural track) plus the hit
// judgment / combo / score rules. Coin row (§C6): divisor 6, min 4, max 28,
// typical raw score ≈ 96 → ~16c.

import { DANCE } from '../../data/constants.js';

/** G10 tuning (feel/visual knobs the spec leaves to implementation). */
export const DANCE_TUNING = Object.freeze({
  /** Silence before the first beat reaches the hit line (s). */
  LEAD_IN_SEC: 2.4,
  /** Note fall time from spawn to the hit line (s) — also the visual window. */
  NOTE_TRAVEL_SEC: 1.6,
  /** Pattern grid = eighth notes (2 slots per beat at 100 BPM → 0.3 s). */
  SLOTS_PER_BEAT: 2,
  /** No two notes closer than this (s) — adjacent eighths are allowed. */
  MIN_GAP_SEC: 0.3,
  /** Same-lane minimum gap (s) — one full beat, keeps lanes readable. */
  LANE_GAP_SEC: 0.6,
  /** Note-on chance per grid slot, ramped across the round (density ramp).
   * Tuned for ≈ 75 notes / 75 s: a middling round (≈ 40% perfect, 30% good)
   * lands near the §C6 typical raw score ≈ 96 → ~16c. */
  DENSITY_START: 0.3,
  DENSITY_END: 0.55,
  /** Off-beat slots (the 'and' eighths) are this much less likely. */
  OFFBEAT_MULT: 0.5,
  /** First note lands this many beats after the lead-in. */
  START_BEAT: 4,
  /** No notes in the final stretch so the last note resolves cleanly (s). */
  TAIL_SEC: 2.0,
  /** Chance a lane step repeats the previous lane (else walks to a neighbor). */
  LANE_REPEAT_CHANCE: 0.3,
  /** Combo → dance-energy tiers (comboTier): thresholds for tiers 1/2/3. */
  TIER_COMBOS: Object.freeze([4, 8, 16]),
  /** Ending celebration length before the results screen (s). */
  END_DELAY_SEC: 1.6,
  /**
   * F4 P2-5 drift correction: real frame gaps up to this long (s) advance the
   * song clock by their TRUE duration — the framework clock loses time on
   * clamped long frames (sceneManager caps dt at 0.1 s) while the dance-track
   * sequencer follows the WebAudio clock, so notes drift late vs the music.
   * Gaps beyond this are pauses/backgrounding (update not called), which must
   * NOT advance the chart.
   */
  DRIFT_MAX_FRAME_GAP_SEC: 0.45,
});

/**
 * Deterministic RNG (mulberry32) — same algorithm the framework hands games,
 * duplicated here so the pattern stays pure/node-testable and locked to
 * DANCE.PATTERN_SEED independently of the per-round ctx.rng.
 * @param {number} seed
 * @returns {() => number} 0..1
 */
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

/**
 * @typedef {Object} DanceNote
 * @property {number} time  hit-line time in song seconds (0 = first beat)
 * @property {number} lane  0 | 1 | 2
 * @property {number} slot  grid slot index (eighth notes)
 */

/**
 * Generate the seeded 75 s note pattern (§C6.1 #9). Deterministic: the same
 * seed always yields the identical chart (the G14 music contract). Notes sit
 * on an eighth-note grid at `bpm`, density ramps DENSITY_START → DENSITY_END,
 * lanes do a weighted random walk, and spacing rules keep it playable
 * (MIN_GAP_SEC overall, LANE_GAP_SEC per lane).
 * @param {number} [seed]
 * @param {{bpm?: number, durationSec?: number}} [opts]
 * @returns {DanceNote[]} sorted by time
 */
export function generatePattern(seed = DANCE.PATTERN_SEED, opts = {}) {
  const bpm = opts.bpm ?? DANCE.BPM;
  const durationSec = opts.durationSec ?? DANCE.DURATION_SEC;
  const rng = mulberry32(seed);
  const beatSec = 60 / bpm;
  const slotSec = beatSec / DANCE_TUNING.SLOTS_PER_BEAT;
  const startSlot = DANCE_TUNING.START_BEAT * DANCE_TUNING.SLOTS_PER_BEAT;
  const endTime = durationSec - DANCE_TUNING.TAIL_SEC;
  const totalSlots = Math.floor(endTime / slotSec);

  /** @type {DanceNote[]} */
  const notes = [];
  let lastTime = -Infinity;
  const lastLaneTime = [-Infinity, -Infinity, -Infinity];
  let lane = Math.floor(rng() * DANCE.LANES);

  for (let slot = startSlot; slot <= totalSlots; slot += 1) {
    const time = slot * slotSec;
    if (time > endTime) break;
    const t = time / durationSec;
    let density =
      DANCE_TUNING.DENSITY_START + (DANCE_TUNING.DENSITY_END - DANCE_TUNING.DENSITY_START) * t;
    if (slot % DANCE_TUNING.SLOTS_PER_BEAT !== 0) density *= DANCE_TUNING.OFFBEAT_MULT;
    if (rng() >= density) continue;
    if (time - lastTime < DANCE_TUNING.MIN_GAP_SEC - 1e-9) continue;

    // lane walk: sometimes stay, otherwise step to a neighbor lane
    if (rng() >= DANCE_TUNING.LANE_REPEAT_CHANCE) {
      lane = lane === 0 ? 1 : lane === DANCE.LANES - 1 ? DANCE.LANES - 2 : lane + (rng() < 0.5 ? -1 : 1);
    }
    // respect the same-lane gap; try the other lanes in a deterministic order
    let chosen = -1;
    for (let k = 0; k < DANCE.LANES; k += 1) {
      const cand = (lane + k) % DANCE.LANES;
      if (time - lastLaneTime[cand] >= DANCE_TUNING.LANE_GAP_SEC - 1e-9) {
        chosen = cand;
        break;
      }
    }
    if (chosen === -1) continue;
    lane = chosen;
    notes.push({ time, lane, slot });
    lastTime = time;
    lastLaneTime[lane] = time;
  }
  return notes;
}

/**
 * Classify a tap by its timing error vs the note (§C6.1 #9 windows):
 * |delta| ≤ 70 ms → 'perfect' (+4), ≤ 140 ms → 'good' (+2), else null.
 * @param {number} deltaSec tapTime − noteTime, seconds (sign irrelevant)
 * @returns {'perfect'|'good'|null}
 */
export function classifyHit(deltaSec) {
  const ms = Math.abs(deltaSec) * 1000;
  if (ms <= DANCE.PERFECT_MS) return 'perfect';
  if (ms <= DANCE.GOOD_MS) return 'good';
  return null;
}

/**
 * Find the note a lane-tap grabs: the nearest un-hit, un-missed note in that
 * lane within the good window. Taps that match nothing are ignored (no
 * penalty — misses come from notes crossing the line un-hit).
 * @param {Array<{time: number, lane: number, hit?: boolean, missed?: boolean}>} notes
 * @param {number} lane
 * @param {number} songTime seconds
 * @returns {number} index into notes, or −1
 */
export function judgeTap(notes, lane, songTime) {
  let best = -1;
  let bestAbs = Infinity;
  const windowSec = DANCE.GOOD_MS / 1000;
  for (let i = 0; i < notes.length; i += 1) {
    const n = notes[i];
    if (n.lane !== lane || n.hit || n.missed) continue;
    if (n.time - songTime > windowSec) break; // sorted: nothing closer ahead
    const abs = Math.abs(n.time - songTime);
    if (abs <= windowSec && abs < bestAbs) {
      best = i;
      bestAbs = abs;
    }
  }
  return best;
}

/** Fresh judgment tally. */
export function createTally() {
  return { perfect: 0, good: 0, miss: 0, combo: 0, maxCombo: 0 };
}

/**
 * Apply one judgment to the tally (§C6.1 #9): perfect/good extend the combo,
 * a miss resets it. Returns the same object (hot path).
 * @param {{perfect:number, good:number, miss:number, combo:number, maxCombo:number}} tally
 * @param {'perfect'|'good'|'miss'} kind
 */
export function applyJudgment(tally, kind) {
  if (kind === 'miss') {
    tally.miss += 1;
    tally.combo = 0;
  } else {
    tally[kind] += 1;
    tally.combo += 1;
    if (tally.combo > tally.maxCombo) tally.maxCombo = tally.combo;
  }
  return tally;
}

/**
 * Round score (§C6.1 #9): perfect×4 + good×2 − 2×misses, floored at 0
 * (coin clamp min 4 covers the floor anyway).
 * @param {{perfect: number, good: number, miss: number}} tally
 * @returns {number}
 */
export function danceScore(tally) {
  return Math.max(
    0,
    tally.perfect * DANCE.PERFECT_PTS + tally.good * DANCE.GOOD_PTS - tally.miss * DANCE.MISS_PENALTY
  );
}

/**
 * Dance-energy tier from the current combo (drives how big Gooby's moves
 * are): 0 (base) → 3 (fever).
 * @param {number} combo
 * @returns {0|1|2|3}
 */
export function comboTier(combo) {
  const [t1, t2, t3] = DANCE_TUNING.TIER_COMBOS;
  if (combo >= t3) return 3;
  if (combo >= t2) return 2;
  if (combo >= t1) return 1;
  return 0;
}
