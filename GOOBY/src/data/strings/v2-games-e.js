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

  // --- deliveryRush (§C1.2 #5) — V2/G28 ---
  'mg.delivery.ticket': '📦 {n}/{max}',
  'mg.delivery.delivered': 'Delivered! Next stop!',
  'mg.delivery.timeBonus': 'All delivered! Time bonus +{n}!',
  'mg.delivery.allDone': 'All parcels delivered!',

  // --- miniGolf (§C1.2 #6) — V2/G28 ---
  'mg.golf.hole': '⛳ Hole {n}/{max} · Par {par}',
  'mg.golf.strokes': 'Strokes: {n}',
  'mg.golf.ace': 'HOLE-IN-ONE! +30',
  'mg.golf.great': 'Great putt! +{n}',
  'mg.golf.okay': 'Nice one! +{n}',
  'mg.golf.done': 'In the cup! +{n}',
  'mg.golf.capped': 'Phew! Next hole… +{n}',
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

  // --- deliveryRush (§C1.2 #5) — V2/G28 ---
  'mg.delivery.ticket': '📦 {n}/{max}',
  'mg.delivery.delivered': 'Zugestellt! Nächster Halt!',
  'mg.delivery.timeBonus': 'Alles zugestellt! Zeitbonus +{n}!',
  'mg.delivery.allDone': 'Alle Pakete zugestellt!',

  // --- miniGolf (§C1.2 #6) — V2/G28 ---
  'mg.golf.hole': '⛳ Bahn {n}/{max} · Par {par}',
  'mg.golf.strokes': 'Schläge: {n}',
  'mg.golf.ace': 'HOLE-IN-ONE! +30',
  'mg.golf.great': 'Super Putt! +{n}',
  'mg.golf.okay': 'Gut gemacht! +{n}',
  'mg.golf.done': 'Eingelocht! +{n}',
  'mg.golf.capped': 'Puh! Nächste Bahn… +{n}',
};
