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
  /** Base round length mirrored here so a complete derived tune is portable. */
  DURATION_SEC: DANCE.DURATION_SEC,
  /** Rhythm judgment windows. Normal keeps the frozen §C6 values exactly. */
  PERFECT_MS: DANCE.PERFECT_MS,
  GOOD_MS: DANCE.GOOD_MS,
  /** §G5 endless metadata. */
  ENDLESS: false,
  ENDLESS_BREAK_LIMIT: 3,
  RAMP_FLOOR_STEP: 0,
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
  /** V3/G44 (§C10.2): five consecutive fever perfects trigger Encore. */
  ENCORE_PERFECTS: 5,
  /** V3/G44 (§C10.2): Encore doubles note points for five seconds. */
  ENCORE_SEC: 5,
  /**
   * Song-clock stall tolerance (F4 P2-5, reworked by F6/RE5): real frame gaps
   * up to this long (s) are rendered-but-slow frames (GC/JIT/SwiftShader
   * stalls at heavy throttle reach ~1 s) and advance the song clock by their
   * TRUE duration (createSongClock's absolute time base) — the music keeps
   * playing through them, so freezing would drift the chart late. Explicit
   * pauses freeze exactly via the framework pause/resume hooks
   * (createSongClock.rebase()); this threshold is only the safety net for
   * update() stopping WITHOUT a pause hook (rogue backgrounding), which must
   * not fast-forward the chart unboundedly.
   */
  DRIFT_MAX_FRAME_GAP_SEC: 2.0,
});

/**
 * §G5 sequence/puzzle difficulty. The PATTERN_SEED and BPM are deliberately
 * absent: difficulty may change chart density/preview speed/judgment windows,
 * never the synth-track contract.
 * @param {object} [tune]
 * @param {'easy'|'normal'|'hard'|'endless'} [mode]
 */
export function applyDifficulty(tune = DANCE_TUNING, mode = 'normal') {
  if (mode === 'normal' || !['easy', 'hard', 'endless'].includes(mode)) return tune;
  const hard = mode === 'hard' || mode === 'endless';
  const speedMult = hard ? 1.15 : 0.85;
  const windowMult = hard ? 0.8 : 1.25;
  return Object.freeze({
    ...tune,
    DENSITY_START: tune.DENSITY_START * speedMult,
    DENSITY_END: tune.DENSITY_END * speedMult,
    NOTE_TRAVEL_SEC: tune.NOTE_TRAVEL_SEC / speedMult,
    PERFECT_MS: tune.PERFECT_MS * windowMult,
    GOOD_MS: tune.GOOD_MS * windowMult,
    RAMP_FLOOR_STEP: hard ? -1 : 0,
    ENDLESS: mode === 'endless',
  });
}

/** Apply the plain hitbox multiplier derived by the scene from ctx.params. */
export function withDanceHitbox(tune, hitboxMult = 1) {
  const mult = Number.isFinite(hitboxMult) && hitboxMult > 0 ? hitboxMult : 1;
  if (mult === 1) return tune;
  return Object.freeze({
    ...tune,
    PERFECT_MS: tune.PERFECT_MS * mult,
    GOOD_MS: tune.GOOD_MS * mult,
  });
}

/** §G5.4: three sections containing a combo break end an endless dance. */
export function createDanceEndlessState(limit = DANCE_TUNING.ENDLESS_BREAK_LIMIT) {
  return { breaks: 0, limit, ended: false };
}

export function recordDanceSection(state, missed) {
  if (missed && !state.ended) state.breaks += 1;
  state.ended = state.breaks >= state.limit;
  return state.ended;
}

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
 * F6 (RE5 P1): absolute-time-base song clock. F4's per-frame `max(dt, gap)`
 * stepping accumulated only the POSITIVE side of rAF-timestamp-vs-
 * performance.now() jitter, running ~10% fast at healthy FPS. This clock
 * instead anchors songTime to an absolute reference and re-derives it every
 * tick, so per-frame jitter can never accumulate:
 *
 *   songTime = anchorSong + (source now − source anchor)
 *
 * The source is the music clock (audio.getMusicTime(), WebAudio-derived —
 * true phase lock) when available, else the wall clock (performance.now()).
 * Pauses freeze songTime exactly: the framework's pause/resume hooks call
 * rebase(), which re-anchors WITHOUT advancing. Wall gaps longer than
 * `maxFrameGapSec` (update() stopped without a pause hook) also re-anchor as
 * a safety net. Source appearing/disappearing re-anchors too (no jumps).
 * Pure + deterministic (times are injected) for node:test.
 *
 * @param {{startSec?: number, maxFrameGapSec?: number}} [opts]
 * @returns {{tick: (wallSec: number, musicSec?: number|null) => number,
 *   rebase: () => void, current: () => number}}
 */
