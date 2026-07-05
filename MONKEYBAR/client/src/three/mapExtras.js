// Map extras — RELEASE_PLAN R8 (client/src/three/mapExtras.js).
// Procedural extraProps builders + per-map structural accents for the 7 maps
// unlocked at 1.0 (Rumble Reef, Canopy Casino, Frostbite Lounge, Dune Saloon,
// Temple Taproom, Rooftop Rumpus, Submarine Speakeasy). Imported by
// barScene.js, which merges EXTRA_BUILDERS into its EXTRA_PROP_BUILDERS map
// and calls MAP_ACCENTS[mapId] after the generic build.
//
// Every builder receives the barScene ctx:
//   { group, palette, propParams, updaters, mapId }
// and may push `(dt, elapsed) => void` functions onto ctx.updaters — these run
// through the existing per-bar update hook (bar.update). Each map has at least
// one animated/emissive element. Updaters MUST NOT allocate per frame: all
// vectors/arrays/materials are precomputed at build time.
//
// 100% procedural: primitives, TubeGeometry and CanvasTexture only.

import * as THREE from 'three';
import { woodMaterial, neonMaterial, matte, glassMaterial, brassMaterial, makeCanvas, canvasTexture } from './materials.js';

// Mirror of barScene constants (no import to avoid a cycle).
const ROOM_RADIUS = 5.4;
const ROOM_HEIGHT = 3.5;
const TABLE_RADIUS = 1.15;

/** Place `obj` against the curved wall at polar angle `a`, facing the table. */
function onWall(obj, a, y, r = 4.85) {
  obj.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
  obj.rotation.y = a + Math.PI; // local +z faces the room center
}

function steel(color = '#4a5058', rough = 0.45) {
  return matte(color, { metalness: 0.75, roughness: rough });
}

// ---------------------------------------------------------------------------
// Rumble Reef — shipwreck tiki dive
// ---------------------------------------------------------------------------

function shipWheel(ctx) {
  const g = new THREE.Group();
  const wood = woodMaterial(ctx.palette.accent, { seed: 61, roughness: 0.6 });
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 8, 28), wood);
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.09, 12), wood);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), wood);
    spoke.rotation.z = (i / 4) * Math.PI;
    wheel.add(spoke);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.019, 0.16, 8), wood);
    handle.position.set(Math.cos(a) * 0.47, Math.sin(a) * 0.47, 0);
    handle.rotation.z = a + Math.PI / 2;
    wheel.add(handle);
  }
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.16), matte('#3a3a38', { metalness: 0.7, roughness: 0.5 }));
  bracket.position.z = -0.12;
  g.add(bracket, wheel);
  onWall(g, 3.85, 1.85);
  ctx.group.add(g);
  // the wreck still rolls with the swell
  ctx.updaters.push((dt, elapsed) => {
    wheel.rotation.z = Math.sin(elapsed * 0.6) * 0.22 + Math.sin(elapsed * 0.17) * 0.3;
  });
}

function porthole(ctx) {
  const brass = brassMaterial();
  const seaMats = [];
  for (const [a, y] of [[2.35, 1.8], [2.85, 1.95], [-2.5, 1.85]]) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 22), brass);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(0.25, 22), neonMaterial('#1d7a9e', 0.9));
    sea.position.z = -0.01;
    g.add(ring, sea);
    for (let i = 0; i < 6; i++) {
      const ba = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), brass);
      bolt.position.set(Math.cos(ba) * 0.31, Math.sin(ba) * 0.31, 0);
      g.add(bolt);
    }
    onWall(g, a, y, 5.0);
    ctx.group.add(g);
    seaMats.push({ mat: sea.material, phase: a * 3 });
  }
  // underwater caustic shimmer through the glass
  ctx.updaters.push((dt, elapsed) => {
    for (const s of seaMats) {
      s.mat.emissiveIntensity = 0.9 + Math.sin(elapsed * 1.7 + s.phase) * 0.25 + Math.sin(elapsed * 4.3 + s.phase * 2) * 0.12;
    }
  });
}

function netCeiling(ctx) {
  const g = new THREE.Group();
  const pts = [];
  const R = 4.2;
  const step = 0.55;
  const sag = (x, z) => {
    const r2 = (x * x + z * z) / (R * R);
    return ROOM_HEIGHT - 0.22 - (1 - r2) * 0.38;
  };
  for (let x = -R; x < R; x += step) {
    for (let z = -R; z < R; z += step) {
      if (x * x + z * z > R * R) continue;
      if ((x + step) * (x + step) + z * z <= R * R) {
        pts.push(x, sag(x, z), z, x + step, sag(x + step, z), z);
      }
      if (x * x + (z + step) * (z + step) <= R * R) {
        pts.push(x, sag(x, z), z, x, sag(x, z + step), z + step);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#c8b890', transparent: true, opacity: 0.65 }));
  g.add(net);
  // glass fishing floats caught in the net
  for (const [x, z, tint] of [[-1.9, 1.4, '#3d8a5a'], [2.2, -0.8, '#3d5a8a'], [0.6, 2.6, '#8a7a3d']]) {
    const float = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glassMaterial(tint, { opacity: 0.6 }));
    float.position.set(x, sag(x, z) - 0.1, z);
    g.add(float);
  }
  ctx.group.add(g);
  ctx.updaters.push((dt, elapsed) => {
    g.rotation.z = Math.sin(elapsed * 0.4) * 0.012;
    g.rotation.x = Math.cos(elapsed * 0.31) * 0.012;
  });
}

// ---------------------------------------------------------------------------
// Canopy Casino — high-roller treehouse
// ---------------------------------------------------------------------------

function chipTower(ctx) {
  const g = new THREE.Group();
  const sideTable = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.06, 16), woodMaterial('#2c1c10', { seed: 71 }));
  sideTable.position.y = 0.72;
  sideTable.castShadow = true;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.7, 10), woodMaterial('#2c1c10', { seed: 71 }));
  leg.position.y = 0.36;
  g.add(sideTable, leg);
  const colors = ['#c23b5a', '#2a9d8f', '#7a4fd0', '#e8e0d0', '#ffd23d'];
  const chipH = 0.016;
  for (let s = 0; s < 5; s++) {
    const sa = (s / 5) * Math.PI * 2;
    const sx = Math.cos(sa) * 0.17;
    const sz = Math.sin(sa) * 0.17;
    const n = 4 + ((s * 5) % 6);
    const mat = matte(colors[s % colors.length], { roughness: 0.45 });
    for (let i = 0; i < n; i++) {
      const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, chipH, 12), mat);
      chip.position.set(sx, 0.75 + chipH / 2 + i * chipH, sz);
      g.add(chip);
    }
  }
  // one glowing golden chip crowns the tallest stack
  const golden = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, chipH, 12), neonMaterial(ctx.palette.neon, 1.4));
  golden.position.set(0.17, 0.75 + chipH * 9.5, 0);
  g.add(golden);
  g.position.set(3.2, 0, -2.3);
  ctx.group.add(g);
}

