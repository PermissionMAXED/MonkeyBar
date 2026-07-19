// Dance Party (§C6.1 #9, agent G10): 3-lane note-tap rhythm at 100 BPM on a
// disco stage. The seeded 75 s pattern comes from danceParty.logic.js
// (DANCE.PATTERN_SEED — the §D6/G14 music contract); note timing follows an
// absolute-time-base song clock (createSongClock, F6/RE5) that phase-locks to
// G14's WebAudio music clock (audio.getMusicTime()) when available and falls
// back to a performance.now()-anchored wall clock — so it stays in tempo with
// the 100 BPM track at any FPS. Hit windows perfect ≤70 ms (+4) /
// good ≤140 ms (+2) / miss (combo reset); score = sum − 2×misses. Gooby
// dances center-stage — dance energy follows the combo (bigger moves, fever
// confetti at high tiers). Disco: colored sweeping spot lights, procedural
// faceted mirror ball, pulsing floor tiles.
//
// Dev-only ?autoplay=1: a middling-human bot taps the pattern with timing
// error for headless verification (targets the §C6 ~16c typical payout).

import * as THREE from 'three';
import { DANCE, UI_COLORS } from '../../data/constants.js';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  DANCE_TUNING,
  createSongClock, // F6 (RE5 P1): absolute-time-base song clock
  generatePattern,
  classifyHit,
  judgeTap,
  createTally,
  applyJudgment,
  danceScore,
  comboTier,
  createFeverChain,
  advanceFeverChain,
  encoreActive,
  encoreBonus,
  noteLifecycle,
} from './danceParty.logic.js';

/** Stage geometry (world units at the z=0 play plane, camera z=10 FOV 45). */
const HIT_Y = -2.7;
const SPAWN_Y = 1.1;
const LANE_X = [-1.25, 0, 1.25];
const LANE_COLORS = [UI_COLORS.PRIMARY_PINK, UI_COLORS.TEAL, UI_COLORS.YELLOW];
const TILE_COLORS = [0xff7ba9, 0x59c9b9, 0xffd166, 0x9b8cff];

