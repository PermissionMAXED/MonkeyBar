// G3 — Gooby character API tests (§D2.4/§D2.5): emotion state machine pure
// logic (mood band → emotion, context override), clip registry completeness
// (all 14 ids), clip player semantics, and the §B purity rule for emotions.js
// (no three.js/DOM imports — it must run headlessly under node:test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  EMOTION_IDS,
  MOUTH_IDS,
  FACES,
  moodEmotion,
  statOverride,
  deriveEmotion,
  createEmotionMachine,
} from '../src/character/emotions.js';
import { CLIPS, CLIP_IDS, createClipPlayer, restPose } from '../src/character/goobyAnims.js';

// ---------------------------------------------------------------------------
// Emotion state machine (§D2.5)
// ---------------------------------------------------------------------------

test('mood bands map to default emotions (§C1 → §D2.5)', () => {
  assert.equal(moodEmotion(100), 'ecstatic');
  assert.equal(moodEmotion(80), 'ecstatic');
  assert.equal(moodEmotion(79.9), 'happy');
  assert.equal(moodEmotion(60), 'happy');
  assert.equal(moodEmotion(59.9), 'neutral');
  assert.equal(moodEmotion(40), 'neutral');
  assert.equal(moodEmotion(39.9), 'grumpy');
  assert.equal(moodEmotion(25), 'grumpy');
  assert.equal(moodEmotion(24.9), 'sad'); // miserable band → sad face
  assert.equal(moodEmotion(0), 'sad');
});

test('low-stat overrides: exhausted → sleepy, starving → hungry (§C1)', () => {
  assert.equal(statOverride({ energy: 15, hunger: 80 }), 'sleepy');
  assert.equal(statOverride({ energy: 15.1, hunger: 80 }), null);
  assert.equal(statOverride({ energy: 80, hunger: 9.9 }), 'hungry');
  assert.equal(statOverride({ energy: 80, hunger: 10 }), null);
  assert.equal(statOverride({ energy: 5, hunger: 5 }), 'sleepy'); // sleepy wins
  assert.equal(statOverride(null), null);
});

test('deriveEmotion: context > statOverride > moodEmotion', () => {
  assert.equal(deriveEmotion({ mood: 90 }), 'ecstatic');
  assert.equal(deriveEmotion({ mood: 90, stats: { energy: 10 } }), 'sleepy');
  assert.equal(deriveEmotion({ mood: 90, stats: { energy: 10 }, context: 'dizzy' }), 'dizzy');
  assert.equal(deriveEmotion({ mood: 10, context: 'happy' }), 'happy');
  assert.equal(deriveEmotion({}), 'happy'); // default mood 60
});

test('emotion machine: transitions, context override, change events', () => {
  const m = createEmotionMachine({ mood: 65 });
  assert.equal(m.get(), 'happy');

  /** @type {Array<[string, string]>} */
  const changes = [];
  const off = m.onChange((next, prev) => changes.push([next, prev]));

  assert.equal(m.setMood(85), 'ecstatic');
  assert.equal(m.setContext('dizzy'), 'dizzy'); // context wins over mood band
  assert.equal(m.getContext(), 'dizzy');
  assert.equal(m.setMood(10), 'dizzy'); // still overridden
  assert.equal(m.setContext(null), 'sad'); // released → miserable band
  assert.equal(m.setStats({ energy: 5 }), 'sleepy'); // stat override
  assert.deepEqual(changes, [
    ['ecstatic', 'happy'],
    ['dizzy', 'ecstatic'],
    ['sad', 'dizzy'],
    ['sleepy', 'sad'],
  ]);

  off();
  m.setStats(null);
  assert.equal(changes.length, 4); // unsubscribed

  assert.throws(() => m.setContext('nonsense'), /unknown context/);
});

test('FACES table: entry for all 8 emotions with valid mouth ids (§D2.5)', () => {
  assert.equal(EMOTION_IDS.length, 8);
  for (const id of EMOTION_IDS) {
    const def = FACES[id];
    assert.ok(def, `FACES missing '${id}'`);
    assert.ok(MOUTH_IDS.includes(def.mouth), `FACES.${id}.mouth '${def.mouth}' invalid`);
    assert.ok(def.lids >= 0 && def.lids <= 1.25, `FACES.${id}.lids out of range`);
  }
  assert.ok(FACES.ecstatic.shine2, 'ecstatic has shine ×2');
  assert.ok(FACES.hungry.drool, 'hungry shows drool');
  assert.ok(FACES.dizzy.spiral, 'dizzy shows spiral pupils');
  assert.ok(FACES.sleepy.yawnEverySec > 0, 'sleepy yawns');
  assert.notEqual(FACES.grumpy.earDroopL, FACES.grumpy.earDroopR, 'grumpy: one ear down');
});

// ---------------------------------------------------------------------------
// Clip registry (§D2.4 — all 14 programmatic clips)
// ---------------------------------------------------------------------------

const SPEC_CLIPS = [
  'idle', 'happyBounce', 'sadSlump', 'eat', 'sleep', 'wake', 'tickle',
  'pokeWobble', 'dizzy', 'dance', 'wave', 'jump', 'refuse', 'sitDrive',
];

