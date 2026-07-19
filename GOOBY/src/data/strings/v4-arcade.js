// V4/G53: v4-arcade.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G68.
// Pre-game screen + cover-grid strings (PLAN4-GAMES §G5.6/§G7: info row,
// difficulty pill lines, quality toggle label). G68 adds its keys here —
// always EN + DE. No other agent may edit this module.
//
// V4/G68 (PLAN4-GAMES §G7.4 + §G5.6/§G8-1): the §G7.4 key list verbatim
// (arcade.special.ribbon, pregame.play/target/endlessLocked/quality.*) plus
// the pre-game info row, the modifier banner (effect blurbs per §C-SYS4.2 —
// the type NAMES stay G76's strings/v4-modifier.js; pregame.modifier.title
// is the §E0.1-11 graceful fallback until that module fills) and the
// §C-SYS4.5 tile badge. Mode names (Leicht/Mittel/Schwer/Endlos) are owned
// by strings/v4-difficulty.js (G56) — not duplicated here.

/** @type {Record<string, string>} */
export const EN = {
  // §G7.4 — goobyWelt SPECIAL ribbon (arcade tile + pre-game cover)
  'arcade.special.ribbon': 'SPECIAL — real 3D world!',
  // §G7.2 — cover-card info row (best ★ left, endless ∞ right)
  'arcade.best.short': '★ {n}',
  'arcade.endless.short': '∞ {n}',
  // §C-SYS4.5 — modifier tile badge („{playsLeft}× ✨" pill; mm:ss ticks next to it)
  'arcade.modifier.badge': '{n}× ✨',
  // §G5.6/§G7.3 — pre-game screen
  'pregame.play': 'Play ▶',
  'pregame.target': 'Target: {n}',
  'pregame.endlessLocked': '🔒 Beat Hard (target {n}) · from L10',
  'pregame.locked': '🔒 Unlocks at level {n}',
  'pregame.best': 'Best: {n}',
  'pregame.energy': 'Energy',
  'pregame.coins': 'Coins',
  // §G6.6 — goobyWelt quality toggle (settings.goobyWeltQuality high|low)
  'pregame.quality.title': 'Graphics',
  'pregame.quality.high': 'Pretty',
  'pregame.quality.low': 'Smooth',
  'pregame.special.sub': 'A real 3D world — cruise & collect!',
  // §G8-1 — modifier banner (name via G76's nameKey; title = fallback copy)
  'pregame.modifier.title': 'Bonus active! ✨',
  'pregame.modifier.plays': '{n} plays left',
  'pregame.modifier.effect.doppelGold': 'Coins ×2 on the payout!',
  'pregame.modifier.effect.muenzregen': 'More coins to grab in-game (×1.5)!',
  'pregame.modifier.effect.turbo': 'Faster game — score ×1.5!',
  'pregame.modifier.effect.riesenGooby': 'Giant Gooby — bigger hit windows!',
  'pregame.modifier.effect.stickerChance': 'Guaranteed collection drop this round!',
  'pregame.modifier.effect.glueckspilz': 'Lucky roll after the round: +10–60 coins!',
};

/** @type {Record<string, string>} */
export const DE = {
  'arcade.special.ribbon': 'SPECIAL — echte 3D-Welt!',
  'arcade.best.short': '★ {n}',
  'arcade.endless.short': '∞ {n}',
  'arcade.modifier.badge': '{n}× ✨',
  'pregame.play': 'Spielen ▶',
  'pregame.target': 'Ziel: {n}',
  'pregame.endlessLocked': '🔒 Schlage Schwer (Ziel {n}) · ab L10',
  'pregame.locked': '🔒 Ab Level {n}',
  'pregame.best': 'Rekord: {n}',
  'pregame.energy': 'Energie',
  'pregame.coins': 'Münzen',
  'pregame.quality.title': 'Grafik',
  'pregame.quality.high': 'Schön',
  'pregame.quality.low': 'Flüssig',
  'pregame.special.sub': 'Eine echte 3D-Welt — cruisen & sammeln!',
  'pregame.modifier.title': 'Bonus aktiv! ✨',
  'pregame.modifier.plays': 'Noch {n} Spiele',
  'pregame.modifier.effect.doppelGold': 'Münzen ×2 bei der Auszahlung!',
  'pregame.modifier.effect.muenzregen': 'Mehr Münzen im Spiel (×1,5)!',
  'pregame.modifier.effect.turbo': 'Schnelleres Spiel — Punkte ×1,5!',
  'pregame.modifier.effect.riesenGooby': 'Riesen-Gooby — größere Trefferfenster!',
  'pregame.modifier.effect.stickerChance': 'Garantierter Sammel-Fund in dieser Runde!',
  'pregame.modifier.effect.glueckspilz': 'Glücksrolle nach der Runde: +10–60 Münzen!',
};
