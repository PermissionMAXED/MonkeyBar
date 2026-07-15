// Dev-only framework smoke game (§G G1): tap-the-dot, 15 s. Proves the whole
// §E8 loop — countdown, HUD score/time, pause, results, reward path. Hidden
// from the arcade (meta.dev in data/minigames.js), reachable via ?minigame=_smoke.

import * as THREE from 'three';
import { MINIGAME, UI_COLORS } from '../../data/constants.js';
import { tween, easings } from '../../gfx/tween.js';

/** @type {import('../framework.js') extends never ? never : object} §E8 plugin */
export default {
  id: '_smoke',
  assetKeys: [],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.done = false;
    this.halfH = 3.6; // playfield half-height at z=0 (camera at z=10, fov 45 → ~4.1; margin)
    this.halfW = this.halfH * Math.min(1, innerWidth / innerHeight);

    ctx.scene.background = new THREE.Color(UI_COLORS.BG_CREAM);

    // pastel backdrop ring so the stage isn't empty
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 3.45, 64),
      new THREE.MeshBasicMaterial({ color: UI_COLORS.TEAL, transparent: true, opacity: 0.35 })
    );
    ctx.scene.add(this.ring);

    // the dot
    this.dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 40),
      new THREE.MeshBasicMaterial({ color: UI_COLORS.PRIMARY_PINK })
    );
    this.dotShine = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    this.dotShine.position.set(0.14, 0.16, 0.01);
    this.dot.add(this.dotShine);
    ctx.scene.add(this.dot);
    this.moveDot();

    ctx.hud.setTime(MINIGAME.SMOKE_DURATION_SEC);
    ctx.hud.setScore(0);

    this.offTap = ctx.input.on('tap', (p) => {
      if (this.done) return;
      const hit = ctx.input.pick(ctx.camera, [this.dot], p);
      if (hit) {
        ctx.onScore(1);
        ctx.audio.play('ui.tap');
        // squash pop, then relocate
        const dot = this.dot;
        tween({
          from: 1.35,
          to: 1,
          duration: 0.18,
          ease: easings.easeOutBack,
          onUpdate: (v) => dot.scale.setScalar(v),
        });
        this.moveDot();
      }
    });
  },

  /** Relocate the dot to a random on-screen position. */
  moveDot() {
    const { rng } = this.ctx;
    this.dot.position.set(
      (rng() * 2 - 1) * (this.halfW - 0.7),
      (rng() * 2 - 1) * (this.halfH - 0.7),
      0
    );
  },

  /**
   * @param {number} dt real seconds since last frame (excludes pauses)
   * @param {number} elapsed total running seconds
   */
  update(dt, elapsed) {
    if (this.done) return;
    const remaining = MINIGAME.SMOKE_DURATION_SEC - elapsed;
    this.ctx.hud.setTime(remaining);
    this.ring.rotation.z += dt * 0.15;
    this.dot.position.y += Math.sin(elapsed * 4) * dt * 0.06; // gentle bob
    if (remaining <= 0) {
      this.done = true;
      this.ctx.onEnd({});
    }
  },

  dispose() {
    this.offTap?.();
    // geometries/materials are freed by the framework's scene sweep (§E8)
    this.ctx = null;
    this.dot = null;
    this.ring = null;
  },
};
