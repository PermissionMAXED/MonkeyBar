// Furniture catalog (§C5.2) + placement validity/persistence (agent G11):
// catalog integrity against the binding §C5.2 table and G4's room defs,
// GLB assets on disk, canPlace slot/item/room compat, place/unplace with
// ownership + persistence, wallpaper/floor buy+apply.
// V2/G22 extends: §C8.1/§C8.2/§C8.3 catalog counts + binding prices, the new
// indoor slots, garden decor + the pre-G19 catalog placement fallback.
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
import { EN, DE } from '../src/data/strings.js';
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
import { DECOR_MODEL_KEYS } from '../src/home/decor.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';

const ROOM_DEFS = [KITCHEN, LIVING, BATHROOM, BEDROOM];
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'kenney');
const KAYKIT_ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'kaykit');

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
      // V2/G22: every glb is a pack-qualified asset key; garden pieces may
      // resolve to other packs (§C8.3) while furniture-kit keys stay id-derived
      assert.match(e.glb, /^[a-z0-9-]+\/[\w-]+$/, e.id);
      if (e.glb.startsWith('furniture-kit/')) {
        assert.equal(e.glb, `furniture-kit/${e.id}`, e.id);
      }
      for (const piece of e.cluster ?? []) {
        assert.match(piece.glb, /^[a-z0-9-]+\/[\w-]+$/, `${e.id} cluster piece`);
      }
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

// slots that start empty: v1's wallArt + the V2/G22 §C8.1 additions
const EMPTY_DEFAULT_SLOTS = new Set([
  'wallArt', 'ceilingFan', 'sideboard', 'bar', 'washer', 'sideTable', 'floorClutter',
]);

