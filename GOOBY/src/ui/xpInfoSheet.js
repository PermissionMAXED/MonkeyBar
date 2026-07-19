// V4/G69 — XP transparency info sheet (PLAN4 §C-SYS3.2–3.3).
// Panel id `xpInfo`: live progress, all 12 XP grant sources from their real
// constants, daily-cap counters, next unlock, recap milestone and XP stats.

import { XP, LEVELING, QUEST_POOL, PHOTO } from '../data/constants.js';
import { NOUGAT } from '../systems/nougat.logic.js';
import { localDay } from '../core/clock.js';
import { xpToNext, nextUnlock } from '../systems/leveling.js';
import { t, getLang } from '../data/strings.js';

const SOURCE_IDS = Object.freeze([
  'minigame', 'quest', 'feed', 'wash', 'sleep', 'pet',
  'harvest', 'delivery', 'photo', 'sticker', 'collection', 'nougat',
]);

/** @type {Map<string, number>} */
let sessionXp = new Map();
let recentGrant = null;
let trackedStore = null;
let stopTracking = null;

const CSS = `
.panel-xpInfo{max-height:min(46rem,94dvh);overflow:hidden;}
.g69-xp{display:flex;flex-direction:column;gap:.5625rem;max-height:calc(94dvh - 1.25rem);color:var(--brown);}
.g69-xp-head{display:flex;align-items:center;gap:.5rem;flex:none;}
.g69-xp-title{flex:1;min-width:0;margin:0;font-size:1.25rem;font-weight:900;line-height:1.1;}
.g69-xp-close{flex:none;width:max(44px,2.75rem);height:max(44px,2.75rem);padding:0;border:0;border-radius:50%;background:rgba(74,59,54,.07);color:var(--brown);font:900 1.25rem/1 system-ui;cursor:pointer;}
.g69-xp-intro{margin:0;font-size:.75rem;font-weight:700;opacity:.72;line-height:1.3;}
.g69-xp-progress{padding:.625rem .75rem;border-radius:.875rem;background:var(--bg-cream);flex:none;}
.g69-xp-progressline{display:flex;justify-content:space-between;gap:.5rem;font-size:.75rem;font-weight:900;font-variant-numeric:tabular-nums;}
.g69-xp-track{height:.625rem;margin-top:.375rem;border-radius:999px;background:rgba(74,59,54,.12);overflow:hidden;}
.g69-xp-fill{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--teal),var(--pink));}
.g69-xp-callouts{display:grid;grid-template-columns:1fr 1fr;gap:.375rem;flex:none;}
.g69-xp-callout{min-width:0;padding:.4375rem .5rem;border-radius:.75rem;background:rgba(89,201,185,.12);font-size:.6875rem;font-weight:800;line-height:1.25;overflow-wrap:anywhere;}
.g69-xp-callout:last-child{background:rgba(255,123,169,.11);}
.g69-xp-list{min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:.75rem;border:1px solid rgba(74,59,54,.1);}
.g69-xp-row{display:flex;align-items:center;gap:.5rem;min-height:1.875rem;padding:.3125rem .5rem;font-size:.6875rem;}
.g69-xp-row:nth-child(odd){background:rgba(74,59,54,.035);}
.g69-xp-source{flex:1;min-width:0;font-weight:800;line-height:1.2;overflow-wrap:anywhere;}
.g69-xp-amount{flex:none;text-align:right;font-weight:900;color:var(--teal-dark);font-variant-numeric:tabular-nums;white-space:nowrap;}
.g69-xp-cap{display:block;color:var(--brown);font-size:.5625rem;opacity:.65;font-weight:800;}
.g69-xp-foot{display:flex;flex-direction:column;gap:.1875rem;flex:none;font-size:.625rem;font-weight:700;line-height:1.25;opacity:.72;}
@media (max-width:340px){.g69-xp{gap:.4375rem}.g69-xp-callouts{grid-template-columns:1fr}.g69-xp-title{font-size:1.0625rem}.g69-xp-row{padding:.25rem .375rem}}
`;

function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-owner="v4-g69-xp"]')) return;
  const style = document.createElement('style');
  style.dataset.owner = 'v4-g69-xp';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const nonNegativeInt = (value) => Math.max(0, Math.floor(Number(value) || 0));

