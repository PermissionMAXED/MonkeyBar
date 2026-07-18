# GOOBY 3.0 „ECHT & GROSS" — Master Build Plan, Part 1 (§A–§D)

**Status:** binding spec for the 3.0 release. PLAN.md (v1, esp. §E contracts) and PLAN2.md (v2 §A–§C numbers) remain binding history — 3.0 only *adds* or *explicitly overrides* where stated. Plan agent 2 appends §E–§G (team/wave prompts, eval plan, runbook) below §D. Baseline: HEAD `8bdaab8` — 873 node:test green, ESLint 9 clean, CI unsigned .ipa green, 21 games, 20 outfits, save v2, repo assets 9.6 MB.

**3.0 in one sentence:** GOOBY 3.0 is the „real game" release — real Kenney/KayKit assets and real audio everywhere (files, not oscillators), two flagship minigames (Cake Shop + Shopping Surf) plus four more deep games (→ 27), an AI-illustrated Gooby sticker book, Nutella + the Nougatschleuse kitchen gag, a driving overhaul, ≥40 outfits, UI scaling + volume sliders + hidden dev panel, iPhone safe-area correctness, and a lossless save v3.

---

## §A. 3.0 Product Definition & „Definition of 3.0"

### A1. Scope map (product-owner requirements → workstreams)

