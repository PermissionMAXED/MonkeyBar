// Goalie Gooby (PLAN2 §C1.2 #7, agent V2/G27): sports-reaction goalkeeping
// on a sunny meadow (§C1.3 — white garden goal, chalk lanes, drifting clouds
// and a bunny crowd of Gooby-recipe minis; NOT gardenRush's fenced backyard).
// Balls are kicked from 5 lanes with a 0.9 s telegraph (kicker wind-up +
// lane flash) ramping to 0.45 s, mixing in lobs (swipe up) and rollers
// (swipe down). Swipe toward the lane to dive-save (+4; +2 super save in the
// last 0.15 s, with a short slow-mo), tap = center. 3 conceded goals end the
// round early, else 60 s; every 10 saves the crowd cheers and speed +10%.
// Pure telegraph/lane/save logic in goalieGooby.logic.js (§B rule).
// Dev-only ?autoplay=1: the bot reads the telegraphed lane and swipes at
// t−0.2 s (§C1.2), with a flub chance that ramps as the telegraph shrinks.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { clampFloatTextToView } from '../framework.js';
import {
  GOALIE,
  telegraphSecAt,
  speedMultAt,
  flightSecAt,
  rollKick,
  laneFromSwipe,
  vKindFromSwipe,
  saveMatches,
  diveCovers,
  isSuperSave,
  savePoints,
  isShootoutAt,
  cheersAt,
  autoplayErrAt,
} from './goalieGooby.logic.js';

const GOAL_Z = -2.2;
const GOALIE_Z = -1.7;
const KICK_Z = 2.2;
const GROUND_Y = -2.4;
const GOAL_H = 2.1;
const SLOWMO_SCALE = 0.35;
const SLOWMO_SEC = 0.5;

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
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.8, halfH: 0.26 }));
      sprite.scale.set(1.6, 0.5, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.9 });
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

