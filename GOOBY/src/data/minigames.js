// Minigame metadata registry (§C6) — id, title key, unlock level, coin table,
// energy cost. Implementations live in src/minigames/games/*.js and are
// discovered by src/minigames/registry.js; a metadata entry without a module
// renders as "coming soon" in the arcade (§E8). Pure data: no three.js/DOM.

import { COIN_TABLE, UNLOCK_LEVELS, UNLOCKS, MINIGAME } from './constants.js'; // V2/G16: + UNLOCKS (§B6)

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

/**
 * The 21 shipping games (§C6 + PLAN2 §C1), in unlock order (§B6 merged with
 * v1 §C6.3; v1-first within a level). V2/G16: 9 new 2.0 ids added — their
 * modules land in waves 3–4 (metadata-only entries render "coming soon",
 * §E8), their coin rows are live in COIN_TABLE (§C1.1).
 */
export const MINIGAME_IDS = Object.freeze([
  'carrotCatch', //  L1
  'bunnyHop', //     L1
  'cityDrive', //    L1
  'carrotGuard', //  L2
  'goobySays', //    L2  (2.0)
  'memoryMatch', //  L3
  'basketBounce', // L4
  'gardenRush', //   L4  (2.0)
  'pancakeTower', // L5
  'burgerBuild', //  L5  (2.0)
  'runner', //       L6
  'veggieChop', //   L6  (2.0)
  'bubblePop', //    L7
  'deliveryRush', // L7  (2.0)
  'fishingPond', //  L8
  'danceParty', //   L9
  'miniGolf', //     L9  (2.0)
  'trampoline', //   L10
  'goalieGooby', //  L11 (2.0)
  'starHopper', //   L12 (2.0)
  'pipeFlow', //     L14 (2.0)
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
  // V2/G16: 2.0 tiles reuse existing icon names (ui/icons.js is not ours this
  // wave); game agents may swap in bespoke icons with their modules.
  goobySays: 'bell',
  gardenRush: 'hygiene',
  burgerBuild: 'hunger',
  veggieChop: 'carrot',
  deliveryRush: 'cart',
  miniGolf: 'ball',
  goalieGooby: 'shield',
  starHopper: 'star',
  pipeFlow: 'gear',
};

/** V2/G16: car games cost 6 energy (§C1 shared rules — cityDrive + deliveryRush). */
const CAR_GAMES = new Set(['cityDrive', 'deliveryRush']);

/** @type {MinigameMeta[]} */
export const MINIGAMES = Object.freeze([
  ...MINIGAME_IDS.map((id) =>
    Object.freeze({
      id,
      titleKey: `mg.title.${id}`,
      icon: ICONS[id],
      // V2/G16: v1 levels stay in UNLOCK_LEVELS; 2.0 levels come from §B6.
      minLevel: UNLOCK_LEVELS[id] ?? UNLOCKS.MINIGAMES[id],
      coinTable: COIN_TABLE[id],
      energyCost: CAR_GAMES.has(id) ? MINIGAME.DRIVE_ENERGY_COST : MINIGAME.ENERGY_COST,
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
