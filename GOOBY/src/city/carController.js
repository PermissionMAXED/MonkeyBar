// Player car controller (§G G7, §C6.1 #1): physics-lite and forgiving, not
// sim-like. Auto-throttle (DRIVE.BASE_SPEED → MAX_SPEED ramp), left/right
// thumb-zone steering (hold left half of the screen = steer left ON SCREEN —
// V4/G57 §G3.1-a/§G2.1 sign contract below), a DOM
// brake button bottom-center, a gentle lane-assist spring (V3/G39 §C7.2:
// max 8°/s, fades to 0 at 25° intent, off at ≥ 40 % deflection — replaces
// the v1 lane SNAP), and soft collisions against buildings/props (slide +
// speed loss — §C4.5 crashes vs traffic are counted by the game, not here).
// Also owns the third-person chase camera (§C7.2: damped k = 4.0/s follow,
// 6 m look-ahead, FOV 55→60 with speed, no roll/bob) and the §D1 car-kit
// wheel fallback. Steering input runs through a τ = 120 ms low-pass with a
// 90°/s output yaw-rate cap (§C7.2) — the pure math lives in city/carFeel.js
// so node:test covers it headlessly; all three drivers (cityDrive trip,
// cityDrive arcade, deliveryRush) inherit the feel through this controller.

import * as THREE from 'three';
import { DRIVE, DRIVE_TUNING } from '../data/constants.js';
import { t } from '../data/strings.js';
// V3/G39 (§C7.2): pure feel math + verbatim tuning numbers (supersedes the
// v1 LANE_SNAP_*/CAM_POS_LERP/CAM_LOOKAHEAD rows in DRIVE_TUNING).
import { FEEL, smoothSteer, steerYawRate, assistRate, assistFade, camFollowFactor, chaseFov } from './carFeel.js';