/** Soccer-ball texture: white with a few dark patches. */
function makeBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#3A3F4A';
  for (const [x, y] of [[12, 14], [40, 8], [30, 34], [8, 46], [52, 44]]) {
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

/** Goal net: transparent plane with a painted grid. */
function makeNetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2;
  for (let i = 0; i <= 16; i += 1) {
    g.beginPath();
    g.moveTo(i * 8, 0);
    g.lineTo(i * 8, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * 8);
    g.lineTo(128, i * 8);
    g.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

/** @type {object} §E8 plugin */
export default {
  id: 'goalieGooby',
  assetKeys: [
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
    this.saves = 0;
    this.goals = 0;
    this.cheers = 0;
    this.endT = 0;
    this.now = 0; // internal clock (slow-mo scaled — round timer uses elapsed)
    this.slowmoT = 0;
    this.emotionT = 0;
    this.shootoutStarted = false;
    this.shootoutShots = 0;
    /** @type {{lane: number, v: 'up'|'mid'|'down', t: number}|null} */
    this.dive = null;
    /** kick machine: 'gap' | 'telegraph' | 'flight' */
    this.kick = {
      state: 'gap', t: 0.9, lane: 2, kind: 'straight', flight: 0,
      botAt: -1, botLane: 2, botV: 'mid', shootout: false,
    };

    const camera = ctx.camera;
    camera.position.set(0, 0.6, 10);
    camera.lookAt(0, -0.4, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);
    // lane centers on the goal plane (z = GOAL_Z is farther → wider view)
    const goalHalfW = Math.min(2.4, this.halfW * 1.16);
    this.laneXs = [];
    for (let i = 0; i < GOALIE.LANES; i += 1) {
      this.laneXs.push(((i / (GOALIE.LANES - 1)) * 2 - 1) * (goalHalfW - 0.25));
    }
    this.goalHalfW = goalHalfW;

    const scene = ctx.scene;
    scene.background = new THREE.Color('#AEE3F5'); // sunny meadow sky

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

    scene.add(new THREE.HemisphereLight(0xfffbe8, 0xa8d89a, 1.2));
    const dir = new THREE.DirectionalLight(0xfff2dd, 0.9);
    dir.position.set(-3, 7, 5);
    scene.add(dir);

    // --- meadow: grass, chalk lanes, flowers, drifting clouds ---
    const grass = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 8, 9),
      new THREE.MeshBasicMaterial({ color: '#8FCE7A' })
    ));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, GROUND_Y, 0);
    scene.add(grass);
    /** @type {THREE.MeshBasicMaterial[]} */
    this.laneMats = [];
    this.laneXs.forEach((x) => {
      const mat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.16 });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5.4), mat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x * 0.82, GROUND_Y + 0.01, (GOAL_Z + KICK_Z) / 2);
      this.ownedGeos.push(strip.geometry);
      this.ownedMats.push(mat);
      this.laneMats.push(mat);
      scene.add(strip);
    });
    for (const [key, x, s] of [
      ['nature-kit/flower_yellowA', -this.halfW + 0.45, 0.4],
      ['nature-kit/flower_redA', this.halfW - 0.4, 0.38],
      ['nature-kit/plant_bush', -this.halfW + 1.0, 0.55],
    ]) {
      const deco = fitModel(ctx.assets.getModel(key), s);
      deco.position.set(x, GROUND_Y + s * 0.4, -0.6);
      scene.add(deco);
    }
    /** @type {THREE.Sprite[]} */
    this.clouds = [];
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = 128;
    cloudCanvas.height = 64;
    const cg = cloudCanvas.getContext('2d');
    cg.fillStyle = 'rgba(255,255,255,0.92)';
    for (const [x, y, r] of [[36, 40, 22], [64, 30, 26], [94, 42, 20]]) {
      cg.beginPath();
      cg.arc(x, y, r, 0, Math.PI * 2);
      cg.fill();
    }
    const cloudTex = new THREE.CanvasTexture(cloudCanvas);
    this.ownedTexs.push(cloudTex);
    for (let i = 0; i < 3; i += 1) {
      const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.9, depthWrite: false });
      const cloud = new THREE.Sprite(mat);
      cloud.scale.set(2.2, 1.1, 1);
      cloud.position.set(-this.halfW + i * this.halfW, this.halfH - 0.8 - i * 0.5, -6);
      this.ownedMats.push(mat);
      this.clouds.push(cloud);
      scene.add(cloud);
    }

    // --- the garden goal: white posts + crossbar + net ---
    const postMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.5 });
    this.ownedMats.push(postMat);
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, GOAL_H, 10);
    const barGeo = new THREE.CylinderGeometry(0.07, 0.07, goalHalfW * 2 + 0.2, 10);
    this.ownedGeos.push(postGeo, barGeo);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(side * goalHalfW, GROUND_Y + GOAL_H / 2, GOAL_Z);
      scene.add(post);
    }
    const bar = new THREE.Mesh(barGeo, postMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GROUND_Y + GOAL_H, GOAL_Z);
    scene.add(bar);
    const netTex = makeNetTexture();
    this.ownedTexs.push(netTex);
    this.netMat = new THREE.MeshBasicMaterial({
      map: netTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ownedMats.push(this.netMat);
    this.net = new THREE.Mesh(new THREE.PlaneGeometry(goalHalfW * 2, GOAL_H), this.netMat);
    this.ownedGeos.push(this.net.geometry);
    this.net.position.set(0, GROUND_Y + GOAL_H / 2, GOAL_Z - 0.25);
    scene.add(this.net);

    // --- conceded pips: 3 little balls, greyed per goal (§C1.2) ---
    const ballTex = makeBallTexture();
    this.ownedTexs.push(ballTex);
    this.ballTex = ballTex;
    /** @type {THREE.MeshBasicMaterial[]} */
    this.goalPipMats = [];
    for (let i = 0; i < GOALIE.MAX_GOALS; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ map: ballTex });
      const pip = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), mat);
      pip.position.set(-0.45 + i * 0.45, this.halfH - 1.75, 0.5);
      this.ownedGeos.push(pip.geometry);
      this.ownedMats.push(mat);
      this.goalPipMats.push(mat);
      scene.add(pip);
    }

    // --- Gooby the goalie, with oversized gloves ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.78);
    this.gooby.group.position.set(0, GROUND_Y + 0.02, GOALIE_Z);
    this.gooby.setEmotion('happy');
    this.gooby.lookAt(new THREE.Vector3(0, 0, 8));
    scene.add(this.gooby.group);
    const gloveGeo = new THREE.SphereGeometry(0.24, 14, 12);
    const gloveMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.55 });
    this.ownedGeos.push(gloveGeo);
    this.ownedMats.push(gloveMat);
    /** @type {THREE.Mesh[]} */
    this.gloves = [];
    for (const side of [-1, 1]) {
      const glove = new THREE.Mesh(gloveGeo, gloveMat);
      glove.position.set(side * 0.62, 0.62, 0.22);
      this.gooby.group.add(glove);
      this.gloves.push(glove);
    }

    // --- the kicker: a rival mini bunny near the camera ---
    this.kicker = this.makeMiniBunny();
    this.kicker.group.scale.setScalar(0.5);
    this.kicker.group.position.set(0, GROUND_Y + 0.02, KICK_Z);
    scene.add(this.kicker.group);

    // --- bunny crowd on the berm behind the goal (Gooby-recipe minis) ---
    /** @type {Array<{group: THREE.Group, phase: number}>} */
    this.crowd = [];
    const berm = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 6, 1.5),
      new THREE.MeshBasicMaterial({ color: '#79B866' })
    ));
    berm.position.set(0, GROUND_Y + 0.4, GOAL_Z - 1.6);
    scene.add(berm);
    for (let i = 0; i < 6; i += 1) {
      const bunny = this.makeMiniBunny();
      const x = ((i / 5) * 2 - 1) * (goalHalfW + 0.5);
      bunny.group.scale.setScalar(0.3);
      bunny.group.position.set(x, GROUND_Y + 0.55, GOAL_Z - 1.2);
      scene.add(bunny.group);
      this.crowd.push({ group: bunny.group, phase: i * 1.1 });
    }

    // --- the ball ---
    this.ballMat = new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.5 });
    this.ownedMats.push(this.ballMat);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), this.ballMat);
    this.ownedGeos.push(this.ball.geometry);
    this.ball.visible = false;
    scene.add(this.ball);
    /** deflected ball free flight after a save */
    this.deflect = null;

    // --- input: swipe toward the lane; tap = center (§C1.2) ---
    this.offSwipe = ctx.input.on('swipe', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      this.doDive(laneFromSwipe(p.dx, p.dy), vKindFromSwipe(p.dy));
    });
    this.offTap = ctx.input.on('tap', () => {
      if (this.autoplay || this.phase !== 'play') return;
      this.doDive(2, 'mid');
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(GOALIE.DURATION_SEC);
  },

  /** Gooby-recipe mini bunny (shared geos/mats — crowd + kicker, §D4). */
  makeMiniBunny() {
    if (!this.miniShared) {
      const body = new THREE.SphereGeometry(0.55, 14, 12);
      const head = new THREE.SphereGeometry(0.34, 14, 12);
      const ear = new THREE.CapsuleGeometry(0.09, 0.42, 4, 8);
      const cream = new THREE.MeshStandardMaterial({ color: '#F5E6C8', roughness: 0.75 });
      const pink = new THREE.MeshStandardMaterial({ color: '#F5B8C4', roughness: 0.8 });
      this.ownedGeos.push(body, head, ear);
      this.ownedMats.push(cream, pink);
      this.miniShared = { body, head, ear, cream, pink };
    }
    const s = this.miniShared;
    const group = new THREE.Group();
    const body = new THREE.Mesh(s.body, s.cream);
    body.scale.set(1, 1.15, 0.9);
    body.position.y = 0.62;
    const head = new THREE.Mesh(s.head, s.cream);
    head.position.y = 1.35;
    const earL = new THREE.Mesh(s.ear, s.cream);
    earL.position.set(-0.16, 1.75, 0);
    earL.rotation.z = 0.18;
    const earR = new THREE.Mesh(s.ear, s.pink);
    earR.position.set(0.16, 1.75, 0);
    earR.rotation.z = -0.18;
    group.add(body, head, earL, earR);
    return { group };
  },

  /** Player/bot dive: commit gloves toward a lane with a vertical intent. */
  doDive(lane, v) {
    if (this.phase !== 'play') return;
    this.dive = { lane, v, t: this.now };
    this.ctx.audio.play('goalie.dive');
    const grp = this.gooby.group;
    const targetX = this.laneXs[lane] * 0.92;
    const targetY = GROUND_Y + (v === 'up' ? 0.5 : v === 'down' ? -0.18 : 0.02);
    tween({
      from: grp.position.x, to: targetX, duration: 0.16, ease: easings.easeOutQuad,
      onUpdate: (x) => { grp.position.x = x; },
    });
    tween({
      from: grp.position.y, to: targetY, duration: 0.16, ease: easings.easeOutQuad,
      onUpdate: (y) => { grp.position.y = y; },
    });
    grp.rotation.z = lane < 2 ? 0.5 : lane > 2 ? -0.5 : 0;
    this.gooby.play('jump', { speed: 2.2 });
  },

  /** Ease the goalie back to the middle once the dive window lapses. */
  recoverDive() {
    this.dive = null;
    const grp = this.gooby.group;
    tween({
      from: grp.position.x, to: 0, duration: 0.28, ease: easings.easeInOutQuad,
      onUpdate: (x) => { grp.position.x = x; },
    });
    tween({
      from: grp.position.y, to: GROUND_Y + 0.02, duration: 0.28, ease: easings.easeInOutQuad,
      onUpdate: (y) => { grp.position.y = y; },
    });
    grp.rotation.z = 0;
  },

  /** Start the next kick's telegraph (§C1.2: wind-up + lane flash). */
  startTelegraph(elapsed, shootout = false) {
    const { rng } = this.ctx;
    const k = this.kick;
    const kick = rollKick(rng, elapsed);
    k.state = 'telegraph';
    k.t = 0;
    k.lane = kick.lane;
    k.kind = kick.kind;
    k.shootout = shootout;
    k.telegraph = shootout ? GOALIE.SHOOTOUT_TELEGRAPH_SEC : telegraphSecAt(elapsed);
    k.flight = shootout ? GOALIE.SHOOTOUT_FLIGHT_SEC : flightSecAt(this.cheers);
    if (shootout) this.shootoutShots += 1;
    // kicker trots to the lane and winds up
    const kx = this.laneXs[k.lane] * 0.55;
    const grp = this.kicker.group;
    tween({
      from: grp.position.x, to: kx, duration: Math.min(0.3, k.telegraph * 0.4), ease: easings.easeOutQuad,
      onUpdate: (x) => { grp.position.x = x; },
    });
    // dev bot plan (§C1.2: read the telegraph, swipe at t−0.2 s)
    if (this.autoplay) {
      const arriveIn = k.telegraph + k.flight;
      const lead = GOALIE.AUTOPLAY_LEAD_SEC + (rng() - 0.5) * 2 * GOALIE.AUTOPLAY_JITTER_SEC;
      k.botAt = this.now + Math.max(0.05, arriveIn - lead);
      k.botLane = k.lane;
      k.botV = k.kind === 'lob' ? 'up' : k.kind === 'roller' ? 'down' : 'mid';
      if (rng() < autoplayErrAt(k.telegraph)) {
        // human-ish flub: wrong lane (or wrong height for specials)
        if (k.kind !== 'straight' && rng() < 0.4) k.botV = 'mid';
        else k.botLane = (k.lane + 1 + Math.floor(rng() * (GOALIE.LANES - 1))) % GOALIE.LANES;
      }
    }
  },

  /** Replace the normal kick loop with the exact five-shot last-10-s finale. */
  startShootout(elapsed) {
    this.shootoutStarted = true;
    this.shootoutShots = 0;
    this.slowmoT = 0;
    this.deflect = null;
    this.ball.visible = false;
    if (this.dive) this.recoverDive();
    this.ctx.hud.banner(t('mg.goalie.shootout'));
    if (this.autoplay) console.log('[goalieGooby] penalty shootout — 5 shots, saves x2');
    this.ctx.audio.play('goalie.cheer');
    this.startTelegraph(elapsed, true);
  },

  /** Telegraph over — the ball is away. */
  launchBall() {
    const k = this.kick;
    k.state = 'flight';
    k.t = 0;
    this.ctx.audio.play('goalie.kick');
    this.ball.visible = true;
    const grp = this.kicker.group;
    tween({
      from: 1.3, to: 1, duration: 0.22, ease: easings.easeOutQuad,
      onUpdate: (v) => grp.scale.setScalar(0.5 * v),
    });
  },

  /** Ball at the line: judge the dive (§C1.2 save / super save / goal). */
  resolveKick() {
    const k = this.kick;
    const arriveT = this.now;
    const dive = this.dive;
    const kicked = { lane: k.lane, kind: k.kind };
    const saved = dive != null && diveCovers(dive.t, arriveT) && saveMatches(kicked, dive);
    if (saved) {
      const superSave = isSuperSave(dive.t, arriveT);
      const pts = savePoints(superSave, k.shootout);
      this.score += pts;
      this.saves += 1;
      this.ctx.onScore(pts);
      this.ctx.audio.play(superSave ? 'goalie.super' : 'goalie.save');
      const at = this.ball.position.clone();
      this.floats.spawn(`+${pts}`, at, superSave ? '#D6428A' : '#2E8B57');
      this.particles.emit('sparkles', at, { count: superSave ? 10 : 5 });
      if (superSave) {
        this.slowmoT = SLOWMO_SEC;
        this.ctx.hud.banner(t('mg.goalie.super'));
      }
      // punched away: free deflection flight
      const { rng } = this.ctx;
      this.deflect = {
        vx: (k.lane < 2 ? -1 : k.lane > 2 ? 1 : rng() < 0.5 ? -1 : 1) * (2.5 + rng() * 1.5),
        vy: 3 + rng() * 1.5,
        age: 0,
      };
      this.gooby.setEmotion(superSave ? 'ecstatic' : 'happy');
      this.emotionT = 1.2;
      // crowd cheer every 10 saves → speed +10% (§C1.2)
      const cheers = cheersAt(this.saves);
      if (cheers > this.cheers) {
        this.cheers = cheers;
        this.ctx.audio.play('goalie.cheer');
        this.ctx.hud.banner(t('mg.goalie.cheer'));
        for (const b of this.crowd) {
          tween({
            from: 1.5, to: 1, duration: 0.5, ease: easings.easeOutBack,
            onUpdate: (v) => b.group.scale.setScalar(0.3 * Math.min(v, 1.3)),
          });
        }
        this.particles.emit('confetti', new THREE.Vector3(0, GROUND_Y + 2.6, GOAL_Z - 1), { count: 16 });
      }
    } else {
      this.goals += 1;
      this.ball.visible = false;
      this.ctx.audio.play('goalie.goal');
      if (this.goalPipMats[this.goals - 1]) {
        this.goalPipMats[this.goals - 1].map = null;
        this.goalPipMats[this.goals - 1].color.set('#8E8E8E');
        this.goalPipMats[this.goals - 1].needsUpdate = true;
      }
      // net bulge
      const net = this.net;
      tween({
        from: 1.14, to: 1, duration: 0.4, ease: easings.easeOutQuad,
        onUpdate: (v) => net.scale.set(1, v, 1),
      });
      this.gooby.setEmotion('sad');
      this.gooby.play('sadSlump');
      this.emotionT = 1.2;
      if (this.goals >= GOALIE.MAX_GOALS && !this.shootoutStarted) {
        this.ctx.hud.banner(t('mg.goalie.over'));
        this.endRound();
        return;
      }
      this.ctx.hud.banner(t('mg.goalie.goal'));
    }
    k.state = 'gap';
    k.t = 0;
  },

  endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'ending';
    this.endT = 0;
    this.slowmoT = 0; // audit: slow-mo never survives the round boundary
    this.ball.visible = false;
    this.ctx.audio.play('ui.win');
    this.gooby.setEmotion(this.score >= 40 ? 'ecstatic' : 'happy');
    this.gooby.play('happyBounce');
    this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)), { count: 16 });
    if (this.autoplay) {
      console.log(`[goalieGooby] autoplay run ended — score ${this.score} (saves ${this.saves}, conceded ${this.goals}, shootout ${this.shootoutShots}/5)`);
    }
  },

  /** Ball position along its flight (lob arcs / rollers hug the grass). */
  ballAt(t01) {
    const k = this.kick;
    const x0 = this.laneXs[k.lane] * 0.55;
    const x1 = this.laneXs[k.lane];
    const x = x0 + (x1 - x0) * t01;
    const z = KICK_Z + (GOALIE_Z + 0.15 - KICK_Z) * t01;
    let y;
    if (k.kind === 'roller') {
      y = GROUND_Y + 0.22;
    } else if (k.kind === 'lob') {
      y = GROUND_Y + 0.25 + 1.35 * t01 + Math.sin(Math.PI * t01) * 1.15;
    } else {
      y = GROUND_Y + 0.3 + 0.55 * t01 + Math.sin(Math.PI * t01) * 0.35;
    }
    return { x, y, z };
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    // slow-mo (§C1.2 super save): scales the scene clock, not the round timer
    const sdt = this.slowmoT > 0 ? dt * SLOWMO_SCALE : dt;
    if (this.slowmoT > 0) this.slowmoT = Math.max(0, this.slowmoT - dt);
    this.now += sdt;

    this.gooby.update(sdt);
    this.particles.update(sdt);
    this.floats.update(dt);
    for (const cloud of this.clouds) {
      cloud.position.x += dt * 0.08;
      if (cloud.position.x > this.halfW + 1.5) cloud.position.x = -this.halfW - 1.5;
    }
    for (const b of this.crowd) {
      b.group.position.y = GROUND_Y + 0.55 + Math.abs(Math.sin(this.now * 2.2 + b.phase)) * 0.07;
    }

    if (this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.gooby.setEmotion('happy');
    }

    // deflected ball free flight after a save
    if (this.deflect) {
      const d = this.deflect;
      d.age += sdt;
      d.vy -= 9 * sdt;
      this.ball.position.x += d.vx * sdt;
      this.ball.position.y += d.vy * sdt;
      this.ball.rotation.z -= d.vx * sdt * 2;
      if (d.age > 0.9) {
        this.deflect = null;
        this.ball.visible = false;
      }
    }

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.5 && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: this.score });
      }
      return;
    }
    if (this.phase !== 'play') return;

    const remaining = GOALIE.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);
    if (!this.shootoutStarted && isShootoutAt(elapsed)) this.startShootout(elapsed);

    // dive recovery once its cover window lapses
    if (this.dive && this.now - this.dive.t > GOALIE.DIVE_HOLD_SEC) this.recoverDive();

    // --- kick state machine ---
    const k = this.kick;
    k.t += sdt;
    if (this.autoplay && k.botAt >= 0 && this.now >= k.botAt) {
      k.botAt = -1;
      this.doDive(k.botLane, k.botV);
    }
    if (k.state === 'gap') {
      if (this.shootoutStarted) {
        if (
          this.shootoutShots < GOALIE.SHOOTOUT_SHOTS
          && k.t >= GOALIE.SHOOTOUT_GAP_SEC
          && remaining > GOALIE.SHOOTOUT_TELEGRAPH_SEC + GOALIE.SHOOTOUT_FLIGHT_SEC
        ) {
          this.startTelegraph(elapsed, true);
        }
      } else if (k.t >= GOALIE.GAP_SEC / speedMultAt(this.cheers) && remaining > 1.4) {
        this.startTelegraph(elapsed);
      }
    } else if (k.state === 'telegraph') {
      // lane flash + kicker wind-up lean
      const pulse = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(this.now * 16));
      this.laneMats[k.lane].opacity = pulse;
      const w = Math.min(1, k.t / k.telegraph);
      this.kicker.group.rotation.z = Math.sin(w * Math.PI) * -0.45;
      this.kicker.group.scale.setScalar(0.5 * (1 + w * 0.3));
      if (k.t >= k.telegraph) {
        this.laneMats[k.lane].opacity = 0.16;
        this.kicker.group.rotation.z = 0;
        this.launchBall();
      }
    } else if (k.state === 'flight') {
      const t01 = Math.min(1, k.t / k.flight);
      const p = this.ballAt(t01);
      this.ball.position.set(p.x, p.y, p.z);
      this.ball.rotation.x -= sdt * 9;
      if (t01 >= 1) this.resolveKick();
    }

    if (remaining <= 0) this.endRound();
  },

  dispose() {
    this.offSwipe?.();
    this.offTap?.();
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    // GLB clones share cached geometries/materials — the framework scene
    // sweep handles GPU frees; drop references only.
    this.miniShared = null;
    this.crowd = [];
    this.kicker = null;
    this.gloves = [];
    this.laneMats = [];
    this.goalPipMats = [];
    this.clouds = [];
    this.ball = null;
    this.ballMat = null;
    this.ballTex = null;
    this.net = null;
    this.netMat = null;
    this.deflect = null;
    this.dive = null;
    this.kick = null;
    this.slowmoT = 0;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
