// Outfit catalog (§C5.3, binding prices; V2/G22 grows it to 20 per PLAN2
// §C8.4) — procedurally modeled items in
// three slots (hat / glasses / neck), one item equippable per slot. The meshes
// themselves are built by character/outfitAttach.js; this catalog is the pure
// data source (id / slot / price / nameKey). No three.js/DOM imports (§B rule)
// so node:test can verify catalog integrity headlessly (test/outfits.test.js).
//
// Purchase path (§C5.3): the shop UI's "Outfits" tab (G11) opens the wardrobe
// in buy mode — buying only during shop trips; equipping owned items works
// anytime (bedroom wardrobe closet / HUD wardrobe button).

/** Equip slots (§C5.3): one item per slot, freely swappable once owned. */
export const OUTFIT_SLOTS = Object.freeze(['hat', 'glasses', 'neck']);

/**
 * @typedef {Object} OutfitItem
 * @property {string} id       catalog id == builder id in character/outfitAttach.js
 * @property {'hat'|'glasses'|'neck'} slot  Gooby anchor the item attaches to (§D2.3)
 * @property {number} price    shop price in coins (§C5.3 verbatim)
 * @property {string} nameKey  strings.js key for the display name
 */

/** @type {OutfitItem[]} in §C5.3 order (hats, glasses, neck). */
export const OUTFITS = Object.freeze(
  [
    // --- hats (§C5.3: party hat 120, beanie 100, cap 150, top hat 300, crown 1200) ---
    { id: 'partyHat', slot: 'hat', price: 120 },
    { id: 'beanie', slot: 'hat', price: 100 },
    { id: 'cap', slot: 'hat', price: 150 },
    { id: 'topHat', slot: 'hat', price: 300 },
    { id: 'crown', slot: 'hat', price: 1200 }, // endgame flex
    // --- V2/G22 hats (PLAN2 §C8.4: straw 160, chef 220, flower crown 180, wizard 350) ---
    { id: 'strawHat', slot: 'hat', price: 160 },
    { id: 'chefHat', slot: 'hat', price: 220 },
    { id: 'flowerCrown', slot: 'hat', price: 180 },
    { id: 'wizardHat', slot: 'hat', price: 350 },
    // --- glasses (round 150, sunglasses 200, star glasses 250) ---
    { id: 'roundGlasses', slot: 'glasses', price: 150 },
    { id: 'sunglasses', slot: 'glasses', price: 200 },
    { id: 'starGlasses', slot: 'glasses', price: 250 },
    // --- V2/G22 glasses (§C8.4: heart rims 220, monocle 400) ---
    { id: 'heartGlasses', slot: 'glasses', price: 220 },
    { id: 'monocle', slot: 'glasses', price: 400 },
    // --- neck (red scarf 120, bowtie 140, striped scarf 180) ---
    { id: 'scarfRed', slot: 'neck', price: 120 },
    { id: 'bowtie', slot: 'neck', price: 140 },
    { id: 'scarfStriped', slot: 'neck', price: 180 },
    // --- V2/G22 neck (§C8.4: bandana 130, bell collar 160, cape 500) ---
    { id: 'bandana', slot: 'neck', price: 130 },
    { id: 'bellCollar', slot: 'neck', price: 160 }, // bell SFX on hop
    { id: 'cape', slot: 'neck', price: 500 }, // rigid swoosh + hop flutter
  ].map((o) => Object.freeze({ ...o, nameKey: `outfit.${o.id}` }))
);

/** @type {Record<string, OutfitItem>} id → item lookup. */
export const OUTFITS_BY_ID = Object.freeze(Object.fromEntries(OUTFITS.map((o) => [o.id, o])));

/**
 * @param {string} id
 * @returns {OutfitItem|undefined}
 */
export function getOutfit(id) {
  return OUTFITS_BY_ID[id];
}

/**
 * Catalog items of one slot, in catalog order.
 * @param {'hat'|'glasses'|'neck'} slot
 * @returns {OutfitItem[]}
 */
export function outfitsForSlot(slot) {
  return OUTFITS.filter((o) => o.slot === slot);
}
