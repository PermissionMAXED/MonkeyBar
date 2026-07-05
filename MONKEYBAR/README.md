# 🍌 MONKEYBAR

An online multiplayer **monkey bluff party game**. After hours at a seedy neon jungle bar, monkeys play a smugglers' card game — and the bar's rule for liars is an old brass **Coconut Cannon** bolted to the table.

- **Client:** three.js (procedural art, no downloaded assets) + DOM overlay UI, built with Vite.
- **Server:** authoritative Node.js (`ws`) — clients are dumb renderers of server events.
- **Shared:** one npm workspace package (`@monkeybar/shared`) is the single source of truth for the protocol, rules constants, deck math, RNG, and all catalogs (monkeys, modes, maps, emotes).

See [`PLAN.md`](./PLAN.md) for the full design & architecture contract.

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
npm test        # node --test across shared/ and server/
npm run lint    # eslint over all packages
```

## How to play — Monkey Lies

*The full design contract lives in [`PLAN.md`](./PLAN.md) §4; this is the player-facing version.*

### The fantasy

After hours at a seedy jungle bar, monkeys play a smugglers' card game. The bar's rule for liars is an old brass **Coconut Cannon** bolted to the table. Lose a challenge and it swivels toward *you*.

### Setup (4–8 players)

- The deck scales with the table: for `P` players it holds `P × 5` cards — **Banana / Coconut / Mango** each appear `floor(P×5×0.3)` times, and the remainder are wild **Golden Bananas** (4 players → 6/6/6 + 2 golden; 8 players → 12/12/12 + 4).
- Each round: shuffle, deal **5 cards** to every living player, then a **Table Fruit** is announced (chosen randomly *after* dealing).
- Every player starts the **match** with **6 cannon chambers** and **1 Lucky Banana Chip**.

### Turn flow (25 s turn timer, host-configurable 15–45 s)

On your turn you do exactly one of:

1. **PLAY** — place **1–3 cards face down**. The claim is implicit and always the same: *"these are all Table Fruit."* Only the count is public.
2. **CALL — "MONKEY LIES!"** — challenge the previous play (only available if there is an unresolved play, and only for the player whose turn it is).

After a PLAY, the turn passes clockwise to the next player *with cards* — only that player may call the play.

**On a CALL** the played cards flip face-up:

- If **every** card is the Table Fruit or a Golden Banana → the claim was true, and the **caller** loses.
- Otherwise the player **lied** and loses.

The loser faces the **Coconut Cannon**, and the round ends after the shot.

### The Coconut Cannon

- Your personal risk track: **6 chambers, 1 coconut**. Each shot hits with chance `coconuts / chambers`.
- **Survive → you permanently lose one empty chamber** (6→5→4→3→2→1 — at 1 chamber the next shot is certain doom).
- **Lucky Banana Chip:** during your 5-second penalty window you may spend your one-per-match chip to bolt **+2 temporary chambers** onto this shot only.
- A coconut hit **eliminates** you — you stay at the table as a ghost spectator with chat.

### Rounds & winning

- **Empty hand = safe:** shed all 5 cards without being caught and you sit out the rest of the round smirking.
- **Last Monkey Holding:** if everyone else has emptied their hand, the last player still holding cards must fire the cannon **at themselves** once.
- After every cannon shot the round ends → 5 s intermission → reshuffle, new Table Fruit, redeal to survivors.
- **Last monkey standing wins the match.**

### Controls

Everything is mouse/touch driven:

| Control | What it does |
|---|---|
| **Click cards** in your hand | Select 1–3 cards (click again to deselect) |
| **PLAY** button | Play the selected cards face down |
| **🐒 MONKEY LIES!** button | Call the previous play (appears only when a call is legal) |
| **🍀 USE LUCKY BANANA CHIP** | +2 temporary chambers during your own penalty window |
| **Chat box** (`Enter` to send) | Table chat — spectators are prefixed 👁 |
| **Quick phrases / 🎭 emote wheel** | Canned barks and radial emote gestures on your monkey |
| **🔧 Settings** | Audio mute + render quality |

Lobby extras: fill empty stools with **AI bots** (7 personalities, from *Cautious* to *Trollish*), pick one of the 3 playable bars (The Peeling Parrot, Neon Nectar, Voodoo Vats), and tune the turn timer as host. Idle at the table too long and the bar assumes you dozed off — **two missed turns** hands your stool to a bot.
