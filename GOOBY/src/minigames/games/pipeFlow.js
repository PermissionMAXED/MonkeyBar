// Pipe Panic (PLAN2 §C1.2 #9, agent V2/G25): water the garden the nerdy way —
// a 5×5 grid of pipe tiles (straight/bend/T) on a flat TOP-DOWN GARDEN
// BLUEPRINT (§C1.3 look: blueprint-blue sheet, chalk grid, white pipes). Tap
// tiles to rotate 90°; when the tap connects to the sprinkler the water flows
// with a fill animation and the next seeded puzzle deals in. 90 s fixed;
// score = 25·solved + tapEfficiencyBonus. Pure rules + the BFS solver live in
// pipeFlow.logic.js. Dev-only ?autoplay=1 replays the exported solver's taps.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'; // V2/FIX-F P1-1
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js';
import {
  PIPE,
  applyDifficulty,
  createPipeEndlessState,
  recordPipeFailure,
  DIRS,
  connectionsOf,
  rotateTile,
  rotationTarget,
  leakJointFor,
  leakPenaltyDue,
  generateBoard,
  waterReach,
  isSolved,
  solveBoard,
  pipeScore,
} from './pipeFlow.logic.js';

/** Tile pitch (wu) — 5 cells span 3.3 wu, comfortably inside a 320 px frame. */
const CELL = 0.66;
/** Pipe bar cross-section (wu). */
const PIPE_W = 0.17;
/** Board center offset (leaves headroom for the tap + footer for Gooby). */
const BOARD_Y = 0.55;
/** Colors: blueprint sheet + chalk pipes + water fill (§C1.3 look). */
const COLORS = Object.freeze({
  SHEET: '#1D4E89',
  SHEET_DEEP: '#173F70',
  PIPE: '#E8F1FB',
  PIPE_EDGE: '#2B5F9E',
  WATER: '#4FD8F7',
  BRASS: '#F2C14E',
});

