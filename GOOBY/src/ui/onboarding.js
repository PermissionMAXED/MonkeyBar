// Onboarding (§C8.1, agent G14) — the first-run scripted tutorial. Two layers:
//
//  1. PURE state machine + progress predicates (this module's exports up top)
//     — no DOM/three imports so test/onboarding.test.js runs them headlessly.
//     Steps (§C8.1): welcome card „Das ist Gooby!" → forced pet → forced feed
//     (carrot from the tray) → room-swipe hint to the bathroom → quick wash →
//     HUD tour tooltips → tutorial carrotCatch (30 s, ≥10 coins guaranteed) →
//     shop-door hint → done (the §C8.2 daily popup then auto-shows).
//     Progress persists in save `onboarding.step` (resumable §E3), `done`
//     short-circuits returning users, and a skip button appears after step
//     ONBOARDING.SKIPPABLE_AFTER_STEP (§C8.1: forced pet/feed can't be skipped).
//
//  2. Browser driver initOnboarding() (bottom) — a floating tutorial card over
//     the live home scene (pointer-events pass through everywhere else so the
//     player really pets/feeds/washes), store-driven completion detection via
//     snapshotProgress diffs, HUD spotlight highlights, and the tutorial
//     carrotCatch launch via framework params (§E8 ctx.params).
//
// G12's daily-bonus auto-popup waits for `onboarding.done` (one-line guard in
// dailyBonusPopup.js) so the §C8.1 order holds: tutorial → done → daily popup.

import { t } from '../data/strings.js';
import { ONBOARDING } from '../data/constants.js';

// ---------------------------------------------------------------------------
// Pure logic (§C8.1 step machine — covered by test/onboarding.test.js)
// ---------------------------------------------------------------------------

/** The 8 steps (§C8.1), in order. */
export const ONBOARDING_STEPS = Object.freeze([
  'welcome', // 1: Gooby hops in + waves + name card
  'pet', // 2: forced pet → hearts
  'feed', // 3: forced feed (carrot from the tray)
  'roomHint', // 4: room-swipe hint to the bathroom
  'wash', // 5: quick wash
  'hudTour', // 6: HUD tour tooltips (bars/coins/XP)
  'minigame', // 7: tutorial carrotCatch (30 s variant, ≥10 coins)
  'shopHint', // 8: shop-door hint → done → daily popup
]);

/**
 * Progress snapshot used by the completion predicates — pure projection of
 * the save state (+ the active room, which lives outside the store).
 * @param {object} state save-schema state (§E3)
 * @param {string|null} [room] active home room id
 */
export function snapshotProgress(state, room = null) {
  const c = state?.achievements?.counters ?? {};
  return {
    strokes: (c.petsToday ?? 0) + (c.tickles ?? 0),
    feeds: c.feeds ?? 0,
    washes: c.washes ?? 0,
    catchPlays: state?.minigames?.plays?.carrotCatch ?? 0,
    room,
  };
}

/**
 * Has the player performed the step's required action? Steps not listed here
 * (welcome/hudTour/shopHint) advance via their card buttons instead.
 * @param {string} stepId
 * @param {ReturnType<typeof snapshotProgress>} baseline snapshot at step entry
 * @param {ReturnType<typeof snapshotProgress>} now current snapshot
 * @returns {boolean}
 */
export function stepSatisfied(stepId, baseline, now) {
  switch (stepId) {
    case 'pet':
      return now.strokes > baseline.strokes;
    case 'feed':
      return now.feeds > baseline.feeds;
    case 'roomHint':
      return now.room === 'bathroom';
    case 'wash':
      return now.washes > baseline.washes;
    case 'minigame':
      return now.catchPlays > baseline.catchPlays;
    default:
      return false;
  }
}

/**
 * The resumable step machine (§C8.1). `saved` is the save's onboarding slice
 * ({ step, done }); out-of-range steps clamp safely.
 * @param {{step?: number, done?: boolean}} [saved]
 */
export function createOnboardingMachine(saved = {}) {
  let idx = Number.isInteger(saved.step)
    ? Math.max(0, Math.min(saved.step, ONBOARDING_STEPS.length))
    : 0;
  let done = saved.done === true || idx >= ONBOARDING_STEPS.length;

  return {
    /** @returns {string|null} active step id, or null when done */
    current() {
      return done ? null : ONBOARDING_STEPS[idx];
    },
    /** @returns {number} 0-based step index */
    index() {
      return idx;
    },
    isDone() {
      return done;
    },
    /** Skip allowed after step ONBOARDING.SKIPPABLE_AFTER_STEP (§C8.1). */
    skippable() {
      return !done && idx + 1 > ONBOARDING.SKIPPABLE_AFTER_STEP;
    },
    /**
     * Move to the next step (marks done past the last one).
     * @returns {string|null} the new step id, or null when finished
     */
    advance() {
      if (done) return null;
      idx += 1;
      if (idx >= ONBOARDING_STEPS.length) {
        done = true;
        return null;
      }
      return ONBOARDING_STEPS[idx];
    },
    /** @returns {boolean} whether the skip was allowed */
    skip() {
      if (done || idx + 1 <= ONBOARDING.SKIPPABLE_AFTER_STEP) return false;
      done = true;
      return true;
    },
    /** @returns {{step: number, done: boolean}} save-schema slice */
    serialize() {
      return { step: idx, done };
    },
  };
}

