// Cosmetics rig (R9) — every equippable mesh/material recipe in one place so
// monkeyFactory/tableView stay lean. All builders are pure primitives
// (PLAN.md §7: zero downloaded assets) keyed by the shared catalog ids
// (shared/src/cosmetics.js):
//   HAT (8): buildHat(hatId, headR) → Group anchored at the head origin
//   SKIN (6): SKIN_DYES + applySkinDye(furMaterial, skinId) fur re-tints
//   DECO (4): buildDeco(decoId) → Group hung from bar.decorAnchor
//   plus tintCannonGold/untintCannon for the golden_cannon deco flourish.

import * as THREE from 'three';
import { matte, glassMaterial, brassMaterial, neonMaterial } from './materials.js';

// ---------------------------------------------------------------------------
// Shared little material recipes
// ---------------------------------------------------------------------------

function goldMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#e8b23a',
    roughness: 0.22,
    metalness: 0.96,
    emissive: '#5a3c0a',
    emissiveIntensity: 0.3,
  });
}

/** Per-frame spin without engine loop access: ride onBeforeRender. */
function spin(mesh, axis = 'y', speed = 1.2) {
  let last = 0;
  mesh.onBeforeRender = () => {
    const t = performance.now() / 1000;
    if (last) mesh.rotation[axis] += Math.min(t - last, 0.1) * speed;
    last = t;
  };
  return mesh;
}

// ---------------------------------------------------------------------------
// HATS — 8 builders, sized off headR, anchored to the monkey head group
// (head origin = skull center; top of skull ≈ +headR).
// ---------------------------------------------------------------------------

