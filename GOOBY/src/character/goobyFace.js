// Gooby's face rig (§D2.2 face parts + §D2.5 emotion faces): eyes with
// bead-and-shine, eyelids, nose, BUCK TEETH (he's a rabbit), cheeks, the 5
// pre-built mouth shape meshes toggled by visibility, dizzy spiral pupil
// overlays and the hungry drool drop. Owns auto-blink (random 2.5–5 s),
// sleepy yawns and pupil offsets for lookAt tracking. All meshes are named for
// raycast region mapping (§D2.2) and positioned in headGrp-local space
// (head pivot sits at body y 0.70 — §D2.2).

import * as THREE from 'three';
import { goobyMat } from '../gfx/materials.js';
import { FACES } from './emotions.js';

const HEAD_PIVOT_Y = 0.7;
/** Head ellipsoid (body space): sphere r 0.30 scaled (1.05, 0.92, 0.95) at (0, 0.86, 0.02). */
const HEAD = Object.freeze({ cx: 0, cy: 0.86, cz: 0.02, rx: 0.315, ry: 0.276, rz: 0.285 });

const BLINK_MIN_SEC = 2.5;
const BLINK_MAX_SEC = 5;
const BLINK_CLOSE_SEC = 0.07;
const BLINK_HOLD_SEC = 0.05;
const BLINK_OPEN_SEC = 0.1;
const LID_CLOSED = 1.25;
const YAWN_SEC = 1.4;
// Mesh rotation mapping for the lid half-spheres: at lid=0 the cap is tucked
// back into the head (fully open eye), at lid=1.25 it covers the whole bead.
const LID_ROT_OPEN = -1.15;
const LID_ROT_CLOSED = 1.4;

/** body-space → headGrp-local */
function local(x, y, z) {
  return new THREE.Vector3(x, y - HEAD_PIVOT_Y, z);
}

/**
 * Solve the head-surface z for a given (x, y) in body space (+ outward push).
 * Keeps decals (cheeks, mouth) flush with the head instead of buried.
 */
function surfaceZ(x, y, push = 0.004) {
  const k = 1 - ((x - HEAD.cx) / HEAD.rx) ** 2 - ((y - HEAD.cy) / HEAD.ry) ** 2;
  return HEAD.cz + HEAD.rz * Math.sqrt(Math.max(0, k)) + push;
}

// ---------------------------------------------------------------------------
// Mouth shapes (§D2.2: 5 pre-built ShapeGeometry meshes toggled by visibility)
// ---------------------------------------------------------------------------

/** Arc band (smile/frown lip). */
function arcBandShape(R, w, a0, a1) {
  const s = new THREE.Shape();
  s.absarc(0, 0, R + w / 2, a0, a1, false);
  s.absarc(0, 0, R - w / 2, a1, a0, true);
  return s;
}

/** 2D capsule (flat mouth). */
function capsule2dShape(width, height) {
  const r = height / 2;
  const hw = width / 2 - r;
  const s = new THREE.Shape();
  s.absarc(-hw, 0, r, Math.PI / 2, -Math.PI / 2, false);
  s.absarc(hw, 0, r, -Math.PI / 2, Math.PI / 2, false);
  return s;
}

function ellipseShape(rx, ry) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  return s;
}

