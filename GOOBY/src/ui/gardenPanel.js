// V2/G19: Garden UI panels (PLAN2 §C2.2/§C11.3/§B6) — the DOM half of the
// garden: seed picker sheet, compost-bin sell sheet, plot-purchase sheet,
// forecast chip + sheet. The 3D half (plots, drags, ticks) lives in
// home/gardenInteractions.js; engine math is systems/garden.js (pure).
//
// Panels are §E6 ui modules registered by registerGardenUi():
//   ui.openPanel('gardenSeeds',   { plotIdx })   tap an empty owned plot
//   ui.openPanel('gardenSell')                   tap the compost bin
//   ui.openPanel('gardenBuyPlot', { index })     tap a FOR-SALE plot
//   ui.openPanel('gardenFertilizer')             tap the fertilizer bag
//   ui.openPanel('gardenForecast')               tap the forecast chip
//
// The forecast chip (§C11.3) lives INSIDE the garden room view (shown only
// while the garden is the active room — G23's global HUD is untouched):
// gardenInteractions calls showForecastChip(ui)/hideForecastChip().

import { t } from '../data/strings.js';
import { ITEM_PRICES } from '../data/constants.js';
import { CROPS, CROPS_BY_ID } from '../data/crops.js';
import * as garden from '../systems/garden.js';
import * as economy from '../systems/economy.js';
import { count as invCount } from '../systems/inventory.js';
import { now } from '../core/clock.js';
import { forecast } from '../systems/weather.js';
import audio from '../audio/audio.js';

/** crop id → emoji (mirrors the fridge tray's food emojis — §C2.2 toasts). */
export const CROP_EMOJI = Object.freeze({
  radish: '🍠', carrot: '🥕', salad: '🥗', tomato: '🍅',
  corn: '🌽', eggplant: '🍆', pumpkin: '🎃', watermelon: '🍉',
});

/** ☀️/☁️/🌧 procedural SVG icons (§C11.3) — stroke-free flat shapes. */
export function weatherIcon(state, size = 18) {
  const s = `width="${size}" height="${size}" viewBox="0 0 24 24"`;
  if (state === 'clear') {
    let rays = '';
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      rays += `<rect x="-1" y="-11" width="2" height="4.5" rx="1" fill="#F2B94E"
        transform="translate(12 12) rotate(${(a * 180) / Math.PI})"/>`;
    }
    return `<svg ${s} aria-hidden="true">${rays}<circle cx="12" cy="12" r="5" fill="#F7CF6B"/></svg>`;
  }
  const cloud = `<ellipse cx="9" cy="13" rx="5.5" ry="4.2" fill="{c}"/>
    <ellipse cx="15.5" cy="13.5" rx="5" ry="3.8" fill="{c}"/>
    <ellipse cx="12.5" cy="10.5" rx="4.5" ry="3.6" fill="{c}"/>`;
  if (state === 'cloudy') {
    return `<svg ${s} aria-hidden="true">${cloud.replaceAll('{c}', '#C9CDD4')}</svg>`;
  }
  let drops = '';
  for (const [x, d] of [[8, 0], [12, 1.6], [16, 0.8]]) {
    drops += `<path d="M${x} ${17 + d} q1.4 2.6 0 3.4 q-1.4 -0.8 0 -3.4" fill="#6FA8DC"/>`;
  }
  return `<svg ${s} aria-hidden="true">${cloud.replaceAll('{c}', '#9AA6B5')}${drops}</svg>`;
}

/** local hour of an epoch ms (forecast ranges are local blocks — §C11.3). */
const hourOf = (ms) => new Date(ms).getHours();
/** end-hour label: block ends land on 0/6/12/18 — show 24 instead of 0. */
const endHourOf = (ms) => hourOf(ms) === 0 ? 24 : hourOf(ms);

/**
 * V2 fix (E20): garden sheets must not survive the room panning away —
 * subscribe to roomManager's 'roomChanged' for the panel's lifetime and
 * close it on any room switch. Dynamic import (photoMode pattern) keeps
 * three.js/homeScene out of this module's static graph; the manager is
 * guaranteed live while a garden sheet is open (they only open from garden
 * taps inside the home scene).
 * @param {{closePanel: (id: string) => void}} ui
 * @param {string} panelId
 * @returns {() => void} unsubscribe (call from unmount)
 */
function closeOnRoomChange(ui, panelId) {
  let off = null;
  let dead = false;
  import('../home/homeScene.js')
    .then((mod) => {
      if (dead) return;
      const rm = mod.getRoomManager?.();
      if (rm) off = rm.on('roomChanged', () => ui.closePanel(panelId));
    })
    .catch(() => { /* headless/test boot without the home scene — fine */ });
  return () => {
    dead = true;
    off?.();
    off = null;
  };
}

