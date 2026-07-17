// V2/G21: strings module (PLAN2 §E0.1-1) — OWNED BY AGENT G21.
// Scope: city 2.0: vet clinic, vet trip flow, destination picker, landmarks
// (PLAN2 §C9). Every key ships BOTH EN and DE (§A parity rule); dynamic
// values ({price}, {name}, …) ride t()'s {var} interpolation.
// Landmark sticker NAMES live in v2-core.js (G16 — sticker.landmarks.*.name).

/** @type {Record<string, string>} */
export const EN = {
  // destination picker (§C9.2 — front door / HUD once the vet is discovered)
  'city.dest.title': 'Where to?',
  'city.dest.shop': 'Shop',
  'city.dest.shopSub': 'Food & goodies · costs {energy} energy',
  'city.dest.vet': 'Vet clinic',
  'city.dest.vetSub': 'Treatment {cure} coins · Checkup {checkup} coins',

  // vet trip confirm sheet (§C9.2)
  'vet.confirm': 'Drive to the vet?',
  'vet.confirmBody': 'Treatment costs {price} coins at the clinic. The drive costs {energy} energy.',
  'vet.arrived': 'Welcome at the vet clinic! 🩺',
  'vet.towed': 'Oh no — the tow truck brings you to the vet…',

  // vet arrival panel (§C9.2)
  'vet.title': 'Vet Clinic',
  'vet.doctor': 'Dr. Hoppel',
  'vet.greet.healthy': '“Gooby looks perfectly healthy! Just a checkup today?”',
  'vet.greet.queasy': '“Hm, a grumbly tummy… a treatment will fix that right up!”',
  'vet.greet.sick': '“Oh dear, Gooby is really sick! A treatment will make him all better.”',
  'vet.cure': 'Treatment',
  'vet.cureDesc': 'Full cure: tummy and care troubles reset to zero, +{bonus} to all stats — stronger than medicine!',
  'vet.cured': 'Gooby is healthy again! ✨',
  'vet.cureNotNeeded': 'Only needed when Gooby feels unwell.',
  'vet.hintMedicine': 'Short on coins? Medicine costs {price} coins at the shop.',
  'vet.checkup': 'Checkup',
  'vet.checkupDesc': 'Health report card — and a fresh care start.',
  'vet.bandage': '🩹 Gooby wears his vet bandage with pride!',

  // checkup report card (§C9.2)
  'vet.report.title': 'Health report',
  'vet.report.state': 'Feeling',
  'vet.state.healthy': 'Healthy',
  'vet.state.queasy': 'Queasy',
  'vet.state.sick': 'Sick',
  'vet.report.junk': 'Tummy',
  'vet.junk.green': 'All good',
  'vet.junk.yellow': 'A few too many sweets',
  'vet.junk.orange': 'Way too much candy!',
  'vet.report.neglect': 'Care',
  'vet.neglect.ok': 'Well looked after',
  'vet.neglect.some': '{min} min neglected — reset to 0',
  'vet.report.weight': 'Build',
  'vet.tier.sleek': 'Sleek',
  'vet.tier.chubby': 'Chubby',
  'vet.tier.chonky': 'Extra Chonky',
  'vet.tier.floof': 'Maximum Floof',
  'vet.reportDone': 'Thanks, doc!',

  // landmarks (§C9.3)
  'landmark.found': 'Landmark discovered: {name} 📸',
};

/** @type {Record<string, string>} */
export const DE = {
  // destination picker (§C9.2)
  'city.dest.title': 'Wohin soll’s gehen?',
  'city.dest.shop': 'Laden',
  'city.dest.shopSub': 'Futter & Schönes · kostet {energy} Energie',
  'city.dest.vet': 'Tierarzt',
  'city.dest.vetSub': 'Behandlung {cure} Münzen · Checkup {checkup} Münzen',

  // vet trip confirm sheet (§C9.2)
  'vet.confirm': 'Zum Tierarzt fahren?',
  'vet.confirmBody': 'Die Behandlung kostet {price} Münzen in der Praxis. Die Fahrt kostet {energy} Energie.',
  'vet.arrived': 'Willkommen in der Tierarztpraxis! 🩺',
  'vet.towed': 'Oh nein — der Abschleppwagen bringt dich zum Tierarzt…',

  // vet arrival panel (§C9.2)
  'vet.title': 'Tierarztpraxis',
  'vet.doctor': 'Dr. Hoppel',
  'vet.greet.healthy': '„Gooby sieht kerngesund aus! Heute nur ein Checkup?“',
  'vet.greet.queasy': '„Hm, ein grummelnder Bauch… eine Behandlung bringt das in Ordnung!“',
  'vet.greet.sick': '„Oje, Gooby ist richtig krank! Eine Behandlung macht ihn wieder ganz gesund.“',
  'vet.cure': 'Behandlung',
  'vet.cureDesc': 'Rundum-Kur: Bauch- und Pflegesorgen komplett zurückgesetzt, +{bonus} auf alle Werte — stärker als Medizin!',
  'vet.cured': 'Gooby ist wieder gesund! ✨',
  'vet.cureNotNeeded': 'Nur nötig, wenn es Gooby schlecht geht.',
  'vet.hintMedicine': 'Zu wenig Münzen? Medizin gibt’s für {price} Münzen im Laden.',
  'vet.checkup': 'Checkup',
  'vet.checkupDesc': 'Gesundheitsbericht — und ein frischer Pflege-Start.',
  'vet.bandage': '🩹 Gooby trägt sein Tierarzt-Pflaster mit Stolz!',

  // checkup report card (§C9.2)
  'vet.report.title': 'Gesundheitsbericht',
  'vet.report.state': 'Befinden',
  'vet.state.healthy': 'Gesund',
  'vet.state.queasy': 'Flau im Magen',
  'vet.state.sick': 'Krank',
  'vet.report.junk': 'Bauch',
  'vet.junk.green': 'Alles bestens',
  'vet.junk.yellow': 'Etwas viel Süßes',
  'vet.junk.orange': 'Viel zu viel Süßkram!',
  'vet.report.neglect': 'Pflege',
  'vet.neglect.ok': 'Gut umsorgt',
  'vet.neglect.some': '{min} Min. vernachlässigt — auf 0 zurückgesetzt',
  'vet.report.weight': 'Figur',
  'vet.tier.sleek': 'Sportlich',
  'vet.tier.chubby': 'Knuffig',
  'vet.tier.chonky': 'Extra moppelig',
  'vet.tier.floof': 'Maximal flauschig',
  'vet.reportDone': 'Danke, Doktor!',

  // landmarks (§C9.3)
  'landmark.found': 'Sehenswürdigkeit entdeckt: {name} 📸',
};
