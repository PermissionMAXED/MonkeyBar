// V4/G53: v4-sick.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G70.
// Sick-trip UX strings (§C-SYS7.3: care-sheet actions, hint line, sick
// toasts, shop medicine pulse). G70 adds its keys here — always EN + DE.
// No other agent may edit this module.

/** @type {Record<string, string>} */
export const EN = {
  'care.hintShop': "Medicine helps right away — buy some at the shop if you're out.",
  'care.medicineUse': 'Use medicine',
  'care.fridgeMedicine': 'Buy medicine in the fridge',
  'care.fridgeMedicine.sub': 'Opens the fridge Care row',
  'care.shopTrip': 'Drive to the shop',
  'care.shopTrip.sub': 'Buy medicine (trip costs energy)',
  'toast.sickNow': 'Gooby is sick! 🤒 Give medicine — or drive to the shop or the vet.',
  // Override the old v2 refusal/chip copy through the v4 spread.
  'toast.tooSick': 'Gooby is sick! 🤒 Buy medicine at the shop or drive to the vet.',
  'hud.sickChip': 'Medicine, shop or vet — tap for care',
  'shop.tab.care': 'Care',
};

/** @type {Record<string, string>} */
export const DE = {
  'care.hintShop': 'Medizin hilft sofort — kauf welche im Laden, falls keine da ist.',
  'care.medicineUse': 'Medizin nutzen',
  'care.fridgeMedicine': 'Medizin im Kühlschrank kaufen',
  'care.fridgeMedicine.sub': 'Öffnet die Pflege-Zeile im Kühlschrank',
  'care.shopTrip': 'Zum Laden fahren',
  'care.shopTrip.sub': 'Medizin kaufen (Fahrt kostet Energie)',
  'toast.sickNow': 'Gooby ist krank! 🤒 Medizin geben — oder zum Laden oder Tierarzt fahren.',
  // Überschreibt die alten V2-Texte über den V4-Spread.
  'toast.tooSick': 'Gooby ist krank! 🤒 Kauf Medizin im Laden oder fahre zum Tierarzt.',
  'hud.sickChip': 'Medizin, Laden oder Tierarzt — tippe für Pflege',
  'shop.tab.care': 'Pflege',
};
