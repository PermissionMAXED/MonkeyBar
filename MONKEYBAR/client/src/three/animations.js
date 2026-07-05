// Hand-written tween/animator + canned monkey clips — PLAN.md §2/§7
// (client/src/three/animations.js). No external animation libs.

// ---------------------------------------------------------------------------
// Ease curves
// ---------------------------------------------------------------------------

export const Ease = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => t * (2 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubicIn: (t) => t * t * t,
  cubicOut: (t) => 1 + --t * t * t,
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 + (t - 1) * (2 * t - 2) * (2 * t - 2)),
  sineInOut: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  backOut: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  backIn: (t) => {
    const c = 1.70158;
    return (c + 1) * t * t * t - c * t * t;
  },
  elasticOut: (t) =>
    t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  bounceOut: (t) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// ---------------------------------------------------------------------------
// Animator (tweens + sequencing + persistent updaters)
// ---------------------------------------------------------------------------

/**
 * Central animator; call `update(dt)` once per frame from the engine loop.
 */
export function createAnimator() {
  /** @type {Set<Object>} */
  const tweens = new Set();
  /** @type {Set<Function>} */
  const updaters = new Set();

  // P7 juice: micro hit-stop — freezes all tweens/updaters for a beat
  // (reveal flips, cannon THOOM). Real-time based so it can never wedge.
  let timeScale = 1;
  let hitStopTimer = null;
  function hitStop(seconds = 0.08) {
    timeScale = 0;
    if (hitStopTimer) clearTimeout(hitStopTimer);
    hitStopTimer = setTimeout(() => {
      timeScale = 1;
      hitStopTimer = null;
    }, Math.max(16, seconds * 1000));
  }

  /** Brief slow-motion (Grace's elegant plays). Real-time timer, never wedges. */
  function slowMo(scale = 0.4, seconds = 0.5) {
    if (hitStopTimer) return; // never fight an active hit-stop
    timeScale = Math.max(0.05, scale);
    hitStopTimer = setTimeout(() => {
      timeScale = 1;
      hitStopTimer = null;
    }, Math.max(16, seconds * 1000));
  }

  function tween({ duration = 0.5, delay = 0, ease = Ease.quadOut, onUpdate, onComplete, loop = false, yoyo = false, tag = null }) {
    let resolveP;
    const promise = new Promise((res) => (resolveP = res));
    const tw = {
      t: -delay,
      duration: Math.max(duration, 1e-4),
      ease,
      onUpdate,
      onComplete,
      loop,
      yoyo,
      tag,
      dead: false,
      promise,
      _resolve: resolveP,
      cancel() {
        if (tw.dead) return;
        tw.dead = true;
        tweens.delete(tw);
        tw._resolve();
      },
    };
    tweens.add(tw);
    return tw;
  }

  /**
   * Tween numeric properties of `target` toward `props`.
   * e.g. to(mesh.rotation, { x: -1.2 }, 0.3, { ease: Ease.backOut })
   */
  function to(target, props, duration, opts = {}) {
    /** @type {Record<string, number>} */
    let from = null;
    const keys = Object.keys(props);
    return tween({
      duration,
      ...opts,
      onUpdate(k) {
        if (!from) {
          from = {};
          for (const key of keys) from[key] = target[key];
        }
        for (const key of keys) target[key] = from[key] + (props[key] - from[key]) * k;
        if (opts.onUpdate) opts.onUpdate(k);
      },
    });
  }

  /** Promise that resolves after `seconds` of animator time. */
  function wait(seconds, opts = {}) {
    return tween({ duration: seconds, ...opts, onUpdate: null }).promise;
  }

  /** Run async steps in order; each step gets the animator. */
  async function sequence(steps) {
    for (const step of steps) await step();
  }

  return {
    tween,
    to,
    wait,
    sequence,
    hitStop,
    slowMo,
    /** Persistent per-frame updater; returns a remover. */
    addUpdater(fn) {
      updaters.add(fn);
      return () => updaters.delete(fn);
    },
    /** Cancel every tween carrying this tag. */
    cancelTag(tag) {
      for (const tw of [...tweens]) if (tw.tag === tag) tw.cancel();
    },
    update(dt) {
      dt *= timeScale;
      if (dt <= 0) return;
      for (const fn of updaters) fn(dt);
      for (const tw of [...tweens]) {
        if (tw.dead) continue;
        tw.t += dt;
        if (tw.t < 0) continue;
        let k = Math.min(tw.t / tw.duration, 1);
        let e = tw.ease(k);
        if (tw.yoyo) e = e < 0.5 ? tw.ease(k * 2) : tw.ease((1 - k) * 2);
        if (tw.onUpdate) tw.onUpdate(e, k);
        if (k >= 1) {
          if (tw.loop) {
            tw.t = 0;
          } else {
            tw.dead = true;
            tweens.delete(tw);
            if (tw.onComplete) tw.onComplete();
            tw._resolve();
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Monkey pose helpers
// ---------------------------------------------------------------------------

/**
 * Capture the current rotations/positions of all joints as the base pose.
 * `root` is skipped — its transform is owned by seat placement.
 */
export function capturePose(monkey) {
  const pose = {};
  for (const [name, joint] of Object.entries(monkey.joints)) {
    if (name === 'root') continue;
    pose[name] = {
      rot: { x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z },
      pos: { x: joint.position.x, y: joint.position.y, z: joint.position.z },
    };
  }
  return pose;
}

/** Tween all joints back to the monkey's base pose. */
export function resetPose(anim, monkey, duration = 0.35, tag = null) {
  const promises = [];
  for (const [name, joint] of Object.entries(monkey.joints)) {
    if (name === 'root') continue;
    const base = monkey.basePose[name];
    if (!base) continue;
    promises.push(anim.to(joint.rotation, base.rot, duration, { ease: Ease.quadInOut, tag }).promise);
    promises.push(anim.to(joint.position, base.pos, duration, { ease: Ease.quadInOut, tag }).promise);
  }
  return Promise.all(promises);
}

// ---------------------------------------------------------------------------
// Idle: sway + breathe + blink (runs whenever the monkey isn't in a clip)
// ---------------------------------------------------------------------------

/** Idle micro-clips (P7 juice) — occasional fidgets between the sway/breathe. */
const FIDGET_CLIPS = ['fidgetScratch', 'fidgetGlance', 'fidgetSip', 'fidgetStretch'];

/**
 * Attach a continuous idle behavior. Returns { stop }.
 * `monkey.state.busy > 0` (set by clips) pauses the procedural idle write.
 */
export function attachIdle(anim, monkey, { energy = 1 } = {}) {
  const phase = Math.random() * Math.PI * 2;
  let t = Math.random() * 10;
  let blinkIn = 1.5 + Math.random() * 3;
  let fidgetIn = 5 + Math.random() * 9;

  const remove = anim.addUpdater((dt) => {
    t += dt;
    // blink runs even during clips (unless KO'd)
    blinkIn -= dt;
    if (blinkIn <= 0 && monkey.state.baseExpression !== 'ko') {
      monkey.flashExpression('blink', 0.13);
      blinkIn = 1.6 + Math.random() * 3.4;
    }
    // occasional fidget: scratch, look around, sip a drink, stretch
    fidgetIn -= dt;
    if (fidgetIn <= 0) {
      fidgetIn = 7 + Math.random() * 10;
      if (monkey.state.busy === 0 && monkey.state.baseExpression !== 'ko') {
        playClip(anim, monkey, FIDGET_CLIPS[Math.floor(Math.random() * FIDGET_CLIPS.length)]);
      }
    }
    if (monkey.state.busy > 0) return;
    const e = energy * (monkey.state.twitchy || 1);
    const b = monkey.basePose;
    const j = monkey.joints;
    const sway = Math.sin(t * 0.9 * e + phase);
    const breathe = Math.sin(t * 2.1 * e + phase * 2);
    j.torso.rotation.z = b.torso.rot.z + sway * 0.045 * e;
    j.torso.rotation.x = b.torso.rot.x + breathe * 0.02;
    j.torso.scale.set(1, 1 + breathe * 0.015, 1 + breathe * 0.02);
    j.head.rotation.z = b.head.rot.z - sway * 0.06 * e;
    j.head.rotation.y = b.head.rot.y + Math.sin(t * 0.35 + phase) * 0.22;
    j.head.rotation.x = b.head.rot.x + Math.sin(t * 1.3 + phase) * 0.02;
    j.armL.rotation.z = b.armL.rot.z + sway * 0.03;
    j.armR.rotation.z = b.armR.rot.z - sway * 0.03;
    if (j.tail) j.tail.rotation.x = b.tail.rot.x + Math.sin(t * 1.4 + phase) * 0.15;
  });
  return { stop: remove };
}

// ---------------------------------------------------------------------------
// Canned clips — each is (anim, monkey, opts) => Promise
// ---------------------------------------------------------------------------

function busyWrap(monkey, fn) {
  monkey.state.busy = (monkey.state.busy || 0) + 1;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      monkey.state.busy = Math.max(0, monkey.state.busy - 1);
    });
}

const CLIP_TABLE = {
  /** Reach forward and place cards on the table. */
  async cardPlay(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('neutral');
    await Promise.all([
      anim.to(j.armR.rotation, { x: -1.9, z: -0.25 }, 0.28, { ease: Ease.quadOut }).promise,
      anim.to(j.torso.rotation, { x: 0.28 }, 0.28, { ease: Ease.quadOut }).promise,
      anim.to(j.head.rotation, { x: 0.15 }, 0.28).promise,
    ]);
    await anim.to(j.armR.rotation, { x: -1.15 }, 0.18, { ease: Ease.quadIn }).promise;
    await anim.wait(0.08);
    await resetPose(anim, monkey, 0.35);
  },

  /** Big two-handed table slam. */
  async slam(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('rage');
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.6 }, 0.25, { ease: Ease.backOut }).promise,
      anim.to(j.armR.rotation, { x: -2.6 }, 0.25, { ease: Ease.backOut }).promise,
      anim.to(j.torso.rotation, { x: -0.15 }, 0.25).promise,
    ]);
    await Promise.all([
      anim.to(j.armL.rotation, { x: -0.9 }, 0.1, { ease: Ease.quadIn }).promise,
      anim.to(j.armR.rotation, { x: -0.9 }, 0.1, { ease: Ease.quadIn }).promise,
      anim.to(j.torso.rotation, { x: 0.35 }, 0.1, { ease: Ease.quadIn }).promise,
    ]);
    await anim.wait(0.25);
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.4);
  },

  /** Point-and-shout — "MONKEY LIES!" */
  async point(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('rage');
    await Promise.all([
      anim.to(j.armR.rotation, { x: -2.35, z: -0.15 }, 0.22, { ease: Ease.backOut }).promise,
      anim.to(j.foreArmR.rotation, { x: 0.35 }, 0.22).promise,
      anim.to(j.torso.rotation, { x: 0.32 }, 0.22).promise,
      anim.to(j.head.rotation, { x: 0.1 }, 0.22).promise,
    ]);
    // insistent jabbing
    for (let i = 0; i < 3; i++) {
      await anim.to(j.armR.rotation, { x: -2.05 }, 0.09, { ease: Ease.quadInOut }).promise;
      await anim.to(j.armR.rotation, { x: -2.45 }, 0.09, { ease: Ease.quadInOut }).promise;
    }
    await anim.wait(0.35);
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.4);
  },

  /** Both arms up, bouncing cheer. */
  async cheer(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('grin');
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.9, z: 0.35 }, 0.3, { ease: Ease.backOut }).promise,
      anim.to(j.armR.rotation, { x: -2.9, z: -0.35 }, 0.3, { ease: Ease.backOut }).promise,
      anim.to(j.torso.rotation, { x: -0.12 }, 0.3).promise,
    ]);
    for (let i = 0; i < 3; i++) {
      await anim.to(j.hips.position, { y: monkey.basePose.hips.pos.y + 0.09 }, 0.14, { ease: Ease.quadOut }).promise;
      await anim.to(j.hips.position, { y: monkey.basePose.hips.pos.y }, 0.14, { ease: Ease.bounceOut }).promise;
    }
    await resetPose(anim, monkey, 0.45);
    monkey.setExpression('neutral');
  },

  /** Face in hands, shoulders heaving. */
  async sob(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('sweat');
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.5, z: 0.7 }, 0.35).promise,
      anim.to(j.armR.rotation, { x: -2.5, z: -0.7 }, 0.35).promise,
      anim.to(j.foreArmL.rotation, { x: -1.4 }, 0.35).promise,
      anim.to(j.foreArmR.rotation, { x: -1.4 }, 0.35).promise,
      anim.to(j.head.rotation, { x: 0.55 }, 0.35).promise,
      anim.to(j.torso.rotation, { x: 0.3 }, 0.35).promise,
    ]);
    for (let i = 0; i < 3; i++) {
      await anim.to(j.torso.rotation, { x: 0.38 }, 0.16, { ease: Ease.quadInOut }).promise;
      await anim.to(j.torso.rotation, { x: 0.26 }, 0.16, { ease: Ease.quadInOut }).promise;
    }
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.5);
  },

  /** Recoil in shock, hands near face. */
  async shock(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('shock');
    await Promise.all([
      anim.to(j.torso.rotation, { x: -0.35 }, 0.14, { ease: Ease.backOut }).promise,
      anim.to(j.head.rotation, { x: -0.25 }, 0.14).promise,
      anim.to(j.armL.rotation, { x: -2.1, z: 0.5 }, 0.14).promise,
      anim.to(j.armR.rotation, { x: -2.1, z: -0.5 }, 0.14).promise,
    ]);
    await anim.wait(0.7);
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.4);
  },

  /**
   * Cannon-hit: fly backward off the stool, flop on the floor, KO.
   * opts.floorY = world-space floor height relative to the root's parent (default 0).
   */
  async cannonHit(anim, monkey, opts = {}) {
    const j = monkey.joints;
    const floorY = opts.floorY ?? 0;
    monkey.setExpression('shock');
    const root = monkey.root;
    const startY = root.position.y;
    // launch up & back (local -z is away from the table since monkeys face the center)
    const back = 0.9;
    const startX = root.position.x;
    const startZ = root.position.z;
    // world-space "away from table" for this seat (root faces the center)
    const dirX = -Math.sin(root.rotation.y);
    const dirZ = -Math.cos(root.rotation.y);
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.8, z: 0.9 }, 0.3, { ease: Ease.quadOut }).promise,
      anim.to(j.armR.rotation, { x: -2.8, z: -0.9 }, 0.3, { ease: Ease.quadOut }).promise,
      anim
        .tween({
          duration: 0.55,
          ease: Ease.linear,
          onUpdate(k) {
            root.position.x = startX + dirX * back * k * 1.1;
            root.position.z = startZ + dirZ * back * k * 1.1;
            root.position.y = startY + 0.55 * Math.sin(k * Math.PI) - (startY - floorY) * k * k;
            root.rotation.x = -k * Math.PI * 0.55;
          },
        }).promise,
    ]);
    monkey.setExpression('ko');
    // bounce settle
    await anim
      .tween({
        duration: 0.35,
        ease: Ease.bounceOut,
        onUpdate(k) {
          root.position.y = floorY + 0.12 * (1 - k);
        },
      }).promise;
    // sprawl limbs
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.4, z: 1.2 }, 0.3).promise,
      anim.to(j.armR.rotation, { x: -2.4, z: -1.2 }, 0.3).promise,
      anim.to(j.legL.rotation, { x: -0.4 }, 0.3).promise,
      anim.to(j.legR.rotation, { x: -0.7 }, 0.3).promise,
      anim.to(j.head.rotation, { z: 0.5 }, 0.3).promise,
    ]);
    // stays KO'd — caller re-seats/resets if needed
  },

  /** Survival: massive exhale, slump, wipe brow. */
  async survive(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('sweat');
    await Promise.all([
      anim.to(j.torso.rotation, { x: -0.22 }, 0.5, { ease: Ease.quadOut }).promise,
      anim.to(j.head.rotation, { x: -0.3 }, 0.5).promise,
    ]);
    await Promise.all([
      anim.to(j.torso.rotation, { x: 0.35 }, 0.7, { ease: Ease.quadInOut }).promise,
      anim.to(j.head.rotation, { x: 0.35 }, 0.7).promise,
      anim.to(j.armR.rotation, { x: -2.3, z: -0.4 }, 0.4).promise,
    ]);
    await anim.to(j.armR.rotation, { z: 0.2 }, 0.35, { ease: Ease.sineInOut }).promise; // brow wipe
    await anim.wait(0.2);
    monkey.setExpression('grin');
    await resetPose(anim, monkey, 0.5);
    monkey.setExpression('neutral');
  },

  // ---- idle fidget micro-clips (P7 juice) — subtle, short, self-resetting.
  // Each step checks `busy > 1` (a real choreography clip started underneath)
  // and bails out early so the real clip owns the pose from then on.

  /** Scratch the side of the head. */
  async fidgetScratch(anim, monkey) {
    const j = monkey.joints;
    const preempted = () => monkey.state.busy > 1;
    await Promise.all([
      anim.to(j.armR.rotation, { x: -2.35, z: -0.55 }, 0.35, { ease: Ease.quadInOut }).promise,
      anim.to(j.foreArmR.rotation, { x: -0.9 }, 0.35).promise,
      anim.to(j.head.rotation, { z: -0.14 }, 0.35).promise,
    ]);
    for (let i = 0; i < 3 && !preempted(); i++) {
      await anim.to(j.foreArmR.rotation, { x: -0.72 }, 0.09, { ease: Ease.sineInOut }).promise;
      await anim.to(j.foreArmR.rotation, { x: -0.95 }, 0.09, { ease: Ease.sineInOut }).promise;
    }
    if (preempted()) return;
    await resetPose(anim, monkey, 0.4);
  },

  /** Suspicious double-take around the bar. */
  async fidgetGlance(anim, monkey) {
    const j = monkey.joints;
    const preempted = () => monkey.state.busy > 1;
    await anim.to(j.head.rotation, { y: 0.55 }, 0.24, { ease: Ease.quadOut }).promise;
    await anim.wait(0.35);
    if (preempted()) return;
    await anim.to(j.head.rotation, { y: -0.42 }, 0.18, { ease: Ease.quadInOut }).promise;
    await anim.wait(0.28);
    if (preempted()) return;
    await resetPose(anim, monkey, 0.3);
  },

  /** Raise the off-hand for a sip of the house brew. */
  async fidgetSip(anim, monkey) {
    const j = monkey.joints;
    const preempted = () => monkey.state.busy > 1;
    await Promise.all([
      anim.to(j.armL.rotation, { x: -1.9, z: 0.35 }, 0.4, { ease: Ease.quadInOut }).promise,
      anim.to(j.foreArmL.rotation, { x: -1.5 }, 0.4).promise,
      anim.to(j.head.rotation, { x: 0.18 }, 0.4).promise,
    ]);
    await anim.wait(0.5);
    if (preempted()) return;
    await resetPose(anim, monkey, 0.45);
  },

  /** Roll the shoulders / arch the back. */
  async fidgetStretch(anim, monkey) {
    const j = monkey.joints;
    const preempted = () => monkey.state.busy > 1;
    await Promise.all([
      anim.to(j.torso.rotation, { x: -0.16 }, 0.45, { ease: Ease.sineInOut }).promise,
      anim.to(j.armL.rotation, { z: 0.5 }, 0.45).promise,
      anim.to(j.armR.rotation, { z: -0.5 }, 0.45).promise,
      anim.to(j.head.rotation, { x: -0.2 }, 0.45).promise,
    ]);
    await anim.wait(0.3);
    if (preempted()) return;
    await resetPose(anim, monkey, 0.5);
  },

  /** Stand-in for reveal-win smugness. */
  async smug(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('grin');
    await Promise.all([
      anim.to(j.torso.rotation, { x: -0.18 }, 0.3).promise,
      anim.to(j.head.rotation, { z: 0.18, x: -0.12 }, 0.3).promise,
      anim.to(j.armL.rotation, { z: 0.25 }, 0.3).promise,
      anim.to(j.armR.rotation, { z: -0.25 }, 0.3).promise,
    ]);
    await anim.wait(0.8);
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.4);
  },
};

