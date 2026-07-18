// Gooby Shopping Surf — pure gameplay logic (PLAN3 §C8, agent V3/G37).
// No three.js / DOM imports (§B8 purity rule) — test/shoppingSurf.test.js and
// the §C8.7 survivability/bot proofs run this headlessly. The visual module
// (shoppingSurf.js) is a thin renderer over THIS simulation: it feeds swipe
// input into stepRun(), maps the entity lists onto meshes and plays the
// returned event queue as sfx/particles. That guarantees logic/live parity —
// the travel-mode determinism and bot-average tests exercise the exact code
// the shipped game runs.
//
// Binding §C8 numbers implemented here (all in SURF below):
//   §C8.1 3 lanes 1.6 m (x = −1.6/0/+1.6), 30 m chunk pool, 12 handcrafted
//         chunk defs, seeded order
//   §C8.2 swipe lane 120 ms tween · jump 0.55 s · slide 0.5 s · mid-air
//         swipe-down fast-drop · 1 buffered action, 250 ms window
//   §C8.3 cart (jump/lane, 2 m/s relative, 0.9 s telegraph) · crate stacks
//         (lane only, never block all 3 — validator) · NPC shopper (lane or
//         jump, crosses L→R 1.2 m/s, dotted-line telegraph) · awning bar
//         (slide, 1–2 lanes) · puddle (soft −10 % 2 s) · gap (jump, ≥ 800 m);
//         crash = stumble 0.8 s + invuln 1.5 s + speed reset, arcade 3rd
//         crash ends; near-miss ≤ 0.35 m = +2 „Knapp!" + streak
//   §C8.4 coin lines/arcs +1 · Magnet 6 s r=3 m · ×2 8 s · Schild 1 crash ·
//         Turbo-Möhre 2.5 s +40 % invuln ≤ 1/400 m · one powerup per
//         180–260 m, never the same kind twice consecutively
//   §C8.5 speed 8 m/s +0.25/5 s cap 16 · score = floor(m) + coins×2 + near×2
//   §C8.6 travel mode: fixed 700 m, no fail-out, 3rd crash → 7 m/s jog with
//         no more obstacles, reward = coins collected capped 30 + 5 clean-run
//         bonus (max 35), daily ×2 AFTER the clamp (framework coinsOverride)

/** All Shopping-Surf tuning (§C8 binding numbers + implementation knobs). */
export const SURF = Object.freeze({
  LANES: 3,
  /** §C8.1: lane width 1.6 m, centers x = −1.6 / 0 / +1.6. */
  LANE_W: 1.6,
  LANE_X: Object.freeze([-1.6, 0, 1.6]),
  /** §C8.5 speed ramp: base 8 m/s, +0.25 m/s every 5 s, cap 16 m/s. */
  BASE_SPEED: 8,
  SPEED_STEP: 0.25,
  SPEED_EVERY_SEC: 5,
  MAX_SPEED: 16,
  /** §C8.2 controls. */
  LANE_CHANGE_SEC: 0.12,
  JUMP_SEC: 0.55,
  JUMP_HEIGHT: 1.35,
  SLIDE_SEC: 0.5,
  SLIDE_HEIGHT: 0.5,
  STAND_HEIGHT: 1.05,
  /** Mid-air swipe-down fast-drop descent rate (m/s). */
  FAST_DROP_SPEED: 10,
  /** §C8.2: 1 buffered action, 250 ms window. */
  BUFFER_SEC: 0.25,
  /** Player hitbox (forgiving ~80 %). */
  PLAYER_HALF_W: 0.42,
  PLAYER_HALF_DEPTH: 0.3,
  /** §C8.3 crash rules. */
  STUMBLE_SEC: 0.8,
  INVULN_SEC: 1.5,
  ARCADE_MAX_CRASHES: 3,
  /** During the stumble Gooby staggers at half pace before the base reset. */
  STUMBLE_SPEED_MULT: 0.5,
  /** §C8.3 near-miss: pass within 0.35 m without a hit = +2 + streak. */
  NEAR_MISS_M: 0.35,
  /** §C8.1 street chunks. */
  CHUNK_LEN_M: 30,
  /** How far ahead of the player entities materialize (m). */
  SPAWN_AHEAD_M: 70,
  /** Entities are recycled once this far behind the player (m). */
  DESPAWN_Z: 8,
  /** §C8.3: curb-break gaps only ≥ 800 m into the run. */
  GAP_MIN_DISTANCE_M: 800,
  /** §C8.3 obstacle table (pass = how the SAME lane clears it). */
  OBSTACLES: Object.freeze({
    cart: Object.freeze({ pass: 'jump', clearY: 0.55, halfW: 0.55, halfDepth: 0.5, ownSpeed: 2, telegraphSec: 0.9 }),
    crate: Object.freeze({ pass: 'none', halfW: 0.6, halfDepth: 0.45, ownSpeed: 0 }),
    npc: Object.freeze({ pass: 'jump', clearY: 0.75, halfW: 0.38, halfDepth: 0.32, ownSpeed: 0, crossSpeed: 1.2 }),
    awning: Object.freeze({ pass: 'slide', gapY: 0.88, halfDepth: 0.18, ownSpeed: 0 }),
    puddle: Object.freeze({ pass: 'soft', halfW: 0.65, halfDepth: 0.5, ownSpeed: 0, slowMult: 0.9, slowSec: 2 }),
    gap: Object.freeze({ pass: 'jump', halfDepth: 1.1, ownSpeed: 0 }),
  }),
  /** §C8.4 powerups. */
  POWERUPS: Object.freeze({
    magnet: Object.freeze({ sec: 6, radius: 3 }),
    x2: Object.freeze({ sec: 8 }),
    shield: Object.freeze({}),
    turbo: Object.freeze({ sec: 2.5, speedMult: 1.4, minGapM: 400 }),
  }),
  /** §C8.4: one powerup every 180–260 m, seeded. */
  POWERUP_GAP_MIN_M: 180,
  POWERUP_GAP_MAX_M: 260,
  /** Coin geometry (pickup band mirrors runner's forgiving windows). */
  COIN_Y: 0.55,
  COIN_STEP_M: 1.1,
  /** Magnet-attracted coins fly at this speed (m/s). */
  MAGNET_PULL_SPEED: 14,
  /** §C8.6 travel mode („Laufen"). */
  TRAVEL: Object.freeze({
    DISTANCE_M: 700,
    JOG_SPEED: 7,
    COIN_CAP: 30,
    CLEAN_BONUS: 5,
    ENERGY: 6, // charged by G38's shopTrip wiring (arcade stays 8 via data/minigames.js)
  }),
  /**
   * Anti-tunneling sweep step (m): the smallest full z collision window is an
   * awning (2×(0.18+0.3) = 0.96 m); a 0.1 s clamped frame at 18 m/s (cart at
   * cap) advances 1.8 m — sample every ≤ 0.32 m so no window can be skipped.
   */
  MAX_SWEEP_STEP_M: 0.32,
  /** §C8.7 action-lattice validator margins (conservative reaction model). */
  VALIDATOR: Object.freeze({
    REACT_SEC: 0.18, //      human reaction slack before any move
    LANE_COST_SEC: 0.22, //  120 ms tween + settle per lane crossed
    /**
     * Margin to time a jump/slide on a row. The action can START right as
     * the hazard arrives (jump 0.55 s / slide 0.5 s durations give wide
     * press windows), so this models timing precision, not the full move.
     */
    ACTION_LEAD_SEC: 0.35,
    ROW_EPS_SEC: 0.4, //     hazards arriving within this window form one row
  }),
});

