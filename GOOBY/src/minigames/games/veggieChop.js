// Veggie Chop (PLAN2 §C1.2 #4, agent V2/G27): fruit-ninja-style swipe
// slicer in a kitchen cutting-board arena (§C1.3 — giant wooden board,
// pastel tile backsplash, counter props; NOT burgerBuild's diner checker).
// Veggies/fruits are lobbed up in arcs (1–3 at once, ramping); swipe through
// them to chop — each whole splits into its two food-kit half models with a
// juice splash (+2, +1 per extra in the same swipe). Soda cans and the boot
// are junk: chopping them costs −3 and a 0.5 s splash stun. 3 veggies fallen
// unchopped end the round early; otherwise 60 s. Swipe trail rendered as a
// fading ribbon. Pure arc/scoring logic in veggieChop.logic.js (§B rule).
// Dev-only ?autoplay=1: the bot synthesizes a swipe through each veggie at
// its arc apex and ignores junk (§C1.2), with a human-ish skip/aim error.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { clampFloatTextToView } from '../framework.js';
import {
  CHOP,
  VEGGIES,
  waveSizeAt,
  spawnIntervalAt,
  rollItem,
  makeArc,
  arcPos,
  arcApex,
  chopPoints,
  applyPoints,
  segmentHitsCircle,
} from './veggieChop.logic.js';

const ITEM_SIZE = 0.62;
const HALF_SIZE = 0.5;
/** Swipe trail: max points kept / seconds a point stays visible. */
const TRAIL_MAX = 22;
const TRAIL_LIFE = 0.22;
const TRAIL_WIDTH = 0.15;

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

/** Tiny floating score text (canvas sprites, self-disposing). */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#4A3B36') {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 42px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.92)';
      g.strokeText(text, 100, 40);
      g.fillStyle = color;
      g.fillText(text, 100, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.65, halfH: 0.26 }));
      sprite.scale.set(1.3, 0.52, 1);
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

