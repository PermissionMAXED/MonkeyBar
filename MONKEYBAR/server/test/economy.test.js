// R2 economy: server/src/game/economy.js — §B.4 / PLAN.md §10.4.
// computeMatchRewards math (place coins, XP place-steps, counter bonuses,
// REWARD_MIN_ROUNDS guard) and settleMatch payout routing (bots and
// converted leaver seats never earn; rewards + profile frames per human).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COIN_PER_GOOD_CALL,
  COIN_PER_SURVIVED_SHOT,
  COIN_REWARDS,
  REWARD_MIN_ROUNDS,
  XP_BASE,
  XP_PER_PLACE_STEP,
} from '@monkeybar/shared/constants.js';
import { MSG } from '@monkeybar/shared/protocol.js';

import { computeMatchRewards, settleMatch } from '../src/game/economy.js';
import { createProfileStore } from '../src/persist/profileStore.js';

const quietLog = { info() {}, warn() {}, error() {}, debug() {}, child: () => quietLog };
const memStore = () => createProfileStore({ persist: false, log: quietLog });

// ---------------------------------------------------------------------------
// computeMatchRewards
// ---------------------------------------------------------------------------

test('rewards: §B.4 place coins and XP place-steps', () => {
  // 4-player table: winner takes COIN_REWARDS[1] and XP_BASE + 3 steps.
  const first = computeMatchRewards({ place: 1, playerCount: 4, roundNo: 5 });
  assert.equal(first.coins, COIN_REWARDS[1]);
  assert.equal(first.xp, XP_BASE + 3 * XP_PER_PLACE_STEP);

  assert.equal(computeMatchRewards({ place: 2, playerCount: 4, roundNo: 5 }).coins, COIN_REWARDS[2]);
  assert.equal(computeMatchRewards({ place: 3, playerCount: 4, roundNo: 5 }).coins, COIN_REWARDS[3]);

  // 4th and below fall into `other`; last place earns exactly XP_BASE.
  const last = computeMatchRewards({ place: 4, playerCount: 4, roundNo: 5 });
  assert.equal(last.coins, COIN_REWARDS.other);
  assert.equal(last.xp, XP_BASE);
  assert.equal(computeMatchRewards({ place: 8, playerCount: 8, roundNo: 5 }).coins, COIN_REWARDS.other);
  assert.equal(
    computeMatchRewards({ place: 1, playerCount: 8, roundNo: 5 }).xp,
    XP_BASE + 7 * XP_PER_PLACE_STEP
  );
});

test('rewards: per-match counter bonuses and a consistent breakdown', () => {
  const r = computeMatchRewards({
    place: 2,
    playerCount: 4,
    roundNo: 6,
    goodCalls: 3,
    survivedShots: 2,
  });
  assert.equal(
    r.coins,
    COIN_REWARDS[2] + 3 * COIN_PER_GOOD_CALL + 2 * COIN_PER_SURVIVED_SHOT
  );
  assert.equal(r.xp, XP_BASE + 2 * XP_PER_PLACE_STEP);
  assert.equal(r.breakdown.length, 3, 'place + goodCalls + survivedShots lines');
  assert.equal(r.breakdown.reduce((n, b) => n + b.coins, 0), r.coins, 'breakdown sums to totals');
  assert.equal(r.breakdown.reduce((n, b) => n + b.xp, 0), r.xp);
  assert.ok(r.breakdown.every((b) => typeof b.reason === 'string' && b.reason.length > 0));

  // Zero counters keep the breakdown to the place line only.
  const bare = computeMatchRewards({ place: 1, playerCount: 4, roundNo: 6 });
  assert.equal(bare.breakdown.length, 1);
});

test('rewards: REWARD_MIN_ROUNDS anti-farm guard', () => {
  assert.equal(computeMatchRewards({ place: 1, playerCount: 4, roundNo: REWARD_MIN_ROUNDS - 1 }), null);
  assert.notEqual(computeMatchRewards({ place: 1, playerCount: 4, roundNo: REWARD_MIN_ROUNDS }), null);
  assert.equal(computeMatchRewards({ place: 0, playerCount: 4, roundNo: 5 }), null, 'bad place');
});

// ---------------------------------------------------------------------------
// settleMatch
// ---------------------------------------------------------------------------

