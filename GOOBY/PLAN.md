# GOOBY — Master Build Plan (v1.0)

**GOOBY** is a complete, polished, release-quality Pou / Talking-Tom-style virtual-pet game starring a fat rabbit named **Gooby**. Mobile-first three.js web app, wrapped with Capacitor for iOS, unsigned `.ipa` built on GitHub Actions. Fully offline, single-player, no server.

This document is the **shared binding contract** for all build agents. Sections §B (file structure), §C (design numbers), §D1 (asset manifest), §E (architecture contracts) are binding — build agents must not deviate. Every number in §C is copied verbatim into `src/data/constants.js` by agent G1 and is the single source of truth at runtime.

**Repo facts (do not violate):**
- Repo root = `/workspace` (github.com/PermissionMAXED/MonkeyBar, public). `/workspace/MONKEYBAR` is a finished sibling game — **never touch it**. GOOBY lives entirely in `/workspace/GOOBY/`, except GitHub Actions workflows which go in `/workspace/.github/workflows/` (repo root; the directory does not exist yet — create it in Wave 5 only).
- Dev machine is Linux (Node 22, npm 10, Chrome headless available, no Xcode). iOS correctness is proven by the GitHub Actions macOS job going green and producing the `.ipa` artifact.
- GOOBY dev server port: **5174** (MONKEYBAR uses 5173).

---

## §0. Coordinator Runbook

### 0.1 Agent DAG (14 build agents, 5 waves)

```
WAVE 1 (parallel)          WAVE 2 (parallel)         WAVE 3 (parallel)          WAVE 4 (parallel)         WAVE 5 (parallel)
G1 Scaffold+Core+Framework G4 Rooms & Home scene     G7 City Drive + Shop trip  G10 Minigames C (4)       G13 iOS+CI packaging
G2 Kenney asset pipeline   G5 Care interactions+HUD  G8 Minigames A (4)         G11 Economy+Shop+Furnit.  G14 Audio+Polish+Onboarding+Docs
G3 Gooby character         G6 Time/Sleep/Notif/Save  G9 Minigames B (3)         G12 Wardrobe+Achv+Daily
        └──────────── every wave depends on all previous waves being merged & green ────────────┘
```

Within a wave, file ownership is **strictly disjoint** (each prompt lists owned files). Across waves, later agents may edit earlier files only where their prompt explicitly says so. All agents read this PLAN.md first.

### 0.2 What to launch when

1. Launch G1, G2, G3 in parallel. Each commits only its owned files.
2. Run **Checkpoint 1** (below). If red, relaunch the failing agent with the error log appended to its prompt.
3. Launch G4, G5, G6 → Checkpoint 2.
4. Launch G7, G8, G9 → Checkpoint 3.
5. Launch G10, G11, G12 → Checkpoint 4.
6. Launch G13, G14 → Checkpoint 5 (final), then push and confirm the GitHub Actions run is green with the `gooby-unsigned-ipa` artifact.
7. Launch the 20 eval agents (§H). Triage findings: P0/P1 fixes get a follow-up fix agent per affected module (reuse the wave prompt + bug list).

### 0.3 Integration checkpoints (coordinator runs from `/workspace/GOOBY`)

Every checkpoint = all of:
```bash
npm ci                 # first checkpoint only; npm install afterwards if lockfile changed
npm run lint           # must exit 0
npm test               # must exit 0, all suites pass
npm run build          # must exit 0, dist/ produced
npm run dev &          # then screenshot checks below; kill dev server after
```
Screenshot check (headless Chrome, no extra deps): `npm run shot -- "<URL>" shots/<name>.png` — inspect the PNG (non-blank, expected content).

| Checkpoint | Extra screenshot URLs to verify |
|---|---|
| CP1 (after W1) | `/?scene=gooby` (Gooby showcase w/ emotion buttons), `/?minigame=_smoke` (framework smoke game runs, HUD + results screen) |
| CP2 (after W2) | `/?scene=home&room=living`, `…kitchen`, `…bathroom`, `…bedroom`; `/?scene=home&room=bedroom&energy=10` (sleep flow reachable) |
| CP3 (after W3) | `/?minigame=cityDrive`, `carrotCatch`, `bunnyHop`, `carrotGuard`, `memoryMatch`, `runner`, `basketBounce`, `pancakeTower` |
| CP4 (after W4) | `/?minigame=danceParty`, `fishingPond`, `bubblePop`, `trampoline`; `/?scene=home&open=shop`, `…open=wardrobe`, `…open=achievements` |
| CP5 (final) | full boot `/` (onboarding starts), plus: push to GitHub, `gh run watch` the **GOOBY iOS** workflow → green, artifact `gooby-unsigned-ipa` present |

Commit policy: one commit per agent, message `GOOBY W<wave>/G<n>: <summary>`. Coordinator pushes after each green checkpoint.

---

## §A. Product Overview & Design Pillars

**Elevator pitch:** Gooby is a fat, lovable rabbit who lives in a cozy 3D apartment. You feed him, wash him, tickle him, put him to bed, decorate his rooms, dress him up — and when the fridge is empty you hop in the car and drive through a sunny low-poly city to the shop. Twelve arcade minigames earn the coins that fuel it all.

**Design pillars (every feature is judged against these):**
1. **Gooby is the soul.** Every screen keeps him alive: he reacts to touch, watches your finger, emotes constantly. Squash-and-stretch everywhere. If a feature doesn't make Gooby more alive, cut polish elsewhere first.
2. **Cozy, not needy.** Care loops are gentle: stats decay slowly, nothing dies, failure states are cute (dizzy stars, grumpy face), notifications are warm and capped.
3. **Real game feel.** Minigames are genuinely fun 60–120s arcade loops with difficulty ramps, juicy feedback (particles, SFX, screen shake ≤ subtle), and fair touch controls.
4. **The drive matters.** Shopping is an outing, not a menu. The city drive is short, forgiving, and rewarding — it makes buying a burger feel like an event.
5. **Ship quality.** 60 fps on mid phones, portrait one-hand play, safe-area correct, instant resume, versioned saves, zero dead-end screens. This is 1.0, not an alpha.

**Explicit scope rulings (final, no open questions):**
- **Mic voice-repeat (Talking-Tom gag): OUT of 1.0.** WKWebView `getUserMedia` works on iOS 14.3+ but adds a permission prompt, plist key, and audio-session risk we can't test locally. Instead Gooby has rich synthesized squeak/giggle voice reactions to touch. Voice-repeat is noted in README as a 1.1 candidate.
- **Sickness system: OUT.** Low stats produce visual states (stink flies, drool, grumpy face) and notifications, never a doctor mechanic.
- **Language: bilingual EN + DE** shipped in 1.0 via `src/data/strings.js` (`t(key)`); default from `navigator.language` (`de*` → German), switchable in Settings. All user-facing text goes through `t()` — no hardcoded strings.
- **UI: HTML/CSS DOM overlay** over the WebGL canvas (menus, HUD, shop, wardrobe). Custom pastel CSS + inline SVG icons; Kenney `ui-pack` is NOT used (keeps repo small, DOM UI is crisper).
- **Rooms: 4** (kitchen, living room, bathroom, bedroom) in one persistent home scene with camera pans.
- **Minigames: 12**, city drive included (§C6).
- **Monetization: none.** No ads, no IAP. Pure premium-feel free game.

---

## §B. Tech Stack & File Structure (binding)

### B.1 Stack (final decisions)

| Layer | Choice | Pin | Why |
|---|---|---|---|
| Build | Vite | `^6` | Matches sibling project; instant dev; static build for Capacitor `webDir`. |
| Language | Vanilla ES modules + JSDoc types | — | No TS compile step; matches MONKEYBAR conventions; JSDoc on all public APIs. |
| 3D | three.js | `^0.170.0` | Known-good pin from sibling project; `GLTFLoader` from `three/addons`. |
| UI | DOM overlay (HTML/CSS) | — | Higher quality menus/HUD than in-canvas; thumb-sized touch targets. |
| Native wrap | Capacitor | `^7` (core, cli, ios) | Current major; needs Xcode 16 → CI uses `macos-15`. |
| Capacitor plugins | `@capacitor/local-notifications`, `@capacitor/preferences`, `@capacitor/app`, `@capacitor/haptics` | `^7` | Notifications, save storage, background hook, haptics. Web fallbacks in adapters (§E7). |
| Tests | `node:test` built-in | — | Zero framework deps. Script uses glob form `node --test "test/*.test.js"` (dir form breaks on Node 22). |
| Lint | ESLint 9 flat config | `^9` | Copy MONKEYBAR's lenient config verbatim (adapted globals). |
| Audio | Kenney OGGs + WebAudio synth | — | §D6. |
| Package layout | **Single npm package in `GOOBY/`** | — | No workspaces — simplest for Capacitor + CI. |

Runtime deps: `three`, `@capacitor/core` + the 4 plugins. Dev deps: `vite`, `eslint`, `@eslint/js`, `@capacitor/cli`.

**npm scripts (in `GOOBY/package.json`):**
- `dev` → `vite --port 5174 --strictPort --host`
- `build` → `vite build` (→ `dist/`)
- `preview` → `vite preview --port 5174`
- `test` → `node --test "test/*.test.js"`
- `lint` → `eslint .`
- `fetch-assets` → `node scripts/fetch-kenney.mjs` (idempotent; only needed when the manifest changes — assets are committed)
- `icons` → `node scripts/gen-icons.mjs`
- `shot` → `node scripts/screenshot.mjs` (args: URL, out.png)

### B.2 File tree (binding; owner agent in brackets)

