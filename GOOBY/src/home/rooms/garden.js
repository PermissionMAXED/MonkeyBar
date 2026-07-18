// V2/G19: Garden room definition (PLAN2 §C2.1/§C8.3) — PURE DATA, no
// three.js/DOM imports (test/rooms.test.js validates headlessly).
//
// The garden is the 5th navigable space, right of the bedroom (nav dot 5,
// padlocked until L3 — §B6). `outdoor: true` tells the roomManager to build
// a 5×4 m grass ground + sky dome instead of walls/wallpaper/floor (§B3).
// `camZ` pulls the room camera back a touch (7.2 → 8.4) so the wider outdoor
// footprint fits the portrait frame — every interactable below projects
// on-screen at 390×844 and clear of Gooby's idle spot (front-left corner).
//
// Fixed interactables (§C2.1): 6 crop plots (nature-kit crops_dirtSingle,
// 2×3 grid, anchors plot0…plot5 — plots ≥ plotsOwned show a FOR-SALE sign,
// rendered dynamically by gardenInteractions.js), compost bin (procedural —
// tap opens the sell sheet), watering can on a stump (procedural — the drag
// tool), fertilizer bag (procedural — the §C2.2 fertilizer drag tool).
// Decor slots (§C8.3): gardenBench · gardenGnome · birdbath · flowerBed ·
// gardenPath · gardenTree (free defaults render before G22's catalog lands).
//
// Item keys may be pack-qualified ('nature-kit/…', 'city-kit-suburban/…');
// bare names default to furniture-kit like the indoor rooms (roomManager
// resolveAssetKey). 'proc:' ids are procedural builders in roomManager.

/** Garden ground footprint (§C2.1: 5×4 m — wider than the 4×3 indoor shell). */
export const GARDEN_SIZE = Object.freeze({ WIDTH: 5, DEPTH: 4 });

