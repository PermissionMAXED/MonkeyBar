// V2/G16: strings module stub (PLAN2 §E0.1-1) — OWNED BY AGENT G20.
// Scope: pet-sim wiring: sickness/medicine/vet care sheet, weight copy, feeding pipeline toasts (PLAN2 §C3/§C4).
// G20 adds every key of that scope here (BOTH EN and DE — §A parity rule);
// nobody else edits this file, and src/data/strings.js itself stays untouched
// after wave 1 (it already spreads this module after all v1 entries).
//
// V2/G20: filled in — sickness/medicine/care sheet/weight copy, the
// welcome-back toast parts and the feed-pipeline toasts the G20 wiring emits.
// (The notification id-6/7 copy itself lives in v2-core.js — G16 shipped it
// with the wave-1 data layer; §E0.1-1 forbids duplicate keys across modules.)

/** @type {Record<string, string>} */
export const EN = {
  // welcome-back toast parts (systems/offline.js)
  'offline.cropsReady': 'Crops are ready! 🥕',
  'offline.becameSick': 'Gooby got sick 🤒',

  // sickness ramp + transitions (§C3.2/§C3.3/§C3.4 toasts)
  'health.tummyWarning': "Gooby's tummy is rumbling…",
  'health.becameQueasy': 'Gooby feels queasy… 🤢',
  'health.becameSick': 'Gooby is sick! 🤒',
  'health.recovered': 'Gooby feels better! 💚',

  // feeding pipeline (§C3.4: sick Gooby only accepts healthy food)
  'toast.junkRefusedSick': 'Gooby is sick! Only healthy food… 🤒',

  // fridge tray additions (§C7 junk badge + Care row)
  'tray.careTitle': 'Care',
  'tray.junkBadge': 'Sweets',
  'tray.buy': 'Buy {price}c',
  'tray.medicine': 'Medicine',
  'tray.fertilizer': 'Fertilizer',
  'tray.fertilizerHint': 'Use it in the garden!',
  'tray.noCoins': 'Not enough coins! 🪙',
  'tray.bought': 'Bought! 🧾',

  // belly junk-band icon labels (a11y/status text)
  'health.junkBand.ok': 'Tummy is happy',
  'health.junkBand.warn': 'A lot of sweets…',
  'health.junkBand.high': 'Way too many sweets!',

  // care sheet (§C3.4/§C3.5)
  'care.title': 'Gooby Care',
  'care.status.healthy': 'Gooby is doing great! 💚',
  'care.status.queasy': 'Gooby feels queasy… 🤢',
  'care.status.sick': 'Gooby is sick! 🤒',
  'care.weightTier': 'Fluff level: {tier}',
  'care.weightNote': 'Gooby is perfect just the way he is.',
  'care.medicine': 'Give medicine',
  'care.medicineOwned': '×{count} in the cabinet',
  'care.medicineNone': 'No medicine! Buy it in the shop (40c).',
  'care.medicineNotNeeded': 'Gooby is healthy — no medicine needed!',
  'care.medicineGiven': 'Yuck… ahh, better! 💊',
  'care.vet': 'Drive to the vet',
  'care.vetPrice': 'Cure 120c · Checkup 30c',
  'care.vetNotBuilt': 'The vet clinic opens soon! 🏥',
  'care.close': 'Close',

  // weight tiers (§C4.3 names)
  'weight.tier.sleek': 'Sleek',
  'weight.tier.chubby': 'Chubby',
  'weight.tier.chonky': 'Extra Chonky',
  'weight.tier.floof': 'Maximum Floof',
};

/** @type {Record<string, string>} */
export const DE = {
  // welcome-back toast parts
  'offline.cropsReady': 'Ernte ist reif! 🥕',
  'offline.becameSick': 'Gooby ist krank geworden 🤒',

  // sickness ramp + transitions
  'health.tummyWarning': 'Goobys Bauch grummelt…',
  'health.becameQueasy': 'Gooby ist ganz flau… 🤢',
  'health.becameSick': 'Gooby ist krank! 🤒',
  'health.recovered': 'Gooby geht es besser! 💚',

  // feeding pipeline
  'toast.junkRefusedSick': 'Gooby ist krank! Nur gesundes Essen… 🤒',

  // fridge tray additions
  'tray.careTitle': 'Pflege',
  'tray.junkBadge': 'Süßes',
  'tray.buy': 'Kaufen {price}c',
  'tray.medicine': 'Medizin',
  'tray.fertilizer': 'Dünger',
  'tray.fertilizerHint': 'Benutz ihn im Garten!',
  'tray.noCoins': 'Nicht genug Münzen! 🪙',
  'tray.bought': 'Gekauft! 🧾',

  // belly junk-band icon labels
  'health.junkBand.ok': 'Bauch ist happy',
  'health.junkBand.warn': 'Ganz schön viel Süßes…',
  'health.junkBand.high': 'Viel zu viel Süßes!',

  // care sheet
  'care.title': 'Gooby-Pflege',
  'care.status.healthy': 'Gooby geht es prima! 💚',
  'care.status.queasy': 'Gooby ist ganz flau… 🤢',
  'care.status.sick': 'Gooby ist krank! 🤒',
  'care.weightTier': 'Flausch-Level: {tier}',
  'care.weightNote': 'Gooby ist perfekt, so wie er ist.',
  'care.medicine': 'Medizin geben',
  'care.medicineOwned': '×{count} im Schrank',
  'care.medicineNone': 'Keine Medizin! Kauf sie im Laden (40c).',
  'care.medicineNotNeeded': 'Gooby ist gesund — keine Medizin nötig!',
  'care.medicineGiven': 'Igitt… ahh, besser! 💊',
  'care.vet': 'Zum Tierarzt fahren',
  'care.vetPrice': 'Behandlung 120c · Checkup 30c',
  'care.vetNotBuilt': 'Die Tierarztpraxis öffnet bald! 🏥',
  'care.close': 'Schließen',

  // weight tiers (§C4.3 names)
  'weight.tier.sleek': 'Sportlich',
  'weight.tier.chubby': 'Knuffig',
  'weight.tier.chonky': 'Extra moppelig',
  'weight.tier.floof': 'Maximal flauschig',
};
