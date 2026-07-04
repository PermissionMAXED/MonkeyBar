import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, shuffle } from '../src/rng.js';

test('mulberry32: same seed → same sequence', () => {
  const a = mulberry32(1234);
  const b = mulberry32(1234);
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b(), `diverged at draw ${i}`);
  }
});

test('mulberry32: different seeds → different sequences', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test('mulberry32: outputs stay in [0, 1)', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('shuffle: deterministic with a seeded rng', () => {
  const input = Array.from({ length: 20 }, (_, i) => i);
  const s1 = shuffle(input, mulberry32(99));
  const s2 = shuffle(input, mulberry32(99));
  assert.deepEqual(s1, s2);
});

test('shuffle: pure — returns a new array, input untouched, same elements', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const before = input.slice();
  const out = shuffle(input, mulberry32(7));
  assert.notEqual(out, input);
  assert.deepEqual(input, before);
  assert.deepEqual(out.slice().sort((x, y) => x - y), before);
});

test('shuffle: actually permutes (seeded order differs from input)', () => {
  const input = Array.from({ length: 30 }, (_, i) => i);
  const out = shuffle(input, mulberry32(5));
  assert.notDeepEqual(out, input);
});
