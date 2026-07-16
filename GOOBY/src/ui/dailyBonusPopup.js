// Daily bonus popup (§C8.2, agent G12) — streak calendar (7 slots, the
// claimable day highlighted), claim button with reward reveal (coins + the
// random food item from day 7 on). Auto-shows on the first open per local day:
// initDailyBonus (called from the marked G12 block in main.js) polls briefly
// after boot and opens the popup once Gooby is home and no other screen/panel
// is up — claiming is required (§C8.2), dismissing just waits for tomorrow.
// The 24 h reminder (notification id 5) keys off daily.lastClaimDay, which
// claim() updates (systems/notifyRules.js + the G6 reschedule hooks).

import { ECONOMY } from '../data/constants.js';
import { claim, isClaimable, nextStreak, prevDay, rewardForStreak } from '../systems/dailyBonus.js';
import { localDay } from '../core/clock.js';
import { getFood } from '../data/foods.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';

const DAILY_CSS = `
.g12-daily{text-align:center;}
.g12-daily-title{margin:0 0 2px;font-size:24px;font-weight:800;color:var(--brown);}
.g12-daily-sub{margin:0 0 14px;font-size:13.5px;font-weight:700;opacity:.6;}
.g12-daily-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:14px;}
.g12-daily-slot{display:flex;flex-direction:column;align-items:center;gap:2px;background:rgba(74,59,54,.06);border:2.5px solid transparent;border-radius:13px;padding:7px 2px;}
.g12-daily-slot-day{font-size:10px;font-weight:800;opacity:.55;}
.g12-daily-slot-coins{display:inline-flex;align-items:center;gap:2px;font-size:11.5px;font-weight:800;color:var(--brown);}
.g12-daily-slot-coins svg{color:var(--yellow);}
.g12-daily-slot-food{font-size:10px;line-height:1;}
.g12-daily-slot.g12-past{background:rgba(89,201,185,.18);}
.g12-daily-slot.g12-past .g12-daily-slot-day{color:var(--teal-dark);opacity:1;}
.g12-daily-slot.g12-today{border-color:var(--pink);background:rgba(255,123,169,.12);transform:scale(1.06);}
.g12-daily-slot.g12-today .g12-daily-slot-day{color:var(--pink-dark);opacity:1;}
.g12-daily-reward{min-height:30px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:17px;font-weight:800;color:var(--brown);margin-bottom:10px;}
.g12-daily-reward svg{color:var(--yellow);}
.g12-daily-streak{font-size:12.5px;font-weight:800;color:var(--teal-dark);margin-bottom:12px;}
`;

/**
 * Wire the daily bonus (§C8.2): registers the popup panel and auto-shows it
 * on the first open per local day. Called once from the marked G12 block.
 * @param {{store: object, ui: object, audio: object,
 *   sceneManager?: {currentId: () => string|null}}} deps
 */
