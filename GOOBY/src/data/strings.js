// Bilingual EN + DE string table (§A ruling, §C7 copy). ALL user-facing text goes
// through t(key, vars) — no hardcoded strings anywhere else. Pure data: no DOM/three.
// Later agents add keys to BOTH dictionaries.

/** @type {Record<string, string>} */
export const EN = {
  'app.title': 'GOOBY',
  'boot.loading': 'Loading…',
  'boot.saveCorrupt': 'Save data was damaged — started fresh.',

  // --- Toasts / blockers ---
  'toast.tooSleepy': 'Gooby is too sleepy!',
  'toast.sleeping': 'Pssst… Gooby is sleeping',
  'toast.levelUp': 'Level {level}! +{coins} coins',
  'toast.notEnoughCoins': 'Not enough coins',
  'toast.showcaseMissing': 'Gooby showcase not built yet',
  'toast.screenMissing': 'That screen is not built yet',
  'toast.minigameMissing': 'That game is not built yet',

  // --- Minigame framework (§E8) ---
  'mg.countdown.go': 'Go!',
  'mg.hud.score': 'Score',
  'mg.hud.time': 'Time',
  'mg.pause': 'Pause',
  'mg.paused': 'Paused',
  'mg.resume': 'Resume',
  'mg.quit': 'Quit',
  'mg.results.title': 'Results',
  'mg.results.score': 'Score',
  'mg.results.best': 'Best',
  'mg.results.newBest': 'New best!',
  'mg.results.coins': 'Coins',
  'mg.results.daily2x': 'Daily ×2!',
  'mg.results.playAgain': 'Play again',
  'mg.results.home': 'Home',
  'mg.locked': 'Unlocks at level {level}',

  // --- Minigame titles (§C6) ---
  'mg.title.cityDrive': 'Shopping Cruise',
  'mg.title.carrotCatch': 'Carrot Catch',
  'mg.title.bunnyHop': 'Bunny Hop',
  'mg.title.carrotGuard': 'Carrot Guard',
  'mg.title.memoryMatch': 'Memory Match',
  'mg.title.runner': 'Gooby Runner',
  'mg.title.basketBounce': 'Basket Bounce',
  'mg.title.pancakeTower': 'Pancake Tower',
  'mg.title.danceParty': 'Dance Party',
  'mg.title.fishingPond': 'Fishing Pond',
  'mg.title.bubblePop': 'Bubble Pop',
  'mg.title.trampoline': 'Trampoline Tricks',
  'mg.title._smoke': 'Smoke Test',

  // --- Notifications (§C7, exact copy) ---
  'notify.wake.title': 'Gooby',
  'notify.wake.body': 'Gooby just woke up! 🥕',
  'notify.hunger.title': 'Gooby',
  'notify.hunger.body': 'Gooby is hungry! 🍔',
  'notify.fun.title': 'Gooby',
  'notify.fun.body': 'Gooby is getting bored… 🎮',
  'notify.hygiene.title': 'Gooby',
  'notify.hygiene.body': 'Gooby needs a bath! 🛁',
  'notify.daily.title': 'Gooby',
  'notify.daily.body': 'Your daily bonus is waiting! 🎁',

  // --- Shop trip (§C4) ---
  'trip.confirm': 'Drive to the shop?',
  'trip.goHome': 'Go home',
  'trip.crash': 'Ouch!',

  // --- Foods (§C5.1) ---
  'food.carrot': 'Carrot',
  'food.apple': 'Apple',
  'food.banana': 'Banana',
  'food.bread': 'Bread',
  'food.cheese': 'Cheese',
  'food.watermelon': 'Watermelon',
  'food.donut-sprinkles': 'Sprinkle Donut',
  'food.cupcake': 'Cupcake',
  'food.salad': 'Salad',
  'food.ice-cream': 'Ice Cream',
  'food.sandwich': 'Sandwich',
  'food.hot-dog': 'Hot Dog',
  'food.pancakes': 'Pancakes',
  'food.burger': 'Burger',
  'food.pizza': 'Pizza',
  'food.cake': 'Cake',

  // --- Generic UI ---
  'ui.ok': 'OK',
  'ui.yes': 'Yes',
  'ui.no': 'No',
  'ui.later': 'Later',
  'ui.close': 'Close',
  'ui.back': 'Back',
  'ui.coins': 'Coins',
  'ui.level': 'Level',
};

