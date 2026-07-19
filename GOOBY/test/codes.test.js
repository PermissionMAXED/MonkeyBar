// V4/G53 — codes engine battery (PLAN4 §B6 + §C-SYS5, binding). Covers: the
// 2-row launch catalog verbatim (normalized secrets + exact effects), input
// normalization (§C-SYS5.3 trim → lowercase → strip ALL whitespace),
// single-use redemption latching, double-redeem refusal, the 5-wrong-in-60-s
// rate-limit lock (30 s, persisted via codes.lockUntil), buff expiry
// accessors (isDoubleCoinsActive/remainingMs — the HUD ×2-chip contract for
// G58/G56), and the §E0.1-2 economy stacking ruling: the doubleCoins buff
// multiplies minigame payouts ×2 AFTER the daily first-play ×2 (→ ×4).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, redeem, isDoubleCoinsActive, remainingMs, lockRemainingMs,
  resetAttemptsForTests,
} from '../src/systems/codesEngine.js';
import { CODES, CODES_BY_ID, codeBySecret } from '../src/data/codes.js';
import { CODES as CODE_RULES, COIN_TABLE, MINIGAME } from '../src/data/constants.js';
import { STICKERS_BY_ID } from '../src/data/stickers.js';
import { stickerProgress, isStickerSatisfied, applyStickerUnlocks } from '../src/systems/stickerBook.js';
import { awardMinigame, healthReady } from '../src/systems/economy.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';
import * as clock from '../src/core/clock.js';

await healthReady;

const T0 = new Date(2026, 6, 16, 12, 0, 0, 0).getTime(); // pinned local noon
const MIN = 60000;

/** Fresh state + isolated attempts window per test (pinned-clock purity). */
const fresh = () => ({ state: defaultState(), attempts: [] });

// --------------------------------------------------------- catalog (§C-SYS5.2)

test('catalog: exactly the 2 launch codes with verbatim normalized secrets', () => {
  assert.equal(CODES.length, 2);
  assert.deepEqual(CODES.map((c) => c.id), ['updateLiebe', 'herzGooby']);
  assert.equal(CODES_BY_ID.updateLiebe.secret, 'updateliebe');
  assert.equal(CODES_BY_ID.herzGooby.secret, 'ichlie3bdich');
  for (const c of CODES) {
    assert.equal(c.once, true, `${c.id} is single-use`);
    assert.equal(c.secret, normalize(c.secret), `${c.id} secret is pre-normalized`);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.effect), `${c.id} frozen`);
  }
});

test('catalog: exact effects — 10-min doubleCoins buff / herzGooby sticker + 50c', () => {
  assert.deepEqual({ ...CODES_BY_ID.updateLiebe.effect }, { buff: 'doubleCoins', minutes: 10 });
  assert.deepEqual({ ...CODES_BY_ID.herzGooby.effect }, { sticker: 'herzGooby', coins: 50 });
});

test('codeBySecret: exact-match lookup on the NORMALIZED secret only', () => {
  assert.equal(codeBySecret('updateliebe'), CODES_BY_ID.updateLiebe);
  assert.equal(codeBySecret('ichlie3bdich'), CODES_BY_ID.herzGooby);
  assert.equal(codeBySecret('UpdateLiebe'), undefined); // callers must normalize
  assert.equal(codeBySecret(''), undefined);
  assert.equal(codeBySecret('gooby'), undefined);
});

// ------------------------------------------------- normalization (§C-SYS5.3)

test('normalize: trim → lowercase → strip ALL whitespace', () => {
  assert.equal(normalize('  UpdateLiebe  '), 'updateliebe');
  assert.equal(normalize('UPDATE LIEBE'), 'updateliebe');
  assert.equal(normalize('update\t liebe'), 'updateliebe');
  assert.equal(normalize('Ich LIE3B Dich'), 'ichlie3bdich');
  assert.equal(normalize('u p d a t e l i e b e'), 'updateliebe');
  assert.equal(normalize('update\nliebe'), 'updateliebe');
  assert.equal(normalize(''), '');
});

test('normalize: non-string inputs collapse to the empty string', () => {
  for (const junk of [null, undefined, 42, true, ['updateliebe'], { s: 'x' }]) {
    assert.equal(normalize(junk), '', String(junk));
  }
});

// --------------------------------------------------- redemption (§B6, exact)

