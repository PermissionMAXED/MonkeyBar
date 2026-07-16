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
} from '../src/systems/shopTrip.js';
import { DRIVE, MINIGAME, COIN_TABLE } from '../src/data/constants.js';
import { MINIGAMES } from '../src/data/minigames.js';

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
