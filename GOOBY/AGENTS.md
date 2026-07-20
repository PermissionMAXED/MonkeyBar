# AGENTS.md — GOOBY

Working notes for AI/build agents (and humans) developing GOOBY. The binding
architecture contract is `PLAN.md` (§E especially); `PLAN2.md` is the binding
2.0 spec, `PLAN3.md` the binding 3.0 spec and `PLAN4.md` + `PLAN4-GAMES.md`
the binding 4.0 specs (§A acceptance, §B deltas, §C/§G feature numbers) — this
file is the quick map.

## Layout

```
GOOBY/
├── index.html            #scene canvas + #ui overlay root
├── src/
│   ├── main.js           boot: save → store → scenes/UI wiring (marked agent blocks)
│   ├── core/             store (§E2 + versioned events), save (schema v4 +
│   │                     lossless v1→v2→v3→v4 migrations), clock (pinnable), sceneManager
│   │                     (RAF+fade §E1, captureFrame for photo/profile), input
│   │                     (§E5), assets (GLB cache + getAudioUrl), timeEngine
│   │                     (1 s tick + 60 s ambience ticker), notifications
│   │                     (guarded Capacitor adapter §E7, ids 1–8), photoStore
│   │                     (IndexedDB gallery)
│   ├── data/             constants.js frozen after V4/G53's one-time 4.0 block;
│   │                     strings.js EN+DE + strings/v2-* and v3-* per-feature
│   │                     + v4-* modules (edit ONLY your assigned module); foods/
│   │                     outfits(42)/furniture(58)/achievements(37)/
│   │                     minigames(28 incl. special)/stickers(29 incl. secret)/
│   │                     music manifest/codes/harness params/catalogs
│   ├── character/        procedural Gooby rig (gooby.js, goobyAnims.js CLIPS,
│   │                     emotions), outfitAttach.js (applyEquippedOutfits),
│   │                     skins.js (applySkin fur tints §C8.5)
│   ├── home/             homeScene, roomManager (5 rooms incl. outdoor garden,
│   │                     getAnchor/goTo/tap:… events, setAmbience §B3),
│   │                     rooms/garden.js, gardenInteractions.js (plant/water/
│   │                     harvest), interactions.js (§C3 care), decor.js
│   ├── city/ + systems/shopTrip.js   drive minigame + shop/vet-trip state machine
│   │                     (cityBuilder: vet clinic + 6 landmarks, vetClinic.js)
│   ├── minigames/        framework.js (§E8 ctx + difficulty/modifier/invert),
│   │                     registry, games/*.js — 27 arcade games + Gooby Welt,
│   │                     with PURE .logic.js siblings — that's what tests hit
│   ├── systems/          stats/sleep/economy/leveling/achievements/dailyBonus/
│   │                     notifyRules + 2.0 engines: garden/quests/collections/
│   │                     profileStats/health/weight/dayNight/weather + 3.0
│   │                     stickerBook/nougat + 4.0 radio queue/modifiers/codes/
│   │                     recap/gallery/gyro/difficulty/economy guards — pure
│   │                     logic, no DOM/three imports (exact engine numbers live
│   │                     as frozen consts INSIDE each module, §E0.1-2)
│   ├── audio/            audio.js (5-bus WebAudio manager), musicDirector.js
│   │                     (5 file-jingle fallback contexts), radioPlayer.js
│   │                     (MediaElement streaming), sfxMap.js (id→sample/synth),
│   │                     goobyVoice.js (synth noises)
│   ├── gfx/              tween.js, particles.js (pooled 3D + DOM confetti),
│   │                     sky.js (garden dome + window skies), weatherFx.js
│   │                     (instanced rain/clouds — 1 draw call)
│   ├── ui/               ui.js (screens/panels/toasts §E6), hud (quest badge,
│   │                     camera, profile, sick chip), screens (questBoard,
│   │                     album+Stickerbuch, profile, photoMode, vetPanel,
│   │                     gardenPanel, devPanel),
│   │                     onboarding.js (§C8.1 tutorial + 2.0 teaser step),
│   │                     whatsNew.js (one-time 2.0/3.0/4.0 veteran panels),
│   │                     settings subscreens/radio/codes/gallery/recap, styles.css
│   └── dev/harness.js    URL-param test surface (§E9)
├── public/assets/kenney/ CC0 GLBs + audio (interface-sounds, impact-sounds,
│                         music-jingles — resolve via assets.getAudioUrl)
├── test/                 node:test suites — pure logic only (no DOM/three)
└── scripts/              screenshot.mjs (npm run shot), gen-icons.mjs,
                          kenney-manifest.mjs + fetch-kenney.mjs (asset whitelist)
```

