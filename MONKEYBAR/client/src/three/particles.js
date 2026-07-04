// Particle systems — PLAN.md §7 (client/src/three/particles.js).
// Ambient dust motes, smoke puffs, confetti bursts, muzzle flash. All Points /
// sprite-plane based, no textures beyond tiny procedural canvases.

import * as THREE from 'three';
import { makeCanvas } from './materials.js';

function softDotTexture(color = '#ffffff') {
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, color);
  g.addColorStop(0.4, color + 'cc');
  g.addColorStop(1, '#00000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Particle manager. Add once per scene; call `update(dt, elapsed)` each frame.
 */
export function createParticles(scene) {
  const dotTex = softDotTexture('#ffffff');

  /** @type {Array<{update:(dt:number)=>boolean, dispose:()=>void}>} */
  const systems = [];

  // ---------------------------------------------------------------------
  // Ambient dust motes (persistent)
  // ---------------------------------------------------------------------
  let dust = null;

  function setAmbientDust(density, { radius = 4.5, height = 3 } = {}) {
    if (dust) {
      scene.remove(dust.points);
      dust.geo.dispose();
      dust.mat.dispose();
      dust = null;
    }
    const count = Math.floor(40 + density * 260);
    if (count <= 0) return;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.2 + Math.random() * height;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = Math.random() * 100;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      map: dotTex,
      color: '#ffe9c4',
      size: 0.022,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.name = 'dust_motes';
    scene.add(points);
    dust = { points, geo, mat, seeds, height };
  }

  function updateDust(dt, elapsed) {
    if (!dust) return;
    const pos = dust.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const s = dust.seeds[i];
      pos.setY(i, pos.getY(i) + Math.sin(elapsed * 0.4 + s) * 0.0008 + 0.0125 * dt);
      pos.setX(i, pos.getX(i) + Math.sin(elapsed * 0.23 + s * 2.1) * 0.0006);
      if (pos.getY(i) > dust.height + 0.4) pos.setY(i, 0.2);
    }
    pos.needsUpdate = true;
  }

  // ---------------------------------------------------------------------
  // Generic burst helper
  // ---------------------------------------------------------------------
  function burst({
    origin,
    count,
    color = '#ffffff',
    colors = null,
    size = 0.04,
    speed = 1,
    spread = 1,
    up = 1,
    gravity = -1.6,
    drag = 0.94,
    life = 1.2,
    fadePow = 1.6,
    additive = true,
    dir = null,
  }) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vels = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      let vx = (Math.random() - 0.5) * 2 * spread;
      let vy = Math.random() * up + 0.2;
      let vz = (Math.random() - 0.5) * 2 * spread;
      if (dir) {
        vx = dir.x * (0.6 + Math.random()) + (Math.random() - 0.5) * spread;
        vy = dir.y * (0.6 + Math.random()) + (Math.random() - 0.5) * spread;
        vz = dir.z * (0.6 + Math.random()) + (Math.random() - 0.5) * spread;
      }
      vels[i * 3] = vx * speed;
      vels[i * 3 + 1] = vy * speed;
      vels[i * 3 + 2] = vz * speed;
      c.set(colors ? colors[i % colors.length] : color);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({
      map: dotTex,
      vertexColors: true,
      size,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    let age = 0;
    const sys = {
      update(dt) {
        age += dt;
        const t = age / life;
        if (t >= 1) return false;
        mat.opacity = Math.pow(1 - t, fadePow);
        const pos = geo.attributes.position;
        for (let i = 0; i < count; i++) {
          vels[i * 3] *= drag;
          vels[i * 3 + 1] = vels[i * 3 + 1] * drag + gravity * dt;
          vels[i * 3 + 2] *= drag;
          pos.setXYZ(
            i,
            pos.getX(i) + vels[i * 3] * dt,
            pos.getY(i) + vels[i * 3 + 1] * dt,
            pos.getZ(i) + vels[i * 3 + 2] * dt
          );
        }
        pos.needsUpdate = true;
        return true;
      },
      dispose() {
        scene.remove(points);
        geo.dispose();
        mat.dispose();
      },
    };
    systems.push(sys);
    return sys;
  }

  return {
    setAmbientDust,

    /** Grey-brown smoke puff (cannon aftermath, Shady Slim cards). */
    smokePuff(origin, { count = 26, size = 0.11, speed = 0.5 } = {}) {
      burst({
        origin,
        count,
        colors: ['#8a8a88', '#6b6b68', '#a8a8a4'],
        size,
        speed,
        spread: 0.5,
        up: 0.9,
        gravity: 0.25,
        drag: 0.9,
        life: 1.9,
        fadePow: 1.2,
        additive: false,
      });
    },

    /** Celebration confetti burst. */
    confetti(origin, { count = 90 } = {}) {
      burst({
        origin,
        count,
        colors: ['#ff3df0', '#39ff88', '#ffd23d', '#3dc8ff', '#ff5a3d', '#b06bff'],
        size: 0.035,
        speed: 1.6,
        spread: 0.9,
        up: 2.2,
        gravity: -2.6,
        drag: 0.96,
        life: 2.1,
        fadePow: 0.7,
        additive: false,
      });
    },

    /** Cannon muzzle flash + sparks along `dir`. */
    muzzleFlash(origin, dir) {
      burst({
        origin,
        count: 40,
        colors: ['#fff6d0', '#ffca3d', '#ff7a3d'],
        size: 0.09,
        speed: 3.4,
        spread: 0.55,
        gravity: -0.6,
        drag: 0.86,
        life: 0.5,
        fadePow: 1.1,
        dir,
      });
      burst({
        origin,
        count: 14,
        color: '#ffffff',
        size: 0.2,
        speed: 0.6,
        spread: 0.4,
        up: 0.4,
        gravity: 0,
        drag: 0.8,
        life: 0.28,
        fadePow: 1,
      });
    },

    /** Small fuse sparks (call repeatedly while the fuse burns). */
    fuseSparks(origin) {
      burst({
        origin,
        count: 7,
        colors: ['#ffe23d', '#ff9a3d', '#ffffff'],
        size: 0.028,
        speed: 0.55,
        spread: 0.5,
        up: 0.9,
        gravity: -1.8,
        drag: 0.9,
        life: 0.45,
        fadePow: 1,
      });
    },

    /** Gold glints (Baron Bananas reveal, survival shimmer). */
    goldGlint(origin) {
      burst({
        origin,
        count: 18,
        colors: ['#ffd23d', '#fff0b0'],
        size: 0.04,
        speed: 0.5,
        spread: 0.5,
        up: 0.8,
        gravity: -0.4,
        drag: 0.92,
        life: 0.9,
        fadePow: 1.2,
      });
    },

    update(dt, elapsed) {
      updateDust(dt, elapsed);
      for (let i = systems.length - 1; i >= 0; i--) {
        if (!systems[i].update(dt)) {
          systems[i].dispose();
          systems.splice(i, 1);
        }
      }
    },

    dispose() {
      for (const s of systems) s.dispose();
      systems.length = 0;
      setAmbientDust(0);
    },
  };
}
