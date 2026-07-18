// Sticker album (PLAN2 §C6, agent V2/G23 + PLAN3 §C5.3, agent V3/G34) — ui
// screen 'album', opened by the HUD profile flow / ?open=album (L1).
//
// 3.0 layout (§B5/§C5.3): a TOP-LEVEL tab strip splits the screen into
//   „Sticker"     the v2 collections album (4 sets, claim rewards) — UNCHANGED
//   „Stickerbuch" the §C5 28-sticker book: 5 pages (6/6/6/6/4 slots, 2×3
//                 grid), horizontal swipe + page dots, „Seite 1–5" titles.
//                 Locked = greyscale silhouette (no padlock — mystery, not
//                 denial); unlocked = full AI art with a 300 ms pop-in +
//                 confetti on first view. Tap any slot → detail sheet (art
//                 large, title, flavor; locked shows the hint line instead).
//                 „NEU" pink dot until seen (stickers.seen via the engine).
//                 Header shows n/28 on the book tab.
// Book styles are component-injected module CSS (G33 owns styles.css this
// wave); new 3.0 rules are rem-based so the §B3 uiScale mechanism scales them.

import { COLLECTION_SETS, getCollectionSet } from '../data/collections.js';
import { countOf, setProgress, isSetComplete } from '../systems/collections.js';
import { getAchievementsEngine } from '../systems/achievementsEngine.js';
// V3/G34: sticker-book catalog + engine (both G34-owned — no lazy import needed)
import { STICKERS, TOTAL_BOOK_STICKERS, stickerPages } from '../data/stickers.js';
import { getStickerBook, stickerCounts } from '../systems/stickerBook.js';
import { burstConfettiDom } from '../gfx/particles.js';
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