function velvetRope(ctx) {
  const gold = brassMaterial();
  const velvet = matte('#8a1832', { roughness: 0.9 });
  const posts = [[1.1, 4.15], [2.5, 3.4], [3.5, 2.3]];
  const tops = [];
  for (const [x, z] of posts) {
    const post = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 14), gold);
    base.position.y = 0.02;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.92, 10), gold);
    pole.position.y = 0.5;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), gold);
    ball.position.y = 0.98;
    post.add(base, pole, ball);
    post.position.set(x, 0, z);
    ctx.group.add(post);
    tops.push(new THREE.Vector3(x, 0.93, z));
  }
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i];
    const b = tops[i + 1];
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= 0.18; // rope sag
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.028, 8), velvet);
    ctx.group.add(rope);
  }
}

function chandelier(ctx) {
  const g = new THREE.Group();
  const gold = brassMaterial();
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), gold);
  chain.position.y = 0.28;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 26), gold);
  ring.rotation.x = Math.PI / 2;
  const drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), glassMaterial('#ffe8c0', { opacity: 0.6 }));
  drop.position.y = -0.2;
  g.add(chain, ring, drop);
  const flames = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.16, 8), matte('#e8dcc0', { roughness: 0.7 }));
    candle.position.set(Math.cos(a) * 0.42, 0.09, Math.sin(a) * 0.42);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 8), neonMaterial('#ffb347', 2.2));
    flame.position.set(Math.cos(a) * 0.42, 0.2, Math.sin(a) * 0.42);
    g.add(candle, flame);
    flames.push({ mat: flame.material, mesh: flame, phase: i * 1.7 });
  }
  g.position.set(0, 2.92, -2.5);
  ctx.group.add(g);
  ctx.updaters.push((dt, elapsed) => {
    g.rotation.y += dt * 0.08;
    g.rotation.z = Math.sin(elapsed * 0.5) * 0.02;
    for (const f of flames) {
      f.mat.emissiveIntensity = 2.2 + Math.sin(elapsed * 11 + f.phase) * 0.5 + Math.sin(elapsed * 23 + f.phase * 2) * 0.25;
      f.mesh.scale.y = 1 + Math.sin(elapsed * 13 + f.phase) * 0.2;
    }
  });
}

// ---------------------------------------------------------------------------
// Frostbite Lounge — ice bar with a steaming corner tub
// ---------------------------------------------------------------------------

function iceSculpture(ctx) {
  const g = new THREE.Group();
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.85, 14), matte('#b8ccd8', { roughness: 0.35 }));
  pedestal.position.y = 0.425;
  pedestal.castShadow = true;
  g.add(pedestal);
  const ice = glassMaterial('#bfe8ff', { opacity: 0.4, roughness: 0.05 });
  const monkey = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), ice);
  body.position.y = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), ice);
  head.position.y = 0.38;
  monkey.add(body, head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ice);
    ear.position.set(s * 0.11, 0.42, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), ice);
    arm.position.set(s * 0.17, 0.18, 0.05);
    arm.rotation.z = s * -0.8;
    monkey.add(ear, arm);
  }
  const banana = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.024, 8, 12, Math.PI), ice);
  banana.position.set(0, 0.28, 0.16);
  monkey.add(banana);
  // frozen glow core, pulsing slowly
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), neonMaterial('#7ae8ff', 1.2));
  core.position.y = 0.2;
  monkey.add(core);
  monkey.position.y = 0.85;
  g.add(monkey);
  g.position.set(-3.2, 0, -2.3);
  ctx.group.add(g);
  ctx.updaters.push((dt, elapsed) => {
    monkey.rotation.y += dt * 0.25;
    core.material.emissiveIntensity = 1.2 + Math.sin(elapsed * 1.3) * 0.45;
  });
}

function hotSpring(ctx) {
  const g = new THREE.Group();
  const rock = matte('#5a666e', { roughness: 0.95 });
  const wallRing = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.42, 16, 1, true), rock);
  wallRing.position.y = 0.21;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 8, 18), rock);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.42;
  g.add(wallRing, rim);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const boulder = new THREE.Mesh(new THREE.SphereGeometry(0.11 + (i % 3) * 0.03, 8, 6), rock);
    boulder.position.set(Math.cos(a) * 0.82, 0.1, Math.sin(a) * 0.82);
    boulder.scale.y = 0.7;
    g.add(boulder);
  }
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.66, 20), neonMaterial('#6ee8d0', 0.75));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.36;
  g.add(water);
  // bubbles rise from the water and pop (fixed pool, reset in place)
  const bubbles = [];
  const bubbleMat = glassMaterial('#d8f8ff', { opacity: 0.55 });
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.016 + (i % 3) * 0.007, 6, 5), bubbleMat);
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const r = 0.12 + (i % 4) * 0.11;
    b.position.set(Math.cos(a) * r, 0.36 + (i / 8) * 0.3, Math.sin(a) * r);
    g.add(b);
    bubbles.push({ mesh: b, speed: 0.16 + (i % 3) * 0.05 });
  }
  g.position.set(3.15, 0, -2.7);
  ctx.group.add(g);
  ctx.updaters.push((dt, elapsed) => {
    water.material.emissiveIntensity = 0.75 + Math.sin(elapsed * 2.1) * 0.15;
    for (const b of bubbles) {
      b.mesh.position.y += b.speed * dt;
      if (b.mesh.position.y > 0.78) b.mesh.position.y = 0.37;
    }
  });
}