/** @param {string} mode @returns {boolean} travel-run launch mode (G38 wires 'travel'; 'surfTravel' accepted as alias) */
export function isTravelMode(mode) {
  return mode === 'travel' || mode === 'surfTravel';
}

/**
 * §C8.5 forward speed after `rampSec` seconds of uninterrupted running
 * (crashes reset the ramp — §C8.3 "speed resets to base").
 * @param {number} rampSec @param {object} [tune] @returns {number} m/s
 */
export function speedRampAt(rampSec, tune = SURF) {
  const steps = Math.floor(Math.max(0, rampSec) / tune.SPEED_EVERY_SEC);
  return Math.min(tune.MAX_SPEED, tune.BASE_SPEED + tune.SPEED_STEP * steps);
}

/**
 * §C8.5 score: `floor(distanceM) + coins×2 + nearMiss×2`.
 * @param {number} distanceM @param {number} coins @param {number} nearMisses
 * @returns {number}
 */
export function surfScore(distanceM, coins, nearMisses) {
  return Math.max(0, Math.floor(distanceM) + coins * 2 + nearMisses * 2);
}

/**
 * §C8.6 travel-run reward (the framework coinsOverride): coins collected
 * capped at 30, +5 „Sauberer Lauf" bonus for 0 crashes → max 35. The daily
 * first-play ×2 applies AFTER this clamp (computeCoins multiplies the
 * override — proven in the tests).
 * @param {number} coinsCollected @param {number} crashes @param {object} [tune]
 * @returns {{coins: number, clean: boolean}}
 */
export function travelReward(coinsCollected, crashes, tune = SURF) {
  const clean = Math.max(0, Math.floor(crashes)) === 0;
  const capped = Math.min(tune.TRAVEL.COIN_CAP, Math.max(0, Math.floor(coinsCollected)));
  return { coins: capped + (clean ? tune.TRAVEL.CLEAN_BONUS : 0), clean };
}

// ---------------------------------------------------------------------------
// §C8.1 chunk pool — 12 handcrafted 30 m defs
// ---------------------------------------------------------------------------
// Authoring rules (locked by the §C8.7 validator tests):
//   · hazards live within atM ∈ [8, 24] so chunk seams always leave ≥ 14 m
//     of reaction room (validator boundary rule),
//   · crate rows never block all 3 lanes (§C8.3),
//   · same-path action hazards sit ≥ 13 m apart (jump/slide timing at cap
//     speed 16 m/s — cart approach 18 m/s),
//   · `minM` gates heavier defs to later distances; gap defs carry the
//     §C8.3 ≥ 800 m rule via GAP_MIN_DISTANCE_M.
// Hazard shapes: {atM, kind, lane}  ·  awning: {atM, kind:'awning', lanes}
//   ·  npc: {atM, kind:'npc'} (crosses all lanes L→R)  ·  gap: {atM, kind:'gap'}
// Coin rows: {atM, lane, n, arc?} — arc rows trace the jump parabola over a
// jumpable hazard (§C8.4 "arcs over carts teach jumping").

/** @typedef {{atM:number, kind:string, lane?:number, lanes?:number[]}} ChunkHazard */
/** @typedef {{atM:number, lane:number, n:number, arc?:boolean}} ChunkCoinRow */
/** @typedef {{name:string, minM:number, hazards:ChunkHazard[], coins:ChunkCoinRow[]}} ChunkDef */

