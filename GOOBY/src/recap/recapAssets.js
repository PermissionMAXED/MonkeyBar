// V4/G63 — Recap vignette preload lists (PLAN4 §B5.4 + §C-SYS2.3) — PURE
// data: no three.js/DOM imports, node-tested in test/recapVignettes.test.js
// (every key below is asserted to resolve to a committed file via
// core/assets.getModelUrl). The cinematic player (G64) passes
// RECAP_ASSET_KEYS to sceneManager.register / assets.preload; the per-biome
// split exists so a memory-tight consumer can warm only the next vignette.
//
// §C-SYS2.3 kit dressing (existing committed kits ONLY — no new 3D assets):
//   meadow      nature-kit trees/flowers/rocks + garden fence
//   city        kaykit-city blocks + city-kit-roads/commercial + car-kit sedan
//   harbor      watercraft-kit boats + crates + pier planks (planks procedural)
//   space       space-kit speeder + meteors (+ procedural starfield points)
//   spookGarden kaykit-halloween graves/pumpkins/fence (+ procedural fog plane)
//   bakery      kaykit-restaurant counters/oven + tiny-treats bakery-interior/
//               baked-goods props (committed by G50 — no fallback needed)
//   nightSky    fully procedural (backdrop + star points + cloud puffs)
//   toyRoom     toy-car-kit track + car-kit toy karts + furniture-kit props
//
// 'kaykit-halloween/pumpkin_orange_small' doubles as the one GLB outfit item
// (outfitAttach.OUTFIT_ASSET_KEYS) — preloading it here keeps the player's
// equipped pumpkin hat placeholder-free in every vignette.

/** AI backdrop files (ART-GATE-2, public/assets/recap/) keyed by biome id. */
export const RECAP_BACKDROP_FILES = Object.freeze({
  meadow: 'recap_meadow.png',
  city: 'recap_city.png',
  harbor: 'recap_harbor.png',
  space: 'recap_space.png',
  spookGarden: 'recap_spooky.png',
  bakery: 'recap_bakery.png',
  nightSky: 'recap_night.png',
  toyRoom: 'recap_toyroom.png',
});

/**
 * URL of a biome's AI backdrop PNG (Vite BASE_URL-aware, mirrors
 * core/assets.getModelUrl's base handling).
 * @param {string} id biome id (VIGNETTE_IDS)
 * @returns {string|null} URL, or null for unknown ids
 */
export function recapBackdropUrl(id) {
  const f = RECAP_BACKDROP_FILES[id];
  if (!f) return null;
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base}assets/recap/${f}`;
}

/**
 * GLB/GLTF asset keys per biome ('<slug>/<file-no-ext>', core/assets format).
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const RECAP_ASSET_KEYS_BY_BIOME = Object.freeze({
  meadow: Object.freeze([
    'nature-kit/tree_oak',
    'nature-kit/tree_default',
    'nature-kit/tree_fat',
    'nature-kit/flower_redA',
    'nature-kit/flower_purpleA',
    'nature-kit/flower_yellowA',
    'nature-kit/grass_large',
    'nature-kit/plant_bush',
    'nature-kit/rock_smallA',
    'nature-kit/rock_largeA',
    'nature-kit/fence_simple',
    'nature-kit/fence_gate',
    'nature-kit/mushroom_red',
  ]),
  city: Object.freeze([
    'kaykit-city/building_A_withoutBase',
    'kaykit-city/building_B_withoutBase',
    'kaykit-city/building_C_withoutBase',
    'kaykit-city/building_D_withoutBase',
    'kaykit-city/building_E_withoutBase',
    'kaykit-city/building_F_withoutBase',
    'kaykit-city/streetlight',
    'kaykit-city/bench',
    'kaykit-city/bush',
    'kaykit-city/box_A',
    'city-kit-roads/road-straight',
    'city-kit-commercial/low-detail-building-a',
    'city-kit-commercial/low-detail-building-b',
    'city-kit-commercial/low-detail-building-c',
    'car-kit/sedan',
    'car-kit/wheel-default',
  ]),
  harbor: Object.freeze([
    'watercraft-kit/boat-fishing-small',
    'watercraft-kit/boat-sail-a',
    'watercraft-kit/buoy',
    'watercraft-kit/buoy-flag',
    'kaykit-restaurant/crate',
    'nature-kit/rock_largeA',
  ]),
  space: Object.freeze([
    'space-kit/craft_speederA',
    'space-kit/meteor',
    'space-kit/meteor_half',
    'space-kit/meteor_detailed',
  ]),
  spookGarden: Object.freeze([
    'kaykit-halloween/grave_A',
    'kaykit-halloween/grave_B',
    'kaykit-halloween/gravestone',
    'kaykit-halloween/gravemarker_A',
    'kaykit-halloween/gravemarker_B',
    'kaykit-halloween/crypt',
    'kaykit-halloween/pumpkin_orange',
    'kaykit-halloween/pumpkin_orange_jackolantern',
    'kaykit-halloween/pumpkin_orange_small',
    'kaykit-halloween/fence_seperate',
    'kaykit-halloween/fence_gate',
    'kaykit-halloween/tree_dead_large',
    'kaykit-halloween/lantern_standing',
    'kaykit-halloween/floor_dirt_grave',
  ]),
  bakery: Object.freeze([
    'kaykit-restaurant/kitchencounter_straight',
    'kaykit-restaurant/kitchencounter_sink',
    'kaykit-restaurant/oven',
    'kaykit-restaurant/fridge_A',
    'kaykit-restaurant/crate_buns',
    'kaykit-restaurant/jar_A_large',
    'kaykit-restaurant/jar_A_medium',
    'kaykit-restaurant/menu',
    'kaykit-restaurant/table_round_A',
    'kaykit-restaurant/chair_A',
    'bakery-interior/display_case_long',
    'bakery-interior/display_case_short',
    'bakery-interior/cash_register',
    'bakery-interior/stand_mixer',
    'bakery-interior/dough_ball',
    'bakery-interior/dough_rolled_A',
    'bakery-interior/macaron_pink',
    'bakery-interior/macaron_blue',
    'bakery-interior/macaron_yellow',
    'baked-goods/croissant',
    'baked-goods/cupcake',
    'baked-goods/cinnamon-roll',
  ]),
  nightSky: Object.freeze([]), // fully procedural (stars/clouds/moon)
  toyRoom: Object.freeze([
    'toy-car-kit/track-narrow-straight',
    'toy-car-kit/track-narrow-corner-small',
    'toy-car-kit/track-narrow-corner-large',
    'toy-car-kit/track-narrow-curve',
    'toy-car-kit/gate-finish',
    'toy-car-kit/gate',
    'toy-car-kit/item-box',
    'toy-car-kit/item-cone',
    'toy-car-kit/item-banana',
    'car-kit/race',
    'car-kit/police',
    'car-kit/wheel-default',
    'furniture-kit/rugRound',
    'furniture-kit/bear',
    'furniture-kit/bookcaseOpenLow',
    'furniture-kit/books',
    'furniture-kit/lampRoundFloor',
  ]),
});

/**
 * Flat de-duplicated preload list over all 8 vignettes — pass to
 * assets.preload / sceneManager.register before entering the cinematic.
 * @type {ReadonlyArray<string>}
 */
export const RECAP_ASSET_KEYS = Object.freeze([
  ...new Set(Object.values(RECAP_ASSET_KEYS_BY_BIOME).flat()),
]);
