// Daily quest board (PLAN2 §C5.1, agent V2/G23) — ui screen 'questBoard',
// opened by the HUD clipboard button from L2 (§B6 UNLOCKS.QUESTS). Shows
// today's 3 cards (title, desc, progress bar, coin+XP reward, claim button),
// the 1/day reroll button and the "New quests at midnight" note. Below L2 the
// screen renders a lock teaser instead (the HUD button shows from L1 so the
// teaser can tease — §C5.1). All quest state flows through the achievements
// engine's live quest API (systems/achievementsEngine.js V2/G23 block):
// claim pays coins via economy + XP via leveling + questsDone counter there.

import { UNLOCKS } from '../data/constants.js';
import { getQuest } from '../data/quests.js';
import { getAchievementsEngine, V2_QUEST_POOL } from '../systems/achievementsEngine.js';
import { t, getLang } from '../data/strings.js';
import { icon } from './icons.js';

// V3/G33 (§B3): mechanical px→rem sweep (÷16) of this injected CSS string —
// exemptions (1px hairlines/999px pills/shadows/@media px) per PLAN3 §B3.
const QB_CSS = `
.screen-questBoard{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g23-qb-head{width:100%;max-width:27.5rem;display:flex;align-items:center;gap:0.625rem;margin:0.375rem 0 0.375rem;flex:none;}
.g23-qb-title{flex:1;min-width:0;margin:0;font-size:clamp(1.0625rem,6vw,1.875rem);font-weight:800;color:var(--brown);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.g23-qb-list{width:100%;max-width:27.5rem;display:flex;flex-direction:column;gap:0.625rem;flex:none;}
.g23-qb-card{display:flex;flex-direction:column;gap:0.5rem;background:var(--white);border-radius:1.125rem;box-shadow:var(--shadow-soft);padding:0.75rem 0.875rem;}
.g23-qb-card.g23-claimed{opacity:.72;}
.g23-qb-row{display:flex;align-items:flex-start;gap:0.625rem;}
.g23-qb-body{flex:1;min-width:0;}
.g23-qb-name{font-size:0.9375rem;font-weight:800;color:var(--brown);}
.g23-qb-desc{font-size:0.75rem;font-weight:700;opacity:.72;margin-top:1px;} /* V4/G-UI: .55→.72 — body-text contrast ≈4.7:1 (WCAG-ish) */
.g23-qb-reward{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:0.1875rem;}
.g23-qb-coins{display:inline-flex;align-items:center;gap:0.1875rem;font-size:0.8125rem;font-weight:800;color:var(--brown);background:rgba(255,209,102,.35);border-radius:999px;padding:0.1875rem 0.5625rem;}
.g23-qb-coins svg{color:var(--yellow);}
.g23-qb-xp{font-size:0.6875rem;font-weight:800;color:var(--teal-dark);opacity:.8;}
.g23-qb-barrow{display:flex;align-items:center;gap:0.625rem;}
.g23-qb-bar{flex:1;height:0.5625rem;border-radius:999px;background:var(--track-soft);overflow:hidden;}
.g23-qb-fill{display:block;height:100%;border-radius:999px;background:var(--teal);transition:width 300ms ease;}
.g23-qb-card.g23-done .g23-qb-fill{background:var(--yellow);}
.g23-qb-progress{flex:none;font-size:0.75rem;font-weight:800;opacity:.6;font-variant-numeric:tabular-nums;}
.g23-qb-claim{flex:none;border:none;border-radius:999px;min-height:max(44px, 2.75rem);min-width:max(44px, 2.75rem);padding:0.5rem 1.125rem;font-family:inherit;font-size:0.8125rem;font-weight:800;cursor:pointer;background:rgba(74,59,54,.08);color:rgba(74,59,54,.45);-webkit-tap-highlight-color:transparent;} /* V2 fix (E16): >=44px hit target */
.g23-qb-card.g23-done .g23-qb-claim{background:var(--yellow);color:#fff;box-shadow:var(--shadow-soft);}
.g23-qb-card.g23-claimed .g23-qb-claim{background:rgba(74,59,54,.08);color:var(--teal-dark);}
.g23-qb-foot{width:100%;max-width:27.5rem;display:flex;align-items:center;gap:0.625rem;margin:0.75rem 0 1.125rem;flex:none;flex-wrap:wrap;}
.g23-qb-midnight{flex:1;min-width:9.375rem;font-size:0.75rem;font-weight:700;color:var(--brown);opacity:.55;}
.g23-qb-reroll{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:0.375rem;border:none;border-radius:999px;min-height:max(44px, 2.75rem);min-width:max(44px, 2.75rem);padding:0.5625rem 1rem;font-family:inherit;font-size:0.8125rem;font-weight:800;cursor:pointer;background:var(--white);color:var(--teal-dark);box-shadow:var(--shadow-soft);-webkit-tap-highlight-color:transparent;} /* V2 fix (E16): >=44px hit target */
.g23-qb-reroll[disabled]{color:rgba(74,59,54,.35);cursor:default;}
.g23-qb-locked{width:100%;max-width:27.5rem;display:flex;flex-direction:column;align-items:center;gap:0.625rem;background:var(--white);border-radius:1.125rem;box-shadow:var(--shadow-soft);padding:1.75rem 1.125rem;text-align:center;flex:none;}
.g23-qb-locked svg{color:rgba(74,59,54,.3);}
.g23-qb-locked-title{font-size:1.0625rem;font-weight:800;color:var(--brown);}
.g23-qb-locked-teaser{font-size:0.8125rem;font-weight:700;opacity:.72;max-width:17.5rem;} /* V4/G-UI: .6→.72 — body-text contrast */
`;

