// Star Hopper — pure gameplay logic (PLAN2 §C1.2 #8, agent V2/G25). No
// three.js / DOM imports so test/minigamesE.test.js runs headlessly (§B rule).
// The visual module (starHopper.js) maps this state onto meshes; ALL gameplay
// numbers not covered by §C1 (COIN_TABLE.starHopper lives in
// data/constants.js) are centralized in HOPPER below — never inline them.
//
// Binding §C1.2 #8 rules implemented here:
//   · 3 lanes; Gooby pilots space-kit/craft_speederA up a starfield
//   · meteors tumble down with 70% forgiving hitboxes
//   · star pickups +3, rare golden carrots +10, drifting between lanes
//   · speed +5% every 10 s; meteor showers telegraphed by warning stripes
//   · one hit = end — shielded first hit at score ≥ 60 (shield pickup
//     spawns exactly once per round)
//   · score = distanceM/10 + pickups · ~75 s round
//   · tap left/right half = 1 lane, swipe = 2 lanes
//   · autoplay: greedy bot — highest-value safe lane each 0.4 s window

/** Star Hopper tuning (§C1.2 #8 binding numbers + V2/G25 feel knobs). */
export const HOPPER = Object.freeze({
  LANES: 3,
  /** World x of each lane center (wu) — portrait-frame friendly. */
  LANE_X: Object.freeze([-1.15, 0, 1.15]),
  /** Round cap (§C1.2 #8: duration ~75 s; one hit ends earlier). */
  DURATION_SEC: 75,
  /** Base climb speed (m/s) — §C1.2 #8 ramps it +5% per 10 s. */
  BASE_SPEED: 11,
  SPEED_RAMP_PCT: 0.05,
  SPEED_RAMP_EVERY_SEC: 10,
  /** Speed cap so late-game rows stay reactable (75 s tops out at ~15.5). */
  MAX_SPEED: 19,
  /** §C1.2 #8: meteors get forgiving 70% hitboxes. */
  HITBOX_SCALE: 0.7,
  /** Collision half-extents along the travel axis (m). */
  PLAYER_HALF_M: 3.2,
  METEOR_HALF_M: 3.4,
  /** Pickup values (§C1.2 #8: stars +3, golden carrots +10). */
  STAR_POINTS: 3,
  GOLD_POINTS: 10,
  /** Shield pickup spawns once when the score reaches this (§C1.2 #8). */
  SHIELD_SCORE: 60,
  /** Score = distanceM / 10 + pickups (§C1.2 #8). */
  DISTANCE_PER_POINT_M: 10,
  /** Lane-change slide time (s); a swipe covers 2 lanes in one slide. */
  LANE_CHANGE_SEC: 0.16,
  /** Meters between successive meteor rows at difficulty 0 → 1. */
  ROW_GAP_M: Object.freeze({ start: 27, end: 18 }),
  /** Difficulty reaches 1 after this many seconds. */
  DIFFICULTY_FULL_SEC: 60,
  /** Chance a row blocks 2 lanes (ramps start → end with difficulty). */
  DOUBLE_BLOCK_CHANCE: Object.freeze({ start: 0.2, end: 0.55 }),
  /** Per-row pickup roll (§C1.2 #8 spawn table): gold rare, stars common. */
  GOLD_CHANCE: 0.05,
  STAR_CHANCE: 0.38,
  /** Meteor showers (§C1.2 #8): telegraphed by warning stripes. */
  SHOWER_EVERY_SEC: 14,
  SHOWER_TELEGRAPH_SEC: 1.3,
  SHOWER_DURATION_SEC: 2.2,
  SHOWER_DROP_EVERY_SEC: 0.35,
  /** Shower meteors streak with this extra down-track speed (m/s) so they
   *  land WHILE the warning stripes are lit (~1.4 s after each drop). */
  SHOWER_METEOR_SPEED: 38,
  /** Greedy autoplay decision window (§C1.2 #8: 0.4 s). */
  BOT_WINDOW_SEC: 0.4,
  /** Bot margin past decide+slide before a lane counts as unsafe (s). */
  BOT_GUARD_SEC: 0.5,
  /** Bot margin for crossing the middle lane during a 2-lane swipe (s). */
  BOT_TRANSIT_GUARD_SEC: 0.35,
  /** Reflex: a threat entering the CURRENT lane within this many seconds
   *  lets the bot dodge immediately instead of waiting for the next tick. */
  BOT_PANIC_SEC: 0.45,
  /** Anti-tunneling: largest meteor approach between collision samples (m). */
  MAX_SWEEP_STEP_M: 2.0,
  /** Post-shield-pop grace so the popping hit can't chain-kill (s). */
  SHIELD_POP_INVULN_SEC: 1.2,
  /** V3/G44 (§C10.2): one rare wormhole gate per run at most. */
  WORMHOLE_FIRST_SEC: 18,
  WORMHOLE_CHANCE: 0.08,
  WORMHOLE_SEC: 2,
  WORMHOLE_TICK_SEC: 0.2,
  WORMHOLE_TICK_POINTS: 1,
  /** Suppress the tap synthesized at the end of a two-lane swipe. */
  SWIPE_TAP_SUPPRESS_SEC: 0.18,
});

