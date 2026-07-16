#!/usr/bin/env node
// GOOBY app icon + splash generator (§F2, agent G13).
//
// Pure-Node PNG encoder (node:zlib deflate + hand-rolled CRC32 — zero deps)
// plus a tiny signed-distance-field rasterizer that paints a cute vector
// Gooby face: cream circle head, two ear capsules with pink inners, bead
// eyes with shines, pink nose, buck teeth, blush cheeks — on a pastel pink
// (#FF7BA9-family) background for the icon and the cream brand background
// (#FFF6EC) for the splash.
//
// Outputs (committed):
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  (1024²)
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json      (Xcode 16 single-size)
//   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732[-1|-2].png (2732²)
//
// Run: `npm run icons` (from GOOBY/).

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// PNG encoder (pure Node: zlib + CRC32)
// ---------------------------------------------------------------------------

/** CRC32 lookup table (IEEE 802.3 polynomial, as required by the PNG spec). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC32 of a buffer (PNG chunk checksum).
 * @param {Uint8Array} buf
 * @returns {number} unsigned 32-bit CRC
 */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build one PNG chunk: length + type + data + CRC.
 * @param {string} type 4-char chunk type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode an RGBA byte image as a PNG (8-bit, color type 6, filter None).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba `width * height * 4` bytes
 * @returns {Buffer} complete PNG file bytes
 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // bytes 10–12 stay 0: deflate compression, adaptive filter, no interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const pos = y * (stride + 1);
    raw[pos] = 0; // filter: None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), pos + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Tiny SDF rasterizer (anti-aliased painter's-algorithm shapes)
// ---------------------------------------------------------------------------

/** @param {string} hex `#RRGGBB` @returns {[number, number, number]} */
function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** @typedef {{w: number, h: number, data: Uint8Array}} Img */

/** @param {number} w @param {number} h @returns {Img} */
function makeImage(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

/**
 * Alpha-blend `color` at `alpha` over the pixel at (x, y).
 * @param {Img} img @param {number} x @param {number} y
 * @param {[number, number, number]} color @param {number} alpha 0–1
 */
function blend(img, x, y, color, alpha) {
  const i = (y * img.w + x) * 4;
  const d = img.data;
  const ia = 1 - alpha;
  // Round: Uint8Array assignment truncates, and 254.999… must stay 255.
  d[i] = Math.round(color[0] * alpha + d[i] * ia);
  d[i + 1] = Math.round(color[1] * alpha + d[i + 1] * ia);
  d[i + 2] = Math.round(color[2] * alpha + d[i + 2] * ia);
  d[i + 3] = Math.min(255, Math.round(alpha * 255 + d[i + 3] * ia));
}

/**
 * Paint an SDF shape (d ≤ 0 inside) with 1-px anti-aliasing, or a soft
 * feathered falloff when `feather` > 1 (used for glows/gradients).
 * @param {Img} img
 * @param {[number, number, number, number]} bbox [x0, y0, x1, y1] paint bounds
 * @param {(x: number, y: number) => number} sdf distance fn in pixel units
 * @param {[number, number, number]} color
 * @param {number} [alpha] max opacity 0–1
 * @param {number} [feather] falloff width in px
 */
function paint(img, bbox, sdf, color, alpha = 1, feather = 1) {
  const x0 = Math.max(0, Math.floor(bbox[0]));
  const y0 = Math.max(0, Math.floor(bbox[1]));
  const x1 = Math.min(img.w - 1, Math.ceil(bbox[2]));
  const y1 = Math.min(img.h - 1, Math.ceil(bbox[3]));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      let cov = Math.min(1, Math.max(0, 0.5 - d / feather));
      if (cov <= 0) continue;
      if (feather > 1) cov *= cov; // smoother falloff for soft shapes
      blend(img, x, y, color, cov * alpha);
    }
  }
}

/** Circle SDF factory. */
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

/** Axis-aligned ellipse SDF (scaled-distance approximation, fine for AA). */
const ellipse = (cx, cy, rx, ry) => (x, y) => {
  const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return (k - 1) * Math.min(rx, ry);
};

