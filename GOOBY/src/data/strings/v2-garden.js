// V2/G19: garden strings (PLAN2 §C2/§C11.3) — OWNED BY AGENT G19.
// Scope: garden space UI: 5th room, plots, seed/sell panels, sky, forecast
// chip. Crop/food NAMES live in v2-core.js (G16 — crop.<id>/food.<id>);
// everything garden-flow-specific is here, BOTH EN and DE (§A parity rule).

/** @type {Record<string, string>} */
export const EN = {
  'room.garden': 'Garden',

  // §B6 L3 padlock teaser
  'garden.locked': 'The garden opens at level {level}! 🔒',

  // seed picker (§C2.2)
  'garden.seeds.title': 'Plant a seed',
  'garden.seeds.hint': 'Pick a seed for this plot',
  'garden.seeds.owned': '×{n}',
  'garden.seeds.plant': 'Plant',
  'garden.seeds.buy': 'Buy {price}c',
  'garden.seeds.locked': 'Level {level}',
  'garden.seeds.growTime': '{min} min',
  'garden.seeds.noCoins': 'Not enough coins!',
  'garden.planted': '{name} planted! 🌱',

  // watering (§C2.2/§C2.3)
  'garden.watered': 'Watered! 💧',
  'garden.alreadyWatered': 'Already watered 💧',
  'garden.waterHint': 'Drag the watering can over a plot!',
  'garden.rainWatered': 'The rain is doing the watering ☔',

  // harvest (§C2.2)
  'garden.ready': '{name} is ready to harvest! 🌟',
  'garden.harvested': '+{qty} {emoji} {name}!',
  'garden.notReady': 'Still growing… 🌱',
  'garden.sticker': 'New sticker: {name}! ⭐',

  // fertilizer (§C2.2)
  'garden.fertilized': 'Fertilized! ✨ +25% growth',
  'garden.alreadyFertilized': 'This planting is already fertilized',
  'garden.fertilizeEmpty': 'Nothing planted here yet',
  'garden.fert.title': 'Fertilizer',
  'garden.fert.body': 'Instantly boosts a growing plot by 25%. Once per planting.',
  'garden.fert.owned': 'In your shed: ×{n}',
  'garden.fert.buy': 'Buy for {price}c',
  'garden.fert.hint': 'Drag the bag onto a growing plot!',

  // compost sell sheet (§C2.2)
  'garden.sell.title': 'Compost bin — sell harvest',
  'garden.sell.empty': 'Nothing to sell — harvest some crops first!',
  'garden.sell.one': 'Sell 1',
  'garden.sell.all': 'Sell all',
  'garden.sell.price': '{price}c each',
  'garden.sold': 'Sold! +{coins}c 🪙',

  // plot purchase (§B6)
  'garden.plot.title': 'Buy this plot?',
  'garden.plot.body': 'A new plot for your crops.',
  'garden.plot.price': 'Price: {price}c',
  'garden.plot.buy': 'Buy plot',
  'garden.plot.locked': 'Unlocks at level {level}',
  'garden.plot.bought': 'New plot! 🌱',
  'garden.plot.noCoins': 'Not enough coins!',
  'garden.plot.forSale': 'FOR SALE',

  // forecast chip + sheet (§C11.3)
  'garden.forecast.title': 'Weather',
  'garden.forecast.now': 'Now',
  'garden.forecast.next': 'Next',
  'garden.forecast.range': '{state} from {from}–{to} h',
  'garden.forecast.rainTip': 'Rain waters your plots for free!',
  'weather.clear': 'Sunny',
  'weather.cloudy': 'Cloudy',
  'weather.rain': 'Rain',
};

/** @type {Record<string, string>} */
export const DE = {
  'room.garden': 'Garten',

  'garden.locked': 'Der Garten öffnet ab Level {level}! 🔒',

  'garden.seeds.title': 'Samen pflanzen',
  'garden.seeds.hint': 'Wähle einen Samen für dieses Beet',
  'garden.seeds.owned': '×{n}',
  'garden.seeds.plant': 'Pflanzen',
  'garden.seeds.buy': 'Kaufen {price}M',
  'garden.seeds.locked': 'Level {level}',
  'garden.seeds.growTime': '{min} Min.',
  'garden.seeds.noCoins': 'Nicht genug Münzen!',
  'garden.planted': '{name} gepflanzt! 🌱',

  'garden.watered': 'Gegossen! 💧',
  'garden.alreadyWatered': 'Schon gegossen 💧',
  'garden.waterHint': 'Zieh die Gießkanne über ein Beet!',
  'garden.rainWatered': 'Der Regen gießt gerade ☔',

  'garden.ready': '{name} ist erntereif! 🌟',
  'garden.harvested': '+{qty} {emoji} {name}!',
  'garden.notReady': 'Wächst noch… 🌱',
  'garden.sticker': 'Neuer Sticker: {name}! ⭐',

  'garden.fertilized': 'Gedüngt! ✨ +25 % Wachstum',
  'garden.alreadyFertilized': 'Dieses Beet ist schon gedüngt',
  'garden.fertilizeEmpty': 'Hier wächst noch nichts',
  'garden.fert.title': 'Dünger',
  'garden.fert.body': 'Beschleunigt ein wachsendes Beet sofort um 25 %. Einmal pro Aussaat.',
  'garden.fert.owned': 'Im Schuppen: ×{n}',
  'garden.fert.buy': 'Kaufen für {price}M',
  'garden.fert.hint': 'Zieh den Sack auf ein wachsendes Beet!',

  'garden.sell.title': 'Komposttonne — Ernte verkaufen',
  'garden.sell.empty': 'Nichts zu verkaufen — ernte erst etwas!',
  'garden.sell.one': '1 verkaufen',
  'garden.sell.all': 'Alle verkaufen',
  'garden.sell.price': 'je {price}M',
  'garden.sold': 'Verkauft! +{coins}M 🪙',

  'garden.plot.title': 'Dieses Beet kaufen?',
  'garden.plot.body': 'Ein neues Beet für dein Gemüse.',
  'garden.plot.price': 'Preis: {price}M',
  'garden.plot.buy': 'Beet kaufen',
  'garden.plot.locked': 'Öffnet ab Level {level}',
  'garden.plot.bought': 'Neues Beet! 🌱',
  'garden.plot.noCoins': 'Nicht genug Münzen!',
  'garden.plot.forSale': 'ZU VERKAUFEN',

  'garden.forecast.title': 'Wetter',
  'garden.forecast.now': 'Jetzt',
  'garden.forecast.next': 'Danach',
  'garden.forecast.range': '{state} von {from}–{to} Uhr',
  'garden.forecast.rainTip': 'Regen gießt deine Beete gratis!',
  'weather.clear': 'Sonnig',
  'weather.cloudy': 'Bewölkt',
  'weather.rain': 'Regen',
};
