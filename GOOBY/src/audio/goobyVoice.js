// Gooby voice (§D6, agent G14) — 100% WebAudio-synthesized rabbit noises, so
// Gooby never sounds like a stock sample:
//   squeak — sine 600–900 Hz with a fast up-down pitch envelope + slight
//            vibrato (the poke/pet reaction)
//   giggle — 3–5 staccato squeaks descending (tickle)
//   snore  — loop: filtered brown-ish noise breaths + an 80 Hz sine swell
//   yawn   — 400→200 Hz glide with droopy vibrato (wake-up)
// plus flavour variants (squeakHappy/squeakDizzy/purr/refuse/sniff).
// Every call randomizes pitch ±10% (§D6) so it never repeats exactly.
//
// Recipes receive (ctx, dest, opts) — an AudioContext and the destination bus
// (audio.js's voice gain). Loop recipes return { stop() }; one-shots return
// nothing. Pure functions of the audio graph: no DOM/three imports, and no
// AudioContext is created here (audio.js owns the context + gesture unlock).

/** ±10% random pitch multiplier (§D6). */
function jitter() {
  return 0.9 + Math.random() * 0.2;
}

/** Shared 1 s white-noise buffer per context (cached on the ctx object). */
function noiseBuffer(ctx) {
  if (!ctx._goobyNoise) {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    ctx._goobyNoise = buf;
  }
  return ctx._goobyNoise;
}

/**
 * One squeak syllable: sine with pitch envelope + vibrato through its own gain.
 * @param {AudioContext} ctx @param {AudioNode} dest
 * @param {{at?: number, f0?: number, f1?: number, f2?: number, dur?: number, vol?: number, vib?: number}} o
 */
function squeakSyllable(ctx, dest, o = {}) {
  const at = o.at ?? ctx.currentTime;
  const dur = o.dur ?? 0.16;
  const vol = o.vol ?? 0.5;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  // pitch envelope: start → peak → settle (the classic toy-squeak contour)
  osc.frequency.setValueAtTime(o.f0 ?? 620, at);
  osc.frequency.exponentialRampToValueAtTime(o.f1 ?? 880, at + dur * 0.35);
  osc.frequency.exponentialRampToValueAtTime(o.f2 ?? 700, at + dur);
  // slight vibrato (§D6)
  const vib = ctx.createOscillator();
  vib.frequency.value = 26;
  const vibGain = ctx.createGain();
  vibGain.gain.value = (o.vib ?? 1) * 18;
  vib.connect(vibGain).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  vib.start(at);
  vib.stop(at + dur + 0.02);
}

/** Poke squeak: single bright syllable, 600–900 Hz band (§D6). */
export function squeak(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  squeakSyllable(ctx, dest, { f0: 620 * p, f1: 900 * p, f2: 720 * p, dur: 0.16, vol: 0.5 * volume });
}

/** Favorite-food/extra-happy squeak: two rising syllables. */
export function squeakHappy(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const t = ctx.currentTime;
  squeakSyllable(ctx, dest, { at: t, f0: 640 * p, f1: 860 * p, f2: 780 * p, dur: 0.13, vol: 0.45 * volume });
  squeakSyllable(ctx, dest, { at: t + 0.16, f0: 740 * p, f1: 1050 * p, f2: 900 * p, dur: 0.18, vol: 0.5 * volume });
}

/** Dizzy squeak: long wobbly syllable sagging downward. */
export function squeakDizzy(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  squeakSyllable(ctx, dest, { f0: 820 * p, f1: 620 * p, f2: 380 * p, dur: 0.5, vol: 0.45 * volume, vib: 3.5 });
}

/** Giggle: 3–5 staccato squeaks stepping down (§D6). */
export function giggle(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const n = 3 + Math.floor(Math.random() * 3); // 3–5
  const t = ctx.currentTime;
  for (let i = 0; i < n; i += 1) {
    const step = 1 - i * 0.09; // descending
    squeakSyllable(ctx, dest, {
      at: t + i * 0.105,
      f0: 780 * p * step,
      f1: 980 * p * step,
      f2: 760 * p * step,
      dur: 0.075,
      vol: 0.42 * volume,
      vib: 0.5,
    });
  }
}

