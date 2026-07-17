// Day/night engine (§B4/§C10) — PURE module: no three.js/DOM imports so
// node:test runs it headlessly. Real device-clock bands: the band is a pure
// function of the LOCAL wall-clock time of the given epoch ms (DST-agnostic —
// only the local hour/minute matter, never the date or UTC offset).
//
// Wave-2/3 consumers (timeEngine ambience ticker → roomManager.setAmbience,
// gfx/lights.applyAmbience) call bandAt(clock.now()) and lerp the
// constants.DAYNIGHT light/sky params using the returned blend. This module
// owns ONLY the band math; the light parameter table lives in
// constants.DAYNIGHT (§C10.2, G16).

/**
 * Binding §B4 band table (device-local hours; `night` wraps midnight).
 * Order is the daily cycle: night → dawn → day → dusk → night.
 * @type {ReadonlyArray<{id:'night'|'dawn'|'day'|'dusk', from:number, to:number}>}
 */
export const BANDS = Object.freeze([
  Object.freeze({ id: 'night', from: 21, to: 6 }),
  Object.freeze({ id: 'dawn', from: 6, to: 8 }),
  Object.freeze({ id: 'day', from: 8, to: 18 }),
  Object.freeze({ id: 'dusk', from: 18, to: 21 }),
]);

/** Crossfade window at the START of each band (§C10.1: 30 min). */
export const BLEND_MIN = 30;

const MINUTES_PER_DAY = 24 * 60;

/**
 * Minutes a band lasts (handles the midnight wrap of `night`).
 * @param {{from:number, to:number}} band
 * @returns {number} whole minutes
 */
function bandLengthMin(band) {
  return (((band.to - band.from + 24) % 24) || 24) * 60;
}

/**
 * @typedef {Object} BandInfo
 * @property {'night'|'dawn'|'day'|'dusk'} band  active band id
 * @property {number} tInBand   normalized progress through the band, 0 (start)
 *   … <1 (end) — e.g. 13:00 is 0.5 through the 08–18 `day` band
 * @property {{from:string, to:string, t:number}|null} blend  crossfade info
 *   during the FIRST 30 min of a band (§C10.1): `from` = previous band id,
 *   `to` = current band id, `t` = 0…<1 progress through the 30-min fade.
 *   `null` outside the crossfade window.
 */

/**
 * Which day/night band a timestamp falls in (§B4). Pure function of the
 * LOCAL wall-clock time of `ms` (via `new Date(ms)` local getters) — two
 * timestamps with the same local hh:mm:ss.mmm always map identically,
 * regardless of date or DST.
 * @param {number} ms epoch milliseconds (callers pass clock.now())
 * @returns {BandInfo}
 */
export function bandAt(ms) {
  const d = new Date(ms);
  const minuteOfDay =
    d.getHours() * 60 + d.getMinutes() + (d.getSeconds() + d.getMilliseconds() / 1000) / 60;

  for (let i = 0; i < BANDS.length; i++) {
    const band = BANDS[i];
    const startMin = band.from * 60;
    // Minutes since this band began (wraps midnight for `night`).
    const inBand = (minuteOfDay - startMin + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const lengthMin = bandLengthMin(band);
    if (inBand >= lengthMin) continue;

    const prev = BANDS[(i - 1 + BANDS.length) % BANDS.length];
    const blend =
      inBand < BLEND_MIN ? { from: prev.id, to: band.id, t: inBand / BLEND_MIN } : null;
    return { band: band.id, tInBand: inBand / lengthMin, blend };
  }
  // Unreachable: BANDS covers all 1440 minutes (locked by tests).
  return { band: 'day', tInBand: 0, blend: null };
}
