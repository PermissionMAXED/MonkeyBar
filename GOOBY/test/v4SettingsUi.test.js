// V4/G58 — settings IA + codes UI + dev-panel 2.0 pure contracts
// (PLAN4 §C-SYS12.1, §C-SYS5.2/5.3, §C-SYS6 card 18, PLAN4-GAMES §G3.3).
// Node-only: pure logic + string tables + static source seams — the DOM
// renderers are covered by the CDP proof (see the G58 report).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EN as SET_EN, DE as SET_DE } from '../src/data/strings/v4-settings.js';
import { EN as CODES_EN, DE as CODES_DE } from '../src/data/strings/v4-codes.js';
import { EN as DEV_EN, DE as DEV_DE } from '../src/data/strings/v4-dev.js';
import { EN as CTRL_EN, DE as CTRL_DE } from '../src/data/strings/v4-controls.js';
import {
  HARNESS_PARAM_GROUPS,
  allHarnessParams,
  JUMP_SCENES,
  JUMP_SCREENS,
  JUMP_PANELS,
} from '../src/data/harnessParams.js';
import {
  SETTINGS_MAIN_ROW_IDS,
  mainRows,
  normalizeCodeInput,
  formatMmSs,
  lockRemainingSec,
  buffRemainingMs,
  redeemedRows,
  createWrongAttemptWindow,
  formatLedgerRow,
} from '../src/ui/settingsIa.logic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// String tables (§E0.1-8: always EN + DE, same key sets, no empty values)
// ---------------------------------------------------------------------------

const TABLES = [
  ['v4-settings', SET_EN, SET_DE],
  ['v4-codes', CODES_EN, CODES_DE],
  ['v4-dev', DEV_EN, DEV_DE],
  ['v4-controls', CTRL_EN, CTRL_DE],
];

for (const [name, en, de] of TABLES) {
  test(`${name}: EN and DE key sets match exactly and are non-empty`, () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
    assert.ok(Object.keys(en).length > 0);
    for (const key of Object.keys(en)) {
      assert.ok(String(en[key]).trim(), `empty EN ${key}`);
      assert.ok(String(de[key]).trim(), `empty DE ${key}`);
    }
  });
}

test('no key is defined in more than one G58 string module', () => {
  const seen = new Map();
  for (const [name, en] of TABLES) {
    for (const key of Object.keys(en)) {
      assert.ok(!seen.has(key), `${key} in both ${seen.get(key)} and ${name}`);
      seen.set(key, name);
    }
  }
});

test('§C-SYS5.2/5.3 + §C-SYS8.1/8.2 + §G3.3 exact plan copy is verbatim', () => {
  assert.equal(CODES_DE['codes.wrong'], 'Hmm, das Wort kennt Gooby nicht');
  assert.equal(CODES_EN['codes.wrong'], "Hmm, Gooby doesn't know that word");
  assert.equal(CODES_DE['codes.already'], 'Schon eingelöst! 😉');
  assert.equal(CODES_DE['codes.toast.updateLiebe'], 'Doppelte Münzen für 10 Minuten! 💛');
  assert.equal(CODES_DE['codes.toast.herzGooby'], 'Gooby hat dich auch lieb! 💗');
  assert.equal(SET_DE['settings.gyro.sub'], 'Bewege dein Handy — schau tiefer ins Zimmer');
  assert.equal(SET_EN['settings.gyro.sub'], 'Move your phone — peek deeper into the room');
  assert.equal(CTRL_DE['settings.controls.title'], 'Steuerung');
  assert.equal(CTRL_DE['settings.controls.invertX'], 'Steuerung invertieren (links/rechts)');
  assert.equal(CTRL_EN['settings.controls.invertY'], 'Invert controls (up/down)');
  assert.equal(CTRL_DE['settings.controls.hint'], 'Gilt in Steuer-Spielen');
});

