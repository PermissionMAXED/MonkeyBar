// Profile / lifetime-stats screen (PLAN2 §C12.1, agent V2/G23) — ui screen
// 'profile', opened by the HUD avatar button (L1). Single scroll, §C12.1
// sections top-to-bottom: ① header (portrait snap via sceneManager
// .captureFrame, name, level + XP ring, joined date, equipped skin name),
// ② vitals (weight tier §C4.3 copy, health state, mood band), ③ lifetime
// totals 2-col grid (1-col at 320 px), ④ minigames — all 21 catalog rows
// sorted by unlock (icon, name, best, plays; locked rows greyed), ⑤ the 4
// collection-set progress bars. Every number renders `tabular-nums`.
// Mounting fires the 'statsScreen' quest event (§C5.1 q.medicineCabinet).

import { LEVELING } from '../data/constants.js';
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
// V4/G59 (§C-SYS9.3-2): „Galerie ({n} Fotos)" + Stickerbuch rows → album
import { STICKERS } from '../data/stickers.js';
import { stickerCounts } from '../systems/stickerBook.js';
import { tG } from '../systems/gallery.logic.js';
// V4/G69 (§C-SYS3): session/lifetime XP-source summaries for the profile row.
import { sessionXpSources, knownLifetimeXpSources } from './xpInfoSheet.js';
// V4/G64 (§C-SYS2.8): „Rückblicke" row model (pure) — the player itself is
// lazy-imported on tap so the recap chunk never rides the profile mount.
import { historyRows, agoLabel } from './recapOverlay.logic.js';

const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

