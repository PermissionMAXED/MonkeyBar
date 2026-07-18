// V3/G34: core 3.0 data-layer strings (PLAN3 §E0.1-2) — OWNED BY AGENT G34.
// Every key the wave-1 data-spine catalogs reference lives here: the 6 new
// minigame titles (§C8.1/§C9.1/§C10.1) and the nougatmeister achievement
// name/desc (§C6.4 — the def lands in data/achievements.js with G34's spine
// edit). Sticker-book strings live in v3-stickers.js. Merged into
// data/strings.js AFTER all v1/v2 entries (single spread, §E0.1-2).
// Rule unchanged: every key exists in BOTH EN and DE.

/** @type {Record<string, string>} */
export const EN = {
  // --- Minigame titles (§C8.1 / §C9.1 / §C10.1) ---
  'mg.title.shoppingSurf': 'Shopping Surf',
  'mg.title.purblePlace': 'Cake Shop',
  'mg.title.toyRacer': 'Toy Grand Prix',
  'mg.title.ghostHunt': 'Ghost Hunt',
  'mg.title.rocketRescue': 'Rocket Rescue',
  'mg.title.harborHopper': 'Harbor Hopper',

  // --- §C6.4 nougatmeister achievement ---
  'ach.nougatmeister.name': 'Nougat Master',
  'ach.nougatmeister.desc': 'Enjoy 25 globs from the Nougat Sluice.',
};

/** @type {Record<string, string>} */
export const DE = {
  // --- Minigame titles (§C8.1 / §C9.1 / §C10.1) ---
  'mg.title.shoppingSurf': 'Shopping-Surf',
  'mg.title.purblePlace': 'Tortenwerkstatt',
  'mg.title.toyRacer': 'Spielzeug-Rennen',
  'mg.title.ghostHunt': 'Geisterjagd',
  'mg.title.rocketRescue': 'Raketen-Rettung',
  'mg.title.harborHopper': 'Hafen-Hüpfer',

  // --- §C6.4 nougatmeister achievement ---
  'ach.nougatmeister.name': 'Nougatmeister',
  'ach.nougatmeister.desc': 'Genieße 25 Kleckse aus der Nougatschleuse.',
};
