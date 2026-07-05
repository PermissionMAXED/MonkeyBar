// Table view — PLAN.md §2 (client/src/three/tableView.js).
// 8 seat anchors around the table, your-hand fan layout, played-pile position,
// per-seat nameplate sprites (CanvasTexture), turn highlight ring.
//
// R9: also the venue-cosmetics renderer ("host sets the venue", §10.3).
// setVenue(tableId, decoId) lays a felt/wood table design over the round
// table and hangs a cosmeticsRig deco build from bar.decorAnchor; update()
// re-attaches the deco after map swaps (the anchor lives in bar.group and is
// torn down with it) and keeps the golden_cannon tint on the live cannon.

import * as THREE from 'three';
import { makeCanvas, neonMaterial, woodMaterial, matte, brassMaterial } from './materials.js';
import { createCard } from './props.js';
import { SEAT_RADIUS, TABLE_TOP_Y, STOOL_SEAT_H, TABLE_RADIUS } from './barScene.js';
import { Ease } from './animations.js';
import { buildDeco, tintCannonGold, untintCannon } from './cosmeticsRig.js';

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
// Table designs (R9) — felt/wood toppers for the 4 catalog `table` ids.
// Each style returns { feltMat, trimMat } for the shared topper shape.
// ---------------------------------------------------------------------------

const TABLE_STYLES = {
  barrel_throne: () => ({
    feltMat: woodMaterial('#4a2c14', { seed: 61, roughness: 0.6 }),
    trimMat: matte('#3a3a3a', { metalness: 0.85, roughness: 0.35 }),
  }),
  tiki_bench: () => ({
    feltMat: woodMaterial('#a87c4f', { seed: 62, roughness: 0.7 }),
    trimMat: matte('#39b054', { roughness: 0.6, emissive: '#124a22', emissiveIntensity: 0.4 }),
  }),
  vip_stool: () => ({
    feltMat: matte('#7a1226', { roughness: 1 }),
    trimMat: brassMaterial(),
  }),
  velvet_booth: () => ({
    feltMat: matte('#43156b', { roughness: 1 }),
    trimMat: matte('#e8b23a', { metalness: 0.95, roughness: 0.22, emissive: '#5a3c0a', emissiveIntensity: 0.3 }),
  }),
};

/** Build a table-design topper (felt disc + trim ring) sitting on the table. */
function buildTableTopper(tableId) {
  const style = TABLE_STYLES[tableId]?.();
  if (!style) return null;
  const g = new THREE.Group();
  g.name = `table_design_${tableId}`;
  // sits 8 mm proud of the stock top — thinner reads better but z-fights the
  // wood grain at oblique in-match camera angles (near=0.05/far=60 depth)
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_RADIUS - 0.045, TABLE_RADIUS - 0.045, 0.012, 40), style.feltMat);
  felt.position.y = TABLE_TOP_Y + 0.008;
  felt.receiveShadow = true;
  g.add(felt);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_RADIUS - 0.055, 0.012, 8, 44), style.trimMat);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = TABLE_TOP_Y + 0.014;
  g.add(trim);
  return g;
}

/** Dispose a topper/deco group's geometries + locally created materials. */
function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
  g.removeFromParent();
}

/** True while `obj` is still attached to the live scene graph. */
function connectedToScene(obj, scene) {
  let node = obj;
  while (node) {
    if (node === scene) return true;
    node = node.parent;
  }
  return false;
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

  // ---- venue cosmetics (R9: host's table design + bar deco) ----
  const venue = { tableId: null, decoId: null };
  /** @type {THREE.Group|null} felt/wood topper — lives in `group`, survives map swaps */
  let topper = null;
  /** @type {THREE.Group|null} deco build — parented to bar.decorAnchor (dies with the map) */
  let decoGroup = null;
  /** @type {THREE.Object3D|null} the cannon group currently tinted gold */
  let gildedCannon = null;

  /** (Re)hang the deco from the current map's decor anchor, if it exists yet. */
  function mountDeco() {
    if (decoGroup) {
      disposeGroup(decoGroup);
      decoGroup = null;
    }
    if (!venue.decoId) return;
    const anchor = scene.getObjectByName('decor_anchor');
    if (!anchor) return; // no bar built yet — update() retries next frame
    decoGroup = buildDeco(venue.decoId);
    if (decoGroup) anchor.add(decoGroup);
  }

  /** Keep the live cannon gilded iff golden_cannon is the equipped deco. */
  function upkeepCannonTint() {
    const wantGold = venue.decoId === 'golden_cannon';
    if (!wantGold) {
      if (gildedCannon) {
        untintCannon(gildedCannon);
        gildedCannon = null;
      }
      return;
    }
    // map swaps rebuild the cannon — re-tint whenever our reference went stale
    if (!gildedCannon || !connectedToScene(gildedCannon, scene)) {
      gildedCannon = tintCannonGold(scene);
    }
  }

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

    // ------------------------------------------------------------------
    // Venue cosmetics (R9) — engine.applyTableCosmetics records the ids;
    // this renders them. ui/cosmetics.js wires both from store changes.
    // ------------------------------------------------------------------

    /**
     * Equip the venue: a table design over the round table + a deco build on
     * bar.decorAnchor (null clears a slot). Safe to call repeatedly.
     * @param {string|null} tableId  catalog `table` id
     * @param {string|null} decoId   catalog `deco` id
     */
    setVenue(tableId, decoId) {
      const nextTable = tableId ?? null;
      const nextDeco = decoId ?? null;
      if (venue.tableId !== nextTable) {
        venue.tableId = nextTable;
        if (topper) {
          disposeGroup(topper);
          topper = null;
        }
        if (nextTable) {
          topper = buildTableTopper(nextTable);
          if (topper) group.add(topper);
        }
      }
      if (venue.decoId !== nextDeco) {
        venue.decoId = nextDeco;
        mountDeco();
        upkeepCannonTint();
      }
      return { ...venue };
    },
    /** Currently rendered venue ids (test/debug aid). */
    getVenue: () => ({ ...venue }),

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
      // venue upkeep: a map swap tears down bar.group (taking the decor
      // anchor + our deco with it) and rebuilds the cannon — re-mount/re-tint
      // whenever our references fall off the live scene graph.
      if (venue.decoId) {
        if (!decoGroup || !connectedToScene(decoGroup, scene)) mountDeco();
        upkeepCannonTint();
      }
    },

    dispose() {
      for (const seat of [...nameplates.keys()]) this.removeNameplate(seat);
      this.clearHand();
      this.setVenue(null, null);
      camera.remove(handGroup);
      group.removeFromParent();
    },
  };
}
