// Room-definition integrity (PLAN.md §G G4): the rooms/*.js tables are PURE
// data (no three.js/DOM imports) so this suite validates them headlessly —
// 4 rooms per §C2, every required anchor present, decor slot ids matching the
// §C5.2 furniture catalog, and every default furniture asset present in the
// committed Kenney manifest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS } from '../src/data/constants.js';
import { PACKS, modelEntry } from '../scripts/kenney-manifest.mjs';
import { ROOM as KITCHEN } from '../src/home/rooms/kitchen.js';
import { ROOM as LIVING } from '../src/home/rooms/living.js';
import { ROOM as BATHROOM } from '../src/home/rooms/bathroom.js';
import { ROOM as BEDROOM } from '../src/home/rooms/bedroom.js';

const DEFS = [KITCHEN, LIVING, BATHROOM, BEDROOM];
const byId = Object.fromEntries(DEFS.map((d) => [d.id, d]));

/** furniture-kit whitelist from the committed manifest (§D1). */
const FURNITURE_KIT = new Set(
  PACKS.find((p) => p.slug === 'furniture-kit').files.map((e) => modelEntry(e).key)
);

/** §C5.2 decor slots per room (binding catalog slot ids). */
const EXPECTED_SLOTS = {
  kitchen: ['tableSet', 'fridge', 'appliance', 'wallShelf'],
  living: ['sofa', 'tv', 'rug', 'plant', 'lamp', 'bookcase', 'wallArt'],
  bathroom: ['tub', 'rug', 'plant', 'shelf'],
  bedroom: ['bed', 'nightstand', 'rug', 'plushie'],
};

/** Required getAnchor names (§G G4) and the room that must provide each. */
const REQUIRED_ANCHORS = {
  bed: 'bedroom',
  bathtub: 'bathroom',
  fridge: 'kitchen',
  sofa: 'living',
  tv: 'living',
  frontDoor: 'living',
  toilet: 'bathroom',
  lampSwitch: 'bedroom',
  wardrobe: 'bedroom',
  ballSpawn: 'living',
};

/** Fixed interactables that must emit tap events (§C2/§G G4). */
const REQUIRED_INTERACTS = {
  fridge: 'kitchen',
  tv: 'living',
  frontDoor: 'living',
  bathtub: 'bathroom',
  toilet: 'bathroom',
  bed: 'bedroom',
  lampSwitch: 'bedroom',
  wardrobe: 'bedroom',
};

/** Every anchor name a room def provides (slot ids auto-register anchors). */
function anchorNames(def) {
  const names = new Set(Object.keys(def.anchors));
  for (const entry of def.furniture) {
    if (entry.anchor) names.add(entry.anchor);
    if (entry.slot) names.add(entry.slot);
  }
  return names;
}

test('there are exactly 4 rooms in §C2 order', () => {
  assert.deepEqual(DEFS.map((d) => d.id), ['kitchen', 'living', 'bathroom', 'bedroom']);
  assert.deepEqual(DEFS.map((d) => d.id), [...ROOMS.ORDER]);
});

test('room defs are pure data (arrays/plain objects, frozen)', () => {
  for (const def of DEFS) {
    assert.ok(Object.isFrozen(def), `${def.id}: def not frozen`);
    assert.ok(Array.isArray(def.furniture), `${def.id}: furniture not an array`);
    assert.equal(typeof def.slots, 'object');
    assert.equal(typeof def.anchors, 'object');
  }
});

test('decor slot ids match the §C5.2 furniture catalog', () => {
  for (const [roomId, expected] of Object.entries(EXPECTED_SLOTS)) {
    assert.deepEqual(
      Object.keys(byId[roomId].slots).sort(),
      [...expected].sort(),
      `${roomId}: slot ids diverge from §C5.2`
    );
  }
});

test('every slot default is a member of its variant list', () => {
  for (const def of DEFS) {
    for (const [slotId, slot] of Object.entries(def.slots)) {
      assert.ok(Array.isArray(slot.items) && slot.items.length > 0, `${def.id}.${slotId}: empty variants`);
      if (slot.default != null) {
        assert.ok(
          slot.items.includes(slot.default),
          `${def.id}.${slotId}: default '${slot.default}' not in variants`
        );
      }
    }
  }
});

test('every GLB slot variant + default exists in the Kenney manifest', () => {
  for (const def of DEFS) {
    for (const [slotId, slot] of Object.entries(def.slots)) {
      for (const item of slot.items) {
        if (item.startsWith('proc:')) continue; // procedural (§C5.2 wall art, mini-Gooby)
        assert.ok(FURNITURE_KIT.has(item), `${def.id}.${slotId}: '${item}' missing from furniture-kit manifest`);
      }
    }
  }
});

test('every placed furniture item (incl. set pieces + variant sets) exists in the manifest', () => {
  for (const def of DEFS) {
    for (const entry of def.furniture) {
      const items = [];
      if (entry.pieces) items.push(...entry.pieces.map((p) => p.item));
      else if (entry.item) items.push(entry.item);
      if (entry.piecesByItem) {
        for (const set of Object.values(entry.piecesByItem)) items.push(...set.map((p) => p.item));
      }
      for (const item of items) {
        assert.ok(FURNITURE_KIT.has(item), `${def.id}: placed item '${item}' missing from furniture-kit manifest`);
      }
    }
  }
});

test('all required anchors are present in their owning rooms', () => {
  for (const def of DEFS) {
    assert.ok(anchorNames(def).has('goobyIdle'), `${def.id}: missing goobyIdle anchor`);
  }
  for (const [name, roomId] of Object.entries(REQUIRED_ANCHORS)) {
    assert.ok(anchorNames(byId[roomId]).has(name), `${roomId}: missing required anchor '${name}'`);
  }
});

test('every §C5.2 decor slot registers a per-room slot anchor', () => {
  for (const def of DEFS) {
    const names = anchorNames(def);
    for (const slotId of Object.keys(def.slots)) {
      assert.ok(names.has(slotId), `${def.id}: slot '${slotId}' has no anchor position`);
    }
  }
});

test('fixed interactables declare their tap events (§C2)', () => {
  for (const [name, roomId] of Object.entries(REQUIRED_INTERACTS)) {
    const found = byId[roomId].furniture.some((entry) => entry.interact === name);
    assert.ok(found, `${roomId}: no furniture entry emits 'tap:${name}'`);
  }
});

test('furniture placements sit inside the 4×3 m room shell (§C2)', () => {
  // shell half-extents (SHELL in roomManager.js — kept in sync by hand since
  // that module imports three.js; §C2 fixes the 4×3 m footprint)
  const HALF_W = 2.0;
  const HALF_D = 1.5;
  for (const def of DEFS) {
    for (const entry of def.furniture) {
      const [x, y, z] = entry.at;
      assert.ok(Math.abs(x) <= HALF_W + 0.01, `${def.id}: entry at x=${x} outside shell`);
      assert.ok(Math.abs(z) <= HALF_D + 0.01, `${def.id}: entry at z=${z} outside shell`);
      assert.ok(y >= 0 && y <= 3.2, `${def.id}: entry lift y=${y} outside shell`);
    }
    for (const [name, at] of Object.entries(def.anchors)) {
      assert.ok(Math.abs(at[0]) <= HALF_W && Math.abs(at[2]) <= HALF_D, `${def.id}: anchor '${name}' outside shell`);
    }
  }
});
