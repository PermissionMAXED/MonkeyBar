// Shop trip (§C4) — pure state machine transitions incl. the tow rule,
// §C4.3 reward math (pickups + arrival + zero-crash), the §C4.2 energy cost
// and arcade-mode isolation (no shop handoff, §C4.7).
// V3/G38 (PLAN3 §C8.6/§B8): + the surf travel method („Laufen") — launch
// spec, reward cap/bonus/×2-after-clamp math, trip counters for both
// methods, and the unchanged sleep/vet flows.
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
  SURF_TRAVEL, // V3/G38 (§C8.6)
  isSurfTravel, // V3/G38 (§C8.6)
  surfTravelRewards, // V3/G38 (§C8.6)
  clampSurfTravelCoins, // V3/G38 (§C8.6)
  tripLaunchSpec, // V3/G38 (§C8.6)
  bumpTripCounters, // V3/G38 (§C4/§C8.6/§C9.2)
} from '../src/systems/shopTrip.js';
import { DRIVE, MINIGAME, COIN_TABLE, VET } from '../src/data/constants.js'; // V2/G21: + VET
import { MINIGAMES, computeCoins } from '../src/data/minigames.js'; // V3/G38: + computeCoins (×2-after-clamp proof)
// V2/G21: vetTrip cure/checkup ride economy.payVet (§C3.5) — real store runs
// V3/G38: + awardMinigame (the real surf-travel payout path incl. daily ×2)
import { payVet, awardMinigame, healthReady } from '../src/systems/economy.js';
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

// ── V3/G38: surf travel „Laufen" (PLAN3 §C8.6/§B8) ──────────────────────────

test('V3 §B8: surf travel rides the SAME machine states verbatim (start → driveOut → arrive → shop → goHome → home)', () => {
  // §B8 ruling: only the SCENE between 'start' and 'arrive' differs (the
  // shoppingSurf run instead of the drive) — tripTransition is untouched.
  let s = tripTransition(TRIP_STATE.HOME, 'start');
  assert.equal(s, TRIP_STATE.DRIVE_OUT);
  s = tripTransition(s, 'arrive'); // finish arch == parking trigger
  assert.equal(s, TRIP_STATE.SHOP);
  s = tripTransition(s, 'goHome');
  assert.equal(s, TRIP_STATE.HOME);
  // quit from pause mid-run cancels home, exactly like the drive
  assert.equal(tripTransition(TRIP_STATE.DRIVE_OUT, 'cancel'), TRIP_STATE.HOME);
});

test('V3 §C8.6: tripLaunchSpec — travel-method field on the trip request', () => {
  // drive stays the bit-identical default (regression: G39 owns the drive)
  assert.deepEqual(tripLaunchSpec(), { gameId: 'cityDrive', mode: 'shopTrip', method: 'drive' });
  assert.deepEqual(tripLaunchSpec('shopTrip', 'drive'), { gameId: 'cityDrive', mode: 'shopTrip', method: 'drive' });
  // surf method launches G37's shoppingSurf in travel mode
  assert.deepEqual(tripLaunchSpec('shopTrip', 'surf'), { gameId: 'shoppingSurf', mode: 'surfTravel', method: 'surf' });
  // the vet destination stays a drive (§C9.2 row unchanged), even if asked
  assert.deepEqual(tripLaunchSpec('vetTrip', 'surf'), { gameId: 'cityDrive', mode: 'vetTrip', method: 'drive' });
  assert.deepEqual(tripLaunchSpec('vetTrip'), { gameId: 'cityDrive', mode: 'vetTrip', method: 'drive' });
  // unknown methods degrade to the drive — never a stranded machine
  assert.deepEqual(tripLaunchSpec('shopTrip', 'skateboard'), { gameId: 'cityDrive', mode: 'shopTrip', method: 'drive' });
});

test('V3 §C8.6: isSurfTravel accepts the canonical mode + the G37 §E alias, nothing else', () => {
  assert.equal(isSurfTravel('surfTravel'), true);
  assert.equal(isSurfTravel('travel'), true); // G37's §E block naming
  assert.equal(isSurfTravel('shopTrip'), false);
  assert.equal(isSurfTravel('vetTrip'), false);
  assert.equal(isSurfTravel('arcade'), false);
  assert.equal(isSurfTravel(undefined), false);
});

test('V3 §C8.6: mode helpers — surf arrival hands off to the SHOP; drive-guidance modes unchanged', () => {
  // identical arrive → shop handoff (§C8.6 finish arch)
  assert.equal(isShopHandoff('surfTravel'), true);
  assert.equal(isShopHandoff('travel'), true);
  assert.equal(isVetHandoff('surfTravel'), false);
  // isTripMode stays the cityDrive guidance predicate ('shopTrip'|'vetTrip')
  // — G39's drive must not see a new guided mode (§C7.3 invariant).
  assert.equal(isTripMode('surfTravel'), false);
  assert.equal(isTripMode('travel'), false);
});

