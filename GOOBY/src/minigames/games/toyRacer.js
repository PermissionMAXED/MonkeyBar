// Toy Grand Prix (PLAN3 §C10.1 #1, agent V3/G41): 3-lap kart race across a
// bedroom floor — a seeded toy-car-kit circuit snakes over a giant play rug
// between building-block towers, vs 3 rubber-band AI karts. Hold to drift
// (charge → release = 1.2 s boost), tap to use items (turbo / bumper-shield /
// toy-block drop), item boxes every ⅓ lap, off-track = 40 % slow.
//
// ALL race math lives in toyRacer.logic.js (§B8 purity) — this module
// renders that simulation 1:1: pointer input feeds stepRace(), kart poses
// come from the shared spline sampler, and the event queue becomes sfx/
// particles/banners. Distinct look (§C10.1): bedroom-floor toy world —
// warm wooden planks, striped play rug, building-block skyline.
//
// Dev flags: ?autoplay=1 (logic bot drives — §C10.1 strategy).

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { createParticles } from '../../gfx/particles.js';
import { getAchievementsEngine } from '../../systems/achievementsEngine.js';
import { clampFloatTextToView } from '../framework.js';
import {
  RACER,
  createRace,
  stepRace,
  pointAt,
  botInput,
  runScore,
  runMeta,
  playerRank,
  playerLap,
} from './toyRacer.logic.js';

const S = RACER.WORLD_SCALE; // logic track units → world meters
const WALL = '#F7E3C8'; //      warm bedroom wall (distinct-look rule §C10.1)
const KART_MODELS = ['race', 'taxi', 'police', 'hatchback-sports'];
const BLOCK_COLORS = [0xf27979, 0x7cc15e, 0x6fb7e8, 0xf2c14e, 0xc79be0, 0xf29e4c];

/** dir index (0=+z · 1=−x · 2=−z · 3=+x) → piece rotY (models travel +z). */
const DIR_ROT_Y = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const DIRS_V = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];

/** Procedural canvas texture: warm wooden floor planks. */
function plankTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#C89060';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row += 1) {
    g.fillStyle = row % 2 === 0 ? '#C08A58' : '#CE9868';
    g.fillRect(0, row * 32, 256, 30);
    g.fillStyle = 'rgba(120,70,30,0.35)';
    g.fillRect(((row * 96) + 40) % 256, row * 32, 6, 30);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

