import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAOS_KNOB_SCHEMA,
  CHAOS_KNOB_KEYS,
  DEFAULT_KNOBS,
  defaultKnobs,
  validateKnobs,
} from '../src/chaos.js';

// ---- schema shape -----------------------------------------------------------------

test('schema carries the §B.4 bounds and defaults exactly', () => {
  const expected = {
    handSize: { min: 3, max: 7, def: 5 },
    maxPlay: { min: 1, max: 4, def: 3 },
    startChambers: { min: 2, max: 8, def: 4 },
    startCoconuts: { min: 1, max: 3, def: 1 },
    chipsPerMatch: { min: 0, max: 3, def: 1 },
    chipBonus: { min: 1, max: 4, def: 2 },
  };
  for (const [key, bounds] of Object.entries(expected)) {
    assert.equal(CHAOS_KNOB_SCHEMA[key].min, bounds.min, `${key}.min`);
    assert.equal(CHAOS_KNOB_SCHEMA[key].max, bounds.max, `${key}.max`);
    assert.equal(CHAOS_KNOB_SCHEMA[key].def, bounds.def, `${key}.def`);
  }
  // goldenPerPlayer: bounds fixed by §B.4, default within bounds
  assert.equal(CHAOS_KNOB_SCHEMA.goldenPerPlayer.min, 0);
  assert.equal(CHAOS_KNOB_SCHEMA.goldenPerPlayer.max, 2);
  const gDef = CHAOS_KNOB_SCHEMA.goldenPerPlayer.def;
  assert.ok(Number.isInteger(gDef) && gDef >= 0 && gDef <= 2);
  // every knob has UI strings
  for (const key of CHAOS_KNOB_KEYS) {
    assert.equal(typeof CHAOS_KNOB_SCHEMA[key].label, 'string');
    assert.equal(typeof CHAOS_KNOB_SCHEMA[key].desc, 'string');
  }
});

test('defaultKnobs()/DEFAULT_KNOBS carry every knob at its schema default', () => {
  const d = defaultKnobs();
  assert.deepEqual(Object.keys(d).sort(), [...CHAOS_KNOB_KEYS].sort());
  for (const key of CHAOS_KNOB_KEYS) {
    assert.equal(d[key], CHAOS_KNOB_SCHEMA[key].def, key);
    assert.equal(DEFAULT_KNOBS[key], CHAOS_KNOB_SCHEMA[key].def, key);
  }
  assert.ok(Object.isFrozen(DEFAULT_KNOBS));
  // defaultKnobs() returns a fresh mutable copy
  d.handSize = 7;
  assert.equal(DEFAULT_KNOBS.handSize, CHAOS_KNOB_SCHEMA.handSize.def);
});

// ---- validateKnobs: clamps EVERY bound ----------------------------------------------

test('validateKnobs clamps below-min and above-max for every knob', () => {
  for (const key of CHAOS_KNOB_KEYS) {
    const { min, max } = CHAOS_KNOB_SCHEMA[key];
    const below = validateKnobs({ [key]: min - 1 });
    const above = validateKnobs({ [key]: max + 1 });
    const wayOut = validateKnobs({ [key]: -9999 });
    const wayUp = validateKnobs({ [key]: 9999 });
    assert.equal(below[key], min, `${key}: min-1 should clamp to ${min}`);
    assert.equal(wayOut[key], min, `${key}: -9999 should clamp to ${min}`);
    // maxPlay is additionally capped at handSize (default 5 > 4, so unaffected here)
    assert.equal(above[key], max, `${key}: max+1 should clamp to ${max}`);
    assert.equal(wayUp[key], max, `${key}: 9999 should clamp to ${max}`);
  }
});

test('validateKnobs keeps exact min/max values un-clamped', () => {
  for (const key of CHAOS_KNOB_KEYS) {
    const { min, max } = CHAOS_KNOB_SCHEMA[key];
    assert.equal(validateKnobs({ [key]: min })[key], min, `${key} at min`);
    if (key === 'maxPlay') continue; // capped by default handSize=5 only above 4 — max is 4, fine
    assert.equal(validateKnobs({ [key]: max })[key], max, `${key} at max`);
  }
  assert.equal(validateKnobs({ maxPlay: 4 }).maxPlay, 4);
});

test('validateKnobs enforces maxPlay ≤ handSize', () => {
  assert.equal(validateKnobs({ handSize: 3, maxPlay: 4 }).maxPlay, 3);
  assert.equal(validateKnobs({ handSize: 3 }).maxPlay, 3); // default 3 ok at handSize 3
  assert.equal(validateKnobs({ handSize: 7, maxPlay: 4 }).maxPlay, 4);
  // clamping happens before the cap: handSize 99 → 7, maxPlay 99 → 4 ≤ 7
  const wild = validateKnobs({ handSize: 99, maxPlay: 99 });
  assert.equal(wild.handSize, 7);
  assert.equal(wild.maxPlay, 4);
});

test('validateKnobs fills missing keys with defaults and drops unknown keys', () => {
  assert.deepEqual(validateKnobs(), defaultKnobs());
  assert.deepEqual(validateKnobs({}), defaultKnobs());
  const out = validateKnobs({ startChambers: 8, hacker: 1, cannonAimbot: true });
  assert.equal(out.startChambers, 8);
  assert.ok(!('hacker' in out));
  assert.ok(!('cannonAimbot' in out));
  assert.deepEqual(Object.keys(out).sort(), [...CHAOS_KNOB_KEYS].sort());
});

test('validateKnobs rounds non-integers and rejects non-numeric values', () => {
  assert.equal(validateKnobs({ handSize: 5.4 }).handSize, 5);
  assert.equal(validateKnobs({ handSize: 5.6 }).handSize, 6);
  for (const bad of ['5', NaN, Infinity, -Infinity, null, true, [], {}]) {
    const out = validateKnobs({ startCoconuts: bad });
    assert.equal(out.startCoconuts, CHAOS_KNOB_SCHEMA.startCoconuts.def, `bad value ${String(bad)}`);
  }
  // whole patch garbage → defaults
  assert.deepEqual(validateKnobs(null), defaultKnobs());
  assert.deepEqual(validateKnobs('chaos'), defaultKnobs());
});

test('validateKnobs merges over a base without mutating patch or base', () => {
  const base = validateKnobs({ handSize: 7, chipBonus: 4 });
  const patch = { startChambers: 2 };
  const out = validateKnobs(patch, base);
  assert.equal(out.handSize, 7);
  assert.equal(out.chipBonus, 4);
  assert.equal(out.startChambers, 2);
  assert.deepEqual(patch, { startChambers: 2 });
  assert.equal(base.startChambers, CHAOS_KNOB_SCHEMA.startChambers.def);
  // out-of-bounds base values are re-clamped
  const dirty = { ...defaultKnobs(), handSize: 99 };
  assert.equal(validateKnobs({}, dirty).handSize, 7);
});
