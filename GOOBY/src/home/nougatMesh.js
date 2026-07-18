// V3/G35 — „Nougatschleuse" procedural mesh (PLAN3 §C6.2, wired per §B7).
//
// A wall-mounted kitchen gag machine above the counter: hopper funnel +
// riveted chute + hand-crank + drip spout. Palette: copper #B87352, cream,
// chocolate. The STATIC body is merged into one vertex-colored geometry
// (≈ 150 tris, 1 draw call); the two ANIMATED parts (crank, globs) must stay
// separate meshes (they rotate/scale independently), and the §C6.2 food-kit
// `chocolate` bar GLB is glued on the hopper as the label (cached master
// clone — shares the pack's material/geometry).
//
// Animation is self-contained behind userData so the roomManager marked
// block only pumps `userData.update(dt)` from its update-hook:
//  - idle drip: a glossy glob sphere at the spout scales 0→0.04 every 7 s
//    then drops (§C6.2);
//  - `userData.playSequence({catchWorld, onGlob, onDone})`: the §C6.4 use
//    sequence — crank spins 720° (1.2 s), then a 0.18 m glossy glob (slight
//    squash) slides from the spout to `catchWorld` (0.6 s) → onGlob() fires
//    at the catch (interactions plays the chomp) → onDone() at the end.
//
// Owned by home/roomManager.js lifecycle: geometries/materials registered on
// the manager's `track` so dispose() sweeps them (§C2 ownership rules).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** §C6.2 palette + animation numbers (frozen, module-local per §E0.1-2). */
export const NOUGAT_MESH = Object.freeze({
  COPPER: '#B87352',
  CREAM: '#FBF1DE',
  CHOCOLATE: '#5C3A21',
  /** idle drip period (§C6.2: every 7 s) */
  DRIP_EVERY_SEC: 7,
  /** idle drip glob peak scale (§C6.2: 0→0.04) */
  DRIP_SCALE: 0.04,
  /** §C6.4 dispense glob: 0.18 m glossy sphere (radius 0.09) */
  GLOB_RADIUS: 0.09,
  /** crank spin: 720° over this long, then the glob slide */
  CRANK_SEC: 1.2,
  SLIDE_SEC: 0.6,
});

/**
 * Fill a BufferGeometry with a flat vertex color so the merged body renders
 * multicolored from ONE vertexColors material (1 draw call).
 * @param {THREE.BufferGeometry} geo
 * @param {string} hex
 * @returns {THREE.BufferGeometry} the same geometry
 */
function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Bake a transform into a geometry (so it can merge). */
function placed(geo, { at = [0, 0, 0], rot = [0, 0, 0], scale = null } = {}) {
  if (scale) geo.scale(scale[0], scale[1], scale[2]);
  if (rot[0]) geo.rotateX(rot[0]);
  if (rot[1]) geo.rotateY(rot[1]);
  if (rot[2]) geo.rotateZ(rot[2]);
  geo.translate(at[0], at[1], at[2]);
  return geo;
}

/**
 * Build the Nougatschleuse. Local origin = wall mount point (back plate
 * center); the machine reaches DOWN from it (spout at the bottom) and faces
 * +z (toward the camera, like every back-wall piece).
 *
 * @param {{geo: (g: THREE.BufferGeometry) => THREE.BufferGeometry,
 *   mat: (m: THREE.Material) => THREE.Material}} track roomManager resource
 *   tracker (dispose ownership)
 * @param {{getModel: (key: string) => THREE.Object3D}} [assets] for the
 *   §C6.2 food-kit `chocolate` label (skipped when unavailable)
 * @returns {THREE.Group}
 */
