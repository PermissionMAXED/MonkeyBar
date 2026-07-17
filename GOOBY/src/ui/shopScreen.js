// Shop screen (§C5, §C4 — agent G11): the real shop UI. Full-screen with 4
// tabs — Food (16 foods, qty picker), Furniture (catalog by room+slot with
// owned/placed states + "place now"), Walls+Floors (buy+apply swatches per
// room) and Outfits (opens G12's wardrobe in buy mode — feature-detected).
//
// Modes (§C4): 'trip' — opened by systems/shopTrip.js on arrival, everything
// purchasable, "Go home" returns to the living room; 'browse' — opened from
// home (fridge-tray Order chip / confirm-sheet "Just browse"), read-only
// prices with the „Fahre zum Laden zum Einkaufen!" hint — EXCEPT food when
// Quick Delivery (§C4.6) is owned: order at +20% markup straight to inventory.
// The Quick Delivery unlock offer (400c, level ≥ 8) lives in the food tab
// during trips.
//
// registerShopScreen() is called from the G11 marker in systems/shopTrip.js
// (which boots from ui/hud.js). It also boots home/decor.js (dynamic import —
// three.js stays out of the node:test import chain) and augments two sibling
// panels via a MutationObserver so no G5/G7 file needs editing: the fridge
// food tray gets the quick-delivery "Order more" chip, the shop-trip confirm
// sheet gets a "Just browse" button.
//
// Module level stays DOM-free so systems/shopTrip.js (imported by node tests)
// can import this file headlessly.

import { ECONOMY, ROOMS } from '../data/constants.js';
import { t } from '../data/strings.js';
import { FOODS } from '../data/foods.js';
import { WALLPAPERS, FLOORS, furnitureFor, roomSlots } from '../data/furniture.js';
import { count as invCount } from '../systems/inventory.js';
import {
  canAfford,
  buyFood,
  quickPrice,
  canBuyQuickDelivery,
  buyQuickDelivery,
} from '../systems/economy.js';
import {
  isOwned,
  isPlaced,
  buyFurniture,
  buySurface,
  applySurface,
  appliedSurface,
} from '../systems/furniturePlacement.js';
import { icon } from './icons.js';

/** Food id → emoji (iconography, not translated text — mirrors G5's tray). */
const FOOD_EMOJI = {
  carrot: '🥕', apple: '🍎', banana: '🍌', bread: '🍞', cheese: '🧀',
  watermelon: '🍉', 'donut-sprinkles': '🍩', cupcake: '🧁', salad: '🥗',
  'ice-cream': '🍦', sandwich: '🥪', 'hot-dog': '🌭', pancakes: '🥞',
  burger: '🍔', pizza: '🍕', cake: '🍰',
};

/** Furniture id → emoji (falls back to the slot emoji). */
const FURN_EMOJI = {
  loungeSofa: '🛋️', loungeDesignSofa: '🛋️', loungeSofaCorner: '🛋️',
  televisionVintage: '📺', televisionModern: '📺',
  rugRounded: '🧶', rugRectangle: '🧶', rugRound: '🧶', rugDoormat: '🧶', rugSquare: '🧶',
  pottedPlant: '🪴', plantSmall1: '🌿', plantSmall2: '🌱', plantSmall3: '🍃',
  lampRoundFloor: '💡', lampSquareFloor: '💡', lampSquareTable: '💡', lampRoundTable: '🏮',
  bookcaseOpen: '📚', bookcaseClosedWide: '📚',
  'proc:artSunset': '🌅', 'proc:artCarrot': '🥕', 'proc:artAbstract': '🎨',
  table: '🍽️', tableCloth: '🍽️',
  kitchenFridge: '🧊', kitchenFridgeLarge: '🧊',
  toaster: '🍞', kitchenCoffeeMachine: '☕', kitchenBlender: '🥤',
  kitchenCabinetUpper: '🗄️', kitchenCabinetUpperDouble: '🗄️',
  bathtub: '🛁', showerRound: '🚿',
  bathroomCabinet: '🗄️', bathroomCabinetDrawer: '🗄️',
  bedSingle: '🛏️', bedDouble: '🛏️',
  bear: '🧸', 'proc:miniGooby': '🐰',
};

