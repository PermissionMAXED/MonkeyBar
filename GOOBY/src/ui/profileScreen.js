// Profile / lifetime-stats screen (PLAN2 §C12.1, agent V2/G23) — ui screen
// 'profile', opened by the HUD avatar button (L1). Single scroll, §C12.1
// sections top-to-bottom: ① header (portrait snap via sceneManager
// .captureFrame, name, level + XP ring, joined date, equipped skin name),
// ② vitals (weight tier §C4.3 copy, health state, mood band), ③ lifetime
// totals 2-col grid (1-col at 320 px), ④ minigames — all 21 catalog rows
// sorted by unlock (icon, name, best, plays; locked rows greyed), ⑤ the 4
// collection-set progress bars. Every number renders `tabular-nums`.
// Mounting fires the 'statsScreen' quest event (§C5.1 q.medicineCabinet).

import { XP } from '../data/constants.js';
import { MINIGAMES } from '../data/minigames.js';
import { COLLECTION_SETS } from '../data/collections.js';
import { setProgress } from '../systems/collections.js';
import { tierOf } from '../systems/weight.js';
import { currentMood } from '../systems/sleep.js';
import { moodBand } from '../systems/stats.js';
import { xpToNext } from '../systems/leveling.js';
import { getAchievementsEngine } from '../systems/achievementsEngine.js';
import { now } from '../core/clock.js';
import { t, getLang } from '../data/strings.js';
import { icon } from './icons.js';

const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

const PROFILE_CSS = `
.screen-profile{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g23-pr-head{width:100%;max-width:440px;display:flex;align-items:center;gap:10px;margin:6px 0 6px;flex:none;}
.g23-pr-title{flex:1;min-width:0;margin:0;font-size:clamp(17px,6vw,30px);font-weight:800;color:var(--brown);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.g23-pr-card{width:100%;max-width:440px;background:var(--white);border-radius:18px;box-shadow:var(--shadow-soft);padding:12px 14px;flex:none;margin-bottom:10px;}
.g23-pr-card h2{margin:0 0 8px;font-size:13px;font-weight:800;color:var(--brown);opacity:.55;text-transform:uppercase;letter-spacing:.5px;}
.g23-pr-id{display:flex;align-items:center;gap:12px;}
.g23-pr-portrait{flex:none;width:72px;height:72px;border-radius:50%;background:rgba(74,59,54,.08);overflow:hidden;display:flex;align-items:center;justify-content:center;color:rgba(74,59,54,.35);}
.g23-pr-portrait img{width:100%;height:100%;object-fit:cover;}
.g23-pr-idbody{flex:1;min-width:0;}
.g23-pr-name{font-size:19px;font-weight:800;color:var(--brown);}
.g23-pr-sub{font-size:12px;font-weight:700;opacity:.55;margin-top:2px;}
.g23-pr-ring{position:relative;width:52px;height:52px;flex:none;}
.g23-pr-ring svg{transform:rotate(-90deg);}
.g23-pr-ring .g23-pr-ring-bg{fill:rgba(255,255,255,.92);stroke:rgba(74,59,54,.12);stroke-width:5;}
.g23-pr-ring .g23-pr-ring-fg{fill:none;stroke:var(--teal);stroke-width:5;stroke-linecap:round;}
.g23-pr-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;}
.g23-pr-ring-lvl{font-size:16px;font-weight:800;color:var(--brown);font-variant-numeric:tabular-nums;}
.g23-pr-ring-cap{font-size:8px;font-weight:800;color:var(--brown);opacity:.5;text-transform:uppercase;letter-spacing:.5px;}
.g23-pr-vitals{display:flex;gap:8px;flex-wrap:wrap;}
.g23-pr-vital{flex:1;min-width:88px;background:rgba(74,59,54,.05);border-radius:14px;padding:8px 10px;}
.g23-pr-vital-k{font-size:10px;font-weight:800;opacity:.5;text-transform:uppercase;letter-spacing:.4px;}
.g23-pr-vital-v{font-size:14px;font-weight:800;color:var(--brown);margin-top:2px;}
.g23-pr-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;}
@media (max-width:340px){.g23-pr-grid{grid-template-columns:1fr;}}
.g23-pr-rowline{display:flex;align-items:baseline;gap:8px;min-width:0;}
.g23-pr-k{flex:1;min-width:0;font-size:12px;font-weight:700;color:var(--brown);opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g23-pr-v{flex:none;font-size:13px;font-weight:800;color:var(--brown);font-variant-numeric:tabular-nums;}
.g23-pr-games{display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g23-pr-game{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:12px;}
.g23-pr-game:nth-child(odd){background:rgba(74,59,54,.04);}
.g23-pr-game svg{flex:none;color:var(--teal);}
.g23-pr-game.g23-locked{opacity:.45;}
.g23-pr-game.g23-locked svg{color:rgba(74,59,54,.4);}
.g23-pr-game-name{flex:1;min-width:0;font-size:12px;font-weight:800;color:var(--brown);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g23-pr-game-n{flex:none;font-size:12px;font-weight:800;color:var(--brown);opacity:.7;font-variant-numeric:tabular-nums;}
.g23-pr-sets{display:flex;flex-direction:column;gap:8px;}
.g23-pr-set{display:flex;align-items:center;gap:10px;}
.g23-pr-set-name{flex:none;width:110px;font-size:12px;font-weight:800;color:var(--brown);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g23-pr-set-bar{flex:1;height:9px;border-radius:999px;background:rgba(74,59,54,.1);overflow:hidden;}
.g23-pr-set-fill{display:block;height:100%;border-radius:999px;background:var(--teal);}
.g23-pr-set-n{flex:none;font-size:12px;font-weight:800;opacity:.6;font-variant-numeric:tabular-nums;}
`;

