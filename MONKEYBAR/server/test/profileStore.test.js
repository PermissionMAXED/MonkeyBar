// R2 persistence: server/src/persist/profileStore.js — §B.5-1 / PLAN.md §10.5.
// JSON file store: load at boot, atomic temp+rename saves, 2 s debounce,
// in-memory fallback; getOrCreate / addRewards / buy / equip / bumpStats.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LEVEL_CAP, xpToNext } from '@monkeybar/shared/constants.js';
import { COSMETICS, SLOTS } from '@monkeybar/shared/cosmetics.js';
import { ERROR_CODES } from '@monkeybar/shared/protocol.js';

import {
  createProfileStore,
  getActiveProfileStore,
  setActiveProfileStore,
} from '../src/persist/profileStore.js';

const quietLog = { info() {}, warn() {}, error() {}, debug() {}, child: () => quietLog };

function tempFile(name = 'profiles.json') {
  return join(mkdtempSync(join(tmpdir(), 'monkeybar-profiles-')), name);
}

function newStore(overrides = {}) {
  return createProfileStore({ file: tempFile(), debounceMs: 20, log: quietLog, ...overrides });
}

// ---------------------------------------------------------------------------
// Profile lifecycle
// ---------------------------------------------------------------------------

test('getOrCreate: fresh profile shape, idempotent per playerId', async () => {
  const store = newStore();
  const p = store.getOrCreate('alice');
  assert.equal(p.playerId, 'alice');
  assert.equal(p.coins, 0);
  assert.equal(p.xp, 0);
  assert.equal(p.level, 1);
  assert.equal(p.wins, 0);
  assert.equal(p.matches, 0);
  assert.deepEqual(p.unlocked, []);
  assert.deepEqual(p.equipped, {});
  assert.deepEqual(p.stats, { perMode: {} });
  assert.equal(store.getOrCreate('alice'), p, 'same record on repeat calls');
  assert.equal(store.size, 1);
  await store.close();
});

test('payloadFor: §10.2 profile payload with shared xpToNext, copies not live refs', async () => {
  const store = newStore();
  store.getOrCreate('p1');
  const payload = store.payloadFor('p1');
  assert.deepEqual(payload, {
    playerId: 'p1',
    coins: 0,
    xp: 0,
    level: 1,
    xpToNext: xpToNext(1),
    wins: 0,
    matches: 0,
    unlocked: [],
    equipped: {},
    stats: { perMode: {} },
  });
  payload.unlocked.push('hax');
  payload.equipped.hat = 'hax';
  assert.deepEqual(store.payloadFor('p1').unlocked, [], 'payload mutations never write back');
  assert.deepEqual(store.payloadFor('p1').equipped, {});
  await store.close();
});

// ---------------------------------------------------------------------------
// addRewards: coins + XP with level rollover
// ---------------------------------------------------------------------------

test('addRewards: credits coins, rolls levels through shared xpToNext, caps at LEVEL_CAP', async () => {
  const store = newStore();

  // No level-up below the threshold (level 1 → 2 needs xpToNext(1)).
  let res = store.addRewards('p1', { coins: 60, xp: xpToNext(1) - 1 });
  assert.deepEqual(res, { levelUps: 0, newLevel: 1 });
  assert.equal(store.getOrCreate('p1').coins, 60);

  // One more XP tips the level; leftover XP carries into the new level.
  res = store.addRewards('p1', { coins: 0, xp: 1 + 10 });
  assert.deepEqual(res, { levelUps: 1, newLevel: 2 });
  assert.equal(store.getOrCreate('p1').xp, 10);

  // A huge grant rolls several levels at once.
  res = store.addRewards('p1', { xp: xpToNext(2) + xpToNext(3) });
  assert.equal(res.levelUps, 2);
  assert.equal(res.newLevel, 4);
  assert.equal(store.getOrCreate('p1').xp, 10, 'leftover preserved across multi-level rollover');

  // The cap holds no matter how much XP lands.
  res = store.addRewards('capped', { xp: 100_000_000 });
  assert.equal(res.newLevel, LEVEL_CAP);
  assert.equal(store.getOrCreate('capped').xp, 0, 'xp is irrelevant at the cap');
  assert.equal(store.payloadFor('capped').xpToNext, 0);
  await store.close();
});

