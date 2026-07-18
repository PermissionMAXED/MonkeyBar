/**
 * GOOBY — Kenney asset manifest (single source of truth for committed assets).
 *
 * Binding contract: PLAN.md §D1. Every pack entry is either:
 *  - a model pack:  { slug, modelDir, files: [ <name> | { key, file } ] }
 *      <name>            → source `<modelDir>/<name>.glb`, committed as `<name>.glb`
 *      { key, file }     → source `<modelDir>/<file>` (actual name inside the
 *                          pack when it differs from the §D1 key), committed as
 *                          `<key>.glb` so the §D1 key keeps working at runtime.
 *  - an audio pack:  { slug, dir, glob, max }
 *      matching files are committed flat under `<slug>/audio/`.
 *      V3/G31 (PLAN3 §D3): `dir` may be an array (files gathered from every
 *      dir); `oggs: [<name>]` is an exact whitelist alternative to `glob`;
 *      `source: '<kenney slug>'` overrides the download/staging pack when the
 *      committed slug differs (e.g. ui-pack-sounds ships inside ui-pack).
 *
 * V3/G31 (PLAN3 §D4): UI_SPRITES lists the ui-pack PNGs committed under
 * public/assets/ui/ — CSS assets (border-image/background), NOT keyed through
 * src/core/assets.js. Listed here for provenance: this manifest stays the
 * whitelist of record for everything committed from Kenney packs.
 *
 * Committed layout (consumed by src/core/assets.js):
 *   public/assets/kenney/<slug>/<key>.glb
 *   public/assets/kenney/<slug>/audio/<file>.ogg
 *   public/assets/kenney/<slug>/License.txt
 *
 * Discovery (PLAN.md §D1): fetch https://kenney.nl/assets/<slug> and take the
 * first match of DISCOVERY_REGEX (zip names may carry version suffixes, e.g.
 * kenney_city-kit-commercial_2.1.zip).
 */

/** Zip-URL discovery regex factory (slug-scoped). */
export const discoveryRegex = (slug) =>
  new RegExp(
    `/media/pages/assets/${slug}/[a-z0-9]+-\\d+/kenney_[A-Za-z0-9._-]+\\.zip`
  );

/** Hard budget for the total committed asset size (PLAN.md §D1). */
export const BUDGET_BYTES = 80 * 1024 * 1024;

const split = (s) => s.trim().split(/\s+/);

