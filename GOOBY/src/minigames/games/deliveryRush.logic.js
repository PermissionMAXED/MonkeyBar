// Delivery Rush — pure rules (PLAN2 §C1.2 #5, agent V2/G28). No three.js/DOM
// imports so `node --test` runs this headlessly (§B rule); the game module
// (deliveryRush.js) imports from here. Binding §C1.2 #5 numbers: Gooby's van
// starts at the shop with 3 parcels; a seeded sequence of 3 DISTINCT
// destinations from the 6 city landmarks (§C6 set 3); 4 m drop rings award
// +50 each (confetti + doorbell); crashes −5 with a floor at 0 (no tow, no
// fail); time bonus +max(0, 120 − elapsedSec) after the 3rd drop. Coin row
// (§C1.1): divisor 8, min 5, max 32, energy 6 — typical raw ≈ 180 → ~22–24c.

/** Binding §C1.2 #5 numbers + V2/G28 tuning. */
export const DELIVERY = Object.freeze({
  /** Parcels on board = deliveries per round (§C1.2 #5). */
  PARCELS: 3,
  /** The city's landmark count the destinations are sampled from (§C9.3). */
  LANDMARK_POOL: 6,
  /** Drop ring radius around the landmark curbside anchor (m, §C1.2 #5). */
  DROP_RADIUS_M: 4,
  /** Points per delivered parcel (§C1.2 #5). */
  DROP_POINTS: 50,
  /** Crash penalty (§C1.2 #5: −5 each, score floor 0, no tow/fail). */
  CRASH_PENALTY: 5,
  /** Time bonus window: +max(0, 120 − elapsedSec) after drop 3 (§C1.2 #5). */
  TIME_BONUS_FROM_SEC: 120,
  /** V3/G44 (§C10.2): one marked parcel — damage or clean-delivery bonus. */
  FRAGILE_CRASH_PENALTY: 20,
  FRAGILE_CLEAN_BONUS: 15,
  /** §G5/§C-SYS4 derived runtime fields. */
  SPEED_MULT: 1,
  TRAFFIC_DENSITY_MULT: 1,
  CRASH_ALLOWANCE: 0,
  COIN_RATE: 1,
  COIN_INTERVAL_SEC: 8,
  COIN_POINTS: 3,
  ENDLESS: false,
  PARCEL_EXPIRE_SEC: 45,
  ENDLESS_EXPIRED_LIMIT: 3,
});

/** §G5 runner/steer difficulty. Normal preserves the arcade's v3 semantics. */
export function applyDifficulty(tune = DELIVERY, mode = 'normal') {
  if (mode === 'normal' || !['easy', 'hard', 'endless'].includes(mode)) return tune;
  const hard = mode === 'hard' || mode === 'endless';
  return Object.freeze({
    ...tune,
    SPEED_MULT: hard ? 1.2 : 0.85,
    TRAFFIC_DENSITY_MULT: hard ? 1.15 : 0.85,
    CRASH_ALLOWANCE: hard ? tune.CRASH_ALLOWANCE : tune.CRASH_ALLOWANCE + 1,
    ENDLESS: mode === 'endless',
  });
}

/** Apply the plain coin-rate number derived by the scene from ctx.params. */
export function withDeliveryCoinRate(tune, coinRate = 1) {
  const rate = Number.isFinite(coinRate) && coinRate > 0 ? coinRate : 1;
  if (rate === 1) return tune;
  return Object.freeze({
    ...tune,
    COIN_RATE: rate,
    COIN_INTERVAL_SEC: tune.COIN_INTERVAL_SEC / rate,
  });
}

export function createDeliveryEndlessState(limit = DELIVERY.ENDLESS_EXPIRED_LIMIT) {
  return { expired: 0, limit, ended: false };
}

export function recordDeliveryExpiry(state) {
  if (!state.ended) state.expired += 1;
  state.ended = state.expired >= state.limit;
  return state.ended;
}

export function parcelExpired(legElapsed, tune = DELIVERY) {
  return tune.ENDLESS && legElapsed >= tune.PARCEL_EXPIRE_SEC;
}

/**
 * Seeded destination pick (§C1.5): a random sequence of PARCELS DISTINCT
 * landmark ids out of the pool (seeded Fisher–Yates, deterministic per rng
 * stream). The run starts parked at the shop, so a sequence that would ask
 * for parcel #1 to be delivered back to the start point is rotated (the set
 * of 3 distinct destinations is preserved).
 * @param {() => number} rng seeded 0..1 stream (§E8 ctx.rng)
 * @param {string[]} ids the 6 landmark ids (layout.landmarks order)
 * @param {number} [count] destinations to pick (default PARCELS)
 * @returns {string[]} count distinct landmark ids in delivery order
 */
