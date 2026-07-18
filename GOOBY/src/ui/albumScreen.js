// Sticker album (PLAN2 §C6, agent V2/G23) — ui screen 'album', opened by the
// HUD profile flow / ?open=album (L1). 4 pages (one per COLLECTION_SETS set)
// behind a tab strip: sticker slots render grey silhouettes until earned,
// repeat counts as ×N badges, and every page has a set progress bar + a claim
// button that pays the §C6 completion reward ONCE (coins + procedural deco
// into furniture.owned + set XP) via the achievements engine's live
// collections API. Sticker art is procedural: per-entry tinted tile + set
// icon (no bitmap assets — §D4).

import { COLLECTION_SETS, getCollectionSet } from '../data/collections.js';
import { countOf, setProgress, isSetComplete } from '../systems/collections.js';
import { getAchievementsEngine } from '../systems/achievementsEngine.js';
import { t, getLang } from '../data/strings.js';
import { icon } from './icons.js';

/** Set id → tab icon (icons.js names — reuse per §E0.2). */
const SET_ICONS = { fish: 'fish', veggies: 'carrot', landmarks: 'home', treats: 'hunger' };

/** Deterministic pastel tint per sticker id (procedural art, §D4). */
function tintOf(setId, entryId) {
  let h = 0;
  const s = `${setId}.${entryId}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 62% 72%)`;
}

const ALBUM_CSS = `
.screen-album{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g23-al-head{width:100%;max-width:440px;display:flex;align-items:center;gap:10px;margin:6px 0 6px;flex:none;}
.g23-al-title{flex:1;min-width:0;margin:0;font-size:clamp(17px,6vw,30px);font-weight:800;color:var(--brown);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.g23-al-count{flex:none;background:var(--white);border-radius:999px;padding:8px 12px;font-size:15px;font-weight:800;color:var(--teal-dark);box-shadow:var(--shadow-soft);font-variant-numeric:tabular-nums;}
.g23-al-tabs{width:100%;max-width:440px;display:flex;gap:6px;flex:none;margin-bottom:8px;}
.g23-al-tab{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:none;border-radius:14px;min-height:44px;padding:9px 4px;font-family:inherit;font-size:12px;font-weight:800;cursor:pointer;background:rgba(255,255,255,.6);color:var(--brown);box-shadow:var(--shadow-soft);-webkit-tap-highlight-color:transparent;} /* V2 fix (E16): >=44px hit target */
.g23-al-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g23-al-tab.g23-active{background:var(--teal);color:#fff;}
.g23-al-page{width:100%;max-width:440px;background:var(--white);border-radius:18px;box-shadow:var(--shadow-soft);padding:14px;flex:none;margin-bottom:18px;}
.g23-al-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:10px;}
.g23-al-slot{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;border:none;background:none;padding:0;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.g23-al-art{width:58px;height:58px;border-radius:16px;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-soft);}
.g23-al-slot.g23-owned .g23-al-art{color:rgba(42,26,60,.75);}
.g23-al-slot.g23-missing .g23-al-art{background:rgba(74,59,54,.1)!important;color:rgba(74,59,54,.28);}
.g23-al-name{max-width:80px;font-size:10px;font-weight:800;color:var(--brown);text-align:center;line-height:1.15;overflow:hidden;text-overflow:ellipsis;}
.g23-al-slot.g23-missing .g23-al-name{opacity:.45;}
.g23-al-n{position:absolute;top:-4px;right:2px;background:var(--pink);color:#fff;border-radius:999px;font-size:10px;font-weight:800;padding:2px 6px;font-variant-numeric:tabular-nums;}
.g23-al-flavor{min-height:16px;margin-top:10px;font-size:12px;font-weight:700;color:var(--brown);opacity:.65;text-align:center;}
.g23-al-setrow{display:flex;align-items:center;gap:10px;margin-top:12px;}
.g23-al-bar{flex:1;height:9px;border-radius:999px;background:rgba(74,59,54,.1);overflow:hidden;}
.g23-al-fill{display:block;height:100%;border-radius:999px;background:var(--teal);transition:width 300ms ease;}
.g23-al-progress{flex:none;font-size:12px;font-weight:800;opacity:.6;font-variant-numeric:tabular-nums;}
.g23-al-claim{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:none;border-radius:999px;min-height:44px;min-width:44px;padding:8px 14px;font-family:inherit;font-size:12px;font-weight:800;cursor:pointer;background:rgba(74,59,54,.08);color:rgba(74,59,54,.45);-webkit-tap-highlight-color:transparent;} /* V2 fix (E16): >=44px hit target */
.g23-al-claim.g23-ready{background:var(--yellow);color:#fff;box-shadow:var(--shadow-soft);}
.g23-al-claim.g23-claimed-btn{color:var(--teal-dark);}
`;

/**
 * Create + register the sticker album screen (ui screen 'album').
 * @param {{store: object, ui: object, audio: object}} deps
 */