/** @type {ReadonlyArray<ChunkDef>} */
export const CHUNKS = Object.freeze([
  Object.freeze({ // 0 · warmup — one cart, a straight coin line
    name: 'warmup', minM: 0,
    hazards: [{ atM: 15, kind: 'cart', lane: 1 }],
    coins: [{ atM: 15, lane: 1, n: 5, arc: true }, { atM: 22, lane: 2, n: 4 }],
  }),
  Object.freeze({ // 1 · crate pair teaches lane dodging
    name: 'cratePair', minM: 0,
    hazards: [
      { atM: 10, kind: 'crate', lane: 0 }, { atM: 10, kind: 'crate', lane: 1 },
      { atM: 23, kind: 'awning', lanes: [0, 1] },
    ],
    coins: [{ atM: 10, lane: 2, n: 5 }, { atM: 23, lane: 2, n: 4 }],
  }),
  Object.freeze({ // 2 · staggered carts
    name: 'cartsStagger', minM: 60,
    hazards: [{ atM: 9, kind: 'cart', lane: 2 }, { atM: 22, kind: 'cart', lane: 0 }],
    coins: [{ atM: 9, lane: 2, n: 5, arc: true }, { atM: 16, lane: 1, n: 4 }],
  }),
  Object.freeze({ // 3 · crate + crossing shopper
    name: 'shopperCross', minM: 60,
    hazards: [{ atM: 8, kind: 'crate', lane: 1 }, { atM: 21, kind: 'npc' }],
    coins: [{ atM: 14, lane: 0, n: 4 }, { atM: 26, lane: 1, n: 4 }],
  }),
  Object.freeze({ // 4 · slide row (awning + crate wall) into a cart
    name: 'slideRow', minM: 120,
    hazards: [
      { atM: 10, kind: 'awning', lanes: [1, 2] }, { atM: 10, kind: 'crate', lane: 0 },
      { atM: 24, kind: 'cart', lane: 1 },
    ],
    coins: [{ atM: 15, lane: 2, n: 5 }, { atM: 24, lane: 1, n: 5, arc: true }],
  }),
  Object.freeze({ // 5 · puddle alley — soft lane between crates
    name: 'puddleAlley', minM: 120,
    hazards: [
      { atM: 12, kind: 'crate', lane: 0 }, { atM: 12, kind: 'puddle', lane: 1 },
      { atM: 12, kind: 'crate', lane: 2 },
    ],
    coins: [{ atM: 18, lane: 1, n: 5 }, { atM: 24, lane: 0, n: 3 }],
  }),
  Object.freeze({ // 6 · action wall — jump lanes 0/1 or slide lane 2
    name: 'actionWall', minM: 200,
    hazards: [
      { atM: 13, kind: 'cart', lane: 0 }, { atM: 13, kind: 'cart', lane: 1 },
      { atM: 13, kind: 'awning', lanes: [2] },
    ],
    coins: [{ atM: 13, lane: 1, n: 5, arc: true }, { atM: 20, lane: 2, n: 4 }],
  }),
  Object.freeze({ // 7 · shopper then crate pair
    name: 'shopperCrates', minM: 200,
    hazards: [
      { atM: 9, kind: 'npc' },
      { atM: 22, kind: 'crate', lane: 1 }, { atM: 22, kind: 'crate', lane: 2 },
    ],
    coins: [{ atM: 15, lane: 1, n: 4 }, { atM: 22, lane: 0, n: 5 }],
  }),
  Object.freeze({ // 8 · crate zigzag weave
    name: 'zigzag', minM: 300,
    hazards: [
      { atM: 8, kind: 'crate', lane: 0 }, { atM: 16, kind: 'crate', lane: 2 },
      { atM: 24, kind: 'crate', lane: 1 },
    ],
    coins: [{ atM: 12, lane: 1, n: 3 }, { atM: 20, lane: 0, n: 3 }],
  }),
  Object.freeze({ // 9 · double slide
    name: 'doubleSlide', minM: 300,
    hazards: [
      { atM: 9, kind: 'awning', lanes: [0, 1] },
      { atM: 23, kind: 'awning', lanes: [1, 2] },
    ],
    coins: [{ atM: 16, lane: 1, n: 5 }],
  }),
  Object.freeze({ // 10 · curb break — §C8.3 gap, only ≥ 800 m
    name: 'curbBreak', minM: 800,
    hazards: [{ atM: 10, kind: 'gap' }, { atM: 24, kind: 'cart', lane: 1 }],
    coins: [{ atM: 10, lane: 1, n: 5, arc: true }, { atM: 18, lane: 0, n: 4 }],
  }),
  Object.freeze({ // 11 · gauntlet — cart, blocked pair + puddle, shopper
    name: 'gauntlet', minM: 400,
    hazards: [
      { atM: 8, kind: 'cart', lane: 1 },
      { atM: 21, kind: 'crate', lane: 0 }, { atM: 21, kind: 'puddle', lane: 1 },
    ],
    coins: [{ atM: 14, lane: 2, n: 4 }, { atM: 26, lane: 2, n: 4 }],
  }),
]);

/**
 * Seeded chunk pick (§C8.1 "seeded order"): warmup opens every run, defs are
 * gated by their minM (gap defs additionally by GAP_MIN_DISTANCE_M) and the
 * same def never repeats back-to-back.
 * @param {() => number} rng
 * @param {number} startM where the chunk will begin (m)
 * @param {number} lastIndex previous def index (−1 at run start)
 * @param {object} [tune]
 * @returns {number} CHUNKS index
 */
export function pickNextChunk(rng, startM, lastIndex, tune = SURF) {
  if (startM <= 0) return 0;
  const eligible = [];
  for (let i = 0; i < CHUNKS.length; i += 1) {
    if (i === lastIndex) continue;
    const def = CHUNKS[i];
    if (startM < def.minM) continue;
    if (def.hazards.some((h) => h.kind === 'gap') && startM < tune.GAP_MIN_DISTANCE_M) continue;
    eligible.push(i);
  }
  return eligible[Math.floor(rng() * eligible.length) % eligible.length];
}

/**
 * Expand a chunk def to absolute-distance hazard/coin entries.
 * @param {ChunkDef} def @param {number} startM
 * @returns {{hazards: object[], coins: object[]}}
 */
export function expandChunk(def, startM) {
  return {
    hazards: def.hazards.map((h) => ({ ...h, atM: startM + h.atM })),
    coins: def.coins.map((c) => ({ ...c, atM: startM + c.atM })),
  };
}

// ---------------------------------------------------------------------------
// §C8.7 survivability validator — BFS/DP over the action lattice
// ---------------------------------------------------------------------------

/**
 * Group absolute hazards into arrival-time rows at a constant probe speed.
 * Rolling carts mirror the sim's spawn model: they materialize at the
 * SPAWN_AHEAD_M horizon and only THEN roll toward the player at +2 m/s, so
 * the meeting point is `atM − horizon·own/(v+own)` (clamped by the
 * spawn-at-run-start case `atM·v/(v+own)` for near hazards). NPC shoppers
 * and gaps span all lanes (a jump always clears an NPC wherever it is on
 * its crossing — conservative), awnings span their lanes with pass 'slide',
 * puddles are soft and ignored.
 * @param {object[]} hazards [{atM, kind, lane?, lanes?}] absolute
 * @param {number} speed probe speed (m/s)
 * @param {object} [tune]
 * @returns {Array<{t: number, lanes: Array<string|null>}>} rows sorted by t;
 *   lanes[i] = null (free) | 'jump' | 'slide' | 'none'
 */
