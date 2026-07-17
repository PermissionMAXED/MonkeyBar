// Quest engine (§B7/§C5.1): deterministic daily roll per day-string, unlock
// (`requires`) filtering, ≥ 2 distinct categories, progress/claim/double-claim
// guards, reward passthrough, reroll once per day + midnight rollover via
// injected nowMs, and claimableCount. The fixture pool is the §C5.1 table
// verbatim (28 entries) — the engine is catalog-injected (§E0.1-3), the real
// catalog (constants.QUEST_POOL) lands with G16.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRequireMet,
  rollDaily,
  track,
  claim,
  reroll,
  claimableCount,
} from '../src/systems/quests.js';

// §C5.1 quest pool, verbatim (28 entries). Event names are the condition
// column; `match`/`mode` encode the per-game / single-run / distinct
// semantics for the wave-2 call sites (see systems/quests.js header).
const POOL = [
  { id: 'q.feed3',            category: 'care',    event: 'feed',             target: 3,   reward: { coins: 20, xp: 10 } },
  { id: 'q.feedHealthy2',     category: 'care',    event: 'feedHealthy',      target: 2,   reward: { coins: 25, xp: 10 } },
  { id: 'q.wash1',            category: 'care',    event: 'wash',             target: 1,   reward: { coins: 20, xp: 10 } },
  { id: 'q.pet5',             category: 'care',    event: 'pet',              target: 5,   reward: { coins: 15, xp: 8 } },
  { id: 'q.tickle3',          category: 'care',    event: 'tickle',           target: 3,   reward: { coins: 15, xp: 8 } },
  { id: 'q.ball3',            category: 'care',    event: 'ballFetch',        target: 3,   reward: { coins: 20, xp: 10 } },
  { id: 'q.sleep1',           category: 'care',    event: 'napComplete',      target: 1,   reward: { coins: 25, xp: 12 } },
  { id: 'q.medicineCabinet',  category: 'care',    event: 'statsScreen',      target: 1,   reward: { coins: 10, xp: 5 } },
  { id: 'q.play3',            category: 'games',   event: 'minigameFinish',   target: 3,   reward: { coins: 30, xp: 15 } },
  { id: 'q.play2distinct',    category: 'games',   event: 'minigameFinish',   target: 2,   reward: { coins: 25, xp: 12 }, mode: 'distinct' },
  { id: 'q.earn60',           category: 'games',   event: 'minigameCoins',    target: 60,  reward: { coins: 30, xp: 15 } },
  { id: 'q.catch30',          category: 'games',   event: 'minigameScore',    target: 30,  reward: { coins: 25, xp: 12 }, mode: 'max', match: { id: 'carrotCatch' } },
  { id: 'q.hop10',            category: 'games',   event: 'minigameScore',    target: 10,  reward: { coins: 25, xp: 12 }, mode: 'max', match: { id: 'bunnyHop' } },
  { id: 'q.run200',           category: 'games',   event: 'minigameScore',    target: 200, reward: { coins: 30, xp: 15 }, mode: 'max', match: { id: 'runner' },     requires: { game: 'runner' } },
  { id: 'q.fish5',            category: 'games',   event: 'fishCaught',       target: 5,   reward: { coins: 25, xp: 12 }, requires: { game: 'fishingPond' } },
  { id: 'q.dance150',         category: 'games',   event: 'minigameScore',    target: 150, reward: { coins: 30, xp: 15 }, mode: 'max', match: { id: 'danceParty' }, requires: { game: 'danceParty' } },
  { id: 'q.tricks5',          category: 'games',   event: 'trampolineTricks', target: 5,   reward: { coins: 25, xp: 12 }, mode: 'max', requires: { game: 'trampoline' } },
  { id: 'q.golfPar',          category: 'games',   event: 'minigameScore',    target: 70,  reward: { coins: 30, xp: 15 }, mode: 'max', match: { id: 'miniGolf' },   requires: { game: 'miniGolf' } },
  { id: 'q.says6',            category: 'games',   event: 'minigameScore',    target: 6,   reward: { coins: 25, xp: 12 }, mode: 'max', match: { id: 'goobySays' }, requires: { game: 'goobySays' } },
  { id: 'q.plant2',           category: 'garden',  event: 'plant',            target: 2,   reward: { coins: 20, xp: 10 }, requires: { garden: true } },
  { id: 'q.water4',           category: 'garden',  event: 'water',            target: 4,   reward: { coins: 20, xp: 10 }, requires: { garden: true } },
  { id: 'q.harvest2',         category: 'garden',  event: 'harvest',          target: 2,   reward: { coins: 30, xp: 15 }, requires: { garden: true } },
  { id: 'q.sell1',            category: 'garden',  event: 'sell',             target: 1,   reward: { coins: 15, xp: 8 },  requires: { garden: true } },
  { id: 'q.drive1',           category: 'economy', event: 'shopTrip',         target: 1,   reward: { coins: 30, xp: 15 } },
  { id: 'q.cleanDrive',       category: 'economy', event: 'cleanDrive',       target: 1,   reward: { coins: 35, xp: 15 } },
  { id: 'q.deliver3',         category: 'economy', event: 'deliver',          target: 3,   reward: { coins: 30, xp: 15 }, requires: { game: 'deliveryRush' } },
  { id: 'q.buyFood1',         category: 'economy', event: 'buyFood',          target: 1,   reward: { coins: 15, xp: 8 } },
  { id: 'q.photo1',           category: 'economy', event: 'photo',            target: 1,   reward: { coins: 20, xp: 10 } },
];
const byId = Object.fromEntries(POOL.map((d) => [d.id, d]));
const GATED_IDS = POOL.filter((d) => d.requires).map((d) => d.id);