// ---------------------------------------------------------------------------
// Browser driver
// ---------------------------------------------------------------------------

/** Poll cadence for completion detection + scene visibility (ms). */
const POLL_MS = 350;

/** Per-step card copy + optional celebratory Gooby noise on completion. */
const STEP_CARDS = {
  welcome: { titleKey: 'ob.welcome.title', bodyKey: 'ob.welcome.body', btnKey: 'ob.continue', doneSfx: 'gooby.squeakHappy' },
  pet: { titleKey: 'ob.pet.title', bodyKey: 'ob.pet.body', doneSfx: 'gooby.giggle' },
  feed: { titleKey: 'ob.feed.title', bodyKey: 'ob.feed.body', doneSfx: 'gooby.squeakHappy' },
  roomHint: { titleKey: 'ob.room.title', bodyKey: 'ob.room.body' },
  wash: { titleKey: 'ob.wash.title', bodyKey: 'ob.wash.body', doneSfx: 'gooby.giggle' },
  hudTour: { titleKey: 'ob.hud.title' },
  minigame: { titleKey: 'ob.game.title', bodyKey: 'ob.game.body', btnKey: 'ob.game.play' },
  shopHint: { titleKey: 'ob.shop.title', bodyKey: 'ob.shop.body', btnKey: 'ob.continue' },
};

/** The three HUD-tour pages: body key + spotlight CSS selector (§C8.1 #5). */
const HUD_PAGES = [
  { bodyKey: 'ob.hud.p1', selector: '.g5-hud .stat-pill' },
  { bodyKey: 'ob.hud.p2', selector: '.g5-coins' },
  { bodyKey: 'ob.hud.p3', selector: '.g5-ring' },
];

/**
 * Start the first-run tutorial (no-op for returning users — §C8.1 "never
 * blocks returning users"). Call once from boot after scenes/UI exist.
 * @param {{store: object, ui: object, audio: object,
 *   sceneManager: object, framework: {launch: Function}}} deps
 */
