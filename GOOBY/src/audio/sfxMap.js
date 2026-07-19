// SFX map (§D6 agent G14; V3/G32 reworked per PLAN3 §B2/§C3/§D3.5): semantic
// sfx id → sound definition. Three kinds:
//   sample — Kenney ogg(s) by asset key ('<pack>/<file-no-ext>', resolved via
//            core/assets.js getAudioUrl). Multiple keys = random-from-set.
//   synth  — procedural WebAudio recipe by name (implemented in audio.js).
//   voice  — Gooby voice recipe by name (implemented in goobyVoice.js);
//            loop:true ids keep playing until audio.stop(id).
// Optional per-id fields: volume 0..1 (default 1), haptic 'light'|'medium'
// (guarded native impact alongside the sound — §D6 haptics), loop,
// V3/G32: rate (sample playbackRate multiplier, e.g. the §C3.1 pitched jump),
// throttleMs (drop repeat plays inside the window — ui.slider's 80 ms §D3.5),
// bus ('ambience' forces the ambience bus — see busFor()).
//
// V3/G32 bus routing (§B2.1): master ← { sfx, music, voice, ambience }.
// sample/synth defs play on the SFX bus, voice defs on the VOICE bus, and
// loop:true `ambience.*` ids on the AMBIENCE bus (busFor() below is the
// single routing rule audio.js consults). Mute semantics (§C2.3): the
// settings.sfx boolean mutes sfx+voice, settings.music mutes music+ambience.
//
// V4/G78 sample sweep (PLAN4 §C-SYS1.9): all 46 formerly synthesized
// non-voice one-shots in the binding replacement table are real-file backed.
// The exact remaining synth set is pinned by test/audioCoverage.test.js:
// 9 impossible-to-source one-shots plus the 3 seamless loop recipes. Gooby
// voice ids remain in goobyVoice.js; danceParty's synth TRACK stays separate
// under its BPM/PATTERN_SEED contract, but its hit blips are samples now.
// NOTE (§C3.1 substitution): the pop family is speced to
// impact-sounds/impactSoft_medium_* — those files were not committed by the
// §D3 pipeline wave, so the pops map to the committed same-pack equivalent
// impactGeneric_light_* (logged in the V3/G32 report).
//
// V3/G32 loudness pass (§B2.5/§C3.5): scripts/audio-loudness.mjs measured the
// mean RMS of every committed ogg into src/audio/loudness.json; volumes below
// were recomputed ONCE as min(previous hand-mix intent, trim-to-target)
// (targets: one-shots −16 dBFS, jingles −18, loops −20) and the §C3.5
// offender table values are pinned verbatim (eat.chomp 0.5, crash 0.6,
// mole.bonk 0.6, photo.shutter 0.6, gooby.snore 0.55, hopper.crash 0.6,
// jingle.levelUp/daily 0.65, golf.ace 0.6, delivery.drop 0.6, tramp.butt
// 0.55, dance.fever 0.55, ui.go 0.6).
//
// Coverage contract: EVERY id passed to audio.play() anywhere in src/ MUST be
// mapped here — test/onboarding.test.js scans the source tree and fails on
// unmapped ids; audio.js also console.warns in dev builds.
//
// Pure data: no three.js/DOM imports (node:test runs this headlessly).

/** @typedef {{kind: 'sample', keys: string[], volume?: number, haptic?: string, rate?: number, throttleMs?: number}} SampleDef */
/** @typedef {{kind: 'synth', name: string, volume?: number, haptic?: string, loop?: boolean, pitch?: number, bus?: string}} SynthDef */
/** V2/G26: synth loop:true ids resolve via audio.js LOOP_RECIPES (run until audio.stop(id)). */
/** V2/G29: synth defs may carry `pitch` — a frequency multiplier for pitch-aware
 * recipes (audio.js), e.g. the four goobySays pads share one 'saysPad' recipe. */
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