export function buildNougatschleuse(track, assets) {
  const grp = new THREE.Group();
  grp.name = 'fixture-nougatschleuse';

  const C = NOUGAT_MESH;

  // ---- static body: merged, vertex-colored, 1 draw call (§C6.2) ----
  const parts = [
    // wall mount plate
    tint(placed(new THREE.BoxGeometry(0.46, 0.62, 0.05), { at: [0, -0.06, 0.025] }), C.CREAM),
    // hopper funnel (inverted cone, wide mouth up)
    tint(
      placed(new THREE.ConeGeometry(0.17, 0.24, 10), { rot: [Math.PI, 0, 0], at: [0, 0.13, 0.16] }),
      C.COPPER
    ),
    // hopper mouth rim
    tint(
      placed(new THREE.CylinderGeometry(0.18, 0.18, 0.035, 10, 1, true), { at: [0, 0.26, 0.16] }),
      C.CHOCOLATE
    ),
    // riveted chute: angled duct from the funnel tip down to the spout
    tint(
      placed(new THREE.BoxGeometry(0.11, 0.3, 0.09), { rot: [0.42, 0, 0], at: [0, -0.14, 0.11] }),
      C.CREAM
    ),
    // rivets (4 tiny 45°-turned cubes down the chute sides)
    ...[-1, 1].flatMap((sx) =>
      [-0.06, -0.22].map((y) =>
        tint(
          placed(new THREE.BoxGeometry(0.022, 0.022, 0.022), {
            rot: [0, Math.PI / 4, Math.PI / 4],
            at: [sx * 0.062, y, 0.13 + (y + 0.14) * -0.44],
          }),
          C.COPPER
        )
      )
    ),
    // drip spout (chocolate nozzle at the chute's bottom end)
    tint(
      placed(new THREE.CylinderGeometry(0.028, 0.035, 0.07, 8), { at: [0, -0.315, 0.185] }),
      C.CHOCOLATE
    ),
  ];
  const bodyGeo = track.geo(mergeGeometries(parts, false));
  for (const p of parts) p.dispose(); // merged copy owns the data now
  const bodyMat = track.mat(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 })
  );
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = 'nougat-body';
  grp.add(body);

  // ---- hand-crank (separate mesh — it spins 720° per §C6.4) ----
  const crankParts = [
    // axle sticking out of the machine's right side
    tint(placed(new THREE.CylinderGeometry(0.018, 0.018, 0.09, 6), { rot: [0, 0, Math.PI / 2] }), C.COPPER),
    // arm
    tint(placed(new THREE.BoxGeometry(0.025, 0.13, 0.025), { at: [0.05, 0.05, 0] }), C.COPPER),
    // knob
    tint(placed(new THREE.BoxGeometry(0.045, 0.045, 0.045), { at: [0.075, 0.115, 0] }), C.CHOCOLATE),
  ];
  const crankGeo = track.geo(mergeGeometries(crankParts, false));
  for (const p of crankParts) p.dispose();
  const crank = new THREE.Mesh(crankGeo, bodyMat);
  crank.name = 'nougat-crank';
  crank.position.set(0.13, -0.1, 0.11); // chute's right flank
  grp.add(crank);

  // ---- glossy chocolate globs (idle drip + §C6.4 dispense) ----
  const globMat = track.mat(
    new THREE.MeshStandardMaterial({ color: C.CHOCOLATE, roughness: 0.15, metalness: 0.05 })
  );
  const spoutTip = new THREE.Vector3(0, -0.36, 0.185);

  const dripGlob = new THREE.Mesh(track.geo(new THREE.SphereGeometry(1, 8, 6)), globMat);
  dripGlob.name = 'nougat-dripGlob';
  dripGlob.position.copy(spoutTip);
  dripGlob.scale.setScalar(0.0001);
  grp.add(dripGlob);

  const glob = new THREE.Mesh(track.geo(new THREE.SphereGeometry(C.GLOB_RADIUS, 10, 8)), globMat);
  glob.name = 'nougat-glob';
  glob.visible = false;
  grp.add(glob);

  // ---- §C6.2 label: food-kit chocolate bar glued on the hopper front ----
  if (assets?.getModel) {
    const label = assets.getModel('food-kit/chocolate');
    const box = new THREE.Box3().setFromObject(label);
    const size = box.getSize(new THREE.Vector3());
    const s = 0.16 / Math.max(size.x, size.y, size.z, 0.001);
    label.scale.setScalar(s);
    box.setFromObject(label);
    const center = box.getCenter(new THREE.Vector3());
    label.position.sub(center); // recenter, then place flat on the funnel face
    const holder = new THREE.Group();
    holder.name = 'nougat-label';
    holder.add(label);
    holder.position.set(0, 0.1, 0.27);
    holder.rotation.x = 0.32; // lie against the funnel slope
    grp.add(holder);
  }

  // ---- animation state (pumped by roomManager's update hook) ----
  let dripT = C.DRIP_EVERY_SEC - 1.5; // first drip shortly after install
  /** @type {{t: number, catchLocal: THREE.Vector3, onGlob?: Function, onDone?: Function}|null} */
  let seq = null;

  grp.userData.update = (dt) => {
    // idle drip (§C6.2): grow 0→0.04 over 0.9 s, then drop+shrink 0.4 s
    dripT += dt;
    const cycle = dripT % C.DRIP_EVERY_SEC;
    if (cycle < 0.9) {
      dripGlob.position.copy(spoutTip);
      dripGlob.scale.setScalar(Math.max(0.0001, (cycle / 0.9) * C.DRIP_SCALE));
    } else if (cycle < 1.3) {
      const k = (cycle - 0.9) / 0.4;
      dripGlob.position.set(spoutTip.x, spoutTip.y - k * 0.08, spoutTip.z);
      dripGlob.scale.setScalar(Math.max(0.0001, (1 - k) * C.DRIP_SCALE));
    } else {
      dripGlob.scale.setScalar(0.0001);
    }

    // §C6.4 use sequence
    if (seq) {
      seq.t += dt;
      if (seq.t <= C.CRANK_SEC) {
        // crank spins 720° (2 turns), ease-in-out
        const u = seq.t / C.CRANK_SEC;
        const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        crank.rotation.x = e * Math.PI * 4;
      } else if (seq.t <= C.CRANK_SEC + C.SLIDE_SEC) {
        crank.rotation.x = 0; // rest pose after the 2 full turns
        const u = (seq.t - C.CRANK_SEC) / C.SLIDE_SEC;
        glob.visible = true;
        glob.position.lerpVectors(spoutTip, seq.catchLocal, u * u); // gravity-ish
        glob.scale.set(1, 1 - 0.18 * Math.sin(u * Math.PI), 1); // slight squash
      } else {
        glob.visible = false;
        const { onGlob, onDone } = seq;
        seq = null;
        try {
          onGlob?.();
          onDone?.();
        } catch (err) {
          console.warn('[nougatMesh] sequence callback error:', err);
        }
      }
    }
  };

  /**
   * Run the §C6.4 crank+glob dispense (≈ 1.8 s of the 2.8 s budget — the
   * waddle before it is interactions' moveGooby).
   * @param {{catchWorld?: {x: number, y: number, z: number},
   *   onGlob?: () => void, onDone?: () => void}} [opts]
   */
  grp.userData.playSequence = (opts = {}) => {
    const catchLocal = opts.catchWorld
      ? grp.worldToLocal(new THREE.Vector3(opts.catchWorld.x, opts.catchWorld.y, opts.catchWorld.z))
      : new THREE.Vector3(0, -0.62, 0.3);
    seq = { t: 0, catchLocal, onGlob: opts.onGlob, onDone: opts.onDone };
  };

  /** True while the crank+glob sequence is running. */
  grp.userData.isBusy = () => seq != null;

  return grp;
}
