// V2/G16: strings module stub (PLAN2 §E0.1-1) — OWNED BY AGENT G22.
// Scope: content & shop 2.0: furniture/wallpapers/floors/outfits/skins shop surfaces (PLAN2 §C8).
// G22 adds every key of that scope here (BOTH EN and DE — §A parity rule);
// nobody else edits this file, and src/data/strings.js itself stays untouched
// after wave 1 (it already spreads this module after all v1 entries).
//
// V2/G22: filled in — the §C8.1 +23 indoor furniture names, the §C8.3 garden
// decor names, §C8.2 wallpaper/floor colorways, the 9 §C8.4 outfits, and the
// shop-surface chrome (§C7 food filters + Care row, §C8.5 Skins tab, the
// wardrobe „Fell"/"Fur" category). Skin display names (`skin.*`) are G16's
// (v2-core.js); crop names (`crop.*`) too — referenced, not duplicated.

/** @type {Record<string, string>} */
export const EN = {
  // --- shop chrome: food filters (§C7), Care row, furniture room filter ---
  'shop.filter.all': 'All',
  'shop.filter.healthy': 'Healthy',
  'shop.filter.treats': 'Treats',
  'shop.care.title': 'Care',
  'shop.care.hint': 'For a healthy Gooby — medicine, fertilizer & seeds.',
  'shop.item.medicine': 'Medicine',
  'shop.item.fertilizer': 'Fertilizer',
  'shop.seedName': '{name} Seeds',
  'shop.lvl': 'Lv. {level}',
  'shop.room.garden': 'Garden',
  // --- Skins tab (§C8.5, L5 gate §B6) + wardrobe Fur category ---
  'shop.tab.skins': 'Skins',
  'shop.skins.pitch': 'Fur colors for Gooby — try them on live!',
  'shop.skins.needLevel': 'Fur skins unlock at level {level}',
  'wardrobe.slot.fur': 'Fur',

  // --- new decor slots (decorate-panel titles: t('slot.<id>')) ---
  'slot.sideboard': 'Sideboard',
  'slot.ceilingFan': 'Ceiling',
  'slot.bar': 'Bar Corner',
  'slot.washer': 'Laundry Corner',
  'slot.sideTable': 'Side Table',
  'slot.floorClutter': 'Floor Decor',
  'slot.gardenBench': 'Bench',
  'slot.gardenGnome': 'Gnome Spot',
  'slot.birdbath': 'Birdbath Spot',
  'slot.flowerBed': 'Flower Bed',
  'slot.gardenPath': 'Garden Path',
  'slot.gardenTree': 'Tree',

  // --- §C8.1 indoor furniture (+23) ---
  'furn.loungeChair': 'Lounge Chair',
  'furn.tableCoffee': 'Coffee Table',
  'furn.tableCoffeeGlass': 'Glass Coffee Table',
  'furn.cabinetTelevision': 'TV Cabinet',
  'furn.radio': 'Retro Radio',
  'furn.speaker': 'Speaker',
  'furn.ceilingFan': 'Ceiling Fan',
  'furn.artSkyline': 'Skyline Canvas',
  'furn.artRainbow': 'Rainbow Canvas',
  'furn.kitchenMicrowave': 'Microwave',
  'furn.kitchenBar': 'Breakfast Bar',
  'furn.stoolBar': 'Bar Stool Set',
  'furn.washer': 'Washing Machine',
  'furn.shower': 'Corner Shower',
  'furn.sideTable': 'Side Table',
  'furn.sideTableDrawers': 'Drawer Side Table',
  'furn.cabinetBed': 'Bedside Cabinet',
  'furn.cabinetBedDrawer': 'Bedside Drawer',
  'furn.coatRackStanding': 'Coat Rack',
  'furn.pillow': 'Cozy Pillow',
  'furn.pillowBlue': 'Blue Pillow',
  'furn.books': 'Book Stack',
  'furn.trashcan': 'Waste Bin',

  // --- §C8.3 garden decor (6 slots, 11 items) ---
  'furn.benchWood': 'Wooden Bench',
  'furn.benchPastel': 'Pastel Bench',
  'furn.gnome': 'Garden Gnome',
  'furn.gnomeGold': 'Golden Gnome',
  'furn.birdbath': 'Birdbath',
  'furn.flowerBedWild': 'Wildflowers',
  'furn.flowerBedRose': 'Rose Bed',
  'furn.pathDirt': 'Dirt Path',
  'furn.pathStones': 'Stone Path',
  'furn.treeDefault': 'Garden Tree',
  'furn.treeBlossom': 'Blossom Tree',

  // --- §C8.2 wallpapers (+4) & floors (+3) ---
  'wp.sunset': 'Sunset',
  'wp.meadow': 'Meadow',
  'wp.candy': 'Candy Stripes',
  'wp.ocean': 'Ocean',
  'floor.marble': 'Marble',
  'floor.walnut': 'Walnut',
  'floor.terracotta': 'Terracotta',

  // --- §C8.4 outfits (+9) ---
  'outfit.strawHat': 'Straw Hat',
  'outfit.chefHat': 'Chef Hat',
  'outfit.flowerCrown': 'Flower Crown',
  'outfit.wizardHat': 'Wizard Hat',
  'outfit.heartGlasses': 'Heart Glasses',
  'outfit.monocle': 'Monocle',
  'outfit.bandana': 'Bandana',
  'outfit.bellCollar': 'Bell Collar',
  'outfit.cape': 'Hero Cape',
};

