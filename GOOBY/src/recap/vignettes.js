// V4/G63 — The 8 recap biome vignettes (PLAN4 §B5.4 + §C-SYS2.3 binding
// table): small self-contained three.js dioramas the level-up cinematic
// travels through — meadow, city, harbor, space, spook garden, bakery, night
// sky, toy room — each dressed ONLY from already-committed kits, with the
// matching ART-GATE-2 AI backdrop as a curved sky wall, a §C-SYS2.3 camera
// dolly and the player's OWN Gooby (current outfits ON) traveling through:
// walking (meadow/spookGarden/bakery), driving the car-kit sedan (city), at
// the helm of the watercraft-kit fishing boat (harbor), piloting the
// space-kit speeder (space), floating on a cloud (nightSky), lapping the
// toy-car-kit track in a toy kart (toyRoom).
//
// ── Vignette contract (binding for G64's cinematic player) ───────────────────
//   import { VIGNETTES, VIGNETTE_IDS, buildVignette } from '../recap/vignettes.js';
//
//   VIGNETTE_IDS — the 8 biome ids, EXACTLY recapDirector.DEFAULT_BIOMES
//     order (meadow, city, harbor, space, spookGarden, bakery, nightSky,
//     toyRoom) — the `cue.biome.id` of G55's timeline keys straight into it.
//   VIGNETTES[id].build(scene, assets, opts?) → handle  (or the equivalent
//     buildVignette(id, scene, assets, opts?)):
//     · scene   the SHARED recap scene — the builder adds ONE root group and
//       sets scene.background for the biome (restored on dispose),
//     · assets  core/assets (getModel; preload RECAP_ASSET_KEYS from
//       recapAssets.js before the first build),
//     · opts.camera (optional PerspectiveCamera) — when passed, update()
//       drives the §C-SYS2.3 dolly onto it (position/lookAt/fov/roll). Omit
//       it to drive your own camera from handle.dollyPose(progress).
//   handle = {
//     id, group, durSec,          // durSec = authored pace (~8–12 s)
//     update(dt, progress),       // dt sec; progress 0..1 across the
//                                 //   vignette's slot (G64's beat clock owns
//                                 //   it; omit → internal durSec loop)
//     dollyPose(progress),        // → {position:[x,y,z], look:[x,y,z], fov,
//                                 //    rollDeg} (pure, for external cameras)
//     dispose(),                  // remove group + free OWNED resources
//                                 //   (cached kit masters untouched) +
//                                 //   restore scene.background
//   }
//   Build ONE vignette at a time (build on the cut cue, dispose on the next):
//   every vignette stays ≤ 150 draw calls (DRAW_CALL_BUDGET; plan gate 250),
//   and repeated build→dispose cycles plateau (module-cached backdrops).
//   Dev preview: ?recappreview=<biome> (src/recap/vignettePreview.js).
//
// The pure data side (dolly waypoints/specs) is vignettes.logic.js; the
// preload lists are recapAssets.js — both node-tested.

import * as THREE from 'three';
import {
  VIGNETTE_IDS, VIGNETTE_SPECS, BACKDROP, DRAW_CALL_BUDGET,
  dollyPose as dollyPoseOf, goobyPose, clamp,
} from './vignettes.logic.js';
import { RECAP_BACKDROP_FILES, recapBackdropUrl } from './recapAssets.js';
import { createGooby } from '../character/gooby.js';
import { applyOutfits, applyEquippedOutfits } from '../character/outfitAttach.js';

export { VIGNETTE_IDS, VIGNETTE_SPECS, DRAW_CALL_BUDGET };

// ── permanent module caches (never disposed — repeated builds plateau) ──────
/** biome id → resolved backdrop THREE.Texture (file or fallback gradient). */
const backdropTexes = new Map();
/** biome id → in-flight load promise. */
const backdropPromises = new Map();
/** biome id → 'file' | 'fallback' (report/CDP probe — §E „verify + report"). */
const backdropSource = new Map();
/** name → shared procedural CanvasTexture (glow/water/floor/fog/moon). */
const texCache = new Map();

/** @param {string} id @returns {THREE.Texture} tinted gradient stand-in */
function fallbackBackdropTexture(id) {
  const key = `fallback:${id}`;
  if (!texCache.has(key)) {
    const [top, bottom] = VIGNETTE_SPECS[id]?.fallback ?? ['#8ec9ff', '#eaf7d9'];
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, tex);
  }
  return texCache.get(key);
}

/**
 * Load (once) a biome's AI backdrop. Missing/failed file → tinted gradient
 * fallback + console.warn (§E block G63 rule), recorded in backdropSource.
 * @param {string} id biome id
 * @returns {Promise<THREE.Texture>}
 */
function loadBackdropTexture(id) {
  let p = backdropPromises.get(id);
  if (!p) {
    const url = recapBackdropUrl(id);
    p = new Promise((resolve) => {
      if (!url) {
        backdropSource.set(id, 'fallback');
        resolve(fallbackBackdropTexture(id));
        return;
      }
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          // BackSide cylinder shows the image mirrored — unmirror via repeat.
          tex.wrapS = THREE.RepeatWrapping;
          tex.repeat.x = -1;
          backdropSource.set(id, 'file');
          backdropTexes.set(id, tex);
          resolve(tex);
        },
        undefined,
        () => {
          console.warn(`[recap] backdrop missing for '${id}' (${url}) — tinted gradient fallback`);
          backdropSource.set(id, 'fallback');
          const tex = fallbackBackdropTexture(id);
          backdropTexes.set(id, tex);
          resolve(tex);
        }
      );
    });
    backdropPromises.set(id, p);
  }
  return p;
}

/** Warm all (or some) backdrop textures — G64 calls this next to preload(). */
export function preloadBackdrops(ids = VIGNETTE_IDS) {
  return Promise.all(ids.filter((id) => id in RECAP_BACKDROP_FILES).map(loadBackdropTexture));
}

/** @returns {Record<string, string>} biome id → 'file'|'fallback'|'pending' */
export function backdropStatus() {
  const out = {};
  for (const id of VIGNETTE_IDS) out[id] = backdropSource.get(id) ?? 'pending';
  return out;
}

