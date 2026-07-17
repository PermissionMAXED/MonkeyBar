// Sticker album engine (§B7/§C6) — PURE module: no three.js/DOM imports,
// unit-tested headlessly in test/collections.test.js. Catalog-injected per
// §E0.1-3: this file never imports data/collections.js — set definitions are
// passed as parameters; wave-2 wiring passes the real 4-set catalog.
//
// Sticker sources (wired in wave 2, §B7): fishingPond meta.caught (fish set),
// garden.harvest (veggies), interactions.feed (treats), drive meta.landmarks
// (landmarks). Earning is award(); per-set completion rewards are paid ONCE
// via claimSet() — reward passthrough, actual coin/furniture payout is the
// caller's job (economy + furniture.owned, §B7).
//
// All state-transforming functions are pure: they return NEW `collections`
// slices (§B2: { entries: {'<setId>.<entryId>': count ≥ 1},
// claimedSets: {'<setId>': timestampMs} }) and never mutate their input.

/**
 * @typedef {object} CollectionSetDef  one §C6 album set (data/collections.js)
 * @property {string} id       'fish'|'veggies'|'landmarks'|'treats'
 * @property {(string|{id: string})[]} entries  sticker ids (8/8/6/10)
 * @property {object} reward   completion reward passthrough (§C6 — e.g.
 *   {coins: 150, furnitureId: 'goldenWateringCan'})
 */

/**
 * The `entries` map key for a sticker (§B2: '<setId>.<entryId>').
 * @param {string} setId
 * @param {string} entryId
 * @returns {string}
 */
export function entryKey(setId, entryId) {
  return `${setId}.${entryId}`;
}

/** @param {CollectionSetDef} setDef @returns {string[]} normalized entry ids */
function entryIdsOf(setDef) {
  return (setDef?.entries ?? []).map((e) => (typeof e === 'string' ? e : e.id));
}

/**
 * Earn a sticker (§B7): increments `entries['<setId>.<entryId>']` by n.
 * `first` is true only when the sticker was never owned before — the caller
 * shows the sticker toast (+5 XP, §C5.2) exactly then.
 * @param {object} c collections slice (§B2)
 * @param {string} setId
 * @param {string} entryId
 * @param {number} [n]
 * @returns {{c: object, first: boolean}} same `c` reference when n ≤ 0
 */
export function award(c, setId, entryId, n = 1) {
  const amount = Math.floor(Number(n) || 0);
  if (!setId || !entryId || amount <= 0) return { c, first: false };
  const key = entryKey(setId, entryId);
  const prev = Math.floor(Number(c?.entries?.[key]) || 0);
  return {
    c: { ...c, entries: { ...(c?.entries ?? {}), [key]: prev + amount } },
    first: prev === 0,
  };
}

/**
 * Owned count of one sticker (album repeat badges).
 * @param {object} c collections slice
 * @param {string} setId
 * @param {string} entryId
 * @returns {number}
 */
export function countOf(c, setId, entryId) {
  return Math.floor(Number(c?.entries?.[entryKey(setId, entryId)]) || 0);
}

/**
 * Is every sticker of the set owned at least once (§B7)?
 * @param {object} c collections slice
 * @param {string} setId
 * @param {CollectionSetDef} setDef
 * @returns {boolean}
 */
export function isSetComplete(c, setId, setDef) {
  const ids = entryIdsOf(setDef);
  if (ids.length === 0) return false;
  return ids.every((entryId) => countOf(c, setId, entryId) >= 1);
}

/**
 * Album progress bar numbers: distinct stickers owned vs set size.
 * @param {object} c collections slice
 * @param {CollectionSetDef} setDef must carry its own `id`
 * @returns {{have: number, total: number}}
 */
export function setProgress(c, setDef) {
  const ids = entryIdsOf(setDef);
  const have = ids.filter((entryId) => countOf(c, setDef?.id, entryId) >= 1).length;
  return { have, total: ids.length };
}

/**
 * Claim a completed set's reward ONCE (§B7/§C6): requires the set complete
 * and not yet in `claimedSets`. Records the claim timestamp and RETURNS the
 * setDef reward verbatim — paying coins (+50 XP, §C5.2) and landing the deco
 * in furniture.owned are the caller's job (wave-2 wiring).
 * @param {object} c collections slice
 * @param {string} setId
 * @param {CollectionSetDef} setDef
 * @param {number} nowMs claim timestamp (§B2 claimedSets value)
 * @returns {{c: object, reward: object}|{ok: false}}
 */
export function claimSet(c, setId, setDef, nowMs) {
  if (c?.claimedSets?.[setId]) return { ok: false };
  if (!isSetComplete(c, setId, setDef)) return { ok: false };
  return {
    c: { ...c, claimedSets: { ...(c?.claimedSets ?? {}), [setId]: nowMs } },
    reward: setDef.reward,
  };
}
