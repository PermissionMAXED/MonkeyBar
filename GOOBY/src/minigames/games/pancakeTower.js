// Pancake Tower (§C6.1 #8, S): a pancake slides left-right above the stack;
// tap to drop; the overhang is sliced off (width shrinks). Every 5th layer is
// a bonus topping (butter pat / food-kit strawberry, +4 pts, no shrink).
// Perfect drop (≤ PERFECT_EPS world units ≡ 6 px, defined precisely in
// pancakeTower.logic.js) +2 & width restores +10%. Ends when width < 20% or
// 40 layers. Score = layers×2 + bonuses. The camera rises with the tower;
// Gooby watches from the side, drooling.
//
// Dev-only ?autoplay=1: random-ish competent play for headless verification.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { createParticles } from '../../gfx/particles.js';
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  PANCAKE,
  isToppingLayer,
  slideX,
  slidePeriod,
  resolveDrop,
  isTowerDone,
  towerScore,
  initialWobbleState,
  stepWobble,
  dampWobble,
  wobbleTopX,
  wobbleLocalX,
  isFallenExpired,
} from './pancakeTower.logic.js';

const SKY = 0xffe9d6;
const PANCAKE_COLORS = [0xe8b05f, 0xf0bd72, 0xdda352];
const PLATE_Y = 0.5;
const SLIDER_LIFT = 2.1; // slider hovers this far above the stack top

/** Cached canvas textures for floating "+N" text sprites. */
const floatTexCache = new Map();
function floatTexture(text, color) {
  const key = `${text}|${color}`;
  if (floatTexCache.has(key)) return floatTexCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = '900 36px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(74,59,54,0.85)';
  g.strokeText(text, 80, 34);
  g.fillStyle = color;
  g.fillText(text, 80, 34);
  const tex = new THREE.CanvasTexture(canvas);
  floatTexCache.set(key, tex);
  return tex;
}

