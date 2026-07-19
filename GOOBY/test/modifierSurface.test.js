// V4/G76 — modifier surfacing tests (PLAN4 §C-SYS4.2/4.4/4.6 + PLAN4-GAMES
// §G8-3): strings/v4-modifier.js EN/DE parity incl. the 6 engine nameKeys
// (verbatim §C-SYS4.2 names) and per-type descriptions, the Glücksrolle
// slot-roll math (900 ms / 10–60 bounds, determinism), the stickerChance
// forced-drop pick rules, the results breakdown line model and the HUD
// chip's event signature. Pure imports only (node:test — no DOM/three).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GLUECKSPILZ_ROLL,
  rollFrameValue,
  FORCED_DROP_SETS,
  hasOrganicDrop,
  pickForcedDrop,
  modifierResultsValue,
  eventSignature,
} from '../src/ui/modifierSurface.logic.js';
import { EN as MOD_EN, DE as MOD_DE } from '../src/data/strings/v4-modifier.js';
import { EN as GLOBAL_EN, DE as GLOBAL_DE } from '../src/data/strings.js';
import {
  MODIFIER_TYPES,
  MODIFIER_CAPS,
  MODIFIER_ELIGIBLE,
} from '../src/systems/modifierEngine.js';
import { getCollectionSet } from '../src/data/collections.js';

const TYPE_IDS = Object.keys(MODIFIER_TYPES);

// ---------------------------------------------------------------------------
// strings/v4-modifier.js — names/descriptions for ALL 6 types, EN + DE

test('v4-modifier: EN and DE carry the identical key set, all non-empty', () => {
  assert.deepEqual(Object.keys(MOD_EN).sort(), Object.keys(MOD_DE).sort());
  for (const [key, value] of [...Object.entries(MOD_EN), ...Object.entries(MOD_DE)]) {
    assert.ok(typeof value === 'string' && value.length > 0, `empty value for ${key}`);
  }
});

test('v4-modifier: every engine nameKey + a description exists per type', () => {
  for (const id of TYPE_IDS) {
    const def = MODIFIER_TYPES[id];
    assert.equal(def.nameKey, `modifier.name.${id}`); // §C-SYS4.2 contract
    assert.ok(MOD_EN[def.nameKey], `missing EN name for ${id}`);
    assert.ok(MOD_DE[def.nameKey], `missing DE name for ${id}`);
    assert.ok(MOD_EN[`modifier.desc.${id}`], `missing EN desc for ${id}`);
    assert.ok(MOD_DE[`modifier.desc.${id}`], `missing DE desc for ${id}`);
  }
});

test('v4-modifier: §C-SYS4.2 type names verbatim (DE / EN column)', () => {
  assert.equal(MOD_DE['modifier.name.doppelGold'], 'Doppel-Gold');
  assert.equal(MOD_EN['modifier.name.doppelGold'], 'Double Gold');
  assert.equal(MOD_DE['modifier.name.muenzregen'], 'Münzregen');
  assert.equal(MOD_EN['modifier.name.muenzregen'], 'Coin Rain');
  assert.equal(MOD_DE['modifier.name.turbo'], 'Turbo');
  assert.equal(MOD_EN['modifier.name.turbo'], 'Turbo');
  assert.equal(MOD_DE['modifier.name.riesenGooby'], 'Riesen-Gooby');
  assert.equal(MOD_EN['modifier.name.riesenGooby'], 'Giant Gooby');
  assert.equal(MOD_DE['modifier.name.stickerChance'], 'Sticker-Chance');
  assert.equal(MOD_EN['modifier.name.stickerChance'], 'Sticker Chance');
  assert.equal(MOD_DE['modifier.name.glueckspilz'], 'Glückspilz');
  assert.equal(MOD_EN['modifier.name.glueckspilz'], 'Lucky Charm');
});