const HAT_BUILDERS = {
  /** A modest golden banana pinned above the ear. */
  banana_pin(r) {
    const g = new THREE.Group();
    const gold = goldMaterial();
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(Math.sin(t * Math.PI) * r * 0.16, 0, (t - 0.5) * r * 0.55));
    }
    const banana = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, r * 0.06, 8), gold);
    for (const end of [0, 1]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.05, 8, 6), gold);
      tip.position.copy(pts[end * 8]);
      banana.add(tip);
    }
    banana.rotation.set(0.4, 0.3, 0.9);
    g.add(banana);
    const stud = new THREE.Mesh(new THREE.SphereGeometry(r * 0.07, 8, 8), brassMaterial());
    g.add(stud);
    g.position.set(r * 0.62, r * 0.72, r * 0.3);
    return g;
  },

  /** Chunky neon-pink shades across the eyes. */
  neon_shades(r) {
    const g = new THREE.Group();
    const lensMat = new THREE.MeshStandardMaterial({ color: '#12060f', roughness: 0.15, metalness: 0.3 });
    const rimMat = neonMaterial('#ff3df0', 1.9);
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 0.27, 18), lensMat);
      lens.position.set(s * r * 0.34, 0, 0);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.27, r * 0.045, 8, 20), rimMat);
      rim.position.copy(lens.position);
      g.add(lens, rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(r * 0.2, r * 0.06, r * 0.06), rimMat);
    bridge.position.y = r * 0.06;
    g.add(bridge);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(r * 0.05, r * 0.05, r * 0.9), rimMat);
      arm.position.set(s * r * 0.6, r * 0.04, -r * 0.42);
      g.add(arm);
    }
    // lenses at ≥ r*1.02 — IN FRONT of the face plane (headR*0.98), never inside it
    g.position.set(0, r * 0.14, r * 1.02);
    return g;
  },

  /** The soda-can crown of legend — gold band, spikes and jewels. */
  crown_of_the_bar(r) {
    const g = new THREE.Group();
    const gold = goldMaterial();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.68, r * 0.3, 18, 1, true), gold);
    g.add(band);
    const jewelColors = ['#ff3d5e', '#39ff88', '#3d9bff', '#ff3df0', '#ffd23d'];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.11, r * 0.42, 6), gold);
      spike.position.set(Math.cos(a) * r * 0.58, r * 0.32, Math.sin(a) * r * 0.58);
      g.add(spike);
      const jewel = new THREE.Mesh(
        new THREE.OctahedronGeometry(r * 0.075),
        matte(jewelColors[i], { roughness: 0.2, emissive: jewelColors[i], emissiveIntensity: 0.55 })
      );
      jewel.position.set(Math.cos(a) * r * 0.58, r * 0.56, Math.sin(a) * r * 0.58);
      g.add(jewel);
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 10, 8), matte('#ff3d5e', { roughness: 0.25, emissive: '#ff3d5e', emissiveIntensity: 0.4 }));
    orb.position.y = r * 0.12;
    orb.position.z = r * 0.66;
    g.add(orb);
    g.position.y = r * 0.92;
    return g;
  },

  /** Crooked paper party cone with stripes and a pompom. */
  party_cone(r) {
    const g = new THREE.Group();
    const h = r * 1.15;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, h, 14, 1, true), matte('#ff5a7a', { roughness: 0.8 }));
    cone.position.y = h / 2;
    g.add(cone);
    // stripes: thin tori wrapped around the cone at descending radii
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const stripe = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.42 * (1 - t) + r * 0.012, r * 0.028, 6, 18),
        matte(i % 2 ? '#ffd23d' : '#35e8d0', { roughness: 0.7 })
      );
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = h * t;
      g.add(stripe);
    }
    const pompom = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 10, 8), matte('#ffd23d', { roughness: 1 }));
    pompom.position.y = h + r * 0.06;
    g.add(pompom);
    g.rotation.z = -0.18;
    g.position.set(r * 0.12, r * 0.78, 0);
    return g;
  },

  /** Weathered tricorn with a jolly monkey emblem. */
  pirate_hat(r) {
    const g = new THREE.Group();
    const felt = matte('#231a12', { roughness: 0.9 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.2, r * 0.09, 3), felt);
    brim.rotation.y = Math.PI / 6; // flat side forward
    brim.position.y = r * 0.1;
    g.add(brim);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), felt);
    dome.position.y = r * 0.08;
    g.add(dome);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, r * 0.035, 6, 3), goldMaterial());
    trim.rotation.x = Math.PI / 2;
    trim.rotation.z = Math.PI / 6;
    trim.position.y = r * 0.15;
    g.add(trim);
    // skull emblem on the front face
    const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 10, 8), matte('#e8e0d0', { roughness: 0.6 }));
    skull.scale.y = 1.15;
    skull.position.set(0, r * 0.32, r * 0.72);
    g.add(skull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.CircleGeometry(r * 0.03, 8), matte('#14100c'));
      eye.position.set(s * r * 0.05, r * 0.34, r * 0.85);
      g.add(eye);
    }
    g.position.y = r * 0.88;
    return g;
  },

  /** Gold-rimmed monocle with a dangling chain. */
  gold_monocle(r) {
    const g = new THREE.Group();
    const gold = goldMaterial();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.3, r * 0.05, 8, 22), gold);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 0.28, 22), glassMaterial('#fff3c9', { opacity: 0.32 }));
    g.add(rim, lens);
    const chainPts = [
      new THREE.Vector3(r * 0.26, -r * 0.12, 0),
      new THREE.Vector3(r * 0.42, -r * 0.5, -r * 0.05),
      new THREE.Vector3(r * 0.36, -r * 0.92, -r * 0.12),
    ];
    const chain = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(chainPts), 10, r * 0.018, 6), gold);
    g.add(chain);
    g.position.set(r * 0.34, r * 0.12, r * 0.96);
    return g;
  },

  /** Puffy white chef's toque. */
  chef_toque(r) {
    const g = new THREE.Group();
    const cloth = matte('#f4f1e8', { roughness: 0.95 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.62, r * 0.42, 18), cloth);
    band.position.y = r * 0.2;
    g.add(band);
    // puff cluster on top
    const puffs = [
      [0, 0.62, 0, 0.42],
      [0.3, 0.56, 0.12, 0.3],
      [-0.28, 0.55, 0.16, 0.28],
      [0.12, 0.58, -0.3, 0.3],
      [-0.15, 0.56, -0.26, 0.27],
    ];
    for (const [x, y, z, s] of puffs) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r * s, 12, 9), cloth);
      puff.position.set(r * x, r * y, r * z);
      g.add(puff);
    }
    g.position.y = r * 0.82;
    return g;
  },

  /** Two-tone beanie with a spinning propeller. */
  propeller_cap(r) {
    const g = new THREE.Group();
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.72, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      matte('#2f5ad9', { roughness: 0.75 })
    );
    g.add(cap);
    // contrast panels
    for (let i = 0; i < 3; i++) {
      const panel = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.725, 16, 10, (i * 2 * Math.PI) / 3, Math.PI / 3, 0, Math.PI * 0.5),
        matte('#ffd23d', { roughness: 0.75 })
      );
      g.add(panel);
    }
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 0.3, 8), matte('#d92f2f', { roughness: 0.6 }));
    peak.position.y = r * 0.72;
    g.add(peak);
    const prop = new THREE.Group();
    for (const rot of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 0.04, r * 0.16), matte(rot ? '#d92f2f' : '#39ff88', { roughness: 0.5 }));
      blade.rotation.y = rot;
      prop.add(blade);
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(r * 0.08, 8, 6), matte('#e8e0d0'));
    prop.add(hub);
    prop.position.y = r * 0.9;
    // the propeller spins (onBeforeRender on the hub drives the whole rotor)
    {
      let last = 0;
      hub.onBeforeRender = () => {
        const t = performance.now() / 1000;
        if (last) prop.rotation.y += Math.min(t - last, 0.1) * 7;
        last = t;
      };
    }
    g.add(prop);
    g.position.y = r * 0.55;
    return g;
  },
};

