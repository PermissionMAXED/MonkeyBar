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






# §E. Team Build Waves & Agent Prompts (3.0) — plan agent 2

**How to use this section (coordinator):** 3.0 is built by **18 build agents (V3/G31 … V3/G48) in 4 waves** (wave 1 = 1a solo + 1b ×4 · wave 2 = 5 · wave 3 = 5 · wave 4 = 3) plus **4 team-eval agents (V3/E-CAKE, V3/E-SURF, V3/E-DRIVE, V3/E-GAMES)** that run *inside* the build phase (§E0.1-12), and the 20 final evals of §F. Within a wave file ownership is strictly disjoint (OWNS/DO-NOT-TOUCH lists below; the only shared files are the append-only ones governed by §E0.1-6 and the ownership timelines §E0.1-4/-5). Wave N+1 may rely on wave N being merged and green. To launch a build agent, forward **verbatim, as one message**: (1) the agent's block from §E2–§E6, then (2) the COMMON RULES text §E0.2 — nothing else. To launch a team eval, forward its §E7 block + the §E7.0 preamble. Each block carries a **model tag** (`fable` = deep/complex work, `solfast` = fast content/porting/audit work) — launch the agent on that model. Between waves run the §G checkpoints; the coordinator generates the 28 sticker PNGs BEFORE wave 1 (§G0 gate — hard prerequisite for G34).

## E0. Shared conventions for all 3.0 build agents

### E0.1 Design decisions made here (binding, referenced by the prompts)