test('redeem "UpdateLiebe" (as typed): ok, catalog row, redeemed latch = nowMs', () => {
  const { state, attempts } = fresh();
  const r = redeem(state, 'UpdateLiebe', T0, attempts);
  assert.equal(r.ok, true);
  assert.equal(r.code, CODES_BY_ID.updateLiebe);
  assert.equal(state.codes.redeemed.updateLiebe, T0, 'latched at nowMs');
  assert.equal(state.codes.lockUntil, 0, 'no lock on success');
  assert.deepEqual(attempts, [], 'no wrong-attempt recorded');
});

test('redeem "IchLIE3BDich" (as typed): ok, herzGooby row with sticker + 50c effect', () => {
  const { state, attempts } = fresh();
  const r = redeem(state, 'IchLIE3BDich', T0, attempts);
  assert.equal(r.ok, true);
  assert.equal(r.code.id, 'herzGooby');
  assert.deepEqual({ ...r.code.effect }, { sticker: 'herzGooby', coins: 50 });
  assert.equal(state.codes.redeemed.herzGooby, T0);
});

test('redeem accepts every normalization variant of both secrets', () => {
  for (const input of ['  update liebe ', 'UPDATELIEBE', 'Update\tLiebe', 'update\nLIEBE']) {
    const { state, attempts } = fresh();
    assert.equal(redeem(state, input, T0, attempts).ok, true, JSON.stringify(input));
  }
  for (const input of [' ich lie3b dich ', 'ICHLIE3BDICH', 'Ich LIE3B\tDich']) {
    const { state, attempts } = fresh();
    assert.equal(redeem(state, input, T0, attempts).ok, true, JSON.stringify(input));
  }
});

test('double redeem refused with reason "already"; the latch never moves', () => {
  const { state, attempts } = fresh();
  assert.equal(redeem(state, 'UpdateLiebe', T0, attempts).ok, true);
  const again = redeem(state, 'update liebe', T0 + 5000, attempts);
  assert.deepEqual(again, { ok: false, reason: 'already' });
  assert.equal(state.codes.redeemed.updateLiebe, T0, 'original stamp kept');
  // …and the same for the second code
  assert.equal(redeem(state, 'IchLIE3BDich', T0, attempts).ok, true);
  assert.deepEqual(redeem(state, 'ichlie3bdich', T0 + 1, attempts), { ok: false, reason: 'already' });
});

test('a junk-normalized latch (validate → 1) still refuses re-redemption', () => {
  const { state, attempts } = fresh();
  state.codes.redeemed.updateLiebe = 1; // save.js validate() collapse value
  assert.deepEqual(redeem(state, 'UpdateLiebe', T0, attempts), { ok: false, reason: 'already' });
});

test('unknown words refuse with "unknown" and never latch anything', () => {
  for (const input of ['gooby', 'update', 'liebe123', '   ', '', null, 42]) {
    const { state, attempts } = fresh(); // fresh window: no rate-limit bleed
    const r = redeem(state, input, T0, attempts);
    assert.deepEqual(r, { ok: false, reason: 'unknown' }, JSON.stringify(input));
    assert.deepEqual(state.codes.redeemed, {}, 'nothing latched');
  }
});

test('redeem is pure against its draft: only codes.* and the attempts array move', () => {
  const { state, attempts } = fresh();
  const before = JSON.stringify({ ...state, codes: undefined });
  redeem(state, 'wrong', T0, attempts);
  redeem(state, 'UpdateLiebe', T0, attempts);
  assert.equal(JSON.stringify({ ...state, codes: undefined }), before, 'siblings untouched');
});

// ----------------------------------------------- rate limit (§C-SYS5.3/§B10)

test('5 wrong words inside 60 s → 30 s lock (constants §B10 verbatim)', () => {
  assert.equal(CODE_RULES.LOCK_AFTER, 5);
  assert.equal(CODE_RULES.LOCK_WINDOW_SEC, 60);
  assert.equal(CODE_RULES.LOCK_SEC, 30);
  const { state, attempts } = fresh();
  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual(redeem(state, `wrong${i}`, T0 + i * 1000, attempts), { ok: false, reason: 'unknown' });
    assert.equal(state.codes.lockUntil, 0, `no lock after ${i + 1} attempts`);
  }
  // the 5th wrong word inside the window engages the lock
  assert.deepEqual(redeem(state, 'wrong4', T0 + 4000, attempts), { ok: false, reason: 'unknown' });
  assert.equal(state.codes.lockUntil, T0 + 4000 + 30000, 'lockUntil = now + LOCK_SEC');
});

