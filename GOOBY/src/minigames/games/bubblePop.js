// Bubble Pop (§C6.1 #11, agent G10): bubbles (transparent spheres) float up
// carrying mini food items; a target banner shows "Pop: <food>" and rotates
// every 12 s; pop matching bubbles (+2), wrong pop (−2 + 0.5 s stun), spiky
// bubbles (procedural spikes) never pop — tapping them costs −1. 60 s; bubble
// speed & density ramp. Pure rules live in bubblePop.logic.js (§B rule).
// Gooby watches from the bottom, cheering matches and going dizzy on stuns.
//
// Dev-only ?autoplay=1: a bot pops mostly-matching bubbles (with human-ish
// mistakes) for headless verification of the §C6 ~13c typical payout.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  BUBBLE,
  riseSpeedAt,
  spawnIntervalAt,
  targetIndexAt,
  targetOrder,
  rollBubble,
  popResult,
  applyScore,
  BUBBLE_STYLES,
  createPopChain,
  recordPopChain,
  chainNeighborIndices,
  touchRadiusFor,
} from './bubblePop.logic.js';

const BUBBLE_R = 0.42;

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
      // F4 P2-3: edge-of-screen bubble pops must not clip their popups
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.63, halfH: 0.25 }));
      sprite.scale.set(1.25, 0.5, 1);
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
  id: 'bubblePop',
  assetKeys: BUBBLE.FOODS.map((f) => `food-kit/${f}`),

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.score = 0;
    this.stunT = 0;
    this.endT = 0;
    this.spawnT = 0.5;
    this.autoT = 0.8;
    this.emotionT = 0;
    this.shakeT = 0;
    this.elapsed = 0;
    this.popChain = createPopChain();

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#CBEDE4'); // minty garden morning

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0xbfe3c8, 1.15));
    const dir = new THREE.DirectionalLight(0xfff2dd, 0.85);
    dir.position.set(3, 5, 5);
    scene.add(dir);

    // --- backdrop: sun + soft clouds + meadow strip at the bottom ---
    const sun = own(new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd166 })
    ));
    sun.position.set(-this.halfW + 1.0, this.halfH - 1.2, -3);
    scene.add(sun);
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
    this.ownedMats.push(cloudMat);
    const cloudGeo = new THREE.CircleGeometry(0.5, 24);
    this.ownedGeos.push(cloudGeo);
    for (const [x, y, s] of [[-0.9, 2.6, 1.1], [1.2, 3.1, 1.4], [0.4, 1.5, 0.8]]) {
      const cloud = new THREE.Mesh(cloudGeo, cloudMat);
      cloud.position.set(x, y, -2.5);
      cloud.scale.set(s * 1.5, s, 1);
      scene.add(cloud);
    }
    const meadow = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 2, 1.6),
      new THREE.MeshBasicMaterial({ color: 0x9edb8a })
    ));
    meadow.position.set(0, -this.halfH + 0.55, -1);
    scene.add(meadow);

    // --- Gooby (bottom corner, watching) ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.scale.setScalar(0.72);
    this.gooby.group.position.set(-this.halfW + 0.75, -this.halfH + 0.5, 0.5);
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // --- target banner (in-scene canvas board, §C6.1: "Pop: <food>") ---
    this.targets = targetOrder(ctx.rng, Math.ceil(BUBBLE.DURATION_SEC / BUBBLE.TARGET_ROTATE_SEC) + 1);
    this.targetIdx = -1;
    this.bannerCanvas = document.createElement('canvas');
    this.bannerCanvas.width = 512;
    this.bannerCanvas.height = 112;
    this.bannerTex = new THREE.CanvasTexture(this.bannerCanvas);
    const bannerMat = new THREE.SpriteMaterial({ map: this.bannerTex, transparent: true, depthWrite: false });
    this.ownedMats.push(bannerMat);
    this.banner = new THREE.Sprite(bannerMat);
    this.banner.position.set(0, this.halfH - 0.62, 1);
    this.banner.scale.set(2.6, 0.57, 1);
    scene.add(this.banner);
    /** target preview: the food mini floating beside the banner text */
    this.bannerFood = null;

    // --- bubble pools ---
    this.bubbleGeo = new THREE.SphereGeometry(BUBBLE_R, 18, 14);
    this.spikyHitGeo = new THREE.SphereGeometry(touchRadiusFor('spiky'), 14, 10);
    this.spikeGeo = new THREE.ConeGeometry(0.07, 0.2, 6);
    this.ownedGeos.push(this.bubbleGeo, this.spikyHitGeo, this.spikeGeo);
    this.bubbleMat = new THREE.MeshStandardMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0.3, roughness: 0.15, metalness: 0.1,
      depthWrite: false,
    });
    this.spikyBodyMat = new THREE.MeshStandardMaterial({
      color: 0x8a7fa8, transparent: true, opacity: 0.55, roughness: 0.35,
    });
    this.spikeMat = new THREE.MeshStandardMaterial({ color: 0x5e5378, roughness: 0.5 });
    this.shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
    this.ownedMats.push(this.bubbleMat, this.spikyBodyMat, this.spikeMat, this.shineMat);
    this.hitMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, colorWrite: false,
    });
    this.ownedMats.push(this.hitMat);
    this.bubbleMats = {};
    this.markerMats = {};
    this.markerTexs = [];
    this.shineGeo = new THREE.SphereGeometry(0.06, 8, 6);
    this.ownedGeos.push(this.shineGeo);

    /** @type {Array<{grp:THREE.Group, sphere:THREE.Mesh, kind:string, food:string|null, foodHolder:THREE.Group|null, x:number, phase:number, wobT:number, active:boolean}>} */
    this.bubbles = [];
    /** @type {Map<string, THREE.Group[]>} pooled food minis by key */
    this.foodPool = new Map();
    /** @type {THREE.Group[]} pooled spiky bubble shells */
    this.spikyPool = [];
    /** @type {THREE.Group[]} pooled plain bubble shells */
    this.shellPool = [];

    this.raycaster = new THREE.Raycaster();

    // --- input: pointerdown pops feel snappier than pointer-up taps ---
    this.onPointerDown = (e) => {
      if (this.phase !== 'play' || this.autoplay) return;
      if (this.stunT > 0) return; // §C6.1: stunned after a wrong pop
      const ndc = new THREE.Vector2(
        (e.clientX / innerWidth) * 2 - 1,
        -(e.clientY / innerHeight) * 2 + 1
      );
      this.raycaster.setFromCamera(ndc, this.ctx.camera);
      const spheres = this.bubbles.filter((b) => b.active).map((b) => b.sphere);
      const hits = this.raycaster.intersectObjects(spheres, false);
      if (hits.length > 0) this.popBubble(hits[0].object.userData.bubble);
    };
    ctx.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

    this.setTarget(0);
    ctx.hud.setScore(0);
    ctx.hud.setTime(BUBBLE.DURATION_SEC);
  },

  /** Current target food id. */
  target() {
    return this.targets[Math.min(this.targetIdx, this.targets.length - 1)];
  },

  /** Rotate the target banner (§C6.1: every 12 s). */
  setTarget(idx) {
    if (idx === this.targetIdx) return;
    this.targetIdx = idx;
    const food = this.target();
    const style = BUBBLE_STYLES[food];
    const g = this.bannerCanvas.getContext('2d');
    g.clearRect(0, 0, 512, 112);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.roundRect(6, 6, 500, 100, 50);
    g.fill();
    g.strokeStyle = style.color;
    g.lineWidth = 7;
    g.stroke();
    g.font = '900 52px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#4A3B36';
    g.fillText(`${style.symbol} ${t('mg.bubble.target', { food: t(`food.${food}`) })}`, 256, 58);
    this.bannerTex.needsUpdate = true;
    // swap the floating preview mini next to the banner
    if (this.bannerFood) {
      this.bannerFood.parent?.remove(this.bannerFood);
      this.releaseFood(this.bannerFoodKey, this.bannerFood);
    }
    this.bannerFood = this.takeFood(food);
    this.bannerFoodKey = food;
    this.bannerFood.position.set(0, this.halfH - 1.25, 1);
    this.bannerFood.scale.setScalar(1);
    this.ctx.scene.add(this.bannerFood);
    const banner = this.banner;
    tween({
      from: 1.25, to: 1, duration: 0.4, ease: easings.easeOutBack,
      onUpdate: (v) => banner.scale.set(2.6 * v, 0.57 * v, 1),
    });
    if (idx > 0) {
      this.ctx.audio.play('bubble.newTarget');
      this.ctx.hud.banner(t('mg.bubble.target', { food: t(`food.${food}`) }));
    }
  },

  takeFood(key) {
    const free = this.foodPool.get(key);
    if (free && free.length > 0) {
      const h = free.pop();
      h.visible = true;
      return h;
    }
    return fitModel(this.ctx.assets.getModel(`food-kit/${key}`), 0.4);
  },

  releaseFood(key, holder) {
    holder.visible = false;
    if (!this.foodPool.has(key)) this.foodPool.set(key, []);
    this.foodPool.get(key).push(holder);
  },

  /** Per-food shell tint (color) plus cached high-contrast symbol material. */
  bubbleMaterial(food) {
    if (!this.bubbleMats[food]) {
      const mat = new THREE.MeshStandardMaterial({
        color: BUBBLE_STYLES[food].color,
        transparent: true,
        opacity: 0.34,
        roughness: 0.15,
        metalness: 0.05,
        depthWrite: false,
      });
      this.bubbleMats[food] = mat;
      this.ownedMats.push(mat);
    }
    return this.bubbleMats[food];
  },

  markerMaterial(food) {
    if (!this.markerMats[food]) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const g = canvas.getContext('2d');
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.arc(32, 32, 27, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#30263D';
      g.font = '900 38px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(BUBBLE_STYLES[food].symbol, 32, 34);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      this.markerTexs.push(tex);
      this.markerMats[food] = mat;
      this.ownedMats.push(mat);
    }
    return this.markerMats[food];
  },

  /** Build/reuse a bubble and float it in from the bottom. */
  spawnBubble() {
    const { rng, scene } = this.ctx;
    const roll = rollBubble(rng, this.target());
    let grp;
    let sphere;
    let foodHolder = null;
    if (roll.kind === 'spiky') {
      grp = this.spikyPool.pop();
      if (!grp) {
        grp = new THREE.Group();
        const bodySphere = new THREE.Mesh(this.bubbleGeo, this.spikyBodyMat);
        bodySphere.scale.setScalar(0.92);
        sphere = new THREE.Mesh(this.spikyHitGeo, this.hitMat);
        grp.add(bodySphere, sphere);
        for (let i = 0; i < 10; i += 1) {
          const spike = new THREE.Mesh(this.spikeGeo, this.spikeMat);
          const phi = Math.acos(1 - 2 * ((i + 0.5) / 10));
          const theta = Math.PI * (1 + Math.sqrt(5)) * i;
          const n = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
          spike.position.copy(n).multiplyScalar(BUBBLE_R * 0.92);
          spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
          grp.add(spike);
        }
        grp.userData.sphere = sphere;
      }
      sphere = grp.userData.sphere;
    } else {
      grp = this.shellPool.pop();
      if (!grp) {
        grp = new THREE.Group();
        sphere = new THREE.Mesh(this.bubbleGeo, this.bubbleMat);
        const shine = new THREE.Mesh(this.shineGeo, this.shineMat);
        shine.position.set(-0.16, 0.2, 0.3);
        grp.add(sphere, shine);
        grp.userData.sphere = sphere;
      }
      sphere = grp.userData.sphere;
      sphere.material = this.bubbleMaterial(roll.food);
      foodHolder = this.takeFood(roll.food);
      grp.add(foodHolder);
      foodHolder.position.set(0, 0, 0);
      let marker = grp.userData.marker;
      if (!marker) {
        marker = new THREE.Sprite(this.markerMaterial(roll.food));
        marker.position.set(0.22, 0.22, 0.38);
        marker.scale.set(0.22, 0.22, 1);
        grp.userData.marker = marker;
        grp.add(marker);
      } else {
        marker.material = this.markerMaterial(roll.food);
      }
    }
    grp.visible = true;
    const x = (rng() * 2 - 1) * (this.halfW - 0.6);
    grp.position.set(x, -this.halfH - 0.6, 0);
    grp.scale.setScalar(1);
    scene.add(grp);
    const bubble = {
      grp,
      sphere,
      kind: roll.kind,
      food: roll.kind === 'food' ? roll.food : null,
      foodHolder,
      x,
      phase: rng() * Math.PI * 2,
      wobT: 0,
      active: true,
      spin: (rng() - 0.5) * 1.6,
    };
    sphere.userData.bubble = bubble;
    this.bubbles.push(bubble);
  },

  despawnBubble(bubble) {
    bubble.active = false;
    bubble.grp.visible = false;
    this.ctx.scene.remove(bubble.grp);
    if (bubble.foodHolder) {
      bubble.grp.remove(bubble.foodHolder);
      this.releaseFood(bubble.food, bubble.foodHolder);
      bubble.foodHolder = null;
    }
    if (bubble.kind === 'spiky') this.spikyPool.push(bubble.grp);
    else this.shellPool.push(bubble.grp);
  },

  /** Tap on a bubble (§C6.1 rules via popResult). */
  popBubble(bubble) {
    if (!bubble.active) return;
    const res = popResult(
      bubble.kind === 'spiky' ? { kind: 'spiky' } : { kind: 'food', food: bubble.food },
      this.target()
    );
    const pos = bubble.grp.position.clone();
    const prev = this.score;
    this.score = applyScore(this.score, res.delta);
    if (this.score !== prev) this.ctx.onScore(this.score - prev);

    if (res.result === 'match') {
      const chain = recordPopChain(this.popChain, bubble.food, this.elapsed);
      this.ctx.audio.play('bubble.pop');
      this.particles.emit('bubbles', pos, { count: 5 });
      this.particles.emit('sparkles', pos, { count: 6 });
      this.floats.spawn(`+${BUBBLE.MATCH_PTS}`, pos, '#2E8B57');
      this.despawnBubble(bubble);
      this.reactGooby('ecstatic', 'happyBounce', pos);
      if (chain.triggered) {
        const candidates = this.bubbles.map((b) => ({
          active: b.active && b.kind === 'food',
          food: b.food,
          x: b.grp.position.x,
          y: b.grp.position.y,
        }));
        const neighbors = chainNeighborIndices(candidates, bubble.food, pos.x, pos.y)
          .map((i) => this.bubbles[i])
          .filter(Boolean);
        let chained = 0;
        for (const neighbor of neighbors) {
          if (!neighbor.active) continue;
          const npos = neighbor.grp.position.clone();
          const before = this.score;
          this.score = applyScore(this.score, BUBBLE.MATCH_PTS);
          if (this.score !== before) this.ctx.onScore(this.score - before);
          this.particles.emit('bubbles', npos, { count: 4 });
          this.particles.emit('sparkles', npos, { count: 4 });
          this.despawnBubble(neighbor);
          chained += 1;
        }
        this.ctx.hud.banner(t('v3.depth.bubble.chain', { n: chained }));
        this.floats.spawn(`+${chained * BUBBLE.MATCH_PTS}`, pos, '#D6428A');
      }
    } else if (res.result === 'wrong') {
      this.ctx.audio.play('bubble.wrong');
      this.stunT = res.stunSec;
      this.particles.emit('bubbles', pos, { count: 4 });
      this.floats.spawn(t('mg.bubble.wrong'), pos, '#D64570');
      this.despawnBubble(bubble);
      this.shakeT = 0.25;
      this.reactGooby('dizzy', 'dizzy', pos);
      this.particles.emit('dizzyStars', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.0, 0)));
    } else {
      // spiky: never pops — it wobbles and pokes back (−1)
      this.ctx.audio.play('bubble.spiky');
      this.floats.spawn(t('mg.bubble.spiky'), pos, '#8A7FA8');
      bubble.wobT = 0.5;
      this.particles.emit('dizzyStars', pos, { count: 3 });
      this.reactGooby('grumpy', 'refuse', pos);
    }
  },

  /** Brief Gooby reaction toward a pop position. */
  reactGooby(emotion, clip, lookPos) {
    this.gooby.setEmotion(emotion);
    this.emotionT = 1.1;
    this.gooby.lookAt(lookPos);
    if (clip === 'dizzy' || clip === 'refuse' || !this.gooby.isPlaying(clip)) {
      this.gooby.play(clip);
    }
  },

  /** Dev autoplay: pop mostly matching bubbles, with human-ish mistakes. */
  autoplayTick(dt) {
    this.autoT -= dt;
    if (this.autoT > 0 || this.stunT > 0) return;
    const { rng } = this.ctx;
    this.autoT = 0.4 + rng() * 0.18;
    const onScreen = this.bubbles.filter(
      (b) => b.active && b.grp.position.y > -this.halfH + 0.8 && b.grp.position.y < this.halfH - 1.4
    );
    if (onScreen.length === 0) return;
    const r = rng();
    let pick = null;
    if (r < 0.76) {
      const matches = onScreen.filter((b) => b.kind === 'food' && b.food === this.target());
      pick = matches.length > 0 ? matches[Math.floor(rng() * matches.length)] : null;
    } else if (r < 0.82) {
      const wrongs = onScreen.filter((b) => b.kind === 'food' && b.food !== this.target());
      pick = wrongs.length > 0 ? wrongs[Math.floor(rng() * wrongs.length)] : null;
    } else if (r < 0.86) {
      const spikies = onScreen.filter((b) => b.kind === 'spiky');
      pick = spikies.length > 0 ? spikies[Math.floor(rng() * spikies.length)] : null;
    }
    if (pick) this.popBubble(pick);
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.elapsed = elapsed;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    // micro-shake on wrong pops
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / 0.25) * 0.06;
      ctx.camera.position.set((ctx.rng() - 0.5) * k, (ctx.rng() - 0.5) * k, 10);
      if (this.shakeT <= 0) ctx.camera.position.set(0, 0, 10);
    }

    if (this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) {
        this.gooby.setEmotion('happy');
        this.gooby.lookAt(null);
      }
    }

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: this.score });
      }
      return;
    }

    const remaining = BUBBLE.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);
    if (this.stunT > 0) this.stunT -= dt;

    // target rotation (§C6.1: every 12 s)
    this.setTarget(targetIndexAt(elapsed));

    if (this.autoplay) this.autoplayTick(dt);

    // spawn cadence (density ramp)
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnBubble();
      this.spawnT = spawnIntervalAt(elapsed);
    }

    // rise + wobble; despawn above the top
    const speed = riseSpeedAt(elapsed);
    for (const b of this.bubbles) {
      if (!b.active) continue;
      const p = b.grp.position;
      p.y += speed * dt;
      p.x = b.x + Math.sin(elapsed * 1.6 + b.phase) * 0.22;
      if (b.foodHolder) b.foodHolder.rotation.y += b.spin * dt;
      if (b.kind === 'spiky') b.grp.rotation.z += 0.5 * dt;
      if (b.wobT > 0) {
        b.wobT -= dt;
        const w = 1 + Math.sin(b.wobT * 40) * 0.12 * (b.wobT / 0.5);
        b.grp.scale.set(w, 2 - w, 1);
      } else if (b.grp.scale.x !== 1) {
        b.grp.scale.setScalar(1);
      }
      if (p.y > this.halfH + 0.7) this.despawnBubble(b);
    }
    this.bubbles = this.bubbles.filter((b) => b.active);

    // banner food preview idles
    if (this.bannerFood) {
      this.bannerFood.rotation.y += dt * 1.4;
    }

    if (remaining <= 0) {
      this.phase = 'ending';
      ctx.camera.position.set(0, 0, 10);
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 16 });
      if (this.autoplay) {
        console.log(`[bubblePop] autoplay run ended — score ${this.score}, chains ${this.popChain.chains}`);
      }
    }
  },

  dispose() {
    this.ctx?.renderer?.domElement?.removeEventListener('pointerdown', this.onPointerDown);
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    this.bannerTex?.dispose();
    for (const tex of this.markerTexs ?? []) tex.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    // GLB clones share cached geometries/materials — the framework scene
    // sweep handles GPU frees; drop references only.
    this.ownedGeos = [];
    this.ownedMats = [];
    this.bubbles = [];
    this.foodPool = null;
    this.spikyPool = [];
    this.shellPool = [];
    this.markerMats = {};
    this.bubbleMats = {};
    this.markerTexs = [];
    this.popChain = null;
    this.bannerFood = null;
    this.banner = null;
    this.bannerTex = null;
    this.bannerCanvas = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.raycaster = null;
    this.ctx = null;
  },
};