/** Capsule SDF: segment (ax, ay)→(bx, by) with radius r. */
const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};

/** Rounded-rectangle SDF centered (cx, cy), half-size (hx, hy), radius r. */
const roundRect = (cx, cy, hx, hy, r) => (x, y) => {
  const qx = Math.abs(x - cx) - (hx - r);
  const qy = Math.abs(y - cy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Arc (smile) SDF: ring of radius r/thickness t around (cx, cy), lower part only. */
const smileArc = (cx, cy, r, t, clipY) => (x, y) =>
  Math.max(Math.abs(Math.hypot(x - cx, y - cy) - r) - t, clipY - y);

// ---------------------------------------------------------------------------
// Gooby face (palette per PLAN §D2.1 / §D5)
// ---------------------------------------------------------------------------

const BODY = rgb('#F6EAD7'); // cream
const EAR_INNER = rgb('#F6A8B8');
const NOSE = rgb('#E88BA0');
const CHEEK = rgb('#F9C6CF');
const EYE = rgb('#3A2E2E');
const WHITE = rgb('#FFFFFF');
const OUTLINE = rgb('#D8A88E'); // warm soft outline for the vinyl-toy look
const TOOTH_SHADE = rgb('#E3D3C2'); // gap line between the buck teeth

/**
 * Paint the Gooby face (head + ears + face features) onto an image.
 * All measurements are proportional to the head radius R so the same face
 * renders at icon and splash scale.
 * @param {Img} img
 * @param {number} cx head center x (px)
 * @param {number} cy head center y (px)
 * @param {number} R head radius (px)
 */
export function drawGooby(img, cx, cy, R) {
  const o = R * 0.035; // outline width
  const bbox = [cx - 1.2 * R - o, cy - 2.1 * R - o, cx + 1.2 * R + o, cy + 1.1 * R + o];

  // Ear geometry: outer capsules tilt gently outward from the head top.
  const ears = [-1, 1].map((s) => ({
    ax: cx + s * 0.36 * R, ay: cy - 0.55 * R, // base (inside the head)
    bx: cx + s * 0.54 * R, by: cy - 1.68 * R, // tip
    r: 0.30 * R,
    iax: cx + s * 0.395 * R, iay: cy - 0.78 * R,
    ibx: cx + s * 0.525 * R, iby: cy - 1.56 * R,
    ir: 0.165 * R,
  }));

  // 1. Outline silhouette (slightly inflated ears + head in the outline color).
  for (const e of ears) paint(img, bbox, capsule(e.ax, e.ay, e.bx, e.by, e.r + o), OUTLINE);
  paint(img, bbox, circle(cx, cy, R + o), OUTLINE);

  // 2. Ears (cream) + pink inners, then the head over the ear bases.
  for (const e of ears) paint(img, bbox, capsule(e.ax, e.ay, e.bx, e.by, e.r), BODY);
  for (const e of ears) paint(img, bbox, capsule(e.iax, e.iay, e.ibx, e.iby, e.ir), EAR_INNER);
  paint(img, bbox, circle(cx, cy, R), BODY);

  // 3. Blush cheeks (soft ellipses, slightly transparent).
  for (const s of [-1, 1]) {
    paint(img, bbox, ellipse(cx + s * 0.60 * R, cy + 0.20 * R, 0.185 * R, 0.12 * R), CHEEK, 0.9, R * 0.04);
  }

  // 4. Bead eyes + double shines.
  for (const s of [-1, 1]) {
    const ex = cx + s * 0.40 * R;
    const ey = cy - 0.08 * R;
    paint(img, bbox, circle(ex, ey, 0.14 * R), EYE);
    paint(img, bbox, circle(ex + s * -0.045 * R, ey - 0.05 * R, 0.052 * R), WHITE);
    paint(img, bbox, circle(ex + s * 0.055 * R, ey + 0.05 * R, 0.024 * R), WHITE, 0.9);
  }

  // 5. Pink nose + philtrum + gentle smile.
  paint(img, bbox, ellipse(cx, cy + 0.14 * R, 0.115 * R, 0.082 * R), NOSE);
  paint(img, bbox, capsule(cx, cy + 0.18 * R, cx, cy + 0.30 * R, 0.016 * R), OUTLINE, 0.8);
  paint(img, bbox, smileArc(cx, cy + 0.14 * R, 0.19 * R, 0.016 * R, cy + 0.26 * R), OUTLINE, 0.8);

  // 6. Buck teeth (it's a rabbit!): white rounded rect + middle gap line.
  const ty = cy + 0.435 * R;
  paint(img, bbox, roundRect(cx, ty, 0.115 * R, 0.105 * R, 0.045 * R), OUTLINE, 1, 1);
  paint(img, bbox, roundRect(cx, ty - o * 0.45, 0.115 * R - o * 0.8, 0.105 * R - o * 0.55, 0.04 * R), WHITE);
  paint(img, bbox, roundRect(cx, ty - o * 0.45, 0.011 * R, 0.09 * R, 0.008 * R), TOOTH_SHADE, 0.9);
}

/**
 * Render the 1024×1024 app icon: pastel pink radial background + face.
 * @returns {Img}
 */
export function renderIcon(size = 1024) {
  const img = makeImage(size, size);
  const [er, eg, eb] = rgb('#FF7BA9'); // edge (brand pink)
  const [cr, cg, cb] = rgb('#FFB1CB'); // center (lighter pastel)
  const cxg = size * 0.5;
  const cyg = size * 0.42;
  const maxD = Math.hypot(size * 0.62, size * 0.66);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.hypot(x - cxg, y - cyg) / maxD);
      const k = t * t; // ease: keep the center wide and light
      const i = (y * size + x) * 4;
      img.data[i] = cr + (er - cr) * k;
      img.data[i + 1] = cg + (eg - cg) * k;
      img.data[i + 2] = cb + (eb - cb) * k;
      img.data[i + 3] = 255;
    }
  }
  // Soft white glow behind the face so the cream head pops off the pink.
  paint(img, [0, 0, size, size], circle(size * 0.5, size * 0.55, size * 0.34), WHITE, 0.35, size * 0.16);
  drawGooby(img, size * 0.5, size * 0.585, size * 0.275);
  return img;
}

