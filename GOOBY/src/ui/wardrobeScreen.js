// Wardrobe screen (§C5.3, agent G12) — outfit categories (hat/glasses/neck),
// a live 3D try-on preview (an inset viewport with its own renderer + Gooby on
// a small pastel stage, so it works both at home AND over a shop-trip scene),
// equip/unequip of owned items anytime, and buy mode (`{mode:'buy'}` param)
// used by the shop's Outfits tab during shop trips (§C4: outfits always
// require the drive). Registered early at boot (marked G12 block in main.js)
// so G11's shop tab can feature-detect it via ui.hasScreen('wardrobe').
//
// Entry points: HUD wardrobe button, bedroom wardrobe closet tap
// (roomManager 'tap:wardrobe' — wired here via the same polled module-accessor
// pattern as the G6/G7 hooks), harness ?open=wardrobe, shop Outfits tab (buy).

import * as THREE from 'three';
import { OUTFIT_SLOTS, OUTFITS, OUTFITS_BY_ID, outfitsForSlot } from '../data/outfits.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';
import { createGooby } from '../character/gooby.js';
import { applyOutfits, buildOutfitItem } from '../character/outfitAttach.js';

const PREVIEW_H = 280;
const THUMB_SIZE = 108;

const WARDROBE_CSS = `
.screen-wardrobe{justify-content:flex-start;overflow:hidden;}
/* F6 (RE4): the header (back/title/coins) stays pinned — only the catalog
   body scrolls, so the back button is always reachable after a deep scroll. */
.g12-wr-body{flex:1;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g12-wr-head{width:100%;max-width:440px;display:flex;align-items:center;gap:10px;margin:6px 0 10px;flex:none;}
/* F3: the title shrinks/ellipsizes at narrow widths — never the coins pill */
.g12-wr-title{flex:1;min-width:0;margin:0;font-size:clamp(21px,7.5vw,30px);font-weight:800;color:var(--brown);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.g12-wr-coins{flex:none;display:inline-flex;align-items:center;gap:6px;background:var(--white);border-radius:999px;padding:8px 14px;font-size:16px;font-weight:800;color:var(--brown);box-shadow:var(--shadow-soft);}
.g12-wr-coins svg{color:var(--yellow);}
.g12-wr-stage{position:relative;width:100%;max-width:440px;height:${PREVIEW_H}px;border-radius:24px;overflow:hidden;background:linear-gradient(#DFF3F0,#FFF6EC);box-shadow:var(--shadow-soft);flex:none;}
.g12-wr-stage canvas{display:block;width:100%;height:100%;}
.g12-wr-tryon{position:absolute;top:10px;left:12px;background:rgba(255,255,255,.9);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:800;color:var(--pink-dark);box-shadow:var(--shadow-soft);}
.g12-wr-tabs{width:100%;max-width:440px;display:flex;gap:6px;margin:12px 0 10px;flex:none;}
.g12-wr-tab{flex:1;min-width:0;border:none;border-radius:16px;background:rgba(255,255,255,.75);border-bottom:4px solid rgba(74,59,54,.12);color:var(--brown);font-family:inherit;font-size:clamp(12px,3.9vw,14px);font-weight:800;min-height:46px;padding:4px 2px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.g12-wr-tab.g12-on{background:var(--pink);border-bottom-color:var(--pink-dark);color:#fff;}
.g12-wr-grid{width:100%;max-width:440px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding-bottom:18px;flex:none;}
.g12-wr-item{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;border:3px solid transparent;border-radius:18px;background:var(--white);box-shadow:var(--shadow-soft);font-family:inherit;color:var(--brown);cursor:pointer;padding:8px 4px 10px;-webkit-tap-highlight-color:transparent;transition:transform 90ms ease;}
.g12-wr-item:active{transform:scale(.95);}
.g12-wr-item.g12-equipped{border-color:var(--pink);}
.g12-wr-item.g12-tryon{border-color:var(--teal);}
.g12-wr-item img{width:${THUMB_SIZE / 2}px;height:${THUMB_SIZE / 2}px;border-radius:12px;background:#FDF3E7;}
.g12-wr-item-name{font-size:11.5px;font-weight:800;line-height:1.15;text-align:center;max-width:100%;max-height:27px;overflow:hidden;overflow-wrap:anywhere;}
.g12-wr-item-sub{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:800;opacity:.75;min-height:16px;}
.g12-wr-item-sub svg{color:var(--yellow);}
.g12-wr-item-sub.g12-sub-equipped{color:var(--pink-dark);opacity:1;}
.g12-wr-item-sub.g12-sub-owned{color:var(--teal-dark);opacity:1;}
.g12-wr-buy{margin-top:2px;min-height:44px;padding:4px 14px;font-size:13px;border-radius:12px;} /* F3: ≥44px touch target */
.g12-wr-hint{width:100%;max-width:440px;text-align:center;font-size:12.5px;font-weight:700;opacity:.55;padding-bottom:14px;}
`;

