// Gooby Welt — pure spline/corridor/pickup/scoring logic (PLAN4-GAMES §G6,
// agent V4/G66). No three.js/DOM imports so `node --test` runs this headlessly
// (§B rule); the scene module (goobyWelt.js) imports from here and stays
// render-only. Binding §G6.3/§G6.4 numbers: auto-forward 1.6 m/s along an
// authored Catmull-Rom path (110 s ± 5 traversal ≈ 176 m), drag-steered
// lateral/vertical offset (x ∈ [−2.5, +2.5] m, y ∈ [−1.0, +1.8] m, 2.2 m per
// screen-width, eased k = 6/s) clamped inside a per-segment corridor
// half-width table; pickups are invisible sphere colliders (r 0.9 m) against
// Gooby's position — the splat world is VISUAL ONLY (§G6 recipe: no geometry
// collision, paths authored to never intersect the world). Scoring: 28 stars
// ×2 + 6 carrots ×5 + 3 foto-spots ×10 + finish 10 = 126 max. Foto-spots are
// r = 3 m trigger spheres that fire a brief wonder-pause + flash moment.
// Difficulty: §G5.1 EXCLUDES goobyWelt (framework.logic.js
// DIFFICULTY_EXCLUDED_GAMES — normal only, no endless, no modifiers §G8-5).
// The deterministic §G6.7 CI bot lives here too (scripted-spline follower).

/** Binding §G6.3/§G6.4/§G6.5 numbers + V4/G66 tuning. */
export const WELT = Object.freeze({
  /** Auto-forward speed along the spline (§G6.3). */
  SPEED_M_S: 1.6,
  /** Nominal run length (§G6.3: paths authored to 110 s ± 5 at 1.6 m/s). */
  DURATION_SEC: 110,
  DURATION_TOL_SEC: 5,
  /** §G6.5-3 spline-length window (≈ 176 m of spline). */
  SPLINE_MIN_M: 165,
  SPLINE_MAX_M: 185,
  /** Drag-steer offset window around the spline (§G6.3). */
  OFFSET_X_MAX: 2.5,
  OFFSET_Y_MIN: -1.0,
  OFFSET_Y_MAX: 1.8,
  /** Drag sensitivity: metres of offset per screen-WIDTH of drag (§G6.3). */
  DRAG_M_PER_SCREEN_W: 2.2,
  /** Offset easing rate k (§G6.3: eased at k = 6/s). */
  OFFSET_EASE_K: 6,
  /** Gooby rig numbers (§G6.3) — consumed render-side, pinned here. */
  GOOBY_SCALE: 0.55,
  GOOBY_AHEAD_M: 2.2,
  BOB_AMP_M: 0.06,
  BOB_HZ: 0.4,
  CAMERA_FOV: 58,
  /** Camera far plane per quality (§G6.6: low = 60 vs 90). */
  CAMERA_FAR_HIGH: 90,
  CAMERA_FAR_LOW: 60,
  /** Renderer pixel ratio per quality (§G6.6). */
  PIXEL_RATIO_HIGH: 1,
  PIXEL_RATIO_LOW: 0.75,
  /** Pickup sphere collider radius vs Gooby position (§G6.4). */
  PICKUP_RADIUS_M: 0.9,
  /** Foto-spot trigger sphere radius (§G6.4). */
  FOTO_RADIUS_M: 3,
  /** Scoring (§G6.4): 28·2 + 6·5 + 3·10 + 10 = 126. */
  STAR_POINTS: 2,
  CARROT_POINTS: 5,
  FOTO_POINTS: 10,
  FINISH_BONUS: 10,
  STAR_COUNT: 28,
  CARROT_COUNT: 6,
  FOTO_COUNT: 3,
  MAX_SCORE: 126,
  /** §G6.5-3 authoring validation rules. */
  MIN_CORRIDOR_M: 1.2,
  STAR_MIN_GAP_M: 2.5,
  FOTO_MIN_GAP_M: 25,
  WAYPOINTS_MIN: 25,
  WAYPOINTS_MAX: 40,
  /** Foto-spot wonder moment: brief forward-motion pause (V4/G66 tune). */
  FOTO_PAUSE_SEC: 1.1,
  /** §G6.7 bot: steer toward pickups < 2 m ahead (corridor-projected). */
  BOT_LOOKAHEAD_M: 2,
  /** Arc-length table resolution (samples per Catmull-Rom segment). */
  ARC_SAMPLES_PER_SEG: 32,
});

