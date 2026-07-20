// PNG encoder sanity (§F2, agent G13): scripts/gen-icons.mjs must emit valid
// PNG bytes — checked structurally (signature, IHDR, IDAT, IEND, CRCs) for a
// tiny 4×4 image so the suite stays fast, plus decode round-trip via zlib.
// Also validates the COMMITTED App Store icon has no alpha channel (F5 fix:
// App Store Connect rejects 1024² marketing icons carrying an alpha channel).
//
// V4/G80 (PLAN4 §C-SYS10.2): decoder + `--source` bypass coverage — the
// committed universal icon must exist as 1024² colorType 2, the splash stays
// 2732², and the source pipeline (decode → flatten #FFF6EC → encode) is
// byte-stable on re-run. §C-SYS10.3 pins only the universal icon (the
// dark/tinted appearance variants may ship or fall back without breaking CI).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
  encodePng,
  crc32,
  renderIcon,
  renderSplash,
  decodePng,
  flattenRgba,
  resample,
  renderIconFromSource,
  renderSplashFromSource,
  deriveDarkVariant,
  deriveTintedVariant,
  iconContentsJson,
  V4_ICON,
} from '../scripts/gen-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ICON_PATH = join(
  ROOT,
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
);
const ICON_SOURCE_PATH = join(ROOT, 'art/icon-v4-source.png');
const SPLASH_PATH = join(
  ROOT,
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png'
);

/** Build a 4×4 RGBA test pattern (opaque, distinct pixel values). */
function testRgba() {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    rgba[i * 4] = i * 16; // R
    rgba[i * 4 + 1] = 255 - i * 16; // G
    rgba[i * 4 + 2] = (i * 37) % 256; // B
    rgba[i * 4 + 3] = 255; // A
  }
  return rgba;
}

/**
 * Parse PNG chunks: [{type, data, crcOk}].
 * @param {Buffer} png
 */
function chunks(png) {
  const out = [];
  let pos = 8;
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    const crc = png.readUInt32BE(pos + 8 + len);
    const crcOk = crc === crc32(png.subarray(pos + 4, pos + 8 + len));
    out.push({ type, data, crcOk });
    pos += 12 + len;
  }
  return out;
}

test('encodePng: valid PNG signature for a 4×4 image', () => {
  const png = encodePng(4, 4, testRgba());
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.deepEqual([...png.subarray(0, 8)], sig);
});

test('encodePng: IHDR is first, correct dims/bit-depth/color-type', () => {
  const png = encodePng(4, 4, testRgba());
  const all = chunks(png);
  assert.equal(all[0].type, 'IHDR');
  assert.equal(all[0].data.length, 13);
  assert.equal(all[0].data.readUInt32BE(0), 4); // width
  assert.equal(all[0].data.readUInt32BE(4), 4); // height
  assert.equal(all[0].data[8], 8); // bit depth
  assert.equal(all[0].data[9], 6); // color type RGBA
  assert.equal(all[0].data[10], 0); // compression
  assert.equal(all[0].data[11], 0); // filter method
  assert.equal(all[0].data[12], 0); // no interlace
});

test('encodePng: has IDAT and ends with empty IEND', () => {
  const png = encodePng(4, 4, testRgba());
  const all = chunks(png);
  assert.ok(all.some((c) => c.type === 'IDAT'));
  const last = all[all.length - 1];
  assert.equal(last.type, 'IEND');
  assert.equal(last.data.length, 0);
});

test('encodePng: every chunk CRC32 checks out', () => {
  const png = encodePng(4, 4, testRgba());
  for (const c of chunks(png)) assert.ok(c.crcOk, `${c.type} CRC mismatch`);
});