/** Center a ShapeGeometry on its bounding box so all mouths share one anchor. */
function centeredShapeGeo(shape, segments = 10) {
  const geo = new THREE.ShapeGeometry(shape, segments);
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox.getCenter(c);
  geo.translate(-c.x, -c.y, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// Spiral pupil texture (dizzy)
// ---------------------------------------------------------------------------

/** @type {THREE.CanvasTexture|null} */
let spiralTex = null;

function getSpiralTexture() {
  if (spiralTex) return spiralTex;
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const g = canvas.getContext('2d');
  const c = s / 2;
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(c, c, s * 0.48, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3A2E2E';
  g.lineWidth = s * 0.09;
  g.lineCap = 'round';
  g.beginPath();
  const turns = 2.4;
  for (let i = 0; i <= 72; i += 1) {
    const t = i / 72;
    const a = t * turns * Math.PI * 2;
    const r = t * s * 0.4;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  spiralTex = new THREE.CanvasTexture(canvas);
  return spiralTex;
}

// ---------------------------------------------------------------------------
// Face rig
// ---------------------------------------------------------------------------

/**
 * Build the face and attach it to the head pivot group.
 * @param {THREE.Group} headGrp head pivot (§D2.2 hierarchy root→body→head→face)
 * @returns {{
 *   group: THREE.Group,
 *   update: (dt: number, pose: object) => void,
 *   applyEmotion: (faceDef: object) => void,
 *   setPupil: (x: number, y: number) => void,
 *   setDroolOverride: (on: boolean|null) => void,
 *   setSpiralOverride: (on: boolean|null) => void,
 *   blinkNow: () => void,
 *   dispose: () => void,
 * }}
 */
export function createGoobyFace(headGrp) {
  const group = new THREE.Group();
  group.name = 'face';
  headGrp.add(group);

  /** geometries created here (shared materials are NOT disposed) */
  const ownedGeos = [];
  function mesh(name, geo, mat) {
    ownedGeos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    return m;
  }

  // --- Eyes: bead r 0.045 at (±0.115, 0.90, 0.255) + shine (§D2.2) ---
  const eyeGroups = {};
  const shines2 = [];
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const grp = new THREE.Group();
    grp.name = `eyeGrp${side}`;
    grp.position.copy(local(sx * 0.115, 0.9, 0.255));
    const bead = mesh(`eye${side}`, new THREE.SphereGeometry(0.045, 12, 9), goobyMat('eye'));
    grp.add(bead);
    const shine = mesh(`eyeShine${side}`, new THREE.SphereGeometry(0.015, 6, 4), goobyMat('eyeShine'));
    shine.position.set(0.012, 0.015, 0.03);
    grp.add(shine);
    // second, smaller shine — ecstatic "shine ×2" (§D2.5)
    const shine2 = mesh(`eyeShine2${side}`, new THREE.SphereGeometry(0.008, 6, 4), goobyMat('eyeShine'));
    shine2.position.set(-0.013, -0.012, 0.031);
    shine2.visible = false;
    grp.add(shine2);
    shines2.push(shine2);
    group.add(grp);
    eyeGroups[side] = grp;
  }

  // --- Eyelids: body-colored half-spheres r 0.052; lid value 0=open → 1.25=closed ---
  const lids = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const lid = mesh(
      `eyelid${side}`,
      new THREE.SphereGeometry(0.058, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.55),
      goobyMat('body')
    );
    lid.position.copy(local(sx * 0.115, 0.902, 0.252));
    lid.rotation.x = LID_ROT_OPEN;
    group.add(lid);
    lids[side] = lid;
  }

  // --- Spiral pupil overlays (dizzy, §D2.5) ---
  const spiralMat = new THREE.MeshBasicMaterial({ map: getSpiralTexture(), transparent: true });
  const spirals = [];
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const sp = mesh(`spiral${side}`, new THREE.CircleGeometry(0.05, 20), spiralMat);
    sp.position.copy(local(sx * 0.115, 0.9, 0.255)).add(new THREE.Vector3(0, 0, 0.052));
    sp.visible = false;
    group.add(sp);
    spirals.push(sp);
  }

  // --- Nose: flattened sphere r 0.035 scaled (1, 0.8, 0.6) at (0, 0.845, 0.285),
  // nudged out so the little triangle-button nose pops off the muzzle ---
  const nose = mesh('nose', new THREE.SphereGeometry(0.035, 12, 9), goobyMat('nose'));
  nose.scale.set(1.15, 0.85, 0.6);
  nose.position.copy(local(0, 0.845, 0.295));
  group.add(nose);

  // --- BUCK TEETH: 2 white rounded boxes 0.030×0.038×0.012 under the nose,
  // hanging in FRONT of the mouth line (it's a rabbit — they must read!) ---
  const teethGrp = new THREE.Group();
  teethGrp.name = 'teethGrp';
  const toothGeo = new THREE.BoxGeometry(0.03, 0.038, 0.012, 1, 1, 1);
  ownedGeos.push(toothGeo);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const tooth = new THREE.Mesh(toothGeo, goobyMat('tooth'));
    tooth.name = `tooth${side}`;
    tooth.position.set(sx * 0.0165, 0, 0);
    tooth.rotation.z = -sx * 0.045; // tiny inward tilt, cartoony
    teethGrp.add(tooth);
  }
  teethGrp.position.copy(local(0, 0.788, surfaceZ(0, 0.788, 0.022)));
  teethGrp.rotation.x = 0.2;
  group.add(teethGrp);

  // --- Cheeks: CircleGeometry r 0.05 at (±0.17, 0.83), flush on the head surface ---
  const cheeks = [];
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const cheek = mesh(`cheek${side}`, new THREE.CircleGeometry(0.05, 18), goobyMat('cheek'));
    const pos = local(sx * 0.17, 0.83, surfaceZ(sx * 0.17, 0.83));
    cheek.position.copy(pos);
    // face outward along the (scaled) sphere normal
    const n = new THREE.Vector3(
      (pos.x - HEAD.cx) / HEAD.rx ** 2,
      (pos.y - (HEAD.cy - HEAD_PIVOT_Y)) / HEAD.ry ** 2,
      (pos.z - HEAD.cz) / HEAD.rz ** 2
    ).normalize();
    cheek.lookAt(pos.clone().add(n));
    group.add(cheek);
    cheeks.push(cheek);
  }

  // --- Mouth: 5 pre-built ShapeGeometry meshes toggled by visibility (§D2.2) ---
  const mouthAnchor = new THREE.Group();
  mouthAnchor.name = 'mouthAnchor';
  mouthAnchor.position.copy(local(0, 0.748, surfaceZ(0, 0.748, 0.014)));
  mouthAnchor.rotation.x = 0.28; // follow the downward face slope
  group.add(mouthAnchor);

  /** @type {Record<string, THREE.Mesh>} */
  const mouths = {};
  const mouthDefs = {
    smile: centeredShapeGeo(arcBandShape(0.075, 0.02, Math.PI + 0.55, Math.PI * 2 - 0.55), 12),
    open: centeredShapeGeo(ellipseShape(0.04, 0.05), 12),
    frown: centeredShapeGeo(arcBandShape(0.075, 0.018, 0.65, Math.PI - 0.65), 12),
    flat: centeredShapeGeo(capsule2dShape(0.085, 0.02), 8),
    chew: centeredShapeGeo(ellipseShape(0.06, 0.028), 12),
  };
  for (const [id, geo] of Object.entries(mouthDefs)) {
    const m = mesh(`mouth-${id}`, geo, goobyMat('mouth'));
    m.visible = false;
    mouthAnchor.add(m);
    mouths[id] = m;
  }
  mouths.smile.visible = true;

  // --- Drool drop (hungry, §C1 / §D2.5) ---
  const drool = mesh('drool', new THREE.SphereGeometry(0.02, 8, 6), goobyMat('drool'));
  drool.scale.set(0.7, 1.25, 0.7);
  drool.position.copy(local(0.055, 0.752, surfaceZ(0.055, 0.752, 0)));
  drool.visible = false;
  group.add(drool);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let faceDef = FACES.neutral;
  let clockSec = 0;
  let lidCurrent = faceDef.lids;
  let pupilX = 0;
  let pupilY = 0;
  /** @type {boolean|null} */
  let droolOverride = null;
  /** @type {boolean|null} */
  let spiralOverride = null;

  let blinkIn = BLINK_MIN_SEC + Math.random() * (BLINK_MAX_SEC - BLINK_MIN_SEC);
  let blinkT = -1; // <0 = not blinking
  let yawnIn = 0;
  let yawnT = -1;

  function blinkEnvelope() {
    if (blinkT < 0) return 0;
    const closeEnd = BLINK_CLOSE_SEC;
    const holdEnd = closeEnd + BLINK_HOLD_SEC;
    const openEnd = holdEnd + BLINK_OPEN_SEC;
    if (blinkT < closeEnd) return blinkT / closeEnd;
    if (blinkT < holdEnd) return 1;
    if (blinkT < openEnd) return 1 - (blinkT - holdEnd) / BLINK_OPEN_SEC;
    return 0;
  }

  function yawnEnvelope() {
    if (yawnT < 0) return 0;
    const t = yawnT / YAWN_SEC;
    if (t >= 1) return 0;
    // ease in, hold wide, ease out
    if (t < 0.3) return t / 0.3;
    if (t < 0.75) return 1;
    return 1 - (t - 0.75) / 0.25;
  }

  return {
    group,

    /** Swap the active emotion face (§D2.5 table entry from emotions.FACES). */
    applyEmotion(def) {
      faceDef = def;
      shines2[0].visible = shines2[1].visible = def.shine2;
      yawnIn = def.yawnEverySec > 0 ? def.yawnEverySec * (0.5 + Math.random() * 0.7) : 0;
      yawnT = -1;
    },

    /** Pupil offsets −1..1 (lookAt tracking, §D2.3). */
    setPupil(x, y) {
      pupilX = Math.max(-1, Math.min(1, x));
      pupilY = Math.max(-1, Math.min(1, y));
    },

    /** Force the drool drop on/off (null = follow the emotion face). */
    setDroolOverride(on) {
      droolOverride = on;
    },

    /** Force spiral pupils on/off (null = follow the emotion face). */
    setSpiralOverride(on) {
      spiralOverride = on;
    },

    /** Trigger an immediate blink. */
    blinkNow() {
      if (blinkT < 0) blinkT = 0;
    },

    /**
     * Per-frame face update.
     * @param {number} dt seconds
     * @param {{mouth?: string|null, mouthScale?: number, mouthOpen?: number,
     *          lids?: number|null, cheek?: number}} pose resolved rig pose (clips → §D2.4)
     */
    update(dt, pose) {
      clockSec += dt;

      // --- auto-blink every 2.5–5 s (§D2.3); slow lazy blinks when sleepy ---
      const speed = faceDef.slowBlink ? 0.45 : 1;
      if (blinkT >= 0) {
        blinkT += dt * speed;
        if (blinkT > BLINK_CLOSE_SEC + BLINK_HOLD_SEC + BLINK_OPEN_SEC) blinkT = -1;
      } else {
        blinkIn -= dt;
        if (blinkIn <= 0) {
          blinkT = 0;
          blinkIn = BLINK_MIN_SEC + Math.random() * (BLINK_MAX_SEC - BLINK_MIN_SEC);
        }
      }

      // --- sleepy yawns every ~8 s (§D2.5) ---
      if (faceDef.yawnEverySec > 0) {
        if (yawnT >= 0) {
          yawnT += dt;
          if (yawnT > YAWN_SEC) {
            yawnT = -1;
            yawnIn = faceDef.yawnEverySec * (0.7 + Math.random() * 0.6);
          }
        } else {
          yawnIn -= dt;
          if (yawnIn <= 0) yawnT = 0;
        }
      }

      // --- eyelids: emotion base vs clip override vs blink vs yawn squint ---
      const yawn = yawnEnvelope();
      const base = Math.max(pose.lids ?? 0, faceDef.lids, yawn * 0.9);
      const lidTarget = Math.max(base, blinkEnvelope() * LID_CLOSED);
      lidCurrent += (lidTarget - lidCurrent) * Math.min(1, dt * 26);
      const lidRot = LID_ROT_OPEN + (lidCurrent / LID_CLOSED) * (LID_ROT_CLOSED - LID_ROT_OPEN);
      lids.L.rotation.x = lidRot;
      lids.R.rotation.x = lidRot;

      // --- mouth: yawn/clip mouthOpen wins, then clip mouth id, then emotion ---
      const openAmt = Math.max(pose.mouthOpen ?? 0, yawn);
      const mouthId = openAmt > 0.05 ? 'open' : (pose.mouth ?? faceDef.mouth);
      const mouthScale = openAmt > 0.05
        ? 0.45 + 0.85 * openAmt
        : faceDef.mouthScale * (pose.mouthScale ?? 1);
      for (const [id, m] of Object.entries(mouths)) m.visible = id === mouthId;
      const active = mouths[mouthId] ?? mouths.smile;
      active.scale.setScalar(Math.max(0.05, mouthScale));

      // --- pupils track the look target (§D2.3 lookAt) ---
      const px = pupilX * 0.02;
      const py = pupilY * 0.014;
      eyeGroups.L.position.x = -0.115 + px;
      eyeGroups.R.position.x = 0.115 + px;
      eyeGroups.L.position.y = eyeGroups.R.position.y = 0.9 - HEAD_PIVOT_Y + py;

      // --- cheeks: blush pulse (emotion) × clip pulse ---
      const blushPulse = faceDef.blush ? 1 + 0.07 * Math.sin(clockSec * 3.2) : 1;
      const cheekScale = (pose.cheek ?? 1) * blushPulse;
      cheeks[0].scale.setScalar(cheekScale);
      cheeks[1].scale.setScalar(cheekScale);

      // --- spiral pupils spin while visible (dizzy) ---
      const spiralOn = spiralOverride ?? faceDef.spiral;
      for (const sp of spirals) {
        sp.visible = spiralOn;
        if (spiralOn) sp.rotation.z -= dt * 7;
      }

      // --- drool bob ---
      const droolOn = droolOverride ?? faceDef.drool;
      drool.visible = droolOn;
      if (droolOn) {
        const bob = 1 + 0.25 * Math.max(0, Math.sin(clockSec * 2.4));
        drool.scale.set(0.7, 1.25 * bob, 0.7);
        drool.position.y = local(0, 0.752, 0).y - (bob - 1) * 0.02;
      }
    },

    dispose() {
      for (const geo of ownedGeos) geo.dispose();
      spiralMat.dispose(); // texture is shared app-wide
      headGrp.remove(group);
    },
  };
}
