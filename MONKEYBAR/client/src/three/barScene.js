// Bar builder — PLAN.md §7 (client/src/three/barScene.js).
// `buildBar(mapConfig)` constructs a full bar interior from a shared/maps.js
// config. Hero map "The Peeling Parrot" fully implemented; the other playable
// palettes (Neon Nectar, Voodoo Vats) reuse the layout with their own palette,
// densities and extra props.

import * as THREE from 'three';
import { woodMaterial, neonMaterial, matte } from './materials.js';
import { createBottle, createStool } from './props.js';

export const TABLE_RADIUS = 1.15;
export const TABLE_TOP_Y = 0.92;
export const SEAT_RADIUS = 1.78;
export const STOOL_SEAT_H = 0.62;
export const ROOM_RADIUS = 5.4;
export const ROOM_HEIGHT = 3.5;

// ---------------------------------------------------------------------------
// Neon stroke font — polyline strokes on a 4x6 grid, extruded as TubeGeometry
// ---------------------------------------------------------------------------

const GLYPHS = {
  A: [[[0, 0], [2, 6], [4, 0]], [[1, 2.4], [3, 2.4]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 3.8], [3, 3], [0, 3]], [[3, 3], [4, 2.2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2.6], [2.4, 2.6]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[2, 0], [2, 6]], [[1, 6], [3, 6]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2.8]], [[1.4, 3.8], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  P: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 3.8], [3, 3], [0, 3]]],
  Q: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[2.6, 1.4], [4, -0.4]]],
  R: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 3.8], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 3.5], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
};

function strokeToCurve(points, scale, ox, oy) {
  const path = new THREE.CurvePath();
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3(ox + points[i][0] * scale, oy + points[i][1] * scale, 0);
    const b = new THREE.Vector3(ox + points[i + 1][0] * scale, oy + points[i + 1][1] * scale, 0);
    path.add(new THREE.LineCurve3(a, b));
  }
  return path;
}

/**
 * Neon sign: TubeGeometry strokes spelling `text` (wraps once on long texts),
 * mounted on a dark backboard. Local +z faces the viewer.
 */
export function buildNeonSign(text, { color = '#39ff88', letterHeight = 0.22, tubeRadius = 0.012, board = true } = {}) {
  const group = new THREE.Group();
  group.name = `neon_sign_${text}`;
  const mat = neonMaterial(color, 3.2);

  // wrap into max 2 lines on a space near the middle
  let lines = [text.toUpperCase()];
  if (text.length > 12 && text.includes(' ')) {
    const mid = Math.floor(text.length / 2);
    let best = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ' && (best === -1 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    if (best > 0) lines = [text.slice(0, best).toUpperCase(), text.slice(best + 1).toUpperCase()];
  }

  const scale = letterHeight / 6;
  const charW = 4 * scale;
  const gap = 1.6 * scale;
  const lineGap = letterHeight * 1.45;
  let maxW = 0;

  lines.forEach((line, li) => {
    const width = line.length * (charW + gap) - gap;
    maxW = Math.max(maxW, width);
    let x = -width / 2;
    const y = (lines.length - 1) * lineGap * 0.5 - li * lineGap;
    for (const ch of line) {
      const glyph = GLYPHS[ch];
      if (glyph) {
        for (const stroke of glyph) {
          const curve = strokeToCurve(stroke, scale, x, y);
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, stroke.length * 4, tubeRadius, 6),
            mat
          );
          group.add(tube);
        }
      }
      x += charW + gap;
    }
  });

  if (board) {
    const bh = lines.length * lineGap + letterHeight * 0.9;
    const bg = new THREE.Mesh(
      new THREE.BoxGeometry(maxW + letterHeight * 1.2, bh, 0.03),
      matte('#12100c', { roughness: 0.85 })
    );
    bg.position.z = -0.035;
    group.add(bg);
  }
  group.userData.neonMat = mat;
  return group;
}

