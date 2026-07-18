// Shop trip (§C4) — pure state machine transitions incl. the tow rule,
// §C4.3 reward math (pickups + arrival + zero-crash), the §C4.2 energy cost
// and arcade-mode isolation (no shop handoff, §C4.7).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIP_STATE,
  tripTransition,
  createTripMachine,
  driveRewards,
  isShopHandoff,
  isVetHandoff, // V2/G21 (§C9.2)
  isTripMode, // V2/G21 (§C9.2)
  isVetDiscovered, // V2/G21 (§C9.2)
  canRequestTrip, // V2/FIX-C (P2-7)
} from '../src/systems/shopTrip.js';
import { DRIVE, MINIGAME, COIN_TABLE, VET } from '../src/data/constants.js'; // V2/G21: + VET
import { MINIGAMES } from '../src/data/minigames.js';
// V2/G21: vetTrip cure/checkup ride economy.payVet (§C3.5) — real store runs
import { payVet, healthReady } from '../src/systems/economy.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';

// settle the optional health-engine probe so payVet applies §C3.5 effects
await healthReady;

/** isolated store per test (autosave off — no timers keep node alive) */
const makeStore = () => createStore(defaultState(), { autosave: false });

// ------------------------------------------------------------- transitions

test('happy path: home →start→ driveOut →arrive→ shop →goHome→ home', () => {
  let s = TRIP_STATE.HOME;
  s = tripTransition(s, 'start');
  assert.equal(s, TRIP_STATE.DRIVE_OUT);
  s = tripTransition(s, 'arrive');
  assert.equal(s, TRIP_STATE.SHOP);
  s = tripTransition(s, 'goHome');
  assert.equal(s, TRIP_STATE.HOME);
});

test('invalid events never move the machine (forgiving §C4.5)', () => {
  assert.equal(tripTransition(TRIP_STATE.HOME, 'arrive'), TRIP_STATE.HOME);
  assert.equal(tripTransition(TRIP_STATE.HOME, 'goHome'), TRIP_STATE.HOME);
  assert.equal(tripTransition(TRIP_STATE.DRIVE_OUT, 'start'), TRIP_STATE.DRIVE_OUT);
  assert.equal(tripTransition(TRIP_STATE.SHOP, 'start'), TRIP_STATE.SHOP);
  assert.equal(tripTransition(TRIP_STATE.SHOP, 'arrive'), TRIP_STATE.SHOP); // idempotent
});

test('cancel (quit from pause) returns home from any outing state', () => {
  assert.equal(tripTransition(TRIP_STATE.DRIVE_OUT, 'cancel'), TRIP_STATE.HOME);
  assert.equal(tripTransition(TRIP_STATE.SHOP, 'cancel'), TRIP_STATE.HOME);
});

test('tow rule (§C4.5): the trip still arrives — tow leads to shop, never home', () => {
  // 3 crashes → tow cutscene → car placed at the shop: the machine sees a
  // plain 'arrive' (the tow only affects rewards, not the state flow).
  let s = tripTransition(TRIP_STATE.HOME, 'start');
  s = tripTransition(s, 'arrive'); // tow teleport counts as arrival
  assert.equal(s, TRIP_STATE.SHOP);
  assert.equal(DRIVE.CRASHES_FOR_TOW, 3);
});

test('createTripMachine reports changes and swallows no-ops', () => {
  const log = [];
  const m = createTripMachine((state, event) => log.push(`${event}:${state}`));
  assert.equal(m.state(), TRIP_STATE.HOME);
  assert.equal(m.arrive(), false); // invalid from home — no change, no event
  assert.equal(m.startTrip(), true);
  assert.equal(m.startTrip(), false); // already driving
  assert.equal(m.arrive(), true);
  assert.equal(m.arrive(), false); // idempotent re-arrival
  assert.equal(m.goHome(), true);
  assert.deepEqual(log, ['start:driveOut', 'arrive:shop', 'goHome:home']);
});

// ------------------------------------------------------------- reward math

test('§C4.3 full run: 20 pickups + arrival 10 + zero-crash 5 = 35', () => {
  assert.equal(
    driveRewards({ mode: 'shopTrip', pickups: DRIVE.PICKUP_COUNT, crashes: 0, towed: false }),
    DRIVE.PICKUP_COUNT * DRIVE.PICKUP_COINS + DRIVE.ARRIVAL_BONUS + DRIVE.ZERO_CRASH_BONUS
  );
  assert.equal(COIN_TABLE.cityDrive.max, 35); // table max matches the §C4 sum
});

