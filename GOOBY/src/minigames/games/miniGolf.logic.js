// Mini Golf — pure putt physics + course rules (PLAN2 §C1.2 #6, agent
// V2/G28). No three.js/DOM imports so `node --test` runs this headlessly
// (§B rule); the game module (miniGolf.js) renders what these rules decide.
// Binding §C1.2 #6 numbers: 6 seeded holes from minigolf-kit tiles (straight/
// corner/ramp/bump/windmill gate/tunnel, par 2–3), drag-back aim with capped
// power + dotted preview, friction 0.985/frame, wall banks, rhythmic windmill
// blocking, per-hole scoring 30/20/12/6 (hole-in-one/≤par/par+1/else),
// 10-stroke auto-advance. Coin row (§C1.1): divisor 5, min 4, max 28,
// energy 8 — typical raw ≈ 80 → ~16c.

/** Binding §C1.2 #6 numbers + V2/G28 tuning (all lengths in cell units = m). */
export const GOLF = Object.freeze({
  /** Holes per round (§C1.2 #6). */
  HOLE_COUNT: 6,
  /** Course cell size (world units — tiles scale to this). */
  CELL_M: 1,
  /** Ball radius / rail inset (m). */
  BALL_R: 0.08,
  RAIL: 0.055,
  /** §C1.2 #6: rolling friction multiplier per 60 fps frame. */
  FRICTION_PER_FRAME: 0.985,
  /** Rolling-resistance tail (m/s²) so the exponential crawl settles fast. */
  ROLL_DECEL: 0.22,
  /** The ball counts as stopped below this speed (§C1.5: < 0.01 m/s). */
  STOP_SPEED: 0.01,
  /** Putt power cap (m/s — §C1.2 #6 "power = drag length, capped"). */
  MAX_POWER: 6.5,
  /** Full-power drag length (px) — the in-game drag→power scale. */
  MAX_DRAG_PX: 150,
  /** Cup capture: within HOLE_R and slower than CAPTURE_SPEED (else it skips). */
  HOLE_R: 0.13,
  CAPTURE_SPEED: 2.8,
  /** §C1.2 #6: 10-stroke cap per hole auto-advances. */
  MAX_STROKES: 10,
  /** Wall bank restitution (§C1.2 #6 "banks off walls"). */
  WALL_RESTITUTION: 0.82,
  /** Bump dome obstacle (radius m + bounce restitution). */
  BUMP_R: 0.19,
  BUMP_RESTITUTION: 0.95,
  /** Windmill gate: rotations/s + fraction of each blade period blocked. */
  WINDMILL_RPS: 0.12,
  WINDMILL_BLOCK_FRAC: 0.45,
  /** Ramp: uphill deceleration (m/s²) + plateau height (m, ramp-low GLB). */
  RAMP_ACCEL: 2.6,
  RAMP_H: 0.1,
  /** §C1.2 #6 per-hole scoring: hole-in-one / ≤ par / par+1 / else. */
  SCORE_ACE: 30,
  SCORE_PAR: 20,
  SCORE_BOGEY: 12,
  SCORE_OTHER: 6,
});

/**
 * Per-hole score (§C1.2 #6): hole-in-one +30, ≤ par +20, par+1 +12, else +6.
 * The 10-stroke auto-advance lands in the `else` consolation (+6).
 * @param {number} strokes strokes taken on the hole (≥ 1)
 * @param {number} par the hole's par (2–3)
 * @returns {number}
 */
export function holeScore(strokes, par) {
  if (strokes === 1) return GOLF.SCORE_ACE;
  if (strokes <= par) return GOLF.SCORE_PAR;
  if (strokes === par + 1) return GOLF.SCORE_BOGEY;
  return GOLF.SCORE_OTHER;
}

/**
 * Friction multiplier over dt seconds (§C1.2 #6: ×0.985 per 60 fps frame).
 * @param {number} dt seconds
 * @returns {number}
 */
