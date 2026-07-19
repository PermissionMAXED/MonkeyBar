// Star Hopper (PLAN2 §C1.2 #8, agent V2/G25): Gooby pilots a space-kit
// speeder up a dark starfield in 3 lanes — the arcade's ONLY night look
// (§C1.3: dark starfield + nebula gradient). Meteors tumble down with 70%
// forgiving hitboxes; star pickups +3 and rare golden carrots +10 drift
// between lanes; speed +5%/10 s; meteor showers are telegraphed by warning
// stripes; one hit = end (a single shield pickup spawns at score ≥ 60).
// Score = distanceM/10 + pickups. Pure rules live in starHopper.logic.js.
// Dev-only ?autoplay=1: greedy highest-value-safe-lane bot per 0.4 s window.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
// V4/G67 (PLAN4-GAMES §G4.8 rollout — lightest dose): planar edge streaks
// falling with the starfield + a subtle +6 FOV kick over the climb ramp.
// No shake, no banners (the shower drama owns those beats here).
import {
  HOPPER_FX,
  speedFovTarget,
  fovLerp,
  streakRate,
  createSpeedLines,
} from '../../gfx/speedLines.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { clampFloatTextToView } from '../framework.js';
import {
  HOPPER,
  speedAt,
  hopperScore,
  laneAfterGesture,
  sweepHitsMeteor,
  generateRow,
  rollPickup,
  shouldSpawnShield,
  shouldSpawnWormhole,
  wormholeAwards,
  pickShowerLanes,
  resolveHit,
  laneOutlook,
  planMove,
} from './starHopper.logic.js';

/** World units per track meter (visual scale of the scroll). */
const WU_PER_M = 0.12;
/** Craft y on screen (wu). */
const CRAFT_Y = -2.7;
/** Meteors/pickups spawn this many meters ahead of the craft. */
const LOOKAHEAD_M = 70;
const METEOR_MODELS = ['meteor', 'meteor_detailed', 'meteor_half'];

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

