// Outfit catalog (§C5.3, binding prices; V2/G22 grows it to 20 per PLAN2
// §C8.4; V3/G40 grows it to 42 per PLAN3 §C13) — modeled items in
// four slots (hat / glasses / neck / back), one item equippable per slot. The meshes
// themselves are built by character/outfitAttach.js; this catalog is the pure
// data source (id / slot / price / nameKey). No three.js/DOM imports (§B rule)
// so node:test can verify catalog integrity headlessly (test/outfits.test.js).
//
// Purchase path (§C5.3): the shop UI's "Outfits" tab (G11) opens the wardrobe
// in buy mode — buying only during shop trips; equipping owned items works
// anytime (bedroom wardrobe closet / HUD wardrobe button).

/**
 * The three ORIGINAL slots. Kept as the legacy `OUTFIT_SLOTS` API because
 * achievementsEngine's `fullOutfit` condition intentionally consumes it:
 * §C13.3 says Full Fit must not start accepting back in place of neckwear.
 */
export const OUTFIT_SLOTS = Object.freeze(['hat', 'glasses', 'neck']);

/** All equippable 3.0 slots, including the new §C13 `back` slot. */
export const OUTFIT_EQUIP_SLOTS = Object.freeze([...OUTFIT_SLOTS, 'back']);

/**
 * @typedef {Object} OutfitItem
 * @property {string} id       catalog id == builder id in character/outfitAttach.js
 * @property {'hat'|'glasses'|'neck'|'back'} slot  Gooby anchor the item attaches to (§D2.3/§C13)
 * @property {number} price    shop price in coins (§C5.3 verbatim)
 * @property {number} minLevel minimum purchase level (optional in source rows; defaults to 1)
 * @property {string} nameKey  strings.js key for the display name
 */

/** @type {OutfitItem[]} in §C5.3/§C13 order (hats, glasses, neck, back). */
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
    // --- V3/G40 hats (PLAN3 §C13.2 verbatim) ---
    { id: 'sombrero', slot: 'hat', price: 260, minLevel: 6 },
    { id: 'pirateHat', slot: 'hat', price: 320, minLevel: 12 },
    { id: 'detectiveHat', slot: 'hat', price: 280, minLevel: 10 },
    { id: 'beret', slot: 'hat', price: 180, minLevel: 4 },
    { id: 'vikingHelm', slot: 'hat', price: 380, minLevel: 15 },
    { id: 'pumpkinHat', slot: 'hat', price: 240, minLevel: 8 },
    { id: 'spaceHelm', slot: 'hat', price: 420, minLevel: 18 },
    { id: 'chefToque', slot: 'hat', price: 300, minLevel: 6 },
    // --- glasses (round 150, sunglasses 200, star glasses 250) ---
    { id: 'roundGlasses', slot: 'glasses', price: 150 },
    { id: 'sunglasses', slot: 'glasses', price: 200 },
    { id: 'starGlasses', slot: 'glasses', price: 250 },
    // --- V2/G22 glasses (§C8.4: heart rims 220, monocle 400) ---
    { id: 'heartGlasses', slot: 'glasses', price: 220 },
    { id: 'monocle', slot: 'glasses', price: 400 },
    // --- V3/G40 glasses (PLAN3 §C13.2 verbatim) ---
    { id: 'aviatorGoggles', slot: 'glasses', price: 260, minLevel: 9 },
    { id: 'readingGlasses', slot: 'glasses', price: 170, minLevel: 3 },
    { id: 'eyepatch', slot: 'glasses', price: 190, minLevel: 12 },
    { id: 'stars3D', slot: 'glasses', price: 310, minLevel: 14 },
    // --- neck (red scarf 120, bowtie 140, striped scarf 180) ---
    { id: 'scarfRed', slot: 'neck', price: 120 },
    { id: 'bowtie', slot: 'neck', price: 140 },
    { id: 'scarfStriped', slot: 'neck', price: 180 },
    // --- V2/G22 neck (§C8.4: bandana 130, bell collar 160, cape 500) ---
    { id: 'bandana', slot: 'neck', price: 130 },
    { id: 'bellCollar', slot: 'neck', price: 160 }, // bell SFX on hop
    { id: 'cape', slot: 'neck', price: 500 }, // rigid swoosh + hop flutter
    // --- V3/G40 neck (PLAN3 §C13.2 verbatim) ---
    { id: 'pearlNecklace', slot: 'neck', price: 350, minLevel: 13 },
    { id: 'flowerLei', slot: 'neck', price: 220, minLevel: 7 },
    { id: 'medalGold', slot: 'neck', price: 400, minLevel: 16 },
    { id: 'winterScarf', slot: 'neck', price: 200, minLevel: 5 },
    // --- V3/G40 NEW back slot (PLAN3 §C13.2 verbatim) ---
    { id: 'backpackTiny', slot: 'back', price: 280, minLevel: 6 },
    { id: 'balloonRed', slot: 'back', price: 240, minLevel: 4 },
    { id: 'propellerPack', slot: 'back', price: 450, minLevel: 17 },
    { id: 'turtleShell', slot: 'back', price: 320, minLevel: 11 },
    { id: 'fairyWings', slot: 'back', price: 500, minLevel: 20 },
    { id: 'surfBoard', slot: 'back', price: 380, minLevel: 14 },
  ].map((o) => Object.freeze({
    ...o,
    minLevel: o.minLevel ?? 1,
    nameKey: `outfit.${o.id}`,
  }))
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
 * @param {'hat'|'glasses'|'neck'|'back'} slot
 * @returns {OutfitItem[]}
 */
export function outfitsForSlot(slot) {
  return OUTFITS.filter((o) => o.slot === slot);
}
