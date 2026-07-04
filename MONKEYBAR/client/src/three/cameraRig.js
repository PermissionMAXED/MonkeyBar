// Camera rig — PLAN.md §7 (client/src/three/cameraRig.js).
// Seated first-person camera at the local seat with breathing sway + cursor
// parallax, eased look-target switching, trauma-based decaying shake, and the
// penalty dolly (slow push toward cannon + victim while the lights dim).

import * as THREE from 'three';
import { seatPosition, seatAngle } from './tableView.js';
import { Ease } from './animations.js';

const EYE_HEIGHT = 0.68; // above the stool seat
const TABLE_LOOK = new THREE.Vector3(0, 1.02, 0);

export function createCameraRig(camera) {
  let seat = 0;
  const basePos = new THREE.Vector3(0, 1.35, 2.6);
  const lookCurrent = TABLE_LOOK.clone();
  const lookTarget = TABLE_LOOK.clone();

  // cursor parallax
  const mouse = new THREE.Vector2(0, 0);
  function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  }
  window.addEventListener('mousemove', onMouseMove);

  // trauma shake
  let trauma = 0;

  // penalty dolly state
  let dolly = null; // { from, to, look, t, duration, phase }

  let elapsed = 0;
  const tmp = new THREE.Vector3();
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function seatEyePos(s) {
    const p = seatPosition(s);
    const a = seatAngle(s);
    // pulled slightly back from the stool, eye height above the seat
    return new THREE.Vector3(
      p.x + Math.sin(a) * 0.16,
      p.y + EYE_HEIGHT,
      p.z + Math.cos(a) * 0.16
    );
  }

  return {
    /** Seat the camera at a table seat (first person). */
    setSeat(s) {
      seat = s;
      basePos.copy(seatEyePos(s));
      lookTarget.copy(TABLE_LOOK);
      lookCurrent.copy(TABLE_LOOK);
    },

    /** Ease the view toward a world position. */
    lookAtPoint(p) {
      lookTarget.copy(p);
    },

    /** Ease the view toward whoever sits at `s` (head height). */
    lookAtSeat(s) {
      if (s === seat) {
        lookTarget.copy(TABLE_LOOK);
        return;
      }
      const p = seatPosition(s);
      lookTarget.set(p.x * 0.92, p.y + 0.42, p.z * 0.92);
    },

    lookAtTable() {
      lookTarget.copy(TABLE_LOOK);
    },

    /** Add camera trauma (0..1); decays quadratically. */
    addTrauma(amount) {
      trauma = Math.min(1, trauma + amount);
    },

    /**
     * Penalty dolly: slow push from the seat toward a point between the
     * cannon and the victim. Returns { release() } — call release to ease back.
     */
    penaltyDolly(cannonPos, victimPos, { duration = 2.2 } = {}) {
      const mid = tmp.copy(cannonPos).lerp(victimPos, 0.42).clone();
      mid.y += 0.12;
      // camera target: pull toward a point between our seat and the action
      const to = basePos.clone().lerp(mid, 0.34);
      to.y = Math.max(to.y - 0.08, 1.05);
      dolly = { from: basePos.clone(), to, look: victimPos.clone(), t: 0, duration, phase: 'in' };
      return {
        release: () => {
          if (dolly) {
            dolly.phase = 'out';
            dolly.t = 0;
            dolly.duration = 1.1;
          }
        },
      };
    },

    getSeat: () => seat,

    update(dt) {
      elapsed += dt;

      // eased look target
      lookCurrent.lerp(dolly && dolly.phase === 'in' ? dolly.look : lookTarget, 1 - Math.pow(0.002, dt));

      // dolly interpolation
      let pos = tmp.copy(basePos);
      if (dolly) {
        dolly.t += dt;
        const k = Math.min(dolly.t / dolly.duration, 1);
        if (dolly.phase === 'in') {
          pos.copy(dolly.from).lerp(dolly.to, Ease.quadInOut(k));
          if (k >= 1) dolly.t = dolly.duration; // hold at the end
        } else {
          pos.copy(dolly.to).lerp(dolly.from, Ease.quadInOut(k));
          if (k >= 1) dolly = null;
        }
      }

      // breathing sway
      pos.y += Math.sin(elapsed * 1.7) * 0.008;
      pos.x += Math.sin(elapsed * 0.9) * 0.006;

      camera.position.copy(pos);
      camera.lookAt(lookCurrent);

      // cursor parallax (post-lookAt small rotation offsets)
      camera.rotation.y -= mouse.x * 0.045;
      camera.rotation.x -= mouse.y * 0.03;

      // trauma shake — decays, amplitude = trauma^2
      if (trauma > 0.001) {
        const shake = trauma * trauma;
        camera.getWorldDirection(fwd);
        right.crossVectors(fwd, camera.up).normalize();
        camera.position.addScaledVector(right, (Math.random() - 0.5) * 0.09 * shake);
        camera.position.y += (Math.random() - 0.5) * 0.07 * shake;
        camera.rotation.z += (Math.random() - 0.5) * 0.05 * shake;
        trauma = Math.max(0, trauma - dt * 1.4);
      }
    },

    dispose() {
      window.removeEventListener('mousemove', onMouseMove);
    },
  };
}
