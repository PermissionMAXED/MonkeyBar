// Weather engine (§B4/§C11) vs the binding numbers: committed hash32 recipe
// (fixed vectors), 55/25/20 distribution, 6-hour block boundary math,
// deterministic shared states, forecast rollover.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEATHER,
  hash32,
  blockOf,
  stateFor,
  weatherAt,
  forecast,
} from '../src/systems/weather.js';

/** Epoch ms for a LOCAL wall-clock time. */
function at(year, month, day, h = 0, m = 0, s = 0, ms = 0) {
  return new Date(year, month, day, h, m, s, ms).getTime();
}

// ------------------------------------------------------------------- consts

test('WEATHER consts are the §C11.1 numbers and frozen', () => {
  assert.equal(WEATHER.BLOCK_HOURS, 6);
  assert.equal(WEATHER.BLOCKS_PER_DAY, 4);
  assert.equal(WEATHER.P_CLEAR, 0.55);
  assert.equal(WEATHER.P_CLOUDY, 0.25);
  assert.equal(WEATHER.P_RAIN, 0.2);
  assert.ok(Math.abs(WEATHER.P_CLEAR + WEATHER.P_CLOUDY + WEATHER.P_RAIN - 1) < 1e-12);
  assert.deepEqual([...WEATHER.STATES], ['clear', 'cloudy', 'rain']);
  assert.ok(Object.isFrozen(WEATHER));
});

// ------------------------------------------------- hash32 (committed recipe)

test('hash32 fixed vectors — the recipe is locked API (§B4)', () => {
  // Recomputing these on any device/build must give bit-identical doubles
  // (uint32 / 2^32 is exact in float64) — friends' Goobys share weather.
  assert.equal(hash32('2026-07-17:0'), 0.7195825523231179);
  assert.equal(hash32('2026-07-17:1'), 0.679878152674064);
  assert.equal(hash32('2026-07-17:2'), 0.028563632629811764);
  assert.equal(hash32('2026-07-17:3'), 0.2928446682635695);
  assert.equal(hash32('2026-07-18:2'), 0.8280355513561517);
  assert.equal(hash32('gooby'), 0.783390544122085);
  assert.equal(hash32(''), 0.038885081419721246);
});

test('hash32 returns values in [0, 1) and is deterministic', () => {
  for (let i = 0; i < 1000; i++) {
    const v = hash32(`probe:${i}`);
    assert.ok(v >= 0 && v < 1, `hash32('probe:${i}') = ${v}`);
    assert.equal(v, hash32(`probe:${i}`));
  }
});

// --------------------------------------------- fixed-vector weather states

test('weatherAt fixed vectors for 2026-07-17 (all four blocks locked)', () => {
  // hash rolls: 0.7196 / 0.6799 / 0.0286 / 0.2928 → cloudy cloudy clear clear
  assert.equal(weatherAt(at(2026, 6, 17, 3, 0)).state, 'cloudy'); // block 0
  assert.equal(weatherAt(at(2026, 6, 17, 9, 0)).state, 'cloudy'); // block 1
  assert.equal(weatherAt(at(2026, 6, 17, 13, 30)).state, 'clear'); // block 2 (§C11.4 example)
  assert.equal(weatherAt(at(2026, 6, 17, 21, 0)).state, 'clear'); // block 3
});

test('weatherAt fixed rain vectors (roll ≥ 0.80)', () => {
  assert.equal(weatherAt(at(2026, 6, 18, 12, 0)).state, 'rain'); // 0.8280
  assert.equal(weatherAt(at(2026, 6, 21, 14, 45)).state, 'rain'); // 0.9980
});

test('stateFor pick thresholds are exact: <0.55 clear, <0.80 cloudy, else rain', () => {
  // Derived from the locked hash vectors above rather than mocking the hash.
  assert.equal(stateFor('2026-07-17', 2), 'clear'); // 0.0286 < 0.55
  assert.equal(stateFor('2026-07-17', 0), 'cloudy'); // 0.55 ≤ 0.7196 < 0.80
  assert.equal(stateFor('2026-07-18', 2), 'rain'); // 0.8280 ≥ 0.80
});

test('same block ⇒ same state and same start/end (deterministic, shared)', () => {
  const a = weatherAt(at(2026, 6, 17, 12, 0));
  const b = weatherAt(at(2026, 6, 17, 17, 59, 59, 999));
  assert.deepEqual(a, b);
});

