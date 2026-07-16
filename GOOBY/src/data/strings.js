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
  'trip.confirmBody': 'Hop in the car and drive through town. Costs {energy} energy.',
  'trip.go': "Let's drive!",
  'trip.goHome': 'Go home',
  'trip.crash': 'Ouch!',
  'trip.arrived': 'You made it to the shop! 🎉',
  'trip.towed': 'Oh no — the tow truck brings you to the shop…',
  'trip.shopTitle': 'Shop',
  'trip.shopSoon': 'Shop coming soon!',
  'trip.earned': 'Earned this trip: {coins} coins',

  // --- City drive controls (§C6.1 #1) ---
  'drive.steerLeft': 'Steer left',
  'drive.steerRight': 'Steer right',
  'drive.brake': 'Brake',
  'drive.crashes': '💥 {n}/{max}',

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

  // --- G6: sleep flow (§C1.4) ---
  'toast.fellAsleep': 'Gooby fell asleep… 💤',
  'toast.wokeEarly': 'Gooby is up — and a little grumpy… 😾',
  'toast.notSleepy': 'Gooby is not sleepy yet!',
  'sleep.wakeConfirm.title': 'Wake Gooby up?',
  'sleep.wakeConfirm.body': 'Gooby is sleeping deeply. Waking him early makes him a bit grumpy for a while.',
  'sleep.wakeConfirm.tooEarly': 'Gooby just fell asleep — let him rest at least {min} minutes.',
  'sleep.wakeConfirm.wake': 'Wake up',
  'sleep.wakeConfirm.letSleep': 'Keep sleeping',

  // --- G6: offline catch-up (§E4) ---
  'offline.welcomeBack': 'While you were away: {summary}',
  'offline.wokeUp': 'Gooby woke up!',

  // --- G6: notification permission soft-ask (§C7) ---
  'perm.title': 'Little notes from Gooby?',
  'perm.body': 'Gooby would love to tell you when he wakes up or needs you — just a few gentle notes, never at night.',
  'perm.yes': 'Yes, notify me',
  'perm.grantedToast': 'Gooby will keep you posted! 🔔',

  // --- G8: minigames A (§C6.1 #2–5) ---
  'mg.hop.crash': 'Bonk!',
  'mg.guard.steal': 'A carrot got stolen!',
  'mg.guard.combo': 'Combo! +3',
  'mg.guard.empty': 'All carrots gone!',
  'mg.memory.cleared': 'All pairs found!',

  // --- G6: settings screen (G14 adds audio toggles) ---
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.lang.auto': 'Auto',
  'settings.lang.en': 'English',
  'settings.lang.de': 'German',
  'settings.notifications': 'Notifications',
  'settings.notif.granted': 'On',
  'settings.notif.denied': 'Off',
  'settings.notif.unasked': 'Not set up',
  'settings.notif.later': 'Asking later',
  'settings.notif.enable': 'Enable',
  'settings.notif.disable': 'Turn off',
  'settings.notif.blocked': 'Notifications are blocked — allow them for Gooby in your device settings.',
  'settings.reset': 'Reset save',
  'settings.reset.confirm1': 'Really reset? Tap again!',
  'settings.reset.confirm2': 'Last chance — delete everything?',
  'settings.version': 'GOOBY v{v}',

  // --- G9: minigames B (§C6.1 #6–8) ---
  'mg.runner.stumble': 'Ouch! Careful!',
  'mg.runner.combo': 'Combo ×{mult}!',
  'mg.basket.bank': 'Bank shot! +2',
  'mg.basket.swish': 'Swish streak! +2',
  'mg.basket.hoopMoves': 'The hoop is moving!',
  'mg.pancake.perfect': 'Perfect drop!',
  'mg.pancake.topping': 'Yummy topping! +4',

  // --- G12: wardrobe & outfits (§C5.3) ---
  'wardrobe.title': 'Wardrobe',
  'wardrobe.slot.hat': 'Hats',
  'wardrobe.slot.glasses': 'Glasses',
  'wardrobe.slot.neck': 'Neckwear',
  'wardrobe.owned': 'Owned',
  'wardrobe.equipped': 'Wearing',
  'wardrobe.buy': 'Buy',
  'wardrobe.tryOn': 'Trying on: {name}',
  'wardrobe.shopOnly': 'Buy outfits during a shop trip!',
  'wardrobe.buyHint': 'Tap an item to try it on — Buy adds it to the closet.',
  'wardrobe.equipHint': 'Tap an owned item to put it on or take it off.',
  'toast.outfitBought': '{name} bought!',
  'outfit.partyHat': 'Party Hat',
  'outfit.beanie': 'Beanie',
  'outfit.cap': 'Cap',
  'outfit.topHat': 'Top Hat',
  'outfit.crown': 'Crown',
  'outfit.roundGlasses': 'Round Glasses',
  'outfit.sunglasses': 'Sunglasses',
  'outfit.starGlasses': 'Star Glasses',
  'outfit.scarfRed': 'Red Scarf',
  'outfit.bowtie': 'Bow Tie',
  'outfit.scarfStriped': 'Striped Scarf',

  // --- G12: achievements (§C8.3 — names verbatim from the table) ---
  'ach.title': 'Achievements',
  'ach.unlockedLabel': 'Unlocked!',
  'ach.unlockedToast': '🏆 {name} — +{coins} coins!',
  'ach.firstFeed.name': 'First Nibble',
  'ach.firstFeed.desc': 'Feed Gooby for the first time',
  'ach.feed100.name': 'Chonky Boy',
  'ach.feed100.desc': 'Feed Gooby 100 times',
  'ach.firstWash.name': 'Squeaky Clean',
  'ach.firstWash.desc': 'Give Gooby a wash',
  'ach.wash50.name': 'Bubble Master',
  'ach.wash50.desc': 'Wash Gooby 50 times',
  'ach.firstSleep.name': 'Good Night',
  'ach.firstSleep.desc': 'Tuck Gooby in for a full sleep',
  'ach.sleep20.name': 'Dream Big',
  'ach.sleep20.desc': 'Complete 20 sleeps',
  'ach.firstDrive.name': 'Road Trip!',
  'ach.firstDrive.desc': 'Drive to the shop once',
  'ach.drive25.name': 'City Cruiser',
  'ach.drive25.desc': 'Finish 25 shop trips',
  'ach.noCrash.name': 'Clean Driver',
  'ach.noCrash.desc': 'Reach the shop without a single crash',
  'ach.play12.name': 'Game Hopper',
  'ach.play12.desc': 'Play every one of the 12 minigames',
  'ach.coins1000.name': 'Piggy Bank',
  'ach.coins1000.desc': 'Hold 1000 coins at once',
  'ach.level10.name': 'Double Digits',
  'ach.level10.desc': 'Reach level 10',
  'ach.fullOutfit.name': 'Dress-Up',
  'ach.fullOutfit.desc': 'Wear a hat, glasses and neckwear together',
  'ach.decorator.name': 'Interior Designer',
  'ach.decorator.desc': 'Place 10 non-default decor items',
  'ach.streak7.name': 'Week Buddy',
  'ach.streak7.desc': 'Claim the daily bonus 7 days in a row',
  'ach.tickle100.name': 'Giggle Factory',
  'ach.tickle100.desc': 'Tickle Gooby 100 times',

  // --- G12: daily bonus (§C8.2) ---
  'daily.title': 'Daily Bonus',
  'daily.sub': 'A little gift every day you visit Gooby!',
  'daily.day': 'Day {n}',
  'daily.streak': 'Streak: day {n}',
  'daily.claim': 'Claim!',
  'daily.comeBack': 'Come back tomorrow!',
  'daily.foodBonus': 'a snack surprise',
  'daily.claimedToast': '+{coins} coins — see you tomorrow! 🎁',
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
  'trip.confirmBody': 'Steig ins Auto und fahr durch die Stadt. Kostet {energy} Energie.',
  'trip.go': 'Los geht’s!',
  'trip.goHome': 'Nach Hause',
  'trip.crash': 'Autsch!',
  'trip.arrived': 'Du bist am Laden angekommen! 🎉',
  'trip.towed': 'Oh nein — der Abschleppwagen bringt dich zum Laden…',
  'trip.shopTitle': 'Laden',
  'trip.shopSoon': 'Der Laden öffnet bald!',
  'trip.earned': 'Diesmal verdient: {coins} Münzen',

  // --- City drive controls (§C6.1 #1) ---
  'drive.steerLeft': 'Nach links lenken',
  'drive.steerRight': 'Nach rechts lenken',
  'drive.brake': 'Bremsen',
  'drive.crashes': '💥 {n}/{max}',

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

  // --- G6: sleep flow (§C1.4) ---
  'toast.fellAsleep': 'Gooby ist eingeschlafen… 💤',
  'toast.wokeEarly': 'Gooby ist wach – und etwas brummig… 😾',
  'toast.notSleepy': 'Gooby ist noch gar nicht müde!',
  'sleep.wakeConfirm.title': 'Gooby aufwecken?',
  'sleep.wakeConfirm.body': 'Gooby schläft tief. Wenn du ihn zu früh weckst, ist er eine Weile brummig.',
  'sleep.wakeConfirm.tooEarly': 'Gooby ist gerade erst eingeschlafen – lass ihn mindestens {min} Minuten ruhen.',
  'sleep.wakeConfirm.wake': 'Aufwecken',
  'sleep.wakeConfirm.letSleep': 'Weiterschlafen',

  // --- G6: offline catch-up (§E4) ---
  'offline.welcomeBack': 'Während du weg warst: {summary}',
  'offline.wokeUp': 'Gooby ist aufgewacht!',

  // --- G6: notification permission soft-ask (§C7) ---
  'perm.title': 'Kleine Nachrichten von Gooby?',
  'perm.body': 'Gooby würde dir gern Bescheid geben, wenn er aufwacht oder dich braucht – nur ein paar liebe Nachrichten, nie nachts.',
  'perm.yes': 'Ja, benachrichtige mich',
  'perm.grantedToast': 'Gooby hält dich auf dem Laufenden! 🔔',

  // --- G8: minigames A (§C6.1 #2–5) ---
  'mg.hop.crash': 'Rums!',
  'mg.guard.steal': 'Eine Karotte geklaut!',
  'mg.guard.combo': 'Kombo! +3',
  'mg.guard.empty': 'Alle Karotten weg!',
  'mg.memory.cleared': 'Alle Paare gefunden!',

  // --- G6: settings screen (G14 adds audio toggles) ---
  'settings.title': 'Einstellungen',
  'settings.language': 'Sprache',
  'settings.lang.auto': 'Auto',
  'settings.lang.en': 'Englisch',
  'settings.lang.de': 'Deutsch',
  'settings.notifications': 'Benachrichtigungen',
  'settings.notif.granted': 'An',
  'settings.notif.denied': 'Aus',
  'settings.notif.unasked': 'Nicht eingerichtet',
  'settings.notif.later': 'Später fragen',
  'settings.notif.enable': 'Aktivieren',
  'settings.notif.disable': 'Ausschalten',
  'settings.notif.blocked': 'Benachrichtigungen sind blockiert – erlaube sie für Gooby in den Geräteeinstellungen.',
  'settings.reset': 'Spielstand zurücksetzen',
  'settings.reset.confirm1': 'Wirklich zurücksetzen? Nochmal tippen!',
  'settings.reset.confirm2': 'Letzte Chance – alles löschen?',
  'settings.version': 'GOOBY v{v}',

  // --- G9: minigames B (§C6.1 #6–8) ---
  'mg.runner.stumble': 'Autsch! Vorsicht!',
  'mg.runner.combo': 'Combo ×{mult}!',
  'mg.basket.bank': 'Brettwurf! +2',
  'mg.basket.swish': 'Swish-Serie! +2',
  'mg.basket.hoopMoves': 'Der Korb bewegt sich!',
  'mg.pancake.perfect': 'Perfekt gestapelt!',
  'mg.pancake.topping': 'Leckeres Topping! +4',

  // --- G12: wardrobe & outfits (§C5.3) ---
  'wardrobe.title': 'Kleiderschrank',
  'wardrobe.slot.hat': 'Hüte',
  'wardrobe.slot.glasses': 'Brillen',
  'wardrobe.slot.neck': 'Halsschmuck',
  'wardrobe.owned': 'Gekauft',
  'wardrobe.equipped': 'Angezogen',
  'wardrobe.buy': 'Kaufen',
  'wardrobe.tryOn': 'Anprobe: {name}',
  'wardrobe.shopOnly': 'Outfits kaufst du bei einer Einkaufsfahrt!',
  'wardrobe.buyHint': 'Tippe ein Teil zum Anprobieren – Kaufen legt es in den Schrank.',
  'wardrobe.equipHint': 'Tippe ein gekauftes Teil zum An- oder Ausziehen.',
  'toast.outfitBought': '{name} gekauft!',
  'outfit.partyHat': 'Partyhut',
  'outfit.beanie': 'Mütze',
  'outfit.cap': 'Kappe',
  'outfit.topHat': 'Zylinder',
  'outfit.crown': 'Krone',
  'outfit.roundGlasses': 'Runde Brille',
  'outfit.sunglasses': 'Sonnenbrille',
  'outfit.starGlasses': 'Sternenbrille',
  'outfit.scarfRed': 'Roter Schal',
  'outfit.bowtie': 'Fliege',
  'outfit.scarfStriped': 'Gestreifter Schal',

  // --- G12: achievements (§C8.3 – Namen wörtlich aus der Tabelle) ---
  'ach.title': 'Erfolge',
  'ach.unlockedLabel': 'Freigeschaltet!',
  'ach.unlockedToast': '🏆 {name} – +{coins} Münzen!',
  'ach.firstFeed.name': 'Erster Happen',
  'ach.firstFeed.desc': 'Füttere Gooby zum ersten Mal',
  'ach.feed100.name': 'Moppelhase',
  'ach.feed100.desc': 'Füttere Gooby 100-mal',
  'ach.firstWash.name': 'Blitzeblank',
  'ach.firstWash.desc': 'Bade Gooby einmal',
  'ach.wash50.name': 'Schaummeister',
  'ach.wash50.desc': 'Wasche Gooby 50-mal',
  'ach.firstSleep.name': 'Gute Nacht',
  'ach.firstSleep.desc': 'Bring Gooby für einen ganzen Schlaf ins Bett',
  'ach.sleep20.name': 'Träum groß',
  'ach.sleep20.desc': 'Schließe 20 Schläfchen ab',
  'ach.firstDrive.name': 'Ausfahrt!',
  'ach.firstDrive.desc': 'Fahre einmal zum Laden',
  'ach.drive25.name': 'Stadtflitzer',
  'ach.drive25.desc': 'Schließe 25 Einkaufsfahrten ab',
  'ach.noCrash.name': 'Unfallfrei',
  'ach.noCrash.desc': 'Erreiche den Laden ohne einen einzigen Crash',
  'ach.play12.name': 'Spielehüpfer',
  'ach.play12.desc': 'Spiele jedes der 12 Minispiele',
  'ach.coins1000.name': 'Sparschwein',
  'ach.coins1000.desc': 'Besitze 1000 Münzen auf einmal',
  'ach.level10.name': 'Zweistellig',
  'ach.level10.desc': 'Erreiche Level 10',
  'ach.fullOutfit.name': 'Herausgeputzt',
  'ach.fullOutfit.desc': 'Trage Hut, Brille und Halsschmuck gleichzeitig',
  'ach.decorator.name': 'Einrichter',
  'ach.decorator.desc': 'Platziere 10 besondere Deko-Stücke',
  'ach.streak7.name': 'Wochenkumpel',
  'ach.streak7.desc': 'Hole den Tagesbonus 7 Tage in Folge',
  'ach.tickle100.name': 'Kicherfabrik',
  'ach.tickle100.desc': 'Kitzle Gooby 100-mal',

  // --- G12: daily bonus (§C8.2) ---
  'daily.title': 'Tagesbonus',
  'daily.sub': 'Ein kleines Geschenk für jeden Besuch bei Gooby!',
  'daily.day': 'Tag {n}',
  'daily.streak': 'Serie: Tag {n}',
  'daily.claim': 'Abholen!',
  'daily.comeBack': 'Komm morgen wieder!',
  'daily.foodBonus': 'eine Snack-Überraschung',
  'daily.claimedToast': '+{coins} Münzen – bis morgen! 🎁',
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
