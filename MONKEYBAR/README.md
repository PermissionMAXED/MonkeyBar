# 🍌 MONKEYBAR

An online multiplayer **monkey bluff party game**. After hours at a seedy neon jungle bar, monkeys play smugglers' games of nerve — and the bar's rule for liars is an old brass **Coconut Cannon** bolted to the table.

**1.0** ships **six playable game modes**, **ten bars (maps)**, an economy with a cosmetics shop, AI bot opponents with seven personalities, spectating, reconnects, and per-mode how-to-play guides.

- **Client:** three.js (procedural art, no downloaded assets) + DOM overlay UI, built with Vite.
- **Server:** authoritative Node.js (`ws`) — clients are dumb renderers of server events.
- **Shared:** one npm workspace package (`@monkeybar/shared`) is the single source of truth for the protocol, rules constants, deck math, RNG, and all catalogs (monkeys, modes, maps, emotes, cosmetics).

See [`PLAN.md`](./PLAN.md) for the full design & architecture contract and [`CHANGELOG.md`](./CHANGELOG.md) for the 1.0.0 feature list.

## Requirements

- Node.js **≥ 20** (uses built-in `node:test`, `node --watch`).

## Install

```sh
npm install
```

## Run (development)

```sh
npm run dev
```

This starts both:

- the game server on **http://localhost:8080** (WebSocket at `/ws`), and
- the Vite dev client on **http://localhost:5173** (proxies `/ws` to the server).

Open **http://localhost:5173** in one or more browser tabs.

## Run (production)

```sh
npm run build   # builds client → client/dist
npm start       # server serves client/dist + /ws on port 8080 (single port)
```

Then open **http://localhost:8080**.

## Test & lint

```sh
npm test        # node --test across shared/ and server/ (incl. reconnect + soak suites)
npm run lint    # eslint over all packages
```

## The six games

Every mode ends the same way: **last monkey standing wins**. Each mode has an in-game **how-to-play guide** — press the ⓘ on its mode card, or let the bar offer it the first time you sit down.

### 🍌 Monkey Lies — the main event

*The full design contract lives in [`PLAN.md`](./PLAN.md) §4; this is the player-facing version.*

- The deck scales with the table: for `P` players it holds `P × 5` cards — **Banana / Coconut / Mango** each appear `floor(P×5×0.3)` times, and the remainder are wild **✨ Golden Bananas** (4 players → 6/6/6 + 2 golden; 8 players → 12/12/12 + 4).
- Each round: shuffle, deal **5 cards** to every living player, then a **Table Fruit** is announced (chosen randomly *after* dealing).
- On your turn, either **PLAY 1–3 cards face down** (the claim is implicit and always *"these are all Table Fruit"* — only the count is public) or **CALL — "MONKEY LIES!"** on the previous play (only the next player in turn may call, only while a play is unresolved).
- **On a call** the cards flip: if **every** card is the Table Fruit or a Golden Banana the claim was true and the **caller** loses; otherwise the **liar** loses. The loser faces the Coconut Cannon and the round ends after the shot.
- **Empty hand = safe** for the round. If everyone else sheds first, the **Last Monkey Holding** must fire the cannon at themselves once.
- After every shot: **3 s intermission** → reshuffle, new Table Fruit, redeal to survivors.

**The Coconut Cannon** (shared by every cannon-based mode):

- Your personal risk track: **4 chambers, 1 coconut**. Each shot hits with chance `coconuts ÷ chambers`.
- **Survive → you permanently lose one empty chamber** (4→3→2→1 — at 1 chamber the next shot is certain doom).
- **🍀 Lucky Banana Chip:** during your **5-second** penalty window you may spend your one-per-match chip to bolt **+2 temporary chambers** onto this shot only.
- A coconut hit **eliminates** you — you stay at the table as a ghost spectator with chat.

### 🎲 Banana Dice

Liar's dice under coconut shells. Everyone starts with **5 jungle dice** that re-roll secretly each round. Bids name a COUNT × FACE across the whole table ("four 🥥"); each bid must raise the count or keep it and raise the face. **Ones 🍌 are wild.** Challenge instead of bidding: shells lift, and the wrong monkey loses a die. At **zero dice** you face the Coconut Cannon; survive and the bar spots you one die back.

### 🥥 Coconut Roulette

