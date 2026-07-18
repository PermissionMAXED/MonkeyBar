/**
 * GOOBY — KayKit asset manifest (single source of truth for the second asset
 * root, PLAN3.md §B6 + §D2). V3/G31.
 *
 * Every pack entry:
 *   {
 *     slug,        // committed dir: public/assets/kaykit/<slug>/
 *     source,      // staging dir with the models, relative to the staging root
 *     license,     // staging path of the pack's LICENSE.txt (copied per slug)
 *     ext,         // 'glb' (self-contained) | 'gltf' (+ .bin + shared texture)
 *     files: [ <name> | { key, file } ],
 *   }
 * `<name>` → source `<source>/<name>.<ext>`, committed as `<name>.<ext>`.
 * `{ key, file }` → §D5-style substitution: source `<source>/<file>`, committed
 * as `<key>.<ext>` so the §D2 key keeps working at runtime (logged loudly by
 * fetch-kaykit.mjs; bake persistent substitutions here, never drop silently).
 *
 * `.gltf`-form models (§B6 form (b)) reference `<model>.bin` + ONE shared
 * `<pack>_texture.png` by relative URI — fetch-kaykit.mjs parses each copied
 * `.gltf` and copies/asserts every `buffers[].uri`/`images[].uri` dependency
 * next to it (three's GLTFLoader resolves URIs against the model URL).
 *
 * Committed layout (consumed by src/core/assets.js PACK_FORMATS):
 *   public/assets/kaykit/<slug>/<key>.glb|.gltf (+ .bin + shared texture)
 *   public/assets/kaykit/<slug>/LICENSE.txt
 */

/** Default staging root on the build VM (gitignored, PLAN3.md §D). */
export const STAGING_ROOT = '/workspace/asset-staging/kaykit';

const split = (s) => s.trim().split(/\s+/);

/** @type {Array<object>} */
export const KAYKIT_PACKS = [
  {
    // §D2.1 — the 3 NPC characters (binding choice): self-contained GLBs with
    // embedded texture + all 76 AnimationClips (Idle, Walking_A, Running_A,
    // Sit_Chair_Idle, Cheer, Interact, PickUp, Jump_Full_Long used).
    // Consumers MUST use getSkinnedModel/getAnimations (§B6/§E0.1-10).
    slug: 'kaykit-characters',
    source:
      'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf',
    license:
      'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/LICENSE.txt',
    ext: 'glb',
    files: split(`Knight Mage Rogue_Hooded`),
  },
  {
    // §D2.2 — purblePlace/§C9.6 restaurant set (24 models + shared texture).
    slug: 'kaykit-restaurant',
    source:
      'KayKit-Restaurant-Bits-1.0/addons/kaykit_restaurant_bits/Assets/gltf',
    license:
      'KayKit-Restaurant-Bits-1.0/addons/kaykit_restaurant_bits/Assets/LICENSE.txt',
    ext: 'gltf',
    files: [
      // Baked substitution (§D5 availability rule): the pack has no plain
      // 'kitchencounter_straight' — variants are _A/_B; _A is the §C9.6 look.
      { key: 'kitchencounter_straight', file: 'kitchencounter_straight_A.gltf' },
      ...split(`kitchencounter_sink oven wall_orderwindow wall_doorway
        floor_kitchen floor_kitchen_small plate plate_small menu chair_A
        chair_stool table_round_A cuttingboard crate crate_buns crate_cheese
        crate_tomatoes crate_carrots jar_A_large jar_A_medium jar_C_small bowl
        fridge_A`),
    ],
  },
  {
    // §D2.3 — surf street façades + §C11.1 city sidewalk dressing (15 models).
    // KayKit roads intentionally NOT taken — city-kit-roads stays the roads.
    slug: 'kaykit-city',
    source:
      'KayKit-City-Builder-Bits-1.0/addons/kaykit_city_builder_bits/Assets/gltf',
    license:
      'KayKit-City-Builder-Bits-1.0/addons/kaykit_city_builder_bits/Assets/LICENSE.txt',
    ext: 'gltf',
    files: split(`building_A_withoutBase building_B_withoutBase
      building_C_withoutBase building_D_withoutBase building_E_withoutBase
      building_F_withoutBase box_A box_B bench streetlight firehydrant
      dumpster trash_A trash_B bush`),
  },
  {
    // §D2.4 — ghostHunt set (18 models) + pumpkin_orange_small (pumpkinHat).
    slug: 'kaykit-halloween',
    source:
      'KayKit-Halloween-Bits-1.0/addons/kaykit_halloween_bits/Assets/gltf',
    license:
      'KayKit-Halloween-Bits-1.0/addons/kaykit_halloween_bits/Assets/LICENSE.txt',
    ext: 'gltf',
    files: split(`grave_A grave_B gravemarker_A gravemarker_B gravestone crypt
      coffin_decorated pumpkin_orange pumpkin_orange_small
      pumpkin_orange_jackolantern pumpkin_yellow_small lantern_standing
      lantern_hanging fence_gate fence_seperate tree_dead_large
      tree_pine_orange_small floor_dirt_grave`),
  },
];

/** Normalize a files entry to { key, file } (file includes the extension). */
export const kaykitEntry = (entry, ext) =>
  typeof entry === 'string'
    ? { key: entry, file: `${entry}.${ext}` }
    : { key: entry.key, file: entry.file };
