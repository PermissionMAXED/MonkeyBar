// Jungle Poker choreography (R6) — the felt-side drama, plugged into the
// gameClient.js SERIAL event queue (contract in game/modes/index.js: every
// handle() is awaited in full, so deals/flights/reveals never overlap).
// Base handling (turn ring, penalty overlay timing, the FULL Coconut Cannon
// sequence on `cannon`, ghost fades on `eliminated`, round/match banners)
// stays in gameClient.js — this module owns the poker props and beats:
//
//   pokerAnte      — a banana chip slides from every seat to the center pot,
//                    then 3 face-down hole cards deal out to each seat
//   pokerYourCards — YOUR three cards fan up in front of the camera
//                    (rank/suit faces from three/propsPoker.js)
//   pokerAction    — fold: the seat's cards flip away off the table;
//                    call/raise: chips arc into the pot (slam clip on raises);
//                    check: a knuckle tap on the felt
//   pokerShowdown  — staggered hole-card reveals with real faces + the
//                    rank-name banner (fxPokerShowdown → pokerHud.js), then
//                    the pot sweeps to the winner(s); uncontested wins sweep
//                    WITHOUT revealing anything (folds stay muck)
//   pokerBust      — broke monkey called out; the §3.3 penalty/cannon pair
//                    that follows rides the base cannonSequence in full
//
// tools.fastMode() is honored on every beat: end-states snap with no waits.

import * as THREE from 'three';
import { POKER_EVENTS, POKER_ACTIONS } from '@shared/modeEvents.js';
import { TABLE_TOP_Y } from '../../three/barScene.js';
import { seatTableEdgePos } from '../../three/tableView.js';
import {
  createPokerCard,
  createPokerChip,
  createPotStack,
  HOLE_SPREAD,
  HOLE_LIE_Y,
} from '../../three/propsPoker.js';
import { Ease } from '../../three/animations.js';

/** Pot position on the felt — opposite the ML pile spot, clear of the cannon. */
const POT_POS = new THREE.Vector3(-0.34, TABLE_TOP_Y, 0);

// ---------------------------------------------------------------------------
// Module-singleton scene state
// ---------------------------------------------------------------------------

/** @type {THREE.Group|null} root for all poker props (pot + table cards) */
let rootGroup = null;
/** @type {ReturnType<typeof createPotStack>|null} */
let pot = null;
/** @type {Map<number, THREE.Mesh[]>} face-down hole cards on the felt, per seat */
const tableCards = new Map();
/** @type {THREE.Mesh[]} the local player's camera-pinned card fan */
let myFan = [];
let wired = false;

function ensureProps(tools) {
  const { engine, store } = tools;
  if (!rootGroup) {
    rootGroup = new THREE.Group();
    rootGroup.name = 'poker_props';
    pot = createPotStack();
    pot.group.position.copy(POT_POS);
    rootGroup.add(pot.group);
  }
  if (!rootGroup.parent) engine.scene.add(rootGroup);
  if (!wired) {
    wired = true;
    // Leaving the game screen must not strand a pot over the attract-mode bar.
    store.on('screen', (screen) => {
      if (screen !== 'game') clearAll(tools);
    });
  }
  return rootGroup;
}

function clearFan(tools) {
  for (const m of myFan) m.parent?.remove(m);
  myFan = [];
  void tools;
}

function removeSeatCards(seat) {
  for (const m of tableCards.get(seat) ?? []) m.parent?.remove(m);
  tableCards.delete(seat);
}

function clearAll(tools) {
  clearFan(tools);
  for (const seat of [...tableCards.keys()]) removeSeatCards(seat);
  pot?.setCount(0);
  rootGroup?.parent?.remove(rootGroup);
}