/** Neon parrot outline for the hero map. */
function buildParrotSign(neonHex) {
  const g = new THREE.Group();
  const body = [
    [0.0, 0.55], [0.12, 0.72], [0.3, 0.78], [0.42, 0.7], [0.44, 0.58], [0.36, 0.52],
    [0.44, 0.46], [0.42, 0.3], [0.32, 0.05], [0.22, -0.25], [0.12, -0.5],
  ];
  const wing = [[0.16, 0.4], [0.3, 0.3], [0.32, 0.08], [0.22, -0.1], [0.12, 0.05], [0.12, 0.28], [0.16, 0.4]];
  const beak = [[0.42, 0.66], [0.56, 0.6], [0.46, 0.5]];
  const tail = [[0.22, -0.25], [0.05, -0.55], [0.16, -0.5], [0.02, -0.78]];
  const mkTube = (pts, hex, r = 0.014) => {
    const v = pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
    const curve = new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0.1);
    return new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 6, r, 6), neonMaterial(hex, 3));
  };
  g.add(mkTube(body, neonHex));
  g.add(mkTube(wing, '#ffd23d'));
  g.add(mkTube(beak, '#ff5a3d'));
  g.add(mkTube(tail, '#3dc8ff'));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), neonMaterial('#ffffff', 3));
  eye.position.set(0.3, 0.62, 0);
  g.add(eye);
  g.scale.setScalar(1.15);
  return g;
}

// ---------------------------------------------------------------------------
// Extra props (per-map ids from propParams.extraProps)
// ---------------------------------------------------------------------------

const EXTRA_PROP_BUILDERS = {
  parrot_sign(ctx) {
    const sign = buildParrotSign(ctx.palette.neon);
    sign.position.set(2.9, 2.1, -ROOM_RADIUS + 0.7);
    sign.rotation.y = -0.3;
    ctx.group.add(sign);
  },
  dartboard(ctx) {
    const g = new THREE.Group();
    const rings = ['#e8e0d0', '#1a1612', '#c23b3b', '#2a5a3d'];
    for (let i = 0; i < 4; i++) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.24 - i * 0.055, 0.24 - i * 0.055, 0.02 + i * 0.002, 20), matte(rings[i]));
      disc.rotation.x = Math.PI / 2;
      g.add(disc);
    }
    g.position.set(-3.6, 1.75, -ROOM_RADIUS + 0.62);
    g.rotation.y = 0.35;
    ctx.group.add(g);
  },
  barrel_stool(ctx) {
    for (const [x, z] of [[3.6, 1.6], [3.9, 2.4]]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 14), woodMaterial(ctx.palette.accent, { seed: 31 }));
      barrel.position.set(x, 0.31, z);
      barrel.castShadow = true;
      for (const y of [0.18, 0.45]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.012, 6, 18), matte('#3a3a3a', { metalness: 0.8, roughness: 0.4 }));
        hoop.rotation.x = Math.PI / 2;
        hoop.position.set(x, y, z);
        ctx.group.add(hoop);
      }
      ctx.group.add(barrel);
    }
  },
  neon_palm(ctx) {
    const g = new THREE.Group();
    const trunk = strokeToCurve([[0, 0], [0.4, 2], [0.3, 4], [0.5, 6]], 0.22, 0, 0);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(trunk, 12, 0.016, 6), neonMaterial('#ff9a3d', 2.6)));
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      const frond = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.11, 1.32, 0),
        new THREE.Vector3(0.11 + Math.cos(a) * 0.4, 1.32 + Math.sin(a) * 0.42 + 0.18, 0),
        new THREE.Vector3(0.11 + Math.cos(a) * 0.75, 1.32 + Math.sin(a) * 0.7 - 0.12, 0),
      ]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(frond, 10, 0.013, 6), neonMaterial(ctx.palette.neon, 2.6)));
    }
    g.position.set(-3.2, 0.8, -ROOM_RADIUS + 0.75);
    g.rotation.y = 0.35;
    ctx.group.add(g);
  },
  jukebox(ctx) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.25, 0.5), matte('#3a1a4a', { roughness: 0.4 }));
    body.position.y = 0.625;
    body.castShadow = true;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 20, Math.PI), neonMaterial(ctx.palette.neon, 2.8));
    arch.position.y = 1.22;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), neonMaterial('#ffd23d', 1.4));
    screen.position.set(0, 0.95, 0.251);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.02), matte('#181018'));
    slot.position.set(0, 0.55, 0.25);
    g.add(body, arch, screen, slot);
    g.position.set(3.4, 0, -2.6);
    g.rotation.y = -0.55;
    ctx.group.add(g);
  },
  chrome_rail(ctx) {
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE_RADIUS + 0.9, 0.02, 8, 48),
      matte('#c8ccd8', { metalness: 0.95, roughness: 0.15 })
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.25;
    ctx.group.add(rail);
  },
  brew_vat(ctx) {
    for (const [x, z, s] of [[-3.3, -2.6, 1], [-3.9, -1.4, 0.8]]) {
      const g = new THREE.Group();
      const vat = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * s, 0.5 * s, 0.9 * s, 14), matte('#2a3a24', { metalness: 0.6, roughness: 0.5 }));
      vat.position.y = 0.45 * s;
      vat.castShadow = true;
      const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.4 * s, 0.4 * s, 0.05, 14), neonMaterial('#a4ff3d', 1.6));
      brew.position.y = 0.9 * s;
      const pipe = new THREE.Mesh(new THREE.TorusGeometry(0.18 * s, 0.03, 6, 12, Math.PI), matte('#4a4a42', { metalness: 0.7, roughness: 0.4 }));
      pipe.position.set(0.3 * s, 1.0 * s, 0);
      g.add(vat, brew, pipe);
      g.position.set(x, 0, z);
      ctx.group.add(g);
    }
  },
  skull_shelf(ctx) {
    const g = new THREE.Group();
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.3), woodMaterial(ctx.palette.accent, { seed: 12 }));
    g.add(shelf);
    for (let i = 0; i < 3; i++) {
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), matte('#ddd6c4', { roughness: 0.9 }));
      skull.scale.y = 1.1;
      skull.position.set(-0.45 + i * 0.45, 0.11, 0);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.08), matte('#ccc4b0'));
      jaw.position.set(-0.45 + i * 0.45, 0.015, 0.03);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.CircleGeometry(0.02, 8), neonMaterial('#a4ff3d', 1.8));
        eye.position.set(-0.45 + i * 0.45 + s * 0.032, 0.13, 0.083);
        g.add(eye);
      }
      g.add(skull, jaw);
    }
    g.position.set(-3.5, 2.0, -ROOM_RADIUS + 0.7);
    g.rotation.y = 0.4;
    ctx.group.add(g);
  },
  lantern_string(ctx) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = -Math.PI * 0.75 + t * Math.PI * 1.5;
      pts.push(new THREE.Vector3(Math.cos(a) * (ROOM_RADIUS - 1.1), 2.6 + Math.sin(t * Math.PI * 4) * 0.12, Math.sin(a) * (ROOM_RADIUS - 1.1)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.006, 4), matte('#1a1612'));
    ctx.group.add(wire);
    for (let i = 0; i < 8; i++) {
      const p = curve.getPoint((i + 0.5) / 8);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), neonMaterial(i % 2 ? ctx.palette.neon : '#ffca7a', 1.9));
      lantern.position.copy(p);
      lantern.position.y -= 0.09;
      ctx.group.add(lantern);
    }
  },
};

