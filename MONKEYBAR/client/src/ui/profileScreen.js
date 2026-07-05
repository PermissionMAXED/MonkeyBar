// Profile / stats screen (R9) — renders the server economy profile (§10.2:
// coins/xp/level/wins/matches/per-mode stats/inventory) from store.profile.
// Exports the compact level/coins/wins header block the shop reuses.
// Reachable via go('profile'); no menu entry links here yet (R10 adds it).

import { MSG } from '@shared/protocol.js';
import { el, clear, shortName } from './dom.js';
import { getCosmetic, injectCosmeticsStyles } from './cosmetics.js';

/**
 * Compact level / XP / coins / wins header block (R9 MUST-HAVE) — built
 * fresh on every call; the shop renders one of these above the catalog.
 * @param {Object} profile  store.profile (server fields may be absent pre-welcome)
 * @returns {HTMLElement}
 */
export function createProfileHeader(profile = {}) {
  injectCosmeticsStyles();
  const level = profile.level ?? 1;
  const xp = profile.xp ?? 0;
  const xpToNext = profile.xpToNext ?? 0;
  const pct = xpToNext > 0 ? Math.min(100, Math.round((xp / xpToNext) * 100)) : 100;

  const fill = el('div', { className: 'fill' });
  fill.style.width = `${pct}%`;

  return el('div', { className: 'r9-profile-header' }, [
    el('div', { className: 'r9-level-badge', title: 'Level' }, [
      el('span', { className: 'lv', text: 'LV' }),
      el('span', { className: 'num', text: String(level) }),
    ]),
    el('div', { className: 'r9-ph-mid' }, [
      el('div', { className: 'r9-ph-name', text: shortName(profile.name || 'Nameless monkey', 22) }),
      el('div', { className: 'r9-xpbar' }, [fill]),
      el('div', {
        className: 'r9-ph-xp',
        text: xpToNext > 0 ? `${xp} / ${xpToNext} XP to level ${level + 1}` : 'MAX LEVEL — the bar salutes you',
      }),
    ]),
    el('div', { className: 'r9-ph-stats' }, [
      el('div', { className: 'r9-coin-pill', title: 'Banana Coins' }, [
        el('span', { text: '🍌' }),
        el('span', { className: 'r9-coin-count', text: String(profile.coins ?? 0) }),
      ]),
      el('div', { className: 'r9-ph-winline' }, [
        el('div', { text: `🏆 ${profile.wins ?? 0} wins` }),
        el('div', { text: `🎲 ${profile.matches ?? 0} matches` }),
      ]),
    ]),
  ]);
}

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createProfileScreen(ctx) {
  const { store, socket, back } = ctx;
  injectCosmeticsStyles();

  const bodyEl = el('div', {});

  function render() {
    clear(bodyEl);
    const profile = store.get('profile') ?? {};
    bodyEl.append(createProfileHeader(profile));

    // per-mode plays/wins (nice-to-have, §10.2 profile.stats)
    const perMode = profile.stats?.perMode ?? {};
    const modes = store.get('catalogs')?.modes ?? [];
    const entries = Object.entries(perMode);
    if (entries.length) {
      bodyEl.append(el('h3', { className: 'h-sub', text: 'Per-mode record' }));
      const grid = el('div', { className: 'r9-mode-stats' });
      for (const [modeId, s] of entries) {
        const mode = modes.find((m) => m.id === modeId);
        grid.append(
          el('div', { className: 'r9-mode-stat' }, [
            el('b', { text: mode?.name ?? modeId }),
            el('span', { text: `${s.wins ?? 0} wins / ${s.plays ?? 0} plays` }),
          ])
        );
      }
      bodyEl.append(grid);
    }

    // owned cosmetics
    const unlocked = profile.unlocked ?? [];
    bodyEl.append(el('h3', { className: 'h-sub', text: `Wardrobe — ${unlocked.length} owned` }));
    if (unlocked.length) {
      const strip = el('div', { className: 'cosmetic-strip' });
      for (const id of unlocked) {
        const item = getCosmetic(id);
        if (!item) continue;
        const equipped = profile.equipped?.[item.slot] === item.id;
        strip.append(
          el('div', { className: 'cosmetic-chip', title: item.desc }, [
            el('span', { text: item.glyph }),
            el('span', { text: item.name }),
            equipped ? el('span', { className: 'req', text: '✔ equipped' }) : null,
          ])
        );
      }
      bodyEl.append(strip);
    } else {
      bodyEl.append(el('p', { className: 'muted', text: 'Nothing yet — win coins at the tables and hit the Back Room shop.' }));
    }
  }

  store.on('profile', () => {
    if (store.get('screen') === 'profile') render();
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel', style: { width: 'min(640px, 94vw)' } }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🐒 Profile' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        bodyEl,
      ]),
    ]),
  ]);

  return {
    el: screen,
    onShow() {
      if (socket.isOpen()) socket.send(MSG.GET_PROFILE, {});
      render();
    },
  };
}