/**
 * Render the 2732×2732 splash: cream background, centered face.
 * @returns {Img}
 */
export function renderSplash(size = 2732) {
  const img = makeImage(size, size);
  const [r, g, b] = rgb('#FFF6EC'); // brand cream (§D5, matches SplashScreen bg)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  // Face group spans cy−2.0R … cy+1.1R → shift cy down so it reads centered.
  const R = size * 0.14;
  drawGooby(img, size * 0.5, size * 0.5 + 0.47 * R, R);
  return img;
}

// ---------------------------------------------------------------------------
// Main: write the asset-catalog files
// ---------------------------------------------------------------------------

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const iconDir = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  const splashDir = join(root, 'ios/App/App/Assets.xcassets/Splash.imageset');
  mkdirSync(iconDir, { recursive: true });
  mkdirSync(splashDir, { recursive: true });

  const icon = renderIcon();
  const iconPng = encodePng(icon.w, icon.h, icon.data);
  writeFileSync(join(iconDir, 'AppIcon-512@2x.png'), iconPng);
  writeFileSync(
    join(iconDir, 'Contents.json'),
    JSON.stringify(
      {
        images: [{ filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
        info: { author: 'xcode', version: 1 },
      },
      null,
      2
    ) + '\n'
  );
  console.log(`icon   1024×1024 → ${iconPng.length.toLocaleString()} B`);

  const splash = renderSplash();
  const splashPng = encodePng(splash.w, splash.h, splash.data);
  // Capacitor's default Splash.imageset references three same-size files
  // (1x/2x/3x); keep that Contents.json shape and write identical PNGs.
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    writeFileSync(join(splashDir, name), splashPng);
  }
  console.log(`splash 2732×2732 → ${splashPng.length.toLocaleString()} B ×3`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
