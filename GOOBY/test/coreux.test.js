// V3/G33 — core-UX pure logic (PLAN3 §B3/§B4/§C1/§C2): UI-scale steps +
// root-font math, volume-row metadata/clamping, the hidden dev-gate tap
// counter (5× „Auto" / 4 s window / 2 s idle + foreign-tap resets), the §B9
// fake-notch values, and EN/DE parity for every v3-ux/v3-dev string key the
// settings screen + dev panel reference. Pure node:test — no DOM/three.js
// (the DOM appliers are CDP-verified per §E).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_SCALES,
  UI_SCALE_DEFAULT,
  ROOT_FONT_PX,
  normalizeUiScale,
  rootFontPx,
  VOLUME_DEFAULTS,
  VOLUME_ROWS,
  normalizeVolume,
  volumesWithDefaults,
  DEV_GATE,
  createDevGate,
  FAKE_NOTCH,
  ARCADE_TWO_COL_MAX_PX,
} from '../src/ui/settings.logic.js';
import { EN as UX_EN, DE as UX_DE } from '../src/data/strings/v3-ux.js';
import { EN as DEV_EN, DE as DEV_DE } from '../src/data/strings/v3-dev.js';

// ---------------------------------------------------------------------------
// §B3/§C1.1 — UI scale
// ---------------------------------------------------------------------------

test('§C1.1: the 4 legal UI-scale stops, default 100', () => {
  assert.deepEqual([...UI_SCALES], [85, 100, 115, 130]);
  assert.equal(UI_SCALE_DEFAULT, 100);
  assert.equal(ROOT_FONT_PX, 16);
});

test('§B1-5: normalizeUiScale clamps illegal values to 100', () => {
  for (const legal of UI_SCALES) assert.equal(normalizeUiScale(legal), legal);
  assert.equal(normalizeUiScale('115'), 115); // string from an old save
  for (const junk of [90, 0, -85, 131, null, undefined, NaN, 'big', {}, true]) {
    assert.equal(normalizeUiScale(junk), 100, `junk ${String(junk)}`);
  }
});

test('§B3: rootFontPx = 16 · scale/100 for every stop', () => {
  assert.equal(rootFontPx(85), 13.6);
  assert.equal(rootFontPx(100), 16);
  assert.equal(rootFontPx(115), 18.4);
  assert.equal(rootFontPx(130), 20.8);
  assert.equal(rootFontPx('junk'), 16); // illegal → default 100 → 16px
});

test('§C1.2: arcade 2-col breakpoints only exist for 115/130 %', () => {
  // viewportWidth / (scale/100) < 350 → 350·1.15=402.5 → ≤402, 350·1.3=455 → ≤454
  assert.deepEqual(ARCADE_TWO_COL_MAX_PX, { 115: 402, 130: 454 });
});

// ---------------------------------------------------------------------------
// §C2.1/§C2.2 — volume slider rows
// ---------------------------------------------------------------------------

test('§C2.2: binding slider defaults', () => {
  assert.deepEqual(VOLUME_DEFAULTS, { master: 80, sfx: 100, music: 70, voice: 100, ambience: 80 });
});

test('§C2.1: 5 rows in binding order, mute toggles ONLY on sfx + music', () => {
  assert.deepEqual(VOLUME_ROWS.map((r) => r.key), ['master', 'sfx', 'music', 'voice', 'ambience']);
  assert.deepEqual(VOLUME_ROWS.filter((r) => r.mute).map((r) => r.mute), ['sfx', 'music']);
  for (const row of VOLUME_ROWS) {
    assert.equal(row.labelKey, `settings.vol.${row.key}`);
    assert.equal(typeof row.icon, 'string');
  }
});

test('§B1-5: normalizeVolume clamps to int 0–100, junk → per-bus default', () => {
  assert.equal(normalizeVolume(55, 'sfx'), 55);
  assert.equal(normalizeVolume(-4, 'sfx'), 0);
  assert.equal(normalizeVolume(140, 'sfx'), 100);
  assert.equal(normalizeVolume(33.4, 'sfx'), 33); // integers only
  assert.equal(normalizeVolume('66', 'music'), 66);
  assert.equal(normalizeVolume('junk', 'music'), 70); // music default
  assert.equal(normalizeVolume(undefined, 'master'), 80); // master default
});

test('volumesWithDefaults completes a missing/partial slice defensively', () => {
  assert.deepEqual(volumesWithDefaults(undefined), VOLUME_DEFAULTS);
  assert.deepEqual(volumesWithDefaults(null), VOLUME_DEFAULTS);
  assert.deepEqual(volumesWithDefaults({ sfx: 25 }), { ...VOLUME_DEFAULTS, sfx: 25 });
  assert.deepEqual(
    volumesWithDefaults({ master: 'junk', voice: 300 }),
    { ...VOLUME_DEFAULTS, voice: 100 },
  );
});