export function hazardRows(hazards, speed, tune = SURF) {
  const events = [];
  for (const h of hazards) {
    const def = tune.OBSTACLES[h.kind];
    if (!def || def.pass === 'soft') continue;
    const meetM = Math.max(
      (h.atM * speed) / (speed + def.ownSpeed),
      h.atM - (tune.SPAWN_AHEAD_M * def.ownSpeed) / (speed + def.ownSpeed)
    );
    const t = meetM / speed;
    let lanes;
    if (h.kind === 'npc' || h.kind === 'gap') lanes = [0, 1, 2];
    else if (h.kind === 'awning') lanes = h.lanes;
    else lanes = [h.lane];
    events.push({ t, lanes, pass: def.pass });
  }
  events.sort((a, b) => a.t - b.t);
  const rows = [];
  for (const ev of events) {
    const row = rows.length > 0 && ev.t - rows[rows.length - 1].t <= tune.VALIDATOR.ROW_EPS_SEC
      ? rows[rows.length - 1]
      : null;
    const target = row ?? { t: ev.t, lanes: new Array(tune.LANES).fill(null) };
    for (const lane of ev.lanes) {
      const prev = target.lanes[lane];
      if (prev === 'none') continue; // already fully blocked
      // strictest wins: 'none' beats actions; two DIFFERENT simultaneous
      // action requirements (jump + slide) are contradictory → 'none'
      if (ev.pass === 'none' || (prev != null && prev !== ev.pass)) target.lanes[lane] = 'none';
      else target.lanes[lane] = ev.pass;
    }
    if (!row) rows.push(target);
  }
  return rows;
}

/**
 * §C8.7 never-impossible proof: BFS/DP over (lane) states across hazard rows.
 * An edge from lane `from` (after row i) to lane `to` (surviving row i+1)
 * exists when the available time covers reaction + lane tweens + (for
 * action-pass lanes) the jump/slide lead. A sequence is survivable when at
 * least one lane chain reaches the end.
 * @param {object[]} hazards absolute [{atM, kind, lane?, lanes?}]
 * @param {number} speed constant probe speed (validate at every ramp speed)
 * @param {object} [tune]
 * @returns {boolean}
 */
export function isSequenceSurvivable(hazards, speed, tune = SURF) {
  const V = tune.VALIDATOR;
  const rows = hazardRows(hazards, speed, tune);
  let reachable = new Array(tune.LANES).fill(true);
  let prevT = -V.REACT_SEC; // free reaction slack before the first row
  for (const row of rows) {
    const dt = row.t - prevT;
    const next = new Array(tune.LANES).fill(false);
    for (let to = 0; to < tune.LANES; to += 1) {
      const need = row.lanes[to];
      if (need === 'none') continue;
      for (let from = 0; from < tune.LANES; from += 1) {
        if (!reachable[from]) continue;
        const cost = V.REACT_SEC + V.LANE_COST_SEC * Math.abs(to - from) + (need ? V.ACTION_LEAD_SEC : 0);
        if (dt >= cost) {
          next[to] = true;
          break;
        }
      }
    }
    reachable = next;
    if (!reachable.some(Boolean)) return false;
    prevT = row.t;
  }
  return true;
}

// ---------------------------------------------------------------------------
// §C8.4 powerup planning
// ---------------------------------------------------------------------------

const POWERUP_KINDS = Object.freeze(['magnet', 'x2', 'shield', 'turbo']);

/**
 * Pick the next powerup kind (§C8.4: never the same kind twice consecutively;
 * Turbo-Möhre at most 1 per 400 m).
 * @param {() => number} rng
 * @param {string|null} lastKind
 * @param {number} sinceTurboM meters since the last turbo SPAWN (Infinity if none)
 * @param {object} [tune]
 * @returns {string}
 */