// V3/G33 (§B3): mechanical px→rem sweep (÷16) of this injected CSS string —
// exemptions (1px hairlines/999px pills/shadows/@media px) per PLAN3 §B3.
const PROFILE_CSS = `
.screen-profile{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g23-pr-head{width:100%;max-width:27.5rem;display:flex;align-items:center;gap:0.625rem;margin:0.375rem 0 0.375rem;flex:none;}
.g23-pr-title{flex:1;min-width:0;margin:0;font-size:clamp(1.0625rem,6vw,1.875rem);font-weight:800;color:var(--brown);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.g23-pr-card{width:100%;max-width:27.5rem;background:var(--white);border-radius:1.125rem;box-shadow:var(--shadow-soft);padding:0.75rem 0.875rem;flex:none;margin-bottom:0.625rem;}
.g23-pr-card h2{margin:0 0 0.5rem;font-size:0.8125rem;font-weight:800;color:var(--brown);opacity:.55;text-transform:uppercase;letter-spacing:0.0313rem;}
.g23-pr-id{display:flex;align-items:center;gap:0.75rem;}
.g23-pr-portrait{flex:none;width:4.5rem;height:4.5rem;border-radius:50%;background:rgba(74,59,54,.08);overflow:hidden;display:flex;align-items:center;justify-content:center;color:rgba(74,59,54,.35);}
.g23-pr-portrait img{width:100%;height:100%;object-fit:cover;}
.g23-pr-idbody{flex:1;min-width:0;}
.g23-pr-name{font-size:1.1875rem;font-weight:800;color:var(--brown);}
.g23-pr-sub{font-size:0.75rem;font-weight:700;opacity:.72;margin-top:0.125rem;} /* V4/G-UI: .55→.72 — body-text contrast ≈4.7:1 (WCAG-ish) */
.g23-pr-ring{position:relative;width:3.25rem;height:3.25rem;flex:none;}
.g23-pr-ring svg{transform:rotate(-90deg);}
.g23-pr-ring .g23-pr-ring-bg{fill:rgba(255,255,255,.92);stroke:rgba(74,59,54,.12);stroke-width:5;}
.g23-pr-ring .g23-pr-ring-fg{fill:none;stroke:var(--teal);stroke-width:5;stroke-linecap:round;}
.g23-pr-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;}
.g23-pr-ring-lvl{font-size:1rem;font-weight:800;color:var(--brown);font-variant-numeric:tabular-nums;}
.g23-pr-ring-cap{font-size:0.5rem;font-weight:800;color:var(--brown);opacity:.5;text-transform:uppercase;letter-spacing:0.0313rem;}
.g23-pr-vitals{display:flex;gap:0.5rem;flex-wrap:wrap;}
.g23-pr-vital{flex:1;min-width:5.5rem;background:rgba(74,59,54,.05);border-radius:0.875rem;padding:0.5rem 0.625rem;}
.g23-pr-vital-k{font-size:0.625rem;font-weight:800;opacity:.5;text-transform:uppercase;letter-spacing:0.025rem;}
.g23-pr-vital-v{font-size:0.875rem;font-weight:800;color:var(--brown);margin-top:0.125rem;}
.g23-pr-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.375rem 0.875rem;}
@media (max-width:340px){.g23-pr-grid{grid-template-columns:1fr;}}
.g23-pr-rowline{display:flex;align-items:baseline;gap:0.5rem;min-width:0;}
/* V3/FIX-C: totals keys („Münzen ausgegeben") wrap to 2 lines at 130% */
.g23-pr-k{flex:1;min-width:0;font-size:0.75rem;font-weight:700;color:var(--brown);opacity:.72;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:break-word;hyphens:auto;line-height:1.2;} /* V4/G-UI: .6→.72 — body-text contrast */
.g23-pr-v{flex:none;font-size:0.8125rem;font-weight:800;color:var(--brown);font-variant-numeric:tabular-nums;}
.g23-pr-games{display:flex;flex-direction:column;gap:0.25rem;max-height:17.5rem;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g23-pr-game{display:flex;align-items:center;gap:0.5rem;padding:0.3125rem 0.375rem;border-radius:0.75rem;}
.g23-pr-game:nth-child(odd){background:rgba(74,59,54,.04);}
.g23-pr-game svg{flex:none;color:var(--teal);}
.g23-pr-game.g23-locked{opacity:.45;}
.g23-pr-game.g23-locked svg{color:rgba(74,59,54,.4);}
/* V3/FIX-C (E13 P1): long DE game titles („Gießkannen-Wirbel", …) wrap to 2
   hyphenated lines instead of ellipsizing at 320px. */
.g23-pr-game-name{flex:1;min-width:0;font-size:0.75rem;font-weight:800;color:var(--brown);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:break-word;hyphens:auto;line-height:1.2;}
.g23-pr-game-n{flex:none;font-size:0.75rem;font-weight:800;color:var(--brown);opacity:.7;font-variant-numeric:tabular-nums;}
.g23-pr-sets{display:flex;flex-direction:column;gap:0.5rem;}
.g23-pr-set{display:flex;align-items:center;gap:0.625rem;}
/* V3/FIX-C (E13 P1): „Stadt-Sehenswürdigkeiten" wraps to 2 lines, no ellipsis */
.g23-pr-set-name{flex:none;width:6.875rem;font-size:0.75rem;font-weight:800;color:var(--brown);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:break-word;hyphens:auto;line-height:1.2;}
.g23-pr-set-bar{flex:1;height:0.5625rem;border-radius:999px;background:var(--track-soft);overflow:hidden;}
.g23-pr-set-fill{display:block;height:100%;border-radius:999px;background:var(--teal);}
.g23-pr-set-n{flex:none;font-size:0.75rem;font-weight:800;opacity:.6;font-variant-numeric:tabular-nums;}
/* ── V4/G59 (§C-SYS9.3-2): album rows under the sticker progress card ──── */
.g59-pr-rows{display:flex;flex-direction:column;gap:0.375rem;}
.g59-pr-row{display:flex;align-items:center;gap:0.5rem;border:none;border-radius:0.875rem;min-height:max(44px,2.75rem);padding:0.5rem 0.625rem;background:rgba(74,59,54,.05);color:var(--brown);font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:left;width:100%;}
.g59-pr-row svg{flex:none;color:var(--pink);}
.g59-pr-row-k{flex:1;min-width:0;font-size:0.8125rem;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g59-pr-row-v{flex:none;font-size:0.75rem;font-weight:800;opacity:.6;font-variant-numeric:tabular-nums;}
/* ── end V4/G59 ── */
/* ── V4/G69 (§C-SYS3.2): XP guide entry + compact source stats ─────────── */
.g23-pr-ring[role="button"]{border:0;padding:0;background:transparent;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.g69-pr-xp{display:flex;flex-direction:column;gap:.375rem;}
.g69-pr-xp-open{display:flex;align-items:center;gap:.5rem;width:100%;min-height:max(44px,2.75rem);padding:.4375rem .625rem;border:0;border-radius:.875rem;background:rgba(89,201,185,.12);color:var(--brown);font:800 .8125rem/1.2 system-ui;text-align:left;cursor:pointer;}
.g69-pr-xp-open svg{flex:none;color:var(--teal-dark);}
.g69-pr-xp-open span{flex:1;min-width:0;}
.g69-pr-xp-stat{display:grid;grid-template-columns:minmax(5.5rem,.38fr) 1fr;gap:.5rem;align-items:baseline;font-size:.6875rem;line-height:1.25;}
.g69-pr-xp-stat-k{font-weight:800;opacity:.55;}
.g69-pr-xp-stat-v{min-width:0;font-weight:800;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;}
/* ── end V4/G69 ── */
`;

