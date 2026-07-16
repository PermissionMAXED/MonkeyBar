// Outfit attach (§C5.3 / §D2.3) — 11 procedural outfit items built from
// three.js primitives and attached to Gooby's anchors (hat / glasses / neck).
// All positions/sizes are in Gooby "recipe space" (§D2.2 — the anchors live
// inside the rig, which is uniformly scaled to the 1.05-unit target height),
// tuned with screenshots so items sit correctly: hats perch on the front-top
// of the skull BETWEEN the ears (the ears rise from (±0.13, z 0) — anything
// centered z ≥ ~+0.08 with base radius ≤ ~0.11 clears them), glasses ride the
// eye line, neckwear wraps the head/body seam.
//
// applyOutfits(gooby, equipped) is idempotent (removes the previous item per
// slot before attaching) and accepts either the createGooby() API object or a
// bare THREE.Group containing the named 'anchor-*' nodes — so it also works
// for minigame-cameo rigs (games call applyEquippedOutfits(gooby) — 1 line).
// initOutfitSync() keeps the live home-scene Gooby dressed ('outfitChanged'
// store event + re-apply whenever the home scene rebuilds its rig).

import * as THREE from 'three';
import { OUTFIT_SLOTS, OUTFITS_BY_ID } from '../data/outfits.js';

// ---------------------------------------------------------------------------
// Materials — module-level permanent cache (same pattern as gfx/materials.js;
// marked shared so scene dispose routines skip them). DoubleSide because
// several pieces are flat (cap brim, lens fills, star rims).
// ---------------------------------------------------------------------------

/** Outfit palette (pastel brand-adjacent — §D5). */
const C = Object.freeze({
  PINK: '#FF7BA9',
  CREAM: '#FFF9EC',
  YELLOW: '#FFD166',
  TEAL: '#59C9B9',
  TEAL_DARK: '#3FA396',
  SKY: '#6EC6FF',
  RED: '#E0655F',
  RED_DARK: '#B84943',
  CHARCOAL: '#3A3A44',
  GOLD: '#F7C948',
  BROWN: '#7A5C4F',
  BLACK: '#26262E',
  LENS_DARK: '#1A1A22',
  LENS_TINT: '#BFE3FF',
  LENS_PINK: '#FFD4E4',
});

/** @type {Map<string, THREE.MeshStandardMaterial>} */
const matCache = new Map();

/**
 * Cached outfit material (permanent, shared — never dispose).
 * @param {string} color
 * @param {{roughness?: number, metalness?: number, opacity?: number}} [opts]
 * @returns {THREE.MeshStandardMaterial}
 */
function outfitMat(color, opts = {}) {
  const { roughness = 0.6, metalness = 0, opacity = 1 } = opts;
  const key = `${color}|${roughness}|${metalness}|${opacity}`;
  if (!matCache.has(key)) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    });
    mat.userData.shared = true;
    matCache.set(key, mat);
  }
  return matCache.get(key);
}

/** Gold with a metallic sheen (crown). */
const gold = () => outfitMat(C.GOLD, { roughness: 0.32, metalness: 0.55 });

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Group} parent @param {THREE.BufferGeometry} geo
 * @param {THREE.Material} mat @param {[number,number,number]} [pos]
 * @returns {THREE.Mesh}
 */
function add(parent, geo, mat, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  parent.add(m);
  return m;
}

/**
 * 5-point star ring geometry (outer/inner radius, circular hole) — the
 * starGlasses rims (§C5.3).
 * @param {number} outerR @param {number} innerR @param {number} holeR
 * @param {number} depth
 * @returns {THREE.ExtrudeGeometry}
 */
function starRingGeometry(outerR, innerR, holeR, depth) {
  const shape = new THREE.Shape();
  const points = 5;
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2; // one point up
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
}

// ---------------------------------------------------------------------------
// The 11 item builders (§C5.3) — each returns a THREE.Group in anchor space
// ---------------------------------------------------------------------------

