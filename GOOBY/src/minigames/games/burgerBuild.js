// Burger Builder (PLAN2 §C1.2 #3, agent V2/G24): a diner with a red-and-white
// checker floor (§C1.3 look). A ticket shows the required 4–7-layer stack;
// ingredients rain in 3 columns and Gooby slides a plate to catch ONLY the
// next-needed layer (+5, snap + squish), wrong catch −2 (splats off),
// completed burger +15 and Gooby takes a comical bite; fall speed +8% per
// completed burger. 75 s. Pure ticket/matching logic in burgerBuild.logic.js
// (§B rule). Dev-only ?autoplay=1 chases the nearest falling next-needed
// ingredient's column (§C1.2) with human-ish lapses.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { clampFloatTextToView } from '../framework.js';
import {
  BURGER,
  MODEL_KEYS,
  makeTicket,
  nextNeeded,
  isComplete,
  fallSpeedAt,
  rollSpawn,
  applyCatch,
} from './burgerBuild.logic.js';

const PLATE_HALF_WIDTH = 0.78;
const ITEM_SIZE = 0.62;
/** Visual stack heights per layer id (world units). */
const LAYER_HEIGHT = { bun: 0.2, patty: 0.13, cheese: 0.06, tomato: 0.07, salad: 0.1, onion: 0.07 };
/** Ticket chip colors per layer id (canvas ticket rendering). */
const LAYER_COLORS = {
  bun: '#E8A857', patty: '#8A5A33', cheese: '#FFD166', tomato: '#E85D4A', salad: '#7CC15E', onion: '#EBDCF7',
};

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
function createFloatTexts(scene, camera) {
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

/** Red-and-white diner checkerboard CanvasTexture (§C1.3). */
function makeCheckerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const n = 8, s = 128 / n;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      g.fillStyle = (x + y) % 2 === 0 ? '#F6F1E7' : '#D64545';
      g.fillRect(x * s, y * s, s, s);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

/** @type {object} §E8 plugin */
export default {
  id: 'burgerBuild',
  assetKeys: Object.values(MODEL_KEYS),

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'bite' | 'ending' | 'done'
    this.score = 0;
    this.completed = 0;
    this.spawnT = 0.7;
    this.sinceNeeded = 0;
    this.biteT = 0;
    this.endT = 0;
    this.autoT = 0;
    this.autoTargetX = 0;

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);
    this.boundX = this.halfW - 0.7;
    this.colW = Math.min(2.1, this.halfW - 0.95);
    this.colX = [-this.colW, 0, this.colW];
    this.plateY = -this.halfH + 1.55;

    const scene = ctx.scene;
    scene.background = new THREE.Color('#FFEFD9'); // warm diner cream

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

    scene.add(new THREE.HemisphereLight(0xfff6e8, 0xe8cdb8, 1.15));
    const dir = new THREE.DirectionalLight(0xfff2dd, 0.9);
    dir.position.set(2, 5, 4);
    scene.add(dir);

    // --- diner dressing: checker floor, back wall stripe, counter (§C1.3) ---
    const checkerTex = makeCheckerTexture();
    this.ownedTexs.push(checkerTex);
    const floor = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 4, 6),
      new THREE.MeshBasicMaterial({ map: checkerTex })
    ));
    floor.rotation.x = -1.25;
    floor.position.set(0, -this.halfH + 0.4, -1.6);
    scene.add(floor);
    const stripe = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 4, 0.5),
      new THREE.MeshBasicMaterial({ color: '#D64545' })
    ));
    stripe.position.set(0, this.halfH - 4.55, -3); // diner wall stripe under the ticket
    scene.add(stripe);
    const counter = own(new THREE.Mesh(
      new THREE.BoxGeometry(this.halfW * 2 + 2, 0.42, 1.4),
      new THREE.MeshStandardMaterial({ color: '#F2E3CF', roughness: 0.7 })
    ));
    counter.position.set(0, this.plateY - 0.55, -0.4);
    scene.add(counter);

    // --- ticket (canvas sprite, top-left under the HUD) ---
    this.ticketCanvas = document.createElement('canvas');
    this.ticketCanvas.width = 200;
    this.ticketCanvas.height = 264;
    this.ticketTex = new THREE.CanvasTexture(this.ticketCanvas);
    this.ownedTexs.push(this.ticketTex);
    this.ticketMat = new THREE.SpriteMaterial({ map: this.ticketTex, transparent: true, depthWrite: false });
    this.ownedMats.push(this.ticketMat);
    this.ticketSprite = new THREE.Sprite(this.ticketMat);
    this.ticketSprite.scale.set(1.7, 2.24, 1);
    this.ticketSprite.position.set(-this.halfW + 1.15, this.halfH - 2.6, 0.5);
    scene.add(this.ticketSprite);

    // --- Gooby + plate (slide together, carrotCatch convention) ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.72);
    this.gooby.group.position.set(0, -this.halfH + 0.95, -1.3); // peeks over the counter
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    this.plate = new THREE.Group();
    const plateMesh = own(new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.7, 0.09, 24),
      new THREE.MeshStandardMaterial({ color: '#FBFBF6', roughness: 0.4 })
    ));
    this.plate.add(plateMesh);
    this.plate.position.set(0, this.plateY, 0.1);
    scene.add(this.plate);
    this.plateX = 0;
    this.targetX = 0;

    // --- bun master (procedural): squashed dome + sesame flecks color ---
    this.bunMat = new THREE.MeshStandardMaterial({ color: '#E8A857', roughness: 0.7 });
    this.bunGeo = new THREE.SphereGeometry(0.34, 18, 12);
    this.ownedMats.push(this.bunMat);
    this.ownedGeos.push(this.bunGeo);

    // --- falling items (pooled per id) + stack state ---
    /** @type {Array<{holder: THREE.Group, id: string, active: boolean, spin: number}>} */
    this.items = [];
    /** @type {Map<string, THREE.Group[]>} */
    this.pool = new Map();
    /** @type {THREE.Object3D[]} meshes stacked on the plate */
    this.stackMeshes = [];
    this.ticket = makeTicket(ctx.rng);
    this.placed = 0;
    this.stackTopY = 0.05;
    this.drawTicket();

    // --- input: drag horizontally (§C1.2) ---
    this.offDrag = ctx.input.on('drag', (p) => {
      if (this.autoplay || this.phase === 'ending' || this.phase === 'done') return;
      this.targetX = THREE.MathUtils.clamp(p.nx * this.halfW, -this.boundX, this.boundX);
    });
    this.offStart = ctx.input.on('dragstart', (p) => {
      if (this.autoplay || this.phase === 'ending' || this.phase === 'done') return;
      this.targetX = THREE.MathUtils.clamp(p.nx * this.halfW, -this.boundX, this.boundX);
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(BURGER.DURATION_SEC);
  },

  /** Redraw the order ticket: chips bottom-to-top, ✓ done, ▶ next needed. */
  drawTicket() {
    const g = this.ticketCanvas.getContext('2d');
    const W = 200, H = 264;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,252,244,0.96)';
    g.strokeStyle = '#D64545';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(4, 4, W - 8, H - 8, 14);
    g.fill();
    g.stroke();
    g.fillStyle = '#4A3B36';
    g.font = '900 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(t('mg.burger.order'), W / 2, 34);
    const rows = this.ticket.length;
    const rowH = Math.min(28, (H - 64) / rows);
    for (let i = 0; i < rows; i += 1) {
      const y = H - 22 - i * rowH; // bottom-to-top
      const id = this.ticket[i];
      g.fillStyle = LAYER_COLORS[id];
      g.strokeStyle = 'rgba(74,59,54,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(46, y - rowH + 6, 108, rowH - 8, 8);
      g.fill();
      g.stroke();
      g.fillStyle = '#4A3B36';
      g.font = '700 15px system-ui, sans-serif';
      g.fillText(t(`mg.burger.ing.${id}`), 100, y - rowH / 2 + 4);
      if (i < this.placed) {
        g.font = '900 18px system-ui, sans-serif';
        g.fillStyle = '#2E8B57';
        g.fillText('✓', 28, y - rowH / 2 + 5);
      } else if (i === this.placed) {
        g.font = '900 18px system-ui, sans-serif';
        g.fillStyle = '#D64545';
        g.fillText('▶', 28, y - rowH / 2 + 5);
      }
    }
    this.ticketTex.needsUpdate = true;
  },

  /** Take (or build) a falling-item holder for a layer id. */
  takeItem(id) {
    const free = this.pool.get(id);
    if (free && free.length > 0) return free.pop();
    if (id === 'bun') {
      const mesh = new THREE.Mesh(this.bunGeo, this.bunMat);
      mesh.scale.set(1, 0.62, 1);
      const holder = new THREE.Group();
      holder.add(mesh);
      return holder;
    }
    return fitModel(this.ctx.assets.getModel(MODEL_KEYS[id]), ITEM_SIZE);
  },

  spawnItem(elapsed) {
    const { rng } = this.ctx;
    const needed = this.phase === 'play' ? nextNeeded(this.ticket, this.placed) : null;
    const id = rollSpawn(rng, needed, this.sinceNeeded);
    if (id === needed) this.sinceNeeded = 0;
    const holder = this.takeItem(id);
    const col = Math.min(2, Math.floor(rng() * 3));
    holder.position.set(this.colX[col], this.halfH + 0.7, 0);
    holder.rotation.set(0, rng() * Math.PI * 2, 0);
    holder.visible = true;
    this.ctx.scene.add(holder);
    this.items.push({ holder, id, active: true, spin: (rng() - 0.5) * 2.2 });
  },

  despawnItem(item) {
    item.active = false;
    item.holder.visible = false;
    this.ctx.scene.remove(item.holder);
    if (!this.pool.has(item.id)) this.pool.set(item.id, []);
    this.pool.get(item.id).push(item.holder);
  },

  /**
   * Apply floored points and forward the real delta to the framework HUD.
   * @param {boolean} correct next-needed catch?
   */
  addCatchPoints(correct) {
    const next = applyCatch(this.score, correct);
    const delta = next - this.score;
    this.score = next;
    if (delta !== 0) this.ctx.onScore(delta);
  },

  catchItem(item) {
    const pos = item.holder.position.clone();
    const needed = nextNeeded(this.ticket, this.placed);
    this.despawnItem(item);
    if (item.id === needed) {
      this.addCatchPoints(true);
      this.floats.spawn(`+${BURGER.CATCH_PTS}`, pos, '#2E8B57');
      this.ctx.audio.play('catch.good');
      this.stackLayer(item.id);
      this.placed += 1;
      if (isComplete(this.ticket, this.placed)) this.completeBurger();
      else this.drawTicket();
    } else {
      this.addCatchPoints(false);
      this.floats.spawn(t('mg.burger.wrong'), pos, '#D64570');
      this.ctx.audio.play('catch.bad');
      this.particles.emit('crumbs', this.plate.position.clone().add(new THREE.Vector3(0, 0.4, 0)), { count: 6 });
    }
  },

  /** Snap a caught layer onto the plate stack with a squish (§C1.2). */
  stackLayer(id) {
    const h = LAYER_HEIGHT[id];
    let mesh;
    if (id === 'bun') {
      mesh = new THREE.Mesh(this.bunGeo, this.bunMat);
      const top = this.placed > 0; // crown bun — dome up; base bun — flat
      mesh.scale.set(1.15, top ? 0.72 : 0.5, 1.15);
    } else {
      mesh = fitModel(this.ctx.assets.getModel(MODEL_KEYS[id]), 0.68);
      // Squash volumetric models (whole onion, salad bowl) into slice-like
      // burger layers — falling items stay volumetric so they read clearly.
      const box = new THREE.Box3().setFromObject(mesh);
      const height = box.getSize(new THREE.Vector3()).y || 1;
      mesh.scale.y = Math.min(1, (h * 1.9) / height);
    }
    mesh.position.set(0, this.stackTopY + h / 2 + 0.04, 0);
    this.stackTopY += h;
    this.plate.add(mesh);
    this.stackMeshes.push(mesh);
    const target = mesh.scale.clone();
    tween({
      from: 1.35, to: 1, duration: 0.22, ease: easings.easeOutBack,
      onUpdate: (v) => mesh.scale.set(target.x * v, target.y * (2 - v), target.z * v),
    });
  },

  /** Completed burger: +15, comical bite, then a new ticket (§C1.2). */
  completeBurger() {
    this.completed += 1;
    this.score += BURGER.COMPLETE_PTS;
    this.ctx.onScore(BURGER.COMPLETE_PTS);
    this.ctx.hud.banner(t('mg.burger.complete'));
    this.ctx.audio.play('combo.up');
    this.phase = 'bite';
    this.biteT = BURGER.BITE_SEC;
    this.gooby.setEmotion('ecstatic');
    this.gooby.play('eat');
    this.ctx.audio.play('eat.chomp');
    this.particles.emit('crumbs', this.plate.position.clone().add(new THREE.Vector3(0, this.stackTopY, 0)), { count: 8 });
    this.particles.emit('hearts', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)), { count: 4 });
  },

  /** After the bite: clear the plate and pull the next seeded ticket. */
  newTicket() {
    for (const mesh of this.stackMeshes) this.plate.remove(mesh);
    this.stackMeshes = [];
    this.stackTopY = 0.05;
    this.ticket = makeTicket(this.ctx.rng);
    this.placed = 0;
    this.drawTicket();
    this.gooby.setEmotion('happy');
    this.ctx.hud.banner(t('mg.burger.newOrder'));
    if (this.completed === 1) this.ctx.hud.banner(t('mg.burger.speedUp'));
  },

  /** Dev-only autoplay (§C1.2): chase the nearest next-needed column. */
  autoplayTick(dt) {
    this.autoT -= dt;
    if (this.autoT > 0) return;
    const { rng } = this.ctx;
    this.autoT = BURGER.AUTOPLAY_TICK_SEC;
    if (rng() < BURGER.AUTOPLAY_DISTRACT) {
      this.autoT = 0.7 + rng() * 1.0; // distraction — stop tracking for a bit
      return;
    }
    const needed = nextNeeded(this.ticket, this.placed);
    let best = null;
    for (const item of this.items) {
      if (!item.active || item.id !== needed) continue;
      const y = item.holder.position.y;
      if (y > this.plateY + 0.15 && (best == null || y < best.holder.position.y)) best = item;
    }
    let target = best ? best.holder.position.x : this.plateX;
    // Rare sloppy chase of a non-needed item (wrong catches happen to bots too).
    if (!best && rng() < 0.08) {
      const any = this.items.find((i) => i.active && i.holder.position.y > this.plateY + 0.4);
      if (any) target = any.holder.position.x;
    }
    this.autoTargetX = THREE.MathUtils.clamp(target + (rng() - 0.5) * 0.5, -this.boundX, this.boundX);
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
        if (this.autoplay) {
          console.log(`[burgerBuild] autoplay run ended — score ${this.score} (burgers ${this.completed})`);
        }
        ctx.onEnd({ score: this.score });
      }
      return;
    }

    const remaining = BURGER.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);

    if (this.phase === 'bite') {
      this.biteT -= dt;
      if (this.biteT <= 0) {
        this.phase = 'play';
        this.newTicket();
      }
    } else {
      this.sinceNeeded += dt;
    }

    if (this.autoplay) {
      this.autoplayTick(dt);
      this.targetX = this.autoTargetX;
    }

    // plate + Gooby follow the drag target
    this.plateX += (this.targetX - this.plateX) * Math.min(1, dt * 10);
    this.plate.position.x = this.plateX;
    this.gooby.group.position.x += (this.plateX - this.gooby.group.position.x) * Math.min(1, dt * 7);
    this.gooby.lookAt(new THREE.Vector3(this.plateX, this.plateY + 2.2, 0.5));

    // spawn cadence
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnItem(elapsed);
      this.spawnT = BURGER.SPAWN_SEC;
    }

    // falling items: §C1.2 +8%-per-burger ramp; catch at the plate band
    const speed = fallSpeedAt(this.completed);
    const catchY = this.plateY + this.stackTopY + 0.12;
    for (const item of this.items) {
      if (!item.active) continue;
      const h = item.holder;
      const prevY = h.position.y;
      h.position.y -= speed * dt;
      h.rotation.y += item.spin * dt;
      if (
        this.phase === 'play' &&
        prevY > catchY &&
        h.position.y <= catchY &&
        Math.abs(h.position.x - this.plateX) <= PLATE_HALF_WIDTH
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
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    // GLB clones share cached geometries/materials — framework sweep handles GPU frees.
    this.items = [];
    this.pool = null;
    this.stackMeshes = [];
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.plate = null;
    this.ticketSprite = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
