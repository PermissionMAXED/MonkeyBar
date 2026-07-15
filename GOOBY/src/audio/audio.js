// Audio manager STUB with the final API (§D6). Agent G14 replaces the bodies
// with the real WebAudio manager (ogg pools, jingles, procedural music, voice).
// Until then every call is a no-op that logs, so call sites can be wired now.
//
// Contract (§D6, binding):
//   init()                — call on first user gesture (iOS unlock requirement)
//   play(id, opts)        — fire a one-shot sfx by semantic id ('ui.tap', 'coin.get'…)
//   music(id)             — start a music track by id, or stop with null
//   setVolume(kind, v)    — kind: 'sfx' | 'music', v: 0..1

let initialized = false;

/** Init on first user gesture (iOS requirement §D6). No-op stub. */
export function init() {
  if (initialized) return;
  initialized = true;
  console.debug('[audio stub] init');
}

/**
 * Play a one-shot sound effect. No-op stub.
 * @param {string} id semantic sfx id (sfxMap.js — G14)
 * @param {{volume?: number, pitch?: number}} [opts]
 */
export function play(id, opts) {
  console.debug('[audio stub] play', id, opts ?? '');
}

/**
 * Start/stop background music. No-op stub.
 * @param {string|null} id track id, or null to stop
 */
export function music(id) {
  console.debug('[audio stub] music', id);
}

/**
 * Set a volume bus level. No-op stub.
 * @param {'sfx'|'music'} kind
 * @param {number} v 0..1
 */
export function setVolume(kind, v) {
  console.debug('[audio stub] setVolume', kind, v);
}

export default { init, play, music, setVolume };