/** Party hat 120 — striped cone (4 alternating frusta) + pompom. */
function buildPartyHat() {
  const g = new THREE.Group();
  const SEGS = 4;
  const R = 0.095;
  const H = 0.24;
  for (let i = 0; i < SEGS; i += 1) {
    const rBottom = R * (1 - i / SEGS);
    const rTop = R * (1 - (i + 1) / SEGS);
    const h = H / SEGS;
    const geo = new THREE.CylinderGeometry(Math.max(0.001, rTop), rBottom, h, 18);
    add(g, geo, outfitMat(i % 2 === 0 ? C.PINK : C.CREAM), [0, h * (i + 0.5), 0]);
  }
  add(g, new THREE.SphereGeometry(0.034, 10, 8), outfitMat(C.YELLOW, { roughness: 0.8 }), [0, H + 0.018, 0]);
  g.position.set(0, -0.015, 0.075);
  g.rotation.x = 0.3;
  return g;
}

/** Beanie 100 — hemisphere dome + folded brim torus + pompom. */
function buildBeanie() {
  const g = new THREE.Group();
  const dome = add(
    g,
    new THREE.SphereGeometry(0.115, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    outfitMat(C.TEAL),
    [0, 0.008, 0]
  );
  dome.scale.set(1, 0.95, 1);
  const brim = add(g, new THREE.TorusGeometry(0.108, 0.028, 10, 22), outfitMat(C.TEAL_DARK), [0, 0.012, 0]);
  brim.rotation.x = Math.PI / 2;
  brim.scale.set(1, 1, 0.85);
  add(g, new THREE.SphereGeometry(0.04, 10, 8), outfitMat(C.CREAM, { roughness: 0.85 }), [0, 0.125, 0]);
  g.position.set(0, -0.018, 0.07);
  g.rotation.x = 0.24;
  return g;
}

/** Cap 150 — dome + forward brim + button. */
function buildCap() {
  const g = new THREE.Group();
  const dome = add(
    g,
    new THREE.SphereGeometry(0.118, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    outfitMat(C.SKY),
    [0, 0, 0]
  );
  dome.scale.set(1, 0.9, 1);
  add(g, new THREE.SphereGeometry(0.02, 8, 6), outfitMat(C.CREAM), [0, 0.105, 0]);
  // brim: flat semicircle sticking out over the eyes
  const brim = add(g, new THREE.CircleGeometry(0.115, 16, 0, Math.PI), outfitMat(C.SKY), [0, 0.014, 0.05]);
  brim.rotation.x = -Math.PI / 2 - 0.22; // lie flat, dip slightly at the front
  brim.scale.set(1, 1.3, 1);
  g.position.set(0, -0.028, 0.07);
  g.rotation.x = 0.26;
  return g;
}

/** Top hat 300 — cylinder + wide brim + band. */
function buildTopHat() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.145, 0.145, 0.014, 24), outfitMat(C.CHARCOAL, { roughness: 0.45 }), [0, 0.007, 0]);
  add(g, new THREE.CylinderGeometry(0.096, 0.086, 0.2, 20), outfitMat(C.CHARCOAL, { roughness: 0.45 }), [0, 0.114, 0]);
  add(g, new THREE.CylinderGeometry(0.0915, 0.0905, 0.042, 20), outfitMat(C.RED), [0, 0.036, 0]);
  g.position.set(0, -0.012, 0.065);
  g.rotation.x = 0.18;
  return g;
}

/** Crown 1200 — gold cylinder + zigzag rim spikes + jewel spheres (endgame flex). */
function buildCrown() {
  const g = new THREE.Group();
  const BAND_H = 0.08;
  const R = 0.092;
  add(g, new THREE.CylinderGeometry(R, R + 0.007, BAND_H, 24, 1, true), gold(), [0, BAND_H / 2, 0]);
  const rim = add(g, new THREE.TorusGeometry(R + 0.006, 0.011, 8, 24), gold(), [0, 0.004, 0]);
  rim.rotation.x = Math.PI / 2;
  // zigzag rim: 8 points around the top edge
  const SPIKES = 8;
  const spikeGeo = new THREE.ConeGeometry(0.026, 0.055, 6);
  for (let i = 0; i < SPIKES; i += 1) {
    const a = (i / SPIKES) * Math.PI * 2;
    const spike = add(g, spikeGeo, gold(), [Math.cos(a) * (R - 0.004), BAND_H + 0.024, Math.sin(a) * (R - 0.004)]);
    spike.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); // lean slightly outward
  }
  // jewels on the band (front + sides + back, alternating colors)
  const jewelGeo = new THREE.SphereGeometry(0.017, 10, 8);
  const jewelCols = [C.RED, C.TEAL, C.PINK, C.TEAL];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 2; // first jewel at the front (+z)
    add(g, jewelGeo, outfitMat(jewelCols[i], { roughness: 0.2, metalness: 0.1 }), [
      Math.cos(a) * (R + 0.008), BAND_H * 0.55, Math.sin(a) * (R + 0.008),
    ]);
  }
  g.position.set(0, -0.012, 0.07);
  g.rotation.x = 0.16;
  return g;
}

