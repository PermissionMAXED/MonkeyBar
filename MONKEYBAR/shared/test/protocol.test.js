import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MSG,
  ERROR_CODES,
  validateClientMsg,
  ClientMsg,
  encodeMsg,
  CLIENT_MSG_TYPES,
} from '../src/protocol.js';

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

test('validateClientMsg accepts a valid play (1–3 unique card ids)', () => {
  assert.equal(validateClientMsg(enc(MSG.PLAY, { aid: 'a1', cardIds: ['c1'] })).ok, true);
  assert.equal(validateClientMsg(enc(MSG.PLAY, { aid: 'a2', cardIds: ['c1', 'c2', 'c3'] })).ok, true);
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
    { aid: 'a1', cardIds: ['c1', 'c2', 'c3', 'c4'] }, // too many
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

test('ERROR_CODES matches the §3.3 list', () => {
  assert.deepEqual(
    Object.keys(ERROR_CODES).sort(),
    ['BAD_MSG', 'BAD_STATE', 'INVALID_CARDS', 'NAME_INVALID', 'NOT_FOUND', 'NOT_HOST', 'NOT_PLAYABLE', 'NOT_YOUR_TURN', 'RATE_LIMIT', 'ROOM_FULL'].sort()
  );
});

test('encodeMsg produces a valid envelope string', () => {
  const parsed = JSON.parse(encodeMsg(MSG.PING, { ts: 1 }));
  assert.deepEqual(parsed, { t: 'ping', p: { ts: 1 } });
});