function icicleRack(ctx) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.1), woodMaterial(ctx.palette.accent, { seed: 82 }));
  g.add(bar);
  const ice = glassMaterial('#cfeeff', { opacity: 0.5, roughness: 0.04 });
  const lens = [0.34, 0.22, 0.42, 0.27, 0.48, 0.2, 0.38];
  for (let i = 0; i < 7; i++) {
    const len = lens[i];
    const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.032, len, 7), ice);
    icicle.position.set(-0.63 + i * 0.21, -len / 2 - 0.03, 0);
    icicle.rotation.x = Math.PI; // point down
    g.add(icicle);
  }
  // one meltwater drip slides down the longest icicle, then resets
  const drip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), neonMaterial('#bfeeff', 0.8));
  const dripX = -0.63 + 4 * 0.21;
  g.add(drip);
  onWall(g, 4.1, 2.15);
  ctx.group.add(g);
  let t = 0;
  ctx.updaters.push((dt) => {
    t += dt * 0.35;
    if (t > 1.3) t = 0;
    const k = Math.min(t, 1);
    drip.position.set(dripX, -0.03 - k * 0.5, 0.0);
    drip.visible = t <= 1;
  });
}

// ---------------------------------------------------------------------------
// Dune Saloon — desert western
// ---------------------------------------------------------------------------

function cactusJug(ctx) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.24, 12), matte('#9a5a34', { roughness: 0.9 }));
  pot.position.y = 0.12;
  const green = matte('#4a7a3a', { roughness: 0.85 });
  const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.5, 4, 10), green);
  trunk.position.y = 0.56;
  g.add(pot, trunk);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 4, 8), green);
    arm.position.set(s * 0.16, 0.62 + s * 0.06, 0);
    arm.rotation.z = s * -0.9;
    const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 8), green);
    tip.position.set(s * 0.24, 0.78 + s * 0.06, 0);
    g.add(arm, tip);
  }
  const flower = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), matte('#e86a9a', { emissive: '#e86a9a', emissiveIntensity: 0.4 }));
  flower.position.y = 0.9;
  g.add(flower);
  // moonshine jugs stacked beside it
  const clay = matte('#b08050', { roughness: 0.85 });
  for (const [x, z, s] of [[0.42, 0.1, 1], [0.62, -0.14, 0.8], [0.5, -0.02, 0.62]]) {
    const jug = new THREE.Group();
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.14 * s, 10, 8), clay);
    belly.scale.y = 1.15;
    belly.position.y = 0.15 * s;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 0.09 * s, 8), clay);
    neck.position.y = 0.32 * s;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * s, 0.024 * s, 0.03, 6), matte('#c9b295'));
    cork.position.y = 0.38 * s;
    jug.add(belly, neck, cork);
    jug.position.set(x, s === 0.62 ? 0.36 : 0, z);
    g.add(jug);
  }
  g.position.set(-3.3, 0, -2.5);
  ctx.group.add(g);
}

function makeWantedPosterTexture(variant) {
  const { canvas, ctx } = makeCanvas(256, 340);
  ctx.fillStyle = '#d8c49a';
  ctx.fillRect(0, 0, 256, 340);
  ctx.strokeStyle = '#5a3a1e';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 236, 320);
  ctx.fillStyle = '#3a2413';
  ctx.textAlign = 'center';
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.fillText('WANTED', 128, 62);
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(variant === 0 ? 'FOR CARD SHARPERY' : 'FOR BANANA THEFT', 128, 88);
  // mugshot: generic shady monkey
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath();
  ctx.arc(128, 170, 52, 0, Math.PI * 2);
  ctx.arc(84, 140, 18, 0, Math.PI * 2);
  ctx.arc(172, 140, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c39e';
  ctx.beginPath();
  ctx.ellipse(128, 186, 30, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(96, 148, 64, 12); // bandit eye-mask
  ctx.fillStyle = '#f0e8d8';
  ctx.fillRect(104, 151, 12, 6);
  ctx.fillRect(140, 151, 12, 6);
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillStyle = '#3a2413';
  ctx.fillText(variant === 0 ? '5000 BANANAS' : '2000 BANANAS', 128, 280);
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('DEAD OR ALIVE (ISH)', 128, 306);
  return canvasTexture(canvas);
}

function wantedPoster(ctx) {
  for (const [i, a, y, tilt] of [[0, 2.55, 1.9, 0.05], [1, -2.35, 1.75, -0.08]]) {
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.69),
      new THREE.MeshStandardMaterial({ map: makeWantedPosterTexture(i), roughness: 0.95 })
    );
    onWall(poster, a, y, 5.0);
    poster.rotation.z = tilt;
    ctx.group.add(poster);
  }
}

function swingDoors(ctx) {
  const g = new THREE.Group();
  const frameMat = woodMaterial('#3a2812', { seed: 92 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 0.12), frameMat);
    post.position.set(s * 0.66, 1.15, 0);
    g.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.14, 0.14), frameMat);
  lintel.position.y = 2.3;
  g.add(lintel);
  const doorMat = woodMaterial(ctx.palette.accent, { seed: 93, roughness: 0.7 });
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * 0.58, 0, 0);
    const door = new THREE.Group();
    for (let slat = 0; slat < 5; slat++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.03), doorMat);
      board.position.set(-s * 0.28, 0.85 + slat * 0.16, 0);
      door.add(board);
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.82, 0.035), doorMat);
    brace.position.set(-s * 0.28, 1.17, 0.02);
    brace.rotation.z = s * 0.55;
    door.add(brace);
    hinge.add(door);
    g.add(hinge);
    doors.push({ hinge, side: s, phase: s * 0.9 });
  }
  onWall(g, 2.45, 0, 4.95);
  ctx.group.add(g);
  // the desert wind never stops rattling them
  ctx.updaters.push((dt, elapsed) => {
    const gust = 0.35 + 0.65 * Math.max(0, Math.sin(elapsed * 0.21));
    for (const d of doors) {
      d.hinge.rotation.y = d.side * Math.sin(elapsed * 1.35 + d.phase) * 0.3 * gust;
    }
  });
}

// ---------------------------------------------------------------------------
// Temple Taproom — moss-eaten ruins
// ---------------------------------------------------------------------------

