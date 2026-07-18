// Outfit attach (§C5.3 / §D2.3; V2/G22 adds the 9 §C8.4 items → 20 total) —
// procedural outfit items built from
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

// V2/G22 (§C8.4): extra palette entries for the 9 new items.
const C2 = Object.freeze({
  STRAW: '#E8C97A',
  STRAW_DARK: '#C9A85C',
  WHITE: '#FFFFFF',
  LEAF: '#5FA85E',
  PURPLE: '#6C55A3',
  PURPLE_DARK: '#55428A',
});

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

// ---------------------------------------------------------------------------
// V2/G22: the 9 new §C8.4 item builders (all procedural, existing anchors)
// ---------------------------------------------------------------------------

/**
 * Solid 5-point star (no hole) — wizardHat decals.
 * @param {number} outerR @param {number} innerR @param {number} depth
 */
function starSolidGeometry(outerR, innerR, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
}

/** Straw hat 160 — wide garden brim + shallow dome + red band. */
function buildStrawHat() {
  const g = new THREE.Group();
  const straw = outfitMat(C2.STRAW, { roughness: 0.9 });
  const brim = add(g, new THREE.CylinderGeometry(0.19, 0.2, 0.015, 26), straw, [0, 0.008, 0]);
  brim.scale.set(1, 1, 0.92); // slight oval so the brim clears the ears
  const dome = add(
    g,
    new THREE.SphereGeometry(0.104, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    straw,
    [0, 0.012, 0]
  );
  dome.scale.set(1, 0.8, 1);
  add(g, new THREE.CylinderGeometry(0.106, 0.103, 0.032, 20), outfitMat(C.RED, { roughness: 0.7 }), [0, 0.036, 0]);
  // stitch ring on the brim edge (darker straw)
  const stitch = add(g, new THREE.TorusGeometry(0.192, 0.006, 6, 26), outfitMat(C2.STRAW_DARK, { roughness: 0.9 }), [0, 0.014, 0]);
  stitch.rotation.x = Math.PI / 2;
  stitch.scale.set(1, 0.92, 1);
  g.position.set(0, -0.012, 0.07);
  g.rotation.x = 0.22;
  return g;
}

/** Chef hat 220 — white cylinder base + puffy sphere-cluster top. */
function buildChefHat() {
  const g = new THREE.Group();
  const white = outfitMat(C2.WHITE, { roughness: 0.85 });
  add(g, new THREE.CylinderGeometry(0.095, 0.088, 0.1, 20), white, [0, 0.05, 0]);
  // the puff: a ring of 5 small spheres + a fat center one
  const puffGeo = new THREE.SphereGeometry(0.052, 12, 10);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    add(g, puffGeo, white, [Math.cos(a) * 0.062, 0.118, Math.sin(a) * 0.062]);
  }
  add(g, new THREE.SphereGeometry(0.075, 14, 12), white, [0, 0.142, 0]);
  add(g, new THREE.CylinderGeometry(0.0965, 0.0965, 0.02, 20), outfitMat(C.CREAM, { roughness: 0.8 }), [0, 0.012, 0]);
  g.position.set(0, -0.015, 0.07);
  g.rotation.x = 0.2;
  return g;
}

/** Flower crown 180 — leafy torus ring + 6 flower blobs (§C8.4). */
function buildFlowerCrown() {
  const g = new THREE.Group();
  const ring = add(g, new THREE.TorusGeometry(0.102, 0.02, 8, 24), outfitMat(C2.LEAF, { roughness: 0.8 }), [0, 0.02, 0]);
  ring.rotation.x = Math.PI / 2;
  const petal = new THREE.SphereGeometry(0.03, 10, 8);
  const heart = new THREE.SphereGeometry(0.016, 8, 6);
  const cols = [C.PINK, C.CREAM, C.YELLOW];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 0.104;
    const z = Math.sin(a) * 0.104;
    const blob = add(g, petal, outfitMat(cols[i % 3], { roughness: 0.75 }), [x, 0.028, z]);
    blob.scale.set(1, 0.8, 1);
    add(g, heart, outfitMat(cols[(i + 1) % 3], { roughness: 0.6 }), [x, 0.054, z]);
  }
  g.position.set(0, -0.01, 0.07);
  g.rotation.x = 0.18;
  return g;
}

