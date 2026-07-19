// Fishing Pond (§C6.1 #10, agent G10): a cozy pond at dusk. HOLD to lower the
// hook (depth grows while held), fish silhouettes (food-kit `fish`, scaled
// S/M/L worth 2/3/5) swim laterally at depths; RELEASE to hook the nearest
// fish at that depth (catch radius). A procedural boot (−3) drifts by
// occasionally; L fish need a reel-in wiggle (~5 rapid taps in 2 s or they
// escape). 90 s. Dusk mood: warm-orange hemisphere + sun glow, nature-kit
// rocks/trees/bridge framing, water plane with a gentle sine ripple. Pure
// rules live in fishingPond.logic.js (§B rule).
//
// Dev-only ?autoplay=1: a bot times hold/release on real fish alignment and
// reel-taps L fish (with human-ish misses) for headless verification.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  FISHING,
  lowerDepth,
  catchValue,
  needsReel,
  nearestCatch,
  reelResolve,
  rollFishKind,
  fishSpeedFor,
  shouldSpawnBoot,
  applyCatch,
  advanceReelElapsed,
  rollSpeciesDetail,
  SPECIES_COLORS, // V2/G23: visible species tint
  rareSetBonus,
} from './fishingPond.logic.js';
// ── V2/G23: §C6 species meta — night band gates the nightEel (§C10.3) ──
import { bandAt } from '../../systems/dayNight.js';
import { now } from '../../core/clock.js';
// V2/G26 (§C11.2): cosmetic rain ripple rings when launched during rain
import { weatherAt } from '../../systems/weather.js';
import { mountPondRipples } from '../../gfx/weatherFx.js';
// ── end V2/G23 ──

/** World layout (camera z=10, FOV 45 → half-height ≈ 4.1, half-width ≈ 1.9). */
const SURFACE_Y = 0.9;
const SWIM_Z = -0.4; //   fish/hook swim behind the translucent water front
const ROD_TIP = { x: 0, y: 2.25 };

/** depth below surface → world y. */
function depthToY(depth) {
  return SURFACE_Y - depth;
}

/** Tiny floating score text (canvas sprites, self-disposing). */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#FFF6EC') {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 38px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(42,26,60,0.9)';
      g.strokeText(text, 128, 40);
      g.fillStyle = color;
      g.fillText(text, 128, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      // F4 P2-3: catches at the pond edges must not clip their popups
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.85, halfH: 0.27 }));
      sprite.scale.set(1.7, 0.53, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.95 });
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

/** Fit a GLB into a target size, centered in a wrapper group. */
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

