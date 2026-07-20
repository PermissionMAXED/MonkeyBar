#!/usr/bin/env node
// GOOBY app icon + splash generator (§F2 agent G13; 4.0 layered look V4/G80).
//
// Pure-Node PNG encoder (node:zlib deflate + hand-rolled CRC32 — zero deps)
// plus a tiny signed-distance-field rasterizer that paints a cute vector
// Gooby face: cream circle head, two ear capsules with pink inners, bead
// eyes with shines, pink nose, buck teeth, blush cheeks — on a pastel pink
// (#FF7BA9-family) background for the icon and the cream brand background
// (#FFF6EC) for the splash.
//
// V4/G80 (PLAN4 §C-SYS10.2/10.3): a minimal pure-Node PNG DECODER (zlib
// inflate, 8-bit colorType 2/6, non-interlaced, all 5 scanline filters) and
// the `--source <png>` bypass — when given the coordinator's layered art the
// procedural face painter is SKIPPED: the source is flattened onto #FFF6EC
// (the App-Store no-alpha rule stays enforced by emitting colorType 2) and
// becomes the 1024² universal icon + the 2732² splash (cream field, source
// centered at 38 % width). iOS-18 dark/tinted variants (§C-SYS10.3) are
// derived deterministically from the universal icon and carry alpha on
// purpose (dark icons NEED a transparent background — only the universal
// 1024 must be opaque); Contents.json gains the `appearances` entries.
//
// §C-SYS10.3 CI fallback (documented): if the CI Xcode ever rejects the
// `appearances` Contents.json syntax (CI runs Xcode 16.4 — appearances are
// supported since Xcode 16.0, so this is not expected), rerun with
// `--no-appearances` to regenerate the legacy single-image Contents.json
// (no variant PNGs written), commit the dark/tinted PNGs as loose files
// under art/ with a note, and the icon test keeps pinning only the
// universal icon.
//
// Outputs (committed):
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png        (1024², colorType 2)
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-dark-512@2x.png   (1024², alpha)
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-tinted-512@2x.png (1024², grayscale)
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json             (Xcode 16 single-size + appearances)
//   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732[-1|-2].png  (2732²)
//
// Run (4.0 documented invocation, from GOOBY/):
//   npm run icons -- --source art/icon-v4-source.png
// Legacy procedural fallback: `npm run icons` (no flags).

import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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
 * Encode an RGBA byte image as a PNG (8-bit, filter None).
 *
 * `colorType` 6 (RGBA, default) keeps the alpha channel; `colorType` 2 emits
 * opaque RGB — required for the App Store icon, which App Store Connect
 * rejects if the PNG carries ANY alpha channel (even a fully-opaque one).
 * For color type 2 every pixel is composited onto `background` first, so
 * semi-transparent input still flattens correctly.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba `width * height * 4` bytes
 * @param {{colorType?: 2|6, background?: [number, number, number]}} [opts]
 * @returns {Buffer} complete PNG file bytes
 */
