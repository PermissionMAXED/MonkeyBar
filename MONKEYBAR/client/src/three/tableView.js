// Table view — PLAN.md §2 (client/src/three/tableView.js).
// 8 seat anchors around the table, your-hand fan layout, played-pile position,
// per-seat nameplate sprites (CanvasTexture), turn highlight ring.

import * as THREE from 'three';
import { makeCanvas, neonMaterial } from './materials.js';
import { createCard } from './props.js';
import { SEAT_RADIUS, TABLE_TOP_Y, STOOL_SEAT_H, TABLE_RADIUS } from './barScene.js';
import { Ease } from './animations.js';

export const SEAT_COUNT = 8;

/** Angle of a seat around the table (seat 0 at +z, clockwise). */
export function seatAngle(seat) {
  return (seat / SEAT_COUNT) * Math.PI * 2;
}

/** World position of a seat's stool (monkey root sits slightly above). */
export function seatPosition(seat, radius = SEAT_RADIUS) {
  const a = seatAngle(seat);
  return new THREE.Vector3(Math.sin(a) * radius, STOOL_SEAT_H + 0.02, Math.cos(a) * radius);
}

/** Position on the table rim in front of a seat (where plays land). */
export function seatTableEdgePos(seat) {
  const a = seatAngle(seat);
  return new THREE.Vector3(Math.sin(a) * (TABLE_RADIUS * 0.62), TABLE_TOP_Y + 0.01, Math.cos(a) * (TABLE_RADIUS * 0.62));
}

// ---------------------------------------------------------------------------
// Nameplate sprites
// ---------------------------------------------------------------------------