test('every static G58-prefixed key used by the UI modules is defined', () => {
  const merged = { ...SET_EN, ...CODES_EN, ...DEV_EN, ...CTRL_EN };
  const OWNED = [
    'settings.row.', 'settings.hint.', 'settings.sub.', 'settings.tracks.',
    'settings.radio.missing', 'settings.gyro', 'settings.controls.',
    'codes.', 'dev.ledger', 'dev.codes', 'dev.modifier', 'dev.recap',
    'dev.radio', 'dev.jump', 'dev.cheat',
  ];
  const files = [
    'src/ui/settingsScreen.js',
    'src/ui/codesScreen.js',
    'src/ui/devPanel.js',
  ];
  for (const rel of files) {
    const src = source(rel);
    for (const m of src.matchAll(/\btx?\(\s*'([a-z0-9.]+)'/gi)) {
      const key = m[1];
      if (!OWNED.some((p) => key.startsWith(p))) continue;
      assert.ok(key in merged, `${rel} uses undefined key '${key}'`);
    }
  }
});

// ---------------------------------------------------------------------------
// §C-SYS12.1 main-list IA
// ---------------------------------------------------------------------------

test('§C-SYS12.1: binding 8-row order', () => {
  assert.deepEqual([...SETTINGS_MAIN_ROW_IDS], [
    'language', 'notifications', 'display', 'audio', 'radio', 'codes',
    'credits', 'dev',
  ]);
});

test('mainRows: credits/dev rows are conditional, order preserved', () => {
  assert.deepEqual(mainRows(), [
    'language', 'notifications', 'display', 'audio', 'radio', 'codes',
  ]);
  assert.deepEqual(mainRows({ devUnlocked: true }).at(-1), 'dev');
  assert.deepEqual(mainRows({ creditsAvailable: true }).at(-1), 'credits');
  const all = mainRows({ devUnlocked: true, creditsAvailable: true });
  assert.equal(all.length, 8);
  assert.deepEqual(all, [...SETTINGS_MAIN_ROW_IDS]);
});

// ---------------------------------------------------------------------------
// §C-SYS5.3 codes input handling (pure half)
// ---------------------------------------------------------------------------

test('normalizeCodeInput: trim → lowercase → strip ALL whitespace', () => {
  assert.equal(normalizeCodeInput('UpdateLiebe'), 'updateliebe');
  assert.equal(normalizeCodeInput('  Update Liebe  '), 'updateliebe');
  assert.equal(normalizeCodeInput('ICH  LIE3B\tDICH'), 'ichlie3bdich');
  assert.equal(normalizeCodeInput('update\nliebe'), 'updateliebe');
  assert.equal(normalizeCodeInput(''), '');
  assert.equal(normalizeCodeInput('   '), '');
  assert.equal(normalizeCodeInput(null), '');
  assert.equal(normalizeCodeInput(undefined), '');
  assert.equal(normalizeCodeInput(42), '42');
});

test('formatMmSs: §C-SYS5.2 mm:ss (ceil, clamped at 0)', () => {
  assert.equal(formatMmSs(600000), '10:00');
  assert.equal(formatMmSs(599001), '10:00'); // ceil to the next full second
  assert.equal(formatMmSs(59000), '0:59');
  assert.equal(formatMmSs(1000), '0:01');
  assert.equal(formatMmSs(1), '0:01');
  assert.equal(formatMmSs(0), '0:00');
  assert.equal(formatMmSs(-5000), '0:00');
  assert.equal(formatMmSs(NaN), '0:00');
});

test('lockRemainingSec: whole seconds, 0 for past/garbage', () => {
  const now = 1_000_000;
  assert.equal(lockRemainingSec(now + 30000, now), 30);
  assert.equal(lockRemainingSec(now + 1, now), 1);
  assert.equal(lockRemainingSec(now, now), 0);
  assert.equal(lockRemainingSec(now - 1, now), 0);
  assert.equal(lockRemainingSec('bogus', now), 0);
  assert.equal(lockRemainingSec(undefined, now), 0);
});

test('buffRemainingMs: doubleCoinsUntil expiry math', () => {
  const now = 5_000_000;
  assert.equal(buffRemainingMs({ buffs: { doubleCoinsUntil: now + 600000 } }, now), 600000);
  assert.equal(buffRemainingMs({ buffs: { doubleCoinsUntil: now } }, now), 0);
  assert.equal(buffRemainingMs({ buffs: { doubleCoinsUntil: 0 } }, now), 0);
  assert.equal(buffRemainingMs({}, now), 0);
  assert.equal(buffRemainingMs(null, now), 0);
  assert.equal(buffRemainingMs({ buffs: { doubleCoinsUntil: 'x' } }, now), 0);
});

test('redeemedRows: newest first, catalog effects joined, corrupt-safe', () => {
  const catalog = [
    { id: 'updateLiebe', effect: { buff: 'doubleCoins', minutes: 10 } },
    { id: 'herzGooby', effect: { sticker: 'herzGooby', coins: 50 } },
  ];
  const rows = redeemedRows({ herzGooby: 200, updateLiebe: 300, ghost: 100 }, catalog);
  assert.deepEqual(rows.map((r) => r.id), ['updateLiebe', 'herzGooby', 'ghost']);
  assert.equal(rows[0].effect.buff, 'doubleCoins');
  assert.equal(rows[2].effect, null); // unknown id still renders
  assert.deepEqual(redeemedRows(null), []);
  assert.deepEqual(redeemedRows('junk'), []);
});

test('wrong-attempt window: 5 wrong inside 60 s → 30 s lock (§B10 CODES)', () => {
  const w = createWrongAttemptWindow({ lockAfter: 5, windowSec: 60, lockSec: 30 });
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i += 1) assert.equal(w.wrong(t0 + i * 1000), 0);
  assert.equal(w.wrong(t0 + 4000), t0 + 4000 + 30000); // 5th → lock
  // window rolls: 4 spaced attempts outside 60 s never lock
  const w2 = createWrongAttemptWindow();
  for (let i = 0; i < 8; i += 1) assert.equal(w2.wrong(t0 + i * 61000), 0);
  // reset clears the window
  const w3 = createWrongAttemptWindow();
  for (let i = 0; i < 4; i += 1) w3.wrong(t0 + i);
  w3.reset();
  assert.equal(w3.wrong(t0 + 10), 0);
});