/** Wizard hat 350 — bent cone + brim + gold stars (§C8.4). */
function buildWizardHat() {
  const g = new THREE.Group();
  const purple = outfitMat(C2.PURPLE, { roughness: 0.6 });
  add(g, new THREE.CylinderGeometry(0.148, 0.155, 0.016, 24), outfitMat(C2.PURPLE_DARK, { roughness: 0.6 }), [0, 0.008, 0]);
  add(g, new THREE.ConeGeometry(0.098, 0.17, 18), purple, [0, 0.1, 0]);
  // the bent tip: a smaller cone leaning to the side off the main cone's top
  const tip = add(g, new THREE.ConeGeometry(0.041, 0.12, 12), purple, [0.028, 0.212, 0]);
  tip.rotation.z = -0.55;
  const bobble = add(g, new THREE.SphereGeometry(0.02, 8, 8), gold(), [0.062, 0.252, 0]);
  bobble.scale.setScalar(1); // tip bobble
  // 3 gold stars stuck on the cone face
  const starGeo = starSolidGeometry(0.026, 0.012, 0.008);
  const starSpots = [
    [0, 0.1, 0.088, 0],
    [-0.062, 0.05, 0.055, 0.5],
    [0.06, 0.06, 0.05, -0.6],
  ];
  for (const [x, y, z, lean] of starSpots) {
    const star = add(g, starGeo, gold(), [x, y, z]);
    star.rotation.y = Math.atan2(x, z); // face outward
    star.rotation.z = lean;
  }
  g.position.set(0, -0.012, 0.068);
  g.rotation.x = 0.2;
  return g;
}

/** Heart-shaped extrusion outline (rim) or fill for the heartGlasses. */
function heartShape(scale) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.32 * scale);
  s.bezierCurveTo(0.02 * scale, 0.52 * scale, 0.42 * scale, 0.5 * scale, 0.42 * scale, 0.22 * scale);
  s.bezierCurveTo(0.42 * scale, -0.04 * scale, 0.12 * scale, -0.18 * scale, 0, -0.38 * scale);
  s.bezierCurveTo(-0.12 * scale, -0.18 * scale, -0.42 * scale, -0.04 * scale, -0.42 * scale, 0.22 * scale);
  s.bezierCurveTo(-0.42 * scale, 0.5 * scale, -0.02 * scale, 0.52 * scale, 0, 0.32 * scale);
  return s;
}

/** Heart glasses 220 — heart-shaped rims + pink-tinted fills (§C8.4). */
function buildHeartGlasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.PINK, { roughness: 0.4 });
  const rimShape = heartShape(0.2);
  rimShape.holes.push(heartShape(0.148));
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.014, bevelEnabled: false, curveSegments: 10 });
  const fillGeo = new THREE.ShapeGeometry(heartShape(0.15), 10);
  for (const sx of [-1, 1]) {
    add(g, rimGeo, frame, [sx * 0.112, 0.014, 0.006]);
    add(g, fillGeo, outfitMat(C.LENS_PINK, { roughness: 0.15, opacity: 0.4 }), [sx * 0.112, 0.014, 0.009]);
  }
  addGlassesFrame(g, frame, 0.112);
  return g;
}

/** Monocle 400 — a single gold rim on the right eye + hanging chain (§C8.4). */
function buildMonocle() {
  const g = new THREE.Group();
  const rim = add(g, new THREE.TorusGeometry(0.064, 0.011, 10, 22), gold(), [0.112, 0, 0.012]);
  rim.scale.setScalar(1);
  add(g, new THREE.CircleGeometry(0.06, 18), outfitMat(C.LENS_TINT, { roughness: 0.12, opacity: 0.28 }), [0.112, 0, 0.008]);
  // single temple arm on the monocle side
  const arm = add(g, new THREE.BoxGeometry(0.011, 0.011, 0.17), gold(), [0.205, 0.02, -0.065]);
  arm.rotation.y = -0.38;
  // chain: a short arc of tiny gold links draping down toward the cheek
  const linkGeo = new THREE.SphereGeometry(0.0075, 6, 6);
  const LINKS = 7;
  for (let i = 1; i <= LINKS; i += 1) {
    const p = i / LINKS;
    add(g, linkGeo, gold(), [
      0.112 + p * 0.075 + Math.sin(p * Math.PI) * 0.012,
      -0.064 - p * 0.11 + Math.sin(p * Math.PI) * -0.01,
      0.012 - p * 0.004,
    ]);
  }
  return g;
}

