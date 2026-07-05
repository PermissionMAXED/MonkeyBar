// The RIGGED COCONUT — Coconut Roulette's centerpiece prop (R5). Procedural,
// same recipe book as props.js: primitive geometry + materials.js helpers,
// zero external assets.
//
// A hairy coconut strapped in a danger-red harness with a stubby fuse. The
// fuse tip glows and BLINKS — blink rate (and the nervous shiver) scale with
// the current explosion probability via setFuseRate(pExplode), so the whole
// bar can read how spicy the next shake is at a glance.
//
// API (consumed by game/modes/roulette.js):
//   group             THREE.Group — position/rotate/show like any prop
//   setFuseRate(p)    0..1 explosion probability → blink speed + shiver
//   setLit(on)        fuse glow on/off (off between rounds)
//   update(dt)        drive the blink/shiver — call every frame
//   fuseWorldPos()    world position of the fuse tip (for spark particles)
//   radius            coconut radius (for placing it on the table top)

import * as THREE from 'three';
import { matte } from './materials.js';

export const BOMB_RADIUS = 0.085;

export function createBombProp() {
  const group = new THREE.Group();
  group.name = 'rigged_coconut';

  // ---- the coconut ---------------------------------------------------------
  const shellMat = matte('#5a3a22', { roughness: 0.95 });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(BOMB_RADIUS, 20, 16), shellMat);
  shell.scale.set(1, 0.92, 1);
  shell.castShadow = true;
  group.add(shell);

  // husk fibre wisps: a few flattened darker blobs stuck to the shell
  const fibreMat = matte('#3f2915', { roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const wisp = new THREE.Mesh(new THREE.SphereGeometry(BOMB_RADIUS * 0.32, 8, 6), fibreMat);
    wisp.scale.set(1, 0.42, 0.55);
    wisp.position.set(
      Math.cos(a) * BOMB_RADIUS * 0.78,
      (i % 2 ? 0.35 : -0.3) * BOMB_RADIUS,
      Math.sin(a) * BOMB_RADIUS * 0.78
    );
    wisp.lookAt(0, wisp.position.y * 2, 0);
    group.add(wisp);
  }

  // the classic three "eyes", facing the table centre (−z after placement)
  const eyeMat = matte('#241608', { roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(BOMB_RADIUS * 0.13, 10), eyeMat);
    const ang = -0.5 + i * 0.5;
    eye.position.set(
      Math.sin(ang) * BOMB_RADIUS * 0.55,
      BOMB_RADIUS * 0.38,
      Math.cos(ang) * BOMB_RADIUS * 0.86
    );
    eye.lookAt(eye.position.clone().multiplyScalar(2));
    group.add(eye);
  }

  // ---- the rig: danger harness + detonator ---------------------------------
  const bandMat = matte('#b3271e', { roughness: 0.55 });
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(BOMB_RADIUS * 0.99, BOMB_RADIUS * 0.13, 8, 28),
    bandMat
  );
  band.rotation.x = Math.PI / 2;
  group.add(band);
  const band2 = new THREE.Mesh(
    new THREE.TorusGeometry(BOMB_RADIUS * 0.95, BOMB_RADIUS * 0.1, 8, 28),
    bandMat
  );
  band2.rotation.z = Math.PI / 2;
  group.add(band2);

  // detonator box where the straps cross, fuse socket on top
  const det = new THREE.Mesh(
    new THREE.BoxGeometry(BOMB_RADIUS * 0.5, BOMB_RADIUS * 0.32, BOMB_RADIUS * 0.5),
    matte('#2c2c30', { roughness: 0.4, metalness: 0.35 })
  );
  det.position.y = BOMB_RADIUS * 0.92;
  group.add(det);

  // ---- the fuse: a bent cord with a glowing, blinking tip -------------------
  const fuseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, BOMB_RADIUS * 1.05, 0),
    new THREE.Vector3(BOMB_RADIUS * 0.16, BOMB_RADIUS * 1.5, BOMB_RADIUS * 0.1),
    new THREE.Vector3(BOMB_RADIUS * 0.45, BOMB_RADIUS * 1.78, BOMB_RADIUS * 0.05),
  ]);
  const fuse = new THREE.Mesh(
    new THREE.TubeGeometry(fuseCurve, 10, BOMB_RADIUS * 0.06, 6),
    matte('#c9b295', { roughness: 0.95 })
  );
  group.add(fuse);

  const tipMat = matte('#ff9a3d', {
    roughness: 0.4,
    emissive: '#ff6a1e',
    emissiveIntensity: 2.2,
  });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(BOMB_RADIUS * 0.14, 10, 8), tipMat);
  const tipLocal = fuseCurve.getPoint(1);
  tip.position.copy(tipLocal);
  group.add(tip);

  // small warning light on the detonator that blinks in counter-phase
  const lampMat = matte('#ff4d5e', {
    roughness: 0.4,
    emissive: '#ff2233',
    emissiveIntensity: 1.6,
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(BOMB_RADIUS * 0.1, 8, 6), lampMat);
  lamp.position.set(0, BOMB_RADIUS * 1.12, BOMB_RADIUS * 0.22);
  group.add(lamp);

  // ---- dynamics --------------------------------------------------------------
  let pExplode = 0;
  let lit = true;
  let t = Math.random() * 10;

  const api = {
    group,
    radius: BOMB_RADIUS,

    /** Explosion probability 0..1 → blink rate + nervous shiver amplitude. */
    setFuseRate(p) {
      pExplode = Math.max(0, Math.min(1, p ?? 0));
    },

    /** Fuse glow on/off (off = defused look between rounds). */
    setLit(on) {
      lit = !!on;
      tip.visible = lit;
      lamp.visible = lit;
    },

    /** Drive the blink + shiver — call once per rendered frame. */
    update(dt) {
      if (!group.visible) return;
      t += dt;
      // blink accelerates with the odds: lazy 1.6 Hz → frantic ~10 Hz
      const hz = 1.6 + pExplode * 8.5;
      const blink = 0.5 + 0.5 * Math.sin(t * hz * Math.PI * 2);
      if (lit) {
        tipMat.emissiveIntensity = 0.7 + blink * (1.8 + pExplode * 3.2);
        lampMat.emissiveIntensity = 0.5 + (1 - blink) * (1.2 + pExplode * 2.6);
        const s = 1 + blink * 0.25 * (0.4 + pExplode);
        tip.scale.setScalar(s);
      }
      // nervous shiver: barely-there at p≈0.08, rattling near p→1
      const shiver = pExplode * pExplode * 0.06;
      shell.rotation.z = Math.sin(t * 31) * shiver;
      shell.rotation.x = Math.cos(t * 27) * shiver * 0.7;
      group.rotation.y += dt * (0.15 + pExplode * 0.4);
    },

    /** World position of the fuse tip (spark particle anchor). */
    fuseWorldPos(target = new THREE.Vector3()) {
      return tip.getWorldPosition(target);
    },

    dispose() {
      group.removeFromParent();
      group.traverse((obj) => {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      });
    },
  };

  return api;
}
