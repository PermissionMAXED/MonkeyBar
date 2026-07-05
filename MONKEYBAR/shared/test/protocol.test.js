import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MSG,
  ERROR_CODES,
  validateClientMsg,
  ClientMsg,
  ServerMsg,
  encodeMsg,
  CLIENT_MSG_TYPES,
} from '../src/protocol.js';
import { MAX_PLAY, MAX_PLAY_HARD, MODE_ACTION_MAX_LENGTH } from '../src/constants.js';
import { CHAOS_KNOB_SCHEMA } from '../src/chaos.js';

const enc = (t, p) => JSON.stringify({ t, p });

// ---- accepts valid messages ------------------------------------------------

test('validateClientMsg accepts a valid hello', () => {
  const res = validateClientMsg(enc(MSG.HELLO, { name: 'Rico', token: 'abc' }));
  assert.deepEqual(res, { ok: true, t: 'hello', p: { name: 'Rico', token: 'abc' } });
});

test('validateClientMsg accepts hello with empty payload and missing payload', () => {
  assert.equal(validateClientMsg(enc(MSG.HELLO, {})).ok, true);
  assert.equal(validateClientMsg(JSON.stringify({ t: MSG.HELLO })).ok, true);
});

test('validateClientMsg accepts a valid createRoom', () => {
  const res = validateClientMsg(
    enc(MSG.CREATE_ROOM, { name: 'Bar Brawl', isPrivate: true, maxPlayers: 6, mode: 'monkeyLies', botFill: true })
  );
  assert.equal(res.ok, true);
  assert.equal(res.t, MSG.CREATE_ROOM);
});

test('validateClientMsg accepts a valid play (1–MAX_PLAY_HARD unique card ids)', () => {
  assert.equal(validateClientMsg(enc(MSG.PLAY, { aid: 'a1', cardIds: ['c1'] })).ok, true);
  assert.equal(validateClientMsg(enc(MSG.PLAY, { aid: 'a2', cardIds: ['c1', 'c2', 'c3'] })).ok, true);
  // The wire cap is MAX_PLAY_HARD (4), not the stock MAX_PLAY (3): a Custom
  // Chaos room with maxPlay 4 must get its 4-card play PAST the validator —
  // standard modes still reject >3 in the ENGINE (rules.maxPlay).
  assert.equal(validateClientMsg(enc(MSG.PLAY, { aid: 'a3', cardIds: ['c1', 'c2', 'c3', 'c4'] })).ok, true);
});

test('MAX_PLAY_HARD covers the chaos maxPlay bound (wire cap ≥ every legal play)', () => {
  assert.equal(MAX_PLAY_HARD, CHAOS_KNOB_SCHEMA.maxPlay.max, 'wire cap must track the chaos schema max');
  assert.ok(MAX_PLAY_HARD >= MAX_PLAY, 'wire cap must cover the stock rules too');
});

test('validateClientMsg accepts Buffer input', () => {
  const res = validateClientMsg(Buffer.from(enc(MSG.PING, { ts: 123 })));
  assert.deepEqual(res, { ok: true, t: 'ping', p: { ts: 123 } });
});

test('validateClientMsg accepts every ClientMsg factory output', () => {
  const samples = [
    ClientMsg.hello({ name: 'Bolt' }),
    ClientMsg.setProfile({ monkeyId: 'bolt' }),
    ClientMsg.listRooms(),
    ClientMsg.createRoom({ isPrivate: false, maxPlayers: 4, mode: 'monkeyLies', botFill: true }),
    ClientMsg.joinRoom({ roomId: 'r1' }),
    ClientMsg.joinRoom({ code: 'ABCD' }),
    ClientMsg.leaveRoom(),
    ClientMsg.quickMatch('monkeyLies'),
    ClientMsg.cancelQuick(),
    ClientMsg.ready(true),
    ClientMsg.selectMonkey('rico'),
    ClientMsg.addBot('aggressive'),
    ClientMsg.addBot(),
    ClientMsg.removeBot('b1'),
    ClientMsg.updateSettings({ turnSeconds: 30, mapId: 'neon_nectar' }),
    ClientMsg.startGame(),
    ClientMsg.play('a1', ['c1', 'c2']),
    ClientMsg.callLiar('a2'),
    ClientMsg.useChip('a3'),
    ClientMsg.fireCannon('a9'),
    ClientMsg.chat('You are lying.'),
    ClientMsg.quickPhrase('youre_lying'),
    ClientMsg.emote('laugh'),
    ClientMsg.spectate('r1'),
    ClientMsg.stopSpectate(),
    ClientMsg.ping(123456),
    // 1.0 additions (§10.1)
    ClientMsg.modeAction('a4', 'bid', { count: 2, face: 5 }),
    ClientMsg.modeAction('a5', 'challenge'),
    ClientMsg.getProfile(),
    ClientMsg.buyCosmetic('banana_pin'),
    ClientMsg.equipCosmetic('hat', 'banana_pin'),
    ClientMsg.equipCosmetic('hat', null),
    ClientMsg.equipCosmetic('deco'), // itemId defaults to null (unequip)
  ];
  for (const env of samples) {
    const res = validateClientMsg(JSON.stringify(env));
    assert.equal(res.ok, true, `factory for '${env.t}' rejected: ${JSON.stringify(res)}`);
  }
});

