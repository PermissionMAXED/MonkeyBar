// V4/G60 — optional home-room gyro/pointer parallax (§B8/§C-SYS8).
//
// Permission contract for V4/G58:
//   Call `enableGyro()` DIRECTLY from the settings-toggle click handler and
//   await its boolean result. The iOS `DeviceOrientationEvent.requestPermission`
//   call happens synchronously before this function's first await, preserving
//   the user gesture. Only persist `settings.gyro = true` when it resolves
//   true; on false, leave/snap the toggle off and show the permission toast.
//   `disableGyro()` is synchronous and removes every listener immediately.
//
// The mapping helpers are deterministic and DOM-free. Browser globals are
// only feature-detected by the opt-in runtime API; importing this module has
// no side effects and remains safe in node:test.

/** Frozen §C-SYS8 mapping, smoothing and guard values. */
export const GYRO_PARALLAX = Object.freeze({
  DEADZONE_DEG: 2,
  SENSITIVITY_M_PER_DEG: 0.008,
  MAX_X_M: 0.12,
  MAX_Y_M: 0.08,
  POINTER_MAX_M: 0.06,
  NEUTRAL_TAU_SEC: 4,
  SMOOTH_TAU_SEC: 0.15,
  SUSPEND_TAU_SEC: 1,
  FPS_WINDOW_SEC: 5,
  FPS_SUSPEND_BELOW: 25,
  FPS_RESUME_AT: 35,
});

// An edge pointer must map to exactly ±0.06 m after the 2° deadzone.
const POINTER_EDGE_DEG =
  GYRO_PARALLAX.DEADZONE_DEG
  + GYRO_PARALLAX.POINTER_MAX_M / GYRO_PARALLAX.SENSITIVITY_M_PER_DEG;
// Fixed storage covers a 600 Hz display for five seconds without allocating
// in the frame loop (real target devices are ≤120 Hz).
const FPS_RING_CAPACITY = 3000;

const ZERO_NEUTRAL = Object.freeze({ beta: 0, gamma: 0 });

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Deadzone without a discontinuous jump at ±2°. */
export function deadzoneDegrees(value) {
  const n = finite(value);
  const magnitude = Math.abs(n);
  if (magnitude <= GYRO_PARALLAX.DEADZONE_DEG) return 0;
  return Math.sign(n) * (magnitude - GYRO_PARALLAX.DEADZONE_DEG);
}

function mapAngles(beta, gamma, neutralBeta, neutralGamma, maxX, maxY, out) {
  const dxDeg = deadzoneDegrees(finite(gamma) - finite(neutralGamma));
  const dyDeg = deadzoneDegrees(finite(beta) - finite(neutralBeta));
  out.x = clamp(
    dxDeg * GYRO_PARALLAX.SENSITIVITY_M_PER_DEG,
    -maxX,
    maxX,
  );
  // Positive beta tips the top of a portrait phone away, so move the camera
  // down; gamma remains the intuitive left/right camera translation.
  out.y = dyDeg === 0
    ? 0
    : clamp(
      -dyDeg * GYRO_PARALLAX.SENSITIVITY_M_PER_DEG,
      -maxY,
      maxY,
    );
  return out;
}

/**
 * Map device-orientation angles relative to a neutral pose into metres.
 * `beta` drives vertical translation, `gamma` horizontal translation.
 *
 * @param {number} beta device x-tilt in degrees
 * @param {number} gamma device y-tilt in degrees
 * @param {{beta?: number, gamma?: number}} [neutral]
 * @param {{x: number, y: number}} [out] optional reusable output
 * @returns {{x: number, y: number}}
 */
export function parallaxOffset(beta, gamma, neutral = ZERO_NEUTRAL, out = { x: 0, y: 0 }) {
  return mapAngles(
    beta,
    gamma,
    neutral?.beta ?? 0,
    neutral?.gamma ?? 0,
    GYRO_PARALLAX.MAX_X_M,
    GYRO_PARALLAX.MAX_Y_M,
    out,
  );
}

/**
 * Pointer fallback through the same deadzone/sensitivity pipeline.
 * Inputs are normalized −1…1 (`ny`: +1 at the top of the viewport).
 *
 * @param {number} nx
 * @param {number} ny
 * @param {{x: number, y: number}} [out]
 * @returns {{x: number, y: number}}
 */
