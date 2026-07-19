// V4/G58 — dev-harness URL-param cheat sheet (PLAN4 §C-SYS6 card 18).
// SINGLE SOURCE for the §E9 param list: the dev panel renders this table
// read-only (one „Copy" button per row) and G82's wave-4 docs pass
// regenerates the AGENTS.md cheat-sheet section from it. Pure data — no
// DOM/three imports (node-tested in test/v4SettingsUi.test.js).
//
// Rows are grouped for display; `example` is the copy-button payload
// (always a ready-to-paste `?…` query snippet). Params owned by same-wave
// or later agents are included with their owner noted in the description —
// the harness ignores unknown params, so the sheet may lead the code by a
// wave (§E0.1-11 degradation is free here).

/**
 * @typedef {{param: string, example: string, en: string, de: string}} HarnessParamRow
 * @typedef {{id: string, en: string, de: string, rows: HarnessParamRow[]}} HarnessParamGroup
 */

/** @type {readonly HarnessParamGroup[]} */
export const HARNESS_PARAM_GROUPS = Object.freeze([
  Object.freeze({
    id: 'state',
    en: 'Save & state',
    de: 'Save & Zustand',
    rows: Object.freeze([
      Object.freeze({ param: 'reset', example: '?reset=1', en: 'wipe the save', de: 'Save löschen' }),
      Object.freeze({ param: 'coins', example: '?coins=500', en: 'set coins', de: 'Münzen setzen' }),
      Object.freeze({ param: 'level', example: '?level=12', en: 'set level (1–40)', de: 'Level setzen (1–40)' }),
      Object.freeze({ param: 'energy', example: '?energy=80', en: 'set the energy stat', de: 'Energie-Stat setzen' }),
      Object.freeze({ param: 'hunger', example: '?hunger=80', en: 'set the hunger stat', de: 'Hunger-Stat setzen' }),
      Object.freeze({ param: 'hygiene', example: '?hygiene=80', en: 'set the hygiene stat', de: 'Hygiene-Stat setzen' }),
      Object.freeze({ param: 'fun', example: '?fun=80', en: 'set the fun stat', de: 'Spaß-Stat setzen' }),
      Object.freeze({ param: 'lang', example: '?lang=de', en: 'language override (de|en)', de: 'Sprache erzwingen (de|en)' }),
    ]),
  }),
  Object.freeze({
    id: 'clock',
    en: 'Clock & ambience',
    de: 'Uhr & Ambiente',
    rows: Object.freeze([
      Object.freeze({ param: 'fast', example: '?fast=10', en: 'clock multiplier', de: 'Uhr-Beschleunigung' }),
      Object.freeze({ param: 'now', example: '?now=1735689600000', en: 'pin the clock (epoch ms — also pins day band + weather)', de: 'Uhr pinnen (Epoch-ms — pinnt auch Tageszeit + Wetter)' }),
    ]),
  }),
  Object.freeze({
    id: 'routing',
    en: 'Routing',
    de: 'Routing',
    rows: Object.freeze([
      Object.freeze({ param: 'scene', example: '?scene=home', en: 'scene routing (home|gooby|roadtest)', de: 'Szenen-Routing (home|gooby|roadtest)' }),
      Object.freeze({ param: 'room', example: '?room=garden', en: 'home room (kitchen|living|bathroom|bedroom|garden)', de: 'Zimmer (kitchen|living|bathroom|bedroom|garden)' }),
      Object.freeze({ param: 'minigame', example: '?minigame=carrotCatch', en: 'direct minigame launch (bypasses level locks)', de: 'Minispiel direkt starten (umgeht Level-Locks)' }),
      Object.freeze({ param: 'open', example: '?open=settings', en: 'open a screen (shop|wardrobe|achievements|arcade|settings|questBoard|album|profile|devPanel)', de: 'Screen öffnen (shop|wardrobe|achievements|arcade|settings|questBoard|album|profile|devPanel)' }),
      Object.freeze({ param: 'travel', example: '?travel=surf', en: 'direct shop trip via surf|drive', de: 'Einkaufsfahrt direkt via surf|drive' }),
    ]),
  }),
  Object.freeze({
    id: 'uiDebug',
    en: 'UI & debug',
    de: 'UI & Debug',
    rows: Object.freeze([
      Object.freeze({ param: 'uiscale', example: '?uiscale=130', en: 'UI scale override (85|100|115|130)', de: 'UI-Größe erzwingen (85|100|115|130)' }),
      Object.freeze({ param: 'notch', example: '?notch=1', en: 'fake safe-area insets (59/34 px)', de: 'Fake-Notch-Ränder (59/34 px)' }),
      Object.freeze({ param: 'sleep', example: '?sleep=1', en: 'start a nap right away', de: 'sofort Nickerchen starten' }),
      Object.freeze({ param: 'autoplay', example: '?minigame=carrotCatch&autoplay=1', en: 'bot-plays the launched minigame', de: 'Bot spielt das gestartete Minispiel' }),
      Object.freeze({ param: 'autopilot', example: '?travel=drive&autopilot=1', en: 'bot-drives the shop/vet trip', de: 'Bot fährt die Einkaufs-/Tierarztfahrt' }),
      Object.freeze({ param: 'onboarding', example: '?onboarding=0', en: 'suppress the first-run tutorial', de: 'Erst-Tutorial unterdrücken' }),
      Object.freeze({ param: 'petdebug', example: '?petdebug=1', en: 'pet/tickle gesture telemetry overlay', de: 'Streichel-Gesten-Telemetrie-Overlay' }),
    ]),
  }),
  Object.freeze({
    id: 'demos',
    en: 'Feature demos',
    de: 'Feature-Demos',
    rows: Object.freeze([
      Object.freeze({ param: 'skin', example: '?skin=honey', en: 'own + equip a fur skin', de: 'Fell-Skin besitzen + anziehen' }),
      Object.freeze({ param: 'outfits', example: '?outfits=strawhat,roundGlasses', en: 'own + equip outfits (comma list)', de: 'Outfits besitzen + anziehen (Komma-Liste)' }),
      Object.freeze({ param: 'dailydemo', example: '?dailydemo=4', en: 'daily popup as streak day N', de: 'Tagesbonus-Popup als Serientag N' }),
      Object.freeze({ param: 'achdemo', example: '?achdemo=1', en: 'seeded achievements screen', de: 'Erfolge-Screen mit Seed-Daten' }),
      Object.freeze({ param: 'whatsnew', example: '?whatsnew=1', en: "force the What's-new panel (2 regresses 2.0)", de: 'What\u2019s-new-Panel erzwingen (2 = 2.0-Variante)' }),
      Object.freeze({ param: 'care', example: '?care=feed:carrot', en: 'care demos (tray|wash|feed:<foodId> + ?suds/?feedAt/?feedN)', de: 'Pflege-Demos (tray|wash|feed:<foodId> + ?suds/?feedAt/?feedN)' }),
      Object.freeze({ param: 'emotion', example: '?scene=gooby&emotion=happy&clip=wave', en: 'showcase deep link (with ?scene=gooby)', de: 'Showcase-Deeplink (mit ?scene=gooby)' }),
    ]),
  }),
  Object.freeze({
    id: 'v4',
    en: '4.0 (wave 1b+ owners noted)',
    de: '4.0 (Wave-1b+-Besitzer notiert)',
    rows: Object.freeze([
      Object.freeze({ param: 'difficulty', example: '?minigame=carrotCatch&difficulty=hard', en: 'launch difficulty easy|normal|hard|endless (G56)', de: 'Start-Schwierigkeit easy|normal|hard|endless (G56)' }),
      Object.freeze({ param: 'invertx', example: '?invertx=1', en: 'invert controls left/right (G56 proxy)', de: 'Steuerung links/rechts invertieren (G56-Proxy)' }),
      Object.freeze({ param: 'inverty', example: '?inverty=1', en: 'invert controls up/down (G56 proxy)', de: 'Steuerung hoch/runter invertieren (G56-Proxy)' }),
    ]),
  }),
]);

