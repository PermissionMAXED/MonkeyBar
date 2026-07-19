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



