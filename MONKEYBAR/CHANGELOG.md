# Changelog

All notable changes to MONKEYBAR are documented here.

## 1.0.0 — 2026-07-05

The first full release. Everything below is live and covered by the automated
suite (`npm test`: shared + server, including per-mode engine simulations,
wire-level e2e, reconnect drop/rejoin for every mode, and a concurrent soak).

### Game modes (6, all playable)

- **🍌 Monkey Lies** — the main event: implicit Table-Fruit claims, "MONKEY
  LIES!" calls, the Coconut Cannon (4 chambers / 1 coconut, permanent chamber
  loss on survival), Lucky Banana Chip (+2 temporary chambers, one per match),
  empty-hand safety, and the Last-Monkey-Holding forced self-shot.
- **🎲 Banana Dice** — liar's dice under coconut shells: 5 secret dice each,
  count×face bids with wild ones, challenges that cost the loser a die, the
  cannon at zero dice (survive → one die back).
- **🥥 Coconut Roulette** — a rigged coconut passes clockwise: SHAKE (+1 chip,
  8% base explosion odds +6% per survived shake) or PASS (pay 1 chip); at 0
  chips you must shake; explosions eliminate on the spot.
- **🃏 Jungle Poker** — 3-card blind poker: 10-chip stacks, 1-chip antes, one
  betting rotation (fold/call/raise +1–3, max 2 raises, all-in when short),
  uncontested pots stay unrevealed, Trio > Straight Flush > Straight > Flush >
  Pair > High Card, cannon on bust with a 3-chip refund.
- **👑 King of the Bar** — Monkey Lies + a per-round Bar Rule mutator (Happy
  Hour, Silent Round, Sticky Stool, Sour Table, Hair Trigger, Royal Decree),
  never the same rule twice in a row.
- **🧪 Custom Chaos** — Monkey Lies under host-tuned knobs: hand size, play
  size, chambers, coconuts, chips, chip bonus, guaranteed wilds.

### Maps (10, all playable)

The Peeling Parrot, Neon Nectar, Voodoo Vats, Rumble Reef, Canopy Casino,
Frostbite Lounge, Dune Saloon, Temple Taproom, Rooftop Rumpus, Submarine
Speakeasy — each a fully procedural three.js bar (geometry, lighting, props,
skybox; zero downloaded assets).

### Economy, shop & profiles

- Banana Coins + XP paid after every match: place rewards (60/35/25/15) +
  bonuses per good call and survived shot; XP by placement with levels up to
  50; matches under 2 rounds pay nothing; bots never earn.
- Cosmetics shop: hats, skins, table skins, and table decorations (50–500
  coins), rendered in-match for everyone.
- Token-based identity: profiles persist server-side (`server/data/
  profiles.json`, atomic debounced writes, corruption-safe recovery) keyed to
  the browser's session token; identity survives server restarts.

### Multiplayer robustness

- Authoritative server; private filtering (only you ever receive your hand /
  dice / hole cards — spectators and other seats never do).
- Reconnects: 60 s seat hold with auto-play, full mid-phase state resync in
  all 6 modes; spectating public tables with live resync.
- AFK handling: 2 consecutive missed turns convert the seat to a bot
  (disconnected players are exempt — the hold covers them).
- Rate limits (global 20 msg/s ceiling; chat 1/s; emote 1/2 s), `aid`
  deduplication on every game action including `modeAction`, strict wire
  validation of every client frame.
- AI bots with 7 personalities drive empty stools, quickmatch fill, and
  abandoned seats — fed only the same filtered per-seat stream a client gets.

### Client & UX

- three.js procedural presentation: 8 monkey characters with cosmetics,
  seat/table choreography, the full Coconut Cannon sequence, per-mode
  choreographers, positional audio + music intensity, quality toggle.
- Per-mode HUDs (cards, dice bid composer, shake/pass, poker actions, Bar
  Rule banner, chaos knob summary), lobby browser, quickmatch, private rooms
  with 4-char codes, chat + quick phrases + emote wheel, results podium with
  reward breakdown, profile & stats screen.
- **How-to-play guides (new in R10):** one overlay per mode (rules, controls,
  win condition, sourced from the live rules constants) — reachable from the
  main menu, from ⓘ buttons on every quick-match mode card, and auto-offered
  the first time you ever sit down in a mode.
- **Reduced-motion setting (new in R10):** skips long animations/choreography
  while keeping the authoritative HUD state instant.
- Quick-match search state now recovers cleanly from server errors (no more
  stuck spinner) (R10).

### Versioning

- All workspace packages (`monkeybar`, `@monkeybar/shared`,
  `@monkeybar/server`, `@monkeybar/client`) now report **1.0.0**.
