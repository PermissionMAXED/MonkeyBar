// Gooby Welt (PLAN4-GAMES §G6, Team WELT — agent V4/G66, scene half): Gooby
// floats through a REAL photogrammetry world (Gaussian splats) collecting
// stars, carrots and foto-spots along an authored spline. Chill exploration,
// no fail state, ≈ 110 s runs, SPECIAL arcade presentation. All gameplay
// math is pure in goobyWelt.logic.js; the authored per-scene data (waypoints,
// corridor table, pickups, orientation quaternion) is goobyWelt.paths.js.
//
// TEAM-WELT COORDINATION (G65, same wave, §E0.1-11 degrade-gracefully): the
// splat rendering layer is G65's `src/welt/splatViewer.js` — documented API
// `initViewer(sceneId, { renderer, quality, onProgress, onContextLost })
// → Promise<handle>`. This module feature-detects it via import.meta.glob
// and codes against that contract:
//   · `handle.group` is the DropInViewer Object3D — added to ctx.scene
//     directly (G65 bakes the §G6.3 orientation quaternion into
//     addSplatScene({rotation}), so NO extra orientation wrap; the wrap only
//     applies for raw-Object3D handles without the documented shape);
//   · pause/resume toggles `handle.setVisible(v)` when present, else
//     `object3d.visible` (§G6.6 — suppresses splat sort work);
//   · dispose() AWAITS the handle's HARD dispose (`await handle.dispose()`)
//     before removing it — the §G6.6 lifecycle gate (aborts downloads,
//     terminates the sort worker, frees textures/geometry, restores the
//     renderer pixel ratio; NEVER cache a viewer across rounds);
//   · load failure rejects with error.code 'welt-load-failed' AFTER full
//     self-cleanup — this module swaps in the low-poly fallback stage (sky
//     dome + Kenney nature trees along the same spline data), so the round
//     is fully playable either way.
//
// §G6.6 guards owned here: renderer pixel-ratio save/restore around the game
// (1 high / 0.75 low — `quality` from ctx.params, published for G68's
// pre-game toggle: settings.goobyWeltQuality), camera far 90/60, star glow
// sprites off on low, WebGL context-loss → clean exit to results, async
// framework lifecycle (init returns a Promise → G56's loading card holds the
// countdown; dispose returns a Promise → sceneManager awaits it).
//
// iOS notes carried from the D2 recipe (§G6.6): 1M splat ceiling, ONE scene
// resident at a time, no shadows, pixel ratio 1, test 10 enter/exit cycles
// for memory growth before shipping on device.
//
// Music: the Treblo track „Splat-Wunderwelt" plays via the §C-SYS1 radio
// game-context ('game:goobyWelt'); the previous radio wish is restored on
// dispose. Dev flycam (§G6.5-1): ?minigame=goobyWelt&scene=<id>&flycam=1 —
// WASD/drag free-fly, `P` dumps {pos, look} JSON (window.__weltFlycam).

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { getStore } from '../../core/store.js'; // quality read + weltBest/radio-wish writes only
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { createParticles } from '../../gfx/particles.js';
import { clampFloatTextToView } from '../framework.js';
import {
  WELT,
  createRun,
  stepRun,
  applyDrag,
  clampOffset,
  hudTimeLeft,
  goobyWorldPos,
  goobyArcPos,
  pickupWorldPos,
  offsetWorldPos,
  botTargetOffset,
  runMeta,
} from './goobyWelt.logic.js';
import { WELT_SCENES, WELT_SCENE_IDS, weltScene } from './goobyWelt.paths.js';

// V4/G66 (§E0.1-11): G65's viewer layer — resolved at build time, empty map
// until src/welt/splatViewer.js lands. Never converted to a static import.
const splatViewerModules = import.meta.glob('../../welt/splatViewer.js');