const FULL_CTX = {
  level: 40,
  unlockedGameIds: [
    'runner', 'fishingPond', 'danceParty', 'trampoline', 'miniGolf', 'goobySays', 'deliveryRush',
  ],
  gardenUnlocked: true,
};
const FRESH_CTX = { level: 1, unlockedGameIds: [], gardenUnlocked: false };

/** Fresh §B2 quests slice (defaults land in save.js with G16). */
function freshQuests() {
  return { day: '', active: [], rerolledDay: '', completedTotal: 0 };
}

/** Local-noon epoch ms for a YYYY-MM-DD day string (device-local, like localDay). */
function dayMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

/** '2026-01-<dd>' for dd 1–31, then walks months — many distinct local days. */
function nthDay(n) {
  const d = new Date(2026, 0, 1 + n, 12);
  return d.getTime();
}

// ------------------------------------------------------------- requires

test('isRequireMet: feature/level/minigame gates (§B7)', () => {
  assert.equal(isRequireMet(undefined, FRESH_CTX), true);
  assert.equal(isRequireMet(null, FRESH_CTX), true);
  assert.equal(isRequireMet({ game: 'runner' }, FRESH_CTX), false);
  assert.equal(isRequireMet({ game: 'runner' }, FULL_CTX), true);
  assert.equal(isRequireMet('runner', FULL_CTX), true); // string shorthand
  assert.equal(isRequireMet({ garden: true }, FRESH_CTX), false);
  assert.equal(isRequireMet({ garden: true }, FULL_CTX), true);
  assert.equal(isRequireMet({ level: 3 }, FRESH_CTX), false);
  assert.equal(isRequireMet({ level: 3 }, { ...FRESH_CTX, level: 3 }), true);
});

// ------------------------------------------------------------- daily roll

test('rollDaily: deterministic per day-string — same day+ctx ⇒ identical board', () => {
  const a = rollDaily(freshQuests(), dayMs('2026-07-17'), POOL, FULL_CTX);
  const b = rollDaily(freshQuests(), dayMs('2026-07-17'), POOL, FULL_CTX);
  assert.deepEqual(a, b);
  assert.equal(a.day, '2026-07-17');
  assert.equal(a.active.length, 3);
  for (const e of a.active) {
    assert.deepEqual(e, { id: e.id, progress: 0, claimed: false });
    assert.ok(byId[e.id], `known pool id ${e.id}`);
  }
  // 3 unique ids
  assert.equal(new Set(a.active.map((e) => e.id)).size, 3);
  // …and a different time on the SAME local day rolls the SAME board
  const c = rollDaily(freshQuests(), dayMs('2026-07-17') + 7 * 3600_000, POOL, FULL_CTX);
  assert.deepEqual(c.active, a.active);
});

