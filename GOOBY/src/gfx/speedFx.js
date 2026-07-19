// Speed-feel juice helpers — V4/G67 (PLAN4-GAMES §G4, PLAN4 §E G67).
// Shared by the runner-class games: shoppingSurf (full §G4.1–4.7 dose) and
// the §G4.8 reduced-dose rollout (runner / toyRacer / starHopper).
//
// Two halves:
//   1. PURE MATH (no three.js state) — fov kick, streak spawn rates,
//      top-speed shake fade, wind-loop gain, milestone crossings. These are
//      unit-tested headlessly in test/speedFx.test.js.
//   2. RUNTIME FACTORIES — createSpeedLines (pooled streak billboards as
//      instanced meshes: the whole pool costs ≤ 2 draw calls — one per
//      streak texture) and createGhostTrail (3 trailing ghost sprites for a
//      cheap motion-blur read on Gooby at high speed).
//
// The 2 streak textures are G50's committed Brackeys VFX picks (§G4.2):
// public/assets/vfx/streak_a.png + streak_b.png (CC0, white-on-alpha),
// tinted #FFF6EC at 0.55 opacity with additive blending.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Tuning tables (§G4 numbers — binding where the spec names them)
// ---------------------------------------------------------------------------

/** shoppingSurf — the full §G4.1–4.7 dose (every number from the spec). */
export const SURF_FX = Object.freeze({
  FOV_KICK: 10, //             §G4.1: 62 → 72 over the ramp
  BAND: Object.freeze([8, 16]), // §G4.1 speed band (m/s)
  TURBO_ADD: 8, //             §G4.1: turbo kick is ADDITIVE on top
  FOV_CAP: 78, //              §G4.1 hard cap
  LERP_K: 5, //                §G4.1 lerp rate (1/s)
  STREAK_POOL: 24, //          §G4.2 pool of 24 billboards
  STREAK_RADIUS: Object.freeze([3.2, 4.2]), // §G4.2 ring radius (m)
  STREAK_AHEAD: Object.freeze([4, 9]), //     §G4.2 spawn 4–9 m ahead
  STREAK_SIZE: Object.freeze([0.06, 1.4]), // §G4.2 0.06×1.4 m
  STREAK_LIFE: 0.35, //        §G4.2 life (s)
  STREAK_VEL: 1.6, //          §G4.2 velocity = 1.6× run speed
  STREAK_ORIGIN_Y: 1.8, //     ring centre height ≈ camera axis
  RATE: Object.freeze([[10, 0], [12, 6], [16, 14]]), // §G4.2 /s segments
  SHAKE_FROM: 15, //           §G4.3: fades in over 15 → 16 m/s
  SHAKE_TO: 16,
  SHAKE_AMP: 0.035, //         §G4.3 amplitude (m)
  GROUND_SCROLL_DIV: 4, //     §G4.4: map.offset.y −= speed·dt / 4
  WIND: Object.freeze([10, 16, 0.5]), // §G4.5: 10→16 m/s ⇒ gain 0→0.5
  WIND_UPDATE_SEC: 0.25, //    §G4.5 update cadence
  SLOWMO_SCALE: 0.55, //       §G4.6 timescale
  SLOWMO_SEC: 0.18, //         §G4.6 REAL-time duration
  FLASH_SEC: 0.12, //          §G4.6 vignette flash
  MILESTONES: Object.freeze([10, 12, 14, 16]), // §G4.7 first crossings
  DIST_EVERY_M: 250, //        §G4.7 arcade distance banners
  GHOST_BAND: Object.freeze([13, 16]), // ghost trail fades in ≥ 13 m/s
});

/** runner — §G4.8 row: FOV 60 → +8, streak pool 16, shake 0.03, ramp-third banners. */
export const RUNNER_FX = Object.freeze({
  FOV_BASE: 60, //             §G4.8 "FOV 60"
  FOV_KICK: 8, //              §G4.8 "+8 over its speed band"
  BAND: Object.freeze([6, 13]), // RUNNER.BASE_SPEED → MAX_SPEED
  STREAK_POOL: 16, //          §G4.8 "streak pool 16"
  STREAK_RADIUS: Object.freeze([2.6, 3.6]),
  STREAK_AHEAD: Object.freeze([4, 9]),
  STREAK_ORIGIN_Y: 2.0,
  RATE: Object.freeze([[9, 0], [11, 4], [13, 9]]), // lighter than surf
  SHAKE_FROM: 12.4, //         §G4.8 "shake at top speed 0.03"
  SHAKE_TO: 13,
  SHAKE_AMP: 0.03,
  MILESTONES: Object.freeze([8.33, 10.67, 13]), // §G4.8 ramp thirds of 6→13
});

