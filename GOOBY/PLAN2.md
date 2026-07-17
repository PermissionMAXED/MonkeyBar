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