// ---------------------------------------------------------------------------
// Catmull-Rom spline + arc-length table (pure vector math on [x,y,z] arrays)
// ---------------------------------------------------------------------------

/** @typedef {[number, number, number]} Vec3 */

/** @param {Vec3} a @param {Vec3} b @returns {number} */
export function dist3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Uniform Catmull-Rom point on segment [p1..p2].
 * @param {Vec3} p0 @param {Vec3} p1 @param {Vec3} p2 @param {Vec3} p3
 * @param {number} u 0..1 within the segment
 * @returns {Vec3}
 */
export function catmullRom(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  /** @type {Vec3} */
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    out[i] = 0.5 * (
      2 * p1[i]
      + (-p0[i] + p2[i]) * u
      + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2
      + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3
    );
  }
  return out;
}

/**
 * Uniform Catmull-Rom derivative (unnormalized tangent) on segment [p1..p2].
 * @param {Vec3} p0 @param {Vec3} p1 @param {Vec3} p2 @param {Vec3} p3
 * @param {number} u 0..1
 * @returns {Vec3}
 */
export function catmullRomTangent(p0, p1, p2, p3, u) {
  const u2 = u * u;
  /** @type {Vec3} */
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    out[i] = 0.5 * (
      (-p0[i] + p2[i])
      + 2 * (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u
      + 3 * (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u2
    );
  }
  return out;
}

/**
 * Build the arc-length-parameterized track from authored scene data
 * (goobyWelt.paths.js shape — see the per-scene format there / G65's
 * weltScenes.js coordination note). Endpoints are clamped by duplicating the
 * first/last waypoints, so the spline passes through every authored point.
 * Deterministic: identical inputs produce an identical table.
 * @param {{waypoints: ReadonlyArray<Vec3>, corridor: ReadonlyArray<number>}} sceneData
 * @returns {{
 *   length: number,
 *   samples: {s: number[], pos: Vec3[], seg: number[], u: number[]},
 *   segCount: number,
 *   corridor: ReadonlyArray<number>,
 *   posAt: (s: number) => Vec3,
 *   tangentAt: (s: number) => Vec3,
 *   frameAt: (s: number) => {pos: Vec3, fwd: Vec3, right: Vec3, up: Vec3},
 *   corridorAt: (s: number) => number,
 * }}
 */
export function buildTrack(sceneData) {
  const pts = sceneData.waypoints;
  const n = pts.length;
  if (n < 2) throw new Error('[goobyWelt] track needs ≥ 2 waypoints');
  const segCount = n - 1;
  const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];

  // Cumulative arc-length table: ARC_SAMPLES_PER_SEG chords per segment.
  const S = WELT.ARC_SAMPLES_PER_SEG;
  const sArr = [0];
  /** @type {Vec3[]} */
  const posArr = [catmullRom(P(-1), P(0), P(1), P(2), 0)];
  const segArr = [0];
  const uArr = [0];
  let acc = 0;
  let prev = posArr[0];
  for (let seg = 0; seg < segCount; seg += 1) {
    for (let k = 1; k <= S; k += 1) {
      const u = k / S;
      const p = catmullRom(P(seg - 1), P(seg), P(seg + 1), P(seg + 2), u);
      acc += dist3(prev, p);
      sArr.push(acc);
      posArr.push(p);
      segArr.push(seg);
      uArr.push(u);
      prev = p;
    }
  }
  const length = acc;

  /** Binary search: greatest sample index with s[i] <= s. */
  function sampleIndex(s) {
    let lo = 0;
    let hi = sArr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sArr[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return Math.min(lo, sArr.length - 2);
  }

  /** Segment + local u for an arc position (linear between table rows). */
  function locate(s) {
    const c = Math.max(0, Math.min(length, s));
    const i = sampleIndex(c);
    const span = sArr[i + 1] - sArr[i];
    const f = span > 0 ? (c - sArr[i]) / span : 0;
    // Adjacent samples share a segment except at boundaries where u wraps
    // 1 → 0; treating the wrap as u = 1 on the earlier segment is exact
    // because the spline is C0-continuous across waypoints.
    const seg = segArr[i];
    const u0 = uArr[i];
    const u1 = segArr[i + 1] === seg ? uArr[i + 1] : 1;
    return { seg, u: u0 + (u1 - u0) * f };
  }

  function posAt(s) {
    const { seg, u } = locate(s);
    return catmullRom(P(seg - 1), P(seg), P(seg + 1), P(seg + 2), u);
  }

  function tangentAt(s) {
    const { seg, u } = locate(s);
    const d = catmullRomTangent(P(seg - 1), P(seg), P(seg + 1), P(seg + 2), u);
    const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  /**
   * Tangent frame at s (§G6.3): fwd = normalized tangent; right = fwd × Y-up
   * (== camera screen-right when the camera lookAt()s along fwd with world
   * up, so +offsetX is ALWAYS screen-right — §G2 by construction); up =
   * right × fwd (screen-up).
   */
  function frameAt(s) {
    const pos = posAt(s);
    const fwd = tangentAt(s);
    // Screen-right for a lookAt(fwd) camera with world up: three.js builds
    // xAxis = normalize(up × zAxis) = normalize(up × −fwd) = (−fwd_z, 0,
    // fwd_x) — degenerate only for vertical tangents, which the §G6.5-3
    // authoring rules exclude (gentle float paths).
    let rx = -fwd[2];
    let rz = fwd[0];
    const rl = Math.sqrt(rx * rx + rz * rz) || 1;
    rx /= rl;
    rz /= rl;
    /** @type {Vec3} */
    const right = [rx, 0, rz];
    /** @type {Vec3} */
    const up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
    return { pos, fwd, right, up };
  }

  // Corridor half-width lookup: the per-SEGMENT table (§G6.4) is sampled at
  // segment midpoints and interpolated piecewise-linearly between midpoints,
  // so the clamp never steps discontinuously at waypoint boundaries.
  const corridor = sceneData.corridor;
  const segStartS = [];
  for (let seg = 0; seg < segCount; seg += 1) segStartS.push(sArr[seg * S]);
  segStartS.push(length);
  const midS = [];
  for (let seg = 0; seg < segCount; seg += 1) {
    midS.push((segStartS[seg] + segStartS[seg + 1]) / 2);
  }

  function corridorAt(s) {
    const c = Math.max(0, Math.min(length, s));
    if (c <= midS[0]) return corridor[0];
    if (c >= midS[segCount - 1]) return corridor[segCount - 1];
    let lo = 0;
    while (lo < segCount - 2 && midS[lo + 1] <= c) lo += 1;
    const f = (c - midS[lo]) / (midS[lo + 1] - midS[lo]);
    return corridor[lo] + (corridor[lo + 1] - corridor[lo]) * f;
  }

  return {
    length,
    samples: { s: sArr, pos: posArr, seg: segArr, u: uArr },
    segCount,
    corridor,
    posAt,
    tangentAt,
    frameAt,
    corridorAt,
  };
}

/**
 * World position of a corridor offset at arc position s.
 * @param {ReturnType<typeof buildTrack>} track
 * @param {number} s arc metres
 * @param {{x: number, y: number}} offset corridor offset (m)
 * @returns {Vec3}
 */
export function offsetWorldPos(track, s, offset) {
  const { pos, right, up } = track.frameAt(s);
  return [
    pos[0] + right[0] * offset.x + up[0] * offset.y,
    pos[1] + right[1] * offset.x + up[1] * offset.y,
    pos[2] + right[2] * offset.x + up[2] * offset.y,
  ];
}

/**
 * World position of an authored pickup {s, ox, oy} (spline-relative — the
 * same tangent frame the runtime flies, so „within corridor" == reachable).
 * @param {ReturnType<typeof buildTrack>} track
 * @param {{s: number, ox: number, oy: number}} p
 * @returns {Vec3}
 */
export function pickupWorldPos(track, p) {
  return offsetWorldPos(track, p.s, { x: p.ox, y: p.oy });
}

// ---------------------------------------------------------------------------
// Offset steering (drag → target offset → eased + corridor-clamped)
// ---------------------------------------------------------------------------

/**
 * Clamp an offset to the §G6.3 window ∩ the corridor half-width at s.
 * The corridor clamps the LATERAL axis (half-width both sides); vertical
 * keeps the global §G6.3 window (paths are authored with vertical clearance).
 * @param {{x: number, y: number}} offset
 * @param {number} corridorHalfW
 * @returns {{x: number, y: number}}
 */
export function clampOffset(offset, corridorHalfW) {
  const xMax = Math.min(WELT.OFFSET_X_MAX, Math.max(0, corridorHalfW));
  return {
    x: Math.max(-xMax, Math.min(xMax, offset.x)),
    y: Math.max(WELT.OFFSET_Y_MIN, Math.min(WELT.OFFSET_Y_MAX, offset.y)),
  };
}

/**
 * Apply one §E5 drag delta to the target offset (§G6.3: 2.2 m per
 * screen-width, drag right = move screen right, drag up = float up — screen
 * dy grows DOWNWARD so it negates into +y).
 * @param {{x: number, y: number}} target current target offset
 * @param {number} dxPx drag delta px
 * @param {number} dyPx drag delta px
 * @param {number} screenW window innerWidth px
 * @returns {{x: number, y: number}} new target (unclamped — clamp at use)
 */
export function applyDrag(target, dxPx, dyPx, screenW) {
  const w = screenW > 0 ? screenW : 1;
  const k = WELT.DRAG_M_PER_SCREEN_W / w;
  return { x: target.x + dxPx * k, y: target.y - dyPx * k };
}

/**
 * Frame-rate-independent exponential ease toward the target (§G6.3 k = 6/s).
 * @param {number} current @param {number} target @param {number} dt seconds
 * @returns {number}
 */
export function easeOffset(current, target, dt) {
  return current + (target - current) * (1 - Math.exp(-WELT.OFFSET_EASE_K * Math.max(0, dt)));
}

// ---------------------------------------------------------------------------
// Run state machine
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} WeltRun
 * @property {ReturnType<typeof buildTrack>} track
 * @property {string} sceneId
 * @property {object} data the authored scene data (pickup lists)
 * @property {number} s camera arc position (m)
 * @property {{x: number, y: number}} offset eased current offset
 * @property {{x: number, y: number}} target steering target offset
 * @property {number} score
 * @property {number} stars collected count
 * @property {number} carrots collected count
 * @property {number} fotoSpots triggered count
 * @property {boolean[]} starDone
 * @property {boolean[]} carrotDone
 * @property {boolean[]} fotoDone
 * @property {number} fotoPauseT remaining wonder-pause seconds (0 = moving)
 * @property {number} elapsed wall seconds stepped so far
 * @property {boolean} finished
 */

/**
 * Create a fresh run over authored scene data.
 * @param {object} sceneData goobyWelt.paths.js scene entry
 * @param {string} [sceneId]
 * @returns {WeltRun}
 */
export function createRun(sceneData, sceneId = sceneData.id) {
  return {
    track: buildTrack(sceneData),
    sceneId,
    data: sceneData,
    s: 0,
    offset: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    score: 0,
    stars: 0,
    carrots: 0,
    fotoSpots: 0,
    starDone: sceneData.stars.map(() => false),
    carrotDone: sceneData.carrots.map(() => false),
    fotoDone: sceneData.fotoSpots.map(() => false),
    fotoPauseT: 0,
    elapsed: 0,
    finished: false,
  };
}

/** Gooby's arc position: 2.2 m ahead of the camera, clamped to the track. */
export function goobyArcPos(run) {
  return Math.min(run.track.length, run.s + WELT.GOOBY_AHEAD_M);
}

/** Gooby's world position (collision anchor — §G6.4 sphere tests hit THIS). */
export function goobyWorldPos(run) {
  return offsetWorldPos(run.track, goobyArcPos(run), run.offset);
}

/** HUD countdown seconds left (≈ 110 at start, 0 at the finish gate). */
export function hudTimeLeft(run) {
  return Math.max(0, (run.track.length - run.s) / WELT.SPEED_M_S);
}

/**
 * @typedef {{type: 'star'|'carrot'|'foto'|'finish', index: number,
 *   points: number, pos?: Vec3}} WeltEvent
 */

/**
 * Advance the run by dt seconds: auto-forward (frozen during a foto-spot
 * wonder pause), ease + clamp the offset, run the §G6.4 sphere pickups
 * against Gooby's position, fire the finish gate. Pure + deterministic —
 * identical (state, dt sequence) yields identical events.
 * @param {WeltRun} run mutated in place
 * @param {number} dt seconds
 * @returns {WeltEvent[]} events fired this step (scoring already applied)
 */
export function stepRun(run, dt) {
  /** @type {WeltEvent[]} */
  const events = [];
  if (run.finished || dt <= 0) return events;
  run.elapsed += dt;

  if (run.fotoPauseT > 0) {
    run.fotoPauseT = Math.max(0, run.fotoPauseT - dt);
  } else {
    run.s = Math.min(run.track.length, run.s + WELT.SPEED_M_S * dt);
  }

  // Ease toward the (corridor-clamped) target; clamp the eased value too so
  // a narrowing corridor pushes an already-wide offset back inside.
  const gAt = goobyArcPos(run);
  const halfW = run.track.corridorAt(gAt);
  const target = clampOffset(run.target, halfW);
  run.offset = clampOffset(
    { x: easeOffset(run.offset.x, target.x, dt), y: easeOffset(run.offset.y, target.y, dt) },
    halfW
  );

  const g = goobyWorldPos(run);

  // §G6.4 sphere pickups (r 0.9) — window the list by arc distance so the
  // scan stays O(few) per frame.
  const checkList = (list, done, radius, type, points) => {
    for (let i = 0; i < list.length; i += 1) {
      if (done[i]) continue;
      const p = list[i];
      if (Math.abs(p.s - gAt) > radius + 4) continue;
      const wp = pickupWorldPos(run.track, p);
      if (dist3(wp, g) <= radius) {
        done[i] = true;
        run.score += points;
        events.push({ type, index: i, points, pos: wp });
      }
    }
  };
  checkList(run.data.stars, run.starDone, WELT.PICKUP_RADIUS_M, 'star', WELT.STAR_POINTS);
  checkList(run.data.carrots, run.carrotDone, WELT.PICKUP_RADIUS_M, 'carrot', WELT.CARROT_POINTS);
  checkList(run.data.fotoSpots, run.fotoDone, WELT.FOTO_RADIUS_M, 'foto', WELT.FOTO_POINTS);
  for (const e of events) {
    if (e.type === 'star') run.stars += 1;
    else if (e.type === 'carrot') run.carrots += 1;
    else if (e.type === 'foto') {
      run.fotoSpots += 1;
      run.fotoPauseT = WELT.FOTO_PAUSE_SEC; // wonder moment: hold the float
    }
  }

  if (run.s >= run.track.length && !run.finished) {
    run.finished = true;
    run.score += WELT.FINISH_BONUS;
    events.push({ type: 'finish', index: -1, points: WELT.FINISH_BONUS });
  }
  return events;
}

/** §B3 meta payload for the framework onEnd (§G6.4 shape). */
export function runMeta(run) {
  return {
    stars: run.stars,
    carrots: run.carrots,
    fotoSpots: run.fotoSpots,
    sceneId: run.sceneId,
  };
}

// ---------------------------------------------------------------------------
// §G6.7 deterministic bot (CI + ?autoplay=1)
// ---------------------------------------------------------------------------

/**
 * Bot steering target: zero offset unless an uncollected pickup's
 * corridor-projected arc distance is < 2 m ahead of Gooby — then steer
 * toward its authored offset (clamped like player input). Deterministic:
 * pure function of the run state; nearest-ahead pickup wins.
 * @param {WeltRun} run
 * @returns {{x: number, y: number}}
 */
export function botTargetOffset(run) {
  const gAt = goobyArcPos(run);
  let best = null;
  let bestD = Infinity;
  const scan = (list, done) => {
    for (let i = 0; i < list.length; i += 1) {
      if (done[i]) continue;
      const d = list[i].s - gAt;
      if (d > -0.5 && d < WELT.BOT_LOOKAHEAD_M && d < bestD) {
        best = list[i];
        bestD = d;
      }
    }
  };
  scan(run.data.stars, run.starDone);
  scan(run.data.carrots, run.carrotDone);
  scan(run.data.fotoSpots, run.fotoDone);
  if (!best) return { x: 0, y: 0 };
  return clampOffset({ x: best.ox, y: best.oy }, run.track.corridorAt(gAt));
}

/**
 * Headless bot simulation (the CI half of §G6.7): steps a full run with a
 * seeded frame-time jitter (16.6 ms ± 6 ms) to prove the bot is robust to
 * frame pacing — collected counts must be identical for every seed.
 * @param {object} sceneData
 * @param {number} [seed] mulberry32 seed for the dt jitter
 * @returns {{score: number, stars: number, carrots: number,
 *   fotoSpots: number, durationSec: number, finished: boolean}}
 */
export function simulateBot(sceneData, seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) | 0;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
  const run = createRun(sceneData);
  let guard = 0;
  while (!run.finished && guard < 60000) {
    guard += 1;
    run.target = botTargetOffset(run);
    stepRun(run, 0.0106 + rng() * 0.012);
  }
  return {
    score: run.score,
    stars: run.stars,
    carrots: run.carrots,
    fotoSpots: run.fotoSpots,
    durationSec: run.elapsed,
    finished: run.finished,
  };
}

