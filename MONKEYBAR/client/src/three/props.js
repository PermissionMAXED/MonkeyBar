// Table props — PLAN.md §7 (client/src/three/props.js).
// Cards (rounded box + CanvasTexture fruit faces), chips (notched cylinders),
// bananas (bent tubes), bottles, and the brass Coconut Cannon with fire-FX hooks.

import * as THREE from 'three';
import {
  makeFruitFaceTexture,
  makeCardBackTexture,
  makeLabelTexture,
  glassMaterial,
  brassMaterial,
  matte,
  woodMaterial,
} from './materials.js';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const CARD_W = 0.115;
export const CARD_H = 0.16;
export const CARD_T = 0.0045;

let cardGeoCache = null;

function roundedCardGeometry() {
  if (cardGeoCache) return cardGeoCache;
  const r = 0.012;
  const w = CARD_W;
  const h = CARD_H;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: CARD_T, bevelEnabled: false });
  geo.translate(0, 0, -CARD_T / 2);
  // UVs for the extruded front/back faces span the card rect
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  }
  cardGeoCache = geo;
  return geo;
}

/**
 * Build a playing card. Front face (+z) shows the fruit (or the back pattern
 * when `fruit` is null / unknown — a face-down card).
 * @param {string|null} fruit  'banana'|'coconut'|'mango'|'golden'|null
 */
export function createCard(fruit = null) {
  const backTex = makeCardBackTexture();
  const frontTex = fruit ? makeFruitFaceTexture(fruit) : backTex;
  const mat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.6, metalness: 0 });
  const mesh = new THREE.Mesh(roundedCardGeometry(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // thin back plane so both sides read correctly
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W * 0.985, CARD_H * 0.985),
    new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.6 })
  );
  back.rotation.y = Math.PI;
  back.position.z = -CARD_T / 2 - 0.0002;
  mesh.add(back);

  mesh.userData.setFruit = (f) => {
    mesh.material.map = f ? makeFruitFaceTexture(f) : backTex;
    mesh.material.needsUpdate = true;
  };
  return mesh;
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

/**
 * Lucky Banana Chip — notched cylinder (casino-style edge marks).
 * @param {string} color
 */
export function createChip(color = '#f0c53d') {
  const g = new THREE.Group();
  const R = 0.032;
  const H = 0.008;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 24), matte(color, { roughness: 0.45 }));
  body.castShadow = true;
  g.add(body);
  const notchMat = matte('#2a2018', { roughness: 0.5 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.012, H * 1.06, 0.008), notchMat);
    notch.position.set(Math.cos(a) * R * 0.97, 0, Math.sin(a) * R * 0.97);
    notch.rotation.y = -a + Math.PI / 2;
    g.add(notch);
  }
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(R * 0.55, 16), matte('#8a6a1e', { roughness: 0.4 }));
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.y = H / 2 + 0.0004;
  g.add(emblem);
  return g;
}

// ---------------------------------------------------------------------------
// Bananas (bent tubes)
// ---------------------------------------------------------------------------

export function createBanana(scale = 1) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(Math.sin(t * Math.PI) * 0.035, 0, (t - 0.5) * 0.13));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.014, 8), matte('#f5d442', { roughness: 0.55 }));
  body.castShadow = true;
  const tipMat = matte('#6b4a1e');
  for (const end of [0, 1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), tipMat);
    tip.position.copy(curve.getPoint(end));
    body.add(tip);
  }
  body.scale.setScalar(scale);
  return body;
}

// ---------------------------------------------------------------------------
// Bottles (for the back bar)
// ---------------------------------------------------------------------------

const BOTTLE_TINTS = ['#3d8a5a', '#8a3d3d', '#3d5a8a', '#8a7a3d', '#6b3d8a', '#3d8a86'];
const BOTTLE_NAMES = ['RUM 51', 'VINE GIN', 'PALM', 'JUNGLE', 'GUAVA', 'COCO', 'MANGO', 'BREW'];

export function createBottle(i = 0) {
  const tint = BOTTLE_TINTS[i % BOTTLE_TINTS.length];
  const g = new THREE.Group();
  const h = 0.16 + (i % 3) * 0.03;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, h, 10), glassMaterial(tint, { opacity: 0.55 }));
  body.position.y = h / 2;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.014, 0.06, 8), glassMaterial(tint, { opacity: 0.55 }));
  neck.position.y = h + 0.028;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.014, 8), matte('#c9b295', { roughness: 0.4 }));
  cap.position.y = h + 0.062;
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0285, 0.0285, h * 0.4, 10, 1, true),
    new THREE.MeshStandardMaterial({ map: makeLabelTexture(BOTTLE_NAMES[i % BOTTLE_NAMES.length]), roughness: 0.8 })
  );
  label.position.y = h * 0.5;
  g.add(body, neck, cap, label);
  return g;
}

// ---------------------------------------------------------------------------
// The Coconut Cannon
// ---------------------------------------------------------------------------