const seatName = (tools, seat) =>
  tools.store.get('snapshot')?.seats?.find((s) => s.seat === seat)?.name ?? 'Monkey';

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Resting pose of hole card `i` (0..2) in front of a seat, lying face-down. */
function holeCardPose(seat, i) {
  const edge = seatTableEdgePos(seat);
  const inward = new THREE.Vector3(-edge.x, 0, -edge.z).normalize();
  const side = new THREE.Vector3(-inward.z, 0, inward.x);
  const pos = edge
    .clone()
    .addScaledVector(side, (i - 1) * HOLE_SPREAD)
    .addScaledVector(inward, 0.03);
  pos.y = TABLE_TOP_Y + HOLE_LIE_Y + i * 0.0022;
  // lying flat, face-down, long edge toward the seat, slight per-card twist
  const yaw = Math.atan2(edge.x, edge.z) + (i - 1) * 0.12;
  return { pos, rot: new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ') };
}

/** Snap 3 face-down cards onto the felt for a seat (no animation). */
function placeSeatCards(seat) {
  removeSeatCards(seat);
  const meshes = [];
  for (let i = 0; i < 3; i++) {
    const card = createPokerCard(null);
    const { pos, rot } = holeCardPose(seat, i);
    card.position.copy(pos);
    card.rotation.copy(rot);
    rootGroup.add(card);
    meshes.push(card);
  }
  tableCards.set(seat, meshes);
  return meshes;
}

/** One banana chip arcs from a seat's table edge into the pot. */
async function flyChip(tools, seat, slot) {
  const { engine } = tools;
  const chip = createPokerChip();
  const from = seatTableEdgePos(seat);
  from.y = TABLE_TOP_Y + 0.02;
  const to = pot.chipTopPos(slot);
  chip.position.copy(from);
  rootGroup.add(chip);
  await engine.anim.tween({
    duration: 0.34,
    ease: Ease.quadInOut,
    onUpdate(k) {
      chip.position.lerpVectors(from, to, k);
      chip.position.y += Math.sin(k * Math.PI) * 0.14;
      chip.rotation.z = k * Math.PI * 2;
    },
  }).promise;
  rootGroup.remove(chip);
}

/** Move `amount` chips seat → pot and settle the stack at `newPot`. */
async function chipsToPot(tools, seat, amount, newPot) {
  const { engine, fastMode } = tools;
  if (fastMode() || amount <= 0) {
    pot.setCount(newPot);
    return;
  }
  const flights = Math.min(amount, 5); // cap the meshes, land the exact total
  const base = pot.getCount();
  await Promise.all(
    Array.from({ length: flights }, async (_, i) => {
      await engine.anim.wait(i * 0.08); // staggered clinks
      await flyChip(tools, seat, base + i);
      pot.setCount(base + Math.round(((i + 1) / flights) * amount));
    })
  );
  pot.setCount(newPot);
  engine.audio.sfx.chipClack();
}

/** Fan MY cards up in front of the camera with their real faces. */
function showMyFan(tools, cards) {
  const { engine } = tools;
  clearFan(tools);
  if (!cards?.length) return;
  const handGroup = engine.tableView.handGroup; // camera-pinned
  myFan = cards.map((c, i) => {
    const mesh = createPokerCard(c);
    mesh.castShadow = false;
    const n = cards.length;
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = (t - 0.5) * 0.5;
    mesh.position.set(Math.sin(a) * 0.52, Math.cos(a) * 0.09 - 0.59, 0.02 + i * 0.0015);
    mesh.rotation.set(-0.12, 0, -a * 0.9);
    handGroup.add(mesh);
    // rise into the fan
    engine.anim.to(mesh.position, { y: Math.cos(a) * 0.09 - 0.09 }, 0.35, { ease: Ease.backOut });
    return mesh;
  });
  engine.audio.sfx.cardSlide();
}

/** Flip a seat's face-down spread away (fold) — they slide off, still muck. */
async function foldAway(tools, seat) {
  const { engine, fastMode } = tools;
  const meshes = tableCards.get(seat) ?? [];
  if (fastMode() || !meshes.length) {
    removeSeatCards(seat);
    return;
  }
  const out = seatTableEdgePos(seat).setY(0).normalize(); // horizontal outward
  await Promise.all(
    meshes.map(async (m, i) => {
      await engine.anim.wait(i * 0.06);
      const start = m.position.clone();
      await engine.anim.tween({
        duration: 0.32,
        ease: Ease.quadIn,
        onUpdate(k) {
          m.position.x = start.x + out.x * 0.24 * k;
          m.position.z = start.z + out.z * 0.24 * k;
          m.position.y = start.y + Math.sin(k * Math.PI) * 0.08 - k * 0.05;
          m.rotation.y += 0.12;
        },
      }).promise;
    })
  );
  removeSeatCards(seat);
}

/** Staggered showdown flip: a seat's spread lifts and turns face-up. */
async function revealSeat(tools, seat, cards) {
  const { engine, fastMode } = tools;
  const meshes = tableCards.get(seat) ?? placeSeatCards(seat);
  meshes.forEach((m, i) => m.userData.setFace(cards[i] ?? null));
  if (fastMode()) {
    for (const m of meshes) m.rotation.x = -Math.PI / 2; // face-up
    return;
  }
  engine.audio.sfx.cardFlip();
  await Promise.all(
    meshes.map(async (m, i) => {
      await engine.anim.wait(i * 0.14);
      const baseY = m.position.y;
      await engine.anim.tween({
        duration: 0.45,
        ease: Ease.quadInOut,
        onUpdate(k) {
          m.rotation.x = Math.PI / 2 - Math.PI * k; // flip over the long edge
          m.position.y = baseY + Math.sin(k * Math.PI) * 0.14 + 0.03 * k;
        },
      }).promise;
    })
  );
}

/** The pot sweeps to the winner(s): chips arc out, stack empties. */
async function sweepPot(tools, winners, potWon) {
  const { engine, fastMode } = tools;
  if (fastMode()) {
    pot.setCount(0);
    return;
  }
  const flights = [];
  const total = Math.max(1, potWon);
  for (const w of winners) {
    const n = Math.min(5, Math.max(1, Math.round((w.amount / total) * 6)));
    const to = seatTableEdgePos(w.seat);
    to.y = TABLE_TOP_Y + 0.02;
    for (let i = 0; i < n; i++) {
      flights.push(
        (async () => {
          await engine.anim.wait(i * 0.07);
          const chip = createPokerChip();
          const from = pot.chipTopPos(Math.max(0, pot.getCount() - 1 - i));
          chip.position.copy(from);
          rootGroup.add(chip);
          await engine.anim.tween({
            duration: 0.4,
            ease: Ease.quadInOut,
            onUpdate(k) {
              chip.position.lerpVectors(from, to, k);
              chip.position.y += Math.sin(k * Math.PI) * 0.16;
            },
          }).promise;
          rootGroup.remove(chip);
        })()
      );
    }
  }
  const drain = engine.anim.tween({
    duration: 0.5,
    ease: Ease.quadIn,
    onUpdate: (k) => pot.setCount(Math.round(pot.getCount() * (1 - k))),
  }).promise;
  await Promise.all([...flights, drain]);
  pot.setCount(0);
  engine.audio.sfx.chipClack();
}

// ---------------------------------------------------------------------------
// The choreographer (contract in game/modes/index.js)
// ---------------------------------------------------------------------------

export default {
  /**
   * Rebuild the felt from a §10.3 junglePoker snapshot (gameStart /
   * reconnect / spectate) — runs after the shared base resync. Everything
   * snaps: pot count, face-down spreads for live contenders, your own fan.
   */
  resync(snapshot, tools) {
    ensureProps(tools);
    clearFan(tools);
    for (const seat of [...tableCards.keys()]) removeSeatCards(seat);
    if (!snapshot || snapshot.phase === 'matchEnd') {
      pot.setCount(0);
      return;
    }
    pot.setCount(snapshot.pot ?? 0);
    if (snapshot.phase === 'playing') {
      for (const s of snapshot.seats ?? []) {
        if (s.alive && !s.folded) placeSeatCards(s.seat);
      }
      if (snapshot.yourCards?.length) showMyFan(tools, snapshot.yourCards);
    }
  },

  /**
   * One queued event — awaited in full by gameClient's serial queue.
   * @param {string} kind  modeEvent kind (or a §3.3 hook type)
   */
  async handle(kind, p, tools) {
    const { engine, wait, fastMode, sysFlavor } = tools;
    ensureProps(tools);
    switch (kind) {
      // Antes clink in, then the fresh hand deals out face-down.
      case POKER_EVENTS.ANTE: {
        clearFan(tools);
        for (const seat of [...tableCards.keys()]) removeSeatCards(seat);
        const antes = p.antes ?? [];
        if (fastMode()) {
          pot.setCount(p.pot ?? antes.length);
        } else {
          engine.audio.sfx.chipClack();
          const base = 0;
          pot.setCount(base);
          await Promise.all(antes.map((a, i) => flyChip(tools, a.seat, base + i)));
          pot.setCount(p.pot ?? antes.length);
        }
        // the deal: 3 face-down cards spin out to every contender
        const seats = antes.map((a) => a.seat);
        for (const seat of seats) placeSeatCards(seat);
        if (!fastMode()) {
          engine.audio.sfx.cardSlide();
          sysFlavor(`🃏 Antes are in — ${p.pot ?? antes.length} 🍌 in the pot. Three cards each, eyes down.`);
          await wait(0.35);
        }
        return;
      }

      // PRIVATE: your own three cards fan up with their real faces.
      case POKER_EVENTS.YOUR_CARDS: {
        showMyFan(tools, p.cards ?? []);
        return wait(0.3);
      }

      // fold / call (check) / raise
      case POKER_EVENTS.ACTION: {
        const name = seatName(tools, p.seat);
        if (p.action === POKER_ACTIONS.FOLD) {
          if (!fastMode()) {
            engine.lookAt(p.seat);
            engine.playClip(p.seat, 'shrug'); // resigned muck — not awaited
            engine.audio.sfx.cardSlide();
          }
          await foldAway(tools, p.seat);
          if (p.seat === engine.getLocalSeat()) clearFan(tools);
          return wait(0.1);
        }
        if (p.action === POKER_ACTIONS.RAISE) {
          if (!fastMode()) {
            engine.lookAt(p.seat);
            engine.playClip(p.seat, 'slam'); // chips slammed across the felt
            engine.shake(0.15);
          }
          await chipsToPot(tools, p.seat, p.amount ?? 1, p.pot ?? pot.getCount());
          if (!fastMode() && p.allIn) {
            sysFlavor(`🔥 ${name} is ALL IN!`);
            engine.getMonkey(p.seat)?.flashExpression('rage', 1.2);
          }
          return wait(0.12);
        }
        // call — 0 chips = a check (knuckle tap), otherwise chips slide in
        if ((p.amount ?? 0) <= 0) {
          if (!fastMode()) {
            engine.playClip(p.seat, 'cardPlay'); // the tap — not awaited
            engine.audio.sfx.uiTick();
          }
          return wait(0.12);
        }
        if (!fastMode()) engine.playClip(p.seat, 'cardPlay');
        await chipsToPot(tools, p.seat, p.amount, p.pot ?? pot.getCount());
        if (!fastMode() && p.allIn) sysFlavor(`😵 ${name} calls for their last chip — ALL IN.`);
        return wait(0.1);
      }

      // Showdown (or an uncontested sweep — nothing is ever revealed then).
      case POKER_EVENTS.SHOWDOWN: {
        const winners = p.winners ?? [{ seat: p.winnerSeat, amount: p.pot ?? 0 }];
        if (p.uncontested) {
          // fold-and-muck stays private: sweep the felt, never flip a card
          publishShowdownFx(tools, p);
          if (!fastMode()) {
            engine.lookAt(p.winnerSeat);
            sysFlavor(`🏆 Everyone folds — ${seatName(tools, p.winnerSeat)} drags ${p.pot ?? 0} 🍌 uncontested.`);
            engine.playClip(p.winnerSeat, 'smug'); // not awaited
          }
          await sweepPot(tools, winners, p.pot ?? 0);
          for (const seat of [...tableCards.keys()]) await foldAway(tools, seat);
          clearFan(tools);
          return wait(0.2);
        }

        // staggered reveals, weakest drama first: table order from the payload
        engine.audio.music.setIntensity(0.6);
        publishShowdownFx(tools, p); // rank-name banner (pokerHud) rides the first flip
        for (const hand of p.hands ?? []) {
          if (!fastMode()) engine.lookAt(hand.seat);
          await revealSeat(tools, hand.seat, hand.cards ?? []); // staggered reveal IS the drama
          if (!fastMode()) {
            sysFlavor(`🃏 ${seatName(tools, hand.seat)} shows ${hand.name}.`);
            await wait(0.35);
          }
        }
        // winner beat + the pot sweep
        if (!fastMode()) {
          const monkey = engine.getMonkey(winners[0].seat);
          if (monkey) engine.particles.confetti(monkey.headWorldPos(new THREE.Vector3()), { count: 24 });
          engine.playClip(winners[0].seat, winners.length > 1 ? 'shrug' : 'cheer'); // not awaited
          for (const h of p.hands ?? []) {
            if (!winners.some((w) => w.seat === h.seat)) {
              engine.getMonkey(h.seat)?.flashExpression('sweat', 1.2);
            }
          }
        }
        await sweepPot(tools, winners, p.pot ?? 0);
        await wait(0.25);
        // clear the felt for the next hand
        for (const seat of [...tableCards.keys()]) removeSeatCards(seat);
        clearFan(tools);
        engine.audio.music.setIntensity(0.25);
        return;
      }

      // Broke: the ante can't be paid — the cannon takes over from here
      // (the §3.3 penalty/cannon pair rides gameClient's base sequence).
      case POKER_EVENTS.BUST: {
        if (!fastMode()) {
          engine.lookAt(p.seat);
          engine.getMonkey(p.seat)?.setExpression('sweat');
          sysFlavor(`💸 ${seatName(tools, p.seat)} can't cover the ante. The Coconut Cannon hungers…`);
          engine.playClip(p.seat, 'sob'); // not awaited — plays into the penalty
        }
        return wait(0.4);
      }

      default:
        // §3.3 hooks (turn/penalty/cannon) need no extra poker beat.
        return;
    }
  },
};

/** Publish the showdown to the HUD (fx-timed: fires WITH the choreography). */
function publishShowdownFx(tools, p) {
  tools.store.set('fxPokerShowdown', {
    uncontested: !!p.uncontested,
    hands: p.hands ?? [],
    winners: p.winners ?? [],
    winnerSeat: p.winnerSeat,
    pot: p.pot ?? 0,
    ts: Date.now(),
  });
}
