// Furniture ownership & placement (§C5.2, §E3 — agent G11). Pure own/place
// logic against the data/furniture.js catalog and the rooms/*.js slot tables:
// canPlace validity (slot/item/room compat), place/unplace with persistence to
// `furniture.{owned,placed}`, wallpaper/floor buy+apply into `decor.*`.
// Every mutation goes through the injected store (§E2 — 'decorChanged' fires
// on furniture/decor writes), purchases through systems/economy.js spend.
//
// Save shape (§E3):
//   furniture.owned  string[]  ownKey()s of PURCHASED items (defaults excluded
//                              — they are free and always owned)
//   furniture.placed { 'roomId:slotId': itemId }  only non-default placements
//   decor.wallpaper  { roomId: wallpaperId }      (absent → 'cream')
//   decor.floor      { roomId: floorId }          (absent → 'wood')
//
// Pure module (§B): no three.js/DOM imports — node:test runs it headlessly.
// home/decor.js turns this saved state into the 3D home.

import {
  getEntry,
  getWallpaper,
  getFloor,
  ownKey,
  furnitureFor,
} from '../data/furniture.js';
import { ROOM as KITCHEN } from '../home/rooms/kitchen.js';
import { ROOM as LIVING } from '../home/rooms/living.js';
import { ROOM as BATHROOM } from '../home/rooms/bathroom.js';
import { ROOM as BEDROOM } from '../home/rooms/bedroom.js';
import { spend } from './economy.js';

/** @typedef {import('./economy.js').Store} Store */

/** Room slot tables (pure data — same defs the roomManager builds from). */
const ROOMS_BY_ID = Object.freeze({
  kitchen: KITCHEN,
  living: LIVING,
  bathroom: BATHROOM,
  bedroom: BEDROOM,
});

/** @param {string} roomId @param {string} slotId */
const slotKey = (roomId, slotId) => `${roomId}:${slotId}`;

/**
 * A room's slot definition ({ default, items }) or null.
 * @param {string} roomId @param {string} slotId
 */
export function slotDef(roomId, slotId) {
  return ROOMS_BY_ID[roomId]?.slots?.[slotId] ?? null;
}

/**
 * The free default item of a slot (§C5.2), or null (wallArt starts empty).
 * @param {string} roomId @param {string} slotId
 * @returns {string|null}
 */
export function slotDefault(roomId, slotId) {
  return slotDef(roomId, slotId)?.default ?? null;
}

/**
 * Does the player own a catalog entry? Free defaults (price 0) are always
 * owned; everything else must be in `furniture.owned`.
 * @param {Store} store
 * @param {import('../data/furniture.js').FurnitureEntry
 *   | import('../data/furniture.js').SurfaceEntry} entry
 * @returns {boolean}
 */
export function isOwned(store, entry) {
  if (!entry) return false;
  if (entry.default) return true;
  return (store.get('furniture.owned') ?? []).includes(ownKey(entry));
}

/** @param {Store} store @param {string} itemId furniture catalog id */
export function isFurnitureOwned(store, itemId) {
  return isOwned(store, getEntry(itemId));
}

/**
 * Placement validity (§C5.2): the item must exist in the catalog, belong to
 * this slot, be allowed in this room (shared rugs list several), and the
 * room's slot table must accept it. Pure — ignores ownership.
 * @param {string} itemId @param {string} roomId @param {string} slotId
 * @returns {boolean}
 */
export function canPlace(itemId, roomId, slotId) {
  const entry = getEntry(itemId);
  if (!entry || entry.slot !== slotId || !entry.rooms.includes(roomId)) return false;
  const def = slotDef(roomId, slotId);
  return !!def && def.items.includes(itemId);
}

/**
 * Place an owned item into a room slot; persists to `furniture.placed`.
 * Placing the slot's free default clears the override (== unplace).
 * @param {Store} store
 * @param {string} itemId @param {string} roomId @param {string} slotId
 * @returns {{ok: boolean, reason?: 'invalid'|'notOwned'}}
 */
export function place(store, itemId, roomId, slotId) {
  if (!canPlace(itemId, roomId, slotId)) return { ok: false, reason: 'invalid' };
  if (!isFurnitureOwned(store, itemId)) return { ok: false, reason: 'notOwned' };
  const key = slotKey(roomId, slotId);
  store.update((state) => {
    if (itemId === slotDefault(roomId, slotId)) delete state.furniture.placed[key];
    else state.furniture.placed[key] = itemId;
  });
  return { ok: true };
}

/**
 * Clear a slot back to its free default.
 * @param {Store} store @param {string} roomId @param {string} slotId
 */