test('V3 §C8.6: reward math — collected coins capped 30, +5 „Sauberer Lauf", max 35', () => {
  assert.equal(surfTravelRewards({ coins: 12, crashes: 0 }), 12 + SURF_TRAVEL.CLEAN_BONUS); // 17
  assert.equal(surfTravelRewards({ coins: 12, crashes: 2 }), 12); // crashes forfeit only the bonus
  assert.equal(surfTravelRewards({ coins: 40, crashes: 0 }), SURF_TRAVEL.MAX_COINS); // 30 cap + 5 = 35
  assert.equal(surfTravelRewards({ coins: 40, crashes: 3 }), SURF_TRAVEL.COIN_CAP); // 30
  assert.equal(surfTravelRewards({ coins: 0, crashes: 0 }), SURF_TRAVEL.CLEAN_BONUS); // clean broke run pays 5
  assert.equal(surfTravelRewards(), SURF_TRAVEL.CLEAN_BONUS); // defensive default
  // §C8.6 "exactly cityDrive's trip cap": 35 == the drive table max
  assert.equal(SURF_TRAVEL.MAX_COINS, COIN_TABLE.cityDrive.max);
  assert.equal(SURF_TRAVEL.COIN_CAP + SURF_TRAVEL.CLEAN_BONUS, SURF_TRAVEL.MAX_COINS);
});

test('V3 §C8.6: reward math is defensive — fractions floor, negatives clamp', () => {
  assert.equal(surfTravelRewards({ coins: 12.9, crashes: 1 }), 12);
  assert.equal(surfTravelRewards({ coins: -5, crashes: 0 }), SURF_TRAVEL.CLEAN_BONUS);
  assert.equal(clampSurfTravelCoins(99), SURF_TRAVEL.MAX_COINS);
  assert.equal(clampSurfTravelCoins(17), 17);
  assert.equal(clampSurfTravelCoins(-3), 0);
  assert.equal(clampSurfTravelCoins(NaN), 0);
});

test('V3 §C8.6: daily-first-play ×2 applies AFTER the clamp (shared rules)', () => {
  const reward = surfTravelRewards({ coins: 40, crashes: 0 }); // clamps to 35
  assert.equal(computeCoins(COIN_TABLE.shoppingSurf, 0, false, reward), 35);
  assert.equal(computeCoins(COIN_TABLE.shoppingSurf, 0, true, reward), 70); // ×2 AFTER clamp
  const smallRun = surfTravelRewards({ coins: 12, crashes: 0 }); // 17, under the cap
  assert.equal(computeCoins(COIN_TABLE.shoppingSurf, 0, true, smallRun), 34);
});

test('V3 §C8.6: the REAL payout path — awardMinigame pays the override, ×2 exactly once per day', () => {
  const store = makeStore();
  const first = awardMinigame(store, 'shoppingSurf', 35, {
    coinsOverride: surfTravelRewards({ coins: 40, crashes: 0 }),
  });
  assert.equal(first.firstToday, true);
  assert.equal(first.coins, 70); // 35 clamped, THEN doubled
  // second travel run the same local day: no ×2 (lastPlayDay is per GAME —
  // arcade and travel runs share shoppingSurf's daily flag, like cityDrive)
  const second = awardMinigame(store, 'shoppingSurf', 12, {
    coinsOverride: surfTravelRewards({ coins: 12, crashes: 2 }),
  });
  assert.equal(second.firstToday, false);
  assert.equal(second.coins, 12);
});

test('V3 §C8.6: trips counter +1 for BOTH travel methods; vet bump unchanged; surfRuns NOT here', () => {
  const counters = defaultState().achievements.counters;
  bumpTripCounters(counters, 'shopTrip'); // drive arrival
  assert.equal(counters.trips, 1);
  bumpTripCounters(counters, 'shopTrip'); // surf arrival — same shared bump
  assert.equal(counters.trips, 2);
  assert.equal(counters.vetTrips, 0);
  bumpTripCounters(counters, 'vetTrip');
  assert.equal(counters.trips, 3);
  assert.equal(counters.vetTrips, 1);
  // surfRuns counts finished shoppingSurf ROUNDS (both game modes) and is
  // bumped ONLY by the framework's onEnd forwarding — never on arrival.
  assert.equal(counters.surfRuns, 0);
  // defensive: legacy counter shapes without the keys
  assert.deepEqual(bumpTripCounters({}), { trips: 1 });
});

test('V3 §C8.6: energy + unlock spine — travel rate 6 from L1, arcade tile stays 8/L5', () => {
  assert.equal(SURF_TRAVEL.ENERGY, MINIGAME.DRIVE_ENERGY_COST); // car-game rate
  assert.equal(SURF_TRAVEL.ENERGY, 6);
  const meta = MINIGAMES.find((m) => m.id === 'shoppingSurf');
  assert.ok(meta, 'shoppingSurf registered in data/minigames.js');
  // the ARCADE tile keeps its own row (§C8.5): 8 energy, L5 — the framework
  // charges SURF_TRAVEL.ENERGY and skips the lock ONLY for travel launches.
  assert.equal(meta.energyCost, MINIGAME.ENERGY_COST);
  assert.equal(meta.minLevel, 5);
});

test('V3 §C8.6: binding run numbers — 700 m fixed distance, 7 m/s forgiveness jog', () => {
  assert.equal(SURF_TRAVEL.DISTANCE_M, 700);
  assert.equal(SURF_TRAVEL.JOG_SPEED, 7);
  assert.equal(SURF_TRAVEL.GAME_ID, 'shoppingSurf');
  assert.equal(SURF_TRAVEL.MODE, 'surfTravel');
});

test('V3 §C8.6: sleeping gate covers BOTH methods — the chooser sheet never opens asleep', () => {
  // canRequestTrip guards the sheet itself; both options live behind it, so
  // one refusal blocks Fahren AND Laufen (v2 rule carried forward).
  const asleep = defaultState();
  asleep.sleep = { sleeping: true, startedAt: 1, wakeAt: 2 };
  assert.deepEqual(canRequestTrip(asleep), { ok: false, reason: 'sleeping' });
});
// ── end V3/G38 ──────────────────────────────────────────────────────────────
