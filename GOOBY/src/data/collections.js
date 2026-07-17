// V2/G16: Sticker-album catalog (PLAN2 §C6) — 4 sets, 32 stickers, derived
// from the verbatim COLLECTIONS table in constants.js. Pure data: no
// three.js/DOM. The engine (systems/collections.js, G18) is catalog-injected
// (§E0.1-3): pass a set def from `COLLECTION_SETS` where a `setDef` parameter
// is expected. Save shape (§B2): collections.entries['<setId>.<entryId>'] =
// count; collections.claimedSets['<setId>'] = timestampMs.
//
// How stickers are earned (wave-2+ wiring, §C6):
//   fish       fishingPond meta.caught species roll (nightEel = night band only)
//   veggies    first harvest of each crop (garden.harvest → collections.award)
//   landmarks  driving within 15 m during any city mode (meta.landmarks)
//   treats     eating each §C6-listed junk food once (feed pipeline)

import { COLLECTIONS, LEVELING } from './constants.js';

/**
 * @typedef {Object} StickerDef
 * @property {string} id        entry id (§C6, unique within its set)
 * @property {string} nameKey   strings.js key (`sticker.<setId>.<id>.name`)
 * @property {string} flavorKey strings.js key (`sticker.<setId>.<id>.flavor`)
 */

/**
 * @typedef {Object} CollectionSetDef
 * @property {string} id          set id (§C6: fish/veggies/landmarks/treats)
 * @property {string} nameKey     strings.js key (`collection.<id>.name`)
 * @property {StickerDef[]} entries 8/8/6/10 stickers (§C6)
 * @property {{coins: number, furniture: string, xp: number}} reward
 *   paid ONCE on set completion via collections.claimSet (§B7): coins +
 *   procedural deco into furniture.owned + §C5.2 set-completion XP.
 */

/** @type {CollectionSetDef[]} all 4 sets, in §C6 table order. */
export const COLLECTION_SETS = Object.freeze(
  COLLECTIONS.SETS.map((set) =>
    Object.freeze({
      id: set.id,
      nameKey: `collection.${set.id}.name`,
      entries: Object.freeze(
        set.entries.map((entryId) =>
          Object.freeze({
            id: entryId,
            nameKey: `sticker.${set.id}.${entryId}.name`,
            flavorKey: `sticker.${set.id}.${entryId}.flavor`,
          })
        )
      ),
      reward: Object.freeze({ ...set.reward, xp: LEVELING.XP_SET_COMPLETE }),
    })
  )
);

/** @type {Record<string, CollectionSetDef>} set id → def lookup. */
export const COLLECTION_SETS_BY_ID = Object.freeze(
  Object.fromEntries(COLLECTION_SETS.map((s) => [s.id, s]))
);

/**
 * @param {string} id set id
 * @returns {CollectionSetDef|undefined}
 */
export function getCollectionSet(id) {
  return COLLECTION_SETS_BY_ID[id];
}

/** Total sticker count across all sets (§A3: 32). */
export const TOTAL_STICKERS = COLLECTION_SETS.reduce((sum, s) => sum + s.entries.length, 0);