export function createSongClock({
  startSec = -DANCE_TUNING.LEAD_IN_SEC,
  maxFrameGapSec = DANCE_TUNING.DRIFT_MAX_FRAME_GAP_SEC,
} = {}) {
  let songTime = startSec;
  let lastWall = null;
  let anchorSong = startSec;
  let anchorWall = null;
  /** @type {number|null} music time at the anchor (null = wall-clock source) */
  let anchorMusic = null;

  return {
    /**
     * Advance the clock for one frame.
     * @param {number} wallSec real time, seconds (performance.now()/1000)
     * @param {number|null} [musicSec] music time (audio.getMusicTime()) or null
     * @returns {number} current song time (seconds)
     */
    tick(wallSec, musicSec = null) {
      const musicOk = typeof musicSec === 'number' && Number.isFinite(musicSec);
      const frameGap = lastWall == null ? 0 : wallSec - lastWall;
      lastWall = wallSec;
      const sourceChanged = musicOk !== (anchorMusic != null);
      if (anchorWall == null || frameGap > maxFrameGapSec || frameGap < 0 || sourceChanged) {
        // first tick / resume after a pause gap / clock source switch:
        // re-anchor at the current songTime — time resumes from here.
        anchorWall = wallSec;
        anchorSong = songTime;
        anchorMusic = musicOk ? musicSec : null;
        return songTime;
      }
      const advance = musicOk ? musicSec - anchorMusic : wallSec - anchorWall;
      const next = anchorSong + advance;
      if (next > songTime) songTime = next; // strictly monotonic — never rewind
      return songTime;
    },
    /**
     * Drop the anchors so the NEXT tick re-anchors at the current songTime
     * without advancing — the framework pause/resume hook path (an explicitly
     * paused span must freeze the chart exactly, whatever its length).
     */
    rebase() {
      lastWall = null;
      anchorWall = null;
    },
    /** @returns {number} */
    current: () => songTime,
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
  const tune = opts.tune ?? DANCE_TUNING;
  const bpm = opts.bpm ?? DANCE.BPM;
  const durationSec = opts.durationSec ?? tune.DURATION_SEC;
  const rng = mulberry32(seed);
  const beatSec = 60 / bpm;
  const slotSec = beatSec / tune.SLOTS_PER_BEAT;
  const startSlot = tune.START_BEAT * tune.SLOTS_PER_BEAT;
  const endTime = durationSec - tune.TAIL_SEC;
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
      tune.DENSITY_START + (tune.DENSITY_END - tune.DENSITY_START) * t;
    if (slot % tune.SLOTS_PER_BEAT !== 0) density *= tune.OFFBEAT_MULT;
    if (rng() >= density) continue;
    if (time - lastTime < tune.MIN_GAP_SEC - 1e-9) continue;

    // lane walk: sometimes stay, otherwise step to a neighbor lane
    if (rng() >= tune.LANE_REPEAT_CHANCE) {
      lane = lane === 0 ? 1 : lane === DANCE.LANES - 1 ? DANCE.LANES - 2 : lane + (rng() < 0.5 ? -1 : 1);
    }
    // respect the same-lane gap; try the other lanes in a deterministic order
    let chosen = -1;
    for (let k = 0; k < DANCE.LANES; k += 1) {
      const cand = (lane + k) % DANCE.LANES;
      if (time - lastLaneTime[cand] >= tune.LANE_GAP_SEC - 1e-9) {
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
export function classifyHit(deltaSec, tune = DANCE_TUNING) {
  const ms = Math.abs(deltaSec) * 1000;
  if (ms <= tune.PERFECT_MS) return 'perfect';
  if (ms <= tune.GOOD_MS) return 'good';
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
export function judgeTap(notes, lane, songTime, tune = DANCE_TUNING) {
  let best = -1;
  let bestAbs = Infinity;
  const windowSec = tune.GOOD_MS / 1000;
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
  return { perfect: 0, good: 0, miss: 0, combo: 0, maxCombo: 0, bonus: 0 };
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
    tally.perfect * DANCE.PERFECT_PTS +
      tally.good * DANCE.GOOD_PTS -
      tally.miss * DANCE.MISS_PENALTY +
      (tally.bonus ?? 0)
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

/**
 * V3/G44 (§C10.2) Fever-chain state. Kept separate from the legacy tally so
 * the DANCE chart/BPM seed contract remains untouched.
 */
export function createFeverChain() {
  return { perfects: 0, encoreUntil: -Infinity, encores: 0 };
}

/** @returns {boolean} whether doubled note points are active at songTime. */
export function encoreActive(chain, songTime) {
  return songTime < chain.encoreUntil;
}

/**
 * Advance the Fever chain after one judgment. Five consecutive perfects
 * while combo tier 3 is active start a five-second Encore. A good/miss or
 * dropping out of fever resets the pending chain; an active Encore cannot
 * retrigger itself.
 * @param {{perfects:number, encoreUntil:number, encores:number}} chain
 * @param {'perfect'|'good'|'miss'} kind
 * @param {number} combo combo AFTER applying the judgment
 * @param {number} songTime
 * @returns {{active:boolean, started:boolean}}
 */
export function advanceFeverChain(chain, kind, combo, songTime) {
  if (encoreActive(chain, songTime)) return { active: true, started: false };
  if (kind !== 'perfect' || comboTier(combo) < 3) {
    chain.perfects = 0;
    return { active: false, started: false };
  }
  chain.perfects += 1;
  if (chain.perfects < DANCE_TUNING.ENCORE_PERFECTS) {
    return { active: false, started: false };
  }
  chain.perfects = 0;
  chain.encoreUntil = songTime + DANCE_TUNING.ENCORE_SEC;
  chain.encores += 1;
  return { active: true, started: true };
}

/**
 * Extra points contributed by Encore. The base tally still owns the normal
 * +4/+2 judgment points; this returns the second copy only.
 * @param {'perfect'|'good'|'miss'} kind
 * @param {boolean} active
 */
export function encoreBonus(kind, active) {
  if (!active || kind === 'miss') return 0;
  return kind === 'perfect' ? DANCE.PERFECT_PTS : DANCE.GOOD_PTS;
}

/**
 * Late-frame note lifecycle. Expired notes are missed without briefly
 * allocating/flashing a mesh; visible notes are inside the travel window.
 * @param {number} noteTime
 * @param {number} songTime
 * @returns {'future'|'visible'|'expired'}
 */
export function noteLifecycle(noteTime, songTime, tune = DANCE_TUNING) {
  if (songTime - noteTime > tune.GOOD_MS / 1000) return 'expired';
  if (noteTime - songTime <= tune.NOTE_TRAVEL_SEC) return 'visible';
  return 'future';
}

/**
 * Deterministic headless certification bot. It consumes the same derived
 * chart/windows as the live bot and models seeded human timing error.
 */
export function simulateDanceAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(DANCE_TUNING, mode);
  const notes = generatePattern(DANCE.PATTERN_SEED, { tune });
  const rng = mulberry32(seed);
  const tally = createTally();
  const missChance = mode === 'easy' ? 0.04 : mode === 'hard' || mode === 'endless' ? 0.1 : 0.08;
  for (const note of notes) {
    if (rng() < missChance) {
      applyJudgment(tally, 'miss');
      continue;
    }
    const error = (rng() + rng() + rng() - 1.5) * 0.16;
    const kind = classifyHit(error, tune);
    applyJudgment(tally, kind ?? 'miss');
    void note;
  }
  return { score: danceScore(tally), tune, tally };
}
