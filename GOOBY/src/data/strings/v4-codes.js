// V4/G53: v4-codes.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G58.
// Codes-system UI strings (§C-SYS5.1 surface, §C-SYS5.2 toasts, §C-SYS5.3
// input handling — copy binding). G58 adds its keys here — always EN + DE.
// No other agent may edit this module.

/** @type {Record<string, string>} */
export const EN = {
  'codes.title': 'Codes',
  'codes.sub': 'Secret words unlock surprises',
  'codes.input.placeholder': 'Enter code word…',
  'codes.redeem': 'Redeem',
  // §C-SYS5.3 exact copy
  'codes.wrong': "Hmm, Gooby doesn't know that word",
  'codes.already': 'Already redeemed! 😉',
  'codes.locked': 'Wait {s} s',
  // §C-SYS5.2 exact success toasts
  'codes.toast.updateLiebe': 'Double coins for 10 minutes! 💛',
  'codes.toast.herzGooby': 'Gooby loves you too! 💗',
  'codes.toast.ok': 'Code redeemed! ✨',
  // redeemed list (name · date · effect line)
  'codes.redeemed.title': 'Redeemed codes',
  'codes.redeemed.empty': 'Nothing redeemed yet — secret words hide everywhere! 👀',
  'codes.name.updateLiebe': 'UpdateLiebe',
  'codes.name.herzGooby': 'IchLIE3BDich',
  'codes.effect.doubleCoins': '×2 coins for {m} min',
  'codes.effect.sticker': 'Secret sticker unlocked',
  'codes.effect.coins': '+{c} coins',
  // §E0.1-11 same-wave fallback while G53's engine is unmerged
  'codes.unavailable': 'Code words arrive with the next update — this word does nothing yet.',
};

/** @type {Record<string, string>} */
export const DE = {
  'codes.title': 'Codes',
  'codes.sub': 'Geheime Wörter schalten Überraschungen frei',
  'codes.input.placeholder': 'Codewort eingeben…',
  'codes.redeem': 'Einlösen',
  'codes.wrong': 'Hmm, das Wort kennt Gooby nicht',
  'codes.already': 'Schon eingelöst! 😉',
  'codes.locked': 'Warte {s} s',
  'codes.toast.updateLiebe': 'Doppelte Münzen für 10 Minuten! 💛',
  'codes.toast.herzGooby': 'Gooby hat dich auch lieb! 💗',
  'codes.toast.ok': 'Code eingelöst! ✨',
  'codes.redeemed.title': 'Eingelöste Codes',
  'codes.redeemed.empty': 'Noch nichts eingelöst — geheime Wörter verstecken sich überall! 👀',
  'codes.name.updateLiebe': 'UpdateLiebe',
  'codes.name.herzGooby': 'IchLIE3BDich',
  'codes.effect.doubleCoins': '×2 Münzen für {m} Min.',
  'codes.effect.sticker': 'Geheimer Sticker freigeschaltet',
  'codes.effect.coins': '+{c} Münzen',
  'codes.unavailable': 'Codewörter kommen mit dem nächsten Update — dieses Wort tut noch nichts.',
};