/** profile.playtimeMin → "h:mm". */
function fmtPlaytime(min) {
  const m = Math.max(0, Math.floor(Number(min) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** profile.distanceM → "x.x km". */
function fmtKm(meters) {
  return `${((Math.max(0, Number(meters) || 0)) / 1000).toFixed(1)} km`;
}

/**
 * Create + register the profile screen (ui screen 'profile').
 * @param {{store: object, ui: object, audio: object,
 *   sceneManager?: {captureFrame?: () => Promise<Blob|null>}}} deps
 */
export function registerProfileScreen({ store, ui, audio, sceneManager }) {
  if (!document.querySelector('style[data-owner="g23-profile"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g23-profile';
    style.textContent = PROFILE_CSS;
    document.head.appendChild(style);
  }

  /** @type {{off: Function, url: string|null, img: HTMLImageElement|null}|null} */
  let live = null;

  function mount(el) {
    const head = document.createElement('div');
    head.className = 'g23-pr-head';
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost btn-round';
    backBtn.setAttribute('aria-label', t('ui.back'));
    backBtn.innerHTML = icon('arrowLeft', 22);
    backBtn.addEventListener('click', () => {
      audio.play('ui.close');
      ui.closeAll();
    });
    const title = document.createElement('h1');
    title.className = 'g23-pr-title';
    title.textContent = t('profile.title');
    head.append(backBtn, title);
    el.appendChild(head);

    const body = document.createElement('div');
    body.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:center;flex:none;padding-bottom:18px;';
    el.appendChild(body);

    function render() {
      const state = store.get();
      const counters = state.achievements?.counters ?? {};
      const profile = state.profile ?? {};
      const level = Number(state.level) || 1;
      const xp = Number(state.xp) || 0;
      const frac = level >= XP.MAX_LEVEL ? 1 : Math.min(1, xp / xpToNext(level));

      // ① header card
      const joined = new Date(Number(state.createdAt) || now());
      const dateStr = joined.toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
      const skinName = t(`skin.${state.skins?.equipped ?? 'cream'}`);

      // ② vitals
      const tier = tierOf(state.weight?.value);
      const healthState = state.health?.state ?? 'healthy';
      const band = moodBand(currentMood(state, now()));

      // ③ lifetime totals — §C12.1 order, verbatim
      const totals = [
        ['profile.playtime', fmtPlaytime(profile.playtimeMin)],
        ['profile.feeds', counters.feeds ?? 0],
        ['profile.washes', counters.washes ?? 0],
        ['profile.naps', counters.sleeps ?? 0],
        ['profile.tickles', counters.tickles ?? 0],
        ['profile.balls', counters.balls ?? 0],
        ['profile.trips', counters.trips ?? 0],
        ['profile.vetVisits', counters.vetTrips ?? 0],
        ['profile.deliveries', counters.deliveries ?? 0],
        ['profile.harvests', counters.harvests ?? 0],
        ['profile.photos', profile.photos ?? 0],
        ['profile.questsDone', counters.questsDone ?? 0],
        ['profile.coinsEarned', profile.coinsEarned ?? 0],
        ['profile.coinsSpent', profile.coinsSpent ?? 0],
        ['profile.distance', fmtKm(profile.distanceM)],
      ];

      // ④ minigames — the 21 catalog rows sorted by unlock (skip dev _smoke)
      const games = MINIGAMES.filter((m) => !m.dev)
        .slice()
        .sort((a, b) => a.minLevel - b.minLevel || a.id.localeCompare(b.id));
      const best = state.minigames?.best ?? {};
      const plays = state.minigames?.plays ?? {};

      body.innerHTML = `
        <div class="g23-pr-card">
          <div class="g23-pr-id">
            <span class="g23-pr-portrait">${icon('rabbit', 40)}</span>
            <span class="g23-pr-idbody">
              <div class="g23-pr-name">${t('profile.name')}</div>
              <div class="g23-pr-sub">${t('profile.joined', { date: dateStr })}</div>
              <div class="g23-pr-sub">${t('profile.skin')}: ${skinName}</div>
            </span>
            <span class="g23-pr-ring">
              <svg width="52" height="52" viewBox="0 0 52 52">
                <circle class="g23-pr-ring-bg" cx="26" cy="26" r="${RING_R}"></circle>
                <circle class="g23-pr-ring-fg" cx="26" cy="26" r="${RING_R}"
                  stroke-dasharray="${RING_C.toFixed(2)}"
                  stroke-dashoffset="${(RING_C * (1 - frac)).toFixed(2)}"></circle>
              </svg>
              <span class="g23-pr-ring-label">
                <span class="g23-pr-ring-lvl">${level}</span>
                <span class="g23-pr-ring-cap">${t('ui.level')}</span>
              </span>
            </span>
          </div>
        </div>
        <div class="g23-pr-card">
          <h2>${t('profile.vitals')}</h2>
          <div class="g23-pr-vitals">
            <span class="g23-pr-vital"><div class="g23-pr-vital-k">${t('profile.weight')}</div>
              <div class="g23-pr-vital-v">${t(`weight.tier.${tier}`)}</div></span>
            <span class="g23-pr-vital"><div class="g23-pr-vital-k">${t('profile.health')}</div>
              <div class="g23-pr-vital-v">${t(`profile.health.${healthState}`)}</div></span>
            <span class="g23-pr-vital"><div class="g23-pr-vital-k">${t('profile.mood')}</div>
              <div class="g23-pr-vital-v">${t(`profile.mood.${band}`)}</div></span>
          </div>
        </div>
        <div class="g23-pr-card">
          <h2>${t('profile.totals')}</h2>
          <div class="g23-pr-grid">
            ${totals.map(([k, v]) => `
              <span class="g23-pr-rowline"><span class="g23-pr-k">${t(k)}</span>
                <span class="g23-pr-v">${v}</span></span>`).join('')}
          </div>
        </div>
        <div class="g23-pr-card">
          <h2>${t('profile.minigames')}</h2>
          <div class="g23-pr-games">
            ${games.map((m) => {
              const locked = level < m.minLevel;
              return `
                <span class="g23-pr-game${locked ? ' g23-locked' : ''}">
                  ${icon(locked ? 'lock' : m.icon, 16)}
                  <span class="g23-pr-game-name">${t(m.titleKey)}</span>
                  <span class="g23-pr-game-n">${locked
                    ? t('profile.lockedRow', { level: m.minLevel })
                    : `${t('profile.best')} ${best[m.id] ?? 0} · ${t('profile.plays')} ${plays[m.id] ?? 0}`}</span>
                </span>`;
            }).join('')}
          </div>
        </div>
        <div class="g23-pr-card">
          <h2>${t('profile.collections')}</h2>
          <div class="g23-pr-sets">
            ${COLLECTION_SETS.map((set) => {
              const p = setProgress(state.collections ?? {}, set);
              return `
                <span class="g23-pr-set">
                  <span class="g23-pr-set-name">${t(set.nameKey)}</span>
                  <span class="g23-pr-set-bar"><span class="g23-pr-set-fill"
                    style="width:${Math.round((p.have / p.total) * 100)}%"></span></span>
                  <span class="g23-pr-set-n">${p.have}/${p.total}</span>
                </span>`;
            }).join('')}
          </div>
        </div>`;

      // ① portrait: live mini render via sceneManager.captureFrame (§C12.1);
      // graceful icon fallback when no scene is active (e.g. headless boot).
      // The SAME <img> node is re-attached across re-renders (render() runs on
      // every store tick) so the decoded bitmap never flickers back to grey.
      const portrait = body.querySelector('.g23-pr-portrait');
      if (live?.img && portrait) {
        portrait.innerHTML = '';
        portrait.appendChild(live.img);
      }
    }

    render();
    sceneManager?.captureFrame?.().then((blob) => {
      if (!blob || !live) return;
      live.url = URL.createObjectURL(blob);
      live.img = new Image();
      live.img.alt = '';
      live.img.src = live.url;
      const portrait = document.querySelector('.g23-pr-portrait');
      if (portrait) {
        portrait.innerHTML = '';
        portrait.appendChild(live.img);
      }
    }).catch(() => {});

    let lang = getLang();
    const off = store.on('change', () => {
      if (getLang() !== lang) lang = getLang();
      render();
    });
    live = { off, url: null, img: null };

    // §C5.1 q.medicineCabinet: opening the stats screen is a quest event.
    getAchievementsEngine()?.quests?.track?.('statsScreen', 1);
  }

  function unmount() {
    live?.off?.();
    if (live?.url) URL.revokeObjectURL(live.url);
    live = null;
  }

  ui.registerScreen('profile', { mount, unmount });
}
