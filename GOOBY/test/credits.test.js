// V4/G81 — credits/license obligations (PLAN4 §C-SYS12.4, §A2 assets;
// PLAN4-GAMES §G6.2). Pure node:test: data, committed roots, and static seams.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CREDITS } from '../src/data/credits.js';
import { EN, DE } from '../src/data/strings/v4-credits.js';
import { WELT_SCENES } from '../src/welt/weltScenes.js';
import { setLang } from '../src/data/strings.js';
import { renderCreditRow } from '../src/ui/creditsScreen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const source = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** All top-level asset roots must be classified so a new pack cannot hide. */
const FIRST_PARTY_ROOTS = Object.freeze(['GoobyMusic', 'covers', 'recap', 'stickers']);
const SPECIAL_CREDIT_ROOTS = Object.freeze(['music', 'splats']);
const PACK_ROOT_ALIASES = Object.freeze({
  kenney: 'kenney',
  kaykit: 'kaykit',
  ui: 'kenney',
  vfx: 'itch/vfx',
});

/** @returns {string[]} canonical section-4 pack roots required on this checkout. */
function requiredPackDirs() {
  const roots = fs
    .readdirSync(ASSETS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const classified = new Set([
    ...FIRST_PARTY_ROOTS,
    ...SPECIAL_CREDIT_ROOTS,
    'itch',
    ...Object.keys(PACK_ROOT_ALIASES),
  ]);
  assert.deepEqual(
    roots.filter((root) => !classified.has(root)).sort(),
    [],
    'unclassified public/assets root: classify it and add its credit when third-party'
  );

  const required = new Set();
  for (const root of roots) {
    if (PACK_ROOT_ALIASES[root]) required.add(PACK_ROOT_ALIASES[root]);
  }
  for (const entry of fs.readdirSync(path.join(ASSETS, 'itch'), { withFileTypes: true })) {
    if (entry.isDirectory()) required.add(`itch/${entry.name}`);
  }
  return [...required].sort();
}

/**
 * Return deterministic pack-credit errors. Kept separate so the test can
 * inject a synthetic phantom row and prove the guard trips.
 * @param {readonly object[]} rows
 * @param {readonly string[]} required
 * @returns {string[]}
 */
function auditPackRows(rows, required) {
  const dirs = rows.map((row) => row.packDir).filter(Boolean);
  const errors = [];
  for (const dir of required) {
    if (!dirs.includes(dir)) errors.push(`missing credit row '${dir}'`);
  }
  for (const dir of dirs) {
    if (!required.includes(dir)) errors.push(`phantom credit row '${dir}'`);
  }
  for (const dir of new Set(dirs)) {
    if (dirs.filter((value) => value === dir).length !== 1) {
      errors.push(`duplicate credit row '${dir}'`);
    }
  }
  if (dirs.length !== rows.length) errors.push('section-4 row without packDir');
  return errors.sort();
}

test('credits strings have identical, non-empty EN + DE labels for all five sections', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(DE).sort());
  assert.deepEqual(Object.keys(EN).sort(), [
    'credits.by',
    'credits.section.gooby',
    'credits.section.music',
    'credits.section.sounds',
    'credits.section.technology',
    'credits.section.worlds',
    'credits.source',
    'credits.title',
  ]);
  for (const key of Object.keys(EN)) {
    assert.ok(EN[key].trim(), `empty EN ${key}`);
    assert.ok(DE[key].trim(), `empty DE ${key}`);
  }
});

test('credits data is frozen and has the binding §C-SYS12.4 section order/content', () => {
  assert.ok(Object.isFrozen(CREDITS));
  assert.deepEqual(Object.keys(CREDITS), [
    'gooby', 'welten', 'musik', 'soundsGrafik', 'technik',
  ]);
  for (const rows of Object.values(CREDITS)) {
    assert.ok(Object.isFrozen(rows));
    assert.ok(rows.length > 0);
    assert.ok(rows.every(Object.isFrozen));
  }
  assert.equal(
    CREDITS.gooby[0].text,
    'Ein Spiel von PermissionMAXED & den GOOBY-Agenten. Gooby ist handgemacht. 💛'
  );
  assert.equal(CREDITS.technik[0].text, 'three.js · Vite · Capacitor (MIT/BSD)');
});