// ---- rejects malformed messages ---------------------------------------------

test('validateClientMsg rejects invalid JSON', () => {
  assert.deepEqual(validateClientMsg('{nope'), { ok: false, code: ERROR_CODES.BAD_MSG });
  assert.deepEqual(validateClientMsg(''), { ok: false, code: ERROR_CODES.BAD_MSG });
});

test('validateClientMsg rejects non-envelope shapes', () => {
  assert.equal(validateClientMsg('42').ok, false);
  assert.equal(validateClientMsg('"hello"').ok, false);
  assert.equal(validateClientMsg('[1,2]').ok, false);
  assert.equal(validateClientMsg('{"p":{}}').ok, false); // missing t
  assert.equal(validateClientMsg(enc('hello', 'not-an-object')).ok, false);
});

test('validateClientMsg rejects unknown and server-only types', () => {
  assert.deepEqual(validateClientMsg(enc('teleport', {})), { ok: false, code: ERROR_CODES.BAD_MSG });
  // server→client types are not valid client messages
  assert.deepEqual(validateClientMsg(enc(MSG.WELCOME, {})), { ok: false, code: ERROR_CODES.BAD_MSG });
  assert.deepEqual(validateClientMsg(enc(MSG.CANNON, {})), { ok: false, code: ERROR_CODES.BAD_MSG });
});

test('validateClientMsg rejects bad names with NAME_INVALID', () => {
  assert.deepEqual(validateClientMsg(enc(MSG.HELLO, { name: 42 })), { ok: false, code: ERROR_CODES.NAME_INVALID });
  assert.deepEqual(validateClientMsg(enc(MSG.HELLO, { name: '   ' })), { ok: false, code: ERROR_CODES.NAME_INVALID });
  assert.deepEqual(validateClientMsg(enc(MSG.SET_PROFILE, { name: 'x'.repeat(99) })), {
    ok: false,
    code: ERROR_CODES.NAME_INVALID,
  });
});

test('validateClientMsg rejects bad play payloads with INVALID_CARDS', () => {
  const cases = [
    { aid: 'a1', cardIds: [] }, // too few
    { aid: 'a1', cardIds: ['c1', 'c2', 'c3', 'c4', 'c5'] }, // above MAX_PLAY_HARD
    { aid: 'a1', cardIds: ['c1', 'c1'] }, // duplicates
    { aid: 'a1', cardIds: [1, 2] }, // non-strings
    { aid: 'a1', cardIds: 'c1' }, // not an array
  ];
  for (const p of cases) {
    assert.deepEqual(validateClientMsg(enc(MSG.PLAY, p)), { ok: false, code: ERROR_CODES.INVALID_CARDS });
  }
  // missing aid is a plain BAD_MSG
  assert.deepEqual(validateClientMsg(enc(MSG.PLAY, { cardIds: ['c1'] })), { ok: false, code: ERROR_CODES.BAD_MSG });
});

// ---- 1.0 additions (§10.1): round-trips + rejection codes --------------------

test('validateClientMsg accepts valid modeAction shapes', () => {
  const res = validateClientMsg(enc(MSG.MODE_ACTION, { aid: 'a1', action: 'bid', data: { count: 3, face: 4 } }));
  assert.deepEqual(res, { ok: true, t: 'modeAction', p: { aid: 'a1', action: 'bid', data: { count: 3, face: 4 } } });
  // data is optional
  assert.equal(validateClientMsg(enc(MSG.MODE_ACTION, { aid: 'a2', action: 'shake' })).ok, true);
  // action length boundaries: 1 and MODE_ACTION_MAX_LENGTH chars
  assert.equal(validateClientMsg(enc(MSG.MODE_ACTION, { aid: 'a3', action: 'x' })).ok, true);
  assert.equal(
    validateClientMsg(enc(MSG.MODE_ACTION, { aid: 'a4', action: 'x'.repeat(MODE_ACTION_MAX_LENGTH) })).ok,
    true
  );
});

