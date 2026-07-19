// V4/G53: v4-welt.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G66.
// Gooby-Welt strings (PLAN4-GAMES §G6: loading UX, quality toggle labels,
// foto-spot/pickup copy). G66 adds its keys here — always EN + DE. The
// arcade-tile title key below ships with G53's data/minigames.js row
// (§E0.1-19); G66 may refine the copy. No other agent may edit this module.
//
// V4/G66: gameplay keys for games/goobyWelt.js — scene names (== G65's
// weltScenes.js titles, keyed for the pre-game scene pills + loading card),
// the §G6.4 foto-spot banner („Toller Ausblick!"), finish banner, and the
// two §G6.6 degrade paths (load-failure fallback stage, context loss).
// The quality-toggle labels (Schön/Flüssig) are G68's (v4-arcade.js).

/** @type {Record<string, string>} */
export const EN = {
  'mg.title.goobyWelt': "Gooby's World",
  'mg.welt.scene.windmill': 'Windmill Park',
  'mg.welt.scene.townsquare': 'Town Square',
  'mg.welt.fotoSpot': 'What a view!',
  'mg.welt.finish': 'What a wonderful float!',
  'mg.welt.fallback': 'The 3D world could not load — dream stage instead',
  'mg.welt.contextLost': 'Graphics hiccup — floating gently to the results',
};

/** @type {Record<string, string>} */
export const DE = {
  'mg.title.goobyWelt': 'Gooby Welt',
  'mg.welt.scene.windmill': 'Windmühlen-Park',
  'mg.welt.scene.townsquare': 'Marktplatz',
  'mg.welt.fotoSpot': 'Toller Ausblick!',
  'mg.welt.finish': 'Was für ein wunderschöner Flug!',
  'mg.welt.fallback': '3D-Welt konnte nicht laden — dafür die Traumbühne',
  'mg.welt.contextLost': 'Grafik-Schluckauf — sanft weiter zur Auswertung',
};
