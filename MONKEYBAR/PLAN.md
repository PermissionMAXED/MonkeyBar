# MONKEYBAR — Master Build Plan (v1.0)

**Coordinator instruction:** This document is the shared contract for all build agents. Sections §2 (file structure), §3 (protocol), and §4 (rules) are **binding contracts** — build agents must not deviate from them.

**Vertical slice definition (what must actually work at the end):** A player runs `npm install && npm run dev`, opens the browser, enters a name, browses/creates a lobby, picks a monkey, fills seats with AI bots, and plays a full match of **Monkey Lies** online (server-authoritative, multiple browser tabs can join the same table) in a gorgeous neon jungle bar — with bluffing, calling, dramatic Coconut Cannon penalties, chat/emotes, eliminations, a winner screen, and reconnect support. Everything else (5 other modes, 10 maps, shop) is cleanly scaffolded with real data structures and visible-but-stubbed UI.

---

## 1. Tech Stack (final decisions)

| Layer | Choice | Version pin | Why |
|---|---|---|---|
| Client build | **Vite** | `^6` | Instant dev server, zero config, static build the server can host. |
| Client language | **Vanilla JS (ES modules) + JSDoc types** | — | No transpile risk, no TS config drift across subagents; JSDoc gives editor safety on the protocol. |
| 3D | **three.js** | `^0.170.0` | Everything needed (incl. `EffectComposer`/`UnrealBloomPass` from `three/addons`) in one dependency. |
| UI | **DOM overlay (HTML/CSS)** over the canvas | — | Menus/lobby/HUD in DOM are far higher quality and more reliable than in-canvas UI in one session. |
| Server | **Node.js ≥ 20, `ws`** | `ws ^8` | `ws` is tiny and pairs with the browser's native `WebSocket` — no client lib needed. Server is fully authoritative. |
| Shared code | **npm workspace package `@monkeybar/shared`** | — | One source of truth for protocol constants, validators, rules constants, RNG, roster — imported by both client (via Vite) and server. |
| Audio | **Web Audio API, fully synthesized** | — | No binary assets; silence-tolerant (init on first user gesture). |
| Tests | **`node:test` (built-in)** | — | Zero test-framework dependency; covers shared + server game engine. |
| Lint | **ESLint 9 flat config (minimal)** | `^9` | One devDependency; keeps subagents' output consistent. |
| Dev orchestration | **`scripts/dev.mjs`** (spawns server + Vite via `child_process`) | — | No `concurrently` dependency; one command, reliable. |

**Total runtime dependencies: `three`, `ws`.** Dev dependencies: `vite`, `eslint`.

**Commands (root `package.json`):**
- `npm run dev` → runs server (`node --watch`, port **8080**, WS path `/ws`) + Vite (port **5173**, proxies `/ws` → `ws://localhost:8080`).
- `npm run build` → `vite build` → `client/dist`.
- `npm start` → production: server serves `client/dist` statically **and** `/ws` on port 8080 (single-port deploy).
- `npm test` → `node --test` across `shared` and `server`.
- `npm run lint` → ESLint over all packages.

Client always connects to `(wss|ws)://${location.host}/ws` — works identically in dev (Vite proxy) and prod (same origin).

---

## 2. Repo / File Structure (binding contract)