/**
 * Climb speed after `elapsed` seconds: +5% (compounding) every 10 s,
 * capped at MAX_SPEED (§C1.2 #8).
 * @param {number} elapsed seconds since the round started
 * @param {object} [tune] HOPPER override (tests)
 * @returns {number} m/s
 */
export function speedAt(elapsed, tune = HOPPER) {
  const steps = Math.floor(Math.max(0, elapsed) / tune.SPEED_RAMP_EVERY_SEC);
  return Math.min(tune.MAX_SPEED, tune.BASE_SPEED * (1 + tune.SPEED_RAMP_PCT) ** steps);
}

/**
 * Difficulty 0..1 ramp used by row spacing / double-block chance.
 * @param {number} elapsed seconds
 * @param {object} [tune]
 * @returns {number}
 */
export function difficultyAt(elapsed, tune = HOPPER) {
  return Math.min(1, Math.max(0, elapsed / tune.DIFFICULTY_FULL_SEC));
}

/** Lerp helper for {start,end} difficulty knobs. */
function ramp(knob, d) {
  return knob.start + (knob.end - knob.start) * d;
}

/**
 * Meters to the next meteor row at a difficulty.
 * @param {number} difficulty 0..1
 * @param {object} [tune]
 * @returns {number}
 */
export function rowGapAt(difficulty, tune = HOPPER) {
  return ramp(tune.ROW_GAP_M, difficulty);
}

/**
 * Round score (§C1.2 #8): floor(distanceM / 10) + pickup points.
 * @param {number} distanceM meters climbed
 * @param {number} pickupPoints accumulated star/golden-carrot points
 * @returns {number}
 */
export function hopperScore(distanceM, pickupPoints) {
  return Math.max(0, Math.floor(distanceM / HOPPER.DISTANCE_PER_POINT_M) + Math.round(pickupPoints));
}

/**
 * Lane after tapping the left/right screen half (§C1.2 #8: 1 lane, clamped).
 * @param {number} lane current lane 0..2
 * @param {'left'|'right'} side tapped screen half
 * @param {object} [tune]
 * @returns {number}
 */
export function laneAfterTap(lane, side, tune = HOPPER) {
  const next = lane + (side === 'left' ? -1 : 1);
  return Math.max(0, Math.min(tune.LANES - 1, next));
}

/**
 * Lane after a horizontal swipe (§C1.2 #8: swipe = 2 lanes, clamped).
 * @param {number} lane current lane 0..2
 * @param {'left'|'right'} dir swipe direction
 * @param {object} [tune]
 * @returns {number}
 */
export function laneAfterSwipe(lane, dir, tune = HOPPER) {
  const next = lane + (dir === 'left' ? -2 : 2);
  return Math.max(0, Math.min(tune.LANES - 1, next));
}