// ---------------------------------------------------------------------------
// buy: price/minLevel checks vs shared/cosmetics.js
// ---------------------------------------------------------------------------

test('buy: NOT_FOUND / LOCKED / CANT_AFFORD / already-owned; success deducts and unlocks', async () => {
  const store = newStore();
  const cheap = COSMETICS.find((c) => c.minLevel === 1); // affordable at level 1
  const gated = COSMETICS.find((c) => c.minLevel > 1);

  assert.equal(store.buy('p1', 'no_such_item').code, ERROR_CODES.NOT_FOUND);

  store.addRewards('p1', { coins: 10_000 });
  assert.equal(store.buy('p1', gated.id).code, ERROR_CODES.LOCKED, 'level gate before price');

  assert.equal(store.buy('poor', cheap.id).code, ERROR_CODES.CANT_AFFORD);

  const before = store.getOrCreate('p1').coins;
  assert.equal(store.buy('p1', cheap.id).ok, true);
  assert.equal(store.getOrCreate('p1').coins, before - cheap.price);
  assert.deepEqual(store.getOrCreate('p1').unlocked, [cheap.id]);

  assert.equal(store.buy('p1', cheap.id).code, ERROR_CODES.BAD_STATE, 'no double-buys');
  await store.close();
});

// ---------------------------------------------------------------------------
// equip: ownership + slot checks
// ---------------------------------------------------------------------------

test('equip: slot/ownership validation; equips and unequips (itemId null)', async () => {
  const store = newStore();
  const hat = COSMETICS.find((c) => c.slot === SLOTS.HAT && c.minLevel === 1);
  store.addRewards('p1', { coins: hat.price });
  assert.equal(store.buy('p1', hat.id).ok, true);

  assert.equal(store.equip('p1', 'notaslot', hat.id).code, ERROR_CODES.BAD_MSG);
  assert.equal(store.equip('p1', SLOTS.HAT, 'no_such_item').code, ERROR_CODES.NOT_FOUND);
  assert.equal(store.equip('p1', SLOTS.SKIN, hat.id).code, ERROR_CODES.BAD_MSG, 'wrong slot');
  const skin = COSMETICS.find((c) => c.slot === SLOTS.SKIN);
  assert.equal(store.equip('p1', SLOTS.SKIN, skin.id).code, ERROR_CODES.LOCKED, 'not owned');

  assert.equal(store.equip('p1', SLOTS.HAT, hat.id).ok, true);
  assert.deepEqual(store.getEquipped('p1'), { hat: hat.id });

  assert.equal(store.equip('p1', SLOTS.HAT, null).ok, true);
  assert.deepEqual(store.getEquipped('p1'), {});
  await store.close();
});

// ---------------------------------------------------------------------------
// bumpStats
// ---------------------------------------------------------------------------

test('bumpStats: total + per-mode matches/wins', async () => {
  const store = newStore();
  store.bumpStats('p1', 'monkeyLies', { win: true });
  store.bumpStats('p1', 'monkeyLies', { win: false });
  store.bumpStats('p1', 'bananaDice', { win: false });
  const p = store.getOrCreate('p1');
  assert.equal(p.matches, 3);
  assert.equal(p.wins, 1);
  assert.deepEqual(p.stats.perMode, {
    monkeyLies: { plays: 2, wins: 1 },
    bananaDice: { plays: 1, wins: 0 },
  });
  await store.close();
});

// ---------------------------------------------------------------------------
// Persistence: debounce, atomic temp+rename, reload, fallback
// ---------------------------------------------------------------------------

