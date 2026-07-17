// V2/G16: Fur-color skin catalog (PLAN2 §C8.5) — derived from the verbatim
// SKIN_TABLE in constants.js. Pure data: no three.js/DOM. Application lives
// in character/skins.js (G22, wave 2): applySkin swaps the shared BODY /
// BELLY / EAR_INNER material colors (cheeks/nose/eyes untouched); 'golden'
// additionally sets metalness 0.25. Save shape (§B2): skins.owned (string[],
// default ['cream']) + skins.equipped (default 'cream'). Purchases go through
// economy.buySkin (shop "Skins" tab from L5 — UNLOCKS.SKINS).

import { SKIN_TABLE } from './constants.js';

/**
 * @typedef {Object} SkinDef
 * @property {string} id         skin id (§C8.5)
 * @property {string} nameKey    strings.js key (`skin.<id>`)
 * @property {number} price      coins (0 = free default 'cream')
 * @property {{body: string, belly: string, earInner: string}} colors hex colors
 * @property {number} metalness  material metalness (0 except golden's 0.25)
 */

/** @type {SkinDef[]} all 7, in §C8.5 table (price-ascending) order. */
export const SKINS = Object.freeze(
  Object.entries(SKIN_TABLE).map(([id, row]) =>
    Object.freeze({
      id,
      nameKey: `skin.${id}`,
      price: row.price,
      colors: Object.freeze({ body: row.body, belly: row.belly, earInner: row.earInner }),
      metalness: row.metalness ?? 0,
    })
  )
);

/** @type {Record<string, SkinDef>} id → def lookup. */
export const SKINS_BY_ID = Object.freeze(Object.fromEntries(SKINS.map((s) => [s.id, s])));

/** The free default skin id everyone owns (§C8.5). */
export const DEFAULT_SKIN = 'cream';

/**
 * @param {string} id
 * @returns {SkinDef|undefined}
 */
export function getSkin(id) {
  return SKINS_BY_ID[id];
}
