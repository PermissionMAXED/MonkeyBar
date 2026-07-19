// V4/G69 — XP info sheet source-of-truth and integration contracts
// (PLAN4 §C-SYS3.2–3.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { XP, LEVELING, QUEST_POOL, PHOTO } from '../src/data/constants.js';
import { NOUGAT } from '../src/systems/nougat.logic.js';
import { minigameXp } from '../src/systems/leveling.js';
import {
  buildXpInfoData,
  knownLifetimeXpSources,
  trackXpSources,
  sessionXpSources,
  consumeRecentXpSource,
} from '../src/ui/xpInfoSheet.js';
import { EN, DE } from '../src/data/strings/v4-xp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const rowsById = (data) => Object.fromEntries(data.sources.map((row) => [row.id, row]));

test('G69: sheet assembles all 12 live XP amounts from their real constants', () => {
  const rows = rowsById(buildXpInfoData({ level: 1, xp: 0, achievements: { counters: {} } }, '2026-07-19'));
  assert.deepEqual(Object.keys(rows), [
    'minigame', 'quest', 'feed', 'wash', 'sleep', 'pet',
    'harvest', 'delivery', 'photo', 'sticker', 'collection', 'nougat',
  ]);

  assert.deepEqual(rows.minigame, {
    id: 'minigame',
    min: minigameXp(0),
    max: minigameXp(Number.MAX_SAFE_INTEGER),
  });
  assert.deepEqual(rows.quest, {
    id: 'quest',
    min: Math.min(...QUEST_POOL.map((quest) => quest.xp)),
    max: Math.max(...QUEST_POOL.map((quest) => quest.xp)),
  });
  assert.equal(rows.feed.amount, XP.FEED);
  assert.equal(rows.wash.amount, XP.FULL_WASH);
  assert.equal(rows.sleep.amount, XP.COMPLETED_SLEEP);
  assert.equal(rows.pet.amount, XP.PET);
  assert.equal(rows.pet.cap, XP.PET_DAILY_CAP);
  assert.equal(rows.harvest.amount, LEVELING.XP_HARVEST);
  assert.equal(rows.delivery.amount, LEVELING.XP_DELIVERY);
  assert.equal(rows.photo.amount, PHOTO.XP_PER_PHOTO);
  assert.equal(rows.photo.cap, PHOTO.XP_DAILY_CAP);
  assert.equal(rows.sticker.amount, LEVELING.XP_STICKER);
  assert.equal(rows.collection.amount, LEVELING.XP_SET_COMPLETE);
  assert.equal(rows.nougat.amount, NOUGAT.XP);
});

test('G69: every displayed row stays paired with the actual grant-site expression', () => {
  const sites = [
    ['src/systems/economy.js', /minigameXp\(paid\), 'minigame'/],
    ['src/systems/achievementsEngine.js', /r\.reward\.xp, 'quest'/],
    ['src/home/interactions.js', /XP\.FEED, 'feed'/],
    ['src/home/interactions.js', /XP\.FULL_WASH : 0, 'wash'/],
    ['src/systems/sleep.js', /XP\.COMPLETED_SLEEP, 'sleep'/],
    ['src/home/interactions.js', /gain\.xp, 'pet'/],
    ['src/systems/achievementsEngine.js', /harvestXp, 'harvest'/],
    ['src/systems/achievementsEngine.js', /deliveryXp, 'delivery'/],
    ['src/systems/achievementsEngine.js', /g\.xp, 'photo'/],
    ['src/systems/achievementsEngine.js', /LEVELING\.XP_STICKER, 'sticker'/],
    ['src/systems/achievementsEngine.js', /LEVELING\.XP_SET_COMPLETE, 'collection'/],
    ['src/systems/nougat.logic.js', /NOUGAT\.XP, 'nougat'/],
  ];
  for (const [file, expression] of sites) {
    assert.match(source(file), expression, `${file} must retain ${expression}`);
  }
});

test('G69: daily pet/photo counters are live and stale days display zero', () => {
  const state = {
    level: 7,
    xp: 123,
    achievements: {
      counters: {
        petsDay: '2026-07-19',
        petsToday: 17,
        photoXpDay: '2026-07-19',
        photoXpToday: 4,
      },
    },
  };
  let data = buildXpInfoData(state, '2026-07-19');
  let rows = rowsById(data);
  assert.equal(rows.pet.used, 17);
  assert.equal(rows.photo.used, 4);
  assert.equal(data.xp, 123);
  assert.equal(data.xpToNext, XP.BASE + XP.STEP * 6);

  data = buildXpInfoData(state, '2026-07-20');
  rows = rowsById(data);
  assert.equal(rows.pet.used, 0);
  assert.equal(rows.photo.used, 0);
});

