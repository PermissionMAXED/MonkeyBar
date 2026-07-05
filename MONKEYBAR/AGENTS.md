# MONKEYBAR — Agent Guide

MONKEYBAR **1.0** is an online multiplayer monkey bluff party game: a three.js DOM/canvas client and an **authoritative** Node `ws` server, organized as an npm workspace (`shared`, `server`, `client`). All six game modes and all ten maps are live. The full architecture, network protocol (§3), core rules (§4), and the 1.0 extensions (§10: mode/event registry, economy, chaos knobs) live in `PLAN.md` — treat those sections as the source of truth. Player-facing rules and controls are in `README.md`; the shipped feature list is in `CHANGELOG.md`.

## Layout
- `shared/` — `@monkeybar/shared`: protocol constants + `validateClientMsg`, game constants, deck/RNG, poker/dice math, chaos knob schema, `modeEvents.js` (modeAction verbs + modeEvent kinds per mode), monkey roster, modes, maps, emotes, cosmetics. Imported by both server (node resolution) and client (Vite alias `@shared`). No dependencies.
- `server/` — authoritative game server. `net/` (socket + sessions + rate limits), `lobby/` (rooms, quickmatch, spectate), `game/` (gameRoom driver, table, economy payouts, `modes/` — one rules engine per mode), `bots/` (7 personality brains + per-mode strategies), `persist/` (token-keyed JSON profile store).
- `client/` — Vite + three.js. `three/` (procedural engine/scene/monkeys/props/maps/cannon/audio — all procedural, no binary assets), `ui/` (DOM overlay screens + HUD shell + `ui/modes/` per-mode HUDs + `howToPlay.js` per-mode guides), `net/`+`state/` (socket + store), `game/gameClient.js` (event-queue choreographer bridging server events → 3D + HUD, plus `game/modes/` per-mode choreographers).

## Per-mode dev notes
- Every server engine follows the module convention in `server/src/game/modes/index.js`: export `{ MODE_ID, PLAYABLE, createEngine }`; the registry (not the static shared catalog) is the wire truth for `playable`.
- Engines emit only §3.3 event types plus `modeEvent {kind, ...}`; clients act via the native §3.2 verbs or `modeAction {aid, action, data}`. Verbs/kinds are registered in `shared/src/modeEvents.js` — extend that registry rather than inventing ad-hoc frames.
- **monkeyLies** is the parameterized base engine (`rules` + per-round `roundRules` hooks). **kingOfTheBar** (Bar Rule mutators) and **customChaos** (host knobs, `shared/src/chaos.js`) are thin config wrappers over it — put shared rule changes in `monkeyLies.js`, not the wrappers.
- **bananaDice**, **coconutRoulette**, **junglePoker** are standalone engines with mode-scoped phases; keep `snapshotFor(seat)` private-filtering intact (yourDice/yourCards only for the owner; spectators pass `null`).
- Client side: per-mode HUDs register in `client/src/ui/modes/index.js`, 3D choreographers in `client/src/game/modes/index.js`; how-to-play guide text lives in `client/src/ui/howToPlay.js` (interpolates the shared constants — keep it in sync when rules change).
- Reconnect/spectate resync for every mode is covered by `server/test/reconnect.modes.test.js`; concurrent full-stack match runs by `server/test/soak.test.js`. Run them when touching gameRoom, sessions, engines, or bots.

## Cursor Cloud specific instructions
- Standard commands are already defined in `package.json` scripts — use those (`npm run dev`, `npm test`, `npm run lint`, `npm run build`, `npm start`). Don't duplicate them elsewhere.
- `npm run dev` runs BOTH processes via `scripts/dev.mjs`: the server (`node --watch`, port **8080**, WS at `/ws`) and Vite (port **5173**). Open the app at **http://localhost:5173** in dev. The client always connects to `/ws` on its own origin; in dev Vite proxies `/ws` → `ws://localhost:8080`, so both ports must be up.
- `npm start` is production single-port: builds are NOT automatic — run `npm run build` first, then `npm start` serves the built client **and** `/ws` together on **http://localhost:8080**.
- The GPU in this VM is software WebGL (SwiftShader), so the 3D scene renders at low FPS here (~10 fps) but is lightweight and runs fine on real GPUs — do not treat the low FPS as a bug.
- Fast, server-free client checks: open **`http://localhost:5173/?demo=1`** for a standalone 3D scene showcase (no server needed), and **`?mock=1`** for a full UI flow driven by a simulated server. Great for verifying visuals/UI without a live match.
- Tests are `node:test` (no framework). `node --test <dir>` fails on Node 22, so the `test` script uses glob patterns — keep that form when adding suites.
- Set `MONKEYBAR_BOT_DELAY_MS` (ms) to make bots act near-instantly in manual tests; the reconnect/soak suites already tune it internally.
- The server is fully authoritative and clients are dumb renderers: never move rule/validation logic to the client, and never send other players' card/dice identities to a client (only the owner receives their `hand`/`yourDice`/`yourCards`; this is also the anti-cheat model). Do not renegotiate the §3 protocol lightly — server and client are both built against it.
- Bots are server-side and consume only the same filtered per-seat stream a client gets (they cannot see other hands). `botManager` plugs into hooks exposed in `sessions.js`/`gameRoom.js`; disconnected/held seats auto-play via the Cautious policy.
- The `gameClient.js` event queue processes server events serially and awaits timed sequences (e.g. `cannonSequence`) so fast bot play never overlaps animations — preserve this serialization when adding new choreography. `prefs.reducedMotion` (Settings toggle) forces the queue's fast mode; honor it via `tools.wait`/`tools.fastMode` in any new choreographer.
- Player profiles persist to `server/data/profiles.json` (gitignored). Deleting it resets all identities/economy; corrupt JSON is recovered automatically with a warning (never crashes).
