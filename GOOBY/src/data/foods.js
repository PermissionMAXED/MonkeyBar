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
 * @property {boolean} junk        V2/G16: sugary/greasy (PLAN2 §C7) — feeds the
 *   health junkScore + weight gain (health.onEat/weight.onEat, §B5) and the
 *   'treats' sticker set (§C6); 🍬 badge in the shop/tray.
 */

/** @type {FoodItem[]} ordered by price ascending (catalog/tray order). */
export const FOODS = Object.freeze([
  ...Object.entries(FOOD_TABLE).map(([id, row]) =>
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
      junk: row.junk === true, // V2/G16 (§B3/§C7)
    })
  ),
  // ==========================================================================
  // V3/G35 (§C6.1 verbatim): Nutella — priciest treat, doubles as the
  // Nougatschleuse's fuel (§C6.4 consumes 1 jar/glob). Lives here (not in the
  // frozen constants.js FOOD_TABLE — §E0.1-2/-3 ruling: 3.0 numbers stay in
  // the owning module). Model: the food-kit honey jar re-tinted chocolate
  // brown by the asset pipeline consumer (roomManager/feed ghost use the
  // nutellaJar icon; §C6.1 material tint #5C3A21 applies where the GLB shows).
  // ==========================================================================
  Object.freeze({
    id: 'nutella',
    nameKey: 'food.nutella',
    modelKey: 'food-kit/honey', // §C6.1: the honey jar, re-tinted
    price: 45,
    deltas: Object.freeze({ hunger: 18, fun: 6, energy: 2, hygiene: -4 }),
    favorite: false,
    junk: true, // junk pipeline: junkScore +1, weight +2 on a normal feed
  }),
  // ============================================================ end V3/G35 ==
]);

/** @type {Record<string, FoodItem>} id → item lookup. */
export const FOODS_BY_ID = Object.freeze(Object.fromEntries(FOODS.map((f) => [f.id, f])));

/**
 * @param {string} id
 * @returns {FoodItem|undefined}
 */
export function getFood(id) {
  return FOODS_BY_ID[id];
}
