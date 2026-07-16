// Gooby — the soul of the game (§D2, binding). 100% procedural: grouped
// primitives, no bones; animation happens on group pivots via the clip player
// (goobyAnims.js) layered over the emotion base pose (emotions.js FACES).
//
// Geometry recipe §D2.2, palette §D2.1 (gfx/materials.js), public API §D2.3.
// The build uses the recipe's coordinate numbers ("recipe space", pear body
// 0.78 tall) inside an inner rig group that is uniformly scaled so the total
// height (ears up) ≈ 1.05 world units (§D2: 1 unit ≈ 1 m).

import * as THREE from 'three';
import { goobyMat } from '../gfx/materials.js';
import { createBlobShadow } from '../gfx/blobShadow.js';
import { createGoobyFace } from './goobyFace.js';
import { createClipPlayer, restPose, CLIPS } from './goobyAnims.js';
import { FACES, EMOTION_IDS } from './emotions.js';

/** Recipe-space height to ear tips (body 0.78 + head + ears, incl. head 1.08×). */
const RECIPE_HEIGHT = 1.61;
const TARGET_HEIGHT = 1.05;
const RIG_SCALE = TARGET_HEIGHT / RECIPE_HEIGHT;

/** lookAt head clamp: ±25° (§D2.3). */
const LOOK_CLAMP = (25 * Math.PI) / 180;

/** §D2.2 pear profile control points (x = radius, y = height). */
const PEAR_PROFILE = [
  [0, 0], [0.3, 0.02], [0.43, 0.2], [0.46, 0.4],
  [0.4, 0.58], [0.3, 0.7], [0.18, 0.76], [0, 0.78],
];

/** Smooth the profile through the §D2.2 control points (CatmullRom, 26 samples). */
function pearPoints() {
  const curve = new THREE.CatmullRomCurve3(
    PEAR_PROFILE.map(([x, y]) => new THREE.Vector3(x, y, 0))
  );
  const pts = [];
  const N = 26;
  for (let i = 0; i <= N; i += 1) {
    const p = curve.getPoint(i / N);
    pts.push(new THREE.Vector2(Math.max(0, p.x), p.y));
  }
  return pts;
}

/**
 * Build Gooby (§D2.3 contract).
 *
 * @param {{particles?: {emit: Function}}} [opts]
 *   particles: optional gfx/particles.js handle — when present Gooby emits his
 *   own state particles (Zzz while sleeping, stink flies, chew crumbs, dizzy
 *   stars). The caller still owns particles.update(dt)/dispose().
 * @returns {{
 *   group: THREE.Group,
 *   update: (dt: number) => void,
 *   setEmotion: (id: string) => void,
 *   play: (clip: string, opts?: {loop?: boolean|'hold', speed?: number, dir?: {x:number,z:number}}) => Promise<void>,
 *   stop: (clip?: string) => void,
 *   lookAt: (worldPos: THREE.Vector3|{x:number,y:number,z:number}|null) => void,
 *   regionAt: (hit: {object?: THREE.Object3D}|THREE.Object3D|null) => ('head'|'belly'|'feet'|null),
 *   anchors: {hat: THREE.Object3D, glasses: THREE.Object3D, neck: THREE.Object3D, handL: THREE.Object3D, handR: THREE.Object3D},
 *   setWet: (on: boolean) => void,
 *   setStink: (on: boolean) => void,
 *   setDrool: (on: boolean) => void,
 *   emotion: () => string,
 *   isPlaying: (clip: string) => boolean,
 *   triangleCount: () => number,
 *   dispose: () => void,
 * }}
 */
