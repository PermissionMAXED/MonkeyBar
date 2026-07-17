// Vet clinic + landmark dressing (V2/G21, PLAN2 §C9.1/§C9.3): the three.js
// composition of the city's second destination and the six sticker
// landmarks. The PURE placement data (vet tile/route/parking, landmark
// anchors) lives in city/cityBuilder.js (`generateCityLayout(seed)` output —
// headlessly testable); this module consumes that layout and assembles the
// visuals inside minigames/games/cityDrive.js's buildCity pass:
//
//   buildVetClinic()       building-e is instanced via layout.buildings (west-
//                          facing, rotY −90°); here: procedural red-cross sign
//                          over the door, suburban tree-small ×2 flanking, the
//                          parking apron (same recipe as the shop) and the
//                          Dr. Hoppel counter bust (Gooby head recipe, grey
//                          palette, glasses — §C9.2's vet, visible from the
//                          parked car behind the vetPanel).
//   buildLandmarkDressing() procedural 2-tier fountain (block [5,5]),
//                          hexagonal park gazebo + nature trees ([5,2]) and
//                          the windmill café counter + awning ([6,5]; the
//                          minigolf-kit windmill ×2.2 itself is instanced via
//                          layout.buildings). skyTower ([2,5]) is fully
//                          instanced via layout.buildings.
//
// Every GLB used here is committed (test/assets.test.js §D5 text-scans this
// file for '<pack>/<file>' literals): city-kit-commercial/building-e,
// city-kit-suburban/tree-small, minigolf-kit/windmill,
// city-kit-commercial/detail-awning, nature-kit/tree_default.
//
// Perf (§A2.3): everything below is plain meshes with shared materials —
// ≈ 20 extra draw calls on top of the instanced city, verified ≤ 180 total.

import * as THREE from 'three';
import { DRIVE_TUNING } from '../data/constants.js';

const T = DRIVE_TUNING;

/** GLB keys this module needs preloaded (cityDrive adds them to assetKeys). */
export const VET_CLINIC_ASSET_KEYS = Object.freeze([
  'city-kit-commercial/building-e',
  'city-kit-suburban/tree-small',
  'minigolf-kit/windmill',
  'city-kit-commercial/detail-awning',
  'nature-kit/tree_default',
]);

/** Palette (§C9: red cross #E85D5D binding; grey Dr. Hoppel = ash tones). */
const COLORS = Object.freeze({
  CROSS: '#E85D5D',
  SIGN_BOARD: '#FFFFFF',
  APRON: '#6b6f76',
  COUNTER: '#8a6248',
  FUR: '#B9B4AE',
  FUR_LIGHT: '#E8E4DE',
  EAR_INNER: '#E0A2B4',
  NOSE: '#E88BA0',
  GLASSES: '#4A3B36',
  STONE: '#cfd4da',
  WATER: '#7FC8E8',
  GAZEBO_WOOD: '#c9a37c',
  GAZEBO_ROOF: '#8fc1b5',
});

/** @param {string} color @returns {THREE.MeshStandardMaterial} */
const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });

/**
 * Dr. Hoppel — procedural grey rabbit bust on the clinic counter (§C9.2;
 * reuses the Gooby head recipe: sphere head + capsule ears + button eyes,
 * grey palette, plus round glasses). Cartoon-oversized so he reads from the
 * chase cam / parked car.
 * @returns {THREE.Group} bust group (~2.4 m tall incl. counter)
 */
