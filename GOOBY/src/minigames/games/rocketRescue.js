// Rocket Rescue (PLAN3 §C10.1 #3, agent V3/G42): physics lander over a moon
// crater field — hold to thrust, screen thirds to tilt, land soft (≤ 1.2 m/s)
// on 5 seeded platforms to pick up stranded bunnies and carry them home to
// the station pad. Fuel 100 burns 8/s; mid-air canisters refill; hard
// landings bounce (−10 fuel, never death); out of fuel = auto-tow home.
// Score = 30·rescued + fuel/2 + 5/soft landing. Pure rules live in
// rocketRescue.logic.js. Distinct look (§C10.1): deep-space starfield over a
// grey moon surface — NOT starHopper's violet nebula lanes.
// Dev-only ?autoplay=1: PD-controller bot (altitude/velocity per platform).

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { getAchievementsEngine } from '../../systems/achievementsEngine.js';
import { clampFloatTextToView } from '../framework.js';
import {
  ROCKET,
  createEngine,
  createBot,
  roundScore,
  tiltCommandFor,
} from './rocketRescue.logic.js';

/** Camera distance (wu) — halfH/halfW derive from it in init. */
const CAM_Z = 13;
/** Wind streak sprite pool size. */
const STREAK_COUNT = 12;

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

/** Deep-space backdrop: near-black indigo gradient + baked stars + a pale
 *  ringed planet (NO nebula blobs — starHopper owns that look, §C10.1). */
function makeSpaceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#04060F');
  grad.addColorStop(0.7, '#0A1024');
  grad.addColorStop(1, '#141B33');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 130; i += 1) {
    g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.5})`;
    const s = Math.random() < 0.12 ? 2 : 1;
    g.fillRect(Math.random() * 256, Math.random() * 512, s, s);
  }
  // pale distant planet with a thin ring (top-right)
  g.fillStyle = 'rgba(150,170,210,0.32)';
  g.beginPath();
  g.arc(200, 74, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(190,205,235,0.18)';
  g.beginPath();
  g.arc(192, 66, 20, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(170,190,225,0.4)';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(200, 74, 44, 12, -0.35, 0, Math.PI * 2);
  g.stroke();
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
      g.strokeStyle = 'rgba(8,10,26,0.9)';
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
        f.sprite.position.y += dt * 1.0;
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
  id: 'rocketRescue',
  assetKeys: ['space-kit/craft_speederB'],
  /** §B2.3 warm-cache hints (framework preloads fire-and-forget). */
  sfx: ['rocket.land.soft', 'rocket.land.hard', 'rocket.rescue', 'rocket.fuel'],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    // dev-only CDP probe handle (§E9 harness pattern — evals force depth
    // features like fuel-out tow / gull steals without waiting for RNG)
    if (import.meta.env?.DEV) window.__g42rocket = this;

    this.engine = createEngine(ctx.rng);
    this.bot = this.autoplay ? createBot() : null;
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.endT = 0;
    this.shownScore = 0;
    this.shakeT = 0;
    this.thrustAudioOn = false;
    this.pointer = { down: false, nx: 0 };

    const camera = ctx.camera;
    camera.position.set(0, 0, CAM_Z);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z;
    this.halfW = this.halfH * (innerWidth / innerHeight);
    // world units per logic meter: the full field height fits the view
    this.wu = (this.halfH * 2 - 1.1) / (ROCKET.CEILING_Y + 1.6);
    this.y0 = -this.halfH + 1.15; // screen y of pad level (m 0)
    this.camMaxX = Math.max(0, ROCKET.WORLD_HALF_W * this.wu - this.halfW + 0.4);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#04060F');

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
    /** logic (x m, y m) → world position */
    const W = (x, y, z = 0) => new THREE.Vector3(x * this.wu, this.y0 + y * this.wu, z);
    this.W = W;

    // --- backdrop: space gradient + moon terrain (parallax with the camera) --
    this.spaceTex = makeSpaceTexture();
    this.ownedTexs.push(this.spaceTex);
    this.bg = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 5, this.halfH * 2 + 4),
      new THREE.MeshBasicMaterial({ map: this.spaceTex, depthWrite: false })
    ));
    this.bg.position.set(0, 0, -6);
    scene.add(this.bg);

    // moon surface: jagged ShapeGeometry ribbon across the whole field
    const shape = new THREE.Shape();
    const spanM = ROCKET.WORLD_HALF_W + 1.5;
    shape.moveTo(-spanM * this.wu, this.y0 - 2.2);
    for (let m = -spanM; m <= spanM; m += 0.8) {
      const h = Math.abs(m) < ROCKET.PAD_HALF_W + 0.6
        ? -0.06 // flat apron around the station pad
        : -0.5 + Math.sin(m * 1.7) * 0.22 + Math.sin(m * 0.6 + 2) * 0.18;
      shape.lineTo(m * this.wu, this.y0 + h * this.wu);
    }
    shape.lineTo(spanM * this.wu, this.y0 - 2.2);
    shape.closePath();
    const ground = own(new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: '#2E3247' })
    ));
    ground.position.z = -1.2;
    scene.add(ground);
    // crater rims on the terrain (thin ellipses)
    this.craterMat = new THREE.MeshBasicMaterial({ color: '#3D4360', side: THREE.DoubleSide });
    this.craterGeo = new THREE.RingGeometry(0.28, 0.4, 18);
    this.ownedMats.push(this.craterMat);
    this.ownedGeos.push(this.craterGeo);
    for (const [mx, s] of [[-5.5, 1.2], [-2.9, 0.8], [3.4, 1.0], [6.2, 0.7]]) {
      const rim = new THREE.Mesh(this.craterGeo, this.craterMat);
      rim.position.copy(W(mx, -0.35, -1.1));
      rim.scale.set(s, s * 0.4, 1);
      scene.add(rim);
    }

    // moonlit lighting: cool hemi + warm key from the station
    scene.add(new THREE.HemisphereLight(0xAFC0FF, 0x20182E, 1.1));
    const dir = new THREE.DirectionalLight(0xFFE8CA, 0.7);
    dir.position.set(-3, 6, 6);
    scene.add(dir);

    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);

    // --- station pad (§C10.1 drop-off) --------------------------------------
    const padGrp = new THREE.Group();
    const padW = ROCKET.PAD_HALF_W * 2 * this.wu;
    const slab = own(new THREE.Mesh(
      new THREE.BoxGeometry(padW, 0.22, 0.8),
      new THREE.MeshStandardMaterial({ color: '#5A6B8C', roughness: 0.7 })
    ));
    slab.position.y = -0.11;
    padGrp.add(slab);
    const stripe = own(new THREE.Mesh(
      new THREE.BoxGeometry(padW * 0.94, 0.06, 0.82),
      new THREE.MeshBasicMaterial({ color: '#FFD166' })
    ));
    stripe.position.y = 0.0;
    padGrp.add(stripe);
    this.glowTexTeal = makeGlowTexture('rgba(110,230,215,0.9)');
    this.ownedTexs.push(this.glowTexTeal);
    this.beaconMat = new THREE.SpriteMaterial({
      map: this.glowTexTeal, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ownedMats.push(this.beaconMat);
    this.beacons = [];
    for (const sx of [-1, 1]) {
      const b = new THREE.Sprite(this.beaconMat);
      b.position.set(sx * (padW / 2 - 0.12), 0.16, 0.2);
      b.scale.set(0.5, 0.5, 1);
      padGrp.add(b);
      this.beacons.push(b);
    }
    padGrp.position.copy(W(ROCKET.PAD_X, ROCKET.PAD_Y));
    scene.add(padGrp);
    this.padGrp = padGrp;

    // --- shared bunny resources (procedural cream mini-bunnies) -------------
    this.bunnyGeos = {
      body: new THREE.SphereGeometry(0.16, 12, 10),
      head: new THREE.SphereGeometry(0.11, 12, 10),
      ear: new THREE.CapsuleGeometry(0.032, 0.13, 3, 6),
      eye: new THREE.SphereGeometry(0.018, 6, 6),
    };
    this.bunnyMats = {
      fur: new THREE.MeshStandardMaterial({ color: '#F6EFE0', roughness: 0.9 }),
      eye: new THREE.MeshBasicMaterial({ color: '#3A2E28' }),
    };
    this.ownedGeos.push(...Object.values(this.bunnyGeos));
    this.ownedMats.push(...Object.values(this.bunnyMats));
    this.glowTexPink = makeGlowTexture('rgba(255,150,190,0.9)');
    this.ownedTexs.push(this.glowTexPink);
    this.helpMat = new THREE.SpriteMaterial({
      map: this.glowTexPink, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ownedMats.push(this.helpMat);

    // --- platforms + stranded bunnies (5 seeded — engine layout) ------------
    this.rockMat = new THREE.MeshStandardMaterial({ color: '#454B66', roughness: 0.95 });
    this.slabMat = new THREE.MeshStandardMaterial({ color: '#6E7794', roughness: 0.8 });
    this.ownedMats.push(this.rockMat, this.slabMat);
    /** @type {Array<{grp: THREE.Group, bunny: THREE.Group, help: THREE.Sprite, indicator: THREE.Sprite}>} */
    this.platformViews = [];
    for (const p of this.engine.layout.platforms) {
      const grp = new THREE.Group();
      const wTop = p.halfW * 2 * this.wu;
      const colH = Math.max(0.6, (p.y + 0.4) * this.wu * 0.32);
      const colGeo = new THREE.CylinderGeometry(wTop * 0.16, wTop * 0.3, colH, 7);
      this.ownedGeos.push(colGeo);
      const col = new THREE.Mesh(colGeo, this.rockMat);
      col.position.y = -colH / 2 - 0.08;
      grp.add(col);
      const slabGeo = new THREE.BoxGeometry(wTop, 0.16, 0.7);
      this.ownedGeos.push(slabGeo);
      const top = new THREE.Mesh(slabGeo, this.slabMat);
      top.position.y = -0.08;
      grp.add(top);
      const bunny = this.makeBunny();
      bunny.position.y = 0.16;
      grp.add(bunny);
      const help = new THREE.Sprite(this.helpMat);
      help.position.set(0, 0.62, 0.1);
      help.scale.set(0.42, 0.42, 1);
      grp.add(help);
      grp.position.copy(W(p.x, p.y));
      scene.add(grp);
      // offscreen indicator (edge dot toward the platform)
      const indicator = new THREE.Sprite(this.helpMat);
      indicator.scale.set(0.34, 0.34, 1);
      indicator.visible = false;
      scene.add(indicator);
      this.platformViews.push({ grp, bunny, help, indicator });
    }

    // --- fuel canisters (seeded mid-air pickups) -----------------------------
    this.canGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10);
    this.canCapGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8);
    this.canMat = new THREE.MeshStandardMaterial({ color: '#63E0FF', roughness: 0.4, metalness: 0.2 });
    this.ownedGeos.push(this.canGeo, this.canCapGeo);
    this.ownedMats.push(this.canMat);
    this.glowMatTeal = new THREE.SpriteMaterial({
      map: this.glowTexTeal, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ownedMats.push(this.glowMatTeal);
    /** @type {Array<{grp: THREE.Group, phase: number}>} */
    this.canViews = [];
    for (const f of this.engine.layout.fuelPickups) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(this.canGeo, this.canMat);
      const cap = new THREE.Mesh(this.canCapGeo, this.canMat);
      cap.position.y = 0.22;
      const glow = new THREE.Sprite(this.glowMatTeal);
      glow.scale.set(0.75, 0.75, 1);
      glow.position.z = -0.05;
      grp.add(glow, body, cap);
      grp.position.copy(W(f.x, f.y, 0.1));
      scene.add(grp);
      this.canViews.push({ grp, phase: ctx.rng() * Math.PI * 2 });
    }

    // --- player craft (space-kit speederB ≠ starHopper's A) + Gooby ---------
    this.craft = new THREE.Group();
    const speeder = fitModel(ctx.assets.getModel('space-kit/craft_speederB'), 1.05 * this.wu);
    speeder.rotation.set(Math.PI / 2, 0, Math.PI); // nose up-screen, top to camera
    this.craft.add(speeder);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.30);
    this.gooby.group.position.set(0, -0.02, 0.4);
    this.gooby.play('sitDrive');
    this.gooby.setEmotion('happy');
    this.craft.add(this.gooby.group);
    // thrust flame (cone + glow, hidden while coasting)
    this.glowTexFlame = makeGlowTexture('rgba(255,180,90,0.95)');
    this.ownedTexs.push(this.glowTexFlame);
    this.flameGeo = new THREE.ConeGeometry(0.14, 0.5, 8);
    this.flameMat = new THREE.MeshBasicMaterial({ color: '#FFB347', transparent: true, opacity: 0.9 });
    this.ownedGeos.push(this.flameGeo);
    this.ownedMats.push(this.flameMat);
    this.flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    this.flame.rotation.x = Math.PI;
    this.flame.position.y = -0.55;
    this.flame.visible = false;
    this.craft.add(this.flame);
    const flameGlowMat = new THREE.SpriteMaterial({
      map: this.glowTexFlame, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ownedMats.push(flameGlowMat);
    this.flameGlow = new THREE.Sprite(flameGlowMat);
    this.flameGlow.position.y = -0.62;
    this.flameGlow.scale.set(0.8, 1.0, 1);
    this.flameGlow.visible = false;
    this.craft.add(this.flameGlow);
    // carried bunny rides the hull
    this.cargoBunny = this.makeBunny();
    this.cargoBunny.scale.setScalar(0.8);
    this.cargoBunny.position.set(0, 0.32, 0.25);
    this.cargoBunny.visible = false;
    this.craft.add(this.cargoBunny);
    this.craft.position.copy(W(this.engine.state.x, this.engine.state.y));
    scene.add(this.craft);

    // rescued bunnies gather beside the pad (visible progress)
    /** @type {THREE.Group[]} */
    this.safeBunnies = [];

    // --- wind streaks (§C10.1: telegraphed gusts, level 3+) -----------------
    this.streakGeo = new THREE.PlaneGeometry(1.0, 0.05);
    this.streakMat = new THREE.MeshBasicMaterial({
      color: '#BFE8FF', transparent: true, opacity: 0, depthWrite: false,
    });
    this.ownedGeos.push(this.streakGeo);
    this.ownedMats.push(this.streakMat);
    /** @type {Array<{mesh: THREE.Mesh, speed: number}>} */
    this.streaks = [];
    for (let i = 0; i < STREAK_COUNT; i += 1) {
      const mesh = new THREE.Mesh(this.streakGeo, this.streakMat);
      mesh.position.set(
        (ctx.rng() * 2 - 1) * this.halfW,
        this.y0 + ctx.rng() * ROCKET.CEILING_Y * this.wu,
        1.2
      );
      mesh.visible = false;
      scene.add(mesh);
      this.streaks.push({ mesh, speed: 3 + ctx.rng() * 3 });
    }

    // --- fuel + rescue HUD chip ---------------------------------------------
    this.chip = document.createElement('div');
    this.chip.className = 'mg-pill';
    this.chip.style.cssText =
      'position:absolute;top:calc(64px + var(--safe-top));left:50%;transform:translateX(-50%);z-index:35;white-space:nowrap;display:flex;align-items:center;gap:6px;';
    this.chip.innerHTML =
      `<span>${t('mg.rocket.hud.fuel')}</span>` +
      '<span style="display:inline-block;width:52px;height:8px;border-radius:4px;background:rgba(0,0,0,0.25);overflow:hidden;">' +
      '<span class="rr-fill" style="display:block;height:100%;border-radius:4px;background:#7ED957;width:100%"></span></span>' +
      '<span class="rr-bun">🐰 0/5</span>';
    (document.getElementById('ui') ?? document.body).appendChild(this.chip);
    this.fillEl = this.chip.querySelector('.rr-fill');
    this.bunEl = this.chip.querySelector('.rr-bun');
    this.lastFuelPct = 100;

    // --- input: hold = thrust, pointer x thirds = tilt (§C10.1 controls) ----
    const el = ctx.renderer.domElement;
    this.onPointerDown = (e) => {
      if (!e.isPrimary) return;
      this.pointer.down = true;
      this.pointer.nx = (e.clientX / innerWidth) * 2 - 1;
    };
    this.onPointerMove = (e) => {
      if (!e.isPrimary || !this.pointer.down) return;
      this.pointer.nx = (e.clientX / innerWidth) * 2 - 1;
    };
    this.onPointerUp = (e) => {
      if (!e.isPrimary) return;
      this.pointer.down = false;
    };
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);

    ctx.hud.setScore(0);
    ctx.hud.setTime(ROCKET.DURATION_SEC);
    ctx.hud.banner(t('mg.rocket.hint'));
  },

  /** Procedural cream mini-bunny (shared geos/mats — see init). */
  makeBunny() {
    const g = this.bunnyGeos;
    const m = this.bunnyMats;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(g.body, m.fur);
    body.scale.set(1, 0.85, 0.9);
    const head = new THREE.Mesh(g.head, m.fur);
    head.position.set(0, 0.19, 0.02);
    grp.add(body, head);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(g.ear, m.fur);
      ear.position.set(sx * 0.05, 0.36, 0);
      ear.rotation.z = -sx * 0.22;
      grp.add(ear);
      const eye = new THREE.Mesh(g.eye, m.eye);
      eye.position.set(sx * 0.045, 0.21, 0.1);
      grp.add(eye);
    }
    return grp;
  },

  /** Current display score (fuel share lands at round end — monotonic HUD). */
  displayScore() {
    const s = this.engine.state;
    return ROCKET.RESCUE_POINTS * s.rescued + ROCKET.SOFT_LANDING_BONUS * s.softLandings;
  },

  /** Start/stop the thrust rumble loop (paused-safe — see onPause). */
  setThrustAudio(on) {
    if (on === this.thrustAudioOn) return;
    this.thrustAudioOn = on;
    if (on) this.ctx.audio.play('rocket.thrust');
    else this.ctx.audio.stop('rocket.thrust');
  },

  /** F6 (RE5) §E8 hook: silence the thrust loop while paused. */
  onPause() {
    this.setThrustAudio(false);
  },

  /** Map one engine event onto scene/audio/HUD feedback. */
  onEvent(ev) {
    const ctx = this.ctx;
    const craftPos = this.craft.position;
    if (ev.type === 'landing') {
      if (ev.kind === 'soft' && ev.bonusEligible) {
        ctx.audio.play('rocket.land.soft');
        this.floats.spawn('+5', craftPos.clone(), '#7ED957');
        this.particles.emit('sparkles', craftPos.clone(), { count: 6 });
      } else {
        ctx.audio.play('rocket.land.soft');
      }
    } else if (ev.type === 'hardLanding') {
      ctx.audio.play('rocket.land.hard');
      ctx.hud.banner(t('mg.rocket.hard'));
      this.floats.spawn('−10⛽', craftPos.clone(), '#FF6B6B');
      this.particles.emit('dizzyStars', craftPos.clone().add(new THREE.Vector3(0, 0.5, 0)));
      this.shakeT = 0.45;
      this.gooby.setEmotion('sad');
    } else if (ev.type === 'bunnyPickup') {
      ctx.audio.play('rocket.pickup');
      ctx.hud.banner(t('mg.rocket.pickup'));
      const view = this.platformViews[ev.platform];
      if (view) {
        view.bunny.visible = false;
        view.help.visible = false;
        view.indicator.visible = false;
      }
      this.cargoBunny.visible = true;
      this.particles.emit('hearts', craftPos.clone(), { count: 4 });
      this.gooby.setEmotion('happy');
    } else if (ev.type === 'rescue') {
      ctx.audio.play('rocket.rescue');
      ctx.hud.banner(t('mg.rocket.rescue', { n: ev.count }));
      this.cargoBunny.visible = false;
      this.floats.spawn('+30', craftPos.clone(), '#FFD166');
      this.particles.emit('confetti', this.padGrp.position.clone().add(new THREE.Vector3(0, 0.6, 0)), { count: 12 });
      // the rescued bunny joins the pad-side welcome party
      const safe = this.makeBunny();
      safe.scale.setScalar(0.85);
      const side = ev.count % 2 === 0 ? 1 : -1;
      safe.position.copy(this.padGrp.position)
        .add(new THREE.Vector3(side * (ROCKET.PAD_HALF_W * this.wu + 0.35 + Math.floor(ev.count / 2) * 0.34), 0.14, 0.1));
      this.ctx.scene.add(safe);
      this.safeBunnies.push(safe);
      this.gooby.play('happyBounce');
      this.gooby.setEmotion('ecstatic');
    } else if (ev.type === 'fuelPickup') {
      ctx.audio.play('rocket.fuel');
      const view = this.canViews[ev.index];
      if (view) this.particles.emit('sparkles', view.grp.position.clone(), { count: 6 });
      this.floats.spawn(`+${ROCKET.FUEL_PICKUP_AMOUNT}⛽`, craftPos.clone(), '#63E0FF');
    } else if (ev.type === 'fuelLow') {
      ctx.audio.play('rocket.fuelLow');
      ctx.hud.banner(t('mg.rocket.fuelLow'));
    } else if (ev.type === 'outOfFuel') {
      ctx.audio.play('rocket.tow');
      ctx.hud.banner(t('mg.rocket.tow'));
      this.gooby.setEmotion('sad');
      this.setThrustAudio(false);
    } else if (ev.type === 'windTelegraph') {
      ctx.audio.play('rocket.wind');
      ctx.hud.banner(t('mg.rocket.wind'));
    } else if (ev.type === 'ended') {
      this.beginEnding(ev.reason);
    }
  },

  /** Round end beat (§C10.1 reasons: complete | fuel | time). */
  beginEnding(reason) {
    if (this.phase !== 'play') return;
    this.phase = 'ending';
    this.endReason = reason;
    this.setThrustAudio(false);
    const s = this.engine.state;
    const final = roundScore(s.rescued, s.fuel, s.softLandings);
    // fuel share lands now: flash the remaining delta onto the HUD
    if (final > this.shownScore) {
      this.ctx.onScore(final - this.shownScore);
      this.shownScore = final;
      if (s.fuel > 0) {
        this.floats.spawn(`+${Math.floor(s.fuel / ROCKET.FUEL_SCORE_DIVISOR)}⛽`, this.craft.position.clone(), '#63E0FF');
      }
    }
    if (reason === 'complete') {
      this.ctx.audio.play('ui.win');
      this.ctx.hud.banner(t('mg.rocket.complete'));
      this.gooby.setEmotion('ecstatic');
      this.particles.emit('confetti', this.craft.position.clone().add(new THREE.Vector3(0, 1, 0)), { count: 16 });
    } else if (reason === 'fuel') {
      this.gooby.setEmotion('sad');
    }
    if (this.autoplay) {
      console.log(
        `[rocketRescue] autoplay run ended (${reason}) — score ${final}, ` +
        `rescued ${s.rescued}, soft ${s.softLandings}, hard ${s.hardLandings}, fuel ${s.fuel.toFixed(1)}`
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
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        // §C9.5-style meta counter: sticker/achievement plumbing watches it
        try {
          getAchievementsEngine()?.track?.('rescues', state.rescued);
        } catch (err) {
          console.warn('[rocketRescue] counter tracking failed:', err);
        }
        ctx.onEnd({
          score: roundScore(state.rescued, state.fuel, state.softLandings),
          meta: { rescues: state.rescued },
        });
      }
      return;
    }

    // ---- engine step (sub-stepped so SwiftShader frame spikes keep real time)
    const control = this.autoplay
      ? this.bot.control(state, this.engine.layout)
      : {
        thrust: this.pointer.down,
        tiltDir: tiltCommandFor(this.pointer.down ? this.pointer.nx : null),
      };
    let rem = dt;
    for (let i = 0; i < 4 && rem > 1e-6 && this.phase === 'play'; i += 1) {
      const sdt = Math.min(rem, ROCKET.MAX_DT);
      for (const ev of this.engine.step(control, sdt)) this.onEvent(ev);
      rem -= sdt;
    }

    ctx.hud.setTime(ROCKET.DURATION_SEC - state.elapsed);

    // monotonic HUD score (rescues + soft bonuses; fuel share at the end)
    const shown = this.displayScore();
    if (shown !== this.shownScore) {
      ctx.onScore(shown - this.shownScore);
      this.shownScore = shown;
    }

    // ---- craft pose + thrust FX ----
    const thrusting = control.thrust && state.fuel > 0 && !state.towing;
    this.craft.position.copy(this.W(state.x, state.y));
    this.craft.position.y += 0.30; // hull center sits above the skids
    this.craft.rotation.z = -state.tilt;
    this.flame.visible = thrusting && state.landedOn === null;
    this.flameGlow.visible = this.flame.visible;
    if (this.flame.visible) {
      this.flame.scale.y = 0.85 + Math.sin(elapsed * 30) * 0.2;
      this.flameGlow.scale.set(0.7 + Math.sin(elapsed * 24) * 0.1, 1.0, 1);
      if (ctx.rng() < 0.3) {
        this.particles.emit('sparkles', this.craft.position.clone().add(new THREE.Vector3(0, -0.6, 0)), { count: 1 });
      }
    }
    this.setThrustAudio(this.flame.visible);
    // tow beat: craft dangles level, slow blink
    if (state.towing) this.craft.rotation.z = Math.sin(elapsed * 3) * 0.08;

    // ---- camera: follow x (clamped), shake on hard landings ----
    let camX = THREE.MathUtils.clamp(this.craft.position.x, -this.camMaxX, this.camMaxX);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      camX += (ctx.rng() - 0.5) * 0.12 * Math.max(0, this.shakeT / 0.45);
    }
    ctx.camera.position.x += (camX - ctx.camera.position.x) * Math.min(1, dt * 6);
    this.bg.position.x = ctx.camera.position.x * 0.92; // slow parallax

    // ---- pad beacons pulse (bright while carrying: “bring it home”) ----
    const pulse = state.carrying ? 0.75 + Math.sin(elapsed * 6) * 0.25 : 0.35 + Math.sin(elapsed * 2.5) * 0.12;
    this.beaconMat.opacity = pulse;

    // ---- platform bunnies idle-hop + offscreen indicators ----
    const viewL = ctx.camera.position.x - this.halfW;
    const viewR = ctx.camera.position.x + this.halfW;
    for (let i = 0; i < this.platformViews.length; i += 1) {
      const view = this.platformViews[i];
      const p = this.engine.layout.platforms[i];
      if (p.bunny) {
        view.bunny.position.y = 0.16 + Math.abs(Math.sin(elapsed * 2.4 + i)) * 0.07;
        view.help.material.opacity = 0.5 + Math.sin(elapsed * 4 + i) * 0.3;
        const px = view.grp.position.x;
        const off = px < viewL - 0.2 || px > viewR + 0.2;
        view.indicator.visible = off;
        if (off) {
          view.indicator.position.set(
            THREE.MathUtils.clamp(px, viewL + 0.35, viewR - 0.35),
            view.grp.position.y,
            1.3
          );
        }
      }
    }

    // ---- fuel canisters: bob + respawn visibility ----
    for (let i = 0; i < this.canViews.length; i += 1) {
      const view = this.canViews[i];
      const f = this.engine.layout.fuelPickups[i];
      view.grp.visible = !f.taken;
      view.grp.position.y = this.y0 + f.y * this.wu + Math.sin(elapsed * 1.8 + view.phase) * 0.08;
      view.grp.rotation.y += dt * 1.2;
    }

    // ---- wind streaks (telegraph faint, gust strong) ----
    const wind = state.wind;
    const windOn = wind.phase !== 'idle';
    if (windOn) {
      const strength = wind.phase === 'gust' ? 1 : 0.4;
      this.streakMat.opacity = 0.14 + strength * 0.3;
      for (const s of this.streaks) {
        s.mesh.visible = true;
        s.mesh.position.x += wind.dir * s.speed * strength * dt;
        const bound = ctx.camera.position.x;
        if (s.mesh.position.x > bound + this.halfW + 1) s.mesh.position.x -= this.halfW * 2 + 2;
        else if (s.mesh.position.x < bound - this.halfW - 1) s.mesh.position.x += this.halfW * 2 + 2;
      }
    } else {
      for (const s of this.streaks) s.mesh.visible = false;
    }

    // ---- cargo bunny wiggle ----
    if (this.cargoBunny.visible) {
      this.cargoBunny.rotation.z = Math.sin(elapsed * 5) * 0.1;
    }
    for (let i = 0; i < this.safeBunnies.length; i += 1) {
      this.safeBunnies[i].position.y = this.padGrp.position.y + 0.14 +
        Math.abs(Math.sin(elapsed * 3 + i * 1.3)) * 0.06;
    }

    // ---- fuel chip ----
    const pct = Math.round(state.fuel);
    if (pct !== this.lastFuelPct) {
      this.lastFuelPct = pct;
      this.fillEl.style.width = `${pct}%`;
      this.fillEl.style.background = pct > 50 ? '#7ED957' : pct > 20 ? '#FFD166' : '#FF6B6B';
    }
    const bunTxt = `🐰 ${state.rescued}/${ROCKET.PLATFORM_COUNT}`;
    if (this.bunEl.textContent !== bunTxt) this.bunEl.textContent = bunTxt;
  },

  dispose() {
    if (import.meta.env?.DEV && window.__g42rocket === this) delete window.__g42rocket;
    const el = this.ctx?.renderer?.domElement;
    el?.removeEventListener('pointerdown', this.onPointerDown);
    el?.removeEventListener('pointermove', this.onPointerMove);
    el?.removeEventListener('pointerup', this.onPointerUp);
    el?.removeEventListener('pointercancel', this.onPointerUp);
    this.setThrustAudio(false);
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
    this.platformViews = [];
    this.canViews = [];
    this.safeBunnies = [];
    this.streaks = [];
    this.beacons = [];
    this.engine = null;
    this.bot = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.craft = null;
    this.cargoBunny = null;
    this.flame = null;
    this.flameGlow = null;
    this.padGrp = null;
    this.bg = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
