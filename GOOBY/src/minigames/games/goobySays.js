// Gooby Says (PLAN2 §C1.2 #1, agent V2/G24): four chunky pastel pads
// (carrot-orange, teal, pink, yellow) arranged around Gooby on a disco-lite
// stage (§C1.3 — bright pastel lavender, mirror ball + soft beams; NOT
// danceParty's dark club). Gooby "sings" a growing sequence — each pad lights
// up with a distinct squeak pitch and an ear-point/look — and the player taps
// it back. One mistake = cute dizzy game over. Pure sequence/scoring logic
// lives in goobySays.logic.js (§B rule). Dev-only ?autoplay=1 replays the
// emitted sequence at 250 ms taps with a small human-ish slip chance.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import {
  SAYS,
  seqLengthAt,
  stepMsAt,
  extendSequence,
  isChordStep,
  chordTapResult,
  roundScore,
  autoplayErrAt,
} from './goobySays.logic.js';

/** Pad palette (§C1.2 binding: carrot-orange, teal, pink, yellow). */
const PAD_COLORS = ['#FF9F5A', '#59C9B9', '#FF7BA9', '#FFD166'];
/** Pad squeak sfx ids (V2/G24 sfxMap block — one distinct pitch per pad). */
const PAD_SFX = ['says.pad1', 'says.pad2', 'says.pad3', 'says.pad4'];
/** Pad centers around Gooby (diamond on the stage floor — sized to fit the
 * ~±2.4 world-unit half-width portrait phones see at the stage plane). */
const PAD_POS = [
  [0, -2.0], // front (carrot-orange)
  [-1.5, -0.2], // left (teal)
  [1.5, -0.2], // right (pink)
  [0, 1.6], // back (yellow)
];
const PAD_RADIUS = 0.82;
const PAD_HEIGHT = 0.3;