test('every slot has a free default marked price:0/default:true (§C5.2 rule)', () => {
  for (const def of ROOM_DEFS) {
    for (const [slotId, slot] of Object.entries(def.slots)) {
      if (slot.default == null) {
        assert.ok(EMPTY_DEFAULT_SLOTS.has(slotId), `${def.id}:${slotId} starts empty`);
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
    // V2/FIX-C: reward entries live in catalog-only slots (not in the frozen
    // room defs) — placement resolves via the catalog fallback, tested below
    if (e.reward) continue;
    for (const roomId of e.rooms) {
      // V2/G22: the garden's RoomDef is G19's rooms/garden.js — its slot
      // compat is covered by the catalog-fallback tests below instead
      if (roomId === 'garden') continue;
      const def = ROOM_DEFS.find((d) => d.id === roomId);
      assert.ok(def?.slots[e.slot]?.items.includes(e.id), `${e.id} listed by ${roomId}:${e.slot}`);
    }
  }
});

test('every non-procedural entry (incl. set + cluster pieces) has its GLB on disk', () => {
  const files = new Set();
  for (const e of FURNITURE) {
    if (e.procedural) continue;
    // V2/G22: glb keys are pack-qualified (garden pieces live outside
    // furniture-kit); multi-piece sets stay furniture-kit names
    if (e.pieces) for (const name of e.pieces) files.add(`furniture-kit/${name}.glb`);
    else files.add(`${e.glb}.glb`);
    for (const piece of e.cluster ?? []) files.add(`${piece.glb}.glb`);
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
      ['loungeChair', false, false], // V2/G22 §C8.1 4th seat
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

// ==================== V2/G22 (PLAN2 §C8) — catalog 2.0 ======================

test('§A3 catalog counts: +30 new furniture buyables, wallpapers 10, floors 7', () => {
  // 40 v1 entries + 23 §C8.1 indoor + 11 §C8.3 garden items
  //   + 4 V2/FIX-C §C6 set-reward decos
  assert.equal(FURNITURE.length, 78);
  // §A3 "+30 new buyables": v1 ships 23 non-default furniture buyables;
  // 2.0 adds 23 indoor + 7 buyable garden pieces = 53 total (rewards are
  // price 0 and never counted as buyables)
  const buyables = FURNITURE.filter((e) => !e.default && e.price > 0);
  assert.equal(buyables.length, 53);
  assert.equal(WALLPAPERS.length, 10); // §C8.2: 6 → 10
  assert.equal(FLOORS.length, 7); // §C8.2: 4 → 7
  // every free entry is a slot default OR a §C6 set reward; every
  // non-free entry is a plain buyable (V2/FIX-C extends the v1 invariant)
  for (const e of FURNITURE) {
    assert.equal(e.price === 0, !!(e.default || e.reward), e.id);
    assert.ok(!(e.default && e.reward), `${e.id} cannot be both default and reward`);
  }
});

test('§C8.1 indoor additions: binding prices, slots and rooms', () => {
  /** id → [slot, room, price] (§C8.1 verbatim). */
  const SPEC = {
    loungeChair: ['sofa', 'living', 180],
    tableCoffee: ['sideboard', 'living', 140],
    tableCoffeeGlass: ['sideboard', 'living', 200],
    cabinetTelevision: ['sideboard', 'living', 160],
    radio: ['sideboard', 'living', 90],
    speaker: ['sideboard', 'living', 110],
    ceilingFan: ['ceilingFan', 'living', 150],
    'proc:artSkyline': ['wallArt', 'living', 140],
    'proc:artRainbow': ['wallArt', 'living', 140],
    kitchenMicrowave: ['appliance', 'kitchen', 130],
    kitchenBar: ['bar', 'kitchen', 240],
    stoolBar: ['bar', 'kitchen', 80],
    washer: ['washer', 'bathroom', 260],
    shower: ['tub', 'bathroom', 300],
    sideTable: ['sideTable', 'bedroom', 90],
    sideTableDrawers: ['sideTable', 'bedroom', 130],
    cabinetBed: ['sideTable', 'bedroom', 170],
    cabinetBedDrawer: ['sideTable', 'bedroom', 190],
    coatRackStanding: ['sideTable', 'bedroom', 100],
    pillow: ['floorClutter', 'bedroom', 45],
    pillowBlue: ['floorClutter', 'bedroom', 45],
    books: ['floorClutter', 'bedroom', 35],
    trashcan: ['floorClutter', 'bedroom', 40],
  };
  assert.equal(Object.keys(SPEC).length, 23);
  for (const [id, [slot, room, price]] of Object.entries(SPEC)) {
    const e = FURNITURE_BY_ID[id];
    assert.ok(e, `catalog missing ${id}`);
    assert.equal(e.slot, slot, `${id} slot`);
    assert.ok(e.rooms.includes(room), `${id} rooms`);
    assert.equal(e.price, price, `${id} price (§C8.1 binding)`);
    assert.equal(e.default, undefined, `${id} is a buyable`);
  }
  // the fan hangs from the ceiling anchor (decor.js mount handling)
  assert.equal(FURNITURE_BY_ID.ceilingFan.mount, 'ceiling');
});

test('§C8.3 garden decor: 6 slots, 11 items, verbatim prices + defaults', () => {
  assert.deepEqual(roomSlots('garden'), [
    'gardenBench', 'gardenGnome', 'birdbath', 'flowerBed', 'gardenPath', 'gardenTree',
  ]);
  // 11 §C8.3 pieces + the V2/FIX-C gardenTrophy reward (excluded from the
  // buyable-slot list asserted just above)
  const garden = FURNITURE.filter((e) => e.rooms.includes('garden'));
  assert.equal(garden.length, 12);
  assert.equal(garden.filter((e) => !e.reward).length, 11);
  assert.deepEqual(
    garden.filter((e) => e.default).map((e) => e.id),
    ['proc:benchWood', 'flowerBedWild', 'proc:pathDirt', 'treeDefault']
  );
  const price = (id) => FURNITURE_BY_ID[id].price;
  assert.equal(price('proc:benchPastel'), 220);
  assert.equal(price('proc:gnome'), 180);
  assert.equal(price('proc:gnomeGold'), 900); // endgame flex
  assert.equal(price('proc:birdbath'), 240);
  assert.equal(price('flowerBedRose'), 160);
  assert.equal(price('pathStones'), 190);
  assert.equal(price('treeBlossom'), 260);
  // §C8.3 models: suburban stone path, tinted oak blossom tree, rose tint
  assert.equal(FURNITURE_BY_ID.pathStones.glb, 'city-kit-suburban/path-stones-short');
  assert.equal(FURNITURE_BY_ID.treeBlossom.glb, 'nature-kit/tree_oak');
  assert.equal(FURNITURE_BY_ID.treeBlossom.tintTarget, 'foliage');
  assert.equal(FURNITURE_BY_ID.flowerBedRose.tintTarget, 'bloom');
  // flower beds are nature-kit clusters (§C8.3 "flower cluster")
  assert.ok(FURNITURE_BY_ID.flowerBedWild.cluster.length >= 3);
  assert.ok(FURNITURE_BY_ID.flowerBedRose.cluster.length >= 3);
});

test('§C8.2 wallpaper/floor additions: verbatim ids + prices', () => {
  assert.equal(getWallpaper('sunset').price, 150);
  assert.equal(getWallpaper('meadow').price, 150);
  assert.equal(getWallpaper('candy').price, 150);
  assert.equal(getWallpaper('ocean').price, 200);
  assert.equal(getFloor('marble').price, 180);
  assert.equal(getFloor('walnut').price, 160);
  assert.equal(getFloor('terracotta').price, 140);
});

test('garden placement works pre-G19 via the catalog slot fallback', () => {
  // slot defs derive from the catalog when the room def is not in
  // furniturePlacement's ROOMS_BY_ID (rooms/garden.js is G19's)
  assert.ok(canPlace('proc:gnomeGold', 'garden', 'gardenGnome'));
  assert.ok(canPlace('pathStones', 'garden', 'gardenPath'));
  assert.ok(!canPlace('proc:gnomeGold', 'garden', 'gardenPath')); // wrong slot
  assert.ok(!canPlace('loungeChair', 'garden', 'gardenBench')); // indoor item
  assert.equal(slotDefault('garden', 'gardenPath'), 'proc:pathDirt');
  assert.equal(slotDefault('garden', 'gardenGnome'), null); // "none default" (§C8.3)

  const store = makeStore();
  store.set('coins', 2000);
  assert.deepEqual(buyFurniture(store, 'proc:gnomeGold'), { ok: true });
  assert.deepEqual(place(store, 'proc:gnomeGold', 'garden', 'gardenGnome'), { ok: true });
  assert.deepEqual(buyFurniture(store, 'pathStones'), { ok: true });
  assert.deepEqual(place(store, 'pathStones', 'garden', 'gardenPath'), { ok: true });
  assert.equal(store.get('furniture.placed')['garden:gardenGnome'], 'proc:gnomeGold');
  assert.equal(placedItem(store, 'garden', 'gardenPath'), 'pathStones');
  assert.equal(store.get('coins'), 2000 - 900 - 190);
  // free garden defaults are owned out of the box
  assert.ok(isFurnitureOwned(store, 'proc:benchWood'));
  assert.ok(isFurnitureOwned(store, 'treeDefault'));
  // decorate-picker options work for garden slots too
  assert.deepEqual(
    slotOptions(store, 'garden', 'gardenGnome').map((o) => [o.entry.id, o.owned, o.placed]),
    [['proc:gnome', false, false], ['proc:gnomeGold', true, true]]
  );
  unplace(store, 'garden', 'gardenPath'); // back to the free dirt path
  assert.equal(placedItem(store, 'garden', 'gardenPath'), 'proc:pathDirt');
});

// ============= V2/FIX-C (P1-3) — §C6 collection-set reward furniture ========

test('V2/FIX-C reward catalog: the 4 §C6 claimSet ids exist with valid reward-only slots', async () => {
  const { COLLECTIONS } = await import('../src/data/constants.js');
  /** id → [slot, room] (V2/FIX-C placement design). */
  const SPEC = {
    'proc:goldfishBowl': ['fishBowl', 'living'],
    'proc:goldenWateringCan': ['gardenTrophy', 'garden'],
    'proc:toyCity': ['toyCorner', 'bedroom'],
    'proc:candyJar': ['candyShelf', 'kitchen'],
  };
  // every §C6 set reward id has a catalog entry (regression: getEntry→null
  // made canPlace false and the decorate picker never offered them)
  for (const set of COLLECTIONS.SETS) {
    assert.ok(SPEC[set.reward.furniture], `${set.id} reward ${set.reward.furniture} covered`);
    assert.ok(getEntry(set.reward.furniture), `${set.reward.furniture} in catalog`);
  }
  for (const [id, [slot, room]] of Object.entries(SPEC)) {
    const e = getEntry(id);
    assert.ok(e, `catalog missing ${id}`);
    assert.equal(e.slot, slot, `${id} slot`);
    assert.deepEqual(e.rooms, [room], `${id} rooms`);
    assert.equal(e.price, 0, `${id} is never a purchase`);
    assert.equal(e.reward, true, `${id} reward flag`);
    assert.equal(e.procedural, true, `${id} built by decor.js`);
    assert.equal(e.default, undefined, `${id} is NOT a free slot default`);
  }
});

test('V3/G46 reward visuals use committed models while frozen reward ids stay procedural', () => {
  const SPEC = {
    'proc:goldenWateringCan': ['survival-kit/bucket'],
    'proc:toyCity': [
      'toy-car-kit/track-narrow-straight',
      'toy-car-kit/track-narrow-curve',
      'toy-car-kit/track-narrow-corner-small',
    ],
    'proc:candyJar': ['kaykit-restaurant/jar_A_large'],
  };
  assert.equal(DECOR_MODEL_KEYS['proc:goldfishBowl'], undefined, 'goldfish bowl stays hand-built');
  for (const [id, modelKeys] of Object.entries(SPEC)) {
    const entry = getEntry(id);
    assert.ok(entry?.reward && entry.procedural, `${id}: frozen reward row changed`);
    assert.deepEqual(DECOR_MODEL_KEYS[id], modelKeys, `${id}: replacement keys`);
    for (const key of modelKeys) {
      const [slug, name] = key.split('/');
      const root = slug.startsWith('kaykit-') ? KAYKIT_ASSET_DIR : ASSET_DIR;
      const ext = slug.startsWith('kaykit-') ? 'gltf' : 'glb';
      assert.ok(existsSync(join(root, slug, `${name}.${ext}`)), `${id}: missing ${key}`);
    }
  }
});

test('V2/FIX-C reward slots hidden from the shop grid, exposed via rewardSlots', async () => {
  const { rewardSlots } = await import('../src/data/furniture.js');
  // roomSlots feeds the shop furniture grid — reward slots must never show
  assert.ok(!roomSlots('living').includes('fishBowl'));
  assert.ok(!roomSlots('garden').includes('gardenTrophy'));
  assert.ok(!roomSlots('bedroom').includes('toyCorner'));
  assert.ok(!roomSlots('kitchen').includes('candyShelf'));
  // the decorate picker unions these in (home/decor.js)
  assert.deepEqual(rewardSlots('living'), ['fishBowl']);
  assert.deepEqual(rewardSlots('garden'), ['gardenTrophy']);
  assert.deepEqual(rewardSlots('bedroom'), ['toyCorner']);
  assert.deepEqual(rewardSlots('kitchen'), ['candyShelf']);
  assert.deepEqual(rewardSlots('bathroom'), []);
});

test('V2/FIX-C reward placement: locked until claimSet lands it in furniture.owned', () => {
  // canPlace resolves the reward-only slots via the catalog fallback
  assert.ok(canPlace('proc:goldfishBowl', 'living', 'fishBowl'));
  assert.ok(canPlace('proc:goldenWateringCan', 'garden', 'gardenTrophy'));
  assert.ok(canPlace('proc:toyCity', 'bedroom', 'toyCorner'));
  assert.ok(canPlace('proc:candyJar', 'kitchen', 'candyShelf'));
  assert.ok(!canPlace('proc:goldfishBowl', 'kitchen', 'fishBowl')); // wrong room
  assert.ok(!canPlace('loungeChair', 'living', 'fishBowl')); // wrong slot family
  assert.equal(slotDefault('living', 'fishBowl'), null); // starts empty

  const store = makeStore();
  // price 0 but NOT default → not owned before the set is claimed
  assert.ok(!isFurnitureOwned(store, 'proc:goldfishBowl'));
  assert.deepEqual(place(store, 'proc:goldfishBowl', 'living', 'fishBowl'), {
    ok: false,
    reason: 'notOwned',
  });

  // claimSet's payout path: the reward id lands in furniture.owned
  store.update((state) => { state.furniture.owned.push('proc:goldfishBowl'); });
  assert.ok(isFurnitureOwned(store, 'proc:goldfishBowl'));
  assert.deepEqual(place(store, 'proc:goldfishBowl', 'living', 'fishBowl'), { ok: true });
  assert.equal(store.get('furniture.placed')['living:fishBowl'], 'proc:goldfishBowl');
  assert.equal(placedItem(store, 'living', 'fishBowl'), 'proc:goldfishBowl');
  // decorate-picker options list it owned+placed
  assert.deepEqual(
    slotOptions(store, 'living', 'fishBowl').map((o) => [o.entry.id, o.owned, o.placed]),
    [['proc:goldfishBowl', true, true]]
  );
  // unplace → back to the empty slot (no free default)
  unplace(store, 'living', 'fishBowl');
  assert.equal(placedItem(store, 'living', 'fishBowl'), null);
});

test('every catalog nameKey (incl. V2/G22 additions) exists in EN AND DE', () => {
  for (const e of [...FURNITURE, ...WALLPAPERS, ...FLOORS]) {
    assert.equal(typeof EN[e.nameKey], 'string', `EN missing ${e.nameKey}`);
    assert.equal(typeof DE[e.nameKey], 'string', `DE missing ${e.nameKey}`);
  }
});
