// V3/G36: v3-cake.js (PLAN3 §E0.1-2) — OWNED BY AGENT G36.
// purblePlace flagship strings (§C9). The game title lives in v3-core
// ('mg.title.purblePlace'); tickets are pictogram cards (language-free) —
// these keys cover the station buttons, banners and accessibility labels.
// Always EN + DE. No other agent may edit this module.

/** @type {Record<string, string>} */
export const EN = {
  // --- station groups (§C9.3 — DE names are the canonical station ids) ---
  'mg.cake.st.form': 'Shape',
  'mg.cake.st.teig': 'Batter',
  'mg.cake.st.ofen': 'Oven',
  'mg.cake.st.guss': 'Icing',
  'mg.cake.st.deko': 'Deco',
  'mg.cake.st.kerzen': 'Candles',
  // --- button labels (aria/title — the buttons themselves are pictograms) ---
  'mg.cake.sponge.vanilla': 'Vanilla batter',
  'mg.cake.sponge.chocolate': 'Chocolate batter',
  'mg.cake.sponge.strawberry': 'Strawberry batter',
  'mg.cake.icing.white': 'White icing',
  'mg.cake.icing.pink': 'Pink icing',
  'mg.cake.icing.chocolate': 'Chocolate icing',
  'mg.cake.top.cherry': 'Cherry',
  'mg.cake.top.sprinkles': 'Sprinkles',
  'mg.cake.top.berries': 'Berries',
  // --- banners / feedback (§C9.4) ---
  'mg.cake.perfect': 'Perfect cake! +{pts}',
  'mg.cake.oneWrong': 'Almost right +{pts}',
  'mg.cake.rejected': 'Rejected! −5',
  'mg.cake.expired': 'Customer left… −5',
  'mg.cake.bakePerfect': 'Golden bake! +5',
  'mg.cake.bakeSinged': 'Singed! −3',
  'mg.cake.newOrder': 'New order!',
  'mg.cake.loop': 'Fix-it lap!',
  'mg.cake.speedUp': 'Belt speeds up!',
};

/** @type {Record<string, string>} */
export const DE = {
  'mg.cake.st.form': 'Form',
  'mg.cake.st.teig': 'Teig',
  'mg.cake.st.ofen': 'Ofen',
  'mg.cake.st.guss': 'Guss',
  'mg.cake.st.deko': 'Deko',
  'mg.cake.st.kerzen': 'Kerzen',
  'mg.cake.sponge.vanilla': 'Vanilleteig',
  'mg.cake.sponge.chocolate': 'Schokoteig',
  'mg.cake.sponge.strawberry': 'Erdbeerteig',
  'mg.cake.icing.white': 'Weißer Guss',
  'mg.cake.icing.pink': 'Rosa Guss',
  'mg.cake.icing.chocolate': 'Schokoguss',
  'mg.cake.top.cherry': 'Kirsche',
  'mg.cake.top.sprinkles': 'Streusel',
  'mg.cake.top.berries': 'Beeren',
  'mg.cake.perfect': 'Perfekte Torte! +{pts}',
  'mg.cake.oneWrong': 'Fast richtig +{pts}',
  'mg.cake.rejected': 'Abgelehnt! −5',
  'mg.cake.expired': 'Kunde weg… −5',
  'mg.cake.bakePerfect': 'Goldbraun! +5',
  'mg.cake.bakeSinged': 'Angebrannt! −3',
  'mg.cake.newOrder': 'Neue Bestellung!',
  'mg.cake.loop': 'Korrektur-Runde!',
  'mg.cake.speedUp': 'Band wird schneller!',
};
