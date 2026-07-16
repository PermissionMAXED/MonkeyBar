// Onboarding (§C8.1, agent G14): the pure step machine (advance/skip/resume/
// guards), the progress predicates + snapshot projection, and the §D6 audio
// coverage contract — every audio.play('<id>') literal in src/ must be mapped
// in sfxMap.js (zero unmapped ids), and every mapped Kenney sample key must
// resolve to a real ogg on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ONBOARDING_STEPS,
  createOnboardingMachine,
  snapshotProgress,
  stepSatisfied,
} from '../src/ui/onboarding.js';
import { ONBOARDING } from '../src/data/constants.js';
import { SFX_MAP, getSfxDef, allSfxIds, allSampleKeys } from '../src/audio/sfxMap.js';
import { VOICE_RECIPES } from '../src/audio/goobyVoice.js';
import { defaultState } from '../src/core/save.js';
import { EN, DE } from '../src/data/strings.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ----------------------------------------------------------------- machine

test('machine: 8 steps in the §C8.1 order', () => {
  assert.equal(ONBOARDING_STEPS.length, 8);
  assert.deepEqual([...ONBOARDING_STEPS], [
    'welcome', 'pet', 'feed', 'roomHint', 'wash', 'hudTour', 'minigame', 'shopHint',
  ]);
});

test('machine: fresh save starts at step 1 and advances through all steps', () => {
  const m = createOnboardingMachine(defaultState().onboarding);
  assert.equal(m.current(), 'welcome');
  assert.equal(m.index(), 0);
  assert.equal(m.isDone(), false);
  const seen = [m.current()];
  for (;;) {
    const next = m.advance();
    if (next == null) break;
    seen.push(next);
  }
  assert.deepEqual(seen, [...ONBOARDING_STEPS]);
  assert.equal(m.isDone(), true);
  assert.equal(m.current(), null);
  assert.equal(m.advance(), null); // advancing past done stays done
  assert.deepEqual(m.serialize(), { step: 8, done: true });
});

test('machine: resumes from the saved step (§C8.1 resumable)', () => {
  const m = createOnboardingMachine({ step: 4, done: false });
  assert.equal(m.current(), 'wash');
  assert.equal(m.index(), 4);
  m.advance();
  assert.equal(m.current(), 'hudTour');
  assert.deepEqual(m.serialize(), { step: 5, done: false });
});

test('machine: done flag short-circuits returning users', () => {
  const m = createOnboardingMachine({ step: 2, done: true });
  assert.equal(m.isDone(), true);
  assert.equal(m.current(), null);
  assert.equal(m.skippable(), false);
  assert.equal(m.skip(), false);
});

test('machine: out-of-range saved steps clamp safely', () => {
  assert.equal(createOnboardingMachine({ step: 99, done: false }).isDone(), true);
  assert.equal(createOnboardingMachine({ step: -3, done: false }).current(), 'welcome');
  assert.equal(createOnboardingMachine({ step: Number.NaN, done: false }).current(), 'welcome');
  assert.equal(createOnboardingMachine().current(), 'welcome');
});

test('machine: skip guarded until after step 3 (§C8.1 forced pet/feed)', () => {
  const m = createOnboardingMachine({ step: 0, done: false });
  // steps 1..SKIPPABLE_AFTER_STEP: no skipping
  for (let stepNo = 1; stepNo <= ONBOARDING.SKIPPABLE_AFTER_STEP; stepNo += 1) {
    assert.equal(m.skippable(), false, `step ${stepNo} must not be skippable`);
    assert.equal(m.skip(), false);
    assert.equal(m.isDone(), false);
    m.advance();
  }
  // step 4 onward: skip allowed and finishes the tutorial
  assert.equal(m.current(), 'roomHint');
  assert.equal(m.skippable(), true);
  assert.equal(m.skip(), true);
  assert.equal(m.isDone(), true);
  assert.equal(m.serialize().done, true);
});

// ----------------------------------------------------------- progress logic

test('snapshotProgress projects counters, plays and room', () => {
  const state = defaultState();
  state.achievements.counters.petsToday = 2;
  state.achievements.counters.tickles = 1;
  state.achievements.counters.feeds = 4;
  state.achievements.counters.washes = 3;
  state.minigames.plays.carrotCatch = 5;
  const snap = snapshotProgress(state, 'kitchen');
  assert.deepEqual(snap, { strokes: 3, feeds: 4, washes: 3, catchPlays: 5, room: 'kitchen' });
  // resilient to missing slices
  assert.deepEqual(snapshotProgress({}, null), { strokes: 0, feeds: 0, washes: 0, catchPlays: 0, room: null });
});