export function initDailyBonus({ store, ui, audio, sceneManager }) {
  if (!document.querySelector('style[data-owner="g12-daily"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g12-daily';
    style.textContent = DAILY_CSS;
    document.head.appendChild(style);
  }

  // Dev harness extension (§E9 spirit, dev only): ?dailydemo=N pins the save
  // so today's claim counts as streak day N (e.g. 3 → day-3 popup state).
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  if (isDev && typeof location !== 'undefined') {
    const n = Number(new URLSearchParams(location.search).get('dailydemo'));
    if (Number.isFinite(n) && n >= 1) {
      store.update((state) => {
        state.daily = n === 1
          ? { lastClaimDay: '', streak: 0 }
          : { lastClaimDay: prevDay(localDay()), streak: Math.floor(n) - 1 };
      });
    }
  }

  ui.registerPanel('dailyBonus', {
    /** @param {HTMLElement} el */
    mount(el) {
      const today = localDay();
      const claimable = isClaimable(store.get('daily'), today);
      // The day this claim counts as (or the already-claimed day's position).
      const streakDay = claimable
        ? nextStreak(store.get('daily'), today)
        : Math.max(1, store.get('daily.streak') ?? 1);
      const slotIdx = Math.min(streakDay, ECONOMY.DAILY_BONUS.length) - 1;

      el.innerHTML = `
        <div class="g12-daily">
          <h2 class="g12-daily-title">${t('daily.title')}</h2>
          <p class="g12-daily-sub">${t('daily.sub')}</p>
          <div class="g12-daily-cal"></div>
          <div class="g12-daily-streak">${t('daily.streak', { n: streakDay })}</div>
          <div class="g12-daily-reward"></div>
          <div class="mg-btn-row"></div>
        </div>`;

      const cal = el.querySelector('.g12-daily-cal');
      for (let i = 0; i < ECONOMY.DAILY_BONUS.length; i += 1) {
        const slot = document.createElement('div');
        slot.className = 'g12-daily-slot';
        if (i < slotIdx) slot.classList.add('g12-past');
        if (i === slotIdx) slot.classList.add('g12-today');
        const isLast = i === ECONOMY.DAILY_BONUS.length - 1;
        slot.innerHTML = `
          <span class="g12-daily-slot-day">${i < slotIdx ? icon('check', 11) : t('daily.day', { n: i + 1 })}</span>
          <span class="g12-daily-slot-coins">${icon('coin', 11)}${ECONOMY.DAILY_BONUS[i]}</span>
          ${isLast ? '<span class="g12-daily-slot-food">🥕</span>' : ''}`;
        cal.appendChild(slot);
      }

      const rewardEl = el.querySelector('.g12-daily-reward');
      const btnRow = el.querySelector('.mg-btn-row');
      const btn = document.createElement('button');
      btnRow.appendChild(btn);

      if (!claimable) {
        rewardEl.textContent = t('daily.comeBack');
        btn.className = 'btn btn-ghost';
        btn.textContent = t('ui.close');
        btn.addEventListener('click', () => ui.closePanel('dailyBonus'));
        return;
      }

      const preview = rewardForStreak(streakDay);
      rewardEl.innerHTML = `${icon('coin', 20)}+${preview.coins}${preview.includesFood ? ` &nbsp;+ ${t('daily.foodBonus')}` : ''}`;
      btn.className = 'btn btn-teal';
      btn.textContent = t('daily.claim');
      btn.addEventListener('click', () => {
        const result = claim(store.get());
        if (!result.ok) {
          ui.closePanel('dailyBonus');
          return;
        }
        store.update((state) => Object.assign(state, result.state));
        audio.play('jingle.daily');
        const food = result.reward.foodId ? getFood(result.reward.foodId) : null;
        rewardEl.innerHTML =
          `${icon('coin', 20)}+${result.reward.coins}` +
          (food ? ` &nbsp;+ 1× ${t(food.nameKey)}` : '');
        el.querySelector('.g12-daily-streak').textContent = t('daily.streak', { n: result.reward.streakDay });
        btn.className = 'btn btn-ghost';
        btn.textContent = t('ui.close');
        ui.toast('daily.claimedToast', { coins: result.reward.coins });
      }, { once: false });
    },
    unmount() {},
  });

  // ---- auto-show on first open per local day (§C8.2) ----
  // Wait for the home scene with no screen/panel up (don't fight onboarding,
  // the harness ?open= routing or a running minigame), show once per session.
  let shownDay = '';
  const poll = setInterval(() => {
    const today = localDay();
    if (shownDay === today) return;
    if (store.get('onboarding.done') === false) return; // G14: tutorial first, popup after (§C8.1 #8)
    if (!isClaimable(store.get('daily'), today)) return;
    if (sceneManager?.currentId?.() !== 'home') return;
    if (ui.activeScreenId?.()) return;
    if (document.querySelector('.panel-backdrop')) return; // another sheet is up
    shownDay = today;
    audio.play('ui.open');
    ui.openPanel('dailyBonus');
  }, 800);
  // (interval kept for day rollovers while the app stays open)
  void poll;
}
