// Player car controller (§G G7, §C6.1 #1): physics-lite and forgiving, not
// sim-like. Auto-throttle (DRIVE.BASE_SPEED → MAX_SPEED ramp), left/right
// thumb-zone steering (hold left half of the screen = steer left), a DOM
// brake button bottom-center, lane-snapping assist within ≤ 15° deviation,
// and soft collisions against buildings/props (slide + speed loss — §C4.5
// crashes vs traffic are counted by the game, not here). Also owns the
// third-person chase camera (§C6.1) and the §D1 car-kit wheel fallback.

import * as THREE from 'three';
import { DRIVE, DRIVE_TUNING } from '../data/constants.js';
import { t } from '../data/strings.js';

const T = DRIVE_TUNING;
const HALF_PI = Math.PI / 2;

// F4 P1-1 wedge watchdog: off-road pockets (building/prop AABB clusters) can
// pin the car so the auto-throttle pushes but the position no longer moves —
// with no reverse gear that soft-locks the run. Compare the COMMANDED speed
// against the ACTUAL per-frame displacement (the internal `speed` stays high
// while wedged, so displacement is the only reliable signal) and fire
// `onStuck` after a sustained standstill. Wall slides keep tangential
// displacement and brief bumps recover in well under the trigger window, so
// neither trips it. (Tuning here, not constants.js — that file is owned by
// another agent; move into DRIVE_TUNING on the next constants pass.)
const STUCK_MIN_CMD_SPEED = 2; //   m/s throttle target before we even look
const STUCK_MAX_MOVE_SPEED = 0.55; // m/s actual displacement = "not moving"
const STUCK_TRIGGER_SEC = 2.6; //   sustained standstill before the rescue

/** Wrap an angle to (-π, π]. @param {number} a @returns {number} */
export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * §D1 car-kit note: bodies may reference separate wheels. Check for nodes
 * named `wheel*`; when absent, attach `wheel-default` clones at estimated
 * wheel positions derived from the body bounds. Returns the spinnable wheels.
 * @param {import('three').Object3D} carModel un-scaled car-kit GLB clone
 * @param {{getModel: (key: string) => import('three').Object3D}} assets
 * @returns {import('three').Object3D[]}
 */
export function ensureWheels(carModel, assets) {
  /** @type {import('three').Object3D[]} */
  const wheels = [];
  carModel.traverse((o) => {
    if (/^wheel/i.test(o.name) && o !== carModel) wheels.push(o);
  });
  if (wheels.length > 0) return wheels;
  // fallback: clone wheel-default onto the body's four corners
  const box = new THREE.Box3().setFromObject(carModel);
  const y = 0.3;
  const x = (box.max.x - box.min.x) * 0.34;
  const z = (box.max.z - box.min.z) * 0.3;
  for (const [wx, wz] of [[x, z], [-x, z], [x, -z], [-x, -z]]) {
    const wheel = assets.getModel('car-kit/wheel-default');
    wheel.position.set(wx, y, wz);
    carModel.add(wheel);
    wheels.push(wheel);
  }
  return wheels;
}

const CONTROLS_CSS = `
.g7-drive{position:absolute;inset:0;pointer-events:none;z-index:30;}
.g7-steer{position:absolute;top:0;bottom:0;width:50%;pointer-events:auto;touch-action:none;
  display:flex;align-items:center;-webkit-tap-highlight-color:transparent;}
.g7-steer-l{left:0;justify-content:flex-start;}
.g7-steer-r{right:0;justify-content:flex-end;}
.g7-steer .g7-chev{font-size:44px;font-weight:800;color:rgba(255,255,255,.55);
  text-shadow:0 2px 6px rgba(74,59,54,.35);padding:0 10px;transition:transform 120ms ease,color 120ms ease;}
.g7-steer.g7-held .g7-chev{color:#fff;transform:scale(1.35);}
.g7-brake{position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(18px + var(--safe-bottom));pointer-events:auto;touch-action:none;
  width:76px;height:76px;border-radius:50%;border:none;cursor:pointer;
  background:#FF7BA9;border-bottom:5px solid rgba(74,59,54,.3);
  color:#fff;font-family:inherit;font-weight:800;font-size:13px;
  box-shadow:0 4px 14px rgba(74,59,54,.3);-webkit-tap-highlight-color:transparent;}
.g7-brake.g7-held{transform:translateX(-50%) scale(.92);background:#e9689a;}
`;