/** @type {Array<object>} */
export const PACKS = [
  {
    slug: 'furniture-kit',
    modelDir: 'Models/GLTF format',
    files: [
      // living
      ...split(`loungeSofa loungeSofaCorner loungeDesignSofa loungeChair
        tableCoffee tableCoffeeGlass televisionModern televisionVintage
        cabinetTelevision bookcaseOpen bookcaseOpenLow bookcaseClosedWide
        rugRounded rugRectangle rugRound rugSquare rugDoormat pottedPlant
        plantSmall1 plantSmall2 plantSmall3 lampRoundFloor lampSquareFloor
        lampRoundTable lampSquareTable lampWall radio speaker`),
      // kitchen
      ...split(`kitchenFridge kitchenFridgeLarge kitchenSink kitchenStove
        kitchenCabinet kitchenCabinetDrawer kitchenCabinetUpper
        kitchenCabinetUpperDouble kitchenBar kitchenCoffeeMachine
        kitchenBlender kitchenMicrowave toaster table tableCloth chair
        chairCushion stoolBar`),
      // bath
      ...split(`bathtub shower showerRound toilet bathroomSink bathroomMirror
        bathroomCabinet bathroomCabinetDrawer washer`),
      // bed
      ...split(`bedSingle bedDouble cabinetBed cabinetBedDrawer
        coatRackStanding bear pillow pillowBlue books sideTable
        sideTableDrawers trashcan ceilingFan`),
      // V3/G31: room dressing (PLAN3 §D5). The other §D5 furniture-kit names
      // (kitchenCoffeeMachine, books, plantSmall1/2, bathroomMirror, toaster,
      // kitchenBar) are already whitelisted above by v1.
      ...split(`lampSquareCeiling`),
    ],
  },
  {
    slug: 'food-kit',
    modelDir: 'Models/GLB format',
    files: [
      ...split(`carrot apple banana bread cheese watermelon donut
        donut-sprinkles cupcake salad ice-cream sandwich hot-dog pancakes burger
        pizza cake cookie croissant muffin pear strawberry corn broccoli
        egg-cooked waffle taco pie popsicle soda fish fish-bones
        soda-can-crushed bowl-cereal plate-dinner cutting-board frying-pan
        pot-stew mug whipped-cream`),
      // V2/G15: 2.0 foods (§C7), burgerBuild layers, veggieChop pairs (PLAN2 §D2)
      ...split(`tomato tomato-slice radish eggplant pumpkin grapes fries
        corn-dog candy-bar lollypop chocolate sundae meat-patty cheese-cut
        lemon lemon-half onion onion-half mushroom mushroom-half paprika
        paprika-slice coconut coconut-half apple-half pear-half`),
      // V3/G31: 3.0 additions (PLAN3 §D5) — purblePlace toppings + the
      // Nutella jar (§C6.1). The other §D5 food-kit names (cake, cupcake,
      // muffin, whipped-cream, strawberry, chocolate, donut-sprinkles) are
      // already whitelisted above by v1/v2.
      ...split(`cake-birthday honey`),
    ],
  },
  {
    slug: 'city-kit-roads',
    modelDir: 'Models/GLB format',
    files: split(`road-straight road-straight-half road-bend road-curve
      road-intersection road-crossroad road-crossing road-end road-end-round
      road-square road-roundabout light-square-double light-curved
      construction-cone construction-barrier tile-low tile-high sign-highway`),
  },
  {
    slug: 'city-kit-commercial',
    modelDir: 'Models/GLB format',
    files: split(`building-a building-b building-c building-d building-e
      building-f building-g building-h building-skyscraper-a
      building-skyscraper-b detail-awning detail-awning-wide
      low-detail-building-a low-detail-building-b low-detail-building-c
      low-detail-building-d low-detail-building-e low-detail-building-f`),
  },
  {
    slug: 'car-kit',
    modelDir: 'Models/GLB format',
    files: split(`sedan sedan-sports hatchback-sports suv taxi van delivery
      truck police race cone box wheel-default wheel-dark`),
  },
  {
    slug: 'nature-kit',
    modelDir: 'Models/GLTF format',
    files: [
      ...split(`tree_default tree_oak tree_fat tree_detailed tree_pineRoundA
        tree_pineTallA plant_bush plant_bushLarge flower_purpleA flower_redA
        flower_yellowA grass_large rock_smallA rock_largeA fence_simple
        fence_gate crop_carrot crops_dirtSingle stump_round mushroom_red log
        bridge_wood`),
      // V2/G15: crop growth stages (§C2.3), gardenRush pots, raised bed (PLAN2 §D2)
      ...split(`crops_leafsStageA crops_leafsStageB crops_cornStageA
        crops_cornStageB crops_cornStageC crops_cornStageD crop_melon
        crop_pumpkin crop_turnip pot_large pot_small bed`),
      // V3/G31: garden dressing (PLAN3 §D5). The pack has NO bench model —
      // baked substitution per the §D5 availability rule: 'bench' resolves to
      // log_large.glb (rustic sittable garden log; closest in-pack stand-in).
      // fence_gate/stump_round/flower_purpleA/flower_redA/plant_bush/pot_large
      // are already whitelisted above by v1/v2.
      { key: 'bench', file: 'log_large.glb' },
      ...split(`rock_smallFlatA`),
    ],
  },
  // V2/G15: 2.0 packs (PLAN2 §D3) — garden/vet fencing+paths, miniGolf course
  // tiles + windmillCafe landmark, starHopper craft/meteors.
  {
    slug: 'city-kit-suburban',
    modelDir: 'Models/GLB format',
    files: split(`fence-1x4 fence-low fence-2x2 planter path-stones-short
      path-stones-long driveway-short tree-small tree-large`),
  },
  {
    slug: 'minigolf-kit',
    modelDir: 'Models/GLB format',
    files: split(`start straight end corner hole-round hole-open ramp-low
      ramp-medium bump obstacle-block obstacle-triangle windmill tunnel-wide
      wall-left wall-right flag-red flag-blue castle`),
  },
  {
    slug: 'space-kit',
    modelDir: 'Models/GLTF format',
    files: split(`craft_speederA craft_speederB meteor meteor_detailed
      meteor_half`),
  },
  // V3/G31: 3.0 packs (PLAN3 §D5) — toyRacer track set, harborHopper boats,
  // golden-watering-can bucket (§C11.1).
  {
    slug: 'toy-car-kit',
    modelDir: 'Models/GLB format',
    files: split(`track-narrow-straight track-narrow-curve
      track-narrow-corner-small track-narrow-corner-large
      track-narrow-straight-bump-up track-narrow-straight-bump-down
      track-narrow-straight-hill-beginning track-narrow-straight-hill-end
      track-narrow-looping gate gate-finish item-box item-banana item-cone
      item-coin-gold item-coin-silver item-coin-bronze supports
      supports-clamp smoke`),
  },
  {
    slug: 'watercraft-kit',
    modelDir: 'Models/GLB format',
    files: split(`boat-fishing-small boat-row-small boat-sail-a buoy
      buoy-flag arrow-standing`),
  },
  {
    slug: 'survival-kit',
    modelDir: 'Models/GLB format',
    files: split(`bucket`),
  },
  { slug: 'interface-sounds', dir: 'Audio', glob: '*.ogg', max: 120 },
  { slug: 'impact-sounds', dir: 'Audio', glob: '*.ogg', max: 100 },
  {
    // V3/G31 (PLAN3 §D3.1): completed — all 85 jingles across the 5 families
    // (NES/HIT/PIZZI/SAX/STEEL 00–16; Preview.ogg excluded). Feeds the §C3.3
    // medley tables + stingers.
    slug: 'music-jingles',
    dir: [
      'Audio/8-Bit jingles',
      'Audio/Hit jingles',
      'Audio/Pizzicato jingles',
      'Audio/Sax jingles',
      'Audio/Steel jingles',
    ],
    oggs: ['NES', 'HIT', 'PIZZI', 'SAX', 'STEEL'].flatMap((family) =>
      Array.from(
        { length: 17 },
        (_, i) => `jingles_${family}${String(i).padStart(2, '0')}`
      )
    ),
  },
  // V3/G31: 3.0 audio packs (PLAN3 §D3.2–§D3.4) — exact whitelists.
  {
    // toggles (§C3.1), slider ticks, secondary taps
    slug: 'ui-audio',
    dir: 'Audio',
    oggs: split(`click1 click2 click3 click4 click5 rollover1 rollover2
      rollover3 rollover4 switch1 switch2 switch8 switch13 mouseclick1
      mouserelease1`),
  },
  {
    // tab switches, primary CTAs — ships inside the ui-pack download
    slug: 'ui-pack-sounds',
    source: 'ui-pack',
    dir: 'Sounds',
    oggs: split(`tap-a tap-b click-a click-b switch-a switch-b`),
  },
  {
    // real coin sfx (§C3.1) + memoryMatch card sounds (§C10.2)
    slug: 'casino-audio',
    dir: 'Audio',
    oggs: split(`chip-lay-1 chip-lay-2 chip-lay-3 chips-collide-1
      chips-collide-2 chips-collide-3 chips-collide-4 chips-stack-1
      chips-stack-2 card-slide-1 card-slide-2 card-slide-3 card-place-1
      card-place-2 card-shuffle`),
  },
];