export function frictionFactor(dt) {
  return Math.pow(GOLF.FRICTION_PER_FRAME, dt * 60);
}

/**
 * One friction step: exponential per-frame decay + rolling-resistance tail,
 * floored at 0 (the crawl below STOP_SPEED counts as stopped).
 * @param {number} speed m/s
 * @param {number} dt seconds
 * @returns {number} new speed ≥ 0
 */
export function rollSpeed(speed, dt) {
  return Math.max(0, speed * frictionFactor(dt) - GOLF.ROLL_DECEL * dt);
}

/**
 * Straight-line roll distance from an initial speed (60 fps integration —
 * the bot's power table derives from this).
 * @param {number} v0 initial speed m/s
 * @returns {number} meters until the ball stops
 */
export function rollDistance(v0) {
  let v = v0;
  let d = 0;
  const h = 1 / 60;
  while (v > GOLF.STOP_SPEED && d < 100) {
    d += v * h;
    v = rollSpeed(v, h);
  }
  return d;
}

/**
 * Seconds a roll started at v0 needs to cover `dist` meters (Infinity when
 * it stops short) — the bot times windmill-gate putts with this.
 * @param {number} v0 @param {number} dist
 * @returns {number}
 */
export function rollTimeToDistance(v0, dist) {
  let v = v0;
  let d = 0;
  let t = 0;
  const h = 1 / 60;
  while (v > GOLF.STOP_SPEED && t < 30) {
    d += v * h;
    t += h;
    if (d >= dist) return t;
    v = rollSpeed(v, h);
  }
  return Infinity;
}

/**
 * Initial speed whose roll travels `dist` meters (binary search over
 * rollDistance) — the autoplay bot's per-target power pick.
 * @param {number} dist meters
 * @returns {number} m/s, capped at MAX_POWER
 */