/**
 * Resolve one normalized gesture while honoring the swipe→tap suppression
 * audit. Some pointer stacks emit a tap after swipeend; that tap must not
 * undo a two-lane jump.
 */
export function laneAfterGesture(lane, gesture, suppressTap = false, tune = HOPPER) {
  if (gesture.kind === 'tap') {
    return suppressTap ? lane : laneAfterTap(lane, gesture.side, tune);
  }
  return laneAfterSwipe(lane, gesture.dir, tune);
}

/**
 * Collision test for one frame (§C1.5 lane-collision window). Positions are
 * absolute track meters; the meteor's hitbox is scaled to 70% (§C1.2 #8).
 * @param {{lane: number, m: number}} player
 * @param {{lane: number, m: number}} meteor
 * @param {object} [tune]
 * @returns {boolean} true when this frame is a hit
 */
export function hitsMeteor(player, meteor, tune = HOPPER) {
  if (player.lane !== meteor.lane) return false;
  const reach = tune.HITBOX_SCALE * (tune.PLAYER_HALF_M + tune.METEOR_HALF_M);
  return Math.abs(meteor.m - player.m) <= reach;
}

/**
 * Swept collision test (anti-tunneling): the player advances `dm` meters this
 * frame — at low FPS a single endpoint check can skip clean across the
 * ±HITBOX_SCALE·(halves) window — so sample the advance every
 * ≤ MAX_SWEEP_STEP_M (endpoint inclusive).
 * @param {{lane: number, m: number}} player PRE-advance position
 * @param {{lane: number, m: number}} meteor
 * @param {number} dm player track advance this frame (m, speed × dt)
 * @param {object} [tune]
 * @returns {boolean}
 */
