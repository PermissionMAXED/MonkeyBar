// V4/G60 — §B8/§C-SYS8 pure gyro/pointer mapping, neutral EMA, smoothing,
// fallback selection, FPS hysteresis and permission/listener contract.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GYRO_PARALLAX,
  deadzoneDegrees,
  parallaxOffset,
  pointerParallaxOffset,
  lerpAlpha,
  adaptNeutral,
  smoothOffset,
  createFpsGuard,
  updateFpsGuard,
  selectParallaxSource,
  enableGyro,
  disableGyro,
  setGyroSceneActive,
  getGyroDebugState,
} from '../src/systems/gyroParallax.js';

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ≈ ${expected} (±${epsilon})`,
  );
}

function runFrames(guard, fps, seconds = 5) {
  const frames = Math.ceil(fps * seconds);
  for (let i = 0; i < frames; i += 1) updateFpsGuard(guard, 1 / fps);
  return guard;
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

test('§C-SYS8.3: frozen mapping and timing constants are exact', () => {
  assert.ok(Object.isFrozen(GYRO_PARALLAX));
  assert.deepEqual(GYRO_PARALLAX, {
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
});

test('deadzone is zero through ±2° and continuous outside it', () => {
  for (const value of [-2, -1.999, 0, 1.999, 2]) {
    assert.equal(deadzoneDegrees(value), 0);
  }
  approx(deadzoneDegrees(3), 1);
  approx(deadzoneDegrees(-3), -1);
  approx(deadzoneDegrees(2.25), 0.25);
});

test('gyro mapping uses gamma→x and beta→negative y at 0.008 m/°', () => {
  assert.deepEqual(parallaxOffset(0, 0), { x: 0, y: 0 });
  assert.deepEqual(parallaxOffset(3, 3), { x: 0.008, y: -0.008 });
  assert.deepEqual(parallaxOffset(-3, -3), { x: -0.008, y: 0.008 });
});

test('gyro mapping clamps horizontal at ±0.12 m', () => {
  assert.deepEqual(parallaxOffset(0, 1_000), { x: 0.12, y: 0 });
  assert.deepEqual(parallaxOffset(0, -1_000), { x: -0.12, y: 0 });
  approx(parallaxOffset(0, 17).x, 0.12);
  approx(parallaxOffset(0, -17).x, -0.12);
});

test('gyro mapping clamps vertical at ±0.08 m', () => {
  assert.deepEqual(parallaxOffset(-1_000, 0), { x: 0, y: 0.08 });
  assert.deepEqual(parallaxOffset(1_000, 0), { x: 0, y: -0.08 });
  approx(parallaxOffset(12, 0).y, -0.08);
  approx(parallaxOffset(-12, 0).y, 0.08);
});

test('gyro mapping is relative to the slow neutral pose', () => {
  assert.deepEqual(
    parallaxOffset(12, 22, { beta: 10, gamma: 20 }),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    parallaxOffset(13, 23, { beta: 10, gamma: 20 }),
    { x: 0.008, y: -0.008 },
  );
});

test('gyro mapping sanitizes non-finite input', () => {
  assert.deepEqual(parallaxOffset(NaN, Infinity), { x: 0, y: 0 });
  assert.deepEqual(parallaxOffset(undefined, null), { x: 0, y: 0 });
});

test('pointer center is neutral and viewport edges clamp at ±0.06 m', () => {
  assert.deepEqual(pointerParallaxOffset(0, 0), { x: 0, y: 0 });
  assert.deepEqual(pointerParallaxOffset(1, 1), { x: 0.06, y: 0.06 });
  assert.deepEqual(pointerParallaxOffset(-1, -1), { x: -0.06, y: -0.06 });
  assert.deepEqual(pointerParallaxOffset(99, -99), { x: 0.06, y: -0.06 });
});

test('pointer fallback uses the same continuous deadzone pipeline', () => {
  const justInside = pointerParallaxOffset(0.5, -0.5);
  assert.ok(justInside.x > 0 && justInside.x < GYRO_PARALLAX.POINTER_MAX_M);
  assert.ok(justInside.y < 0 && justInside.y > -GYRO_PARALLAX.POINTER_MAX_M);
});

test('neutral pose initializes immediately then adapts with τ=4 s', () => {
  const neutral = { beta: 0, gamma: 0, initialized: false };
  adaptNeutral(neutral, 10, -5, 0.016);
  assert.deepEqual(neutral, { beta: 10, gamma: -5, initialized: true });

  adaptNeutral(neutral, 20, 5, 4);
  const alpha = 1 - Math.exp(-1);
  approx(neutral.beta, 10 + 10 * alpha);
  approx(neutral.gamma, -5 + 10 * alpha);
});

test('150 ms smoothing is time-based and frame-rate independent', () => {
  approx(lerpAlpha(0.15, 0.15), 1 - Math.exp(-1));
  const once = smoothOffset({ x: 0, y: 0 }, { x: 0.12, y: -0.08 }, 0.15);
  const split = { x: 0, y: 0 };
  smoothOffset(split, { x: 0.12, y: -0.08 }, 0.075);
  smoothOffset(split, { x: 0.12, y: -0.08 }, 0.075);
  approx(split.x, once.x);
  approx(split.y, once.y);
});

test('source selection prefers a real sensor sample over pointer fallback', () => {
  assert.equal(selectParallaxSource({
    enabled: false, sceneActive: true, orientationSampled: true, pointerSupported: true,
  }), 'none');
  assert.equal(selectParallaxSource({
    enabled: true, sceneActive: false, orientationSampled: true, pointerSupported: true,
  }), 'none');
  assert.equal(selectParallaxSource({
    enabled: true, sceneActive: true, orientationSampled: false, pointerSupported: true,
  }), 'pointer');
  assert.equal(selectParallaxSource({
    enabled: true, sceneActive: true, orientationSampled: true, pointerSupported: true,
  }), 'orientation');
  assert.equal(selectParallaxSource({
    enabled: true, sceneActive: true, orientationSampled: false, pointerSupported: false,
  }), 'none');
});

test('FPS guard suspends after a 5 s window below 25 fps', () => {
  const guard = createFpsGuard();
  runFrames(guard, 24);
  assert.equal(guard.suspended, true);
  approx(guard.fps, 24, 1e-7);
});

test('FPS guard does not suspend at exactly 25 fps', () => {
  const guard = createFpsGuard();
  runFrames(guard, 25);
  assert.equal(guard.suspended, false);
  approx(guard.fps, 25, 1e-7);
});

test('FPS guard hysteresis stays suspended at 30 and resumes at ≥35 fps', () => {
  const guard = createFpsGuard();
  runFrames(guard, 20);
  assert.equal(guard.suspended, true);
  runFrames(guard, 30);
  assert.equal(guard.suspended, true);
  runFrames(guard, 40);
  assert.equal(guard.suspended, false);
});

test('desktop/no-sensor enable selects pointer fallback', async () => {
  const target = fakeEventTarget();
  setGyroSceneActive(true);
  const ok = await enableGyro({ eventTarget: target, DeviceOrientationEvent: null });
  assert.equal(ok, true);
  assert.equal(target.count('deviceorientation'), 0);
  assert.equal(target.count('pointermove'), 1);
  assert.equal(getGyroDebugState().source, 'pointer');
  disableGyro();
  setGyroSceneActive(false);
});

test('iOS permission is invoked synchronously by enableGyro before its await', async () => {
  const target = fakeEventTarget();
  let called = false;
  const Orientation = {
    requestPermission() {
      called = true;
      return Promise.resolve('granted');
    },
  };
  setGyroSceneActive(true);
  const pending = enableGyro({ eventTarget: target, DeviceOrientationEvent: Orientation });
  assert.equal(called, true, 'requestPermission call stayed in the tap task');
  assert.equal(await pending, true);
  assert.equal(target.count('deviceorientation'), 1);
  assert.equal(target.count('pointermove'), 1);
  disableGyro();
  assert.equal(target.count('deviceorientation'), 0);
  assert.equal(target.count('pointermove'), 0);
  setGyroSceneActive(false);
});

test('denied or throwing iOS permission keeps engine off with zero listeners', async () => {
  for (const requestPermission of [
    () => Promise.resolve('denied'),
    () => Promise.reject(new Error('blocked')),
  ]) {
    const target = fakeEventTarget();
    setGyroSceneActive(true);
    assert.equal(await enableGyro({
      eventTarget: target,
      DeviceOrientationEvent: { requestPermission },
    }), false);
    assert.equal(getGyroDebugState().enabled, false);
    assert.equal(target.count('deviceorientation'), 0);
    assert.equal(target.count('pointermove'), 0);
    setGyroSceneActive(false);
  }
});