/**
 * Build a hat mesh group for a catalog hat id.
 * @param {string} hatId   one of the 8 shared catalog hat ids
 * @param {number} headR   the monkey's head radius (local, already scaled)
 * @returns {THREE.Group|null}
 */
export function buildHat(hatId, headR) {
  const builder = HAT_BUILDERS[hatId];
  if (!builder) return null;
  const group = builder(headR);
  group.name = `hat_${hatId}`;
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}

/** Catalog hat ids this rig can build (test/debug aid). */
export const HAT_IDS = Object.freeze(Object.keys(HAT_BUILDERS));

// ---------------------------------------------------------------------------
// SKIN DYES — 6 fur re-tints. A dye overrides furPalette[0] on the shared fur
// material (the per-monkey `fur` MeshStandardMaterial covers skull, torso,
// limbs, tail — belly/face stay their roster colors so faces keep reading).
// ---------------------------------------------------------------------------

/** @type {Record<string, {color: string, roughness?: number, metalness?: number, emissive?: string, emissiveIntensity?: number}>} */
export const SKIN_DYES = Object.freeze({
  midnight: { color: '#181420', roughness: 0.95 },
  albino: { color: '#e8e2d6', roughness: 0.92 },
  cherry: { color: '#c22b3c', roughness: 0.85 },
  neon_lime: { color: '#5ad92f', roughness: 0.75, emissive: '#2f8a12', emissiveIntensity: 0.35 },
  royal_purple: { color: '#5e2d9e', roughness: 0.8, emissive: '#1e0a3a', emissiveIntensity: 0.25 },
  gilded: { color: '#d9a52e', roughness: 0.32, metalness: 0.85, emissive: '#4a3208', emissiveIntensity: 0.3 },
});

/**
 * Re-tint a monkey's shared fur material with a catalog skin dye.
 * @param {THREE.MeshStandardMaterial} furMaterial
 * @param {string|null} skinId  catalog skin id (null/unknown → restore base)
 * @param {{color: string, roughness: number, metalness: number}} base
 *        the material's original values (captured at monkey creation)
 * @returns {boolean} true if a dye was applied
 */
export function applySkinDye(furMaterial, skinId, base) {
  const dye = skinId ? SKIN_DYES[skinId] : null;
  if (!dye) {
    furMaterial.color.set(base.color);
    furMaterial.roughness = base.roughness;
    furMaterial.metalness = base.metalness;
    furMaterial.emissive.set('#000000');
    furMaterial.emissiveIntensity = 1;
    return false;
  }
  furMaterial.color.set(dye.color);
  furMaterial.roughness = dye.roughness ?? base.roughness;
  furMaterial.metalness = dye.metalness ?? base.metalness;
  furMaterial.emissive.set(dye.emissive ?? '#000000');
  furMaterial.emissiveIntensity = dye.emissiveIntensity ?? 1;
  return true;
}

// ---------------------------------------------------------------------------
// DECO — 4 builders for bar.decorAnchor (an Object3D floating above the back
// bar, part of bar.group so it is torn down with the map — tableView rebuilds
// the deco mesh whenever the anchor changes). Suspensions are long on purpose:
// the anchor (y≈2.85) sits right in front of the main neon sign, so payloads
// hang ~0.8–1.0 below it to read against the dark wall instead of the bloom.
// ---------------------------------------------------------------------------

