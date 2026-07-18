// V3/G39 (PLAN3 §C7.2): drive-feel math — PURE (no three.js/DOM imports) so
// test/cityRoads.test.js runs it headlessly under node:test, while
// city/carController.js drives all three consumers (cityDrive trip, cityDrive
// arcade, deliveryRush) through the same functions. Exact §C7.2 numbers live
// here as exported frozen consts (§E0.1-3 — constants.js is read-only; the
// v1 LANE_SNAP_*/CAM_* rows in DRIVE_TUNING are superseded by FEEL below).

const DEG = Math.PI / 180;

/** §C7.2 tuning (verbatim numbers from the spec). */
export const FEEL = Object.freeze({
  /** Steering input low-pass time constant (s): τ = 120 ms exponential. */
  STEER_SMOOTH_TAU_S: 0.12,
  /** Output steering(yaw)-rate cap (rad/s): 90°/s — was effectively instant. */
  STEER_RATE_CAP_RAD_S: 90 * DEG,
  /** Lane-assist spring: max correction toward lane center (rad/s): 8°/s. */
  ASSIST_MAX_RATE_RAD_S: 8 * DEG,
  /** Assist force fades linearly to 0 at this player-intent angle: 25°. */
  ASSIST_FADE_END_RAD: 25 * DEG,
  /** Assist fully disabled while actively steering ≥ 40 % deflection. */
  ASSIST_OFF_DEFLECTION: 0.4,
  /** Chase cam: damped position follow k = 4.0/s (was a 4.5 hard-ish lerp). */
  CAM_POS_LERP_K: 4.0,
  /** Chase cam: look-ahead point 6 m ahead of the car (was 7). */
  CAM_LOOKAHEAD_M: 6,
  /** FOV 55° → 60° scaling with speed over 9 → 13 m/s. */
  FOV_MIN_DEG: 55,
  FOV_MAX_DEG: 60,
  FOV_SPEED_FROM_MS: 9,
  FOV_SPEED_TO_MS: 13,
});

/**
 * One exponential low-pass step of the steering input (§C7.2: τ = 120 ms):
 * `smoothed` chases `target` closing (1 − e^(−dt/τ)) of the gap per step —
 * step response reaches 63.2 % of a step input after exactly τ seconds,
 * independent of frame rate.
 * @param {number} smoothed current filtered steering −1..1
 * @param {number} target raw thumb/autopilot input −1..1
 * @param {number} dt seconds
 * @returns {number}
 */
export function smoothSteer(smoothed, target, dt) {
  if (!(dt > 0)) return smoothed;
  return smoothed + (target - smoothed) * (1 - Math.exp(-dt / FEEL.STEER_SMOOTH_TAU_S));
}

/**
 * Commanded yaw rate (rad/s) from the filtered steering — the §C7.2 output
 * rate cap: |result| ≤ 90°/s no matter the steer-rate/damping product.
 * @param {number} smoothedSteer −1..1 filtered input
 * @param {number} steerRate rad/s at full deflection (DRIVE_TUNING.STEER_RATE)
 * @param {number} damp speed damping factor 0..1
 * @returns {number} rad/s, capped
 */
export function steerYawRate(smoothedSteer, steerRate, damp) {
  const raw = smoothedSteer * steerRate * damp;
  return Math.max(-FEEL.STEER_RATE_CAP_RAD_S, Math.min(FEEL.STEER_RATE_CAP_RAD_S, raw));
}

/**
 * Lane-assist spring force curve (§C7.2): correction rate (rad/s, SIGNED
 * toward the lane heading) for a player-intent angle. Max 8°/s at 0° intent,
 * fading linearly to 0 at 25°, hard 0 beyond — and hard 0 while the player
 * is actively steering (|deflection| ≥ 40 %): assist never fights the thumb.
 * @param {number} intentRad wrapAngle(laneCardinal − heading), radians
 * @param {number} deflection raw steering input −1..1
 * @returns {number} rad/s (signed like intentRad; 0 when disabled)
 */
export function assistRate(intentRad, deflection) {
  if (Math.abs(deflection) >= FEEL.ASSIST_OFF_DEFLECTION) return 0;
  const fade = assistFade(intentRad);
  return Math.sign(intentRad) * FEEL.ASSIST_MAX_RATE_RAD_S * fade;
}

/**
 * The assist fade factor 1 → 0 over 0° → 25° intent angle (shared by the
 * heading spring and the lateral lane-centering ease).
 * @param {number} intentRad radians
 * @returns {number} 0..1
 */
export function assistFade(intentRad) {
  return Math.max(0, 1 - Math.abs(intentRad) / FEEL.ASSIST_FADE_END_RAD);
}

/**
 * Frame-rate-independent chase-cam follow factor (§C7.2: position lerp
 * k = 4.0/s): the camera closes (1 − e^(−k·dt)) of the gap per frame, so the
 * remaining lag after t seconds is bounded by e^(−4t) (≈ 2 % after 1 s).
 * @param {number} dt seconds
 * @returns {number} 0..1 lerp factor
 */
export function camFollowFactor(dt) {
  return 1 - Math.exp(-FEEL.CAM_POS_LERP_K * Math.max(0, dt));
}

/**
 * Chase-cam FOV for a speed (§C7.2): 55° at ≤ 9 m/s → 60° at ≥ 13 m/s,
 * linear in between (the arcade's 15 m/s cap stays clamped at 60°).
 * @param {number} speed m/s
 * @returns {number} degrees
 */
export function chaseFov(speed) {
  const f = (speed - FEEL.FOV_SPEED_FROM_MS) / (FEEL.FOV_SPEED_TO_MS - FEEL.FOV_SPEED_FROM_MS);
  const t = Math.max(0, Math.min(1, f));
  return FEEL.FOV_MIN_DEG + (FEEL.FOV_MAX_DEG - FEEL.FOV_MIN_DEG) * t;
}