export function initOnboarding({ store, ui, audio, sceneManager, framework }) {
  if (store.get('onboarding.done')) return;
  // Don't fight the dev harness's routing test surface (§E9).
  if (import.meta.env?.DEV && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    if (q.get('scene') || q.get('minigame') || q.get('open') || q.get('onboarding') === '0') return;
  }

  const machine = createOnboardingMachine(store.get('onboarding'));
  if (machine.isDone()) return;

  /** @type {HTMLElement} floating overlay root (pointer-events: none) */
  const root = document.createElement('div');
  root.className = 'g14-ob';
  ui.el.appendChild(root);
  /** @type {HTMLElement|null} */
  let card = null;

  let baseline = snapshotProgress(store.get(), null);
  let hudPage = 0;
  /** @type {Promise<object>|null} lazy home-scene module (room accessor) */
  let homeModP = null;
  const homeMod = () => (homeModP ??= import('../home/homeScene.js').catch(() => null));

  async function activeRoom() {
    const mod = await homeMod();
    try {
      return mod?.getRoomManager?.()?.activeRoom?.() ?? null;
    } catch {
      return null;
    }
  }

  function clearSpotlights() {
    for (const el of document.querySelectorAll('.g14-glow')) el.classList.remove('g14-glow');
  }

  function spotlight(selector) {
    clearSpotlights();
    if (!selector) return;
    for (const el of document.querySelectorAll(selector)) el.classList.add('g14-glow');
  }

  function persist() {
    const s = machine.serialize();
    store.set('onboarding.step', s.step);
    store.set('onboarding.done', s.done);
  }

  function finish(skipped) {
    persist();
    clearSpotlights();
    clearInterval(poll);
    root.remove();
    if (!skipped) {
      audio.play('jingle.short');
      ui.toast('ob.done');
    }
  }

  /** Per-step entry side effects (§C8.1 scripted beats). */
  function onEnterStep(stepId) {
    baseline = snapshotProgress(store.get(), null);
    hudPage = 0;
    clearSpotlights();
    if (stepId === 'welcome') {
      // Gooby hops in + waves at the name card (clip is feature-detected).
      homeMod().then((mod) => {
        try {
          mod?.getGooby?.()?.play?.('wave');
        } catch { /* rig not ready yet — the card alone is fine */ }
      });
      audio.play('gooby.squeakHappy');
    } else if (stepId === 'feed') {
      // Open the tray for the forced carrot feed (§C8.1 #3). The poll below
      // re-opens it if dismissed, so guard against double-opening here (F3).
      setTimeout(() => {
        if (!trayOpen()) ui.openPanel('foodTray');
      }, 350);
    }
    renderCard();
  }

  /** F3: is the fridge food-tray sheet currently mounted? */
  function trayOpen() {
    return !!document.querySelector('.panel-backdrop-foodTray');
  }

  function completeStep() {
    const spec = STEP_CARDS[machine.current()];
    if (spec?.doneSfx) audio.play(spec.doneSfx);
    audio.play('combo.up');
    const next = machine.advance();
    persist();
    if (next == null) {
      finish(false);
      return;
    }
    onEnterStep(next);
  }

  function renderCard() {
    const stepId = machine.current();
    if (!stepId) return;
    const spec = STEP_CARDS[stepId];
    card?.remove();
    card = document.createElement('div');
    // feed step: the food-tray sheet owns the bottom of the screen
    card.className = `g14-ob-card${stepId === 'feed' ? ' g14-top' : ''}`;
    const stepNo = machine.index() + 1;
    const isHudTour = stepId === 'hudTour';
    const body = isHudTour ? t(HUD_PAGES[hudPage].bodyKey) : spec.bodyKey ? t(spec.bodyKey, {
      sec: ONBOARDING.TUTORIAL_DURATION_SEC,
      coins: ONBOARDING.TUTORIAL_MIN_COINS,
    }) : '';
    card.innerHTML = `
      <div class="g14-ob-step">${stepNo}/${ONBOARDING_STEPS.length}</div>
      <div class="g14-ob-title">${t(spec.titleKey)}</div>
      ${body ? `<div class="g14-ob-body">${body}</div>` : ''}
      <div class="g14-ob-btns"></div>`;
    const btns = card.querySelector('.g14-ob-btns');
    if (isHudTour) {
      spotlight(HUD_PAGES[hudPage].selector);
      const next = document.createElement('button');
      next.className = 'btn btn-teal g14-ob-btn';
      next.textContent = t('ob.next');
      next.addEventListener('click', () => {
        audio.play('ui.tap');
        hudPage += 1;
        if (hudPage >= HUD_PAGES.length) completeStep();
        else renderCard();
      });
      btns.appendChild(next);
    } else if (spec.btnKey) {
      const go = document.createElement('button');
      go.className = 'btn btn-teal g14-ob-btn';
      go.textContent = t(spec.btnKey);
      go.addEventListener('click', () => {
        audio.play('ui.go');
        if (stepId === 'minigame') {
          // Tutorial carrotCatch (§C8.1 #6): 30 s + guaranteed coins via
          // framework params (§E8 ctx.params → carrotCatch's G14 param read).
          framework.launch('carrotCatch', {
            tutorial: true,
            durationSec: ONBOARDING.TUTORIAL_DURATION_SEC,
            minCoins: ONBOARDING.TUTORIAL_MIN_COINS,
          });
          // completion detected via minigames.plays.carrotCatch (poll below)
        } else {
          completeStep();
        }
      });
      btns.appendChild(go);
    }
    if (machine.skippable()) {
      const skip = document.createElement('button');
      skip.className = 'btn btn-ghost g14-ob-skip';
      skip.textContent = t('ob.skip');
      skip.addEventListener('click', () => {
        audio.play('ui.close');
        if (machine.skip()) finish(true);
      });
      btns.appendChild(skip);
    }
    root.appendChild(card);
  }

  // Completion detection + visibility: the overlay only shows over the home
  // scene (it hides during the tutorial minigame and over full screens).
  const poll = setInterval(async () => {
    if (machine.isDone()) return;
    const onHome = sceneManager.currentId?.() === 'home';
    // hide over non-home scenes, full screens, and while actively scrubbing
    // (the wash overlay + soap need the whole lower screen — §C3)
    const busy = !onHome || !!ui.activeScreenId?.() || !!document.querySelector('.g5-wash');
    root.classList.toggle('g14-ob-hidden', busy);
    if (!onHome) return;
    const stepId = machine.current();
    const now = snapshotProgress(store.get(), await activeRoom());
    if (stepSatisfied(stepId, baseline, now)) {
      completeStep();
      return;
    }
    // F3 dead-end guard (§C8.1 #3): the forced-feed step NEEDS the tray. If it
    // gets dismissed (backdrop tap, or a drag that missed Gooby's mouth closed
    // it), auto-reopen so the tutorial can never soft-lock. Never fights an
    // in-flight food drag (.g5-ghost) or another open sheet (permission etc.).
    if (stepId === 'feed' && !busy
      && !document.querySelector('.panel-backdrop')
      && !document.querySelector('.g5-ghost')) {
      ui.openPanel('foodTray');
    }
  }, POLL_MS);

  onEnterStep(machine.current());
  console.info(`[onboarding] first-run tutorial active (resumed at step ${machine.index() + 1}/${ONBOARDING_STEPS.length})`);
}
