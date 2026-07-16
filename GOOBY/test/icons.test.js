// PNG encoder sanity (§F2, agent G13): scripts/gen-icons.mjs must emit valid
// PNG bytes — checked structurally (signature, IHDR, IDAT, IEND, CRCs) for a
// tiny 4×4 image so the suite stays fast, plus decode round-trip via zlib.
// Also validates the COMMITTED App Store icon has no alpha channel (F5 fix:
// App Store Connect rejects 1024² marketing icons carrying an alpha channel).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { encodePng, crc32, renderIcon, renderSplash } from '../scripts/gen-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ICON_PATH = join(
  ROOT,
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
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

test('committed AppIcon PNG: 1024², color type 2 (no alpha channel), no tRNS', () => {
  // App Store Connect rejects the marketing icon if the PNG has ANY alpha
  // channel — the committed asset must stay opaque RGB (`npm run icons`).
  const png = readFileSync(APP_ICON_PATH);
  const all = chunks(png);
  assert.equal(all[0].type, 'IHDR');
  assert.equal(all[0].data.readUInt32BE(0), 1024, 'width');
  assert.equal(all[0].data.readUInt32BE(4), 1024, 'height');
  assert.equal(all[0].data[9], 2, 'AppIcon color type must be 2 (RGB, no alpha)');
  assert.ok(!all.some((c) => c.type === 'tRNS'), 'AppIcon must not carry a tRNS chunk');
});
