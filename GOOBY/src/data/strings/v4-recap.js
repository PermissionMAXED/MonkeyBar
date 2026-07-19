// V4/G53: v4-recap.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G64.
// Level-up recap cinematic strings (§C-SYS2.4 stat-line templates, end card,
// skip affordance, profile „Rückblicke" row). G64 adds its keys here —
// always EN + DE. No other agent may edit this module.
//
// V4/G64: the `recap.line.*` templates mirror systems/recap.js STAT_CATALOG
// VERBATIM (§C-SYS2.4 binding table; pinned by test/recapOverlay.test.js) —
// the engine carries them too so the catalog stays node-testable, the DOM
// overlay renders through these keys.

/** @type {Record<string, string>} */
export const EN = {
  // ── cinematic chrome (§C-SYS2.1/2.2/2.7) ─────────────────────────────────
  'recap.title': 'Level {n}!',
  'recap.subtitle': 'Your adventure so far',
  'recap.skip': 'Skip ›',
  'recap.continue': 'Continue',
  'recap.endcard.rewards': '{n} coins in level rewards',
  'recap.endcard.next': 'Next: {name} (L{n})',
  'recap.endcard.all': 'Everything unlocked! 🏆',
  // ── profile „Rückblicke" row (§C-SYS2.8) ─────────────────────────────────
  'recap.profile.title': 'Recaps',
  'recap.profile.row': 'Level {level} · {ago}',
  'recap.profile.empty': 'No recaps yet — the first one arrives at level 5!',
  'recap.profile.replay': 'Watch recap',
  'recap.ago.today': 'today',
  'recap.ago.yesterday': 'yesterday',
  'recap.ago.days': '{n} days ago',
  // ── §C-SYS2.4 stat-line templates (verbatim, catalog order #1–#18) ───────
  'recap.line.days': 'Since then: {n} days',
  'recap.line.days.one': 'Since then: 1 day',
  'recap.line.games': '{n} games played',
  'recap.line.coinsEarned': '{n} coins earned',
  'recap.line.tickles': 'belly rubbed {n}×',
  'recap.line.feeds': '{n} tasty meals',
  'recap.line.harvests': '{n} harvests brought in',
  'recap.line.stickers': '{n} new stickers',
  'recap.line.quests': '{n} quests done',
  'recap.line.washes': '{n} squeaky-clean baths',
  'recap.line.sleeps': '{n} good nights of sleep',
  'recap.line.trips': '{n} trips to town',
  'recap.line.distance': '{n} m traveled',
  'recap.line.photos': '{n} photos snapped',
  'recap.line.deliveries': '{n} parcels delivered',
  'recap.line.cures': 'sick {n}× (get well soon!)',
  'recap.line.cakes': '{n} cakes served',
  'recap.line.nougat': '{n} nougat globs',
  'recap.line.coinsSpent': '{n} coins spent',
};

/** @type {Record<string, string>} */
export const DE = {
  // ── cinematic chrome (§C-SYS2.1/2.2/2.7) ─────────────────────────────────
  'recap.title': 'Level {n}!',
  'recap.subtitle': 'Dein Abenteuer bisher',
  'recap.skip': 'Überspringen ›',
  'recap.continue': 'Weiter',
  'recap.endcard.rewards': '{n} Münzen Level-Belohnung',
  'recap.endcard.next': 'Nächstes: {name} (L{n})',
  'recap.endcard.all': 'Alles freigeschaltet! 🏆',
  // ── profile „Rückblicke" row (§C-SYS2.8) ─────────────────────────────────
  'recap.profile.title': 'Rückblicke',
  'recap.profile.row': 'Level {level} · {ago}',
  'recap.profile.empty': 'Noch keine Rückblicke — der erste kommt bei Level 5!',
  'recap.profile.replay': 'Rückblick ansehen',
  'recap.ago.today': 'heute',
  'recap.ago.yesterday': 'gestern',
  'recap.ago.days': 'vor {n} Tagen',
  // ── §C-SYS2.4 stat-line templates (verbatim, catalog order #1–#18) ───────
  'recap.line.days': 'Seitdem: {n} Tage vergangen',
  'recap.line.days.one': 'Seitdem: 1 Tag vergangen',
  'recap.line.games': '{n} Spiele gespielt',
  'recap.line.coinsEarned': '{n} Münzen verdient',
  'recap.line.tickles': '{n}× Bauch gekrault',
  'recap.line.feeds': '{n}× lecker gefuttert',
  'recap.line.harvests': '{n} Ernten eingeholt',
  'recap.line.stickers': '{n} neue Sticker',
  'recap.line.quests': '{n} Quests geschafft',
  'recap.line.washes': '{n}× blitzblank gebadet',
  'recap.line.sleeps': '{n}× tief geschlafen',
  'recap.line.trips': '{n} Ausflüge in die Stadt',
  'recap.line.distance': '{n} m unterwegs',
  'recap.line.photos': '{n} Fotos geknipst',
  'recap.line.deliveries': '{n} Pakete geliefert',
  'recap.line.cures': '{n}× krank (gute Besserung!)',
  'recap.line.cakes': '{n} Torten serviert',
  'recap.line.nougat': '{n} Nougat-Globs',
  'recap.line.coinsSpent': '{n} Münzen ausgegeben',
};
