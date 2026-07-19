// Audio coverage — V4/G78 (PLAN4 §C-SYS1.9 exact-set contract):
//   • exactly the 9 frozen non-loop ids may remain synth-backed.
//   • exactly the 3 seamless loop ids may remain synth-backed; Gooby's 15
//     identity-voice ids remain in goobyVoice.js.
//   • every other id is sample-backed (including all 46 replacement-table ids).
//   • every sample key in SFX_MAP has a `src/audio/loudness.json` entry
//     (§B2.5 — the normalization pass measured every mapped file).
//   • the §C3.3 medley composition tables reference ONLY committed jingle
//     files, and every referenced file has a loudness entry too.
//   • every id resolves to a committed file or an implemented synth/voice
//     recipe — nothing dangles (complements test/onboarding.test.js's
//     unmapped-play()-id gate and test/audioV2.test.js's recipe scan).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SFX_MAP, allSampleKeys, getSfxDef, UI_INTERACTION_SOUNDS, uiSoundFor,
} from '../src/audio/sfxMap.js';
import { MEDLEY, MEDLEY_CONTEXTS } from '../src/audio/musicDirector.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOUDNESS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src', 'audio', 'loudness.json'), 'utf8')
);

/** '<pack>/<file>' → committed ogg path (mirrors core/assets.getAudioUrl). */
const oggPath = (key) => {
  const [pack, file] = key.split('/');
  if (pack === 'itch-sfx') {
    return path.join(ROOT, 'public', 'assets', 'itch', pack, `${file}.ogg`);
  }
  return path.join(ROOT, 'public', 'assets', 'kenney', pack, 'audio', `${file}.ogg`);
};

const FROZEN_NON_LOOP_SYNTH_IDS = Object.freeze([
  'garden.water',
  'goalie.cheer',
  'harbor.horn',
  'pipe.fill',
  'rocket.pickup',
  'toilet.flush',
  'tramp.boost',
  'tramp.bounce',
  'wash.splash',
].sort());

const FROZEN_SYNTH_LOOP_IDS = Object.freeze([
  'ambience.birdsong',
  'ambience.rain',
  'rocket.thrust',
].sort());

const FROZEN_VOICE_IDS = Object.freeze([
  'gooby.brrr',
  'gooby.gasp',
  'gooby.giggle',
  'gooby.hiccup',
  'gooby.purr',
  'gooby.refuse',
  'gooby.sigh',
  'gooby.sniff',
  'gooby.sniffle',
  'gooby.snore',
  'gooby.squeak',
  'gooby.squeakDizzy',
  'gooby.squeakHappy',
  'gooby.yawn',
  'health.sneeze',
].sort());

const REPLACED_IDS = Object.freeze([
  'album.claim', 'ball.throw', 'basket.swish', 'cake.splat', 'chop.junk',
  'chop.lob', 'chop.slice', 'dance.fever', 'dance.good', 'dance.miss',
  'dance.perfect', 'delivery.drop', 'fish.cast', 'garden.fertilize',
  'garden.harvest', 'garden.plant', 'goalie.dive', 'goalie.super', 'golf.bump',
  'golf.sink', 'harbor.boost', 'hop.bell', 'hopper.gold', 'hopper.lane',
  'hopper.shield', 'hunt.boo', 'hunt.powerup', 'mole.whiff', 'pancake.drop',
  'pancake.slice', 'pancake.topping', 'photo.shutter', 'pipe.connect',
  'racer.block', 'racer.boost', 'racer.shield', 'rocket.wind', 'says.pad1',
  'says.pad2', 'says.pad3', 'says.pad4', 'sticker.get', 'throw.whoosh', 'tow',
  'vet.cure', 'whoosh',
].sort());

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
        for (const m of src.matchAll(/audioOnce\(\s*\w+,\s*'([^']+)'/g)) ids.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return ids;
}

// ----------------------------------------------- §C-SYS1.9 exact-set gates

test('§C-SYS1.9: EXACTLY the 9 frozen non-loop ids remain synthesized', () => {
  const actual = Object.entries(SFX_MAP)
    .filter(([, def]) => def.kind === 'synth' && !def.loop)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(actual, FROZEN_NON_LOOP_SYNTH_IDS);
});

