// SFX map (§D6, agent G14): semantic sfx id → sound definition. Three kinds:
//   sample — Kenney ogg(s) by asset key ('<pack>/<file-no-ext>', resolved via
//            core/assets.js getAudioUrl). Multiple keys = random-from-set.
//   synth  — procedural WebAudio recipe by name (implemented in audio.js).
//   voice  — Gooby voice recipe by name (implemented in goobyVoice.js);
//            loop:true ids keep playing until audio.stop(id).
// Optional per-id fields: volume 0..1 (default 1), haptic 'light'|'medium'
// (fires a guarded native impact alongside the sound — §D6 haptics), loop.
//
// Coverage contract: EVERY id passed to audio.play() anywhere in src/ MUST be
// mapped here — test/onboarding.test.js scans the source tree and fails on
// unmapped ids; audio.js also console.warns in dev builds.
//
// Pure data: no three.js/DOM imports (node:test runs this headlessly).

/** @typedef {{kind: 'sample', keys: string[], volume?: number, haptic?: string}} SampleDef */
/** @typedef {{kind: 'synth', name: string, volume?: number, haptic?: string}} SynthDef */
/** @typedef {{kind: 'voice', name: string, volume?: number, loop?: boolean}} VoiceDef */
/** @typedef {SampleDef|SynthDef|VoiceDef} SfxDef */

/** Numbered Kenney file set: seq('interface-sounds/click', 5, 1) → click_001…005. */
function seq(prefix, count, from = 1, pad = 3) {
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(`${prefix}_${String(from + i).padStart(pad, '0')}`);
  }
  return keys;
}

/** @returns {SampleDef} */
const sample = (keys, opts = {}) => ({ kind: 'sample', keys, ...opts });
/** @returns {SynthDef} */
const synth = (name, opts = {}) => ({ kind: 'synth', name, ...opts });
/** @returns {VoiceDef} */
const voice = (name, opts = {}) => ({ kind: 'voice', name, ...opts });

const UI = 'interface-sounds';
const IMP = 'impact-sounds';
const JIN = 'music-jingles';

/**
 * The complete sfx id → definition table (§D6: ui taps from interface-sounds,
 * bonks/crashes/catches from impact-sounds, jingles from music-jingles,
 * Gooby voice + juice blips synthesized).
 * @type {Record<string, SfxDef>}
 */