test('§G6.2: both shipped splat rows match world data verbatim and carry the change note', () => {
  const attributions = CREDITS.welten.filter((row) => row.title);
  assert.deepEqual(
    attributions.map(({ title, by, source }) => ({ title, by, source })),
    [
      {
        title: 'S Windmill in Golden Gate Park',
        by: 'azadbal',
        source: 'https://superspl.at/scene/d5f14e49',
      },
      {
        title: 'Ludlow - Quality Square',
        by: 'ijenko',
        source: 'https://superspl.at/scene/ca36efcc',
      },
    ]
  );
  assert.equal(attributions.length, WELT_SCENES.length, 'phantom/missing splat credit');
  for (const scene of WELT_SCENES) {
    const row = attributions.find((credit) => credit.title === scene.attribution.title);
    assert.ok(row, `missing credit for shipped scene ${scene.id}`);
    assert.deepEqual(
      { title: row.title, by: row.by, license: row.license, source: row.source },
      scene.attribution
    );
    assert.equal(row.note, 'verändert (dezimiert/komprimiert)');
    assert.ok(fs.existsSync(path.join(ASSETS, 'splats', scene.file)));
    const license = source(`public/assets/splats/${scene.licenseFile}`);
    assert.match(license, /CC BY 4\.0/);
    assert.match(license, /decimat/i);
    assert.match(license, /higher-order spherical harmonics|SH0/i);
  }
  assert.deepEqual(
    CREDITS.welten.filter((row) => row.link).map((row) => row.link),
    ['https://creativecommons.org/licenses/by/4.0']
  );
});

test('section 3 credits every committed CC0 music source exactly once', () => {
  assert.ok(fs.existsSync(path.join(ASSETS, 'music', 'LICENSES.md')));
  assert.deepEqual(
    CREDITS.musik.map(({ title, by, license }) => ({ title, by, license })),
    [
      { title: 'Playful Piano', by: 'Dylann Taylor', license: 'CC0' },
      { title: 'Music Loop Bundle', by: 'Tallbeard Studios/Abstraction', license: 'CC0' },
      { title: 'Orchestral & World Music', by: 'Ragnar Random', license: 'CC0' },
    ]
  );
});

test('section 4 is a bijection with every committed third-party pack root', () => {
  const required = requiredPackDirs();
  assert.deepEqual(auditPackRows(CREDITS.soundsGrafik, required), []);
  for (const row of CREDITS.soundsGrafik) {
    assert.equal(row.license, 'CC0', `${row.packDir}: unexpected license`);
    assert.ok(fs.existsSync(path.join(ASSETS, ...row.packDir.split('/'))), row.packDir);
  }
});

test('section-4 guard rejects a synthetic phantom row', () => {
  const mutated = [
    ...CREDITS.soundsGrafik,
    { title: 'Phantom Pack', by: 'Nobody', license: 'CC0', packDir: 'itch/phantom-pack' },
  ];
  assert.deepEqual(
    auditPackRows(mutated, requiredPackDirs()),
    ["phantom credit row 'itch/phantom-pack'"]
  );
});

test('renderer switches EN/DE labels while keeping rows and URLs inert text', () => {
  const row = CREDITS.welten[0];
  setLang('en');
  const en = renderCreditRow(row);
  assert.match(en, /by azadbal/);
  assert.match(en, /Source: https:\/\/superspl\.at/);
  setLang('de');
  const de = renderCreditRow(row);
  assert.match(de, /von azadbal/);
  assert.match(de, /Quelle: https:\/\/superspl\.at/);
  assert.match(de, /verändert \(dezimiert\/komprimiert\)/);
  assert.doesNotMatch(`${en}${de}`, /<a\b|href\s*=|target\s*=/i);
  setLang('en');
});

test('credits screen registers the settings feature id and ships scrollable G81 styles', () => {
  const js = source('src/ui/creditsScreen.js');
  const ui = source('src/ui/ui.js');
  const css = source('src/ui/styles.css');
  assert.match(js, /registerScreen\('credits'/);
  assert.match(ui, /registerCreditsScreen\(ui\)/);
  assert.doesNotMatch(js, /window\.open|location\.(?:assign|href)|<a\b|href\s*=/i);
  assert.match(css, /V4\/G81/);
  assert.match(css, /\.g81-credits-scroll[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /end V4\/G81/);
});