test('crashes forfeit only the zero-crash bonus', () => {
  assert.equal(driveRewards({ pickups: 12, crashes: 1 }), 12 + DRIVE.ARRIVAL_BONUS);
  assert.equal(driveRewards({ pickups: 12, crashes: 2 }), 12 + DRIVE.ARRIVAL_BONUS);
});

test('tow (§C4.5) forfeits arrival AND zero-crash bonuses, keeps pickups', () => {
  assert.equal(
    driveRewards({ pickups: 7, crashes: DRIVE.CRASHES_FOR_TOW, towed: true }),
    7 * DRIVE.PICKUP_COINS
  );
  // towed guards against a contradictory crashes=0 payload too
  assert.equal(driveRewards({ pickups: 7, crashes: 0, towed: true }), 7);
});

test('reward math is defensive: negative/fractional pickups clamp to whole coins', () => {
  assert.equal(driveRewards({ pickups: -3, crashes: 1 }), DRIVE.ARRIVAL_BONUS);
  assert.equal(driveRewards({ pickups: 2.9, crashes: 1 }), 2 + DRIVE.ARRIVAL_BONUS);
});

// ------------------------------------------------------------------ arcade

test('arcade coins = collected, clamped to the §C6 table max', () => {
  assert.equal(driveRewards({ mode: 'arcade', pickups: 18 }), 18);
  assert.equal(
    driveRewards({ mode: 'arcade', pickups: 999 }),
    COIN_TABLE.cityDrive.max
  );
});

test('arcade ignores shop-trip bonuses and crash bookkeeping', () => {
  assert.equal(
    driveRewards({ mode: 'arcade', pickups: 10, crashes: 0, towed: false }),
    10 // no arrival/zero-crash bonuses in arcade
  );
  assert.equal(driveRewards({ mode: 'arcade', pickups: 10, crashes: 5, towed: true }), 10);
});

test('arcade-mode isolation: no shop handoff (§C4.7)', () => {
  assert.equal(isShopHandoff('shopTrip'), true);
  assert.equal(isShopHandoff('arcade'), false);
  assert.equal(isShopHandoff(undefined), false);
});

// ------------------------------------------------------------- energy cost

test('cityDrive energy cost is the §C4.2 six (from constants, not inline)', () => {
  assert.equal(MINIGAME.DRIVE_ENERGY_COST, 6);
  const meta = MINIGAMES.find((m) => m.id === 'cityDrive');
  assert.ok(meta, 'cityDrive registered in data/minigames.js');
  assert.equal(meta.energyCost, MINIGAME.DRIVE_ENERGY_COST);
});

// ── V2/G21: vetTrip mode (PLAN2 §C9.2) ──────────────────────────────────────

test('V2: vetTrip rides the same machine — home →start→ driveOut →arrive→ shop(=vet) →goHome→ home', () => {
  // the machine is destination-agnostic ('shop' reads "at the destination");
  // shopTrip.js tags the trip in flight with tripMode='vetTrip'
  let s = tripTransition(TRIP_STATE.HOME, 'start');
  assert.equal(s, TRIP_STATE.DRIVE_OUT);
  s = tripTransition(s, 'arrive');
  assert.equal(s, TRIP_STATE.SHOP);
  s = tripTransition(s, 'goHome'); // „Nach Hause" teleport (§C9.2, v1 ruling)
  assert.equal(s, TRIP_STATE.HOME);
});

test('V2: vetTrip tow rule (§C9.2 — identical to §C4): tow still arrives at the vet', () => {
  let s = tripTransition(TRIP_STATE.HOME, 'start');
  s = tripTransition(s, 'arrive'); // tow teleport counts as arrival
  assert.equal(s, TRIP_STATE.SHOP);
  // tow forfeits arrival + zero-crash bonuses, keeps pickups — same math
  assert.equal(
    driveRewards({ mode: 'vetTrip', pickups: 4, crashes: DRIVE.CRASHES_FOR_TOW, towed: true }),
    4 * DRIVE.PICKUP_COINS
  );
});

