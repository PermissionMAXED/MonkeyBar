// V2/G16: Daily-quest pool catalog (PLAN2 §C5.1) — derived from the verbatim
// QUEST_POOL table in constants.js. Pure data: no three.js/DOM. The engine
// (systems/quests.js, G18) is catalog-injected (§E0.1-3): pass `QUEST_POOL`
// as its `pool` parameter. Event-name contract is documented on
// constants.QUEST_POOL; wave-2 wiring must use those exact strings.

import { QUEST_POOL as TABLE } from './constants.js';

/**
 * @typedef {Object} QuestDef
 * @property {string} id        pool id (§C5.1, e.g. 'q.feed3')
 * @property {string} titleKey  strings.js key (`quest.<id-without-q.>.title`)
 * @property {string} descKey   strings.js key (`quest.<id-without-q.>.desc`)
 * @property {'care'|'games'|'garden'|'economy'} category ≥2 distinct per roll (§B7)
 * @property {string} event     quest event name (contract on constants.QUEST_POOL)
 * @property {number} target    progress needed to claim
 * @property {number} coins     claim reward coins (§C5.1)
 * @property {number} xp        claim reward XP (§C5.1)
 * @property {{minigame?: string, garden?: boolean}|null} requires roll filter (§B7)
 */

/** @type {QuestDef[]} all 28, in §C5.1 table order. */
export const QUEST_POOL = Object.freeze(
  TABLE.map((row) =>
    Object.freeze({
      ...row,
      titleKey: `quest.${row.id.slice(2)}.title`,
      descKey: `quest.${row.id.slice(2)}.desc`,
    })
  )
);

/** @type {Record<string, QuestDef>} id → def lookup. */
export const QUEST_POOL_BY_ID = Object.freeze(
  Object.fromEntries(QUEST_POOL.map((q) => [q.id, q]))
);

/**
 * @param {string} id
 * @returns {QuestDef|undefined}
 */
export function getQuest(id) {
  return QUEST_POOL_BY_ID[id];
}
