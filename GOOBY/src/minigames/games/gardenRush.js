// Watering Rush (PLAN2 §C1.2 #2, agent V2/G24): Gooby's garden in fast-forward
// — 8 terracotta pots along a garden fence (§C1.3 look: warm green backyard,
// nature-kit pots + crop stages). Seedlings sprout on independent wilt timers
// (6 s → 3 s ramp); press-and-hold a pot to water — a fill ring grows over
// 0.8 s; release inside the green zone (last 25%) = perfect +3, early +1;
// a fully wilted plant droops (−2, respawns) and decoy weeds punish waterers
// (−1, they grow bigger). 60 s. Pure wilt/fill logic in gardenRush.logic.js
// (§B rule). Dev-only ?autoplay=1 targets the lowest remaining wilt timer and
// holds 0.75 s (§C1.2), with human-ish lapses.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { clampFloatTextToView } from '../framework.js';
import {
  RUSH,
  wiltWindowAt,
  spawnIntervalAt,
  activePotsAt,
  releasePoints,
  inPerfectZone,
  rollWeed,
  applyPoints,
} from './gardenRush.logic.js';

/** Pot grid (portrait-friendly 2 columns × 3 rows) — pots #7/#8 (indices 6/7)
 * pop in on the center column in waves (§C1.2). */
const POT_POS = [
  [-1.05, -1.0], [1.05, -1.0], // back row
  [-1.05, 0.55], [1.05, 0.55], // middle row
  [-1.05, 2.1], [1.05, 2.1], // front row
  [0, -0.25], // pot #7 (center, upper)
  [0, 1.3], // pot #8 (center, lower)
];
const POT_SIZE = 0.98;
const SPROUT_SIZE = 0.8;
const TERRACOTTA = '#E8956A';

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

/**
 * nature-kit GLTFs ship metalness 1 — near-black without an env map. Clone
 * the materials (shared asset cache must stay untouched), flatten to matte
 * clay/plant shading and optionally tint. Returns the clones for disposal.
 * @param {THREE.Object3D} holder
 * @param {string|null} [tint]
 * @returns {THREE.Material[]}
 */
function mattify(holder, tint = null) {
  const clones = [];
  holder.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const clone = obj.material.clone();
    if (tint) clone.color?.setStyle(tint);
    if ('metalness' in clone) clone.metalness = 0;
    if ('roughness' in clone) clone.roughness = 0.9;
    obj.material = clone;
    clones.push(clone);
  });
  return clones;
}

