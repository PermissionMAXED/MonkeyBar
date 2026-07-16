// Furniture catalog (§C5.2) + placement validity/persistence (agent G11):
// catalog integrity against the binding §C5.2 table and G4's room defs,
// GLB assets on disk, canPlace slot/item/room compat, place/unplace with
// ownership + persistence, wallpaper/floor buy+apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FURNITURE,
  WALLPAPERS,
  FLOORS,
  FURNITURE_BY_ID,
  getEntry,
  getWallpaper,
  getFloor,
  furnitureFor,
  roomSlots,
  ownKey,
} from '../src/data/furniture.js';
import {
  canPlace,
  place,
  unplace,
  placedItem,
  isPlaced,
  isOwned,
  isFurnitureOwned,
  buyFurniture,
  buySurface,
  applySurface,
  appliedSurface,
  slotDefault,
  slotOptions,
  placedRooms,
  placedNonDefaultCount,
} from '../src/systems/furniturePlacement.js';
import { ROOM as KITCHEN } from '../src/home/rooms/kitchen.js';
import { ROOM as LIVING } from '../src/home/rooms/living.js';
import { ROOM as BATHROOM } from '../src/home/rooms/bathroom.js';
import { ROOM as BEDROOM } from '../src/home/rooms/bedroom.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';

const ROOM_DEFS = [KITCHEN, LIVING, BATHROOM, BEDROOM];
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'kenney');

/** isolated store per test (autosave off — no timers keep node alive) */
const makeStore = () => createStore(defaultState(), { autosave: false });

// --------------------------------------------------------------- catalog