/**
 * Shared glasses chassis: bridge + 2 temple arms angled back to the head.
 * @param {THREE.Group} g @param {THREE.Material} mat @param {number} lensX lens center |x|
 */
function addGlassesFrame(g, mat, lensX) {
  add(g, new THREE.CylinderGeometry(0.009, 0.009, 0.07, 8), mat, [0, 0.02, 0.005]).rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const arm = add(g, new THREE.BoxGeometry(0.011, 0.011, 0.17), mat, [sx * 0.205, 0.02, -0.065]);
    arm.rotation.y = -sx * 0.38;
  }
}

/** Round glasses 150 — 2 torus lenses + bridge + temples. */
function buildRoundGlasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.BROWN, { roughness: 0.5 });
  const rimGeo = new THREE.TorusGeometry(0.062, 0.011, 10, 22);
  const fillGeo = new THREE.CircleGeometry(0.058, 18);
  for (const sx of [-1, 1]) {
    add(g, rimGeo, frame, [sx * 0.112, 0, 0.012]);
    add(g, fillGeo, outfitMat(C.LENS_TINT, { roughness: 0.15, opacity: 0.3 }), [sx * 0.112, 0, 0.008]);
  }
  addGlassesFrame(g, frame, 0.112);
  return g;
}

/** Sunglasses 200 — dark discs + browline + temples. */
function buildSunglasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.BLACK, { roughness: 0.35 });
  const lensGeo = new THREE.CylinderGeometry(0.066, 0.066, 0.014, 20);
  for (const sx of [-1, 1]) {
    const lens = add(g, lensGeo, outfitMat(C.LENS_DARK, { roughness: 0.15, opacity: 0.92 }), [sx * 0.112, -0.004, 0.012]);
    lens.rotation.x = Math.PI / 2;
  }
  add(g, new THREE.BoxGeometry(0.245, 0.02, 0.016), frame, [0, 0.052, 0.01]);
  addGlassesFrame(g, frame, 0.112);
  return g;
}

/** Star glasses 250 — star-shaped rims + tinted lenses. */
function buildStarGlasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.PINK, { roughness: 0.4 });
  const starGeo = starRingGeometry(0.085, 0.05, 0.042, 0.014);
  const fillGeo = new THREE.CircleGeometry(0.044, 16);
  for (const sx of [-1, 1]) {
    add(g, starGeo, frame, [sx * 0.115, 0, 0.004]);
    add(g, fillGeo, outfitMat(C.LENS_PINK, { roughness: 0.15, opacity: 0.45 }), [sx * 0.115, 0, 0.006]);
  }
  addGlassesFrame(g, frame, 0.115);
  return g;
}

/**
 * Scarf ring around the head/body seam — full torus (or striped segments)
 * half-buried in the body so it reads as wrapped.
 * @param {THREE.Group} g @param {string[]} colors 1 = solid, 2+ = stripes
 */
function addScarfRing(g, colors) {
  const SEGS = colors.length === 1 ? 1 : 10;
  const arc = (Math.PI * 2) / SEGS;
  for (let i = 0; i < SEGS; i += 1) {
    const geo = new THREE.TorusGeometry(0.33, 0.07, 10, SEGS === 1 ? 28 : 4, SEGS === 1 ? Math.PI * 2 : arc);
    const ring = add(g, geo, outfitMat(colors[i % colors.length], { roughness: 0.85 }), [0, 0.0, -0.05]);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = i * arc;
    ring.scale.set(1, 1, 0.8); // flatten vertically (torus local z = world y here)
  }
}

/**
 * Hanging scarf tail (stacked boxes; multiple colors = stripes).
 * @param {THREE.Group} g @param {number} sx -1|1 @param {string[]} colors
 */
