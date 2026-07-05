# MONKEYBAR — 1.0 Full-Release Plan (Coordinator Master Document)

**Status:** binding for all build agents, additive to `PLAN.md` (whose §2/§3/§4 remain in force). Where this document extends the protocol or file map, prompt R1 writes those extensions into `PLAN.md §10` so the repo contract stays single-source.

---

## A. Current state vs 1.0 gaps (verified against code)

Works today: Monkey Lies online (authoritative, seedable engine), 7-personality bots (cannot cheat), full lobby stack (public/private, codes, mode-keyed quickmatch + bot-fill, spectate, AFK→bot, 60s reconnect hold), procedural 3D client (16 monkeys, 3 bars, cannon drama, event-queue choreographer, DOM HUD, chat/emotes), tests/tooling (node:test, ESLint, Vite, `?demo=1`/`?mock=1`).

Gaps to 1.0: 5 of 6 modes are `NOT_PLAYABLE` stubs; 7 of 10 maps locked (configs exist, extraProps builders missing); no economy (localStorage win counter only); cosmetics don't render; client mode-coupled to Monkey Lies; release hygiene (version 0.1.0, README drift vs constants, no CHANGELOG, no per-mode how-to-play).

Reuse (verified): `gameRoom` and `botManager` are already mode-agnostic in their driver/wiring contracts; the client unlocks itself from `welcome` catalog `playable` flags; the event queue serializes drama with fast-mode catch-up.

---

## B. Protocol / contract additions (binding; R1 writes into PLAN.md §10)

`shared/` stays single source of truth. All changes ADDITIVE — existing §3 messages/validators untouched so Monkey Lies keeps working at every wave boundary.

### B.1 New client → server messages
| t | payload p | validation | notes |
|---|---|---|---|
| `modeAction` | `{ aid, action:string, data?:object }` | aid string; action 1–32 chars; data plain object if present | Generic in-match verb for all new modes. Routed like `play`: gameRoom.act → engine.modeAction(seat, action, data); acked via existing `actionAck`; aid dedup applies. Unknown/illegal → BAD_MSG/BAD_STATE/NOT_YOUR_TURN. |
| `getProfile` | `{}` | — | Server replies `profile`. |
| `buyCosmetic` | `{ itemId:string }` | itemId string | Success → fresh `profile`; failure → error{CANT_AFFORD|LOCKED|NOT_FOUND}. |
| `equipCosmetic` | `{ slot:string, itemId:string|null }` | slot string; itemId string or null | Ownership validated server-side; success → fresh profile + roomState rebroadcast if in lobby. |

Mode action verbs (fixed registry, `shared/modeEvents.js`): Banana Dice `bid {count,face}`,`challenge {}`; Coconut Roulette `shake {}`,`pass {}`; Jungle Poker `fold {}`,`call {}`,`raise {amount}`; King of the Bar `pickFruit {fruit}` (Royal Decree only); Custom Chaos none (uses ML native verbs).

### B.2 New server → client messages
| t | payload p | notes |
|---|---|---|
| `modeEvent` | `{ kind:string, ...payload }` | Mode-scoped events via same onEvent channel, so `evt.seat` targeting gives private delivery (e.g. your dice) like `hand`. Kinds are constants in `shared/modeEvents.js`. |
| `profile` | `{ playerId, coins, xp, level, xpToNext, wins, matches, unlocked:string[], equipped:{hat?,skin?,table?,deco?}, stats:{perMode:Record<modeId,{plays,wins}>} }` | Sent right after `welcome`, on getProfile, and after any buy/equip/reward. |
| `rewards` | `{ coins, xp, levelUps, newLevel, breakdown:[{reason,coins,xp}] }` | PRIVATE, per human seat, right after matchEnd. |

New ERROR_CODES: `CANT_AFFORD`, `LOCKED`.

### B.3 Shared shape extensions
- `MemberInfo`/`SeatPublic` gain optional `cosmetics:{hat?,skin?,table?,deco?}` (equipped ids only, never full inventory).
- `RoomState.settings` gains optional `chaos:ChaosKnobs` (only when mode==='customChaos'); updateSettings patch accepts `chaos` bounded by `shared/chaos.js`.
- `turn` event gains optional `actions:string[]` — legal verbs this turn (e.g. `['bid','challenge']`). Monkey Lies omits it (canCall/lastHolder unchanged).
- Snapshot = Base + per-mode extension. Base (every mode): `mode, mapId, phase, roundNo, seats, turnSeat, deadline, yourSeat`. `phase` is mode-scoped (clients must not assume the ML set). Extensions:
  - monkeyLies: unchanged (tableFruit,lastPlay,lastHolder,penalty,yourHand,chipUsedByYou)
  - bananaDice: snapshot `yourDice:number[]|null, bid:{seat,count,face}|null, totalDice, penalty`; per-seat `dice:number`
  - coconutRoulette: snapshot `bomb:{holderSeat,shakes,pExplode}|null`; per-seat `chips` (roulette semantics)
  - junglePoker: snapshot `pot, toCall, yourCards:PokerCard[]|null, penalty`; per-seat `stack,bet,folded`
  - kingOfTheBar: ML extension + `barRule:{ruleId,name,desc}|null`
  - customChaos: ML extension + `knobs:ChaosKnobs`

