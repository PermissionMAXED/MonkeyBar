// Bunny Hop (§C6.1 #3, agent G8): side-view flappy — tap = hop; Gooby glides
// through gaps between fence-post pillars (nature-kit fence_simple stacked,
// tree crowns capping tops/bottoms) over a scrolling meadow with flowers and
// bushes. Score = gates passed; speed +2%/gate; 70% forgiving hitbox; gap
// narrows every 10 gates. Pure physics/ramp logic in bunnyHop.logic.js.
// Dev-only ?autoplay=1 plays the round automatically (headless verification).

import * as THREE from 'three';
import { UI_COLORS } from '../../data/constants.js';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  HOP,
  speedAtGate,
  gapAtGate,
  stepPhysics,
  collides,
  rollGapCenter,
  gustPhaseAt,
  applyGustShift,
  gatePoints,
} from './bunnyHop.logic.js';

const GOOBY_X = -0.85;
const GOOBY_SCALE = 0.62;

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
      // F4 P2-3: keep gate popups near screen edges inside the safe viewport
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

/** @type {object} §E8 plugin */
export default {
  id: 'bunnyHop',
  assetKeys: [
    'nature-kit/fence_simple',
    'nature-kit/tree_default',
    'nature-kit/tree_oak',
    'nature-kit/plant_bush',
    'nature-kit/plant_bushLarge',
    'nature-kit/flower_purpleA',
    'nature-kit/flower_redA',
    'nature-kit/flower_yellowA',
    'nature-kit/grass_large',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'crashed' | 'done'
    this.gates = 0;
    this.gatesPassed = 0;
    this.y = 0.4;
    this.vy = 0.8;
    this.started = false; // gravity waits for the first hop
    this.endT = 0;
    this.autoT = 0;
    this.autoLapseGate = 15 + Math.floor(ctx.rng() * 21); // autoplay run length draw
    this.lastGapCenterY = undefined;
    this.gustAppliedIndex = -1;
    this.gusts = 0;
    this.lastGustCue = '';
    this.celebrated = false;

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#BFE6F7');

    this.ownedGeos = [];
    this.ownedMats = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    // --- backdrop: sun + meadow ground below FLOOR_Y ---
    const sun = own(new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 32),
      new THREE.MeshBasicMaterial({ color: UI_COLORS.YELLOW })
    ));
    sun.position.set(this.halfW - 1.0, this.halfH - 1.2, -4);
    scene.add(sun);
    const ground = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 4, 2.5),
      new THREE.MeshBasicMaterial({ color: '#8FCE7A' })
    ));
    ground.position.set(0, HOP.FLOOR_Y - 1.05, -0.5);
    scene.add(ground);
    const groundLip = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 4, 0.12),
      new THREE.MeshBasicMaterial({ color: '#6FB35E' })
    ));
    groundLip.position.set(0, HOP.FLOOR_Y + 0.16, -0.4);
    scene.add(groundLip);

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0xc8e6b8, 1.15));
    const dir = new THREE.DirectionalLight(0xfff2dd, 0.95);
    dir.position.set(2, 5, 4);
    scene.add(dir);

    // --- wind cue: three chunky arrows telegraph each vertical shove ---
    this.windCue = new THREE.Group();
    const windMat = new THREE.MeshBasicMaterial({
      color: '#FFF6EC',
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const shaftGeo = new THREE.BoxGeometry(0.08, 0.42, 0.03);
    const tipGeo = new THREE.ConeGeometry(0.16, 0.28, 8);
    this.ownedGeos.push(shaftGeo, tipGeo);
    this.ownedMats.push(windMat);
    for (let i = 0; i < 3; i += 1) {
      const arrow = new THREE.Group();
      const shaft = new THREE.Mesh(shaftGeo, windMat);
      const tip = new THREE.Mesh(tipGeo, windMat);
      tip.position.y = 0.32;
      arrow.add(shaft, tip);
      arrow.position.x = (i - 1) * 0.38;
      this.windCue.add(arrow);
    }
    this.windCue.position.set(this.halfW - 0.75, 2.65, 0.2);
    this.windCue.visible = false;
    scene.add(this.windCue);

    // --- scrolling meadow props (flowers, bushes, grass) ---
    this.props = [];
    const propKeys = [
      'flower_purpleA', 'flower_redA', 'flower_yellowA',
      'plant_bush', 'plant_bushLarge', 'grass_large',
    ];
    for (let i = 0; i < 9; i += 1) {
      const key = propKeys[i % propKeys.length];
      const model = ctx.assets.getModel(`nature-kit/${key}`);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = (key.startsWith('plant') ? 0.75 : 0.45) / (Math.max(size.x, size.y, size.z) || 1);
      model.scale.setScalar(s);
      model.position.set(
        -this.halfW + (i / 9) * this.halfW * 2 + ctx.rng() * 0.5,
        HOP.FLOOR_Y + 0.12,
        -0.2 - ctx.rng() * 0.4
      );
      scene.add(model);
      this.props.push(model);
    }

    // --- pillar template: stacked fence_simple + tree-crown caps ---
    const fenceMaster = ctx.assets.getModel('nature-kit/fence_simple');
    const fbox = new THREE.Box3().setFromObject(fenceMaster);
    const fsize = fbox.getSize(new THREE.Vector3());
    this.fenceScale = (HOP.PILLAR_HALF_W * 2) / (Math.max(fsize.x, fsize.z) || 1);
    this.fenceSegH = Math.max(0.35, fsize.y * this.fenceScale);

    /** @type {Array<{group: THREE.Group, x: number, gapCenterY: number, gapHeight: number, passed: boolean}>} */
    this.pillars = [];
    this.nextPillarX = this.halfW + 1.6;

    // --- Gooby, the player (§C6.1: the rig with squash+stretch hops) ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.scale.setScalar(GOOBY_SCALE);
    this.gooby.group.rotation.y = Math.PI / 2; // face the scroll direction
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // --- input: tap = hop (§C6.1) ---
    this.offTap = ctx.input.on('tap', () => {
      if (!this.autoplay) this.hop();
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(0);
  },

  hop() {
    if (this.phase !== 'play') return;
    this.started = true;
    this.vy = HOP.HOP_VY;
    this.ctx.audio.play('hop.flap');
    // squash & stretch (§C6.1: squash+stretch on hop)
    const grp = this.gooby.group;
    tween({
      from: 0, to: 1, duration: 0.3, ease: easings.easeOutQuad,
      onUpdate: (v) => {
        const stretch = Math.sin((1 - v) * Math.PI) * 0.22;
        grp.scale.set(GOOBY_SCALE * (1 - stretch * 0.6), GOOBY_SCALE * (1 + stretch), GOOBY_SCALE * (1 - stretch * 0.6));
      },
    });
  },

  /** Build one pillar pair (bottom + top columns with a gap). */
  spawnPillar() {
    const { rng, scene, assets } = this.ctx;
    const gapHeight = gapAtGate(this.gatesPassed);
    const gapCenterY = rollGapCenter(rng, gapHeight, this.lastGapCenterY);
    this.lastGapCenterY = gapCenterY;
    const group = new THREE.Group();

    const buildColumn = (fromY, toY, crownAtTop) => {
      const col = new THREE.Group();
      const crownH = 0.9;
      // crowns cap the gap-facing end WITHOUT intruding into the gap band, so
      // the visible opening matches the collision gap (§C6.1 forgiving feel)
      const fenceTo = crownAtTop ? toY - crownH : toY;
      let y = crownAtTop ? fromY : fromY + crownH;
      while (y < fenceTo - 0.05) {
        const seg = assets.getModel('nature-kit/fence_simple');
        seg.scale.setScalar(this.fenceScale);
        seg.position.set(0, y, 0); // face-on: reads as a stacked fence panel
        col.add(seg);
        y += this.fenceSegH;
      }
      const crown = assets.getModel(rng() < 0.5 ? 'nature-kit/tree_default' : 'nature-kit/tree_oak');
      const cbox = new THREE.Box3().setFromObject(crown);
      const csize = cbox.getSize(new THREE.Vector3());
      crown.scale.setScalar(crownH / (Math.max(csize.x, csize.y, csize.z) || 1));
      if (crownAtTop) {
        crown.position.set(0, toY - crownH, 0); // crown tip touches the gap bottom
      } else {
        crown.position.set(0, fromY + crownH, 0);
        crown.rotation.z = Math.PI; // hangs upside-down; tip touches the gap top
      }
      col.add(crown);
      return col;
    };

    const gapBottom = gapCenterY - gapHeight / 2;
    const gapTop = gapCenterY + gapHeight / 2;
    group.add(buildColumn(HOP.FLOOR_Y, gapBottom, true));
    group.add(buildColumn(gapTop, HOP.CEILING_Y + 1.2, false));
    group.position.x = this.nextPillarX;
    scene.add(group);
    this.pillars.push({ group, x: this.nextPillarX, gapCenterY, gapHeight, passed: false });
    this.nextPillarX += HOP.PILLAR_SPACING_X;
  },

  crash() {
    this.phase = 'crashed';
    this.endT = 0;
    this.ctx.audio.play('hop.crash');
    this.ctx.hud.banner(t('mg.hop.crash'));
    this.gooby.play('dizzy');
    this.particles.emit('dizzyStars', this.gooby.group.position.clone().add(new THREE.Vector3(0, 0.9, 0)));
    if (this.autoplay) console.log(`[bunnyHop] autoplay run ended — score ${this.gates}`);
  },

  /** Dev-only autoplay: fly the gap band until the attention lapse ends the run. */
  autoplayTick(dt) {
    // human-ish skill budget: a full attention lapse (no taps) after ~15–35
    // gates ends runs in the §C6 typical band (≈ 24 gates); edge clips on
    // fast dives supply the natural early deaths
    if (this.gatesPassed >= this.autoLapseGate) return;
    this.autoT -= dt;
    if (this.autoT > 0) return;
    this.autoT = 0.03;
    if (!this.started) {
      this.hop(); // kick off the run
      return;
    }
    let next = null;
    for (const p of this.pillars) {
      if (p.x + HOP.PILLAR_HALF_W > GOOBY_X - 0.2 && (next == null || p.x < next.x)) next = p;
    }
    let target = next ? next.gapCenterY - next.gapHeight * 0.1 : 0;
    // near a pillar, stay inside its gap band: a hop peaks ~0.6 u above y
    // (don't clip the top edge) and don't approach below the bottom edge
    const halfH = HOP.BODY_HALF_H * HOP.HITBOX_SCALE;
    const hitDist = HOP.PILLAR_HALF_W + HOP.BODY_HALF_W;
    const speed = speedAtGate(this.gatesPassed);
    const horizon = hitDist + speed * 0.45;
    let capOk = true;
    for (const p of this.pillars) {
      const dx = p.x - GOOBY_X;
      const gapTop = p.gapCenterY + p.gapHeight / 2;
      const gapBottom = p.gapCenterY - p.gapHeight / 2;
      if (dx > -hitDist && dx < horizon) {
        if (this.y + 0.62 + halfH > gapTop) capOk = false;
        target = Math.max(target, gapBottom + halfH + 0.25);
      } else if (dx >= horizon && p === next) {
        // dive planning: hopping now must not leave us above the gap top
        // when this pillar arrives
        const tArr = (dx - hitDist) / speed;
        if (tArr < 1.1) {
          const yArrHop = this.y + HOP.HOP_VY * tArr + 0.5 * HOP.GRAVITY * tArr * tArr;
          if (yArrHop + halfH > gapTop - 0.1) capOk = false;
        }
      }
    }
    const lead = Math.max(0, -this.vy) * 0.14;
    if (this.vy < 0 && capOk && this.y < target + lead) this.hop();
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    if (this.phase === 'crashed') {
      // tumble to the ground, then a get-up happyBounce before the results
      this.endT += dt;
      if (this.y > HOP.FLOOR_Y + 0.05) {
        this.vy += HOP.GRAVITY * dt;
        this.y = Math.max(HOP.FLOOR_Y + 0.05, this.y + this.vy * dt);
        this.gooby.group.position.y = this.y - 0.35;
      }
      if (this.endT >= 1.1 && !this.celebrated) {
        this.celebrated = true;
        ctx.audio.play('ui.win');
        this.gooby.setEmotion('ecstatic');
        this.gooby.play('happyBounce');
      }
      if (this.endT >= 2.0 && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: this.gates });
      }
      return;
    }

    ctx.hud.setTime(elapsed);

    if (this.autoplay) this.autoplayTick(dt);

    // V3 wind gust: telegraph, then one clamped 0.4-lane vertical shift.
    const gust = gustPhaseAt(elapsed);
    const cueKey = `${gust.phase}:${gust.index}`;
    this.windCue.visible = gust.phase !== 'none';
    if (this.windCue.visible) {
      this.windCue.rotation.z = gust.direction > 0 ? 0 : Math.PI;
      this.windCue.scale.setScalar(gust.phase === 'gust' ? 1.15 : 0.9 + Math.sin(elapsed * 12) * 0.08);
    }
    if (gust.phase === 'telegraph' && cueKey !== this.lastGustCue) {
      ctx.hud.banner(t(gust.direction > 0 ? 'mg.hop.gustUpWarn' : 'mg.hop.gustDownWarn'));
    }
    if (gust.phase === 'gust' && gust.index !== this.gustAppliedIndex) {
      this.y = applyGustShift(this.y, gust.direction);
      this.gustAppliedIndex = gust.index;
      this.gusts += 1;
      ctx.audio.play('whoosh');
      ctx.hud.banner(t('mg.hop.gust'));
      this.particles.emit('sparkles', this.gooby.group.position.clone(), { count: 7 });
    }
    this.lastGustCue = cueKey;

    // physics (gravity + world scroll wait for the first hop, so neither the
    // countdown nor a hesitant player leaks free gates)
    if (this.started) {
      const next = stepPhysics({ y: this.y, vy: this.vy }, dt);
      this.y = next.y;
      this.vy = next.vy;
    } else {
      this.y = 0.4 + Math.sin(elapsed * 3) * 0.12; // pre-start hover
    }
    const grp = this.gooby.group;
    grp.position.set(GOOBY_X, this.y - 0.35, 0); // rig origin is at the feet
    grp.rotation.z = THREE.MathUtils.clamp(this.vy * 0.09, -0.5, 0.35);
    if (!this.started) {
      if (this.pillars.length === 0 && this.nextPillarX < this.halfW + 1.6) this.spawnPillar();
      return;
    }

    // scroll world (§C6.1: speed +2%/gate)
    const speed = speedAtGate(this.gatesPassed);
    for (const p of this.pillars) {
      p.x -= speed * dt;
      p.group.position.x = p.x;
    }
    for (const prop of this.props) {
      prop.position.x -= speed * dt * 0.85; // slight parallax
      if (prop.position.x < -this.halfW - 1) prop.position.x += this.halfW * 2 + 2;
    }
    this.nextPillarX -= speed * dt;
    if (this.nextPillarX < this.halfW + 1.6) this.spawnPillar();

    // gates + collisions
    for (const p of this.pillars) {
      if (!p.passed && p.x + HOP.PILLAR_HALF_W < GOOBY_X - HOP.BODY_HALF_W) {
        p.passed = true;
        this.gatesPassed += 1;
        const points = gatePoints(gust.phase === 'gust');
        this.gates += points;
        ctx.onScore(points);
        ctx.audio.play('hop.gate');
        this.floats.spawn(`+${points}`, new THREE.Vector3(GOOBY_X + 0.5, this.y + 0.6, 0), '#2E8B57');
        this.particles.emit('sparkles', new THREE.Vector3(p.x, p.gapCenterY, 0), { count: 4 });
      }
      if (this.started && collides({ x: GOOBY_X, y: this.y }, p)) {
        this.crash();
        return;
      }
    }
    if (this.started && this.y - 0.42 * 0.7 <= HOP.FLOOR_Y) {
      this.crash();
      return;
    }

    // recycle off-screen pillars
    this.pillars = this.pillars.filter((p) => {
      if (p.x < -this.halfW - 1.5) {
        ctx.scene.remove(p.group);
        return false;
      }
      return true;
    });
  },

  dispose() {
    this.offTap?.();
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    this.pillars = [];
    this.props = [];
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.celebrated = false;
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
