// Results screen (P5) — winner podium + standings from matchEnd (§3.3),
// play-again back to the lobby. (The local win counter is incremented once
// in screens.js when matchEnd arrives; here we only render.)

import { MSG } from '@shared/protocol.js';
import { el, clear, shortName } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { getWins } from './cosmetics.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createResultsScreen(ctx) {
  const { store, socket, go } = ctx;

  const content = el('div', { className: 'panel results-panel' });

  function seatInfo(seatNo) {
    return store.get('snapshot')?.seats?.find((s) => s.seat === seatNo) ?? null;
  }

  function render() {
    clear(content);
    const result = store.get('matchResult');
    const roster = store.get('catalogs').roster;
    const snap = store.get('snapshot');

    if (!result) {
      content.append(
        el('h2', { className: 'h-title', text: 'No match results yet' }),
        el('button', { className: 'btn primary', type: 'button', text: 'Back to menu', onClick: () => go('mainMenu') })
      );
      return;
    }

    const standings = [...(result.standings ?? [])].sort((a, b) => a.place - b.place);
    const winner = standings.find((s) => s.place === 1);
    const winnerSeat = seatInfo(result.winnerSeat);
    const winnerMonkey = roster.find((m) => m.id === winnerSeat?.monkeyId);
    const youWon = snap?.yourSeat != null && snap.yourSeat === result.winnerSeat;

    content.append(
      el('div', { className: 'winner-crown', text: '👑' }),
      winnerMonkey ? portraitCanvas(winnerMonkey, 110) : null,
      el('div', { className: 'winner-name', text: shortName(winner?.name ?? winnerSeat?.name ?? 'Mystery Monkey', 18) }),
      el('div', {
        className: 'winner-tag',
        text: youWon
          ? `last monkey standing — that's you! 🏆 (${getWins()} win${getWins() === 1 ? '' : 's'})`
          : 'last monkey standing',
      })
    );

    // podium: places 1–3
    const podium = el('div', { className: 'podium' });
    const order = [2, 1, 3]; // silver, gold, bronze display order
    for (const place of order) {
      const entry = standings.find((s) => s.place === place);
      if (!entry) continue;
      const seat = seatInfo(entry.seat);
      const monkey = roster.find((m) => m.id === seat?.monkeyId);
      podium.append(
        el('div', { className: `step p${place}` }, [
          monkey ? portraitCanvas(monkey, place === 1 ? 84 : 64, false) : null,
          el('div', { className: 's-name', text: shortName(entry.name, 14) }),
          el('div', { className: 'block', text: String(place) }),
        ])
      );
    }
    content.append(podium);

    // full standings below the podium
    if (standings.length > 3) {
      content.append(
        el(
          'div',
          { className: 'standings-list' },
          standings
            .filter((s) => s.place > 3)
            .map((s) =>
              el('div', { className: 'st-row' }, [
                el('b', { text: `#${s.place}` }),
                el('span', { text: shortName(s.name, 20) }),
              ])
            )
        )
      );
    }

    content.append(
      el('div', { className: 'results-actions' }, [
        el('button', {
          className: 'btn primary big',
          type: 'button',
          text: '🍌 Play Again',
          onClick: () => {
            store.set('matchResult', null);
            // the room returns to lobby state server-side after matchEnd
            go(store.get('roomState') ? 'lobby' : 'lobbyBrowser');
          },
        }),
        el('button', {
          className: 'btn ghost',
          type: 'button',
          text: 'Main menu',
          onClick: () => {
            store.set('matchResult', null);
            // Actually leave the (post-match lobby) room — otherwise the next
            // quickMatch/createRoom is rejected with BAD_STATE.
            if (store.get('roomState')) socket.send(MSG.LEAVE_ROOM, {});
            go('mainMenu');
          },
        }),
      ])
    );
  }

  store.on('matchResult', () => {
    if (store.get('screen') === 'results') render();
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [content]),
  ]);

  return { el: screen, onShow: render };
}
