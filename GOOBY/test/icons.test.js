// PNG encoder sanity (§F2, agent G13): scripts/gen-icons.mjs must emit valid
// PNG bytes — checked structurally (signature, IHDR, IDAT, IEND, CRCs) for a
// tiny 4×4 image so the suite stays fast, plus decode round-trip via zlib.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePng, crc32, renderIcon, renderSplash } from '../scripts/gen-icons.mjs';

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