const DECO_BUILDERS = {
  /** Faceted mirror ball on a cord, slowly spinning. */
  disco_ball() {
    const g = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.72, 6), matte('#14100c'));
    cord.position.y = -0.36;
    g.add(cord);
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.17, 1),
      new THREE.MeshStandardMaterial({ color: '#cfd6e4', roughness: 0.08, metalness: 1.0, flatShading: true })
    );
    ball.position.y = -0.84;
    spin(ball, 'y', 0.5);
    g.add(ball);
    // a few glinting sequins that catch bloom
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), neonMaterial(i % 2 ? '#ffffff' : '#9fd8ff', 2.2));
      glint.position.set(Math.cos(a) * 0.175, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.175);
      ball.add(glint);
    }
    return g;
  },

  /** A wooden perch with a very opinionated neon parrot. */
  parrot_perch() {
    const g = new THREE.Group();
    const wood = matte('#5a3a22', { roughness: 0.85 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.55, 8), wood);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = -0.78;
    g.add(bar);
    for (const s of [-1, 1]) {
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.78, 6), matte('#2a2622', { metalness: 0.7, roughness: 0.4 }));
      hanger.position.set(s * 0.26, -0.39, 0);
      g.add(hanger);
    }
    // the parrot — plumage gets a light emissive kick so it pops against the
    // dark sign backboard instead of reading as a silhouette
    const parrot = new THREE.Group();
    const plume = (c) => matte(c, { roughness: 0.8, emissive: c, emissiveIntensity: 0.4 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.07, 4, 10), plume('#d92f2f'));
    body.rotation.x = 0.35;
    parrot.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), plume('#d92f2f'));
    head.position.set(0, 0.095, 0.03);
    parrot.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 8), plume('#ffd23d'));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.085, 0.075);
    parrot.add(beak);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 4), matte('#14100c'));
      eye.position.set(s * 0.022, 0.105, 0.055);
      parrot.add(eye);
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), plume(s < 0 ? '#2f8ad9' : '#39b054'));
      wing.scale.set(0.5, 1.05, 0.8);
      wing.position.set(s * 0.05, -0.01, -0.01);
      parrot.add(wing);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.14, 0.02), plume('#2f8ad9'));
    tail.position.set(0, -0.12, -0.05);
    tail.rotation.x = -0.5;
    parrot.add(tail);
    parrot.position.y = -0.73;
    // idle sway so it reads alive
    body.onBeforeRender = () => {
      parrot.rotation.z = Math.sin((performance.now() / 1000) * 1.7) * 0.08;
    };
    g.add(parrot);
    return g;
  },

  /** A gilded replica of the Coconut Cannon (the real one goes gold too). */
  golden_cannon() {
    const g = new THREE.Group();
    const gold = goldMaterial();
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.16), matte('#2c1c10', { roughness: 0.6 }));
    plinth.position.y = -1.0;
    g.add(plinth);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.98, 6), matte('#2a2622', { metalness: 0.7, roughness: 0.4 }));
    chain.position.y = -0.49;
    g.add(chain);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.042, 0.22, 14), gold);
    barrel.rotation.z = Math.PI / 2 - 0.35;
    barrel.position.set(0.01, -0.91, 0);
    g.add(barrel);
    const breech = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), gold);
    breech.position.set(-0.085, -0.945, 0);
    g.add(breech);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 14), gold);
    ring.rotation.y = Math.PI / 2;
    ring.rotation.z = -0.35;
    ring.position.set(0.1, -0.875, 0);
    g.add(ring);
    const sparkle = new THREE.Mesh(new THREE.OctahedronGeometry(0.014), neonMaterial('#ffe98a', 2.4));
    sparkle.position.set(0.12, -0.85, 0.02);
    spin(sparkle, 'y', 2.4);
    g.add(sparkle);
    return g;
  },

  /** A rail of slow-blooping lava lamps. */
  lava_lamp_rail() {
    const g = new THREE.Group();
    const RAIL_Y = -1.06; // below the neon sign's backboard
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.03, 0.12), matte('#2c1c10', { roughness: 0.7 }));
    rail.position.y = RAIL_Y;
    g.add(rail);
    for (const s of [-1, 1]) {
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, -RAIL_Y - 0.02, 6), matte('#2a2622', { metalness: 0.7, roughness: 0.4 }));
      hanger.position.set(s * 0.38, RAIL_Y / 2, 0);
      g.add(hanger);
    }
    const tints = ['#ff3df0', '#39ff88', '#35e8d0', '#ffd23d'];
    for (let i = 0; i < 4; i++) {
      const x = -0.32 + i * 0.213;
      const tint = tints[i];
      const base = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.05, 10), matte('#3a3a42', { metalness: 0.8, roughness: 0.35 }));
      base.position.set(x, RAIL_Y + 0.035, 0);
      g.add(base);
      const vessel = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.09, 4, 10), glassMaterial(tint, { opacity: 0.3 }));
      vessel.position.set(x, RAIL_Y + 0.12, 0);
      g.add(vessel);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.035, 10), matte('#3a3a42', { metalness: 0.8, roughness: 0.35 }));
      cap.position.set(x, RAIL_Y + 0.2, 0);
      g.add(cap);
      // blooping blobs ride onBeforeRender with per-lamp phase
      const blobMat = neonMaterial(tint, 1.5);
      for (let b = 0; b < 2; b++) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(0.014 + b * 0.006, 8, 6), blobMat);
        blob.position.set(x, RAIL_Y + 0.1, 0);
        const phase = i * 1.7 + b * 2.6;
        blob.onBeforeRender = () => {
          const t = performance.now() / 1000;
          blob.position.y = RAIL_Y + 0.1 + (Math.sin(t * 0.8 + phase) * 0.5 + 0.5) * 0.075;
          const sc = 1 + Math.sin(t * 1.3 + phase) * 0.25;
          blob.scale.set(sc, 1.6 - sc * 0.45, sc);
        };
        g.add(blob);
      }
    }
    return g;
  },
};