function stoneIdol(ctx) {
  const g = new THREE.Group();
  const stone = matte('#6a705a', { roughness: 1 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.34, 0.66), stone);
  base.position.y = 0.17;
  base.castShadow = true;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.6, 0.44), stone);
  torso.position.y = 0.64;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.4), stone);
  head.position.y = 1.16;
  head.castShadow = true;
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.42), stone);
  brow.position.y = 1.3;
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.1), stone);
  muzzle.position.set(0, 1.05, 0.24);
  g.add(base, torso, head, brow, muzzle);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.14), stone);
    ear.position.set(s * 0.28, 1.2, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), stone);
    arm.position.set(s * 0.36, 0.6, 0.08);
    arm.rotation.x = -0.25;
    g.add(ear, arm);
  }
  // the eyes judge every bluff
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), neonMaterial(ctx.palette.neon, 1.5));
    eye.position.set(s * 0.11, 1.2, 0.215);
    g.add(eye);
    eyes.push(eye.material);
  }
  const moss = matte('#3f7a30', { roughness: 0.95 });
  for (const [x, y, z] of [[-0.3, 0.36, 0.28], [0.34, 0.95, 0.18], [0.05, 1.4, 0.14], [-0.25, 0.7, -0.24]]) {
    const patch = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5), moss);
    patch.position.set(x, y, z);
    patch.scale.set(1, 0.35, 1);
    g.add(patch);
  }
  g.position.set(-3.25, 0, -2.75);
  g.rotation.y = 0.7;
  ctx.group.add(g);
  ctx.updaters.push((dt, elapsed) => {
    const glow = 1.5 + Math.sin(elapsed * 0.9) * 0.5 + (Math.sin(elapsed * 7.7) > 0.97 ? 0.8 : 0);
    eyes[0].emissiveIntensity = glow;
    eyes[1].emissiveIntensity = glow;
  });
}

function brazier(ctx) {
  const iron = matte('#33302a', { metalness: 0.6, roughness: 0.55 });
  for (const [bx, bz] of [[-2.55, -3.35], [2.55, -3.35]]) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.72, 8), iron);
      legMesh.position.set(Math.cos(a) * 0.16, 0.36, Math.sin(a) * 0.16);
      legMesh.rotation.z = Math.cos(a) * 0.22;
      legMesh.rotation.x = -Math.sin(a) * 0.22;
      g.add(legMesh);
    }
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.18, 0.16, 14, 1, true), iron);
    bowl.position.y = 0.76;
    const bowlRim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 16), iron);
    bowlRim.rotation.x = Math.PI / 2;
    bowlRim.position.y = 0.84;
    const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 12), neonMaterial('#ff6a2a', 1.1));
    coals.position.y = 0.78;
    g.add(bowl, bowlRim, coals);
    const flames = [];
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.1 - i * 0.025, 0.26 + i * 0.08, 8),
        neonMaterial(i === 2 ? '#ffd23d' : '#ff7a2a', 1.8 + i * 0.4)
      );
      flame.position.set((i - 1) * 0.05, 0.92 + i * 0.03, (i - 1) * -0.04);
      g.add(flame);
      flames.push({ mesh: flame, mat: flame.material, phase: i * 2.4, baseY: flame.position.y });
    }
    // rising embers (fixed pool)
    const embers = [];
    const emberMat = neonMaterial('#ffaa4a', 2.4);
    for (let i = 0; i < 5; i++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.011, 5, 4), emberMat);
      e.position.set((i % 3 - 1) * 0.07, 0.9 + i * 0.13, ((i + 1) % 3 - 1) * 0.06);
      g.add(e);
      embers.push({ mesh: e, speed: 0.28 + (i % 3) * 0.09, wobble: i * 2.1 });
    }
    const fireLight = new THREE.PointLight('#ff8a3a', 3.2, 4.5, 1.9);
    fireLight.position.y = 1.0;
    g.add(fireLight);
    g.position.set(bx, 0, bz);
    ctx.group.add(g);
    const phase = bx; // decorrelate the two braziers
    ctx.updaters.push((dt, elapsed) => {
      for (const f of flames) {
        f.mesh.scale.y = 1 + Math.sin(elapsed * 12 + f.phase + phase) * 0.24;
        f.mesh.scale.x = f.mesh.scale.z = 1 + Math.sin(elapsed * 9 + f.phase * 2) * 0.1;
        f.mat.emissiveIntensity = 1.9 + Math.sin(elapsed * 15 + f.phase + phase) * 0.4;
      }
      for (const e of embers) {
        e.mesh.position.y += e.speed * dt;
        e.mesh.position.x += Math.sin(elapsed * 3 + e.wobble) * 0.0012;
        if (e.mesh.position.y > 1.65) e.mesh.position.y = 0.9;
      }
      fireLight.intensity = 3.2 + Math.sin(elapsed * 13 + phase) * 0.7 + Math.sin(elapsed * 31 + phase) * 0.35;
    });
  }
}

function makeRuneTexture(neonHex) {
  const { canvas, ctx } = makeCanvas(512, 256);
  ctx.fillStyle = '#15170f';
  ctx.fillRect(0, 0, 512, 256);
  // faint stone blocks
  ctx.strokeStyle = '#242820';
  ctx.lineWidth = 3;
  for (let y = 0; y < 256; y += 64) {
    ctx.strokeRect(-8 + (y % 128) / 2, y, 140, 64);
    ctx.strokeRect(140 + (y % 128) / 2, y, 140, 64);
    ctx.strokeRect(288 + (y % 128) / 2, y, 140, 64);
    ctx.strokeRect(436 + (y % 128) / 2, y, 140, 64);
  }
  // two rows of angular glowing runes
  ctx.strokeStyle = neonHex;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 7; i++) {
      const cx = 44 + i * 68;
      const cy = 70 + row * 116;
      ctx.beginPath();
      let px = cx + (Math.random() - 0.5) * 24;
      let py = cy - 26;
      ctx.moveTo(px, py);
      const segs = 3 + Math.floor(Math.random() * 3);
      for (let sIdx = 0; sIdx < segs; sIdx++) {
        px = cx + (Math.random() - 0.5) * 40;
        py = cy - 26 + ((sIdx + 1) / segs) * 52;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  return canvasTexture(canvas);
}

function runeWall(ctx) {
  const tex = makeRuneTexture(ctx.palette.neon);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color(ctx.palette.neon),
    emissiveMap: tex,
    emissiveIntensity: 0.9,
    roughness: 0.95,
  });
  const wallPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), mat);
  onWall(wallPlane, -2.5, 1.7, 4.95);
  ctx.group.add(wallPlane);
  // the runes breathe
  ctx.updaters.push((dt, elapsed) => {
    mat.emissiveIntensity = 0.9 + Math.sin(elapsed * 0.7) * 0.35 + Math.sin(elapsed * 2.3) * 0.12;
  });
}