// ---------------------------------------------------------------------------
// G65 coordination: weltScenes.js path-metadata adapter (§G6.5 format
// contract — see src/welt/weltScenes.js `WeltPathMeta`). Gameplay authors
// pickups SPLINE-RELATIVE ({s, ox, oy} — reachability by construction);
// G65's shape contract wants resolved WORLD positions. This adapter is the
// bridge; test/goobyWelt.test.js runs G65's validateWeltPathMeta over it.
// ---------------------------------------------------------------------------

/**
 * Resolve an authored scene into G65's WeltPathMeta shape (world-space
 * pickup positions, per-segment corridor table, orientation, tint).
 * @param {object} sceneData goobyWelt.paths.js entry
 * @returns {object} weltScenes.js `WeltPathMeta`
 */
export function toWeltPathMeta(sceneData) {
  const track = buildTrack(sceneData);
  const world = (p) => pickupWorldPos(track, p);
  return {
    sceneId: sceneData.id,
    waypoints: sceneData.waypoints.map((w) => [...w]),
    corridorHalfWidths: [...sceneData.corridor],
    stars: sceneData.stars.map(world),
    carrots: sceneData.carrots.map(world),
    fotoSpots: sceneData.fotoSpots.map(world),
    orientation: [...sceneData.orientation],
    ambientTint: sceneData.ambient.sky[0],
  };
}

