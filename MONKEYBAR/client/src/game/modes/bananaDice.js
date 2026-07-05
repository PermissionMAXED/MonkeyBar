// Banana Dice choreography (R4) — the coconut-shell drama, plugged into the
// gameClient.js SERIAL event queue (contract in game/modes/index.js: every
// handle() is awaited in full, so reveals never overlap other beats). Base
// handling (turn ring, penalty overlay timing, the FULL cannonSequence on
// `cannon`, ghost fade on `eliminated`, round/match banners, resync
// scaffolding) stays in gameClient.js — this module owns only the dice props:
//
//   round start   — shells SLAM down in front of every alive seat (the first
//                   `turn` of a round is the queue-synced trigger, so
//                   spectators — who never get the private YOUR_DICE — see it)
//   diceBid       — a bid bark: reach-in clip + chatter at the bidder
//   diceChallenge — the point-and-shout, bass sting, all eyes on the table
//   diceReveal    — every shell lifts (staggered) and the dice pop out with
//                   their real faces; golden wilds glint; fxDiceReveal is
//                   published AT THE LIFT so the HUD banner lands in sync
//   diceDieLost   — the loser's die crumbles to dust
//   diceDieRegained — survive the cannon → the bar spots you one die
//
// tools.fastMode() is honored on every beat: end-states snap with no waits so
// a deep backlog catches up. Props come from three/propsDice.js (procedural).

import * as THREE from 'three';
import { MSG } from '@shared/protocol.js';
import { DICE_EVENTS } from '@shared/modeEvents.js';
import { TABLE_TOP_Y } from '../../three/barScene.js';
import { seatTableEdgePos } from '../../three/tableView.js';
import { Ease } from '../../three/animations.js';
import {
  createShell,
  createDie,
  diceClusterOffsets,
  DIE_SIZE,
} from '../../three/propsDice.js';

/** Survive-the-cannon regain — mode-local kind mirrored from the server
 *  engine (shared DICE_EVENTS is a frozen 1.0 contract). */
const DIE_REGAINED = 'diceDieRegained';

const FACE_GLYPH = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// ---------------------------------------------------------------------------
// Module-singleton scene state
// ---------------------------------------------------------------------------

/** @type {{group: THREE.Group, shells: Map<number, THREE.Group>, dice: Map<number, THREE.Mesh[]>}|null} */
let board = null;
/** Shells are currently slammed down on the table (i.e. mid-bidding). */
let shellsDown = false;
/** Seats confirmed dead by a cannon hit (queue-synced, unlike snapshot). */
const deadSeats = new Set();

/** Where a seat's shell rests on the table. */
function shellRestPos(seat) {
  const p = seatTableEdgePos(seat);
  p.y = TABLE_TOP_Y + 0.004;
  return p;
}

const seatName = (tools, seat) =>
  tools.store.get('snapshot')?.seats?.find((s) => s.seat === seat)?.name ?? 'Monkey';

/** Lazy board creation + the module's only global wiring (once, ever). */
function ensureBoard(tools) {
  if (board) return board;
  const { engine, store } = tools;
  const group = new THREE.Group();
  group.name = 'banana_dice_board';
  engine.scene.add(group);
  board = { group, shells: new Map(), dice: new Map() };
  // Leaving the game screen (leave/kick/back to menu) must not strand shells
  // over the attract-mode bar.
  store.on('screen', (screen) => {
    if (screen !== 'game') clearBoard();
  });
  return board;
}

function removeProp(obj) {
  obj.parent?.remove(obj);
}

function clearShells() {
  if (!board) return;
  for (const shell of board.shells.values()) removeProp(shell);
  board.shells.clear();
  shellsDown = false;
}

function clearDice(seat = null) {
  if (!board) return;
  if (seat == null) {
    for (const arr of board.dice.values()) for (const d of arr) removeProp(d);
    board.dice.clear();
    return;
  }
  for (const d of board.dice.get(seat) ?? []) removeProp(d);
  board.dice.delete(seat);
}

function clearBoard() {
  clearShells();
  clearDice();
}

