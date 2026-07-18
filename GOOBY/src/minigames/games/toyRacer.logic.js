// Toy Grand Prix — pure race logic (PLAN3 §C10.1 #1, agent V3/G41). No
// three.js/DOM imports (§B8 purity rule) — test/gamesV3a.test.js runs this
// headlessly and the visual module (toyRacer.js) renders THIS simulation 1:1.
//
// Binding §C10.1 #1 numbers implemented here (all in RACER below):
//   · 3-lap race on a seeded toy-room circuit built from Kenney toy-car-kit
//     track pieces (8-piece loop, 2 layout templates × seeds) vs 3
//     rubber-band AI karts
//   · hold-to-drift: charge meter → release = boost 1.2 s
//   · item boxes every ~⅓ lap (turbo / bumper-shield / toy-block drop behind)
//   · off-track = 40 % slow
//   · score = position bonus (1st 120 / 2nd 80 / 3rd 50 / 4th 30)
//     + 2·overtakes + drift meters/10
//   · meta {races, wins}; bot follows the center spline, drifts corners
//     > 45°, uses items instantly
//   · duration ~150 s (§C10.1 row; TARGET_LAP_SEC drives the base speed)
//
// Geometry model: templates are walked on a grid (dir 0=+z, 1=−x, 2=−z,
// 3=+x — all turns are LEFT turns, matching the authored toy-car-kit corner
// pieces so no mirrored GLBs are needed). Each piece emits fine parametric
// points (+ up vectors for the vertical loop); the fine polyline is
// re-sampled to a uniform arc-length table the karts index by distance s.

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

/** All Toy-Grand-Prix tuning (§C10.1 #1 binding numbers + G41 knobs). */
export const RACER = Object.freeze({
  /** §C10.1: 3 laps, player + 3 rubber-band AI karts. */
  LAPS: 3,
  KARTS: 4,
  /** §C10.1: the circuit is an 8-piece toy-car-kit loop. */
  PIECES_PER_LOOP: 8,
  /** Track piece is 1 unit wide → half-width 0.5; off-track beyond that. */
  TRACK_HALF_W: 0.5,
  /** Steering clamp on-track / absolute clamp when running wide. */
  LAT_MAX: 0.36,
  LAT_HARD_MAX: 0.78,
  /** Base speed = lapLen / TARGET_LAP_SEC → ~150 s for the 3-lap race. */
  TARGET_LAP_SEC: 47,
  /** Hard safety cap — the round always ends (score with current rank). */
  MAX_RACE_SEC: 240,
  /** Visual world scale (track units → displayed toy-meters). driftMeters
   * for the §C10.1 score are counted in these display meters. */
  WORLD_SCALE: 2.6,
  /** Steering (lateral units/s); drifting steers harder. */
  STEER_RATE: 1.1,
  DRIFT_STEER_MULT: 1.6,
  /** Cornering slip: dLat/dt = signedKappa · speed² · SLIP_GAIN (outward). */
  SLIP_GAIN: 0.5,
  DRIFT_SLIP_MULT: 0.25,
  /** §C10.1 hold-to-drift: charge meter → release = boost 1.2 s. */
  DRIFT_BOOST_SEC: 1.2,
  DRIFT_BOOST_MULT: 1.45,
  DRIFT_MIN_CHARGE: 0.35,
  DRIFT_CHARGE_RATE_CURVE: 0.55,
  DRIFT_CHARGE_RATE_STRAIGHT: 0.12,
  /** |yaw curvature| above this counts as "curved track" for drift charge. */
  DRIFT_MIN_KAPPA: 0.12,
  /** §C10.1: off-track = 40 % slow. */
  OFFTRACK_MULT: 0.6,
  /** §C10.1: item boxes every ~⅓ lap (3 rows, 3 boxes each). */
  ITEM_ROWS_PER_LAP: 3,
  ITEM_ROW_FRACTIONS: Object.freeze([0.18, 0.5, 0.82]),
  ITEM_BOX_LATS: Object.freeze([-0.3, 0, 0.3]),
  ITEM_RESPAWN_SEC: 2.5,
  PICKUP_S_WINDOW: 0.35,
  PICKUP_LAT_WINDOW: 0.24,
  /** §C10.1 item kinds: turbo / bumper-shield / toy-block drop behind. */
  ITEM_KINDS: Object.freeze(['turbo', 'shield', 'block']),
  ITEM_WEIGHTS: Object.freeze([0.4, 0.3, 0.3]),
  TURBO_SEC: 2.0,
  TURBO_MULT: 1.5,
  /** Toy-block hazard: dropped behind, stuns karts that hit it. */
  BLOCK_DROP_BEHIND: 0.8,
  BLOCK_STUN_SEC: 0.9,
  BLOCK_STUN_MULT: 0.25,
  BLOCK_HIT_S: 0.28,
  BLOCK_HIT_LAT: 0.22,
  MAX_BLOCKS: 6,
  /** Rubber-band AI (§C10.1): speed factor from the gap to the player,
   * clamped to [RUBBER_MIN, RUBBER_MAX] (test/gamesV3a.test.js pins it). */
  RUBBER_DIST: 6,
  RUBBER_GAIN: 0.1,
  RUBBER_MIN: 0.88,
  RUBBER_MAX: 1.12,
  /** Seeded per-AI personality speed spread (below base: skilled drifting +
   * items are the player's winning edge; the rubber band keeps it close). */
  AI_SPREAD: 0.04,
  /** Speed approach rates (accelerating / braking). */
  ACCEL_RATE: 2,
  BRAKE_RATE: 5,
  /** §C10.1 score: position bonus 1st..4th + 2·overtakes + driftMeters/10. */
  POSITION_BONUS: Object.freeze([120, 80, 50, 30]),
  OVERTAKE_POINTS: 2,
  DRIFT_METERS_DIV: 10,
  /** Anti-ping-pong: min seconds between counted passes of the same kart. */
  OVERTAKE_COOLDOWN_SEC: 1.5,
  /** Bot (§C10.1): drifts corners > 45°; small human-ish wobble. */
  BOT_DRIFT_MIN_DEG: 45,
  BOT_CORNER_LOOKAHEAD: 1.0,
  /** Uniform arc-length sample step (track units). */
  SAMPLE_STEP: 0.25,
  /** Grid start: karts staggered behind the line (player starts LAST). */
  GRID_GAP: 0.85,
  /** Sim substep ceiling (s). */
  MAX_SUBSTEP: 1 / 30,
});