test('§C-SYS1.9: voice and synth-loop exemption classes are exact', () => {
  const voices = Object.entries(SFX_MAP)
    .filter(([, def]) => def.kind === 'voice')
    .map(([id]) => id)
    .sort();
  const loops = Object.entries(SFX_MAP)
    .filter(([, def]) => def.kind === 'synth' && def.loop)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(voices, FROZEN_VOICE_IDS, 'only Gooby identity voices are exempt');
  assert.deepEqual(loops, FROZEN_SYNTH_LOOP_IDS, 'only the 3 unsourceable loop recipes are exempt');
});

test('§C-SYS1.9: all 46 table ids and every other eligible id are samples', () => {
  assert.equal(REPLACED_IDS.length, 46, 'replacement table count stays pinned');
  for (const id of REPLACED_IDS) {
    assert.equal(getSfxDef(id)?.kind, 'sample', `${id}: replacement table id must use a real file`);
  }
  const exempt = new Set([...FROZEN_NON_LOOP_SYNTH_IDS, ...FROZEN_SYNTH_LOOP_IDS, ...FROZEN_VOICE_IDS]);
  const offenders = Object.entries(SFX_MAP)
    .filter(([id, def]) => !exempt.has(id) && def.kind !== 'sample')
    .map(([id, def]) => `${id} (${def.kind}:${def.name})`);
  assert.deepEqual(offenders, [], `non-sample ids outside exact exemptions: ${offenders.join(', ')}`);
});

test('§C-SYS1.9: says pads share one real sample at C-D-E-G playback rates', () => {
  const pads = ['says.pad1', 'says.pad2', 'says.pad3', 'says.pad4'].map(getSfxDef);
  assert.deepEqual(pads.map((def) => def.keys), Array(4).fill(['itch-sfx/cursor_style_4']));
  assert.deepEqual(pads.map((def) => def.rate), [1, 1.125, 1.25, 1.5]);
});

test('§C-SYS1.9: zero literal audio.play ids are unmapped', () => {
  const unmapped = [...collectUsedSfxIds()].filter((id) => !getSfxDef(id));
  assert.deepEqual(unmapped, [], `unmapped sfx ids: ${unmapped.join(', ')}`);
});

// --------------------------------------------------------- §B2.5 loudness pass

test('§B2.5: every mapped sample key has a loudness.json entry', () => {
  const missing = allSampleKeys().filter((key) => typeof LOUDNESS[key] !== 'number');
  assert.deepEqual(missing, [], `keys without a loudness measurement: ${missing.join(', ')}`);
});

test('§B2.5: loudness entries are sane dBFS means', () => {
  assert.ok(Object.keys(LOUDNESS).length >= 250, 'the sweep measured the committed library');
  for (const [key, db] of Object.entries(LOUDNESS)) {
    assert.ok(Number.isFinite(db) && db < 0 && db > -70, `${key}: implausible mean ${db} dBFS`);
  }
});

test('§C3.5: per-id volumes are normalized multipliers in (0, 1]', () => {
  for (const [id, def] of Object.entries(SFX_MAP)) {
    if (def.volume == null) continue;
    assert.ok(def.volume > 0 && def.volume <= 1, `${id}: volume ${def.volume} out of range`);
  }
  // the §C3.5 offender pins (final effective volumes, verbatim)
  const pins = {
    'eat.chomp': 0.5, 'crash': 0.6, 'mole.bonk': 0.6, 'photo.shutter': 0.7,
    'gooby.snore': 0.55, 'hopper.crash': 0.6, 'jingle.levelUp': 0.65,
    'jingle.daily': 0.65, 'golf.ace': 0.6, 'delivery.drop': 0.6,
    'tramp.butt': 0.55, 'dance.fever': 0.55, 'ui.go': 0.6,
  };
  for (const [id, vol] of Object.entries(pins)) {
    assert.equal(SFX_MAP[id]?.volume, vol, `§C3.5 pin: ${id} → ${vol}`);
  }
});

// --------------------------------------------------------- committed-file gates