test('validateClientMsg rejects malformed modeAction with BAD_MSG', () => {
  const bad = [
    { action: 'bid' }, // missing aid
    { aid: 42, action: 'bid' }, // non-string aid
    { aid: 'a1' }, // missing action
    { aid: 'a1', action: '' }, // empty action
    { aid: 'a1', action: 'x'.repeat(MODE_ACTION_MAX_LENGTH + 1) }, // too long
    { aid: 'a1', action: 7 }, // non-string action
    { aid: 'a1', action: 'bid', data: [1, 2] }, // data not a plain object
    { aid: 'a1', action: 'bid', data: 'count=3' },
    { aid: 'a1', action: 'bid', data: null },
  ];
  for (const p of bad) {
    assert.deepEqual(
      validateClientMsg(enc(MSG.MODE_ACTION, p)),
      { ok: false, code: ERROR_CODES.BAD_MSG },
      JSON.stringify(p)
    );
  }
});

test('validateClientMsg accepts getProfile and rejects nothing about it', () => {
  assert.deepEqual(validateClientMsg(enc(MSG.GET_PROFILE, {})), { ok: true, t: 'getProfile', p: {} });
  assert.equal(validateClientMsg(JSON.stringify({ t: MSG.GET_PROFILE })).ok, true);
});

test('validateClientMsg round-trips buyCosmetic and rejects bad itemId with BAD_MSG', () => {
  assert.deepEqual(validateClientMsg(enc(MSG.BUY_COSMETIC, { itemId: 'vip_stool' })), {
    ok: true,
    t: 'buyCosmetic',
    p: { itemId: 'vip_stool' },
  });
  assert.deepEqual(validateClientMsg(enc(MSG.BUY_COSMETIC, {})), { ok: false, code: ERROR_CODES.BAD_MSG });
  assert.deepEqual(validateClientMsg(enc(MSG.BUY_COSMETIC, { itemId: 5 })), { ok: false, code: ERROR_CODES.BAD_MSG });
  assert.deepEqual(validateClientMsg(enc(MSG.BUY_COSMETIC, { itemId: null })), { ok: false, code: ERROR_CODES.BAD_MSG });
});

test('validateClientMsg round-trips equipCosmetic (itemId string or null) and rejects the rest', () => {
  assert.deepEqual(validateClientMsg(enc(MSG.EQUIP_COSMETIC, { slot: 'hat', itemId: 'banana_pin' })), {
    ok: true,
    t: 'equipCosmetic',
    p: { slot: 'hat', itemId: 'banana_pin' },
  });
  assert.deepEqual(validateClientMsg(enc(MSG.EQUIP_COSMETIC, { slot: 'hat', itemId: null })), {
    ok: true,
    t: 'equipCosmetic',
    p: { slot: 'hat', itemId: null },
  });
  const bad = [
    { itemId: 'banana_pin' }, // missing slot
    { slot: 7, itemId: 'banana_pin' }, // non-string slot
    { slot: 'hat' }, // itemId missing entirely (must be string or explicit null)
    { slot: 'hat', itemId: 42 },
    { slot: 'hat', itemId: ['banana_pin'] },
  ];
  for (const p of bad) {
    assert.deepEqual(
      validateClientMsg(enc(MSG.EQUIP_COSMETIC, p)),
      { ok: false, code: ERROR_CODES.BAD_MSG },
      JSON.stringify(p)
    );
  }
});

test('validateClientMsg rejects other bad payload shapes', () => {
  assert.equal(validateClientMsg(enc(MSG.READY, { ready: 'yes' })).ok, false);
  assert.equal(validateClientMsg(enc(MSG.JOIN_ROOM, {})).ok, false);
  assert.equal(validateClientMsg(enc(MSG.CHAT, { text: '' })).ok, false);
  assert.equal(validateClientMsg(enc(MSG.CHAT, { text: 'x'.repeat(121) })).ok, false);
  assert.equal(validateClientMsg(enc(MSG.UPDATE_SETTINGS, { patch: { turnSeconds: 5 } })).ok, false);
  assert.equal(validateClientMsg(enc(MSG.UPDATE_SETTINGS, {})).ok, false);
  assert.equal(validateClientMsg(enc(MSG.CREATE_ROOM, { isPrivate: false, maxPlayers: 12, mode: 'monkeyLies', botFill: true })).ok, false);
  assert.equal(validateClientMsg(enc(MSG.PING, { ts: 'now' })).ok, false);
});

// ---- catalogs / constants ---------------------------------------------------

test('MSG covers all §3.2 client types and they are all validatable', () => {
  const clientTypes = [
    'hello', 'setProfile', 'listRooms', 'createRoom', 'joinRoom', 'leaveRoom',
    'quickMatch', 'cancelQuick', 'ready', 'selectMonkey', 'addBot', 'removeBot',
    'updateSettings', 'startGame', 'play', 'callLiar', 'useChip', 'fireCannon',
    'chat', 'quickPhrase', 'emote', 'spectate', 'stopSpectate', 'ping',
  ];
  for (const t of clientTypes) {
    assert.ok(Object.values(MSG).includes(t), `MSG missing client type '${t}'`);
    assert.ok(CLIENT_MSG_TYPES.has(t), `no validator for client type '${t}'`);
  }
});