test('rollDaily: no-op (same reference) when the day already matches', () => {
  const rolled = rollDaily(freshQuests(), dayMs('2026-07-17'), POOL, FULL_CTX);
  const again = rollDaily(rolled, dayMs('2026-07-17') + 3600_000, POOL, FULL_CTX);
  assert.equal(again, rolled);
});

test('rollDaily: midnight rollover replaces the board (injected nowMs)', () => {
  let q = rollDaily(freshQuests(), dayMs('2026-07-17'), POOL, FULL_CTX);
  q = track(q, 'feed', 1, undefined, POOL).q; // some progress today
  const next = rollDaily(q, dayMs('2026-07-18'), POOL, FULL_CTX);
  assert.equal(next.day, '2026-07-18');
  assert.equal(next.active.length, 3);
  for (const e of next.active) assert.deepEqual([e.progress, e.claimed], [0, false]);
});

test('rollDaily: unlock filtering — a fresh L1 player never sees gated quests (60 days)', () => {
  for (let n = 0; n < 60; n += 1) {
    const q = rollDaily(freshQuests(), nthDay(n), POOL, FRESH_CTX);
    for (const e of q.active) {
      assert.ok(!GATED_IDS.includes(e.id), `day ${n}: ${e.id} requires an unlock`);
    }
  }
});

test('rollDaily: ≥ 2 distinct categories on every roll (120 days, both ctx)', () => {
  for (const ctx of [FULL_CTX, FRESH_CTX]) {
    for (let n = 0; n < 120; n += 1) {
      const q = rollDaily(freshQuests(), nthDay(n), POOL, ctx);
      const cats = new Set(q.active.map((e) => byId[e.id].category));
      assert.ok(cats.size >= 2, `day ${n}: categories ${[...cats]}`);
      assert.equal(new Set(q.active.map((e) => e.id)).size, 3, `day ${n}: unique ids`);
    }
  }
});

test('rollDaily: gated quests DO appear once unlocked (spread over 120 days)', () => {
  const seen = new Set();
  for (let n = 0; n < 120; n += 1) {
    for (const e of rollDaily(freshQuests(), nthDay(n), POOL, FULL_CTX).active) seen.add(e.id);
  }
  assert.ok(GATED_IDS.some((id) => seen.has(id)), 'no gated quest ever rolled');
  assert.ok(seen.size > 15, `variety over 120 days (saw ${seen.size})`);
});

// ------------------------------------------------------ track / progress

/** Roll a fixed board for tracking tests: replace active with known ids. */
function boardWith(...ids) {
  return {
    ...freshQuests(),
    day: '2026-07-17',
    active: ids.map((id) => ({ id, progress: 0, claimed: false })),
  };
}

test('track: matching events add progress, clamp at target, flag changed', () => {
  let q = boardWith('q.feed3', 'q.wash1');
  let r = track(q, 'feed', 1, undefined, POOL);
  assert.equal(r.changed, true);
  assert.equal(r.q.active[0].progress, 1);
  assert.equal(r.q.active[1].progress, 0); // different event untouched
  r = track(r.q, 'feed', 5, undefined, POOL);
  assert.equal(r.q.active[0].progress, 3); // clamped at target
  // non-matching event: unchanged, SAME reference back
  const miss = track(r.q, 'tickle', 1, undefined, POOL);
  assert.equal(miss.changed, false);
  assert.equal(miss.q, r.q);
});