/** Shared procedural canvas textures (cached forever, one GPU upload each). */
function proceduralTexture(name) {
  if (texCache.has(name)) return texCache.get(name);
  const c = document.createElement('canvas');
  const size = name === 'water' || name === 'floorWood' || name === 'floorCheck' ? 256 : 128;
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (name === 'water') {
    // sage-teal matched to recap_harbor.png's water at the seam (#8ab5a7)
    g.fillStyle = '#93c0b2';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 46; i++) {
      const y = (i * 37) % size;
      const x = (i * 71) % size;
      g.strokeStyle = i % 3 === 0 ? 'rgba(255,244,214,0.35)' : 'rgba(224,244,236,0.2)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x - 14, y);
      g.quadraticCurveTo(x, y - 4, x + 14, y);
      g.stroke();
    }
  } else if (name === 'floorCheck') {
    const n = 8;
    const s = size / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 === 0 ? '#f6e3c4' : '#e8c79b';
        g.fillRect(i * s, j * s, s, s);
      }
    }
  } else if (name === 'floorWood') {
    g.fillStyle = '#d9a86a';
    g.fillRect(0, 0, size, size);
    const plank = size / 8;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 === 0 ? 'rgba(150,96,44,0.16)' : 'rgba(255,236,200,0.12)';
      g.fillRect(0, i * plank, size, plank);
      g.fillStyle = 'rgba(120,74,32,0.4)';
      g.fillRect(0, i * plank, size, 2);
      // staggered vertical plank seams
      g.fillRect(((i * 97) % size), i * plank, 2, plank);
    }
  } else if (name === 'starDot') {
    // soft round dot so starfield Points don't rasterize as hard squares
    const grad = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  } else if (name === 'glowWarm' || name === 'glowCool' || name === 'moon' || name === 'fog') {
    const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    const inner = name === 'glowWarm' ? 'rgba(255,190,110,0.95)'
      : name === 'glowCool' ? 'rgba(160,210,255,0.9)'
      : name === 'moon' ? 'rgba(255,250,225,1)'
      : 'rgba(235,235,250,0.55)';
    grad.addColorStop(0, inner);
    if (name === 'moon') grad.addColorStop(0.35, 'rgba(255,246,210,0.95)');
    grad.addColorStop(name === 'fog' ? 0.6 : 0.45, inner.replace(/[\d.]+\)$/, '0.25)'));
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (name === 'water' || name.startsWith('floor')) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  }
  texCache.set(name, tex);
  return tex;
}

/** Game-convention normalize: scale to target max dimension + center. */
function fitModel(model, targetSize) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = targetSize / (Math.max(size.x, size.y, size.z) || 1);
  model.scale.setScalar(s);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  const holder = new THREE.Group();
  holder.add(model);
  return holder;
}

/** fitModel, then rest the model's bounding box ON y=0 (props on ground). */
function ground(holder) {
  const box = new THREE.Box3().setFromObject(holder);
  holder.position.y -= box.min.y;
  return holder;
}

// ── stage: shared per-build scaffolding ─────────────────────────────────────

/**
 * @param {string} id biome id
 * @param {THREE.Scene} scene shared recap scene
 * @param {object} assets core/assets
 */