| # | PO requirement | Workstream id | Spec |
|---|---|---|---|
| 1 | UI-scale setting (85/100/115/130 %) | W-UISCALE | §C1 |
| 2 | Volume sliders (5 buses, 0–100 %) + loudness pass | W-VOLUME | §C2, §C3.5 |
| 3 | Real audio everywhere + jingle-medley music | W-AUDIO | §B2, §C3, §D3 |
| 4 | Hidden DEV panel (5× tap on language „Auto") | W-DEV | §B4, §C4 |
| 5 | Gooby sticker book (28 AI-generated stickers) | W-STICKER | §B5, §C5, §D6 |
| 6 | Nutella food + Nougatschleuse contraption | W-NUTELLA | §B7, §C6 |
| 7 | Driving overhaul (road fit + drive feel) | W-DRIVE | §C7 |
| 8 | Gooby Shopping Surf (flagship runner + 2nd travel method) | W-SURF | §C8 |
| 9 | Purble Place cake shop (flagship) | W-CAKE | §C9 |
| 10 | 4 more deep games + depth/bug pass over all 21 | W-GAMES | §C10 |
| 11 | Real-asset replacement sweep + UI reskin | W-ASSETS | §C11, §D |
| 12 | Wake-up + belly-rub animation bugs | W-ANIMFIX | §C12 |
| 13 | iPhone safe-area + viewport matrix | W-SAFEAREA | §C1.3–C1.4 |
| 14 | Outfits 20 → ≥40 | W-OUTFIT | §C13 |
| 15 | Save v3 (lossless from v2 AND v1) | W-SAVE | §B1 |

### A2. Measurable acceptance („Definition of 3.0") — ALL must hold at ship

**Counts (exact):**

- **27 minigames** total: the 21 shipping games + `purblePlace`, `shoppingSurf`, `toyRacer`, `ghostHunt`, `rocketRescue`, `harborHopper`. Zero „coming soon" tiles. All 27 launchable via `?minigame=<id>`, all 27 have `?autoplay=1` bots and pure `.logic.js` siblings (§E8 unchanged).
- **42 outfits** (20 v2 + 22 new per §C13) across 4 slots (hat / glasses / neck / **back** — new slot). Wardrobe stays a single shared renderer; opening it with 42 items adds no measurable regression vs 20 (≤ 100 ms extra on-device, ≤ 1 s extra on the SwiftShader VM).
- **28 sticker-book stickers** (§C5 catalog, ids frozen), art committed as `public/assets/stickers/<id>.png` (512×512, ≤ 150 KB each) — the coordinator generates these BEFORE the build wave; the build must not start a sticker UI agent until all 28 PNGs exist.
- **5 volume sliders** (Master, SFX, Musik, Gooby, Ambience) 0–100 % in steps of 5, persisted in `settings.volumes`, all five audibly effective (bus-gain verified via `audio.getStats()`).
- **4 UI scale steps** — 85 / 100 / 115 / 130 % — persisted as `settings.uiScale`, applied via root `font-size` + `rem` sweep (§B3), live without reload.
- **1 hidden dev panel** gated on `settings.devUnlocked` (5× tap on the language „Auto" segment, §C4); invisible to normal players (no button, no hint, not in onboarding).
- **2 travel methods** to the shop: front-door sheet offers „Fahren" (cityDrive trip, unchanged §C4 semantics) and „Laufen" (shoppingSurf fixed-distance run, §C8.6) — both end in the identical shop-arrival handoff (`shopTrip` machine states untouched).
- **Nutella** in the food catalog + **Nougatschleuse** installed-and-usable in the kitchen (§C6), names exactly „Nutella" / „Nougatschleuse" in DE.

**Real-audio coverage (measured by a new `test/audioCoverage.test.js` over `sfxMap.js`):**

- 100 % of `ui.*` ids and `coin.*` ids are `sample`-backed (real files — no synth UI bleeps left).
- ≥ 65 % of ALL non-voice, non-loop sfx ids are `sample`-backed (baseline today: 61 of 129 ids ≈ 47 %).
- All 5 music contexts (home, garden, arcade, city, shop) play **file-based jingle medleys** (§C3.3) — `audio.getStats()` reports `medley:<context>` with ≥ 1 active `AudioBufferSourceNode`. Exception (binding decision §C3.4): danceParty keeps its synth 100-BPM track for the `DANCE.BPM`/`PATTERN_SEED` chart contract.
- Gooby's voice stays synthesized (his identity) and ambience loops (rain/birdsong) stay synth recipes — they are exempt from the coverage floors.

**Quality bars:**

- **Zero P0/P1** open after the §F eval waves (P0 = crash/save-loss/unplayable game/CI red; P1 = feature broken or spec number wrong, workaround exists).
- **Layout matrix green:** 5 viewports (320×568, 375×667, 390×844, 393×852, 430×932) × 4 UI scales (85/100/115/130) × safe-area insets on/off (§C1.4) = **40 combos**; every screen (HUD, all panels, all full screens, all 27 game HUDs, results, shop, wardrobe, album incl. Stickerbuch, settings incl. dev panel) shows no horizontal scroll, no clipped/overlapping text, no control under the notch/home-indicator, all tap targets ≥ 44 CSS px.
- **Tests:** all existing 873 stay green (may only be *edited* where a spec legitimately changed, never deleted to pass); 3.0 adds ≥ 180 new tests (new games' logic, medley scheduler, sticker engine, save v3 fuzz, road connectivity, volume mapping) → suite ≥ 1050 green via `npm test`.
- **Lint/CI:** ESLint 9 flat config clean; GitHub Actions unsigned .ipa build green at the 3.0 ship commit.
- **Save:** v1→v3 and v2→v3 migrations lossless (every persisted field survives byte-for-value); fuzz suite extended to v3 (≥ 300 seeded corrupt/truncated payloads recover, never crash).
- **Perf:** committed repo assets ≤ 60 MB (§D7 ledger, estimate ≈ 30.6 MB); every scene ≤ 250 draw calls (shoppingSurf/purblePlace measured via the dev-panel overlay §C4); no scene allocates in its per-frame loop (spot-check via 30-s heap deltas in Chrome).
- **i18n:** every new user-facing string in EN **and** DE via per-feature `src/data/strings/v3-*.js` modules (strings.js and v2 modules stay frozen — §E0.1-1 carries over).

### A3. Non-goals / invariants (binding)

- **Gooby himself stays 100 % procedural** — no mesh/rig/material of Gooby is replaced by library assets. Outfit items may be real models; the rabbit is hand-built identity.
- No TypeScript, no frameworks, no build-system swap: vanilla ESM + JSDoc, Vite 6, three ^0.170, node:test, Capacitor 7 stay.
- `src/data/constants.js` stays READ-ONLY **except** one wave-1 re-opening by the single foundations agent (§B8) for COIN_TABLE/UNLOCKS additions; afterwards frozen again.
- v1/v2 game rules, economy numbers, and quest/collection semantics do not change unless a §C row explicitly overrides them.
- Portrait 320–430 px stays the only orientation; EN+DE stay the only languages.
- CRLF line endings in all new/edited files (repo convention).

---

## §B. Architecture Deltas (binding)

### B1. Save schema v3 + migration

`SAVE.VERSION = 3`; `core/save.js` gains `migrations[2]` (v2 → v3). The v0→v1→v2 chain is untouched, so v1 saves migrate losslessly through v2 to v3 in one load.

**New/extended slices (exact defaults):**

```
settings: {
  lang: 'auto', haptics: true, notifications: 'unasked',   // v1 keys unchanged
  sfx: true, music: true,                                  // KEPT as quick-MUTE booleans (§C2.3)
  uiScale: 100,                                            // 85|100|115|130 (§C1)
  volumes: { master: 80, sfx: 100, music: 70, voice: 100, ambience: 80 }, // 0–100 ints (§C2)
  devUnlocked: false,                                      // §C4 gate — persisted
}
stickers: { unlocked: {}, seen: {} }                       // id → unlock epoch-ms / id → true (§C5)
nougat: { lastGlobAt: 0, installed: false }                // §C6 Nougatschleuse
```

**Slice extensions (defaults merged, existing values win — same pattern as v2's counter merge):**

- `achievements.counters` += `{ nougatGlobs: 0, cakesServed: 0, perfectCakes: 0, surfRuns: 0, surfDistanceM: 0, races: 0, ghostsCaught: 0, rescues: 0, cratesShipped: 0 }`.
- `minigames.best/plays/lastPlayDay` maps are open — the 6 new game ids need **no** schema change.
- `inventory` is an open map — `nutella` needs **no** schema change (starter count 0 = absent key).
- `outfits.equipped` gains `back: null` (4th slot, §C13); migration adds the key, never touches hat/glasses/neck.

**`migrations[2]` behavior (mirrors `migrations[1]`'s corruption-guard style):**

1. `out = { ...v3SliceDefaults(), ...state, v: 3 }` — new top-level slices only when absent.
2. `settings`: spread `{ uiScale: 100, volumes: {...defaults}, devUnlocked: false, ...state.settings }` — existing booleans (`sfx/music/haptics`) pass through verbatim; a v2 save with `music: false` boots muted with the slider at its default 70 (muting stays honest, nothing is lost).
3. `outfits.equipped.back = null` when the key is absent (isObj-guarded like the v2 counters merge).
4. `achievements.counters` merged defaults-first (guarded).
5. Never rewrite any existing key; `validate()` (not the migration) clamps `uiScale` to the 4 legal values (illegal → 100) and each volume to integer 0–100 (illegal → default).

**Tests:** `save.test.js` grows v2→v3 + v1→v3 lossless round-trips (every v1/v2 fixture field asserted after migration); the fuzz suite (`saveFuzz.test.js`) re-runs its corpus against v3 plus ≥ 100 new seeded mutations targeting the new slices.

### B2. Audio engine 2.0 (`src/audio/audio.js` rework + new `src/audio/musicDirector.js`)

**B2.1 Bus graph.** `master ← { sfx, music, voice, ambience }` — voice and ambience split OUT of the sfx bus (today Gooby's voice and the rain loop ride sfx). `sfxMap.js` def kinds route: `sample`/`synth` → sfx, `voice` → voice, `loop:true` ambience ids (`ambience.*`) → ambience. `music` carries both the medley player and danceParty's synth track. Master keeps the existing limiter chain.

**B2.2 Slider → gain mapping (binding):** `gain = (v/100)^2` (perceptual curve), applied per bus; master additionally keeps the 0.9 base factor (`masterGain = 0.9 · (master/100)^2`). The `sfx`/`music` booleans stay quick-mutes: effective bus gain = `enabled ? sliderGain : 0` (voice mutes with the sfx boolean, ambience with the music boolean — no new toggles). Volumes apply live via the existing store-follow path (`applySettings` reads `settings.volumes` each `change`).

**B2.3 Real-file sample player.** Today samples stream per-play via `getAudioUrl`. 3.0 adds a decoded-buffer cache: `audio.preloadSamples(keys)` fetch+`decodeAudioData` into a Map (≤ 6 MB decoded budget, LRU-evict beyond it); `play()` uses the buffer when cached, falls back to streaming. The minigame framework preloads each game's sample keys during its existing asset-preload step (new optional `sfx: []` export per game module).

**B2.4 Medley scheduler (`musicDirector.js`) — the „no music loops exist" answer.** Kenney's 86 music-jingles are 0.3–1.8 s one-shot phrases, NOT loopable tracks (measured: NES 0.4–1.8 s, HIT 0.3–1.2 s, PIZZI 0.5–1.3 s, SAX 0.4–1.7 s, STEEL 0.6–1.6 s). Naive concatenation sounds like a ringtone pileup, so per-context music is a **sparse music-box medley**: a fixed 3.2 s bar grid; each bar either plays ONE jingle (AudioBufferSourceNode, 150 ms equal-power crossfade with the previous tail) or rests; 16-bar phrases loop with a seeded shuffle (mulberry32, reshuffle each phrase, constraint: no jingle repeats within 8 bars, rests never move). Under it, a **glue bed** — the only oscillator allowed in music playback — plays a single soft bass note per bar downbeat at −26 dBFS (sine, 0.8 s decay, root note per context). Composition tables with exact filenames: §C3.3. Context switching: `musicDirector.setContext('home'|'garden'|'arcade'|'city'|'shop'|null)` crossfades 800 ms; scene/room enter hooks call it (roomManager → home/garden, arcadeScreen → arcade, city scenes → city, shop screen → shop). `audio.music('home'|'dance')` keeps working: `'home'` now delegates to the medley director; `'dance'` stays the synth sequencer (§C3.4).

**B2.5 Loudness normalization.** New script `scripts/audio-loudness.mjs` (node + ffmpeg, runs offline at build-agent time, NOT in CI) measures mean RMS of every committed ogg and writes `src/audio/loudness.json` (`key → dBFS`). `sfxMap.js` volumes are then recomputed once against targets (one-shots −16 dBFS, jingles −18, loops −20) and hand-tuned per the §C3.5 offender table. `loudness.json` is committed; a test asserts every sample key in SFX_MAP has a loudness entry.

### B3. UI scale mechanism

- `settings.uiScale ∈ {85, 100, 115, 130}` → `document.documentElement.style.fontSize = (16 * uiScale/100) + 'px'` plus `data-ui-scale` attribute, applied at boot and live on change (no reload).
- **rem sweep (one wave-1 agent, mechanical):** `src/ui/styles.css` (1544 lines) + all component-injected CSS strings convert `px → rem` (÷16, 4-decimals) for font sizes, paddings, margins, border-radii, and fixed widths/heights of DOM UI. **Exempt (stay px):** 1px hairlines, box-shadows, the #scene canvas, and three.js-facing numbers. A `scripts/px-audit.mjs` grep-gate fails the build on new `px` font-size/padding declarations in UI CSS (allow-list for the exemptions).
- Tap targets: the 44 px minimum becomes 2.75 rem so it scales UP with uiScale but never below 44 real px at 85 % → rule: interactive elements use `min-height: max(44px, 2.75rem)`.
- Canvas/three.js rendering is NOT scaled (world stays world); only the DOM overlay scales.

### B4. Dev-settings gate

- Trigger: 5 taps on the language „Auto" segment in settings within a 4 s rolling window (counter resets on any other tap or on 2 s of inactivity); on the 5th tap → `settings.devUnlocked = true` (persisted), `ui.toast('dev.unlocked')`, and a new „Entwickler" row appears at the bottom of settings (gear-wrench icon).
- The dev panel is a normal §E6 screen module (`ui/devPanel.js`, registered id `devPanel`) — its registration is unconditional but the settings row and any entry point render ONLY when `devUnlocked` (harness `?open=devPanel` works in dev builds regardless, per §E9 conventions). Item list: §C4.2. No production-build stripping (hidden-by-flag is the spec — keeps web/native builds identical).

### B5. Sticker-book engine

- New pure engine `systems/stickerBook.js` + catalog `data/stickers.js` (28 defs: `{ id, nameKey, flavorKey, hintKey, art: 'assets/stickers/<id>.png', cond }`). Condition shapes REUSE the achievements spec shapes (`{counter, target}` / `{special, target}`) plus a new `{event: '<store event or engine hook>'}` shape for one-shot moments (e.g. `towed`, `rainCanopy`, `grumpyWake`) — the engine subscribes to the same store events achievementsEngine uses and to 4 new runtime hooks (§C5.4).
- Store event `stickersChanged` (payload `{id}`); unlock flow: engine detects → writes `stickers.unlocked[id] = now()` → toast „Neuer Sticker! 🏷️" + `audio.play('sticker.get')` (existing id) → HUD album badge increments. `seen[id]` set when the sticker detail is first opened (drives the „NEU" dot).
- UI: the album screen gains a **top-level tab strip**: „Sticker" (v2 collections, unchanged) | „**Stickerbuch**" (new §C5.3 paged book). No changes to the v2 collections engine.
- Achievements wiring: 3 new achievements (`stickerBook10`, `stickerBook20`, `stickerBookFull` — §C5.5) evaluated by a new `'stickerCount'` special in achievementsEngine (count of `stickers.unlocked`).

### B6. Asset pipeline for KayKit (.gltf) + second asset root

- New committed root: `public/assets/kaykit/<slug>/…`. Two file forms, both CC0 (license files copied per pack):
  - **(a) Self-contained GLB** — the 3 rigged characters (`Knight.glb`, `Mage.glb`, `Rogue_Hooded.glb`, ~3.6 MB each incl. all 76 animations). No pipeline work needed beyond the loader table below.
  - **(b) `.gltf` + per-model `.bin` + ONE shared texture per slug** (Restaurant/City-Builder/Furniture/Halloween Bits ship this way — verified: each `.gltf` references `<model>.bin` + `<pack>_texture.png` by relative URI). Copy scheme: flat-copy the needed `.gltf` + its `.bin` + the shared texture into `public/assets/kaykit/<slug>/`; three's GLTFLoader resolves relative URIs against the model URL, so NO conversion/packing tooling is needed (a headless GLTFExporter repack is explicitly rejected — not feasible offline).
- **`core/assets.js` extension (binding):** a frozen `PACK_FORMATS` table maps slug → `{ root: 'kenney'|'kaykit', ext: 'glb'|'gltf' }` (default `kenney/glb`, so every existing key resolves exactly as today). `getModelUrl` consults it. Keys keep the `'<slug>/<name>'` format (e.g. `'kaykit-restaurant/food_burger'`, `'kaykit-characters/Knight'`).
- **Animations:** `loadModel` currently discards `gltf.animations`. 3.0: `modelCache` stores `{ scene, animations }`; new `getAnimations(key)` returns the cached AnimationClip array (shared, never cloned); `getModel` behavior unchanged for static models. **Skinned characters MUST be cloned via `SkeletonUtils.clone`** (`three/addons/utils/SkeletonUtils.js`) — a new `getSkinnedModel(key)` does this (plain `Object3D.clone()` breaks skeleton bindings — binding rule).
- New `scripts/kaykit-manifest.mjs` + `scripts/fetch-kaykit.mjs` mirroring the kenney whitelist pattern: manifest lists exact files per slug; fetch script copies from `/workspace/asset-staging/kaykit/…`, parses each `.gltf` to verify its `buffers[].uri`/`images[].uri` deps got copied, and fails loudly on a missing dep. Exact file lists: §D2.

### B7. Nougatschleuse interaction contract

- Kitchen `ROOM_DEF` gains a fixture `nougatschleuse` (wall-mounted above the counter, anchor `nougat`, hitSize `[0.9, 1.2, 0.5]`) that renders ONLY when `nougat.installed` (bought in the shop's furniture tab for 400 c, unlock L5 — §C6.3). `roomManager` emits `tap:nougatschleuse`.
- `home/interactions.js` handler (same shape as the fridge/tub flows): checks cooldown + inventory (§C6.4) → walks Gooby under the spout → crank-turn + glob-dispense sequence (tween-based, ~2.8 s) → applies effects through the EXISTING pipes: `stats.apply` for hunger/fun/hygiene, `health.onEat({junk:true})` semantics ×2 (§C6.4), `weight.onEat(junk)` ×1, counters (`nougatGlobs`), sticker hook (`nutellaGlob`), messy-face decal 60 s.
- Pure logic (`nougat.logic.js` in systems/): cooldown check, effect table, refusal reasons (`'cooldown' | 'noJar' | 'sick' | 'sleeping'`) — node-testable.

### B8. Minigame contract & constants ruling

- **§E8 is UNCHANGED** for all 6 new games: same ctx, framework-owned countdown/pause/results/payout, pure `.logic.js` siblings, `?autoplay=1` bots, `onEnd({score, meta})` feeding quests/collections/stickers.
- **Constants re-opening (single exception to the v2 freeze):** wave-1 foundations agent adds to `constants.js` ONLY: 6 new `COIN_TABLE` rows (§C8.5/§C9.5/§C10.1), 6 new `UNLOCKS.MINIGAMES` levels, and `SAVE.VERSION = 3`. Everything else (medley tables, surf/cake tuning, nougat numbers, sticker defs) lives in the owning module as frozen consts (§E0.1-2 pattern carries over).
- Travel-surf (§C8.6) reuses the `shopTrip` machine verbatim: `start → driveOut → shop` states; only the *scene* between `start` and `arrive` differs. `tripTransition` is not modified.

### B9. Safe-area plumbing

- `index.html` already ships `viewport-fit=cover`. 3.0 adds root CSS vars: `--safe-top: env(safe-area-inset-top, 0px)` etc. (all four), and the UI root applies `padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)` — EXCEPT full-bleed backdrops (scene canvas, sheet scrims) which extend under the insets while their *content* respects them. Fixed-position elements (HUD top row, room nav dots, minigame HUDs, results buttons) get explicit `max(<current-gap>, var(--safe-*))` offsets. Exact rules + audit list: §C1.4. Dev testing: Chrome device emulation for the 5 sizes + a dev-panel „fake notch" toggle that force-sets the vars to 59 px/34 px (iPhone 14 Pro values) so the matrix runs in any browser.

### B10. Store events (additions only)

`stickersChanged` (§B5), `nougatChanged` (install/use), `uiScaleChanged` (settings apply). Volume changes ride the existing coalesced `change` event (audio.js already store-follows). No existing event changes shape.

---

## §C. Feature Specs (all numbers binding)

### C1. UI scale + iPhone safe-area (PO #1 + #13)

**C1.1 Setting.** Settings screen gains a „UI-Größe" row: 4-stop segmented slider labeled `85 % · 100 % · 115 % · 130 %` with a live „Aa" preview glyph. Default 100. Applies instantly (§B3), persists as `settings.uiScale`. Toast on change is forbidden (the whole UI visibly changes — no extra noise).

**C1.2 Layout rules at every scale (binding):**

- No horizontal overflow on any screen at 320 px × 130 % (the worst case — effectively a 246 px design grid). Where a row can't fit (e.g. the 4 HUD stat pills), it must WRAP or compress via `flex-wrap`/`clamp()` — never clip.
- Arcade grid: 3 columns at ≤ 100 %, drops to 2 columns when `(viewportWidth / (uiScale/100)) < 350` (media query on the computed rem width).
- Text: no ellipsis on interactive labels at any combo; long DE strings (e.g. „Gießkannen-Wirbel") verified per-screen.
- Tap targets: `max(44px, 2.75rem)` rule from §B3 everywhere.

**C1.3 Audit matrix.** 5 viewports × 4 scales × insets on/off = 40 combos (§A2). Screens audited per combo (checklist for the eval agent): HUD/home, all 5 rooms, arcade, each of the 27 game HUDs + results (spot-check: the 6 new + 4 worst v2 offenders at minimum per combo, ALL games at 320×568/130 % and 430×932/85 %), shop (4 tabs), wardrobe (4 slots), album (both top-level tabs), quest board, profile, photo mode, vet panel, settings + dev panel, onboarding steps 1–5, daily bonus popup, front-door travel sheet.

**C1.4 Safe-area rules (exact):**

- Root vars per §B9. HUD top row: `top: max(8px, var(--safe-top))`. Room nav dots + bottom action bars: `bottom: max(12px, var(--safe-bottom))`. Full-screen sheets: content `padding-bottom: max(16px, calc(var(--safe-bottom) + 4px))`. Minigame pause/exit buttons: `top: max(10px, var(--safe-top))`.
- Landscape is out of scope (portrait-only app); left/right insets still applied (rounded-corner phones inset ~0 in portrait — the vars are cheap insurance).
- Capacitor shell: verify `ios/App` webview does NOT add its own insets (contentInsetAdjustmentBehavior stays `never`) so CSS is the single source of truth.
- Fake-notch dev toggle (§B9) makes all 40 combos runnable in headless Chrome; the CDP screenshot recipe in AGENTS.md is the tool.

### C2. Volume sliders (PO #2)

**C2.1 UI.** The settings audio block becomes: 5 rows, each `icon + label + slider (range 0–100, step 5) + % readout`; the SFX and Musik rows keep a small mute toggle (the v2 booleans) right of the slider; Haptik stays a toggle-only row. Order: Master „Gesamt", SFX „Effekte", Musik „Musik", Gooby „Gooby-Stimme", Ambience „Ambiente".

**C2.2 Defaults + mapping (binding):** master 80, sfx 100, music 70, voice 100, ambience 80. Gain = `(v/100)^2` per §B2.2. On slider release (not during drag): a preview blip on the affected bus (`ui.pick` for sfx/master, a 0.5 s medley jingle for music, `gooby.squeak` for voice, 1 s rain fade for ambience).

**C2.3 Boolean semantics (kept for v2 compat):** `settings.sfx=false` mutes sfx+voice buses; `settings.music=false` mutes music+ambience AND tears down the medley/sequencer (v2 FIX-B airtight-mute rule extends to the medley scheduler: no source nodes may be created while muted). Sliders at 0 do NOT tear down (gain-0 only) — the toggles stay the resource-saving path.

**C2.4 Tests:** mapping math (`volumeGain(80) === 0.64`), clamp/validate of the volumes slice, mute-during-medley creates zero nodes (extend the E15-style node-count probe), settings-row render at all 4 uiScales.

### C3. Real audio everywhere (PO #3)

**C3.1 UI/economy sample sweep (replaces synth bleeps).** New committed files per §D3; new/changed `sfxMap.js` rows (all `sample`, volumes pre-normalization — final values come from the §B2.5 pass):

| id | new source files | note |
|---|---|---|
| `ui.win` | `music-jingles/jingles_HIT16` | replaces synth `winArp` |
| `coin.get` | `casino-audio/chip-lay-1..3` (random) | replaces synth `coin` |
| `coin.fly` | `casino-audio/chips-collide-1..4` | replaces synth `coin` |
| `ui.toggleOn` / `ui.toggleOff` | `ui-audio/switch1` / `ui-audio/switch2` | NEW ids for settings toggles |
| `ui.slider` | `ui-audio/rollover1..3` | NEW id, throttled 80 ms, slider drag ticks |
| `ui.tabSwitch` | `ui-pack/tap-a`, `ui-pack/tap-b` | NEW id for tab strips |
| `ui.confirmBig` | `ui-pack/click-a` | NEW id for primary CTA buttons |
| `catch.good` / `mole.pop` / `bubble.pop` | `impact-sounds/impactSoft_medium_000..004` | pop family → real impacts |
| `jump` | `impact-sounds/footstep_grass_000..004` (pitched via playbackRate 1.3) | runner/surf jump |
| `dance.tapEmpty` stays sample; `says.pad1..4` stay synth (pitch contract) | — | — |

Synth recipes that STAY (binding whitelist): all `voice` ids (Gooby identity), `ambience.rain`/`ambience.birdsong` (loops), the four `says.pad*` (pitch-shared recipe), danceParty's track + its `dance.perfect/good/miss` blips (they sit on the synth beat), and bespoke juice where no CC0 file fits (`vetSparkle`, `harvestJoy`, `stickerPop`, `setFanfare`, `shutter`, `boing*`, `riser`). Everything else UI-ish flips to samples. Target arithmetic for the §A2 floor: 129 non-voice/non-loop ids today, 61 sample-backed (47 %); the sweep flips ≥ 25 synth ids to samples (table above + §C10.2 rows like `card.flip`) and the ~30 new-game ids land majority-sample → ≥ 65 % at ship (`test/audioCoverage.test.js` computes the exact ratio and pins the floor).

**C3.2 Playback.** Sample one-shots move to decoded-buffer playback (§B2.3); per-game `sfx: []` preloads kill first-play latency. `test/onboarding.test.js`'s unmapped-id gate keeps applying.

**C3.3 Music medleys (exact compositions).** 3.2 s bars, 16-bar phrases (51.2 s), 150 ms crossfades, seeded shuffle per phrase (no repeat within 8 bars, rests fixed), glue bed root notes as listed. `R` = rest bar. Files from `music-jingles/Audio/*` (all 85 jingle files committed — §D3).

| context | family | bed root | 16-bar composition (initial order) |
|---|---|---|---|
| `home` | Pizzicato | C2 (65.4 Hz) | PIZZI01 · R · PIZZI03 · PIZZI07 · R · PIZZI12 · PIZZI02 · R · PIZZI13 · PIZZI10 · R · PIZZI14 · PIZZI05 · R · PIZZI15 · R |
| `garden` | Steel | G2 (98 Hz) | STEEL00 · STEEL04 · R · STEEL10 · R · STEEL05 · STEEL15 · R · STEEL16 · STEEL08 · R · STEEL11 · R · STEEL13 · STEEL02 · R |
| `arcade` | 8-Bit (NES) | A2 (110 Hz) | NES00 · R · NES06 · NES07 · R · NES12 · NES05 · R · NES13 · NES11 · R · NES16 · R · NES08 · NES03 · R |
| `city` (drive/deliver/surf-travel) | Sax | F2 (87.3 Hz) | SAX07 · R · SAX01 · SAX12 · R · SAX02 · SAX13 · R · SAX03 · R · SAX14 · SAX15 · R · SAX10 · SAX11 · R |
| `shop` | Pizzicato+Steel mix | D2 (73.4 Hz) | PIZZI00 · STEEL09 · R · PIZZI09 · STEEL12 · R · PIZZI16 · R · STEEL01 · PIZZI06 · R · STEEL06 · R · PIZZI11 · STEEL14 · R |

Results stingers (framework results screen, replaces `jingle.results` context-blind pick): score ≥ best → `jingles_HIT15`; normal finish → `jingles_HIT10`; score 0 / early-out → `jingles_HIT08`. Existing `jingle.*` NES mappings (levelUp/achievement/daily/arrival/outfit/short) stay.

**C3.4 danceParty ruling (binding decision):** danceParty KEEPS its synthesized 100-BPM track — the chart is generated from `DANCE.PATTERN_SEED` and must stay sample-accurate to the beat grid; jingle files have variable internal onsets and cannot guarantee ≤ 70 ms perfect windows. Additive only: `dance.tierUp` moments ALSO fire `jingles_HIT00` (0.3 s) as a one-shot accent on the sfx bus. `getMusicTime()`/BPM contract untouched.

**C3.5 Loudness normalization map (the „too loud today" pass).** Targets: one-shots −16 dBFS RMS, jingles −18, loops −20 (§B2.5 script computes trims; table below pins the known offenders — final `volume` = script trim × table factor):

| id (current volume) | problem | new effective volume |
|---|---|---|
| `eat.chomp` (0.8) | way loud vs ui.tap, plays 5×/feed | 0.5 |
| `crash` (0.8, haptic) | jump-scare in drive | 0.6 |
| `mole.bonk` (0.8) | whack spam | 0.6 |
| `photo.shutter` (0.8) | overdriven synth | 0.6 |
| `gooby.snore` (0.8 loop) | loud all night | 0.55 |
| `hopper.crash` (0.75) | end-of-run spike | 0.6 |
| `jingle.levelUp` / `jingle.daily` (0.75) | jingles sit above music | 0.65 |
| `golf.ace` (0.75) | NES11 is hot | 0.6 |
| `delivery.drop` (0.75) | confetti pop ×3 | 0.6 |
| `tramp.butt` (0.65) | punchy impact | 0.55 |
| `dance.fever` (0.7 riser) | masks the track | 0.55 |
| `ui.go` (0.75) | countdown GO louder than 3-2-1 | 0.6 |

Everything else inherits the script trim. Acceptance: A/B at default sliders — no sfx peaks > −6 dBFS on the meter (dev-panel overlay shows the master peak §C4.2).

### C4. Hidden dev panel (PO #4)

**C4.1 Gate.** Per §B4 (5× „Auto" taps, 4 s window). Re-tapping 5× while unlocked toasts „Dev-Modus bereits aktiv". No way to re-lock from UI (reset save clears it) — keeps the code path simple.

**C4.2 Panel items (exact list, one card each):**

1. **Unlock all** — one button: level → 40, all 27 games, all 42 outfits + 7 skins owned, all 32 collection stickers + all 28 book stickers, all achievements evaluated once. Confirm sheet first.
2. **Level stepper** — `−1 / +1 / set…` (numeric prompt 1–40); re-runs level-unlock evaluation.
3. **Coins** — `+100 / +1000 / set…` (0–999999) through `economy` so profile counters stay honest (`devGrant` reason).
4. **Stats sliders** — hunger/energy/fun/hygiene 0–100 live.
5. **Weight slider** — 5–95 live (tier morph visible immediately).
6. **Health seg** — healthy / queasy / sick (writes `health.state` + since=now).
7. **Weather seg** — auto / sunny / cloudy / rain; **Band seg** — auto / dawn / day / dusk / night (pins the ambience engines like `?now=`, „auto" releases).
8. **Clock offset** — −12 h … +12 h slider driving `clock` pinning (garden growth, quests day-roll testable).
9. **Notification test** — fires a real local notification (id 1) 5 s out; shows the OS permission state.
10. **FPS/draw-call overlay toggle** — corner chip: fps (1 s avg), `renderer.info.render.calls`, triangles, JS-heap (if available), master-bus peak dBFS.
11. **Save tools** — export save JSON to clipboard, import from prompt, reset save (reuses the triple-confirm).
12. **Sticker/quest debug** — fire any sticker by id (dropdown), complete active quests, force daily-bonus day N.

All items live behind `store.get('settings.devUnlocked')`; strings in `v3-dev.js` (EN+DE — yes, even dev strings, cheap and consistent).

### C5. Gooby sticker book (PO #5)

**C5.1 The 28 stickers (ids frozen; catalog `data/stickers.js`).** Shared image-prompt prefix (binding, prepended to every per-sticker prompt): *„Cute flat cartoon sticker of Gooby, a chubby cream-colored rabbit with a big round belly and floppy ears, thick white sticker border, soft pastel background, no text."*

| # | id | EN title / DE title | EN flavor / DE flavor | unlock (existing counters/events unless noted) | per-sticker image prompt (appended to prefix) |
|---|---|---|---|---|---|
| 1 | firstNom | First Nom / Erster Happs | The very first carrot is the sweetest. / Die allererste Karotte schmeckt am süßesten. | `counters.feeds ≥ 1` | Gooby happily biting a huge orange carrot, crumbs flying, blissful closed eyes. |
| 2 | squeakyClean | Squeaky Clean / Blitzeblank | Bubbles in the ears, joy in the heart. / Schaum in den Ohren, Freude im Herzen. | `counters.washes ≥ 1` | Gooby in a bathtub full of foam, a soap-bubble crown on his head, one ear dripping. |
| 3 | ballBuddy | Ball Buddy / Ballfreund | Throw it again. Again! AGAIN! / Wirf nochmal. Nochmal! NOCHMAL! | `counters.balls ≥ 10` | Gooby mid-leap catching a red-and-white ball, ears streaming behind him. |
| 4 | sleepyhead | Sleepyhead / Schlafmütze | Five more minutes… or hours. / Noch fünf Minuten… oder Stunden. | `counters.sleeps ≥ 1` | Gooby curled up asleep under a patchwork blanket, nightcap on, three Z's floating up. |
| 5 | tenNights | Ten Good Nights / Zehn gute Nächte | A well-rested Gooby is a happy Gooby. / Ein ausgeschlafener Gooby ist ein glücklicher Gooby. | `counters.sleeps ≥ 10` | Gooby stretching in morning sunlight beside a bed, ten little stars circling his head. |
| 6 | grumpMorning | Grumpy Morning / Morgenmuffel | Woken too early. Regret everything. / Zu früh geweckt. Bereut alles. | event: wake tap before `sleep.wakeAt` (grumpy path) | Gooby with half-closed eyes and ruffled fur, arms crossed, a tiny storm cloud over his head. |
| 7 | feverFace | Fever Face / Fieberbäckchen | Even thermometers deserve a hug. / Auch Fieberthermometer brauchen mal eine Umarmung. | event: `health.state` → 'sick' first time | Gooby with rosy cheeks and droopy ears, thermometer in mouth, wrapped in a scarf. |
| 8 | drGooby | Vet Visit / Beim Tierarzt | Brave bunny, shiny sticker. / Tapferes Häschen, glänzender Sticker. | `counters.vetTrips ≥ 1` | Gooby proudly showing a tiny bandage on his ear, a kind vet clipboard beside him. |
| 9 | firstSprout | First Sprout / Erster Spross | You watered it. It noticed. / Du hast gegossen. Es hat's gemerkt. | `counters.harvests ≥ 1` | Gooby kneeling in a garden bed, gently holding a tiny sprouting radish, watering can nearby. |
| 10 | rainyDay | Rainy Day / Regentag | Rain taps the canopy. Gooby taps back. / Der Regen trommelt aufs Dach. Gooby trommelt zurück. | event: enter garden while weather = rain | Gooby snug under a leaf canopy while soft rain falls, watching drops with wonder. |
| 11 | starGazer | Star Gazer / Sternengucker | The night counted its stars: plus one bunny. / Die Nacht zählte ihre Sterne: plus ein Hase. | event: enter garden while band = night | Gooby lying on his back in the grass at night, gazing at a sky full of pastel stars. |
| 12 | sayCheese | Say Cheese! / Bitte lächeln! | The first photo is always the floppiest. / Das erste Foto ist immer das schlappohrigste. | `counters.photosTaken ≥ 1` | Gooby posing with a peace sign in front of an old-timey camera on a tripod, flash sparkle. |
| 13 | bigTen | Level 10! / Level 10! | Double digits, double floof. / Zweistellig, doppelt flauschig. | level ≥ 10 | Gooby holding a golden number 10 balloon, confetti falling around him. |
| 14 | quarterClub | Level 25! / Level 25! | Quarter of the way to legend. Wait— / Auf einem Viertel des Wegs zur Legende. Moment— | level ≥ 25 | Gooby wearing a small medal, standing on a podium of carrot crates, fireworks behind. |
| 15 | maxLevel | Level 40! / Level 40! | There is no level 41. Gooby checked. / Es gibt kein Level 41. Gooby hat nachgesehen. | level ≥ 40 | Gooby with a crown and a royal cape on a throne of plush cushions, radiant golden backdrop. |
| 16 | roadTripper | Road Tripper / Spritztour | First gear, first grin. / Erster Gang, erstes Grinsen. | `counters.trips ≥ 1` | Gooby driving a tiny red car, paws on the wheel, ears flying out the window. |
| 17 | towTrouble | Tow Trouble / Abschlepp-Ärger | The tow truck knows Gooby by name now. / Der Abschleppwagen kennt Gooby inzwischen beim Namen. | event: tow cutscene (3 crashes) first time | Gooby sheepishly scratching his head beside a small dented car on a tow truck hook. |
| 18 | goldenCatch | Golden Catch / Goldener Fang | The pond keeps its secrets. Mostly. / Der Teich behält seine Geheimnisse. Meistens. | fishingPond `meta.golden ≥ 1` | Gooby triumphantly holding up a shimmering golden fish over a pond, droplets sparkling. |
| 19 | discoGooby | Disco Gooby / Disco-Gooby | The floor lit up. So did Gooby. / Der Boden leuchtete. Gooby auch. | danceParty finished with score ≥ 100 | Gooby in a disco pose on a glowing dance floor, mirror ball above, one paw pointing up. |
| 20 | holeInOneHero | Hole-in-One / Ass im Loch | One putt. One legend. / Ein Schlag. Eine Legende. | miniGolf `meta.holeInOnes ≥ 1` | Gooby cheering beside a mini-golf hole with a flag, ball dropping in, windmill behind. |
| 21 | parcelPro | Parcel Pro / Paket-Profi | Delivered with floppy-eared precision. / Zugestellt mit schlappohriger Präzision. | `counters.deliveries ≥ 10` | Gooby in a delivery cap balancing a wobbly stack of parcels, one paw saluting. |
| 22 | freshDrip | Fresh Fur / Frisches Fell | New fur, who dis? / Neues Fell, wer ist da? | event: first skin purchased (`skins.owned.length ≥ 2`) | Gooby admiring his new fur color in a standing mirror, sparkles around the reflection. |
| 23 | fullFit | Full Fit / Komplett-Look | Hat, glasses, scarf: fashion bunny. / Hut, Brille, Schal: Modehase. | 3 equip slots filled at once (fullOutfit special) | Gooby striking a catwalk pose in top hat, star glasses and striped scarf, camera flashes. |
| 24 | maxFloof | Maximum Floof / Maximaler Floof | More Gooby to love. / Mehr Gooby zum Liebhaben. | weight ≥ 86 reached (weightMax special) | An extra-round Gooby proudly patting his big wobbly belly, tiny sparkle on the tummy. |
| 25 | nutellaGlob | Nutella Time / Nutella-Zeit | The Nougatschleuse never misses. / Die Nougatschleuse verfehlt nie. | `counters.nougatGlobs ≥ 1` | Gooby mouth-open under a whimsical kitchen chocolate dispenser, a glossy nougat glob falling, chocolate smears on his cheeks. |
| 26 | cakeBoss | Cake Boss / Tortenboss | The customer cried. Happy tears. Probably. / Der Kunde weinte. Freudentränen. Wahrscheinlich. | purblePlace `meta.perfectCakes ≥ 1` | Gooby in a chef hat presenting a perfect three-layer heart-shaped cake with candles. |
| 27 | surfStar | Shopping Surfer / Einkaufs-Surfer | Aisle five has never seen such speed. / Gang fünf hat solche Geschwindigkeit noch nie gesehen. | shoppingSurf run completed (`counters.surfRuns ≥ 1`) | Gooby sprinting through a shopping street, leaping over a rolling shopping cart, coins trailing. |
| 28 | albumMaster | Album Master / Album-Meister | Every sticker has found its home. / Jeder Sticker hat sein Zuhause gefunden. | all 4 v2 collection sets claimed (setsClaimed = 4) | Gooby hugging a bulging sticker album, pages fanning open with colorful stickers flying out. |

**C5.2 Coordinator pre-wave contract.** All 28 PNGs generated 1:1 from the table (prefix + per-sticker prompt), saved as `GOOBY/public/assets/stickers/<id>.png`, 512×512, ≤ 150 KB each (re-encode if the model outputs larger). A `test/stickers.test.js` asserts catalog ↔ file 1:1 (fails on missing/extra files) — this test is the wave gate.

**C5.3 UI („Stickerbuch").** Album screen top-level tabs per §B5. The book: 5 pages (6/6/6/6/4 slots, 2×3 grid), horizontal swipe + page dots, page titles „Seite 1–5". Locked = greyscale silhouette (CSS `filter: grayscale(1) brightness(0.35) opacity(0.45)`) + lock-free (no padlock icon — mystery, not denial); unlocked = full art with a 300 ms pop-in + confetti on first view. Tap any slot → detail sheet: art (large), title, flavor line; locked slots show the hint line instead (`hintKey`, e.g. „Bring Gooby zum ersten Mal ins Bett" — every sticker has a non-spoiler hint). „NEU" pink dot until seen. Header shows `n/28`.

**C5.4 Engine hooks (new one-shot events, fired at the source):** `grumpyWake` (sleepFlow early-wake path), `rainCanopy` (roomManager garden-enter while weather=rain), `nightStars` (garden-enter while band=night), `towed` (shopTrip tow cutscene). All other conditions read existing counters/specials/meta (table above) — no new persistence beyond `stickers.*`.

**C5.5 Achievements wiring.** 3 new achievements: `stickerBook10` (10 book stickers, 50 c), `stickerBook20` (20, 100 c), `stickerBookFull` (28, 300 c) → catalog grows 33 → 36; evaluated via the `'stickerCount'` special (§B5). New-sticker toast + `sticker.get` sound per unlock; max 1 sticker toast per 3 s (queue) so bulk unlocks (dev panel) don't spam.

### C6. Nutella + Nougatschleuse (PO #6)

**C6.1 Food item „Nutella" (data/foods.js append):** `{ id: 'nutella', price: 45, deltas: { hunger: +18, fun: +6, energy: +2, hygiene: −4 }, junk: true, favorite: false, modelKey: 'food-kit/honey' }` — the food-kit honey jar re-tinted chocolate-brown (material color `#5C3A21`) with a procedural cream-white lid band; tray/shop icon: jar glyph 🫙 with a brown fill bar (own icon treatment in `icons.js`, id `nutellaJar`). Shop placement: food tab, sorted by price; quick-delivery eligible. Eating flows through the normal feed pipeline (junk → junkScore +1, weight +2). DE name exactly „Nutella", EN „Nutella".

**C6.2 The contraption.** „Nougatschleuse" (EN „Nougat Sluice") — a wall-mounted kitchen gag machine above the counter: procedural build (hopper funnel + riveted chute + hand-crank + drip spout; palette: copper `#B87352`, cream, chocolate) with a food-kit `chocolate` bar glued on the hopper as a label. ~180 tris, 1 draw call (merged geometry), subtle idle drip animation (a glossy glob sphere scaling 0→0.04 every 7 s).

**C6.3 Acquisition.** Shop → furniture tab: „Nougatschleuse" 400 c, unlock L5. Buying sets `nougat.installed = true` (it auto-mounts — no placement step; it's a fixture, not decor). Appears in the kitchen with a one-time sparkle + toast „Die Nougatschleuse ist installiert!".

**C6.4 Use (exact numbers).** Tap → requires: not sleeping, not sick, ≥ 1 `nutella` in inventory, cooldown elapsed. Sequence (≈ 2.8 s): Gooby waddles under the spout → crank spins 720° → a glob (0.18 m glossy sphere, slight squash) slides down the chute → Gooby catches it mouth-open (happy chomp + `gooby.giggle`). Effects: hunger +15, fun +10, hygiene −8, `junkScore +2` (double junk — it's pure nougat), weight +2, XP +2; consumes 1 nutella jar (the machine „refills" from the jar — toast shows „−1 Nutella"); messy-face: brown cheek smears (CHEEK material lerp) for 60 s or until washed. Cooldown: 30 real minutes (`nougat.lastGlobAt`); tapping early → Gooby pats belly + refusal squeak + toast „Gooby braucht eine Nougat-Pause" (no jar → toast „Keine Nutella! Ab in den Laden" ; sick → the §C3.4-v2 sick refusal). Counters: `nougatGlobs +1` → sticker `nutellaGlob` (first), achievement `nougatmeister` (NEW, 25 globs, 80 c → catalog 36 → 37 with §C5.5's three).

**C6.5 Tests (`nougat.test.js`):** refusal matrix (cooldown/noJar/sick/sleeping), effect application incl. double junkScore, cooldown math across clock pinning, jar consumption, migration default (`nougat` slice absent → defaults).

### C7. Driving overhaul (PO #7 — „die Straße passt nicht" + drive feel)

**C7.1 Root-cause investigation (road fit).** The 9×9 grid picks pieces in `cityBuilder.js` `roadPieceFor(n,e,s,w)` with ASSUMED base orientations: `road-straight` runs N–S at rotY 0, `road-bend` connects S+W at rotY 0, `road-intersection` (T) opens W+E+S at rotY 0. The likely bug class: one or more of these base-orientation assumptions doesn't match the actual Kenney `city-kit-roads` GLBs (visible as sidewalk/curb seams misaligned at corners and T-junctions, i.e. „die Straße passt nicht"), plus `road-crossing` substitution (zebra) not sharing the straight's orientation. Fix procedure (binding):

1. Build dev harness route `?scene=roadtest`: renders all 5 pieces (`straight`, `bend`, `intersection`, `crossroad`, `crossing`) at rotY 0/90/180/270 in a labeled grid + a compass gizmo; screenshot once, read the TRUE port sides per piece per rotation off the render.
2. Encode the truth as a pure **port table** in `cityBuilder.js`: `PIECE_PORTS = { 'road-straight': ['N','S'], 'road-bend': [...], … }` + a rotation function; rewrite `roadPieceFor` to SEARCH (piece, rotY) whose rotated ports === the tile's connectivity set (deterministic, no special-case ladder).
3. New `test/cityRoads.test.js`: for every seeded city (20 seeds), every adjacent road-tile pair must share a facing port; every road tile's ports ⊆ its road-neighbor directions (no port opens into grass/block). This test would have caught the bug and locks the fix.
4. Visual acceptance: 4 screenshots (one per city quadrant, top-down dev cam) — curb lines continuous through every corner/T/crossroad; zebra `road-crossing` stripes perpendicular to travel direction.

**C7.2 Drive feel (carController.js).** Exact tuning changes:

- **Input smoothing:** steering input low-pass with τ = 120 ms (exponential); output steering-rate cap 90°/s (today: effectively instant), so thumb jitter stops twitching the car.
- **Lane assist:** replace snap with a gentle spring — max correction 8°/s toward lane center, force fades to 0 beyond 25° player-intent angle, fully disabled while the player is actively steering ≥ 40 % deflection (assist must never fight the thumb; today's snap is the „weird" feel).
- **Chase camera:** damped follow (position lerp k = 4.0/s, was hard offset), look-ahead point 6 m ahead of the car, FOV 55° → 60° scaling with speed (9→13 m/s), roll/bob removed. No motion sickness at 130 % UI scale overlay.
- **Speed:** trip base 9→13 m/s UNCHANGED (§C4 semantics intact); arcade open-run max nudged 13 → 15 m/s with the ramp starting after 20 s (gentle tuning only).
- Applies to all three drivers of the shared controller: cityDrive trip, cityDrive arcade, deliveryRush.

**C7.3 Invariants:** §C4 trip rewards/energy/tow rule, §C9-v2 vet-trip math, §C1.1-v2 deliveryRush coin row, and all `shopTrip` machine states stay bit-identical (existing tests must stay green unmodified). Tests added: smoothing step-response (τ within ±10 %), assist-force curve (0 beyond 25°), camera-lag bound.

### C8. Gooby Shopping Surf (PO #8 — FLAGSHIP #1, `shoppingSurf`)

**C8.1 Concept.** Subway-Surfers-class endless runner through a pastel shopping street: 3 lanes (lane width 1.6 m, x = −1.6/0/+1.6), Gooby auto-runs, camera behind+above (offset [0, 3.2, −5.5], look-ahead 8 m, FOV 62). Street built from a repeating 30 m chunk pool (12 handcrafted chunk defs, seeded order, §D2 KayKit City Builder + committed city-kit-commercial dressing left/right; shop awnings, crates, streetlights, parked cars as scenery).

**C8.2 Controls.** Swipe left/right = lane change (120 ms tween); swipe up = jump (0.55 s air, clears carts + gaps); swipe down = slide (0.5 s, clears awning bars; mid-air swipe-down = fast-drop). Buffered inputs (1 queued action, 250 ms window). Tap = nothing (no accidental hops).

**C8.3 Obstacles (spawn tables per chunk, ramping):**

| obstacle | asset | dodge | notes |
|---|---|---|---|
| rolling shopping cart | procedural cart (wire-frame box + wheels) | jump or lane | rolls toward player at 2 m/s relative, telegraphed by rattle sfx + 0.9 s visual |
| crate stack (full height) | `kaykit-city/box_A`/`box_B` | lane change | static; pairs never block all 3 lanes (validator in logic) |
| NPC shopper | **KayKit character** (`kaykit-characters/Knight`, `Mage`, `Rogue_Hooded` — Walking_A clip, 1 active skinned NPC max on screen, others frozen-pose clones for perf) | lane or jump (short ones) | crosses lanes L→R at 1.2 m/s, path telegraphed by a dotted line |
| awning bar | procedural striped bar | slide | spans 1–2 lanes |
| puddle | flat disc + splash | any (soft) | not a crash: −10 % speed 2 s + screen splash |
| gap (curb break) | chunk geometry | jump | only ≥ 800 m distance |

Crash rule: hit = stumble (0.8 s, invulnerable 1.5 s after), speed resets to base; **arcade mode**: 3rd crash ends the run; near-miss (pass within 0.35 m without hit) = +2 „Knapp!" juice + streak counter.

**C8.4 Pickups/powerups (despawn if untouched):** coin lines/arcs (+1 each; arcs over carts teach jumping); **Magnet** (6 s, attract radius 3 m), **×2** (8 s, doubles coin pickups), **Schild** (absorbs 1 crash, bubble visual), **Turbo-Möhre** (2.5 s, +40 % speed, invulnerable, auto-collects coins in path — rare: ≤ 1 per 400 m). Powerup spawn: one every 180–260 m, seeded, never two of the same kind consecutively.

**C8.5 Speed & scoring.** Base 8 m/s, +0.25 m/s every 5 s, cap 16 m/s. Score = `floor(distanceM) + coins×2 + nearMiss×2`; typical 90 s arcade run ≈ 800–1100. **Coin row (COIN_TABLE):** `divisor 40, min 5, max 34` (~25 c typical, premium like deliveryRush); energy 8 (arcade). Unlock: **arcade tile at L5**; meta: `{ distanceM, coins, nearMisses, powerups }` → quests/stickers; counters `surfRuns`, `surfDistanceM`.

**C8.6 Travel mode („Laufen") — the second travel method.** Front-door sheet becomes a two-option chooser: „Fahren 🚗" / „Laufen 🏃" (both show the 6-energy cost). Laufen = fixed-distance run **700 m** (≈ 70–85 s), available from L1 like the drive, energy 6 (car-game rate). No fail-out: crashes stumble only; after the 3rd crash Gooby jogs at fixed 7 m/s (no more obstacles — forgiveness, mirrors the tow rule's spirit without a paid rescue). Ends at a shop-façade finish arch → identical `arrive` → shop handoff. **Trip rewards (aligned with §C4.3 semantics — collected pickups ARE the reward, framework `coinsOverride`):** coins collected during the run, capped 30, +5 „Sauberer Lauf" bonus for 0 crashes → max 35, exactly cityDrive's trip cap; daily-first-play ×2 applies per the shared rules; `trips` counter +1 (it IS a shop trip — drive25/roadTripper count both methods; sticker `surfStar` needs `surfRuns` which increments in both modes).

**C8.7 Purity/tests.** `shoppingSurf.logic.js`: chunk sequencer (seeded, never-impossible validator: at every ramp speed there exists a survivable action sequence — BFS over the action lattice for 200 seeds), spawn tables, speed ramp, scoring, powerup timers, travel-reward math (cap 30 + bonus 5, ×2 after clamp). Autoplay bot: plans 1 chunk ahead over the action lattice (jump/slide/lane), targets coin lines when safe — must average ≥ 600 m arcade. Perf: ≤ 250 draw calls (chunk pooling, 1 skinned NPC cap, instanced coins).

### C9. Purble Place cake shop (PO #9 — FLAGSHIP #2, `purblePlace`)

**C9.1 Concept.** „Cake Shop" / „Tortenwerkstatt" — Comfy-Cakes-inspired assembly line in a cozy bakery: KayKit Restaurant Bits kitchen (counter row, oven, order window §D2), NPC customers (the 3 KayKit characters, Walking_A in → Sit_Chair_Idle at the order window → Cheer/sad-Idle out) place cake orders; the player assembles cakes on a left→right conveyor by tapping station buttons at the right moment.

**C9.2 Order tickets.** Ticket = shape (∘ round / □ square / ♥ heart) × sponge (vanilla `#F5E6C8` / chocolate `#6B4A2F` / strawberry `#F2B8C6`) × icing (white / pink / chocolate / **none**) × topping (cherry / sprinkles / berries / **none**) × candles (0–4). Tickets render as pictogram cards top-left (max 3 parallel). Patience bar per ticket: 45 s → −1.5 s per served cake, floor 30 s; expired ticket = customer leaves sad (−5, combo reset).

**C9.3 Assembly loop.** Conveyor speed 0.55 m/s (belt 6 m); stations in order: **Form** (spawns the base pan — tap cycles ∘/□/♥ BEFORE spawn), **Teig** (3 buttons: sponge colors), **Ofen** (bake meter 3 s, tap in the green zone (last 25 %) = perfect bake +5, early = pale −0, late = singed −3), **Guss** (4 buttons), **Deko** (4 buttons), **Kerzen** (tap n times while under the candle dropper). A component applies to the cake currently in that station's window (0.9 s window at base speed); missed window = the slot stays empty (fixable only on the next pass — the belt loops once). Serve zone at the end: auto-serves against the best-matching open ticket.

**C9.4 Scoring.** Perfect match +20 (+5 perfect-bake) + customer Cheer; 1 wrong/missing component +8; ≥ 2 wrong = rejected −5 (cake splats, Gooby facepalm). Combo: +2 per consecutive non-rejected serve (cap +10). Speed bonus: serve with ≥ 50 % patience left +4. Ramp: order interval 30 s → 14 s (−2 s per serve), component count weighting shifts simple→complex (candles ≥ 3 and „none"-icing tickets only after serve #4), belt +6 % speed per 3 serves (cap +24 %). Round = **210 s** fixed. Typical score ≈ 120–150.

**C9.5 Numbers.** **Coin row: `divisor 5, min 5, max 30`** (~26 c / 3.5 min); energy 8; unlock **L6**. Meta: `{ cakesServed, perfectCakes, rejected }` → counters `cakesServed`, `perfectCakes`; sticker `cakeBoss` on first perfect; quest hooks „Serviere N Torten". 
**C9.6 Assets (exact, §D2):** Restaurant Bits: `kitchencounter_straight` ×3, `kitchencounter_sink`, `oven`, `wall_orderwindow`, `wall_doorway`, `plate`/`plate_small`, `menu`, `floor_kitchen` ×8, `chair_A`/`chair_stool`, `table_round_A`, `crate_buns`/`crate_cheese`/`crate_tomatoes` dressing, `cuttingboard`, `jar_A_medium`/`jar_C_small`; Kenney food-kit: `cake`, `cake-birthday`, `cupcake`, `muffin`, `whipped-cream`, `strawberry`, `chocolate`, `donut-sprinkles`; cakes themselves are procedural lathe layers (tint-parametric — 3 shapes × 3 sponges × 4 icings = 36 combos can't be static models) with food-kit toppings snapped on; cherry + candles procedural (sphere+stem / cylinder + flame sprite). 
**C9.7 Purity/tests.** `purblePlace.logic.js`: ticket generator (seeded, difficulty weighting), match/scoring matrix (all 0/1/≥2-wrong cases), patience/ramp math, belt-window hit test, bot = tap scheduler that reads the next cake's ticket and queues station taps (must average ≥ 90 score). Skinned-NPC cap 1 walking + 2 seated frozen poses; ≤ 250 draw calls.

### C10. Four more deep games + depth/bug pass over all 21 (PO #10)

**C10.1 New games (each: multi-mechanic + powerups + meta; §E8 + .logic.js + autoplay bots; coin rows in wave-1 constants).**

| id | name EN / DE | unlock | coin row | energy | duration |
|---|---|---|---|---|---|
| toyRacer | Toy Grand Prix / Spielzeug-Rennen | L15 | divisor 6, min 5, max 30 | 8 | ~150 s |
| ghostHunt | Ghost Hunt / Geisterjagd | L16 | divisor 4, min 4, max 28 | 8 | 90 s |
| rocketRescue | Rocket Rescue / Raketen-Rettung | L18 | divisor 5, min 4, max 28 | 8 | ~120 s |
| harborHopper | Harbor Hopper / Hafen-Hüpfer | L20 | divisor 5, min 4, max 30 | 8 | 120 s |

1. **toyRacer** — 3-lap race on a seeded toy-room circuit built from Kenney toy-car-kit track pieces (§D2; 8-piece loop, 2 layout templates × seeds) vs 3 rubber-band AI karts. Mechanics: hold-to-drift (charge meter → release = boost 1.2 s), item boxes every ~⅓ lap (turbo / bumper-shield / toy-block drop behind), off-track = 40 % slow. Score = `position bonus (1st 120 / 2nd 80 / 3rd 50 / 4th 30) + 2·overtakes + drift meters/10`. Meta `races`, `wins`. Bot: follows the center spline, drifts corners > 45°, uses items instantly. Look: bedroom-floor world (giant rug, building-block skyline).
2. **ghostHunt** — spooky-CUTE seek-and-tap in a KayKit-Halloween graveyard-garden at dusk: cute sheet-ghosts (procedural — cloth-sphere + eyes, NOT scary) peek from graves/pumpkins/crypts on ramping timers (visible 2.2 s → 0.9 s); tap = catch (+3, chain +1 per catch within 1.5 s, cap +5); decoys: pumpkin-lanterns that flicker like ghosts (tapping −2); mechanics 2: „Boo-wave" every 25 s — 5 ghosts at once, catch ≥ 4 for +10; powerups: Laterne (3 s: all spawn points revealed early), Netz (next 3 catches auto-chain). 90 s. Score ≈ 90. Meta `ghostsCaught`. Bot: taps real ghosts at spawn+200 ms, ignores decoys.
3. **rocketRescue** — physics lander: thrust (hold) + tilt (left/right thirds) piloting a space-kit shuttle over 5 seeded platforms per round; pick up 1 stranded bunny per platform (land ≤ 1.2 m/s vertical), carry to the station pad; fuel tank 100, thrust burns 8/s, fuel pickups float mid-air; wind gusts telegraphed by particle streaks (levels 3+); hard landing = bounce + −10 fuel (never death; out-of-fuel = auto-tow to pad, run ends). Score = `30·rescued + fuelRemaining/2 + softLandingBonus (5/landing ≤ 0.5 m/s)`. Meta `rescues`. Bot: PD-controller on altitude/velocity per platform. Look: committed space-kit + starfield.
4. **harborHopper** — steer a Kenney watercraft-kit fishing boat down a harbor channel (auto-forward 6 m/s, drag to steer, momentum-heavy): collect floating crates (+4) and net rings (+2), dodge buoys/piers (bump = −3 + slow, 70 % hitboxes); mechanics 2: rhythmic **wave bands** roll across the channel — riding a wave crest at its center gives a surf-boost (+30 % for 2 s, chainable); seagull steals your top crate if you idle in one lane > 4 s (honk warning first). Powerup: Fischkutter-Horn (clears buoys in a 6 m cone, 2 charges). 120 s. Score ≈ 100. Meta `cratesShipped`. Bot: spline-follows a greedy crate path, centers wave crests.

Distinct-look rule (v2 §C1.3) extends: toyRacer = bedroom-floor toy world; ghostHunt = dusk graveyard-garden (purple/orange); rocketRescue = starfield/space; harborHopper = teal harbor morning; shoppingSurf = pastel shopping street; purblePlace = warm bakery interior. No palette/skybox collisions with the 21.

**C10.2 Depth + bug pass over the existing 21 (one row each — „depth" = ONE new mechanic/powerup/escalation; „audit" = the bug hot-spot to verify & fix).** All depth features must keep coin rows/energy/scoring CAPS intact (score opportunities may shift within existing caps); each game's `.logic.js` gets tests for its new feature; each audit outcome (bug or clean bill) is logged in the PR.

| game | new depth feature (exact) | bug audit focus |
|---|---|---|
| carrotCatch | **Golden carrot** (1 per run, +10, falls 1.5× speed) + rotten-carrot streak-breaker (catching resets combo, −2) | basket hitbox vs 130 % UI overlay; spawn RNG bias at edges |
| bunnyHop | **Wind gusts** (telegraphed, shift Gooby 0.4 lanes; gates count double during gusts) | gate-collision tolerance at high flap rates; pause-resume mid-flap |
| cityDrive | (gets the FULL §C7 overhaul — counts as its depth+fix) | §C7.1 road fit, §C7.2 feel |
| carrotGuard | **Mole king** every 20 bonks (3 taps to bonk, +8, drops 2 coins-worth score) | simultaneous-tap double-hit; whiff penalty spam |
| goobySays | **Chord rounds** from round 6 (two pads light together, tap both within 250 ms) | pad tap registration at 85 % scale; sequence replay speed floor |
| memoryMatch | **Peek powerup** (1×/round: 1 s reveal-all, earned at 3 matches without a miss) | 6×4 layout at 320×568; rapid double-flip race condition |
| basketBounce | **Moving hoop phase** after 10 baskets (hoop slides ±1 m, swish ×2) | rim-physics tunneling on fast throws |
| gardenRush | **Sprinkler powerup** (fills all pots' rings 50 %, spawns once at 30 s) | hold-release ring timing drift vs frame rate |
| pancakeTower | **Wobble physics escalation** (tower sways from height 8; perfect drops damp it) | slice-overhang math at extreme offsets; topping despawn |
| burgerBuild | **Rush orders** (gold ticket, 1.5× points, 20 % shorter timer, max 2/round) | column drift at 393 px; wrong-catch splat overlapping next spawn |
| runner | **Mystery box** (random: magnet 4 s / ×2 6 s / stumble-shield) — aligns its powerup set with shoppingSurf | slide hitbox height; obstacle double-hit after stumble |
| veggieChop | **Frenzy wave** every 25 s (8 veggies in 3 s, no junk mixed in) | swipe-trail hit detection at low fps; combo reset on junk |
| bubblePop | **Chain-pop** (popping 3 same-color within 2 s pops neighbors of that color) | spiky-bubble touch radius; new-target readability (color-blind check) |
| deliveryRush | inherits §C7.2 drive feel + **fragile parcel** (1 of 3 marked: no crash allowed or −20, +15 bonus if clean) | drop-ring detection at speed; route-line z-fighting |
| fishingPond | **Rare species set** (3 new fish sprites/weights feeding the v2 fish collection; „set of 3 in one run" +15) | reel-tap tension window vs frame hitches; boot odds |
| danceParty | **Fever chain** (5 perfects during fever = „Encore" 5 s, notes ×2 points — §C3.4 accents ride this) | §D6 BPM sync after pause/resume; late-join note spawn |
| miniGolf | **Hole 7 „Nougat-Loop"** (new bonus hole with a loop + moving Nougatschleuse obstacle, par 3, plays only if all 6 ≤ par+1) | windmill blade collision timing; power-cap drag on small screens |
| trampoline | **Trick chaining** (3 distinct tricks in one air = „Combo-Flip" +12) | armed-boost double-fire; landing detection after tier-up |
| goalieGooby | **Penalty shootout finale** (last 10 s: 5 rapid telegraphed shots, saves ×2) | swipe-direction misread near screen edges; super-save slow-mo timer leak |
| starHopper | **Wormhole** (rare gate: 2 s autopilot through a star tunnel, +1 star/0.2 s) | lane-swipe vs 2-lane jump conflict; shield-pickup respawn rule |
| pipeFlow | **Leak timer variant** from puzzle 3 (one joint drips; solve before 25 s or −5) | rotation-tap racing the fill animation; solver/board desync after skip |

**C10.3 Arcade screen.** Grows to 27 tiles (unlock order: L1…L20 per the §C10.1 rows merged with v1/v2 schedules); stays 3 columns (2 at the §C1.2 narrow rule); the two flagships get a wide „NEU"-ribbon tile treatment for the first 3 local days after first unlock.

### C11. Real-asset replacement sweep + UI reskin (PO #11)

**C11.1 3D prop swaps (primitive/procedural → real models where it RAISES quality; Gooby, cakes, ghosts, outfit-fit items stay procedural by design).** Exact swap list (staging source → §D2 copy list):

| area | today | 3.0 replacement |
|---|---|---|
| v2 reward furniture (`proc:goldfishBowl`, `proc:goldenWateringCan`, `proc:toyCity`, `proc:candyJar`) | procedural stand-ins | watering can → survival-kit `bucket` re-tinted gold + procedural spout; toy city → 3 toy-car-kit `track-narrow-*` minis on a base; candy jar → Restaurant Bits `jar_A_large` + candy tint; goldfish bowl STAYS procedural (glass + fish reads better hand-built). (Swap = model only; ids/rewards unchanged.) |
| garden | procedural compost bin, stump, some beds | nature-kit additions: `bench`, `fence_gate`, `flower_purpleA/redA` clusters, `stump_round` (§D2); compost bin STAYS procedural (identity item) |
| kitchen/living/bath/bedroom dressing | sparse | furniture-kit additions: `kitchenCoffeeMachine`, `books`, `lampSquareCeiling`, `plantSmall1/2`, `bathroomMirror`, `toaster` as static dressing per room (≤ 3 new draw calls per room) |
| city dressing | cones/boxes procedural | kaykit-city `streetlight`, `firehydrant`, `dumpster`, `bench`, `trash_A/B` scattered on sidewalks (seeded, instanced where >3) |
| minigame props | various primitives | per-game rows in §C10.1/§C10.2 (toy track, halloween set, boats, restaurant set); veggieChop board → Restaurant Bits `cuttingboard`; burgerBuild counter → Restaurant Bits `counter_A` |
| shop interior | flat shelves | mini-market-style shelving built from Restaurant Bits crates + City Builder boxes (6 props) |

Rules: every swap keeps or lowers draw calls (merge/instance); metalness-normalization (v2 FIX-F) applies to all new GLBs; no swap changes gameplay geometry (hitboxes stay data-driven).

**C11.2 UI reskin with Kenney **UI Pack** (the base `ui-pack` — rounded, friendly, matches the cozy identity; NOT sci-fi/adventure variants).** Approach (binding):

- Commit the **grey + extra** sprite subsets (§D4, ~48 files): 9-slice panels (`button_square_border`, `button_rectangle_border`, variants `_flat`, `_gloss`), progress/slider rails (`slide_horizontal_*`), checkbox/radio (`check_*`), star/medal icons.
- CSS mechanism: `border-image` 9-slice on `.card`, `.btn`, `.seg`, panel headers, slider tracks/knobs; the sprites are GREY-neutral → tinted via existing CSS custom-property palette using `filter: hue-rotate/sepia` is forbidden (mushy) — instead use the grey sprites as STRUCTURE (border/bevel) layered over `background-color` fills from the existing cream/teal/pink vars. Identity check: the cream `#FFF6EC` page background, brown text `#4A3B36`, teal/pink accents ALL stay; the reskin adds bevel/depth, not a palette change.
- Component map: `.card` → `button_square_border` 9-slice (24 px slices); primary `.btn` → `button_rectangle_depth_flat` (pressed state = `_flat` swap + 2 px translate); toggles → `check_round_*`; the 5 volume sliders → `slide_horizontal_grey` rail + `slide_horizontal_color_section` fill + round knob; tab strips → underline stays CSS (sprites too heavy there); results-screen stars → `star.png`/`star_outline.png`.
- Where sprites fight the look (toasts, HUD pills), KEEP the current CSS — the reskin covers: settings, shop, wardrobe, arcade tiles, album, quest board, results screen, dialogs/sheets (≈ 80 % of visible chrome).
- Acceptance: side-by-side before/after shots of the 8 reskinned surfaces; the §C1.3 matrix runs AFTER the reskin (border-image scales with rem — verify no 9-slice seams at 130 %).

### C12. Animation bug root-cause specs (PO #12)

**C12.1 Wake-up bug.** Symptom: after sleep → wake, Gooby's pose glitches (reported „buggy": visible snap/half-lying idle blend). Repro for the fix team: `?sleep=1` → wait for sleep loop to settle (≥ 5 s) → tap Gooby to wake early (grumpy path) AND separately let `wakeAt` elapse (natural path) → observe the transition into `wake` (1.2 s, loop:false) and the follow-up idle. Investigation checklist (in `character/goobyAnims.js` + the sleepFlow caller):

1. `sleep` is a LYING pose (loop); `wake` (stretch/yawn) very likely authored from a STANDING base — check whether the crossfade lerps root/limb transforms from lying → standing mid-clip (looks like sliding through the floor) or whether the sleep clip's pose offsets are never restored (idle plays lying-ish afterwards).
2. Check clip-completion handling: `loop:false` clips must hand back to idle explicitly — verify no race between the wake tween finishing and the emotion scheduler grabbing a new idle-variety clip (v2 G29 scheduler) mid-wake.
3. Check BOTH wake paths (natural + grumpy early-wake) — the grumpy path also sets `grumpyUntil` and may play a different emotion snap.

Fix spec: introduce an explicit **pose-restore step** — capture the rig's rest pose once at build; `sleep` enter = tween TO lying over 0.8 s; wake = tween lying → rest pose 0.4 s FIRST, then play `wake` from rest; idle resumes only on wake completion (scheduler suppressed during the sequence). Test: pure pose-track assertions (`goobyAnims.test.js`): after simulated wake sequence, every animated node is within ε=0.001 of rest pose at sequence end; plus CDP video of both paths for the eval.

**C12.2 Belly-rub („Bauchkraulen") bug.** Symptom: petting/tickling the belly often doesn't register or misfires. Repro: home scene → slow circular strokes over the belly ~2 s (expect pet events + purr), then fast horizontal rubs (expect tickle within 0.9 s). Investigation checklist (`home/interactions.js` gesture classifier + region mapping in the scene raycast):

1. Region classifier: verify the raycast → `'head'|'belly'|'feet'` mapping against the CURRENT weight-tier geometry — tier scaling (§C4-v2 morphs body X/Z) may shift the belly hit region so `belly` reports as `feet`/null at high/low weight. Log regions via a new `?petdebug=1` overlay (region + dx + velocity + reversal count).
2. Tickle threshold: `TICKLE_MIN_DX_PX` and the ≥ 3-direction-changes-in-900 ms rule were tuned pre-uiScale; at 320 px and at 85 % scale, natural rubs produce small dx — evaluate normalizing dx by viewport width (threshold as % of canvas width, e.g. 3.5 %) instead of raw px.
3. Circular strokes: direction-change detection is x-axis-only; circular belly rubs alternate dx sign slowly → may never hit 3 reversals. Spec: count reversals on the DOMINANT axis of the stroke (x or y), window unchanged.
4. Verify pet-vs-tickle interplay: a tickle attempt resets `petMs` (by design) — confirm slow belly circles still emit `pet` events (velocity < 600 px/s path) and that the purr sound + belly-specific reaction (giggle) actually trigger on `region === 'belly'`.

Acceptance (binding): with `?petdebug=1`, 10 natural belly rubs (mix of circular + horizontal, recorded via CDP touch synthesis at 390×844/100 %) yield ≥ 8 tickle events and 0 misfires on head/feet; pets during slow strokes fire ≥ 1/s. Same run repeated at weight 20 and weight 90 (tier extremes) and at 85 %/130 % uiScale.

### C13. Outfit catalog 20 → 42 (PO #14)

**C13.1 New slot:** `back` (anchor: spine, between the shoulder blades — the rig's existing back anchor used by the v2 cape? NO — cape stays `neck`; `back` is a NEW anchor added in `outfitAttach.js`, offset [0, 0.34, −0.18] from the body root, follows the hop flutter like the cape). `outfits.equipped.back` per §B1. Wardrobe gains a 4th slot tab; shared-renderer perf bar per §A2.

**C13.2 The 22 new items (id · slot · price · minLevel (NEW optional gate, default 1) · build source).** Prices follow the v2 curve (cosmetic-only, no stat effects):

| id | slot | price | minLevel | build |
|---|---|---|---|---|
| sombrero | hat | 260 | 6 | procedural (wide brim lathe + band) |
| pirateHat | hat | 320 | 12 | procedural tricorn + skull button |
| detectiveHat | hat | 280 | 10 | procedural deerstalker, tweed check texture (CanvasTexture) |
| beret | hat | 180 | 4 | procedural flat disc + stem |
| vikingHelm | hat | 380 | 15 | procedural dome + horns |
| pumpkinHat | hat | 240 | 8 | KayKit halloween `pumpkin_orange_small` hollowed (scaled 0.32) |
| spaceHelm | hat | 420 | 18 | procedural glass dome (transparent mat) + collar |
| chefToque | hat | 300 | 6 | procedural tall pleated toque (pairs with purblePlace) |
| aviatorGoggles | glasses | 260 | 9 | procedural twin lenses + strap |
| readingGlasses | glasses | 170 | 3 | procedural half-moon rims |
| eyepatch | glasses | 190 | 12 | procedural patch + strap (pairs with pirateHat) |
| stars3D | glasses | 310 | 14 | procedural red/cyan paper 3D glasses |
| pearlNecklace | neck | 350 | 13 | procedural bead ring (instanced spheres) |
| flowerLei | neck | 220 | 7 | procedural petal ring (pastel) |
| medalGold | neck | 400 | 16 | procedural ribbon + food-kit-style coin disc |
| winterScarf | neck | 200 | 5 | procedural chunky knit torus (bump via CanvasTexture) |
| backpackTiny | back | 280 | 6 | procedural mini backpack (box + straps) |
| balloonRed | back | 240 | 4 | procedural balloon on string (gentle physics sway) |
| propellerPack | back | 450 | 17 | procedural pack + spinning propeller (idle anim) |
| turtleShell | back | 320 | 11 | procedural dome shell, checker shading |
| fairyWings | back | 500 | 20 | procedural translucent wing planes, flutter on hop |
| surfBoard | back | 380 | 14 | procedural board (pairs with shoppingSurf; angled carry) |

Totals: hats 9→17? no — **hats 5+4(v2)+8 = 17, glasses 3+2+4 = 9, neck 3+3+4 = 10, back 0+0+6 = 6 → 42**. Real-asset usage where sensible (pumpkinHat) — most items procedural because they must FIT the procedural rig (PO's „where sensible" clause honored; fit > asset count).

**C13.3 Rules.** minLevel gating renders locked rows with the level badge (same treatment as arcade locks); prices/purchase-path (shop trips only) unchanged; `fullFit` sticker/achievement still require the 3 ORIGINAL slots (back not required — no retroactive nerf). Bell-collar/cape special behaviors unchanged. Wardrobe test grows to 42-item catalog integrity + one screenshot per slot tab at 320 px/130 %.

### C14. Save v3 (PO #15)

Fully specified in §B1 (schema, migration, validation, fuzz). Feature cross-refs: stickers (§C5), settings volumes/uiScale/devUnlocked (§C1/§C2/§C4), nougat (§C6), new counters (§C8–§C10), `outfits.equipped.back` (§C13).

---

## §D. Asset Plan (3.0) — staging → repo, budgets

Staging roots (gitignored, present on the build VM): `/workspace/asset-staging/kenney/` (211 packs + INVENTORY.md/json) and `/workspace/asset-staging/kaykit/` (10 packs, all CC0, + INVENTORY.md/json). Committed target roots: `public/assets/kenney/<slug>/` (existing) and `public/assets/kaykit/<slug>/` (NEW, §B6). All copies go through the manifest scripts (`scripts/kenney-manifest.mjs` extended; `scripts/kaykit-manifest.mjs` + `fetch-kaykit.mjs` new) — NEVER hand-copy, the manifests are the whitelist of record. Every KayKit slug copy includes its `LICENSE.txt`.

### D1. Committed today (baseline 9.6 MB)

`car-kit` 2.0 · `city-kit-commercial` 1.4 · `city-kit-roads` 0.32 · `city-kit-suburban` 0.15 · `food-kit` 1.6 · `furniture-kit` 1.2 · `impact-sounds` 1.0 · `interface-sounds` 1.2 (all 100 files) · `minigolf-kit` 0.21 · `music-jingles` 0.34 (17 of 86 files) · `nature-kit` 0.44 · `space-kit` 0.08 (MB).

### D2. KayKit copies (new root `public/assets/kaykit/`)

**D2.1 `kaykit-characters` — the NPC choice (binding): `Knight.glb`, `Mage.glb`, `Rogue_Hooded.glb`** from `KayKit-Character-Pack-Adventures-1.0/…/Characters/gltf/` — self-contained GLBs with embedded texture + all 76 clips (Idle, Walking_A, Running_A, Sit_Chair_Idle, Cheer, Interact, PickUp, Jump_Full_Long used). Why these 3: most „civilian-readable" silhouettes (Barbarian/Rogue read as fighters; skeletons are wrong-tone for shoppers/customers). ~3.62 MB each → **10.9 MB** — the single biggest line item, shared by shoppingSurf NPCs, purblePlace customers, and city-sidewalk pedestrians (§C11.1). Consumers MUST use `getSkinnedModel`/`getAnimations` (§B6).

**D2.2 `kaykit-restaurant`** (from `KayKit-Restaurant-Bits-1.0/…/Assets/gltf/`, form (b): each `.gltf` + its `.bin` + shared `restaurantbits_texture.png` once): the §C9.6 list — `kitchencounter_straight`, `kitchencounter_sink`, `oven`, `wall_orderwindow`, `wall_doorway`, `floor_kitchen`, `floor_kitchen_small`, `plate`, `plate_small`, `menu`, `chair_A`, `chair_stool`, `table_round_A`, `cuttingboard`, `crate`, `crate_buns`, `crate_cheese`, `crate_tomatoes`, `crate_carrots`, `jar_A_large`, `jar_A_medium`, `jar_C_small`, `bowl`, `fridge_A` = 24 models ≈ **0.9 MB** incl. texture.

**D2.3 `kaykit-city`** (from `KayKit-City-Builder-Bits-1.0`, + `citybits_texture.png`): `building_A/B/C/D/E/F_withoutBase`, `box_A`, `box_B`, `bench`, `streetlight`, `firehydrant`, `dumpster`, `trash_A`, `trash_B`, `bush` = 15 models ≈ **0.8 MB**. (Surf street façades + §C11.1 city dressing; KayKit roads NOT taken — city-kit-roads stays the road system.)

**D2.4 `kaykit-halloween`** (from `KayKit-Halloween-Bits-1.0`, + `halloweenbits_texture.png`): `grave_A`, `grave_B`, `gravemarker_A`, `gravemarker_B`, `gravestone`, `crypt`, `coffin_decorated`, `pumpkin_orange`, `pumpkin_orange_small`, `pumpkin_orange_jackolantern`, `pumpkin_yellow_small`, `lantern_standing`, `lantern_hanging`, `fence_gate`, `fence_seperate`, `tree_dead_large`, `tree_pine_orange_small`, `floor_dirt_grave` = 18 models ≈ **0.8 MB** (ghostHunt set + `pumpkin_orange_small` for the pumpkinHat outfit).

### D3. Kenney audio additions (into `public/assets/kenney/`)

**D3.1 `music-jingles` — complete the pack:** add the missing 68 of 85 jingle files (all of `jingles_NES00–16`, `jingles_HIT00–16`, `jingles_PIZZI00–16`, `jingles_SAX00–16`, `jingles_STEEL00–16`; `Preview.ogg` excluded) → +**1.1 MB**. Feeds the §C3.3 medley tables + stingers.

**D3.2 `ui-audio` (NEW slug, files under `audio/`):** `click1–5`, `rollover1–4`, `switch1`, `switch2`, `switch8`, `switch13`, `mouseclick1`, `mouserelease1` = 15 files ≈ **0.15 MB** (toggles §C3.1, slider ticks, secondary taps).

**D3.3 `ui-pack-sounds` (NEW slug):** `tap-a`, `tap-b`, `click-a`, `click-b`, `switch-a`, `switch-b` from `ui-pack/Sounds` = 6 files ≈ **0.07 MB** (tab switches, primary CTAs).

**D3.4 `casino-audio` (NEW slug):** `chip-lay-1..3`, `chips-collide-1..4`, `chips-stack-1..2`, `card-slide-1..3`, `card-place-1..2`, `card-shuffle` = 15 files ≈ **0.25 MB** (real coin sfx §C3.1 + memoryMatch real card sounds §C10.2).

**D3.5 Full UI-event mapping table (binding for the audio agent; complements §C3.1):**

| UI event | sfx id | file(s) |
|---|---|---|
| any button tap | `ui.tap` | `interface-sounds/click_001–005` (kept) |
| open panel/sheet | `ui.open` | `interface-sounds/open_001–004` (kept) |
| close/back | `ui.close` | `interface-sounds/close_001–004` (kept) |
| select item/tile | `ui.pick` | `interface-sounds/select_001–005` (kept) |
| error/refusal | `ui.error` | `interface-sounds/error_001–004` (kept) |
| countdown tick / GO | `ui.count` / `ui.go` | `interface-sounds/tick_*` / `confirmation_001–004` (kept, re-leveled §C3.5) |
| results „win" flourish | `ui.win` | `music-jingles/jingles_HIT16` (NEW — was synth) |
| toggle on / off | `ui.toggleOn` / `ui.toggleOff` | `ui-audio/switch1` / `ui-audio/switch2` (NEW ids) |
| slider drag tick | `ui.slider` | `ui-audio/rollover1–3` (NEW id, 80 ms throttle) |
| tab switch | `ui.tabSwitch` | `ui-pack-sounds/tap-a`, `tap-b` (NEW id) |
| primary CTA (Kaufen/Los!) | `ui.confirmBig` | `ui-pack-sounds/click-a` (NEW id) |
| coin gain / spend / fly | `coin.get` / `coin.spend` / `coin.fly` | `casino-audio/chip-lay-1..3` / `interface-sounds/drop_001–004` (kept) / `casino-audio/chips-collide-1..4` |
| card flip/match (memoryMatch) | `card.flip` / `card.match` | `casino-audio/card-slide-1..3` / `card-place-1..2` |

### D4. Kenney UI-pack sprites (NEW dir `public/assets/ui/` — CSS assets, not the assets.js loader)

From `ui-pack/PNG/Grey/Default/` + `PNG/Extra/Default/`: `button_square_border.png`, `button_square_flat.png`, `button_square_gloss.png`, `button_rectangle_border.png`, `button_rectangle_depth_flat.png`, `button_rectangle_flat.png`, `button_round_line.png`, `check_round_grey.png`, `check_round_round_circle.png`, `check_square_grey.png`, `check_square_color_checkmark.png`, `slide_horizontal_grey.png`, `slide_horizontal_grey_section.png`, `slide_horizontal_color.png`, `slide_horizontal_color_section.png`, `slide_hangle.png` (knob), `star.png`, `star_outline.png`, `arrow_basic_e.png`, `arrow_basic_w.png` + the same 6 button/check sprites from `Blue` and `Red` for state accents = **~34 files ≈ 0.30 MB**. Referenced from `styles.css` via `border-image`/`background` (§C11.2); NOT keyed through `core/assets.js`.

### D5. Kenney 3D additions (existing root)

- **`food-kit` +9:** `cake`, `cake-birthday`, `cupcake`, `muffin`, `whipped-cream`, `strawberry`, `chocolate`, `donut-sprinkles`, `honey` (nutella jar §C6.1) ≈ **0.10 MB**.
- **`toy-car-kit` (NEW slug) — toyRacer set (20):** `track-narrow-straight`, `track-narrow-curve`, `track-narrow-corner-small`, `track-narrow-corner-large`, `track-narrow-straight-bump-up`, `track-narrow-straight-bump-down`, `track-narrow-straight-hill-beginning`, `track-narrow-straight-hill-end`, `track-narrow-looping`, `gate`, `gate-finish`, `item-box`, `item-banana`, `item-cone`, `item-coin-gold`, `item-coin-silver`, `item-coin-bronze`, `supports`, `supports-clamp`, `smoke` ≈ **0.7 MB**.
- **`watercraft-kit` (NEW slug) — harborHopper set (6):** `boat-fishing-small`, `boat-row-small`, `boat-sail-a`, `buoy`, `buoy-flag`, `arrow-standing` ≈ **0.35 MB** (piers/crates procedural + kaykit-city boxes).
- **`survival-kit` (NEW slug):** `bucket` (golden watering can §C11.1) ≈ **0.03 MB**.
- **`nature-kit` +8:** `bench`, `fence_gate`, `stump_round`, `flower_purpleA`, `flower_redA`, `plant_bush`, `pot_large`, `rock_smallFlatA` ≈ **0.12 MB** (garden dressing §C11.1).
- **`furniture-kit` +8:** `kitchenCoffeeMachine`, `books`, `lampSquareCeiling`, `plantSmall1`, `plantSmall2`, `bathroomMirror`, `toaster`, `kitchenBar` ≈ **0.15 MB** (room dressing §C11.1). *(Exact availability of each name is verified by the manifest script against staging at copy time — any miss is substituted from the same pack and logged in the PR, never silently dropped.)*

### D6. AI sticker art (coordinator-generated, pre-wave)

`public/assets/stickers/<id>.png` × 28 (§C5.1 ids), 512×512, ≤ 150 KB each (coordinator re-encodes with `ffmpeg -i in.png -vf scale=512:512 out.png` + pngquant-style budget if needed; ffmpeg is on the VM). Budget cap **4.2 MB**, expected ≈ 3.0 MB. Gate: `test/stickers.test.js` (§C5.2).

### D7. Size ledger (committed-repo budget ≤ 60 MB)

| line | Δ MB |
|---|---:|
| baseline (committed today) | 9.6 |
| kaykit-characters (3 GLB) | 10.9 |
| kaykit-restaurant (24) | 0.9 |
| kaykit-city (15) | 0.8 |
| kaykit-halloween (18) | 0.8 |
| music-jingles completion (+68) | 1.1 |
| ui-audio + ui-pack-sounds + casino-audio (36 ogg) | 0.5 |
| UI-pack sprites (34 png) | 0.3 |
| food-kit/toy-car/watercraft/survival/nature/furniture 3D | 1.5 |
| AI stickers (28 png) | ≤ 4.2 |
| **total** | **≈ 30.6 MB** |

Headroom ≈ 29 MB — the budget guard: a new `test/assetBudget.test.js` sums `public/assets/**` at test time and fails > 60 MB (and warns > 45 MB). Per-feature caps (binding): characters ≤ 11 MB, stickers ≤ 4.2 MB, any single new minigame's committed set ≤ 1.2 MB, UI reskin ≤ 0.5 MB.

### D8. Pipeline mechanics recap (for the wave-1 agent)

1. Extend `scripts/kenney-manifest.mjs` with the D3/D5 file lists (slug → files, same format as today); run `fetch-kenney.mjs` against staging (it already prefers local staging over network — verify, else add a `--staging <path>` source flag).
2. New `scripts/kaykit-manifest.mjs` (slug → `{ source: '<staging pack path>', files: [...] }`) + `scripts/fetch-kaykit.mjs`: copy, then parse each copied `.gltf` and assert every `buffers[].uri` / `images[].uri` exists next to it; copy `LICENSE.txt` per slug.
3. `core/assets.js` `PACK_FORMATS` additions: `kaykit-characters → {root:'kaykit', ext:'glb'}`, `kaykit-restaurant/kaykit-city/kaykit-halloween → {root:'kaykit', ext:'gltf'}`, `ui-audio/ui-pack-sounds/casino-audio → audio-pack slugs` (extend `AUDIO_PACK_SLUGS`), `toy-car-kit/watercraft-kit/survival-kit → default kenney/glb`.
4. `test/assets.test.js` grows: PACK_FORMATS resolution, gltf-dep verification fixture, `getAnimations`/`getSkinnedModel` contracts (stubbed loader), asset-budget test (§D7).

---

*End of §A–§D (plan agent 1). Plan agent 2 appends §E (build waves & agent prompts), §F (eval plan), §G (coordinator runbook) below this line. Anchor names for agent 2: workstream ids W-* (§A1), acceptance gates (§A2), schema §B1, audio §B2/§C3, pipeline §B6/§D8, flagship specs §C8/§C9, game lineup §C10.1, depth table §C10.2, sticker gate §C5.2/§D6, size ledger §D7.*