/** toyRacer — §G4.8 row: +6 FOV during drift-boost only, 10/s streaks, no shake. */
export const RACER_FX = Object.freeze({
  FOV_BASE: 58, //             toyRacer's existing base
  FOV_KICK: 6, //              §G4.8 "+6 during drift-boost only"
  BOOST_RATE: 10, //           §G4.8 "rate 10/s for the boost duration"
  STREAK_POOL: 12,
  STREAK_RADIUS: Object.freeze([1.7, 2.4]), // camera-local ring
  STREAK_AHEAD: Object.freeze([3, 7]),
  STREAK_SIZE: Object.freeze([0.05, 1.2]),
});

/** starHopper — lightest dose (not in the §G4.8 table; no shake, no banners). */
export const HOPPER_FX = Object.freeze({
  FOV_KICK: 6, //              matches the other reduced-dose rows
  BAND: Object.freeze([11, 19]), // HOPPER.BASE_SPEED → MAX_SPEED
  STREAK_POOL: 12,
  STREAK_SIZE: Object.freeze([0.05, 1.3]), // world units (planar mode)
  STREAK_LIFE: 0.35,
  STREAK_VEL: 4, //            planar wu/s multiplier on speed·WU_PER_M
  RATE: Object.freeze([[12, 0], [14, 4], [19, 10]]), // ramp caps ~15.5 in a 75 s run
});

// ---------------------------------------------------------------------------
// Pure math (unit-tested)
// ---------------------------------------------------------------------------

/**
 * §G4.1 speed-scaled FOV target: `base + kick · clamp((speed − lo)/(hi − lo))`.
 * @param {number} base @param {number} kick @param {number} speed
 * @param {number} lo @param {number} hi @returns {number} degrees
 */
export function speedFovTarget(base, kick, speed, lo, hi) {
  const t = Math.min(1, Math.max(0, (speed - lo) / Math.max(1e-6, hi - lo)));
  return base + kick * t;
}

/**
 * §G4.1 FOV easing step at k = 5/s (frame-rate independent enough for the
 * juice read; matches the game's existing `dt * 5` pattern).
 * @param {number} current @param {number} target @param {number} dt
 * @param {number} [k] @returns {number}
 */
export function fovLerp(current, target, dt, k = 5) {
  return current + (target - current) * Math.min(1, dt * k);
}

/**
 * §G4.2 piecewise-linear spawn rate over [[speed, ratePerSec], …] segments
 * (sorted by speed). Below the first point → first rate; above the last →
 * last rate (surf: 0/s below 10 → 6/s at 12 → 14/s at 16).
 * @param {number} speed @param {ReadonlyArray<ReadonlyArray<number>>} points
 * @returns {number} spawns per second
 */
export function streakRate(speed, points) {
  if (!points || points.length === 0) return 0;
  if (speed <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [s1, r1] = points[i - 1];
    const [s2, r2] = points[i];
    if (speed <= s2) return r1 + ((speed - s1) / Math.max(1e-6, s2 - s1)) * (r2 - r1);
  }
  return points[points.length - 1][1];
}

/**
 * §G4.3 top-speed micro-jitter amplitude, fading in over the [from, to]
 * band so it never pops (surf: 0 at 15 m/s → 0.035 at 16 m/s).
 * @param {number} speed @param {number} from @param {number} to
 * @param {number} amp @returns {number} metres
 */
export function topSpeedShake(speed, from, to, amp) {
  const t = Math.min(1, Math.max(0, (speed - from) / Math.max(1e-6, to - from)));
  return amp * t;
}

/**
 * §G4.5 wind-loop gain: speed lo→hi maps to 0→max (surf: 10→16 ⇒ 0→0.5).
 * @param {number} speed @param {number} [lo] @param {number} [hi]
 * @param {number} [max] @returns {number} 0..max
 */
export function windGain(speed, lo = 10, hi = 16, max = 0.5) {
  const t = Math.min(1, Math.max(0, (speed - lo) / Math.max(1e-6, hi - lo)));
  return max * t;
}

/**
 * §G4.7 milestone detection: thresholds crossed this frame (prev < t ≤ next)
 * that have NOT been seen yet — first-crossing only, so the §C8.3 crash
 * speed-reset never re-banners. The caller adds returned values to `seen`.
 * @param {number} prev previous frame speed
 * @param {number} next current speed
 * @param {ReadonlyArray<number>} thresholds ascending
 * @param {Set<number>} seen already-bannered thresholds
 * @returns {number[]}
 */
export function crossedMilestones(prev, next, thresholds, seen) {
  const crossed = [];
  for (const t of thresholds) {
    if (prev < t && next >= t && !seen.has(t)) crossed.push(t);
  }
  return crossed;
}