```
/workspace/MONKEYBAR
├── PLAN.md                          # this document
├── README.md                        # how to install / run / play
├── package.json                     # workspaces: ["shared","server","client"]; root scripts
├── eslint.config.js
├── scripts/
│   └── dev.mjs                      # spawns server + vite together
│
├── shared/                          # @monkeybar/shared  (no dependencies)
│   ├── package.json
│   └── src/
│       ├── protocol.js              # MSG type constants, payload factories, validateClientMsg()
│       ├── constants.js             # timers, deck math, cannon math, limits (§4 values live HERE)
│       ├── monkeys.js               # 16-character roster data (§6)
│       ├── modes.js                 # 6-mode registry (id, name, desc, playable flag)
│       ├── maps.js                  # 10 map defs (palette, sign text, prop layout params)
│       ├── emotes.js                # emote + quick-phrase catalogs
│       ├── rng.js                   # mulberry32 seedable RNG + shuffle
│       └── cards.js                 # buildDeck(playerCount), FRUITS enum
│
├── server/                          # @monkeybar/server  (deps: ws, @monkeybar/shared)
│   ├── package.json
│   └── src/
│       ├── index.js                 # http server (static dist in prod) + WebSocketServer at /ws
│       ├── net/connection.js        # per-socket wrapper: parse, validate, rate-limit, heartbeat
│       ├── net/sessions.js          # playerId+token issue/resume, reconnect hold logic
│       ├── lobby/lobbyManager.js    # room registry, listRooms, quickMatch queue
│       ├── lobby/room.js            # lobby state machine: members, ready, settings, host, spectators
│       ├── game/gameRoom.js         # in-match driver: phases, timers, event broadcast, seat mgmt
│       ├── game/table.js            # seats, turn order, elimination, chips, chambers
│       ├── game/modes/index.js      # mode registry → engine factory
│       ├── game/modes/monkeyLies.js # THE rules engine (pure logic + emitted events)
│       ├── game/modes/stubs.js      # other 5 modes: registered, return NOT_PLAYABLE
│       ├── bots/botManager.js       # attaches brains to bot seats, schedules humanized delays
│       ├── bots/botBrain.js         # decision core: suspicion model, play/call/chip choices
│       ├── bots/personalities.js    # 7 archetype parameter sets + chat/emote behavior tables
│       └── util/log.js
│   └── test/
│       ├── monkeyLies.test.js       # full-match simulations, rule edge cases
│       ├── protocol.test.js
│       └── botBrain.test.js
│
├── client/                          # @monkeybar/client  (deps: three, @monkeybar/shared)
│   ├── package.json
│   ├── vite.config.js               # alias @shared → ../shared/src, /ws proxy
│   ├── index.html                   # <canvas id="scene">, <div id="ui">, loads src/main.js
│   └── src/
│       ├── main.js                  # boot: engine + store + net + UI (contract in §8/P1)
│       ├── net/socket.js            # WS connect, auto-reconnect w/ token, send/on API
│       ├── state/store.js           # tiny event-emitter store: screen, room, game snapshot
│       ├── game/gameClient.js       # maps server events → scene choreography + HUD updates
│       ├── ui/
│       │   ├── screens.js           # screen manager (show/hide, transitions)
│       │   ├── mainMenu.js  lobbyBrowser.js  lobbyScreen.js  characterSelect.js
│       │   ├── hud.js               # in-game: hand, seats, timers, claim banner, call button
│       │   ├── chat.js              # chat log + quick phrases + emote wheel
│       │   ├── settingsScreen.js  shopScreen.js  resultsScreen.js
│       │   └── styles.css
│       ├── three/
│       │   ├── engine.js            # renderer, loop, resize, postfx hookup, quality settings
│       │   ├── lights.js  materials.js  postfx.js       # lighting rig, shared mats, bloom+vignette
│       │   ├── barScene.js          # map builder driven by shared/maps.js configs
│       │   ├── monkeyFactory.js     # procedural monkey rig from roster params
│       │   ├── animations.js        # tween system + canned clips (idle/play/cheer/shock/KO...)
│       │   ├── props.js             # cards, chips, bananas, bottles, Coconut Cannon
│       │   ├── tableView.js         # seat placement, hand fans, played-pile, camera anchors
│       │   ├── cameraRig.js         # seated FP cam, look-targets, trauma shake, penalty dolly
│       │   └── particles.js         # dust, smoke puff, confetti, muzzle flash
│       └── audio/
│           ├── sfx.js               # synthesized one-shots (see §7)
│           └── music.js             # procedural bar-loop sequencer
```

Rule for build agents: **only create/modify files owned by your prompt** (each prompt lists them). `main.js`, `store.js`, and `socket.js` skeletons are created in P1 with fixed exported signatures so later agents plug in without collisions.

---

## 3. Network Protocol (binding contract)