// ---------------------------------------------------------------------------
// buildBar
// ---------------------------------------------------------------------------

/**
 * Construct the bar interior for a map config from shared/maps.js.
 * Returns { group, update(dt, elapsed), seatRadius, tableTopY, stoolSeatH,
 *           floorY, cannonMountY, dispose }.
 */
export function buildBar(mapConfig) {
  const { palette, propParams, signText } = mapConfig;
  const group = new THREE.Group();
  group.name = `bar_${mapConfig.id}`;

  /** things to animate: { fn(dt, elapsed) } */
  const updaters = [];

  // ---- floor / walls / ceiling ----
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(ROOM_RADIUS + 0.2, 40),
    woodMaterial(palette.wall, { seed: 3, repeat: [3, 3], roughness: 0.85 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ROOM_RADIUS + 0.2, ROOM_RADIUS + 0.2, ROOM_HEIGHT, 36, 1, true),
    new THREE.MeshStandardMaterial({
      map: woodMaterial(palette.wall, { seed: 9, repeat: [8, 1.4] }).map,
      color: new THREE.Color(palette.wall).multiplyScalar(0.8),
      roughness: 0.92,
      side: THREE.BackSide,
    })
  );
  wall.position.y = ROOM_HEIGHT / 2;
  group.add(wall);

  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(ROOM_RADIUS + 0.2, 36),
    matte('#171310', { roughness: 0.95 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_HEIGHT;
  group.add(ceiling);

  // rafters
  const rafterMat = woodMaterial(palette.accent, { seed: 5 });
  for (let i = -2; i <= 2; i++) {
    const rafter = new THREE.Mesh(new THREE.BoxGeometry(ROOM_RADIUS * 2 * Math.cos((i * Math.PI) / 12), 0.12, 0.14), rafterMat);
    rafter.position.set(0, ROOM_HEIGHT - 0.15, i * 1.7);
    group.add(rafter);
  }

  // wainscot trim ring
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(ROOM_RADIUS + 0.05, 0.035, 6, 48),
    matte(palette.accent, { roughness: 0.6 })
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 1.0;
  group.add(trim);

  // ---- the round dark-wood table ----
  const table = new THREE.Group();
  const topMat = woodMaterial('#2c1c10', { seed: 17, roughness: 0.55 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS * 0.97, 0.07, 36), topMat);
  top.position.y = TABLE_TOP_Y - 0.035;
  top.castShadow = true;
  top.receiveShadow = true;
  table.add(top);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(TABLE_RADIUS - 0.01, 0.028, 8, 40), matte(palette.accent, { roughness: 0.5 }));
  edge.rotation.x = Math.PI / 2;
  edge.position.y = TABLE_TOP_Y;
  table.add(edge);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, TABLE_TOP_Y - 0.1, 12), topMat);
  column.position.y = (TABLE_TOP_Y - 0.1) / 2;
  column.castShadow = true;
  table.add(column);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.06, 20), topMat);
  foot.position.y = 0.03;
  foot.receiveShadow = true;
  table.add(foot);
  group.add(table);

  // ---- 8 stools ----
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stool = createStool(palette.accent, STOOL_SEAT_H);
    stool.position.set(Math.sin(a) * SEAT_RADIUS, 0, Math.cos(a) * SEAT_RADIUS);
    stool.rotation.y = a;
    group.add(stool);
  }

  // ---- back bar (counter + shelves + bottles + mirror) ----
  const backBar = new THREE.Group();
  backBar.position.set(0, 0, -ROOM_RADIUS + 1.05);
  const counterMat = woodMaterial(palette.accent, { seed: 27, roughness: 0.5 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.05, 0.55), counterMat);
  counter.position.y = 0.525;
  counter.castShadow = true;
  counter.receiveShadow = true;
  backBar.add(counter);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.05, 0.68), woodMaterial('#241a10', { seed: 8 }));
  counterTop.position.y = 1.07;
  backBar.add(counterTop);

  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 1.7),
    new THREE.MeshStandardMaterial({ color: '#3c4a52', metalness: 0.96, roughness: 0.08 })
  );
  mirror.position.set(0, 1.95, -0.88);
  backBar.add(mirror);
  const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.9, 0.05), counterMat);
  mirrorFrame.position.set(0, 1.95, -0.92);
  backBar.add(mirrorFrame);

  // shelves + bottles + under-shelf neon strip
  const bottleCount = propParams.bottleCount;
  const shelfRows = bottleCount > 12 ? 2 : bottleCount > 0 ? 1 : 0;
  for (let row = 0; row < shelfRows; row++) {
    const y = 1.45 + row * 0.42;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.04, 0.3), counterMat);
    shelf.position.set(0, y, -0.72);
    backBar.add(shelf);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(3.9, 0.012, 0.012),
      neonMaterial(palette.neon, 1.6)
    );
    strip.position.set(0, y - 0.03, -0.6);
    backBar.add(strip);
    const inRow = row === shelfRows - 1 ? bottleCount - Math.floor(bottleCount / shelfRows) * row : Math.ceil(bottleCount / shelfRows);
    const n = Math.min(inRow, 12);
    for (let i = 0; i < n; i++) {
      const bottle = createBottle(i + row * 7);
      bottle.position.set(-1.8 + (i / Math.max(n - 1, 1)) * 3.6, y + 0.02, -0.72 + (i % 2) * 0.06);
      bottle.rotation.y = Math.random() * Math.PI;
      backBar.add(bottle);
    }
  }
  // taps on the counter
  for (let i = 0; i < 3; i++) {
    const tap = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.22, 8), matte('#b8b0a0', { metalness: 0.85, roughness: 0.3 }));
    stem.position.y = 0.11;
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), matte(palette.neon, { emissive: palette.neon, emissiveIntensity: 0.5 }));
    handle.position.y = 0.24;
    tap.add(stem, handle);
    tap.position.set(-0.5 + i * 0.5, 1.09, 0.15);
    backBar.add(tap);
  }
  group.add(backBar);

  // ---- main neon sign above the bar ----
  const sign = buildNeonSign(signText, { color: palette.neon, letterHeight: 0.24 });
  sign.position.set(0, 2.62, -ROOM_RADIUS + 0.45);
  group.add(sign);
  // a couple of tiny mood signs
  const moodSign = buildNeonSign('OPEN', { color: '#ff5a7a', letterHeight: 0.13, board: false });
  moodSign.position.set(-4.1, 1.9, 2.6);
  moodSign.rotation.y = Math.PI / 2 - 0.5;
  group.add(moodSign);
  const moodSign2 = buildNeonSign('NO REFUNDS', { color: palette.neon, letterHeight: 0.1, board: false });
  moodSign2.position.set(4.1, 2.0, 1.4);
  moodSign2.rotation.y = -Math.PI / 2 + 0.35;
  group.add(moodSign2);

  // ---- hanging vines ----
  const vineCount = Math.round(propParams.vineDensity * 22);
  const vineMat = matte('#2f5a28', { roughness: 0.95 });
  const leafMat = matte('#3f7a30', { roughness: 0.9 });
  const vines = [];
  for (let i = 0; i < vineCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * (ROOM_RADIUS - 2.8);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const len = 0.7 + Math.random() * 1.6;
    const pts = [];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      pts.push(new THREE.Vector3(Math.sin(t * 2.4 + i) * 0.09 * t, -len * t, Math.cos(t * 3.1 + i) * 0.09 * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const vine = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.014, 5), vineMat);
    const holder = new THREE.Group();
    holder.position.set(x, ROOM_HEIGHT - 0.05, z);
    holder.add(vine);
    for (let l = 0; l < 4; l++) {
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.05, 6), leafMat);
      const p = curve.getPoint(0.25 + (l / 4) * 0.7);
      leaf.position.copy(p);
      leaf.rotation.set(Math.random() * 1.2 - 0.6, Math.random() * Math.PI * 2, 0);
      holder.add(leaf);
    }
    group.add(holder);
    vines.push({ holder, phase: Math.random() * 10, amp: 0.02 + Math.random() * 0.035 });
  }
  updaters.push((dt, elapsed) => {
    for (const v of vines) {
      v.holder.rotation.x = Math.sin(elapsed * 0.7 + v.phase) * v.amp;
      v.holder.rotation.z = Math.cos(elapsed * 0.55 + v.phase * 1.7) * v.amp;
    }
  });

  // ---- ceiling fan (animated) ----
  const fan = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), matte('#1f1a14'));
  rod.position.y = ROOM_HEIGHT - 0.25;
  group.add(rod);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.09, 12), matte('#2a2118', { metalness: 0.5, roughness: 0.4 }));
  fan.add(hub);
  const bladeMat = woodMaterial(palette.accent, { seed: 44 });
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.02, 0.16), bladeMat);
    blade.position.x = 0.55;
    const holder = new THREE.Group();
    holder.rotation.y = (i / 4) * Math.PI * 2;
    holder.rotation.z = -0.08;
    holder.add(blade);
    blade.castShadow = true;
    fan.add(holder);
  }
  fan.position.y = ROOM_HEIGHT - 0.52;
  group.add(fan);
  updaters.push((dt) => {
    fan.rotation.y += propParams.fanSpeed * dt;
  });

  // ---- scattered ambience: hanging glass pendant over the table ----
  const pendant = new THREE.Group();
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6), matte('#14100c'));
  cord.position.y = 0.45;
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 0.2, 14, 1, true),
    matte('#3a2c1a', { roughness: 0.55 })
  );
  shade.position.y = -0.02;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), neonMaterial('#ffca7a', 2.2));
  bulb.position.y = -0.07;
  pendant.add(cord, shade, bulb);
  pendant.position.set(0, 2.55, 0);
  group.add(pendant);
  updaters.push((dt, elapsed) => {
    pendant.rotation.x = Math.sin(elapsed * 0.4) * 0.02;
    pendant.rotation.z = Math.cos(elapsed * 0.33) * 0.02;
  });

  // ---- map-specific extra props ----
  const ctx = { group, palette, propParams };
  for (const id of propParams.extraProps || []) {
    const builder = EXTRA_PROP_BUILDERS[id];
    if (builder) builder(ctx);
  }

  return {
    group,
    mapConfig,
    seatRadius: SEAT_RADIUS,
    tableTopY: TABLE_TOP_Y,
    tableRadius: TABLE_RADIUS,
    stoolSeatH: STOOL_SEAT_H,
    floorY: 0,
    update(dt, elapsed) {
      for (const fn of updaters) fn(dt, elapsed);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      group.removeFromParent();
    },
  };
}
