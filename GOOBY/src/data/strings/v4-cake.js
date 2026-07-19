// V4/G53: v4-cake.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G62.
// Purble-Place rework strings (PLAN4-GAMES §G1: station labels, overview
// strip, pedal hints). G62 adds its keys here — always EN + DE.
// No other agent may edit this module.
//
// V4/G62: side-view Comfy-Cakes rework keys. Component/station names stay in
// v3-cake.js (mg.cake.st.* / sponge.* / icing.* / top.*) — only NEW UI
// surfaces of the G62 control bar + juice banners live here.

/** @type {Record<string, string>} */
export const EN = {
  'mg.cake4.strip': 'Belt overview',
  'mg.cake4.pedal.back': 'Belt backward (hold)',
  'mg.cake4.pedal.fwd': 'Belt forward (hold)',
  'mg.cake4.shape': 'Pan shape',
  'mg.cake4.spawn': 'New pan',
  'mg.cake4.ship': 'Ship',
  'mg.cake4.splat': 'Splat! Missed the pan…',
  'mg.cake4.buzz': 'Wrong pan for that!',
  'mg.cake4.trash': 'Into the trash!',
  'mg.cake4.endless.done': 'Shift over!',
};

/** @type {Record<string, string>} */
export const DE = {
  'mg.cake4.strip': 'Band-Übersicht',
  'mg.cake4.pedal.back': 'Band rückwärts (halten)',
  'mg.cake4.pedal.fwd': 'Band vorwärts (halten)',
  'mg.cake4.shape': 'Form wählen',
  'mg.cake4.spawn': 'Neue Form',
  'mg.cake4.ship': 'Versand',
  'mg.cake4.splat': 'Platsch! Daneben…',
  'mg.cake4.buzz': 'Falsche Form dafür!',
  'mg.cake4.trash': 'Ab in den Müll!',
  'mg.cake4.endless.done': 'Schicht vorbei!',
};