/** @type {object} §E8 plugin */
export default {
  id: 'fishingPond',
  assetKeys: [
    'food-kit/fish',
    'nature-kit/bridge_wood',
    'nature-kit/rock_largeA',
    'nature-kit/rock_smallA',
    'nature-kit/tree_default',
    'nature-kit/tree_pineRoundA',
    'nature-kit/grass_large',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    this.disposed = false;

    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.state = 'idle'; // 'idle' | 'lowering' | 'raising' | 'reeling'
    this.score = 0;
    this.hookDepth = 0;
    this.held = false;
    this.endT = 0;
    /** @type {{kind:string, holder:THREE.Group|null}|null} item on the hook while raising */
    this.hooked = null;
    this.reel = null; // { taps, t, fish }
    this.sinceBoot = 0;
    this.bootRollT = 0;
    this.emotionT = 0;
    this.fireflyT = 1.5;
    // ── V2/G23: §C6 species meta ──
    // V2/G26 fix: bandAt returns {band, tInBand, blend} — the string compare
    // left the §C10.3 nightEel gate permanently closed.
    this.night = bandAt(now()).band === 'night'; // §C10.3: nightEel gate, fixed per round
    /** @type {string[]} §B3 meta.caught — species ids, in catch order */
    this.caught = [];
    /** V3/G44 rare display ids caught this run (album receives mapped ids). */
    this.rareCaught = [];
    this.rareSetAwarded = false;
    /** @type {Record<string, THREE.MeshBasicMaterial>} lazy per-species tints */
    this.speciesMats = {};
    // ── end V2/G23 ──

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#3A2C55'); // dusk violet

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    // --- dusk lighting: warm-orange hemisphere + low sun glow ---
    scene.add(new THREE.HemisphereLight(0xffb27a, 0x4a3560, 1.05));
    const sunDir = new THREE.DirectionalLight(0xff9a5c, 0.7);
    sunDir.position.set(-3, 2, 5);
    scene.add(sunDir);
    const sun = own(new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb36b })
    ));
    sun.position.set(-1.0, 1.85, -6);
    scene.add(sun);
    const glow = own(new THREE.Mesh(
      new THREE.PlaneGeometry(14, 2.6),
      new THREE.MeshBasicMaterial({
        color: 0xff8f5a, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    ));
    glow.position.set(0, 1.55, -5.5);
    scene.add(glow);

    // --- far shore + silhouette trees ---
    const shore = own(new THREE.Mesh(
      new THREE.PlaneGeometry(12, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2a1f42 })
    ));
    shore.position.set(0, SURFACE_Y + 0.22, -4.5);
    scene.add(shore);
    const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x241a3d });
    this.ownedMats.push(silhouetteMat);
    const darken = (holder) => {
      holder.traverse((o) => {
        if (o.isMesh) o.material = silhouetteMat;
      });
      return holder;
    };
    for (const [key, x, s] of [
      ['nature-kit/tree_default', -1.45, 1.7],
      ['nature-kit/tree_pineRoundA', 1.3, 2.0],
      ['nature-kit/tree_default', 0.35, 1.25],
    ]) {
      const tree = darken(fitModel(ctx.assets.getModel(key), s));
      tree.position.set(x, SURFACE_Y + s * 0.34, -4.4);
      scene.add(tree);
    }

    // --- water: translucent front pane + rippling surface strip ---
    const water = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 1, SURFACE_Y + this.halfH),
      new THREE.MeshBasicMaterial({
        color: 0x1d4e63, transparent: true, opacity: 0.6, depthWrite: false,
      })
    ));
    water.position.set(0, (SURFACE_Y - this.halfH) / 2, 0.4);
    scene.add(water);
    const rippleGeo = new THREE.PlaneGeometry(this.halfW * 2 + 1, 0.12, 40, 1);
    this.ownedGeos.push(rippleGeo);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: 0xffc98a, transparent: true, opacity: 0.65, depthWrite: false,
    });
    this.ownedMats.push(rippleMat);
    this.ripple = new THREE.Mesh(rippleGeo, rippleMat);
    this.ripple.position.set(0, SURFACE_Y, 0.5);
    scene.add(this.ripple);
    this.rippleBase = Float32Array.from(rippleGeo.attributes.position.array);

    // ── V2/G26 (§C11.2): cosmetic rain ripple rings when it rains outside ──
    // ONE extra instanced draw call along the water line; pure dressing (no
    // gameplay effect). weatherFx owns geometry/material; disposed below.
    this.rainRipples = weatherAt(now()).state === 'rain'
      ? mountPondRipples(scene, { surfaceY: SURFACE_Y, halfW: this.halfW * 0.9, z: 0.55 })
      : null;
    // ── end V2/G26 ──

    // --- near shore: grass band + rocks + grass tufts (front frame) ---
    const bank = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 1, 1.1),
      new THREE.MeshBasicMaterial({ color: 0x35284f })
    ));
    bank.position.set(0, -this.halfH + 0.4, 0.9);
    scene.add(bank);
    const rockL = fitModel(ctx.assets.getModel('nature-kit/rock_largeA'), 1.15);
    rockL.position.set(-1.45, -this.halfH + 0.75, 1.1);
    scene.add(rockL);
    const rockS = fitModel(ctx.assets.getModel('nature-kit/rock_smallA'), 0.6);
    rockS.position.set(1.5, -this.halfH + 0.62, 1.15);
    scene.add(rockS);
    const grass = fitModel(ctx.assets.getModel('nature-kit/grass_large'), 0.55);
    grass.position.set(0.6, -this.halfH + 0.62, 1.2);
    scene.add(grass);

    // --- wooden bridge (right) with Gooby sitting on it, rod in paws ---
    const bridge = fitModel(ctx.assets.getModel('nature-kit/bridge_wood'), 2.1);
    bridge.position.set(1.45, SURFACE_Y + 0.32, -1.0);
    scene.add(bridge);
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.scale.setScalar(0.62);
    this.gooby.group.position.set(1.28, SURFACE_Y + 0.62, -0.9);
    this.gooby.group.rotation.y = -0.5; // toward the line
    this.gooby.setEmotion('happy');
    this.gooby.play('sitDrive', { loop: 'hold' });
    scene.add(this.gooby.group);
    this.gooby.lookAt(new THREE.Vector3(ROD_TIP.x, SURFACE_Y, 2));

    // rod: thin cylinder from Gooby's paws to the rod tip
    const paw = new THREE.Vector3(1.05, SURFACE_Y + 0.85, -0.85);
    const tip = new THREE.Vector3(ROD_TIP.x, ROD_TIP.y, SWIM_Z);
    const rodVec = tip.clone().sub(paw);
    const rod = own(new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.028, rodVec.length(), 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.7 })
    ));
    rod.position.copy(paw).addScaledVector(rodVec, 0.5);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rodVec.clone().normalize());
    scene.add(rod);

    // fishing line (rod tip → bobber) + bobber + hook
    const lineGeo = new THREE.BufferGeometry().setFromPoints([tip, tip.clone()]);
    this.ownedGeos.push(lineGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xe8e0d0, transparent: true, opacity: 0.8 });
    this.ownedMats.push(lineMat);
    this.line = new THREE.Line(lineGeo, lineMat);
    scene.add(this.line);
    this.bobber = new THREE.Group();
    const bobTop = own(new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8542f, roughness: 0.4 })
    ));
    const bobBot = own(new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff6ec, roughness: 0.4 })
    ));
    bobBot.position.y = -0.05;
    const hookCurve = own(new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.012, 6, 12, Math.PI * 1.4),
      new THREE.MeshStandardMaterial({ color: 0xcfd6e8, metalness: 0.7, roughness: 0.3 })
    ));
    hookCurve.position.y = -0.16;
    hookCurve.rotation.z = Math.PI * 0.8;
    this.bobber.add(bobTop, bobBot, hookCurve);
    this.bobber.position.set(FISHING.HOOK_X, SURFACE_Y, SWIM_Z);
    scene.add(this.bobber);

    // --- swimmers: fish pool + occasional boot ---
    this.fishSilhouette = new THREE.MeshBasicMaterial({
      color: 0x22364a, transparent: true, opacity: 0.95,
    });
    this.ownedMats.push(this.fishSilhouette);
    /** @type {Array<{kind:string, holder:THREE.Group, x:number, depth:number, dir:number, speed:number, bobPhase:number, respawnT:number, active:boolean}>} */
    this.swimmers = [];
    for (let i = 0; i < FISHING.FISH_COUNT; i += 1) this.spawnFish(true);
    this.boot = null; // { holder, x, depth, dir }

    // --- input: raw press/release (HOLD mechanics need pointer down/up —
    // precedent: city/carController.js thumb zones) ---
    this.onPointerDown = () => {
      if (this.phase !== 'play' || this.autoplay) return;
      this.press();
    };
    this.onPointerUp = () => {
      if (this.phase !== 'play' || this.autoplay) return;
      this.release();
    };
    const el = ctx.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);

    // autoplay bot state
    this.bot = { target: null, waitT: 0, tapT: 0, fumble: false, releaseEps: 0, overshootAt: 0 };

    ctx.hud.setScore(0);
    ctx.hud.setTime(FISHING.DURATION_SEC);
  },

  /** Spawn (or respawn) one fish at a random depth/side. */
  spawnFish(initial = false) {
    const { rng, assets } = this.ctx;
    const kind = rollFishKind(rng);
    const holder = fitModel(assets.getModel('food-kit/fish'), FISHING.SIZES[kind].scale + 0.25);
    // ── V2/G23: §C6 species roll at spawn (seeded, deterministic) — the
    // species tint is visible in the pond; catches report meta.caught (§B3).
    const detail = rollSpeciesDetail(kind, rng, this.night);
    const { species, collectionId, rare } = detail;
    holder.traverse((o) => {
      if (o.isMesh) o.material = this.speciesMat(species);
    });
    if (rare) this.decorateRareFish(holder, species);
    // ── end V2/G23 ──
    const dir = rng() < 0.5 ? 1 : -1;
    const depth =
      FISHING.FISH_DEPTH_MIN + rng() * (FISHING.FISH_DEPTH_MAX - FISHING.FISH_DEPTH_MIN);
    const x = initial
      ? (rng() * 2 - 1) * FISHING.POND_HALF_W
      : -dir * (FISHING.POND_HALF_W + 0.3); // swim in from the edge
    const fish = {
      kind,
      species, // V2/G23: §C6 species id
      collectionId,
      rare,
      holder,
      x,
      depth,
      dir,
      speed: fishSpeedFor(kind, rng),
      bobPhase: rng() * Math.PI * 2,
      respawnT: 0,
      active: true,
    };
    holder.position.set(x, depthToY(depth), SWIM_Z);
    holder.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.ctx.scene.add(holder);
    this.swimmers.push(fish);
    return fish;
  },

  // ── V2/G23: lazy per-species tint (muted like the old silhouette so the
  // dusk mood survives, but the §C6 "visible color roll" reads clearly) ──
  speciesMat(species) {
    if (!this.speciesMats[species]) {
      const mat = new THREE.MeshBasicMaterial({
        color: SPECIES_COLORS[species] ?? '#22364A',
        transparent: true,
        opacity: 0.95,
      });
      this.speciesMats[species] = mat;
      this.ownedMats.push(mat);
    }
    return this.speciesMats[species];
  },
  // ── end V2/G23 ──

  /** V3/G44: silhouette-readable rare marker, not color alone. */
  decorateRareFish(holder, species) {
    let marker;
    if (species === 'pearlMinnow') {
      marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#FFFFFF' })
      );
    } else if (species === 'sunsetKoi') {
      marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.028, 7, 16),
        new THREE.MeshBasicMaterial({ color: '#FFD166' })
      );
    } else {
      marker = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.16, 5),
        new THREE.MeshBasicMaterial({ color: '#FFF0A8' })
      );
    }
    this.ownedGeos.push(marker.geometry);
    this.ownedMats.push(marker.material);
    marker.position.set(0, 0.22, 0.12);
    holder.add(marker);
  },

  /** Spawn the drifting boot (procedural: shaft + foot boxes). */
  spawnBoot() {
    const { rng } = this.ctx;
    const holder = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x3d2c22, transparent: true, opacity: 0.95 });
    this.ownedMats.push(mat);
    const shaftGeo = new THREE.BoxGeometry(0.2, 0.34, 0.14);
    const footGeo = new THREE.BoxGeometry(0.34, 0.15, 0.14);
    this.ownedGeos.push(shaftGeo, footGeo);
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.set(-0.05, 0.1, 0);
    const foot = new THREE.Mesh(footGeo, mat);
    foot.position.set(0.06, -0.12, 0);
    holder.add(shaft, foot);
    const dir = rng() < 0.5 ? 1 : -1;
    const depth = 1.0 + rng() * (FISHING.FISH_DEPTH_MAX - 1.4);
    const boot = { kind: 'boot', holder, x: -dir * (FISHING.POND_HALF_W + 0.35), depth, dir };
    holder.position.set(boot.x, depthToY(depth), SWIM_Z);
    this.ctx.scene.add(holder);
    this.boot = boot;
  },

  /** HOLD (press): start lowering, or count a reel tap (§C6.1). */
  press() {
    if (this.state === 'reeling') {
      this.reel.taps += 1;
      this.ctx.audio.play('fish.reelTap');
      this.particles.emit('bubbles', this.bobber.position, { count: 2 });
      return;
    }
    this.held = true;
    if (this.state === 'idle') {
      this.state = 'lowering';
      this.ctx.audio.play('fish.cast');
    }
  },

  /** RELEASE: hook the nearest swimmer at this depth within the radius. */
  release() {
    this.held = false;
    if (this.state !== 'lowering') return;
    const pool = [...this.swimmers.filter((f) => f.active)];
    if (this.boot) pool.push(this.boot);
    const idx = nearestCatch(pool, FISHING.HOOK_X, this.hookDepth);
    if (idx === -1) {
      this.state = 'raising';
      this.hooked = null;
      if (this.hookDepth > 0.6) {
        this.floats.spawn(t('mg.fish.nothing'), this.bobber.position.clone().add(new THREE.Vector3(0, 0.3, 0)), '#B9AEF0');
      }
      return;
    }
    const item = pool[idx];
    this.ctx.audio.play('fish.hook');
    this.particles.emit('bubbles', this.bobber.position, { count: 5 });
    if (needsReel(item.kind)) {
      // big one — reel-in wiggle (§C6.1: ~5 rapid taps in 2 s else escape)
      this.state = 'reeling';
      this.reel = { taps: 0, t: 0, fish: item };
      item.active = false;
      this.ctx.hud.banner(t('mg.fish.reel'));
      this.ctx.audio.play('fish.bigOne');
      return;
    }
    this.hookItem(item);
    this.state = 'raising';
  },

  /** Attach a swimmer to the hook (it rides up with the bobber). */
  hookItem(item) {
    if (item.kind === 'boot') {
      this.boot = null;
    } else {
      item.active = false;
      item.respawnT = Infinity; // removed below; respawn on landing
    }
    this.hooked = {
      kind: item.kind,
      species: item.species,
      collectionId: item.collectionId,
      rare: item.rare,
      holder: item.holder,
    };
  },

  /** Hook reached the surface — resolve whatever is on it. */
  landCatch() {
    const pos = this.bobber.position.clone().add(new THREE.Vector3(0, 0.35, 0));
    if (!this.hooked) {
      this.state = 'idle';
      return;
    }
    const { kind, species, collectionId, rare, holder } = this.hooked;
    const value = catchValue(kind);
    const prev = this.score;
    this.score = applyCatch(this.score, value);
    if (this.score !== prev) this.ctx.onScore(this.score - prev);
    this.particles.emit('bubbles', this.bobber.position, { count: 6 });
    this.particles.emit('sparkles', pos, { count: value > 0 ? 7 : 3 });
    if (kind === 'boot') {
      this.ctx.audio.play('fish.boot');
      this.floats.spawn(t('mg.fish.boot', { pts: Math.abs(value) }), pos, '#D64570');
      this.reactGooby('grumpy', 'refuse');
    } else {
      this.ctx.audio.play('fish.catch');
      // ── V2/G23: §C6 species meta — record the catch + species float text ──
      if (species) {
        this.caught.push(collectionId ?? species);
        if (rare) this.rareCaught.push(species);
        const name = rare
          ? t(`v3.depth.fish.${species}`)
          : t(`sticker.fish.${species}.name`);
        this.floats.spawn(
          t('mg.fish.species', { name, pts: value }),
          pos,
          species === 'goldenFish' ? '#FFD24A' : kind === 'L' ? '#FFE08A' : '#BFF0C8'
        );
        if (species === 'goldenFish') {
          this.ctx.hud.banner(t('mg.fish.golden'));
          this.particles.emit('confetti', pos, { count: 14 });
        }
        if (!this.rareSetAwarded && rareSetBonus(this.rareCaught) > 0) {
          this.rareSetAwarded = true;
          const bonus = rareSetBonus(this.rareCaught);
          this.score += bonus;
          this.ctx.onScore(bonus);
          this.ctx.hud.banner(t('v3.depth.fish.rareSet', { n: bonus }));
          this.particles.emit('confetti', pos, { count: 20 });
        }
      } else {
        const key = kind === 'S' ? 'mg.fish.small' : kind === 'M' ? 'mg.fish.medium' : 'mg.fish.large';
        this.floats.spawn(t(key, { pts: value }), pos, kind === 'L' ? '#FFE08A' : '#BFF0C8');
      }
      // ── end V2/G23 ──
      this.reactGooby(kind === 'L' ? 'ecstatic' : 'happy', 'happyBounce');
      if (kind === 'L') {
        this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 0.8, 0)), { count: 10 });
      }
    }
    // remove the landed swimmer mesh and (fish only) respawn a fresh one
    holder.parent?.remove(holder);
    if (kind !== 'boot') {
      const i = this.swimmers.findIndex((f) => f.holder === holder);
      if (i >= 0) this.swimmers.splice(i, 1);
      this.spawnFish(false);
    }
    this.hooked = null;
    this.state = 'idle';
  },

  /** Brief Gooby reaction, then back to fishing (seated). */
  reactGooby(emotion, clip) {
    this.gooby.setEmotion(emotion);
    this.emotionT = 1.6;
    this.gooby.play(clip).then(() => {
      if (!this.disposed) this.gooby.play('sitDrive', { loop: 'hold' });
    });
  },

  /** Dev autoplay: pick a fish whose crossing lines up with the lowering time. */
  autoplayTick(dt, elapsed) {
    const { rng } = this.ctx;
    const bot = this.bot;
    if (this.state === 'reeling') {
      bot.tapT -= dt;
      if (bot.tapT <= 0) {
        bot.tapT = bot.fumble ? 0.55 : 0.28 + rng() * 0.1;
        this.press();
      }
      return;
    }
    if (this.state === 'idle') {
      bot.waitT -= dt;
      if (bot.waitT > 0) return;
      // find a fish whose arrival at the line matches our lowering time
      for (const f of this.swimmers) {
        if (!f.active) continue;
        const toLine = (FISHING.HOOK_X - f.x) / (f.dir * f.speed);
        if (toLine <= 0 || toLine > 3.5) continue;
        const lowerT = f.depth / FISHING.LOWER_SPEED;
        if (Math.abs(toLine - lowerT) < 0.3) {
          bot.target = f;
          bot.releaseEps = (rng() - 0.5) * 0.24; // aim wobble
          // human-ish error: sometimes sail well past the fish → whiff
          // (keeps the typical §C6 payout ~15c instead of a perfect bot)
          bot.overshootAt = f.depth + (rng() < 0.45 ? 0.85 + rng() * 0.3 : 0.45);
          bot.fumble = rng() < 0.15;
          this.press();
          return;
        }
      }
      bot.waitT = 0.15;
      return;
    }
    if (this.state === 'lowering') {
      const f = bot.target;
      if (!f || !f.active) {
        this.release();
        bot.target = null;
        bot.waitT = 0.4;
        return;
      }
      const whiffing = bot.overshootAt > f.depth + 0.6; // planned miss: hold past the fish
      const near =
        !whiffing &&
        Math.abs(this.hookDepth - f.depth - bot.releaseEps) < 0.1 &&
        Math.abs(f.x - FISHING.HOOK_X) < FISHING.CATCH_RADIUS * 0.8;
      const overshot = this.hookDepth > bot.overshootAt || this.hookDepth >= FISHING.MAX_DEPTH - 0.01;
      if (near || overshot) {
        this.release();
        bot.target = null;
        bot.waitT = 0.5 + rng() * 0.8;
      }
    }
    void elapsed;
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);
    this.rainRipples?.update(dt); // V2/G26 (§C11.2)

    // ripple: gentle sine on the surface strip
    const rp = this.ripple.geometry.attributes.position;
    for (let i = 0; i < rp.count; i += 1) {
      const bx = this.rippleBase[i * 3];
      rp.setY(i, this.rippleBase[i * 3 + 1] + Math.sin(bx * 3.4 + elapsed * 1.8) * 0.03);
    }
    rp.needsUpdate = true;

    if (this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.gooby.setEmotion('happy');
    }
    this.fireflyT -= dt;
    if (this.fireflyT <= 0) {
      this.fireflyT = 1.6 + ctx.rng() * 1.5;
      this.particles.emit('sparkles', new THREE.Vector3(
        (ctx.rng() * 2 - 1) * 1.6, SURFACE_Y + 0.7 + ctx.rng() * 1.6, -1.5
      ), { count: 1 });
    }

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.5 && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: this.score, meta: { caught: this.caught } }); // V2/G23: §B3 species meta
      }
      return;
    }

    const remaining = FISHING.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);

    if (this.autoplay) this.autoplayTick(dt, elapsed);

    // --- swimmers ---
    for (const f of this.swimmers) {
      if (!f.active) continue;
      f.x += f.dir * f.speed * dt;
      // turn at the walls — only when heading outward, so fresh fish that
      // spawn just past the edge (spawnFish) can swim in without jittering
      if ((f.x > FISHING.POND_HALF_W && f.dir > 0) || (f.x < -FISHING.POND_HALF_W && f.dir < 0)) {
        f.dir *= -1;
        f.holder.rotation.y = f.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      f.holder.position.set(
        f.x,
        depthToY(f.depth) + Math.sin(elapsed * 1.7 + f.bobPhase) * 0.05,
        SWIM_Z
      );
    }
    if (this.boot) {
      this.boot.x += this.boot.dir * FISHING.BOOT_SPEED * dt;
      this.boot.holder.position.set(this.boot.x, depthToY(this.boot.depth), SWIM_Z);
      this.boot.holder.rotation.z = Math.sin(elapsed * 0.8) * 0.15;
      if (Math.abs(this.boot.x) > FISHING.POND_HALF_W + 0.5) {
        this.boot.holder.parent?.remove(this.boot.holder);
        this.boot = null;
      }
    } else {
      this.sinceBoot += dt;
      this.bootRollT -= dt;
      if (this.bootRollT <= 0) {
        this.bootRollT = 1;
        if (shouldSpawnBoot(ctx.rng, this.sinceBoot)) {
          this.spawnBoot();
          this.sinceBoot = 0;
        }
      }
    }

    // --- hook state machine ---
    if (this.state === 'lowering') {
      if (this.held) this.hookDepth = lowerDepth(this.hookDepth, dt);
      if (this.hookDepth >= FISHING.MAX_DEPTH && !this.autoplay) {
        // bottomed out — auto release so the hook never sticks
        this.release();
      }
    } else if (this.state === 'raising') {
      this.hookDepth = Math.max(0, this.hookDepth - FISHING.RAISE_SPEED * dt);
      if (this.hookDepth <= 0) this.landCatch();
    } else if (this.state === 'reeling') {
      this.reel.t = advanceReelElapsed(this.reel.t, dt);
      // hooked big fish thrashes at depth
      const f = this.reel.fish;
      f.holder.position.set(
        FISHING.HOOK_X + Math.sin(elapsed * 26) * 0.09,
        depthToY(this.hookDepth) - 0.1,
        SWIM_Z
      );
      const res = reelResolve(this.reel.taps, this.reel.t);
      if (res === 'caught') {
        this.hookItem(f);
        this.state = 'raising';
        this.reel = null;
      } else if (res === 'escaped') {
        this.ctx.audio.play('fish.escape');
        this.floats.spawn(t('mg.fish.escaped'), this.bobber.position.clone().add(new THREE.Vector3(0, 0.3, 0)), '#D64570');
        // fish darts away and leaves the pond
        const i = this.swimmers.indexOf(f);
        if (i >= 0) this.swimmers.splice(i, 1);
        f.holder.parent?.remove(f.holder);
        this.spawnFish(false);
        this.reactGooby('sad', 'sadSlump');
        this.reel = null;
        this.hooked = null;
        this.state = 'raising';
      }
    }

    // bobber + line + hooked item follow the hook depth
    const bobY = depthToY(this.hookDepth) + (this.hookDepth <= 0 ? Math.sin(elapsed * 2.2) * 0.03 : 0);
    this.bobber.position.set(FISHING.HOOK_X, bobY, SWIM_Z);
    if (this.hooked?.holder) {
      this.hooked.holder.position.set(FISHING.HOOK_X, bobY - 0.28, SWIM_Z);
      this.hooked.holder.rotation.z = Math.sin(elapsed * 14) * 0.25;
    }
    const lp = this.line.geometry.attributes.position;
    lp.setXYZ(1, FISHING.HOOK_X, bobY + 0.06, SWIM_Z);
    lp.needsUpdate = true;

    if (remaining <= 0) {
      this.phase = 'ending';
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 0.9, 0)), { count: 16 });
      if (this.autoplay) {
        console.log(
          `[fishingPond] autoplay run ended — score ${this.score}, ` +
          `rares ${this.rareCaught.join(',') || 'none'}, setBonus ${this.rareSetAwarded}`
        );
      }
    }
  },

  dispose() {
    this.disposed = true;
    const el = this.ctx?.renderer?.domElement;
    el?.removeEventListener('pointerdown', this.onPointerDown);
    el?.removeEventListener('pointerup', this.onPointerUp);
    el?.removeEventListener('pointercancel', this.onPointerUp);
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    this.rainRipples?.dispose(); // V2/G26 (§C11.2)
    this.rainRipples = null;
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    // GLB clones share cached geometries/materials — the framework scene
    // sweep handles GPU frees; drop references only.
    this.ownedGeos = [];
    this.ownedMats = [];
    this.speciesMats = {}; // V2/G23: tints live in ownedMats, disposed above
    this.rareCaught = [];
    this.swimmers = [];
    this.boot = null;
    this.hooked = null;
    this.reel = null;
    this.bot = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.ripple = null;
    this.line = null;
    this.bobber = null;
    this.ctx = null;
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