export function powerForDistance(dist) {
  let lo = 0.15;
  let hi = GOLF.MAX_POWER;
  if (rollDistance(hi) < dist) return hi;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid) < dist) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Clamp a drag length (px) to putt power (§C1.2 #6: capped).
 * @param {number} dragPx
 * @returns {number} m/s 0..MAX_POWER
 */
export function powerFromDrag(dragPx) {
  return Math.min(GOLF.MAX_POWER, Math.max(0, dragPx) * (GOLF.MAX_POWER / GOLF.MAX_DRAG_PX));
}

/**
 * Axis-aligned wall bank (§C1.5): reflect the velocity component along the
 * wall normal with WALL_RESTITUTION, keep the tangential component.
 * @param {{vx: number, vz: number}} v
 * @param {number} nx unit wall normal x
 * @param {number} nz unit wall normal z
 * @returns {{vx: number, vz: number}}
 */
export function reflect(v, nx, nz) {
  const dot = v.vx * nx + v.vz * nz;
  return {
    vx: v.vx - (1 + GOLF.WALL_RESTITUTION) * dot * nx,
    vz: v.vz - (1 + GOLF.WALL_RESTITUTION) * dot * nz,
  };
}

/**
 * Rhythmic windmill gate (§C1.2 #6): 4 blades — one sweeps the gate every
 * quarter turn; the gate is blocked WINDMILL_BLOCK_FRAC of each period,
 * centered on the blade-across-the-slot pose.
 * @param {number} theta blade rotation (rad, game passes elapsed·2π·RPS+phase)
 * @returns {boolean}
 */
export function windmillBlocked(theta) {
  const period = Math.PI / 2;
  const phase = ((theta % period) + period) % period;
  const d = Math.min(phase, period - phase);
  return d < (period * GOLF.WINDMILL_BLOCK_FRAC) / 2;
}

/**
 * Cup capture check (§C1.2 #6): close enough and slow enough — fast balls
 * skip over the hole.
 * @param {number} dist ball-center → cup-center (m)
 * @param {number} speed m/s
 * @returns {boolean}
 */
export function isCaptured(dist, speed) {
  return dist < GOLF.HOLE_R && speed < GOLF.CAPTURE_SPEED;
}

// ---------------------------------------------------------------------------
// Course generation (§C1.2 #6: 6 seeded holes, one archetype each)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GolfHole
 * @property {string} id      archetype ('straight'|'corner'|'ramp'|'bump'|'windmill'|'tunnel')
 * @property {number} par     2–3 (§C1.2 #6)
 * @property {Array<[number, number]>} cells path cells in play order [x, z]
 * @property {Set<string>} cellSet 'x,z' membership for wall checks
 * @property {{x: number, z: number}} start tee position (cell 0 center)
 * @property {{x: number, z: number}} hole  cup position (last cell center)
 * @property {Array<{x: number, z: number}>} waypoints bot aim points before the cup
 * @property {number} botPowerMul per-hole bot power table multiplier
 * @property {{cell: [number, number], dir: [number, number], h: number}} [ramp]
 * @property {{x: number, z: number}} [bump]
 * @property {{cellX: number, gateZ: number, phase: number}} [windmill]
 * @property {{cell: [number, number]}} [tunnel]
 */

/** @param {Array<[number, number]>} cells @returns {Set<string>} */
function cellSetOf(cells) {
  return new Set(cells.map(([x, z]) => `${x},${z}`));
}

/**
 * The 6-hole seeded course (§C1.2 #6) — archetype order is fixed (hole 1 is
 * the straight, the scripted hole-in-one target); the seed varies the corner
 * direction, bump offset and windmill blade phase.
 * @param {() => number} rng seeded 0..1 stream (§E8 ctx.rng)
 * @returns {GolfHole[]}
 */
export function generateCourse(rng) {
  /** @type {GolfHole[]} */
  const holes = [];
  const mk = (hole) => {
    hole.cellSet = cellSetOf(hole.cells);
    hole.start = { x: hole.cells[0][0], z: hole.cells[0][1] };
    const last = hole.cells[hole.cells.length - 1];
    hole.hole = { x: last[0], z: last[1] };
    hole.waypoints = hole.waypoints ?? [];
    hole.botPowerMul = hole.botPowerMul ?? 1;
    holes.push(hole);
  };

  // #1 straight (par 2) — the hole-in-one hole
  mk({ id: 'straight', par: 2, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] });

  // #2 corner (par 2) — seeded left/right dogleg
  const dirX = rng() < 0.5 ? 1 : -1;
  mk({
    id: 'corner',
    par: 2,
    cells: [[0, 0], [0, 1], [0, 2], [dirX, 2], [dirX * 2, 2]],
    waypoints: [{ x: 0, z: 2 }],
  });

  // #3 ramp (par 3) — uphill cell, plateau to the cup
  mk({
    id: 'ramp',
    par: 3,
    cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    ramp: { cell: [0, 2], dir: [0, 1], h: GOLF.RAMP_H },
    botPowerMul: 1.45,
  });

  // #4 bump (par 2) — the dome cell position is seeded (matches its tile);
  // the bot squeezes past it via the baked side-gap waypoint (§C1.2 #6)
  const bumpZ = rng() < 0.5 ? 2 : 3;
  mk({
    id: 'bump',
    par: 2,
    cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    bump: { x: 0, z: bumpZ },
    waypoints: [{ x: rng() < 0.5 ? 0.3 : -0.3, z: bumpZ }],
  });

  // #5 windmill gate (par 3) — seeded blade phase
  mk({
    id: 'windmill',
    par: 3,
    cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    windmill: { cellX: 0, gateZ: 2, phase: rng() * Math.PI * 2 },
  });

  // #6 tunnel (par 3) — long lane, tunnel roof mid-way
  mk({
    id: 'tunnel',
    par: 3,
    cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]],
    tunnel: { cell: [0, 3] },
  });

  return holes;
}

/**
 * Cell render roles for the game's tile placement: role + in/out travel
 * directions (unit cell steps) per path cell.
 * @param {GolfHole} hole
 * @returns {Array<{x: number, z: number, role: string,
 *   inDir: [number, number]|null, outDir: [number, number]|null}>}
 */