## Conventions

- Vanilla ES modules + JSDoc types; no TypeScript, no frameworks. ESLint flat
  config (`npm run lint`) must stay clean.
- Shared design numbers live in `src/data/constants.js`; engine/game-local
  tuning lives in its owning pure module. Every user-facing string goes through
  `t(key)` with entries in BOTH `EN` and `DE` dictionaries.
- **Versioned strings ruling (PLAN4 §E0.1-8):** `src/data/strings.js` is frozen.
  2.0/3.0/4.0 keys live in assigned `strings/v2-*`, `v3-*` and `v4-*` modules
  (ownership header in each file). Add keys ONLY to your module, always EN + DE.
- **4.0 constants ruling (PLAN4 §E0.1-7):** `src/data/constants.js` is frozen
  after G53's one-time save/notify/codes/modifier/Gooby-Welt additions.
  Engine-internal exact
  numbers (health/weight thresholds,
  dayNight bands, weather percentages) are exported frozen consts INSIDE the
  owning engine module; per-game tuning lives in the game's `.logic.js`.
- Tests are `node:test` (`npm test`) and import pure modules only — keep game
  logic in `.logic.js` siblings / `systems/` so it stays headless-importable.
  The whole suite must stay green; `test/onboarding.test.js` also fails on any
  `audio.play('<id>')` not mapped in `sfxMap.js`.
- Files are committed with CRLF line endings — match that in new/edited files
  (mixed endings make noisy diffs).
- Cross-agent integration points are marked comment blocks (`// G14: …`,
  `// V2/G20: …`); respect file ownership per PLAN §G / PLAN2 §E and keep
  foreign-file edits to additive one-liners.