test('encodePng: IDAT inflates back to the exact scanlines', () => {
  const rgba = testRgba();
  const png = encodePng(4, 4, rgba);
  const idat = chunks(png).find((c) => c.type === 'IDAT');
  const raw = inflateSync(idat.data);
  assert.equal(raw.length, (4 * 4 + 1) * 4); // (stride + filter byte) × height
  for (let y = 0; y < 4; y++) {
    assert.equal(raw[y * 17], 0, `row ${y} filter byte`);
    assert.deepEqual(
      [...raw.subarray(y * 17 + 1, y * 17 + 17)],
      [...rgba.subarray(y * 16, y * 16 + 16)],
      `row ${y} pixels`
    );
  }
});

test('encodePng: rejects wrong-length pixel buffers', () => {
  assert.throws(() => encodePng(4, 4, new Uint8Array(3)));
});

test('crc32: known vector ("123456789" → 0xCBF43926)', () => {
  assert.equal(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926);
});

test('renderIcon/renderSplash: produce correctly sized opaque images', () => {
  const icon = renderIcon(32); // small size keeps the suite fast
  assert.equal(icon.w, 32);
  assert.equal(icon.h, 32);
  assert.equal(icon.data.length, 32 * 32 * 4);
  const splash = renderSplash(32);
  assert.equal(splash.data.length, 32 * 32 * 4);
  for (let i = 3; i < icon.data.length; i += 4) assert.equal(icon.data[i], 255);
});

test('encodePng colorType 2: RGB IHDR, no alpha, 3-byte scanline round-trip', () => {
  const rgba = testRgba();
  const png = encodePng(4, 4, rgba, { colorType: 2 });
  const all = chunks(png);
  assert.equal(all[0].type, 'IHDR');
  assert.equal(all[0].data[9], 2, 'color type must be 2 (truecolor, no alpha)');
  for (const c of all) assert.ok(c.crcOk, `${c.type} CRC mismatch`);
  assert.ok(!all.some((c) => c.type === 'tRNS'), 'must not carry transparency');
  const raw = inflateSync(all.find((c) => c.type === 'IDAT').data);
  assert.equal(raw.length, (4 * 3 + 1) * 4); // (stride + filter byte) × height
  for (let y = 0; y < 4; y++) {
    assert.equal(raw[y * 13], 0, `row ${y} filter byte`);
    for (let x = 0; x < 4; x++) {
      // input is fully opaque → RGB must pass through unchanged
      for (let ch = 0; ch < 3; ch++) {
        assert.equal(raw[y * 13 + 1 + x * 3 + ch], rgba[(y * 4 + x) * 4 + ch], `px ${x},${y} ch ${ch}`);
      }
    }
  }
});

test('encodePng colorType 2: semi-transparent pixels composite onto background', () => {
  // one pixel, 50% white over a black background → mid grey
  const rgba = new Uint8Array([255, 255, 255, 128]);
  const png = encodePng(1, 1, rgba, { colorType: 2, background: [0, 0, 0] });
  const raw = inflateSync(chunks(png).find((c) => c.type === 'IDAT').data);
  const expected = Math.round((255 * 128) / 255);
  assert.deepEqual([...raw.subarray(1, 4)], [expected, expected, expected]);
});

test('encodePng: rejects unsupported color types', () => {
  assert.throws(() => encodePng(1, 1, new Uint8Array(4), { colorType: 3 }));
});

test('committed AppIcon PNG: exists, 1024², color type 2 (no alpha channel), no tRNS', () => {
  // App Store Connect rejects the marketing icon if the PNG has ANY alpha
  // channel — the committed asset must stay opaque RGB
  // (`npm run icons -- --source art/icon-v4-source.png`, §C-SYS10.2).
  assert.ok(existsSync(APP_ICON_PATH), 'AppIcon-512@2x.png must be committed');
  const png = readFileSync(APP_ICON_PATH);
  const all = chunks(png);
  assert.equal(all[0].type, 'IHDR');
  assert.equal(all[0].data.readUInt32BE(0), 1024, 'width');
  assert.equal(all[0].data.readUInt32BE(4), 1024, 'height');
  assert.equal(all[0].data[9], 2, 'AppIcon color type must be 2 (RGB, no alpha)');
  assert.ok(!all.some((c) => c.type === 'tRNS'), 'AppIcon must not carry a tRNS chunk');
});