/** Tiny floating score text (canvas-texture sprites, self-disposing). */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#4A3B36') {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(text, 128, 40);
      g.fillStyle = color;
      g.fillText(text, 128, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.9, halfH: 0.28 }));
      sprite.scale.set(1.8, 0.56, 1);
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
  id: 'gardenRush',
  assetKeys: [
    'nature-kit/pot_large',
    'nature-kit/pot_small',
    'nature-kit/crops_leafsStageA',
    'nature-kit/crops_leafsStageB',
    'nature-kit/grass_large',
    'nature-kit/fence_simple',
    'nature-kit/flower_redA',
    'nature-kit/flower_yellowA',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.score = 0;
    this.spawnT = 0.8;
    this.endT = 0;
    this.autoT = 0;
    /** @type {{pot: object, fillT: number}|null} active watering hold */
    this.hold = null;

    const camera = ctx.camera;
    camera.position.set(0, 8.6, 6.2);
    camera.lookAt(0, 0, 0.55);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#DFF2C8'); // fresh backyard green

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
    /** mattify + adopt the clones into this game's disposal list. */
    this.matte = (holder, tint = null) => {
      this.ownedMats.push(...mattify(holder, tint));
      return holder;
    };

    scene.add(new THREE.HemisphereLight(0xfffbe8, 0xd8c2a8, 1.3));
    const dir = new THREE.DirectionalLight(0xfff2dd, 0.9);
    dir.position.set(3, 6, 4);
    scene.add(dir);
    // Low fill from the camera side lifts the pot interiors (top-down view
    // otherwise reads them as dark holes).
    const fill = new THREE.DirectionalLight(0xffe8d0, 0.55);
    fill.position.set(0, 5, 9);
    scene.add(fill);

    // --- backyard: soil bed on grass, fence line at the back (§C1.3) ---
    const grass = own(new THREE.Mesh(
      new THREE.PlaneGeometry(16, 14),
      new THREE.MeshStandardMaterial({ color: '#8FCE7A', roughness: 1 })
    ));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    scene.add(grass);
    const soil = own(new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 5.9),
      new THREE.MeshStandardMaterial({ color: '#B98A5E', roughness: 1 })
    ));
    soil.rotation.x = -Math.PI / 2;
    soil.position.set(0, 0, 0.65);
    scene.add(soil);
    for (let i = 0; i < 3; i += 1) {
      const fence = this.matte(fitModel(ctx.assets.getModel('nature-kit/fence_simple'), 1.55));
      fence.position.set(-1.5 + i * 1.5, 0.35, -2.75);
      scene.add(fence);
    }
    for (const [key, x, z] of [['flower_redA', -1.8, -2.1], ['flower_yellowA', 1.8, -2.1]]) {
      const flower = this.matte(fitModel(ctx.assets.getModel(`nature-kit/${key}`), 0.7));
      flower.position.set(x, 0.35, z);
      scene.add(flower);
    }

    // --- pots + per-pot wilt ring ---
    /**
     * @type {Array<{index: number, group: THREE.Group, pos: THREE.Vector3,
     *   state: string, wiltT: number, wiltWindow: number, cooldownT: number,
     *   sprout: THREE.Group|null, ring: THREE.Mesh, ringMat: THREE.MeshBasicMaterial,
     *   inScene: boolean}>}
     */
    this.pots = [];
    const soilMat = new THREE.MeshStandardMaterial({ color: '#9A6B44', roughness: 1 });
    const soilGeo = new THREE.CylinderGeometry(POT_SIZE * 0.34, POT_SIZE * 0.34, 0.06, 6);
    this.ownedMats.push(soilMat);
    this.ownedGeos.push(soilGeo);
    POT_POS.forEach(([x, z], i) => {
      const group = new THREE.Group();
      const potModel = this.matte(
        fitModel(ctx.assets.getModel(i < RUSH.START_POTS ? 'nature-kit/pot_large' : 'nature-kit/pot_small'), POT_SIZE),
        TERRACOTTA
      );
      potModel.position.y = POT_SIZE * 0.32;
      group.add(potModel);
      // Soil plug just under the rim — from the top-down camera the pot
      // opening otherwise reads as a black hole.
      const soilPlug = new THREE.Mesh(soilGeo, soilMat);
      soilPlug.position.y = POT_SIZE * 0.5;
      group.add(soilPlug);
      group.position.set(x, 0, z);
      const ringMat = new THREE.MeshBasicMaterial({ color: '#66BB55', transparent: true, opacity: 0.9, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 24), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      ring.visible = false;
      group.add(ring);
      this.ownedGeos.push(ring.geometry);
      this.ownedMats.push(ringMat);
      const pot = {
        index: i,
        group,
        pos: new THREE.Vector3(x, 0, z),
        state: 'empty', // 'empty' | 'sprout' | 'weed' | 'cooldown'
        wiltT: 0,
        wiltWindow: 0,
        cooldownT: 0,
        sprout: null,
        ring,
        ringMat,
        inScene: i < RUSH.START_POTS,
      };
      if (pot.inScene) scene.add(group);
      this.pots.push(pot);
    });

    // --- fill ring (one active hold at a time): canvas arc sprite ---
    this.fillCanvas = document.createElement('canvas');
    this.fillCanvas.width = this.fillCanvas.height = 128;
    this.fillTex = new THREE.CanvasTexture(this.fillCanvas);
    this.ownedTexs.push(this.fillTex);
    this.fillMat = new THREE.SpriteMaterial({ map: this.fillTex, transparent: true, depthWrite: false });
    this.ownedMats.push(this.fillMat);
    this.fillSprite = new THREE.Sprite(this.fillMat);
    this.fillSprite.scale.set(1.5, 1.5, 1);
    this.fillSprite.visible = false;
    scene.add(this.fillSprite);

    // --- watering can (procedural) — appears over the held pot ---
    this.can = new THREE.Group();
    const canMat = new THREE.MeshStandardMaterial({ color: '#6EC6FF', roughness: 0.5, metalness: 0.2 });
    this.ownedMats.push(canMat);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.5, 16), canMat);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.62, 8), canMat);
    spout.position.set(0.42, 0.1, 0);
    spout.rotation.z = Math.PI / 2.6;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 16), canMat);
    handle.position.set(-0.3, 0.15, 0);
    this.ownedGeos.push(body.geometry, spout.geometry, handle.geometry);
    this.can.add(body, spout, handle);
    this.can.visible = false;
    scene.add(this.can);

    // --- Gooby cheering at the garden's edge ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.62);
    this.gooby.group.position.set(0.05, 0, 3.9);
    this.gooby.group.rotation.y = Math.PI; // faces the pots, back to the player
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // --- press-and-hold input (fishingPond convention: raw pointer events) ---
    this.onPointerDown = (e) => {
      if (this.autoplay || this.phase !== 'play') return;
      const ndc = { nx: (e.clientX / innerWidth) * 2 - 1, ny: -(e.clientY / innerHeight) * 2 + 1 };
      const hit = ctx.input.pick(ctx.camera, this.pots.filter((p) => p.inScene).map((p) => p.group), ndc);
      if (!hit) return;
      let obj = hit.object;
      while (obj && obj.parent && !this.pots.some((p) => p.group === obj)) obj = obj.parent;
      const pot = this.pots.find((p) => p.group === obj);
      if (pot && (pot.state === 'sprout' || pot.state === 'weed')) this.startHold(pot);
    };
    this.onPointerUp = () => {
      if (this.autoplay) return;
      this.releaseHold();
    };
    const el = ctx.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);

    ctx.hud.setScore(0);
    ctx.hud.setTime(RUSH.DURATION_SEC);
  },

  /** Sprout a seedling (or a decoy weed) in a free pot. */
  sprout(pot, elapsed) {
    const weed = rollWeed(this.ctx.rng, elapsed);
    const key = weed ? 'nature-kit/grass_large' : 'nature-kit/crops_leafsStageA';
    const holder = this.matte(fitModel(this.ctx.assets.getModel(key), SPROUT_SIZE * (weed ? 0.9 : 1)));
    holder.position.set(0, POT_SIZE * 0.72, 0);
    pot.group.add(holder);
    pot.sprout = holder;
    pot.state = weed ? 'weed' : 'sprout';
    pot.wiltWindow = wiltWindowAt(elapsed);
    pot.wiltT = weed ? RUSH.WEED_LIFE_SEC : pot.wiltWindow;
    pot.ring.visible = !weed;
    tween({
      from: 0.01, to: 1, duration: 0.3, ease: easings.easeOutBack,
      onUpdate: (v) => holder.scale.setScalar(v),
    });
    if (!weed) this.ctx.audio.play('mole.pop');
  },

  /** Clear a pot back to empty (with respawn cooldown). */
  clearPot(pot) {
    if (pot.sprout) {
      pot.group.remove(pot.sprout);
      pot.sprout = null;
    }
    pot.state = 'cooldown';
    pot.cooldownT = RUSH.RESPAWN_SEC;
    pot.ring.visible = false;
    if (this.hold?.pot === pot) this.cancelHold();
  },

  startHold(pot) {
    if (this.hold) return;
    this.hold = { pot, fillT: 0 };
    this.can.visible = true;
    this.can.position.copy(pot.pos).add(new THREE.Vector3(-0.35, 1.85, 0));
    this.can.rotation.z = -0.5;
    this.fillSprite.visible = true;
    // Ring floats toward the screen center so it never clips the viewport edge.
    const inward = pot.pos.x > 0.3 ? -0.95 : pot.pos.x < -0.3 ? 0.95 : 0;
    this.fillSprite.position.copy(pot.pos).add(new THREE.Vector3(inward, 1.6, inward === 0 ? 0.4 : 0));
    this.gooby.lookAt(pot.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    this.ctx.audio.play('garden.water');
  },

  cancelHold() {
    this.hold = null;
    this.can.visible = false;
    this.fillSprite.visible = false;
  },

  /** Release the watering hold — §C1.2 perfect/early/weed outcomes. */
  releaseHold() {
    const hold = this.hold;
    if (!hold) return;
    const pot = hold.pot;
    const frac = Math.min(1, hold.fillT / RUSH.FILL_SEC);
    this.cancelHold();
    const popPos = pot.pos.clone().add(new THREE.Vector3(0, 1.7, 0));
    if (pot.state === 'weed') {
      // Watering a weed = −1 … and it grows bigger (funny, §C1.2).
      this.addPoints(RUSH.WEED_PTS);
      this.floats.spawn(t('mg.rush.weed'), popPos, '#D64570');
      this.ctx.audio.play('bubble.wrong');
      const weedHolder = pot.sprout;
      if (weedHolder) {
        tween({
          from: 1, to: 1.45, duration: 0.3, ease: easings.easeOutBack,
          onUpdate: (v) => weedHolder.scale.setScalar(v),
        });
      }
      pot.wiltT = Math.min(pot.wiltT, 1.2); // it retreats soon after the gag
      return;
    }
    if (pot.state !== 'sprout') return;
    this.addPoints(releasePoints(frac));
    const perfect = inPerfectZone(frac);
    this.floats.spawn(perfect ? t('mg.rush.perfect') : t('mg.rush.early'), popPos, perfect ? '#2E8B57' : '#4A3B36');
    this.ctx.audio.play(perfect ? 'pancake.perfect' : 'catch.good');
    this.particles.emit('sparkles', pot.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), { count: perfect ? 8 : 4 });
    if (perfect) this.gooby.play('happyBounce');
    // Watered flash: swap to the grown crop stage for a beat, then clear.
    if (pot.sprout) {
      pot.group.remove(pot.sprout);
      pot.sprout = this.matte(fitModel(this.ctx.assets.getModel('nature-kit/crops_leafsStageB'), SPROUT_SIZE * 1.1));
      pot.sprout.position.set(0, POT_SIZE * 0.78, 0);
      pot.group.add(pot.sprout);
    }
    pot.state = 'watered';
    pot.ring.visible = false;
    pot.cooldownT = 0.55; // grown-flash beat before the pot frees up
  },

  /**
   * Apply floored points and forward the real delta to the framework HUD
   * (carrotCatch convention — onScore drives hud.setScore).
   * @param {number} pts
   */
  addPoints(pts) {
    const next = applyPoints(this.score, pts);
    const delta = next - this.score;
    this.score = next;
    if (delta !== 0) this.ctx.onScore(delta);
  },

  /** A seedling fully wilted: droop, −2, respawn (§C1.2). */
  wiltOut(pot) {
    this.addPoints(RUSH.WILT_PTS);
    this.floats.spawn(t('mg.rush.wilted'), pot.pos.clone().add(new THREE.Vector3(0, 1.7, 0)), '#D64570');
    this.ctx.audio.play('mole.steal');
    const holder = pot.sprout;
    if (holder) {
      tween({
        from: 0, to: 1, duration: 0.35, ease: easings.easeOutQuad,
        onUpdate: (v) => {
          holder.rotation.z = v * 1.1;
          holder.position.y = POT_SIZE * 0.72 - v * 0.18;
        },
        onComplete: () => this.clearPot(pot),
      });
      pot.state = 'wilting';
      pot.ring.visible = false;
    } else {
      this.clearPot(pot);
    }
  },

  /** Dev-only autoplay (§C1.2): lowest remaining wilt, hold 0.75 s. */
  autoplayTick(dt, elapsed) {
    const { rng } = this.ctx;
    if (this.hold) {
      if (this.hold.fillT >= RUSH.AUTOPLAY_HOLD_SEC) this.releaseHold();
      return;
    }
    this.autoT -= dt;
    if (this.autoT > 0) return;
    this.autoT = 0.3;
    if (rng() < 0.32) {
      this.autoT = 0.8 + rng() * 1.1; // distraction — very human
      return;
    }
    let target = null;
    for (const pot of this.pots) {
      if (!pot.inScene || pot.state !== 'sprout') continue;
      if (target == null || pot.wiltT < target.wiltT) target = pot;
    }
    // Rare mis-tap on a weed (the decoys work on bots too).
    if (rng() < 0.06) {
      const weed = this.pots.find((p) => p.inScene && p.state === 'weed');
      if (weed) target = weed;
    }
    if (target) {
      this.startHold(target);
      // Occasional nervous early release (+1 instead of +3).
      if (rng() < 0.18) this.hold.early = 0.25 + rng() * 0.35;
    }
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        if (this.autoplay) console.log(`[gardenRush] autoplay run ended — score ${this.score}`);
        ctx.onEnd({ score: this.score });
      }
      return;
    }

    const remaining = RUSH.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);

    // waves: pots #7/#8 pop in (§C1.2)
    const active = activePotsAt(elapsed);
    for (let i = 0; i < active; i += 1) {
      const pot = this.pots[i];
      if (!pot.inScene) {
        pot.inScene = true;
        ctx.scene.add(pot.group);
        ctx.hud.banner(t('mg.rush.morePots'));
        ctx.audio.play('mole.pop');
        const g = pot.group;
        tween({
          from: 0.01, to: 1, duration: 0.4, ease: easings.easeOutBack,
          onUpdate: (v) => g.scale.setScalar(v),
        });
      }
    }

    // global sprout scheduler
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const free = this.pots.filter((p) => p.inScene && p.state === 'empty');
      if (free.length > 0) {
        const pick = free[Math.min(free.length - 1, Math.floor(ctx.rng() * free.length))];
        this.sprout(pick, elapsed);
      }
      this.spawnT = spawnIntervalAt(elapsed);
    }

    // per-pot timers
    for (const pot of this.pots) {
      if (!pot.inScene) continue;
      if (pot.state === 'cooldown' || pot.state === 'watered') {
        pot.cooldownT -= dt;
        if (pot.cooldownT <= 0) {
          if (pot.state === 'watered') this.clearPot(pot);
          else pot.state = 'empty';
        }
        continue;
      }
      if (pot.state === 'sprout') {
        if (this.hold?.pot !== pot) pot.wiltT -= dt; // watering pauses the wilt
        const frac = Math.max(0, pot.wiltT / pot.wiltWindow);
        pot.ring.scale.setScalar(0.35 + 0.65 * frac);
        pot.ringMat.color.setStyle(frac > 0.5 ? '#66BB55' : frac > 0.25 ? '#E8A857' : '#D64570');
        if (pot.sprout) pot.sprout.rotation.z = (1 - frac) * 0.35; // gentle pre-droop
        if (pot.wiltT <= 0) this.wiltOut(pot);
      } else if (pot.state === 'weed') {
        pot.wiltT -= dt;
        if (pot.wiltT <= 0) {
          // ignored weeds retreat on their own — no penalty (§C1.2 only
          // punishes WATERING a weed)
          const holder = pot.sprout;
          pot.state = 'wilting';
          if (holder) {
            const startScale = holder.scale.x;
            tween({
              from: startScale, to: 0.01, duration: 0.25, ease: easings.easeOutQuad,
              onUpdate: (v) => holder.scale.setScalar(v),
              onComplete: () => this.clearPot(pot),
            });
          } else {
            this.clearPot(pot);
          }
        }
      }
    }

    // active watering hold: fill ring + can tilt + droplets
    if (this.hold) {
      this.hold.fillT += dt;
      const frac = Math.min(1, this.hold.fillT / RUSH.FILL_SEC);
      this.drawFillRing(frac);
      this.can.rotation.z = -0.5 - frac * 0.45;
      if (Math.floor(elapsed * 10) % 2 === 0) {
        this.particles.emit('bubbles', this.hold.pot.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 1 });
      }
      // bot early-release lapse (set in autoplayTick)
      if (this.autoplay && this.hold.early != null && this.hold.fillT >= this.hold.early) this.releaseHold();
    }

    if (this.autoplay) this.autoplayTick(dt, elapsed);

    if (remaining <= 0 && this.phase === 'play') {
      this.phase = 'ending';
      this.cancelHold();
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), { count: 16 });
    }
  },

  /** Redraw the hold-to-fill arc (green zone = last 25%, §C1.2). */
  drawFillRing(frac) {
    const g = this.fillCanvas.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    const cx = 64, cy = 64, r = 48;
    const start = -Math.PI / 2;
    g.lineWidth = 16;
    g.lineCap = 'round';
    // track
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    // green zone (last 25%)
    g.strokeStyle = 'rgba(102,187,85,0.85)';
    g.beginPath();
    g.arc(cx, cy, r, start + Math.PI * 2 * (1 - RUSH.PERFECT_ZONE), start + Math.PI * 2);
    g.stroke();
    // fill arc
    g.strokeStyle = inPerfectZone(frac) ? '#2E8B57' : '#6EC6FF';
    g.beginPath();
    g.arc(cx, cy, r, start, start + Math.PI * 2 * frac);
    g.stroke();
    this.fillTex.needsUpdate = true;
  },

  dispose() {
    const el = this.ctx?.renderer?.domElement;
    el?.removeEventListener('pointerdown', this.onPointerDown);
    el?.removeEventListener('pointerup', this.onPointerUp);
    el?.removeEventListener('pointercancel', this.onPointerUp);
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    // GLB clones share cached geometries/materials — framework sweep handles GPU frees.
    this.pots = [];
    this.hold = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.can = null;
    this.fillSprite = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