/* ── V3/G34: top-level album tabs + Stickerbuch (§C5.3 — rem-based) ─────── */
.g34-al-toptabs{width:100%;max-width:440px;display:flex;gap:0.375rem;flex:none;margin-bottom:0.5rem;}
.g34-al-toptab{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:0.3125rem;border:none;border-radius:0.875rem;min-height:max(44px,2.75rem);padding:0.5625rem 0.25rem;font-family:inherit;font-size:0.8125rem;font-weight:800;cursor:pointer;background:rgba(255,255,255,.6);color:var(--brown);box-shadow:var(--shadow-soft);-webkit-tap-highlight-color:transparent;position:relative;}
.g34-al-toptab.g34-active{background:var(--pink);color:#fff;}
.g34-al-toptab .g34-sb-newdot{position:absolute;top:0.375rem;right:0.5rem;}
.g34-sb-pager{width:100%;max-width:440px;flex:none;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;border-radius:1.125rem;}
.g34-sb-pager::-webkit-scrollbar{display:none;}
.g34-sb-page{flex:0 0 100%;min-width:100%;scroll-snap-align:center;scroll-snap-stop:always;background:var(--white);border-radius:1.125rem;box-shadow:var(--shadow-soft);padding:0.875rem;box-sizing:border-box;}
.g34-sb-pagetitle{margin:0 0 0.625rem;font-size:0.8125rem;font-weight:800;color:var(--brown);opacity:.55;text-align:center;}
.g34-sb-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0.625rem;}
.g34-sb-slot{position:relative;display:flex;flex-direction:column;align-items:center;gap:0.25rem;border:none;background:rgba(255,246,236,.75);border-radius:1rem;padding:0.5rem 0.25rem 0.375rem;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;min-height:max(44px,2.75rem);}
.g34-sb-art{width:100%;max-width:7rem;aspect-ratio:1;border-radius:0.75rem;object-fit:contain;display:block;}
.g34-sb-slot.g34-locked .g34-sb-art{filter:grayscale(1) brightness(0.35) opacity(0.45);} /* §C5.3 silhouette — no padlock */
.g34-sb-name{max-width:100%;font-size:0.6875rem;font-weight:800;color:var(--brown);text-align:center;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g34-sb-slot.g34-locked .g34-sb-name{opacity:.4;}
.g34-sb-newdot{background:var(--pink);color:#fff;border-radius:999px;font-size:0.5625rem;font-weight:800;padding:0.125rem 0.375rem;letter-spacing:.04em;}
.g34-sb-slot .g34-sb-newdot{position:absolute;top:0.25rem;right:0.375rem;}
.g34-sb-pop{animation:g34-sb-pop 300ms cubic-bezier(.34,1.56,.64,1);} /* §C5.3 300 ms pop-in */
@keyframes g34-sb-pop{0%{transform:scale(.2);opacity:0;}100%{transform:scale(1);opacity:1;}}
.g34-sb-dots{width:100%;display:flex;justify-content:center;gap:0.125rem;flex:none;margin:0.25rem 0 0.75rem;}
.g34-sb-dot{border:none;background:none;padding:0;width:max(44px,2.75rem);height:max(28px,1.75rem);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.g34-sb-dot::after{content:'';width:0.5rem;height:0.5rem;border-radius:999px;background:rgba(74,59,54,.22);transition:background 150ms ease,transform 150ms ease;}
.g34-sb-dot.g34-active::after{background:var(--pink);transform:scale(1.35);}
.g34-sb-sheet{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(42,26,60,.45);padding:1rem;}
.g34-sb-card{position:relative;width:100%;max-width:20rem;background:var(--white);border-radius:1.375rem;box-shadow:0 12px 40px rgba(42,26,60,.35);padding:1.25rem 1rem 1.125rem;display:flex;flex-direction:column;align-items:center;gap:0.5rem;text-align:center;}
.g34-sb-card-art{width:min(60vw,13rem);aspect-ratio:1;object-fit:contain;}
.g34-sb-card.g34-locked .g34-sb-card-art{filter:grayscale(1) brightness(0.35) opacity(0.45);}
.g34-sb-card-title{margin:0;font-size:1.125rem;font-weight:800;color:var(--brown);}
.g34-sb-card-flavor{margin:0;font-size:0.8125rem;font-weight:700;color:var(--brown);opacity:.7;line-height:1.35;}
.g34-sb-card-hintlabel{margin:0.25rem 0 0;font-size:0.625rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-dark);opacity:.8;}
.g34-sb-close{position:absolute;top:0.375rem;right:0.375rem;border:none;background:rgba(74,59,54,.07);border-radius:999px;width:max(44px,2.75rem);height:max(44px,2.75rem);display:inline-flex;align-items:center;justify-content:center;color:var(--brown);cursor:pointer;-webkit-tap-highlight-color:transparent;}
/* ── end V3/G34 ── */
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
  /** V3/G34: top-level tab ('collections' | 'book') — survives re-renders. */
  let activeTab = 'collections';
  /** V3/G34: current book page (0-based) — survives the 1 Hz re-renders. */
  let bookPage = 0;
  /** Tapped sticker ('<setId>.<entryId>') — survives the store-change
   * re-renders (the time engine ticks 'change' every second). */
  let flavorKey = null;

  function mount(el, params = {}) {
    if (params.set && getCollectionSet(params.set)) activeSet = params.set;
    if (params.tab === 'book' || params.tab === 'collections') activeTab = params.tab;
    flavorKey = null;
    bookPage = 0;

    // V3/G34: per-mount reveal bookkeeping (pop-in once per slot per mount;
    // confetti only on live locked→unlocked transitions while open — §C5.3).
    const poppedIds = new Set();
    let prevUnlocked = null;
    /** @type {HTMLElement|null} open detail sheet (rebuilt on re-render) */
    let sheetEl = null;
    let sheetStickerId = null;

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

    // --- V3/G34: top-level tab strip „Sticker" | „Stickerbuch" (§B5) ---
    const topTabs = document.createElement('div');
    topTabs.className = 'g34-al-toptabs';
    el.appendChild(topTabs);

    const body = document.createElement('div');
    body.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:center;flex:none;';
    el.appendChild(body);

    function closeSheet() {
      sheetEl?.remove();
      sheetEl = null;
      sheetStickerId = null;
    }

    /** §C5.3 detail sheet: large art + title + flavor (locked: hint). */
    function openSheet(def) {
      closeSheet();
      const c = store.get();
      const unlocked = !!c?.stickers?.unlocked?.[def.id];
      const firstView = unlocked && c?.stickers?.seen?.[def.id] !== true;
      sheetStickerId = def.id;
      sheetEl = document.createElement('div');
      sheetEl.className = 'g34-sb-sheet';
      const card = document.createElement('div');
      card.className = `g34-sb-card${unlocked ? '' : ' g34-locked'}`;
      card.innerHTML = `
        <button class="g34-sb-close" aria-label="${t('ui.close')}">${icon('close', 18)}</button>
        <img class="g34-sb-card-art${firstView ? ' g34-sb-pop' : ''}" src="/${def.art}" alt="" draggable="false"/>
        <h2 class="g34-sb-card-title">${unlocked ? t(def.nameKey) : t('stickerbook.unknown')}</h2>
        ${unlocked
          ? `<p class="g34-sb-card-flavor">${t(def.flavorKey)}</p>`
          : `<p class="g34-sb-card-hintlabel">${t('stickerbook.hintLabel')}</p>
             <p class="g34-sb-card-flavor">${t(def.hintKey)}</p>`}`;
      sheetEl.appendChild(card);
      sheetEl.addEventListener('pointerdown', (e) => {
        if (e.target === sheetEl) {
          audio.play('ui.close');
          closeSheet();
        }
      });
      card.querySelector('.g34-sb-close').addEventListener('click', () => {
        audio.play('ui.close');
        closeSheet();
      });
      el.appendChild(sheetEl);
      if (firstView) {
        // §C5.3: confetti on first view + clear the „NEU" dot (seen).
        burstConfettiDom(card);
        const book = getStickerBook();
        if (book) book.markSeen(def.id);
        else store.update((state) => { state.stickers.seen[def.id] = true; });
      }
    }

    // ------------------------------------------------ v2 collections view
    function renderCollections() {
      const c = store.get('collections') ?? { entries: {}, claimedSets: {} };
      const totalOwned = Object.values(c.entries ?? {})
        .filter((n) => Math.floor(Number(n) || 0) >= 1).length;
      const totalAll = COLLECTION_SETS.reduce((s, set) => s + set.entries.length, 0);
      count.textContent = `${totalOwned}/${totalAll}`;

      const tabs = document.createElement('div');
      tabs.className = 'g23-al-tabs';
      body.appendChild(tabs);
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
      const page = document.createElement('div');
      page.className = 'g23-al-page';
      body.appendChild(page);
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

    // ------------------------------------------- V3/G34: Stickerbuch view
    function renderBook() {
      const state = store.get();
      const unlockedMap = state?.stickers?.unlocked ?? {};
      const seenMap = state?.stickers?.seen ?? {};
      const counts = stickerCounts(state);
      count.textContent = `${counts.unlocked}/${TOTAL_BOOK_STICKERS}`; // §C5.3 header n/28

      // Live locked→unlocked transitions while the book is open → confetti.
      const freshIds = new Set();
      if (prevUnlocked) {
        for (const id of Object.keys(unlockedMap)) {
          if (!prevUnlocked.has(id)) freshIds.add(id);
        }
      }
      prevUnlocked = new Set(Object.keys(unlockedMap));

      const pager = document.createElement('div');
      pager.className = 'g34-sb-pager';
      body.appendChild(pager);

      const pages = stickerPages();
      /** @type {HTMLElement[]} */
      const confettiSlots = [];
      pages.forEach((defs, pageIdx) => {
        const page = document.createElement('div');
        page.className = 'g34-sb-page';
        const pt = document.createElement('h2');
        pt.className = 'g34-sb-pagetitle';
        pt.textContent = t('stickerbook.page', { n: pageIdx + 1 }); // „Seite 1–5"
        page.appendChild(pt);
        const grid = document.createElement('div');
        grid.className = 'g34-sb-grid';
        for (const def of defs) {
          const unlocked = !!unlockedMap[def.id];
          const isNew = unlocked && seenMap[def.id] !== true;
          const pop = unlocked && (freshIds.has(def.id) || (isNew && !poppedIds.has(def.id)));
          if (pop) poppedIds.add(def.id);
          const slot = document.createElement('button');
          slot.className = `g34-sb-slot ${unlocked ? 'g34-unlocked' : 'g34-locked'}`;
          slot.innerHTML = `
            <img class="g34-sb-art${pop ? ' g34-sb-pop' : ''}" src="/${def.art}" alt="" loading="lazy" draggable="false"/>
            <span class="g34-sb-name">${unlocked ? t(def.nameKey) : t('stickerbook.unknown')}</span>
            ${isNew ? `<span class="g34-sb-newdot">${t('stickerbook.new')}</span>` : ''}`;
          slot.addEventListener('click', () => {
            audio.play('ui.pick');
            openSheet(def);
            render(); // NEU dot clears once markSeen lands
          });
          if (freshIds.has(def.id)) confettiSlots.push(slot);
          grid.appendChild(slot);
        }
        page.appendChild(grid);
        pager.appendChild(page);
      });

      const dots = document.createElement('div');
      dots.className = 'g34-sb-dots';
      body.appendChild(dots);
      /** Dot-tap smooth scroll in flight (page index) — while set, the scroll
       * listener must NOT downgrade bookPage to intermediate positions, or a
       * mid-flight 1 Hz store re-render pins the book back on the origin page
       * (navigation aborts). Cleared on arrival or on the re-render restore. */
      let scrollTarget = null;
      /** @type {HTMLElement[]} */
      const dotEls = pages.map((_, i) => {
        const dot = document.createElement('button');
        dot.className = `g34-sb-dot${i === bookPage ? ' g34-active' : ''}`;
        dot.setAttribute('aria-label', t('stickerbook.page', { n: i + 1 }));
        dot.addEventListener('click', () => {
          audio.play('ui.tap');
          bookPage = i;
          scrollTarget = i;
          pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
          updateDots();
        });
        dots.appendChild(dot);
        return dot;
      });

      function updateDots() {
        dotEls.forEach((d, i) => d.classList.toggle('g34-active', i === bookPage));
      }

      // Horizontal swipe = native scroll-snap; track the page for the dots
      // and so the 1 Hz store re-renders restore the scroll position.
      pager.addEventListener('scroll', () => {
        const w = pager.clientWidth || 1;
        const p = Math.max(0, Math.min(pages.length - 1, Math.round(pager.scrollLeft / w)));
        if (scrollTarget != null) {
          if (p === scrollTarget) scrollTarget = null; // arrived — resume tracking
          return;
        }
        if (p !== bookPage) {
          bookPage = p;
          updateDots();
        }
      }, { passive: true });
      // Restore the current page instantly (before paint) after a re-render
      // (an instant jump lands exactly on bookPage, so any in-flight dot-tap
      // navigation completes here instead of aborting).
      pager.scrollLeft = bookPage * (pager.clientWidth || 0);
      requestAnimationFrame(() => {
        pager.scrollLeft = bookPage * (pager.clientWidth || 0);
      });

      for (const slot of confettiSlots) burstConfettiDom(slot);
    }

    function render() {
      // Top-level tabs (§B5): re-render keeps the active tab highlighted.
      const state = store.get();
      const counts = stickerCounts(state);
      topTabs.innerHTML = '';
      for (const [tabId, labelKey] of [['collections', 'album.tab.collections'], ['book', 'album.tab.book']]) {
        const tab = document.createElement('button');
        tab.className = `g34-al-toptab${activeTab === tabId ? ' g34-active' : ''}`;
        tab.innerHTML = `${icon(tabId === 'book' ? 'star' : 'cards', 14)}<span>${t(labelKey)}</span>
          ${tabId === 'book' && counts.unseen > 0 ? `<span class="g34-sb-newdot">${counts.unseen}</span>` : ''}`;
        tab.addEventListener('click', () => {
          if (activeTab === tabId) return;
          audio.play('ui.tabSwitch'); // V3/G32 upgrades (sample-backed in wave 1b)
          activeTab = tabId;
          flavorKey = null;
          closeSheet();
          render();
        });
        topTabs.appendChild(tab);
      }

      body.innerHTML = '';
      if (activeTab === 'book') renderBook();
      else renderCollections();

      // Keep an open detail sheet alive across re-renders (fresh strings/state).
      if (sheetStickerId) {
        const def = STICKERS.find((s) => s.id === sheetStickerId);
        if (def) openSheet(def);
      }
    }

    render();
    let lang = getLang();
    const off = store.on('change', () => {
      if (getLang() !== lang) lang = getLang();
      render();
    });
    live = { off, closeSheet };
  }

  function unmount() {
    live?.closeSheet?.();
    live?.off?.();
    live = null;
  }

  ui.registerScreen('album', { mount, unmount });
}
