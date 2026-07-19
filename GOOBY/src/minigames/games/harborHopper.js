// Harbor Hopper (PLAN3 §C10.1 #4, agent V3/G42): steer a watercraft-kit
// fishing boat down a teal harbor channel at dawn — auto-forward 6 m/s,
// drag to steer (momentum-heavy), collect floating crates (+4) and net rings
// (+2), dodge buoys/piers (−3 + slow, 70 % hitboxes). Wave bands roll toward
// the boat: riding a crest at its foamy sweet spot = +30 % surf-boost for
// 2 s, chainable. Idle > 4 s in one lane with cargo → a seagull honks, then
// steals the top crate. Tap = Fischkutter-Horn (clears buoys in a 6 m cone,
// 2 charges). Pure rules live in harborHopper.logic.js. Distinct look
// (§C10.1): teal harbor morning — sandstone quays, low warm sun, mist.
// Dev-only ?autoplay=1: greedy crate-path bot that centers wave crests.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { getAchievementsEngine } from '../../systems/achievementsEngine.js';
import { clampFloatTextToView } from '../framework.js';
import {
  HARBOR,
  applyDifficulty, // V4/G74 §G5.3
  applyModifier, //   V4/G74 §C-SYS4.3
  createEngine,
  createBot,
  speedOf,
  hopperScore,
} from './harborHopper.logic.js';

/** Sky/mist tint (teal harbor morning — §C10.1 distinct-look rule). */
const SKY = 0xBDE8E2;
const CAM_OFFSET = Object.freeze([0, 3.3, -5.2]);
const CAM_LOOK_AHEAD = 7;
/** Quay wall x (channel half width + wall half thickness). */
const WALL_X = HARBOR.CHANNEL_HALF_W + 1.15;
/** Recycled scenery rows (mooring posts + arrows) spaced this far apart. */
const DECOR_SPACING_M = 16;

/** Wrap a GLB so its bounding-box center sits at the wrapper's origin. */
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

/** Scrolling teal water texture (soft ripple bands + morning sparkle). */
function makeWaterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#2F8F8A';
  g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 8) {
    const a = 0.05 + 0.05 * Math.sin(y * 0.4);
    g.fillStyle = `rgba(220,250,245,${a})`;
    g.fillRect(0, y, 128, 3);
  }
  for (let i = 0; i < 40; i += 1) {
    g.fillStyle = `rgba(255,244,214,${0.06 + Math.random() * 0.1})`;
    g.fillRect(Math.random() * 128, Math.random() * 256, 2 + Math.random() * 5, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 8);
  return tex;
}

/** Harbor-town silhouette backdrop (rooftops + cranes in the morning mist). */
function makeTownTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(189,232,226,0)');
  grad.addColorStop(1, 'rgba(150,200,196,0.9)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(96,140,150,0.55)';
  let x = 0;
  while (x < 256) {
    const w = 14 + Math.random() * 22;
    const h = 22 + Math.random() * 44;
    g.fillRect(x, 128 - h, w, h);
    if (Math.random() < 0.3) g.fillRect(x + w * 0.3, 128 - h - 9, 3, 9); // chimney/mast
    x += w + 3;
  }
  // two harbor cranes
  for (const cx of [60, 190]) {
    g.strokeStyle = 'rgba(80,120,130,0.6)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, 128);
    g.lineTo(cx, 46);
    g.lineTo(cx + 34, 58);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial glow sprite texture. */
function makeGlowTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** Tiny floating score text (canvas sprites, self-disposing) — G8 recipe. */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#FFFFFF') {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(20,50,52,0.9)';
      g.strokeText(text, 100, 40);
      g.fillStyle = color;
      g.fillText(text, 100, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.7, halfH: 0.3 }));
      sprite.scale.set(1.5, 0.6, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.9 });
    },
    update(dt) {
      for (const f of active) {
        f.age += dt;
        f.sprite.position.y += dt * 1.1;
        f.mat.opacity = 1 - (f.age / f.life) ** 2;
        if (f.age >= f.life) {
          f.sprite.parent?.remove(f.sprite);
          f.mat.dispose();
          f.tex.dispose();
          active.delete(f);
        }
      }
    },
    dispose() {
      for (const f of active) {
        f.sprite.parent?.remove(f.sprite);
        f.mat.dispose();
        f.tex.dispose();
      }
      active.clear();
    },
  };
}

