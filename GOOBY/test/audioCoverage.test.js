// Audio coverage — V3/G32 (PLAN3 §A2 real-audio coverage bullets + §E G32):
//   • 100 % of `ui.*` and `coin.*` ids are sample-backed (real files — no
//     synth UI bleeps left after the §C3.1/§D3.5 sweep).
//   • ≥ 65 % of ALL non-voice, non-loop sfx ids are sample-backed (baseline
//     before 3.0: 61/129 ≈ 47 %). The exact ratio is printed for the report.
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

import { SFX_MAP, allSampleKeys, UI_INTERACTION_SOUNDS, uiSoundFor } from '../src/audio/sfxMap.js';
import { MEDLEY, MEDLEY_CONTEXTS } from '../src/audio/musicDirector.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOUDNESS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src', 'audio', 'loudness.json'), 'utf8')
);

/** '<pack>/<file>' → committed ogg path (mirrors core/assets.getAudioUrl). */
const oggPath = (key) => {
  const [pack, file] = key.split('/');
  return path.join(ROOT, 'public', 'assets', 'kenney', pack, 'audio', `${file}.ogg`);
};

// --------------------------------------------------------- §A2 coverage floors

test('§A2: 100% of ui.* and coin.* ids are sample-backed (no synth UI bleeps)', () => {
  const offenders = [];
  for (const [id, def] of Object.entries(SFX_MAP)) {
    if (!id.startsWith('ui.') && !id.startsWith('coin.')) continue;
    if (def.kind !== 'sample') offenders.push(`${id} (${def.kind}:${def.name})`);
  }
  assert.deepEqual(offenders, [], `synth ui/coin ids left: ${offenders.join(', ')}`);
});

test('§A2: ≥65% of all non-voice/non-loop ids are sample-backed', () => {
  let eligible = 0;
  let sampled = 0;
  for (const def of Object.values(SFX_MAP)) {
    if (def.kind === 'voice' || def.loop) continue; // exempt per §A2
    eligible += 1;
    if (def.kind === 'sample') sampled += 1;
  }
  const pct = (100 * sampled) / eligible;
  // The exact ratio feeds the G32 report + CDP evidence (§E verification ⑥).
  console.info(`[audioCoverage] sample-backed: ${sampled}/${eligible} non-voice/non-loop ids = ${pct.toFixed(1)}%`);
  assert.ok(eligible >= 120, `map should stay rich (${eligible} eligible ids)`);
  assert.ok(pct >= 65, `§A2 floor: ${pct.toFixed(1)}% < 65% (${sampled}/${eligible})`);
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
    'eat.chomp': 0.5, 'crash': 0.6, 'mole.bonk': 0.6, 'photo.shutter': 0.6,
    'gooby.snore': 0.55, 'hopper.crash': 0.6, 'jingle.levelUp': 0.65,
    'jingle.daily': 0.65, 'golf.ace': 0.6, 'delivery.drop': 0.6,
    'tramp.butt': 0.55, 'dance.fever': 0.55, 'ui.go': 0.6,
  };
  for (const [id, vol] of Object.entries(pins)) {
    assert.equal(SFX_MAP[id]?.volume, vol, `§C3.5 pin: ${id} → ${vol}`);
  }
});

// --------------------------------------------------------- committed-file gates

test('every sample key resolves to a committed ogg (zero dangling ids)', () => {
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