/** Alive seats per the freshest snapshot minus queue-confirmed cannon deaths. */
function aliveSeatNos(tools) {
  const seats = tools.store.get('snapshot')?.seats ?? [];
  return seats.filter((s) => s.alive && !deadSeats.has(s.seat)).map((s) => s.seat);
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

/** Round start: sweep last round's dice, then shells SLAM down (staggered). */
async function slamShells(tools) {
  const { engine, fastMode, wait } = tools;
  ensureBoard(tools);
  clearDice();
  clearShells();
  const seats = aliveSeatNos(tools);
  if (!seats.length) return;
  shellsDown = true;

  if (fastMode()) {
    for (const seat of seats) {
      const shell = createShell();
      shell.position.copy(shellRestPos(seat));
      board.group.add(shell);
      board.shells.set(seat, shell);
    }
    return;
  }

  engine.audio.sfx.cardSlide(); // dice rattle into the shells off-screen
  const drops = [];
  seats.forEach((seat, i) => {
    const shell = createShell();
    const rest = shellRestPos(seat);
    shell.position.set(rest.x, rest.y + 0.55, rest.z);
    shell.rotation.y = Math.random() * Math.PI * 2;
    board.group.add(shell);
    board.shells.set(seat, shell);
    drops.push(
      engine.anim
        .to(shell.position, { y: rest.y }, 0.34, { ease: Ease.quadIn, delay: i * 0.07 })
        .promise.then(() => {
          engine.audio.sfx.chipClack();
          engine.particles.smokePuff(rest, { count: 6, size: 0.04, speed: 0.3 });
        })
    );
  });
  engine.rig.lookAtTable?.();
  await Promise.all(drops);
  engine.shake(0.12); // the whole table jumps
  await wait(0.15);
}

/** A bid bark: the bidder reaches in and talks a big game. */
function bidBark(tools, p) {
  const { engine, fastMode } = tools;
  if (fastMode()) return;
  engine.lookAt(p.seat);
  engine.audio.sfx.chatter();
  engine.playClip(p.seat, 'cardPlay'); // not awaited — plays into the next turn
  return tools.wait(0.35);
}

/** The point-and-shout: someone smells a lie. */
async function challengeBeat(tools, p) {
  const { engine, fastMode, sysFlavor, wait } = tools;
  const glyph = FACE_GLYPH[p.bid?.face] ?? '?';
  sysFlavor(
    `🎲 ${seatName(tools, p.callerSeat)} challenges ${seatName(tools, p.targetSeat)}'s ` +
      `${p.bid?.count}×${glyph}! Shells up!`
  );
  if (fastMode()) return;
  engine.lookAt(p.callerSeat);
  engine.audio.sfx.bassSting();
  engine.playClip(p.callerSeat, 'point'); // not awaited — reveal rides the shout
  engine.getMonkey(p.targetSeat)?.flashExpression('shock', 1.2);
  await wait(0.7);
}

/** Shells lift (staggered) and the dice pop out with their real faces. */
async function revealBeat(tools, p) {
  const { engine, store, fastMode, wait } = tools;
  ensureBoard(tools);
  // fx-timed HUD banner: publish AT THE LIFT, not at packet arrival
  const announce = () => store.set('fxDiceReveal', { ...p, ts: Date.now() });

  if (fastMode()) {
    announce();
    clearShells();
    clearDice();
    return;
  }

  announce();
  engine.rig.lookAtTable?.();
  engine.anim.hitStop(0.07);

  const lifts = [];
  (p.dice ?? []).forEach((entry, i) => {
    const seat = entry.seat;
    const rest = shellRestPos(seat);
    const delay = i * 0.12;
    const shell = board.shells.get(seat);
    if (shell) {
      // out+up drift away from the table center, with a reveal tilt
      const away = new THREE.Vector3(rest.x, 0, rest.z).normalize().multiplyScalar(0.1);
      lifts.push(
        (async () => {
          await engine.anim
            .to(shell.position, { x: rest.x + away.x, y: rest.y + 0.42, z: rest.z + away.z }, 0.4, {
              ease: Ease.backOut,
              delay,
            }).promise;
          await engine.anim
            .to(shell.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.18, { ease: Ease.quadIn }).promise;
          removeProp(shell);
          board.shells.delete(seat);
        })()
      );
    }
    // dice pop out under the lifting shell, staggered per die
    const offsets = diceClusterOffsets(entry.dice.length);
    const meshes = [];
    entry.dice.forEach((face, j) => {
      const die = createDie(face);
      die.position.set(rest.x + offsets[j].x, rest.y + offsets[j].y, rest.z + offsets[j].z);
      die.scale.setScalar(0.01);
      board.group.add(die);
      meshes.push(die);
      lifts.push(
        engine.anim
          .to(die.scale, { x: 1, y: 1, z: 1 }, 0.22, { ease: Ease.backOut, delay: delay + 0.16 + j * 0.05 })
          .promise.then(() => {
            engine.audio.sfx.uiTick();
            // golden wilds (and the bid face) glint as they land
            if (face === 1 || face === p.face) {
              engine.particles.goldGlint(die.position.clone().setY(die.position.y + DIE_SIZE));
            }
          })
      );
    });
    board.dice.set(seat, meshes);
  });
  shellsDown = false;
  await Promise.all(lifts);
  engine.audio.sfx.cardFlip();
  await wait(1.1); // let the table read the count
}

/** The loser's die crumbles to dust. */
async function dieLostBeat(tools, p) {
  const { engine, fastMode, wait } = tools;
  if (fastMode()) {
    clearDice(p.seat);
    return;
  }
  engine.lookAt(p.seat);
  const meshes = board?.dice.get(p.seat) ?? [];
  const die = meshes.pop(); // one die off the top of the cluster
  if (die) {
    engine.audio.sfx.sadTrombone();
    await engine.anim
      .to(die.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.4, { ease: Ease.backIn }).promise;
    engine.particles.smokePuff(die.position, { count: 12, size: 0.05, speed: 0.35 });
    removeProp(die);
  }
  engine.playClip(p.seat, p.diceLeft === 0 ? 'shock' : 'sob'); // not awaited
  if (p.diceLeft === 0) {
    tools.sysFlavor(`🎲 ${seatName(tools, p.seat)} is out of dice — the Coconut Cannon warms up…`);
  }
  await wait(0.5);
}

/** Survive the cannon → the bar spots you one die (back to 1). */
async function dieRegainedBeat(tools, p) {
  const { engine, fastMode, sysFlavor, wait } = tools;
  sysFlavor(`🍺 The bar spots ${seatName(tools, p.seat)} one die. Back in the game!`);
  if (fastMode()) return;
  const pos = shellRestPos(p.seat);
  engine.particles.goldGlint(pos.clone().setY(pos.y + 0.08));
  engine.audio.sfx.chipClack();
  await wait(0.4);
}

// ---------------------------------------------------------------------------
// Choreographer contract (game/modes/index.js)
// ---------------------------------------------------------------------------

export default {
  /**
   * Rebuild dice-scene state from a §10.3 snapshot (gameStart / reconnect /
   * spectate) — runs after the shared base resync. Mid-bidding → shells are
   * down; any other phase (dealing/penalty/roundEnd/matchEnd) → bare table.
   */
  resync(snapshot, tools) {
    ensureBoard(tools);
    clearBoard();
    deadSeats.clear();
    for (const s of snapshot?.seats ?? []) if (!s.alive) deadSeats.add(s.seat);
    if (snapshot?.mode !== 'bananaDice' || snapshot.phase !== 'playing') return;
    for (const s of snapshot.seats ?? []) {
      if (!s.alive) continue;
      const shell = createShell();
      shell.position.copy(shellRestPos(s.seat));
      shell.rotation.y = Math.random() * Math.PI * 2;
      board.group.add(shell);
      board.shells.set(s.seat, shell);
    }
    shellsDown = true;
  },

  /**
   * One queued event — awaited in full by gameClient's serial queue.
   * @param {string} kind  modeEvent kind, or a §3.3 hook type (turn/penalty/cannon)
   */
  async handle(kind, p, tools) {
    switch (kind) {
      // First turn of a round (queue-synced, and spectators get it too):
      // shells aren't down yet → this IS the round start. Later turns no-op.
      case MSG.TURN: {
        if (!shellsDown) await slamShells(tools);
        return;
      }

      case DICE_EVENTS.BID:
        return bidBark(tools, p);

      case DICE_EVENTS.CHALLENGE:
        return challengeBeat(tools, p);

      case DICE_EVENTS.REVEAL:
        return revealBeat(tools, p);

      case DICE_EVENTS.DIE_LOST:
        return dieLostBeat(tools, p);

      case DIE_REGAINED:
        return dieRegainedBeat(tools, p);

      // Base choreographCannon (dolly/drumroll/THOOM or click) already ran
      // and was awaited — just tidy the victim's props on a hit.
      case MSG.CANNON: {
        if (p.hit) {
          deadSeats.add(p.seat);
          if (board) {
            const shell = board.shells.get(p.seat);
            if (shell) {
              removeProp(shell);
              board.shells.delete(p.seat);
            }
            clearDice(p.seat);
          }
        }
        return;
      }

      default:
        // penalty hook etc. — base handling is plenty
        return;
    }
  },
};
