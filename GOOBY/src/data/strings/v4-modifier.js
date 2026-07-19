// V4/G53: v4-modifier.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G76.
// Modifier-event surfacing strings (§C-SYS4: type names, start toast, tile
// badge, results chip, Glücksrolle). G76 adds its keys here — always EN + DE.
// No other agent may edit this module.
//
// V4/G76 (§C-SYS4.2/4.4/4.6): the 6 type names — these ARE the engine's
// `modifier.name.*` nameKeys, so G68's pregame banner + arcade fx resolve
// real names through t() now — plus per-type descriptions, the §C-SYS4.6
// start toast, the HUD-chip label and the results-breakdown lines incl.
// the glueckspilz „Glücksrolle" row and the §C-SYS11 „Tagesbonus erreicht"
// day-cap note. Names verbatim from the §C-SYS4.2 table (DE / EN column).

/** @type {Record<string, string>} */
export const EN = {
  // §C-SYS4.2 type names (the engine's nameKey column)
  'modifier.name.doppelGold': 'Double Gold',
  'modifier.name.muenzregen': 'Coin Rain',
  'modifier.name.turbo': 'Turbo',
  'modifier.name.riesenGooby': 'Giant Gooby',
  'modifier.name.stickerChance': 'Sticker Chance',
  'modifier.name.glueckspilz': 'Lucky Charm',
  // per-type descriptions (§C-SYS4.2 effect column)
  'modifier.desc.doppelGold': 'Round coins ×2 at the payout!',
  'modifier.desc.muenzregen': 'More coins rain down in-game (×1.5)!',
  'modifier.desc.turbo': 'Faster game — score ×1.5 at the end!',
  'modifier.desc.riesenGooby': 'Giant Gooby with bigger hit windows!',
  'modifier.desc.stickerChance': 'A collection find is guaranteed this round!',
  'modifier.desc.glueckspilz': 'Lucky roll after the round: +10–60 coins!',
  // §C-SYS4.6 start toast (fires with jingle.short)
  'modifier.start': 'Bonus event: {name} in {game}! ✨',
  // HUD modifier chip (V4/G76 block in ui/hud.js)
  'modifier.hud.open': 'Bonus event active — open the arcade',
  // results breakdown (§G8-3 bonus row + §C-SYS4.2 per-type lines)
  'modifier.results.doppelGold': '+{n} extra',
  'modifier.results.turbo': 'Score ×1.5',
  'modifier.results.sticker.drop': '+1 sticker',
  'modifier.results.sticker.quest': '+1 quest progress',
  'modifier.results.glueckspilz': 'Lucky roll',
  'modifier.results.capped': 'Daily bonus reached',
};

/** @type {Record<string, string>} */
export const DE = {
  'modifier.name.doppelGold': 'Doppel-Gold',
  'modifier.name.muenzregen': 'Münzregen',
  'modifier.name.turbo': 'Turbo',
  'modifier.name.riesenGooby': 'Riesen-Gooby',
  'modifier.name.stickerChance': 'Sticker-Chance',
  'modifier.name.glueckspilz': 'Glückspilz',
  'modifier.desc.doppelGold': 'Rundenmünzen ×2 bei der Auszahlung!',
  'modifier.desc.muenzregen': 'Mehr Münzen im Spiel (×1,5)!',
  'modifier.desc.turbo': 'Schnelleres Spiel — Punkte ×1,5 am Ende!',
  'modifier.desc.riesenGooby': 'Riesen-Gooby mit größeren Trefferfenstern!',
  'modifier.desc.stickerChance': 'Ein Sammel-Fund ist diese Runde garantiert!',
  'modifier.desc.glueckspilz': 'Glücksrolle nach der Runde: +10–60 Münzen!',
  'modifier.start': 'Bonus-Event: {name} in {game}! ✨',
  'modifier.hud.open': 'Bonus-Event aktiv — Arcade öffnen',
  'modifier.results.doppelGold': '+{n} extra',
  'modifier.results.turbo': 'Punkte ×1,5',
  'modifier.results.sticker.drop': '+1 Sticker',
  'modifier.results.sticker.quest': '+1 Quest-Fortschritt',
  'modifier.results.glueckspilz': 'Glücksrolle',
  'modifier.results.capped': 'Tagesbonus erreicht',
};
