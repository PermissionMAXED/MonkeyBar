// Fishing Pond — pure catch/depth/rarity/reel logic (§C6.1 #10, agent G10).
// No three.js/DOM imports so `node --test` runs this headlessly (§B rule);
// the game module (fishingPond.js) imports from here. Binding §C6.1 numbers:
// 90 s round, HOLD lowers the hook, RELEASE hooks the nearest fish at that
// depth within the catch radius; fish S/M/L worth 2/3/5; an occasional boot
// drifts by (−3); L fish need a reel-in wiggle (~5 taps in 2 s else the fish
// escapes). Coin row (§C6): divisor 3, min 4, max 26, typical raw ≈ 45 → ~15c.

/** Binding §C6.1 #10 numbers + G10 tuning (pond geometry, cadence knobs). */
export const FISHING = Object.freeze({
  /** Round length (§C6.1: 90 s). */
  DURATION_SEC: 90,
  /** Fish values by size (§C6.1: S/M/L worth 2/3/5). */
  VALUES: Object.freeze({ S: 2, M: 3, L: 5, boot: -3 }),
  /** L fish reel-in wiggle (§C6.1: ~5 rapid taps in 2 s else it escapes). */
  REEL_TAPS: 5,
  REEL_WINDOW_SEC: 2,
  /** V3/G44 audit: one render hitch may consume at most this much reel time. */
  REEL_MAX_FRAME_SEC: 0.1,
  /** RELEASE hooks the nearest swimmer within this radius (wu). */
  CATCH_RADIUS: 0.55,
  // --- G10 tuning ---
  /** Hook line x (wu) — fish are caught near the line. */
  HOOK_X: 0,
  /** Hook depth below the surface: 0 (rest) … MAX_DEPTH (wu). */
  MAX_DEPTH: 3.9,
  /** Hook speeds (wu/s): lower while held, auto-raise after release. */
  LOWER_SPEED: 2.1,
  RAISE_SPEED: 3.4,
  /** Fish swim band (depth below surface, wu). */
  FISH_DEPTH_MIN: 0.55,
  FISH_DEPTH_MAX: 3.7,
  /** Lateral pond extent for swimmers (wu). */
  POND_HALF_W: 1.8,
  /** Concurrent fish. */
  FISH_COUNT: 7,
  /** Respawn delay after a fish is caught (s). */
  RESPAWN_SEC: 1.2,
  /** Size rarity weights + visual scale + lateral speed range (wu/s). */
  SIZES: Object.freeze({
    S: Object.freeze({ weight: 45, scale: 0.34, speed: Object.freeze([0.5, 0.85]) }),
    M: Object.freeze({ weight: 35, scale: 0.5, speed: Object.freeze([0.38, 0.62]) }),
    L: Object.freeze({ weight: 20, scale: 0.72, speed: Object.freeze([0.28, 0.48]) }),
  }),
  /** Boot cadence: eligible after this gap, then rolled per eligibility check. */
  BOOT_MIN_GAP_SEC: 14,
  BOOT_CHANCE: 0.6,
  BOOT_SPEED: 0.28,
  /** §G5 mode metadata. */
  ENDLESS: false,
  ENDLESS_FAILURE_LIMIT: 3,
});

/** §G5 timed-arena difficulty (normal returns the frozen base verbatim). */
export function applyDifficulty(tune = FISHING, mode = 'normal') {
  if (mode === 'normal' || !['easy', 'hard', 'endless'].includes(mode)) return tune;
  const hard = mode === 'hard' || mode === 'endless';
  const spawnMult = hard ? 0.85 : 1.2;
  const windowMult = hard ? 0.8 : 1.25;
  return Object.freeze({
    ...tune,
    DURATION_SEC: hard ? tune.DURATION_SEC : tune.DURATION_SEC * 1.2,
    RESPAWN_SEC: tune.RESPAWN_SEC * spawnMult,
    BOOT_MIN_GAP_SEC: tune.BOOT_MIN_GAP_SEC * spawnMult,
    REEL_WINDOW_SEC: Math.max(0.35, tune.REEL_WINDOW_SEC * windowMult),
    CATCH_RADIUS: Math.max(tune.CATCH_RADIUS * 0.55, tune.CATCH_RADIUS * windowMult),
    ENDLESS: mode === 'endless',
  });
}

/** §G5.4: line breaks (escaped L fish) and caught boots share the limit. */
export function createFishingEndlessState(limit = FISHING.ENDLESS_FAILURE_LIMIT) {
  return { failures: 0, limit, ended: false };
}

export function recordFishingFailure(state, kind) {
  if ((kind === 'lineBreak' || kind === 'boot') && !state.ended) state.failures += 1;
  state.ended = state.failures >= state.limit;
  return state.ended;
}

/**
 * Lower the hook while held (§C6.1: depth grows while held), clamped.
 * @param {number} depth current depth (wu below surface)
 * @param {number} dt seconds
 * @returns {number}
 */
