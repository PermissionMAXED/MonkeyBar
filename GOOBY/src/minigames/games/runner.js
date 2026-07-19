// Gooby Runner (§C6.1 #6, M): 3-lane endless run through a city sidewalk
// corridor — city-kit buildings as walls, nature trees, recycled road tiles.
// Swipe left/right = lane change, up = jump, down = slide. Obstacles: cones,
// boxes, barriers (jump), overhead scaffolds (slide), parked cars (dodge).
// Floating coins +1 each; speed +5%/10 s; first hit = stumble (combo lost),
// second hit = end. Score = meters + coins×bonus. All gameplay math lives in
// runner.logic.js (pure, unit-tested); this module is the §E8 plugin shell.
//
// Dev-only ?autoplay=1: random-ish competent play for headless verification.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { createParticles } from '../../gfx/particles.js';
// V4/G67 (PLAN4-GAMES §G4.8 runner row): reduced-dose speed juice — FOV 60
// base + 8 kick over the 6→13 m/s ramp, 16-streak pool, 0.03 top shake,
// banners at the ramp thirds. Shared helpers in gfx/speedLines.js.
import {
  RUNNER_FX,
  speedFovTarget,
  fovLerp,
  streakRate,
  topSpeedShake,
  crossedMilestones,
  createSpeedLines,
} from '../../gfx/speedLines.js';
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  RUNNER,
  speedAt,
  comboMultiplier,
  runnerScore,
  sweepHitsObstacle,
  passableLanes,
  generateRow,
  rollMysteryPower,
  activateMysteryPower,
  mysteryCoinPoints,
  magnetCollects,
  resolveRunnerHit,
} from './runner.logic.js';

const CORRIDOR_LEN = 104; //  scenery conveyor loop length (m)
const SPAWN_Z = -88; //       obstacle rows appear here
const DESPAWN_Z = 9; //       and are recycled here
const SKY = 0xbfe3ff;
const BUILDINGS = ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f'];

/** Fit a GLB clone so its bounding box matches targetW on x (uniform). */
function fitWidth(model, targetW) {
  const box = new THREE.Box3().setFromObject(model);
  const w = Math.max(0.001, box.max.x - box.min.x);
  model.scale.multiplyScalar(targetW / w);
  return model;
}

/** Ground a model: shift so its bbox bottom sits at y = 0. */
function ground(model) {
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  return model;
}

/** Cached canvas textures for floating "+N" text sprites. */
const floatTexCache = new Map();
function floatTexture(text, color) {
  const key = `${text}|${color}`;
  if (floatTexCache.has(key)) return floatTexCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = '900 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(74,59,54,0.85)';
  g.strokeText(text, 64, 34);
  g.fillStyle = color;
  g.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(canvas);
  floatTexCache.set(key, tex);
  return tex;
}