/**
 * @param {{
 *   scene: import('three').Scene,
 *   assets: {getModel: (key: string) => import('three').Object3D},
 *   uiRoot: HTMLElement,
 *   spawn: {x: number, z: number, heading: number},
 *   colliders: Array<{minX: number, maxX: number, minZ: number, maxZ: number}>,
 *   onWallHit?: () => void,
 *   onStuck?: () => void,
 * }} deps heading: rotation.y radians, forward = (sin h, 0, cos h); east = π/2.
 *   onStuck (F4 P1-1): fired once per sustained throttle-on standstill
 *   (> STUCK_TRIGGER_SEC) so the game can play a rescue/unstick treatment.
 * @returns {{
 *   group: import('three').Group, position: import('three').Vector3,
 *   heading: () => number, speed: () => number,
 *   setSteer: (v: number) => void, setBrake: (on: boolean) => void,
 *   applyCrashPenalty: () => void, setFrozen: (on: boolean) => void,
 *   teleport: (x: number, z: number, heading?: number) => void,
 *   aabb: (scale?: number) => {minX: number, maxX: number, minZ: number, maxZ: number},
 *   update: (dt: number) => void,
 *   updateChaseCam: (camera: import('three').PerspectiveCamera, dt: number, shake?: number) => void,
 *   dispose: () => void,
 * }}
 */
