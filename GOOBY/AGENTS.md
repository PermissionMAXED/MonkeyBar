# AGENTS.md — GOOBY

Working notes for AI/build agents (and humans) developing GOOBY. The binding
architecture contract is `PLAN.md` (§E especially); `PLAN2.md` is the binding
2.0 spec (§A acceptance criteria, §B architecture deltas, §C feature numbers)
— this file is the quick map.

## Layout

```
GOOBY/
├── index.html            #scene canvas + #ui overlay root
├── src/
│   ├── main.js           boot: save → store → scenes/UI wiring (marked agent blocks)
│   ├── core/             store (events §E2 + 2.0 events §B3), save (schema v2 +
│   │                     migrations §E3/§B2), clock (pinnable), sceneManager
│   │                     (RAF+fade §E1, captureFrame for photo/profile), input
│   │                     (§E5), assets (GLB cache + getAudioUrl), timeEngine
│   │                     (1 s tick + 60 s ambience ticker), notifications
│   │                     (guarded Capacitor adapter §E7, ids 1–7)
│   ├── data/             constants.js = ALL design numbers (§C — READ-ONLY since
│   │                     2.0 wave 1); strings.js EN+DE (v1 keys) + strings/v2-*.js
│   │                     per-feature modules (§E0.1-1 — edit ONLY your module,
│   │                     never strings.js); foods(32)/outfits(20)/furniture(58)/
│   │                     achievements(33)/minigames(21)/crops/quests/collections/
│   │                     skins catalogs
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
│   │                     registry, games/*.js — 21 games, each with a PURE
│   │                     .logic.js sibling — that's what tests hit
│   ├── systems/          stats/sleep/economy/leveling/achievements/dailyBonus/
│   │                     notifyRules + 2.0 engines: garden/quests/collections/
│   │                     profileStats/health/weight/dayNight/weather — pure
│   │                     logic, no DOM/three imports (exact engine numbers live
│   │                     as frozen consts INSIDE each module, §E0.1-2)
│   ├── audio/            audio.js (WebAudio manager §D6 + loop recipes),
│   │                     sfxMap.js (id→ogg/synth), goobyVoice.js (synth noises)
│   ├── gfx/              tween.js, particles.js (pooled 3D + DOM confetti),
│   │                     sky.js (garden dome + window skies), weatherFx.js
│   │                     (instanced rain/clouds — 1 draw call)
│   ├── ui/               ui.js (screens/panels/toasts §E6), hud (quest badge,
│   │                     camera, profile, sick chip), screens (questBoard,
│   │                     album, profile, photoMode, vetPanel, gardenPanel),
│   │                     onboarding.js (§C8.1 tutorial + 2.0 teaser step),
│   │                     whatsNew.js (one-time 2.0 panel for migrated v1
│   │                     saves — §E0.1-6), styles.css
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
- **2.0 strings ruling (§E0.1-1):** `src/data/strings.js` is frozen — 2.0 keys
  live in per-feature `src/data/strings/v2-*.js` modules (ownership header in
  each file). Add keys ONLY to your module, always EN + DE.
- **2.0 constants ruling (§E0.1-2):** `src/data/constants.js` is READ-ONLY
  since wave 1. Engine-internal exact numbers (health/weight thresholds,
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

## Key §E contracts (summary — full text in PLAN.md; 2.0 deltas in PLAN2 §B3)

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
  2.0: `SAVE.VERSION = 2`; `migrations[1]` migrates v1 losslessly (§B2) and
  sets `onboarding.whatsNew2Seen = false` so ONLY migrated v1 veterans see the
  one-time What's-new panel (fresh saves default it to `true`).
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

## Dev harness cheatsheet (§E9, dev builds only)

`?reset=1` wipe save · `?scene=home|gooby` · `?room=kitchen|living|bathroom|bedroom|garden`
· `?minigame=<id>` (bypasses level locks) · `?open=shop|wardrobe|achievements|arcade|settings|questBoard|album|profile`
· `?coins=N ?level=N ?energy=N ?hunger=N ?hygiene=N ?fun=N` · `?fast=N` clock
multiplier · `?now=<epochMs>` pin clock (also pins the day/night band + weather
block — the ambience engines are pure functions of the clock) · `?lang=de|en`
· `?sleep=1` start nap · `?autoplay=1` bot-plays the launched minigame
· `?onboarding=0` suppress the first-run tutorial (harness routes suppress it
automatically). Feature demos: `?skin=<id>` own+equip a fur skin ·
`?outfits=<id,id>` own+equip outfits · `?dailydemo=N` daily popup as streak
day N · `?achdemo=1` seeded achievements screen · `?whatsnew=1` force the
What's-new panel · `?autopilot=1` bot-drives the shop trip ·
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
