# GOOBY 4.0 „VOLLVERSION FINAL" — Master Build Plan, Part 1 (§A · §B · §C-SYS)

**Status:** binding spec for the 4.0 release, systems half. PLAN.md (§E contracts), PLAN2.md and PLAN3.md remain binding history — 4.0 only *adds* or *explicitly overrides* where stated. Plan agent B writes `PLAN4-GAMES.md` (game/content specs, incl. Gooby Welt splat scenes and Endless modes); plan agent C appends §E–§G (waves/evals/runbook) reading BOTH files. Baseline: HEAD `0d3a2dd` — 1226 node:test green, ESLint 9 clean, CI unsigned .ipa green, 27 games, 42 outfits, 28 stickers, save v3, dev panel (12 cards), 5 volume sliders, jingle-medley music, committed assets 28 MB.

**4.0 in one sentence:** GOOBY 4.0 is the „it sounds and feels finished" release — real songs (owner-supplied GoobyMusic + CC0 Bordmusik) behind an in-game radio with per-track controls and cover art, a beat-synced level-up recap cinematic through 8 biomes, full XP transparency, timed minigame modifier events with shader-style arcade glow, a secret-codes system (incl. the 29th „herzGooby" sticker), a truly complete dev panel, sick-Gooby shop trips, gyro parallax, a persistent photo gallery with iOS export, a new layered app icon, hard economy guard rails, and a reorganized settings IA with a credits screen — on a lossless save v4.

---

## §A. 4.0 Product Definition & „Definition of 4.0"

### A1. Scope map (owner requirements → workstreams → spec)

