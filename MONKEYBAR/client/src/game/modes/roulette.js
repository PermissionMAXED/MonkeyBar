// Coconut Roulette choreography (R5) — the rigged coconut's 3D drama, plugged
// into the gameClient.js SERIAL event queue (contract in game/modes/index.js:
// every handle() is awaited in full, so the explosion can never overlap other
// choreography). Base handling (turn ring, ghost fade on `eliminated`,
// round/match banners, resync scaffolding) stays in gameClient.js — this
// module owns only the bomb prop and its beats:
//
//   rouletteHolder  — the coconut arms (drop-in) or hops to its new holder;
//                     fuse blink rate := pExplode (propsBomb.js)
//   rouletteShake   — trauma shake + drumroll snippet … *click* + exhale,
//                     gold glint for the chip earned
//   roulettePass    — a paid flick: quick hop seat → seat, clockwise
//   rouletteExplode — muzzle-flash + smoke + confetti at the coconut,
//                     `cannonThoom`, KO flop (ghost fade rides `eliminated`)
//
// Music intensity rides pExplode the whole way. tools.fastMode() is honored
// on every beat: end-states snap with no waits so a deep backlog catches up.

import * as THREE from 'three';
import { ROULETTE_EVENTS } from '@shared/modeEvents.js';
import { TABLE_TOP_Y } from '../../three/barScene.js';
import { seatTableEdgePos } from '../../three/tableView.js';
import { createBombProp, BOMB_RADIUS } from '../../three/propsBomb.js';
import { Ease } from '../../three/animations.js';

/** @type {ReturnType<typeof createBombProp>|null} module-singleton prop */
let bomb = null;
/** Seat the coconut currently rests at (-1 = hidden / between rounds). */
let atSeat = -1;
/** engine.onFrame remover for the bomb's blink/shiver updater. */
let offFrame = null;
let wired = false;

/** Where the coconut sits on the table in front of a seat. */
function restPos(seat) {
  const p = seatTableEdgePos(seat);
  p.y = TABLE_TOP_Y + BOMB_RADIUS * 0.95;
  return p;
}

const rideMusic = (tools, pExplode) =>
  tools.engine.audio.music.setIntensity(Math.min(1, 0.25 + (pExplode ?? 0) * 0.6));

const seatName = (tools, seat) =>
  tools.store.get('snapshot')?.seats?.find((s) => s.seat === seat)?.name ?? 'Monkey';

/** Lazy prop creation + the module's only global wiring (once, ever). */
function ensureBomb(tools) {
  if (!wired) {
    wired = true;
    // Leaving the game screen (leave/kick/back to menu) must not strand a
    // ticking coconut over the attract-mode bar — and the prop's geometries/
    // materials are per-instance, so tear it down fully (propsBomb dispose).
    tools.store.on('screen', (screen) => {
      if (screen !== 'game') destroyBomb();
    });
  }
  if (bomb) return bomb;
  const { engine } = tools;
  bomb = createBombProp();
  bomb.group.visible = false;
  engine.scene.add(bomb.group);
  offFrame = engine.onFrame((dt) => bomb.update(dt));
  return bomb;
}

function hideBomb() {
  if (!bomb) return;
  bomb.group.visible = false;
  atSeat = -1;
}

/** Full teardown: dispose geometries/materials + drop the frame updater. */
function destroyBomb() {
  if (!bomb) return;
  offFrame?.();
  offFrame = null;
  bomb.dispose();
  bomb = null;
  atSeat = -1;
}

/** Snap (fast) or hop (arc tween) the coconut to a seat's table edge. */
async function moveTo(seat, tools, { drop = false } = {}) {
  const { engine, fastMode } = tools;
  ensureBomb(tools);
  const to = restPos(seat);
  const wasVisible = bomb.group.visible;
  if (atSeat === seat && wasVisible) return;
  atSeat = seat;
  bomb.setLit(true);

  if (fastMode()) {
    bomb.group.position.copy(to);
    bomb.group.visible = true;
    return;
  }

  if (drop || !wasVisible) {
    // fresh arm: the coconut drops out of the rafters and lands with a thud
    bomb.group.position.set(to.x, to.y + 0.85, to.z);
    bomb.group.visible = true;
    engine.audio.sfx.uiTick();
    await engine.anim.to(bomb.group.position, { y: to.y }, 0.5, { ease: Ease.bounceOut }).promise;
    engine.audio.sfx.chipClack();
    engine.particles.smokePuff(to, { count: 8, size: 0.05, speed: 0.25 });
    return;
  }

  // hand-off: a lobbed arc from the old seat to the new one
  const from = bomb.group.position.clone();
  engine.audio.sfx.cardSlide();
  await engine.anim.tween({
    duration: 0.55,
    ease: Ease.quadInOut,
    onUpdate(k) {
      bomb.group.position.lerpVectors(from, to, k);
      bomb.group.position.y += Math.sin(k * Math.PI) * 0.34;
      bomb.group.rotation.y += 0.14;
    },
  }).promise;
  bomb.group.position.copy(to);
  engine.audio.sfx.chipClack();
}

/** Rattle the coconut in place; amplitude scales with the stakes. */
function wobble(tools, seconds, amp) {
  const base = bomb.group.position.clone();
  return tools.engine.anim.tween({
    duration: seconds,
    ease: Ease.linear,
    onUpdate(k) {
      const a = amp * (0.4 + 0.6 * k);
      bomb.group.position.x = base.x + Math.sin(k * seconds * 90) * a;
      bomb.group.position.z = base.z + Math.cos(k * seconds * 73) * a;
    },
    onComplete() {
      bomb.group.position.copy(base);
    },
  }).promise;
}