export function lowerDepth(depth, dt, tune = FISHING) {
  return Math.min(tune.MAX_DEPTH, depth + tune.LOWER_SPEED * dt);
}

/**
 * Catch value by kind (§C6.1: S 2 / M 3 / L 5 / boot −3).
 * @param {'S'|'M'|'L'|'boot'} kind
 * @returns {number}
 */
export function catchValue(kind) {
  return FISHING.VALUES[kind];
}

/**
 * Whether a hooked catch needs the reel-in wiggle (§C6.1: L fish only).
 * @param {'S'|'M'|'L'|'boot'} kind
 * @returns {boolean}
 */
export function needsReel(kind) {
  return kind === 'L';
}

/**
 * RELEASE rule (§C6.1): hook the nearest swimmer (fish or boot) to the hook
 * position within the catch radius, measured in the x/depth plane.
 * @param {Array<{x: number, depth: number}>} items live swimmers
 * @param {number} hookX
 * @param {number} hookDepth
 * @param {number} [radius]
 * @returns {number} index of the hooked item, or −1 when nothing is in range
 */
export function nearestCatch(items, hookX, hookDepth, radius = FISHING.CATCH_RADIUS) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < items.length; i += 1) {
    const d = Math.hypot(items[i].x - hookX, items[i].depth - hookDepth);
    if (d <= radius && d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Reel-in wiggle resolution (§C6.1: ~5 rapid taps within 2 s else escape).
 * @param {number} tapCount taps since the reel started
 * @param {number} elapsedSec seconds since the reel started
 * @returns {'caught'|'escaped'|'reeling'}
 */
export function reelResolve(tapCount, elapsedSec, tune = FISHING) {
  if (tapCount >= tune.REEL_TAPS) return 'caught';
  if (elapsedSec >= tune.REEL_WINDOW_SEC) return 'escaped';
  return 'reeling';
}

/**
 * Hitch-tolerant reel timer. Input cannot arrive during a blocked render
 * frame, so charging an entire long frame against the two-second window
 * unfairly made big fish escape.
 */
export function advanceReelElapsed(elapsedSec, dt, tune = FISHING) {
  return elapsedSec + Math.min(Math.max(0, dt), tune.REEL_MAX_FRAME_SEC);
}

/**
 * Roll a fish size by rarity weight (S common … L rare).
 * @param {() => number} rng 0..1
 * @returns {'S'|'M'|'L'}
 */
export function rollFishKind(rng) {
  const entries = Object.entries(FISHING.SIZES);
  const total = entries.reduce((s, [, v]) => s + v.weight, 0);
  let roll = rng() * total;
  for (const [kind, v] of entries) {
    roll -= v.weight;
    if (roll < 0) return /** @type {'S'|'M'|'L'} */ (kind);
  }
  return 'S';
}

/**
 * Lateral swim speed for a size (bigger fish are slower).
 * @param {'S'|'M'|'L'} kind
 * @param {() => number} rng
 * @returns {number} wu/s
 */
export function fishSpeedFor(kind, rng) {
  const [lo, hi] = FISHING.SIZES[kind].speed;
  return lo + rng() * (hi - lo);
}

/**
 * Boot cadence (§C6.1: "a boot drifts occasionally"): eligible once
 * BOOT_MIN_GAP_SEC has passed since the last boot, then a chance roll.
 * @param {() => number} rng
 * @param {number} sinceLastBootSec
 * @returns {boolean}
 */
export function shouldSpawnBoot(rng, sinceLastBootSec, tune = FISHING) {
  if (sinceLastBootSec < tune.BOOT_MIN_GAP_SEC) return false;
  return rng() < tune.BOOT_CHANCE;
}

/**
 * Apply a catch to the score, floored at 0 (a boot never drops the round
 * below zero — coin clamp min 4 covers the floor anyway).
 * @param {number} score
 * @param {number} value
 * @returns {number}
 */
export function applyCatch(score, value) {
  return Math.max(0, score + value);
}

/** Deterministic, mechanics-based certification bot using the derived tune. */
export function simulateFishingAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(FISHING, mode);
  const rng = (() => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const duration = tune.ENDLESS ? 120 : tune.DURATION_SEC;
  // A real autoplay catch cycle overlaps hook travel with the seven live
  // swimmers; only the replacement fish waits RESPAWN_SEC. Model that
  // concurrency instead of charging the full delay to every attempt.
  const attempts = Math.floor(duration / (1.75 + tune.RESPAWN_SEC * 0.25));
  let score = 0;
  let failures = 0;
  for (let i = 0; i < attempts; i += 1) {
    const kind = rollFishKind(rng);
    const accuracy = Math.min(0.94, 0.72 * (tune.CATCH_RADIUS / FISHING.CATCH_RADIUS));
    if (rng() > accuracy) continue;
    if (kind === 'L' && rng() > Math.min(0.96, tune.REEL_WINDOW_SEC / 2.2)) {
      failures += 1;
      continue;
    }
    score = applyCatch(score, catchValue(kind));
  }
  return { score, failures, tune };
}

// ══════════════════════════════════════════════════════════════ V2/G23 ═══
// §C6 fish-set species roll (album set 1, 8 species): every spawned fish gets
// a species from its size via the seeded ctx.rng — the species COLOR is
// visible in the pond, the catch reports `meta.caught` (§B3) and the album
// awards ride the framework's V2/G23 forwarding block. Binding rules (§C6):
// S → minnow/dace/carp · M → koi/bass · L → whopper/eel; goldenFish = 2% roll
// on any L; nightEel only during the night band (§C10.3 — the game checks
// dayNight.bandAt at init and passes `night` here).

/** Size → species candidates (§C6 row 1, verbatim mapping). */
export const FISH_SPECIES = Object.freeze({
  S: Object.freeze(['tinyMinnow', 'blueDace', 'sunnyCarp']),
  M: Object.freeze(['pinkKoi', 'stripeBass']),
  L: Object.freeze(['bigWhopper', 'nightEel']),
});

/** §C6: goldenFish chance on any L roll (2%). */
export const GOLDEN_FISH_CHANCE = 0.02;

/** Night L split when the golden roll misses: eel vs whopper (50/50). */
export const NIGHT_EEL_CHANCE = 0.5;

/** Species tint for the pond swimmers (visible color roll, §C6). */
export const SPECIES_COLORS = Object.freeze({
  tinyMinnow: '#9FB2C8',
  blueDace: '#5B8BD9',
  sunnyCarp: '#E8A33D',
  pinkKoi: '#E88BB0',
  stripeBass: '#7A9E7E',
  bigWhopper: '#4E6E8E',
  nightEel: '#6E5E9E',
  goldenFish: '#FFD24A',
  pearlMinnow: '#D8F5F2',
  sunsetKoi: '#FF8A6B',
  gildedWhopper: '#F7C948',
});

/**
 * V3/G44 (§C10.2): one rare visual variant per size. `weight` is its chance
 * out of 100 size-matched spawns; collectionId deliberately maps into the
 * existing v2 fish album so the collection catalog remains unchanged.
 */
export const RARE_SPECIES = Object.freeze({
  pearlMinnow: Object.freeze({ kind: 'S', weight: 8, collectionId: 'tinyMinnow' }),
  sunsetKoi: Object.freeze({ kind: 'M', weight: 5, collectionId: 'pinkKoi' }),
  gildedWhopper: Object.freeze({ kind: 'L', weight: 2, collectionId: 'goldenFish' }),
});

export const RARE_SET_BONUS = 15;

/**
 * Roll a species for a spawned fish (§C6, deterministic per rng stream):
 * L first rolls goldenFish at 2%, then (night only) eel vs whopper 50/50 —
 * day L is always the whopper. S/M pick uniformly from their candidates.
 * @param {'S'|'M'|'L'} kind size from rollFishKind
 * @param {() => number} rng seeded 0..1 stream (ctx.rng)
 * @param {boolean} [night] night band active (§C10.3 gate for nightEel)
 * @returns {string} §C6 species id
 */
export function rollSpecies(kind, rng, night = false) {
  if (kind === 'L') {
    if (rng() < GOLDEN_FISH_CHANCE) return 'goldenFish';
    if (night && rng() < NIGHT_EEL_CHANCE) return 'nightEel';
    return 'bigWhopper';
  }
  const options = FISH_SPECIES[kind] ?? FISH_SPECIES.S;
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

/**
 * Roll the V3 rare variant first, then the unchanged v2 species table.
 * @returns {{species:string, collectionId:string, rare:boolean}}
 */
export function rollSpeciesDetail(kind, rng, night = false) {
  const rareEntry = Object.entries(RARE_SPECIES).find(([, def]) => def.kind === kind);
  if (rareEntry && rng() * 100 < rareEntry[1].weight) {
    return { species: rareEntry[0], collectionId: rareEntry[1].collectionId, rare: true };
  }
  const species = rollSpecies(kind, rng, night);
  return { species, collectionId: species, rare: false };
}

/** Existing-album id for any base or rare species. */
export function speciesCollectionId(species) {
  return RARE_SPECIES[species]?.collectionId ?? species;
}

/**
 * Set-of-three-in-one-run bonus (§C10.2). Returns 15 exactly when all three
 * rare species have been caught; duplicates never substitute for a member.
 */
export function rareSetBonus(species) {
  const caught = new Set(species);
  return Object.keys(RARE_SPECIES).every((id) => caught.has(id)) ? RARE_SET_BONUS : 0;
}
// ══════════════════════════════════════════════════════════ end V2/G23 ═══
