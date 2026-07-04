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

4–8 monkeys sit at the bar table. Each round everyone gets **5 cards** (Banana / Coconut / Mango, plus wild **Golden Bananas**), then a **Table Fruit** is announced.

On your turn:

- **PLAY** 1–3 cards face down — the claim is always implicit: *"these are all Table Fruit."* Only the count is public.
- **CALL — "MONKEY LIES!"** — challenge the previous play. The cards flip: if every card is Table Fruit or Golden Banana, the *caller* loses; otherwise the liar loses.

The loser faces the **Coconut Cannon**: 6 chambers, 1 coconut, hit chance `coconuts / chambers`. Survive and you permanently lose an empty chamber. You get one **Lucky Banana Chip** per match to bolt +2 temporary chambers onto a single shot.

Empty your hand without being caught and you're safe for the round. Take a coconut to the face and you're eliminated. **Last monkey standing wins.**

Fill empty seats with AI bots (7 personalities, from *Cautious* to *Trollish*), chat, spam emotes, and enjoy the drama.