export function cellRoles(hole) {
  return hole.cells.map(([x, z], i) => {
    const prev = hole.cells[i - 1];
    const next = hole.cells[i + 1];
    const inDir = prev ? [x - prev[0], z - prev[1]] : null;
    const outDir = next ? [next[0] - x, next[1] - z] : null;
    let role = 'straight';
    if (i === 0) role = 'start';
    else if (!next) role = 'hole';
    else if (hole.ramp && hole.ramp.cell[0] === x && hole.ramp.cell[1] === z) role = 'ramp';
    else if (hole.windmill && hole.windmill.cellX === x && hole.windmill.gateZ === z) role = 'windmill';
    else if (hole.tunnel && hole.tunnel.cell[0] === x && hole.tunnel.cell[1] === z) role = 'tunnel';
    else if (hole.bump && Math.round(hole.bump.x) === x && Math.round(hole.bump.z) === z) role = 'bump';
    else if (inDir && outDir && (inDir[0] !== outDir[0] || inDir[1] !== outDir[1])) role = 'corner';
    return { x, z, role, inDir, outDir };
  });
}

/**
 * Ground height at a point (ramp holes raise the plateau past the ramp cell).
 * @param {GolfHole} hole @param {number} x @param {number} z
 * @returns {number}
 */
export function heightAt(hole, x, z) {
  if (!hole.ramp) return 0;
  const [rx, rz] = hole.ramp.cell;
  const [dx, dz] = hole.ramp.dir;
  // signed progress along the ramp direction, ramp cell spans −0.5..+0.5
  const p = (x - rx) * dx + (z - rz) * dz;
  if (p <= -0.5) return 0;
  if (p >= 0.5) return hole.ramp.h;
  return hole.ramp.h * (p + 0.5);
}

/** @param {GolfHole} hole @param {number} x @param {number} z @returns {boolean} */
export function onRamp(hole, x, z) {
  return !!hole.ramp && Math.round(x) === hole.ramp.cell[0] && Math.round(z) === hole.ramp.cell[1];
}

/**
 * May the ball center rest at (x, z)? Cell membership + rail inset on every
 * closed edge (open edges pass into the neighbor cell).
 * @param {GolfHole} hole @param {number} x @param {number} z
 * @returns {boolean}
 */
export function canBeAt(hole, x, z) {
  const cx = Math.round(x);
  const cz = Math.round(z);
  if (!hole.cellSet.has(`${cx},${cz}`)) return false;
  const lim = 0.5 - GOLF.RAIL - GOLF.BALL_R;
  const lx = x - cx;
  const lz = z - cz;
  if (lx > lim && !hole.cellSet.has(`${cx + 1},${cz}`)) return false;
  if (lx < -lim && !hole.cellSet.has(`${cx - 1},${cz}`)) return false;
  if (lz > lim && !hole.cellSet.has(`${cx},${cz + 1}`)) return false;
  if (lz < -lim && !hole.cellSet.has(`${cx},${cz - 1}`)) return false;
  return true;
}

/**
 * Is the ball at rest (stroke finished)? On the ramp the downhill pull keeps
 * it live until it settles on flat ground.
 * @param {GolfHole} hole
 * @param {{x: number, z: number, vx: number, vz: number}} ball
 * @returns {boolean}
 */
export function isStopped(hole, ball) {
  return Math.hypot(ball.vx, ball.vz) < GOLF.STOP_SPEED && !onRamp(hole, ball.x, ball.z);
}

/**
 * Advance the ball one frame: ramp gravity → friction → sub-stepped movement
 * with axis banks, windmill gate, bump dome and cup capture. Mutates `ball`
 * ({x, z, vx, vz, done}); returns the collision/score events of the frame.
 * @param {GolfHole} hole
 * @param {{x: number, z: number, vx: number, vz: number, done?: boolean}} ball
 * @param {number} dt seconds
 * @param {number} theta windmill rotation (rad) at frame start
 * @returns {string[]} any of 'bank'|'windmill'|'bump'|'holed'
 */
