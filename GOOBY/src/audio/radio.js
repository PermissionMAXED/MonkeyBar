// GOOBY V4/G51 — alias module: the radio engine lives in ./radioPlayer.js
// (PLAN4 §B2.3's canonical name). This shim keeps the `src/audio/radio.js`
// spelling working too (G52's UI feature-detects BOTH paths via
// import.meta.glob) — same singleton either way, no duplicated state.

export * from './radioPlayer.js';
export { default } from './radioPlayer.js';