/** Flat row list (tests + simple consumers). @returns {HarnessParamRow[]} */
export function allHarnessParams() {
  return HARNESS_PARAM_GROUPS.flatMap((g) => [...g.rows]);
}

// ---------------------------------------------------------------------------
// §C-SYS6 card 17 — jump-list candidates. The ui/sceneManager registries are
// intentionally private (§E6), so the dev panel probes these candidate ids
// via ui.hasScreen()/sceneManager.has() and renders unregistered ones as
// disabled „not built yet" chips. Wave-2+ ids are listed ahead of their
// agents on purpose (§E0.1-11 — the probe keeps the list honest).
// ---------------------------------------------------------------------------

/** @type {readonly string[]} scene ids for sceneManager.has() probing */
export const JUMP_SCENES = Object.freeze([
  'home', 'gooby', 'roadtest', 'minigame', 'recap', 'goobyWelt',
]);

/** @type {readonly string[]} §E6 screen ids for ui.hasScreen() probing */
export const JUMP_SCREENS = Object.freeze([
  'settings', 'devPanel', 'arcade', 'shop', 'wardrobe', 'achievements',
  'questBoard', 'album', 'profile', 'radio', 'trackSettings', 'credits',
]);

/** @type {readonly string[]} §E6 panel ids (no hasPanel — buttons live-try) */
export const JUMP_PANELS = Object.freeze([
  'radioPanel', 'trackSettings', 'codes', 'settingsDisplay', 'settingsAudio',
  'careSheet', 'dailyBonus',
]);