**Wire format:** JSON text frames, envelope `{ "t": "<type>", "p": { ...payload } }`. Client game actions carry `aid` (client-generated id, e.g. `"a"+counter`) which the server echoes in `actionAck`. Server enforces everything; clients are dumb renderers of events.

### 3.1 Shared shapes (JSDoc-typed in `shared/protocol.js`)

```js
Card        = { id: string, fruit: "banana"|"coconut"|"mango"|"golden" } // fruit present only in your hand / reveals
MemberInfo  = { id, name, monkeyId, ready: bool, isBot: bool, personality?: string, isHost: bool }
RoomSummary = { id, name, mode, isPrivate, playerCount, maxPlayers, inGame }
RoomState   = { id, name, code?, hostId, mode, isPrivate, maxPlayers, botFill,
                settings: { turnSeconds, mapId }, members: MemberInfo[], spectatorCount }
SeatPublic  = { seat: number, playerId, name, monkeyId, isBot, connected: bool,
                alive: bool, handCount: number, chips: number, chambersLeft: number }
Snapshot    = { mode, mapId, phase: "dealing"|"playing"|"revealing"|"penalty"|"roundEnd"|"matchEnd",
                roundNo, tableFruit, seats: SeatPublic[], turnSeat, deadline,
                lastPlay: { seat, count } | null,
                lastHolder: bool,                                             // public: current turn is a pending Last-Monkey-Holding turn
                penalty: { seat, chambers, coconuts, chipUsable, deadline } | null,  // public: active penalty window
                yourSeat: number|null, yourHand: Card[]|null, chipUsedByYou: bool }  // spectators: yourSeat=null
```

### 3.2 Client → Server

| `t` | payload `p` | notes |
|---|---|---|
| `hello` | `{ name?, token? }` | first message; token resumes a session |
| `setProfile` | `{ name?, monkeyId? }` | outside game only |
| `listRooms` | `{}` | public rooms |
| `createRoom` | `{ name?, isPrivate, maxPlayers(4-8), mode, botFill: bool }` | creator becomes host; private rooms get 4-char `code` |
| `joinRoom` | `{ roomId?, code? }` | one of the two |
| `leaveRoom` | `{}` | |
| `quickMatch` | `{ mode }` | joins queue; server fills with bots after 5 s |
| `cancelQuick` | `{}` | |
| `ready` | `{ ready: bool }` | |
| `selectMonkey` | `{ monkeyId }` | |
| `addBot` | `{ personality? }` | host only; random personality if omitted |
| `removeBot` | `{ botId }` | host only |
| `updateSettings` | `{ patch: { turnSeconds?, mapId?, mode? } }` | host only |
| `startGame` | `{}` | host only; needs ≥4 seats (bots count), all humans ready |
| `play` | `{ aid, cardIds: string[] }` | 1–3 cards; implicit claim "these are Table Fruit" |
| `callLiar` | `{ aid }` | only when it's your turn and `lastPlay != null` |
| `useChip` | `{ aid }` | only during your own `penalty` window |
| `fireCannon` | `{ aid }` | only valid on your turn when `lastHolder` is pending; fires the cannon at yourself immediately; acked via the existing `actionAck` |
| `chat` | `{ text }` | ≤120 chars, rate-limited 1/s |
| `quickPhrase` | `{ phraseId }` | from `shared/emotes.js` |
| `emote` | `{ emoteId }` | rate-limited 1/2 s |
| `spectate` | `{ roomId }` / `stopSpectate` `{}` | public, in-game rooms |
| `ping` | `{ ts }` | every 10 s |

### 3.3 Server → Client