function createStage(id, scene, assets) {
  const spec = VIGNETTE_SPECS[id];
  const group = new THREE.Group();
  group.name = `recap-vignette-${id}`;
  scene.add(group);
  const prevBackground = scene.background;
  scene.background = new THREE.Color(spec.bg);

  /** resources THIS build created (kit clones share cached masters — skipped) */
  const ownedGeos = [];
  const ownedMats = [];
  const disposers = [];

  const stage = {
    id,
    spec,
    group,
    assets,
    /** track an owned mesh/sprite/points' geometry+material for dispose */
    own(obj) {
      if (obj.geometry) ownedGeos.push(obj.geometry);
      if (obj.material) ownedMats.push(obj.material);
      return obj;
    },
    onDispose(fn) {
      disposers.push(fn);
    },
    /** kit model helper: getModel → fitModel → optional ground-rest */
    prop(key, size, { x = 0, y = 0, z = 0, rotY = 0, rest = true } = {}) {
      let holder = fitModel(assets.getModel(key), size);
      if (rest) holder = ground(holder);
      holder.position.x = x;
      holder.position.y += y;
      holder.position.z = z;
      holder.rotation.y = rotY;
      group.add(holder);
      return holder;
    },
    /** curved AI-backdrop wall (ONE draw call; module-cached texture) */
    backdrop() {
      const arc = spec.backdropArc ?? BACKDROP.ARC;
      const radius = spec.backdropRadius ?? BACKDROP.RADIUS;
      const height = spec.backdropHeight ?? BACKDROP.HEIGHT;
      const geo = new THREE.CylinderGeometry(
        radius, radius, height, 48, 1, true,
        Math.PI - arc / 2, arc
      );
      const mat = new THREE.MeshBasicMaterial({
        map: backdropTexes.get(id) ?? fallbackBackdropTexture(id),
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      ownedGeos.push(geo);
      ownedMats.push(mat);
      const wall = new THREE.Mesh(geo, mat);
      wall.position.y = spec.backdropCenterY ?? BACKDROP.CENTER_Y;
      wall.renderOrder = -10;
      group.add(wall);
      let disposed = false;
      disposers.push(() => {
        disposed = true;
      });
      loadBackdropTexture(id).then((tex) => {
        if (!disposed && mat.map !== tex) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      });
      return wall;
    },
    /** warm hemi + directional rig (§C-SYS2.3 „warm lighting") */
    lights({ hemiSky, hemiGround, hemiI, dirColor, dirI, dirPos }) {
      const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, hemiI);
      const dir = new THREE.DirectionalLight(dirColor, dirI);
      dir.position.set(...dirPos);
      group.add(hemi, dir, dir.target);
      disposers.push(() => {
        hemi.dispose();
        dir.dispose();
      });
      return { hemi, dir };
    },
    accentLight(color, intensity, distance, pos) {
      const pt = new THREE.PointLight(color, intensity, distance, 2);
      pt.position.set(...pos);
      group.add(pt);
      disposers.push(() => pt.dispose());
      return pt;
    },
    glowSprite(texName, scale, pos, opacity = 0.85) {
      const mat = new THREE.SpriteMaterial({
        map: proceduralTexture(texName),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      ownedMats.push(mat);
      const s = new THREE.Sprite(mat);
      s.scale.set(scale, scale, 1);
      s.position.set(...pos);
      group.add(s);
      return s;
    },
    /** the player's OWN Gooby (procedural rig, equipped outfits ON — §C-SYS2.3) */
    gooby({ scale, clip = 'happyBounce', clipSpeed = 1.4, emotion = 'happy' } = {}) {
      const gooby = createGooby();
      applyEquippedOutfits(gooby); // no-op (bare rig) before initOutfitSync
      gooby.group.scale.setScalar(scale ?? spec.goobyScale);
      gooby.setEmotion(emotion);
      if (clip) gooby.play(clip, { loop: true, speed: clipSpeed });
      group.add(gooby.group);
      disposers.push(() => {
        applyOutfits(gooby, {}); // strip outfit items (frees their geometries)
        gooby.dispose();
      });
      return gooby;
    },
    dispose() {
      for (const fn of disposers) fn();
      for (const geo of ownedGeos) geo.dispose();
      for (const mat of ownedMats) mat.dispose();
      scene.remove(group);
      scene.background = prevBackground;
    },
  };
  return stage;
}

// ── per-biome builders (each returns { tick(dt, progress) }) ────────────────

/** #1 Blumenwiese — nature-kit meadow, Gooby hops the flower path. */
function buildMeadow(stage) {
  const groundMat = new THREE.MeshStandardMaterial({ color: '#7fbf6a', roughness: 1 });
  const groundGeo = new THREE.CircleGeometry(24, 40);
  const floor = stage.own(new THREE.Mesh(groundGeo, groundMat));
  floor.rotation.x = -Math.PI / 2;
  stage.group.add(floor);

  stage.lights({
    hemiSky: '#fff5e0', hemiGround: '#9fbf8a', hemiI: 0.95,
    dirColor: '#ffe9c0', dirI: 1.15, dirPos: [4, 7, 4],
  });

  const trees = [
    ['nature-kit/tree_oak', 3.0, -4.2, -4.5], ['nature-kit/tree_default', 2.4, 4.4, -3],
    ['nature-kit/tree_fat', 2.7, -3.4, 1.5], ['nature-kit/tree_oak', 2.6, 5.2, -7.5],
    ['nature-kit/tree_default', 2.2, -6, -8], ['nature-kit/tree_fat', 2.3, 3.6, 4.5],
  ];
  for (const [key, size, x, z] of trees) stage.prop(key, size, { x, z });
  const flowers = ['flower_redA', 'flower_purpleA', 'flower_yellowA'];
  for (let i = 0; i < 12; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = 6.5 - i * 1.05;
    stage.prop(`nature-kit/${flowers[i % 3]}`, 0.5, {
      x: side * (1.7 + (i % 3) * 0.5), z, rotY: i * 1.3,
    });
  }
  for (let i = 0; i < 8; i++) {
    stage.prop('nature-kit/grass_large', 0.45, {
      x: (i % 2 === 0 ? 1 : -1) * (1.6 + (i % 3) * 0.9), z: 5 - i * 1.4, rotY: i,
    });
  }
  stage.prop('nature-kit/plant_bush', 0.9, { x: -2.6, z: 5.5 });
  stage.prop('nature-kit/plant_bush', 0.8, { x: 2.8, z: -4.2 });
  stage.prop('nature-kit/rock_largeA', 1.1, { x: 6, z: -0.5, rotY: 0.7 });
  stage.prop('nature-kit/rock_smallA', 0.5, { x: -1.9, z: -2.2 });
  stage.prop('nature-kit/mushroom_red', 0.35, { x: -2.2, z: 3.1 });
  stage.prop('nature-kit/mushroom_red', 0.3, { x: 1.8, z: -5.4 });
  for (let i = 0; i < 5; i++) {
    stage.prop('nature-kit/fence_simple', 1.15, { x: -7.2 + i * 1.5, z: -9.5 });
  }
  stage.prop('nature-kit/fence_gate', 1.15, { x: 0.3, z: -9.5 });

  const gooby = stage.gooby({ clipSpeed: 1.5 });
  return {
    tick(dt, p) {
      const pose = goobyPose('meadow', p);
      gooby.group.position.set(pose.position[0], pose.position[1], pose.position[2]);
      gooby.group.rotation.y = pose.yaw;
      gooby.update(dt);
    },
  };
}

/** #2 Große Stadt — kaykit-city street canyon, Gooby drives the sedan. */
function buildCity(stage) {
  const groundMat = new THREE.MeshStandardMaterial({ color: '#9aa0ab', roughness: 1 });
  const floor = stage.own(new THREE.Mesh(new THREE.PlaneGeometry(46, 26), groundMat));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -2;
  stage.group.add(floor);

  stage.lights({
    hemiSky: '#fff2dd', hemiGround: '#b8a898', hemiI: 0.95,
    dirColor: '#ffedc8', dirI: 1.15, dirPos: [5, 9, 6],
  });

  for (let i = 0; i < 10; i++) {
    stage.prop('city-kit-roads/road-straight', 2.2, { x: -9.9 + i * 2.2, z: 1.4, rotY: Math.PI / 2 });
  }
  const rowA = ['A', 'B', 'C', 'D', 'E', 'F', 'B', 'D'];
  for (let i = 0; i < rowA.length; i++) {
    stage.prop(`kaykit-city/building_${rowA[i]}_withoutBase`, 3.6 + (i % 3) * 0.5, {
      x: -9.5 + i * 2.75, z: -2.6, rotY: 0,
    });
  }
  const far = ['a', 'b', 'c', 'a'];
  for (let i = 0; i < far.length; i++) {
    stage.prop(`city-kit-commercial/low-detail-building-${far[i]}`, 4.5, {
      x: -7 + i * 4.6, z: -7.5, rotY: 0,
    });
  }
  for (let i = 0; i < 4; i++) {
    stage.prop('kaykit-city/streetlight', 1.9, { x: -7.5 + i * 5, z: 0.1, rotY: Math.PI });
  }
  stage.prop('kaykit-city/bench', 0.85, { x: -3.2, z: -0.6, rotY: Math.PI });
  stage.prop('kaykit-city/bench', 0.85, { x: 4.8, z: -0.6, rotY: Math.PI });
  stage.prop('kaykit-city/bush', 0.7, { x: -5.4, z: -0.5 });
  stage.prop('kaykit-city/bush', 0.7, { x: 1, z: -0.6 });
  stage.prop('kaykit-city/bush', 0.7, { x: 7, z: -0.5 });
  stage.prop('kaykit-city/box_A', 0.6, { x: 8.6, z: -1.4, rotY: 0.4 });

  // player car: sedan + 4 wheels + Gooby at the wheel (carController pattern)
  const car = new THREE.Group();
  const body = ground(fitModel(stage.assets.getModel('car-kit/sedan'), 2.1));
  car.add(body);
  const box = new THREE.Box3().setFromObject(body);
  const wx = (box.max.x - box.min.x) * 0.32;
  const wz = (box.max.z - box.min.z) * 0.3;
  const wheels = [];
  for (const [x, z] of [[wx, wz], [-wx, wz], [wx, -wz], [-wx, -wz]]) {
    const wheel = fitModel(stage.assets.getModel('car-kit/wheel-default'), 0.4);
    wheel.position.set(x, 0.2, z);
    car.add(wheel);
    wheels.push(wheel);
  }
  // seated high so THEIR Gooby pokes out of the cabin (sunroof style —
  // wardrobe continuity must read at the dolly's distance)
  const gooby = stage.gooby({ clip: 'sitDrive' });
  gooby.group.position.set(0, 0.92, -0.12);
  car.add(gooby.group);
  stage.group.add(car);

  return {
    tick(dt, p) {
      const pose = goobyPose('city', p);
      car.position.set(pose.position[0], pose.position[1], pose.position[2]);
      car.rotation.y = pose.yaw;
      for (const w of wheels) w.rotation.x += dt * 7;
      gooby.update(dt);
    },
  };
}

/** #3 Hafen — orbit around the bobbing fishing boat; pier + crates. */
function buildHarbor(stage) {
  // unlit water reads painterly-bright, matching the golden-hour backdrop
  const waterTex = proceduralTexture('water');
  waterTex.repeat.set(4, 4);
  const waterMat = new THREE.MeshBasicMaterial({ map: waterTex, color: '#f6fff8' });
  const water = stage.own(new THREE.Mesh(new THREE.PlaneGeometry(56, 56), waterMat));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.05;
  stage.group.add(water);

  stage.lights({
    hemiSky: '#ffe7c8', hemiGround: '#7a8ba0', hemiI: 0.9,
    dirColor: '#ffcf9a', dirI: 1.3, dirPos: [-6, 5, 4],
  });

  // pier: shared plank/post geometry, one material (10 + 5 draws)
  const plankGeo = new THREE.BoxGeometry(1.5, 0.12, 0.62);
  const postGeo = new THREE.BoxGeometry(0.18, 1.1, 0.18);
  const woodMat = new THREE.MeshStandardMaterial({ color: '#a8795a', roughness: 0.95 });
  stage.own({ geometry: plankGeo, material: woodMat });
  stage.own({ geometry: postGeo, material: null });
  const pier = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const plank = new THREE.Mesh(plankGeo, woodMat);
    plank.position.set(2.6 + Math.floor(i / 5) * 1.55, 0.55, -1.4 + (i % 5) * 0.7);
    pier.add(plank);
  }
  for (let i = 0; i < 5; i++) {
    const post = new THREE.Mesh(postGeo, woodMat);
    post.position.set(2.6 + (i % 2) * 1.55, 0.05, -1.5 + i * 0.72);
    pier.add(post);
  }
  stage.group.add(pier);
  stage.prop('kaykit-restaurant/crate', 0.55, { x: 3.1, y: 0.61, z: -1.1, rotY: 0.3, rest: false });
  stage.prop('kaykit-restaurant/crate', 0.55, { x: 3.7, y: 0.61, z: -0.5, rotY: -0.2, rest: false });
  stage.prop('kaykit-restaurant/crate', 0.5, { x: 3.35, y: 1.14, z: -0.85, rotY: 0.8, rest: false });
  stage.prop('watercraft-kit/buoy', 0.55, { x: -3.4, y: 0.15, z: 3.2, rest: false });
  stage.prop('watercraft-kit/buoy-flag', 0.75, { x: 4.6, y: 0.2, z: 3.8, rest: false });
  stage.prop('watercraft-kit/boat-sail-a', 2.8, { x: -7, y: 0.4, z: -8.5, rotY: 0.9, rest: false });
  stage.prop('nature-kit/rock_largeA', 1.6, { x: -8.5, y: -0.1, z: 2.5, rest: false });

  // the star: fishing boat + Gooby at the helm, gently bobbing at anchor
  const boat = new THREE.Group();
  const hull = fitModel(stage.assets.getModel('watercraft-kit/boat-fishing-small'), 2.6);
  hull.position.y = 0.42;
  boat.add(hull);
  const gooby = stage.gooby({ clip: 'sitDrive', emotion: 'ecstatic' });
  gooby.group.position.set(0, 0.55, 0.35);
  boat.add(gooby.group);
  boat.rotation.y = 0.5;
  stage.group.add(boat);

  let t = 0;
  return {
    tick(dt, p) {
      t += dt;
      const pose = goobyPose('harbor', p);
      boat.position.set(pose.position[0], Math.sin(t * 1.1) * 0.06, pose.position[2]);
      boat.rotation.x = Math.sin(t * 0.9) * 0.035;
      boat.rotation.z = Math.sin(t * 0.7 + 1) * 0.045;
      waterTex.offset.x += dt * 0.008;
      waterTex.offset.y += dt * 0.014;
      gooby.update(dt);
    },
  };
}

/** #4 Weltraum — speeder glide through a meteor field, starfield points. */
function buildSpace(stage) {
  // dusk-nebula tint so the grey meteors blend into the pink/violet backdrop
  stage.lights({
    hemiSky: '#c9a8ff', hemiGround: '#241a3c', hemiI: 0.85,
    dirColor: '#ffc9e0', dirI: 0.95, dirPos: [3, 6, 5],
  });

  // two starfield layers (2 draw calls)
  const layers = [];
  for (const [count, size, color] of [[130, 0.14, '#9fb6e8'], [80, 0.24, '#ffffff']]) {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const th = (i * 2.399963) % (Math.PI * 2); // golden-angle scatter
      const r = 12 + ((i * 7919) % 1000) / 1000 * 15;
      arr[i * 3] = Math.cos(th) * r;
      arr[i * 3 + 1] = -8 + ((i * 104729) % 1000) / 1000 * 28; // fill the void below too
      arr[i * 3 + 2] = -Math.abs(Math.sin(th)) * r + 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 0.9, depthWrite: false,
      map: proceduralTexture('starDot'),
    });
    const points = stage.own(new THREE.Points(geo, mat));
    stage.group.add(points);
    layers.push(mat);
  }

  // meteor field flanks the flight corridor (goobyPath x −1.4…+1.6) — every
  // rock keeps ≥ 2.5 lateral clearance so the speeder is never occluded
  const meteors = [];
  const kinds = ['meteor', 'meteor_half', 'meteor_detailed'];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const m = stage.prop(`space-kit/${kinds[i % 3]}`, 0.55 + (i % 4) * 0.25, {
      x: side * (3.4 + ((i * 53) % 30) / 10),
      y: 0.6 + ((i * 37) % 50) / 10,
      z: 4 - i * 1.7,
      rotY: i,
      rest: false,
    });
    meteors.push(m);
  }

  // speeder + Gooby (starHopper rig reuse: sitDrive on craft_speederA)
  const craft = new THREE.Group();
  const speeder = fitModel(stage.assets.getModel('space-kit/craft_speederA'), 1.7);
  speeder.rotation.y = Math.PI; // nose toward -z (travel direction)
  craft.add(speeder);
  const gooby = stage.gooby({ clip: 'sitDrive', emotion: 'ecstatic' });
  gooby.group.position.set(0, 0.42, 0.35);
  craft.add(gooby.group);
  const glow = stage.glowSprite('glowCool', 1.1, [0, 0.1, 0.9]);
  craft.add(glow);
  glow.position.set(0, 0.1, 0.9);
  stage.group.add(craft);
  stage.accentLight('#9fc4ff', 5, 7, [0, 3, 0]);

  let t = 0;
  return {
    tick(dt, p) {
      t += dt;
      const pose = goobyPose('space', p);
      craft.position.set(pose.position[0], pose.position[1] + Math.sin(t * 1.6) * 0.08, pose.position[2]);
      craft.rotation.y = pose.yaw + Math.PI;
      craft.rotation.z = Math.sin(t * 1.3) * 0.06;
      for (let i = 0; i < meteors.length; i++) {
        meteors[i].rotation.y += dt * (0.15 + (i % 3) * 0.1);
        meteors[i].rotation.x += dt * 0.08;
      }
      layers[0].opacity = 0.75 + Math.sin(t * 2.1) * 0.15;
      layers[1].opacity = 0.85 + Math.sin(t * 1.4 + 2) * 0.15;
      gooby.update(dt);
    },
  };
}

