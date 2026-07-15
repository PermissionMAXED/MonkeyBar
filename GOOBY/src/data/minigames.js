// Minigame metadata registry (§C6) — id, title key, unlock level, coin table,
// energy cost. Implementations live in src/minigames/games/*.js and are
// discovered by src/minigames/registry.js; a metadata entry without a module
// renders as "coming soon" in the arcade (§E8). Pure data: no three.js/DOM.

import { COIN_TABLE, UNLOCK_LEVELS, MINIGAME } from './constants.js';

/**
 * @typedef {Object} MinigameMeta
 * @property {string} id          game id == module filename in minigames/games/
 * @property {string} titleKey    strings.js key for the display title
 * @property {string} icon        icons.js icon name for the arcade tile
 * @property {number} minLevel    unlock level (§C6.3)
 * @property {{divisor?:number, min?:number, max:number, special?:boolean}} coinTable §C6 coin row
 * @property {number} energyCost  energy cost per play (§C6 shared rules)
 * @property {boolean} [dev]      dev-only: hidden from the arcade menu (`_smoke`)
 */

/** The 12 shipping games (§C6), in unlock order. */
export const MINIGAME_IDS = Object.freeze([
  'carrotCatch',
  'bunnyHop',
  'cityDrive',
  'carrotGuard',
  'memoryMatch',
  'basketBounce',
  'pancakeTower',
  'runner',
  'bubblePop',
  'fishingPond',
  'danceParty',
  'trampoline',
]);

const ICONS = {
  cityDrive: 'car',
  carrotCatch: 'carrot',
  bunnyHop: 'rabbit',
  carrotGuard: 'shield',
  memoryMatch: 'cards',
  runner: 'run',
  basketBounce: 'ball',
  pancakeTower: 'stack',
  danceParty: 'music',
  fishingPond: 'fish',
  bubblePop: 'bubble',
  trampoline: 'spring',
};

/** @type {MinigameMeta[]} */
export const MINIGAMES = Object.freeze([
  ...MINIGAME_IDS.map((id) =>
    Object.freeze({
      id,
      titleKey: `mg.title.${id}`,
      icon: ICONS[id],
      minLevel: UNLOCK_LEVELS[id],
      coinTable: COIN_TABLE[id],
      energyCost: id === 'cityDrive' ? MINIGAME.DRIVE_ENERGY_COST : MINIGAME.ENERGY_COST,
    })
  ),
  // Dev-only framework smoke game — hidden from the arcade, reachable via ?minigame=_smoke.
  Object.freeze({
    id: '_smoke',
    titleKey: 'mg.title._smoke',
    icon: 'sparkle',
    minLevel: 1,
    coinTable: Object.freeze({ divisor: 1, min: 0, max: 10 }),
    energyCost: MINIGAME.ENERGY_COST,
    dev: true,
  }),
]);

/** @type {Record<string, MinigameMeta>} */
export const MINIGAMES_BY_ID = Object.freeze(Object.fromEntries(MINIGAMES.map((m) => [m.id, m])));

/**
 * @param {string} id
 * @returns {MinigameMeta|undefined}
 */
export function getMinigame(id) {
  return MINIGAMES_BY_ID[id];
}

/**
 * Coin payout (§C6 shared rules): clamp(floor(score / divisor), min, max),
 * then ×2 for the first play of that game per local day (after clamp).
 * Special games (cityDrive §C4) pass their coins directly via coinsOverride —
 * the daily ×2 still applies. Pure; used by the framework reward path
 * (G11's economy.awardMinigame builds on it).
 * @param {{divisor?: number, min?: number, max: number, special?: boolean}} coinTable
 * @param {number} score
 * @param {boolean} firstToday
 * @param {number} [coinsOverride]
 * @returns {number}
 */
export function computeCoins(coinTable, score, firstToday, coinsOverride) {
  let coins;
  if (typeof coinsOverride === 'number') {
    coins = Math.max(0, Math.floor(coinsOverride));
  } else {
    coins = Math.min(
      coinTable.max,
      Math.max(coinTable.min ?? 0, Math.floor(score / (coinTable.divisor ?? 1)))
    );
  }
  if (firstToday) coins *= MINIGAME.DAILY_FIRST_PLAY_MULT;
  return coins;
}
