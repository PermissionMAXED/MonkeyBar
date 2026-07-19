// Gooby Shopping Surf (PLAN3 §C8, FLAGSHIP #1, agent V3/G37): Subway-Surfers-
// class endless runner through a pastel shopping street. 3 lanes, swipe
// lane/jump/slide (+ mid-air fast-drop), rolling shopping carts, crate
// stacks, KayKit NPC shoppers crossing on a dotted line, awning bars,
// puddles, curb gaps; coin lines/arcs, Magnet/×2/Schild/Turbo-Möhre
// powerups, near-miss „Knapp!" juice, 8→16 m/s speed ramp.
//
// ALL gameplay math lives in shoppingSurf.logic.js (§C8.7 purity) — this
// module renders that simulation 1:1: swipes feed stepRun(), the entity
// lists map onto pooled meshes, and the returned events become sfx/
// particles/banners. Modes (ctx.params.mode): 'travel' (§C8.6 — canonical;
// 'surfTravel' alias, G38's launch) = fixed 700 m run to the shop finish
// arch with the collected-coin reward via the framework coins override;
// anything else = arcade endless (3rd crash ends, score row 40/5/34).
//
// Dev flags: ?autoplay=1 (logic bot plays), ?mode=travel forces travel when
// launched via ?minigame=shoppingSurf, ?speedlog=1 logs the ramp.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { createParticles } from '../../gfx/particles.js';
// V4/G67 (PLAN4-GAMES §G4): shared speed-feel juice — FOV kick, instanced
// speed lines, top-speed shake, wind gain, milestones, ghost trail.
import {
  SURF_FX,
  speedFovTarget,
  fovLerp,
  streakRate,
  topSpeedShake,
  windGain,
  crossedMilestones,
  ghostStrength,
  getStreakTextures,
  createSpeedLines,
  createGhostTrail,
} from '../../gfx/speedFx.js';
import { getSfxDef } from '../../audio/sfxMap.js'; // V4/G67 §G4.5 wind-loop probe
import { clampFloatTextToView } from '../framework.js';
import {
  SURF,
  isTravelMode,
  createRun,
  stepRun,
  playerX,
  playerY,
  runScore,
  runMeta,
  travelReward,
  botInput,
} from './shoppingSurf.logic.js';

// Visual mapping: logic hazards live at negative z (ahead of the player);
// the render world flips that (ahead = +z) so the §C8.1 camera offset
// [0, 3.2, −5.5] + 8 m look-ahead reads exactly as specified.
//
// V4/G57 (PLAN4-GAMES §G3.1-b, §G2.1 rule 1): the camera looks down world
// +z, which renders world +x on the screen LEFT — so the logic x-axis is
// mirrored at exactly ONE boundary (logic→render) via WX below, applied at
// ALL render sites (player px + lean, obstacles, NPC dotted line, coins,
// powerups, camX, float/particle spawns that carry a logic x). Logic space
// stays intuitive („left" = −x = screen left) for the bot/validator/tests:
// swipe left → lane−1 → logic x −1.6 → world +1.6 → SCREEN LEFT. ✅
/** Logic→render x mirror (§G3.1-b) — the single mapping boundary. */
const WX = (x) => -x;
const CAM_OFFSET = Object.freeze([0, 3.2, -5.5]);
const CAM_LOOK_AHEAD = 8;
const CAM_FOV = 62;
// V4/G67 (§G4.5): wind-rush loop id — feature-probed via getSfxDef so the
// layer stays dormant until a REAL loopable wind sample is committed and
// mapped (no synth recipe per the §C-SYS1.9.2 direction; sample request
// noted in public/assets/GoobyMusic/requests.md).
const WIND_SFX_ID = 'ambience.windRun';
const SKY = 0xffe1ec; //        pastel pink sky (distinct look — §C10.1 rule)
const LOOP_LEN = 132; //        scenery conveyor loop (m)
const BUILDINGS = ['building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F'];
const PASTELS = [0xffb3c7, 0xa8e6cf, 0xffe082, 0xb3d9ff, 0xe1bee7, 0xffccbc];

/** Uniform-scale a model so its bbox width (x) matches targetW. */
function fitWidth(model, targetW) {
  const box = new THREE.Box3().setFromObject(model);
  const w = Math.max(0.001, box.max.x - box.min.x);
  model.scale.multiplyScalar(targetW / w);
  return model;
}

/** Uniform-scale a model so its bbox height (y) matches targetH. */
function fitHeight(model, targetH) {
  const box = new THREE.Box3().setFromObject(model);
  const h = Math.max(0.001, box.max.y - box.min.y);
  model.scale.multiplyScalar(targetH / h);
  return model;
}

/** Ground a model: shift so its bbox bottom sits at y = 0. */
function ground(model) {
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  return model;
}

/** Cached striped-canvas textures (awnings/canopies). */
const stripeTexCache = new Map();
function stripeTexture(colorA, colorB) {
  const key = `${colorA}|${colorB}`;
  if (stripeTexCache.has(key)) return stripeTexCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const g = canvas.getContext('2d');
  for (let i = 0; i < 8; i += 1) {
    g.fillStyle = i % 2 === 0 ? colorA : colorB;
    g.fillRect(i * 8, 0, 8, 8);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  stripeTexCache.set(key, tex);
  return tex;
}

/** Cached canvas textures for floating "+N"/„Knapp!" text sprites. */
const floatTexCache = new Map();
function floatTexture(text, color) {
  const key = `${text}|${color}`;
  if (floatTexCache.has(key)) return floatTexCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = '900 38px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(74,59,54,0.85)';
  g.strokeText(text, 96, 34);
  g.fillStyle = color;
  g.fillText(text, 96, 34);
  const tex = new THREE.CanvasTexture(canvas);
  floatTexCache.set(key, tex);
  return tex;
}

// V4/G67 (§G4.4): 64×64 pavement texture — near-white with seam lines every
// 16 px so it tints through the existing road/sidewalk material colors. ONE
// texture drives both planes; update() scrolls `offset.y −= speed·dt/4`
// (repeat.y 60 over the 240 m planes = 4 m tile → world-true scroll rate).
function makePavementTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(74,59,54,0.16)';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 2); // seams every 16 px
  g.fillStyle = 'rgba(74,59,54,0.06)';
  g.fillRect(31, 0, 2, 64); // faint lengthwise joint
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 60);
  return tex;
}