// ---------------------------------------------------------------------------
// Rooftop Rumpus — city skyline rooftop
// ---------------------------------------------------------------------------

function stringLights(ctx) {
  const bulbMats = [
    neonMaterial('#ffca7a', 2.0),
    neonMaterial(ctx.palette.neon, 2.0),
    neonMaterial('#ffca7a', 2.0),
    neonMaterial(ctx.palette.neon, 2.0),
  ];
  const wireMat = matte('#14120e');
  const spans = [
    [[-4.2, 2.9, -1.6], [0, 2.45, 0.4], [4.2, 2.9, -1.6]],
    [[-3.6, 2.8, 2.6], [0.2, 2.4, 1.2], [3.8, 2.8, 2.2]],
  ];
  for (const [si, span] of spans.entries()) {
    const curve = new THREE.CatmullRomCurve3(span.map((p) => new THREE.Vector3(...p)));
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.007, 4), wireMat);
    ctx.group.add(wire);
    for (let i = 0; i < 11; i++) {
      const p = curve.getPoint((i + 0.5) / 11);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bulbMats[(i + si) % 4]);
      bulb.position.set(p.x, p.y - 0.055, p.z);
      ctx.group.add(bulb);
    }
  }
  // twinkle: 4 phase groups so bulbs don't pulse in unison
  ctx.updaters.push((dt, elapsed) => {
    for (let i = 0; i < 4; i++) {
      bulbMats[i].emissiveIntensity = 2.0 + Math.sin(elapsed * 2.1 + i * 1.9) * 0.45 + Math.sin(elapsed * 6.7 + i * 4.2) * 0.2;
    }
  });
}

function makeBillboardTexture(neonHex) {
  const { canvas, ctx } = makeCanvas(512, 288);
  ctx.fillStyle = '#0d0d16';
  ctx.fillRect(0, 0, 512, 288);
  ctx.strokeStyle = neonHex;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 484, 260);
  ctx.textAlign = 'center';
  ctx.fillStyle = neonHex;
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText('HOTEL RUMPUS', 256, 108);
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillStyle = '#ffd23d';
  ctx.fillText('VACANCY', 256, 178);
  ctx.font = '26px system-ui, sans-serif';
  ctx.fillStyle = '#c8c8e0';
  ctx.fillText('cheap rooms · cheaper cocktails', 256, 234);
  // a martini glass doodle
  ctx.strokeStyle = '#7ae8ff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(58, 190);
  ctx.lineTo(90, 230);
  ctx.lineTo(122, 190);
  ctx.closePath();
  ctx.moveTo(90, 230);
  ctx.lineTo(90, 258);
  ctx.stroke();
  return canvasTexture(canvas);
}

function billboard(ctx) {
  const g = new THREE.Group();
  const tex = makeBillboardTexture(ctx.palette.neon);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: '#ffffff',
    emissiveMap: tex,
    emissiveIntensity: 0.85,
    roughness: 0.6,
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.18), mat);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.24, 1.32, 0.07), steel('#2a2c34'));
  frame.position.z = -0.045;
  g.add(board, frame);
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), steel('#2a2c34'));
    strut.position.set(s * 0.8, -0.85, -0.12);
    strut.rotation.x = 0.35;
    g.add(strut);
  }
  onWall(g, 2.9, 2.35, 4.9);
  ctx.group.add(g);
  // tired hotel sign: hums, sags, drops out
  ctx.updaters.push((dt, elapsed) => {
    const dropout = Math.sin(elapsed * 5.3) > 0.985 || Math.sin(elapsed * 0.43) > 0.995 ? 0.12 : 1;
    mat.emissiveIntensity = (0.78 + Math.sin(elapsed * 21) * 0.07) * dropout;
  });
}

function acUnit(ctx) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.52, 0.48), steel('#9aa0a8', 0.5));
  box.position.y = 0.31;
  box.castShadow = true;
  g.add(box);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 18), steel('#33363c'));
  ring.position.set(0, 0.33, 0.245);
  g.add(ring);
  const fanHub = new THREE.Group();
  fanHub.position.set(0, 0.33, 0.24);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.012), steel('#4a4e56'));
    blade.position.y = 0.075;
    const holder = new THREE.Group();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    holder.add(blade);
    fanHub.add(holder);
  }
  g.add(fanHub);
  for (let i = 0; i < 4; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.015, 0.05), steel('#33363c'));
    vent.position.set(0, 0.585, -0.16 + i * 0.1);
    g.add(vent);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), steel('#6a6e76'));
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(0.3, 0.14, -0.6);
  g.add(pipe);
  const drip = new THREE.Mesh(new THREE.CircleGeometry(0.14, 10), matte('#1c2026', { roughness: 0.2, metalness: 0.3 }));
  drip.rotation.x = -Math.PI / 2;
  drip.position.set(0.05, 0.006, 0.5);
  g.add(drip);
  g.position.set(-3.5, 0, 2.7);
  g.rotation.y = 0.9;
  ctx.group.add(g);
  const baseY = 0;
  ctx.updaters.push((dt, elapsed) => {
    fanHub.rotation.z -= dt * 7;
    g.position.y = baseY + Math.sin(elapsed * 43) * 0.0016; // rattle
  });
}

// ---------------------------------------------------------------------------
// Submarine Speakeasy — leaky sub on the sea floor
// ---------------------------------------------------------------------------

function periscope(ctx) {
  const g = new THREE.Group();
  const brass = brassMaterial();
  const column = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.0, 12), brass);
  tube.position.y = 2.5;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), steel('#3a3e44'));
  collar.position.y = 1.56;
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), brass);
  headBox.position.set(0, 1.42, 0.06);
  const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.1, 10), steel('#22262c'));
  eyepiece.rotation.x = Math.PI / 2;
  eyepiece.position.set(0, 1.42, 0.26);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.048, 12), neonMaterial(ctx.palette.neon, 0.8));
  lens.position.set(0, 1.42, 0.315);
  column.add(tube, collar, headBox, eyepiece, lens);
  for (const s of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), steel('#3a3e44'));
    grip.position.set(s * 0.2, 1.32, 0.06);
    grip.rotation.z = s * 0.5;
    column.add(grip);
  }
  g.add(column);
  g.position.set(2.7, 0, -1.9);
  ctx.group.add(g);
  // idly scanning the sea floor
  ctx.updaters.push((dt, elapsed) => {
    column.rotation.y = Math.sin(elapsed * 0.22) * 1.2;
  });
}