function addScarfTail(g, sx, colors) {
  const tail = new THREE.Group();
  const N = colors.length === 1 ? 1 : 3;
  const segH = 0.22 / N;
  for (let i = 0; i < N; i += 1) {
    add(tail, new THREE.BoxGeometry(0.095, segH, 0.042), outfitMat(colors[i % colors.length], { roughness: 0.85 }), [
      0, -segH * (i + 0.5), 0,
    ]);
  }
  // fringe nubs at the tail end
  for (const fx of [-0.03, 0, 0.03]) {
    add(tail, new THREE.BoxGeometry(0.02, 0.035, 0.03), outfitMat(colors[colors.length - 1], { roughness: 0.9 }), [
      fx, -0.22 - 0.014, 0,
    ]);
  }
  tail.position.set(sx * 0.06, -0.02, 0.36);
  tail.rotation.x = -0.22; // follow the belly slope
  tail.rotation.z = sx * 0.12;
  g.add(tail);
}

/** Red scarf 120 — torus segment ring + 2 hanging tails. */
function buildScarfRed() {
  const g = new THREE.Group();
  addScarfRing(g, [C.RED]);
  addScarfTail(g, -1, [C.RED]);
  addScarfTail(g, 1, [C.RED_DARK]);
  add(g, new THREE.BoxGeometry(0.13, 0.075, 0.06), outfitMat(C.RED, { roughness: 0.85 }), [0, -0.005, 0.315]);
  g.position.y = -0.01;
  return g;
}

/** Bowtie 140 — 2 wing boxes + center knot on a thin neck band. */
function buildBowtie() {
  const g = new THREE.Group();
  const band = add(g, new THREE.TorusGeometry(0.325, 0.02, 8, 26), outfitMat(C.RED_DARK), [0, 0.01, -0.05]);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.9);
  for (const sx of [-1, 1]) {
    const wing = add(g, new THREE.BoxGeometry(0.125, 0.078, 0.045), outfitMat(C.RED), [sx * 0.077, 0.005, 0.31]);
    wing.rotation.z = sx * 0.14;
    wing.rotation.x = -0.15;
  }
  const knot = add(g, new THREE.BoxGeometry(0.05, 0.058, 0.05), outfitMat(C.RED_DARK), [0, 0.005, 0.325]);
  knot.rotation.x = -0.15;
  return g;
}

/** Striped scarf 180 — teal/cream striped ring + striped tails. */
function buildScarfStriped() {
  const g = new THREE.Group();
  addScarfRing(g, [C.TEAL, C.CREAM]);
  addScarfTail(g, -1, [C.TEAL, C.CREAM, C.TEAL]);
  addScarfTail(g, 1, [C.CREAM, C.TEAL, C.CREAM]);
  add(g, new THREE.BoxGeometry(0.13, 0.075, 0.06), outfitMat(C.TEAL, { roughness: 0.85 }), [0, -0.005, 0.315]);
  g.position.y = -0.01;
  return g;
}

/** @type {Record<string, () => THREE.Group>} id → builder (all 11 §C5.3 items). */
const BUILDERS = Object.freeze({
  partyHat: buildPartyHat,
  beanie: buildBeanie,
  cap: buildCap,
  topHat: buildTopHat,
  crown: buildCrown,
  roundGlasses: buildRoundGlasses,
  sunglasses: buildSunglasses,
  starGlasses: buildStarGlasses,
  scarfRed: buildScarfRed,
  bowtie: buildBowtie,
  scarfStriped: buildScarfStriped,
});

/**
 * Build one outfit item mesh group (anchor space).
 * @param {string} id catalog id (data/outfits.js)
 * @returns {THREE.Group|null} named `outfit-<slot>`, or null for unknown ids
 */
export function buildOutfitItem(id) {
  const def = OUTFITS_BY_ID[id];
  const builder = BUILDERS[id];
  if (!def || !builder) {
    console.warn(`[outfitAttach] unknown outfit '${id}'`);
    return null;
  }
  const group = builder();
  group.name = `outfit-${def.slot}`;
  group.userData.outfitId = id;
  return group;
}

// ---------------------------------------------------------------------------
// Attach / detach
// ---------------------------------------------------------------------------

/**
 * Resolve the hat/glasses/neck anchors from a createGooby() API object or a
 * bare rig group (named 'anchor-*' nodes — §D2.3).
 * @param {{anchors?: object, group?: THREE.Group}|THREE.Object3D|null} gooby
 * @returns {Record<string, THREE.Object3D>|null}
 */