Pure nerve. Everyone starts with **3 banana chips**. A rigged coconut arms itself in front of a random monkey: **SHAKE** it (+1 chip, risk the boom, keep holding) or **PASS** (pay 1 chip, slide it clockwise). The first shake of a round explodes **8%** of the time and every survived shake adds **+6%**. At 0 chips you *must* shake. An explosion eliminates you on the spot — no cannon, the coconut IS the boom.

### 🃏 Jungle Poker

Three-card blind poker. Everyone starts with a **10-chip** stack and antes **1** per hand for 3 private cards. One betting rotation: FOLD / CALL (0 = check) / RAISE +1–3 (max **2 raises** per hand, all-in allowed when short). One monkey left takes the pot **uncontested** — folds are never revealed. Otherwise showdown: **Trio > Straight Flush > Straight > Flush > Pair > High Card**. Can't cover the ante? The cannon collects — survive and you get a **3-chip refund** to keep playing.

### 👑 King of the Bar

Monkey Lies, but every round one random **Bar Rule** bends the game (never the same twice in a row): 🍺 Happy Hour (2+ card plays), 🙊 Silent Round (no chat/emotes), 🔄 Sticky Stool (reversed turn order), 🍋 Sour Table (Table Fruit re-rolls mid-round), 💣 Hair Trigger (2 coconuts loaded), 👑 Royal Decree (challenge winner picks the next Table Fruit).

### 🧪 Custom Chaos

Monkey Lies under host-tuned knobs, set in the lobby: hand size 3–7, play size 1–4, chambers 2–8, coconuts 1–3, chips 0–3, chip bonus +1–4, guaranteed wilds 0–2 per player. The active knob set is announced at match start and shown in the HUD.

## Turn timer & AFK

Turns default to **15 s**; the host can set **10–45 s** in the lobby. When the timer lapses the server auto-plays a safe action for you. Idle at the table too long and the bar assumes you dozed off — **two missed turns** hands your stool to a bot. Disconnected players get a **60 s reconnect hold** (a bot plays for you meanwhile) before the seat converts permanently.

## The ten bars (maps)

The Peeling Parrot · Neon Nectar · Voodoo Vats · Rumble Reef · Canopy Casino · Frostbite Lounge · Dune Saloon · Temple Taproom · Rooftop Rumpus · Submarine Speakeasy — all ten are playable; the host picks the bar in the lobby. Every bar is fully procedural three.js (no downloaded assets).

## Economy, shop & profiles

- **Banana Coins + XP** pay out after every match: coins by final place (60/35/25/15) plus bonuses per successful call and per survived cannon shot; XP by placement. Matches shorter than 2 rounds pay nothing (anti-farm). Bots never earn.
- The **🛍️ Shop** sells cosmetics in four slots — hats, skins, table skins, and table decorations — for 50–500 coins. Equipped cosmetics render on your monkey and table for everyone at the match.
- **Profile persistence caveat (token-based identity):** your profile (coins, XP, level, unlocks, stats) is keyed to a **session token stored in your browser's localStorage** and persisted server-side in `server/data/profiles.json`. There are no accounts or passwords in 1.0 — clearing browser storage (or switching browsers/devices) starts a fresh profile. Identity survives server restarts via the persisted token binding.

## Controls

Everything is mouse/touch driven:

| Control | What it does |
|---|---|
| **Click cards** in your hand | Select 1–3 cards (click again to deselect) |
| **PLAY** button | Play the selected cards face down |
| **🐒 MONKEY LIES!** button | Call the previous play (appears only when a call is legal) |
| **🍀 USE LUCKY BANANA CHIP** | +2 temporary chambers during your own penalty window |
| **Mode buttons** (bid/challenge, shake/pass, fold/call/raise…) | Per-mode verbs, shown on your turn |
| **Chat box** (`Enter` to send) | Table chat — spectators are prefixed 👁 |
| **Quick phrases / 🎭 emote wheel** | Canned barks and radial emote gestures on your monkey |
| **ⓘ on a mode card / 📖 How to play** | Per-mode rules, controls, and win condition |
| **🔧 Settings** | Audio mute + volume, render quality, reduced motion |

Lobby extras: fill empty stools with **AI bots** (7 personalities, from *Cautious* to *Trollish*), pick any of the 10 bars, and tune the turn timer as host. Spectate any public in-game table from the lobby browser.
