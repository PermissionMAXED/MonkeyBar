// GOOBY 4.0 credits data (PLAN4.md §C-SYS12.4, binding — agent V4/G50).
// Rendered by ui/creditsScreen.js (wave 4, G81) as a static scrollable list;
// test/credits.test.js (G81) cross-checks section 4 rows against the
// committed asset roots so no shipped pack is uncredited and no phantom row
// ships. Pure data: no three.js/DOM imports (§B rule). Names/titles/links are
// LITERALS (not translated); section labels come from strings/v4-credits.js.
//
// Row shape:
//   { text }                          plain line
//   { title, by, license, note?, source? }  attribution row — creditsScreen
//       renders „{title}" von {by} — {license}(, {note}) · Quelle: {source}
//   { link }                          license/homepage URL (renders as TEXT —
//                                     §C-SYS12.4: taps are inert, no browser)
//   `packDir` (section 4 only): the committed root that proves the pack
//       shipped — credits.test.js fails when the dir and the row disagree.

/**
 * @typedef {Object} CreditRow
 * @property {string} [text]    plain line (section 1/5)
 * @property {string} [title]   work title (attribution rows)
 * @property {string} [by]      author/creator as credited by the source
 * @property {string} [license] SPDX-ish label, e.g. 'CC BY 4.0', 'CC0'
 * @property {string} [note]    change indication (CC BY) / optional credit
 * @property {string} [source]  source URL (rendered as text)
 * @property {string} [link]    bare URL row
 * @property {string} [packDir] committed dir under public/assets/ (section 4)
 */

/**
 * §C-SYS12.4 sections 1–5, verbatim. Section 2 rows are MANDATORY license
 * obligations (CC BY 4.0): both shipped splat scenes with author, license,
 * change indication („verändert (dezimiert/komprimiert)") and source link —
 * shipping a CC-BY asset without its row is a P1 (§A2). Avoncroft stays
 * staged as reserve; its row ships ONLY if the scene ever ships (§G6.2).
 */
export const CREDITS = Object.freeze({
  /** Section 1 — GOOBY. */
  gooby: Object.freeze([
    Object.freeze({ text: 'Ein Spiel von PermissionMAXED & den GOOBY-Agenten. Gooby ist handgemacht. 💛' }),
  ]),

  /** Section 2 — 3D-Welten (CC BY 4.0 — attribution REQUIRED, exact rows binding). */
  welten: Object.freeze([
    Object.freeze({
      title: 'S Windmill in Golden Gate Park',
      by: 'azadbal',
      license: 'CC BY 4.0',
      note: 'verändert (dezimiert/komprimiert)',
      source: 'https://superspl.at/scene/d5f14e49',
    }),
    Object.freeze({
      title: 'Ludlow - Quality Square',
      by: 'ijenko',
      license: 'CC BY 4.0',
      note: 'verändert (dezimiert/komprimiert)',
      source: 'https://superspl.at/scene/ca36efcc',
    }),
    Object.freeze({ link: 'https://creativecommons.org/licenses/by/4.0' }),
  ]),

  /** Section 3 — Musik (CC0, Dank-Erwähnung freiwillig). */
  musik: Object.freeze([
    Object.freeze({ title: 'Playful Piano', by: 'Dylann Taylor', license: 'CC0' }),
    Object.freeze({ title: 'Music Loop Bundle', by: 'Tallbeard Studios/Abstraction', license: 'CC0' }),
    Object.freeze({ title: 'Orchestral & World Music', by: 'Ragnar Random', license: 'CC0' }),
  ]),

  /**
   * Section 4 — Sounds & Grafik (CC0). Rows render only for packs actually
   * committed at ship (`packDir` cross-check). Kenney/KayKit dirs hold many
   * packs each; the itch rows point at their exact committed folder.
   */
  soundsGrafik: Object.freeze([
    Object.freeze({ title: 'Kenney.nl', by: 'Kenney (alle Kenney-Packs)', license: 'CC0', packDir: 'kenney' }),
    Object.freeze({ title: 'KayKit', by: 'Kay Lousberg', license: 'CC0', packDir: 'kaykit' }),
    Object.freeze({ title: 'Tiny Treats — Baked Goods', by: 'Isa Lousberg', license: 'CC0', packDir: 'itch/baked-goods' }),
    Object.freeze({ title: 'Tiny Treats — Bakery Interior', by: 'Isa Lousberg', license: 'CC0', packDir: 'itch/bakery-interior' }),
    Object.freeze({ title: 'Tiny Treats — Pleasant Picnic', by: 'Isa Lousberg', license: 'CC0', packDir: 'itch/pleasant-picnic' }),
    Object.freeze({ title: 'Interface SFX Pack 1', by: 'ObsydianX', license: 'CC0', packDir: 'itch/itch-sfx' }),
    Object.freeze({
      title: "Brackeys' VFX Bundle",
      by: 'Brackeys, Picster, Kenney, Thomas Iché, CodeManu',
      license: 'CC0',
      packDir: 'itch/vfx',
    }),
    Object.freeze({ title: 'Aline Furniture', by: 'Adelina Georgieva', license: 'CC0', packDir: 'itch/aline-furniture' }),
    // §C-SYS12.4 lists Cloudy Skyboxes / Lucid Icons / Particles Pack 2 /
    // Simple Vector UI as CANDIDATES — staged but NOT committed by G50, so
    // no rows ship (credits.test.js would flag them as phantom rows). A
    // later wave that commits one of those packs MUST append its row here.
  ]),

  /** Section 5 — Technik (MIT/BSD notice line). */
  technik: Object.freeze([
    Object.freeze({ text: 'three.js · Vite · Capacitor (MIT/BSD)' }),
  ]),
});
