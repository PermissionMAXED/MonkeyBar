// Gooby voice (§D6, agent G14) — 100% WebAudio-synthesized rabbit noises, so
// Gooby never sounds like a stock sample:
//   squeak — sine 600–900 Hz with a fast up-down pitch envelope + slight
//            vibrato (the poke/pet reaction)
//   giggle — 3–5 staccato squeaks descending (tickle)
//   snore  — loop: filtered brown-ish noise breaths + an 80 Hz sine swell
//   yawn   — 400→200 Hz glide with droopy vibrato (wake-up)
// plus flavour variants (squeakHappy/squeakDizzy/purr/refuse/sniff).
// V2/G29 adds the 2.0 set — sneeze/sniffle (sickness §C3), hiccup (queasy
// wobble), contentSigh/brrr/delightedGasp (idle & weather flavor) — and gives
// yawn 3 contour variants for the §C10.3 night yawns.
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

/**
 * Yawn: 400→200 Hz glide with droopy slow vibrato (§D6 wake).
 * V2/G29 (§C10.3 night yawns): every call rolls one of 3 contour VARIANTS —
 * 'classic' (the v1 shape), 'drowsy' (longer, sagging double-dip — the sleepy
 * 2 a.m. one) or 'squeaky' (short with a cracky peak) — so the 45 ± 15 s
 * night-band yawns never sound samey. ±10% pitch jitter on top, as always.
 */
export function yawn(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const at = ctx.currentTime;
  // V2/G29: variant roll (weights: classic 40% / drowsy 35% / squeaky 25%)
  const roll = Math.random();
  const variant = roll < 0.4 ? 'classic' : roll < 0.75 ? 'drowsy' : 'squeaky';
  const dur = variant === 'drowsy' ? 1.3 : variant === 'squeaky' ? 0.55 : 0.9;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  if (variant === 'drowsy') {
    // long sag with a mid-yawn second dip (the "almost done… no wait" yawn)
    osc.frequency.setValueAtTime(380 * p, at);
    osc.frequency.linearRampToValueAtTime(290 * p, at + dur * 0.35);
    osc.frequency.linearRampToValueAtTime(330 * p, at + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(180 * p, at + dur);
  } else if (variant === 'squeaky') {
    // short with a cracky peak before the drop
    osc.frequency.setValueAtTime(430 * p, at);
    osc.frequency.linearRampToValueAtTime(560 * p, at + dur * 0.25);
    osc.frequency.linearRampToValueAtTime(230 * p, at + dur);
  } else {
    osc.frequency.setValueAtTime(400 * p, at);
    osc.frequency.linearRampToValueAtTime(320 * p, at + dur * 0.4);
    osc.frequency.linearRampToValueAtTime(200 * p, at + dur);
  }
  const vib = ctx.createOscillator();
  vib.frequency.value = variant === 'drowsy' ? 4.2 : 5.5; // V2/G29: droopier at night
  const vibGain = ctx.createGain();
  vibGain.gain.value = variant === 'squeaky' ? 18 : 12;
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

// ============================================================================
// V2/G29: 2.0 voice additions (§E wave 4 — sickness, garden joy, idle life).
// Same rules as the v1 set: pure (ctx, dest, opts) recipes, ±10% jitter on
// every call, one-shots return nothing. Consumed via sfxMap voice defs
// ('health.sneeze', 'gooby.sniffle', 'gooby.hiccup', 'gooby.sigh',
// 'gooby.brrr', 'gooby.gasp').
// ============================================================================

/**
 * Sneeze (§C3.3/§C3.4): fired at the visual "ACHOO" snap (gooby.js winds up
 * the head for 0.35 s first, so the audio starts AT the burst): a tiny
 * catch-breath squeak, the achoo noise burst + downward squeal, and a 40%
 * congested sniffle tail. Replaces the squeakDizzy placeholder (G20 note).
 */
export function sneeze(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const t = ctx.currentTime;
  // catch-breath "aah—" (very short, right before the burst)
  squeakSyllable(ctx, dest, { at: t, f0: 700 * p, f1: 950 * p, f2: 900 * p, dur: 0.07, vol: 0.28 * volume, vib: 0.3 });
  // ACHOO: noise burst…
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2600 * p, t + 0.08);
  bp.frequency.exponentialRampToValueAtTime(900 * p, t + 0.26);
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t + 0.08);
  ng.gain.exponentialRampToValueAtTime(0.5 * volume, t + 0.1);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  src.connect(bp).connect(ng).connect(dest);
  src.start(t + 0.08);
  src.stop(t + 0.32);
  // …with a sagging "-choo!" squeal under it
  squeakSyllable(ctx, dest, { at: t + 0.09, f0: 980 * p, f1: 620 * p, f2: 340 * p, dur: 0.28, vol: 0.42 * volume, vib: 2.2 });
  // 40%: congested sniffle tail (nose recovering)
  if (Math.random() < 0.4) {
    const s2 = ctx.createBufferSource();
    s2.buffer = noiseBuffer(ctx);
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 1250 * jitter();
    bp2.Q.value = 1.4;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.48);
    g2.gain.exponentialRampToValueAtTime(0.22 * volume, t + 0.53);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.66);
    s2.connect(bp2).connect(g2).connect(dest);
    s2.start(t + 0.48);
    s2.stop(t + 0.68);
  }
}