// ---------------------------------------------------------------------------
// §B4/§C4.1 — hidden dev gate
// ---------------------------------------------------------------------------

test('§B4: gate numbers — 5 taps, 4 s window, 2 s idle reset', () => {
  assert.deepEqual(DEV_GATE, { TAPS: 5, WINDOW_MS: 4000, IDLE_RESET_MS: 2000 });
});

test('§B4: 5 quick taps fire the gate exactly on the 5th', () => {
  const gate = createDevGate();
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) {
    assert.equal(gate.tap(t0 + i * 300), false, `tap ${i + 1} must not fire`);
  }
  assert.equal(gate.tap(t0 + 4 * 300), true, '5th tap fires');
  assert.equal(gate.count(), 0, 'chain resets after firing');
});

test('§B4: 4 taps + a foreign tap (reset) never unlock', () => {
  const gate = createDevGate();
  const t0 = 2_000_000;
  for (let i = 0; i < 4; i++) gate.tap(t0 + i * 200);
  gate.reset(); // any non-„Auto" tap
  assert.equal(gate.tap(t0 + 900), false, 'restarted chain — tap 1 of 5');
  assert.equal(gate.count(), 1);
});

test('§B4: ≥2 s inactivity resets the chain', () => {
  const gate = createDevGate();
  const t0 = 3_000_000;
  for (let i = 0; i < 4; i++) gate.tap(t0 + i * 100);
  assert.equal(gate.tap(t0 + 300 + 2000), false, '5th tap after 2 s idle restarts');
  assert.equal(gate.count(), 1);
});

test('§B4: taps outside the 4 s rolling window do not count toward 5', () => {
  const gate = createDevGate();
  const t0 = 4_000_000;
  // 5 taps spaced 1.9 s apart: never 5 inside any 4 s window, never 2 s idle.
  for (let i = 0; i < 8; i++) {
    assert.equal(gate.tap(t0 + i * 1900), false, `slow tap ${i + 1}`);
  }
});

// ---------------------------------------------------------------------------
// §B9 — fake notch
// ---------------------------------------------------------------------------

test('§B9: fake-notch forces the iPhone-14-Pro inset values (59/34 px)', () => {
  assert.deepEqual(FAKE_NOTCH, { top: '59px', bottom: '34px', left: '0px', right: '0px' });
});

// ---------------------------------------------------------------------------
// §E0.1-2 — EN/DE parity for the G33 string modules
// ---------------------------------------------------------------------------

function assertParity(en, de, label) {
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort(), `${label}: EN/DE key sets differ`);
  for (const [dict, name] of [[en, 'EN'], [de, 'DE']]) {
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${label} ${name}.${k} not a string`);
      assert.ok(v.length > 0, `${label} ${name}.${k} empty`);
    }
  }
}

test('v3-ux.js: EN/DE parity + the settings-3.0 keys exist', () => {
  assertParity(UX_EN, UX_DE, 'v3-ux');
  for (const key of [
    'settings.section.general', 'settings.section.audio', 'settings.section.display',
    'settings.vol.master', 'settings.vol.sfx', 'settings.vol.music',
    'settings.vol.voice', 'settings.vol.ambience', 'settings.vol.mute',
    'settings.uiScale', 'settings.devRow', 'settings.devOpen',
    'dev.unlocked', 'dev.already',
  ]) {
    assert.ok(UX_EN[key], `v3-ux missing ${key}`);
  }
  // §C2.1 binding DE labels
  assert.equal(UX_DE['settings.vol.master'], 'Gesamt');
  assert.equal(UX_DE['settings.vol.sfx'], 'Effekte');
  assert.equal(UX_DE['settings.vol.music'], 'Musik');
  assert.equal(UX_DE['settings.vol.voice'], 'Gooby-Stimme');
  assert.equal(UX_DE['settings.vol.ambience'], 'Ambiente');
  assert.equal(UX_DE['settings.uiScale'], 'UI-Größe');
  assert.equal(UX_DE['settings.devRow'], 'Entwickler');
  // §C4.1 binding re-tap toast
  assert.equal(UX_DE['dev.already'], 'Dev-Modus bereits aktiv');
});

test('v3-dev.js: EN/DE parity + one title key per §C4.2 card', () => {
  assertParity(DEV_EN, DEV_DE, 'v3-dev');
  for (const key of [
    'dev.title',
    'dev.unlockAll', 'dev.level', 'dev.coins', 'dev.stats', 'dev.weight',
    'dev.health', 'dev.weather', 'dev.band', 'dev.clock', 'dev.notify',
    'dev.overlay', 'dev.notch', 'dev.save', 'dev.debug',
  ]) {
    assert.ok(DEV_EN[key], `v3-dev missing ${key}`);
  }
});