function valveWall(ctx) {
  const g = new THREE.Group();
  const pipeMat = steel('#556066', 0.4);
  const vPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.4, 10), pipeMat);
  vPipe.position.set(-0.5, 1.2, 0);
  const hPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 10), pipeMat);
  hPipe.rotation.z = Math.PI / 2;
  hPipe.position.set(0.15, 1.35, 0);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), pipeMat);
  joint.position.set(-0.5, 1.35, 0);
  g.add(vPipe, hPipe, joint);
  const mkWheel = (color) => {
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 14), matte(color, { metalness: 0.6, roughness: 0.4 }));
    wheel.add(rim);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6), matte(color, { metalness: 0.6, roughness: 0.4 }));
      spoke.rotation.z = (i / 3) * Math.PI;
      wheel.add(spoke);
    }
    return wheel;
  };
  const spinner = mkWheel('#c23b3b');
  spinner.position.set(-0.5, 1.35, 0.12);
  const wheel2 = mkWheel('#b8862e');
  wheel2.position.set(0.55, 1.35, 0.1);
  const wheel3 = mkWheel('#c23b3b');
  wheel3.position.set(-0.5, 0.55, 0.1);
  g.add(spinner, wheel2, wheel3);
  // pressure gauge with a nervous needle
  const gauge = new THREE.Group();
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), steel('#22262c'));
  dial.rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), matte('#e8e4d0', { roughness: 0.6 }));
  face.position.z = 0.021;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.062, 0.004), matte('#c23b3b'));
  needle.position.z = 0.026;
  needle.geometry.translate(0, 0.028, 0);
  gauge.add(dial, face, needle);
  gauge.position.set(0.15, 1.62, 0.05);
  g.add(gauge);
  onWall(g, -2.2, 0, 4.8);
  ctx.group.add(g);
  ctx.updaters.push((dt, elapsed) => {
    spinner.rotation.z += dt * 0.5;
    needle.rotation.z = -0.6 + Math.sin(elapsed * 2.3) * 0.3 + Math.sin(elapsed * 9.1) * 0.07;
  });
}

function makeSonarTexture() {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#03120c';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#0e5038';
  ctx.lineWidth = 2;
  for (let r = 30; r <= 120; r += 30) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(8, 128);
  ctx.lineTo(248, 128);
  ctx.moveTo(128, 8);
  ctx.lineTo(128, 248);
  ctx.stroke();
  return canvasTexture(canvas);
}

function sonarScreen(ctx) {
  const g = new THREE.Group();
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.42), steel('#2c343a', 0.5));
  console_.position.y = 0.525;
  console_.castShadow = true;
  g.add(console_);
  for (let i = 0; i < 4; i++) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 8), matte(i % 2 ? '#c23b3b' : '#b8862e', { metalness: 0.5, roughness: 0.4 }));
    knob.rotation.x = Math.PI / 2;
    knob.position.set(-0.24 + i * 0.16, 0.32, 0.22);
    g.add(knob);
  }
  const screenGroup = new THREE.Group();
  screenGroup.position.set(0, 0.98, 0.13);
  screenGroup.rotation.x = -0.5; // tilted up toward the table
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.34, 0.09, 20), steel('#22262c'));
  bezel.rotation.x = Math.PI / 2;
  const sonarTex = makeSonarTexture();
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 24),
    new THREE.MeshStandardMaterial({
      map: sonarTex,
      emissive: '#1a6a48',
      emissiveMap: sonarTex,
      emissiveIntensity: 2.2,
      roughness: 0.4,
    })
  );
  face.position.z = 0.05;
  // the sweep: an emissive sector that rotates about the screen center
  const sweep = new THREE.Mesh(new THREE.CircleGeometry(0.27, 14, 0, 0.55), neonMaterial(ctx.palette.neon, 1.6));
  sweep.position.z = 0.055;
  // contact blips light up as the sweep passes
  const blips = [];
  for (const [ba, br] of [[1.1, 0.16], [3.9, 0.22]]) {
    const blip = new THREE.Mesh(new THREE.CircleGeometry(0.016, 8), neonMaterial('#7dffc8', 0.3));
    blip.position.set(Math.cos(ba) * br, Math.sin(ba) * br, 0.056);
    screenGroup.add(blip);
    blips.push({ mat: blip.material, angle: ba });
  }
  screenGroup.add(bezel, face, sweep);
  g.add(screenGroup);
  g.position.set(-2.75, 0, -2.55);
  g.rotation.y = 0.75;
  ctx.group.add(g);
  const TWO_PI = Math.PI * 2;
  ctx.updaters.push((dt, elapsed) => {
    sweep.rotation.z -= dt * 1.4;
    if (sweep.rotation.z < -TWO_PI) sweep.rotation.z += TWO_PI;
    // the sector geometry spans local angles [rotation.z, rotation.z + 0.55]
    const sweepA = ((sweep.rotation.z % TWO_PI) + TWO_PI) % TWO_PI;
    for (const b of blips) {
      let d = Math.abs(sweepA - b.angle);
      if (d > Math.PI) d = TWO_PI - d;
      b.mat.emissiveIntensity = 0.3 + Math.max(0, 1 - d * 0.9) * 2.6;
    }
  });
}

// ---------------------------------------------------------------------------
// Per-map structural accents (2–3 cheap identity pieces, keyed by map id)
// ---------------------------------------------------------------------------

function accentsRumbleReef(ctx) {
  // curved hull ribs arcing overhead — you're drinking inside the wreck
  const ribMat = woodMaterial('#26343a', { seed: 51, roughness: 0.8 });
  for (const z of [-2.4, 0, 2.4]) {
    const r = Math.sqrt(Math.max(ROOM_RADIUS * ROOM_RADIUS - z * z, 1));
    const rib = new THREE.Mesh(new THREE.TorusGeometry(Math.min(r, ROOM_HEIGHT + 1.2), 0.07, 6, 24, Math.PI), ribMat);
    rib.position.set(0, 0, z);
    rib.scale.y = ROOM_HEIGHT / Math.min(r, ROOM_HEIGHT + 1.2);
    ctx.group.add(rib);
  }
  // drifts of sea sand on the floorboards
  const sand = matte('#cfc09a', { roughness: 1 });
  for (const [x, z, s] of [[2.6, 2.9, 1], [-3.4, 1.2, 0.8], [-1.2, -3.6, 1.2]]) {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.55 * s, 10, 6), sand);
    mound.position.set(x, -0.42 * s, z);
    mound.scale.y = 0.22;
    mound.receiveShadow = true;
    ctx.group.add(mound);
  }
  // a coiled mooring rope
  const ropeMat = matte('#a08a5a', { roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.26 - i * 0.05, 0.035, 6, 16), ropeMat);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(3.6, 0.035 + i * 0.06, 2.2);
    ctx.group.add(coil);
  }
}