/** Tiny floating score text (canvas-texture sprites, self-disposing). */
function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#FFFFFF') {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(23,16,51,0.85)';
      g.strokeText(text, 128, 40);
      g.fillStyle = color;
      g.fillText(text, 128, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      // F4 P2-3: keep edge-lane popups fully inside the safe viewport
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.8, halfH: 0.25 }));
      sprite.scale.set(1.6, 0.5, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.8 });
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
  id: 'danceParty',
  assetKeys: [], // fully procedural stage

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.tally = createTally();
    this.feverChain = createFeverChain();
    this.shownScore = 0;
    this.endT = 0;
    this.grumpyT = 0;
    this.tier = 0;
    this.beatSec = 60 / DANCE.BPM;
    this.lastBeat = -1;

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#171033'); // dark club purple

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    const own = (mesh) => {
      this.ownedGeos.push(mesh.geometry);
      this.ownedMats.push(mesh.material);
      return mesh;
    };

    // --- pattern (the §D6/G14 seed contract) ---
    /** @type {Array<{time:number,lane:number,hit?:boolean,missed?:boolean,mesh?:THREE.Group}>} */
    this.notes = generatePattern(DANCE.PATTERN_SEED).map((n) => ({ ...n }));
    this.nextSpawn = 0; // index of the next note to get a mesh
    this.headIdx = 0; //   index of the first note that can still be judged

    // --- lighting: dim ambient + 3 colored sweeping spots ---
    scene.add(new THREE.HemisphereLight(0x8878c8, 0x1a1030, 0.55));
    /** @type {Array<{light: THREE.SpotLight, phase: number}>} */
    this.spots = [];
    for (let i = 0; i < 3; i += 1) {
      // decay 0 → stylized club beams (no physical falloff, cheap + readable)
      const spot = new THREE.SpotLight(TILE_COLORS[i], 2.6, 24, 0.5, 0.55, 0);
      spot.position.set((i - 1) * 1.6, this.halfH + 0.5, 2.5);
      spot.target.position.set((i - 1) * 1.2, 1.0, -2);
      scene.add(spot, spot.target);
      this.spots.push({ light: spot, phase: (i / 3) * Math.PI * 2 });
    }

    // --- disco floor: tilted grid of pulsing tiles under Gooby ---
    this.tiles = [];
    const tileGeo = new THREE.PlaneGeometry(0.72, 0.72);
    this.ownedGeos.push(tileGeo);
    const floorGrp = new THREE.Group();
    floorGrp.position.set(0, 0.55, -2.4);
    floorGrp.rotation.x = -1.05; // tilted toward the camera like a stage floor
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const mat = new THREE.MeshBasicMaterial({ color: TILE_COLORS[(r + c) % 4] });
        this.ownedMats.push(mat);
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.position.set((c - 2) * 0.78, (r - 1) * 0.78, 0);
        floorGrp.add(tile);
        this.tiles.push({ mat, idx: r + c, base: new THREE.Color() });
      }
    }
    scene.add(floorGrp);

    // --- glow halo behind Gooby ---
    const halo = own(new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff7ba9, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    ));
    halo.position.set(0, 1.75, -2.6);
    scene.add(halo);
    this.halo = halo;

    // --- procedural mirror ball (faceted icosphere on a rod) + sparkles ---
    const ball = own(new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.45, 1),
      new THREE.MeshStandardMaterial({
        color: 0xcfd6e8, metalness: 0.9, roughness: 0.18,
        flatShading: true, emissive: 0x333a55,
      })
    ));
    ball.position.set(0, this.halfH - 0.75, -1.8);
    scene.add(ball);
    this.mirrorBall = ball;
    const rod = own(new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6),
      new THREE.MeshBasicMaterial({ color: 0x555a70 })
    ));
    rod.position.set(0, this.halfH - 0.1, -1.8);
    scene.add(rod);
    this.sparkleT = 0;

    // --- Gooby center-stage (dance clip loops; energy scales with combo) ---
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);
    this.danceGrp = new THREE.Group(); // external energy bob/pulse wrapper
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.position.set(0, 1.15, -1.6);
    this.gooby.setEmotion('happy');
    this.gooby.play('dance', { loop: true });
    this.danceGrp.add(this.gooby.group);
    scene.add(this.danceGrp);

    // --- lanes: translucent guides + hit rings + pooled note discs ---
    const laneGeo = new THREE.PlaneGeometry(1.02, SPAWN_Y - HIT_Y + 1.0);
    this.ownedGeos.push(laneGeo);
    this.rings = [];
    for (let l = 0; l < DANCE.LANES; l += 1) {
      const laneMat = new THREE.MeshBasicMaterial({
        color: LANE_COLORS[l], transparent: true, opacity: 0.07, depthWrite: false,
      });
      this.ownedMats.push(laneMat);
      const lane = new THREE.Mesh(laneGeo, laneMat);
      lane.position.set(LANE_X[l], (SPAWN_Y + HIT_Y) / 2 + 0.2, 0.2);
      scene.add(lane);

      const ring = own(new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.37, 32),
        new THREE.MeshBasicMaterial({
          color: LANE_COLORS[l], transparent: true, opacity: 0.55, depthWrite: false,
        })
      ));
      ring.position.set(LANE_X[l], HIT_Y, 0.3);
      scene.add(ring);
      this.rings.push(ring);
    }

    // note mesh pool: disc + rim per lane color
    this.noteGeo = new THREE.CircleGeometry(0.3, 24);
    this.rimGeo = new THREE.RingGeometry(0.3, 0.36, 24);
    this.ownedGeos.push(this.noteGeo, this.rimGeo);
    /** @type {THREE.Group[][]} free note meshes per lane */
    this.notePool = [[], [], []];

    // --- input: raw pointerdown for rhythm-accurate lane taps (precedent:
    // city/carController.js thumb zones — ctx.input's 'tap' fires on
    // pointer-UP which is too late for a rhythm judgment) ---
    this.songTime = -DANCE_TUNING.LEAD_IN_SEC;
    // F6 (RE5 P1): absolute time base — phase-locks to the WebAudio music
    // clock when available; wall-clock fallback otherwise. Pauses freeze it
    // via the framework onResume hook (rebase) + the frame-gap safety net.
    this.songClock = createSongClock();
    this.onPointerDown = (e) => {
      if (this.phase !== 'play' || this.autoplay) return;
      const lane = Math.min(DANCE.LANES - 1, Math.max(0, Math.floor((e.clientX / innerWidth) * DANCE.LANES)));
      this.tapLane(lane);
    };
    ctx.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

    // --- autoplay plan: middling human (skip 12%, timing σ ≈ 125 ms) ---
    if (this.autoplay) {
      const rng = ctx.rng;
      this.plan = [];
      for (const [i, n] of this.notes.entries()) {
        // V3/G44: the opening streak deterministically demonstrates Fever →
        // Encore in every autoplay proof; the rest keeps the human-ish model.
        if (i < DANCE_TUNING.TIER_COMBOS[2] + DANCE_TUNING.ENCORE_PERFECTS - 1) {
          this.plan.push({ at: n.time, lane: n.lane });
          continue;
        }
        if (rng() < 0.12) continue; // zoned out — the note will be a miss
        const err = (rng() + rng() + rng() - 1.5) * 0.25; // ~N(0, 0.125 s)
        this.plan.push({ at: n.time + err, lane: n.lane });
      }
      this.plan.sort((a, b) => a.at - b.at);
      this.planIdx = 0;
    }

    // beat source contract (§D6): the stub logs, G14's real track takes over.
    ctx.audio.music('dance');
    ctx.hud.setScore(0);
    ctx.hud.setTime(DANCE.DURATION_SEC);
  },

  /**
   * F6 (RE5): §E8 optional resume hook (framework pause/resume) — re-anchor
   * the song clock so the paused span (the music keeps playing through the
   * overlay) never advances the chart, however long the pause lasted.
   */
  onResume() {
    this.songClock?.rebase();
  },

  /** Reflect the §C6.1 score formula in the HUD (framework accumulates deltas). */
  syncScore() {
    const s = danceScore(this.tally);
    if (s !== this.shownScore) {
      this.ctx.onScore(s - this.shownScore);
      this.shownScore = s;
    }
  },

  /** Flash a lane's hit ring. */
  flashRing(lane, strong) {
    const ring = this.rings[lane];
    tween({
      from: strong ? 1.7 : 1.35, to: 1, duration: 0.22, ease: easings.easeOutCubic,
      onUpdate: (v) => ring.scale.setScalar(v),
    });
  },

  /** Judge a tap in a lane at the current song time. */
  tapLane(lane) {
    const idx = judgeTap(this.notes, lane, this.songTime);
    if (idx === -1) {
      this.ctx.audio.play('dance.tapEmpty');
      this.flashRing(lane, false);
      return;
    }
    const note = this.notes[idx];
    note.hit = true;
    this.releaseNoteMesh(note);
    const kind = classifyHit(this.songTime - note.time) ?? 'good';
    const doubled = encoreActive(this.feverChain, this.songTime);
    applyJudgment(this.tally, kind);
    const bonus = encoreBonus(kind, doubled);
    this.tally.bonus += bonus;
    const fever = advanceFeverChain(this.feverChain, kind, this.tally.combo, this.songTime);
    if (fever.started) {
      this.ctx.hud.banner(t('v3.depth.dance.encore'));
      this.ctx.audio.play('dance.tierUpAccent');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 18 });
    }
    this.syncScore();
    const pos = new THREE.Vector3(LANE_X[lane], HIT_Y + 0.35, 0.5);
    if (kind === 'perfect') {
      this.ctx.audio.play('dance.perfect');
      this.floats.spawn(`+${DANCE.PERFECT_PTS + bonus} ${t('mg.dance.perfect')}`, pos, doubled ? '#FF7BA9' : '#FFE08A');
      this.particles.emit('sparkles', new THREE.Vector3(LANE_X[lane], HIT_Y, 0.4), { count: 8 });
    } else {
      this.ctx.audio.play('dance.good');
      this.floats.spawn(`+${DANCE.GOOD_PTS + bonus} ${t('mg.dance.good')}`, pos, doubled ? '#FF7BA9' : '#BFE6F7');
      this.particles.emit('sparkles', new THREE.Vector3(LANE_X[lane], HIT_Y, 0.4), { count: 3 });
    }
    this.flashRing(lane, kind === 'perfect');
    if (this.tally.combo > 0 && this.tally.combo % 8 === 0) {
      this.ctx.hud.banner(t('mg.dance.combo', { n: this.tally.combo }));
    }
    this.updateEnergy();
  },

  /** A note crossed the line un-hit → miss (§C6.1: combo reset, −2). */
  missNote(note, quiet = false) {
    note.missed = true;
    this.releaseNoteMesh(note);
    applyJudgment(this.tally, 'miss');
    advanceFeverChain(this.feverChain, 'miss', this.tally.combo, this.songTime);
    this.syncScore();
    if (!quiet) {
      this.ctx.audio.play('dance.miss');
      this.floats.spawn(t('mg.dance.miss'), new THREE.Vector3(LANE_X[note.lane], HIT_Y + 0.3, 0.5), '#8A8098');
    }
    this.grumpyT = 0.8;
    this.gooby.setEmotion('grumpy');
    this.updateEnergy();
  },

  /** Combo → dance-energy tier: emotion + fever feedback on tier-up. */
  updateEnergy() {
    const tier = comboTier(this.tally.combo);
    if (tier === this.tier) return;
    const up = tier > this.tier;
    this.tier = tier;
    if (this.grumpyT <= 0) this.gooby.setEmotion(tier >= 2 ? 'ecstatic' : 'happy');
    if (up && tier === 3) {
      this.ctx.hud.banner(t('mg.dance.fever'));
      this.ctx.audio.play('dance.fever');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 14 });
    } else if (up) {
      this.ctx.audio.play('dance.tierUp');
      this.ctx.audio.play('dance.tierUpAccent'); // V3/G32 (§C3.4): jingles_HIT00 accent on the sfx bus — synth track untouched
    }
  },

  /** Take a pooled note mesh for a lane. */
  takeNoteMesh(lane) {
    const free = this.notePool[lane];
    if (free.length > 0) {
      const g = free.pop();
      g.visible = true;
      return g;
    }
    const grp = new THREE.Group();
    const discMat = new THREE.MeshBasicMaterial({ color: LANE_COLORS[lane] });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.ownedMats.push(discMat, rimMat);
    grp.add(new THREE.Mesh(this.noteGeo, discMat), new THREE.Mesh(this.rimGeo, rimMat));
    this.ctx.scene.add(grp);
    return grp;
  },

  releaseNoteMesh(note) {
    if (!note.mesh) return;
    note.mesh.visible = false;
    this.notePool[note.lane].push(note.mesh);
    note.mesh = null;
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    // F6 (RE5 P1): the song clock uses an ABSOLUTE time base — the WebAudio
    // music clock (true phase lock with the 100 BPM track) when available,
    // else a performance.now()-anchored wall clock. F4's per-frame
    // max(dt, gap) stepping accumulated one-sided rAF-vs-performance.now()
    // jitter (~10% fast at healthy FPS); re-deriving from an anchor every
    // frame makes jitter non-accumulating. Explicit pauses freeze the clock
    // exactly (framework onResume → songClock.rebase()); wall gaps beyond
    // DRIFT_MAX_FRAME_GAP_SEC (update stopped without a pause hook) also
    // re-anchor without advancing as a safety net.
    if (this.phase === 'play') {
      const wallSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      this.songTime = this.songClock.tick(wallSec, ctx.audio?.getMusicTime?.() ?? null);
    }

    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    // stage life (keeps pulsing through the ending celebration too)
    const beatPhase = ((elapsed / this.beatSec) % 1 + 1) % 1;
    const beatIdx = Math.floor(elapsed / this.beatSec);
    const pulse = 1 - beatPhase * 0.6;
    for (const tl of this.tiles) {
      tl.base.setHex(TILE_COLORS[(tl.idx + beatIdx) % TILE_COLORS.length]);
      tl.mat.color.copy(tl.base).multiplyScalar(0.45 + 0.55 * pulse);
    }
    this.mirrorBall.rotation.y += dt * 0.9;
    this.mirrorBall.scale.setScalar(1 + 0.05 * pulse);
    this.sparkleT -= dt;
    if (this.sparkleT <= 0) {
      this.sparkleT = 0.5;
      this.particles.emit('sparkles', this.mirrorBall.position, { count: 2 });
    }
    for (const s of this.spots) {
      s.phase += dt * (0.8 + this.tier * 0.25);
      s.light.target.position.x = Math.sin(s.phase) * 1.7;
      s.light.target.position.y = 1.0 + Math.cos(s.phase * 0.7) * 0.6;
    }
    const encore = encoreActive(this.feverChain, this.songTime);
    this.halo.material.opacity = 0.1 + 0.1 * pulse + this.tier * 0.03 + (encore ? 0.12 : 0);
    // dance energy: external bob/pulse on top of the (BPM-synced) dance clip
    const energy = this.tier / 3;
    this.danceGrp.position.y = Math.abs(Math.sin(elapsed * Math.PI / this.beatSec)) * 0.14 * energy;
    this.danceGrp.rotation.z = Math.sin(elapsed * Math.PI / this.beatSec) * 0.07 * energy;
    const ps = 1 + 0.06 * energy * pulse;
    this.danceGrp.scale.set(ps, ps, ps);

    if (this.grumpyT > 0) {
      this.grumpyT -= dt;
      if (this.grumpyT <= 0) this.gooby.setEmotion(this.tier >= 2 ? 'ecstatic' : 'happy');
    }

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= DANCE_TUNING.END_DELAY_SEC && this.phase !== 'done') {
        this.phase = 'done';
        ctx.onEnd({ score: danceScore(this.tally) });
      }
      return;
    }

    // song clock: stepped above (absolute time base — F6/RE5)
    ctx.hud.setTime(DANCE.DURATION_SEC - this.songTime);

    // autoplay taps
    if (this.autoplay && this.plan) {
      while (this.planIdx < this.plan.length && this.plan[this.planIdx].at <= this.songTime) {
        this.tapLane(this.plan[this.planIdx].lane);
        this.planIdx += 1;
      }
    }

    // spawn note meshes entering the travel window
    while (this.nextSpawn < this.notes.length) {
      const n = this.notes[this.nextSpawn];
      const lifecycle = noteLifecycle(n.time, this.songTime);
      if (lifecycle === 'future') break;
      if (lifecycle === 'expired') this.missNote(n, true);
      else n.mesh = this.takeNoteMesh(n.lane);
      this.nextSpawn += 1;
    }

    // move live notes; flag misses once past the good window
    const missAt = DANCE.GOOD_MS / 1000;
    for (let i = this.headIdx; i < this.nextSpawn; i += 1) {
      const n = this.notes[i];
      if (n.hit || n.missed) {
        if (i === this.headIdx) this.headIdx += 1;
        continue;
      }
      const dtToHit = n.time - this.songTime;
      if (dtToHit < -missAt) {
        this.missNote(n);
        continue;
      }
      if (n.mesh) {
        n.mesh.position.set(
          LANE_X[n.lane],
          HIT_Y + (dtToHit / DANCE_TUNING.NOTE_TRAVEL_SEC) * (SPAWN_Y - HIT_Y),
          0.4
        );
        const appear = Math.min(1, (DANCE_TUNING.NOTE_TRAVEL_SEC - dtToHit) * 5);
        n.mesh.scale.setScalar(appear * (dtToHit < 0.1 ? 1.1 : 1));
      }
    }

    if (this.songTime >= DANCE.DURATION_SEC) {
      this.phase = 'ending';
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.stop('dance');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.3, 0)), { count: 18 });
      if (this.autoplay) {
        const { perfect, good, miss, maxCombo } = this.tally;
        console.log(
          `[danceParty] autoplay run ended — score ${danceScore(this.tally)} ` +
          `(perfect ${perfect}, good ${good}, miss ${miss}, maxCombo ${maxCombo}, ` +
          `encores ${this.feverChain.encores}, notes ${this.notes.length})`
        );
      }
    }
  },

  dispose() {
    this.ctx?.renderer?.domElement?.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx?.audio?.music(null);
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    this.ownedGeos = [];
    this.ownedMats = [];
    this.notes = [];
    this.notePool = null;
    this.tiles = [];
    this.rings = [];
    this.spots = [];
    this.plan = null;
    this.songClock = null;
    this.feverChain = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
    this.danceGrp = null;
    this.mirrorBall = null;
    this.halo = null;
    this.ctx = null;
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
