// Lightweight pooled particle system (§D2, §G3 — consumed by many later
// agents: care interactions, minigames, results confetti…). One shared pool of
// THREE.Sprites with tiny canvas textures; zero allocations while emitting
// after warm-up. Usage:
//
//   const particles = createParticles(scene);
//   particles.emit('hearts', gooby.group.position, { count: 5 });
//   // per frame:
//   particles.update(dt);
//   // on scene dispose:
//   particles.dispose();
//
// Particle types (look & feel):
//   hearts     — pink hearts that rise, sway and puff away (pet/love feedback)
//   zzz        — pale lavender "Z" glyphs drifting up-right, growing (sleep)
//   sparkles   — tiny white/gold 4-point stars bursting outward, twinkling
//                (wash finish, level-up shine)
//   stinkFlies — small dark flies orbiting the emit point with jittery wing
//                buzz (~3 s; re-emit to keep a low-hygiene cloud alive)
//   dizzyStars — golden stars circling a ring above the head (dizzy state)
//   crumbs     — warm brown specks popping out and falling with gravity (eat)
//   bubbles    — translucent soap bubbles wobbling upward, popping at
//                end-of-life (bath scrub)
//   confetti   — pastel paper squares bursting up then fluttering down
//                (level-up, results, celebrations)

import * as THREE from 'three';

const POOL_SIZE = 96;
const TEX_SIZE = 64;

// ---------------------------------------------------------------------------
// Canvas textures (one per look, shared app-wide)
// ---------------------------------------------------------------------------

/** @type {Map<string, THREE.CanvasTexture>} */
const textures = new Map();

/**
 * @param {string} id
 * @param {(g: CanvasRenderingContext2D, s: number) => void} draw
 * @returns {THREE.CanvasTexture}
 */