/**
 * Sniffle (§C3 flavor): a congested double-sniff — like sniff() but lower,
 * slower and wetter, with a tiny sad settle squeak. Sick/queasy Gooby
 * sniffles between sneezes (gooby.js V2/G29 scheduler).
 */
export function sniffle(ctx, dest, { volume = 1 } = {}) {
  const t = ctx.currentTime;
  for (let i = 0; i < 2; i += 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150 * jitter(); // lower than the curious sniff (1900)
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    const at = t + i * 0.26;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.3 * volume, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    src.connect(bp).connect(g).connect(dest);
    src.start(at);
    src.stop(at + 0.22);
  }
  // poor-thing settle squeak
  squeakSyllable(ctx, dest, { at: t + 0.55, f0: 420 * jitter(), f1: 380, f2: 300, dur: 0.14, vol: 0.2 * volume, vib: 0.6 });
}

/**
 * Hiccup (§C3.3 queasyWobble): one quick upward "hic!" chirp + a soft body
 * thump — timed to the 0.28 s hiccup envelope in gooby.js.
 */
export function hiccup(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const t = ctx.currentTime;
  squeakSyllable(ctx, dest, { at: t, f0: 500 * p, f1: 1050 * p, f2: 980 * p, dur: 0.09, vol: 0.42 * volume, vib: 0.3 });
  // little diaphragm thump under it
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150 * p, t);
  osc.frequency.exponentialRampToValueAtTime(90 * p, t + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22 * volume, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.11);
}

/**
 * Content sigh: a soft happy exhale — breathy noise sweeping down with a
 * warm low hum underneath (post-stretch / cozy-idle flavor).
 */
export function contentSigh(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const t = ctx.currentTime;
  const dur = 0.85;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1500 * p, t);
  lp.frequency.exponentialRampToValueAtTime(420 * p, t + dur);
  lp.Q.value = 0.5;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.22 * volume, t + 0.12);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(ng).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.02);
  // warm hum settling underneath
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(300 * p, t);
  osc.frequency.linearRampToValueAtTime(210 * p, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16 * volume, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/**
 * Brrr/shiver: a low tremolo warble — "brbrbrr" — for the rain-watching
 * shiver micro-idle (§C11.2 flavor; pairs with the 'shiver' clip).
 */
export function brrr(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const t = ctx.currentTime;
  const dur = 0.55;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(260 * p, t);
  osc.frequency.linearRampToValueAtTime(215 * p, t + dur);
  // fast lip-flutter tremolo (the "brrr")
  const trem = ctx.createOscillator();
  trem.frequency.value = 15;
  const tremGain = ctx.createGain();
  tremGain.gain.value = 0.16;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32 * volume, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  trem.connect(tremGain).connect(g.gain);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  trem.start(t);
  trem.stop(t + dur + 0.02);
}

/**
 * Delighted gasp: a quick inhale + two bright rising "ooh!" syllables —
 * harvest joy (layered into the 'garden.harvest' synth recipe) and general
 * pleasant-surprise flavor.
 */
export function delightedGasp(ctx, dest, { volume = 1 } = {}) {
  const p = jitter();
  const t = ctx.currentTime;
  // sharp little inhale
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1400 * p, t);
  bp.frequency.exponentialRampToValueAtTime(2600 * p, t + 0.1);
  bp.Q.value = 1.1;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.28 * volume, t + 0.04);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  src.connect(bp).connect(ng).connect(dest);
  src.start(t);
  src.stop(t + 0.15);
  // "ooh—OOH!" rising pair
  squeakSyllable(ctx, dest, { at: t + 0.13, f0: 660 * p, f1: 880 * p, f2: 840 * p, dur: 0.11, vol: 0.4 * volume, vib: 0.5 });
  squeakSyllable(ctx, dest, { at: t + 0.27, f0: 820 * p, f1: 1180 * p, f2: 1050 * p, dur: 0.17, vol: 0.48 * volume, vib: 0.8 });
}

// ================================================================ end V2/G29

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
  // V2/G29: 2.0 additions (§E wave 4)
  sneeze,
  sniffle,
  hiccup,
  contentSigh,
  brrr,
  delightedGasp,
});