export function createDrHoppelBust() {
  const g = new THREE.Group();
  g.name = 'drHoppel';

  const fur = mat(COLORS.FUR);
  const furLight = mat(COLORS.FUR_LIGHT);
  const dark = mat(COLORS.GLASSES);

  // reception counter
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.1), mat(COLORS.COUNTER));
  counter.position.y = 0.55;
  g.add(counter);

  // head (Gooby recipe: squashed sphere) + muzzle patch
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 16), fur);
  head.scale.set(1, 0.92, 0.95);
  head.position.y = 1.72;
  g.add(head);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), furLight);
  muzzle.scale.set(1.15, 0.8, 0.7);
  muzzle.position.set(0, 1.6, 0.42);
  g.add(muzzle);

  // ears: outer capsules + inner-ear inlays
  const earGeo = new THREE.CapsuleGeometry(0.16, 0.62, 4, 10);
  const innerGeo = new THREE.CapsuleGeometry(0.075, 0.4, 4, 8);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, fur);
    ear.position.set(side * 0.3, 2.55, -0.05);
    ear.rotation.z = side * -0.16;
    g.add(ear);
    const inner = new THREE.Mesh(innerGeo, mat(COLORS.EAR_INNER));
    inner.position.set(side * 0.3, 2.56, 0.06);
    inner.rotation.z = side * -0.16;
    g.add(inner);
  }

  // eyes + pink nose
  const eyeGeo = new THREE.SphereGeometry(0.075, 10, 8);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, dark);
    eye.position.set(side * 0.24, 1.84, 0.52);
    g.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(COLORS.NOSE));
  nose.position.set(0, 1.68, 0.68);
  g.add(nose);

  // round doctor glasses: two rims (one instanced mesh) + bridge
  const rimGeo = new THREE.TorusGeometry(0.17, 0.028, 8, 20);
  const rims = new THREE.InstancedMesh(rimGeo, dark, 2);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    m.makeTranslation(side * 0.24, 1.84, 0.56);
    rims.setMatrixAt(i, m);
  }
  rims.instanceMatrix.needsUpdate = true;
  g.add(rims);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), dark);
  bridge.position.set(0, 1.86, 0.57);
  g.add(bridge);

  return g;
}

/**
 * Vet clinic dressing (§C9.1): red-cross sign over the west-facing door,
 * suburban tree-small ×2 flanking, parking apron on the tile's west half,
 * Dr. Hoppel counter bust beside the door. The building-e itself renders
 * instanced via layout.buildings (rotY −90°, east half of VET_TILE).
 * @param {import('three').Scene} scene
 * @param {{getModel: (key: string) => import('three').Object3D}} assets
 * @param {import('./cityBuilder.js').CityLayout} layout
 * @returns {{group: import('three').Group}}
 */
export function buildVetClinic(scene, assets, layout) {
  const group = new THREE.Group();
  group.name = 'vetClinic';
  const { buildingAt, parking } = layout.vet;
  // building-e front (west after rotY −90°): authored half-depth 0.51 × scale
  const frontX = buildingAt.x - 0.51 * T.BUILDING_SCALE;

  // parking apron (same recipe as the shop's — §C9.1 "same apron recipe")
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 10),
    new THREE.MeshStandardMaterial({ color: COLORS.APRON, roughness: 1 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(parking.x, T.ROAD_Y + 0.02, parking.z);
  group.add(apron);

  // sign: white board + two crossed red boxes (§C9.1), over the door
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.6, 2.6), mat(COLORS.SIGN_BOARD));
  board.position.set(frontX - 0.4, 6.4, buildingAt.z);
  group.add(board);
  const crossMat = mat(COLORS.CROSS);
  const barGeo = new THREE.BoxGeometry(0.3, 0.62, 2.0);
  const barV = new THREE.Mesh(barGeo, crossMat);
  barV.rotation.x = Math.PI / 2;
  barV.position.set(frontX - 0.46, 6.4, buildingAt.z);
  const barH = new THREE.Mesh(barGeo, crossMat);
  barH.position.set(frontX - 0.46, 6.4, buildingAt.z);
  group.add(barV, barH);

  // suburban tree-small ×2 flanking the door (§C9.1)
  for (const side of [-1, 1]) {
    const tree = assets.getModel('city-kit-suburban/tree-small');
    tree.scale.setScalar(T.BUILDING_SCALE * 0.55);
    tree.position.set(frontX - 0.6, T.ROAD_Y, buildingAt.z + side * 5.2);
    group.add(tree);
  }

  // Dr. Hoppel behind his counter, between door and apron, facing the car
  const hoppel = createDrHoppelBust();
  hoppel.scale.setScalar(1.35);
  hoppel.position.set(frontX - 2.6, T.ROAD_Y, buildingAt.z - 3.6);
  hoppel.rotation.y = -Math.PI / 2 - 0.35; // toward the parking apron
  group.add(hoppel);

  scene.add(group);
  return { group };
}