```
/workspace/.github/workflows/
└── gooby-ios.yml                  # CI: web checks + macOS ipa build (§F3) [G13]

/workspace/GOOBY/
├── PLAN.md                        # this document
├── README.md                      # install/run/play/build-ipa/sideload docs [G1 stub, G14 final]
├── AGENTS.md                      # agent guide for future work [G14]
├── package.json                   # single package; scripts above [G1; G13 adds cap deps]
├── package-lock.json              # committed [G1]
├── vite.config.js                 # port 5174, base './', build target es2020 [G1]
├── eslint.config.js               # flat config, lenient (copy MONKEYBAR style) [G1]
├── index.html                     # canvas + #ui root; viewport-fit=cover; loads src/main.js [G1]
├── capacitor.config.json          # appId com.permissionmaxed.gooby, webDir dist (§F1) [G13]
├── ios/                           # committed generated Capacitor iOS project (§F2) [G13]
├── .gitignore                     # node_modules, dist, shots/, ios/App/Pods [G1]
├── scripts/
│   ├── kenney-manifest.mjs        # PACKS whitelist manifest (§D1) — single asset truth [G2]
│   ├── fetch-kenney.mjs           # scrape+download+extract whitelisted files; budget guard [G2]
│   ├── screenshot.mjs             # spawns headless Chrome --screenshot for a URL [G1]
│   └── gen-icons.mjs              # procedural PNG app icon + splash (pure-node PNG encoder) [G13]
├── public/assets/kenney/          # committed CC0 assets: <pack>/<file>.glb|.ogg + License.txt [G2]
├── shots/                         # local screenshot output (gitignored) [—]
├── src/
│   ├── main.js                    # boot: store.load → offline sim → scenes+UI init → raf [G1]
│   ├── core/
│   │   ├── clock.js               # now() — ALL time reads go through this (fakeable via ?now=) [G1]
│   │   ├── store.js               # state store: get/set/update/on, autosave debounce (§E2) [G1]
│   │   ├── save.js                # persistence adapter localStorage/Preferences + migrations [G1; G6 extends migrations/tests]
│   │   ├── timeEngine.js          # 1s tick loop → stats decay, sleep progress, autosave [G1]
│   │   ├── sceneManager.js        # THREE renderer + scene lifecycle (register/switchTo) (§E1) [G1]
│   │   ├── input.js               # unified pointer: tap/drag/swipe + raycast pick (§E5) [G1]
│   │   ├── assets.js              # GLB/OGG loader + cache + clone: getModel('food-kit/carrot') [G2]
│   │   └── notifications.js       # scheduler adapter web/capacitor; rescheduleAll(state) (§E7) [G6]
│   ├── data/
│   │   ├── constants.js           # EVERY number from §C. Exported frozen objects. [G1]
│   │   ├── strings.js             # t(key,{vars}) EN+DE dictionaries [G1; all agents add keys]
│   │   ├── foods.js               # food catalog (§C5.1) [G1]
│   │   ├── minigames.js           # 12-game metadata registry: id,title,minLevel,coinTable [G1]
│   │   ├── furniture.js           # furniture/wallpaper/floor catalog (§C5.2) [G11]
│   │   ├── outfits.js             # outfit catalog (§C5.3) [G12]
│   │   └── achievements.js        # 16 achievements (§C8.3) [G12]
│   ├── systems/
│   │   ├── stats.js               # pure: decay tick, mood formula, clamps (§C1) [G1]
│   │   ├── inventory.js           # pure: food item add/remove/count [G1]
│   │   ├── sleep.js               # sleep state machine: start/tick/wake (§C1.4) [G6]
│   │   ├── offline.js             # pure: simulateOffline(state, nowMs) → {state,events} (§E4) [G6]
│   │   ├── notifyRules.js         # pure: computeSchedule(state, now) → [{id,at,title,body}] [G6]
│   │   ├── economy.js             # coins earn/spend, price checks, quick delivery [G11]
│   │   ├── leveling.js            # XP grants, level curve, unlock queries (§C1.5) [G1]
│   │   ├── shopTrip.js            # home→drive→shop→home state machine (§C4) [G7]
│   │   ├── furniturePlacement.js  # owned/placed furniture per room slots [G11]
│   │   ├── achievementsEngine.js  # counter tracking + unlock detection + rewards [G12]
│   │   └── dailyBonus.js          # streak logic, claim (§C8.2) [G12]
│   ├── character/
│   │   ├── gooby.js               # createGooby(): geometry recipe §D2, returns rig API [G3]
│   │   ├── goobyFace.js           # eyes/eyelids/mouth-state meshes + emotion faces [G3]
│   │   ├── goobyAnims.js          # programmatic clips: idle, bounce, eat, sleep... (§D2.4) [G3]
│   │   ├── emotions.js            # emotion state machine: mood+context → face/pose [G3]
│   │   ├── showcase.js            # ?scene=gooby dev showcase stage (emotion/clip buttons) [G3]
│   │   └── outfitAttach.js        # attach/remove procedural outfit meshes to anchors [G12]
│   ├── home/
│   │   ├── homeScene.js           # persistent scene: shell, lighting, Gooby placement [G4]
│   │   ├── roomManager.js         # 4 room defs, camera pans, getAnchor(name) (§C2) [G4]
│   │   ├── rooms/kitchen.js       # kitchen composition + fridge interaction hooks [G4]
│   │   ├── rooms/living.js        # living room composition + TV/arcade + ball toss zone [G4]
│   │   ├── rooms/bathroom.js      # bathtub/toilet/sink composition + wash zone [G4]
│   │   ├── rooms/bedroom.js       # bed, lamp switch, wardrobe closet, night mode [G4]
│   │   ├── interactions.js        # pet/tickle/poke/feed-drag/wash-scrub/ball logic (§C3) [G5]
│   │   └── decor.js               # applies placed furniture/wallpaper/floor to rooms [G11]
│   ├── minigames/
│   │   ├── framework.js           # launch(id): scene swap, countdown, pause, results, rewards (§E8) [G1]
│   │   ├── registry.js            # import.meta.glob('./games/*.js') discovery [G1]
│   │   └── games/
│   │       ├── _smoke.js          # dev-only trivial game proving the framework [G1]
│   │       ├── cityDrive.js       # THE shop drive (§C6 #1) [G7]
│   │       ├── carrotCatch.js  bunnyHop.js  carrotGuard.js  memoryMatch.js   # [G8]
│   │       ├── runner.js  basketBounce.js  pancakeTower.js                    # [G9]
│   │       └── danceParty.js  fishingPond.js  bubblePop.js  trampoline.js    # [G10]
│   ├── city/
│   │   ├── cityBuilder.js         # seeded 9×9 tile city from roads/buildings/nature GLBs [G7]
│   │   ├── traffic.js             # AI cars on lane paths, forgiving collision [G7]
│   │   └── carController.js       # player car physics-lite + touch steering [G7]
│   ├── ui/
│   │   ├── ui.js                  # overlay root, showScreen/openPanel/toast (§E6) [G1]
│   │   ├── styles.css             # pastel brand system (§D5) [G1; later agents append]
│   │   ├── icons.js               # inline SVG icon set [G1]
│   │   ├── hud.js                 # home HUD: 4 stat bars, coins, XP, buttons [G5]
│   │   ├── roomNav.js             # swipe/arrows/dots room navigation [G4]
│   │   ├── arcadeScreen.js        # minigame picker grid w/ locks + best scores [G5]
│   │   ├── shopScreen.js          # shop tabs: food/furniture/wallpaper (§C5) [G11]
│   │   ├── wardrobeScreen.js      # outfit try-on + equip [G12]
│   │   ├── achievementsScreen.js  # achievement list + claim states [G12]
│   │   ├── dailyBonusPopup.js     # streak calendar popup [G12]
│   │   ├── settingsScreen.js      # lang/notif toggles [G6; G14 adds audio/haptics]
│   │   ├── permissionPrompt.js    # soft-ask → OS notification permission flow [G6]
│   │   └── onboarding.js          # first-run scripted tutorial (§C8.1) [G14]
│   ├── gfx/
│   │   ├── lights.js              # hemisphere+directional rigs, day/night lerp (§D4) [G4]
│   │   ├── materials.js           # shared cheap materials + palette constants [G3]
│   │   ├── particles.js           # hearts, Zzz, sparkles, bubbles, stink flies, confetti [G3; G14 extends]
│   │   ├── tween.js               # tiny tween/spring util (no deps) [G1]
│   │   └── blobShadow.js          # radial-gradient contact shadow plane [G3]
│   ├── audio/
│   │   ├── audio.js               # WebAudio manager: init-on-gesture, play(id), music (§D6) [G14; G1 creates stub with final API]
│   │   ├── sfxMap.js              # sfx id → ogg path or synth recipe [G14]
│   │   └── goobyVoice.js          # synthesized squeaks/giggles/snores [G14]
│   └── dev/
│       └── harness.js             # URL params: ?scene ?minigame ?coins ?level ?fast ?now ?reset (§E9) [G1]
└── test/                          # node:test suites — see per-agent duties
    ├── stats.test.js  leveling.test.js  inventory.test.js  minigameMeta.test.js   [G1]
    ├── assets.test.js                                                              [G2]
    ├── goobyApi.test.js                                                            [G3]
    ├── rooms.test.js                                                               [G4]
    ├── interactions.test.js                                                        [G5]
    ├── sleep.test.js  offline.test.js  notifyRules.test.js  save.test.js           [G6]
    ├── cityLayout.test.js  shopTrip.test.js                                        [G7]
    ├── minigamesA.test.js                                                          [G8]
    ├── minigamesB.test.js                                                          [G9]
    ├── minigamesC.test.js                                                          [G10]
    ├── economy.test.js  furniture.test.js                                          [G11]
    ├── achievements.test.js  dailyBonus.test.js  outfits.test.js                   [G12]
    ├── icons.test.js (PNG encoder sanity)                                          [G13]
    └── onboarding.test.js                                                          [G14]
```

Rule: pure-logic modules (`systems/`, `data/`, `core/clock|store|save`) must import **no** three.js/DOM so `node --test` runs them headlessly.

---

## §C. Game Design Spec (all numbers binding → `src/data/constants.js`)

### C1. Pet stats, mood, XP, sleep

Four stats, each 0–100 (float internally, displayed as int bars): `hunger` (100 = full), `energy`, `hygiene`, `fun`.

**Decay per real minute (awake, app open or closed):**

| stat | awake rate | asleep rate | notes |
|---|---|---|---|
| hunger | −0.35 | −0.175 | empty→full ≈ 4.8 h awake |
| energy | −0.25 | +3.334 (fill) | full→empty ≈ 6.7 h; fill 0→100 in 30 min |
| hygiene | −0.15 | 0 | ≈ 11 h |
| fun | −0.50 | 0 | ≈ 3.3 h — main minigame driver |

**Offline simulation:** on app load, elapsed awake time decays at **0.3×** the awake rates, capped at **480 simulated minutes** (8 h) of awake decay. Sleep progresses at full real-time rate offline (uncapped — a 30-min nap finishes while the app is closed). Algorithm in §E4.

**Mood formula:** `mood = 0.35 * min(stats) + 0.65 * avg(stats)`, 0–100.
Bands: ≥80 `ecstatic`, 60–79 `happy`, 40–59 `neutral`, 25–39 `grumpy`, <25 `miserable`. Mood band drives Gooby's default emotion (§D2.5). `LOW_STAT = 25`, `CRITICAL_STAT = 10` (HUD bar turns orange/red, notification triggers §C7).

**Visual low-stat states (no sickness system):** hygiene <15 → stink-fly particles orbit Gooby; hunger <10 → drool drop + belly-rumble wobble every ~20 s; energy ≤15 → **exhausted**: constant yawns, eyes half-closed, minigames refuse to start ("Gooby ist zu müde! / Gooby is too sleepy!"), mood capped at 39.

**C1.4 Sleep system (owner requirement: ~30 real minutes):**
- Player-initiated: tap the bedroom lamp switch when `energy < 70` → lights dim to night mode, Gooby hops into bed, Zzz particles, snore audio.
- `sleepDurationMin = ceil(30 * (100 - energy) / 100)`, minimum 10 → from near-empty energy ≈ 30 real minutes. `wakeAt = now + duration`. Energy fills linearly (+3.334/min); auto-wake at `energy ≥ 100` or `wakeAt`.
- **Wake notification** scheduled at `wakeAt`: „Gooby ist aufgewacht! 🥕" / "Gooby just woke up! 🥕" (fires even during quiet hours — user-initiated).
- Early manual wake (tap lamp again): allowed after 5 min; Gooby keeps whatever energy accrued and gets a **grumpy debuff**: mood −15 for 10 minutes (timestamped modifier in save).
- While sleeping: room locked to bedroom night view; HUD shows countdown; other rooms/minigames blocked ("Pssst… Gooby schläft / Gooby is sleeping").

**C1.5 XP & levels (max level 30):**
- XP to advance from level L→L+1: `100 + 50*(L-1)` (L1→2 = 100, L9→10 = 500; cumulative to L10 = 2700).
- XP grants: feed 5, full wash 8, completed sleep 10, pet/tickle 1 (max 20/day from petting), minigame finish `10 + min(15, floor(coinsEarned/2))`.
- Level-up reward: `25 * newLevel` coins + confetti + jingle. Unlocks: minigame schedule §C6.3; Quick Delivery purchasable at L8 (§C4.4); 6×4 memory layout at L6.

### C2. Rooms & home scene

One persistent 3D home scene; camera pans horizontally between 4 room "stages" (each ~4×3×3.2 m shell: procedural walls/floor so wallpaper/floor materials can swap). Order left→right: **kitchen · living room (default) · bathroom · bedroom**. Navigation: horizontal swipe on empty space, edge arrow buttons, and 4-dot indicator (`ui/roomNav.js`). Camera: portrait FOV 45°, positioned to frame the room with Gooby center-low; 0.35 s eased pan between rooms; Gooby hops along to the active room (teleport + hop-in animation behind a 150 ms fade of the room gap).