test('MSG covers all §3.3 server types', () => {
  const serverTypes = [
    'welcome', 'error', 'actionAck', 'roomList', 'roomState', 'leftRoom',
    'matchFound', 'gameStart', 'state', 'hand', 'roundStart', 'turn', 'played',
    'called', 'reveal', 'lastHolder', 'penalty', 'chipUsed', 'cannon',
    'eliminated', 'roundEnd', 'matchEnd', 'chat', 'quickPhrase', 'emote',
    'conn', 'pong',
  ];
  for (const t of serverTypes) {
    assert.ok(Object.values(MSG).includes(t), `MSG missing server type '${t}'`);
  }
});

test('MSG covers all §10.1 client types and they are all validatable', () => {
  const clientTypes = ['modeAction', 'getProfile', 'buyCosmetic', 'equipCosmetic'];
  for (const t of clientTypes) {
    assert.ok(Object.values(MSG).includes(t), `MSG missing client type '${t}'`);
    assert.ok(CLIENT_MSG_TYPES.has(t), `no validator for client type '${t}'`);
  }
});

test('MSG covers all §10.2 server types (and they are not valid client messages)', () => {
  const serverTypes = ['modeEvent', 'profile', 'rewards'];
  for (const t of serverTypes) {
    assert.ok(Object.values(MSG).includes(t), `MSG missing server type '${t}'`);
    assert.deepEqual(validateClientMsg(enc(t, {})), { ok: false, code: ERROR_CODES.BAD_MSG });
  }
});

test('ERROR_CODES matches the §3.3 + §10.2 list', () => {
  assert.deepEqual(
    Object.keys(ERROR_CODES).sort(),
    [
      'BAD_MSG', 'BAD_STATE', 'INVALID_CARDS', 'NAME_INVALID', 'NOT_FOUND', 'NOT_HOST',
      'NOT_PLAYABLE', 'NOT_YOUR_TURN', 'RATE_LIMIT', 'ROOM_FULL',
      'CANT_AFFORD', 'LOCKED',
    ].sort()
  );
});

test('encodeMsg produces a valid envelope string', () => {
  const parsed = JSON.parse(encodeMsg(MSG.PING, { ts: 1 }));
  assert.deepEqual(parsed, { t: 'ping', p: { ts: 1 } });
});

// ---- 1.0 server factories (§10.2 / §10.3) -------------------------------------

test('ServerMsg.turn without actions stays byte-for-byte compatible', () => {
  const env = ServerMsg.turn({ seat: 2, deadline: 1000, canCall: true, lastHolder: false });
  assert.deepEqual(env, { t: 'turn', p: { seat: 2, deadline: 1000, canCall: true, lastHolder: false } });
  assert.deepEqual(Object.keys(env.p), ['seat', 'deadline', 'canCall', 'lastHolder']);
});

test('ServerMsg.turn carries optional actions when provided', () => {
  const env = ServerMsg.turn({
    seat: 1, deadline: 2000, canCall: false, lastHolder: false, actions: ['bid', 'challenge'],
  });
  assert.deepEqual(env, {
    t: 'turn',
    p: { seat: 1, deadline: 2000, canCall: false, lastHolder: false, actions: ['bid', 'challenge'] },
  });
});

test('ServerMsg.modeEvent spreads kind + payload into one flat p', () => {
  const env = ServerMsg.modeEvent('diceBid', { seat: 3, count: 2, face: 5 });
  assert.deepEqual(env, { t: 'modeEvent', p: { kind: 'diceBid', seat: 3, count: 2, face: 5 } });
  assert.deepEqual(ServerMsg.modeEvent('chaosKnobs'), { t: 'modeEvent', p: { kind: 'chaosKnobs' } });
});

test('ServerMsg.profile and ServerMsg.rewards carry the §10.2 payload fields', () => {
  const profile = {
    playerId: 'p1', coins: 120, xp: 30, level: 2, xpToNext: 200, wins: 3, matches: 9,
    unlocked: ['banana_pin'], equipped: { hat: 'banana_pin' },
    stats: { perMode: { monkeyLies: { plays: 9, wins: 3 } } },
  };
  assert.deepEqual(ServerMsg.profile(profile), { t: 'profile', p: profile });

  const rewards = {
    coins: 64, xp: 85, levelUps: 1, newLevel: 3,
    breakdown: [{ reason: 'place', coins: 60, xp: 85 }, { reason: 'goodCalls', coins: 4, xp: 0 }],
  };
  assert.deepEqual(ServerMsg.rewards(rewards), { t: 'rewards', p: rewards });
});
