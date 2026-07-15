// Pure inventory ops (§B): food item add/remove/count. Inventory is a plain
// { itemId: count } object (save schema §E3). All functions are immutable —
// they return new objects and never mutate the input. No three.js/DOM imports.

/**
 * @typedef {Record<string, number>} Inventory
 */

/**
 * Count of an item.
 * @param {Inventory} inv
 * @param {string} id
 * @returns {number}
 */
export function count(inv, id) {
  return Math.max(0, Math.floor(inv?.[id] ?? 0));
}

/**
 * @param {Inventory} inv
 * @param {string} id
 * @param {number} [n] required amount (default 1)
 * @returns {boolean} true when the inventory holds at least n of the item
 */
export function has(inv, id, n = 1) {
  return count(inv, id) >= n;
}

/**
 * Add n of an item. Returns a new inventory.
 * @param {Inventory} inv
 * @param {string} id
 * @param {number} [n]
 * @returns {Inventory}
 */
export function add(inv, id, n = 1) {
  if (!Number.isFinite(n) || n <= 0) return { ...inv };
  return { ...inv, [id]: count(inv, id) + Math.floor(n) };
}

/**
 * Remove n of an item. Returns the new inventory, or null when there aren't
 * enough (caller must check — nothing is removed in that case).
 * Entries that reach 0 are deleted from the object.
 * @param {Inventory} inv
 * @param {string} id
 * @param {number} [n]
 * @returns {Inventory|null}
 */
export function remove(inv, id, n = 1) {
  if (!Number.isFinite(n) || n <= 0) return { ...inv };
  if (!has(inv, id, n)) return null;
  const next = { ...inv, [id]: count(inv, id) - Math.floor(n) };
  if (next[id] === 0) delete next[id];
  return next;
}

/**
 * Total number of items across all entries.
 * @param {Inventory} inv
 * @returns {number}
 */
export function totalCount(inv) {
  return Object.keys(inv ?? {}).reduce((sum, id) => sum + count(inv, id), 0);
}

/**
 * Stable list form for UI trays: [{id, count}] with count > 0.
 * @param {Inventory} inv
 * @returns {{id: string, count: number}[]}
 */
export function list(inv) {
  return Object.keys(inv ?? {})
    .filter((id) => count(inv, id) > 0)
    .map((id) => ({ id, count: count(inv, id) }));
}
