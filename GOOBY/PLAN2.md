# GOOBY 2.0 „VOLLVERSION" — Master Build Plan, Part 1 (§A–§D)

**Status of this file:** §A–§D (product definition, architecture deltas, feature specs, asset plan) are written by plan agent 1 and are **binding** for all 2.0 build agents. **§E–§G (build prompts, eval plan, coordinator runbook) follow below, appended by plan agent 2.** Read `PLAN.md` (v1.0 contract) first — everything in it stays binding unless a delta in this file explicitly extends it. Deltas here only ever **extend** v1 contracts; they never break them.

**Baseline (v1.0, shipped, commit 4fba376):** 12 minigames, 4 rooms, 16 foods, 11 outfits, 16 achievements, 6 wallpapers, 4 floors, save schema v1, 440 green node:test tests, green iOS CI. Product-owner verdict: content depth of an alpha. 2.0 is the true Vollversion.

**Repo facts (unchanged from PLAN.md):** everything lives in `/workspace/GOOBY/`; never touch `/workspace/MONKEYBAR`; dev port 5174; Node 22; no Xcode locally (CI proves iOS); all design numbers land in `src/data/constants.js`; every user string goes through `t(key)` with **both** EN and DE entries.

---

## §A. 2.0 Product Definition & „Definition of FULL"

### A1. Product definition

GOOBY 2.0 turns the polished-but-thin v1.0 into a commercial Pou/Talking-Tom-class virtual pet. The 2.0 loop: you wake up to a **daily quest board**, harvest the **garden** you planted last night (rain watered it for you), feed Gooby a healthy breakfast so his **tummy** recovers from yesterday's candy binge, play a few of the **21 minigames** to fund a new **fur-color skin**, drive the car to the **vet** when the junk food catches up with him, fill pages of the **sticker album**, and snap a **photo** of Gooby in his wizard hat under the **night sky** — all real-time, all offline-aware, all bilingual, all on the existing engine.

Eight pillars (every one must land in 2.0): ① minigame explosion (12→21), ② garden/backyard as a fifth space with real-time crops, ③ deeper pet sim (sickness/medicine/vet, weight/fitness, richer idle reactions), ④ progression (daily quests, collections, 33 achievements, level cap 40, real coin sinks), ⑤ content explosion (32 foods, big furniture/wallpaper/floor/outfit expansion, purchasable fur skins), ⑥ city growth (vet clinic destination + delivery-mission minigame), ⑦ ambience (real-clock day/night + weather), ⑧ QoL (stats/profile screen, photo mode).

### A2. Non-negotiable hard constraints (restated as binding)

1. **Save v2 migrates v1 losslessly.** Every v1 field survives verbatim; new slices get defaults; unit-tested against committed v1 fixtures (§B2).
2. **Layout bar:** every new screen/panel passes 320/375/390/430 px widths × EN+DE with zero clipped/overlapping text; all touch targets ≥ 44 px (v1 uses ≥ 48 px — keep 48 where possible, 44 is the floor).
3. **v1 perf budgets hold (PLAN.md §E10, restated):** pixelRatio ≤ 2; home ≤ 120 draw calls / ≤ 150k tris; drive ≤ 180 draw calls; every other minigame ≤ 150; one 1024 px shadow map (home only); no postprocessing; texture memory ≤ 64 MB; main JS bundle ≤ 1.6 MB gzip; scene switch ≤ 1.5 s at 4× CPU throttle; 60 fps on 2020 mid-range phones. **2.0 additions:** garden room ≤ 130 draw calls / ≤ 160k tris (crops instanced); rain ≤ 1 extra draw call (instanced quads/Points, pool 300); each new minigame ships as a lazy chunk ≤ 150 KB gzip (registry already lazy-loads via `import.meta.glob`).
4. **Assets:** CC0 Kenney or procedural only. Committed asset total target ≤ 25 MB (v1 is 8.5 MB; 2.0 adds ≈ 3–5 MB); the fetch-script hard budget stays 80 MB.
5. **Contracts:** extend, never break — §E1–E10 of PLAN.md stay valid; the only contract *changes* are additive (§B3).
6. **All 440 existing tests stay green.** Every new pure-logic module gets node:test coverage (≥ 120 new tests expected).
7. **Every new minigame** follows PLAN.md §E8: pure `.logic.js` sibling + tests + `?autoplay=1` bot + EN/DE strings + distinct look, payouts tuned to a §C6-style coin row and included in the economy simulation test.
8. **No new Capacitor pods.** Photo mode uses canvas capture + Web Share API / anchor download (§C12); nothing else needs native.

### A3. Definition of FULL — measurable acceptance criteria

2.0 ships only when ALL of the following are true (checked by eval agents, §F):

**Counts:**
| metric | v1 | 2.0 minimum | 2.0 spec target |
|---|---|---|---|
| playable minigames (arcade tiles, zero "coming soon") | 12 | 20 | **21** (§C1) |
| foods in shop catalog | 16 | 28 | **32** (§C7) |
| garden crops (plantable) | 0 | 6 | **8** (§C2) |
| outfits | 11 | 20 | **20** (§C8.4) |
| fur-color skins (incl. default) | 1 | 5 | **7** (§C8.5) |
| wallpapers | 6 | 10 | **10** (§C8.2) |
| floors | 4 | 7 | **7** (§C8.2) |
| NEW furniture buyables added (non-default, incl. garden) | — (v1 ships 28) | +25 | **+30 → 58 total** (§C8.1/§C8.3) |
| achievements | 16 | 32 | **33** (§C5.3) |
| daily-quest pool entries | 0 | 25 | **28** (§C5.1) |
| collection sets / total stickers | 0 | 3 / 24 | **4 / 32** (§C6) |
| rooms/spaces | 4 | 5 | **5** (garden, §C2) |
| drivable city destinations | 1 | 2 | **2** (shop + vet, §C9) |
| level cap | 30 | 40 | **40** (§B6) |

**Feature checklist (each must be demo-able end-to-end):**
1. Garden: plant → water → real-time growth (progresses offline) → harvest to inventory → eat or sell; harvest-ready notification obeying quiet-hours/spacing; rain auto-waters; 6 garden decor slots.
2. Sickness: junk-overfeed and neglect both provably trigger queasy→sick per exact thresholds (§C3); cured by medicine item and by vet trip; sick state visible on Gooby and never punitive beyond spec.
3. Weight: junk raises, active play lowers, 4 cosmetic tiers change Gooby's silhouette; zero gameplay penalty (§C4).
4. Quest board: 3 quests/day, deterministic daily roll from the 28-entry pool, claimable coin+XP rewards, 1 free reroll/day.
5. Sticker album: 4 sets earnable through play; per-set completion rewards paid once.
6. Vet clinic reachable by car on its own fixed route; vet trip cures sick for 120c; delivery-mission minigame reuses city+car.
7. Day/night: 4 real-clock bands drive home/garden lighting, window sky, and Gooby's sleepy night behavior; weather (clear/cloudy/rain) is deterministic, rain visible in windows+garden and waters plants.
8. Stats/profile screen shows playtime, totals, per-game bests for all 21 games; photo mode captures a UI-less posed PNG saved via share/download.
9. Every new game: launchable via `?minigame=<id>`, bot-completable via `?autoplay=1`, pays within its coin row, first-play-of-day ×2 works.
10. Save v2: v1 fixture saves load with all progress intact (coins/level/outfits/furniture/achievements/streak/settings byte-for-value identical); corrupt/forward-version recovery still works.
11. `npm run lint`, `npm test` (440 old + ≥ 120 new), `npm run build` green; **GOOBY iOS** workflow green with `gooby-unsigned-ipa` artifact.
12. Onboarding still completes for fresh players; a v1 veteran opening 2.0 sees a one-time "What's new" toast/panel and their untouched home.

**Quality bars:** every pillar feature reachable within 2 taps of its natural surface (garden = 5th room dot, quests = HUD button, album/profile = HUD/settings); no dead-end screens; every new string EN+DE; no console errors during a 45-min free play; economy sim proves a 15-min/day player can afford food + one 400–800c sink purchase per week.

---

## §B. Architecture Deltas (binding)

Everything in PLAN.md §B/§E remains valid. This section lists ONLY what 2.0 adds or (additively) changes.

### B1. New modules (file paths binding)

```
src/
├── systems/
│   ├── garden.js            # pure crop growth engine: plant/water/tick/harvest/sell (§C2)
│   ├── health.js            # pure sickness state machine: junkScore/neglect → queasy/sick, cures (§C3)
│   ├── weight.js            # pure weight model: gains/losses/tiers (§C4)
│   ├── quests.js            # pure daily-quest engine: seeded roll, progress, claim, reroll (§C5.1)
│   ├── collections.js       # pure sticker engine: award/isComplete/claimSet (§C6)
│   ├── dayNight.js          # pure real-clock band engine: bandAt(ms) → band + lerp params (§C10)
│   ├── weather.js           # pure deterministic weather: weatherAt(ms) → state/block (§C11)
│   └── profileStats.js      # pure playtime/totals accumulator fed by timeEngine + events (§C12)
├── data/
│   ├── crops.js             # crop catalog (§C2 table) derived from constants.CROP_TABLE
│   ├── quests.js            # 28-entry quest pool (§C5.1) derived from constants.QUEST_POOL
│   ├── collections.js       # 4 sets × entries catalog (§C6)
│   └── skins.js             # 7 fur-color skins: palettes + prices (§C8.5)
├── home/
│   ├── rooms/garden.js      # 5th room def: outdoor shell, plots, garden slots (§C2.1)
│   └── gardenInteractions.js# plant/water/harvest gestures + seed/sell panel wiring (§C2.2)
├── character/skins.js       # applySkin(gooby, skinId): swaps BODY/BELLY/EAR_INNER material colors
├── gfx/
│   ├── sky.js               # garden sky dome + window sky textures per band/weather (1 draw call)
│   └── weatherFx.js         # pooled rain quads (garden) + window streak overlay + rain synth hook
├── city/vetClinic.js        # vet building/parking/route composition consumed by cityBuilder (§C9.1)
├── minigames/games/         # 9 new games, each <id>.js + <id>.logic.js (§C1):
│   ├── goobySays[.logic].js      burgerBuild[.logic].js   veggieChop[.logic].js
│   ├── gardenRush[.logic].js     deliveryRush[.logic].js  miniGolf[.logic].js
│   ├── goalieGooby[.logic].js    starHopper[.logic].js    pipeFlow[.logic].js
├── ui/
│   ├── questBoard.js        # daily quest screen (HUD button, badge when unclaimed)
│   ├── albumScreen.js       # sticker album, 4 pages, silhouette→filled, set claim buttons
│   ├── profileScreen.js     # stats/profile screen (§C12.1)
│   ├── photoMode.js         # photo mode overlay (§C12.2)
│   ├── vetPanel.js          # vet arrival panel: pay/cure/checkup flow (§C9.2)
│   └── gardenPanel.js       # seed picker + harvest-sell sheet (opens from plot taps)
test/
├── garden.test.js  health.test.js  weight.test.js  quests.test.js  collections.test.js
├── dayNight.test.js  weather.test.js  profileStats.test.js
├── minigamesD.test.js       # goobySays, gardenRush, burgerBuild, veggieChop, goalieGooby logic
├── minigamesE.test.js       # deliveryRush, miniGolf, starHopper, pipeFlow logic
└── saveV2.test.js           # v1→v2 migration against committed v1 fixtures (§B2)
```

Purity rule unchanged: everything under `systems/`, `data/`, and every `.logic.js` imports no three.js/DOM.

### B2. Save schema v2 + migration spec (binding)

`SAVE.VERSION` 1 → **2**. `defaultState()` gains these slices (exact defaults):

```js
{ v: 2,
  // …all v1 fields unchanged…
  garden: {
    plotsOwned: 4,                       // plots 5/6 purchasable (§B6 gating)
    plots: [                             // ALWAYS length 6; index ≥ plotsOwned renders locked
      { crop: null, plantedAt: 0, progressMin: 0, wateredUntil: 0, waterings: 0, fertilized: false },
      /* ×6 identical */ ],
    lastTickAt: 0,                       // growth accrual bookkeeping (offline-aware)
  },
  health: { state: 'healthy',            // 'healthy'|'queasy'|'sick'
            junkScore: 0, neglectMin: 0, recoverMin: 0, since: 0 },
  weight: { value: 50 },                 // 5–95 clamp, §C4
  quests: { day: '',                     // localDay string of the active roll
            active: [],                  // [{ id, progress, claimed }] ×3 after roll
            rerolledDay: '',             // localDay when the free reroll was used
            completedTotal: 0 },
  collections: { entries: {},            // { '<setId>.<entryId>': count ≥ 1 }
                 claimedSets: {} },      // { '<setId>': timestampMs }
  skins: { owned: ['cream'], equipped: 'cream' },
  items: { medicine: 0, fertilizer: 0 }, // non-food consumables (NOT in `inventory`)
  profile: { playtimeMin: 0, coinsEarned: 0, coinsSpent: 0, distanceM: 0, photos: 0 },
}
```

Additive extensions to EXISTING slices (auto-filled by `mergeDefaults`, but the migration states them explicitly so tests can assert):
- `achievements.counters` gains: `harvests:0, plantings:0, waterings:0, sells:0, cures:0, vetTrips:0, deliveries:0, questsDone:0, photosTaken:0, nightPlays:0, medsGiven:0, balls:0` (balls = ball-toss fetches; v1 tracked none).
- `furniture.placed` gains key `garden: {}` (empty object; decor engine treats missing slots as defaults).
- `settings` unchanged. `minigames.best/plays/lastPlayDay` unchanged (new game ids simply appear as keys).

**Migration `migrations[1]` (v1 → v2), exact behavior:**
1. Spread the new top-level slices with the defaults above **only when absent** (`state.garden ??= …` semantics via `{ ...defaults, ...state }` ordering — v1 saves never contain them).
2. Never rewrite any existing key: `stats, sleep, grumpyUntil, coins, xp, level, inventory, furniture.owned, furniture.placed.<v1 rooms>, decor, outfits, minigames, achievements.unlocked, achievements.counters.<v1 keys>, daily, quickDelivery, settings, onboarding, createdAt, lastTickAt` pass through verbatim.
3. Set `v = 2`.
4. `validate()` change: level clamp `Math.min(30, …)` → `Math.min(LEVELING.MAX_LEVEL, …)` with `MAX_LEVEL = 40` (§B6); weight clamped to [5, 95]; `garden.plots` normalized to exactly 6 entries; `health.state` coerced to `'healthy'` when not one of the 3 valid strings.

**`test/saveV2.test.js` (binding):** commit ≥ 3 v1 fixture JSONs under `test/fixtures/` — (a) fresh v1 `defaultState()` output, (b) a mid-game v1 save (level 12, coins 5000, 7 outfits owned, 40 achievements-counter feeds, streak 6, furniture placed, best scores for all 12 games), (c) a v1 save with unknown extra keys (must survive). Assert: post-load `v === 2`; every v1 value identical; every new slice at defaults; forward-version (v:3) still refuses; corrupt payloads still recover. Also assert `load()` of a v2 save is idempotent.

### B3. Contract changes (all additive)

| contract | v1 | 2.0 delta |
|---|---|---|
| §E8 minigame `onEnd` | `onEnd({score})` | `onEnd({score, meta?})` — `meta` is an optional plain object forwarded by the framework to `collections.onGameMeta(id, meta)` and `quests.onGameEnd(id, score, meta)`. Games without meta are untouched. Known meta shapes: fishingPond `{caught:[speciesId,…]}`, cityDrive/deliveryRush `{landmarks:[landmarkId,…], crashes, distanceM}`, miniGolf `{strokes, holeInOnes}`. |
| §E2 store events | 12 events | new: `'gardenChanged'`, `'healthChanged'`, `'weightChanged'`, `'questsChanged'`, `'collectionsChanged'`, `'skinChanged'`, `'itemsChanged'`, `'profileChanged'` (all persisted-slice events) + runtime-only `'dayBandChanged'`, `'weatherChanged'` (emitted by a 60 s ambience ticker in timeEngine; not saved). |
| §E7/§C7 notifications | ids 1–5, `MAX_SCHEDULED: 5` | new ids `harvest: 6`, `sick: 7`; `MAX_SCHEDULED: 7`. Same quiet-hours (22–08 → shift 08:05), same 30-min spacing, wake (id 1) stays the only quiet-exempt id. Copy + trigger rules in §C2.4/§C3.5. |
| roomManager | `ROOM_DEFS` ×4, indoor shells | `ROOM_DEFS` ×5 — garden def carries `outdoor: true`: no walls, sky dome via `gfx/sky.js`, grass CanvasTexture floor, no wallpaper/floor decor for it. New API: `roomManager.setAmbience({band, weather})` (lerps lights/sky; no-op for v1 indoor rooms except window sky + light intensity). Room order: kitchen · living · bathroom · bedroom · **garden**. Locked garden (level < 3) shows a padlocked 5th nav dot + teaser. |
| cityBuilder | 1 destination (shop) | `generateCityLayout(seed)` output gains `vet: {tile, buildingAt, rotY, parking}` (fixed `VET_TILE = [2,2]`), `vetRoute` (tile list §C9.1), and `landmarks: [{id, x, z}]` ×6 (§C6 set 3). Determinism from seed unchanged; `cityLayout.test.js` extends: vet route connected, vet reachable, landmarks on non-road tiles. |
| economy | award/spend/buyFood/quickDelivery | new pure APIs: `sellHarvest(store, foodId, qty)` (pays §C2 sell price), `buySeed(store, cropId)`, `buyItem(store, 'medicine'|'fertilizer')`, `useMedicine(store)`, `payVet(store, kind:'cure'|'checkup')`, `buySkin(store, id)`, `buyPlot(store, index)`. ALL coin movement still exclusively through economy.js; every award/spend also increments `profile.coinsEarned/coinsSpent`. |
| leveling | `MAX_LEVEL` 30 (implicit clamp) | `LEVELING.MAX_LEVEL = 40`, XP curve formula unchanged (`100 + 50·(L−1)` to advance; cumulative L40 = 40 950 XP). Level-up reward unchanged (25·newLevel coins). |
| framework | energy gate, results, payout | unchanged; new games plug in. `economy.awardMinigame` covers the 9 new coin rows (§C1.1). The `?autoplay=1` harness hook is per-game (each game module exports `autoplay(ctx)` strategy or drives it internally, matching the v1 pattern — inspect `carrotCatch.js` for the shipped convention and copy it). |
| foods | `FOOD_TABLE` 16 rows | +16 rows (§C7) and a new boolean column `junk` (v1 rows: `donut-sprinkles`, `cupcake`, `ice-cream`, `pizza`, `cake` become `junk: true`; all other v1 rows `junk: false`). `data/foods.js` exposes `junk` on FoodItem. Feeding pipeline calls `health.onEat(food)` + `weight.onEat(food)`. |

### B4. Day/night + weather engine design (pure, testable)

`systems/dayNight.js`:
- `BANDS = [{id:'night', from:21, to:6}, {id:'dawn', from:6, to:8}, {id:'day', from:8, to:18}, {id:'dusk', from:18, to:21}]` (device-local hours).
- `bandAt(ms) → { band, tInBand, blend }` — `blend` = `{from, to, t}` crossfade over the **first 30 min** of each band so lights lerp smoothly; pure function of `ms` via `new Date(ms)` local time.
- Light/sky parameter tables live in `constants.DAYNIGHT` (exact values §C10). Application (impure, additive edits): `gfx/lights.js` gains `applyAmbience(params)`; `homeScene` ticker (60 s) calls `roomManager.setAmbience(…)`.

