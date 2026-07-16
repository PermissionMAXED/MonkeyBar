// Programmatic animation clips (§D2.4) — all 14, as pure pose-channel writers
// (no three.js import; gooby.js maps pose channels onto pivots each frame).
// Clips ADD offsets onto the emotion base pose, so e.g. a grumpy Gooby still
// breathes with idle. `createClipPlayer()` runs clips, resolves play()
// promises on end and forwards timed events (Zzz puffs, crumbs…) to gooby.js.
//
// Pose channel conventions (all rotations rad, positions in rig units):
//   scaleX/Y/Z   body squash-and-stretch multipliers (1 = rest)
//   posX/posY/posZ  root offsets (posY = hop height)
//   rotX/rotY/rotZ  whole-body rotation
//   headPitch/headYaw/headRoll   (+pitch looks down)
//   earL/earR     ear droop (+ folds back/down), earLRoll/earRRoll sideways
//   armL/armR     arm swing (+ = forward/up), armLRoll/armRRoll (+ = out)
//   footL/footR   foot pitch
//   mouth         mouth-shape id override (null = emotion default)
//   mouthScale    multiplier on the active mouth
//   mouthOpen     0..1 open-mouth morph (eat/yawn)
//   lids          eyelid override 0..1.25 (null = emotion default)
//   cheek         cheek scale pulse (1 = rest)

const TAU = Math.PI * 2;

/** Fresh rest pose. gooby.js calls this every frame before layering. */
export function restPose() {
  return {
    scaleX: 1, scaleY: 1, scaleZ: 1,
    posX: 0, posY: 0, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    headPitch: 0, headYaw: 0, headRoll: 0,
    earL: 0, earR: 0, earLRoll: 0, earRRoll: 0,
    armL: 0, armR: 0, armLRoll: 0, armRRoll: 0,
    footL: 0, footR: 0,
    mouth: null, mouthScale: 1, mouthOpen: 0,
    lids: null, cheek: 1,
  };
}