/**
 * Pure sheet-data assembly. Every amount is read from the actual grant-site
 * constant/module; there is no second numeric XP table in this UI.
 * @param {object} state full store state
 * @param {string} [today] local YYYY-MM-DD (injectable for tests)
 */
export function buildXpInfoData(state, today = localDay()) {
  const level = Math.max(1, Math.min(LEVELING.MAX_LEVEL, nonNegativeInt(state?.level) || 1));
  const xp = level >= LEVELING.MAX_LEVEL ? 0 : nonNegativeInt(state?.xp);
  const target = level >= LEVELING.MAX_LEVEL ? 0 : xpToNext(level);
  const counters = state?.achievements?.counters ?? {};
  const petsToday = counters.petsDay === today ? nonNegativeInt(counters.petsToday) : 0;
  const photoXpToday = counters.photoXpDay === today ? nonNegativeInt(counters.photoXpToday) : 0;
  const questXp = QUEST_POOL.map((quest) => quest.xp);
  const recapLevel = level >= LEVELING.MAX_LEVEL
    ? null
    : Math.min(LEVELING.MAX_LEVEL, (Math.floor(level / 5) + 1) * 5);

  return {
    level,
    xp,
    xpToNext: target,
    progress: target > 0 ? Math.min(1, xp / target) : 1,
    nextUnlock: nextUnlock(level),
    recapLevel,
    sources: [
      { id: 'minigame', min: XP.MINIGAME_BASE, max: XP.MINIGAME_BASE + XP.MINIGAME_BONUS_CAP },
      { id: 'quest', min: Math.min(...questXp), max: Math.max(...questXp) },
      { id: 'feed', amount: XP.FEED },
      { id: 'wash', amount: XP.FULL_WASH },
      { id: 'sleep', amount: XP.COMPLETED_SLEEP },
      { id: 'pet', amount: XP.PET, used: Math.min(petsToday, XP.PET_DAILY_CAP), cap: XP.PET_DAILY_CAP },
      { id: 'harvest', amount: LEVELING.XP_HARVEST },
      { id: 'delivery', amount: LEVELING.XP_DELIVERY },
      { id: 'photo', amount: PHOTO.XP_PER_PHOTO, used: Math.min(photoXpToday, PHOTO.XP_DAILY_CAP), cap: PHOTO.XP_DAILY_CAP },
      { id: 'sticker', amount: LEVELING.XP_STICKER },
      { id: 'collection', amount: LEVELING.XP_SET_COMPLETE },
      { id: 'nougat', amount: NOUGAT.XP },
    ],
    levelCoinsMultiplier: XP.LEVEL_UP_COINS_PER_LEVEL,
  };
}

/**
 * Exact lifetime XP totals available from persisted counters. Variable quest
 * and minigame awards plus capped pet/photo grants are deliberately omitted:
 * their historical XP cannot be reconstructed honestly from the save.
 */
export function knownLifetimeXpSources(state) {
  const counters = state?.achievements?.counters ?? {};
  const uniqueStickers = Object.values(state?.collections?.entries ?? {})
    .filter((count) => nonNegativeInt(count) > 0).length;
  const completedSets = Object.values(state?.collections?.claimedSets ?? {})
    .filter(Boolean).length;
  const rows = [
    ['feed', nonNegativeInt(counters.feeds) * XP.FEED],
    ['wash', nonNegativeInt(counters.washes) * XP.FULL_WASH],
    ['sleep', nonNegativeInt(counters.sleeps) * XP.COMPLETED_SLEEP],
    ['harvest', nonNegativeInt(counters.harvests) * LEVELING.XP_HARVEST],
    ['delivery', nonNegativeInt(counters.deliveries) * LEVELING.XP_DELIVERY],
    ['sticker', uniqueStickers * LEVELING.XP_STICKER],
    ['collection', completedSets * LEVELING.XP_SET_COMPLETE],
    ['nougat', nonNegativeInt(counters.nougatGlobs) * NOUGAT.XP],
  ];
  return rows
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount || SOURCE_IDS.indexOf(a.id) - SOURCE_IDS.indexOf(b.id));
}