test("track: 'max' mode + match filter — single-run score thresholds (q.catch30)", () => {
  let q = boardWith('q.catch30');
  let r = track(q, 'minigameScore', 20, { id: 'carrotCatch' }, POOL);
  assert.equal(r.q.active[0].progress, 20);
  r = track(r.q, 'minigameScore', 10, { id: 'carrotCatch' }, POOL);
  assert.equal(r.q.active[0].progress, 20); // best-of, never additive
  assert.equal(r.changed, false);
  // wrong game never advances it
  r = track(r.q, 'minigameScore', 999, { id: 'bunnyHop' }, POOL);
  assert.equal(r.q.active[0].progress, 20);
  r = track(r.q, 'minigameScore', 31, { id: 'carrotCatch' }, POOL);
  assert.equal(r.q.active[0].progress, 30); // clamped, claimable
  assert.equal(claimableCount(r.q, POOL), 1);
});

test("track: 'distinct' mode counts different minigames once each (q.play2distinct)", () => {
  let q = boardWith('q.play2distinct', 'q.play3');
  let r = track(q, 'minigameFinish', 1, { id: 'runner' }, POOL);
  assert.equal(r.q.active[0].progress, 1);
  assert.equal(r.q.active[1].progress, 1); // plain counter rides the same event
  r = track(r.q, 'minigameFinish', 1, { id: 'runner' }, POOL); // repeat game
  assert.equal(r.q.active[0].progress, 1); // distinct: no repeat credit
  assert.equal(r.q.active[1].progress, 2);
  r = track(r.q, 'minigameFinish', 1, { id: 'bunnyHop' }, POOL);
  assert.equal(r.q.active[0].progress, 2); // second distinct game completes it
});

test('track: coin-amount quests advance by n (q.earn60)', () => {
  let q = boardWith('q.earn60');
  let r = track(q, 'minigameCoins', 25, undefined, POOL);
  r = track(r.q, 'minigameCoins', 45, undefined, POOL);
  assert.equal(r.q.active[0].progress, 60); // 25+45 clamped at 60
  assert.equal(claimableCount(r.q, POOL), 1);
});

test('track: claimed quests stop tracking; empty board is a no-op', () => {
  let q = boardWith('q.feed3');
  q = track(q, 'feed', 3, undefined, POOL).q;
  q = claim(q, 'q.feed3', POOL).q;
  const r = track(q, 'feed', 1, undefined, POOL);
  assert.equal(r.changed, false);
  assert.equal(r.q.active[0].progress, 3);
  const empty = freshQuests();
  assert.equal(track(empty, 'feed', 1, undefined, POOL).q, empty);
});

// ---------------------------------------------------------------- claim

test('claim: reward passthrough at target; refuses early / double / unknown (§B7)', () => {
  let q = boardWith('q.feed3', 'q.drive1');
  assert.deepEqual(claim(q, 'q.feed3', POOL), { ok: false }); // no progress yet
  q = track(q, 'feed', 2, undefined, POOL).q;
  assert.deepEqual(claim(q, 'q.feed3', POOL), { ok: false }); // 2 of 3
  q = track(q, 'feed', 1, undefined, POOL).q;
  const r = claim(q, 'q.feed3', POOL);
  assert.deepEqual(r.reward, { coins: 20, xp: 10 }); // §C5.1 row verbatim
  assert.equal(r.q.active[0].claimed, true);
  assert.equal(r.q.completedTotal, 1);
  assert.deepEqual(claim(r.q, 'q.feed3', POOL), { ok: false }); // double claim
  assert.deepEqual(claim(r.q, 'q.nope', POOL), { ok: false }); // unknown id
  // second quest still claimable independently
  const q2 = track(r.q, 'shopTrip', 1, undefined, POOL).q;
  const r2 = claim(q2, 'q.drive1', POOL);
  assert.deepEqual(r2.reward, { coins: 30, xp: 15 });
  assert.equal(r2.q.completedTotal, 2);
});

test('claimableCount: HUD badge counts unclaimed complete quests only', () => {
  let q = boardWith('q.feed3', 'q.wash1', 'q.pet5');
  assert.equal(claimableCount(q, POOL), 0);
  q = track(q, 'wash', 1, undefined, POOL).q;
  q = track(q, 'feed', 3, undefined, POOL).q;
  assert.equal(claimableCount(q, POOL), 2);
  q = claim(q, 'q.wash1', POOL).q;
  assert.equal(claimableCount(q, POOL), 1);
});

