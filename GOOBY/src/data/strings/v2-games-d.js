// V2/G16: strings module stub (PLAN2 §E0.1-1) — OWNED BY AGENT G24 + G27.
// Scope: minigames D: goobySays, gardenRush, burgerBuild (G24) + veggieChop, goalieGooby (G27) in-game strings (PLAN2 §C1.2).
// G24 + G27 adds every key of that scope here (BOTH EN and DE — §A parity rule);
// nobody else edits this file, and src/data/strings.js itself stays untouched
// after wave 1 (it already spreads this module after all v1 entries).
//
// V2/G24: goobySays / gardenRush / burgerBuild in-game strings (§C1.2 #1–#3).
// V2/G27 appends veggieChop / goalieGooby keys below in wave 4.

/** @type {Record<string, string>} */
export const EN = {
  // --- V2/G24 goobySays (§C1.2 #1) ---
  'mg.says.round': 'Round {n}',
  'mg.says.go': 'Your turn!',
  'mg.says.oops': 'Oops! Wrong pad…',
  'mg.says.timeout': 'Too slow…',
  // --- V2/G24 gardenRush (§C1.2 #2) ---
  'mg.rush.perfect': 'Perfect! +3',
  'mg.rush.early': 'Okay +1',
  'mg.rush.wilted': 'Wilted… −2',
  'mg.rush.weed': 'A weed! −1',
  'mg.rush.morePots': 'More pots!',
  // --- V2/G24 burgerBuild (§C1.2 #3) ---
  'mg.burger.order': 'Order',
  'mg.burger.wrong': 'Not that! −2',
  'mg.burger.complete': 'Burger done! +15',
  'mg.burger.newOrder': 'New order!',
  'mg.burger.speedUp': 'Faster now!',
  'mg.burger.ing.bun': 'Bun',
  'mg.burger.ing.patty': 'Patty',
  'mg.burger.ing.cheese': 'Cheese',
  'mg.burger.ing.tomato': 'Tomato',
  'mg.burger.ing.salad': 'Salad',
  'mg.burger.ing.onion': 'Onion',
  // --- V2/G27 veggieChop (§C1.2 #4) ---
  'mg.chop.combo': 'Combo! +1',
  'mg.chop.junk': 'Yuck! −3',
  'mg.chop.miss': 'Dropped! {n} left…',
  'mg.chop.over': 'Too many dropped…',
  // --- V2/G27 goalieGooby (§C1.2 #7) ---
  'mg.goalie.super': 'Super save! +6',
  'mg.goalie.goal': 'Goal conceded…',
  'mg.goalie.cheer': 'The crowd cheers! Faster!',
  'mg.goalie.over': 'Three goals… all over!',
};

/** @type {Record<string, string>} */
export const DE = {
  // --- V2/G24 goobySays (§C1.2 #1) ---
  'mg.says.round': 'Runde {n}',
  'mg.says.go': 'Du bist dran!',
  'mg.says.oops': 'Ups! Falsches Feld…',
  'mg.says.timeout': 'Zu langsam…',
  // --- V2/G24 gardenRush (§C1.2 #2) ---
  'mg.rush.perfect': 'Perfekt! +3',
  'mg.rush.early': 'Okay +1',
  'mg.rush.wilted': 'Verwelkt… −2',
  'mg.rush.weed': 'Unkraut! −1',
  'mg.rush.morePots': 'Mehr Töpfe!',
  // --- V2/G24 burgerBuild (§C1.2 #3) ---
  'mg.burger.order': 'Bestellung',
  'mg.burger.wrong': 'Das nicht! −2',
  'mg.burger.complete': 'Burger fertig! +15',
  'mg.burger.newOrder': 'Neue Bestellung!',
  'mg.burger.speedUp': 'Jetzt schneller!',
  'mg.burger.ing.bun': 'Brötchen',
  'mg.burger.ing.patty': 'Patty',
  'mg.burger.ing.cheese': 'Käse',
  'mg.burger.ing.tomato': 'Tomate',
  'mg.burger.ing.salad': 'Salat',
  'mg.burger.ing.onion': 'Zwiebel',
  // --- V2/G27 veggieChop (§C1.2 #4) ---
  'mg.chop.combo': 'Combo! +1',
  'mg.chop.junk': 'Igitt! −3',
  'mg.chop.miss': 'Verpasst! Noch {n}…',
  'mg.chop.over': 'Zu viel verpasst…',
  // --- V2/G27 goalieGooby (§C1.2 #7) ---
  'mg.goalie.super': 'Superparade! +6',
  'mg.goalie.goal': 'Tor kassiert…',
  'mg.goalie.cheer': 'Die Menge jubelt! Schneller!',
  'mg.goalie.over': 'Drei Tore… vorbei!',
};