Per-room furniture **slots** (§C5.2 catalog fills them; `roomManager.getAnchor(name)` exposes positions):

| room | fixed interactables | decor slots (buyable variants) |
|---|---|---|
| kitchen | fridge (opens food tray), counter | table set (2), fridge model (2), small appliance (3), wall shelf (2) |
| living | TV (opens arcade), ball toy, front door (starts shop trip §C4) | sofa (3), rug (3), plant (3), lamp (2), bookcase (2), wall art (3, procedural canvases) |
| bathroom | bathtub (wash §C3), toilet (gag: tap when hygiene<50 → flush sound, +5 hygiene, 10-min cooldown), sink/mirror | tub model (2), rug (2), plant (2), shelf (2) |
| bedroom | bed (sleep target), lamp switch (sleep toggle), wardrobe closet (opens wardrobe UI), window (sky = day/night by device clock) | bed model (2), nightstand lamp (2), rug (2), plushie (2 — incl. Kenney `bear.glb`) |

Wallpaper (per room) and floor (per room) are material swaps on the procedural shell (§C5.2).

### C3. Care interactions (in `home/interactions.js`)

| interaction | gesture | effect (constants) | feedback |
|---|---|---|---|
| pet | slow drag over body (velocity < 600 px/s, ≥400 ms) | +1 fun per stroke, petting XP cap rules §C1.5, max +10 fun/day from pet+tickle combined | purr squeak, hearts particles, eyes closed happy |
| tickle | fast rubs on belly (≥3 direction changes <900 ms) | +2 fun (same daily cap) | giggle voice, `tickle` anim, cheek blush pulse |
| poke | tap on body | none (toy) | `pokeWobble(dir)` spring + squeak; 5 pokes <3 s → `dizzy` 2 s with spiral eyes |
| feed | open fridge → tray of owned food → drag item to mouth | apply food's stat deltas (§C5.1); consume from inventory; refuse (head shake) if `hunger ≥ 95` | mouth opens as item approaches, chew ×6, float text "+40", crumbs particles |
| wash | in bathtub: drag soap over Gooby → suds accumulate (coverage 0–100%) → tap shower head to rinse | `hygiene += 60 * coverage`; full wash also +3 fun; XP per §C1.5 | bubbles grow, rinse splash, sparkle finish, wet-ears look (ears droop 20 s) |
| ball toss | living room: flick ball (simple ballistic + floor bounce) | +3 fun per fetch, 15 s cooldown | Gooby chases, headbutts ball back, happy bounce |
| talk-back | — | OUT of 1.0 (§A ruling) | poke/pet voice squeaks cover the gag |

All care actions run achievement counters (§C8.3) via `achievementsEngine.track(counterId)`.

### C4. The Shop Trip (mandatory-but-fun driving loop)

State machine `systems/shopTrip.js`: `home → driveOut → shop → home` (return teleports — ruling: no return drive, keeps the loop snappy).

1. Tap **front door** in living room (or "Shop" HUD button) → confirm sheet ("Zum Laden fahren? / Drive to the shop?") → launches minigame `cityDrive` via the standard framework with `params.mode='shopTrip'`.
2. **Drive (§C6 #1):** third-person car through the seeded city to the shop building. Typical duration 75–110 s.
3. Arrival (enter parking trigger, radius 4 m) → fanfare → **shop UI opens** (§C5). Drive rewards paid immediately: coin pickups (1c each, 20 placed per route), arrival bonus +10c, zero-crash bonus +5c.
4. Buy things → "Nach Hause / Go home" → fade → living room. Purchases land in inventory/owned lists.
5. Crashes: bump = screen shake + „Autsch!" + speed drops to 30%; 3 crashes = tow-truck cutscene (car placed at shop, **no arrival/no-crash bonus** — you always reach the shop; never a hard fail).
6. **Quick Delivery** (convenience, `cityDrive` stays the default): one-time purchase 400c, unlockable at level 8. Adds "Bestellen / Order" button on the fridge — buy **food only** from home at **+20% price markup** (rounded up). Furniture/wallpaper/outfits always require the drive.
7. Free play: `cityDrive` is also playable from the arcade (`mode='arcade'`, same map, 90 s coin-run scoring, no shop at the end).

### C5. Shop catalog (binding prices)

#### C5.1 Food (in `data/foods.js`; Kenney `food-kit` GLB per item)

| id (glb) | price | hunger | fun | other |
|---|---|---|---|---|
| carrot | 5 | +10 | +2 | Gooby's favorite — extra happy squeak |
| apple | 6 | +10 | +1 | |
| banana | 6 | +11 | 0 | |
| bread | 10 | +18 | 0 | |
| cheese | 12 | +16 | +2 | |
| watermelon | 12 | +14 | +4 | |
| donut-sprinkles | 12 | +10 | +10 | |
| cupcake | 14 | +8 | +12 | |
| salad | 14 | +20 | 0 | +2 hygiene (healthy!) |
| ice-cream | 16 | +6 | +15 | +5 energy |
| sandwich | 16 | +24 | +3 | |
| hot-dog | 18 | +25 | +4 | |
| pancakes | 20 | +28 | +6 | |
| burger | 25 | +40 | +6 | |
| pizza | 30 | +45 | +8 | −2 hygiene (greasy) |
| cake | 40 | +30 | +20 | |

Starter inventory: 3× carrot, 1× apple, 1× cupcake. Starting coins: **100**.

#### C5.2 Furniture / wallpaper / floors (in `data/furniture.js`; Kenney `furniture-kit` GLBs, camelCase names)

Slot variants (price ranges; every slot has a free default): sofas `loungeSofa` (default) / `loungeDesignSofa` 250 / `loungeSofaCorner` 400; TV `televisionVintage` (default) / `televisionModern` 300; rugs `rugRounded` free / `rugRectangle` 90 / `rugRound` 120; plants `pottedPlant` free / `plantSmall1` 80 / `plantSmall3` 110; lamps `lampRoundFloor` free / `lampSquareFloor` 140; bookcases `bookcaseOpen` free / `bookcaseClosedWide` 220; kitchen table set `table`+`chair`×2 free / `tableCloth`+`chairCushion`×2 260; fridge `kitchenFridge` free / `kitchenFridgeLarge` 350; appliances `toaster` 90 / `kitchenCoffeeMachine` 150 / `kitchenBlender` 120; wall shelf `kitchenCabinetUpper` free / `kitchenCabinetUpperDouble` 130; tub `bathtub` free / `showerRound` 320; bathroom rug `rugDoormat` free / `rugSquare` 90; bathroom plant `plantSmall2` 80; bathroom shelf `bathroomCabinet` free / `bathroomCabinetDrawer` 150; bed `bedSingle` free / `bedDouble` 380; nightstand `lampSquareTable` free / `lampRoundTable` 120; bedroom rug 90/120 (shared rug items); plushie `bear` 160 / procedural mini-Gooby doll 600. Wall art: 3 procedural framed canvases (sunset/carrot/abstract) 120 each.
Wallpapers: 6 per-room-applicable colorways (cream default free, mint 120, sky 120, peach 120, lavender 120, stars 200 — procedural canvas textures). Floors: 4 (wood default free, tile 100, carpet 100, checker 150).

#### C5.3 Outfits (in `data/outfits.js`; all procedurally modeled, attach via `character/outfitAttach.js`)

Hats: party hat 120, beanie 100, cap 150, top hat 300, **crown 1200** (endgame flex). Glasses: round 150, sunglasses 200, star glasses 250. Neck: red scarf 120, bowtie 140, striped scarf 180. One item per slot (hat/glasses/neck), freely swappable once owned. Purchase path: the shop UI's 4th tab "Outfits" opens the wardrobe in buy mode (only during shop trips, per §C4); equipping owned items works anytime from the bedroom wardrobe.

### C6. Minigames (12 total — binding list)

**Shared rules:** each play costs **8 energy** (drive: 6) and grants **+15 fun** on finish. Coins = `clamp(floor(score / divisor), min, max)` per the table; **first play of each game per local day: ×2 coins** (after clamp). Refuse start when exhausted (§C1). Every game: 3-2-1 countdown, pause button, results screen with score/best/coins (framework-owned §E8).

**Coin table (`data/minigames.js`):**

| id | divisor | min | max | typical/avg round |
|---|---|---|---|---|
| cityDrive | special: pickups + bonuses (§C4) | — | ~35 | 20–35c / 90 s |
| carrotCatch | 3 | 4 | 25 | ~15c / 60 s |
| bunnyHop | 2 | 3 | 25 | ~12c |
| carrotGuard | 3 | 4 | 25 | ~15c / 45 s |
| memoryMatch | 2 | 5 | 24 | ~14c |
| runner | 15 | 4 | 30 | ~16c |
| basketBounce | 3 | 4 | 26 | ~14c / 60 s |
| pancakeTower | 2 | 4 | 26 | ~13c |
| danceParty | 6 | 4 | 28 | ~16c / 75 s |
| fishingPond | 3 | 4 | 26 | ~15c / 90 s |
| bubblePop | 4 | 4 | 24 | ~13c / 60 s |
| trampoline | 5 | 4 | 26 | ~14c / 60 s |

Economy sanity: ~10–15 coins/min of play; daily food need ≈ 120–180c ≈ 12–15 min of minigames. Verified by `test/economy.test.js` simulation (§H E11).

**C6.1 The 12 designs** (mechanics ¶, touch controls, ramp, assets, complexity S/M/L):

1. **City Drive** („Einkaufsfahrt" / Shopping Cruise) — Third-person drive across the seeded 9×9 low-poly city to the shop. Auto-throttle (base 9 m/s, ramps to 13), left/right thumb steering zones, brake button bottom-center. Follow floating 3D arrows + glowing route line to the shop; 20 coin pickups on route; 6–10 traffic cars loop fixed lane paths (forgiving 70% hitboxes); cone/barrier obstacles. Crash rules §C4.5. Arcade mode: 90 s open coin-run. Assets: car-kit `sedan` (player) + `taxi/van/police/delivery/suv` (traffic) + `cone`/`box`; city-kit-roads tiles; city-kit-commercial buildings; nature-kit trees. **L**
2. **Carrot Catch** — Gooby holds a basket at screen bottom; food GLBs rain down with gentle spin. Drag horizontally to move. Good food +1–3 pts (rarity), junk (crushed soda can, fish bones) −2 and 0.5 s dizzy. 60 s; fall speed +8%/10 s; junk ratio ramps 10%→30%. Assets: food-kit incl. `soda-can-crushed`, `fish-bones`. **S**
3. **Bunny Hop** — Side-view flappy: tap = hop; glide through gaps between fence-post pillars (top/bottom) over a scrolling meadow. Score = gates passed; speed +2%/gate; hitbox 70% forgiving; gap narrows every 10 gates. Assets: nature-kit `fence_simple`, `flower_*`, `tree_default/oak`, `plant_bush*`. **S**
4. **Carrot Guard** (whack-a-mole) — 3×3 dirt mounds in a garden; gray moles (procedural capsule + eyes) pop up for 0.9 s (ramps to 0.5 s) trying to steal carrots; tap to bonk (cartoon mallet swats down). Hit +1, missed mole steals one of 10 carrots; combo ≥5 → +3 bonus. 45 s or all carrots gone. Assets: nature-kit `crops_dirtSingle`, `crop_carrot`, `fence_*`. **S**
5. **Memory Match** — 4×4 card grid (8 pairs; 6×4 at L6+): card backs procedural, faces are mini food meshes parented to cards, revealed by flip animation. Score = `20 − misses + timeBonus(0–8)`. No fail state. Assets: food-kit minis. **S**
6. **Gooby Runner** — 3-lane endless run through a city sidewalk corridor; swipe left/right = lane, up = jump, down = slide; obstacles: cones, boxes, barriers, parked cars; floating coins. Speed +5%/10 s. First hit = stumble (lose combo), second = end. Score = meters. Assets: city kits + car-kit obstacles, nature trees. **M**
7. **Basket Bounce** — Flick-to-throw an orange ball into a hoop (torus + backboard); ballistic arc + rim bounce. Hoop slides horizontally after 5 baskets; distance ramps. Basket +3, bank shot +2 extra, swish streak +2. 60 s. Assets: procedural; impact-sounds. **M**
8. **Pancake Tower** — A pancake slides left-right above the stack; tap to drop; overhang is sliced off (width shrinks); every 5th layer is a bonus topping (butter/strawberry, +4 pts, no shrink). Perfect drop (≤6 px) +2 & width restores +10%. Ends when width < 20% or 40 layers. Score = `layers*2 + bonuses`. Assets: procedural cylinders + food-kit `pancakes`, `strawberry`, `whipped-cream` deco. **S**
9. **Dance Party** — 3-lane note-tap rhythm at 100 BPM: seeded 75 s pattern from the procedural WebAudio track (§D6); hit windows perfect ≤70 ms (+4) / good ≤140 ms (+2) / miss (combo reset). Gooby dances on a disco stage, quality of dancing follows combo. Score = sum − 2×misses. Assets: procedural stage + music synth. **M**
10. **Fishing Pond** — Cozy pond at dusk: hold to lower the hook, fish silhouettes (food-kit `fish`, sized S/M/L worth 2/3/5) swim laterally at depths; release to hook; a boot (−3) drifts occasionally; reel-in wiggle (rapid taps) for L fish. 90 s. Assets: food-kit `fish`, nature-kit rocks/trees/bridge_wood. **M**
11. **Bubble Pop** — Bubbles float up carrying mini food items; a target banner shows "Pop: 🍩" (rotates every 12 s); pop matching bubbles (+2), wrong pop −2 + 0.5 s stun, spiky bubbles never pop-able (drag them = −1). 60 s; bubble speed & density ramp. Assets: food minis in transparent spheres. **S**
12. **Trampoline Tricks** — Side view; Gooby bounces on a trampoline. Tap inside the landing window (shrinks with height) to boost; swipe left/right/up mid-air = flip/spin tricks (+pts × height multiplier ×1–3); missed window = cute butt-landing, height resets. 60 s; score = trick points. Uses the Gooby rig's `dance/dizzy/jump` clips + new spin poses. **M**

**C6.3 Unlock schedule (level → new game):** L1: carrotCatch, bunnyHop, cityDrive · L2: carrotGuard · L3: memoryMatch · L4: basketBounce · L5: pancakeTower · L6: runner · L7: bubblePop · L8: fishingPond · L9: danceParty · L10: trampoline. Locked tiles show level requirement.

### C7. Local notifications (exact triggers & copy)

Adapter `core/notifications.js` (Capacitor `LocalNotifications` native / web `Notification` API best-effort in dev). Pure rules in `systems/notifyRules.js`: `computeSchedule(state, now)` returns `[{id, at, titleKey, bodyKey}]` — fully unit-tested.

**Rescheduling:** on every app background (`App.addListener('appStateChange')` native; `visibilitychange`→hidden on web) and on save: `cancelAll()` then schedule from predicted stat curves (linear decay projection using §C1 rates). On app open: cancel all.

| id | trigger (predicted time) | DE copy | EN copy |
|---|---|---|---|
| 1 | `wakeAt` (if sleeping) | „Gooby ist aufgewacht! 🥕" | "Gooby just woke up! 🥕" |
| 2 | hunger reaches 20 (≥30 min in future) | „Gooby hat Hunger! 🍔" | "Gooby is hungry! 🍔" |
| 3 | fun reaches 15 (≥30 min) | „Gooby langweilt sich… 🎮" | "Gooby is getting bored… 🎮" |
| 4 | hygiene reaches 15 (≥30 min) | „Gooby braucht ein Bad! 🛁" | "Gooby needs a bath! 🛁" |
| 5 | 24 h after last daily-bonus claim | „Dein Tagesbonus wartet! 🎁" | "Your daily bonus is waiting! 🎁" |

Rules: max **5 scheduled** (one per id); **quiet hours 22:00–08:00** device-local — triggers falling inside shift to 08:05, **except id 1** (wake) which fires on time; min 30 min between any two scheduled times (later one shifts +30 min).
**Permission flow:** never at boot. Soft-ask panel (`ui/permissionPrompt.js`) the first time Gooby falls asleep OR the first time any stat drops below 30: friendly explainer → "Yes" triggers the OS prompt; "Later" re-asks after 24 h; final denial respected (Settings toggle deep-links to re-prompt).

### C8. Onboarding, daily bonus, achievements

**C8.1 Onboarding (first run, ~90 s, skippable after step 3):** 1) Gooby hops in, waves, name card „Das ist Gooby!" 2) forced pet → hearts 3) forced feed (carrot from tray) 4) room-swipe hint to bathroom, quick wash 5) HUD tour tooltip (4 bars) 6) arcade: play `carrotCatch` (30 s tutorial variant, guaranteed ≥10 coins) 7) shop-door hint: „Wenn der Kühlschrank leer ist, fahren wir einkaufen!" 8) done → daily bonus popup. State machine in `ui/onboarding.js`, progress in save (`onboarding.step`), resumable.

