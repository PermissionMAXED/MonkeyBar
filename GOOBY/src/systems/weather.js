// Weather engine (§B4/§C11) — PURE module: no three.js/DOM imports so
// node:test runs it headlessly. Deterministic shared weather: local time is
// split into four 6-hour blocks (00–06, 06–12, 12–18, 18–24) and each block's
// state is a pure hash of `<localDay>:<blockIdx>` — same weather for every
// player on the same local date+block (§C11.1), zero storage.
//
// The hash recipe below is COMMITTED API (§B4): fixed-vector tests lock it so
// the mapping never drifts between devices/builds. systems/quests.js (G18)
// duplicates the same xmur3 recipe locally rather than importing it here.
//
// Rain side effects (garden auto-watering) are `garden.applyRain(...)`'s job
// (G18/G20 wiring) — callers pass `weatherAt(ms).start/end` for a rain block.

/**
 * Binding §B4/§C11.1 weather numbers. Cumulative pick thresholds on the
 * hash32 roll: `< CLEAR → 'clear'`, `< CLEAR+CLOUDY → 'cloudy'`, else 'rain'
 * (55% / 25% / 20%).
 */
export const WEATHER = Object.freeze({
  /** Block length (§B4: 6-hour local blocks). */
  BLOCK_HOURS: 6,
  /** Blocks per local day (00–06, 06–12, 12–18, 18–24). */
  BLOCKS_PER_DAY: 4,
  /** P(clear) = 0.55 (§C11.1). */
  P_CLEAR: 0.55,
  /** P(cloudy) = 0.25 → cumulative threshold 0.80 (§C11.1). */
  P_CLOUDY: 0.25,
  /** P(rain) = 0.20 (remainder, §C11.1). */
  P_RAIN: 0.2,
  /** All weather states. */
  STATES: Object.freeze(['clear', 'cloudy', 'rain']),
});

/**
 * xmur3-style string hash → [0, 1) (§B4). Committed recipe, locked by
 * fixed-vector tests: xmur3 mixing over the chars, one finalization round,
 * uint32 result divided by 2^32.
 * @param {string} str
 * @returns {number} deterministic value in [0, 1)
 */
export function hash32(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^= h >>> 16) >>> 0) / 4294967296;
}

/**
 * Local calendar day string (YYYY-MM-DD) — same format as core/clock.js
 * localDay(); duplicated here so this engine stays dependency-free.
 * @param {Date} d
 * @returns {string}
 */
function dayStrOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @typedef {Object} WeatherBlock
 * @property {string} dayStr    local YYYY-MM-DD of the block's day
 * @property {0|1|2|3} blockIdx 0 = 00–06, 1 = 06–12, 2 = 12–18, 3 = 18–24
 * @property {number} start     epoch ms of the block start (local)
 * @property {number} end       epoch ms of the block end (local; == next block's start)
 */

/**
 * The 6-hour local block a timestamp falls in (§B4). Block boundaries are
 * true local wall-clock hours (built via the local Date constructor).
 * @param {number} ms epoch milliseconds
 * @returns {WeatherBlock}
 */
export function blockOf(ms) {
  const d = new Date(ms);
  const blockIdx = /** @type {0|1|2|3} */ (Math.floor(d.getHours() / WEATHER.BLOCK_HOURS));
  const y = d.getFullYear();
  const mo = d.getMonth();
  const day = d.getDate();
  return {
    dayStr: dayStrOf(d),
    blockIdx,
    start: new Date(y, mo, day, blockIdx * WEATHER.BLOCK_HOURS).getTime(),
    end: new Date(y, mo, day, (blockIdx + 1) * WEATHER.BLOCK_HOURS).getTime(),
  };
}

/**
 * Weather state for a `<dayStr>:<blockIdx>` key (§B4 pick):
 * roll < 0.55 → 'clear', < 0.80 → 'cloudy', else 'rain'.
 * @param {string} dayStr local YYYY-MM-DD
 * @param {number} blockIdx 0–3
 * @returns {'clear'|'cloudy'|'rain'}
 */
export function stateFor(dayStr, blockIdx) {
  const roll = hash32(`${dayStr}:${blockIdx}`);
  if (roll < WEATHER.P_CLEAR) return 'clear';
  if (roll < WEATHER.P_CLEAR + WEATHER.P_CLOUDY) return 'cloudy';
  return 'rain';
}

/**
 * @typedef {Object} WeatherInfo
 * @property {'clear'|'cloudy'|'rain'} state
 * @property {number} start epoch ms the state began (block start)
 * @property {number} end   epoch ms the state ends (block end)
 */

/**
 * Deterministic weather at a timestamp (§B4/§C11.1).
 * @param {number} ms epoch milliseconds (callers pass clock.now())
 * @returns {WeatherInfo}
 */
export function weatherAt(ms) {
  const block = blockOf(ms);
  return { state: stateFor(block.dayStr, block.blockIdx), start: block.start, end: block.end };
}

/**
 * Current + next block's weather for the garden HUD forecast chip (§C11.3).
 * The next block may roll over to the next local day (18–24 → 00–06).
 * @param {number} ms epoch milliseconds
 * @returns {[WeatherInfo, WeatherInfo]}
 */
export function forecast(ms) {
  const current = weatherAt(ms);
  return [current, weatherAt(current.end)];
}