/**
 * Piece library: geometry semantics per piece type. `model` = the committed
 * toy-car-kit GLB (§D5); `originOffset` = distance from the piece's GLB
 * origin to its entry port along the travel axis (the loop GLB is centered).
 */
export const PIECE_LIB = Object.freeze({
  straight: Object.freeze({ kind: 'straight', len: 4, dy: 0, model: 'track-narrow-straight' }),
  bumpUp: Object.freeze({ kind: 'straight', len: 4, dy: 0.5, model: 'track-narrow-straight-bump-up' }),
  bumpDown: Object.freeze({ kind: 'straight', len: 4, dy: -0.5, model: 'track-narrow-straight-bump-down' }),
  cornerS: Object.freeze({ kind: 'corner', r: 2, model: 'track-narrow-corner-small' }),
  cornerL: Object.freeze({ kind: 'corner', r: 4, model: 'track-narrow-corner-large' }),
  curve: Object.freeze({ kind: 'shift', len: 4, shift: 2, model: 'track-narrow-curve' }),
  // r/entry match the committed GLB riding surface: inner circle r ≈ 1.7
  // centered on the piece (bbox audit: road at −0.7, inner top ≈ 2.7,
  // z −2…2 with the origin at the piece center)
  loop: Object.freeze({ kind: 'loop', len: 4, shift: 1, r: 1.7, entry: 2, model: 'track-narrow-looping', originOffset: 2 }),
});

/**
 * §C10.1: exactly 2 layout templates; seeds pick one + vary the bump pair /
 * decoration. Both walks CLOSE on the grid (verified by tests): every turn
 * is a left 90°, four per loop.
 */
export const TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'rugRing',
    // start/finish on the front straight; 4 corner-large + 4 straights
    pieces: Object.freeze(['straight', 'straight', 'cornerL', 'cornerL', 'straight', 'straight', 'cornerL', 'cornerL']),
    // seeded variant: back-straight pair becomes bump-up + bump-down
    bumpPair: Object.freeze([4, 5]),
  }),
  Object.freeze({
    id: 'loopBoulevard',
    // double vertical loop straightaway + mixed-radius corners + lane-shift
    pieces: Object.freeze(['loop', 'loop', 'cornerS', 'cornerL', 'straight', 'curve', 'cornerS', 'cornerL']),
    bumpPair: null,
  }),
]);

/** Grid direction vectors (x, z): 0=+z · 1=−x · 2=−z · 3=+x. */
export const DIRS = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([-1, 0]),
  Object.freeze([0, -1]),
  Object.freeze([1, 0]),
]);

