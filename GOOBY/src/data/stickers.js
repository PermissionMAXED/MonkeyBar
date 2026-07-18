// Gooby sticker-book catalog (PLAN3 §C5.1, binding — agent V3/G34). The 28
// ids are FROZEN in table order; art PNGs are committed 1:1 at
// public/assets/stickers/<id>.png (512×512, ≤ 150 KB — §C5.2/§D6, verified by
// test/stickers.test.js). Pure data: no three.js/DOM imports (§B rule).
// Condition evaluation lives in systems/stickerBook.js; this file only
// describes WHAT to check.
//
// Condition spec shapes (§B5 — reuse the achievements shapes + one new):
//   { counter: '<id>', target: N }   achievements.counters[id] ≥ N
//   { special: '<id>', target: N }   engine-evaluated conditions:
//     'level'            level ≥ N
//     'fullOutfit'       N of the 3 ORIGINAL equip slots filled at once
//                        (hat/glasses/neck — §C13.3: back not required)
//     'weightMax'        weight.value ≥ N reached (latched on unlock)
//     'setsClaimed'      v2 collection sets claimed ≥ N
//     'skinsOwned'       skins.owned.length ≥ N (first purchase = 2: cream+1)
//     'gameBest'         minigames.best[def.game] ≥ N (extra field `game`)
//     'collectionEntry'  collections.entries['<set>.<entry>'] ≥ N
//                        (extra fields `set`/`entry`)
//   { event: '<hookId>' }            one-shot §C5.4 runtime hooks, delivered
//                        via store.emit('stickerHook', {id: '<hookId>'})
//                        (§E0.1-7 — G35 fires grumpyWake/rainCanopy/
//                        nightStars/towed at their sources)

/**
 * @typedef {Object} StickerDef
 * @property {string} id        sticker id (§C5.1 table, verbatim)
 * @property {string} nameKey   strings key — EN/DE title per §C5.1
 * @property {string} flavorKey strings key — EN/DE flavor line per §C5.1
 * @property {string} hintKey   strings key — non-spoiler unlock hint (§C5.3)
 * @property {string} art       committed PNG path (§B5: 'assets/stickers/<id>.png')
 * @property {{counter?: string, special?: string, event?: string,
 *   target?: number, game?: string, set?: string, entry?: string}} cond
 */

/** @type {StickerDef[]} all 28, §C5.1 table order (pages 6/6/6/6/4 — §C5.3). */
export const STICKERS = Object.freeze(
  [
    { id: 'firstNom', cond: { counter: 'feeds', target: 1 } },
    { id: 'squeakyClean', cond: { counter: 'washes', target: 1 } },
    { id: 'ballBuddy', cond: { counter: 'balls', target: 10 } },
    { id: 'sleepyhead', cond: { counter: 'sleeps', target: 1 } },
    { id: 'tenNights', cond: { counter: 'sleeps', target: 10 } },
    // §C5.4 hook: sleepFlow early-wake (grumpy) path
    { id: 'grumpMorning', cond: { event: 'grumpyWake' } },
    // health.state → 'sick' first time: the achievementsEngine wiring latches
    // counters.sickEver on every healthy/queasy → sick transition (§C5.1
    // "existing counters" ruling — no new hook needed)
    { id: 'feverFace', cond: { counter: 'sickEver', target: 1 } },
    { id: 'drGooby', cond: { counter: 'vetTrips', target: 1 } },
    { id: 'firstSprout', cond: { counter: 'harvests', target: 1 } },
    // §C5.4 hooks: roomManager garden-enter while weather=rain / band=night
    { id: 'rainyDay', cond: { event: 'rainCanopy' } },
    { id: 'starGazer', cond: { event: 'nightStars' } },
    { id: 'sayCheese', cond: { counter: 'photosTaken', target: 1 } },
    { id: 'bigTen', cond: { special: 'level', target: 10 } },
    { id: 'quarterClub', cond: { special: 'level', target: 25 } },
    { id: 'maxLevel', cond: { special: 'level', target: 40 } },
    { id: 'roadTripper', cond: { counter: 'trips', target: 1 } },
    // §C5.4 hook: shopTrip tow cutscene (3 crashes) first time
    { id: 'towTrouble', cond: { event: 'towed' } },
    // fishingPond golden catch: the fish pipeline already awards the v2
    // collection entry 'fish.goldenFish' on catch (framework meta.caught)
    { id: 'goldenCatch', cond: { special: 'collectionEntry', set: 'fish', entry: 'goldenFish', target: 1 } },
    { id: 'discoGooby', cond: { special: 'gameBest', game: 'danceParty', target: 100 } },
    // framework forwards miniGolf meta.holeInOnes into the counter (V2/G23)
    { id: 'holeInOneHero', cond: { counter: 'holeInOnes', target: 1 } },
    { id: 'parcelPro', cond: { counter: 'deliveries', target: 10 } },
    // first skin purchased: owned starts ['cream'] → length 2 after one buy
    { id: 'freshDrip', cond: { special: 'skinsOwned', target: 2 } },
    { id: 'fullFit', cond: { special: 'fullOutfit', target: 3 } },
    { id: 'maxFloof', cond: { special: 'weightMax', target: 86 } },
    { id: 'nutellaGlob', cond: { counter: 'nougatGlobs', target: 1 } },
    // purblePlace meta.perfectCakes → counters.perfectCakes (§B1 counter)
    { id: 'cakeBoss', cond: { counter: 'perfectCakes', target: 1 } },
    // shoppingSurf run completed (BOTH modes bump surfRuns — §C8.6)
    { id: 'surfStar', cond: { counter: 'surfRuns', target: 1 } },
    { id: 'albumMaster', cond: { special: 'setsClaimed', target: 4 } },
  ].map((s) =>
    Object.freeze({
      ...s,
      cond: Object.freeze(s.cond),
      nameKey: `stickerbook.${s.id}.name`,
      flavorKey: `stickerbook.${s.id}.flavor`,
      hintKey: `stickerbook.${s.id}.hint`,
      art: `assets/stickers/${s.id}.png`,
    })
  )
);

/** @type {Record<string, StickerDef>} id → def lookup. */
export const STICKERS_BY_ID = Object.freeze(
  Object.fromEntries(STICKERS.map((s) => [s.id, s]))
);

/**
 * @param {string} id
 * @returns {StickerDef|undefined}
 */
export function getSticker(id) {
  return STICKERS_BY_ID[id];
}

/** Total book stickers (§C5: 28 — header shows n/28). */
export const TOTAL_BOOK_STICKERS = STICKERS.length;

/** §C5.3 page layout: 5 pages of 6/6/6/6/4 slots (2×3 grid per page). */
export const STICKER_PAGE_SIZES = Object.freeze([6, 6, 6, 6, 4]);

/**
 * The catalog split into the §C5.3 pages (table order).
 * @returns {StickerDef[][]} 5 arrays of 6/6/6/6/4 defs
 */
export function stickerPages() {
  const pages = [];
  let at = 0;
  for (const size of STICKER_PAGE_SIZES) {
    pages.push(STICKERS.slice(at, at + size));
    at += size;
  }
  return pages;
}
