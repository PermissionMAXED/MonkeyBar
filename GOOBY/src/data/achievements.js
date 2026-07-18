// Achievement catalog (§C8.3, binding) — all 16 achievements with their
// condition spec and coin reward. Pure data: no three.js/DOM imports (§B rule)
// so node:test runs it headlessly. Condition evaluation lives in
// systems/achievementsEngine.js; this file only describes WHAT to check.
//
// Condition spec shapes:
//   { counter: '<id>', target: N }   achievements.counters[id] ≥ N (§E3 counters,
//                                    incremented by the owning care/trip systems
//                                    or achievementsEngine.track())
//   { special: '<id>', target: N }   engine-evaluated conditions:
//     'coins'      current balance ≥ N              (store 'coinsChanged')
//     'level'      level ≥ N                        (store 'levelUp')
//     'fullOutfit' N equip slots filled at once     (store 'outfitChanged')
//     'decor'      ≥ N non-default items placed     (store 'decorChanged', G11)
//     'streak'     daily-bonus streak ≥ N           (§C8.2 dailyBonus claim)
//     'play12'     N distinct games played ≥ 1      (minigames.plays map, §E3)
//
//   V2/G16 specials (PLAN2 §C5.3 — evaluation lands with G23's engine
//   extension in wave 2; the v1 engine safely treats unknown specials as
//   progress 0, so these defs are inert until then):
//     'allCrops'   all 8 crops harvested ≥ 1        (collections veggies set)
//     'stickers'   total collection entries ≥ N     (collections.entries)
//     'setsClaimed' claimed sticker sets ≥ N        (collections.claimedSets)
//     'neverSick'  level ≥ 10 with 0 sick states ever (health history)
//     'weightMax'  weight.value ≥ N reached         (store 'weightChanged')
//     'weightMin'  weight.value ≤ N reached         (store 'weightChanged')
//     'play21'     N distinct games played ≥ 1 over all 21 ids
//     'holeInOne'  miniGolf meta.holeInOnes ≥ N     (§B3 onEnd meta)
//
//   V3/G34 special (PLAN3 §B5/§C5.5):
//     'stickerCount' sticker-BOOK unlocks ≥ N      (stickers.unlocked — the
//                    §C5 book, NOT the v2 collections 'stickers' special)

/**
 * @typedef {Object} AchievementDef
 * @property {string} id        achievement id (§C8.3 table, verbatim)
 * @property {string} nameKey   strings.js key — EN/DE names per §C8.3
 * @property {string} descKey   strings.js key — short condition description
 * @property {number} coins     coin reward on unlock (§C8.3 verbatim)
 * @property {string} [counter] counters-based condition: counter id (§E3)
 * @property {string} [special] engine-evaluated condition id (see header)
 * @property {number} target    threshold the progress value must reach
 */

