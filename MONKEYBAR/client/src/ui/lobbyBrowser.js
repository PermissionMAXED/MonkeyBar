// Lobby browser screen (P5) — public room list (roomList / listRooms),
// join-by-code, and the Create Room modal (name, mode, map, maxPlayers,
// private + botFill toggles → createRoom §3.2).

import { MSG } from '@shared/protocol.js';
import { MIN_PLAYERS, MAX_PLAYERS, ROOM_CODE_LENGTH, NAME_MAX_LENGTH } from '@shared/constants.js';
import { el, clear } from './dom.js';

const REFRESH_INTERVAL_MS = 5000;

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void, onHide: () => void}}
 */
export function createLobbyBrowser(ctx) {
  const { store, socket, toast, go } = ctx;

  // ---- room list ----
  const listEl = el('div', { className: 'room-list' });

  function renderRooms(rooms) {
    clear(listEl);
    if (!rooms?.length) {
      listEl.append(
        el('div', { className: 'rooms-empty' }, [
          el('div', { className: 'big-glyph', text: '🦗' }),
          el('div', { text: 'No public tables open right now.' }),
          el('div', { className: 'faint', text: 'Create one and the monkeys will come.' }),
        ])
      );
      return;
    }
    const modes = store.get('catalogs').modes;
    for (const room of rooms) {
      const mode = modes.find((m) => m.id === room.mode);
      listEl.append(
        el('div', { className: 'room-row' }, [
          el('div', {}, [
            el('div', { className: 'r-name', text: room.name || 'Unnamed table' }),
            el('div', {
              className: 'r-meta',
              text: `${mode?.name ?? room.mode}${room.inGame ? ' · match in progress' : ''}`,
            }),
          ]),
          el('div', { className: 'r-count', text: `${room.playerCount}/${room.maxPlayers} 🐒` }),
          el('div', { className: 'r-meta', text: room.isPrivate ? '🔒 private' : '🌴 public' }),
          room.inGame
            ? el('button', {
                className: 'btn small ghost',
                type: 'button',
                text: 'Spectate',
                onClick: () => socket.send(MSG.SPECTATE, { roomId: room.id }),
              })
            : el('button', {
                className: 'btn small primary',
                type: 'button',
                text: 'Join',
                disabled: room.playerCount >= room.maxPlayers ? 'true' : undefined,
                onClick: () => socket.send(MSG.JOIN_ROOM, { roomId: room.id }),
              }),
        ])
      );
    }
  }

  store.on('roomList', renderRooms);

  // ---- join by code ----
  const codeInput = el('input', {
    className: 'input',
    type: 'text',
    placeholder: 'CODE',
    maxlength: String(ROOM_CODE_LENGTH),
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinByCode();
  });

  function joinByCode() {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH) {
      toast(`Room codes are ${ROOM_CODE_LENGTH} characters.`, 'error');
      return;
    }
    socket.send(MSG.JOIN_ROOM, { code });
  }

  // ---- create room modal ----
  let modal = null;

  function closeModal() {
    modal?.remove();
    modal = null;
  }

  function openCreateModal() {
    closeModal();
    const catalogs = store.get('catalogs');
    const playerName = store.get('profile').name || 'Monkey';

    const nameInput = el('input', {
      className: 'input',
      type: 'text',
      maxlength: String(NAME_MAX_LENGTH),
      value: `${playerName}'s table`,
    });

    const modeSelect = el(
      'select',
      { className: 'select' },
      catalogs.modes.map((m) =>
        el('option', {
          value: m.id,
          text: m.playable ? m.name : `🔒 ${m.name} — coming soon`,
          disabled: m.playable ? undefined : 'true',
          selected: m.playable ? 'true' : undefined,
        })
      )
    );

    // All 10 bars stay visible; the 7 locked ones are styled "coming soon" (P7)
    const mapSelect = el(
      'select',
      { className: 'select' },
      catalogs.maps.map((m) =>
        el('option', {
          value: m.id,
          text: m.playable ? m.name : `🔒 ${m.name} — coming soon`,
          disabled: m.playable ? undefined : 'true',
        })
      )
    );

    const sizeSelect = el(
      'select',
      { className: 'select' },
      Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => {
        const n = MIN_PLAYERS + i;
        return el('option', {
          value: String(n),
          text: `${n} monkeys`,
          selected: n === 6 ? 'true' : undefined,
        });
      })
    );

    let isPrivate = false;
    let botFill = true;

    const privateToggle = el('div', {
      className: 'toggle',
      role: 'switch',
      onClick: () => {
        isPrivate = !isPrivate;
        privateToggle.classList.toggle('on', isPrivate);
      },
    });
    const botToggle = el('div', {
      className: 'toggle on',
      role: 'switch',
      onClick: () => {
        botFill = !botFill;
        botToggle.classList.toggle('on', botFill);
      },
    });

    modal = el('div', { className: 'modal-veil', onClick: (e) => e.target === modal && closeModal() }, [
      el('div', { className: 'modal panel' }, [
        el('h2', { className: 'h-title', text: 'Open a Table' }),
        el('div', { className: 'field' }, [el('label', { text: 'Room name' }), nameInput]),
        el('div', { className: 'field' }, [el('label', { text: 'Game mode' }), modeSelect]),
        el('div', { className: 'field' }, [el('label', { text: 'Bar (map)' }), mapSelect]),
        el('div', { className: 'field' }, [el('label', { text: 'Max players (4–8)' }), sizeSelect]),
        el('div', { className: 'toggle-row' }, [
          el('span', { text: '🔒 Private (join by code only)' }),
          privateToggle,
        ]),
        el('div', { className: 'toggle-row' }, [
          el('span', { text: '🤖 Fill empty stools with bots on start' }),
          botToggle,
        ]),
        el('div', { className: 'modal-actions' }, [
          el('button', { className: 'btn ghost', type: 'button', text: 'Cancel', onClick: closeModal }),
          el('button', {
            className: 'btn primary',
            type: 'button',
            text: 'Create Room',
            onClick: () => {
              const roomName = nameInput.value.trim() || `${playerName}'s table`;
              const mapId = mapSelect.value;
              socket.send(MSG.CREATE_ROOM, {
                name: roomName,
                isPrivate,
                maxPlayers: parseInt(sizeSelect.value, 10),
                mode: modeSelect.value,
                botFill,
              });
              // createRoom carries no mapId (§3.2) — apply the chosen map via
              // updateSettings as soon as we arrive in our new room as host.
              const un = store.on('roomState', (room) => {
                un();
                if (
                  room &&
                  room.hostId === store.get('playerId') &&
                  room.settings?.mapId !== mapId
                ) {
                  socket.send(MSG.UPDATE_SETTINGS, { patch: { mapId } });
                }
              });
              setTimeout(un, 4000);
              closeModal();
            },
          }),
        ]),
      ]),
    ]);
    screen.appendChild(modal);
  }

  // ---- layout ----
  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel browser-panel' }, [
        el('div', { className: 'browser-head' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🌴 Open Tables' }),
          el('div', { style: { display: 'flex', gap: '8px' } }, [
            el('button', {
              className: 'btn small ghost',
              type: 'button',
              text: '↻ Refresh',
              onClick: () => socket.send(MSG.LIST_ROOMS, {}),
            }),
            el('button', { className: 'btn small ghost', type: 'button', text: '← Menu', onClick: () => go('mainMenu') }),
          ]),
        ]),
        listEl,
        el('div', { className: 'browser-foot' }, [
          el('div', { className: 'code-join' }, [
            codeInput,
            el('button', { className: 'btn small', type: 'button', text: 'Join by code', onClick: joinByCode }),
          ]),
          el('button', { className: 'btn primary', type: 'button', text: '+ Create Room', onClick: openCreateModal }),
        ]),
      ]),
    ]),
  ]);

  let refreshTimer = null;

  return {
    el: screen,
    onShow() {
      renderRooms(store.get('roomList'));
      if (socket.isOpen()) socket.send(MSG.LIST_ROOMS, {});
      refreshTimer = setInterval(() => {
        if (socket.isOpen()) socket.send(MSG.LIST_ROOMS, {});
      }, REFRESH_INTERVAL_MS);
    },
    onHide() {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
      closeModal();
    },
  };
}