export default {
  id: 'pancakeTower',
  assetKeys: ['food-kit/strawberry', 'food-kit/whipped-cream', 'food-kit/pancakes'],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    const scene = ctx.scene;
    scene.background = new THREE.Color(SKY);
    scene.add(new THREE.HemisphereLight(0xfff5e8, 0xcbb39e, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2dd, 0.9);
    sun.position.set(3, 8, 5);
    scene.add(sun);

    const S = {
      ctx,
      layerIndex: 1, //  1-based number of the pancake currently sliding
      layers: 0, //      landed layers
      bonusPoints: 0,
      perfects: 0,
      toppings: 0,
      stack: { center: 0, width: PANCAKE.BASE_WIDTH },
      stackTopY: PLATE_Y, // world y of the stack's top surface
      slideT: 0,
      slidePhase: 0,
      slider: null, //   the sliding mesh
      falling: null, //  {obj, targetY, resolveInfo} while dropping
      cuts: [], //       sliced-off pieces tumbling away
      floaters: [],
      settleT: 0, //     squash pulse on the stack after a landing
      shakeT: 0,
      wobble: initialWobbleState(),
      maxWobble: 0,
      camY: 0,
      done: false,
      endT: -1,
      droolT: 0,
      autoplay:
        import.meta.env.DEV &&
        typeof location !== 'undefined' &&
        new URLSearchParams(location.search).get('autoplay') === '1',
    };
    this.S = S;

    // --- kitchen table + plate ---
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.5, 5),
      new THREE.MeshLambertMaterial({ color: 0xb98a5a })
    );
    table.position.y = PLATE_Y - 0.31;
    scene.add(table);
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(PANCAKE.BASE_WIDTH * 0.78, PANCAKE.BASE_WIDTH * 0.62, 0.07, 28),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
    );
    plate.position.y = PLATE_Y - 0.035;
    scene.add(plate);
    S.stackGroup = new THREE.Group();
    S.stackGroup.position.y = PLATE_Y;
    scene.add(S.stackGroup);

    // shared pancake geometry (unit cylinder, scaled per layer)
    S.pancakeGeo = new THREE.CylinderGeometry(0.5, 0.53, PANCAKE.LAYER_HEIGHT, 26);
    S.pancakeMats = PANCAKE_COLORS.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })
    );
    S.butterMat = new THREE.MeshStandardMaterial({ color: 0xffe27a, roughness: 0.45 });
    S.butterGeo = new THREE.BoxGeometry(0.34, 0.12, 0.34);

    // --- Gooby watching, drooling (§C6.1 #8) ---
    S.particles = createParticles(scene);
    S.gooby = createGooby({ particles: S.particles });
    applyEquippedOutfits(S.gooby); // G14: cameo wears the equipped outfits
    S.gooby.group.position.set(0.88, PLATE_Y - 0.06, 1.3);
    S.gooby.group.rotation.y = -0.55;
    S.gooby.setEmotion('hungry');
    S.gooby.setDrool(true);
    scene.add(S.gooby.group);

    // Camera distance is tied to the PERFECT_EPS definition in
    // pancakeTower.logic.js: at z = 7.6 the 45° portrait camera frames
    // ≈ 2.9 world units across the stack plane (390 px baseline).
    ctx.camera.position.set(0, PLATE_Y + 1.7, 7.6);
    ctx.camera.lookAt(0, PLATE_Y + 0.7, 0);
    S.camY = PLATE_Y + 1.7;

    this.makeSlider();

    ctx.hud.setScore(0);
    ctx.hud.setTime(0);

    S.offTap = ctx.input.on('tap', () => {
      if (S.done || S.falling || !S.slider) return;
      this.drop();
    });
  },

  /** Build the mesh for layer index (pancake or bonus topping). */
  makeLayerMesh(index, width) {
    const S = this.S;
    if (isToppingLayer(index)) {
      // alternate butter pat (procedural) / strawberry (food-kit)
      if ((index / PANCAKE.TOPPING_EVERY) % 2 === 1) {
        const grp = new THREE.Group();
        const butter = new THREE.Mesh(S.butterGeo, S.butterMat);
        butter.position.y = 0.06;
        grp.add(butter);
        return grp;
      }
      const berry = S.ctx.assets.getModel('food-kit/strawberry');
      const box = new THREE.Box3().setFromObject(berry);
      const h = Math.max(0.001, box.max.y - box.min.y);
      berry.scale.multiplyScalar(0.42 / h);
      const box2 = new THREE.Box3().setFromObject(berry);
      berry.position.y -= box2.min.y;
      return berry;
    }
    const mesh = new THREE.Mesh(S.pancakeGeo, S.pancakeMats[index % S.pancakeMats.length]);
    mesh.scale.set(width, 1, Math.min(width, PANCAKE.BASE_WIDTH));
    mesh.position.y = PANCAKE.LAYER_HEIGHT / 2;
    const grp = new THREE.Group();
    grp.add(mesh);
    return grp;
  },

  makeSlider() {
    const S = this.S;
    // the next pancake matches the current stack-top width (classic stacker)
    S.slider = this.makeLayerMesh(S.layerIndex, S.stack.width);
    S.slideT = 0;
    S.slidePhase = S.ctx.rng();
    S.slider.position.set(
      slideX(0, S.layerIndex, S.slidePhase),
      S.stackTopY + SLIDER_LIFT,
      0
    );
    S.ctx.scene.add(S.slider);
    // autoplay aim for this layer: decent-but-human — mostly sloppy, some tight
    if (S.autoplay) {
      const sloppy = S.ctx.rng() >= 0.26;
      const mag = sloppy ? 0.09 + S.ctx.rng() * 0.26 : S.ctx.rng() * 0.035;
      S.autoTargetOff = (S.ctx.rng() < 0.5 ? -1 : 1) * mag;
    }
  },

  drop() {
    const S = this.S;
    const dropX = S.slider.position.x;
    const topping = isToppingLayer(S.layerIndex);
    const height = S.stackTopY - PLATE_Y;
    const movingCenter = wobbleTopX(S.stack.center, height, S.wobble.angle);
    const info = resolveDrop({ center: movingCenter, width: S.stack.width }, dropX, topping);
    S.falling = {
      obj: S.slider,
      info,
      topping,
      targetY: S.stackTopY,
    };
    S.slider = null;
    S.ctx.audio.play('pancake.drop');
  },

  /** Falling piece reached the stack: apply slice math + juice. */
  land() {
    const S = this.S;
    const { info, topping, obj } = S.falling;
    S.falling = null;

    if (!info.landed) {
      // total miss: the pancake tumbles off the tower
      S.cuts.push({ obj, vel: new THREE.Vector3(Math.sign(obj.position.x - S.stack.center) * 2.2, 1.2, 0.4), spin: 5, t: 0 });
      S.ctx.audio.play('pancake.miss');
      S.gooby.setEmotion('sad');
      S.gooby.play('refuse');
      S.recoverT = 1.2;
      if (!topping) {
        // a fully missed pancake leaves nothing to stack on → tower over
        this.finish();
        return;
      }
      this.nextLayer();
      return;
    }

    // Place the landed piece in the rotating stack's local coordinates.
    const height = S.stackTopY - PLATE_Y;
    const localCenter = wobbleLocalX(info.center, height, S.wobble.angle);
    S.ctx.scene.remove(obj);
    S.stackGroup.add(obj);
    obj.position.set(localCenter, height, 0);
    obj.rotation.z = 0;
    if (!topping) {
      const mesh = obj.children[0];
      mesh.scale.x = info.width;
      mesh.position.x = 0;
      // cut piece tumbles off
      if (info.cut) {
        const cutGrp = this.makeLayerMesh(S.layerIndex, info.cut.size);
        cutGrp.children[0].scale.x = info.cut.size;
        cutGrp.position.set(info.cut.center, S.stackTopY, 0);
        S.ctx.scene.add(cutGrp);
        S.cuts.push({
          obj: cutGrp,
          vel: new THREE.Vector3(info.cut.side * 1.8, 0.6, 0.3),
          spin: info.cut.side * 6,
          t: 0,
        });
        S.ctx.audio.play('pancake.slice');
      }
      S.stack = { center: localCenter, width: info.width };
      S.stackTopY += PANCAKE.LAYER_HEIGHT;
    } else {
      S.stackTopY += topping && (S.layerIndex / PANCAKE.TOPPING_EVERY) % 2 === 0 ? 0.3 : 0.12;
      S.toppings += 1;
    }

    S.layers += 1;
    S.bonusPoints += info.points;
    if (info.perfect) {
      S.wobble = dampWobble(S.wobble);
      S.stackGroup.rotation.z = S.wobble.angle;
      S.perfects += 1;
      S.ctx.audio.play('pancake.perfect');
      S.ctx.hud.banner(t('mg.pancake.perfect'));
      const world = obj.getWorldPosition(new THREE.Vector3());
      S.particles.emit('sparkles', world.clone().setY(S.stackTopY + 0.2), { count: 8 });
      this.floatText(`+${info.points}`, '#59C9B9', world.clone().setY(S.stackTopY + 0.5));
      S.gooby.setEmotion('ecstatic');
      S.gooby.play('happyBounce');
      S.recoverT = 1.2;
    } else if (topping) {
      S.ctx.audio.play('pancake.topping');
      S.ctx.hud.banner(t('mg.pancake.topping'));
      const world = obj.getWorldPosition(new THREE.Vector3());
      this.floatText(`+${info.points}`, '#FF7BA9', world.clone().setY(S.stackTopY + 0.5));
      S.gooby.play('happyBounce');
    } else {
      S.ctx.audio.play('pancake.land');
    }
    S.settleT = 1;
    S.shakeT = info.perfect ? 0.35 : 0.2;
    S.settleObj = obj;

    const score = towerScore(S.layers, S.bonusPoints);
    S.ctx.hud.setScore(score);

    if (isTowerDone(S.stack.width, S.layers)) {
      this.finish();
      return;
    }
    this.nextLayer();
  },

  nextLayer() {
    const S = this.S;
    S.layerIndex += 1;
    this.makeSlider();
  },

  finish() {
    const S = this.S;
    if (S.endT >= 0 || S.done) return;
    S.endT = 1.0; // let the last slice/confetti play out (dt-timed)
    S.ctx.audio.play('jingle.short');
    S.particles.emit('confetti', new THREE.Vector3(S.stack.center, S.stackTopY + 0.4, 0), { count: 14 });
    S.gooby.setEmotion('ecstatic');
    S.gooby.play('dance', { loop: true });
  },

  /** Floating text sprite (dt-driven, pause-safe). */
  floatText(text, color, pos) {
    const S = this.S;
    const mat = new THREE.SpriteMaterial({ map: floatTexture(text, color), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    // F4 P2-3: popups near the tall-stack top must not clip past the edge
    sprite.position.copy(clampFloatTextToView(pos.clone(), S.ctx.camera, { halfW: 0.55, halfH: 0.22 }));
    sprite.scale.set(1.1, 0.44, 1);
    S.ctx.scene.add(sprite);
    S.floaters.push({ sprite, t: 0, life: 0.9 });
  },

  update(dt, elapsed) {
    const S = this.S;
    if (!S || S.done) return;
    S.ctx.hud.setTime(elapsed);

    // V3 wobble: driven spring from height 8; perfect drops damp this state.
    S.wobble = stepWobble(S.wobble, dt, S.layers);
    S.maxWobble = Math.max(S.maxWobble, Math.abs(S.wobble.angle));
    S.stackGroup.rotation.z = S.wobble.angle;
    if (S.layers === PANCAKE.WOBBLE_START_LAYER && !S.wobbleBannerShown) {
      S.wobbleBannerShown = true;
      S.ctx.hud.banner(t('mg.pancake.wobble'));
    }

    // --- slider oscillation ---
    if (S.slider) {
      S.slideT += dt;
      S.slider.position.x = slideX(S.slideT, S.layerIndex, S.slidePhase);
      S.slider.position.y = S.stackTopY + SLIDER_LIFT + Math.sin(S.slideT * 5) * 0.03;

      // autoplay pilot (dev-only ?autoplay=1): taps when the slider crosses
      // its per-layer aim point (mostly near-perfect, sometimes sloppy)
      if (S.autoplay && !S.falling) {
        const period = slidePeriod(S.layerIndex);
        const vmax = (PANCAKE.SLIDE_AMPLITUDE * Math.PI * 2) / period;
        const height = S.stackTopY - PLATE_Y;
        const aim = wobbleTopX(S.stack.center, height, S.wobble.angle) +
          (S.autoTargetOff ?? 0);
        const off = S.slider.position.x - aim;
        const vel = vmax * Math.cos(((S.slideT / period) + S.slidePhase) * Math.PI * 2);
        const eta = -off / (vel || 1e-6);
        if (eta > 0 && eta < dt * 1.4 && S.slideT > 0.25) this.drop();
      }
    }

    // --- falling piece ---
    if (S.falling) {
      const f = S.falling;
      f.obj.position.y -= PANCAKE.FALL_SPEED * dt;
      if (f.obj.position.y <= f.targetY) this.land();
    }

    // --- settle squash pulse on the freshly landed layer ---
    if (S.settleT > 0 && S.settleObj) {
      S.settleT = Math.max(0, S.settleT - dt * 4);
      const sq = 1 + Math.sin(S.settleT * Math.PI) * 0.18;
      S.settleObj.scale.y = 1 / sq;
      S.settleObj.scale.x = S.settleObj.scale.z = sq;
      if (S.settleT === 0) S.settleObj.scale.set(1, 1, 1);
    }

    // --- sliced pieces tumble + fade out ---
    for (let i = S.cuts.length - 1; i >= 0; i -= 1) {
      const c = S.cuts[i];
      c.t += dt;
      c.vel.y -= 9 * dt;
      c.obj.position.addScaledVector(c.vel, dt);
      c.obj.rotation.z += c.spin * dt;
      if (isFallenExpired(c.t)) {
        S.ctx.scene.remove(c.obj);
        S.cuts.splice(i, 1);
      }
    }

    // --- floating text ---
    for (let i = S.floaters.length - 1; i >= 0; i -= 1) {
      const f = S.floaters[i];
      f.t += dt;
      f.sprite.position.y += dt * 1.1;
      f.sprite.material.opacity = 1 - (f.t / f.life) ** 2;
      if (f.t >= f.life) {
        S.ctx.scene.remove(f.sprite);
        f.sprite.material.dispose();
        S.floaters.splice(i, 1);
      }
    }

    // --- Gooby: watches the slider, drools, cheers ---
    const watch = S.falling?.obj ?? S.slider;
    if (watch) S.gooby.lookAt(watch.position);
    S.gooby.update(dt);
    S.particles.update(dt);
    if (S.recoverT != null && S.recoverT > 0) {
      S.recoverT -= dt;
      if (S.recoverT <= 0 && S.endT < 0) {
        S.gooby.setEmotion('hungry');
      }
    }
    S.droolT += dt;

    // --- camera rises with the tower (§C6.1 #8) + micro-shake ---
    S.shakeT = Math.max(0, S.shakeT - dt * 3);
    const shake = S.shakeT * 0.04;
    const targetCamY = PLATE_Y + 1.7 + Math.max(0, S.stackTopY - PLATE_Y - 0.6);
    S.camY += (targetCamY - S.camY) * Math.min(1, dt * 2.5);
    S.ctx.camera.position.set(
      (Math.random() - 0.5) * shake,
      S.camY + (Math.random() - 0.5) * shake,
      7.6
    );
    S.ctx.camera.lookAt(0, S.camY - 1.0, 0);

    // --- end (dt-timed so confetti/dance are visible) ---
    if (S.endT >= 0) {
      S.endT -= dt;
      if (S.endT < 0) {
        S.done = true;
        const score = towerScore(S.layers, S.bonusPoints);
        if (S.autoplay) {
          console.log(
            `[autoplay] pancakeTower score=${score} layers=${S.layers} ` +
            `perfects=${S.perfects} toppings=${S.toppings} wobble=${S.maxWobble.toFixed(3)}`
          );
        }
        S.ctx.onEnd({ score });
      }
    }
  },

  dispose() {
    const S = this.S;
    if (!S) return;
    S.offTap?.();
    S.gooby?.dispose();
    S.particles?.dispose();
    S.pancakeGeo?.dispose();
    S.butterGeo?.dispose();
    for (const m of S.pancakeMats ?? []) m.dispose();
    S.butterMat?.dispose();
    for (const f of S.floaters) f.sprite.material.dispose();
    // remaining scene objects (asset clones etc.) are swept by the framework's
    // scene disposal (§E8).
    this.S = null;
  },
};
