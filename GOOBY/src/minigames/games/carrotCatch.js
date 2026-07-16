// Carrot Catch (§C6.1 #2, agent G8): Gooby holds a basket at the bottom of a
// pastel meadow-sky stage; food GLBs rain down with gentle spin. Drag
// horizontally to move. Good food +1–3 pts by rarity, junk (crushed soda can,
// fish bones) −2 and 0.5 s dizzy. 60 s; fall speed +8%/10 s; junk ratio ramps
// 10%→30%. Pure scoring/ramp logic lives in carrotCatch.logic.js (§B rule).
// Dev-only ?autoplay=1 plays the round automatically (headless verification).

import * as THREE from 'three';
import { UI_COLORS } from '../../data/constants.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { getMinigame, computeCoins } from '../../data/minigames.js'; // G14: tutorial coin floor (§C8.1)
import {
  CATCH,
  GOOD_FOODS,
  JUNK_FOODS,
  fallSpeedAt,
  spawnIntervalAt,
  rollItem,
  applyCatch,
} from './carrotCatch.logic.js';

/** Basket catch geometry (world units at the z=0 play plane). */
const BASKET_HALF_WIDTH = 0.62;
const BASKET_Y = -2.55;
const ITEM_SIZE = 0.52;

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

/** Tiny floating score text (canvas-texture sprites, self-disposing). */
function createFloatTexts(scene) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#4A3B36') {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 44px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(text, 80, 40);
      g.fillStyle = color;
      g.fillText(text, 80, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(pos);
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
  id: 'carrotCatch',
  assetKeys: [
    ...GOOD_FOODS.map((f) => `food-kit/${f.key}`),
    ...JUNK_FOODS.map((k) => `food-kit/${k}`),
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    // G14: onboarding tutorial variant (§C8.1) — shorter round + coin floor
    this.durationSec = Number.isFinite(ctx.params?.durationSec) ? ctx.params.durationSec : CATCH.DURATION_SEC;
    this.minCoins = Number.isFinite(ctx.params?.minCoins) ? ctx.params.minCoins : null;
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.score = 0;
    this.spawnT = 0.6; // small head start before the first item
    this.dizzyT = 0;
    this.endT = 0;
    this.autoT = 0;
    this.autoTargetX = 0;

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);
    this.boundX = this.halfW - 0.55;

    const scene = ctx.scene;
    scene.background = new THREE.Color('#BFE6F7'); // sunny sky

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    // --- backdrop: sun, rolling hills, meadow strip ---
    const sun = own(new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 32),
      new THREE.MeshBasicMaterial({ color: UI_COLORS.YELLOW })
    ));
    sun.position.set(this.halfW - 1.1, this.halfH - 1.3, -3);
    scene.add(sun);
    for (const [x, r, c] of [[-2.4, 3.4, '#BFE3A9'], [2.6, 4.0, '#ABD98F']]) {
      const hill = own(new THREE.Mesh(
        new THREE.CircleGeometry(r, 40),
        new THREE.MeshBasicMaterial({ color: c })
      ));
      hill.position.set(x, -this.halfH - r * 0.55, -2);
      scene.add(hill);
    }
    const meadow = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 2, 2.4),
      new THREE.MeshBasicMaterial({ color: '#8FCE7A' })
    ));
    meadow.position.set(0, -this.halfH + 0.5, -1);
    scene.add(meadow);

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0xc8e6b8, 1.15));
    const dir = new THREE.DirectionalLight(0xfff2dd, 0.95);
    dir.position.set(2, 5, 4);
    scene.add(dir);

    // --- Gooby (the real rig, small) + basket held above his head ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.scale.setScalar(0.85);
    this.gooby.group.position.set(0, -this.halfH + 0.32, 0.2);
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    this.basket = new THREE.Group();
    const bowlPts = [];
    for (let i = 0; i <= 8; i += 1) {
      const t2 = i / 8;
      bowlPts.push(new THREE.Vector2(0.18 + t2 * 0.42, t2 * 0.42));
    }
    const bowl = own(new THREE.Mesh(
      new THREE.LatheGeometry(bowlPts, 20),
      new THREE.MeshStandardMaterial({ color: '#C98A4B', roughness: 0.8, side: THREE.DoubleSide })
    ));
    const rim = own(new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.055, 10, 24),
      new THREE.MeshStandardMaterial({ color: '#A96C33', roughness: 0.75 })
    ));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.42;
    this.basket.add(bowl, rim);
    this.basket.position.set(0, BASKET_Y, 0.1);
    scene.add(this.basket);
    this.basketX = 0;
    this.targetX = 0;

    // --- falling items (pooled per asset key) ---
    /** @type {Array<{holder: THREE.Group, key: string, kind: string, value: number, spinX: number, spinZ: number, active: boolean}>} */
    this.items = [];
    /** @type {Map<string, THREE.Group[]>} */
    this.pool = new Map();

    // --- input: drag horizontally to move (§C6.1) ---
    this.offDrag = ctx.input.on('drag', (p) => {
      if (this.autoplay || this.dizzyT > 0 || this.phase !== 'play') return;
      this.targetX = THREE.MathUtils.clamp(p.nx * this.halfW, -this.boundX, this.boundX);
    });
    this.offStart = ctx.input.on('dragstart', (p) => {
      if (this.autoplay || this.dizzyT > 0 || this.phase !== 'play') return;
      this.targetX = THREE.MathUtils.clamp(p.nx * this.halfW, -this.boundX, this.boundX);
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(this.durationSec); // G14: tutorial variant honors params.durationSec
  },

  /** Take (or clone) a model holder for an asset key. */
  takeItem(key) {
    const free = this.pool.get(key);
    if (free && free.length > 0) return free.pop();
    return fitModel(this.ctx.assets.getModel(`food-kit/${key}`), ITEM_SIZE);
  },

  spawnItem(elapsed) {
    const { rng } = this.ctx;
    const roll = rollItem(rng, elapsed);
    const holder = this.takeItem(roll.key);
    holder.position.set(
      (rng() * 2 - 1) * (this.halfW - 0.5),
      this.halfH + 0.7,
      0
    );
    holder.rotation.set(0, rng() * Math.PI * 2, 0);
    holder.visible = true;
    this.ctx.scene.add(holder);
    this.items.push({
      holder,
      key: roll.key,
      kind: roll.kind,
      value: roll.value,
      spinX: (rng() - 0.5) * 2.4,
      spinZ: (rng() - 0.5) * 1.6,
      active: true,
    });
  },

  despawnItem(item) {
    item.active = false;
    item.holder.visible = false;
    this.ctx.scene.remove(item.holder);
    if (!this.pool.has(item.key)) this.pool.set(item.key, []);
    this.pool.get(item.key).push(item.holder);
  },

  addScore(value, pos) {
    const next = applyCatch(this.score, value);
    const delta = next - this.score;
    this.score = next;
    if (delta !== 0) this.ctx.onScore(delta);
    this.floats.spawn(
      value > 0 ? `+${value}` : `${value}`,
      pos,
      value > 0 ? '#2E8B57' : '#D64570'
    );
  },

  catchItem(item) {
    const pos = item.holder.position.clone();
    this.despawnItem(item);
    if (item.kind === 'good') {
      this.addScore(item.value, pos);
      this.ctx.audio.play('catch.good');
      this.particles.emit('sparkles', pos, { count: 6 });
      const basket = this.basket;
      tween({
        from: 1.25, to: 1, duration: 0.22, ease: easings.easeOutBack,
        onUpdate: (v) => basket.scale.set(v, 2 - v, v),
      });
      if (item.value >= 3) {
        this.gooby.play('happyBounce');
        this.particles.emit('hearts', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1, 0)), { count: 3 });
      }
    } else {
      this.addScore(item.value, pos);
      this.ctx.audio.play('catch.bad');
      this.dizzyT = CATCH.DIZZY_SEC;
      this.gooby.play('dizzy', { speed: 2.0 / CATCH.DIZZY_SEC }); // 2 s clip squeezed into the 0.5 s dizzy
      this.particles.emit('dizzyStars', this.basket.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
    }
  },

  /** Dev-only autoplay: chase catches with human-ish lag, aim error + missed dodges. */
  autoplayTick(dt) {
    this.autoT -= dt;
    if (this.autoT > 0) return;
    const { rng } = this.ctx;
    this.autoT = 0.3; // sluggish decision rate
    if (rng() < 0.3) {
      this.autoT = 0.5 + rng() * 0.8; // distraction — stop tracking for a bit
      return;
    }
    let best = null;
    for (const item of this.items) {
      if (!item.active || item.kind !== 'good') continue;
      const y = item.holder.position.y;
      if (y > BASKET_Y + 0.1 && (best == null || y < best.holder.position.y)) best = item;
    }
    let target = best ? best.holder.position.x : 0;
    for (const item of this.items) {
      if (!item.active || item.kind !== 'junk') continue;
      const p = item.holder.position;
      if (rng() < 0.55 && Math.abs(p.x - target) < 0.5 && p.y < BASKET_Y + 1.6) {
        target += p.x > target ? -0.9 : 0.9; // usually (not always) dodge junk
      }
    }
    this.autoTargetX = THREE.MathUtils.clamp(target + (rng() - 0.5) * 1.1, -this.boundX, this.boundX);
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
        // G14: tutorial coin floor (§C8.1 — guaranteed ≥ params.minCoins)
        const floorCoins = this.minCoins == null ? undefined
          : Math.max(this.minCoins, computeCoins(getMinigame('carrotCatch').coinTable, this.score, false));
        ctx.onEnd({ score: this.score, coins: floorCoins });
      }
      return;
    }

    const remaining = this.durationSec - elapsed; // G14: tutorial variant
    ctx.hud.setTime(remaining);

    if (this.dizzyT > 0) this.dizzyT -= dt;

    if (this.autoplay && this.dizzyT <= 0) {
      this.autoplayTick(dt);
      this.targetX = this.autoTargetX;
    }

    // basket + Gooby follow the drag target (locked while dizzy)
    if (this.dizzyT <= 0) {
      this.basketX += (this.targetX - this.basketX) * Math.min(1, dt * 10);
    }
    this.basket.position.x = this.basketX;
    this.basket.rotation.z = this.dizzyT > 0 ? Math.sin(elapsed * 22) * 0.22 : 0;
    this.gooby.group.position.x += (this.basketX - this.gooby.group.position.x) * Math.min(1, dt * 7);
    this.gooby.lookAt(new THREE.Vector3(this.basketX, BASKET_Y + 2.5, 0));

    // spawn cadence (tightens over the round)
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnItem(elapsed);
      this.spawnT = spawnIntervalAt(elapsed);
    }

    // falling items: gentle spin + §C6.1 speed ramp; catch at the basket band
    const speed = fallSpeedAt(elapsed);
    for (const item of this.items) {
      if (!item.active) continue;
      const h = item.holder;
      const prevY = h.position.y;
      h.position.y -= speed * dt;
      h.rotation.x += item.spinX * dt;
      h.rotation.z += item.spinZ * dt;
      if (
        prevY > BASKET_Y + 0.15 &&
        h.position.y <= BASKET_Y + 0.15 &&
        Math.abs(h.position.x - this.basketX) <= BASKET_HALF_WIDTH
      ) {
        this.catchItem(item);
        continue;
      }
      if (h.position.y < -this.halfH - 0.8) this.despawnItem(item);
    }
    this.items = this.items.filter((i) => i.active);

    if (remaining <= 0) {
      this.phase = 'ending';
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), { count: 16 });
      if (this.autoplay) console.log(`[carrotCatch] autoplay run ended — score ${this.score}`);
    }
  },

  dispose() {
    this.offDrag?.();
    this.offStart?.();
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    // GLB clones share cached geometries/materials — the framework scene sweep
    // handles GPU frees; drop references only.
    this.items = [];
    this.pool = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.basket = null;
    this.ownedGeos = [];
    this.ownedMats = [];
  },
};