test('§C-SYS1.9: every sample key resolves to a committed ogg (zero dangling ids)', () => {
  const missing = allSampleKeys().filter((key) => !fs.existsSync(oggPath(key)));
  assert.deepEqual(missing, [], `missing committed files: ${missing.join(', ')}`);
});

test('§C3.3: medley tables reference only committed jingles (with loudness entries)', () => {
  assert.deepEqual(MEDLEY_CONTEXTS, ['home', 'garden', 'arcade', 'city', 'shop']);
  for (const ctxId of MEDLEY_CONTEXTS) {
    const keys = MEDLEY[ctxId].bars.filter(Boolean);
    assert.ok(keys.length >= 8, `${ctxId}: a real composition (${keys.length} jingle bars)`);
    for (const key of keys) {
      assert.match(key, /^music-jingles\/jingles_(NES|HIT|PIZZI|SAX|STEEL)\d{2}$/, `${ctxId}: '${key}' family`);
      assert.ok(fs.existsSync(oggPath(key)), `${ctxId}: '${key}' not committed`);
      assert.ok(typeof LOUDNESS[key] === 'number', `${ctxId}: '${key}' unmeasured`);
    }
  }
  // §C3.3 stingers + §C3.4 accent are committed too
  for (const key of ['jingles_HIT15', 'jingles_HIT10', 'jingles_HIT08', 'jingles_HIT00']) {
    assert.ok(fs.existsSync(oggPath(`music-jingles/${key}`)), `${key} not committed`);
  }
});

// ------------------------------- V3/FIX-B (E19): UI-interaction vocabulary

test('V3/FIX-B (E19): every UI-interaction contract id is mapped + sample-backed', () => {
  const expected = {
    tap: 'ui.tap',
    open: 'ui.open',
    close: 'ui.close',
    back: 'ui.close',
    pick: 'ui.pick',
    tab: 'ui.tabSwitch',
    toggleOn: 'ui.toggleOn',
    toggleOff: 'ui.toggleOff',
    slider: 'ui.slider',
    confirm: 'ui.confirmBig',
    buy: 'coin.spend',
    claim: 'quest.claim',
    stepper: 'ui.count',
    error: 'ui.error',
  };
  assert.deepEqual({ ...UI_INTERACTION_SOUNDS }, expected, 'the contract table is pinned');
  for (const [interaction, id] of Object.entries(UI_INTERACTION_SOUNDS)) {
    const def = SFX_MAP[id];
    assert.ok(def, `contract '${interaction}' → '${id}' must be mapped`);
    assert.equal(def.kind, 'sample', `'${id}' must be real-sample-backed`);
  }
  assert.equal(uiSoundFor('confirm'), 'ui.confirmBig');
  assert.equal(uiSoundFor('nonsense'), 'ui.tap', 'unknown types fall back to ui.tap');
});

test('V3/FIX-B (E19): vocabulary aliases fire the SAME samples as their canonical ids', () => {
  const aliases = {
    'ui.tab': 'ui.tabSwitch',
    'ui.confirm': 'ui.confirmBig',
    'ui.back': 'ui.close',
    'ui.toggle': 'ui.toggleOn',
    'ui.buy': 'coin.spend',
    'ui.claim': 'quest.claim',
  };
  for (const [alias, canonical] of Object.entries(aliases)) {
    assert.ok(SFX_MAP[alias], `'${alias}' mapped`);
    assert.deepEqual(SFX_MAP[alias].keys, SFX_MAP[canonical].keys, `'${alias}' keys = '${canonical}' keys`);
    assert.equal(SFX_MAP[alias].volume, SFX_MAP[canonical].volume, `'${alias}' volume = '${canonical}' volume`);
  }
});

test('V3/FIX-B (E19 P2): ui.confirmBig trimmed under the −6 dBFS peak bar', () => {
  // E19 measured click-a peaks of −5.9 dBFS at volume 0.9 (default sliders) —
  // 0.75 lands the worst frame ≈ −7.5 dBFS with margin.
  assert.equal(SFX_MAP['ui.confirmBig'].volume, 0.75);
  assert.equal(SFX_MAP['ui.confirm'].volume, 0.75);
});
