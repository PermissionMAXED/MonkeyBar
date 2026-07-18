// Shop screen (§C5, §C4 — agent G11): the real shop UI. Full-screen with 5
// tabs — Food (32 foods, qty picker; V2/G22: Alle/Gesund/Süßkram filters,
// junk 🍬 badges and the Care section: medicine/fertilizer/seed packets per
// PLAN2 §C7/§C3.5), Furniture (catalog by room+slot with owned/placed states
// + "place now"; V2/G22: room filter chips incl. the §C8.3 Garden section),
// Walls+Floors (buy+apply swatches per room), Outfits (opens G12's wardrobe
// in buy mode — feature-detected) and Skins (V2/G22, PLAN2 §C8.5: fur-color
// palette cards + live 3D try-on, L5 gate per §B6, economy.buySkin).
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

import { ECONOMY, ROOMS, UNLOCKS, ITEM_PRICES } from '../data/constants.js'; // V2/G22: + UNLOCKS/ITEM_PRICES
import { t } from '../data/strings.js';
import { FOODS } from '../data/foods.js';
import { WALLPAPERS, FLOORS, furnitureFor, roomSlots } from '../data/furniture.js';
import { CROPS } from '../data/crops.js'; // V2/G22: seed rows in the Care section (§C7)
import { SKINS, DEFAULT_SKIN, getSkin } from '../data/skins.js'; // V2/G22: Skins tab (§C8.5)
import musicDirector from '../audio/musicDirector.js'; // V3/G32: shop medley overlay (§B2.4)
import { count as invCount } from '../systems/inventory.js';
import { NOUGAT } from '../systems/nougat.logic.js'; // V3/G35: Nougatschleuse card (§C6.3)
import {
  canAfford,
  buyFood,
  quickPrice,
  canBuyQuickDelivery,
  buyQuickDelivery,
  buyItem, // V2/G22: medicine/fertilizer (§C3.5/§C2.2)
  buySeed, // V2/G22: seed packets (§C2.3)
  buySkin, // V2/G22: fur skins (§C8.5)
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
  // V2/G22: G20's §C7 catalog additions (kept in sync with interactions.js)
  radish: '🍠', tomato: '🍅', corn: '🌽', eggplant: '🍆', pumpkin: '🎃',
  strawberry: '🍓', grapes: '🍇', croissant: '🥐', lollypop: '🍭',
  cookie: '🍪', chocolate: '🍫', 'candy-bar': '🍬', muffin: '🥮',
  fries: '🍟', 'corn-dog': '🍢', sundae: '🍨',
  nutella: '🫙', // V3/G35 (§C6.1 — kept in sync with interactions.js)
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
  // V2/G22 (§C8.1/§C8.3): the +30 catalog additions
  loungeChair: '🛋️', tableCoffee: '🪵', tableCoffeeGlass: '🫖',
  cabinetTelevision: '🗄️', radio: '📻', speaker: '🔊', ceilingFan: '🌀',
  'proc:artSkyline': '🌆', 'proc:artRainbow': '🌈',
  kitchenMicrowave: '♨️', kitchenBar: '🍹', stoolBar: '🪑',
  washer: '🧺', shower: '🚿',
  sideTable: '🗄️', sideTableDrawers: '🗄️', cabinetBed: '🛏️', cabinetBedDrawer: '🛏️',
  coatRackStanding: '🧥', pillow: '🪶', pillowBlue: '🪶', books: '📚', trashcan: '🗑️',
  'proc:benchWood': '🪑', 'proc:benchPastel': '🎀', 'proc:gnome': '🧙', 'proc:gnomeGold': '✨',
  'proc:birdbath': '⛲', flowerBedWild: '🌼', flowerBedRose: '🌹',
  'proc:pathDirt': '🛤️', pathStones: '🪨', treeDefault: '🌳', treeBlossom: '🌸',
};