Engine contract addendum (server-internal, in modes/index.js): every engine exposes `start, onTimeout(kind), getTimer(), snapshotFor(seat), modeAction?(seat,action,data), phase, turnSeat, lastHolderPending (may be constant false), winnerSeat, inspect()`. Timer kind strings are engine-owned; gameRoom.syncTimer passes them verbatim. Engines emit only §3.3 types plus `modeEvent`.

### B.4 New shared modules (R1 creates, dependency-free, unit-tested)
- `shared/src/modeEvents.js` — per-mode modeEvent kind constants + action-verb registry.
- `shared/src/dice.js` — `rollDice(n,rng)`, `bidBeats(a,b)` (raise count, or same count + higher face; 1s wild, count toward every face), `countMatching(allDice,face)`, `DICE_FACES`.
- `shared/src/poker.js` — 52 cards = 4 fruit suits × ranks 2–14; `buildPokerDeck()`, `evaluateHand(cards3)` → `{rankClass,tiebreak,name}`, class order Trio > Straight Flush > Straight > Flush > Pair > High Card, deterministic/comparable.
- `shared/src/chaos.js` — knob schema/bounds/defaults: handSize 3–7 (5), maxPlay 1–4 (3, ≤handSize), startChambers 2–8 (4), startCoconuts 1–3 (1), chipsPerMatch 0–3 (1), chipBonus 1–4 (2), goldenPerPlayer 0–2, `validateKnobs(patch)`.
- `shared/src/cosmetics.js` — 1.0 catalog (~24 items, 4 slots): hat (8: banana_pin, neon_shades, crown_of_the_bar, party_cone, pirate_hat, gold_monocle, chef_toque, propeller_cap), skin (6 fur dyes: midnight, albino, neon_lime, royal_purple, gilded, cherry), table (4 incl. legacy vip_stool re-slotted), deco (4: disco_ball, parrot_perch, golden_cannon, lava_lamp_rail). Each `{id,name,glyph,desc,slot,price,minLevel}`. Prices 50–500, minLevel 1–10.
- `shared/src/constants.js` additions — economy: `COIN_REWARDS={1:60,2:35,3:25,other:15}`, `COIN_PER_GOOD_CALL=2`, `COIN_PER_SURVIVED_SHOT=2`, `XP_BASE=40`, `XP_PER_PLACE_STEP=15`, `xpToNext(level)=100+50*level`, `LEVEL_CAP=50`, `REWARD_MIN_ROUNDS=2`; modes: `DICE_START=5`, `ROULETTE_START_CHIPS=3`, `ROULETTE_BASE_P=0.08`, `ROULETTE_STEP_P=0.06`, `POKER_START_STACK=10`, `POKER_ANTE=1`, `POKER_MAX_RAISES=2`, `POKER_BUST_REFUND=3`. Do NOT change existing constant values.

### B.5 Architecture rulings
1. Persistence = server-side JSON file store `server/data/profiles.json` (gitignored; atomic temp+rename, debounced 2s, load at boot, in-memory fallback). Identity = existing session token→playerId. Losing token = fresh profile (documented). Bots never earn/persist.
2. Playability truth = server registry. `welcome` modes decorated `playable: isModePlayable(id)`. Maps gated by `shared/maps.js` flags (flipped by R8).

---

## C. Scope: MUST-HAVE vs NICE-TO-HAVE

MUST-HAVE (1.0): all 5 locked modes playable online w/ HUD+choreography+reconnect+bots (R1–R7); all 10 maps playable+distinct (R8); Banana Coins + XP/levels persistent + working shop + cosmetics rendering (R2,R9); how-to-play per mode, rewards screen, hardening, README/CHANGELOG/v1.0.0, final QA (R10).

CUT LINE. NICE-TO-HAVE (cut in this order if a wave overruns): soak harness; full profile/stats screen; medium quality tier; poker tells; legacy wins→coins migration; extra King mutators; map ambient audio.

Deferred beyond 1.0: accounts/OAuth, DB persistence, multi-instance scaling, replays, mobile layout, roster paywalls (all 16 monkeys stay free).

---

## D. Build prompts & waves

```
Wave 1: R1                 (shared contract)
Wave 2: R2 ∥ R3 ∥ R8       (server core+economy ∥ client framework ∥ maps)
Wave 3: R4 ∥ R5 ∥ R6 ∥ R7  (one agent per mode, end-to-end)
Wave 4: R9                 (cosmetics rendering + shop)
Wave 5: R10                (UX, hardening, release pass)
```

Global rules (every prompt): binding contracts PLAN.md §2–§4 + §10 + this doc §B; only touch listed files; server authoritative, clients dumb renderers; bots consume only own seat feed; new choreography goes through gameClient.js serial event queue with fast-mode; done = npm test green + lint clean + build ok + runtime checklist.

The full per-prompt specs (R1–R10 rules, files, acceptance) are carried in each build agent's instructions. Key rules per mode are in §B.1/§B.3 and the mode sections. Highest risk: R7 monkeyLies.js parameterization (regression gate = untouched existing tests); new-mode choreography pacing (mandate event queue); R3 HUD-shell refactor (gate = pixel-faithful ML regression before Wave 3).

Wave gates: don't start Wave 3 until R2 stub modules + R3 registries merged and an ML regression match passes; don't start R9 until cosmetics-bearing SeatPublic is on the wire (R2) and bar.decorAnchor exists (R8).
