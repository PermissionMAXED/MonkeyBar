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
});

/**
 * Lower the hook while held (§C6.1: depth grows while held), clamped.
 * @param {number} depth current depth (wu below surface)
 * @param {number} dt seconds
 * @returns {number}
 */
export function lowerDepth(depth, dt) {
  return Math.min(FISHING.MAX_DEPTH, depth + FISHING.LOWER_SPEED * dt);
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
export function reelResolve(tapCount, elapsedSec) {
  if (tapCount >= FISHING.REEL_TAPS) return 'caught';
  if (elapsedSec >= FISHING.REEL_WINDOW_SEC) return 'escaped';
  return 'reeling';
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
export function shouldSpawnBoot(rng, sinceLastBootSec) {
  if (sinceLastBootSec < FISHING.BOOT_MIN_GAP_SEC) return false;
  return rng() < FISHING.BOOT_CHANCE;
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
});

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
// ══════════════════════════════════════════════════════════ end V2/G23 ═══