test('catalog ids are unique across furniture + wallpapers + floors ownKeys', () => {
  const keys = [
    ...FURNITURE.map((e) => ownKey(e)),
    ...WALLPAPERS.map((e) => ownKey(e)),
    ...FLOORS.map((e) => ownKey(e)),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test('every entry has slot/rooms/price/nameKey and glb XOR procedural', () => {
  for (const e of FURNITURE) {
    assert.equal(e.kind, 'furniture', e.id);
    assert.equal(typeof e.slot, 'string', e.id);
    assert.ok(Array.isArray(e.rooms) && e.rooms.length >= 1, e.id);
    assert.ok(Number.isInteger(e.price) && e.price >= 0, e.id);
    assert.match(e.nameKey, /^furn\./, e.id);
    if (e.procedural) {
      assert.equal(e.glb, undefined, e.id);
      assert.match(e.id, /^proc:/, e.id);
    } else {
      assert.equal(e.glb, `furniture-kit/${e.id}`, e.id);
    }
  }
});

test('§C5.2 binding spot prices', () => {
  const prices = Object.fromEntries(FURNITURE.map((e) => [e.id, e.price]));
  // living
  assert.equal(prices.loungeSofa, 0);
  assert.equal(prices.loungeDesignSofa, 250);
  assert.equal(prices.loungeSofaCorner, 400);
  assert.equal(prices.televisionModern, 300);
  assert.equal(prices.rugRectangle, 90);
  assert.equal(prices.rugRound, 120);
  assert.equal(prices.plantSmall1, 80);
  assert.equal(prices.plantSmall3, 110);
  assert.equal(prices.lampSquareFloor, 140);
  assert.equal(prices.bookcaseClosedWide, 220);
  assert.equal(prices['proc:artSunset'], 120);
  assert.equal(prices['proc:artCarrot'], 120);
  assert.equal(prices['proc:artAbstract'], 120);
  // kitchen
  assert.equal(prices.tableCloth, 260);
  assert.equal(prices.kitchenFridgeLarge, 350);
  assert.equal(prices.kitchenCoffeeMachine, 150);
  assert.equal(prices.kitchenBlender, 120);
  assert.equal(prices.kitchenCabinetUpperDouble, 130);
  // bathroom
  assert.equal(prices.showerRound, 320);
  assert.equal(prices.rugSquare, 90);
  assert.equal(prices.bathroomCabinetDrawer, 150);
  // bedroom
  assert.equal(prices.bedDouble, 380);
  assert.equal(prices.lampRoundTable, 120);
  assert.equal(prices['proc:miniGooby'], 600);
  // wallpapers + floors (§C5.2)
  assert.equal(getWallpaper('cream').price, 0);
  for (const id of ['mint', 'sky', 'peach', 'lavender']) {
    assert.equal(getWallpaper(id).price, 120, id);
  }
  assert.equal(getWallpaper('stars').price, 200);
  assert.equal(getFloor('wood').price, 0);
  assert.equal(getFloor('tile').price, 100);
  assert.equal(getFloor('carpet').price, 100);
  assert.equal(getFloor('checker').price, 150);
});

test('every slot has a free default marked price:0/default:true (§C5.2 rule)', () => {
  for (const def of ROOM_DEFS) {
    for (const [slotId, slot] of Object.entries(def.slots)) {
      if (slot.default == null) {
        assert.equal(slotId, 'wallArt'); // the one slot that starts empty
        continue;
      }
      const entry = getEntry(slot.default);
      assert.ok(entry, `${def.id}:${slotId} default ${slot.default} in catalog`);
      assert.equal(entry.price, 0, slot.default);
      assert.equal(entry.default, true, slot.default);
    }
  }
});

test('catalog matches the room defs exactly (both directions)', () => {
  for (const def of ROOM_DEFS) {
    for (const [slotId, slot] of Object.entries(def.slots)) {
      for (const itemId of slot.items) {
        const entry = getEntry(itemId);
        assert.ok(entry, `${def.id}:${slotId} item ${itemId} missing from catalog`);
        assert.equal(entry.slot, slotId, itemId);
        assert.ok(entry.rooms.includes(def.id), `${itemId} rooms should include ${def.id}`);
      }
      // furnitureFor returns exactly the room-def variants, defaults first
      const ids = furnitureFor(def.id, slotId).map((e) => e.id);
      assert.deepEqual([...ids].sort(), [...slot.items].sort(), `${def.id}:${slotId}`);
      if (slot.default) assert.equal(ids[0], slot.default, `${def.id}:${slotId} default first`);
    }
    assert.deepEqual(
      [...roomSlots(def.id)].sort(),
      Object.keys(def.slots).sort(),
      `${def.id} slots`
    );
  }
  // reverse: every catalog entry is reachable in each room it claims
  for (const e of FURNITURE) {
    for (const roomId of e.rooms) {
      const def = ROOM_DEFS.find((d) => d.id === roomId);
      assert.ok(def?.slots[e.slot]?.items.includes(e.id), `${e.id} listed by ${roomId}:${e.slot}`);
    }
  }
});

test('every non-procedural entry (incl. set pieces) has its GLB on disk', () => {
  const files = new Set();
  for (const e of FURNITURE) {
    if (e.procedural) continue;
    for (const name of e.pieces ?? [e.id]) files.add(`furniture-kit/${name}.glb`);
  }
  for (const rel of files) {
    assert.ok(existsSync(join(ASSET_DIR, rel)), `missing GLB: ${rel}`);
  }
});

test('multi-piece sets match the kitchen room-def piece layouts', () => {
  const tableSet = KITCHEN.furniture.find((f) => f.slot === 'tableSet');
  assert.deepEqual(
    [...new Set(tableSet.pieces.map((p) => p.item))].sort(),
    [...FURNITURE_BY_ID.table.pieces].sort()
  );
  assert.deepEqual(
    [...new Set(tableSet.piecesByItem.tableCloth.map((p) => p.item))].sort(),
    [...FURNITURE_BY_ID.tableCloth.pieces].sort()
  );
});

// ---------------------------------------------------------- canPlace (pure)

test('canPlace: valid slot/item/room combos', () => {
  assert.ok(canPlace('loungeDesignSofa', 'living', 'sofa'));
  assert.ok(canPlace('tableCloth', 'kitchen', 'tableSet'));
  assert.ok(canPlace('showerRound', 'bathroom', 'tub'));
  assert.ok(canPlace('proc:miniGooby', 'bedroom', 'plushie'));
  assert.ok(canPlace('proc:artSunset', 'living', 'wallArt'));
  // shared rugs go in BOTH the living room and the bedroom (§C5.2)
  assert.ok(canPlace('rugRound', 'living', 'rug'));
  assert.ok(canPlace('rugRound', 'bedroom', 'rug'));
});

test('canPlace rejects wrong room / wrong slot / unknown items', () => {
  assert.ok(!canPlace('loungeDesignSofa', 'kitchen', 'sofa')); // no sofa slot there
  assert.ok(!canPlace('loungeDesignSofa', 'living', 'tv')); // wrong slot
  assert.ok(!canPlace('rugRound', 'bathroom', 'rug')); // bathroom rugs differ
  assert.ok(!canPlace('rugSquare', 'living', 'rug')); // …in both directions
  assert.ok(!canPlace('proc:miniGooby', 'living', 'plushie')); // no plushie slot
  assert.ok(!canPlace('kitchenSink', 'kitchen', 'appliance')); // set dressing ≠ catalog
  assert.ok(!canPlace('nope', 'living', 'sofa'));
  assert.ok(!canPlace('loungeSofa', 'nope', 'sofa'));
});

// ------------------------------------------------- ownership + placement

test('defaults are owned for free; paid variants need a purchase', () => {
  const store = makeStore();
  assert.ok(isFurnitureOwned(store, 'loungeSofa'));
  assert.ok(isFurnitureOwned(store, 'bear'));
  assert.ok(!isFurnitureOwned(store, 'loungeDesignSofa'));
  assert.ok(isOwned(store, getWallpaper('cream')));
  assert.ok(!isOwned(store, getWallpaper('stars')));
});

test('place requires ownership; buy → place persists to furniture.placed', () => {
  const store = makeStore();
  store.set('coins', 1000);

  assert.deepEqual(place(store, 'loungeDesignSofa', 'living', 'sofa'), {
    ok: false,
    reason: 'notOwned',
  });

  assert.deepEqual(buyFurniture(store, 'loungeDesignSofa'), { ok: true });
  assert.equal(store.get('coins'), 1000 - 250);
  assert.ok(store.get('furniture.owned').includes('loungeDesignSofa'));
  // double-buy is rejected without spending again
  assert.deepEqual(buyFurniture(store, 'loungeDesignSofa'), { ok: false, reason: 'owned' });
  assert.equal(store.get('coins'), 750);

  assert.deepEqual(place(store, 'loungeDesignSofa', 'living', 'sofa'), { ok: true });
  assert.equal(store.get('furniture.placed')['living:sofa'], 'loungeDesignSofa');
  assert.ok(isPlaced(store, 'loungeDesignSofa', 'living', 'sofa'));
  assert.equal(placedNonDefaultCount(store), 1);

  // invalid placement never writes
  assert.deepEqual(place(store, 'loungeDesignSofa', 'kitchen', 'sofa'), {
    ok: false,
    reason: 'invalid',
  });

  // unplace → back to the free default
  unplace(store, 'living', 'sofa');
  assert.equal(placedItem(store, 'living', 'sofa'), 'loungeSofa');
  assert.equal(placedNonDefaultCount(store), 0);
});

test('placing the slot default clears the override (no stale placed keys)', () => {
  const store = makeStore();
  store.set('coins', 500);
  buyFurniture(store, 'televisionModern');
  place(store, 'televisionModern', 'living', 'tv');
  assert.equal(placedItem(store, 'living', 'tv'), 'televisionModern');
  place(store, 'televisionVintage', 'living', 'tv'); // the free default
  assert.equal(placedItem(store, 'living', 'tv'), 'televisionVintage');
  assert.deepEqual(store.get('furniture.placed'), {});
});

test('shared rug: buy once, place in living AND bedroom', () => {
  const store = makeStore();
  store.set('coins', 200);
  assert.deepEqual(buyFurniture(store, 'rugRound'), { ok: true });
  assert.deepEqual(place(store, 'rugRound', 'living', 'rug'), { ok: true });
  assert.deepEqual(place(store, 'rugRound', 'bedroom', 'rug'), { ok: true });
  assert.deepEqual(placedRooms(store, 'rugRound').sort(), ['bedroom', 'living']);
  assert.equal(store.get('coins'), 200 - 120); // one purchase covers both
});

test('wallArt slot: empty default, placeable after purchase', () => {
  const store = makeStore();
  store.set('coins', 200);
  assert.equal(slotDefault('living', 'wallArt'), null);
  assert.equal(placedItem(store, 'living', 'wallArt'), null);
  buyFurniture(store, 'proc:artCarrot');
  assert.deepEqual(place(store, 'proc:artCarrot', 'living', 'wallArt'), { ok: true });
  assert.equal(placedItem(store, 'living', 'wallArt'), 'proc:artCarrot');
});

test('buyFurniture is atomic: not enough coins → nothing changes', () => {
  const store = makeStore();
  store.set('coins', 100);
  assert.deepEqual(buyFurniture(store, 'bedDouble'), { ok: false, reason: 'coins' });
  assert.equal(store.get('coins'), 100);
  assert.deepEqual(store.get('furniture.owned'), []);
});

test('slotOptions reports owned/placed per variant for the decorate picker', () => {
  const store = makeStore();
  store.set('coins', 1000);
  buyFurniture(store, 'loungeSofaCorner');
  place(store, 'loungeSofaCorner', 'living', 'sofa');
  const opts = slotOptions(store, 'living', 'sofa');
  assert.deepEqual(
    opts.map((o) => [o.entry.id, o.owned, o.placed]),
    [
      ['loungeSofa', true, false],
      ['loungeDesignSofa', false, false],
      ['loungeSofaCorner', true, true],
    ]
  );
});

// ------------------------------------------------------- wallpaper / floor

test('wallpaper buy+apply: ownership gate, per-room apply, namespaced keys', () => {
  const store = makeStore();
  store.set('coins', 500);

  assert.deepEqual(applySurface(store, 'wallpaper', 'living', 'stars'), {
    ok: false,
    reason: 'notOwned',
  });
  assert.deepEqual(buySurface(store, 'wallpaper', 'stars'), { ok: true });
  assert.equal(store.get('coins'), 300);
  assert.ok(store.get('furniture.owned').includes('wallpaper:stars')); // never collides
  assert.deepEqual(buySurface(store, 'wallpaper', 'stars'), { ok: false, reason: 'owned' });

  // owned once → applicable to every room without paying again (§C5.2)
  assert.deepEqual(applySurface(store, 'wallpaper', 'living', 'stars'), { ok: true });
  assert.deepEqual(applySurface(store, 'wallpaper', 'bedroom', 'stars'), { ok: true });
  assert.equal(store.get('coins'), 300);
  assert.equal(appliedSurface(store, 'wallpaper', 'living'), 'stars');
  assert.equal(appliedSurface(store, 'wallpaper', 'bedroom'), 'stars');
  assert.equal(appliedSurface(store, 'wallpaper', 'kitchen'), 'cream'); // default

  // free default applies without owning explicitly
  assert.deepEqual(applySurface(store, 'wallpaper', 'living', 'cream'), { ok: true });
  assert.equal(appliedSurface(store, 'wallpaper', 'living'), 'cream');

  assert.deepEqual(applySurface(store, 'wallpaper', 'attic', 'cream'), {
    ok: false,
    reason: 'room',
  });
  assert.deepEqual(applySurface(store, 'wallpaper', 'living', 'plaid'), {
    ok: false,
    reason: 'unknown',
  });
});

test('floor buy+apply mirrors wallpaper and stays atomic on low coins', () => {
  const store = makeStore();
  store.set('coins', 99);
  assert.deepEqual(buySurface(store, 'floor', 'tile'), { ok: false, reason: 'coins' });
  assert.equal(store.get('coins'), 99);
  store.set('coins', 100);
  assert.deepEqual(buySurface(store, 'floor', 'tile'), { ok: true });
  assert.deepEqual(applySurface(store, 'floor', 'bathroom', 'tile'), { ok: true });
  assert.equal(appliedSurface(store, 'floor', 'bathroom'), 'tile');
  assert.equal(store.get('decor.floor.bathroom'), 'tile');
  assert.equal(store.get('coins'), 0);
});
