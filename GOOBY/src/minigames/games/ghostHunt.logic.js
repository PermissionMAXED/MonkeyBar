// Ghost Hunt — pure spawn/chain/scoring logic (PLAN3 §C10.1 #2, agent
// V3/G41). No three.js/DOM imports (§B8 purity rule) — test/gamesV3a.test.js
// runs this headlessly and the visual module (ghostHunt.js) renders THIS
// state machine 1:1 (taps feed tapHunt, the event queue becomes sfx/juice).
//
// Binding §C10.1 #2 numbers implemented here (all in HUNT below):
//   · spooky-CUTE seek-and-tap in a KayKit-Halloween graveyard-garden at dusk
//   · cute sheet-ghosts peek from graves/pumpkins/crypts on ramping timers:
//     visible 2.2 s → 0.9 s across the 90 s round
//   · tap = catch +3, chain +1 per catch within 1.5 s, chain bonus cap +5
//   · decoys: pumpkin-lanterns that flicker like ghosts — tapping one = −2
//   · „Boo-wave" every 25 s: 5 ghosts at once, catch ≥ 4 → +10
//   · powerups: Laterne (3 s: all spawn points revealed early) and Netz
//     (next 3 catches auto-chain)
//   · 90 s round, typical score ≈ 90; meta {ghostsCaught}
//   · bot taps real ghosts at spawn+200 ms and IGNORES decoys

/** Deterministic RNG (mulberry32 — framework-identical, §E8). @param {number} seed @returns {() => number} */
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

/** All Ghost-Hunt tuning (§C10.1 #2 binding numbers + G41 knobs). */
export const HUNT = Object.freeze({
  /** §C10.1: 90 s round. */
  DURATION_SEC: 90,
  /** §C10.1 ramping visibility window: 2.2 s → 0.9 s across the round. */
  VISIBLE_START_SEC: 2.2,
  VISIBLE_END_SEC: 0.9,
  /** §C10.1 catch scoring: +3 base, chain +1 per catch ≤ 1.5 s, cap +5. */
  CATCH_POINTS: 3,
  CHAIN_WINDOW_SEC: 1.5,
  CHAIN_BONUS_CAP: 5,
  /** §C10.1 decoys: tapping a flickering pumpkin-lantern = −2 (chain breaks). */
  DECOY_PENALTY: -2,
  DECOY_FLICKER_SEC: 1.8,
  DECOY_CHANCE_START: 0.12,
  DECOY_CHANCE_END: 0.28,
  /** §C10.1 Boo-wave: every 25 s, 5 ghosts at once, ≥ 4 catches → +10. */
  BOO_EVERY_SEC: 25,
  BOO_COUNT: 5,
  BOO_CATCH_MIN: 4,
  BOO_BONUS: 10,
  BOO_MIN_VISIBLE_SEC: 1.6,
  /** §C10.1 powerups: Laterne 3 s reveal · Netz 3 auto-chained catches. */
  LANTERN_SEC: 3,
  LANTERN_REVEAL_BONUS_SEC: 0.4,
  NET_CATCHES: 3,
  TOKEN_VISIBLE_SEC: 5,
  /** Seeded powerup-token windows (kind + [from, to] seconds). */
  TOKEN_WINDOWS: Object.freeze([
    Object.freeze({ kind: 'lantern', from: 12, to: 18 }),
    Object.freeze({ kind: 'net', from: 30, to: 36 }),
    Object.freeze({ kind: 'lantern', from: 52, to: 58 }),
    Object.freeze({ kind: 'net', from: 68, to: 74 }),
  ]),
  /** Spawn cadence ramp (seconds between peeks; tightens over the round). */
  SPAWN_START_SEC: 2.8,
  SPAWN_END_SEC: 1.5,
  FIRST_SPAWN_SEC: 0.8,
  /** §C10.1 bot: taps real ghosts at spawn+200 ms, ignores decoys. The
   * engagement rates emulate a good-but-human round (typical score ≈ 90). */
  BOT_REACT_SEC: 0.2,
  BOT_MIN_GAP_SEC: 0.5,
  BOT_ENGAGE: 0.4,
  BOT_WAVE_ENGAGE: 0.62,
  /** Rise/sink animation shares of the visibility window (visual timing). */
  RISE_FRAC: 0.16,
  SINK_FRAC: 0.16,
  // ── V4/G74 §G5.3/§G5.4 derived-mode defaults (Mittel identity) ──
  ENDLESS: false,
  /** §G5.4 Endlos end-condition: 3 escaped Boo-waves (< 4 catches). */
  ENDLESS_ESCAPE_LIMIT: 3,
});