/**
 * Ghost-trail strength: 0 below lo, 1 at hi (surf: fades in 13 → 16 m/s).
 * @param {number} speed @param {number} [lo] @param {number} [hi]
 * @returns {number} 0..1
 */
export function ghostStrength(speed, lo = 13, hi = 16) {
  return Math.min(1, Math.max(0, (speed - lo) / Math.max(1e-6, hi - lo)));
}

// ---------------------------------------------------------------------------
// Streak textures (G50's committed Brackeys picks — shared app-wide)
// ---------------------------------------------------------------------------

/** @type {THREE.Texture[]|null} */
let streakTextures = null;

/** Lazy-load + cache the 2 streak textures (§G4.2). Never disposed. */
export function getStreakTextures() {
  if (!streakTextures) {
    const base = import.meta.env?.BASE_URL ?? '/';
    const loader = new THREE.TextureLoader();
    streakTextures = ['streak_a.png', 'streak_b.png'].map((file) => {
      const tex = loader.load(`${base}assets/vfx/${file}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    });
  }
  return streakTextures;
}

// ---------------------------------------------------------------------------
// createSpeedLines — pooled streak billboards, ≤ 2 draw calls via instancing
// ---------------------------------------------------------------------------

const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Pooled speed-line system (§G4.2). One InstancedMesh per streak texture
 * (2 total) — the whole pool renders in ≤ 2 draw calls regardless of size.
 *
 * Corridor mode (default): streaks spawn in a ring of `radius` around
 * (originX, originY), `ahead` metres down ±z (`forwardZ`), lie along z and
 * fly toward the camera at `velocityScale × speed`. Planar mode
 * (starHopper): streaks spawn along the left/right screen edges inside
 * `bounds` and fly down −y.
 *
 * @param {THREE.Object3D} parent scene (or camera for a camera-local ring)
 * @param {object} [opts]
 * @returns {{
 *   group: THREE.Group,
 *   update: (dt: number, state: {speed?: number, rate?: number, originX?: number, originY?: number}) => void,
 *   activeCount: () => number,
 *   drawCalls: () => number,
 *   dispose: () => void,
 * }}
 */
export function createSpeedLines(parent, opts = {}) {
  const {
    textures = getStreakTextures(),
    pool = 24,
    color = 0xfff6ec, //   §G4.2 tint
    opacity = 0.55, //     §G4.2 opacity
    radius = SURF_FX.STREAK_RADIUS,
    ahead = SURF_FX.STREAK_AHEAD,
    size = SURF_FX.STREAK_SIZE,
    life = SURF_FX.STREAK_LIFE,
    velocityScale = SURF_FX.STREAK_VEL,
    forwardZ = 1, //       +1: ahead = +z (surf) · −1: ahead = −z (runner/racer)
    planar = false, //     starHopper edge-streak mode (motion −y)
    bounds = null, //      planar: {halfW, top, z?}
    rng = Math.random,
  } = opts;

  const group = new THREE.Group();
  group.name = 'speedLines';
  parent.add(group);

  /** @type {Array<{geo: THREE.BufferGeometry, mat: THREE.Material, mesh: THREE.InstancedMesh}>} */
  const owned = [];
  /** @type {Array<{mesh: THREE.InstancedMesh, idx: number, active: boolean, age: number, x: number, y: number, z: number, angle: number}>} */
  const slots = [];
  const perMesh = Math.max(1, Math.ceil(pool / Math.max(1, textures.length)));
  for (const tex of textures) {
    if (slots.length >= pool) break;
    const geo = new THREE.PlaneGeometry(1, 1);
    if (!planar) geo.rotateX(-Math.PI / 2); // long axis along z (motion)
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const capacity = Math.min(perMesh, pool - slots.length);
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // instances stream past the frustum edges
    for (let i = 0; i < capacity; i += 1) {
      mesh.setMatrixAt(i, ZERO_SCALE);
      slots.push({ mesh, idx: i, active: false, age: 0, x: 0, y: 0, z: 0, angle: 0 });
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    owned.push({ geo, mat, mesh });
  }

  let debt = 0; //    fractional spawns carried between frames
  let active = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  function spawn(originX, originY) {
    const slot = slots.find((s) => !s.active);
    if (!slot) return; // §G4.2: pool exhaustion drops spawns silently
    slot.active = true;
    slot.age = 0;
    if (planar) {
      const side = rng() < 0.5 ? -1 : 1;
      slot.x = side * (bounds.halfW * (0.55 + rng() * 0.4));
      slot.y = (rng() * 2 - 1) * bounds.top; // anywhere along the edge
      slot.z = bounds.z ?? -1;
      slot.angle = 0;
    } else {
      const a = rng() * Math.PI * 2;
      const r = radius[0] + rng() * (radius[1] - radius[0]);
      slot.x = originX + Math.cos(a) * r;
      slot.y = originY + Math.sin(a) * r;
      slot.z = (ahead[0] + rng() * (ahead[1] - ahead[0])) * forwardZ;
      slot.angle = a + Math.PI / 2; // face the ring axis
    }
    active += 1;
  }

  function update(dt, state = {}) {
    const { speed = 0, rate = 0, originX = 0, originY = SURF_FX.STREAK_ORIGIN_Y } = state;
    debt += rate * dt;
    while (debt >= 1) {
      debt -= 1;
      spawn(originX, originY);
    }
    if (active === 0 && debt < 1) {
      debt = Math.min(debt, 1);
      return;
    }
    const step = velocityScale * speed * dt;
    const dirty = new Set();
    for (const slot of slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= life) {
        slot.active = false;
        active -= 1;
        slot.mesh.setMatrixAt(slot.idx, ZERO_SCALE);
        dirty.add(slot.mesh);
        continue;
      }
      if (planar) slot.y -= step;
      else slot.z -= step * forwardZ; // fly back past the camera
      const t = slot.age / life;
      const fade = Math.sin(Math.PI * Math.min(1, t)); // thin in, thin out
      v.set(slot.x, slot.y, slot.z);
      if (planar) {
        q.identity();
        sc.set(size[0] * (0.4 + 0.6 * fade), size[1], 1);
      } else {
        q.setFromAxisAngle(Z_AXIS, slot.angle);
        sc.set(size[0] * (0.4 + 0.6 * fade), 1, size[1]);
      }
      m4.compose(v, q, sc);
      slot.mesh.setMatrixAt(slot.idx, m4);
      dirty.add(slot.mesh);
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    update,
    activeCount: () => active,
    drawCalls: () => owned.length, // ≤ 2 — one per streak texture
    dispose() {
      for (const o of owned) {
        o.geo.dispose();
        o.mat.dispose(); // textures are shared app-wide — keep them
      }
      group.parent?.remove(group);
      slots.length = 0;
      active = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// createGhostTrail — cheap motion-blur read: trailing ghost sprites
// ---------------------------------------------------------------------------

/** @type {THREE.CanvasTexture|null} soft-blob texture, shared app-wide */
let ghostTexture = null;

function getGhostTexture() {
  if (!ghostTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(32, 34, 4, 32, 34, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(255,240,246,0.5)');
    grad.addColorStop(1, 'rgba(255,240,246,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    ghostTexture = new THREE.CanvasTexture(canvas);
  }
  return ghostTexture;
}

/**
 * Trailing ghost sprites — a subtle motion-blur read on the player at high
 * speed. Each ghost lerps toward the anchor at its own rate (staggered
 * catch-up = a smeared trail on lane changes/jumps) and sits progressively
 * further back along −z; opacity scales with `strength` (0 hides them).
 *
 * @param {THREE.Object3D} parent
 * @param {object} [opts]
 * @returns {{update: (dt: number, state: {x: number, y: number, strength: number}) => void, dispose: () => void}}
 */
export function createGhostTrail(parent, opts = {}) {
  const {
    count = 3,
    maxOpacity = [0.16, 0.11, 0.07],
    lerpK = [20, 12, 7],
    zStep = -0.42, //   ghosts trail BEHIND the runner (toward the camera)
    scale = [0.8, 1.05],
  } = opts;
  const group = new THREE.Group();
  group.name = 'ghostTrail';
  parent.add(group);
  const ghosts = [];
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.SpriteMaterial({
      map: getGhostTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale[0], scale[1], 1);
    sprite.visible = false;
    group.add(sprite);
    ghosts.push({ sprite, mat, x: 0, y: 0 });
  }
  return {
    update(dt, { x = 0, y = 0, strength = 0 } = {}) {
      for (let i = 0; i < ghosts.length; i += 1) {
        const gh = ghosts[i];
        const k = Math.min(1, dt * lerpK[i % lerpK.length]);
        gh.x += (x - gh.x) * k;
        gh.y += (y - gh.y) * k;
        const on = strength > 0.01;
        gh.sprite.visible = on;
        if (!on) continue;
        gh.sprite.position.set(gh.x, gh.y, zStep * (i + 1) * strength);
        gh.mat.opacity = maxOpacity[i % maxOpacity.length] * strength;
      }
    },
    dispose() {
      for (const gh of ghosts) gh.mat.dispose(); // shared texture kept
      group.parent?.remove(group);
      ghosts.length = 0;
    },
  };
}
