// Profile lifetime-stats accumulator (§C12.1) — PURE module: no three.js/DOM
// imports, unit-tested headlessly in test/profileStats.test.js. Operates on
// the §B2 `profile` save slice:
//   profile = { playtimeMin, coinsEarned, coinsSpent, distanceM, photos }
//
// Feeding sites (wave-2 wiring, §B3): the 1 s timeEngine tick calls
// tickPlaytime (fractional minutes accumulate; the profile screen renders
// h:mm with 1-min granularity — no idle-detection cleverness, §C12.1);
// economy.js calls onCoins on EVERY award/spend; drive modes feed onDistance;
// photoMode feeds onPhoto. Per-activity totals (feeds, washes, harvests, …)
// live in achievements.counters, not here.
//
// All functions are pure on the profile slice: they return a NEW slice and
// never mutate the input; invalid/no-op inputs return the SAME reference.

/**
 * @typedef {object} ProfileSlice  the §B2 `profile` save slice
 * @property {number} playtimeMin  accumulated play minutes (fractional)
 * @property {number} coinsEarned  lifetime coins earned (all sources)
 * @property {number} coinsSpent   lifetime coins spent (all sinks)
 * @property {number} distanceM    lifetime metres driven (drive modes)
 * @property {number} photos       photo-mode captures
 */

/** @param {*} v @returns {number} finite non-negative number (else 0) */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Accumulate playtime (§C12.1) — called from the 1 s tick with dtMin ≈ 1/60.
 * @param {ProfileSlice} p
 * @param {number} dtMin elapsed minutes (fractional ok)
 * @returns {ProfileSlice} new slice (same reference when dtMin ≤ 0/invalid)
 */
export function tickPlaytime(p, dtMin) {
  const dt = num(dtMin);
  if (dt === 0) return p;
  return { ...p, playtimeMin: num(p?.playtimeMin) + dt };
}

/**
 * Record coin movement (§C12.1) — economy.js calls this on every award/spend
 * so `coinsEarned`/`coinsSpent` stay lifetime-accurate (§B3).
 * @param {ProfileSlice} p
 * @param {{earned?: number, spent?: number}} delta non-negative amounts
 * @returns {ProfileSlice} new slice (same reference on a zero delta)
 */
export function onCoins(p, delta) {
  const earned = num(delta?.earned);
  const spent = num(delta?.spent);
  if (earned === 0 && spent === 0) return p;
  return {
    ...p,
    coinsEarned: num(p?.coinsEarned) + earned,
    coinsSpent: num(p?.coinsSpent) + spent,
  };
}

/**
 * Record driven distance (§C12.1 "distance driven") — fed by cityDrive /
 * deliveryRush / vet trips.
 * @param {ProfileSlice} p
 * @param {number} meters
 * @returns {ProfileSlice} new slice (same reference when meters ≤ 0/invalid)
 */
export function onDistance(p, meters) {
  const m = num(meters);
  if (m === 0) return p;
  return { ...p, distanceM: num(p?.distanceM) + m };
}

/**
 * Record a photo-mode capture (§C12.2) — the XP grant (+1, max 5/day) and the
 * `photosTaken` achievements counter are the caller's job.
 * @param {ProfileSlice} p
 * @returns {ProfileSlice} new slice
 */
export function onPhoto(p) {
  return { ...p, photos: num(p?.photos) + 1 };
}
