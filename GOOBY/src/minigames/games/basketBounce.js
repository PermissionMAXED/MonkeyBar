// Basket Bounce (§C6.1 #7, M): flick-to-throw an orange ball (procedural
// sphere w/ seams) into a hoop (torus + backboard). Ballistic arc + rim/
// backboard bounce (physics-lite, stepped by basketBounce.logic.js — the same
// integrator the tests run). V3 moving phase starts after 10 baskets at ±1 m;
// moving-hoop swishes score ×2. Distance still ramps. 60 s.
// Gooby stands courtside reacting (cheer on basket, sad on a miss streak).
//
// Dev-only ?autoplay=1: random-ish competent play for headless verification.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { createParticles } from '../../gfx/particles.js';
import { clampFloatTextToView } from '../framework.js'; // F4 P2-3
import {
  BASKET,
  hoopSlideX,
  hoopDistance,
  flickToVelocity,
  stepBallSwept,
  scoreShot,
  simulateShot,
  solveBasketVelocity,
  isMovingHoop,
  applyDifficulty,
  isBasketRoundOver,
} from './basketBounce.logic.js';

const SKY = 0xcfe8ff;
const COURT = 0xd9a066;

/** Cached canvas textures for floating "+N" text sprites. */
const floatTexCache = new Map();
function floatTexture(text, color) {
  const key = `${text}|${color}`;
  if (floatTexCache.has(key)) return floatTexCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = '900 38px system-ui, sans-serif';
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
  id: 'basketBounce',
  assetKeys: [],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    const difficulty = ctx.params?.difficulty ?? 'normal';
    const tune = applyDifficulty(BASKET, difficulty);
    const scene = ctx.scene;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 30, 70);
    scene.add(new THREE.HemisphereLight(0xfff5e8, 0xb8a898, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
    sun.position.set(-4, 8, 6);
    scene.add(sun);

    ctx.camera.position.set(0, 2.3, tune.SPAWN.z + 3.2);
    ctx.camera.lookAt(0, 2.1, -3);

    const S = {
      ctx,
      tune,
      difficulty,
      elapsed: 0,
      score: 0,
      baskets: 0,
      missStreak: 0,
      swishStreak: 0,
      movingSwishes: 0,
      slideT: 0,
      hoop: { x: 0, z: tune.SPAWN.z - hoopDistance(0, tune) },
      ball: null, // physics state while flying
      ballReady: true,
      resetT: -1,
      floaters: [],
      shakeT: 0,
      cheerT: 0,
      done: false,
      autoplay:
        import.meta.env.DEV &&
        typeof location !== 'undefined' &&
        new URLSearchParams(location.search).get('autoplay') === '1',
      autoT: 1.2,
    };
    this.S = S;

    // --- court floor + line ---
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 40),
      new THREE.MeshLambertMaterial({ color: COURT })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -6;
    scene.add(floor);
    const line = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 2.5, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, tune.SPAWN.z);
    scene.add(line);

    // --- hoop assembly: pole, backboard, torus rim, net ---
    const hoopGrp = new THREE.Group();
    S.hoopGrp = hoopGrp;
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(BASKET.BOARD_W, BASKET.BOARD_H, 0.06), boardMat);
    board.position.set(0, BASKET.BOARD_BOTTOM_Y + BASKET.BOARD_H / 2, -BASKET.BOARD_GAP);
    hoopGrp.add(board);
    const target = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff7ba9 })
    );
    target.position.set(0, BASKET.RIM_Y + 0.28, -BASKET.BOARD_GAP + 0.035);
    hoopGrp.add(target);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(BASKET.RIM_R, BASKET.RIM_TUBE, 10, 32),
      new THREE.MeshStandardMaterial({ color: 0xe8542f, roughness: 0.4, metalness: 0.3 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = BASKET.RIM_Y;
    hoopGrp.add(rim);
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(BASKET.RIM_R * 0.96, BASKET.RIM_R * 0.55, 0.5, 12, 3, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.7 })
    );
    net.position.y = BASKET.RIM_Y - 0.27;
    hoopGrp.add(net);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, BASKET.BOARD_BOTTOM_Y + BASKET.BOARD_H),
      new THREE.MeshStandardMaterial({ color: 0x888a8f, roughness: 0.5 })
    );
    pole.position.set(0, (BASKET.BOARD_BOTTOM_Y + BASKET.BOARD_H) / 2, -BASKET.BOARD_GAP - 0.08);
    hoopGrp.add(pole);
    scene.add(hoopGrp);

    // --- ball: orange sphere + two dark seam rings (procedural) ---
    const ballGrp = new THREE.Group();
    S.ballGrp = ballGrp;
    const ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BASKET.BALL_R, 22, 16),
      new THREE.MeshStandardMaterial({ color: 0xf07f2e, roughness: 0.55 })
    );
    ballGrp.add(ballMesh);
    const seamMat = new THREE.MeshBasicMaterial({ color: 0x7a3b12 });
    for (const rot of [0, Math.PI / 2]) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(BASKET.BALL_R, 0.008, 6, 32), seamMat);
      seam.rotation.y = rot;
      ballGrp.add(seam);
    }
    scene.add(ballGrp);
    ballGrp.position.set(tune.SPAWN.x, tune.SPAWN.y, tune.SPAWN.z);

    // --- Gooby courtside ---
    S.particles = createParticles(scene);
    S.gooby = createGooby({ particles: S.particles });
    applyEquippedOutfits(S.gooby); // G14: cameo wears the equipped outfits
    S.gooby.group.position.set(0.72, 0, 2.4);
    S.gooby.group.rotation.y = -0.6;
    S.gooby.setEmotion('happy');
    scene.add(S.gooby.group);

    ctx.hud.setScore(0);
    ctx.hud.setTime(tune.ENDLESS ? 0 : tune.DURATION_SEC);

    // --- input: flick to throw (swipe or fast dragend) ---
    const throwFrom = (p) => {
      if (S.done || !S.ballReady) return;
      const vel = flickToVelocity({ vx: p.vx ?? 0, vy: p.vy ?? 0 }, tune);
      if (!vel) return;
      this.throwBall(vel);
    };
    S.offSwipe = ctx.input.on('swipe', throwFrom);
    S.offDragEnd = ctx.input.on('dragend', (p) => {
      // swipe already covers most flicks; dragend catches slower lobs
      if ((p.vy ?? 0) < -tune.FLICK.MIN_UP_VEL) throwFrom(p);
    });
  },

  throwBall(vel) {
    const S = this.S;
    S.ballReady = false;
    S.ball = {
      pos: { x: S.ballGrp.position.x, y: S.ballGrp.position.y, z: S.ballGrp.position.z },
      vel: { ...vel },
      touchedRim: false,
      touchedBoard: false,
    };
    S.ctx.audio.play('throw.whoosh');
    S.gooby.lookAt(S.ballGrp.position);
  },

  /** Floating text sprite at a world position (dt-driven, pause-safe). */
  floatText(text, color, pos) {
    const S = this.S;
    const mat = new THREE.SpriteMaterial({ map: floatTexture(text, color), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    // F4 P2-3: hoop popups after it slides to an edge must stay on screen
    sprite.position.copy(clampFloatTextToView(pos.clone(), S.ctx.camera, { halfW: 0.7, halfH: 0.28 }));
    sprite.scale.set(1.4, 0.56, 1);
    S.ctx.scene.add(sprite);
    S.floaters.push({ sprite, t: 0, life: 0.9 });
  },

  onShotResolved(basket) {
    const S = this.S;
    const shot = basket
      ? { basket: true, bank: S.ball.touchedBoard, swish: !S.ball.touchedRim && !S.ball.touchedBoard }
      : { basket: false, bank: false, swish: false };
    const moving = isMovingHoop(S.baskets, S.tune);
    const { points, swishStreak } = scoreShot(shot, S.swishStreak, moving, S.tune);
    S.swishStreak = swishStreak;
    const rimPos = new THREE.Vector3(S.hoop.x, S.tune.RIM_Y + 0.4, S.hoop.z);
    if (basket) {
      S.baskets += 1;
      if (moving && shot.swish) S.movingSwishes += 1;
      S.missStreak = 0;
      S.score += points;
      S.ctx.onScore(points);
      S.ctx.audio.play(shot.swish ? 'basket.swish' : 'basket.score');
      S.particles.emit('confetti', rimPos, { count: 10 });
      this.floatText(`+${points}`, '#59C9B9', rimPos);
      if (shot.bank) S.ctx.hud.banner(t('mg.basket.bank'));
      else if (moving && shot.swish) S.ctx.hud.banner(t('mg.basket.movingSwish'));
      else if (shot.swish && points > S.tune.POINTS_BASKET) S.ctx.hud.banner(t('mg.basket.swish'));
      if (S.baskets === S.tune.SLIDE_AFTER_BASKETS) S.ctx.hud.banner(t('mg.basket.hoopMoves'));
      // Gooby cheers
      S.cheerT = 1.2;
      S.gooby.setEmotion('ecstatic');
      S.gooby.play('happyBounce');
      // ramp: hoop slides back
      S.shakeT = 0.5;
    } else {
      S.missStreak += 1;
      S.swishStreak = 0;
      S.ctx.audio.play('ball.bounce');
      if (S.missStreak >= 3) {
        S.gooby.setEmotion('sad');
        S.gooby.play('sadSlump');
        S.cheerT = 1.4;
      }
    }
    S.ball = null;
    S.resetT = S.tune.SHOT_RESET_SEC; // dt-timed ball respawn (pause-safe)
  },

  update(dt, elapsed) {
    const S = this.S;
    if (!S || S.done) return;
    S.elapsed = elapsed;
    S.ctx.hud.setTime(S.tune.ENDLESS ? elapsed : S.tune.DURATION_SEC - elapsed);

    // --- hoop: distance ramp + horizontal slide after 5 baskets ---
    if (isMovingHoop(S.baskets, S.tune)) S.slideT += dt;
    const targetZ = S.tune.SPAWN.z - hoopDistance(S.baskets, S.tune);
    S.hoop.z += (targetZ - S.hoop.z) * Math.min(1, dt * 3);
    S.hoop.x = hoopSlideX(S.slideT, S.baskets, S.tune);
    S.hoopGrp.position.set(S.hoop.x, 0, S.hoop.z);

    // --- ball physics (same integrator as the tests) ---
    if (S.ball) {
      const ev = stepBallSwept(S.ball, dt, S.hoop, S.tune);
      if (ev.rim) {
        S.ctx.audio.play('basket.rim');
        S.shakeT = Math.max(S.shakeT, 0.25);
      }
      if (ev.board) S.ctx.audio.play('basket.board');
      if (ev.basket) {
        this.onShotResolved(true);
      } else if (ev.dead) {
        this.onShotResolved(false);
      }
      if (S.ball) {
        S.ballGrp.position.set(S.ball.pos.x, S.ball.pos.y, S.ball.pos.z);
        S.ballGrp.rotation.x -= dt * 7;
        S.gooby.lookAt(S.ballGrp.position);
      }
    } else if (S.resetT >= 0) {
      // --- respawn: ball floats back to the spawn point ---
      S.resetT -= dt;
      if (S.resetT < 0) {
        S.ballGrp.position.set(S.tune.SPAWN.x, S.tune.SPAWN.y, S.tune.SPAWN.z);
        S.ballGrp.rotation.set(0, 0, 0);
        S.ballReady = true;
        S.gooby.lookAt(null);
      }
    }

    // --- ready-ball idle bob (juice) ---
    if (S.ballReady) {
      S.ballGrp.position.y = S.tune.SPAWN.y + Math.sin(elapsed * 3) * 0.05;
      const pulse = 1 + Math.sin(elapsed * 6) * 0.015;
      S.ballGrp.scale.setScalar(pulse);
    } else {
      S.ballGrp.scale.setScalar(1);
    }

    // --- autoplay pilot (dev-only ?autoplay=1): aims with noise ---
    if (S.autoplay && S.ballReady) {
      S.autoT -= dt;
      if (S.autoT <= 0) {
        S.autoT = S.tune.AUTO_INTERVAL_MIN_SEC +
          S.ctx.rng() * S.tune.AUTO_INTERVAL_RANGE_SEC;
        // two-pass aim: predict the hoop a flight-time ahead (flight time from
        // the arc solver itself), then add aim noise → competent-not-perfect
        let lead = 1.5;
        let solved = null;
        for (let pass = 0; pass < 2; pass += 1) {
          const aimHoop = {
            x: hoopSlideX(S.slideT + lead, S.baskets, S.tune),
            z: S.hoop.z,
          };
          solved = solveBasketVelocity(aimHoop, S.ctx.rng, S.tune);
          if (!solved) break;
          lead = simulateShot(solved, aimHoop, S.tune).flightSec;
        }
        if (solved) {
          const wobble = 1 + (S.ctx.rng() - 0.5) * 0.03;
          this.throwBall({ x: solved.x + (S.ctx.rng() - 0.5) * 0.2, y: solved.y * wobble, z: solved.z * wobble });
        }
      }
    }

    // --- Gooby reactions ---
    S.gooby.update(dt);
    S.particles.update(dt);
    if (S.cheerT > 0) {
      S.cheerT -= dt;
      if (S.cheerT <= 0) S.gooby.setEmotion('happy');
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

    // --- camera micro-shake on impacts ---
    S.shakeT = Math.max(0, S.shakeT - dt * 2.6);
    const shake = S.shakeT * 0.05;
    S.ctx.camera.position.set(
      (Math.random() - 0.5) * shake,
      2.3 + (Math.random() - 0.5) * shake,
      S.tune.SPAWN.z + 3.2
    );
    S.ctx.camera.lookAt(0, 2.1, -3);

    // --- round end (§C6.1 #7: 60 s) ---
    if (isBasketRoundOver(elapsed, S.missStreak, S.tune)) {
      S.done = true;
      if (S.autoplay) {
        console.log(
          `[autoplay] basketBounce score=${S.score} baskets=${S.baskets} ` +
          `movingSwishes=${S.movingSwishes}`
        );
      }
      S.ctx.onEnd({ score: S.score });
    }
  },

  dispose() {
    const S = this.S;
    if (!S) return;
    S.offSwipe?.();
    S.offDragEnd?.();
    S.gooby?.dispose();
    S.particles?.dispose();
    for (const f of S.floaters) f.sprite.material.dispose();
    // procedural geometries/materials added to the scene are swept by the
    // framework's scene disposal (§E8).
    this.S = null;
  },
};
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
