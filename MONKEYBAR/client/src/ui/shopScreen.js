// Shop screen (R9) — the REAL Back Room: the shared catalog grouped by slot
// with price/level tags, a coin-balance profile header, and BUY / EQUIP /
// UNEQUIP flows. Server-authoritative: buttons only send buyCosmetic /
// equipCosmetic (§10.1) and the grid re-renders from the fresh `profile`
// frame (store.profile) — no local state faking. CANT_AFFORD / LOCKED
// rejections surface as toasts (screens.js relays server error msgs; we add
// friendlier copy here).

import { MSG, ERROR_CODES } from '@shared/protocol.js';
import { el, clear } from './dom.js';
import {
  SLOT_IDS,
  SLOT_META,
  getCosmetic,
  getCosmeticsBySlot,
  isOwned,
  isEquipped,
  isLevelLocked,
  canAfford,
  injectCosmeticsStyles,
  wireVenueCosmetics,
} from './cosmetics.js';
import { createProfileHeader } from './profileScreen.js';

/**
 * @param {{store, socket, engine, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createShopScreen(ctx) {
  const { store, socket, engine, toast, back } = ctx;
  injectCosmeticsStyles();
  // R9 venue wiring lives with the shop (built once at boot): the host's
  // equipped table/deco drive the 3D bar via the R3 engine hooks.
  wireVenueCosmetics(store, engine);

  const headerSlot = el('div', {});
  const catalogEl = el('div', {});

  /** itemIds with a buy/equip request in flight (cleared on profile/error). */
  const pending = new Set();

  function sendBuy(item) {
    if (pending.has(item.id)) return;
    pending.add(item.id);
    socket.send(MSG.BUY_COSMETIC, { itemId: item.id });
    render(); // show the in-flight state; the profile frame re-renders after
  }

  function sendEquip(slot, itemId) {
    socket.send(MSG.EQUIP_COSMETIC, { slot, itemId });
  }

  function itemCard(item, profile) {
    const owned = isOwned(profile, item.id);
    const equipped = isEquipped(profile, item);
    const locked = !owned && isLevelLocked(profile, item);
    const broke = !owned && !locked && !canAfford(profile, item);
    const inFlight = pending.has(item.id);

    const tags = el('div', { className: 'r9-tags' }, [
      owned ? null : el('span', { className: 'r9-price', text: `🍌 ${item.price}` }),
      item.minLevel > 1 && !owned ? el('span', { className: 'r9-lvl', text: `LV ${item.minLevel}` }) : null,
    ]);

    let stateTag;
    if (equipped) stateTag = el('span', { className: 'lock-tag unlocked', text: '✔ EQUIPPED' });
    else if (owned) stateTag = el('span', { className: 'lock-tag', text: 'OWNED' });
    else if (locked) stateTag = el('span', { className: 'lock-tag', text: `🔒 LV ${item.minLevel}` });
    else stateTag = null;

    let action;
    if (equipped) {
      action = el('button', {
        className: 'btn small ghost',
        type: 'button',
        text: 'Unequip',
        onClick: () => sendEquip(item.slot, null),
      });
    } else if (owned) {
      action = el('button', {
        className: 'btn small',
        type: 'button',
        text: 'Equip',
        onClick: () => sendEquip(item.slot, item.id),
      });
    } else if (locked) {
      action = el('button', { className: 'btn small', type: 'button', text: `Locked — LV ${item.minLevel}`, disabled: 'disabled' });
    } else {
      // affordable AND broke buys both go to the server — it is the authority
      // (a broke click comes back as a CANT_AFFORD error toast).
      action = el('button', {
        className: `btn small primary ${broke ? 'r9-buy-broke' : ''}`,
        type: 'button',
        text: inFlight ? 'Buying…' : `Buy 🍌 ${item.price}`,
        onClick: () => sendBuy(item),
      });
      if (inFlight) action.disabled = true;
    }

    return el(
      'div',
      {
        className: `shop-item ${locked ? 'locked' : ''} ${equipped ? 'r9-equipped' : ''} ${broke ? 'r9-insufficient' : ''}`,
        title: item.desc,
      },
      [
        tags,
        stateTag,
        el('div', { className: 'glyph', text: item.glyph }),
        el('div', { className: 'si-name', text: item.name }),
        el('div', { className: 'si-desc', text: item.desc }),
        el('div', { className: 'r9-actions' }, [action]),
      ]
    );
  }

  function render() {
    const profile = store.get('profile') ?? {};
    clear(headerSlot);
    headerSlot.append(createProfileHeader(profile));

    clear(catalogEl);
    for (const slot of SLOT_IDS) {
      const meta = SLOT_META[slot];
      catalogEl.append(
        el('div', { className: 'r9-slot-head' }, [
          el('h3', { text: `${meta.glyph} ${meta.label}` }),
          el('span', { className: 'blurb', text: meta.blurb }),
        ])
      );
      const grid = el('div', { className: 'shop-grid' });
      for (const item of getCosmeticsBySlot(slot)) grid.append(itemCard(item, profile));
      catalogEl.append(grid);
    }
  }

  // fresh profile frame (after buy/equip/rewards) → resolve pending + re-render
  store.on('profile', (profile, prev) => {
    for (const id of [...pending]) {
      if (isOwned(profile, id)) {
        pending.delete(id);
        const item = getCosmetic(id);
        if (item && !isOwned(prev, id)) toast(`${item.glyph} ${item.name} is yours!`);
      }
    }
    if (store.get('screen') === 'shop') render();
  });

  // failed buys: clear the in-flight state + friendlier shop copy
  socket.on(MSG.ERROR, (p) => {
    if (store.get('screen') !== 'shop') return;
    if (pending.size) {
      pending.clear();
      render();
    }
    if (p.code === ERROR_CODES.CANT_AFFORD) {
      toast(`Not enough Banana Coins — it ${p.msg ?? 'costs more than you have'}. Win some matches!`, 'error');
    } else if (p.code === ERROR_CODES.LOCKED) {
      toast(`Locked — ${p.msg ?? 'level too low'}. Keep playing!`, 'error');
    }
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel purple shop-panel' }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🛍️ The Back Room' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        headerSlot,
        catalogEl,
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