/** End-of-run banner hold before the results screen (s). */
const END_HOLD_SEC = 1.5;
/** Foto-spot flash overlay lifetime (ms). */
const FLASH_MS = 650;
/** Fallback-stage tree ring (§G6.6: 12-tree Kenney nature arrangement). */
const FALLBACK_TREES = 12;
const TREE_MODELS = ['nature-kit/tree_default', 'nature-kit/tree_pineTallA', 'nature-kit/tree_fat'];

/** Soft radial glow sprite texture (star halos / foto shimmer). */
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

/** Flat 5-point star geometry (pickups) — the shared arcade star look. */
function makeStarGeometry(outer = 0.3, inner = 0.125) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** Vertical sky-gradient dome texture for the fallback stage. */
function makeSkyTexture(top, bottom) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
      g.strokeStyle = 'rgba(45,38,60,0.85)';
      g.strokeText(text, 80, 40);
      g.fillStyle = color;
      g.fillText(text, 80, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.55, halfH: 0.28 }));
      sprite.scale.set(1.1, 0.55, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.9 });
    },
    update(dt) {
      for (const f of active) {
        f.age += dt;
        f.sprite.position.y += dt * 0.9;
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
  id: 'goobyWelt',
  assetKeys: ['food-kit/carrot', ...TREE_MODELS],
  /** V3/G32 warm-cache hint — existing mapped ids only (§E0.1-9). */
  sfx: ['hopper.star', 'hopper.gold', 'photo.shutter', 'ui.win'],

  /**
   * Async init (§G6.6): returns a Promise, so G56's framework shows the
   * loading card and holds the countdown until the splat scene resolved.
   * @param {object} ctx §E8 game context
   */
  async init(ctx) {
    this.ctx = ctx;
    const params = ctx.params ?? {};
    const q = import.meta.env?.DEV ? new URLSearchParams(location.search) : null;
    this.autoplay = q?.get('autoplay') === '1';
    this.flycamMode = params.flycam === true || params.flycam === '1';

    // Scene pick: explicit param (pre-game screen / harness) wins; otherwise
    // a seeded rng pick keeps arcade launches varied but deterministic.
    const sceneId = typeof params.scene === 'string' && WELT_SCENE_IDS.includes(params.scene)
      ? params.scene
      : WELT_SCENE_IDS[Math.floor(ctx.rng() * WELT_SCENE_IDS.length) % WELT_SCENE_IDS.length];
    this.sceneData = weltScene(sceneId);
    // §G6.6 quality: launch param (harness) wins, else G68's persisted
    // pre-game toggle `settings.goobyWeltQuality` ('high' Schön | 'low'
    // Flüssig) — read defensively (no store in headless contexts).
    const savedQuality = (() => {
      try {
        return getStore().get('settings.goobyWeltQuality');
      } catch {
        return null;
      }
    })();
    const wantQuality = params.quality ?? params.goobyWeltQuality ?? savedQuality;
    this.quality = wantQuality === 'low' ? 'low' : 'high';

    // §G6.6: pixel ratio 1 (0.75 low) while the game runs — restored on dispose.
    this.savedPixelRatio = ctx.renderer?.getPixelRatio?.() ?? 1;
    ctx.renderer?.setPixelRatio?.(this.quality === 'low' ? WELT.PIXEL_RATIO_LOW : WELT.PIXEL_RATIO_HIGH);

    const camera = ctx.camera;
    camera.fov = WELT.CAMERA_FOV;
    camera.near = 0.1;
    camera.far = this.quality === 'low' ? WELT.CAMERA_FAR_LOW : WELT.CAMERA_FAR_HIGH;
    camera.updateProjectionMatrix();

    const scene = ctx.scene;
    scene.background = new THREE.Color(this.sceneData.ambient.sky[0]);

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    /** @type {THREE.Texture[]} */
    this.ownedTexs = [];
    /** @type {Array<() => void>} input/DOM unsubscribers */
    this.offs = [];
    /** @type {Set<ReturnType<typeof setTimeout>>} */
    this.timers = new Set();

    // gentle wonder lighting — the splat is unlit; these light Gooby/pickups.
    // The key light FOLLOWS the camera (syncPose): the spline orbits the
    // full 360°, so a fixed sun would silhouette Gooby on the far half.
    const [hemiSky, hemiGround, hemiInt] = this.sceneData.ambient.hemi;
    scene.add(new THREE.HemisphereLight(hemiSky, hemiGround, hemiInt));
    this.sun = new THREE.DirectionalLight(this.sceneData.ambient.sun, 0.9);
    this.sun.position.set(6, 12, 4);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.run = createRun(this.sceneData);
    this.elapsed = 0;
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.endT = 0;

    // §G6.6: WebGL context loss is a normal failure — exit cleanly to
    // results. Defined BEFORE the viewer init so G65's onContextLost hook
    // (fires once) and the direct canvas listener share one guarded path.
    this.onContextLost = (e) => {
      e?.preventDefault?.();
      if (!this.run || this.phase === 'done') return;
      console.warn('[goobyWelt] WebGL context lost — clean exit to results');
      this.ctx?.hud.banner(t('mg.welt.contextLost'));
      this.endRound();
    };
    ctx.renderer?.domElement?.addEventListener('webglcontextlost', this.onContextLost);

    // ── splat viewer (G65 layer) or §G6.6 fallback stage ──
    this.viewerHandle = null;
    this.viewerObject = null;
    this.viewerMount = null;
    this.fallback = false;
    this.loadPct = 0;
    try {
      const loader = splatViewerModules['../../welt/splatViewer.js'];
      if (!loader) throw new Error('splatViewer.js not built yet (G65 — §E0.1-11)');
      const mod = await loader();
      const initViewer = mod.initViewer ?? mod.default?.initViewer;
      if (typeof initViewer !== 'function') throw new Error('initViewer missing');
      const handle = await initViewer(this.sceneData.id, {
        renderer: ctx.renderer,
        quality: this.quality,
        onProgress: (pct) => { this.loadPct = pct; },
        onContextLost: () => this.onContextLost?.(null),
      });
      if (!handle) throw new Error('initViewer returned no handle');
      this.viewerHandle = handle;
      this.viewerObject = handle.isObject3D === true
        ? handle
        : handle.group ?? handle.object3d ?? handle.viewer ?? handle.splats ?? null;
      if (!this.viewerObject) throw new Error('viewer handle has no Object3D');
      // Orientation (§G6.3): G65's documented handle (`.group`) already baked
      // the quaternion into addSplatScene({rotation}) — mount directly. Only
      // a raw-Object3D handle still needs the paths-data wrap.
      const orientationApplied = handle.group != null || handle.orientationApplied === true;
      this.viewerMount = new THREE.Group();
      if (!orientationApplied) {
        this.viewerMount.quaternion.fromArray(this.sceneData.orientation);
      }
      this.viewerMount.add(this.viewerObject);
      scene.add(this.viewerMount);
    } catch (err) {
      console.warn(`[goobyWelt] splat viewer unavailable — fallback stage (${err?.message ?? err})`);
      this.viewerHandle = null;
      this.viewerObject = null;
      this.fallback = true;
      this.buildFallbackStage();
    }

    // ── gameplay dressing (invisible-collider pickups get visible props) ──
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);
    this.buildGooby();
    this.buildPickups();
    this.buildFinishGate();

    // ── input: drag steers the corridor offset (§G6.3 — screen-true by
    // construction; the §G3.3 invert proxy wraps ctx.input upstream) ──
    this.offs.push(ctx.input.on('drag', (p) => {
      if (this.flycamMode) {
        this.flycamLook(p);
        return;
      }
      if (this.phase !== 'play' || this.autoplay) return;
      const raw = applyDrag(this.run.target, p.dx ?? 0, p.dy ?? 0, innerWidth);
      this.run.target = clampOffset(raw, WELT.OFFSET_X_MAX);
    }));

    // ── music: „Splat-Wunderwelt" via the radio game-context (feature-
    // detected; the §B2.3 engine loops it and gates the jingle medley) —
    // dispose restores the PERSISTED radio wish (purblePlace convention).
    this.radio = ctx.audio?.radio ?? null;
    this.radioTrack = this.radio?.playContext?.('game:goobyWelt') ?? null;

    // HUD baseline + fallback notice (games have no ui.toast — banner §E8)
    ctx.hud.setScore(0);
    ctx.hud.setTime(hudTimeLeft(this.run));
    if (this.fallback && !this.flycamMode) {
      const timer = setTimeout(() => this.ctx?.hud.banner(t('mg.welt.fallback')), 400);
      this.timers.add(timer);
    }

    if (this.flycamMode && import.meta.env?.DEV) this.setupFlycam();
    if (import.meta.env?.DEV) window.__welt = { game: this }; // V4/G66 CDP probe
  },

  // ------------------------------------------------------------------ build
  buildGooby() {
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(WELT.GOOBY_SCALE);
    this.gooby.play('happyBounce', { loop: true });
    this.gooby.setEmotion('happy');
    this.ctx.scene.add(this.gooby.group);
    this.syncPose(0);
  },

  buildPickups() {
    const scene = this.ctx.scene;
    const track = this.run.track;
    const glowOn = this.quality !== 'low'; // §G6.6: star glow sprites off on low

    this.starGeo = makeStarGeometry();
    this.ownedGeos.push(this.starGeo);
    this.starMat = new THREE.MeshBasicMaterial({ color: '#FFD95E', side: THREE.DoubleSide });
    this.ownedMats.push(this.starMat);
    this.glowTexGold = makeGlowTexture('rgba(255,214,110,0.9)');
    this.glowTexPink = makeGlowTexture('rgba(255,170,220,0.95)');
    this.ownedTexs.push(this.glowTexGold, this.glowTexPink);
    this.glowMatGold = new THREE.SpriteMaterial({
      map: this.glowTexGold, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glowMatPink = new THREE.SpriteMaterial({
      map: this.glowTexPink, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ownedMats.push(this.glowMatGold, this.glowMatPink);

    /** @type {THREE.Group[]} */
    this.starMeshes = this.run.data.stars.map((p) => {
      const holder = new THREE.Group();
      holder.add(new THREE.Mesh(this.starGeo, this.starMat));
      if (glowOn) {
        const glow = new THREE.Sprite(this.glowMatGold);
        glow.scale.setScalar(1.1);
        holder.add(glow);
      }
      holder.position.fromArray(pickupWorldPos(track, p));
      scene.add(holder);
      return holder;
    });

    /** @type {THREE.Group[]} */
    this.carrotMeshes = this.run.data.carrots.map((p) => {
      const holder = new THREE.Group();
      const model = this.ctx.assets.getModel('food-kit/carrot');
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(0.55 / (Math.max(size.x, size.y, size.z) || 1));
      box.setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      holder.add(model);
      if (glowOn) {
        const glow = new THREE.Sprite(this.glowMatGold);
        glow.scale.setScalar(0.9);
        holder.add(glow);
      }
      holder.position.fromArray(pickupWorldPos(track, p));
      scene.add(holder);
      return holder;
    });

    // Foto-spots: invisible r=3 triggers — a soft pulsing shimmer marks the
    // scenic landmark without breaking the photographic look.
    /** @type {THREE.Sprite[]} */
    this.fotoMeshes = this.run.data.fotoSpots.map((p) => {
      const shimmer = new THREE.Sprite(this.glowMatPink);
      shimmer.scale.setScalar(1.6);
      shimmer.position.fromArray(pickupWorldPos(track, p));
      scene.add(shimmer);
      return shimmer;
    });
  },

  buildFinishGate() {
    const track = this.run.track;
    const { pos, fwd } = track.frameAt(track.length);
    this.gateGeo = new THREE.TorusGeometry(1.5, 0.09, 10, 36);
    this.gateMat = new THREE.MeshBasicMaterial({
      color: '#FFE9A6', transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.ownedGeos.push(this.gateGeo);
    this.ownedMats.push(this.gateMat);
    this.gate = new THREE.Mesh(this.gateGeo, this.gateMat);
    this.gate.position.fromArray(pos);
    this.gate.lookAt(pos[0] + fwd[0], pos[1] + fwd[1], pos[2] + fwd[2]);
    this.ctx.scene.add(this.gate);
  },

  /** §G6.6 load-failure fallback: sky dome + ground + 12 Kenney trees along
   *  the same spline data, so the round still plays. */
  buildFallbackStage() {
    const scene = this.ctx.scene;
    const track = this.run.track;
    const amb = this.sceneData.ambient;

    this.skyTex = makeSkyTexture(amb.sky[0], amb.sky[1]);
    this.ownedTexs.push(this.skyTex);
    const skyGeo = new THREE.SphereGeometry(85, 20, 12);
    const skyMat = new THREE.MeshBasicMaterial({
      map: this.skyTex, side: THREE.BackSide, depthWrite: false,
    });
    this.ownedGeos.push(skyGeo);
    this.ownedMats.push(skyMat);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    const groundY = Math.min(...this.sceneData.waypoints.map((w) => w[1])) - 1.6;
    const groundGeo = new THREE.CircleGeometry(80, 28);
    const groundMat = new THREE.MeshLambertMaterial({ color: amb.fallbackGround });
    this.ownedGeos.push(groundGeo);
    this.ownedMats.push(groundMat);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = groundY;
    scene.add(ground);

    for (let i = 0; i < FALLBACK_TREES; i += 1) {
      const s = ((i + 0.5) / FALLBACK_TREES) * track.length;
      const side = i % 2 === 0 ? 1 : -1;
      const lateral = track.corridorAt(s) + 3.5 + (i % 3) * 1.6;
      const p = offsetWorldPos(track, s, { x: side * lateral, y: 0 });
      const tree = this.ctx.assets.getModel(TREE_MODELS[i % TREE_MODELS.length]);
      tree.scale.setScalar(2.6);
      tree.position.set(p[0], groundY, p[2]);
      tree.rotation.y = (i * 2.399) % (Math.PI * 2);
      scene.add(tree);
    }
  },

  // ------------------------------------------------------------------ update
  /** @param {number} dt */
  update(dt) {
    this.elapsed += dt;
    if (this.flycamMode) {
      this.updateFlycam(dt);
      this.particles?.update(dt);
      this.floats?.update(dt);
      return;
    }
    if (!this.run) return;

    if (this.phase === 'play') {
      if (this.autoplay) this.run.target = botTargetOffset(this.run);
      const events = stepRun(this.run, dt);
      for (const e of events) this.handleEvent(e);
      this.ctx.hud.setTime(hudTimeLeft(this.run));
    } else if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= END_HOLD_SEC) this.endRound();
    }

    this.syncPose(dt);
    this.animatePickups(dt);
    this.particles.update(dt);
    this.floats.update(dt);
  },

  /** Camera on the spline (tangent frame, world up) + Gooby 2.2 m ahead at
   *  the eased offset with a gentle ±0.06 m 0.4 Hz bob (§G6.3). */
  syncPose(dt) {
    const run = this.run;
    const cam = this.ctx.camera;
    const { pos, fwd } = run.track.frameAt(run.s);
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(pos[0] + fwd[0], pos[1] + fwd[1], pos[2] + fwd[2]);

    const bob = Math.sin(this.elapsed * Math.PI * 2 * WELT.BOB_HZ) * WELT.BOB_AMP_M;
    const g = goobyWorldPos(run);
    this.gooby.group.position.set(g[0], g[1] + bob, g[2]);
    const gFwd = run.track.tangentAt(goobyArcPos(run));
    this.gooby.group.rotation.y = Math.atan2(gFwd[0], gFwd[2]);
    this.gooby.update?.(dt);

    // camera-following key light (over the left shoulder) → Gooby stays
    // cream-lit on every leg of the 360° route
    this.sun.position.set(pos[0] - fwd[2] * 4, pos[1] + 7, pos[2] + fwd[0] * 4);
    this.sun.target.position.set(g[0], g[1], g[2]);
  },

  animatePickups(dt) {
    const spin = this.elapsed * 1.6;
    for (let i = 0; i < this.starMeshes.length; i += 1) {
      const m = this.starMeshes[i];
      if (!m.visible) continue;
      m.rotation.y = spin + i * 0.7;
      m.position.y += Math.sin(this.elapsed * 2.2 + i) * 0.0016;
    }
    for (const m of this.carrotMeshes) {
      if (m.visible) m.rotation.y = spin * 0.8;
    }
    for (let i = 0; i < this.fotoMeshes.length; i += 1) {
      const m = this.fotoMeshes[i];
      if (m.visible) m.scale.setScalar(1.6 + Math.sin(this.elapsed * 2.4 + i * 2) * 0.35);
    }
  },

  /** @param {import('./goobyWelt.logic.js').WeltEvent} e */
  handleEvent(e) {
    const audio = this.ctx.audio;
    if (e.type === 'star') {
      this.starMeshes[e.index].visible = false;
      audio.play('hopper.star');
      const pos = new THREE.Vector3().fromArray(e.pos);
      this.particles.emit('sparkles', pos, { count: 8 });
      this.floats.spawn('+2', pos, '#FFE066');
    } else if (e.type === 'carrot') {
      this.carrotMeshes[e.index].visible = false;
      audio.play('hopper.gold');
      const pos = new THREE.Vector3().fromArray(e.pos);
      this.particles.emit('sparkles', pos, { count: 14 });
      this.floats.spawn('+5', pos, '#FFB25E');
    } else if (e.type === 'foto') {
      // §G6.4 foto-spot wonder moment: brief pause (logic froze the float),
      // camera-flash vignette, shutter, sparkle, banner „Toller Ausblick!".
      this.fotoMeshes[e.index].visible = false;
      audio.play('photo.shutter');
      this.flashVignette();
      this.ctx.hud.banner(t('mg.welt.fotoSpot'));
      const pos = new THREE.Vector3().fromArray(goobyWorldPos(this.run));
      this.particles.emit('sparkles', pos, { count: 18 });
      this.floats.spawn('+10', pos, '#FF9ED2');
    } else if (e.type === 'finish') {
      this.ctx.hud.banner(t('mg.welt.finish'));
      audio.play('ui.win');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone(), { count: 16 });
      this.phase = 'ending';
      this.endT = 0;
      if (this.autoplay) {
        console.log(`[autoplay] goobyWelt score=${this.run.score} stars=${this.run.stars}/28`);
      }
    }
    if (e.points > 0) this.ctx.onScore(e.points);
  },

  /** Camera-flash vignette (§G6.4) — a short-lived DOM overlay. */
  flashVignette() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;'
      + 'background:radial-gradient(circle, rgba(255,255,255,0.95) 30%, rgba(255,244,230,0.55) 100%);'
      + `opacity:1;transition:opacity ${FLASH_MS}ms ease-out;`;
    document.body.appendChild(el);
    this.flashEl = el;
    requestAnimationFrame(() => { el.style.opacity = '0'; });
    const timer = setTimeout(() => {
      el.remove();
      if (this.flashEl === el) this.flashEl = null;
    }, FLASH_MS + 60);
    this.timers.add(timer);
  },

  /** Single exit path to the framework results (§E8 onEnd — once). */
  endRound() {
    if (this.phase === 'done' || !this.run) return;
    this.phase = 'done';
    // §G6.4 per-scene highscore chips (G68's pre-game reads
    // `minigames.weltBest.<sceneId>` — this is the single write site).
    try {
      const store = getStore();
      const key = `minigames.weltBest.${this.run.sceneId}`;
      const prev = Math.floor(Number(store.get(key)) || 0);
      if (this.run.score > prev) store.set(key, this.run.score);
    } catch { /* headless/no-store contexts */ }
    this.ctx.onEnd({ score: this.run.score, meta: runMeta(this.run) });
  },

  // ---------------------------------------------------------------- flycam
  /** §G6.5-1 authoring flycam (dev only): WASD/RF move, drag look, P dumps
   *  {pos, look}; the authored spline + pickups render as debug props. */
  setupFlycam() {
    const cam = this.ctx.camera;
    const { pos, fwd } = this.run.track.frameAt(0);
    cam.position.set(pos[0], pos[1], pos[2]);
    this.flyYaw = Math.atan2(fwd[0], fwd[2]);
    this.flyPitch = 0;
    this.flyKeys = new Set();
    this.onFlyKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'p') {
        const look = this.flycamLookVec();
        const pose = {
          pos: [cam.position.x, cam.position.y, cam.position.z].map((v) => Math.round(v * 100) / 100),
          look: look.map((v) => Math.round(v * 1000) / 1000),
        };
        window.__weltFlycam.poses.push(pose);
        console.log(`[flycam] ${JSON.stringify(pose)}`);
        return;
      }
      this.flyKeys.add(k);
    };
    this.onFlyKeyUp = (e) => this.flyKeys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', this.onFlyKeyDown);
    window.addEventListener('keyup', this.onFlyKeyUp);
    this.offs.push(() => {
      window.removeEventListener('keydown', this.onFlyKeyDown);
      window.removeEventListener('keyup', this.onFlyKeyUp);
    });

    // debug spline ribbon: one line through 120 arc samples
    const track = this.run.track;
    const linePts = [];
    for (let i = 0; i <= 120; i += 1) {
      const p = track.posAt((i / 120) * track.length);
      linePts.push(new THREE.Vector3(p[0], p[1], p[2]));
    }
    this.flyLineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    this.flyLineMat = new THREE.LineBasicMaterial({ color: '#FF6BB0' });
    this.ownedGeos.push(this.flyLineGeo);
    this.ownedMats.push(this.flyLineMat);
    this.ctx.scene.add(new THREE.Line(this.flyLineGeo, this.flyLineMat));

    window.__weltFlycam = {
      poses: [],
      getPose: () => ({
        pos: [cam.position.x, cam.position.y, cam.position.z],
        yaw: this.flyYaw,
        pitch: this.flyPitch,
      }),
      setPose: (p) => {
        if (Array.isArray(p?.pos)) cam.position.fromArray(p.pos);
        if (typeof p?.yaw === 'number') this.flyYaw = p.yaw;
        if (typeof p?.pitch === 'number') this.flyPitch = p.pitch;
      },
      sceneId: this.sceneData.id,
    };
  },

  flycamLookVec() {
    return [
      Math.sin(this.flyYaw) * Math.cos(this.flyPitch),
      Math.sin(this.flyPitch),
      Math.cos(this.flyYaw) * Math.cos(this.flyPitch),
    ];
  },

  /** Drag rotates the flycam view. @param {object} p §E5 drag payload */
  flycamLook(p) {
    this.flyYaw -= (p.dx ?? 0) * 0.004;
    this.flyPitch = Math.max(-1.4, Math.min(1.4, this.flyPitch - (p.dy ?? 0) * 0.004));
  },

  updateFlycam(dt) {
    const cam = this.ctx.camera;
    const look = this.flycamLookVec();
    const speed = (this.flyKeys?.has('shift') ? 10 : 4) * dt;
    const fwd = new THREE.Vector3(look[0], 0, look[2]).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (this.flyKeys?.has('w')) cam.position.addScaledVector(fwd, speed);
    if (this.flyKeys?.has('s')) cam.position.addScaledVector(fwd, -speed);
    if (this.flyKeys?.has('a')) cam.position.addScaledVector(right, -speed);
    if (this.flyKeys?.has('d')) cam.position.addScaledVector(right, speed);
    if (this.flyKeys?.has('r')) cam.position.y += speed;
    if (this.flyKeys?.has('f')) cam.position.y -= speed;
    cam.up.set(0, 1, 0);
    cam.lookAt(cam.position.x + look[0], cam.position.y + look[1], cam.position.z + look[2]);
    this.ctx.hud.setTime(0);
  },

  // ---------------------------------------------------------------- pause
  /** §G6.6: hiding the viewer suppresses its per-frame sort work. */
  onPause() {
    this.setSplatVisible(false);
  },

  onResume() {
    this.setSplatVisible(true);
  },

  setSplatVisible(v) {
    if (typeof this.viewerHandle?.setVisible === 'function') {
      this.viewerHandle.setVisible(v);
    } else if (this.viewerObject) {
      this.viewerObject.visible = v;
    }
  },

  // ---------------------------------------------------------------- dispose
  /** Async §G6.6 dispose — the framework + sceneManager AWAIT this: input
   *  unsubscribed, timers stopped, `await` the viewer's HARD dispose, mount
   *  removed, pixel ratio restored, radio restored, refs nulled. */
  async dispose() {
    for (const off of this.offs ?? []) {
      try {
        off();
      } catch { /* already removed */ }
    }
    this.offs = [];
    for (const timer of this.timers ?? []) clearTimeout(timer);
    this.timers?.clear?.();
    this.flashEl?.remove();
    this.flashEl = null;
    this.ctx?.renderer?.domElement?.removeEventListener('webglcontextlost', this.onContextLost);
    this.onContextLost = null;

    // the HARD viewer dispose (§G6.6 — releases workers/buffers/textures);
    // never cache the viewer across rounds.
    try {
      const handle = this.viewerHandle;
      if (handle) {
        const hardDispose = typeof handle.dispose === 'function'
          ? handle.dispose.bind(handle)
          : typeof handle.viewer?.dispose === 'function'
            ? handle.viewer.dispose.bind(handle.viewer)
            : null;
        if (hardDispose) await hardDispose();
      }
    } catch (err) {
      console.error('[goobyWelt] viewer dispose error:', err);
    }
    if (this.viewerObject) {
      this.viewerMount?.remove(this.viewerObject);
      this.ctx?.scene?.remove(this.viewerMount);
    }
    this.viewerHandle = null;
    this.viewerObject = null;
    this.viewerMount = null;

    // radio: hand the element back to the PERSISTED wish (playContext never
    // writes radio.playing, so the save still holds the pre-round intent —
    // same restore as purblePlace's context playback).
    if (this.radioTrack && this.radio) {
      try {
        const wish = getStore()?.get?.('radio');
        if (wish?.playing === true) this.radio.start?.();
        else this.radio.stop?.();
      } catch { /* headless/no-store contexts */ }
    }
    this.radio = null;
    this.radioTrack = null;

    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
    this.starMeshes = [];
    this.carrotMeshes = [];
    this.fotoMeshes = [];
    this.gate = null;
    this.gooby = null;
    this.sun = null;
    this.particles = null;
    this.floats = null;

    // §G6.6: restore the renderer pixel ratio for the rest of the app.
    this.ctx?.renderer?.setPixelRatio?.(this.savedPixelRatio ?? 1);
    if (this.flycamMode && window.__weltFlycam) delete window.__weltFlycam;
    if (import.meta.env?.DEV && window.__welt?.game === this) delete window.__welt; // V4/G66
    this.run = null;
    this.sceneData = null;
    this.ctx = null;
  },
};

// V4/G57-convention (§G3.3): drag steering is directional — the global
// „Steuerung invertieren" toggles apply via G56's input proxy.
export const controls = Object.freeze({ invertible: true });

// V4/G68 pre-game contract (§G5.6): scene-select pills + per-scene highscore
// chips render from this namespace export ({id, nameKey} rows, shipped order).
export const SCENES = Object.freeze(
  WELT_SCENE_IDS.map((id) => Object.freeze({ id, nameKey: WELT_SCENES[id].titleKey }))
);
