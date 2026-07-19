// Carrot Guard (§C6.1 #4, agent G8): whack-a-mole in a fenced garden — 3×3
// dirt mounds (nature-kit crops_dirtSingle); gray procedural moles (capsule +
// eyes) pop for 0.9 s → 0.5 s trying to steal 10 carrots (crop_carrot); tap to
// bonk (cartoon mallet swats down). Hit +1, escaped mole steals a carrot,
// combo ≥5 → +3 bonus. Ends at 45 s or when all carrots are gone. Pure
// timing/steal/combo logic in carrotGuard.logic.js. Dev-only ?autoplay=1.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  GUARD,
  upTimeAt,
  spawnIntervalAt,
  doubleChanceAt,
  applyBonk,
  applyEscape,
  applyWhiff,
  isRoundOver,
  isKingDue,
  applyKingTap,
  acceptsTapAfter,
  applyDifficulty,
} from './carrotGuard.logic.js';

const GRID_SPACING = 1.5;

/** Tiny floating score text (canvas-texture sprites, self-disposing). */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#4A3B36') {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(text, 100, 40);
      g.fillStyle = color;
      g.fillText(text, 100, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      // F4 P2-3: keep edge-mound popups fully inside the safe viewport
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.63, halfH: 0.25 }));
      sprite.scale.set(1.25, 0.5, 1);
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
  id: 'carrotGuard',
  assetKeys: [
    'nature-kit/crops_dirtSingle',
    'nature-kit/crop_carrot',
    'nature-kit/fence_simple',
    'nature-kit/flower_yellowA',
    'nature-kit/flower_redA',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    const difficulty = ctx.params?.difficulty ?? 'normal';
    this.tune = applyDifficulty(GUARD, difficulty);

    this.phase = 'play';
    this.score = 0;
    this.combo = 0;
    this.bonks = 0;
    this.kingsSpawned = 0;
    this.kingsDefeated = 0;
    this.carrots = this.tune.CARROTS;
    this.spawnT = 0.8;
    this.endT = 0;
    this.autoT = 0;
    this.tapClock = 0;
    this.lastWhiffAt = -Infinity;

    // Portrait framing: vFOV 45 on a phone leaves a narrow ~22° horizontal
    // FOV, so the camera sits high and far to fit the 3-mound width.
    const camera = ctx.camera;
    camera.position.set(0, 10.5, 8.6);
    camera.lookAt(0, 0, -0.4);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#BFE6F7');

    this.ownedGeos = [];
    this.ownedMats = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    // --- garden: grass, fence ring ---
    const grass = own(new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshStandardMaterial({ color: '#8FCE7A', roughness: 1 })
    ));
    grass.rotation.x = -Math.PI / 2;
    scene.add(grass);

    const fenceMaster = ctx.assets.getModel('nature-kit/fence_simple');
    const fbox = new THREE.Box3().setFromObject(fenceMaster);
    const fsize = fbox.getSize(new THREE.Vector3());
    const fenceScale = 1.2 / (Math.max(fsize.x, fsize.z) || 1);
    const fenceAt = (x, z, rotY) => {
      const f = ctx.assets.getModel('nature-kit/fence_simple');
      f.scale.setScalar(fenceScale);
      f.position.set(x, 0, z);
      f.rotation.y = rotY;
      scene.add(f);
    };
    for (let i = -2; i <= 2; i += 1) {
      fenceAt(i * 1.2, -3.0, 0); // back
      fenceAt(-3.0, i * 1.2, Math.PI / 2);
      fenceAt(3.0, i * 1.2, Math.PI / 2);
    }
    for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6]]) {
      const flower = ctx.assets.getModel(x < 0 ? 'nature-kit/flower_yellowA' : 'nature-kit/flower_redA');
      const box = new THREE.Box3().setFromObject(flower);
      const size = box.getSize(new THREE.Vector3());
      flower.scale.setScalar(0.5 / (Math.max(size.x, size.y, size.z) || 1));
      flower.position.set(x, 0, z);
      scene.add(flower);
    }

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0xc8e6b8, 1.15));
    const dirLight = new THREE.DirectionalLight(0xfff2dd, 0.95);
    dirLight.position.set(3, 6, 4);
    scene.add(dirLight);

    // --- 3×3 dirt mounds with a pop-up mole each (§C6.1) ---
    const moleBody = new THREE.CapsuleGeometry(0.26, 0.3, 4, 12);
    const moleNose = new THREE.SphereGeometry(0.06, 10, 8);
    const moleEye = new THREE.SphereGeometry(0.045, 8, 6);
    const molePaw = new THREE.SphereGeometry(0.09, 8, 6);
    const kingCrown = new THREE.ConeGeometry(0.28, 0.34, 5);
    const grayMat = new THREE.MeshStandardMaterial({ color: '#8B8680', roughness: 0.9 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#3A2E2E', roughness: 0.4 });
    const noseMat = new THREE.MeshStandardMaterial({ color: '#E88BA0', roughness: 0.6 });
    const crownMat = new THREE.MeshStandardMaterial({
      color: '#FFD54F',
      emissive: '#7A4B00',
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.4,
    });
    this.ownedGeos.push(moleBody, moleNose, moleEye, molePaw, kingCrown);
    this.ownedMats.push(grayMat, darkMat, noseMat, crownMat);

    /** @type {Array<{mound: THREE.Group, mole: THREE.Group, carrot: THREE.Group, crown: THREE.Mesh, up: boolean, timer: number, upFor: number, hit: boolean, king: boolean, hp: number, lastTap: number}>} */
    this.holes = [];
    for (let r = 0; r < this.tune.GRID; r += 1) {
      for (let c = 0; c < this.tune.GRID; c += 1) {
        const x = (c - 1) * GRID_SPACING;
        const z = (r - 1) * GRID_SPACING - 0.3;

        const mound = ctx.assets.getModel('nature-kit/crops_dirtSingle');
        const mbox = new THREE.Box3().setFromObject(mound);
        const msize = mbox.getSize(new THREE.Vector3());
        mound.scale.setScalar(1.15 / (Math.max(msize.x, msize.z) || 1));
        mound.position.set(x, 0.01, z);
        scene.add(mound);

        const mole = new THREE.Group();
        const body = new THREE.Mesh(moleBody, grayMat);
        body.position.y = 0.28;
        mole.add(body);
        for (const sx of [-1, 1]) {
          const eye = new THREE.Mesh(moleEye, darkMat);
          eye.position.set(sx * 0.1, 0.42, 0.21);
          mole.add(eye);
          const paw = new THREE.Mesh(molePaw, grayMat);
          paw.position.set(sx * 0.2, 0.16, 0.16);
          mole.add(paw);
        }
        const nose = new THREE.Mesh(moleNose, noseMat);
        nose.position.set(0, 0.34, 0.26);
        mole.add(nose);
        const crown = new THREE.Mesh(kingCrown, crownMat);
        crown.position.set(0, 0.78, 0);
        crown.visible = false;
        mole.add(crown);
        const carrotLoot = ctx.assets.getModel('nature-kit/crop_carrot');
        const cbox = new THREE.Box3().setFromObject(carrotLoot);
        const csize = cbox.getSize(new THREE.Vector3());
        carrotLoot.scale.setScalar(0.34 / (Math.max(csize.x, csize.y, csize.z) || 1));
        carrotLoot.position.set(0, 0.24, 0.3);
        carrotLoot.visible = false;
        mole.add(carrotLoot);

        mole.position.set(x, 0, z);
        mole.scale.y = 0.01; // hidden in the mound
        mole.visible = false;
        mole.userData.holeIndex = this.holes.length;
        scene.add(mole);

        this.holes.push({
          mound,
          mole,
          carrot: carrotLoot,
          crown,
          up: false,
          timer: 0,
          upFor: 0,
          hit: false,
          king: false,
          hp: 0,
          lastTap: -Infinity,
        });
      }
    }

    // --- carrot stock display (§C6.1: 10 carrots) along the front edge ---
    this.stockCarrots = [];
    for (let i = 0; i < this.tune.CARROTS; i += 1) {
      const cm = ctx.assets.getModel('nature-kit/crop_carrot');
      const box = new THREE.Box3().setFromObject(cm);
      const size = box.getSize(new THREE.Vector3());
      cm.scale.setScalar(0.42 / (Math.max(size.x, size.y, size.z) || 1));
      cm.position.set(-2.35 + i * 0.52, 0.02, 2.35);
      scene.add(cm);
      this.stockCarrots.push(cm);
    }

    // --- cartoon mallet (swats down on every tap) ---
    this.mallet = new THREE.Group();
    const handle = own(new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.85, 10),
      new THREE.MeshStandardMaterial({ color: '#C98A4B', roughness: 0.8 })
    ));
    handle.position.y = 0.42;
    const head = own(new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.44, 14),
      new THREE.MeshStandardMaterial({ color: '#FF7BA9', roughness: 0.6 })
    ));
    head.rotation.z = Math.PI / 2;
    head.position.y = 0.9;
    this.mallet.add(handle, head);
    this.mallet.visible = false;
    scene.add(this.mallet);

    // --- Gooby cameo: watches from behind the garden ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, ctx.camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.scale.setScalar(0.9);
    this.gooby.group.position.set(1.55, 0, -2.75);
    this.gooby.group.rotation.y = -0.35;
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // --- input: tap to bonk (§C6.1) ---
    this.offTap = ctx.input.on('tap', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      const moles = this.holes.filter((h) => h.up && !h.hit).map((h) => h.mole);
      const hit = ctx.input.pick(ctx.camera, moles.length > 0 ? moles : [], p);
      if (hit) {
        let obj = hit.object;
        while (obj && obj.userData.holeIndex === undefined) obj = obj.parent;
        if (obj) {
          this.bonk(this.holes[obj.userData.holeIndex]);
          return;
        }
      }
      this.whiff(p);
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(this.tune.ENDLESS ? 0 : this.tune.DURATION_SEC);
  },

  /** Swing the mallet down over a world position. */
  swingMallet(pos) {
    const mallet = this.mallet;
    mallet.visible = true;
    mallet.position.set(pos.x + 0.3, 0.15, pos.z + 0.25);
    tween({
      from: -1.4, to: 0, duration: 0.12, ease: easings.easeOutQuad,
      onUpdate: (v) => {
        mallet.rotation.z = v;
      },
      onComplete: () => {
        tween({
          from: 0, to: -1.4, duration: 0.22, delay: 0.1, ease: easings.easeOutQuad,
          onUpdate: (v) => {
            mallet.rotation.z = v;
          },
          onComplete: () => {
            mallet.visible = false;
          },
        });
      },
    });
  },

  bonk(hole) {
    if (!acceptsTapAfter(this.tapClock - hole.lastTap)) return;
    hole.lastTap = this.tapClock;
    if (hole.king) {
      const res = applyKingTap({
        score: this.score,
        combo: this.combo,
        hp: hole.hp,
      });
      hole.hp = res.hp;
      this.swingMallet(hole.mole.position);
      this.ctx.audio.play('mole.bonk');
      if (!res.complete) {
        this.floats.spawn(
          `${res.hp}×`,
          hole.mole.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
          '#C98A00'
        );
        this.particles.emit('dizzyStars', hole.mole.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
        return;
      }
      hole.hit = true;
      this.score = res.score;
      this.combo = res.combo;
      this.kingsDefeated += 1;
      this.ctx.onScore(res.gained);
      this.ctx.hud.banner(t('mg.guard.kingDefeated'));
      this.floats.spawn(
        `+${res.gained}`,
        hole.mole.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
        '#C98A00'
      );
      this.particles.emit('confetti', hole.mole.position.clone().add(new THREE.Vector3(0, 1, 0)), { count: 16 });
      this.gooby.play('happyBounce');
      hole.timer = 0.35;
      return;
    }
    hole.hit = true;
    const pos = hole.mole.position;
    this.swingMallet(pos);
    const res = applyBonk({ score: this.score, combo: this.combo });
    const gained = res.score - this.score;
    this.score = res.score;
    this.combo = res.combo;
    this.bonks += 1;
    this.ctx.onScore(gained);
    this.ctx.audio.play('mole.bonk');
    this.floats.spawn(res.bonus > 0 ? `+1 +${res.bonus}!` : '+1', pos.clone().add(new THREE.Vector3(0, 0.9, 0)), '#2E8B57');
    if (res.bonus > 0) {
      this.ctx.hud.banner(t('mg.guard.combo'));
      this.ctx.audio.play('mole.combo');
      this.particles.emit('confetti', pos.clone().add(new THREE.Vector3(0, 1, 0)), { count: 10 });
      this.gooby.play('happyBounce');
    }
    this.particles.emit('dizzyStars', pos.clone().add(new THREE.Vector3(0, 0.7, 0)));
    // squash flat, then duck
    const mole = hole.mole;
    tween({
      from: 1, to: 0.18, duration: 0.12, ease: easings.easeOutQuad,
      onUpdate: (v) => {
        mole.scale.y = v;
      },
    });
    hole.timer = 0.28; // brief flat pause, then hide in update()
  },

  whiff(p) {
    if (!acceptsTapAfter(this.tapClock - this.lastWhiffAt, GUARD.WHIFF_COOLDOWN_SEC)) return;
    this.lastWhiffAt = this.tapClock;
    const before = this.combo;
    this.combo = applyWhiff({ combo: this.combo }).combo;
    this.ctx.audio.play('mole.whiff');
    if (before >= 2) this.floats.spawn('×', new THREE.Vector3(0, 0.6, 1.6), '#D64570');
  },

  /** Pop a mole from a random free hole. */
  popMole(elapsed, forceKing = false) {
    const { rng } = this.ctx;
    const free = this.holes.filter((h) => !h.up);
    if (free.length === 0) return false;
    const hole = free[Math.floor(rng() * free.length)];
    const king = forceKing || isKingDue(this.bonks, this.kingsSpawned);
    if (king) this.kingsSpawned += 1;
    hole.up = true;
    hole.hit = false;
    hole.king = king;
    hole.hp = king ? this.tune.KING_TAPS : 1;
    hole.lastTap = -Infinity;
    hole.crown.visible = king;
    hole.mole.scale.x = hole.mole.scale.z = king ? 1.22 : 1;
    const upFor = upTimeAt(elapsed, this.tune.DURATION_SEC, this.tune);
    hole.upFor = king ? Math.max(1.5, upFor * 2.4) : upFor;
    hole.timer = hole.upFor + this.tune.POP_SEC * 2;
    hole.carrot.visible = false;
    hole.mole.visible = true;
    hole.mole.scale.y = 0.01;
    this.ctx.audio.play('mole.pop');
    if (king) this.ctx.hud.banner(t('mg.guard.king'));
    const mole = hole.mole;
    tween({
      from: 0.01, to: 1, duration: this.tune.POP_SEC, ease: easings.easeOutBack,
      onUpdate: (v) => {
        mole.scale.y = Math.max(0.01, v);
      },
    });
    return king;
  },

  escape(hole) {
    hole.up = false;
    hole.mole.visible = false;
    hole.crown.visible = false;
    const res = applyEscape({ carrots: this.carrots, combo: this.combo });
    this.carrots = res.carrots;
    this.combo = res.combo;
    this.ctx.audio.play('mole.steal');
    this.ctx.hud.banner(t('mg.guard.steal'));
    const taken = this.stockCarrots[this.carrots];
    if (taken) taken.visible = false;
    this.floats.spawn('-1', hole.mole.position.clone().add(new THREE.Vector3(0, 0.8, 0)), '#D64570');
    this.gooby.setEmotion(this.carrots <= 3 ? 'sad' : 'grumpy');
  },

  /** Dev-only autoplay: bonk up-moles with human-ish reaction + error rate. */
  autoplayTick(dt) {
    this.autoT -= dt;
    if (this.autoT > 0) return;
    this.autoT = 0.16;
    const { rng } = this.ctx;
    for (const hole of this.holes) {
      if (!hole.up || hole.hit) continue;
      const elapsedUp = hole.upFor + this.tune.POP_SEC * 2 - hole.timer;
      if (elapsedUp < this.tune.BOT_REACTION_SEC) continue;
      const accuracy = this.tune.MODE === 'easy' ? 0.96 : this.tune.MODE === 'hard' ||
        this.tune.MODE === 'endless' ? 0.82 : 0.93;
      if (hole.king || rng() < accuracy) {
        this.bonk(hole);
        return; // one bonk per tick — doubles can slip through
      }
    }
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);
    this.tapClock += dt;

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: this.score });
      }
      return;
    }

    ctx.hud.setTime(this.tune.ENDLESS ? elapsed : this.tune.DURATION_SEC - elapsed);

    if (this.autoplay) this.autoplayTick(dt);

    // mole lifecycles (dt-driven — pause-safe §E8)
    for (const hole of this.holes) {
      if (!hole.up) continue;
      hole.timer -= dt;
      if (hole.hit) {
        if (hole.timer <= 0) {
          hole.up = false;
          hole.mole.visible = false;
          hole.crown.visible = false;
        }
        continue;
      }
      if (hole.timer <= this.tune.POP_SEC && hole.timer + dt > this.tune.POP_SEC) {
        // about to duck away with loot — show the stolen carrot in his paws
        hole.carrot.visible = true;
        const mole = hole.mole;
        tween({
          from: 1, to: 0.01, duration: this.tune.POP_SEC, ease: easings.easeOutQuad,
          onUpdate: (v) => {
            mole.scale.y = Math.max(0.01, v);
          },
        });
      }
      if (hole.timer <= 0) this.escape(hole);
    }

    // spawn cadence (§C6.1 ramp), occasional doubles late in the round
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const king = this.popMole(elapsed);
      if (
        !king &&
        this.ctx.rng() < doubleChanceAt(elapsed, this.tune.DURATION_SEC, this.tune)
      ) {
        this.popMole(elapsed);
      }
      this.spawnT = spawnIntervalAt(elapsed, this.tune.DURATION_SEC, this.tune);
    }

    if (isRoundOver({ elapsed, carrots: this.carrots }, this.tune.DURATION_SEC, this.tune)) {
      this.phase = 'ending';
      this.endT = 0;
      if (this.carrots <= 0) ctx.hud.banner(t('mg.guard.empty'));
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.3, 0)), { count: 14 });
      if (this.autoplay) {
        console.log(
          `[carrotGuard] autoplay run ended — score ${this.score} ` +
          `(carrots ${this.carrots}, kings ${this.kingsDefeated})`
        );
      }
    }
  },

  dispose() {
    this.offTap?.();
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    this.holes = [];
    this.stockCarrots = [];
    this.mallet = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.ownedGeos = [];
    this.ownedMats = [];
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
