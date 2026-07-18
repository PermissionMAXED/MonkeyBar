// Ghost Hunt (PLAN3 §C10.1 #2, agent V3/G41): spooky-CUTE seek-and-tap in a
// KayKit-Halloween graveyard-garden at dusk. Sheet-ghosts peek from graves,
// pumpkins and the crypt on ramping timers (2.2 s → 0.9 s); tap = catch +3
// with chain bonuses; flickering pumpkin-lantern decoys punish −2; Boo-waves
// every 25 s; Laterne/Netz powerup tokens. 90 s round.
//
// ALL hunt math lives in ghostHunt.logic.js (§B8 purity) — this module
// renders that state machine 1:1: taps feed tapHunt(), the per-frame rig
// sync mirrors state.ghosts/flickers/tokens, and the event queue becomes
// sfx/banners. Distinct look (§C10.1): dusk graveyard purple-orange — no
// palette collision with the daylight games. Ghosts are procedural
// sheet-ghosts per §E0.1-10 (cloth-lathe + canvas face, cute — NOT library
// models).
//
// Dev flags: ?autoplay=1 (logic bot taps — §C10.1 strategy).

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import { createParticles } from '../../gfx/particles.js';
import { clampFloatTextToView } from '../framework.js';
import {
  HUNT,
  SPOTS,
  DECOY_SPOTS,
  TOKEN_ANCHORS,
  createHunt,
  stepHunt,
  tapHunt,
  botStep,
  huntScore,
  runMeta,
} from './ghostHunt.logic.js';

const HW = 'kaykit-halloween';
const SKY = '#2A1E42'; // dusk purple (distinct-look rule §C10.1)
const GRAVE_MODELS = ['grave_A', 'grave_B', 'gravestone'];

/** easeOutBack — cute overshoot for the ghost pop. @param {number} x 0..1 */
function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** Uniform-scale a model so its largest bbox dimension matches target. */
function fitMax(model, target) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(target / (Math.max(size.x, size.y, size.z) || 1));
  return model;
}

/** Sheet-ghost lathe geometry (§E0.1-10: cloth-sphere + wavy hem, cute). */
function sheetGeometry() {
  const pts = [
    new THREE.Vector2(0.0, 0.62),
    new THREE.Vector2(0.12, 0.6),
    new THREE.Vector2(0.21, 0.52),
    new THREE.Vector2(0.26, 0.41),
    new THREE.Vector2(0.27, 0.28),
    new THREE.Vector2(0.25, 0.16),
    new THREE.Vector2(0.29, 0.06),
    new THREE.Vector2(0.29, 0.0),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  // wavy hem: scallop the bottom ring like a fluttering bedsheet
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    if (y < 0.08) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, y - (Math.sin(ang * 6) + 1) * 0.03);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Canvas face for the sheet-ghost: big glinty eyes + o-mouth + blush. */
function faceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#25203A';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(64 + sx * 22, 52, 11, 15, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#FFFFFF';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(64 + sx * 22 - 3, 46, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#25203A';
  g.beginPath();
  g.ellipse(64, 82, 7, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(242, 160, 181, 0.75)';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(64 + sx * 40, 74, 9, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

/** Soft radial glow (white — tinted per-sprite via material.color). */
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** Dusk horizon gradient (orange glow melting into the purple night). */
function duskTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#241A3D');
  grad.addColorStop(0.45, '#4A2E5C');
  grad.addColorStop(0.78, '#A34E5B');
  grad.addColorStop(1, '#E8814E');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(canvas);
}

/** Tiny floating score/text sprites (canvas textures, self-disposing). */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#FFF6EC') {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 72;
      const g = canvas.getContext('2d');
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(30,22,50,0.85)';
      g.strokeText(text, 96, 36);
      g.fillStyle = color;
      g.fillText(text, 96, 36);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.8, halfH: 0.3 }));
      sprite.scale.set(1.6, 0.6, 1);
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