test('G69: next unlock preview is correct at the L4/L9/L11 acceptance fixtures', () => {
  const fixtures = [
    [4, 5, 'minigame', 'mg.title.burgerBuild', 5],
    [9, 10, 'minigame', 'mg.title.trampoline', 10],
    [11, 12, 'minigame', 'mg.title.goobyWelt', 15],
  ];
  for (const [level, unlockLevel, kind, nameKey, recapLevel] of fixtures) {
    const data = buildXpInfoData({ level, xp: 0, achievements: { counters: {} } });
    assert.deepEqual(data.nextUnlock, { level: unlockLevel, kind, nameKey });
    assert.equal(data.recapLevel, recapLevel);
  }
});

test('G69: max level shows all content and recaps unlocked', () => {
  const maxed = buildXpInfoData({ level: 40, xp: 999, achievements: { counters: {} } });
  assert.equal(maxed.nextUnlock, null);
  assert.equal(maxed.recapLevel, null);
  assert.equal(maxed.xpToNext, 0);
  assert.equal(maxed.progress, 1);
});

test('G69: profile lifetime summary uses only exact persisted counters', () => {
  const state = {
    achievements: { counters: { feeds: 3, washes: 2, sleeps: 1, harvests: 4, deliveries: 2, nougatGlobs: 1 } },
    collections: {
      entries: { 'fish.sunnyCarp': 2, 'veggies.carrot': 1, 'fish.blueDace': 0 },
      claimedSets: { fish: 123, veggies: 0 },
    },
  };
  const totals = Object.fromEntries(knownLifetimeXpSources(state).map((row) => [row.id, row.amount]));
  assert.equal(totals.feed, 3 * XP.FEED);
  assert.equal(totals.wash, 2 * XP.FULL_WASH);
  assert.equal(totals.sleep, XP.COMPLETED_SLEEP);
  assert.equal(totals.harvest, 4 * LEVELING.XP_HARVEST);
  assert.equal(totals.delivery, 2 * LEVELING.XP_DELIVERY);
  assert.equal(totals.sticker, 2 * LEVELING.XP_STICKER);
  assert.equal(totals.collection, LEVELING.XP_SET_COMPLETE);
  assert.equal(totals.nougat, NOUGAT.XP);
  assert.equal(totals.quest, undefined);
  assert.equal(totals.minigame, undefined);
});

test('G69: session source tracker aggregates totals and supplies toast trigger source', () => {
  let listener = null;
  let removed = false;
  const store = {
    on(event, cb) {
      assert.equal(event, 'xpGranted');
      listener = cb;
      return () => { removed = true; };
    },
  };
  const stop = trackXpSources(store);
  listener({ amount: XP.FEED, source: 'feed' });
  listener({ amount: XP.FEED, source: 'feed' });
  listener({ amount: LEVELING.XP_HARVEST, source: 'harvest' });
  listener({ amount: 0, source: 'wash' });
  assert.deepEqual(sessionXpSources(), [
    { id: 'feed', amount: XP.FEED * 2 },
    { id: 'harvest', amount: LEVELING.XP_HARVEST },
  ]);
  assert.equal(consumeRecentXpSource(), 'harvest');
  assert.equal(consumeRecentXpSource(), null);
  stop();
  assert.equal(removed, true);
});

test('G69: EN/DE keys are complete and UI entry/toast wiring is marked', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(DE).sort());
  for (const id of [
    'minigame', 'quest', 'feed', 'wash', 'sleep', 'pet',
    'harvest', 'delivery', 'photo', 'sticker', 'collection', 'nougat',
  ]) {
    assert.equal(typeof EN[`xp.source.${id}`], 'string');
    assert.equal(typeof DE[`xp.source.${id}`], 'string');
  }

  const main = source('src/main.js');
  const hud = source('src/ui/hud.js');
  const profile = source('src/ui/profileScreen.js');
  assert.match(main, /registerXpInfoSheet\(\{ store, ui, audio \}\)/);
  assert.match(main, /consumeRecentXpSource\(\)/);
  assert.match(hud, /V4\/G69[\s\S]*?ui\.openPanel\('xpInfo'\)/);
  assert.match(hud, /dataset\.hud = 'xpHelp'/);
  assert.match(hud, /ring\.before\(xpHelp\)/);
  assert.match(profile, /data-g69="open"/);
  assert.match(profile, /ui\.openPanel\('xpInfo'\)/);
});