export function registerAlbumScreen({ store, ui, audio }) {
  if (!document.querySelector('style[data-owner="g23-album"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g23-album';
    style.textContent = ALBUM_CSS;
    document.head.appendChild(style);
  }

  /** @type {{off: Function}|null} */
  let live = null;
  let activeSet = COLLECTION_SETS[0]?.id ?? 'fish';
  /** Tapped sticker ('<setId>.<entryId>') — survives the store-change
   * re-renders (the time engine ticks 'change' every second). */
  let flavorKey = null;

  function mount(el, params = {}) {
    if (params.set && getCollectionSet(params.set)) activeSet = params.set;
    flavorKey = null;

    const head = document.createElement('div');
    head.className = 'g23-al-head';
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost btn-round';
    backBtn.setAttribute('aria-label', t('ui.back'));
    backBtn.innerHTML = icon('arrowLeft', 22);
    backBtn.addEventListener('click', () => {
      audio.play('ui.close');
      ui.closeAll();
    });
    const title = document.createElement('h1');
    title.className = 'g23-al-title';
    title.textContent = t('album.title');
    const count = document.createElement('div');
    count.className = 'g23-al-count';
    head.append(backBtn, title, count);
    el.appendChild(head);

    const tabs = document.createElement('div');
    tabs.className = 'g23-al-tabs';
    el.appendChild(tabs);

    const page = document.createElement('div');
    page.className = 'g23-al-page';
    el.appendChild(page);

    function render() {
      const c = store.get('collections') ?? { entries: {}, claimedSets: {} };
      const totalOwned = Object.values(c.entries ?? {})
        .filter((n) => Math.floor(Number(n) || 0) >= 1).length;
      const totalAll = COLLECTION_SETS.reduce((s, set) => s + set.entries.length, 0);
      count.textContent = `${totalOwned}/${totalAll}`;

      tabs.innerHTML = '';
      for (const set of COLLECTION_SETS) {
        const tab = document.createElement('button');
        tab.className = `g23-al-tab${set.id === activeSet ? ' g23-active' : ''}`;
        tab.innerHTML = `${icon(SET_ICONS[set.id] ?? 'star', 14)}<span>${t(set.nameKey)}</span>`;
        tab.addEventListener('click', () => {
          audio.play('ui.tap');
          activeSet = set.id;
          flavorKey = null;
          render();
        });
        tabs.appendChild(tab);
      }

      const set = getCollectionSet(activeSet);
      page.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'g23-al-grid';
      const flavor = document.createElement('div');
      flavor.className = 'g23-al-flavor';
      for (const entry of set.entries) {
        const n = countOf(c, set.id, entry.id);
        const owned = n >= 1;
        const slot = document.createElement('button');
        slot.className = `g23-al-slot ${owned ? 'g23-owned' : 'g23-missing'}`;
        slot.innerHTML = `
          <span class="g23-al-art" style="background:${tintOf(set.id, entry.id)}">${icon(SET_ICONS[set.id] ?? 'star', 30)}</span>
          <span class="g23-al-name">${owned ? t(entry.nameKey) : t('album.unknown')}</span>
          ${n > 1 ? `<span class="g23-al-n">×${n}</span>` : ''}`;
        if (owned) {
          if (flavorKey === entry.flavorKey) flavor.textContent = t(entry.flavorKey);
          slot.addEventListener('click', () => {
            audio.play('ui.pick');
            flavorKey = entry.flavorKey;
            flavor.textContent = t(entry.flavorKey);
          });
        }
        grid.appendChild(slot);
      }
      page.appendChild(grid);
      page.appendChild(flavor);

      const p = setProgress(c, set);
      const claimed = !!c.claimedSets?.[set.id];
      const complete = isSetComplete(c, set.id, set);
      const row = document.createElement('div');
      row.className = 'g23-al-setrow';
      row.innerHTML = `
        <span class="g23-al-bar"><span class="g23-al-fill" style="width:${Math.round((p.have / p.total) * 100)}%"></span></span>
        <span class="g23-al-progress">${t('album.setProgress', { have: p.have, total: p.total })}</span>
        <button class="g23-al-claim ${claimed ? 'g23-claimed-btn' : complete ? 'g23-ready' : ''}"
          ${complete && !claimed ? '' : 'disabled'}>
          ${icon(claimed ? 'check' : 'coin', 13)}${claimed ? t('album.claimed') : t('album.claim')}</button>`;
      const claimBtn = row.querySelector('.g23-al-claim');
      if (complete && !claimed) {
        claimBtn.addEventListener('click', () => {
          const reward = getAchievementsEngine()?.collections?.claimSet?.(set.id);
          if (reward) {
            audio.play('album.claim');
            ui.toast('toast.setClaimed', {
              name: t(set.nameKey),
              coins: reward.coins,
              item: t(`album.reward.${set.id}`),
            });
          }
        });
      }
      page.appendChild(row);
    }

    render();
    let lang = getLang();
    const off = store.on('change', () => {
      if (getLang() !== lang) lang = getLang();
      render();
    });
    live = { off };
  }

  function unmount() {
    live?.off?.();
    live = null;
  }

  ui.registerScreen('album', { mount, unmount });
}