/** Procedural canvas texture: pastel ring-striped play rug. */
function rugTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const rings = ['#8FC7E8', '#F7D060', '#F2A0B5', '#9CD98A', '#C79BE0', '#F2A0B5', '#8FC7E8'];
  for (let i = 0; i < rings.length; i += 1) {
    g.fillStyle = rings[i];
    g.beginPath();
    g.arc(256, 256, 256 - i * 34, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#FFF6EC';
  g.beginPath();
  g.arc(256, 256, 256 - rings.length * 34, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(canvas);
}

/** Uniform-scale a model so its bbox width (x) matches targetW. */
function fitWidth(model, targetW) {
  const box = new THREE.Box3().setFromObject(model);
  const w = Math.max(0.001, box.max.x - box.min.x);
  model.scale.multiplyScalar(targetW / w);
  return model;
}

/** Tiny floating score/text sprites (canvas textures, self-disposing). */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#4A3B36') {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 72;
      const g = canvas.getContext('2d');
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.92)';
      g.strokeText(text, 96, 36);
      g.fillStyle = color;
      g.fillText(text, 96, 36);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.9, halfH: 0.35 }));
      sprite.scale.set(1.8, 0.68, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.9 });
    },
    update(dt) {
      for (const f of active) {
        f.age += dt;
        f.sprite.position.y += dt * 1.2;
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
  id: 'toyRacer',
  assetKeys: [
    'toy-car-kit/track-narrow-straight',
    'toy-car-kit/track-narrow-straight-bump-up',
    'toy-car-kit/track-narrow-straight-bump-down',
    'toy-car-kit/track-narrow-corner-small',
    'toy-car-kit/track-narrow-corner-large',
    'toy-car-kit/track-narrow-curve',
    'toy-car-kit/track-narrow-looping',
    'toy-car-kit/gate-finish',
    'toy-car-kit/gate',
    'toy-car-kit/item-box',
    'toy-car-kit/item-banana',
    'toy-car-kit/item-cone',
    ...KART_MODELS.map((m) => `car-kit/${m}`),
  ],
  // V3/G32 §B2.3 sample warm-up (ids mapped in the V3/G41 sfxMap block)
  sfx: [
    'racer.putter', 'racer.drift', 'racer.boost', 'racer.item', 'racer.shield',
    'racer.block', 'racer.blockHit', 'racer.lap', 'racer.overtake', 'racer.offtrack',
    'ui.win',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    const seed = Number.isFinite(ctx.params?.seed) ? ctx.params.seed : Math.floor(ctx.rng() * 2 ** 31);
    this.race = createRace(seed);
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.endT = 0;
    this.score = 0;
    this.putterT = 0;

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    /** @type {THREE.Texture[]} */
    this.ownedTex = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    const scene = ctx.scene;
    scene.background = new THREE.Color(WALL);
    scene.fog = new THREE.Fog(WALL, 26, 60);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0xd8b48c, 1.1));
    const sun = new THREE.DirectionalLight(0xffe9c4, 0.9);
    sun.position.set(6, 12, 4);
    scene.add(sun);

    // --- bedroom floor + play rug (distinct look §C10.1) ---
    const track = this.race.track;
    let cx = 0;
    let cz = 0;
    for (const smp of track.samples) {
      cx += smp.p[0];
      cz += smp.p[2];
    }
    cx = (cx / track.samples.length) * S;
    cz = (cz / track.samples.length) * S;
    this.center = new THREE.Vector3(cx, 0, cz);

    const floorTex = plankTexture();
    this.ownedTex.push(floorTex);
    const floor = own(new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 })
    ));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, -0.02, cz);
    scene.add(floor);

    const rugTex = rugTexture();
    this.ownedTex.push(rugTex);
    const rug = own(new THREE.Mesh(
      new THREE.CircleGeometry(track.lapLen * S * 0.21, 48),
      new THREE.MeshStandardMaterial({ map: rugTex, roughness: 0.95 })
    ));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(cx, 0, cz);
    scene.add(rug);

    // --- building-block skyline (single InstancedMesh — 1 draw call) ---
    const blockGeo = new THREE.BoxGeometry(1, 1, 1);
    const blockMat = new THREE.MeshStandardMaterial({ roughness: 0.65 });
    this.ownedGeos.push(blockGeo);
    this.ownedMats.push(blockMat);
    const deco = mulberryLike(seed);
    const COUNT = 46;
    const skyline = new THREE.InstancedMesh(blockGeo, blockMat, COUNT);
    const m4 = new THREE.Matrix4();
    const color = new THREE.Color();
    const radius = track.lapLen * S * 0.24;
    let idx = 0;
    for (let i = 0; i < 30; i += 1) {
      const ang = (i / 30) * Math.PI * 2 + deco() * 0.15;
      const r = radius + 2.5 + deco() * 7;
      const sz = 1.2 + deco() * 2.2;
      m4.compose(
        new THREE.Vector3(cx + Math.cos(ang) * r, sz / 2, cz + Math.sin(ang) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deco() * Math.PI, 0)),
        new THREE.Vector3(sz, sz * (0.7 + deco() * 1.4), sz)
      );
      skyline.setMatrixAt(idx, m4);
      skyline.setColorAt(idx, color.setHex(BLOCK_COLORS[idx % BLOCK_COLORS.length]));
      idx += 1;
    }
    // a few stacked towers
    for (let towerN = 0; towerN < 4 && idx < COUNT; towerN += 1) {
      const ang = (towerN / 4) * Math.PI * 2 + 0.5;
      const r = radius + 5 + deco() * 4;
      const bx = cx + Math.cos(ang) * r;
      const bz = cz + Math.sin(ang) * r;
      for (let level = 0; level < 4 && idx < COUNT; level += 1) {
        const sz = 2.4 - level * 0.35;
        m4.compose(
          new THREE.Vector3(bx, level * 2 + 1, bz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, level * 0.4, 0)),
          new THREE.Vector3(sz, 2, sz)
        );
        skyline.setMatrixAt(idx, m4);
        skyline.setColorAt(idx, color.setHex(BLOCK_COLORS[(idx * 2) % BLOCK_COLORS.length]));
        idx += 1;
      }
    }
    skyline.count = idx;
    skyline.instanceMatrix.needsUpdate = true;
    scene.add(skyline);
    this.skyline = skyline;

    // --- the toy track itself (committed toy-car-kit GLBs — §D5) ---
    this.trackGroup = new THREE.Group();
    for (const piece of track.pieces) {
      const model = ctx.assets.getModel(`toy-car-kit/${piece.model}`);
      const d = DIRS_V[piece.dir];
      const off = piece.originOffset ?? 0;
      model.position.set((piece.x + d[0] * off) * S, (piece.y + 0.7) * S * 0.999, (piece.z + d[1] * off) * S);
      model.rotation.y = DIR_ROT_Y[piece.dir];
      model.scale.setScalar(S);
      this.trackGroup.add(model);
    }
    // start/finish gate + a mid-lap gate (toy-car-kit props)
    const placeGate = (key, s) => {
      const smp = pointAt(track, s);
      const gate = ctx.assets.getModel(`toy-car-kit/${key}`);
      gate.position.set(smp.p[0] * S, smp.p[1] * S, smp.p[2] * S);
      gate.rotation.y = Math.atan2(smp.t[0], smp.t[2]);
      gate.scale.setScalar(S * 0.82); // arch (native 1.55 w) straddles the 1-unit road
      this.trackGroup.add(gate);
    };
    placeGate('gate-finish', 0);
    placeGate('gate', track.lapLen * 0.55);
    // trackside toy clutter (cones + a banana)
    const clutter = [
      { key: 'item-cone', s: track.lapLen * 0.3, lat: 0.95 },
      { key: 'item-cone', s: track.lapLen * 0.32, lat: -0.95 },
      { key: 'item-banana', s: track.lapLen * 0.7, lat: 1.05 },
    ];
    for (const c of clutter) {
      const smp = pointAt(track, c.s);
      const prop = ctx.assets.getModel(`toy-car-kit/${c.key}`);
      prop.position.set(
        (smp.p[0] + smp.right[0] * c.lat) * S,
        smp.p[1] * S,
        (smp.p[2] + smp.right[2] * c.lat) * S
      );
      prop.scale.setScalar(S * 0.7);
      this.trackGroup.add(prop);
    }
    scene.add(this.trackGroup);

    // --- item boxes (§C10.1: every ~⅓ lap) ---
    this.boxMeshes = [];
    for (const row of track.itemRows) {
      for (let b = 0; b < row.boxes.length; b += 1) {
        const box = row.boxes[b];
        const smp = pointAt(track, row.s);
        const mesh = ctx.assets.getModel('toy-car-kit/item-box');
        mesh.position.set(
          (smp.p[0] + smp.right[0] * box.lat) * S,
          smp.p[1] * S + 0.24,
          (smp.p[2] + smp.right[2] * box.lat) * S
        );
        mesh.scale.setScalar(S * 0.68);
        scene.add(mesh);
        this.boxMeshes.push({ mesh, row, box });
      }
    }

    // --- karts (car-kit toy cars; the player kart carries mini Gooby) ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.kartGroups = [];
    for (let i = 0; i < this.race.karts.length; i += 1) {
      const group = new THREE.Group();
      const body = fitWidth(ctx.assets.getModel(`car-kit/${KART_MODELS[i]}`), 0.36 * S);
      group.add(body);
      if (i === 0) {
        this.gooby = createGooby({ particles: this.particles });
        applyEquippedOutfits(this.gooby);
        this.gooby.group.scale.setScalar(0.42);
        this.gooby.group.position.set(0, 0.34, -0.12);
        this.gooby.setEmotion('happy');
        group.add(this.gooby.group);
      }
      scene.add(group);
      this.kartGroups.push(group);
    }
    // bumper-shield bubble on the player kart
    const shield = own(new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0x7cd4f0, transparent: true, opacity: 0.3, depthWrite: false })
    ));
    shield.visible = false;
    this.kartGroups[0].add(shield);
    this.shieldMesh = shield;

    // --- dropped toy-block pool (§C10.1 item) ---
    this.blockPool = [];
    const studGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
    this.ownedGeos.push(studGeo);
    for (let i = 0; i < RACER.MAX_BLOCKS; i += 1) {
      const mat = new THREE.MeshStandardMaterial({ color: BLOCK_COLORS[i % BLOCK_COLORS.length], roughness: 0.5 });
      this.ownedMats.push(mat);
      const mesh = new THREE.Mesh(studGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.blockPool.push(mesh);
    }

    // --- camera: chase cam behind the player kart ---
    const camera = ctx.camera;
    camera.fov = 58;
    camera.updateProjectionMatrix();
    this.camPos = null;

    // --- input (§C10.1 controls): drag steers · hold drifts · tap = item ---
    this.driftHeld = false;
    this.offDrag = ctx.input.on('drag', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      this.steerTarget = THREE.MathUtils.clamp(p.nx * 1.2, -RACER.LAT_HARD_MAX, RACER.LAT_HARD_MAX);
    });
    this.offTap = ctx.input.on('tap', () => {
      if (this.autoplay || this.phase !== 'play') return;
      this.wantItem = true;
    });
    this.onPointerDown = () => {
      if (this.autoplay || this.phase !== 'play') return;
      this.driftHeld = true;
      this.pressT = performance.now();
    };
    this.onPointerUp = () => {
      if (this.autoplay) return;
      // a short press is a tap (item) — don't let it fire a micro-drift
      if (performance.now() - (this.pressT ?? 0) < 220) this.race.karts[0].driftCharge = 0;
      this.driftHeld = false;
    };
    const el = ctx.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    this.steerTarget = null;
    this.wantItem = false;

    this.buildRaceHud();
    ctx.hud.setScore(0);
    ctx.hud.setTime(0);

    if (import.meta.env?.DEV) {
      // §E9 test surface (same pattern as purblePlace's __purble): lets CDP
      // proofs read race state / perf numbers without scraping the HUD.
      window.__racer = { game: this, race: this.race };
    }
  },

  /** DOM race HUD: lap/position pills + drift meter + item slot (rem-only CSS). */
  buildRaceHud() {
    const root = document.getElementById('ui') ?? document.body;
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'g41-race-hud';
    this.hudEl.innerHTML = `
      <div class="g41-row">
        <span class="g41-pill g41-lap"></span>
        <span class="g41-pill g41-pos"></span>
      </div>
      <div class="g41-meter" aria-label="${t('mg.racer.driftMeter')}"><div class="g41-meter-fill"></div></div>
      <button class="g41-item-btn" aria-label="${t('mg.racer.itemSlot')}">–</button>`;
    root.appendChild(this.hudEl);
    this.lapEl = this.hudEl.querySelector('.g41-lap');
    this.posEl = this.hudEl.querySelector('.g41-pos');
    this.meterEl = this.hudEl.querySelector('.g41-meter-fill');
    this.itemEl = this.hudEl.querySelector('.g41-item-btn');
    this.itemEl.addEventListener('click', () => {
      if (!this.autoplay && this.phase === 'play') this.wantItem = true;
    });
  },

  /** Map race events → sfx / banners / particles / floats. */
  playEvents() {
    const { audio, hud } = this.ctx;
    const race = this.race;
    for (const e of race.events) {
      if (e.type === 'boost' && e.kart === 0) {
        audio.play('racer.boost');
        hud.banner(t('mg.racer.boost'));
        this.particles.emit('sparkles', this.kartGroups[0].position.clone(), { count: 8 });
      } else if (e.type === 'pickup' && e.kart === 0) {
        audio.play('racer.item');
        hud.banner(t(`mg.racer.item.${e.item}`));
      } else if (e.type === 'turbo' && e.kart === 0) {
        audio.play('racer.boost');
        hud.banner(t('mg.racer.turbo'));
      } else if (e.type === 'shield' && e.kart === 0) {
        audio.play('racer.shield');
        hud.banner(t('mg.racer.shield'));
      } else if (e.type === 'blockDrop' && e.kart === 0) {
        audio.play('racer.block');
        hud.banner(t('mg.racer.blockDrop'));
      } else if (e.type === 'blockHit') {
        if (e.kart === 0) {
          audio.play('racer.blockHit');
          hud.banner(t('mg.racer.blockHit'));
          this.gooby?.play('dizzy', { speed: 2.2 });
          this.particles.emit('dizzyStars', this.kartGroups[0].position.clone().add(new THREE.Vector3(0, 0.8, 0)));
        } else {
          audio.play('racer.blockHit');
        }
      } else if (e.type === 'shieldPop' && e.kart === 0) {
        audio.play('racer.shield');
        hud.banner(t('mg.racer.shieldPop'));
      } else if (e.type === 'offtrack' && e.kart === 0) {
        audio.play('racer.offtrack');
        hud.banner(t('mg.racer.offtrack'));
      } else if (e.type === 'overtake') {
        audio.play('racer.overtake');
        this.addScore(RACER.OVERTAKE_POINTS);
        this.floats.spawn(t('mg.racer.overtake'), this.kartGroups[0].position.clone().add(new THREE.Vector3(0, 1, 0)), '#2E8B57');
      } else if (e.type === 'lap') {
        audio.play('racer.lap');
        hud.banner(e.final ? t('mg.racer.finalLap') : t('mg.racer.lap', { n: e.lap }));
      } else if (e.type === 'finish') {
        audio.play('ui.win');
        hud.banner(e.rank === 1 ? t('mg.racer.finish1') : t('mg.racer.finishPlace', { p: e.rank }));
      }
    }
    race.events.length = 0;
  },

  /** Reflect the live §C10.1 score (position bonus counts at finish). */
  addScore(delta) {
    if (delta === 0) return;
    this.score += delta;
    this.ctx.onScore(delta);
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.particles.update(dt);
    this.floats.update(dt);
    this.gooby?.update(dt);

    if (this.phase === 'done') return;
    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.6) {
        this.phase = 'done';
        const meta = runMeta(this.race);
        try {
          const achievements = getAchievementsEngine();
          achievements?.track?.('races', meta.races);
          achievements?.track?.('wins', meta.wins);
        } catch (err) {
          console.warn('[toyRacer] counter tracking failed:', err);
        }
        ctx.onEnd({ score: runScore(this.race), meta });
      }
      return;
    }

    const race = this.race;
    const input = this.autoplay
      ? botInput(race)
      : { steer: this.steerTarget, drifting: this.driftHeld, useItem: this.wantItem };
    this.wantItem = false;
    stepRace(race, Math.min(dt, 0.1), input);
    this.playEvents();

    // drift-meter score trickle: driftMeters/10 pays out live (§C10.1)
    const driftPts = Math.floor(race.karts[0].driftMeters / RACER.DRIFT_METERS_DIV);
    const paidDrift = this.paidDrift ?? 0;
    if (driftPts > paidDrift) {
      this.addScore(driftPts - paidDrift);
      this.paidDrift = driftPts;
    }

    ctx.hud.setTime(race.time);

    // --- kart poses from the shared spline sampler ---
    const track = race.track;
    const fwd = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    for (let i = 0; i < race.karts.length; i += 1) {
      const kart = race.karts[i];
      const smp = pointAt(track, kart.s);
      up.set(smp.up[0], smp.up[1], smp.up[2]);
      fwd.set(smp.t[0], smp.t[1], smp.t[2]);
      // logic `right` = t×up points LEFT of travel (left-turn grid
      // convention) — a basis from it is a reflection (det −1) and
      // setFromRotationMatrix would squash the kart; rebuild the true
      // right-handed X axis instead
      right.crossVectors(up, fwd).normalize();
      const group = this.kartGroups[i];
      group.position.set(
        (smp.p[0] + smp.right[0] * kart.lateral) * S,
        smp.p[1] * S + 0.02 + smp.up[1] * 0.0,
        (smp.p[2] + smp.right[2] * kart.lateral) * S
      );
      group.position.addScaledVector(up, 0.02);
      basis.makeBasis(right, up, fwd);
      group.quaternion.setFromRotationMatrix(basis);
      // drift lean + stun wobble
      if (kart.drifting) group.rotateY(0.28 * (kart.lateral >= 0 ? 1 : -1));
      if (kart.stunT > 0) group.rotateZ(Math.sin(elapsed * 30) * 0.15);
    }
    this.shieldMesh.visible = race.karts[0].shield;

    // engine putter + drift scratch (throttled sample ids)
    this.putterT -= dt;
    if (this.putterT <= 0) {
      ctx.audio.play('racer.putter');
      this.putterT = 0.34;
    }
    if (race.karts[0].drifting && race.karts[0].driftCharge > 0.05) ctx.audio.play('racer.drift');

    // --- item boxes: hide while respawning, gentle spin ---
    for (const entry of this.boxMeshes) {
      entry.mesh.visible = entry.box.respawnT <= 0;
      entry.mesh.rotation.y += dt * 2.2;
    }

    // --- dropped toy blocks ---
    for (let i = 0; i < this.blockPool.length; i += 1) {
      const mesh = this.blockPool[i];
      const block = race.blocks[i];
      if (!block) {
        mesh.visible = false;
        continue;
      }
      const smp = pointAt(track, block.s);
      mesh.visible = true;
      mesh.position.set(
        (smp.p[0] + smp.right[0] * block.lat) * S,
        smp.p[1] * S + 0.18,
        (smp.p[2] + smp.right[2] * block.lat) * S
      );
    }

    // --- chase camera (trackside cam while the kart rides a vertical loop) ---
    const player = this.kartGroups[0];
    const pSmp = pointAt(track, race.karts[0].s);
    // inside the loop the tangent goes vertical — hold the last strong
    // horizontal heading so the camera never spins with the corkscrew
    if (Math.hypot(pSmp.t[0], pSmp.t[2]) > 0.45) {
      this.camFwd = (this.camFwd ?? new THREE.Vector3()).set(pSmp.t[0], 0, pSmp.t[2]).normalize();
    }
    fwd.copy(this.camFwd ?? new THREE.Vector3(0, 0, 1));
    const ps = race.karts[0].s;
    const loopZone = track.loopZones.find((z) => ps >= z.s0 - 0.4 && ps <= z.s1 + 0.2);
    const wanted = player.position.clone();
    const lookAt = player.position.clone();
    if (loopZone) {
      // fixed trackside stunt-cam: frame the whole ring from outside its
      // plane — stable while the kart whips around, kart stays in view.
      // Ring centre sits directly below the apex by the loop radius
      // (apex height = 2r on a ground-level loop piece).
      const apex = pointAt(track, (loopZone.s0 + loopZone.s1) / 2);
      lookAt.set(apex.p[0] * S, (apex.p[1] / 2) * S, apex.p[2] * S);
      const perp = new THREE.Vector3(-fwd.z, 0, fwd.x);
      // stay on whichever side the camera is already on (no plane crossing)
      if (this.camPos && this.camPos.clone().sub(lookAt).dot(perp) < 0) perp.negate();
      wanted.copy(lookAt).addScaledVector(perp, 14).addScaledVector(fwd, -2);
    } else {
      wanted.addScaledVector(fwd, -5.8);
      wanted.y = Math.max(player.position.y + 3.1, 3.1);
      lookAt.addScaledVector(fwd, 1.7).add(new THREE.Vector3(0, 0.4, 0));
      // trailing point inside a ring's s-range (just exited / between the
      // boulevard's twin loops)? slide sideways out of the ribbon's plane
      const camS = ((ps - 5.8) % track.lapLen + track.lapLen) % track.lapLen;
      if (track.loopZones.some((z) => camS >= z.s0 - 0.5 && z.s1 + 0.5 >= camS)) {
        const perp = new THREE.Vector3(-fwd.z, 0, fwd.x);
        if (this.camPos && this.camPos.clone().sub(player.position).dot(perp) < 0) perp.negate();
        wanted.addScaledVector(perp, 5).addScaledVector(fwd, 2.4);
      }
    }
    if (!this.camPos) this.camPos = wanted.clone();
    if (!this.camLook) this.camLook = lookAt.clone();
    this.camPos.lerp(wanted, Math.min(1, dt * 4));
    this.camLook.lerp(lookAt, Math.min(1, dt * 6));
    ctx.camera.position.copy(this.camPos);
    ctx.camera.lookAt(this.camLook);

    // --- race HUD ---
    const kart = race.karts[0];
    this.lapEl.textContent = t('mg.racer.lapPill', { n: playerLap(race), total: RACER.LAPS });
    this.posEl.textContent = `${race.ended ? race.finishRank : playerRank(race)}.`;
    this.meterEl.style.width = `${Math.round(kart.driftCharge * 100)}%`;
    this.meterEl.classList.toggle('g41-ready', kart.driftCharge >= RACER.DRIFT_MIN_CHARGE);
    this.itemEl.textContent = kart.item ? { turbo: '🚀', shield: '🛡', block: '🧱' }[kart.item] : '–';

    if (import.meta.env?.DEV) {
      this.maxDrawCalls = Math.max(this.maxDrawCalls ?? 0, ctx.renderer?.info?.render?.calls ?? 0);
    }

    if (race.ended && this.phase === 'play') {
      this.phase = 'ending';
      // settle the final score: position bonus lands now (§C10.1 formula)
      const final = runScore(race);
      if (final !== this.score) this.addScore(final - this.score);
      this.gooby?.setEmotion(race.finishRank <= 2 ? 'ecstatic' : 'happy');
      this.gooby?.play('happyBounce');
      this.particles.emit('confetti', this.kartGroups[0].position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 16 });
      if (this.autoplay) {
        console.log(`[toyRacer] autoplay run ended — rank ${race.finishRank}, overtakes ${race.overtakes}, drift ${race.karts[0].driftMeters.toFixed(0)}m, score ${final}, maxDrawCalls ${this.maxDrawCalls}`);
      }
    }
  },

  dispose() {
    this.offDrag?.();
    this.offTap?.();
    const el = this.ctx?.renderer?.domElement;
    el?.removeEventListener('pointerdown', this.onPointerDown);
    el?.removeEventListener('pointerup', this.onPointerUp);
    el?.removeEventListener('pointercancel', this.onPointerUp);
    this.hudEl?.remove();
    this.hudEl = null;
    if (import.meta.env?.DEV && window.__racer?.game === this) delete window.__racer;
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    this.skyline?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTex ?? []) tex.dispose();
    // GLB clones share cached geometries/materials — the framework sweep
    // skips shared masters (V2/FIX-F P2-3); drop references only.
    this.race = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.kartGroups = [];
    this.boxMeshes = [];
    this.blockPool = [];
    this.trackGroup = null;
    this.skyline = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTex = [];
  },
};

/** Small decoration rng (seed-stable, independent from the race rng). */
function mulberryLike(seed) {
  let a = (seed ^ 0xa5a5a5a5) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) | 0;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
