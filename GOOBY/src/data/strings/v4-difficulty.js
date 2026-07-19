// V4/G53: v4-difficulty.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G56.
// Difficulty/endless framework strings (PLAN4-GAMES §G5: mode pills, target
// lines, endless lock copy). G56 adds its keys here — always EN + DE.
// No other agent may edit this module.
//
// V4/G56 (PLAN4-GAMES §G5/§G3.3, PLAN4 §C-SYS3) — difficulty/endless mode
// names, target/lock/endless-row keys (G68's mgPregame consumes), framework
// loading/results copy, XP floater + level-up next-unlock copy and the
// nextUnlock() feature name keys (minigames/crops reuse mg.title.*/food.*).

/** @type {Record<string, string>} */
export const EN = {
  // §G5.2 mode names (pre-game pills, results)
  'mg.diff.easy': 'Easy',
  'mg.diff.normal': 'Normal',
  'mg.diff.hard': 'Hard',
  'mg.diff.endless': 'Endless ∞',
  // §G5.6 per-mode lines
  'mg.diff.coins.easy': '×0.7 coins',
  'mg.diff.coins.normal': '×1 coins',
  'mg.diff.coins.hard': '×1.3 coins · Target: {n}',
  'mg.diff.coins.endless': '5 coins · High score ∞: {n}',
  'mg.diff.target': 'Target: {n}',
  // §G5.5 lock line (pill + launch-refusal toast)
  'mg.diff.lock': '🔒 Beat Hard (target {n}) · from L10',
  'toast.endlessLocked': 'Endless ∞ unlocks after beating Hard (from level 10)',
  // §G5.6 endless results row
  'mg.results.endlessBest': 'Endless best',
  // §C-SYS4.4 results modifier chip
  'mg.results.modifierActive': '{name} active ✨',
  // §G6.6 async-init loading card (generic; goobyWelt layers its own copy)
  'mg.loading': 'Loading… ⏳',
  // §C-SYS3.1 XP floater
  'hud.xpFloater': '+{n} XP',
  // §C-SYS3.3 level-up toast with next-unlock preview
  'toast.levelUpNext': 'Level {level}! +{coins} coins · Next: {name} (L{n})',
  // §C-SYS3.3 nextUnlock() feature names (minigames/crops reuse mg.title.*/food.*)
  'unlock.quests': 'Daily quests',
  'unlock.garden': 'Garden',
  'unlock.skins': 'Fur styles',
  'unlock.quickDelivery': 'Quick Delivery',
  'unlock.plot5': '5th garden plot',
  'unlock.plot6': '6th garden plot',
  'unlock.all': 'Everything unlocked! 🏆',
};

/** @type {Record<string, string>} */
export const DE = {
  'mg.diff.easy': 'Leicht',
  'mg.diff.normal': 'Mittel',
  'mg.diff.hard': 'Schwer',
  'mg.diff.endless': 'Endlos ∞',
  'mg.diff.coins.easy': '×0,7 Münzen',
  'mg.diff.coins.normal': '×1 Münzen',
  'mg.diff.coins.hard': '×1,3 Münzen · Ziel: {n}',
  'mg.diff.coins.endless': '5 Münzen · Highscore ∞: {n}',
  'mg.diff.target': 'Ziel: {n}',
  'mg.diff.lock': '🔒 Schlage Schwer (Ziel {n}) · ab L10',
  'toast.endlessLocked': 'Endlos ∞: Erst Schwer schlagen (ab Level 10)',
  'mg.results.endlessBest': 'Endlos-Best',
  'mg.results.modifierActive': '{name} aktiv ✨',
  'mg.loading': 'Lädt… ⏳',
  'hud.xpFloater': '+{n} XP',
  'toast.levelUpNext': 'Level {level}! +{coins} Münzen · Nächstes: {name} (L{n})',
  'unlock.quests': 'Tages-Quests',
  'unlock.garden': 'Garten',
  'unlock.skins': 'Fell-Styles',
  'unlock.quickDelivery': 'Schnell-Lieferung',
  'unlock.plot5': '5. Garten-Beet',
  'unlock.plot6': '6. Garten-Beet',
  'unlock.all': 'Alles freigeschaltet! 🏆',
};