/** @type {AchievementDef[]} all 37: 16 v1 (§C8.3) + 17 v2 (PLAN2 §C5.3) + 4 v3 (PLAN3 §C5.5/§C6.4), in table order. */
export const ACHIEVEMENTS = Object.freeze(
  [
    { id: 'firstFeed', counter: 'feeds', target: 1, coins: 10 },
    { id: 'feed100', counter: 'feeds', target: 100, coins: 100 },
    { id: 'firstWash', counter: 'washes', target: 1, coins: 10 },
    { id: 'wash50', counter: 'washes', target: 50, coins: 80 },
    { id: 'firstSleep', counter: 'sleeps', target: 1, coins: 15 },
    { id: 'sleep20', counter: 'sleeps', target: 20, coins: 100 },
    { id: 'firstDrive', counter: 'trips', target: 1, coins: 20 },
    { id: 'drive25', counter: 'trips', target: 25, coins: 120 },
    // 1 shop trip with 0 crashes (§C8.3). The cleanTrips counter is fed by
    // achievementsEngine's shop-trip interception (initAchievements) /
    // track('cleanTrips') — cityDrive itself reports {crashes, towed}.
    { id: 'noCrash', counter: 'cleanTrips', target: 1, coins: 40 },
    { id: 'play12', special: 'play12', target: 12, coins: 150 },
    { id: 'coins1000', special: 'coins', target: 1000, coins: 50 },
    { id: 'level10', special: 'level', target: 10, coins: 100 },
    { id: 'fullOutfit', special: 'fullOutfit', target: 3, coins: 60 },
    { id: 'decorator', special: 'decor', target: 10, coins: 80 },
    { id: 'streak7', special: 'streak', target: 7, coins: 150 },
    { id: 'tickle100', counter: 'tickles', target: 100, coins: 60 },
    // V2/G16: +17 achievements (PLAN2 §C5.3 verbatim — counters land in the
    // §B2 save-schema extension; specials in G23's engine, wave 2).
    { id: 'firstHarvest', counter: 'harvests', target: 1, coins: 15 },
    { id: 'harvest50', counter: 'harvests', target: 50, coins: 100 },
    { id: 'allCrops', special: 'allCrops', target: 8, coins: 120 },
    { id: 'firstQuest', counter: 'questsDone', target: 1, coins: 10 },
    { id: 'quest50', counter: 'questsDone', target: 50, coins: 120 },
    { id: 'firstSticker', special: 'stickers', target: 1, coins: 10 },
    { id: 'setComplete', special: 'setsClaimed', target: 1, coins: 60 },
    { id: 'albumFull', special: 'setsClaimed', target: 4, coins: 300 },
    { id: 'firstCure', counter: 'cures', target: 1, coins: 20 },
    { id: 'vetVisit', counter: 'vetTrips', target: 1, coins: 20 },
    { id: 'neverSick', special: 'neverSick', target: 1, coins: 150 },
    { id: 'chonkZone', special: 'weightMax', target: 86, coins: 40 },
    { id: 'sleekMode', special: 'weightMin', target: 25, coins: 40 },
    { id: 'play21', special: 'play21', target: 21, coins: 250 },
    { id: 'delivery10', counter: 'deliveries', target: 10, coins: 80 },
    { id: 'holeInOne', special: 'holeInOne', target: 1, coins: 50 },
    { id: 'shutterbug', counter: 'photosTaken', target: 10, coins: 60 },
    // V3/G34: +4 achievements (PLAN3 §C5.5 stickerCount tiers + §C6.4
    // nougatmeister → catalog 33 → 37). 'stickerCount' counts
    // stickers.unlocked (the §C5 sticker BOOK — not the v2 collections);
    // nougatGlobs is a §B1 counter fed by G35's Nougatschleuse flow.
    { id: 'stickerBook10', special: 'stickerCount', target: 10, coins: 50 },
    { id: 'stickerBook20', special: 'stickerCount', target: 20, coins: 100 },
    { id: 'stickerBookFull', special: 'stickerCount', target: 28, coins: 300 },
    { id: 'nougatmeister', counter: 'nougatGlobs', target: 25, coins: 80 },
  ].map((a) => Object.freeze({ ...a, nameKey: `ach.${a.id}.name`, descKey: `ach.${a.id}.desc` }))
);

/** @type {Record<string, AchievementDef>} id → def lookup. */
export const ACHIEVEMENTS_BY_ID = Object.freeze(
  Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]))
);

/**
 * @param {string} id
 * @returns {AchievementDef|undefined}
 */
export function getAchievement(id) {
  return ACHIEVEMENTS_BY_ID[id];
}

/**
 * Free default decor/furniture item ids (§C5.2 "every slot has a free
 * default") — the 'decorator' achievement counts PLACED items that are NOT in
 * this set (plus non-default wallpapers/floors). Mirrors the §C5.2 catalog
 * defaults verbatim; data/furniture.js (G11) is the authoritative shop catalog.
 */
export const DECOR_DEFAULT_ITEMS = Object.freeze([
  'loungeSofa', // living sofa
  'televisionVintage', // living TV
  'rugRounded', // living rug
  'pottedPlant', // living plant
  'lampRoundFloor', // living lamp
  'bookcaseOpen', // living bookcase
  'table', // kitchen table set (chairs follow the set)
  'chair',
  'kitchenFridge', // kitchen fridge
  'kitchenCabinetUpper', // kitchen wall shelf
  'bathtub', // bathroom tub
  'rugDoormat', // bathroom rug
  'bathroomCabinet', // bathroom shelf
  'bedSingle', // bedroom bed
  'lampSquareTable', // bedroom nightstand
]);

/** Default (free) wallpaper / floor ids (§C5.2). */
export const DECOR_DEFAULT_WALLPAPER = 'cream';
export const DECOR_DEFAULT_FLOOR = 'wood';