/** @param {string} name @returns {string|null} dev-only URL param */
function devParam(name) {
  if (!import.meta.env?.DEV || typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}

export default {
  id: 'shoppingSurf',
  assetKeys: [
    ...BUILDINGS.map((b) => `kaykit-city/${b}_withoutBase`),
    'kaykit-city/box_A',
    'kaykit-city/box_B',
    'kaykit-city/bench',
    'kaykit-city/streetlight',
    'kaykit-city/firehydrant',
    'kaykit-city/trash_A',
    'kaykit-city/bush',
    'kaykit-characters/Knight',
    'kaykit-characters/Mage',
    'kaykit-characters/Rogue_Hooded',
  ],
  // V3/G32 §B2.3 warm-up — existing sfx ids only (no sfxMap edits, §E G37)
  sfx: [
    'whoosh', 'jump', 'slide', 'crash', 'crash.soft', 'coin.get', 'combo.up',
    'wash.splash', 'hop.bell', 'hopper.star', 'hopper.shieldPop', 'tramp.boost',
    'ui.toggleOff', 'jingle.arrival',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    const scene = ctx.scene;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 30, 86);
    scene.add(new THREE.HemisphereLight(0xfff3e6, 0xd9b8c4, 1.05));
    const sun = new THREE.DirectionalLight(0xfff0d8, 0.95);
    sun.position.set(-5, 10, -4);
    scene.add(sun);

    ctx.camera.fov = CAM_FOV;
    ctx.camera.position.set(...CAM_OFFSET);
    ctx.camera.lookAt(0, 1.0, CAM_LOOK_AHEAD);
    ctx.camera.updateProjectionMatrix();
    ctx.audio.music('city'); // street bustle context (existing id — §C3.3)

    // travel mode: G38 launches {mode:'surfTravel'} ('travel' canonical);
    // dev runs force it via ?mode=travel (reflected back like cityDrive so
    // the framework results screen picks the coins-only trip layout).
    let mode = isTravelMode(ctx.params.mode) ? ctx.params.mode : devParam('mode');
    mode = isTravelMode(mode) ? mode : 'arcade';
    if (mode !== 'arcade' && !isTravelMode(ctx.params.mode)) ctx.params.mode = mode;

    /** All internal state — dropped whole in dispose(). */
    const S = {
      ctx,
      mode,
      run: createRun({ rng: ctx.rng, mode }),
      pendingInput: {},
      phase: 'run', // 'run' | 'wipeout' | 'fanfare'
      phaseT: 0,
      shakeT: 0,
      shakeAmp: 0,
      lastShownScore: -1,
      slideVis: 0,
      speedLogT: 0,
      // visual registries (logic id → mesh/group)
      obVis: new Map(),
      puVis: new Map(),
      knocked: [], // {obj, vel, spin, t} crash debris
      floaters: [],
      pools: { cart: [], crate: [], npc: [], awning: [], puddle: [], gap: [] },
      puPools: { magnet: [], x2: [], shield: [], turbo: [] },
      npcSlots: [], // built once — animated first, frozen second (§E0.1-10)
      scenery: [],
      disposables: [], // procedural geos/mats/textures for dispose()
      autoplay: devParam('autoplay') === '1',
      speedlog: devParam('speedlog') === '1',
    };
    this.S = S;
    const D = (r) => {
      S.disposables.push(r);
      return r;
    };

    // ── street ground (V4/G67 §G4.4: planes carry ONE shared scrolling
    // pavement texture — the ground itself now communicates speed) ─────────
    S.groundTex = D(makePavementTexture());
    const road = new THREE.Mesh(
      D(new THREE.PlaneGeometry(6.4, 240)),
      D(new THREE.MeshLambertMaterial({ color: 0xe8cfd6, map: S.groundTex })) // rosy pavement
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, 60);
    scene.add(road);
    for (const sx of [-4.35, 4.35]) {
      const walk = new THREE.Mesh(
        D(new THREE.PlaneGeometry(2.3, 240)),
        D(new THREE.MeshLambertMaterial({ color: 0xf6e7d7, map: S.groundTex })) // cream sidewalk
      );
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(sx, 0.02, 60);
      scene.add(walk);
    }
    // curb strips separating walk/road
    for (const sx of [-3.15, 3.15]) {
      const curb = new THREE.Mesh(
        D(new THREE.BoxGeometry(0.16, 0.09, 240)),
        D(new THREE.MeshLambertMaterial({ color: 0xd8b8c0 }))
      );
      curb.position.set(sx, 0.045, 60);
      scene.add(curb);
    }
    // moving lane-divider dots (instanced — 1 draw call, sells the speed)
    const dotGeo = D(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 6));
    const dotMat = D(new THREE.MeshBasicMaterial({ color: 0xfff6ee }));
    S.laneDots = new THREE.InstancedMesh(dotGeo, dotMat, 60);
    S.laneDots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    S.dotOffset = 0;
    scene.add(S.laneDots);

    // ── scenery conveyor: pastel shop fronts + street props ────────────────
    const addScenery = (obj, x, z) => {
      obj.position.x = x;
      obj.position.z = z;
      scene.add(obj);
      S.scenery.push(obj);
    };
    const canopyGeo = D(new THREE.BoxGeometry(3.4, 0.12, 1.1));
    const canopyMats = [
      ['#ff8fab', '#fff1f4'], ['#7bd0a8', '#f0fff6'], ['#ffc94d', '#fff8e6'],
      ['#7db8ff', '#eef6ff'], ['#c58fff', '#f9f0ff'],
    ].map(([a, b]) => D(new THREE.MeshLambertMaterial({ map: stripeTexture(a, b) })));
    for (let i = 0; i < Math.floor(LOOP_LEN / 11); i += 1) {
      for (const side of [-1, 1]) {
        const name = BUILDINGS[(i * 2 + (side > 0 ? 1 : 0)) % BUILDINGS.length];
        const b = ground(fitWidth(ctx.assets.getModel(`kaykit-city/${name}_withoutBase`), 9));
        b.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        addScenery(b, side * 9.4, i * 11 + 3);
        // pastel shop awning canopy over the walk — the „shopping street" read
        const canopy = new THREE.Mesh(canopyGeo, canopyMats[(i * 2 + (side > 0 ? 1 : 0)) % canopyMats.length]);
        canopy.rotation.z = side * 0.12;
        addScenery(canopy, side * 4.4, i * 11 + 3);
        canopy.position.y = 2.5;
      }
    }
    const props = ['bench', 'firehydrant', 'trash_A', 'bush', 'bench', 'bush', 'trash_A', 'firehydrant'];
    for (let i = 0; i < props.length; i += 1) {
      const p = ground(fitHeight(ctx.assets.getModel(`kaykit-city/${props[i]}`), props[i] === 'bench' ? 0.6 : 0.7));
      p.rotation.y = (i % 2 === 0 ? 1 : -1) * Math.PI / 2;
      addScenery(p, (i % 2 === 0 ? -1 : 1) * 4.1, i * (LOOP_LEN / props.length) + 6);
    }
    for (let i = 0; i < 6; i += 1) {
      const l = ground(fitHeight(ctx.assets.getModel('kaykit-city/streetlight'), 3.1));
      l.rotation.y = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      addScenery(l, (i % 2 === 0 ? -1 : 1) * 3.7, i * (LOOP_LEN / 6) + 1.5);
    }
    // bunting flag lines across the street (single merged geometry each)
    const buntingGeo = D(buildBuntingGeometry());
    const buntingMat = D(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    for (let i = 0; i < 3; i += 1) {
      addScenery(new THREE.Mesh(buntingGeo, buntingMat), 0, i * (LOOP_LEN / 3) + 8);
    }

    // ── shared prototype resources for pooled entities ─────────────────────
    S.mats = {
      cartFrame: D(new THREE.MeshLambertMaterial({ color: 0x9aa7b8, wireframe: true })),
      cartBody: D(new THREE.MeshLambertMaterial({ color: 0xcdd8e6 })),
      cartGoods: D(new THREE.MeshLambertMaterial({ color: 0xffb3c7 })),
      wheel: D(new THREE.MeshLambertMaterial({ color: 0x4a3b36 })),
      post: D(new THREE.MeshLambertMaterial({ color: 0xb0552f })),
      awning: D(new THREE.MeshLambertMaterial({ map: stripeTexture('#ff6f91', '#fff5f7'), side: THREE.DoubleSide })),
      puddle: D(new THREE.MeshBasicMaterial({ color: 0x8fc8e8, transparent: true, opacity: 0.75 })),
      gap: D(new THREE.MeshLambertMaterial({ color: 0x3a3134 })),
      warn: D(new THREE.MeshBasicMaterial({ map: stripeTexture('#ffd166', '#4a3b36') })),
      dotLine: D(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 })),
      magnet: D(new THREE.MeshLambertMaterial({ color: 0xe63946 })),
      magnetTip: D(new THREE.MeshLambertMaterial({ color: 0xf1f1f1 })),
      shield: D(new THREE.MeshLambertMaterial({ color: 0x64b5f6, transparent: true, opacity: 0.38 })),
      carrot: D(new THREE.MeshLambertMaterial({ color: 0xff8c42 })),
      leaf: D(new THREE.MeshLambertMaterial({ color: 0x66bb6a })),
      arch: D(new THREE.MeshLambertMaterial({ color: 0xff8fab })),
    };
    S.geos = {
      cartBody: D(new THREE.BoxGeometry(0.95, 0.62, 0.95)),
      cartGoods: D(new THREE.BoxGeometry(0.7, 0.3, 0.7)),
      cartHandle: D(new THREE.BoxGeometry(1.0, 0.06, 0.06)),
      axle: D(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 8)),
      canopy: D(new THREE.BoxGeometry(1, 0.16, 0.5)),
      pole: D(new THREE.CylinderGeometry(0.05, 0.05, 1, 6)),
      puddle: D(new THREE.CircleGeometry(0.62, 14)),
      gap: D(new THREE.BoxGeometry(6.4, 0.5, 2.0)),
      warn: D(new THREE.BoxGeometry(6.4, 0.06, 0.18)),
      dot: D(new THREE.BoxGeometry(0.16, 0.02, 0.16)),
      magnetU: D(new THREE.TorusGeometry(0.24, 0.09, 8, 12, Math.PI)),
      magnetTip: D(new THREE.BoxGeometry(0.09, 0.14, 0.09)),
      bubble: D(new THREE.SphereGeometry(0.32, 12, 10)),
      carrot: D(new THREE.ConeGeometry(0.16, 0.5, 10)),
      leaf: D(new THREE.ConeGeometry(0.08, 0.2, 6)),
      pillar: D(new THREE.CylinderGeometry(0.16, 0.2, 3.2, 10)),
      archBar: D(new THREE.BoxGeometry(6.8, 0.5, 0.4)),
    };

    // coins: one InstancedMesh (§C8.7 instanced-coins rule)
    S.coinGeo = D(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 14));
    S.coinMat = D(new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.35, metalness: 0.55 }));
    S.coinMesh = new THREE.InstancedMesh(S.coinGeo, S.coinMat, 140);
    S.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    S.coinSpin = 0;
    scene.add(S.coinMesh);

    // ── NPC shoppers (§C8.3/§E0.1-10: exactly 1 actively-animated skinned
    // character; the second concurrent shopper is a frozen-pose clone) ──────
    const npcKeys = ['kaykit-characters/Knight', 'kaykit-characters/Mage', 'kaykit-characters/Rogue_Hooded'];
    for (let i = 0; i < 2; i += 1) {
      const key = npcKeys[Math.floor(ctx.rng() * npcKeys.length) % npcKeys.length];
      const model = ctx.assets.getSkinnedModel(key);
      fitHeight(model, 1.1); // ≈ scale 0.4 of the 2.7 m rig (§D2.1)
      ground(model);
      // V4/G57 (§G3.1-b): 180° flip — the WX render mirror makes the logic
      // +x crossing walk toward world −x, so the rig faces its walk direction.
      model.rotation.y = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(model);
      const clips = ctx.assets.getAnimations(key);
      const walk = clips.find((c) => c.name === 'Walking_A');
      const mixer = new THREE.AnimationMixer(model);
      if (walk) {
        const action = mixer.clipAction(walk);
        action.play();
        // slot 1+ = frozen mid-stride pose (perf cap): sample once, never update
        if (i > 0) mixer.setTime(0.4);
      }
      // §C8.3 dotted-line path telegraph across the street
      const line = new THREE.Group();
      for (let d = 0; d < 12; d += 1) {
        const dot = new THREE.Mesh(S.geos.dot, S.mats.dotLine);
        dot.position.set(-2.75 + d * 0.5, 0.04, 0);
        line.add(dot);
      }
      holder.add(line);
      S.npcSlots.push({ holder, mixer, animated: i === 0, line, busy: false });
    }

    // ── travel-mode finish arch (§C8.6) ─────────────────────────────────────
    if (isTravelMode(mode)) {
      const arch = new THREE.Group();
      for (const px of [-3.3, 3.3]) {
        const pillar = new THREE.Mesh(S.geos.pillar, S.mats.arch);
        pillar.position.set(px, 1.6, 0);
        arch.add(pillar);
      }
      const bar = new THREE.Mesh(S.geos.archBar, S.mats.awning);
      bar.position.y = 3.35;
      arch.add(bar);
      const sign = new THREE.Sprite(D(new THREE.SpriteMaterial({
        map: floatTexture(t('mg.surf.finish'), '#E63946'),
        transparent: true,
        depthWrite: false,
      })));
      sign.position.y = 4.1;
      sign.scale.set(3.4, 1.15, 1);
      arch.add(sign);
      arch.visible = false;
      scene.add(arch);
      S.arch = arch;
    }

    // ── Gooby (squashable rig, facing down-street) + particles ─────────────
    S.particles = createParticles(scene);
    S.gooby = createGooby({ particles: S.particles });
    applyEquippedOutfits(S.gooby);
    S.gooby.setEmotion('happy');
    S.gooby.play('happyBounce', { loop: true, speed: 1.7 });
    scene.add(S.gooby.group);

    // ── V4/G67 (PLAN4-GAMES §G4): speed-feel juice layer ────────────────────
    S.fx = {
      slowMoT: 0, //  §G4.6 near-miss slow-mo (REAL-time countdown)
      flashT: 0, //   §G4.6 vignette flash (REAL-time)
      seen: new Set(), // §G4.7 first-crossing milestone latch
      nextDistM: SURF_FX.DIST_EVERY_M, // §G4.7 arcade distance banners
      prevSpeed: S.run.speed,
      windT: 0, //    §G4.5 0.25 s gain-update cadence
      windGainNow: 0,
      wind: false,
    };
    // §G4.2: 24-streak pool as 2 InstancedMeshes (≤ 2 draw calls total)
    S.speedLines = createSpeedLines(scene, {
      textures: getStreakTextures(),
      pool: SURF_FX.STREAK_POOL,
      radius: SURF_FX.STREAK_RADIUS,
      ahead: SURF_FX.STREAK_AHEAD,
      size: SURF_FX.STREAK_SIZE,
      life: SURF_FX.STREAK_LIFE,
      velocityScale: SURF_FX.STREAK_VEL,
      forwardZ: 1, // render "ahead" = +z (§G3.1-b world)
      rng: ctx.rng,
    });
    // motion-blur-ish ghost trail on Gooby, fades in ≥ 13 m/s
    S.ghosts = createGhostTrail(scene);
    // §G4.6 vignette flash element (styles.css .g67-vignette)
    S.vignette = document.createElement('div');
    S.vignette.className = 'g67-vignette';
    (document.getElementById('ui') ?? document.body).appendChild(S.vignette);
    // §G4.5 wind layer: only when a real loop sample is mapped (see WIND_SFX_ID)
    if (getSfxDef(WIND_SFX_ID)) {
      ctx.audio.play(WIND_SFX_ID);
      ctx.audio.setLoopGain?.(WIND_SFX_ID, 0);
      S.fx.wind = true;
    }
    // ── end V4/G67 init ─────────────────────────────────────────────────────

    ctx.hud.setScore(0);
    ctx.hud.setTime(0);

    // ── input (§E5/§C8.2): swipes only — taps do nothing ───────────────────
    S.offSwipe = ctx.input.on('swipe', (p) => {
      if (S.phase !== 'run') return;
      if (p.dir === 'left') S.pendingInput.left = true;
      else if (p.dir === 'right') S.pendingInput.right = true;
      else if (p.dir === 'up') S.pendingInput.jump = true;
      else if (p.dir === 'down') S.pendingInput.slide = true;
    });

    if (import.meta.env?.DEV) window.__surf = { S }; // CDP probe (dev-only)
  },

  // -------------------------------------------------------------- pooling
  /** Acquire a pooled visual for a logic obstacle. */
  acquireObstacle(ob) {
    const S = this.S;
    const pool = S.pools[ob.kind];
    let vis = pool.pop();
    if (!vis) vis = this.buildObstacle(ob.kind);
    if (vis) {
      vis.visible = true;
      S.ctx.scene.add(vis);
    }
    return vis;
  },

  /** Build one visual for an obstacle kind (called on pool miss). */
  buildObstacle(kind) {
    const S = this.S;
    const { geos: G, mats: M, ctx } = S;
    const g = new THREE.Group();
    g.userData.kind = kind;
    if (kind === 'cart') {
      const basket = new THREE.Mesh(G.cartBody, M.cartFrame);
      basket.position.y = 0.55;
      const inner = new THREE.Mesh(G.cartBody, M.cartBody);
      inner.scale.set(0.92, 0.9, 0.92);
      inner.position.y = 0.53;
      const goods = new THREE.Mesh(G.cartGoods, M.cartGoods);
      goods.position.y = 0.9;
      const handle = new THREE.Mesh(G.cartHandle, M.wheel);
      handle.position.set(0, 1.02, 0.5);
      const axles = [];
      for (const az of [-0.35, 0.35]) {
        const axle = new THREE.Mesh(G.axle, M.wheel);
        axle.rotation.z = Math.PI / 2;
        axle.position.set(0, 0.13, az);
        axles.push(axle);
        g.add(axle);
      }
      g.userData.axles = axles;
      const bang = new THREE.Sprite(new THREE.SpriteMaterial({
        map: floatTexture('!', '#E63946'),
        transparent: true,
        depthWrite: false,
      }));
      S.disposables.push(bang.material);
      bang.position.y = 1.75;
      bang.scale.set(0.8, 0.35, 1);
      bang.visible = false;
      g.userData.bang = bang;
      g.add(basket, inner, goods, handle, bang);
    } else if (kind === 'crate') {
      const name = ctx.rng() < 0.5 ? 'box_A' : 'box_B';
      const a = ground(fitWidth(ctx.assets.getModel(`kaykit-city/${name}`), 1.15));
      const b = ground(fitWidth(ctx.assets.getModel(`kaykit-city/${name}`), 0.95));
      b.position.y = 1.0;
      b.rotation.y = 0.4;
      g.add(a, b);
    } else if (kind === 'npc') {
      const slot = S.npcSlots.find((s) => !s.busy) ?? S.npcSlots[S.npcSlots.length - 1];
      slot.busy = true;
      g.userData.slot = slot;
      g.add(slot.holder);
    } else if (kind === 'awning') {
      const canopy = new THREE.Mesh(G.canopy, M.awning);
      g.userData.canopy = canopy;
      const posts = [new THREE.Mesh(G.pole, M.post), new THREE.Mesh(G.pole, M.post)];
      g.userData.posts = posts;
      g.add(canopy, ...posts);
    } else if (kind === 'puddle') {
      const disc = new THREE.Mesh(G.puddle, M.puddle);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.03;
      g.add(disc);
    } else if (kind === 'gap') {
      const pit = new THREE.Mesh(G.gap, M.gap);
      pit.position.y = -0.26;
      const warnA = new THREE.Mesh(G.warn, M.warn);
      warnA.position.set(0, 0.04, -1.05);
      const warnB = new THREE.Mesh(G.warn, M.warn);
      warnB.position.set(0, 0.04, 1.05);
      g.add(pit, warnA, warnB);
    }
    return g;
  },

  /** Return an obstacle visual to its pool. */
  releaseObstacle(vis) {
    const S = this.S;
    if (!vis) return;
    if (vis.userData.slot) {
      vis.userData.slot.busy = false;
      vis.userData.slot.line.visible = true;
    }
    if (vis.userData.bang) vis.userData.bang.visible = false;
    vis.visible = false;
    S.ctx.scene.remove(vis);
    S.pools[vis.userData.kind].push(vis);
  },

  /** Acquire a pooled powerup visual. */
  acquirePowerup(kind) {
    const S = this.S;
    const { geos: G, mats: M } = S;
    let vis = S.puPools[kind].pop();
    if (!vis) {
      vis = new THREE.Group();
      vis.userData.kind = kind;
      if (kind === 'magnet') {
        const u = new THREE.Mesh(G.magnetU, M.magnet);
        u.rotation.z = Math.PI;
        for (const px of [-0.24, 0.24]) {
          const tip = new THREE.Mesh(G.magnetTip, M.magnetTip);
          tip.position.set(px, 0.28, 0);
          vis.add(tip);
        }
        vis.add(u);
      } else if (kind === 'x2') {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: floatTexture('×2', '#FFD166'),
          transparent: true,
          depthWrite: false,
        }));
        S.disposables.push(spr.material);
        spr.scale.set(1.0, 0.5, 1);
        vis.add(spr);
      } else if (kind === 'shield') {
        vis.add(new THREE.Mesh(G.bubble, M.shield));
      } else {
        const c = new THREE.Mesh(G.carrot, M.carrot);
        c.rotation.x = Math.PI;
        const leaf = new THREE.Mesh(G.leaf, M.leaf);
        leaf.position.y = 0.32;
        vis.add(c, leaf);
      }
    }
    vis.visible = true;
    S.ctx.scene.add(vis);
    return vis;
  },

  // ---------------------------------------------------------------- juice
  /** Floating text at a world position (dt-driven, pause-safe). */
  floatText(text, color, pos) {
    const S = this.S;
    const mat = new THREE.SpriteMaterial({ map: floatTexture(text, color), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(clampFloatTextToView(pos.clone(), S.ctx.camera, { halfW: 0.55, halfH: 0.23 }));
    sprite.scale.set(1.15, 0.42, 1);
    S.ctx.scene.add(sprite);
    S.floaters.push({ sprite, mat, t: 0, life: 0.85 });
  },

  shake(amp) {
    this.S.shakeT = 1;
    this.S.shakeAmp = Math.max(this.S.shakeAmp, amp);
  },

  /** Crash juice: knock the obstacle visual aside like runner's debris. */
  knock(id) {
    const S = this.S;
    const vis = S.obVis.get(id);
    if (!vis || vis.userData.kind === 'gap' || vis.userData.kind === 'npc' || vis.userData.kind === 'awning') return;
    S.obVis.delete(id);
    S.obVis.set(id, null); // logic entity stays — mark as visually consumed
    S.knocked.push({
      obj: vis,
      vel: new THREE.Vector3((S.ctx.rng() < 0.5 ? -1 : 1) * (3 + S.ctx.rng() * 2), 4.5, -1.5),
      spin: (S.ctx.rng() - 0.5) * 12,
      t: 0,
    });
  },

  // -------------------------------------------------------------- events
  /** Map one logic event onto sfx / particles / HUD juice. */
  handleEvent(ev) {
    const S = this.S;
    const { ctx, run } = S;
    switch (ev.type) {
      case 'lane':
        ctx.audio.play('whoosh');
        break;
      case 'jump':
        ctx.audio.play('jump');
        S.gooby.play('jump', { speed: 0.6 / SURF.JUMP_SEC });
        break;
      case 'slide':
        ctx.audio.play('slide');
        break;
      case 'fastDrop':
        ctx.audio.play('whoosh');
        break;
      case 'land':
        S.gooby.play('happyBounce', { loop: true, speed: 1.7 });
        break;
      case 'telegraph': // §C8.3 cart rattle + visual 0.9 s out
        ctx.audio.play('hop.bell');
        S.obVis.get(ev.id)?.userData.bang && (S.obVis.get(ev.id).userData.bang.visible = true);
        break;
      case 'puddle':
        ctx.audio.play('wash.splash');
        S.particles.emit('sparkles', S.gooby.group.position.clone().setY(0.3), { count: 6 });
        break;
      case 'nearMiss': {
        ctx.audio.play('combo.up');
        // V4/G67 §G4.6: slow-mo 0.55× for 0.18 s REAL time — a nearMiss
        // during slow-mo only REFRESHES the timer (never stacks) — plus the
        // 8 %-white vignette flash for 0.12 s.
        S.fx.slowMoT = SURF_FX.SLOWMO_SEC;
        S.fx.flashT = SURF_FX.FLASH_SEC;
        S.vignette?.classList.add('g67-flash');
        const pos = S.gooby.group.position.clone().add(new THREE.Vector3(0, 1.7, 0.6));
        this.floatText(`+2 ${t('mg.surf.nearMiss')}`, '#FFD166', pos);
        if (ev.streak > 0 && ev.streak % 3 === 0) {
          ctx.hud.banner(t('mg.surf.nearStreak', { n: ev.streak }));
        }
        break;
      }
      case 'coin':
        ctx.audio.play('coin.get');
        S.particles.emit('sparkles', new THREE.Vector3(WX(ev.x), ev.y + 0.2, -ev.z), { count: 3 }); // V4/G57 §G3.1-b
        if (ev.value > 1) this.floatText('+2', '#FFD166', new THREE.Vector3(WX(ev.x), ev.y + 0.6, -ev.z));
        break;
      case 'powerup':
        ctx.audio.play(ev.kind === 'turbo' ? 'tramp.boost' : 'hopper.star');
        ctx.hud.banner(t(`mg.surf.${ev.kind}`));
        S.particles.emit('confetti', S.gooby.group.position.clone().setY(1.4), { count: 10 });
        break;
      case 'powerupEnd':
        ctx.audio.play('ui.toggleOff');
        break;
      case 'shieldPop':
        ctx.audio.play('hopper.shieldPop');
        ctx.hud.banner(t('mg.surf.shieldPop'));
        this.knock(ev.id);
        this.shake(0.14);
        break;
      case 'crash':
        this.knock(ev.id);
        S.gooby.setEmotion('sad');
        S.gooby.play('pokeWobble', { dir: { x: 0, z: 1 } });
        S.recoverT = 1.0;
        if (run.ended) break; // wipeout event follows with the big juice
        ctx.audio.play('crash.soft');
        this.shake(0.16);
        ctx.hud.banner(t('mg.surf.stumble'));
        break;
      case 'wipeout': // arcade 3rd crash (§C8.3)
        ctx.audio.play('crash');
        this.shake(0.3);
        ctx.hud.banner(t('mg.surf.wipeout'));
        S.gooby.setEmotion('dizzy');
        S.gooby.play('dizzy');
        S.phase = 'wipeout';
        S.phaseT = 1.3;
        break;
      case 'jogStart': // §C8.6 forgiveness jog
        ctx.hud.banner(t('mg.surf.jog'));
        S.gooby.setEmotion('happy');
        break;
      case 'finish': { // §C8.6 finish arch → arrival handoff
        ctx.audio.play('jingle.arrival');
        S.gooby.setEmotion('ecstatic');
        S.gooby.play('dance', { loop: true });
        S.particles.emit('confetti', S.gooby.group.position.clone().setY(2.2), { count: 26 });
        const reward = travelReward(ev.coinsCollected, ev.crashes);
        if (reward.clean) ctx.hud.banner(t('mg.surf.cleanRun', { coins: SURF.TRAVEL.CLEAN_BONUS }));
        S.result = {
          coins: reward.coins,
          coinsCollected: ev.coinsCollected,
          crashes: ev.crashes,
          clean: reward.clean,
          distanceM: Math.round(S.run.distanceM),
          surfRun: true,
        };
        // hand off to the §C8.6 trip machine BEFORE the results screen —
        // rewards are then paid via the framework's onEnd coins override
        ctx.params.onArrive?.(S.result);
        S.phase = 'fanfare';
        S.phaseT = 1.7;
        break;
      }
      default:
        break;
    }
  },

  // -------------------------------------------------------------- update
  /**
   * @param {number} dt seconds (framework skips pauses)
   * @param {number} elapsed running seconds
   */
  update(dt, elapsed) {
    const S = this.S;
    if (!S) return;
    const { ctx, run } = S;

    // ── V4/G67 §G4.6: near-miss slow-mo — scale the dt fed into stepRun AND
    // all visual updates (logic stays deterministic: dt is an input). The
    // timers below tick in REAL time so 0.18 s means 0.18 s of wall clock.
    const realDt = dt;
    if (S.fx.slowMoT > 0) {
      S.fx.slowMoT = Math.max(0, S.fx.slowMoT - realDt);
      dt *= SURF_FX.SLOWMO_SCALE;
    }
    if (S.fx.flashT > 0) {
      S.fx.flashT -= realDt;
      if (S.fx.flashT <= 0) S.vignette?.classList.remove('g67-flash');
    }

    // ── advance the pure simulation ─────────────────────────────────────────
    if (S.phase === 'run') {
      let input = S.pendingInput;
      if (S.autoplay) {
        const bot = botInput(run);
        input = { ...bot, ...input };
      }
      S.pendingInput = {};
      const events = stepRun(run, Math.min(dt, 0.1), input);
      for (const ev of events) {
        if (ev.type === 'spawn') S.obVis.set(ev.ob.id, this.acquireObstacle(ev.ob));
        else this.handleEvent(ev);
      }
      if (S.speedlog) {
        S.speedLogT -= dt;
        if (S.speedLogT <= 0) {
          S.speedLogT = 5;
          console.log(`[surf] t=${elapsed.toFixed(1)}s speed=${run.speed.toFixed(2)} m/s dist=${run.distanceM.toFixed(0)}m`);
        }
      }
    } else {
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        if (S.phase === 'wipeout') {
          S.phase = 'done';
          const score = runScore(run);
          if (S.autoplay) {
            console.log(`[autoplay] shoppingSurf score=${score} dist=${Math.round(run.distanceM)} coins=${run.coins} near=${run.nearMisses}`);
          }
          ctx.onEnd({ score, meta: runMeta(run) }); // arcade: row 40/5/34
        } else if (S.phase === 'fanfare') {
          S.phase = 'done';
          if (S.autoplay) {
            console.log(`[autoplay] shoppingSurf travel coins=${S.result.coins} collected=${S.result.coinsCollected} crashes=${S.result.crashes}`);
          }
          // §C8.6: collected coins ARE the reward (framework coinsOverride)
          ctx.onEnd({ score: S.result.coins, coins: S.result.coins, meta: runMeta(run) });
        }
        return;
      }
    }
    if (S.phase === 'done') return;

    const speed = S.phase === 'run' ? run.speed : 0;
    const px = playerX(run);
    const py = playerY(run);
    const sliding = run.slideT >= 0;

    // ── V4/G67 §G4.7: milestone banners — "Schneller! 🔥" at the first
    // crossing of 10/12/14 m/s, "VOLLGAS!!" at 16, plus every 250 m in
    // arcade mode (the framework banner queue handles collisions).
    if (S.phase === 'run') {
      for (const th of crossedMilestones(S.fx.prevSpeed, run.speed, SURF_FX.MILESTONES, S.fx.seen)) {
        S.fx.seen.add(th);
        ctx.audio.play('combo.up');
        ctx.hud.banner(t(th >= SURF.MAX_SPEED ? 'mg.speedfx.top' : 'mg.speedfx.up'));
      }
      S.fx.prevSpeed = run.speed;
      if (S.mode === 'arcade' && run.distanceM >= S.fx.nextDistM) {
        ctx.hud.banner(t('mg.surf.distance', { m: S.fx.nextDistM }));
        S.fx.nextDistM += SURF_FX.DIST_EVERY_M;
      }
    }

    // ── player: position, slide squash, tilt ────────────────────────────────
    const squash = sliding ? SURF.SLIDE_HEIGHT / SURF.STAND_HEIGHT : 1;
    const sq = S.gooby.group.scale;
    sq.y += (squash - sq.y) * Math.min(1, dt * 16);
    sq.x = sq.z = 1 + (1 - sq.y) * 0.55;
    S.gooby.group.position.set(WX(px), py, 0); // V4/G57 §G3.1-b render mirror
    S.gooby.group.rotation.z = (WX(SURF.LANE_X[run.lane]) - WX(px)) * -0.22; // lean sign mirrored with the axis
    S.gooby.update(dt);
    S.particles.update(dt);
    if (S.recoverT != null && S.recoverT > 0) {
      S.recoverT -= dt;
      if (S.recoverT <= 0 && S.phase === 'run') S.gooby.setEmotion('happy');
    }
    // shield bubble follows the player
    if (run.pu.shield && !S.shieldVis) {
      S.shieldVis = new THREE.Mesh(S.geos.bubble, S.mats.shield);
      S.shieldVis.scale.setScalar(2.2);
      ctx.scene.add(S.shieldVis);
    } else if (!run.pu.shield && S.shieldVis) {
      ctx.scene.remove(S.shieldVis);
      S.shieldVis = null;
    }
    if (S.shieldVis) S.shieldVis.position.set(WX(px), py + 0.75, 0); // V4/G57 §G3.1-b

    // ── scenery conveyor ────────────────────────────────────────────────────
    S.groundTex.offset.y -= (speed * dt) / SURF_FX.GROUND_SCROLL_DIV; // V4/G67 §G4.4
    for (const obj of S.scenery) {
      obj.position.z -= speed * dt;
      if (obj.position.z < -14) obj.position.z += LOOP_LEN;
    }
    // lane-divider dots (visual z ahead = +)
    S.dotOffset = (S.dotOffset + speed * dt) % 4;
    const m4 = new THREE.Matrix4();
    let di = 0;
    for (let row = 0; row < 30; row += 1) {
      const z = row * 4 - S.dotOffset - 6;
      for (const dx of [-0.8, 0.8]) {
        m4.setPosition(dx, 0.03, z);
        S.laneDots.setMatrixAt(di, m4);
        di += 1;
      }
    }
    S.laneDots.count = di;
    S.laneDots.instanceMatrix.needsUpdate = true;

    // ── obstacles: sync visuals to logic entities ───────────────────────────
    const live = new Set();
    for (const ob of run.obstacles) {
      live.add(ob.id);
      let vis = S.obVis.get(ob.id);
      if (vis === undefined) {
        vis = this.acquireObstacle(ob);
        S.obVis.set(ob.id, vis);
      }
      if (!vis) continue; // knocked debris — logic entity still despawning
      vis.position.set(WX(ob.x), 0, -ob.z); // V4/G57 §G3.1-b render mirror
      if (ob.kind === 'cart') {
        for (const axle of vis.userData.axles) axle.rotation.x += (speed + 2) * dt * 2.2;
      } else if (ob.kind === 'npc') {
        const slot = vis.userData.slot;
        if (slot.animated) slot.mixer.update(dt);
        slot.line.position.x = -WX(ob.x); // dotted line stays street-centered (V4/G57: mirrored parent)
        slot.line.visible = ob.z < -2; //  telegraph until the shopper is close
      } else if (ob.kind === 'awning') {
        // stretch canopy + posts over the def's lanes
        const lanes = ob.lanes ?? [1];
        const w = ob.halfW * 2;
        vis.userData.canopy.scale.set(w, 1, 1);
        vis.userData.canopy.position.y = SURF.OBSTACLES.awning.gapY + 0.1;
        vis.userData.posts[0].position.set(-w / 2 + 0.06, (SURF.OBSTACLES.awning.gapY + 0.1) / 2, 0);
        vis.userData.posts[1].position.set(w / 2 - 0.06, (SURF.OBSTACLES.awning.gapY + 0.1) / 2, 0);
        vis.userData.posts[0].scale.y = vis.userData.posts[1].scale.y = SURF.OBSTACLES.awning.gapY + 0.1;
        void lanes;
      }
    }
    for (const [id, vis] of S.obVis) {
      if (!live.has(id)) {
        this.releaseObstacle(vis);
        S.obVis.delete(id);
      }
    }

    // ── coins (instanced) ───────────────────────────────────────────────────
    S.coinSpin += dt * 4;
    const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationY(S.coinSpin));
    let ci = 0;
    for (const c of run.coinItems) {
      if (ci >= 140) break;
      m4.copy(rot).setPosition(WX(c.x), c.y, -c.z); // V4/G57 §G3.1-b
      S.coinMesh.setMatrixAt(ci, m4);
      ci += 1;
    }
    S.coinMesh.count = ci;
    S.coinMesh.instanceMatrix.needsUpdate = true;

    // ── powerup pickups ─────────────────────────────────────────────────────
    const puLive = new Set();
    for (const p of run.powerupItems) {
      puLive.add(p.id);
      let vis = S.puVis.get(p.id);
      if (!vis) {
        vis = this.acquirePowerup(p.kind);
        S.puVis.set(p.id, vis);
      }
      vis.position.set(WX(p.x), 1.0 + Math.sin(S.coinSpin + p.id) * 0.12, -p.z); // V4/G57 §G3.1-b
      vis.rotation.y += dt * 2.4;
    }
    for (const [id, vis] of S.puVis) {
      if (!puLive.has(id)) {
        vis.visible = false;
        ctx.scene.remove(vis);
        S.puPools[vis.userData.kind].push(vis);
        S.puVis.delete(id);
      }
    }

    // ── travel finish arch approaches ───────────────────────────────────────
    if (S.arch) {
      const zv = SURF.TRAVEL.DISTANCE_M - run.distanceM;
      S.arch.visible = zv < 95 && zv > -8;
      S.arch.position.z = zv;
    }

    // ── knocked debris + floaters ───────────────────────────────────────────
    for (let i = S.knocked.length - 1; i >= 0; i -= 1) {
      const kn = S.knocked[i];
      kn.t += dt;
      kn.vel.y -= 12 * dt;
      kn.obj.position.addScaledVector(kn.vel, dt);
      kn.obj.position.z -= speed * dt;
      kn.obj.rotation.x += kn.spin * dt;
      kn.obj.rotation.z += kn.spin * 0.6 * dt;
      if (kn.t > 1.2 || kn.obj.position.z < -5) {
        kn.obj.rotation.set(0, 0, 0);
        this.releaseObstacle(kn.obj);
        S.knocked.splice(i, 1);
      }
    }
    for (let i = S.floaters.length - 1; i >= 0; i -= 1) {
      const f = S.floaters[i];
      f.t += dt;
      f.sprite.position.y += dt * 1.3;
      f.mat.opacity = 1 - (f.t / f.life) ** 2;
      if (f.t >= f.life) {
        ctx.scene.remove(f.sprite);
        f.mat.dispose();
        S.floaters.splice(i, 1);
      }
    }

    // ── camera: §C8.1 offset + lane follow, micro-shake, §G4 speed juice ───
    S.shakeT = Math.max(0, S.shakeT - dt * 3.2);
    const shake = S.shakeT > 0 ? S.shakeAmp * S.shakeT : 0;
    if (S.shakeT <= 0) S.shakeAmp = 0;
    // V4/G67 §G4.3: continuous top-speed jitter (0.035, fading in 15→16 m/s)
    // ADDED to the crash-shake term — crash shake still dominates at 0.16+.
    const jitter = shake + topSpeedShake(speed, SURF_FX.SHAKE_FROM, SURF_FX.SHAKE_TO, SURF_FX.SHAKE_AMP);
    const camX = WX(px) * 0.35; // V4/G57 §G3.1-b: cam follows the RENDERED x
    ctx.camera.position.set(
      camX + (Math.random() - 0.5) * jitter,
      CAM_OFFSET[1] + (Math.random() - 0.5) * jitter,
      CAM_OFFSET[2]
    );
    ctx.camera.lookAt(camX, 1.0, CAM_LOOK_AHEAD);
    // V4/G67 §G4.1: speed-scaled FOV kick 62→72 over 8→16 m/s; the turbo
    // kick is ADDITIVE (+8) on top, hard cap 78; lerp k = 5/s; projection
    // matrix updated only when |Δfov| > 0.01 (existing pattern).
    const targetFov = Math.min(
      SURF_FX.FOV_CAP,
      speedFovTarget(CAM_FOV, SURF_FX.FOV_KICK, speed, SURF_FX.BAND[0], SURF_FX.BAND[1])
        + (run.pu.turboT > 0 ? SURF_FX.TURBO_ADD : 0)
    );
    if (Math.abs(ctx.camera.fov - targetFov) > 0.01) {
      ctx.camera.fov = fovLerp(ctx.camera.fov, targetFov, dt, SURF_FX.LERP_K);
      ctx.camera.updateProjectionMatrix();
    }
    // V4/G67 §G4.2: speed-line ring — spawn rate ∝ speed (0/s below 10 m/s)
    const rate = streakRate(speed, SURF_FX.RATE);
    S.speedLines.update(dt, { speed, rate, originX: camX, originY: SURF_FX.STREAK_ORIGIN_Y });
    // V4/G67: ghost trail on Gooby (subtle motion blur, fades in ≥ 13 m/s)
    S.ghosts.update(dt, {
      x: WX(px), // V4/G57 §G3.1-b render mirror
      y: py + 0.55,
      strength: ghostStrength(speed, SURF_FX.GHOST_BAND[0], SURF_FX.GHOST_BAND[1]),
    });
    // V4/G67 §G4.5: wind-rush gain (0→0.5 over 10→16 m/s) every 0.25 s
    S.fx.windT -= realDt;
    if (S.fx.windT <= 0) {
      S.fx.windT = SURF_FX.WIND_UPDATE_SEC;
      S.fx.windGainNow = windGain(speed, SURF_FX.WIND[0], SURF_FX.WIND[1], SURF_FX.WIND[2]);
      if (S.fx.wind) ctx.audio.setLoopGain?.(WIND_SFX_ID, S.fx.windGainNow);
    }
    if (import.meta.env?.DEV) {
      // CDP telemetry (window.__surf.S.fxDebug) — §G10-1 evidence surface
      S.fxDebug = {
        speed,
        fov: ctx.camera.fov,
        rate,
        streaks: S.speedLines.activeCount(),
        streakDrawCalls: S.speedLines.drawCalls(),
        windGain: S.fx.windGainNow,
        slowMoT: S.fx.slowMoT,
        shake: jitter,
        drawCalls: ctx.renderer?.info?.render?.calls ?? 0,
      };
    }

    // ── HUD ─────────────────────────────────────────────────────────────────
    const score = S.mode === 'arcade' ? runScore(run) : run.coins;
    if (score !== S.lastShownScore) {
      S.lastShownScore = score;
      ctx.hud.setScore(score);
    }
    if (S.mode === 'arcade') {
      ctx.hud.setTime(elapsed);
    } else {
      const remaining = Math.max(0, SURF.TRAVEL.DISTANCE_M - run.distanceM);
      ctx.hud.setTime(remaining / Math.max(4, speed || 1));
    }
  },

  dispose() {
    const S = this.S;
    if (!S) return;
    S.offSwipe?.();
    // V4/G67: juice teardown — streak pool, ghosts, vignette, wind loop
    S.speedLines?.dispose();
    S.ghosts?.dispose();
    S.vignette?.remove();
    if (S.fx?.wind) S.ctx.audio.stop(WIND_SFX_ID);
    S.gooby?.dispose();
    S.particles?.dispose();
    for (const f of S.floaters) f.mat.dispose();
    for (const slot of S.npcSlots) slot.mixer.stopAllAction();
    for (const r of S.disposables) r.dispose?.();
    if (import.meta.env?.DEV) delete window.__surf;
    // asset clones share cached geometry/materials — the framework's scene
    // disposal sweeps the rest (§E8).
    this.S = null;
  },
};

/** One bunting line: pastel triangle flags on a drooping wire (1 mesh). */
function buildBuntingGeometry() {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  const flags = 11;
  for (let i = 0; i < flags; i += 1) {
    const x = -5 + (10 / (flags - 1)) * i;
    const droop = 3.6 - Math.cos((x / 5) * (Math.PI / 2)) * -0.5 - (1 - (x / 5) ** 2) * 0.55;
    color.set(PASTELS[i % PASTELS.length]);
    positions.push(x - 0.22, droop, 0, x + 0.22, droop, 0, x, droop - 0.42, 0);
    for (let v = 0; v < 3; v += 1) colors.push(color.r, color.g, color.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
