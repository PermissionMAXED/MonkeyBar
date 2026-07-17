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
  { slug: 'interface-sounds', dir: 'Audio', glob: '*.ogg', max: 120 },
  { slug: 'impact-sounds', dir: 'Audio', glob: '*.ogg', max: 100 },
  {
    slug: 'music-jingles',
    dir: 'Audio/8-Bit jingles',
    glob: 'jingles_NES*.ogg',
    max: 20,
  },
];

/** Normalize a model-pack files entry to { key, file }. */
export const modelEntry = (entry) =>
  typeof entry === 'string'
    ? { key: entry, file: `${entry}.glb` }
    : { key: entry.key, file: entry.file };