test('while locked EVERYTHING refuses — even a correct code', () => {
  const { state, attempts } = fresh();
  state.codes.lockUntil = T0 + 30000; // persisted lock (survived a reload)
  assert.deepEqual(redeem(state, 'UpdateLiebe', T0, attempts), { ok: false, reason: 'locked' });
  assert.deepEqual(redeem(state, 'wrong', T0 + 29999, attempts), { ok: false, reason: 'locked' });
  assert.deepEqual(state.codes.redeemed, {}, 'nothing latched while locked');
});

test('the lock expires exactly at lockUntil; a correct code then redeems', () => {
  const { state, attempts } = fresh();
  for (let i = 0; i < 5; i += 1) redeem(state, `wrong${i}`, T0, attempts);
  const until = state.codes.lockUntil;
  assert.equal(until, T0 + 30000);
  assert.deepEqual(redeem(state, 'UpdateLiebe', until - 1, attempts), { ok: false, reason: 'locked' });
  const r = redeem(state, 'UpdateLiebe', until, attempts); // lockUntil > nowMs is the gate
  assert.equal(r.ok, true);
  assert.equal(state.codes.redeemed.updateLiebe, until);
});

test('the wrong-attempt window is ROLLING: stale attempts fall out after 60 s', () => {
  const { state, attempts } = fresh();
  // 4 wrong words early in the window…
  for (let i = 0; i < 4; i += 1) redeem(state, `wrong${i}`, T0 + i * 1000, attempts);
  // …the 5th lands 61 s later: the first 4 are stale → still no lock
  assert.deepEqual(redeem(state, 'wrong5', T0 + 64000, attempts), { ok: false, reason: 'unknown' });
  assert.equal(state.codes.lockUntil, 0, 'stale attempts never count');
  assert.equal(attempts.length, 1, 'window pruned to the fresh attempt');
});

test('lockRemainingMs: exact countdown; 0 when unlocked or junk-typed', () => {
  const state = defaultState();
  state.codes.lockUntil = T0 + 30000;
  assert.equal(lockRemainingMs(state, T0), 30000);
  assert.equal(lockRemainingMs(state, T0 + 29000), 1000);
  assert.equal(lockRemainingMs(state, T0 + 30000), 0);
  assert.equal(lockRemainingMs({ codes: { lockUntil: 'junk' } }, T0), 0);
  assert.equal(lockRemainingMs({}, T0), 0);
});

test('the module-level session window works too (resetAttemptsForTests hygiene)', () => {
  resetAttemptsForTests();
  const state = defaultState();
  for (let i = 0; i < 5; i += 1) redeem(state, `wrong${i}`, T0 + i);
  assert.equal(state.codes.lockUntil, T0 + 4 + 30000, 'session window locked');
  resetAttemptsForTests();
});

// ----------------------------- buff accessors (HUD ×2-chip contract, G58/G56)

test('isDoubleCoinsActive: strictly until > now; junk states never activate', () => {
  const state = defaultState();
  state.codes.buffs.doubleCoinsUntil = T0 + 10 * MIN; // caller applied the effect
  assert.equal(isDoubleCoinsActive(state, T0), true);
  assert.equal(isDoubleCoinsActive(state, T0 + 10 * MIN - 1), true);
  assert.equal(isDoubleCoinsActive(state, T0 + 10 * MIN), false, 'expiry is exclusive');
  assert.equal(isDoubleCoinsActive(state, T0 + 11 * MIN), false);
  assert.equal(isDoubleCoinsActive({}, T0), false);
  assert.equal(isDoubleCoinsActive({ codes: { buffs: { doubleCoinsUntil: 'soon' } } }, T0), false);
  assert.equal(isDoubleCoinsActive(null, T0), false);
});

test('remainingMs: exact buff countdown, floored at 0, junk-safe', () => {
  const state = defaultState();
  state.codes.buffs.doubleCoinsUntil = T0 + 10 * MIN;
  assert.equal(remainingMs(state, T0), 10 * MIN);
  assert.equal(remainingMs(state, T0 + 9 * MIN), MIN);
  assert.equal(remainingMs(state, T0 + 10 * MIN), 0);
  assert.equal(remainingMs(state, T0 + 20 * MIN), 0, 'never negative');
  assert.equal(remainingMs({ codes: { buffs: { doubleCoinsUntil: NaN } } }, T0), 0);
  assert.equal(remainingMs(undefined, T0), 0);
});

