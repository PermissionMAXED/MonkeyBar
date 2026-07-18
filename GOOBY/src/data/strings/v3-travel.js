// V3/G34: v3-travel.js stub (PLAN3 §E0.1-2) — OWNED BY AGENT G38.
// travel-integration strings (door sheet, rewards — §C8.6)
// Created empty by G34 in wave 1b; G38 adds its keys here — always EN + DE.
// No other agent may edit this module.
//
// V3/G38: two-option travel chooser („Fahren 🚗 / Laufen 🏃" — §C8.6). The
// option emoji render in the sheet's .dest-emoji span; both subs show the
// 6-energy cost ({energy} = MINIGAME.DRIVE_ENERGY_COST / SURF_TRAVEL.ENERGY).

/** @type {Record<string, string>} */
export const EN = {
  'travel.title': 'To the shop?',
  'travel.drive': 'Drive',
  'travel.driveSub': 'By car through town · costs {energy} energy',
  'travel.run': 'Run',
  'travel.runSub': 'Shopping Surf run · costs {energy} energy',
};

/** @type {Record<string, string>} */
export const DE = {
  'travel.title': 'Zum Laden?',
  'travel.drive': 'Fahren',
  'travel.driveSub': 'Mit dem Auto durch die Stadt · kostet {energy} Energie',
  'travel.run': 'Laufen',
  'travel.runSub': 'Shopping-Surf-Lauf · kostet {energy} Energie',
};