/**
 * V4/G74 §G5.3 timed-arena rows: Leicht = spawn interval ×1.2, visibility
 * (the reaction window) ×1.25, duration +20 %; Schwer = interval ×0.85,
 * windows ×0.8 (0.72 s floor ≥ the 0.35 s guardrail), duration unchanged.
 * Endlos (§G5.4): Schwer arena without the round timer — Boo-waves keep
 * coming every 25 s and 3 ESCAPED waves (< 4 catches) end the run. The
 * bot-engage columns model the human hit-rate per pressure level
 * (§G5.4 monotone-means / beatability gates — exempt from guardrails).
 */
export const HUNT_DIFFICULTY = Object.freeze({
  easy: Object.freeze({
    interval: 1.2, windows: 1.25, duration: 1.2, botEngage: 0.44, botWaveEngage: 0.66, endless: false,
  }),
  normal: Object.freeze({
    interval: 1, windows: 1, duration: 1, botEngage: 0.4, botWaveEngage: 0.62, endless: false,
  }),
  hard: Object.freeze({
    interval: 0.85, windows: 0.8, duration: 1, botEngage: 0.36, botWaveEngage: 0.58, endless: false,
  }),
  endless: Object.freeze({
    interval: 0.85, windows: 0.8, duration: 1, botEngage: 0.36, botWaveEngage: 0.58, endless: true,
  }),
});

/**
 * Derive the frozen per-mode tune (§G5.3). Mittel returns the frozen live
 * HUNT table itself — bit-identical numbers AND rng streams (§G5.2/§E5).
 * ghostHunt has NO gameplay modifiers (§C-SYS4.3: payout-only eligibility),
 * so there is no applyModifier here.
 * @param {object} [tune] @param {string} [mode] @returns {object}
 */
export function applyDifficulty(tune = HUNT, mode = 'normal') {
  const id = Object.hasOwn(HUNT_DIFFICULTY, mode) ? mode : 'normal';
  if (id === 'normal') return tune;
  const row = HUNT_DIFFICULTY[id];
  return Object.freeze({
    ...tune,
    DURATION_SEC: tune.DURATION_SEC * row.duration,
    SPAWN_START_SEC: tune.SPAWN_START_SEC * row.interval,
    SPAWN_END_SEC: tune.SPAWN_END_SEC * row.interval,
    VISIBLE_START_SEC: tune.VISIBLE_START_SEC * row.windows,
    VISIBLE_END_SEC: tune.VISIBLE_END_SEC * row.windows,
    BOO_MIN_VISIBLE_SEC: tune.BOO_MIN_VISIBLE_SEC * row.windows,
    BOT_ENGAGE: row.botEngage,
    BOT_WAVE_ENGAGE: row.botWaveEngage,
    ENDLESS: row.endless,
    MODE: id,
  });
}

/**
 * Ghost spawn anchors (world coordinates shared with the visual module —
 * portrait play field, camera looks down the −z garden). kind picks the
 * hiding prop: ghosts peek from graves / pumpkins / the crypt (§C10.1).
 */
export const SPOTS = Object.freeze([
  Object.freeze({ id: 0, kind: 'grave', x: -2.1, z: -1.7 }),
  Object.freeze({ id: 1, kind: 'pumpkin', x: -0.7, z: -1.5 }),
  Object.freeze({ id: 2, kind: 'grave', x: 0.8, z: -1.7 }),
  Object.freeze({ id: 3, kind: 'grave', x: 2.1, z: -1.6 }),
  Object.freeze({ id: 4, kind: 'pumpkin', x: -2.3, z: -3.4 }),
  Object.freeze({ id: 5, kind: 'grave', x: -0.9, z: -3.5 }),
  Object.freeze({ id: 6, kind: 'grave', x: 1.0, z: -3.3 }),
  Object.freeze({ id: 7, kind: 'pumpkin', x: 2.3, z: -3.5 }),
  Object.freeze({ id: 8, kind: 'grave', x: -1.7, z: -5.3 }),
  Object.freeze({ id: 9, kind: 'crypt', x: 0.1, z: -6.4 }),
  Object.freeze({ id: 10, kind: 'grave', x: 1.8, z: -5.2 }),
  Object.freeze({ id: 11, kind: 'pumpkin', x: 0.0, z: -4.9 }),
]);