export function pointerParallaxOffset(nx, ny, out = { x: 0, y: 0 }) {
  const x = clamp(finite(nx), -1, 1);
  const y = clamp(finite(ny), -1, 1);
  return mapAngles(
    -y * POINTER_EDGE_DEG,
    x * POINTER_EDGE_DEG,
    0,
    0,
    GYRO_PARALLAX.POINTER_MAX_M,
    GYRO_PARALLAX.POINTER_MAX_M,
    out,
  );
}

/** Exponential interpolation coefficient for a time constant. */
export function lerpAlpha(dtSec, tauSec) {
  const dt = Math.max(0, finite(dtSec));
  const tau = Math.max(Number.EPSILON, finite(tauSec));
  return 1 - Math.exp(-dt / tau);
}

/**
 * Slowly adapt the neutral pose (τ=4 s). Mutates/returns `neutral` so the
 * browser runtime can stay allocation-free per frame.
 */
export function adaptNeutral(neutral, beta, gamma, dtSec) {
  const b = finite(beta);
  const g = finite(gamma);
  if (!neutral.initialized) {
    neutral.beta = b;
    neutral.gamma = g;
    neutral.initialized = true;
    return neutral;
  }
  const alpha = lerpAlpha(dtSec, GYRO_PARALLAX.NEUTRAL_TAU_SEC);
  neutral.beta += (b - neutral.beta) * alpha;
  neutral.gamma += (g - neutral.gamma) * alpha;
  return neutral;
}

/**
 * Smooth an offset using the §C-SYS8 150 ms time constant by default.
 * Mutates/returns `current` for zero per-frame allocation.
 */
export function smoothOffset(
  current,
  target,
  dtSec,
  tauSec = GYRO_PARALLAX.SMOOTH_TAU_SEC,
) {
  const alpha = lerpAlpha(dtSec, tauSec);
  current.x += (finite(target?.x) - current.x) * alpha;
  current.y += (finite(target?.y) - current.y) * alpha;
  return current;
}

/**
 * @returns {{elapsed:number, frames:number, fps:number, suspended:boolean,
 *   samples:Float64Array, cursor:number, size:number}}
 */
export function createFpsGuard() {
  return {
    elapsed: 0,
    frames: 0,
    fps: Infinity,
    suspended: false,
    samples: new Float64Array(FPS_RING_CAPACITY),
    cursor: 0,
    size: 0,
  };
}

/**
 * Advance the 5 s FPS guard. The low/high thresholds form hysteresis:
 * running suspends below 25 fps; suspended resumes only at ≥35 fps.
 * Mutates/returns `guard` for zero per-frame allocation.
 */
export function updateFpsGuard(guard, dtSec) {
  const dt = Math.max(0, finite(dtSec));
  if (dt <= 0) return guard;

  // Append this frame duration, evicting the oldest only at the fixed ring
  // capacity. Then trim complete frames that fall beyond the rolling 5 s.
  if (guard.size >= guard.samples.length) {
    guard.elapsed -= guard.samples[guard.cursor];
    guard.size -= 1;
  }
  guard.samples[guard.cursor] = dt;
  guard.cursor = (guard.cursor + 1) % guard.samples.length;
  guard.size += 1;
  guard.elapsed += dt;
  while (guard.size > 1) {
    const oldestIndex =
      (guard.cursor - guard.size + guard.samples.length) % guard.samples.length;
    const oldest = guard.samples[oldestIndex];
    if (guard.elapsed - oldest < GYRO_PARALLAX.FPS_WINDOW_SEC) break;
    guard.elapsed -= oldest;
    guard.size -= 1;
  }
  guard.frames = guard.size;

  if (guard.elapsed + 1e-9 < GYRO_PARALLAX.FPS_WINDOW_SEC) return guard;
  guard.fps = guard.frames / guard.elapsed;
  if (guard.suspended) {
    if (guard.fps >= GYRO_PARALLAX.FPS_RESUME_AT - 1e-9) guard.suspended = false;
  } else if (guard.fps < GYRO_PARALLAX.FPS_SUSPEND_BELOW - 1e-9) {
    guard.suspended = true;
  }
  return guard;
}

/**
 * Pure source choice used by the runtime and tests. A real orientation sample
 * wins; until one arrives (desktop browsers often expose the event API but no
 * sensor), pointer movement is the fallback.
 */
function chooseParallaxSource(enabled, sceneActive, orientationSampled, pointerSupported) {
  if (!enabled || !sceneActive) return 'none';
  if (orientationSampled) return 'orientation';
  return pointerSupported ? 'pointer' : 'none';
}

export function selectParallaxSource({
  enabled,
  sceneActive,
  orientationSampled,
  pointerSupported,
}) {
  return chooseParallaxSource(
    enabled,
    sceneActive,
    orientationSampled,
    pointerSupported,
  );
}