| `t` | payload `p` | notes |
|---|---|---|
| `welcome` | `{ playerId, token, resumed, roster, modes, maps, emotes, quickPhrases }` | catalogs from shared data |
| `error` | `{ code, msg }` | codes: `BAD_MSG, NOT_FOUND, ROOM_FULL, NOT_HOST, BAD_STATE, NOT_YOUR_TURN, INVALID_CARDS, RATE_LIMIT, NAME_INVALID, NOT_PLAYABLE` |
| `actionAck` | `{ aid, ok, code? }` | for `play/callLiar/useChip` |
| `roomList` | `{ rooms: RoomSummary[] }` | |
| `roomState` | `{ room: RoomState }` | **full snapshot** on every lobby change |
| `leftRoom` | `{ reason: "left"|"kicked"|"closed" }` | |
| `matchFound` | `{ roomId }` | quickmatch result |
| `gameStart` | `{ snapshot: Snapshot }` | also fired for late spectators as `state` |
| `state` | `{ snapshot }` | reconnect / spectate resync |
| `hand` | `{ cards: Card[] }` | **private**; only your own hand, each deal |
| `roundStart` | `{ roundNo, tableFruit, firstSeat, seats: SeatPublic[] }` | |
| `turn` | `{ seat, deadline, canCall: bool, lastHolder: bool }` | `deadline` = epoch ms; `lastHolder` = this turn is a pending Last-Monkey-Holding turn |
| `played` | `{ seat, count, handCount }` | face-down; no card identities |
| `called` | `{ callerSeat, targetSeat }` | |
| `reveal` | `{ targetSeat, cards: Card[], lie: bool, loserSeat }` | only the challenged cards are revealed |
| `lastHolder` | `{ seat }` | "Last Monkey Holding" rule triggered (§4.4) |
| `penalty` | `{ seat, chambers, coconuts, chipUsable, deadline }` | 5 s decision window for the victim |
| `chipUsed` | `{ seat, chambersNow }` | |
| `cannon` | `{ seat, hit: bool }` | client plays the full drama sequence from this |
| `eliminated` | `{ seat }` | |
| `roundEnd` | `{ nextIn }` | ms until next `roundStart` |
| `matchEnd` | `{ winnerSeat, standings: [{ seat, name, place }] }` | |
| `chat` | `{ seat?, name, text }` | seat null for spectators |
| `quickPhrase` | `{ seat, phraseId, name? }` / `emote` `{ seat, emoteId, name? }` | `name` = sender's display name |
| `conn` | `{ seat, connected }` | disconnect/reconnect notice |
| `pong` | `{ ts, serverTs }` | |

### 3.4 Reconnect, spectate, anti-cheat (rules the server enforces)

- **Session:** `welcome` issues `{playerId, token}`; client persists in `localStorage`. On socket drop, client auto-reconnects with backoff (1 s → 8 s) and sends `hello{token}`; server responds `welcome{resumed:true}` + `state` if mid-game.
- **Hold:** a disconnected in-match player's seat is held **60 s**; their turns are auto-played by the *Cautious* bot policy meanwhile. After 60 s the seat converts permanently to a bot for the rest of the match.
- **Spectators** receive all public events, never `hand`; they can `chat` (prefixed 👁 in the log).
- **Anti-cheat basics:** card IDs are opaque and only ever sent to their owner; all actions validated for turn/phase/ownership; deadlines enforced server-side with auto-actions (timeout on turn = server plays 1 matching card if possible, else 1 random card — never auto-calls); chat/emote rate limits; `aid` dedup prevents double-fires.

---

## 4. Game Design

### 4.1 Monkey Lies — the main mode (original design)

**Fantasy:** After hours at a seedy jungle bar, monkeys play a smugglers' card game. The bar's rule for liars is an old brass **Coconut Cannon** bolted to the table. Lose a challenge and it swivels toward *you*.

**Setup (4–8 players):**
- **Deck** (`shared/cards.js`): for `P` players build `P × 5` cards → each of **Banana / Coconut / Mango** appears `floor(P×5×0.3)` times, remainder are **Golden Bananas** (wild). (P=4 → 6/6/6+2 golden = 20 cards; P=8 → 12/12/12+4 = 40.)
- Each round: shuffle, deal **5 cards** to every living player, then announce the **Table Fruit** (random of the three, chosen *after* dealing).
- Every player starts the **match** with: **4 cannon chambers** and **1 Lucky Banana Chip**.