/** Decoy pumpkin-lantern anchors (§C10.1: they flicker like ghosts). */
export const DECOY_SPOTS = Object.freeze([
  Object.freeze({ id: 0, x: -1.5, z: -2.5 }),
  Object.freeze({ id: 1, x: 1.6, z: -2.5 }),
  Object.freeze({ id: 2, x: -2.3, z: -4.5 }),
  Object.freeze({ id: 3, x: 2.3, z: -4.4 }),
]);

/** Powerup-token float anchors (per TOKEN_WINDOWS index). */
export const TOKEN_ANCHORS = Object.freeze([
  Object.freeze({ x: -1.1, z: -2.1 }),
  Object.freeze({ x: 1.1, z: -2.1 }),
  Object.freeze({ x: -1.1, z: -2.1 }),
  Object.freeze({ x: 1.1, z: -2.1 }),
]);

/**
 * §C10.1 visibility ramp: how long a ghost stays catchable at a moment of
 * the round (linear 2.2 s → 0.9 s).
 * @param {number} elapsed @param {object} [tune] @returns {number} seconds
 */
export function visibleDurAt(elapsed, tune = HUNT) {
  const t = Math.min(1, Math.max(0, elapsed / tune.DURATION_SEC));
  return tune.VISIBLE_START_SEC + (tune.VISIBLE_END_SEC - tune.VISIBLE_START_SEC) * t;
}

/**
 * Seconds until the next peek (cadence tightens across the round).
 * @param {number} elapsed @param {object} [tune] @returns {number}
 */
export function spawnIntervalAt(elapsed, tune = HUNT) {
  const t = Math.min(1, Math.max(0, elapsed / tune.DURATION_SEC));
  return tune.SPAWN_START_SEC + (tune.SPAWN_END_SEC - tune.SPAWN_START_SEC) * t;
}

/**
 * Chance that a spawn slot becomes a decoy flicker instead of a ghost.
 * @param {number} elapsed @param {object} [tune] @returns {number}
 */
export function decoyChanceAt(elapsed, tune = HUNT) {
  const t = Math.min(1, Math.max(0, elapsed / tune.DURATION_SEC));
  return tune.DECOY_CHANCE_START + (tune.DECOY_CHANCE_END - tune.DECOY_CHANCE_START) * t;
}

/**
 * §C10.1 chain bonus for the n-th consecutive chained catch: 0 for the
 * first, then +1 per link, capped at +5 (catch values 3,4,5,6,7,8,8,…).
 * @param {number} chain streak length AFTER the current catch (≥ 1)
 * @param {object} [tune] @returns {number} 0 … CHAIN_BONUS_CAP
 */
export function chainBonus(chain, tune = HUNT) {
  return Math.min(tune.CHAIN_BONUS_CAP, Math.max(0, chain - 1));
}

/** Boo-wave trigger times for a round (§C10.1: every 25 s). @param {object} [tune] @returns {number[]} */
export function booWaveTimes(tune = HUNT) {
  const times = [];
  for (let t = tune.BOO_EVERY_SEC; t <= tune.DURATION_SEC - 10; t += tune.BOO_EVERY_SEC) times.push(t);
  return times;
}

/**
 * Create the seeded hunt state (§E8: the framework seeds via params.seed).
 * @param {number} seed @param {object} [tune] @returns {object}
 */
export function createHunt(seed, tune = HUNT) {
  return {
    seed,
    tune,
    rng: mulberry32((seed ^ 0x60db15c3) >>> 0),
    t: 0,
    score: 0,
    chain: 0,
    lastCatchT: -99,
    netLeft: 0,
    lanternT: 0,
    ghosts: [],
    flickers: [],
    tokens: [],
    nextGhostId: 1,
    nextSpawnT: tune.FIRST_SPAWN_SEC,
    booTimes: booWaveTimes(tune),
    booIdx: 0,
    booActive: null,
    tokensSpawned: tune.TOKEN_WINDOWS.map(() => false),
    tokenAt: tune.TOKEN_WINDOWS.map(() => -1), // seeded lazily on first step
    caught: 0,
    missed: 0,
    decoysTapped: 0,
    booBonuses: 0,
    escapedWaves: 0, // V4/G74 §G5.4: Endlos ends at ENDLESS_ESCAPE_LIMIT
    events: [],
    ended: false,
  };
}