/** Blueprint-sheet texture: grid lines, dashed garden beds, compass doodles. */
function makeBlueprintTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const g = canvas.getContext('2d');
  g.fillStyle = COLORS.SHEET;
  g.fillRect(0, 0, 512, 1024);
  // subtle paper vignette
  const grad = g.createRadialGradient(256, 512, 120, 256, 512, 620);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 1024);
  // fine grid
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 1024);
    g.stroke();
  }
  for (let y = 0; y <= 1024; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  // dashed garden-bed outlines + flower doodles (top-down garden plan)
  g.setLineDash([10, 8]);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 3;
  for (const [x, y, w, h] of [[36, 60, 130, 90], [350, 100, 120, 120], [50, 830, 150, 110], [330, 860, 140, 90]]) {
    g.strokeRect(x, y, w, h);
  }
  g.setLineDash([]);
  const flower = (x, y) => {
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 6, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.stroke();
  };
  flower(100, 105);
  flower(410, 160);
  flower(125, 885);
  flower(400, 905);
  // compass rose doodle
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  g.arc(452, 60, 26, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(452, 34);
  g.lineTo(452, 86);
  g.moveTo(426, 60);
  g.lineTo(478, 60);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * V2/FIX-F P1-1 (E17): one merged geometry per pipe shape (rot-0 arms + hub)
 * so a whole tile renders as ONE draw call instead of 3–4 (the uninstanced
 * 5×5 board pushed the base scene to ~139 calls; with the solve spray's 22
 * sprites the round breached the ≤150 §E10 budget at 161–168). The tile group
 * still rotates, so tap animation and water-fill tinting are unchanged.
 * @param {'straight'|'bend'|'tee'} shape
 * @param {THREE.BufferGeometry} armGeo
 * @param {THREE.BufferGeometry} hubGeo
 * @returns {THREE.BufferGeometry}
 */
function buildShapeGeo(shape, armGeo, hubGeo) {
  const parts = [];
  const m = new THREE.Matrix4();
  for (const dir of connectionsOf({ shape, rot: 0 })) {
    const arm = armGeo.clone();
    m.makeRotationZ(dir === DIRS.E || dir === DIRS.W ? Math.PI / 2 : 0);
    m.setPosition(
      (CELL / 4) * (dir === DIRS.E ? 1 : dir === DIRS.W ? -1 : 0),
      (CELL / 4) * (dir === DIRS.N ? 1 : dir === DIRS.S ? -1 : 0),
      0
    );
    arm.applyMatrix4(m);
    parts.push(arm);
  }
  const hub = hubGeo.clone();
  hub.applyMatrix4(m.makeRotationX(Math.PI / 2));
  parts.push(hub);
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

/** @type {object} §E8 plugin — fully procedural (no GLB assets). */
export default {
  id: 'pipeFlow',
  assetKeys: [],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.tune = applyDifficulty(PIPE, ctx.params?.difficulty ?? 'normal');
    this.endlessState = createPipeEndlessState(this.tune.ENDLESS_FAILURE_LIMIT);
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    this.phase = 'play'; // 'play' | 'fill' | 'ending' | 'done'
    this.solved = 0;
    this.totalTaps = 0;
    this.totalOptimal = 0;
    this.currentOptimal = 0;
    this.leakPenalties = 0;
    this.puzzleNo = 0;
    this.displayedScore = 0;
    this.endT = 0;
    this.fillT = 0;
    this.fillMax = 0;
    // human-ish autoplay pacing (§C1.2 #9 bot = BFS solver taps)
    this.botQueue = [];
    this.botT = 0;

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color(COLORS.SHEET_DEEP);

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

    // --- blueprint sheet backdrop (flat, top-down §C1.3) ---
    this.sheetTex = makeBlueprintTexture();
    this.ownedTexs.push(this.sheetTex);
    const sheet = own(new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 2 + 2, this.halfH * 2 + 2),
      new THREE.MeshBasicMaterial({ map: this.sheetTex, depthWrite: false })
    ));
    sheet.position.set(0, 0, -3);
    scene.add(sheet);

    // flat "drawing" light — even, shadowless (top-down plan style)
    scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xBBD1EA, 1.25));

    // --- shared tile resources ---
    const half = CELL / 2;
    this.armGeo = new THREE.BoxGeometry(PIPE_W, half + PIPE_W / 2, 0.12);
    this.hubGeo = new THREE.CylinderGeometry(PIPE_W * 0.72, PIPE_W * 0.72, 0.14, 12);
    this.baseGeo = new THREE.PlaneGeometry(CELL - 0.05, CELL - 0.05);
    this.ownedGeos.push(this.armGeo, this.hubGeo, this.baseGeo);
    this.baseMat = new THREE.MeshBasicMaterial({ color: COLORS.PIPE_EDGE, transparent: true, opacity: 0.5 });
    this.ownedMats.push(this.baseMat);
    this.leakGeo = new THREE.SphereGeometry(0.065, 10, 8);
    this.leakMat = new THREE.MeshBasicMaterial({
      color: COLORS.WATER, transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.ownedGeos.push(this.leakGeo);
    this.ownedMats.push(this.leakMat);
    // V2/FIX-F P1-1: one merged geometry per shape — a tile is 1 draw call
    this.shapeGeos = {
      straight: buildShapeGeo('straight', this.armGeo, this.hubGeo),
      bend: buildShapeGeo('bend', this.armGeo, this.hubGeo),
      tee: buildShapeGeo('tee', this.armGeo, this.hubGeo),
    };
    this.ownedGeos.push(this.shapeGeos.straight, this.shapeGeos.bend, this.shapeGeos.tee);

    // --- board group + fixtures (tap + sprinkler rebuilt per deal) ---
    this.boardGroup = new THREE.Group();
    this.boardGroup.position.set(0, BOARD_Y, 0);
    scene.add(this.boardGroup);
    this.fixtures = new THREE.Group();
    scene.add(this.fixtures);

    // V2/FIX-F P1-1: the 5×5 tile bases are static across deals — render all
    // of them as ONE InstancedMesh (was 25 meshes/draw calls); taps raycast
    // this mesh and read hit.instanceId as the cell index (cellAt below).
    {
      const size = PIPE.GRID;
      const origin = -((size - 1) / 2) * CELL;
      this.baseIM = new THREE.InstancedMesh(this.baseGeo, this.baseMat, size * size);
      const bm = new THREE.Matrix4();
      for (let idx = 0; idx < size * size; idx += 1) {
        const col = idx % size;
        const row = (idx - col) / size;
        bm.makeTranslation(origin + col * CELL, BOARD_Y + (-(origin + row * CELL)), -0.08);
        this.baseIM.setMatrixAt(idx, bm);
      }
      this.baseIM.instanceMatrix.needsUpdate = true;
      this.boardGroup.add(this.baseIM);
    }

    // --- Gooby foreman watching from the footer ---
    this.particles = createParticles(scene);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    this.gooby.group.scale.setScalar(0.6);
    this.gooby.group.position.set(this.halfW - 0.75, -this.halfH + 0.35, 0.5);
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    /** @type {Array<{group: THREE.Group, mats: THREE.MeshBasicMaterial[]}>} */
    this.tileViews = [];
    /** @type {THREE.Material[]} per-deal cloned pipe materials */
    this.dealMats = [];

    this.dealPuzzle();

    // --- input: tap a tile to rotate it 90° (§C1.2 #9) ---
    this.offTap = ctx.input.on('tap', (p) => {
      if (this.autoplay || this.phase !== 'play') return;
      const cell = this.cellAt(p);
      if (cell != null) this.tapTile(cell);
    });

    ctx.hud.setScore(0);
    ctx.hud.setTime(this.tune.ENDLESS ? 0 : this.tune.DURATION_SEC);
  },

  /** Deal the next seeded puzzle and (re)build its meshes. */
  dealPuzzle() {
    this.puzzleNo += 1;
    const seed = Math.floor(this.ctx.rng() * 2 ** 31);
    this.board = generateBoard(seed, this.tune);
    this.currentOptimal = this.board.optimalTaps;
    this.puzzleElapsed = 0;
    this.leakApplied = false;
    this.leakFxT = 0;
    this.leakJoint = leakJointFor(this.board, this.puzzleNo, this.tune);
    this.buildBoardMeshes();
    if (this.puzzleNo > 1) this.ctx.hud.banner(t('mg.pipe.puzzle', { n: this.puzzleNo }));
    if (this.autoplay) {
      const { taps } = solveBoard(this.board);
      this.botQueue = taps.slice();
      // Human-ish pacing (§C1.2 #9: ~3 puzzles / 90 s typical): a per-puzzle
      // think budget split into a study pause + evenly spread taps.
      const budget = (23 + this.ctx.rng() * 8) / this.tune.PREVIEW_SPEED_MULT;
      const study = (5 + this.ctx.rng() * 2.5) / this.tune.PREVIEW_SPEED_MULT;
      this.botTapInterval = THREE.MathUtils.clamp(
        (budget - study) / Math.max(1, this.botQueue.length), 0.8, 4.5
      );
      this.botT = study;
    }
  },

  /** Clear + rebuild tile meshes for the current board. */
  buildBoardMeshes() {
    for (const view of this.tileViews) {
      view.turnTween?.cancel();
      this.boardGroup.remove(view.group);
    }
    for (const mat of this.dealMats) mat.dispose();
    this.dealMats = [];
    this.tileViews = [];
    this.fixtures.clear();

    const { size, tiles, srcCol, goalCol } = this.board;
    const origin = -((size - 1) / 2) * CELL; // col/row 0 center
    this.cellCenter = (col, row) => new THREE.Vector3(
      origin + col * CELL,
      BOARD_Y - (origin + row * CELL) * -1 - 0, // row 0 at top
      0
    );

    for (let idx = 0; idx < size * size; idx += 1) {
      const col = idx % size;
      const row = (idx - col) / size;
      const group = new THREE.Group();
      group.position.set(origin + col * CELL, BOARD_Y + (-(origin + row * CELL)), 0);

      // V2/FIX-F P1-1: the tile base lives in the shared InstancedMesh (init);
      // the whole rot-0 pipe (arms + hub) is ONE merged-geometry mesh. The
      // mesh itself rotates, so a tap still animates one -90° turn.
      const pipeMat = new THREE.MeshBasicMaterial({ color: COLORS.PIPE });
      this.dealMats.push(pipeMat);
      const pipes = new THREE.Mesh(this.shapeGeos[tiles[idx].shape], pipeMat);
      pipes.name = 'pipes';
      pipes.rotation.z = -tiles[idx].rot * (Math.PI / 2);
      group.add(pipes);

      this.boardGroup.add(group);
      const view = { group, mats: [pipeMat], turns: tiles[idx].rot, turnTween: null };
      if (idx === this.leakJoint) {
        const drip = new THREE.Mesh(this.leakGeo, this.leakMat);
        drip.name = 'leak-joint';
        drip.position.set(0.12, -0.08, 0.13);
        group.add(drip);
        view.leak = drip;
      }
      this.tileViews.push(view);
    }

    // --- fixtures: brass tap above the source, sprinkler below the goal ---
    const brassMat = new THREE.MeshBasicMaterial({ color: COLORS.BRASS });
    const pipeMatFix = new THREE.MeshBasicMaterial({ color: COLORS.PIPE });
    this.dealMats.push(brassMat, pipeMatFix);
    const topY = BOARD_Y + (-(origin + 0 * CELL)) + CELL * 0.72;
    const tap = new THREE.Group();
    const tapStem = new THREE.Mesh(this.armGeo, pipeMatFix);
    tapStem.scale.y = 0.6;
    tap.add(tapStem);
    const tapBody = new THREE.Mesh(this.hubGeo, brassMat);
    tapBody.rotation.x = Math.PI / 2;
    tapBody.position.y = 0.16;
    tapBody.scale.setScalar(1.5);
    tap.add(tapBody);
    const handle = new THREE.Mesh(this.armGeo, brassMat);
    handle.scale.set(0.6, 0.42, 0.6);
    handle.rotation.z = Math.PI / 2;
    handle.position.y = 0.3;
    tap.add(handle);
    tap.position.set(origin + srcCol * CELL, topY, 0);
    this.fixtures.add(tap);

    const botY = BOARD_Y + (-(origin + (size - 1) * CELL)) - CELL * 0.72;
    const sprinkler = new THREE.Group();
    const sprStem = new THREE.Mesh(this.armGeo, pipeMatFix);
    sprStem.scale.y = 0.6;
    sprinkler.add(sprStem);
    const sprHead = new THREE.Mesh(this.hubGeo, brassMat);
    sprHead.rotation.x = Math.PI / 2;
    sprHead.position.y = -0.14;
    sprHead.scale.set(1.9, 1.9, 1.2);
    sprinkler.add(sprHead);
    sprinkler.position.set(origin + goalCol * CELL, botY, 0);
    this.fixtures.add(sprinkler);
    this.sprinklerPos = new THREE.Vector3(origin + goalCol * CELL, botY - 0.15, 0.2);
  },

  /** Map a tap payload to a cell index (raycast the base InstancedMesh). */
  cellAt(p) {
    // V2/FIX-F P1-1: instance order == cell index (built row-major in init)
    const hit = this.ctx.input.pick(this.ctx.camera, [this.baseIM], p);
    return hit && hit.instanceId != null ? hit.instanceId : null;
  },

  /** One 90° tap on a tile (§C1.2 #9) — rotate, count, check the flow. */
  tapTile(idx) {
    if (this.phase !== 'play') return;
    this.board.tiles[idx] = rotateTile(this.board.tiles[idx]);
    this.totalTaps += 1;
    this.ctx.audio.play('pipe.rotate');
    const pipes = this.tileViews[idx].group.getObjectByName('pipes');
    const view = this.tileViews[idx];
    view.turns += 1;
    const target = rotationTarget(view.turns);
    view.turnTween?.cancel();
    view.turnTween = tween({
      from: pipes.rotation.z,
      to: target,
      duration: this.tune.ROTATE_SEC,
      ease: easings.easeOutQuad,
      onUpdate: (v) => { pipes.rotation.z = v; },
      onComplete: () => { view.turnTween = null; },
    });
    if (isSolved(this.board)) this.startFill();
  },

  /** Water connects (§C1.2 #9): fill animation → score → next puzzle. */
  startFill() {
    this.phase = 'fill';
    this.solved += 1;
    this.totalOptimal += this.currentOptimal;
    this.ctx.audio.play('pipe.connect');
    this.ctx.hud.banner(t('mg.pipe.solved'));
    this.gooby.play('happyBounce');
    this.gooby.setEmotion('ecstatic');
    const { depths } = waterReach(this.board);
    this.fillDepths = depths;
    this.fillMax = Math.max(...depths.values()) + 1;
    this.fillT = 0;
    this.filledDepth = -1;
    // HUD score reflects 25·solved live; the efficiency bonus lands at onEnd.
    this.ctx.onScore(this.tune.SOLVE_POINTS);
    this.displayedScore += this.tune.SOLVE_POINTS;
  },

  /** Advance the fill animation; deal the next puzzle when done. */
  updateFill(dt) {
    this.fillT += dt;
    const depthNow = Math.floor(this.fillT / this.tune.FILL_STEP_SEC);
    if (depthNow > this.filledDepth) {
      this.filledDepth = depthNow;
      for (const [idx, depth] of this.fillDepths) {
        if (depth === depthNow) {
          for (const mat of this.tileViews[idx].mats) mat.color.set(COLORS.WATER);
        }
      }
      if (depthNow <= this.fillMax) this.ctx.audio.play('pipe.fill');
    }
    if (this.fillT > this.fillMax * this.tune.FILL_STEP_SEC + 0.25 && !this.sprayed) {
      this.sprayed = true;
      this.particles.emit('bubbles', this.sprinklerPos, { count: 14 });
      this.particles.emit('sparkles', this.sprinklerPos, { count: 8 });
    }
    if (this.fillT >= this.fillMax * this.tune.FILL_STEP_SEC + this.tune.FILL_END_DELAY_SEC) {
      this.sprayed = false;
      this.gooby.setEmotion('happy');
      this.phase = 'play';
      this.dealPuzzle();
    }
  },

  /** Dev-only autoplay: replay the BFS solver's taps at a human-ish pace. */
  autoplayTick(dt) {
    if (this.phase !== 'play') return;
    this.botT -= dt;
    if (this.botT > 0) return;
    if (this.botQueue.length === 0) {
      // defensive: recompute from the live board (never expected to trigger)
      const { taps, solvable } = solveBoard(this.board);
      if (!solvable || taps.length === 0) return;
      this.botQueue = taps;
    }
    this.botT = this.botTapInterval * (0.85 + this.ctx.rng() * 0.3);
    this.tapTile(this.botQueue.shift());
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.2 && this.phase !== 'done') {
        this.phase = 'done';
        const final = pipeScore(this.solved, this.totalTaps, this.totalOptimal, this.tune, this.leakPenalties);
        if (final !== this.displayedScore) ctx.onScore(final - this.displayedScore);
        ctx.onEnd({ score: final });
      }
      return;
    }

    const remaining = this.tune.DURATION_SEC - elapsed;
    ctx.hud.setTime(this.tune.ENDLESS ? elapsed : remaining);

    if (this.phase === 'play') {
      this.puzzleElapsed += dt;
      if (this.leakJoint != null) {
        this.leakFxT -= dt;
        const leakView = this.tileViews[this.leakJoint];
        if (leakView?.leak) {
          leakView.leak.position.y = -0.08 - ((this.puzzleElapsed * 1.8) % 1) * 0.2;
          leakView.leak.scale.setScalar(0.7 + 0.3 * Math.sin(this.puzzleElapsed * 8) ** 2);
          if (this.leakFxT <= 0) {
            this.leakFxT = 0.55;
            const world = leakView.leak.getWorldPosition(new THREE.Vector3());
            this.particles.emit('bubbles', world, { count: 2 });
          }
        }
        if (leakPenaltyDue(this.puzzleElapsed, this.leakApplied, this.tune)) {
          this.leakApplied = true;
          this.leakPenalties += 1;
          const delta = -Math.min(this.tune.LEAK_PENALTY, this.displayedScore);
          if (delta !== 0) {
            ctx.onScore(delta);
            this.displayedScore += delta;
          }
          ctx.audio.play('pipe.fill');
          ctx.hud.banner(t('v3.depth.pipe.leakPenalty', { n: this.tune.LEAK_PENALTY }));
          if (this.tune.ENDLESS) {
            if (recordPipeFailure(this.endlessState, 'leak')) this.finishRound();
            else this.dealPuzzle();
            return;
          }
        }
      }
    }
    if (this.phase === 'fill') this.updateFill(dt);
    if (this.autoplay) this.autoplayTick(dt);

    // idle sway: sprinkler-to-be garden plan breathes a little
    this.boardGroup.rotation.z = Math.sin(elapsed * 0.4) * 0.004;

    if (!this.tune.ENDLESS && remaining <= 0 && this.phase !== 'ending') {
      this.phase = 'ending';
      const final = pipeScore(this.solved, this.totalTaps, this.totalOptimal, this.tune, this.leakPenalties);
      ctx.audio.play('ui.win');
      this.gooby.setEmotion(this.solved > 0 ? 'ecstatic' : 'sad');
      if (this.solved > 0) this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1, 0)), { count: 14 });
      if (this.autoplay) {
        console.log(
          `[pipeFlow] autoplay run ended — solved ${this.solved}, ` +
          `taps ${this.totalTaps}/opt ${this.totalOptimal}, leaks ${this.leakPenalties}, score ${final}`
        );
      }
    }
  },

  finishRound() {
    if (this.phase === 'ending' || this.phase === 'done') return;
    this.phase = 'ending';
    this.endT = 0;
    this.ctx.audio.play('ui.win');
    this.gooby.setEmotion(this.solved > 0 ? 'ecstatic' : 'sad');
  },

  dispose() {
    this.offTap?.();
    for (const view of this.tileViews ?? []) view.turnTween?.cancel();
    this.particles?.dispose();
    this.gooby?.dispose();
    this.baseIM?.dispose(); // V2/FIX-F P1-1: frees the instanceMatrix buffer
    this.baseIM = null;
    this.shapeGeos = null; // V2/FIX-F P1-1 (geometries are in ownedGeos)
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    for (const mat of this.dealMats ?? []) mat.dispose();
    this.tileViews = [];
    this.dealMats = [];
    this.fixtures = null;
    this.boardGroup = null;
    this.board = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.tune = null;
    this.endlessState = null;
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
