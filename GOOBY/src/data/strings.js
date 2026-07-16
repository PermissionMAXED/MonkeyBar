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

  // --- Home rooms & navigation (§C2, G4) ---
  'room.kitchen': 'Kitchen',
  'room.living': 'Living Room',
  'room.bathroom': 'Bathroom',
  'room.bedroom': 'Bedroom',
  'nav.prevRoom': 'Previous room',
  'nav.nextRoom': 'Next room',

  // --- Gooby showcase (§E9 ?scene=gooby, G3) ---
  'gooby.showcase.emotions': 'Emotions',
  'gooby.showcase.clips': 'Clips',
  'gooby.showcase.toggles': 'States',
  'gooby.showcase.particles': 'Particles',
  'gooby.showcase.tapHint': 'Tap Gooby — regions log here',
  'gooby.showcase.tap': 'Tapped: {region}',
  'gooby.showcase.tris': 'Gooby: {count} tris (scene: {total})',
  'gooby.region.head': 'Head',
  'gooby.region.belly': 'Belly',
  'gooby.region.feet': 'Feet',
  'gooby.region.none': 'nothing',
  'gooby.emotion.neutral': 'Neutral',
  'gooby.emotion.happy': 'Happy',
  'gooby.emotion.ecstatic': 'Ecstatic',
  'gooby.emotion.sad': 'Sad',
  'gooby.emotion.grumpy': 'Grumpy',
  'gooby.emotion.sleepy': 'Sleepy',
  'gooby.emotion.hungry': 'Hungry',
  'gooby.emotion.dizzy': 'Dizzy',
  'gooby.clip.idle': 'Idle',
  'gooby.clip.happyBounce': 'Bounce',
  'gooby.clip.sadSlump': 'Slump',
  'gooby.clip.eat': 'Eat',
  'gooby.clip.sleep': 'Sleep',
  'gooby.clip.wake': 'Wake',
  'gooby.clip.tickle': 'Tickle',
  'gooby.clip.pokeWobble': 'Poke',
  'gooby.clip.dizzy': 'Dizzy Spin',
  'gooby.clip.dance': 'Dance',
  'gooby.clip.wave': 'Wave',
  'gooby.clip.jump': 'Jump',
  'gooby.clip.refuse': 'Refuse',
  'gooby.clip.sitDrive': 'Sit & Drive',
  'gooby.toggle.wet': 'Wet',
  'gooby.toggle.stink': 'Stinky',
  'gooby.toggle.drool': 'Drool',
  'gooby.particle.hearts': 'Hearts',
  'gooby.particle.zzz': 'Zzz',
  'gooby.particle.sparkles': 'Sparkles',
  'gooby.particle.stinkFlies': 'Flies',
  'gooby.particle.dizzyStars': 'Stars',
  'gooby.particle.crumbs': 'Crumbs',
  'gooby.particle.bubbles': 'Bubbles',
  'gooby.particle.confetti': 'Confetti',

  // --- G5: HUD (§D5) ---
  'hud.arcade': 'Arcade',
  'hud.shop': 'Shop',
  'hud.wardrobe': 'Wardrobe',
  'hud.achievements': 'Achievements',
  'hud.settings': 'Settings',
  'hud.mute': 'Sound',
  'stat.hunger': 'Hunger',
  'stat.energy': 'Energy',
  'stat.hygiene': 'Hygiene',
  'stat.fun': 'Fun',
  'toast.comingSoon': 'Coming soon!',

  // --- G5: arcade screen (§C6.3) ---
  'arcade.title': 'Arcade',
  'arcade.best': 'Best {score}',
  'arcade.lockLevel': 'Level {level}',
  'arcade.soon': 'Coming soon',

  // --- G5: care interactions (§C3) ---
  'tray.title': 'Fridge',
  'tray.empty': 'The fridge is empty! Time for a shop trip…',
  'tray.dragHint': 'Drag a snack to Gooby’s mouth!',
  'toast.foodRefused': 'Gooby is full!',
  'wash.suds': 'Suds {pct}%',
  'wash.hint': 'Scrub Gooby with the soap!',
  'wash.rinse': 'Rinse!',
  'toast.washDone': 'Squeaky clean!',
  'toast.toiletCooldown': 'The toilet needs a little break…',
  'toast.toiletNoNeed': 'Gooby doesn’t need to go right now',

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

  // --- Home rooms & navigation (§C2, G4) ---
  'room.kitchen': 'Küche',
  'room.living': 'Wohnzimmer',
  'room.bathroom': 'Badezimmer',
  'room.bedroom': 'Schlafzimmer',
  'nav.prevRoom': 'Voriger Raum',
  'nav.nextRoom': 'Nächster Raum',

  // --- Gooby showcase (§E9 ?scene=gooby, G3) ---
  'gooby.showcase.emotions': 'Emotionen',
  'gooby.showcase.clips': 'Clips',
  'gooby.showcase.toggles': 'Zustände',
  'gooby.showcase.particles': 'Partikel',
  'gooby.showcase.tapHint': 'Tippe Gooby an — Regionen erscheinen hier',
  'gooby.showcase.tap': 'Angetippt: {region}',
  'gooby.showcase.tris': 'Gooby: {count} Dreiecke (Szene: {total})',
  'gooby.region.head': 'Kopf',
  'gooby.region.belly': 'Bauch',
  'gooby.region.feet': 'Füße',
  'gooby.region.none': 'nichts',
  'gooby.emotion.neutral': 'Neutral',
  'gooby.emotion.happy': 'Fröhlich',
  'gooby.emotion.ecstatic': 'Überglücklich',
  'gooby.emotion.sad': 'Traurig',
  'gooby.emotion.grumpy': 'Brummig',
  'gooby.emotion.sleepy': 'Müde',
  'gooby.emotion.hungry': 'Hungrig',
  'gooby.emotion.dizzy': 'Schwindlig',
  'gooby.clip.idle': 'Ruhen',
  'gooby.clip.happyBounce': 'Hüpfer',
  'gooby.clip.sadSlump': 'Hängen',
  'gooby.clip.eat': 'Essen',
  'gooby.clip.sleep': 'Schlafen',
  'gooby.clip.wake': 'Aufwachen',
  'gooby.clip.tickle': 'Kitzeln',
  'gooby.clip.pokeWobble': 'Stupsen',
  'gooby.clip.dizzy': 'Schwindel',
  'gooby.clip.dance': 'Tanzen',
  'gooby.clip.wave': 'Winken',
  'gooby.clip.jump': 'Springen',
  'gooby.clip.refuse': 'Ablehnen',
  'gooby.clip.sitDrive': 'Autositz',
  'gooby.toggle.wet': 'Nass',
  'gooby.toggle.stink': 'Stinkig',
  'gooby.toggle.drool': 'Sabber',
  'gooby.particle.hearts': 'Herzen',
  'gooby.particle.zzz': 'Zzz',
  'gooby.particle.sparkles': 'Funkeln',
  'gooby.particle.stinkFlies': 'Fliegen',
  'gooby.particle.dizzyStars': 'Sterne',
  'gooby.particle.crumbs': 'Krümel',
  'gooby.particle.bubbles': 'Blasen',
  'gooby.particle.confetti': 'Konfetti',

  // --- G5: HUD (§D5) ---
  'hud.arcade': 'Arcade',
  'hud.shop': 'Laden',
  'hud.wardrobe': 'Kleiderschrank',
  'hud.achievements': 'Erfolge',
  'hud.settings': 'Einstellungen',
  'hud.mute': 'Ton',
  'stat.hunger': 'Hunger',
  'stat.energy': 'Energie',
  'stat.hygiene': 'Hygiene',
  'stat.fun': 'Spaß',
  'toast.comingSoon': 'Kommt bald!',

  // --- G5: arcade screen (§C6.3) ---
  'arcade.title': 'Arcade',
  'arcade.best': 'Rekord {score}',
  'arcade.lockLevel': 'Level {level}',
  'arcade.soon': 'Kommt bald',

  // --- G5: care interactions (§C3) ---
  'tray.title': 'Kühlschrank',
  'tray.empty': 'Der Kühlschrank ist leer! Zeit zum Einkaufen…',
  'tray.dragHint': 'Zieh einen Snack zu Goobys Mund!',
  'toast.foodRefused': 'Gooby ist satt!',
  'wash.suds': 'Schaum {pct}%',
  'wash.hint': 'Schrubb Gooby mit der Seife!',
  'wash.rinse': 'Abspülen!',
  'toast.washDone': 'Blitzeblank!',
  'toast.toiletCooldown': 'Die Toilette braucht eine kleine Pause…',
  'toast.toiletNoNeed': 'Gooby muss gerade nicht',

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