/**
 * Build a deco mesh group for a catalog deco id, ready to parent to
 * bar.decorAnchor (meshes hang downward from the anchor origin).
 * @param {string} decoId
 * @returns {THREE.Group|null}
 */
export function buildDeco(decoId) {
  const builder = DECO_BUILDERS[decoId];
  if (!builder) return null;
  const group = builder();
  group.name = `deco_${decoId}`;
  return group;
}

/** Catalog deco ids this rig can build (test/debug aid). */
export const DECO_IDS = Object.freeze(Object.keys(DECO_BUILDERS));

// ---------------------------------------------------------------------------
// Golden cannon tint — the real table cannon (props.js createCannon, group
// name 'coconut_cannon') shares ONE brass material across its parts, so
// re-tinting that instance re-gilds the whole gun. tableView drives this.
// ---------------------------------------------------------------------------

const CANNON_BRASS = { color: '#b8862e', emissive: '#3a2508', emissiveIntensity: 0.25, roughness: 0.28 };
const CANNON_GOLD = { color: '#ffcf3d', emissive: '#6b4a08', emissiveIntensity: 0.5, roughness: 0.16 };

/**
 * Find the live Coconut Cannon in the scene and re-tint its brass to gold.
 * @param {THREE.Scene} scene
 * @returns {THREE.Object3D|null} the cannon group that was tinted (cache it —
 *          the cannon is rebuilt on every map load)
 */
export function tintCannonGold(scene) {
  const cannon = scene.getObjectByName('coconut_cannon');
  if (!cannon) return null;
  applyCannonTint(cannon, CANNON_GOLD);
  return cannon;
}

/** Restore a previously gilded cannon to stock brass. */
export function untintCannon(cannonGroup) {
  if (cannonGroup) applyCannonTint(cannonGroup, CANNON_BRASS);
}

function applyCannonTint(cannonGroup, tint) {
  const seen = new Set();
  cannonGroup.traverse((o) => {
    const m = o.material;
    if (!m || seen.has(m) || !m.isMeshStandardMaterial) return;
    seen.add(m);
    // only the brass parts (high metalness) — dark-iron bands stay iron
    if (m.metalness >= 0.9) {
      m.color.set(tint.color);
      m.emissive.set(tint.emissive);
      m.emissiveIntensity = tint.emissiveIntensity;
      m.roughness = tint.roughness;
    }
  });
}