export function planPowerupKind(rng, lastKind, sinceTurboM, tune = SURF) {
  const pool = POWERUP_KINDS.filter(
    (k) => k !== lastKind && (k !== 'turbo' || sinceTurboM >= tune.POWERUPS.turbo.minGapM)
  );
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/**
 * Seeded gap to the next powerup spawn (§C8.4: one every 180–260 m).
 * @param {() => number} rng @param {object} [tune] @returns {number} meters
 */
export function planPowerupGap(rng, tune = SURF) {
  return tune.POWERUP_GAP_MIN_M + rng() * (tune.POWERUP_GAP_MAX_M - tune.POWERUP_GAP_MIN_M);
}

// ---------------------------------------------------------------------------
// The headless run simulation (consumed 1:1 by shoppingSurf.js)
// ---------------------------------------------------------------------------

/** @typedef {{left?:boolean, right?:boolean, jump?:boolean, slide?:boolean}} SurfInput */

/**
 * Create a fresh run state.
 * @param {{rng: () => number, mode?: string, tune?: object}} opts
 * @returns {object} run state (step with stepRun)
 */
export function createRun({ rng, mode = 'arcade', tune = SURF }) {
  return {
    tune,
    rng,
    mode: isTravelMode(mode) ? 'travel' : 'arcade',
    elapsed: 0,
    distanceM: 0,
    rampSec: 0,
    speed: tune.BASE_SPEED,
    slowT: 0,
    // player
    lane: 1,
    fromX: tune.LANE_X[1],
    laneT: 1,
    jumpT: -1,
    slideT: -1,
    fastDrop: false,
    buffered: null, // {type:'jump'|'slide'|'left'|'right', t}
    // crash/juice state
    crashes: 0,
    stumbleT: 0,
    invulnT: 0,
    coins: 0,
    nearMisses: 0,
    nearStreak: 0,
    powerupsCollected: 0,
    pu: { magnetT: 0, x2T: 0, shield: false, turboT: 0 },
    lastPowerupKind: null,
    lastTurboAtM: -Infinity,
    nextPowerupAtM: 0, // initialized on first step
    // travel
    jog: false,
    finished: false,
    ended: false,
    // world streaming
    chunksEndM: 0,
    lastChunk: -1,
    pendingHazards: [], // absolute atM, not yet materialized
    pendingCoins: [],
    obstacles: [], //     {id, kind, lane?, lanes?, x, z, def…}
    coinItems: [], //     {id, lane, x, y, z, attracted}
    powerupItems: [], //  {id, kind, lane, x, z}
    nextId: 1,
  };
}

/** Eased lane-tween x position of the player (m). @param {object} run @returns {number} */
export function playerX(run) {
  const t = Math.min(1, run.laneT);
  const e = t * t * (3 - 2 * t); // smoothstep
  return run.fromX + (run.tune.LANE_X[run.lane] - run.fromX) * e;
}

/** Player hop height (m). @param {object} run @returns {number} */
export function playerY(run) {
  if (run.jumpT < 0) return 0;
  if (run.fastDrop) return run.fastDropY;
  return run.tune.JUMP_HEIGHT * Math.sin((run.jumpT / run.tune.JUMP_SEC) * Math.PI);
}

/** Current forward speed (m/s) incl. jog/turbo/puddle/stumble modifiers. */
export function currentSpeed(run) {
  const tune = run.tune;
  if (run.ended) return 0;
  if (run.jog) return tune.TRAVEL.JOG_SPEED;
  let v = speedRampAt(run.rampSec, tune);
  if (run.pu.turboT > 0) v *= tune.POWERUPS.turbo.speedMult;
  if (run.slowT > 0) v *= tune.OBSTACLES.puddle.slowMult;
  if (run.stumbleT > 0) v *= tune.STUMBLE_SPEED_MULT;
  return v;
}

/** Start (or buffer) an action per the §C8.2 rules. */
function tryAction(run, type, events) {
  const tune = run.tune;
  if (type === 'left' || type === 'right') {
    // mid-tween swipes queue (§C8.2 single buffered action) — retargeting
    // from the eased position would snap the hitbox sideways
    if (run.laneT < 0.65) return false;
    const dir = type === 'left' ? -1 : 1;
    const next = Math.max(0, Math.min(tune.LANES - 1, run.lane + dir));
    if (next !== run.lane) {
      run.fromX = playerX(run); // tween continues seamlessly from here
      run.lane = next;
      run.laneT = 0;
      events.push({ type: 'lane', dir });
    }
    return true;
  }
  if (type === 'jump') {
    if (run.jumpT >= 0 || run.slideT >= 0) return false;
    run.jumpT = 0;
    run.fastDrop = false;
    events.push({ type: 'jump' });
    return true;
  }
  if (type === 'slide') {
    if (run.jumpT >= 0) {
      // §C8.2 mid-air swipe-down = fast-drop (freeze height BEFORE the flag —
      // playerY reads fastDropY once fastDrop is set)
      if (!run.fastDrop) {
        run.fastDropY = playerY(run);
        run.fastDrop = true;
        events.push({ type: 'fastDrop' });
      }
      return true;
    }
    if (run.slideT >= 0) return false;
    run.slideT = 0;
    events.push({ type: 'slide' });
    return true;
  }
  return false;
}

/** Consume input (edge-triggered flags) with the 250 ms single-action buffer. */
function applyInput(run, input, events) {
  if (!input || run.ended || run.finished) return;
  const wants = [];
  if (input.left) wants.push('left');
  if (input.right) wants.push('right');
  if (input.jump) wants.push('jump');
  if (input.slide) wants.push('slide');
  for (const type of wants) {
    if (!tryAction(run, type, events)) run.buffered = { type, t: 0 };
  }
  if (run.buffered) {
    run.buffered.t = run.buffered.t ?? 0;
    if (tryAction(run, run.buffered.type, events)) run.buffered = null;
  }
}

/** Stream chunks + powerups into the pending queues, then materialize. */
function spawnStep(run, events) {
  const tune = run.tune;
  if (run.nextPowerupAtM === 0) run.nextPowerupAtM = planPowerupGap(run.rng, tune);
  // enqueue whole chunks ahead of the horizon
  while (run.chunksEndM < run.distanceM + tune.SPAWN_AHEAD_M + tune.CHUNK_LEN_M) {
    const idx = pickNextChunk(run.rng, run.chunksEndM, run.lastChunk, tune);
    const { hazards, coins } = expandChunk(CHUNKS[idx], run.chunksEndM);
    run.pendingHazards.push(...hazards);
    run.pendingCoins.push(...coins);
    run.lastChunk = idx;
    run.chunksEndM += tune.CHUNK_LEN_M;
  }
  const horizon = run.distanceM + tune.SPAWN_AHEAD_M;
  // hazards (suppressed in travel-jog + once a travel run is finished)
  const noHazards = run.jog || run.finished;
  run.pendingHazards = run.pendingHazards.filter((h) => {
    if (h.atM > horizon) return true;
    if (noHazards) return false;
    // travel: never spawn a hazard that would arrive beyond the finish arch
    if (run.mode === 'travel' && h.atM >= tune.TRAVEL.DISTANCE_M - 4) return false;
    const def = tune.OBSTACLES[h.kind];
    const ob = {
      id: run.nextId++,
      kind: h.kind,
      def,
      lane: h.lane,
      lanes: h.lanes,
      z: -(h.atM - run.distanceM),
      x: h.kind === 'npc'
        ? -(tune.LANE_X[tune.LANES - 1] + 1.0) // §C8.3: crosses L→R
        : h.kind === 'awning'
          ? (tune.LANE_X[Math.min(...h.lanes)] + tune.LANE_X[Math.max(...h.lanes)]) / 2
          : tune.LANE_X[h.lane ?? 1],
      halfW: h.kind === 'awning'
        ? ((Math.max(...h.lanes) - Math.min(...h.lanes)) * tune.LANE_W + tune.LANE_W * 0.92) / 2
        : h.kind === 'gap' ? 99 : def.halfW,
      telegraphed: false,
      hit: false,
      minClear: Infinity,
      passed: false,
    };
    run.obstacles.push(ob);
    events.push({ type: 'spawn', ob });
    return false;
  });
  // coins
  run.pendingCoins = run.pendingCoins.filter((c) => {
    if (c.atM > horizon) return true;
    for (let i = 0; i < c.n; i += 1) {
      const zOff = (i - (c.n - 1) / 2) * tune.COIN_STEP_M;
      const y = c.arc
        ? tune.COIN_Y + tune.JUMP_HEIGHT * 0.85 * Math.cos(((zOff / ((c.n * tune.COIN_STEP_M) / 2)) * Math.PI) / 2) ** 2
        : tune.COIN_Y;
      run.coinItems.push({
        id: run.nextId++,
        lane: c.lane,
        x: tune.LANE_X[c.lane],
        y,
        z: -(c.atM - run.distanceM) + zOff,
        attracted: false,
      });
    }
    return false;
  });
  // powerups (§C8.4)
  if (!run.finished && run.nextPowerupAtM <= horizon) {
    const sinceTurbo = run.nextPowerupAtM - run.lastTurboAtM;
    const kind = planPowerupKind(run.rng, run.lastPowerupKind, sinceTurbo, tune);
    const lane = Math.floor(run.rng() * tune.LANES) % tune.LANES;
    if (!(run.mode === 'travel' && run.nextPowerupAtM >= tune.TRAVEL.DISTANCE_M - 6)) {
      run.powerupItems.push({
        id: run.nextId++,
        kind,
        lane,
        x: tune.LANE_X[lane],
        z: -(run.nextPowerupAtM - run.distanceM),
      });
    }
    if (kind === 'turbo') run.lastTurboAtM = run.nextPowerupAtM;
    run.lastPowerupKind = kind;
    run.nextPowerupAtM += planPowerupGap(run.rng, tune);
  }
}

/** One-frame hit test against an obstacle at its CURRENT z. */
function hitsNow(run, ob, px, py, sliding) {
  const tune = run.tune;
  const def = ob.def;
  if (Math.abs(ob.z) > def.halfDepth + tune.PLAYER_HALF_DEPTH) return false;
  if (ob.kind === 'gap') {
    // full-width curb break: on the ground inside the pit = crash
    return py < 0.12 && Math.abs(ob.z) < def.halfDepth;
  }
  const latOverlap = Math.abs(px - ob.x) < ob.halfW + tune.PLAYER_HALF_W;
  if (!latOverlap) return false;
  if (def.pass === 'jump') return py < def.clearY;
  if (def.pass === 'slide') return !(sliding && tune.SLIDE_HEIGHT <= def.gapY);
  if (def.pass === 'soft') return py < 0.1;
  return true; // crate — full height
}

/** Swept hit test over this frame's advance dz (anti-tunneling). */
function sweepHits(run, ob, dz, px, py, sliding) {
  const steps = Math.max(1, Math.ceil(Math.abs(dz) / run.tune.MAX_SWEEP_STEP_M));
  const z0 = ob.z;
  for (let i = 1; i <= steps; i += 1) {
    ob.z = z0 + (dz * i) / steps;
    if (hitsNow(run, ob, px, py, sliding)) {
      ob.z = z0;
      return true;
    }
  }
  ob.z = z0;
  return false;
}

/** Apply a hazard hit (§C8.3 crash rules + §C8.4 shield/turbo). */
function handleHit(run, ob, events) {
  const tune = run.tune;
  if (ob.kind === 'puddle') {
    if (ob.hit || run.pu.turboT > 0) return;
    ob.hit = true;
    run.slowT = tune.OBSTACLES.puddle.slowSec;
    events.push({ type: 'puddle', id: ob.id });
    return;
  }
  if (run.pu.turboT > 0 || run.invulnT > 0) return;
  ob.hit = true;
  if (run.pu.shield) {
    run.pu.shield = false;
    run.invulnT = tune.INVULN_SEC;
    events.push({ type: 'shieldPop', id: ob.id });
    return;
  }
  run.crashes += 1;
  run.stumbleT = tune.STUMBLE_SEC;
  run.invulnT = tune.INVULN_SEC;
  run.rampSec = 0; // §C8.3: speed resets to base
  run.nearStreak = 0;
  events.push({ type: 'crash', id: ob.id, kind: ob.kind, crashes: run.crashes });
  if (run.mode === 'arcade' && run.crashes >= tune.ARCADE_MAX_CRASHES) {
    run.ended = true;
    events.push({ type: 'wipeout' });
  } else if (run.mode === 'travel' && run.crashes >= tune.ARCADE_MAX_CRASHES && !run.jog) {
    // §C8.6 forgiveness: fixed 7 m/s jog, no more obstacles
    run.jog = true;
    run.obstacles.length = 0;
    run.pendingHazards.length = 0;
    events.push({ type: 'jogStart' });
  }
}

/**
 * Advance the run by dt seconds.
 * @param {object} run @param {number} dt @param {SurfInput} [input]
 * @returns {object[]} events for the renderer (sfx/particles/banners):
 *   lane/jump/slide/fastDrop · spawn {ob} · telegraph {id,kind} · crash
 *   {id,kind,crashes} · wipeout · jogStart · shieldPop · puddle · nearMiss
 *   {streak} · coin {x,y,z,value} · powerup {kind} · powerupEnd {kind} ·
 *   finish {coinsCollected, crashes}
 */
export function stepRun(run, dt, input) {
  const tune = run.tune;
  const events = [];
  if (run.ended) return events;
  run.elapsed += dt;
  if (!run.finished) run.rampSec += dt;

  // timers
  if (run.buffered) {
    run.buffered.t += dt;
    if (run.buffered.t > tune.BUFFER_SEC) run.buffered = null;
  }
  applyInput(run, input, events);
  run.invulnT = Math.max(0, run.invulnT - dt);
  run.stumbleT = Math.max(0, run.stumbleT - dt);
  run.slowT = Math.max(0, run.slowT - dt);
  for (const key of ['magnetT', 'x2T', 'turboT']) {
    if (run.pu[key] > 0) {
      run.pu[key] -= dt;
      if (run.pu[key] <= 0) {
        run.pu[key] = 0;
        events.push({ type: 'powerupEnd', kind: key === 'magnetT' ? 'magnet' : key === 'x2T' ? 'x2' : 'turbo' });
      }
    }
  }

  // player verticals
  if (run.jumpT >= 0) {
    if (run.fastDrop) {
      run.fastDropY -= tune.FAST_DROP_SPEED * dt;
      if (run.fastDropY <= 0) {
        run.jumpT = -1;
        run.fastDrop = false;
        events.push({ type: 'land' });
        if (run.buffered && tryAction(run, run.buffered.type, events)) run.buffered = null;
      }
    } else {
      run.jumpT += dt;
      if (run.jumpT >= tune.JUMP_SEC) {
        run.jumpT = -1;
        events.push({ type: 'land' });
        if (run.buffered && tryAction(run, run.buffered.type, events)) run.buffered = null;
      }
    }
  }
  if (run.slideT >= 0) {
    run.slideT += dt;
    if (run.slideT >= tune.SLIDE_SEC) {
      run.slideT = -1;
      if (run.buffered && tryAction(run, run.buffered.type, events)) run.buffered = null;
    }
  }
  if (run.laneT < 1) run.laneT = Math.min(1, run.laneT + dt / tune.LANE_CHANGE_SEC);

  // forward motion
  const speed = currentSpeed(run);
  run.speed = speed;
  run.distanceM += speed * dt;

  // §C8.6 finish arch
  if (run.mode === 'travel' && !run.finished && run.distanceM >= tune.TRAVEL.DISTANCE_M) {
    run.finished = true;
    events.push({ type: 'finish', coinsCollected: run.coins, crashes: run.crashes });
  }

  spawnStep(run, events);

  const px = playerX(run);
  const py = playerY(run);
  const sliding = run.slideT >= 0;

  // obstacles: telegraph, advance (swept), collide, near-miss, recycle
  for (let i = run.obstacles.length - 1; i >= 0; i -= 1) {
    const ob = run.obstacles[i];
    const def = ob.def;
    const approach = speed + def.ownSpeed;
    if (!ob.telegraphed && def.telegraphSec && -ob.z / Math.max(0.001, approach) <= def.telegraphSec) {
      ob.telegraphed = true;
      events.push({ type: 'telegraph', id: ob.id, kind: ob.kind });
    }
    const dz = approach * dt;
    const soft = def.pass === 'soft';
    const hit = !run.finished && !ob.hit && (soft || run.invulnT <= 0) &&
      sweepHits(run, ob, dz, px, py, sliding);
    ob.z += dz;
    if (ob.kind === 'npc') ob.x += def.crossSpeed * dt;
    // near-miss clearance tracking (cart/crate/npc only — §C8.3)
    if (!ob.hit && (ob.kind === 'cart' || ob.kind === 'crate' || ob.kind === 'npc')) {
      const window = def.halfDepth + tune.PLAYER_HALF_DEPTH;
      if (Math.abs(ob.z) <= window + 0.4) {
        const latClear = Math.abs(px - ob.x) - (ob.halfW + tune.PLAYER_HALF_W);
        let clear;
        if (latClear > 0) clear = latClear;
        else if (def.pass === 'jump' && py > def.clearY) clear = py - def.clearY;
        else clear = Infinity; // overlapping frame — a hit would have fired
        ob.minClear = Math.min(ob.minClear, clear);
      } else if (ob.z > window + 0.4 && !ob.passed) {
        ob.passed = true;
        if (ob.minClear > 0 && ob.minClear <= tune.NEAR_MISS_M) {
          run.nearMisses += 1;
          run.nearStreak += 1;
          events.push({ type: 'nearMiss', id: ob.id, streak: run.nearStreak });
        }
      }
    }
    if (hit) handleHit(run, ob, events);
    if (run.ended) break;
    if (ob.z > tune.DESPAWN_Z) run.obstacles.splice(i, 1);
  }
  if (run.ended) return events;

  // coins: magnet/turbo attraction + pickup
  const coinValue = run.pu.x2T > 0 ? 2 : 1;
  const magnetR = run.pu.magnetT > 0 ? tune.POWERUPS.magnet.radius : 0;
  for (let i = run.coinItems.length - 1; i >= 0; i -= 1) {
    const c = run.coinItems[i];
    if (!c.attracted) {
      c.z += speed * dt;
      const d = Math.hypot(c.x - px, c.z, c.y - (py + 0.6));
      if (magnetR > 0 && d < magnetR) c.attracted = true;
      else if (run.pu.turboT > 0 && Math.abs(c.x - px) < 1.0 && c.z > -2.5 && c.z < 1) c.attracted = true;
    } else {
      // fly toward the player (visual renders this exact position)
      const tx = px;
      const ty = py + 0.6;
      const dx = tx - c.x;
      const dy = ty - c.y;
      const dzc = 0 - c.z;
      const d = Math.hypot(dx, dy, dzc) || 1;
      const step = tune.MAGNET_PULL_SPEED * dt;
      c.x += (dx / d) * step;
      c.y += (dy / d) * step;
      c.z += (dzc / d) * step + speed * dt * 0.2;
    }
    const collected = c.attracted
      ? Math.hypot(c.x - px, c.z, c.y - (py + 0.6)) < 0.55
      : Math.abs(c.z) < 0.6 && Math.abs(c.x - px) < 0.7 && Math.abs(py + tune.COIN_Y - c.y) < 0.85;
    if (collected) {
      run.coins += coinValue;
      events.push({ type: 'coin', x: c.x, y: c.y, z: c.z, value: coinValue });
      run.coinItems.splice(i, 1);
    } else if (c.z > tune.DESPAWN_Z) {
      run.coinItems.splice(i, 1);
    }
  }

  // powerup pickups (despawn if untouched — §C8.4)
  for (let i = run.powerupItems.length - 1; i >= 0; i -= 1) {
    const p = run.powerupItems[i];
    p.z += speed * dt;
    if (Math.abs(p.z) < 0.8 && Math.abs(p.x - px) < 0.9 && py < 1.6) {
      const kind = p.kind;
      if (kind === 'magnet') run.pu.magnetT = tune.POWERUPS.magnet.sec;
      else if (kind === 'x2') run.pu.x2T = tune.POWERUPS.x2.sec;
      else if (kind === 'shield') run.pu.shield = true;
      else if (kind === 'turbo') run.pu.turboT = tune.POWERUPS.turbo.sec;
      run.powerupsCollected += 1;
      events.push({ type: 'powerup', kind });
      run.powerupItems.splice(i, 1);
    } else if (p.z > tune.DESPAWN_Z) {
      run.powerupItems.splice(i, 1);
    }
  }

  return events;
}

/** Current §C8.5 score of a run. @param {object} run @returns {number} */
export function runScore(run) {
  return surfScore(run.distanceM, run.coins, run.nearMisses);
}

/** §B3 meta payload for onEnd (both modes — §C8.5/§C8.6). */
export function runMeta(run) {
  return {
    distanceM: Math.round(run.distanceM),
    coins: run.coins,
    coinsCollected: run.coins,
    nearMisses: run.nearMisses,
    powerups: run.powerupsCollected,
    crashes: run.crashes,
    surfRun: true,
  };
}

// ---------------------------------------------------------------------------
// §C8.7 autoplay bot — plans a chunk ahead on the action lattice, takes safe
// coin lines. Fully deterministic (no rng) so travel runs replay bit-equal.
// ---------------------------------------------------------------------------

/** How threatening an obstacle is to a given lane x position right now. */
function blocksLaneAt(ob, laneX, tune, aheadSec, speed) {
  const def = ob.def;
  if (def.pass === 'soft') return null;
  const approach = speed + def.ownSpeed;
  const tta = -ob.z / Math.max(0.001, approach);
  if (tta < -0.05 || tta > aheadSec) return null;
  let x = ob.x;
  if (ob.kind === 'npc') x = ob.x + def.crossSpeed * tta; // where it WILL be
  const halfW = ob.kind === 'gap' ? 99 : ob.halfW;
  if (Math.abs(x - laneX) >= halfW + tune.PLAYER_HALF_W + 0.05) return null;
  return { tta, pass: def.pass, ob };
}

/**
 * Deterministic bot input for the current frame (§C8.7): keeps a safe lane
 * (planning ~1 chunk ahead), times jumps/slides, and drifts toward coin
 * lines / powerups when no hazard is near.
 * @param {object} run
 * @returns {SurfInput}
 */
export function botInput(run) {
  const tune = run.tune;
  if (run.ended || run.finished) return {};
  const speed = Math.max(1, run.speed);
  const planSec = tune.CHUNK_LEN_M / speed; // ≈ one chunk ahead
  const input = {};

  // threat table per lane
  const threats = [null, null, null];
  for (let lane = 0; lane < tune.LANES; lane += 1) {
    let best = null;
    for (const ob of run.obstacles) {
      const b = blocksLaneAt(ob, tune.LANE_X[lane], tune, planSec, speed);
      if (b && (!best || b.tta < best.tta)) best = b;
    }
    threats[lane] = best;
  }

  const myLane = run.lane;
  const my = threats[myLane];
  const laneChanging = run.laneT < 1;

  // 1) imminent action in my lane
  if (my && !laneChanging) {
    if (my.pass === 'jump' && my.tta <= tune.JUMP_SEC * 0.5 && run.jumpT < 0 && run.slideT < 0) {
      input.jump = true;
      return input;
    }
    if (my.pass === 'slide' && my.tta <= tune.SLIDE_SEC * 0.55 && run.jumpT < 0 && run.slideT < 0) {
      input.slide = true;
      return input;
    }
    if (my.pass === 'none' && my.tta <= tune.VALIDATOR.REACT_SEC + tune.VALIDATOR.LANE_COST_SEC + 0.7) {
      // hard blocker (crate wall / boxed lane) — dodge to the best neighbor
      const options = [myLane - 1, myLane + 1].filter((l) => l >= 0 && l < tune.LANES);
      options.sort((a, b) => (threats[a]?.tta ?? 99) - (threats[b]?.tta ?? 99)).reverse();
      for (const l of options) {
        const t = threats[l];
        if (!t || t.tta > my.tta + 0.5 || t.pass !== 'none') {
          input[l < myLane ? 'left' : 'right'] = true;
          return input;
        }
      }
      return input; // fully boxed (validator makes this unreachable)
    }
  }

  // 2) no urgent threat: drift toward value (coins, then powerups) if safe
  if (!laneChanging && run.jumpT < 0 && run.slideT < 0 && (!my || my.tta > 1.6)) {
    const value = [0, 0, 0];
    for (const c of run.coinItems) {
      if (c.z > -14 && c.z < -2 && c.y < 0.9) value[c.lane] += 1;
    }
    for (const p of run.powerupItems) {
      if (p.z > -18 && p.z < -2) value[p.lane] += 6;
    }
    let target = myLane;
    for (const l of [myLane, myLane - 1, myLane + 1]) {
      if (l < 0 || l >= tune.LANES) continue;
      const t = threats[l];
      const safe = !t || t.tta > 1.4 || t.pass === 'jump' || t.pass === 'slide';
      if (safe && value[l] > value[target] + (l === myLane ? 0 : 1)) target = l;
    }
    if (target !== myLane) input[target < myLane ? 'left' : 'right'] = true;
  }
  return input;
}

/**
 * Headless arcade/travel simulation used by the §C8.7 proofs (bot average,
 * travel determinism). Steps the exact game logic at a fixed dt with the bot.
 * @param {{rng: () => number, mode?: string, maxSec?: number, dt?: number, tune?: object}} opts
 * @returns {{run: object, events: number, score: number}}
 */
export function simulateRun({ rng, mode = 'arcade', maxSec = 120, dt = 1 / 30, tune = SURF }) {
  const run = createRun({ rng, mode, tune });
  let events = 0;
  const steps = Math.ceil(maxSec / dt);
  for (let i = 0; i < steps; i += 1) {
    const evs = stepRun(run, dt, botInput(run));
    events += evs.length;
    if (run.ended || (run.mode === 'travel' && run.finished)) break;
  }
  return { run, events, score: runScore(run) };
}