/** @param {object} state @param {number|null} exclude @returns {number[]} free SPOT ids */
function freeSpots(state, exclude = null) {
  const busy = new Set(state.ghosts.map((g) => g.spot));
  return SPOTS.filter((s) => !busy.has(s.id) && s.id !== exclude).map((s) => s.id);
}

/** Spawn one ghost on a free spot (returns null when the yard is full). */
function spawnGhost(state, { wave = null, forcedDur = null } = {}) {
  const tune = state.tune;
  const free = freeSpots(state);
  if (free.length === 0) return null;
  const spot = free[Math.floor(state.rng() * free.length)];
  const dur = forcedDur ?? visibleDurAt(state.t, tune) + (state.lanternT > 0 ? tune.LANTERN_REVEAL_BONUS_SEC : 0);
  const ghost = {
    id: state.nextGhostId,
    spot,
    spawnT: state.t,
    dur,
    wave,
    revealed: state.lanternT > 0,
  };
  state.nextGhostId += 1;
  state.ghosts.push(ghost);
  state.events.push({ type: 'ghostSpawn', id: ghost.id, spot, wave, revealed: ghost.revealed });
  return ghost;
}

/** Bookkeep a resolved boo-wave ghost; pays the ≥4-bonus when the wave ends. */
function resolveWaveGhost(state, ghost, wasCaught) {
  const wave = state.booActive;
  if (!wave || ghost.wave !== wave.idx) return;
  wave.resolved += 1;
  if (wasCaught) wave.caught += 1;
  if (wave.resolved >= wave.total) {
    if (wave.caught >= state.tune.BOO_CATCH_MIN) {
      state.score += state.tune.BOO_BONUS;
      state.booBonuses += 1;
      state.events.push({ type: 'booBonus', caught: wave.caught, bonus: state.tune.BOO_BONUS });
    } else {
      // V4/G74 §G5.4: an ESCAPED wave (< 4 catches) — 3 of them end Endlos
      state.escapedWaves += 1;
      state.events.push({ type: 'booEnd', caught: wave.caught, escaped: state.escapedWaves });
      if (state.tune.ENDLESS && state.escapedWaves >= state.tune.ENDLESS_ESCAPE_LIMIT) {
        state.ended = true;
        state.events.push({ type: 'end', reason: 'escapes' });
      }
    }
    state.booActive = null;
  }
}

/**
 * Advance the hunt by dt: expiries, spawn scheduler, boo-waves, tokens.
 * @param {object} state @param {number} dt seconds
 */