/** #5 Spukgarten — grave aisle, jack-o'-lantern glow, low fog planes. */
function buildSpookGarden(stage) {
  const groundMat = new THREE.MeshStandardMaterial({ color: '#514468', roughness: 1 });
  const floor = stage.own(new THREE.Mesh(new THREE.CircleGeometry(22, 36), groundMat));
  floor.rotation.x = -Math.PI / 2;
  stage.group.add(floor);

  stage.lights({
    hemiSky: '#9a8fc0', hemiGround: '#2a2338', hemiI: 0.7,
    dirColor: '#c4b4e8', dirI: 0.55, dirPos: [-3, 7, 5],
  });
  stage.accentLight('#ffb573', 11, 8, [1.7, 1.2, 2.1]);
  stage.accentLight('#ff9a4d', 7, 6, [-1.4, 0.6, -0.9]);

  // upright stones hug the creep aisle; the flat grave slabs (raised dirt
  // boxes — they read as crates right next to the low dolly) stay in the
  // mid-ground flanks, always ≥ 2.5 units ahead of the camera's near zone
  const uprights = [
    ['gravestone', -1.9, 1.6, 0.15], ['gravemarker_A', 1.9, 0.4, -0.1],
    ['gravestone', 1.9, -2.2, -0.35], ['gravemarker_B', -1.9, -3.6, 0.1],
    ['gravestone', -2.2, -6, 0.3], ['gravemarker_A', 2.4, -6.5, -0.2],
  ];
  for (const [key, x, z, rotY] of uprights) stage.prop(`kaykit-halloween/${key}`, 0.95, { x, z, rotY });
  stage.prop('kaykit-halloween/grave_A', 1.0, { x: -3.2, z: -1.5, rotY: 0.35 });
  stage.prop('kaykit-halloween/grave_B', 1.0, { x: 3.2, z: -2.5, rotY: -0.25 });
  stage.prop('kaykit-halloween/floor_dirt_grave', 1.2, { x: -3.15, z: -3.9, rotY: 0.1 });
  stage.prop('kaykit-halloween/crypt', 2.5, { x: 0, z: -8, rotY: 0 });
  stage.prop('kaykit-halloween/tree_dead_large', 2.8, { x: -4.6, z: -5.5 });
  stage.prop('kaykit-halloween/tree_dead_large', 2.4, { x: 4.8, z: -3, rotY: 2 });
  stage.prop('kaykit-halloween/pumpkin_orange_jackolantern', 0.5, { x: 1.2, z: 2.4, rotY: -0.6 });
  stage.prop('kaykit-halloween/pumpkin_orange', 0.45, { x: -1.05, z: 0.6, rotY: 0.4 });
  stage.prop('kaykit-halloween/pumpkin_orange_small', 0.32, { x: -1.25, z: 0.15, rotY: 1.2 });
  stage.prop('kaykit-halloween/pumpkin_orange_jackolantern', 0.4, { x: -1.15, z: -1.1, rotY: 0.9 });
  stage.prop('kaykit-halloween/pumpkin_orange_small', 0.3, { x: 1.3, z: -1.4, rotY: 2.2 });
  for (let i = 0; i < 6; i++) {
    stage.prop('kaykit-halloween/fence_seperate', 1.15, { x: -6.3 + i * 2.1, z: 6.8 });
  }
  stage.prop('kaykit-halloween/fence_gate', 1.2, { x: 0.2, z: 6.9 });
  stage.prop('kaykit-halloween/lantern_standing', 1.0, { x: 1.7, z: 2.0 });
  stage.prop('kaykit-halloween/lantern_standing', 0.9, { x: -2.1, z: -3.4 });
  stage.glowSprite('glowWarm', 1.5, [1.25, 0.35, 2.45], 0.7);
  stage.glowSprite('glowWarm', 1.1, [-1.13, 0.28, -1.05], 0.6);

  // two drifting low fog planes (§C-SYS2.3 „low fog plane")
  const fogMat = new THREE.MeshBasicMaterial({
    map: proceduralTexture('fog'), transparent: true, opacity: 0.32, depthWrite: false,
  });
  const fogGeo = new THREE.PlaneGeometry(16, 12);
  stage.own({ geometry: fogGeo, material: fogMat });
  const fogs = [];
  for (const [y, sx] of [[0.28, 1], [0.55, -1]]) {
    const f = new THREE.Mesh(fogGeo, fogMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(0, y, 0);
    f.scale.x = sx;
    stage.group.add(f);
    fogs.push(f);
  }

  const gooby = stage.gooby({ clipSpeed: 1.1, emotion: 'neutral' });
  let t = 0;
  return {
    tick(dt, p) {
      t += dt;
      const pose = goobyPose('spookGarden', p);
      gooby.group.position.set(pose.position[0], pose.position[1], pose.position[2]);
      gooby.group.rotation.y = pose.yaw;
      fogs[0].position.x = Math.sin(t * 0.15) * 1.6;
      fogs[1].position.x = Math.sin(t * 0.11 + 2) * -1.4;
      gooby.update(dt);
    },
  };
}

/** #6 Bäckerei — counter row loaded with tiny-treats, Gooby patrols it. */
function buildBakery(stage) {
  const floorTex = proceduralTexture('floorCheck');
  floorTex.repeat.set(6, 6);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 });
  const floor = stage.own(new THREE.Mesh(new THREE.PlaneGeometry(24, 16), floorMat));
  floor.rotation.x = -Math.PI / 2;
  stage.group.add(floor);
  // no back wall: the close-radius painted bakery interior (spec
  // backdropRadius 14) IS the back of the shop behind the counter row

  stage.lights({
    hemiSky: '#fff3e0', hemiGround: '#caa987', hemiI: 1.05,
    dirColor: '#ffe4b8', dirI: 1.0, dirPos: [3, 6, 5],
  });
  stage.accentLight('#ff9a5a', 6, 5, [3.3, 1.1, -1.3]);

  const counters = [
    ['kaykit-restaurant/kitchencounter_straight', -4.2], ['bakery-interior/display_case_long', -2.4],
    ['bakery-interior/display_case_short', -0.9], ['kaykit-restaurant/kitchencounter_sink', 0.6],
    ['kaykit-restaurant/kitchencounter_straight', 2.1],
  ];
  for (const [key, x] of counters) stage.prop(key, 1.5, { x, z: -1.2, rotY: 0 });
  stage.prop('kaykit-restaurant/oven', 1.6, { x: 3.6, z: -1.35, rotY: 0 });
  stage.prop('kaykit-restaurant/fridge_A', 1.95, { x: 5.0, z: -1.5, rotY: 0 });
  stage.glowSprite('glowWarm', 1.0, [3.6, 0.75, -0.9], 0.55);

  // counter-top dressing (tiny-treats + restaurant bits, oversized for read)
  stage.prop('bakery-interior/cash_register', 0.5, { x: -0.9, y: 0.98, z: -1.15, rotY: 0.15, rest: false });
  stage.prop('bakery-interior/stand_mixer', 0.5, { x: -4.4, y: 0.98, z: -1.2, rotY: -0.3, rest: false });
  stage.prop('bakery-interior/dough_ball', 0.3, { x: -3.8, y: 0.95, z: -1.05, rest: false });
  stage.prop('bakery-interior/dough_rolled_A', 0.42, { x: 2.0, y: 0.95, z: -1.1, rotY: 0.6, rest: false });
  stage.prop('baked-goods/croissant', 0.42, { x: -2.6, y: 1.02, z: -1.05, rotY: 0.5, rest: false });
  stage.prop('baked-goods/cupcake', 0.4, { x: -2.15, y: 1.04, z: -1.2, rotY: 1.4, rest: false });
  stage.prop('baked-goods/cinnamon-roll', 0.4, { x: -1.75, y: 1.0, z: -1.0, rotY: 2.2, rest: false });
  stage.prop('bakery-interior/macaron_pink', 0.24, { x: -0.45, y: 0.96, z: -1.05, rest: false });
  stage.prop('bakery-interior/macaron_blue', 0.24, { x: -0.25, y: 0.96, z: -1.18, rest: false });
  stage.prop('bakery-interior/macaron_yellow', 0.24, { x: -0.05, y: 0.96, z: -1.02, rest: false });
  stage.prop('kaykit-restaurant/jar_A_large', 0.4, { x: 0.55, y: 0.98, z: -1.3, rest: false });
  stage.prop('kaykit-restaurant/jar_A_medium', 0.32, { x: 0.85, y: 0.96, z: -1.1, rest: false });
  stage.prop('kaykit-restaurant/menu', 0.75, { x: 1.4, y: 1.05, z: -1.2, rotY: -0.2, rest: false });
  stage.prop('kaykit-restaurant/crate_buns', 0.65, { x: -5.6, z: -1.1, rotY: 0.3 });
  stage.prop('kaykit-restaurant/crate_buns', 0.6, { x: 4.4, z: 0.6, rotY: -0.5 });
  stage.prop('kaykit-restaurant/table_round_A', 1.3, { x: -4.3, z: 1.8 });
  stage.prop('kaykit-restaurant/chair_A', 0.9, { x: -5.2, z: 1.7, rotY: Math.PI / 2 });
  stage.prop('kaykit-restaurant/chair_A', 0.9, { x: -3.4, z: 1.9, rotY: -Math.PI / 2 });
  // giant hero croissant on the short case — the vignette's smile beat
  stage.prop('baked-goods/croissant', 0.8, { x: 5.9, z: 0.3, rotY: -0.9 });

  const gooby = stage.gooby({ clipSpeed: 1.4 });
  return {
    tick(dt, p) {
      const pose = goobyPose('bakery', p);
      gooby.group.position.set(pose.position[0], pose.position[1], pose.position[2]);
      gooby.group.rotation.y = pose.yaw;
      gooby.update(dt);
    },
  };
}