/**
 * Landmark dressing (§C9.3): procedural 2-tier fountain, hexagonal park
 * gazebo + nature trees, windmill-café counter + awning. skyTower and the
 * windmill render instanced via layout.buildings.
 * @param {import('three').Scene} scene
 * @param {{getModel: (key: string) => import('three').Object3D}} assets
 * @param {import('./cityBuilder.js').CityLayout} layout
 * @returns {{group: import('three').Group}}
 */
export function buildLandmarkDressing(scene, assets, layout) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const at = (id) => layout.landmarks.find((l) => l.id === id)?.at;

  // --- fountain (block [5,5] corner facing the cross): 2 tiers + water -----
  const f = at('fountain');
  if (f) {
    const stone = mat(COLORS.STONE);
    const water = new THREE.MeshStandardMaterial({ color: COLORS.WATER, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.7, 0.7, 14), stone);
    base.position.set(f.x, T.ROAD_Y + 0.35, f.z);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.12, 14), water);
    pool.position.set(f.x, T.ROAD_Y + 0.72, f.z);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.1, 10), stone);
    column.position.set(f.x, T.ROAD_Y + 1.2, f.z);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.9, 0.35, 12), stone);
    dish.position.set(f.x, T.ROAD_Y + 1.85, f.z);
    const topWater = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 12), water);
    topWater.position.set(f.x, T.ROAD_Y + 2.02, f.z);
    const spout = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), water);
    spout.position.set(f.x, T.ROAD_Y + 2.3, f.z);
    group.add(base, pool, column, dish, topWater, spout);
  }

  // --- park gazebo (block [5,2]): hex base, 6 columns, cone roof + trees ---
  const gz = at('parkGazebo');
  if (gz) {
    const wood = mat(COLORS.GAZEBO_WOOD);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.4, 6), wood);
    base.position.set(gz.x, T.ROAD_Y + 0.2, gz.z);
    const colGeo = new THREE.CylinderGeometry(0.17, 0.17, 2.7, 8);
    const columns = new THREE.InstancedMesh(colGeo, wood, 6);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      m.makeTranslation(gz.x + Math.cos(a) * 2.6, T.ROAD_Y + 1.75, gz.z + Math.sin(a) * 2.6);
      columns.setMatrixAt(i, m);
    }
    columns.instanceMatrix.needsUpdate = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.7, 6), mat(COLORS.GAZEBO_ROOF));
    roof.position.set(gz.x, T.ROAD_Y + 3.9, gz.z);
    group.add(base, columns, roof);
    for (const [dx, dz] of [[2.5, -6], [3.5, 6.5]]) {
      const tree = assets.getModel('nature-kit/tree_default');
      tree.scale.setScalar(T.TREE_SCALE * 0.9);
      tree.position.set(gz.x + dx, 0, gz.z + dz);
      group.add(tree);
    }
  }

  // --- windmill café (block [6,5]): counter + pink awning beside the mill --
  const wc = at('windmillCafe');
  if (wc) {
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 1.2), mat(COLORS.COUNTER));
    counter.position.set(wc.x + 3.6, T.ROAD_Y + 0.6, wc.z + 1.6);
    const awning = assets.getModel('city-kit-commercial/detail-awning');
    awning.scale.setScalar(T.BUILDING_SCALE * 0.42);
    awning.position.set(wc.x + 3.6, T.ROAD_Y + 1.9, wc.z + 2.1);
    group.add(counter, awning);
  }

  scene.add(group);
  return { group };
}
