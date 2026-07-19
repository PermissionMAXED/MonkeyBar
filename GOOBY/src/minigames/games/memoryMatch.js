// Memory Match (§C6.1 #5, agent G8): 4×4 card grid (8 pairs; 6×4 with 12
// pairs at level ≥6 — §C1.5). Card backs are a procedural pastel pattern,
// faces are mini food GLBs parented to the cards, revealed by a flip
// animation. Score = 20 − misses + timeBonus(0–8). No fail state. Pure
// layout/deck/score logic in memoryMatch.logic.js. Dev-only ?autoplay=1.
//
// Level source: ctx.params.level when the launcher provides it; otherwise the
// dev-harness store handle (§E9 window.__gooby — games must not import the
// store directly per §E8). Defaults to 1 (small layout).

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import {
  MEMORY,
  FACE_KEYS,
  layoutForLevel,
  buildDeck,
  memoryScore,
  isMatch,
  advancePeekProgress,
  canUsePeek,
  canFlipCard,
} from './memoryMatch.logic.js';

/** Procedural pastel card-back texture (dots on pink, shared per round). */
function makeBackTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#FF9EBF';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#FF7BA9';
  g.lineWidth = 6;
  g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#FFF6EC';
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      g.beginPath();
      g.arc(24 + x * 27 + (y % 2) * 12, 26 + y * 27, 5.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  return new THREE.CanvasTexture(canvas);
}