/** Decor slot id → emoji (decorate panel + furniture groups share these). */
export const SLOT_EMOJI = {
  sofa: '🛋️', tv: '📺', rug: '🧶', plant: '🪴', lamp: '💡', bookcase: '📚',
  wallArt: '🖼️', tableSet: '🍽️', fridge: '🧊', appliance: '☕', wallShelf: '🗄️',
  tub: '🛁', shelf: '🗄️', bed: '🛏️', nightstand: '💡', plushie: '🧸',
};

/** @param {import('../data/furniture.js').FurnitureEntry} entry */
export function furnEmoji(entry) {
  return FURN_EMOJI[entry.id] ?? SLOT_EMOJI[entry.slot] ?? '🪑';
}

/**
 * CSS background for a wallpaper/floor swatch chip (§D3-ish motif preview).
 * @param {import('../data/furniture.js').SurfaceEntry} entry
 * @returns {string}
 */
export function swatchStyle(entry) {
  if (entry.kind === 'floor') {
    return `background: repeating-linear-gradient(90deg, ${entry.motif} 0 5px, transparent 5px 18px) ${entry.base};`;
  }
  return (
    `background: radial-gradient(circle at 9px 9px, ${entry.motif} 3.2px, transparent 4px) ` +
    `0 0 / 18px 18px ${entry.base};`
  );
}

let wired = false;

/**
 * Register the shop screen + quick-delivery hooks. Called once from the G11
 * marker in systems/shopTrip.js (browser only).
 * @param {{store: object, ui: object, audio: object, goHome: () => void,
 *   getArrival: () => ({coins: number}|null), isAtShop: () => boolean}} deps
 */
export function registerShopScreen(deps) {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  const { store, ui, audio } = deps;

  ui.registerScreen('shop', createShopScreen(deps));
  installPanelHooks(deps);

  // Boot the decor system (3D application of the saved decor state + the
  // decorate-mode slot picker). Dynamic import: home/decor.js pulls three.js,
  // which must stay out of the shopTrip.js → shopScreen.js node import chain.
  import('../home/decor.js')
    .then((mod) => mod.initDecor({ store, ui, audio }))
    .catch((err) => console.warn('[shop] decor wiring unavailable:', err));
}

// ---------------------------------------------------------------------------
// Shop screen
// ---------------------------------------------------------------------------

/**
 * @param {{store: object, ui: object, audio: object, goHome: () => void,
 *   getArrival: () => ({coins: number}|null)}} deps
 * @returns {{mount: Function, unmount: Function}}
 */