function resolveAnchors(gooby) {
  if (!gooby) return null;
  if (gooby.anchors?.hat) return gooby.anchors;
  const root = gooby.isObject3D ? gooby : gooby.group;
  if (!root?.traverse) return null;
  /** @type {Record<string, THREE.Object3D>} */
  const found = {};
  root.traverse((obj) => {
    for (const slot of OUTFIT_SLOTS) {
      if (obj.name === `anchor-${slot}`) found[slot] = obj;
    }
  });
  return found.hat || found.glasses || found.neck ? found : null;
}

/**
 * Dress a Gooby rig per the equipped map (§C5.3: one item per slot).
 * Idempotent — each slot's previous outfit is removed (geometries disposed;
 * outfit materials are shared/permanent) before the new one attaches, so
 * calling with the same map twice leaves exactly one item per slot.
 *
 * @param {{anchors?: object, group?: THREE.Group}|THREE.Object3D|null} gooby
 *   createGooby() rig or any Object3D containing the named anchors
 * @param {{hat?: string|null, glasses?: string|null, neck?: string|null}} [equipped]
 * @returns {boolean} false when no anchors could be resolved
 */
export function applyOutfits(gooby, equipped = {}) {
  const anchors = resolveAnchors(gooby);
  if (!anchors) return false;
  for (const slot of OUTFIT_SLOTS) {
    const anchor = anchors[slot];
    if (!anchor) continue;
    for (const child of [...anchor.children]) {
      if (!child.name?.startsWith('outfit-')) continue;
      child.traverse((obj) => obj.geometry?.dispose?.());
      anchor.remove(child);
    }
    const id = equipped?.[slot];
    if (id) {
      const item = buildOutfitItem(id);
      if (item) anchor.add(item);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Live wiring (single marked G12 block in main.js calls initOutfitSync)
// ---------------------------------------------------------------------------

/** @type {object|null} the store handle after initOutfitSync (for the helper below) */
let liveStore = null;

/**
 * Dress a rig with the CURRENTLY equipped save outfits — the one-liner for
 * scenes/games that build their own Gooby (minigame cameos, drive sitDrive):
 * `applyEquippedOutfits(this.gooby)` right after createGooby(). No-op before
 * initOutfitSync ran (e.g. headless tests).
 * @param {{anchors?: object, group?: THREE.Group}|THREE.Object3D|null} gooby
 * @returns {boolean}
 */
export function applyEquippedOutfits(gooby) {
  if (!liveStore) return false;
  return applyOutfits(gooby, liveStore.get('outfits.equipped') ?? {});
}

let syncWired = false;

/**
 * Keep the home-scene Gooby dressed (§C5.3): re-applies on every
 * 'outfitChanged' store event and whenever the home scene rebuilds its rig
 * (polled module accessor — same guarded pattern as the G6/G7 room hooks;
 * home/homeScene.js is only imported lazily in the browser).
 * @param {{store: object}} deps
 */
export function initOutfitSync({ store }) {
  liveStore = store;
  if (syncWired) return;
  syncWired = true;

  // Dev harness extension (§E9 spirit, dev only): ?outfits=crown,starGlasses,…
  // owns + equips the listed catalog ids at boot (G12 screenshot surface).
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  if (isDev && typeof location !== 'undefined') {
    const raw = new URLSearchParams(location.search).get('outfits');
    if (raw != null) {
      const ids = raw.split(',').map((s) => s.trim()).filter((id) => OUTFITS_BY_ID[id]);
      store.update((state) => {
        state.outfits.equipped = { hat: null, glasses: null, neck: null };
        for (const id of ids) {
          if (!state.outfits.owned.includes(id)) state.outfits.owned.push(id);
          state.outfits.equipped[OUTFITS_BY_ID[id].slot] = id;
        }
      });
    }
  }

  /** @type {object|null} */
  let lastGooby = null;
  const apply = () => {
    if (lastGooby) applyOutfits(lastGooby, store.get('outfits.equipped') ?? {});
  };
  store.on('outfitChanged', apply);

  setInterval(async () => {
    try {
      const mod = await import('../home/homeScene.js');
      const gooby = mod.getGooby?.();
      if (!gooby) {
        lastGooby = null;
        return;
      }
      if (gooby !== lastGooby) {
        lastGooby = gooby;
        apply();
      }
    } catch {
      /* home scene not present (tests / early boot) */
    }
  }, 700);
}