/**
 * Brass Coconut Cannon on a swivel mount, bolted to the table.
 * Returns { group, yaw, pitch, muzzle, fusePoint, aimAtWorld(pos), coconut }.
 * - group: add to scene, position on the table
 * - yaw / pitch: Object3Ds to tween when aiming
 * - muzzle: Object3D at the barrel tip (spawn flash/smoke here)
 * - fusePoint: Object3D at the breech (spark particles)
 */
export function createCannon() {
  const brass = brassMaterial();
  const darkIron = matte('#2a2622', { roughness: 0.5, metalness: 0.7 });

  const group = new THREE.Group();
  group.name = 'coconut_cannon';

  // bolted base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.03, 18), darkIron);
  base.position.y = 0.015;
  base.castShadow = true;
  group.add(base);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6), brass);
    bolt.position.set(Math.cos(a) * 0.09, 0.032, Math.sin(a) * 0.09);
    group.add(bolt);
  }

  // yaw swivel
  const yaw = new THREE.Group();
  yaw.position.y = 0.03;
  group.add(yaw);
  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.025, 18), brass);
  turntable.position.y = 0.012;
  turntable.castShadow = true;
  yaw.add(turntable);
  // yoke arms
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.075, 0.03), brass);
    arm.position.set(s * 0.052, 0.055, 0);
    yaw.add(arm);
  }

  // pitch pivot + barrel
  const pitch = new THREE.Group();
  pitch.position.y = 0.085;
  yaw.add(pitch);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.046, 0.26, 16), brass);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.09;
  barrel.castShadow = true;
  pitch.add(barrel);
  const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.007, 8, 16), brass);
  muzzleRing.position.z = 0.22;
  pitch.add(muzzleRing);
  const breech = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 12), brass);
  breech.position.z = -0.045;
  breech.castShadow = true;
  pitch.add(breech);
  // decorative bands
  for (const z of [0.02, 0.1, 0.17]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.042 - z * 0.04, 0.005, 6, 16), darkIron);
    band.position.z = z;
    pitch.add(band);
  }

  // muzzle + fuse anchors
  const muzzle = new THREE.Object3D();
  muzzle.position.z = 0.23;
  pitch.add(muzzle);
  const fusePoint = new THREE.Object3D();
  fusePoint.position.set(0, 0.05, -0.07);
  pitch.add(fusePoint);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.045, 6), matte('#8a7a5a'));
  fuse.position.set(0, 0.075, -0.07);
  fuse.rotation.z = 0.3;
  pitch.add(fuse);

  // hemisphere coconut ammo rack
  const rack = new THREE.Group();
  rack.position.set(0.12, 0.012, -0.1);
  group.add(rack);
  const coconutMat = matte('#5a3d24', { roughness: 0.95 });
  const coconuts = [];
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), coconutMat);
    nut.position.set((i - 1) * 0.055, 0, 0);
    nut.castShadow = true;
    rack.add(nut);
    coconuts.push(nut);
  }

  const worldPos = new THREE.Vector3();
  const local = new THREE.Vector3();

  return {
    group,
    yaw,
    pitch,
    muzzle,
    fusePoint,
    coconuts,
    /**
     * Compute { yawY, pitchX } angles to aim the barrel at a world position.
     * The caller tweens yaw.rotation.y / pitch.rotation.x toward them.
     */
    anglesToWorld(target) {
      group.getWorldPosition(worldPos);
      local.copy(target).sub(worldPos);
      // account for the group's world rotation (table may be rotated)
      const q = group.getWorldQuaternion(new THREE.Quaternion()).invert();
      local.applyQuaternion(q);
      const yawY = Math.atan2(local.x, local.z);
      const flat = Math.sqrt(local.x * local.x + local.z * local.z);
      const pitchX = -Math.atan2(local.y - 0.115, flat);
      return { yawY, pitchX };
    },
    /** Instantly snap the aim at a world position. */
    aimAtWorld(target) {
      const { yawY, pitchX } = this.anglesToWorld(target);
      yaw.rotation.y = yawY;
      pitch.rotation.x = pitchX;
    },
    /** World position of the muzzle tip (into target). */
    muzzleWorldPos(target = new THREE.Vector3()) {
      return muzzle.getWorldPosition(target);
    },
    fuseWorldPos(target = new THREE.Vector3()) {
      return fusePoint.getWorldPosition(target);
    },
  };
}

// ---------------------------------------------------------------------------
// Stool (shared with barScene)
// ---------------------------------------------------------------------------

export function createStool(accentHex = '#7a4f2a', seatH = 0.62) {
  const g = new THREE.Group();
  const wood = woodMaterial(accentHex, { seed: 21 });
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.05, 14), wood);
  seat.position.y = seatH;
  seat.castShadow = true;
  seat.receiveShadow = true;
  g.add(seat);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, seatH, 8), wood);
    leg.position.set(Math.cos(a) * 0.13, seatH / 2, Math.sin(a) * 0.13);
    leg.rotation.z = Math.cos(a) * 0.1;
    leg.rotation.x = -Math.sin(a) * 0.1;
    leg.castShadow = true;
    g.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 16), wood);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = seatH * 0.35;
  g.add(ring);
  return g;
}