**Turn flow (turn timer 15 s, configurable 10–45):**
1. On your turn you do exactly one of:
   - **PLAY:** place **1–3 cards face down**. The claim is implicit and fixed: *"these are all Table Fruit."* Only the count is public.
   - **CALL — "MONKEY LIES!":** only allowed if the previous play is unresolved (not at round start).
2. After a PLAY, the turn passes clockwise to the next player *with cards*; only that player may call the play.
3. **On CALL:** the played cards flip. If **every** card is the Table Fruit or a Golden Banana → the claim was true, the **caller** loses. Otherwise the **player** lied and loses. Loser faces the **Coconut Cannon** (§4.2), then the round ends.
4. **Empty hand = safe:** shed all 5 cards without being caught and you sit out the rest of the round smirking.
5. **Last Monkey Holding:** if everyone else has emptied their hand, the last player still holding cards must fire the cannon **at themselves** once.

**Rounds & match:** After every cannon shot (hit or miss), the round ends → 3 s intermission → reshuffle, new Table Fruit, redeal to survivors. A coconut hit **eliminates** you (you stay as a table ghost/spectator with chat). **Last monkey standing wins the match.**

### 4.2 The Coconut Cannon (penalty mechanic)

- Personal risk track: you start with **4 chambers, 1 coconut**. Each shot: hit chance = `coconuts / chambers`. **Survive → you permanently lose one empty chamber** (4→3→2→1; at 1 the next shot is certain doom).
- **Lucky Banana Chip:** in your 5 s `penalty` window you may spend your one chip to bolt **+2 temporary chambers** onto this shot only. One chip per match.
- Presentation (client): cannon swivels and locks onto the victim, table lights dim, drumroll, other monkeys lean in/cover eyes, fuse burns... **THOOM** (coconut → monkey flies off stool, KO'd, hat rolls away) or **click/confetti-puff** (survival, table exhales).

### 4.3 Other 5 modes — rule sketches

1. **Banana Dice** — Liar's-dice: 5 jungle dice under a coconut shell each; escalating bids; challenge resolves; loser loses a die; at zero dice you face the cannon.
2. **Coconut Roulette** — pure nerve: a ticking rigged coconut passes around; holder chooses **SHAKE** (risk explosion, earn a chip) or **PASS** (pay a chip). Explosion odds rise with total shakes.
3. **Jungle Poker** — 3-card blind poker with banana-chip stakes; fold-or-showdown; bust your stack → cannon.
4. **King of the Bar** — Monkey Lies, but each round a random **Bar Rule** mutator applies.
5. **Custom Chaos** — host-tunable knobs over the Monkey Lies engine.

---

## 5. Bot AI

**Framework (`server/src/bots/`):** each bot seat gets a `BotBrain` that receives exactly the same filtered events a client would (its own hand + public events only). On its `turn`/`penalty` events, `botManager` schedules the decision after a **humanized delay** = `1.2 s + difficulty × U(0, 3 s)`.

**Suspicion model (core of `botBrain.js`):** when deciding to call, estimate `P(lie)` from: cards played this round vs. how many Table Fruit + wilds *can* remain given the bot's own hand and prior reveals; size of the play; and a per-opponent **bluff prior**. Then call iff `P(lie) + noise > callThreshold`. Memory imperfect via `memErr`.

**The 7 personalities (`personalities.js`):**

| Archetype | bluffRate | callThreshold | risk | memErr | chatty | Signature behavior |
|---|---|---|---|---|---|---|
| **Aggressive** | 0.55 | 0.45 | high | 0.15 | med | Slams 3-card plays, calls on gut |
| **Cautious** | 0.15 | 0.75 | low | 0.10 | low | 1-card truths, hoards chip |
| **Chaotic** | 0.50 ±0.30/round | 0.55 ±0.25 | random | 0.30 | high | Params re-roll each round |
| **Mathematical** | derived from EV | 0.60 exact | med | 0.02 | none | Near-optimal, 10% blunder |
| **Emotional** | 0.35 base | 0.60 base | med | 0.15 | high | Tilt state on survive/caught |
| **Trollish** | 0.60 | 0.50 | high | 0.20 | max | Emote spam, 5% true-call troll |
| **Quiet** | 0.30 | 0.62 | med | 0.05 | none | Mathematical-lite, zero chat |

---

## 6. Characters — 16 Monkeys (`shared/monkeys.js`)

All passives are cosmetic/social or pure-UX. Silhouettes are parameter presets for `monkeyFactory.js`.

| # | Name | Silhouette | Passive |
|---|---|---|---|
| 1 | **Rico "The Fuse"** | wiry capuchin, red mohawk, bandana | *Hot Head* — idle grows twitchier as chambers shrink |
| 2 | **Baron Bananas** | portly gorilla, top hat, monocle | *Rich Reveal* — gold particle glints on flip |
| 3 | **Grandma Guava** | tiny marmoset, shawl, cane | *Sympathy* — table auto "phew" when she survives |
| 4 | **DJ Drift** | long-armed gibbon, headphones | *Drop the Bass* — bass sting on successful bluff |
| 5 | **Sister Cocoa** | langur in nun robes | *Blessing* — cosmetic halo on another player |
| 6 | **Tiny Tantrum** | baby chimp, oversized bib | *Table Rattle* — losing shakes table props |
| 7 | **Professor Peel** | orangutan, cracked glasses, lab coat | *Calculated* — sees own cannon odds as % |
| 8 | **Captain Splinter** | one-eyed mandrill, pirate coat | *Showman* — pirate-flag flourish |
| 9 | **Lady Vine** | elegant colobus, feather boa | *Grace* — card plays in brief slow-mo |
| 10 | **Chugs** | beer-bellied chimp, tank top | *Iron Gut* — survives with a hiccup |
| 11 | **Echo** | lar gibbon, mask markings | *Mimic* — mirrors last table emote |
| 12 | **Shady Slim** | lanky spider monkey, trench coat | *Smokescreen* — smoke wisp off face-down cards |
| 13 | **King Kola** | huge silverback, soda-can crown | *Fanfare* — royal horn on round win |
| 14 | **Nibbles** | hyper squirrel monkey | *Speed Eater* — double-speed deal anim |
| 15 | **Madame Mystery** | veiled monkey, crystal ball | *Prophecy* — publicly "predicts" a winner |
| 16 | **Bolt** | cyber-monkey, neon prosthetic arm | *Glitch* — neon trail on emotes |

**Progression (slice-scope):** all 16 selectable; win counter in `localStorage` unlocks cosmetics; `shopScreen.js` displays catalog with locked/unlocked states (no currency yet).

---

## 7. Art / Visual Plan (all procedural, zero downloaded assets)

- **Monkeys:** bodies from spheres/capsules/boxes in an `Object3D` hierarchy, jointed. Faces = eye & mouth planes using `CanvasTexture` expression atlases drawn in code. Accessories from primitives per roster params.
- **Animation:** hand-written tween/animator driving joint rotations. Canned set: idle sway+breathe+blink, card-play reach, slam, point-and-shout, cheer, sob, shock recoil, cannon-hit flop, survival exhale, emote gestures.
- **Hero bar "The Peeling Parrot":** round dark-wood table under one warm `SpotLight` (PCFSoft shadows); back bar with bottles; hanging vines; neon signs from `TubeGeometry`; ceiling fan; dust motes (`Points`); `FogExp2`. 10 maps in `shared/maps.js`; slice ships hero + 2 palette variants.
- **Rendering:** `ACESFilmicToneMapping`, sRGB, `EffectComposer` with `UnrealBloomPass` + vignette/grain; pixelRatio clamped to 2; quality toggle.
- **Camera:** seated first-person with sway + parallax, eased look-target; penalty sequence = dolly toward cannon, dim, fuse spark, white flash, trauma shake, smoke/confetti.
- **Props:** rounded-box cards with CanvasTexture fruit faces, chips, bananas, brass Coconut Cannon.
- **Audio (synth-only):** `sfx.js` one-shots from oscillators + noise; `music.js` procedural bar loop with intensity param. Gated behind first user gesture; mute toggle.

---

## 8. Build Plan — Sequenced Build Agent Prompts

See coordinator. P1→P2→P3, P4∥P5 (after P1), then P6, then P7. Contracts: PLAN.md wins on ambiguity; never renegotiate protocol after P2.

## 9. Coordinator Notes

- Highest-risk item is P6 choreography timing; event-queue (serialize animations vs fast bot play) is the mitigation.
- Cut line is inside P7 only. P1–P6 are the slice and are not cuttable.

---

## 10. 1.0 Extensions (binding contract; RELEASE_PLAN.md §B transcribed)

All changes ADDITIVE — every §3 message, payload factory, validator, and constant is untouched, so Monkey Lies keeps working at every wave boundary. `shared/` stays the single source of truth.

### 10.1 New client → server messages

| `t` | payload `p` | validation | notes |
|---|---|---|---|
| `modeAction` | `{ aid, action: string, data?: object }` | aid string; action 1–32 chars (`MODE_ACTION_MAX_LENGTH`); data plain object if present | Generic in-match verb for all new modes. Routed like `play`: gameRoom.act → engine.modeAction(seat, action, data); acked via existing `actionAck`; `aid` dedup applies. Unknown/illegal → `BAD_MSG`/`BAD_STATE`/`NOT_YOUR_TURN`. |
| `getProfile` | `{}` | — | Server replies `profile`. |
| `buyCosmetic` | `{ itemId: string }` | itemId string | Success → fresh `profile`; failure → `error{CANT_AFFORD\|LOCKED\|NOT_FOUND}`. |
| `equipCosmetic` | `{ slot: string, itemId: string\|null }` | slot string; itemId string or null | Ownership validated server-side; success → fresh `profile` + `roomState` rebroadcast if in lobby. |

**Mode action verbs** (fixed registry, `shared/src/modeEvents.js` → `MODE_ACTIONS`): Banana Dice `bid {count,face}`, `challenge {}`; Coconut Roulette `shake {}`, `pass {}`; Jungle Poker `fold {}`, `call {}`, `raise {amount}`; King of the Bar `pickFruit {fruit}` (Royal Decree only); Custom Chaos none (uses ML native verbs).

### 10.2 New server → client messages

| `t` | payload `p` | notes |
|---|---|---|
| `modeEvent` | `{ kind: string, ...payload }` | Mode-scoped events via the same onEvent channel, so `evt.seat` targeting gives private delivery (e.g. your dice) like `hand`. Kinds are constants in `shared/src/modeEvents.js`. |
| `profile` | `{ playerId, coins, xp, level, xpToNext, wins, matches, unlocked: string[], equipped: {hat?,skin?,table?,deco?}, stats: {perMode: Record<modeId,{plays,wins}>} }` | Sent right after `welcome`, on `getProfile`, and after any buy/equip/reward. |
| `rewards` | `{ coins, xp, levelUps, newLevel, breakdown: [{reason,coins,xp}] }` | PRIVATE, per human seat, right after `matchEnd`. |

New ERROR_CODES: `CANT_AFFORD`, `LOCKED`.

### 10.3 Shared shape extensions

- `MemberInfo`/`SeatPublic` gain optional `cosmetics: {hat?,skin?,table?,deco?}` (equipped ids only, never full inventory).
- `RoomState.settings` gains optional `chaos: ChaosKnobs` (only when mode === `customChaos`); `updateSettings` patch accepts `chaos` bounded by `shared/src/chaos.js` (`validateKnobs`).
- `turn` event gains optional `actions: string[]` — legal verbs this turn (e.g. `['bid','challenge']`). Monkey Lies omits it (`canCall`/`lastHolder` unchanged).
- Snapshot = Base + per-mode extension. Base (every mode): `mode, mapId, phase, roundNo, seats, turnSeat, deadline, yourSeat`. `phase` is mode-scoped (clients must not assume the ML set). Extensions:
  - **monkeyLies**: unchanged (`tableFruit, lastPlay, lastHolder, penalty, yourHand, chipUsedByYou`)
  - **bananaDice**: snapshot `yourDice: number[]|null, bid: {seat,count,face}|null, totalDice, penalty`; per-seat `dice: number`
  - **coconutRoulette**: snapshot `bomb: {holderSeat, shakes, pExplode}|null`; per-seat `chips` (roulette semantics)
  - **junglePoker**: snapshot `pot, toCall, yourCards: PokerCard[]|null, penalty`; per-seat `stack, bet, folded`
  - **kingOfTheBar**: ML extension + `barRule: {ruleId, name, desc}|null`
  - **customChaos**: ML extension + `knobs: ChaosKnobs`

**Engine contract addendum** (server-internal, in `game/modes/index.js`): every engine exposes `start, onTimeout(kind), getTimer(), snapshotFor(seat), modeAction?(seat, action, data), phase, turnSeat, lastHolderPending (may be constant false), winnerSeat, inspect()`. Timer kind strings are engine-owned; `gameRoom.syncTimer` passes them verbatim. Engines emit only §3.3 types plus `modeEvent`.

### 10.4 New shared modules (dependency-free, unit-tested)

- `shared/src/modeEvents.js` — per-mode `modeEvent` kind constants + the modeAction verb registry (`MODE_ACTIONS`, `isModeAction`).
- `shared/src/dice.js` — `rollDice(n, rng)`, `bidBeats(a, b)` (raise count, or same count + higher face), `countMatching(allDice, face)` (1s wild, count toward every face), `DICE_FACES`.
- `shared/src/poker.js` — 52 cards = 4 fruit suits × ranks 2–14; `buildPokerDeck()`, `evaluateHand(cards3)` → `{rankClass, tiebreak, name}`, class order Trio > Straight Flush > Straight > Flush > Pair > High Card, deterministic/comparable (`compareHands`; A-2-3 plays ace-low).
- `shared/src/chaos.js` — knob schema/bounds/defaults: handSize 3–7 (5), maxPlay 1–4 (3, ≤ handSize), startChambers 2–8 (4), startCoconuts 1–3 (1), chipsPerMatch 0–3 (1), chipBonus 1–4 (2), goldenPerPlayer 0–2; `validateKnobs(patch)` clamps every bound.
- `shared/src/cosmetics.js` — 1.0 catalog (22 items, 4 slots): hat (8: banana_pin, neon_shades, crown_of_the_bar, party_cone, pirate_hat, gold_monocle, chef_toque, propeller_cap), skin (6 fur dyes: midnight, albino, neon_lime, royal_purple, gilded, cherry), table (4 incl. legacy vip_stool re-slotted), deco (4: disco_ball, parrot_perch, golden_cannon, lava_lamp_rail). Each `{id, name, glyph, desc, slot, price, minLevel}`. Prices 50–500, minLevel 1–10.
- `shared/src/constants.js` additions — economy: `COIN_REWARDS = {1:60, 2:35, 3:25, other:15}`, `COIN_PER_GOOD_CALL = 2`, `COIN_PER_SURVIVED_SHOT = 2`, `XP_BASE = 40`, `XP_PER_PLACE_STEP = 15`, `xpToNext(level) = 100 + 50×level`, `LEVEL_CAP = 50`, `REWARD_MIN_ROUNDS = 2`; modes: `DICE_START = 5`, `ROULETTE_START_CHIPS = 3`, `ROULETTE_BASE_P = 0.08`, `ROULETTE_STEP_P = 0.06`, `POKER_START_STACK = 10`, `POKER_ANTE = 1`, `POKER_MAX_RAISES = 2`, `POKER_BUST_REFUND = 3`; misc: `MODE_ACTION_MAX_LENGTH = 32`. No existing constant value changed.

### 10.5 Architecture rulings

1. **Persistence** = server-side JSON file store `server/data/profiles.json` (gitignored; atomic temp+rename, debounced 2 s, load at boot, in-memory fallback). Identity = existing session token→playerId. Losing the token = fresh profile (documented). Bots never earn/persist.
2. **Playability truth** = server registry. `welcome` modes decorated `playable: isModePlayable(id)`. Maps gated by `shared/maps.js` flags (flipped by R8).