// ---------------------------------------------------------------------------
// §G6.5-3 authoring validation (tests + tooling import this)
// ---------------------------------------------------------------------------

/**
 * Validate one authored scene against the §G6.5-3 rules. Returns a list of
 * human-readable violations (empty == valid) so the test failure output
 * names the exact offending pickup.
 * @param {object} sceneData goobyWelt.paths.js entry
 * @returns {string[]}
 */
export function validateScene(sceneData) {
  const issues = [];
  const push = (msg) => issues.push(`[${sceneData.id}] ${msg}`);
  const wp = sceneData.waypoints.length;
  if (wp < WELT.WAYPOINTS_MIN || wp > WELT.WAYPOINTS_MAX) {
    push(`waypoints ${wp} outside ${WELT.WAYPOINTS_MIN}–${WELT.WAYPOINTS_MAX}`);
  }
  const track = buildTrack(sceneData);
  if (track.length < WELT.SPLINE_MIN_M || track.length > WELT.SPLINE_MAX_M) {
    push(`spline length ${track.length.toFixed(1)} m outside ${WELT.SPLINE_MIN_M}–${WELT.SPLINE_MAX_M}`);
  }
  if (sceneData.corridor.length !== track.segCount) {
    push(`corridor table ${sceneData.corridor.length} != ${track.segCount} segments`);
  }
  for (const c of sceneData.corridor) {
    if (c < WELT.MIN_CORRIDOR_M) push(`corridor half-width ${c} < ${WELT.MIN_CORRIDOR_M}`);
  }
  if (sceneData.stars.length !== WELT.STAR_COUNT) push(`stars ${sceneData.stars.length} != ${WELT.STAR_COUNT}`);
  if (sceneData.carrots.length !== WELT.CARROT_COUNT) push(`carrots ${sceneData.carrots.length} != ${WELT.CARROT_COUNT}`);
  if (sceneData.fotoSpots.length !== WELT.FOTO_COUNT) push(`fotoSpots ${sceneData.fotoSpots.length} != ${WELT.FOTO_COUNT}`);

  const inReach = (p, label, xTol = 0) => {
    if (p.s < 0 || p.s > track.length) push(`${label} s=${p.s} off the spline`);
    const halfW = track.corridorAt(p.s);
    if (Math.abs(p.ox) > Math.min(WELT.OFFSET_X_MAX, halfW) + xTol) {
      push(`${label} ox=${p.ox} outside corridor ±${Math.min(WELT.OFFSET_X_MAX, halfW).toFixed(2)} @ s=${p.s}`);
    }
    if (p.oy < WELT.OFFSET_Y_MIN || p.oy > WELT.OFFSET_Y_MAX) {
      push(`${label} oy=${p.oy} outside [${WELT.OFFSET_Y_MIN}, ${WELT.OFFSET_Y_MAX}]`);
    }
  };
  sceneData.stars.forEach((p, i) => {
    inReach(p, `star#${i}`);
    if (Math.abs(p.ox) > 2) push(`star#${i} lateral ${p.ox} > 2 m (§G6.4)`);
  });
  sceneData.carrots.forEach((p, i) => inReach(p, `carrot#${i}`));
  // Foto-spots are r=3 triggers — the CENTER may sit up to (r − 0.6) beyond
  // the corridor edge and still be comfortably enterable from inside it.
  sceneData.fotoSpots.forEach((p, i) => inReach(p, `foto#${i}`, WELT.FOTO_RADIUS_M - 0.6));

  const starPos = sceneData.stars.map((p) => pickupWorldPos(track, p));
  for (let i = 0; i < starPos.length; i += 1) {
    for (let j = i + 1; j < starPos.length; j += 1) {
      const d = dist3(starPos[i], starPos[j]);
      if (d < WELT.STAR_MIN_GAP_M) {
        push(`stars #${i}/#${j} only ${d.toFixed(2)} m apart (< ${WELT.STAR_MIN_GAP_M})`);
      }
    }
  }
  // Foto-spot spacing is measured ALONG the spline (arc metres): the §G6.5-3
  // intent is spreading the three wonder moments across the 110 s run
  // (25 m ≈ 15.6 s); paths may loop a compact courtyard where 25 m of
  // straight-line world distance cannot exist.
  const fotos = sceneData.fotoSpots;
  for (let i = 0; i < fotos.length; i += 1) {
    for (let j = i + 1; j < fotos.length; j += 1) {
      const d = Math.abs(fotos[i].s - fotos[j].s);
      if (d < WELT.FOTO_MIN_GAP_M) {
        push(`fotoSpots #${i}/#${j} only ${d.toFixed(1)} m apart on the spline (< ${WELT.FOTO_MIN_GAP_M})`);
      }
    }
  }
  const dur = track.length / WELT.SPEED_M_S;
  if (Math.abs(dur - WELT.DURATION_SEC) > WELT.DURATION_TOL_SEC) {
    push(`traversal ${dur.toFixed(1)} s outside ${WELT.DURATION_SEC} ± ${WELT.DURATION_TOL_SEC}`);
  }
  return issues;
}