/** @type {object} §E8 plugin */
export default {
  id: 'ghostHunt',
  // §D2.4: the full 18-piece kaykit-halloween set dresses the yard
  assetKeys: [
    `${HW}/grave_A`,
    `${HW}/grave_B`,
    `${HW}/gravestone`,
    `${HW}/gravemarker_A`,
    `${HW}/gravemarker_B`,
    `${HW}/crypt`,
    `${HW}/coffin_decorated`,
    `${HW}/fence_seperate`,
    `${HW}/fence_gate`,
    `${HW}/floor_dirt_grave`,
    `${HW}/lantern_standing`,
    `${HW}/lantern_hanging`,
    `${HW}/pumpkin_orange`,
    `${HW}/pumpkin_orange_jackolantern`,
    `${HW}/pumpkin_orange_small`,
    `${HW}/pumpkin_yellow_small`,
    `${HW}/tree_dead_large`,
    `${HW}/tree_pine_orange_small`,
  ],
  // V3/G32 §B2.3 sample warm-up (ids mapped in the V3/G41 sfxMap block)
  sfx: [
    'hunt.spawn', 'hunt.catch', 'hunt.chain', 'hunt.decoy', 'hunt.gone',
    'hunt.boo', 'hunt.booBonus', 'hunt.powerup', 'hunt.token', 'ui.win',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    const seed = Number.isFinite(ctx.params?.seed) ? ctx.params.seed : Math.floor(ctx.rng() * 2 ** 31);
    this.hunt = createHunt(seed);
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.endT = 0;
    this.shownScore = 0;
    this.grumpyT = 0;

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
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 13, 30);

    // dusk light rig: cool moonlight + warm lantern point (purple-orange)
    scene.add(new THREE.HemisphereLight(0xb9a5e8, 0x4a3a34, 1.05));
    const moonLight = new THREE.DirectionalLight(0x9db8ff, 0.55);
    moonLight.position.set(-4, 10, -6);
    scene.add(moonLight);
    const lanternLight = new THREE.PointLight(0xffb066, 22, 14, 1.8);
    lanternLight.position.set(0, 2.2, -2.4);
    scene.add(lanternLight);

    // portrait framing: high camera looking down the −z garden
    const camera = ctx.camera;
    camera.fov = 55;
    camera.updateProjectionMatrix();
    camera.position.set(0, 7.9, 3.2);
    camera.lookAt(0, 0.35, -3.9);

    // --- ground + horizon glow + moon ---
    const ground = own(new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshStandardMaterial({ color: '#33473A', roughness: 1 })
    ));
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -6;
    scene.add(ground);

    const duskTex = duskTexture();
    this.ownedTex.push(duskTex);
    const horizon = own(new THREE.Mesh(
      new THREE.PlaneGeometry(70, 26),
      new THREE.MeshBasicMaterial({ map: duskTex, fog: false })
    ));
    horizon.position.set(0, 10, -26);
    scene.add(horizon);

    const moon = own(new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 32),
      new THREE.MeshBasicMaterial({ color: '#FFF3C9', fog: false })
    ));
    moon.position.set(-6.5, 13.5, -25.5);
    scene.add(moon);

    // --- graveyard-garden set dressing (all 18 §D2.4 pieces) ---
    const place = (key, x, z, { rotY = Math.PI, size = null, y = 0 } = {}) => {
      const m = ctx.assets.getModel(`${HW}/${key}`);
      if (size) fitMax(m, size);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      scene.add(m);
      return m;
    };

    // hiding props on the ghost spots (§C10.1: graves / pumpkins / crypt)
    let graveIdx = 0;
    for (const spot of SPOTS) {
      if (spot.kind === 'grave') {
        place(GRAVE_MODELS[graveIdx % GRAVE_MODELS.length], spot.x, spot.z + 0.14, {
          size: 0.85,
          rotY: Math.PI + (graveIdx % 2 ? 0.12 : -0.1),
        });
        if (graveIdx % 2 === 0) place('floor_dirt_grave', spot.x, spot.z + 0.55, { size: 0.9 });
        graveIdx += 1;
      } else if (spot.kind === 'pumpkin') {
        place('pumpkin_orange', spot.x, spot.z + 0.14, { size: 0.55 });
      } else {
        place('crypt', spot.x, spot.z - 0.75, { size: 3.1 });
      }
    }
    // markers, coffin, trees, fence, gate, lanterns, pumpkin clutter (the
    // portrait frustum is narrow — everything sits inside |ndc x| ≲ 1)
    place('gravemarker_A', -2.9, -2.6, { size: 0.6, rotY: Math.PI - 0.2 });
    place('gravemarker_B', 2.9, -2.8, { size: 0.6, rotY: Math.PI + 0.25 });
    place('coffin_decorated', 1.8, -6.6, { size: 1.1, rotY: Math.PI - 0.5 });
    place('tree_dead_large', -3.1, -7.3, { size: 3.4 });
    place('tree_dead_large', 3.2, -7.0, { size: 3.0, rotY: Math.PI / 3 });
    place('tree_pine_orange_small', -2.8, -6.05, { size: 1.6 });
    place('tree_pine_orange_small', 2.9, -5.75, { size: 1.5 });
    for (let i = 0; i < 7; i += 1) {
      if (i === 1) place('fence_gate', -3.9 + i * 1.3, -7.9, { size: 1.5 });
      else place('fence_seperate', -3.9 + i * 1.3, -7.9, { size: 1.35 });
    }
    for (const z of [-3.7, -5.5]) {
      place('fence_seperate', -3.3, z, { size: 1.35, rotY: Math.PI / 2 });
      place('fence_seperate', 3.3, z, { size: 1.35, rotY: -Math.PI / 2 });
    }
    place('lantern_standing', -0.7, -0.5, { size: 1.15 });
    place('lantern_standing', 2.4, -6.7, { size: 1.15 });
    place('lantern_hanging', 3.05, -6.55, { size: 0.5, y: 1.7, rotY: 0 });
    place('pumpkin_orange_small', -2.2, -0.85, { size: 0.34 });
    place('pumpkin_orange_small', 1.35, -0.7, { size: 0.3 });
    place('pumpkin_yellow_small', 2.3, -1.05, { size: 0.32 });
    place('pumpkin_yellow_small', -1.9, -6.2, { size: 0.3 });

    // --- procedural sheet-ghost rigs (one per spot — §E0.1-10) ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);
    const sheetGeo = sheetGeometry();
    this.ownedGeos.push(sheetGeo);
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: '#F8F6FF', roughness: 0.55, emissive: '#8A78D8', emissiveIntensity: 0.14,
    });
    this.waveMat = new THREE.MeshStandardMaterial({
      color: '#D9CCFF', roughness: 0.5, emissive: '#7C5CE0', emissiveIntensity: 0.35,
    });
    const faceTex = faceTexture();
    this.ownedTex.push(faceTex);
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false });
    const faceGeo = new THREE.PlaneGeometry(0.36, 0.36);
    this.ownedGeos.push(faceGeo);
    this.ownedMats.push(this.ghostMat, this.waveMat, faceMat);

    /** @type {Array<{group: THREE.Group, sheet: THREE.Mesh, spot: object, activeId: number|null}>} */
    this.ghostRigs = [];
    for (const spot of SPOTS) {
      const group = new THREE.Group();
      const sheet = new THREE.Mesh(sheetGeo, this.ghostMat);
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.position.set(0, 0.36, 0.25);
      group.add(sheet, face);
      group.scale.setScalar(1.45);
      group.position.set(spot.x, -1.0, spot.z - 0.2);
      group.visible = false;
      group.userData.g41 = { kind: 'ghost', rig: this.ghostRigs.length };
      scene.add(group);
      this.ghostRigs.push({ group, sheet, spot, activeId: null });
    }

    // --- decoy pumpkin-lanterns (§C10.1: they flicker like ghosts) ---
    const glowTex = glowTexture();
    this.ownedTex.push(glowTex);
    /** @type {Array<{group: THREE.Group, glowMat: THREE.SpriteMaterial, id: number}>} */
    this.decoyRigs = [];
    for (const d of DECOY_SPOTS) {
      const group = new THREE.Group();
      group.add(fitMax(ctx.assets.getModel(`${HW}/pumpkin_orange_jackolantern`), 0.6));
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0xffa64d, transparent: true, opacity: 0.32, depthWrite: false,
      });
      this.ownedMats.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(0.9, 0.9, 1);
      glow.position.y = 0.38;
      group.add(glow);
      group.position.set(d.x, 0, d.z);
      group.rotation.y = Math.PI;
      group.userData.g41 = { kind: 'decoy', decoy: d.id };
      scene.add(group);
      this.decoyRigs.push({ group, glowMat, id: d.id });
    }

    // --- Laterne-reveal rings (all spawn points glow while lanternT > 0) ---
    const ringGeo = new THREE.RingGeometry(0.28, 0.4, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#FFD98A', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
    });
    this.ownedGeos.push(ringGeo);
    this.ownedMats.push(ringMat);
    this.ringMat = ringMat;
    this.rings = [];
    for (const spot of SPOTS) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(spot.x, 0.04, spot.z - 0.2);
      ring.visible = false;
      scene.add(ring);
      this.rings.push(ring);
    }

    // --- powerup tokens (Laterne 🏮 / Netz 🥅 — §C10.1) ---
    const tokenGlowColor = { lantern: 0xffd98a, net: 0x9be0c8 };
    /** @type {Array<{group: THREE.Group}>} */
    this.tokenRigs = HUNT.TOKEN_WINDOWS.map((win, w) => {
      const anchor = TOKEN_ANCHORS[w];
      const group = new THREE.Group();
      if (win.kind === 'lantern') {
        group.add(fitMax(ctx.assets.getModel(`${HW}/lantern_standing`), 0.52));
      } else {
        // procedural catch-net: hoop + weave + stubby handle
        const hoopMat = new THREE.MeshStandardMaterial({ color: '#7CC1A8', roughness: 0.5 });
        const weaveMat = new THREE.MeshStandardMaterial({ color: '#EFF8F2', roughness: 0.8 });
        const hoopGeo = new THREE.TorusGeometry(0.2, 0.03, 8, 20);
        const weaveGeo = new THREE.BoxGeometry(0.36, 0.012, 0.012);
        const gripGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.26, 8);
        this.ownedMats.push(hoopMat, weaveMat);
        this.ownedGeos.push(hoopGeo, weaveGeo, gripGeo);
        const hoop = new THREE.Mesh(hoopGeo, hoopMat);
        const weaveA = new THREE.Mesh(weaveGeo, weaveMat);
        const weaveB = new THREE.Mesh(weaveGeo, weaveMat);
        weaveB.rotation.z = Math.PI / 2;
        const grip = new THREE.Mesh(gripGeo, hoopMat);
        grip.position.set(0, -0.32, 0);
        group.add(hoop, weaveA, weaveB, grip);
      }
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex, color: tokenGlowColor[win.kind], transparent: true, opacity: 0.55, depthWrite: false,
      });
      this.ownedMats.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(1.1, 1.1, 1);
      group.add(glow);
      group.position.set(anchor.x, 0.85, anchor.z);
      group.visible = false;
      group.userData.g41 = { kind: 'token', window: w };
      scene.add(group);
      return { group };
    });

    // --- Gooby cameo: ghost-hunter at the gate ---
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.72);
    this.gooby.group.position.set(0.5, 0, 0.15);
    this.gooby.group.rotation.y = 2.7; // 3/4 back — he watches the yard
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // --- input: tap ghosts/tokens, avoid the flickering decoys (§C10.1) ---
    this.offTap = ctx.input.on('tap', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      const targets = [];
      for (const rig of this.ghostRigs) if (rig.activeId != null) targets.push(rig.group);
      for (const rig of this.decoyRigs) targets.push(rig.group);
      for (const rig of this.tokenRigs) if (rig.group.visible) targets.push(rig.group);
      const hit = ctx.input.pick(ctx.camera, targets, p);
      if (hit) {
        let obj = hit.object;
        while (obj && !obj.userData.g41) obj = obj.parent;
        const tag = obj?.userData.g41;
        if (tag?.kind === 'ghost') {
          const id = this.ghostRigs[tag.rig].activeId;
          if (id != null) {
            this.applyTap({ kind: 'ghost', id });
            return;
          }
        } else if (tag?.kind === 'decoy') {
          this.applyTap({ kind: 'decoy', decoy: tag.decoy });
          return;
        } else if (tag?.kind === 'token') {
          this.applyTap({ kind: 'token', window: tag.window });
          return;
        }
      }
      tapHunt(this.hunt, null); // tapped into the night — chain fizzles
    });

    this.buildHuntHud();
    ctx.hud.setScore(0);
    ctx.hud.setTime(HUNT.DURATION_SEC);

    if (import.meta.env?.DEV) {
      // §E9 test surface (same pattern as purblePlace's __purble): lets CDP
      // proofs read hunt state / perf numbers without scraping the HUD.
      window.__hunt = { game: this, hunt: this.hunt };
    }
  },

  /** DOM hunt HUD: chain / Netz / Laterne pills (rem-only CSS block). */
  buildHuntHud() {
    const root = document.getElementById('ui') ?? document.body;
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'g41-hunt-hud';
    this.hudEl.innerHTML = `
      <span class="g41-pill g41-hunt-chain" hidden></span>
      <span class="g41-pill g41-hunt-net" hidden></span>
      <span class="g41-pill g41-hunt-lantern" hidden></span>`;
    root.appendChild(this.hudEl);
    this.chainEl = this.hudEl.querySelector('.g41-hunt-chain');
    this.netEl = this.hudEl.querySelector('.g41-hunt-net');
    this.lanternEl = this.hudEl.querySelector('.g41-hunt-lantern');
  },

  /** Resolve one tap through the logic + all its juice (player AND bot). */
  applyTap(target) {
    const state = this.hunt;
    let pos = null;
    if (target.kind === 'ghost') {
      const rig = this.ghostRigs.find((r) => r.activeId === target.id);
      if (rig) pos = rig.group.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    } else if (target.kind === 'decoy') {
      const rig = this.decoyRigs.find((r) => r.id === target.decoy);
      if (rig) pos = rig.group.position.clone().add(new THREE.Vector3(0, 0.8, 0));
    } else if (target.kind === 'token') {
      const rig = this.tokenRigs[target.window];
      if (rig) pos = rig.group.position.clone().add(new THREE.Vector3(0, 0.4, 0));
    }
    const res = tapHunt(state, target);
    if (res.kind === 'ghost') {
      this.ctx.audio.play('hunt.catch');
      if (res.chain >= 2) this.ctx.audio.play('hunt.chain');
      if (pos) {
        this.floats.spawn(`+${res.points}`, pos, res.chain >= 2 ? '#C9B6FF' : '#B8F0C0');
        this.particles.emit('sparkles', pos.clone().add(new THREE.Vector3(0, -0.5, 0)), { count: 8 });
      }
      if (res.chain >= 4) this.gooby?.play('happyBounce');
    } else if (res.kind === 'decoy') {
      this.ctx.audio.play('hunt.decoy');
      this.ctx.hud.banner(t('mg.hunt.decoy'));
      if (pos) {
        this.floats.spawn('−2', pos, '#FF9DB0');
        this.particles.emit('dizzyStars', pos);
      }
      this.gooby?.setEmotion('grumpy');
      this.grumpyT = 1.3;
    } else if (res.kind === 'token' && pos) {
      this.particles.emit('sparkles', pos, { count: 10 });
    }
    return res;
  },

  /** Map hunt events → sfx / banners (catch/decoy juice rides applyTap). */
  playEvents() {
    const { audio, hud } = this.ctx;
    const state = this.hunt;
    for (const e of state.events) {
      if (e.type === 'ghostSpawn') {
        audio.play('hunt.spawn');
      } else if (e.type === 'ghostGone') {
        audio.play('hunt.gone');
      } else if (e.type === 'booWave') {
        audio.play('hunt.boo');
        hud.banner(t('mg.hunt.boo'));
      } else if (e.type === 'booBonus') {
        audio.play('hunt.booBonus');
        hud.banner(t('mg.hunt.booBonus', { n: e.bonus }));
        this.gooby?.setEmotion('ecstatic');
        this.gooby?.play('happyBounce');
        this.particles.emit('confetti', new THREE.Vector3(0, 1.6, -3.2), { count: 16 });
      } else if (e.type === 'booEnd') {
        hud.banner(t('mg.hunt.booMiss', { n: e.caught }));
      } else if (e.type === 'tokenSpawn') {
        audio.play('hunt.token');
      } else if (e.type === 'powerup') {
        audio.play('hunt.powerup');
        hud.banner(t(e.kind === 'lantern' ? 'mg.hunt.lantern' : 'mg.hunt.net'));
      }
    }
    state.events.length = 0;
  },

  /** Mirror the logic score into the framework HUD (handles ±deltas). */
  syncScore() {
    const s = huntScore(this.hunt);
    if (s !== this.shownScore) {
      this.ctx.onScore(s - this.shownScore);
      this.shownScore = s;
    }
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.particles.update(dt);
    this.floats.update(dt);
    this.gooby?.update(dt);

    if (this.phase === 'done') return;
    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.4) {
        this.phase = 'done';
        ctx.onEnd({ score: huntScore(this.hunt), meta: runMeta(this.hunt) });
      }
      return;
    }

    const state = this.hunt;
    stepHunt(state, Math.min(dt, 0.1));
    if (this.autoplay && !state.ended) {
      for (const tap of botStep(state)) this.applyTap(tap);
    }
    this.playEvents();
    this.syncScore();
    ctx.hud.setTime(HUNT.DURATION_SEC - state.t);

    if (this.grumpyT > 0) {
      this.grumpyT -= dt;
      if (this.grumpyT <= 0) this.gooby?.setEmotion('happy');
    }

    // --- ghost rig sync (rise → bob → sink comes straight from state) ---
    const bySpot = new Map();
    for (const g of state.ghosts) bySpot.set(g.spot, g);
    for (const rig of this.ghostRigs) {
      const g = bySpot.get(rig.spot.id);
      if (!g) {
        rig.group.visible = false;
        rig.activeId = null;
        continue;
      }
      rig.activeId = g.id;
      rig.group.visible = true;
      const p = (state.t - g.spawnT) / g.dur;
      const rise = Math.min(1, p / HUNT.RISE_FRAC);
      const sink = p > 1 - HUNT.SINK_FRAC ? (p - (1 - HUNT.SINK_FRAC)) / HUNT.SINK_FRAC : 0;
      const h = sink > 0 ? 1 - sink : easeOutBack(rise);
      rig.group.position.y = -1.05 + h * 1.4 + Math.sin(elapsed * 2.6 + rig.spot.id) * 0.05 * h;
      rig.group.rotation.z = Math.sin(elapsed * 3.1 + rig.spot.id * 1.7) * 0.07 * h;
      rig.group.rotation.x = -0.32 * h; // lean toward the high camera (face visible)
      rig.sheet.material = g.wave != null ? this.waveMat : this.ghostMat;
    }

    // --- decoy flicker (ghostly violet pulse = the §C10.1 temptation) ---
    for (const rig of this.decoyRigs) {
      const flickering = state.flickers.some((f) => f.decoy === rig.id);
      if (flickering) {
        rig.glowMat.opacity = 0.45 + 0.45 * Math.abs(Math.sin(elapsed * 9 + rig.id));
        rig.glowMat.color.setHex(0xcdbaff);
      } else {
        rig.glowMat.opacity = 0.28 + 0.08 * Math.sin(elapsed * 1.8 + rig.id * 2);
        rig.glowMat.color.setHex(0xffa64d);
      }
    }

    // --- powerup tokens: bob + spin while spawned ---
    for (let w = 0; w < this.tokenRigs.length; w += 1) {
      const group = this.tokenRigs[w].group;
      const active = state.tokens.some((tok) => tok.window === w);
      group.visible = active;
      if (active) {
        group.position.y = 0.85 + Math.sin(elapsed * 2.4 + w) * 0.09;
        group.rotation.y += dt * 1.6;
      }
    }

    // --- Laterne reveal rings on every spawn point ---
    const lanternOn = state.lanternT > 0;
    this.ringMat.opacity = 0.35 + 0.3 * Math.abs(Math.sin(elapsed * 4));
    for (const ring of this.rings) ring.visible = lanternOn;

    // --- hunt HUD pills ---
    const showChain = state.chain >= 2;
    this.chainEl.hidden = !showChain;
    if (showChain) this.chainEl.textContent = t('mg.hunt.chainPill', { n: state.chain });
    this.netEl.hidden = state.netLeft <= 0;
    if (state.netLeft > 0) this.netEl.textContent = t('mg.hunt.netPill', { n: state.netLeft });
    this.lanternEl.hidden = !lanternOn;
    if (lanternOn) this.lanternEl.textContent = t('mg.hunt.lanternPill', { n: Math.ceil(state.lanternT) });

    if (import.meta.env?.DEV) {
      this.maxDrawCalls = Math.max(this.maxDrawCalls ?? 0, ctx.renderer?.info?.render?.calls ?? 0);
    }

    if (state.ended && this.phase === 'play') {
      this.phase = 'ending';
      this.endT = 0;
      ctx.audio.play('ui.win');
      this.gooby?.setEmotion('ecstatic');
      this.gooby?.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), { count: 16 });
      if (this.autoplay) {
        console.log(
          `[ghostHunt] autoplay run ended — caught ${state.caught}, decoys ${state.decoysTapped}, ` +
          `booBonuses ${state.booBonuses}, score ${huntScore(state)}, maxDrawCalls ${this.maxDrawCalls}`
        );
      }
    }
  },

  dispose() {
    this.offTap?.();
    this.hudEl?.remove();
    this.hudEl = null;
    if (import.meta.env?.DEV && window.__hunt?.game === this) delete window.__hunt;
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTex ?? []) tex.dispose();
    // GLB clones share cached geometries/materials — the framework sweep
    // skips shared masters (V2/FIX-F P2-3); drop references only.
    this.hunt = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.ghostRigs = [];
    this.decoyRigs = [];
    this.tokenRigs = [];
    this.rings = [];
    this.ringMat = null;
    this.ghostMat = null;
    this.waveMat = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTex = [];
  },
};