test('formatLedgerRow: §B11 `hh:mm:ss · +/−amount · reason · balance`', () => {
  const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
  assert.equal(
    formatLedgerRow({ at, kind: 'award', amount: 25, reason: 'code', balance: 125 }),
    '03:04:05 · +25 · code · 125'
  );
  assert.equal(
    formatLedgerRow({ at, kind: 'spend', amount: 10, reason: 'shop', balance: 90 }),
    '03:04:05 · −10 · shop · 90'
  );
  assert.match(formatLedgerRow({}), /^\d{2}:\d{2}:\d{2} · \+0 · — · 0$/);
});

// ---------------------------------------------------------------------------
// §C-SYS6 card 18 — data/harnessParams.js single source
// ---------------------------------------------------------------------------

test('harness cheat sheet: groups + rows are complete and well-formed', () => {
  assert.ok(HARNESS_PARAM_GROUPS.length >= 5);
  for (const group of HARNESS_PARAM_GROUPS) {
    assert.ok(group.id && group.en && group.de, `group ${group.id} labels`);
    assert.ok(group.rows.length > 0, `group ${group.id} empty`);
    for (const row of group.rows) {
      assert.ok(row.param, 'param missing');
      assert.ok(row.example.startsWith('?'), `${row.param} example not a query`);
      assert.ok(
        row.example.includes(`${row.param}=`),
        `${row.param} example does not set the param`
      );
      assert.ok(row.en.trim() && row.de.trim(), `${row.param} descriptions`);
    }
  }
});