test('v4-modifier: surfacing keys — start toast, HUD chip, results lines', () => {
  for (const key of [
    'modifier.start', 'modifier.hud.open', 'modifier.results.doppelGold',
    'modifier.results.turbo', 'modifier.results.sticker.drop',
    'modifier.results.sticker.quest', 'modifier.results.glueckspilz',
    'modifier.results.capped',
  ]) {
    assert.ok(MOD_EN[key], `missing EN ${key}`);
    assert.ok(MOD_DE[key], `missing DE ${key}`);
  }
  // §C-SYS4.6 toast interpolates both vars; §C-SYS4.2 cap note verbatim.
  assert.match(MOD_EN['modifier.start'], /\{name\}/);
  assert.match(MOD_EN['modifier.start'], /\{game\}/);
  assert.match(MOD_DE['modifier.start'], /\{name\}/);
  assert.match(MOD_DE['modifier.start'], /\{game\}/);
  assert.equal(MOD_DE['modifier.results.capped'], 'Tagesbonus erreicht');
  assert.match(MOD_EN['modifier.results.doppelGold'], /\{n\}/);
});

test('v4-modifier: keys reach the global dictionaries (G53 spread wiring)', () => {
  assert.equal(GLOBAL_EN['modifier.name.doppelGold'], 'Double Gold');
  assert.equal(GLOBAL_DE['modifier.name.glueckspilz'], 'Glückspilz');
  assert.equal(GLOBAL_DE['modifier.results.capped'], 'Tagesbonus erreicht');
});

// ---------------------------------------------------------------------------
// Glücksrolle slot-roll math (§C-SYS4.2: 900 ms, 10–60 c)

test('GLUECKSPILZ_ROLL pins the §C-SYS4.2 presentation numbers', () => {
  assert.equal(GLUECKSPILZ_ROLL.DURATION_MS, 900);
  assert.equal(GLUECKSPILZ_ROLL.MIN, MODIFIER_CAPS.GLUECKSPILZ_MIN);
  assert.equal(GLUECKSPILZ_ROLL.MAX, MODIFIER_CAPS.GLUECKSPILZ_MAX);
  assert.ok(GLUECKSPILZ_ROLL.TICK_MS > 0 && GLUECKSPILZ_ROLL.TICK_MS < GLUECKSPILZ_ROLL.DURATION_MS);
  assert.ok(Object.isFrozen(GLUECKSPILZ_ROLL));
});

test('rollFrameValue: integers in [10, 60], deterministic, non-constant reel', () => {
  const seen = new Set();
  for (const seed of [0, 1, 7, 12345, -3]) {
    for (let frame = 0; frame < 200; frame += 1) {
      const v = rollFrameValue(frame, seed);
      assert.ok(Number.isInteger(v), `non-integer at ${frame}/${seed}`);
      assert.ok(v >= GLUECKSPILZ_ROLL.MIN && v <= GLUECKSPILZ_ROLL.MAX, `out of bounds: ${v}`);
      assert.equal(v, rollFrameValue(frame, seed)); // deterministic
      seen.add(v);
    }
  }
  assert.ok(seen.size > 20, `reel too flat (${seen.size} distinct values)`);
});

// ---------------------------------------------------------------------------
// stickerChance forced drop (§C-SYS4.2)

test('FORCED_DROP_SETS: exactly the §B3-v2 collection-meta games', () => {
  assert.deepEqual({ ...FORCED_DROP_SETS }, {
    fishingPond: 'fish',
    cityDrive: 'landmarks',
    deliveryRush: 'landmarks',
  });
  for (const [gameId, setId] of Object.entries(FORCED_DROP_SETS)) {
    // every mapped game is stickerChance-eligible and the set exists
    assert.ok(MODIFIER_ELIGIBLE.stickerChance.includes(gameId), `${gameId} not eligible`);
    assert.ok(getCollectionSet(setId), `unknown set ${setId}`);
  }
});