export default {
  /**
   * Rebuild bomb state from a §10.3 snapshot (gameStart / reconnect /
   * spectate) — runs after the shared base resync. `bomb:null` between
   * rounds or post-match hides the prop.
   */
  resync(snapshot, tools) {
    ensureBomb(tools);
    const b = snapshot?.bomb;
    if (!b || snapshot.phase === 'matchEnd') {
      hideBomb();
      return;
    }
    bomb.group.position.copy(restPos(b.holderSeat));
    bomb.group.visible = true;
    bomb.setLit(true);
    bomb.setFuseRate(b.pExplode);
    atSeat = b.holderSeat;
    rideMusic(tools, b.pExplode);
  },

  /**
   * One queued event — awaited in full by gameClient's serial queue.
   * @param {string} kind  modeEvent kind (or a §3.3 hook type — unused here)
   */
  async handle(kind, p, tools) {
    const { engine, wait, fastMode, sysFlavor } = tools;
    switch (kind) {
      // The coconut arms at (or lands in front of) its holder.
      case ROULETTE_EVENTS.HOLDER: {
        const fresh = !bomb || !bomb.group.visible;
        await moveTo(p.seat, tools, { drop: fresh });
        bomb.setFuseRate(p.pExplode);
        rideMusic(tools, p.pExplode);
        if (!fastMode()) {
          engine.lookAt(p.seat);
          if (fresh) {
            sysFlavor(`🥥 The rigged coconut lands in front of ${seatName(tools, p.seat)}. Shake it… or pay to pass.`);
          }
          engine.getMonkey(p.seat)?.flashExpression('sweat', 1.1);
        }
        return wait(0.25);
      }

      // A survived shake: drumroll dread → *click* → the whole bar exhales.
      case ROULETTE_EVENTS.SHAKE: {
        bomb?.setFuseRate(p.pExplode);
        rideMusic(tools, p.pExplode);
        if (fastMode() || !bomb?.group.visible) return;
        engine.lookAt(p.seat);
        const dread = p.pExplode ?? 0.1;
        engine.audio.sfx.drumroll(0.7);
        engine.audio.sfx.fuseHiss(0.7);
        engine.shake(0.25 + dread * 0.45); // trauma rides the odds
        engine.particles.fuseSparks(bomb.fuseWorldPos());
        await wobble(tools, 0.7, 0.014 + dread * 0.02);
        // …survival: the click, the exhale, the chip
        engine.audio.sfx.survivalClick();
        engine.audio.sfx.phew();
        engine.particles.goldGlint(bomb.group.position.clone().setY(bomb.group.position.y + 0.1));
        engine.getMonkey(p.seat)?.flashExpression('grin', 1.3);
        return wait(0.35);
      }

      // A paid pass: quick flick, the coconut lobs clockwise.
      case ROULETTE_EVENTS.PASS: {
        if (!fastMode()) {
          engine.playClip(p.seat, 'cardPlay'); // the shove — not awaited
          sysFlavor(`🍌 ${seatName(tools, p.seat)} pays a chip and passes the coconut.`);
        }
        await moveTo(p.toSeat, tools);
        return;
      }

      // BOOM. No cannon — the coconut IS the boom. Fully awaited: the serial
      // queue guarantees nothing else animates until the smoke clears.
      case ROULETTE_EVENTS.EXPLODE: {
        rideMusic(tools, 1);
        if (fastMode() || !bomb?.group.visible) {
          hideBomb();
          engine.audio.music.setIntensity(0.2);
          return;
        }
        const pos = bomb.group.position.clone();
        engine.lookAt(p.seat);
        engine.getMonkey(p.seat)?.setExpression('sweat');

        // last, frantic seconds — sparks fly while the wobble crescendos
        engine.audio.sfx.drumroll(1.15);
        engine.audio.sfx.fuseHiss(1.15);
        bomb.setFuseRate(1);
        const sparkStop = engine.anim.addUpdater(
          (() => {
            let acc = 0;
            return (dt) => {
              acc += dt;
              if (acc > 0.12) {
                acc = 0;
                engine.particles.fuseSparks(bomb.fuseWorldPos());
              }
            };
          })()
        );
        await wobble(tools, 1.15, 0.03);
        sparkStop();

        // the boom itself: muzzle-flash + smoke + confetti, THOOM, hit-stop
        engine.particles.muzzleFlash(pos, new THREE.Vector3(0, 1, 0));
        engine.particles.smokePuff(pos, { count: 34 });
        engine.particles.confetti(pos, { count: 40 });
        engine.audio.sfx.cannonThoom();
        engine.postfx.pulseBloom?.(2.4);
        engine.anim.hitStop(0.11);
        engine.shake(1.0);
        hideBomb();
        sysFlavor(`💥 KA-BOOM! The coconut goes off in ${seatName(tools, p.seat)}'s paws!`);

        const victim = engine.getMonkey(p.seat);
        if (victim) {
          await engine.playClip(p.seat, 'cannonHit'); // KO flop; ghost fade rides `eliminated`
          engine.particles.smokePuff(victim.headWorldPos(new THREE.Vector3()));
        } else {
          await engine.anim.wait(1.0);
        }
        engine.audio.sfx.sadTrombone();
        engine.audio.music.setIntensity(0.2);
        return wait(0.3);
      }

      default:
        // §3.3 hooks (turn/penalty/cannon) need no extra roulette beat.
        return;
    }
  },
};