/** @type {object} §E8 plugin */
export default {
  id: 'memoryMatch',
  assetKeys: FACE_KEYS.map((k) => `food-kit/${k}`),

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';

    const level = Number.isFinite(ctx.params?.level)
      ? ctx.params.level
      : (globalThis.__gooby?.store?.get?.('level') ?? 1);
    this.layout = layoutForLevel(level);

    this.phase = 'play';
    this.misses = 0;
    this.matched = 0;
    this.finished = 0; // elapsed at completion (for the time bonus)
    this.endT = 0;
    this.revealT = 0;
    this.peekT = 0;
    this.peekUsed = false;
    this.peekReady = false;
    this.cleanMatches = 0;
    this.peekUses = 0;
    this.peekedIndices = [];
    this.autoT = 0.6;
    /** @type {number[]} indices of the currently face-up unresolved cards */
    this.picked = [];
    /** @type {Map<number, number[]>} autoplay memory: pairId → seen card indices */
    this.memoryMap = new Map();

    const camera = ctx.camera;
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10;
    this.halfW = this.halfH * (innerWidth / innerHeight);

    const scene = ctx.scene;
    scene.background = new THREE.Color('#EAF6EE');

    this.ownedGeos = [];
    this.ownedMats = [];

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0xd8e8d0, 1.2));
    const dirLight = new THREE.DirectionalLight(0xfff2dd, 0.85);
    dirLight.position.set(2, 4, 6);
    scene.add(dirLight);

    // --- shared card geometry/materials ---
    this.backTex = makeBackTexture();
    const cardGeo = new THREE.PlaneGeometry(MEMORY.CARD_W, MEMORY.CARD_H);
    const backMat = new THREE.MeshStandardMaterial({ map: this.backTex, roughness: 0.85 });
    const faceMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.9 });
    const matchedMat = new THREE.MeshStandardMaterial({ color: '#DFF3D8', roughness: 0.9 });
    this.ownedGeos.push(cardGeo);
    this.ownedMats.push(backMat, faceMat, matchedMat);
    this.matchedMat = matchedMat;

    // --- deck + grid ---
    const { cols, rows, pairs } = this.layout;
    const deck = buildDeck(pairs, ctx.rng);
    const gridH = (rows - 1) * MEMORY.SPACING_Y;
    const originY = gridH / 2 - 0.75; // shifted down, Gooby watches from the top
    const originX = -((cols - 1) * MEMORY.SPACING_X) / 2;

    /** @type {Array<{group: THREE.Group, flipper: THREE.Group, pairId: number, state: 'down'|'up'|'matched'}>} */
    this.cards = [];
    deck.forEach((pairId, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const group = new THREE.Group();
      group.position.set(
        originX + col * MEMORY.SPACING_X,
        originY - row * MEMORY.SPACING_Y,
        0
      );

      const flipper = new THREE.Group();
      const back = new THREE.Mesh(cardGeo, backMat);
      back.position.z = 0.012;
      const face = new THREE.Mesh(cardGeo, faceMat);
      face.position.z = -0.012;
      face.rotation.y = Math.PI;
      flipper.add(back, face);

      const food = this.ctx.assets.getModel(`food-kit/${FACE_KEYS[pairId]}`);
      const box = new THREE.Box3().setFromObject(food);
      const size = box.getSize(new THREE.Vector3());
      food.scale.setScalar(0.62 / (Math.max(size.x, size.y, size.z) || 1));
      box.setFromObject(food);
      const center = box.getCenter(new THREE.Vector3());
      food.position.sub(center);
      const foodHolder = new THREE.Group();
      foodHolder.add(food);
      foodHolder.position.z = -0.16;
      foodHolder.rotation.y = Math.PI;
      foodHolder.rotation.x = 0.25; // tilt the mini toward the camera when revealed
      // the 3D mini is deeper than the card offset and would poke through the
      // back — hidden while face-down, shown at the flip halfway point
      foodHolder.visible = false;
      flipper.add(foodHolder);

      group.add(flipper);
      group.userData.cardIndex = i;
      this.ctx.scene.add(group);
      this.cards.push({ group, flipper, face, food: foodHolder, pairId, state: 'down' });
    });

    // --- Gooby cameo above the grid, watching the reveals ---
    this.particles = createParticles(scene);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.scale.setScalar(0.72);
    this.gooby.group.position.set(0, originY + 0.85, -0.4);
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // --- V3 peek powerup: earned after three matches without a miss ---
    this.peekToken = new THREE.Group();
    const peekRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.08, 8, 18),
      new THREE.MeshStandardMaterial({
        color: '#FFD54F',
        emissive: '#7A4B00',
        emissiveIntensity: 0.35,
        roughness: 0.35,
      })
    );
    const peekEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 8),
      new THREE.MeshStandardMaterial({ color: '#4A3B36', roughness: 0.5 })
    );
    peekEye.position.z = 0.03;
    this.peekToken.add(peekRing, peekEye);
    this.peekToken.position.set(-this.halfW + 0.5, originY + 0.85, 0.15);
    this.peekToken.visible = false;
    scene.add(this.peekToken);
    this.ownedGeos.push(peekRing.geometry, peekEye.geometry);
    this.ownedMats.push(peekRing.material, peekEye.material);

    // --- input: tap a face-down card ---
    this.offTap = ctx.input.on('tap', (p) => {
      if (this.autoplay) return;
      if (this.peekToken.visible && ctx.input.pick(ctx.camera, [this.peekToken], p)) {
        this.usePeek();
        return;
      }
      const targets = this.cards.filter((c) => c.state === 'down').map((c) => c.group);
      const hit = ctx.input.pick(ctx.camera, targets, p);
      if (!hit) return;
      let obj = hit.object;
      while (obj && obj.userData.cardIndex === undefined) obj = obj.parent;
      if (obj) this.flipUp(obj.userData.cardIndex);
    });

    ctx.hud.setScore(MEMORY.SCORE_BASE);
    ctx.hud.setTime(0);
  },

  flipUp(index) {
    const card = this.cards[index];
    if (!card || !canFlipCard({
      phase: this.phase,
      pickedCount: this.picked.length,
      cardState: card.state,
      peeking: this.peekT > 0,
    })) return;
    card.state = 'up';
    this.picked.push(index);
    this.ctx.audio.play('card.flip');
    const flipper = card.flipper;
    const food = card.food;
    tween({
      from: 0, to: Math.PI, duration: 0.28, ease: easings.easeInOutQuad,
      onUpdate: (v) => {
        flipper.rotation.y = v;
        flipper.position.z = Math.sin(v) * 0.3; // lift while turning
        food.visible = v > Math.PI / 2; // mini appears past the halfway point
      },
    });
    this.gooby.lookAt(card.group.getWorldPosition(new THREE.Vector3()));

    // autoplay memory: remember what this card shows
    if (!this.memoryMap.has(card.pairId)) this.memoryMap.set(card.pairId, []);
    const seen = this.memoryMap.get(card.pairId);
    if (!seen.includes(index)) seen.push(index);

    if (this.picked.length === 2) {
      const [a, b] = this.picked;
      if (isMatch(this.cards[a].pairId, this.cards[b].pairId)) {
        this.resolveMatch(a, b);
      } else {
        this.revealT = MEMORY.REVEAL_SEC; // flip back after the reveal delay (dt-driven)
      }
    }
  },

  resolveMatch(a, b) {
    for (const i of [a, b]) {
      const card = this.cards[i];
      card.state = 'matched';
      card.face.material = this.matchedMat;
      const grp = card.group;
      tween({
        from: 1, to: 1.06, duration: 0.3, ease: easings.easeOutBack,
        onUpdate: (v) => grp.scale.setScalar(v),
      });
      this.particles.emit('sparkles', card.group.position.clone(), { count: 5 });
    }
    this.picked = [];
    this.matched += 1;
    const progress = advancePeekProgress({
      cleanMatches: this.cleanMatches,
      peekReady: this.peekReady,
      peekUsed: this.peekUsed,
    }, true);
    this.cleanMatches = progress.cleanMatches;
    const justEarned = !this.peekReady && progress.peekReady;
    this.peekReady = progress.peekReady;
    this.peekToken.visible = canUsePeek(this);
    if (justEarned) this.ctx.hud.banner(t('mg.memory.peekReady'));
    this.ctx.audio.play('card.match');
    this.gooby.play('happyBounce');
  },

  flipBackPicked() {
    for (const i of this.picked) {
      const card = this.cards[i];
      card.state = 'down';
      const flipper = card.flipper;
      const food = card.food;
      tween({
        from: Math.PI, to: 0, duration: 0.28, ease: easings.easeInOutQuad,
        onUpdate: (v) => {
          flipper.rotation.y = v;
          flipper.position.z = Math.sin(v) * 0.3;
          food.visible = v > Math.PI / 2;
        },
      });
    }
    this.picked = [];
    this.misses += 1;
    const progress = advancePeekProgress({
      cleanMatches: this.cleanMatches,
      peekReady: this.peekReady,
      peekUsed: this.peekUsed,
    }, false);
    this.cleanMatches = progress.cleanMatches;
    this.peekReady = progress.peekReady;
    this.ctx.hud.setScore(Math.max(0, MEMORY.SCORE_BASE - this.misses));
    this.ctx.audio.play('card.nomatch');
    this.gooby.play('refuse');
  },

  usePeek() {
    if (!canUsePeek(this) || this.phase !== 'play' || this.picked.length > 0) return;
    this.peekReady = false;
    this.peekUsed = true;
    this.peekUses += 1;
    this.peekT = MEMORY.PEEK_SEC;
    this.peekToken.visible = false;
    this.peekedIndices = [];
    for (let i = 0; i < this.cards.length; i += 1) {
      const card = this.cards[i];
      if (card.state !== 'down') continue;
      this.peekedIndices.push(i);
      card.flipper.rotation.y = Math.PI;
      card.food.visible = true;
      if (!this.memoryMap.has(card.pairId)) this.memoryMap.set(card.pairId, []);
      const seen = this.memoryMap.get(card.pairId);
      if (!seen.includes(i)) seen.push(i);
    }
    this.ctx.audio.play('card.flip');
    this.ctx.hud.banner(t('mg.memory.peek'));
    this.particles.emit('sparkles', this.peekToken.position.clone(), { count: 10 });
  },

  endPeek() {
    for (const i of this.peekedIndices) {
      const card = this.cards[i];
      if (card?.state !== 'down') continue;
      card.flipper.rotation.y = 0;
      card.flipper.position.z = 0;
      card.food.visible = false;
    }
    this.peekedIndices = [];
  },

  /** Dev-only autoplay: good-not-perfect memory with human-ish flip cadence. */
  autoplayTick(dt) {
    if (this.picked.length >= 2) return;
    if (canUsePeek(this) && this.picked.length === 0) {
      this.usePeek();
      return;
    }
    this.autoT -= dt;
    if (this.autoT > 0) return;
    this.autoT = 0.55 + this.ctx.rng() * 0.4;

    const downCards = this.cards
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.state === 'down');
    if (downCards.length === 0) return;

    const recallOk = this.ctx.rng() > 0.12; // occasional recall failures

    // 1) first pick: a fully-known pair? start flipping its halves
    if (this.picked.length === 0 && recallOk) {
      for (const [, seen] of this.memoryMap) {
        const avail = seen.filter((i) => this.cards[i].state === 'down');
        if (avail.length === 2) {
          this.flipUp(avail[0]);
          return;
        }
      }
    }
    // 2) second pick: do we know the twin of the first pick?
    if (this.picked.length === 1 && recallOk) {
      const firstPair = this.cards[this.picked[0]].pairId;
      const seen = (this.memoryMap.get(firstPair) ?? []).filter(
        (i) => i !== this.picked[0] && this.cards[i].state === 'down'
      );
      if (seen.length > 0) {
        this.flipUp(seen[0]);
        return;
      }
    }
    // 3) explore an unseen card
    const unseen = downCards.filter(
      ({ i }) => ![...this.memoryMap.values()].some((seen) => seen.includes(i))
    );
    const pool = unseen.length > 0 ? unseen : downCards;
    const pick = pool[Math.floor(this.ctx.rng() * pool.length)];
    this.flipUp(pick.i);
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);

    if (this.phase === 'ending') {
      this.endT += dt;
      if (this.endT >= 1.5 && this.phase !== 'done') {
        this.phase = 'done';
        const score = memoryScore(this.misses, this.finished, this.layout);
        ctx.onEnd({ score });
      }
      return;
    }

    ctx.hud.setTime(elapsed);

    if (this.peekT > 0) {
      this.peekT -= dt;
      this.peekToken.rotation.z += dt * 5;
      if (this.peekT <= 0) this.endPeek();
    }

    // pending flip-back (dt-driven, pause-safe §E8)
    if (this.picked.length === 2 && this.revealT > 0) {
      this.revealT -= dt;
      if (this.revealT <= 0) this.flipBackPicked();
    }

    if (this.autoplay) this.autoplayTick(dt);

    if (this.matched >= this.layout.pairs && this.phase === 'play') {
      this.phase = 'ending';
      this.finished = elapsed;
      const score = memoryScore(this.misses, this.finished, this.layout);
      ctx.hud.setScore(score);
      ctx.hud.banner(t('mg.memory.cleared'));
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 0.9, 0)), { count: 16 });
      if (this.autoplay) {
        console.log(
          `[memoryMatch] autoplay run ended — score ${score} ` +
          `(misses ${this.misses}, ${this.finished.toFixed(1)}s, ` +
          `${this.layout.pairs} pairs, peek ${this.peekUses})`
        );
      }
    }
  },

  dispose() {
    this.offTap?.();
    this.particles?.dispose();
    this.gooby?.dispose();
    this.backTex?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    this.cards = [];
    this.memoryMap = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.ownedGeos = [];
    this.ownedMats = [];
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