/** Purr: low soft syllable with heavy slow vibrato (pet stroke). */
export function purr(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const at = ctx.currentTime;
  const dur = 0.5;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(150 * p, at);
  osc.frequency.linearRampToValueAtTime(120 * p, at + dur);
  const trem = ctx.createOscillator(); // purr flutter (amplitude modulation)
  trem.frequency.value = 22;
  const tremGain = ctx.createGain();
  tremGain.gain.value = 0.12;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.3 * volume, at + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  trem.connect(tremGain).connect(g.gain);
  osc.connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  trem.start(at);
  trem.stop(at + dur + 0.02);
}

/** Refuse: flat grumpy "uh-uh" — two low unimpressed syllables. */
export function refuse(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const t = ctx.currentTime;
  squeakSyllable(ctx, dest, { at: t, f0: 340 * p, f1: 300 * p, f2: 260 * p, dur: 0.12, vol: 0.4 * volume, vib: 0.4 });
  squeakSyllable(ctx, dest, { at: t + 0.17, f0: 300 * p, f1: 260 * p, f2: 220 * p, dur: 0.16, vol: 0.4 * volume, vib: 0.4 });
}

/** Sniff-sniff: two short filtered-noise inhales (food approaching). */
export function sniff(ctx, dest, { volume = 1 } = {}) {
  const t = ctx.currentTime;
  for (let i = 0; i < 2; i += 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900 * jitter();
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    const at = t + i * 0.18;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35 * volume, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    src.connect(bp).connect(g).connect(dest);
    src.start(at);
    src.stop(at + 0.14);
  }
}

/** Yawn: 400→200 Hz glide with droopy slow vibrato (§D6 wake). */
export function yawn(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const at = ctx.currentTime;
  const dur = 0.9;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400 * p, at);
  osc.frequency.linearRampToValueAtTime(320 * p, at + dur * 0.4);
  osc.frequency.linearRampToValueAtTime(200 * p, at + dur);
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.5;
  const vibGain = ctx.createGain();
  vibGain.gain.value = 12;
  vib.connect(vibGain).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.4 * volume, at + 0.12);
  g.gain.setValueAtTime(0.4 * volume, at + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  vib.start(at);
  vib.stop(at + dur + 0.02);
}

/**
 * Snore loop (§D6): filtered noise breaths (in louder, out softer) + an 80 Hz
 * sine swell on the inhale. Runs until stop(); breath cycle ~2.2 s to match
 * the sleep clip's breathing (§D2.4).
 * @param {AudioContext} ctx @param {AudioNode} dest
 * @param {{volume?: number}} [opts]
 * @returns {{stop: () => void}}
 */
export function snore(ctx, dest, { volume = 1 } = {}) {
  const CYCLE = 2.2;
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(dest);

  // continuous noise through a low lowpass — the "breath" body
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 0.6;
  const breath = ctx.createGain();
  breath.gain.value = 0.0001;
  src.connect(lp).connect(breath).connect(master);
  src.start();

  // 80 Hz swell under the inhale (§D6)
  const swellOsc = ctx.createOscillator();
  swellOsc.type = 'sine';
  swellOsc.frequency.value = 80;
  const swell = ctx.createGain();
  swell.gain.value = 0.0001;
  swellOsc.connect(swell).connect(master);
  swellOsc.start();

  let stopped = false;
  let timer = null;
  const scheduleCycle = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.05;
    const p = jitter();
    // inhale (snorty): noise + swell rise then fall
    breath.gain.cancelScheduledValues(t);
    breath.gain.setValueAtTime(0.0001, t);
    breath.gain.exponentialRampToValueAtTime(0.5 * p, t + 0.5);
    breath.gain.exponentialRampToValueAtTime(0.02, t + 0.95);
    // exhale (soft puff)
    breath.gain.exponentialRampToValueAtTime(0.18 * p, t + 1.35);
    breath.gain.exponentialRampToValueAtTime(0.0001, t + CYCLE - 0.1);
    swell.gain.cancelScheduledValues(t);
    swell.gain.setValueAtTime(0.0001, t);
    swell.gain.exponentialRampToValueAtTime(0.24 * p, t + 0.45);
    swell.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    timer = setTimeout(scheduleCycle, CYCLE * 1000);
  };
  scheduleCycle();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer != null) clearTimeout(timer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.0001, t + 0.2);
      setTimeout(() => {
        try {
          src.stop();
          swellOsc.stop();
          master.disconnect();
        } catch { /* already gone */ }
      }, 250);
    },
  };
}

/** Recipe registry consumed by audio.js (sfxMap voice defs point here). */
export const VOICE_RECIPES = Object.freeze({
  squeak,
  squeakHappy,
  squeakDizzy,
  purr,
  giggle,
  refuse,
  sniff,
  yawn,
  snore,
});