/** @type {Record<string, string>} */
export const DE = {
  // --- shop chrome: food filters (§C7), Care row, furniture room filter ---
  'shop.filter.all': 'Alle',
  'shop.filter.healthy': 'Gesund',
  'shop.filter.treats': 'Süßkram',
  'shop.care.title': 'Pflege',
  'shop.care.hint': 'Für einen gesunden Gooby – Medizin, Dünger & Samen.',
  'shop.item.medicine': 'Medizin',
  'shop.item.fertilizer': 'Dünger',
  'shop.seedName': '{name}-Samen',
  'shop.lvl': 'Lv. {level}',
  'shop.room.garden': 'Garten',
  // --- Skins tab (§C8.5, L5 gate §B6) + wardrobe Fur category ---
  'shop.tab.skins': 'Skins', // §C8.5 calls the tab „Skins" in DE too
  'shop.skins.pitch': 'Fellfarben für Gooby – probiere sie live an!',
  'shop.skins.needLevel': 'Fellfarben gibt es ab Level {level}',
  'wardrobe.slot.fur': 'Fell',

  // --- new decor slots (decorate-panel titles: t('slot.<id>')) ---
  'slot.sideboard': 'Sideboard',
  'slot.ceilingFan': 'Decke',
  'slot.bar': 'Bar-Ecke',
  'slot.washer': 'Waschecke',
  'slot.sideTable': 'Beistelltisch',
  'slot.floorClutter': 'Bodendeko',
  'slot.gardenBench': 'Bank',
  'slot.gardenGnome': 'Zwergenplatz',
  'slot.birdbath': 'Vogelbad-Platz',
  'slot.flowerBed': 'Blumenbeet',
  'slot.gardenPath': 'Gartenweg',
  'slot.gardenTree': 'Baum',

  // --- §C8.1 indoor furniture (+23) ---
  'furn.loungeChair': 'Sessel',
  'furn.tableCoffee': 'Couchtisch',
  'furn.tableCoffeeGlass': 'Glas-Couchtisch',
  'furn.cabinetTelevision': 'TV-Schrank',
  'furn.radio': 'Retro-Radio',
  'furn.speaker': 'Lautsprecher',
  'furn.ceilingFan': 'Deckenventilator',
  'furn.artSkyline': 'Skyline-Bild',
  'furn.artRainbow': 'Regenbogen-Bild',
  'furn.kitchenMicrowave': 'Mikrowelle',
  'furn.kitchenBar': 'Frühstückstheke',
  'furn.stoolBar': 'Barhocker-Set',
  'furn.washer': 'Waschmaschine',
  'furn.shower': 'Eckdusche',
  'furn.sideTable': 'Beistelltisch',
  'furn.sideTableDrawers': 'Beistelltisch mit Schublade',
  'furn.cabinetBed': 'Nachtschrank',
  'furn.cabinetBedDrawer': 'Nachtschrank mit Schublade',
  'furn.coatRackStanding': 'Garderobenständer',
  'furn.pillow': 'Kuschelkissen',
  'furn.pillowBlue': 'Blaues Kissen',
  'furn.books': 'Bücherstapel',
  'furn.trashcan': 'Papierkorb',

  // --- §C8.3 garden decor (6 slots, 11 items) ---
  'furn.benchWood': 'Holzbank',
  'furn.benchPastel': 'Pastellbank',
  'furn.gnome': 'Gartenzwerg',
  'furn.gnomeGold': 'Goldener Gartenzwerg',
  'furn.birdbath': 'Vogelbad',
  'furn.flowerBedWild': 'Wildblumen',
  'furn.flowerBedRose': 'Rosenbeet',
  'furn.pathDirt': 'Erdweg',
  'furn.pathStones': 'Steinweg',
  'furn.treeDefault': 'Gartenbaum',
  'furn.treeBlossom': 'Blütenbaum',

  // --- §C8.2 wallpapers (+4) & floors (+3) ---
  'wp.sunset': 'Sonnenuntergang',
  'wp.meadow': 'Wiese',
  'wp.candy': 'Zuckerstreifen',
  'wp.ocean': 'Ozean',
  'floor.marble': 'Marmor',
  'floor.walnut': 'Walnuss',
  'floor.terracotta': 'Terrakotta',

  // --- §C8.4 outfits (+9) ---
  'outfit.strawHat': 'Strohhut',
  'outfit.chefHat': 'Kochmütze',
  'outfit.flowerCrown': 'Blumenkranz',
  'outfit.wizardHat': 'Zauberhut',
  'outfit.heartGlasses': 'Herzbrille',
  'outfit.monocle': 'Monokel',
  'outfit.bandana': 'Halstuch',
  'outfit.bellCollar': 'Glöckchenhalsband',
  'outfit.cape': 'Heldenumhang',
};
