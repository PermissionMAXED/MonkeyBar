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

// ============================================================================
// V4/G79 (PLAN4-GAMES §G9.3): Tiny Treats bakery foods. `croissant` already
// exists in the frozen v2 FOOD_TABLE, so its unique catalog row is upgraded
// here instead of creating a duplicate id/card; the two genuinely new ids are
// appended below. This keeps existing croissant inventory save-compatible.
// ============================================================================
export const V4_BAKERY_FOODS = Object.freeze([
  Object.freeze({
    id: 'croissant',
    nameKey: 'food.croissant',
    modelKey: 'baked-goods/croissant',
    price: 12,
    deltas: Object.freeze({ hunger: 14, fun: 4, energy: 2, hygiene: -1 }),
    favorite: false,
    junk: false,
  }),
  Object.freeze({
    id: 'cupcakePink',
    nameKey: 'food.cupcakePink',
    modelKey: 'baked-goods/cupcake',
    price: 14,
    deltas: Object.freeze({ hunger: 10, fun: 10, energy: 2, hygiene: -2 }),
    favorite: false,
    junk: true,
  }),
  Object.freeze({
    id: 'cinnamonRoll',
    nameKey: 'food.cinnamonRoll',
    modelKey: 'baked-goods/cinnamon-roll',
    price: 16,
    deltas: Object.freeze({ hunger: 16, fun: 8, energy: 3, hygiene: -2 }),
    favorite: false,
    junk: true,
  }),
]);

const V4_BAKERY_BY_ID = Object.freeze(
  Object.fromEntries(V4_BAKERY_FOODS.map((food) => [food.id, food]))
);
// ============================================================ end V4/G79 ==

/** @type {FoodItem[]} ordered by price ascending (catalog/tray order). */
export const FOODS = Object.freeze([
  ...Object.entries(FOOD_TABLE).map(([id, row]) =>
    V4_BAKERY_BY_ID[id] ??
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
  // V4/G79: croissant is already represented by its upgraded v2-id row above.
  ...V4_BAKERY_FOODS.filter((food) => !(food.id in FOOD_TABLE)),
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

/**
 * V4/G79 (§G9.2): compact tray/shop values — only hunger and fun, only when
 * non-zero, in stable icon order (energy/hygiene intentionally stay hidden).
 * @param {FoodItem} food
 * @returns {readonly (readonly ['hunger'|'fun', number])[]}
 */
export function visibleFoodValues(food) {
  return Object.freeze(
    /** @type {Array<readonly ['hunger'|'fun', number]>} */ (
      [
        ['hunger', food?.deltas?.hunger ?? 0],
        ['fun', food?.deltas?.fun ?? 0],
      ]
        .filter(([, value]) => value !== 0)
        .map(([stat, value]) => Object.freeze([stat, value]))
    )
  );
}