// --- emote gestures (shared/emotes.js ids) ---------------------------------

const EMOTE_CLIPS = {
  async laugh(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('grin');
    await anim.to(j.head.rotation, { x: -0.3 }, 0.15).promise;
    for (let i = 0; i < 4; i++) {
      await anim.to(j.torso.rotation, { x: 0.14 }, 0.09, { ease: Ease.quadInOut }).promise;
      await anim.to(j.torso.rotation, { x: -0.06 }, 0.09, { ease: Ease.quadInOut }).promise;
    }
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.3);
  },
  cry: (a, m) => CLIP_TABLE.sob(a, m),
  async rage(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('rage');
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.7, z: 0.4 }, 0.2, { ease: Ease.backOut }).promise,
      anim.to(j.armR.rotation, { x: -2.7, z: -0.4 }, 0.2, { ease: Ease.backOut }).promise,
    ]);
    for (let i = 0; i < 4; i++) {
      await anim.to(j.torso.rotation, { z: 0.12 }, 0.07).promise;
      await anim.to(j.torso.rotation, { z: -0.12 }, 0.07).promise;
    }
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.35);
  },
  async shrug(anim, monkey) {
    const j = monkey.joints;
    await Promise.all([
      anim.to(j.armL.rotation, { x: -1.2, z: 1.1 }, 0.3, { ease: Ease.backOut }).promise,
      anim.to(j.armR.rotation, { x: -1.2, z: -1.1 }, 0.3, { ease: Ease.backOut }).promise,
      anim.to(j.foreArmL.rotation, { x: -0.9 }, 0.3).promise,
      anim.to(j.foreArmR.rotation, { x: -0.9 }, 0.3).promise,
      anim.to(j.head.rotation, { z: 0.25 }, 0.3).promise,
    ]);
    await anim.wait(0.7);
    await resetPose(anim, monkey, 0.4);
  },
  async taunt(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('grin');
    await anim.to(j.torso.rotation, { x: 0.3 }, 0.25).promise;
    for (let i = 0; i < 3; i++) {
      await anim.to(j.head.rotation, { z: 0.28 }, 0.12, { ease: Ease.sineInOut }).promise;
      await anim.to(j.head.rotation, { z: -0.28 }, 0.12, { ease: Ease.sineInOut }).promise;
    }
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.35);
  },
  async sweat(anim, monkey) {
    monkey.setExpression('sweat');
    const j = monkey.joints;
    await anim.to(j.torso.scale, { x: 0.97, y: 0.96, z: 0.97 }, 0.2).promise;
    await anim.wait(1.0);
    await anim.to(j.torso.scale, { x: 1, y: 1, z: 1 }, 0.2).promise;
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.3);
  },
  async heart(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('grin');
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.0, z: 0.85 }, 0.3).promise,
      anim.to(j.armR.rotation, { x: -2.0, z: -0.85 }, 0.3).promise,
      anim.to(j.foreArmL.rotation, { x: -1.5 }, 0.3).promise,
      anim.to(j.foreArmR.rotation, { x: -1.5 }, 0.3).promise,
      anim.to(j.head.rotation, { z: 0.2 }, 0.3).promise,
    ]);
    await anim.wait(0.8);
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.35);
  },
  shock: (a, m) => CLIP_TABLE.shock(a, m),
  async mindblown(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('shock');
    await Promise.all([
      anim.to(j.armL.rotation, { x: -2.6, z: 0.3 }, 0.25).promise,
      anim.to(j.armR.rotation, { x: -2.6, z: -0.3 }, 0.25).promise,
      anim.to(j.foreArmL.rotation, { x: -1.6 }, 0.25).promise,
      anim.to(j.foreArmR.rotation, { x: -1.6 }, 0.25).promise,
    ]);
    await Promise.all([
      anim.to(j.armL.rotation, { x: -1.6, z: 1.3 }, 0.3, { ease: Ease.backOut }).promise,
      anim.to(j.armR.rotation, { x: -1.6, z: -1.3 }, 0.3, { ease: Ease.backOut }).promise,
      anim.to(j.foreArmL.rotation, { x: 0 }, 0.3).promise,
      anim.to(j.foreArmR.rotation, { x: 0 }, 0.3).promise,
      anim.to(j.head.rotation, { x: -0.3 }, 0.3).promise,
    ]);
    await anim.wait(0.5);
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.4);
  },
  async sleepy(anim, monkey) {
    const j = monkey.joints;
    monkey.setExpression('blink');
    await Promise.all([
      anim.to(j.head.rotation, { x: 0.55, z: 0.3 }, 0.8, { ease: Ease.sineInOut }).promise,
      anim.to(j.torso.rotation, { x: 0.25 }, 0.8).promise,
    ]);
    await anim.wait(0.8);
    monkey.setExpression('neutral');
    await resetPose(anim, monkey, 0.5);
  },
};

/** Every playable clip name (canned + emote gestures). */
export const CLIP_NAMES = [...Object.keys(CLIP_TABLE), ...Object.keys(EMOTE_CLIPS)];

/**
 * Play a canned clip (or emote gesture) on a monkey. Returns a Promise that
 * resolves when the clip finishes. Unknown names resolve immediately.
 */
export function playClip(anim, monkey, name, opts = {}) {
  const clip = CLIP_TABLE[name] || EMOTE_CLIPS[name];
  if (!clip || !monkey) return Promise.resolve();
  return busyWrap(monkey, () => clip(anim, monkey, opts));
}