// ---------------------------------------------------------------------------
// seed picker (§C2.2)
// ---------------------------------------------------------------------------

function createSeedPanel({ store, ui }) {
  /** @type {(() => void)|null} V2 fix (E20): room-change close unsubscribe */
  let offRoom = null;
  return {
    mount(el, params = {}) {
      offRoom = closeOnRoomChange(ui, 'gardenSeeds');
      const plotIdx = params.plotIdx ?? 0;
      const level = store.get('level') ?? 1;
      el.innerHTML = `
        <h2 class="g19-title">${t('garden.seeds.title')}</h2>
        <p class="g19-hint">${t('garden.seeds.hint')}</p>
        <div class="g19-rows"></div>`;
      const rows = el.querySelector('.g19-rows');

      const render = () => {
        rows.innerHTML = '';
        for (const crop of CROPS) {
          const locked = level < crop.unlock;
          const owned = store.get(`items.${economy.seedKey(crop.id)}`) ?? 0;
          const row = document.createElement('div');
          row.className = `g19-row${locked ? ' g19-locked' : ''}`;
          // V2 fix (E16): info line and action buttons live on SEPARATE flex
          // lines — buttons used to wrap under the neighbouring row's opaque
          // background at narrow widths (unreachable via elementFromPoint).
          row.innerHTML = `
            <div class="g19-row-main">
              <span class="g19-emoji">${CROP_EMOJI[crop.id] ?? '🌱'}</span>
              <span class="g19-info">
                <span class="g19-name">${t(crop.nameKey)}</span>
                <span class="g19-sub">${locked
                  ? t('garden.seeds.locked', { level: crop.unlock })
                  : `${t('garden.seeds.growTime', { min: crop.growthMin })} · 💧×${crop.waterings}`}</span>
              </span>
              <span class="g19-count">${t('garden.seeds.owned', { n: owned })}</span>
            </div>`;
          if (!locked) {
            const actions = document.createElement('div');
            actions.className = 'g19-actions';
            const plantBtn = document.createElement('button');
            plantBtn.className = 'btn g19-btn';
            plantBtn.textContent = t('garden.seeds.plant');
            plantBtn.disabled = owned < 1;
            plantBtn.addEventListener('click', () => plant(crop));
            const buyBtn = document.createElement('button');
            buyBtn.className = 'btn btn-ghost g19-btn';
            buyBtn.textContent = t('garden.seeds.buy', { price: crop.seedPrice });
            buyBtn.addEventListener('click', () => buy(crop));
            actions.append(plantBtn, buyBtn);
            row.appendChild(actions);
          }
          rows.appendChild(row);
        }
      };

      const buy = (crop) => {
        const res = economy.buySeed(store, crop.id);
        if (!res.ok) {
          audio.play('ui.error');
          if (res.reason === 'coins') ui.toast('garden.seeds.noCoins');
          return;
        }
        audio.play('garden.buy');
        render();
      };

      const plant = (crop) => {
        const key = economy.seedKey(crop.id);
        if ((store.get(`items.${key}`) ?? 0) < 1) return;
        // bring bookkeeping current, then plant (engine contract — §C2.3)
        const nowMs = now();
        const ticked = garden.tick(store.get('garden'), nowMs, CROPS_BY_ID).g;
        const res = garden.plant(ticked, plotIdx, crop, nowMs);
        if (!res.ok) {
          audio.play('ui.error');
          return;
        }
        store.update((state) => {
          state.items[key] -= 1;
          state.garden = res.g;
          state.achievements.counters.plantings += 1;
        });
        audio.play('garden.plant');
        ui.toast('garden.planted', { name: t(crop.nameKey) });
        ui.closePanel('gardenSeeds');
      };

      render();
    },
    unmount() {
      offRoom?.(); // V2 fix (E20)
      offRoom = null;
    },
  };
}

// ---------------------------------------------------------------------------
// compost-bin sell sheet (§C2.2)
// ---------------------------------------------------------------------------