/** @type {Record<string, string>} */
export const DE = {
  'app.title': 'GOOBY',
  'boot.loading': 'Lade…',
  'boot.saveCorrupt': 'Spielstand war beschädigt – neu gestartet.',

  // --- Toasts / blockers ---
  'toast.tooSleepy': 'Gooby ist zu müde!',
  'toast.sleeping': 'Pssst… Gooby schläft',
  'toast.levelUp': 'Level {level}! +{coins} Münzen',
  'toast.notEnoughCoins': 'Nicht genug Münzen',
  'toast.showcaseMissing': 'Gooby-Schaufenster noch nicht gebaut',
  'toast.screenMissing': 'Dieser Bildschirm ist noch nicht gebaut',
  'toast.minigameMissing': 'Dieses Spiel ist noch nicht gebaut',

  // --- Minigame framework (§E8) ---
  'mg.countdown.go': 'Los!',
  'mg.hud.score': 'Punkte',
  'mg.hud.time': 'Zeit',
  'mg.pause': 'Pause',
  'mg.paused': 'Pausiert',
  'mg.resume': 'Weiter',
  'mg.quit': 'Beenden',
  'mg.results.title': 'Ergebnis',
  'mg.results.score': 'Punkte',
  'mg.results.best': 'Rekord',
  'mg.results.newBest': 'Neuer Rekord!',
  'mg.results.coins': 'Münzen',
  'mg.results.daily2x': 'Tagesbonus ×2!',
  'mg.results.playAgain': 'Nochmal',
  'mg.results.home': 'Nach Hause',
  'mg.locked': 'Ab Level {level}',

  // --- Minigame titles (§C6) ---
  'mg.title.cityDrive': 'Einkaufsfahrt',
  'mg.title.carrotCatch': 'Karottenfang',
  'mg.title.bunnyHop': 'Hasenhüpfer',
  'mg.title.carrotGuard': 'Karottenwache',
  'mg.title.memoryMatch': 'Memory',
  'mg.title.runner': 'Gooby-Renner',
  'mg.title.basketBounce': 'Korbwurf',
  'mg.title.pancakeTower': 'Pfannkuchenturm',
  'mg.title.danceParty': 'Tanzparty',
  'mg.title.fishingPond': 'Angelteich',
  'mg.title.bubblePop': 'Blasen-Platzer',
  'mg.title.trampoline': 'Trampolin-Tricks',
  'mg.title._smoke': 'Rauchtest',

  // --- Notifications (§C7, exact copy) ---
  'notify.wake.title': 'Gooby',
  'notify.wake.body': 'Gooby ist aufgewacht! 🥕',
  'notify.hunger.title': 'Gooby',
  'notify.hunger.body': 'Gooby hat Hunger! 🍔',
  'notify.fun.title': 'Gooby',
  'notify.fun.body': 'Gooby langweilt sich… 🎮',
  'notify.hygiene.title': 'Gooby',
  'notify.hygiene.body': 'Gooby braucht ein Bad! 🛁',
  'notify.daily.title': 'Gooby',
  'notify.daily.body': 'Dein Tagesbonus wartet! 🎁',

  // --- Shop trip (§C4) ---
  'trip.confirm': 'Zum Laden fahren?',
  'trip.goHome': 'Nach Hause',
  'trip.crash': 'Autsch!',

  // --- Foods (§C5.1) ---
  'food.carrot': 'Karotte',
  'food.apple': 'Apfel',
  'food.banana': 'Banane',
  'food.bread': 'Brot',
  'food.cheese': 'Käse',
  'food.watermelon': 'Wassermelone',
  'food.donut-sprinkles': 'Streusel-Donut',
  'food.cupcake': 'Cupcake',
  'food.salad': 'Salat',
  'food.ice-cream': 'Eis',
  'food.sandwich': 'Sandwich',
  'food.hot-dog': 'Hotdog',
  'food.pancakes': 'Pfannkuchen',
  'food.burger': 'Burger',
  'food.pizza': 'Pizza',
  'food.cake': 'Kuchen',

  // --- Generic UI ---
  'ui.ok': 'OK',
  'ui.yes': 'Ja',
  'ui.no': 'Nein',
  'ui.later': 'Später',
  'ui.close': 'Schließen',
  'ui.back': 'Zurück',
  'ui.coins': 'Münzen',
  'ui.level': 'Level',
};

const DICTS = { en: EN, de: DE };

/** @type {'en'|'de'} */
let activeLang = 'en';

/**
 * Resolve 'auto' to a concrete language from navigator.language ('de*' → German).
 * @param {string} [pref] 'en' | 'de' | 'auto'
 * @returns {'en'|'de'}
 */
export function resolveLang(pref = 'auto') {
  if (pref === 'en' || pref === 'de') return pref;
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return /^de/i.test(nav) ? 'de' : 'en';
}

/**
 * Set the active language.
 * @param {string} lang 'en' | 'de' | 'auto'
 */
export function setLang(lang) {
  activeLang = resolveLang(lang);
}

/** @returns {'en'|'de'} the active language */
export function getLang() {
  return activeLang;
}

const warned = new Set();

/**
 * Translate a key with optional {var} interpolation.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  let str = DICTS[activeLang][key] ?? EN[key];
  if (str == null) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[strings] missing key: ${key}`);
    }
    return key;
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