const runtime = {
  desiredEnabled: false,
  sceneActive: false,
  attached: false,
  eventTarget: null,
  orientationCtor: null,
  orientationSupported: false,
  pointerSupported: false,
  orientationSampled: false,
  rawBeta: 0,
  rawGamma: 0,
  neutral: { beta: 0, gamma: 0, initialized: false },
  pointerTarget: { x: 0, y: 0 },
  target: { x: 0, y: 0 },
  offset: { x: 0, y: 0 },
  guard: createFpsGuard(),
};

function defaultEventTarget() {
  return typeof globalThis.window !== 'undefined' ? globalThis.window : null;
}

function defaultOrientationCtor() {
  return typeof globalThis.DeviceOrientationEvent !== 'undefined'
    ? globalThis.DeviceOrientationEvent
    : null;
}

function resetMotion() {
  runtime.orientationSampled = false;
  runtime.rawBeta = 0;
  runtime.rawGamma = 0;
  runtime.neutral.beta = 0;
  runtime.neutral.gamma = 0;
  runtime.neutral.initialized = false;
  runtime.pointerTarget.x = 0;
  runtime.pointerTarget.y = 0;
  runtime.target.x = 0;
  runtime.target.y = 0;
  runtime.offset.x = 0;
  runtime.offset.y = 0;
  runtime.guard.elapsed = 0;
  runtime.guard.frames = 0;
  runtime.guard.cursor = 0;
  runtime.guard.size = 0;
  runtime.guard.fps = Infinity;
  runtime.guard.suspended = false;
}

function onDeviceOrientation(event) {
  if (!Number.isFinite(event?.beta) || !Number.isFinite(event?.gamma)) return;
  runtime.rawBeta = event.beta;
  runtime.rawGamma = event.gamma;
  if (!runtime.orientationSampled) {
    runtime.neutral.beta = event.beta;
    runtime.neutral.gamma = event.gamma;
    runtime.neutral.initialized = true;
  }
  runtime.orientationSampled = true;
}

function onPointerMove(event) {
  const width = Math.max(1, finite(globalThis.innerWidth) || 1);
  const height = Math.max(1, finite(globalThis.innerHeight) || 1);
  const nx = clamp((finite(event?.clientX) / width) * 2 - 1, -1, 1);
  const ny = clamp(-(finite(event?.clientY) / height) * 2 + 1, -1, 1);
  pointerParallaxOffset(nx, ny, runtime.pointerTarget);
}

function detachListeners() {
  if (!runtime.attached || !runtime.eventTarget) return;
  if (runtime.orientationSupported) {
    runtime.eventTarget.removeEventListener?.('deviceorientation', onDeviceOrientation);
  }
  if (runtime.pointerSupported) {
    runtime.eventTarget.removeEventListener?.('pointermove', onPointerMove);
  }
  runtime.attached = false;
}

function attachListeners() {
  if (
    runtime.attached
    || !runtime.desiredEnabled
    || !runtime.sceneActive
    || !runtime.eventTarget?.addEventListener
  ) return;
  if (runtime.orientationSupported) {
    runtime.eventTarget.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
  }
  if (runtime.pointerSupported) {
    runtime.eventTarget.addEventListener('pointermove', onPointerMove, { passive: true });
  }
  runtime.attached = true;
}

function configureRuntime(options = {}) {
  const ownsTarget = Object.prototype.hasOwnProperty.call(options, 'eventTarget');
  const ownsCtor = Object.prototype.hasOwnProperty.call(options, 'DeviceOrientationEvent');
  const nextTarget = ownsTarget
    ? options.eventTarget
    : runtime.eventTarget ?? defaultEventTarget();
  const nextCtor = ownsCtor
    ? options.DeviceOrientationEvent
    : runtime.orientationCtor ?? defaultOrientationCtor();
  if (runtime.attached && nextTarget !== runtime.eventTarget) detachListeners();
  runtime.eventTarget = nextTarget;
  runtime.orientationCtor = nextCtor;
  runtime.orientationSupported = typeof nextCtor === 'function'
    || typeof nextCtor?.requestPermission === 'function';
  runtime.pointerSupported = !!nextTarget?.addEventListener;
}