/** Pastel wedge stage disc as a CanvasTexture (disco-lite floor). */
function makeStageTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  const wedges = ['#F6E4F6', '#E4F0F6', '#F6F0DF', '#EDE4F6', '#E0F2E4', '#F6E6E0'];
  for (let i = 0; i < 12; i += 1) {
    g.fillStyle = wedges[i % wedges.length];
    g.beginPath();
    g.moveTo(128, 128);
    g.arc(128, 128, 128, (i / 12) * Math.PI * 2, ((i + 1) / 12) * Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 122, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(canvas);
}

/** @type {object} §E8 plugin */
export default {
  id: 'goobySays',
  assetKeys: [], // fully procedural (§C1.2 — pads, stage, mirror ball)

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    // --- round state (all timing dt-accumulated → pause-safe) ---
    this.phase = 'idle'; // 'idle'|'watch'|'repeat'|'roundWon'|'over'|'done'
    this.round = 1;
    this.roundsCompleted = 0;
    this.sequence = [];
    this.playIdx = 0;
    this.inputIdx = 0;
    this.stepT = 0.45; // small breath before round 1 playback
    this.reactT = 0;
    this.reactions = [];
    this.endT = 0;
    this.autoT = 0;
    this.chordPending = null;
    this.score = 0;

    const camera = ctx.camera;
    camera.position.set(0, 7.0, 7.6);
    camera.lookAt(0, 0.1, -0.2);
    // Fit the stage into the portrait viewport: world half-width at the stage
    // center, then scale the whole stage group so the side pads never clip.
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0.1, -0.2));
    const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * (innerWidth / innerHeight);
    this.stageScale = Math.min(1, (halfW * 0.92) / 2.35);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#F1E7FA'); // disco-lite pastel lavender
    this.stageGroup = new THREE.Group();
    this.stageGroup.scale.setScalar(this.stageScale);
    scene.add(this.stageGroup);

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

    scene.add(new THREE.HemisphereLight(0xfff6ff, 0xd8c8ec, 1.1));
    const dir = new THREE.DirectionalLight(0xfff2ee, 0.85);
    dir.position.set(3, 7, 4);
    scene.add(dir);

    // --- stage: pastel wedge disc + rim ---
    const stageTex = makeStageTexture();
    this.ownedTexs.push(stageTex);
    const stage = own(new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 48),
      new THREE.MeshStandardMaterial({ map: stageTex, roughness: 0.9 })
    ));
    stage.rotation.x = -Math.PI / 2;
    this.stageGroup.add(stage);
    const rim = own(new THREE.Mesh(
      new THREE.TorusGeometry(3.4, 0.09, 10, 48),
      new THREE.MeshStandardMaterial({ color: '#C9A6E8', roughness: 0.6 })
    ));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    this.stageGroup.add(rim);

    // --- disco-lite dressing: mirror ball + soft beams ---
    this.ball = own(new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshStandardMaterial({ color: '#DFE3F2', metalness: 0.3, roughness: 0.3, flatShading: true })
    ));
    this.ball.position.set(0, 4.15, -0.4);
    this.stageGroup.add(this.ball);
    /** @type {THREE.Mesh[]} */
    this.beams = [];
    for (let i = 0; i < 3; i += 1) {
      const beam = own(new THREE.Mesh(
        new THREE.ConeGeometry(0.85, 4.4, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: PAD_COLORS[i],
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      ));
      beam.position.set(-1.6 + i * 1.6, 2.6, -1.2);
      this.stageGroup.add(beam);
      this.beams.push(beam);
    }

    // --- the four giant pads ---
    /** @type {Array<{mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial, baseY: number}>} */
    this.pads = [];
    PAD_POS.forEach(([x, z], i) => {
      const mat = new THREE.MeshStandardMaterial({
        color: PAD_COLORS[i],
        emissive: PAD_COLORS[i],
        emissiveIntensity: 0.12,
        roughness: 0.55,
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS * 1.06, PAD_HEIGHT, 28), mat);
      mesh.position.set(x, PAD_HEIGHT / 2 + 0.02, z);
      mesh.userData.padIndex = i;
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mat);
      this.stageGroup.add(mesh);
      this.pads.push({ mesh, mat, baseY: mesh.position.y });
    });

    // --- Gooby center stage ---
    this.particles = createParticles(this.stageGroup);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.8);
    this.gooby.group.position.set(0, 0.03, -0.2);
    this.gooby.setEmotion('happy');
    this.stageGroup.add(this.gooby.group);

    // --- input: tap pads (repeat phase only) ---
    this.offTap = ctx.input.on('tap', (p) => {
      if (this.autoplay || this.phase !== 'repeat') return;
      const hit = ctx.input.pick(ctx.camera, this.pads.map((pad) => pad.mesh), p);
      if (hit) this.pressPad(hit.object.userData.padIndex);
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(0);
  },

  /** Light a pad: emissive flash + squash pop + its squeak pitch. */
  lightPad(i, { sing = false } = {}) {
    const pad = this.pads[i];
    this.ctx.audio.play(PAD_SFX[i]);
    pad.mat.emissiveIntensity = 0.95;
    tween({
      from: 0.95, to: 0.12, duration: 0.34, ease: easings.easeOutQuad,
      onUpdate: (v) => { pad.mat.emissiveIntensity = v; },
    });
    const mesh = pad.mesh;
    tween({
      from: 1.22, to: 1, duration: 0.26, ease: easings.easeOutBack,
      onUpdate: (v) => mesh.scale.set(v, 2 - v, v),
    });
    if (sing) {
      // Gooby "sings" the step: ear-point/look toward the pad (§C1.2).
      this.gooby.lookAt(mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
    }
  },

  /** Light one normal step or both pads of a chord simultaneously. */
  lightStep(step, options = {}) {
    if (isChordStep(step)) {
      for (const pad of step) this.lightPad(pad, options);
    } else {
      this.lightPad(step, options);
    }
  },

  /** Start a round: extend the sequence and play it back. */
  startWatch() {
    this.phase = 'watch';
    this.chordPending = null;
    this.sequence = extendSequence(this.sequence, this.ctx.rng, this.round);
    while (this.sequence.length < seqLengthAt(this.round)) {
      this.sequence = extendSequence(this.sequence, this.ctx.rng, this.round);
    }
    this.playIdx = 0;
    this.stepT = 0.55;
    this.ctx.hud.banner(t('mg.says.round', { n: this.round }));
    this.gooby.play('wave');
  },

  /** Hand over to the player after playback. */
  startRepeat() {
    this.phase = 'repeat';
    this.inputIdx = 0;
    this.reactT = 0;
    this.chordPending = null;
    this.ctx.hud.banner(t('mg.says.go'));
    this.gooby.lookAt(new THREE.Vector3(0, 1.5, 6));
  },

  /** Player (or bot) pressed pad i during the repeat phase. */
  pressPad(i) {
    if (this.phase !== 'repeat') return;
    const expected = this.sequence[this.inputIdx];
    this.lightPad(i);
    if (isChordStep(expected)) {
      if (!this.chordPending) {
        const status = chordTapResult(expected, i);
        if (status !== 'waiting') {
          this.gameOver('mg.says.oops');
          return;
        }
        this.chordPending = { firstPad: i, gapT: 0 };
        this.ctx.hud.banner(t('mg.says.chord'));
        if (this.autoplay) {
          console.log(`[goobySays] chord round ${this.round} — pads ${expected.join('+')}`);
        }
        return;
      }
      const status = chordTapResult(
        expected,
        this.chordPending.firstPad,
        i,
        this.chordPending.gapT * 1000
      );
      this.chordPending = null;
      if (status !== 'complete') {
        this.gameOver(status === 'late' ? 'mg.says.chordLate' : 'mg.says.oops');
        return;
      }
    } else if (i !== expected) {
      this.gameOver('mg.says.oops');
      return;
    }
    this.completeInputStep();
  },

  /** Advance after one normal step or one fully-entered chord. */
  completeInputStep() {
    this.reactions.push(this.reactT * 1000);
    this.reactT = 0;
    this.inputIdx += 1;
    if (this.inputIdx >= this.sequence.length) {
      this.roundsCompleted = this.round;
      this.round += 1;
      this.score = SAYS.ROUND_POINTS * this.roundsCompleted;
      this.ctx.onScore(SAYS.ROUND_POINTS);
      this.ctx.audio.play('combo.up');
      this.gooby.play('happyBounce');
      this.particles.emit('sparkles', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), { count: 8 });
      this.phase = 'roundWon';
      this.stepT = 0.9;
    }
  },

  /** One mistake (or step timeout) ends the round — cute dizzy (§C1.2). */
  gameOver(bannerKey) {
    this.phase = 'over';
    this.endT = 0;
    this.chordPending = null;
    this.ctx.hud.banner(t(bannerKey));
    this.ctx.audio.play('gooby.squeakDizzy');
    this.gooby.setEmotion('dizzy');
    this.gooby.play('dizzy');
    this.particles.emit('dizzyStars', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)));
  },

  avgReactionMs() {
    if (this.reactions.length === 0) return Infinity;
    return this.reactions.reduce((s, v) => s + v, 0) / this.reactions.length;
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    ctx.hud.setTime(elapsed);
    this.ball.rotation.y += dt * 0.9;
    this.beams.forEach((beam, i) => {
      beam.rotation.z = Math.sin(elapsed * 0.7 + i * 2.1) * 0.28;
      beam.material.opacity = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(elapsed * 1.3 + i));
    });

    if (this.phase === 'idle') {
      this.stepT -= dt;
      if (this.stepT <= 0) this.startWatch();
      return;
    }

    if (this.phase === 'watch') {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        if (this.playIdx < this.sequence.length) {
          this.lightStep(this.sequence[this.playIdx], { sing: true });
          this.playIdx += 1;
          this.stepT = stepMsAt(this.round) / 1000;
        } else {
          this.startRepeat();
        }
      }
      return;
    }

    if (this.phase === 'repeat') {
      this.reactT += dt;
      if (this.chordPending) {
        this.chordPending.gapT += dt;
        if (this.chordPending.gapT * 1000 > SAYS.CHORD_WINDOW_MS) {
          this.gameOver('mg.says.chordLate');
          return;
        }
      }
      if (this.reactT * 1000 > SAYS.INPUT_TIMEOUT_MS) {
        this.gameOver('mg.says.timeout');
        return;
      }
      if (this.autoplay) {
        this.autoT -= dt;
        if (this.autoT <= 0) {
          const step = this.sequence[this.inputIdx];
          const chord = isChordStep(step);
          this.autoT = chord && !this.chordPending
            ? Math.min(0.12, SAYS.CHORD_WINDOW_MS / 2000)
            : SAYS.AUTOPLAY_TAP_MS / 1000;
          const want = chord
            ? (this.chordPending ? step.find((pad) => pad !== this.chordPending.firstPad) : step[0])
            : step;
          // Human-ish slip: ramps with round length, ends typical runs ~round 8.
          const slip = !this.chordPending && this.ctx.rng() < autoplayErrAt(this.round);
          this.pressPad(slip ? (want + 1 + Math.floor(this.ctx.rng() * (SAYS.PADS - 1))) % SAYS.PADS : want);
        }
      }
      return;
    }

    if (this.phase === 'roundWon') {
      this.stepT -= dt;
      if (this.stepT <= 0) this.startWatch();
      return;
    }

    if (this.phase === 'over') {
      this.endT += dt;
      if (this.endT >= 1.6) {
        this.phase = 'done';
        const finalScore = roundScore(this.roundsCompleted, this.avgReactionMs());
        if (this.autoplay) {
          console.log(`[goobySays] autoplay run ended — score ${finalScore} (rounds ${this.roundsCompleted})`);
        }
        // §B3 meta: round → quest q.says6 ('round:goobySays', mode max).
        ctx.onEnd({ score: finalScore, meta: { round: this.roundsCompleted } });
      }
    }
  },

  dispose() {
    this.offTap?.();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.pads = [];
    this.beams = [];
    this.ball = null;
    this.chordPending = null;
    this.stageGroup = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
