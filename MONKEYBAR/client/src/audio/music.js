// Procedural bar-loop music — PLAN.md §7 (client/src/audio/music.js).
// A laid-back synthesized loop: walking bassline + shaker + marimba-ish plucks,
// with an `intensity` parameter (0..1) that darkens/tightens the groove during
// penalties. Gated behind a user gesture; mutable.

import { initAudioContext } from './sfx.js';

const BPM = 88;
const STEPS_PER_BAR = 8; // 8th notes
const BARS = 4;

// A minor pentatonic-ish, laid back
const BASS_PATTERN = [
  // [step, midi] per 4-bar loop (step 0..31)
  [0, 33], [3, 33], [6, 36], [8, 31], [11, 31], [14, 33],
  [16, 29], [19, 29], [22, 31], [24, 33], [27, 36], [30, 38],
];
const PLUCK_SCALE = [57, 60, 62, 64, 67, 69, 72, 74]; // A3 pent + extensions

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const MUSIC_BASE_GAIN = 0.5;

export function createMusic() {
  /** @type {AudioContext|null} */
  let ctx = null;
  let master = null;
  let lowpass = null;
  let bassGain = null;
  let shakerGain = null;
  let pluckGain = null;
  let pulseGain = null;
  let noiseBuf = null;

  let muted = false;
  let volume = 1;
  let playing = false;
  let intensity = 0;
  let timer = null;
  let nextStepTime = 0;
  let step = 0;

  const stepDur = () => 60 / BPM / 2; // 8th note

  function applyMasterGain() {
    if (master) master.gain.value = muted ? 0 : MUSIC_BASE_GAIN * volume;
  }

  function init() {
    if (ctx) return true;
    ctx = initAudioContext();
    if (!ctx) return false;

    master = ctx.createGain();
    master.gain.value = muted ? 0 : MUSIC_BASE_GAIN * volume;
    lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2400;
    lowpass.connect(master);
    master.connect(ctx.destination);

    bassGain = ctx.createGain();
    bassGain.gain.value = 0.5;
    bassGain.connect(lowpass);
    shakerGain = ctx.createGain();
    shakerGain.gain.value = 0.16;
    shakerGain.connect(lowpass);
    pluckGain = ctx.createGain();
    pluckGain.gain.value = 0.3;
    pluckGain.connect(lowpass);
    pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.0;
    pulseGain.connect(lowpass);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // ---- voices ----------------------------------------------------------

  function bassNote(t, midi, dur) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiToFreq(midi);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq(midi - 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    sub.connect(g);
    g.connect(bassGain);
    o.start(t);
    o.stop(t + dur + 0.05);
    sub.start(t);
    sub.stop(t + dur + 0.05);
  }

  function shakerHit(t, accent) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? 0.8 : 0.42, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(f);
    f.connect(g);
    g.connect(shakerGain);
    src.start(t);
    src.stop(t + 0.1);
  }

  function pluck(t, midi) {
    const f0 = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    // marimba-ish: fundamental + 4x partial, quick decay
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f0;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f0 * 4.02;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.18, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(pluckGain);
    o1.start(t);
    o1.stop(t + 0.7);
    o2.start(t);
    o2.stop(t + 0.2);
  }

  /** Tense heartbeat pulse — only audible at high intensity. */
  function pulseHit(t) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.0, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g);
    g.connect(pulseGain);
    o.start(t);
    o.stop(t + 0.3);
  }

  // ---- scheduler ---------------------------------------------------------

  let pluckSeed = 1;
  function pluckRand() {
    pluckSeed = (pluckSeed * 16807) % 2147483647;
    return pluckSeed / 2147483647;
  }

  function scheduleStep(s, t) {
    const loopStep = s % (STEPS_PER_BAR * BARS);
    // bass
    for (const [ps, midi] of BASS_PATTERN) {
      if (ps === loopStep) bassNote(t, midi, stepDur() * 2.4);
    }
    // extra driving bass 8ths at high intensity
    if (intensity > 0.6 && loopStep % 2 === 0 && !BASS_PATTERN.some(([ps]) => ps === loopStep)) {
      bassNote(t, 33, stepDur() * 0.9);
    }
    // shaker on offbeats (always), plus every 8th when intense
    if (loopStep % 2 === 1 || intensity > 0.45) shakerHit(t, loopStep % 4 === 3);
    // sparse plucks, calmer when intense (the room holds its breath)
    const pluckChance = 0.22 * (1 - intensity * 0.75);
    if (loopStep % 2 === 0 && pluckRand() < pluckChance) {
      pluck(t, PLUCK_SCALE[Math.floor(pluckRand() * PLUCK_SCALE.length)]);
      if (pluckRand() < 0.3) pluck(t + stepDur() * 0.5, PLUCK_SCALE[Math.floor(pluckRand() * 4)]);
    }
    // heartbeat on beats 1+3 when intensity is up
    if (loopStep % 8 === 0 || loopStep % 8 === 4) pulseHit(t);
  }

  function tick() {
    if (!playing || !ctx) return;
    const ahead = 0.18;
    while (nextStepTime < ctx.currentTime + ahead) {
      scheduleStep(step, Math.max(nextStepTime, ctx.currentTime + 0.01));
      nextStepTime += stepDur();
      step++;
    }
  }

  return {
    /** Start the loop (requires a prior/user-gesture init of audio). */
    start() {
      if (!init()) return false;
      if (playing) return true;
      playing = true;
      step = 0;
      nextStepTime = ctx.currentTime + 0.06;
      timer = setInterval(tick, 45);
      return true;
    },
    stop() {
      playing = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    get playing() {
      return playing;
    },
    /**
     * 0 = laid-back bar, 1 = full penalty dread.
     * Ramps filters/gains smoothly over ~0.6 s.
     */
    setIntensity(v, rampSeconds = 0.6) {
      intensity = Math.max(0, Math.min(1, v));
      if (!ctx) return;
      const t = ctx.currentTime;
      lowpass.frequency.cancelScheduledValues(t);
      lowpass.frequency.linearRampToValueAtTime(2400 - intensity * 1500, t + rampSeconds);
      pulseGain.gain.cancelScheduledValues(t);
      pulseGain.gain.linearRampToValueAtTime(intensity * 0.55, t + rampSeconds);
      pluckGain.gain.cancelScheduledValues(t);
      pluckGain.gain.linearRampToValueAtTime(0.3 * (1 - intensity * 0.6), t + rampSeconds);
      shakerGain.gain.cancelScheduledValues(t);
      shakerGain.gain.linearRampToValueAtTime(0.16 + intensity * 0.1, t + rampSeconds);
    },
    get intensity() {
      return intensity;
    },
    setMuted(m) {
      muted = !!m;
      applyMasterGain();
    },
    get muted() {
      return muted;
    },
    /** Master music volume, 0..1 (applied on top of the base gain). */
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      applyMasterGain();
    },
    get volume() {
      return volume;
    },
  };
}