/** 4-seat fixture: seat 1 is a real bot, seat 3 converted to a bot (leaver). */
function fixture() {
  const seats = [
    { seat: 0, playerId: 'human-winner', isBot: false },
    { seat: 1, playerId: 'bot-1', isBot: true },
    { seat: 2, playerId: 'human-third', isBot: false },
    { seat: 3, playerId: 'human-leaver', isBot: true }, // left mid-match → converted
  ];
  const standings = [
    { seat: 0, name: 'Winner', place: 1 },
    { seat: 1, name: 'Bot', place: 2 },
    { seat: 2, name: 'Third', place: 3 },
    { seat: 3, name: 'Leaver', place: 4 },
  ];
  const sent = [];
  return {
    seats,
    standings,
    sent,
    seatAt: (seat) => seats[seat],
    send: (playerId, envelope) => sent.push({ playerId, envelope }),
  };
}

test('settleMatch: humans get rewards+profile; bots and leaver seats earn nothing', () => {
  const store = memStore();
  const { standings, sent, seatAt, send } = fixture();

  const paid = settleMatch({
    store,
    modeId: 'monkeyLies',
    roundNo: 5,
    standings,
    seatAt,
    countersFor: (seat) => (seat === 0 ? { goodCalls: 2, survivedShots: 1 } : {}),
    send,
  });

  assert.deepEqual(paid.map((p) => p.playerId).sort(), ['human-third', 'human-winner']);

  // Winner: place coins + counter bonuses, credited to the profile.
  const winner = store.getOrCreate('human-winner');
  assert.equal(winner.coins, COIN_REWARDS[1] + 2 * COIN_PER_GOOD_CALL + COIN_PER_SURVIVED_SHOT);
  assert.equal(winner.wins, 1);
  assert.equal(winner.matches, 1);
  assert.deepEqual(winner.stats.perMode, { monkeyLies: { plays: 1, wins: 1 } });

  // Third place: no win, `other`-tier coins do not apply (place 3 has its own).
  const third = store.getOrCreate('human-third');
  assert.equal(third.coins, COIN_REWARDS[3]);
  assert.equal(third.wins, 0);

  // Bots (incl. the converted leaver seat) never reach the store.
  assert.equal(store.size, 2, 'only the two humans have profiles');

  // Frames: PRIVATE rewards + fresh profile per human, nothing for bots.
  const rewardFrames = sent.filter(({ envelope }) => envelope.t === MSG.REWARDS);
  const profileFrames = sent.filter(({ envelope }) => envelope.t === MSG.PROFILE);
  assert.deepEqual(rewardFrames.map((f) => f.playerId).sort(), ['human-third', 'human-winner']);
  assert.deepEqual(profileFrames.map((f) => f.playerId).sort(), ['human-third', 'human-winner']);

  const winnerRewards = rewardFrames.find((f) => f.playerId === 'human-winner').envelope.p;
  assert.equal(winnerRewards.coins, winner.coins);
  assert.equal(winnerRewards.newLevel, winner.level);
  assert.equal(typeof winnerRewards.levelUps, 'number');
  assert.ok(Array.isArray(winnerRewards.breakdown) && winnerRewards.breakdown.length === 3);

  const winnerProfile = profileFrames.find((f) => f.playerId === 'human-winner').envelope.p;
  assert.equal(winnerProfile.coins, winner.coins, 'profile frame reflects the payout');
});

test('settleMatch: short match pays no rewards but still bumps stats', () => {
  const store = memStore();
  const { standings, sent, seatAt, send } = fixture();

  const paid = settleMatch({
    store,
    modeId: 'monkeyLies',
    roundNo: REWARD_MIN_ROUNDS - 1,
    standings,
    seatAt,
    send,
  });

  assert.deepEqual(paid, [], 'nobody earns below REWARD_MIN_ROUNDS');
  assert.equal(sent.filter(({ envelope }) => envelope.t === MSG.REWARDS).length, 0);
  // The match still counts toward stats, and each human still gets a profile.
  assert.equal(store.getOrCreate('human-winner').matches, 1);
  assert.equal(store.getOrCreate('human-winner').coins, 0);
  assert.equal(sent.filter(({ envelope }) => envelope.t === MSG.PROFILE).length, 2);
});

test('settleMatch: tolerates a missing store or malformed standings', () => {
  const { standings, seatAt, send } = fixture();
  assert.deepEqual(settleMatch({ store: null, modeId: 'x', roundNo: 5, standings, seatAt, send }), []);
  const store = memStore();
  assert.deepEqual(
    settleMatch({ store, modeId: 'x', roundNo: 5, standings: null, seatAt, send }),
    []
  );
  // A standing pointing at a nonexistent seat is skipped, not fatal.
  const paid = settleMatch({
    store,
    modeId: 'monkeyLies',
    roundNo: 5,
    standings: [{ seat: 99, name: 'Ghost', place: 1 }],
    seatAt: () => {
      throw new RangeError('no seat 99');
    },
    send,
  });
  assert.deepEqual(paid, []);
});