export function pickDeliveries(rng, ids, count = DELIVERY.PARCELS) {
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, count);
  if (picks[0] === 'shop' && picks.length > 1) picks.push(picks.shift());
  return picks;
}

/** Seeded marked parcel index (0..2), rolled after destination selection. */
export function pickFragileParcel(rng, count = DELIVERY.PARCELS) {
  return Math.min(count - 1, Math.floor(rng() * count));
}

/**
 * A crash damages only the currently carried fragile parcel, and only once.
 * The regular −5 crash rule remains separate and unchanged.
 */
export function fragileCrashPenalty(fragileIndex, currentParcel, alreadyDamaged) {
  return fragileIndex === currentParcel && !alreadyDamaged ? DELIVERY.FRAGILE_CRASH_PENALTY : 0;
}

/** Clean +15 when the marked parcel reaches its destination undamaged. */
export function fragileDeliveryBonus(fragileIndex, deliveredParcel, damaged) {
  return fragileIndex === deliveredParcel && !damaged ? DELIVERY.FRAGILE_CLEAN_BONUS : 0;
}

/**
 * Apply one delivered parcel to the score (§C1.2 #5: +50).
 * @param {number} score
 * @returns {number}
 */
export function applyDrop(score) {
  return score + DELIVERY.DROP_POINTS;
}

/**
 * Apply one traffic crash to the score (§C1.2 #5: −5, floored at 0 — crashes
 * only ever cost time and points, never a tow or a fail).
 * @param {number} score
 * @returns {number} new score ≥ 0
 */
export function applyCrash(score) {
  return Math.max(0, score - DELIVERY.CRASH_PENALTY);
}

/**
 * Time bonus after the 3rd drop (§C1.2 #5: +max(0, 120 − elapsedSec)).
 * Fractional seconds floor to whole points (score stays an integer).
 * @param {number} elapsedSec seconds since round start
 * @returns {number} bonus points ≥ 0
 */
export function timeBonus(elapsedSec, tune = DELIVERY) {
  return Math.max(0, Math.floor(tune.TIME_BONUS_FROM_SEC - elapsedSec));
}

/**
 * Full-round score for a clean sequential run (test/tuning helper — the game
 * accrues incrementally via applyDrop/applyCrash): drops first, then crashes
 * with the floor, then the bonus once all parcels landed.
 * @param {number} drops parcels delivered (0..PARCELS)
 * @param {number} crashes traffic crashes
 * @param {number} elapsedSec round time at the 3rd drop
 * @returns {number}
 */
export function roundScore(drops, crashes, elapsedSec, tune = DELIVERY) {
  let score = 0;
  for (let i = 0; i < drops; i += 1) score = applyDrop(score);
  for (let i = 0; i < crashes; i += 1) score = applyCrash(score);
  return score + (drops >= tune.PARCELS ? timeBonus(elapsedSec, tune) : 0);
}

/**
 * Curbside drop point for a landmark anchor (§C9.4). Some anchors sit inside
 * their own building's collider box (e.g. skyTower — the tower footprint
 * covers the trigger point), which a 15 m sticker radius forgives but a 4 m
 * drop ring never reaches: the van wedges on the wall ≈ 5 m out. Push the
 * point out of every intersecting collider (minimal axis push + clearance)
 * so the ring always sits on drivable curb. Stays within the 15 m sticker
 * radius of the true anchor for every §C9.3 landmark.
 * @param {{x: number, z: number}} anchor landmark trigger point
 * @param {Array<{minX: number, maxX: number, minZ: number, maxZ: number}>} colliders
 *   layoutColliders(layout) boxes
 * @param {number} [clearance] extra margin outside the box face (m)
 * @returns {{x: number, z: number}}
 */
