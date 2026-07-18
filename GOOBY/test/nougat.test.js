// V3/G35 — Nougatschleuse pure-logic tests (§C6.5): refusal matrix
// (cooldown/noJar/sick/sleeping), effect application incl. DOUBLE junkScore,
// cooldown math across clock pinning, jar consumption, and the §B1 migration
// default (nougat slice absent → { lastGlobAt: 0, installed: false }).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  NOUGAT,
  canGlob,
  cooldownRemainingMs,
  applyGlob,
} from '../src/systems/nougat.logic.js';
import { WEIGHT } from '../src/systems/weight.js';
import { migrations } from '../src/core/save.js';

const NOW = 1_784_000_000_000;

/** A healthy, awake, jar-stocked baseline state (glob-ready). */
function baseState(over = {}) {
  return {
    stats: { hunger: 50, energy: 60, hygiene: 60, fun: 50 },
    inventory: { nutella: 2, carrot: 1 },
    health: { state: 'healthy', junkScore: 0, neglectMin: 0, recoverMin: 0, since: 0 },
    weight: { value: 50 },
    xp: 10,
    level: 6,
    sleep: { sleeping: false },
    nougat: { lastGlobAt: 0, installed: true },
    achievements: { counters: { nougatGlobs: 3 } },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §B purity rule: no three.js/DOM imports in the logic module
// ---------------------------------------------------------------------------

test('nougat.logic.js is pure (no three.js/DOM static imports)', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/systems/nougat.logic.js', import.meta.url)),
    'utf8'
  );
  assert.ok(!/from\s+['"]three['"]/.test(src), 'no three.js import');
  assert.ok(!/\bdocument\.|\bwindow\./.test(src), 'no DOM access');
});

// ---------------------------------------------------------------------------
// §C6.4 frozen numbers
// ---------------------------------------------------------------------------

test('NOUGAT numbers match §C6.4 exactly', () => {
  assert.equal(NOUGAT.COOLDOWN_MIN, 30);
  assert.deepEqual({ ...NOUGAT.STAT_DELTAS }, { hunger: 15, fun: 10, hygiene: -8 });
  assert.equal(NOUGAT.JUNK_EATS, 2, 'double junk');
  assert.equal(NOUGAT.WEIGHT_EATS, 1, 'weight applied once');
  assert.equal(NOUGAT.XP, 2);
  assert.equal(NOUGAT.JAR_FOOD_ID, 'nutella');
  assert.equal(NOUGAT.SEQUENCE_SEC, 2.8);
  assert.equal(NOUGAT.MESSY_FACE_SEC, 60);
  assert.equal(NOUGAT.PRICE, 400);
  assert.equal(NOUGAT.UNLOCK_LEVEL, 5);
  assert.equal(WEIGHT.EAT_JUNK, 2, '§C6.4 weight +2 rides one junk eat');
});

// ---------------------------------------------------------------------------
// refusal matrix (§C6.5)
// ---------------------------------------------------------------------------

test('canGlob: ok when awake, healthy, jar in stock, cooldown elapsed', () => {
  assert.deepEqual(canGlob(baseState(), NOW), { ok: true });
});

test('canGlob refusals: sleeping > sick > noJar > cooldown (§C6.4 order)', () => {
  const coolingDown = { lastGlobAt: NOW - 10 * 60000, installed: true };
  // sleeping wins over everything
  assert.deepEqual(
    canGlob(baseState({
      sleep: { sleeping: true }, health: { state: 'sick' }, inventory: {}, nougat: coolingDown,
    }), NOW),
    { ok: false, reason: 'sleeping' }
  );
  // sick wins over noJar/cooldown
  assert.deepEqual(
    canGlob(baseState({ health: { state: 'sick' }, inventory: {}, nougat: coolingDown }), NOW),
    { ok: false, reason: 'sick' }
  );
  // queasy is NOT a refusal (only sick refuses, §C3.4-v2 semantics)
  assert.deepEqual(canGlob(baseState({ health: { state: 'queasy' } }), NOW), { ok: true });
  // no jar wins over cooldown
  assert.deepEqual(
    canGlob(baseState({ inventory: { carrot: 3 }, nougat: coolingDown }), NOW),
    { ok: false, reason: 'noJar' }
  );
  // cooldown last
  assert.deepEqual(
    canGlob(baseState({ nougat: coolingDown }), NOW),
    { ok: false, reason: 'cooldown' }
  );
});

// ---------------------------------------------------------------------------
// cooldown math across clock pinning (§C6.5)
// ---------------------------------------------------------------------------

test('cooldown: exactly 30 real minutes from lastGlobAt, pinned-clock safe', () => {
  const s = baseState({ nougat: { lastGlobAt: NOW, installed: true } });
  assert.equal(cooldownRemainingMs(s, NOW), 30 * 60000);
  assert.equal(cooldownRemainingMs(s, NOW + 29 * 60000), 60000);
  assert.equal(canGlob(s, NOW + 30 * 60000 - 1).reason, 'cooldown');
  assert.deepEqual(canGlob(s, NOW + 30 * 60000), { ok: true });
  // clock pinned BACKWARDS (harness ?now=) must not unlock the machine early
  assert.equal(canGlob(s, NOW - 5 * 60000).reason, 'cooldown');
  assert.equal(cooldownRemainingMs(s, NOW - 5 * 60000), 35 * 60000);
  // never-used machine (lastGlobAt 0 default) is instantly ready
  assert.equal(cooldownRemainingMs(baseState(), NOW), 0);
  // garbage timestamps fail safe to "ready" (validate() clamps them anyway)
  assert.equal(cooldownRemainingMs({ nougat: { lastGlobAt: NaN } }, NOW), 0);
});

// ---------------------------------------------------------------------------
// effect application (§C6.5): exact numbers, double junkScore, jar consumption
// ---------------------------------------------------------------------------

test('applyGlob: hunger +15 fun +10 hygiene −8, junkScore +2, weight +2, XP +2, −1 jar, counter +1', () => {
  const s = baseState();
  const r = applyGlob(s, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.stats.hunger, 65);
  assert.equal(r.stats.fun, 60);
  assert.equal(r.stats.hygiene, 52);
  assert.equal(r.stats.energy, 60, 'energy untouched');
  assert.equal(r.health.junkScore, 2, 'DOUBLE junk (+1 ×2)');
  assert.equal(r.weight.value, 52, 'weight +2 (one junk eat)');
  assert.equal(r.xp, 12, 'XP +2');
  assert.equal(r.level, 6);
  assert.equal(r.inventory.nutella, 1, 'consumed exactly 1 jar');
  assert.equal(r.inventory.carrot, 1, 'other items untouched');
  assert.equal(r.nougat.lastGlobAt, NOW, 'cooldown timestamp set');
  assert.equal(r.nougat.installed, true, 'installed flag preserved');
  assert.equal(r.nougatGlobs, 4, 'counter +1');
  // purity: input untouched
  assert.equal(s.stats.hunger, 50);
  assert.equal(s.inventory.nutella, 2);
  assert.equal(s.health.junkScore, 0);
  assert.equal(s.nougat.lastGlobAt, 0);
});

test('applyGlob: double junk crosses health thresholds like two junk bites', () => {
  // junkScore 3 → 5 crosses the §B5 queasy line semantics via tummyWarnPending
  const s = baseState({ health: { state: 'healthy', junkScore: 3, neglectMin: 0, recoverMin: 0, since: 0 } });
  const r = applyGlob(s, NOW);
  assert.equal(r.health.junkScore, 5);
  assert.equal(r.health.tummyWarnPending, true, '§C3.2 warning latched crossing 4');
  assert.equal(r.health.recoverMin, 0, 'recovery window reset on junk');
});

test('applyGlob: last jar empties the inventory key; no jar fails closed', () => {
  const one = applyGlob(baseState({ inventory: { nutella: 1 } }), NOW);
  assert.equal(one.ok, true);
  assert.equal(one.inventory.nutella ?? 0, 0);
  const none = applyGlob(baseState({ inventory: { carrot: 2 } }), NOW);
  assert.deepEqual(none, { ok: false, reason: 'noJar' });
});

// ---------------------------------------------------------------------------
// migration default (§C6.5/§B1): nougat slice absent → defaults
// ---------------------------------------------------------------------------

test('v2 → v3 migration: absent nougat slice gains { lastGlobAt: 0, installed: false }', () => {
  const v2 = { v: 2, coins: 120, stats: { hunger: 50, energy: 50, hygiene: 50, fun: 50 } };
  const v3 = migrations[2]({ ...v2 });
  assert.equal(v3.v, 3);
  assert.deepEqual(v3.nougat, { lastGlobAt: 0, installed: false });
  // existing slices pass through verbatim; an existing nougat slice wins
  const kept = migrations[2]({ v: 2, nougat: { lastGlobAt: 123, installed: true } });
  assert.deepEqual(kept.nougat, { lastGlobAt: 123, installed: true });
});