// -------------------------------------------------------- block boundary math

test('blockOf maps hours to blocks 0–3 (00–06, 06–12, 12–18, 18–24)', () => {
  assert.equal(blockOf(at(2026, 6, 17, 0, 0)).blockIdx, 0);
  assert.equal(blockOf(at(2026, 6, 17, 5, 59, 59, 999)).blockIdx, 0);
  assert.equal(blockOf(at(2026, 6, 17, 6, 0)).blockIdx, 1);
  assert.equal(blockOf(at(2026, 6, 17, 11, 59)).blockIdx, 1);
  assert.equal(blockOf(at(2026, 6, 17, 12, 0)).blockIdx, 2);
  assert.equal(blockOf(at(2026, 6, 17, 17, 59)).blockIdx, 2);
  assert.equal(blockOf(at(2026, 6, 17, 18, 0)).blockIdx, 3);
  assert.equal(blockOf(at(2026, 6, 17, 23, 59, 59, 999)).blockIdx, 3);
});

test('blockOf start/end are the local block edges in epoch ms', () => {
  const b = blockOf(at(2026, 6, 17, 13, 30));
  assert.equal(b.dayStr, '2026-07-17');
  assert.equal(b.blockIdx, 2);
  assert.equal(b.start, at(2026, 6, 17, 12, 0));
  assert.equal(b.end, at(2026, 6, 17, 18, 0));
});

test('last block of a day ends at next-day midnight; blocks chain seamlessly', () => {
  const evening = blockOf(at(2026, 6, 17, 23, 0));
  assert.equal(evening.end, at(2026, 6, 18, 0, 0));
  const next = blockOf(evening.end);
  assert.equal(next.dayStr, '2026-07-18');
  assert.equal(next.blockIdx, 0);
  assert.equal(next.start, evening.end);
});

test('dayStr pads month/day to YYYY-MM-DD', () => {
  assert.equal(blockOf(at(2026, 0, 5, 8, 0)).dayStr, '2026-01-05');
});

test('weatherAt start/end equal the containing block edges', () => {
  const ms = at(2026, 6, 17, 9, 42);
  const block = blockOf(ms);
  const w = weatherAt(ms);
  assert.equal(w.start, block.start);
  assert.equal(w.end, block.end);
});

// ------------------------------------------------------------------ forecast

test('forecast returns [current, next] with next = the following block', () => {
  const [cur, next] = forecast(at(2026, 6, 17, 13, 30));
  assert.deepEqual(cur, weatherAt(at(2026, 6, 17, 13, 30)));
  assert.equal(next.start, cur.end);
  assert.equal(next.end, at(2026, 6, 18, 0, 0));
  assert.equal(next.state, 'clear'); // 2026-07-17 block 3 locked above
});

test('forecast rolls over midnight into the next local day', () => {
  // 2026-07-18 block 3 = clear (0.3318), 2026-07-19 block 0 = cloudy (0.6294):
  // the next entry must be hashed with the NEXT day's dayStr.
  const [cur, next] = forecast(at(2026, 6, 18, 23, 0));
  assert.equal(cur.state, 'clear');
  assert.equal(next.state, 'cloudy');
  assert.equal(next.start, at(2026, 6, 19, 0, 0));
});

// -------------------------------------------------------------- distribution

test('distribution over 10 000 blocks within ±2% of 55/25/20 (§C11.4)', () => {
  const counts = { clear: 0, cloudy: 0, rain: 0 };
  let n = 0;
  for (let d = 0; n < 10000; d++) {
    const dt = new Date(2026, 0, 1 + d);
    const dayStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate()
    ).padStart(2, '0')}`;
    for (let b = 0; b < 4 && n < 10000; b++, n++) counts[stateFor(dayStr, b)]++;
  }
  assert.equal(counts.clear + counts.cloudy + counts.rain, 10000);
  assert.ok(Math.abs(counts.clear / 10000 - 0.55) <= 0.02, `clear ${counts.clear}`);
  assert.ok(Math.abs(counts.cloudy / 10000 - 0.25) <= 0.02, `cloudy ${counts.cloudy}`);
  assert.ok(Math.abs(counts.rain / 10000 - 0.2) <= 0.02, `rain ${counts.rain}`);
});