export function dropPoint(anchor, colliders, clearance = 1.6) {
  let { x, z } = anchor;
  for (let guard = 0; guard < 4; guard += 1) {
    const hit = colliders.find(
      (b) =>
        x > b.minX - clearance &&
        x < b.maxX + clearance &&
        z > b.minZ - clearance &&
        z < b.maxZ + clearance
    );
    if (!hit) break;
    const pushes = [
      { dx: hit.minX - clearance - x, dz: 0 },
      { dx: hit.maxX + clearance - x, dz: 0 },
      { dx: 0, dz: hit.minZ - clearance - z },
      { dx: 0, dz: hit.maxZ + clearance - z },
    ];
    let best = pushes[0];
    for (const p of pushes) {
      if (Math.abs(p.dx) + Math.abs(p.dz) < Math.abs(best.dx) + Math.abs(best.dz)) best = p;
    }
    x += best.dx;
    z += best.dz;
  }
  return { x, z };
}

/**
 * Swept drop-ring check: detects a fast van crossing the 4 m circle between
 * frames, where endpoint-only distance checks tunnelled past delivery.
 */
export function segmentHitsDrop(from, to, center, radius = DELIVERY.DROP_RADIUS_M) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0
    ? Math.max(0, Math.min(1, ((center.x - from.x) * dx + (center.z - from.z) * dz) / len2))
    : 0;
  const x = from.x + dx * t;
  const z = from.z + dz * t;
  return Math.hypot(center.x - x, center.z - z) <= radius;
}

// ---------------------------------------------------------------------------
// Road routing over the pure city grid (legs between delivery stops)
// ---------------------------------------------------------------------------

/**
 * Nearest road tile to a (possibly off-road) tile coordinate — delivery
 * anchors sit curbside on block tiles, the van may be parked on an apron.
 * @param {Array<Array<{kind: string}>>} grid CityLayout.grid
 * @param {number} r @param {number} c
 * @returns {{r: number, c: number}|null}
 */
export function nearestRoadTile(grid, r, c) {
  let best = null;
  let bestD = Infinity;
  for (let rr = 0; rr < grid.length; rr += 1) {
    for (let cc = 0; cc < grid[rr].length; cc += 1) {
      if (grid[rr][cc].kind !== 'road') continue;
      const d = (rr - r) * (rr - r) + (cc - c) * (cc - c);
      if (d < bestD) {
        bestD = d;
        best = { r: rr, c: cc };
      }
    }
  }
  return best;
}

/**
 * Shortest road-tile path between two road tiles (4-neighbor BFS over the
 * layout grid — the ring+cross network is fully connected, §C9.4 legs).
 * @param {Array<Array<{kind: string}>>} grid CityLayout.grid
 * @param {{r: number, c: number}} from road tile
 * @param {{r: number, c: number}} to road tile
 * @returns {Array<{r: number, c: number}>|null} inclusive tile path, or null
 */
export function roadPathBetween(grid, from, to) {
  const rows = grid.length;
  const cols = grid[0].length;
  const key = (r, c) => r * cols + c;
  if (grid[from.r]?.[from.c]?.kind !== 'road' || grid[to.r]?.[to.c]?.kind !== 'road') return null;
  /** @type {Map<number, number>} tile → predecessor tile */
  const prev = new Map([[key(from.r, from.c), -1]]);
  const queue = [[from.r, from.c]];
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    if (r === to.r && c === to.c) break;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc].kind !== 'road' || prev.has(key(nr, nc))) continue;
      prev.set(key(nr, nc), key(r, c));
      queue.push([nr, nc]);
    }
  }
  if (!prev.has(key(to.r, to.c))) return null;
  const path = [];
  let cur = key(to.r, to.c);
  while (cur !== -1) {
    path.unshift({ r: Math.floor(cur / cols), c: cur % cols });
    cur = prev.get(cur);
  }
  return path;
}

/** Deterministic arcade certification model using the derived run tune. */
export function simulateDeliveryAutoplay(seed, mode = 'normal', coinRate = 1) {
  const tune = withDeliveryCoinRate(applyDifficulty(DELIVERY, mode), coinRate);
  const jitter = (seed % 7) - 3;
  const elapsed = mode === 'easy'
    ? 32 + jitter
    : mode === 'hard' || mode === 'endless'
      ? 49 + jitter
      : 41 + jitter;
  const crashes = mode === 'easy' ? 0 : mode === 'hard' || mode === 'endless' ? 2 : 1;
  const coinPoints = tune.COIN_RATE > 1
    ? Math.floor(elapsed / tune.COIN_INTERVAL_SEC) * tune.COIN_POINTS
    : 0;
  const score = roundScore(tune.PARCELS, crashes, elapsed, tune) + coinPoints;
  return { score, elapsed, crashes, coinPoints, tune };
}