test('persistence: debounced atomic save; a fresh store reloads the same data', async () => {
  const file = tempFile();
  const store = createProfileStore({ file, debounceMs: 20, log: quietLog });
  store.addRewards('alice', { coins: 123, xp: 45 });
  store.bumpStats('alice', 'monkeyLies', { win: true });
  assert.equal(existsSync(file), false, 'nothing written before the debounce fires');
  await store.close(); // flush

  assert.equal(existsSync(file), true);
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(onDisk.profiles.alice.coins, 123);
  const leftovers = readdirSync(join(file, '..')).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'temp file renamed away (atomic write)');

  const reloaded = createProfileStore({ file, debounceMs: 20, log: quietLog });
  const alice = reloaded.getOrCreate('alice');
  assert.equal(alice.coins, 123);
  assert.equal(alice.xp, 45);
  assert.equal(alice.matches, 1);
  assert.equal(alice.wins, 1);
  await reloaded.close();
});

test('identity: token→playerId binding persists across a reload (§B.5-1)', async () => {
  const file = tempFile();
  const store = createProfileStore({ file, debounceMs: 10, log: quietLog });
  store.bindToken('tok-abc', 'player-1');
  store.addRewards('player-1', { coins: 42 });
  assert.equal(store.resolveToken('tok-abc'), 'player-1');
  assert.equal(store.resolveToken('tok-unknown'), null);
  await store.close();

  const reloaded = createProfileStore({ file, debounceMs: 10, log: quietLog });
  assert.equal(reloaded.resolveToken('tok-abc'), 'player-1', 'binding reloaded from disk');
  assert.equal(reloaded.getOrCreate('player-1').coins, 42);
  await reloaded.close();
});

test('persistence: debounce timer writes on its own (no explicit flush)', async () => {
  const file = tempFile();
  const store = createProfileStore({ file, debounceMs: 15, log: quietLog });
  store.addRewards('bob', { coins: 7 });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(existsSync(file), true, 'debounced save landed');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).profiles.bob.coins, 7);
  await store.close();
});

test('fallback: corrupt file starts empty; unusable dir serves from memory', async () => {
  const file = tempFile();
  writeFileSync(file, '{this is not json', 'utf8');
  const store = createProfileStore({ file, debounceMs: 10, log: quietLog });
  assert.equal(store.size, 0, 'corrupt file → fresh store, no throw');
  store.addRewards('p1', { coins: 5 });
  await store.close();
  assert.equal(
    JSON.parse(readFileSync(file, 'utf8')).profiles.p1.coins,
    5,
    'store recovers the file on the next save'
  );

  // A data dir that cannot exist (its parent is a FILE) → pure in-memory
  // operation, still fully functional.
  const blocker = tempFile('blocker');
  writeFileSync(blocker, 'i am a file, not a directory', 'utf8');
  const bad = createProfileStore({
    file: join(blocker, 'nested', 'profiles.json'),
    debounceMs: 10,
    log: quietLog,
  });
  assert.equal(bad.persistent, false, 'disk marked unusable');
  bad.addRewards('p1', { coins: 9 });
  assert.equal(bad.getOrCreate('p1').coins, 9, 'in-memory fallback keeps serving');
  await bad.close();
});

test('persist:false runs purely in memory', async () => {
  const file = tempFile();
  const store = createProfileStore({ file, persist: false, log: quietLog });
  store.addRewards('p1', { coins: 50 });
  await store.flush();
  assert.equal(existsSync(file), false, 'never touches disk');
  assert.equal(store.persistent, false);
  await store.close();
});

// ---------------------------------------------------------------------------
// Active-store accessor (index.js registers at boot; room.js reads)
// ---------------------------------------------------------------------------

test('active store accessor: set/get/clear', async () => {
  const prev = getActiveProfileStore();
  const store = newStore({ persist: false });
  try {
    setActiveProfileStore(store);
    assert.equal(getActiveProfileStore(), store);
    setActiveProfileStore(null);
    assert.equal(getActiveProfileStore(), null);
  } finally {
    setActiveProfileStore(prev);
    await store.close();
  }
});