/** smoothstep 0..1 */
function ss(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Has `period` elapsed between rawT-dt and rawT? (loop-safe event trigger) */
function every(period, rawT, dt) {
  return Math.floor(rawT / period) > Math.floor((rawT - dt) / period);
}

/**
 * @typedef {Object} ClipDef
 * @property {number} duration seconds (one loop for looping clips)
 * @property {boolean|'hold'} loop  true = wraps, 'hold' = clamps at end until stop()
 * @property {boolean} [overlay]    overlay clips don't stop the main clip (pokeWobble)
 * @property {(pose: object, t: number, io: {rawT: number, dt: number, dir: {x:number,z:number}|null, event: (name: string) => void}) => void} apply
 */

/** @type {Record<string, ClipDef>} */
export const CLIPS = {
  // breathe: body scaleY 1↔1.03, ears sway ±3°, occasional weight shift
  idle: {
    duration: 2.6,
    loop: true,
    apply(pose, t, io) {
      const breathe = Math.sin((t / 2.6) * TAU - Math.PI / 2) * 0.5 + 0.5;
      pose.scaleY *= 1 + breathe * 0.03;
      pose.scaleX *= 1 - breathe * 0.008;
      pose.scaleZ *= 1 - breathe * 0.008;
      const sway = Math.sin((t / 2.6) * TAU) * 0.052; // ±3°
      pose.earL += sway;
      pose.earR += Math.sin((t / 2.6) * TAU + 0.9) * 0.052;
      pose.earLRoll += sway * 0.4;
      pose.earRRoll -= sway * 0.4;
      // occasional weight shift on a slow secondary period
      pose.rotZ += Math.sin((io.rawT / 7.4) * TAU) * 0.022;
      pose.headRoll += Math.sin((io.rawT / 5.2) * TAU) * 0.02;
      pose.armLRoll += breathe * 0.05;
      pose.armRRoll += breathe * 0.05;
    },
  },

  // 2 hops y+0.12, squash 1.15/0.85 on land, ears flop counter-phase
  happyBounce: {
    duration: 0.9,
    loop: false,
    apply(pose, t, io) {
      const hop = Math.abs(Math.sin((t / 0.45) * Math.PI)); // 2 hops
      pose.posY += hop * 0.12;
      const landing = 1 - hop;
      pose.scaleY *= 1 - landing * 0.15 + hop * 0.06; // 0.85 squash ↔ slight stretch
      pose.scaleX *= 1 + landing * 0.15 - hop * 0.04;
      pose.scaleZ *= 1 + landing * 0.15 - hop * 0.04;
      pose.earL += -hop * 0.5 + 0.15; // flop counter-phase to the hop
      pose.earR += -hop * 0.5 + 0.15;
      pose.mouth = 'smile';
      pose.mouthScale *= 1.15;
      if (every(0.45, io.rawT, io.dt)) io.event('land');
    },
  },

  // head −15° pitch, ears droop 40°, arms hang; holds until stop()
  sadSlump: {
    duration: 0.8,
    loop: 'hold',
    apply(pose, t) {
      const k = ss(t / 0.8);
      pose.headPitch += k * 0.26; // −15° = look down
      pose.earL += k * 0.7; // droop 40°
      pose.earR += k * 0.7;
      pose.armL -= k * 0.5; // hang limp
      pose.armR -= k * 0.5;
      pose.armLRoll += k * 0.12;
      pose.armRRoll += k * 0.12;
      pose.scaleY *= 1 - k * 0.03;
      pose.mouth = 'frown';
      pose.lids = Math.max(pose.lids ?? 0, k * 0.3);
    },
  },

  // per bite 1.3 s: open 0.2 s → 6 chew cycles 0.15 s (cheeks 1.15) → swallow ripple
  eat: {
    duration: 1.3,
    loop: false,
    apply(pose, t, io) {
      if (t < 0.2) {
        pose.mouthOpen = Math.max(pose.mouthOpen, ss(t / 0.2));
      } else if (t < 1.1) {
        const chew = (t - 0.2) / 0.15; // 6 cycles
        const c = Math.sin(chew * Math.PI) * 0.5 + 0.5;
        pose.mouth = 'chew';
        pose.mouthScale *= 0.7 + c * 0.5;
        pose.cheek *= 1 + c * 0.15;
        pose.headPitch += Math.sin(chew * Math.PI) * 0.02;
        if (every(0.15, io.rawT - 0.2, io.dt) && t > 0.22) io.event('chew');
      } else {
        const k = (t - 1.1) / 0.2; // swallow: body scaleY ripple
        pose.scaleY *= 1 + Math.sin(k * Math.PI) * 0.06;
        pose.scaleX *= 1 - Math.sin(k * Math.PI) * 0.03;
        pose.mouth = 'smile';
      }
    },
  },

  // lying down, breathe 1.04, eyes closed, Zzz every 2.5 s
  sleep: {
    duration: 2.2,
    loop: true,
    apply(pose, t, io) {
      const settle = ss(Math.min(1, io.rawT / 0.6)); // ease into the pose
      pose.rotX -= settle * 1.22; // lie on his back
      pose.posY += settle * 0.16;
      pose.posZ -= settle * 0.1;
      const breathe = Math.sin((t / 2.2) * TAU) * 0.5 + 0.5;
      pose.scaleY *= 1 + breathe * 0.04;
      pose.scaleX *= 1 + breathe * 0.012;
      pose.lids = 1.25; // eyes closed
      pose.mouth = 'flat';
      pose.mouthScale *= 0.7;
      pose.earL += settle * 0.45;
      pose.earR += settle * 0.5;
      pose.armL -= settle * 0.3;
      pose.armR -= settle * 0.3;
      pose.mouthOpen = Math.max(pose.mouthOpen, breathe * 0.12); // tiny snore lip
      if (every(2.5, io.rawT, io.dt)) io.event('zzz');
    },
  },

  // stretch arms up, ears perk, big yawn
  wake: {
    duration: 1.2,
    loop: false,
    apply(pose, t) {
      const k = Math.sin(Math.min(1, t / 1.05) * Math.PI); // up then down
      pose.armL += k * 2.4; // stretch overhead
      pose.armR += k * 2.4;
      pose.armLRoll += k * 0.5;
      pose.armRRoll += k * 0.5;
      pose.scaleY *= 1 + k * 0.06;
      pose.scaleX *= 1 - k * 0.02;
      pose.earL -= k * 0.2; // perk
      pose.earR -= k * 0.2;
      pose.headPitch -= k * 0.18;
      pose.mouthOpen = Math.max(pose.mouthOpen, k);
      pose.lids = Math.max(pose.lids ?? 0, k * 0.5); // yawn squint
    },
  },

  // rapid body wiggle rotZ ±6°, giggle mouth, cheeks pulse
  tickle: {
    duration: 0.5,
    loop: true,
    apply(pose, t) {
      pose.rotZ += Math.sin((t / 0.25) * TAU) * 0.105; // ±6°
      pose.scaleY *= 1 + Math.sin((t / 0.125) * TAU) * 0.02;
      pose.cheek *= 1.12 + Math.sin((t / 0.25) * TAU) * 0.06;
      pose.mouth = 'smile';
      pose.mouthScale *= 1.25;
      pose.earLRoll += Math.sin((t / 0.25) * TAU) * 0.12;
      pose.earRRoll += Math.sin((t / 0.25) * TAU + 1) * 0.12;
      pose.lids = Math.max(pose.lids ?? 0, 0.25); // squeezed-happy eyes
    },
  },

  // damped spring impulse ±0.25 rad toward dir (freq 3 Hz, ζ 0.35) — overlay
  pokeWobble: {
    duration: 1.2,
    loop: false,
    overlay: true,
    apply(pose, t, io) {
      const zeta = 0.35;
      const omega = TAU * 3;
      const omegaD = omega * Math.sqrt(1 - zeta * zeta);
      const wobble = 0.25 * Math.exp(-zeta * omega * t) * Math.sin(omegaD * t);
      const dir = io.dir ?? { x: 0, z: 1 };
      const len = Math.hypot(dir.x, dir.z) || 1;
      pose.rotX += (dir.z / len) * wobble;
      pose.rotZ += -(dir.x / len) * wobble;
      pose.scaleY *= 1 - Math.abs(wobble) * 0.3;
      pose.scaleX *= 1 + Math.abs(wobble) * 0.2;
      pose.scaleZ *= 1 + Math.abs(wobble) * 0.2;
    },
  },

  // head circles, spiral pupils, stars particle ring
  dizzy: {
    duration: 2.0,
    loop: false,
    apply(pose, t, io) {
      if (io.rawT <= io.dt) io.event('dizzyStart'); // first frame
      const k = Math.min(1, t / 0.25) * ss(Math.min(1, (2.0 - t) / 0.3));
      const a = t * TAU * 1.4;
      pose.headYaw += Math.sin(a) * 0.3 * k;
      pose.headPitch += Math.cos(a) * 0.18 * k;
      pose.headRoll += Math.sin(a + 1.2) * 0.12 * k;
      pose.rotZ += Math.sin(a) * 0.05 * k;
      pose.mouth = 'open';
      pose.mouthScale *= 0.85;
      pose.armLRoll += k * 0.35;
      pose.armRRoll += k * 0.35;
      if (t + io.dt >= 2.0) io.event('dizzyEnd');
    },
  },

  // side-steps + arm pumps at 100 BPM (0.6 s/beat, 2 beats/loop), ear swings
  dance: {
    duration: 1.2,
    loop: true,
    apply(pose, t) {
      const beat = (t / 0.6) * Math.PI; // π per beat
      pose.posX += Math.sin(beat) * 0.07;
      pose.posY += Math.abs(Math.sin(beat * 2)) * 0.045;
      pose.rotZ += Math.sin(beat) * 0.1;
      pose.armL += Math.max(0, Math.sin(beat)) * 1.5; // alternating pumps
      pose.armR += Math.max(0, -Math.sin(beat)) * 1.5;
      pose.armLRoll += 0.25;
      pose.armRRoll += 0.25;
      pose.earL += Math.sin(beat + 0.5) * 0.25;
      pose.earR += Math.sin(beat + 0.5 + Math.PI) * 0.25;
      pose.headRoll += Math.sin(beat) * 0.09;
      pose.scaleY *= 1 + Math.abs(Math.sin(beat * 2)) * 0.03;
      pose.mouth = 'smile';
      pose.mouthScale *= 1.2;
    },
  },

  // right arm raise + 3 waves
  wave: {
    duration: 1.0,
    loop: false,
    apply(pose, t) {
      const up = ss(t / 0.18) * ss((1.0 - t) / 0.15);
      pose.armR += up * 2.5; // raise
      pose.armRRoll += up * (0.45 + Math.sin(((t - 0.18) / 0.55) * Math.PI * 3) * 0.5); // 3 waves
      pose.headRoll -= up * 0.08;
      pose.mouth = 'smile';
      pose.mouthScale *= 1.1;
    },
  },

  // crouch 0.85 → leap y+0.25 → land squash
  jump: {
    duration: 0.6,
    loop: false,
    apply(pose, t, io) {
      if (t < 0.16) {
        const k = t / 0.16;
        pose.scaleY *= 1 - k * 0.15; // crouch 0.85
        pose.scaleX *= 1 + k * 0.1;
        pose.scaleZ *= 1 + k * 0.1;
      } else if (t < 0.48) {
        const k = (t - 0.16) / 0.32;
        pose.posY += Math.sin(k * Math.PI) * 0.25;
        pose.scaleY *= 1 + Math.sin(k * Math.PI) * 0.08; // stretch mid-air
        pose.scaleX *= 1 - Math.sin(k * Math.PI) * 0.05;
        pose.earL += Math.sin(k * Math.PI) * 0.35;
        pose.earR += Math.sin(k * Math.PI) * 0.35;
      } else {
        const k = (t - 0.48) / 0.12;
        const sq = Math.sin(k * Math.PI);
        pose.scaleY *= 1 - sq * 0.15; // land squash
        pose.scaleX *= 1 + sq * 0.12;
        pose.scaleZ *= 1 + sq * 0.12;
        if (t - io.dt < 0.48) io.event('land'); // touchdown crossing
      }
    },
  },

  // head shake ×3, flat mouth
  refuse: {
    duration: 0.7,
    loop: false,
    apply(pose, t) {
      const env = ss(Math.min(1, t / 0.08)) * ss((0.7 - t) / 0.12);
      pose.headYaw += Math.sin((t / 0.7) * Math.PI * 6) * 0.38 * env; // ×3 shakes
      pose.mouth = 'flat';
      pose.earLRoll += Math.sin((t / 0.7) * Math.PI * 6 + 0.6) * 0.1 * env;
      pose.earRRoll += Math.sin((t / 0.7) * Math.PI * 6 + 0.6) * 0.1 * env;
    },
  },

  // seated pose (for the car), paws on the wheel; holds until stop()
  sitDrive: {
    duration: 0.35,
    loop: 'hold',
    apply(pose, t) {
      const k = ss(t / 0.35);
      pose.posY -= k * 0.12; // sit
      pose.rotX -= k * 0.08;
      pose.footL -= k * 1.25; // legs forward
      pose.footR -= k * 1.25;
      pose.armL += k * 1.7; // paws on wheel
      pose.armR += k * 1.7;
      pose.armLRoll -= k * 0.15;
      pose.armRRoll -= k * 0.15;
      pose.headPitch += k * 0.04;
    },
  },
};

/** The 14 clip ids (§D2.4) — registry completeness is unit-tested. */
export const CLIP_IDS = Object.freeze(Object.keys(CLIPS));

/**
 * Clip player: runs one main clip + any overlay clips, layered onto a pose.
 *
 * @returns {{
 *   play: (id: string, opts?: {loop?: boolean|'hold', speed?: number, dir?: {x:number,z:number}}) => Promise<void>,
 *   stop: (id?: string) => void,
 *   isPlaying: (id: string) => boolean,
 *   activeIds: () => string[],
 *   update: (dt: number, pose: object, io?: {event?: (name: string) => void}) => void,
 * }}
 */
export function createClipPlayer() {
  /** @type {Map<string, {def: ClipDef, t: number, loop: boolean|'hold', speed: number, dir: object|null, resolve: () => void, done: boolean}>} */
  const active = new Map();

  function finish(id) {
    const entry = active.get(id);
    if (!entry) return;
    active.delete(id);
    if (!entry.done) {
      entry.done = true;
      entry.resolve();
    }
  }

  return {
    /**
     * Start a clip (§D2.3 play). Non-overlay clips replace the current main
     * clip. Resolves when the clip ends (looping/hold clips: when stopped).
     */
    play(id, opts = {}) {
      const def = CLIPS[id];
      if (!def) return Promise.reject(new Error(`[goobyAnims] unknown clip '${id}'`));
      if (!def.overlay) {
        for (const [otherId, e] of [...active]) {
          if (!e.def.overlay) finish(otherId);
        }
      } else {
        finish(id);
      }
      return new Promise((resolve) => {
        active.set(id, {
          def,
          t: 0,
          loop: opts.loop ?? def.loop,
          speed: opts.speed ?? 1,
          dir: opts.dir ?? null,
          resolve,
          done: false,
        });
      });
    },

    /** Stop one clip (or all when id omitted); resolves its play() promise. */
    stop(id) {
      if (id == null) {
        for (const key of [...active.keys()]) finish(key);
      } else {
        finish(id);
      }
    },

    isPlaying(id) {
      return active.has(id);
    },

    activeIds() {
      return [...active.keys()];
    },

    /** Advance all active clips and layer them onto `pose`. */
    update(dt, pose, io = {}) {
      const event = io.event ?? (() => {});
      for (const [id, e] of [...active]) {
        e.t += dt * e.speed;
        const d = e.def.duration;
        let tClip;
        if (e.loop === true) {
          tClip = e.t % d;
        } else if (e.loop === 'hold') {
          tClip = Math.min(e.t, d);
        } else if (e.t >= d) {
          // one-shot finished: apply the final frame, then resolve
          e.def.apply(pose, d - 1e-6, { rawT: e.t, dt: dt * e.speed, dir: e.dir, event });
          finish(id);
          continue;
        } else {
          tClip = e.t;
        }
        e.def.apply(pose, tClip, { rawT: e.t, dt: dt * e.speed, dir: e.dir, event });
      }
    },
  };
}