function getTexture(id, draw) {
  if (textures.has(id)) return textures.get(id);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX_SIZE;
  const g = canvas.getContext('2d');
  draw(g, TEX_SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  textures.set(id, tex);
  return tex;
}

function drawHeart(g, s) {
  g.fillStyle = '#FF7BA9';
  g.strokeStyle = '#E86592';
  g.lineWidth = s * 0.05;
  g.beginPath();
  const cx = s / 2, cy = s * 0.42, r = s * 0.19;
  g.moveTo(cx, cy + s * 0.32);
  g.bezierCurveTo(cx - s * 0.42, cy + s * 0.05, cx - r * 1.6, cy - r * 1.4, cx, cy - r * 0.35);
  g.bezierCurveTo(cx + r * 1.6, cy - r * 1.4, cx + s * 0.42, cy + s * 0.05, cx, cy + s * 0.32);
  g.closePath();
  g.fill();
  g.stroke();
}

function drawZ(g, s) {
  g.fillStyle = '#B9AEF0';
  g.strokeStyle = '#8F82CF';
  g.lineWidth = s * 0.04;
  g.font = `900 ${s * 0.8}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Z', s / 2, s * 0.56);
  g.strokeText('Z', s / 2, s * 0.56);
}

/** 4-point twinkle star, white core (tintable). */
function drawSparkle(g, s) {
  const c = s / 2, R = s * 0.46, r = s * 0.09;
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.moveTo(c, c - R);
  g.quadraticCurveTo(c + r, c - r, c + R, c);
  g.quadraticCurveTo(c + r, c + r, c, c + R);
  g.quadraticCurveTo(c - r, c + r, c - R, c);
  g.quadraticCurveTo(c - r, c - r, c, c - R);
  g.fill();
}

/** 5-point cartoon star (tinted gold for dizzyStars). */
function drawStar(g, s) {
  const c = s / 2, R = s * 0.44, r = R * 0.48;
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g[i === 0 ? 'moveTo' : 'lineTo'](c + Math.cos(a) * rad, c + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}

function drawFly(g, s) {
  const c = s / 2;
  // wings
  g.fillStyle = 'rgba(220,230,255,0.8)';
  g.beginPath();
  g.ellipse(c - s * 0.16, c - s * 0.16, s * 0.16, s * 0.09, -0.5, 0, Math.PI * 2);
  g.ellipse(c + s * 0.16, c - s * 0.16, s * 0.16, s * 0.09, 0.5, 0, Math.PI * 2);
  g.fill();
  // body
  g.fillStyle = '#4A3B36';
  g.beginPath();
  g.ellipse(c, c + s * 0.06, s * 0.15, s * 0.12, 0, 0, Math.PI * 2);
  g.fill();
}

function drawCrumb(g, s) {
  g.fillStyle = '#C89B6C';
  g.beginPath();
  g.ellipse(s * 0.44, s * 0.5, s * 0.2, s * 0.16, 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#A97C4F';
  g.beginPath();
  g.ellipse(s * 0.62, s * 0.44, s * 0.12, s * 0.1, -0.5, 0, Math.PI * 2);
  g.fill();
}

function drawBubble(g, s) {
  const c = s / 2, R = s * 0.42;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = s * 0.05;
  g.fillStyle = 'rgba(180,225,255,0.28)';
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = s * 0.06;
  g.beginPath();
  g.arc(c, c, R * 0.68, -2.2, -1.2);
  g.stroke();
}

/** Plain rounded square (tinted per-confetto). */
function drawSquare(g, s) {
  g.fillStyle = '#FFFFFF';
  const m = s * 0.22, r = s * 0.12;
  g.beginPath();
  g.roundRect(m, m, s - 2 * m, s - 2 * m, r);
  g.fill();
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

const CONFETTI_COLORS = [0xff7ba9, 0x59c9b9, 0xffd166, 0x9b8cff, 0x7fd4ff, 0xffa26b];

/**
 * @typedef {Object} ParticleTypeDef
 * @property {() => THREE.CanvasTexture} tex
 * @property {number} count      default particles per emit
 * @property {[number, number]} life  [min,max] seconds
 * @property {(p: object, rng: () => number) => void} spawn  init velocities/params
 * @property {(p: object, dt: number) => void} step         per-frame integrate
 */

/** @type {Record<string, ParticleTypeDef>} */
const TYPES = {
  hearts: {
    tex: () => getTexture('heart', drawHeart),
    count: 5,
    life: [1.0, 1.5],
    spawn(p, rng) {
      p.vel.set((rng() - 0.5) * 0.45, 0.42 + rng() * 0.28, (rng() - 0.5) * 0.2);
      p.size = 0.08 + rng() * 0.05;
      p.phase = rng() * Math.PI * 2;
    },
    step(p, dt) {
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(p.age * 5 + p.phase) * 0.12 * dt;
      const grow = Math.min(1, p.age * 6);
      p.sprite.scale.setScalar(p.size * grow * (1 + p.age * 0.12));
      p.mat.opacity = grow * (1 - p.t ** 2);
    },
  },

  zzz: {
    tex: () => getTexture('zzz', drawZ),
    count: 1,
    life: [1.8, 2.4],
    spawn(p, rng) {
      p.vel.set(0.16 + rng() * 0.1, 0.3 + rng() * 0.12, 0);
      p.size = 0.1 + rng() * 0.04;
      p.phase = rng() * Math.PI * 2;
    },
    step(p, dt) {
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(p.age * 2.2 + p.phase) * 0.1 * dt;
      p.sprite.scale.setScalar(p.size * (1 + p.t * 1.4));
      p.mat.opacity = Math.min(1, p.age * 4) * (1 - p.t ** 3);
    },
  },

  sparkles: {
    tex: () => getTexture('sparkle', drawSparkle),
    count: 8,
    life: [0.45, 0.8],
    spawn(p, rng) {
      const a = rng() * Math.PI * 2;
      const v = 0.5 + rng() * 0.9;
      p.vel.set(Math.cos(a) * v, (rng() - 0.2) * v, Math.sin(a) * v * 0.5);
      p.size = 0.06 + rng() * 0.06;
      p.phase = rng() * Math.PI * 2;
      p.mat.color.setHex(rng() < 0.5 ? 0xffffff : 0xffe08a);
    },
    step(p, dt) {
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - 2.5 * dt); // drag
      const twinkle = 0.7 + 0.3 * Math.sin(p.age * 26 + p.phase);
      p.sprite.scale.setScalar(p.size * twinkle * (1 - p.t * 0.4));
      p.mat.opacity = 1 - p.t ** 2;
    },
  },

  stinkFlies: {
    tex: () => getTexture('fly', drawFly),
    count: 3,
    life: [2.6, 3.4],
    spawn(p, rng) {
      p.phase = rng() * Math.PI * 2;
      p.radius = 0.3 + rng() * 0.16;
      p.speed = (2 + rng() * 1.6) * (rng() < 0.5 ? 1 : -1);
      p.size = 0.07 + rng() * 0.02;
      p.yBase = 0.15 + rng() * 0.4;
    },
    step(p, dt) {
      const a = p.phase + p.age * p.speed;
      p.pos.set(
        p.origin.x + Math.cos(a) * p.radius,
        p.origin.y + p.yBase + Math.sin(p.age * 7 + p.phase) * 0.06,
        p.origin.z + Math.sin(a) * p.radius
      );
      p.sprite.scale.setScalar(p.size);
      const fade = Math.min(1, p.age * 5) * Math.min(1, (1 - p.t) * 5);
      p.mat.opacity = fade;
    },
  },

  dizzyStars: {
    tex: () => getTexture('star', drawStar),
    count: 5,
    life: [1.8, 2.0],
    spawn(p, rng, i, n) {
      p.phase = ((i ?? 0) / Math.max(1, n ?? 1)) * Math.PI * 2;
      p.radius = 0.26;
      p.speed = 4.2;
      p.size = 0.085;
      p.mat.color.setHex(0xffd166);
    },
    step(p, dt) {
      const a = p.phase + p.age * p.speed;
      p.pos.set(
        p.origin.x + Math.cos(a) * p.radius,
        p.origin.y + Math.sin(p.age * 3) * 0.03,
        p.origin.z + Math.sin(a) * p.radius
      );
      p.sprite.scale.setScalar(p.size * (0.85 + 0.15 * Math.sin(p.age * 12 + p.phase)));
      p.mat.opacity = Math.min(1, p.age * 6) * Math.min(1, (1 - p.t) * 4);
    },
  },

  crumbs: {
    tex: () => getTexture('crumb', drawCrumb),
    count: 6,
    life: [0.55, 0.9],
    spawn(p, rng) {
      const a = rng() * Math.PI * 2;
      p.vel.set(Math.cos(a) * (0.3 + rng() * 0.4), 0.6 + rng() * 0.6, Math.sin(a) * (0.2 + rng() * 0.3));
      p.size = 0.035 + rng() * 0.03;
      p.spin = (rng() - 0.5) * 10;
    },
    step(p, dt) {
      p.vel.y -= 4.2 * dt; // gravity
      p.pos.addScaledVector(p.vel, dt);
      p.mat.rotation += p.spin * dt;
      p.sprite.scale.setScalar(p.size);
      p.mat.opacity = 1 - p.t ** 3;
    },
  },

  bubbles: {
    tex: () => getTexture('bubble', drawBubble),
    count: 6,
    life: [1.2, 2.2],
    spawn(p, rng) {
      p.vel.set((rng() - 0.5) * 0.2, 0.28 + rng() * 0.3, (rng() - 0.5) * 0.2);
      p.size = 0.05 + rng() * 0.09;
      p.phase = rng() * Math.PI * 2;
    },
    step(p, dt) {
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(p.age * 4 + p.phase) * 0.08 * dt;
      // pop: quick swell + vanish over the last 12% of life
      const popT = Math.max(0, (p.t - 0.88) / 0.12);
      p.sprite.scale.setScalar(p.size * Math.min(1, p.age * 5) * (1 + popT * 0.9));
      p.mat.opacity = Math.min(1, p.age * 5) * (1 - popT);
    },
  },

  confetti: {
    tex: () => getTexture('square', drawSquare),
    count: 16,
    life: [1.6, 2.4],
    spawn(p, rng) {
      const a = rng() * Math.PI * 2;
      p.vel.set(Math.cos(a) * (0.5 + rng() * 0.8), 1.6 + rng() * 1.2, Math.sin(a) * (0.4 + rng() * 0.5));
      p.size = 0.045 + rng() * 0.03;
      p.spin = (rng() - 0.5) * 16;
      p.phase = rng() * Math.PI * 2;
      p.mat.color.setHex(CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)]);
    },
    step(p, dt) {
      p.vel.y -= 3.4 * dt;
      p.vel.y = Math.max(p.vel.y, -0.9); // paper terminal velocity
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(p.age * 6 + p.phase) * 0.35 * dt; // flutter
      p.mat.rotation += p.spin * dt;
      p.sprite.scale.set(p.size, p.size * (0.55 + 0.45 * Math.abs(Math.sin(p.age * 9 + p.phase))), 1);
      p.mat.opacity = 1 - Math.max(0, (p.t - 0.7) / 0.3) ** 2;
    },
  },
};

/** Particle type ids exposed for showcases/demos. */
export const PARTICLE_TYPES = Object.freeze(Object.keys(TYPES));

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

/**
 * Create a pooled particle system parented to `parent` (usually the scene).
 * Call `update(dt)` every frame and `dispose()` from the scene's dispose().
 *
 * @param {THREE.Object3D} parent
 * @param {{poolSize?: number}} [opts]
 * @returns {{
 *   emit: (type: string, worldPos: THREE.Vector3|{x:number,y:number,z:number}, opts?: {count?: number}) => void,
 *   update: (dt: number) => void,
 *   activeCount: () => number,
 *   dispose: () => void,
 * }}
 */
export function createParticles(parent, opts = {}) {
  const poolSize = opts.poolSize ?? POOL_SIZE;
  const group = new THREE.Group();
  group.name = 'particles';
  parent.add(group);

  const rng = Math.random;

  /** @type {Array<object>} */
  const pool = [];
  for (let i = 0; i < poolSize; i += 1) {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    group.add(sprite);
    pool.push({
      sprite,
      mat,
      active: false,
      type: null,
      age: 0,
      life: 1,
      t: 0,
      pos: sprite.position,
      origin: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      size: 0.1,
      phase: 0,
      spin: 0,
      speed: 0,
      radius: 0,
      yBase: 0,
    });
  }

  let activeCount = 0;

  function emit(type, worldPos, emitOpts = {}) {
    const def = TYPES[type];
    if (!def) {
      console.warn(`[particles] unknown type '${type}'`);
      return;
    }
    const n = emitOpts.count ?? def.count;
    let spawned = 0;
    for (const p of pool) {
      if (spawned >= n) break;
      if (p.active) continue;
      p.active = true;
      p.type = type;
      p.age = 0;
      p.t = 0;
      p.life = def.life[0] + rng() * (def.life[1] - def.life[0]);
      p.origin.copy(worldPos);
      p.pos.copy(worldPos);
      p.vel.set(0, 0, 0);
      p.mat.map = def.tex();
      p.mat.rotation = 0;
      p.mat.color.setHex(0xffffff);
      p.mat.opacity = 0;
      def.spawn(p, rng, spawned, n);
      p.sprite.scale.setScalar(p.size ?? 0.1);
      p.sprite.visible = true;
      spawned += 1;
      activeCount += 1;
    }
  }

  function update(dt) {
    if (activeCount === 0) return;
    for (const p of pool) {
      if (!p.active) continue;
      p.age += dt;
      p.t = p.age / p.life;
      if (p.t >= 1) {
        p.active = false;
        p.sprite.visible = false;
        activeCount -= 1;
        continue;
      }
      TYPES[p.type].step(p, dt);
    }
  }

  function dispose() {
    for (const p of pool) {
      p.mat.dispose(); // textures are shared app-wide, keep them
    }
    group.parent?.remove(group);
    pool.length = 0;
    activeCount = 0;
  }

  return { emit, update, activeCount: () => activeCount, dispose };
}

// ---------------------------------------------------------------------------
// G14: DOM overlay effects — results-screen confetti + coin-fly-to-counter
// (§G G14 polish pass). Pure DOM + Web Animations API, self-cleaning; they
// live here because particles.js is the shared "juice" module (§G3).
// ---------------------------------------------------------------------------

/**
 * Burst pastel confetti over a DOM container (results screen §G14).
 * @param {HTMLElement} container positioned ancestor (screen/overlay root)
 * @param {{count?: number}} [opts]
 */
export function burstConfettiDom(container, opts = {}) {
  const count = opts.count ?? 36;
  const W = container.clientWidth || innerWidth;
  const H = container.clientHeight || innerHeight;
  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('div');
    const size = 6 + Math.random() * 7;
    const hex = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    el.style.cssText =
      `position:absolute;left:${Math.random() * W}px;top:${-30 - Math.random() * H * 0.25}px;` +
      `width:${size}px;height:${size * (0.6 + Math.random() * 0.6)}px;border-radius:2px;` +
      `background:#${hex.toString(16).padStart(6, '0')};pointer-events:none;z-index:400;`;
    container.appendChild(el);
    const drift = (Math.random() - 0.5) * 160;
    const spin = 360 + Math.random() * 720;
    const dur = 1600 + Math.random() * 1400;
    el.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${drift}px,${H + 60}px) rotate(${spin}deg)`, opacity: 0.9 },
      ],
      { duration: dur, delay: Math.random() * 350, easing: 'cubic-bezier(.3,.4,.6,1)', fill: 'forwards' }
    ).onfinish = () => el.remove();
  }
}

/**
 * Fly a burst of DOM coins from one point to another (results → HUD counter,
 * §G14 polish). Calls onArrive per coin (audio tick hooks in the caller).
 * @param {{
 *   fromEl?: HTMLElement, from?: {x: number, y: number},
 *   toEl?: HTMLElement, to?: {x: number, y: number},
 *   count?: number, onArrive?: (i: number) => void,
 * }} opts
 */
export function flyCoinsDom(opts = {}) {
  const center = (el) => {
    const r = el?.getBoundingClientRect?.();
    return r && (r.width > 0 || r.height > 0) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  };
  const from = center(opts.fromEl) ?? opts.from ?? { x: innerWidth / 2, y: innerHeight / 2 };
  // default target: where the HUD coin pill lives (top-left, under the pills)
  const to = center(opts.toEl) ?? opts.to ?? { x: 64, y: 86 };
  const count = Math.max(1, Math.min(12, opts.count ?? 8));
  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('div');
    el.style.cssText =
      `position:fixed;left:${from.x - 9}px;top:${from.y - 9}px;width:18px;height:18px;` +
      'border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFE9A8,#FFD166 55%,#E0A93E);' +
      'box-shadow:0 1px 4px rgba(74,59,54,.35);pointer-events:none;z-index:500;';
    document.body.appendChild(el);
    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 120;
    const midY = Math.min(from.y, to.y) - 40 - Math.random() * 60;
    el.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(${midX - from.x}px,${midY - from.y}px) scale(1.15)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(.5)`, opacity: 0.85, offset: 1 },
      ],
      { duration: 620 + Math.random() * 160, delay: i * 70, easing: 'cubic-bezier(.35,0,.6,1)', fill: 'forwards' }
    ).onfinish = () => {
      el.remove();
      opts.onArrive?.(i);
    };
  }
}