**C8.2 Daily bonus:** first open per local day → popup: streak day 1–7 rewards `[20, 30, 40, 50, 60, 80, 100]` coins, day ≥7 stays 100 + 1 random food item. Missing a day resets streak to 1. Claim required (tap), fires notification id 5 24 h later.

**C8.3 Achievements (16, in `data/achievements.js`; coin reward on unlock, toast + jingle):**

| id | name EN / DE | condition (counter) | coins |
|---|---|---|---|
| firstFeed | First Nibble / Erster Happen | feeds ≥1 | 10 |
| feed100 | Chonky Boy / Moppelhase | feeds ≥100 | 100 |
| firstWash | Squeaky Clean / Blitzeblank | washes ≥1 | 10 |
| wash50 | Bubble Master / Schaummeister | washes ≥50 | 80 |
| firstSleep | Good Night / Gute Nacht | completed sleeps ≥1 | 15 |
| sleep20 | Dream Big / Träum groß | completed sleeps ≥20 | 100 |
| firstDrive | Road Trip! / Ausfahrt! | shop trips ≥1 | 20 |
| drive25 | City Cruiser / Stadtflitzer | shop trips ≥25 | 120 |
| noCrash | Clean Driver / Unfallfrei | 1 trip with 0 crashes | 40 |
| play12 | Game Hopper / Spielehüpfer | each of 12 games played ≥1 | 150 |
| coins1000 | Piggy Bank / Sparschwein | balance ≥1000 at once | 50 |
| level10 | Double Digits / Zweistellig | level ≥10 | 100 |
| fullOutfit | Dress-Up / Herausgeputzt | hat+glasses+neck equipped | 60 |
| decorator | Interior Designer / Einrichter | ≥10 non-default items placed | 80 |
| streak7 | Week Buddy / Wochenkumpel | daily streak ≥7 | 150 |
| tickle100 | Giggle Factory / Kicherfabrik | tickles ≥100 | 60 |

---

## §D. Art & Audio Plan

### D1. Kenney asset manifest (verified 2026-07; binding for `scripts/kenney-manifest.mjs`)

**Discovery:** fetch `https://kenney.nl/assets/<slug>`, extract first match of regex
`/media/pages/assets/<slug>/[a-z0-9]+-\d+/kenney_[A-Za-z0-9._-]+\.zip` (note: some zips carry version suffixes, e.g. `kenney_city-kit-commercial_2.1.zip`, `kenney_city-kit-suburban_20.zip` — the regex must allow them). Download, unzip to temp, copy ONLY whitelisted files to `GOOBY/public/assets/kenney/<slug>/` (GLBs flat, audio under `audio/`), always copy the pack's `License.txt`. **Verified gotcha:** older packs (`furniture-kit`, `nature-kit`) keep GLBs under `Models/GLTF format/` with camelCase/snake_case names; newer packs (`food-kit`, `car-kit`, `city-kit-roads`, `city-kit-commercial`) use `Models/GLB format/` with kebab-case. The manifest stores the model dir per pack. Budget guard: script fails if total copied size > 80 MB (expected ≈ 15–25 MB). All CC0.

| pack slug | model dir | whitelist (exact, verified) |
|---|---|---|
| `furniture-kit` | `Models/GLTF format` | living: `loungeSofa loungeSofaCorner loungeDesignSofa loungeChair tableCoffee tableCoffeeGlass televisionModern televisionVintage cabinetTelevision bookcaseOpen bookcaseOpenLow bookcaseClosedWide rugRounded rugRectangle rugRound rugSquare rugDoormat pottedPlant plantSmall1 plantSmall2 plantSmall3 lampRoundFloor lampSquareFloor lampRoundTable lampSquareTable lampWall radio speaker` · kitchen: `kitchenFridge kitchenFridgeLarge kitchenSink kitchenStove kitchenCabinet kitchenCabinetDrawer kitchenCabinetUpper kitchenCabinetUpperDouble kitchenBar kitchenCoffeeMachine kitchenBlender kitchenMicrowave toaster table tableCloth chair chairCushion stoolBar` · bath: `bathtub shower showerRound toilet bathroomSink bathroomMirror bathroomCabinet bathroomCabinetDrawer washer` · bed: `bedSingle bedDouble cabinetBed cabinetBedDrawer coatRackStanding bear pillow pillowBlue books sideTable sideTableDrawers trashcan ceilingFan` (all `.glb`) |
| `food-kit` | `Models/GLB format` | `carrot apple banana bread cheese watermelon donut donut-sprinkles cupcake salad ice-cream sandwich hot-dog pancakes burger pizza cake cookie croissant muffin pear strawberry corn broccoli egg-cooked waffle taco pie popsicle soda fish fish-bones soda-can-crushed bowl-cereal plate-dinner cutting-board frying-pan pot-stew mug whipped-cream` (all `.glb`) |
| `city-kit-roads` | `Models/GLB format` | `road-straight road-straight-half road-bend road-curve road-intersection road-crossroad road-crossing road-end road-end-round road-square road-roundabout light-square-double light-curved construction-cone construction-barrier tile-low tile-high sign-highway` (all `.glb`) |
| `city-kit-commercial` | `Models/GLB format` | `building-a building-b building-c building-d building-e building-f building-g building-h building-skyscraper-a building-skyscraper-b detail-awning detail-awning-wide low-detail-building-a low-detail-building-b low-detail-building-c low-detail-building-d low-detail-building-e low-detail-building-f` (all `.glb`) |
| `car-kit` | `Models/GLB format` | `sedan sedan-sports hatchback-sports suv taxi van delivery truck police race cone box wheel-default wheel-dark` (all `.glb`). Note: bodies may reference separate wheels — car loader must check for nodes named `wheel*`; if absent, attach `wheel-default` clones at the model's wheel empties. |
| `nature-kit` | `Models/GLTF format` | `tree_default tree_oak tree_fat tree_detailed tree_pineRoundA tree_pineTallA plant_bush plant_bushLarge flower_purpleA flower_redA flower_yellowA grass_large rock_smallA rock_largeA fence_simple fence_gate crop_carrot crops_dirtSingle stump_round mushroom_red log bridge_wood` (all `.glb`) |
| `interface-sounds` | `Audio` | glob `*.ogg`, max 120 files (~1 MB; verified names like `click_001.ogg`, `back_001.ogg`, `close_001.ogg`, `bong_001.ogg`) |
| `impact-sounds` | `Audio` | glob `*.ogg`, max 100 files |
| `music-jingles` | `Audio/8-Bit jingles` | glob `jingles_NES*.ogg`, max 20 (verified `jingles_NES00.ogg`…) |