| # | Owner requirement | Workstream id | Spec |
|---|---|---|---|
| 1 | GoobyMusic registry + in-game RADIO + per-track settings + now-playing + covers + Bordmusik interim + NO-synth policy | W-MUSIC | §B2, §B3, §C-SYS1 |
| 2 | Level-up recap cinematic every 5 levels (biome journey, beat-synced, skippable) | W-RECAP | §B5, §C-SYS2 |
| 3 | XP transparency (+N XP floaters, „Wie levle ich?" sheet, unlock preview) | W-XP | §C-SYS3 |
| 4 | Modifier events (50–120 min cadence, 6 types, arcade glow, notification id 8) | W-MOD | §B4, §C-SYS4 |
| 5 | Codes system („UpdateLiebe", „IchLIE3BDich" → herzGooby sticker #29) | W-CODES | §B6, §C-SYS5 |
| 6 | Dev panel „vollwertig" (6 new cards, economy ledger, splat teleport, cheat sheet) | W-DEV2 | §C-SYS6 |
| 7 | Sick Gooby may travel to the SHOP (medicine run) | W-SICKTRIP | §C-SYS7 |
| 8 | Gyro parallax in home rooms (optional, default off) | W-GYRO | §B8, §C-SYS8 |
| 9 | Photo gallery (IndexedDB, cap 40) + iOS share/save export + sticker-book discoverability | W-GALLERY | §B7, §C-SYS9 |
| 10 | App icon 2.0 (layered look, opaque 1024, splash match, dark/tinted stretch) | W-ICON | §C-SYS10 |
| 11 | Economy guard rails + updated economy sim acceptance | W-ECON | §C-SYS11 |
| 12 | Settings IA reorg (subscreens) + credits/attribution screen | W-SETTINGS | §B9, §C-SYS12 |
| — | Save v4 (lossless from v1/v2/v3) | W-SAVE4 | §B1 |
| — | Game/content workstreams (Gooby Welt, endless modes, new games) | — | PLAN4-GAMES.md |

### A2. Measurable acceptance („Definition of 4.0") — ALL must hold at ship

**Counts (exact):**

- **Radio ships full on day one:** ≥ **13 playable radio tracks** committed (the „Bordmusik" station: 13 CC0 files per §C-SYS1.7 — 5 Playful Piano loops + 7 Tallbeard loops + 1 Ragnar) **plus** 1 committed recap fallback track — 14 real music files total, each with a cover PNG and a loudness/duration manifest entry. Owner tracks dropped into `public/assets/GoobyMusic/` later join via ONE script run (`npm run music-manifest`) with zero code changes.
- **Music registry** auto-discovers `Kategorie - Titel.(mp3|ogg)`; empty-folder boot is graceful (no errors, Bordmusik still present because its files are committed under `public/assets/music/`).
- **Per-track controls:** every registry track has an enable/disable toggle and a 0–150 % trim slider (step 5) in Settings → Audio → „Musik & Radio", persisted in save v4 and audibly effective (`audio.getStats().radio` proves gain).
- **Now-playing chip** appears ≤ 500 ms after each radio/recap track start, auto-hides after 4 s, shows title + cover (fallback cover when missing).
- **Zero synth UI/gameplay sounds outside the frozen exemption list:** the §C-SYS1.9 sweep flips **46 synth sfx ids to real samples**; `test/audioCoverage.test.js` v4 asserts: every non-voice, non-loop id is `sample`-backed EXCEPT exactly these 9 frozen exemptions: `wash.splash`, `toilet.flush`, `garden.water`, `pipe.fill`, `tramp.bounce`, `tramp.boost`, `goalie.cheer`, `rocket.pickup`, `harbor.horn` (justifications §C-SYS1.9.3). Voice ids stay synthesized (identity exemption re-validated: NO cute-creature voice sample set exists in `/workspace/asset-staging/itchio/` — checked against the D1 REPORT; the 13 packs contain zero creature vocals). Loop recipes (`ambience.rain`, `ambience.birdsong`, `rocket.thrust`) stay synth (no loopable CC0 samples staged). danceParty's synth TRACK keeps the §C3.4-v3 ruling; its three hit blips flip to samples.
- **Recap cinematic:** triggers at levels **5, 10, 15, 20, 25, 30, 35, 40** (8 milestones); 60–120 s; skippable from second 10; **8 biome vignettes**; ≥ **14 delta stats** available, ≥ 12 shown per recap; text/camera cues land on the beat grid within **± 80 ms** of `beats.json` (verified via the dev-panel recap debug overlay, §C-SYS6). Retroactive-safe: a migrated L23 save shows NO instant recap; the next one fires at L25 with deltas counted from migration. Replayable from the profile screen (last 8).
- **Modifier events:** first event ≥ 30 min after v4 boot, then every **50–120 min** (seeded, persisted — survives reload); exactly ONE eligible game gets ONE of the **6 modifier types** (§C-SYS4.2) for **2–3 plays** or **45 min**, whichever first; arcade tile shows the VFX-texture glow + plays badge + countdown; notification id 8 respects quiet hours + cap; dev panel can force/clear. Full cycle proven in a pinned-clock eval run (force → play out → auto-reschedule).
- **Codes:** the two launch codes redeem exactly once per save with normalized input (§C-SYS5.2); „UpdateLiebe" shows a HUD ×2-coins chip counting down 10:00 and survives reload; „IchLIE3BDich" unlocks sticker #29 `herzGooby` (+50 c) — the sticker book renders **29 slots** (28 + 1 „Geheim"), `stickerBookFull` stays target 28 (§C-SYS5.4 decision). Wrong codes shake + toast; 5 wrong attempts in 60 s lock input for 30 s.
- **Gallery:** every captured photo persists to IndexedDB (cap **40**, oldest-first eviction); album gains a „Fotos" tab (grid + viewer + share/save + delete); native export works via the two NEW Capacitor plugins (§C-SYS9.4 — `@capacitor/share`, `@capacitor/filesystem`, both ^7; web fallback = existing share/download path). HUD album badge, onboarding hint and profile row link to it.
- **XP transparency:** all **12 XP grant sites** (§C-SYS3.1) fire a „+N XP" floater; the „Wie levle ich?" sheet lists every source with live numbers; the level-up toast previews the next unlock.
- **Dev panel:** 12 existing cards + **6 new cards** (13 Codes, 14 Modifier, 15 Recap, 16 Radio/Tracks, 17 Sprung/Splat-Teleport, 18 Harness-Spickzettel) + an economy ledger view inside card 3.
- **Sick-trip:** a sick Gooby can launch BOTH shop travel methods (drive + surf); arcade launches stay blocked; care sheet shows the three §C-SYS7.3 actions with the exact EN/DE copy.
- **Gyro:** off by default; the settings toggle runs the iOS permission flow in-gesture; pointer-parallax fallback on desktop; auto-suspends < 25 fps.
- **Icon:** `AppIcon-512@2x.png` (1024², colorType 2, NO alpha) regenerated from the coordinator's layered art via the `--source` bypass; splash matches; CI unsigned .ipa stays green (incl. `npx cap sync ios` on Linux).

**Quality bars:**

- **Zero P0/P1** open after §F eval waves (definitions unchanged from PLAN3 §A2).
- **Tests:** all existing **1226 stay green** (edited ONLY where a spec legitimately changed: `audioCoverage` floors, `assetBudget` limits, `notifyRules` cap 7→8, framework sick gate, `icons` source-bypass, economy sim v4 additions — never deleted to pass). 4.0 adds ≥ **220 new tests** (music registry/manifest, radio logic, per-track trims, modifier engine + scheduler fuzz, codes engine, recap engine + beat grid, gallery LRU logic, gyro clamps, save v4 lossless + ≥ 100 new fuzz seeds, economy v4 sim, sticker #29) → suite ≥ **1446 green** via `npm test`.
- **Lint/CI:** ESLint 9 flat config clean; GitHub Actions unsigned .ipa green at the 4.0 ship commit.
- **Save:** v1→v4, v2→v4, v3→v4 all lossless (every persisted field survives byte-for-value); fuzz corpus re-run against v4 + ≥ 100 new seeded mutations targeting the six new slices.
- **Assets:** committed repo assets ≤ **300 MB target**, **1.5 GB hard cap** (`test/assetBudget.test.js` v4: warn > 280 MB, fail > 1536 MB). Music files ship as OGG/MP3 128–192 kbps (never WAV). Every third-party file keeps its license note; CC-BY splat scenes MUST appear in the credits screen (§C-SYS12.4) — shipping a CC-BY asset without its credits row is a P1.
- **Audio perf:** radio playback creates ZERO decoded-buffer cache pressure (MediaElement streaming, §B2.3); airtight-mute rule extends to the radio (settings.music=false → zero nodes, element paused).
- **i18n:** every new user-facing string EN **and** DE via `src/data/strings/v4-*.js` per-feature modules (strings.js, v2-*, v3-* stay frozen — §E0.1-1 carries over).

### A3. Non-goals / invariants (binding)

- Gooby stays 100 % procedural; no framework/TS/build swaps; portrait-only; EN+DE only; CRLF endings — all PLAN3 §A3 invariants carry over.
- `src/data/constants.js` stays READ-ONLY **except** one wave-1 re-opening by the single foundations agent (§B10) for `SAVE.VERSION = 4`, `NOTIFY.IDS.modifier = 8` + `MAX_SCHEDULED = 8`, and the `CODES`/`MODIFIER` guard constants listed there; afterwards frozen again.
- The jingle-medley director is NOT removed — it stays the context-music fallback whenever the radio is off (owner requirement 1f: „medley engine stays as fallback only").
- v1–v3 game rules, coin rows, quest/collection semantics unchanged unless a §C-SYS row explicitly overrides them. The ONLY framework gate change is §C-SYS7 (sick shop trips).
- No accounts, no server, no analytics: codes are offline data; the radio plays local files only.

---
## §B. Architecture Deltas (binding)

### B1. Save schema v4 + migration

`SAVE.VERSION = 4`; `core/save.js` gains `migrations[3]` (v3 → v4). The v0→v1→v2→v3 chain is untouched, so v1/v2 saves migrate losslessly through the chain in one load.

**New top-level slices (exact defaults — `v4SliceDefaults()` factory, same pattern as v2/v3):**

```
radio: {
  station: 'bordmusik',      // station id (§C-SYS1.4); always a valid id — validate() coerces unknown → 'bordmusik'
  playing: false,            // radio ON/OFF — persists; resumes after the first gesture on boot
  shuffle: true,             // shuffled station order vs. manifest order
  replaceContext: true,      // true: radio replaces medley context music everywhere; false: radio only in home rooms
  lastTrack: '',             // track id last played (resume point; '' = station start)
  trims: {},                 // trackId → { vol: 100, on: true } — ONLY non-default entries stored (open map)
}
codes: {
  redeemed: {},              // codeId → epoch-ms
  lockUntil: 0,              // rate-limit lockout end (epoch-ms)
  buffs: { doubleCoinsUntil: 0 },  // 'UpdateLiebe' expiry (epoch-ms; 0 = inactive)
}
modifiers: {
  nextAt: 0,                 // epoch-ms of the next event; 0 = unscheduled (engine schedules on first tick)
  seed: 0,                   // mulberry32 stream position; 0 = derive from createdAt (validate() fills)
  current: null,             // null | { gameId, type, startedAt, endsAt, playsLeft }
  lastGameId: '',            // no-repeat guard for the next roll
  dayCoins: 0, dayCoinsDay: '',  // §C-SYS11 daily modifier-surplus ledger (localDay string)
}
recap: {
  lastRecapLevel: 0,         // highest milestone already recapped (migration initializes — see below)
  baseline: {},              // counter snapshot at last recap (shape §C-SYS2.4; {} = filled at migration/first boot)
  baselineAt: 0,             // epoch-ms of the snapshot
  pendingLevel: 0,           // a queued-but-not-yet-played recap milestone (0 = none) — survives reload
  history: [],               // last ≤ 8 of { level, at, stats } for profile replay (§C-SYS2.8)
}
gallery: { count: 0, lastAddedAt: 0, hintShown: false }   // meta only — photo blobs live in IndexedDB (§B7)
```

**Slice extensions (defaults merged, existing values win — v2/v3 counter-merge pattern):**

- `settings` += `{ gyro: false }` (§C-SYS8; strict-boolean validated like `devUnlocked`).
- `stickers.unlocked/seen` are open maps — sticker #29 `herzGooby` needs **no** schema change.
- `furniture.owned/placed` are open — the new `radio` furniture item (§C-SYS1.4) needs **no** schema change; `migrations[3]` grants it: push `'radio'` into `furniture.owned` when absent and set `furniture.placed['living:shelf1'] = 'radio'` ONLY when that slot key is absent (never overwrite a player's placement).
- `achievements.counters` += `{ codesRedeemed: 0, modifierPlays: 0, recapsSeen: 0, radioMinutes: 0, galleryPhotos: 0 }`.
- `onboarding.whatsNew4Seen = false` for migrated saves (fresh saves default `true`) — mirrors the v2/v3 rule; the 4.0 What's-new panel highlights radio + codes + gallery.

**`migrations[3]` behavior (mirrors `migrations[2]`'s corruption-guard style):**

1. `out = { ...v4SliceDefaults(), ...state, v: 4 }` — new slices only when absent; wrong-typed containers left for validate()/F2 recovery.
2. `settings` gains `gyro: false` defaults-first; all v1–v3 settings keys pass through verbatim.
3. **Recap retro-safety (binding):** `recap.lastRecapLevel = Math.floor(level / 5) * 5` (an L23 save → 20; L4 → 0) and `recap.baseline` = the §C-SYS2.4 snapshot taken FROM THE MIGRATING STATE, `baselineAt = now()`. Consequence: no instant recap spam, and the first post-update recap counts only what happened since the update — exactly the owner's intent.
4. Counters merged defaults-first (guarded); furniture radio grant per above; `whatsNew4Seen = false`.
5. Never rewrite any existing key. `validate()` (not the migration) clamps: `radio.station` to a known station id (else `'bordmusik'`), each `trims[id].vol` to int 0–150 (else 100) and `on` to strict boolean, `codes.lockUntil`/`buffs.doubleCoinsUntil`/`modifiers.nextAt` to finite ≥ 0 **and ≤ now() + 24 h** (hostile far-future stamps collapse — same rule class as the v3 `nougat.lastGlobAt` clamp; an over-future `doubleCoinsUntil` would otherwise grant a permanent ×2 buff), `modifiers.current` to null unless it is a well-formed row with a known gameId/type and `endsAt > now()`, `recap.history` to ≤ 8 well-formed rows, `gallery.count` to int 0–40.

**Tests:** `saveV4.test.js` — v3→v4 and v1→v4 lossless round-trips (every fixture field asserted), radio-grant idempotence (migrating twice can't duplicate), recap baseline init math at levels 1/4/5/23/40, hostile-timestamp clamps; fuzz corpus re-run + ≥ 100 new seeded mutations targeting the six new slices.

### B2. Music registry + radio player (`src/data/musicManifest.json`, `src/systems/musicRegistry.js`, `src/audio/radioPlayer.js`)

**B2.1 Naming convention (binding, already announced to the owner in `public/assets/GoobyMusic/requests.md`):** `Kategorie - Titel.mp3|ogg` — split on the FIRST `" - "`; category and title trimmed. Known categories: `Radio`, `Recap`, `Game`, `Stinger`, `Bordmusik` (reserved for the committed CC0 set). Unknown category → treated as `Radio` (script warns). Files < 10 s are auto-categorized `Stinger` regardless of name. Track id = kebab-slug of `kategorie-titel` (diacritics folded, e.g. `Radio - Sunny Carrots.mp3` → `radio-sunny-carrots`).

**B2.2 Build-time manifest — `scripts/gen-music-manifest.mjs` (node + ffprobe, runs at build-agent time, NOT in CI; npm script `music-manifest`).** Scans BOTH roots: `public/assets/GoobyMusic/*.{mp3,ogg}` (owner uploads, `source: 'owner'`) and `public/assets/music/*.{mp3,ogg}` (committed CC0, `source: 'builtin'`). Writes committed `src/data/musicManifest.json`:

```
{ "v": 1, "tracks": [ { "id", "file",            // URL path relative to /assets/
    "category", "title", "source",               // per B2.1
    "durationSec",                               // ffprobe, 1 decimal
    "gainTrim",                                  // loudness-normalize multiplier to −16 LUFS-ish mean RMS (ffprobe volumedetect), 2 decimals, clamp 0.3–2.0
    "cover",                                     // covers/<basename>.png when the file exists, else null (§C-SYS1.6)
    "beats"                                      // beats/<basename>.beats.json when it exists, else null (§B5.3)
} ] }
```

Deterministic order (sorted by id); idempotent (byte-stable re-runs); graceful when both folders are empty → `{ "v": 1, "tracks": [] }`. `test/musicRegistry.test.js` asserts: every manifest entry's file/cover/beats path exists on disk (the REVERSE is not asserted — owner files may arrive between manifest runs), schema shape, id uniqueness, and the §C-SYS1.7 Bordmusik minimum (≥ 13 builtin tracks).

**B2.3 Radio player (`src/audio/radioPlayer.js`) — MediaElement streaming, NOT decoded buffers (binding).** A 3-minute MP3 decodes to ~60 MB PCM — it must never enter the §B2.3-v3 6 MB LRU. The player owns ONE `HTMLAudioElement` (`preload='auto'`), wired once via `ctx.createMediaElementSource(el) → trackGain → radioGain → bus.music` inside `audio.init()` (element created lazily on first radio start; `createMediaElementSource` is called exactly once per element — reuse rule). Per-track effective gain = `manifest.gainTrim × (trims[id].vol / 100)` on `trackGain`; the music slider/mute ride the existing bus. Track transitions: 300 ms linear fade-out on `radioGain`, swap `el.src`, fade-in 300 ms (gap ≤ 400 ms). `radioPlayer.getTime()` = `el.currentTime` (the recap beat clock, §B5).

**API (consumed by audio.js, radio panel, recap director):** `start(stationId)`, `stop()`, `toggle()`, `skip()`, `setStation(id)`, `setShuffle(on)`, `setTrim(id, {vol, on})`, `now()` → `{ trackId, title, cover, station, t, duration }`, `duck(on)` (recap/danceParty exclusivity → pause + remember), `getStats()` (feeds `audio.getStats().radio`: `{ playing, station, trackId, t, gain, elementState }`).

**B2.4 Ownership & mute rules.** `settings.music === false` → element `pause()` + zero node creation (airtight rule extends verbatim). While the radio is playing AND `radio.replaceContext` → `musicDirector` is suppressed via a new director gate `setRadioActive(true)` (same mechanics as the danceParty `setSuppressed`); `replaceContext: false` → radio plays only while the home scene is active (scene hooks call `radioPlayer.duck`). danceParty and the recap cinematic ALWAYS duck the radio and resume it afterwards. Pure queue logic (station filtering, shuffle order (mulberry32 on save seed × station), skip/next, trim math) lives in `src/systems/radioQueue.logic.js` — node-testable without DOM.

### B3. Audio asset roots for itch.io packs

`core/assets.js` `getAudioUrl` today resolves `'<pack>/<file>'` → `assets/kenney/<pack>/audio/<file>.ogg`. 4.0 adds a frozen `AUDIO_PACK_ROOTS` table (mirrors `PACK_FORMATS`): default `kenney`; new slug `itch-sfx` → `assets/itch/itch-sfx/<file>.ogg`. New committed root `public/assets/itch/`:

- `itch-sfx/` — the curated ObsydianX Interface SFX subset (§C-SYS1.9 table, ~26 files, flat-copied from `Ogg/**/` with names kept, e.g. `confirm_style_4_001.ogg`) + its `LICENSE-NOTE.md`.
- `vfx/` — 6 Brackeys textures for the modifier glow (§C-SYS4.5): `circle_04.png`, `circle_05.png`, `twirl_01.png`, `twirl_02.png`, `flare_01.png`, `star_03.png` + `LICENSE-NOTE.md` (paths in staging: `brackeys_vfx_bundle/particles/opague/…`).
- `public/assets/music/` — the Bordmusik + recap-fallback OGGs (§C-SYS1.7 exact list) + a consolidated `LICENSES.md` (Playful Piano / Tallbeard / Ragnar notes copied from staging).

New `scripts/fetch-itch.mjs` mirrors the kenney/kaykit whitelist pattern (manifest of exact staging paths → repo paths; fails loudly on missing/oversized files).

### B4. Modifier scheduler engine (`src/systems/modifierEngine.js` — pure)

Pure module, no DOM/three: `tick(state, nowMs)` → `{ changes?, event? }` driven by the existing 1 s timeEngine tick (same wiring style as health/weather). Responsibilities: (1) schedule — when `nextAt === 0` set `nextAt = now + GRACE_MIN(30 min)`, else when `now ≥ nextAt` and no `current`, roll the event: eligible (unlocked ∧ eligibility matrix §C-SYS4.3 ∧ `gameId !== lastGameId`) game × type via mulberry32(`seed`++), set `current = { gameId, type, startedAt: now, endsAt: now + WINDOW_MIN(45 min), playsLeft: def.plays }`, `nextAt = now + 50–120 min` (seeded uniform); (2) consume — framework calls `modifierEngine.consume(state, gameId)` at launch (decrements `playsLeft`, clears `current` at 0 and pins `lastGameId`); (3) expire — `now ≥ endsAt` clears `current` (schedule stays). Exact numbers frozen INSIDE the module (§E0.1-2 pattern): `GRACE_MIN 30`, `WINDOW_MIN 45`, `CADENCE_MIN [50, 120]`, the §C-SYS4.2 type table, the §C-SYS11 caps. Store event `modifierChanged` (payload `{current, nextAt}`). Framework passes the active modifier into games as `ctx.params.modifier = { type, …tuning }` (§C-SYS4.4) — games without modifier support simply ignore it (the eligibility matrix guarantees only supporting games are rolled). Notification id 8 schedules `nextAt` on background (§B10).

### B5. Recap engine (`src/systems/recapEngine.js` pure + `src/home/recapScene.js` scene)

**B5.1 Pure engine:** `snapshot(state)` → the §C-SYS2.4 baseline shape; `diff(baseline, state, nowMs)` → ordered stat lines (id, value, weight); `selectLines(diff)` → the ≤ 12 lines per §C-SYS2.5; `milestoneCrossed(prevLevel, newLevel)` → the lowest un-recapped multiple of 5 (handles multi-level jumps: L4→L11 queues 5, then 10 next time); `beatGrid(beats, durationSec)` → `{ barSec, cues: [{t, kind: 'text'|'cut'|'end'}] }` per §C-SYS2.6. All node-tested (`recapEngine.test.js`).

**B5.2 Trigger plumbing:** every `applyXp` site already funnels level changes through the store; a thin `main.js` listener compares `level` on `change`, calls `milestoneCrossed`, writes `recap.pendingLevel`, and the recap plays on the NEXT home-scene enter (never mid-minigame/mid-trip). Playing writes `history`, advances `lastRecapLevel`, re-snapshots `baseline`, clears `pendingLevel` — atomic in one `store.update`.

**B5.3 Beat manifests — `scripts/gen-beats.mjs` (node + ffmpeg, build-agent time, NOT CI).** For every `Recap - *` track (and any track passed explicitly): decode to mono f32 PCM (ffmpeg), spectral-flux onset envelope, autocorrelation over 60–180 BPM, phase fit → writes `public/assets/GoobyMusic/beats/<basename>.beats.json` (or `public/assets/music/beats/…` for builtins): `{ "bpm": <float 1dp>, "offsetSec": <float 2dp>, "beatsPerBar": 4 }`. A sibling `<basename>.beats.override.json` (hand-tuned) wins verbatim when present — the committed fallback-track grid ships as an override measured once by the build agent. Tracks without any beats file get the default grid `{ bpm: 100, offsetSec: 0, beatsPerBar: 4 }` (recap still runs, just un-tuned).

**B5.4 Scene:** `recapScene` is a normal §E1 scene (`enter({level, stats, trackId})`) — full-screen takeover above a paused home; 8 biome vignette sets built ONLY from already-committed kits (§C-SYS2.3), one 3D group each, camera dolly per vignette; DOM overlay for the beat-synced text (styles in one marked `styles.css` block); AI backdrop planes from `public/assets/recap/bg-<biome>.png` (coordinator pre-wave, 8 files, 1024×512 ≤ 200 KB each). Draw calls ≤ 250 per vignette (only ONE vignette group visible at a time).

### B6. Codes engine (`src/systems/codesEngine.js` pure + `src/data/codes.js` catalog)

Catalog rows: `{ id, secret, effect, once: true }` — `secret` is the NORMALIZED form (lowercase, ALL whitespace stripped): `{ id: 'updateLiebe', secret: 'updateliebe', effect: { buff: 'doubleCoins', minutes: 10 } }`, `{ id: 'herzGooby', secret: 'ichlie3bdich', effect: { sticker: 'herzGooby', coins: 50 } }`. Engine API (pure): `normalize(input)`, `redeem(state, input, nowMs)` → `{ ok: true, code } | { ok: false, reason: 'unknown'|'already'|'locked' }` — implements the §C-SYS5.3 rate limit against `codes.lockUntil`. Effects are APPLIED by the caller (settings/dev UI) through existing pipes: coins via `economy.award(reason: 'code')`, sticker via the stickerBook engine's unlock path, buff by writing `codes.buffs.doubleCoinsUntil`. `economy.awardMinigame` reads the buff: `buffMult = now < doubleCoinsUntil ? 2 : 1`, applied AFTER the daily ×2 (multiplicative, bounded — §C-SYS11.2). Store event `codesChanged`.

### B7. IndexedDB photo store (`src/core/photoStore.js`)

Guarded wrapper (same never-hard-require spirit as the Capacitor adapters): DB `gooby.photos` v1, object store `photos` (keyPath `id`, autoIncrement), record `{ id, blob, at, w, h, frame, bytes }`. API (all promise-based, all exception-safe → resolve null/false and warn once when IDB is unavailable — the game NEVER breaks without it): `add(blob, meta)` (enforces cap 40: deletes oldest-by-`at` first; on `QuotaExceededError` evicts 4 oldest and retries ONCE, else resolves `{ok:false, reason:'quota'}`), `list()` → meta array (no blobs), `get(id)` → blob, `remove(id)`, `count()`. `gallery` save slice mirrors `count`/`lastAddedAt` synchronously for badges. Pure LRU/cap decision logic extracted to `src/systems/gallery.logic.js` for node tests (IDB itself is not unit-tested; the logic is).

### B8. Gyro parallax module (`src/home/parallax.js`)

Listener + math module consumed ONLY by homeScene: reads `settings.gyro`; permission flow §C-SYS8.2; pure mapping function `parallaxOffset(beta, gamma)` (deadzone/clamp/sensitivity — node-tested in `gyro.test.js`) → camera position offset lerped at τ = 150 ms in homeScene's update. Pointer fallback shares the same mapping (pointer position normalized to pseudo-angles). Perf guard: rolling 5 s FPS < 25 → suspend (resume ≥ 35). Zero allocation per frame.

### B9. Settings IA mechanics

`settingsScreen.js` becomes a two-level stack: the main list + subscreens (`display`, `audio`, `tracks`, `codes`, `credits`) — each subscreen is a §E6 panel pushed on the existing screen stack (back chevron top-left, `ui.close` sound). Exact IA: §C-SYS12.1. The 5×-tap dev gate stays on the language „Auto" segment (unchanged §B4-v3). New `creditsScreen` renders a static, scrollable attribution list from `src/data/credits.js` (§C-SYS12.4).

### B10. Constants re-opening + store events + notification id 8 (single wave-1 foundations agent)

- `constants.js` additions (then frozen again): `SAVE.VERSION = 4`; `NOTIFY.IDS.modifier = 8`; `NOTIFY.MAX_SCHEDULED = 8`; `CODES: { LOCK_AFTER: 5, LOCK_WINDOW_SEC: 60, LOCK_SEC: 30 }`; `MODIFIER: { DAY_COIN_CAP: 150 }`. Everything else (station tables, modifier tuning, recap grid, gyro numbers) lives as frozen consts inside the owning module (§E0.1-2 pattern).
- New store events (additions only): `radioChanged` `{playing, station, trackId}` · `modifierChanged` `{current, nextAt}` · `codesChanged` `{id}` · `galleryChanged` `{count}` · `recapChanged` `{pendingLevel, lastRecapLevel}` · runtime-only `xpGranted` `{amount, source}` (fired at every applyXp call site — drives the §C-SYS3 floaters; NOT persisted).
- Notification id 8 „Modifier": scheduled at `modifiers.nextAt` by notifyRules on save/background; body EN „A bonus game is waiting in the arcade! ✨" / DE „Ein Bonus-Spiel wartet in der Arcade! ✨"; NOT quiet-hours-exempt; participates in the min-spacing/cap pipeline like ids 2–7. Fires at most once per scheduled event (nextAt is stable between reschedules).

### B11. Economy guard rails (architecture note)

All 4.0 coin surfaces route through `systems/economy.js` with new reasons: `'code'`, `'modifier'`, `'glueckspilz'`. `economy.js` gains a dev-only in-memory ring buffer (last 50 `{at, kind, amount, reason, balance}` rows — NOT persisted) exposed as `economy.getLedger()` for the dev-panel view (§C-SYS6). Caps/formulas: §C-SYS11. Plan B's endless-mode coin sources MUST use `economy.award(reason: 'endless')` and obey the same §C-SYS11.1 table (cross-file contract for plan agent C's waves).

---
## §C-SYS. System Feature Specs (all numbers + copy binding)

### C-SYS1. GoobyMusic + Radio (owner requirement 1)

**C-SYS1.1 Registry.** Per §B2.1/§B2.2. Owner workflow (already live in `public/assets/GoobyMusic/requests.md`): drop `Kategorie - Titel.mp3` into the folder → coordinator/build agent runs `npm run music-manifest` (+ `npm run beats` for Recap tracks, + cover generation §C-SYS1.6) → track is in the game. NO code changes per track, ever.

**C-SYS1.2 Stations.** A station = a manifest category with ≥ 1 track, plus two fixed entries:

| station id | label EN / DE | contents |
|---|---|---|
| `bordmusik` | On-board Tunes / Bordmusik | all `source: 'builtin'` tracks (§C-SYS1.7 — ships day one, never empty) |
| `gooby-fm` | Gooby FM / Gooby FM | owner `Radio` category tracks |
| `recap-fm` | Epic / Episch | owner `Recap` tracks + the builtin recap fallback (they're good music — no reason to hide them) |
| `game-fm` | Arcade / Arcade | owner `Game` tracks |
| `alle` | Everything / Alles | every track from all stations above |

Stations with zero tracks don't render (day one: `bordmusik`, `recap-fm`, `alle`). `Stinger` category tracks (< 10 s or named `Stinger - *`) NEVER join a station — they are one-shot cues (level-up/results overrides, wired by plan agent C's waves when the owner delivers them).

**C-SYS1.3 Radio panel UI (§E6 panel `radioPanel`).** Opened by: tapping the living-room radio (C-SYS1.4), the HUD radio chip (visible only while playing), or Settings → „Radio". Layout top→bottom: now-playing row (cover 56×56 rounded-12, title, station, elapsed/total), transport row (⏯ play/pause 56 px, ⏭ skip 44 px, 🔀 shuffle toggle 44 px), station chip strip (horizontal scroll, active chip filled), row „Radio ersetzt Szenen-Musik" toggle (`radio.replaceContext`), link row „Track-Einstellungen →" (opens the §C-SYS1.5 subscreen). Sounds: transport taps `ui.tap`, station change `ui.tabSwitch`. Radio state persists (`radio.*` slice) — a reload mid-song resumes the same station (track position restarts; `radio.lastTrack` continues the queue).

**C-SYS1.4 The radio is a real thing in the world.** New furniture item `radio` (catalog append): model `pleasant-picnic/radio` (Tiny Treats Pleasant Picnic pack — a real cute retro radio GLB; flat-copied to `public/assets/itch/pleasant-picnic/` via the §B3 fetch script; ~1 draw call), price 0, `giftV4: true` — granted + auto-placed on the living-room shelf slot by `migrations[3]` and in fresh saves (§B1). Tap → `tap:radio` → radioPanel + Gooby head-bob reaction if music is playing. While the radio plays, the model gets a subtle 0.5 Hz scale pulse (1.0→1.03) and two floating-note particles/4 s (pooled).

**C-SYS1.5 Per-track settings („jeden einzelnen Track anpassen").** Settings → Audio → „Musik & Radio" subscreen: one row per manifest track, grouped by station, each row: cover 32×32 · title · enable toggle · trim slider 0–150 % (step 5, default 100) · ▶ 5-s preview button (plays through the radio chain, ducks the live track). Disabled tracks are skipped by the queue (a station with ALL tracks disabled falls back to playing them anyway with a one-time toast „Alle Tracks aus — Station spielt trotzdem" — silence is never persisted). Persisted sparsely in `radio.trims` (§B1). Effective gain math in §B2.3; slider release previews via the existing `ui.slider`/`previewBus` conventions.

**C-SYS1.6 Cover art.** Convention (binding): `public/assets/GoobyMusic/covers/<file-basename-without-extension>.png` — exact basename match, e.g. `Radio - Sunny Carrots.mp3` → `covers/Radio - Sunny Carrots.png`. 512×512, ≤ 120 KB. The coordinator generates one AI cover per NEW track as tracks arrive (prompt guideline: cozy pastel album art, Gooby-universe motifs, NO text) — builtin tracks get 13+1 covers generated in the pre-wave. Fallback: `public/assets/GoobyMusic/covers/_default.png` (Gooby with headphones, generated once in the pre-wave) whenever the manifest `cover` is null. Manifest script warns per missing cover.

**C-SYS1.7 INTERIM „Bordmusik" (exact files, all CC0, staged and CRC-verified).** Committed to `public/assets/music/` renamed per convention (source path → committed name):

| # | staging source | committed as |
|---|---|---|
| 1 | `playful-piano.zip → PLAYFUL PIANO/PlayfulPiano_Original_Loop.ogg` | `Bordmusik - Playful Piano.ogg` |
| 2 | `… PlayfulPiano_Atmos_Loop.ogg` | `Bordmusik - Piano Atmos.ogg` |
| 3 | `… PlayfulPiano_JazzTrio_Loop.ogg` | `Bordmusik - Piano Jazz.ogg` |
| 4 | `… PlayfulPiano_Melody_Loop.ogg` | `Bordmusik - Piano Melodie.ogg` |
| 5 | `… PlayfulPiano_Strings_Loop.ogg` | `Bordmusik - Piano Streicher.ogg` |
| 6 | `music-loop-bundle-chiptune.zip → Three Red Hearts Rabbit Town.ogg` | `Bordmusik - Rabbit Town.ogg` |
| 7 | `… Three Red Hearts Penguin Town.ogg` | `Bordmusik - Penguin Town.ogg` |
| 8 | `… Three Red Hearts Candy.ogg` | `Bordmusik - Candy.ogg` |
| 9 | `… Three Red Hearts Puzzle Pieces.ogg` | `Bordmusik - Puzzle Pieces.ogg` |
| 10 | `music-loop-bundle-2026-q2.zip → Week 16 - Vacation Day CHILLOUT.ogg` | `Bordmusik - Vacation Day.ogg` |
| 11 | `… Week 26 - Seaside CORAL REEF.ogg` | `Bordmusik - Seaside.ogg` |
| 12 | `… Week 23 - Workshop BREADBOARD.ogg` | `Bordmusik - Werkstatt.ogg` |
| 13 | `ragnar-orchestral-world-music/02-the-town-where-i-got-the-magic-bottle.ogg` | `Bordmusik - Magic Bottle Town.ogg` |
| 14 | `ragnar-orchestral-world-music/04-youthful-elf-seeking-adventure.ogg` | `Recap - Abenteuer.ogg` (the §C-SYS2.6 recap fallback — category Recap, joins `recap-fm`) |

Total ≈ 26 MB. When owner tracks arrive they ADD (never replace) — the medley director remains the fallback ONLY when the radio is off (owner 1f). `radioMinutes` counter accrues (1/min while playing) for a future achievement (plan B may claim it).

**C-SYS1.8 Now-playing chip.** DOM chip bottom-center above the room nav (`--safe-bottom`-aware), 288×56 px @100 % scale: cover 40×40 rounded-8 · title (1 line, ellipsis ok — non-interactive) · station name small. Slides up + fades in 250 ms when a radio/recap track STARTS, auto-hides after 4 s (translate-down + fade 250 ms), never stacks (new track replaces content + restarts the timer). Tap → radioPanel. Suppressed while any minigame HUD is up. Zero layout shift (position: fixed).

**C-SYS1.9 „NO MORE SYNTHETIC SOUNDS" audit (binding replacement table).**

*C-SYS1.9.1 Policy.* Every `kind: 'synth'` recipe id in `sfxMap.js` flips to a real `sample` def unless it appears in the frozen exemption list (C-SYS1.9.3). Sources: committed Kenney packs (interface-sounds, impact-sounds, ui-audio, casino-audio, music-jingles) + the NEW `itch-sfx` root (§B3, ObsydianX Interface SFX Pack 1 — real recorded/rendered OGG files; „real sample" per the owner's policy = file playback, no runtime oscillators). Loudness: every new file gets a `loudness.json` entry via the existing `scripts/audio-loudness.mjs` run; volumes below are pre-normalization intents (script trim × table value, −16 dBFS one-shot target — §B2.5-v3 rules carry over).

*C-SYS1.9.2 The replacement table (46 ids — grep-derived from HEAD `0d3a2dd` `sfxMap.js`; `IMP` = impact-sounds, `UI` = interface-sounds, `ITCH` = itch-sfx):*

| # | id (old recipe) | new sample def | vol/rate notes |
|---|---|---|---|
| 1 | `ball.throw` (whoosh) | `IMP/footstep_snow_000..004` | 0.5, rate 1.15 — soft air „shff" |
| 2 | `whoosh` (whoosh) | `IMP/footstep_snow_000..004` | 0.5, rate 1.0 |
| 3 | `mole.whiff` (whoosh) | `IMP/footstep_snow_000..004` | 0.3, rate 1.3 |
| 4 | `chop.lob` (whoosh) | `IMP/footstep_snow_000..004` | 0.3, rate 1.2 |
| 5 | `hopper.lane` (whoosh) | `IMP/footstep_snow_000..004` | 0.4, rate 1.25 |
| 6 | `throw.whoosh` (whoosh) | `IMP/footstep_snow_000..004` | 0.55, rate 1.1 |
| 7 | `rocket.wind` (whoosh) | `IMP/footstep_snow_000..004` | 0.6, rate 0.85 |
| 8 | `goalie.dive` (diveWhoosh) | `IMP/footstep_snow_000..004` | 0.6, rate 0.7 |
| 9 | `harbor.boost` (diveWhoosh) | `IMP/footstep_snow_000..004` | 0.6, rate 0.7 |
| 10 | `pancake.drop` (whooshDown) | `UI/minimize_004..006` | 0.5 |
| 11 | `racer.block` (whooshDown) | `UI/minimize_001..003` | 0.55 |
| 12 | `tow` (sad) | `ITCH/back_style_3_001..003` | 0.6 — descending real tone |
| 13 | `dance.miss` (sadBlip) | `ITCH/back_style_2_001..003` | 0.35 |
| 14 | `dance.perfect` (blipHigh) | `ITCH/cursor_style_2_001..003` | 0.6, rate 1.2 |
| 15 | `dance.good` (blipMid) | `ITCH/cursor_style_2_001..003` | 0.5, rate 1.0 |
| 16 | `dance.fever` (riser) | `UI/maximize_001..004` | 0.55 — real ascending slide |
| 17 | `hopper.shield` (riser) | `UI/maximize_005..008` | 0.6 |
| 18 | `goalie.super` (riser) | `UI/maximize_001..004` | 0.7 |
| 19 | `racer.boost` (riser) | `UI/maximize_005..008` | 0.6 |
| 20 | `hunt.boo` (riser) | `UI/maximize_001..004` | 0.5, rate 0.8 — slower = spookier |
| 21 | `basket.swish` (sparkle) | `ITCH/confirm_style_1_001..003` | 0.7 |
| 22 | `pancake.topping` (sparkle) | `UI/glass_001..006` | 0.6 |
| 23 | `racer.shield` (sparkle) | `UI/glass_001..006` | 0.6 |
| 24 | `hunt.powerup` (sparkle) | `ITCH/confirm_style_1_004..006` | 0.7 |
| 25 | `hopper.gold` (goldenPing) | `UI/glass_001..006` | 0.7, rate 1.3 |
| 26 | `fish.cast` (plop) | `UI/drop_001..004` | 0.6, rate 0.8 |
| 27 | `garden.plant` (seedPlant) | `IMP/footstep_grass_000..004` | 0.65, rate 0.7 — soil pat |
| 28 | `garden.fertilize` (fertilizerPuff) | `IMP/footstep_snow_000..004` | 0.5, rate 0.5 — dust puff |
| 29 | `garden.harvest` (harvestJoy) | `IMP/impactGeneric_light_000..004` 0.65 rate 1.15 — pluck-pop; the delighted-gasp HALF moves to an explicit `audio.play('gooby.gasp')` at the harvest call site (voice bus, exempt) |
| 30 | `chop.slice` (chop) | `IMP/impactPlank_medium_000..004` | 0.7, rate 1.25 — knife-on-board |
| 31 | `chop.junk` (splat) | `IMP/footstep_grass_000..004` | 0.65, rate 0.55 — wet squelch read |
| 32 | `cake.splat` (splat) | `IMP/footstep_grass_000..004` | 0.65, rate 0.55 |
| 33 | `delivery.drop` (confettiPop) | `IMP/impactPlate_light_000..004` | 0.6, rate 1.1 |
| 34 | `pipe.connect` (pipeConnect) | `ITCH/confirm_style_5_001..003` | 0.7 |
| 35 | `sticker.get` (stickerPop) | `ITCH/confirm_style_4_001..003` | 0.7 |
| 36 | `album.claim` (setFanfare) | `music-jingles/jingles_HIT13` | 0.75 — a REAL fanfare jingle |
| 37 | `vet.cure` (vetSparkle) | `ITCH/confirm_style_6_001..002` (echo variants) | 0.75 — magical rising confirm |
| 38 | `photo.shutter` (shutter) | `ui-audio/mouseclick1` | 0.7, rate 0.9, haptic medium — crisp click-clack |
| 39 | `hop.bell` (bellJingle) | `IMP/impactBell_heavy_000..004` | 0.35, rate 1.8 — small-bell read |
| 40 | `golf.sink` (golfSink) | `casino-audio/chip-lay-1..3` | 0.7, rate 0.85 — ball-in-cup rattle |
| 41 | `golf.bump` (boing) | `IMP/impactPlank_medium_000..004` | 0.5, rate 1.35 |
| 42 | `pancake.slice` (slice) | `UI/scratch_001..005` | 0.6, rate 1.3 |
| 43–46 | `says.pad1..4` (saysPad) | `ITCH/cursor_style_4_001` ONE file, `rate` 1 / 1.125 / 1.25 / 1.5 per id | 0.7 — playbackRate pitching preserves the exact C-D-E-G ratio contract (overrides the §C3.1-v3 „stay synth" ruling: the pitch contract is kept BY rate, so the exemption reason is gone) |

Exact ObsydianX style/file picks above are the binding DEFAULT; the audio agent may substitute WITHIN the same tone family (confirm/back/cursor) after audition, logging swaps in its report — ids, counts and the coverage floor may not change. After the sweep, the `SYNTH_RECIPES` entries that no longer have any consumer are DELETED from `audio.js` (dead recipes: coin, winArp, pop, bubblePop, blipHigh, blipMid, softTick, sadBlip, sad, jump, whoosh, whooshDown, slice, sparkle, riser, plop, boing, boingBig, seedPlant, trickle→kept (water), fertilizerPuff, chaChing, readyChime, harvestJoy, stickerPop, setFanfare, shutter, saysPad, doorbell→kept (harbor.horn), golfPutt, golfSink, chop, splat, diveWhoosh, confettiPop, vetSparkle, checkupChime, discovery, questJingle, pipeConnect, goldenPing, starPing, bellJingle, bunnyCheer→kept, dead code is a P2).

*C-SYS1.9.3 Frozen exemptions (each with its impossibility justification; pinned in `audioCoverage.test.js` as an exact-set assertion):*

| id | recipe | why no sample |
|---|---|---|
| `wash.splash`, `toilet.flush`, `garden.water`, `pipe.fill` | splash/flush/trickle | zero water/liquid recordings exist in ANY committed or staged CC0 pack (verified against the D1 REPORT + committed kenney folders); synthetic water stays until a real CC0 water pack is staged |
| `tramp.bounce`, `tramp.boost` | boing/boingBig | no spring/rubber-boing sample staged; a plank/punch impact reads as a hit, not a bounce — would degrade the game feel |
| `goalie.cheer`, `rocket.pickup` | bunnyCheer | the „crowd of Goobys" is built from Gooby-voice squeaks — it is voice-identity content (§A3), and no creature-crowd samples are staged |
| `harbor.horn` | doorbell @0.3 | a two-tone ship horn has no plausible stand-in in the staged tone/impact families (a pitched bell reads as a bell) |
| all `voice` ids (15) + `health.sneeze` | goobyVoice.js | identity exemption (owner-sanctioned): NO cute-creature voice sample set exists in staging — REPORT re-checked 2026-07-19; **mitigation per the owner's ask:** the sweep ADDS real-sample alternates where a real thing exists nearby (the harvest gasp keeps riding voice; no candidates for squeak/purr/giggle exist, documented in the audio agent's report) |
| `ambience.rain`, `ambience.birdsong`, `rocket.thrust` | loop recipes | loops need seamless material; no loopable CC0 ambience/engine files staged (music loops are music, not ambience) — recipes stay, still routed/mixed per v3 rules |
| danceParty TRACK (`music('dance')`) | sequencer | §C3.4-v3 binding ruling (DANCE.BPM/PATTERN_SEED sample-accurate chart contract) — unchanged |

*C-SYS1.9.4 Coverage acceptance:* `audioCoverage.test.js` v4 asserts (a) the exemption SET equals exactly the 9 non-loop ids above, (b) every other non-voice/non-loop id is `sample`, (c) every sample key resolves to a committed file, (d) every new key has a `loudness.json` entry. Ratio arithmetic replaced by the exact-set rule (stronger than any floor).

### C-SYS2. Level-up recap cinematic (owner requirement 2)

**C-SYS2.1 Trigger & lifecycle.** Milestones: levels 5,10,…,40. Detection/queueing per §B5.2 (plays on next home-scene enter, never interrupts gameplay; `recap.pendingLevel` survives reload). Multi-level jumps recap ONLY the highest crossed milestone (the skipped one's stats fold into the same recap; `lastRecapLevel` jumps to the highest). Entry: 400 ms white-fade takeover, HUD hidden, input limited to the skip affordance. Exit: end card → 500 ms fade home, `jingle.levelUp` if not already played by the toast path.

**C-SYS2.2 Duration & skip.** Target length = `clamp(trackDuration, 60, 120)` s; with the day-one fallback track (`Recap - Abenteuer.ogg`, ≈ 100 s) the recap runs the full track. Time budget: intro title 4 s → 8 vignettes × `(length − 18)/8` s each (fallback: ~10.25 s) → end card 14 s. **Skip:** from t = 10 s a SUBTLE affordance appears bottom-right: „Überspringen ›" / „Skip ›", 13 px, 40 % opacity, no button chrome, fades in over 1 s; tap → 300 ms cut to the end card (rewards/summary are never skippable-past — the end card always shows ≥ 3 s). Before t = 10 s taps do nothing (owner wants it long; players CAN escape after 10 s).

**C-SYS2.3 The 8 biome vignettes (existing kits ONLY — no new 3D assets):**

| # | biome (DE label shown) | kit dressing (committed packs) | camera dolly |
|---|---|---|---|
| 1 | Blumenwiese | nature-kit trees/flowers/rocks + garden fence | low push-in through grass, 12° rise |
| 2 | Große Stadt | kaykit-city blocks + city-kit-roads/commercial | lateral truck along a street canyon |
| 3 | Hafen | watercraft-kit boats + crates + pier planks | slow orbit around a fishing boat |
| 4 | Weltraum | space-kit corridor/dome + starfield points | forward glide, gentle roll ±4° |
| 5 | Spukgarten | kaykit-halloween graves/pumpkins/fence | creep-dolly between graves, low fog plane |
| 6 | Bäckerei | kaykit-restaurant counters/oven + tiny-treats bakery/baked-goods props (committed by plan B's Tiny-Treats wave; fallback: restaurant-only) | slide along the counter, 20° look-down |
| 7 | Nachthimmel | sky.js dome + cloudy-skyboxes night panorama backdrop + star points | slow tilt-up from horizon to zenith |
| 8 | Spielzeugzimmer | toy-car-kit track/karts + furniture-kit rug/shelves | toy-height push past the racetrack |

Gooby himself (procedural rig, current outfits/skin ON) travels through every vignette: walk/hop CLIP loop on a spline matching the dolly (drives per-vignette wardrobe continuity — players see THEIR Gooby). AI backdrops: `public/assets/recap/bg-1.png … bg-8.png` (coordinator pre-wave, 1024×512, ≤ 200 KB, soft pastel skies/vistas matching each biome) mounted as a far unlit plane per vignette.

**C-SYS2.4 Baseline snapshot shape + the delta stat catalog (≥ 14 — this is the binding list).** `recapEngine.snapshot(state)` copies: `snapshotAtMs`, `level`, `coinsEarned/coinsSpent` (profile), `distanceM`, `photos` (profile), `playsTotal` (Σ `minigames.plays`), plus these counters verbatim: `feeds, washes, sleeps, tickles, trips, harvests, plantings, waterings, questsDone, deliveries, cures, nougatGlobs, cakesServed, surfRuns, stickerCount` (= `Object.keys(stickers.unlocked).length`), `petsToday` excluded (daily). Diff = current − baseline, clamped ≥ 0. Stat lines (id → DE template · EN template · weight):

| # | id | DE line | EN line | weight |
|---|---|---|---|---|
| 1 | days | „Seitdem: {n} Tage vergangen" (n = ⌈(now−baselineAt)/86400000⌉, „1 Tag" singular) | "Since then: {n} days" | always shown first |
| 2 | games | „{n} Spiele gespielt" | "{n} games played" | 10 |
| 3 | coinsEarned | „{n} Münzen verdient" | "{n} coins earned" | 9 |
| 4 | tickles | „{n}× Bauch gekrault" | "belly rubbed {n}×" | 9 |
| 5 | feeds | „{n}× lecker gefuttert" | "{n} tasty meals" | 8 |
| 6 | harvests | „{n} Ernten eingeholt" | "{n} harvests brought in" | 8 |
| 7 | stickers | „{n} neue Sticker" | "{n} new stickers" | 8 |
| 8 | quests | „{n} Quests geschafft" | "{n} quests done" | 7 |
| 9 | washes | „{n}× blitzblank gebadet" | "{n} squeaky-clean baths" | 6 |
| 10 | sleeps | „{n}× tief geschlafen" | "{n} good nights of sleep" | 6 |
| 11 | trips | „{n} Ausflüge in die Stadt" | "{n} trips to town" | 6 |
| 12 | distance | „{n} m unterwegs" | "{n} m traveled" | 5 |
| 13 | photos | „{n} Fotos geknipst" | "{n} photos snapped" | 5 |
| 14 | deliveries | „{n} Pakete geliefert" | "{n} parcels delivered" | 4 |
| 15 | cures | „{n}× krank (gute Besserung!)" | "sick {n}× (get well soon!)" | 4 |
| 16 | cakes | „{n} Torten serviert" | "{n} cakes served" | 4 |
| 17 | nougat | „{n} Nougat-Globs" | "{n} nougat globs" | 3 |
| 18 | coinsSpent | „{n} Münzen ausgegeben" | "{n} coins spent" | 3 |

**C-SYS2.5 Line selection:** always `days` (intro vignette); then the top 11 non-zero lines by (weight, then value) → ≤ 12 lines total, distributed round-robin 1–2 per vignette (a vignette with no line just plays its dolly — music breathes). Strings in `strings/v4-recap.js`.

**C-SYS2.6 Beat sync.** Track pick order: (1) a random owner `Recap - *` track (seeded per recap), (2) else `Recap - Abenteuer.ogg` (§C-SYS1.7 #14 — the Ragnar adventure piece; its measured `beats.override.json` ships committed). Grid per §B5.3: bar = `beatsPerBar × 60/bpm` s. Cue rules (binding): vignette CUTS land on even-bar boundaries (bar 0, 2, 4, …— nearest even bar to the time budget, camera pre-rolls so the cut lands exactly on the downbeat); each text line POPS on a bar downbeat (scale 0.8→1.05→1.0 over 2 beats, counter roll-up `0→n` over the following 2 beats); the end card lands on the final even bar with a 4-beat confetti burst. Clock = `radioPlayer.getTime()` on the recap's dedicated playback (radio ducked per §B2.4); drift correction: cues re-anchor to the element clock every bar (rAF drift never accumulates; ± 80 ms acceptance per §A2). No-audio contexts (VM/muted): the grid runs on the wall clock at the manifest bpm — visuals stay identical.

**C-SYS2.7 End card.** „Level {X}!" headline (level-ring animation filling), the level-up coin reward recap (`25 × level` per level gained since last recap, already paid by leveling — display only), next-unlock preview line (§C-SYS3.3), confetti (existing pooled DOM confetti), single button „Weiter" / „Continue" (`ui.confirmBig`).

**C-SYS2.8 Replay.** Profile screen gains a „Rückblicke" row (below achievements): list of `recap.history` entries („Level 25 · vor 3 Tagen"); tap → replays the cinematic from the STORED stats (no re-snapshot, no reward text changes). History capped at 8 (oldest dropped).

**C-SYS2.9 Tests (`recapEngine.test.js` ≥ 30):** milestone math (incl. multi-level jump L4→L11, cap L40), baseline diff clamps (counter reset/corruption → 0 not negative), line selection determinism, beat grid math for bpm 60/100/143.7 + override precedence, migration init (§B1 #3) at 6 level fixtures, history cap, pending-level persistence.

### C-SYS3. XP transparency (owner requirement 3)

**C-SYS3.1 „+N XP" floaters at EVERY grant site.** Mechanism: each `applyXp`/`grantXp` call site emits the runtime store event `xpGranted {amount, source}` (§B10); the HUD renders a floater anchored at the level ring: „+{n} XP", 14 px bold, floats up 40 px + fades over 900 ms; queue max 3 visible (further grants coalesce into the newest floater's number). Amounts of 0 (caps reached, max level) emit NO event. The exact **12 sites** (grep-verified against every `applyXp(`/`grantXp(` call at HEAD):

| # | site (file) | source tag | amount |
|---|---|---|---|
| 1 | `economy.awardMinigame` (`systems/economy.js`) | `minigame` | 10 + min(15, ⌊coins/2⌋) — ALSO stays on the results breakdown |
| 2 | feed flow (`home/interactions.js`) | `feed` | 5 (`XP.FEED`) |
| 3 | full wash (`home/interactions.js`) | `wash` | 8 (`XP.FULL_WASH`) |
| 4 | pet/tickle (`home/interactions.js` grantStroke) | `pet` | 1 (`XP.PET`), daily cap 20 — floater suppressed at cap |
| 5 | completed sleep (`systems/sleep.js`) | `sleep` | 10 (`XP.COMPLETED_SLEEP`) |
| 6 | quest claim (`achievementsEngine.claimQuest`) | `quest` | per quest def 5–15 (`QUEST_POOL[].xp`) |
| 7 | harvest (achievementsEngine counter-diff grant) | `harvest` | 2 per harvest (`LEVELING.XP_HARVEST`) |
| 8 | delivery (same counter-diff site) | `delivery` | 3 per delivery (`LEVELING.XP_DELIVERY`) |
| 9 | photo (`achievementsEngine.photoTaken`) | `photo` | 1 (`PHOTO.XP_PER_PHOTO`), daily cap 5 (`PHOTO.XP_DAILY_CAP`) |
| 10 | collection-sticker first find (`home/interactions.js` feed-drop + `achievementsEngine.onFirstSticker`) | `sticker` | 5 (`LEVELING.XP_STICKER`) |
| 11 | collection set complete (`achievementsEngine`) | `collection` | 50 (`LEVELING.XP_SET_COMPLETE`) |
| 12 | Nougatschleuse (`systems/nougat.logic.js`) | `nougat` | 2 (`NOUGAT.XP`) |

Stickerbuch (v3 book) unlocks and codes grant no XP — unchanged; the info sheet states this. NO new XP sources are invented; the economy stays untouched. Test: a static-analysis test walks all `applyXp(`/`grantXp(` call sites and asserts each is paired with an `xpGranted` emit (mirror of the sfx-coverage gate pattern).

**C-SYS3.2 „Wie levle ich?" info sheet (§E6 panel `xpInfo`).** Entry points: tapping the HUD level ring, and a „Wie levle ich?" row on the profile screen. Content: current level + XP bar („{xp} / {xpToNext} XP"); table of ALL 12 sources with LIVE numbers pulled from the constants (never hard-coded strings): Minispiel 10–25 · Quest 5–15 · Füttern 5 · Baden (komplett) 8 · Ausschlafen 10 · Kraulen 1 (heute {petsToday}/20) · Ernte 2 · Lieferung 3 · Foto 1 (heute {photoXpToday}/5) · Sammel-Sticker 5 · Sammel-Set 50 · Nougatschleuse 2; footnote row „Level-Belohnung: 25 × neues Level Münzen". Strings `strings/v4-xp.js`.

**C-SYS3.3 Next-unlock preview.** Shared pure helper `nextUnlock(level)` in `systems/leveling.js` → `{ level, kind: 'minigame'|'plot'|'garden'|…, nameKey } | null` from the merged unlock tables. Used by: the level-up toast (append „ · Nächstes: {name} (L{n})"), the recap end card (§C-SYS2.7), and the xpInfo sheet („Nächste Freischaltung"). At L40: „Alles freigeschaltet! 🏆".

### C-SYS4. Modifier events (owner requirement 4)

**C-SYS4.1 Cadence & window.** Per §B4: first event 30 min after first v4 boot; thereafter one event every 50–120 min (seeded uniform, persisted `nextAt` — reload/offline safe: an event whose `nextAt` passed while the app was closed starts on next boot). Active window: `plays` uses (2 or 3, per type) OR 45 min, whichever first. Only ONE event at a time, always exactly ONE (game, type) pair.

**C-SYS4.2 The 6 modifier types (exact numbers):**

| type id | name DE / EN | in-game effect | plays | payout rule (bounded — §C-SYS11) |
|---|---|---|---|---|
| `doppelGold` | Doppel-Gold / Double Gold | none (payout only) | 2 | round coins ×2 AFTER daily ×2 and code buff; per-round modifier surplus = paid − unmodified, capped at rowMax (i.e. paid ≤ 2 × rowMax) |
| `muenzregen` | Münzregen / Coin Rain | coin/pickup spawn rate ×1.5 in-game (`params.modifier.coinRate = 1.5`) | 3 | organic (more pickups → more score-coins); rowMax still clamps |
| `turbo` | Turbo / Turbo | game speed ×1.25 (`speedMult`), score ×1.5 rounded at end (`scoreMult`) | 3 | rowMax clamps as usual |
| `riesenGooby` | Riesen-Gooby / Giant Gooby | Gooby render scale ×1.6 (cosmetic) + player hit windows/hitboxes ×1.3 (`hitboxMult`) | 3 | none (easier ≠ richer beyond rowMax) |
| `stickerChance` | Sticker-Chance / Sticker Chance | the round's collection-drop roll is FORCED to success (games with §B3-v2 collection meta); games without drops instead guarantee +1 quest-progress tick | 2 | no coin effect |
| `glueckspilz` | Glückspilz / Lucky Charm | none in-game; results screen adds a „Glücksrolle": seeded uniform 10–60 c bonus with a 900 ms slot-roll animation | 3 | bonus counts against the §C-SYS11 day cap; pays 0 with note „Tagesbonus erreicht" when capped |

**C-SYS4.3 Eligibility matrix (frozen const in `modifierEngine.js`).** `doppelGold`, `glueckspilz`, `stickerChance`: all 27 arcade games. `muenzregen`: games with in-game pickups — `shoppingSurf, cityDrive, deliveryRush, starHopper, harborHopper, rocketRescue, toyRacer, bunnyHop, runner`. `turbo`: speed-loop games — `shoppingSurf, runner, bunnyHop, starHopper, toyRacer, harborHopper, veggieChop, carrotCatch`. `riesenGooby`: games rendering Gooby as the avatar — `shoppingSurf, runner, bunnyHop, trampoline, danceParty, goalieGooby, starHopper, harborHopper`. Trips (`mode: shopTrip/vetTrip`) are NEVER modified. Roll = uniform over the (game, type) pairs whose game is unlocked at the current level, minus `lastGameId`.

**C-SYS4.4 Framework wiring.** Arcade launch of the modified game consumes 1 play (§B4) and passes `ctx.params.modifier`; `economy.awardMinigame` gains an optional `modifier` argument for the payout rules above (pure, unit-tested). Quitting before the countdown ends refunds the play (no farming: refund max 1×/event). Results screen shows a „{name} aktiv" chip in the breakdown.

**C-SYS4.5 Arcade tile glow (the „shader-style" effect — VFX textures per §B3).** The modified game's tile gets a `<canvas>` overlay (tile-sized, `pointer-events: none`) compositing with `globalCompositeOperation: 'lighter'`: (a) `twirl_02.png` tinted gold `#FFD34D`, rotating 0.15 rev/s at 55 % opacity; (b) `circle_04.png` soft ring pulsing scale 0.92→1.08 / opacity 0.35→0.6 at 0.8 Hz; (c) 6 sparkle particles (`star_03.png`, 8–12 px) orbiting the border, respawn every 1.2 s. One shared rAF for the arcade screen; canvas paused when the screen is hidden; ≤ 1 ms/frame budget on-device (measured via the dev overlay). Tile badge top-right: „{playsLeft}× ✨" pill + `mm:ss` countdown (1 s tick) to `endsAt`. Tint per type: gold (doppelGold/glueckspilz), teal (muenzregen), coral (turbo), lavender (riesenGooby), pink (stickerChance).

**C-SYS4.6 Surfacing.** Notification id 8 per §B10. In-app: when an event starts while playing, `ui.toast('modifier.start', {game, name})` + `jingle.short`; the arcade nav badge dots while an event is live. Dev panel card 14 (§C-SYS6). Strings `strings/v4-modifier.js`.

**C-SYS4.7 Tests (`modifierEngine.test.js` ≥ 35):** schedule determinism per seed, cadence bounds (1000 rolls ∈ [50,120] min), no-repeat guard, eligibility filtering at levels 1/5/15/40, consume/expire/refund transitions, offline catch-up, payout math per type incl. day-cap behavior and daily-×2/code-buff stacking order, save round-trip of `current`.

### C-SYS5. Codes system (owner requirement 5)

**C-SYS5.1 Surfaces.** Settings → „Codes" subscreen: input field (autocapitalize/autocorrect off) + „Einlösen" button + list of redeemed codes (name, date, effect line). Dev panel card 13 (§C-SYS6). Engine per §B6.

**C-SYS5.2 Launch codes (exact):**

| code (as typed) | normalized secret | effect on redeem |
|---|---|---|
| `UpdateLiebe` | `updateliebe` | 10:00 min **Doppel-Münzen-Buff**: `codes.buffs.doubleCoinsUntil = now + 600 000`; toast „Doppelte Münzen für 10 Minuten! 💛"; HUD chip „×2 💰 {mm:ss}" (counts down, survives reload via the expiry timestamp, disappears at 0); multiplies minigame payouts ×2 AFTER the daily ×2 (stacking → ×4; §C-SYS11.2 bounds) |
| `IchLIE3BDich` | `ichlie3bdich` | unlocks sticker **#29 `herzGooby`** (+ sticker toast/sound via the normal stickerBook path) **+ 50 c** (`economy.award`, reason `code`); toast „Gooby hat dich auch lieb! 💗" |

**C-SYS5.3 Input handling.** Normalization: trim → toLowerCase → strip ALL whitespace (so „update liebe" works). Wrong code: input shakes 300 ms (CSS keyframe) + `ui.error` + toast „Hmm, das Wort kennt Gooby nicht" / "Hmm, Gooby doesn't know that word". Already redeemed: toast „Schon eingelöst! 😉" / "Already redeemed! 😉". Rate limit: 5 wrong attempts within a rolling 60 s → `codes.lockUntil = now + 30 s`; while locked the button is disabled with a countdown label („Warte {s} s"). Constants per §B10.

**C-SYS5.4 The 29th sticker — DECISION (binding): `herzGooby` is a BONUS sticker OUTSIDE the 28.** `stickerBookFull` keeps target 28 (no achievement/retro-save churn); catalog `data/stickers.js` appends `{ id: 'herzGooby', secret: true, cond: {code: 'herzGooby'} }`; the book renders page 5 as 2×3 with **5 slots** (28 regular + the secret slot): while locked it shows a „?"-silhouette with a heart outline, title „Geheim" / „Secret", hint „Ein geheimes Codewort schaltet ihn frei…" / "A secret code word unlocks it…" — the header stays „n/28" and gains a small „+💗" suffix once unlocked. Art: coordinator pre-wave generates `public/assets/stickers/herzGooby.png` (512×512, ≤ 150 KB; prompt = the frozen §C5.1-v3 prefix + „Gooby hugging a big glossy pink heart, blissful smile, tiny hearts floating around"). `stickers.test.js` grows to 29 files; `stickerBook10/20` unaffected (secret counts toward their `stickerCount` totals — harmless, they max at 20).

**C-SYS5.5 Tests (`codes.test.js` ≥ 20):** normalization table (case/whitespace/umlaut-free inputs), single-use enforcement, rate-limit window math (pinned clock), buff expiry across reload fixture, stacking math with daily ×2, herzGooby unlock idempotence, unknown-code reasons.

### C-SYS6. Dev panel „vollwertig" (owner requirement 6)

Audit of the 12 shipped cards (Unlock all · Level · Coins · Stats · Weight · Health · Weather/Band · Clock · Notification test · FPS/draw overlay + fake notch · Save tools · Sticker/Quest/Daily debug) — all stay. **6 new cards + 1 extension:**

| card | contents (exact) |
|---|---|
| **3+ Coins (extension)** | „Ledger" expander: the §B11 ring buffer (last 50 rows: `hh:mm:ss · +/−amount · reason · balance`), newest first, monospace |
| **13 · Codes** | list of ALL catalog codes: name, secret (dev may see it), status ✅/—; per row „Einlösen" (runs the real redeem path incl. effects) and „Reset" (deletes the redemption + reverts nothing else — testing convenience); „Lock zurücksetzen" button |
| **14 · Modifier** | current event readout (`game · type · playsLeft · endsAt`); force dropdowns (game × type) + „Start"; „Clear"; „Nächstes Event jetzt" (sets `nextAt = now`); respects the real engine (no parallel path) |
| **15 · Recap** | „Preview bei Level …" numeric prompt (5–40, plays the cinematic with CURRENT diff, no state writes); „Letzten Rückblick abspielen"; beat-debug toggle (overlays the bar grid + cue markers + ms-offset readout during playback — the §A2 ±80 ms evidence tool) |
| **16 · Radio/Tracks** | now-playing readout (`station · trackId · t/dur · effective gain`); skip/play/pause buttons; manifest stats (tracks per station, missing covers/beats counts); per-track quick-trim (mirrors the settings subscreen, dev-sized) |
| **17 · Sprungliste** | jump buttons for every registered scene (`home, gooby, roadtest, recap, …`) and screen/panel id (auto-listed from the ui registry); **Splat-Teleport**: one button per shipped Gooby-Welt splat scene (ids from plan B's registry) → loads the splat scene directly with a draw-call/fps readout |
| **18 · Harness-Spickzettel** | read-only rendering of the §E9 URL-param cheat sheet (from a `data/harnessParams.js` table — single source, also consumed by AGENTS.md regeneration), each row with a „Copy" button (`?param=…`) |

All new cards behind the same `devUnlocked` gate; strings in `strings/v4-dev.js` (EN+DE). Layout unchanged (single scroll column; cards 13–18 append below 12).

### C-SYS7. Sick-trip rule change (owner requirement 7)

**C-SYS7.1 Gate change (one line class).** `framework.js` sick gate becomes: block when `params.mode !== 'vetTrip' && params.mode !== 'shopTrip'` and `!canPlayMinigame(health)` — i.e. BOTH shop travel methods (drive AND Shopping Surf §C8.6-v3) launch while sick/queasy; pure arcade launches stay blocked with the existing `toast.tooSick`. `shopTrip.js` machine, rewards, tow rules: untouched. Rationale surfaced to the player: a sick Gooby drives slowly-but-surely to buy medicine.

**C-SYS7.2 Sick presentation during the trip.** Gooby wears the existing sick face/decal in the car/surf rig (already skin-driven); no gameplay handicap (the trip is the medicine run — don't punish it twice).

**C-SYS7.3 Care sheet + sick toast copy (exact, `strings/v4-sick.js`).** The care sheet (🤒 chip) now offers THREE actions + the hint line:

| key | DE | EN |
|---|---|---|
| `care.hintShop` (hint line under the title) | „Medizin hilft sofort — kauf welche im Laden, falls keine da ist." | "Medicine helps right away — buy some at the shop if you're out." |
| `care.medicine` (existing, unchanged) | „Medizin geben" | "Give medicine" |
| `care.shopTrip` (NEW button, 🛒) | „Zum Laden fahren" | "Drive to the shop" |
| `care.shopTrip.sub` (subline) | „Medizin kaufen (Fahrt kostet Energie)" | "Buy medicine (trip costs energy)" |
| `care.vet` (existing, unchanged, 🚑) | „Zum Tierarzt fahren" | "Drive to the vet" |
| `toast.sickNow` (fires when health flips to sick — replaces the current single-hint toast) | „Gooby ist krank! 🤒 Medizin geben — oder zum Laden oder Tierarzt fahren." | "Gooby is sick! 🤒 Give medicine — or drive to the shop or the vet." |

„Zum Laden fahren" emits the existing front-door travel sheet flow (drive/surf chooser) with `mode: 'shopTrip'`; when the player owns 0 medicine the shop screen auto-scrolls to the medicine row with a one-time pulse highlight. Tests: framework gate matrix (sick × mode × method), care-sheet render with 3 actions, i18n key presence.

### C-SYS8. Gyro parallax (owner requirement 8)

**C-SYS8.1 Setting.** Settings → Anzeige: toggle „Gyro-Parallax" (default OFF), subline „Bewege dein Handy — schau tiefer ins Zimmer" / "Move your phone — peek deeper into the room". Persisted `settings.gyro` (§B1).

**C-SYS8.2 Permission flow (iOS 13+).** Inside the toggle's tap handler (a user gesture — required): if `typeof DeviceOrientationEvent?.requestPermission === 'function'` → await it; `'granted'` → enable; `'denied'`/throw → toggle snaps back OFF + toast „Keine Berechtigung — Parallax bleibt aus" / "No permission — parallax stays off". Non-iOS browsers with the event: enable directly. No event support at all (desktop): the toggle still enables the POINTER fallback (§C-SYS8.4).

**C-SYS8.3 Mapping (frozen consts in `parallax.js`).** Inputs `beta` (x-tilt) / `gamma` (y-tilt) relative to a slow-adapting neutral pose (EMA τ = 4 s — holding the phone tilted becomes the new zero): deadzone 2°; sensitivity 0.008 m/°; clamps ±0.12 m horizontal, ±0.08 m vertical; camera offset lerped τ = 150 ms; look-at target stays fixed (pure translate — „deeper look", no nausea rotation). Home rooms only (all 5 incl. garden); forced to zero during care walk-tos, photo mode, and any overlay screen.

**C-SYS8.4 Fallback + guard.** Desktop/no-sensor: pointer-move parallax — normalized pointer position maps through the SAME clamp pipeline at ±0.06 m. Performance guard: rolling 5 s average < 25 fps → suspend (offset eases to 0 over 1 s); resume at ≥ 35 fps. Zero per-frame allocation; the listener detaches entirely while `settings.gyro === false` (no passive cost). Tests: mapping math (deadzone/clamps/EMA), guard hysteresis — pure function tests in `gyro.test.js`.

### C-SYS9. Photo gallery + export (owner requirement 9)

**C-SYS9.1 Persistence.** Every photo captured in photo mode is ALSO written to the §B7 IndexedDB store (auto-save; the existing share/download stays as-is). Cap 40 with oldest-first eviction (evicted silently; the grid shows „40/40" and a footnote „Älteste Fotos werden ersetzt"). Storage pressure per §B7 (evict-4-and-retry, else toast `gallery.full`).

**C-SYS9.2 Gallery UI.** Album screen gains a THIRD top-level tab: „Sticker | Stickerbuch | **Fotos**". Grid: 3 columns, square thumbs (object-fit cover, lazy `createObjectURL` revoked on unmount), newest first, count header „{n}/40". Tap → full-screen viewer: photo, date line, buttons „Teilen/Sichern" (share icon) · „Löschen" (trash, confirm sheet „Foto löschen?") · swipe left/right between photos · ✕ close. Empty state: Gooby-with-camera illustration + „Mach dein erstes Foto! 📸" + button that deep-links to photo mode.

**C-SYS9.3 Entry points / discoverability (exact).** (1) HUD album badge: gains photo-count awareness (badge dot when a new photo was added and the gallery not yet visited — `gallery.lastAddedAt` vs a session-seen stamp). (2) Profile screen: row „Galerie ({n} Fotos)" → opens the album on the Fotos tab. (3) One-time onboarding hint: first photo ever taken → toast „Dein Foto ist im Album gespeichert! 📖" (`gallery.hintShown` guards). (4) Photo-mode confirm screen gains a „Im Album ansehen" link. Sticker-book discoverability rides the same album entry points (owner note): the profile row sits directly under the existing sticker progress row.

**C-SYS9.4 Native export (exact plugin decision).** `package.json` currently ships NO share/filesystem plugin (verified: only app/core/haptics/ios/local-notifications/preferences). 4.0 ADDS exactly two dependencies: `@capacitor/share@^7` and `@capacitor/filesystem@^7` (latest 7.x at install time; `npx cap sync ios` must stay green on Linux). Viewer „Teilen/Sichern" on native: write the PNG via Filesystem (Directory.Cache) → `Share.share({ files: [uri] })` — the iOS sheet offers „Bild sichern" (photo library) without any photo-library permission plumbing. Guarded dynamic import (the established haptics/preferences pattern) — web builds never hard-require the plugins; web fallback = existing `navigator.share` files path → `<a download>` chain from photoMode (reused, extracted to a shared `ui/shareImage.js`). Failure path: toast „Teilen nicht möglich — Download gestartet".

**C-SYS9.5 Tests.** `gallery.logic.js` pure tests (cap/eviction/quota-retry decision table, badge stamp logic) ≥ 15; viewer/grid render smoke via the established CDP recipe (eval wave); plugin absence must not break web boot (guard test in `miscQuality`).

### C-SYS10. App icon 2.0 (owner requirement 10)

**C-SYS10.1 Art.** Coordinator pre-wave generates `GOOBY/art/icon-v4-source.png` — 1024², opaque, „layered look": Gooby face close-up with depth-stacked pastel layers (background wash → soft room bokeh → Gooby → foreground glow), no text, margins safe for iOS squircle masking (key content within the central 82 %). Optional parallax layers (`art/icon-v4-layer-{bg,mid,fg}.png`) are committed for future tvOS/widget use — NOT wired anywhere in 4.0 (stretch storage only).

**C-SYS10.2 Pipeline (`scripts/gen-icons.mjs` bypass).** New flag `--source <png>`: the script gains a minimal pure-node PNG DECODER (zlib inflate, colorType 2/6, non-interlaced — the encoder half already exists) and, when given a source, SKIPS the procedural face painter: flatten onto `#FFF6EC` (kills any alpha — the App-Store no-alpha rule stays enforced by emitting colorType 2), emit `AppIcon-512@2x.png` (1024²) + regenerate the splash 2732² (cream `#FFF6EC` field, the source image centered at 38 % width, existing splash naming). `npm run icons -- --source art/icon-v4-source.png` is the documented invocation; `test/icons.test.js` extends: output exists, is colorType 2, correct dimensions, byte-stable on re-run.

**C-SYS10.3 Stretch (committed, CI-safe): iOS 18 tinted/dark variants.** `AppIcon-dark-512@2x.png` (transparent-background variant is REQUIRED by iOS dark icons — exception to the no-alpha rule: dark/tinted variants legitimately carry alpha, only the `universal` 1024 must be opaque) + `AppIcon-tinted-512@2x.png` (grayscale) + the `Contents.json` `appearances` entries (luminosity `dark`/`tinted`). MUST keep `npx cap sync ios` and the Actions unsigned-.ipa build green — if the CI Xcode version rejects the appearances syntax, the variants ship as loose committed PNGs with a README and the Contents.json change is reverted (fallback documented; icon test only pins the universal icon).

### C-SYS11. Economy guard (owner requirement 11)

**C-SYS11.1 New coin sources & caps (binding table — plan B's endless modes inherit rows 5–6):**

| source | per-unit bound | daily bound |
|---|---|---|
| 1 doppelGold rounds | paid ≤ 2 × the game's rowMax | ≤ 2 plays/event; surplus counts into `modifiers.dayCoins` |
| 2 glueckspilz roll | 10–60 c | counts into `modifiers.dayCoins` |
| 3 muenzregen/turbo | rowMax clamp unchanged | plays-bounded (3) |
| 4 code buff (×2, 10 min) | paid ≤ 2 × (rowMax × daily-mult) per round | one-shot per code; single active buff (re-redeem impossible — single-use) |
| 5 modifier surplus TOTAL | — | `MODIFIER.DAY_COIN_CAP = 150 c`/local day (`dayCoins` ledger §B1); beyond it doppelGold pays base and glueckspilz pays 0 („Tagesbonus erreicht" note) |
| 6 endless modes (plan B) | must route `economy.award(reason:'endless')` | ≤ 100 c/local day from endless reasons (enforced in economy.js, same ledger pattern) |

Stacking order (frozen in `economy.awardMinigame`): `coins = clamp(rowFormula) × dailyFirstPlay(×2) × codeBuff(×2) × doppelGold(×2 as modifier)` — theoretical ×8 exists but is triple-gated (one game/day × 10-min window × 2 event plays) and the day caps bound the realized surplus.

**C-SYS11.2 Sim acceptance (updates `economy.test.js` — existing sims stay green untouched).** New `V4 economy simulation`: the v2 average day PLUS one modifier event (doppelGold, both plays used) PLUS one 10-min code-buff session (2 minigame rounds inside it) PLUS one glueckspilz roll (seeded mid-value 35 c). Assertions: (a) day net stays within **± 20 %** of the same seed's v2-sim net once the KNOWN additive bonuses are subtracted (i.e. the underlying economy is unchanged), (b) absolute day net ∈ **[+40 c, +480 c]**, (c) `dayCoins` never exceeds 150, (d) a 7-day loop with events every 85 min average yields lifetime coins within ×1.25 of the v3 baseline week. Any future coin surface without an `economy.js` reason tag is a test failure (reason whitelist assertion).

### C-SYS12. Settings IA + credits (owner requirement 12)

**C-SYS12.1 Main settings list (exact order, one row each):**

1. **Sprache** — segmented Auto/DE/EN (unchanged; keeps the 5×-tap dev gate on „Auto")
2. **Benachrichtigungen** — existing permission row (unchanged)
3. **Anzeige →** subscreen: UI-Größe (4-stop, unchanged) · Gyro-Parallax toggle (§C-SYS8)
4. **Audio →** subscreen: the 5 volume sliders + mute toggles + Haptik (all unchanged v3 rows) · row „Musik & Radio →" (per-track subscreen §C-SYS1.5)
5. **Radio** — opens `radioPanel` (§C-SYS1.3) directly (players think of the radio as a thing, not a setting)
6. **Codes →** subscreen (§C-SYS5.1)
7. **Credits →** subscreen (§C-SYS12.4)
8. **Entwickler →** dev panel row (renders only when `devUnlocked` — unchanged)

Subscreen mechanics per §B9. Everything that was on the flat v3 settings screen remains reachable in ≤ 2 taps; the main list fits a 320×568 @130 % viewport WITHOUT scrolling (8 rows × ≤ 56 px).

**C-SYS12.2 Migration of muscle memory:** the first open of v4 settings shows a one-time hint chip „Neu sortiert! Audio & Anzeige haben jetzt Unterseiten" (session-only, not persisted).

**C-SYS12.3 Layout acceptance:** all subscreens pass the §C1.3-v3 viewport × scale matrix (they are simple stacked rows — the per-track list virtualizes at > 40 tracks: render window of 24 rows).

**C-SYS12.4 Credits screen (NEW — license obligations land here).** Static scroll from `src/data/credits.js`, sections:

1. **GOOBY** — „Ein Spiel von <Owner> & den GOOBY-Agenten. Gooby ist handgemacht. 💛"
2. **3D-Welten (CC BY 4.0 — attribution REQUIRED, exact rows binding):** one row per shipped splat scene, format „{Titel}" von {Autor} — CC BY 4.0, verändert (dezimiert/komprimiert) · Quelle: superspl.at-Link. Day-one rows (per the D2 splat REPORT; plan B picks the shipped subset — every SHIPPED scene must have its row): „S Windmill in Golden Gate Park" von azadbal · „Avoncroft Museum – Postmill" von ijenko · „Ludlow – Quality Square" von ijenko. License link row: creativecommons.org/licenses/by/4.0.
3. **Musik (CC0, Dank-Erwähnung freiwillig):** „Playful Piano" — Dylann Taylor · „Music Loop Bundle" — Tallbeard Studios/Abstraction · „Orchestral & World Music" — Ragnar Random.
4. **Sounds & Grafik (CC0):** Kenney.nl (alle Kenney-Packs) · KayKit — Kay Lousberg · Tiny Treats — Isa Lousberg · „Interface SFX Pack 1" — ObsydianX · „Brackeys' VFX Bundle" — Brackeys, Picster, Kenney, Thomas Iché, CodeManu · „Aline Furniture" — Adelina Georgieva · „Cloudy Skyboxes" — Screaming Brain Studios · „Lucid Icons" — Leo Red · „Particles Pack 2" — Polar_34 · „Simple Vector UI" — PlayPug (rows render only for packs actually committed at ship — a `credits.test.js` cross-checks `data/credits.js` against the committed asset roots so no shipped pack is uncredited and no phantom row ships).
5. **Technik:** three.js · Vite · Capacitor (MIT/BSD notice line).

Strings `strings/v4-credits.js` (labels only; names/titles stay literal). A tap on any row is inert (no external browser in-app — URLs render as text).

---

**Cross-references for plan agents B & C:** plan B owns game-side modifier hooks (`ctx.params.modifier` consumption per §C-SYS4.2/4.3), the Tiny-Treats/Aline/splat content waves (§C-SYS2.3 #6 fallback note, §C-SYS12.4 credit rows), endless-mode economy reasons (§C-SYS11.1 row 6), and may claim the `radioMinutes`/`galleryPhotos`/`codesRedeemed`/`modifierPlays`/`recapsSeen` counters for new achievements. Plan C sequences: coordinator pre-wave (28+1 sticker art exists; 8 recap backdrops; 14 covers + `_default`; icon source) → wave-1 foundations (save v4 + constants §B10 + fetch-itch + music/beats scripts) → parallel feature waves → eval waves with the §A2 evidence items (recap beat overlay, modifier cycle run, radio getStats probes, coverage exact-set test).




---

# §E. Team Build Waves & Agent Prompts (4.0) — plan agent C

**How to use this section (coordinator):** 4.0 is built by **35 build agents (V4/G50 … V4/G84, ids G85–G87 reserved as buffer/fix slots) in 4 waves** (wave 1 = 1a solo + 1b ×10 · wave 2 = 10 · wave 3 = 9 · wave 4 = 5) plus **3 team-eval agents (V4/E-CAKE, V4/E-RECAP, V4/E-WELT)** that run right after wave 2 (§E0.1-12 loop), and the **24 final evals** of §F. Within a wave file ownership is strictly disjoint (OWNS/DO-NOT-TOUCH lists below; the only shared files are the append-only ones governed by §E0.1-10/-11). Wave N+1 may rely on wave N being merged, pushed and CI-green. To launch a build agent, forward **verbatim, as one message**: (1) the agent's block from §E2–§E6, then (2) the COMMON RULES text §E0.2 — nothing else. To launch a team eval, forward its §E4.1 block + the §E4.1-0 preamble. Each block header carries a **model tag** (`fable` = deep/complex work, `solfast` = fast content/porting/audit work) — launch the agent on that model. Between waves run the §G checkpoints **and the §G0/§G4 art + GoobyMusic gates** (the coordinator generates all AI art and processes owner music uploads BETWEEN waves — no build agent generates art).

## E0. Shared conventions for all 4.0 build agents

### E0.1 Design decisions & cross-plan reconciliations made here (binding, referenced by the prompts)

1. **Ids & teams.** Build agents are `V4/G50 … V4/G84` (sequential across waves). Wave 2 is organized as flagship teams: Team CAKE = G61 (logic) + G62 (scene) + eval V4/E-CAKE; Team RECAP = G63 (3D vignettes) + G64 (overlay/beat choreography) + eval V4/E-RECAP; Team WELT = G65 (splat integration) + G66 (game design) + eval V4/E-WELT. G67–G70 ride wave 2 without their own eval (covered by §F).
2. **Payout stacking order — RECONCILIATION (supersedes the ordering sentence in PLAN4-GAMES §G8-3 where they differ).** PLAN4.md §C-SYS11.1/§C-SYS4.2 (plan A owns `economy.js`; plan B marked it [→A]) is authoritative. Single site in `economy.awardMinigame`: `base = min(row.max, round(rowClamp(score) × difficultyMult))` (per §G5.2; endless passes `coinsOverride: 5` instead) → `paid = base × dailyFirstPlay(×2) × codeBuff(×2) × doppelGold(×2)`; doppelGold additionally caps `paid ≤ 2 × row.max` and books `paid − (base × daily × buff)` into `modifiers.dayCoins` against `MODIFIER.DAY_COIN_CAP` (§C-SYS11.1 rows 1/5); glueckspilz is a separate `economy.award(reason:'glueckspilz')` on the results screen. `reward.modifierBonus` is returned to the framework for the §G8-3 results row. G54 implements; `economy.test.js` v4 sim pins it.
3. **Modifier gameplay effects — RECONCILIATION (supersedes PLAN4-GAMES §G8-4's „coin-side only").** §C-SYS4.2/4.3 are §A2 acceptance and win: `muenzregen`/`turbo`/`riesenGooby` DO change gameplay in exactly the §C-SYS4.3-listed games. Purity is preserved B's way: the game's `.js` scene derives plain tuning numbers from `ctx.params.modifier` (`coinRate`, `speedMult`, `scoreMult`, `hitboxMult`, render scale) and passes them into `createRun(...)`/logic init as ordinary parameters — no `.logic.js` ever imports or reads modifier STATE. Consumption ships with the wave-3 difficulty batch that owns each game file (cityDrive → G77).
4. **Asset ledger — RECONCILIATION.** `test/assetBudget.test.js` v4 uses PLAN4.md §A2's numbers (warn > 280 MB, fail > 1536 MB) — this already satisfies §G6.2's „raise BEFORE the splat commit lands" requirement; §G6.2's suggested 65/80 MB numbers are superseded. G50 lands the raise in wave 1a, in the same commit series as the splat PLYs, with the splat files named in the test comment as justification.
5. **VFX texture roots — both specs verbatim.** The 6 Brackeys modifier-glow textures → `public/assets/itch/vfx/` (§B3); the 2 surf streak textures → `public/assets/vfx/streak_a.png|streak_b.png` (§G4.2). Both copied by G50's `fetch-itch.mjs` manifest.
6. **`package.json` is edited exactly once, by G50 (wave 1a):** dependencies `@mkkellogg/gaussian-splats-3d@0.4.7`, `@capacitor/share@^7`, `@capacitor/filesystem@^7` (§G6.1, §C-SYS9.4) + npm scripts `"music-manifest"`, `"beats"`, `"fetch-itch"` (the `.mjs` files themselves are owned by G51/G50 per their blocks). Afterwards frozen for all of 4.0 (a genuinely needed new dep is a coordinator escalation, never a direct edit). After G50 merges, the coordinator runs `npm install` once before launching wave 1b.
7. **`src/data/constants.js` is re-opened exactly once: G53, wave 1b, ONE marked `// V4/G53` region** containing ONLY: `SAVE.VERSION: 4`; `NOTIFY.IDS.modifier: 8` + `NOTIFY.MAX_SCHEDULED: 8`; `CODES: { LOCK_AFTER: 5, LOCK_WINDOW_SEC: 60, LOCK_SEC: 30 }`; `MODIFIER: { DAY_COIN_CAP: 150 }` (all §B10); plus the ONE new game row [→A per §G6.4]: `COIN_TABLE.goobyWelt = { divisor: 6, min: 4, max: 20 }`, `UNLOCKS.MINIGAMES.goobyWelt = 12`, energy 8 in `data/minigames.js`. Afterwards frozen again. Every other 4.0 number (station tables, modifier tuning, recap grid, gyro numbers, difficulty families, per-game tunes) lives as exported frozen consts inside the owning module / `.logic.js` (§E0.1-2-v3 pattern carries over).
8. **Strings stay conflict-free via per-feature modules (v3 §E0.1-2 carried forward).** `src/data/strings.js` is edited exactly ONCE, by G53 in wave 1b: static imports + spreads of **19 new modules** under `src/data/strings/` (after all v3 spreads): `v4-core.js` (G53 — notification id 8 copy §B10, shared misc), `v4-radio.js` (G52), `v4-codes.js` (G58), `v4-settings.js` (G58 — IA labels, hint chip, gyro + Steuerung toggles), `v4-dev.js` (G58), `v4-controls.js` (G58 renders §G3.3's keys; module name per §G3.3), `v4-difficulty.js` (G56), `v4-recap.js` (G64), `v4-xp.js` (G69), `v4-modifier.js` (G76), `v4-sick.js` (G70), `v4-surf.js` (G67), `v4-arcade.js` (G68), `v4-cake.js` (G62), `v4-welt.js` (G66), `v4-gallery.js` (G59), `v4-foods.js` (G79), `v4-credits.js` (G81), `v4-ship.js` (G82). G53 creates all 19 (18 as `{EN:{},DE:{}}` stubs with ownership headers). Add keys ONLY to your module, always EN + DE. `strings.js`, `v2-*`, `v3-*` stay frozen.
9. **`src/audio/sfxMap.js` ownership timeline.** Waves 1–2: append-only — ONE marked `// V4/G<id>` block per agent at end-of-file, mapping new ids ONLY to (a) sample keys committed by G50 or already-committed packs, or (b) existing synth recipe names (no new recipes). Wave 3: **G78 EXCLUSIVE** — the §C-SYS1.9.2 46-id sweep + dead-recipe deletion + consolidation of the wave-1/2 marked blocks. Wave 4: append-only again. `src/ui/styles.css`: append-only marked blocks in ALL waves (no whole-file pass in 4.0; rem-based declarations only, `npm run px-audit` stays green).
10. **Shared-append files + verify protocol (v3 §E0.1-6 carried forward):** `src/main.js`, `src/dev/harness.js`, `src/ui/icons.js`, `src/ui/hud.js` (4.0 addition — XP floaters G56, now-playing suppression hook G52, ×2-buff chip G58, album badge G59 each land ONE marked block), `src/ui/profileScreen.js` (4.0 addition — gallery row G59, „Rückblicke" G64, „Wie levle ich?" G69), plus `sfxMap.js`/`styles.css` per #9. Protocol: make these edits immediately before committing; after committing run `git -C /workspace show HEAD:GOOBY/src/<path> | grep "V4/G<id>"` — if your block is missing (concurrent writer won), re-apply and commit again. Any other foreign-file edit your block explicitly grants must be an additive marked one-liner (`// V4/G<id>: <why> (§<ref>)`).
11. **Same-wave runtime dependencies degrade gracefully (v3 §E0.1-11):** lazy dynamic import + feature-detect + a „not built yet" fallback, noted in the report. Known instances planned in: G58's dev cards 15/17 (recapScene/goobyWelt land wave 2), G58's Credits row (creditsScreen lands wave 4 — row renders only when the screen id is registered), G52's radioPanel „Track-Einstellungen" link (subscreen is G52's own — no gap), G68's modifier banner/glow (accessor is wave-1 G54's — no gap by launch order).
12. **Team eval → fix loop (v3 §E0.1-12 verbatim):** team evals launch immediately after CP-W2; READ-ONLY; findings `[P0|P1|P2]` with repro + evidence; the coordinator resumes the team's build agent(s) with P0/P1 rows verbatim; re-check must pass before wave 3 launches. P2s may defer to §F with justification.
13. **XP floaters — single-emit ruling (§C-SYS3.1 mechanics):** the `xpGranted {amount, source}` event is emitted INSIDE `systems/leveling.js`'s `applyXp(amount, source)` (G56 adds the `source` param + emit; amount-0 grants emit nothing). The call sites pass their source tag as additive marked one-liners — G56's block grants the 11 sites across `home/interactions.js`, `systems/sleep.js`, `systems/achievementsEngine.js`, `systems/nougat.logic.js`; the `economy.awardMinigame` site's tag is landed by G54 (it owns `economy.js` in the same wave — coordinate via this ruling). The §C-SYS3.1 static-analysis test walks all `applyXp(`/`grantXp(` sites and asserts a source tag is present.
14. **Difficulty single sources:** `src/data/difficultyTargets.js` (G54, wave 1) holds the §G5.4 Schwer-target table — consumed by `economy.awardMinigame` (`beaten` writes), mgPregame („Ziel: N"), and eval bots. `applyDifficulty(tune, mode)` lives in each game's `.logic.js` (wave-3 batches; purblePlace's ships with G61 in wave 2 — its §G1.6 rows are part of the rework; shoppingSurf's ships with G74). Save shapes `minigames.difficulty/beaten/bestByDiff/endlessBest`, `settings.controls`, `settings.goobyWeltQuality` land in G53's `migrations[3]`/`validate()` in wave 1 (§G5.5/§G3.3/§G6.6 [→A] consumed).
15. **Radio furniture chain:** G50 commits the `pleasant-picnic/radio` GLB (§C-SYS1.4); G52 appends the `data/furniture.js` row + the `tap:radio` wiring + pulse/notes; G53's `migrations[3]` grants + places it (§B1). Fresh-save grant also G53 (`defaultState()`).
16. **`audio.setLoopGain(id, gain01)` is NOT descoped:** G51 implements it in `audio.js` (§G4.5 [→A] contract) — no-op when the loop isn't playing, zero nodes while music-muted.
17. **Beats toolchain:** G51 owns `scripts/gen-music-manifest.mjs` + `scripts/gen-beats.mjs`, runs both on the committed §C-SYS1.7 files, and measures + commits the `Recap - Abenteuer` `beats.override.json` (§B5.3/§C-SYS2.6). G55/G63/G64 consume the committed formats only.
18. **`controls.invertible` exports:** G57 adds the one-line static `export const controls = { invertible: <bool> }` to ALL 27 game modules in wave 1 (§G2.1-4/§G3.3 values) — the wave-2/3 rework agents preserve the line. `test/controlsContract.test.js` (G57) locks it.
19. **`src/minigames/registry.js` is NEVER edited** (auto-discovery). `data/minigames.js` is edited exactly once (G53: the goobyWelt row, titleKey from `v4-welt` stub).
20. **Per-agent evidence dirs:** build agents `/tmp/gooby-v4-g<id>/`, team evals `/tmp/gooby-v4-e-<team>/`, final evals `/tmp/gooby-v4-e<n>/`. Probative copies to `/opt/cursor/artifacts/` prefixed `v4g<id>_` / `v4<team>_` / `v4e<n>_`.

### E0.2 COMMON RULES FOR ALL V4 BUILD AGENTS (relay this text verbatim after every agent block)

> **Product context.** GOOBY (in `/workspace/GOOBY`; Vite 6 + three ^0.170 + vanilla-ESM mobile web game, Capacitor 7 iOS wrap) is a finished, thrice-eval-hardened Pou-class virtual pet: a fat cream procedural rabbit you feed, wash and play with across 27 arcade minigames incl. two flagships, a real-time garden, sickness/vet/weight sim, quests, collections, a 28-sticker AI Stickerbuch, a drivable city with 2 travel methods, jingle-medley music on 5 buses, UI scaling 85–130 %, a hidden dev panel, 42 outfits and a lossless save v3 — 1226 green node:test tests at baseline `0d3a2dd`+PLAN4 commits, ESLint 9 clean, green unsigned-.ipa CI, bilingual EN+DE, portrait 320–430 px. GOOBY 4.0 („VOLLVERSION FINAL") adds: a real-music radio (registry + stations + per-track trims + now-playing + covers), a beat-synced level-up recap cinematic through 8 biomes, XP transparency, timed minigame modifier events with arcade glow, a secret-codes system (sticker #29), a complete dev panel (cards 13–18), sick shop-trips, gyro parallax, a persistent photo gallery with iOS export, app icon 2.0, economy guard rails, settings IA + credits, save v4 — AND the game-side half: an authentic Purble-Place „Comfy Cakes" rework, a controls-direction audit + global invert setting, surf speed juice, a Leicht/Mittel/Schwer + Endlos difficulty system with a pre-game cover-art screen, the Gaussian-splat special game „Gooby Welt", room polish and food-value chips. You are one build agent in a coordinated wave; other agents are editing OTHER files concurrently in this same checkout — file discipline is critical.
>
> **Mandatory first steps, in order:** (1) read `/workspace/GOOBY/AGENTS.md` fully (conventions + the VM/CDP testing recipe — SwiftShader is slow and there is NO audio device: verify audio via `audio.getStats()` + console logs); (2) read the `GOOBY/PLAN4.md` and/or `GOOBY/PLAN4-GAMES.md` sections listed in your block, plus PLAN4.md §A2 (Definition of 4.0), §A3 (invariants) and §E0.1 (rulings) — these are your binding spec; PLAN.md §E contracts, PLAN2.md and PLAN3.md numbers remain binding underneath; (3) minigame agents: also read PLAN.md §E8 and skim `src/minigames/games/carrotCatch.js`+`.logic.js` plus `framework.js`; (4) read every existing file you will modify BEFORE editing it.
>
> **Hard rules.** Git root is `/workspace`; never touch `/workspace/MONKEYBAR` or files outside your OWNS/marked-edit lists. CRLF line endings in new/edited files. Vanilla ESM + JSDoc; no TypeScript; no new deps beyond G50's one-time §E0.1-6 package.json commit. `npm run lint` + `npm run px-audit` must stay clean. Every user-facing string via `t(key)` with BOTH EN and DE entries, added ONLY in your assigned `src/data/strings/v4-*.js` module (§E0.1-8) — never edit `strings.js` or another agent's module. `src/data/constants.js` is read-only (G53's single wave-1 block excepted, §E0.1-7); tuning numbers are exported frozen consts in the owning module / `.logic.js`. Pure modules (`systems/`, `data/`, `*.logic.js`) import no three.js/DOM. ALL coin movement through `systems/economy.js` with a reason tag (§C-SYS11's whitelist test will fail unknown reasons). Every `audio.play('<id>')` id you introduce must be mapped in `sfxMap.js` in the same commit under the §E0.1-9 timeline. Gooby himself stays 100 % procedural (§A3). Shared-append files: §E0.1-10 protocol (one marked block, appended immediately before commit, verified after commit, re-applied if lost). v1–v3 game rules, coin rows and the 1226 existing tests stay intact — existing tests may be *edited* only where §A2 names a legitimate spec change (audioCoverage floors, assetBudget limits, notifyRules cap 7→8, framework sick gate, icons source-bypass, economy sim v4, purblePlace rework suites, carController steer-sign), never deleted to pass.
>
> **Verification standard (ALL of it, before you commit):** `npm test` fully green (from `/workspace/GOOBY`), `npm run lint` clean, `npm run build` green. Runtime proof over CDP for every feature you shipped: start YOUR dev server `npx vite --port <your vite port> --strictPort --host` (never 5174 — a long-lived tmux server owns it), drive real-time headless Chrome via `chromium --headless=new --remote-debugging-port=<your CDP port>` per the AGENTS.md recipe, and save screenshots + JSON state dumps to `/tmp/gooby-v4-g<id>/` (descriptive snake_case names). **Layout matrix for any NEW or CHANGED UI surface:** widths 320/390/430 × UI scales 85/100/130 % × `?lang=en`+`?lang=de` — zero clipped/overlapping text, no horizontal scroll, tap targets ≥ 44 real px; if you moved/added FIXED-position chrome, repeat the worst combo with the dev-panel fake-notch on. **Minigame agents additionally:** 5 `?autoplay=1` completions per touched game per touched difficulty with a raw-score + payout table — every payout inside the game's coin row after the §E0.1-2 stacking, energy exact, first-play ×2 once/day; bot bars per your block. When done, kill every process YOU started by PID — never `pkill -f`, never the tmux 5174 server.
>
> **Commit protocol:** `git -C /workspace add <explicit paths only>` (never `-A`), one commit per logical unit, message `GOOBY V4/G<id>: <summary>`. NEVER push. On `.git/index.lock` wait 5 s and retry (up to 10×) — other agents commit concurrently.
>
> **Report back (compact, in this order):** ① shipped vs mission (one line per feature); ② contracts/APIs exposed for later agents (JSDoc signatures); ③ evidence inventory in `/tmp/gooby-v4-g<id>/` + the 3–6 most probative artifacts named; ④ tables (autoplay score/payout runs; tests before→after; layout-matrix grid); ⑤ deferred items / requests for the coordinator (be explicit — e.g. missing art, needed follow-up agents); ⑥ commit hash(es).

### E0.3 Ports (12 concurrent slots; also §G1)

| slot | vite | CDP | | slot | vite | CDP |
|---|---|---|---|---|---|---|
| A | 5175 | 9221 | | G | 5181 | 9227 |
| B | 5176 | 9222 | | H | 5182 | 9228 |
| C | 5177 | 9223 | | I | 5183 | 9229 |
| D | 5178 | 9224 | | J | 5184 | 9230 |
| E | 5179 | 9225 | | K | 5185 | 9231 |
| F | 5180 | 9226 | | L | 5186 | 9232 |

Slot = the agent's position in its wave listing (printed in each block). Port 5174/tmux (`gooby-dev-server`) belongs to the coordinator. Team evals reuse their team's slot; final evals map `((n−1) mod 12)`. Stuck port after an agent dies: `lsof -ti:<port>` → kill that PID only.

### E0.4 Roster & §A2 coverage map

| id | mission | model | wave | slot | key files (owned) |
|---|---|---|---|---|---|
| G50 | asset pipeline: itch/music/splat/vfx copies, 3 npm deps, ledger raise, credits data | fable | 1a | A | scripts/fetch-itch.mjs, public/assets/{itch,music,splats,vfx}/**, package.json, test/assetBudget.test.js, data/credits.js |
| G51 | music registry + radio engine: manifest/beats scripts, radioPlayer, audio.js radio chain | fable | 1b | B | scripts/gen-music-manifest.mjs, scripts/gen-beats.mjs, data/musicManifest.json, systems/musicRegistry.js, audio/radioPlayer.js, systems/radioQueue.logic.js, audio/audio.js, test/musicRegistry.test.js |
| G52 | radio UI: radioPanel, now-playing chip, per-track settings, radio furniture | solfast | 1b | C | ui/radioPanel.js, ui/nowPlaying.js, ui/trackSettings.js, data/furniture.js (row), strings/v4-radio.js |
| G53 | save v4 + codes engine + data spine (constants block, strings spread, sticker #29, notify id 8) | fable | 1b | D | core/save.js, systems/codesEngine.js, data/{codes,stickers,minigames}.js, constants.js (block), systems/notifyRules.js, strings.js spread + 19 stubs, test/{saveV4,codes}.test.js |
| G54 | modifier engine + scheduler + economy v4 (stacking, ledger, caps, beaten writes) | fable | 1b | E | systems/modifierEngine.js, systems/economy.js, data/difficultyTargets.js, core/timeEngine.js (block), test/{modifierEngine,economy}.test.js |
| G55 | recap engine (pure) + beat grid + trigger plumbing | fable | 1b | F | systems/recapEngine.js, main.js (block), test/recapEngine.test.js |
| G56 | framework 2.0: async lifecycle, difficulty/endless plumbing, modifier consume, sick gate, invert proxy, XP floaters + nextUnlock | fable | 1b | G | minigames/framework.js, core/inputInvert.js, core/sceneManager.js, systems/leveling.js, ui/hud.js (block), strings/v4-difficulty.js |
| G57 | controls flips: carController sign contract, harborHopper mirror, invertible exports ×27, contract tests | fable | 1b | H | city/carController.js, games/harborHopper.js (input line), 27 one-line exports, test/controlsContract.test.js, dev/harness.js (block) |
| G58 | dev panel 2.0 (cards 13–18 + ledger) + settings IA + codes/controls/gyro toggles UI | fable | 1b | I | ui/devPanel.js, ui/settingsScreen.js, ui/codesScreen.js, data/harnessParams.js, strings/v4-{codes,settings,dev,controls}.js |
| G59 | gallery: photoStore (IDB), gallery logic, album Fotos tab + secret sticker slot, share/export | fable | 1b | J | core/photoStore.js, systems/gallery.logic.js, ui/albumScreen.js, ui/shareImage.js, ui/photoMode.js (link), strings/v4-gallery.js |
| G60 | gyro parallax module + homeScene integration | solfast | 1b | K | home/parallax.js, home/homeScene.js (block), test/gyro.test.js |
| G61 | Team CAKE: purblePlace.logic.js belt-sim rework + bot + difficulty/endless rows | fable | 2 | A | games/purblePlace.logic.js, test/purblePlace.test.js |
| G62 | Team CAKE: purblePlace scene — pedals/dock/overview strip/dressing | fable | 2 | B | games/purblePlace.js, strings/v4-cake.js |
| G63 | Team RECAP: recapScene 3D — 8 biome vignettes, dollies, Gooby spline | fable | 2 | C | home/recapScene.js |
| G64 | Team RECAP: overlay — beat-synced text, skip, end card, replay row, beat-debug overlay | fable | 2 | D | ui/recapOverlay.js, ui/profileScreen.js (block), strings/v4-recap.js |
| G65 | Team WELT: splat viewer integration, loading UX, quality toggle, perf/lifecycle, fallback stage | fable | 2 | E | games/goobyWelt.js |
| G66 | Team WELT: game design — logic, paths authoring, pickups, bot, flycam | fable | 2 | F | games/goobyWelt.logic.js, games/goobyWelt.paths.js, test/goobyWelt.test.js, strings/v4-welt.js |
| G67 | surf juice + §G3.1-b flip + runner-class rollout | fable | 2 | G | games/shoppingSurf.js, games/{runner,toyRacer,harborHopper}.js (juice blocks), strings/v4-surf.js |
| G68 | pre-game screen + 2-col cover grid + modifier banner/tile glow hookup | fable | 2 | H | ui/mgPregame.js, ui/arcadeScreen.js, strings/v4-arcade.js |
| G69 | XP info sheet + level-up unlock preview | solfast | 2 | I | ui/xpInfo.js, level-up toast (block), strings/v4-xp.js |
| G70 | sick-trip UX: care sheet 3 actions, toasts, shop medicine pulse | solfast | 2 | J | home/interactions.js (careSheet), ui/shopScreen.js (block), strings/v4-sick.js, test additions |
| G71 | difficulty+endless+modifier batch A: carrotCatch, bunnyHop, carrotGuard, memoryMatch, runner, basketBounce, pancakeTower | solfast | 3 | A | those 7 games' files + tests |
| G72 | batch B: danceParty, fishingPond, bubblePop, trampoline, starHopper, pipeFlow, deliveryRush, miniGolf | solfast | 3 | B | those 8 games' files + tests |
| G73 | batch C: goobySays, gardenRush, burgerBuild, veggieChop, goalieGooby | solfast | 3 | C | those 5 games' files + tests |
| G74 | batch D (v3-era + surf): shoppingSurf, toyRacer, ghostHunt, rocketRescue, harborHopper | fable | 3 | D | those 5 games' logic/tests |
| G75 | endless integration + highscore boards + difficulty cross-tests | fable | 3 | E | test/difficultyEndless.test.js, endless seam one-liners |
| G76 | modifier surfacing UI: tile glow canvas, badges, toasts, glueckspilz roll, results chip | fable | 3 | F | ui/modifierGlow.js, results-screen block, strings/v4-modifier.js |
| G77 | modifier system integration: e2e cycle, cityDrive hook, notification id 8 proof, integration tests | fable | 3 | G | test/modifierIntegration.test.js, city/cityDrive.js (block) |
| G78 | synth-replacement sweep: 46-id table, dead recipes, audioCoverage v4 exact-set | solfast | 3 | H | audio/sfxMap.js (exclusive), audio/audio.js (recipe deletions), audio/loudness.json, test/audioCoverage.test.js |
| G79 | room polish + food value chips + 3 new foods (§G9) | solfast | 3 | I | home/decor.js, home/rooms/*, data/foods.js, tray/shop chip blocks, strings/v4-foods.js |
| G80 | icon 2.0: PNG decoder, --source bypass, splash, dark/tinted, version 4.0.0 | fable | 4 | A | scripts/gen-icons.mjs, ios icon assets, test/icons.test.js, project.pbxproj |
| G81 | credits screen + cross-check test | solfast | 4 | B | ui/creditsScreen.js, test/credits.test.js, strings/v4-credits.js |
| G82 | whatsNew 4.0 + NEU + docs (README/AGENTS/harness cheat sheet) | solfast | 4 | C | ui/whatsNew.js, README.md, AGENTS.md, strings/v4-ship.js |
| G83 | cover-art integration: 28 game covers + track covers + backdrops verification/wiring | solfast | 4 | D | public/assets/covers/** wiring checks, contact sheet, ledger re-run |
| G84 | integration sweep: 28-game chain, cross-feature seams, report-mop-up | fable | 4 | E | cross-cutting marked one-liners only |

**§A2 coverage:** radio 14 tracks/manifest/trims/now-playing → G50+G51+G52; NO-synth 46-id sweep + exact-set test → G78; recap 8 milestones/±80 ms/replay → G55+G63+G64; modifiers 6 types/cadence/glow/id 8 → G54+G76+G77 (+G71–G74 params); codes + sticker #29 → G53+G58; dev panel 18 cards → G58; sick-trip → G56 (gate) + G70 (UX); gyro → G60; gallery cap 40 + plugins → G50 (deps) + G59; icon 2.0 + 4.0.0 → G80; economy guards → G54; settings IA + credits → G58+G81; save v4 lossless + ≥100 fuzz → G53; purble 1:1 → G61+G62; controls audit + invert → G56+G57 (+G67 surf); surf juice → G67; difficulty 26 games + endless → G56+G54+G61+G71–G75; Gooby Welt → G65+G66 (+G50 assets); covers/pregame → G68+G83; rooms/foods → G79; whatsNew/docs → G82; tests ≥ 1446 → all.

## E1. Wave overview (every wave's coordinator gate listed inline)

| wave | agents (slot) | theme | gate BEFORE launch (coordinator) |
|---|---|---|---|
| 1a | G50 (A) solo | asset pipeline: every 4.0 binary + the 3 npm deps committed | **§G0 gates:** baseline green (1226/lint/build/CI), staging roots present, **ART-GATE-1: herzGooby sticker PNG + 14 builtin track covers + `_default.png` committed** (G51's manifest + G53's 29-file sticker test consume them); GoobyMusic poll #0 |
| 1b | G51 (B) radio engine · G52 (C) radio UI · G53 (D) save v4+codes · G54 (E) modifiers+economy · G55 (F) recap engine · G56 (G) framework 2.0 · G57 (H) controls flips · G58 (I) dev panel+settings · G59 (J) gallery · G60 (K) gyro | foundations — every 4.0 system engine + contract live; v3 saves boot unchanged except new slices | CP-W1a: §G2 + `npm install` after G50's package.json commit + `npm run fetch-itch` idempotence + ledger test green → push + CI |
| 2 | G61 (A)+G62 (B) Team CAKE · G63 (C)+G64 (D) Team RECAP · G65 (E)+G66 (F) Team WELT · G67 (G) surf juice · G68 (H) pregame+covers grid · G69 (I) XP sheet · G70 (J) sick-trip UX | flagship teams + wave-1-consumer UX | CP-W1: §G2 (suite ≥ 1320); v1+v3 fixtures migrate lossless; radio plays via `getStats()`; modifier force-cycle via dev card; codes redeem; recap engine tests green; invert proxy + carController/harbor probes attached → push + CI. **ART-GATE-2: 8 recap backdrops (`public/assets/recap/bg-1..8.png`) committed** (G63 consumes); GoobyMusic poll #1 |
| 2e | V4/E-CAKE (A) · V4/E-RECAP (C) · V4/E-WELT (E) | per-team evals → fix rounds (§E0.1-12) | CP-W2: §G2 (suite ≥ 1380); purble bot ≥ 90 Mittel avg; recap plays end-to-end at a forced L5; goobyWelt both scenes load + dispose ×10; surf flip probe; pregame launches all 4 modes → push + CI |
| 3 | G71 (A) · G72 (B) · G73 (C) · G74 (D) difficulty batches · G75 (E) endless · G76 (F) modifier UI · G77 (G) modifier e2e · G78 (H) synth sweep · G79 (I) rooms+foods | difficulty/endless/modifier rollout over all games + audio sweep + content | team-eval fix rounds merged, zero open team P0/P1 → §G2 → push + CI. GoobyMusic poll #2 |
| 4 | G80 (A) icon · G81 (B) credits · G82 (C) whatsNew+docs · G83 (D) cover integration · G84 (E) integration sweep | ship polish, art wiring, version 4.0.0 | CP-W3: §G2 (suite ≥ 1435); 26-game difficulty spot matrix; audioCoverage exact-set green; modifier full pinned-clock cycle logged → push + CI. **ART-GATE-3: 28 game covers + icon source (`GOOBY/art/icon-v4-source.png`) committed** (G83/G80 consume); GoobyMusic poll #3 |
| — | §F evals ×24 (batches of ≤ 12) | final adversarial evals + fix loop | CP-W4: §G2 (suite ≥ 1446); whatsNew 4.0 once; MARKETING_VERSION 4.0.0; 28-tile arcade; icon test green → push + CI |

## E2. WAVE 1a — asset pipeline (launch G50 alone)

### V4/G50 — asset pipeline 4.0: itch root, Bordmusik, splats, VFX, deps, ledger, credits data (slot A) — model: **fable**

> You are build agent V4/G50 for GOOBY 4.0 „VOLLVERSION FINAL". GOOBY commits only whitelist-manifested CC0/CC-BY assets; 4.0 adds an itch.io root (ObsydianX SFX subset, Tiny Treats packs, Aline furniture, Brackeys VFX), the committed CC0 „Bordmusik" music set, two CC-BY Gaussian-splat scenes, and three npm deps. **Your mission:** land every 4.0 binary + dependency so every later agent finds every asset on disk, plus the credits data file and the raised asset ledger.
>
> **Read (after AGENTS.md):** PLAN4.md §B3 (ALL — your core spec), §C-SYS1.7 (exact Bordmusik file table — renames binding), §C-SYS4.5 (the 6 VFX textures), §C-SYS9.4 (the two Capacitor plugins), §C-SYS12.4 (credits rows — you write the DATA), §A2 assets bullet, §E0.1-4/-5/-6; PLAN4-GAMES §G6.2 (splat files + licenses), §G4.2 (streak textures), §G9.1/§G9.3 (Tiny Treats/Aline copy list incl. baked-goods GLBs, pleasant-picnic radio), §G7.1 (covers dir — create empty with a README, art is coordinator-owned). Then read `scripts/fetch-kenney.mjs`+`kenney-manifest.mjs` (your pattern), `scripts/kaykit-*.mjs`, `test/assetBudget.test.js`, `package.json`. Staging: `/workspace/asset-staging/itchio/` (+ its REPORT.md), `/workspace/asset-staging/splats/` (+ REPORT.md), music zips per §C-SYS1.7 paths.
>
> **OWNS (create):** `scripts/fetch-itch.mjs` (whitelist manifest staging→repo incl. renames, glTF+BIN→GLB conversion for baked-goods where §G9.3 says so, LICENSE-NOTE per pack, fail loudly on misses/oversizes), `public/assets/itch/**` (itch-sfx ~26 OGGs, vfx 6 textures, pleasant-picnic radio, tiny-treats bakery/baked-goods/picnic, aline 4 GLBs), `public/assets/music/**` (14 renamed OGGs + consolidated LICENSES.md), `public/assets/splats/{windmill-golden-gate-mobile.compressed.ply, ludlow-quality-square-mobile.compressed.ply}` + `<id>.LICENSE.txt` (§G6.2), `public/assets/vfx/{streak_a,streak_b}.png` (§E0.1-5), `public/assets/covers/README.md`, `src/data/credits.js` (§C-SYS12.4 sections 1–5 verbatim as data rows incl. both splat attributions + „verändert (dezimiert/komprimiert)"), `public/assets/GoobyMusic/covers/` + `beats/` dirs (keep; coordinator art lands here). **(modify):** `package.json` (§E0.1-6: the 3 deps + `music-manifest`/`beats`/`fetch-itch` scripts — ONE commit, then frozen), `core/assets.js` (§B3 `AUDIO_PACK_ROOTS` frozen table + itch model-root routing for `itch/<pack>/<file>` keys), `test/assetBudget.test.js` (§E0.1-4: warn 280 MB / fail 1536 MB + per-dir sub-asserts: splats ≤ 33 MB, music ≤ 30 MB, itch ≤ 12 MB, covers ≤ 3 MB), `test/assets.test.js` (root-routing rows).
> **DO NOT TOUCH:** anything else under `src/` (audio/sfxMap is G51/G78 territory; no strings, no constants), `public/assets/stickers/` (coordinator), `ios/`.
> **Contracts exposed (report):** exact committed inventory per pack (later agents code against it); audio key format `'itch-sfx/<file>'`; model keys `'itch/<pack>/<name>'` (or your documented equivalent); splat file paths; credits.js row shape. **Verification specifics:** suite/lint/build green; `npx cap sync ios` green on Linux (proves the 2 plugin deps); CDP: one itch GLB renders, `getAudioUrl('itch-sfx/confirm_style_4_001')` fetches 200, one splat PLY fetches 200 (no viewer yet); ledger table ACTUAL vs §A2 in report; `node scripts/fetch-itch.mjs` re-run is a byte-stable no-op. No UI → no layout matrix. **Dependencies:** ART-GATE-1 need NOT block you (covers are manifest-side, G51). **Ports:** vite 5175 / CDP 9221.

## E3. WAVE 1b — foundations (launch G51–G60 in parallel after CP-W1a)

### V4/G51 — music registry + radio engine (slot B) — model: **fable**

> You are build agent V4/G51 for GOOBY 4.0. 4.0's headline is real music behind an in-game radio: a build-time manifest of auto-discovered tracks, a MediaElement-streaming radio player wired into the 5-bus audio graph, and pure queue logic. **Your mission:** PLAN4.md §B2 (ALL), §B5.3 (gen-beats script), §C-SYS1.1/1.2/1.7 exactly, + §E0.1-16/-17.
>
> **Read (after AGENTS.md):** PLAN4.md §B2.1–2.4, §B5.3, §C-SYS1.1–1.2, §C-SYS1.6–1.7, §A2 radio bullets, §E0.1-9/-16/-17; PLAN4-GAMES §G4.5 (setLoopGain consumer). Then `src/audio/audio.js` (fully), `src/audio/musicDirector.js` (suppression gate pattern), `src/core/store.js`, `public/assets/GoobyMusic/requests.md`, `test/audioV2.test.js`.
> **OWNS (create):** `scripts/gen-music-manifest.mjs` (§B2.2 — ffprobe duration + volumedetect gainTrim, deterministic, idempotent, graceful-empty), `scripts/gen-beats.mjs` (§B5.3 — spectral-flux onsets, 60–180 BPM autocorrelation, override precedence), `src/data/musicManifest.json` (committed output of a real run over G50's 14 files — covers referenced per ART-GATE-1), `public/assets/music/beats/Recap - Abenteuer.beats.override.json` (hand-measured, §C-SYS2.6), `src/systems/musicRegistry.js` (manifest → stations per §C-SYS1.2, Stinger exclusion), `src/audio/radioPlayer.js` (§B2.3 element chain, 300 ms fades, full API incl. `duck`/`now`/`getStats`), `src/systems/radioQueue.logic.js` (pure: station filter, seeded shuffle, skip, trim math, all-disabled fallback rule §C-SYS1.5), `test/musicRegistry.test.js` (§B2.2 assertions + Bordmusik ≥ 13 + station math + queue logic ≥ 25). **(modify):** `src/audio/audio.js` (radio wiring per §B2.3/§B2.4: lazy element, `createMediaElementSource` once, `radioGain` under bus.music, airtight mute extension, `setRadioActive` director gate, `getStats().radio`, `setLoopGain(id, gain01)` §E0.1-16), `src/audio/musicDirector.js` (the `setRadioActive` suppression gate only).
> **DO NOT TOUCH:** `sfxMap.js` (append-only if you truly need an id — §E0.1-9), radio UI files (G52), `core/save.js` (G53 — read `radio.*` slice via store only), recapEngine (G55).
> **Contracts exposed (report):** radioPlayer API JSDoc; manifest/beats file formats; `radioChanged` store event payload (§B10 — you emit it); how G52's panel should call start/skip/trim; how the recap (wave 2) gets its dedicated playback + `getTime()` clock. **Verification specifics:** suite/lint/build green; both scripts byte-stable on re-run; CDP with `?reset=1`: gesture-start radio → `getStats().radio` shows playing/station/gain; trim 50 % → gain halves; `settings.music=false` → element paused + zero nodes (60 s probe); track transition gap ≤ 400 ms (element event log); empty-GoobyMusic boot clean. **Ports:** vite 5176 / CDP 9222.

### V4/G52 — radio UI: radioPanel, now-playing, per-track settings, the radio-in-the-world (slot C) — model: **solfast**

> You are build agent V4/G52 for GOOBY 4.0. The radio must feel like a THING: a furniture radio in the living room, a panel with transport + stations, a now-playing chip, and per-track enable/trim rows. **Your mission:** PLAN4.md §C-SYS1.3/1.4/1.5/1.8 exactly (numbers + copy binding).
>
> **Read (after AGENTS.MD):** PLAN4.md §C-SYS1.3–1.8, §B2.3–2.4 (the APIs G51 exposes — code against them; same-wave: feature-detect per §E0.1-11), §C-SYS12.1 rows 4–5 (your surfaces are opened from G58's IA — expose screen/panel ids `radioPanel`, `trackSettings`), §E0.1-10/-15. Then `src/ui/ui.js` (panel registration), `src/ui/hud.js`, `src/data/furniture.js`, `src/home/decor.js` (furniture render path), an existing §E6 panel as template.
> **OWNS (create):** `src/ui/radioPanel.js` (§C-SYS1.3 layout verbatim; persists via `radio.*` store writes), `src/ui/nowPlaying.js` (§C-SYS1.8 chip: 288×56, 250 ms slide, 4 s auto-hide, minigame suppression, fixed-position), `src/ui/trackSettings.js` (§C-SYS1.5 rows grouped by station, 24-row virtualization ≥ 40 tracks, 5-s preview via radio chain), `src/data/strings/v4-radio.js` (your keys EN+DE). **(modify):** `data/furniture.js` (ONE appended `radio` row per §C-SYS1.4/§E0.1-15), `home/decor.js` or `roomManager.js` marked block (`tap:radio` → radioPanel, head-bob reaction, 0.5 Hz pulse + note particles while playing), `ui/hud.js` (ONE marked block: HUD radio chip visible while playing), `styles.css` append block.
> **DO NOT TOUCH:** `audio/*` (G51), `core/save.js` (G53 grants/places the furniture — you only append the catalog row), `settingsScreen.js` (G58 links to your ids).
> **Verification specifics:** suite/lint/build green. CDP: tap the placed radio → panel opens; transport/station/shuffle writes hit `radio.*` (store dumps); chip appears ≤ 500 ms on track start, hides at 4 s, replaced not stacked; trim slider row → `getStats().radio.gain` proof; all-disabled station toast fires. Layout matrix on radioPanel + trackSettings + chip (§E0.2 grid); fake-notch worst combo for the chip. If G51 is unmerged at your start, build against the documented §B2.3 API with a stub and re-verify before commit (§E0.1-11). **Ports:** vite 5177 / CDP 9223.

### V4/G53 — save v4 + codes engine + data spine (slot D) — model: **fable**

> You are build agent V4/G53 for GOOBY 4.0. Everything 4.0 persists lands here: save v4 with lossless migration, the codes engine, the one-time constants block, the strings spread, sticker #29, notification id 8. **Your mission:** PLAN4.md §B1 (ALL, verbatim), §B6, §B10, §C-SYS5 (ALL), + the §E0.1-7/-8/-14/-15/-19 spine duties. HARD PRECONDITION: `public/assets/stickers/herzGooby.png` exists (ART-GATE-1) — verify first; abort and report if not.
>
> **Read (after AGENTS.md):** PLAN4.md §B1 (schema/migration verbatim — your core spec), §B6, §B10, §C-SYS5.1–5.5, §C-SYS2.4 (baseline snapshot the migration takes — import G55's `recapEngine.snapshot` lazily with an inline fallback shape per §E0.1-11), §A2 save bullet, §E0.1-7/-8/-13/-14/-15; PLAN4-GAMES §G5.5 (minigames difficulty slices — exact shape), §G3.3 (settings.controls), §G6.6 (goobyWeltQuality). Then `src/core/save.js` (fully — migrations[2] is your template), `src/data/constants.js`, `src/data/strings.js` (v3 spread pattern), `src/data/stickers.js`, `src/systems/notifyRules.js`, `test/{save,saveV2,saveV3}.test.js`, `test/fixtures/`.
> **OWNS (create):** `src/systems/codesEngine.js` (§B6 pure: normalize/redeem/rate-limit), `src/data/codes.js` (2 launch rows), `src/data/strings/v4-core.js` + the 18 ownership-headed stubs (§E0.1-8), `test/saveV4.test.js` (§B1's test list: lossless v1→v4/v3→v4, radio-grant idempotence, recap baseline math at L1/4/5/23/40, hostile clamps, ≥ 100 new fuzz seeds over the six new slices), `test/codes.test.js` (§C-SYS5.5 ≥ 20). **(modify):** `core/save.js` (`v4SliceDefaults`, `migrations[3]`, validate() clamps — §B1 #1–5 verbatim incl. the ≤ now+24 h timestamp collapses and §G5.5/§G3.3/§G6.6 slices per §E0.1-14), `data/constants.js` (ONE `// V4/G53` block §E0.1-7), `data/stickers.js` (herzGooby append §C-SYS5.4), `data/minigames.js` (goobyWelt row §E0.1-19), `strings.js` (spread block), `systems/notifyRules.js` + its test (id 8 per §B10: body copy in v4-core, quiet-hours + cap 8, schedule at `modifiers.nextAt`), `test/stickers.test.js` (→ 29 files).
> **DO NOT TOUCH:** `systems/economy.js`/`modifierEngine` (G54), `albumScreen.js` (G59 renders the 29th slot), `ui/*` codes UI (G58), `recapEngine.js` (G55).
> **Contracts exposed (report):** every new slice + default (other agents read via store paths); `codesEngine.redeem` signature + who applies effects (§B6 — the UI caller); `codesChanged`/store events you emit; the exact migration-baseline behavior for G55/G64. **Verification specifics:** suite/lint/build green (notifyRules cap edit justified per §A2). CDP: inject committed v1 AND v3 fixtures → `v===4`, deep-diff lossless dumps, radio furniture granted-not-overwritten both cases, L23 fixture → `lastRecapLevel 20` + no instant recap flag; redeem both codes via console (engine-level) — single-use + lockout timing with pinned clock. **Ports:** vite 5178 / CDP 9224.

### V4/G54 — modifier engine + scheduler + economy v4 (slot E) — model: **fable**

> You are build agent V4/G54 for GOOBY 4.0. You own the two money-adjacent engines: the seeded modifier event scheduler and the v4 economy (stacking order, ledger, day caps, difficulty multipliers, beaten/highscore writes). **Your mission:** PLAN4.md §B4, §B11, §C-SYS4.1–4.4/4.7, §C-SYS11 (ALL) + §E0.1-2/-14 exactly.
>
> **Read (after AGENTS.md):** PLAN4.md §B4, §B11, §C-SYS4 (ALL — the type table + eligibility matrix are frozen consts in YOUR module), §C-SYS11.1–11.2, §E0.1-2 (the binding stacking ruling — implement it verbatim), §E0.1-14; PLAN4-GAMES §G5.2 (difficulty multipliers ×0.7/×1/×1.3 + endless flat 5), §G5.4 (targets table — your `difficultyTargets.js`), §G5.7-4 (beaten/bestByDiff/endlessBest single persistence site = you), §G8 (accessor contract: `modifiers.getActiveFor(gameId)` incl. the goobyWelt/trip null rule). Then `src/systems/economy.js` (fully), `src/core/timeEngine.js` (tick wiring style), `src/systems/{health,weather}*.js` (pure-engine tick pattern), `test/economy.test.js`.
> **OWNS (create):** `src/systems/modifierEngine.js` (§B4 pure: tick/consume/expire + `getActiveFor` accessor + frozen §C-SYS4.2/4.3 tables; `modifierChanged` event), `src/data/difficultyTargets.js` (§G5.4 rows verbatim), `test/modifierEngine.test.js` (§C-SYS4.7 ≥ 35 incl. 1000-roll cadence bounds + offline catch-up). **(modify):** `systems/economy.js` (§B11 + §E0.1-2: reasons `code|modifier|glueckspilz|endless`, `getLedger()` ring buffer 50, `awardMinigame(…, {difficulty, modifier})` stacking + doppelGold surplus + `dayCoins`/endless ≤ 100 c day caps + `beaten`/`bestByDiff`/`endlessBest` writes vs `difficultyTargets`, `reward.modifierBonus` return), `core/timeEngine.js` (ONE marked block: 1 s modifier tick), `test/economy.test.js` (§C-SYS11.2 v4 sim — 4 assertions verbatim + reason-whitelist assertion; existing sims untouched).
> **DO NOT TOUCH:** `framework.js` (G56 calls your consume/accessor — publish signatures), `constants.js` (G53 lands `MODIFIER.DAY_COIN_CAP` — read it; if unmerged at your start, code against §B10's value and verify at commit), UI files, `notifyRules.js` (G53 schedules id 8 off `modifiers.nextAt`).
> **Contracts exposed (report):** `modifierEngine.tick/consume/getActiveFor` JSDoc; the awardMinigame options object; ledger row shape; exactly how wave-2/3 agents pass `difficulty`/read `params.modifier`. **Verification specifics:** suite/lint/build green. Pinned-clock CDP run: force `nextAt=now` via console → event rolls (eligibility respected at level 5 vs 40), 2 plays consume, expiry at +45 min, reschedule ∈ [50,120] min — full cycle JSON log to `/tmp/gooby-v4-g54/`; economy: scripted doppelGold round at rowMax → paid = 2×rowMax, surplus booked, 150 c day cap crossover pays base + note flag. **Ports:** vite 5179 / CDP 9225.

### V4/G55 — recap engine (pure) + beat grid + trigger plumbing (slot F) — model: **fable**

> You are build agent V4/G55 for GOOBY 4.0. The recap cinematic's brain: baseline snapshots, delta stats, milestone math, beat-grid math, pending-level plumbing — all pure, all node-tested; the wave-2 scene consumes you. **Your mission:** PLAN4.md §B5.1–5.2, §C-SYS2.1 (trigger/queue rules), §C-SYS2.4–2.6 (snapshot shape, stat catalog, line selection, beat-grid cue rules — the DATA of §C-SYS2.6, the scene renders it), §C-SYS2.9 tests, exactly.
>
> **Read (after AGENTS.md):** those sections + §B1 #3 (migration init — G53 implements it calling YOUR `snapshot`; publish it early), §B10 (`recapChanged` event), §E0.1-11/-17 (beats formats are G51's — consume committed files/format only). Then `src/systems/profileStats.js` + `achievementsEngine.js` (counter shapes you snapshot), `src/core/store.js`, `src/main.js` (marked-block anchors), `src/systems/leveling.js` (level change flow).
> **OWNS (create):** `src/systems/recapEngine.js` (`snapshot/diff/selectLines/milestoneCrossed/beatGrid` per §B5.1 — §C-SYS2.4's 18-line catalog + weights as frozen consts; beatGrid handles override precedence + default grid), `test/recapEngine.test.js` (§C-SYS2.9 ≥ 30). **(modify):** `src/main.js` (ONE marked block: level-change listener → `milestoneCrossed` → `recap.pendingLevel` write + `recapChanged` emit; plays-on-next-home-enter hook left as a documented callback the wave-2 scene registers).
> **DO NOT TOUCH:** `core/save.js` (G53), `home/recapScene.js`/`ui/recapOverlay.js` (wave 2 — publish your API for them), `radioPlayer` (G51).
> **Contracts exposed (report):** every function signature + the exact `{barSec, cues[]}` shape and §C-SYS2.6 cue rules the scene must obey; the pendingLevel handshake (who clears it, §B5.2's atomic update). **Verification specifics:** suite/lint/build green; node-level determinism proofs (same seed → same lines); CDP: `?level=4` → console `applyXp` to L5 → `recap.pendingLevel===5` persisted across reload; multi-jump L4→L11 queues 5 per §B5.1. **Ports:** vite 5180 / CDP 9226.

### V4/G56 — framework 2.0: async lifecycle, difficulty/endless, modifier consume, sick gate, invert proxy, XP floaters (slot G) — model: **fable**

> You are build agent V4/G56 for GOOBY 4.0. The minigame framework grows up: awaited init/dispose (splat prerequisite), difficulty/endless launch plumbing, modifier play consumption, the sick shop-trip gate, the input-invert proxy, and XP transparency's floaters. **Your mission:** PLAN4-GAMES §G6.6 (async hardening), §G5.7 (ALL), §G3.3 (proxy mechanism — mechanism only, toggles UI is G58's); PLAN4.md §C-SYS7.1 (gate line), §C-SYS3.1/3.3 (floaters + nextUnlock), §C-SYS4.4 (consume/refund + results chip hook) + §E0.1-13.
>
> **Read (after AGENTS.md):** those sections + §E0.1-2 (stacking — you FORWARD difficulty/modifier to G54's awardMinigame, never compute coins), §E0.1-11; PLAN4-GAMES §G5.5 (endless lock rule), §G5.6 (the launch contract mgPregame will call — publish it). Then `src/minigames/framework.js` (fully), `src/core/sceneManager.js`, `src/core/input.js` (payload shapes for the proxy), `src/systems/leveling.js`, `src/ui/hud.js`, the 12 §C-SYS3.1 call sites.
> **OWNS (create):** `src/core/inputInvert.js` (pure `invertPayload(event, p, {x,y})` + the wrap helper; tap/pick pass-through), `src/data/strings/v4-difficulty.js` (mode names, target/lock/endless-row keys — G68 consumes). **(modify):** `minigames/framework.js` (await init/dispose; `launch(id, {difficulty})` validation incl. endless lock; `ctx.params.difficulty/modifier`; modifier consume-on-launch + ≤ 1 refund-on-early-quit via G54's API; sick gate → block only when `mode !== 'vetTrip' && mode !== 'shopTrip'` §C-SYS7.1; endless elapsed-up time + results endless-best row + `newBest` badge; invert proxy applied when `controls.invertible !== false` ∧ flag), `core/sceneManager.js` (`switchTo` awaits Promise-returning dispose), `systems/leveling.js` (`applyXp(amount, source)` + `xpGranted` emit §E0.1-13 + `nextUnlock(level)` §C-SYS3.3), the 11 marked one-liner source tags outside economy.js (§E0.1-13 — G54 tags its own site), `ui/hud.js` (ONE marked block: floater renderer — queue 3, coalesce, 900 ms), `dev/harness.js` (ONE block: `?difficulty=`, `?invertx/?inverty`), level-up toast preview line (`· Nächstes: {name} (L{n})`).
> **DO NOT TOUCH:** `economy.js`/`modifierEngine.js` (G54), `carController.js` (G57 — it takes `invertSteer` as a param; publish where you read the flag), settings UI (G58), any game file.
> **Contracts exposed (report):** the launch params contract for mgPregame; the async lifecycle contract for goobyWelt (init may return a Promise; dispose awaited); invert proxy transform table; `xpGranted` payload; `nextUnlock` signature. **Verification specifics:** suite/lint/build green; static-analysis test for the 12 source tags (§C-SYS3.1); CDP: launch a game with `?difficulty=hard` → `ctx.params` dump; endless locked pre-beaten (console-write `beaten` → unlocks at L10+); sick fixture: shop drive + surf launch, arcade blocked with `toast.tooSick`; `?invertx=1` surf swipe left → lane+1; floaters at feed/wash/minigame-end (screenshots); a stub async game (temp, reverted) proves awaited dispose ordering. **Ports:** vite 5181 / CDP 9227.

### V4/G57 — controls flips: carController contract, harborHopper, invertible exports, contract tests (slot H) — model: **fable**

> You are build agent V4/G57 for GOOBY 4.0. The owner reported mirrored steering „beim Fahren und beim Surf"; plan B's audit (§G2.3) confirms exactly 4 flipped surfaces via 3 root causes — you fix 2 of the 3 (carController + harborHopper; shoppingSurf's WX flip belongs to wave-2 G67 who owns that file) and land the 27-game `controls.invertible` exports + regression tests. **Your mission:** PLAN4-GAMES §G3.1-a/-c, §G3.2, §G2.1 (the standard — your JSDoc cites it) exactly.
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G2 (ALL — audit table + standard), §G3.1/§G3.2, §G3.3 (per-game invertible values list — you land the exports; the proxy is G56's), §G10-1 (CDP direction probe spec — your evidence format). Then `src/city/carController.js` + `carFeel.js` (fully), `src/city/cityDrive.js` + deliveryRush autopilot call sites, `src/minigames/games/harborHopper.js` (input handler), every game module's export tail (for the one-liners), `test/` carFeel/cityRoads suites.
> **OWNS (modify):** `city/carController.js` (§G3.1-a: `setSteer(v>0 = screen-right)` contract redefinition — single negation, JSDoc the contract, `invertSteer` option for G56's flag), the two autopilot call-site negations (cityDrive trip autopilot, deliveryRush bot — marked one-liners), `games/harborHopper.js` (§G3.1-c one-line input mirror + §G2.1-rule-1 comment block), ALL 27 games' one-line `controls.invertible` exports (§E0.1-18; values per §G3.3), `test/controlsContract.test.js` (§G3.2: all-27 declaration assert + surf LANE_X monotonicity + carFeel sign contract), new carController heading-integration tests (`steer=+1 1 s ⇒ heading<0`; autopilot 4-corner convergence).
> **DO NOT TOUCH:** `shoppingSurf.js` (G67 wave 2 — note the dependency in your report), game logic files beyond the export line, `framework.js` (G56), trip reward/energy/tow logic (§C7.3-v3 invariants must stay bit-identical — your tests prove it).
> **Verification specifics:** suite/lint/build green (existing carController tests edited ONLY per the sign contract, justified). CDP direction probes per §G10-1 for cityDrive (trip + arcade), deliveryRush, harborHopper: scripted swipe/zone-press LEFT → avatar projected screen-x decreases — before/after evidence JSON + screenshots to `/tmp/gooby-v4-g57/` (these are the PR evidence §G3.1 demands); a full shop trip + vet trip + deliveryRush round with rewards/energy/tow identical to v3 numbers. **Ports:** vite 5182 / CDP 9228.

### V4/G58 — dev panel 2.0 + settings IA + codes/controls/gyro toggle UIs (slot I) — model: **fable**

> You are build agent V4/G58 for GOOBY 4.0. The dev panel becomes „vollwertig" (cards 13–18 + economy ledger) and settings get their two-level IA with subscreens, the codes screen, and the new toggles. **Your mission:** PLAN4.md §C-SYS6 (ALL — card contents exact), §B9, §C-SYS12.1–12.3, §C-SYS5.1 (codes surface), §C-SYS8.1–8.2 (gyro toggle + permission flow — calling G60's module), PLAN4-GAMES §G3.3 (Steuerung group) exactly.
>
> **Read (after AGENTS.md):** those sections + §E0.1-8/-11 (your 4 strings modules; feature-detect for cards 15/17 + Credits row); PLAN4.md §C-SYS1.5 (you LINK to G52's trackSettings — don't build it). Then `src/ui/devPanel.js` (fully — 12 cards), `src/ui/settingsScreen.js` (fully), `src/ui/ui.js` (screen stack), `src/systems/economy.js` getLedger (G54 — feature-detect), `src/dev/harness.js`.
> **OWNS (create):** `src/ui/codesScreen.js` (§C-SYS5.1: input normalize-on-submit via codesEngine, shake/toasts/lock countdown, redeemed list; effects applied per §B6 through economy/stickerBook/store), `src/data/harnessParams.js` (§C-SYS6 card 18's single-source table — G82 regenerates AGENTS.md from it), `src/data/strings/v4-{codes,settings,dev,controls}.js`. **(modify):** `ui/settingsScreen.js` (§C-SYS12.1's 8-row main list + display/audio subscreens + one-time hint chip §C-SYS12.2; Steuerung toggles §G3.3; gyro toggle with in-gesture permission flow §C-SYS8.2 via lazy `parallax.js` import), `ui/devPanel.js` (ledger expander + cards 13–18 per the §C-SYS6 table; 14/16 drive G54/G51's real engines — no parallel paths; 15/17 feature-detect until wave 2), `ui/hud.js` (ONE marked block: ×2-coins buff chip `×2 💰 mm:ss` §C-SYS5.2), `styles.css` append block.
> **DO NOT TOUCH:** `codesEngine.js`/`save.js` (G53), `economy.js` (G54), `radioPanel/trackSettings` (G52), `parallax.js` (G60).
> **Verification specifics:** suite/lint/build green. CDP: full IA walk (every v3 setting reachable ≤ 2 taps; 320×568@130 % main list unscrolled); codes: wrong-code shake + rate-limit lock live, `UpdateLiebe` → HUD chip countdown survives reload, `IchLIE3BDich` → sticker toast + book „+💗"; every new dev card exercised (ledger rows after a payout, modifier force/clear, radio readout, cheat-sheet copy buttons); gyro toggle desktop → pointer fallback enabled note. Layout matrix on settings main + all subscreens + codesScreen + devPanel. **Ports:** vite 5183 / CDP 9229.

### V4/G59 — gallery: IndexedDB photo store, Fotos tab, secret sticker slot, export (slot J) — model: **fable**

> You are build agent V4/G59 for GOOBY 4.0. Photos finally persist: an exception-safe IndexedDB store (cap 40), a third album tab with viewer + share/save/delete, native export via the two new Capacitor plugins, discoverability hooks — plus the sticker book's 29th „Geheim" slot (you own albumScreen). **Your mission:** PLAN4.md §B7, §C-SYS9 (ALL), §C-SYS5.4 (book render half) exactly.
>
> **Read (after AGENTS.md):** those sections + §E0.1-6 (deps already in package.json — guarded dynamic import per the haptics pattern), §B1 gallery slice (G53's — store mirror only). Then `src/ui/albumScreen.js` (fully), `src/ui/photoMode.js` (share/download chain you extract), `src/core/notifications.js` (guarded-adapter pattern), `src/ui/hud.js`, `src/ui/profileScreen.js`.
> **OWNS (create):** `src/core/photoStore.js` (§B7 verbatim: guarded, promise-based, cap-40 eviction, quota retry-once), `src/systems/gallery.logic.js` (pure LRU/cap/badge decisions), `src/ui/shareImage.js` (extracted shared web path + native Filesystem→Share path §C-SYS9.4, failure toast), `test/gallery.test.js` (§C-SYS9.5 ≥ 15), `src/data/strings/v4-gallery.js`. **(modify):** `ui/albumScreen.js` (third tab „Fotos" per §C-SYS9.2: 3-col grid, objectURL lifecycle, viewer with swipe/share/delete/confirm, empty state; PLUS the §C-SYS5.4 secret slot on page 5 — „?"-heart silhouette, „Geheim", hint line, header „n/28 +💗"), `ui/photoMode.js` (marked block: auto-save to store + „Im Album ansehen" link + first-photo hint toast), `ui/hud.js` (ONE marked block: album badge dot logic vs session-seen stamp), `ui/profileScreen.js` (marked block: „Galerie ({n} Fotos)" row under sticker progress).
> **DO NOT TOUCH:** `data/stickers.js`/`save.js` (G53), `photoStore` consumers elsewhere, `package.json` (G50).
> **Verification specifics:** suite/lint/build green; web boot with plugins absent stays clean (guard proof). CDP: capture 3 photos → grid newest-first + count header; 41st photo evicts oldest (scripted loop); viewer swipe/delete confirm; share falls back to download on desktop (toast); badge dot appears then clears on visit; secret slot renders locked, unlocks via console `stickerHook` path. Layout matrix on album (all 3 tabs) + viewer. **Ports:** vite 5184 / CDP 9230.

### V4/G60 — gyro parallax (slot K) — model: **solfast**

> You are build agent V4/G60 for GOOBY 4.0. Optional gyro parallax in the home rooms: EMA-neutral tilt mapping, iOS permission flow surface, pointer fallback, FPS guard — default OFF, zero cost while off. **Your mission:** PLAN4.md §B8 + §C-SYS8 (ALL) exactly.
>
> **Read (after AGENTS.md):** PLAN4.md §B8, §C-SYS8.1–8.4, §B1 (`settings.gyro` — G53's slice, read-only for you), §E0.1-11. Then `src/home/homeScene.js` (camera update path), `src/core/input.js` (pointer source for the fallback), an existing engine-module test for style.
> **OWNS (create):** `src/home/parallax.js` (frozen consts §C-SYS8.3; `parallaxOffset(beta,gamma)` pure; permission-request API `requestEnable()` G58's toggle calls §C-SYS8.2; pointer fallback through the SAME clamps at ±0.06 m; 5 s FPS guard suspend<25/resume≥35; full listener detach while off), `test/gyro.test.js` (mapping/deadzone/clamp/EMA/hysteresis pure tests). **(modify):** `home/homeScene.js` (ONE marked block: offset lerp τ=150 ms into camera position, forced-zero during care walk-tos/photo mode/overlays).
> **DO NOT TOUCH:** `settingsScreen.js` (G58 owns the toggle — publish `requestEnable`'s contract), `save.js` (G53).
> **Verification specifics:** suite/lint/build green. CDP: enable via console → synthetic `deviceorientation` events move the camera within clamps (position dumps at ±30° — deadzone/clamp verified numerically); pointer fallback on desktop; overlay open → offset eases to 0; `settings.gyro=false` → zero listeners (getEventListeners probe). No new UI beyond none → no matrix (G58 covers the toggle row). **Ports:** vite 5185 / CDP 9231.

## E4. WAVE 2 — flagship teams + wave-1-consumer UX (launch G61–G70 in parallel; wave 1 merged, pushed, CI green, ART-GATE-2 done)

### V4/G61 — Team CAKE: purblePlace.logic.js belt-sim rework + bot + difficulty (slot A) — model: **fable**

> You are build agent V4/G61 for GOOBY 4.0. Purble Place becomes authentic „Comfy Cakes": the PLAYER drives the belt, drops are physical projectiles, the oven is a belt-skill zone. You own the pure simulation + bot + tests; G62 (same team, concurrent) owns the scene/DOM — code ONLY against the §G1 contracts. **Your mission:** PLAN4-GAMES §G1.3–§G1.6, §G1.8, §G1.9 (ALL) exactly, incl. `applyDifficulty` per §G1.6/§E0.1-14 and the §G5.4 endless row (3 rejected/expired end it, interval floor 10 s).
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G1 (ALL — incl. G1.1 research + G1.2 delta so you keep ticket generator/match matrix/patience/interval VERBATIM), §G5.2–§G5.4 (purble rows), §G2.1 (button games are §G2-safe by construction); PLAN4.md §E0.1-2 (coins stay `5/5/30` — difficulty mult is economy-side). Then `src/minigames/games/purblePlace.logic.js` + `test/purblePlace.test.js` (fully — the surviving assertions listed in §G1.9 keep their names), `games/carrotCatch.logic.js` (convention).
> **OWNS:** `games/purblePlace.logic.js` (rewrite: `createLine/stepLine` + §G1.9 helpers + §G1.5 station table + §G1.6 pacing + `applyDifficulty` + endless), `test/purblePlace.test.js` (§G1.9 test list; parity assertions preserved). **DO NOT TOUCH:** `purblePlace.js` (G62), `economy.js`, framework.
> **Contracts exposed (report):** the exact `input` shape + events[] vocabulary G62 renders; the bot's public entry for `?autoplay=1`. **Verification specifics:** suite/lint/build green; bot ≥ 90 avg over 20 seeded Mittel runs AND ≥ 120 on ≥ 1 of 5 Schwer runs (§G1.9 — table in report); catch-window edge/fall-lead/oven-resume/disallowed-matrix tests all present; determinism (same seed+input script → same events). Logic-only agent: coordinate with G62's live runs for CDP; attach node-level evidence. **Ports:** vite 5175 / CDP 9221.

### V4/G62 — Team CAKE: purblePlace scene — pedals, station dock, overview strip, dressing (slot B) — model: **fable**

> You are build agent V4/G62 for GOOBY 4.0. The Comfy-Cakes scene: side-view camera with follow window, ◀/▶ pedals, projected station dock, belt overview strip, Tiny-Treats bakery dressing, Gooby baker cameo. **Your mission:** PLAN4-GAMES §G1.4, §G1.5 (render/UI side), §G1.7 (ALL — big-button layout binding) exactly, driving G61's logic (same team, concurrent — build against the §G1.9 `stepLine` contract, integrate before commit).
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G1 (ALL), §G10 rows 1–3/6 (your acceptance); PLAN4.md §C-SYS1.9.2 rows 30–32 (cake sfx flip lands wave 3 — call existing ids). Then `games/purblePlace.js` (fully), `home/decor.js` (prop patterns), G50's itch inventory (tiny-treats keys).
> **OWNS:** `games/purblePlace.js` (rewrite), `strings/v4-cake.js`, `styles.css` append block (pedals/dock/strip). **DO NOT TOUCH:** `purblePlace.logic.js`/its test (G61), `framework.js`, `sfxMap.js` beyond an append-only block (§E0.1-9).
> **Verification specifics:** suite/lint/build green. CDP: full manual-scripted round (spawn→batter→oven-stop→green bake→icing→deko→candles→ship) with screenshots; pedals drive belt both ways incl. trash-off-left; mistimed press splats (−2), icing-on-raw buzzes (0); overview strip dots/red-oven-pulse; camera follow clamps ±1.4; ≤ 250 draw calls at 3 pans + dressing (`renderer.info`); 5 `?autoplay=1` runs via G61's bot with payouts in `5/5/30`; §G1.7 layout matrix incl. < 360 px pedal inset + 130 % no-overlap proof. **Ports:** vite 5176 / CDP 9222.

### V4/G63 — Team RECAP: recapScene 3D — 8 biome vignettes + dollies + Gooby spline (slot C) — model: **fable**

> You are build agent V4/G63 for GOOBY 4.0. The recap cinematic's stage: a full-screen §E1 scene with 8 kit-dressed biome vignettes, camera dollies, AI backdrop planes, and the player's OWN Gooby walking a spline through each. G64 (same team, concurrent) owns the DOM overlay/beat choreography — you expose a scene API it drives. **Your mission:** PLAN4.md §B5.4 + §C-SYS2.3 (vignette table binding) + §C-SYS2.1's entry/exit framing exactly.
>
> **Read (after AGENTS.md):** PLAN4.md §B5.4, §C-SYS2.1–2.3, §C-SYS2.6 (cut-on-even-bar timing — G64 CALLS your `showVignette(i)`/`setDollyT`; keep the scene time-driven from outside), §E0.1-11. Then `src/core/sceneManager.js`, `src/home/homeScene.js` (scene shape), `src/character/gooby.js` + `goobyAnims.js` + `outfitAttach.js` (wardrobe continuity), kit inventories (nature/kaykit-city/watercraft/space/halloween/restaurant + G50's tiny-treats, toy-car, furniture), `gfx/sky.js`.
> **OWNS:** `src/home/recapScene.js` (8 vignette groups, ONE visible at a time, ≤ 250 draw calls each; backdrop planes from `public/assets/recap/bg-<1..8>.png` — ART-GATE-2 files, verify present, fallback tinted gradient if a file is missing + report; dolly paths per §C-SYS2.3; Gooby CLIP walk on spline; enter/exit fades §C-SYS2.1). **DO NOT TOUCH:** `recapOverlay.js` (G64), `recapEngine.js` (G55), `radioPlayer` (G51 — G64 owns the audio handshake).
> **Contracts exposed (report):** scene API for G64 (`enter(params)`, `showVignette(i)`, `progress(t)`, `end()`) + per-vignette draw-call table. **Verification specifics:** suite/lint/build green. CDP via dev card 15 / `?scene=recap` harness route (add ONE marked harness line if absent): step through all 8 vignettes — screenshot each (equipped outfit visible), `renderer.info` per vignette ≤ 250, dispose returns memory to baseline (3 enter/exit cycles). **Ports:** vite 5177 / CDP 9223.

### V4/G64 — Team RECAP: overlay — beat-synced text, skip, end card, replay, beat-debug (slot D) — model: **fable**

> You are build agent V4/G64 for GOOBY 4.0. The recap's choreography: the beat clock, text pops on downbeats, vignette cuts on even bars, the skip affordance, the end card, profile replay, and the ±80 ms debug overlay. **Your mission:** PLAN4.md §C-SYS2.2, §C-SYS2.5–2.8 exactly, wiring G55's engine + G63's scene + G51's radio ducking.
>
> **Read (after AGENTS.md):** PLAN4.md §C-SYS2 (ALL), §B5.1–5.3 (engine/beats contracts), §B2.4 (duck/resume), §C-SYS6 card 15 (the beat-debug overlay YOU render; G58's card toggles it), §E0.1-11. Then G55's/G63's/G51's report contracts, `src/ui/profileScreen.js`, `src/gfx/particles.js` (confetti), `src/ui/ui.js`.
> **OWNS:** `src/ui/recapOverlay.js` (track pick §C-SYS2.6 order, `radioPlayer` dedicated playback + duck, element-clock re-anchor per bar, wall-clock fallback in no-audio contexts, cue scheduling per §C-SYS2.6 rules, skip per §C-SYS2.2, end card §C-SYS2.7 incl. `nextUnlock` line, history/baseline atomic write per §B5.2, beat-debug overlay), `strings/v4-recap.js` (§C-SYS2.4 line templates verbatim), `styles.css` append block. **(modify):** `ui/profileScreen.js` (ONE marked block: „Rückblicke" row §C-SYS2.8). **DO NOT TOUCH:** `recapScene.js` (G63), `recapEngine.js` (G55), `main.js` (G55's listener already queues pendingLevel — you register the home-enter playback hook it documented).
> **Verification specifics:** suite/lint/build green. CDP: forced recap at L5 (dev card 15 path or console) — full 100 s run on the fallback track: beat-debug overlay screenshots showing text-pop offsets ≤ ±80 ms and cuts on even bars (the §A2 evidence — save the offset log JSON); skip appears at t=10, cuts to ≥ 3 s end card; migrated-L23 fixture shows NO recap until L25; replay from profile uses STORED stats; multi-jump L4→L11 recaps 5 then 10; radio ducked + resumed (`getStats()` before/during/after). Layout matrix on overlay text + end card. **Ports:** vite 5178 / CDP 9224.

### V4/G65 — Team WELT: splat viewer integration, loading UX, quality toggle, lifecycle (slot E) — model: **fable**

> You are build agent V4/G65 for GOOBY 4.0. „Gooby Welt" renders REAL photogrammetry worlds via `@mkkellogg/gaussian-splats-3d` inside a normal minigame scene — the riskiest perf surface of 4.0. You own the scene/viewer half; G66 (same team, concurrent) owns logic/paths/bot. **Your mission:** PLAN4-GAMES §G6.1–§G6.3 (scene side), §G6.6 (ALL — every guard binding) exactly.
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G6 (ALL), the two feasibility reports it cites (`/workspace/asset-staging/splats/REPORT.md`, `/opt/cursor/artifacts/gooby_welt_feasibility_report.md` — the DropInViewer options are VERBATIM from there); PLAN4.md §E0.1-6 (dep committed by G50). Then `framework.js` (G56's awaited lifecycle — your prerequisite, landed wave 1), `core/sceneManager.js`, `games/toyRacer.js` (chase-cam pattern), G66's paths contract in §G6.5.
> **OWNS:** `games/goobyWelt.js` (viewer init with the §G6.6 option block, per-scene orientation quaternion from paths data, pixel-ratio save/restore, loading card, pause→`splats.visible`, async dispose with `await splats.dispose()`, context-loss clean exit, low-poly fallback stage, quality toggle consumption `settings.goobyWeltQuality`, Gooby float rig + camera tangent frame §G6.3, star/carrot/fotoSpot render + flash vignette). **DO NOT TOUCH:** `goobyWelt.logic.js`/`paths.js`/test (G66), `framework.js`, `mgPregame` (G68 renders your quality toggle via a documented param — publish it).
> **Verification specifics:** suite/lint/build green. CDP (SwiftShader — expect slow loads, that's fine): BOTH scenes load + full run each; 10 enter/exit cycles → `renderer.info.memory` + JS heap return to baseline (the §G6.6/§G10-3 gate — log table); fallback stage by renaming a PLY temporarily (restore after); pause/resume suppresses sort; pixel ratio restored after dispose; draw calls ≤ 120 + viewer. 5 `?autoplay=1` runs (G66's bot) with payouts in the §E0.1-7 row (divisor 6, min 4, max 20), energy 8, unlock L12 honored. **Ports:** vite 5179 / CDP 9225.

### V4/G66 — Team WELT: game design — logic, path authoring, pickups, bot (slot F) — model: **fable**

> You are build agent V4/G66 for GOOBY 4.0. Gooby Welt's soul: authored spline paths through both splat scenes, corridor clamps, 28 stars + 6 carrots + 3 foto-spots per scene, chill scoring, a deterministic bot. **Your mission:** PLAN4-GAMES §G6.3 (movement numbers), §G6.4, §G6.5 (authoring methodology — follow it literally), §G6.7 exactly.
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G6 (ALL); PLAN4.md §E0.1-7 (coin row landed by G53). Then G65's scene contract (same team — the flycam harness route is yours, his viewer renders it), `games/carrotCatch.logic.js` convention, `dev/harness.js`.
> **OWNS:** `games/goobyWelt.logic.js` (Catmull-Rom + arc-length table, offset/corridor clamps, sphere pickups, scoring 28·2+6·5+3·10+10=126 max, 110 s timer), `games/goobyWelt.paths.js` (pure data both scenes: waypoints, corridor half-widths, pickup lists, orientation quaternion, ambient tint — authored via the §G6.5 flycam dumps), `test/goobyWelt.test.js` (§G6.5-3 validation rules + logic tests + bot floor), `strings/v4-welt.js`, `dev/harness.js` ONE marked block (`?scene=<id>&flycam=1`, `P` pose dump). **DO NOT TOUCH:** `goobyWelt.js` (G65), `data/minigames.js` (G53 landed the row).
> **Verification specifics:** suite/lint/build green; paths pass §G6.5-3 (spline 165–185 m, corridor ≥ 1.2 m, pickups reachable, star spacing ≥ 2.5 m, foto-spots ≥ 25 m apart — tests); bot collects ≥ 60 % stars, score ≥ 45, deterministic across 5 seeds (table); 6 fixed-t screenshot pass per scene over CDP (with G65's viewer); drag right moves Gooby screen-right (§G2-by-construction probe). **Ports:** vite 5180 / CDP 9226.

### V4/G67 — surf juice + §G3.1-b flip + runner-class rollout (slot G) — model: **fable**

> You are build agent V4/G67 for GOOBY 4.0. Shopping Surf must FEEL its 8→16 m/s: FOV kick, speed streaks, top-speed shake, ground scroll, wind loop, near-miss slow-mo, milestone banners — plus the §G3.1-b mirror fix (render-boundary WX helper), and the reduced-dose rollout to runner/toyRacer/harborHopper. **Your mission:** PLAN4-GAMES §G4 (ALL — every number binding), §G3.1-b exactly. Visuals are render-only: logic modules and their 1226-era tests stay untouched.
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G4.1–4.8, §G3.1-b, §G2.3 (surf row), §G10-1 (direction probe evidence); PLAN4.md §E0.1-16 (`audio.setLoopGain` — landed by G51). Then `games/shoppingSurf.js` (fully) + `.logic.js` (read-only), `games/{runner,toyRacer,harborHopper}.js` (render sites only), `gfx/particles.js`, G50's vfx inventory (`assets/vfx/streak_*.png`).
> **OWNS (modify):** `games/shoppingSurf.js` (WX mirror at ALL render sites per §G3.1-b incl. NPC 180° flip; §G4.1–4.7 juice), `games/runner.js`/`toyRacer.js`/`harborHopper.js` (§G4.8 marked juice blocks only), `sfxMap.js` append block (`ambience.windRun` §G4.5), `strings/v4-surf.js` (§G4.7 banners), `styles.css` append (vignette flash). **DO NOT TOUCH:** any `.logic.js`, `carController` (G57 done), cityDrive/deliveryRush (§G4.8 excludes them).
> **Verification specifics:** suite/lint/build green (zero logic-test edits — prove via git diff). CDP: §G10-1 direction probe — swipe left moves surfer screen-LEFT (before/after evidence, the owner-visible fix); FOV telemetry 62→72 over the ramp + turbo additive cap 78; streak spawn rates at 10/12/16 m/s (pool counter dump); near-miss slow-mo 0.55×0.18 s never stacking; `getStats()` wind-gain curve table; draw-call delta ≤ 30 (§G4 perf gate, `renderer.info` before/after); 5 autoplay runs payouts unchanged in `40/5/34`. Banner strings both languages. **Ports:** vite 5181 / CDP 9227.

### V4/G68 — pre-game screen + 2-col cover grid + modifier banner/glow hookup (slot H) — model: **fable**

> You are build agent V4/G68 for GOOBY 4.0. Arcade tiles become cover cards (2-col, 4:3 covers with icon fallback) and every tap opens the new pre-game screen: difficulty pills, target/lock lines, modifier banner, play button. **Your mission:** PLAN4-GAMES §G5.6, §G7.2–§G7.4 (ALL) exactly. Covers ship LATER (ART-GATE-3/G83) — your fallback path is a day-one requirement, not an edge case.
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G5.5–§G5.6, §G7 (ALL), §G8-1/-2 (accessor-driven banner/glow — G54's `getActiveFor`); PLAN4.md §C-SYS4.5 (the glow spec — the canvas COMPONENT is wave-3 G76's; you render a simple box-shadow pulse placeholder per §G7.2 and mount G76's component when it lands — leave a marked mount point), §E0.1-14 (targets data). Then `ui/arcadeScreen.js` (fully), `framework.js` launch contract (G56's report), `ui/ui.js` (stacked screens — vetPanel pattern), G65/G66 quality-toggle contract.
> **OWNS:** `src/ui/mgPregame.js` (§G5.6 layout verbatim: cover card, info row, 4 pills incl. Endlos lock „🔒 Schlage Schwer (Ziel N) · ab L10", per-mode lines, modifier banner, goobyWelt quality toggle + per-scene highscore chips + scene select, Spielen → `framework.launch(id,{difficulty})`), `strings/v4-arcade.js`. **(modify):** `ui/arcadeScreen.js` (§G7.2: 2-col always, cover cards + onerror icon fallback, lock/NEU/special-ribbon overlays, `g48-flagship` span-2 removal, ∞ best row, tap → mgPregame), `styles.css` append. **DO NOT TOUCH:** `framework.js`/`economy.js`, `modifierGlow.js` (G76, wave 3), covers PNGs (coordinator/G83).
> **Verification specifics:** suite/lint/build green. CDP: grid at 320/393/430 px — computed tile sizes ≈ §G7.2's table, min cover height 88 px at 130 %; tap → pregame → launch each of the 4 modes on 2 games (params dump); endless lock states (pre/post `beaten.hard`+L10); goobyWelt SPECIAL ribbon + gold-dashed border; fallback tiles for ALL games (no covers exist yet — screenshot the full grid); trips/tutorial still bypass pregame. Full layout matrix on arcade + pregame (`?lang=de` long-string stress). **Ports:** vite 5182 / CDP 9228.

### V4/G69 — XP info sheet + level-up unlock preview (slot I) — model: **solfast**

> You are build agent V4/G69 for GOOBY 4.0. XP transparency's reading surface: the „Wie levle ich?" sheet with all 12 live-numbered sources, and the next-unlock preview line in the level-up toast + sheet. **Your mission:** PLAN4.md §C-SYS3.2–3.3 exactly (G56 already landed floaters, `applyXp` sources, and `nextUnlock` — you consume).
>
> **Read (after AGENTS.md):** PLAN4.md §C-SYS3 (ALL), §E0.1-13; G56's report (`nextUnlock` signature, toast preview status — if G56 already appended the toast line, verify instead of re-adding). Then `ui/profileScreen.js`, `ui/hud.js` (level-ring tap target), the constants each row quotes (`XP.*`, `LEVELING.*`, `QUEST_POOL`, `PHOTO.*`, `NOUGAT.XP`).
> **OWNS:** `src/ui/xpInfo.js` (§E6 panel: XP bar, 12-source table with LIVE constant reads + daily-cap counters, footnote, „Nächste Freischaltung" via `nextUnlock`), `strings/v4-xp.js`. **(modify):** `ui/hud.js` (ONE marked block: level-ring tap → xpInfo), `ui/profileScreen.js` (marked block: „Wie levle ich?" row). **DO NOT TOUCH:** `systems/leveling.js` (G56), toast internals beyond the preview line ownership per G56's report.
> **Verification specifics:** suite/lint/build green. CDP: sheet numbers match constants (scripted cross-read — no hard-coded numbers, change a pet-count and watch `{petsToday}/20` live); level-up toast shows „Nächstes: …" at L4→5 and „Alles freigeschaltet! 🏆" at L40; entry points both work. Layout matrix on the sheet (12 rows at 320@130 % DE). **Ports:** vite 5183 / CDP 9229.

### V4/G70 — sick-trip UX: care sheet, toasts, shop medicine pulse (slot J) — model: **solfast**

> You are build agent V4/G70 for GOOBY 4.0. A sick Gooby may now drive OR surf to the SHOP for medicine (G56 changed the framework gate in wave 1) — you ship the player-facing flow: the 3-action care sheet, the new sick toast, the medicine-row highlight. **Your mission:** PLAN4.md §C-SYS7.2–7.3 exactly (copy table verbatim).
>
> **Read (after AGENTS.md):** PLAN4.md §C-SYS7 (ALL), §E0.1-8. Then `home/interactions.js` (careSheet — fully), `ui/shopScreen.js` (medicine row), the front-door travel-sheet flow (`systems/shopTrip.js` read-only), `test/` framework gate tests (G56's — extend, don't duplicate).
> **OWNS (modify):** `home/interactions.js` (careSheet: hint line + „Zum Laden fahren" 🛒 button + subline per §C-SYS7.3, emitting the existing travel sheet with `mode:'shopTrip'`), `ui/shopScreen.js` (ONE marked block: 0-medicine auto-scroll + one-time pulse), the sick-flip toast swap (`toast.sickNow`), `strings/v4-sick.js`, tests (care-sheet render ×3 actions, i18n key presence, gate matrix rows sick × mode × method if G56 left gaps). **DO NOT TOUCH:** `framework.js` (G56), `shopTrip.js` machine (§C-SYS7.1: untouched), vet flow.
> **Verification specifics:** suite/lint/build green. CDP: sick fixture → care sheet shows 3 actions + hint (screenshot EN+DE); „Zum Laden fahren" → travel chooser → BOTH methods reach the shop while sick; 0-medicine → auto-scroll + pulse once; arcade launch still blocked (`toast.tooSick`); sick face visible in the car/surf rig (screenshot). Layout matrix on the care sheet. **Ports:** vite 5184 / CDP 9230.

### E4.1 Team-eval agents (READ-ONLY; launch all 3 after CP-W2; §E0.1-12 fix loop before wave 3)

#### E4.1-0 TEAM-EVAL PREAMBLE (relay verbatim after each block)

> You are a READ-ONLY team-eval agent for GOOBY 4.0 (`/workspace/GOOBY`; three.js + Vite + vanilla ESM virtual-pet game, EN+DE, portrait 320–430 px). You evaluate ONE team's freshly merged work against its binding spec (PLAN4.md / PLAN4-GAMES.md) — adversarially, repro-first. **Rules:** no edits, no commits, no fixes. Read `GOOBY/AGENTS.md` first (VM/CDP recipe; SwiftShader slow — correctness over fps; no audio device — `audio.getStats()` + console logs are the audio evidence standard). Use YOUR ports only; never 5174/tmux. Drive real flows over CDP; use the dev harness + dev panel (cards 13–18 are legitimate eval tools). Evidence to `/tmp/gooby-v4-e-<team>/`; copy the 3–6 most probative artifacts to `/opt/cursor/artifacts/` prefixed `v4<team>_`. **Verdict format:** ① VERDICT PASS / PASS-WITH-NOTES / FAIL vs your pass bar; ② findings `[P0|P1|P2] title — repro — evidence path — suspected file` (P0 = crash/save-loss/unplayable/CI red; P1 = spec number wrong or feature broken with workaround; P2 = polish); ③ your charter's measurement tables; ④ what you could NOT verify and why. The coordinator resumes the build agents with your P0/P1 rows verbatim — write them actionable. Kill your processes by PID when done.

#### V4/E-CAKE — purble authenticity team eval (slot A, vite 5175 / CDP 9221) — model: **fable**

> Charter: grade the §G1 rework (G61+G62) for 1:1 Comfy-Cakes authenticity + spec conformance. Verify with live scripted CDP play + the logic tests: player-driven belt BOTH directions at 0.9/0.7 m/s incl. trash-off-left; drop fall-time 0.45 s forces press-ahead lead (script a moving-belt press: stationary-pan press catches, full-speed same-timing press splats); catch window ±0.24 m edges; oven meter commit/resume/auto-singe at 3.6 s + green-bake-requires-stopping; disallowed-move buzz matrix (icing-on-raw, second batter, empty Versand); pan-cap schedule 1→2→3 by serves; ticket/match/patience/interval numbers UNCHANGED from §C9-v3 (diff the surviving test assertions); §G1.8 totals ≈ 120–150 typical → ~26 c in `5/5/30`; §G1.6 difficulty rows (Leicht/Schwer catch windows + singe + pan-cap-at-serve-4) + §G5.4 endless row; §G1.7 layout at 320@130 % (pedals/dock/tickets/strip no overlap); bot bars (≥ 90 Mittel avg / ≥ 120 Schwer 1-of-5). **Pass bar:** every §G1 number observed correct; the belt SKILL is real (your scripted evidence, not the bot's); zero P0.

#### V4/E-RECAP — recap cinematic team eval (slot C, vite 5177 / CDP 9223) — model: **fable**

> Charter: grade the recap pipeline (G55+G63+G64 + G53's migration init). Force recaps at L5/L25/L40 via dev card 15: 8 vignettes in §C-SYS2.3 order with backdrops + the player's outfitted Gooby; beat conformance via the debug overlay — text pops/cuts within ±80 ms of the grid over a FULL fallback-track run (export the offset log — the §A2 evidence); skip: inert before t=10, subtle affordance after, end card ≥ 3 s; §C-SYS2.4 stat correctness: seed a known counter delta (script exact feeds/washes/games), assert the lines' numbers + §C-SYS2.5 selection order; retro-safety: migrated L23 fixture → no instant recap, next at L25 counting from migration; multi-jump L4→L11; replay row (stored stats, no re-snapshot); pendingLevel survives reload; recap never fires mid-minigame/mid-trip (attempt it); radio duck/resume; draw calls ≤ 250/vignette; no-audio wall-clock fallback (VM default!) still visually correct. **Pass bar:** ±80 ms held over a full run; every §C-SYS2 number correct; zero P0.

#### V4/E-WELT — Gooby Welt team eval (slot E, vite 5179 / CDP 9225) — model: **fable**

> Charter: grade goobyWelt (G65+G66+G50's assets). Both scenes: load (measure time), full 110 s ± 5 run, drag steers screen-true, offsets clamped to the corridor (script boundary pushes — never inside geometry), 28 stars/6 carrots/3 foto-spots per scene at valid positions (paths tests + live spot-collects), scoring math to 126 max, finish banner + coins in `divisor 6/min 4/max 20`, energy 8, L12 lock (L11 locked, L12 open), quality toggle high/low (pixel-ratio dump), pause/resume sort suppression; THE critical gate — lifecycle: 10 enter/exit cycles per scene → `renderer.info.memory` + heap baseline return (table), pixel ratio restored, no listener leaks; PLY-missing fallback stage plays a full round; context-loss handling (force via CDP `GL` if feasible, else code-review + note); bot determinism ≥ 60 % stars/score ≥ 45 ×5 seeds; license files present + `data/credits.js` rows match §G6.2 verbatim; ledger: committed splats ≤ 33 MB. **Pass bar:** zero leaks over 10 cycles; both scenes §G6-conformant; zero P0.

## E5. WAVE 3 — difficulty/endless/modifier rollout + audio sweep + content (launch G71–G79 in parallel; wave 2 + team-eval fixes merged, pushed, CI green)

**Shared batch-agent spec (G71–G74):** each batch agent, for EVERY game it owns: (1) `applyDifficulty(TUNE, mode)` in the `.logic.js` per its §G5.3 family row + §G5.3 guardrails (window ≥ 0.35 s, hitbox ≥ 55 % of Mittel; runner-family validator runs against SCALED speeds); (2) the §G5.4 endless end-condition + uncapped-ramp variant; (3) `ctx.params.modifier` consumption per §E0.1-3 for the game's §C-SYS4.3 types (`muenzregen` coinRate, `turbo` speed/scoreMult, `riesenGooby` scale/hitboxMult — derived tuning passed into logic init, logic never reads modifier state); (4) per-game tests: difficulty parameter monotonicity, guardrail asserts, endless end-condition, modifier tuning application; (5) the §G10 six-point bug-sweep checklist run + logged per game (direction probe, pause safety, dispose discipline ×3 cycles, results correctness incl. §E0.1-2 coin order, difficulty sanity via 10-seed bot means easy ≥ mittel ≥ schwer, layout combos); (6) 5 autoplay runs per game per NEW mode with payout table (×0.7 floor row-min / ×1.3 cap row-max / endless flat 5). Bots read the derived tune from run state. Existing Mittel numbers stay bit-identical (`applyDifficulty(t,'normal') === t` deep-equal test per game).

### V4/G71 — batch A: carrotCatch, bunnyHop, carrotGuard, memoryMatch, runner, basketBounce, pancakeTower (slot A) — model: **solfast**

> You are build agent V4/G71 for GOOBY 4.0. **Mission:** the shared batch-agent spec (§E5 intro) over your 7 games. **Read (after AGENTS.md):** PLAN4-GAMES §G5 (ALL — your families: timed-arena, runner/steer, sequence/puzzle, physics/skill rows as they apply), §G5.4 rows for your 7, §G8 + PLAN4.md §C-SYS4.2/4.3 + §E0.1-3 (modifier types touching your games: runner + bunnyHop [muenzregen/turbo/riesenGooby], carrotCatch [turbo], memoryMatch/carrotGuard/basketBounce/pancakeTower [payout-only types — no in-game hook]), §G10. Then each game's `.js`+`.logic.js`+tests. **OWNS:** those 7 games' files + their test files. **DO NOT TOUCH:** framework/economy/other games. **Verification:** §E5 intro items 4–6 for all 7 (tables in report). **Ports:** vite 5175 / CDP 9221.

### V4/G72 — batch B: danceParty, fishingPond, bubblePop, trampoline, starHopper, pipeFlow, deliveryRush, miniGolf (slot B) — model: **solfast**

> You are build agent V4/G72 for GOOBY 4.0. **Mission:** the shared batch-agent spec over your 8 games. **Read:** as G71's list, with your rows (§G5.4; modifier hooks: starHopper [muenzregen/turbo/riesenGooby], deliveryRush [muenzregen — note carController flip landed in wave 1, keep the autopilot negation intact], danceParty/trampoline [riesenGooby], others payout-only; miniGolf/trampoline stay `invertible:false` §G3.3; danceParty's synth TRACK stays per §C-SYS1.9.3 — its 3 hit blips flip in G78's sweep, don't touch sfxMap). Then each game's files. **OWNS:** those 8 games' files + tests. **DO NOT TOUCH:** framework/economy/other games/sfxMap. **Verification:** §E5 intro items 4–6 for all 8; deliveryRush §C7.3-v3 trip invariants re-proven. **Ports:** vite 5176 / CDP 9222.

### V4/G73 — batch C: goobySays, gardenRush, burgerBuild, veggieChop, goalieGooby (slot C) — model: **solfast**

> You are build agent V4/G73 for GOOBY 4.0. **Mission:** the shared batch-agent spec over your 5 games. **Read:** as G71's list, with your rows (§G5.4; modifier hooks: veggieChop [turbo], goalieGooby [riesenGooby], others payout-only; goobySays endless = replay speed ramps past the floor §G5.4; veggieChop `invertible:false`). Then each game's files. **OWNS:** those 5 games' files + tests. **DO NOT TOUCH:** framework/economy/other games. **Verification:** §E5 intro items 4–6 for all 5. **Ports:** vite 5177 / CDP 9223.

### V4/G74 — batch D (flagship + v3-era): shoppingSurf, toyRacer, ghostHunt, rocketRescue, harborHopper (slot D) — model: **fable**

> You are build agent V4/G74 for GOOBY 4.0. The hardest difficulty rows: surf's Schwer speed-cap 18 + endless ramp-to-20 with density ×1.5 under the never-impossible validator, plus 4 v3-era games. **Mission:** the shared batch-agent spec over your 5. **Read:** as G71's list, with your rows (§G5.3 runner/steer + physics families, §G5.4; modifier hooks: shoppingSurf [all 3], toyRacer/harborHopper [muenzregen/turbo(+riesen for harbor)], rocketRescue [muenzregen], ghostHunt payout-only; surf render juice is G67's — logic-side only here; harborHopper input mirror landed in wave 1 — logic space unchanged). Then each game's files incl. the surf BFS validator. **OWNS:** those 5 games' `.logic.js` + tests (+ `.js` param pass-through lines). **DO NOT TOUCH:** G67's juice blocks (additive coexistence in shoppingSurf.js — coordinate via marked regions), framework/economy. **Verification:** §E5 intro items 4–6; surf validator green at Schwer AND endless-scaled speeds (200 seeds); Schwer targets reachable by bot 1-of-5 for all 5 (else relax params, never raise targets — §G5.4). **Ports:** vite 5178 / CDP 9224.

### V4/G75 — endless integration + highscore boards + cross-game difficulty certification (slot E) — model: **fable**

> You are build agent V4/G75 for GOOBY 4.0. The difficulty/endless system's integrator: prove the whole 26-game matrix coheres, own the cross-game test file, and polish the endless UX seams (boards, ∞ chips, unlock chain). **Mission:** PLAN4-GAMES §G5.5 (unlock/persistence semantics e2e), §G5.6's endless rows/boards where G68/G56 left mount points, + certification.
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G5 (ALL), §E0.1-14; G54/G56/G68/G61/G71–G74 reports. **OWNS:** `test/difficultyEndless.test.js` (all 26 export `applyDifficulty`; normal-mode identity; guardrails; targets-table cross-check vs `difficultyTargets.js`; endless end-conditions exist per row), endless seam marked one-liners (boards/∞ chips/lock copy) where gaps exist — each granted edit ≤ 3 lines, listed in report. **DO NOT TOUCH:** game tunes (batch agents own them — file findings instead of editing foreign game files beyond the granted seams).
> **Verification:** suite/lint/build green; the certification table: per game × {easy, normal, hard, endless} — 3 autoplay runs each (78 rows minimum… report the full grid), bot means monotone, Schwer target reached 1-of-5 per game (resume the owning batch agent via coordinator if not — that's a report item, not your edit), endless writes `endlessBest` only on improvement, unlock chain live (beat Schwer at L9 → still locked; L10 → unlocks). **Ports:** vite 5179 / CDP 9225.

### V4/G76 — modifier surfacing UI: glow canvas, badges, toasts, glueckspilz roll (slot F) — model: **fable**

> You are build agent V4/G76 for GOOBY 4.0. Modifier events must LOOK like events: the §C-SYS4.5 VFX-texture canvas glow on the modified tile, plays/countdown badges, start toasts, the results „aktiv" chip, and the glueckspilz slot-roll. **Mission:** PLAN4.md §C-SYS4.5–4.6 + §C-SYS4.2's glueckspilz results row exactly.
>
> **Read (after AGENTS.md):** PLAN4.md §C-SYS4 (ALL), §B3 (texture paths `itch/vfx/`), §E0.1-2 (glueckspilz pays via `economy.award('glueckspilz')` respecting the day cap — G54's API); PLAN4-GAMES §G7.2 (glow mount point G68 left), §G8-3 (results row shape). Then `ui/arcadeScreen.js` (mount point), `ui/mgPregame.js` (banner), framework results screen, `gfx/particles.js`.
> **OWNS:** `src/ui/modifierGlow.js` (§C-SYS4.5 verbatim: 3 composited layers, one shared rAF, pause-when-hidden, ≤ 1 ms/frame, per-type tints), `strings/v4-modifier.js`. **(modify):** the G68 mount point (swap placeholder → component, marked), results screen marked block (chip + glueckspilz 900 ms roll + „Tagesbonus erreicht" 0-payout note), arcade badge/countdown pill, `ui/hud.js`/nav badge dot block if unclaimed, `styles.css` append. **DO NOT TOUCH:** `modifierEngine.js`/`economy.js` (G54), `devPanel` (G58).
> **Verification:** suite/lint/build green. CDP: force each of the 6 types (dev card 14) — glow tint per type screenshots, badge `{playsLeft}× ✨` + mm:ss ticks, toast + jingle on start, results chip per type, glueckspilz roll pays 10–60 then 0-with-note past the 150 c day cap (pinned clock); rAF cost measured (dev overlay) ≤ 1 ms; glow pauses when screen hidden. Layout matrix on the modified tile + results row. **Ports:** vite 5180 / CDP 9226.

### V4/G77 — modifier system e2e integration + cityDrive hook + id-8 proof (slot G) — model: **fable**

> You are build agent V4/G77 for GOOBY 4.0. Close the modifier loop across every seam: the full scheduled lifecycle against the real clock plumbing, the cityDrive arcade muenzregen hook (the one §C-SYS4.3 game no batch owns), notification id 8 behavior, and the integration test file. **Mission:** §C-SYS4.1/4.4 e2e + §B10 id 8 + §E0.1-3's cityDrive row.
>
> **Read (after AGENTS.md):** PLAN4.md §B4, §B10, §C-SYS4 (ALL), §C-SYS11.1; PLAN4-GAMES §G8. Then G54/G56/G76 reports, `city/cityDrive.js` (arcade mode path), `systems/notifyRules.js` (G53's id 8), `test/notifyRules.test.js`.
> **OWNS:** `test/modifierIntegration.test.js` (scheduler→consume→refund→expire→reschedule state walks; eligibility × unlock levels; no-repeat guard; offline catch-up; notification id 8 scheduling honesty at `nextAt` + quiet-hours + cap-8), `city/cityDrive.js` ONE marked block (arcade-mode muenzregen coinRate ×1.5; trips NEVER modified — assert). **DO NOT TOUCH:** engine/economy/UI files (file findings for G54/G76 instead).
> **Verification:** suite/lint/build green. The §A2 evidence run: pinned-clock CDP session — natural first event at +30 min (fast clock), play through 2–3 plays, early-quit refund exactly once, expiry, auto-reschedule ∈ [50,120] — full JSON timeline to `/tmp/gooby-v4-g77/` (this is the „full cycle proven" §A2 bullet); id 8 fires once per scheduled event on background; cityDrive arcade pickup rate ×1.5 measured over 3 runs vs baseline. **Ports:** vite 5181 / CDP 9227.

### V4/G78 — synth-replacement sweep: the 46-id table + coverage exact-set (slot H) — model: **solfast**

> You are build agent V4/G78 for GOOBY 4.0. „No more synthetic sounds": flip all 46 §C-SYS1.9.2 ids to real samples (exact picks binding as DEFAULT; same-tone-family substitutions allowed after audition, logged), delete dead recipes, land the exact-set coverage test. **Mission:** PLAN4.md §C-SYS1.9 (ALL) exactly. You are sfxMap.js's EXCLUSIVE owner this wave (§E0.1-9) — consolidate the wave-1/2 marked blocks.
>
> **Read (after AGENTS.md):** PLAN4.md §C-SYS1.9.1–1.9.4 (table + exemptions + acceptance), §B3 (itch-sfx root), §E0.1-9. Then `src/audio/sfxMap.js` (fully), `audio/audio.js` (SYNTH_RECIPES — delete only listed dead ones; `trickle`/`doorbell`/`bunnyCheer` KEPT per the table), `scripts/audio-loudness.mjs`, `test/audioCoverage.test.js` (v3), `test/onboarding.test.js` (unmapped-id gate).
> **OWNS:** `audio/sfxMap.js` (the 46 flips + rate/vol notes verbatim; says.pad1..4 single-file rate-pitched §C-SYS1.9.2 #43–46), `audio/audio.js` dead-recipe deletion block, `audio/loudness.json` regeneration (script run over new files), `test/audioCoverage.test.js` (v4: the 4 §C-SYS1.9.4 assertions — exemption set EXACTLY the 9 ids + voice/loop classes), the harvest-gasp call-site one-liner (`audio.play('gooby.gasp')` §C-SYS1.9.2 #29, marked).
> **DO NOT TOUCH:** `radioPlayer.js`/registry (G51), `musicDirector.js`, danceParty TRACK, any game file beyond the #29 one-liner.
> **Verification:** suite/lint/build green (coverage v4 + onboarding gates green — the real proof). CDP audition pass: play ≥ 20 of the 46 flipped ids via console (`getStats()` + node counts confirm sample path, log which); a says-pads sequence preserving the C-D-E-G ratio (rate dump 1/1.125/1.25/1.5); swap log table (id | default pick | shipped pick | why) in report. **Ports:** vite 5182 / CDP 9228.

### V4/G79 — room polish + food value chips + 3 new foods (slot I) — model: **solfast**

> You are build agent V4/G79 for GOOBY 4.0. The §G9 content pass: 5 rooms get static dressing (≤ +4 draw calls each), the fridge tray + shop show hunger/fun chips, and 3 Tiny-Treats baked goods join the catalog. **Mission:** PLAN4-GAMES §G9.1–§G9.3 exactly.
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G9 (ALL — the room table + chip spec + food rows binding); PLAN4.md §B3 (asset keys G50 committed — verify the baked-goods GLBs + Aline + tiny-treats picks exist first, report gaps). Then `home/decor.js`, `home/rooms/*`, `home/interactions.js` (tray grid), `ui/shopScreen.js` (renderFood), `data/foods.js`.
> **OWNS:** `home/decor.js` + `home/rooms/*` (the §G9.1 additions, merged/instanced, disposed via owned lists), `data/foods.js` (3 appends §G9.3), `strings/v4-foods.js`, tray + shop chip marked blocks (ONE icon-vs-emoji choice applied to both §G9.2), `styles.css` append. **DO NOT TOUCH:** `careSheet` logic (G70), anchor/interaction zones, Nougatschleuse.
> **Verification:** suite/lint/build green. CDP: 5 before/after room pairs at 393×852 + draw-call delta table (≤ +4 each — `renderer.info`); chips show only non-zero deltas, max 2, both surfaces consistent; buy + feed each new food (deltas hit stats, junk pipeline per junkScore); catalog 33→36 test updated. Layout check on tray + shop cards at 320@130 %. **Ports:** vite 5183 / CDP 9229.

## E6. WAVE 4 — ship polish (launch G80–G84 in parallel; wave 3 merged, pushed, CI green, ART-GATE-3 done)

### V4/G80 — icon 2.0: PNG decoder, --source bypass, splash, dark/tinted, version 4.0.0 (slot A) — model: **fable**

> You are build agent V4/G80 for GOOBY 4.0. The app icon goes layered: decode the coordinator's 1024² art in pure node, flatten opaque, regenerate icon + splash, attempt the iOS-18 dark/tinted variants with a CI-safe fallback, and bump the marketing version. **Mission:** PLAN4.md §C-SYS10 (ALL) exactly. HARD PRECONDITION: `GOOBY/art/icon-v4-source.png` exists (ART-GATE-3) — verify first; abort and report if not.
>
> **Read (after AGENTS.md):** PLAN4.md §C-SYS10.1–10.3, §A2 icon bullet. Then `scripts/gen-icons.mjs` (fully — encoder half exists), `test/icons.test.js`, `ios/App/App/Assets.xcassets/**/Contents.json`, `project.pbxproj` (MARKETING_VERSION), `.github/workflows/gooby-ios.yml` (what CI runs).
> **OWNS:** `scripts/gen-icons.mjs` (§C-SYS10.2: minimal PNG decoder — zlib inflate, colorType 2/6, non-interlaced; `--source` bypass; flatten `#FFF6EC`; splash 2732² regen), the regenerated icon/splash assets + optional dark/tinted PNGs + Contents.json appearances (WITH the §C-SYS10.3 documented fallback if CI rejects), `art/icon-v4-layer-*.png` committal (coordinator-provided, storage only), `test/icons.test.js` (extend: exists, colorType 2, dimensions, byte-stable), `project.pbxproj` (MARKETING_VERSION 4.0.0 — both configs). **DO NOT TOUCH:** other ios/ settings, README (G82).
> **Verification:** suite/lint/build green; `npm run icons -- --source art/icon-v4-source.png` byte-stable ×2; `npx cap sync ios` green; **push is coordinator's — but you must verify the workflow would pass:** run the same xcodebuild-relevant checks available on Linux + flag risk; icon 1024² colorType 2 no-alpha verified by your test; splash visually checked (screenshot). Report the dark/tinted decision (shipped vs fallback) explicitly. **Ports:** vite 5175 / CDP 9221.

### V4/G81 — credits screen + cross-check test (slot B) — model: **solfast**

> You are build agent V4/G81 for GOOBY 4.0. The license obligations land on-screen: a static scrollable credits screen from G50's `data/credits.js`, cross-checked against the committed asset roots so no shipped pack goes uncredited (CC-BY splat rows are a P1 if missing). **Mission:** PLAN4.md §C-SYS12.4 exactly.
>
> **Read (after AGENTS.md):** PLAN4.md §C-SYS12.4, §B9 (subscreen mechanics — G58's stack), §A2 assets bullet (CC-BY = P1); PLAN4-GAMES §G6.2 (the two shipped splat rows verbatim). Then `data/credits.js` (G50's — extend rows ONLY if a pack shipped after G50; note edits), `ui/settingsScreen.js` (the Credits row mount G58 left), `public/assets/**` roots.
> **OWNS:** `ui/creditsScreen.js` (§C-SYS12.4 sections, inert rows, URLs as text), `test/credits.test.js` (cross-check: every committed asset root ↔ a credits row, no phantom rows; both splat attributions + „verändert" note verbatim), `strings/v4-credits.js`, `styles.css` append. **DO NOT TOUCH:** `settingsScreen.js` beyond activating G58's feature-detected row (it self-activates on registration), `data/credits.js` structure (G50's).
> **Verification:** suite/lint/build green; CDP: screen scrolls, all sections render EN+DE labels; cross-check test catches a synthetic phantom row (prove by temporary mutation, reverted); layout matrix. **Ports:** vite 5176 / CDP 9222.

### V4/G82 — whatsNew 4.0 + NEU + docs (slot C) — model: **solfast**

> You are build agent V4/G82 for GOOBY 4.0. Ship comms: the one-time 4.0 What's-new panel (radio + codes + gallery highlights), NEU ribbons for the new surfaces where §C10.3-v3 rules apply, and the docs pass (README 4.0, AGENTS.md harness cheat sheet regenerated from `data/harnessParams.js`, plus the 4.0 contract deltas section). **Mission:** §B1's `whatsNew4Seen` consumption + the v3-§E0.1-8-style panel + docs.
>
> **Read (after AGENTS.md):** PLAN4.md §B1 (flag semantics), §A (the one-sentence pitch — your panel copy source), §C-SYS6 card 18 (harnessParams single source); PLAN4-GAMES §G7.2 (goobyWelt SPECIAL ribbon is G68's — don't duplicate). Then `ui/whatsNew.js` (v2/v3 pattern), `README.md`, `AGENTS.md`, `data/harnessParams.js` (G58's).
> **OWNS:** `ui/whatsNew.js` (4.0 panel, migrated-only, once), `README.md` + `AGENTS.md` (4.0 sections: new systems map, harness params regenerated, VM notes additions — e.g. radio/audio verification via `getStats().radio`), `strings/v4-ship.js`. **DO NOT TOUCH:** `onboarding.js` beyond a marked teaser line if needed, version numbers (G80).
> **Verification:** suite/lint/build green; CDP: migrated v3 fixture → panel exactly once (reload → gone), fresh save → never; `?whatsnew=…` harness regression (3.0/2.0 panels still forceable); docs: every documented harness param actually works (spot-run 12); AGENTS.md cheat sheet diff == harnessParams table. **Ports:** vite 5177 / CDP 9223.

### V4/G83 — cover-art + track-cover integration (slot D) — model: **solfast**

> You are build agent V4/G83 for GOOBY 4.0. The coordinator's ART-GATE-3 drop is live: 28 game covers + any accumulated track covers/backdrops. You verify, wire and prove them everywhere. **Mission:** PLAN4-GAMES §G7.1 (spec/fallback rules), PLAN4.md §C-SYS1.6 (track-cover convention).
>
> **Read (after AGENTS.md):** PLAN4-GAMES §G7.1–§G7.3; PLAN4.md §C-SYS1.6, §A2 assets bullet. Then `ui/arcadeScreen.js`/`mgPregame.js` (G68's cover paths), `scripts/gen-music-manifest.mjs` (cover field).
> **OWNS:** verification + wiring of `public/assets/covers/*.png` (28 files, 512×384, ≤ 85 KB each, ≤ 2.3 MB total — re-encode/report oversizes to the coordinator; you may pngquant/resize, never regenerate art), `test/` cover-presence assertions (28 ids, sizes), a `npm run music-manifest` re-run committing cover-field updates for any owner tracks that arrived (§G4 polling — coordinate), the 27+1-tile contact sheet + pregame screenshots. **DO NOT TOUCH:** grid/pregame code (G68 — file findings if fallback logic misbehaves), art generation (coordinator).
> **Verification:** suite/lint/build green; ledger re-run ≤ budget; CDP: full arcade grid with real covers at 320/393/430 (contact sheet artifact), a deliberately-renamed cover falls back to icon-tile (restored after), pregame cover cache-instant. **Ports:** vite 5178 / CDP 9224.

### V4/G84 — integration sweep (slot E) — model: **fable**

> You are build agent V4/G84 for GOOBY 4.0. The pre-eval integration net: run the whole game end-to-end, chase cross-feature seams no single agent owns, mop up the deferred-items lists from all 34 prior reports, and fix ONLY integration-class bugs (foreign-file fixes as marked one-liners; anything bigger = a report row for the coordinator to resume the owner). **Mission:** green 28-game chain + cross-feature journeys + deferred-item triage.
>
> **Read (after AGENTS.md):** PLAN4.md §A2 (your checklist), §E1 gates; every prior agent report's ⑤-section (coordinator supplies). **OWNS:** cross-cutting marked one-liners ONLY (each ≤ 3 lines, listed exhaustively in your report); `test/` additions for any integration bug you fix.
> **Verification (the mission):** the CP-W4 28-game chain (§G3) — 28/28 results, in-row payouts at all shipped difficulty modes spot-sampled, zero console errors; journeys: fresh boot → onboarding → first radio start → code redeem → modifier force-play → recap at L5 → gallery capture/export → sick shop-surf-trip → goobyWelt round → settings IA walk — one continuous session log; suite ≥ 1446 green, lint/px-audit/build green; `npx cap sync ios` green. Report: integration-fix table + remaining-risk list for §F. **Ports:** vite 5179 / CDP 9225.

---

# §F. Final Eval Plan — 24 independent evaluation agents + fix loop (4.0)

## F1. How evals run

Launch after §G3's CP-W4 is green (all 35 build agents + team-eval fix rounds merged, suite ≥ 1446 green, pushed, CI green, all art gates satisfied, GoobyMusic poll #4 processed). Evals are **READ-ONLY**: they observe, measure and file verdicts — never edit/commit/fix. Up to 12 run concurrently on the §E0.3 slots (eval n uses slot `((n−1) mod 12)`: vite `5175+((n−1) mod 12)`, CDP `9221+((n−1) mod 12)`). Each eval gets its §F2 charter + the §F1.1 preamble, forwarded verbatim as one message, launched on its **model tag** (12× `fable` deep domains, 12× `solfast` broad sweeps). Pass bars derive from PLAN4.md §A2 — an §A2 count/number violation is P0 by definition.

### F1.1 COMMON EVAL PREAMBLE (relay verbatim after each §F2 charter)

> You are eval agent V4-E<n> for GOOBY 4.0 „VOLLVERSION FINAL", a finished(?) Pou-class virtual pet in `/workspace/GOOBY` (three.js + Vite + vanilla ESM, Capacitor iOS, EN+DE, portrait 320–430 px): procedural rabbit, 28 minigames (27 + goobyWelt splat special) with a Leicht/Mittel/Schwer/Endlos difficulty system behind a cover-art pre-game screen, real-music radio with per-track controls, beat-synced recap cinematic, modifier events, secret codes + sticker #29, photo gallery with iOS export, gyro parallax, sick shop-trips, 18-card dev panel, settings IA + credits, save v4. Judge it against the binding specs: `GOOBY/PLAN4.md` (systems) + `GOOBY/PLAN4-GAMES.md` (games) — with PLAN3/PLAN2/PLAN.md numbers binding underneath, and the §E0.1 reconciliation rulings binding over both where they conflict.
>
> **Rules.** READ-ONLY: no edits, no commits, no fixes, no constants „corrections". Read `GOOBY/AGENTS.md` first (VM/CDP recipe; SwiftShader slow — correctness over fps; NO audio device — `audio.getStats()` + console logs are the audio evidence). Read the spec sections your charter names. Use YOUR ports only; never 5174/tmux. Drive real flows over CDP; reach states fast via the harness (AGENTS.md 4.0 cheat sheet incl. `?difficulty=`, `?invertx/?inverty`, `?scene=recap`, flycam) and the dev panel cards 1–18 (5-tap gate or `?open=devPanel`). Kill your own processes by PID when done.
>
> **Evidence.** Everything to `/tmp/gooby-v4-e<n>/`; copy your 3–8 most probative artifacts to `/opt/cursor/artifacts/` prefixed `v4e<n>_`. Every claim must map to an artifact or command output.
>
> **Verdict format.** ① VERDICT: PASS / PASS-WITH-NOTES / FAIL against your pass bar; ② findings, each `[P0|P1|P2] title — repro — evidence path — suspected owning agent (§E0.4 roster)`; P0 = ship-blocker (crash, save loss, unplayable game, §A2 count/number violated, CI red), P1 = must-fix (broken spec behavior, wrong math, layout break, missing CC-BY credit), P2 = polish; ③ your charter's tables; ④ what you could NOT verify and why. Be adversarial: a PASS with untested claims is worse than a FAIL.

## F2. The 24 charters

**— fable (deep domains) —**

**V4-E1 [fable] — economy v4: stacking, caps, difficulty multipliers, endless, exploit hunt.** Read PLAN4.md §C-SYS11 (ALL), §C-SYS4.2, §B11, §E0.1-2 (the binding stacking ruling); PLAN4-GAMES §G5.2. Suite economy sims green incl. the §C-SYS11.2 v4 sim; empirically: scripted rounds proving the stacking order (difficulty ×0.7/×1.3 inside row cap; daily ×2 after; code buff ×2; doppelGold ×2 with paid ≤ 2×rowMax and surplus booked); the 150 c modifier day-cap crossover (doppelGold pays base, glueckspilz pays 0 + note); endless flat 5 c + the ≤ 100 c/day endless cap; the theoretical ×8 stack is triple-gated live; reason-tag whitelist (grep every `economy.award` call site); ledger honesty (dev card 3 rows == scripted transactions); exploit hunt: code re-redeem, refund farming (max 1×/event), clock-pin backwards vs `dayCoins`/`dayCoinsDay`, glueckspilz reroll attempts, endless-run spam c/min vs normal play (must not dominate — measure). **Pass bar:** every §C-SYS11 bound held live; zero exploits; sim assertions meaningful (read the test critically).

**V4-E2 [fable] — save v1/v2/v3→v4 + hostile fuzz (new slices).** Read PLAN4.md §B1 (ALL), §A2 save bullet; PLAN4-GAMES §G5.5/§G3.3. Suite saveV4 green; live: v1 AND v3 fixtures → `v===4`, deep-diff lossless, all six new slices at exact defaults, radio furniture granted-not-overwriting (fixture with occupied shelf slot), recap baseline init math at L4/L23/L40 fixtures, `whatsNew4Seen` false only for migrated; validate clamps live: `radio.station 'bogus'→'bordmusik'`, `trims.vol 999→100`, far-future `doubleCoinsUntil`/`nextAt`/`lockUntil` collapse (§B1's ≤ now+24 h rule), malformed `modifiers.current`, `recap.history` > 8, `gallery.count` 99→40; ≥ 40 fresh hostile mutations of your own targeting radio/codes/modifiers/recap/gallery/minigames-difficulty slices; save→load→save byte-stable; mid-recap and mid-modifier-window kill+reload. **Pass bar:** zero data loss on legit saves, zero crashes on hostile ones, every clamp per §B1.

**V4-E3 [fable] — recap cinematic: beat sync ±80 ms, stats, skip, replay, retro-safety.** Read PLAN4.md §B5, §C-SYS2 (ALL). Independently re-verify V4/E-RECAP's charter post-waves-3/4 (regressions land late): forced L5/L25/L40 recaps — 8 §C-SYS2.3 vignettes, dolly + outfitted Gooby, backdrops; beat-debug offset log over TWO full runs (fallback track + an owner Recap track if present) — text pops/cuts ≤ ±80 ms; §C-SYS2.4/2.5 line selection against a seeded counter delta you script yourself; skip rules (inert < 10 s, end card ≥ 3 s); §C-SYS2.7 end card (25×level math, nextUnlock line); replay history ≤ 8 with STORED stats; migrated-L23 retro-safety; multi-jump; never-mid-minigame; pendingLevel reload; radio duck/resume; wall-clock fallback; draw calls ≤ 250/vignette; 3 enter/exit cycles memory-stable. **Pass bar:** ±80 ms held on both runs; every §C-SYS2 number correct; zero P0.

**V4-E4 [fable] — radio + music registry + NO-SYNTH audit.** Read PLAN4.md §B2, §B3, §C-SYS1 (ALL — incl. 1.9). Registry: manifest schema/id/paths/cover/beats integrity vs disk (script it), Bordmusik ≥ 13 builtin + recap fallback, empty-GoobyMusic graceful boot, station composition incl. Stinger exclusion; radio: MediaElement streaming (ZERO decoded-buffer growth during 10-min playback — `getStats()` cache probe), per-track trims audible in `getStats().radio.gain` math (`gainTrim × vol/100`), fades ≤ 400 ms gap, resume-after-reload semantics, `replaceContext` both settings vs the medley director gate, danceParty/recap ducking, airtight music-mute (zero nodes 60 s probe), now-playing chip ≤ 500 ms/4 s/no-stack/suppressed-in-games, radio furniture tap + pulse; per-track settings rows incl. all-disabled fallback toast + 24-row virtualization; **the NO-SYNTH audit:** run audioCoverage v4 + independently grep `sfxMap.js` — exemption set EXACTLY the 9 §C-SYS1.9.3 ids + voice/loops/dance-track, all 46 table rows sample-backed on committed files with loudness entries, dead recipes actually deleted. **Pass bar:** every §C-SYS1 number verified; exact-set audit clean by independent count.

**V4-E5 [fable] — modifier events e2e.** Read PLAN4.md §B4, §C-SYS4 (ALL), §B10. Re-verify the full lifecycle adversarially post-wave-4: seeded determinism (same seed → same schedule — two parallel fixtures), cadence bounds over 50 simulated events (pinned clock), 30-min grace on fresh v4 boot, offline catch-up, no-repeat guard, eligibility matrix spot checks at L1/L12/L40 (goobyWelt + trips NEVER modified — force-attempt via dev card must refuse), plays/45-min window whichever-first both ways, quit-refund exactly once, every §C-SYS4.2 type's in-game effect live (muenzregen pickup-rate measurement, turbo speed+score, riesenGooby scale+hitbox, stickerChance forced drop + quest-tick fallback, glueckspilz roll, doppelGold payout), §C-SYS4.5 glow (3 layers, tints per type, ≤ 1 ms rAF, pause-hidden), badges/countdown/toasts/nav dot, notification id 8 (quiet hours, cap 8, once per event), dev card 14 honesty (drives the real engine). **Pass bar:** the §A2 modifier bullet holds end-to-end; every type's effect + payout correct; zero P0.

**V4-E6 [fable] — purble authenticity (the §G1 auditor).** Read PLAN4-GAMES §G1 (ALL). Re-run V4/E-CAKE's charter deeply post-waves-3/4 PLUS: the „1:1 feel" verdict as product-owner proxy (belt-driving tension, fall-time lead skill, oven two-pass pressure, multi-pan juggling at cap 3 — argue it from ≥ 20 min of scripted manual play, not bots); §G1.5 station table positions/legality matrix exhaustively (script each illegal press); difficulty rows + endless (3 rejects end it, floor 10 s); §G1.7 layout at all combos; sfx flips from G78 (chop/splat/cake rows) fire samples; economy totals ≈ 120–150 → ~26 c preserved; meta/counters/sticker/quest hooks regression. **Pass bar:** §G1 conformance + a defensible „feels like Comfy Cakes" verdict; zero P0.

**V4-E7 [fable] — controls: 27-game direction table + invert setting.** Read PLAN4-GAMES §G2 (ALL), §G3 (ALL). THE owner-pain eval: for ALL 27 games + goobyWelt, run the §G10-1 CDP probe (scripted swipe/drag/zone LEFT → avatar projected screen-x decreases; n/a games verified as tap/pick-true) — deliver the full 28-row table with before-coordinates evidence; the 4 previously-flipped surfaces (cityDrive trip+arcade, deliveryRush, shoppingSurf, harborHopper) get double confirmation + regression vs trip invariants (rewards/energy/tow bit-identical); miniGolf/trampoline documented exemptions verified (trick travels toward swipe); `controls.invertible` declared by all 27 (test + grep); invert setting: both toggles × 6 invertible games live (surf inverted swipe left → lane+1; carController `invertSteer` zone swap; veggieChop/miniGolf/taps UNAFFECTED), `?invertx=1` harness, persistence. **Pass bar:** 28/28 rows screen-true (or documented-exempt); invert wraps exactly the §G3.3 list; zero P0.

**V4-E8 [fable] — difficulty + endless system.** Read PLAN4-GAMES §G5 (ALL); PLAN4.md §E0.1-14. All 26 games: `applyDifficulty` normal-identity (deep-equal, scripted), easy/hard param families per §G5.3 (spot-derive 8 games' derived tunes numerically), guardrails (no window < 0.35 s, hitbox ≥ 55 %, §C8.7-style validator at scaled speeds for the runner family), §G5.4 targets: bot reaches Schwer target 1-of-5 per game (26-row table — the beatability gate; a miss = P1 against the PARAMS), coin multipliers ×0.7 floor-min/×1.3 cap-max live, endless: unlock chain (beaten.hard ∧ L≥10, locked pill copy), flat 5 c + daily ×2, end-conditions per row (script 6 games' endings incl. surf 3-crash + ramp-to-20, memoryMatch 12 miss-flips, miniGolf 3 over-par), elapsed-up HUD, endlessBest write-on-improve only, `best` stays the Mittel board (v3 ribbons/quests untouched), pregame pills/lines/persistence. **Pass bar:** 26/26 conformant + beatable; zero P0.

**V4-E9 [fable] — Gooby Welt: splat, perf, disposal, credits.** Read PLAN4-GAMES §G6 (ALL). Re-run V4/E-WELT deeply post-waves-3/4 PLUS: 10-cycle memory table per scene on the FINAL tree, load-time distribution (5 loads each), quality toggle pixel-ratio + far-plane deltas, fallback stage round, context-loss exit path (code audit + forced repro if feasible), corridor boundary escape attempts (scripted adversarial drags), both scenes' §G6.5-3 path validations, bot floors, pregame scene select + per-scene highscores, L12 lock, no modifier/difficulty participation (§G5.1/§G8-5), credits rows + LICENSE.txt files + „verändert" note, ledger ≤ budget, draw calls ≤ 120 + viewer. **Pass bar:** zero leaks; §G6 conformant; credits complete (missing CC-BY row = P1). 

**V4-E10 [fable] — layout matrix strict: new 4.0 surfaces × full grid.** Read PLAN4.md §C-SYS12.3, §A2 layout heritage (v3 §C1 rules bind); PLAN4-GAMES §G1.7/§G5.6/§G7.2. The grid: 5 viewports (320×568, 375×667, 390×844, 393×852, 430×932) × scales 85/100/115/130 × `?notch=1` on/off × EN/DE on every NEW/CHANGED surface: settings main + display/audio/tracks/codes/credits subscreens, radioPanel, now-playing chip, trackSettings (40-track virtualized), codesScreen (+lock state), xpInfo (12 rows), care sheet (3 actions), mgPregame (all 4 pill states + modifier banner + welt quality/scene rows), arcade cover grid (28 tiles, lock/NEU/SPECIAL/glow overlays), recap overlay + end card, gallery grid/viewer/empty state, purble pedals+dock+strip+tickets, whatsNew 4.0, credits screen, dev panel cards 13–18, HUD with floaters + buff chip + radio chip + album dot simultaneously (the collision case — script it). Automated probes (overflow scan, overlap/clip rects, ≥ 44 px targets, fixed chrome vs insets) + the full pass/fail grid. **Pass bar:** ZERO clips/overlaps/sub-44 targets across the grid.

**V4-E11 [fable] — performance + leak hygiene (splat memory! radio element! recap scene!).** Read PLAN4.md §A2 assets/audio-perf bullets, §B2.3; PLAN4-GAMES §G4 perf gate, §G6.6. Measure on the final tree: committed assets ledger vs §A2 (target ≤ 300 MB, actual expected ≈ 65–75 MB — report exact); draw calls: home ≤ 120 (+G79 deltas ≤ +4/room), surf mid-run ≤ 250 incl. juice (+≤ 30), purble ≤ 250, recap ≤ 250/vignette, welt ≤ 120+viewer, arcade grid + glow overhead; heap: 30-s deltas in surf/purble/recap/welt/home; the three named risks: (a) welt 10-cycle table, (b) radio 15-min playback → decoded-buffer cache flat + exactly ONE media element ever created (`createMediaElementSource` once — probe), (c) recap 5 replays → geometry/texture baseline return; glow rAF ≤ 1 ms; gyro zero-alloc (heap sample while tilting); bundle: main chunk + per-game chunks vs v3 sizes (build table — splat lib must be code-split into the welt chunk, NOT main: a main-chunk regression > +100 KB gzip is P1); scene-switch ≤ 1.5 s at 4× throttle; 20× screen-cycle listener stability. **Pass bar:** every budget met with measurements.

**V4-E12 [fable] — full-game verdict + 60-min soak (the §A2 auditor).** Read PLAN4.md §A (ALL). Walk „Definition of 4.0" item by item with evidence (counts: 14 tracks/29 stickers/18 dev cards/8 recap milestones/6 modifier types/2 codes/28 games/12 XP sites — script-count them; quality bars: delegate deep domains to E1–E11 but spot-check each; §A3 invariants: constants single-block git audit, medley-fallback preserved when radio off, no accounts/server). Then a **60-minute continuous free-play soak** (fast clock where useful) as a fresh player: onboarding → care → first radio start → arcade with pregame → a modifier event (natural or waited) → code redeem → L5 recap → photo + gallery export → sick shop-surf trip → welt round → settings walk — console log captured start-to-finish (zero-errors bar), then a ranked „5 weakest spots" product verdict. **Pass bar:** every §A2 item TRUE with evidence; zero console errors in the soak.

**— solfast (broad sweeps) —**

**V4-E13 [solfast] — codes system.** Read PLAN4.md §B6, §C-SYS5 (ALL). Both launch codes live end-to-end (exact normalized inputs incl. „ update LIEBE " variants); single-use enforced across reload; UpdateLiebe: chip countdown 10:00, survives reload, expires, payout ×2 stacking with daily ×2 (measure a round inside + outside the window); IchLIE3BDich: sticker #29 + 50 c + book page-5 secret slot (locked silhouette → unlocked + „+💗" header), `stickerBookFull` still targets 28; wrong-code shake/toast, 5-in-60 s lockout + countdown + `lockUntil` persistence; dev card 13 (redeem/reset/lock-reset honesty); `codesRedeemed` counter; no XP from codes. **Pass bar:** every §C-SYS5 behavior exact.

**V4-E14 [solfast] — surf juice + runner-class rollout.** Read PLAN4-GAMES §G4 (ALL). Verify every number: FOV 62→72 lerped k=5 + turbo +8 cap 78 (telemetry dump), streak pool 24/spawn curve 0-6-14 per speed (instrument via console), shake ≥ 15 m/s amplitude 0.035 fading in, ground scroll offset rate speed/4, wind gain curve 10→16 ⇒ 0→0.5 via `getStats()`, near-miss 0.55×0.18 s + 8 % vignette + no-stack, banners at 10/12/14/16 + every 250 m + VOLLGAS at 16 (EN+DE), §G4.8 reduced doses (runner FOV +8/pool 16, toyRacer boost-only, harborHopper boost burst, cityDrive/deliveryRush UNCHANGED); logic tests untouched (git diff); payouts unchanged; draw-call delta ≤ 30. **Pass bar:** all §G4 numbers live; zero logic drift.

**V4-E15 [solfast] — gallery + export.** Read PLAN4.md §B7, §C-SYS9 (ALL). Cap-40 eviction loop (script 45 captures), quota-retry path (mock/inspect), grid/viewer/swipe/delete/confirm/empty-state, share: web fallback chain + the native Filesystem→Share code path (code audit + `npx cap sync ios` pod check — plugins present, guarded imports, web boot without them clean), badge dot lifecycle, profile row count, first-photo hint once, photo-mode „Im Album ansehen", `gallery` save-slice mirror vs IDB truth after kills/reloads, objectURL revocation (no leak over 40 opens), photos survive reload; sticker-book adjacency intact (v3 tabs unharmed). **Pass bar:** §C-SYS9 exact; IDB failure never breaks the game.

**V4-E16 [solfast] — gyro parallax.** Read PLAN4.md §B8, §C-SYS8 (ALL). Default OFF + zero listeners while off (probe); synthetic `deviceorientation` sweeps: deadzone 2°, sensitivity 0.008, clamps ±0.12/±0.08, EMA re-zero over ~4 s of held tilt, lerp τ=150 ms; pointer fallback ±0.06 through the same pipeline; permission flow code audit (in-gesture, denied → snap-back + toast); forced-zero during care walk-tos/photo/overlays; FPS guard hysteresis (suspend < 25, resume ≥ 35 — simulate via throttling); garden + all 5 rooms; `settings.gyro` persistence. **Pass bar:** every §C-SYS8 number verified numerically.

**V4-E17 [solfast] — dev panel completeness + harness surface.** Read PLAN4.md §C-SYS6 (ALL). All 18 cards behave per spec (12 v3 regression-spot + the 6 new exactly: codes list/redeem/reset/lock-reset; modifier readout/force/clear/next-now driving the REAL engine; recap preview-at-level (no state writes — verify!), last-replay, beat-debug; radio readout/skip/manifest stats/quick-trim; Sprungliste every scene/screen + splat teleport with fps/draw readout; cheat sheet rows == `data/harnessParams.js` == AGENTS.md, copy buttons); ledger expander format; devUnlocked gate intact (5-tap, invisible pre-unlock); every documented harness param works (full checklist incl. `?difficulty/?invertx/?flycam`). **Pass bar:** 18/18 cards exact; harness table green.

**V4-E18 [solfast] — XP transparency.** Read PLAN4.md §C-SYS3 (ALL). All 12 sites fire floaters with correct amounts (trigger each live: minigame end, feed, full wash, pet incl. cap-20 suppression, sleep, quest claim, harvest, delivery, photo incl. cap-5, first sticker, set complete, nougat), queue-3 coalescing, zero-grants emit nothing; static-analysis test green + your own grep for unpaired `applyXp`; xpInfo sheet: 12 rows live-numbered from constants (mutate `petsToday` → row updates), footnote, next-unlock line; level-up toast preview + L40 „Alles freigeschaltet"; recap end card next-unlock consistency; no NEW XP sources vs the §C-SYS3.1 list (grep). **Pass bar:** 12/12 sites + sheet + previews exact.

**V4-E19 [solfast] — 28-game regression chain.** Read PLAN4-GAMES §G10; PLAN3 §C10. The chain: all 28 games via `?minigame=<id>&autoplay=1&level=40&energy=100` at Mittel + spot 8 games at easy/hard/endless — per-game table: completed | score | payout | in-row | ×2 once | pause/resume | meta | console errors; framework consistency (countdown/results/refusals incl. sick-arcade block + sick shop-trip allow); every game launchable at unlock level, locked below; pregame → launch path for all (trips bypass); v3 depth features spot-glanced (8 games); `.logic.js` purity imports; dispose discipline ×3 on 6 heaviest scenes; contact sheet 28 covers vs games. **Pass bar:** 28/28 clean; zero framework regressions.

**V4-E20 [solfast] — v3 feature regression.** Read PLAN3 §C (v3 numbers still bind); PLAN4.md §A3. Battery over surfaces 4.0 did NOT redesign: garden cycle + weather/ambience, sickness/vet/weight (incl. the CHANGED sick gate's non-changes: vet-drive-only rule §A3, medicine prices), quests/collections/albums v2+v3 tabs, sticker book 28 originals + hooks, Nougatschleuse, outfits 42 + back slot, travel both methods healthy, daily bonus, onboarding, 5 volume sliders + mute rules + medley contexts WHEN RADIO OFF (the §A3 medley-fallback guarantee — radio on/off toggles the director gate correctly), notifications ids 1–7 rules + quiet hours with id 8 now in the pipeline (spacing/cap 8), photo mode capture, profile stats, dev gate. Flag ANY v3 number drift (git diff constants + spot-play). **Pass bar:** zero v3 regressions.

**V4-E21 [solfast] — strings EN+DE parity + copy quality.** Read PLAN4.md §A2 i18n bullet, §E0.1-8. Script the key-diff across all 19 v4-* modules (EN↔DE parity, no empties, no `t('…')` miss — runtime sweep with a missing-key trap); frozen files untouched (git diff strings.js + v2-* + v3-*); ownership headers respected (git log per module vs the §E0.1-8 owner map); spot-read 80 DE strings (owner is German — flag Denglisch; exact copies: §C-SYS5.2 toasts, §C-SYS7.3 care rows, §C-SYS4.2 names, §C-SYS2.4 templates with singular rules); 15 DE screenshots at 320 px on string-stress surfaces; no hardcoded user-facing strings in new files (sample 25). **Pass bar:** parity clean; binding copy verbatim; zero broken keys.

**V4-E22 [solfast] — code quality, purity, conventions.** Read PLAN4.md §B (paths), §E0.1 rulings; PLAN3 §E0.1 heritage. Lint + px-audit clean; purity grep (no three/DOM in systems/, data/, *.logic.js — incl. modifierEngine, recapEngine, radioQueue.logic, codesEngine, gallery.logic, goobyWelt.logic/paths); constants.js exactly ONE V4/G53 block (git audit); package.json exactly ONE G50 edit; sfxMap timeline respected (G78 consolidation, no orphan blocks); marked-block hygiene (`// V4/G` attributable, no debug leftovers); JSDoc on new public APIs (radioPlayer, modifierEngine, recapEngine, codesEngine, photoStore, parallax, inputInvert, setSteer contract); CRLF on new files; `getSkinnedModel` for skinned NPCs; no `createMediaElementSource` double-call risk (code path audit); async dispose contract adopted (sceneManager awaits). **Pass bar:** all clean; violations with file:line.

**V4-E23 [solfast] — CI / .ipa / plist / licensing / plugins.** Read PLAN4.md §A2 lint/CI + assets bullets, §C-SYS9.4, §C-SYS10. `gh run list` → latest run on final SHA green BOTH jobs; download the ipa: Payload binary, v4 chunks (radio/recap/welt filenames from local dist/), splat PLYs + music + covers in the bundle (size sanity vs App Store expectations — report ipa MB), **AppIcon 1024 colorType 2 NO alpha (the icon! gate)**, dark/tinted variants per G80's shipped decision; plist: CFBundleShortVersionString **4.0.0**, portrait-only, UIRequiresFullScreen, ITSAppUsesNonExemptEncryption=false, display name, no camera/mic/photo permission keys (Share/Filesystem must NOT require them — verify no new usage-description keys demanded); **the new-pods check:** `@capacitor/share`+`filesystem` in package.json + `npx cap sync ios` green + pods declared; licensing sweep: every asset root has its LICENSE file, CC-BY splats credited in-app (cross-check credits.test), music LICENSES.md complete; no dep drift beyond G50's three. **Pass bar:** CI green on final SHA; ipa valid at 4.0.0 with opaque icon; licensing complete.

**V4-E24 [solfast] — sick-trip + settings IA + notifications + persistence journeys.** Read PLAN4.md §C-SYS7, §C-SYS12.1–12.3, §B10; PLAN3 §E0.1-8 heritage. Sick-trip: gate matrix live (sick × {arcade, shopTrip-drive, shopTrip-surf, vetTrip}), care sheet 3 actions + exact copy, 0-medicine auto-scroll pulse once, sick face in rigs, no gameplay handicap; settings IA: 8-row main list order exact, every v3 setting ≤ 2 taps, 320×568@130 % unscrolled, hint chip session-once, muscle-memory walk (all 5 sliders + haptik + language + notifications reachable); notifications: ids 1–7 regression + id 8 rules (schedule at nextAt, quiet hours shift, spacing, cap 8, once per event); journeys: ① fresh → onboarding → radio → close/reopen → resumes; ② migrated v1 → whatsNew 4.0 once (v2/v3 panels not double-firing); ③ v3 → panel once; ④ fresh never; ⑤ radio/codes/difficulty/gallery state × 3 reload cycles + mid-game kill; ⑥ localStorage/Preferences mirror parity. **Pass bar:** all matrices + journeys clean with screenshots.

## F3. Fix loop (coordinator protocol, after all 24 verdicts)

1. **Triage:** `/tmp/gooby-v4-eval/triage.md` — one row per deduped finding: `id | P | title | evidence | owning module | owning §E0.4 agent | eval(s) to re-run`. P2s: batch ≤ 1 polish agent per round or defer with justification.
2. **Fix waves:** group P0/P1 by §E0.4 ownership into fix agents `V4/F1…` (≤ 12/round on slots A–L; model: fable for engine/game-logic, solfast for content/copy/layout) with strictly disjoint files. Prompt = product context + OWNS boundary + verbatim finding rows + §E0.2 COMMON RULES + a regression test per fixed P0/P1 where a pure surface exists + commit `GOOBY V4/F<n>: <summary>`. Prefer RESUMING the original §E agent when findings map 1:1 (context warm; buffer ids G85–G87 available for fresh cross-cutting fix agents).
3. **Targeted re-evals:** after each fix wave + §G2 checkpoint + push + CI: re-run ONLY affected evals (fresh agents, same charters, prefixed „RE-EVAL round k — focus findings <ids>, then spot-check your full charter").
4. **Exit criteria (ship gate):** zero open P0/P1; seven hard bars PASS in their latest run — layout (E10 full grid), economy (E1), save (E2), recap beat sync (E3), radio/no-synth (E4), perf/leaks (E11), CI/ipa (E23 on the final SHA); E12's soak repeated if > 12 P0/P1 were fixed in total.
5. **Loop** until exit; a finding surviving 2 rounds escalates to a dedicated debug agent with full history.

---

# §G. Coordinator Runbook (4.0)

## G0. Pre-wave gates (run BEFORE launching wave 1a)

1. **Baseline:** from `/workspace/GOOBY`: `git log --oneline -5` (HEAD = the two PLAN4 commits + requests.md on top of `0d3a2dd`), `npm install` if stale, then `npm run lint && npm test && npm run build` — 1226 green, lint clean. Confirm CI green on the current SHA (`gh run list`). Any red: stop and investigate.
2. **Staging present:** `ls /workspace/asset-staging/itchio/REPORT.md /workspace/asset-staging/splats/REPORT.md` + the §C-SYS1.7 music zips + `/opt/cursor/artifacts/gooby_welt_feasibility_report.md`. Missing staging = halt (G50 cannot run).
3. **ART-GATE-1 (blocks wave 1b, not 1a):** generate + commit: `public/assets/stickers/herzGooby.png` (512², ≤ 150 KB, §C-SYS5.4 prompt = frozen §C5.1-v3 prefix + „Gooby hugging a big glossy pink heart, blissful smile, tiny hearts floating around"); 14 builtin track covers + `_default.png` per §C-SYS1.6 (512², ≤ 120 KB, exact-basename naming into `public/assets/GoobyMusic/covers/` for GoobyMusic files and alongside the committed music per G51's documented convention — cozy pastel album art, Gooby motifs, NO text; `_default` = Gooby with headphones). Verify sizes/dimensions with a script loop; eyeball every image; commit `GOOBY V4: ART-GATE-1 — herzGooby + 14+1 track covers (coordinator-generated)`.
4. **GoobyMusic poll #0:** `ls public/assets/GoobyMusic/*.mp3 *.ogg` — if the owner already dropped tracks, run the §G4 arrival protocol BEFORE wave 1b so G51's manifest includes them.
5. Confirm the tmux dev server on 5174 is alive for coordinator smokes; agents never use it.

## G1. Ports & concurrency

Twelve slots (§E0.3): A=5175/9221 … L=5186/9232. Slot assignments are printed in each §E block; team evals reuse their team's slot; final evals map `((n−1) mod 12)`. Stuck port: `lsof -ti:<port>` → kill that PID only (never `pkill -f`). Launch each agent on its block's model tag (`fable` deep, `solfast` broad/fast). Waves 1b/2/3 run 9–10 agents concurrently — watch VM load; if the box thrashes, stagger launches 2–3 min apart (ports are pre-assigned, order within a wave doesn't matter).

## G2. Between-wave checkpoint (from `/workspace/GOOBY`, after every wave's commits land)

```bash
git -C /workspace log --oneline -15        # every expected "GOOBY V4/G<id>:" commit present?
git -C /workspace status --short           # tree clean
npm run lint && npm run px-audit           # exit 0
npm test                                   # exit 0 — floors: ≥1320 after W1, ≥1380 after W2, ≥1435 after W3, ≥1446 after W4 (§A2)
npm run build                              # exit 0; note main-chunk gzip (splat lib must stay out of main)
node --test test/assetBudget.test.js       # §A2 ledger
npx cap sync ios                           # after W1 (plugins) and W4 (icon)
```

Quick boot smoke (5174 or `npm run shot`): fresh `/?reset=1` + a v1 AND v3 fixture — home renders, zero console errors, `__gooby.store.get('v') === 4` (post-W1). Any red → resume the owning agent with the failure log; do not launch the next wave until green.

**PUSH + CI AFTER EVERY MERGED WAVE (owner requirement):** checkpoint green → `git -C /workspace push origin main` → `gh run watch $(gh run list --workflow gooby-ios.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')` — BOTH jobs green before the next wave. CI red = P0: fix (resume the responsible agent or fix trivial CI-only issues yourself), re-push, re-watch.

## G3. Wave execution order (gates inline; art gates + music polls are COORDINATOR work between waves)

| step | action | gate to proceed |
|---|---|---|
| 0 | §G0 gates 1–5 (incl. ART-GATE-1 + poll #0) | all green |
| 1a | launch **G50** (solo) | CP-W1a: §G2 + `npm install` (new deps) + fetch-itch idempotent + `npx cap sync ios` green + ledger actual vs §A2 in report → push + CI |
| 1b | launch **G51 ∥ G52 ∥ G53 ∥ G54 ∥ G55 ∥ G56 ∥ G57 ∥ G58 ∥ G59 ∥ G60** (10) | CP-W1: §G2 (≥ 1320); fixtures migrate lossless; radio plays (`getStats().radio`); modifier force-cycle; codes redeem; carController/harbor direction probes in reports; sick gate matrix; invert proxy → push + CI |
| art | **ART-GATE-2:** generate + commit 8 recap backdrops (`public/assets/recap/bg-1..8.png`, 1024×512, ≤ 200 KB, §C-SYS2.3 biome moods) · **GoobyMusic poll #1** | files verified (dims/sizes script) + eyeballed |
| 2 | launch **G61 ∥ G62 ∥ G63 ∥ G64 ∥ G65 ∥ G66 ∥ G67 ∥ G68 ∥ G69 ∥ G70** (10) | CP-W2: §G2 (≥ 1380); purble bot bars; forced L5 recap end-to-end; welt 10-cycle tables in reports; surf direction probe; pregame all modes; care sheet ×3 → push + CI |
| 2e | launch **V4/E-CAKE ∥ V4/E-RECAP ∥ V4/E-WELT** (read-only) | all 3 verdicts in |
| 2f | resume G61/G62, G63/G64 (+G55/G53 if recap findings point there), G65/G66 with their eval's P0/P1 rows (§E0.1-12) | zero open team P0/P1 → §G2 → push + CI · **GoobyMusic poll #2** |
| 3 | launch **G71 ∥ G72 ∥ G73 ∥ G74 ∥ G75 ∥ G76 ∥ G77 ∥ G78 ∥ G79** (9) | CP-W3: §G2 (≥ 1435); 26-game difficulty certification grid (G75's report); audioCoverage exact-set green; modifier pinned-clock cycle log (G77); room draw-call deltas → push + CI |
| art | **ART-GATE-3:** generate + commit 28 game covers (§G7.1 style guide, 512×384 ≤ 85 KB, per-game prompt template) + `GOOBY/art/icon-v4-source.png` (+ optional layer PNGs) (§C-SYS10.1) · **GoobyMusic poll #3** | 28 files verified (ids × dims × sizes script) + eyeballed; icon source 1024² opaque |
| 4 | launch **G80 ∥ G81 ∥ G82 ∥ G83 ∥ G84** (5) | CP-W4: §G2 (≥ 1446); icon test green + `npx cap sync ios`; whatsNew-4.0 once; credits cross-check green; 28-tile arcade with covers; G84's chain 28/28 → push + CI |
| 5 | **GoobyMusic poll #4**, then §F: 24 final evals (2 batches of 12, slot-mapped, model tags) | all 24 verdicts in |
| 6 | §F3 fix loop (fix waves ≤ 12, targeted re-evals, push + CI per round) | §F3 exit criteria |
| 7 | §G5 ship checklist | shipped |

**CP-W4 28-game chain (sequential CDP sessions → `/tmp/gooby-v4-cp4/chain.json`):** the PLAN3 §G3 27-id loop + `goobyWelt`, each `?minigame=<id>&autoplay=1&level=40&energy=100` → results with in-row payout, zero console errors; spot 6 games additionally at `&difficulty=hard` and 3 at `&difficulty=endless`.

## G4. GoobyMusic polling protocol (owner uploads arrive asynchronously — §C-SYS1.1's zero-code promise is YOURS to keep)

At every poll point (before waves 2/3/4, after evals, and whenever the owner pings):

1. `ls -la GOOBY/public/assets/GoobyMusic/*.{mp3,ogg}` — new files vs the manifest? (`node -e` diff against `src/data/musicManifest.json`.)
2. Sanity: naming per §B2.1 (`Kategorie - Titel.ext`); files < 10 s auto-become Stingers (fine); flag naming misses to the owner via requests.md conventions rather than renaming silently (a wrong category still lands in `gooby-fm` as Radio).
3. Run `npm run music-manifest`; for every new `Recap - *` track run `npm run beats`.
4. Generate ONE cover per new track (§C-SYS1.6: exact basename, 512², ≤ 120 KB, cozy pastel, NO text) into `public/assets/GoobyMusic/covers/`.
5. Re-run `npm test` (musicRegistry asserts path integrity), then commit: `GOOBY V4: GoobyMusic drop — <n> tracks (+manifest/beats/covers)`.
6. If a drop lands mid-wave: commit is safe (manifest/covers/beats are coordinator-owned paths, no agent owns them after G51 merges) — but never while G51 itself is uncommitted.

## G5. Final ship checklist

1. §F3 exit criteria met (zero P0/P1; the seven hard bars PASS; E12 verdict PASS).
2. `npm run lint && npm test && npm run build` green on the final tree (≥ 1446); asset ledger within §A2; diff review — only GOOBY/ + workflow paths touched; MONKEYBAR untouched (`git log --oneline origin/main..main -- MONKEYBAR` empty).
3. Final push → CI BOTH jobs green (`gooby-ios.yml`).
4. Download the ipa: `gh run download <run-id> --name gooby-unsigned-ipa --dir /tmp/gooby-v4-ship/`.
5. Verify: Payload/App.app binary; v4 chunks (radio/recap/goobyWelt names from local `dist/`); `public/assets/{music,splats,covers,itch}` in the bundle; **AppIcon 1024² colorType 2 opaque (G80's — if plist reads 3.0.0, CI built a stale SHA: re-run)**; plist: **CFBundleShortVersionString = 4.0.0**, portrait-only, UIRequiresFullScreen, ITSAppUsesNonExemptEncryption=false, `CFBundleDisplayName=Gooby`, NO new permission keys; report the ipa size (splats + music make it noticeably bigger — expected).
6. `cp /tmp/gooby-v4-ship/gooby-unsigned.ipa /opt/cursor/artifacts/gooby-4.0-unsigned.ipa`; also copy: the chain table, E12's verdict, E10's grid summary, E3's beat-offset log, E9's leak table, the best `v4e*_`/`v4<team>_` artifacts.
7. Final report to the owner: §A2 counts table (actual vs target), 3 team-eval + 24-eval verdict summary, fix-round history, deferred P2s with justification, GoobyMusic drop log (tracks live at ship), sideload pointer (README).

## G6. Failure playbook (v3 §G5 carries over, plus 4.0-specific)

- **Agent dies mid-wave / append lost / index.lock / cross-agent suite red / CI-red-local-green:** exactly as PLAN3 §G5.
- **ffmpeg/ffprobe missing on the VM (G51's scripts):** install locally for the session (staging tooling, not a repo dep); scripts must remain build-agent-time only — never wired into CI.
- **Splat scene fails to load in SwiftShader:** distinguish VM-slowness (minutes-long load is expected — wait) from a real failure (console error); the fallback stage covers players, but a hard viewer error is a P0 → resume G65 with the console log.
- **A wave-3 batch agent's Schwer target is bot-unreachable:** per §G5.4, relax the PARAMS (resume the batch agent), never raise the target; re-run G75's certification row.
- **Art gate misses (cover/backdrop wrong size/ugly):** regenerate at the coordinator level; agents never block on art beyond their stated HARD PRECONDITIONs (G53: herzGooby; G63: backdrops-with-fallback; G80: icon source; G83: covers).
- **Owner drops music with unparseable names:** it still lands as `Radio` category (script warns); note it in the ship report, don't rename without the owner's say-so.

*End of PLAN4.md. §A–§C-SYS by plan agent A (systems specs); PLAN4-GAMES.md by plan agent B (game specs); §E–§G by plan agent C (waves, evals, runbook).*
