// Client cosmetics glue (R9) — the catalog itself is the SHARED
// shared/src/cosmetics.js (single source of truth, §10.4); this module just
// re-exports it and adds the client-side helpers the UI screens share:
//   • profile predicates (owned / equipped / level-locked / affordable)
//   • venue resolution + wiring ("host sets the venue": the HOST's equipped
//     table/deco drive engine.applyTableCosmetics + tableView.setVenue)
//   • the injected stylesheet for the R9 shop/preview/rewards widgets
// Purchases/equips are SERVER-AUTHORITATIVE: screens send buyCosmetic /
// equipCosmetic and re-render from the returned `profile` — nothing here
// fakes ownership locally.

export { COSMETICS, SLOTS, SLOT_IDS, getCosmetic, getCosmeticsBySlot } from '@shared/cosmetics.js';

// ---------------------------------------------------------------------------
// Legacy slice-era win counter (pre-1.0). The server profile is the real
// economy now; this stays only because screens.js still bumps it on wins and
// old flavor copy shows it. Do not gate anything on it.
// ---------------------------------------------------------------------------

export const WINS_KEY = 'mb_wins';

/** @returns {number} lifetime match wins recorded on this device (legacy) */
export function getWins() {
  const n = parseInt(localStorage.getItem(WINS_KEY) ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Increment the legacy local win counter (screens.js, on matchEnd victory). */
export function incrementWins() {
  const n = getWins() + 1;
  try {
    localStorage.setItem(WINS_KEY, String(n));
  } catch {
    /* storage blocked — cosmetic progress just won't persist */
  }
  return n;
}

// ---------------------------------------------------------------------------
// Profile predicates — all read the server-merged store.profile (§10.2)
// ---------------------------------------------------------------------------

/** Slot presentation metadata (stable §10.4 slot order). */
export const SLOT_META = Object.freeze({
  hat: { label: 'Hats', glyph: '🎩', blurb: 'Worn on your monkey at the table.' },
  skin: { label: 'Fur Dyes', glyph: '🎨', blurb: 'Re-dyes your fur. The face stays yours.' },
  table: { label: 'Table Designs', glyph: '🃏', blurb: 'The HOST\u2019s design dresses the match table.' },
  deco: { label: 'Bar Decor', glyph: '🪩', blurb: 'The HOST\u2019s decor hangs over the back bar.' },
});

/** @param {Object} profile @param {string} itemId */
export function isOwned(profile, itemId) {
  return !!profile?.unlocked?.includes(itemId);
}

/** @param {Object} profile @param {import('@shared/cosmetics.js').Cosmetic} item */
export function isEquipped(profile, item) {
  return !!item && profile?.equipped?.[item.slot] === item.id;
}

/** @param {Object} profile @param {import('@shared/cosmetics.js').Cosmetic} item */
export function isLevelLocked(profile, item) {
  return (profile?.level ?? 1) < item.minLevel;
}

/** @param {Object} profile @param {import('@shared/cosmetics.js').Cosmetic} item */
export function canAfford(profile, item) {
  return (profile?.coins ?? 0) >= item.price;
}

// ---------------------------------------------------------------------------
// Venue resolution + wiring — "host sets the venue" (§10.3 / R9)
// ---------------------------------------------------------------------------

/**
 * Which table/deco should currently dress the bar:
 *   1. in-match → the HOST seat's SeatPublic.cosmetics (fixed at startGame);
 *      host resolved via roomState.hostId, else first seat carrying venue ids
 *   2. in-lobby → the host member's equipped ids (rebroadcast on every equip)
 *   3. menus    → your own equipped ids (instant feedback while shopping)
 * @returns {{tableId: string|null, decoId: string|null}}
 */
export function resolveVenue(store) {
  const snap = store.get('snapshot');
  const room = store.get('roomState');
  if (snap?.seats?.length && snap.phase !== 'matchEnd') {
    let host = room?.hostId ? snap.seats.find((s) => s.playerId === room.hostId) : null;
    if (!host) host = snap.seats.find((s) => s.cosmetics?.table || s.cosmetics?.deco) ?? null;
    return { tableId: host?.cosmetics?.table ?? null, decoId: host?.cosmetics?.deco ?? null };
  }
  if (room?.members?.length) {
    const host = room.members.find((m) => m.id === room.hostId) ?? room.members.find((m) => m.isHost);
    return { tableId: host?.cosmetics?.table ?? null, decoId: host?.cosmetics?.deco ?? null };
  }
  const equipped = store.get('profile')?.equipped;
  return { tableId: equipped?.table ?? null, decoId: equipped?.deco ?? null };
}

let venueWired = false;

/**
 * Subscribe once to the store and drive the venue renderers on every
 * snapshot / roomState / profile change. Calls BOTH R3 hooks:
 * engine.applyTableCosmetics (records the equipped ids) and
 * engine.tableView.setVenue (renders them). Called from createShopScreen —
 * initUI builds that screen exactly once at boot.
 */
export function wireVenueCosmetics(store, engine) {
  if (venueWired || !engine?.tableView?.setVenue) return;
  venueWired = true;
  // dev/testing handle alongside screens.js's window.__mb (stripped from prod;
  // wireVenueCosmetics runs during initUI, before __mb itself exists)
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__mbEngine = engine;
  const apply = () => {
    const { tableId, decoId } = resolveVenue(store);
    engine.applyTableCosmetics?.(tableId, decoId);
    engine.tableView.setVenue(tableId, decoId);
  };
  store.on('snapshot', apply);
  store.on('roomState', apply);
  store.on('profile', apply);
  apply();
}

// ---------------------------------------------------------------------------
// Injected stylesheet for the R9 widgets (shop states, profile header,
// character-select preview, rewards breakdown). Injected from JS so R9 stays
// inside its owned files; classes are r9-prefixed to avoid collisions.
// ---------------------------------------------------------------------------

const R9_CSS = `
/* ---- profile header block (profileScreen, reused by the shop) ---- */
.r9-profile-header {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  background: rgba(20, 34, 17, 0.55); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 10px 14px; margin: 0 0 14px;
}
.r9-level-badge {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-width: 54px; height: 54px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffe27a, var(--banana) 55%, var(--banana-deep));
  color: #241a04; font-weight: 900; box-shadow: var(--glow-banana);
}
.r9-level-badge .lv { font-size: 9px; letter-spacing: 1px; }
.r9-level-badge .num { font-size: 20px; line-height: 1; }
.r9-ph-mid { flex: 1; min-width: 140px; }
.r9-ph-name { font-weight: 800; font-size: 14px; letter-spacing: 0.4px; }
.r9-xpbar { position: relative; height: 8px; border-radius: 999px; background: rgba(0,0,0,0.5);
  border: 1px solid var(--line); margin-top: 6px; overflow: hidden; }
.r9-xpbar .fill { position: absolute; inset: 0; width: 0%;
  background: linear-gradient(90deg, var(--neon-green), var(--neon-cyan));
  transition: width 0.4s ease; }
.r9-ph-xp { font-size: 10px; color: var(--ink-dim); margin-top: 3px; letter-spacing: 0.5px; }
.r9-ph-stats { display: flex; gap: 14px; align-items: center; }
.r9-coin-pill {
  display: flex; align-items: center; gap: 6px; font-weight: 900; font-size: 16px;
  color: var(--banana); background: rgba(255, 210, 61, 0.08);
  border: 1px solid rgba(255, 210, 61, 0.45); border-radius: 999px; padding: 7px 14px;
  text-shadow: 0 0 12px rgba(255, 210, 61, 0.5);
}
.r9-ph-winline { font-size: 11px; color: var(--ink-dim); text-align: right; line-height: 1.5; }

/* ---- shop item states ---- */
.r9-slot-head { display: flex; align-items: baseline; gap: 10px; margin: 20px 0 10px; }
.r9-slot-head:first-of-type { margin-top: 6px; }
.r9-slot-head h3 { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: 1.6px;
  text-transform: uppercase; color: var(--neon-pink); text-shadow: var(--glow-pink); }
.r9-slot-head .blurb { font-size: 10.5px; color: var(--ink-faint); }
.shop-item .r9-tags { display: flex; gap: 6px; position: absolute; top: 10px; left: 10px; }
.shop-item .r9-price {
  font-size: 10px; font-weight: 900; letter-spacing: 0.6px; border-radius: 6px; padding: 3px 7px;
  background: rgba(255, 210, 61, 0.12); border: 1px solid rgba(255, 210, 61, 0.5); color: var(--banana);
}
.shop-item .r9-lvl {
  font-size: 10px; font-weight: 900; letter-spacing: 0.6px; border-radius: 6px; padding: 3px 7px;
  background: rgba(53, 232, 208, 0.1); border: 1px solid rgba(53, 232, 208, 0.45); color: var(--neon-cyan);
}
.shop-item .r9-actions { margin-top: auto; width: 100%; }
.shop-item .r9-actions .btn { width: 100%; padding: 9px 10px; font-size: 12px; border-radius: 10px; }
.shop-item.r9-equipped { border-color: var(--neon-green); box-shadow: var(--glow-green); }
.shop-item.r9-insufficient .r9-price { color: var(--danger); border-color: rgba(255, 77, 94, 0.55);
  background: rgba(255, 77, 94, 0.1); }
.r9-buy-broke { filter: saturate(0.5); opacity: 0.75; }

/* ---- character select: preview + equip controls ---- */
.r9-charsel-row { display: flex; gap: 16px; align-items: stretch; }
.r9-charsel-row .r9-grid-col { flex: 1 1 auto; min-width: 0; }
.r9-preview-col {
  flex: 0 0 250px; display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--line); border-radius: var(--radius);
  background: rgba(10, 18, 8, 0.6); padding: 12px;
}
.r9-preview-col canvas.r9-preview { width: 100%; height: 240px; border-radius: var(--radius-sm);
  background: radial-gradient(140px 160px at 50% 42%, rgba(57, 255, 136, 0.12), rgba(6, 10, 5, 0.2) 70%); }
.r9-preview-title { font-size: 11px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--ink-dim); text-align: center; }
.r9-equip-rows { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 30vh; }
.r9-equip-row .r9-er-label { font-size: 10px; font-weight: 800; letter-spacing: 1.2px;
  text-transform: uppercase; color: var(--ink-faint); margin-bottom: 4px; }
.r9-equip-row .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.r9-equip-chip {
  appearance: none; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  font-size: 11px; font-weight: 700; color: var(--ink); border: 1px solid var(--line);
  border-radius: 999px; padding: 5px 10px; background: rgba(20, 34, 17, 0.55);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
}
.r9-equip-chip:hover { border-color: var(--line-strong); transform: translateY(-1px); }
.r9-equip-chip.on { border-color: var(--banana); color: var(--banana); box-shadow: var(--glow-banana); }
.r9-equip-none { font-size: 10.5px; color: var(--ink-faint); font-style: italic; }

/* ---- results: rewards breakdown ---- */
.r9-rewards {
  width: 100%; max-width: 380px; margin: 14px auto 0; text-align: left;
  border: 1px solid rgba(255, 210, 61, 0.35); border-radius: var(--radius-sm);
  background: rgba(30, 22, 6, 0.55); padding: 12px 16px;
}
.r9-rewards .r9-rw-title { font-size: 11px; font-weight: 900; letter-spacing: 2px;
  text-transform: uppercase; color: var(--banana); margin-bottom: 8px; }
.r9-rw-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px;
  padding: 3px 0; color: var(--ink-dim); }
.r9-rw-row .amounts { color: var(--ink); font-weight: 700; white-space: nowrap; }
.r9-rw-total { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px;
  padding-top: 8px; border-top: 1px dashed rgba(255, 210, 61, 0.35);
  font-weight: 900; font-size: 15px; color: var(--banana); }
.r9-rw-total .xp { color: var(--neon-cyan); font-size: 12px; font-weight: 800; align-self: center; }
.r9-levelup {
  margin: 12px auto 0; width: fit-content; padding: 10px 26px; border-radius: 999px;
  font-weight: 900; font-size: 18px; letter-spacing: 2.5px; text-transform: uppercase;
  color: #241a04; background: linear-gradient(180deg, #ffe27a, var(--banana) 55%, var(--banana-deep));
  box-shadow: var(--glow-banana), 0 6px 0 #8a5e08;
  animation: r9-levelup-pop 0.7s cubic-bezier(0.2, 1.6, 0.4, 1) both,
             r9-levelup-glow 1.4s ease-in-out 0.7s infinite alternate;
}
@keyframes r9-levelup-pop { 0% { transform: scale(0.2) rotate(-6deg); opacity: 0; }
  100% { transform: scale(1) rotate(0); opacity: 1; } }
@keyframes r9-levelup-glow { from { box-shadow: var(--glow-banana), 0 6px 0 #8a5e08; }
  to { box-shadow: 0 0 34px rgba(255, 210, 61, 0.8), 0 6px 0 #8a5e08; } }

/* ---- profile screen extras ---- */
.r9-mode-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px; margin-top: 10px; }
.r9-mode-stat { border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: rgba(20, 34, 17, 0.45); padding: 8px 10px; font-size: 11px; color: var(--ink-dim); }
.r9-mode-stat b { display: block; color: var(--ink); font-size: 12px; margin-bottom: 2px; }
`;

let stylesInjected = false;

/** Inject the R9 widget styles once (idempotent). */
export function injectCosmeticsStyles() {
  if (stylesInjected || document.getElementById('r9-cosmetics-css')) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'r9-cosmetics-css';
  style.textContent = R9_CSS;
  document.head.appendChild(style);
}
