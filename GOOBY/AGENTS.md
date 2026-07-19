# AGENTS.md — GOOBY

Working notes for AI/build agents (and humans) developing GOOBY. The binding
architecture contract is `PLAN.md` (§E especially); `PLAN2.md` is the binding
2.0 spec and `PLAN3.md` the binding 3.0 spec (§A acceptance, §B deltas, §C
feature numbers) — this file is the quick map.

## Layout

```
GOOBY/
├── index.html            #scene canvas + #ui overlay root
├── src/
│   ├── main.js           boot: save → store → scenes/UI wiring (marked agent blocks)
│   ├── core/             store (events §E2 + 2.0/3.0 events), save (schema v3 +
│   │                     lossless v1→v2→v3 migrations), clock (pinnable), sceneManager
│   │                     (RAF+fade §E1, captureFrame for photo/profile), input
│   │                     (§E5), assets (GLB cache + getAudioUrl), timeEngine
│   │                     (1 s tick + 60 s ambience ticker), notifications
│   │                     (guarded Capacitor adapter §E7, ids 1–7)
│   ├── data/             constants.js frozen after V3/G34's one-time 3.0 rows;
│   │                     strings.js EN+DE + strings/v2-* and v3-* per-feature
│   │                     modules (edit ONLY your assigned module); foods(33)/
│   │                     outfits(42)/furniture(58)/achievements(37)/
│   │                     minigames(27)/stickers(28)/crops/quests/collections/skins
│   ├── character/        procedural Gooby rig (gooby.js, goobyAnims.js CLIPS,
│   │                     emotions), outfitAttach.js (applyEquippedOutfits),
│   │                     skins.js (applySkin fur tints §C8.5)
│   ├── home/             homeScene, roomManager (5 rooms incl. outdoor garden,
│   │                     getAnchor/goTo/tap:… events, setAmbience §B3),
│   │                     rooms/garden.js, gardenInteractions.js (plant/water/
│   │                     harvest), interactions.js (§C3 care), decor.js
│   ├── city/ + systems/shopTrip.js   drive minigame + shop/vet-trip state machine
│   │                     (cityBuilder: vet clinic + 6 landmarks, vetClinic.js)
│   ├── minigames/        framework.js (§E8 ctx contract + §B3 onEnd meta),
│   │                     registry, games/*.js — 27 games, each with a PURE
│   │                     .logic.js sibling — that's what tests hit
│   ├── systems/          stats/sleep/economy/leveling/achievements/dailyBonus/
│   │                     notifyRules + 2.0 engines: garden/quests/collections/
│   │                     profileStats/health/weight/dayNight/weather + 3.0
│   │                     stickerBook/nougat and surf-travel wiring — pure
│   │                     logic, no DOM/three imports (exact engine numbers live
│   │                     as frozen consts INSIDE each module, §E0.1-2)
│   ├── audio/            audio.js (5-bus WebAudio manager), musicDirector.js
│   │                     (5 file-jingle medley contexts), sfxMap.js
│   │                     (id→sample/synth), goobyVoice.js (synth noises)
│   ├── gfx/              tween.js, particles.js (pooled 3D + DOM confetti),
│   │                     sky.js (garden dome + window skies), weatherFx.js
│   │                     (instanced rain/clouds — 1 draw call)
│   ├── ui/               ui.js (screens/panels/toasts §E6), hud (quest badge,
│   │                     camera, profile, sick chip), screens (questBoard,
│   │                     album+Stickerbuch, profile, photoMode, vetPanel,
│   │                     gardenPanel, devPanel),
│   │                     onboarding.js (§C8.1 tutorial + 2.0 teaser step),
│   │                     whatsNew.js (one-time 2.0/3.0 veteran panels), styles.css
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
- Every design number lives in `src/data/constants.js`; every user-facing string
  goes through `t(key)` with entries in BOTH `EN` and `DE` dictionaries.
- **Versioned strings ruling (PLAN3 §E0.1-2):** `src/data/strings.js` is frozen.
  2.0/3.0 keys live in assigned `strings/v2-*.js` / `strings/v3-*.js` modules
  (ownership header in each file). Add keys ONLY to your module, always EN + DE.
- **3.0 constants ruling (PLAN3 §E0.1-3):** `src/data/constants.js` is frozen
  again after G34's one-time save/game-row additions. Engine-internal exact
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
- Audio: call `audio.play('<semantic-id>')` freely — add the id to
  `src/audio/sfxMap.js` (Kenney ogg keys or a synth recipe name). Haptics ride
  along via the def's `haptic: 'light'|'medium'` field. Music tracks: `'home'`
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
  `migrations[1]` migrates v1→v2 losslessly and sets
  `onboarding.whatsNew2Seen = false` so ONLY migrated v1 veterans see the
  2.0 panel. 3.0: `SAVE.VERSION = 3`; `migrations[2]` migrates v2 losslessly
  and sets `whatsNew3Seen = false`; fresh saves default both flags `true`.
- **§E5 input:** normalized tap/drag/swipe events from the canvas; UI overlays
  block canvas input while open.
- **§E6 UI:** screens/panels are `{ mount(el, params), unmount() }` modules
  registered by id; `ui.toast(key, vars)`. 2.0 screens: `questBoard`, `album`,
  `profile`, `vetPanel`; 2.0 panels: `gardenSeeds/Sell/BuyPlot/Fertilizer/
  Forecast`, `careSheet`, `whatsNew`.
- **§E7 notifications:** adapter no-ops without permission; reschedule hooks on
  save/background, cancelAll on open. 2.0 ids: `harvest: 6`, `sick: 7`;
  `MAX_SCHEDULED: 7`.
- **§E8 minigames:** games get `ctx = { scene, camera, renderer, input, audio,
  assets, rng (seeded), hud, params, onScore, onEnd }`; framework owns countdown,
  pause, results, payout (`economy.awardMinigame` incl. daily ×2).
  2.0: `onEnd({score, meta?})` — `meta` feeds quests/collections (§B3 shapes);
  the framework refuses launches while Gooby is sick (except vet trips).
- **§C6/§C1.5 economy:** ALL coin awards/spends go through `systems/economy.js`
  (2.0 additions: `sellHarvest/buySeed/buyItem/useMedicine/payVet/buySkin/
  buyPlot`; every award/spend also feeds `profile.coinsEarned/coinsSpent`).
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

## Dev harness cheatsheet (§E9, dev builds only)

`?reset=1` wipe save · `?scene=home|gooby|roadtest` · `?room=kitchen|living|bathroom|bedroom|garden`
· `?minigame=<id>` (bypasses level locks) · `?open=shop|wardrobe|achievements|arcade|settings|questBoard|album|profile|devPanel`
· `?coins=N ?level=N ?energy=N ?hunger=N ?hygiene=N ?fun=N` · `?fast=N` clock
multiplier · `?now=<epochMs>` pin clock (also pins the day/night band + weather
block — the ambience engines are pure functions of the clock) · `?lang=de|en`
· `?sleep=1` start nap · `?autoplay=1` bot-plays the launched minigame
· `?onboarding=0` suppress the first-run tutorial (harness routes suppress it
automatically) · `?uiscale=85|100|115|130` · `?notch=1` fake safe areas
· `?travel=surf|drive` direct shop trip · `?petdebug=1` gesture telemetry.
Feature demos: `?skin=<id>` own+equip a fur skin ·
`?outfits=<id,id>` own+equip outfits · `?dailydemo=N` daily popup as streak
day N · `?achdemo=1` seeded achievements screen · `?whatsnew=1` force 3.0
What's-new (`?whatsnew=2` regresses 2.0) · `?autopilot=1` bot-drives the trip ·
`?care=tray|wash|feed:<foodId>` care demos (+`?suds=`, `?feedAt=`, `?feedN=`)
· `?scene=gooby&emotion=<id>&clip=<id>` showcase deep links.
`window.__gooby = { store, ui, sceneManager, framework, clock, save }` for console poking.

## VM / headless testing notes

- Dev server: port **5174** (`npm run dev`), usually kept alive in the tmux
  session `gooby-dev-server` (`tmux attach -t gooby-dev-server`). A second
  snapshot server may run on 5199 — ignore it.
- Rendering in the VM is SwiftShader (software GL): expect ~5–15 fps and
  minutes-long first boots to look fine in screenshots but feel slow — that's
  the VM, not the game. There is **no audio device**; verify audio via console
  logs (`[audio] init`, `[audio] play … nodes=…`) and `window.__gooby` +
  `audio.getStats()` instead of listening.
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
