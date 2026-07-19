// V4/G70 — sick-trip UX contracts: exact bilingual copy, three care routes,
// sick shop focus/pulse decisions, and the owned integration markers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { careSheetActions } from '../src/ui/careSheet.js';
import { sickShopFocus } from '../src/ui/shopScreen.js';
import { EN, DE } from '../src/data/strings/v4-sick.js';
import { t, setLang } from '../src/data/strings.js';

const read = (relative) =>
  fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('§C-SYS7.3 v4 sick strings have EN/DE parity and binding copy', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(DE).sort());
  assert.equal(
    EN['care.hintShop'],
    "Medicine helps right away — buy some at the shop if you're out."
  );
  assert.equal(
    DE['care.hintShop'],
    'Medizin hilft sofort — kauf welche im Laden, falls keine da ist.'
  );
  assert.equal(EN['care.shopTrip'], 'Drive to the shop');
  assert.equal(DE['care.shopTrip'], 'Zum Laden fahren');
  assert.equal(EN['care.shopTrip.sub'], 'Buy medicine (trip costs energy)');
  assert.equal(DE['care.shopTrip.sub'], 'Medizin kaufen (Fahrt kostet Energie)');
  assert.equal(
    EN['toast.sickNow'],
    'Gooby is sick! 🤒 Give medicine — or drive to the shop or the vet.'
  );
  assert.equal(
    DE['toast.sickNow'],
    'Gooby ist krank! 🤒 Medizin geben — oder zum Laden oder Tierarzt fahren.'
  );
});

test('G70 care sheet always offers three routes and adapts empty medicine stock', () => {
  assert.deepEqual([...careSheetActions(2)], ['medicine', 'shopTrip', 'vet']);
  assert.deepEqual([...careSheetActions(0)], ['fridge', 'shopTrip', 'vet']);
  assert.deepEqual([...careSheetActions(undefined)], ['fridge', 'shopTrip', 'vet']);
  assert.equal(EN['care.medicineUse'], 'Use medicine');
  assert.equal(DE['care.medicineUse'], 'Medizin nutzen');
  assert.equal(EN['care.fridgeMedicine'], 'Buy medicine in the fridge');
  assert.equal(DE['care.fridgeMedicine'], 'Medizin im Kühlschrank kaufen');
});

test('G70 sick shop focus selects Care and highlights medicine with one-time empty pulse', () => {
  assert.deepEqual(sickShopFocus('healthy', 0, false), {
    tab: null,
    highlightMedicine: false,
    pulseMedicine: false,
  });
  assert.deepEqual(sickShopFocus('sick', 1, false), {
    tab: 'care',
    highlightMedicine: true,
    pulseMedicine: false,
  });
  assert.deepEqual(sickShopFocus('sick', 0, false), {
    tab: 'care',
    highlightMedicine: true,
    pulseMedicine: true,
  });
  assert.equal(sickShopFocus('sick', 0, true).pulseMedicine, false);
});

test('G70 v4 spread overrides sick transition, arcade refusal, and chip copy in both languages', () => {
  setLang('en');
  assert.equal(t('toast.sickNow'), EN['toast.sickNow']);
  assert.match(t('toast.tooSick'), /medicine at the shop.+vet/i);
  assert.match(t('hud.sickChip'), /Medicine, shop or vet/);
  setLang('de');
  assert.equal(t('toast.sickNow'), DE['toast.sickNow']);
  assert.match(t('toast.tooSick'), /Kauf Medizin im Laden.+Tierarzt/);
  assert.match(t('hud.sickChip'), /Medizin, Laden oder Tierarzt/);
  setLang('en');
});

test('G70 owned wiring opens existing chooser/fridge focus and marks both medicine chips', () => {
  const care = read('../src/ui/careSheet.js');
  assert.match(care, /openPanel\('foodTray', \{ focusMedicine: true \}\)/);
  assert.match(care, /openPanel\('shopTripConfirm', \{ mode: 'shopTrip' \}\)/);
  assert.equal((care.match(/data-care-action="/g) ?? []).length, 4);

  const interactions = read('../src/home/interactions.js');
  assert.match(interactions, /ui\.toast\('toast\.sickNow'\)/);
  assert.match(interactions, /tray-care-item\.g70-sick-medicine/);
  assert.match(interactions, /store\.get\('health\.state'\) === 'sick'/);

  const shop = read('../src/ui/shopScreen.js');
  assert.match(shop, /\['care', 'shop\.tab\.care', renderCare\]/);
  assert.match(shop, /card\.dataset\.careItem = itemId/);
  assert.match(shop, /shop-card\.g70-sick-medicine/);
});