/**
 * Enable the engine and request iOS orientation permission.
 *
 * V4/G58 must invoke this directly inside the toggle's click callback (do not
 * put a dynamic import before it). Resolves `true` only when the engine can
 * run; `false` means G58 must persist OFF and show its denied toast. Desktop
 * without DeviceOrientation still resolves true and uses pointer fallback.
 *
 * @param {{eventTarget?: object, DeviceOrientationEvent?: object}} [options]
 *   injection seam for node tests
 * @returns {Promise<boolean>}
 */
export async function enableGyro(options = {}) {
  configureRuntime(options);
  if (!runtime.eventTarget?.addEventListener) {
    disableGyro();
    return false;
  }

  const requestPermission = runtime.orientationCtor?.requestPermission;
  if (typeof requestPermission === 'function') {
    let permission;
    try {
      // The call expression executes before the first await yields, so this
      // remains inside the settings-toggle user activation on iOS 13+.
      permission = await requestPermission.call(runtime.orientationCtor);
    } catch {
      disableGyro();
      return false;
    }
    if (permission !== 'granted') {
      disableGyro();
      return false;
    }
  }

  runtime.desiredEnabled = true;
  resetMotion();
  attachListeners();
  return true;
}

/** PLAN4 §B8 compatibility name for G58's documented consumer contract. */
export const requestEnable = enableGyro;

/**
 * Disable immediately: detach every sensor/pointer listener and zero state.
 * G58 calls this synchronously when the settings toggle is switched off.
 */
export function disableGyro() {
  detachListeners();
  runtime.desiredEnabled = false;
  resetMotion();
}

/**
 * Home-scene lifecycle gate. It keeps enabled listeners out of minigames while
 * preserving the granted/on state for the next home entry.
 */
export function setGyroSceneActive(active) {
  runtime.sceneActive = active === true;
  if (runtime.sceneActive) attachListeners();
  else {
    detachListeners();
    resetMotion();
  }
}

/**
 * Restore/follow the persisted strict-boolean setting without ever prompting.
 * Permission prompting remains exclusively in `enableGyro()`'s tap contract.
 */
export function syncGyroSetting(enabled) {
  configureRuntime();
  if (enabled !== true) {
    disableGyro();
    return false;
  }
  runtime.desiredEnabled = true;
  attachListeners();
  return true;
}

/** @returns {boolean} whether the strict setting/engine is enabled */
export function isGyroEnabled() {
  return runtime.desiredEnabled;
}

/**
 * Per-frame engine step; returns one reused `{x,y}` object in metres.
 * Suppressed home states ease to zero; the FPS suspension uses a 1 s ease.
 */
export function updateGyroParallax(dtSec, suppressed = false) {
  if (!runtime.desiredEnabled || !runtime.sceneActive) {
    runtime.offset.x = 0;
    runtime.offset.y = 0;
    return runtime.offset;
  }

  updateFpsGuard(runtime.guard, dtSec);
  const source = chooseParallaxSource(
    runtime.desiredEnabled,
    runtime.sceneActive,
    runtime.orientationSampled,
    runtime.pointerSupported,
  );

  if (source === 'orientation') {
    adaptNeutral(
      runtime.neutral,
      runtime.rawBeta,
      runtime.rawGamma,
      dtSec,
    );
    parallaxOffset(
      runtime.rawBeta,
      runtime.rawGamma,
      runtime.neutral,
      runtime.target,
    );
  } else if (source === 'pointer') {
    runtime.target.x = runtime.pointerTarget.x;
    runtime.target.y = runtime.pointerTarget.y;
  } else {
    runtime.target.x = 0;
    runtime.target.y = 0;
  }

  if (suppressed || runtime.guard.suspended) {
    runtime.target.x = 0;
    runtime.target.y = 0;
  }
  return smoothOffset(
    runtime.offset,
    runtime.target,
    dtSec,
    runtime.guard.suspended
      ? GYRO_PARALLAX.SUSPEND_TAU_SEC
      : GYRO_PARALLAX.SMOOTH_TAU_SEC,
  );
}

/** On-demand diagnostics for CDP/tests; never called by the frame loop. */
export function getGyroDebugState() {
  return {
    enabled: runtime.desiredEnabled,
    sceneActive: runtime.sceneActive,
    attached: runtime.attached,
    source: chooseParallaxSource(
      runtime.desiredEnabled,
      runtime.sceneActive,
      runtime.orientationSampled,
      runtime.pointerSupported,
    ),
    orientationSampled: runtime.orientationSampled,
    neutral: { beta: runtime.neutral.beta, gamma: runtime.neutral.gamma },
    offset: { x: runtime.offset.x, y: runtime.offset.y },
    fps: runtime.guard.fps,
    suspended: runtime.guard.suspended,
  };
}