export function encodePng(width, height, rgba, { colorType = 6, background = [255, 246, 236] } = {}) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`encodePng: unsupported color type ${colorType} (only 6=RGBA, 2=RGB)`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType; // 6 = RGBA, 2 = RGB (no alpha channel)
  // bytes 10–12 stay 0: deflate compression, adaptive filter, no interlace
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const pos = y * (stride + 1);
    raw[pos] = 0; // filter: None
    if (colorType === 6) {
      raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), pos + 1);
    } else {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4;
        const a = rgba[s + 3] / 255;
        const ia = 1 - a;
        const d = pos + 1 + x * 3;
        raw[d] = Math.round(rgba[s] * a + background[0] * ia);
        raw[d + 1] = Math.round(rgba[s + 1] * a + background[1] * ia);
        raw[d + 2] = Math.round(rgba[s + 2] * a + background[2] * ia);
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// PNG decoder (V4/G80, §C-SYS10.2 — pure Node: zlib inflate + de-filtering)
// ---------------------------------------------------------------------------

/**
 * Paeth predictor (PNG spec §9, filter type 4).
 * @param {number} a left @param {number} b above @param {number} c upper-left
 * @returns {number}
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode a PNG into RGBA pixels. Minimal BY DESIGN (§C-SYS10.2): 8-bit
 * colorType 2 (RGB) or 6 (RGBA), non-interlaced, all 5 scanline filters,
 * multiple IDAT chunks, CRC-verified; ancillary chunks are skipped.
 * Anything else throws (interlaced, paletted, 16-bit, grayscale).
 * @param {Buffer|Uint8Array} bytes complete PNG file
 * @returns {Img} RGBA image (colorType-2 input gets alpha = 255)
 */
export function decodePng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('decodePng: bad PNG signature');
  }
  let width = 0;
  let height = 0;
  let colorType = 0;
  let sawIhdr = false;
  const idats = [];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) {
      throw new Error(`decodePng: CRC mismatch in ${type} chunk`);
    }
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error(`decodePng: unsupported bit depth ${bitDepth} (only 8)`);
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`decodePng: unsupported color type ${colorType} (only 2=RGB, 6=RGBA)`);
      }
      if (data[10] !== 0 || data[11] !== 0) throw new Error('decodePng: unsupported compression/filter method');
      if (data[12] !== 0) throw new Error('decodePng: interlaced PNGs are unsupported');
      sawIhdr = true;
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    // ancillary chunks (pHYs, tEXt, iCCP, …) are skipped
    pos += 12 + len;
  }
  if (!sawIhdr || idats.length === 0) throw new Error('decodePng: missing IHDR/IDAT');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idats));
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`decodePng: expected ${(stride + 1) * height} filtered bytes, got ${raw.length}`);
  }
  // De-filter (PNG spec §9: predictors read the RECONSTRUCTED row above).
  const pix = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rs = y * (stride + 1) + 1;
    const os = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rs + x];
      const left = x >= channels ? pix[os + x - channels] : 0;
      const up = y > 0 ? pix[os - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pix[os - stride + x - channels] : 0;
      let rec;
      if (filter === 0) rec = v;
      else if (filter === 1) rec = v + left;
      else if (filter === 2) rec = v + up;
      else if (filter === 3) rec = v + ((left + up) >> 1);
      else if (filter === 4) rec = v + paeth(left, up, upLeft);
      else throw new Error(`decodePng: unknown filter ${filter} on row ${y}`);
      pix[os + x] = rec & 0xff;
    }
  }
  const img = makeImage(width, height);
  if (colorType === 6) {
    img.data.set(pix);
  } else {
    for (let i = 0, s = 0; s < pix.length; i += 4, s += 3) {
      img.data[i] = pix[s];
      img.data[i + 1] = pix[s + 1];
      img.data[i + 2] = pix[s + 2];
      img.data[i + 3] = 255;
    }
  }
  return img;
}

/**
 * Flatten an RGBA image onto an opaque background — kills ANY alpha, which
 * is how the §C-SYS10.2 App-Store no-alpha rule stays enforced regardless of
 * what the coordinator's art carries.
 * @param {Img} img
 * @param {[number, number, number]} background
 * @returns {Img} fully opaque copy
 */
export function flattenRgba(img, background) {
  const out = makeImage(img.w, img.h);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    const ia = 1 - a;
    out.data[i] = Math.round(img.data[i] * a + background[0] * ia);
    out.data[i + 1] = Math.round(img.data[i + 1] * a + background[1] * ia);
    out.data[i + 2] = Math.round(img.data[i + 2] * a + background[2] * ia);
    out.data[i + 3] = 255;
  }
  return out;
}

/**
 * Bilinear-resample an RGBA image to w×h. Pure deterministic math — keeps
 * `npm run icons -- --source …` byte-stable across re-runs (§C-SYS10.2).
 * Scales used here stay near 1 (0.88×–1.02×), where bilinear is clean.
 * @param {Img} img @param {number} w @param {number} h
 * @returns {Img}
 */
export function resample(img, w, h) {
  if (img.w === w && img.h === h) return img;
  const out = makeImage(w, h);
  const sx = img.w / w;
  const sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.w - 1, x0 + 1);
      const tx = fx - x0;
      const d = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * img.w + x0) * 4 + c];
        const p10 = img.data[(y0 * img.w + x1) * 4 + c];
        const p01 = img.data[(y1 * img.w + x0) * 4 + c];
        const p11 = img.data[(y1 * img.w + x1) * 4 + c];
        out.data[d + c] = Math.round(
          p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty) + p01 * (1 - tx) * ty + p11 * tx * ty
        );
      }
    }
  }
  return out;
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
// 4.0 source pipeline (V4/G80, §C-SYS10.2/10.3)
// ---------------------------------------------------------------------------