function createShopScreen({ store, ui, audio, goHome, getArrival }) {
  /** @type {Array<() => void>} */
  let subs = [];
  /** @type {HTMLElement|null} */
  let bodyEl = null;
  let mode = 'browse';
  let tab = 'food';
  let decorRoom = ROOMS.DEFAULT;
  /** selected food + qty for the buy bar */
  let selFood = null;
  let qty = 1;

  const atTrip = () => mode === 'trip';
  /** food is buyable at the shop, or from home once Quick Delivery is owned */
  const foodBuyable = () => atTrip() || !!store.get('quickDelivery');
  const foodUnit = (food) => (atTrip() ? food.price : quickPrice(food.price));

  function coinsPill() {
    return `<span class="shop-coins">${icon('coin', 18)}<span class="shop-coins-n">${store.get('coins') ?? 0}</span></span>`;
  }

  function priceTag(price) {
    return price > 0
      ? `<span class="shop-price">${icon('coin', 13)}${price}</span>`
      : `<span class="shop-price">${t('shop.free')}</span>`;
  }

  // ------------------------------------------------------------------ food
  function renderFood() {
    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    const inv = store.get('inventory') ?? {};
    for (const food of FOODS) {
      const card = document.createElement('button');
      card.className = `shop-card${selFood === food.id ? ' shop-card-sel' : ''}`;
      const owned = invCount(inv, food.id);
      card.innerHTML = `
        ${owned > 0 ? `<span class="shop-count">×${owned}</span>` : ''}
        <span class="shop-emoji">${FOOD_EMOJI[food.id] ?? '🍽️'}</span>
        <span class="shop-name">${t(food.nameKey)}</span>
        ${priceTag(foodUnit(food))}`;
      card.addEventListener('click', () => {
        audio.play('ui.tap');
        if (!foodBuyable()) {
          ui.toast('shop.browseHint');
          return;
        }
        if (selFood !== food.id) {
          selFood = food.id;
          qty = 1;
        }
        renderBody();
      });
      grid.appendChild(card);
    }

    // quick-delivery unlock banner (§C4.6): offered at the shop until owned
    if (!store.get('quickDelivery')) {
      const level = store.get('level') ?? 1;
      const banner = document.createElement('div');
      banner.className = 'shop-banner';
      const gate = canBuyQuickDelivery(store);
      const canOffer = atTrip() && level >= ECONOMY.QUICK_DELIVERY_LEVEL;
      banner.innerHTML = `
        <span style="font-size:30px">🛵</span>
        <span class="shop-banner-text">
          <span class="shop-banner-title">${t('shop.qd.title')}</span><br>
          <span class="shop-banner-body">${t('shop.qd.pitch')}</span>
        </span>
        ${canOffer
          ? `<button class="btn btn-yellow qd-buy" ${gate.ok ? '' : 'disabled'}>${t('shop.qd.unlock', { price: ECONOMY.QUICK_DELIVERY_PRICE })}</button>`
          : `<span class="shop-banner-body shop-banner-hint">${level < ECONOMY.QUICK_DELIVERY_LEVEL ? t('shop.qd.needLevel', { level: ECONOMY.QUICK_DELIVERY_LEVEL }) : t('shop.browseHint')}</span>`}
      `;
      banner.querySelector('.qd-buy')?.addEventListener('click', () => {
        const res = buyQuickDelivery(store);
        if (res.ok) {
          audio.play('coin.spend');
          ui.toast('toast.qdUnlocked');
        } else if (res.reason === 'coins') {
          ui.toast('toast.notEnoughCoins');
        }
        renderBody();
      });
      bodyEl.appendChild(banner);
    }

    // buy bar (qty picker) for the selected food
    if (selFood && foodBuyable()) {
      const food = FOODS.find((f) => f.id === selFood);
      const unit = foodUnit(food);
      const bar = document.createElement('div');
      bar.className = 'shop-buybar';
      const total = () => unit * qty;
      bar.innerHTML = `
        <span class="shop-buybar-info">
          <span class="shop-buybar-name">${FOOD_EMOJI[food.id] ?? ''} ${t(food.nameKey)}</span>
          <span class="shop-buybar-total">${t('shop.total')}: ${icon('coin', 13)}<span class="bb-total">${total()}</span>${atTrip() ? '' : ` · ${t('shop.qd.note')}`}</span>
        </span>
        <span class="shop-qty">
          <button class="qty-btn bb-minus" aria-label="−">−</button>
          <span class="qty-n bb-n">${qty}</span>
          <button class="qty-btn bb-plus" aria-label="+">+</button>
        </span>
        <button class="btn btn-teal bb-buy">${t(atTrip() ? 'shop.buy' : 'shop.order')}</button>`;
      const nEl = bar.querySelector('.bb-n');
      const totalEl = bar.querySelector('.bb-total');
      const buyBtn = bar.querySelector('.bb-buy');
      const sync = () => {
        nEl.textContent = String(qty);
        totalEl.textContent = String(total());
        buyBtn.disabled = !canAfford(store, total());
      };
      bar.querySelector('.bb-minus').addEventListener('click', () => {
        qty = Math.max(1, qty - 1);
        sync();
      });
      bar.querySelector('.bb-plus').addEventListener('click', () => {
        qty = Math.min(99, qty + 1);
        sync();
      });
      buyBtn.addEventListener('click', () => {
        const res = buyFood(store, food.id, qty, { quick: !atTrip() });
        if (res.ok) {
          audio.play('coin.spend');
          ui.toast(atTrip() ? 'toast.foodBought' : 'toast.foodOrdered', { name: t(food.nameKey), n: qty });
          selFood = null;
          qty = 1;
        } else if (res.reason === 'coins') {
          ui.toast('toast.notEnoughCoins');
        }
        renderBody();
      });
      sync();
      bodyEl.appendChild(bar);
    }

    bodyEl.appendChild(grid);
  }

  // ------------------------------------------------------------- furniture
  function renderFurniture() {
    for (const roomId of ROOMS.ORDER) {
      const head = document.createElement('div');
      head.className = 'shop-section';
      head.textContent = t(`room.${roomId}`);
      bodyEl.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'shop-grid';
      for (const slotId of roomSlots(roomId)) {
        for (const entry of furnitureFor(roomId, slotId)) {
          grid.appendChild(furnitureCard(entry, roomId, slotId));
        }
      }
      bodyEl.appendChild(grid);
    }
  }

  /** @param {import('../data/furniture.js').FurnitureEntry} entry */
  function furnitureCard(entry, roomId, slotId) {
    const owned = isOwned(store, entry);
    const placed = isPlaced(store, entry.id, roomId, slotId);
    const card = document.createElement('button');
    card.className = 'shop-card';
    const state = placed
      ? `<span class="shop-state">✓ ${t('shop.placed')}</span>`
      : owned
        ? `<span class="shop-state">${entry.default ? t('shop.free') : t('shop.owned')} · ${t('shop.placeNow')}</span>`
        : priceTag(entry.price);
    card.innerHTML = `
      <span class="shop-emoji">${furnEmoji(entry)}</span>
      <span class="shop-name">${t(entry.nameKey)}</span>
      ${state}`;
    card.addEventListener('click', () => {
      audio.play('ui.tap');
      if (!owned) {
        if (!atTrip()) {
          ui.toast('shop.browseHint');
          return;
        }
        const res = buyFurniture(store, entry.id);
        if (!res.ok) {
          if (res.reason === 'coins') ui.toast('toast.notEnoughCoins');
          return;
        }
        audio.play('coin.spend');
        ui.toast('toast.itemBought', { name: t(entry.nameKey) });
        renderBody();
      }
      // owned (or just bought): "place now" → decorate-mode slot picker
      ui.openPanel('decorate', { roomId, slotId, onApplied: () => renderBody() });
    });
    return card;
  }

  // ------------------------------------------------- wallpaper + floor tab
  function renderDecor() {
    const chips = document.createElement('div');
    chips.className = 'room-chips';
    for (const roomId of ROOMS.ORDER) {
      const chip = document.createElement('button');
      chip.className = `room-chip${decorRoom === roomId ? ' room-chip-on' : ''}`;
      chip.textContent = t(`room.${roomId}`);
      chip.addEventListener('click', () => {
        audio.play('ui.tap');
        decorRoom = roomId;
        renderBody();
      });
      chips.appendChild(chip);
    }
    bodyEl.appendChild(chips);

    for (const [kind, list, labelKey] of [
      ['wallpaper', WALLPAPERS, 'shop.wallpapers'],
      ['floor', FLOORS, 'shop.floors'],
    ]) {
      const head = document.createElement('div');
      head.className = 'shop-section';
      head.textContent = t(labelKey);
      bodyEl.appendChild(head);
      const row = document.createElement('div');
      row.className = 'swatch-row';
      for (const entry of list) {
        row.appendChild(swatchCard(kind, entry));
      }
      bodyEl.appendChild(row);
    }
  }

  /** @param {'wallpaper'|'floor'} kind @param {import('../data/furniture.js').SurfaceEntry} entry */
  function swatchCard(kind, entry) {
    const owned = isOwned(store, entry);
    const applied = appliedSurface(store, kind, decorRoom) === entry.id;
    const sw = document.createElement('button');
    sw.className = `swatch${applied ? ' swatch-on' : ''}`;
    sw.innerHTML = `
      <span class="swatch-chip" style="${swatchStyle(entry)}"></span>
      <span class="swatch-name">${t(entry.nameKey)}</span>
      ${applied
        ? `<span class="swatch-price">✓ ${t('shop.applied')}</span>`
        : owned
          ? `<span class="swatch-price">${t('shop.apply')}</span>`
          : `<span class="swatch-price">${icon('coin', 12)}${entry.price}</span>`}`;
    sw.addEventListener('click', () => {
      audio.play('ui.tap');
      if (applied) return;
      if (!owned) {
        if (!atTrip()) {
          ui.toast('shop.browseHint');
          return;
        }
        const res = buySurface(store, kind, entry.id);
        if (!res.ok) {
          if (res.reason === 'coins') ui.toast('toast.notEnoughCoins');
          return;
        }
        audio.play('coin.spend');
      }
      applySurface(store, kind, decorRoom, entry.id); // buy + apply (§C5)
      ui.toast('toast.appliedItem', { name: t(entry.nameKey) });
      renderBody();
    });
    return sw;
  }

  // ---------------------------------------------------------------- outfits
  function renderOutfits() {
    const card = document.createElement('div');
    card.className = 'card shop-outfits-card';
    card.innerHTML = `
      <span class="shop-outfits-emoji">🎩</span>
      <div>${t('shop.outfitsPitch')}</div>
      <button class="btn btn-teal outfits-open">${icon('shirt', 20)} ${t('shop.outfitsOpen')}</button>
      ${atTrip() ? '' : `<div class="shop-banner-body">${t('wardrobe.shopOnly')}</div>`}`;
    card.querySelector('.outfits-open').addEventListener('click', () => {
      audio.play('ui.tap');
      // G12 wires: the wardrobe screen registers itself at boot — open it in
      // buy mode when present (feature-detect), else a friendly toast.
      if (ui.hasScreen('wardrobe')) {
        // F3: context-aware back — the wardrobe's back button must return to
        // THIS shop screen (trip state intact; systems/shopTrip.js keeps the
        // machine in 'shop' meanwhile) instead of ui.closeAll(), which would
        // strand the player over the parked-car scene with no UI (§C4).
        const returnMode = mode; // capture: the closure var resets on remount
        ui.showScreen('wardrobe', {
          mode: atTrip() ? 'buy' : 'browse',
          from: 'shop',
          onBack: () => ui.showScreen('shop', { mode: returnMode, tab: 'outfits' }),
        });
      } else {
        ui.toast('toast.comingSoon');
      }
    });
    bodyEl.appendChild(card);
  }

  // ------------------------------------------------------------ frame/tabs
  const TABS = [
    ['food', 'shop.tab.food', renderFood],
    ['furniture', 'shop.tab.furniture', renderFurniture],
    ['decor', 'shop.tab.decor', renderDecor],
    ['outfits', 'shop.tab.outfits', renderOutfits],
  ];

  function renderBody() {
    if (!bodyEl) return;
    bodyEl.textContent = '';
    TABS.find(([id]) => id === tab)?.[2]();
  }

  return {
    /**
     * @param {HTMLElement} el
     * @param {{mode?: 'trip'|'browse', tab?: string}} [params]
     */
    mount(el, params = {}) {
      mode = params.mode === 'trip' ? 'trip' : 'browse';
      tab = TABS.some(([id]) => id === params.tab) ? params.tab : 'food';
      selFood = null;
      qty = 1;

      const wrap = document.createElement('div');
      wrap.className = 'shop-wrap';
      const arrival = atTrip() ? getArrival?.() : null;
      wrap.innerHTML = `
        <div class="shop-head">
          ${atTrip() ? '' : `<button class="btn btn-ghost btn-round shop-close" aria-label="${t('ui.close')}">${icon('close', 20)}</button>`}
          <h1 class="shop-title">🛒 ${t('shop.title')}</h1>
          ${coinsPill()}
          ${atTrip() ? `<button class="btn btn-teal shop-home">${icon('home', 18)} ${t('trip.goHome')}</button>` : ''}
        </div>
        ${arrival ? `<div class="shop-hint">🎉 ${t('trip.earned', { coins: arrival.coins ?? 0 })}</div>` : ''}
        ${atTrip() ? '' : `<div class="shop-hint">🚗 ${t('shop.browseHint')}</div>`}
        <div class="shop-tabs"></div>
        <div class="shop-body"></div>`;
      const tabsEl = wrap.querySelector('.shop-tabs');
      for (const [id, key] of TABS) {
        const b = document.createElement('button');
        b.className = `shop-tab${tab === id ? ' shop-tab-on' : ''}`;
        b.dataset.tab = id;
        b.textContent = t(key);
        b.addEventListener('click', () => {
          audio.play('ui.tap');
          tab = id;
          selFood = null;
          for (const other of tabsEl.children) {
            other.classList.toggle('shop-tab-on', other === b);
          }
          renderBody();
        });
        tabsEl.appendChild(b);
      }
      wrap.querySelector('.shop-home')?.addEventListener('click', () => {
        audio.play('ui.tap');
        goHome();
      });
      wrap.querySelector('.shop-close')?.addEventListener('click', () => {
        audio.play('ui.tap');
        ui.closeAll();
      });
      el.appendChild(wrap);
      bodyEl = wrap.querySelector('.shop-body');
      renderBody();

      // live coin counter + re-render on inventory/decor changes from panels
      const coinsEl = wrap.querySelector('.shop-coins-n');
      subs = [
        store.on('coinsChanged', (coins) => {
          if (coinsEl) coinsEl.textContent = String(coins);
        }),
        store.on('decorChanged', () => renderBody()),
      ];
      audio.play('ui.open');
    },

    unmount() {
      for (const off of subs) off?.();
      subs = [];
      bodyEl = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Sibling-panel hooks (no G5/G7 file edits): fridge-tray Order chip +
// confirm-sheet "Just browse" — a MutationObserver on the #ui root watches
// for the panels' backdrops and augments them after mount.
// ---------------------------------------------------------------------------

/** @param {{store: object, ui: object, audio: object}} deps */
function installPanelHooks({ store, ui, audio }) {
  if (!ui.el || typeof window === 'undefined' || !window.MutationObserver) return;

  const observer = new window.MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains('panel-backdrop-foodTray')) decorateFoodTray(node);
        else if (node.classList.contains('panel-backdrop-shopTripConfirm')) decorateConfirm(node);
      }
    }
  });
  observer.observe(ui.el, { childList: true });

  /** Quick-delivery Order chip in the fridge tray (§C4.6) — only when owned. */
  function decorateFoodTray(backdrop) {
    if (!store.get('quickDelivery')) return;
    const panel = backdrop.querySelector('.panel');
    if (!panel || panel.querySelector('.g11-order-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-teal g11-order-btn';
    btn.innerHTML = `${icon('cart', 18)} ${t('shop.orderMore')} <span style="opacity:.75;font-size:13px">· ${t('shop.qd.note')}</span>`;
    btn.addEventListener('click', () => {
      audio.play('ui.tap');
      ui.closePanel('foodTray');
      ui.showScreen('shop', { mode: 'browse', tab: 'food' });
    });
    panel.appendChild(btn);
  }

  /** "Just browse" on the shop-trip confirm sheet → read-only shop (§C5). */
  function decorateConfirm(backdrop) {
    const row = backdrop.querySelector('.mg-btn-row');
    if (!row || row.querySelector('.g11-browse-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost g11-browse-btn';
    btn.textContent = t('shop.browse');
    btn.addEventListener('click', () => {
      audio.play('ui.tap');
      ui.closePanel('shopTripConfirm');
      ui.showScreen('shop', { mode: 'browse' });
    });
    row.appendChild(btn);
  }
}
