// Lobby (room) screen (P5) — renders from roomState (§3.3 full snapshots):
// member list with 2D monkey portraits, ready toggle, host controls
// (add/remove bots, updateSettings, start validation), room code, chat.

import { MSG } from '@shared/protocol.js';
import { MIN_PLAYERS, TURN_SECONDS_MIN, TURN_SECONDS_MAX } from '@shared/constants.js';
import { el, clear, shortName } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { createChatPanel } from './chat.js';

/** §5 bot personality archetypes (server registry lives in server/src/bots/). */
const BOT_PERSONALITIES = [
  'aggressive',
  'cautious',
  'chaotic',
  'mathematical',
  'emotional',
  'trollish',
  'quiet',
];

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void, onHide: () => void}}
 */
export function createLobbyScreen(ctx) {
  const { store, socket, toast, go } = ctx;

  const headEl = el('div', { className: 'lobby-head' });
  const memberListEl = el('div', { className: 'member-list' });
  const actionsEl = el('div', { className: 'lobby-actions' });
  const hostPanelEl = el('div', { className: 'panel purple host-controls' });
  const chat = createChatPanel(ctx, { compact: false });

  function me(room) {
    const playerId = store.get('playerId');
    return room?.members?.find((m) => m.id === playerId) ?? null;
  }

  function isHost(room) {
    return !!room && room.hostId === store.get('playerId');
  }

  // ------------------------------------------------------------------
  // Header: name, mode/map, private code
  // ------------------------------------------------------------------
  function renderHead(room) {
    clear(headEl);
    const catalogs = store.get('catalogs');
    const mode = catalogs.modes.find((m) => m.id === room.mode);
    const map = catalogs.maps.find((m) => m.id === room.settings?.mapId);
    headEl.append(
      el('div', {}, [
        el('div', { className: 'room-name', text: room.name || 'Unnamed table' }),
        el('div', {
          className: 'muted',
          style: { fontSize: '12.5px', marginTop: '4px' },
          text: `${mode?.name ?? room.mode} · ${map?.name ?? room.settings?.mapId ?? '—'} · ⏱ ${room.settings?.turnSeconds ?? '—'}s turns`,
        }),
      ]),
      room.isPrivate && room.code
        ? el(
            'div',
            {
              className: 'room-code',
              title: 'Click to copy',
              onClick: () => {
                navigator.clipboard?.writeText(room.code).then(
                  () => toast('Room code copied 📋'),
                  () => toast(`Room code: ${room.code}`)
                );
              },
            },
            [el('span', { text: 'CODE' }), el('b', { text: room.code })]
          )
        : el('div', { className: 'badge host', style: { alignSelf: 'center' }, text: '🌴 PUBLIC' })
    );
  }

  // ------------------------------------------------------------------
  // Members
  // ------------------------------------------------------------------
  function renderMembers(room) {
    clear(memberListEl);
    const roster = store.get('catalogs').roster;
    const playerId = store.get('playerId');
    const host = isHost(room);

    for (const member of room.members ?? []) {
      const monkey = roster.find((m) => m.id === member.monkeyId);
      const row = el('div', { className: `member-row ${member.id === playerId ? 'me' : ''}` }, [
        portraitCanvas(monkey, 52),
        el('div', { className: 'm-info' }, [
          el('div', { className: 'm-name' }, [
            el('span', { text: shortName(member.name, 16) }),
            member.isHost ? el('span', { className: 'badge host', text: '👑 host' }) : null,
            member.isBot
              ? el('span', { className: 'badge bot', text: `🤖 ${member.personality ?? 'bot'}` })
              : null,
          ]),
          el('div', { className: 'm-sub', text: monkey?.name ?? member.monkeyId }),
        ]),
        member.isBot
          ? host
            ? el('button', {
                className: 'btn small danger',
                type: 'button',
                text: '✕',
                title: 'Remove bot',
                onClick: () => socket.send(MSG.REMOVE_BOT, { botId: member.id }),
              })
            : el('span', { className: 'ready-lamp on', text: 'ready' })
          : el('span', {
              className: `ready-lamp ${member.ready ? 'on' : ''}`,
              text: member.ready ? 'ready' : 'not ready',
            }),
      ]);
      memberListEl.append(row);
    }

    const empties = (room.maxPlayers ?? 0) - (room.members?.length ?? 0);
    for (let i = 0; i < empties; i++) {
      memberListEl.append(
        el('div', { className: 'empty-seat' }, [
          el('span', { text: '🪑' }),
          el('span', { text: room.botFill ? 'empty stool — bot joins on start' : 'empty stool' }),
        ])
      );
    }
  }

  // ------------------------------------------------------------------
  // Start validation (§3.2: ≥4 seats incl. bots, all humans ready)
  // ------------------------------------------------------------------
  function startState(room) {
    const members = room.members ?? [];
    const humans = members.filter((m) => !m.isBot);
    const seatCount = room.botFill ? room.maxPlayers : members.length;
    const notReady = humans.filter((m) => !m.ready);
    if (seatCount < MIN_PLAYERS) {
      return { ok: false, why: `Need at least ${MIN_PLAYERS} seats — add bots or invite monkeys.` };
    }
    if (notReady.length > 0) {
      return {
        ok: false,
        why: `Waiting on: ${notReady.map((m) => shortName(m.name, 12)).join(', ')}`,
      };
    }
    return { ok: true, why: 'All monkeys accounted for. Deal the cards!' };
  }

  // ------------------------------------------------------------------
  // Actions row: ready toggle, start (host), leave
  // ------------------------------------------------------------------
  function renderActions(room) {
    clear(actionsEl);
    const self = me(room);
    const host = isHost(room);

    if (self && !self.isBot) {
      actionsEl.append(
        el('button', {
          className: `btn grow ${self.ready ? '' : 'primary'}`,
          type: 'button',
          text: self.ready ? '✋ Unready' : '✔ Ready Up',
          onClick: () => socket.send(MSG.READY, { ready: !self.ready }),
        })
      );
    }

    if (host) {
      const st = startState(room);
      const startBtn = el('button', {
        className: 'btn pink grow big',
        type: 'button',
        text: '🍌 START GAME',
        disabled: st.ok ? undefined : 'true',
        title: st.why,
        onClick: () => socket.send(MSG.START_GAME, {}),
      });
      actionsEl.append(startBtn);
    }

    actionsEl.append(
      el('button', {
        className: 'btn small ghost',
        type: 'button',
        text: '🐒 Monkey',
        title: 'Change character',
        onClick: () => go('characterSelect'),
      }),
      el('button', {
        className: 'btn small danger',
        type: 'button',
        text: 'Leave',
        onClick: () => socket.send(MSG.LEAVE_ROOM, {}),
      })
    );

    const st = startState(room);
    actionsEl.append(el('div', { className: 'start-hint', style: { width: '100%' }, text: st.why }));
  }

  // ------------------------------------------------------------------
  // Host controls: add bot + settings
  // ------------------------------------------------------------------
  function renderHostPanel(room) {
    clear(hostPanelEl);
    if (!isHost(room)) {
      hostPanelEl.style.display = 'none';
      return;
    }
    hostPanelEl.style.display = '';

    const catalogs = store.get('catalogs');

    // add bot with personality picker
    const personalitySelect = el(
      'select',
      { className: 'select' },
      [
        el('option', { value: '', text: '🎲 Random personality' }),
        ...BOT_PERSONALITIES.map((p) =>
          el('option', { value: p, text: p.charAt(0).toUpperCase() + p.slice(1) })
        ),
      ]
    );
    const addBotBtn = el('button', {
      className: 'btn small',
      type: 'button',
      text: '+ Add Bot',
      disabled: (room.members?.length ?? 0) >= room.maxPlayers ? 'true' : undefined,
      onClick: () => {
        const personality = personalitySelect.value || undefined;
        socket.send(MSG.ADD_BOT, personality ? { personality } : {});
      },
    });

    // settings patches
    const turnOut = el('output', { text: `${room.settings?.turnSeconds ?? 25}s` });
    const turnSlider = el('input', {
      className: 'slider',
      type: 'range',
      min: String(TURN_SECONDS_MIN),
      max: String(TURN_SECONDS_MAX),
      step: '5',
      value: String(room.settings?.turnSeconds ?? 25),
    });
    turnSlider.addEventListener('input', () => {
      turnOut.textContent = `${turnSlider.value}s`;
    });
    turnSlider.addEventListener('change', () => {
      socket.send(MSG.UPDATE_SETTINGS, { patch: { turnSeconds: parseInt(turnSlider.value, 10) } });
    });

    // All 10 bars stay visible; the 7 locked ones are styled "coming soon" (P7)
    const mapSelect = el(
      'select',
      { className: 'select' },
      catalogs.maps.map((m) =>
        el('option', {
          value: m.id,
          text: m.playable ? m.name : `🔒 ${m.name} — coming soon`,
          disabled: m.playable ? undefined : 'true',
          selected: m.id === room.settings?.mapId ? 'true' : undefined,
        })
      )
    );
    mapSelect.addEventListener('change', () => {
      socket.send(MSG.UPDATE_SETTINGS, { patch: { mapId: mapSelect.value } });
    });

    const modeSelect = el(
      'select',
      { className: 'select' },
      catalogs.modes.map((m) =>
        el('option', {
          value: m.id,
          text: m.playable ? m.name : `🔒 ${m.name} — coming soon`,
          disabled: m.playable ? undefined : 'true',
          selected: m.id === room.mode ? 'true' : undefined,
        })
      )
    );
    modeSelect.addEventListener('change', () => {
      socket.send(MSG.UPDATE_SETTINGS, { patch: { mode: modeSelect.value } });
    });

    hostPanelEl.append(
      el('h3', { className: 'h-sub', style: { marginTop: '0' }, text: '👑 Host controls' }),
      el('div', { className: 'field-row', style: { marginBottom: '12px' } }, [personalitySelect, addBotBtn]),
      el('div', { className: 'field' }, [
        el('label', { text: 'Turn timer' }),
        el('div', { className: 'turn-seconds-row' }, [turnSlider, turnOut]),
      ]),
      el('div', { className: 'field' }, [el('label', { text: 'Bar (map)' }), mapSelect]),
      el('div', { className: 'field', style: { marginBottom: '0' } }, [
        el('label', { text: 'Game mode' }),
        modeSelect,
      ])
    );
  }

  // ------------------------------------------------------------------
  // Root render
  // ------------------------------------------------------------------
  function render(room) {
    if (!room) return;
    renderHead(room);
    renderMembers(room);
    renderActions(room);
    renderHostPanel(room);
  }

  store.on('roomState', (room) => {
    if (store.get('screen') === 'lobby') render(room);
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content', style: { width: '100%', display: 'flex', justifyContent: 'center' } }, [
      el('div', { className: 'lobby-layout' }, [
        el('div', { className: 'panel' }, [headEl, memberListEl, actionsEl]),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
          hostPanelEl,
          chat.el,
        ]),
      ]),
    ]),
  ]);

  return {
    el: screen,
    onShow() {
      render(store.get('roomState'));
      chat.onShow?.();
    },
    onHide() {
      chat.onHide?.();
    },
  };
}
