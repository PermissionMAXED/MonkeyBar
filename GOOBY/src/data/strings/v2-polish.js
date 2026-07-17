// V2/G30: strings module (PLAN2 §E0.1-1) — OWNED BY AGENT G30.
// Scope: onboarding additions (post-tutorial quest/garden teaser step §B6) and
// the one-time "What's new in 2.0" panel for migrated v1 saves (PLAN2 §A3
// checklist 12 / §E0.1-6). Every key exists in BOTH EN and DE (§A parity
// rule); src/data/strings.js spreads this module after all v1 entries.

/** @type {Record<string, string>} */
export const EN = {
  // --- onboarding teaser step (§E G30: quest board L2 + garden dot L3) ---
  'ob.teaser.title': 'More to discover!',
  'ob.teaser.quests': 'From level {level}: daily quests! The clipboard button brings 3 fresh tasks every day.',
  'ob.teaser.garden': 'From level {level}: Gooby’s garden! Behind the 5th room dot, real crops grow — plant, water, harvest.',

  // --- one-time "What's new in 2.0" panel (§A3 checklist 12) ---
  'whatsnew.title': 'What’s new in 2.0',
  'whatsnew.sub': 'Welcome back! Your home is just as you left it — and Gooby has been busy:',
  'whatsnew.b1': '9 new minigames — the arcade now has 21',
  'whatsnew.b2': 'A garden behind the 5th room dot: plant, water and harvest real-time crops (level 3)',
  'whatsnew.b3': 'Gooby can get queasy or sick — medicine helps, or drive him to the new vet clinic',
  'whatsnew.b4': 'Daily quests, a sticker album and 33 achievements — level cap raised to 40',
  'whatsnew.b5': '32 foods, lots of new furniture and outfits, and fur-color skins in the shop',
  'whatsnew.b6': 'Real-clock day/night and weather, a stats screen and photo mode',
  'whatsnew.cta': 'Let’s go!',
};

/** @type {Record<string, string>} */
export const DE = {
  // --- onboarding teaser step (§E G30: quest board L2 + garden dot L3) ---
  'ob.teaser.title': 'Es gibt noch mehr!',
  'ob.teaser.quests': 'Ab Level {level}: tägliche Quests! Der Klemmbrett-Button bringt jeden Tag 3 neue Aufgaben.',
  'ob.teaser.garden': 'Ab Level {level}: Goobys Garten! Hinter dem 5. Raumpunkt wächst echtes Gemüse — säen, gießen, ernten.',

  // --- one-time "What's new in 2.0" panel (§A3 checklist 12) ---
  'whatsnew.title': 'Neu in 2.0',
  'whatsnew.sub': 'Willkommen zurück! Dein Zuhause ist wie immer — und Gooby war fleißig:',
  'whatsnew.b1': '9 neue Minispiele — die Arcade hat jetzt 21',
  'whatsnew.b2': 'Ein Garten hinter dem 5. Raumpunkt: säen, gießen und in Echtzeit ernten (Level 3)',
  'whatsnew.b3': 'Gooby kann kränkeln — Medizin hilft, oder fahr ihn zur neuen Tierarztpraxis',
  'whatsnew.b4': 'Tägliche Quests, ein Stickeralbum und 33 Erfolge — Levelgrenze jetzt 40',
  'whatsnew.b5': '32 Leckereien, viele neue Möbel und Outfits, dazu Fellfarben im Shop',
  'whatsnew.b6': 'Echte Tag/Nacht-Zeiten und Wetter, Statistik-Bildschirm und Fotomodus',
  'whatsnew.cta': 'Los geht’s!',
};
