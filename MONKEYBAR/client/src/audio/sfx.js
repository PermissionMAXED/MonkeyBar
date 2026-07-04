// Synthesized SFX — PLAN.md §7 (client/src/audio/sfx.js).
// Web Audio one-shots from oscillators + filtered noise. Zero assets.
// The AudioContext is created lazily on the first user gesture (init()).

let sharedCtx = null;

/** Lazily create (or return) the shared AudioContext. May return null before a gesture. */
export function getAudioContext() {
  return sharedCtx;
}

function ensureContext() {
  if (!sharedCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    sharedCtx = new AC();
  }
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

/** Force-create the shared context (call from a user-gesture handler). */
export function initAudioContext() {
  return ensureContext();
}

// ---------------------------------------------------------------------------

export function createSFX() {
  /** @type {AudioContext|null} */
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    ctx = ensureContext();
    if (!ctx) return false;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    // 1s of white noise, reused by every noise-based hit
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  const ready = () => !!ctx && !muted;

  // ---- building blocks -----------------------------------------------

  function envGain(t0, attack, peak, decay, curve = 'exp') {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    else g.gain.linearRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(master);
    return g;
  }

  function osc(type, freq, t0, dur, dest, endFreq = null) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq != null) o.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + dur);
    o.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  function noise(t0, dur, dest, { type = 'bandpass', freq = 1000, q = 1, endFreq = null } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (endFreq != null) f.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 10), t0 + dur);
    f.Q.value = q;
    src.connect(f);
    f.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return src;
  }

  // ---- one-shots -------------------------------------------------------

  const fx = {
    /** Card sliding across felt. */
    cardSlide() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const g = envGain(t, 0.015, 0.16, 0.16, 'lin');
      noise(t, 0.18, g, { type: 'bandpass', freq: 2600, endFreq: 900, q: 0.8 });
    },
    /** Snappy card flip. */
    cardFlip() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const g = envGain(t, 0.004, 0.28, 0.09);
      noise(t, 0.1, g, { type: 'highpass', freq: 1800, q: 1.2 });
      const g2 = envGain(t + 0.03, 0.003, 0.12, 0.05);
      osc('triangle', 880, t + 0.03, 0.06, g2, 320);
    },
    /** Clay chip clack (two ticks). */
    chipClack() {
      if (!ready()) return;
      const t = ctx.currentTime;
      for (const [dt, f, v] of [[0, 2400, 0.3], [0.055, 1900, 0.2]]) {
        const g = envGain(t + dt, 0.002, v, 0.045);
        osc('square', f, t + dt, 0.05, g, f * 0.6);
        noise(t + dt, 0.03, g, { type: 'highpass', freq: 4000 });
      }
    },
    /**
     * Rising drumroll — schedules snare-ish hits for `seconds`.
     * Returns the actual duration.
     */
    drumroll(seconds = 2.0) {
      if (!ready()) return seconds;
      const t0 = ctx.currentTime;
      let t = 0;
      let interval = 0.09;
      while (t < seconds) {
        const at = t0 + t;
        const g = envGain(at, 0.002, 0.09 + (t / seconds) * 0.14, 0.05);
        noise(at, 0.05, g, { type: 'bandpass', freq: 320 + (t / seconds) * 300, q: 1.1 });
        const g2 = envGain(at, 0.002, 0.05, 0.04);
        osc('triangle', 180, at, 0.04, g2, 100);
        interval = Math.max(0.032, interval * 0.965); // accelerate
        t += interval;
      }
      return seconds;
    },
    /** Cannon THOOM — sub sine drop + filtered noise blast. */
    cannonThoom() {
      if (!ready()) return;
      const t = ctx.currentTime;
      // sub body
      const g = envGain(t, 0.008, 1.0, 0.85);
      osc('sine', 62, t, 0.9, g, 26);
      // mid punch
      const g2 = envGain(t, 0.004, 0.5, 0.22);
      osc('triangle', 140, t, 0.25, g2, 48);
      // air blast
      const g3 = envGain(t, 0.003, 0.55, 0.5);
      noise(t, 0.55, g3, { type: 'lowpass', freq: 2200, endFreq: 180, q: 0.6 });
      // metallic ring-off
      const g4 = envGain(t + 0.08, 0.01, 0.07, 0.7);
      osc('sine', 523, t + 0.08, 0.75, g4, 490);
    },
    /** Dry survival *click* (empty chamber). */
    survivalClick() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const g = envGain(t, 0.001, 0.4, 0.03);
      osc('square', 1450, t, 0.03, g, 700);
      const g2 = envGain(t + 0.045, 0.001, 0.18, 0.025);
      osc('square', 980, t + 0.045, 0.025, g2, 500);
      noise(t, 0.02, envGain(t, 0.001, 0.14, 0.02), { type: 'highpass', freq: 5000 });
    },
    /** Excited monkey chatter (random blips). */
    chatter() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const n = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const at = t + i * (0.055 + Math.random() * 0.03);
        const f = 480 + Math.random() * 520;
        const g = envGain(at, 0.004, 0.08, 0.05);
        osc('sawtooth', f, at, 0.055, g, f * (1.15 + Math.random() * 0.4));
      }
    },
    /** Tiny UI tick. */
    uiTick() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const g = envGain(t, 0.002, 0.12, 0.04);
      osc('sine', 1250, t, 0.045, g, 900);
    },
    /** Win fanfare — bright arpeggio + chord. */
    fanfare() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => {
        const at = t + i * 0.13;
        const g = envGain(at, 0.01, 0.16, 0.3);
        osc('sawtooth', f, at, 0.32, g);
        osc('triangle', f / 2, at, 0.32, g);
      });
      // final chord
      const at = t + 0.55;
      for (const f of [523.25, 659.25, 783.99]) {
        const g = envGain(at, 0.02, 0.13, 0.9);
        osc('sawtooth', f, at, 0.95, g);
      }
    },
    /** Deep bass sting (DJ Drift passive, penalties). */
    bassSting() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const g = envGain(t, 0.01, 0.5, 0.5);
      osc('sine', 98, t, 0.5, g, 49);
    },
    /** Sad slide-whistle down (eliminated). */
    sadTrombone() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const g = envGain(t, 0.02, 0.14, 0.7, 'lin');
      osc('sawtooth', 233, t, 0.7, g, 116);
    },
    /** Fuse hiss (short loop-ish noise). */
    fuseHiss(seconds = 1.2) {
      if (!ready()) return;
      const t = ctx.currentTime;
      const g = envGain(t, 0.05, 0.09, seconds, 'lin');
      noise(t, seconds, g, { type: 'highpass', freq: 5200, q: 0.6 });
    },
  };

  return {
    /** Create/resume the AudioContext. Call from a user-gesture handler. */
    init,
    get initialized() {
      return !!ctx;
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : 0.9;
    },
    get muted() {
      return muted;
    },
    /** Play a named one-shot: play('cannonThoom') etc. */
    play(name, ...args) {
      const f = fx[name];
      if (f) return f(...args);
    },
    ...fx,
  };
}