- Audio: call `audio.play('<semantic-id>')` freely, but every new id must reuse
  an existing recorded sample in `src/audio/sfxMap.js`. The 4.0 no-synth policy
  forbids new synth recipes; only the frozen existing voice/loop/gameplay
  exemptions remain. Haptics ride along via the def's
  `haptic: 'light'|'medium'` field. Music tracks: `'home'`
  and `'dance'` (100 BPM, seeded by `DANCE.PATTERN_SEED` — §D6 contract with
  danceParty's chart). Ambience loops (`ambience.rain`, `ambience.birdsong`)
  start via `audio.play` and stop via `audio.stop`.
- The 28 sticker-book images are AI-generated originals created for this
  project (CC0-equivalent, no third-party IP).

## Key §E contracts (summary — PLAN.md, PLAN2 §B3, PLAN3 §B)

- **§E1 scenes:** `{ scene, camera, enter(params), update(dt), exit(), dispose() }`
  registered on the sceneManager; assets preload by key before enter.
  2.0: `sceneManager.captureFrame()` renders + returns a PNG blob (photo/profile).
- **§E2 store:** `get/set/update/on`; specific events (`statsChanged`,
  `coinsChanged`, `sleepChanged`, …) + coalesced `change`; debounced autosave.
  2.0 events: `gardenChanged`, `healthChanged`, `weightChanged`,
  `questsChanged`, `collectionsChanged`, `skinChanged`, `itemsChanged`,
  `profileChanged` + runtime-only `dayBandChanged`/`weatherChanged` (60 s
  ambience ticker in timeEngine).
- **§E3 save:** versioned schema + migrations in `core/save.js` (localStorage,
  Capacitor-Preferences mirror on native). Never write localStorage directly.
  `migrations[1..3]` migrate v1→v2→v3→v4 losslessly and set only the target
  release's `onboarding.whatsNew{2|3|4}Seen = false`; fresh saves default all
  three flags `true`.
- **§E5 input:** normalized tap/drag/swipe events from the canvas; UI overlays
  block canvas input while open.
- **§E6 UI:** screens/panels are `{ mount(el, params), unmount() }` modules
  registered by id; `ui.toast(key, vars)`. 2.0 screens: `questBoard`, `album`,
  `profile`, `vetPanel`; 2.0 panels: `gardenSeeds/Sell/BuyPlot/Fertilizer/
  Forecast`, `careSheet`, `whatsNew`. 4.0 adds settings subscreens, codes,
  radio/tracks, credits, recap overlay and the album's Fotos tab.
- **§E7 notifications:** adapter no-ops without permission; reschedule hooks on
  save/background, cancelAll on open. 2.0 ids: `harvest: 6`, `sick: 7`;
  4.0 adds `modifier: 8`; `MAX_SCHEDULED: 8`.
- **§E8 minigames:** games get `ctx = { scene, camera, renderer, input, audio,
  assets, rng (seeded), hud, params, onScore, onEnd }`; framework owns countdown,
  pause, results, payout (`economy.awardMinigame` incl. daily ×2).
  2.0: `onEnd({score, meta?})` — `meta` feeds quests/collections (§B3 shapes);
  4.0: arcade launches carry difficulty/modifier/invert params and async
  init/dispose; sick Gooby stays blocked from arcade but may take shop/vet trips.
- **§C6/§C1.5 economy:** ALL coin awards/spends go through `systems/economy.js`
  (2.0 additions: `sellHarvest/buySeed/buyItem/useMedicine/payVet/buySkin/
  buyPlot`; 4.0 adds guarded code/modifier/endless paths + a dev-only ledger;
  every award/spend also feeds `profile.coinsEarned/coinsSpent`).
- **roomManager (2.0):** 5 rooms (kitchen · living · bathroom · bedroom ·
  garden); the garden def is `outdoor: true` (sky dome, no wallpaper/floor
  painter); `roomManager.setAmbience({band, weather})` lerps lights/skies.
  Locked garden (level < 3) shows a padlocked 5th nav dot + teaser.

### 3.0 contract deltas

- **Assets:** asset keys stay `'<slug>/<file-no-ext>'`. `PACK_FORMATS` in
  `core/assets.js` routes KayKit `.glb`/`.gltf` packs; unlisted packs remain
  Kenney `.glb`. Rigged characters MUST use `assets.getSkinnedModel(key)` plus
  shared `assets.getAnimations(key)`, never `getModel(key).clone()`.
- **Audio:** `audio.js` owns master/sfx/music/voice/ambience buses and maps
  slider values with `(v/100)^2`. `musicDirector` contexts are `home`, `garden`,
  `arcade`, `city`, `shop`; scenes call `setContext`, overlay screens use
  balanced `pushContext`/`popContext`. Music mute must create zero source nodes.
- **UI:** `settings.uiScale` is exactly 85/100/115/130 and applies live via root
  rem scaling. Safe-area chrome reads the root `--safe-*` variables. The dev
  panel is registered in all builds but hidden unless `settings.devUnlocked`
  (5 taps on language “Auto”); `?open=devPanel` bypasses only the UI entry.
- **Content:** 27 minigames auto-discover through `registry.js`; 42 outfits use
  hat/glasses/neck/back slots; 28 new Stickerbuch entries use
  `stickers.unlocked/seen`. The shop-trip machine offers drive or Shopping Surf
  for the shop, but vet trips remain drive-only.

### 4.0 contract deltas

- **Save + one-time comms:** `SAVE.VERSION = 4`; v1/v2/v3 migrate losslessly.
  `whatsNew4Seen` is `false` only after migration and is consumed on panel
  mount; fresh saves never see the veteran panel.
- **Radio/audio:** `audio.radio` exposes `start/stop/toggle/skip/setStation/
  setShuffle/setTrim/now/duck/getStats`; `audio.getStats().radio` is the
  headless proof surface. Radio uses one streaming media element, keeps the
  music mute airtight and ducks for recap/Dance Party; medleys remain fallback.
- **Progression + arcade:** recap milestones are levels 5…40 in steps of 5;
  every XP grant emits `xpGranted`; 27 arcade games use easy/normal/hard/endless
  where eligible. `goobyWelt` is the 28th, chill SPECIAL game and has no
  difficulty, endless or modifier mode.
- **Modifiers + economy:** one persisted modifier targets one eligible game;
  framework consumption and payout stacking stay centralized. All coin
  movement still uses `systems/economy.js` reason tags.
- **Codes + gallery:** codes are normalized, offline and once-per-save.
  `herzGooby` is secret sticker #29 without changing the 28-sticker completion
  target. Photo blobs live in IndexedDB (40-photo LRU); save v4 stores metadata
  only, and native export uses guarded Capacitor Share/Filesystem adapters.
- **UI + tools:** settings is a two-level IA; the dev panel has cards 1–18,
  including the harness table sourced from `data/harnessParams.js`. UI scale
  remains 85/100/115/130, controls inversion is global, gyro is opt-in, and
  sick Gooby may use either shop-trip method while arcade remains gated.

## Dev harness cheatsheet (§E9, dev builds only)

Generated from `src/data/harnessParams.js`; edit that table first, then
regenerate this block. Harness routes suppress onboarding automatically.

<!-- BEGIN GENERATED HARNESS PARAMS -->
### Save & state

| parameter | ready-to-paste example | effect |
|---|---|---|
| `reset` | `?reset=1` | wipe the save |
| `coins` | `?coins=500` | set coins |
| `level` | `?level=12` | set level (1–40) |
| `energy` | `?energy=80` | set the energy stat |
| `hunger` | `?hunger=80` | set the hunger stat |
| `hygiene` | `?hygiene=80` | set the hygiene stat |
| `fun` | `?fun=80` | set the fun stat |
| `lang` | `?lang=de` | language override (de\|en) |

### Clock & ambience

| parameter | ready-to-paste example | effect |
|---|---|---|
| `fast` | `?fast=10` | clock multiplier |
| `now` | `?now=1735689600000` | pin the clock (epoch ms — also pins day band + weather) |

### Routing

| parameter | ready-to-paste example | effect |
|---|---|---|
| `scene` | `?scene=home` | scene routing (home\|gooby\|roadtest) |
| `room` | `?room=garden` | home room (kitchen\|living\|bathroom\|bedroom\|garden) |
| `minigame` | `?minigame=carrotCatch` | direct minigame launch (bypasses level locks) |
| `open` | `?open=settings` | open a screen (shop\|wardrobe\|achievements\|arcade\|settings\|questBoard\|album\|profile\|devPanel) |
| `travel` | `?travel=surf` | direct shop trip via surf\|drive |
| `recappreview` | `?recappreview=meadow` | standalone recap-vignette preview (biome id or 1..8) — V4/G63 |
| `weltpreview` | `?weltpreview=windmill` | full-screen splat-scene preview (windmill\|townsquare, + &quality=low) — V4/G65 |

### UI & debug

| parameter | ready-to-paste example | effect |
|---|---|---|
| `uiscale` | `?uiscale=130` | UI scale override (85\|100\|115\|130) |
| `notch` | `?notch=1` | fake safe-area insets (59/34 px) |
| `sleep` | `?sleep=1` | start a nap right away |
| `autoplay` | `?minigame=carrotCatch&autoplay=1` | bot-plays the launched minigame |
| `autopilot` | `?travel=drive&autopilot=1` | bot-drives the shop/vet trip |
| `onboarding` | `?onboarding=0` | suppress the first-run tutorial |
| `petdebug` | `?petdebug=1` | pet/tickle gesture telemetry overlay |

### Feature demos

| parameter | ready-to-paste example | effect |
|---|---|---|
| `skin` | `?skin=honey` | own + equip a fur skin |
| `outfits` | `?outfits=strawhat,roundGlasses` | own + equip outfits (comma list) |
| `dailydemo` | `?dailydemo=4` | daily popup as streak day N |
| `achdemo` | `?achdemo=1` | seeded achievements screen |
| `whatsnew` | `?whatsnew=1` | force the What's-new panel (2 regresses 2.0) |
| `care` | `?care=feed:carrot` | care demos (tray\|wash\|feed:<foodId> + ?suds/?feedAt/?feedN) |
| `emotion` | `?scene=gooby&emotion=happy&clip=wave` | showcase deep link (with ?scene=gooby) |

### 4.0 (wave 1b+ owners noted)

| parameter | ready-to-paste example | effect |
|---|---|---|
| `difficulty` | `?minigame=carrotCatch&difficulty=hard` | launch difficulty easy\|normal\|hard\|endless (G56) |
| `invertx` | `?invertx=1` | invert controls left/right (G56 proxy) |
| `inverty` | `?inverty=1` | invert controls up/down (G56 proxy) |
<!-- END GENERATED HARNESS PARAMS -->

For legacy panel regression, `?whatsnew=3` forces 3.0 and `?whatsnew=2`
forces 2.0; the generated `?whatsnew=1` example forces the current 4.0 panel.
`window.__gooby = { store, ui, sceneManager, framework, clock, save }` for console poking.

## VM / headless testing notes

- Dev server: port **5174** (`npm run dev`), usually kept alive in the tmux
  session `gooby-dev-server` (`tmux attach -t gooby-dev-server`). A second
  snapshot server may run on 5199 — ignore it.
- Rendering in the VM is SwiftShader (software GL): expect ~5–15 fps and
  minutes-long first boots to look fine in screenshots but feel slow — that's
  the VM, not the game. There is **no audio device**; verify audio via console
  logs (`[audio] init`, `[audio] play … nodes=…`) and `window.__gooby` +
  `audio.getStats()` instead of listening. For radio checks, inspect
  `audio.getStats().radio` (`playing`, `trackId`, `gain`, `elementState`,
  transition/error counters); a silent VM is not a radio failure.
- Screenshots: `npm run shot -- "http://localhost:5174/?..." shots/<name>.png`
  renders under **virtual time** — great for static states, but rAF loops don't
  advance realistically, so minigame/anim flows look frozen.
- Interactive flows (onboarding, care gestures, minigames): drive real-time
  headless Chrome over **CDP** instead — launch
  `chromium --headless=new --remote-debugging-port=9222`, connect a WebSocket
  (e.g. `ws` from `scripts/node_modules`), then `Page.navigate`,
  `Input.dispatchTouchEvent`/`dispatchMouseEvent`, `Runtime.evaluate` on
  `window.__gooby`, and `Page.captureScreenshot`. That's the established
  practice for anything that needs the RAF loop running.
- The care/pet gesture needs several back-and-forth drag reversals over Gooby's
  body within ~1 s (see `gestures.js`); a single straight drag won't register.

## Cursor Cloud specific instructions

- GOOBY has one required development service: the Vite web app. Standard
  install/lint/test/build/run commands are in `README.md` and `package.json`;
  no database, API server or container is required.
- Leave the coordinator's long-lived port 5174/tmux service alone. Concurrent
  agents use their PLAN3 §E0.3 Vite/CDP slot ports and stop only PIDs they
  started. Use the established VM/CDP recipe in the preceding section.
- `npx cap sync ios` is a valid Linux packaging check; Xcode/CocoaPods native
  compilation remains macOS CI-only. Audio checks use `audio.getStats()` because
  the cloud VM has no audio device.