/** @type {import('../roomManager.js').RoomDef} */
export const ROOM = Object.freeze({
  id: 'garden',
  outdoor: true,
  camZ: 8.4,

  slots: Object.freeze({
    gardenBench: Object.freeze({ default: 'proc:gardenBench', items: Object.freeze(['proc:gardenBench', 'proc:pastelBench']) }),
    gardenGnome: Object.freeze({ default: null, items: Object.freeze(['proc:gardenGnome', 'proc:goldenGnome']) }),
    birdbath: Object.freeze({ default: null, items: Object.freeze(['proc:birdbath']) }),
    flowerBed: Object.freeze({ default: 'wildflowers', items: Object.freeze(['wildflowers', 'proc:roseBed']) }),
    gardenPath: Object.freeze({ default: 'proc:dirtPath', items: Object.freeze(['proc:dirtPath', 'city-kit-suburban/path-stones-short']) }),
    gardenTree: Object.freeze({ default: 'nature-kit/tree_default', items: Object.freeze(['nature-kit/tree_default', 'proc:blossomTree']) }),
  }),

  furniture: Object.freeze([
    // low fence line at the back (§C2.1: suburban fence-1x4 ×3)
    Object.freeze({ item: 'city-kit-suburban/fence-1x4', at: Object.freeze([-1.65, 0, -1.9]), rotY: 0, scale: 0.42 }),
    // V3/G46 (§C11.1): a real opening replaces the stand-in middle segment.
    Object.freeze({
      item: 'nature-kit/fence_gate', at: Object.freeze([0, 0, -1.9]),
      rotY: 0, scale: 1.15, dressing: 'v3-real-asset',
    }),
    Object.freeze({ item: 'city-kit-suburban/fence-1x4', at: Object.freeze([1.65, 0, -1.9]), rotY: 0, scale: 0.42 }),
    // back hedge (§C2.1: plant_bushLarge ×3)
    Object.freeze({ item: 'nature-kit/plant_bushLarge', at: Object.freeze([-2.05, 0, -1.62]), rotY: 15, scale: 0.5 }),
    Object.freeze({ item: 'nature-kit/plant_bushLarge', at: Object.freeze([-0.8, 0, -1.7]), rotY: -30, scale: 0.42 }),
    Object.freeze({ item: 'nature-kit/plant_bushLarge', at: Object.freeze([1.05, 0, -1.68]), rotY: 60, scale: 0.44 }),
    // tree (gardenTree decor slot — free default nature tree, §C8.3)
    Object.freeze({ slot: 'gardenTree', item: 'nature-kit/tree_default', at: Object.freeze([1.9, 0, -1.5]), rotY: 0, scale: 0.62 }),

    // 6 crop plots — 2×3 grid (§C2.1), anchors/interacts plot0…plot5
    // (0.85 m pitch; gardenInteractions.PLOT_RADIUS matches)
    Object.freeze({ item: 'nature-kit/crops_dirtSingle', at: Object.freeze([-0.85, 0, -0.75]), rotY: 0, scale: 0.55, interact: 'plot0', anchor: 'plot0', hitSize: Object.freeze([0.75, 0.55, 0.75]), noShadow: true }),
    Object.freeze({ item: 'nature-kit/crops_dirtSingle', at: Object.freeze([0, 0, -0.75]), rotY: 0, scale: 0.55, interact: 'plot1', anchor: 'plot1', hitSize: Object.freeze([0.75, 0.55, 0.75]), noShadow: true }),
    Object.freeze({ item: 'nature-kit/crops_dirtSingle', at: Object.freeze([0.85, 0, -0.75]), rotY: 0, scale: 0.55, interact: 'plot2', anchor: 'plot2', hitSize: Object.freeze([0.75, 0.55, 0.75]), noShadow: true }),
    Object.freeze({ item: 'nature-kit/crops_dirtSingle', at: Object.freeze([-0.85, 0, 0.1]), rotY: 0, scale: 0.55, interact: 'plot3', anchor: 'plot3', hitSize: Object.freeze([0.75, 0.55, 0.75]), noShadow: true }),
    Object.freeze({ item: 'nature-kit/crops_dirtSingle', at: Object.freeze([0, 0, 0.1]), rotY: 0, scale: 0.55, interact: 'plot4', anchor: 'plot4', hitSize: Object.freeze([0.75, 0.55, 0.75]), noShadow: true }),
    Object.freeze({ item: 'nature-kit/crops_dirtSingle', at: Object.freeze([0.85, 0, 0.1]), rotY: 0, scale: 0.55, interact: 'plot5', anchor: 'plot5', hitSize: Object.freeze([0.75, 0.55, 0.75]), noShadow: true }),

    // compost bin (procedural, §C2.1 — tap opens the sell sheet; back-right
    // between the plot rows and the hedge so it projects on-screen at 390 px
    // and its tap ray clears the plot/tool boxes — nearest-center pick in
    // roomManager.handleTap resolves any residual overlap)
    Object.freeze({ proc: 'compostBin', at: Object.freeze([1.5, 0, -1.15]), rotY: -15, interact: 'compost', anchor: 'compost', hitSize: Object.freeze([0.75, 0.85, 0.75]) }),
    // watering can on a stump (§C2.1 — the drag tool)
    Object.freeze({ item: 'nature-kit/stump_round', at: Object.freeze([1.35, 0, 0.75]), rotY: 0, scale: 0.5 }),
    Object.freeze({ proc: 'wateringCan', at: Object.freeze([1.35, 0.22, 0.75]), rotY: 25, interact: 'wateringCan', anchor: 'wateringCan', hitSize: Object.freeze([0.6, 0.7, 0.6]) }),
    // fertilizer bag (§C2.2 — drag onto a growing plot; buy via sheet)
    Object.freeze({ proc: 'fertilizerBag', at: Object.freeze([1.1, 0, 1.35]), rotY: 10, interact: 'fertilizer', anchor: 'fertilizer', hitSize: Object.freeze([0.5, 0.6, 0.5]) }),

    // decor slots (§C8.3 — G22's catalog swaps items via decor.js)
    // V3/G46 (§C11.1): nature-kit/bench is intentionally the pack's rustic
    // log substitute. The catalog/save id stays proc:benchWood; decor.js uses
    // this same real model when swapping back from the pastel variant.
    Object.freeze({
      slot: 'gardenBench', item: 'nature-kit/bench',
      at: Object.freeze([-1.5, 0, -1.25]), rotY: 30, scale: 0.76,
      dressing: 'v3-real-asset',
    }),
    Object.freeze({ slot: 'gardenGnome', at: Object.freeze([0.45, 0, -1.4]) }),
    Object.freeze({ slot: 'birdbath', at: Object.freeze([-1.35, 0, -0.45]) }),
    Object.freeze({
      slot: 'flowerBed', item: 'wildflowers', at: Object.freeze([-0.35, 0, -1.5]),
      pieces: Object.freeze([
        Object.freeze({ item: 'nature-kit/flower_purpleA', at: Object.freeze([-0.2, 0, 0.02]), rotY: 0, scale: 0.55 }),
        Object.freeze({ item: 'nature-kit/flower_redA', at: Object.freeze([0.02, 0, -0.1]), rotY: 40, scale: 0.55 }),
        Object.freeze({ item: 'nature-kit/flower_yellowA', at: Object.freeze([0.22, 0, 0.06]), rotY: -25, scale: 0.55 }),
      ]),
    }),
    Object.freeze({ slot: 'gardenPath', proc: 'dirtPath', at: Object.freeze([0.15, 0, 1.3]), rotY: -12, noShadow: true }),
  ]),

  anchors: Object.freeze({
    // front-left corner — clear of every plot/tool tap line (see header note)
    goobyIdle: Object.freeze([-1.5, 0, 1.25]),
    // G26 (§C11.2): Gooby contently sits under the tree canopy during rain
    canopySit: Object.freeze([1.5, 0, -1.05]),
  }),
});