export default {
  id: 'runner',
  assetKeys: [
    'city-kit-roads/road-straight',
    'city-kit-roads/tile-low',
    'city-kit-roads/construction-cone',
    'city-kit-roads/construction-barrier',
    'car-kit/box',
    'car-kit/taxi',
    'car-kit/sedan',
    'car-kit/van',
    ...BUILDINGS.map((b) => `city-kit-commercial/${b}`),
    'nature-kit/tree_default',
    'nature-kit/tree_oak',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    const scene = ctx.scene;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 34, 92);

    scene.add(new THREE.HemisphereLight(0xfff5e8, 0xb8a898, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
    sun.position.set(4, 9, 6);
    scene.add(sun);

    ctx.camera.position.set(0, 3.6, 7.0);
    ctx.camera.lookAt(0, 0.9, -3.5);
    // V4/G67 §G4.8: runner's base FOV is 60 (spec row "FOV 60 → +8")
    ctx.camera.fov = RUNNER_FX.FOV_BASE;
    ctx.camera.updateProjectionMatrix();

    /** All internal state — dropped whole in dispose(). */
    const S = {
      ctx,
      started: false,
      ending: 0, // >0 = end-sequence countdown (s)
      elapsed: 0,
      meters: 0,
      coins: 0,
      coinStreak: 0,
      coinPoints: 0,
      hits: 0,
      invulnT: 0,
      pu: { magnetT: 0, x2T: 0, shield: false },
      powerups: 0,
      shakeT: 0,
      shakeAmp: 0,
      // player
      lane: 1,
      laneX: 0,
      jumpT: -1,
      slideT: -1,
      // world
      scenery: [], //     {obj, z0} conveyor items
      obstacles: [], //   {kind, lane, z, obj, rowId}
      coinsArr: [], //    {lane, z, y, obj, taken}
      mysteryArr: [], //  {lane,z,obj}
      nextMysteryAt: RUNNER.MYSTERY_FIRST_M,
      knocked: [], //     {obj, vel, spin, t} stumble debris
      floaters: [], //    {sprite, t, life}
      distSinceRow: 0,
      pendingRow: null,
      recentRows: [],
      rowId: 0,
      lastShownScore: -1,
      autoplay:
        import.meta.env.DEV &&
        typeof location !== 'undefined' &&
        new URLSearchParams(location.search).get('autoplay') === '1',
      auto: { handledRow: -1, action: null, actionAtZ: 0, targetLane: 1 },
    };
    this.S = S;

    // --- corridor scenery (conveyor-looped) ---
    const addScenery = (obj, x, z) => {
      obj.position.x = x;
      obj.position.z = z;
      scene.add(obj);
      S.scenery.push({ obj, z });
    };
    // road: recycled road-straight tiles (rotated so the lane runs along the
    // corridor), widened to cover the 3 lanes
    const roadInner = ctx.assets.getModel('city-kit-roads/road-straight');
    roadInner.rotation.y = Math.PI / 2;
    const roadProto = new THREE.Group();
    roadProto.add(roadInner);
    ground(fitWidth(roadProto, 4.6));
    roadProto.scale.z *= 8 / 4.6; // stretch depth so fewer tiles are needed
    for (let z = DESPAWN_Z; z > DESPAWN_Z - CORRIDOR_LEN; z -= 8) {
      addScenery(roadProto.clone(), 0, z - 4);
    }
    // sidewalk strips (tile-low) flanking the road
    const walkProto = ground(fitWidth(ctx.assets.getModel('city-kit-roads/tile-low'), 1.6));
    walkProto.scale.z *= 8 / 1.6;
    for (let z = DESPAWN_Z; z > DESPAWN_Z - CORRIDOR_LEN; z -= 8) {
      for (const sx of [-3.15, 3.15]) addScenery(walkProto.clone(), sx, z - 4);
    }
    // buildings as corridor walls
    for (let i = 0; i < Math.floor(CORRIDOR_LEN / 13); i += 1) {
      for (const side of [-1, 1]) {
        const name = BUILDINGS[(i * 2 + (side > 0 ? 1 : 0)) % BUILDINGS.length];
        const b = ground(fitWidth(ctx.assets.getModel(`city-kit-commercial/${name}`), 10));
        b.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        addScenery(b, side * 8.6, -i * 13 - 2);
      }
    }
    // nature trees between sidewalk and buildings
    const treeNames = ['nature-kit/tree_default', 'nature-kit/tree_oak'];
    for (let i = 0; i < 8; i += 1) {
      const tree = ground(fitWidth(ctx.assets.getModel(treeNames[i % 2]), 1.9));
      addScenery(tree, (i % 2 === 0 ? -1 : 1) * 3.2, -i * 13 - 8.5);
    }
    // grass base plane under everything
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 220),
      new THREE.MeshLambertMaterial({ color: 0xa8d8a0 })
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(0, -0.06, -70);
    scene.add(base);

    // --- coin prototype (gold cylinder, shared geo/mat) ---
    S.coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.07, 18);
    S.coinMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.35, metalness: 0.55 });

    // --- overhead scaffold prototype pieces (posts are procedural) ---
    S.postGeo = new THREE.BoxGeometry(0.09, RUNNER.OBSTACLES.overhead.gapY + 0.3, 0.09);
    S.postMat = new THREE.MeshLambertMaterial({ color: 0xb0552f });

    // --- Gooby: bouncy hop-run (rabbit!), facing away from the camera ---
    S.particles = createParticles(scene);
    S.gooby = createGooby({ particles: S.particles });
    applyEquippedOutfits(S.gooby); // G14: cameo wears the equipped outfits
    S.gooby.group.rotation.y = Math.PI;
    S.gooby.setEmotion('happy');
    S.gooby.play('happyBounce', { loop: true, speed: 1.7 });
    scene.add(S.gooby.group);
    S.shieldVis = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x64b5f6,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        wireframe: true,
      })
    );
    S.shieldVis.visible = false;
    scene.add(S.shieldVis);

    // ── V4/G67 (PLAN4-GAMES §G4.8 runner row): reduced-dose juice state ────
    // 16-streak pool as ONE atlas-backed InstancedMesh (1 draw call); the
    // runner's world runs ahead = −z (rows spawn at −88), so forwardZ = −1.
    S.speedLines = createSpeedLines(scene, {
      pool: RUNNER_FX.STREAK_POOL,
      radius: RUNNER_FX.STREAK_RADIUS,
      ahead: RUNNER_FX.STREAK_AHEAD,
      forwardZ: -1,
      rng: ctx.rng,
    });
    S.fx = { seen: new Set(), prevSpeed: 0 }; // ramp-third banner latch
    // ── end V4/G67 init ─────────────────────────────────────────────────────

    ctx.hud.setScore(0);
    ctx.hud.setTime(0);

    // --- input (§E5): swipes steer, jump, slide ---
    S.offSwipe = ctx.input.on('swipe', (p) => {
      if (!S.started || S.ending) return;
      if (p.dir === 'left') this.changeLane(-1);
      else if (p.dir === 'right') this.changeLane(1);
      else if (p.dir === 'up') this.jump();
      else if (p.dir === 'down') this.slide();
    });

    if (import.meta.env?.DEV) window.__runner = { S }; // V4/G67 CDP probe (dev-only)
  },

  // ------------------------------------------------------------- actions
  changeLane(dir) {
    const S = this.S;
    const next = Math.max(0, Math.min(RUNNER.LANES - 1, S.lane + dir));
    if (next !== S.lane) {
      S.lane = next;
      S.ctx.audio.play('whoosh');
    }
  },

  jump() {
    const S = this.S;
    if (S.jumpT >= 0 || S.slideT >= 0) return;
    S.jumpT = 0;
    S.ctx.audio.play('jump');
    S.gooby.play('jump', { speed: 0.6 / RUNNER.JUMP_SEC });
  },

  slide() {
    const S = this.S;
    if (S.jumpT >= 0 || S.slideT >= 0) return;
    S.slideT = 0;
    S.ctx.audio.play('slide');
  },

  // ------------------------------------------------------------- spawning
  spawnRow(row) {
    const S = this.S;
    const { ctx } = S;
    S.rowId += 1;
    const carNames = ['car-kit/taxi', 'car-kit/sedan', 'car-kit/van'];
    row.lanes.forEach((kind, lane) => {
      if (!kind) return;
      let obj;
      if (kind === 'cone') {
        obj = ground(fitWidth(ctx.assets.getModel('city-kit-roads/construction-cone'), 0.55));
      } else if (kind === 'box') {
        obj = ground(fitWidth(ctx.assets.getModel('car-kit/box'), 0.72));
      } else if (kind === 'barrier') {
        obj = ground(fitWidth(ctx.assets.getModel('city-kit-roads/construction-barrier'), 1.05));
      } else if (kind === 'car') {
        obj = ground(fitWidth(ctx.assets.getModel(carNames[Math.floor(S.ctx.rng() * carNames.length)]), 1.15));
        obj.rotation.y = Math.PI / 2 + (S.ctx.rng() - 0.5) * 0.15;
      } else {
        // overhead: barrier raised on two posts — slide under it
        obj = new THREE.Group();
        const bar = ground(fitWidth(ctx.assets.getModel('city-kit-roads/construction-barrier'), 1.3));
        bar.position.y = RUNNER.OBSTACLES.overhead.gapY;
        obj.add(bar);
        for (const px of [-0.55, 0.55]) {
          const post = new THREE.Mesh(S.postGeo, S.postMat);
          post.position.set(px, (RUNNER.OBSTACLES.overhead.gapY + 0.3) / 2 - 0.15, 0);
          obj.add(post);
        }
      }
      obj.position.x = RUNNER.LANE_X[lane];
      obj.position.z = SPAWN_Z;
      S.ctx.scene.add(obj);
      S.obstacles.push({ kind, lane, z: SPAWN_Z, obj, rowId: S.rowId });
    });

    // coins guide a survivable path through the row (arc over jumpables)
    if (S.ctx.rng() < RUNNER.COIN_LINE_CHANCE) {
      const pass = passableLanes(row);
      const options = pass
        .map((ok, lane) => ({ ok, lane, kind: row.lanes[lane] }))
        .filter((o) => o.ok);
      if (options.length > 0) {
        const pickFree = options.filter((o) => o.kind == null);
        const opt = (pickFree.length > 0 && S.ctx.rng() < 0.7)
          ? pickFree[Math.floor(S.ctx.rng() * pickFree.length)]
          : options[Math.floor(S.ctx.rng() * options.length)];
        const overJump = opt.kind != null && RUNNER.OBSTACLES[opt.kind].pass === 'jump';
        for (let i = 0; i < RUNNER.COIN_LINE; i += 1) {
          const zOff = (i - (RUNNER.COIN_LINE - 1) / 2) * 1.15;
          const y = overJump
            ? 0.55 + RUNNER.JUMP_HEIGHT * 0.8 * Math.cos((zOff / 2.2) * Math.PI * 0.5) ** 2
            : 0.55;
          const coin = new THREE.Mesh(S.coinGeo, S.coinMat);
          coin.rotation.z = Math.PI / 2;
          coin.position.set(RUNNER.LANE_X[opt.lane], y, SPAWN_Z + zOff);
          S.ctx.scene.add(coin);
          S.coinsArr.push({ lane: opt.lane, z: SPAWN_Z + zOff, y, obj: coin, taken: false });
        }
      }
    }
  },

  spawnMysteryBox() {
    const S = this.S;
    const lane = S.lane;
    const obj = ground(fitWidth(S.ctx.assets.getModel('car-kit/box'), 0.72));
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({
      map: floatTexture('?', '#FFD166'),
      transparent: true,
      depthWrite: false,
    }));
    mark.scale.set(0.7, 0.35, 1);
    mark.position.y = 0.75;
    obj.add(mark);
    obj.position.set(RUNNER.LANE_X[lane], 0, SPAWN_Z);
    S.ctx.scene.add(obj);
    S.mysteryArr.push({ lane, z: SPAWN_Z, obj });
    S.nextMysteryAt += RUNNER.MYSTERY_GAP_M;
  },

  /** Floating "+N" text at a world position (dt-driven, pause-safe). */
  floatText(text, color, pos) {
    const S = this.S;
    const mat = new THREE.SpriteMaterial({ map: floatTexture(text, color), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    // F4 P2-3: outer-lane coin popups must not clip past the screen edges
    sprite.position.copy(clampFloatTextToView(pos.clone(), S.ctx.camera, { halfW: 0.45, halfH: 0.23 }));
    sprite.scale.set(0.9, 0.45, 1);
    S.ctx.scene.add(sprite);
    S.floaters.push({ sprite, t: 0, life: 0.8 });
  },

  shake(amp) {
    this.S.shakeT = 1;
    this.S.shakeAmp = Math.max(this.S.shakeAmp, amp);
  },

  // ------------------------------------------------------------- collisions
  onHit(ob) {
    const S = this.S;
    const hit = resolveRunnerHit({
      hits: S.hits,
      shield: S.pu.shield,
      invulnT: S.invulnT,
    });
    if (hit.outcome === 'ignored') return;
    S.hits = hit.hits;
    S.pu.shield = hit.shield;
    S.invulnT = hit.invulnT;
    // knock the obstacle aside (juice)
    S.obstacles.splice(S.obstacles.indexOf(ob), 1);
    S.knocked.push({
      obj: ob.obj,
      vel: new THREE.Vector3((S.ctx.rng() < 0.5 ? -1 : 1) * (3.5 + S.ctx.rng() * 2), 4.5, 1.2),
      spin: (S.ctx.rng() - 0.5) * 14,
      t: 0,
    });
    if (hit.outcome === 'shielded') {
      S.ctx.audio.play('hopper.shieldPop');
      S.ctx.hud.banner(t('mg.runner.shieldSaved'));
      S.particles.emit('sparkles', S.gooby.group.position.clone().setY(1), { count: 10 });
      return;
    }
    S.coinStreak = 0; // §C6.1 #6: stumble loses the combo/coin multiplier
    if (hit.outcome === 'wipeout') {
      // wipe-out: short fall sequence, then results
      S.ending = 1.3;
      S.ctx.audio.play('crash');
      this.shake(0.3);
      S.gooby.setEmotion('dizzy');
      S.gooby.play('dizzy');
    } else {
      S.ctx.audio.play('crash.soft');
      this.shake(0.16);
      S.ctx.hud.banner(t('mg.runner.stumble'));
      S.gooby.setEmotion('sad');
      S.gooby.play('pokeWobble', { dir: { x: 0, z: 1 } });
      S.recoverT = 1.0; // back to happy after the wobble
    }
  },

  // ------------------------------------------------------------- autoplay
  autoplayTick(speed) {
    const S = this.S;
    // nearest unhandled row ahead of the player
    let row = null;
    for (const ob of S.obstacles) {
      if (ob.z > -1 || ob.rowId <= S.auto.handledRow) continue;
      if (!row || ob.z > row.z) row = ob;
    }
    const box = S.mysteryArr
      .filter((p) => p.z < -0.5)
      .sort((a, b) => b.z - a.z)[0];
    if (box && box.z > -speed * 1.5 && (!row || box.z > row.z + 2)) {
      if (box.lane !== S.lane) this.changeLane(Math.sign(box.lane - S.lane));
      return;
    }
    if (!row) return;
    const reactDist = speed * 0.95;
    if (row.z < -reactDist) return;
    S.auto.handledRow = row.rowId;
    if (S.ctx.rng() < 0.2) return; // random-ish: sometimes just… doesn't react
    const rowObs = S.obstacles.filter((o) => o.rowId === row.rowId);
    const lanes = [null, null, null];
    for (const o of rowObs) lanes[o.lane] = o.kind;
    const pass = passableLanes({ lanes, gap: 0 });
    // prefer: stay in lane if passable, else nearest passable lane
    const order = [S.lane, S.lane - 1, S.lane + 1, S.lane - 2, S.lane + 2]
      .filter((l) => l >= 0 && l < RUNNER.LANES);
    const target = order.find((l) => pass[l]);
    if (target == null) return;
    if (target !== S.lane) this.changeLane(Math.sign(target - S.lane));
    const kind = lanes[target];
    if (kind) {
      const def = RUNNER.OBSTACLES[kind];
      S.auto.action = def.pass; // 'jump' | 'slide'
      S.auto.actionAtZ = -(speed * (def.pass === 'jump' ? RUNNER.JUMP_SEC * 0.45 : RUNNER.SLIDE_SEC * 0.42));
      S.auto.actionRow = row.rowId;
    } else {
      S.auto.action = null;
    }
  },

  // ------------------------------------------------------------- update
  update(dt, elapsed) {
    const S = this.S;
    if (!S) return;
    S.started = true;
    S.elapsed = elapsed;
    const speed = S.ending ? 0 : speedAt(elapsed);
    S.meters += speed * dt;
    S.ctx.hud.setTime(elapsed);
    S.pu.magnetT = Math.max(0, S.pu.magnetT - dt);
    S.pu.x2T = Math.max(0, S.pu.x2T - dt);
    S.shieldVis.visible = S.pu.shield;
    if (S.shieldVis.visible) {
      S.shieldVis.position.copy(S.gooby.group.position).add(new THREE.Vector3(0, 0.75, 0));
      S.shieldVis.rotation.y += dt * 1.5;
    }

    // --- spawn obstacle rows by traveled distance ---
    if (!S.ending) {
      if (S.meters >= S.nextMysteryAt) this.spawnMysteryBox();
      S.distSinceRow += speed * dt;
      if (!S.pendingRow) {
        S.pendingRow = generateRow(S.ctx.rng, elapsed, S.recentRows);
      }
      if (S.distSinceRow >= S.pendingRow.gap) {
        this.spawnRow(S.pendingRow);
        S.recentRows.push(S.pendingRow);
        if (S.recentRows.length > 6) S.recentRows.shift();
        S.distSinceRow = 0;
        S.pendingRow = null;
      }
    }

    // --- autoplay pilot (dev-only ?autoplay=1) ---
    if (S.autoplay && !S.ending) {
      this.autoplayTick(speed);
      if (S.auto.action) {
        const rowObs = S.obstacles.find((o) => o.rowId === S.auto.actionRow);
        if (rowObs && rowObs.z >= S.auto.actionAtZ) {
          if (S.auto.action === 'jump') this.jump();
          else this.slide();
          S.auto.action = null;
        }
      }
    }

    // --- player motion: lane lerp, jump, slide ---
    const targetX = RUNNER.LANE_X[S.lane];
    const k = Math.min(1, dt / RUNNER.LANE_CHANGE_SEC);
    S.laneX += (targetX - S.laneX) * k;
    let y = 0;
    if (S.jumpT >= 0) {
      S.jumpT += dt;
      if (S.jumpT >= RUNNER.JUMP_SEC) {
        S.jumpT = -1;
        S.gooby.play('happyBounce', { loop: true, speed: 1.7 });
      } else {
        y = RUNNER.JUMP_HEIGHT * Math.sin((S.jumpT / RUNNER.JUMP_SEC) * Math.PI);
      }
    }
    let sliding = false;
    if (S.slideT >= 0) {
      S.slideT += dt;
      if (S.slideT >= RUNNER.SLIDE_SEC) {
        S.slideT = -1;
        S.gooby.play('happyBounce', { loop: true, speed: 1.7 });
      } else {
        sliding = true;
      }
    }
    // squash pose while sliding (squashable rig — group scale)
    const squash = sliding ? RUNNER.SLIDE_HEIGHT / RUNNER.STAND_HEIGHT : 1;
    const sq = S.gooby.group.scale;
    sq.y += (squash - sq.y) * Math.min(1, dt * 16);
    sq.x = sq.z = 1 + (1 - sq.y) * 0.55;
    S.gooby.group.position.set(S.laneX, y, 0);
    S.gooby.group.rotation.z = (S.laneX - targetX) * 0.25;
    S.gooby.update(dt);
    S.particles.update(dt);
    if (S.recoverT != null && S.recoverT > 0) {
      S.recoverT -= dt;
      if (S.recoverT <= 0 && !S.ending) S.gooby.setEmotion('happy');
    }

    // --- scenery conveyor ---
    for (const s of S.scenery) {
      s.obj.position.z += speed * dt;
      if (s.obj.position.z > DESPAWN_Z) s.obj.position.z -= CORRIDOR_LEN;
    }

    // --- obstacles: advance, collide, recycle ---
    const laneNow = RUNNER.LANE_X.reduce(
      (best, x, i) => (Math.abs(S.laneX - x) < Math.abs(S.laneX - RUNNER.LANE_X[best]) ? i : best),
      0
    );
    if (S.invulnT > 0) S.invulnT -= dt;
    for (let i = S.obstacles.length - 1; i >= 0; i -= 1) {
      const ob = S.obstacles[i];
      // F4 P2-4: sweep the advance BEFORE applying it — a single post-move
      // check tunnels through collision windows on large (low-FPS) dt frames.
      const dz = speed * dt;
      const hit = !S.ending && S.invulnT <= 0 &&
        sweepHitsObstacle({ lane: laneNow, y, sliding }, ob, dz);
      ob.z += dz;
      ob.obj.position.z = ob.z;
      if (ob.z > DESPAWN_Z) {
        S.ctx.scene.remove(ob.obj);
        S.obstacles.splice(i, 1);
        continue;
      }
      if (hit) {
        this.onHit(ob);
        if (S.ending) break;
      }
    }

    // --- coins: advance, collect, recycle ---
    for (let i = S.coinsArr.length - 1; i >= 0; i -= 1) {
      const c = S.coinsArr[i];
      c.z += speed * dt;
      c.obj.position.z = c.z;
      c.obj.rotation.y += dt * 4;
      if (c.z > DESPAWN_Z) {
        S.ctx.scene.remove(c.obj);
        S.coinsArr.splice(i, 1);
        continue;
      }
      const magnet = magnetCollects(
        { x: RUNNER.LANE_X[c.lane], y: c.y, z: c.z },
        { x: S.laneX, y: y + 0.55, z: 0 },
        S.pu.magnetT > 0
      );
      if (!S.ending && !c.taken &&
          (magnet || (Math.abs(c.z) < 0.55 && c.lane === laneNow &&
            Math.abs(y + 0.55 - c.y) < 0.8))) {
        c.taken = true;
        S.ctx.scene.remove(c.obj);
        S.coinsArr.splice(i, 1);
        S.coins += 1;
        const prevMult = comboMultiplier(S.coinStreak);
        S.coinStreak += 1;
        const mult = comboMultiplier(S.coinStreak);
        const points = mysteryCoinPoints(mult, S.pu.x2T > 0);
        S.coinPoints += points;
        S.ctx.audio.play('coin.get');
        this.floatText(`+${points}`, '#FFD166', c.obj.position.clone().setY(c.y + 0.5));
        S.particles.emit('sparkles', c.obj.position, { count: 4 });
        if (mult > prevMult) {
          S.ctx.hud.banner(t('mg.runner.combo', { mult }));
          S.ctx.audio.play('combo.up');
        }
      }
    }

    // --- V3 mystery boxes: random Magnet / ×2 / stumble shield ---
    for (let i = S.mysteryArr.length - 1; i >= 0; i -= 1) {
      const box = S.mysteryArr[i];
      box.z += speed * dt;
      box.obj.position.z = box.z;
      box.obj.rotation.y += dt * 2;
      if (box.z > DESPAWN_Z) {
        S.ctx.scene.remove(box.obj);
        S.mysteryArr.splice(i, 1);
        continue;
      }
      if (!S.ending && Math.abs(box.z) < 0.7 && box.lane === laneNow && y < 0.8) {
        const kind = rollMysteryPower(S.ctx.rng);
        S.pu = activateMysteryPower(S.pu, kind);
        S.powerups += 1;
        S.ctx.audio.play(kind === 'shield' ? 'hopper.shield' : 'hopper.star');
        S.ctx.hud.banner(t(`mg.runner.${kind}`));
        S.particles.emit('confetti', box.obj.position.clone().setY(1), { count: 9 });
        S.ctx.scene.remove(box.obj);
        S.mysteryArr.splice(i, 1);
      }
    }

    // --- knocked debris (stumble juice) ---
    for (let i = S.knocked.length - 1; i >= 0; i -= 1) {
      const kn = S.knocked[i];
      kn.t += dt;
      kn.vel.y -= 12 * dt;
      kn.obj.position.addScaledVector(kn.vel, dt);
      kn.obj.position.z += speed * dt;
      kn.obj.rotation.x += kn.spin * dt;
      kn.obj.rotation.z += kn.spin * 0.6 * dt;
      // gone after a bounce-length, or before it can smear across the camera
      if (kn.t > 1.2 || kn.obj.position.z > 4) {
        S.ctx.scene.remove(kn.obj);
        S.knocked.splice(i, 1);
      }
    }

    // --- floating text ---
    for (let i = S.floaters.length - 1; i >= 0; i -= 1) {
      const f = S.floaters[i];
      f.t += dt;
      f.sprite.position.y += dt * 1.3;
      f.sprite.material.opacity = 1 - (f.t / f.life) ** 2;
      if (f.t >= f.life) {
        S.ctx.scene.remove(f.sprite);
        f.sprite.material.dispose();
        S.floaters.splice(i, 1);
      }
    }

    // --- camera: lane follow + micro-shake (+ V4/G67 §G4.8 speed juice) ---
    S.shakeT = Math.max(0, S.shakeT - dt * 3.2);
    const shake = S.shakeT > 0 ? S.shakeAmp * S.shakeT : 0;
    if (S.shakeT <= 0) S.shakeAmp = 0;
    // V4/G67 §G4.8: 0.03 top-speed jitter (fades in 12.4→13 m/s), ADDED to
    // the crash-shake term — crash shake still dominates at 0.16/0.3.
    const jitter = shake +
      topSpeedShake(speed, RUNNER_FX.SHAKE_FROM, RUNNER_FX.SHAKE_TO, RUNNER_FX.SHAKE_AMP);
    S.ctx.camera.position.set(
      S.laneX * 0.35 + (Math.random() - 0.5) * jitter,
      3.6 + (Math.random() - 0.5) * jitter,
      7.0
    );
    S.ctx.camera.lookAt(S.laneX * 0.35, 0.9, -3.5);

    // ── V4/G67 §G4.8 (runner row): FOV 60 + 8·ramp, streaks, ⅓-banners ────
    const targetFov = speedFovTarget(
      RUNNER_FX.FOV_BASE, RUNNER_FX.FOV_KICK, speed, RUNNER_FX.BAND[0], RUNNER_FX.BAND[1]
    );
    if (Math.abs(S.ctx.camera.fov - targetFov) > 0.01) {
      S.ctx.camera.fov = fovLerp(S.ctx.camera.fov, targetFov, dt);
      S.ctx.camera.updateProjectionMatrix();
    }
    S.speedLines.update(dt, {
      speed,
      rate: streakRate(speed, RUNNER_FX.RATE),
      originX: S.laneX * 0.35,
      originY: RUNNER_FX.STREAK_ORIGIN_Y,
    });
    if (!S.ending) {
      for (const th of crossedMilestones(S.fx.prevSpeed, speed, RUNNER_FX.MILESTONES, S.fx.seen)) {
        S.fx.seen.add(th);
        S.ctx.audio.play('combo.up');
        S.ctx.hud.banner(t(th >= RUNNER.MAX_SPEED ? 'mg.speedfx.top' : 'mg.speedfx.up'));
      }
      S.fx.prevSpeed = speed;
    }
    if (import.meta.env?.DEV) {
      // CDP telemetry (§G4.8 evidence surface — window.__runner.S.fxDebug)
      S.fxDebug = {
        speed,
        fov: S.ctx.camera.fov,
        streaks: S.speedLines.activeCount(),
        streakDrawCalls: S.speedLines.drawCalls(),
        shake: jitter,
        drawCalls: S.ctx.renderer?.info?.render?.calls ?? 0,
      };
    }
    // ── end V4/G67 update ──────────────────────────────────────────────────

    // --- score ---
    const score = runnerScore(S.meters, S.coinPoints);
    if (score !== S.lastShownScore) {
      S.lastShownScore = score;
      S.ctx.hud.setScore(score);
    }

    // --- end sequence (dt-timed, pause-safe) ---
    if (S.ending) {
      S.ending -= dt;
      if (S.ending <= 0) {
        S.ending = 0;
        if (S.autoplay) {
          console.log(
            `[autoplay] runner score=${score} coins=${S.coins} powerups=${S.powerups}`
          );
        }
        S.ctx.onEnd({ score });
      }
    }
  },

  dispose() {
    const S = this.S;
    if (!S) return;
    S.offSwipe?.();
    S.speedLines?.dispose(); // V4/G67 §G4.8 juice teardown
    if (import.meta.env?.DEV) delete window.__runner; // V4/G67
    S.gooby?.dispose();
    S.particles?.dispose();
    S.coinGeo?.dispose();
    S.coinMat?.dispose();
    S.postGeo?.dispose();
    S.postMat?.dispose();
    for (const f of S.floaters) f.sprite.material.dispose();
    // remaining scene children (asset clones share cached geometry/materials)
    // are swept by the framework's scene disposal (§E8).
    this.S = null;
  },
};
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