export function stepHunt(state, dt) {
  if (state.ended) return;
  const tune = state.tune;
  state.t += dt;
  const t = state.t;

  // V4/G74 §G5.4: Endlos has no round timer — it ends through the
  // escaped-Boo-wave counter in resolveWaveGhost instead.
  if (!tune.ENDLESS && t >= tune.DURATION_SEC) {
    state.ended = true;
    state.events.push({ type: 'end' });
    return;
  }

  state.lanternT = Math.max(0, state.lanternT - dt);

  // ghost expiries (missed peeks)
  for (let i = state.ghosts.length - 1; i >= 0; i -= 1) {
    const g = state.ghosts[i];
    if (t - g.spawnT >= g.dur) {
      state.ghosts.splice(i, 1);
      state.missed += 1;
      state.events.push({ type: 'ghostGone', id: g.id, spot: g.spot });
      resolveWaveGhost(state, g, false);
    }
  }
  // decoy flicker expiries
  for (let i = state.flickers.length - 1; i >= 0; i -= 1) {
    if (t - state.flickers[i].startT >= tune.DECOY_FLICKER_SEC) {
      state.events.push({ type: 'flickerEnd', decoy: state.flickers[i].decoy });
      state.flickers.splice(i, 1);
    }
  }
  // token expiries
  for (let i = state.tokens.length - 1; i >= 0; i -= 1) {
    if (t - state.tokens[i].startT >= tune.TOKEN_VISIBLE_SEC) {
      state.events.push({ type: 'tokenGone', kind: state.tokens[i].kind });
      state.tokens.splice(i, 1);
    }
  }

  // powerup tokens (seeded moment inside each window — §C10.1 Laterne/Netz)
  for (let w = 0; w < tune.TOKEN_WINDOWS.length; w += 1) {
    if (state.tokensSpawned[w]) continue;
    const win = tune.TOKEN_WINDOWS[w];
    if (state.tokenAt[w] < 0 && t >= win.from - 5) {
      state.tokenAt[w] = win.from + state.rng() * (win.to - win.from);
    }
    if (state.tokenAt[w] >= 0 && t >= state.tokenAt[w]) {
      state.tokensSpawned[w] = true;
      state.tokens.push({ window: w, kind: win.kind, startT: t });
      state.events.push({ type: 'tokenSpawn', kind: win.kind, window: w });
    }
  }

  // V4/G74 §G5.4 Endlos: the Boo-wave schedule keeps extending forever
  // (every 25 s past the precomputed §C10.1 list).
  if (tune.ENDLESS && state.booIdx >= state.booTimes.length) {
    const last = state.booTimes[state.booTimes.length - 1] ?? 0;
    state.booTimes.push(last + tune.BOO_EVERY_SEC);
  }

  // §C10.1 boo-wave: every 25 s — 5 ghosts at once (oldest regulars yield)
  if (state.booIdx < state.booTimes.length && t >= state.booTimes[state.booIdx]) {
    const idx = state.booIdx;
    state.booIdx += 1;
    // free up room: silently retire oldest regular ghosts (no miss penalty)
    while (freeSpots(state).length < tune.BOO_COUNT && state.ghosts.length > 0) {
      const g = state.ghosts.shift();
      state.events.push({ type: 'ghostGone', id: g.id, spot: g.spot });
    }
    const dur = Math.max(visibleDurAt(t, tune), tune.BOO_MIN_VISIBLE_SEC);
    let spawned = 0;
    for (let i = 0; i < tune.BOO_COUNT; i += 1) {
      if (spawnGhost(state, { wave: idx, forcedDur: dur })) spawned += 1;
    }
    state.booActive = { idx, total: spawned, caught: 0, resolved: 0 };
    state.events.push({ type: 'booWave', idx, count: spawned });
  }

  // regular spawn scheduler (ghost or decoy flicker)
  if (t >= state.nextSpawnT) {
    state.nextSpawnT = t + spawnIntervalAt(t, tune);
    const freeDecoys = DECOY_SPOTS.filter((d) => !state.flickers.some((f) => f.decoy === d.id));
    if (state.rng() < decoyChanceAt(t, tune) && freeDecoys.length > 0) {
      const decoy = freeDecoys[Math.floor(state.rng() * freeDecoys.length)].id;
      state.flickers.push({ decoy, startT: t });
      state.events.push({ type: 'flicker', decoy });
    } else {
      spawnGhost(state);
    }
  }
}

/**
 * Resolve a tap. Target shapes: {kind:'ghost', id} · {kind:'decoy', decoy} ·
 * {kind:'token', window} · null (missed everything — breaks the chain).
 * @param {object} state
 * @param {{kind: string, id?: number, decoy?: number, window?: number}|null} target
 * @returns {{kind: string, points: number, chain?: number}}
 */
export function tapHunt(state, target) {
  const tune = state.tune;
  const t = state.t;
  if (state.ended) return { kind: 'ended', points: 0 };

  if (target?.kind === 'ghost') {
    const i = state.ghosts.findIndex((g) => g.id === target.id);
    if (i < 0) return { kind: 'miss', points: 0 };
    const ghost = state.ghosts[i];
    state.ghosts.splice(i, 1);
    const auto = state.netLeft > 0;
    const chained = auto || t - state.lastCatchT <= tune.CHAIN_WINDOW_SEC;
    state.chain = chained ? state.chain + 1 : 1;
    if (auto) state.netLeft -= 1;
    const bonus = chainBonus(state.chain, tune);
    const points = tune.CATCH_POINTS + bonus;
    state.score += points;
    state.lastCatchT = t;
    state.caught += 1;
    state.events.push({ type: 'catch', id: ghost.id, spot: ghost.spot, points, chain: state.chain, auto });
    resolveWaveGhost(state, ghost, true);
    return { kind: 'ghost', points, chain: state.chain };
  }

  if (target?.kind === 'decoy') {
    const i = state.flickers.findIndex((f) => f.decoy === target.decoy);
    if (i < 0) return { kind: 'miss', points: 0 }; // idle lantern — harmless
    state.flickers.splice(i, 1);
    state.score = Math.max(0, state.score + tune.DECOY_PENALTY);
    state.chain = 0;
    state.lastCatchT = -99;
    state.decoysTapped += 1;
    state.events.push({ type: 'decoy', decoy: target.decoy, points: tune.DECOY_PENALTY });
    return { kind: 'decoy', points: tune.DECOY_PENALTY };
  }

  if (target?.kind === 'token') {
    const i = state.tokens.findIndex((tok) => tok.window === target.window);
    if (i < 0) return { kind: 'miss', points: 0 };
    const token = state.tokens[i];
    state.tokens.splice(i, 1);
    if (token.kind === 'lantern') {
      state.lanternT = tune.LANTERN_SEC;
    } else {
      state.netLeft = tune.NET_CATCHES;
    }
    state.events.push({ type: 'powerup', kind: token.kind });
    return { kind: 'token', points: 0, powerup: token.kind };
  }

  // tapped into the night — the chain fizzles (no penalty)
  state.chain = 0;
  return { kind: 'miss', points: 0 };
}