/** V3/FIX-C: make long DE compounds line-breakable. Chrome's hyphens:auto
 * (a) skips words that already contain a hyphen („Stadt-Sehenswürdigkeiten"
 * stays one unbreakable token) and (b) never hyphenates a word that starts
 * mid-line — so a zero-width space re-tokenizes hard hyphens and soft
 * hyphens (rendered only at an actual break) give ≥10-char words mid-line
 * break points. Display-only (never fed back into state). */
const hy = (s) => String(s)
  .replace(/-/g, '-\u200B')
  .replace(/[A-Za-zÀ-ÿ]{10,}/g, (w) => w.replace(/(.{6})(?=.{3})/g, '$1\u00AD'));

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
      // V2 fix: ring caps at LEVELING.MAX_LEVEL (40), not the frozen v1
      // XP.MAX_LEVEL (30) — kept the ring pinned full for L30-39 (§B3).
      const frac = level >= LEVELING.MAX_LEVEL ? 1 : Math.min(1, xp / xpToNext(level));

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
        ${(() => {
          // ── V4/G69 (§C-SYS3): profile entry + top XP sources. Lifetime is
          // explicitly the exact counter-derived subset; variable/capped
          // historical grants are not guessed.
          const describe = (rows) => rows.slice(0, 2)
            .map((row) => `${t(`xp.source.${row.id}`)} ${row.amount} XP`)
            .join(' · ') || t('xp.profile.none');
          return `
        <div class="g23-pr-card">
          <div class="g69-pr-xp">
            <button class="g69-pr-xp-open" data-g69="open">
              ${icon('star', 16)}
              <span>${t('xp.open')}</span>
              ${icon('arrowRight', 14)}
            </button>
            <div class="g69-pr-xp-stat">
              <span class="g69-pr-xp-stat-k">${t('xp.profile.session')}</span>
              <span class="g69-pr-xp-stat-v">${describe(sessionXpSources())}</span>
            </div>
            <div class="g69-pr-xp-stat">
              <span class="g69-pr-xp-stat-k">${t('xp.profile.lifetime')}</span>
              <span class="g69-pr-xp-stat-v">${describe(knownLifetimeXpSources(state))}</span>
            </div>
          </div>
        </div>`;
        })()}
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
              <span class="g23-pr-rowline"><span class="g23-pr-k" lang="${getLang()}">${hy(t(k))}</span>
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
                  <span class="g23-pr-game-name" lang="${getLang()}">${hy(t(m.titleKey))}</span>
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
                  <span class="g23-pr-set-name" lang="${getLang()}">${hy(t(set.nameKey))}</span>
                  <span class="g23-pr-set-bar"><span class="g23-pr-set-fill"
                    style="width:${Math.round((p.have / p.total) * 100)}%"></span></span>
                  <span class="g23-pr-set-n">${p.have}/${p.total}</span>
                </span>`;
            }).join('')}
          </div>
        </div>
        ${(() => {
          // ── V4/G59 (§C-SYS9.3-2): album rows DIRECTLY under the sticker
          // progress card — sticker book (n/28 over the regular defs, the
          // secret 29th stays outside the count §C-SYS5.4) + „Galerie
          // ({n} Fotos)" from the §B7 gallery mirror slice. Click wiring is
          // re-attached after every innerHTML render below.
          const regular = STICKERS.filter((s) => s.id !== 'herzGooby');
          const book = stickerCounts(state, regular);
          const photoCount = Math.max(0, Math.floor(Number(state.gallery?.count) || 0));
          const cam = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 7h3l1.6-2.4A1.5 1.5 0 0 1 9.9 4h4.2a1.5 1.5 0 0 1 1.3.6L17 7h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V8.5A1.5 1.5 0 0 1 4 7z"/><circle cx="12" cy="13.5" r="4" fill="#fff" opacity="0.55"/><circle cx="12" cy="13.5" r="2.1"/></svg>';
          return `
        <div class="g23-pr-card">
          <h2>${tG('profile.albumRows')}</h2>
          <div class="g59-pr-rows">
            <button class="g59-pr-row" data-g59="book">
              ${icon('star', 16)}
              <span class="g59-pr-row-k">${t('album.tab.book')}</span>
              <span class="g59-pr-row-v">${book.unlocked}/${regular.length}</span>
              ${icon('arrowRight', 14)}
            </button>
            <button class="g59-pr-row" data-g59="photos">
              ${cam}
              <span class="g59-pr-row-k">${tG('profile.galleryRow', { n: photoCount })}</span>
              ${icon('arrowRight', 14)}
            </button>
          </div>
        </div>`;
        })()}
        ${(() => {
          // ── V4/G64 (§C-SYS2.8): „Rückblicke" — recap.history newest-first
          // („Level 25 · vor 3 Tagen"); tap → replay from the STORED stats
          // (no re-snapshot, reward text unchanged). Empty state until the
          // first milestone recap has played. Wiring re-attached below.
          const rows = historyRows(state.recap?.history);
          const body64 = rows.length === 0
            ? `<p class="g64-pr-empty">${t('recap.profile.empty')}</p>`
            : rows.map((row) => {
              const ago = agoLabel(row.at, now());
              return `
              <button class="g59-pr-row" data-g64-replay="${row.index}"
                aria-label="${t('recap.profile.replay')}">
                ${icon('star', 16)}
                <span class="g59-pr-row-k">${t('recap.profile.row', {
                  level: row.level,
                  ago: t(ago.key, ago.vars),
                })}</span>
                ${icon('arrowRight', 14)}
              </button>`;
            }).join('');
          return `
        <div class="g23-pr-card">
          <h2>${t('recap.profile.title')}</h2>
          <div class="g59-pr-rows">${body64}</div>
        </div>`;
        })()}`;

      // ── V4/G64 (§C-SYS2.8): replay taps — lazy import keeps the recap
      // player out of the profile chunk; the row index addresses the ORIGINAL
      // history array entry.
      body.querySelectorAll('[data-g64-replay]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = (store.get('recap')?.history ?? [])[Number(btn.dataset.g64Replay)];
          if (!row) return;
          audio.play('ui.confirmBig');
          import('./recapOverlay.js')
            .then((mod) => mod.replayRecap({ ...row, replay: true }))
            .catch((err) => console.warn('[profile] recap replay unavailable:', err));
        });
      });
      // ── end V4/G64 ──

      // V4/G59: album-row deep links (showScreen closes the profile first)
      body.querySelector('[data-g59="book"]')?.addEventListener('click', () => {
        audio.play('ui.tap');
        ui.showScreen('album', { tab: 'book' });
      });
      body.querySelector('[data-g59="photos"]')?.addEventListener('click', () => {
        audio.play('ui.tap');
        ui.showScreen('album', { tab: 'photos' });
      });

      // ── V4/G69 (§C-SYS3.2): both the profile ring and explicit row open
      // the same xpInfo sheet; listeners are re-attached after each render.
      const openXpInfo = () => {
        audio.play('ui.tap');
        ui.openPanel('xpInfo');
      };
      const profileRing = body.querySelector('.g23-pr-ring');
      profileRing?.setAttribute('role', 'button');
      profileRing?.setAttribute('tabindex', '0');
      profileRing?.setAttribute('aria-label', t('xp.openLabel'));
      profileRing?.addEventListener('click', openXpInfo);
      profileRing?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openXpInfo();
      });
      body.querySelector('[data-g69="open"]')?.addEventListener('click', openXpInfo);
      // ── end V4/G69 ──

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