/** Begin session-only source totals and recent-source tracking. */
export function trackXpSources(store) {
  if (trackedStore === store && stopTracking) return stopTracking;
  stopTracking?.();
  trackedStore = store;
  sessionXp = new Map();
  recentGrant = null;
  const off = store.on('xpGranted', (payload) => {
    const id = String(payload?.source ?? '');
    const amount = nonNegativeInt(payload?.amount);
    if (!SOURCE_IDS.includes(id) || amount <= 0) return;
    sessionXp.set(id, (sessionXp.get(id) ?? 0) + amount);
    recentGrant = { id, at: Date.now() };
  });
  stopTracking = () => {
    off?.();
    if (trackedStore === store) {
      trackedStore = null;
      stopTracking = null;
    }
  };
  return stopTracking;
}

export function sessionXpSources() {
  return [...sessionXp.entries()]
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount || SOURCE_IDS.indexOf(a.id) - SOURCE_IDS.indexOf(b.id));
}

/** Consume the source of a just-fired XP grant for the coalesced levelUp toast. */
export function consumeRecentXpSource(maxAgeMs = 1500) {
  const grant = recentGrant;
  recentGrant = null;
  return grant && Date.now() - grant.at <= maxAgeMs ? grant.id : null;
}

/** @param {{store: object, ui: object, audio?: object}} deps */
export function registerXpInfoSheet({ store, ui, audio }) {
  trackXpSources(store);
  let off = null;

  ui.registerPanel('xpInfo', {
    mount(el) {
      ensureStyles();
      let signature = '';

      const render = () => {
        const data = buildXpInfoData(store.get());
        const nextName = data.nextUnlock ? t(data.nextUnlock.nameKey) : t('unlock.all');
        const nextText = data.nextUnlock
          ? t('xp.next.value', { level: data.nextUnlock.level, name: nextName })
          : nextName;
        const currentSignature = JSON.stringify([
          getLang(), data.level, data.xp,
          ...data.sources.flatMap((row) => [row.used, row.cap]),
          data.nextUnlock?.level, data.nextUnlock?.nameKey,
        ]);
        if (currentSignature === signature) return;
        signature = currentSignature;
        const scroll = el.querySelector('.g69-xp-list')?.scrollTop ?? 0;

        el.innerHTML = `
          <div class="g69-xp">
            <div class="g69-xp-head">
              <h2 class="g69-xp-title">${t('xp.title')}</h2>
              <button class="g69-xp-close" aria-label="${t('ui.close')}">×</button>
            </div>
            <p class="g69-xp-intro">${t('xp.intro')}</p>
            <div class="g69-xp-progress">
              <div class="g69-xp-progressline">
                <span>${t('xp.level', { level: data.level })}</span>
                <span>${data.xpToNext > 0
                  ? t('xp.progress', { xp: data.xp, next: data.xpToNext })
                  : t('xp.maxLevel')}</span>
              </div>
              <div class="g69-xp-track" role="progressbar" aria-valuemin="0"
                aria-valuemax="${data.xpToNext}" aria-valuenow="${data.xp}">
                <span class="g69-xp-fill" style="width:${Math.round(data.progress * 100)}%"></span>
              </div>
            </div>
            <div class="g69-xp-callouts">
              <div class="g69-xp-callout">${t('xp.next.label')}<br>${nextText}</div>
              <div class="g69-xp-callout">${data.recapLevel == null
                ? t('xp.recap.done')
                : t('xp.recap.hint', { level: data.recapLevel })}</div>
            </div>
            <div class="g69-xp-list" role="table" aria-label="${t('xp.table.label')}">
              ${data.sources.map((row) => `
                <div class="g69-xp-row" role="row" data-xp-source="${row.id}">
                  <span class="g69-xp-source" role="cell">${t(`xp.source.${row.id}`)}</span>
                  <span class="g69-xp-amount" role="cell">+${row.amount ?? `${row.min}–${row.max}`} XP
                    ${row.cap == null ? '' : `<span class="g69-xp-cap">${t('xp.today', { used: row.used, cap: row.cap })}</span>`}
                  </span>
                </div>`).join('')}
            </div>
            <div class="g69-xp-foot">
              <span>${t('xp.levelReward', { n: data.levelCoinsMultiplier })}</span>
              <span>${t('xp.bookNote')}</span>
            </div>
          </div>`;

        const list = el.querySelector('.g69-xp-list');
        if (list) list.scrollTop = scroll;
        el.querySelector('.g69-xp-close')?.addEventListener('click', () => {
          audio?.play?.('ui.close');
          ui.closePanel('xpInfo');
        });
      };

      render();
      off = store.on('change', render);
    },
    unmount() {
      off?.();
      off = null;
    },
  });
}