test('V2: vetTrip reward math mirrors the shop trip (10 pickups + bonuses)', () => {
  assert.equal(
    driveRewards({ mode: 'vetTrip', pickups: VET.ROUTE_PICKUP_COUNT, crashes: 0, towed: false }),
    VET.ROUTE_PICKUP_COUNT * DRIVE.PICKUP_COINS + DRIVE.ARRIVAL_BONUS + DRIVE.ZERO_CRASH_BONUS
  );
  assert.equal(driveRewards({ mode: 'vetTrip', pickups: 6, crashes: 2 }), 6 + DRIVE.ARRIVAL_BONUS);
});

test('V2: mode helpers — vetTrip is a trip, hands off to the vet, never the shop', () => {
  assert.equal(isTripMode('shopTrip'), true);
  assert.equal(isTripMode('vetTrip'), true);
  assert.equal(isTripMode('arcade'), false);
  assert.equal(isTripMode(undefined), false);
  assert.equal(isVetHandoff('vetTrip'), true);
  assert.equal(isVetHandoff('shopTrip'), false);
  assert.equal(isVetHandoff('arcade'), false);
  assert.equal(isShopHandoff('vetTrip'), false); // vet arrivals skip the shop
});

test('V2 §C9.2: vet discovery — vetTrips counter, vetClinic sticker, or unwell Gooby', () => {
  const fresh = defaultState();
  assert.equal(isVetDiscovered(fresh), false); // new game: picker hidden
  const byTrip = defaultState();
  byTrip.achievements.counters.vetTrips = 1;
  assert.equal(isVetDiscovered(byTrip), true);
  const bySticker = defaultState();
  bySticker.collections.entries['landmarks.vetClinic'] = 1;
  assert.equal(isVetDiscovered(bySticker), true);
  for (const state of ['queasy', 'sick']) {
    const unwell = defaultState();
    unwell.health.state = state;
    assert.equal(isVetDiscovered(unwell), true, `${state} Gooby must find the vet`);
  }
  assert.equal(isVetDiscovered(undefined), false); // defensive
});

test('V2 §C9.2: arrival cure pays economy.payVet EXACTLY once (repeat = healthy no-op)', () => {
  const store = makeStore();
  store.set('coins', 500);
  store.set('health.state', 'sick');
  store.set('health.junkScore', 80);
  const res = payVet(store, 'cure'); // the vetPanel "Behandlung" tap
  assert.equal(res.ok, true);
  assert.equal(store.get('coins'), 500 - VET.CURE_PRICE); // paid once
  assert.equal(store.get('health.state'), 'healthy'); // §C3.5 full cure
  // a second tap cannot double-charge: Gooby is healthy now
  assert.deepEqual(payVet(store, 'cure'), { ok: false, reason: 'healthy' });
  assert.equal(store.get('coins'), 500 - VET.CURE_PRICE); // still one charge
});

test('V2 §C9.2: checkup path — 30c anytime, resets neglect, insufficient coins refused', () => {
  const store = makeStore();
  store.set('coins', VET.CHECKUP_PRICE);
  store.set('health.neglectMin', 200);
  assert.equal(payVet(store, 'checkup').ok, true); // healthy Gooby: still ok
  assert.equal(store.get('coins'), 0);
  assert.equal(store.get('health.neglectMin'), 0); // §C3.5 neglect reset
  // can't afford → {ok:false, reason:'coins'} (vetPanel shows the 40c hint)
  assert.deepEqual(payVet(store, 'checkup'), { ok: false, reason: 'coins' });
  assert.equal(store.get('coins'), 0); // nothing charged on refusal
});
// ── end V2/G21 ──────────────────────────────────────────────────────────────

// ── V2/FIX-C (P2-7): sleep gate on the trip confirm/destination sheets ──────

test('V2/FIX-C canRequestTrip: sleeping Gooby blocks the sheet with a reason', () => {
  const asleep = defaultState();
  asleep.sleep = { sleeping: true, startedAt: 1, wakeAt: 2 };
  assert.deepEqual(canRequestTrip(asleep), { ok: false, reason: 'sleeping' });
});

test('V2/FIX-C canRequestTrip: awake (or legacy saves without a sleep slice) may open', () => {
  assert.deepEqual(canRequestTrip(defaultState()), { ok: true });
  assert.deepEqual(canRequestTrip({}), { ok: true }); // defensive: no slice
  assert.deepEqual(canRequestTrip(undefined), { ok: true });
});