function createSellPanel({ store, ui }) {
  /** @type {(() => void)|null} V2 fix (E20): room-change close unsubscribe */
  let offRoom = null;
  return {
    mount(el) {
      offRoom = closeOnRoomChange(ui, 'gardenSell');
      el.innerHTML = `
        <h2 class="g19-title">${t('garden.sell.title')}</h2>
        <div class="g19-rows"></div>`;
      const rows = el.querySelector('.g19-rows');

      const render = () => {
        rows.innerHTML = '';
        const inv = store.get('inventory') ?? {};
        const sellable = CROPS.filter((c) => invCount(inv, c.foodId) > 0);
        if (sellable.length === 0) {
          rows.innerHTML = `<div class="g19-empty">${t('garden.sell.empty')}</div>`;
          return;
        }
        for (const crop of sellable) {
          const n = invCount(inv, crop.foodId);
          const row = document.createElement('div');
          row.className = 'g19-row';
          // V2 fix (E16): buttons on their own flex line — see seed panel note.
          row.innerHTML = `
            <div class="g19-row-main">
              <span class="g19-emoji">${CROP_EMOJI[crop.id] ?? '🌱'}</span>
              <span class="g19-info">
                <span class="g19-name">${t(crop.nameKey)}</span>
                <span class="g19-sub">${t('garden.sell.price', { price: crop.sellPrice })}</span>
              </span>
              <span class="g19-count">×${n}</span>
            </div>`;
          const actions = document.createElement('div');
          actions.className = 'g19-actions';
          const one = document.createElement('button');
          one.className = 'btn btn-ghost g19-btn';
          one.textContent = t('garden.sell.one');
          one.addEventListener('click', () => sell(crop, 1));
          const all = document.createElement('button');
          all.className = 'btn g19-btn';
          all.textContent = t('garden.sell.all');
          all.addEventListener('click', () => sell(crop, invCount(store.get('inventory'), crop.foodId)));
          actions.append(one, all);
          row.appendChild(actions);
          rows.appendChild(row);
        }
      };

      const sell = (crop, qty) => {
        const res = economy.sellHarvest(store, crop.foodId, qty);
        if (!res.ok) {
          audio.play('ui.error');
          return;
        }
        audio.play('garden.sell');
        ui.toast('garden.sold', { coins: res.total });
        render();
      };

      render();
    },
    unmount() {
      offRoom?.(); // V2 fix (E20)
      offRoom = null;
    },
  };
}

// ---------------------------------------------------------------------------
// plot purchase sheet (§B6: plot 5 L10/300c, plot 6 L16/600c)
// ---------------------------------------------------------------------------

function createBuyPlotPanel({ store, ui }) {
  /** @type {(() => void)|null} V2 fix (E20): room-change close unsubscribe */
  let offRoom = null;
  return {
    mount(el, params = {}) {
      offRoom = closeOnRoomChange(ui, 'gardenBuyPlot');
      const index = params.index ?? store.get('garden.plotsOwned') ?? 4;
      const level = store.get('level') ?? 1;
      const gate = garden.canBuyPlot(store.get('garden'), index, level);
      const def = garden.PLOT_PURCHASES[index];
      const levelLocked = def && level < def.level;
      el.innerHTML = `
        <h2 class="g19-title">${t('garden.plot.title')}</h2>
        <p class="g19-hint">${t('garden.plot.body')}</p>
        <p class="g19-price">🪙 ${t('garden.plot.price', { price: gate.price })}</p>
        ${levelLocked ? `<p class="g19-lockmsg">🔒 ${t('garden.plot.locked', { level: def.level })}</p>` : ''}
        <div class="g19-btnrow"></div>`;
      const btnRow = el.querySelector('.g19-btnrow');
      const buyBtn = document.createElement('button');
      buyBtn.className = 'btn g19-btn-wide';
      buyBtn.textContent = t('garden.plot.buy');
      buyBtn.disabled = !gate.ok;
      buyBtn.addEventListener('click', () => {
        const res = economy.buyPlot(store, index);
        if (!res.ok) {
          audio.play('ui.error');
          if (res.reason === 'coins') ui.toast('garden.plot.noCoins');
          return;
        }
        audio.play('garden.buy');
        ui.toast('garden.plot.bought');
        ui.closePanel('gardenBuyPlot');
      });
      btnRow.appendChild(buyBtn);
    },
    unmount() {
      offRoom?.(); // V2 fix (E20)
      offRoom = null;
    },
  };
}

// ---------------------------------------------------------------------------
// fertilizer sheet (§C2.2 — buy here, drag the bag to use)
// ---------------------------------------------------------------------------

