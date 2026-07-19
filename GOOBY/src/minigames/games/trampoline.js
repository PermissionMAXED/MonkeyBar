// Trampoline Tricks (§C6.1 #12, agent G10): side view — Gooby bounces on a
// procedural trampoline (frame + legs + elastic mat with visible sag). Tap
// inside the shrinking landing window (a visual ring that shrinks as height
// grows) at the right moment = boost; swipe left/right/up mid-air = flip /
// spin / twist tricks (+pts × height multiplier ×1–3); missed window = cute
// butt-landing (dizzy stars), height resets. 60 s; score = trick points.
// Uses the rig's jump/dizzy clips + programmatic spin poses on a wrapper
// group. Pure rules live in trampoline.logic.js (§B rule).
//
// Dev-only ?autoplay=1: a bot with gaussian tap error (so the shrinking
// window naturally punishes high bounces) plays for headless verification.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  TRAMP,
  windowSecFor,
  heightMultiplier,
  apexFor,
  airTimeFor,
  timeToImpact,
  classifyLandingTap,
  nextBounceVy,
  trickPoints,
  canTrick,
  createTrickChain,
  recordTrick,
  consumeLandingAction,
  crossedMat,
} from './trampoline.logic.js';

const MAT_Y = -2.5;
const MAT_R = 0.95;

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
      canvas.width = 256;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.92)';
      g.strokeText(text, 128, 40);
      g.fillStyle = color;
      g.fillText(text, 128, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      // F4 P2-3: high-apex trick popups must not clip past the top edge
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.8, halfH: 0.25 }));
      sprite.scale.set(1.6, 0.5, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.9 });
    },
    update(dt) {
      for (const f of active) {
        f.age += dt;
        f.sprite.position.y += dt * 1.15;
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
  id: 'trampoline',
  assetKeys: [
    'nature-kit/fence_simple',
    'nature-kit/tree_oak',
    'nature-kit/flower_yellowA',
    'nature-kit/flower_redA',
    'nature-kit/plant_bush',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.score = 0;
    // V2/G27: successful-trick counter → onEnd meta.tricks (§B3; the G23
    // framework block forwards it as 'tricks:trampoline' → quest q.tricks5).
    this.tricksDone = 0;
    this.endT = 0;
    // bounce state
    this.h = 0; //          height above the mat (wu)
    this.vy = 0;
    this.launchVy = TRAMP.BASE_VY;
    this.airborne = false;
    this.armed = null; //   'boost' | 'butt' — first judged tap of this air
    this.tricking = false;
    this.airTrickChain = createTrickChain();
    this.trickTween = null;
    this.staggerT = 0.4; // small settle before the first launch
    this.sag = 0;
    this.sagVel = 0;
    this.emotionT = 0;

    const camera = ctx.camera;
    camera.position.set(0, 0.8, 10);
    camera.lookAt(0, -0.2, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#BFE6F7');

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0xc8e6b8, 1.1));
    const dir = new THREE.DirectionalLight(0xfff2dd, 0.9);
    dir.position.set(-3, 6, 5);
    scene.add(dir);

    // --- backyard backdrop: sun, grass, fence, tree, flowers ---
    const sun = own(new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd166 })
    ));
    sun.position.set(this.halfW - 1.0, this.halfH - 0.9, -4);
    scene.add(sun);
    const grass = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 2, 1.8),
      new THREE.MeshBasicMaterial({ color: 0x8fce7a })
    ));
    grass.position.set(0, -this.halfH + 0.7, -1.5);
    scene.add(grass);
    for (let i = -1; i <= 1; i += 1) {
      const fence = fitModel(ctx.assets.getModel('nature-kit/fence_simple'), 1.5);
      fence.position.set(i * 1.5, -this.halfH + 1.35, -2.2);
      scene.add(fence);
    }
    const tree = fitModel(ctx.assets.getModel('nature-kit/tree_oak'), 2.6);
    tree.position.set(-this.halfW + 0.7, -this.halfH + 2.1, -2.6);
    scene.add(tree);
    for (const [key, x, s] of [
      ['nature-kit/flower_yellowA', -1.15, 0.4],
      ['nature-kit/flower_redA', 1.35, 0.4],
      ['nature-kit/plant_bush', 1.62, 0.55],
    ]) {
      const deco = fitModel(ctx.assets.getModel(key), s);
      deco.position.set(x, -this.halfH + 0.62, 0.4);
      scene.add(deco);
    }

    // --- trampoline: 4 legs + steel frame ring + deformable mat disc ---
    const legGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.0, 8);
    this.ownedGeos.push(legGeo);
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a5578, roughness: 0.45, metalness: 0.35 });
    this.ownedMats.push(steelMat);
    for (const [lx, lz] of [[-0.78, 0.3], [0.78, 0.3], [-0.6, -0.5], [0.6, -0.5]]) {
      const leg = new THREE.Mesh(legGeo, steelMat);
      leg.position.set(lx, MAT_Y - 0.5, lz);
      scene.add(leg);
    }
    const frame = own(new THREE.Mesh(
      new THREE.TorusGeometry(MAT_R + 0.06, 0.055, 10, 36),
      new THREE.MeshStandardMaterial({ color: 0x3a4468, roughness: 0.4, metalness: 0.4 })
    ));
    frame.rotation.x = -Math.PI / 2;
    frame.position.y = MAT_Y;
    scene.add(frame);
    const matGeo = new THREE.CircleGeometry(MAT_R, 28);
    this.ownedGeos.push(matGeo);
    const matMat = new THREE.MeshStandardMaterial({
      color: 0x2e3550, roughness: 0.8, side: THREE.DoubleSide,
    });
    this.ownedMats.push(matMat);
    this.mat = new THREE.Mesh(matGeo, matMat);
    this.mat.rotation.x = -Math.PI / 2;
    this.mat.position.y = MAT_Y;
    scene.add(this.mat);
    this.matBase = Float32Array.from(matGeo.attributes.position.array);

    // --- landing window ring (§C6.1: shrinks as height grows) ---
    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 40);
    this.ownedGeos.push(ringGeo);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x59c9b9, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ownedMats.push(this.ringMat);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = MAT_Y + 0.03;
    scene.add(this.ring);

    // --- Gooby on a trick wrapper (rotation pivot at his belly) ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.position.set(0, -0.52, 0);
    this.trickGrp = new THREE.Group();
    this.trickGrp.add(this.gooby.group);
    this.trickGrp.position.set(0, MAT_Y + 0.52, 0.3);
    this.gooby.setEmotion('happy');
    scene.add(this.trickGrp);

    // --- input: raw pointerdown for the timing tap (rhythm-accurate —
    // precedent: city/carController.js), ctx.input swipes for tricks ---
    this.onPointerDown = () => {
      if (this.phase !== 'play' || this.autoplay) return;
      this.landingTap();
    };
    ctx.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.offSwipe = ctx.input.on('swipe', (p) => {
      if (this.phase !== 'play' || this.autoplay) return;
      const kind = p.dir === 'left' ? 'flip' : p.dir === 'right' ? 'spin' : p.dir === 'up' ? 'twist' : null;
      if (kind) this.tryTrick(kind);
    });

    // autoplay plan for the current air
    this.bot = { tapAt: -1, tricks: [], airT: 0 };
    this.prevVy = 0;

    ctx.hud.setScore(0);
    ctx.hud.setTime(TRAMP.DURATION_SEC);
  },

  /** Judge a screen tap against the landing window (falling only). */
  landingTap() {
    if (!this.airborne || this.vy >= 0 || this.armed) return;
    const tti = timeToImpact(this.h, this.vy);
    const apexH = apexFor(this.launchVy);
    const verdict = classifyLandingTap(tti, apexH);
    if (verdict === 'ignore') return;
    this.armed = verdict === 'boost' ? 'boost' : 'butt';
    if (this.armed === 'boost') this.ctx.audio.play('tramp.armed');
  },

  /** Start a mid-air trick (§C6.1: swipe left/right/up = flip/spin/twist). */
  tryTrick(kind) {
    const tti = this.airborne ? timeToImpact(this.h, this.vy) : 0;
    if (!canTrick(this.airborne, tti, this.tricking)) return;
    const mult = heightMultiplier(apexFor(this.launchVy));
    const pts = trickPoints(kind, mult);
    this.score += pts;
    this.tricksDone += 1; // V2/G27: meta.tricks (§B3 — every landed trick counts)
    this.ctx.onScore(pts);
    const combo = recordTrick(this.airTrickChain, kind);
    if (combo.triggered) {
      this.score += combo.bonus;
      this.ctx.onScore(combo.bonus);
      this.ctx.hud.banner(t('v3.depth.tramp.combo', { n: combo.bonus }));
      this.particles.emit('confetti', this.trickGrp.position.clone().add(new THREE.Vector3(0, 0.8, 0)), { count: 16 });
    }
    this.ctx.audio.play('tramp.trick');
    const key = kind === 'flip' ? 'mg.tramp.flip' : kind === 'spin' ? 'mg.tramp.spin' : 'mg.tramp.twist';
    this.floats.spawn(
      `${t(key, { pts })}${mult > 1 ? ` ×${mult}` : ''}`,
      this.trickGrp.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
      mult >= 3 ? '#D6428A' : mult === 2 ? '#2E8B57' : '#4A3B36'
    );
    this.tricking = true;
    const grp = this.trickGrp;
    const startZ = grp.rotation.z;
    const startY = grp.rotation.y;
    const dur = kind === 'twist' ? 0.55 : 0.45;
    this.trickTween = tween({
      from: 0, to: 1, duration: dur, ease: easings.easeInOutQuad,
      onUpdate: (v) => {
        if (kind === 'flip') grp.rotation.z = startZ + v * Math.PI * 2;
        else if (kind === 'spin') grp.rotation.z = startZ - v * Math.PI * 2;
        else grp.rotation.y = startY + v * Math.PI * 2;
      },
      onComplete: () => {
        grp.rotation.z = 0;
        grp.rotation.y = 0;
        this.tricking = false;
        this.trickTween = null;
      },
    });
    this.particles.emit('sparkles', this.trickGrp.position, { count: 5 });
  },

  /** Contact with the mat — resolve the bounce (§C6.1 rules). */
  resolveContact() {
    const consumed = consumeLandingAction(this.armed);
    const action = consumed.action;
    this.armed = consumed.armed;
    // cancel any mid-trick rotation cleanly
    if (this.trickTween) {
      this.trickTween.cancel();
      this.trickTween = null;
      this.tricking = false;
    }
    this.trickGrp.rotation.set(0, 0, 0);
    const impact = Math.abs(this.vy);
    this.sagVel -= impact * 0.9; // mat dips with the hit

    if (action === 'butt') {
      // cute butt-landing: dizzy stars, squash flat, height resets (§C6.1)
      this.airborne = false;
      this.h = 0;
      this.vy = 0;
      this.launchVy = TRAMP.BASE_VY;
      this.airTrickChain = createTrickChain();
      this.staggerT = TRAMP.BUTT_STAGGER_SEC;
      this.ctx.audio.play('tramp.butt');
      this.floats.spawn(t('mg.tramp.butt'), this.trickGrp.position.clone().add(new THREE.Vector3(0, 0.8, 0)), '#D64570');
      this.gooby.setEmotion('dizzy');
      this.gooby.play('dizzy', { speed: 2 });
      this.emotionT = TRAMP.BUTT_STAGGER_SEC;
      this.particles.emit('dizzyStars', this.trickGrp.position.clone().add(new THREE.Vector3(0, 0.7, 0)));
      this.particles.emit('crumbs', new THREE.Vector3(0, MAT_Y + 0.1, 0.5), { count: 7 });
      const grp = this.trickGrp;
      tween({
        from: 0.55, to: 1, duration: 0.5, delay: 0.4, ease: easings.easeOutElastic,
        onUpdate: (v) => grp.scale.set(2 - v, v, 1),
      });
      return;
    }

    // ground (re)launches use launchVy as-is; airborne contacts apply the rule
    const vy = this.airborne ? nextBounceVy(this.launchVy, action) : this.launchVy;
    this.launchVy = vy;
    this.vy = vy;
    this.h = 0.001;
    this.airborne = true;
    this.airTrickChain = createTrickChain();
    this.gooby.play('jump', { speed: 1.4 });
    if (action === 'boost') {
      this.ctx.audio.play('tramp.boost');
      this.floats.spawn(t('mg.tramp.boost'), new THREE.Vector3(0.7, MAT_Y + 0.9, 0.5), '#59C9B9');
      this.particles.emit('sparkles', new THREE.Vector3(0, MAT_Y + 0.25, 0.4), { count: 8 });
      const mult = heightMultiplier(apexFor(vy));
      if (mult > heightMultiplier(apexFor(this.prevVy ?? 0))) {
        this.floats.spawn(`×${mult}`, new THREE.Vector3(-0.8, MAT_Y + 1.2, 0.5), '#D6428A');
        this.ctx.audio.play('tramp.tierUp');
      }
      this.gooby.setEmotion(mult >= 3 ? 'ecstatic' : 'happy');
    } else {
      this.ctx.audio.play('tramp.bounce');
    }
    this.prevVy = vy;

    // autoplay: plan this air's tap + tricks
    if (this.autoplay) this.planAir(vy);
  },

  /** Dev autoplay: gaussian tap error → the shrinking window bites at height. */
  planAir(vy) {
    const { rng } = this.ctx;
    const airT = airTimeFor(vy);
    const apexH = apexFor(vy);
    const win = windowSecFor(apexH);
    const bot = this.bot;
    bot.airT = 0;
    bot.tricks = [];
    if (rng() < 0.85) {
      // aim at the window center with gaussian-ish error (σ ≈ 0.13 s) — the
      // shrinking window punishes height, like a typical human (§C6 ~14c)
      const err = (rng() + rng() + rng() - 1.5) * 0.26;
      bot.tapAt = airT - win / 2 + err;
    } else {
      bot.tapAt = -1; // zones out — passive decay bounce
    }
    const kinds = ['flip', 'spin', 'twist'].sort(() => rng() - 0.5);
    const chaseCombo = airT > 1.65 && rng() < 0.45;
    let at = 0.18;
    while (at < airT - TRAMP.TRICK_MIN_AIR_SEC && bot.tricks.length < 3) {
      const chance = bot.tricks.length === 0 ? 0.38 : 0.22;
      if (chaseCombo || rng() < chance) bot.tricks.push({ at, kind: kinds[bot.tricks.length] });
      at += 0.62;
    }
  },

  autoplayTick(dt) {
    const bot = this.bot;
    if (!this.airborne) return;
    bot.airT += dt;
    while (bot.tricks.length > 0 && bot.airT >= bot.tricks[0].at) {
      this.tryTrick(bot.tricks.shift().kind);
    }
    if (bot.tapAt >= 0 && bot.airT >= bot.tapAt && !this.armed) {
      this.landingTap();
      bot.tapAt = -1;
    }
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    // mat sag spring (visible elastic deformation)
    const sagAccel = -140 * this.sag - 9 * this.sagVel;
    this.sagVel += sagAccel * dt;
    this.sag = Math.max(-0.6, Math.min(0.35, this.sag + this.sagVel * dt));
    const mp = this.mat.geometry.attributes.position;
    for (let i = 0; i < mp.count; i += 1) {
      const bx = this.matBase[i * 3];
      const by = this.matBase[i * 3 + 1];
      const r = Math.hypot(bx, by) / MAT_R;
      const falloff = Math.max(0, 1 - r * r);
      mp.setZ(i, this.sag * falloff * 0.55);
    }
    mp.needsUpdate = true;

    if (this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.gooby.setEmotion('happy');
    }

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.5 && this.phase !== 'done') {
        this.phase = 'done';
        // V2/G27: forward the trick count so quest q.tricks5 is fulfillable
        // (§B3 meta — the framework's V2/G23 block does the rest).
        ctx.onEnd({ score: this.score, meta: { tricks: this.tricksDone } });
      }
      return;
    }

    const remaining = TRAMP.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);

    if (this.autoplay) this.autoplayTick(dt);

    // --- bounce physics (pause-safe, dt-driven) ---
    if (this.airborne) {
      const previousH = this.h;
      this.vy -= TRAMP.GRAVITY * dt;
      this.h += this.vy * dt;
      if (crossedMat(previousH, this.h, this.vy)) {
        this.h = 0;
        this.resolveContact();
      }
    } else {
      this.staggerT -= dt;
      if (this.staggerT <= 0) {
        this.armed = null;
        this.resolveContact(); // launches at the (reset) launchVy
      }
    }

    // Gooby transform: position + squash/stretch by vertical speed
    this.trickGrp.position.y = MAT_Y + 0.52 + this.h + Math.min(0, this.sag * 0.4);
    if (this.airborne && !this.tricking) {
      const k = Math.min(1, Math.abs(this.vy) / TRAMP.MAX_VY);
      const stretch = 1 + k * 0.12;
      this.trickGrp.scale.set(2 - stretch, stretch, 1);
    } else if (this.airborne) {
      this.trickGrp.scale.set(1, 1, 1);
    }

    // landing ring: shrinks toward the mat as impact approaches; teal
    // outside the window, pink inside (§C6.1 visual window)
    if (this.airborne && this.vy < 0) {
      const tti = timeToImpact(this.h, this.vy);
      const apexH = apexFor(this.launchVy);
      const win = windowSecFor(apexH);
      const s = 1 + Math.min(2.6, tti * 2.4);
      this.ring.scale.set(s, s, 1);
      const inWindow = tti <= win;
      this.ringMat.color.setHex(inWindow ? 0xff7ba9 : 0x59c9b9);
      this.ringMat.opacity = inWindow ? 0.95 : 0.55;
    } else {
      this.ringMat.opacity = 0.12;
      this.ring.scale.set(1, 1, 1);
    }

    // fever sparkle trail on big bounces
    if (this.airborne && heightMultiplier(apexFor(this.launchVy)) >= 3 && ctx.rng() < dt * 8) {
      this.particles.emit('sparkles', this.trickGrp.position.clone().add(new THREE.Vector3(0, -0.3, 0)), { count: 1 });
    }

    if (remaining <= 0) {
      this.phase = 'ending';
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.particles.emit('confetti', this.trickGrp.position.clone().add(new THREE.Vector3(0, 0.8, 0)), { count: 18 });
      if (this.autoplay) {
        console.log(`[trampoline] autoplay run ended — score ${this.score}, tricks ${this.tricksDone}`);
      }
    }
  },

  dispose() {
    this.ctx?.renderer?.domElement?.removeEventListener('pointerdown', this.onPointerDown);
    this.offSwipe?.();
    this.trickTween?.cancel();
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    // GLB clones share cached geometries/materials — the framework scene
    // sweep handles GPU frees; drop references only.
    this.ownedGeos = [];
    this.ownedMats = [];
    this.mat = null;
    this.matBase = null;
    this.ring = null;
    this.ringMat = null;
    this.trickGrp = null;
    this.trickTween = null;
    this.bot = null;
    this.airTrickChain = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.ctx = null;
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