/** #7 Nachthimmel — starfield + moon + clouds; Gooby floats on a puff. */
function buildNightSky(stage) {
  stage.lights({
    hemiSky: '#9fb2ff', hemiGround: '#1a1030', hemiI: 0.85,
    dirColor: '#cdd8ff', dirI: 0.75, dirPos: [-4, 8, 3],
  });

  const starMats = [];
  for (const [count, size, color] of [[160, 0.16, '#bcd0ff'], [90, 0.3, '#fff6d8']]) {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const th = (i * 2.399963) % (Math.PI * 2);
      const r = 10 + ((i * 7919) % 1000) / 1000 * 16;
      arr[i * 3] = Math.cos(th) * r;
      arr[i * 3 + 1] = 1 + ((i * 104729) % 1000) / 1000 * 26;
      arr[i * 3 + 2] = -Math.abs(Math.sin(th)) * r - 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 0.95, depthWrite: false,
      map: proceduralTexture('starDot'),
    });
    stage.group.add(stage.own(new THREE.Points(geo, mat)));
    starMats.push(mat);
  }
  // (no extra moon sprite — the painted backdrop's crescent owns the sky)

  // puffy clouds: shared sphere geo + one material (≤ 18 draws), self-lit so
  // they read as moonlit puffs against the painted night
  const puffGeo = new THREE.SphereGeometry(1, 10, 8);
  const puffMat = new THREE.MeshStandardMaterial({ color: '#cdd6f2', roughness: 1, emissive: '#8c98d8', emissiveIntensity: 0.55 });
  stage.own({ geometry: puffGeo, material: puffMat });
  const clouds = [];
  const cloudAt = (x, y, z, s) => {
    const cl = new THREE.Group();
    for (const [dx, dy, dz, ds] of [[0, 0, 0, 1], [0.9, -0.15, 0.1, 0.7], [-0.85, -0.1, -0.1, 0.65], [0.2, 0.35, -0.2, 0.55]]) {
      const m = new THREE.Mesh(puffGeo, puffMat);
      m.position.set(dx * s, dy * s, dz * s);
      m.scale.setScalar(ds * s);
      cl.add(m);
    }
    cl.position.set(x, y, z);
    stage.group.add(cl);
    clouds.push(cl);
    return cl;
  };
  cloudAt(-6, 3.5, -8, 1.2);
  cloudAt(5.5, 6, -10, 1.5);
  cloudAt(-3.5, 9.5, -9, 1.0);
  cloudAt(6, 11.5, -7, 0.8);

  // Gooby's ride: his own little cloud
  const rider = new THREE.Group();
  const rideCloud = cloudAt(0, 0, 0, 0.9);
  stage.group.remove(rideCloud);
  clouds.pop();
  rideCloud.position.set(0, -0.55, 0);
  rider.add(rideCloud);
  const gooby = stage.gooby({ clip: 'idle', clipSpeed: 1, emotion: 'ecstatic' });
  gooby.group.position.y = 0.18; // perched ON the puff, not sunk into it
  rider.add(gooby.group);
  // soft moonbeam riding along so THEIR Gooby stays readable at night
  const beam = new THREE.PointLight('#ffe6c0', 4, 6, 2);
  beam.position.set(0.6, 1.4, 1.2);
  rider.add(beam);
  stage.onDispose(() => beam.dispose());
  stage.group.add(rider);

  let t = 0;
  return {
    tick(dt, p) {
      t += dt;
      const pose = goobyPose('nightSky', p);
      rider.position.set(
        pose.position[0], pose.position[1] + Math.sin(t * 1.2) * 0.15, pose.position[2]
      );
      rider.rotation.z = Math.sin(t * 0.8) * 0.05;
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * 0.06 * (i % 2 === 0 ? 1 : -1);
      }
      starMats[0].opacity = 0.8 + Math.sin(t * 1.8) * 0.15;
      starMats[1].opacity = 0.85 + Math.sin(t * 1.2 + 1) * 0.15;
      gooby.update(dt);
    },
  };
}