function accentsCanopyCasino(ctx) {
  // crimson carpet under the table
  const carpet = new THREE.Mesh(new THREE.CircleGeometry(TABLE_RADIUS + 1.4, 32), matte('#4a1020', { roughness: 1 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.012;
  carpet.receiveShadow = true;
  ctx.group.add(carpet);
  const goldTrim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_RADIUS + 1.38, 0.02, 6, 40), brassMaterial());
  goldTrim.rotation.x = Math.PI / 2;
  goldTrim.position.y = 0.02;
  ctx.group.add(goldTrim);
  // second gilded wainscot ring — money on the walls
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ROOM_RADIUS + 0.05, 0.03, 6, 48), brassMaterial());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.1;
  ctx.group.add(ring);
  // heavy velvet drapes on the back wall corners
  const drapeMat = matte('#5a1626', { roughness: 0.95 });
  for (const a of [3.55, 2.75]) {
    const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 8, 1), drapeMat);
    onWall(drape, a, 1.5, 5.05);
    drape.scale.z = 0.55;
    ctx.group.add(drape);
  }
}

function accentsFrostbite(ctx) {
  // sheet of ice over the floorboards
  const iceSheet = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS - 0.4, 36), glassMaterial('#bfe8ff', { opacity: 0.16, roughness: 0.05 }));
  iceSheet.rotation.x = -Math.PI / 2;
  iceSheet.position.y = 0.015;
  ctx.group.add(iceSheet);
  // snow drifts piled against the walls
  const snow = matte('#e8f2fa', { roughness: 1 });
  for (const a of [0.6, 1.7, 3.4, 4.6, 5.6]) {
    const drift = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 6), snow);
    drift.position.set(Math.sin(a) * (ROOM_RADIUS - 0.35), -0.45, Math.cos(a) * (ROOM_RADIUS - 0.35));
    drift.scale.set(1.4, 0.42, 0.9);
    drift.receiveShadow = true;
    ctx.group.add(drift);
  }
  // frost hanging off the rafters
  const frost = glassMaterial('#cfeeff', { opacity: 0.45 });
  for (let i = 0; i < 8; i++) {
    const len = 0.14 + (i % 4) * 0.07;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.022, len, 6), frost);
    spike.position.set(-3 + i * 0.85, ROOM_HEIGHT - 0.22 - len / 2, (i % 2 ? 1 : -1) * 1.7);
    spike.rotation.x = Math.PI;
    ctx.group.add(spike);
  }
}

function accentsDuneSaloon(ctx) {
  // wind-blown sand over the whole floor
  const sandFloor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS + 0.1, 40), matte('#b89b62', { roughness: 1 }));
  sandFloor.rotation.x = -Math.PI / 2;
  sandFloor.position.y = 0.01;
  sandFloor.receiveShadow = true;
  ctx.group.add(sandFloor);
  // shuttered windows rattling on the walls
  const shutterMat = woodMaterial('#6a4a24', { seed: 96, roughness: 0.8 });
  for (const [a, y] of [[-2.7, 1.75], [3.3, 1.8]]) {
    const win = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.9, 0.05), shutterMat);
    win.add(frame);
    for (const s of [-1, 1]) {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.84, 0.03), shutterMat);
      shutter.position.set(s * 0.36, 0, 0.045);
      shutter.rotation.y = s * 0.35;
      win.add(shutter);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.74), neonMaterial('#ffb45a', 0.55));
    glow.position.z = 0.028;
    win.add(glow);
    onWall(win, a, y, 4.95);
    ctx.group.add(win);
  }
  // a wagon wheel leaning by the doors
  const wagonWood = woodMaterial('#5a3a1c', { seed: 97 });
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 22), wagonWood));
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.96, 8), wagonWood);
    spoke.rotation.z = (i / 4) * Math.PI;
    wheel.add(spoke);
  }
  onWall(wheel, 1.75, 0.52, 4.8);
  wheel.rotation.x = -0.16; // leaning back against the wall
  ctx.group.add(wheel);
}

function accentsTempleTaproom(ctx) {
  // mossy stone columns holding the ruins up
  const stone = matte('#5c6250', { roughness: 1 });
  const moss = matte('#3f7a30', { roughness: 0.95 });
  for (const a of [0.85, 2.0, 4.3, 5.45]) {
    const x = Math.sin(a) * (ROOM_RADIUS - 0.55);
    const z = Math.cos(a) * (ROOM_RADIUS - 0.55);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, ROOM_HEIGHT, 10), stone);
    col.position.set(x, ROOM_HEIGHT / 2, z);
    col.castShadow = true;
    ctx.group.add(col);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.72), stone);
    cap.position.set(x, ROOM_HEIGHT - 0.1, z);
    ctx.group.add(cap);
    const mossPatch = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), moss);
    mossPatch.position.set(x * 0.96, 0.4 + (a % 1), z * 0.96);
    mossPatch.scale.set(1, 1.6, 0.45);
    ctx.group.add(mossPatch);
  }
  // cracked flagstone circle under the table
  const { canvas, ctx: c2d } = makeCanvas(256, 256);
  c2d.fillStyle = '#4c5244';
  c2d.fillRect(0, 0, 256, 256);
  c2d.strokeStyle = '#2c3026';
  c2d.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    c2d.beginPath();
    let px = Math.random() * 256;
    let py = Math.random() * 256;
    c2d.moveTo(px, py);
    for (let s = 0; s < 4; s++) {
      px += (Math.random() - 0.5) * 90;
      py += (Math.random() - 0.5) * 90;
      c2d.lineTo(px, py);
    }
    c2d.stroke();
  }
  const flagstone = new THREE.Mesh(
    new THREE.CircleGeometry(TABLE_RADIUS + 1.5, 28),
    new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 1 })
  );
  flagstone.rotation.x = -Math.PI / 2;
  flagstone.position.y = 0.011;
  flagstone.receiveShadow = true;
  ctx.group.add(flagstone);
  // fallen rubble blocks
  for (const [x, z, ry] of [[3.7, 1.5, 0.4], [-2.1, 3.6, 1.1], [1.4, -3.9, 2.2]]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.36), stone);
    block.position.set(x, 0.15, z);
    block.rotation.set(0.1, ry, 0.08);
    block.castShadow = true;
    ctx.group.add(block);
  }
}