export function createGooby(opts = {}) {
  const particles = opts.particles ?? null;

  const group = new THREE.Group();
  group.name = 'gooby';

  const rig = new THREE.Group();
  rig.name = 'rig';
  rig.scale.setScalar(RIG_SCALE);
  group.add(rig);

  // squash pivot at ground level — squash/rot/pos channels land here
  const squashGrp = new THREE.Group();
  squashGrp.name = 'squash';
  rig.add(squashGrp);

  /** @type {THREE.BufferGeometry[]} */
  const ownedGeos = [];
  /** @type {THREE.Material[]} */
  const ownedMats = [];
  function mesh(name, geo, mat) {
    ownedGeos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    return m;
  }

  // --- Body: LatheGeometry pear, widest at the hips (THE star: FAT) ---
  // Own clone of the body material so setWet can animate roughness (§D2.3).
  const bodyMat = goobyMat('body').clone();
  bodyMat.userData.shared = false;
  ownedMats.push(bodyMat);

  const body = mesh('body', new THREE.LatheGeometry(pearPoints(), 24), bodyMat);
  body.userData.region = 'belly';
  squashGrp.add(body);

  // --- Belly patch: sphere r 0.30 scaled (1, 1.05, 0.42), front of the tummy ---
  const belly = mesh('belly', new THREE.SphereGeometry(0.3, 16, 12), goobyMat('belly'));
  belly.scale.set(1, 1.05, 0.42);
  belly.position.set(0, 0.32, 0.34); // recipe z 0.27 pushed out so the patch shows
  belly.userData.region = 'belly';
  squashGrp.add(belly);

  // --- Tail: sphere r 0.09 at (0, 0.18, −0.40) ---
  const tail = mesh('tail', new THREE.SphereGeometry(0.09, 10, 7), goobyMat('belly'));
  tail.position.set(0, 0.18, -0.42);
  tail.userData.region = 'belly';
  squashGrp.add(tail);

  // --- Head: sphere r 0.30 scaled (1.05, 0.92, 0.95) at (0, 0.86, 0.02) ---
  const headGrp = new THREE.Group();
  headGrp.name = 'headGrp';
  headGrp.position.set(0, 0.685, 0); // §D2.2 head pivot (sunk a touch — no neck)
  headGrp.scale.setScalar(1.08); // cuteness pass: slightly bigger noggin
  headGrp.userData.region = 'head';
  squashGrp.add(headGrp);

  const head = mesh('head', new THREE.SphereGeometry(0.3, 22, 16), bodyMat);
  head.scale.set(1.05, 0.92, 0.95);
  head.position.set(0, 0.16, 0.02); // body y 0.86
  headGrp.add(head);

  // --- Ears: pivots on the head top at (±0.13, 1.06, 0), tilt ±10° ---
  const EAR_TILT = 0.175;
  const earGrps = {};
  const earOuterGeo = new THREE.CapsuleGeometry(0.085, 0.34, 3, 10);
  const earInnerGeo = new THREE.CapsuleGeometry(0.055, 0.26, 3, 8);
  ownedGeos.push(earOuterGeo, earInnerGeo);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const grp = new THREE.Group();
    grp.name = `earGrp${side}`;
    grp.position.set(sx * 0.13, 1.06 - 0.7, 0);
    const outer = new THREE.Mesh(earOuterGeo, bodyMat);
    outer.name = `ear${side}`;
    outer.position.y = 0.24;
    grp.add(outer);
    const inner = new THREE.Mesh(earInnerGeo, goobyMat('earInner'));
    inner.name = `earInner${side}`;
    inner.scale.set(0.72, 1, 0.5); // flattened
    inner.position.set(0, 0.26, 0.063); // pokes out of the outer capsule front
    grp.add(inner);
    headGrp.add(grp);
    earGrps[side] = grp;
  }

  // --- Face (eyes/lids/nose/teeth/cheeks/mouths/spirals/drool) ---
  const face = createGoobyFace(headGrp);

  // --- Arms: capsules r 0.08 × 0.18, shoulder pivots (±0.36, 0.52, 0.05) ---
  const ARM_REST_FWD = 0.5; // resting on the belly…
  const ARM_REST_OUT = 0.38; // …with stubby paws peeking out at the sides
  const armGrps = {};
  const armGeo = new THREE.CapsuleGeometry(0.08, 0.18, 3, 8);
  ownedGeos.push(armGeo);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const grp = new THREE.Group();
    grp.name = `armGrp${side}`;
    grp.position.set(sx * 0.36, 0.52, 0.05);
    grp.userData.region = 'belly';
    const arm = new THREE.Mesh(armGeo, bodyMat);
    arm.name = `arm${side}`;
    arm.position.y = -0.12;
    grp.add(arm);
    squashGrp.add(grp);
    armGrps[side] = grp;
  }

  // --- Feet: flattened capsules r 0.11 × 0.22 splayed ±18° at (±0.16, 0.05, 0.18) ---
  const FOOT_SPLAY = (18 * Math.PI) / 180;
  const footGrps = {};
  const footGeo = new THREE.CapsuleGeometry(0.11, 0.22, 3, 10);
  const padGeo = new THREE.CircleGeometry(0.075, 14);
  ownedGeos.push(footGeo, padGeo);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const grp = new THREE.Group();
    grp.name = `footGrp${side}`;
    grp.position.set(sx * 0.16, 0.05, 0.18);
    grp.rotation.y = -sx * FOOT_SPLAY;
    grp.userData.region = 'feet';
    const foot = new THREE.Mesh(footGeo, bodyMat);
    foot.name = `foot${side}`;
    foot.rotation.x = Math.PI / 2; // lie forward
    foot.scale.set(0.85, 1, 0.5); // flattened
    foot.position.z = 0.08;
    grp.add(foot);
    const pad = new THREE.Mesh(padGeo, goobyMat('pawPad'));
    pad.name = `pad${side}`;
    pad.rotation.x = -Math.PI / 2; // PAW_PAD oval underneath
    pad.scale.set(0.8, 1.35, 1);
    pad.position.set(0, -0.052, 0.14);
    grp.add(pad);
    squashGrp.add(grp);
    footGrps[side] = grp;
  }

  // --- Blob shadow (world scale, under the root — §D2.2) ---
  const blob = createBlobShadow({ radius: 0.4 });
  group.add(blob.mesh);

  // --- Anchors (§D2.3): real, well-positioned attach points for G12 outfits ---
  const anchors = {};
  function anchor(name, parent, x, y, z) {
    const a = new THREE.Object3D();
    a.name = `anchor-${name}`;
    a.position.set(x, y, z);
    parent.add(a);
    anchors[name] = a;
    return a;
  }
  anchor('hat', headGrp, 0, 0.44, 0.02); // head top, between the ears
  anchor('glasses', headGrp, 0, 0.2, 0.3); // eye height, front of face
  anchor('neck', squashGrp, 0, 0.62, 0.06); // head/body seam (scarves, bowties)
  anchor('handL', armGrps.L, 0, -0.26, 0); // paw tips
  anchor('handR', armGrps.R, 0, -0.26, 0);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const player = createClipPlayer();
  let clockSec = 0;
  let emotionId = 'neutral';
  let faceDef = FACES.neutral;
  face.applyEmotion(faceDef);

  // smoothed emotion pose (ears/head/arms lerp toward the FACES targets)
  const emo = { earL: FACES.neutral.earDroopL, earR: FACES.neutral.earDroopR, headPitch: 0, armsHang: 0 };

  /** @type {THREE.Vector3|null} */
  let lookTarget = null;
  let lookYaw = 0;
  let lookPitch = 0;

  let wet = false;
  let wetDroop = 0;
  let stink = false;
  let stinkTimer = 0;
  let rumbleT = -1; // hungry belly-rumble envelope
  let rumbleIn = 0;

  // scratch objects (no per-frame allocation)
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  function headWorld(out, yOffset = 0.32) {
    headGrp.getWorldPosition(out);
    out.y += yOffset * RIG_SCALE;
    return out;
  }

  function onClipEvent(name) {
    switch (name) {
      case 'zzz':
        if (particles) particles.emit('zzz', headWorld(tmpV, 0.42), { count: 1 });
        break;
      case 'chew':
        if (particles) particles.emit('crumbs', headWorld(tmpV, -0.05).add(tmpV2.set(0, 0, 0.2 * RIG_SCALE)), { count: 3 });
        break;
      case 'dizzyStart':
        face.setSpiralOverride(true);
        if (particles) particles.emit('dizzyStars', headWorld(tmpV, 0.45));
        break;
      case 'dizzyEnd':
        face.setSpiralOverride(null);
        break;
      default:
        break; // 'land' etc. — scene-level juice is the caller's job
    }
  }

  const api = {
    group,

    /** @returns {string} current emotion id */
    emotion: () => emotionId,

    /**
     * Set the active emotion face (§D2.5). Ears/head/arms ease over ~0.25 s.
     * @param {string} id one of EMOTION_IDS
     */
    setEmotion(id) {
      if (!EMOTION_IDS.includes(id)) {
        console.warn(`[gooby] unknown emotion '${id}'`);
        return;
      }
      emotionId = id;
      faceDef = FACES[id];
      face.applyEmotion(faceDef);
      rumbleIn = faceDef.rumbleEverySec > 0 ? 1.2 : 0;
      rumbleT = -1;
    },

    /**
     * Play a clip (§D2.4). Resolves when the clip ends (loop/hold: on stop()).
     * @param {string} clip @param {{loop?: boolean|'hold', speed?: number, dir?: {x:number,z:number}}} [playOpts]
     */
    play(clip, playOpts = {}) {
      return player.play(clip, playOpts);
    },

    /** Stop a clip (or all clips when omitted). */
    stop(clip) {
      player.stop(clip);
    },

    /** @param {string} clip @returns {boolean} */
    isPlaying(clip) {
      return player.isPlaying(clip);
    },

    /**
     * Pupils + head track a world point, clamped ±25° (§D2.3). null = release.
     * @param {THREE.Vector3|{x:number,y:number,z:number}|null} worldPos
     */
    lookAt(worldPos) {
      if (worldPos == null) {
        lookTarget = null;
      } else {
        lookTarget = lookTarget ?? new THREE.Vector3();
        lookTarget.set(worldPos.x, worldPos.y, worldPos.z);
      }
    },

    /**
     * Map a raycast hit to a touch region (§D2.2/§D2.3).
     * @param {{object?: THREE.Object3D}|THREE.Object3D|null} hit intersection or object
     * @returns {'head'|'belly'|'feet'|null}
     */
    regionAt(hit) {
      let obj = hit?.object ?? (hit?.isObject3D ? hit : null);
      while (obj) {
        if (obj.userData?.region) return obj.userData.region;
        if (obj === group) return null;
        obj = obj.parent;
      }
      return null;
    },

    anchors,

    /** Wet look after a bath (§C3): sheeny body + heavy droopy ears. */
    setWet(on) {
      wet = !!on;
    },

    /** Stink flies orbit while on (§C1 hygiene < 15). Needs opts.particles. */
    setStink(on) {
      stink = !!on;
      stinkTimer = 0;
    },

    /** Force the drool drop (hunger visual, §C1). */
    setDrool(on) {
      face.setDroolOverride(on ? true : null);
    },

    /** Sum of render triangles in the whole rig (≤ 6000 — §D2.2 budget). */
    triangleCount() {
      let tris = 0;
      group.traverse((obj) => {
        const geo = obj.geometry;
        if (!geo) return;
        tris += (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
      });
      return Math.round(tris);
    },

    /**
     * Drive clips, blink, look tracking, state particles (§D2.3).
     * @param {number} dt seconds
     */
    update(dt) {
      clockSec += dt;

      // --- clips over the rest pose; auto-idle keeps him alive ---
      const pose = restPose();
      player.update(dt, pose, { event: onClipEvent });
      if (!player.activeIds().some((id) => !CLIPS[id].overlay)) {
        player.play('idle');
        player.update(0, pose, { event: onClipEvent });
      }

      // --- emotion base pose smoothing (~0.25 s ease) ---
      const k = Math.min(1, dt * 9);
      emo.earL += (faceDef.earDroopL - emo.earL) * k;
      emo.earR += (faceDef.earDroopR - emo.earR) * k;
      emo.headPitch += (faceDef.headPitch - emo.headPitch) * k;
      emo.armsHang += (faceDef.armsHang - emo.armsHang) * k;
      wetDroop += ((wet ? 0.85 : 0) - wetDroop) * Math.min(1, dt * 4);
      bodyMat.roughness += ((wet ? 0.28 : 0.65) - bodyMat.roughness) * Math.min(1, dt * 4);

      // --- ecstatic bouncy idle (§D2.5) ---
      if (faceDef.bounceIdle && player.isPlaying('idle')) {
        pose.posY += Math.abs(Math.sin(clockSec * 5.2)) * 0.025;
        pose.scaleY *= 1 + Math.sin(clockSec * 10.4) * 0.012;
      }

      // --- hungry belly rumble (§C1: wobble every ~20 s) ---
      if (faceDef.rumbleEverySec > 0) {
        if (rumbleT >= 0) {
          rumbleT += dt;
          if (rumbleT > 0.7) rumbleT = -1;
          else {
            const env = Math.sin((rumbleT / 0.7) * Math.PI);
            pose.scaleX *= 1 + Math.sin(rumbleT * 34) * 0.05 * env;
            pose.scaleZ *= 1 + Math.sin(rumbleT * 34 + 1.3) * 0.04 * env;
          }
        } else {
          rumbleIn -= dt;
          if (rumbleIn <= 0) {
            rumbleT = 0;
            rumbleIn = faceDef.rumbleEverySec * (0.85 + Math.random() * 0.3);
          }
        }
      }

      // --- lookAt: head + pupils toward the target, clamped ±25° (§D2.3) ---
      let targetYaw = 0;
      let targetPitch = 0;
      if (lookTarget) {
        headGrp.getWorldPosition(tmpV);
        tmpV2.copy(lookTarget).sub(tmpV);
        squashGrp.getWorldQuaternion(tmpQ);
        tmpV2.applyQuaternion(tmpQ.invert());
        const flat = Math.hypot(tmpV2.x, tmpV2.z);
        targetYaw = THREE.MathUtils.clamp(Math.atan2(tmpV2.x, tmpV2.z), -LOOK_CLAMP, LOOK_CLAMP);
        targetPitch = THREE.MathUtils.clamp(Math.atan2(-tmpV2.y, flat), -LOOK_CLAMP, LOOK_CLAMP);
      }
      const lk = Math.min(1, dt * 10);
      lookYaw += (targetYaw - lookYaw) * lk;
      lookPitch += (targetPitch - lookPitch) * lk;
      face.setPupil(lookYaw / LOOK_CLAMP, -lookPitch / LOOK_CLAMP);

      // --- write the pose onto the pivots ---
      squashGrp.scale.set(pose.scaleX, pose.scaleY, pose.scaleZ);
      squashGrp.position.set(pose.posX, pose.posY, pose.posZ);
      squashGrp.rotation.set(pose.rotX, pose.rotY, pose.rotZ);

      headGrp.rotation.set(
        emo.headPitch + pose.headPitch + lookPitch,
        pose.headYaw + lookYaw,
        pose.headRoll
      );

      const droopL = emo.earL + pose.earL + wetDroop;
      const droopR = emo.earR + pose.earR + wetDroop;
      earGrps.L.rotation.x = -droopL * 0.55;
      earGrps.L.rotation.z = EAR_TILT + Math.max(-0.1, droopL) * 0.8 + pose.earLRoll;
      earGrps.R.rotation.x = -droopR * 0.55;
      earGrps.R.rotation.z = -EAR_TILT - Math.max(-0.1, droopR) * 0.8 + pose.earRRoll;

      const rest = 1 - emo.armsHang;
      armGrps.L.rotation.x = -(ARM_REST_FWD * rest + pose.armL);
      armGrps.R.rotation.x = -(ARM_REST_FWD * rest + pose.armR);
      armGrps.L.rotation.z = -ARM_REST_OUT * rest - pose.armLRoll;
      armGrps.R.rotation.z = ARM_REST_OUT * rest + pose.armRRoll;

      footGrps.L.rotation.x = pose.footL;
      footGrps.R.rotation.x = pose.footR;

      face.update(dt, pose);

      // --- stink flies while stinky (§C1 hygiene visual) ---
      if (stink && particles) {
        stinkTimer -= dt;
        if (stinkTimer <= 0) {
          stinkTimer = 2.4;
          group.getWorldPosition(tmpV);
          tmpV.y += 0.55;
          particles.emit('stinkFlies', tmpV);
        }
      }

      // --- blob shadow follows the squash / hop height ---
      const air = Math.max(0, pose.posY) * RIG_SCALE;
      blob.setSquash(pose.scaleX * Math.max(0.45, 1 - air * 2.2));
    },

    /** Free everything this rig created (shared materials stay). */
    dispose() {
      player.stop();
      face.dispose();
      blob.dispose();
      for (const geo of ownedGeos) geo.dispose();
      for (const mat of ownedMats) mat.dispose();
      group.parent?.remove(group);
    },
  };

  return api;
}