`systems/weather.js`:
- Time is split into 6-hour local blocks (00–06, 06–12, 12–18, 18–24). `blockOf(ms) → {dayStr, blockIdx, start, end}`.
- `weatherAt(ms) → { state, start, end }` with `state = pick(hash32(dayStr + ':' + blockIdx))`: `< 0.55 → 'clear'`, `< 0.80 → 'cloudy'`, else `'rain'`. `hash32` = xmur3-style string hash → [0,1); committed in weather.js and locked by tests (same input ⇒ same weather on every device — a feature: friends' Goobys share weather).
- `forecast(ms) → [current, next]` for the garden HUD chip.
- Rain side-effect contract: `garden.applyRain(state, rainStart, rainEnd)` sets every planted plot's `wateredUntil = max(wateredUntil, rainEnd)` (pure; called from the ambience ticker and from `simulateOffline` for elapsed rain blocks — offline rain waters plants too, capped at the same 8 h sim window as v1 §E4).

### B5. Weight & sickness state machines (pure, exact numbers)

`systems/weight.js` — single scalar `weight.value ∈ [5, 95]`, default 50:
- `onEat(food)`: `junk ? +2.0 : +0.5`.
- `onMinigameEnd(id)`: `ACTIVE_GAMES = ['runner','trampoline','danceParty','bunnyHop','gardenRush','veggieChop','goalieGooby','starHopper']` → `−1.0`; all other games `−0.25`.
- `onBallFetch()`: `−0.2`.
- Passive drift in the stats tick + offline sim: toward 50 at `±2.0 per 24 h` (i.e. `0.00139/min`, applied with the same 0.3× offline multiplier and 480-min cap as stats).
- Tiers (§C4.3): thresholds 25 / 60 / 85. Emits `'weightChanged'` only when the integer value or tier changes.

`systems/health.js` — states `healthy → queasy → sick` (never skips on the way up; cures can jump down):
- Inputs: `onEat(food)` → `junk ? junkScore += 1 : junkScore = max(0, junkScore − 0.5)`; tick decay `junkScore −1 per 120 min` (offline: same 0.3×/480-min rules).
- `neglectMin`: +1 per real minute while **≥ 2 stats < 15**; resets to 0 the minute the condition clears.
- Transitions (evaluated every tick, exact): `healthy→queasy` when `junkScore ≥ 5 || neglectMin ≥ 120`; `queasy→sick` when `junkScore ≥ 8 || neglectMin ≥ 360`; `queasy→healthy` when `junkScore < 3 && neglectMin == 0` continuously for `recoverMin ≥ 60`; `sick` **never** auto-recovers.
- Cures: `useMedicine()` — sick→queasy (resets `recoverMin`), queasy→healthy; consumes 1 medicine. `payVet('cure')` — any state → healthy, `junkScore = 0`, `neglectMin = 0`, +10 all stats (clamped).
- Effects are specified in §C3.3/§C3.4 (visuals, fun-decay ×1.25 while queasy, minigame refusal while sick — mirrors the v1 "exhausted" gate).

### B6. Unlock gating table (feature ↔ level, binding → `constants.UNLOCKS`)

| level | unlock |
|---|---|
| L1 | photo mode, stats/profile screen, sticker album, vet checkup (cure available whenever sick, any level) |
| L2 | daily quest board · minigame **goobySays** |
| L3 | **garden** (4 plots) + crops radish/carrot/salad · garden decor slots |
| L4 | minigame **gardenRush** · crop tomato |
| L5 | minigame **burgerBuild** · **skins** shop tab |
| L6 | minigame **veggieChop** · crop corn |
| L7 | minigame **deliveryRush** |
| L8 | quick delivery purchasable (v1, unchanged) · crop eggplant |
| L9 | minigame **miniGolf** |
| L10 | garden plot 5 purchasable (300c) · crop pumpkin |
| L11 | minigame **goalieGooby** |
| L12 | minigame **starHopper** · crop watermelon |
| L14 | minigame **pipeFlow** |
| L16 | garden plot 6 purchasable (600c) |

v1 unlocks (L1–L10 game schedule, memory 6×4 at L6, quick delivery L8) unchanged. Locked arcade tiles keep the v1 "level N" presentation; locked garden/quest surfaces show the same pattern.

### B7. Quest & collection engines

`systems/quests.js` (pure):
- `rollDaily(state, nowMs) → active[]`: if `quests.day !== localDay(nowMs)` pick 3 quests from `data/quests.js` with `mulberry32(hash32(localDay))`, filtered to entries whose `requires` (feature/level/minigame unlock) is satisfied, and constrained to ≥ 2 distinct `category` values (care/games/garden/economy). Persist `{day, active}`.
- `track(state, event, n=1, meta)`: quests declare `{event, target}`; matching events advance `progress` (clamped at target). Event names are the quest-pool column in §C5.1 — they ride the store events + explicit `quests.track()` calls at the same call sites achievementsEngine already instruments.
- `claim(state, id)`: requires `progress ≥ target && !claimed`; pays `reward.coins` + `reward.xp` via economy/leveling; increments `questsDone` counter + `quests.completedTotal`.
- `reroll(state, nowMs)`: once per day (`rerolledDay` guard) replaces unclaimed, un-progressed quests with a fresh seeded pick (`hash32(localDay + ':r')`).
- HUD: quest button shows a badge = number of claimable quests.

`systems/collections.js` (pure):
- `award(state, setId, entryId, n=1)`: increments `entries['<set>.<entry>']`, emits `'collectionsChanged'`, first-time award triggers a sticker toast.
- Sources wired via: `onGameMeta` (fish, landmarks §B3), `garden.harvest` (veggies), `interactions.feed` (treats).
- `isSetComplete(state, setId)`; `claimSet(state, setId)` pays the §C6 completion reward once (`claimedSets` guard) — reward furniture lands in `furniture.owned`.

---

## §C. Feature Specs (all numbers binding → `src/data/constants.js`)

### C1. Minigame explosion: 12 → 21

All PLAN.md §C6 shared rules apply unchanged (8 energy per play — car games 6, +15 fun on finish, `clamp(floor(score/divisor), min, max)` coins, daily first-play ×2 after clamp, countdown/pause/results framework-owned, exhausted/sick refusal).

**C1.1 Coin table additions (append to `constants.COIN_TABLE` + `data/minigames.js`; §C6-style rows):**

| id | divisor | min | max | typical/avg round | energy |
|---|---|---|---|---|---|
| goobySays | 5 | 4 | 24 | ~16c / 60–90 s | 8 |
| gardenRush | 3 | 4 | 25 | ~14c / 60 s | 8 |
| burgerBuild | 4 | 4 | 26 | ~15c / 75 s | 8 |
| veggieChop | 5 | 4 | 26 | ~14c / 60 s | 8 |
| deliveryRush | 8 | 5 | 32 | ~24c / 120 s (premium, like cityDrive) | 6 |
| miniGolf | 5 | 4 | 28 | ~16c / 100 s | 8 |
| goalieGooby | 3 | 4 | 26 | ~15c / 60 s | 8 |
| starHopper | 9 | 4 | 26 | ~15c / 75 s | 8 |
| pipeFlow | 5 | 4 | 25 | ~15c / 90 s | 8 |

Economy sanity target unchanged: 10–15 coins/min (deliveryRush ~12c/min despite the bigger max). All 9 rows join the `test/economy.test.js` average-day simulation; `minigameMeta.test.js` grows to 21 ids.

**C1.2 The 9 new designs** (id — name EN „DE" · genre · design ¶ · controls · duration · autoplay strategy · complexity S/M/L):

1. **goobySays** — Gooby Says „Gooby sagt" · sequence memory · Four chunky pastel pads (carrot-orange, teal, pink, yellow) arranged around Gooby on a stage; Gooby "sings" a growing sequence (each pad = a distinct synth squeak pitch + pad light-up + Gooby ear-point animation); the player repeats it. Sequence starts at 3, +1 per round; playback speeds up 5%/round (floor 320 ms/step). One mistake = game over (cute dizzy). Score = `10·roundsCompleted + speedBonus` where speedBonus = 0–8 scaled by average reaction time (< 500 ms/step average = 8). · Controls: tap pads. · Duration: until miss, typically 60–90 s. · Autoplay: bot stores the emitted sequence and replays it with 250 ms taps. · **S**
2. **gardenRush** — Watering Rush „Gießkannen-Wirbel" · reaction/management · Gooby's garden in fast-forward: 8 pots sprout seedlings that wilt on independent timers (wilt window 6 s → ramps to 3 s). Hold a pot to water it — a fill ring grows over 0.8 s; release inside the green zone (last 25% of ring) = perfect (+3), early = ok (+1), letting a plant fully wilt = it droops (−2, respawns). Waves add pots #7–8 and decoy weeds (watering a weed = −1, it grows bigger — funny). 60 s. Score ≈ 40. · Controls: press-and-hold + release. · Duration 60 s. · Autoplay: bot targets the plant with the lowest remaining wilt time, holds 0.75 s. · **S**
3. **burgerBuild** — Burger Builder „Burger-Baumeister" · catch/order-matching · A ticket at the top shows the required stack (bun, patty, cheese, tomato, salad, onion — 4–7 layers, seeded); ingredients rain in 3 columns; Gooby slides a plate to catch ONLY the next-needed layer. Correct catch +5 (snaps onto the stack with a squish), wrong catch −2 (splats off), completed burger +15 & Gooby takes a comical bite; new ticket follows. Fall speed +8%/completed burger. 75 s. Score ≈ 60. · Controls: drag horizontally. · Duration 75 s. · Autoplay: bot moves the plate to the column of the nearest falling next-needed ingredient. · **M**
4. **veggieChop** — Veggie Chop „Gemüse-Schnippler" · swipe slicer (fruit-ninja-like) · Veggies and fruits are lobbed up in arcs (1–3 at once, ramping); swipe through them to chop (each splits into two food-kit half models + juice particles, +2; multi-chop in one swipe = combo +1 each). Soda cans and the boot are junk — chopping them costs −3 and a 0.5 s splash stun. Miss 3 veggies (fall unchopped) and the round ends early. 60 s. Score ≈ 70. · Controls: swipe (trail rendered). · Duration ≤ 60 s. · Autoplay: bot synthesizes a swipe through each veggie at apex, ignores junk. · **M**
5. **deliveryRush** — Delivery Rush „Liefer-Blitz" · driving/delivery (CITY REUSE) · Gooby's van (car-kit `delivery`) starts at the shop with 3 parcels; a random sequence of 3 destinations from the 6 city landmarks (§C6 set 3) is marked with the v1 arrow+route-line system; drive to each glowing drop ring (radius 4 m) to deliver (+50, confetti, doorbell). Traffic/crash rules identical to cityDrive (tow rule not needed — no fail; crashes just cost time and −5 each, floor 0). Time bonus: `+max(0, 120 − elapsedSec)` after the 3rd drop. Score ≈ 170–190. Feeds `meta.landmarks` + `deliveries` counter. · Controls: v1 thumb steering + brake. · Duration ≤ 120 s. · Autoplay: bot follows the lane polyline (reuse the cityDrive bot's follow logic). · **L**
6. **miniGolf** — Mini Golf „Minigolf" · physics putt · 6 seeded holes assembled from minigolf-kit tiles on a floating pastel course (par 2–3 each: straight, corner, ramp, bump, windmill gate, tunnel). Drag back from the ball to aim (power = drag length, capped; dotted preview line); ball rolls with friction 0.985/frame, banks off walls, windmill blades block rhythmically. Scoring per hole: hole-in-one +30, ≤ par +20, par+1 +12, else +6. Gooby caddies and celebrates/facepalms. Score ≈ 80. · Controls: drag-release. · Duration ~100 s (10-stroke cap per hole auto-advances). · Autoplay: bot aims directly at the hole (or the tile gap waypoint baked per hole) with a per-hole power table, 2-putts everything. · **L**
7. **goalieGooby** — Goalie Gooby „Torwart Gooby" · sports reaction · Gooby in oversized gloves guards a garden goal; balls are kicked from 5 lanes with a 0.9 s telegraph (kicker wind-up + lane flash), ramping to 0.45 s and mixing in lobs (swipe up) and rollers (swipe down). Swipe toward the lane to dive-save (+4; +2 extra for last-0.15 s "super save" slow-mo), miss = goal conceded (3 misses end the round early, else 60 s). Every 10 saves the crowd of bunnies cheers and speed +10%. Score ≈ 48. · Controls: 4-direction swipe + tap for center. · Duration ≤ 60 s. · Autoplay: bot reads the telegraphed lane and swipes at t−0.2 s. · **M**
8. **starHopper** — Star Hopper „Sternenhüpfer" · vertical dodge/collect (space-kit) · Gooby pilots `craft_speederA` up a starfield in 3 lanes; meteors tumble down (70% forgiving hitboxes), star pickups (+3) and rare golden carrots (+10) drift between lanes. Speed +5%/10 s; meteor showers telegraphed by warning stripes. One hit = end (shielded first hit at score ≥ 60: shield pickup spawns once). Score = `distanceM/10 + pickups`. ≈ 140 raw. · Controls: tap left/right half to change lane (swipe = 2 lanes). · Duration ~75 s. · Autoplay: greedy bot — move toward the highest-value safe lane each 0.4 s window. · **M**
9. **pipeFlow** — Pipe Panic „Rohr-Wirrwarr" · rotation puzzle · Water the garden the nerdy way: a 5×5 grid of pipe tiles (straight/bend/T, seeded solvable by construction — generate a random spanning path from tap to sprinkler, then scramble rotations); tap tiles to rotate 90°; when the path connects, water flows with a satisfying fill animation and the next puzzle loads. Score = `25·solved + tapEfficiencyBonus` where the bonus is 0–10 (10 when total taps ≤ optimal+3, linearly down to 0 at optimal+15). 3 puzzles typical in 90 s → score ≈ 75. · Controls: tap to rotate. · Duration 90 s fixed. · Autoplay: bot solves via BFS over rotation states (solver exported from `pipeFlow.logic.js`, also used by tests to prove every seed is solvable). · **M**

**C1.3 Distinct looks (binding):** goobySays = disco-lite stage w/ giant pads; gardenRush = garden fence + terracotta pots; burgerBuild = diner counter checker floor; veggieChop = kitchen cutting-board arena; deliveryRush = the city at dusk band lighting; miniGolf = floating course over pastel sky; goalieGooby = meadow goal + bunny crowd; starHopper = dark starfield + nebula gradient (only "night" look in the set); pipeFlow = flat top-down garden blueprint style. No two games may share a skybox/palette combo.

**C1.4 Arcade screen:** grows to 21 tiles in unlock order (§B6 merged with v1 §C6.3); grid stays 3 columns at 320–430 px; tiles keep lock badges + best scores. `?minigame=<id>` and `?autoplay=1` work for all 21.

**C1.5 Tests (per game, in minigamesD/E.test.js):** goobySays sequence gen determinism + speed floor; gardenRush wilt-timer ramp + perfect-zone math; burgerBuild ticket gen + next-needed matcher; veggieChop arc solver + combo counter; deliveryRush destination pick (3 distinct from 6, seeded) + score/time-bonus math; miniGolf friction integration (ball stops < 0.01 m/s), bank reflection, par scoring; goalieGooby telegraph→lane mapping + ramp; starHopper lane-collision windows + spawn tables; pipeFlow generator always-solvable proof (BFS solver over 200 seeded boards) + rotation math.

### C2. Garden / backyard (5th space)

**C2.1 Space & layout.** Garden = 5th `ROOM_DEF` (`outdoor: true`), right of the bedroom (nav dot 5, padlocked until L3). Shell: 5×4 m grass CanvasTexture ground, low fence line at the back (suburban `fence-1x4` ×3), sky dome (`gfx/sky.js`) following day/night+weather, back hedge of nature-kit `plant_bushLarge` ×3 + `tree_default`. Fixed interactables: **6 crop plots** (nature-kit `crops_dirtSingle`, 2×3 grid, anchors `plot0…plot5`; plots ≥ `plotsOwned` show a "FOR SALE" sign), **compost bin** (procedural, sells harvest — tap opens the sell sheet), **watering can** (procedural, sits on a stump; the drag tool). Decor slots (§C8.3): `gardenBench`, `gardenGnome`, `birdbath`, `flowerBed`, `gardenPath`, `gardenTree`. Gooby hops along garden paths; rain plays there visibly.

**C2.2 Interactions.** Tap an empty owned plot → seed picker sheet (`gardenPanel.js`: owned-seed counts + buy row per §C2.3 prices, level-gated crops greyed). Plant = seed consumed, sprout appears. Drag the watering can over a planted plot ≥ 0.5 s → watering (can tilts, particle drops, +1 `waterings` counter, plot soil darkens; sets `wateredUntil` per §B4/§C2.3). Tap a ready plot (crop model + sparkle + bounce) → harvest: yield lands in food `inventory` (toast „+3 🥕"), `harvests` counter + veggie sticker. Compost bin → sell sheet lists harvestable foods with sell prices; selling pays via `economy.sellHarvest`. Fertilizer (item, 25c): drag onto a growing plot → instant `progressMin += 0.25 · growthMin`, once per planting (`fertilized` flag).

**C2.3 Crop table (binding → `constants.CROP_TABLE`; growth is REAL minutes, offline-aware):**

| crop id | seed price | growth min | waterings needed | watered window (min) | yield | sell price/ea | eaten (hunger/fun) | unlock | plot model stages |
|---|---|---|---|---|---|---|---|---|---|
| radish | 5 | 10 | 1 | 10 | ×2 | 6 | +8 / +1 | L3 | leafsStageA → crop_turnip (tinted red) |
| carrot | 8 | 20 | 1 | 20 | ×3 | 5 | +10 / +2 (favorite!) | L3 | leafsStageA → crop_carrot |
| salad | 12 | 30 | 2 | 15 | ×2 | 10 | +20 / 0, +2 hygiene | L3 | leafsStageA → leafsStageB |
| tomato | 15 | 45 | 2 | 22.5 | ×3 | 9 | +12 / +1 | L4 | leafsStageA → leafsStageB + food-kit tomato ×3 |
| corn | 20 | 90 | 2 | 45 | ×2 | 16 | +15 / +2 | L6 | cornStageA → B → C → D |
| eggplant | 25 | 150 | 3 | 50 | ×2 | 20 | +16 / +1 | L8 | leafsStageA → B + food-kit eggplant |
| pumpkin | 35 | 360 | 3 | 120 | ×1 | 55 | +26 / +4 | L10 | leafsStageA → crop_pumpkin |
| watermelon | 45 | 480 | 4 | 120 | ×1 | 70 | +14 / +4 | L12 | leafsStageA → crop_melon |

Growth model (pure `systems/garden.js`, unit-tested): progress accrues 1 min per real minute **only while `now < wateredUntil`**; each watering sets `wateredUntil = now + wateredWindow` (no stacking beyond `now + window`); ready when `progressMin ≥ growthMin`; ready crops never rot (cozy, not needy). Growth stages render at 0/33/66/100% progress. Offline: `simulateOffline` calls `garden.tick` with the SAME elapsed handling as stats (full elapsed, not 0.3× — plants are real-time like sleep, uncapped) plus `applyRain` for elapsed rain blocks (§B4). Economics check: radish ≈ 42c/h attended, watermelon ≈ 3c/h passive ×1 plot — gardening supplements, never replaces, minigames (~600–900c/h).

**C2.4 Harvest notification (id 6):** on background/save, if ≥ 1 plot is planted and fully watered through readiness, schedule at `earliest readyAt` (only when ≥ 10 min in the future); copy „Deine Ernte ist reif! 🥕" / "Your crops are ready! 🥕". Quiet-hours shift + 30-min spacing per v1 rules; only 1 harvest notification scheduled at a time. If watering is insufficient to reach readiness, no notification (don't lie).

**C2.5 Tests (`garden.test.js`):** plant/water/harvest roundtrip; progress halts when unwatered; watered-window math per crop; fertilizer once-only +25%; offline growth incl. rain auto-water; sell math; plot purchase gating (L10/300c, L16/600c); readyAt prediction matches notification scheduling; yield → inventory + sticker award.

### C3. Sickness & medicine

**C3.1 State machine** (pure `systems/health.js`, exact numbers in §B5): `healthy → queasy → sick`; junk overfeeding (`junkScore`: +1/junk food, −1/120 min, −0.5/healthy food) and neglect (`neglectMin`: minutes with ≥ 2 stats < 15) drive it. Thresholds: queasy at junkScore ≥ 5 OR neglect ≥ 120 min; sick at junkScore ≥ 8 OR neglect ≥ 360 min; queasy auto-heals after 60 clean minutes (junkScore < 3, neglect 0); sick only heals via cure.

**C3.2 Warning ramp (before anything "bad" happens):** junkScore hits 4 → toast „Goobys Bauch grummelt…" / "Gooby's tummy is rumbling…" + Gooby pats belly; neglect ≥ 90 min → sad-slump idle bias. Nothing is ever fatal; sick Gooby is pitiful-cute, not dying.

**C3.3 Queasy effects:** green-tinted cheeks (CHEEK material lerp to `#BFD9A8`), sneeze anim + squeak every ~40 s, fun decays ×1.25, new idle `queasyWobble` (slow sway + occasional hiccup). Minigames still playable.

**C3.4 Sick effects:** mood capped at 39 (like exhausted), minigames refuse with „Gooby ist krank! 🤒" / "Gooby is sick! 🤒", droopy ears + thermometer-in-mouth prop (procedural), sneeze every ~20 s, HUD shows a small 🤒 chip → tapping it opens the care sheet (medicine/vet options). Sleep, feeding (healthy food), washing all still work.

**C3.5 Cures & prices:** **Medicine** — shop item (Care section of the food tab + quick-delivery eligible), price **40c**, markup-free at the vet counter; using: open fridge tray → Care row → drag the bottle to Gooby (grimace-then-relief anim). Sick + medicine → queasy; queasy + medicine → healthy. **Vet trip** — drive to the clinic (§C9), pay **120c**: full cure from any state, junk/neglect counters reset, +10 all stats, bandaged-ear sticker gag for 10 min. **Checkup** — 30c at the vet anytime: health report card (junkScore band, neglect, weight tier) + resets `neglectMin` to 0. Sick notification (id 7): scheduled 4 h after backgrounding while sick, max 1/day, quiet-hours respected; „Gooby fühlt sich nicht gut… 💊" / "Gooby isn't feeling well… 💊".

**C3.6 Tests (`health.test.js`):** every transition at exact thresholds; decay timing; healthy-food reduction; 60-min recovery window resets on junk; medicine from both states; vet cure resets; offline progression of junk decay/neglect (0.3× cap rules); minigame refusal flag; notification trigger.

### C4. Weight & fitness (cosmetic-only)

**C4.1 Model:** §B5 numbers (junk +2, healthy +0.5, active game −1, other game −0.25, ball fetch −0.2, drift toward 50 at 2/day). Range clamp 5–95, start 50.

**C4.2 Never punishing (binding):** weight NEVER changes stats, decay rates, minigame availability, scores, or prices. It only changes Gooby's silhouette, some anim flavor, and unlocks two funny achievements (both directions celebrated).

**C4.3 Cosmetic tiers:**

| tier | range | body scale (X/Z on the lathe body + belly patch) | flavor |
|---|---|---|---|
| Sleek „Sportlich" | ≤ 25 | 0.93 | slightly quicker hop cadence (idle only) |
| Chubby „Knuffig" (default) | 26–60 | 1.00 | — |
| Extra Chonky „Extra moppelig" | 61–85 | 1.07 | landing squash +10%, belly wobble on poke +20% |
| Maximum Floof „Maximal flauschig" | ≥ 86 | 1.14 | bounce anims 10% slower + extra jiggle; achievement `chonkZone` |

Tier changes animate over 2 s (never pop) and re-fit outfit anchors (anchors scale with the body group — verify hat/scarf still sit right at 0.93 and 1.14 in the showcase scene). Stats screen shows tier with a friendly framing („Gooby ist perfekt, so wie er ist" / "Gooby is perfect just the way he is").

**C4.4 Tests (`weight.test.js`):** gain/loss per source; clamp; drift both directions incl. offline; tier mapping + hysteresis-free boundaries (25/60/85 exact); ACTIVE_GAMES list matches minigame ids.

### C5. Progression: daily quests, achievements, level curve

**C5.1 Daily quest board.** Engine per §B7. HUD button (clipboard icon) from L2; screen shows 3 cards (progress bar, reward, claim button), the reroll button, and „Neue Quests um Mitternacht" / "New quests at midnight". **Quest pool (binding, 28 entries → `constants.QUEST_POOL`):**

| id | category | condition (event → target) | reward coins / XP | requires |
|---|---|---|---|---|
| q.feed3 | care | feed ×3 | 20 / 10 | — |
| q.feedHealthy2 | care | feed non-junk food ×2 | 25 / 10 | — |
| q.wash1 | care | complete a wash ×1 | 20 / 10 | — |
| q.pet5 | care | pet strokes ×5 | 15 / 8 | — |
| q.tickle3 | care | tickles ×3 | 15 / 8 | — |
| q.ball3 | care | ball fetches ×3 | 20 / 10 | — |
| q.sleep1 | care | completed nap ×1 | 25 / 12 | — |
| q.medicineCabinet | care | check the stats screen ×1 | 10 / 5 | — |
| q.play3 | games | finish any minigame ×3 | 30 / 15 | — |
| q.play2distinct | games | finish 2 different minigames | 25 / 12 | — |
| q.earn60 | games | earn 60 coins from minigames | 30 / 15 | — |
| q.catch30 | games | score ≥ 30 in carrotCatch | 25 / 12 | — |
| q.hop10 | games | score ≥ 10 in bunnyHop | 25 / 12 | — |
| q.run200 | games | score ≥ 200 in runner | 30 / 15 | runner unlocked |
| q.fish5 | games | catch 5 fish in fishingPond (meta) | 25 / 12 | fishingPond unlocked |
| q.dance150 | games | score ≥ 150 in danceParty | 30 / 15 | danceParty unlocked |
| q.tricks5 | games | 5 tricks in one trampoline round (meta) | 25 / 12 | trampoline unlocked |
| q.golfPar | games | finish miniGolf with score ≥ 70 | 30 / 15 | miniGolf unlocked |
| q.says6 | games | reach round 6 in goobySays | 25 / 12 | goobySays unlocked |
| q.plant2 | garden | plant 2 seeds | 20 / 10 | garden (L3) |
| q.water4 | garden | water 4 times | 20 / 10 | garden (L3) |
| q.harvest2 | garden | harvest 2 crops | 30 / 15 | garden (L3) |
| q.sell1 | garden | sell ≥ 1 harvest item | 15 / 8 | garden (L3) |
| q.drive1 | economy | complete a shop trip | 30 / 15 | — |
| q.cleanDrive | economy | trip/delivery with 0 crashes | 35 / 15 | — |
| q.deliver3 | economy | deliver 3 parcels in deliveryRush | 30 / 15 | deliveryRush unlocked |
| q.buyFood1 | economy | buy any food | 15 / 8 | — |
| q.photo1 | economy | take a photo | 20 / 10 | — |

Average day ≈ +75c/+37xp on top of v1 income — sized so quests feel meaningful but skipping them never starves you. Tests (`quests.test.js`): deterministic roll per day-string; unlock filtering; ≥ 2 categories; progress/claim/double-claim guard; reroll once; midnight rollover via fake clock; reward payout paths.

**C5.2 Level curve.** Cap 30 → **40**; formula unchanged. New XP sources: quest rewards (table above), harvest +2 XP each, delivery +3 XP each, photo +1 XP (max 5/day), sticker +5 XP, set completion +50 XP. Milestone unlocks per §B6 keep every level L2–L16 meaningful; L17–L40 give the level-up coin reward (25·L, up to 1000c) plus bragging rights on the profile screen.

**C5.3 Achievements 16 → 33 (append to `data/achievements.js`; same def shapes — `counter` or `special`):**

| id | name EN / DE | condition | coins |
|---|---|---|---|
| firstHarvest | Green Thumb / Grüner Daumen | harvests ≥ 1 | 15 |
| harvest50 | Farmer Gooby / Bauer Gooby | harvests ≥ 50 | 100 |
| allCrops | Crop Collector / Erntemeister | special: all 8 crops harvested ≥ 1 (collections veggies) | 120 |
| firstQuest | Go-Getter / Macher | questsDone ≥ 1 | 10 |
| quest50 | Quest Machine / Questmaschine | questsDone ≥ 50 | 120 |
| firstSticker | Sticker Time / Stickerzeit | special: collections entries ≥ 1 | 10 |
| setComplete | Album Page / Albumseite | special: ≥ 1 set claimed | 60 |
| albumFull | Completionist / Komplettsammler | special: all 4 sets claimed | 300 |
| firstCure | Get Well Soon / Gute Besserung | cures ≥ 1 | 20 |
| vetVisit | Checkup Champ / Vorsorge-Profi | vetTrips ≥ 1 | 20 |
| neverSick | Health Nut / Gesundheitsfan | special: reach L10 with 0 sick states ever | 150 |
| chonkZone | Maximum Floof / Maximal flauschig | special: weight ≥ 86 reached | 40 |
| sleekMode | Featherweight / Federgewicht | special: weight ≤ 25 reached | 40 |
| play21 | Arcade Legend / Arcade-Legende | special: each of 21 games played ≥ 1 | 250 |
| delivery10 | Parcel Pro / Paket-Profi | deliveries ≥ 10 | 80 |
| holeInOne | Hole in One! / Ass! | special: miniGolf meta.holeInOnes ≥ 1 | 50 |
| shutterbug | Shutterbug / Knipser | photosTaken ≥ 10 | 60 |

(v1's 16 unchanged; `play12` stays valid.) Tests: extend `achievements.test.js` — all 33 reachable via counters/specials.

### C6. Collections / sticker album (4 sets, 32 stickers)

Album screen (`albumScreen.js`, from L1): 4 pages, sticker slots show grey silhouettes until earned, counts on repeats, set progress bar + claim button. Every sticker: name EN+DE + one flavor line EN+DE.

| set id | entries (8/8/6/10) | how earned | completion reward |
|---|---|---|---|
| fish „Teichfische" | sunnyCarp, blueDace, pinkKoi, stripeBass, tinyMinnow, bigWhopper, nightEel, goldenFish | fishingPond assigns a species to every catch via seeded size+color roll (S→minnow/dace/carp, M→koi/bass, L→whopper/eel); goldenFish = 2% roll on any L catch. Game reports `meta.caught` (§B3). nightEel only spawns during the night band (§C10) — cross-feature hook. | 200c + „Goldfish Bowl" bedroom deco (procedural, `furniture.owned`) |
| veggies „Gemüsegarten" | radish, carrot, salad, tomato, corn, eggplant, pumpkin, watermelon | first harvest of each crop (garden.harvest → collections.award) | 150c + „Golden Watering Can" garden deco (procedural, gilded) |
| landmarks „Stadt-Sehenswürdigkeiten" | shop, vetClinic, fountain, skyTower, parkGazebo, windmillCafe | driving within 15 m during any cityDrive/deliveryRush/vet trip (`meta.landmarks`); placements §C9.3 | 150c + „Toy City" living-room shelf deco (procedural mini skyline) |
| treats „Süße Sünden" | donut-sprinkles, cupcake, ice-cream, cake, cookie, candy-bar, lollypop, sundae, chocolate, muffin | eat each once (feed pipeline → collections.award) — deliberately tugs against the health system: sticker hunters risk a tummy ache (design wink, mention in flavor text) | 150c + „Candy Jar" kitchen deco (procedural) |

Tests (`collections.test.js`): award/count/first-time flag; fish species roll determinism + goldenFish rate over 10k seeded rolls (2% ±0.5); night-gated eel; set completion + single claim; reward lands in furniture.owned.

### C7. Foods 16 → 32 (append to `constants.FOOD_TABLE`; all GLBs from food-kit)

New `junk` flag: v1 rows `donut-sprinkles, cupcake, ice-cream, pizza, cake` become `junk: true`; all other v1 rows `junk: false`. **16 new foods:**

| id (glb) | price | hunger | fun | other | junk | source |
|---|---|---|---|---|---|---|
| radish | 5 | +8 | +1 | | no | crop harvest + shop |
| tomato | 7 | +12 | +1 | | no | crop harvest + shop |
| corn | 10 | +15 | +2 | | no | crop harvest + shop |
| eggplant | 12 | +16 | +1 | | no | crop harvest + shop |
| pumpkin | 22 | +26 | +4 | | no | crop harvest + shop |
| strawberry | 8 | +6 | +6 | | no | shop |
| grapes | 9 | +8 | +5 | | no | shop |
| croissant | 11 | +14 | +3 | | no | shop |
| lollypop | 6 | +2 | +8 | | YES | shop |
| cookie | 8 | +5 | +8 | | YES | shop |
| chocolate | 9 | +5 | +9 | | YES | shop |
| candy-bar | 10 | +4 | +11 | | YES | shop |
| muffin | 12 | +10 | +8 | | YES | shop |
| fries | 14 | +12 | +9 | −1 hygiene (greasy) | YES | shop |
| corn-dog | 15 | +18 | +6 | | YES | shop |
| sundae | 18 | +7 | +14 | +3 energy (sugar rush) | YES | shop |

(16 new ids; crop foods are also shop-purchasable so the tray never dead-ends. v1's `carrot`, `salad`, `watermelon` additionally become crop-harvestable — their table rows are unchanged.) Total catalog: **32**. Shop food tab gains category filters: Alle/Gesund/Süßkram · All/Healthy/Treats, plus the Care row (medicine 40c, fertilizer 25c — rendered distinctly, not eatable-looking). Junk foods show a tiny 🍬 badge; the tray shows Gooby's current junkScore band as a subtle belly icon (green/yellow/orange) — informed players, no nagging.

### C8. Furniture, wallpapers, floors, outfits, skins

**C8.1 Indoor furniture additions (all GLBs already committed in v1's furniture-kit whitelist — zero new assets):** living: `loungeChair` 180, `tableCoffee` 140, `tableCoffeeGlass` 200, `cabinetTelevision` 160, `radio` 90, `speaker` 110, `ceilingFan` 150; kitchen: `kitchenMicrowave` 130, `kitchenBar` 240, `stoolBar` 80 (pairs with bar); bathroom: `washer` 260, `shower` 300 (3rd tub variant); bedroom: `sideTable` 90, `sideTableDrawers` 130, `cabinetBed` 170, `cabinetBedDrawer` 190, `coatRackStanding` 100, `pillow` 45, `pillowBlue` 45, `books` 35, `trashcan` 40 (any room). New wall-art canvases (procedural): „City Skyline" 140, „Rainbow" 140. = **23 new indoor buyables**; each maps to an existing or new slot in `rooms/*.js` (new slots: living `ceilingFan`+`sideboard`, kitchen `bar`, bathroom `washer`, bedroom `sideTable`+`floorClutter`).

**C8.2 Wallpapers 6 → 10, floors 4 → 7 (all procedural CanvasTextures — extend the painter in roomManager):** wallpapers + `sunset` (warm gradient + sun disc) 150, `meadow` (leafy motif) 150, `candy` (pastel stripes) 150, `ocean` (wave curls) 200. Floors + `marble` 180, `walnut` (dark planks) 160, `terracotta` (warm tiles) 140.

**C8.3 Garden decor slots (6 slots, 12 items):** `gardenBench` — wooden bench (procedural) free default / painted pastel bench 220; `gardenGnome` — none default / garden gnome (procedural, pointy hat) 180 / golden gnome 900 (endgame flex); `birdbath` — none / birdbath (procedural) 240; `flowerBed` — wildflowers (nature-kit flower cluster) free / rose bed (tinted) 160; `gardenPath` — dirt free / stone path (suburban `path-stones-short`) 190; `gardenTree` — nature `tree_default` free / blossom tree (tinted `tree_oak`, pink canopy) 260.

**C8.4 Outfits 11 → 20 (9 new, all procedural on existing anchors):** hats: `strawHat` 160 (garden brim + band), `chefHat` 220 (white cylinder puff), `flowerCrown` 180 (torus + 6 flower blobs), `wizardHat` 350 (bent cone + stars); glasses: `heartGlasses` 220 (heart-shaped rims), `monocle` 400 (single rim + chain); neck: `bandana` 130 (triangle fold), `bellCollar` 160 (strap + jingling bell — bell SFX on hop), `cape` 500 (cloth-sim-free rigid swoosh with hop flutter). Wardrobe screen unchanged (3 slots); shop Outfits tab lists all 20.

**C8.5 NEW: Gooby fur-color skins (`data/skins.js`, shop „Skins" tab from L5; equipped skin persists and applies everywhere incl. photo mode and minigame cameos):**

| id | name EN / DE | BODY / BELLY / EAR_INNER | price |
|---|---|---|---|
| cream | Classic Cream / Cremeklassiker | #F6EAD7 / #FFF9EC / #F6A8B8 | free (default) |
| snow | Snow Bunny / Schneehase | #FAFAFA / #FFFFFF / #F2B8C6 | 400 |
| caramel | Caramel / Karamell | #D9A86C / #F2DDBD / #E89AAB | 400 |
| ash | Grey Puff / Grauer Wuschel | #B9B4AE / #E8E4DE / #E0A2B4 | 500 |
| rose | Rose / Rosé | #F4C6D2 / #FBE8EE / #E88BA0 | 600 |
| midnight | Midnight / Mitternacht | #4C4A63 / #8B89A6 / #C98BA8 | 800 |
| golden | Golden Gooby / Goldener Gooby | #E8C24A / #F7E6A6 / #F0A8B8 (subtle metalness 0.25) | 1500 |

`character/skins.js` swaps the three material colors on the shared Gooby materials (cheeks/nose/eyes untouched); wardrobe screen gets a „Fell" / "Fur" category with live try-on like outfits. Skins + golden gnome + cape + crown are the headline coin sinks (§A quality bar: one 400–800c sink affordable per week at 15 min/day).

### C9. City 2.0: vet clinic + delivery missions

**C9.1 Vet clinic placement & route (extends `cityBuilder.js`; seeded determinism unchanged).** `VET_TILE = [2,2]` (north-west block — the shop sits at [3,6] east side, so the vet gives the west ring a purpose). Building: city-kit-commercial `building-e` at the tile's east half, front facing **west** toward ring column 1 (`rotY` = −90°), procedural white-cross sign (two crossed box meshes, red `#E85D5D`) over the door + suburban `tree-small` ×2 flanking. Parking apron on the tile's west half (same apron recipe as the shop). `VET_ROUTE_TILES = [[7,2],[7,1],[6,1],[5,1],[4,1],[3,1],[2,1]]` then pull east into parking — ≈ 7 tiles ≈ 140 m ≈ 25–35 s of driving (deliberately shorter than the shop trip: sick Gooby shouldn't grind). `cityLayout.test.js` extends: vet route adjacent-connected, ends adjacent to VET_TILE, no overlap with the shop parking.

**C9.2 Vet trip flow (`systems/shopTrip.js` gains a sibling mode — same state machine, `mode='vetTrip'`).** Entry points: HUD 🤒 chip (sick), care sheet button, or front door → destination picker sheet („Laden / Tierarzt" with prices) once the vet is discovered. Confirm sheet shows „Zum Tierarzt fahren? (Behandlung 120 Münzen)" / "Drive to the vet? (Treatment 120 coins)". Drive uses `VET_ROUTE_TILES` with the standard arrow/route-line system; coin pickups on route (10 instead of 20), crash rules + tow rule identical to §C4 v1. Arrival → `vetPanel.js`: Dr. Hoppel (procedural rabbit head w/ glasses on the counter — reuse Gooby head recipe, grey skin) offers **Behandlung 120c** (only when queasy/sick; full cure per §C3.5, cure animation: thermometer → sparkle → happy bounce) and **Checkup 30c** (always; report card panel). Can't afford → gentle hint that medicine costs 40c at the shop. „Nach Hause" → teleport home (no return drive, v1 ruling). `trips` counter increments; `vetTrips` counter too.

**C9.3 Landmarks (for §C6 set 3; added to `generateCityLayout` output, all on block/grass tiles, deterministic):** `shop` (existing, [3,6]), `vetClinic` ([2,2]), `fountain` — procedural 2-tier fountain at block [5,5] corner facing the cross; `skyTower` — `building-skyscraper-a` at block [2,5]; `parkGazebo` — procedural hexagonal gazebo + nature trees at block [5,2] (block tiles border the roads, guaranteeing the 15 m trigger radius is reachable from the lane); `windmillCafe` — minigolf-kit `windmill` scaled ×2.2 + awning at block [6,5]. Landmark trigger: while driving any city mode, entering a 15 m radius awards the sticker once (toast + camera-flash gag).

**C9.4 deliveryRush** reuses everything above (§C1.2 #5): starts at the shop parking, destinations sampled (seeded per round) from the 6 landmarks, drop rings at their curbside points.

### C10. Day/night cycle (real device clock)

**C10.1 Bands (local time):** night 21:00–06:00 · dawn 06:00–08:00 · day 08:00–18:00 · dusk 18:00–21:00; 30-min crossfade at each boundary (§B4).

**C10.2 Light/sky parameter table (binding → `constants.DAYNIGHT`; hemi = HemisphereLight sky/ground/intensity, dir = DirectionalLight color/intensity, window/dome sky color):**

| band | hemi | dir | window/dome sky | extras |
|---|---|---|---|---|
| day | #fff5e8 / #b8a898 / 0.90 | #fff2dd / 1.10 | #AEE0F7 | v1 defaults — day IS v1 |
| dusk | #ffd9b8 / #8a7f95 / 0.75 | #ffb98a / 0.70 | #FFB38A → #C98BB8 gradient | warm lamp PointLights auto-on (living+bedroom, #FFD9A0, 0.5) |
| night | #4a5a8a / #202535 / 0.50 | — (0.15, #9FB2E8 moonlight) | #1D2440 + procedural star dots + moon disc | lamps stay on; city drive gets the night tint + car headlight cones (2 SpotLights, player car only) |
| dawn | #ffe9d0 / #9a92a0 / 0.80 | #ffd9b0 / 0.85 | #FFD9A8 | birdsong synth chirps in the garden |

**C10.3 Behavior changes:** during night band while awake: Gooby yawns every 45 ± 15 s, eyelids bias 0.3, `sleepy` emotion wins ties — a gentle "put him to bed" nudge, no stat effect. `nightPlays` counter increments on any minigame finished 22:00–06:00 (feeds the profile screen and future quest variety only — deliberately NOT an achievement). nightEel (fish sticker) only spawns at night. Bedroom's v1 `setNight` sleep-mode overrides the band while sleeping (sleep always looks like night — v1 behavior preserved).

**C10.4 Tests (`dayNight.test.js`):** band mapping at boundary minutes (05:59/06:00/06:29/06:30…), crossfade t math, DST-agnostic (pure local-hour based), param table completeness.

### C11. Weather

**C11.1 Model:** §B4 — 6 h local blocks, deterministic hash: clear 55% / cloudy 25% / rain 20%. Same weather for every player on the same local date+block (shared-world flavor, zero storage).

**C11.2 Effects:** **cloudy** — hemi/dir intensity ×0.85, window/dome sky desaturated (+grey overlay 20%), soft cloud sprites drift across the garden dome. **rain** — intensity ×0.70, garden: instanced rain quads (pool 300, one draw call) + splash rings on the ground + rain-on-leaves synth loop (brown noise + LP 800 Hz, −18 dB, respects sfx toggle); windows (all indoor rooms): animated streak CanvasTexture overlay + occasional droplet run; **garden plots auto-water** (`applyRain`, §B4) — the forecast chip makes this a strategy („Regen kommt um 12 — spar dir das Gießen"); fishingPond gets ripple rings cosmetic if launched during rain. Gooby in the garden during rain: contently sits under the tree canopy (no stat effect, pure coziness). **clear** — v1 defaults.

**C11.3 Forecast UI:** garden HUD chip shows current + next block icon (☀️/☁️/🌧 procedural SVG icons); tapping it shows „Regen von 12–18 Uhr" / "Rain from 12–18 h".

**C11.4 Tests (`weather.test.js`):** hash determinism (fixed vectors: e.g. `weatherAt('2026-07-17', block 2)` locked to its computed state in the test), distribution over 10k blocks within ±2% of 55/25/20, block boundary math, applyRain wateredUntil extension, offline rain within sim cap.

### C12. QoL: stats/profile screen + photo mode

**C12.1 Stats/profile screen (`profileScreen.js`; HUD avatar button + settings entry; L1).** Sections top-to-bottom (single scroll, cards per §D5 v1 style): ① header — Gooby portrait (live mini render or static canvas snap), name, level + XP ring, joined date (`createdAt`), equipped skin name; ② vitals — weight tier (friendly copy §C4.3), health state, current mood band; ③ lifetime totals (2-col grid): playtime (h:mm from `profile.playtimeMin` — accumulated by `profileStats.js` on the 1 s tick, min 1-min granularity, no idle-detection cleverness), feeds, washes, naps, tickles, ball fetches, shop trips, vet visits, deliveries, harvests, photos, quests done, coins earned/spent, distance driven (km, from `profile.distanceM` fed by drive modes); ④ minigames — 21 rows: icon, name, best score, plays (scrollable, sorted by unlock); ⑤ collections — 4 set progress bars. Layout bar: 320 px = 2-col totals grid collapses to 1-col; all numbers `tabular-nums`.

**C12.2 Photo mode (`photoMode.js`; HUD camera button; L1; ZERO new Capacitor pods).** Flow: ① entering hides ALL UI except the photo toolbar (thin bottom strip) and pauses care gestures; ② toolbar: pose picker (5: `wave`, `happyBounce` freeze-frame at apex, `dance` pose, `sit` from sitDrive, `sleep` curl — plays the clip then holds its hero frame), emotion picker (happy/ecstatic/sleepy/grumpy — the funny ones), frame picker (none / „Polaroid" white border + caption „Gooby ♥" / „Sterne" star-confetti border — both drawn onto the capture canvas, procedural), background = whatever room/garden + current ambience (day/night + weather make free variety); ③ shutter: white flash + camera SFX, then capture. **Capture pipeline:** call `sceneManager.captureFrame()` (new method: renders the current scene once into the existing renderer, immediately reads `renderer.domElement.toBlob('image/png')` in the same task — no `preserveDrawingBuffer` needed), composite onto a 1080×1440 offscreen 2D canvas (3:4 portrait crop) + frame overlay, → Blob. **Save:** if `navigator.canShare({files})` (iOS WKWebView 15+, Android) → `navigator.share({files: [File]})` (gives the native share sheet incl. „Save Image"); else → `<a download="gooby-<ts>.png">` anchor click (desktop/dev). `profile.photos`+1, `photosTaken` counter, +1 XP (≤ 5/day). Exit restores UI. Tests: pure parts only (pose/frame catalog integrity, XP cap logic) — capture itself is eval-verified via screenshot.

---

## §D. Asset Plan (2.0)

All file names below were **verified 2026-07-17 by downloading and listing the actual Kenney zips** (same discovery regex as v1 — it already tolerates version-suffixed zip names like `kenney_city-kit-suburban_20.zip`). Committed v1 assets total 8.5 MB; 2.0 adds ≈ 2.5–3 MB. Target ≤ 25 MB committed; the fetch-script hard budget stays **80 MB**. Everything is CC0 Kenney or procedural. **Who fetches:** the wave-1 assets agent edits `scripts/kenney-manifest.mjs` (formats below match its existing `{slug, modelDir, files}` shape), runs `npm run fetch-assets`, commits the new GLBs + each new pack's `License.txt`, and extends `test/assets.test.js` (existence, license, budget, runtime-key resolution for every new `data/` catalog reference).

### D1. Map needs to the 9 EXISTING packs first (no download needed beyond whitelist additions)

| need | existing pack / already-committed files |
|---|---|
| vet building, skyscraper landmark | `city-kit-commercial`: `building-e` (vet), `building-skyscraper-a` (skyTower) — already committed |
| delivery van, traffic | `car-kit`: `delivery` (deliveryRush player van), rest unchanged |
| garden hedge/trees/flowers, carrot crop, dirt plots | `nature-kit`: `plant_bushLarge`, `tree_default`, `tree_oak`, `flower_*`, `crop_carrot`, `crops_dirtSingle`, `stump_round` — already committed |
| 23 new indoor furniture buyables (§C8.1) | `furniture-kit` — ALL already committed in v1's whitelist, previously unused |
| new foods with GLBs already committed | `food-kit`: `strawberry`, `corn`, `croissant`, `muffin`, `cookie`, `pear` |
| burger/veggie minigame junk items | `food-kit`: `soda-can-crushed`, `fish-bones` — already committed |
| UI/impact/jingle audio for all new games | `interface-sounds`, `impact-sounds`, `music-jingles` — reuse ids via `sfxMap.js`; NO new audio packs (rain loop, birdsong, bell collar, camera shutter, doorbell chime = WebAudio synth recipes) |

### D2. Whitelist ADDITIONS to existing manifest entries (append to `files` arrays)

**`food-kit`** (modelDir `Models/GLB format`, 26 files ≈ 0.6 MB): `tomato tomato-slice radish eggplant pumpkin grapes fries corn-dog candy-bar lollypop chocolate sundae meat-patty cheese-cut lemon lemon-half onion onion-half mushroom mushroom-half paprika paprika-slice coconut coconut-half apple-half pear-half` — new foods (§C7), burgerBuild layers (meat-patty/cheese-cut/tomato-slice), veggieChop whole+half pairs (apple/pear/lemon/onion/mushroom/paprika/tomato/coconut).

**`nature-kit`** (modelDir `Models/GLTF format`, 12 files ≈ 0.3 MB): `crops_leafsStageA crops_leafsStageB crops_cornStageA crops_cornStageB crops_cornStageC crops_cornStageD crop_melon crop_pumpkin crop_turnip pot_large pot_small bed` — crop growth stages (§C2.3), gardenRush pots, `bed` = raised garden-bed prop for the flowerBed slot.

### D3. NEW Kenney packs (append full entries to `scripts/kenney-manifest.mjs`)

1. **https://kenney.nl/assets/city-kit-suburban** — slug `city-kit-suburban`, modelDir `Models/GLB format` (kebab-case, GLB — verified). Whitelist (9 files ≈ 0.4 MB): `fence-1x4 fence-low fence-2x2 planter path-stones-short path-stones-long driveway-short tree-small tree-large`. Used for: garden back fence + FOR-SALE plot fencing, planter deco, stone garden path (§C8.3), vet clinic trees/driveway (§C9.1).
2. **https://kenney.nl/assets/minigolf-kit** — slug `minigolf-kit`, modelDir `Models/GLB format` (verified; License.txt present). Whitelist (18 files ≈ 0.7 MB): `start straight end corner hole-round hole-open ramp-low ramp-medium bump obstacle-block obstacle-triangle windmill tunnel-wide wall-left wall-right flag-red flag-blue castle`. Used for: the 6 miniGolf holes (§C1.2 #6) + `windmill` doubles as the windmillCafe landmark (§C9.3, scaled ×2.2).
3. **https://kenney.nl/assets/space-kit** — slug `space-kit`, modelDir `Models/GLTF format` (older pack: GLTF dir + snake_case — verified, same gotcha as nature/furniture kits). Whitelist (5 files ≈ 0.4 MB): `craft_speederA craft_speederB meteor meteor_detailed meteor_half`. Used for: starHopper player craft + obstacle field (§C1.2 #8; speederB = cosmetic variant for the results screen).

### D4. Procedural (code-built, zero downloads)

Garden: gnome + golden gnome, birdbath, wooden/pastel bench, watering can, compost bin, FOR-SALE sign, sky dome + stars/moon/cloud sprites, rain quads + splash rings. Health/vet: medicine bottle, fertilizer bag, thermometer prop, vet cross sign, Dr. Hoppel counter bust (reuse the Gooby head recipe, grey palette). City: fountain (2 stacked cylinders + water disc), park gazebo (hex roof + posts). Collection rewards: goldfish bowl, golden watering can, toy-city shelf, candy jar. Minigames: goobySays pads, burgerBuild buns/plate/lettuce disc, goalieGooby goal + bunny crowd (Gooby-recipe minis), pipeFlow pipe tiles, veggieChop cutting-board arena, starHopper nebula gradient dome. Photo mode: polaroid/star frames (2D canvas). Outfits (§C8.4) and skins (§C8.5): procedural like all v1 outfits. Wallpapers/floors (§C8.2): CanvasTexture painter extensions.

### D5. Asset acceptance

`test/assets.test.js` extends to: every §D2/§D3 file exists on disk with valid glTF magic; `License.txt` present for the 3 new packs; total committed size < 80 MB (report actual — expected ≈ 11 MB); every modelKey referenced from `data/crops.js`, `data/foods.js`, `data/furniture.js` (garden slots), `data/minigames.js` and `city/vetClinic.js` resolves to a committed file.

---

*End of §A–§D (plan agent 1). §E build prompts, §F eval plan, and §G runbook are appended below by plan agent 2.*




# §E. Build Waves & Agent Prompts (2.0) — plan agent 2

**How to use this section (coordinator):** 2.0 is built by **16 build agents (V2/G15 … V2/G30) in 4 waves (sizes 4/5/3/4)**. Within a wave file ownership is strictly disjoint (see each block's OWNS/DO-NOT-TOUCH lists; the only shared files are the append-only ones governed by §E0.3). Wave N+1 may rely on wave N being merged and green. To launch an agent, forward **verbatim, as one message**: (1) the agent's block from §E2–§E5, then (2) the COMMON RULES text §E0.2 — nothing else; a build agent sees nothing but that text. Between waves run the §G2 checkpoint.

## E0. Shared conventions for all 2.0 build agents

### E0.1 Design decisions made here (binding, referenced by the prompts)

1. **Strings are conflict-free via per-feature modules.** `src/data/strings.js` is edited exactly ONCE in wave 1 (by G16): it gains a static import + spread of 11 new modules under `src/data/strings/` (order after all v1 entries): `v2-core.js, v2-garden.js, v2-health.js, v2-city.js, v2-shop.js, v2-progress.js, v2-games-d.js, v2-games-e.js, v2-ambience.js, v2-audio.js, v2-polish.js`. Each module exports `{ EN, DE }` plain objects; G16 creates all 11 (10 as `{EN:{},DE:{}}` stubs) so later agents only ever edit **their own** module. After wave 1 nobody edits `strings.js` itself. `t(key)` and all EN/DE-parity tests keep working because they read the merged dictionaries.
2. **`src/data/constants.js` is edited exactly once (G16, wave 1)** with every §B/§C table that other agents consume (CROP_TABLE, QUEST_POOL, COLLECTION_SETS refs, SKIN_TABLE, DAYNIGHT, WEATHER, UNLOCKS, VET, PHOTO, NOTIFY v2, FOOD_TABLE +16, COIN_TABLE +9, LEVELING.MAX_LEVEL 40). After wave 1 the file is **read-only**. Engine-internal exact numbers (health/weight thresholds §B5, dayNight BANDS §B4, weather hash/percentages §B4) live as exported frozen consts **inside their engine module** — same single-source pattern as v1 `.logic.js` files (see `carrotCatch.logic.js`). Per-game tuning goes in the game's `.logic.js` as an exported frozen object.
3. **Wave-1 engines are catalog-injected.** `systems/garden.js` and `systems/quests.js` take the crop/pool catalog as a function parameter (`cropsById`, `pool`) instead of importing `data/crops.js`/`data/quests.js`, so G17/G18 are testable and mergeable independently of G16 within wave 1. Wave-2 wiring agents pass the real catalogs.
4. **Marked blocks.** Any edit to a file outside your OWNS list that your block explicitly grants must be additive and wrapped `// V2/G<id>: <why> (§<ref>)` — mirror the v1 `// G14:` pattern visible throughout `src/`.
5. **Append-only shared files** (`src/main.js`, `src/ui/styles.css`, `src/audio/sfxMap.js`): multiple same-wave agents may append **one marked block each**, at the anchor named in their prompt (main.js) or at end-of-file (styles.css, sfxMap.js). Protocol: make these edits **immediately before committing**; after committing run `git -C /workspace show HEAD:GOOBY/<file> | grep "V2/G<id>"` — if your block is missing (concurrent writer won), re-apply and commit again. sfxMap appends before wave 4 may only map new ids to **existing** ogg keys or **existing** synth recipe names (new bespoke recipes are G29's, wave 4).
6. **Save shape addition (extends §B2, binding):** `defaultState().onboarding` gains `whatsNew2Seen: true`; `migrations[1]` explicitly sets `onboarding.whatsNew2Seen = false` so only migrated v1 veterans see the one-time "What's new" panel (§A3 checklist 12). G16 implements + tests; G30 builds the panel.

### E0.2 COMMON RULES FOR ALL V2 BUILD AGENTS (relay this text verbatim after every agent block)

> **Product context.** GOOBY (in `/workspace/GOOBY`, a Vite + three.js + vanilla-ESM mobile web game wrapped with Capacitor for iOS) is a finished Pou/Talking-Tom-style virtual pet: a fat cream rabbit you feed, wash, play 12 arcade minigames with, and drive through a low-poly city — 440 green node:test tests, green iOS CI, bilingual EN+DE, portrait 320–430 px. GOOBY 2.0 ("Vollversion") adds 9 minigames (→21), a real-time garden room, sickness/vet/weight sim, daily quests, a sticker album, fur skins, a vet city destination, real-clock day/night + weather, a stats screen and photo mode. You are one build agent in a coordinated wave; other agents are editing OTHER files concurrently in this same checkout — file discipline is critical.
>
> **Mandatory first steps, in order:** (1) read `/workspace/GOOBY/AGENTS.md` fully (conventions + VM/CDP testing recipe); (2) read the `GOOBY/PLAN2.md` sections listed in your block above, plus §A2 (hard constraints) — PLAN2.md is your binding spec; (3) minigame agents: also read `GOOBY/PLAN.md` §E8 + §C6 shared rules, and skim `src/minigames/games/carrotCatch.js`+`.logic.js` as the shipped convention (incl. the `?autoplay=1` pattern); (4) read every existing file you will modify BEFORE editing it.
>
> **Hard rules.** Git root is `/workspace`; never touch `/workspace/MONKEYBAR` or files outside your ownership/marked-edit lists. Match CRLF line endings. Vanilla ESM + JSDoc on public APIs; `npm run lint` (ESLint 9) must stay clean. Every user-facing string via `t(key)` with BOTH EN and DE entries added ONLY in your assigned `src/data/strings/v2-*.js` module — never edit `src/data/strings.js`. `src/data/constants.js` is read-only (wave-1 agent G16 excepted); module-local exported frozen consts are the pattern for engine/game tuning. Pure modules (`systems/`, `data/`, `*.logic.js`) import no three.js/DOM. All coin movement through `systems/economy.js`. Every `audio.play('<id>')` id you introduce must be mapped in `src/audio/sfxMap.js` in the same commit (append-only marked block; existing oggs/recipes only — `test/onboarding.test.js` fails on unmapped ids). Shared-append files (`main.js`, `styles.css`, `sfxMap.js`): one marked block, appended immediately before commit, verified after commit via `git -C /workspace show HEAD:GOOBY/src/<file> | grep "V2/G<id>"`; re-apply and re-commit if lost.
>
> **Verification standard (all of it, before you commit):** `npm test` fully green (all existing suites + yours; run from `/workspace/GOOBY`); `npm run lint` clean; `npm run build` green. Runtime proof over CDP for every feature you shipped: start YOUR dev server `npx vite --port <your vite port> --strictPort --host` (never 5174 — a long-lived tmux server owns it), drive real-time headless Chrome via `chromium --headless=new --remote-debugging-port=<your CDP port>` per the AGENTS.md recipe (`Page.navigate`, `Input.dispatchTouchEvent`, `Runtime.evaluate` on `window.__gooby`, `Page.captureScreenshot`), and save screenshots + JSON state dumps to `/tmp/gooby-v2-g<id>/` (create it; descriptive snake_case names). Any NEW or CHANGED UI surface must pass the layout matrix: widths 320/375/390/430 × `?lang=en` and `?lang=de` (8 shots per surface, via `Emulation.setDeviceMetricsOverride`), STRICT bar — zero clipped/overlapping/ellipsized-into-meaninglessness text, touch targets ≥ 44 px (keep 48 where possible). Minigame agents additionally: 5 `?autoplay=1` completions per game with raw scores + payouts logged, every payout inside the game's §C1.1 coin row and typical runs near the row's typical value. When done, kill every process YOU started (dev server, chromium) by PID — never `pkill -f`, and never kill the tmux 5174 server.
>
> **Commit protocol:** `git -C /workspace add <explicit paths only>` (never `-A`), one commit, message `GOOBY V2/G<id>: <summary>`. NEVER push. On a `.git/index.lock` error wait 5 s and retry (up to 10×) — other agents commit concurrently.
>
> **Report back (compact, in this order):** ① what shipped vs your mission (feature list, one line each); ② contracts/APIs you exposed for later agents (JSDoc signatures); ③ evidence: `/tmp/gooby-v2-g<id>/` inventory + the 3–6 most probative screenshots/dumps named; ④ tables where applicable (autoplay score/payout runs; test counts before→after; layout matrix pass grid); ⑤ anything deferred or left for later agents (be explicit — the coordinator schedules follow-ups from this); ⑥ your commit hash(es).

### E0.3 Ports (per concurrent slot; also in §G1)

| slot | vite port | CDP port |
|---|---|---|
| A | 5175 | 9221 |
| B | 5176 | 9222 |
| C | 5177 | 9223 |
| D | 5178 | 9224 |
| E | 5179 | 9225 |

Slot = the agent's position in its wave listing below. Port 5174/tmux (`gooby-dev-server`) belongs to the coordinator; agents never use or kill it.

## E1. Wave overview

| wave | agents (slot) | theme |
|---|---|---|
| 1 | G15 (A) assets · G16 (B) data spine + save v2 + economy v2 · G17 (C) engines: dayNight/weather/health/weight · G18 (D) engines: garden/quests/collections/profileStats | pure foundations; zero UI; game still boots unchanged |
| 2 | G19 (A) garden space · G20 (B) pet-sim & time wiring · G21 (C) city 2.0 + vet · G22 (D) content & shop 2.0 · G23 (E) progression UI & meta wiring | everything visible & wired; garden + vet + quests + album + profile + photo live |
| 3 | G24 (A) games goobySays/gardenRush/burgerBuild · G25 (B) games starHopper/pipeFlow · G26 (C) ambience visuals (day/night/weather everywhere) | 17/21 games; world reacts to the clock |
| 4 | G27 (A) games veggieChop/goalieGooby · G28 (B) games deliveryRush/miniGolf · G29 (C) audio & reactions 2.0 · G30 (D) onboarding/What's-new/docs/integration sweep | 21/21 games; polish; ship-ready |

**§A3 coverage map (criterion → owner):** counts row minigames→G16 meta + G24/25/27/28 impl; foods→G16+G15+G22; crops→G16+G18+G19; outfits/skins/wallpapers/floors/furniture→G22 (+G19 painter/garden slots, G16 skin data); achievements→G16 defs + G23 engine; quests→G16 pool + G18 engine + G23 UI; collections→G16+G18+G23 (+sources G20 treats, G21 landmarks, G23 fish, G18 veggies); rooms 5→G19; destinations 2→G21; cap 40→G16. Checklist: 1 garden→G18/G19/G20; 2 sickness→G17/G20/G21; 3 weight→G17/G20; 4 quests→G18/G23; 5 album→G18/G23; 6 vet+delivery→G21/G28; 7 day/night+weather→G17/G19/G26; 8 stats+photo→G18/G23; 9 new-game harness→game agents; 10 save v2→G16; 11 lint/test/build/CI→every agent + §G checkpoints; 12 onboarding+What's-new→G30. Minigame↔agent (exactly one owner each): goobySays/gardenRush/burgerBuild→G24 · starHopper/pipeFlow→G25 · veggieChop/goalieGooby→G27 · deliveryRush/miniGolf→G28.

---

## E2. WAVE 1 — foundations (launch G15, G16, G17, G18 in parallel)

### V2/G15 — Kenney assets 2.0 (slot A)

> You are build agent V2/G15 for GOOBY 2.0 "Vollversion". GOOBY is a finished, eval-hardened virtual-pet game in `/workspace/GOOBY`; 2.0 grows it into a full Pou-class product, and every 3D/audio asset it uses is CC0 Kenney or procedural, fetched by a whitelist manifest and committed to the repo. **Your mission:** land every 2.0 asset per PLAN2.md §D — extend the manifest, fetch, commit, and harden the asset tests — so wave-2+ agents find every GLB already on disk.
>
> **Read (after AGENTS.md):** PLAN2.md §D (all), §A2 item 4, §C1.2 (which games use which packs), §C2.1/§C2.3 (garden models), §C8.1/§C8.3 (furniture ids), §C9.1/§C9.3 (vet/landmark models). Then read `scripts/kenney-manifest.mjs`, `scripts/fetch-kenney.mjs`, `test/assets.test.js`.
>
> **OWNS (create/modify):** `scripts/kenney-manifest.mjs` (append §D2 whitelist additions to `food-kit` + `nature-kit`; append the 3 §D3 pack entries `city-kit-suburban`, `minigolf-kit`, `space-kit` with the model dirs/casing exactly as §D3 states — they were verified against the real zips), `scripts/fetch-kenney.mjs` (only if a discovery/casing fix is genuinely required — §D says the regex already tolerates suffixed zips), `public/assets/kenney/**` (new fetched files + 3 new `License.txt`), `test/assets.test.js`.
> **DO NOT TOUCH:** anything under `src/` or `test/` besides `assets.test.js`; `data/*` catalogs (G16's, same wave); no strings, no constants.
>
> **Deliverables:** run `npm run fetch-assets`; commit exactly the whitelisted new files; extend `test/assets.test.js` per §D5 — every §D2/§D3 file exists with valid glTF magic; `License.txt` present for the 3 new packs; total committed size < 80 MB hard (report actual; expected ≈ 11 MB, target ≤ 25 MB per §A2.4); plus a **dynamic catalog-reference check**: for each of `src/data/crops.js`, `src/data/foods.js`, `src/data/furniture.js`, `src/data/minigames.js`, `src/city/vetClinic.js` that exists on disk at test time, scan it for `'<pack>/<file>'` model-key string literals and assert each resolves to a committed file (this auto-strengthens as G16/G19/G21 merge — do not hard-import those modules).
>
> **Contracts exposed:** asset keys per §D2/§D3 (e.g. `'minigolf-kit/windmill'`, `'space-kit/craft_speederA'`, `'nature-kit/crops_cornStageC'`, `'food-kit/meat-patty'`, `'city-kit-suburban/fence-1x4'`) loadable via `assets.getModel(key)`.
> **Verification specifics:** `npm test`/lint green; a small CDP check that `assets.getModel('minigolf-kit/windmill')` + one model per new pack loads in the browser without console errors (dump `renderer.info` + screenshot of a quick scene or console log to `/tmp/gooby-v2-g15/`). Print the size table in your report. No UI → no layout matrix.
> **Dependencies:** none. **Ports:** vite 5175 / CDP 9221.

### V2/G16 — data spine, save v2, economy v2 (slot B)

> You are build agent V2/G16 for GOOBY 2.0 "Vollversion". GOOBY keeps every design number in `src/data/constants.js`, every string in EN+DE dictionaries, and a versioned save with migrations; 2.0 doubles the content catalogs and moves the save to schema v2. **Your mission:** land the entire 2.0 data layer — constants, catalogs, string-module infrastructure, save v2 + lossless v1 migration, economy/leveling API extensions — so every later agent only consumes, never invents, numbers.
>
> **Read (after AGENTS.md):** PLAN2.md §B (ALL — §B2 save v2 and §B3 contract deltas are your core spec), §C1.1, §C2.3, §C5.1, §C5.3, §C6 (set/entry ids + rewards), §C7, §C8.5, §B6, §E0.1 (strings-module + constants rulings, save addition §E0.1-6). Then read `src/core/save.js`, `src/data/constants.js`, `src/data/{strings,foods,minigames,achievements}.js`, `src/systems/{economy,leveling}.js`, `test/{save,economy,minigameMeta,leveling}.test.js`.
>
> **OWNS (create/modify):** `src/data/constants.js` (ONE marked `// V2/G16` region: CROP_TABLE §C2.3, QUEST_POOL §C5.1 [28 entries: id/category/event/target/coins/xp/requires], COLLECTIONS §C6 [4 sets, entry ids, rewards], SKIN_TABLE §C8.5, DAYNIGHT §C10.2, WEATHER block/percent params §C11.1, UNLOCKS §B6, VET prices §C3.5/§C9.2, PHOTO §C12.2 [XP cap 5/day, canvas 1080×1440], NOTIFY: ids `harvest:6, sick:7`, MAX_SCHEDULED 7 §B3, FOOD_TABLE +16 rows §C7 + `junk` flags on the 5 §C7-listed v1 rows, COIN_TABLE +9 rows §C1.1, LEVELING.MAX_LEVEL 40 §B3, ITEM prices medicine 40/fertilizer 25); `src/data/crops.js`, `src/data/quests.js`, `src/data/collections.js`, `src/data/skins.js` (new catalogs deriving from constants; §B1 shapes); `src/data/foods.js` (expose `junk` on FoodItem; +16 catalog rows); `src/data/minigames.js` (9 new metadata entries: id/title-key/minLevel per §B6/coin rows); `src/data/achievements.js` (+17 defs §C5.3); `src/data/strings.js` (the ONE-TIME §E0.1-1 spread edit) + create `src/data/strings/` with all 11 modules (own `v2-core.js` content: 9 `mg.title.*`, 16 food names, 8 crop names, 28 quest titles/descriptions, 4×~8 sticker names + flavor lines, 17 achievement names, 7 skin names, notify id-6/7 copy §C2.4/§C3.5 — all EN+DE; the other 10 modules as `{EN:{},DE:{}}` stubs with an ownership header comment naming the owning agent); `src/core/save.js` (SAVE.VERSION 2, `defaultState()` v2 slices §B2 verbatim incl. `onboarding.whatsNew2Seen:true`, `migrations[1]` per §B2 steps 1–4 + `whatsNew2Seen=false`, `validate()` changes §B2.4); `src/systems/economy.js` (§B3 additive APIs: `sellHarvest(store, foodId, qty)`, `buySeed(store, cropId)`, `buyItem(store, 'medicine'|'fertilizer')`, `useMedicine(store)`, `payVet(store, kind)`, `buySkin(store, id)`, `buyPlot(store, index)`; every award/spend also increments `profile.coinsEarned/coinsSpent`); `src/systems/leveling.js` (MAX_LEVEL 40 clamp; curve unchanged); `test/saveV2.test.js` + `test/fixtures/` (≥3 v1 fixtures per §B2), NEW `test/dataV2.test.js` (catalog integrity: counts 32/8/28/4-32/7/33/21, coin rows verbatim vs §C1.1, quest pool verbatim vs §C5.1, junk flags, UNLOCKS vs §B6, EN/DE parity for every v2 key), extend `test/economy.test.js` (9 new TYPICAL rows derived from §C1.1 typical payouts; v2 sim day: + quest rewards ≈ +75c/+37xp §C5.1 and one radish+carrot garden cycle — assert average day still nets ≥ +40c and food affordable; do NOT tune constants — report numbers if a bar fails), extend `test/minigameMeta.test.js` (21 ids) + `test/leveling.test.js` (cap 40; cumulative L40 = 40 950 XP §B3).
> **DO NOT TOUCH:** `systems/` engine files (G17/G18's, same wave), `test/assets.test.js` (G15's), anything under `src/ui`, `src/home`, `src/character`, `src/minigames`, `src/city`.
>
> **Contracts exposed:** all §B2 save slices at their exact defaults; catalog getters mirroring v1 style (`CROPS`, `CROPS_BY_ID`, `QUEST_POOL`, `COLLECTION_SETS`, `SKINS`…); the §B3 economy signatures above (JSDoc: each returns `{ok:boolean, …}` mirroring v1 `buyFood`); `payVet` applies §C3.5 cure/checkup effects by calling `systems/health.js` pure APIs **only if that module exists at runtime** — wrap in a lazy dynamic import with a `// V2/G20 wires fully` note (health lands this same wave; keep your unit tests catalog-pure).
> **Verification specifics:** whole suite green (expect ≈ +80 tests); CDP boot check: fresh boot AND a seeded v1 save in localStorage both load to the living room with no console errors, `__gooby.store.get('v') === 2`, v1 coins/level intact (dump before/after JSON to `/tmp/gooby-v2-g16/`). No new UI → no layout matrix.
> **Dependencies:** none (do not import G17/G18 engines in tests). **Ports:** vite 5176 / CDP 9222.

### V2/G17 — pure engines: dayNight, weather, health, weight (slot C)

> You are build agent V2/G17 for GOOBY 2.0 "Vollversion". GOOBY's correctness lives in pure, headless-testable modules under `src/systems/` — no three.js/DOM imports — that wave-2 agents wire into the tick loop and UI. **Your mission:** implement four 2.0 simulation engines exactly per spec: real-clock day/night bands, deterministic shared weather, the sickness state machine, and the cosmetic weight model.
>
> **Read (after AGENTS.md):** PLAN2.md §B4 (dayNight + weather — exact), §B5 (health + weight — exact numbers), §C3 (sickness spec incl. thresholds/cures), §C4 (weight tiers), §C10.1/§C10.4, §C11.1/§C11.4, §E0.1-2/-3 (numbers live in-module; engines are catalog-free). Then read `src/systems/stats.js` + `src/systems/sleep.js` (the house pure-state-machine style) and `src/core/clock.js`.
>
> **OWNS (create):** `src/systems/dayNight.js`, `src/systems/weather.js`, `src/systems/health.js`, `src/systems/weight.js`; `test/dayNight.test.js`, `test/weather.test.js`, `test/health.test.js`, `test/weight.test.js`.
> **DO NOT TOUCH:** everything else — no constants.js (G16 owns it this wave; your §B4/§B5 numbers are exported frozen consts in your modules), no strings (engines have no user-facing text), no timeEngine/offline wiring (G20's, wave 2).
>
> **Contracts exposed (JSDoc these exactly; wave-2 consumers code against them):**
> `dayNight.bandAt(ms) → {band:'night'|'dawn'|'day'|'dusk', tInBand:number, blend:{from:string,to:string,t:number}|null}` (blend non-null only in the first 30 min of a band); `dayNight.BANDS`.
> `weather.blockOf(ms) → {dayStr:string, blockIdx:0|1|2|3, start:number, end:number}`; `weather.weatherAt(ms) → {state:'clear'|'cloudy'|'rain', start:number, end:number}`; `weather.forecast(ms) → [current, next]`; `weather.hash32(str) → number` (locked by fixed-vector tests).
> `health.tick(h, dtMin, lowStatCount, opts?) → {h, events:string[]}` (pure slice-in/slice-out; events like `'becameQueasy'|'becameSick'|'recovered'|'tummyWarning'`); `health.onEat(h, food) → h` (food has `.junk`); `health.useMedicine(h) → {h, ok}`; `health.vetCure(h) → h`; `health.vetCheckup(h) → h` (resets neglectMin); `health.canPlayMinigame(h) → boolean` (false only while sick); exported `HEALTH` frozen consts (§B5 thresholds verbatim).
> `weight.onEat(w, food) → w`; `weight.onMinigameEnd(w, gameId) → w`; `weight.onBallFetch(w) → w`; `weight.tick(w, dtMin, mult=1) → w` (drift toward 50 @ 2/24 h; offline callers pass mult 0.3); `weight.tierOf(value) → 'sleek'|'chubby'|'chonky'|'floof'`; exported `WEIGHT` consts incl. `ACTIVE_GAMES` (§B5 list verbatim — includes the four wave-3/4 game ids; that is fine, they are just strings).
>
> **Tests (binding, per §C3.6/§C4.4/§C10.4/§C11.4):** every health transition at exact thresholds (junkScore 5/8, neglect 120/360, 60-clean-min recovery resetting on junk); junk decay 1/120 min and healthy-food −0.5; medicine from both states; vet cure reset; band mapping at boundary minutes (05:59/06:00/06:29/06:30/17:59/18:00/20:59/21:00); crossfade t math; DST-agnostic (pure local-hour); weather determinism fixed vectors + distribution over 10k blocks within ±2% of 55/25/20; block boundary math; weight gain/loss per source, clamp [5,95], drift both directions, tier boundaries 25/60/85 exact.
> **Verification specifics:** suite green (expect ≈ +60 tests), lint clean; engines are pure so CDP proof = boot smoke only (no console errors, dump to `/tmp/gooby-v2-g17/`). No UI → no layout matrix.
> **Dependencies:** none. **Ports:** vite 5177 / CDP 9223.

### V2/G18 — pure engines: garden, quests, collections, profileStats (slot D)

> You are build agent V2/G18 for GOOBY 2.0 "Vollversion". GOOBY 2.0's headline features — a real-time crop garden, a daily quest board, a sticker album, and a lifetime-stats profile — are all driven by pure engines you will build; UI and wiring land in wave 2 on top of your exact signatures. **Your mission:** implement the four engines per §B7/§C2 with catalog-injection (§E0.1-3) and exhaustive unit tests.
>
> **Read (after AGENTS.md):** PLAN2.md §B7 (quests + collections — exact), §C2.3 (growth model — exact), §C2.5, §C5.1 (pool semantics: event names, categories, requires), §C6 (set semantics + rewards), §C12.1 (profile totals list), §B2 (the save slices your engines mutate: `garden`, `quests`, `collections`, `profile`), §E0.1-3. Then read `src/systems/{sleep,dailyBonus}.js` (house style: pure slice machines, localDay seeding) and `src/systems/achievementsEngine.js` (how counters/rewards flow).
>
> **OWNS (create):** `src/systems/garden.js`, `src/systems/quests.js`, `src/systems/collections.js`, `src/systems/profileStats.js`; `test/garden.test.js`, `test/quests.test.js`, `test/collections.test.js`, `test/profileStats.test.js`.
> **DO NOT TOUCH:** everything else. No imports of `data/crops.js`/`data/quests.js` (G16 lands them this wave — your functions take catalogs as parameters; your tests inject §C2.3/§C5.1-shaped fixtures copied from the spec). Skip fish-species tests (they belong to G23's fishingPond work, wave 2 — leave a comment slot in `collections.test.js`).
>
> **Contracts exposed (JSDoc exactly):**
> `garden.plant(g, plotIdx, cropDef, nowMs) → {g, ok}`; `garden.water(g, plotIdx, cropDef, nowMs) → {g, ok}` (sets `wateredUntil = nowMs + cropDef.wateredWindowMin*60000`, no stacking; increments `waterings`); `garden.fertilize(g, plotIdx, cropDef) → {g, ok}` (once per planting, `progressMin += 0.25*growthMin`); `garden.tick(g, nowMs, cropsById) → {g, events}` — accrues `progressMin` 1:1 with real minutes only while `now < wateredUntil`, bookkept via `g.lastTickAt` so it is **idempotent and safe to call from multiple sites**; `garden.applyRain(g, rainStart, rainEnd, cropsById) → g` (§B4: every planted plot's `wateredUntil = max(wateredUntil, rainEnd)`); `garden.harvest(g, plotIdx, cropDef, nowMs) → {g, foodId, qty}|{ok:false}`; `garden.readyAt(plot, cropDef, nowMs) → number|null` (null when current waterings can't reach readiness — feeds notification id 6, §C2.4); `garden.progressPct(plot, cropDef) → 0..1` (render stages at 0/33/66/100); `garden.sellValue(cropDef, qty)`; `garden.canBuyPlot(g, index, level) → {ok, price}` (§B6: plot 5 = L10/300c, plot 6 = L16/600c).
> `quests.rollDaily(q, nowMs, pool, ctx) → q` (ctx = `{level, unlockedGameIds, gardenUnlocked}`; mulberry32(hash32(localDay)) seeded pick of 3, `requires`-filtered, ≥2 distinct categories; no-op when `q.day` matches); `quests.track(q, event, n=1, meta, pool) → {q, changed}`; `quests.claim(q, id, pool) → {q, reward:{coins,xp}}|{ok:false}`; `quests.reroll(q, nowMs, pool, ctx) → {q, ok}` (once/day, `hash32(localDay+':r')`, only unclaimed+un-progressed replaced); `quests.claimableCount(q, pool)`. Do NOT import `hash32` from `systems/weather.js` (G17 lands it concurrently this wave) — duplicate a tiny local `hash32` and mark it `// same xmur3 recipe as systems/weather.js`.
> `collections.award(c, setId, entryId, n=1) → {c, first:boolean}`; `collections.isSetComplete(c, setId, setDef)`; `collections.claimSet(c, setId, setDef, nowMs) → {c, reward}|{ok:false}`; `collections.setProgress(c, setDef) → {have, total}`.
> `profileStats.tickPlaytime(p, dtMin)`; `profileStats.onCoins(p, {earned, spent})`; `profileStats.onDistance(p, meters)`; `profileStats.onPhoto(p)`; all pure on the `profile` slice.
>
> **Tests (binding, per §C2.5/§C5.1/§C6):** plant/water/harvest roundtrip per crop; progress halts unwatered; watered-window math for all 8 §C2.3 rows (fixture = the table verbatim); fertilizer once-only; offline-style long `tick` gaps incl. `applyRain` interplay; sell math; plot purchase gating; `readyAt` prediction incl. the insufficient-watering null; deterministic quest roll per day-string; unlock filtering; ≥2 categories; progress/claim/double-claim guard; reroll once + rollover via injected `nowMs`; collections award/count/first-flag; set completion + single claim; reward object passthrough; profile accumulators.
> **Verification specifics:** suite green (expect ≈ +70 tests), lint clean, boot smoke via CDP (no console errors → `/tmp/gooby-v2-g18/`). No UI → no layout matrix.
> **Dependencies:** none. **Ports:** vite 5178 / CDP 9224.

---

## E3. WAVE 2 — spaces & systems UI (launch G19–G23 in parallel; wave 1 merged & green)

### V2/G19 — garden space: 5th room, plots, panels, sky (slot A)

> You are build agent V2/G19 for GOOBY 2.0 "Vollversion". GOOBY's home is one persistent 3D scene with camera-pan "rooms"; 2.0 adds a fifth, outdoor one — the garden — where real-time crops grow, rain waters plots, and Gooby potters around under a live sky. **Your mission:** build the garden as a first-class room (3D shell, plots, interactions, seed/sell panels, sky dome, forecast chip), extend roomManager to 5 rooms + outdoor + ambience API, and extend the wallpaper/floor painter per §C8.2.
>
> **Read (after AGENTS.md):** PLAN2.md §C2 (ALL — your core spec), §B3 roomManager row, §B4 (ambience params you render), §C10.2 (DAYNIGHT table — in constants since wave 1), §C11.2/§C11.3 (rain effects are G26's wave-3 work, but the dome/forecast are yours), §C8.2 (painter additions), §C8.3 (garden decor slot names — you render slots; catalog entries are G22's), §B6 (garden L3 lock, plots 5/6). Then read `src/home/roomManager.js` (fully), `src/home/rooms/bedroom.js` (room-def shape), `src/home/interactions.js` (gesture wiring style — do not edit it), `src/ui/roomNav.js`, `src/systems/garden.js` + `src/data/crops.js` (wave 1), `src/systems/economy.js` (buySeed/sellHarvest/buyPlot/buyItem), `src/gfx/lights.js`.
>
> **OWNS (create):** `src/home/rooms/garden.js`, `src/home/gardenInteractions.js`, `src/ui/gardenPanel.js`, `src/gfx/sky.js`, `src/data/strings/v2-garden.js`. **(modify):** `src/home/roomManager.js` (5th ROOM_DEF `outdoor:true` — no walls/wallpaper/floor decor, grass CanvasTexture ground, order per §B3; `setAmbience({band, weather, blend})` API lerping lights/sky — full behavior in the garden, indoor rooms only window-sky + light-intensity hooks with a `// V2/G26 consumes` marker; L3 padlock room gating + teaser; painter: +4 wallpapers `sunset/meadow/candy/ocean`, +3 floors `marble/walnut/terracotta` per §C8.2), `src/ui/roomNav.js` (5 dots + padlocked 5th), `test/rooms.test.js` (extend: 5 room defs, garden anchors `plot0…plot5`/`compost`/`wateringCan` + §C8.3 slot anchors present, painter ids complete).
> **DO NOT TOUCH:** `home/interactions.js`, `core/timeEngine.js`, `systems/offline.js` (all G20's this wave); `home/rooms/{kitchen,living,bathroom,bedroom}.js`, `home/decor.js`, `data/furniture.js` (G22's); `ui/hud.js` (G23's — your forecast chip lives INSIDE the garden room UI/panel, not global HUD); `cityBuilder`/`shopTrip` (G21's). Shared-append per §E0.3: one marked block each in `main.js` (anchor: after the G6 offline block) and `styles.css`; sfxMap appends limited per §E0.2 (existing oggs/recipes — e.g. map `garden.water`, `garden.harvest`, `garden.plant`, `garden.sell` to existing interface/impact sounds; G29 upgrades later).
>
> **Deliverables (§C2.1/§C2.2 exactly):** garden shell (fence ×3 `city-kit-suburban/fence-1x4`, hedge, tree, sky dome from `gfx/sky.js` — one draw call, per-band colors + stars/moon at night per §C10.2, cloud/grey for cloudy — read band/weather live from `systems/dayNight.js`/`systems/weather.js` at render time; G20's ticker events refine this but must not be required); 6 plots in a 2×3 grid with growth-stage models per §C2.3 (0/33/66/100% via `garden.progressPct`), FOR-SALE sign + buy flow on plots ≥ `plotsOwned` (economy.buyPlot); tap-empty-plot → `gardenPanel` seed picker (owned seed counts, buy row, level-gated greyed); watering-can drag ≥0.5 s → water (tilt + drop particles + soil darken); tap-ready → harvest (toast „+3 🥕", inventory add via `garden.harvest` + `collections.award` veggies + counters `harvests`); compost-bin tap → sell sheet (economy.sellHarvest); fertilizer drag (economy.buyItem'd item, once per planting); decor slots render whatever `furniture.placed.garden` says via anchor names §C2.1 (G22's catalog lands this wave — code against the §C8.3 ids; free defaults render even before G22 merges); forecast chip (current+next block icons, tap → „Regen von 12–18 Uhr" sheet §C11.3); call `garden.tick(state.garden, now, cropsById)` on room enter + a 1 s in-room interval (engine is idempotent — G20's global ticker coexists safely).
> **Contracts exposed:** `roomManager.setAmbience({band, weather, blend})` (consumed by G26); `sky.makeDome(band, weather)` + `sky.windowTexture(band, weather)` (G26 uses for indoor windows); garden room anchors per §C2.1.
> **Verification specifics:** suite+lint+build green. CDP: full plant→water→(fast-forward via `?now=` re-navigation)→harvest→sell cycle for radish AND a slow crop; plot purchase; locked-garden teaser at L1 vs unlocked at L3; dome day vs night (`?now=` pinned) — screenshots + `__gooby.store.get('garden')` dumps to `/tmp/gooby-v2-g19/`. Layout matrix (8 shots per surface) for gardenPanel seed picker, sell sheet, forecast sheet. Draw calls in garden ≤ 130 / ≤ 160k tris (log `renderer.info`).
> **Dependencies:** wave 1 (garden engine G18, crops/economy G16, assets G15). **Ports:** vite 5175 / CDP 9221.

### V2/G20 — pet-sim & time wiring: health, weight, feeding, ticks, offline, notifications (slot B)

> You are build agent V2/G20 for GOOBY 2.0 "Vollversion". GOOBY's pet sim runs on a 1 s tick engine (`core/timeEngine.js`), an offline catch-up simulator, and care interactions in `home/interactions.js`; 2.0 threads sickness, weight, garden growth, playtime and an ambience ticker through all of them. **Your mission:** make the wave-1 engines LIVE — Gooby gets queasy from candy, chubby from junk, medicine works, crops grow in real time and offline, and notification ids 6/7 schedule correctly.
>
> **Read (after AGENTS.md):** PLAN2.md §B4 (ticker + offline rain), §B5, §C3 (ALL — visuals/effects/cures), §C4 (tiers/anim flavor), §C2.3-offline + §C2.4 (harvest notification), §C3.5 (sick notification), §B3 (store events + notifications row), §B2 (slices). Then read `src/core/timeEngine.js`, `src/systems/offline.js`, `src/home/interactions.js` (fully), `src/systems/notifyRules.js`, `src/core/notifications.js`, `src/systems/{health,weight,garden}.js` + `src/systems/economy.js` (`useMedicine`), `src/character/gooby.js` (API + material handles), `src/character/goobyAnims.js`, `src/gfx/particles.js`.
>
> **OWNS (modify):** `src/core/timeEngine.js` (health/weight/garden/profileStats ticks riding the 1 s loop; a 60 s ambience ticker emitting store events `'dayBandChanged'`/`'weatherChanged'` (runtime-only §B3) and calling `garden.applyRain` when a rain block is active), `src/systems/offline.js` (garden growth at FULL elapsed rate uncapped + `applyRain` for elapsed rain blocks within the §E4 sim window; junk decay/neglect/weight drift at the 0.3×/480-min awake rules; extend the events list `'cropsReady'`, `'becameSick'` for the welcome-back toast), `src/home/interactions.js` (feed pipeline calls `health.onEat`+`weight.onEat`+treats `collections.award` §C6; tray shows the junk 🍬 badge + belly junkScore band icon §C7; Care row in the fridge tray: medicine-bottle drag → `economy.useMedicine` with grimace-then-relief; fertilizer appears in the tray's Care row for buying only — using it is G19's garden drag; ball fetch calls `weight.onBallFetch` + counter `balls`), `src/systems/notifyRules.js` + `src/core/notifications.js` (ids 6/7, MAX_SCHEDULED 7, §C2.4 readyAt-based harvest rule via `garden.readyAt`, §C3.5 sick rule: 4 h after backgrounding while sick, max 1/day; quiet-hours/spacing unchanged), `src/character/gooby.js` + `goobyAnims.js` + `emotions.js` (marked `// V2/G20` additions: `setWeightTier(tier)` 2 s-animated body X/Z scale per §C4.3 + outfit-anchor re-fit; queasy cheek lerp `#BFD9A8`, `queasyWobble` idle, sneeze anim ~40 s queasy / ~20 s sick, thermometer prop + droopy ears while sick; sick mood cap 39; the sick minigame-refusal gate itself lives in `minigames/framework.js`, which is G23's this wave — do NOT edit it; instead document the `health.canPlayMinigame` one-liner for G23 in your report and reference the `// V2/G23 wires` note), NEW `src/ui/careSheet.js` (medicine/vet options sheet per §C3.4 — vet button emits the event G21's destination flow listens for; graceful "not built yet" toast fallback), `src/data/strings/v2-health.js`; `test/offline.test.js` + `test/notifyRules.test.js` + `test/interactions.test.js` (extend).
> **DO NOT TOUCH:** `roomManager`/`rooms/garden` (G19), `rooms/{kitchen…bedroom}`/`decor`/`shopScreen`/`wardrobe`/`outfitAttach` (G22), `hud.js`/`framework.js`/`achievementsEngine.js`/`fishingPond` (G23), `cityBuilder`/`shopTrip`/`cityDrive`/`vetPanel` (G21). Shared-append: `main.js` (anchor: inside/after the existing G6 offline-sim block), `styles.css`, `sfxMap.js` (existing recipes only — `health.sneeze` etc. can reuse `gooby` voice ids; G29 upgrades).
>
> **Contracts exposed:** store events `'healthChanged'`/`'weightChanged'`/`'gardenChanged'`/`'itemsChanged'`/`'profileChanged'`/`'dayBandChanged'`/`'weatherChanged'` firing per §B3 (G23's HUD chips + G26's ambience consume these — document exact payloads); `gooby.setWeightTier(tier)`; careSheet panel id `'careSheet'`.
> **Verification specifics:** suite+lint+build green. CDP proofs, dumped to `/tmp/gooby-v2-g20/`: ① junk-feed ×5 (`?coins=999`) → queasy visuals + toast at junkScore 4 (§C3.2); ×8 → sick + refusal toast on a minigame launch attempt (if G23's gate isn't merged yet, prove `health.canPlayMinigame === false` via console dump and note it); ② medicine cure flow; ③ weight: junk to tier `chonky` → silhouette change screenshot, active-game weight loss via `?minigame=runner&autoplay=1`; ④ offline: pin `?now=`, plant via `__gooby` console, jump +2 h → crop progressed, welcome-back toast; ⑤ notification schedule dump (`notifyRules.computeSchedule`) showing ids 6/7 with correct times, quiet-hours shift, 7-cap. Layout matrix for the care sheet + changed fridge tray (8 shots each).
> **Dependencies:** wave 1 engines + data. **Ports:** vite 5176 / CDP 9222.

### V2/G21 — city 2.0: vet clinic, landmarks, vet trip (slot C)

> You are build agent V2/G21 for GOOBY 2.0 "Vollversion". GOOBY's seeded 9×9 city currently has one destination (the shop, reached by a real drive); 2.0 adds a vet clinic on the west ring, six collectible landmarks, and a vet-trip flow that cures sick Gooby for 120c. **Your mission:** extend the city generator + shopTrip state machine, build the vet arrival panel with Dr. Hoppel, and wire landmark stickers + distance tracking into all driving.
>
> **Read (after AGENTS.md):** PLAN2.md §C9 (ALL — your core spec), §B3 (cityBuilder + shopTrip rows), §C6 set 3 (landmark sticker ids), §C3.5 (vet prices/effects — implemented via `economy.payVet`), §B6 (vet checkup L1). Then read `src/city/cityBuilder.js` (fully), `src/systems/shopTrip.js` (fully), `src/minigames/games/cityDrive.js` (route/arrival/crash logic), `src/city/{traffic,carController}.js` (consume, don't edit), `src/systems/{health,collections,profileStats,economy}.js`, `test/{cityLayout,shopTrip}.test.js`.
>
> **OWNS (create):** `src/city/vetClinic.js` (building-e + west-facing rotY −90°, procedural white-cross sign, trees, parking apron per §C9.1; Dr. Hoppel procedural rabbit bust — reuse the Gooby head recipe, grey palette, glasses), `src/ui/vetPanel.js` (arrival panel: Behandlung 120c [only queasy/sick], Checkup 30c report card [junkScore band/neglect/weight tier], can't-afford hint, „Nach Hause" teleport per §C9.2), `src/data/strings/v2-city.js`. **(modify):** `src/city/cityBuilder.js` (`generateCityLayout(seed)` output += `vet:{tile,buildingAt,rotY,parking}` at fixed [2,2], `vetRoute` = §C9.1 VET_ROUTE_TILES, `landmarks:[{id,x,z}]` ×6 at the §C9.3 placements incl. procedural fountain/gazebo + `minigolf-kit/windmill` ×2.2 café; determinism preserved), `src/systems/shopTrip.js` (sibling `mode='vetTrip'`: same machine, vet route, 10 coin pickups, §C4-v1 crash+tow rules, arrival → vetPanel; destination picker sheet on front-door/HUD entry once vet discovered — „Laden / Tierarzt" with prices; sick-chip and careSheet entry points listen for G20's careSheet event, marked `// V2/G20 contract`), `src/minigames/games/cityDrive.js` (marked block: 15 m landmark triggers during ANY city mode → `collections.award('landmarks', id)` once + toast + camera-flash gag; `meta.landmarks` + `crashes` + `distanceM` in `onEnd`; `profileStats.onDistance` feed), `test/cityLayout.test.js` (extend: vet route adjacent-connected, ends adjacent to VET_TILE, no overlap with shop parking, landmarks on non-road tiles, determinism) + `test/shopTrip.test.js` (extend: vetTrip transitions, cure paid exactly once via economy.payVet, tow rule, checkup path).
> **DO NOT TOUCH:** `traffic.js`/`carController.js` (consume as-is), `framework.js` (G23 forwards your `meta` — you only pass it to `onEnd`), `interactions.js`/`timeEngine`/`offline` (G20), `hud.js` (G23 adds the 🤒 chip — your entry points are the door sheet + careSheet event), garden files (G19), shop/wardrobe files (G22). Shared-append: `main.js` (anchor: after the G7 shopTrip wiring lines), `styles.css`, `sfxMap.js` (existing sounds for `vet.cure`, `landmark.found`, doorbell → reuse; G29 upgrades).
>
> **Contracts exposed:** `generateCityLayout(seed).{vet,vetRoute,landmarks}` shapes (consumed by G28's deliveryRush: parcels destinations = landmark curbside points); `meta` shape `{landmarks:string[], crashes:number, distanceM:number}` (G23 forwards to collections/quests); vetPanel screen id `'vetPanel'`; destination-picker flow (G28 reuses the shop start point).
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v2-g21/`: ① make Gooby sick via console (`__gooby.store` junk feeds or direct health slice set), drive the FULL vet trip with `?autopilot` if available else scripted steering, arrive, pay 120c → healthy + stats +10 (state dumps before/after); ② checkup report card; ③ landmark drive-by → sticker toast + `collections` dump showing the entry; ④ deterministic layout: two `generateCityLayout(7)` calls deep-equal (test) + top-cam screenshot showing vet + ≥3 landmarks. Layout matrix for vetPanel + destination picker (8 shots each). Drive stays ≤ 180 draw calls (log `renderer.info`).
> **Dependencies:** wave 1 (economy.payVet, health, collections, assets). **Ports:** vite 5177 / CDP 9223.

### V2/G22 — content & shop 2.0: furniture, outfits, skins, shop surfaces (slot D)

> You are build agent V2/G22 for GOOBY 2.0 "Vollversion". GOOBY sells foods, furniture, wallpapers/floors and outfits through a tabbed shop reached by a real car trip; 2.0 nearly doubles every catalog and adds purchasable fur-color skins with live try-on. **Your mission:** land ALL §C8 content (+23 indoor furniture, 12 garden decor items, 4 wallpapers + 3 floors catalog rows, 9 outfits, 7 skins applier) and the shop/wardrobe surfaces that sell it (food category filters + Care row, Skins tab, Fur wardrobe category).
>
> **Read (after AGENTS.md):** PLAN2.md §C8 (ALL — your core spec), §C7 (shop food tab: filters Alle/Gesund/Süßkram + Care row + junk badges), §C2.1 (garden decor slot anchor names — G19 renders; you own the catalog + decor application), §B6 (skins tab L5), §C8.5 (skin palettes/prices — data landed in wave 1 `data/skins.js`). Then read `src/data/furniture.js` (fully), `src/data/outfits.js`, `src/character/outfitAttach.js` (fully — the procedural build pattern), `src/ui/shopScreen.js` (fully), `src/ui/wardrobeScreen.js`, `src/home/decor.js`, `src/home/rooms/{kitchen,living,bathroom,bedroom}.js` (slot/anchor pattern), `src/gfx/materials.js` (shared Gooby materials — skins swap their colors), `src/systems/economy.js` (`buySkin`, `buyItem`).
>
> **OWNS (create):** `src/character/skins.js` (`applySkin(gooby, skinDef)` swapping BODY/BELLY/EAR_INNER material colors §C8.5 — cheeks/nose/eyes untouched; golden gets metalness 0.25; idempotent; applies everywhere incl. cameos via the shared materials), `src/data/strings/v2-shop.js`. **(modify):** `src/data/furniture.js` (+23 §C8.1 indoor buyables mapped to slots incl. the NEW slots below; +2 procedural wall-art canvases; §C8.3 garden decor: 6 slots × 12 items; §C8.2 wallpaper/floor catalog rows `sunset/meadow/candy/ocean` + `marble/walnut/terracotta` — painter itself is G19's, reference by id), `src/home/rooms/{kitchen,living,bathroom,bedroom}.js` (new slot anchors per §C8.1: living `ceilingFan`+`sideboard`, kitchen `bar`, bathroom `washer`, bedroom `sideTable`+`floorClutter` — marked `// V2/G22` blocks), `src/home/decor.js` (apply new slots incl. `furniture.placed.garden` via G19's anchors — code against §C2.1 anchor names; ceiling-mount handling for the fan), `src/character/outfitAttach.js` (+9 procedural §C8.4 builds: strawHat/chefHat/flowerCrown/wizardHat/heartGlasses/monocle/bandana/bellCollar/cape — cape gets rigid hop-flutter; bellCollar plays an existing bell-ish sfx id on hop, marked `// V2/G29 upgrades`), `src/data/outfits.js` (+9 rows §C8.4), `src/ui/shopScreen.js` (food filters + Care row rendering medicine/fertilizer distinctly + junk 🍬 badges; „Skins" tab from L5: palette swatch cards, live try-on preview, `economy.buySkin`; garden-decor purchasable in the furniture tab under a Garden room filter), `src/ui/wardrobeScreen.js` („Fell"/"Fur" category: owned skins, equip → `skins.equipped` + `applySkin` live), `test/furniture.test.js` + `test/outfits.test.js` (extend: catalog counts §A3 — 58 total furniture, 20 outfits, 10 wallpapers, 7 floors; slot/room compat; GLBs on disk; skin application pure parts).
> **DO NOT TOUCH:** `roomManager.js`/`rooms/garden.js`/`gardenPanel` (G19), `interactions.js`/tray internals (G20 — your Care-row SHOP entries are in shopScreen; the tray Care row is G20's), `hud.js`/`profileScreen`/`photoMode`/`framework` (G23), city files (G21), `data/constants.js`/`data/skins.js` (wave 1, read-only). Shared-append: `main.js` (anchor: after the G12 block — boot `applySkin` from save), `styles.css`, `sfxMap.js` (existing ids only).
>
> **Contracts exposed:** `skins.applySkin(gooby, skinDef)` + boot application (G23's photo mode and all cameos inherit it via shared materials — state this in your report); new slot anchor names; catalog id lists (G19 renders garden defaults; G28's deliveryRush uses none).
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v2-g22/`: ① buy + place a ceiling fan, bar stool set, washer (screenshots per room); ② buy `midnight` skin at L5 (`?level=5&coins=2000`) → equipped everywhere: home screenshot + one minigame cameo screenshot + persists across reload (dump `skins` slice); ③ wardrobe Fur try-on; ④ all 9 new outfits equipped screenshot set (hat/glasses/neck across 3 shots minimum, incl. wizardHat + cape + monocle); ⑤ shop food filters + Care row + junk badges; ⑥ garden decor: golden gnome + stone path placed (coordinate with the merged G19 room — if garden isn't merged yet in your checkout window, verify data + decor.js paths via unit tests and note it). Layout matrix for changed shop tabs + wardrobe (8 shots each surface).
> **Dependencies:** wave 1 (skins/economy data); soft same-wave interplay with G19 documented above. **Ports:** vite 5178 / CDP 9224.

### V2/G23 — progression UI & meta wiring: quests, album, profile, photo, HUD, framework (slot E)

> You are build agent V2/G23 for GOOBY 2.0 "Vollversion". GOOBY 2.0's retention layer — a daily quest board, a 4-set sticker album, a lifetime stats/profile screen, and a photo mode — sits on wave-1 engines that you will surface and wire; you also own the cross-cutting meta plumbing (framework `onEnd` meta forwarding, achievementsEngine 2.0, HUD buttons). **Your mission:** every progression surface live and every tracked event flowing to quests/collections/achievements/profile.
>
> **Read (after AGENTS.md):** PLAN2.md §B7 (engines you consume), §C5.1 (quest board UX + pool event names), §C5.3 (17 new achievements — defs landed wave 1), §C6 (album UX + fish set: YOU implement the fishingPond species roll), §C12 (ALL — profile + photo, your core spec), §B3 (framework onEnd meta + store events), §B6 (L1/L2 gates), §C10.3 (`nightPlays` counter on the framework end path). Then read `src/minigames/framework.js` (fully), `src/systems/achievementsEngine.js` (fully), `src/ui/hud.js` (fully), `src/core/sceneManager.js` (renderer ownership — for `captureFrame`), `src/minigames/games/fishingPond.js` + `.logic.js`, `src/systems/{quests,collections,profileStats,weight,health,dayNight}.js`, `src/data/{quests,collections,achievements}.js`, `src/ui/{achievementsScreen,arcadeScreen}.js` (style to mirror).
>
> **OWNS (create):** `src/ui/questBoard.js` (3 cards w/ progress bars + claim, reroll button 1/day, midnight note, L2 gate teaser), `src/ui/albumScreen.js` (4 pages, silhouettes→filled, counts, set progress + claim → reward furniture toast), `src/ui/profileScreen.js` (§C12.1 sections ①–⑤ exactly; `tabular-nums`; 21 minigame rows; 320 px 1-col collapse), `src/ui/photoMode.js` (§C12.2 exactly: UI-less capture, pose/emotion/frame pickers, share-or-download pipeline, +1 XP ≤5/day), `src/data/strings/v2-progress.js`. **(modify):** `src/core/sceneManager.js` (marked block: `captureFrame() → Promise<Blob>` — render once, same-task `toBlob`, no preserveDrawingBuffer), `src/minigames/framework.js` (marked block on the end path: accept `onEnd({score, meta})`, forward to `quests.onGameEnd`-equivalent via `quests.track` events, `collections.onGameMeta` semantics per §B3, `weight.onMinigameEnd`, `profileStats`, `nightPlays` counter 22:00–06:00, `play21` special feed; sick refusal gate next to the exhausted gate via `health.canPlayMinigame`, marked `// V2/G23 wires` — G20's report documents the exact one-liner), `src/systems/achievementsEngine.js` (marked block: v2 counters wiring per §B2, special detectors for the 17 new defs §C5.3, and a track-forwarding hook so every `achievementsEngine.track(id, n)` call ALSO forwards to `quests.track` with the same event vocabulary — §B7's "same call sites" ruling, zero edits in other agents' files), `src/ui/hud.js` (marked block: quest clipboard button + claimable badge, camera button, profile avatar button, 🤒 sick chip [listens `'healthChanged'`, opens G20's `'careSheet'` panel]), `src/minigames/games/fishingPond.js` + `.logic.js` (marked blocks: §C6 species roll — seeded size+color → 8 species, goldenFish 2% on L, nightEel only in the night band via `dayNight.bandAt`; report `meta.caught`), `main.js` (screen registrations — anchor: after the G12 block), `test/achievements.test.js` (extend: all 33 reachable via counters/specials), `test/collections.test.js` (extend: species-roll determinism, goldenFish 2% ±0.5 over 10k seeded rolls, night-gated eel — the slot G18 left).
> **DO NOT TOUCH:** `interactions.js`/`timeEngine`/`offline`/`careSheet` internals (G20), garden files (G19), city files + `cityDrive.js` (G21 — its `meta` arrives through your framework block), shop/wardrobe/outfit/decor files (G22). Shared-append: `styles.css`, `sfxMap.js` (existing ids for `quest.claim`, `sticker.get`, `photo.shutter` → reuse; G29 upgrades).
>
> **Contracts exposed:** framework meta-forwarding (G24/25/27/28's games just pass `meta` to `onEnd`); `sceneManager.captureFrame()`; the quest event vocabulary in code comments next to the forwarding hook (must equal the §C5.1 `event` column verbatim).
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v2-g23/`: ① quest roll determinism across reloads on a pinned `?now=`; play carrotCatch via autoplay → `q.play3` progress tick; claim → coins/XP + badge decrement (dumps); reroll once then refused; ② album: award veggie + treat stickers via console/play, set claim pays once; ③ profile screen showing real totals after a play session; ④ photo mode: full flow → PNG blob (download path in dev) — save the captured PNG itself to `/tmp/gooby-v2-g23/`; pose+frame+emotion variations (≥3 captures); ⑤ 🤒 chip appears when console-forced sick; sick minigame refusal toast via the framework gate. Layout matrix for questBoard, album, profile, photo toolbar (8 shots each; profile also at 320 px 1-col).
> **Dependencies:** wave 1 engines/data; G20's careSheet event contract (same wave — degrade to toast if unmerged, note it). **Ports:** vite 5179 / CDP 9225.

---

## E4. WAVE 3 — minigames I + ambience (launch G24, G25, G26 in parallel; waves 1–2 merged & green)

### V2/G24 — minigames D1: goobySays, gardenRush, burgerBuild (slot A)

> You are build agent V2/G24 for GOOBY 2.0 "Vollversion". GOOBY's 12 shipped minigames follow a strict plugin contract — pure `.logic.js` sibling, framework-owned countdown/pause/results/payout, `?autoplay=1` bot, EN+DE strings, coin-row-tuned scoring — and 2.0 grows the arcade to 21. **Your mission:** build 3 of the 9 new games exactly per spec: **goobySays** (sequence memory), **gardenRush** (watering reaction), **burgerBuild** (order-matching catch).
>
> **Read (after AGENTS.md):** PLAN.md §E8 + §C6 shared rules; PLAN2.md §C1.1 (your 3 coin rows), §C1.2 #1/#2/#3 (your designs — every number/behavior there is binding), §C1.3 (your distinct looks: disco-lite stage / garden fence + terracotta pots / diner checker floor), §C1.5 (your test scope), §B3 (`onEnd({score, meta?})` — none of your 3 needs meta), §B6 (unlocks L2/L4/L5). Then read `src/minigames/framework.js` (contract as merged — incl. the V2/G23 forwarding block), `src/minigames/games/carrotCatch.js` + `.logic.js` (THE convention: logic consts, autoplay, dispose), `src/data/minigames.js` (your 3 entries exist since wave 1), `test/minigamesA.test.js` (test style).
>
> **OWNS (create):** `src/minigames/games/goobySays.js` + `goobySays.logic.js`, `gardenRush.js` + `gardenRush.logic.js`, `burgerBuild.js` + `burgerBuild.logic.js`; `test/minigamesD.test.js` (NEW — your 3 games' §C1.5 blocks; header-comment that V2/G27 appends veggieChop/goalieGooby in wave 4); `src/data/strings/v2-games-d.js` (your in-game strings; titles landed in v2-core).
> **DO NOT TOUCH:** framework/registry (registration is automatic via `import.meta.glob`), other games, `minigamesE.test.js` (G25's), `v2-games-e.js` (G25's), ambience/gfx files (G26's). Shared-append: `styles.css` (only if DOM HUD bits are needed), `sfxMap.js` (existing oggs/recipes only — goobySays' 4 pad pitches: map 4 ids to the existing synth recipe family at different pitches ONLY if the recipe supports a pitch param, else reuse 4 distinct interface oggs; note the G29-upgrade marker).
>
> **Per-game binding numbers (from §C1.2 — implement verbatim):** goobySays: start 3, +1/round, playback −5%/round floor 320 ms/step, one mistake ends, score `10·rounds + speedBonus(0–8, avg reaction <500 ms = 8)`; autoplay replays the emitted sequence at 250 ms taps. gardenRush: 8 pots, wilt 6 s→3 s ramp, hold-fill 0.8 s, perfect = last 25% (+3), early +1, full wilt −2 + respawn, decoy weeds −1, 60 s, score ≈ 40; autoplay targets lowest remaining wilt, holds 0.75 s. burgerBuild: seeded 4–7-layer tickets, 3 columns, next-needed catch +5 / wrong −2 / complete +15 + bite, fall +8%/completed burger, 75 s, score ≈ 60; autoplay chases the nearest next-needed column. Energy 8 each; coin rows §C1.1 (`goobySays 5/4/24`, `gardenRush 3/4/25`, `burgerBuild 4/4/26`).
> **Assets:** gardenRush `nature-kit/pot_large|pot_small` + crops stages; burgerBuild `food-kit/meat-patty|cheese-cut|tomato-slice|salad|onion` + procedural buns/plate; goobySays fully procedural pads. All committed since wave 1 — never fetch.
>
> **Verification specifics:** suite+lint+build green (your logic tests per §C1.5: sequence-gen determinism + speed floor; wilt ramp + perfect-zone math; ticket gen + next-needed matcher). Per game, CDP to `/tmp/gooby-v2-g24/`: mid-play screenshot proving the §C1.3 distinct look, results screen, **5 autoplay runs with raw score + payout table** — all payouts inside the row, typicals near §C1.1's typical column (report the table; if consistently off, tune YOUR logic consts, never constants.js); `?minigame=<id>` + level-lock presentation on the arcade grid; first-play ×2 badge once per day. Each game a lazy chunk ≤ 150 KB gzip (check `npm run build` output). No new full-screen UI → layout matrix only for any in-game DOM HUD you add (banner/ticket at 320/430 × EN+DE).
> **Dependencies:** waves 1–2 (framework forwarding, data rows, assets). **Ports:** vite 5175 / CDP 9221.

### V2/G25 — minigames E1: starHopper, pipeFlow (slot B)

> You are build agent V2/G25 for GOOBY 2.0 "Vollversion". Same product context and §E8 discipline as every GOOBY minigame agent; your two games are the arcade's "night" space-dodger and its brainy pipe-rotation puzzle. **Your mission:** build **starHopper** and **pipeFlow** exactly per spec, including pipeFlow's provably-always-solvable generator.
>
> **Read (after AGENTS.md):** PLAN.md §E8 + §C6 shared rules; PLAN2.md §C1.1 (rows: `starHopper 9/4/26`, `pipeFlow 5/4/25`), §C1.2 #8/#9 (binding designs), §C1.3 (looks: dark starfield + nebula — the ONLY night look in the set / flat top-down garden blueprint), §C1.5, §B6 (L12/L14). Then read `carrotCatch.js`+`.logic.js` (convention), `runner.logic.js` (lane-collision test style), `src/data/minigames.js`.
>
> **OWNS (create):** `src/minigames/games/starHopper.js` + `.logic.js`, `pipeFlow.js` + `.logic.js`; `test/minigamesE.test.js` (NEW — your 2 games; header notes V2/G28 appends deliveryRush/miniGolf in wave 4); `src/data/strings/v2-games-e.js`.
> **DO NOT TOUCH:** other games, `minigamesD.test.js`/`v2-games-d.js` (G24's), gfx/ambience (G26's). Shared-append: `styles.css`, `sfxMap.js` (existing ids only).
>
> **Binding numbers:** starHopper: 3 lanes, `space-kit/craft_speederA`, meteors 70% hitboxes, stars +3 / golden carrots +10, speed +5%/10 s, telegraphed showers, one-hit end with a single shield pickup spawning at score ≥ 60, score = `distanceM/10 + pickups`, ~75 s, tap-half/swipe-2-lane controls; autoplay = greedy highest-value-safe-lane per 0.4 s window. pipeFlow: 5×5 straight/bend/T tiles, generator = random spanning path tap→sprinkler then scramble rotations (solvable by construction), tap rotates 90°, connect → fill animation → next puzzle, 90 s fixed, score `25·solved + tapEfficiencyBonus(0–10; ≤optimal+3 → 10, linear to 0 at optimal+15)`, ~3 puzzles ≈ 75; autoplay = BFS solver **exported from `pipeFlow.logic.js`** (tests reuse it to prove 200 seeded boards solvable + optimal-tap counts). Energy 8 each.
>
> **Verification specifics:** suite+lint+build green (§C1.5 tests: lane-collision windows + spawn tables; generator always-solvable over 200 seeds via the exported BFS + rotation math). CDP to `/tmp/gooby-v2-g25/`: per game mid-play + results screenshots (starHopper must read clearly as the set's only night look; pipeFlow's fill animation captured), 5-run autoplay score/payout tables inside rows, lock presentation at low level, ×2 badge, lazy chunk ≤ 150 KB gzip each. Layout only for in-game DOM HUD bits.
> **Dependencies:** waves 1–2. **Ports:** vite 5176 / CDP 9222.

### V2/G26 — ambience: day/night + weather visuals everywhere (slot C)

> You are build agent V2/G26 for GOOBY 2.0 "Vollversion". Wave 1 shipped pure band/weather engines and wave 2 shipped the garden sky dome + `roomManager.setAmbience`; the rest of the game still looks like permanent noon. **Your mission:** make the whole game breathe with the real clock — §C10 lighting bands in every room, §C11 weather effects (rain quads, window streaks, cloud drift), night behaviors, dusk/night city driving, and the synth audio hooks (rain loop, birdsong).
>
> **Read (after AGENTS.md):** PLAN2.md §C10 (ALL — param table §C10.2 is in `constants.DAYNIGHT`), §C11 (ALL), §B4 (ticker events — G20's 60 s ticker emits `'dayBandChanged'`/`'weatherChanged'`), §C2.1 (garden rain visibility), §A2.3 (rain ≤ 1 extra draw call, pool 300). Then read `src/gfx/lights.js` (fully), `src/home/homeScene.js` (ambience consumption point), `src/home/roomManager.js` (G19's `setAmbience` + `// V2/G26 consumes` markers + `sky.windowTexture`), `src/gfx/sky.js`, `src/minigames/games/cityDrive.js` (lighting section), `src/minigames/games/fishingPond.js` (rain ripple hook §C11.2), `src/character/emotions.js` + `goobyAnims.js` (night yawn/sleepy bias §C10.3), `src/audio/sfxMap.js` + `audio.js` (loop support check), `src/home/rooms/garden.js` (canopy-sit spot).
>
> **OWNS (create):** `src/gfx/weatherFx.js` (instanced rain quad pool 300 = 1 draw call + ground splash rings for the garden; animated window-streak CanvasTexture overlay + droplet runs for indoor rooms; drifting cloud sprites for the dome), `src/data/strings/v2-ambience.js`. **(modify, marked `// V2/G26` blocks):** `src/gfx/lights.js` (`applyAmbience(params)` per §B4 — lerped hemi/dir/sky application incl. cloudy ×0.85 / rain ×0.70 intensity), `src/home/homeScene.js` (subscribe `'dayBandChanged'`/`'weatherChanged'` + apply on room switch; dusk/night lamp PointLights auto-on §C10.2; night behavior: yawn every 45±15 s, eyelid bias 0.3, sleepy-tie preference §C10.3; garden rain → Gooby contently sits under the tree canopy §C11.2), `src/home/roomManager.js` (ONLY inside G19's marked consumption points: indoor window sky textures per band/weather via `sky.windowTexture`), `src/minigames/games/cityDrive.js` (night tint + 2 headlight SpotLights player-car-only per §C10.2; dusk band tint — G28's deliveryRush inherits via shared city setup, leave a `// V2/G28 reuses` note), `src/minigames/games/fishingPond.js` (rain ripple rings cosmetic), `src/character/emotions.js`/`goobyAnims.js` (sleepy-night bias hooks only — keep G20's blocks intact), `src/audio/sfxMap.js` + (if loops need it) `src/audio/audio.js` (marked block: `ambience.rain` brown-noise+LP-800 Hz −18 dB loop, `ambience.birdsong` dawn chirps in the garden — synth recipes per §C11.2/§C10.2, respect sfx toggle), `test/dayNight.test.js`/`test/weather.test.js` (extend ONLY if you add pure helpers, e.g. param-lerp math).
> **DO NOT TOUCH:** game files other than the two marked-edit targets above; `timeEngine` (G20's ticker is your event source); G24/G25's new games (they read the band themselves if needed — starHopper's look is self-contained).
>
> **Contracts exposed:** `weatherFx` API (`mountGardenRain(scene)`, `setWindowWeather(roomId, state)` or equivalent — document); the dusk city tint hook for G28.
> **Verification specifics:** suite+lint+build green. CDP with pinned clocks to `/tmp/gooby-v2-g26/`: living room at `?now=` for day/dusk/night/dawn (4 shots — lamps on at dusk/night, window sky correct per §C10.2); garden in rain (visible rain + splashes + auto-watered plot state dump proving `applyRain` fired via the ticker) and the SAME date/block on a second boot → identical weather (determinism); cloudy desaturation shot; night city drive with headlights; Gooby yawning at night (screenshot + anim state dump); `renderer.info` before/during rain proving ≤ +1 draw call; audio node dumps (`audio.getStats()`) proving the rain loop starts/stops with the block and respects the sfx toggle. No new screens → no layout matrix (forecast chip was G19's).
> **Dependencies:** waves 1–2 (engines, ticker events, setAmbience, sky.js). **Ports:** vite 5177 / CDP 9223.

---

## E5. WAVE 4 — minigames II + audio/reactions + ship polish (launch G27, G28, G29, G30 in parallel; waves 1–3 merged & green)

### V2/G27 — minigames D2: veggieChop, goalieGooby (slot A)

> You are build agent V2/G27 for GOOBY 2.0 "Vollversion". Same product context and §E8 discipline as every GOOBY minigame agent; these are the arcade's swipe-slicer and its sports-reaction goalie game. **Your mission:** build **veggieChop** and **goalieGooby** exactly per spec and extend the wave-3 minigamesD test file.
>
> **Read (after AGENTS.md):** PLAN.md §E8 + §C6 shared rules; PLAN2.md §C1.1 (rows: `veggieChop 5/4/26`, `goalieGooby 3/4/26`), §C1.2 #4/#7 (binding), §C1.3 (looks: kitchen cutting-board arena / meadow goal + bunny crowd), §C1.5, §B6 (L6/L11). Then read `carrotCatch.js`+`.logic.js`, `test/minigamesD.test.js` (G24's — you APPEND), `src/data/strings/v2-games-d.js` (G24's file — you APPEND your keys; wave-4 G24 is done, so this is a cross-wave append, safe).
>
> **OWNS (create):** `src/minigames/games/veggieChop.js` + `.logic.js`, `goalieGooby.js` + `.logic.js`. **(modify/append):** `test/minigamesD.test.js` (your two §C1.5 blocks), `src/data/strings/v2-games-d.js` (append your keys — verify-after-commit per §E0.2).
> **DO NOT TOUCH:** G24/G25/G28's game files, `minigamesE.test.js`/`v2-games-e.js` (G28's), audio files (G29's — use existing sfx ids, G29 upgrades concurrently; do NOT edit sfxMap this wave unless an id would be unmapped, in which case one marked append mapping to an existing recipe).
>
> **Binding numbers:** veggieChop: arcs of 1–3 items ramping, swipe-chop +2 (+1 per extra in one swipe), junk (soda can, boot) −3 + 0.5 s stun, 3 unchopped misses end early, ≤60 s, whole+half food-kit pairs (`apple/pear/lemon/onion/mushroom/paprika/tomato/coconut` + halves, committed wave 1), swipe trail rendered; autoplay synthesizes an apex swipe per veggie, ignores junk; score ≈ 70. goalieGooby: 5 lanes, 0.9 s→0.45 s telegraph ramp, lobs (swipe up) + rollers (swipe down), save +4 (+2 super-save in last 0.15 s w/ slow-mo), 3 goals conceded end early else 60 s, bunny crowd (Gooby-recipe minis) cheers every 10 saves + speed +10%; autoplay reads the telegraphed lane, swipes at t−0.2 s; score ≈ 48. Energy 8 each.
>
> **Verification specifics:** suite+lint+build green (§C1.5: arc solver + combo counter; telegraph→lane mapping + ramp). CDP to `/tmp/gooby-v2-g27/`: per game mid-play + results screenshots (distinct looks §C1.3), 5-run autoplay score/payout tables inside rows + near typicals, lock presentation, ×2 badge, chunks ≤ 150 KB gzip. Layout only for DOM HUD bits.
> **Dependencies:** waves 1–3. **Ports:** vite 5175 / CDP 9221.

### V2/G28 — minigames E2: deliveryRush, miniGolf (slot B)

> You are build agent V2/G28 for GOOBY 2.0 "Vollversion". The city got a vet, six landmarks and dusk lighting in earlier waves; now it earns its keep as a game board — plus the arcade gets a physics minigolf course. **Your mission:** build **deliveryRush** (city driving deliveries, the premium earner) and **miniGolf** (6-hole putt physics) exactly per spec.
>
> **Read (after AGENTS.md):** PLAN.md §E8 + §C6 shared rules; PLAN2.md §C1.1 (rows: `deliveryRush 8/5/32` energy 6, `miniGolf 5/4/28`), §C1.2 #5/#6 (binding), §C1.3 (looks: city at dusk / floating pastel course), §C1.5, §C9.4 (deliveryRush reuses shop start + landmark curbside drop rings), §B3 (meta shapes: deliveryRush `{landmarks, crashes, distanceM}`, miniGolf `{strokes, holeInOnes}` — the framework forwards them; `holeInOne` achievement + `q.deliver3`/`q.cleanDrive` quests hang off your meta), §B6 (L7/L9). Then read `src/minigames/games/cityDrive.js` (fully — bot follow logic, crash rules, landmark triggers, G26's dusk hook `// V2/G28 reuses`), `src/city/cityBuilder.js` (landmarks/vet output), `src/city/{carController,traffic}.js`, `carrotCatch.logic.js` (convention), `test/minigamesE.test.js` (G25's — you APPEND), `src/data/strings/v2-games-e.js` (append).
>
> **OWNS (create):** `src/minigames/games/deliveryRush.js` + `.logic.js`, `miniGolf.js` + `.logic.js`. **(modify/append):** `test/minigamesE.test.js`, `src/data/strings/v2-games-e.js` (verify-after-commit per §E0.2).
> **DO NOT TOUCH:** `cityDrive.js`/`cityBuilder.js`/`carController.js`/`traffic.js` (consume — if you genuinely need a hook, ONE marked `// V2/G28` line each, justified in your report), G27's files, audio files (G29's).
>
> **Binding numbers:** deliveryRush: van `car-kit/delivery`, 3 parcels, 3 seeded-distinct destinations from the 6 landmarks, arrow+route-line reuse, 4 m drop rings (+50, confetti, doorbell), crashes −5 (floor 0, no tow/fail), time bonus `+max(0, 120 − elapsedSec)` after drop 3, energy 6, feeds `meta.landmarks`+`deliveries` counter + `profileStats.onDistance`; autoplay follows the lane polyline (reuse cityDrive's bot). Score ≈ 170–190 → ~24c. miniGolf: 6 seeded holes from minigolf-kit tiles (straight/corner/ramp/bump/windmill gate/tunnel; par 2–3), drag-back aim w/ dotted preview + capped power, friction 0.985/frame, wall banks, rhythmic windmill blocking, per-hole scoring 30/20/12/6 (hole-in-one/≤par/par+1/else), 10-stroke auto-advance, Gooby caddy reactions; autoplay aims at the hole or per-hole baked waypoint w/ power table, 2-putts everything; `meta.holeInOnes`. Score ≈ 80.
>
> **Verification specifics:** suite+lint+build green (§C1.5: destination pick seeded 3-distinct-of-6 + score/time-bonus math; friction integration ball-stops <0.01 m/s + bank reflection + par scoring). CDP to `/tmp/gooby-v2-g28/`: deliveryRush full autoplay round — 3 drops + time bonus + payout table (5 runs, ~12c/min sanity per §C1.1) + landmark sticker awards during play + quest `q.deliver3` progress dump; miniGolf full 6-hole autoplay + a manually-scripted hole-in-one on the straight hole → `holeInOne` achievement unlock dump; dusk look screenshot; drive ≤ 180 draw calls; chunks ≤ 150 KB gzip (deliveryRush shares city modules — measure its own chunk). Layout only for DOM HUD bits (delivery ticket, golf stroke counter) at 320/430 × EN+DE.
> **Dependencies:** waves 1–3 (landmarks G21, dusk G26, framework meta G23, minigolf-kit G15). **Ports:** vite 5176 / CDP 9222.

### V2/G29 — audio & reactions 2.0 (slot C)

> You are build agent V2/G29 for GOOBY 2.0 "Vollversion". GOOBY's soundscape is a WebAudio manager with Kenney oggs + synth recipes and a synthesized rabbit voice, and every feature so far reused v1's ~67 sfx ids; pillar ⑦/③ promise bespoke audio for every 2.0 feature and a richer idle life. **Your mission:** the 2.0 audio pass (new synth recipes + remaps for garden/health/vet/quests/album/photo/skins/new games) and the richer-reactions pass (new idle variety, weather/night reactions, bell-collar jingle).
>
> **Read (after AGENTS.md):** PLAN2.md §C1.2 (per-game feel: pad squeaks, doorbell, windmill…), §C2.2/§C3.3–3.5/§C11.2 (feature sounds), §C10.2 (dawn birdsong — G26 landed the loop recipes; you own polish), §C8.4 (bellCollar jingling), §D1 audio row (NO new packs — synth or existing oggs only), §D4. Then read `src/audio/audio.js` (fully — recipe engine), `src/audio/sfxMap.js` (fully — every V2 marked block appended by G19–G28), `src/audio/goobyVoice.js`, `src/character/goobyAnims.js` + `emotions.js` (G20/G26 blocks — extend, don't disturb), `src/gfx/particles.js`.
>
> **OWNS (modify):** `src/audio/sfxMap.js` (consolidate: upgrade every `// V2/G<id>` placeholder-reuse mapping to a bespoke synth recipe or better-fitting ogg; add pad-pitch family for goobySays, doorbell chime, camera shutter, bell jingle, golf putt/sink, chop/splat, save-dive whoosh, delivery confetti, vet sparkle, quest-claim/sticker-pop/set-complete jingles, harvest pop, watering trickle, sell cha-ching — keep other agents' block comments, replace only the mapped values), `src/audio/audio.js` (new synth recipe implementations in the marked V2 region), `src/audio/goobyVoice.js` (sneeze, hiccup, content-sigh, brrr/shiver, delighted-gasp — ±10% jitter rule), `src/character/goobyAnims.js` + `emotions.js` (marked `// V2/G29` blocks: new idle variety — stretch, ear-scratch, look-around, tail-wiggle — on the idle rotation; rain-watching + night-sleepy flavor hooks coordinating with G26's bias), `src/character/outfitAttach.js` (ONLY the `// V2/G29 upgrades` bellCollar marker → real jingle on hop), haptics ride-alongs (def `haptic:` fields per AGENTS.md) (the sfx-coverage test in `test/onboarding.test.js` enforces zero unmapped ids — keep it green by construction; do NOT edit that test file, it is G30's this wave).
> **DO NOT TOUCH:** G27/G28's new game files (they call existing ids; your sfxMap remaps improve them without file edits), `interactions.js`/`timeEngine`/UI screens (G30 handles docs/onboarding), framework.
>
> **Verification specifics:** suite+lint+build green (the sfxMap coverage test is your hard gate — zero unmapped ids across the ENTIRE merged codebase). CDP to `/tmp/gooby-v2-g29/`: `audio.getStats()` dumps proving plays fire for ≥ 12 distinct new v2 ids across garden water/harvest, quest claim, sticker pop, photo shutter, vet cure, goobySays pads (4 pitches), golf putt, chop, save-dive; idle-variety proof (state dumps of ≥3 new idles firing over a 3-min observation + screenshots); bell-collar jingle stat on hop with the collar equipped; toggles: sfx OFF ⇒ zero new nodes. No audio device in the VM — console/getStats evidence is the standard (AGENTS.md). No new UI → no layout matrix.
> **Dependencies:** waves 1–3 fully merged (you sweep their call sites); G27/G28 land concurrently — their ids use existing recipes by rule, sweep them in your report as "upgraded/left as-is".
> **Ports:** vite 5177 / CDP 9223.

### V2/G30 — onboarding, What's-new, docs, integration sweep (slot D)

> You are build agent V2/G30 for GOOBY 2.0 "Vollversion". A fresh player must still onboard smoothly, a v1 veteran must get a one-time "What's new" panel over an untouched home, and the repo docs must describe the 2.0 surface for humans and future agents. **Your mission:** onboarding extensions, the What's-new panel, README/AGENTS.md 2.0 updates, and a whole-game integration sweep (dead ends, 2-tap reachability, console errors).
>
> **Read (after AGENTS.md):** PLAN2.md §A3 checklist 12 + quality bars (2-tap rule, no dead ends), §E0.1-6 (whatsNew2Seen flag — landed in wave 1), §B6 (teaser presentation for locked features), §C5/§C2 (what to tease: quests L2, garden L3). Then read `src/ui/onboarding.js` (fully — 8-step machine), `src/ui/dailyBonusPopup.js` (boot-popup pattern), `core/save.js` (the flag), `README.md`, `AGENTS.md`, `test/onboarding.test.js`.
>
> **OWNS (create):** `src/ui/whatsNew.js` (one-time panel for migrated v1 saves: friendly 6-bullet tour of the 8 pillars, single CTA, sets `onboarding.whatsNew2Seen`, NEVER shows on fresh saves or twice), `src/data/strings/v2-polish.js`. **(modify):** `src/ui/onboarding.js` (additive: post-tutorial teaser step pointing at the quest board (L2) and garden dot (L3) — light touch, skippable, machine stays resumable; fresh-player completion must not regress), `main.js` (whatsNew boot check — anchor: after the daily-bonus boot lines), `README.md` (2.0 features section, 21-game list, garden/vet/quests/album/photo/skins/weather documentation, updated counts), `AGENTS.md` (2.0 delta notes: new systems modules, strings-module rule §E0.1-1, constants read-only ruling, garden/ambience dev tips, new harness params if any agent added them), `test/onboarding.test.js` (extend: teaser step machine, whatsNew show-once logic incl. migrated-vs-fresh).
> **INTEGRATION SWEEP (report, fix only trivial ≤5-line issues in files you own or via marked one-liners; else file for the coordinator):** fresh `?reset=1` boot → full onboarding → daily bonus (unchanged flow proof); migrated v1 fixture boot → What's-new once → home intact; 2-tap reachability audit for every §A pillar surface; a 20-minute scripted free-play across garden/vet/quests/album/photo/2 new games with the console error log captured (zero errors bar); every locked surface shows the v1-pattern teaser (no dead ends).
> **DO NOT TOUCH:** minigame files (G27/G28 concurrent), audio files (G29), all feature internals — your sweep OBSERVES; fixes belong to owners via the coordinator unless trivially yours.
>
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v2-g30/`: onboarding full run (fresh) screenshots incl. the new teaser; What's-new on a seeded v1 save + absent on second boot + absent on fresh; sweep evidence (console log captures, reachability tap-count table). Layout matrix for whatsNew panel + changed onboarding steps (8 shots each).
> **Dependencies:** waves 1–3 (sweeps everything merged; notes what it couldn't sweep because G27/G28/G29 land concurrently — the §F evals cover those). **Ports:** vite 5178 / CDP 9224.

---

# §F. Eval Plan — 20 independent evaluation agents + fix loop (2.0)

## F1. How evals run

Launch after §G3 checkpoint CP-W4 is green (all 16 build agents merged, suite green, CI green). Evals are **READ-ONLY**: they never edit, commit, or fix — they observe, measure, and file verdicts. Up to 5 run concurrently using the §E0.3 port slots (eval n uses slot `((n−1) mod 5)`: vite 5175+((n−1) mod 5), CDP 9221+((n−1) mod 5)). Each eval agent gets its §F2 block + the §F1.1 preamble, forwarded verbatim as one message.

### F1.1 COMMON EVAL PREAMBLE (relay verbatim after each §F2 block)

> You are eval agent V2-E<n> for GOOBY 2.0, a finished(?) Pou/Talking-Tom-class virtual-pet game in `/workspace/GOOBY` (three.js + Vite + vanilla ESM, Capacitor iOS, EN+DE, portrait 320–430 px): fat rabbit Gooby, 21 arcade minigames, a real-time garden, sickness/vet/weight sim, daily quests, sticker album, fur skins, drivable city with shop + vet, real-clock day/night + weather, stats screen + photo mode. Your charter is above; judge it against the binding specs in `GOOBY/PLAN2.md` (2.0) and `GOOBY/PLAN.md` (v1 baseline).
>
> **Rules.** READ-ONLY: no file edits, no commits, no fixes, no constants "corrections" — you measure and report. Read `GOOBY/AGENTS.md` first (conventions + VM/CDP recipe: SwiftShader is slow — correctness over fps; no audio device — use `audio.getStats()` + console logs). Read the PLAN2.md sections your charter names. Use YOUR ports only (given in your block): `npx vite --port <vite> --strictPort --host` + `chromium --headless=new --remote-debugging-port=<cdp>`; never touch port 5174/tmux. Drive real flows over CDP (`Input.dispatchTouchEvent`, `Runtime.evaluate` on `window.__gooby`, `Page.captureScreenshot`); use the dev harness (`?reset/?scene/?room/?minigame/?autoplay/?fast/?now/?coins/?level/?lang/?open`, see AGENTS.md) to reach states fast. Kill your own processes (by PID) when done.
>
> **Evidence.** Everything to `/tmp/gooby-v2-e<n>/` (screenshots, JSON dumps, logs, tables). Copy your 3–8 BEST, most probative artifacts to `/opt/cursor/artifacts/` prefixed `v2e<n>_` (e.g. `v2e3_garden_harvest_de_320px.png`). Every claim in your report must map to an artifact or a command output.
>
> **Verdict format.** ① VERDICT: PASS / PASS-WITH-NOTES / FAIL against your pass bar; ② findings list, each: `[P0|P1|P2] <one-line title> — repro steps — evidence path — suspected owning module (§E ownership tables)`; P0 = blocks ship (crash, data loss, spec violation of a §A hard constraint, unplayable feature), P1 = must fix before ship (broken spec behavior, layout break, wrong math), P2 = polish; ③ the measurements your charter demands (tables); ④ what you could NOT verify and why. Be adversarial and specific; a PASS with untested claims is worse than a FAIL.

## F2. The 20 charters

Each block below = mission + mandatory spec reads + procedure + pass bar. (Slot = `((n−1) mod 5)` → ports per §E0.3.)

**V2-E1 — Gooby character + skins.** Read PLAN.md §D2, PLAN2.md §C8.5, §C4.3. In `?scene=gooby` and home: all 14 v1 clips + v2 additions (queasyWobble, sneeze, new G29 idles) distinct and smooth; 8 emotions; regions; blink/lookAt. Equip each of the 7 skins (`?coins=9999&level=5`, buy via console/economy): verify BODY/BELLY/EAR_INNER swap exactly per §C8.5 hex table (sample pixels), cheeks/nose/eyes untouched, golden metalness visible, skin persists across reload + shows in ≥2 minigame cameos + photo mode. Weight tiers 0.93/1.00/1.07/1.14: force `weight.value` via console — silhouette changes animate ~2 s, outfits (hat/glasses/neck incl. cape + wizardHat) still sit right at 0.93 AND 1.14. **Pass bar:** all clips/emotions work; all 7 skins pixel-correct + persistent + cameo-visible; no anchor drift at extreme tiers.

**V2-E2 — care loop + reactions.** Read PLAN.md §C3, PLAN2.md §C3.2–3.4, §C10.3. Full care loop: pet/tickle/poke/feed/wash/toilet/ball with v1 math intact (caps, refuse ≥95, hygiene formula); new: junk feed shows 🍬 badge + belly band icon; junkScore 4 tummy-rumble toast + belly pat; queasy: green cheeks, ~40 s sneezes, fun decay ×1.25 (measure via `?fast=`), queasyWobble idle; sick: mood cap 39, refusal toast on minigame start, thermometer + droopy ears, 🤒 chip → care sheet; night: yawns ~45 s + eyelid bias (pinned `?now=`). Medicine drag flow from the tray Care row. **Pass bar:** every v1 interaction regression-free; every §C3.2–3.4 effect observable and matching numbers; care sheet reachable ≤2 taps while sick.

**V2-E3 — garden full cycle.** Read PLAN2.md §C2 (all), §B4 rain contract, §C2.4. Fresh save → L3 unlock (locked teaser before); plant/water/harvest EVERY one of the 8 crops (use `?now=` pinning + re-navigation to fast-forward real-time growth; verify progress halts when `wateredUntil` lapses); fertilizer once-only +25%; stage models at 0/33/66/100%; sell math per §C2.3; plots 5/6 purchase gating (L10/300c, L16/600c); OFFLINE: plant watered → jump clock +2 h → progress accrued; rain block elapsed offline → `wateredUntil` extended; notification id 6 scheduled at `readyAt` only when watering suffices (dump `computeSchedule`); harvest → inventory → eat AND sell; veggie stickers award; decor slots render owned items. **Pass bar:** all 8 crops complete the full cycle with §C2.3-exact numbers; offline growth + rain-water provable; notification honest (no lie when under-watered).

**V2-E4 — sickness / vet / weight.** Read PLAN2.md §B5, §C3, §C4, §C9.2. Drive the state machine to every transition at EXACT thresholds via scripted feeds + `?fast=`/`?now=`: junk 5→queasy, 8→sick, neglect 120/360 min paths, 60-clean-min recovery (and its reset on junk), sick never auto-recovers; medicine sick→queasy→healthy consuming items; vet cure any→healthy + counters reset + stats +10; checkup report card correctness (junk band/neglect/weight tier); weight: +2 junk / +0.5 healthy / −1 active game / −0.25 other / −0.2 fetch / drift 2 per 24 h both directions incl. offline 0.3×; tiers exact at 25/60/85; **never punitive:** verify weight changes NO stat/price/score and sickness costs nothing beyond spec (fun ×1.25 queasy, minigame refusal sick). **Pass bar:** every transition reproduced at its exact threshold; both cure paths + checkup exact; weight cosmetic-only proven.

**V2-E5 — day/night + weather.** Read PLAN2.md §B4, §C10, §C11. Pin `?now=` to boundary minutes (05:59/06:00/06:29/06:30/17:59/18:00/20:59/21:00) — band + 30-min crossfade correct; all 4 §C10.2 rows visually applied in living room + garden + bedroom window (compare against the hemi/dir/sky values via `renderer`-side dumps where possible); dusk lamps auto-on; night: stars + moon, moonlight dir 0.15, city headlights; dawn birdsong nodes in garden. Weather: same date+block on two boots ⇒ identical state (determinism = shared world); distribution sanity via `weather.weatherAt` sweep (test exists — re-run + spot-check); cloudy ×0.85 desaturation; rain: garden quads ≤ +1 draw call (renderer.info before/during), window streaks in ALL indoor rooms, plots auto-watered during a live rain tick, forecast chip + sheet copy correct EN+DE; fishingPond ripples during rain; nightEel spawnable only at night (console-force band + fish rolls). **Pass bar:** every §C10.2/§C11.2 effect present and numerically plausible; determinism holds; rain draw-call budget met.

**V2-E6 — quests + collections.** Read PLAN2.md §B7, §C5.1, §C6. Quest board from L2 (teaser at L1); deterministic roll on pinned day (two boots ⇒ same 3); ≥2 categories; `requires` filtering (L1 save must never roll gated quests); progress events fire for AT LEAST 10 different pool entries by actually doing the action (feed3, wash1, play3, earn60, plant2, water4, harvest2, sell1, drive1, buyFood1 — via autoplay/harness); claim pays coins+XP once; reroll exactly once/day replacing only untouched quests; midnight rollover via `?now=`. Album: all 4 sets' award paths work (fish via fishingPond catches incl. species variety; veggies via harvests; landmarks via driving; treats via eating); silhouette→filled + counts; set claim pays once + reward furniture appears in `furniture.owned` AND is placeable; goldenFish 2%±0.5 over ≥10k seeded console rolls. **Pass bar:** roll/claim/reroll exact; ≥10 quest events verified live; all 4 sets earnable + claimable exactly once; album UI truthful.

**V2-E7 — achievements + leveling + unlock gating.** Read PLAN2.md §C5.3, §B6, §C5.2. All 33 achievements: unit-verify (suite) + live-trigger ≥ 8 of the 17 new ones (firstHarvest, firstQuest, firstSticker, firstCure, vetVisit, chonkZone, holeInOne via miniGolf autoplay/scripted, shutterbug via 10 photos); play21 by completing all 21 via autoplay chain; level cap 40 (XP grants per §C5.2: harvest +2, delivery +3, photo +1 ≤5/day, sticker +5, set +50; L40 cumulative 40 950; L17–40 reward 25·L); EVERY §B6 row enforced: at each level 1–16, exactly the spec'd features/games/crops unlock (drive via `?level=`), locked surfaces show the v1 teaser pattern, `?minigame=` bypass still works for dev. **Pass bar:** 33/33 reachable; ≥8 new ones live-triggered; §B6 table enforced row-by-row; XP sources exact.

**V2-E8 — economy balance v2.** Read PLAN2.md §C1.1, §C2.3 economics, §C5.1 reward sizing, §A3 quality bar, PLAN.md §C6. Re-run + extend the economy sim mentally and empirically: (a) suite sim passes; (b) hand-script an "average 15-min day" over CDP (daily bonus, 3 quests done+claimed, 10–12 min mixed autoplay games incl. 1 premium, radish+carrot garden cycle, feed to satiation incl. 1–2 junk) for 3 consecutive pinned days — **target nets: day net ≥ +100c after food; 7-day extrapolated disposable ≥ 400c** (one §C8 sink/week per §A3); (c) payout audit: every one of the 21 games' 5-run autoplay payouts inside its coin row, 10–15 c/min sanity, first-play ×2 once; (d) sink/source audit: skins 400–1500, golden gnome 900, cape 500, vet 120/30, medicine 40, fertilizer 25, seeds/sell per §C2.3 (garden ROI ≈ §C2.3's stated c/h — no exploit: check watermelon/pumpkin per-plot rates, reroll abuse, sell-buy arbitrage: sell price MUST be < shop buy price per crop); (e) quests ≈ +75c/+37xp/day average via 200 seeded roll simulations (console). **Pass bar:** targets met, no arbitrage/exploit found, every payout in-row.

**V2-E9 — save v2 migration + hostile fuzzing.** Read PLAN2.md §B2, PLAN.md §E3. Suite green (saveV2.test.js) + live: load each committed v1 fixture via localStorage injection → v===2, EVERY v1 value byte-identical (deep-diff dump), new slices at §B2 defaults, whatsNew2Seen false → panel once; fresh save → whatsNew2Seen true → never; forward-version v:3 refused (fresh state + backup); corrupt JSON/truncated/wrong-types recover; **hostile fuzzing:** ≥ 25 mutations (garden.plots wrong length/negative progress, health.state 'zombie', weight 9999/−5/NaN, quests.active malformed, collections entries non-numeric, unknown keys everywhere, missing v, string coins) — every load ends in a valid, playable, clamped state with no console errors; v2 reload idempotent (save→load→save byte-stable); mid-minigame kill + reload; `?reset=1`. **Pass bar:** zero crashes, zero data loss on legit saves, every fuzz case lands in a valid state.

**V2-E10 — minigames regression: the 12 v1 games.** Read PLAN.md §C6 + PLAN2.md §B3 (meta additions must not break v1). For EACH of the 12 v1 games: launch via `?minigame=`, complete via `?autoplay=1` (and one manual-ish CDP run for 3 of them), record a **per-game table: completed? | raw score | payout | in-row? | ×2 once? | pause/resume OK | console errors**; confirm framework consistency (countdown/pause/results), fishingPond's NEW species roll didn't change catch feel/scoring, cityDrive's landmark triggers + meta didn't alter §C4 rewards/tow rules, danceParty clock still synced, cameos wear skins+outfits. **Pass bar:** 12/12 complete cleanly with in-row payouts and zero regressions vs PLAN.md §C6.

**V2-E11 — minigames: the 9 new games deep-check.** Read PLAN2.md §C1 (ALL). For EACH new game: complete ≥3 autoplay runs + 1 scripted manual run; verify EVERY §C1.2 design number observable (e.g. goobySays 320 ms floor, gardenRush perfect-zone 25%, burgerBuild +8%/burger, veggieChop 3-miss end, deliveryRush time bonus + −5 crashes floor 0, miniGolf par scoring 30/20/12/6 + windmill blocking, goalieGooby super-save window, starHopper shield at ≥60, pipeFlow efficiency bonus math); §C1.3 distinct looks (screenshot each; assert no two share skybox/palette); meta flows (deliveryRush landmarks/deliveries, miniGolf strokes/holeInOnes) reach collections/quests/achievements; same per-game table as E10 + energy costs (6 for deliveryRush, 8 others). **Pass bar:** 9/9 fully §C1-conformant with evidence per number checked.

**V2-E12 — city / vet / delivery driving.** Read PLAN2.md §C9, PLAN.md §C4. Full shop trip (regression, incl. tow rule + quick delivery at L8); full vet trip: destination picker prices, 10 pickups, arrival panel, cure 120c only-when-sick, checkup 30c always, can't-afford hint, „Nach Hause" teleport, `vetTrips`/`trips` counters; route ≈ 7 tiles ≈ 25–35 s; all 6 landmarks discoverable in one free-drive session (map their positions from `generateCityLayout` and drive each 15 m trigger; camera-flash gag + once-only award); deliveryRush 3-parcel round on the same city; determinism: layout identical across boots; drive draw calls ≤ 180; distanceM accumulates to the profile. **Pass bar:** both destinations + delivery work end-to-end; landmark set completable by driving; §C9 numbers exact.

**V2-E13 — shop / wardrobe / photo / stats screens.** Read PLAN2.md §C7 (shop UX), §C8, §C12. Shop: food filters Alle/Gesund/Süßkram × EN+DE, junk badges, Care row (medicine/fertilizer distinctly non-eatable), 32 foods listed + purchasable, crop foods buyable, Skins tab (L5 gate, try-on, buy each price tier), furniture tab incl. garden filter + all 23 new indoor items placeable in their slots (place EVERY new item once — screenshot grid), wallpapers 10 / floors 7 apply + persist per room; wardrobe: Fur category try-on/equip, 20 outfits equip incl. anchors on all weight tiers (spot-check 2); photo mode: every pose × frame combo captures (15 PNGs — verify UI-less, 1080×1440, frame drawn, ambience visible), share-fallback download works headless, XP cap 5/day, `photos` counter; stats screen: every §C12.1 section present with LIVE values cross-checked against store dumps (play a game → best updates; drive → km updates; 21 rows), 320 px 1-col collapse. **Pass bar:** every catalog item purchasable+functional; photo pipeline produces valid PNGs; stats truthful.

**V2-E14 — notifications v2.** Read PLAN2.md §B3 notifications row, §C2.4, §C3.5, PLAN.md §C7. Suite green (notifyRules) + live `computeSchedule` dumps across scenarios: ids 1–5 regression; id 6 at `readyAt` only when watering suffices, ≥10 min future, single instance; id 7 sick+4 h, max 1/day; MAX 7; quiet-hours 22–08 shift to 08:05 (except wake), 30-min spacing cascade; reschedule on hide + cancelAll on open (CDP visibilitychange); permission soft-ask unchanged; copy EN+DE exact per §C2.4/§C3.5. **Pass bar:** schedule output exactly §C7+§B3-conformant in every scenario dump.

**V2-E15 — audio & haptics v2.** Read PLAN.md §D6, PLAN2.md §C11.2 (rain loop spec), §C1.2 (per-game audio), AGENTS.md (no audio device — getStats/console evidence). Static: every `audio.play` id in `src/` mapped (the suite enforces — re-run + grep sweep); live `audio.getStats()` during: garden water/harvest/sell, quest claim, sticker pop, set jingle, photo shutter, vet cure, medicine, goobySays 4 distinct pad pitches, golf putt/sink, chop/splat, delivery doorbell, bell-collar hop jingle, rain loop start/stop at block boundaries + LP/−18 dB params, dawn birdsong, night quiet; toggles: sfx/music off ⇒ zero new nodes, persists; haptic fields present on new defs, guarded (no web crash). **Pass bar:** zero unmapped/broken ids; ≥ 20 distinct v2 sounds proven firing; toggles airtight.

**V2-E16 — layout matrix, strict (ALL screens).** Read PLAN2.md §A2.2. Enumerate EVERY screen/panel/sheet/HUD state (v1 + v2 — walk `ui.js` registrations + panels; expect ≈ 25+ surfaces incl. questBoard, album ×4 pages, profile ×5 sections, photo toolbar, gardenPanel seed+sell, forecast sheet, careSheet, vetPanel, destination picker, whatsNew, shop ×5 tabs, wardrobe ×4 cats, 21 results screens sampled ≥6). For each: 320/375/390/430 px × EN+DE screenshots (via `Emulation.setDeviceMetricsOverride`), automated overflow probe (`document.scrollingElement` horizontal overflow + `getBoundingClientRect` overlap/clip scan on text nodes — script it via `Runtime.evaluate`), touch-target audit ≥ 44 px (flag < 48). Deliver the full pass/fail grid. **Pass bar:** ZERO clipped/overlapping text and zero <44 px targets across the entire grid (DE is the stress case).

**V2-E17 — performance & resource hygiene.** Read PLAN2.md §A2.3, PLAN.md §E10. Measure `renderer.info` per scene: home rooms ≤ 120 dc/150k tris, garden ≤ 130/160k, drive + deliveryRush ≤ 180, every other minigame ≤ 150 (sample all 21), rain ≤ +1 dc; one shadow map home-only; pixelRatio ≤ 2; texture memory ≤ 64 MB (renderer.info.memory); bundle: `npm run build` → main chunk ≤ 1.6 MB gzip, EVERY new game chunk ≤ 150 KB gzip (report table), committed assets ≤ 25 MB target/80 hard (`du`); scene-switch ≤ 1.5 s at 4× CPU throttle (CDP `Emulation.setCPUThrottlingRate`); leak audit: 20× home↔minigame↔garden switches → `renderer.info.memory` geometries/textures return to baseline ±5; 45-min ambience soak (fast clock) → no listener/interval accumulation (`getEventListeners` sample + heap snapshots Δ). **Pass bar:** every budget met with measurements attached.

**V2-E18 — code quality & licensing.** Read PLAN.md §B/§E, PLAN2.md §B1, §E0.1, §D5. `npm run lint` clean; structure matches §B1 (every listed file exists in its place); purity rule (grep: no three/DOM imports under `systems/`, `data/`, `*.logic.js`); design numbers centralized (constants.js §E0.1-2 ruling — spot-grep for suspicious inline numbers in UI/game files vs their logic consts); strings discipline (no hardcoded user-facing strings — sample 15 files; EN/DE parity across all v2 modules — script a key-diff); JSDoc on new public APIs; marked-block hygiene (`// V2/G` blocks attributable); no MONKEYBAR imports; licensing: every pack dir (12 packs now) has License.txt, no non-Kenney binaries (`file` sweep), assets.test green, zero 404s in a full-boot console log. **Pass bar:** all clean; violations listed with file:line.

**V2-E19 — iOS/CI + .ipa correctness.** Read PLAN.md §F, PLAN2.md §A2.8 (no new pods), §A3 item 11. `gh run list --workflow gooby-ios.yml` → latest main run green (both jobs); download `gooby-unsigned-ipa` artifact (`gh run download`); `unzip -l`: Payload/App.app present, app binary, `public/` webDir containing the v2 bundle (check for a new-game chunk filename), icon assets; Info.plist (in repo + in ipa via plutil/strings): portrait-only both idioms, `UIRequiresFullScreen`, `ITSAppUsesNonExemptEncryption=false`, `CFBundleDisplayName=Gooby`, NO camera/mic keys (§A2.8 — photo mode must not have added any); capacitor.config.json unchanged webDir/appId; package.json: no new Capacitor plugins; `npm run build && npx cap sync ios` clean locally. **Pass bar:** green CI on the final main SHA + structurally valid unsigned ipa + zero new native perms/pods.

**V2-E20 — full-game verdict + bug sweep.** Read PLAN2.md §A (ALL — you are the §A3 auditor). Walk the §A3 acceptance list item by item: counts table (script-count catalogs from the data modules + arcade tile count screenshot), feature checklist 1–12 each demo'd end-to-end (garden cycle, sickness both triggers, weight tiers, quest day, album set claim, vet+delivery, day/night+weather, stats+photo, all-21 autoplay chain, save v2 fixture, lint/test/build+CI status from E19, fresh onboarding + veteran What's-new), quality bars (2-tap reachability per pillar, no dead ends, EN+DE everywhere); then a **45-minute continuous free-play session** (fast clock where useful) with the console error log captured start-to-finish — zero errors bar — plus a subjective "is this a Vollversion, not an alpha?" product-owner verdict with the 5 weakest spots ranked. **Pass bar:** every §A3 item TRUE with evidence; zero console errors in the soak; verdict must be argued, not asserted.

## F3. Fix loop (coordinator protocol, after all 20 verdicts are in)

1. **Triage matrix.** Build `/tmp/gooby-v2-eval/triage.md`: one row per finding — `id | P | title | evidence | owning module(s) | owning §E agent domain | eval(s) to re-run`. Merge duplicates across evals (same root cause = one row, keep all evidence links). Anything P0/P1 ships to fix agents; P2s are batched into at most one polish fix agent per round (or explicitly deferred with justification).
2. **Fix waves.** Group P0/P1 rows by §E ownership domain into fix agents `V2/F1, V2/F2, …` (3–5 per round, port slots A–E) with **strictly disjoint file lists** (same discipline as §E0; shared-append files follow §E0.2 rule 5). Each fix prompt = the v1-proven §H pattern: agent block containing (a) the original §E agent's product context + its OWNS list as the ownership boundary, (b) the verbatim finding rows (repro + evidence paths), (c) the §E0.2 COMMON RULES, (d) requirement to add a regression test per fixed P0/P1 where a pure surface exists, (e) commit message `GOOBY V2/F<n>: <summary>`.
3. **Targeted re-evals.** After each fix wave merges + §G2 checkpoint passes: re-run ONLY the evals listed in the fixed rows (fresh eval agents, same charters, prompts prefixed with "RE-EVAL round <k> — focus findings: <ids>, then spot-check your full charter"). A fixed finding needs the re-eval to reproduce the original steps and show the new behavior.
4. **Exit criteria (ship gate):** zero open P0 + zero open P1; the three hard bars each have a PASSING verdict in their latest run — **layout** (E16 full-grid zero-defect), **economy** (E8 targets met), **migration** (E9 zero-loss/zero-crash); E19 green on the final SHA (re-run E19 if any fix touched `ios/`, workflows, `package.json`, or the build); E20 free-play soak repeated if > 10 P0/P1s were fixed in total. Then proceed to §G4 ship checklist.
5. **Loop.** If re-evals surface new findings, go to 1. Track rounds in `triage.md`; if a finding survives 2 fix rounds, escalate: assign a dedicated debug-focused agent with the full finding history instead of re-prompting the same fix scope.

---

# §G. Coordinator Runbook (2.0)

## G1. Ports & concurrency

Coordinator keeps the long-lived tmux dev server on **5174** (`tmux attach -t gooby-dev-server`) for its own smokes. Agent slots (max 5 concurrent, §E0.3): A=5175/9221 · B=5176/9222 · C=5177/9223 · D=5178/9224 · E=5179/9225. Slot assignments are printed in each §E block. Evals map by `((n−1) mod 5)`. If a slot's port is stuck after an agent dies: `lsof -ti:<port>` → kill that PID only.

## G2. Between-wave checkpoint (run from `/workspace/GOOBY` after every wave's commits land)

```bash
git -C /workspace log --oneline -8          # every expected "GOOBY V2/G<id>:" commit present?
git -C /workspace status --short            # tree clean (no half-committed agent debris)
npm install                                  # only if package.json/lock changed (it should NOT in 2.0 — investigate if so)
npm run lint                                 # exit 0
npm test                                     # exit 0 — expected totals: ≥520 after W1, ≥560 after W2, ≥600 after W3, ≥640 after W4
npm run build                                # exit 0; note main-chunk gzip + per-game chunk sizes
node -e "const s=require('child_process')"   # (asset budget — see G3 command)
```

Quick CDP smoke (coordinator's 5174 server; or `npm run shot` for static states): boot `/` fresh + with a v1-fixture save injected; `/?scene=home&room=living` renders; zero console errors. Then the wave's integration checkpoint below. Any red → relaunch the owning agent with the failure log appended to its §E prompt (v1 §0.2 pattern); do not start the next wave until green.

## G3. Wave execution order & integration checkpoints

**CP-W1** (after G15, G16, G17, G18): suite green with ≈ +210 tests; `git show HEAD:GOOBY/src/data/strings.js | grep v2-` shows the 11-module spread; boot unchanged for a v1 save except the What's-new flag in the migrated dump (`__gooby.store.get('onboarding')`); `test/dataV2.test.js` + `test/saveV2.test.js` pass standalone: `node --test "test/saveV2.test.js" "test/dataV2.test.js"`. Asset budget: `du -sb public/assets/kenney | awk '{printf "%.1f MB\n", $1/1048576}'` — expected ≈ 11 MB, **target ≤ 25 MB, hard fail > 80 MB (§A2.4)**.

**CP-W2** (after G19–G23) — "garden+vet reachable in a fresh boot": on a fresh `?reset=1&level=3&coins=500` boot, the 5th nav dot exists and opens the garden; plant+water a radish via touch; `?level=1` shows the padlocked dot. Vet: force sick via console, 🤒 chip → care sheet → vet drive → cure (or `?level=1` checkup path) completes and pays 120/30c. Quest board opens from HUD at L2 with 3 cards; album/profile/photo open from their HUD buttons; photo capture produces a PNG blob. Landmarks present in `generateCityLayout(seed)` dump. Layout spot-check: gardenPanel + vetPanel + profile at 320 px DE.

**CP-W3** (after G24, G25, G26): `?minigame=goobySays|gardenRush|burgerBuild|starHopper|pipeFlow` each complete via `&autoplay=1` (payout in-row, logged); ambience: pinned `?now=` night boot shows night lighting in living + garden + stars; a rain block shows garden rain + window streaks; `renderer.info` garden ≤ 130 dc.

**CP-W4** (after G27–G30) — "all 21 games complete via autoplay chain": script the chain (sequential CDP sessions):
```
for id in cityDrive carrotCatch bunnyHop carrotGuard memoryMatch runner basketBounce \
          pancakeTower danceParty fishingPond bubblePop trampoline goobySays gardenRush \
          burgerBuild veggieChop deliveryRush miniGolf goalieGooby starHopper pipeFlow; do
  # navigate to /?minigame=$id&autoplay=1&level=40&energy=100 ; await results screen ;
  # record {id, score, coins, console errors} → /tmp/gooby-v2-cp4/chain.json
done
```
21/21 must reach the results screen with in-row payouts and zero console errors. Plus: fresh-boot onboarding completes; v1-fixture boot shows What's-new exactly once; README/AGENTS.md updated; full suite ≥ 640 green; build chunk table within §A2.3 budgets. Then launch §F evals.

**Wave launch summary:** W1 (G15,G16,G17,G18) → CP-W1 → W2 (G19,G20,G21,G22,G23) → CP-W2 → W3 (G24,G25,G26) → CP-W3 → W4 (G27,G28,G29,G30) → CP-W4 → §F evals → §F3 fix loop → G4.

Commit policy: agents commit locally per §E0.2 and never push; the coordinator pushes `main` only at: after CP-W1, CP-W2, CP-W3, CP-W4 (keeps CI exercising the tree wave-by-wave — watch each `GOOBY iOS` run), and after each fix round.

## G4. Final ship checklist

1. §F3 exit criteria met (zero P0/P1; layout/economy/migration bars PASS; E20 verdict PASS).
2. `npm run lint && npm test && npm run build` green on the final tree; asset budget command (G3) ≤ 25 MB target; `git -C /workspace diff --stat main origin/main` reviewed — only GOOBY/ + workflow paths touched, MONKEYBAR untouched (`git log --oneline origin/main..main -- MONKEYBAR` empty).
3. Push: `git -C /workspace push origin main`.
4. Watch CI: `gh run watch $(gh run list --workflow gooby-ios.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')` → BOTH jobs green.
5. Artifact: `gh run download <run-id> --name gooby-unsigned-ipa --dir /tmp/gooby-v2-ship/` → verify: `unzip -l /tmp/gooby-v2-ship/gooby-unsigned.ipa` shows `Payload/App.app/App` (binary), `Payload/App.app/public/` with the v2 web bundle (spot-check a new game chunk name from the local `dist/`), `AppIcon` assets, `Info.plist`.
6. Plist keys (extract from the ipa): portrait-only (both idiom variants), `UIRequiresFullScreen=true`, `ITSAppUsesNonExemptEncryption=false`, `CFBundleDisplayName=Gooby`, and NO camera/mic/photo-library usage keys (§A2.8).
7. `cp /tmp/gooby-v2-ship/gooby-unsigned.ipa /opt/cursor/artifacts/gooby-2.0-unsigned.ipa` + copy the CP-W4 chain table, the E20 verdict, and the best `v2e*_` artifacts inventory into the final report.
8. Final report to the owner: §A3 counts table (actual vs target), eval verdict summary, fix-round history, known P2s deferred (with justification), and the sideload steps pointer (README).

*End of PLAN2.md — §A–§D by plan agent 1, §E–§G by plan agent 2.*