/** Bandana 130 — sky-blue neck band + triangle fold on the chest (§C8.4). */
function buildBandana() {
  const g = new THREE.Group();
  const cloth = outfitMat(C.SKY, { roughness: 0.85 });
  const band = add(g, new THREE.TorusGeometry(0.325, 0.032, 8, 26), cloth, [0, 0.01, -0.05]);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.75);
  // the folded triangle: a flat extruded prism draping down the belly slope
  const tri = new THREE.Shape();
  tri.moveTo(-0.155, 0);
  tri.lineTo(0.155, 0);
  tri.lineTo(0.02, -0.27);
  tri.closePath();
  const triMesh = add(
    g,
    new THREE.ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: false }),
    cloth,
    [0, 0.005, 0.315]
  );
  triMesh.rotation.x = -0.34; // follow the belly slope
  // knot + polka dots on the fold
  add(g, new THREE.BoxGeometry(0.07, 0.05, 0.05), outfitMat(C.TEAL_DARK, { roughness: 0.8 }), [0, 0.01, 0.32]);
  const dotGeo = new THREE.CircleGeometry(0.016, 8);
  for (const [dx, dy] of [[-0.06, -0.07], [0.05, -0.09], [-0.01, -0.16]]) {
    const dot = add(g, dotGeo, outfitMat(C.CREAM, { roughness: 0.8 }), [dx, 0.005 + dy * Math.cos(0.34), 0.338 - dy * Math.sin(-0.34)]);
    dot.rotation.x = -0.34;
  }
  g.position.y = -0.01;
  return g;
}

// -- bell-collar / cape animation plumbing (browser-only; onBeforeRender
//    never fires in headless tests, so the audio import stays lazy) --------

/** @type {{play: Function}|null} lazily imported audio module (bell jingles) */
let bellAudio = null;
let bellAudioLoading = false;
function jingleBell() {
  if (bellAudio) {
    // V2/G29 upgrades: the dedicated bell recipe landed — 'hop.bell' maps to
    // the bespoke 'bellJingle' synth (two inharmonic partials, two shakes).
    bellAudio.play('hop.bell');
    return;
  }
  if (!bellAudioLoading) {
    bellAudioLoading = true;
    import('../audio/audio.js')
      .then((m) => {
        bellAudio = m;
      })
      .catch(() => {});
  }
}

/**
 * Watch a mesh's world-Y velocity each rendered frame and call `onHop` when a
 * hop launch is detected (upward velocity spike after rest). Drives the
 * bellCollar jingle and the cape flutter (§C8.4) without touching the anim
 * system — outfits are guests on the rig, so they self-observe.
 * @param {THREE.Mesh} mesh @param {(vy: number) => void} onFrame
 */
function watchVerticalMotion(mesh, onFrame) {
  const pos = new THREE.Vector3();
  let lastY = null;
  let lastT = 0;
  mesh.onBeforeRender = () => {
    const now = performance.now();
    pos.setFromMatrixPosition(mesh.matrixWorld);
    if (lastY != null && now > lastT) {
      const dt = Math.min((now - lastT) / 1000, 0.1);
      onFrame((pos.y - lastY) / Math.max(dt, 1e-4));
    }
    lastY = pos.y;
    lastT = now;
  };
}

