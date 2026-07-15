// Food catalog (§C5.1) — derived from the verbatim FOOD_TABLE in constants.js.
// Pure data: no three.js/DOM. GLB models come from Kenney food-kit (agent G2).

import { FOOD_TABLE } from './constants.js';

/**
 * @typedef {Object} FoodItem
 * @property {string} id           catalog id == Kenney food-kit GLB name
 * @property {string} nameKey      strings.js key for the display name
 * @property {string} modelKey     asset key for core/assets.js getModel()
 * @property {number} price        shop price in coins
 * @property {{hunger:number, fun:number, energy:number, hygiene:number}} deltas stat changes when eaten
 * @property {boolean} favorite    Gooby's favorite → extra happy squeak (§C5.1 carrot)
 */

/** @type {FoodItem[]} ordered by price ascending (catalog/tray order). */
export const FOODS = Object.freeze(
  Object.entries(FOOD_TABLE).map(([id, row]) =>
    Object.freeze({
      id,
      nameKey: `food.${id}`,
      modelKey: `food-kit/${id}`,
      price: row.price,
      deltas: Object.freeze({
        hunger: row.hunger ?? 0,
        fun: row.fun ?? 0,
        energy: row.energy ?? 0,
        hygiene: row.hygiene ?? 0,
      }),
      favorite: row.favorite === true,
    })
  )
);

/** @type {Record<string, FoodItem>} id → item lookup. */
export const FOODS_BY_ID = Object.freeze(Object.fromEntries(FOODS.map((f) => [f.id, f])));

/**
 * @param {string} id
 * @returns {FoodItem|undefined}
 */
export function getFood(id) {
  return FOODS_BY_ID[id];
}
