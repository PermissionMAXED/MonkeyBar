// V2/G16: strings module stub (PLAN2 §E0.1-1) — OWNED BY AGENT G26.
// Scope: ambience visuals: day/night + weather surfaces (PLAN2 §C10/§C11).
// G26 adds every key of that scope here (BOTH EN and DE — §A parity rule);
// nobody else edits this file, and src/data/strings.js itself stays untouched
// after wave 1 (it already spreads this module after all v1 entries).
//
// V2/G26: intentionally EMPTY — the wave-3 ambience pass ships no user-facing
// text: every §C10/§C11 surface is visual (lights/sky/FX), audible (loops) or
// behavioral (night yawns/canopy sit), and the §C11.3 forecast chip strings
// were G19's (data/strings/v2-garden.js). Keys land here if a later wave adds
// ambience UI copy.

/** @type {Record<string, string>} */
export const EN = {};

/** @type {Record<string, string>} */
export const DE = {};