// ---------------------------------------------------------------------------
// V4/G80 — §C-SYS10.2 decoder + --source bypass
// ---------------------------------------------------------------------------

test('decodePng: round-trips an encodePng colorType 6 image exactly', () => {
  const rgba = testRgba();
  const img = decodePng(encodePng(4, 4, rgba));
  assert.equal(img.w, 4);
  assert.equal(img.h, 4);
  assert.deepEqual([...img.data], [...rgba]);
});

test('decodePng: round-trips a colorType 2 image (alpha reconstituted as 255)', () => {
  const rgba = testRgba();
  const img = decodePng(encodePng(4, 4, rgba, { colorType: 2 }));
  for (let i = 0; i < 16; i++) {
    for (let ch = 0; ch < 3; ch++) {
      assert.equal(img.data[i * 4 + ch], rgba[i * 4 + ch], `px ${i} ch ${ch}`);
    }
    assert.equal(img.data[i * 4 + 3], 255, `px ${i} alpha`);
  }
});

test('decodePng: handles all 5 scanline filters (real-world encoder output)', () => {
  // The committed coordinator art uses filters 1–4 (adaptive libpng output);
  // decode it and verify plausible opaque pixels come back.
  const img = decodePng(readFileSync(ICON_SOURCE_PATH));
  assert.equal(img.w, 1024);
  assert.equal(img.h, 1024);
  for (let i = 3; i < img.data.length; i += 4 * 4097) {
    assert.equal(img.data[i], 255, `alpha at byte ${i}`);
  }
});

test('decodePng: rejects bad signature, unsupported color types and interlace', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /signature/);
  // paletted (colorType 3) header
  const png = encodePng(4, 4, testRgba());
  const paletted = Buffer.from(png);
  paletted[8 + 8 + 9] = 3; // IHDR color type byte
  assert.throws(() => decodePng(paletted), /CRC|color type/);
  const interlaced = Buffer.from(png);
  interlaced[8 + 8 + 12] = 1; // IHDR interlace byte
  assert.throws(() => decodePng(interlaced), /CRC|interlace/);
});

test('flattenRgba: kills alpha onto the background', () => {
  const img = { w: 1, h: 1, data: new Uint8Array([255, 255, 255, 128]) };
  const flat = flattenRgba(img, [0, 0, 0]);
  const expected = Math.round((255 * 128) / 255);
  assert.deepEqual([...flat.data], [expected, expected, expected, 255]);
});

test('resample: identity at same size, correct dims + determinism when scaling', () => {
  const img = decodePng(encodePng(4, 4, testRgba()));
  assert.equal(resample(img, 4, 4), img, 'same-size must be a no-op');
  const up = resample(img, 8, 8);
  assert.equal(up.w, 8);
  assert.equal(up.data.length, 8 * 8 * 4);
  const up2 = resample(img, 8, 8);
  assert.deepEqual([...up.data], [...up2.data], 'resample must be deterministic');
});

test('renderIconFromSource: 1024² opaque icon from the committed art', () => {
  const src = decodePng(readFileSync(ICON_SOURCE_PATH));
  const icon = renderIconFromSource(src);
  assert.equal(icon.w, V4_ICON.SIZE);
  assert.equal(icon.h, V4_ICON.SIZE);
  for (let i = 3; i < icon.data.length; i += 4 * 3001) assert.equal(icon.data[i], 255);
});