function makeNameplateTexture(name, accent = '#39ff88') {
  const { canvas, ctx } = makeCanvas(256, 64);
  ctx.clearRect(0, 0, 256, 64);
  // pill background
  ctx.fillStyle = 'rgba(10,8,5,0.78)';
  ctx.beginPath();
  ctx.roundRect(6, 8, 244, 48, 24);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#f0e6d8';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let display = name;
  while (ctx.measureText(display).width > 220 && display.length > 2) display = display.slice(0, -2) + '…';
  ctx.fillText(display, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// createTableView
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera  local hand fan is parented here
 * @param {ReturnType<import('./animations.js').createAnimator>} anim
 */
export function createTableView(scene, camera, anim) {
  const group = new THREE.Group();
  group.name = 'table_view';
  scene.add(group);

  /** @type {Map<number, THREE.Sprite>} */
  const nameplates = new Map();
  /** @type {THREE.Mesh[]} face-down cards currently in the pile */
  const pile = [];
  /** @type {THREE.Mesh[]} revealed cards (kept until clearPile) */
  const revealed = [];
  /** @type {THREE.Mesh[]} local hand cards (parented to camera) */
  let handCards = [];

  // turn highlight — soft neon ring on the floor under the acting seat
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 32), neonMaterial('#39ff88', 1.8));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  group.add(ring);
  let ringT = 0;

  // local hand fan container, pinned to the camera bottom
  const handGroup = new THREE.Group();
  handGroup.position.set(0, -0.34, -0.72);
  camera.add(handGroup);

  function layoutHand() {
    const n = handCards.length;
    handCards.forEach((card, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const spreadAngle = Math.min(0.16 * n, 0.85);
      const a = (t - 0.5) * spreadAngle;
      const targetX = Math.sin(a) * 0.52;
      const targetY = Math.cos(a) * 0.09 - 0.09 + Math.abs(t - 0.5) * -0.02;
      anim.to(card.position, { x: targetX, y: targetY, z: i * 0.0015 }, 0.35, { ease: Ease.backOut });
      anim.to(card.rotation, { z: -a * 0.9, x: -0.12 }, 0.35, { ease: Ease.backOut });
    });
  }

  return {
    group,
    handGroup,
    seatPosition,
    seatAngle,
    seatTableEdgePos,

    /** Attach a floating nameplate above a seat's monkey head. */
    addNameplate(seat, name, headWorldPos, accent) {
      this.removeNameplate(seat);
      const tex = makeNameplateTexture(name, accent);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.scale.set(0.42, 0.105, 1);
      sprite.position.copy(headWorldPos);
      sprite.position.y += 0.24;
      sprite.renderOrder = 5;
      group.add(sprite);
      nameplates.set(seat, sprite);
      return sprite;
    },
    removeNameplate(seat) {
      const old = nameplates.get(seat);
      if (old) {
        old.material.map?.dispose();
        old.material.dispose();
        group.remove(old);
        nameplates.delete(seat);
      }
    },

    /** Move the glowing turn ring to a seat (or hide with null). */
    setTurn(seat) {
      if (seat == null || seat < 0) {
        ring.visible = false;
        return;
      }
      const p = seatPosition(seat);
      ring.position.set(p.x, 0.02, p.z);
      ring.visible = true;
    },

    // ------------------------------------------------------------------
    // Local hand
    // ------------------------------------------------------------------

    /**
     * Show the local player's hand as a card fan pinned to the camera.
     * @param {Array<{id:string, fruit:string}>} cards
     * @returns {THREE.Mesh[]} the card meshes (pass to takeHandCards/playCards)
     */
    showHand(cards) {
      this.clearHand();
      handCards = (cards || []).map((c, i) => {
        const mesh = createCard(c.fruit);
        mesh.userData.cardId = c.id;
        mesh.position.set(0, -0.5, 0);
        mesh.castShadow = false;
        handGroup.add(mesh);
        return mesh;
      });
      layoutHand();
      return handCards;
    },
    clearHand() {
      for (const c of handCards) {
        handGroup.remove(c);
      }
      handCards = [];
    },
    getHandCards() {
      return handCards;
    },
    /** Remove `count` cards from the fan (they were played); returns them. */
    takeHandCards(count) {
      const taken = handCards.splice(Math.max(0, handCards.length - count), count);
      for (const c of taken) handGroup.remove(c);
      layoutHand();
      return taken;
    },

    // ------------------------------------------------------------------
    // Played pile
    // ------------------------------------------------------------------

    /**
     * Animate `count` face-down cards flying from a seat to the pile.
     * Returns a promise resolving when they land.
     */
    async addToPile(seat, count) {
      const from = seatTableEdgePos(seat);
      const promises = [];
      for (let i = 0; i < count; i++) {
        const card = createCard(null);
        card.rotation.x = -Math.PI / 2;
        card.position.copy(from);
        card.position.y += 0.06;
        group.add(card);
        const idx = pile.length;
        pile.push(card);
        const tx = 0.3 + (Math.random() - 0.5) * 0.08;
        const tz = (Math.random() - 0.5) * 0.14;
        const ty = TABLE_TOP_Y + 0.006 + idx * 0.005;
        const rz = (Math.random() - 0.5) * 0.9;
        promises.push(
          (async () => {
            await anim.wait(i * 0.12);
            const start = card.position.clone();
            await anim.tween({
              duration: 0.42,
              ease: Ease.quadInOut,
              onUpdate(k) {
                card.position.x = start.x + (tx - start.x) * k;
                card.position.z = start.z + (tz - start.z) * k;
                card.position.y = start.y + (ty - start.y) * k + Math.sin(k * Math.PI) * 0.22;
                card.rotation.z = rz * k;
              },
            }).promise;
          })()
        );
      }
      await Promise.all(promises);
      return pile.slice(-count);
    },

    /**
     * Fly the actual local-hand meshes to the pile: reparent them from the
     * camera-space hand group into the world group preserving world transform,
     * then tween each along the standard pile flight/landing. Cards turn
     * face-down at takeoff (plays are secret — only the count is public).
     * @param {THREE.Mesh[]} cardMeshes  meshes from showHand/getHandCards
     */
    async playHandCards(cardMeshes) {
      for (const card of cardMeshes) {
        const i = handCards.indexOf(card);
        if (i !== -1) handCards.splice(i, 1);
      }
      layoutHand();
      const flights = cardMeshes.map((card, i) => {
        group.attach(card); // world transform preserved
        card.userData.setFruit(null); // face-down
        card.castShadow = true;
        const idx = pile.length;
        pile.push(card);
        const tx = 0.3 + (Math.random() - 0.5) * 0.08;
        const tz = (Math.random() - 0.5) * 0.14;
        const ty = TABLE_TOP_Y + 0.006 + idx * 0.005;
        const rz = (Math.random() - 0.5) * 0.9;
        return (async () => {
          await anim.wait(i * 0.12);
          const start = card.position.clone();
          const startQuat = card.quaternion.clone();
          const endQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rz));
          await anim.tween({
            duration: 0.42,
            ease: Ease.quadInOut,
            onUpdate(k) {
              card.position.x = start.x + (tx - start.x) * k;
              card.position.z = start.z + (tz - start.z) * k;
              card.position.y = start.y + (ty - start.y) * k + Math.sin(k * Math.PI) * 0.22;
              card.quaternion.slerpQuaternions(startQuat, endQuat, k);
            },
          }).promise;
          // exact landing pose so revealPile's flip math lines up
          card.position.set(tx, ty, tz);
          card.rotation.set(-Math.PI / 2, 0, rz);
        })();
      });
      await Promise.all(flights);
      return pile.slice(-cardMeshes.length);
    },

    /**
     * Flip the last `cards.length` pile cards face-up showing their fruits.
     * `lie` tints the reveal glow red, truth green.
     */
    async revealPile(cards, lie) {
      const n = Math.min(cards.length, pile.length);
      const toReveal = pile.splice(pile.length - n, n);
      const flips = toReveal.map(async (card, i) => {
        card.userData.setFruit(cards[i]?.fruit ?? null);
        const baseY = card.position.y;
        await anim.wait(i * 0.22);
        await anim.tween({
          duration: 0.5,
          ease: Ease.quadInOut,
          onUpdate(k) {
            card.rotation.x = -Math.PI / 2 + Math.PI * k; // flip over
            card.position.y = baseY + Math.sin(k * Math.PI) * 0.16 + 0.06 * k;
          },
        }).promise;
        revealed.push(card);
      });
      await Promise.all(flips);
      // verdict glow ring around the pile
      const glow = new THREE.Mesh(
        new THREE.TorusGeometry(0.26, 0.012, 8, 28),
        neonMaterial(lie ? '#ff3d3d' : '#39ff88', 2.6)
      );
      glow.rotation.x = Math.PI / 2;
      glow.position.set(0.3, TABLE_TOP_Y + 0.01, 0);
      group.add(glow);
      anim.tween({
        duration: 1.6,
        ease: Ease.quadOut,
        onUpdate(k) {
          glow.scale.setScalar(1 + k * 0.5);
          glow.material.emissiveIntensity = 2.6 * (1 - k);
        },
        onComplete() {
          group.remove(glow);
          glow.geometry.dispose();
        },
      });
    },

    /** Sweep all pile + revealed cards away (round end). */
    async clearPile() {
      const all = [...pile, ...revealed];
      pile.length = 0;
      revealed.length = 0;
      await Promise.all(
        all.map(async (card, i) => {
          await anim.wait(i * 0.03);
          const dir = card.position.x >= 0 ? 1 : -1;
          await anim.to(card.position, { x: card.position.x + dir * 0.6, y: card.position.y - 0.35 }, 0.4, {
            ease: Ease.quadIn,
          }).promise;
          group.remove(card);
        })
      );
    },

    update(dt, elapsed) {
      if (ring.visible) {
        ringT += dt;
        const pulse = 1 + Math.sin(ringT * 5) * 0.12;
        ring.scale.setScalar(pulse);
        ring.material.emissiveIntensity = 1.5 + Math.sin(ringT * 5) * 0.7;
      }
    },

    dispose() {
      for (const seat of [...nameplates.keys()]) this.removeNameplate(seat);
      this.clearHand();
      camera.remove(handGroup);
      group.removeFromParent();
    },
  };
}
