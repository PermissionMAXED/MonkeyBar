// V2/G16: Crop catalog (PLAN2 §C2.3) — derived from the verbatim CROP_TABLE in
// constants.js. Pure data: no three.js/DOM. Crop id == food id: harvest yields
// land in the food inventory (eaten stat effects come from FOOD_TABLE; the v1
// carrot/salad/watermelon rows are unchanged and also crop-harvestable).
// Stage model keys are string literals here on purpose — test/assets.test.js
// (G15) scans this file and asserts every '<pack>/<file>' key resolves to a
// committed GLB. Growth stages render at 0/33/66/100 % progress (§C2.3): the
// LAST entry of stageModels is the ready look; earlier entries spread evenly
// across the growing phase (systems/garden.js progressPct drives selection).

import { CROP_TABLE, UNLOCKS } from './constants.js';

/** §C2.3 "plot model stages" column → asset keys for core/assets.js getModel(). */
const STAGE_MODELS = {
  radish: ['nature-kit/crops_leafsStageA', 'nature-kit/crop_turnip'],
  carrot: ['nature-kit/crops_leafsStageA', 'nature-kit/crop_carrot'],
  salad: ['nature-kit/crops_leafsStageA', 'nature-kit/crops_leafsStageB'],
  tomato: ['nature-kit/crops_leafsStageA', 'nature-kit/crops_leafsStageB', 'food-kit/tomato'],
  corn: ['nature-kit/crops_cornStageA', 'nature-kit/crops_cornStageB', 'nature-kit/crops_cornStageC', 'nature-kit/crops_cornStageD'],
  eggplant: ['nature-kit/crops_leafsStageA', 'nature-kit/crops_leafsStageB', 'food-kit/eggplant'],
  pumpkin: ['nature-kit/crops_leafsStageA', 'nature-kit/crop_pumpkin'],
  watermelon: ['nature-kit/crops_leafsStageA', 'nature-kit/crop_melon'],
};

/**
 * @typedef {Object} CropDef
 * @property {string} id               catalog id == food id == seed id suffix
 * @property {string} nameKey          strings.js key (`crop.<id>`)
 * @property {string} foodId           inventory food id the harvest yields (== id)
 * @property {number} seedPrice        seed price in coins (§C2.3)
 * @property {number} growthMin        REAL minutes of watered growth to ready
 * @property {number} waterings        waterings needed to reach readiness
 * @property {number} wateredWindowMin minutes one watering keeps growth running
 * @property {number} yield            food items per harvest
 * @property {number} sellPrice        compost-bin sell price per item
 * @property {number} unlock           level gate (§B6 — mirrors UNLOCKS.CROPS)
 * @property {string[]} stageModels    growth-stage asset keys (last = ready)
 */

/** @type {CropDef[]} in §C2.3 table (= unlock) order. */
export const CROPS = Object.freeze(
  Object.entries(CROP_TABLE).map(([id, row]) =>
    Object.freeze({
      id,
      nameKey: `crop.${id}`,
      foodId: id,
      seedPrice: row.seedPrice,
      growthMin: row.growthMin,
      waterings: row.waterings,
      wateredWindowMin: row.wateredWindowMin,
      yield: row.yield,
      sellPrice: row.sellPrice,
      unlock: UNLOCKS.CROPS[id] ?? row.unlock,
      stageModels: Object.freeze(STAGE_MODELS[id] ?? []),
    })
  )
);

/** @type {Record<string, CropDef>} id → def lookup. */
export const CROPS_BY_ID = Object.freeze(Object.fromEntries(CROPS.map((c) => [c.id, c])));

/**
 * @param {string} id
 * @returns {CropDef|undefined}
 */
export function getCrop(id) {
  return CROPS_BY_ID[id];
}