test('stepSatisfied: action steps complete on counter deltas', () => {
  const base = snapshotProgress(defaultState(), 'living');
  const after = { ...base };
  assert.equal(stepSatisfied('pet', base, after), false);
  after.strokes = 1;
  assert.equal(stepSatisfied('pet', base, after), true);
  assert.equal(stepSatisfied('feed', base, after), false);
  after.feeds = 1;
  assert.equal(stepSatisfied('feed', base, after), true);
  assert.equal(stepSatisfied('wash', base, after), false);
  after.washes = 1;
  assert.equal(stepSatisfied('wash', base, after), true);
  assert.equal(stepSatisfied('minigame', base, after), false);
  after.catchPlays = 1;
  assert.equal(stepSatisfied('minigame', base, after), true);
});

test('stepSatisfied: roomHint completes on reaching the bathroom', () => {
  const base = snapshotProgress(defaultState(), 'living');
  assert.equal(stepSatisfied('roomHint', base, { ...base, room: 'living' }), false);
  assert.equal(stepSatisfied('roomHint', base, { ...base, room: 'bathroom' }), true);
});

test('stepSatisfied: button-driven steps never auto-complete', () => {
  const base = snapshotProgress(defaultState(), 'bathroom');
  const busy = { strokes: 9, feeds: 9, washes: 9, catchPlays: 9, room: 'bathroom' };
  for (const id of ['welcome', 'hudTour', 'shopHint']) {
    assert.equal(stepSatisfied(id, base, busy), false, `${id} must be button-driven`);
  }
});

test('onboarding strings exist in EN and DE (§A)', () => {
  const needed = [
    'ob.welcome.title', 'ob.welcome.body', 'ob.continue', 'ob.next', 'ob.skip',
    'ob.pet.title', 'ob.pet.body', 'ob.feed.title', 'ob.feed.body',
    'ob.room.title', 'ob.room.body', 'ob.wash.title', 'ob.wash.body',
    'ob.hud.title', 'ob.hud.p1', 'ob.hud.p2', 'ob.hud.p3',
    'ob.game.title', 'ob.game.body', 'ob.game.play',
    'ob.shop.title', 'ob.shop.body', 'ob.done',
    'settings.sfx', 'settings.music', 'settings.haptics',
  ];
  for (const key of needed) {
    assert.equal(typeof EN[key], 'string', `EN missing '${key}'`);
    assert.equal(typeof DE[key], 'string', `DE missing '${key}'`);
  }
  assert.equal(DE['ob.welcome.title'], 'Das ist Gooby!'); // §C8.1 verbatim
});

// ------------------------------------------------- §D6 sfx coverage contract

/** Every audio.play('<literal>') id used anywhere in src/. */
function collectUsedSfxIds() {
  const ids = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/audio(?:\??\.)play\(\s*'([^']+)'/g)) ids.add(m[1]);
        // audioOnce(s, '<id>') — interactions.js helper routes into audio.play
        for (const m of src.matchAll(/audioOnce\(\s*\w+,\s*'([^']+)'/g)) ids.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return ids;
}

test('sfxMap: ZERO unmapped audio.play ids across src/ (§D6)', () => {
  const used = collectUsedSfxIds();
  assert.ok(used.size >= 70, `expected a rich id set, found ${used.size}`);
  const unmapped = [...used].filter((id) => !getSfxDef(id));
  assert.deepEqual(unmapped, [], `unmapped sfx ids: ${unmapped.join(', ')}`);
});

test('sfxMap: definitions are well-formed and voice recipes exist', () => {
  for (const [id, def] of Object.entries(SFX_MAP)) {
    assert.ok(['sample', 'synth', 'voice'].includes(def.kind), `${id}: bad kind`);
    if (def.kind === 'sample') {
      assert.ok(Array.isArray(def.keys) && def.keys.length > 0, `${id}: empty key set`);
    }
    if (def.kind === 'voice') {
      assert.equal(typeof VOICE_RECIPES[def.name], 'function', `${id}: unknown voice '${def.name}'`);
    }
    if (def.volume != null) {
      assert.ok(def.volume > 0 && def.volume <= 1, `${id}: volume out of range`);
    }
    if (def.haptic != null) {
      assert.ok(['light', 'medium'].includes(def.haptic), `${id}: bad haptic '${def.haptic}'`);
    }
  }
  assert.ok(allSfxIds().length >= 80, 'map should stay rich');
});

test('sfxMap: every Kenney sample key resolves to an ogg on disk', () => {
  const missing = [];
  for (const key of allSampleKeys()) {
    const [pack, file] = key.split('/');
    const p = path.join(ROOT, 'public', 'assets', 'kenney', pack, 'audio', `${file}.ogg`);
    if (!fs.existsSync(p)) missing.push(key);
  }
  assert.deepEqual(missing, [], `missing ogg files: ${missing.join(', ')}`);
});

test('gooby voice ids cover the §D6 set (squeak/giggle/snore/yawn…)', () => {
  for (const id of ['gooby.squeak', 'gooby.giggle', 'gooby.snore', 'gooby.yawn', 'gooby.purr']) {
    const def = getSfxDef(id);
    assert.ok(def && def.kind === 'voice', `${id} must be a voice def`);
  }
  assert.equal(getSfxDef('gooby.snore').loop, true, 'snore must loop until stop()');
});