function makeSkylineTexture(neonHex) {
  const { canvas, ctx } = makeCanvas(1024, 256);
  ctx.fillStyle = '#080a12';
  ctx.fillRect(0, 0, 1024, 256);
  // building silhouettes with lit windows
  let x = 0;
  while (x < 1024) {
    const w = 40 + Math.random() * 70;
    const h = 70 + Math.random() * 150;
    ctx.fillStyle = '#0e1018';
    ctx.fillRect(x, 256 - h, w, h);
    ctx.fillStyle = Math.random() > 0.35 ? '#ffd98a' : neonHex;
    for (let wy = 256 - h + 10; wy < 244; wy += 16) {
      for (let wx = x + 6; wx < x + w - 8; wx += 14) {
        if (Math.random() > 0.55) ctx.fillRect(wx, wy, 5, 7);
      }
    }
    x += w + 6;
  }
  // a few stars
  ctx.fillStyle = '#c8d0e0';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect(Math.random() * 1024, Math.random() * 70, 2, 2);
  }
  return canvasTexture(canvas);
}

function accentsRooftopRumpus(ctx) {
  // the city glows past the parapet — skyline band wrapping the upper wall
  const tex = makeSkylineTexture(ctx.palette.neon);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  const skyline = new THREE.Mesh(
    new THREE.CylinderGeometry(ROOM_RADIUS + 0.12, ROOM_RADIUS + 0.12, 1.5, 36, 1, true),
    new THREE.MeshStandardMaterial({
      map: tex,
      emissive: '#ffffff',
      emissiveMap: tex,
      emissiveIntensity: 0.55,
      roughness: 1,
      side: THREE.BackSide,
    })
  );
  skyline.position.y = 2.2;
  ctx.group.add(skyline);
  // concrete parapet ledge where the wall meets the "view"
  const parapet = new THREE.Mesh(new THREE.CylinderGeometry(ROOM_RADIUS + 0.1, ROOM_RADIUS + 0.14, 0.14, 36, 1, true), matte('#5a5c64', { roughness: 0.95 }));
  parapet.position.y = 1.5;
  parapet.material.side = THREE.DoubleSide;
  ctx.group.add(parapet);
  // rooftop planters with scrappy shrubs
  const planterMat = matte('#3a3c44', { roughness: 0.9 });
  const shrub = matte('#3f6a30', { roughness: 0.95 });
  for (const [x, z] of [[-3.3, -2.2], [3.4, 2.1], [-2.4, 3.3]]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.32), planterMat);
    box.position.set(x, 0.16, z);
    box.castShadow = true;
    ctx.group.add(box);
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), shrub);
      puff.position.set(x - 0.2 + i * 0.2, 0.42, z + (i % 2) * 0.06 - 0.03);
      ctx.group.add(puff);
    }
  }
}

function accentsSubmarine(ctx) {
  // steel hull frames arcing overhead — riveted and rusty
  const frameMat = steel('#3a4248', 0.55);
  for (const z of [-2.6, -0.9, 0.9, 2.6]) {
    const r = Math.sqrt(Math.max(ROOM_RADIUS * ROOM_RADIUS - z * z, 1));
    const rib = new THREE.Mesh(new THREE.TorusGeometry(Math.min(r, ROOM_HEIGHT + 1.0), 0.06, 6, 22, Math.PI), frameMat);
    rib.position.set(0, 0, z);
    rib.scale.y = ROOM_HEIGHT / Math.min(r, ROOM_HEIGHT + 1.0);
    ctx.group.add(rib);
  }
  // hull plate seam rings
  for (const y of [0.55, 2.5]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(ROOM_RADIUS + 0.02, 0.028, 6, 44), frameMat);
    seam.rotation.x = Math.PI / 2;
    seam.position.y = y;
    ctx.group.add(seam);
  }
  // sealed bulkhead hatch — the only way out
  const hatch = new THREE.Group();
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.09, 22), steel('#4a545c', 0.5));
  door.rotation.x = Math.PI / 2;
  const hatchRim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 24), frameMat);
  hatch.add(door, hatchRim);
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.024, 6, 16), brassMaterial());
  wheelRim.position.z = 0.09;
  hatch.add(wheelRim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), brassMaterial());
    spoke.rotation.z = (i / 3) * Math.PI;
    spoke.position.z = 0.09;
    hatch.add(spoke);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), frameMat);
    rivet.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.02);
    hatch.add(rivet);
  }
  onWall(hatch, 2.6, 1.5, 5.0);
  ctx.group.add(hatch);
}

// ---------------------------------------------------------------------------
// Exports consumed by barScene.js
// ---------------------------------------------------------------------------

/** extraProps id → builder(ctx), merged into barScene's EXTRA_PROP_BUILDERS. */
export const EXTRA_BUILDERS = {
  ship_wheel: shipWheel,
  porthole,
  net_ceiling: netCeiling,
  chip_tower: chipTower,
  velvet_rope: velvetRope,
  chandelier,
  ice_sculpture: iceSculpture,
  hot_spring: hotSpring,
  icicle_rack: icicleRack,
  cactus_jug: cactusJug,
  wanted_poster: wantedPoster,
  swing_doors: swingDoors,
  stone_idol: stoneIdol,
  brazier,
  rune_wall: runeWall,
  string_lights: stringLights,
  billboard,
  ac_unit: acUnit,
  periscope,
  valve_wall: valveWall,
  sonar_screen: sonarScreen,
};

/** map id → structural accent pass, run by buildBar after the generic build. */
export const MAP_ACCENTS = {
  rumble_reef: accentsRumbleReef,
  canopy_casino: accentsCanopyCasino,
  frostbite_lounge: accentsFrostbite,
  dune_saloon: accentsDuneSaloon,
  temple_taproom: accentsTempleTaproom,
  rooftop_rumpus: accentsRooftopRumpus,
  submarine_speakeasy: accentsSubmarine,
};