/**
 * V3/G31 (PLAN3 §D4): Kenney ui-pack sprites committed to public/assets/ui/
 * (per-color subdirs to keep the upstream file names collision-free). CSS
 * assets for the §C11.2 reskin — referenced from styles.css via
 * border-image/background, NOT keyed through src/core/assets.js.
 */
export const UI_SPRITES = {
  source: 'ui-pack',
  sets: [
    {
      dir: 'PNG/Grey/Default',
      out: 'grey',
      files: split(`button_square_border button_square_flat
        button_square_gloss button_rectangle_border
        button_rectangle_depth_flat button_rectangle_flat button_round_line
        check_round_grey check_round_round_circle check_square_grey
        check_square_color_checkmark slide_horizontal_grey
        slide_horizontal_grey_section slide_horizontal_color
        slide_horizontal_color_section slide_hangle star star_outline
        arrow_basic_e arrow_basic_w`),
    },
    // The same 6 button/check sprites in Blue + Red for state accents (§D4).
    {
      dir: 'PNG/Blue/Default',
      out: 'blue',
      files: split(`button_square_border button_square_flat
        button_rectangle_border button_rectangle_depth_flat
        check_round_round_circle check_square_color_checkmark`),
    },
    {
      dir: 'PNG/Red/Default',
      out: 'red',
      files: split(`button_square_border button_square_flat
        button_rectangle_border button_rectangle_depth_flat
        check_round_round_circle check_square_color_checkmark`),
    },
  ],
};

/** Normalize a model-pack files entry to { key, file }. */
export const modelEntry = (entry) =>
  typeof entry === 'string'
    ? { key: entry, file: `${entry}.glb` }
    : { key: entry.key, file: entry.file };