/** #8 Spielzeugzimmer — toy-track lap in a toy kart, furniture skyline. */
function buildToyRoom(stage) {
  const floorTex = proceduralTexture('floorWood');
  floorTex.repeat.set(5, 5);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 });
  const floor = stage.own(new THREE.Mesh(new THREE.PlaneGeometry(28, 20), floorMat));
  floor.rotation.x = -Math.PI / 2;
  stage.group.add(floor);

  stage.lights({
    hemiSky: '#fff1dd', hemiGround: '#b89a80', hemiI: 1.0,
    dirColor: '#ffdfae', dirI: 1.0, dirPos: [4, 7, 5],
  });
  stage.accentLight('#ffcf8a', 5, 6, [-5.5, 2.2, -2]);

  stage.prop('furniture-kit/rugRound', 3.5, { x: 2.4, y: 0.01, z: -2.2, rest: false });
  for (let i = 0; i < 8; i++) {
    stage.prop('toy-car-kit/track-narrow-straight', 1.6, {
      x: -5.6 + i * 1.6, y: 0.03, z: i % 2 === 0 ? 0 : -0.15, rotY: Math.PI / 2,
    });
  }
  stage.prop('toy-car-kit/gate-finish', 1.3, { x: 1.2, y: 0.03, z: 0, rotY: Math.PI / 2 });
  stage.prop('toy-car-kit/gate', 1.2, { x: -4.4, y: 0.03, z: -0.1, rotY: Math.PI / 2 });
  stage.prop('toy-car-kit/item-box', 0.35, { x: -1.4, y: 0.03, z: 0.9, rotY: 0.5 });
  stage.prop('toy-car-kit/item-box', 0.32, { x: 2.6, y: 0.03, z: -1.2, rotY: 1.2 });
  stage.prop('toy-car-kit/item-cone', 0.3, { x: 0.2, y: 0.03, z: 1.1 });
  stage.prop('toy-car-kit/item-cone', 0.3, { x: 3.8, y: 0.03, z: 0.8 });
  stage.prop('toy-car-kit/item-banana', 0.32, { x: -2.8, y: 0.03, z: -1.3, rotY: 2 });
  stage.prop('furniture-kit/bear', 1.1, { x: 4.6, z: -3.4, rotY: -0.7 });
  stage.prop('furniture-kit/bookcaseOpenLow', 2.0, { x: -4.8, z: -4.4 });
  stage.prop('furniture-kit/books', 0.5, { x: -3.4, z: -3.8, rotY: 0.4 });
  stage.prop('furniture-kit/books', 0.45, { x: 6.2, z: -1.8, rotY: 1.8 });
  stage.prop('furniture-kit/lampRoundFloor', 2.2, { x: -6.4, z: -3.2 });
  // a parked rival toy car
  stage.prop('car-kit/police', 0.85, { x: 5.4, y: 0.02, z: 1.6, rotY: 2.6 });

  // Gooby's toy kart (car-kit race + wheels, toyRacer pattern, mini scale)
  const kart = new THREE.Group();
  const body = ground(fitModel(stage.assets.getModel('car-kit/race'), 0.95));
  kart.add(body);
  const box = new THREE.Box3().setFromObject(body);
  const wx = (box.max.x - box.min.x) * 0.34;
  const wz = (box.max.z - box.min.z) * 0.3;
  const wheels = [];
  for (const [x, z] of [[wx, wz], [-wx, wz], [wx, -wz], [-wx, -wz]]) {
    const wheel = fitModel(stage.assets.getModel('car-kit/wheel-default'), 0.2);
    wheel.position.set(x, 0.1, z);
    kart.add(wheel);
    wheels.push(wheel);
  }
  const gooby = stage.gooby({ clip: 'sitDrive' });
  gooby.group.position.set(0, 0.3, -0.02);
  kart.add(gooby.group);
  stage.group.add(kart);

  return {
    tick(dt, p) {
      const pose = goobyPose('toyRoom', p);
      kart.position.set(pose.position[0], pose.position[1], pose.position[2]);
      kart.rotation.y = pose.yaw;
      for (const w of wheels) w.rotation.x += dt * 10;
      gooby.update(dt);
    },
  };
}

