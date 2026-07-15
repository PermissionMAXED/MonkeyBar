// Tiny tween/spring util (§B, no deps). Self-driving via a shared RAF ticker
// (setTimeout fallback keeps it harmless under node:test). Used across scenes
// for squash-and-stretch, UI pops, camera pans, etc.

/** @type {Set<(dt: number) => boolean>} active steppers; return false to finish */
const active = new Set();
let running = false;
let lastT = 0;

function pump(t) {
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  for (const step of [...active]) {
    if (!step(dt)) active.delete(step);
  }
  if (active.size > 0) schedule();
  else running = false;
}

function schedule() {
  running = true;
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(pump);
  else setTimeout(() => pump(performance.now()), 16);
}

function start(step) {
  active.add(step);
  if (!running) {
    lastT = performance.now();
    schedule();
  }
}

/** Easing functions (t: 0..1 → 0..1). */
export const easings = {
  linear: (t) => t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/**
 * Run a value tween.
 * @param {{
 *   from?: number, to?: number, duration: number, delay?: number,
 *   ease?: (t: number) => number,
 *   onUpdate?: (value: number, t: number) => void,
 *   onComplete?: () => void,
 * }} opts duration/delay in seconds
 * @returns {{cancel: () => void, finished: Promise<void>}}
 */
export function tween(opts) {
  const { from = 0, to = 1, duration, delay = 0, ease = easings.easeOutQuad, onUpdate, onComplete } = opts;
  let elapsed = -delay;
  let cancelled = false;
  let resolveFinished;
  const finished = new Promise((res) => (resolveFinished = res));

  start((dt) => {
    if (cancelled) return false;
    elapsed += dt;
    if (elapsed < 0) return true;
    const t = duration <= 0 ? 1 : Math.min(elapsed / duration, 1);
    onUpdate?.(from + (to - from) * ease(t), t);
    if (t >= 1) {
      onComplete?.();
      resolveFinished();
      return false;
    }
    return true;
  });

  return {
    cancel() {
      cancelled = true;
      resolveFinished();
    },
    finished,
  };
}

/**
 * Damped spring toward a target (§D2.4 pokeWobble-style motion).
 * Integrates on the shared ticker; retarget freely via setTarget.
 * @param {{
 *   value?: number, target?: number, freq?: number, zeta?: number,
 *   onUpdate?: (value: number, velocity: number) => void,
 *   epsilon?: number,
 * }} opts freq in Hz, zeta = damping ratio (1 = critical)
 * @returns {{setTarget: (t: number) => void, impulse: (v: number) => void, get: () => number, cancel: () => void}}
 */
export function spring(opts = {}) {
  let { value = 0, target = value, freq = 3, zeta = 0.35 } = opts;
  const { onUpdate, epsilon = 0.0005 } = opts;
  let velocity = 0;
  let cancelled = false;
  let ticking = false;

  const omega = 2 * Math.PI * freq;

  function step(dt) {
    if (cancelled) {
      ticking = false;
      return false;
    }
    // semi-implicit Euler on a damped harmonic oscillator
    const accel = -omega * omega * (value - target) - 2 * zeta * omega * velocity;
    velocity += accel * dt;
    value += velocity * dt;
    onUpdate?.(value, velocity);
    if (Math.abs(value - target) < epsilon && Math.abs(velocity) < epsilon) {
      value = target;
      velocity = 0;
      onUpdate?.(value, velocity);
      ticking = false;
      return false;
    }
    return true;
  }

  function wake() {
    if (!ticking && !cancelled) {
      ticking = true;
      start(step);
    }
  }

  return {
    setTarget(t) {
      target = t;
      wake();
    },
    impulse(v) {
      velocity += v;
      wake();
    },
    get: () => value,
    cancel() {
      cancelled = true;
    },
  };
}