/**
 * §C10.1 bot (dev-only ?autoplay=1): taps real ghosts at spawn+200 ms with a
 * human-ish engagement rate, always grabs powerup tokens, NEVER taps decoys.
 * Call once per frame; returns the taps it wants performed (the visual layer
 * animates them, tests apply them directly).
 * @param {object} state
 * @returns {Array<{kind: string, id?: number, window?: number}>}
 */
export function botStep(state) {
  const tune = state.tune;
  if (!state.bot) {
    state.bot = { rng: mulberry32((state.seed ^ 0x7f4a7c15) >>> 0), nextFreeT: 0, marks: new Map() };
  }
  const bot = state.bot;
  const taps = [];
  if (state.ended) return taps;

  // mark each ghost go/skip ONCE, in spawn order (deterministic per seed)
  for (const g of state.ghosts) {
    if (!bot.marks.has(g.id)) {
      const engage = g.wave != null ? tune.BOT_WAVE_ENGAGE : tune.BOT_ENGAGE;
      bot.marks.set(g.id, bot.rng() < engage);
    }
  }
  // powerup tokens: always collect (shortly after they appear)
  for (const token of state.tokens) {
    if (state.t >= token.startT + 0.3 && state.t >= bot.nextFreeT) {
      taps.push({ kind: 'token', window: token.window });
      bot.nextFreeT = state.t + tune.BOT_MIN_GAP_SEC;
    }
  }
  // ghosts: tap at spawn+BOT_REACT_SEC, one tap per BOT_MIN_GAP_SEC
  for (const g of state.ghosts) {
    if (!bot.marks.get(g.id)) continue;
    if (state.t < g.spawnT + tune.BOT_REACT_SEC) continue;
    if (state.t < bot.nextFreeT) break;
    taps.push({ kind: 'ghost', id: g.id });
    bot.nextFreeT = state.t + tune.BOT_MIN_GAP_SEC;
  }
  return taps;
}

/** Round score (floored at 0 by construction). @param {object} state @returns {number} */
export function huntScore(state) {
  return Math.max(0, Math.round(state.score));
}

/**
 * V4/G74 §G5.4 certification sim: one full seeded bot round at `mode`,
 * fixed 30 Hz stepping — deterministic, no DOM. The per-mode BOT_ENGAGE
 * rates make the bot a human-rate proxy (§G5.4: Schwer target 90 in ≥ 1/5
 * seeds; Leicht mean ≥ Schwer mean). Endlos terminates through the
 * 3-escaped-Boo-waves condition (maxSec is only a safety net).
 * @param {string} [mode] @param {number} [seed] @param {number} [maxSec]
 * @returns {{score: number, caught: number, missed: number, escapedWaves: number,
 *   booBonuses: number, time: number}}
 */
export function simulateHuntAutoplay(mode = 'normal', seed = 1, maxSec = 900) {
  const tune = applyDifficulty(HUNT, mode);
  const state = createHunt(seed, tune);
  const dt = 1 / 30;
  while (!state.ended && state.t < maxSec) {
    stepHunt(state, dt);
    if (state.ended) break;
    for (const tap of botStep(state)) tapHunt(state, tap);
    state.events.length = 0; // headless: drop the render event queue
  }
  return {
    score: huntScore(state),
    caught: state.caught,
    missed: state.missed,
    escapedWaves: state.escapedWaves,
    booBonuses: state.booBonuses,
    time: state.t,
  };
}

/** §B3 meta payload (§C10.1: meta ghostsCaught). @param {object} state */
export function runMeta(state) {
  return { ghostsCaught: state.caught, decoysTapped: state.decoysTapped, booBonuses: state.booBonuses };
}
