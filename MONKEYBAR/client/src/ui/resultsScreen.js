// Results screen (R9) — winner podium + standings from matchEnd (§3.3) plus
// the night's take: coins/XP breakdown lines from store.lastRewards (§10.2
// `rewards`, private per seat) with an animated coin count-up and a LEVEL UP
// banner on level-ups. Play-again goes back to the lobby.

import { MSG } from '@shared/protocol.js';
import { el, clear, shortName } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { injectCosmeticsStyles } from './cosmetics.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createResultsScreen(ctx) {
  const { store, socket, go } = ctx;
  injectCosmeticsStyles();

  const content = el('div', { className: 'panel results-panel' });

  /** rewards payload ts already animated (count-up runs once per payout) */
  let animatedTs = 0;
  let countRaf = 0;

  function seatInfo(seatNo) {
    return store.get('snapshot')?.seats?.find((s) => s.seat === seatNo) ?? null;
  }

  // ------------------------------------------------------------------
  // Rewards block (R9): breakdown lines + coin count-up + LEVEL UP banner
  // ------------------------------------------------------------------
  function renderRewards() {
    const rewards = store.get('lastRewards');
    if (!rewards) return null;

    const block = el('div', { className: 'r9-rewards' });
    block.append(el('div', { className: 'r9-rw-title', text: '🍌 The Night\u2019s Take' }));

    for (const line of rewards.breakdown ?? []) {
      const bits = [];
      if (line.coins) bits.push(`+${line.coins} 🍌`);
      if (line.xp) bits.push(`+${line.xp} XP`);
      block.append(
        el('div', { className: 'r9-rw-row' }, [
          el('span', { text: line.reason ?? '' }),
          el('span', { className: 'amounts', text: bits.join('  ') }),
        ])
      );
    }

    const coinEl = el('span', { text: '🍌 0' });
    const totalRow = el('div', { className: 'r9-rw-total' }, [
      coinEl,
      el('span', { className: 'xp', text: `+${rewards.xp ?? 0} XP` }),
    ]);
    block.append(totalRow);

    // animated coin count-up (once per rewards payload)
    const total = rewards.coins ?? 0;
    if (rewards.ts !== animatedTs) {
      animatedTs = rewards.ts ?? Date.now();
      if (countRaf) cancelAnimationFrame(countRaf);
      const start = performance.now();
      const dur = Math.min(2000, 650 + total * 12);
      const tick = (now) => {
        const k = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        coinEl.textContent = `🍌 +${Math.round(total * eased)}`;
        if (k < 1) countRaf = requestAnimationFrame(tick);
      };
      countRaf = requestAnimationFrame(tick);
    } else {
      coinEl.textContent = `🍌 +${total}`;
    }

    const wrap = el('div', {}, [block]);
    if ((rewards.levelUps ?? 0) > 0) {
      wrap.append(
        el('div', {
          className: 'r9-levelup',
          text: `⭐ LEVEL UP! ${rewards.levelUps > 1 ? `×${rewards.levelUps} → ` : ''}Level ${rewards.newLevel}`,
        })
      );
    }
    return wrap;
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
    const profile = store.get('profile') ?? {};

    content.append(
      el('div', { className: 'winner-crown', text: '👑' }),
      winnerMonkey ? portraitCanvas(winnerMonkey, 110) : null,
      el('div', { className: 'winner-name', text: shortName(winner?.name ?? winnerSeat?.name ?? 'Mystery Monkey', 18) }),
      el('div', {
        className: 'winner-tag',
        text: youWon
          ? `last monkey standing — that's you! 🏆${profile.wins != null ? ` (${profile.wins} career win${profile.wins === 1 ? '' : 's'})` : ''}`
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

    // R9: your private payout (rewards frame lands right after matchEnd)
    const rewardsBlock = renderRewards();
    if (rewardsBlock) content.append(rewardsBlock);

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
  // the private `rewards` frame can trail matchEnd — fold it in live
  store.on('lastRewards', () => {
    if (store.get('screen') === 'results') render();
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [content]),
  ]);

  return { el: screen, onShow: render };
}