1. **Ids & teams.** Build agents are `V3/G31 … V3/G48` (sequential across waves). Wave 2 is organized as flagship teams: Team CAKE = G36 + eval V3/E-CAKE; Team SURF = G37 (game) + G38 (travel integration) + eval V3/E-SURF; Team DRIVE = G39 + eval V3/E-DRIVE; G40 (outfits) rides wave 2 without its own eval (covered by V3/E-GAMES + §F). Wave 3's batch eval is V3/E-GAMES.
2. **Strings stay conflict-free via per-feature modules (v2 §E0.1-1 carried forward).** `src/data/strings.js` is edited exactly ONCE in wave 1b (by G34): it gains static imports + spreads of **17 new modules** under `src/data/strings/` (after all v2 spreads): `v3-core.js` (G34), `v3-stickers.js` (G34), `v3-audio.js` (G32), `v3-ux.js` (G33), `v3-dev.js` (G33 — §C4.2 names it), `v3-nutella.js` (G35), `v3-cake.js` (G36), `v3-surf.js` (G37), `v3-travel.js` (G38), `v3-drive.js` (G39), `v3-outfits.js` (G40), `v3-games-f.js` (G41), `v3-games-g.js` (G42), `v3-depth-a.js` (G43), `v3-depth-b.js` (G44), `v3-depth-c.js` (G45), `v3-polish.js` (G48). G34 creates all 17 (16 as `{EN:{},DE:{}}` stubs with an ownership header naming the owning agent). Add keys ONLY to your module, always EN + DE. `strings.js` and every `v2-*.js` module stay frozen. G46/G47 own no module (asset/CSS work needs no strings; if one genuinely does, report it — do not edit a foreign module).
3. **`src/data/constants.js` is re-opened exactly once (§B8): G34, wave 1b, ONE marked `// V3/G34` region** containing ONLY: `SAVE.VERSION: 3`, 6 new `COIN_TABLE` rows (`shoppingSurf 40/5/34`, `purblePlace 5/5/30`, `toyRacer 6/5/30`, `ghostHunt 4/4/28`, `rocketRescue 5/4/28`, `harborHopper 5/4/30` — §C8.5/§C9.5/§C10.1), and 6 `UNLOCKS.MINIGAMES` levels (`shoppingSurf L5, purblePlace L6, toyRacer L15, ghostHunt L16, rocketRescue L18, harborHopper L20`). Afterwards the file is frozen again. Every other 3.0 number (medley tables, surf/cake tuning, nougat numbers, sticker defs, scale/volume mapping, PIECE_PORTS) lives as exported frozen consts inside the owning module (v2 §E0.1-2 pattern).
4. **`src/audio/sfxMap.js` ownership timeline.** Wave 1b: **G32 exclusive** (it reworks the whole file: bus-routing kinds, §C3.1 sample sweep, §C3.5/§B2.5 volume renormalization) — other wave-1b agents call only ids that already exist (add a `// V3/G32 upgrades` comment at the call site if the sound is a placeholder). ONE exception: if G32's map hasn't landed when G33 commits, G33 may append ONE marked block mapping ONLY its §D3.5 UI ids (`ui.toggleOn/Off`, `ui.slider`, `ui.tabSwitch`, `ui.confirmBig`) to the exact §D3.5 files (verify-after-commit; G32 preserves/consolidates the block — both write the same §D3.5-verbatim mappings, so order doesn't matter). Waves 2–4: back to append-only — ONE marked block per agent at end-of-file, which may only map new ids to **(a)** sample keys committed by G31 (§D3/§D2 files) or **(b)** existing synth recipe names. NO new synth recipes (the §C3.1 bespoke-juice whitelist already exists; a genuinely new bespoke need goes in your report for the coordinator).
5. **`src/ui/styles.css` ownership timeline.** Wave 1b: **G33 exclusive** (rem sweep §B3 + safe-area vars §B9 + scale rules — a whole-file pass). Waves 2–3: append-only ONE marked block per agent at end-of-file, **rem-based declarations only** (G33's `scripts/px-audit.mjs` gate enforces the exemption allow-list). Wave 4: **G47 exclusive** (9-slice reskin §C11.2) — G46/G48 use component-injected CSS strings instead.
6. **Append-only shared files + verify protocol (v2 §E0.1-5 carried forward):** `src/main.js` (marked block at the anchor named in your prompt), `src/dev/harness.js`, `src/ui/icons.js`, plus `sfxMap.js`/`styles.css` per their timelines. Protocol: make these edits **immediately before committing**; after committing run `git -C /workspace show HEAD:GOOBY/src/<path> | grep "V3/G<id>"` — if your block is missing (concurrent writer won), re-apply and commit again. Any other foreign-file edit your block explicitly grants must be an additive marked one-liner (`// V3/G<id>: <why> (§<ref>)`).
7. **Sticker hooks are decoupled via a store event.** The stickerBook engine (G34) subscribes to a new **runtime-only** store event `'stickerHook'` (payload `{id}`) in addition to the achievements-style store events/counters. Hook firers — G35 (`grumpyWake`, `rainCanopy`, `nightStars`, `towed` per §C5.4) and anyone later — just `store.emit('stickerHook', {id})` (match the emit API in `core/store.js`); no same-wave module imports needed. G34 documents the exact call in its report.
8. **What's-new 3.0 flag (mirrors v2 §E0.1-6):** G34's `migrations[2]` sets `onboarding.whatsNew3Seen = false` for migrated saves; fresh `defaultState()` sets `true`. G48 builds the one-time panel in wave 4.
9. **`src/minigames/registry.js` is NEVER edited** (import.meta.glob auto-discovery). `src/data/minigames.js` is edited exactly once — G34 adds the 6 new metadata rows (id/titleKey/minLevel/energy; title keys live in `v3-core.js`).
10. **Skinned NPCs (binding §B6):** consumers use `assets.getSkinnedModel(key)` (SkeletonUtils.clone) + `assets.getAnimations(key)` — never `getModel().clone()` for the 3 KayKit characters. Per-scene caps: 1 actively-animated skinned NPC (shoppingSurf §C8.3, purblePlace 1 walking + 2 seated frozen §C9.7).
11. **Same-wave runtime dependencies degrade gracefully.** Wave-1b agents code against the §B contracts verbatim (they are exact); where one needs another same-wave module at RUNTIME (e.g. devPanel's sticker card → stickerBook), use a lazy dynamic import with feature-detect + a "not built yet" fallback and note it in the report (v2-proven pattern).
12. **Team eval → fix loop (binding):** each team eval launches immediately after its team's build commit(s) merge and the §G wave checkpoint is green. Evals are READ-ONLY and file findings `[P0|P1|P2]` with repro + evidence. The coordinator **resumes the team's build agent** (same conversation) with the P0/P1 findings verbatim for a fix round; the eval's re-check (or the coordinator's repro of the finding's steps) must pass before the next wave launches. P2s may be deferred to the §F loop with justification.
13. **cityDrive pure-logic ruling (§A2 clarification):** cityDrive's pure surface is `city/cityBuilder.js` + `city/carController.js` (already node-tested); G39 extends those tests. A `cityDrive.logic.js` sibling is created only if the audit finds untested pure logic inline in `cityDrive.js`.
14. **Gesture-tuning consts (§C12.2 vs the constants freeze):** G35 implements the viewport-normalized thresholds as exported frozen consts inside `home/interactions.js` (module-local pattern), superseding the legacy px constants in `constants.js` (leave them in place, reference the supersession in a comment + report). `constants.js` itself is not edited.
15. **Per-agent evidence dirs:** build agents `/tmp/gooby-v3-g<id>/`, team evals `/tmp/gooby-v3-e-<team>/`, final evals `/tmp/gooby-v3-e<n>/`.

### E0.2 COMMON RULES FOR ALL V3 BUILD AGENTS (relay this text verbatim after every agent block)

> **Product context.** GOOBY (in `/workspace/GOOBY`; Vite 6 + three ^0.170 + vanilla-ESM mobile web game, Capacitor 7 iOS wrap) is a finished, eval-hardened Pou/Talking-Tom-class virtual pet: a fat cream rabbit you feed, wash, and play with across 21 arcade minigames, a real-time garden, a sickness/vet/weight sim, daily quests, collections, and a drivable low-poly city — 873 green node:test tests, ESLint 9 clean, green unsigned-.ipa CI, bilingual EN+DE, portrait 320–430 px. GOOBY 3.0 („ECHT & GROSS") is the „real game" release: real Kenney/KayKit assets + real audio everywhere (file-based jingle medleys, sampled UI sounds), two flagship minigames (Shopping Surf runner + Purble-Place-style Cake Shop) plus 4 more deep games (→ 27 total), an AI-illustrated 28-sticker Gooby sticker book, Nutella + the Nougatschleuse kitchen gag, a driving overhaul, 42 outfits with a new back slot, UI scaling (85–130 %), 5 volume sliders, a hidden dev panel, iPhone safe-area correctness, and a lossless save v3. You are one build agent in a coordinated wave; other agents are editing OTHER files concurrently in this same checkout — file discipline is critical.
>
> **Mandatory first steps, in order:** (1) read `/workspace/GOOBY/AGENTS.md` fully (conventions + the VM/CDP testing recipe — SwiftShader is slow and there is NO audio device: verify audio via `audio.getStats()` + console logs); (2) read the `GOOBY/PLAN3.md` sections listed in your block, plus §A2 (Definition of 3.0) and §A3 (invariants) — PLAN3.md is your binding spec; PLAN.md §E contracts and PLAN2.md v2 numbers remain binding underneath it; (3) minigame agents: also read PLAN.md §E8, PLAN2.md §C1 shared rules, and skim `src/minigames/games/carrotCatch.js`+`.logic.js` (the shipped convention incl. `?autoplay=1`) plus `framework.js` (the `onEnd({score, coins, meta})` shape — `coins` is the coinsOverride); (4) read every existing file you will modify BEFORE editing it.
>
> **Hard rules.** Git root is `/workspace`; never touch `/workspace/MONKEYBAR` or files outside your OWNS/marked-edit lists. CRLF line endings in new/edited files. Vanilla ESM + JSDoc; no TypeScript, no new deps, no new Capacitor pods. `npm run lint` must stay clean. Every user-facing string via `t(key)` with BOTH EN and DE entries, added ONLY in your assigned `src/data/strings/v3-*.js` module (§E0.1-2) — never edit `strings.js`, `v2-*.js`, or another agent's module. `src/data/constants.js` is read-only (G34's single wave-1 block excepted, §E0.1-3); tuning numbers are exported frozen consts in the owning module / `.logic.js`. Pure modules (`systems/`, `data/`, `*.logic.js`) import no three.js/DOM. ALL coin movement through `systems/economy.js`. Every `audio.play('<id>')` id you introduce must be mapped in `sfxMap.js` in the same commit under the §E0.1-4 timeline rules (`test/onboarding.test.js` fails on unmapped ids). Gooby himself stays 100 % procedural (§A3). Shared-append files: §E0.1-6 protocol (one marked block, appended immediately before commit, verified after commit, re-applied if lost). v1/v2 game rules, economy numbers, and the 873 existing tests stay intact — existing tests may be *edited* only where a §C row legitimately changed a spec, never deleted to pass.
>
> **Verification standard (ALL of it, before you commit):** `npm test` fully green (run from `/workspace/GOOBY`), `npm run lint` clean, `npm run build` green. Runtime proof over CDP for every feature you shipped: start YOUR dev server `npx vite --port <your vite port> --strictPort --host` (never 5174 — a long-lived tmux server owns it), drive real-time headless Chrome via `chromium --headless=new --remote-debugging-port=<your CDP port>` per the AGENTS.md recipe, and save screenshots + JSON state dumps to `/tmp/gooby-v3-g<id>/` (descriptive snake_case names). **Layout matrix for any NEW or CHANGED UI surface:** widths 320/390/430 × UI scales 85/100/130 % × `?lang=en`+`?lang=de` (set scale via `__gooby.store.set('settings.uiScale', N)` or the `?uiscale=` harness param once G33's wave lands; before that, note it and run at 100 %), zero clipped/overlapping text, no horizontal scroll, tap targets ≥ 44 real px; if you moved/added FIXED-position chrome, repeat the worst combo with the dev-panel fake-notch on (§B9). **Minigame agents additionally:** 5 `?autoplay=1` completions per game with a raw-score + payout table — every payout inside the game's §C-row (coin table §E0.1-3), typicals near the row's design value, energy cost exact, first-play ×2 once/day; bot averages meet your block's bar. When done, kill every process YOU started by PID — never `pkill -f`, never the tmux 5174 server.
>
> **Commit protocol:** `git -C /workspace add <explicit paths only>` (never `-A`), one commit per logical unit, message `GOOBY V3/G<id>: <summary>`. NEVER push. On `.git/index.lock` wait 5 s and retry (up to 10×) — other agents commit concurrently.
>
> **Report back (compact, in this order):** ① shipped vs mission (one line per feature); ② contracts/APIs exposed for later agents (JSDoc signatures); ③ evidence inventory in `/tmp/gooby-v3-g<id>/` + the 3–6 most probative artifacts named; ④ tables (autoplay score/payout runs; tests before→after; layout-matrix grid); ⑤ deferred items / requests for the coordinator (be explicit); ⑥ commit hash(es).

### E0.3 Ports (per concurrent slot; also §G1)

| slot | vite port | CDP port |
|---|---|---|
| A | 5175 | 9221 |
| B | 5176 | 9222 |
| C | 5177 | 9223 |
| D | 5178 | 9224 |
| E | 5179 | 9225 |
| F | 5180 | 9226 |

Slot = the agent's position in its wave listing. Port 5174/tmux (`gooby-dev-server`) belongs to the coordinator. Team evals reuse their team's slot; final evals map `((n−1) mod 6)`.

### E0.4 Roster & §A2 coverage map

| id | mission | model | wave | slot | key files (owned) |
|---|---|---|---|---|---|
| G31 | asset pipeline: all §D copies, KayKit loader, budgets | fable | 1a | A | scripts/kaykit-*.mjs, kenney-manifest.mjs, core/assets.js, public/assets/**, test/assets*.test.js |
| G32 | audio engine 2.0: buses, sliders backend, medleys, UI-sample sweep, loudness | fable | 1b | B | audio/audio.js, audio/musicDirector.js, audio/sfxMap.js, audio/loudness.json, scripts/audio-loudness.mjs, test/audioCoverage.test.js |
| G33 | core UX: UI scale + rem sweep, settings rework, dev panel, safe-areas | fable | 1b | C | ui/styles.css, ui/settingsScreen.js, ui/devPanel.js, scripts/px-audit.mjs, index.html |
| G34 | save v3 + sticker book + data spine (constants block, 6 game rows) | fable | 1b | D | core/save.js, data/{constants(block),stickers,minigames,achievements}.js, systems/stickerBook.js, ui/albumScreen.js, strings.js spread |
| G35 | anim fixes (wake/belly-rub) + Nutella + Nougatschleuse + sticker hooks | fable | 1b | E | character/goobyAnims.js, home/interactions.js, home/roomManager.js, systems/nougat.logic.js, data/foods.js |
| G36 | Team CAKE: purblePlace flagship | fable | 2 | A | games/purblePlace.js+.logic.js, test/purblePlace.test.js |
| G37 | Team SURF: shoppingSurf game (arcade + travel behavior) | fable | 2 | B | games/shoppingSurf.js+.logic.js, test/shoppingSurf.test.js |
| G38 | Team SURF: travel integration (door sheet, shopTrip, rewards) | fable | 2 | C | systems/shopTrip.js, door-sheet UI, test/shopTrip.test.js |
| G39 | Team DRIVE: §C7 overhaul (road ports + feel) | fable | 2 | D | city/cityBuilder.js, city/carController.js, test/cityRoads.test.js |
| G40 | outfit expansion 20→42 + back slot | solfast | 2 | E | character/outfitAttach.js, data/outfits.js, ui/wardrobeScreen.js |
| G41 | new games: toyRacer + ghostHunt | fable | 3 | A | games/toyRacer*, games/ghostHunt*, test/gamesV3a.test.js |
| G42 | new games: rocketRescue + harborHopper | fable | 3 | B | games/rocketRescue*, games/harborHopper*, test/gamesV3b.test.js |
| G43 | depth+audit: carrotCatch, bunnyHop, carrotGuard, memoryMatch, runner, basketBounce, pancakeTower | solfast | 3 | C | those 7 games' files, test/minigamesA/B.test.js |
| G44 | depth+audit: danceParty, fishingPond, bubblePop, trampoline, starHopper, pipeFlow, deliveryRush, miniGolf | solfast | 3 | D | those 8 games' files, test/minigamesC/E.test.js |
| G45 | depth+audit: goobySays, gardenRush, burgerBuild, veggieChop, goalieGooby (+ their §C11.1 prop swaps) | solfast | 3 | E | those 5 games' files, test/minigamesD.test.js |
| G46 | real-asset replacement sweep (§C11.1 minus G45's rows) | solfast | 4 | A | home/decor.js, home/rooms/*, shop-interior scene bits |
| G47 | UI reskin (Kenney ui-pack 9-slice, §C11.2) | fable | 4 | B | ui/styles.css (exclusive this wave) |
| G48 | integration/ship: README/AGENTS 3.0, whatsNew 3.0, NEU ribbons, MARKETING_VERSION 3.0.0, sweep | solfast | 4 | C | README.md, AGENTS.md, ui/whatsNew.js, ui/onboarding.js, ios/App/App.xcodeproj/project.pbxproj |

**§A2 coverage:** 27 games → 21 shipping + G36/G37/G41/G42 (impl) + G34 (rows/unlocks); 42 outfits + back slot → G40 (+G34 migration key); 28 stickers → coordinator PNGs (§G0) + G34 (engine/catalog/UI) + G35 (hooks); 5 volume sliders → G32 (backend) + G33 (UI) + G34 (schema); UI scale → G33 (+G34 schema); dev panel → G33; 2 travel methods → G37+G38; Nutella/Nougatschleuse → G35; real-audio floors + medleys + danceParty exception → G32 (+ sample-backed ids from every game agent); layout matrix/safe-areas → G33 foundations + every agent's matrix + V3-E9; tests ≥ 1050 → all; save v3 lossless + fuzz → G34; perf/asset budgets → G31 (budget test) + G33 (overlay) + per-agent caps + V3-E10; i18n → §E0.1-2; driving → G39; asset sweep/reskin → G46/G47 (+G45 rows); anim bugs → G35; whatsNew/docs/version → G48.

---

## E1. Wave overview

| wave | agents (slot) | theme | gate before launch |
|---|---|---|---|
| 1a | G31 (A) | asset pipeline — every §D file committed + loader contracts | §G0 (stickers generated, staging present) |
| 1b | G32 (B) audio engine · G33 (C) core UX · G34 (D) save v3 + stickers + data spine · G35 (E) anim fixes + Nutella | foundations; game boots unchanged for v2 saves except new settings/slices | CP-W1a (G31 merged, suite green) |
| 2 | G36 (A) purblePlace · G37 (B) shoppingSurf game · G38 (C) surf travel · G39 (D) driving · G40 (E) outfits | flagship teams + outfits | CP-W1 + push + CI green |
| 2-eval | V3/E-CAKE (A) · V3/E-SURF (B) · V3/E-DRIVE (D) | per-team evals → fix rounds (§E0.1-12) | CP-W2 |
| 3 | G41 (A) toyRacer/ghostHunt · G42 (B) rocketRescue/harborHopper · G43 (C) depth A · G44 (D) depth B · G45 (E) depth C | 27 games complete; depth/bug pass over the 21 | team fixes merged + push + CI green |
| 3-eval | V3/E-GAMES (A) | batch eval (4 new games + depth rows + outfits) → fix round | CP-W3 |
| 4 | G46 (A) asset sweep · G47 (B) UI reskin · G48 (C) integration/ship | real-asset & reskin polish, docs, version 3.0.0 | wave-3 fixes merged + push + CI green |

## E2. WAVE 1a — asset pipeline (launch G31 alone)

### V3/G31 — asset pipeline 3.0: KayKit root, Kenney additions, loader contracts (slot A) — model: **fable**

> You are build agent V3/G31 for GOOBY 3.0 „ECHT & GROSS". GOOBY commits only whitelist-manifested CC0 assets; 3.0 adds a second asset root (KayKit `.gltf`/`.glb` packs incl. 3 rigged characters), completes the music-jingles pack, and adds UI/casino audio + ui-pack sprites + new 3D kits. **Your mission:** land EVERY §D2–§D5 file in the repo via manifest scripts, extend `core/assets.js` with the §B6 loader contracts (PACK_FORMATS, animations, skinned cloning), and harden the asset/budget tests — so every later agent finds every asset on disk and loads it the right way.
>
> **Read (after AGENTS.md):** PLAN3.md §B6 (ALL — your core spec), §D (ALL — §D2–§D5 are your exact copy lists, §D7 budget, §D8 mechanics recap), §A2 perf bullet. Then read `scripts/kenney-manifest.mjs`, `scripts/fetch-kenney.mjs`, `src/core/assets.js` (fully), `test/assets.test.js`. Staging roots: `/workspace/asset-staging/kenney/` and `/workspace/asset-staging/kaykit/` (each has INVENTORY.md/json — consult them to resolve exact paths/casing; §D5's availability note applies: a missing name is substituted from the same pack and logged, never silently dropped).
>
> **OWNS (create):** `scripts/kaykit-manifest.mjs`, `scripts/fetch-kaykit.mjs` (§D8-2: copy per slug from staging, parse each copied `.gltf` and assert every `buffers[].uri`/`images[].uri` landed next to it, copy `LICENSE.txt` per slug, fail loudly on misses), `test/assetBudget.test.js` (§D7: sums `public/assets/**` — fail > 60 MB, warn > 45 MB; per-feature caps as sub-asserts: kaykit-characters ≤ 11 MB, stickers dir ≤ 4.2 MB, ui sprites ≤ 0.5 MB). **(modify):** `scripts/kenney-manifest.mjs` (append §D3 audio slugs `ui-audio`/`ui-pack-sounds`/`casino-audio` + the 68 music-jingles completions + §D5 3D additions `food-kit +9`/`toy-car-kit`/`watercraft-kit`/`survival-kit`/`nature-kit +8`/`furniture-kit +8`), `scripts/fetch-kenney.mjs` (only if a staging-source flag is genuinely needed — §D8-1), `src/core/assets.js` (§B6: frozen `PACK_FORMATS` table + `getModelUrl` consult per §D8-3 incl. `AUDIO_PACK_SLUGS` extension; `modelCache` stores `{scene, animations}`; `getAnimations(key)`; `getSkinnedModel(key)` via `three/addons/utils/SkeletonUtils.js` — plain clone is forbidden for skinned models, JSDoc that), `public/assets/kenney/**` + `public/assets/kaykit/**` (fetched files + licenses), `public/assets/ui/` (§D4's ~34 ui-pack sprites — CSS assets, listed in the kenney manifest for provenance but NOT keyed through assets.js), `test/assets.test.js` (extend per §D8-4: PACK_FORMATS resolution incl. every §D2 slug, gltf-dep verification fixture, getAnimations/getSkinnedModel contracts with a stubbed loader, existing checks intact).
> **DO NOT TOUCH:** anything under `src/` except `core/assets.js`; no `sfxMap.js` (G32 maps the new audio next wave-step), no strings, no constants, no `public/assets/stickers/` (coordinator-owned §G0).
>
> **Contracts exposed (document in report):** key format `'<slug>/<name>'` for both roots (e.g. `'kaykit-restaurant/oven'`, `'kaykit-characters/Knight'`, `'toy-car-kit/track-narrow-looping'`, audio `'ui-audio/switch1'` via `getAudioUrl`); `getAnimations`/`getSkinnedModel` signatures; the committed-file inventory per slug (exact list — game agents code against it).
> **Verification specifics:** `npm test`/lint/build green. CDP: load one model per NEW slug + `getSkinnedModel('kaykit-characters/Knight')` playing `Walking_A` via `getAnimations` (screenshot + `renderer.info` + console clean → `/tmp/gooby-v3-g31/`); a `.gltf`-form model (e.g. `kaykit-restaurant/oven`) renders with its shared texture resolved; `getAudioUrl('casino-audio/chip-lay-1')` fetches 200. Print the §D7 size ledger ACTUAL vs estimate in your report. No UI → no layout matrix.
> **Dependencies:** none (runs alone as wave 1a). **Ports:** vite 5175 / CDP 9221.

## E3. WAVE 1b — foundations (launch G32, G33, G34, G35 in parallel after CP-W1a)

### V3/G32 — audio engine 2.0: buses, sliders backend, medley director, sample sweep, loudness (slot B) — model: **fable**

> You are build agent V3/G32 for GOOBY 3.0 „ECHT & GROSS". GOOBY's audio is a WebAudio manager (`audio/audio.js`) with a single sfx path, synth UI bleeps, and one synth music track; 3.0 rebuilds it: 4 sub-buses under master, 5 volume sliders (backend), decoded-buffer sample playback, file-based jingle-medley music per context, a real-file UI/economy sound sweep, and a loudness-normalization pass. **Your mission:** implement §B2 + §C3 exactly; you own every audio file in `src/audio/`.
>
> **Read (after AGENTS.md):** PLAN3.md §B2 (ALL — bus graph, gain mapping, buffer cache, medley scheduler, loudness), §C2 (slider semantics/defaults/mute booleans — the UI rows are G33's, your backend serves them), §C3 (ALL — §C3.1 sweep table, §C3.3 medley compositions + stingers, §C3.4 danceParty ruling, §C3.5 offender table), §D3 (committed files incl. the §D3.5 UI-event mapping — binding), §A2 real-audio coverage bullets, §E0.1-4 (you own sfxMap exclusively this wave). Then read `src/audio/audio.js` (fully), `src/audio/sfxMap.js` (fully), `src/audio/goobyVoice.js`, `src/minigames/framework.js` (results-jingle call site + preload step), `src/data/constants.js` DANCE block, `test/audioV2.test.js` + `test/onboarding.test.js` (unmapped-id gate).
>
> **OWNS (create):** `src/audio/musicDirector.js` (§B2.4: 3.2 s bar grid, 16-bar phrases, 150 ms equal-power crossfades, mulberry32 seeded shuffle with no-repeat-within-8-bars and fixed rests, −26 dBFS sine glue bed per §C3.3 root notes, `setContext('home'|'garden'|'arcade'|'city'|'shop'|null)` with 800 ms crossfade; composition tables per §C3.3 as frozen consts; airtight mute: ZERO source nodes created while `settings.music === false` — v2 FIX-B rule extends here), `scripts/audio-loudness.mjs` (§B2.5: ffmpeg RMS per committed ogg → `src/audio/loudness.json`, committed), `src/audio/loudness.json`, `src/data/strings/v3-audio.js` (only if you surface strings — likely none; keep the stub otherwise), `test/audioCoverage.test.js` (§A2: 100 % of `ui.*`+`coin.*` sample-backed; ≥ 65 % of all non-voice/non-loop ids sample-backed; every sample key has a loudness.json entry; medley composition tables reference only committed jingle files). **(modify):** `src/audio/audio.js` (§B2.1 bus graph master←{sfx,music,voice,ambience} with kind-based routing; §B2.2 `gain=(v/100)^2`, master ×0.9 base, boolean quick-mutes: sfx-bool mutes sfx+voice, music-bool mutes music+ambience incl. medley teardown per §C2.3; live store-follow of `settings.volumes`; §B2.3 `preloadSamples(keys)` decoded-buffer LRU cache ≤ 6 MB; `getStats()` extended: per-bus gains, active medley context + node counts, master peak dBFS for the §C4.2 overlay), `src/audio/sfxMap.js` (EXCLUSIVE this wave: §C3.1 sample sweep + §D3.5 mapping table verbatim — new ids `ui.toggleOn/off`, `ui.slider` (80 ms throttle), `ui.tabSwitch`, `ui.confirmBig`, `ui.win`→HIT16, `coin.get/fly`→casino, `card.flip/match`, `jump`, pop family → impacts; §C3.5 offender volumes; def kinds route buses per §B2.1; synth whitelist §C3.1 stays), `src/minigames/framework.js` (marked block: per-game optional `sfx: []` preload in the existing asset-preload step; results stingers per §C3.3 — best/normal/zero → HIT15/HIT10/HIT08), one-liner marked context hooks (§E0.1-6 verify protocol — G35 edits roomManager/shopScreen concurrently): `home/roomManager.js` (home/garden on room enter), `ui/arcadeScreen.js`, `ui/shopScreen.js`, the city scene entry (locate: cityDrive/shopTrip drive scene), `src/minigames/games/danceParty.js` (ONE-liner: `dance.tierUp` also fires `jingles_HIT00` accent on sfx bus §C3.4 — the synth track/chart contract untouched); `test/audioV2.test.js` (extend: volume mapping `volumeGain(80)===0.64`, routing kinds, mute-during-medley zero-node probe, LRU eviction, medley scheduler math — bar schedule determinism per seed, no-repeat window, rest positions).
> **DO NOT TOUCH:** `ui/settingsScreen.js` + `styles.css` (G33), `core/save.js`/`constants.js` (G34), `home/interactions.js` (G35), `goobyVoice.js` recipes (voice stays synth — read-only). danceParty beyond the one-liner.
>
> **Contracts exposed:** `audio.getStats()` extended shape (G33's dev-panel overlay + evals consume — document exactly); `musicDirector.setContext(ctx)`; `audio.previewBus(bus)` (slider-release blips per §C2.2: ui.pick / 0.5 s jingle / gooby.squeak / 1 s rain fade — G33 calls this); `audio.preloadSamples(keys)` + the per-game `sfx: []` export convention (game agents use it).
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v3-g32/`: `getStats()` dumps proving ① each of the 5 medley contexts active with ≥ 1 AudioBufferSourceNode after navigating home/garden/arcade/city/shop (`medley:<ctx>`), ② danceParty still on the synth sequencer with `getMusicTime()` advancing, ③ slider math: set volumes via console → per-bus gains match `(v/100)^2` (master ×0.9), ④ mute toggles: music off during a medley → zero new nodes over 10 s + teardown, ⑤ ≥ 12 distinct NEW sample-backed ids firing (ui.win, coin.get, ui.toggleOn…) with buffer-cache hits, ⑥ coverage numbers from your test (print the exact ratio). No new UI → no layout matrix.
> **Dependencies:** wave 1a (G31's committed audio files — hard). **Ports:** vite 5176 / CDP 9222.

### V3/G33 — core UX: UI scale + rem sweep, settings 3.0, hidden dev panel, safe-areas (slot C) — model: **fable**

> You are build agent V3/G33 for GOOBY 3.0 „ECHT & GROSS". GOOBY's DOM UI is px-fixed, has a compact settings screen, and ignores iPhone safe-area insets; 3.0 adds a 4-step UI scale, a 5-slider audio settings block, a hidden dev panel behind 5 taps on the language „Auto" segment, and safe-area correctness. **Your mission:** implement §B3 + §B4 + §B9 + §C1 + §C2.1 + §C4 exactly; you own `styles.css` exclusively this wave.
>
> **Read (after AGENTS.md):** PLAN3.md §B3 (rem sweep — exact rules + exemptions), §B4 (dev gate), §B9 (safe-area plumbing), §C1 (ALL — scale setting, layout rules, audit matrix, safe-area rules), §C2.1–§C2.2 (slider UI rows — backend is G32's, call its documented APIs: `settings.volumes` store writes + `audio.previewBus(bus)` on release + `ui.slider` ticks), §C4 (ALL — gate + the 12 panel items), §E0.1-5/-11. Then read `src/ui/styles.css` (fully — 1544 lines), `src/ui/settingsScreen.js` (fully), `src/ui/ui.js` (screen registration), `src/ui/hud.js`, `src/dev/harness.js`, `index.html`, `src/systems/economy.js` (award signature for devGrant), `src/core/notifications.js` (test-fire), `src/core/clock.js` (pinning).
>
> **OWNS (create):** `src/ui/devPanel.js` (§C4.2's 12 cards exactly; registered unconditionally as screen id `devPanel`, entry row rendered only when `settings.devUnlocked`; unlock-all card confirm-sheet first; coins through `economy` with a `devGrant` reason; weather/band/clock pinning via the engines' existing pin surfaces — inspect how `?now=`/`?fast=` pin and reuse; FPS/draw-call overlay chip reading `renderer.info` + `audio.getStats().masterPeakDb`; fake-notch toggle force-setting the §B9 vars to 59/34 px; sticker/quest debug via lazy feature-detected imports §E0.1-11), `scripts/px-audit.mjs` (§B3 grep-gate + allow-list; wire as a lint-adjacent npm script `npm run px-audit` and run it in your verification), `src/data/strings/v3-ux.js` + `src/data/strings/v3-dev.js` (your keys EN+DE). **(modify):** `src/ui/styles.css` (EXCLUSIVE: px→rem sweep ÷16 4-decimals for font-size/padding/margin/radius/fixed DOM dims; exemptions stay px: 1px hairlines, box-shadows, #scene canvas, three-facing numbers; tap-target rule `min-height: max(44px, 2.75rem)` on interactive elements; §B9 root vars `--safe-top/right/bottom/left` + HUD/nav/sheet/minigame-HUD offsets per §C1.4; §C1.2 arcade 2-col media query + HUD stat-pill wrap), component-injected CSS strings in the files the sweep reaches (locate via grep `font-size.*px` etc. — mechanical, marked blocks), `index.html` (root font-size boot script line + vars — keep viewport-fit=cover), `src/ui/settingsScreen.js` (audio block → 5 §C2.1 rows with mute toggles on SFX/Musik; „UI-Größe" 4-stop segment with live „Aa" preview, no toast §C1.1; language-„Auto" 5-tap gate per §B4/§C4.1 with the 4 s window + reset rules + „Entwickler" row; `document.documentElement.style.fontSize` + `data-ui-scale` applied at boot and live via `uiScaleChanged`), `src/ui/hud.js` (marked block: safe-area offsets + pill wrap), `src/dev/harness.js` (marked append: `?open=devPanel`, `?uiscale=N`, `?notch=1` params), `src/main.js` (marked block: boot-apply uiScale before first paint; anchor after the settings-apply lines). Emit `uiScaleChanged` (§B10) on change.
> **DO NOT TOUCH:** `audio/*` (G32 — sole exception: the §E0.1-4 fallback block in sfxMap.js if G32's map hasn't landed at your commit time), `core/save.js`/`constants.js`/`albumScreen` (G34), `home/interactions.js`/`roomManager.js` (G35), any minigame file. Do not implement volume MATH (store writes only — G32's audio.js follows the store).
>
> **Contracts exposed:** `data-ui-scale` attribute + rem convention (all later UI agents inherit); the fake-notch dev toggle + `?notch=1` (eval agents' 40-combo matrix tool §C1.4); harness params added; devPanel card list as shipped.
> **Verification specifics:** suite+lint+build+`px-audit` green. CDP to `/tmp/gooby-v3-g33/`: ① scale live-switch 85→130 on home + settings + arcade (screenshots, no reload, `documentElement` font-size dump); ② worst-case 320×568@130 % — HUD wraps, arcade drops to 2 cols, no horizontal scroll (scripted overflow probe via `Runtime.evaluate`); ③ 5 slider rows drive `settings.volumes` (store dump) + preview blip via `getStats()` (note if G32 unmerged — §E0.1-11); ④ dev gate: 4 taps + other-tap reset ≠ unlock, 5 taps → toast + row + persisted `devUnlocked`, re-tap toasts „bereits aktiv"; ⑤ every devPanel card exercised once (unlock-all, level set, coins devGrant honesty via profile dump, stats/weight sliders live, health/weather/band segs, clock offset moving garden growth, notification test state, overlay chip, save export/import roundtrip, sticker/quest debug or its fallback); ⑥ fake-notch on → HUD/nav/results clear the 59/34 px insets (shots). Full layout matrix on settings + devPanel (§E0.2 grid) + spot 5 further screens at 320@130 %. 
> **Dependencies:** wave 1a. **Ports:** vite 5177 / CDP 9223.

### V3/G34 — save v3, sticker book, data spine (slot D) — model: **fable**

> You are build agent V3/G34 for GOOBY 3.0 „ECHT & GROSS". GOOBY's save is a versioned, migration-chained schema (v2 today) and its album screen shows the v2 collections; 3.0 moves to save v3 (new settings/stickers/nougat slices, back outfit slot, new counters), adds a 28-sticker AI-illustrated Stickerbuch with its own pure engine, and lands the single wave-1 constants/data edits every later agent consumes. **Your mission:** §B1 + §B5 + §C5 + §E0.1-3/-8/-9 exactly. HARD PRECONDITION: all 28 `public/assets/stickers/<id>.png` exist (coordinator §G0) — verify first; abort and report if not.
>
> **Read (after AGENTS.md):** PLAN3.md §B1 (ALL — schema/migration verbatim), §B5 (engine), §B8 (constants ruling), §B10 (events), §C5 (ALL — the 28-sticker table ids/conditions/hints, UI spec, hooks, achievements), §C14, §E0.1-2/-3/-7/-8/-9. Then read `src/core/save.js` (fully — migrations[1] style is your template), `src/data/constants.js`, `src/data/strings.js` (v2 spread pattern), `src/systems/achievementsEngine.js` (condition shapes + specials), `src/systems/collections.js` (album's v2 data), `src/ui/albumScreen.js` (fully), `src/data/{achievements,minigames}.js`, `test/{save,saveV2,dataV2,achievements}.test.js`, `test/fixtures/`.
>
> **OWNS (create):** `src/systems/stickerBook.js` (pure engine per §B5: catalog-injected defs, condition shapes `{counter,target}`/`{special,target}`/`{event}`, store-event + `'stickerHook'` subscription §E0.1-7, unlock flow → `stickers.unlocked[id]=now()` + `stickersChanged` + queued toasts max 1/3 s §C5.5), `src/data/stickers.js` (28 defs verbatim from §C5.1 — ids frozen, art paths, hintKeys), `src/data/strings/v3-core.js` (6 game titles EN/DE from §C8.1/§C9.1/§C10.1) + `src/data/strings/v3-stickers.js` (28× title/flavor/hint EN+DE from the §C5.1 table + book UI chrome) + the 15 other stubs §E0.1-2, `test/stickers.test.js` (§C5.2: catalog ↔ PNG 1:1, 512×512, ≤ 150 KB — the wave gate), `test/stickerBook.test.js` (every condition shape, queue, seen/NEU logic), `test/saveV3.test.js` (v2→v3 AND v1→v3 lossless round-trips per §B1 — every fixture field asserted; ≥ 300 seeded corrupt/truncated mutations incl. new-slice targets recover without crash — extend the existing fuzz corpus location after inspecting save.test.js/saveV2.test.js). **(modify):** `src/core/save.js` (v3SliceDefaults + `migrations[2]` per §B1 steps 1–5 verbatim; validate(): uiScale∈{85,100,115,130} else 100, volumes int 0–100 else default, back-slot key, whatsNew3Seen §E0.1-8), `src/data/constants.js` (the ONE §E0.1-3 marked block), `src/data/minigames.js` (6 rows §E0.1-9), `src/data/achievements.js` (+4 defs: stickerBook10/20/Full §C5.5 + nougatmeister §C6.4 → catalog 33→37), `src/systems/achievementsEngine.js` (marked block: `'stickerCount'` special; the new §B1 counters flow through existing counter plumbing — verify, don't rewrite), `src/ui/albumScreen.js` (§C5.3: top-level tab strip „Sticker" | „Stickerbuch"; book = 5 pages 6/6/6/6/4, 2×3 grid, swipe + dots, greyscale-silhouette locked slots no padlock, pop-in + confetti on first view, detail sheet with art/title/flavor or hint, NEU dot until seen, header n/28; v2 collections untouched), `src/data/strings.js` (ONE-TIME 17-module spread §E0.1-2), `src/main.js` (marked block: stickerBook engine init + store subscriptions; anchor after the achievements-engine init), `test/dataV2.test.js`-style extension in a NEW `test/dataV3.test.js` (coin rows verbatim §E0.1-3, unlock levels, minigames.js 27 ids, achievements 37, EN/DE parity for v3-core/v3-stickers keys).
> **DO NOT TOUCH:** `audio/*` (G32), `styles.css`/`settingsScreen`/`devPanel` (G33 — your book styles are component-injected CSS), `home/*`/`foods.js` (G35), `outfitAttach`/`outfits.js` (G40 wave 2 — you only add the `back: null` migration key).
>
> **Contracts exposed:** `stickerBook` API + the `'stickerHook'` event contract (§E0.1-7 — exact emit call documented for G35/G36/G37); `stickers`/`nougat`/`settings` v3 slices at exact defaults; COIN_TABLE/UNLOCKS rows (game agents consume); `stickersChanged` payload; HUD badge hook if you add one (albumScreen-internal preferred).
> **Verification specifics:** suite+lint+build green (expect ≈ +90 tests). CDP to `/tmp/gooby-v3-g34/`: ① seeded v1 AND v2 fixture saves in localStorage boot to v3 with deep-diff dumps proving losslessness + defaults; ② Stickerbuch: all-locked state, console-fire `stickerHook`/counters → unlock toast + pop-in + NEU dot + seen-clears + n/28 header (shots per page); ③ detail sheet locked (hint) vs unlocked (flavor); ④ stickerCount achievements fire at 10/20/28 via dev-style bulk unlock with queue throttling visible in the toast log; ⑤ fresh boot → whatsNew3Seen true; migrated → false. Layout matrix on album (both tabs) + detail sheet per §E0.2.
> **Dependencies:** wave 1a; §G0 sticker PNGs (hard). **Ports:** vite 5178 / CDP 9224.

### V3/G35 — anim-bug fixes, Nutella + Nougatschleuse, sticker hooks (slot E) — model: **fable**

> You are build agent V3/G35 for GOOBY 3.0 „ECHT & GROSS". Two long-standing bugs — a glitchy wake-up pose and unreliable belly-rub detection — plus the owner's favorite gag feature land together: Nutella in the food catalog and the Nougatschleuse, a wall-mounted kitchen chocolate dispenser. **Your mission:** root-cause and fix §C12 per its binding fix specs, implement §B7 + §C6 exactly, and fire the §C5.4 sticker hooks at their sources.
>
> **Read (after AGENTS.md):** PLAN3.md §C12 (ALL — repro + investigation checklists + fix specs are binding), §B7, §C6 (ALL — exact numbers), §C5.4 (your 4 hooks), §E0.1-7 (hook emit contract — coordinate shape with G34's block, it is `store.emit('stickerHook',{id})`), §E0.1-14 (gesture consts ruling). Then read `src/character/goobyAnims.js` (fully — CLIPS + scheduler), `src/character/gooby.js` + `emotions.js`, `src/ui/sleepFlow.js` (wake paths), `src/home/interactions.js` (fully — gesture classifier, care flows, fridge/tub handler shapes), `src/home/roomManager.js` (fixture/anchor pattern + garden-enter path), `src/systems/{sleep,stats,health,weight,economy,shopTrip}.js` (effect pipes + towed site), `src/data/foods.js`, `src/ui/icons.js`, `src/gfx/tween.js`, `test/{interactions,goobyApi,sleep}.test.js`.
>
> **OWNS (create):** `src/systems/nougat.logic.js` (§B7: pure cooldown/effect/refusal logic — reasons `'cooldown'|'noJar'|'sick'|'sleeping'`, frozen §C6.4 numbers), `src/data/strings/v3-nutella.js`, `test/nougat.test.js` (§C6.5: refusal matrix, double junkScore, cooldown across clock pinning, jar consumption, migration default), `test/goobyAnims.test.js` extension or new `test/wakePose.test.js` (§C12.1: pure pose-track assertion — after a simulated wake sequence every animated node within ε=0.001 of rest pose). **(modify):** `src/character/goobyAnims.js` (§C12.1 fix spec: capture rest pose at build; sleep-enter tween TO lying 0.8 s; wake = lying→rest 0.4 s THEN `wake` clip from rest; idle-scheduler suppressed until wake completes — BOTH natural and grumpy paths), `src/ui/sleepFlow.js` (wake-path wiring + `grumpyWake` hook), `src/home/interactions.js` (§C12.2 fix spec: dominant-axis reversal counting, viewport-normalized dx threshold ~3.5 % of canvas width as module-local frozen consts §E0.1-14, weight-tier-aware belly region mapping; `?petdebug=1` overlay data feed; PLUS the §C6.4 nougatschleuse tap handler: refusal paths via nougat.logic, 2.8 s waddle→crank 720°→glob→chomp sequence through existing pipes `stats.apply`/`health.onEat({junk:true})`×2-semantics/`weight.onEat`×1/counters `nougatGlobs`/messy-face CHEEK lerp 60 s/−1 jar toast), `src/home/roomManager.js` (kitchen `ROOM_DEF` fixture `nougatschleuse` per §B7 rendered only when `nougat.installed` — §C6.2 procedural build ~180 tris 1 draw call, idle drip; `tap:nougatschleuse`; garden-enter hooks `rainCanopy`/`nightStars`), `src/systems/shopTrip.js` (ONE marked one-liner: `towed` hook at the tow cutscene), `src/data/foods.js` (nutella row §C6.1 verbatim), `src/ui/icons.js` (marked append: `nutellaJar` §C6.1), `src/ui/shopScreen.js` (marked block: Nougatschleuse in the furniture tab 400 c/L5 — buying sets `nougat.installed=true` + `nougatChanged` + install toast/sparkle, NO placement step §C6.3; nutella appears via the normal food catalog — verify only), `src/dev/harness.js` (marked append: `?petdebug=1`), `src/main.js` (marked block if wiring needs boot — anchor after the interactions wiring). Emit `nougatChanged` (§B10).
> **DO NOT TOUCH:** `sfxMap.js` (G32's this wave — reuse existing ids `eat.chomp`, `gooby.giggle`, `ui.error`, squeaks; flag wanted bespoke ids in your report), `styles.css` (G33), `save.js`/`constants.js`/`stickers` (G34 — `nougat` slice defaults are G34's; your logic takes the slice as input), `outfitAttach.js`.
>
> **Contracts exposed:** `nougat.logic.js` API (`canGlob(state, nowMs) → {ok, reason?}`, effect table); the 4 `stickerHook` emit sites; `?petdebug=1` overlay fields (region/dx/velocity/reversals — §C12.2 acceptance tooling for evals); **export the Nougatschleuse mesh builder as a standalone helper** (e.g. `buildNougatschleuse()` in a small `src/home/nougatMesh.js` imported by roomManager) — wave-3's miniGolf hole 7 (§C10.2) reuses it as a moving obstacle.
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v3-g35/`: ① §C12.1 acceptance — CDP video/screenshot sequence of BOTH wake paths (`?sleep=1`, early tap + natural elapse) showing no snap/slide, plus the pose-track test; ② §C12.2 acceptance VERBATIM — `?petdebug=1` at 390×844/100 %: 10 CDP-synthesized natural belly rubs (circular + horizontal) → ≥ 8 tickles, 0 head/feet misfires, pets ≥ 1/s during slow strokes; repeat at weight 20 AND 90, and at 85 %/130 % uiScale (dump the overlay log each run); ③ Nougatschleuse: buy → kitchen mount + sparkle; full glob sequence with before/after state dumps proving hunger +15/fun +10/hygiene −8/junkScore +2/weight +2/XP +2/−1 jar/counter +1 + messy face 60 s; all 4 refusals incl. cooldown early-tap belly-pat; ④ nutella purchase + normal feed flow (junk pipeline); ⑤ each of the 4 sticker hooks observed as a `stickerHook` emission (console tap or G34's engine reaction if merged). Layout matrix only if you add DOM chrome (petdebug overlay is dev-only — exempt but screenshot it).
> **Dependencies:** wave 1a (food-kit honey model). **Ports:** vite 5179 / CDP 9225.

---

## E4. WAVE 2 — flagship teams + outfits (launch G36–G40 in parallel; wave 1 merged, pushed, CI green)

### V3/G36 — Team CAKE: purblePlace flagship (slot A) — model: **fable**

> You are build agent V3/G36 (Team CAKE) for GOOBY 3.0 „ECHT & GROSS". GOOBY's arcade games follow a strict plugin contract (framework-owned countdown/pause/results/payout, pure `.logic.js` sibling, `?autoplay=1` bot); 3.0's flagship #2 is a Purble-Place-„Comfy Cakes"-inspired assembly-line cake shop in a KayKit-Restaurant bakery with skinned NPC customers. **Your mission:** build `purblePlace` exactly per §C9 — a dedicated team-eval agent will grade it against every §C9 number right after you, and you will be resumed for a fix round on its findings.
>
> **Read (after AGENTS.md):** PLAN3.md §C9 (ALL — every number binding), §B8 (contract ruling; your coin row `5/5/30` + unlock L6 are already in constants via G34), §B6/§D2.2 (asset keys — the exact committed list is in G31's report/manifest; use `getSkinnedModel`/`getAnimations` per §E0.1-10), §C5.1 #26 (cakeBoss sticker rides `meta.perfectCakes`), §A2 (27-game bullets). Then read `carrotCatch.js`+`.logic.js` + `framework.js` (convention, `onEnd({score, meta})`, per-game `sfx: []` preload from G32), `burgerBuild.js` (ticket-style HUD precedent), `src/core/assets.js` (skinned contracts), `test/minigamesD.test.js` (test style).
>
> **OWNS (create):** `src/minigames/games/purblePlace.js` + `purblePlace.logic.js`, `src/data/strings/v3-cake.js` (your keys — title is in v3-core), `test/purblePlace.test.js`. **(shared-append per §E0.1-6):** `sfxMap.js` ONE marked block (ids for oven ding/splat/serve/crank etc. → G31-committed sample keys or existing recipes only), `styles.css` ONE rem-only marked block if the ticket HUD needs it.
> **DO NOT TOUCH:** every other game, `framework.js`, `shopTrip.js`/door sheet (G38), `cityBuilder`/`carController` (G39), `outfitAttach` (G40), all wave-1 files.
>
> **Binding numbers (implement verbatim from §C9):** tickets = shape(∘/□/♥) × sponge(vanilla/choc/strawberry hexes §C9.2) × icing(4 incl. none) × topping(4 incl. none) × candles 0–4, max 3 parallel, patience 45 s → −1.5 s/serve floor 30 s, expiry = sad leave −5 + combo reset; conveyor 0.55 m/s belt 6 m, stations Form→Teig→Ofen(3 s meter, green zone last 25 % = +5, late −3)→Guss→Deko→Kerzen, 0.9 s station window, belt loops once for fixes; serve zone auto-matches best open ticket; scoring +20 perfect (+5 perfect bake), +8 one-wrong, −5 rejected (≥2 wrong), combo +2/serve cap +10, speed bonus +4 at ≥ 50 % patience; ramp: interval 30→14 s (−2/serve), complexity weighting (candles ≥3 + none-icing only after serve #4), belt +6 %/3 serves cap +24 %; round 210 s fixed, typical ≈ 120–150 → row `5/5/30` ≈ 26 c, energy 8, unlock L6. Cakes procedural lathe layers + food-kit toppings (§C9.6 — 36 combos), bakery set per §D2.2, NPC cap 1 walking + 2 seated frozen (§C9.7), ≤ 250 draw calls. Meta `{cakesServed, perfectCakes, rejected}` → counters; `meta.perfectCakes ≥ 1` must light the cakeBoss sticker via existing counter plumbing (verify with G34's engine). Bot: tap scheduler reading the next cake's ticket, average ≥ 90 (§C9.7).
> **Tests (§C9.7):** seeded ticket generator + difficulty weighting; match/scoring matrix all 0/1/≥2-wrong cases; patience/ramp math; belt-window hit test; bot average ≥ 90 over 20 seeded runs (logic-level).
> **Verification specifics:** suite+lint+build green; chunk ≤ 150 KB gzip (belt/NPC visuals lean on shared assets). CDP to `/tmp/gooby-v3-g36/`: mid-play shot (warm bakery look §C10.1 distinct-look rule), ticket cards + all 6 stations exercised manually via CDP taps (one perfect cake documented station-by-station), NPC walk-in→sit→cheer sequence shots, 5 autoplay runs score/payout table (in-row, typical ≈ 26 c), energy 8, ×2 once, `renderer.info` ≤ 250 calls, counters/sticker dump after a perfect serve. Layout matrix on the game HUD + results per §E0.2 (incl. 320@130 %).
> **Dependencies:** waves 1a+1b. **Ports:** vite 5175 / CDP 9221.

### V3/G37 — Team SURF: shoppingSurf game (slot B) — model: **fable**

> You are build agent V3/G37 (Team SURF) for GOOBY 3.0 „ECHT & GROSS". Flagship #1 is a Subway-Surfers-class 3-lane endless runner through a pastel shopping street, doubling as the game's second travel-to-shop method. **Your mission:** build the `shoppingSurf` game module — BOTH behavior modes (arcade endless + fixed-distance travel run) — exactly per §C8; G38 (same team, same wave) wires the travel LAUNCH path and rewards around your module, and a team-eval grades you both.
>
> **Read (after AGENTS.md):** PLAN3.md §C8 (ALL — §C8.1–§C8.5 arcade, §C8.6 travel behavior, §C8.7 purity/tests), §B8 (row `40/5/34` + L5 via G34; travel machine ruling), §D2.3/§D2.1 (city + character assets), §E0.1-10 (skinned NPC rule, cap 1), §C5.1 #27 (surfStar rides `surfRuns`). Then read `runner.js`+`.logic.js` (lane-runner precedent), `carrotCatch` convention files, `framework.js` (`onEnd({score, coins, meta})` — the `coins` override is how travel rewards flow; confirm with G38's block), `src/core/assets.js`.
>
> **OWNS (create):** `src/minigames/games/shoppingSurf.js` + `shoppingSurf.logic.js`, `src/data/strings/v3-surf.js`, `test/shoppingSurf.test.js`. **(shared-append):** `sfxMap.js` ONE marked block (cart rattle, whoosh, near-miss „Knapp!", powerup chimes → committed samples/existing recipes), `styles.css` rem-only block if needed.
> **DO NOT TOUCH:** `systems/shopTrip.js`, the door sheet, `framework.js`, `economy.js` (ALL G38's), every other game, wave-1 files.
>
> **Binding numbers (§C8 verbatim):** 3 lanes x=−1.6/0/+1.6, camera [0,3.2,−5.5] look-ahead 8 m FOV 62; 30 m chunk pool, 12 handcrafted chunk defs, seeded order; controls: swipe lane 120 ms tween / up jump 0.55 s / down slide 0.5 s + mid-air fast-drop, 1 buffered action 250 ms, tap = nothing; obstacles per the §C8.3 table (cart 2 m/s relative + 0.9 s telegraph, crate stacks never blocking all 3 lanes — validator, KayKit NPC crossing 1.2 m/s with dotted-line telegraph + 1 skinned cap, awning bars slide, puddles soft −10 %/2 s, gaps ≥ 800 m only); crash = stumble 0.8 s + 1.5 s invulnerable, arcade 3rd crash ends; near-miss 0.35 m = +2 + streak; pickups §C8.4 (coin lines/arcs, Magnet 6 s r=3 m, ×2 8 s, Schild 1 crash, Turbo-Möhre 2.5 s +40 % invuln ≤ 1/400 m; one powerup per 180–260 m, no same-kind twice); speed 8 m/s +0.25/5 s cap 16; score `floor(distanceM) + coins×2 + nearMiss×2` (typical 800–1100/90 s); row `40/5/34`, energy 8 arcade, unlock L5; meta `{distanceM, coins, nearMisses, powerups}`; counters `surfRuns`/`surfDistanceM` (BOTH modes). **Travel mode (`ctx.params.mode === 'travel'`):** fixed 700 m, no fail-out, 3rd crash → fixed 7 m/s no-obstacle jog, finish arch → call `onEnd` with the §C8.6 reward meta (coins collected capped 30 + 5 clean-run bonus; expose the math in `.logic.js` — G38 wires the machine/payout side). Distinct look: pastel shopping street (§C10.1 rule). ≤ 250 draw calls (pooled chunks, instanced coins).
> **Tests (§C8.7):** chunk sequencer never-impossible proof — BFS over the action lattice for 200 seeds at every ramp speed; spawn tables; speed ramp; scoring; powerup timers; travel-reward math (cap 30 + bonus 5, daily ×2 AFTER clamp). Bot: plans 1 chunk ahead on the lattice, takes safe coin lines, averages ≥ 600 m arcade (prove over 20 seeded logic runs + 5 live autoplay).
> **Verification specifics:** suite+lint+build green; chunk ≤ 150 KB gzip. CDP to `/tmp/gooby-v3-g37/`: mid-run shots (jump over cart, slide under awning, NPC crossing, near-miss juice, each powerup active), 5 autoplay arcade runs score/payout table in-row, travel mode via `?minigame=shoppingSurf&mode=travel` (or the param G38 documents): 700 m completes, crash-forgiveness jog after 3rd crash, finish arch; `renderer.info` ≤ 250; counters dump. Layout matrix HUD + results per §E0.2.
> **Dependencies:** waves 1a+1b. **Ports:** vite 5176 / CDP 9222.

### V3/G38 — Team SURF: travel integration — door sheet, shopTrip, rewards (slot C) — model: **fable**

> You are build agent V3/G38 (Team SURF) for GOOBY 3.0 „ECHT & GROSS". Today the front door offers one way to the shop: the cityDrive trip through the `shopTrip` state machine. 3.0 adds „Laufen" — a fixed-distance shoppingSurf run that ends in the IDENTICAL shop-arrival handoff. **Your mission:** the two-option travel chooser, the surf-travel launch/arrival wiring, and the §C8.6 trip-reward path — without modifying the `shopTrip` machine's states (§B8: `start → driveOut → shop` reused verbatim; `tripTransition` untouched).
>
> **Read (after AGENTS.md):** PLAN3.md §C8.6 (ALL — binding), §B8 (machine ruling), §A2 („2 travel methods" bullet), PLAN2 §C9-v2 (destination picker precedent — vet). Then read `src/systems/shopTrip.js` (FULLY — machine, destination sheet, canRequestTrip, tow path, coin pickups, arrival handoff), the door-sheet UI call sites (grep `destinations`/front-door in `hud.js`/`roomManager.js`/shopTrip), `src/minigames/framework.js` (`onEnd({score, coins, meta})` coinsOverride path + `awardMinigame`), `src/systems/economy.js` (trip reward path — how cityDrive trip coins are paid today; the daily ×2 rule), G37's report (module params contract) — if unmerged, code against §C8.6 and the param name `mode: 'travel'`, and verify jointly at the end of the wave.
>
> **OWNS (modify):** `src/systems/shopTrip.js` (travel-method field on the trip request: `'drive'|'surf'`; surf path launches `shoppingSurf` in travel mode between `start` and `arrive` instead of the drive scene — same states; arrival → identical shop handoff; `trips` counter +1 both methods §C8.6; energy 6 both, from L1), the door-sheet UI file you located (two-option chooser „Fahren 🚗 / Laufen 🏃" both showing the 6-energy cost — additive rework, keep the vet destination row intact), `src/minigames/framework.js` (marked block ONLY if the coinsOverride path needs a travel-cap hook — §C8.6 rewards: coins collected capped 30 + 5 zero-crash bonus = max 35, daily-first-play ×2 AFTER clamp; prefer computing in shopTrip/economy and passing `coins` through `onEnd`), `src/systems/economy.js` (marked block only if a `surfTrip` award reason is needed — mirror the cityDrive trip reason), `src/data/strings/v3-travel.js`, `test/shopTrip.test.js` (extend: surf-method transitions, reward cap/bonus/×2 math, counters both methods, sleep/sick gates unchanged, vet flow untouched), `src/dev/harness.js` (marked append: `?travel=surf` autopilot-style param if feasible — else document manual steps).
> **DO NOT TOUCH:** `shoppingSurf.js`/`.logic.js` (G37 — consume its exported travel-reward math), `purblePlace` (G36), `cityBuilder`/`carController`/`cityDrive` (G39 — the DRIVE trip must stay bit-identical; your chooser only adds an option), `outfit*` (G40), wave-1 files beyond the listed marked blocks.
>
> **Contracts exposed:** the trip-method request shape (V3/E-SURF and §F evals use it); `?travel=surf` harness param; the reward-math call (`shoppingSurf.logic` travelReward → economy) documented.
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v3-g38/`: ① door sheet shows both options with energy costs (EN+DE shots); ② full „Laufen" trip: door → surf run → finish arch → shop arrival panel IDENTICAL to a drive arrival (side-by-side shots), buy something, return home; ③ reward proof: run with N coins collected → payout min(N,30)(+5 if clean) with store dumps; daily ×2 applied after clamp exactly once; ④ „Fahren" regression: full drive trip unchanged (tow rule spot-check via scripted crashes); ⑤ counters: `trips` +1 both methods, `surfRuns` +1 on the run; ⑥ energy 6 deducted both; sleeping/sick gates refuse both. Layout matrix on the reworked door sheet per §E0.2.
> **Dependencies:** waves 1a+1b; G37 same-wave (runtime — final joint verification after both commit; §E0.1-11 degrade rule while building). **Ports:** vite 5177 / CDP 9223.

### V3/G39 — Team DRIVE: driving overhaul — road connectivity + drive feel (slot D) — model: **fable**

> You are build agent V3/G39 (Team DRIVE) for GOOBY 3.0 „ECHT & GROSS". The product owner's complaint: „die Straße passt nicht" (visible curb/sidewalk seams at corners/T-junctions in the seeded city) and the drive feels twitchy. **Your mission:** execute §C7 exactly — evidence-first root-cause of the road-piece orientation bug via a dev harness scene, a port-table rewrite of `roadPieceFor`, locked by a connectivity test, plus the §C7.2 feel tuning — while §C7.3's invariants stay bit-identical.
>
> **Read (after AGENTS.md):** PLAN3.md §C7 (ALL — the 4-step fix procedure §C7.1 is binding: you MUST render `?scene=roadtest` and read the TRUE port sides off screenshots BEFORE writing the port table), §C10.2 cityDrive row, §E0.1-13 (pure-logic ruling). Then read `src/city/cityBuilder.js` (FULLY — `roadPieceFor`, seeds, substitutions), `src/city/carController.js` (FULLY — steering/assist/camera), `src/minigames/games/cityDrive.js` (drivers + arcade ramp), `src/city/traffic.js` (consume), `src/systems/shopTrip.js` (READ-ONLY — invariants), `test/cityLayout.test.js`, `test/shopTrip.test.js` (must stay green UNMODIFIED §C7.3).
>
> **OWNS (create):** `test/cityRoads.test.js` (§C7.1-3: 20 seeds — every adjacent road-tile pair shares a facing port; every road tile's ports ⊆ its road-neighbor directions). **(modify):** `src/city/cityBuilder.js` (frozen `PIECE_PORTS` truth table + rotation function + search-based `roadPieceFor` per §C7.1-2 — deterministic, no special-case ladder; `road-crossing` substitution inherits the straight's true orientation), `src/city/carController.js` (§C7.2 verbatim: steering low-pass τ=120 ms + 90°/s rate cap; lane-assist spring max 8°/s, fades to 0 beyond 25° intent, disabled ≥ 40 % deflection; chase cam lerp k=4.0/s + 6 m look-ahead + FOV 55→60 over 9→13 m/s, roll/bob removed — all three drivers inherit), `src/minigames/games/cityDrive.js` (arcade open-run max 13→15 m/s, ramp after 20 s — trip speed UNCHANGED), `src/dev/harness.js` (marked append: `?scene=roadtest` — all 5 pieces × rotY 0/90/180/270 labeled grid + compass §C7.1-1), `src/data/strings/v3-drive.js` (likely empty — keep stub), extend `test/cityLayout.test.js` ONLY additively; NEW feel tests (in cityRoads.test.js or a `carFeel.test.js`): smoothing step-response τ ±10 %, assist-force curve 0 beyond 25°, camera-lag bound (§C7.3).
> **DO NOT TOUCH:** `shopTrip.js` (G38 edits it THIS wave — your invariant check is running its tests, not editing), `deliveryRush.js`/`traffic.js` (deliveryRush inherits via the shared controller; its fragile-parcel depth is G44's wave 3), every game file except cityDrive.js, wave-1 files.
>
> **Contracts exposed:** `PIECE_PORTS` + rotation helper (G44's deliveryRush audit + evals consume); `?scene=roadtest`; before/after feel parameters table.
> **Verification specifics:** suite+lint+build green — `test/shopTrip.test.js` and the §C4-v1/§C9-v2/§C1.1-v2 economy tests pass UNMODIFIED (paste the proof). CDP to `/tmp/gooby-v3-g39/`: ① roadtest grid screenshot BEFORE the fix + the derived port table (your §C7.1-1 evidence); ② §C7.1-4 visual acceptance — 4 top-down quadrant shots with continuous curbs through every corner/T/crossroad + zebra perpendicular; ③ 20-seed connectivity test output; ④ feel: telemetry dumps of a scripted jitter input before/after (steering-rate cap visible), assist-fade curve dump, camera-follow lag measurement, arcade 15 m/s ramp; ⑤ full trip + arcade + one deliveryRush autoplay run each completing with in-row payouts (regression). No new player-facing UI → no layout matrix (roadtest is dev-only).
> **Dependencies:** waves 1a+1b. **Ports:** vite 5178 / CDP 9224.

### V3/G40 — outfit expansion 20 → 42 + back slot (slot E) — model: **solfast**

> You are build agent V3/G40 for GOOBY 3.0 „ECHT & GROSS". GOOBY has 20 procedural outfits in 3 slots (hat/glasses/neck) on a shared wardrobe renderer; 3.0 doubles the catalog and adds a 4th slot: `back`. **Your mission:** implement §C13 exactly — the new anchor, the 22 items, minLevel gating, and the wardrobe's 4th tab — at v2 quality (fit at all weight tiers is the bar).
>
> **Read (after AGENTS.md):** PLAN3.md §C13 (ALL — the 22-item table with prices/minLevels/build notes is binding; slot math: hats 17 / glasses 9 / neck 10 / back 6 = 42), §B1 (`outfits.equipped.back` — G34 migrated it), §A2 (wardrobe perf bullet: ≤ 1 s extra on the VM at 42 items). Then read `src/character/outfitAttach.js` (FULLY — build pattern, anchors, weight-tier anchor scaling from V2/FIX-C, cape flutter precedent for your back anchor), `src/data/outfits.js`, `src/ui/wardrobeScreen.js`, `src/ui/shopScreen.js` (outfit purchase path + lock badges), `test/outfits.test.js`, `src/core/assets.js` (`getModel` for pumpkinHat's `kaykit-halloween/pumpkin_orange_small`).
>
> **OWNS (modify):** `src/character/outfitAttach.js` (NEW `back` anchor at [0, 0.34, −0.18] from body root with hop flutter §C13.1 + weight-tier scaling like neck; the 22 §C13.2 builds — all procedural except pumpkinHat; special behaviors: balloonRed sway, propellerPack idle spin, fairyWings hop flutter, surfBoard angled carry), `src/data/outfits.js` (+22 rows with `minLevel` — new optional field default 1), `src/ui/wardrobeScreen.js` (4th slot tab „Rücken"; minLevel-locked rows with the arcade-style level badge §C13.3), `src/ui/shopScreen.js` (marked block: outfit-tab minLevel badges — purchase path unchanged), `src/data/strings/v3-outfits.js` (22 names EN+DE), `test/outfits.test.js` (extend: 42-item catalog integrity, slot counts 17/9/10/6, price/minLevel table verbatim, back-slot equip pure logic; fullFit still requires only the 3 ORIGINAL slots §C13.3 — regression assert).
> **DO NOT TOUCH:** `save.js` (back key is G34's, merged), `skins.js`, every game file (G36/G37/G39), `shopTrip`/door sheet (G38), wave-1 files. sfxMap: reuse existing ids only (bell/cape precedents).
>
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v3-g40/`: ① every one of the 22 new items equipped — screenshot grid (batch by slot), each at weight tier 0.93 AND 1.14 for the fit bar (spot 6 items minimum incl. fairyWings/turtleShell/backpackTiny on the new anchor + vikingHelm/spaceHelm hats); ② hop with balloonRed/fairyWings/propellerPack — flutter/sway/spin visible (short CDP sequence shots); ③ minLevel gating: locked badge at low level, purchasable at the gate level (`?level=`); ④ wardrobe with 42 items opens without visible regression (time it: ≤ 1 s extra vs a 20-item baseline on the VM — measure both via `performance.now` dumps); ⑤ persistence across reload with all 4 slots equipped. Layout matrix on wardrobe (4 tabs) per §E0.2 incl. 320@130 %.
> **Dependencies:** waves 1a+1b. **Ports:** vite 5179 / CDP 9225.

---

## E5. WAVE 3 — four new games + depth/bug pass (launch G41–G45 in parallel; wave 2 + team-eval fixes merged, pushed, CI green)

### V3/G41 — new games F: toyRacer + ghostHunt (slot A) — model: **fable**

> You are build agent V3/G41 for GOOBY 3.0 „ECHT & GROSS". The arcade grows from 23 (post-flagships) to 27; you own two of the four remaining deep games. **Your mission:** build **toyRacer** (3-lap toy-room kart race) and **ghostHunt** (spooky-cute seek-and-tap) exactly per §C10.1 #1/#2 — multi-mechanic, powerups, meta, bots, distinct looks.
>
> **Read (after AGENTS.md):** PLAN3.md §C10.1 rows+designs #1/#2 (binding: rows `toyRacer 6/5/30` L15, `ghostHunt 4/4/28` L16, energy 8, durations ~150 s/90 s), §C10.1 distinct-look rule (bedroom-floor toy world / dusk graveyard purple-orange), §D5 (toy-car-kit 20 files), §D2.4 (kaykit-halloween 18 files), §E0.1-10 (ghosts are procedural sheet-ghosts, NOT library models — cloth-sphere + eyes, cute). Then read `carrotCatch` convention files, `framework.js`, `miniGolf.logic.js` (physics/test precedent for the drift math), `carrotGuard.logic.js` (tap-game precedent), G31's asset inventory.
>
> **OWNS (create):** `src/minigames/games/toyRacer.js` + `.logic.js`, `ghostHunt.js` + `.logic.js`, `src/data/strings/v3-games-f.js`, `test/gamesV3a.test.js`. **(shared-append):** `sfxMap.js` ONE marked block (engine putter, drift squeal, item pickup, ghost giggle/pop, boo-wave sting → committed samples/existing recipes — majority sample-backed per §C3.1 arithmetic), `styles.css` rem-only block if needed.
> **DO NOT TOUCH:** G42/G43/G44/G45's game files and test files, everything wave 1–2.
>
> **Binding designs (§C10.1 verbatim):** toyRacer — seeded 8-piece toy-car-kit loop, 2 layout templates × seeds, 3 laps vs 3 rubber-band AI karts; hold-to-drift charge → 1.2 s boost; item boxes ~⅓ lap (turbo/bumper-shield/toy-block drop); off-track 40 % slow; score = position bonus 120/80/50/30 + 2·overtakes + driftMeters/10; meta `races`/`wins`; bot follows center spline, drifts > 45° corners, uses items instantly. ghostHunt — graveyard-garden set from kaykit-halloween; ghosts peek on ramping timers visible 2.2 s→0.9 s, tap +3 with chain +1 (≤ 1.5 s gaps, cap +5); pumpkin-lantern decoys −2; Boo-wave every 25 s (5 at once, ≥ 4 caught = +10); powerups Laterne (3 s reveal) + Netz (3 auto-chains); 90 s, score ≈ 90; meta `ghostsCaught`; bot taps real ghosts at spawn+200 ms, ignores decoys.
> **Tests:** seeded track/layout determinism + AI rubber-band bounds + drift/boost math + item tables; ghost spawn/decoy tables, chain math, boo-wave scheduling, bot ignores decoys (logic-level); both bots hit their §C10.1 typical scores over 20 seeded runs.
> **Verification specifics:** suite+lint+build green; each chunk ≤ 150 KB gzip; ≤ 250 draw calls each. CDP to `/tmp/gooby-v3-g41/`: per game mid-play + results shots (distinct looks — no palette collision with the 25 others), 5 autoplay runs each with score/payout tables in-row near typicals, unlock badges at L15/L16, energy 8, ×2 once; toyRacer: drift-boost + item use + overtake visible; ghostHunt: boo-wave + decoy penalty + both powerups visible. Layout matrix on both HUDs + results per §E0.2.
> **Dependencies:** waves 1–2. **Ports:** vite 5175 / CDP 9221.

### V3/G42 — new games G: rocketRescue + harborHopper (slot B) — model: **fable**

> You are build agent V3/G42 for GOOBY 3.0 „ECHT & GROSS". You own the last two of the four new deep games. **Your mission:** build **rocketRescue** (physics lander) and **harborHopper** (momentum boat runner) exactly per §C10.1 #3/#4.
>
> **Read (after AGENTS.md):** PLAN3.md §C10.1 rows+designs #3/#4 (binding: `rocketRescue 5/4/28` L18 ~120 s, `harborHopper 5/4/30` L20 120 s, energy 8), distinct looks (starfield/space vs teal harbor morning), §D5 (watercraft-kit 6 files; space-kit already committed). Then read `carrotCatch` convention files, `starHopper.js`+`.logic.js` (space look — yours must differ: starfield + platforms vs its nebula lanes; also physics precedent), `framework.js`, G31's inventory.
>
> **OWNS (create):** `src/minigames/games/rocketRescue.js` + `.logic.js`, `harborHopper.js` + `.logic.js`, `src/data/strings/v3-games-g.js`, `test/gamesV3b.test.js`. **(shared-append):** `sfxMap.js` ONE marked block (thrust loop from existing recipe or sample, landing thud, bunny squeak pickup, boat horn, wave whoosh, seagull honk → committed samples/existing recipes), `styles.css` rem-only if needed.
> **DO NOT TOUCH:** G41/G43/G44/G45's files, everything wave 1–2.
>
> **Binding designs (§C10.1 verbatim):** rocketRescue — hold-thrust + tilt thirds; 5 seeded platforms/round, pick up 1 bunny each (land ≤ 1.2 m/s), carry to station pad; fuel 100, burn 8/s, mid-air fuel pickups; wind gusts telegraphed (level 3+); hard landing = bounce −10 fuel, never death; out-of-fuel = auto-tow, run ends; score = 30·rescued + fuelRemaining/2 + 5/soft-landing ≤ 0.5 m/s; meta `rescues`; bot = PD controller on altitude/velocity. harborHopper — auto-forward 6 m/s drag-steer momentum boat; crates +4, net rings +2; buoys/piers bump −3 + slow (70 % hitboxes); wave bands: crest-center surf-boost +30 %/2 s chainable; seagull steals top crate after 4 s one-lane idle (honk warning); powerup Fischkutter-Horn (6 m cone clear, 2 charges); score ≈ 100; meta `cratesShipped`; bot spline-follows a greedy crate path, centers crests.
> **Tests:** lander physics integration (thrust/fuel/landing-velocity classification), platform/wind seeding, PD-bot rescues ≥ 3/round over 20 seeds; wave-band timing, crate/buoy spawn tables, seagull idle rule, horn cone math, bot ≥ typical over 20 seeds.
> **Verification specifics:** suite+lint+build green; chunks ≤ 150 KB gzip; ≤ 250 draw calls. CDP to `/tmp/gooby-v3-g42/`: per game mid-play + results shots (distinct looks), 5 autoplay runs each in-row, L18/L20 badges, energy 8, ×2 once; rocketRescue: soft vs hard landing + rescue carry + out-of-fuel tow visible; harborHopper: surf-boost chain + seagull steal + horn use visible. Layout matrix both HUDs + results per §E0.2.
> **Dependencies:** waves 1–2. **Ports:** vite 5176 / CDP 9222.

### V3/G43 — depth+audit A: carrotCatch, bunnyHop, carrotGuard, memoryMatch, runner, basketBounce, pancakeTower (slot C) — model: **solfast**

> You are build agent V3/G43 for GOOBY 3.0 „ECHT & GROSS". Every one of the 21 v1/v2 games gets ONE new depth feature and ONE bug-hot-spot audit (§C10.2 table); you own 7 of them. **Your mission:** implement your 7 rows verbatim, audit each hot-spot with runtime evidence, fix what you find, and log a bug-or-clean-bill verdict per game — WITHOUT breaking coin rows, energy, scoring caps, or any existing test (§C10.2 header rules).
>
> **Read (after AGENTS.md):** PLAN3.md §C10.2 (your 7 rows — feature + audit column binding), §A3 (v1/v2 rules invariant), §C3.1 (`card.flip`/`card.match` now sample-backed — memoryMatch may need its call sites aligned with G32's ids). Then read EACH of your 7 games' `.js` + `.logic.js` + its tests (`minigamesA.test.js`, `minigamesB.test.js` — you own extending BOTH this wave), `framework.js`, `test/economy.test.js` (caps you must not move).
>
> **OWNS (modify):** `src/minigames/games/{carrotCatch,bunnyHop,carrotGuard,memoryMatch,runner,basketBounce,pancakeTower}.js` + their `.logic.js`, `test/minigamesA.test.js` + `test/minigamesB.test.js` (extend with each new feature's logic tests; edit existing asserts ONLY where a §C10.2 row legitimately changes behavior — justify each in the report), `src/data/strings/v3-depth-a.js`. **(shared-append):** `sfxMap.js` ONE marked block (new-feature ids → committed samples).
> **DO NOT TOUCH:** G44/G45's games and test files (minigamesC/D/E.test.js), G41/G42's new games, `framework.js`, everything wave 1–2.
>
> **Your rows (§C10.2 verbatim):** carrotCatch golden carrot (1/run, +10, 1.5× fall) + rotten streak-breaker (−2, combo reset) · audit basket hitbox at 130 % UI + edge spawn RNG bias; bunnyHop wind gusts (telegraphed, 0.4-lane shift, gates ×2 during) · audit gate tolerance at high flap rate + pause-resume mid-flap; carrotGuard mole king every 20 bonks (3 taps, +8, 2-coins-worth score) · audit simultaneous-tap double-hit + whiff spam; memoryMatch peek powerup (1×/round 1 s reveal, earned at 3 clean matches) · audit 6×4 at 320×568 + rapid double-flip race; runner mystery box (magnet 4 s / ×2 6 s / stumble-shield — powerup set aligned with shoppingSurf) · audit slide hitbox height + double-hit after stumble; basketBounce moving hoop after 10 baskets (±1 m slide, swish ×2) · audit rim tunneling on fast throws; pancakeTower wobble physics from height 8 (perfect drops damp) · audit slice-overhang at extreme offsets + topping despawn.
> **Verification specifics:** suite+lint+build green (score CAPS unchanged — rerun economy tests). CDP to `/tmp/gooby-v3-g43/`: per game ① the new feature visibly firing (screenshot + state dump), ② the audit executed with evidence (repro attempt at the named hot-spot — e.g. memoryMatch double-flip race via two synthetic taps in one frame; 130 % basket hitbox probe) and the fix demonstrated OR a clean bill with the probe logs, ③ 3 autoplay runs in-row. Per-game verdict table in the report (feature ✓ | audit finding | fix commit). Layout: memoryMatch 6×4 at 320×568@130 % shot mandatory.
> **Dependencies:** waves 1–2 (G32's card ids, G37's powerup precedent). **Ports:** vite 5177 / CDP 9223.

### V3/G44 — depth+audit B: danceParty, fishingPond, bubblePop, trampoline, starHopper, pipeFlow, deliveryRush, miniGolf (slot D) — model: **solfast**

> You are build agent V3/G44 for GOOBY 3.0 „ECHT & GROSS". Same charter as G43 for your 8 §C10.2 rows (the minigamesC/E test-file games). **Your mission:** implement each depth feature verbatim, audit each hot-spot with evidence, fix findings, keep every cap/row/energy intact.
>
> **Read (after AGENTS.md):** PLAN3.md §C10.2 (your 8 rows), §C3.4 (danceParty: your Fever-chain „Encore" must ride the synth-beat contract — `DANCE.BPM`/`PATTERN_SEED`/`getMusicTime()` untouched; G32's `dance.tierUp` accent already landed), §C7.2/§C7.3 (deliveryRush inherits G39's feel; your fragile-parcel row must not touch carController), miniGolf's Nougat-Loop row (moving Nougatschleuse obstacle — import G35's exported `buildNougatschleuse()` helper (`home/nougatMesh.js` per its report), don't duplicate the build). Then read your 8 games' files + `test/minigamesC.test.js` + `test/minigamesE.test.js`, `framework.js`, `systems/collections.js` (fishingPond rare-species set feeds the v2 fish collection — inspect the v2 species roll in fishingPond).
>
> **OWNS (modify):** `src/minigames/games/{danceParty,fishingPond,bubblePop,trampoline,starHopper,pipeFlow,deliveryRush,miniGolf}.js` + `.logic.js` siblings, `test/minigamesC.test.js` + `test/minigamesE.test.js` (extend; existing-assert edits only with §C10.2 justification), `src/data/strings/v3-depth-b.js`. **(shared-append):** `sfxMap.js` ONE marked block.
> **DO NOT TOUCH:** G43/G45's games + minigamesA/B/D test files, G41/G42's games, `carController.js`/`cityBuilder.js` (G39's, merged — consume), `systems/nougat.logic.js`/`home/nougatMesh.js`/roomManager (G35's — import the exported builder only), everything else wave 1–2.
>
> **Your rows (§C10.2 verbatim):** danceParty fever chain (5 fever perfects = „Encore" 5 s, notes ×2) · audit BPM sync after pause/resume + late-join spawns; fishingPond rare species set (3 new sprites/weights into the v2 fish collection; set-of-3-in-one-run +15) · audit reel tension window vs frame hitches + boot odds; bubblePop chain-pop (3 same-color ≤ 2 s pops that color's neighbors) · audit spiky touch radius + color-blind readability; trampoline trick chaining (3 distinct tricks one air = Combo-Flip +12) · audit armed-boost double-fire + landing after tier-up; starHopper wormhole (rare gate, 2 s autopilot, +1 star/0.2 s) · audit lane-swipe vs 2-lane conflict + shield respawn; pipeFlow leak-timer variant from puzzle 3 (drip joint, 25 s or −5) · audit rotation-tap racing fill anim + solver desync after skip; deliveryRush fragile parcel (1 of 3 marked: crash = −20, clean = +15) · audit drop-ring detection at speed + route-line z-fighting; miniGolf hole 7 „Nougat-Loop" (loop + moving Nougatschleuse obstacle, par 3, plays only when all 6 ≤ par+1) · audit windmill collision timing + power-cap drag on small screens.
> **Verification specifics:** suite+lint+build green (danceParty chart tests + economy caps unmodified). CDP to `/tmp/gooby-v3-g44/`: per game feature-firing evidence + audit verdict + 3 autoplay runs in-row (fishingPond set bonus needs a seeded run — use the logic seed; miniGolf hole 7 entry condition proven both ways; danceParty pause/resume sync dump via `getMusicTime()` before/after). Per-game verdict table. deliveryRush still ≤ 180 draw calls.
> **Dependencies:** waves 1–2 (G39 feel, G35 schleuse builder, G32 audio). **Ports:** vite 5178 / CDP 9224.

### V3/G45 — depth+audit C: goobySays, gardenRush, burgerBuild, veggieChop, goalieGooby + their §C11.1 prop swaps (slot E) — model: **solfast**

> You are build agent V3/G45 for GOOBY 3.0 „ECHT & GROSS". Same charter as G43 for the 5 minigamesD-file games, plus the two §C11.1 minigame prop swaps that belong to your games. **Your mission:** 5 depth rows + audits verbatim, and veggieChop's cutting board / burgerBuild's counter become real Restaurant-Bits models.
>
> **Read (after AGENTS.md):** PLAN3.md §C10.2 (your 5 rows), §C11.1 minigame-props row (veggieChop → `kaykit-restaurant/cuttingboard`; burgerBuild counter → Restaurant Bits counter — verify the exact committed name in G31's manifest, §D2.2 lists `kitchencounter_straight`; swaps keep/lower draw calls, hitboxes stay data-driven), §C1.2 (goobySays pad-tap at 85 % scale is your audit). Then read your 5 games' files + `test/minigamesD.test.js`, `framework.js`.
>
> **OWNS (modify):** `src/minigames/games/{goobySays,gardenRush,burgerBuild,veggieChop,goalieGooby}.js` + `.logic.js`, `test/minigamesD.test.js` (extend), `src/data/strings/v3-depth-c.js`. **(shared-append):** `sfxMap.js` ONE marked block.
> **DO NOT TOUCH:** every other game + minigamesA/B/C/E test files, everything wave 1–2, G46's wave-4 sweep scope (rooms/city/shop props — yours are ONLY the two in-game props above).
>
> **Your rows (§C10.2 verbatim):** goobySays chord rounds from round 6 (two pads together, both ≤ 250 ms apart) · audit pad registration at 85 % scale + replay speed floor; gardenRush sprinkler powerup (all rings +50 %, spawns once at 30 s) · audit hold-release ring drift vs frame rate; burgerBuild rush orders (gold ticket 1.5× points, −20 % timer, ≤ 2/round) · audit column drift at 393 px + wrong-catch splat overlap; veggieChop frenzy wave every 25 s (8 veggies/3 s, no junk) · audit swipe-trail hits at low fps + combo reset on junk; goalieGooby penalty shootout finale (last 10 s: 5 telegraphed shots, saves ×2) · audit swipe misread near edges + super-save slow-mo timer leak.
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v3-g45/`: per game feature evidence + audit verdict + 3 autoplay runs in-row; goobySays chord round at 85 % scale specifically; prop swaps before/after shots with `renderer.info` proving no draw-call increase. Per-game verdict table.
> **Dependencies:** waves 1–2 (G31 restaurant models). **Ports:** vite 5179 / CDP 9225.

---

## E6. WAVE 4 — real-asset sweep, UI reskin, integration/ship (launch G46–G48 in parallel; wave 3 + batch-eval fixes merged, pushed, CI green)

### V3/G46 — real-asset replacement sweep (slot A) — model: **solfast**

> You are build agent V3/G46 for GOOBY 3.0 „ECHT & GROSS". 3.0's „real game" promise means the remaining primitive stand-ins become committed Kenney/KayKit models wherever that RAISES quality — while Gooby, cakes, ghosts, and outfit-fit items stay procedural by design. **Your mission:** execute the §C11.1 swap list (minus G45's two in-game props, already done) — reward furniture, garden, room dressing, city dressing, shop interior.
>
> **Read (after AGENTS.md):** PLAN3.md §C11.1 (ALL — the swap table is binding, incl. what STAYS procedural: goldfish bowl, compost bin; rules: swaps keep/lower draw calls, metalness normalization v2 FIX-F, hitboxes stay data-driven, ids/rewards unchanged), §D2.3/§D5 (committed model names — G31's manifest is the whitelist of record). Then read `src/home/decor.js` (FULLY — reward-slot builders from V2/FIX-C), `src/home/rooms/{kitchen,living,bathroom,bedroom}.js` + `rooms/garden.js` (dressing anchors), `src/city/cityBuilder.js` (dressing pass — G39's port table is merged; touch ONLY scenery placement, never road logic), `src/ui/shopScreen.js` or the shop scene (interior shelving), `src/gfx/materials.js` (metalness normalization helper), `test/furniture.test.js`.
>
> **OWNS (modify):** `src/home/decor.js` (reward swaps: golden watering can → `survival-kit/bucket` re-tinted gold + procedural spout; toy city → 3 toy-car-kit track minis on a base; candy jar → `kaykit-restaurant/jar_A_large` + candy tint; goldfish bowl UNTOUCHED), `src/home/rooms/*.js` (marked blocks: §C11.1 furniture-kit dressing ≤ 3 new draw calls per room; nature-kit garden additions), `src/city/cityBuilder.js` (marked block: kaykit-city streetlight/hydrant/dumpster/bench/trash seeded sidewalk dressing, instanced where > 3), the shop-interior surface you located (6 mini-market props from crates/boxes), `test/furniture.test.js`/`test/rooms.test.js` (extend: swapped modelKeys resolve to committed files; reward ids/rewards unchanged).
> **DO NOT TOUCH:** `styles.css` (G47 exclusive), README/AGENTS/whatsNew/onboarding (G48), any minigame file, `roomManager.js` room logic (dressing anchors only via the rooms files), all pure engines.
>
> **Verification specifics:** suite+lint+build green. CDP to `/tmp/gooby-v3-g46/`: before/after shots per swap area (4 reward items, garden, each room, city sidewalk, shop interior); `renderer.info` per touched scene proving draw calls did NOT rise (home ≤ 120, garden ≤ 130, drive ≤ 180 — v2 budgets hold); reward-furniture placement flow regression (place all 3 swapped rewards); metalness spot-check dump on 3 new GLBs. No new UI → no layout matrix.
> **Dependencies:** waves 1–3. **Ports:** vite 5175 / CDP 9221.

### V3/G47 — UI reskin: Kenney ui-pack 9-slice (slot B) — model: **fable**

> You are build agent V3/G47 for GOOBY 3.0 „ECHT & GROSS". The DOM chrome is flat CSS; 3.0 reskins ~80 % of it with Kenney ui-pack 9-slice sprites for structure/bevel while the cream/teal/pink identity palette stays. **Your mission:** execute §C11.2 exactly — you own `styles.css` exclusively this wave, and the §C1 layout bars must hold AFTER the reskin.
>
> **Read (after AGENTS.md):** PLAN3.md §C11.2 (ALL — component map, the hue-rotate prohibition, keep-list for toasts/HUD pills, acceptance), §D4 (the ~34 committed sprites in `public/assets/ui/`), §B3/§C1.2 (rem discipline + px-audit gate — border-image slice values may stay px per the exemption list; extend the allow-list in `scripts/px-audit.mjs` if needed, justify), §C2.1 (the 5 sliders get the rail/fill/knob treatment). Then read `src/ui/styles.css` (FULLY — post-G33 rem state), `scripts/px-audit.mjs`, the component-injected CSS strings G33 flagged in its report, `src/ui/{settingsScreen,shopScreen,wardrobeScreen,arcadeScreen,albumScreen,questBoard}.js` (class hooks).
>
> **OWNS (modify):** `src/ui/styles.css` (EXCLUSIVE: `.card` → button_square_border 24 px slices; primary `.btn` → button_rectangle_depth_flat with pressed `_flat` + 2 px translate; `.seg`/toggles → check_round_*; volume sliders → slide_horizontal_grey rail + color_section fill + slide_hangle knob; results stars → star/star_outline; tab underlines stay CSS; toasts/HUD pills KEEP current CSS), `scripts/px-audit.mjs` (allow-list additions only), minimal marked class-hook one-liners in UI component files if a surface lacks a stylable class (report each).
> **DO NOT TOUCH:** decor/rooms/city (G46), README/whatsNew/onboarding/pbxproj (G48), any behavior code, any wave-1–3 module logic.
>
> **Verification specifics:** suite+lint+build+px-audit green. CDP to `/tmp/gooby-v3-g47/`: ① side-by-side before/after of the 8 reskinned surfaces (settings, shop, wardrobe, arcade tiles, album, quest board, results, dialog/sheet) — §C11.2 acceptance; ② identity check: background #FFF6EC/text #4A3B36/teal-pink accents sampled unchanged; ③ 9-slice seam audit at 130 % AND 85 % scale on all 8 surfaces (close-up shots — zero seams/stretch artifacts); ④ pressed-state + toggle + slider interactions still work (tap sequences); ⑤ reduced layout matrix: the 8 surfaces × 320/430 × 85/130 % × EN+DE with the overflow probe — zero regressions vs G33's baseline. 
> **Dependencies:** waves 1–3 (G33's rem baseline). **Ports:** vite 5176 / CDP 9222.

### V3/G48 — integration & ship: docs, whatsNew 3.0, ribbons, version 3.0.0, sweep (slot C) — model: **solfast**

> You are build agent V3/G48 for GOOBY 3.0 „ECHT & GROSS". Ship-readiness: a v2 player must get a one-time What's-new-3.0 panel, fresh onboarding must still work, the arcade's flagships get their NEU ribbons, docs must describe 3.0, and the iOS marketing version must read 3.0.0. **Your mission:** the polish/integration layer + a whole-game observational sweep.
>
> **Read (after AGENTS.md):** PLAN3.md §A2 (you sweep against it), §C10.3 (NEU ribbon: wide tile treatment for the 2 flagships, first 3 local days after first unlock), §E0.1-8 (whatsNew3Seen — G34 landed the flag), PLAN2 §E5-G30 (the v2 precedent for this role). Then read `src/ui/whatsNew.js` (v2 panel — extend the pattern, don't break the v2 flag logic), `src/ui/onboarding.js`, `src/ui/arcadeScreen.js`, `README.md`, `AGENTS.md`, `ios/App/App.xcodeproj/project.pbxproj` (MARKETING_VERSION lines), `test/onboarding.test.js`.
>
> **OWNS (modify):** `src/ui/whatsNew.js` (3.0 panel: 6–8 bullet tour — 27 games/2 flagships, Stickerbuch, Nougatschleuse, UI scale + sliders, 42 outfits, driving; shows once for `whatsNew3Seen === false`, sets it true; v2 panel logic untouched), `src/ui/onboarding.js` (additive: fresh-run completion regression + one light teaser line if natural — machine stays resumable), `src/ui/arcadeScreen.js` (marked block: §C10.3 NEU-ribbon treatment, local-day math via `clock`), `ios/App/App.xcodeproj/project.pbxproj` (MARKETING_VERSION 2.0.0 → **3.0.0**, both configurations), `README.md` (3.0 section: 27-game list, sticker book, audio engine, scale/sliders/dev panel, 42 outfits, travel methods, counts), `AGENTS.md` (3.0 deltas: v3 strings-module rule, constants re-freeze, PACK_FORMATS/getSkinnedModel, musicDirector contexts, new harness params — collect them from the wave reports: `?open=devPanel`, `?uiscale=`, `?notch=`, `?petdebug=`, `?scene=roadtest`, `?travel=surf`), `src/data/strings/v3-polish.js`, `test/onboarding.test.js` (extend: whatsNew3 show-once migrated-vs-fresh).
> **INTEGRATION SWEEP (observe + report; fix only trivial ≤ 5-line issues in files you own or via marked one-liners; else file for the coordinator):** fresh `?reset=1` → full onboarding → daily bonus; migrated v1 AND v2 fixture boots → whatsNew 3.0 once → home intact; every §A1 workstream surface reachable ≤ 2 taps from its natural home; a 20-minute scripted free-play (sticker unlock, nougat glob, surf travel, cake round, dev panel OFF for normal player) with a start-to-finish console error log (zero-errors bar); arcade shows 27 tiles, zero „coming soon".
> **DO NOT TOUCH:** every feature's internals (G46/G47 concurrent — observe only), `styles.css` (G47), minigame files, engines.
>
> **Verification specifics:** suite+lint+build green; `npx cap sync ios` clean; `grep MARKETING_VERSION` shows 3.0.0 ×2. CDP to `/tmp/gooby-v3-g48/`: whatsNew-3.0 on migrated saves once + never on fresh (3 boots documented); NEU ribbon on both flagship tiles + gone after +4 local days (`?now=` math); onboarding full run; sweep evidence (console log, reachability table). Layout matrix on the whatsNew panel per §E0.2.
> **Dependencies:** waves 1–3 (sweeps them); G46/G47 concurrent — note what you could not observe. **Ports:** vite 5177 / CDP 9223.

---

## E7. Team-eval agents (read-only; run per §E0.1-12)

### E7.0 TEAM-EVAL PREAMBLE (relay verbatim after each block below)

> You are a READ-ONLY team-eval agent for GOOBY 3.0 (`/workspace/GOOBY`; three.js + Vite + vanilla ESM virtual-pet game, EN+DE, portrait 320–430 px). You evaluate ONE team's freshly merged work against its binding PLAN3.md spec — adversarially, repro-first. **Rules:** no edits, no commits, no fixes. Read `GOOBY/AGENTS.md` first (VM/CDP recipe; SwiftShader is slow — correctness over fps; no audio device — `audio.getStats()` + console logs are the audio evidence standard). Use YOUR ports only; never 5174/tmux. Drive real flows over CDP (`Input.dispatchTouchEvent`, `Runtime.evaluate` on `window.__gooby`, `Page.captureScreenshot`); use the dev harness params (AGENTS.md + the team's report). Evidence to your `/tmp/gooby-v3-e-<team>/` dir; copy the 3–6 most probative artifacts to `/opt/cursor/artifacts/` prefixed `v3<team>_`. **Verdict format:** ① VERDICT PASS / PASS-WITH-NOTES / FAIL vs your pass bar; ② findings `[P0|P1|P2] title — repro steps — evidence path — suspected file` (P0 = crash/save-loss/unplayable/CI red; P1 = spec number wrong or feature broken with workaround; P2 = polish); ③ your charter's measurement tables; ④ what you could NOT verify and why. The coordinator resumes the build agent(s) with your P0/P1 rows verbatim — write them to be actionable. Kill your processes by PID when done.

### V3/E-CAKE — purblePlace team eval (slot A, vite 5175 / CDP 9221) — model: **fable**

> Charter: grade `purblePlace` against PLAN3.md §C9 (read ALL of it + §A2's flagship bullets + §C10.1 distinct-look rule). Verify with live CDP play + the logic tests: every §C9.2 ticket dimension appears (incl. „none" icing/topping and candles 0–4 with the ≥-serve-4 weighting); patience 45→30 s floor math; all 6 stations' windows incl. the oven green zone (+5/−0/−3) and the belt's single fix-loop; §C9.4 scoring matrix (+20/+8/−5, combo cap +10, speed bonus +4) via scripted serves of a perfect / one-wrong / two-wrong cake; ramp (interval −2 s/serve, belt +6 %/3 cap +24 %); 210 s round; 5 autoplay runs — bot ≥ 90 avg, payouts in `5/5/30`, typical ≈ 26 c, energy 8, unlock L6 (`?level=5` locked, 6 open); NPC lifecycle walk→sit→cheer/sad with ≤ 1 animated skinned + ≤ 250 draw calls (`renderer.info`); meta → `cakesServed`/`perfectCakes` counters + cakeBoss sticker on first perfect; layout: HUD + tickets at 320@130 % and 430@85 % EN+DE (tickets are the stress surface). **Pass bar:** every §C9 number observed correct; bot bar met; zero P0.

### V3/E-SURF — shoppingSurf team eval (slot B, vite 5176 / CDP 9222) — model: **fable**

> Charter: grade `shoppingSurf` (G37) AND the travel integration (G38) against PLAN3.md §C8 (ALL) + §A2's „2 travel methods" bullet. Arcade: controls (buffered input 250 ms, tap does nothing), every §C8.3 obstacle incl. the never-all-3-lanes crate validator and the ≤ 1 animated skinned NPC, crash/stumble/invulnerability + 3rd-crash end, near-miss +2 at 0.35 m, all 4 §C8.4 powerups + spawn spacing rules, speed ramp 8→16, score formula, 5 autoplay runs ≥ 600 m avg with payouts in `40/5/34`, energy 8, L5 unlock, ≤ 250 draw calls. Travel: door sheet two options both showing 6 energy; „Laufen" 700 m run → forgiveness jog after 3rd crash → finish arch → arrival handoff IDENTICAL to a drive arrival (compare panels); rewards = coins collected cap 30 + 5 clean bonus, ×2 AFTER clamp once/day (script both a 12-coin and a 40-coin run); `trips` +1 both methods, `surfRuns` both modes, surfStar sticker; „Fahren" regression incl. tow rule; sleeping/sick gates. The 200-seed never-impossible logic test exists and passes. Layout: HUD at the §E0.2 grid. **Pass bar:** every §C8 number correct incl. the travel-reward math; both travel methods end in the identical handoff; zero P0.

### V3/E-DRIVE — driving-overhaul team eval (slot D, vite 5178 / CDP 9224) — model: **fable**

> Charter: grade the §C7 overhaul (G39). Road fit: run `?scene=roadtest`, independently derive the port table from the render, and CHECK IT AGAINST the committed `PIECE_PORTS` (this is the core audit — G39's own screenshots don't count); `test/cityRoads.test.js` passes and actually asserts the §C7.1-3 properties (read the test critically); 4 quadrant top-down shots — curb lines continuous through EVERY corner/T/crossroad, zebra perpendicular; 20 fresh seeds via console `generateCityLayout` spot-checked. Feel: scripted step-input telemetry — smoothing τ = 120 ms ± 10 %, rate cap 90°/s, assist ≤ 8°/s fading to 0 at 25° and OFF at ≥ 40 % deflection, camera lerp k=4.0 + look-ahead 6 m + FOV 55→60, arcade cap 15 m/s after 20 s, trip speed pinned at 9→13 UNCHANGED. Invariants (§C7.3): shopTrip/vet/deliveryRush tests green with their EXISTING assertions unmodified — git diff the test files vs the wave-1 tree; G38's additive surf-travel tests in `shopTrip.test.js` are expected, any change to a pre-existing assertion is a finding; trip rewards/energy/tow bit-identical in live runs. **Pass bar:** independent port-table derivation matches; all feel constants within tolerance; invariants untouched; zero P0.

### V3/E-GAMES — wave-3 batch eval: 4 new games + depth pass + outfits (slot A, vite 5175 / CDP 9221) — model: **solfast**

> Charter: grade G41+G42's four games against §C10.1 (each design bullet: toyRacer drift/items/rubber-band + score formula; ghostHunt chains/decoys/boo-waves/powerups; rocketRescue fuel/landing classes/wind/auto-tow; harborHopper waves/seagull/horn), rows/energy/unlock levels via constants + live badges, 3 autoplay runs each in-row, distinct looks (screenshot all 4 + assert no palette collision with each other or the flagships), bots hit typicals, ≤ 250 draw calls each. Then the §C10.2 depth pass (G43/G44/G45): for EACH of the 20 rows (cityDrive excluded — E-DRIVE's), confirm the feature exists and fires (spot-play 8 games live incl. at least: carrotCatch golden carrot, memoryMatch peek, danceParty encore + pause/resume sync, miniGolf hole 7 both entry conditions, deliveryRush fragile parcel, goobySays chords at 85 % scale) + each audit column has a verdict in the agents' reports (cross-check 5 claims by repro). Outfits (G40): 42 catalog count, back-slot equip + flutter, minLevel locks, wardrobe open-time bar, fit spot-check at weight extremes for 4 back items. **Pass bar:** 4/4 new games §C10.1-conformant; 20/20 depth rows present with credible audit verdicts (≥ 5 independently reproduced); outfit §C13 numbers exact; zero P0.

---

# §F. Final Eval Plan — 20 independent evaluation agents + fix loop (3.0)

## F1. How evals run

Launch after §G's CP-W4 is green (all 18 build agents + all team-eval fix rounds merged, suite ≥ 1050 green, pushed, CI green). Evals are **READ-ONLY**: they observe, measure, and file verdicts — never edit/commit/fix. Up to 6 run concurrently on the §E0.3 slots (eval n uses slot `((n−1) mod 6)`: vite `5175+((n−1) mod 6)`, CDP `9221+((n−1) mod 6)`). Each eval gets its §F2 block + the §F1.1 preamble, forwarded verbatim as one message, and is launched on its **model tag** (10× `fable` for deep domains, 10× `solfast` for broad sweeps).

### F1.1 COMMON EVAL PREAMBLE (relay verbatim after each §F2 block)

> You are eval agent V3-E<n> for GOOBY 3.0 „ECHT & GROSS", a finished(?) Pou-class virtual pet in `/workspace/GOOBY` (three.js + Vite + vanilla ESM, Capacitor iOS, EN+DE, portrait 320–430 px): fat procedural rabbit, 27 arcade minigames incl. the shoppingSurf and purblePlace flagships, real-time garden, sickness/vet/weight sim, quests, collections + a 28-sticker AI Stickerbuch, drivable city with 2 travel methods, jingle-medley music on 5 buses with volume sliders, UI scaling 85–130 %, hidden dev panel, 42 outfits, Nutella + Nougatschleuse, save v3. Judge it against the binding specs: `GOOBY/PLAN3.md` (3.0), `PLAN2.md` (v2 numbers), `PLAN.md` (v1 contracts).
>
> **Rules.** READ-ONLY: no file edits, no commits, no fixes, no constants „corrections". Read `GOOBY/AGENTS.md` first (conventions + VM/CDP recipe; SwiftShader is slow — correctness over fps; NO audio device — `audio.getStats()` + console logs are the audio evidence). Read the PLAN3.md sections your charter names. Use YOUR ports only; never 5174/tmux. Drive real flows over CDP; reach states fast via the harness (`?reset/?scene/?room/?minigame/?autoplay/?fast/?now/?coins/?level/?lang/?open=devPanel/?uiscale/?notch/?petdebug/?travel`, see AGENTS.md 3.0 section). The dev panel (unlock via 5 taps on language „Auto", or `settings.devUnlocked` console set) is a legitimate eval tool — use its overlay/pinning cards. Kill your own processes by PID when done.
>
> **Evidence.** Everything to `/tmp/gooby-v3-e<n>/`; copy your 3–8 most probative artifacts to `/opt/cursor/artifacts/` prefixed `v3e<n>_`. Every claim must map to an artifact or command output.
>
> **Verdict format.** ① VERDICT: PASS / PASS-WITH-NOTES / FAIL against your pass bar; ② findings, each `[P0|P1|P2] title — repro — evidence path — suspected owning module (§E0.4 roster)`; P0 = ship-blocker (crash, save loss, unplayable game, §A2 count/number violated, CI red), P1 = must-fix (broken spec behavior, wrong math, layout break), P2 = polish; ③ your charter's tables; ④ what you could NOT verify and why. Be adversarial: a PASS with untested claims is worse than a FAIL.

## F2. The 20 charters

**— fable (deep domains) —**

**V3-E1 [fable] — economy re-simulation incl. 27 games + 3.0 sinks/sources.** Read PLAN2 §C1.1/§C6-v1 rules, PLAN3 §C8.5/§C9.5/§C10.1 rows, §C8.6 travel rewards, §C6 (nutella 45 c, schleuse 400 c), §C13.2 prices, §C5.5/§C6.4 achievement coins. Suite economy sim green; empirically: 5-run autoplay payouts for ALL 27 games in-row with 10–15 c/min sanity (flagships premium ~25 c), first-play ×2 once, energy exact (6 car/travel, 8 rest); travel-surf cap 30+5 vs cityDrive trip parity (no dominant strategy — measure c/min both); a scripted „average 15-min day" ×3 pinned days nets ≥ +100 c after food; sink audit: a mid-game player can afford the schleuse in ≤ 1 week and the 42-outfit catalog retains multi-week sinks (~9.4 k c total — sum it); exploit hunt: sticker/achievement one-time coins not farmable, nougat cooldown not bypassable by clock pinning backwards, sell-buy arbitrage still negative, dev panel coins gated behind devUnlocked. **Pass bar:** all payouts in-row, day-net target met, zero exploits.

**V3-E2 [fable] — save v1→v3/v2→v3 migration + hostile fuzzing.** Read PLAN3 §B1 (ALL), PLAN2 §B2, PLAN §E3. Suite green (saveV3); live: inject committed v1 AND v2 fixtures → `v===3`, every legacy field byte-identical (deep-diff dumps), new slices/keys at exact §B1 defaults (settings.volumes {80,100,70,100,80}, uiScale 100, devUnlocked false, stickers/nougat empty, `outfits.equipped.back` null, 9 new counters), `music:false` v2 save boots muted with slider at 70 (§B1-2 honesty rule); validate clamps: uiScale 90→100, volumes −5/999/NaN→defaults; whatsNew3Seen false only for migrated; forward-version v4 refused with backup; ≥ 40 live hostile mutations beyond the suite (stickers.unlocked non-object, nougat.lastGlobAt string, volumes array, back:'cape'-invalid, truncated JSON, 10 MB payload) — every load lands in a valid playable state, zero console errors; save→load→save byte-stable; mid-minigame kill + reload; `?reset=1`. **Pass bar:** zero data loss on legit saves, zero crashes on hostile ones.

**V3-E3 [fable] — flagship depth & fun verdict.** Read PLAN3 §C8/§C9 (ALL) + §A („real game" sentence). You are the product-owner proxy: play BOTH flagships extensively via CDP (≥ 20 min each, manual-scripted play, not just bots). Judge: session arc (does surf's ramp create tension? do cake orders stack into satisfying pressure?), input feel (buffered swipes, station timing readability), juice audit (near-miss feedback, perfect-bake moment, NPC reactions), difficulty curves vs the spec's typical scores (measure your own runs against 800–1100 / 120–150), first-session comprehension (launch each with zero context — is the goal obvious?), and „would a kid replay this?" — argue it. Cross-check every §C8.2–§C8.5 + §C9.2–§C9.5 number you touch along the way. Verify both games surface correctly in arcade (NEU ribbon §C10.3, wide tiles). **Pass bar:** both flagships §C-conformant AND argued genuinely fun/deep — a mechanical-but-flat flagship is a FAIL with specifics.

**V3-E4 [fable] — driving feel + road connectivity.** Read PLAN3 §C7 (ALL). Independently re-derive the port table from `?scene=roadtest` renders and diff against `PIECE_PORTS`; sweep 30 fresh seeds (`generateCityLayout`) with a scripted connectivity checker over `Runtime.evaluate` (don't trust the committed test blindly — re-implement the §C7.1-3 assertion in your probe); visual curb-continuity audit on 6 quadrant shots incl. crossings; feel telemetry: τ 120 ms ± 10 %, 90°/s cap, assist curve (8°/s max, 0 at 25°, off ≥ 40 %), camera k=4.0/look-ahead 6 m/FOV ramp, arcade 15 m/s, trip 9→13 UNCHANGED; regression: full shop trip, vet trip, deliveryRush round — rewards/energy/tow/crash numbers bit-identical to v2 specs; motion-comfort check at 130 % scale overlay (§C7.2). **Pass bar:** independent derivation matches, 30/30 seeds connected, feel constants in tolerance, zero regressions.

**V3-E5 [fable] — audio engine correctness: buses, sliders, medleys, danceParty contract.** Read PLAN3 §B2 (ALL), §C2, §C3 (ALL), §A2 audio bullets. Via `getStats()` + console: bus graph (voice/ambience split out — Gooby squeak routes voice, rain routes ambience), slider math `(v/100)^2` per bus + master ×0.9 at 5 slider positions each, boolean mutes (sfx-bool kills voice too, music-bool kills ambience + tears down the medley with ZERO nodes created while muted — 60 s probe), sliders-at-0 keep engines alive (gain-0 only); all 5 medley contexts play file-based bars (verify `medley:<ctx>`, bar grid 3.2 s, crossfades, no jingle repeat within 8 bars over a logged 16-bar phrase, glue bed on music bus), context switching on room/screen changes (home→garden→arcade→city→shop walk), 800 ms crossfade; danceParty: synth track intact, chart sample-accurate (`getMusicTime()` vs note grid after pause/resume), tierUp HIT00 accent on sfx bus; results stingers best/normal/zero (script all 3); §C3.5 loudness: no sfx peaks > −6 dBFS via the dev-panel master-peak meter during a 10-min mixed session; preloadSamples cache hits + LRU bound. **Pass bar:** every §B2/§C2/§C3 mechanism verified with dumps; mute airtight; danceParty contract untouched.

**V3-E6 [fable] — minigame framework + 27-game regression.** Read PLAN §E8, PLAN2 §C1 shared rules, PLAN3 §B8/§C10. The autoplay chain: all 27 games via `?minigame=<id>&autoplay=1&level=40&energy=100` sequentially — per-game table: completed? | raw score | payout | in-row? | ×2 once? | pause/resume OK | meta forwarded | console errors. Framework consistency (countdown/pause/results/payout, sick/exhausted refusal, per-game `sfx:[]` preload firing); every game still launchable at its unlock level and locked below; v1/v2 games' §C10.2 depth features didn't move coin rows/energy/caps (diff the payouts against v2 rows); `.logic.js` purity for all new games (node imports); the 21 legacy games' existing tests unmodified except justified §C10.2 edits (git-diff audit of test/ vs the 8bdaab8 baseline — flag unjustified edits). **Pass bar:** 27/27 clean completions, in-row, zero framework regressions, test-edit audit clean.

**V3-E7 [fable] — full-game verdict + 45-min soak (the §A2 auditor).** Read PLAN3 §A (ALL). Walk „Definition of 3.0" item by item with evidence: counts (27/42/28/5/4/1/2 + Nutella — script-count catalogs + screenshots), real-audio floors (run `test/audioCoverage.test.js` + spot-verify 10 ids), quality bars (delegate layout/perf to E9/E10 but spot-check), invariants §A3 (Gooby procedural — grep for library models in character/; constants re-frozen — git log constants.js shows only G34; portrait; CRLF spot-check). Then a **45-minute continuous free-play soak** (fast clock where useful) across: onboarding-fresh start → care loop → nougat gag → surf travel → shop → cake rounds → sticker unlocks → garden → vet → dev-panel OFF normal play — console error log captured start-to-finish (zero-errors bar), plus a ranked „5 weakest spots" product verdict argued from the session. **Pass bar:** every §A2 item TRUE with evidence; zero console errors in the soak.

**V3-E8 [fable] — sticker book + achievements wiring (all 28 conditions).** Read PLAN3 §B5, §C5 (ALL — the 28-row table is your checklist), §C6.4. For EVERY sticker: trigger its exact condition live or via the closest legitimate path (counters via real actions where cheap — firstNom/squeakyClean/sleepyhead/roadTripper/firstSprout/sayCheese; events via real repro — grumpyWake early tap, rainCanopy/nightStars via `?now=` pinned weather/band garden entry, towed via 3 scripted crashes; game metas via autoplay/scripted runs — goldenCatch/discoGooby/holeInOneHero/cakeBoss/surfStar; level/weight/outfit specials via harness) — dev-panel sticker-fire is allowed ONLY for the ≤ 6 hardest, and each such use must ALSO verify the condition definition matches §C5.1. Verify: unlock toast + sound + queue throttle (bulk-unlock → 1/3 s), NEU dots + seen clearing, hints on locked detail sheets (non-spoiler), 5-page layout 6/6/6/6/4, n/28 header, art files render (no broken images — probe all 28), stickerBook10/20/Full at exact counts + nougatmeister at 25, achievements catalog 37, persistence across reload. **Pass bar:** 28/28 conditions correct (≥ 22 via real repro), UI truthful, 4 new achievements exact.

**V3-E9 [fable] — layout matrix strict: 40 combos × all screens.** Read PLAN3 §A2 layout bullet, §C1 (ALL). The full grid: 5 viewports (320×568, 375×667, 390×844, 393×852, 430×932) × 4 scales (85/100/115/130) × insets on/off (`?notch=1` / dev-panel toggle) = 40 combos. Screens per §C1.3: HUD/home, 5 rooms, arcade (27 tiles, 2-col rule at the §C1.2 threshold), shop 4 tabs, wardrobe 4 slots, album BOTH tabs + sticker detail, quest board, profile, photo mode, vet panel, settings + dev panel, onboarding 1–5, daily bonus, front-door travel sheet, results screens; game HUDs: ALL 27 at 320×568@130 % and 430×932@85 %, the 6 new + 4 worst v2 offenders at every combo. Script it: `Emulation.setDeviceMetricsOverride` + scale set + automated probes (horizontal-overflow scan, text-node overlap/clip rects, tap-target ≥ 44 real px, fixed-chrome vs inset rects) + EN/DE per surface. Deliver the full pass/fail grid (a big table — that's the job). **Pass bar:** ZERO clipped/overlapping text, zero < 44 px targets, zero chrome under notch/home-indicator across the grid.

**V3-E10 [fable] — performance budgets + resource/leak hygiene.** Read PLAN3 §A2 perf bullet, §D7, PLAN2 §A2.3 (v2 budgets still bind). Measure: committed assets `du -sb public/assets` ≤ 60 MB (report vs the §D7 ledger ≈ 30.6); draw calls per scene via `renderer.info` (home ≤ 120, garden ≤ 130, drive/deliveryRush ≤ 180, shoppingSurf/purblePlace ≤ 250 measured mid-run at max obstacle density, other games ≤ 150–250 per their spec era); per-frame allocation: 30-s heap deltas in 4 scenes (surf, cake, home, drive) — sawtooth OK, monotonic growth is a finding; skinned NPC caps (1 animated) via scene-graph dumps; decoded-audio cache ≤ 6 MB (`getStats()`); bundle: main chunk ≤ 1.6 MB gzip + every new game chunk ≤ 150 KB (build output table); leak audit: 20× home↔surf↔album↔cake switches → `renderer.info.memory` geometries/textures return to baseline ± 5, listener counts stable; 30-min fast-clock ambience soak → no interval/node accumulation (medley node count stable across context switches); scene-switch ≤ 1.5 s at 4× CPU throttle. **Pass bar:** every budget met with measurements.

**— solfast (broad sweeps) —**

**V3-E11 [solfast] — all-27-games completion table.** Read PLAN3 §C10.3, §A2 counts. Arcade shows exactly 27 tiles, zero „coming soon", unlock order per constants; for EACH game: launch at unlock level, one full `?autoplay=1` completion + one 30-s manual CDP interaction, record the standard table (score/payout/in-row/×2/pause/console); each §C10.1/§C10.2 headline feature spot-glanced (does the new mechanic EXIST — deep verification is E6/E-GAMES territory); distinct-look screenshot per game → 27-image contact sheet + palette-collision callouts. **Pass bar:** 27/27 complete cleanly; contact sheet delivered.

**V3-E12 [solfast] — all-content purchasability sweep.** Read PLAN3 §C13.2, §C6.1/§C6.3, PLAN2 §C7/§C8. With scripted coins/levels: buy + equip/use EVERY one of the 42 outfits (equip screenshot batch per slot incl. all 6 back items), all 7 skins, every food incl. Nutella (eat it — junk pipeline dump), medicine/fertilizer, the Nougatschleuse (install + glob), every furniture item incl. garden decor + reward exclusions (reward items NOT buyable), wallpapers/floors, garden plots 5/6, seeds all 8; minLevel gates honored (attempt-below fails politely); every price matches its table; quick-delivery eligibility (nutella yes §C6.1). **Pass bar:** 100 % of catalog purchasable+functional at spec prices; zero orphan items.

**V3-E13 [solfast] — strings EN+DE parity + copy quality.** Read PLAN3 §A2 i18n bullet, §E0.1-2. Script a key-diff across ALL v3-* modules (EN↔DE parity, no empty values, no key referenced in src/ that's missing from the merged dicts — grep `t('` sweep); frozen files untouched (git diff strings.js + v2-* vs baseline); spot-read 60 DE strings for language quality (the owner is German — flag Denglisch/wrong articles; „Nutella"/„Nougatschleuse" exact §A2); UI copy in context: 12 screenshots DE at 320 px (long-string stress: „Gießkannen-Wirbel"-class labels §C1.2); sticker flavor lines match §C5.1 verbatim; no hardcoded user-facing strings in new files (sample 20). **Pass bar:** parity clean, frozen files untouched, zero broken keys at runtime.

**V3-E14 [solfast] — dev panel + harness surface.** Read PLAN3 §B4, §C4 (ALL). Gate: 5-tap unlock (4 taps + foreign tap resets; 2 s inactivity resets; window 4 s), toast, persisted row, re-tap message, invisible pre-unlock (no button/hint/onboarding mention — sweep); every §C4.2 card behaves per spec (all 12 — unlock-all confirm sheet + full grant verification incl. 42 outfits/28 stickers/37 achievements; coins through economy with honest profile counters; stats/weight/health/weather/band/clock effects observable; notification test fires id 1 + shows permission state; overlay chip numbers plausible vs `renderer.info`; save export→import roundtrip; sticker-fire + quest-complete + daily-day-N); `?open=devPanel` works in dev regardless (§B4); every AGENTS.md harness param (v1/v2/v3 incl. `?uiscale/?notch/?petdebug/?travel/?scene=roadtest`) still functions — full checklist table. **Pass bar:** 12/12 cards exact, gate airtight, harness table green.

**V3-E15 [solfast] — notifications regression.** Read PLAN2 §B3 notifications row/§C2.4/§C3.5, PLAN §C7 (v1 rules). 3.0 touched settings/save — prove notifications survived: suite green; live `computeSchedule` dumps: ids 1–7 rules intact (wake/harvest/sick), quiet-hours 22–08 shift, 30-min spacing, MAX 7, reschedule-on-hide + cancelAll-on-open via CDP visibility events; dev-panel notification test card (id 1, 5 s); copy EN+DE unchanged; no NEW notification ids appeared without spec (grep NOTIFY). **Pass bar:** schedule outputs exactly v2-conformant in every scenario.

**V3-E16 [solfast] — CI / .ipa / plist / licensing.** Read PLAN §F, PLAN2 §A2.8, PLAN3 §A2 lint/CI bullet + §D licensing rules. `gh run list --workflow gooby-ios.yml` → latest run on the current SHA green both jobs; download the ipa artifact; verify: Payload/App.app binary, `public/` bundle contains a v3 chunk (shoppingSurf/purblePlace filenames from local `dist/`), stickers dir present in the bundle, icons; plist: **MARKETING_VERSION → CFBundleShortVersionString 3.0.0**, portrait-only both idioms, `UIRequiresFullScreen`, `ITSAppUsesNonExemptEncryption=false`, `CFBundleDisplayName=Gooby`, NO camera/mic/photo keys; no new pods (`package.json` diff — zero new deps); licensing: every `public/assets/kenney/<slug>/` AND `kaykit/<slug>/` has its License/LICENSE file (script the sweep), stickers are self-generated (no license needed — confirm no third-party marks in the art by eyeballing all 28), `file`-sweep for non-CC0 binaries; `npm run build && npx cap sync ios` clean. **Pass bar:** CI green on final SHA, ipa structurally valid at 3.0.0, licensing complete.

**V3-E17 [solfast] — code quality, purity, conventions.** Read PLAN §B/§E, PLAN3 §B (file paths), §E0.1 rulings. Lint clean; purity grep (no three/DOM under systems/, data/, *.logic.js — incl. nougat.logic.js/stickerBook.js/musicDirector's pure parts); constants.js single V3/G34 block (git log/diff audit); strings module ownership headers respected (each v3-* edited only by its owner — git log per file); marked-block hygiene (`// V3/G` attributable, no orphan debug code, no leftover console.log in src/ beyond established logging); JSDoc on new public APIs (assets/audio/stickerBook/nougat/musicDirector); CRLF check on new files; no MONKEYBAR references; `getSkinnedModel` used for every kaykit-characters consumer (grep — a raw `getModel('kaykit-characters/…')` is a P1); px-audit green; file structure matches §B module paths. **Pass bar:** all clean; violations with file:line.

**V3-E18 [solfast] — v2 feature regression: garden/vet/quests/collections/health/weight/photo.** Read PLAN2 §C2–§C6, §C9–§C12 (v2 numbers still bind). Fast regression battery over the surfaces 3.0 did NOT redesign: garden full cycle (radish + a slow crop, offline growth, rain auto-water, notification honesty), sickness thresholds (junk 5/8) + medicine + vet cure/checkup prices, weight tiers + cosmetic-only rule, quest roll/claim/reroll on pinned days + ≥ 6 pool events live, v2 collections (4 sets awardable, album „Sticker" tab intact NEXT TO the new Stickerbuch tab), photo mode capture (UI-less PNG at 3.0's reskin/scale — capture at 130 %), profile stats accumulate, daily bonus streaks, onboarding fresh run. Also re-run the §C12 acceptance now that waves 2–4 sat on top of the fixes: both wake paths clean (`?sleep=1`, early + natural), and the §C12.2 belly-rub bar (`?petdebug=1`, 10 rubs → ≥ 8 tickles, 0 misfires) at 390×844/100 %. Flag ANY v2 number drift. **Pass bar:** zero v2 regressions, §C12 acceptance holds.

**V3-E19 [solfast] — UI-sounds coverage + audio-map hygiene.** Read PLAN3 §C3.1/§C3.2, §D3.5 (the binding event→id→file table), §A2 coverage bullets. Static: run/read `test/audioCoverage.test.js` + independently recount the ratios from sfxMap.js (script it — 100 % ui.*/coin.* sample-backed, ≥ 65 % overall non-voice/non-loop); every §D3.5 row: trigger the UI event live and capture `getStats()` (button tap, panel open/close, select, error, countdown+GO, win flourish, toggle both ways, slider ticks throttled 80 ms, tab switch, primary CTA, coin get/spend/fly, card flip/match); every game's new-feature sounds mapped (zero unmapped-id failures — the onboarding test enforces, re-run it); synth whitelist respected (voice/ambience/says-pads/dance/bespoke list §C3.1 — flag any OTHER synth survivor among UI/economy ids); `ui.slider` 80 ms throttle measured. **Pass bar:** floors met by independent count, every §D3.5 row fires, whitelist exact.

**V3-E20 [solfast] — onboarding, whatsNew, persistence journeys.** Read PLAN3 §E0.1-8, PLAN2 §A3-12. Journeys: ① fresh `?reset=1` → full onboarding → daily bonus → first surf-travel trip → close/reopen → everything persisted; ② migrated v1 fixture → whatsNew 3.0 panel exactly once (and the v2 panel logic not double-firing) → home intact; ③ migrated v2 fixture → whatsNew 3.0 once; ④ fresh save never sees it; ⑤ uiScale/volumes/devUnlocked/stickers/nougat state survive 3 reload cycles + a mid-game kill; ⑥ localStorage + Capacitor-Preferences mirror parity (inspect the adapter); ⑦ NEU ribbons appear on first flagship unlock and expire after 3 local days (`?now=` jumps). **Pass bar:** all journeys clean with screenshots.

## F3. Fix loop (coordinator protocol, after all 20 verdicts)

1. **Triage:** `/tmp/gooby-v3-eval/triage.md` — one row per deduped finding: `id | P | title | evidence | owning module | owning §E agent | eval(s) to re-run`. P2s: batch into ≤ 1 polish agent per round or defer with justification.
2. **Fix waves:** group P0/P1 by §E0.4 ownership into fix agents `V3/F1…` (≤ 6/round, slots A–F, model tag: fable for engine/game-logic fixes, solfast for content/copy/layout fixes) with strictly disjoint files, each prompt = owning agent's product context + OWNS boundary + verbatim finding rows + §E0.2 COMMON RULES + a regression test per fixed P0/P1 where a pure surface exists + commit `GOOBY V3/F<n>: <summary>`. Prefer RESUMING the original §E agent when the findings map 1:1 to its scope (context is warm — §E0.1-12 pattern).
3. **Targeted re-evals:** after each fix wave + §G checkpoint: re-run ONLY the affected evals (fresh agents, same charters, prefixed „RE-EVAL round k — focus findings <ids>, then spot-check your full charter").
4. **Exit criteria (ship gate):** zero open P0/P1; four hard bars each PASS in their latest run — layout (E9 full 40-combo grid), economy (E1), migration (E2), audio floors (E5+E19); E16 green on the final SHA (re-run if any fix touched ios/, workflows, package.json, or build config); E7's soak repeated if > 10 P0/P1 were fixed in total.
5. **Loop** until exit; a finding surviving 2 rounds escalates to a dedicated debug agent with full history.

---

# §G. Coordinator Runbook (3.0)

## G0. Pre-wave gates (run BEFORE launching wave 1a)

1. **Baseline:** from `/workspace/GOOBY`: `git log --oneline -3` (HEAD = the PLAN3 commits on top of 8bdaab8), `npm install` if node_modules is stale, then `npm run lint && npm test && npm run build` — 873 green, lint clean. Any red at baseline: stop and investigate before anything else.
2. **Staging present:** `ls /workspace/asset-staging/kenney/INVENTORY.md /workspace/asset-staging/kaykit/INVENTORY.md` — both exist (they are gitignored; if missing on this VM, G31 cannot run — halt and restore staging first).
3. **STICKER GENERATION GATE (hard prerequisite for G34, §C5.2/§D6):** generate all 28 sticker PNGs — for each §C5.1 row, prompt = the shared prefix + the row's per-sticker prompt; save as `GOOBY/public/assets/stickers/<id>.png`. Then enforce: exactly 28 files with the exact §C5.1 ids; each 512×512 (re-encode with `ffmpeg -i in.png -vf scale=512:512 out.png` if needed) and ≤ 150 KB (`pngquant`-style budget per §D6); total ≤ 4.2 MB. Verification one-liner: `ls public/assets/stickers/*.png | wc -l` → 28, plus a size/dimension loop (`ffprobe` or `identify`). Eyeball all 28 (cute, on-brand, no text artifacts; regenerate misses). Commit them yourself: `GOOBY V3: 28 sticker-book PNGs (§C5.1/§D6, coordinator-generated)`. **Wave 1b's G34 must not launch until this commit exists** (its `test/stickers.test.js` locks the gate permanently).
4. Confirm the tmux dev server on 5174 is alive (`tmux attach -t gooby-dev-server`) for coordinator smokes; agents never use it.

## G1. Ports & concurrency

Six agent slots (§E0.3): A=5175/9221 · B=5176/9222 · C=5177/9223 · D=5178/9224 · E=5179/9225 · F=5180/9226. Slot assignments are printed in each §E block; team evals reuse their team's slot; final evals map `((n−1) mod 6)`. Stuck port after an agent dies: `lsof -ti:<port>` → kill that PID only (never `pkill -f`). Model tags: launch each agent on the model named in its block header (`fable` deep, `solfast` broad/fast).

## G2. Between-wave checkpoint (from `/workspace/GOOBY`, after every wave's commits land)

```bash
git -C /workspace log --oneline -10        # every expected "GOOBY V3/G<id>:" commit present?
git -C /workspace status --short           # tree clean (no half-committed agent debris)
npm run lint                               # exit 0
npm test                                   # exit 0 — targets: ≥950 after W1, ≥1000 after W2, ≥1040 after W3, ≥1050 after W4 (§A2 floor)
npm run build                              # exit 0; note main-chunk gzip + per-game chunk sizes
node --test test/assetBudget.test.js       # ≤ 60 MB (expected ≈ 30.6 after W1)
npm run px-audit                           # from W1b on (G33's gate)
```

Quick boot smoke (5174 or `npm run shot`): fresh `/?reset=1` boot + a v1-fixture AND v2-fixture save injected — home renders, zero console errors, `__gooby.store.get('v') === 3` (post-W1b). Any red → resume the owning agent with the failure log appended to its §E prompt; do not launch the next wave until green.

**PUSH + CI AFTER EVERY MERGED WAVE (owner requirement):** once the checkpoint is green: `git -C /workspace push origin main`, then `gh run watch $(gh run list --workflow gooby-ios.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')` — BOTH jobs green before the next wave launches. CI red = P0: fix (resume the responsible agent or fix trivial CI-only issues yourself), re-push, re-watch.

## G3. Wave execution order (with team-eval loops)

| step | action | gate to proceed |
|---|---|---|
| 0 | §G0 gates incl. sticker commit | all 4 green |
| 1a | launch **G31** (solo) | CP-W1a: §G2 + `getSkinnedModel` CDP proof in its report + §D7 ledger actual ≤ 60 MB → push + CI |
| 1b | launch **G32 ∥ G33 ∥ G34 ∥ G35** | CP-W1: §G2; medleys audible-in-stats on 5 contexts; scale 85–130 live; devPanel opens; v1+v2 fixtures migrate lossless; stickers test green; nougat + wake/belly acceptance in reports → push + CI |
| 2 | launch **G36 ∥ G37 ∥ G38 ∥ G39 ∥ G40** | CP-W2: §G2; both flagships complete via autoplay in-row; both travel methods reach the shop; cityRoads test green; 42 outfits equip → push + CI |
| 2e | launch **V3/E-CAKE ∥ V3/E-SURF ∥ V3/E-DRIVE** (read-only) | all 3 verdicts in |
| 2f | resume G36/G37+G38/G39 with their eval's P0/P1 rows (§E0.1-12); re-verify per finding (re-run the eval's repro steps or a targeted re-eval) | zero open P0/P1 from team evals → §G2 → push + CI |
| 3 | launch **G41 ∥ G42 ∥ G43 ∥ G44 ∥ G45** | CP-W3: §G2; 27/27 autoplay chain (script below); depth verdict tables in all 3 reports → push + CI |
| 3e | launch **V3/E-GAMES**; then fix round resuming G41–G45 as needed | zero open P0/P1 → §G2 → push + CI |
| 4 | launch **G46 ∥ G47 ∥ G48** | CP-W4: §G2; reskin before/after set; whatsNew-3.0 once; MARKETING_VERSION 3.0.0 ×2; 27-tile arcade; suite ≥ 1050 → push + CI |
| 5 | §F: 20 final evals (batches of ≤ 6, slot-mapped, model tags) | all 20 verdicts in |
| 6 | §F3 fix loop (fix waves ≤ 6, targeted re-evals) | §F3 exit criteria |
| 7 | §G4 ship checklist | shipped |

**CP-W3 27-game chain (sequential CDP sessions, record `{id, score, coins, errors}` → `/tmp/gooby-v3-cp3/chain.json`):**

```
for id in carrotCatch bunnyHop cityDrive carrotGuard memoryMatch runner basketBounce \
          pancakeTower danceParty fishingPond bubblePop trampoline goobySays gardenRush \
          burgerBuild veggieChop deliveryRush miniGolf goalieGooby starHopper pipeFlow \
          shoppingSurf purblePlace toyRacer ghostHunt rocketRescue harborHopper; do
  # navigate /?minigame=$id&autoplay=1&level=40&energy=100 ; await results ; log
done
```

27/27 must reach results with in-row payouts and zero console errors.

**Commit/push policy recap:** agents commit locally per §E0.2 and NEVER push. The coordinator pushes at: after CP-W1a, CP-W1, CP-W2, after the wave-2 fix round, CP-W3, after the wave-3 fix round, CP-W4, and after each §F fix round — watching `gooby-ios.yml` green each time (the owner wants regular commits + CI proof).

## G4. Final ship checklist

1. §F3 exit criteria met (zero P0/P1; layout E9 + economy E1 + migration E2 + audio E5/E19 bars PASS; E7 verdict PASS).
2. `npm run lint && npm test && npm run build` green on the final tree; asset budget ≤ 60 MB; `git -C /workspace log --oneline origin/main..main -- MONKEYBAR` empty; diff review — only GOOBY/ + workflow paths touched.
3. Final push: `git -C /workspace push origin main`.
4. Watch CI: `gh run watch …` (G2 command) → BOTH jobs green.
5. Download: `gh run download <run-id> --name gooby-unsigned-ipa --dir /tmp/gooby-v3-ship/`.
6. Verify the ipa: `unzip -l` shows `Payload/App.app/App`, `public/` with a v3 chunk (shoppingSurf/purblePlace names from local `dist/`) AND `public/assets/stickers/` (28 files), AppIcon assets; plist extract: **CFBundleShortVersionString = 3.0.0** (the wave-4 G48 bump — if it reads 2.0.0, CI built a stale SHA: re-run), portrait-only both idioms, `UIRequiresFullScreen=true`, `ITSAppUsesNonExemptEncryption=false`, `CFBundleDisplayName=Gooby`, no camera/mic/photo keys.
7. `cp /tmp/gooby-v3-ship/gooby-unsigned.ipa /opt/cursor/artifacts/gooby-3.0-unsigned.ipa`; also copy the CP-W3 chain table, E7's verdict, E9's grid summary, and the best `v3e*_`/`v3<team>_` artifacts.
8. Final report to the owner: §A2 counts table (actual vs target), team-eval + 20-eval verdict summary, fix-round history, deferred P2s with justification, sideload pointer (README).

## G5. Failure playbook

- **Agent dies mid-wave:** check `git -C /workspace status` for debris; reset uncommitted foreign-file damage surgically (`git checkout -- <file>` only for files outside every OWNS list); relaunch the agent with its §E block + a note of what already landed.
- **Same-wave append lost (main.js/harness/icons/sfxMap/styles):** the §E0.1-6 verify-after-commit protocol makes the LOSING agent re-apply; if both finished, run the grep yourself and resume whoever's block is missing.
- **index.lock contention:** agents retry per §E0.2; if a stale lock outlives its process (`lsof` on .git), remove it manually.
- **Suite red across agent boundaries** (integration break no single agent owns): reproduce, identify the owning §E0.4 row, resume that agent with the failing test output; if genuinely cross-cutting, a dedicated fix agent with an explicit two-module ownership grant.
- **CI red but local green:** almost always the pbxproj/workflow or an asset-path casing issue — inspect `gh run view --log`, fix via G48's scope (resume it) or directly if trivial.

*End of PLAN3.md. §A–§D by plan agent 1 (binding specs); §E–§G by plan agent 2 (team waves, evals, runbook).*