test('harness cheat sheet: params are unique and cover the §E9 basics', () => {
  const params = allHarnessParams().map((r) => r.param);
  assert.equal(new Set(params).size, params.length, 'duplicate param row');
  for (const must of ['reset', 'coins', 'level', 'lang', 'fast', 'now', 'scene',
    'minigame', 'open', 'uiscale', 'notch', 'autoplay', 'difficulty',
    'invertx', 'inverty']) {
    assert.ok(params.includes(must), `missing §E9 param '${must}'`);
  }
});

test('jump-list candidates: non-empty, unique, and settings ids present', () => {
  for (const list of [JUMP_SCENES, JUMP_SCREENS, JUMP_PANELS]) {
    assert.ok(list.length > 0);
    assert.equal(new Set(list).size, list.length);
  }
  assert.ok(JUMP_SCENES.includes('home'));
  assert.ok(JUMP_SCREENS.includes('settings'));
  assert.ok(JUMP_SCREENS.includes('devPanel'));
  for (const id of ['codes', 'settingsDisplay', 'settingsAudio']) {
    assert.ok(JUMP_PANELS.includes(id), `panel '${id}' missing`);
  }
});

// ---------------------------------------------------------------------------
// Static integration seams (source-level; DOM behavior is CDP-verified)
// ---------------------------------------------------------------------------

test('settingsScreen registers the §B9 subscreen panels + codes panel', () => {
  const src = source('src/ui/settingsScreen.js');
  assert.match(src, /registerPanel\(\s*'settingsDisplay'/);
  assert.match(src, /registerPanel\(\s*'settingsAudio'/);
  assert.match(src, /registerCodesUi\(/);
  assert.match(src, /settings\.controls/); // §G3.3 invert toggles write here
  assert.match(src, /settings\.gyro/); // §C-SYS8.1 persisted key
});

test('codesScreen: normalization + shake + lock countdown are wired', () => {
  const src = source('src/ui/codesScreen.js');
  assert.match(src, /normalizeCodeInput/);
  assert.match(src, /g58-shake/);
  assert.match(src, /codes\.lockUntil|lockRemainingSec/);
  assert.match(src, /autocapitalize="off"/); // §C-SYS5.1 input attrs
  assert.match(src, /economy\.award\(/); // §B6: effects through the real pipes
});

test('devPanel: §C-SYS6 cards 13–18 + card-3 ledger expander exist', () => {
  const src = source('src/ui/devPanel.js');
  for (const card of ['codes', 'modifier', 'recap', 'radio', 'jump', 'cheat']) {
    assert.match(src, new RegExp(`data-card="${card}"`), `card '${card}' missing`);
  }
  assert.match(src, /data-act="ledgerBox"/);
  assert.match(src, /economy\.getLedger/); // §B11 feature-detected
  assert.match(src, /getRecapBeatDebug/); // card-15 flag G64 reads
  assert.match(src, /HARNESS_PARAM_GROUPS/); // card 18 single source
  // §E0.1-11: same-wave engines only via glob probes, never static imports.
  assert.match(src, /import\.meta\.glob\('\.\.\/systems\/modifierEngine\.js'\)/);
  assert.ok(!/^import .*from '\.\.\/systems\/modifierEngine\.js'/m.test(src));
  assert.ok(!/^import .*from '\.\.\/systems\/codesEngine\.js'/m.test(src));
});

test('hud: ONE marked G58 block renders the ×2-coins buff chip', () => {
  const src = source('src/ui/hud.js');
  assert.equal(src.match(/---- V4\/G58: ×2-coins buff chip/g)?.length, 1);
  assert.match(src, /g58-hud-buff/);
  assert.match(src, /buffRemainingMs/);
  assert.match(src, /codesChanged/); // live re-sync on redeem
});

test('styles.css: G58 block ships the shake keyframe + chip + card styles', () => {
  const css = source('src/ui/styles.css');
  assert.match(css, /@keyframes g58-shake/);
  assert.match(css, /\.g58-hud-buff/);
  assert.match(css, /\.g58-ledger-pre/);
  assert.match(css, /\.panel-settingsDisplay/);
  assert.match(css, /end V4\/G58/);
});
