# AGENTS.md — GOOBY

Working notes for AI/build agents (and humans) developing GOOBY. The binding
architecture contract is `PLAN.md` (§E especially) — this file is the quick map.

## Layout

```
GOOBY/
├── index.html            #scene canvas + #ui overlay root
├── src/
│   ├── main.js           boot: save → store → scenes/UI wiring (marked agent blocks)
│   ├── core/             store (events §E2), save (schema+migrations §E3), clock
│   │                     (pinnable), sceneManager (RAF+fade §E1), input (§E5),
│   │                     assets (GLB cache + getAudioUrl), timeEngine (1 s tick),
│   │                     notifications (guarded Capacitor adapter §E7)
│   ├── data/             constants.js = ALL design numbers (§C); strings.js EN+DE
│   │                     (t(key) — append BOTH); foods/outfits/furniture/
│   │                     achievements/minigames catalogs
│   ├── character/        procedural Gooby rig (gooby.js, goobyAnims.js CLIPS,
│   │                     emotions), outfitAttach.js (applyEquippedOutfits)
│   ├── home/             homeScene, roomManager (getAnchor/goTo/tap:… events),
│   │                     interactions.js (§C3 care), decor.js
│   ├── city/ + systems/shopTrip.js   drive minigame + shop-trip state machine
│   ├── minigames/        framework.js (§E8 ctx contract), registry, games/*.js
│   │                     (each with a PURE .logic.js sibling — that's what tests hit)
│   ├── systems/          stats/sleep/economy/leveling/achievements/dailyBonus/
│   │                     notifyRules — pure logic, no DOM/three imports
│   ├── audio/            audio.js (WebAudio manager §D6), sfxMap.js (id→ogg/synth),
│   │                     goobyVoice.js (synth rabbit noises)
│   ├── gfx/              tween.js, particles.js (pooled 3D + DOM confetti/coin-fly)
│   ├── ui/               ui.js (screens/panels/toasts §E6), hud, screens,
│   │                     onboarding.js (§C8.1 tutorial), styles.css
│   └── dev/harness.js    URL-param test surface (§E9)
├── public/assets/kenney/ CC0 GLBs + audio (interface-sounds, impact-sounds,
│                         music-jingles — resolve via assets.getAudioUrl)
├── test/                 node:test suites — pure logic only (no DOM/three)
└── scripts/              screenshot.mjs (npm run shot), gen-icons.mjs
```

## Conventions

- Vanilla ES modules + JSDoc types; no TypeScript, no frameworks. ESLint flat
  config (`npm run lint`) must stay clean.
- Every design number lives in `src/data/constants.js`; every user-facing string
  goes through `t(key)` with entries in BOTH `EN` and `DE` dictionaries.
- Tests are `node:test` (`npm test`) and import pure modules only — keep game
  logic in `.logic.js` siblings / `systems/` so it stays headless-importable.
  The whole suite must stay green; `test/onboarding.test.js` also fails on any
  `audio.play('<id>')` not mapped in `sfxMap.js`.
- Files are committed with CRLF line endings — match that in new/edited files
  (mixed endings make noisy diffs).
- Cross-agent integration points are marked comment blocks (`// G14: …`);
  respect file ownership per PLAN §G and keep foreign-file edits to additive
  one-liners.
- Audio: call `audio.play('<semantic-id>')` freely — add the id to
  `src/audio/sfxMap.js` (Kenney ogg keys or a synth recipe name). Haptics ride
  along via the def's `haptic: 'light'|'medium'` field. Music tracks: `'home'`
  and `'dance'` (100 BPM, seeded by `DANCE.PATTERN_SEED` — §D6 contract with
  danceParty's chart).

## Key §E contracts (summary — full text in PLAN.md)

- **§E1 scenes:** `{ scene, camera, enter(params), update(dt), exit(), dispose() }`
  registered on the sceneManager; assets preload by key before enter.
- **§E2 store:** `get/set/update/on`; specific events (`statsChanged`,
  `coinsChanged`, `sleepChanged`, …) + coalesced `change`; debounced autosave.
- **§E3 save:** versioned schema + migrations in `core/save.js` (localStorage,
  Capacitor-Preferences mirror on native). Never write localStorage directly.
- **§E5 input:** normalized tap/drag/swipe events from the canvas; UI overlays
  block canvas input while open.
- **§E6 UI:** screens/panels are `{ mount(el, params), unmount() }` modules
  registered by id; `ui.toast(key, vars)`.
- **§E7 notifications:** adapter no-ops without permission; reschedule hooks on
  save/background, cancelAll on open.
- **§E8 minigames:** games get `ctx = { scene, camera, renderer, input, audio,
  assets, rng (seeded), hud, params, onScore, onEnd }`; framework owns countdown,
  pause, results, payout (`economy.awardMinigame` incl. daily ×2).
- **§C6/§C1.5 economy:** ALL coin awards/spends go through `systems/economy.js`.

## Dev harness cheatsheet (§E9, dev builds only)

`?reset=1` wipe save · `?scene=home|gooby` · `?room=kitchen|living|bathroom|bedroom`
· `?minigame=<id>` (bypasses level locks) · `?open=shop|wardrobe|achievements|arcade|settings`
· `?coins=N ?level=N ?energy=N ?hunger=N ?hygiene=N ?fun=N` · `?fast=N` clock
multiplier · `?now=<epochMs>` pin clock · `?lang=de|en` · `?sleep=1` start nap
· `?autoplay=1` bot-plays the launched minigame · `?onboarding=0` suppress the
first-run tutorial (harness routes suppress it automatically).
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