export const SFX_MAP = Object.freeze({
  // --- UI / framework ---
  'ui.tap': sample(seq(`${UI}/click`, 5), { volume: 0.5, haptic: 'light' }),
  'ui.open': sample(seq(`${UI}/open`, 4), { volume: 0.55 }),
  'ui.close': sample(seq(`${UI}/close`, 4), { volume: 0.55 }),
  'ui.pick': sample(seq(`${UI}/select`, 5), { volume: 0.55, haptic: 'light' }),
  'ui.error': sample(seq(`${UI}/error`, 4), { volume: 0.45 }),
  'ui.count': sample([`${UI}/tick_001`, `${UI}/tick_002`, `${UI}/tick_004`], { volume: 0.7 }),
  'ui.go': sample(seq(`${UI}/confirmation`, 4), { volume: 0.75, haptic: 'light' }),
  'ui.win': synth('winArp', { volume: 0.7 }),

  // --- coins / economy ---
  'coin.get': synth('coin', { volume: 0.5, haptic: 'light' }),
  'coin.fly': synth('coin', { volume: 0.3 }),
  'coin.spend': sample(seq(`${UI}/drop`, 4), { volume: 0.6 }),

  // --- jingles (music-jingles NES set — level-up/achievement/results/daily §D6) ---
  'jingle.levelUp': sample([`${JIN}/jingles_NES03`], { volume: 0.75 }),
  'jingle.achievement': sample([`${JIN}/jingles_NES05`], { volume: 0.7 }),
  'jingle.results': sample([`${JIN}/jingles_NES13`], { volume: 0.55 }),
  'jingle.daily': sample([`${JIN}/jingles_NES09`], { volume: 0.75 }),
  'jingle.arrival': sample([`${JIN}/jingles_NES04`], { volume: 0.7 }),
  'jingle.outfit': sample([`${JIN}/jingles_NES07`], { volume: 0.7 }),
  'jingle.short': sample([`${JIN}/jingles_NES11`], { volume: 0.6 }),

  // --- Gooby voice (synthesized — §D6 goobyVoice.js) ---
  'gooby.squeak': voice('squeak'),
  'gooby.squeakHappy': voice('squeakHappy'),
  'gooby.squeakDizzy': voice('squeakDizzy'),
  'gooby.purr': voice('purr', { volume: 0.8 }),
  'gooby.giggle': voice('giggle'),
  'gooby.refuse': voice('refuse'),
  'gooby.sniff': voice('sniff', { volume: 0.7 }),
  'gooby.snore': voice('snore', { loop: true, volume: 0.8 }),
  'gooby.yawn': voice('yawn'),

  // --- care interactions (§C3) ---
  'eat.chomp': sample(seq(`${IMP}/footstep_grass`, 5, 0), { volume: 0.8 }),
  'wash.scrub': sample(seq(`${UI}/scratch`, 5), { volume: 0.35 }),
  'wash.splash': synth('splash', { volume: 0.7 }),
  'toilet.flush': synth('flush', { volume: 0.7 }),
  'ball.throw': synth('whoosh', { volume: 0.6 }),
  'ball.bounce': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.55, haptic: 'light' }),

  // --- city drive (§C4/§C6.1 #1) ---
  bump: sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.7 }),
  crash: sample(seq(`${IMP}/impactMetal_heavy`, 5, 0), { volume: 0.8, haptic: 'medium' }),
  bonk: sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.65, haptic: 'light' }),
  tow: synth('sad', { volume: 0.7 }),

  // --- runner ---
  whoosh: synth('whoosh', { volume: 0.5 }),
  jump: synth('jump', { volume: 0.6 }),
  slide: sample(seq(`${UI}/scratch`, 5), { volume: 0.4 }),
  'crash.soft': sample(seq(`${IMP}/impactMetal_light`, 5, 0), { volume: 0.6, haptic: 'light' }),
  'combo.up': sample(seq(`${UI}/glass`, 6), { volume: 0.5 }),

  // --- carrotCatch ---
  'catch.good': synth('pop', { volume: 0.6, haptic: 'light' }),
  'catch.bad': sample(seq(`${UI}/error`, 4, 5), { volume: 0.5, haptic: 'medium' }),

  // --- bunnyHop ---
  'hop.flap': sample(seq(`${IMP}/footstep_carpet`, 5, 0), { volume: 0.5 }),
  'hop.gate': sample(seq(`${UI}/glass`, 6), { volume: 0.5 }),
  'hop.crash': sample(seq(`${IMP}/impactPunch_medium`, 5, 0), { volume: 0.7, haptic: 'medium' }),

  // --- carrotGuard ---
  'mole.bonk': sample(seq(`${IMP}/impactPunch_heavy`, 5, 0), { volume: 0.8, haptic: 'light' }),
  'mole.pop': synth('pop', { volume: 0.45 }),
  'mole.whiff': synth('whoosh', { volume: 0.35 }),
  'mole.steal': synth('sadBlip', { volume: 0.6 }),
  'mole.combo': sample(seq(`${UI}/glass`, 6), { volume: 0.6 }),

  // --- memoryMatch ---
  'card.flip': sample(seq(`${UI}/scroll`, 5), { volume: 0.5 }),
  'card.match': sample(seq(`${UI}/confirmation`, 4), { volume: 0.6 }),
  'card.nomatch': sample(seq(`${UI}/error`, 4), { volume: 0.35 }),

  // --- basketBounce ---
  'throw.whoosh': synth('whoosh', { volume: 0.6 }),
  'basket.rim': sample(seq(`${IMP}/impactMetal_light`, 5, 0), { volume: 0.6 }),
  'basket.board': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.6 }),
  'basket.score': sample(seq(`${UI}/confirmation`, 4), { volume: 0.7, haptic: 'light' }),
  'basket.swish': synth('sparkle', { volume: 0.7, haptic: 'light' }),

  // --- pancakeTower ---
  'pancake.drop': synth('whooshDown', { volume: 0.55 }),
  'pancake.land': sample(seq(`${IMP}/footstep_carpet`, 5, 0), { volume: 0.7, haptic: 'light' }),
  'pancake.slice': synth('slice', { volume: 0.6 }),
  'pancake.perfect': sample(seq(`${UI}/glass`, 6), { volume: 0.7, haptic: 'light' }),
  'pancake.topping': synth('sparkle', { volume: 0.6 }),
  'pancake.miss': sample(seq(`${UI}/error`, 4), { volume: 0.4 }),

  // --- danceParty (kept snappy — they play over the 100 BPM track) ---
  'dance.perfect': synth('blipHigh', { volume: 0.6, haptic: 'light' }),
  'dance.good': synth('blipMid', { volume: 0.5 }),
  'dance.miss': synth('sadBlip', { volume: 0.35 }),
  'dance.tapEmpty': sample(seq(`${UI}/click`, 5), { volume: 0.25 }),
  'dance.tierUp': sample(seq(`${UI}/maximize`, 9), { volume: 0.55 }),
  'dance.fever': synth('riser', { volume: 0.7, haptic: 'medium' }),

  // --- fishingPond ---
  'fish.cast': synth('plop', { volume: 0.6 }),
  'fish.hook': sample([`${UI}/pluck_001`, `${UI}/pluck_002`], { volume: 0.7, haptic: 'light' }),
  'fish.reelTap': sample([`${UI}/tick_001`, `${UI}/tick_002`, `${UI}/tick_004`], { volume: 0.5 }),
  'fish.catch': sample(seq(`${UI}/confirmation`, 4), { volume: 0.7, haptic: 'light' }),
  'fish.bigOne': sample(seq(`${UI}/question`, 4), { volume: 0.7 }),
  'fish.boot': synth('sadBlip', { volume: 0.55 }),
  'fish.escape': sample(seq(`${UI}/minimize`, 9), { volume: 0.5 }),

  // --- bubblePop ---
  'bubble.pop': synth('bubblePop', { volume: 0.6, haptic: 'light' }),
  'bubble.wrong': sample(seq(`${UI}/error`, 4), { volume: 0.4 }),
  'bubble.spiky': sample(seq(`${UI}/glitch`, 4), { volume: 0.45 }),
  'bubble.newTarget': sample(seq(`${UI}/question`, 4), { volume: 0.55 }),

  // --- trampoline ---
  'tramp.bounce': synth('boing', { volume: 0.6, haptic: 'light' }),
  'tramp.boost': synth('boingBig', { volume: 0.7, haptic: 'light' }),
  'tramp.armed': sample([`${UI}/tick_001`, `${UI}/tick_002`, `${UI}/tick_004`], { volume: 0.4 }),
  'tramp.trick': synth('sparkle', { volume: 0.6 }),
  'tramp.tierUp': sample(seq(`${UI}/maximize`, 9), { volume: 0.55 }),
  'tramp.butt': sample(seq(`${IMP}/impactPunch_medium`, 5, 0), { volume: 0.65, haptic: 'medium' }),

  // --- polish (G14) ---
  'hud.lowTick': synth('softTick', { volume: 0.3 }),
});

/**
 * Definition for a semantic sfx id.
 * @param {string} id
 * @returns {SfxDef|undefined}
 */
export function getSfxDef(id) {
  return SFX_MAP[id];
}

/** @returns {string[]} all mapped ids */
export function allSfxIds() {
  return Object.keys(SFX_MAP);
}

/** @returns {string[]} every distinct sample asset key used by the map */
export function allSampleKeys() {
  const keys = new Set();
  for (const def of Object.values(SFX_MAP)) {
    if (def.kind === 'sample') for (const k of def.keys) keys.add(k);
  }
  return [...keys];
}
