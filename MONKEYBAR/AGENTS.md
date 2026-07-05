# MONKEYBAR — Agent Guide

MONKEYBAR is an online multiplayer monkey bluff party game: a three.js DOM/canvas client and an **authoritative** Node `ws` server, organized as an npm workspace (`shared`, `server`, `client`). The full architecture, network protocol (§3), and Monkey Lies rules (§4) live in `PLAN.md` — treat those sections as the source of truth. How-to-play rules and controls are in `README.md`.

## Layout
- `shared/` — `@monkeybar/shared`: protocol constants + `validateClientMsg`, game constants, deck/RNG, monkey roster, modes, maps, emotes. Imported by both server (node resolution) and client (Vite alias `@shared`). No dependencies.
- `server/` — authoritative game server. `net/` (socket + sessions), `lobby/`, `game/` (gameRoom driver, table, `modes/monkeyLies.js` pure rules engine), `bots/` (7 personality brains).
- `client/` — Vite + three.js. `three/` (procedural engine/scene/monkeys/props/camera/audio — all procedural, no binary assets), `ui/` (DOM overlay screens + HUD), `net/`+`state/` (socket + store), `game/gameClient.js` (event-queue choreographer bridging server events → 3D + HUD).

## Cursor Cloud specific instructions
- Standard commands are already defined in `package.json` scripts — use those (`npm run dev`, `npm test`, `npm run lint`, `npm run build`, `npm start`). Don't duplicate them elsewhere.
- `npm run dev` runs BOTH processes via `scripts/dev.mjs`: the server (`node --watch`, port **8080**, WS at `/ws`) and Vite (port **5173**). Open the app at **http://localhost:5173** in dev. The client always connects to `/ws` on its own origin; in dev Vite proxies `/ws` → `ws://localhost:8080`, so both ports must be up.
- `npm start` is production single-port: it builds are NOT automatic — run `npm run build` first, then `npm start` serves the built client **and** `/ws` together on **http://localhost:8080**.
- The GPU in this VM is software WebGL (SwiftShader), so the 3D scene renders at low FPS here (~10 fps) but is lightweight and runs fine on real GPUs — do not treat the low FPS as a bug.
- Fast, server-free client checks: open **`http://localhost:5173/?demo=1`** for a standalone 3D scene showcase (no server needed), and **`?mock=1`** for a full UI flow driven by a simulated server. Great for verifying visuals/UI without a live match.
- Tests are `node:test` (no framework). `node --test <dir>` fails on Node 22, so the `test` script uses glob patterns — keep that form when adding suites.
- The server is fully authoritative and clients are dumb renderers: never move rule/validation logic to the client, and never send other players' card identities to a client (only the owner receives their `hand`; this is also the anti-cheat model). Do not renegotiate the §3 protocol lightly — server and client are both built against it.
- Bots are server-side and consume only the same filtered per-seat stream a client gets (they cannot see other hands). `botManager` plugs into hooks P2 exposed in `sessions.js`/`gameRoom.js`; disconnected/held seats auto-play via the Cautious policy.
- The `gameClient.js` event queue processes server events serially and awaits timed sequences (e.g. `cannonSequence`) so fast bot play never overlaps animations — preserve this serialization when adding new choreography.