function createFertilizerPanel({ store, ui }) {
  /** @type {(() => void)|null} V2 fix (E20): room-change close unsubscribe */
  let offRoom = null;
  return {
    mount(el) {
      offRoom = closeOnRoomChange(ui, 'gardenFertilizer');
      const render = () => {
        const owned = store.get('items.fertilizer') ?? 0;
        el.innerHTML = `
          <h2 class="g19-title">✨ ${t('garden.fert.title')}</h2>
          <p class="g19-hint">${t('garden.fert.body')}</p>
          <p class="g19-price">${t('garden.fert.owned', { n: owned })}</p>
          <p class="g19-hint">${t('garden.fert.hint')}</p>
          <div class="g19-btnrow"></div>`;
        const buyBtn = document.createElement('button');
        buyBtn.className = 'btn g19-btn-wide';
        buyBtn.textContent = t('garden.fert.buy', { price: ITEM_PRICES.fertilizer });
        buyBtn.addEventListener('click', () => {
          const res = economy.buyItem(store, 'fertilizer');
          if (!res.ok) {
            audio.play('ui.error');
            if (res.reason === 'coins') ui.toast('garden.seeds.noCoins');
            return;
          }
          audio.play('garden.buy');
          render();
        });
        el.querySelector('.g19-btnrow').appendChild(buyBtn);
      };
      render();
    },
    unmount() {
      offRoom?.(); // V2 fix (E20)
      offRoom = null;
    },
  };
}

// ---------------------------------------------------------------------------
// forecast chip + sheet (§C11.3)
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} the in-garden chip (one at a time) */
let chipEl = null;
/** @type {ReturnType<typeof setInterval>|null} */
let chipTimer = null;

function renderChip() {
  if (!chipEl) return;
  const [cur, next] = forecast(now());
  chipEl.innerHTML =
    `<span class="g19-chip-icon">${weatherIcon(cur.state, 20)}</span>` +
    `<span class="g19-chip-arrow">›</span>` +
    `<span class="g19-chip-icon g19-chip-next">${weatherIcon(next.state, 16)}</span>`;
}

/**
 * Show the garden forecast chip (§C11.3 — INSIDE the garden room view only;
 * gardenInteractions shows/hides it on room change).
 * @param {{el: HTMLElement, openPanel: Function}} ui
 */
export function showForecastChip(ui) {
  if (chipEl) return;
  chipEl = document.createElement('button');
  chipEl.className = 'g19-chip';
  chipEl.setAttribute('aria-label', t('garden.forecast.title'));
  chipEl.addEventListener('click', () => {
    audio.play('ui.open');
    ui.openPanel('gardenForecast');
  });
  ui.el.appendChild(chipEl);
  renderChip();
  chipTimer = setInterval(renderChip, 60000);
}

/** Remove the forecast chip (leaving the garden / scene exit). */
export function hideForecastChip() {
  if (chipTimer) clearInterval(chipTimer);
  chipTimer = null;
  chipEl?.remove();
  chipEl = null;
}

function createForecastPanel({ ui }) {
  /** @type {(() => void)|null} V2 fix (E20): room-change close unsubscribe */
  let offRoom = null;
  return {
    mount(el) {
      offRoom = closeOnRoomChange(ui, 'gardenForecast');
      const [cur, next] = forecast(now());
      const line = (label, info) => `
        <div class="g19-row g19-forecast-row">
          <span class="g19-chip-icon">${weatherIcon(info.state, 26)}</span>
          <span class="g19-info">
            <span class="g19-name">${label}: ${t(`weather.${info.state}`)}</span>
            <span class="g19-sub">${t('garden.forecast.range', {
              state: t(`weather.${info.state}`),
              from: hourOf(info.start),
              to: endHourOf(info.end),
            })}</span>
          </span>
        </div>`;
      el.innerHTML = `
        <h2 class="g19-title">${t('garden.forecast.title')}</h2>
        ${line(t('garden.forecast.now'), cur)}
        ${line(t('garden.forecast.next'), next)}
        ${cur.state === 'rain' || next.state === 'rain'
          ? `<p class="g19-hint">☔ ${t('garden.forecast.rainTip')}</p>` : ''}`;
    },
    unmount() {
      offRoom?.(); // V2 fix (E20)
      offRoom = null;
    },
  };
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Register every garden panel on the ui (§E6). Called once from main.js
 * (V2/G19 marked block).
 * @param {{store: object, ui: object}} deps
 */
export function registerGardenUi({ store, ui }) {
  ui.registerPanel('gardenSeeds', createSeedPanel({ store, ui }));
  ui.registerPanel('gardenSell', createSellPanel({ store, ui }));
  ui.registerPanel('gardenBuyPlot', createBuyPlotPanel({ store, ui }));
  ui.registerPanel('gardenFertilizer', createFertilizerPanel({ store, ui }));
  ui.registerPanel('gardenForecast', createForecastPanel({ ui }));
}