export { FEEL } from './carFeel.js'; // consumers/evals read the §C7.2 numbers here

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
 *   speedProfile?: {maxSpeed?: number, rampDelaySec?: number},
 *   invertSteer?: boolean,
 * }} deps heading: rotation.y radians, forward = (sin h, 0, cos h); east = π/2.
 *   onStuck (F4 P1-1): fired once per sustained throttle-on standstill
 *   (> STUCK_TRIGGER_SEC) so the game can play a rescue/unstick treatment.
 *   speedProfile (V3/G39 §C7.2): auto-throttle override for the ARCADE
 *   open-run (max 15 m/s, ramp after 20 s — cityDrive passes it); trips and
 *   deliveryRush omit it and keep the §C4 9→13 m/s ramp bit-identical.
 *   invertSteer (V4/G57 for G56's §G3.3 „Steuerung invertieren" flag):
 *   swaps the PLAYER zone/key semantic only (left zone/ArrowLeft steers
 *   screen-right) — the setSteer API + autopilots are never inverted.
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
export function createCarController({ scene, assets, uiRoot, spawn, colliders, onWallHit, onStuck, speedProfile, invertSteer }) {
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

  // V3/G39 (§C7.2): arcade speed override — trips/deliveryRush omit it and
  // keep DRIVE.BASE_SPEED → DRIVE.MAX_SPEED over SPEED_RAMP_SEC unchanged.
  const maxSpeed = speedProfile?.maxSpeed ?? DRIVE.MAX_SPEED;
  const rampDelaySec = speedProfile?.rampDelaySec ?? 0;

  // ---------------------------------------------------------------- state
  let heading = spawn.heading;
  let speed = 0;
  let steer = 0; // raw player/autopilot intent −1..1
  let steerSmoothed = 0; // V3/G39 §C7.2: τ = 120 ms low-passed steering
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
    // V4/G57 (§G3.1-a/§G2.1): zones/keys speak "left/right" ON SCREEN —
    // right zone ⇒ steer +1 ⇒ screen-right turn (see setSteer contract).
    // invertSteer (§G3.3 accessibility flag, G56) swaps the player semantic.
    steer = ((held.right ? 1 : 0) - (held.left ? 1 : 0)) * (invertSteer ? -1 : 1);
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
  /**
   * V3/G39 (§C7.2): gentle lane-assist SPRING — replaces the v1 snap (heading
   * yanked at 97°/s + 1.8/s lateral pull = the "weird" fighting feel). Max
   * correction 8°/s toward the lane heading, force fades linearly to 0 at 25°
   * player-intent angle, fully disabled while actively steering ≥ 40 %
   * deflection (raw thumb input, not the filtered value — release = assist).
   * The lateral lane-centering ease is scaled by the SAME fade so both
   * components let go together as the player commits to a turn.
   */
  function laneAssist(dt) {
    const cardinal = Math.round(heading / HALF_PI) * HALF_PI;
    const diff = wrapAngle(cardinal - heading);
    const rate = assistRate(diff, steer); // 0 beyond 25° intent or ≥ 40 % deflection
    if (rate === 0) return;
    heading += Math.sign(diff) * Math.min(Math.abs(diff), Math.abs(rate) * dt);
    // ease sideways toward the right-hand lane center of the current tile
    const r = Math.round(group.position.z / T.TILE_M + (T.GRID - 1) / 2);
    const c = Math.round(group.position.x / T.TILE_M + (T.GRID - 1) / 2);
    const centerX = (c - (T.GRID - 1) / 2) * T.TILE_M;
    const centerZ = (r - (T.GRID - 1) / 2) * T.TILE_M;
    // forward = (sin h, cos h): 0 → +z south, 1 → +x east, 2 → −z north,
    // 3 → −x west; the right-hand lane is at ±LANE_OFFSET_M off the tile
    // centerline on the travel direction's right side.
    const dirIdx = ((Math.round(cardinal / HALF_PI) % 4) + 4) % 4;
    const k = Math.min(1, T.LANE_SNAP_LATERAL_RATE * assistFade(diff) * dt);
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
    /** V3/G39 telemetry (§C7.2 evidence): raw vs low-passed steering. */
    steering: () => ({ raw: steer, smoothed: steerSmoothed }),

    /**
     * V4/G57 (§G3.1-a) CONTRACT REDEFINITION: `v > 0 = steer screen/driver
     * RIGHT` (heading DECREASES — see the single negation at the yaw
     * application site in update()). §G2.1 rule: a swipe/hold RIGHT must
     * turn the car right ON SCREEN under the chase cam; positive yaw
     * (heading +) turns a +z-facing car toward +x, which the chase camera
     * renders as a LEFT turn — so screen-right steering = heading −.
     * Autopilots/bots command in THIS screen convention (they negate their
     * heading-error term); invertSteer never applies here.
     * @param {number} v -1 (screen-left) … 1 (screen-right)
     */
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
        // auto-throttle (§C6.1: base 9 m/s ramping to 13; V3/G39 §C7.2 the
        // ARCADE profile ramps to 15 starting after 20 s) + crash recovery
        const ramp = Math.min(1, Math.max(0, rampTime - rampDelaySec) / T.SPEED_RAMP_SEC);
        let target = DRIVE.BASE_SPEED + (maxSpeed - DRIVE.BASE_SPEED) * ramp;
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
        // V3/G39 (§C7.2): steering input low-pass (τ = 120 ms) + output
        // yaw-rate cap 90°/s — thumb jitter no longer twitches the car.
        steerSmoothed = smoothSteer(steerSmoothed, steer, dt);
        // (slightly damped at speed so max speed stays manageable)
        const damp = 1 - 0.25 * Math.min(1, speed / DRIVE.MAX_SPEED);
        // V4/G57 (§G3.1-a): the SINGLE steer-sign negation — steer +1
        // (screen-right, setSteer contract) ⇒ heading DECREASES so the
        // chase cam shows a right turn. carFeel.js pure math unchanged.
        heading += steerYawRate(-steerSmoothed, T.STEER_RATE, damp) * dt;
        heading = wrapAngle(heading);
        laneAssist(dt);
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
      // V3/G39 (§C7.2): body roll REMOVED (motion comfort at 130 % UI scale)
      const wheelOmega = (speed / T.CAR_SCALE / 0.3) * dt;
      for (const w of wheels) w.rotation.x += wheelOmega;
    },

    /**
     * Third-person chase cam (§C6.1; V3/G39 §C7.2: damped follow k = 4.0/s,
     * look-ahead 6 m, FOV 55° → 60° with speed 9 → 13 m/s, no roll/bob).
     * Supersedes DRIVE_TUNING.CAM_POS_LERP/CAM_LOOKAHEAD (constants.js is
     * read-only §E0.1-3 — the live numbers are carFeel.js FEEL).
     * @param {import('three').PerspectiveCamera} camera
     * @param {number} dt
     * @param {number} [shake] 0..1 crash-shake amplitude
     */
    updateChaseCam(camera, dt, shake = 0) {
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      const p = group.position;
      const desired = new THREE.Vector3(p.x - fx * T.CAM_BACK, T.ROAD_Y + T.CAM_HEIGHT, p.z - fz * T.CAM_BACK);
      camera.position.lerp(desired, camFollowFactor(dt));
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake * 0.6;
        camera.position.z += (Math.random() - 0.5) * shake;
      }
      camera.lookAt(p.x + fx * FEEL.CAM_LOOKAHEAD_M, T.ROAD_Y + 1.2, p.z + fz * FEEL.CAM_LOOKAHEAD_M);
      // §C7.2 speed-scaled FOV (only touch the projection when it changes)
      if (camera.isPerspectiveCamera) {
        const fov = chaseFov(speed);
        if (Math.abs(camera.fov - fov) > 0.01) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
      }
    },

    dispose() {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      controls.remove();
      scene.remove(group);
      if (import.meta.env?.DEV && window.__car === api) delete window.__car; // V3/G39
    },
  };

  // V3/G39 dev-only telemetry handle (§C7.2 evidence + the V3-E4 eval's
  // scripted step-input probes over CDP) — same pattern as window.__gooby.
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__car = api;

  return api;
}
