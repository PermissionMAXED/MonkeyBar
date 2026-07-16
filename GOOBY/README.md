# GOOBY 🐰

Gooby is a fat, lovable rabbit who lives in a cozy 3D apartment. Feed him, wash him,
tickle him, put him to bed, decorate his rooms, dress him up — and when the fridge is
empty, hop in the car and drive through a sunny low-poly city to the shop. Twelve
arcade minigames earn the coins that fuel it all.

A Pou / Talking-Tom-style virtual-pet game: mobile-first three.js web app, wrapped
with Capacitor for iOS. Fully offline, single-player, no server, no monetization.
Bilingual EN + DE (auto-detected, switchable in settings).

## How to play

- **First run:** a short scripted tutorial („Das ist Gooby!") walks you through
  petting, feeding a carrot, a quick bath, the HUD, a 30-second Carrot Catch
  round (≥10 coins guaranteed) and the shop door. It resumes where you left off
  and is skippable after step 3.
- **Care (4 stats):** hunger, energy, hygiene, fun. Drag food from the fridge
  tray to Gooby's mouth, scrub him in the bathtub, tap the toilet, toss the
  ball, stroke him to pet, rub his belly to tickle, poke him (5 quick pokes =
  dizzy!). Stats drain in real time — even while the app is closed — and local
  notifications (opt-in) remind you when he needs you.
- **Sleep:** tap the bedroom lamp or bed when his energy is low. Gooby snores
  through a 3-hour nap (shortcut: early wake after 30 min) and wakes with a yawn.
- **Rooms:** swipe between kitchen, living room, bathroom and bedroom. Buy
  furniture, wallpapers and floors in the shop's Decorate tab.
- **Shop trips:** when supplies run out, tap the cart button or front door and
  DRIVE there — the trip is a minigame; crash too often and the tow truck ends
  it. Buy food, furniture and outfits at the shop, then drive home.
- **Arcade — 12 minigames** (unlock by level): Shopping Cruise, Carrot Catch,
  Bunny Hop, Carrot Guard, Memory Match, Basket Bounce, Pancake Tower, Gooby
  Runner, Bubble Pop, Fishing Pond, Dance Party, Trampoline Tricks. First play
  of each game every day pays ×2 coins.
- **Progression:** everything grants XP; each level pays a coin bonus and
  unlocks games/items up to level 30. 16 achievements pay coin rewards. A daily
  bonus streak (20…100 coins + food from day 7) claims on the first open per day.
- **Wardrobe:** hats, glasses and neck items — Gooby wears them everywhere,
  including his minigame cameos.
- **Audio:** everything is WebAudio — Kenney sfx + synth jingles, a lo-fi home
  music loop, a 100 BPM dance track, and Gooby's fully synthesized voice
  (squeaks, giggles, snores, yawns). SFX / music / haptics toggle in settings,
  and the HUD bell button is a quick mute.

## Quick start

```bash
npm install
npm run dev        # dev server on http://localhost:5174
```

First boot lands in the onboarding tutorial; add `?reset=1` to any URL to wipe
the save and see it again.

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | Vite dev server on port 5174 |
| `npm run build` | production build → `dist/` |
| `npm run preview` | serve the production build on 5174 |
| `npm test` | `node --test` suites in `test/` |
| `npm run lint` | ESLint (flat config) |
| `npm run icons` | regenerate the iOS app icon + splash PNGs |
| `npm run shot -- "<url>" shots/<name>.png` | headless-Chrome screenshot of a URL |

## Dev harness

URL params (dev builds): `?scene=home|gooby`, `?room=…`, `?minigame=<id>`,
`?open=shop|wardrobe|achievements|arcade|settings`, `?coins=N`, `?level=N`,
`?energy=N`, `?hunger=N`, `?hygiene=N`, `?fun=N`, `?fast=N` (clock multiplier),
`?now=<epochMs>`, `?reset=1`, `?lang=de|en`, `?sleep=1` (start a nap),
`?autoplay=1` (bot-plays the launched minigame), `?onboarding=0` (suppress the
tutorial). Harness routes (`scene`/`minigame`/`open`) also suppress onboarding
so test surfaces stay clean. See PLAN.md §E9; `window.__gooby` exposes
store/ui/sceneManager/framework for console poking.

Try the framework smoke game: `http://localhost:5174/?minigame=_smoke`

## Project layout

`src/` splits by system: `core/` (store, save, clock, scenes, input, assets,
notifications), `character/` (procedural Gooby rig + outfits), `home/` (rooms,
care interactions, decor), `city/` + `systems/shopTrip.js` (drive + shop flow),
`minigames/` (framework + 12 games, each with a pure `.logic.js`), `systems/`
(stats, economy, leveling, achievements, daily bonus), `audio/` (WebAudio
manager, sfx map, Gooby voice), `ui/` (HUD, screens, onboarding), `data/`
(constants = ALL design numbers, strings EN+DE, catalogs). Tests in `test/`
run headlessly against the pure modules. `PLAN.md` is the binding architecture
contract (§E) — read it before restructuring anything.

<!-- ============ BEGIN G13 SECTION: Build & Sideload (owned by agent G13) ============ -->

## Build & Sideload (iOS)

GOOBY ships as an **unsigned** `.ipa` built by GitHub Actions — there are no Apple
certificates in this repo and no signing steps. You sideload it with your own
Apple ID via AltStore or Sideloadly.

### Getting the .ipa

The **GOOBY iOS** workflow (`.github/workflows/gooby-ios.yml`, repo root) runs on
every push touching `GOOBY/**` and can be started manually:

1. GitHub → **Actions** → **GOOBY iOS** → **Run workflow** (workflow_dispatch on
   any branch), or just push to `main`.
2. Two jobs run: `web-checks` (ubuntu: `npm ci`, lint, test, build) then
   `ios-ipa` (macos-15: build → `npx cap sync ios` → `pod install` → unsigned
   Release `xcodebuild` → zip `Payload/App.app`).
3. When green, download the **`gooby-unsigned-ipa`** artifact from the run's
   Summary page (or `gh run download <run-id> -n gooby-unsigned-ipa`) and unzip
   it to get `gooby-unsigned.ipa`.

### Sideloading

- **AltStore** ([altstore.io](https://altstore.io)): install AltServer on your
  Mac/PC, install AltStore to your iPhone over USB, then on the phone open
  AltStore → **My Apps → + → pick `gooby-unsigned.ipa`** and sign in with your
  Apple ID. Free-account apps expire after 7 days; AltStore auto-refreshes them
  when you're on the same Wi-Fi as AltServer.
- **Sideloadly** ([sideloadly.io](https://sideloadly.io)): connect the iPhone
  over USB, drag `gooby-unsigned.ipa` into Sideloadly, enter your Apple ID, and
  hit Start. Same 7-day free-account limit; re-sideload to renew.
- First launch: iOS Settings → **General → VPN & Device Management** → trust
  your developer certificate.

### Local iOS dev (needs a Mac)

```bash
npm run build          # web bundle → dist/
npx cap sync ios       # copy dist/ + plugin config into ios/
npx cap open ios       # opens ios/App/App.xcworkspace in Xcode (run pod install first)
```

On Linux, `npm run build && npx cap sync ios` still works (it skips the
CocoaPods step) — the native build itself is CI-only. Regenerate the app icon +
splash (committed under `ios/App/App/Assets.xcassets/`) with `npm run icons`.

<!-- ============ END G13 SECTION ============ -->

## Changelog (build waves)

- **Wave 1 — foundations:** Vite + three.js shell, store/save/clock/scene
  plumbing, asset pipeline (Kenney CC0 packs), UI overlay system, dev harness.
- **Wave 2 — Gooby & home:** procedural rabbit rig (squash-and-stretch clips,
  emotion faces), 4 furnished rooms with swipe navigation, day/night.
- **Wave 3 — care loop:** stats + time engine (offline catch-up), feed/wash/
  toilet/pet/tickle/ball interactions, HUD, arcade screen, sleep flow, local
  notifications, settings, city drive + shop trip, minigames A (Carrot Catch,
  Bunny Hop, Carrot Guard, Memory Match) + framework.
- **Wave 4 — content:** minigames B/C (Basket Bounce, Pancake Tower, Runner,
  Bubble Pop, Fishing Pond, Dance Party, Trampoline), economy + shop + furniture
  placement, wardrobe/outfits, achievements, daily bonus.
- **Wave 5 — ship it:** iOS packaging (Capacitor, CI `.ipa`, icons/splash),
  WebAudio manager + full sfx map + Gooby voice synth + procedural music,
  haptics, settings audio toggles, results confetti + coin-fly + polish pass,
  first-run onboarding, docs.

## Credits

- 3D models & audio: [Kenney](https://kenney.nl) CC0 asset packs (furniture,
  food, city, nature kits; interface/impact sounds; music jingles).
- Everything else: procedural — Gooby's body, voice and music are all code.