// --------------------------------------------------------------- reroll

test('reroll: replaces only unclaimed + un-progressed quests, once per day (§B7)', () => {
  const now = dayMs('2026-07-17');
  let q = rollDaily(freshQuests(), now, POOL, FULL_CTX);
  const beforeIds = q.active.map((e) => e.id);
  // progress one, claim-complete another? keep it simple: progress slot 0
  q = track(q, byId[beforeIds[0]].event, 1, { id: 'carrotCatch' }, POOL).q;
  const progressed = q.active.filter((e) => e.progress > 0).map((e) => e.id);
  const r = reroll(q, now, POOL, FULL_CTX);
  assert.equal(r.ok, true);
  assert.equal(r.q.rerolledDay, '2026-07-17');
  assert.equal(r.q.active.length, 3);
  // progressed quests survived in place; replaced ones are fresh + off-board ids
  for (const id of progressed) assert.ok(r.q.active.some((e) => e.id === id), `${id} kept`);
  for (const e of r.q.active) {
    if (!progressed.includes(e.id)) {
      assert.ok(!beforeIds.includes(e.id), `${e.id} is a fresh pick`);
      assert.deepEqual([e.progress, e.claimed], [0, false]);
    }
  }
  // ≥ 2 categories still holds after the reroll
  const cats = new Set(r.q.active.map((e) => byId[e.id].category));
  assert.ok(cats.size >= 2);
  // deterministic: same inputs ⇒ same result
  assert.deepEqual(reroll(q, now, POOL, FULL_CTX).q, r.q);
  // once per day
  assert.equal(reroll(r.q, now, POOL, FULL_CTX).ok, false);
});

test('reroll: available again after the midnight rollover (injected nowMs)', () => {
  const day1 = dayMs('2026-07-17');
  const day2 = dayMs('2026-07-18');
  let q = rollDaily(freshQuests(), day1, POOL, FULL_CTX);
  q = reroll(q, day1, POOL, FULL_CTX).q;
  assert.equal(reroll(q, day1, POOL, FULL_CTX).ok, false); // used up today
  q = rollDaily(q, day2, POOL, FULL_CTX); // new day, new board
  const r = reroll(q, day2, POOL, FULL_CTX);
  assert.equal(r.ok, true);
  assert.equal(r.q.rerolledDay, '2026-07-18');
});

test('reroll: refuses without burning when nothing is replaceable or the roll is stale', () => {
  const now = dayMs('2026-07-17');
  // progress ALL three → nothing replaceable (complete-but-unclaimed counts as progressed)
  let q = boardWith('q.feed3', 'q.wash1', 'q.pet5');
  q = track(q, 'feed', 1, undefined, POOL).q;
  q = track(q, 'wash', 1, undefined, POOL).q;
  q = track(q, 'pet', 2, undefined, POOL).q;
  const r = reroll(q, now, POOL, FULL_CTX);
  assert.equal(r.ok, false);
  assert.equal(r.q.rerolledDay, ''); // reroll NOT burned
  // stale board (yesterday's roll) refuses — wiring must rollDaily first
  const stale = rollDaily(freshQuests(), dayMs('2026-07-16'), POOL, FULL_CTX);
  assert.equal(reroll(stale, now, POOL, FULL_CTX).ok, false);
});

// ---------------------------------------------------------------- purity

test('quest functions are pure: deep-frozen slices never throw/mutate', () => {
  const freeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v);
    return Object.freeze(o);
  };
  freeze(rollDaily(freshQuests(), dayMs('2026-07-17'), POOL, FULL_CTX));
  const q0 = freeze(boardWith('q.feed3', 'q.drive1', 'q.plant2'));
  const tracked = track(q0, 'feed', 1, undefined, POOL).q;
  assert.notEqual(tracked, q0);
  assert.equal(tracked.active[0].progress, 1);
  reroll(freeze(tracked), dayMs('2026-07-17'), POOL, FULL_CTX);
  claimableCount(q0, POOL);
  assert.equal(q0.active[0].progress, 0); // originals untouched
});