export function createCarController({ scene, assets, uiRoot, spawn, colliders, onWallHit, onStuck }) {
  // ---------------------------------------------------------------- meshes
  const group = new THREE.Group();
  group.name = 'playerCar';
  const model = assets.getModel('car-kit/sedan');
  model.scale.setScalar(T.CAR_SCALE);
  group.add(model);
  const wheels = ensureWheels(model, assets);
  group.position.set(spawn.x, T.ROAD_Y, spawn.z);
  group.rotation.y = spawn.heading;
  scene.add(group);

  // world half-extents from the authored car-kit bounds (sedan 1.5 × 2.54)
  const halfW = 0.75 * T.CAR_SCALE;
  const halfL = 1.27 * T.CAR_SCALE;
  const cityHalf = (T.GRID * T.TILE_M) / 2 - 2;

  // ---------------------------------------------------------------- state
  let heading = spawn.heading;
  let speed = 0;
  let steer = 0;
  let braking = false;
  let frozen = false;
  let rampTime = 0;
  let crashRecover = 0; // seconds left of the §C4.5 30%-speed recovery
  let wallContact = false;
  // F4 P1-1: wedge watchdog state (see STUCK_* above)
  let stuckT = 0;
  let prevX = spawn.x;
  let prevZ = spawn.z;

  // ---------------------------------------------------------------- controls
  if (!document.querySelector('style[data-owner="g7-drive"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g7-drive';
    style.textContent = CONTROLS_CSS;
    document.head.appendChild(style);
  }
  const controls = document.createElement('div');
  controls.className = 'g7-drive';
  controls.innerHTML = `
    <div class="g7-steer g7-steer-l" aria-label="${t('drive.steerLeft')}"><span class="g7-chev">‹</span></div>
    <div class="g7-steer g7-steer-r" aria-label="${t('drive.steerRight')}"><span class="g7-chev">›</span></div>
    <button class="g7-brake" aria-label="${t('drive.brake')}">${t('drive.brake')}</button>`;
  // insert UNDER the framework's minigame HUD (z 50) so pause stays tappable
  uiRoot.appendChild(controls);
  const zoneL = controls.querySelector('.g7-steer-l');
  const zoneR = controls.querySelector('.g7-steer-r');
  const brakeBtn = controls.querySelector('.g7-brake');

  const held = { left: false, right: false };
  function syncSteer() {
    steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    zoneL.classList.toggle('g7-held', held.left);
    zoneR.classList.toggle('g7-held', held.right);
  }
  /** @param {HTMLElement} el @param {'left'|'right'} side */
  function bindZone(el, side) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      held[side] = true;
      syncSteer();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(ev, () => {
        held[side] = false;
        syncSteer();
      });
    }
  }
  bindZone(zoneL, 'left');
  bindZone(zoneR, 'right');
  brakeBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    braking = true;
    brakeBtn.classList.add('g7-held');
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    brakeBtn.addEventListener(ev, () => {
      braking = false;
      brakeBtn.classList.remove('g7-held');
    });
  }
  // keyboard (desktop dev convenience — touch zones are the real controls)
  function onKey(down) {
    return (e) => {
      if (e.key === 'ArrowLeft') held.left = down;
      else if (e.key === 'ArrowRight') held.right = down;
      else if (e.key === 'ArrowDown' || e.key === ' ') braking = down;
      else return;
      syncSteer();
    };
  }
  const keyDown = onKey(true);
  const keyUp = onKey(false);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  // ---------------------------------------------------------------- physics
  /** Lane-snapping assist (§G G7: ≤ 15° deviation, no active steering). */
  function laneSnap(dt) {
    if (steer !== 0) return;
    const cardinal = Math.round(heading / HALF_PI) * HALF_PI;
    const diff = wrapAngle(cardinal - heading);
    if (Math.abs(diff) > T.LANE_SNAP_DEG * (Math.PI / 180)) return;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), T.LANE_SNAP_HEADING_RATE * dt);
    heading += step;
    // ease sideways toward the right-hand lane center of the current tile
    const r = Math.round(group.position.z / T.TILE_M + (T.GRID - 1) / 2);
    const c = Math.round(group.position.x / T.TILE_M + (T.GRID - 1) / 2);
    const centerX = (c - (T.GRID - 1) / 2) * T.TILE_M;
    const centerZ = (r - (T.GRID - 1) / 2) * T.TILE_M;
    // forward = (sin h, cos h): 0 → +z south, 1 → +x east, 2 → −z north,
    // 3 → −x west; the right-hand lane is at ±LANE_OFFSET_M off the tile
    // centerline on the travel direction's right side.
    const dirIdx = ((Math.round(cardinal / HALF_PI) % 4) + 4) % 4;
    const k = Math.min(1, T.LANE_SNAP_LATERAL_RATE * dt);
    if (dirIdx === 0) group.position.x += (centerX - T.LANE_OFFSET_M - group.position.x) * k; // south → right = west
    else if (dirIdx === 1) group.position.z += (centerZ + T.LANE_OFFSET_M - group.position.z) * k; // east → right = south
    else if (dirIdx === 2) group.position.x += (centerX + T.LANE_OFFSET_M - group.position.x) * k; // north → right = east
    else group.position.z += (centerZ - T.LANE_OFFSET_M - group.position.z) * k; // west → right = north
  }

  /** Soft AABB collisions: push out, slide, one-time speed loss (§G G7). */
  function collide() {
    const p = group.position;
    let hit = false;
    // city bounds
    if (Math.abs(p.x) > cityHalf) {
      p.x = Math.sign(p.x) * cityHalf;
      hit = true;
    }
    if (Math.abs(p.z) > cityHalf) {
      p.z = Math.sign(p.z) * cityHalf;
      hit = true;
    }
    const r = T.CAR_RADIUS_M;
    for (const b of colliders) {
      const cx = Math.max(b.minX, Math.min(b.maxX, p.x));
      const cz = Math.max(b.minZ, Math.min(b.maxZ, p.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (r - d);
        p.z += (dz / d) * (r - d);
      } else {
        // center inside the box: escape along the shallowest side
        const pens = [
          { pen: p.x - b.minX + r, x: -1, z: 0 },
          { pen: b.maxX - p.x + r, x: 1, z: 0 },
          { pen: p.z - b.minZ + r, x: 0, z: -1 },
          { pen: b.maxZ - p.z + r, x: 0, z: 1 },
        ].sort((a, bb) => a.pen - bb.pen)[0];
        p.x += pens.x * pens.pen;
        p.z += pens.z * pens.pen;
      }
    }
    if (hit && !wallContact) {
      speed *= T.WALL_SPEED_MULT;
      onWallHit?.();
    }
    wallContact = hit;
  }

  const api = {
    group,
    position: group.position,
    heading: () => heading,
    speed: () => speed,

    /** @param {number} v -1 (left) … 1 (right) — autopilot/tests override */
    setSteer(v) {
      steer = Math.max(-1, Math.min(1, v));
    },

    /** @param {boolean} on */
    setBrake(on) {
      braking = !!on;
    },

    /** §C4.5 bump: speed drops to 30%, recovers over CRASH_RECOVER_SEC. */
    applyCrashPenalty() {
      speed *= DRIVE.CRASH_SPEED_MULT;
      crashRecover = T.CRASH_RECOVER_SEC;
    },

    /** Knockable cone/box bonk: small speed loss only (forgiving, §G G7). */
    applyKnockPenalty() {
      speed *= T.KNOCK_SPEED_MULT;
    },

    /** Freeze driving (tow cutscene / arrival) — camera keeps updating. */
    setFrozen(on) {
      frozen = !!on;
    },

    /** @param {number} x @param {number} z @param {number} [h] */
    teleport(x, z, h) {
      group.position.set(x, T.ROAD_Y, z);
      if (typeof h === 'number') heading = h;
      speed = 0;
      stuckT = 0; // F4 P1-1: a teleport is never a standstill
      prevX = x;
      prevZ = z;
    },

    /**
     * Axis-aligned box of the (rotated) car, optionally scaled (§C6.1
     * forgiving 70% hitboxes → pass DRIVE_TUNING.TRAFFIC_HITBOX_SCALE).
     * @param {number} [scale]
     */
    aabb(scale = 1) {
      const s = Math.abs(Math.sin(heading));
      const c = Math.abs(Math.cos(heading));
      const hx = (halfW * c + halfL * s) * scale;
      const hz = (halfW * s + halfL * c) * scale;
      const p = group.position;
      return { minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz };
    },

    /** @param {number} dt seconds */
    update(dt) {
      if (frozen) {
        speed = Math.max(0, speed - T.BRAKE_DECEL * dt);
      } else {
        rampTime += dt;
        // auto-throttle (§C6.1: base 9 m/s ramping to 13) + crash recovery
        const ramp = Math.min(1, rampTime / T.SPEED_RAMP_SEC);
        let target = DRIVE.BASE_SPEED + (DRIVE.MAX_SPEED - DRIVE.BASE_SPEED) * ramp;
        if (crashRecover > 0) {
          crashRecover = Math.max(0, crashRecover - dt);
          const f = DRIVE.CRASH_SPEED_MULT + (1 - DRIVE.CRASH_SPEED_MULT) * (1 - crashRecover / T.CRASH_RECOVER_SEC);
          target *= f;
        }
        if (braking) {
          speed = Math.max(T.BRAKE_MIN_SPEED, speed - T.BRAKE_DECEL * dt);
        } else {
          const accel = speed < target ? 5.5 : 9;
          speed += Math.sign(target - speed) * Math.min(Math.abs(target - speed), accel * dt);
        }
        // steering (slightly damped at speed so max speed stays manageable)
        const damp = 1 - 0.25 * Math.min(1, speed / DRIVE.MAX_SPEED);
        heading += steer * T.STEER_RATE * damp * dt;
        heading = wrapAngle(heading);
        laneSnap(dt);
        group.position.x += Math.sin(heading) * speed * dt;
        group.position.z += Math.cos(heading) * speed * dt;
        collide();
        // F4 P1-1 wedge watchdog: throttle commands motion but the resolved
        // position barely changed → wedged. Braking is an intentional stop.
        if (dt > 0) {
          const moved = Math.hypot(group.position.x - prevX, group.position.z - prevZ);
          if (!braking && speed > STUCK_MIN_CMD_SPEED && moved < STUCK_MAX_MOVE_SPEED * dt) {
            stuckT += dt;
            if (stuckT >= STUCK_TRIGGER_SEC) {
              stuckT = 0;
              onStuck?.();
            }
          } else {
            stuckT = 0;
          }
        }
      }
      prevX = group.position.x;
      prevZ = group.position.z;
      group.rotation.y = heading;
      // a touch of arcade body roll
      model.rotation.z = -steer * Math.min(1, speed / DRIVE.MAX_SPEED) * 0.06;
      const wheelOmega = (speed / T.CAR_SCALE / 0.3) * dt;
      for (const w of wheels) w.rotation.x += wheelOmega;
    },

    /**
     * Third-person chase cam (§C6.1).
     * @param {import('three').PerspectiveCamera} camera
     * @param {number} dt
     * @param {number} [shake] 0..1 crash-shake amplitude
     */
    updateChaseCam(camera, dt, shake = 0) {
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      const p = group.position;
      const desired = new THREE.Vector3(p.x - fx * T.CAM_BACK, T.ROAD_Y + T.CAM_HEIGHT, p.z - fz * T.CAM_BACK);
      camera.position.lerp(desired, 1 - Math.exp(-T.CAM_POS_LERP * dt));
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake * 0.6;
        camera.position.z += (Math.random() - 0.5) * shake;
      }
      camera.lookAt(p.x + fx * T.CAM_LOOKAHEAD, T.ROAD_Y + 1.2, p.z + fz * T.CAM_LOOKAHEAD);
    },

    dispose() {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      controls.remove();
      scene.remove(group);
    },
  };

  return api;
}