test('clip registry has exactly the 14 §D2.4 clips', () => {
  assert.deepEqual([...CLIP_IDS].sort(), [...SPEC_CLIPS].sort());
  for (const id of SPEC_CLIPS) {
    const def = CLIPS[id];
    assert.ok(def.duration > 0, `${id}.duration`);
    assert.equal(typeof def.apply, 'function', `${id}.apply`);
  }
});

test('clip durations & loop modes match §D2.4', () => {
  assert.equal(CLIPS.idle.duration, 2.6);
  assert.equal(CLIPS.idle.loop, true);
  assert.equal(CLIPS.happyBounce.duration, 0.9);
  assert.equal(CLIPS.sadSlump.loop, 'hold');
  assert.equal(CLIPS.eat.duration, 1.3);
  assert.equal(CLIPS.sleep.duration, 2.2);
  assert.equal(CLIPS.sleep.loop, true);
  assert.equal(CLIPS.wake.duration, 1.2);
  assert.equal(CLIPS.tickle.duration, 0.5);
  assert.equal(CLIPS.pokeWobble.duration, 1.2);
  assert.ok(CLIPS.pokeWobble.overlay, 'pokeWobble overlays the main clip');
  assert.equal(CLIPS.dizzy.duration, 2.0);
  assert.equal(CLIPS.dance.duration, 1.2);
  assert.equal(CLIPS.dance.loop, true);
  assert.equal(CLIPS.wave.duration, 1.0);
  assert.equal(CLIPS.jump.duration, 0.6);
  assert.equal(CLIPS.refuse.duration, 0.7);
  assert.equal(CLIPS.sitDrive.loop, 'hold');
});

test('clip player: one-shot resolves, loop wraps, hold clamps, overlay coexists', async () => {
  const player = createClipPlayer();

  // one-shot resolves after duration
  let jumpDone = false;
  const jumpP = player.play('jump').then(() => (jumpDone = true));
  const pose = restPose();
  for (let i = 0; i < 8; i += 1) player.update(0.1, restPose());
  await jumpP;
  assert.ok(jumpDone, 'jump resolved');
  assert.ok(!player.isPlaying('jump'));

  // loop keeps running past duration; overlay pokeWobble coexists with it
  player.play('idle');
  player.play('pokeWobble', { dir: { x: 1, z: 0 } });
  assert.deepEqual(player.activeIds().sort(), ['idle', 'pokeWobble']);
  for (let i = 0; i < 40; i += 1) player.update(0.1, restPose());
  assert.ok(player.isPlaying('idle'), 'idle still looping after 4 s');
  assert.ok(!player.isPlaying('pokeWobble'), 'overlay one-shot ended');

  // a new main clip replaces the previous main clip
  player.play('dance');
  assert.ok(!player.isPlaying('idle'));
  assert.ok(player.isPlaying('dance'));

  // hold clamps at the end pose and stays active until stop()
  player.play('sadSlump');
  for (let i = 0; i < 30; i += 1) player.update(0.1, pose);
  assert.ok(player.isPlaying('sadSlump'), 'hold clip stays active');
  const held = restPose();
  player.update(0, held);
  assert.ok(held.headPitch > 0.2, 'slump holds the final head pitch');
  player.stop('sadSlump');
  assert.ok(!player.isPlaying('sadSlump'));
});

test('idle breathes: scaleY oscillates within 1..1.03 (§D2.4)', () => {
  let min = Infinity;
  let max = -Infinity;
  const player = createClipPlayer();
  player.play('idle');
  for (let i = 0; i < 260; i += 1) {
    const pose = restPose();
    player.update(0.01, pose);
    min = Math.min(min, pose.scaleY);
    max = Math.max(max, pose.scaleY);
  }
  assert.ok(min >= 0.999 && max <= 1.0301, `breathe range [${min}, ${max}]`);
  assert.ok(max - min > 0.02, 'breathing actually moves');
});

test('sleep clip emits a zzz event every 2.5 s (§D2.4)', () => {
  const player = createClipPlayer();
  player.play('sleep');
  let zzz = 0;
  for (let i = 0; i < 60; i += 1) {
    player.update(0.1, restPose(), { event: (n) => n === 'zzz' && (zzz += 1) });
  }
  assert.equal(zzz, 2, '2 zzz puffs in 6 s'); // at 2.5 s and 5.0 s
});

// ---------------------------------------------------------------------------
// Purity (§B rule): emotions.js and goobyAnims.js run headlessly
// ---------------------------------------------------------------------------

for (const rel of ['../src/character/emotions.js', '../src/character/goobyAnims.js']) {
  test(`${rel.split('/').pop()} imports no three.js/DOM`, () => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specifiers) {
      assert.ok(spec.startsWith('.'), `only relative imports allowed, found '${spec}'`);
      assert.ok(!/three/i.test(spec), `three.js import found: '${spec}'`);
    }
    for (const globalRef of ['document.', 'window.', 'navigator.', 'localStorage']) {
      assert.ok(!src.includes(globalRef), `DOM global '${globalRef}' referenced`);
    }
  });
}