export function unplace(store, roomId, slotId) {
  store.update((state) => {
    delete state.furniture.placed[slotKey(roomId, slotId)];
  });
}

/**
 * The item currently in a slot: the placed override, else the free default
 * (null for the empty wallArt slot).
 * @param {Store} store @param {string} roomId @param {string} slotId
 * @returns {string|null}
 */
export function placedItem(store, roomId, slotId) {
  return store.get('furniture.placed')?.[slotKey(roomId, slotId)] ?? slotDefault(roomId, slotId);
}

/**
 * Is this exact item what the slot currently shows?
 * @param {Store} store @param {string} itemId @param {string} roomId @param {string} slotId
 */
export function isPlaced(store, itemId, roomId, slotId) {
  return placedItem(store, roomId, slotId) === itemId;
}

/**
 * Rooms where an owned/placeable item is currently placed (shared rugs can
 * be in several).
 * @param {Store} store @param {string} itemId
 * @returns {string[]} roomIds
 */
export function placedRooms(store, itemId) {
  const entry = getEntry(itemId);
  if (!entry) return [];
  return entry.rooms.filter((roomId) => isPlaced(store, itemId, roomId, entry.slot));
}

/**
 * Buy a furniture catalog item (once — §C5.2): spend price, add to owned.
 * Atomic; free defaults report 'owned'.
 * @param {Store} store @param {string} itemId
 * @returns {{ok: boolean, reason?: 'unknown'|'owned'|'coins'}}
 */
export function buyFurniture(store, itemId) {
  const entry = getEntry(itemId);
  if (!entry) return { ok: false, reason: 'unknown' };
  if (isOwned(store, entry)) return { ok: false, reason: 'owned' };
  if (!spend(store, entry.price, `furniture:${itemId}`)) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.furniture.owned.push(ownKey(entry));
  });
  return { ok: true };
}

/**
 * Buy a wallpaper/floor colorway (once, then applicable to every room —
 * §C5.2 "per-room-applicable colorways").
 * @param {Store} store @param {'wallpaper'|'floor'} kind @param {string} id
 * @returns {{ok: boolean, reason?: 'unknown'|'owned'|'coins'}}
 */
export function buySurface(store, kind, id) {
  const entry = kind === 'wallpaper' ? getWallpaper(id) : getFloor(id);
  if (!entry) return { ok: false, reason: 'unknown' };
  if (isOwned(store, entry)) return { ok: false, reason: 'owned' };
  if (!spend(store, entry.price, `${kind}:${id}`)) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.furniture.owned.push(ownKey(entry));
  });
  return { ok: true };
}

/**
 * Apply an owned wallpaper/floor to one room; persists to `decor.*`
 * ('decorChanged' → home/decor.js repaints via G4's roomManager APIs).
 * @param {Store} store @param {'wallpaper'|'floor'} kind
 * @param {string} roomId @param {string} id
 * @returns {{ok: boolean, reason?: 'unknown'|'room'|'notOwned'}}
 */
export function applySurface(store, kind, roomId, id) {
  const entry = kind === 'wallpaper' ? getWallpaper(id) : getFloor(id);
  if (!entry) return { ok: false, reason: 'unknown' };
  if (!ROOMS_BY_ID[roomId]) return { ok: false, reason: 'room' };
  if (!isOwned(store, entry)) return { ok: false, reason: 'notOwned' };
  store.update((state) => {
    state.decor[kind][roomId] = id;
  });
  return { ok: true };
}

/**
 * The applied wallpaper/floor id of a room (falls back to the free default).
 * @param {Store} store @param {'wallpaper'|'floor'} kind @param {string} roomId
 * @returns {string}
 */
export function appliedSurface(store, kind, roomId) {
  return store.get(`decor.${kind}.${roomId}`) ?? (kind === 'wallpaper' ? 'cream' : 'wood');
}

/**
 * Decorate-mode data for a room slot (§C5.2 picker): catalog variants with
 * owned/placed flags, defaults first.
 * @param {Store} store @param {string} roomId @param {string} slotId
 * @returns {Array<{entry: import('../data/furniture.js').FurnitureEntry,
 *   owned: boolean, placed: boolean}>}
 */
export function slotOptions(store, roomId, slotId) {
  return furnitureFor(roomId, slotId).map((entry) => ({
    entry,
    owned: isOwned(store, entry),
    placed: isPlaced(store, entry.id, roomId, slotId),
  }));
}

/**
 * Count of placed non-default decor items (the §C8.3 'decorator' achievement
 * reads this via G12's engine).
 * @param {Store} store
 * @returns {number}
 */
export function placedNonDefaultCount(store) {
  return Object.keys(store.get('furniture.placed') ?? {}).length;
}