/** Bell collar 160 — strap + gold bell that jingles on hops (§C8.4). */
function buildBellCollar() {
  const g = new THREE.Group();
  const strap = add(g, new THREE.TorusGeometry(0.325, 0.026, 8, 26), outfitMat(C.RED_DARK, { roughness: 0.75 }), [0, 0.01, -0.05]);
  strap.rotation.x = Math.PI / 2;
  strap.scale.set(1, 1, 0.8);
  const bell = add(g, new THREE.SphereGeometry(0.055, 14, 12), gold(), [0, -0.04, 0.33]);
  // bell slit + clapper
  const slit = add(g, new THREE.BoxGeometry(0.006, 0.045, 0.02), outfitMat(C.CHARCOAL, { roughness: 0.5 }), [0, -0.066, 0.362]);
  slit.rotation.x = 0.35;
  add(g, new THREE.SphereGeometry(0.014, 8, 6), outfitMat(C.CHARCOAL, { roughness: 0.5 }), [0, -0.092, 0.345]);
  // hop detection: upward world-velocity spike after rest → one jingle
  let prevVy = 0;
  let readyAt = 0;
  watchVerticalMotion(bell, (vy) => {
    const now = performance.now();
    if (vy > 0.45 && prevVy <= 0.12 && now >= readyAt) {
      readyAt = now + 380; // debounce (a hop is ~0.5 s)
      jingleBell();
    }
    prevVy = vy;
  });
  g.position.y = -0.01;
  return g;
}

/** Cape 500 — rigid swoosh that flutters out on hops (§C8.4, cloth-sim-free). */
function buildCape() {
  const g = new THREE.Group();
  // clasp band + gold buttons at the throat. V2/FIX-C P1-1: the band torus
  // must clear the body lathe (radius ≈0.371 at the neck seam) — 0.36+0.026
  // keeps the strap proud of the surface all around, and the buttons sit on
  // the band front instead of inside the chest.
  const band = add(g, new THREE.TorusGeometry(0.36, 0.026, 8, 26), outfitMat(C.RED_DARK, { roughness: 0.8 }), [0, 0.015, -0.05]);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.8);
  for (const sx of [-1, 1]) {
    add(g, new THREE.SphereGeometry(0.022, 8, 8), gold(), [sx * 0.09, 0.02, 0.315]);
  }
  // the cape sheet: an open cone segment wrapped around the back half,
  // pivoted at the shoulders so flutter can swing the hem outward
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.02, -0.06);
  g.add(pivot);
  const sheetGeo = new THREE.CylinderGeometry(0.34, 0.54, 0.62, 18, 1, true, Math.PI * 0.52, Math.PI * 0.96);
  const sheet = new THREE.Mesh(sheetGeo, outfitMat(C.RED, { roughness: 0.75 }));
  sheet.position.y = -0.31; // top edge at the pivot
  pivot.add(sheet);
  // hem trim
  const hem = new THREE.Mesh(
    new THREE.TorusGeometry(0.54, 0.014, 6, 22, Math.PI * 0.96),
    outfitMat(C.GOLD, { roughness: 0.5, metalness: 0.3 })
  );
  hem.position.y = -0.62;
  hem.rotation.x = Math.PI / 2;
  hem.rotation.z = Math.PI * 0.52 + Math.PI / 2; // align the arc with the sheet
  pivot.add(hem);
  // hop flutter: swing the sheet away from the back on vertical motion
  let flutter = 0;
  watchVerticalMotion(sheet, (vy) => {
    const target = Math.min(Math.max(Math.abs(vy) * 0.4, 0), 0.55);
    flutter += (target - flutter) * 0.18; // eased, rigid swoosh
    pivot.rotation.x = -flutter;
  });
  g.position.y = -0.01;
  return g;
}

/** @type {Record<string, () => THREE.Group>} id → builder (11 §C5.3 + 9 §C8.4 items). */
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
  // V2/G22 (§C8.4)
  strawHat: buildStrawHat,
  chefHat: buildChefHat,
  flowerCrown: buildFlowerCrown,
  wizardHat: buildWizardHat,
  heartGlasses: buildHeartGlasses,
  monocle: buildMonocle,
  bandana: buildBandana,
  bellCollar: buildBellCollar,
  cape: buildCape,
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