/** Pastel kitchen tile backsplash as a CanvasTexture (§C1.3 look). */
function makeTileTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  const tiles = ['#DCEFEA', '#E8F3EE', '#D5EAE6', '#E3F0E4'];
  const size = 64;
  for (let ty = 0; ty < 4; ty += 1) {
    for (let tx = 0; tx < 4; tx += 1) {
      g.fillStyle = tiles[(tx + ty * 3) % tiles.length];
      g.fillRect(tx * size, ty * size, size, size);
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 5;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath();
    g.moveTo(i * size, 0);
    g.lineTo(i * size, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * size);
    g.lineTo(256, i * size);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

/** Pooled juice-splash droplets (sprite dots tinted per veggie). */
function createJuice(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  /** @type {Array<{sprite: THREE.Sprite, mat: THREE.SpriteMaterial, vel: THREE.Vector3, age: number, life: number, size: number, active: boolean}>} */
  const pool = [];
  for (let i = 0; i < 42; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    pool.push({ sprite, mat, vel: new THREE.Vector3(), age: 0, life: 0.5, size: 0.1, active: false });
  }
  return {
    emit(pos, colorHex, count = 7, rng = Math.random) {
      let n = 0;
      for (const p of pool) {
        if (n >= count) break;
        if (p.active) continue;
        p.active = true;
        p.age = 0;
        p.life = 0.35 + rng() * 0.3;
        p.size = 0.07 + rng() * 0.09;
        const a = rng() * Math.PI * 2;
        const v = 1.2 + rng() * 1.8;
        p.vel.set(Math.cos(a) * v, Math.abs(Math.sin(a)) * v * 0.9 + 0.6, 0);
        p.sprite.position.copy(pos);
        p.sprite.visible = true;
        p.mat.color.set(colorHex);
        p.mat.opacity = 1;
        n += 1;
      }
    },
    update(dt) {
      for (const p of pool) {
        if (!p.active) continue;
        p.age += dt;
        p.vel.y -= 7 * dt;
        p.sprite.position.addScaledVector(p.vel, dt);
        const k = p.age / p.life;
        p.mat.opacity = 1 - k * k;
        p.sprite.scale.setScalar(p.size * (1 - k * 0.4));
        if (p.age >= p.life) {
          p.active = false;
          p.sprite.visible = false;
        }
      }
    },
    dispose() {
      for (const p of pool) {
        p.sprite.parent?.remove(p.sprite);
        p.mat.dispose();
      }
      tex.dispose();
      pool.length = 0;
    },
  };
}

/** @type {object} §E8 plugin */
export default {
  id: 'veggieChop',
  assetKeys: [
    ...VEGGIES.map((v) => `food-kit/${v.key}`),
    ...VEGGIES.map((v) => `food-kit/${v.half}`),
    'food-kit/soda',
    'food-kit/cutting-board',
    'food-kit/frying-pan',
    'food-kit/mug',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.score = 0;
    this.misses = 0;
    this.stunT = 0;
    this.endT = 0;
    this.spawnT = 0.7; // head start before the first lob
    this.swipeChops = 0; // veggies chopped by the CURRENT swipe (combo)
    this.itemSeq = 0;

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);
    this.launchY = -this.halfH - 0.6;

    const scene = ctx.scene;
    scene.background = new THREE.Color('#F6E7CF'); // warm kitchen cream

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

    scene.add(new THREE.HemisphereLight(0xfff6e8, 0xd9c2a8, 1.15));
    const dir = new THREE.DirectionalLight(0xfff0da, 0.9);
    dir.position.set(2.5, 6, 5);
    scene.add(dir);

    // --- kitchen backdrop: tile backsplash strip + counter + giant board ---
    const tileTex = makeTileTexture();
    this.ownedTexs.push(tileTex);
    const splash = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 2, 3.4),
      new THREE.MeshBasicMaterial({ map: tileTex })
    ));
    splash.position.set(0, this.halfH - 1.2, -3);
    scene.add(splash);
    const counter = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 2, 2.6),
      new THREE.MeshBasicMaterial({ color: '#C98A4B' })
    ));
    counter.position.set(0, -this.halfH + 0.9, -2.6);
    scene.add(counter);
    // the arena: a giant cutting board facing the camera (§C1.3)
    const board = fitModel(ctx.assets.getModel('food-kit/cutting-board'), 5.6);
    board.rotation.x = Math.PI / 2;
    board.position.set(0, -0.7, -1.6);
    scene.add(board);
    // counter props: frying pan + mug tucked into the corners
    const pan = fitModel(ctx.assets.getModel('food-kit/frying-pan'), 1.15);
    pan.position.set(-this.halfW + 0.75, -this.halfH + 0.75, -1.2);
    scene.add(pan);
    const mug = fitModel(ctx.assets.getModel('food-kit/mug'), 0.6);
    mug.position.set(this.halfW - 0.55, -this.halfH + 1.6, -1.4);
    scene.add(mug);

    // --- miss pips: 3 little tomatoes, greyed as veggies drop (§C1.2) ---
    /** @type {THREE.MeshBasicMaterial[]} */
    this.missMats = [];
    for (let i = 0; i < CHOP.MAX_MISSES; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ color: '#E8523F' });
      const pip = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), mat);
      pip.position.set(-0.45 + i * 0.45, this.halfH - 1.75, -0.5);
      this.ownedGeos.push(pip.geometry);
      this.ownedMats.push(mat);
      this.missMats.push(mat);
      scene.add(pip);
    }

    // --- chef Gooby watching from the counter corner ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);
    this.juice = createJuice(scene);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.62);
    this.gooby.group.position.set(this.halfW - 0.85, -this.halfH + 0.55, 0.4);
    this.gooby.setEmotion('happy');
    this.gooby.lookAt(new THREE.Vector3(0, 0.5, 5));
    scene.add(this.gooby.group);

    // --- swipe trail ribbon (§C1.2: trail rendered) ---
    /** @type {Array<{x: number, y: number, age: number}>} */
    this.trail = [];
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3)
    );
    this.trailGeo.setIndex(new THREE.BufferAttribute(new Uint16Array((TRAIL_MAX - 1) * 6), 1));
    this.trailMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ownedGeos.push(this.trailGeo);
    this.ownedMats.push(this.trailMat);
    this.trailMesh = new THREE.Mesh(this.trailGeo, this.trailMat);
    this.trailMesh.renderOrder = 5;
    this.trailMesh.frustumCulled = false;
    scene.add(this.trailMesh);

    // --- flying items (pooled per asset key) + loose halves ---
    /** @type {Array<object>} */
    this.items = [];
    /** @type {Array<object>} */
    this.halves = [];
    /** @type {Map<string, THREE.Group[]>} */
    this.pool = new Map();
    this.bootMat = new THREE.MeshStandardMaterial({ color: 0x3d2c22, roughness: 0.85 });
    this.ownedMats.push(this.bootMat);

    // --- input: drag = swipe; each dragstart begins a new combo window ---
    this.lastDrag = null;
    this.offStart = ctx.input.on('dragstart', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      this.swipeChops = 0;
      this.lastDrag = { x: p.nx * this.halfW, y: p.ny * this.halfH };
    });
    this.offDrag = ctx.input.on('drag', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      const pt = { x: p.nx * this.halfW, y: p.ny * this.halfH };
      if (this.lastDrag && this.stunT <= 0) {
        this.chopSegment(this.lastDrag.x, this.lastDrag.y, pt.x, pt.y);
        this.pushTrail(pt.x, pt.y);
      }
      this.lastDrag = pt;
    });
    this.offEnd = ctx.input.on('dragend', () => {
      this.lastDrag = null;
      this.swipeChops = 0;
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(CHOP.DURATION_SEC);
  },

  /** Take (or build) a model holder for an item key. */
  takeModel(key) {
    const free = this.pool.get(key);
    if (free && free.length > 0) return free.pop();
    if (key === 'boot') {
      // procedural junk boot (same recipe family as fishingPond's)
      const holder = new THREE.Group();
      const shaftGeo = new THREE.BoxGeometry(0.26, 0.44, 0.18);
      const footGeo = new THREE.BoxGeometry(0.44, 0.2, 0.18);
      this.ownedGeos.push(shaftGeo, footGeo);
      const shaft = new THREE.Mesh(shaftGeo, this.bootMat);
      shaft.position.set(-0.07, 0.13, 0);
      const foot = new THREE.Mesh(footGeo, this.bootMat);
      foot.position.set(0.08, -0.16, 0);
      holder.add(shaft, foot);
      return holder;
    }
    const size = key.endsWith('-half') || key.endsWith('-slice') ? HALF_SIZE : ITEM_SIZE;
    return fitModel(this.ctx.assets.getModel(`food-kit/${key}`), size);
  },

  returnModel(key, holder) {
    holder.visible = false;
    this.ctx.scene.remove(holder);
    if (!this.pool.has(key)) this.pool.set(key, []);
    this.pool.get(key).push(holder);
  },

  /** Lob a wave of 1–3 items (§C1.2), planning the bot swipes at apex. */
  spawnWave(elapsed) {
    const { rng } = this.ctx;
    const size = waveSizeAt(rng, elapsed);
    for (let i = 0; i < size; i += 1) {
      const roll = rollItem(rng, elapsed);
      const arc = makeArc(rng, this.halfW, this.launchY);
      const holder = this.takeModel(roll.key);
      holder.position.set(arc.x0, arc.y0, 0);
      holder.visible = true;
      this.ctx.scene.add(holder);
      const apex = arcApex(arc);
      const item = {
        id: (this.itemSeq += 1),
        kind: roll.kind,
        key: roll.key,
        half: roll.half,
        juice: roll.juice,
        arc,
        t: -i * 0.14, // stagger the wave slightly
        holder,
        spinX: (rng() - 0.5) * 3.2,
        spinZ: (rng() - 0.5) * 2.2,
        active: true,
        // dev bot plan (§C1.2: swipe at apex, ignore junk; human-ish skips)
        botAt: roll.kind === 'veggie' && rng() < CHOP.AUTOPLAY_CHOP_RATE
          ? apex.t + (rng() - 0.5) * 0.12
          : -1,
      };
      this.items.push(item);
    }
    this.ctx.audio.play('chop.lob');
  },

  /** Add a point to the swipe-trail ribbon. */
  pushTrail(x, y) {
    this.trail.push({ x, y, age: 0 });
    if (this.trail.length > TRAIL_MAX) this.trail.shift();
  },

  /** Rebuild the trail ribbon mesh from the aged point list. */
  updateTrail(dt) {
    for (const p of this.trail) p.age += dt;
    while (this.trail.length > 0 && this.trail[0].age > TRAIL_LIFE) this.trail.shift();
    const pts = this.trail;
    const pos = this.trailGeo.attributes.position;
    const index = this.trailGeo.index;
    if (pts.length < 2) {
      this.trailGeo.setDrawRange(0, 0);
      return;
    }
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let dx = q.x - o.x;
      let dy = q.y - o.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const w = TRAIL_WIDTH * (1 - p.age / TRAIL_LIFE) * (0.35 + 0.65 * (i / pts.length));
      pos.setXYZ(i * 2, p.x - dy * w, p.y + dx * w, 0.5);
      pos.setXYZ(i * 2 + 1, p.x + dy * w, p.y - dx * w, 0.5);
    }
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = i * 2;
      index.setX(i * 6, a);
      index.setX(i * 6 + 1, a + 1);
      index.setX(i * 6 + 2, a + 2);
      index.setX(i * 6 + 3, a + 1);
      index.setX(i * 6 + 4, a + 3);
      index.setX(i * 6 + 5, a + 2);
    }
    pos.needsUpdate = true;
    index.needsUpdate = true;
    this.trailGeo.setDrawRange(0, (pts.length - 1) * 6);
  },

  /** Test one swipe segment against every airborne item (§C1.2 chop). */
  chopSegment(ax, ay, bx, by) {
    for (const item of this.items) {
      if (!item.active || item.t < 0) continue;
      const p = item.holder.position;
      if (!segmentHitsCircle(ax, ay, bx, by, p.x, p.y, CHOP.HIT_RADIUS)) continue;
      if (item.kind === 'veggie') this.chopVeggie(item);
      else this.chopJunk(item);
    }
  },

  /** A clean chop: split into the two half models + juice, score the combo. */
  chopVeggie(item) {
    const pos = item.holder.position.clone();
    item.active = false;
    this.returnModel(item.key, item.holder);
    this.swipeChops += 1;
    const pts = chopPoints(this.swipeChops);
    this.score = applyPoints(this.score, pts);
    this.ctx.onScore(pts);
    this.ctx.audio.play('chop.slice');
    this.juice.emit(pos, item.juice, 8, this.ctx.rng);
    this.floats.spawn(`+${pts}`, pos, this.swipeChops > 1 ? '#D6428A' : '#2E8B57');
    if (this.swipeChops === 2) {
      this.ctx.audio.play('chop.combo');
      this.ctx.hud.banner(t('mg.chop.combo'));
      this.gooby.play('happyBounce');
    }
    // the two halves tumble apart under gravity
    const { rng } = this.ctx;
    for (const side of [-1, 1]) {
      const holder = this.takeModel(item.half);
      holder.position.copy(pos);
      holder.visible = true;
      this.ctx.scene.add(holder);
      this.halves.push({
        key: item.half,
        holder,
        vx: item.arc.vx * 0.4 + side * (1.1 + rng() * 0.7),
        vy: 1.6 + rng() * 1.2,
        spin: side * (3 + rng() * 3),
        age: 0,
      });
    }
  },

  /** Chopped junk (§C1.2): −3, splash stun 0.5 s, grumpy Gooby. */
  chopJunk(item) {
    const pos = item.holder.position.clone();
    item.active = false;
    this.returnModel(item.key, item.holder);
    this.score = applyPoints(this.score, CHOP.JUNK_PTS);
    this.ctx.onScore(CHOP.JUNK_PTS);
    this.ctx.hud.setScore(this.score);
    this.stunT = CHOP.STUN_SEC;
    this.trail.length = 0;
    this.lastDrag = null;
    this.ctx.audio.play('chop.junk');
    this.juice.emit(pos, '#8A7A5C', 10, this.ctx.rng);
    this.particles.emit('dizzyStars', pos);
    this.floats.spawn(`${CHOP.JUNK_PTS}`, pos, '#D64570');
    this.ctx.hud.banner(t('mg.chop.junk'));
    this.gooby.setEmotion('dizzy');
    this.gooby.play('dizzy', { speed: 2.0 / CHOP.STUN_SEC });
    this.emotionT = 0.9;
  },

  /** A veggie fell unchopped: miss pip out, 3 misses end early (§C1.2). */
  missVeggie(item) {
    item.active = false;
    this.returnModel(item.key, item.holder);
    this.misses += 1;
    this.ctx.audio.play('chop.miss');
    if (this.missMats[this.misses - 1]) this.missMats[this.misses - 1].color.set('#B9A88F');
    this.gooby.setEmotion('sad');
    this.emotionT = 0.8;
    if (this.misses >= CHOP.MAX_MISSES) {
      this.ctx.hud.banner(t('mg.chop.over'));
      this.endRound();
    } else {
      this.ctx.hud.banner(t('mg.chop.miss', { n: CHOP.MAX_MISSES - this.misses }));
    }
  },

  endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'ending';
    this.endT = 0;
    this.ctx.audio.play('ui.win');
    this.gooby.setEmotion(this.score >= 50 ? 'ecstatic' : 'happy');
    this.gooby.play('happyBounce');
    this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 14 });
    if (this.autoplay) console.log(`[veggieChop] autoplay run ended — score ${this.score} (misses ${this.misses})`);
  },

  /** Dev bot: synthesize an apex swipe through a veggie (§C1.2). */
  botSwipe(item) {
    if (this.stunT > 0) return; // splashed — sits the swipe out
    const { rng } = this.ctx;
    const p = item.holder.position;
    const err = (rng() - 0.5) * 2 * CHOP.AUTOPLAY_AIM_ERR;
    const ax = p.x - 0.55 + err;
    const bx = p.x + 0.55 + err;
    const ay = p.y - 0.4 + err * 0.5;
    const by = p.y + 0.42 + err * 0.5;
    this.swipeChops = 0; // each synthetic swipe is its own combo window
    // draw the bot's stroke so autoplay footage shows the trail
    for (let i = 0; i <= 6; i += 1) {
      const k = i / 6;
      this.pushTrail(ax + (bx - ax) * k, ay + (by - ay) * k);
    }
    this.chopSegment(ax, ay, bx, by);
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);
    this.juice.update(dt);
    this.updateTrail(dt);

    if (this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.gooby.setEmotion('happy');
    }

    // loose halves tumble off under gravity
    for (const h of this.halves) {
      h.age += dt;
      h.vy -= CHOP.GRAVITY * 0.8 * dt;
      h.holder.position.x += h.vx * dt;
      h.holder.position.y += h.vy * dt;
      h.holder.rotation.z += h.spin * dt;
      if (h.holder.position.y < this.launchY - 0.6) {
        this.returnModel(h.key, h.holder);
        h.done = true;
      }
    }
    this.halves = this.halves.filter((h) => !h.done);

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: this.score });
      }
      return;
    }
    if (this.phase !== 'play') return;

    const remaining = CHOP.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);
    if (this.stunT > 0) this.stunT -= dt;

    // wave cadence (§C1.2: arcs of 1–3, ramping)
    this.spawnT -= dt;
    if (this.spawnT <= 0 && remaining > 1.2) {
      this.spawnWave(elapsed);
      this.spawnT = spawnIntervalAt(elapsed);
    }

    // flying items along their arcs
    for (const item of this.items) {
      if (!item.active) continue;
      item.t += dt;
      if (item.t < 0) continue; // wave stagger
      const p = arcPos(item.arc, item.t);
      item.holder.position.set(p.x, p.y, 0);
      item.holder.rotation.x += item.spinX * dt;
      item.holder.rotation.z += item.spinZ * dt;
      if (this.autoplay && item.botAt >= 0 && item.t >= item.botAt) {
        item.botAt = -1;
        this.botSwipe(item);
        if (!item.active) continue;
      }
      // fell past the launch line on the way down
      if (item.t > item.arc.vy / CHOP.GRAVITY && p.y < this.launchY - 0.3) {
        if (item.kind === 'veggie') {
          this.missVeggie(item);
          if (this.phase !== 'play') break;
        } else {
          item.active = false;
          this.returnModel(item.key, item.holder);
        }
      }
    }
    this.items = this.items.filter((i) => i.active);

    if (remaining <= 0) this.endRound();
  },

  dispose() {
    this.offStart?.();
    this.offDrag?.();
    this.offEnd?.();
    this.floats?.dispose();
    this.juice?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    // GLB clones share cached geometries/materials — the framework scene
    // sweep handles GPU frees; drop references only.
    this.items = [];
    this.halves = [];
    this.pool = null;
    this.trail = [];
    this.trailGeo = null;
    this.trailMat = null;
    this.trailMesh = null;
    this.missMats = [];
    this.bootMat = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.juice = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
