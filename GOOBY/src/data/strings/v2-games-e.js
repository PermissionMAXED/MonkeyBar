// V2/G16: strings module stub (PLAN2 §E0.1-1) — OWNED BY AGENT G25 + G28.
// Scope: minigames E: starHopper, pipeFlow (G25) + deliveryRush, miniGolf (G28) in-game strings (PLAN2 §C1.2).
// G25 + G28 adds every key of that scope here (BOTH EN and DE — §A parity rule);
// nobody else edits this file, and src/data/strings.js itself stays untouched
// after wave 1 (it already spreads this module after all v1 entries).
//
// V2/G25 (wave 3): starHopper + pipeFlow in-game strings below.
// V2/G28 (wave 4): appends deliveryRush + miniGolf keys after these.

/** @type {Record<string, string>} */
export const EN = {
  // --- starHopper (§C1.2 #8) — V2/G25 ---
  'mg.hopper.shower': 'Meteor shower!',
  'mg.hopper.shield': 'Shield up!',
  'mg.hopper.shieldSaved': 'The shield saved you!',

  // --- pipeFlow (§C1.2 #9) — V2/G25 ---
  'mg.pipe.solved': 'Connected! Water flows!',
  'mg.pipe.puzzle': 'Puzzle {n}',
};

/** @type {Record<string, string>} */
export const DE = {
  // --- starHopper (§C1.2 #8) — V2/G25 ---
  'mg.hopper.shower': 'Meteorschauer!',
  'mg.hopper.shield': 'Schild aktiv!',
  'mg.hopper.shieldSaved': 'Das Schild hat dich gerettet!',

  // --- pipeFlow (§C1.2 #9) — V2/G25 ---
  'mg.pipe.solved': 'Verbunden! Wasser marsch!',
  'mg.pipe.puzzle': 'Rätsel {n}',
};