/** Decor slot id → emoji (decorate panel + furniture groups share these). */
export const SLOT_EMOJI = {
  sofa: '🛋️', tv: '📺', rug: '🧶', plant: '🪴', lamp: '💡', bookcase: '📚',
  wallArt: '🖼️', tableSet: '🍽️', fridge: '🧊', appliance: '☕', wallShelf: '🗄️',
  tub: '🛁', shelf: '🗄️', bed: '🛏️', nightstand: '💡', plushie: '🧸',
  // V2/G22: new indoor slots (§C8.1) + the 6 garden decor slots (§C8.3)
  ceilingFan: '🌀', sideboard: '📻', bar: '🍹', washer: '🧺',
  sideTable: '🗄️', floorClutter: '📚',
  gardenBench: '🪑', gardenGnome: '🧙', birdbath: '⛲', flowerBed: '🌼',
  gardenPath: '🪨', gardenTree: '🌳',
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

// V2/FIX-D (E17): ONE module-level try-on renderer for the Skins tab, reused
// across mounts AND tab re-renders (renderBody rebuilds the stage per render).
// Browsers cap live WebGL contexts (Chrome ≈16) and renderer.dispose() alone
// never releases a context, so the old renderer-per-render pattern eventually
// evicted the MAIN scene canvas and home rendered blank until reload.
/** @type {object|null} THREE.WebGLRenderer — untyped: three.js only ever
 * loads dynamically here (node:test import-chain rule, see mountSkinStage) */
let skinRenderer = null;

// V2/FIX-D (E16): module-scoped layout guards — styles.css belongs to another
// agent, so the shop's own fixes live in this injected block (same pattern as
// the other screens' data-owner styles).
// P1-3: long one-word DE wallpaper names („Sternennacht", „Sonnenuntergang")
//   painted over the neighbouring swatch's text at 390-430px — wrap them
//   inside the 72px swatch column instead (same RE3 ruling as .shop-name).
// P1-4: single-word tab labels (EN "Furniture") leaked into the neighbouring
//   wrapped tab at 320px — shrink slightly, allow in-word wrapping and clip
//   as a last resort; min-height keeps every tab ≥44px tall (§D5).
// V3/G33 (§B3): mechanical px→rem sweep (÷16) of this injected CSS string —
// exemptions (1px hairlines/999px pills/shadows/@media px) per PLAN3 §B3.
const SHOP_FIX_CSS = `
.swatch .swatch-name{max-width:100%;text-align:center;line-height:1.2;overflow-wrap:anywhere;}
.swatch .swatch-price{max-width:100%;flex-wrap:wrap;justify-content:center;text-align:center;}
.shop-tabs .shop-tab{min-width:0;min-height:max(44px, 2.875rem);overflow:hidden;overflow-wrap:anywhere;font-size:clamp(0.6875rem,3.4vw,0.8125rem);line-height:1.2;padding:0.375rem 0.1875rem;}
`;

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

  if (!document.querySelector('style[data-owner="v2fd-shop"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'v2fd-shop';
    style.textContent = SHOP_FIX_CSS;
    document.head.appendChild(style); // V2/FIX-D (E16): after styles.css → wins ties
  }

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
  // V2/G22 state: food category filter (§C7), furniture room filter (§C8.3),
  // skins-tab try-on + its lazily booted 3D stage (§C8.5)
  let foodFilter = 'all';
  let furnRoom = 'all';
  let selSkin = null;
  /** @type {{dispose: () => void, setSkin: (id: string|null) => void}|null} */
  let skinStage = null;

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
  /** V2/G22 (§C7): Alle/Gesund/Süßkram category filters on the food tab. */
  const FOOD_FILTERS = [
    ['all', 'shop.filter.all', () => true],
    ['healthy', 'shop.filter.healthy', (f) => !f.junk],
    ['treats', 'shop.filter.treats', (f) => f.junk],
  ];

  function renderFood() {
    // V2/G22: category filter chips (§C7 — Alle/Gesund/Süßkram)
    const chips = document.createElement('div');
    chips.className = 'room-chips';
    for (const [id, key] of FOOD_FILTERS) {
      const chip = document.createElement('button');
      chip.className = `room-chip${foodFilter === id ? ' room-chip-on' : ''}`;
      chip.textContent = t(key);
      chip.addEventListener('click', () => {
        audio.play('ui.tap');
        foodFilter = id;
        selFood = null;
        renderBody();
      });
      chips.appendChild(chip);
    }
    bodyEl.appendChild(chips);

    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    const inv = store.get('inventory') ?? {};
    const matches = FOOD_FILTERS.find(([id]) => id === foodFilter)?.[2] ?? (() => true);
    for (const food of FOODS.filter(matches)) {
      const card = document.createElement('button');
      card.className = `shop-card${selFood === food.id ? ' shop-card-sel' : ''}`;
      const owned = invCount(inv, food.id);
      card.innerHTML = `
        ${owned > 0 ? `<span class="shop-count">×${owned}</span>` : ''}
        ${food.junk ? '<span class="g22-junk" aria-hidden="true">🍬</span>' : ''}
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
    renderCare(); // V2/G22: Care section under the food grid (§C7/§C3.5)
  }

  // ----------------------------------------------------------- care (V2/G22)
  // §C7: medicine 40c + fertilizer 25c rendered distinctly (not eatable-
  // looking) + seed packets (§C2.3, level-gated). All land in the `items`
  // slice via economy.buyItem/buySeed; medicine is quick-delivery eligible
  // (§C3.5) so the whole row follows the food-tab buyable gate.
  function renderCare() {
    const head = document.createElement('div');
    head.className = 'shop-section';
    head.textContent = t('shop.care.title');
    bodyEl.appendChild(head);
    const hint = document.createElement('div');
    hint.className = 'shop-banner-body g22-care-hint';
    hint.textContent = t('shop.care.hint');
    bodyEl.appendChild(hint);

    const row = document.createElement('div');
    row.className = 'shop-grid';
    const level = store.get('level') ?? 1;

    const careCard = ({ emoji, name, price, count, locked, lockLevel, onBuy }) => {
      const card = document.createElement('button');
      card.className = `shop-card g22-care-card${locked ? ' g22-locked' : ''}`;
      card.innerHTML = `
        ${count > 0 ? `<span class="shop-count">×${count}</span>` : ''}
        <span class="shop-emoji">${emoji}</span>
        <span class="shop-name">${name}</span>
        ${locked ? `<span class="shop-state">🔒 ${t('shop.lvl', { level: lockLevel })}</span>` : priceTag(price)}`;
      card.addEventListener('click', () => {
        audio.play('ui.tap');
        if (locked) {
          ui.toast('shop.qd.needLevel', { level: lockLevel });
          return;
        }
        if (!foodBuyable()) {
          ui.toast('shop.browseHint');
          return;
        }
        const res = onBuy();
        if (res.ok) {
          audio.play('coin.spend');
          ui.toast('toast.itemBought', { name });
        } else if (res.reason === 'coins') {
          ui.toast('toast.notEnoughCoins');
        } else if (res.reason === 'level') {
          ui.toast('shop.qd.needLevel', { level: lockLevel });
        }
        renderBody();
      });
      return card;
    };

    row.appendChild(careCard({
      emoji: '💊',
      name: t('shop.item.medicine'),
      price: ITEM_PRICES.medicine,
      count: store.get('items.medicine') ?? 0,
      onBuy: () => buyItem(store, 'medicine', 1),
    }));
    row.appendChild(careCard({
      emoji: '🌱',
      name: t('shop.item.fertilizer'),
      price: ITEM_PRICES.fertilizer,
      count: store.get('items.fertilizer') ?? 0,
      onBuy: () => buyItem(store, 'fertilizer', 1),
    }));
    for (const crop of CROPS) {
      row.appendChild(careCard({
        emoji: '🌾',
        name: t('shop.seedName', { name: t(crop.nameKey) }),
        price: crop.seedPrice,
        count: store.get(`items.seed:${crop.id}`) ?? 0,
        locked: level < crop.unlock,
        lockLevel: crop.unlock,
        onBuy: () => buySeed(store, crop.id, 1),
      }));
    }
    bodyEl.appendChild(row);
  }

  // ------------------------------------------------------------- furniture
  // V2/G22: room filter chips incl. the Garden section (§C8.3 — garden decor
  // is purchasable here; G19's rooms/garden.js renders the placed anchors).
  function renderFurniture() {
    const allRooms = [...ROOMS.ORDER, 'garden'];
    const roomLabel = (roomId) =>
      roomId === 'garden' ? t('shop.room.garden') : t(`room.${roomId}`);

    const chips = document.createElement('div');
    chips.className = 'room-chips';
    for (const roomId of ['all', ...allRooms]) {
      const chip = document.createElement('button');
      chip.className = `room-chip${furnRoom === roomId ? ' room-chip-on' : ''}`;
      chip.textContent = roomId === 'all' ? t('shop.filter.all') : roomLabel(roomId);
      chip.addEventListener('click', () => {
        audio.play('ui.tap');
        furnRoom = roomId;
        renderBody();
      });
      chips.appendChild(chip);
    }
    bodyEl.appendChild(chips);

    const rooms = furnRoom === 'all' ? allRooms : [furnRoom];
    for (const roomId of rooms) {
      const head = document.createElement('div');
      head.className = 'shop-section';
      head.textContent = roomLabel(roomId);
      bodyEl.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'shop-grid';
      for (const slotId of roomSlots(roomId)) {
        for (const entry of furnitureFor(roomId, slotId)) {
          grid.appendChild(furnitureCard(entry, roomId, slotId));
        }
      }
      // ---- V3/G35 (§C6.3): Nougatschleuse — kitchen fixture, 400 c / L5 ----
      if (roomId === 'kitchen') grid.appendChild(nougatCard());
      // ---- end V3/G35 ----
      bodyEl.appendChild(grid);
    }
  }

  // ---- V3/G35 (§C6.3): Nougatschleuse shop card ----------------------------
  // A FIXTURE, not decor: buying sets `nougat.installed = true` and it
  // auto-mounts on the kitchen wall (roomManager follows 'nougatChanged') —
  // NO decorate/placement step. 400 c, unlock L5 (numbers frozen in
  // systems/nougat.logic.js per §E0.1-2).
  function nougatCard() {
    const installed = store.get('nougat.installed') === true;
    const level = store.get('level') ?? 1;
    const locked = level < NOUGAT.UNLOCK_LEVEL;
    const card = document.createElement('button');
    card.className = `shop-card${locked && !installed ? ' g22-locked' : ''}`;
    const state = installed
      ? `<span class="shop-state">✓ ${t('shop.owned')}</span>`
      : locked
        ? `<span class="shop-state">🔒 ${t('shop.lvl', { level: NOUGAT.UNLOCK_LEVEL })}</span>`
        : priceTag(NOUGAT.PRICE);
    card.innerHTML = `
      <span class="shop-emoji">🍫</span>
      <span class="shop-name">${t('nougat.shopName')}</span>
      ${state}`;
    card.addEventListener('click', () => {
      audio.play('ui.tap');
      if (installed) return;
      if (locked) {
        ui.toast('shop.qd.needLevel', { level: NOUGAT.UNLOCK_LEVEL });
        return;
      }
      if (!atTrip()) {
        ui.toast('shop.browseHint');
        return;
      }
      if ((store.get('coins') ?? 0) < NOUGAT.PRICE) {
        ui.toast('toast.notEnoughCoins');
        return;
      }
      store.update((st) => {
        st.coins -= NOUGAT.PRICE;
        st.nougat = { ...(st.nougat ?? {}), installed: true };
      });
      audio.play('coin.spend');
      store.emit?.('nougatChanged', { installed: true }); // §B10 — roomManager mounts it
      ui.toast('nougat.installed'); // §C6.3 „Die Nougatschleuse ist installiert!"
      renderBody();
    });
    return card;
  }
  // ---- end V3/G35 card ----

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

  // ------------------------------------------------------------ skins (V2/G22)
  // §C8.5: palette swatch cards + a live 3D try-on stage. Equipping goes
  // through skins.equipped (economy.buySkin equips on purchase); the applier
  // in character/skins.js mutates the shared Gooby materials so the skin
  // shows everywhere (home, cameos, photo mode). Tab unlocks at L5 (§B6).
  /** @param {import('../data/skins.js').SkinDef} def */
  function skinSwatchStyle(def) {
    return (
      `background: linear-gradient(135deg, ${def.colors.body} 0 55%, ` +
      `${def.colors.belly} 55% 80%, ${def.colors.earInner} 80% 100%);`
    );
  }

  function disposeSkinStage() {
    skinStage?.dispose();
    skinStage = null;
  }

  /** Boot the try-on renderer lazily — three.js must stay out of the
   * node:test import chain (same rule as the decor boot above). */
  async function mountSkinStage(stageEl, badgeEl) {
    try {
      const THREE = await import('three');
      const { createGooby } = await import('../character/gooby.js');
      const skinsMod = await import('../character/skins.js');
      if (!bodyEl || !stageEl.isConnected) return; // tab switched meanwhile
      // V2/FIX-D (E17): reuse the one module-level context across mounts —
      // never a renderer per render (see the skinRenderer note up top).
      if (!skinRenderer) {
        skinRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      }
      const renderer = skinRenderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      const scene = new THREE.Scene();
      const hemi = new THREE.HemisphereLight('#fff5e8', '#b8a898', 1.05);
      const dir = new THREE.DirectionalLight('#fff2dd', 1.4);
      dir.position.set(1.6, 2.4, 2.2);
      scene.add(hemi, dir);
      const gooby = createGooby();
      gooby.setEmotion('happy');
      scene.add(gooby.group);
      stageEl.insertBefore(renderer.domElement, badgeEl);
      const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
      camera.position.set(0, 0.74, 1.8);
      camera.lookAt(0, 0.5, 0);
      const resize = () => {
        const w = stageEl.clientWidth || 320;
        const h = stageEl.clientHeight || 200;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      window.addEventListener('resize', resize);
      let raf = 0;
      let last = performance.now();
      const tick = (now) => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        gooby.update(dt);
        gooby.group.rotation.y = Math.sin(now / 2400) * 0.5;
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(tick);
      skinStage = {
        setSkin(id) {
          if (id) {
            skinsMod.previewSkin(gooby, getSkin(id));
            badgeEl.style.display = '';
            badgeEl.textContent = t('wardrobe.tryOn', { name: t(getSkin(id).nameKey) });
          } else {
            skinsMod.clearSkinPreview(gooby);
            badgeEl.style.display = 'none';
          }
        },
        dispose() {
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', resize);
          skinsMod.clearSkinPreview(gooby);
          gooby.dispose();
          // V2/FIX-D (E17): detach the canvas, KEEP the shared context alive
          renderer.domElement.remove();
        },
      };
      if (selSkin) skinStage.setSkin(selSkin);
    } catch (err) {
      console.warn('[shop] skin try-on stage unavailable:', err);
    }
  }

  function renderSkins() {
    const level = store.get('level') ?? 1;
    const locked = level < UNLOCKS.SKINS;
    const ownedSkins = store.get('skins.owned') ?? [DEFAULT_SKIN];
    const equippedSkin = store.get('skins.equipped') ?? DEFAULT_SKIN;

    if (locked) {
      const banner = document.createElement('div');
      banner.className = 'shop-banner';
      banner.innerHTML = `
        <span style="font-size:30px">🔒</span>
        <span class="shop-banner-text">
          <span class="shop-banner-title">${t('shop.tab.skins')}</span><br>
          <span class="shop-banner-body">${t('shop.skins.needLevel', { level: UNLOCKS.SKINS })}</span>
        </span>`;
      bodyEl.appendChild(banner);
    } else {
      const pitch = document.createElement('div');
      pitch.className = 'shop-banner-body g22-care-hint';
      pitch.textContent = t('shop.skins.pitch');
      bodyEl.appendChild(pitch);
    }

    // live 3D try-on stage (lazy renderer boot)
    const stageEl = document.createElement('div');
    stageEl.className = 'g22-skin-stage';
    const badgeEl = document.createElement('div');
    badgeEl.className = 'g22-skin-badge';
    badgeEl.style.display = 'none';
    stageEl.appendChild(badgeEl);
    bodyEl.appendChild(stageEl);
    mountSkinStage(stageEl, badgeEl);

    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    for (const def of SKINS) {
      const owned = ownedSkins.includes(def.id);
      const equipped = equippedSkin === def.id;
      const card = document.createElement('button');
      card.className =
        `shop-card g22-skin-card${equipped ? ' shop-card-sel' : ''}` +
        `${selSkin === def.id ? ' g22-skin-tryon' : ''}${locked ? ' g22-locked' : ''}`;
      const state = equipped
        ? `<span class="shop-state">✓ ${t('wardrobe.equipped')}</span>`
        : owned
          ? `<span class="shop-state">${t('shop.owned')} · ${t('shop.apply')}</span>`
          : priceTag(def.price);
      card.innerHTML = `
        <span class="g22-skin-chip" style="${skinSwatchStyle(def)}"></span>
        <span class="shop-name">${t(def.nameKey)}</span>
        ${state}`;
      card.addEventListener('click', () => {
        audio.play('ui.tap');
        if (locked) {
          ui.toast('shop.skins.needLevel', { level: UNLOCKS.SKINS });
          return;
        }
        if (owned) {
          if (!equipped) {
            selSkin = null;
            store.update((state2) => {
              state2.skins.equipped = def.id;
            });
            ui.toast('toast.appliedItem', { name: t(def.nameKey) });
          }
          skinStage?.setSkin(null);
          renderBody();
          return;
        }
        // not owned: live try-on; buying needs the shop trip (§C4)
        selSkin = selSkin === def.id ? null : def.id;
        skinStage?.setSkin(selSkin);
        if (!atTrip() && selSkin) ui.toast('shop.browseHint');
        for (const el of grid.children) {
          el.classList.toggle('g22-skin-tryon', el === card && !!selSkin);
        }
      });
      if (atTrip() && !locked && !owned) {
        const buyBtn = document.createElement('span');
        buyBtn.className = 'btn btn-teal g22-skin-buy';
        buyBtn.textContent = t('shop.buy');
        buyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const res = buySkin(store, def.id);
          if (res.ok) {
            selSkin = null;
            audio.play('coin.spend');
            audio.play('jingle.outfit');
            ui.toast('toast.itemBought', { name: t(def.nameKey) });
            skinStage?.setSkin(null);
          } else if (res.reason === 'coins') {
            ui.toast('toast.notEnoughCoins');
          } else if (res.reason === 'level') {
            ui.toast('shop.skins.needLevel', { level: UNLOCKS.SKINS });
          }
          renderBody();
        });
        card.appendChild(buyBtn);
      }
      grid.appendChild(card);
    }
    bodyEl.appendChild(grid);
  }

  // ------------------------------------------------------------ frame/tabs
  const TABS = [
    ['food', 'shop.tab.food', renderFood],
    ['furniture', 'shop.tab.furniture', renderFurniture],
    ['decor', 'shop.tab.decor', renderDecor],
    ['outfits', 'shop.tab.outfits', renderOutfits],
    ['skins', 'shop.tab.skins', renderSkins], // V2/G22 (§C8.5, L5 gate §B6)
  ];

  function renderBody() {
    if (!bodyEl) return;
    disposeSkinStage(); // V2/G22: the skins tab rebuilds its 3D stage per render
    bodyEl.textContent = '';
    TABS.find(([id]) => id === tab)?.[2]();
  }

  return {
    /**
     * @param {HTMLElement} el
     * @param {{mode?: 'trip'|'browse', tab?: string}} [params]
     */
    mount(el, params = {}) {
      musicDirector.pushContext('shop'); // V3/G32: shop medley overlay (§B2.4)
      mode = params.mode === 'trip' ? 'trip' : 'browse';
      tab = TABS.some(([id]) => id === params.tab) ? params.tab : 'food';
      selFood = null;
      qty = 1;
      foodFilter = 'all'; // V2/G22
      furnRoom = 'all';
      selSkin = null;

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
      musicDirector.popContext('shop'); // V3/G32: back to the scene medley (§B2.4)
      for (const off of subs) off?.();
      subs = [];
      bodyEl = null;
      disposeSkinStage(); // V2/G22: stop the skins-tab preview renderer
      selSkin = null;
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