/** @type {object} §E8 plugin */
export default {
  id: 'harborHopper',
  assetKeys: [
    'watercraft-kit/boat-fishing-small',
    'watercraft-kit/buoy',
    'watercraft-kit/buoy-flag',
    'watercraft-kit/arrow-standing',
    'kaykit-city/box_A',
  ],
  /** §B2.3 warm-cache hints (framework preloads fire-and-forget). */
  sfx: ['harbor.crate', 'harbor.ring', 'harbor.bump', 'harbor.horn'],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    // dev-only CDP probe handle (§E9 harness pattern — evals force depth
    // features like gull steals / horn cones without waiting for RNG)
    if (import.meta.env?.DEV) window.__g42harbor = this;

    // ── V4/G74 (§G5.3 + §C-SYS4.3/§E0.1-3): derive the tune from
    // ctx.params.difficulty + the plain-number modifier payload (muenzregen/
    // turbo/riesenGooby rows for harborHopper). Mittel without modifier
    // returns the frozen HARBOR table itself — bit-identical. ──
    const difficulty = ctx.params?.difficulty ?? 'normal';
    this.tune = applyModifier(applyDifficulty(HARBOR, difficulty), ctx.params?.modifier);
    this.engine = createEngine(ctx.rng, this.tune);
    this.bot = this.autoplay ? createBot(this.tune) : null;
    if (import.meta.env?.DEV) {
      globalThis.__g74 = { game: 'harborHopper', difficulty, tune: this.tune, engine: this.engine }; // V4/G74 CDP probe
    }
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.endT = 0;
    this.shownScore = 0;
    this.boosts = 0;
    this.dragX = null; // manual steering target (m), null = coast
    this.hornQueued = false;

    const scene = ctx.scene;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 26, 78);
    ctx.camera.position.set(...CAM_OFFSET);
    ctx.camera.lookAt(0, 0.8, CAM_LOOK_AHEAD);

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    /** @type {THREE.Texture[]} */
    this.ownedTexs = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    // --- morning light: warm low sun + teal hemisphere ----------------------
    scene.add(new THREE.HemisphereLight(0xD8F5EF, 0x1F5F5C, 1.05));
    const sun = new THREE.DirectionalLight(0xFFE3B8, 1.0);
    sun.position.set(-6, 4.5, 10);
    scene.add(sun);
    // sun disc glow low over the town
    this.glowTexSun = makeGlowTexture('rgba(255,214,150,0.95)');
    this.ownedTexs.push(this.glowTexSun);
    const sunMat = new THREE.SpriteMaterial({
      map: this.glowTexSun, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ownedMats.push(sunMat);
    const sunSprite = new THREE.Sprite(sunMat);
    sunSprite.position.set(-8, 4.2, 52);
    sunSprite.scale.set(9, 9, 1);
    scene.add(sunSprite);

    // --- water (scrolling texture) + town backdrop --------------------------
    this.waterTex = makeWaterTexture();
    this.ownedTexs.push(this.waterTex);
    const water = own(new THREE.Mesh(
      new THREE.PlaneGeometry(WALL_X * 2 + 6, 90),
      new THREE.MeshBasicMaterial({ map: this.waterTex })
    ));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0, 30);
    scene.add(water);
    this.townTex = makeTownTexture();
    this.ownedTexs.push(this.townTex);
    const town = own(new THREE.Mesh(
      new THREE.PlaneGeometry(46, 9),
      new THREE.MeshBasicMaterial({ map: this.townTex, transparent: true, depthWrite: false })
    ));
    town.position.set(0, 3.2, 46);
    town.rotation.y = Math.PI; // face the chase camera (it looks down +z)
    scene.add(town);

    // --- quay walls (sandstone) + recycled mooring-post/arrow decor ---------
    this.quayMat = new THREE.MeshStandardMaterial({ color: '#C9B291', roughness: 0.9 });
    this.quayTopMat = new THREE.MeshStandardMaterial({ color: '#B7A183', roughness: 0.9 });
    this.postMat = new THREE.MeshStandardMaterial({ color: '#7A5C43', roughness: 0.85 });
    this.ownedMats.push(this.quayMat, this.quayTopMat, this.postMat);
    this.wallGeo = new THREE.BoxGeometry(2.3, 1.5, 90);
    this.wallCapGeo = new THREE.BoxGeometry(2.5, 0.18, 90);
    this.ownedGeos.push(this.wallGeo, this.wallCapGeo);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(this.wallGeo, this.quayMat);
      wall.position.set(side * WALL_X, 0.45, 30);
      scene.add(wall);
      const cap = new THREE.Mesh(this.wallCapGeo, this.quayTopMat);
      cap.position.set(side * WALL_X, 1.28, 30);
      scene.add(cap);
    }
    this.postGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.55, 8);
    this.ownedGeos.push(this.postGeo);
    /** @type {Array<{grp: THREE.Group, baseM: number}>} recycled decor rows */
    this.decorRows = [];
    const rowCount = Math.ceil(70 / DECOR_SPACING_M) + 1;
    for (let i = 0; i < rowCount; i += 1) {
      const grp = new THREE.Group();
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(this.postGeo, this.postMat);
        post.position.set(side * (WALL_X - 0.9), 1.6, 0);
        grp.add(post);
      }
      if (i % 2 === 0) {
        const arrow = fitModel(ctx.assets.getModel('watercraft-kit/arrow-standing'), 0.9);
        arrow.position.set(WALL_X - 0.9, 1.95, DECOR_SPACING_M / 2);
        grp.add(arrow);
      }
      scene.add(grp);
      this.decorRows.push({ grp, baseM: i * DECOR_SPACING_M });
    }

    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);

    // --- player boat (watercraft-kit fishing boat) + Gooby ------------------
    this.boat = new THREE.Group();
    const hull = fitModel(ctx.assets.getModel('watercraft-kit/boat-fishing-small'), 2.1);
    hull.rotation.y = Math.PI; // bow forward (+z)
    hull.position.y = 0.32;
    this.boat.add(hull);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    // V4/G74 §C-SYS4.3 riesenGooby: render scale multiplies the base 0.5
    // (RENDER_SCALE_MULT = 1 in every other mode — bit-identical).
    this.gooby.group.scale.setScalar(0.5 * this.tune.RENDER_SCALE_MULT);
    this.gooby.group.position.set(0, 0.55, -0.35);
    this.gooby.group.rotation.y = Math.PI; // face down-channel with the bow
    this.gooby.play('sitDrive');
    this.gooby.setEmotion('happy');
    this.boat.add(this.gooby.group);
    // crates stack up on the bow deck as cargo comes aboard (kept ahead of
    // Gooby so the pilot stays visible from the chase camera)
    this.deckCrateGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
    this.deckCrateMat = new THREE.MeshStandardMaterial({ color: '#B08968', roughness: 0.8 });
    this.ownedGeos.push(this.deckCrateGeo);
    this.ownedMats.push(this.deckCrateMat);
    /** @type {THREE.Mesh[]} */
    this.deckCrates = [];
    for (let i = 0; i < 6; i += 1) {
      const c = new THREE.Mesh(this.deckCrateGeo, this.deckCrateMat);
      c.position.set(i % 2 === 0 ? -0.14 : 0.14, 0.58 + Math.floor(i / 2) * 0.25, 0.72);
      c.rotation.y = (i * 0.7) % 0.5;
      c.visible = false;
      this.boat.add(c);
      this.deckCrates.push(c);
    }
    this.boat.position.set(0, 0, 0);
    scene.add(this.boat);
    // boost glow under the hull
    this.glowTexBoost = makeGlowTexture('rgba(170,255,240,0.9)');
    this.ownedTexs.push(this.glowTexBoost);
    const boostMat = new THREE.SpriteMaterial({
      map: this.glowTexBoost, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ownedMats.push(boostMat);
    this.boostGlow = new THREE.Sprite(boostMat);
    this.boostGlow.position.set(0, 0.15, -0.9);
    this.boostGlow.scale.set(1.6, 0.8, 1);
    this.boostGlow.visible = false;
    this.boat.add(this.boostGlow);

    // --- item views (crate/ring/buoy meshes pooled per logic item) ----------
    this.ringGeo = new THREE.TorusGeometry(0.42, 0.13, 10, 22);
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#FF8552', roughness: 0.6 });
    this.ownedGeos.push(this.ringGeo);
    this.ownedMats.push(this.ringMat);
    /** @type {Map<object, THREE.Object3D>} logic item → mesh */
    this.itemViews = new Map();
    /** @type {{crate: THREE.Object3D[], ring: THREE.Object3D[], buoy: THREE.Object3D[]}} */
    this.itemPool = { crate: [], ring: [], buoy: [] };
    this.buoyToggle = 0;

    // --- pier views (procedural plank fingers, created lazily) --------------
    this.pierPlankMat = new THREE.MeshStandardMaterial({ color: '#8A6A4E', roughness: 0.85 });
    this.pierPostMat = this.postMat;
    this.ownedMats.push(this.pierPlankMat);
    /** @type {Map<object, THREE.Group>} logic pier → group */
    this.pierViews = new Map();

    // --- wave bands (foam stripe + sweet-spot highlight) ---------------------
    this.waveGeo = new THREE.PlaneGeometry(HARBOR.CHANNEL_HALF_W * 2, 0.9);
    this.waveMat = new THREE.MeshBasicMaterial({
      color: '#EAFBF7', transparent: true, opacity: 0.45, depthWrite: false,
    });
    this.sweetGeo = new THREE.PlaneGeometry(HARBOR.SWEET_HALF_W * 2, 0.95);
    this.sweetMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF', transparent: true, opacity: 0.85, depthWrite: false,
    });
    this.ownedGeos.push(this.waveGeo, this.sweetGeo);
    this.ownedMats.push(this.waveMat, this.sweetMat);
    /** @type {Map<object, {band: THREE.Mesh, sweet: THREE.Mesh}>} */
    this.waveViews = new Map();

    // --- seagull (procedural — circles on warn, dives on steal) -------------
    this.gull = new THREE.Group();
    const gullBodyGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const gullMat = new THREE.MeshStandardMaterial({ color: '#F4F7F7', roughness: 0.8 });
    const gullWingGeo = new THREE.BoxGeometry(0.5, 0.03, 0.16);
    const gullBeakGeo = new THREE.ConeGeometry(0.045, 0.14, 6);
    const gullBeakMat = new THREE.MeshBasicMaterial({ color: '#FFB347' });
    this.ownedGeos.push(gullBodyGeo, gullWingGeo, gullBeakGeo);
    this.ownedMats.push(gullMat, gullBeakMat);
    const gullBody = new THREE.Mesh(gullBodyGeo, gullMat);
    gullBody.scale.set(1, 0.8, 1.3);
    this.gull.add(gullBody);
    this.gullWings = [];
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(gullWingGeo, gullMat);
      wing.position.set(side * 0.3, 0.06, 0);
      this.gull.add(wing);
      this.gullWings.push({ wing, side });
    }
    const beak = new THREE.Mesh(gullBeakGeo, gullBeakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0, 0.24);
    this.gull.add(beak);
    const stolen = new THREE.Mesh(this.deckCrateGeo, this.deckCrateMat);
    stolen.scale.setScalar(0.7);
    stolen.position.y = -0.22;
    stolen.visible = false;
    this.gull.add(stolen);
    this.gullCrate = stolen;
    this.gull.visible = false;
    scene.add(this.gull);
    this.gullAnim = { mode: 'hidden', t: 0 }; // hidden | circle | dive | leave

    // --- horn cone flash (shown for a beat on use) ---------------------------
    this.hornConeGeo = new THREE.ConeGeometry(
      HARBOR.HORN_CONE_BASE + HARBOR.HORN_CONE_M * HARBOR.HORN_CONE_SPREAD,
      HARBOR.HORN_CONE_M,
      3,
      1,
      true
    );
    this.hornConeMat = new THREE.MeshBasicMaterial({
      color: '#FFE9A8', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ownedGeos.push(this.hornConeGeo);
    this.ownedMats.push(this.hornConeMat);
    this.hornCone = new THREE.Mesh(this.hornConeGeo, this.hornConeMat);
    this.hornCone.rotation.x = -Math.PI / 2; // cone opens down-channel
    this.hornCone.position.set(0, 0.25, HARBOR.HORN_CONE_M / 2);
    this.boat.add(this.hornCone);
    this.hornFlashT = 0;

    // --- crates + horn HUD chip ----------------------------------------------
    this.chip = document.createElement('div');
    this.chip.className = 'mg-pill';
    this.chip.style.cssText =
      'position:absolute;top:calc(64px + var(--safe-top));left:50%;transform:translateX(-50%);z-index:35;white-space:nowrap;';
    (document.getElementById('ui') ?? document.body).appendChild(this.chip);
    this.updateChip(true);

    // --- input: drag = steer (momentum), tap = horn (§C10.1 controls) -------
    // V4/G57 (PLAN4-GAMES §G3.1-c, §G2.1 rule 1): the chase camera looks
    // down world +z, so world +x renders on the screen LEFT — analog input
    // targeting logic (= world) space must mirror at exactly this ONE input
    // boundary. Drag right (nx +1) → target −x → rendered SCREEN RIGHT. ✅
    // The logic bot passes targetX in logic space and stays consistent;
    // waves/buoys/seagull are chirality-symmetric.
    this.offDrag = ctx.input.on('drag', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      this.dragX = -p.nx * HARBOR.CHANNEL_HALF_W * 1.25; // §G3.1-c input mirror; over-reach for full range
    });
    this.offDragEnd = ctx.input.on('dragend', () => {
      this.dragX = null; // release: momentum carries the boat (coast)
    });
    this.offTap = ctx.input.on('tap', () => {
      if (this.autoplay || this.phase !== 'play') return;
      this.hornQueued = true;
    });

    ctx.hud.setScore(0);
    // V4/G74 §G5.4: Endlos counts up (no round timer), timed modes count down
    ctx.hud.setTime(this.tune.ENDLESS ? 0 : this.tune.DURATION_SEC);
    ctx.hud.banner(t('mg.harbor.hint'));
  },

  /** HUD chip text (crates aboard + horn charges). */
  updateChip(force) {
    const s = this.engine.state;
    const txt = `📦 ${s.crates} · 📯 ${s.hornCharges}`;
    if (force || this.chipTxt !== txt) {
      this.chipTxt = txt;
      this.chip.textContent = txt;
    }
  },

  /** Take (or build) an item mesh for a logic item. */
  takeItemView(item) {
    const pool = this.itemPool[item.type];
    let view = pool.pop();
    if (!view) {
      if (item.type === 'crate') {
        view = fitModel(this.ctx.assets.getModel('kaykit-city/box_A'), 0.72);
      } else if (item.type === 'ring') {
        const grp = new THREE.Group();
        const torus = new THREE.Mesh(this.ringGeo, this.ringMat);
        torus.rotation.x = -Math.PI / 2;
        grp.add(torus);
        view = grp;
      } else {
        // alternate the two committed buoy models for variety
        const key = this.buoyToggle % 2 === 0 ? 'watercraft-kit/buoy' : 'watercraft-kit/buoy-flag';
        this.buoyToggle += 1;
        view = fitModel(this.ctx.assets.getModel(key), 1.15);
        view.userData.buoy = true;
      }
      view.userData.type = item.type;
    }
    view.visible = true;
    this.ctx.scene.add(view);
    return view;
  },

  releaseItemView(item, view) {
    view.visible = false;
    this.ctx.scene.remove(view);
    this.itemPool[item.type].push(view);
    this.itemViews.delete(item);
  },

  /** Build a pier finger group (planks + posts) reaching from `side`. */
  makePierView(pier) {
    const grp = new THREE.Group();
    const reach = HARBOR.PIER_REACH_M;
    const plankGeo = new THREE.BoxGeometry(reach, 0.12, HARBOR.PIER_DEPTH_M);
    this.ownedGeos.push(plankGeo);
    const plank = new THREE.Mesh(plankGeo, this.pierPlankMat);
    plank.position.set(pier.side * (HARBOR.CHANNEL_HALF_W - reach / 2), 0.42, 0);
    grp.add(plank);
    for (const dz of [-HARBOR.PIER_DEPTH_M / 2 + 0.12, HARBOR.PIER_DEPTH_M / 2 - 0.12]) {
      const post = new THREE.Mesh(this.postGeo, this.pierPostMat);
      post.position.set(pier.side * (HARBOR.CHANNEL_HALF_W - reach + 0.15), 0.1, dz);
      grp.add(post);
    }
    this.ctx.scene.add(grp);
    return grp;
  },

  /** Map one engine event onto scene/audio/HUD feedback. */
  onEvent(ev) {
    const ctx = this.ctx;
    const boatPos = this.boat.position;
    if (ev.type === 'crate') {
      ctx.audio.play('harbor.crate');
      this.floats.spawn('+4', boatPos.clone().add(new THREE.Vector3(0, 1, 0)), '#FFD166');
      this.particles.emit('sparkles', boatPos.clone().add(new THREE.Vector3(0, 0.6, 0)), { count: 5 });
    } else if (ev.type === 'ring') {
      ctx.audio.play('harbor.ring');
      this.floats.spawn('+2', boatPos.clone().add(new THREE.Vector3(0, 1, 0)), '#8AE0D2');
    } else if (ev.type === 'bump') {
      ctx.audio.play('harbor.bump');
      ctx.hud.banner(t('mg.harbor.bump'));
      this.floats.spawn('−3', boatPos.clone().add(new THREE.Vector3(0, 1, 0)), '#FF6B6B');
      this.particles.emit('bubbles', boatPos.clone().add(new THREE.Vector3(0, 0.3, 0)), { count: 8 });
      this.particles.emit('dizzyStars', boatPos.clone().add(new THREE.Vector3(0, 1.1, 0)));
      this.gooby.setEmotion('sad');
    } else if (ev.type === 'boost') {
      this.boosts += 1;
      ctx.audio.play('harbor.boost');
      ctx.hud.banner(ev.chain > 1
        ? t('mg.harbor.boostChain', { n: ev.chain })
        : t('mg.harbor.boost'));
      this.particles.emit('sparkles', boatPos.clone().add(new THREE.Vector3(0, 0.4, -0.8)), { count: 10 });
      this.gooby.setEmotion('ecstatic');
    } else if (ev.type === 'buoyCleared') {
      ctx.audio.play('harbor.horn');
      ctx.hud.banner(t('mg.harbor.horn', { n: ev.count }));
      this.hornFlashT = 0.5;
      this.particles.emit('bubbles', boatPos.clone().add(new THREE.Vector3(0, 0.3, 2.5)), { count: 10 });
      this.updateChip();
    } else if (ev.type === 'hornEmpty') {
      ctx.audio.play('harbor.hornEmpty');
      ctx.hud.banner(t('mg.harbor.hornEmpty'));
    } else if (ev.type === 'gullWarn') {
      ctx.audio.play('harbor.gullWarn');
      ctx.hud.banner(t('mg.harbor.gullWarn'));
      this.gullAnim = { mode: 'circle', t: 0 };
      this.gull.visible = true;
      this.gullCrate.visible = false;
    } else if (ev.type === 'gullSteal') {
      ctx.audio.play('harbor.gullSteal');
      ctx.hud.banner(t('mg.harbor.gullSteal'));
      this.floats.spawn('−4', boatPos.clone().add(new THREE.Vector3(0, 1.4, 0)), '#FF6B6B');
      this.gullAnim = { mode: 'leave', t: 0 };
      this.gullCrate.visible = true;
      this.gooby.setEmotion('sad');
    } else if (ev.type === 'gullLeave') {
      if (this.gullAnim.mode === 'circle') this.gullAnim = { mode: 'leave', t: 0 };
    } else if (ev.type === 'ended') {
      this.beginEnding();
    }
  },

  /** Round end beat (120 s horn). */
  beginEnding() {
    if (this.phase !== 'play') return;
    this.phase = 'ending';
    const s = this.engine.state;
    this.ctx.audio.play('ui.win');
    this.gooby.setEmotion('ecstatic');
    this.particles.emit('confetti', this.boat.position.clone().add(new THREE.Vector3(0, 1.4, 0)), { count: 16 });
    if (this.autoplay) {
      console.log(
        `[harborHopper] autoplay run ended — score ${s.score}, crates ${s.crates}, ` +
        `rings ${s.rings}, bumps ${s.bumps}, steals ${s.steals}, boosts ${this.boosts}, ` +
        `horns ${HARBOR.HORN_CHARGES - s.hornCharges}`
      );
    }
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);
    const state = this.engine.state;

    if (this.phase === 'ending') {
      this.endT += dt;
      // water keeps drifting on the end beat
      this.waterTex.offset.y -= dt * 0.4;
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        try {
          getAchievementsEngine()?.track?.('cratesShipped', state.crates);
        } catch (err) {
          console.warn('[harborHopper] counter tracking failed:', err);
        }
        // V4/G74 §C-SYS4.2: turbo's ×1.5 lands at the single payout seam
        ctx.onEnd({ score: hopperScore(state, this.tune), meta: { cratesShipped: state.crates } });
      }
      return;
    }

    // ---- engine step (sub-stepped so SwiftShader frame spikes keep real time)
    const control = this.autoplay
      ? this.bot.control(state, this.engine.items, this.engine.piers, this.engine.waves)
      : { targetX: this.dragX, horn: this.hornQueued };
    this.hornQueued = false;
    let rem = dt;
    let hornSent = false;
    for (let i = 0; i < 4 && rem > 1e-6 && this.phase === 'play'; i += 1) {
      const sdt = Math.min(rem, HARBOR.MAX_DT);
      const c = hornSent ? { ...control, horn: false } : control;
      hornSent = true;
      for (const ev of this.engine.step(c, sdt)) this.onEvent(ev);
      rem -= sdt;
    }

    ctx.hud.setTime(this.tune.ENDLESS ? state.elapsed : this.tune.DURATION_SEC - state.elapsed);
    // V4/G74: HUD mirrors the tune-scaled score (×1 without turbo)
    const shown = hopperScore(state, this.tune);
    if (shown !== this.shownScore) {
      ctx.onScore(shown - this.shownScore);
      this.shownScore = shown;
    }
    this.updateChip();
    // deck cargo mirrors the crates aboard (top crate is the gull's target)
    for (let i = 0; i < this.deckCrates.length; i += 1) {
      this.deckCrates[i].visible = i < Math.min(state.crates, this.deckCrates.length);
    }

    // ---- boat pose: lateral position + momentum lean + bob ----
    const speed = speedOf(state, this.tune); // V4/G74: Endlos ramp included
    this.boat.position.x = state.x;
    this.boat.position.y = Math.sin(elapsed * 2.1) * 0.05 + (state.boostT > 0 ? 0.06 : 0);
    this.boat.rotation.z = THREE.MathUtils.clamp(-state.vx * 0.14, -0.3, 0.3);
    this.boat.rotation.y = THREE.MathUtils.clamp(-state.vx * 0.08, -0.22, 0.22);
    this.boat.rotation.x = state.boostT > 0 ? -0.06 : 0;
    this.boostGlow.visible = state.boostT > 0;
    if (state.boostT > 0 && ctx.rng() < 0.4) {
      this.particles.emit('bubbles', this.boat.position.clone().add(new THREE.Vector3(0, 0, -1.5)), { count: 2 });
    }
    // wake bubbles at speed (behind the stern — clear of the pilot)
    if (ctx.rng() < 0.15) {
      this.particles.emit('bubbles', this.boat.position.clone().add(new THREE.Vector3(0, 0, -1.4)), { count: 1 });
    }

    // ---- world scroll: water texture + recycled quay decor ----
    // one texture repeat spans 90/8 = 11.25 wu → offset rate = speed / 11.25
    this.waterTex.offset.y -= dt * speed * 0.089;
    for (const row of this.decorRows) {
      const span = this.decorRows.length * DECOR_SPACING_M;
      let rel = (row.baseM - state.z) % span;
      if (rel < -DECOR_SPACING_M / 2) rel += span;
      row.grp.position.z = rel;
      row.grp.visible = rel > -8 && rel < 66;
    }

    // ---- items: sync mesh per live logic item (treadmill placement) ----
    const seen = new Set();
    for (const item of this.engine.items) {
      const rel = item.z - state.z;
      if (item.gone || rel < -8 || rel > 55) continue;
      let view = this.itemViews.get(item);
      if (!view) {
        view = this.takeItemView(item);
        this.itemViews.set(item, view);
      }
      seen.add(item);
      const bob = Math.sin(elapsed * 2 + item.z) * 0.05;
      if (item.type === 'ring') {
        view.position.set(item.x, 0.08 + bob * 0.4, rel);
        view.rotation.y += dt * 0.8;
      } else if (item.type === 'crate') {
        view.position.set(item.x, 0.22 + bob, rel);
        view.rotation.y += dt * 0.5;
      } else {
        view.position.set(item.x, 0.28 + bob, rel);
        view.rotation.z = Math.sin(elapsed * 1.6 + item.z) * 0.12;
      }
    }
    for (const [item, view] of this.itemViews) {
      if (!seen.has(item)) this.releaseItemView(item, view);
    }

    // ---- piers ----
    for (const pier of this.engine.piers) {
      const rel = pier.z - state.z;
      let view = this.pierViews.get(pier);
      if (rel > -10 && rel < 60) {
        if (!view) {
          view = this.makePierView(pier);
          this.pierViews.set(pier, view);
        }
        view.position.z = rel;
        view.visible = true;
      } else if (view) {
        this.ctx.scene.remove(view);
        this.pierViews.delete(pier);
      }
    }

    // ---- wave bands: foam stripe + bright sweet spot ----
    const seenWaves = new Set();
    for (const wave of this.engine.waves) {
      const rel = wave.z - state.z;
      if (rel < -6 || rel > 40) continue;
      let view = this.waveViews.get(wave);
      if (!view) {
        const band = new THREE.Mesh(this.waveGeo, this.waveMat);
        band.rotation.x = -Math.PI / 2;
        const sweet = new THREE.Mesh(this.sweetGeo, this.sweetMat);
        sweet.rotation.x = -Math.PI / 2;
        sweet.position.y = 0.01;
        this.ctx.scene.add(band, sweet);
        view = { band, sweet };
        this.waveViews.set(wave, view);
      }
      seenWaves.add(wave);
      const lift = wave.ridden ? 0.02 : 0.05 + Math.sin(elapsed * 6) * 0.02;
      view.band.position.set(0, lift, rel);
      view.sweet.position.set(wave.sweetX, lift + 0.01, rel);
      view.band.material.opacity = wave.ridden ? 0.18 : 0.45;
      view.sweet.visible = !wave.ridden;
    }
    for (const [wave, view] of this.waveViews) {
      if (!seenWaves.has(wave)) {
        this.ctx.scene.remove(view.band, view.sweet);
        this.waveViews.delete(wave);
      }
    }

    // ---- seagull animation (circle on warn / dive+leave on steal) ----
    if (this.gull.visible) {
      const anim = this.gullAnim;
      anim.t += dt;
      for (const { wing, side } of this.gullWings) {
        wing.rotation.z = side * Math.sin(anim.t * 14) * 0.6;
      }
      if (anim.mode === 'circle') {
        const a = anim.t * 3.2;
        this.gull.position.set(
          this.boat.position.x + Math.cos(a) * 1.3,
          2.1 + Math.sin(anim.t * 2) * 0.15,
          this.boat.position.z + Math.sin(a) * 1.3
        );
        this.gull.rotation.y = -a;
      } else if (anim.mode === 'leave') {
        this.gull.position.y += dt * 2.6;
        this.gull.position.z += dt * 6;
        this.gull.position.x += dt * (this.gull.position.x >= 0 ? 2 : -2);
        if (anim.t > 1.6) {
          this.gull.visible = false;
          this.gullAnim = { mode: 'hidden', t: 0 };
        }
      }
    } else if (state.gull.phase === 'warn' && this.gullAnim.mode === 'hidden') {
      // safety: warn began while the gull was hidden (shouldn't happen)
      this.gull.visible = true;
      this.gullAnim = { mode: 'circle', t: 0 };
    }

    // ---- horn cone flash ----
    if (this.hornFlashT > 0) {
      this.hornFlashT = Math.max(0, this.hornFlashT - dt);
      this.hornConeMat.opacity = 0.35 * (this.hornFlashT / 0.5);
    }
  },

  dispose() {
    if (import.meta.env?.DEV && window.__g42harbor === this) delete window.__g42harbor;
    this.offDrag?.();
    this.offDragEnd?.();
    this.offTap?.();
    this.chip?.remove();
    this.chip = null;
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    // GLB clones share cached geometries/materials — the framework scene sweep
    // handles GPU frees; drop references only.
    this.itemViews = new Map();
    this.itemPool = { crate: [], ring: [], buoy: [] };
    this.pierViews = new Map();
    this.waveViews = new Map();
    this.decorRows = [];
    this.deckCrates = [];
    this.gullWings = [];
    this.engine = null;
    this.bot = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.boat = null;
    this.gull = null;
    this.gullCrate = null;
    this.boostGlow = null;
    this.hornCone = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
