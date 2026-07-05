// End-of-match economy — RELEASE_PLAN.md §B.4 / PLAN.md §10.4 (R2).
//
// computeMatchRewards turns one player's final standing (+ the per-match
// counters gameRoom collected) into a Rewards payload; settleMatch walks the
// matchEnd standings and pays every eligible HUMAN seat through the profile
// store. Guards:
//   * no rewards when the match ran shorter than REWARD_MIN_ROUNDS (anti-farm);
//   * bots never earn — and a player who left/was kicked mid-match is a bot
//     seat by matchEnd (their reward eligibility left with them);
//   * stats (matches/wins) still bump for humans who finish a short match.

import {
  COIN_PER_GOOD_CALL,
  COIN_PER_SURVIVED_SHOT,
  COIN_REWARDS,
  REWARD_MIN_ROUNDS,
  XP_BASE,
  XP_PER_PLACE_STEP,
} from '@monkeybar/shared/constants.js';
import { ServerMsg } from '@monkeybar/shared/protocol.js';

/**
 * §B.4 reward math for one finishing player.
 * Coins: COIN_REWARDS by place (`other` = 4th and below) + per-match bonuses
 * (COIN_PER_GOOD_CALL × successful calls, COIN_PER_SURVIVED_SHOT × survived
 * cannon shots). XP: XP_BASE for last place + XP_PER_PLACE_STEP per place
 * climbed above last.
 *
 * @param {Object} options
 * @param {number} options.place        final standing (1 = winner)
 * @param {number} options.playerCount  total seats in the standings
 * @param {number} options.roundNo      rounds the match ran
 * @param {number} [options.goodCalls]
 * @param {number} [options.survivedShots]
 * @returns {{coins: number, xp: number, breakdown: Array<{reason: string, coins: number, xp: number}>}|null}
 *          null = no rewards (short match / bad standing)
 */
export function computeMatchRewards({ place, playerCount, roundNo, goodCalls = 0, survivedShots = 0 }) {
  if (!Number.isInteger(place) || place < 1) return null;
  if (!Number.isInteger(roundNo) || roundNo < REWARD_MIN_ROUNDS) return null;
  const seats = Number.isInteger(playerCount) && playerCount >= place ? playerCount : place;

  const placeCoins = COIN_REWARDS[place] ?? COIN_REWARDS.other;
  const placeXp = XP_BASE + XP_PER_PLACE_STEP * (seats - place);
  const breakdown = [
    { reason: place === 1 ? 'Last monkey standing' : `Finished #${place}`, coins: placeCoins, xp: placeXp },
  ];
  if (goodCalls > 0) {
    breakdown.push({ reason: `Good calls ×${goodCalls}`, coins: goodCalls * COIN_PER_GOOD_CALL, xp: 0 });
  }
  if (survivedShots > 0) {
    breakdown.push({
      reason: `Cannon shots survived ×${survivedShots}`,
      coins: survivedShots * COIN_PER_SURVIVED_SHOT,
      xp: 0,
    });
  }
  return {
    coins: breakdown.reduce((n, b) => n + b.coins, 0),
    xp: breakdown.reduce((n, b) => n + b.xp, 0),
    breakdown,
  };
}

/**
 * Pay out a finished match: bump stats + credit rewards for every HUMAN seat
 * in the standings, sending each player a PRIVATE `rewards` frame (when they
 * earned any) followed by a fresh `profile` frame (§10.2).
 *
 * @param {Object} options
 * @param {ReturnType<import('../persist/profileStore.js').createProfileStore>} options.store
 * @param {string} options.modeId
 * @param {number} options.roundNo
 * @param {Array<{seat: number, name: string, place: number}>} options.standings  matchEnd standings
 * @param {(seat: number) => {isBot: boolean, playerId: string}} options.seatAt
 * @param {(seat: number) => {goodCalls?: number, survivedShots?: number}} [options.countersFor]
 * @param {(playerId: string, envelope: {t: string, p: Object}) => void} options.send
 * @returns {Array<{seat: number, playerId: string, coins: number, xp: number}>} what was paid
 */
export function settleMatch({ store, modeId, roundNo, standings, seatAt, countersFor = () => ({}), send }) {
  if (!store || !Array.isArray(standings)) return [];
  const paid = [];
  for (const standing of standings) {
    let seat;
    try {
      seat = seatAt(standing.seat);
    } catch {
      continue;
    }
    if (!seat || seat.isBot) continue; // bots (incl. converted leaver seats) never earn
    const playerId = seat.playerId;
    store.bumpStats(playerId, modeId, { win: standing.place === 1 });
    const counters = countersFor(standing.seat) ?? {};
    const rewards = computeMatchRewards({
      place: standing.place,
      playerCount: standings.length,
      roundNo,
      goodCalls: counters.goodCalls ?? 0,
      survivedShots: counters.survivedShots ?? 0,
    });
    if (rewards) {
      const { levelUps, newLevel } = store.addRewards(playerId, { coins: rewards.coins, xp: rewards.xp });
      send(
        playerId,
        ServerMsg.rewards({
          coins: rewards.coins,
          xp: rewards.xp,
          levelUps,
          newLevel,
          breakdown: rewards.breakdown,
        })
      );
      paid.push({ seat: standing.seat, playerId, coins: rewards.coins, xp: rewards.xp });
    }
    send(playerId, ServerMsg.profile(store.payloadFor(playerId)));
  }
  return paid;
}