export function sweepHitsMeteor(player, meteor, dm, tune = HOPPER) {
  const steps = Math.max(1, Math.ceil(Math.abs(dm) / tune.MAX_SWEEP_STEP_M));
  for (let i = 1; i <= steps; i += 1) {
    if (hitsMeteor({ lane: player.lane, m: player.m + (dm * i) / steps }, meteor, tune)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Spawn tables + survivability (§C1.5: "spawn tables" test scope)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MeteorRow
 * @property {boolean[]} blocked  per-lane meteor flags
 * @property {number} gap  meters from the PREVIOUS row to this one
 */

/**
 * Lanes the craft can shift across while covering `gapM` meters at `speed`
 * (per-lane slide cost + reaction margin; a swipe covers 2 lanes so the cap
 * is the full lane span).
 * @param {number} gapM
 * @param {number} speed m/s
 * @param {object} [tune]
 * @returns {number} 0..2
 */
export function maxLaneShift(gapM, speed, tune = HOPPER) {
  const time = gapM / Math.max(0.001, speed);
  const perChange = tune.LANE_CHANGE_SEC + 0.22; // slide + react/settle margin
  return Math.max(0, Math.min(tune.LANES - 1, Math.floor(time / perChange)));
}

/**
 * Reachability check across consecutive rows (same DP as runner §C6.1 #6):
 * a chain is survivable when at least one lane path exists through ALL rows.
 * @param {MeteorRow[]} rows in spawn order; rows[i].gap = meters from row i−1
 * @param {number} speed m/s (use the max alive speed for a conservative check)
 * @param {object} [tune]
 * @returns {boolean}
 */
export function isChainSurvivable(rows, speed, tune = HOPPER) {
  let reachable = new Array(tune.LANES).fill(true); // craft may start anywhere
  for (const row of rows) {
    const shift = maxLaneShift(row.gap, speed, tune);
    const next = new Array(tune.LANES).fill(false);
    for (let to = 0; to < tune.LANES; to += 1) {
      if (row.blocked[to]) continue;
      for (let from = 0; from < tune.LANES; from += 1) {
        if (reachable[from] && Math.abs(to - from) <= shift) {
          next[to] = true;
          break;
        }
      }
    }
    reachable = next;
    if (!reachable.some(Boolean)) return false;
  }
  return true;
}

/**
 * Generate the next meteor row, guaranteed survivable w.r.t. the recent rows
 * at `speed` (§C1.5 spawn-table rule: always ≥ 1 reachable free lane).
 * @param {() => number} rng
 * @param {number} elapsed seconds since round start
 * @param {MeteorRow[]} recentRows the last few generated rows (window)
 * @param {object} [tune]
 * @returns {MeteorRow}
 */
export function generateRow(rng, elapsed, recentRows, tune = HOPPER) {
  const d = difficultyAt(elapsed, tune);
  const speed = speedAt(elapsed, tune);
  const gap = rowGapAt(d, tune) * (0.9 + rng() * 0.25);
  const window = recentRows.slice(-4);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const blocked = new Array(tune.LANES).fill(false);
    const blockCount = rng() < ramp(tune.DOUBLE_BLOCK_CHANCE, d) ? 2 : 1;
    const laneOrder = [0, 1, 2].sort(() => rng() - 0.5);
    for (let b = 0; b < blockCount; b += 1) blocked[laneOrder[b]] = true;
    const row = { blocked, gap };
    if (isChainSurvivable([...window, row], speed, tune)) return row;
  }
  // Fallback: single meteor off-center — trivially survivable.
  const blocked = new Array(tune.LANES).fill(false);
  blocked[0] = true;
  return { blocked, gap };
}

/**
 * Per-row pickup roll (§C1.5 spawn table): one rng draw → rare golden carrot,
 * common star, or nothing. Values per §C1.2 #8.
 * @param {() => number} rng
 * @param {object} [tune]
 * @returns {{kind: 'gold'|'star', points: number}|null}
 */
export function rollPickup(rng, tune = HOPPER) {
  const r = rng();
  if (r < tune.GOLD_CHANCE) return { kind: 'gold', points: tune.GOLD_POINTS };
  if (r < tune.GOLD_CHANCE + tune.STAR_CHANCE) return { kind: 'star', points: tune.STAR_POINTS };
  return null;
}

/**
 * §C1.2 #8: the single shield pickup spawns once the score reaches 60.
 * @param {number} score current round score
 * @param {boolean} alreadySpawned
 * @param {object} [tune]
 * @returns {boolean}
 */
export function shouldSpawnShield(score, alreadySpawned, tune = HOPPER) {
  return !alreadySpawned && score >= tune.SHIELD_SCORE;
}

/** Seeded rare gate rule: eligible after 18 s, never more than once/run. */
export function shouldSpawnWormhole(rng, elapsed, alreadySpawned, active, tune = HOPPER) {
  return !alreadySpawned && !active && elapsed >= tune.WORMHOLE_FIRST_SEC && rng() < tune.WORMHOLE_CHANCE;
}

/**
 * Frame-rate-independent +1 awards at each 0.2 s boundary of the two-second
 * tunnel (exactly ten points for a complete traversal).
 */
export function wormholeAwards(previousSec, nextSec, tune = HOPPER) {
  const a = Math.min(tune.WORMHOLE_SEC, Math.max(0, previousSec));
  const b = Math.min(tune.WORMHOLE_SEC, Math.max(0, nextSec));
  return Math.max(0, Math.floor((b + 1e-9) / tune.WORMHOLE_TICK_SEC) - Math.floor((a + 1e-9) / tune.WORMHOLE_TICK_SEC));
}

/**
 * Pick the lanes of a telegraphed meteor shower: 2 danger lanes, 1 safe lane
 * (the telegraph window is long enough to reach any lane via a 2-lane swipe).
 * @param {() => number} rng
 * @param {object} [tune]
 * @returns {{safe: number, danger: number[]}}
 */
export function pickShowerLanes(rng, tune = HOPPER) {
  const safe = Math.min(tune.LANES - 1, Math.floor(rng() * tune.LANES));
  const danger = [];
  for (let i = 0; i < tune.LANES; i += 1) if (i !== safe) danger.push(i);
  return { safe, danger };
}

/**
 * Resolve a meteor hit (§C1.2 #8: one hit = end, shielded first hit
 * survives and consumes the shield).
 * @param {boolean} shielded
 * @returns {{ended: boolean, shielded: boolean}}
 */
export function resolveHit(shielded) {
  return { ended: !shielded, shielded: false };
}

/**
 * Greedy autoplay lane choice (§C1.2 #8: move toward the highest-value safe
 * lane each 0.4 s window). Ties prefer the current lane, then the smaller
 * shift. Falls back to the current lane when nothing is safe.
 * @param {number} current current lane 0..2
 * @param {Array<{safe: boolean, value: number}>} lanes per-lane outlook
 * @param {object} [tune]
 * @returns {number} target lane
 */
export function chooseLane(current, lanes, tune = HOPPER) {
  let best = -1;
  for (let i = 0; i < tune.LANES; i += 1) {
    if (!lanes[i]?.safe) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const dv = lanes[i].value - lanes[best].value;
    if (dv > 0) best = i;
    else if (dv === 0) {
      const keepsCurrent = i === current && best !== current;
      const closer = Math.abs(i - current) < Math.abs(best - current);
      if (keepsCurrent || (best !== current && closer)) best = i;
    }
  }
  return best === -1 ? current : best;
}

/**
 * Time-based lane outlook for the bot. A threat is a meteor approaching the
 * craft at `approach` m/s (climb speed, + streak for shower meteors); its
 * contact window is [enter, exit] seconds from now. A lane is:
 *  · unsafe    — some threat enters within `horizonSec` (decide + slide + guard)
 *  · !transit  — some threat enters within `transitSec` (the brief window the
 *                craft occupies a middle lane during a 2-lane swipe)
 * @param {Array<{lane: number, m: number, approach: number}>} threats
 * @param {number} traveled craft track position (m)
 * @param {number} horizonSec
 * @param {number} transitSec
 * @param {object} [tune]
 * @returns {{safe: boolean[], transit: boolean[], enter: number[]}} enter[i] =
 *   seconds until lane i's first contact (Infinity when clear)
 */
export function laneOutlook(threats, traveled, horizonSec, transitSec, tune = HOPPER) {
  const reach = tune.HITBOX_SCALE * (tune.PLAYER_HALF_M + tune.METEOR_HALF_M);
  const safe = new Array(tune.LANES).fill(true);
  const transit = new Array(tune.LANES).fill(true);
  const enter = new Array(tune.LANES).fill(Infinity);
  for (const th of threats) {
    const dist = th.m - traveled;
    const tEnter = (dist - reach) / th.approach;
    const tExit = (dist + reach) / th.approach;
    if (tExit < 0) continue; // already passed below the craft
    if (tEnter <= horizonSec) safe[th.lane] = false;
    if (tEnter <= transitSec) transit[th.lane] = false;
    enter[th.lane] = Math.min(enter[th.lane], Math.max(0, tEnter));
  }
  return { safe, transit, enter };
}

/**
 * Bot move for this window: chooseLane's pick, but a 2-lane swipe is only
 * taken when the middle lane is transit-safe — otherwise hold the current
 * lane for a clean crossing (or, boxed in, duck to whichever of current /
 * middle is threatened latest).
 * @param {number} current lane 0..2
 * @param {Array<{safe: boolean, value: number, transitSafe: boolean, enter: number}>} lanes
 * @param {object} [tune]
 * @returns {number} lane to slide to
 */
export function planMove(current, lanes, tune = HOPPER) {
  const target = chooseLane(current, lanes, tune);
  if (Math.abs(target - current) < 2) return target;
  const mid = (target + current) / 2;
  if (lanes[mid]?.transitSafe) return target;
  if (lanes[current]?.safe) return current; // wait one window, cross clean
  return (lanes[mid]?.enter ?? 0) > (lanes[current]?.enter ?? 0) ? mid : current;
}