/** @type {Map<string, string>} outfit id → rendered thumbnail dataURL (session cache) */
const thumbCache = new Map();

/** Render 3D thumbnails for every catalog item once per session (Kenney-free,
 * pure primitives — the same builders the rig wears). */
function ensureThumbs() {
  if (thumbCache.size >= OUTFITS.length) return;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (err) {
    console.warn('[wardrobe] thumbnail renderer unavailable:', err);
    return;
  }
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight('#fff5e8', '#b8a898', 1.1);
  const dir = new THREE.DirectionalLight('#fff2dd', 1.6);
  dir.position.set(1.5, 2, 2.5);
  scene.add(hemi, dir);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  for (const def of OUTFITS) {
    if (thumbCache.has(def.id)) continue;
    const item = buildOutfitItem(def.id);
    if (!item) continue;
    item.position.set(0, 0, 0);
    item.rotation.set(0, 0, 0);
    scene.add(item);
    box.setFromObject(item);
    box.getCenter(center);
    box.getSize(size);
    const dist = (Math.max(size.x, size.y, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.35;
    camera.position.set(center.x + dist * 0.28, center.y + dist * 0.3, center.z + dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
    try {
      thumbCache.set(def.id, renderer.domElement.toDataURL('image/png'));
    } catch {
      /* toDataURL can fail on odd contexts — cards fall back to no image */
    }
    scene.remove(item);
    item.traverse((obj) => obj.geometry?.dispose?.());
  }
  renderer.dispose();
}

/**
 * Create + register the wardrobe screen and wire its entry points.
 * @param {{store: object, ui: object, audio: object}} deps
 */
export function registerWardrobe({ store, ui, audio }) {
  if (!document.querySelector('style[data-owner="g12-wardrobe"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g12-wardrobe';
    style.textContent = WARDROBE_CSS;
    document.head.appendChild(style);
  }

  /** Live-mount state (screen is a singleton — one mount at a time, §E6). */
  let live = null;

  function mount(el, params = {}) {
    const buyMode = params.mode === 'buy';
    let tab = OUTFIT_SLOTS.includes(params.slot) ? params.slot : 'hat';
    /** @type {{slot: string, id: string}|null} try-on of a NOT-owned item */
    let tryOn = null;

    // ---------- header ----------
    const head = document.createElement('div');
    head.className = 'g12-wr-head';
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost btn-round';
    backBtn.setAttribute('aria-label', t('ui.back'));
    backBtn.innerHTML = icon('arrowLeft', 22);
    backBtn.addEventListener('click', () => {
      audio.play('ui.close');
      // F3: context-aware back (§C4) — when opened from the shop (Outfits
      // tab, trip OR browse), return to the shop screen instead of dumping
      // the player into the bare 3D scene. Normal entries keep closeAll().
      if (typeof params.onBack === 'function') params.onBack();
      else ui.closeAll();
    });
    const title = document.createElement('h1');
    title.className = 'g12-wr-title';
    title.textContent = t('wardrobe.title');
    head.append(backBtn, title);
    const coinsEl = document.createElement('div');
    coinsEl.className = 'g12-wr-coins';
    head.appendChild(coinsEl);
    el.appendChild(head);

    // F6 (RE4): everything below the header scrolls inside this body — the
    // header itself (back button, title, coins) stays pinned to the screen.
    const body = document.createElement('div');
    body.className = 'g12-wr-body';
    el.appendChild(body);

    // ---------- live 3D try-on stage (own inset viewport — §G G12) ----------
    const stage = document.createElement('div');
    stage.className = 'g12-wr-stage';
    body.appendChild(stage);
    const tryOnBadge = document.createElement('div');
    tryOnBadge.className = 'g12-wr-tryon';
    tryOnBadge.style.display = 'none';
    stage.appendChild(tryOnBadge);

    /** @type {THREE.WebGLRenderer|null} */
    let renderer = null;
    let gooby = null;
    let raf = 0;
    const scene = new THREE.Scene();
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      const hemi = new THREE.HemisphereLight('#fff5e8', '#b8a898', 1.05);
      const dir = new THREE.DirectionalLight('#fff2dd', 1.4);
      dir.position.set(1.6, 2.4, 2.2);
      scene.add(hemi, dir);
      gooby = createGooby();
      gooby.setEmotion('happy');
      scene.add(gooby.group);
      stage.insertBefore(renderer.domElement, tryOnBadge);
      const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
      camera.position.set(0, 0.78, 1.95);
      camera.lookAt(0, 0.52, 0);
      const resize = () => {
        const w = stage.clientWidth || 320;
        const h = stage.clientHeight || PREVIEW_H;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      let last = performance.now();
      const tick = (now) => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        gooby.update(dt);
        gooby.group.rotation.y = Math.sin(now / 2400) * 0.5; // gentle sway
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(tick);
      window.addEventListener('resize', resize);
      live = { renderer, gooby, resize };
    } catch (err) {
      console.warn('[wardrobe] preview renderer unavailable:', err);
      live = { renderer: null, gooby: null, resize: null };
    }

    // ---------- tabs + grid ----------
    const tabs = document.createElement('div');
    tabs.className = 'g12-wr-tabs';
    body.appendChild(tabs);
    const grid = document.createElement('div');
    grid.className = 'g12-wr-grid';
    body.appendChild(grid);
    const hint = document.createElement('div');
    hint.className = 'g12-wr-hint';
    hint.textContent = buyMode ? t('wardrobe.buyHint') : t('wardrobe.equipHint');
    body.appendChild(hint);

    ensureThumbs();

    const equipped = () => store.get('outfits.equipped') ?? {};
    const owned = () => store.get('outfits.owned') ?? [];

    /** The preview wears equipped + any active try-on override. */
    function refreshPreview() {
      if (!live?.gooby) return;
      const wear = { ...equipped() };
      if (tryOn) wear[tryOn.slot] = tryOn.id;
      applyOutfits(live.gooby, wear);
      if (tryOn) {
        tryOnBadge.style.display = '';
        tryOnBadge.textContent = t('wardrobe.tryOn', { name: t(OUTFITS_BY_ID[tryOn.id].nameKey) });
      } else {
        tryOnBadge.style.display = 'none';
      }
    }

    function renderTabs() {
      tabs.innerHTML = '';
      for (const slot of OUTFIT_SLOTS) {
        const b = document.createElement('button');
        b.className = `g12-wr-tab${slot === tab ? ' g12-on' : ''}`;
        b.textContent = t(`wardrobe.slot.${slot}`);
        b.addEventListener('click', () => {
          audio.play('ui.tap');
          tab = slot;
          tryOn = null;
          renderTabs();
          renderGrid();
          refreshPreview();
        });
        tabs.appendChild(b);
      }
    }

    function buy(def) {
      const coins = store.get('coins') ?? 0;
      if (coins < def.price) {
        ui.toast('toast.notEnoughCoins');
        audio.play('ui.error');
        return;
      }
      // G11's economy.spend may take over this path once merged; direct spend
      // keeps the wave-4 wardrobe self-contained (atomic single update).
      store.update((state) => {
        state.coins -= def.price;
        if (!state.outfits.owned.includes(def.id)) state.outfits.owned.push(def.id);
        state.outfits.equipped[def.slot] = def.id; // new outfits go straight on
      });
      tryOn = null;
      audio.play('coin.spend');
      audio.play('jingle.outfit');
      ui.toast('toast.outfitBought', { name: t(def.nameKey) });
      renderAll();
    }

    function onItemTap(def) {
      audio.play('ui.tap');
      const isOwned = owned().includes(def.id);
      if (isOwned) {
        tryOn = null;
        store.update((state) => {
          const cur = state.outfits.equipped[def.slot];
          state.outfits.equipped[def.slot] = cur === def.id ? null : def.id; // tap again = take off
        });
        renderAll();
        return;
      }
      // not owned: try it on in the preview; buying needs the shop trip (§C4)
      tryOn = tryOn?.id === def.id ? null : { slot: def.slot, id: def.id };
      if (!buyMode && tryOn) ui.toast('wardrobe.shopOnly');
      renderAll();
    }

    function renderGrid() {
      grid.innerHTML = '';
      for (const def of outfitsForSlot(tab)) {
        const isOwned = owned().includes(def.id);
        const isEquipped = equipped()[def.slot] === def.id;
        const card = document.createElement('button');
        card.className = 'g12-wr-item';
        if (isEquipped) card.classList.add('g12-equipped');
        else if (tryOn?.id === def.id) card.classList.add('g12-tryon');
        const thumb = thumbCache.get(def.id);
        const sub = isEquipped
          ? `<span class="g12-wr-item-sub g12-sub-equipped">${t('wardrobe.equipped')}</span>`
          : isOwned
            ? `<span class="g12-wr-item-sub g12-sub-owned">${t('wardrobe.owned')}</span>`
            : `<span class="g12-wr-item-sub">${icon('coin', 13)}${def.price}</span>`;
        card.innerHTML = `
          ${thumb ? `<img src="${thumb}" alt="">` : ''}
          <span class="g12-wr-item-name">${t(def.nameKey)}</span>
          ${sub}`;
        card.addEventListener('click', () => onItemTap(def));
        if (buyMode && !isOwned) {
          const buyBtn = document.createElement('span');
          buyBtn.className = 'btn btn-teal g12-wr-buy';
          buyBtn.textContent = t('wardrobe.buy');
          buyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            buy(def);
          });
          card.appendChild(buyBtn);
        }
        grid.appendChild(card);
      }
    }

    function renderAll() {
      coinsEl.innerHTML = `${icon('coin', 16)}<span>${store.get('coins') ?? 0}</span>`;
      renderTabs();
      renderGrid();
      refreshPreview();
    }

    const offCoins = store.on('coinsChanged', () => {
      coinsEl.innerHTML = `${icon('coin', 16)}<span>${store.get('coins') ?? 0}</span>`;
    });

    renderAll();
    live.offCoins = offCoins;
    live.rafStop = () => cancelAnimationFrame(raf);
  }

  function unmount() {
    if (!live) return;
    live.rafStop?.();
    live.offCoins?.();
    if (live.resize) window.removeEventListener('resize', live.resize);
    if (live.gooby) {
      applyOutfits(live.gooby, {}); // dispose attached outfit geometries
      live.gooby.dispose();
    }
    live.renderer?.dispose();
    live = null;
  }

  ui.registerScreen('wardrobe', { mount, unmount });

  // Bedroom wardrobe closet (G4: roomManager 'tap:wardrobe') — the room
  // manager is rebuilt per home enter, so poll the module accessor and
  // re-subscribe on new instances (same pattern as the G6/G7 hooks).
  let lastRm = null;
  setInterval(async () => {
    try {
      const mod = await import('../home/homeScene.js');
      const rm = mod.getRoomManager?.();
      if (rm && rm !== lastRm && typeof rm.on === 'function') {
        lastRm = rm;
        rm.on('tap:wardrobe', () => {
          audio.play('ui.open');
          ui.showScreen('wardrobe');
        });
      }
    } catch {
      /* home scene not present yet */
    }
  }, 1000);
}