/** Nebula gradient backdrop texture (§C1.3 night look) — one canvas, one plane. */
function makeNebulaTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = '#080B20';
  g.fillRect(0, 0, 256, 512);
  const blob = (x, y, r, color) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(8,11,32,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 512);
  };
  blob(60, 110, 150, 'rgba(96,58,160,0.55)'); // violet
  blob(210, 240, 170, 'rgba(160,60,140,0.42)'); // magenta
  blob(90, 400, 160, 'rgba(40,110,150,0.45)'); // teal
  blob(190, 60, 90, 'rgba(220,120,180,0.22)'); // pink wisp
  // faint distant stars baked into the nebula
  for (let i = 0; i < 90; i += 1) {
    g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
    g.fillRect(Math.random() * 256, Math.random() * 512, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial glow sprite texture (pickup halos). */
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

/** Flat 5-point star geometry (pickups). */
function makeStarGeometry(outer = 0.22, inner = 0.09) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** Tiny floating score text (canvas sprites, self-disposing) — G8 recipe. */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#FFFFFF') {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 44px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(10,12,36,0.9)';
      g.strokeText(text, 80, 40);
      g.fillStyle = color;
      g.fillText(text, 80, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.55, halfH: 0.28 }));
      sprite.scale.set(1.1, 0.55, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.85 });
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
  id: 'starHopper',
  assetKeys: [
    'space-kit/craft_speederA',
    ...METEOR_MODELS.map((m) => `space-kit/${m}`),
    'food-kit/carrot', // golden carrot pickup (gold-tinted clone)
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.traveled = 0; // track meters climbed
    this.distPoints = 0;
    this.pickupPoints = 0;
    this.lane = 1;
    this.craftX = 0;
    this.shielded = false;
    this.shieldSpawned = false;
    this.invulnT = 0;
    this.endT = 0;
    this.botT = 0;
    this.swipeTapSuppressT = 0;
    this.wormhole = { spawned: false, active: false, t: 0, stars: 0, gate: null };
    // shower state machine: 'idle' | 'telegraph' | 'active'
    this.shower = { state: 'idle', t: 0, lanes: null, dropT: 0, nextAt: HOPPER.SHOWER_EVERY_SEC };
    this.lastRowM = 26; // first row spawns a friendly bit ahead
    /** @type {import('./starHopper.logic.js').MeteorRow[]} */
    this.recentRows = [];

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#070A1C'); // §C1.3: the set's only night look

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

    // --- backdrop: nebula gradient + two scrolling starfield layers ---
    this.nebulaTex = makeNebulaTexture();
    this.ownedTexs.push(this.nebulaTex);
    const nebula = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 4, this.halfH * 2 + 4),
      new THREE.MeshBasicMaterial({ map: this.nebulaTex, depthWrite: false })
    ));
    nebula.position.set(0, 0, -6);
    scene.add(nebula);

    /** @type {Array<{points: THREE.Points, speed: number, arr: Float32Array}>} */
    this.starLayers = [];
    for (const [count, size, speedMul, color] of [
      [110, 0.05, 0.28, '#9FB6E8'],
      [70, 0.09, 0.55, '#FFFFFF'],
    ]) {
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        arr[i * 3] = (Math.random() * 2 - 1) * (this.halfW + 1);
        arr[i * 3 + 1] = (Math.random() * 2 - 1) * (this.halfH + 1);
        arr[i * 3 + 2] = -4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, depthWrite: false });
      const points = new THREE.Points(geo, mat);
      this.ownedGeos.push(geo);
      this.ownedMats.push(mat);
      scene.add(points);
      this.starLayers.push({ points, speed: speedMul, arr });
    }

    // ── V4/G67 (PLAN4-GAMES §G4.8 rollout — lightest dose): edge streaks in
    // planar mode (they fall −y with the starfield, along the left/right
    // screen edges) + a +6 FOV kick over the 11→19 climb band. The set's
    // margins (nebula +4 wu, star respawn +1, stripes +1) still cover the
    // kicked frustum at every REACHABLE speed (75 s ramp tops out ≈ 15.5).
    this.baseFov = camera.fov;
    this.speedLines = createSpeedLines(scene, {
      pool: HOPPER_FX.STREAK_POOL,
      size: HOPPER_FX.STREAK_SIZE,
      life: HOPPER_FX.STREAK_LIFE,
      velocityScale: HOPPER_FX.STREAK_VEL,
      planar: true,
      bounds: { halfW: this.halfW, top: this.halfH, z: -2 },
      rng: ctx.rng,
    });
    if (import.meta.env?.DEV) window.__hopper = { game: this }; // V4/G67 CDP probe
    // ── end V4/G67 init ─────────────────────────────────────────────────────

    // night lighting: cool moonlit hemi + soft directional
    scene.add(new THREE.HemisphereLight(0x9FB2FF, 0x1A1030, 1.05));
    const dir = new THREE.DirectionalLight(0xBFD0FF, 0.85);
    dir.position.set(2, 4, 5);
    scene.add(dir);

    // --- player craft (space-kit speeder) + Gooby riding it ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);
    this.craft = new THREE.Group();
    const speeder = fitModel(ctx.assets.getModel('space-kit/craft_speederA'), 1.3);
    speeder.rotation.set(Math.PI / 2, 0, Math.PI); // nose up-screen, top to camera
    this.craft.add(speeder);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.42);
    this.gooby.group.position.set(0, -0.05, 0.45);
    this.gooby.play('sitDrive');
    this.gooby.setEmotion('happy');
    this.craft.add(this.gooby.group);
    // engine glow
    this.glowTexBlue = makeGlowTexture('rgba(120,200,255,0.9)');
    this.ownedTexs.push(this.glowTexBlue);
    const engineMat = new THREE.SpriteMaterial({ map: this.glowTexBlue, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ownedMats.push(engineMat);
    this.engineGlow = new THREE.Sprite(engineMat);
    this.engineGlow.position.set(0, -0.75, 0.1);
    this.engineGlow.scale.set(0.7, 1.1, 1);
    this.craft.add(this.engineGlow);
    // shield bubble (hidden until earned)
    const bubbleMat = new THREE.MeshBasicMaterial({ color: '#63E0FF', transparent: true, opacity: 0.28, depthWrite: false });
    this.bubble = own(new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 14), bubbleMat));
    this.bubble.visible = false;
    this.craft.add(this.bubble);
    this.craft.position.set(0, CRAFT_Y, 0.2);
    scene.add(this.craft);

    // --- shower warning stripes (one per lane, hidden) ---
    this.stripeTex = makeGlowTexture('rgba(255,90,90,0.85)');
    this.ownedTexs.push(this.stripeTex);
    /** @type {THREE.Mesh[]} */
    this.stripes = [];
    for (let i = 0; i < HOPPER.LANES; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ color: '#FF4D5E', transparent: true, opacity: 0, depthWrite: false });
      const stripe = own(new THREE.Mesh(new THREE.PlaneGeometry(1.0, this.halfH * 2 + 1), mat));
      stripe.position.set(HOPPER.LANE_X[i], 0, -1.5);
      scene.add(stripe);
      this.stripes.push(stripe);
    }

    // --- shared pickup resources ---
    this.starGeo = makeStarGeometry();
    this.ownedGeos.push(this.starGeo);
    this.starMat = new THREE.MeshBasicMaterial({ color: '#FFE066', side: THREE.DoubleSide });
    this.ownedMats.push(this.starMat);
    this.glowTexGold = makeGlowTexture('rgba(255,210,90,0.9)');
    this.ownedTexs.push(this.glowTexGold);
    this.glowMatGold = new THREE.SpriteMaterial({ map: this.glowTexGold, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowMatShield = new THREE.SpriteMaterial({ map: this.glowTexBlue, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ownedMats.push(this.glowMatGold, this.glowMatShield);
    this.shieldRingGeo = new THREE.TorusGeometry(0.26, 0.06, 8, 20);
    this.shieldRingMat = new THREE.MeshBasicMaterial({ color: '#63E0FF' });
    this.ownedGeos.push(this.shieldRingGeo);
    this.ownedMats.push(this.shieldRingMat);
    this.wormholeGeo = new THREE.TorusGeometry(0.55, 0.075, 10, 28);
    this.wormholeMat = new THREE.MeshBasicMaterial({
      color: '#C77DFF', transparent: true, opacity: 0.85, depthWrite: false,
    });
    this.ownedGeos.push(this.wormholeGeo);
    this.ownedMats.push(this.wormholeMat);
    this.tunnelRings = [];
    for (let i = 0; i < 8; i += 1) {
      const ring = new THREE.Mesh(this.wormholeGeo, this.wormholeMat);
      ring.visible = false;
      ring.position.z = -0.4 - i * 0.15;
      scene.add(ring);
      this.tunnelRings.push(ring);
    }
    /** @type {THREE.Material[]} gold-carrot cloned materials (per spawn) */
    this.goldMats = [];

    // --- live object lists + meteor model pool ---
    /** @type {Array<{holder: THREE.Group, lane: number, m: number, key: string, spin: THREE.Vector3, active: boolean, shower: boolean}>} */
    this.meteors = [];
    /** @type {Map<string, THREE.Group[]>} */
    this.meteorPool = new Map();
    /** @type {Array<{holder: THREE.Object3D, kind: 'star'|'gold'|'shield', points: number, m: number, phase: number, driftHz: number, active: boolean}>} */
    this.pickups = [];

    // --- input (§C1.2 #8): tap half = 1 lane, horizontal swipe = 2 lanes ---
    this.offSwipe = ctx.input.on('swipe', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      if (p.dir !== 'left' && p.dir !== 'right') return;
      if (this.wormhole.active) return;
      this.setLane(laneAfterGesture(this.lane, { kind: 'swipe', dir: p.dir }));
      this.swipeTapSuppressT = HOPPER.SWIPE_TAP_SUPPRESS_SEC;
    });
    this.offTap = ctx.input.on('tap', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      if (this.wormhole.active) return;
      const side = p.nx < 0 ? 'left' : 'right';
      this.setLane(laneAfterGesture(
        this.lane,
        { kind: 'tap', side },
        this.swipeTapSuppressT > 0
      ));
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(HOPPER.DURATION_SEC);
  },

  /** Current round score (§C1.2 #8: distanceM/10 + pickups). */
  score() {
    return hopperScore(this.traveled, this.pickupPoints);
  },

  /** @param {number} target lane 0..2 */
  setLane(target) {
    if (target === this.lane) return;
    this.lane = target;
    this.ctx.audio.play('hopper.lane');
  },

  /** Take (or clone) a meteor holder for a model variant. */
  takeMeteor(key) {
    const free = this.meteorPool.get(key);
    if (free && free.length > 0) return free.pop();
    return fitModel(this.ctx.assets.getModel(`space-kit/${key}`), 0.78);
  },

  spawnMeteor(lane, m, isShower) {
    const { rng } = this.ctx;
    const key = METEOR_MODELS[Math.min(METEOR_MODELS.length - 1, Math.floor(rng() * METEOR_MODELS.length))];
    const holder = this.takeMeteor(key);
    holder.visible = true;
    holder.position.set(HOPPER.LANE_X[lane], this.yFor(m), 0);
    this.ctx.scene.add(holder);
    this.meteors.push({
      holder,
      lane,
      m,
      key,
      spin: new THREE.Vector3((rng() - 0.5) * 2.6, (rng() - 0.5) * 2.0, (rng() - 0.5) * 2.6),
      active: true,
      // shower meteors streak down-track so they pass WHILE the stripes glow
      fall: isShower ? HOPPER.SHOWER_METEOR_SPEED : 0,
    });
  },

  despawnMeteor(meteor) {
    meteor.active = false;
    meteor.holder.visible = false;
    this.ctx.scene.remove(meteor.holder);
    if (!this.meteorPool.has(meteor.key)) this.meteorPool.set(meteor.key, []);
    this.meteorPool.get(meteor.key).push(meteor.holder);
  },

  /** Build a pickup object (§C1.2 #8: stars +3, golden carrots +10, shield). */
  spawnPickup(kind, m) {
    const { rng, scene, assets } = this.ctx;
    let holder;
    let points = 0;
    if (kind === 'star') {
      holder = new THREE.Group();
      const mesh = new THREE.Mesh(this.starGeo, this.starMat);
      const glow = new THREE.Sprite(this.glowMatGold);
      glow.scale.set(0.85, 0.85, 1);
      glow.position.z = -0.05;
      holder.add(glow, mesh);
      points = HOPPER.STAR_POINTS;
    } else if (kind === 'gold') {
      holder = fitModel(assets.getModel('food-kit/carrot'), 0.55);
      holder.traverse((obj) => {
        if (obj.isMesh) {
          const mat = obj.material.clone(); // cached master materials are shared — never tint them
          if (mat.color) mat.color.set('#FFC93C');
          if ('metalness' in mat) mat.metalness = 0.55;
          if ('roughness' in mat) mat.roughness = 0.35;
          obj.material = mat;
          this.goldMats.push(mat);
        }
      });
      const glow = new THREE.Sprite(this.glowMatGold);
      glow.scale.set(1.1, 1.1, 1);
      glow.position.z = -0.1;
      holder.add(glow);
      points = HOPPER.GOLD_POINTS;
    } else {
      holder = new THREE.Group();
      const ring = new THREE.Mesh(this.shieldRingGeo, this.shieldRingMat);
      const glow = new THREE.Sprite(this.glowMatShield);
      glow.scale.set(1.1, 1.1, 1);
      glow.position.z = -0.05;
      holder.add(glow, ring);
    }
    holder.position.set(0, this.yFor(m), 0.1);
    scene.add(holder);
    this.pickups.push({
      holder,
      kind,
      points,
      m,
      phase: rng() * Math.PI * 2,
      driftHz: kind === 'shield' ? 0.15 : 0.3 + rng() * 0.25,
      active: true,
    });
  },

  despawnPickup(p) {
    p.active = false;
    this.ctx.scene.remove(p.holder);
    if (p.kind === 'gold') {
      // free this spawn's cloned gold materials
      p.holder.traverse((obj) => {
        if (obj.isMesh && this.goldMats.includes(obj.material)) {
          obj.material.dispose();
          this.goldMats.splice(this.goldMats.indexOf(obj.material), 1);
        }
      });
    }
  },

  /** Screen y for a track position (m), relative to the craft. */
  yFor(m) {
    return CRAFT_Y + (m - this.traveled) * WU_PER_M;
  },

  /** Lane index nearest to the craft's current x (collision fairness). */
  collisionLane() {
    let best = 0;
    for (let i = 1; i < HOPPER.LANES; i += 1) {
      if (Math.abs(this.craftX - HOPPER.LANE_X[i]) < Math.abs(this.craftX - HOPPER.LANE_X[best])) best = i;
    }
    return best;
  },

  /** Spawn meteor rows + gap pickups ahead of the craft (§C1.5 spawn tables). */
  spawnAhead(elapsed) {
    if (this.shower.state !== 'idle' || this.wormhole.active) return; // special sequences own the sky
    while (this.lastRowM < this.traveled + LOOKAHEAD_M) {
      const row = generateRow(this.ctx.rng, elapsed, this.recentRows);
      this.recentRows.push(row);
      if (this.recentRows.length > 6) this.recentRows.shift();
      this.lastRowM += row.gap;
      for (let lane = 0; lane < HOPPER.LANES; lane += 1) {
        if (row.blocked[lane]) this.spawnMeteor(lane, this.lastRowM, false);
      }
      if (shouldSpawnWormhole(
        this.ctx.rng,
        elapsed,
        this.wormhole.spawned,
        this.wormhole.active
      )) {
        const safe = row.blocked.map((blocked, lane) => ({ blocked, lane }))
          .filter((entry) => !entry.blocked);
        const pick = safe[Math.floor(this.ctx.rng() * safe.length)]?.lane ?? 1;
        this.spawnWormhole(pick, this.lastRowM + row.gap * 0.45);
      }
      const roll = rollPickup(this.ctx.rng);
      if (roll) this.spawnPickup(roll.kind, this.lastRowM + row.gap * 0.5);
    }
  },

  spawnWormhole(lane, m) {
    const gate = new THREE.Mesh(this.wormholeGeo, this.wormholeMat);
    gate.position.set(HOPPER.LANE_X[lane], this.yFor(m), 0.1);
    this.ctx.scene.add(gate);
    this.wormhole.spawned = true;
    this.wormhole.gate = { holder: gate, lane, m };
  },

  enterWormhole() {
    const wh = this.wormhole;
    wh.gate?.holder?.parent?.remove(wh.gate.holder);
    wh.gate = null;
    wh.active = true;
    wh.t = 0;
    this.invulnT = HOPPER.WORMHOLE_SEC;
    this.setLane(1);
    for (const ring of this.tunnelRings) ring.visible = true;
    this.ctx.audio.play('hopper.shield');
    this.ctx.hud.banner(t('v3.depth.hopper.wormhole'));
  },

  updateWormhole(dt) {
    const wh = this.wormhole;
    if (!wh.active) return;
    const before = wh.t;
    wh.t = Math.min(HOPPER.WORMHOLE_SEC, wh.t + dt);
    const awards = wormholeAwards(before, wh.t);
    if (awards > 0) {
      wh.stars += awards;
      this.pickupPoints += awards;
      this.ctx.onScore(awards);
      this.particles.emit('sparkles', this.craft.position.clone(), { count: awards * 2 });
    }
    for (let i = 0; i < this.tunnelRings.length; i += 1) {
      const ring = this.tunnelRings[i];
      const phase = (wh.t * 4 + i / this.tunnelRings.length) % 1;
      ring.position.set(this.craftX, CRAFT_Y + phase * (this.halfH - CRAFT_Y + 1), -0.5);
      ring.scale.setScalar(0.65 + phase * 1.25);
      ring.rotation.z += dt * (i % 2 ? 1.8 : -1.8);
    }
    if (wh.t >= HOPPER.WORMHOLE_SEC) {
      wh.active = false;
      this.invulnT = Math.max(this.invulnT, 0.5);
      for (const ring of this.tunnelRings) ring.visible = false;
      this.floats.spawn(`+${wh.stars}`, this.craft.position.clone(), '#C77DFF');
    }
  },

  /** Shower state machine (§C1.2 #8: telegraphed by warning stripes). */
  updateShower(dt, elapsed, speed) {
    const sh = this.shower;
    if (sh.state === 'idle') {
      if (elapsed >= sh.nextAt && this.phase === 'play') {
        sh.state = 'telegraph';
        sh.t = 0;
        sh.lanes = pickShowerLanes(this.ctx.rng);
        // clear normal meteors that would trap the safe lane mid-shower
        const windowEnd = this.traveled + speed * (HOPPER.SHOWER_TELEGRAPH_SEC + HOPPER.SHOWER_DURATION_SEC + 1.5) + LOOKAHEAD_M;
        for (const meteor of this.meteors) {
          if (meteor.active && meteor.lane === sh.lanes.safe && meteor.m <= windowEnd) this.despawnMeteor(meteor);
        }
        this.ctx.audio.play('hopper.warning');
        this.ctx.hud.banner(t('mg.hopper.shower'));
      }
      return;
    }
    sh.t += dt;
    if (sh.state === 'telegraph') {
      const pulse = 0.28 + 0.22 * Math.sin(sh.t * 14);
      for (let i = 0; i < HOPPER.LANES; i += 1) {
        this.stripes[i].material.opacity = sh.lanes.danger.includes(i) ? pulse : 0;
      }
      if (sh.t >= HOPPER.SHOWER_TELEGRAPH_SEC) {
        sh.state = 'active';
        sh.t = 0;
        sh.dropT = 0;
      }
      return;
    }
    // active: stream meteors down the danger lanes; stripes stay lit until
    // every streaking shower meteor has passed the craft (no dark snipes)
    for (let i = 0; i < HOPPER.LANES; i += 1) {
      this.stripes[i].material.opacity = sh.lanes.danger.includes(i) ? 0.16 : 0;
    }
    if (sh.t < HOPPER.SHOWER_DURATION_SEC) {
      sh.dropT -= dt;
      if (sh.dropT <= 0) {
        sh.dropT = HOPPER.SHOWER_DROP_EVERY_SEC;
        for (const lane of sh.lanes.danger) this.spawnMeteor(lane, this.traveled + LOOKAHEAD_M, true);
      }
    } else if (!this.meteors.some((m2) => m2.active && m2.fall > 0 && m2.m > this.traveled - 6)) {
      sh.state = 'idle';
      sh.nextAt = elapsed + HOPPER.SHOWER_EVERY_SEC;
      for (const stripe of this.stripes) stripe.material.opacity = 0;
      // restart the row chain a clean gap after the last shower meteor
      this.lastRowM = Math.max(this.lastRowM, this.traveled + LOOKAHEAD_M + 14);
      this.recentRows = [];
    }
  },

  /** Greedy autoplay (§C1.2 #8): highest-value safe lane per 0.4 s window. */
  autoplayTick(dt, speed) {
    if (this.wormhole.active) return;
    this.botT -= dt;
    // threats close at climb speed (+ streak speed for shower meteors)
    const threats = [];
    for (const meteor of this.meteors) {
      if (meteor.active) threats.push({ lane: meteor.lane, m: meteor.m, approach: speed + meteor.fall });
    }
    const horizonSec = HOPPER.BOT_WINDOW_SEC + HOPPER.LANE_CHANGE_SEC + HOPPER.BOT_GUARD_SEC;
    const outlook = laneOutlook(threats, this.traveled, horizonSec, HOPPER.BOT_TRANSIT_GUARD_SEC);
    // reflex: dodge NOW if the current lane gets hit before the next window
    const panic = outlook.enter[this.lane] < HOPPER.BOT_PANIC_SEC;
    if (this.botT > 0 && !panic) return;
    this.botT = HOPPER.BOT_WINDOW_SEC;
    const sh = this.shower;
    const valueHorizon = this.traveled + speed * 2.6;
    const lanes = [];
    for (let i = 0; i < HOPPER.LANES; i += 1) {
      // telegraphed shower lanes are off-limits the moment stripes appear
      const safe = outlook.safe[i] && !(sh.state !== 'idle' && sh.lanes.danger.includes(i));
      let value = 0;
      for (const p of this.pickups) {
        if (!p.active || p.m < this.traveled || p.m > valueHorizon) continue;
        let nearest = 0;
        for (let l = 1; l < HOPPER.LANES; l += 1) {
          if (Math.abs(p.holder.position.x - HOPPER.LANE_X[l]) < Math.abs(p.holder.position.x - HOPPER.LANE_X[nearest])) nearest = l;
        }
        if (nearest === i) value += p.kind === 'shield' ? 6 : p.points;
      }
      const gate = this.wormhole.gate;
      if (gate && gate.m >= this.traveled && gate.m <= valueHorizon && gate.lane === i) {
        value += 20;
      }
      lanes.push({ safe, value, transitSafe: outlook.transit[i], enter: outlook.enter[i] });
    }
    this.setLane(planMove(this.lane, lanes));
  },

  /** A meteor connected (§C1.2 #8: one hit = end, shield eats the first). */
  onHit(meteor) {
    this.despawnMeteor(meteor);
    const result = resolveHit(this.shielded);
    if (!result.ended) {
      this.shielded = false;
      this.bubble.visible = false;
      this.invulnT = HOPPER.SHIELD_POP_INVULN_SEC;
      this.ctx.audio.play('hopper.shieldPop');
      this.ctx.hud.banner(t('mg.hopper.shieldSaved'));
      this.particles.emit('sparkles', this.craft.position.clone(), { count: 10 });
      return;
    }
    this.phase = 'ending';
    this.win = false;
    this.ctx.audio.play('hopper.crash');
    this.gooby.setEmotion('sad');
    this.gooby.play('dizzy');
    this.particles.emit('dizzyStars', this.craft.position.clone().add(new THREE.Vector3(0, 0.6, 0)));
    this.particles.emit('confetti', this.craft.position.clone(), { count: 10 });
    tween({ from: 0, to: 1, duration: 0.8, ease: easings.easeOutQuad, onUpdate: (v) => {
      if (this.craft) this.craft.rotation.z = v * Math.PI * 2;
    } });
    for (const stripe of this.stripes) stripe.material.opacity = 0;
    if (this.autoplay) console.log(`[starHopper] autoplay run ended (crash) — score ${this.score()}`);
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    // starfield always drifts (parallax) — even on the end screen beat
    const speed = this.phase === 'play' ? speedAt(elapsed) : 4;
    for (const layer of this.starLayers) {
      const arr = layer.arr;
      const drop = speed * WU_PER_M * layer.speed * dt;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] -= drop;
        if (arr[i] < -this.halfH - 1) {
          arr[i] += this.halfH * 2 + 2;
          arr[i - 1] = (Math.random() * 2 - 1) * (this.halfW + 1);
        }
      }
      layer.points.geometry.attributes.position.needsUpdate = true;
    }

    // ── V4/G67 §G4.8 (lightest dose): edge streaks + FOV kick — runs on the
    // end-screen beat too (speed 4 ⇒ rate 0, live streaks drain naturally).
    this.speedLines.update(dt, {
      speed: speed * WU_PER_M, // planar motion is in world units
      rate: streakRate(speed, HOPPER_FX.RATE),
    });
    const targetFov = speedFovTarget(
      this.baseFov, HOPPER_FX.FOV_KICK, speed, HOPPER_FX.BAND[0], HOPPER_FX.BAND[1]
    );
    if (Math.abs(ctx.camera.fov - targetFov) > 0.01) {
      ctx.camera.fov = fovLerp(ctx.camera.fov, targetFov, dt);
      ctx.camera.updateProjectionMatrix();
    }
    if (import.meta.env?.DEV) {
      // CDP telemetry (window.__hopper.game.fxDebug) — §G4.8 evidence surface
      this.fxDebug = {
        speed,
        fov: ctx.camera.fov,
        streaks: this.speedLines.activeCount(),
        streakDrawCalls: this.speedLines.drawCalls(),
        drawCalls: ctx.renderer?.info?.render?.calls ?? 0,
      };
    }
    // ── end V4/G67 update ──────────────────────────────────────────────────

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: this.score() });
      }
      return;
    }

    const remaining = HOPPER.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);
    if (this.invulnT > 0) this.invulnT -= dt;
    this.swipeTapSuppressT = Math.max(0, this.swipeTapSuppressT - dt);
    this.updateWormhole(dt);

    if (this.autoplay) this.autoplayTick(dt, speed);

    // climb + distance score (§C1.2 #8: +1 per 10 m)
    const dm = speed * dt;
    const prevM = this.traveled;
    this.traveled += dm;
    const distNow = Math.floor(this.traveled / HOPPER.DISTANCE_PER_POINT_M);
    if (distNow > this.distPoints) {
      ctx.onScore(distNow - this.distPoints);
      this.distPoints = distNow;
    }

    // craft slides toward its lane; slight bank while moving
    const targetX = HOPPER.LANE_X[this.lane];
    this.craftX += (targetX - this.craftX) * Math.min(1, dt / HOPPER.LANE_CHANGE_SEC);
    this.craft.position.x = this.craftX;
    this.craft.rotation.z = THREE.MathUtils.clamp((targetX - this.craftX) * -0.5, -0.4, 0.4);
    this.craft.position.y = CRAFT_Y + Math.sin(elapsed * 2.2) * 0.06;
    this.engineGlow.scale.y = 1.0 + Math.sin(elapsed * 17) * 0.15;
    this.bubble.material.opacity = 0.22 + Math.sin(elapsed * 5) * 0.07;

    if (!this.wormhole.active) {
      this.updateShower(dt, elapsed, speed);
      this.spawnAhead(elapsed);
    }

    // §C1.2 #8: the one shield pickup spawns when the score reaches 60
    if (shouldSpawnShield(this.score(), this.shieldSpawned)) {
      this.shieldSpawned = true;
      this.spawnPickup('shield', this.traveled + LOOKAHEAD_M * 0.75);
    }

    // meteors: tumble + sweep collision at the craft's nearest lane; shower
    // meteors streak down-track (relative approach = climb + fall)
    const colLane = this.collisionLane();
    for (const meteor of this.meteors) {
      if (!meteor.active) continue;
      const fallDist = meteor.fall * dt;
      const rel = dm + fallDist; // total closing distance this frame
      const hit =
        this.invulnT <= 0 &&
        !this.wormhole.active &&
        sweepHitsMeteor({ lane: colLane, m: prevM }, meteor, rel);
      meteor.m -= fallDist;
      const h = meteor.holder;
      h.position.y = this.yFor(meteor.m);
      h.rotation.x += meteor.spin.x * dt;
      h.rotation.y += meteor.spin.y * dt;
      h.rotation.z += meteor.spin.z * dt;
      if (hit) {
        this.onHit(meteor);
        if (this.phase !== 'play') return;
        continue;
      }
      if (meteor.m < this.traveled - 12) this.despawnMeteor(meteor);
    }
    this.meteors = this.meteors.filter((m2) => m2.active);

    // pickups: drift between lanes, collect on overlap
    for (const p of this.pickups) {
      if (!p.active) continue;
      const h = p.holder;
      p.phase += dt * p.driftHz * Math.PI * 2;
      h.position.x = Math.sin(p.phase) * HOPPER.LANE_X[HOPPER.LANES - 1];
      h.position.y = this.yFor(p.m);
      h.rotation.z += dt * 1.6;
      if (
        Math.abs(p.m - this.traveled) < 4 &&
        Math.abs(h.position.x - this.craftX) < 0.55
      ) {
        const pos = h.position.clone();
        this.despawnPickup(p);
        if (p.kind === 'shield') {
          this.shielded = true;
          this.bubble.visible = true;
          ctx.audio.play('hopper.shield');
          ctx.hud.banner(t('mg.hopper.shield'));
          this.particles.emit('sparkles', pos, { count: 8 });
        } else {
          this.pickupPoints += p.points;
          ctx.onScore(p.points);
          ctx.audio.play(p.kind === 'gold' ? 'hopper.gold' : 'hopper.star');
          this.floats.spawn(`+${p.points}`, pos, p.kind === 'gold' ? '#FFC93C' : '#FFE066');
          this.particles.emit('sparkles', pos, { count: p.kind === 'gold' ? 10 : 5 });
          if (p.kind === 'gold') this.gooby.play('happyBounce');
        }
        continue;
      }
      if (p.m < this.traveled - 12) this.despawnPickup(p);
    }
    this.pickups = this.pickups.filter((p) => p.active);

    const gate = this.wormhole.gate;
    if (gate) {
      gate.holder.position.y = this.yFor(gate.m);
      gate.holder.rotation.z += dt * 1.7;
      if (
        Math.abs(gate.m - this.traveled) < 4 &&
        Math.abs(HOPPER.LANE_X[gate.lane] - this.craftX) < 0.6
      ) {
        this.enterWormhole();
      } else if (gate.m < this.traveled - 12) {
        gate.holder.parent?.remove(gate.holder);
        this.wormhole.gate = null;
      }
    }

    if (remaining <= 0) {
      this.phase = 'ending';
      this.win = true;
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.particles.emit('confetti', this.craft.position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 16 });
      for (const stripe of this.stripes) stripe.material.opacity = 0;
      if (this.autoplay) {
        console.log(
          `[starHopper] autoplay run ended (survived) — score ${this.score()}, ` +
          `wormholeStars ${this.wormhole.stars}`
        );
      }
    }
  },

  dispose() {
    this.offSwipe?.();
    this.offTap?.();
    this.speedLines?.dispose(); // V4/G67 §G4.8 juice teardown
    if (import.meta.env?.DEV && window.__hopper?.game === this) delete window.__hopper; // V4/G67
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    for (const mat of this.goldMats ?? []) mat.dispose();
    // GLB clones share cached geometries/materials — the framework scene sweep
    // handles GPU frees; drop references only.
    this.meteors = [];
    this.meteorPool = null;
    this.pickups = [];
    this.stripes = [];
    this.tunnelRings = [];
    this.wormhole = null;
    this.starLayers = [];
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.craft = null;
    this.bubble = null;
    this.engineGlow = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
    this.goldMats = [];
  },
};
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