test('the 10-min effect payload maps to a doubleCoinsUntil = now + 600 000 ms', () => {
  const { state, attempts } = fresh();
  const r = redeem(state, 'UpdateLiebe', T0, attempts);
  // the CALLER applies the effect (§B6) — this is the exact write it makes:
  state.codes.buffs.doubleCoinsUntil = T0 + r.code.effect.minutes * MIN;
  assert.equal(state.codes.buffs.doubleCoinsUntil, T0 + 10 * MIN);
  assert.equal(isDoubleCoinsActive(state, T0), true);
  assert.equal(remainingMs(state, T0 + 4 * MIN), 6 * MIN);
  assert.equal(isDoubleCoinsActive(state, T0 + 10 * MIN), false, 'buff expired');
});

// ------------------------- sticker #29 unlock path (§C-SYS5.4 + §B6 contract)

test('herzGooby redemption satisfies the cond.code sticker gate (#29)', () => {
  const def = STICKERS_BY_ID.herzGooby;
  assert.deepEqual({ ...def.cond }, { code: 'herzGooby' });
  const { state, attempts } = fresh();
  assert.equal(isStickerSatisfied(def, state), false, 'locked before the code');
  assert.deepEqual(stickerProgress(def, state), { current: 0, target: 1 });
  redeem(state, 'IchLIE3BDich', T0, attempts);
  assert.equal(isStickerSatisfied(def, state), true);
  assert.deepEqual(stickerProgress(def, state), { current: 1, target: 1 });
  // the normal engine unlock path announces it like any other sticker
  const { state: next, unlocked } = applyStickerUnlocks(state, T0);
  assert.deepEqual(unlocked.map((d) => d.id), ['herzGooby']);
  assert.equal(next.stickers.unlocked.herzGooby, T0);
});

// ------------------- economy stacking ruling (§E0.1-2: buff ×2 AFTER daily ×2)

/** Store pinned to a local noon with a controllable buff window. */
function economyStore({ buffActive, firstToday }) {
  clock.configure({ now: T0 });
  const store = createStore(defaultState(), { autosave: false });
  if (!firstToday) {
    // localDay() at the pinned clock — mark the game as already played today
    const today = new Date(T0).toISOString().slice(0, 10);
    store.set('minigames.lastPlayDay.carrotCatch', today);
  }
  store.update((s) => {
    s.codes.buffs.doubleCoinsUntil = buffActive ? T0 + 10 * MIN : 0;
  });
  return store;
}

test('economy: buff ×2 stacks AFTER the daily ×2 → ×4 on the first play of the day', () => {
  const { divisor } = COIN_TABLE.carrotCatch;
  const score = divisor * 10; // base = 10, safely inside min/max
  const store = economyStore({ buffActive: true, firstToday: true });
  const r = awardMinigame(store, 'carrotCatch', score);
  assert.equal(r.firstToday, true);
  assert.equal(r.doubleCoinsBuff, true, 'breakdown flags the buff for the results chip');
  assert.equal(r.coins, 10 * MINIGAME.DAILY_FIRST_PLAY_MULT * 2, 'base × daily ×2 × buff ×2');
  clock.configure({ now: null });
});

test('economy: buff alone doubles a repeat play (daily ×2 already consumed)', () => {
  const { divisor } = COIN_TABLE.carrotCatch;
  const score = divisor * 10;
  const store = economyStore({ buffActive: true, firstToday: false });
  const r = awardMinigame(store, 'carrotCatch', score);
  assert.equal(r.firstToday, false);
  assert.equal(r.doubleCoinsBuff, true);
  assert.equal(r.coins, 10 * 2, 'base × buff ×2 only');
  clock.configure({ now: null });
});

test('economy: an EXPIRED buff pays the plain row amount and flags false', () => {
  const { divisor } = COIN_TABLE.carrotCatch;
  const score = divisor * 10;
  const store = economyStore({ buffActive: false, firstToday: false });
  store.update((s) => {
    s.codes.buffs.doubleCoinsUntil = T0 - 1; // expired one ms ago
  });
  const r = awardMinigame(store, 'carrotCatch', score);
  assert.equal(r.doubleCoinsBuff, false);
  assert.equal(r.coins, 10, 'no buff, no daily — plain base');
  clock.configure({ now: null });
});