/**
 * Create + register the daily quest board screen (ui screen 'questBoard').
 * @param {{store: object, ui: object, audio: object}} deps
 */
export function registerQuestBoard({ store, ui, audio }) {
  if (!document.querySelector('style[data-owner="g23-qb"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g23-qb';
    style.textContent = QB_CSS;
    document.head.appendChild(style);
  }

  /** @type {{off: Function}|null} */
  let live = null;

  function mount(el) {
    const head = document.createElement('div');
    head.className = 'g23-qb-head';
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost btn-round';
    backBtn.setAttribute('aria-label', t('ui.back'));
    backBtn.innerHTML = icon('arrowLeft', 22);
    backBtn.addEventListener('click', () => {
      audio.play('ui.close');
      ui.closeAll();
    });
    const title = document.createElement('h1');
    title.className = 'g23-qb-title';
    title.textContent = t('quests.title');
    head.append(backBtn, title);
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'g23-qb-list';
    el.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'g23-qb-foot';
    el.appendChild(foot);

    function renderLocked() {
      body.innerHTML = '';
      foot.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'g23-qb-locked';
      box.innerHTML = `
        ${icon('lock', 40)}
        <div class="g23-qb-locked-title">${t('quests.lockedTitle')}</div>
        <div class="g23-qb-locked-teaser">${t('quests.lockedTeaser', { level: UNLOCKS.QUESTS })}</div>`;
      body.appendChild(box);
    }

    function render() {
      const state = store.get();
      if ((Number(state.level) || 1) < UNLOCKS.QUESTS) {
        renderLocked();
        return;
      }
      const engine = getAchievementsEngine();
      engine?.quests?.rollNow?.(); // day may have rolled over while open
      const q = store.get('quests') ?? { active: [] };
      body.innerHTML = '';
      for (const entry of q.active ?? []) {
        const def = getQuest(entry.id) ?? V2_QUEST_POOL.find((d) => d.id === entry.id);
        if (!def) continue;
        const done = !entry.claimed && entry.progress >= def.target;
        const card = document.createElement('div');
        card.className = `g23-qb-card${done ? ' g23-done' : ''}${entry.claimed ? ' g23-claimed' : ''}`;
        const pct = Math.round(
          (Math.min(def.target, entry.progress) / def.target) * 100
        );
        card.innerHTML = `
          <div class="g23-qb-row">
            <span class="g23-qb-body">
              <div class="g23-qb-name">${t(def.titleKey ?? `quest.${entry.id.slice(2)}.title`)}</div>
              <div class="g23-qb-desc">${t(def.descKey ?? `quest.${entry.id.slice(2)}.desc`)}</div>
            </span>
            <span class="g23-qb-reward">
              <span class="g23-qb-coins">${icon('coin', 13)}${t('quests.reward', { coins: def.coins })}</span>
              <span class="g23-qb-xp">${t('quests.xp', { xp: def.xp })}</span>
            </span>
          </div>
          <div class="g23-qb-barrow">
            <span class="g23-qb-bar"><span class="g23-qb-fill" style="width:${entry.claimed ? 100 : pct}%"></span></span>
            <span class="g23-qb-progress">${Math.min(def.target, entry.progress)}/${def.target}</span>
            <button class="g23-qb-claim" ${done ? '' : 'disabled'}>${entry.claimed ? t('quests.claimed') : t('quests.claim')}</button>
          </div>`;
        const claimBtn = card.querySelector('.g23-qb-claim');
        if (done) {
          claimBtn.addEventListener('click', () => {
            const reward = getAchievementsEngine()?.quests?.claim?.(entry.id);
            if (reward) {
              audio.play('quest.claim');
              ui.toast('toast.questClaimed', { coins: reward.coins, xp: reward.xp });
            }
          });
        }
        body.appendChild(card);
      }

      foot.innerHTML = '';
      const midnight = document.createElement('div');
      midnight.className = 'g23-qb-midnight';
      midnight.textContent = t('quests.midnight');
      const rerollBtn = document.createElement('button');
      rerollBtn.className = 'g23-qb-reroll';
      const used = q.rerolledDay === q.day;
      rerollBtn.innerHTML = `${icon('replay', 16)}${used ? t('quests.rerollUsed') : t('quests.reroll')}`;
      if (used) rerollBtn.disabled = true;
      rerollBtn.addEventListener('click', () => {
        const ok = getAchievementsEngine()?.quests?.reroll?.();
        if (ok) {
          audio.play('ui.tap');
          ui.toast('toast.questsRerolled');
        } else {
          ui.toast('toast.rerollRefused');
        }
      });
      foot.append(midnight, rerollBtn);
    }

    render();
    let lang = getLang();
    const off = store.on('change', () => {
      if (getLang() !== lang) lang = getLang(); // re-render picks new strings up
      render();
    });
    live = { off };
  }

  function unmount() {
    live?.off?.();
    live = null;
  }

  ui.registerScreen('questBoard', { mount, unmount });
}
