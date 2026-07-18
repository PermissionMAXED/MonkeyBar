// V3/G39: dev-only road-piece orientation scene (PLAN3 §C7.1-1).
// `?scene=roadtest` renders all 5 city-kit-roads pieces at rotY 0/90/180/270
// in a labeled top-down grid with a compass gizmo. The §C7.1 fix procedure is
// binding: each piece's TRUE open port sides are read off THIS render before
// the PIECE_PORTS truth table in city/cityBuilder.js may be written. Dev-only
// (routed by the harness), never part of the shipped game.

import * as THREE from 'three';

/** Grid columns: the rotations applied exactly like cityDrive's composeAt. */
const ROTS_DEG = [0, 90, 180, 270];
/** Grid rows: every road piece the city builder can place. */
const PIECES = [
  'road-straight',
  'road-bend',
  'road-intersection',
  'road-crossroad',
  'road-crossing',
];

const CELL_M = 13; // grid spacing
const TILE_M = 10; // rendered piece size (GLB tiles are 1×1 units)

/** Preloaded by the sceneManager before enter (§E1). */
export const ROADTEST_ASSET_KEYS = Object.freeze(
  PIECES.map((p) => `city-kit-roads/${p}`)
);

/**
 * Flat text label readable from the top-down camera (canvas texture plane).
 * @param {string} text
 * @param {number} wM world width (m)
 * @param {string} [color]
 * @returns {import('three').Mesh}
 */
function makeLabel(text, wM, color = '#1b2733') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 64px system-ui, sans-serif';
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wM, wM * 0.25),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  mesh.rotation.x = -Math.PI / 2; // lie flat, text-up = −z = north = screen-up
  return mesh;
}

/** Thin square outline marking a cell's tile edges (port sides read here). */
function makeTileOutline(sizeM) {
  const h = sizeM / 2;
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-h, 0, -h),
    new THREE.Vector3(h, 0, -h),
    new THREE.Vector3(h, 0, h),
    new THREE.Vector3(-h, 0, h),
  ]);
  return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: '#d0433b' }));
}

/**
 * §E1 scene factory — registered by the harness under 'roadtest'.
 * @param {{assets: {getModel: (key: string) => import('three').Object3D}}} ctx
 */
export function createRoadtestScene(ctx) {
  const { assets } = ctx;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e6edf2');
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4cc', 1.0));
  const dir = new THREE.DirectionalLight('#ffffff', 0.8);
  dir.position.set(30, 80, -40);
  scene.add(dir);

  // --- the piece × rotation grid (columns = rotY, rows = pieces) -----------
  // Built in enter() — the sceneManager preloads ROADTEST_ASSET_KEYS between
  // factory and enter, so getModel here returns real GLBs (no placeholders).
  const x0 = -((ROTS_DEG.length - 1) / 2) * CELL_M;
  const z0 = -((PIECES.length - 1) / 2) * CELL_M;
  function buildGrid() {
    for (let row = 0; row < PIECES.length; row++) {
      for (let col = 0; col < ROTS_DEG.length; col++) {
        const x = x0 + col * CELL_M;
        const z = z0 + row * CELL_M;
        const model = assets.getModel(`city-kit-roads/${PIECES[row]}`);
        model.scale.setScalar(TILE_M);
        model.position.set(x, 0, z);
        model.rotation.y = (ROTS_DEG[col] * Math.PI) / 180;
        scene.add(model);
        const outline = makeTileOutline(TILE_M);
        outline.position.set(x, 0.35, z);
        scene.add(outline);
      }
      const rowLabel = makeLabel(PIECES[row].replace('road-', ''), 11, '#0c56a0');
      rowLabel.position.set(x0 - CELL_M * 0.95, 0.3, z0 + row * CELL_M);
      scene.add(rowLabel);
    }
    for (let col = 0; col < ROTS_DEG.length; col++) {
      const colLabel = makeLabel(`${ROTS_DEG[col]}°`, 8);
      colLabel.position.set(x0 + col * CELL_M, 0.3, z0 - CELL_M * 0.75);
      scene.add(colLabel);
    }
  }

  // --- compass gizmo (N = −z per cityBuilder's grid convention) ------------
  const compass = new THREE.Group();
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 3.4, 5),
    new THREE.MeshBasicMaterial({ color: '#d0433b' })
  );
  arrow.rotation.x = -Math.PI / 2; // cone +y → −z (north)
  arrow.position.z = -1.2;
  compass.add(arrow);
  for (const [txt, dx, dz] of [['N', 0, -4.4], ['S', 0, 4.2], ['E', 4.2, 0], ['W', -4.2, 0]]) {
    const l = makeLabel(txt, 6, '#d0433b');
    l.position.set(dx, 0.3, dz);
    compass.add(l);
  }
  compass.position.set(x0 + (ROTS_DEG.length - 0.2) * CELL_M, 0.4, z0 - CELL_M * 0.75);
  compass.scale.setScalar(0.9);
  scene.add(compass);

  // --- fixed top-down camera, north up --------------------------------------
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
  const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
  const aspect = innerWidth / innerHeight;
  const halfW = (ROTS_DEG.length + 1.6) * CELL_M * 0.5 + 4;
  const halfH = (PIECES.length + 1.4) * CELL_M * 0.5 + 2;
  const y = Math.max(halfW / (tanHalf * aspect), halfH / tanHalf);
  cam.up.set(0, 0, -1); // −z (north) = screen-up
  cam.position.set(0, y, 0);
  cam.lookAt(0, 0, 0);

  // dev debug handle for CDP probes (this whole scene is dev-only)
  window.__roadtest = { scene, THREE };

  return {
    scene,
    camera: cam,
    enter() {
      buildGrid();
    },
    update() {},
    exit() {},
    dispose() {},
  };
}