/** Frozen 4.0 icon-pipeline numbers (§E0.1-2 pattern: consts live in the owning module). */
export const V4_ICON = Object.freeze({
  SIZE: 1024, // universal icon (§C-SYS10.2)
  SPLASH_SIZE: 2732, // existing splash dimension
  SPLASH_ART_FRAC: 0.38, // source image centered at 38 % width (§C-SYS10.2)
  BG: '#FFF6EC', // brand cream flatten target (§C-SYS10.2)
  // The coordinator art bakes a rounded-rect card into the square canvas —
  // measured corner radius ≈ 242 px at 1024² (corner-diagonal scan). The dark
  // variant cuts the near-cream area OUTSIDE that card to transparency, per
  // Apple's "transparent background so the system background shows through".
  DARK_CARD_RADIUS_FRAC: 242 / 1024,
  DARK_DIM: 0.85, // dark-variant RGB multiplier (softens glare on dark home screens)
});

/**
 * Build the 1024² universal icon from decoded source art: flatten onto the
 * brand cream (kills any alpha) and resample to 1024² if needed.
 * @param {Img} src decoded coordinator art
 * @returns {Img} opaque 1024² icon
 */
export function renderIconFromSource(src) {
  return resample(flattenRgba(src, rgb(V4_ICON.BG)), V4_ICON.SIZE, V4_ICON.SIZE);
}

/**
 * Build the 2732² splash from decoded source art: cream #FFF6EC field with
 * the source image centered at 38 % width (§C-SYS10.2).
 * @param {Img} src decoded coordinator art
 * @param {number} [size]
 * @returns {Img} opaque splash
 */
export function renderSplashFromSource(src, size = V4_ICON.SPLASH_SIZE) {
  const img = makeImage(size, size);
  const [r, g, b] = rgb(V4_ICON.BG);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  const artSize = Math.round(size * V4_ICON.SPLASH_ART_FRAC);
  const art = resample(flattenRgba(src, rgb(V4_ICON.BG)), artSize, artSize);
  const off = Math.round((size - artSize) / 2);
  for (let y = 0; y < artSize; y++) {
    const srcRow = art.data.subarray(y * artSize * 4, (y + 1) * artSize * 4);
    img.data.set(srcRow, ((off + y) * size + off) * 4);
  }
  return img;
}

/**
 * iOS-18 DARK icon variant (§C-SYS10.3): same artwork gently dimmed, with the
 * near-cream canvas outside the art's baked rounded-rect card cut to
 * transparency (anti-aliased) — dark icons REQUIRE a transparent background
 * (the deliberate exception to the no-alpha rule; only the universal 1024
 * must be opaque).
 * @param {Img} icon opaque universal icon
 * @returns {Img} RGBA variant (carries alpha)
 */
export function deriveDarkVariant(icon) {
  const out = makeImage(icon.w, icon.h);
  const half = icon.w / 2;
  const radius = icon.w * V4_ICON.DARK_CARD_RADIUS_FRAC;
  const sdf = roundRect(half, half, half, half, radius);
  for (let y = 0; y < icon.h; y++) {
    for (let x = 0; x < icon.w; x++) {
      const i = (y * icon.w + x) * 4;
      out.data[i] = Math.round(icon.data[i] * V4_ICON.DARK_DIM);
      out.data[i + 1] = Math.round(icon.data[i + 1] * V4_ICON.DARK_DIM);
      out.data[i + 2] = Math.round(icon.data[i + 2] * V4_ICON.DARK_DIM);
      const cov = Math.min(1, Math.max(0, 0.5 - sdf(x + 0.5, y + 0.5)));
      out.data[i + 3] = Math.round(cov * 255);
    }
  }
  return out;
}

/**
 * iOS-18 TINTED icon variant (§C-SYS10.3): fully opaque grayscale (Rec. 709
 * luma) — the system multiplies the user's tint gradient over it.
 * @param {Img} icon opaque universal icon
 * @returns {Img} grayscale opaque variant
 */