test('renderSplashFromSource: 2732² cream field, art centered at 38 % width', () => {
  const src = decodePng(readFileSync(ICON_SOURCE_PATH));
  const splash = renderSplashFromSource(src, 512); // small size keeps the suite fast
  assert.equal(splash.w, 512);
  const [br, bg, bb] = [255, 246, 236]; // #FFF6EC
  const px = (x, y) => splash.data.subarray((y * 512 + x) * 4, (y * 512 + x) * 4 + 4);
  // corners = untouched cream field
  assert.deepEqual([...px(0, 0)], [br, bg, bb, 255]);
  assert.deepEqual([...px(511, 511)], [br, bg, bb, 255]);
  // art box: round(512 × 0.38) = 195 px, centered → x ∈ [159, 353]
  const artSize = Math.round(512 * V4_ICON.SPLASH_ART_FRAC);
  const off = Math.round((512 - artSize) / 2);
  assert.equal(artSize, 195);
  // 1 px inside the top-left of the art box must equal the resampled art px
  const art = resample(flattenRgba(src, [br, bg, bb]), artSize, artSize);
  assert.deepEqual([...px(off, off)], [...art.data.subarray(0, 4)]);
});

test('--source pipeline: icon + splash encodes are byte-stable on re-run', () => {
  const src = decodePng(readFileSync(ICON_SOURCE_PATH));
  const a = encodePng(1024, 1024, renderIconFromSource(src).data, { colorType: 2 });
  const b = encodePng(1024, 1024, renderIconFromSource(src).data, { colorType: 2 });
  assert.ok(a.equals(b), 'icon bytes must be identical across runs');
  const sa = renderSplashFromSource(src, 256);
  const sb = renderSplashFromSource(src, 256);
  assert.deepEqual([...sa.data], [...sb.data], 'splash pixels must be identical across runs');
});

test('committed icon matches the --source pipeline output byte-for-byte', () => {
  // The committed asset must be exactly what
  // `npm run icons -- --source art/icon-v4-source.png` regenerates.
  const src = decodePng(readFileSync(ICON_SOURCE_PATH));
  const icon = renderIconFromSource(src);
  const png = encodePng(icon.w, icon.h, icon.data, { colorType: 2, background: [255, 246, 236] });
  assert.ok(png.equals(readFileSync(APP_ICON_PATH)), 'committed AppIcon must be byte-stable vs the pipeline');
});

test('committed splash PNG: 2732², opaque colorType 6, cream corners', () => {
  const png = readFileSync(SPLASH_PATH);
  const all = chunks(png);
  assert.equal(all[0].data.readUInt32BE(0), 2732, 'width');
  assert.equal(all[0].data.readUInt32BE(4), 2732, 'height');
  const img = decodePng(png);
  assert.deepEqual([...img.data.subarray(0, 4)], [255, 246, 236, 255], '#FFF6EC corner');
});

test('dark/tinted variants: dark carries alpha, tinted is opaque grayscale', () => {
  // §C-SYS10.3 — variant derivation stays deterministic; the test does NOT
  // pin the committed variant files (fallback may ship them as loose PNGs).
  const src = decodePng(readFileSync(ICON_SOURCE_PATH));
  const icon = resample(flattenRgba(src, [255, 246, 236]), 128, 128);
  const dark = deriveDarkVariant(icon);
  assert.equal(dark.data[3], 0, 'dark corner must be transparent (outside the card)');
  assert.equal(dark.data[(64 * 128 + 64) * 4 + 3], 255, 'dark center must be opaque');
  const tinted = deriveTintedVariant(icon);
  for (let i = 0; i < tinted.data.length; i += 4 * 97) {
    assert.equal(tinted.data[i], tinted.data[i + 1], 'R=G');
    assert.equal(tinted.data[i + 1], tinted.data[i + 2], 'G=B');
    assert.equal(tinted.data[i + 3], 255, 'opaque');
  }
});

test('iconContentsJson: appearances entries present (shipped) / absent (fallback)', () => {
  const shipped = JSON.parse(iconContentsJson(true));
  assert.equal(shipped.images.length, 3);
  assert.equal(shipped.images[1].appearances[0].value, 'dark');
  assert.equal(shipped.images[2].appearances[0].value, 'tinted');
  const fallback = JSON.parse(iconContentsJson(false));
  assert.equal(fallback.images.length, 1);
  assert.equal(fallback.images[0].filename, 'AppIcon-512@2x.png');
});