const BUILDERS = Object.freeze({
  meadow: buildMeadow,
  city: buildCity,
  harbor: buildHarbor,
  space: buildSpace,
  spookGarden: buildSpookGarden,
  bakery: buildBakery,
  nightSky: buildNightSky,
  toyRoom: buildToyRoom,
});

// scratch objects for the camera dolly (no per-frame allocation)
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

/**
 * Build ONE biome vignette into the shared recap scene (contract in the
 * module header). §B5.4: only one vignette exists at a time — dispose the
 * previous handle on (or right before) the next cut cue.
 * @param {string} id biome id (VIGNETTE_IDS / DEFAULT_BIOMES order)
 * @param {THREE.Scene} scene
 * @param {object} assets core/assets (RECAP_ASSET_KEYS preloaded)
 * @param {{camera?: THREE.PerspectiveCamera}} [opts]
 * @returns {{id: string, group: THREE.Group, durSec: number,
 *   update: (dt: number, progress?: number) => void,
 *   dollyPose: (progress: number) => object, dispose: () => void}}
 */
export function buildVignette(id, scene, assets, opts = {}) {
  const builder = BUILDERS[id];
  if (!builder) throw new Error(`[recap] unknown vignette '${id}'`);
  const spec = VIGNETTE_SPECS[id];
  const stage = createStage(id, scene, assets);
  stage.backdrop();
  const body = builder(stage);
  const camera = opts.camera ?? null;
  let disposed = false;
  let loopT = 0;

  return {
    id,
    group: stage.group,
    durSec: spec.durSec,
    update(dt, progress) {
      if (disposed) return;
      const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0.016;
      let p;
      if (progress == null) {
        loopT = (loopT + step) % spec.durSec;
        p = loopT / spec.durSec;
      } else {
        p = clamp(Number(progress) || 0, 0, 1);
      }
      body.tick(step, p);
      if (camera) {
        const pose = dollyPoseOf(id, p);
        _pos.set(pose.position[0], pose.position[1], pose.position[2]);
        _look.set(pose.look[0], pose.look[1], pose.look[2]);
        camera.position.copy(_pos);
        camera.lookAt(_look);
        if (pose.rollDeg) camera.rotateZ((pose.rollDeg * Math.PI) / 180);
        if (camera.fov !== pose.fov) {
          camera.fov = pose.fov;
          camera.updateProjectionMatrix();
        }
      }
    },
    dollyPose(progress) {
      return dollyPoseOf(id, progress);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stage.dispose();
    },
  };
}

/**
 * The literal per-biome builder registry (team contract spelling):
 * VIGNETTES[id].build(scene, assets, opts) — same handles as buildVignette.
 * @type {Readonly<Record<string, {build: Function}>>}
 */
export const VIGNETTES = Object.freeze(
  Object.fromEntries(
    VIGNETTE_IDS.map((id) => [
      id,
      Object.freeze({ build: (scene, assets, opts) => buildVignette(id, scene, assets, opts) }),
    ])
  )
);