export function stepBall(hole, ball, dt, theta) {
  /** @type {string[]} */
  const events = [];
  if (ball.done) return events;

  // ramp gravity (downhill = −dir)
  if (onRamp(hole, ball.x, ball.z)) {
    ball.vx -= hole.ramp.dir[0] * GOLF.RAMP_ACCEL * dt;
    ball.vz -= hole.ramp.dir[1] * GOLF.RAMP_ACCEL * dt;
  }

  // friction (§C1.2 #6: 0.985/frame)
  const speed = Math.hypot(ball.vx, ball.vz);
  if (speed > 0) {
    const ns = rollSpeed(speed, dt);
    ball.vx *= ns / speed;
    ball.vz *= ns / speed;
  }
  if (isStopped(hole, ball)) {
    ball.vx = 0;
    ball.vz = 0;
    return events;
  }

  // sub-stepped movement (≤ 0.04 m per step — no wall tunneling)
  const moveSpeed = Math.hypot(ball.vx, ball.vz);
  const steps = Math.max(1, Math.ceil((moveSpeed * dt) / 0.04));
  const h = dt / steps;
  for (let s = 0; s < steps; s += 1) {
    // x axis
    if (ball.vx !== 0) {
      const nx = ball.x + ball.vx * h;
      if (canBeAt(hole, nx, ball.z)) {
        ball.x = nx;
      } else {
        const r = reflect({ vx: ball.vx, vz: ball.vz }, -Math.sign(ball.vx), 0);
        ball.vx = r.vx;
        ball.vz = r.vz;
        events.push('bank');
      }
    }
    // z axis (windmill gate crossing first — §C1.2 #6 rhythmic blocking)
    if (ball.vz !== 0) {
      const nz = ball.z + ball.vz * h;
      const mill = hole.windmill;
      const crossesGate =
        mill &&
        Math.round(ball.x) === mill.cellX &&
        (ball.z - mill.gateZ) * (nz - mill.gateZ) <= 0;
      if (crossesGate && windmillBlocked(theta + mill.phase)) {
        const r = reflect({ vx: ball.vx, vz: ball.vz }, 0, -Math.sign(ball.vz));
        ball.vx = r.vx;
        ball.vz = r.vz;
        events.push('windmill');
      } else if (canBeAt(hole, ball.x, nz)) {
        ball.z = nz;
      } else {
        const r = reflect({ vx: ball.vx, vz: ball.vz }, 0, -Math.sign(ball.vz));
        ball.vx = r.vx;
        ball.vz = r.vz;
        events.push('bank');
      }
    }
    // bump dome (radial bounce)
    if (hole.bump) {
      const dx = ball.x - hole.bump.x;
      const dz = ball.z - hole.bump.z;
      const d = Math.hypot(dx, dz);
      const minD = GOLF.BUMP_R + GOLF.BALL_R;
      if (d < minD && d > 1e-6) {
        const ux = dx / d;
        const uz = dz / d;
        ball.x = hole.bump.x + ux * minD;
        ball.z = hole.bump.z + uz * minD;
        const vdot = ball.vx * ux + ball.vz * uz;
        if (vdot < 0) {
          ball.vx -= (1 + GOLF.BUMP_RESTITUTION) * vdot * ux;
          ball.vz -= (1 + GOLF.BUMP_RESTITUTION) * vdot * uz;
          events.push('bump');
        }
      }
    }
    // cup capture (§C1.2 #6: fast balls skip over)
    const dHole = Math.hypot(ball.x - hole.hole.x, ball.z - hole.hole.z);
    if (isCaptured(dHole, Math.hypot(ball.vx, ball.vz))) {
      ball.done = true;
      ball.vx = 0;
      ball.vz = 0;
      ball.x = hole.hole.x;
      ball.z = hole.hole.z;
      events.push('holed');
      break;
    }
  }
  return events;
}