/** V3/G32: unpadded numbered set — casino-audio/ui-audio name like chip-lay-1. */
function seqN(prefix, count, from = 1) {
  const keys = [];
  for (let i = 0; i < count; i += 1) keys.push(`${prefix}${from + i}`);
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
const UIA = 'ui-audio'; // V3/G32 (§D3.2)
const UIP = 'ui-pack-sounds'; // V3/G32 (§D3.3)
const CAS = 'casino-audio'; // V3/G32 (§D3.4)
const ITCH = 'itch-sfx'; // V4/G78 (§C-SYS1.9): ObsydianX CC0 flat OGG root

/**
 * The complete sfx id → definition table (§D6 + PLAN3 §C3.1/§D3.5: ui taps
 * from interface-sounds, toggles/sliders from ui-audio, tabs/CTAs from
 * ui-pack-sounds, coins/cards from casino-audio, bonks/crashes/pops from
 * impact-sounds, jingles/stingers from music-jingles; Gooby voice + the
 * whitelisted juice blips stay synthesized).
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
  'ui.go': sample(seq(`${UI}/confirmation`, 4), { volume: 0.6, haptic: 'light' }), // §C3.5: 0.75→0.6 (GO louder than 3-2-1)
  'ui.win': sample([`${JIN}/jingles_HIT16`], { volume: 0.7 }), // V3/G32 §C3.1: was synth winArp
  // V3/G32 §D3.5 NEW ids (G33's settings rows + shared UI chrome call these):
  'ui.toggleOn': sample([`${UIA}/switch1`], { volume: 0.8, haptic: 'light' }),
  'ui.toggleOff': sample([`${UIA}/switch2`], { volume: 0.8, haptic: 'light' }),
  'ui.slider': sample(seqN(`${UIA}/rollover`, 3), { volume: 0.7, throttleMs: 80 }),
  'ui.tabSwitch': sample([`${UIP}/tap-a`, `${UIP}/tap-b`], { volume: 0.7, haptic: 'light' }),
  // V3/FIX-B (E19 P2): 0.9→0.75 — click-a peaked −5.9 dBFS at default sliders,
  // breaching the §C3.5 −6 dBFS acceptance bar by one frame.
  'ui.confirmBig': sample([`${UIP}/click-a`], { volume: 0.75, haptic: 'light' }),

  // --- coins / economy (V3/G32 §C3.1: real casino chips) ---
  'coin.get': sample(seqN(`${CAS}/chip-lay-`, 3), { volume: 0.9, haptic: 'light' }), // was synth coin
  'coin.fly': sample(seqN(`${CAS}/chips-collide-`, 4), { volume: 0.7 }), // was synth coin
  'coin.spend': sample(seq(`${UI}/drop`, 4), { volume: 0.6 }),

  // --- jingles (music-jingles NES set — level-up/achievement/daily §D6; the
  // NES mappings stay per §C3.3, volumes renormalized to the −18 dBFS jingle
  // target per §B2.5 loudness.json trims + §C3.5 pins) ---
  'jingle.levelUp': sample([`${JIN}/jingles_NES03`], { volume: 0.65 }), // §C3.5: 0.75→0.65
  'jingle.achievement': sample([`${JIN}/jingles_NES05`], { volume: 0.68 }),
  'jingle.daily': sample([`${JIN}/jingles_NES09`], { volume: 0.65 }), // §C3.5: 0.75→0.65
  'jingle.arrival': sample([`${JIN}/jingles_NES04`], { volume: 0.62 }),
  'jingle.outfit': sample([`${JIN}/jingles_NES07`], { volume: 0.62 }),
  'jingle.short': sample([`${JIN}/jingles_NES11`], { volume: 0.6 }),
  // V3/G32 §C3.3: context-aware results stingers (framework picks by outcome;
  // 'jingle.results' stays mapped as a legacy alias of the normal stinger).
  'jingle.resultsBest': sample([`${JIN}/jingles_HIT15`], { volume: 0.75 }),
  'jingle.resultsNormal': sample([`${JIN}/jingles_HIT10`], { volume: 0.65 }),
  'jingle.resultsZero': sample([`${JIN}/jingles_HIT08`], { volume: 0.6 }),
  'jingle.results': sample([`${JIN}/jingles_HIT10`], { volume: 0.65 }),

  // --- Gooby voice (synthesized — §D6 goobyVoice.js; §A3: his identity) ---
  'gooby.squeak': voice('squeak'),
  'gooby.squeakHappy': voice('squeakHappy'),
  'gooby.squeakDizzy': voice('squeakDizzy'),
  'gooby.purr': voice('purr', { volume: 0.8 }),
  'gooby.giggle': voice('giggle'),
  'gooby.refuse': voice('refuse'),
  'gooby.sniff': voice('sniff', { volume: 0.7 }),
  'gooby.snore': voice('snore', { loop: true, volume: 0.55 }), // §C3.5: 0.8→0.55 (loud all night)
  'gooby.yawn': voice('yawn'),

  // --- care interactions (§C3) ---
  'eat.chomp': sample(seq(`${IMP}/footstep_grass`, 5, 0), { volume: 0.5 }), // §C3.5: 0.8→0.5 (plays 5×/feed)
  'wash.scrub': sample(seq(`${UI}/scratch`, 5), { volume: 0.35 }),
  'wash.splash': synth('splash', { volume: 0.7 }),
  'toilet.flush': synth('flush', { volume: 0.7 }),
  'ball.throw': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.5, rate: 1.15 }),
  'ball.bounce': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.55, haptic: 'light' }),

  // --- city drive (§C4/§C6.1 #1) ---
  bump: sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.7 }),
  crash: sample(seq(`${IMP}/impactMetal_heavy`, 5, 0), { volume: 0.6, haptic: 'medium' }), // §C3.5: 0.8→0.6
  bonk: sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.65, haptic: 'light' }),
  tow: sample(seq(`${ITCH}/back_style_3`, 3), { volume: 0.6 }),

  // --- runner ---
  whoosh: sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.5, rate: 1 }),
  // V3/G32 §C3.1: real grass footstep pitched up 1.3× via playbackRate
  jump: sample(seq(`${IMP}/footstep_grass`, 5, 0), { volume: 0.8, rate: 1.3 }),
  slide: sample(seq(`${UI}/scratch`, 5), { volume: 0.4 }),
  'crash.soft': sample(seq(`${IMP}/impactMetal_light`, 5, 0), { volume: 0.6, haptic: 'light' }),
  'combo.up': sample(seq(`${UI}/glass`, 6), { volume: 0.5 }),

  // --- carrotCatch ---
  // V3/G32 §C3.1 pop family → real impacts (impactSoft_* not committed —
  // impactGeneric_light_* is the same-pack substitute, see header note)
  'catch.good': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.65, haptic: 'light' }),
  'catch.bad': sample(seq(`${UI}/error`, 4, 5), { volume: 0.5, haptic: 'medium' }),

  // --- bunnyHop ---
  'hop.flap': sample(seq(`${IMP}/footstep_carpet`, 5, 0), { volume: 0.5 }),
  'hop.gate': sample(seq(`${UI}/glass`, 6), { volume: 0.5 }),
  'hop.crash': sample(seq(`${IMP}/impactPunch_medium`, 5, 0), { volume: 0.7, haptic: 'medium' }),

  // --- carrotGuard ---
  'mole.bonk': sample(seq(`${IMP}/impactPunch_heavy`, 5, 0), { volume: 0.6, haptic: 'light' }), // §C3.5: 0.8→0.6
  'mole.pop': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.5 }), // V3/G32 §C3.1 pop family
  'mole.whiff': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.3, rate: 1.3 }),
  'mole.steal': sample(seq(`${UI}/minimize`, 3), { volume: 0.5 }), // V3/G32 sweep: descending UI slide
  'mole.combo': sample(seq(`${UI}/glass`, 6), { volume: 0.6 }),

  // --- memoryMatch (V3/G32 §D3.5: real card sounds) ---
  'card.flip': sample(seqN(`${CAS}/card-slide-`, 3), { volume: 0.8 }),
  'card.match': sample(seqN(`${CAS}/card-place-`, 2), { volume: 0.8 }),
  'card.nomatch': sample(seq(`${UI}/error`, 4), { volume: 0.35 }),

  // --- basketBounce ---
  'throw.whoosh': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.55, rate: 1.1 }),
  'basket.rim': sample(seq(`${IMP}/impactMetal_light`, 5, 0), { volume: 0.6 }),
  'basket.board': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.6 }),
  'basket.score': sample(seq(`${UI}/confirmation`, 4), { volume: 0.7, haptic: 'light' }),
  'basket.swish': sample(seq(`${ITCH}/confirm_style_1`, 3), { volume: 0.7, haptic: 'light' }),

  // --- pancakeTower ---
  'pancake.drop': sample(seq(`${UI}/minimize`, 3, 4), { volume: 0.5 }),
  'pancake.land': sample(seq(`${IMP}/footstep_carpet`, 5, 0), { volume: 0.7, haptic: 'light' }),
  'pancake.slice': sample(seq(`${UI}/scratch`, 5), { volume: 0.6, rate: 1.3 }),
  'pancake.perfect': sample(seq(`${UI}/glass`, 6), { volume: 0.7, haptic: 'light' }),
  'pancake.topping': sample(seq(`${UI}/glass`, 6), { volume: 0.6 }),
  'pancake.miss': sample(seq(`${UI}/error`, 4), { volume: 0.4 }),

  // --- danceParty (real hit samples over the unchanged 100 BPM synth TRACK) ---
  'dance.perfect': sample([`${ITCH}/cursor_style_2`], { volume: 0.6, rate: 1.2, haptic: 'light' }),
  'dance.good': sample([`${ITCH}/cursor_style_2`], { volume: 0.5, rate: 1 }),
  'dance.miss': sample(seq(`${ITCH}/back_style_2`, 3), { volume: 0.35 }),
  'dance.tapEmpty': sample(seq(`${UI}/click`, 5), { volume: 0.25 }), // §C3.1: stays sample
  'dance.tierUp': sample(seq(`${UI}/maximize`, 9), { volume: 0.55 }),
  'dance.tierUpAccent': sample([`${JIN}/jingles_HIT00`], { volume: 0.6 }), // V3/G32 §C3.4: HIT00 accent (sfx bus)
  'dance.fever': sample(seq(`${UI}/maximize`, 4), { volume: 0.55, haptic: 'medium' }),

  // --- fishingPond ---
  'fish.cast': sample(seq(`${UI}/drop`, 4), { volume: 0.6, rate: 0.8 }),
  'fish.hook': sample([`${UI}/pluck_001`, `${UI}/pluck_002`], { volume: 0.7, haptic: 'light' }),
  'fish.reelTap': sample([`${UI}/tick_001`, `${UI}/tick_002`, `${UI}/tick_004`], { volume: 0.5 }),
  'fish.catch': sample(seq(`${UI}/confirmation`, 4), { volume: 0.7, haptic: 'light' }),
  'fish.bigOne': sample(seq(`${UI}/question`, 4), { volume: 0.53 }), // §B2.5 trim: question set is hot (−10.4 dBFS)
  'fish.boot': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.55 }), // V3/G32 sweep: real boot thunk
  'fish.escape': sample(seq(`${UI}/minimize`, 9), { volume: 0.5 }),

  // --- bubblePop ---
  'bubble.pop': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.55, haptic: 'light' }), // V3/G32 §C3.1 pop family
  'bubble.wrong': sample(seq(`${UI}/error`, 4), { volume: 0.4 }),
  'bubble.spiky': sample(seq(`${UI}/glitch`, 4), { volume: 0.45 }),
  'bubble.newTarget': sample(seq(`${UI}/question`, 4), { volume: 0.53 }),

  // --- trampoline ---
  'tramp.bounce': synth('boing', { volume: 0.6, haptic: 'light' }), // §C3.1 whitelist: boing*
  'tramp.boost': synth('boingBig', { volume: 0.7, haptic: 'light' }),
  'tramp.armed': sample([`${UI}/tick_001`, `${UI}/tick_002`, `${UI}/tick_004`], { volume: 0.4 }),
  'tramp.trick': sample(seq(`${UI}/glass`, 6), { volume: 0.55 }), // V3/G32 sweep: sparkle ding
  'tramp.tierUp': sample(seq(`${UI}/maximize`, 9), { volume: 0.55 }),
  'tramp.butt': sample(seq(`${IMP}/impactPunch_medium`, 5, 0), { volume: 0.55, haptic: 'medium' }), // §C3.5: 0.65→0.55

  // --- polish (G14) ---
  'hud.lowTick': sample([`${UIA}/rollover4`], { volume: 0.5 }), // V3/G32 sweep: soft real UI tick

  // --- V2/G20: sickness & care (§C3.3/§C3.4) ---
  'health.sneeze': voice('sneeze', { volume: 0.9 }), // V2/G29: real sneeze (windup+achoo+sniffle tail)

  // --- V2/G21: vet clinic + landmarks (§C9; all real samples after V4/G78) ---
  'vet.doorbell': sample(seq(`${IMP}/impactBell_heavy`, 5, 0), { volume: 0.5 }), // V3/G32 sweep: real bell
  'vet.cure': sample(seq(`${ITCH}/confirm_style_6`, 2), { volume: 0.75, haptic: 'light' }),
  'vet.checkup': sample(seq(`${UI}/question`, 4), { volume: 0.45 }), // V3/G32 sweep: friendly two-tone chime
  'landmark.found': sample([`${JIN}/jingles_HIT01`], { volume: 0.65, haptic: 'light' }), // V3/G32 sweep: HIT stinger

  // --- V2/G19: garden (§C2.2; V4/G78 real soil/harvest samples) ---
  'garden.plant': sample(seq(`${IMP}/footstep_grass`, 5, 0), { volume: 0.65, rate: 0.7, haptic: 'light' }),
  'garden.water': synth('trickle', { volume: 0.6 }), // V2/G29: watering-can burbles + droplets
  'garden.fertilize': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.5, rate: 0.5 }),
  'garden.harvest': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.65, rate: 1.15, haptic: 'light' }),
  'garden.harvestReady': sample(seq(`${UI}/glass`, 6), { volume: 0.4 }), // V3/G32 sweep: gentle glisten ding
  'garden.buy': sample(seq(`${UI}/drop`, 4), { volume: 0.6 }),
  'garden.sell': sample(seqN(`${CAS}/chips-stack-`, 2), { volume: 0.85, haptic: 'light' }), // V3/G32 sweep: chip cash-in

  // --- V2/G23: progression UI (§C5/§C6/§C12; real samples throughout) ---
  'quest.claim': sample([`${JIN}/jingles_HIT02`], { volume: 0.7, haptic: 'light' }), // V3/G32 sweep: real triumph
  'sticker.get': sample(seq(`${ITCH}/confirm_style_4`, 3), { volume: 0.7, haptic: 'light' }),
  'album.claim': sample([`${JIN}/jingles_HIT13`], { volume: 0.75, haptic: 'light' }),
  'photo.shutter': sample([`${UIA}/mouseclick1`], { volume: 0.7, rate: 0.9, haptic: 'medium' }),

  // --- V2/G24: goobySays pads — ONE real sample, playbackRate-pitched C-D-E-G ---
  'says.pad1': sample([`${ITCH}/cursor_style_4`], { volume: 0.7, rate: 1, haptic: 'light' }), // C5
  'says.pad2': sample([`${ITCH}/cursor_style_4`], { volume: 0.7, rate: 1.125, haptic: 'light' }), // D5
  'says.pad3': sample([`${ITCH}/cursor_style_4`], { volume: 0.7, rate: 1.25, haptic: 'light' }), // E5
  'says.pad4': sample([`${ITCH}/cursor_style_4`], { volume: 0.7, rate: 1.5, haptic: 'light' }), // G5
  // --- end V2/G24 ---

  // --- V2/G25: starHopper + pipeFlow (§C1.2 #8/#9; only water stays synth) ---
  'hopper.lane': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.4, rate: 1.25 }),
  'hopper.star': sample(seq(`${IMP}/impactPlate_light`, 5, 0), { volume: 0.6, haptic: 'light' }), // V3/G32 sweep: crystal ding
  'hopper.gold': sample(seq(`${UI}/glass`, 6), { volume: 0.7, rate: 1.3, haptic: 'light' }),
  'hopper.shield': sample(seq(`${UI}/maximize`, 4, 5), { volume: 0.6, haptic: 'light' }),
  'hopper.shieldPop': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.7, haptic: 'medium' }), // V3/G32 §C3.1 pop family
  'hopper.warning': sample(seq(`${UI}/error`, 4), { volume: 0.4 }),
  'hopper.crash': sample(seq(`${IMP}/impactPunch_heavy`, 5, 0), { volume: 0.6, haptic: 'medium' }), // §C3.5: 0.75→0.6
  'pipe.rotate': sample(seq(`${UI}/scroll`, 5), { volume: 0.5, haptic: 'light' }),
  'pipe.connect': sample(seq(`${ITCH}/confirm_style_5`, 3), { volume: 0.7, haptic: 'light' }),
  'pipe.fill': synth('trickle', { volume: 0.4, pitch: 0.8 }), // V2/G29: water fill (no CC0 fit)
  // --- end V2/G25 ---

  // --- V2/G26: ambience loops (§C10.2 dawn birdsong / §C11.2 rain-on-leaves;
  // loop recipes live in audio.js LOOP_RECIPES; V3/G32 §B2.1: these route to
  // the AMBIENCE bus and mute with the settings.music boolean §C2.3) ---
  // rain: brown noise → LP 800 Hz at −18 dB — level baked into the recipe.
  'ambience.rain': synth('rainLoop', { loop: true, bus: 'ambience' }),
  'ambience.birdsong': synth('birdsong', { loop: true, volume: 0.8, bus: 'ambience' }),
  // --- end V2/G26 ---

  // --- V2/G27: veggieChop + goalieGooby (§C1.2 #4/#7; only cheer stays synth) ---
  'chop.lob': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.3, rate: 1.2 }),
  'chop.slice': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.7, rate: 1.25, haptic: 'light' }),
  'chop.combo': sample(seq(`${UI}/glass`, 6), { volume: 0.6, haptic: 'light' }),
  'chop.junk': sample(seq(`${IMP}/footstep_grass`, 5, 0), { volume: 0.65, rate: 0.55, haptic: 'medium' }),
  'chop.miss': sample(seq(`${UI}/minimize`, 3, 4), { volume: 0.5 }), // V3/G32 sweep
  'goalie.dive': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.6, rate: 0.7 }),
  'goalie.kick': sample(seq(`${IMP}/impactPunch_medium`, 5, 0), { volume: 0.55 }),
  'goalie.save': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.7, haptic: 'light' }),
  'goalie.super': sample(seq(`${UI}/maximize`, 4), { volume: 0.7, haptic: 'medium' }),
  'goalie.goal': sample(seq(`${UI}/minimize`, 3, 7), { volume: 0.55 }), // V3/G32 sweep: crowd deflates
  'goalie.cheer': synth('bunnyCheer', { volume: 0.7, haptic: 'light' }), // V2/G29: bunny crowd (no CC0 fit)
  // --- end V2/G27 ---

  // --- V2/G29: audio & reactions 2.0 ids (voice set + real object samples) ---
  'hop.bell': sample(seq(`${IMP}/impactBell_heavy`, 5, 0), { volume: 0.35, rate: 1.8, haptic: 'light' }),
  'gooby.hiccup': voice('hiccup', { volume: 0.8 }),
  'gooby.sniffle': voice('sniffle', { volume: 0.65 }),
  'gooby.sigh': voice('contentSigh', { volume: 0.7 }),
  'gooby.brrr': voice('brrr', { volume: 0.75 }),
  'gooby.gasp': voice('delightedGasp', { volume: 0.8 }),
  'golf.putt': sample(seq(`${IMP}/footstep_wood`, 5, 0), { volume: 0.55, haptic: 'light' }), // V3/G32 sweep: wooden tock
  'golf.sink': sample(seqN(`${CAS}/chip-lay-`, 3), { volume: 0.7, rate: 0.85, haptic: 'light' }),
  'delivery.drop': sample(seq(`${IMP}/impactPlate_light`, 5, 0), { volume: 0.6, rate: 1.1, haptic: 'medium' }),
  'delivery.doorbell': sample(seq(`${IMP}/impactBell_heavy`, 5, 0), { volume: 0.55 }), // V3/G32 sweep: real bell
  // --- end V2/G29 ---

  // --- V2/G28: miniGolf extras (§C1.2 #6) ---
  'golf.ace': sample([`${JIN}/jingles_NES11`], { volume: 0.6, haptic: 'medium' }), // §C3.5: 0.75→0.6 (NES11 is hot)
  'golf.bank': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.4 }),
  'golf.bump': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.5, rate: 1.35, haptic: 'light' }),
  // --- end V2/G28 ---

  // --- V3/G36: purblePlace / Tortenwerkstatt (PLAN3 §C9; real samples) ---
  'cake.apply': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.6, haptic: 'light' }), // component lands on the belt cake
  'cake.ovenDing': sample(seq(`${IMP}/impactBell_heavy`, 5, 0), { volume: 0.5 }), // oven release ding (real bell)
  'cake.splat': sample(seq(`${IMP}/footstep_grass`, 5, 0), { volume: 0.65, rate: 0.55, haptic: 'medium' }),
  'cake.serve': sample(seqN(`${CAS}/chips-stack-`, 2), { volume: 0.8, haptic: 'light' }), // accepted serve cash-in
  'cake.candle': sample([`${UI}/tick_001`, `${UI}/tick_002`, `${UI}/tick_004`], { volume: 0.55 }), // candle dropper tick
  'cake.order': sample(seq(`${UI}/question`, 4), { volume: 0.5 }), // new customer order chime
  // --- end V3/G36 ---

  // --- V3/G41: toyRacer + ghostHunt (PLAN3 §C10.1 #1/#2; real samples) ---
  'racer.putter': sample(seq(`${IMP}/footstep_carpet`, 5, 0), { volume: 0.22, rate: 1.5, throttleMs: 120 }), // toy engine put-put
  'racer.drift': sample(seq(`${UI}/scratch`, 5), { volume: 0.3, throttleMs: 260 }), // tyre squeal on the rug
  'racer.boost': sample(seq(`${UI}/maximize`, 4, 5), { volume: 0.6, haptic: 'light' }),
  'racer.item': sample(seqN(`${CAS}/card-slide-`, 3), { volume: 0.7, haptic: 'light' }), // item-box roulette
  'racer.shield': sample(seq(`${UI}/glass`, 6), { volume: 0.6 }),
  'racer.block': sample(seq(`${UI}/minimize`, 3), { volume: 0.55 }),
  'racer.blockHit': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.65, haptic: 'medium' }), // kart bonks a block
  'racer.lap': sample(seq(`${UI}/confirmation`, 4), { volume: 0.6 }),
  'racer.overtake': sample(seq(`${UI}/glass`, 6), { volume: 0.55 }),
  'racer.offtrack': sample(seq(`${IMP}/footstep_grass`, 5, 0), { volume: 0.45, rate: 0.8, throttleMs: 350 }), // carpet rumble
  'hunt.spawn': sample(seq(`${UI}/open`, 4), { volume: 0.3 }), // ghost peeks up
  'hunt.catch': sample(seq(`${IMP}/impactGeneric_light`, 5, 0), { volume: 0.7, haptic: 'light' }), // §C3.1 pop family
  'hunt.chain': sample(seq(`${UI}/glass`, 6), { volume: 0.55 }), // chain-link ding
  'hunt.decoy': sample(seq(`${UI}/error`, 4), { volume: 0.45, haptic: 'medium' }), // decoy penalty
  'hunt.gone': sample(seq(`${UI}/minimize`, 3), { volume: 0.28 }), // missed peek sinks away
  'hunt.boo': sample(seq(`${UI}/maximize`, 4), { volume: 0.5, rate: 0.8 }),
  'hunt.booBonus': sample(seqN(`${CAS}/chips-stack-`, 2), { volume: 0.8, haptic: 'light' }), // ≥4-catch payout
  'hunt.powerup': sample(seq(`${ITCH}/confirm_style_1`, 3, 4), { volume: 0.7, haptic: 'light' }),
  'hunt.token': sample([`${UI}/pluck_001`, `${UI}/pluck_002`], { volume: 0.55 }), // token appears
  // --- end V3/G41 ---

  // --- V3/G42: rocketRescue + harborHopper (PLAN3 §C10.1 #3/#4; only the
  // seamless thrust loop, bunny pickup voice-crowd and ship horn stay synth) ---
  'rocket.thrust': synth('rainLoop', { loop: true, volume: 0.45 }), // brown-noise rumble reads as engine thrust (existing loop recipe; sfx bus — not ambience.*)
  'rocket.land.soft': sample(seq(`${UI}/drop`, 4), { volume: 0.55, haptic: 'light' }), // skids touch down
  'rocket.land.hard': sample(seq(`${IMP}/impactMetal_heavy`, 5, 0), { volume: 0.5, haptic: 'medium' }), // hull clang + bounce
  'rocket.pickup': synth('bunnyCheer', { volume: 0.8, haptic: 'light' }), // bunny squeak aboard (existing recipe)
  'rocket.rescue': sample(seq(`${UI}/confirmation`, 4), { volume: 0.65, haptic: 'light' }), // pad delivery chime
  'rocket.fuel': sample(seq(`${UI}/glass`, 6), { volume: 0.55 }), // canister clink
  'rocket.fuelLow': sample(seq(`${UI}/error`, 4), { volume: 0.4 }), // ≤20 fuel warning
  'rocket.tow': sample(seq(`${UI}/minimize`, 3), { volume: 0.4 }), // fuel-out power-down → tow
  'rocket.wind': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.6, rate: 0.85 }),
  'harbor.crate': sample(seq(`${IMP}/impactPlank_medium`, 5, 0), { volume: 0.55, haptic: 'light' }), // wooden crate on deck
  'harbor.ring': sample(seq(`${UI}/select`, 8), { volume: 0.5 }), // net ring chime
  'harbor.bump': sample(seq(`${IMP}/impactMetal_light`, 5, 0), { volume: 0.6, haptic: 'medium' }), // buoy/pier clonk
  'harbor.boost': sample(seq(`${IMP}/footstep_snow`, 5, 0), { volume: 0.6, rate: 0.7 }),
  'harbor.horn': synth('doorbell', { pitch: 0.3, volume: 0.9, haptic: 'medium' }), // Fischkutter-Horn: low two-tone blast (pitched existing recipe)
  'harbor.hornEmpty': sample(seq(`${UI}/back`, 4), { volume: 0.4 }), // out of charges
  'harbor.gullWarn': sample(seq(`${UI}/question`, 4), { volume: 0.6 }), // honk warning chirp
  'harbor.gullSteal': sample(seq(`${UI}/scratch`, 5), { volume: 0.5 }), // crate snatched
  // --- end V3/G42 ---

  // --- V3/FIX-B (E19 P1): generic UI-vocabulary ALIASES — each resolves to
  // the SAME real samples as its §D3.5 canonical id (see the UI-INTERACTION
  // SOUND CONTRACT on UI_INTERACTION_SOUNDS below), so a play() call in
  // either spelling fires the identical cue and never warns UNMAPPED ---
  'ui.tab': sample([`${UIP}/tap-a`, `${UIP}/tap-b`], { volume: 0.7, haptic: 'light' }), // = ui.tabSwitch
  'ui.confirm': sample([`${UIP}/click-a`], { volume: 0.75, haptic: 'light' }), // = ui.confirmBig (E19 P2 trim)
  'ui.back': sample(seq(`${UI}/close`, 4), { volume: 0.55 }), // = ui.close (§D3.5: close/back share one cue)
  'ui.toggle': sample([`${UIA}/switch1`], { volume: 0.8, haptic: 'light' }), // = ui.toggleOn — prefer the on/off pair
  'ui.buy': sample(seq(`${UI}/drop`, 4), { volume: 0.6 }), // = coin.spend — buy taps outside economy.js
  'ui.claim': sample([`${JIN}/jingles_HIT02`], { volume: 0.7, haptic: 'light' }), // = quest.claim stinger
  // --- end V3/FIX-B ---
});

/**
 * Definition for a semantic sfx id.
 * @param {string} id
 * @returns {SfxDef|undefined}
 */
export function getSfxDef(id) {
  return SFX_MAP[id];
}

/**
 * V3/G32 (§B2.1): which bus a def plays on — the single routing rule.
 * sample/synth → 'sfx', voice → 'voice', loop:true ambience.* ids (or an
 * explicit def.bus) → 'ambience'. Music never routes through here (the
 * medley director + sequencer own the music bus).
 * @param {string} id
 * @param {SfxDef} def
 * @returns {'sfx'|'voice'|'ambience'}
 */
export function busFor(id, def) {
  if (def.kind === 'voice') return 'voice';
  if (def.bus === 'ambience' || (def.loop && id.startsWith('ambience.'))) return 'ambience';
  return 'sfx';
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

// ---------------------------------------------------------------------------
// V3/FIX-B (E19 P1) — UI-INTERACTION SOUND CONTRACT
// ---------------------------------------------------------------------------
// THE binding interaction-type → sfx-id map for every UI surface (extends the
// PLAN3 §D3.5 table; E19 found 74 actionable silent surfaces + semantic
// drift). UI agents: call `audio.play(UI_INTERACTION_SOUNDS.<type>)` — or the
// literal id — per this table. All ids below are real-sample-backed.
//
//   tap        'ui.tap'        any generic button (dev-panel buttons, pause/
//                              resume, HUD chips, reroll, filters…)
//   open       'ui.open'       opening a panel/screen/sheet (incl. care sheet)
//   close      'ui.close'      close/back/dismiss: Back buttons, panel ✕,
//                              BACKDROP dismissals, travel "Später"/"Nein",
//                              framework Quit, results → Home
//   pick       'ui.pick'       selecting an item/tile in a grid or list:
//                              ARCADE GAME TILES, food/outfit/skin/sticker
//                              select, photo pose/emotion/frame, language +
//                              uiScale + dev health/weather/band segments
//   tab        'ui.tabSwitch'  tab strips + view switchers: shop/wardrobe/
//                              album-collection tabs, ROOM-NAV dots + arrows
//   toggleOn   'ui.toggleOn'   toggle flips ON  (settings + dev panel)
//   toggleOff  'ui.toggleOff'  toggle flips OFF — for the SFX toggle call
//                              play('ui.toggleOff') BEFORE writing
//                              settings.sfx=false or the gate eats it (E19)
//   slider     'ui.slider'     slider drag tick (80 ms throttle built in);
//                              on release use audio.previewBus(bus) for the 5
//                              volume sliders, 'ui.pick' for other sliders
//   confirm    'ui.confirmBig' primary CTA: Kaufen/Los!/Play-Again/big claims
//   buy        'coin.spend'    a purchase lands (economy.js already fires it;
//                              don't double-fire on the same tap)
//   claim      'quest.claim'   claiming an earned reward (quest/collection)
//   stepper    'ui.count'      quantity −/+ steppers (shop buy bar)
//   error      'ui.error'      refused/invalid action (can't afford, locked)
//
// Aliases 'ui.tab'/'ui.confirm'/'ui.back'/'ui.toggle'/'ui.buy'/'ui.claim'
// (mapped above) fire the SAME samples as their canonical ids, so either
// spelling is safe — prefer the canonical ids in new code.

/**
 * The contract table (frozen): interaction type → canonical sfx id.
 * @type {Readonly<Record<string, string>>}
 */
export const UI_INTERACTION_SOUNDS = Object.freeze({
  tap: 'ui.tap',
  open: 'ui.open',
  close: 'ui.close',
  back: 'ui.close',
  pick: 'ui.pick',
  tab: 'ui.tabSwitch',
  toggleOn: 'ui.toggleOn',
  toggleOff: 'ui.toggleOff',
  slider: 'ui.slider',
  confirm: 'ui.confirmBig',
  buy: 'coin.spend',
  claim: 'quest.claim',
  stepper: 'ui.count',
  error: 'ui.error',
});

/**
 * V3/FIX-B (E19 P1): tiny helper — the canonical sfx id for a UI interaction
 * type (see the contract block above). Unknown types fall back to 'ui.tap' so
 * a sound always fires.
 * @param {string} interaction e.g. 'tab', 'confirm', 'back', 'stepper'
 * @returns {string} a mapped sfx id — pass straight to audio.play()
 */
export function uiSoundFor(interaction) {
  return UI_INTERACTION_SOUNDS[interaction] ?? 'ui.tap';
}

// --- V4/G67 (PLAN4-GAMES §G4.5): `ambience.windRun` — INTENTIONALLY not
// mapped yet. shoppingSurf's wind-rush layer feature-probes getSfxDef(
// 'ambience.windRun') and stays dormant until the id exists. The committed
// packs (itch-sfx, Kenney impact/interface) contain NO loopable wind sample,
// and §C-SYS1.9.2 direction forbids a new synth recipe — the sample request
// is filed in public/assets/GoobyMusic/requests.md. When it lands, map:
//   'ambience.windRun': sample(['<pack>/<wind-loop-key>'], { volume: 0.5, loop: true }),
// (loop:true + the ambience.* prefix auto-routes it to the AMBIENCE bus via
// busFor; the game drives intensity via audio.setLoopGain — §E0.1-16.)
// --- end V4/G67 ---