test('hasOrganicDrop: fish `caught` / landmark meta count, empties do not', () => {
  assert.equal(hasOrganicDrop({ caught: ['pinkKoi'] }), true);
  assert.equal(hasOrganicDrop({ landmarks: ['fountain'] }), true);
  assert.equal(hasOrganicDrop({ caught: [], landmarks: [] }), false);
  assert.equal(hasOrganicDrop({}), false);
  assert.equal(hasOrganicDrop(undefined), false);
  assert.equal(hasOrganicDrop({ caught: 'pinkKoi' }), false); // non-array junk
});

test('pickForcedDrop: prefers unowned entries, seeded + deterministic', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const owned = { a: 2, b: 0, c: 1, d: 0 };
  for (let seed = 0; seed < 24; seed += 1) {
    const pick = pickForcedDrop(ids, owned, seed, true);
    assert.ok(['b', 'd'].includes(pick), `owned entry picked: ${pick}`);
    assert.equal(pick, pickForcedDrop(ids, owned, seed, true)); // deterministic
  }
  // both unowned entries are reachable across seeds
  const picks = new Set([0, 1, 2, 3].map((s) => pickForcedDrop(ids, owned, s, true)));
  assert.equal(picks.size, 2);
});

test('pickForcedDrop: all owned → duplicates only when allowed (fish vs landmarks)', () => {
  const ids = ['a', 'b'];
  const owned = { a: 1, b: 3 };
  assert.ok(ids.includes(pickForcedDrop(ids, owned, 5, true))); // fish: dup drop
  assert.equal(pickForcedDrop(ids, owned, 5, false), null); // landmarks: no-op dup → null
  assert.equal(pickForcedDrop([], {}, 0, true), null);
  assert.equal(pickForcedDrop(['', 7, null], {}, 0, true), null); // junk entries filtered
});

// ---------------------------------------------------------------------------
// results breakdown line model (§G8-3 / §C-SYS4.2 / §C-SYS11)

test('modifierResultsValue: doppelGold „+N extra" 🪙, day-capped note at 0', () => {
  assert.deepEqual(modifierResultsValue('doppelGold', { bonus: 24 }),
    { key: 'modifier.results.doppelGold', vars: { n: 24 }, coin: true });
  assert.deepEqual(modifierResultsValue('doppelGold', { bonus: 0, capped: true }),
    { key: 'modifier.results.capped' });
  assert.equal(modifierResultsValue('doppelGold', { bonus: 0, capped: false }), null);
});

test('modifierResultsValue: turbo score note, stickerChance outcome notes', () => {
  assert.deepEqual(modifierResultsValue('turbo', {}), { key: 'modifier.results.turbo' });
  assert.deepEqual(modifierResultsValue('stickerChance', { stickerOutcome: 'drop' }),
    { key: 'modifier.results.sticker.drop' });
  assert.deepEqual(modifierResultsValue('stickerChance', { stickerOutcome: 'quest' }),
    { key: 'modifier.results.sticker.quest' });
  assert.equal(modifierResultsValue('stickerChance', {}), null);
});

test('modifierResultsValue: organic/cosmetic/roll types render the chip row only', () => {
  assert.equal(modifierResultsValue('muenzregen', { bonus: 9 }), null);
  assert.equal(modifierResultsValue('riesenGooby', {}), null);
  assert.equal(modifierResultsValue('glueckspilz', { bonus: 30 }), null); // own animated row
  assert.equal(modifierResultsValue('unknownType', {}), null);
  assert.equal(modifierResultsValue('doppelGold'), null); // no round facts → no line
});

// ---------------------------------------------------------------------------
// HUD chip event signature (§C-SYS4.6 once-per-event toast)

test('eventSignature: identity per (game, type, startedAt); empty without event', () => {
  assert.equal(eventSignature(null), '');
  assert.equal(eventSignature(undefined), '');
  const cur = { gameId: 'bunnyHop', type: 'turbo', startedAt: 123456 };
  assert.equal(eventSignature(cur), 'bunnyHop|turbo|123456');
  assert.notEqual(eventSignature(cur), eventSignature({ ...cur, startedAt: 999 }));
  assert.notEqual(eventSignature(cur), eventSignature({ ...cur, type: 'doppelGold' }));
});
