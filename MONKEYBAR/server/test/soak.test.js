// R10 soak: six CONCURRENT headless bot matches — one per mode, each on a
// different map — run through the REAL server stack (sessions + lobbyManager
// + room + gameRoom + botManager brains) to completion. Asserts:
//   * every match ends and pays the human seat (stats + coins + xp recorded),
//   * ZERO unhandled rejections / uncaught exceptions during the run,
//   * no timer/registry leaks: the lobby room registry AND the botManager's
//     per-room bookkeeping both drain back to 0,
//   * stable-ish memory (loose heap-growth bound).
// Tuned for CI: tiny MONKEYBAR_BOT_DELAY_MS, 60 ms turn deadlines, rigged rng
// streams so eliminations resolve fast. Typical wall time ≈ 10 s.

process.env.MONKEYBAR_BOT_DELAY_MS = '2';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessions } from '../src/net/sessions.js';
import { createLobbyManager } from '../src/lobby/lobbyManager.js';
import { initBotManager } from '../src/bots/botManager.js';
import {
  createProfileStore,
  setActiveProfileStore,
} from '../src/persist/profileStore.js';
import { XP_BASE } from '@monkeybar/shared/constants.js';

const MATCHES = [
  { modeId: 'monkeyLies', mapId: 'peeling_parrot' },
  { modeId: 'bananaDice', mapId: 'neon_nectar' },
  { modeId: 'coconutRoulette', mapId: 'voodoo_vats' },
  { modeId: 'junglePoker', mapId: 'rumble_reef' },
  { modeId: 'kingOfTheBar', mapId: 'canopy_casino' },
  { modeId: 'customChaos', mapId: 'frostbite_lounge' },
];

function waitFor(cond, { timeoutMs = 30000, everyMs = 25, label = 'condition' } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error(`waitFor timed out: ${label}`));
      setTimeout(poll, everyMs);
    };
    poll();
  });
}

test('soak: 6 concurrent bot matches (one per mode) run clean to completion', async () => {
  // ---- trap every async failure for the duration of the run ---------------
  const asyncFailures = [];
  const onRejection = (reason) => asyncFailures.push(`unhandledRejection: ${reason?.stack ?? reason}`);
  const onException = (err) => asyncFailures.push(`uncaughtException: ${err?.stack ?? err}`);
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);

  const heapBefore = process.memoryUsage().heapUsed;

  // ---- the real stack, in memory ------------------------------------------
  const store = createProfileStore({ persist: false });
  setActiveProfileStore(store); // lobby/room.js pays through the active store
  const sessions = createSessions({ profileStore: store });
  const lobby = createLobbyManager({ sessions });
  const botManager = initBotManager({ sessions, lobby });

  try {
    // ---- launch all six matches concurrently ------------------------------
    const running = [];
    for (const [i, { modeId, mapId }] of MATCHES.entries()) {
      const session = sessions.issue({ name: `Soaker-${modeId}` });
      const created = lobby.createRoomFor(session, {
        name: `soak-${modeId}`,
        isPrivate: true,
        maxPlayers: 4,
        mode: modeId,
        botFill: true, // startGame tops the table up to 4 bot seats
      });
      assert.equal(created.ok, true, `${modeId}: createRoom failed: ${created.code}`);
      const room = created.room;
      assert.equal(room.updateSettings(session.playerId, { mapId }).ok, true);
      assert.equal(room.setReady(session.playerId, true).ok, true);

      const res = room.startGame(session.playerId, {
        gameOptions: {
          seed: 100 + i,
          turnSeconds: 0.06, // 60 ms real deadlines back the bot brains up
          autoDelayMs: 4, // fallback covers the disconnected human seat fast
          engineOverrides: {
            intermissionMs: 10,
            penaltyWindowMs: 15,
            cannonRng: () => 0, // every cannon shot hits → fast eliminations
            shakeRng: () => 0, // every roulette shake explodes
            startStack: 3, // junglePoker only: busts arrive fast
          },
        },
      });
      assert.equal(res.ok, true, `${modeId}: startGame failed: ${res.code}`);
      assert.equal(room.state, 'inGame');

      // Drop the human right away: the held seat is auto-played (never AFK-
      // kicked), so this soaks the exact path a vanished player leaves behind.
      room.gameRoom.setConnected(session.playerId, false);
      running.push({ modeId, room, session });
    }
    assert.equal(lobby.rooms.size, MATCHES.length, 'all six rooms registered');

    // ---- run to completion (handleMatchEnd flips the room back to lobby) --
    await Promise.all(
      running.map(({ modeId, room }) =>
        waitFor(() => room.state === 'lobby' && !room.gameRoom, {
          timeoutMs: 60000,
          label: `${modeId} matchEnd`,
        })
      )
    );

    // ---- per-match payout assertions ---------------------------------------
    for (const { modeId, session } of running) {
      const profile = store.payloadFor(session.playerId);
      assert.equal(profile.matches, 1, `${modeId}: match not recorded`);
      assert.equal(profile.stats.perMode[modeId]?.plays, 1, `${modeId}: per-mode stat missing`);
      // Every soak match runs ≥ REWARD_MIN_ROUNDS rounds, so rewards must pay:
      // ≥15 coins for any finish, and at least XP_BASE xp (or a level-up).
      assert.ok(profile.coins >= 15, `${modeId}: no coins paid (coins=${profile.coins})`);
      assert.ok(
        profile.xp >= XP_BASE || profile.level > 1,
        `${modeId}: no xp paid (xp=${profile.xp}, level=${profile.level})`
      );
    }

    // ---- registry / timer-leak assertions ----------------------------------
    // The humans walk away; empty rooms must close and drop out of the registry.
    for (const { modeId, session } of running) {
      assert.equal(lobby.leaveRoom(session).ok, true, `${modeId}: leaveRoom failed`);
    }
    assert.equal(lobby.rooms.size, 0, 'lobby room registry must drain to 0');

    // The botManager tears its per-room bookkeeping down shortly after
    // matchEnd (post-match banter window) — wait for it to hit zero.
    await waitFor(() => botManager.roomCount === 0, {
      timeoutMs: 10000,
      label: 'botManager room bookkeeping drained',
    });

    // ---- async-failure + memory assertions ---------------------------------
    assert.deepEqual(asyncFailures, [], 'no unhandled rejections / uncaught exceptions');

    if (globalThis.gc) globalThis.gc();
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    assert.ok(
      heapGrowth < 96 * 1024 * 1024,
      `heap grew ${(heapGrowth / 1024 / 1024).toFixed(1)} MB — suspicious for 6 headless matches`
    );
  } finally {
    botManager.dispose();
    lobby.shutdown();
    sessions.shutdown();
    setActiveProfileStore(null);
    await store.close();
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  }
});