/** @param {number} d @returns {number} left-turned direction index */
export function leftOf(d) {
  return (d + 1) % 4;
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Emit fine parametric points for one piece.
 * @param {object} def PIECE_LIB entry
 * @param {{x: number, y: number, z: number, dir: number}} cur entry pose
 * @returns {{points: Array<{p: number[], up: number[]}>, next: {x, y, z, dir}}}
 */
function emitPiece(def, cur) {
  const h = DIRS[cur.dir];
  const l = DIRS[leftOf(cur.dir)];
  const points = [];
  const FINE = 0.06; // fine param step (units along the dominant axis)
  if (def.kind === 'straight') {
    const n = Math.ceil(def.len / FINE);
    for (let i = 0; i < n; i += 1) {
      const u = (i / n) * def.len;
      const t = u / def.len;
      points.push({
        p: [cur.x + h[0] * u, cur.y + def.dy * smooth(t), cur.z + h[1] * u],
        up: [0, 1, 0],
      });
    }
    return { points, next: { x: cur.x + h[0] * def.len, y: cur.y + def.dy, z: cur.z + h[1] * def.len, dir: cur.dir } };
  }
  if (def.kind === 'corner') {
    const r = def.r;
    const cx = cur.x + l[0] * r;
    const cz = cur.z + l[1] * r;
    const arc = (Math.PI / 2) * r;
    const n = Math.ceil(arc / FINE);
    for (let i = 0; i < n; i += 1) {
      const phi = (i / n) * (Math.PI / 2);
      points.push({
        p: [
          cx - l[0] * r * Math.cos(phi) + h[0] * r * Math.sin(phi),
          cur.y,
          cz - l[1] * r * Math.cos(phi) + h[1] * r * Math.sin(phi),
        ],
        up: [0, 1, 0],
      });
    }
    return { points, next: { x: cur.x + h[0] * r + l[0] * r, y: cur.y, z: cur.z + h[1] * r + l[1] * r, dir: leftOf(cur.dir) } };
  }
  if (def.kind === 'shift') {
    const n = Math.ceil(def.len / FINE);
    for (let i = 0; i < n; i += 1) {
      const u = (i / n) * def.len;
      const t = u / def.len;
      points.push({
        p: [cur.x + h[0] * u + l[0] * def.shift * smooth(t), cur.y, cur.z + h[1] * u + l[1] * def.shift * smooth(t)],
        up: [0, 1, 0],
      });
    }
    return { points, next: { x: cur.x + h[0] * def.len + l[0] * def.shift, y: cur.y, z: cur.z + h[1] * def.len + l[1] * def.shift, dir: cur.dir } };
  }
  // vertical loop: entry straight → 2π circle in the (heading, y) plane with
  // a 1-unit corkscrew drift to the left → exit straight.
  const R = def.r;
  const entry = def.entry ?? def.len / 2;
  const exit = def.len - entry;
  const nE = Math.ceil(entry / FINE);
  for (let i = 0; i < nE; i += 1) {
    const u = (i / nE) * entry;
    points.push({ p: [cur.x + h[0] * u, cur.y, cur.z + h[1] * u], up: [0, 1, 0] });
  }
  const c0x = cur.x + h[0] * entry;
  const c0z = cur.z + h[1] * entry;
  const nC = Math.ceil((2 * Math.PI * R) / FINE);
  for (let i = 0; i < nC; i += 1) {
    const th = (i / nC) * Math.PI * 2;
    const drift = (th / (Math.PI * 2)) * def.shift;
    const fx = c0x + h[0] * R * Math.sin(th) + l[0] * drift;
    const fy = cur.y + R * (1 - Math.cos(th));
    const fz = c0z + h[1] * R * Math.sin(th) + l[1] * drift;
    // up points from the kart toward the loop center (same lateral slice)
    const ux = -h[0] * Math.sin(th);
    const uy = Math.cos(th);
    const uz = -h[1] * Math.sin(th);
    points.push({ p: [fx, fy, fz], up: [ux, uy, uz] });
  }
  const exX = c0x + l[0] * def.shift;
  const exZ = c0z + l[1] * def.shift;
  const nX = Math.ceil(exit / FINE);
  for (let i = 0; i < nX; i += 1) {
    const u = (i / nX) * exit;
    points.push({ p: [exX + h[0] * u, cur.y, exZ + h[1] * u], up: [0, 1, 0] });
  }
  return {
    points,
    next: { x: cur.x + h[0] * def.len + l[0] * def.shift, y: cur.y, z: cur.z + h[1] * def.len + l[1] * def.shift, dir: cur.dir },
  };
}

const vlen = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => {
  const n = vlen(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/**
 * Build the seeded circuit (§C10.1: 2 templates × seeds).
 * @param {number} seed
 * @param {object} [tune]
 * @returns {{templateId: string, pieces: Array<object>, samples: Array<object>,
 *   step: number, lapLen: number, cornerZones: Array<object>, itemRows: Array<object>}}
 */
export function buildTrack(seed, tune = RACER) {
  const rng = mulberry32((seed ^ 0x51ab7e0d) >>> 0);
  const tplIdx = rng() < 0.5 ? 0 : 1;
  const tpl = TEMPLATES[tplIdx];
  const useBumps = tpl.bumpPair != null && rng() < 0.6;
  const types = tpl.pieces.map((type, i) => {
    if (useBumps && i === tpl.bumpPair[0]) return 'bumpUp';
    if (useBumps && i === tpl.bumpPair[1]) return 'bumpDown';
    return type;
  });

  let cur = { x: 0, y: 0, z: 0, dir: 0 };
  const pieces = [];
  const fine = [];
  const pieceRanges = [];
  for (const type of types) {
    const def = PIECE_LIB[type];
    pieces.push({
      type,
      model: def.model,
      x: cur.x,
      y: cur.y,
      z: cur.z,
      dir: cur.dir,
      originOffset: def.originOffset ?? 0,
    });
    const from = fine.length;
    const { points, next } = emitPiece(def, cur);
    fine.push(...points);
    pieceRanges.push({ type, from, to: fine.length, turnDeg: def.kind === 'corner' ? 90 : 0 });
    cur = next;
  }

  // uniform arc-length resample
  const step = tune.SAMPLE_STEP;
  const samples = [];
  let acc = 0;
  let prev = fine[0];
  samples.push({ p: [...prev.p], up: [...prev.up] });
  const fineS = [0];
  for (let i = 1; i <= fine.length; i += 1) {
    const pt = fine[i % fine.length];
    const d = Math.hypot(pt.p[0] - prev.p[0], pt.p[1] - prev.p[1], pt.p[2] - prev.p[2]);
    const segStart = acc;
    acc += d;
    fineS.push(acc);
    while (samples.length * step <= acc && d > 0) {
      const target = samples.length * step;
      const f = (target - segStart) / d;
      samples.push({
        p: [
          prev.p[0] + (pt.p[0] - prev.p[0]) * f,
          prev.p[1] + (pt.p[1] - prev.p[1]) * f,
          prev.p[2] + (pt.p[2] - prev.p[2]) * f,
        ],
        up: norm([
          prev.up[0] + (pt.up[0] - prev.up[0]) * f,
          prev.up[1] + (pt.up[1] - prev.up[1]) * f,
          prev.up[2] + (pt.up[2] - prev.up[2]) * f,
        ]),
      });
    }
    prev = pt;
  }
  const lapLen = acc;

  // tangents (central difference over the closed loop) + signed yaw curvature
  const n = samples.length;
  for (let i = 0; i < n; i += 1) {
    const a = samples[(i - 1 + n) % n].p;
    const b = samples[(i + 1) % n].p;
    samples[i].t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  }
  for (let i = 0; i < n; i += 1) {
    const t0 = samples[i].t;
    const t1 = samples[(i + 1) % n].t;
    const h0 = Math.hypot(t0[0], t0[2]);
    const h1 = Math.hypot(t1[0], t1[2]);
    if (h0 < 0.5 || h1 < 0.5) {
      samples[i].kappa = 0; // inside the vertical loop: no yaw slip
      continue;
    }
    // signed yaw angle between horizontal projections (positive = left turn)
    const cross = t0[2] * t1[0] - t0[0] * t1[2];
    const dot = (t0[0] * t1[0] + t0[2] * t1[2]) / (h0 * h1);
    const ang = Math.atan2(cross, Math.max(-1, Math.min(1, dot)));
    samples[i].kappa = ang / step;
  }

  // corner zones in arc-length space (bot drifts zones > 45° — §C10.1)
  const cornerZones = pieceRanges
    .filter((r) => r.turnDeg > 0)
    .map((r) => ({
      s0: fineS[r.from],
      s1: fineS[Math.min(r.to, fineS.length - 1)],
      turnDeg: r.turnDeg,
    }));
  // loop-piece ranges (steering is locked to center inside the vertical loop)
  const loopZones = pieceRanges
    .filter((r) => r.type === 'loop')
    .map((r) => ({ s0: fineS[r.from], s1: fineS[Math.min(r.to, fineS.length - 1)] }));

  // §C10.1: item boxes every ~⅓ lap; rows are pushed out of loop pieces
  const itemRows = tune.ITEM_ROW_FRACTIONS.map((f) => {
    let s = f * lapLen;
    for (const z of loopZones) {
      if (s > z.s0 - 1 && s < z.s1 + 0.5) s = (z.s1 + 0.8) % lapLen;
    }
    return {
      s,
      boxes: tune.ITEM_BOX_LATS.map((lat) => ({ lat, respawnT: 0 })),
    };
  });

  return { templateId: tpl.id, hasBumps: useBumps, pieces, samples, step, lapLen, cornerZones, loopZones, itemRows };
}

/**
 * Sample the center spline at arc distance s (wraps around the lap).
 * @param {object} track @param {number} s
 * @returns {{p: number[], t: number[], up: number[], right: number[], kappa: number}}
 */
export function pointAt(track, s) {
  const n = track.samples.length;
  let u = (s % track.lapLen) / track.step;
  if (u < 0) u += n;
  const i0 = Math.floor(u) % n;
  const i1 = (i0 + 1) % n;
  const f = u - Math.floor(u);
  const a = track.samples[i0];
  const b = track.samples[i1];
  const lerp3 = (x, y) => [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f];
  const p = lerp3(a.p, b.p);
  const t = norm(lerp3(a.t, b.t));
  const up = norm(lerp3(a.up, b.up));
  // right = tangent × up
  const right = norm([
    t[1] * up[2] - t[2] * up[1],
    t[2] * up[0] - t[0] * up[2],
    t[0] * up[1] - t[1] * up[0],
  ]);
  return { p, t, up, right, kappa: a.kappa };
}

/**
 * Rubber-band factor for an AI kart (§C10.1): behind the player → faster,
 * ahead → slower, clamped (test-pinned bounds).
 * @param {number} gap playerProgress − aiProgress (track units)
 * @param {object} [tune]
 * @returns {number} RUBBER_MIN … RUBBER_MAX
 */
export function computeRubber(gap, tune = RACER) {
  return Math.min(tune.RUBBER_MAX, Math.max(tune.RUBBER_MIN, 1 + (gap / tune.RUBBER_DIST) * tune.RUBBER_GAIN));
}

/**
 * Weighted item roll (§C10.1: turbo / bumper-shield / toy-block).
 * @param {() => number} rng @param {object} [tune]
 * @returns {'turbo'|'shield'|'block'}
 */
export function rollItem(rng, tune = RACER) {
  let r = rng();
  for (let i = 0; i < tune.ITEM_KINDS.length; i += 1) {
    r -= tune.ITEM_WEIGHTS[i];
    if (r < 0) return tune.ITEM_KINDS[i];
  }
  return tune.ITEM_KINDS[tune.ITEM_KINDS.length - 1];
}

/**
 * §C10.1 score formula (binding): position bonus + 2·overtakes +
 * driftMeters/10 (floored).
 * @param {number} rank final position 1..4
 * @param {number} overtakes
 * @param {number} driftMeters displayed (world-scaled) drift meters
 * @param {object} [tune]
 * @returns {number}
 */
export function raceScore(rank, overtakes, driftMeters, tune = RACER) {
  const bonus = tune.POSITION_BONUS[Math.min(tune.POSITION_BONUS.length, Math.max(1, rank)) - 1];
  return bonus + tune.OVERTAKE_POINTS * overtakes + Math.floor(driftMeters / tune.DRIFT_METERS_DIV);
}

/**
 * Create the seeded race state (§E8: the framework seeds via params.seed).
 * @param {number} seed
 * @param {object} [tune]
 * @returns {object} race
 */
export function createRace(seed, tune = RACER) {
  const track = buildTrack(seed, tune);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const baseSpeed = track.lapLen / tune.TARGET_LAP_SEC;
  const karts = [];
  for (let i = 0; i < tune.KARTS; i += 1) {
    const isPlayer = i === 0;
    // grid: AI at the front rows, the player starts LAST (§C10.1 overtakes)
    const gridPos = isPlayer ? tune.KARTS - 1 : i - 1;
    const gridOffset = 1.0 + gridPos * tune.GRID_GAP;
    karts.push({
      id: i,
      isPlayer,
      s: ((track.lapLen - gridOffset) % track.lapLen + track.lapLen) % track.lapLen,
      progress: -gridOffset,
      lateral: gridPos % 2 === 0 ? -0.22 : 0.22,
      targetLateral: 0,
      speed: 0,
      drifting: false,
      driftCharge: 0,
      driftMeters: 0,
      boostT: 0,
      boostMult: 1,
      stunT: 0,
      offTrack: false,
      shield: false,
      item: null,
      personality: isPlayer ? 1 : 1 - rng() * tune.AI_SPREAD,
      // deterministic lane spread (−0.26/0/+0.26 + jitter): keeps the pack
      // visually side-by-side instead of stacking on the center line
      laneBias: isPlayer ? 0 : [-0.26, 0, 0.26][i - 1] + (rng() * 2 - 1) * 0.05,
      passSign: 0, // sign of (player − this AI) progress, for overtake edges
      passCooldown: 0,
      finished: false,
      finishRank: 0,
    });
  }
  return {
    seed,
    tune,
    track,
    rng,
    baseSpeed,
    karts,
    blocks: [],
    time: 0,
    overtakes: 0,
    ended: false,
    finishRank: 0,
    lastLapBanner: 0,
    events: [],
  };
}

/** @param {object} race @returns {number} rank 1..4 of the player right now */
export function playerRank(race) {
  const p = race.karts[0].progress;
  let rank = 1;
  for (let i = 1; i < race.karts.length; i += 1) {
    if (race.karts[i].progress > p) rank += 1;
  }
  return rank;
}

/** Displayed lap number 1..LAPS. @param {object} race @returns {number} */
export function playerLap(race) {
  const laps = Math.floor(race.karts[0].progress / race.track.lapLen) + 1;
  return Math.min(race.tune.LAPS, Math.max(1, laps));
}

/** Signed shortest s-difference around the loop. */
function sDelta(a, b, lapLen) {
  let d = a - b;
  while (d > lapLen / 2) d -= lapLen;
  while (d < -lapLen / 2) d += lapLen;
  return d;
}

/** True when s sits inside a vertical-loop piece (steering locks center). */
function inLoopZone(track, s) {
  const sm = ((s % track.lapLen) + track.lapLen) % track.lapLen;
  for (const z of track.loopZones) {
    if (sm >= z.s0 && sm <= z.s1) return true;
  }
  return false;
}

/** Corner zone (with a small lookahead) whose turn exceeds minDeg, or null. */
export function cornerZoneAt(track, s, lookahead = 0, minDeg = 0) {
  const sm = ((s + lookahead) % track.lapLen + track.lapLen) % track.lapLen;
  for (const z of track.cornerZones) {
    if (z.turnDeg >= minDeg && sm >= z.s0 && sm <= z.s1) return z;
  }
  return null;
}

/** Use the held item NOW (§C10.1 kinds). @param {object} race @param {object} kart */
function useItem(race, kart) {
  const tune = race.tune;
  const kind = kart.item;
  if (!kind) return;
  kart.item = null;
  if (kind === 'turbo') {
    kart.boostT = Math.max(kart.boostT, tune.TURBO_SEC);
    kart.boostMult = tune.TURBO_MULT;
    race.events.push({ type: 'turbo', kart: kart.id });
  } else if (kind === 'shield') {
    kart.shield = true;
    race.events.push({ type: 'shield', kart: kart.id });
  } else {
    const s = ((kart.s - tune.BLOCK_DROP_BEHIND) % race.track.lapLen + race.track.lapLen) % race.track.lapLen;
    race.blocks.push({ s, lat: kart.lateral, by: kart.id });
    if (race.blocks.length > tune.MAX_BLOCKS) race.blocks.shift();
    race.events.push({ type: 'blockDrop', kart: kart.id, s, lat: kart.lateral });
  }
}

/** Internal AI steering/drift/item decision (center spline + racing line). */
function aiInput(race, kart) {
  const tune = race.tune;
  const track = race.track;
  let steer = kart.laneBias;
  const zone = cornerZoneAt(track, kart.s, tune.BOT_CORNER_LOOKAHEAD, 0);
  if (zone) steer = -0.2 + kart.laneBias * 0.6; // inside of the (left) turn
  // item-box seek when empty-handed
  if (kart.item == null) {
    for (const row of track.itemRows) {
      const d = sDelta(row.s, kart.s, track.lapLen);
      if (d > 0 && d < 3) {
        let best = null;
        for (const box of row.boxes) {
          if (box.respawnT > 0) continue;
          if (best == null || Math.abs(box.lat - kart.lateral) < Math.abs(best - kart.lateral)) best = box.lat;
        }
        if (best != null) steer = best;
      }
    }
  }
  // toy-block avoidance
  for (const block of race.blocks) {
    const d = sDelta(block.s, kart.s, track.lapLen);
    if (d > 0 && d < 2.2 && Math.abs(block.lat - kart.lateral) < 0.3) {
      steer = block.lat > 0 ? block.lat - 0.45 : block.lat + 0.45;
    }
  }
  const drifting = zone != null && zone.turnDeg >= tune.BOT_DRIFT_MIN_DEG;
  return { steer, drifting, useItem: kart.item != null }; // §C10.1: AI uses items instantly
}

/** One kart integration substep. */
function stepKart(race, kart, dt, input) {
  const tune = race.tune;
  const track = race.track;
  const sample = pointAt(track, kart.s);

  // --- drift state (hold-to-drift §C10.1) ---
  const wasDrifting = kart.drifting;
  kart.drifting = !!input.drifting && kart.stunT <= 0;
  if (wasDrifting && !kart.drifting) {
    // §C10.1: charge meter → release = boost 1.2 s. The drift-BOOST is the
    // player's skill edge — AI karts drift for show (grip + style) but stay
    // balanced purely by the rubber band below.
    if (kart.isPlayer && kart.driftCharge >= tune.DRIFT_MIN_CHARGE) {
      kart.boostT = Math.max(kart.boostT, tune.DRIFT_BOOST_SEC);
      kart.boostMult = tune.DRIFT_BOOST_MULT;
      race.events.push({ type: 'boost', kart: kart.id, charge: kart.driftCharge });
    }
    kart.driftCharge = 0;
  }
  if (kart.drifting && kart.speed > 0.2) {
    const curved = Math.abs(sample.kappa) >= tune.DRIFT_MIN_KAPPA;
    kart.driftCharge = Math.min(1, kart.driftCharge + (curved ? tune.DRIFT_CHARGE_RATE_CURVE : tune.DRIFT_CHARGE_RATE_STRAIGHT) * dt);
    kart.driftMeters += kart.speed * dt * tune.WORLD_SCALE;
  }

  // --- speed ---
  let target = race.baseSpeed * kart.personality;
  if (kart.boostT > 0) target *= kart.boostMult;
  if (kart.stunT > 0) target *= tune.BLOCK_STUN_MULT;
  if (kart.offTrack) target *= tune.OFFTRACK_MULT; // §C10.1: off-track 40 % slow
  // rubber band LAST (§C10.1) so an AI turbo can't cancel the catch-up rule:
  // ahead of the player → capped slower, behind → capped faster.
  if (!kart.isPlayer) target *= computeRubber(race.karts[0].progress - kart.progress, tune);
  const rate = target < kart.speed ? tune.BRAKE_RATE : tune.ACCEL_RATE;
  kart.speed += (target - kart.speed) * Math.min(1, dt * rate);

  // --- lateral ---
  const inLoop = inLoopZone(track, kart.s);
  if (input.steer != null && !inLoop) kart.targetLateral = Math.max(-tune.LAT_HARD_MAX, Math.min(tune.LAT_HARD_MAX, input.steer));
  if (inLoop) kart.targetLateral = 0; // the loop rails hold the kart centered
  const steerRate = tune.STEER_RATE * (kart.drifting ? tune.DRIFT_STEER_MULT : 1);
  const dLat = kart.targetLateral - kart.lateral;
  const maxStep = steerRate * dt;
  kart.lateral += Math.max(-maxStep, Math.min(maxStep, dLat));
  // cornering slip pushes OUTWARD (left turn → +right); drifting grips
  const slip = sample.kappa * kart.speed * kart.speed * tune.SLIP_GAIN * (kart.drifting ? tune.DRIFT_SLIP_MULT : 1);
  kart.lateral += slip * dt;
  kart.lateral = Math.max(-tune.LAT_HARD_MAX, Math.min(tune.LAT_HARD_MAX, kart.lateral));
  const wasOff = kart.offTrack;
  kart.offTrack = Math.abs(kart.lateral) > tune.TRACK_HALF_W && !inLoop;
  if (kart.offTrack && !wasOff && kart.isPlayer) race.events.push({ type: 'offtrack', kart: kart.id });

  // --- advance ---
  kart.s = ((kart.s + kart.speed * dt) % track.lapLen + track.lapLen) % track.lapLen;
  kart.progress += kart.speed * dt;

  // --- item boxes (§C10.1: every ~⅓ lap; respawn after ITEM_RESPAWN_SEC) ---
  for (const row of track.itemRows) {
    if (Math.abs(sDelta(row.s, kart.s, track.lapLen)) > tune.PICKUP_S_WINDOW) continue;
    for (const box of row.boxes) {
      if (box.respawnT > 0) continue;
      if (Math.abs(box.lat - kart.lateral) > tune.PICKUP_LAT_WINDOW) continue;
      box.respawnT = tune.ITEM_RESPAWN_SEC;
      if (kart.item == null) {
        kart.item = rollItem(race.rng, tune);
        race.events.push({ type: 'pickup', kart: kart.id, item: kart.item, s: row.s, lat: box.lat });
      } else {
        race.events.push({ type: 'boxBump', kart: kart.id, s: row.s, lat: box.lat });
      }
      break;
    }
  }

  // --- toy-block hits ---
  if (kart.stunT <= 0) {
    for (let i = race.blocks.length - 1; i >= 0; i -= 1) {
      const block = race.blocks[i];
      if (block.by === kart.id && Math.abs(sDelta(block.s, kart.s, track.lapLen)) < 1.2) continue; // your own fresh drop
      if (Math.abs(sDelta(block.s, kart.s, track.lapLen)) > tune.BLOCK_HIT_S) continue;
      if (Math.abs(block.lat - kart.lateral) > tune.BLOCK_HIT_LAT) continue;
      race.blocks.splice(i, 1);
      if (kart.shield) {
        kart.shield = false;
        race.events.push({ type: 'shieldPop', kart: kart.id });
      } else {
        kart.stunT = tune.BLOCK_STUN_SEC;
        kart.driftCharge = 0;
        race.events.push({ type: 'blockHit', kart: kart.id });
      }
      break;
    }
  }

  if (input.useItem) useItem(race, kart);
  kart.boostT = Math.max(0, kart.boostT - dt);
  kart.stunT = Math.max(0, kart.stunT - dt);
}

/**
 * Advance the race by dt (internally sub-stepped).
 * @param {object} race
 * @param {number} dt seconds
 * @param {{steer: number|null, drifting: boolean, useItem: boolean}} input player input
 */
export function stepRace(race, dt, input = { steer: null, drifting: false, useItem: false }) {
  if (race.ended) return;
  const tune = race.tune;
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-9 && !race.ended) {
    const h = Math.min(tune.MAX_SUBSTEP, remaining);
    remaining -= h;
    race.time += h;

    for (const row of race.track.itemRows) {
      for (const box of row.boxes) box.respawnT = Math.max(0, box.respawnT - h);
    }

    const player = race.karts[0];
    stepKart(race, player, h, input);
    // player uses the item only on the substep where the flag arrived
    if (input.useItem) input = { ...input, useItem: false };
    for (let i = 1; i < race.karts.length; i += 1) {
      const kart = race.karts[i];
      stepKart(race, kart, h, aiInput(race, kart));
      // overtake edge detection (player passes this AI) with anti-ping-pong
      kart.passCooldown = Math.max(0, kart.passCooldown - h);
      const sign = Math.sign(player.progress - kart.progress);
      if (sign > 0 && kart.passSign < 0 && kart.passCooldown <= 0 && race.time > 1) {
        race.overtakes += 1;
        kart.passCooldown = tune.OVERTAKE_COOLDOWN_SEC;
        race.events.push({ type: 'overtake', total: race.overtakes });
      }
      if (sign !== 0) kart.passSign = sign;
    }

    // lap banners (player)
    const lap = Math.floor(player.progress / race.track.lapLen);
    if (lap > race.lastLapBanner && lap < tune.LAPS) {
      race.lastLapBanner = lap;
      race.events.push({ type: 'lap', lap: lap + 1, final: lap + 1 === tune.LAPS });
    }

    // finish: the player completes LAPS laps (or the safety timer fires)
    if (player.progress >= tune.LAPS * race.track.lapLen || race.time >= tune.MAX_RACE_SEC) {
      race.ended = true;
      race.finishRank = playerRank(race);
      race.events.push({ type: 'finish', rank: race.finishRank });
    }
  }
}

/**
 * §C10.1 bot (dev-only ?autoplay=1): follows the center spline, drifts
 * corners > 45°, seeks item boxes, avoids toy blocks, uses items instantly.
 * @param {object} race
 * @returns {{steer: number, drifting: boolean, useItem: boolean}}
 */
export function botInput(race) {
  const player = race.karts[0];
  const base = aiInput(race, player);
  // tiny deterministic wobble so bot runs look alive (seeded rng)
  const wobble = Math.sin(race.time * 1.7) * 0.03;
  return { steer: base.steer + wobble, drifting: base.drifting, useItem: player.item != null };
}

/** Final §C10.1 score of an ended (or running) race. @param {object} race @returns {number} */
export function runScore(race) {
  const rank = race.ended ? race.finishRank : playerRank(race);
  return raceScore(rank, race.overtakes, race.karts[0].driftMeters, race.tune);
}

/** §B3 meta payload (§C10.1: meta races/wins). @param {object} race */
export function runMeta(race) {
  const rank = race.ended ? race.finishRank : playerRank(race);
  return { races: 1, wins: rank === 1 ? 1 : 0, overtakes: race.overtakes };
}