export function deriveTintedVariant(icon) {
  const out = makeImage(icon.w, icon.h);
  for (let i = 0; i < icon.data.length; i += 4) {
    const l = Math.round(0.2126 * icon.data[i] + 0.7152 * icon.data[i + 1] + 0.0722 * icon.data[i + 2]);
    out.data[i] = l;
    out.data[i + 1] = l;
    out.data[i + 2] = l;
    out.data[i + 3] = 255;
  }
  return out;
}

/**
 * AppIcon.appiconset Contents.json (Xcode 16 single-size). With
 * `appearances` (the shipped §C-SYS10.3 state) the dark/tinted luminosity
 * entries are included; without (the documented CI fallback) only the
 * universal image is referenced.
 * @param {boolean} appearances
 * @returns {string} JSON text
 */
export function iconContentsJson(appearances) {
  const images = [
    { filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
  ];
  if (appearances) {
    images.push(
      {
        appearances: [{ appearance: 'luminosity', value: 'dark' }],
        filename: 'AppIcon-dark-512@2x.png',
        idiom: 'universal',
        platform: 'ios',
        size: '1024x1024',
      },
      {
        appearances: [{ appearance: 'luminosity', value: 'tinted' }],
        filename: 'AppIcon-tinted-512@2x.png',
        idiom: 'universal',
        platform: 'ios',
        size: '1024x1024',
      }
    );
  }
  return JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Main: write the asset-catalog files
// ---------------------------------------------------------------------------

/**
 * Parse CLI flags: `--source <png>` (§C-SYS10.2 bypass) and
 * `--no-appearances` (§C-SYS10.3 documented CI fallback).
 * @param {string[]} argv
 * @returns {{source: string|null, appearances: boolean}}
 */
function parseArgs(argv) {
  let source = null;
  let appearances = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') {
      source = argv[i + 1];
      if (!source) throw new Error('gen-icons: --source needs a PNG path');
      i++;
    } else if (argv[i] === '--no-appearances') {
      appearances = false;
    } else {
      throw new Error(`gen-icons: unknown argument ${argv[i]}`);
    }
  }
  return { source, appearances };
}

function main() {
  const { source, appearances } = parseArgs(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const iconDir = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  const splashDir = join(root, 'ios/App/App/Assets.xcassets/Splash.imageset');
  mkdirSync(iconDir, { recursive: true });
  mkdirSync(splashDir, { recursive: true });

  // §C-SYS10.2 bypass: with --source the procedural face painter is skipped
  // and the decoded art drives both the icon and the splash.
  let icon;
  let splash;
  if (source) {
    const src = decodePng(readFileSync(resolve(process.cwd(), source)));
    console.log(`source ${source} (${src.w}×${src.h}) → layered-art bypass`);
    icon = renderIconFromSource(src);
    splash = renderSplashFromSource(src);
  } else {
    icon = renderIcon();
    splash = renderSplash();
  }

  // App Store Connect rejects the 1024² marketing icon if the PNG has an
  // alpha channel → encode as opaque RGB (color type 2), flattened onto the
  // brand cream just in case any pixel were ever non-opaque.
  const iconPng = encodePng(icon.w, icon.h, icon.data, { colorType: 2, background: rgb(V4_ICON.BG) });
  writeFileSync(join(iconDir, 'AppIcon-512@2x.png'), iconPng);
  console.log(`icon   1024×1024 → ${iconPng.length.toLocaleString()} B`);

  if (appearances) {
    // §C-SYS10.3: dark carries alpha (required by iOS dark icons), tinted is
    // opaque grayscale. Both derive deterministically from the universal icon.
    const dark = deriveDarkVariant(icon);
    const darkPng = encodePng(dark.w, dark.h, dark.data, { colorType: 6 });
    writeFileSync(join(iconDir, 'AppIcon-dark-512@2x.png'), darkPng);
    console.log(`dark   1024×1024 → ${darkPng.length.toLocaleString()} B`);
    const tinted = deriveTintedVariant(icon);
    const tintedPng = encodePng(tinted.w, tinted.h, tinted.data, { colorType: 2 });
    writeFileSync(join(iconDir, 'AppIcon-tinted-512@2x.png'), tintedPng);
    console.log(`tinted 1024×1024 → ${tintedPng.length.toLocaleString()} B`);
  }
  writeFileSync(join(iconDir, 'Contents.json'), iconContentsJson(appearances));

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
