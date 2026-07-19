// V4/G53: v4-controls.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G58.
// „Steuerung invertieren" accessibility group (PLAN4-GAMES §G3.3 — exact
// keys/copy binding; the proxy mechanism itself is G56's inputInvert.js).
// G58 adds its keys here — always EN + DE. No other agent may edit this module.

/** @type {Record<string, string>} */
export const EN = {
  'settings.controls.title': 'Controls',
  'settings.controls.invertX': 'Invert controls (left/right)',
  'settings.controls.invertY': 'Invert controls (up/down)',
  'settings.controls.hint': 'Applies in steering games',
};

/** @type {Record<string, string>} */
export const DE = {
  'settings.controls.title': 'Steuerung',
  'settings.controls.invertX': 'Steuerung invertieren (links/rechts)',
  'settings.controls.invertY': 'Steuerung invertieren (hoch/runter)',
  'settings.controls.hint': 'Gilt in Steuer-Spielen',
};