Packs ruled OUT: `ui-pack` (custom CSS UI), `toy-car-kit`, `holiday-kit`, `city-kit-suburban` (unverified file names; commercial+nature suffice). Manifest entries: `{ slug, modelDir, files:[...] }` or `{ slug, dir, glob, max }`.

### D2. Procedural Gooby (the soul — binding spec)

Gooby is built 100% in code (`character/gooby.js`): grouped primitives, no bones, programmatic animation on group pivots. Look: **high-quality chubby vinyl toy**. Total height ≈ 1.05 units (ears up); scene scale 1 unit ≈ 1 m.

**D2.1 Palette (in `gfx/materials.js`):** BODY `#F6EAD7` cream · BELLY `#FFF9EC` · EAR_INNER `#F6A8B8` · NOSE `#E88BA0` · CHEEK `#F9C6CF` (opacity 0.85) · EYE `#3A2E2E` · EYE_SHINE `#FFFFFF` · PAW_PAD `#F3B7C3`. Body material: `MeshStandardMaterial{ roughness:0.65, metalness:0 }`.

**D2.2 Geometry recipe (pivot hierarchy `root → body → head → face`; all pivots are `THREE.Group`s):**
- **Body** (the star: FAT): `LatheGeometry` (24 segs) pear profile points `(0,0) (0.30,0.02) (0.43,0.20) (0.46,0.40) (0.40,0.58) (0.30,0.70) (0.18,0.76) (0,0.78)` → squat 0.78-tall pear, widest at hips. Belly patch: sphere r 0.30 scaled `(1,1.05,0.42)` at `(0, 0.32, +0.27)`.
- **Head:** sphere r 0.30 scaled `(1.05, 0.92, 0.95)` centered `(0, 0.86, 0.02)` overlapping the body (no visible neck). `headGrp` pivot at `(0, 0.70, 0)`.
- **Ears:** 2 pivots on head top at `(±0.13, 1.06, 0)`, tilt ±10°. Each: capsule r 0.085, length 0.34 (outer, BODY) + flattened capsule r 0.055 × 0.26 (inner, EAR_INNER) at z +0.045. Ears flop/perk via pivot rotation.
- **Eyes:** black bead spheres r 0.045 at `(±0.115, 0.90, 0.255)` + white shine sphere r 0.015 offset `(+0.012, +0.015, +0.03)`. **Eyelids:** body-colored half-spheres r 0.052 over each eye; `lid.rotation.x` 0 = open → 1.25 = closed (blink, sleepy half = 0.6).
- **Face:** nose = flattened sphere r 0.035 scaled `(1, 0.8, 0.6)` NOSE at `(0, 0.845, 0.285)`. **Buck teeth:** 2 white rounded boxes 0.030×0.038×0.012 under nose (it's a rabbit!). Cheeks: CircleGeometry r 0.05 CHEEK at `(±0.17, 0.83, 0.245)`, slight sphere-normal tilt. **Mouth:** 5 pre-built `ShapeGeometry` meshes toggled by visibility: `smile` (arc), `open` (rounded O), `frown`, `flat`, `chew` (wide oval; chew anim scales it). No whiskers (ruled: clean vinyl look).
- **Arms:** capsules r 0.08 × 0.18, shoulder pivots `(±0.36, 0.52, 0.05)`, resting on the belly. **Feet:** flattened capsules r 0.11 × 0.22 splayed ±18° at `(±0.16, 0.05, 0.18)`, PAW_PAD ovals underneath. **Tail:** sphere r 0.09 at `(0, 0.18, −0.40)`.
- **Blob shadow** (`gfx/blobShadow.js`): radial-gradient circle plane under root, scales with squash.
- Poly budget ≤ 6k triangles; every mesh `name`d (`'head'`, `'belly'`, `'earL'`…) for raycast regions (head/belly/feet).

**D2.3 Public API (binding contract):**
```js
createGooby() → {
  group,                       // THREE.Group, add to any scene
  update(dt),                  // drives active clips + auto-blink (every 2.5–5 s random)
  setEmotion(id),              // 'neutral'|'happy'|'ecstatic'|'sad'|'grumpy'|'sleepy'|'hungry'|'dizzy'
  play(clip, opts) → Promise,  // clips in D2.4; opts {loop, speed}; resolves on end
  stop(clip), lookAt(worldPos|null),  // pupils+head track a point (clamped ±25°)
  regionAt(raycastHit) → 'head'|'belly'|'feet'|null,
  anchors: { hat, glasses, neck, handL, handR },   // Object3D attach points for outfits/props
  setWet(bool), setStink(bool), setDrool(bool)      // state particle/visual toggles
}
```

**D2.4 Animation clips (`goobyAnims.js`, all programmatic tweens/springs on pivots):**

| clip | duration | motion spec |
|---|---|---|
| idle | loop 2.6 s | breathe: body scaleY 1↔1.03, ears sway ±3°, occasional weight shift |
| happyBounce | 0.9 s | 2 hops y+0.12 (sine), squash 1.15/0.85 on land, ears flop counter-phase |
| sadSlump | 0.8 s→hold | head −15° pitch, ears droop 40°, arms hang |
| eat | per bite 1.3 s | mouth open 0.2 s → 6 chew cycles 0.15 s (cheeks scale 1.15) → swallow (body scaleY ripple) |
| sleep | loop 2.2 s | lying in bed, breathe 1.04, eyes closed, Zzz particle every 2.5 s |
| wake | 1.2 s | stretch arms up, ears perk, big yawn (mouth open) |
| tickle | loop 0.5 s | rapid body wiggle rotZ ±6°, giggle mouth, cheeks pulse |
| pokeWobble(dir) | 1.2 s | spring impulse rot ±0.25 rad toward dir, damped (freq 3 Hz, ζ 0.35) |
| dizzy | 2.0 s | head circles, pupils → spiral torus overlay, stars particle ring |
| dance | loop 1.2 s | side-steps + arm pumps synced to 100 BPM, ear swings |
| wave | 1.0 s | right arm raise + 3 waves |
| jump | 0.6 s | crouch 0.85 → leap y+0.25 → land squash |
| refuse | 0.7 s | head shake ×3, flat mouth |
| sitDrive | hold | seated pose (for car), paws on wheel |

**D2.5 Emotion faces:** mood band (§C1) sets the default emotion; contexts override (eating, sleeping, dizzy…). Face table: `happy`=smile+open eyes; `ecstatic`=smile+shine ×2+bounce idle; `sad`=frown+lids 0.3+droopy ears; `grumpy`=flat+lids 0.45+one ear down; `sleepy`=lids 0.6+slow blink+yawn every ~8 s; `hungry`=flat+drool drop mesh+belly rumble; `dizzy`=spiral pupils+open mouth. `emotions.js` owns the state machine (`contextEmotion || moodEmotion`).

### D3. Room compositions & D4. Lighting

Room shells: procedural boxes — floor 4×3 m, back wall 4×3.2 m, half side-walls (camera side open). Wallpaper/floor = `CanvasTexture` painted patterns (flat colors + subtle motifs; `stars` = dots; `checker` = tiles). Furniture GLBs placed at slot anchors per `rooms/*.js` layout tables (positions in each file, tuned by G4 with screenshots).
Lighting (`gfx/lights.js`): `HemisphereLight(#fff5e8, #b8a898, 0.9)` + `DirectionalLight(#fff2dd, 1.1)` angled from the window side; **single 1024 px shadow map in home scene only** (Gooby + furniture cast, floor receives). Bedroom night mode: lerp hemisphere to `(#4a5a8a, #202535, 0.5)`, directional off, warm `PointLight` at the lamp until sleep starts. Minigames/city: no shadow maps — blob shadows only. City drive: same hemi+dir (no shadows), fog `#cfe8ff` from 60 m for depth + draw-distance savings.

### D5. UI style (custom CSS, `ui/styles.css`)

Pastel brand: bg cream `#FFF6EC`, primary pink `#FF7BA9`, teal `#59C9B9`, yellow `#FFD166`, text brown `#4A3B36`. Cards/sheets: white, radius 20 px, soft shadow. Buttons: chunky, radius 18 px, 4 px darker bottom-border ("pressable"), press animation scale 0.96. Stat bars: rounded pills with icon (SVG), fill color per stat (hunger orange, energy yellow, hygiene blue, fun pink), pulse when <25. Fonts: `system-ui` stack only (offline app, no webfonts), weight 800 headers. Touch targets ≥ 48 px. Safe areas: `env(safe-area-inset-*)` padding on HUD/nav. All screens portrait-designed at 390×844 baseline, fluid to 320–480 width.

### D6. Audio (`audio/`)

- **SFX:** Kenney `interface-sounds` (UI taps, open/close, toggles), `impact-sounds` (bonks, catches, crashes, drops). `sfxMap.js` maps ~40 semantic ids (`ui.tap`, `coin.get`, `eat.chomp`, `crash`, `splash`…) → ogg path (random-from-set) or synth recipe.
- **Gooby voice** (`goobyVoice.js`): WebAudio-synthesized — squeak = sine 600–900 Hz with pitch envelope + slight vibrato; giggle = 3–5 staccato squeaks descending; snore = filtered noise + 80 Hz sine swell loop; yawn = 400→200 Hz glide. Randomized ±10% pitch so it never repeats exactly.
- **Jingles:** `music-jingles` NES oggs for level-up, achievement, minigame results, daily bonus.
- **Music:** procedural WebAudio lo-fi loop (pentatonic pluck sequencer, ~72 BPM, very quiet) for home; 100 BPM upbeat variant for danceParty (also the beat source); off by default in minigames except dance. Settings toggles: SFX / music / haptics.
- Init on first user gesture (iOS requirement). Haptics: `@capacitor/haptics` light impact on catches/bonks/buttons; no-op on web.

---

## §E. Architecture Spec (binding contracts)

### E1. Scene manager (`core/sceneManager.js`)
Owns `WebGLRenderer` (antialias on, `setPixelRatio(min(devicePixelRatio, 2))`), the single canvas, resize handling, and the RAF loop. API: `register(id, factory)`; `switchTo(id, params) → Promise` — lifecycle: `factory(ctx)` → `{ scene, camera, enter(params), update(dt), exit(), dispose() }`; manager fades (150 ms black overlay), calls `exit`+`dispose` on old (which must free geometries/materials it created and remove listeners), preloads via `assets.preload(sceneAssetKeys[id])`, then `enter`. `ctx = { renderer, assets, input, audio, store, ui }`. Scene ids: `'home'`, `'minigame'` (framework hosts the active game).

### E2. Store (`core/store.js`)
`createStore()` singleton wrapping the save-schema state (E3). API: `get(path)` (dot path), `set(path, value)`, `update(fn)` (batched), `on(event, cb)`/`off`. Events: `'change'` (any, coalesced per frame) plus specific: `'statsChanged'`, `'coinsChanged'`, `'xpChanged'`, `'levelUp'`, `'sleepChanged'`, `'inventoryChanged'`, `'outfitChanged'`, `'decorChanged'`, `'achievementUnlocked'` (payload: id). Autosave: debounced 1 s after any change; forced flush on `visibilitychange`/`appStateChange`/`pagehide`.

### E3. Save schema v1 (`core/save.js`; key `gooby.save` in localStorage / Capacitor Preferences)
```js
{ v: 1, createdAt, lastTickAt,
  stats: { hunger:80, energy:90, hygiene:85, fun:70 },      // new-game defaults
  sleep: { sleeping:false, startedAt:0, wakeAt:0 }, grumpyUntil:0,
  coins:100, xp:0, level:1,
  inventory: { carrot:3, apple:1, cupcake:1 },
  furniture: { owned:['<defaults>'], placed:{ living:{sofa:'loungeSofa',…}, … } },
  decor: { wallpaper:{living:'cream',…}, floor:{living:'wood',…} },
  outfits: { owned:[], equipped:{ hat:null, glasses:null, neck:null } },
  minigames: { best:{}, plays:{}, lastPlayDay:{} },
  achievements: { unlocked:{}, counters:{ feeds:0, washes:0, sleeps:0, trips:0, tickles:0, petsToday:0, petsDay:'' } },
  daily: { lastClaimDay:'', streak:0 },
  quickDelivery:false,
  settings: { lang:'auto', sfx:true, music:true, haptics:true, notifications:'unasked' }, // 'unasked'|'granted'|'denied'|'later:<ts>'
  onboarding: { done:false, step:0 } }
```
`load()`: parse → run `migrations[]` (v0→v1 …) → validate/clamp; corrupt JSON → backup to `gooby.save.corrupt` + fresh state (never crash). `test/save.test.js` covers roundtrip, migration, corruption, forward-version refusal.

### E4. Time engine & offline catch-up
`core/clock.js`: `now()` — **the only allowed time source** (dev harness can pin/scale it via `?now=`/`?fast=`). `core/timeEngine.js`: 1000 ms interval → `stats.applyTick(state, dtMin)` or sleep fill; updates `lastTickAt`. `systems/offline.js` (pure): `simulateOffline(state, nowMs) → { state, events }` — if sleeping: apply asleep rates for `min(elapsed, wakeAt−lastTickAt)`, complete wake if due (event `'wokeUp'`), then remaining elapsed decays awake at ×0.3 capped 480 min; events also include `'statLow:<stat>'` crossings for UI toasts. Called once in `main.js` before first render.

### E5. Input (`core/input.js`)
Pointer-events only (mouse+touch unified). API: `on('tap'|'dragstart'|'drag'|'dragend'|'swipe'|'hold', cb)` with `{x, y, nx, ny, dx, dy, vx, vy, dir}`; `pick(camera, objects) → hit` raycast helper; `swipe` = >60 px & >500 px/s horizontal/vertical. Scenes subscribe on `enter`, unsubscribe on `exit` (manager enforces via scoped emitter it passes in `ctx`).

### E6. UI layer (`ui/ui.js`)
DOM overlay `#ui` above canvas. `showScreen(id, params)` (full-screen: arcade, shop, wardrobe, achievements, settings, results), `openPanel(id)` (sheets: food tray, confirm, permission), `toast(textKey)`, `closeAll()`. Screens are plain modules exporting `{ mount(el, params), unmount() }`, registered in `ui.js`. Canvas input is blocked while a full screen is open.

### E7. Notifications adapter (`core/notifications.js`)
`isSupported()`, `getPermission()`, `requestPermission()`, `rescheduleAll(state)` (calls `notifyRules.computeSchedule`, cancels ids 1–5, schedules), `cancelAll()`. Native path: `@capacitor/local-notifications` (`schedule({ notifications:[{id, title, body, schedule:{at}}] })`). Web path: best-effort `Notification` while page hidden via `setTimeout` (dev only). Chosen at runtime via `Capacitor.isNativePlatform()` with dynamic import guard so the web build never hard-requires the plugin.

### E8. Minigame plugin interface (`minigames/framework.js`)
Game modules (`minigames/games/*.js`) default-export:
```js
{ id, assetKeys: ['food-kit/carrot', …],
  init(ctx),        // ctx = { scene, camera, renderer, input, audio, assets, rng, hud, params,
                    //         onScore(points), onEnd({score}) }  — hud: {setScore, setTime, banner}
  update(dt, elapsed), dispose() }
```
Framework owns: launch flow (energy check → scene switch → asset preload → countdown 3-2-1), pause/resume (auto-pause on hidden), the results screen (score, best, coins incl. daily ×2 badge), reward payout via `economy.awardMinigame(id, score)`, stat effects (−energy, +fun), XP, and returning to home/shop-trip flow. Games never touch the store directly. Metadata (title, icon, minLevel, coinTable) lives in `data/minigames.js`; implementations are discovered via `import.meta.glob('./games/*.js')` — a metadata entry without a module renders as "coming soon" (must be zero at ship). `_smoke.js` is hidden from the menu (`dev:true`) and reachable via `?minigame=_smoke`.

### E9. Dev harness (`dev/harness.js`, dev builds only — key for agents & evals)
URL params: `?scene=home|gooby` · `?room=kitchen|living|bathroom|bedroom` · `?minigame=<id>` (direct launch) · `?open=shop|wardrobe|achievements|arcade|settings` · `?coins=N ?level=N ?energy=N ?hunger=N ?hygiene=N ?fun=N` (state overrides) · `?fast=N` (clock multiplier) · `?now=<epochMs>` (pin clock) · `?reset=1` (wipe save) · `?lang=de|en`. `?scene=gooby` = character showcase: Gooby on a plain stage + DOM buttons for every emotion & clip (G3's acceptance surface).

### E10. Performance budget (binding)
≤ 2 pixelRatio; home ≤ 120 draw calls / ≤ 150k tris; drive ≤ 180 draw calls (buildings/trees via `InstancedMesh` or merged geometry; traffic cars individual); other minigames ≤ 150; one 1024 shadow map (home only); no postprocessing; texture memory ≤ 64 MB; JS bundle ≤ 1.6 MB gzip; scene switch ≤ 1.5 s on 4× CPU-throttled Chrome; steady 60 fps on 2020 mid-range phone (VM SwiftShader renders ~10 fps — expected, not a bug).

---

## §F. iOS Packaging Plan

### F1. Capacitor setup (agent G13, on this Linux VM)
1. Add deps to `GOOBY/package.json`: `@capacitor/core@^7`, `@capacitor/ios@^7`, `@capacitor/local-notifications@^7`, `@capacitor/preferences@^7`, `@capacitor/app@^7`, `@capacitor/haptics@^7`; dev `@capacitor/cli@^7`.
2. `capacitor.config.json`: `{ "appId": "com.permissionmaxed.gooby", "appName": "Gooby", "webDir": "dist", "ios": { "contentInset": "never" }, "plugins": { "SplashScreen": { "launchShowDuration": 800, "backgroundColor": "#FFF6EC" } } }`.
3. `npm run build` then `npx cap add ios` (works on Linux; skips pod install — that happens in CI on macOS). **Commit the whole `ios/` directory** except `ios/App/Pods/` (gitignored; `Podfile` + `Podfile.lock` if generated ARE committed).
4. `Info.plist` edits: `UISupportedInterfaceOrientations` = `[UIInterfaceOrientationPortrait]` only (both idiom variants); `ITSAppUsesNonExemptEncryption` = `false`; `CFBundleDisplayName` = `Gooby`. No mic/camera keys (out of scope). Local notifications need no plist key (runtime prompt).
5. `index.html` already has `viewport-fit=cover`; verify safe-area CSS.

### F2. Icon & splash (no binary sources in prompts)
`scripts/gen-icons.mjs`: pure-Node PNG encoder (zlib + CRC32, ~60 lines, no deps) rasterizing a vector Gooby face (cream circle head, two ear capsules, bead eyes, pink nose, buck teeth on pastel pink bg) via scanline circle/ellipse fills. Outputs: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (1024×1024, Xcode 16 single-size icon + matching `Contents.json`) and `Splash.imageset` 2732×2732 centered logo. Run once, commit outputs. `test/icons.test.js`: encoder produces a valid PNG header/IHDR/IEND for a 4×4 image.

### F3. GitHub Actions — `/workspace/.github/workflows/gooby-ios.yml`
Triggers: `push: { paths: ['GOOBY/**', '.github/workflows/gooby-ios.yml'] }` + `workflow_dispatch`. Repo is public → free macOS minutes; Actions enabled by default (repo currently has zero workflows). Two jobs:

```yaml
name: GOOBY iOS
jobs:
  web-checks:                      # ubuntu-latest
    defaults: { run: { working-directory: GOOBY } }
    steps: checkout → setup-node@v4 (node 22, cache npm, cache-dependency-path GOOBY/package-lock.json)
           → npm ci → npm run lint → npm test → npm run build
  ios-ipa:                         # runs-on: macos-15 (Xcode 16.x default — required by Capacitor 7)
    needs: web-checks
    defaults: { run: { working-directory: GOOBY } }
    steps: checkout → setup-node (as above) → npm ci → npm run build → npx cap sync ios
           → cd ios/App && pod install
           → xcodebuild -workspace App.xcworkspace -scheme App -configuration Release
               -sdk iphoneos -derivedDataPath "$RUNNER_TEMP/dd"
               CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build
           → mkdir Payload && cp -R "$RUNNER_TEMP/dd/Build/Products/Release-iphoneos/App.app" Payload/
           → zip -qry gooby-unsigned.ipa Payload
           → actions/upload-artifact@v4  name: gooby-unsigned-ipa  path: GOOBY/ios/App/gooby-unsigned.ipa
```
Unsigned `.ipa` → sideloadable via AltStore/Sideloadly (documented in README). No Apple certificates exist — never add signing steps. G13 must verify the workflow YAML with a real push and iterate until green.

---

## §G. Build Prompts (relay verbatim; each agent also reads PLAN.md)

**Common preamble (prepend to every prompt):**
> You are a build agent for GOOBY, a polished Pou/Talking-Tom-style virtual-pet game (fat rabbit) in `/workspace/GOOBY`. First read `/workspace/GOOBY/PLAN.md` — it is the binding contract (§B file tree, §C design numbers, §D art, §E architecture). Never touch `/workspace/MONKEYBAR` or any file outside your ownership list. Match conventions: Vite + vanilla ES modules + JSDoc, three.js ^0.170.0, ESLint flat config, `node:test`. Dev server: `npm run dev` (port 5174). Test everything you build: `npm run lint`, `npm test` must pass; for visual work take headless screenshots via `npm run shot -- "<url>" shots/<name>.png` and inspect them (the VM GPU is SwiftShader — low FPS is normal, correctness matters). Use `t(key)` from `src/data/strings.js` for ALL user-facing text (add EN+DE). All numbers come from `src/data/constants.js` — never inline design constants. Commit only your owned files with message `GOOBY W<wave>/G<n>: <summary>`.

---

### WAVE 1

**G1 — Scaffold, core engine, data, minigame framework**
- **Owns:** `package.json`, `package-lock.json`, `vite.config.js`, `eslint.config.js`, `index.html`, `.gitignore`, `README.md` (stub), `scripts/screenshot.mjs`, `src/main.js`, `src/core/{clock,store,save,timeEngine,sceneManager,input}.js`, `src/data/{constants,strings,foods,minigames}.js`, `src/systems/{stats,inventory,leveling}.js`, `src/ui/{ui.js,styles.css,icons.js}`, `src/gfx/tween.js`, `src/audio/audio.js` (stub w/ final API §D6: `init/play/music/setVolume` as no-ops logging), `src/minigames/{framework.js,registry.js,games/_smoke.js}`, `src/dev/harness.js`, `test/{stats,leveling,inventory,minigameMeta}.test.js`.
- **Deliverables:** working `npm run dev/build/lint/test/shot`; boot shows a placeholder home scene (empty pastel stage + "GOOBY" title) — real home lands in W2; store+save v1 per §E2/E3 with autosave+corrupt recovery; timeEngine ticking stats per §C1; ALL §C numbers in `constants.js` (stats, sleep, XP, coins, coin table, notification rules, prices); `strings.js` with `t()` EN+DE and initial keys; foods catalog §C5.1; minigame metadata §C6 for all 12 + `_smoke`; framework per §E8 fully functional with `_smoke` (tap-the-dot game, 15 s) incl. countdown/pause/results/reward path (economy award stubbed to direct coin add until G11 — leave `// G11 replaces` marker); dev harness §E9 complete (it is every later agent's test surface); `scripts/screenshot.mjs` spawning `google-chrome --headless=new --screenshot=<out> --window-size=390,844 --virtual-time-budget=15000 --hide-scrollbars <url>`.
- **Contracts provided:** every §E signature. **Tests:** stats decay/mood/clamps vs §C1 numbers; XP curve incl. L9→10=500; inventory ops; minigame metadata integrity (12 ids, coin table clamps, unlock levels). **DoD:** lint+test+build green; screenshots of `/` and `/?minigame=_smoke` show working boot + full smoke-game loop incl. results screen.

**G2 — Kenney asset pipeline + loader**
- **Owns:** `scripts/{kenney-manifest.mjs,fetch-kenney.mjs}`, `src/core/assets.js`, `public/assets/kenney/**` (committed output), `test/assets.test.js`.
- **Deliverables:** manifest exactly per §D1 (packs, model dirs, whitelists, globs+caps); fetch script (discovery regex from §D1, tmp download, extract whitelist → `public/assets/kenney/<slug>/*.glb` + `audio/*.ogg`, License.txt per pack, idempotent, prints size table, fails >80 MB); **run it and commit the assets**; `core/assets.js`: `preload(keys)->Promise`, `getModel(key)->Group` (deep clone, shared materials), `getAudioUrl(key)`, key = `'<slug>/<file-no-ext>'`, LRU-less permanent cache, loading via `GLTFLoader` from `three/addons`.
- **Tests:** `assets.test.js` — every manifest file exists on disk, every `License.txt` present, total size < 80 MB, every asset key referenced in `data/foods.js`/`data/minigames.js` resolves to a file. **DoD:** lint+test green; a dev-harness check page is NOT required, but write a tiny node script check (in the test) that parses one GLB header (magic `glTF`) to prove files are valid; committed asset size printed in your final message.

**G3 — Gooby character (the soul)**
- **Owns:** `src/character/{gooby,goobyFace,goobyAnims,emotions}.js`, `src/gfx/{materials,particles,blobShadow}.js`, `test/goobyApi.test.js`, plus the `?scene=gooby` showcase registration (add the scene module as `src/character/showcase.js`).
- **Deliverables:** implement §D2 exactly — geometry recipe D2.2, palette D2.1, API D2.3, all 14 clips D2.4, emotion faces D2.5, auto-blink, `lookAt` pupil+head tracking, region raycast names, particles (hearts, Zzz, sparkles, stink flies, dizzy stars, crumbs, bubbles, confetti — one lightweight pooled system), blob shadow. Showcase scene: Gooby on pastel stage, DOM buttons for every emotion + clip + toggles (wet/stink/drool), tap regions logging.
- **Tests:** `goobyApi.test.js` — emotion state machine pure logic (mood band → emotion, context override), clip registry completeness (all 14 ids), no-three.js import in `emotions.js`. **DoD:** lint+test green; screenshots of showcase in ≥4 emotions + sleep clip; visually verify chubby/cute proportions per D2.2 (belly widest at hips, ears ≈ ⅓ of height); ≤ 6k tris (log `renderer.info`).

### WAVE 2

**G4 — Home scene & rooms**
- **Owns:** `src/home/{homeScene,roomManager,rooms/kitchen,rooms/living,rooms/bathroom,rooms/bedroom}.js`, `src/gfx/lights.js`, `src/ui/roomNav.js`, `test/rooms.test.js`.
- **Deliverables:** persistent home scene per §C2/§D3/§D4: 4 room shells (procedural walls/floors accepting wallpaper/floor CanvasTextures — expose `setWallpaper(roomId, id)`/`setFloor(roomId, id)` consuming §C5.2 ids), default furniture placed from Kenney GLBs at slot anchors, camera pan navigation (swipe/arrows/dots), Gooby standing in active room with idle emotion, day/night window, bedroom night mode hooks (`setNight(bool)`), `getAnchor(name)` for: `goobyIdle`, `bed`, `bathtub`, `fridge`, `sofa`, `tv`, `frontDoor`, `toilet`, `lampSwitch`, `wardrobe`, `ballSpawn`, per-room slot anchors. Fixed interactables emit events (`roomManager.on('tap:fridge')` etc.) — care logic itself is G5's.
- **Contracts consumed:** `createGooby` (G3), `assets` (G2), `sceneManager` (G1). **Kenney:** furniture-kit whitelist §D1. **Tests:** room defs integrity (4 rooms, all anchors present, slot ids match §C5.2). **DoD:** lint+test green; screenshots of all 4 rooms (`?scene=home&room=…`) showing furnished rooms + Gooby; draw calls ≤ 120 (log `renderer.info.render.calls`).

**G5 — Care interactions, HUD, arcade screen**
- **Owns:** `src/home/interactions.js`, `src/ui/{hud,arcadeScreen}.js`, `test/interactions.test.js`.
- **Deliverables:** §C3 complete: pet/tickle/poke gesture classification on Gooby regions, feed flow (fridge tap → food tray panel of owned items → drag GLB mini to mouth → eat clip → stat deltas → inventory consume → refuse ≥95), wash flow (bathtub: Gooby in tub, soap drag coverage 0–100%, suds particles, shower rinse → hygiene formula), toilet gag, ball toss (flick ballistic + fetch), daily pet/tickle caps; HUD per §D5 (4 stat pills, coins, XP/level ring, buttons: arcade, shop-trip, wardrobe, achievements, settings, mute); arcade grid (12 tiles + locks per §C6.3, best scores, launches framework).
- **Contracts consumed:** anchors+events (G4), gooby API (G3), stats/inventory (G1). **Tests:** gesture classifier pure logic (velocity/direction-change thresholds), feed math incl. refuse + caps, wash coverage→hygiene formula. **DoD:** lint+test green; screenshots: HUD over living room, food tray open, mid-wash suds, arcade grid; demo via harness `?fast=60` that stats visibly decay and feeding restores.

**G6 — Time, sleep, offline, notifications, settings**
- **Owns:** `src/systems/{sleep,offline,notifyRules}.js`, `src/core/notifications.js`, `src/ui/{settingsScreen,permissionPrompt}.js`, `test/{sleep,offline,notifyRules,save}.test.js`, may extend `src/core/save.js` migrations.
- **Deliverables:** sleep per §C1.4 (lamp-switch flow with G4 `setNight`, bed placement, countdown HUD chip, early-wake rule, grumpy debuff, room lock), offline sim per §E4 wired into `main.js` boot (welcome-back toast summarizing elapsed changes), notification stack per §C7 (rules, adapter, reschedule hooks on hide/save, permission soft-ask flow), settings screen (language, notifications toggle+status, reset save w/ double confirm; leave a marked section for G14 audio toggles).
- **Tests (the heart of correctness):** sleep durations (energy 5 → 29 min, ≥10 min floor), auto-wake, early wake; offline: sleep completing while closed, 8 h cap, decay ×0.3, event emission; notifyRules: predicted times vs §C1 rates, quiet-hour shifts (21:50 hunger → 08:05), wake exempt, 30-min spacing, 5-notification cap; save migration + corruption. **DoD:** lint+test green; manual proof via harness: `?energy=10&fast=60` → sleep → wake full cycle screenshots; simulated offline via `?now` jumps.

### WAVE 3

**G7 — City, driving, shop trip**
- **Owns:** `src/city/{cityBuilder,traffic,carController}.js`, `src/minigames/games/cityDrive.js`, `src/systems/shopTrip.js`, `test/{cityLayout,shopTrip}.test.js`.
- **Deliverables:** seeded 9×9 city (20 m tiles; ring + cross roads from §D1 road tiles; buildings on block tiles w/ instancing; nature filler; shop = `building-c` + awning + parking at a fixed route end); route system (waypoints, floating arrows, glowing route line); car controller (auto-throttle 9→13 m/s, thumb-zone steering + brake, lane-snapping assist ≤15°, wall/prop soft collisions); traffic (6–10 cars fixed loops, forgiving 70% AABBs); full §C4 shopTrip state machine incl. tow-truck rule, crash feedback, coin pickups, arrival→shop handoff (shop UI itself is G11 — until merged, arrival opens a placeholder panel with a `// G11 replaces` marker and pays rewards); arcade mode variant; wheel-check fallback per §D1 car-kit note.
- **Tests:** city layout pure gen (roads connect: every route waypoint adjacent-connected; shop reachable; deterministic from seed), shopTrip transitions incl. tow, reward math (§C4.3). **DoD:** lint+test green; screenshots: city overview (dev top-cam flag ok), driving POV with arrows, arrival at shop; drive ≤ 180 draw calls.

**G8 — Minigames A: carrotCatch, bunnyHop, carrotGuard, memoryMatch**
- **Owns:** `src/minigames/games/{carrotCatch,bunnyHop,carrotGuard,memoryMatch}.js`, `test/minigamesA.test.js`.
- **Deliverables:** 4 games exactly per §C6.1 #2–5 within the framework (§E8): full mechanics, ramps, juice (particles/squash/audio ids via `audio.play` even while stub), Gooby cameo reactions (celebrates on results). Scoring must land the §C6 typical/avg targets.
- **Tests:** per-game pure scoring/ramp logic (extract into exported pure helpers): catch values/junk penalty, gate speed ramp, mole timing ramp + steal rule, memory score formula incl. time bonus. **DoD:** lint+test green; screenshot per game mid-play + one results screen; each playable start→finish headlessly reachable via `?minigame=<id>`.

**G9 — Minigames B: runner, basketBounce, pancakeTower**
- **Owns:** `src/minigames/games/{runner,basketBounce,pancakeTower}.js`, `test/minigamesB.test.js`.
- **Deliverables/Tests/DoD:** same bar as G8 for §C6.1 #6–8 (runner: lane/jump/slide swipes, stumble rule; basket: ballistic + rim bounce + moving hoop + bank detection; pancake: slice/perfect/topping rules) with pure-logic tests (lane collision windows, arc solver, slice math) and per-game screenshots.

### WAVE 4

**G10 — Minigames C: danceParty, fishingPond, bubblePop, trampoline**
- **Owns:** `src/minigames/games/{danceParty,fishingPond,bubblePop,trampoline}.js`, `test/minigamesC.test.js`.
- **Deliverables/Tests/DoD:** same bar as G8 for §C6.1 #9–12. danceParty: seeded 75 s note pattern + hit windows (pure-tested), beat from `audio.music` API (works with stub — timing from clock; G14's real track uses the same seed/BPM contract: 100 BPM, pattern seed in constants). fishing: depth/rarity table; bubble: target-match rule; trampoline: window-shrink + trick multiplier math. Screenshots each.

**G11 — Economy, shop, furniture placement**
- **Owns:** `src/systems/{economy,furniturePlacement}.js`, `src/data/furniture.js`, `src/ui/shopScreen.js`, `src/home/decor.js`, `test/{economy,furniture}.test.js`; replaces the two `// G11 replaces` markers (framework reward path, shop placeholder).
- **Deliverables:** economy per §C: `award/spend/canAfford`, minigame payout incl. daily ×2 (localDay from clock), quick-delivery markup (+20% ceil) + L8/400c unlock + fridge Order button; shop UI (tabs food/furniture/wallpaper+floor/outfits — the outfits tab opens G12's wardrobe in buy mode, leave a `// G12 wires` marker; food quantity picker; owned/equipped states; opens from shop-trip arrival AND read-only browse from HUD [buy disabled outside trips except quick delivery]); furniture placement (slot pickers per room in a decorate mode entered via long-press on a slot or shop "place now"), decor application (GLB swaps, wallpaper/floor via G4 API), persistence.
- **Tests:** payout clamps for all 12 coin-table rows, ×2-once-per-day, markup rounding, afford/spend atomicity, placement validity (slot/item compat), **economy simulation:** scripted "average day" (claims daily, plays 12 min mixed games, feeds to satiation) must net positive ≥ +40c and afford full food needs by day 3 — tune nothing; prove §C numbers work (they were designed to; if the sim fails, report exact numbers in your final message instead of changing constants). **DoD:** lint+test green; screenshots: shop tabs, decorate mode, a re-decorated living room.

**G12 — Wardrobe, outfits, achievements, daily bonus**
- **Owns:** `src/character/outfitAttach.js`, `src/data/{outfits,achievements}.js`, `src/systems/{achievementsEngine,dailyBonus}.js`, `src/ui/{wardrobeScreen,achievementsScreen,dailyBonusPopup}.js`, `test/{achievements,dailyBonus,outfits}.test.js`.
- **Deliverables:** 11 procedural outfit items per §C5.3 modeled on Gooby's `anchors` (hat/glasses/neck; party-hat cone, beanie hemisphere+pompom, cap disc+brim, top-hat cylinder, crown w/ zigzag rim; glasses torus pairs + bridge; scarf torus segment + tails, bowtie boxes) — visible in home, minigame cameos, and drive (sitDrive); wardrobe screen (categories, try-on live preview, buy inside shop trips only, equip anytime; wire the shop's Outfits tab via G11's `// G12 wires` marker); achievementsEngine (counter tracking API `track(id, n=1)` wired via store events + explicit calls already placed by earlier agents' counters §E3, unlock detection, reward payout, toast+screen); daily bonus per §C8.2 with popup calendar.
- **Tests:** all 16 achievement conditions unit-driven via counters, streak logic incl. reset + day-boundary via fake clock, outfit catalog integrity (slots/prices), equip persistence. **DoD:** lint+test green; screenshots: wardrobe try-on (crown + star glasses + scarf equipped), achievements screen, daily popup day-3 state.

### WAVE 5

**G13 — iOS packaging + CI**
- **Owns:** `capacitor.config.json`, `ios/**`, `scripts/gen-icons.mjs`, `test/icons.test.js`, `/workspace/.github/workflows/gooby-ios.yml`, README "Build & Sideload" section; edits `package.json` (cap deps), `index.html`/`styles.css` only for safe-area/orientation fixes if needed, `.gitignore` (Pods).
- **Deliverables:** §F1–F3 exactly: cap deps, config, `npx cap add ios`, Info.plist edits, icon/splash generation + commit, workflow file, native adapters smoke (notifications/preferences/haptics dynamic-import guards already in place — verify web build unaffected). Push and **iterate on the real GitHub Actions run until green** with artifact `gooby-unsigned-ipa` (use `gh run view --log` to debug; typical pitfalls: pod install pathing, xcodebuild scheme name `App`, artifact path).
- **Tests:** icons PNG validity; plus web-checks job IS the regression gate. **DoD:** green `GOOBY iOS` run URL + artifact present + `npm run build && npx cap sync ios` clean locally; README documents workflow_dispatch + AltStore/Sideloadly sideload steps.

**G14 — Audio, haptics, polish, onboarding, docs**
- **Owns:** `src/audio/{audio,sfxMap,goobyVoice}.js`, `src/ui/onboarding.js`, `README.md` (final), `AGENTS.md`; may edit `settingsScreen.js` (audio/haptics toggles section marked by G6), `styles.css` (append), `gfx/particles.js` (extend), and add `audio.play`/haptics calls inside any `src/` file (only additive one-liners; do not restructure others' code).
- **Deliverables:** real audio manager per §D6 (unlock-on-gesture, ogg pool via `assets.getAudioUrl`, ~40 sfx ids mapped, jingles, procedural home music + 100 BPM dance track honoring G10's seed/BPM contract), Gooby voice synth, haptics wrapper (native light impacts); polish pass: coin-fly-to-counter animation, screen transitions, results-screen confetti, low-stat HUD pulses; onboarding per §C8.1 (resumable, skippable, tutorial carrotCatch variant flag via framework `params`); final README (play + dev + build); `GOOBY/AGENTS.md` (layout, conventions, §E contracts summary, dev-harness cheatsheet, VM notes: SwiftShader fps, port 5174, screenshot workflow).
- **Tests:** `test/onboarding.test.js` (owned) — onboarding step machine as pure logic (advance/skip/resume); keep the whole existing suite green. **DoD:** lint+test+build green; full-game walkthrough screenshots: fresh `?reset=1` boot → onboarding steps → daily bonus; audio init verified via console log in headless run; final CHANGELOG-style summary in README.

---

## §H. Eval Plan — 20 independent evaluation agents

Each eval agent: read PLAN.md, run the game (`npm run dev`, harness §E9, headless screenshots) and/or the listed commands, then file a verdict: **PASS / PASS-WITH-NOTES / FAIL** + prioritized findings (P0 blocker, P1 must-fix, P2 nice). Evals must not edit code.

| # | charter | inspect / run | pass bar |
|---|---|---|---|
| E1 | Gooby character quality | `?scene=gooby`: all emotions/clips/regions, proportions vs §D2, blink/lookAt, outfit anchors | Reads as a cute chubby vinyl-toy rabbit; all 14 clips distinct & smooth; touch regions correct |
| E2 | Care loop fun & correctness | Feed/wash/pet/tickle/poke/ball flows vs §C3 incl. caps, refuse, fridge tray UX | All 7 interactions work with juicy feedback; stat math matches constants |
| E3 | Stats/mood math | `npm test` (stats/leveling) + `?fast=60` observation vs §C1 tables | Tests pass; observed decay within ±5% of spec; mood bands drive emotion |
| E4 | Sleep & offline | Sleep cycle via `?energy=10`, early wake, `?now` time-jumps, offline cap | 30-min contract honored; sleep completes offline; 8 h cap; grumpy debuff works |
| E5 | Notifications | `npm test` notifyRules; adapter code review; permission flow UX; reschedule hooks | Schedule matches §C7 exactly (ids, quiet hours, caps, spacing); soft-ask before OS prompt |
| E6 | Rooms & customization | 4 rooms, nav gestures, all §C5.2 slots place/swap, wallpapers/floors apply+persist | Every slot variant renders correctly; no z-fighting/overlap; persists across reload |
| E7 | Drive & shop loop | Full trip ×3 (clean, crashy, tow), arcade drive, quick delivery at L8, coin math | Drive is genuinely playable+forgiving; shop always reached; §C4 rewards exact |
| E8 | Minigames A quality | Play #2–5 (§C6.1) to completion multiple times; ramps; scoring→coins | Each fun & bug-free 60 s+; difficulty ramps felt; payouts within table bounds |
| E9 | Minigames B quality | Play #6–8 same bar | same |
| E10 | Minigames C + framework | Play #9–12; framework consistency (countdown/pause/results/×2 badge) across ALL 12 | same + zero "coming soon" tiles; pause/resume never corrupts state |
| E11 | Economy balance | `npm test` economy sim; hand-play a day; price/earn audit vs §C tables | Day-3 sim affordable; no exploit (e.g. replay farming beyond caps); grind feels fair |
| E12 | Save robustness | Corrupt save, forward-version, migration, mid-minigame kill, `?reset`, cross-reload persistence of every purchasable | Never crashes; nothing lost except intentionally; corrupt → clean recovery |
| E13 | iOS/CI correctness | Workflow run log, artifact, ipa structure (`unzip -l`: Payload/App.app, icon assets), Info.plist, capacitor config | Green run; valid unsigned ipa; portrait-only; plist per §F1.4 |
| E14 | Performance | `renderer.info` per scene vs §E10 budget; dispose audit (scene-switch 20× memory check); bundle size | All budgets met; no leak growth after 20 switches |
| E15 | Audio & haptics | All sfx ids mapped & fire; music toggles; voice synth variety; haptic call sites guarded | No missing/broken sounds; iOS gesture-unlock handled; mute persists |
| E16 | Onboarding/retention | Fresh boot walkthrough; skip path; daily bonus streak (clock-fake 9 days incl. gap); 16 achievements triggerable | Onboarding completable+skippable; streak math right; every achievement reachable |
| E17 | Touch ergonomics & layout | 320–480 px widths, safe-area simulation (CSS override), thumb reach, target sizes ≥48 px, DE+EN string fit | No clipped/overlapping UI in either language; one-hand playable |
| E18 | Code quality | `npm run lint`, JSDoc on public APIs, §B ownership/structure conformity, no cross-imports from MONKEYBAR, constants centralized | Lint clean; structure matches §B; no inlined design numbers |
| E19 | Licensing & assets | `assets.test.js`; every pack dir has License.txt (CC0); no non-Kenney binaries; size budget; manifest ⊇ all runtime asset keys | 100% CC0-or-procedural; < 80 MB; zero 404 asset loads in console |
| E20 | "Full game" verdict + bug sweep | 45-min free play across everything; console error log capture; the §I checklist one by one | §I fully satisfied; zero P0s; feels like a shippable 1.0, explicitly not an alpha |

Coordinator aggregates: any FAIL or P0 → targeted fix agents (scoped to the owning module's file list) → re-run affected evals.

---

## §I. Acceptance Criteria for 1.0 ("polished full game")

1. `npm ci && npm run dev` boots to onboarding on first run; returning users land in the living room with offline catch-up toast.
2. Gooby: all 14 clips, 8 emotions, touch reactions (poke/pet/tickle), lookAt, low-stat visual states — all reachable in normal play.
3. All 4 rooms furnished, navigable by swipe+arrows, decor customization (furniture variants, 6 wallpapers, 4 floors) purchasable & persistent.
4. Care loop complete: feed (16 foods, drag-to-mouth), wash (scrub+rinse), toilet gag, ball toss, sleep (~30 min real-time, wake notification), daily pet caps.
5. All 12 minigames playable start→finish with countdown/pause/results/×2-daily bonus; unlock schedule enforced; zero placeholder tiles.
6. Shop trip: drive is mandatory for shopping, forgiving (tow rule), fun (traffic, pickups); quick delivery unlockable per spec.
7. Economy: §C prices/payouts implemented exactly; average-day simulation test passes; coins/XP/levels/level-up rewards all functional.
8. Notifications: 5 triggers with DE+EN copy, quiet hours, caps, soft-ask permission flow; reschedule on background; wake notification fires after real 30-min sleep.
9. Persistence: versioned save, migrations, corruption recovery, offline simulation with 8 h cap; sleep completes in real time while closed.
10. 16 achievements + daily bonus streak + onboarding, all completable.
11. Bilingual EN+DE via `t()`; language auto-detect + manual switch; no overflowing text in either.
12. Audio: SFX map complete, Gooby voice synth, jingles, toggleable music; haptics on device.
13. Performance budgets (§E10) met; no memory growth across 20 scene switches; no console errors in a full playthrough.
14. `npm run lint`, `npm test` (all suites), `npm run build` green on Linux CI job.
15. **GitHub Actions `GOOBY iOS` workflow green on `main`, producing `gooby-unsigned-ipa` artifact** (unsigned, AltStore/Sideloadly-ready), triggered by `GOOBY/**` pushes and manual dispatch; portrait-only, safe-area correct, icon+splash present.
16. README documents play/dev/build/sideload; AGENTS.md documents architecture + dev harness; `/workspace/MONKEYBAR` untouched (git diff proof).
