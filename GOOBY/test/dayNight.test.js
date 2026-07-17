// Day/night engine (§B4/§C10) vs the binding numbers: band table, boundary
// minutes, 30-min crossfade math, DST-agnosticism (pure local wall-clock).
import test from 'node:test';
import assert from 'node:assert/strict';

import { BANDS, BLEND_MIN, bandAt } from '../src/systems/dayNight.js';

/** Epoch ms for a LOCAL wall-clock time on an arbitrary fixed date. */
function at(h, m = 0, s = 0, ms = 0, day = 17, month = 6, year = 2026) {
  return new Date(year, month, day, h, m, s, ms).getTime();
}

// ---------------------------------------------------------------- band table

test('BANDS is the §B4 table verbatim (ids, from/to hours, order)', () => {
  assert.deepEqual(
    BANDS.map((b) => ({ ...b })),
    [
      { id: 'night', from: 21, to: 6 },
      { id: 'dawn', from: 6, to: 8 },
      { id: 'day', from: 8, to: 18 },
      { id: 'dusk', from: 18, to: 21 },
    ]
  );
});

test('BANDS and its rows are frozen', () => {
  assert.ok(Object.isFrozen(BANDS));
  for (const b of BANDS) assert.ok(Object.isFrozen(b));
});

test('the four bands cover all 1440 minutes exactly once', () => {
  const counts = { night: 0, dawn: 0, day: 0, dusk: 0 };
  for (let m = 0; m < 1440; m++) {
    counts[bandAt(at(Math.floor(m / 60), m % 60)).band]++;
  }
  assert.deepEqual(counts, { night: 9 * 60, dawn: 2 * 60, day: 10 * 60, dusk: 3 * 60 });
});

// ------------------------------------------------- §C10.4 boundary minutes

test('boundary 05:59 → night, 06:00 → dawn', () => {
  assert.equal(bandAt(at(5, 59)).band, 'night');
  assert.equal(bandAt(at(5, 59, 59, 999)).band, 'night');
  assert.equal(bandAt(at(6, 0)).band, 'dawn');
});

test('boundary 07:59 → dawn, 08:00 → day', () => {
  assert.equal(bandAt(at(7, 59)).band, 'dawn');
  assert.equal(bandAt(at(8, 0)).band, 'day');
});

test('boundary 17:59 → day, 18:00 → dusk', () => {
  assert.equal(bandAt(at(17, 59)).band, 'day');
  assert.equal(bandAt(at(18, 0)).band, 'dusk');
});

test('boundary 20:59 → dusk, 21:00 → night', () => {
  assert.equal(bandAt(at(20, 59)).band, 'dusk');
  assert.equal(bandAt(at(21, 0)).band, 'night');
});

test('night wraps midnight: 23:59 and 00:00 both night', () => {
  assert.equal(bandAt(at(23, 59)).band, 'night');
  assert.equal(bandAt(at(0, 0)).band, 'night');
  assert.equal(bandAt(at(3, 30)).band, 'night');
});

// ---------------------------------------------------------- crossfade math

test('blend at a band start: t = 0, from = previous band', () => {
  assert.deepEqual(bandAt(at(6, 0)).blend, { from: 'night', to: 'dawn', t: 0 });
  assert.deepEqual(bandAt(at(8, 0)).blend, { from: 'dawn', to: 'day', t: 0 });
  assert.deepEqual(bandAt(at(18, 0)).blend, { from: 'day', to: 'dusk', t: 0 });
  assert.deepEqual(bandAt(at(21, 0)).blend, { from: 'dusk', to: 'night', t: 0 });
});

test('blend t ramps linearly over the 30-min window (06:15 → 0.5, 06:29 → 29/30)', () => {
  assert.equal(bandAt(at(6, 15)).blend.t, 0.5);
  assert.equal(bandAt(at(6, 29)).blend.t, 29 / 30);
  assert.equal(bandAt(at(18, 10)).blend.t, 10 / 30);
});

test('blend is null from minute 30 of a band onward (§C10.4: 06:29 vs 06:30)', () => {
  assert.notEqual(bandAt(at(6, 29)).blend, null);
  assert.equal(bandAt(at(6, 30)).blend, null);
  assert.equal(bandAt(at(12, 0)).blend, null);
  assert.equal(bandAt(at(21, 30)).blend, null);
});

test('blend uses sub-minute precision (06:00:30 → t = 0.5/30)', () => {
  const { blend } = bandAt(at(6, 0, 30));
  assert.ok(Math.abs(blend.t - 0.5 / 30) < 1e-12, `t = ${blend.t}`);
});

test('night blend only in 21:00–21:30, not after midnight', () => {
  assert.deepEqual(bandAt(at(21, 15)).blend, { from: 'dusk', to: 'night', t: 0.5 });
  assert.equal(bandAt(at(0, 10)).blend, null);
  assert.equal(bandAt(at(5, 0)).blend, null);
});

test('BLEND_MIN is the §C10.1 30-minute window', () => {
  assert.equal(BLEND_MIN, 30);
});

// -------------------------------------------------------------- tInBand math

test('tInBand: 0 at band start, fraction of band elapsed', () => {
  assert.equal(bandAt(at(8, 0)).tInBand, 0);
  assert.equal(bandAt(at(13, 0)).tInBand, 0.5); // 5 h into the 10 h day band
  assert.equal(bandAt(at(7, 0)).tInBand, 0.5); // 1 h into the 2 h dawn band
  assert.equal(bandAt(at(19, 30)).tInBand, 0.5); // 1.5 h into the 3 h dusk band
});

test('tInBand crosses midnight inside night (00:00 → 3 h of 9 h)', () => {
  assert.equal(bandAt(at(21, 0)).tInBand, 0);
  assert.ok(Math.abs(bandAt(at(0, 0)).tInBand - 3 / 9) < 1e-12);
  assert.ok(bandAt(at(5, 59)).tInBand < 1);
  assert.ok(bandAt(at(5, 59)).tInBand > 0.99);
});

// -------------------------------------------------------------- DST-agnostic

test('DST-agnostic: same wall time → same result on any date of the year', () => {
  const ref = bandAt(at(6, 15));
  for (let month = 0; month < 12; month++) {
    for (const day of [1, 15, 28]) {
      const r = bandAt(at(6, 15, 0, 0, day, month));
      assert.deepEqual(r, ref, `2026-${month + 1}-${day} 06:15`);
    }
  }
});

test('DST-agnostic: daily sweep across a whole year at fixed wall times', () => {
  for (let d = 0; d < 365; d++) {
    const noon = bandAt(new Date(2026, 0, 1 + d, 12, 0).getTime());
    assert.equal(noon.band, 'day', `day ${d} noon`);
    assert.equal(noon.blend, null);
    const night = bandAt(new Date(2026, 0, 1 + d, 23, 0).getTime());
    assert.equal(night.band, 'night', `day ${d} 23:00`);
  }
});
